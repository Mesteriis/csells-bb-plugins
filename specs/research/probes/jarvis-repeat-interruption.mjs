// Real browser -> LiveKit -> STT/model/selected TTS. Generated mic; no acoustic AEC claim.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const need=n=>{if(!process.env[n])throw Error(`Set ${n}`);return process.env[n];};
const out=need('JARVIS_AUDIT_DIR');const {chromium}=await import(pathToFileURL(need('JARVIS_PLAYWRIGHT_MODULE')).href);
const browser=await chromium.launch({executablePath:need('JARVIS_CHROME'),headless:true});
const result={at:new Date().toISOString(),turns:[],errors:[],method:'Repeated barge-in with generated microphone through real services; no physical Android/AEC qualification'};let frame;
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>result.errors.push(String(e)));
 await page.addInitScript(()=>{
  window.events=[];addEventListener('jarvis-diagnostic',e=>window.events.push(e.detail));
  navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const d=c.createMediaStreamDestination(),o=c.createOscillator(),g=c.createGain();g.gain.value=0;o.connect(g).connect(d);o.start();window.capture={c,d};return d.stream;};
 });
 await page.goto(need('JARVIS_REVIEW_URL'));await page.frameLocator('iframe[title="Jarvis conversation"]').locator('#start').waitFor();frame=page.frames().find(f=>f.url().endsWith('/livekit'));
 const wait=(f,arg,timeout=60000)=>frame.waitForFunction(f,arg,{timeout});
 await frame.locator('#voice').waitFor();
 await wait(()=>!document.querySelector('#voice').disabled);
 if(process.env.JARVIS_TTS_VOICE)await frame.locator('#voice').selectOption(process.env.JARVIS_TTS_VOICE);
 if(process.env.JARVIS_TTS_SPEED)await frame.locator('#pace').selectOption(process.env.JARVIS_TTS_SPEED);
 result.speech={voice:await frame.locator('#voice').inputValue(),speed:Number(await frame.locator('#pace').inputValue())};
 await frame.locator('#start').click();await wait(()=>document.querySelector('#media audio'));
 await frame.evaluate(async()=>{
  const c=new AudioContext();await c.resume();const a=c.createAnalyser();c.createMediaStreamSource(document.querySelector('#media audio').srcObject).connect(a);window.levels=[];
  window.meter=setInterval(()=>{const f=new Float32Array(a.fftSize);a.getFloatTimeDomainData(f);window.levels.push({at:performance.now(),rms:Math.sqrt(f.reduce((s,x)=>s+x*x,0)/f.length)});},20);
 });
 for(const id of ['first','second','third']){
  await wait(()=>document.querySelector('#state').textContent==='Jarvis is speaking');await page.waitForTimeout(4500);
  assert.equal(await frame.locator('#state').textContent(),'Jarvis is speaking','Need to inject while ongoing speech plays');
  await wait(()=>window.levels?.slice(-5).length===5&&window.levels.slice(-5).every(x=>x.rms>.005),undefined,20000);
  assert.equal(await frame.locator('#state').textContent(),'Jarvis is speaking','Require decoded speech immediately before injection');
  const prior=await frame.evaluate(()=>window.events.filter(e=>e.phase==='response').at(-1));
  const bytes=fs.readFileSync(path.join(out,id+'.wav')).toString('base64');
  const start=await frame.evaluate(async b=>{const {c,d}=window.capture,s=c.createBufferSource();s.buffer=await c.decodeAudioData(Uint8Array.from(atob(b),x=>x.charCodeAt(0)).buffer);s.connect(d);s.start();return performance.now();},bytes);
  const turn={id,start,prior:prior?.utteranceId,audibleBeforeInjection:true};result.turns.push(turn);
  await wait(t=>window.events.some(e=>e.phase==='user-state'&&e.state==='speaking'&&e.monotonicMs>t),start,15000);
  await wait(t=>window.events.some(e=>e.phase==='agent-state'&&e.state==='listening'&&e.monotonicMs>t),start,15000);
  const signal=await frame.evaluate(t=>window.events.find(e=>e.phase==='agent-state'&&e.state==='listening'&&e.monotonicMs>t),start);
  turn.onsetToListeningMs=Math.round(signal.monotonicMs-start);
  // Framework state must correspond to decoded output silence, not just a label.
  await wait(t=>{const l=window.levels.filter(x=>x.at>t).slice(-8);return l.length===8&&l.every(x=>x.rms<.003);},start,3000);
  turn.onsetToQuietMs=await frame.evaluate(t=>Math.round(window.levels.at(-8).at-t),start);
  assert(turn.onsetToQuietMs<1500,'Barge-in did not stop decoded audio promptly');
  await wait(t=>window.events.some(e=>e.phase==='transcribed'&&e.monotonicMs>t),start,30000);
  await wait(t=>window.events.some(e=>e.phase==='response'&&e.monotonicMs>t),start,60000);
  turn.transcript=await frame.locator('#heard').textContent();turn.answer=await frame.locator('#answer').textContent();
  assert(new RegExp(id==='first'?'lighthouse':id==='second'?'mountain':'forest','i').test(turn.transcript),'STT must preserve the directed topic');
  const reply=await frame.evaluate(t=>window.events.find(e=>e.phase==='response'&&e.monotonicMs>t),start);
  assert(reply.kind==='reply'&&reply.utteranceId!==prior?.utteranceId&&turn.answer.trim().length>80,'A new substantial reply must follow the interruption');
  turn.within250msTarget=turn.onsetToQuietMs<=250;turn.pass=true;console.log(JSON.stringify({id,pass:true,onsetToQuietMs:turn.onsetToQuietMs}));
 }
 result.interruptionTargetMet=result.turns.every(t=>t.within250msTarget);
 assert.equal(await frame.locator('#error').textContent(),'');assert.deepEqual(result.errors,[]);
 if(process.env.JARVIS_EXPECT_INPUT_METRICS==='1'){
  const events=await frame.evaluate(()=>window.events);
  for(const turn of result.turns)assert(events.some(e=>e.phase==='input-audio'&&e.monotonicMs>turn.start&&e.monotonicMs<turn.start+7000&&e.inputRms>.01),'Server input levels must show injected speech');
  const mic=events.filter(e=>e.event==='microphone-stats');assert(mic.length>1&&mic.at(-1).inputBytesSent>mic[0].inputBytesSent,'Browser input transmission counters must advance');
  result.inputTelemetryVerified=true;
 }

}catch(error){result.failure=String(error);console.error(error);process.exitCode=1;}
finally{if(frame){result.events=await frame.evaluate(()=>window.events).catch(()=>[]);await frame.locator('#end').click({timeout:5000}).catch(()=>{});}fs.writeFileSync(path.join(out,'repeated-interruptions.json'),JSON.stringify(result,null,2));await browser.close();}
