"""Disposable full-round-trip spike. Pipecat owns RTP, VAD and output queues.
Existing restricted relay owns BB authorization, STT, model and Alfred leases.
No audio persistence. Not a replacement production conversation controller.
"""
import asyncio, io, json, logging, time, uuid, wave, os, hmac, hashlib, base64
from pathlib import Path
from collections import deque
import aiohttp
import numpy as np
import onnxruntime as ort
ort.disable_telemetry_events()
from aiohttp import web
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import InputAudioRawFrame, OutputAudioRawFrame, VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame, InterruptionFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker, PipelineParams
from pipecat.workers.runner import WorkerRunner
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.request_handler import SmallWebRTCRequestHandler, SmallWebRTCRequest
from loguru import logger
logger.remove(); logger.add(__import__('sys').stderr, level='WARNING')
logging.basicConfig(level=logging.INFO)
handler = SmallWebRTCRequestHandler(ice_servers=['stun:stun.l.google.com:19302'])
runners = set()

class Bridge(FrameProcessor):
    def __init__(self, pc, token):
        super().__init__()
        self.pc, self.token = pc, token
        self.client = str(uuid.uuid4()); self.lease = ''; self.focus = None
        self.http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60))
        self.pre = deque(maxlen=20); self.audio = bytearray(); self.hearing = False
        self.job = None; self.generation = 0; self.last_spoken = ''; self.was_speaking = False
    def event(self, phase, **data):
        logging.info(json.dumps({'stage':'pipecat','phase':phase,'clientId':self.client,'at':time.time(), 'generation':self.generation}))
        self.pc.send_app_message({'type':'jarvis','phase':phase, **data})
    async def relay(self, path, data=None, raw=None):
        headers={'authorization':self.token,'x-jarvis-client':self.client,'x-jarvis-lease':self.lease}
        if raw is not None: headers['content-type']='audio/wav'
        async with self.http.post('http://127.0.0.1:4842/'+path, headers=headers, json=data if raw is None else None, data=raw) as r:
            if r.status != 200: raise RuntimeError(f'{path} failed ({r.status})')
            return await r.json()
    async def command(self, action, **kw):
        s=await self.relay('assistant',{'action':action,'clientId':self.client, **kw})
        self.lease=(s.get('owner') or {}).get('leaseKey', self.lease)
        return s
    async def interrupt(self):
        self.generation += 1
        if self.job:
            self.job.cancel()
            await asyncio.gather(self.job, return_exceptions=True)
            self.job=None
        await self.broadcast_frame(InterruptionFrame)
        await self.command('interrupt')
        self.event('interrupted')
    async def process_frame(self, frame, direction):
        await super().process_frame(frame,direction)
        if direction != FrameDirection.DOWNSTREAM:
            await self.push_frame(frame,direction); return
        if isinstance(frame, InputAudioRawFrame):
            if self.hearing:
                self.audio.extend(frame.audio)
                if len(self.audio)>960000:
                    self.audio.clear(); self.hearing=False; self.event('error',text='Please use a shorter utterance; nothing was submitted.')
            self.pre.append(frame.audio)
            return
        if isinstance(frame,VADUserStartedSpeakingFrame):
            self.was_speaking = bool(self.job and not self.job.done())
            await self.interrupt()
            self.audio = self.audio if self.hearing else bytearray(b''.join(self.pre))
            self.hearing=True; self.event('listening')
        elif isinstance(frame,VADUserStoppedSpeakingFrame) and self.hearing:
            self.hearing=False
            raw=bytes(self.audio); self.audio.clear()
            self.job=asyncio.create_task(self.respond(raw, self.generation))
        await self.push_frame(frame,direction)
    async def respond(self, raw, generation):
        try:
            # Reuse the real Smart Turn service before committing captured speech.
            floats=(np.frombuffer(raw,dtype='<i2').astype(np.float32)/32768).tobytes()
            async with self.http.post('http://127.0.0.1:4843/turn',data=floats[-512000:]) as r:
                if r.status!=200: raise RuntimeError('Turn detection unavailable')
                complete=(await r.json())['complete']
            if not complete:
                self.audio=bytearray(raw); self.hearing=True; return
            b=io.BytesIO()
            with wave.open(b,'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(raw)
            self.event('transcribing')
            result=await self.relay('transcribe',raw=b.getvalue())
            text=result.get('text','').strip()
            if not text: self.event('ready'); return
            normalize=lambda value: ''.join(c for c in value.lower() if c.isalnum())
            if self.was_speaking and len(normalize(text))>2 and normalize(text) in normalize(self.last_spoken):
                self.event('error',text='Possible speaker echo. Please repeat your answer; nothing was sent.')
                return
            self.event('transcript',text=text)
            kw={'text':text}
            if self.focus: kw['presentedQuestion']=self.focus
            state=await self.command('talk',**kw)
            await self.speak(state,generation)
        except asyncio.CancelledError: raise
        except Exception as e: self.event('error',text=str(e))
    async def speak(self,state,generation):
        item=state.get('utterance')
        if not item: self.event('ready'); return
        self.last_spoken=item['text']
        self.focus=(state.get('focus') or {}).get('binding')
        self.event('response',text=item['text'],question=(state.get('focus') or {}).get('displayText'))
        # Existing relay emits framed PCM24k; zero length means synthesis and lease release succeeded.
        headers={'authorization':self.token,'x-jarvis-client':self.client,'x-jarvis-lease':self.lease}
        async with self.http.post('http://127.0.0.1:4842/speech',json={'text':item['text'][:2000]},headers=headers) as r:
            if r.status!=200: raise RuntimeError(f'Alfred failed ({r.status})')
            self.event('speaking')
            carry=b''
            while True:
                size=int.from_bytes(await r.content.readexactly(4),'big')
                if size==0: break
                if size>1048576: raise RuntimeError('Invalid PCM frame')
                carry+=await r.content.readexactly(size)
                while len(carry)>=1920:
                    if generation!=self.generation: return
                    # Await transport delivery to bound queued audio independently of TTS speed.
                    await self.push_frame(OutputAudioRawFrame(carry[:1920],24000,1))
                    carry=carry[1920:]
                    await asyncio.sleep(.04)
            if carry:
                if len(carry)%2: raise RuntimeError('Odd PCM payload')
                await self.push_frame(OutputAudioRawFrame(carry,24000,1))
        self.event('generated') # Never claim physical playback or mark an approval heard.
    async def cleanup(self):
        if self.job: self.job.cancel(); await asyncio.gather(self.job,return_exceptions=True)
        try: await self.command('close')
        except Exception as e: logging.warning('Ownership cleanup: %s',e)
        await self.http.close(); await super().cleanup()

async def offer(req):
    token=req.headers.get('authorization','')
    if not token.startswith('Bearer ') or len(token)<47: raise web.HTTPUnauthorized()
    body=await req.json()
    setup_error=[]
    async def connected(pc):
        bridge=Bridge(pc,token)
        try: await bridge.command('start')
        except Exception as e:
            setup_error.append(e)
            await bridge.http.close(); await pc.disconnect(); raise
        transport=SmallWebRTCTransport(webrtc_connection=pc,params=TransportParams(audio_in_enabled=True,audio_in_sample_rate=16000,audio_out_enabled=True,audio_out_sample_rate=24000))
        pipeline=Pipeline([transport.input(),VADProcessor(vad_analyzer=SileroVADAnalyzer(params=VADParams(start_secs=.2,stop_secs=.5))),bridge,transport.output()])
        task=PipelineWorker(pipeline,enable_rtvi=False,params=PipelineParams(audio_in_sample_rate=16000,audio_out_sample_rate=24000))
        @transport.event_handler('on_client_connected')
        async def ready(*_):
            bridge.event('ready')
        @transport.event_handler('on_client_disconnected')
        async def gone(*_): await task.cancel()
        @pc.event_handler('app-message')
        async def message(_,msg):
            try:
                if msg.get('type')=='heartbeat': await bridge.command('heartbeat')
                elif msg.get('type')=='stop': await bridge.interrupt()
                elif msg.get('type')=='brief':
                    await bridge.interrupt()
                    async def brief():
                        try: await bridge.speak(await bridge.command('brief'),bridge.generation)
                        except Exception as e: bridge.event('error',text=str(e))
                    bridge.job=asyncio.create_task(brief())
            except Exception as e: bridge.event('error',text=str(e))
        @pc.event_handler('closed')
        async def closed(*_): await task.cancel()
        async def run():
            runner=WorkerRunner(handle_sigint=False)
            await runner.add_workers(task)
            await runner.run()
        runner=asyncio.create_task(run()); runners.add(runner)
        runner.add_done_callback(runners.discard)
    answer=await handler.handle_web_request(SmallWebRTCRequest(sdp=body['sdp'],type=body['type']),connected)
    if setup_error: raise web.HTTPConflict(text='End the existing Jarvis conversation before starting this spike.')
    return web.json_response(answer)
async def ice(req):
    token=req.headers.get('authorization','')
    async with aiohttp.ClientSession() as client:
        async with client.post('http://127.0.0.1:4842/assistant',headers={'authorization':token},json={'action':'state','clientId':str(uuid.uuid4())}) as r:
            if r.status!=200: raise web.HTTPUnauthorized()
    username=str(int(time.time())+300)+':jarvis-spike'
    secret=Path('/home/tester/jarvis/turn-secret').read_text().strip().encode()
    credential=base64.b64encode(hmac.new(secret,username.encode(),hashlib.sha1).digest()).decode()
    return web.json_response({'iceServers':[{'urls':os.environ.get('JARVIS_TURN_URL','turn:127.0.0.1:4845?transport=tcp'),'username':username,'credential':credential}],'iceTransportPolicy':'relay'})
app=web.Application(client_max_size=100000); app.router.add_post('/offer',offer); app.router.add_get('/ice',ice)
async def shutdown(_):
    await handler.close()
    for task in runners: task.cancel()
    await asyncio.gather(*runners,return_exceptions=True)
app.on_shutdown.append(shutdown)
web.run_app(app,host='127.0.0.1',port=4844,access_log=None)
