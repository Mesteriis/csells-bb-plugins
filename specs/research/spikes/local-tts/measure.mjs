import {mkdir,writeFile} from 'node:fs/promises';
const model=process.env.MODEL??'kokoro-fp32';const folder=process.env.OUT??'samples';await mkdir(folder,{recursive:true});
const passage='The lighthouse keeper opened the door and looked across the quiet harbor. A small boat was returning before sunset. He lit the lamp, checked the weather, and waited for the crew to reach the dock. Everything was calm. There was plenty of time to explain the plan clearly, one step at a time.';
const tests=[['ack','Good afternoon, Chris. Two agents need your answer.'],['passage',passage],['technical','The Jarvis pull request is ready. Three tests passed. Version two point four starts at three thirty. The staging server is healthy.']];
const prepared=await fetch('http://127.0.0.1:4850/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model}),signal:AbortSignal.timeout(55000)});if(!prepared.ok)throw Error('Engine did not become ready');
const results=[];
for(const voice of (model==='kokoro-fp32'?['bm_george','bm_fable']:['alfred']))for(const speed of [1.25,1.4])for(const [kind,text] of tests){
 const id=`${model==='kokoro-fp32'?'':model+'-'}${voice}-${speed}-${kind}`;console.log(JSON.stringify({phase:'start',id}));const start=performance.now();let firstMs;let carry=Buffer.alloc(0),ended=false;const audio=[];
 const response=await fetch('http://127.0.0.1:4850/speech',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,text,voice,speed}),signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error(`Speech HTTP ${response.status}`);
 for await(const bytes of response.body){carry=Buffer.concat([carry,bytes]);while(carry.length>=4){const len=carry.readUInt32BE();if(!len){ended=true;break;}if(carry.length<len+4)break;if(firstMs===undefined)firstMs=performance.now()-start;audio.push(carry.subarray(4,4+len));carry=carry.subarray(4+len);}if(ended)break;}
 if(!ended)throw Error('Incomplete PCM');const pcm=Buffer.concat(audio);if(!pcm.length)throw Error('Empty speech');const seconds=pcm.length/48000,elapsedMs=performance.now()-start;
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
 await writeFile(`${folder}/${id}.wav`,Buffer.concat([header,pcm]));
 const r={id,model,text,voice,speed,seconds,firstMs,elapsedMs,rtf:elapsedMs/1000/seconds};results.push(r);console.log(JSON.stringify({phase:'sample',...r}));await writeFile(`${folder}/metrics.json`,JSON.stringify(results,null,2));
}
