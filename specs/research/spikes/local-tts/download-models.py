import sys,json,time
from huggingface_hub import snapshot_download
models={'qwen':('Qwen/Qwen3-TTS-12Hz-0.6B-Base','5d83992436eae1d760afd27aff78a71d676296fc',[]),'cosyvoice':('FunAudioLLM/Fun-CosyVoice3-0.5B-2512','29e01c4e8d000f4bcd70751be16fa94bf3d85a18',['llm.rl.pt','speech_tokenizer_v3.batch.onnx','flow.decoder.estimator.fp32.onnx'])}
for name in sys.argv[1:]:
 repo,revision,exclude=models[name];print(json.dumps({'phase':'download','engine':name,'repo':repo,'revision':revision}),flush=True)
 path=snapshot_download(repo,revision=revision,local_dir='models/'+name,ignore_patterns=exclude,max_workers=2)
 print(json.dumps({'phase':'downloaded','engine':name,'path':path}),flush=True)
