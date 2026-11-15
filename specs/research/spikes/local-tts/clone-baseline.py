"""Historical failed low-memory CPU baseline, retained for reproducibility.
The 2 GiB Qwen trial timed out; its greedy setting is not the current candidate.
Use engine-server.py for the validated GPU comparison, not this script.
This is whole-utterance synthesis, explicitly not a low-latency streaming claim.
Reference WAV and transcript remain private; only aggregate evidence belongs in Git.
"""
import argparse,json,time,resource,subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
import torch
p=argparse.ArgumentParser();p.add_argument('engine',choices=['qwen','cosyvoice']);p.add_argument('--model',required=True);p.add_argument('--reference',required=True);p.add_argument('--transcript',required=True);p.add_argument('--out',required=True);p.add_argument('--cosy-source');p.add_argument('--only-ack',action='store_true');p.add_argument('--speeds',default='1.0,1.25,1.4');a=p.parse_args()
torch.set_num_threads(2);torch.set_num_interop_threads(1)
out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
reference=Path(a.reference);transcript=Path(a.transcript).read_text().strip()
start=time.monotonic();print(json.dumps({'phase':'load','engine':a.engine}),flush=True)
if a.engine=='qwen':
 from qwen_tts import Qwen3TTSModel
 model=Qwen3TTSModel.from_pretrained(a.model,device_map='cpu',dtype=torch.float32,attn_implementation='sdpa')
 prompt=model.create_voice_clone_prompt(ref_audio=str(reference),ref_text=transcript,x_vector_only_mode=False)
 def generate(text,speed):
  audio,rate=model.generate_voice_clone(text=text,language='English',voice_clone_prompt=prompt,do_sample=False)
  return audio[0],rate
else:
 import sys
 sys.path[:0]=[a.cosy_source,str(Path(a.cosy_source)/'third_party/Matcha-TTS')]
 from cosyvoice.cli.cosyvoice import AutoModel
 model=AutoModel(model_dir=a.model,load_trt=False,load_vllm=False,fp16=False)
 model.add_zero_shot_spk('You are a helpful assistant.<|endofprompt|>'+transcript,str(reference),'alfred')
 def generate(text,speed):
  chunks=[x['tts_speech'].detach().cpu().numpy().reshape(-1) for x in model.inference_zero_shot(text,'',str(reference),zero_shot_spk_id='alfred',stream=False,speed=speed)]
  return np.concatenate(chunks),model.sample_rate
print(json.dumps({'phase':'loaded','seconds':time.monotonic()-start}),flush=True)
texts={'ack':'Good afternoon, Chris. Two agents need your answer.', 'passage':'The lighthouse keeper opened the door and looked across the quiet harbor. A small boat was returning before sunset. He lit the lamp, checked the weather, and waited for the crew to reach the dock. Everything was calm. There was plenty of time to explain the plan clearly, one step at a time.'}
results=[]
if a.only_ack:texts={'ack':texts['ack']}
for kind,text in texts.items():
 for speed in map(float,a.speeds.split(',')):
  print(json.dumps({'phase':'synthesizing','kind':kind,'speed':speed}),flush=True);start=time.monotonic()
  samples,rate=generate(text,speed);elapsed=time.monotonic()-start
  name=f'{a.engine}-alfred-{speed}-{kind}';native=out/(name+'-native.wav');sf.write(native,samples,rate,subtype='PCM_16')
  target=out/(name+'.wav')
  if a.engine=='qwen' and speed!=1:
   subprocess.run(['ffmpeg','-v','error','-y','-i',str(native),'-af',f'atempo={speed}','-ar','24000','-ac','1',str(target)],check=True)
  else:target.write_bytes(native.read_bytes())
  info=sf.info(target);result={'engine':a.engine,'kind':kind,'text':text,'speed':speed,'tempo':'ffmpeg-atempo' if a.engine=='qwen' else 'native-nonstream','inferenceSeconds':elapsed,'audioSeconds':info.duration,'rtf':elapsed/info.duration,'peakRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'streaming':False,'file':target.name}
  results.append(result);print(json.dumps({'phase':'sample',**result}),flush=True);(out/'metrics.json').write_text(json.dumps(results,indent=2))
