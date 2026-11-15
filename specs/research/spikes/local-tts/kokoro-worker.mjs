import {parentPort,workerData} from 'node:worker_threads';
import {KokoroTTS} from 'kokoro-js';
import {env} from '@huggingface/transformers';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
env.cacheDir=workerData.cache+'/1939ad2a8e416c0acfeecc08a694d14ef25f2231';
// Pin model resolution instead of fetching a moving main branch.
env.remotePathTemplate='{model}/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/';
const started=performance.now();
const model=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'fp32',device:'cpu',progress_callback:p=>{if(p.status==='done')parentPort.postMessage({phase:'downloaded',file:p.file});}});
const hash=createHash('sha256');
for await(const bytes of createReadStream(`${env.cacheDir}/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx`))hash.update(bytes);
const sha256=hash.digest('hex');
if(sha256!=='8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb')throw Error('Pinned Kokoro model hash mismatch');
parentPort.postMessage({phase:'model-verified',sha256});
parentPort.postMessage({phase:'ready',loadMs:performance.now()-started});
parentPort.on('message',async ({id,text,voice,speed})=>{
 const start=performance.now();
 try {
  const result=await model.generate(text,{voice,speed});
  const pcm=new Int16Array(result.audio.length);
  for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(Math.max(-1,Math.min(1,result.audio[i]))*32767);
  parentPort.postMessage({id,pcm:pcm.buffer,sampleRate:result.sampling_rate,ms:performance.now()-start},[pcm.buffer]);
 }catch(error){parentPort.postMessage({id,error:String(error)});}
});
