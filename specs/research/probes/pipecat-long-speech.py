"""Run on staging with the real restricted relay; credential arrives on stdin.
Exercises Bridge's real paced PCM path and Alfred, not physical RTP playback.
Usage: python pipecat-long-speech.py /path/to/pipecat/server.py /path/to/real/document
"""
import asyncio, importlib.util, json, sys, time
from pathlib import Path
spec=importlib.util.spec_from_file_location('candidate',sys.argv[1])
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class Events:
    def __init__(self): self.events=[]
    def send_app_message(self,event):
        self.events.append({k:v for k,v in event.items() if k!='text'})
async def main():
    events=Events(); bridge=module.Bridge(events,sys.stdin.read().strip())
    text=Path(sys.argv[2]).read_text()[:2600]
    count=0
    async def capture(frame):
        nonlocal count
        count+=len(frame.audio)
    bridge.push_frame=capture
    async def keepalive():
        while True:
            await asyncio.sleep(5); await bridge.command('heartbeat')
    heartbeat=None
    try:
        await bridge.command('start'); heartbeat=asyncio.create_task(keepalive())
        started=time.monotonic()
        await bridge.stream_speech({'utterance':{'text':text}},bridge.generation)
        elapsed=time.monotonic()-started
        assert len(text)>2000 and count/48000>60 and elapsed>60
        assert sum(e['phase']=='speaking' for e in events.events)>=2
        assert events.events[-1]['phase']=='generated'
        print(json.dumps({'inputCharacters':len(text),'pcmBytes':count,'pcmSeconds':count/48000,'elapsedSeconds':elapsed,'events':events.events}))
    finally:
        if heartbeat:
            heartbeat.cancel(); await asyncio.gather(heartbeat,return_exceptions=True)
        await bridge.command('close'); await bridge.http.close()
asyncio.run(main())
