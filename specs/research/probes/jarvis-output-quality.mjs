// Capture only a known synthetic answer from actual browser playout. Use BB's
// configured transcription afterward to check intelligibility, not an RMS pass.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const need=n=>{if(!process.env[n])throw Error(`Set ${n}`);return process.env[n];};
const out=need('JARVIS_AUDIT_DIR'),{chromium}=await import(pathToFileURL(need('JARVIS_PLAYWRIGHT_MODULE')).href);
const text='The lighthouse keeper opened the door and looked across the quiet harbor. A small boat was returning before sunset. He lit the lamp, checked the weather, and waited for the crew to reach the dock. Everything was calm. There was plenty of time to explain the plan clearly, one step at a time.';
const result={at:new Date().toISOString(),text,errors:[]};const browser=await chromium.launch({executablePath:need('JARVIS_CHROME'),headless:true});let frame;
try{
 const page=await browser.newPage();page.on('pageerror',e=>result.errors.push(String(e)));
 await page.addInitScript(()=>{window.events=[];addEventListener('jarvis-diagnostic',e=>window.events.push(e.detail));navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const d=c.createMediaStreamDestination(),o=c.createOscillator(),g=c.createGain();g.gain.value=0;o.connect(g).connect(d);o.start();return d.stream;};});
 await page.goto(need('JARVIS_REVIEW_URL'));await page.frameLocator('iframe[title="Jarvis conversation"]').locator('#start').waitFor();frame=page.frames().find(f=>f.url().endsWith('/livekit'));
 const wait=(f,arg,timeout=90000)=>frame.waitForFunction(f,arg,{timeout});
 await frame.locator('#voice').waitFor();
 await wait(()=>!document.querySelector('#voice').disabled);
 if(process.env.JARVIS_TTS_VOICE)await frame.locator('#voice').selectOption(process.env.JARVIS_TTS_VOICE);
 if(process.env.JARVIS_TTS_SPEED)await frame.locator('#pace').selectOption(process.env.JARVIS_TTS_SPEED);
 result.speech={voice:await frame.locator('#voice').inputValue(),speed:Number(await frame.locator('#pace').inputValue())};
 await frame.locator('#start').click();await wait(()=>document.querySelector('#state').textContent==='Jarvis is speaking');
 await frame.locator('#stop').click();await wait(()=>window.events.some(e=>e.phase==='playout-ended'));await page.waitForTimeout(1000);
 if(process.env.JARVIS_MIC_OFF==='1')await frame.locator('#mic').click();
 result.microphoneOff=process.env.JARVIS_MIC_OFF==='1';
 await frame.evaluate(async()=>{
  const c=new AudioContext();await c.resume();const source=c.createMediaStreamSource(document.querySelector('#media audio').srcObject),node=c.createScriptProcessor(2048,1,1);
  window.pcm=[];window.captureRate=c.sampleRate;window.captureAudio=true;
  node.onaudioprocess=e=>{if(window.captureAudio)window.pcm.push(new Float32Array(e.inputBuffer.getChannelData(0)));e.outputBuffer.getChannelData(0).fill(0);};source.connect(node);node.connect(c.destination);window.recordingContext=c;
 });
 const start=await frame.evaluate(()=>performance.now());
 await frame.locator('#draft').fill('Read exactly this passage and no other words: '+text);await frame.locator('#send').click();
 await wait(t=>window.events.some(e=>e.phase==='response'&&e.monotonicMs>t),start);
 const response=await frame.evaluate(t=>window.events.find(e=>e.phase==='response'&&e.monotonicMs>t),start);
 result.answer=await frame.locator('#answer').textContent();assert(result.answer.trim()===text,'Only the controlled passage may be captured');
 await wait(id=>window.events.some(e=>e.phase==='playout-ended'&&e.utteranceId===id),response.utteranceId);await page.waitForTimeout(500);
 const capture=await frame.evaluate(async()=>{window.captureAudio=false;await window.recordingContext.close();return {rate:window.captureRate,samples:window.pcm.flatMap(a=>Array.from(a))};});
 // Trim only boundary silence, retaining all internal gaps.
 let first=capture.samples.findIndex(x=>Math.abs(x)>.005),last=capture.samples.findLastIndex(x=>Math.abs(x)>.005);assert(first>=0&&last>first);
 const data=capture.samples.slice(Math.max(0,first-2400),Math.min(capture.samples.length,last+2400));
 const pcm=Buffer.alloc(data.length*2);data.forEach((v,i)=>pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),i*2));
 const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(capture.rate,24);h.writeUInt32LE(capture.rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);
 fs.writeFileSync(path.join(out,'browser-known-passage.wav'),Buffer.concat([h,pcm]));result.seconds=data.length/capture.rate;result.wordsPerMinute=text.split(/\s+/).length*60/result.seconds;result.clippedFraction=data.filter(x=>Math.abs(x)>=.999).length/data.length;
 assert(result.clippedFraction<.001);assert.deepEqual(result.errors,[]);console.log(JSON.stringify({seconds:result.seconds,wordsPerMinute:result.wordsPerMinute,clippedFraction:result.clippedFraction}));
}catch(e){result.failure=String(e);console.error(e);process.exitCode=1;}
finally{if(frame){result.events=await frame.evaluate(()=>window.events).catch(()=>[]);await frame.locator('#end').click({timeout:5000}).catch(()=>{});}fs.writeFileSync(path.join(out,'output-quality.json'),JSON.stringify(result,null,2));await browser.close();}
