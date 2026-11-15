import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeLogger, voice} from '@livekit/agents';
import {SpeechCatalog} from '../dist/speech.js';
import {JarvisAgent,AlfredAgent} from '../dist/relay.js';
initializeLogger({pretty:false,level:'error'});
const config={defaultVoice:'kokoro',voices:[
 {id:'kokoro',label:'Kokoro · George',provider:'self-hosted',voice:'bm_george',model:'kokoro-fp32',endpoint:'http://127.0.0.1:4850/speech'},
 {id:'qwen',label:'Qwen · Alfred',provider:'self-hosted',voice:'alfred',model:'qwen3-tts',endpoint:'http://127.0.0.1:4851/speech',available:false},
]};
test('unready local engines remain visible and never silently fall back',()=>{
 const catalog=new SpeechCatalog(config);
 assert.equal(catalog.describe().voices[1].available,false);
 assert.throws(()=>catalog.select({voice:'qwen'}),/not ready/);
});
test('untrusted selection cannot supply a model, URL, credential or pace',()=>{
 const catalog=new SpeechCatalog(config);
 for(const speed of [0,1.6,NaN,'1.25',null])assert.throws(()=>catalog.select({speed}),/pace/);
 assert.throws(()=>catalog.select({voice:'https://attacker.example'}),/Unknown voice/);
 const selected=catalog.select({voice:'kokoro',speed:1.4,model:'untrusted',apiKey:'untrusted',endpoint:'https://attacker.example'});
 assert.equal(selected.model,config.voices[0].model);assert.equal(selected.speed,1.4);
 assert(!JSON.stringify(selected).includes('127.0.0.1'));assert(!JSON.stringify(catalog.describe()).includes('127.0.0.1'));
 assert.throws(()=>new SpeechCatalog({...config,voices:[{...config.voices[0],endpoint:'https://provider.example/speech'}]}),/loopback/);
});
test('local engine uses a brisk default and honest sentence streaming capability',async()=>{
 const catalog=new SpeechCatalog(config),selected=catalog.select({voice:'kokoro'});
 assert.equal(selected.speed,1.25);
 const tts=catalog.create(selected);assert.equal(tts.modelId,selected.model);assert.equal(tts.capabilities.streaming,false);await tts.close();
});
test('ordinary replies inherit LiveKit synthesis and proactive questions use that same session TTS',async()=>{
 assert.equal(JarvisAgent.prototype.ttsNode,voice.Agent.prototype.ttsNode);
 const calls=[],state={utterance:{id:'question-1',text:'Which branch?',playbackClaim:'claim'}};
 const speech={waitForPlayout:async()=>{calls.push('played');}};
 const agent={relay:{present:s=>calls.push(['present',s]),track:(s,h)=>calls.push(['track',s,h])},session:{say:(text,options)=>{calls.push(['say',text,options]);return speech;}}};
 await JarvisAgent.prototype.speakState.call(agent,state);
 assert.deepEqual(calls[1],['say','Which branch?',{allowInterruptions:true}]);
 assert.equal(calls[2][2],speech);assert.equal(calls.at(-1),'played');
});
test('legacy proactive speech still supplies audio when its session has no provider TTS',async()=>{
 const audio=new ReadableStream({start(c){c.close();}});let said;
 const agent={relay:{present(){},track(){}},ttsNode:async()=>audio,session:{say:(_text,options)=>{said=options;return {waitForPlayout:async()=>{}};}}};
 await AlfredAgent.prototype.speakState.call(agent,{utterance:{text:'A briefing'}});
 assert.equal(said.audio,audio);assert.equal(said.allowInterruptions,true);
});
test('readiness checks the configured engine and rejects failure before conversation',async()=>{
 const {createServer}=await import('node:http');
 let status=200,request;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;request={path:req.url,body:JSON.parse(body)};res.writeHead(status);res.end('{}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const catalog=new SpeechCatalog({defaultVoice:'kokoro',voices:[{...config.voices[0],endpoint:`http://127.0.0.1:${server.address().port}/speech`}]});
  const selected=catalog.select({});await catalog.prepare(selected);
  assert.deepEqual(request,{path:'/prepare',body:{model:'kokoro-fp32'}});
  status=503;await assert.rejects(()=>catalog.prepare(selected),/could not become ready/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
