// Startup acceptance: actual trusted click -> first decoded non-silent output.
// Real staging services, synthetic silent mic; not physical speaker latency.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const need=n=>{if(!process.env[n])throw Error(`Set ${n}`);return process.env[n];};
const out=need('JARVIS_AUDIT_DIR');fs.mkdirSync(out,{recursive:true});
const {chromium}=await import(pathToFileURL(need('JARVIS_PLAYWRIGHT_MODULE')).href);
const browser=await chromium.launch({executablePath:need('JARVIS_CHROME'),headless:true});let frame;
const result={at:new Date().toISOString(),targetMs:1000,voice:need('JARVIS_TTS_VOICE'),method:'Trusted Start click to first decoded non-silent WebRTC sample; actual dynamic BB briefing; synthetic silent microphone',errors:[]};
try{
 const page=await browser.newPage();page.on('pageerror',e=>result.errors.push(String(e)));
 await page.addInitScript(()=>{window.events=[];addEventListener('jarvis-diagnostic',e=>window.events.push(e.detail));navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const d=c.createMediaStreamDestination(),o=c.createOscillator(),g=c.createGain();g.gain.value=0;o.connect(g).connect(d);o.start();return d.stream;};});
 await page.goto(need('JARVIS_REVIEW_URL'));await page.frameLocator('iframe[title="Jarvis conversation"]').locator('#start').waitFor();frame=page.frames().find(f=>f.url().endsWith('/livekit'));
 await frame.waitForFunction(()=>!document.querySelector('#voice').disabled);await frame.locator('#voice').selectOption(result.voice);await frame.locator('#pace').selectOption('1.4');
 await frame.evaluate(()=>{
  document.querySelector('#start').addEventListener('click',e=>{window.startClickAt=performance.now();window.startTrusted=e.isTrusted;},{capture:true,once:true});
  let meter;
  window.startMeterTimer=setInterval(()=>{
   const audio=document.querySelector('#media audio');if(!audio?.srcObject)return;
   if(!meter){const c=new AudioContext();void c.resume();const a=c.createAnalyser();a.fftSize=512;c.createMediaStreamSource(audio.srcObject).connect(a);meter={c,a};window.startMeterContext=c;}
   const data=new Float32Array(meter.a.fftSize);meter.a.getFloatTimeDomainData(data);const rms=Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length);
   if(rms>.005&&window.firstAudioAt===undefined)window.firstAudioAt=performance.now();
  },10);
 });
 await frame.locator('#start').click();
 await frame.waitForFunction(()=>window.firstAudioAt!==undefined||document.querySelector('#error').textContent,undefined,{timeout:90000});
 Object.assign(result,await frame.evaluate(()=>({clickAt:window.startClickAt,trustedClick:window.startTrusted,firstAudioAt:window.firstAudioAt,error:document.querySelector('#error').textContent})));
 assert.equal(result.error,'');assert(result.trustedClick);result.clickToAudioMs=Math.round(result.firstAudioAt-result.clickAt);result.pass=result.clickToAudioMs<result.targetMs;console.log(JSON.stringify(result));assert(result.pass,'Start-to-first-decoded-audio must be under 1000 ms');
}catch(error){result.failure=String(error);process.exitCode=1;console.error(String(error));}
finally{if(frame){result.events=await frame.evaluate(()=>window.events).catch(()=>[]);await frame.locator('#end').click({timeout:5000}).catch(()=>{});await frame.evaluate(()=>{clearInterval(window.startMeterTimer);return window.startMeterContext?.close();}).catch(()=>{});}fs.writeFileSync(path.join(out,'start-latency.json'),JSON.stringify(result,null,2));await browser.close();}
