import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReadableStream} from 'node:stream/web';
import {AudioFrame} from '@livekit/rtc-node';
import {decodePCM,wav} from '../dist/relay.js';
function body(bytes,split=1){let at=0;return new ReadableStream({pull(c){if(at===bytes.length)c.close();else{c.enqueue(bytes.subarray(at,at+split));at=Math.min(bytes.length,at+split);}}});}
test('framed PCM survives arbitrary HTTP chunk boundaries without losing samples',async()=>{
 const pcm=Buffer.alloc(4810);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(i-1200,i*2);
 const size=Buffer.alloc(4);size.writeUInt32BE(pcm.length);
 const frames=[];for await(const f of decodePCM(body(Buffer.concat([size,pcm,Buffer.alloc(4)]),7)))frames.push(f);
 assert.equal(frames.length,6);
 assert.deepEqual(frames.flatMap(f=>[...f.data]),Array.from({length:2405},(_,i)=>i-1200));
});
test('truncated or malformed provider streams fail instead of silently skipping audio',async()=>{
 for(const bytes of [Buffer.from([0,0,0,3,1,2,3]),Buffer.from([0,0,0,4,1,2]),Buffer.from([0,0,0,2,1,2])]){
  await assert.rejects(async()=>{for await(const _ of decodePCM(body(bytes))){};});
 }
});
test('batch transcription WAV matches the real frame format and sample count',()=>{
 const out=wav(new AudioFrame(new Int16Array([-1,0,1]),16000,1,3));
 assert.equal(out.readUInt32LE(24),16000);assert.equal(out.readUInt32LE(40),6);assert.equal(out.readInt16LE(44),-1);assert.equal(out.length,50);
});
