import {createServer} from 'node:http';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
const worker=new Worker(new URL('./kokoro-worker.mjs',import.meta.url),{workerData:{cache:process.env.MODEL_CACHE??'./model-cache'}});
let ready=false,active;const queue=[];
const log=(phase,detail={})=>console.log(JSON.stringify({at:new Date().toISOString(),phase,...detail}));
const next=()=>{if(active||!ready)return;while(queue.length){const job=queue.shift();if(job.cancelled){clearTimeout(job.timer);continue;}active=job;worker.postMessage(job.payload);return;}};
worker.on('message',m=>{
 if(m.phase){log(m.phase,m);if(m.phase==='ready'){ready=true;next();}return;}
 if(!active||active.payload.id!==m.id)throw Error('Inference response lost ownership');
 const job=active;active=undefined;clearTimeout(job.timer);
 if(m.error)job.reject(Error(m.error));else job.resolve(m);
 log('inference',{id:m.id,ms:m.ms,cancelled:job.cancelled,audioMs:m.pcm?.byteLength/48});next();
});
worker.on('error',error=>{log('worker-error',{error:String(error)});process.exit(1);});
worker.on('exit',code=>{if(code)process.exit(code);});
function infer(payload,signal){return new Promise((resolve,reject)=>{
 const job={payload,resolve,reject,cancelled:false};
 const abort=()=>{job.cancelled=true;if(job!==active)clearTimeout(job.timer);reject(Error('Cancelled'));};
 signal.addEventListener('abort',abort,{once:true});
 job.resolve=m=>{signal.removeEventListener('abort',abort);resolve(m);};
 job.reject=e=>{signal.removeEventListener('abort',abort);reject(e);};
 job.timer=setTimeout(()=>{log('inference-timeout',{id:payload.id});process.exit(1);},60000);
 if(signal.aborted){clearTimeout(job.timer);return abort();}
 queue.push(job);next();
});}
// Small bounded phrase sizes avoid the upstream tokenizer's silent truncation.
function segments(text){const words=text.trim().split(/\s+/),out=[];let current='';for(const word of words){if(word.length>120)throw Error('Unpronounceable token');if(current.length+word.length>240){out.push(current);current='';}current+=(current?' ':'')+word;}if(current)out.push(current);return out;}
const server=createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/health'){res.writeHead(ready?200:503,{'content-type':'application/json'});res.end(JSON.stringify({ready,engine:'kokoro',active:!!active,queued:queue.length}));return;}
 if(req.method!=='POST'||req.url!=='/speech'){res.writeHead(404);res.end();return;}
 const abort=new AbortController();res.on('close',()=>{if(!res.writableFinished)abort.abort();});
 try{
  if(!ready)throw Error('Model warming');if(queue.length>2)throw Error('Inference busy');
  let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>16384)throw Error('Request too large');parts.push(part);}
  const {text,voice,speed}=JSON.parse(Buffer.concat(parts));
  if(typeof text!=='string'||!text.trim()||text.length>8000||!['bm_george','bm_fable'].includes(voice)||![1,1.25,1.4].includes(speed))throw Error('Invalid speech request');
  const pieces=segments(text);res.writeHead(200,{'content-type':'application/x-jarvis-pcm','x-audio-format':'s16le;rate=24000;channels=1'});
  for(const piece of pieces){
   if(abort.signal.aborted)break;
   const m=await infer({id:randomUUID(),text:piece,voice,speed},abort.signal);if(abort.signal.aborted)break;
   if(m.sampleRate!==24000)throw Error('Unexpected model rate');
   const pcm=Buffer.from(m.pcm);for(let offset=0;offset<pcm.length;offset+=48000){const chunk=pcm.subarray(offset,offset+48000),header=Buffer.alloc(4);header.writeUInt32BE(chunk.length);if(!res.write(Buffer.concat([header,chunk])))await once(res,'drain',{signal:abort.signal});}
  }
  if(!abort.signal.aborted)res.end(Buffer.alloc(4));
 }catch(error){log('request-error',{error:String(error),cancelled:abort.signal.aborted});if(!res.headersSent){res.writeHead(503);res.end('Local synthesis unavailable');}else res.destroy();}
});
server.listen(Number(process.env.PORT??4850),'127.0.0.1',()=>log('listening'));
