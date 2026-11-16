"""Pinned upstream engines behind the same bounded PCM protocol as Kokoro.
Sentence synthesis (not an incremental decoder). LiveKit owns conversation/interruptions.
"""
import argparse,json,time,threading,struct,socket,select,subprocess,sys,os,re
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import numpy as np
import torch
p=argparse.ArgumentParser();p.add_argument('engine',choices=['qwen','cosyvoice']);p.add_argument('--port',type=int,default=4853);a=p.parse_args()
root=Path(__file__).resolve().parent;ref=root/'alfred-reference.wav';transcript=(root/'reference-transcript.txt').read_text().strip()
torch.set_num_threads(4);torch.set_num_interop_threads(1)
if not torch.cuda.is_available():raise RuntimeError('This GPU comparison requires a working CUDA device; no silent CPU fallback')
started=time.monotonic()
def log(phase,**fields):print(json.dumps(dict(phase=phase,engine=a.engine,**fields)),flush=True)
log('loading',device=torch.cuda.get_device_name())
if a.engine=='qwen':
 from qwen_tts import Qwen3TTSModel
 model=Qwen3TTSModel.from_pretrained(str(root/'models/qwen'),device_map='cuda:0',dtype=torch.bfloat16,attn_implementation='sdpa')
 prompt=model.create_voice_clone_prompt(ref_audio=str(ref),ref_text=transcript,x_vector_only_mode=False)
 def generate(text,speed):
  wave,rate=model.generate_voice_clone(text=text,language='English',voice_clone_prompt=prompt)
  if rate!=24000:raise ValueError('Unexpected sample rate')
  native=np.asarray(wave[0],dtype='<f4').tobytes()
  return subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar','24000','-ac','1','-i','pipe:0','-af',f'atempo={speed}','-f','s16le','pipe:1'],input=native,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
 expected='qwen3-tts-0.6b'
else:
 sys.path[:0]=[str(root/'cosy-source'),str(root/'cosy-source/third_party/Matcha-TTS')]
 from cosyvoice.cli.cosyvoice import AutoModel
 model=AutoModel(model_dir=str(root/'models/cosyvoice'),load_trt=False,load_vllm=False,fp16=True)
 model.add_zero_shot_spk('You are a helpful assistant.<|endofprompt|>'+transcript,str(ref),'alfred')
 def generate(text,speed):
  pieces=[x['tts_speech'].detach().float().cpu().numpy().reshape(-1) for x in model.inference_zero_shot(text,'',str(ref),zero_shot_spk_id='alfred',stream=False,speed=speed)]
  if model.sample_rate!=24000:raise ValueError('Unexpected sample rate')
  pcm=(np.clip(np.concatenate(pieces),-1,1)*32767).round().astype('<i2').tobytes()
  if os.environ.get('JARVIS_COSY_CLEANUP')=='1':
   pcm=subprocess.run(['ffmpeg','-v','error','-f','s16le','-ar','24000','-ac','1','-i','pipe:0','-af','highpass=f=70,afftdn=nr=6:nf=-50','-f','s16le','pipe:1'],input=pcm,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=10).stdout
  return pcm
 expected='cosyvoice3'
# Pay first-use kernels/reference preparation before returning session readiness.
generate('Good afternoon, Chris.',1.25)
lock=threading.Lock()
def pieces(text):
 # Preserve sentence boundaries: an unfinished phrase can make a generative
 # engine omit its final words. Long sentences still have a bounded fallback.
 for sentence in re.split(r'(?<=[.!?;])\s+',text.strip()):
  current=''
  for word in sentence.split():
   if len(word)>120:raise ValueError('Unpronounceable token')
   if len(current)+len(word)>240:yield current;current=''
   current+=(' ' if current else '')+word
  if current:yield current
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def gone(self):
  readable,_,_=select.select([self.connection],[],[],0)
  return bool(readable) and self.connection.recv(1,socket.MSG_PEEK)==b''
 def do_GET(self):
  if self.path!='/health':self.send_error(404);return
  data=json.dumps({'ready':True,'engine':a.engine,'device':'cuda'}).encode();self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_POST(self):
  if self.path!='/speech':self.send_error(404);return
  sent=False;acquired=False;watchdog=None;start=time.monotonic();samples=0
  try:
   size=int(self.headers.get('Content-Length','0'))
   if not 0<size<=16384:raise ValueError('Invalid request size')
   value=json.loads(self.rfile.read(size));text=value.get('text');speed=value.get('speed')
   if not isinstance(text,str) or not text.strip() or len(text)>8000 or value.get('model')!=expected or value.get('voice')!='alfred' or speed not in [1,1.25,1.4]:raise ValueError('Invalid speech selection')
   chunks=list(pieces(text))
   while not lock.acquire(timeout=.1):
    if self.gone():return
    if time.monotonic()-start>45:raise TimeoutError('Inference busy')
   acquired=True
   def expire():log('inference-timeout');os._exit(124)
   watchdog=threading.Timer(60,expire);watchdog.daemon=True;watchdog.start()
   if self.gone():return
   self.send_response(200);self.send_header('Content-Type','application/x-jarvis-pcm');self.send_header('Connection','close');self.end_headers();sent=True
   for chunk in chunks:
    if self.gone():break
    pcm=generate(chunk,speed)
    if self.gone():break
    samples+=len(pcm)//2
    for offset in range(0,len(pcm),48000):
     data=pcm[offset:offset+48000];self.wfile.write(struct.pack('>I',len(data))+data)
   cancelled=self.gone()
   if not cancelled:self.wfile.write(struct.pack('>I',0))
   log('synthesized',durationMs=round((time.monotonic()-start)*1000),audioMs=round(samples/24),cancelled=cancelled,speed=speed)
  except (BrokenPipeError,ConnectionResetError):log('cancelled',durationMs=round((time.monotonic()-start)*1000))
  except Exception as error:
   log('failed',error=type(error).__name__,reason=str(error)[:200])
   if not sent:self.send_error(503,'Local synthesis unavailable')
  finally:
   self.close_connection=True
   if watchdog:watchdog.cancel()
   if acquired:lock.release()
server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler);log('ready',loadMs=round((time.monotonic()-started)*1000));server.serve_forever()
