import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeLogger, voice} from '@livekit/agents';
import {SpeechCatalog} from '../dist/speech.js';
import {JarvisAgent,AlfredAgent} from '../dist/relay.js';
initializeLogger({pretty:false,level:'error'});
const config={defaultVoice:'cartesia',voices:[
 {id:'cartesia',label:'Cartesia · Daniel',provider:'cartesia',voice:'47c38ca4-5f35-497b-b1a3-415245fb35e1',model:'sonic-3.6-2026-08-27'},
 {id:'inworld',label:'Inworld · Dennis',provider:'inworld',voice:'Dennis',model:'inworld-tts-2'},
]};
test('missing credentials remain visible and never silently select a different provider',()=>{
 const catalog=new SpeechCatalog(config,{});
 assert.equal(catalog.describe().voices[0].available,false);
 assert.throws(()=>catalog.select({}),/Cartesia.*not configured/);
});
test('untrusted selection cannot supply a model, URL, credential or out-of-range speed',()=>{
 const catalog=new SpeechCatalog(config,{CARTESIA_API_KEY:'test-only',INWORLD_API_KEY:'test-only'});
 for(const speed of [0,1.6,NaN,'1.25',null])assert.throws(()=>catalog.select({speed}),/pace/);
 assert.throws(()=>catalog.select({voice:'https://attacker.example'}),/Unknown voice/);
 const selected=catalog.select({voice:'cartesia',speed:1.4,model:'untrusted',apiKey:'untrusted',baseUrl:'https://attacker.example'});
 assert.equal(selected.model,config.voices[0].model);assert.equal(selected.speed,1.4);
 const publicData=JSON.stringify(catalog.describe());assert(!publicData.includes('test-only'));assert(!publicData.includes('API_KEY'));
});
test('both official providers build with the configured model and a brisk default',async()=>{
 const catalog=new SpeechCatalog(config,{CARTESIA_API_KEY:'test-only',INWORLD_API_KEY:'test-only'});
 for(const id of ['cartesia','inworld']){
  const selected=catalog.select({voice:id});assert.equal(selected.speed,1.25);
  const tts=catalog.create(selected);if(id==='cartesia')assert.equal(tts.model,selected.model);assert.equal(tts.capabilities.streaming,true);await tts.close();
 }
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
