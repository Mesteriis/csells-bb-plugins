// One GPU engine at a time. Python stays inside upstream inference workers.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
const root=process.env.ENGINE_ROOT??'/home/tester/jarvis/python-spikes';
const engines={'qwen3-tts-0.6b':{env:'qwen-env',arg:'qwen'},cosyvoice3:{env:'cosy-env',arg:'cosyvoice'}};
let child,loaded,starting,startingModel;
const log=(phase,fields={})=>console.log(JSON.stringify({at:new Date().toISOString(),phase,...fields}));
async function stop(){if(!child)return;const old=child;child=undefined;loaded=undefined;if(old.exitCode!==null)return;const exited=once(old,'exit');old.kill('SIGTERM');const timer=setTimeout(()=>old.kill('SIGKILL'),5000);try{await exited;}finally{clearTimeout(timer);}}
async function prepare(model){
 if(model==='kokoro-fp32'){const r=await fetch('http://127.0.0.1:4854/health');if(!r.ok)throw Error('Kokoro is warming');return;}
 if(!engines[model])throw Error('Unknown engine');if(loaded===model)return;
 if(starting){if(startingModel!==model)throw Error('Another engine is loading');return starting;}
 startingModel=model;starting=(async()=>{
  await stop();const spec=engines[model];const proc=spawn(`${root}/${spec.env}/bin/python`,['-u',`${root}/engine-server.py`,spec.arg],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TOKENIZERS_PARALLELISM:'false'}});child=proc;
  proc.stderr.on('data',b=>process.stderr.write(b));
  const lines=createInterface({input:proc.stdout});
  const ready=new Promise((resolve,reject)=>{
   proc.once('error',reject);proc.once('exit',code=>{if(child===proc){child=undefined;loaded=undefined;}reject(Error(`Engine exited (${code})`));});
   lines.on('line',line=>{try{const data=JSON.parse(line);log('engine',data);if(data.phase==='ready'){loaded=model;resolve();}}catch{process.stderr.write(`[${model}] ${line}\n`);}});
  });
  const timer=setTimeout(()=>proc.kill('SIGKILL'),45000);try{await ready;}finally{clearTimeout(timer);}
 })();try{await starting;}finally{starting=undefined;startingModel=undefined;}
}
const server=createServer(async(req,res)=>{
 const abort=new AbortController();res.on('close',()=>{if(!res.writableFinished)abort.abort();});
 try{
  if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ready:true,gpuEngine:loaded??null,loading:startingModel??null}));return;}
  if(req.method!=='POST'||!['/prepare','/speech'].includes(req.url)){res.writeHead(404);res.end();return;}
  let size=0;const parts=[];for await(const p of req){size+=p.length;if(size>16384)throw Error('Request too large');parts.push(p);}const payload=Buffer.concat(parts),body=JSON.parse(payload);
  await prepare(body.model);if(abort.signal.aborted)return;
  if(req.url==='/prepare'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ready:true,model:body.model}));return;}
  const upstream=await fetch(`http://127.0.0.1:${body.model==='kokoro-fp32'?4854:4853}/speech`,{method:'POST',headers:{'content-type':'application/json'},body:payload,signal:abort.signal});
  if(!upstream.ok){await upstream.body?.cancel();throw Error(`Engine returned ${upstream.status}`);}
  res.writeHead(200,{'content-type':'application/x-jarvis-pcm'});
  for await(const bytes of upstream.body){if(!res.write(bytes))await once(res,'drain',{signal:abort.signal});}res.end();
 }catch(error){if(!abort.signal.aborted)log('request-failed',{reason:String(error)});if(!res.headersSent){res.writeHead(503);res.end('Local voice not ready');}else res.destroy();}
});
server.listen(4850,'127.0.0.1',()=>log('broker-ready'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();void stop().finally(()=>process.exit(0));});
