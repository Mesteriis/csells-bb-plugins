import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {initializeLogger} from '@livekit/agents';
import {LocalTTS} from '../dist/local-tts.js';
initializeLogger({pretty:false,level:'error'});
// Protocol tests only; real engines and browser acceptance are separately required.
test('local PCM survives fragmented framing and preserves the exact sample count',async()=>{
 const pcm=Buffer.alloc(960,7),header=Buffer.alloc(4);header.writeUInt32BE(pcm.length);
 const server=createServer(async(req,res)=>{let body='';for await(const p of req)body+=p;assert.equal(JSON.parse(body).speed,1.4);res.writeHead(200,{'content-type':'application/x-jarvis-pcm'});res.write(header.subarray(0,1));res.write(header.subarray(1));res.write(pcm.subarray(0,53));res.write(pcm.subarray(53));res.end(Buffer.alloc(4));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const tts=new LocalTTS(`http://127.0.0.1:${server.address().port}/speech`,'test','test',1.4);const stream=tts.synthesize('A protocol test.');let samples=0;for await(const item of stream)samples+=item.frame.samplesPerChannel;assert.equal(samples,480);await tts.close();}
 finally{server.close();server.closeAllConnections();}
});
test('cancelling a synthesis disconnects its inference request',async()=>{
 let disconnected;const closed=new Promise(r=>disconnected=r);let sent;const received=new Promise(r=>sent=r);
 const server=createServer((req,res)=>{req.resume();res.on('close',disconnected);sent();});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const tts=new LocalTTS(`http://127.0.0.1:${server.address().port}/speech`,'test','test',1.25);const errors=[];tts.on('error',e=>errors.push(e));const abort=new AbortController(),stream=tts.synthesize('Cancel me.',undefined,abort.signal);const read=stream.next().catch(()=>{});await received;abort.abort();await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Request did not disconnect')),2000))]);await stream.close();await read;assert.deepEqual(errors,[]);await tts.close();}
 finally{server.close();server.closeAllConnections();}
});
test('parallel LiveKit sentence requests are serialized; canceled queued work never reaches the engine',async()=>{
 const local=new LocalTTS('http://127.0.0.1:4850/speech','test','test',1.25),a=new AbortController(),b=new AbortController();
 const release=await local.acquire(a.signal);let entered=false;
 const cancelled=local.acquire(b.signal);b.abort();await assert.rejects(cancelled);
 const next=local.acquire(a.signal).then(r=>{entered=true;r();});await new Promise(r=>setTimeout(r,10));assert.equal(entered,false);release();await next;assert.equal(entered,true);await local.close();
});
