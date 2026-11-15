// Real candidate audit, not a mock service test. Requires an idle staging voice
// session, configured real BB/model/Alfred, Playwright and known WAV inputs.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const required=n=>{if(!process.env[n])throw Error(`Set ${n}`);return process.env[n];};
const {chromium}=await import(pathToFileURL(required('JARVIS_PLAYWRIGHT_MODULE')).href);
const out=required('JARVIS_AUDIT_DIR'),base=required('JARVIS_REVIEW_URL');
if(process.env.JARVIS_TEST_OWNED_WORK!=='1')throw Error('Confirm this is disposable staging and all relay-owned work is test-owned: JARVIS_TEST_OWNED_WORK=1');
const cases=JSON.parse(fs.readFileSync(new URL('./jarvis-audit-cases.json',import.meta.url)));
const result={sourceRevision:process.env.JARVIS_SOURCE_REVISION,at:new Date().toISOString(),method:'Real BB panel, LiveKit/TURN, configured STT, real model and Alfred; generated microphone fixture, not physical Android/AEC acceptance',checks:[],turns:[],pageErrors:[]};
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:required('JARVIS_CHROME'),headless:true});
result.browser=browser.version();
let page,frame;
const write=()=>fs.writeFileSync(path.join(out,'browser-audit.json'),JSON.stringify(result,null,2));
async function wait(fn,arg,timeout=45000){return frame.waitForFunction(fn,arg,{timeout});}
async function events(){return frame.evaluate(()=>window.auditEvents);}
try{
 page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>result.pageErrors.push(String(e)));
 await page.addInitScript(()=>{
  window.auditEvents=[];addEventListener('jarvis-diagnostic',e=>window.auditEvents.push(e.detail));
  navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const d=c.createMediaStreamDestination(),osc=c.createOscillator(),g=c.createGain();g.gain.value=0;osc.connect(g).connect(d);osc.start();window.fixture={c,d};return d.stream;};
 });
 await page.goto(base);await page.frameLocator('iframe[title="Jarvis conversation"]').locator('#start').waitFor();frame=page.frames().find(f=>f.url().endsWith('/livekit'));
 result.checks.push({id:'phone-layout',pass:await frame.evaluate(()=>document.body.scrollWidth<=innerWidth)});
 await frame.locator('#start').click();await wait(()=>document.querySelector('#media audio'));
 await frame.evaluate(async()=>{const c=new AudioContext();await c.resume();const a=c.createAnalyser();c.createMediaStreamSource(document.querySelector('#media audio').srcObject).connect(a);window.levels=[];window.meter=setInterval(()=>{const f=new Float32Array(a.fftSize);a.getFloatTimeDomainData(f);window.levels.push({at:performance.now(),rms:Math.sqrt(f.reduce((s,x)=>s+x*x,0)/f.length)});},20);});
 await wait(()=>window.auditEvents.some(e=>e.phase==='response'),null,90000);
 await wait(()=>window.levels.some(l=>l.rms>.005));result.checks.push({id:'start-brief-audio',pass:true});
 // Stop work is required even while a briefing is playing. All work currently
 // owned by this staging relay must be test-owned before running this probe.
 const busyStart=await frame.evaluate(()=>performance.now());await frame.locator('#stop-work').click();
 await page.waitForTimeout(1500);
 const busy=await frame.evaluate(t=>({events:window.auditEvents.filter(e=>e.monotonicMs>=t),error:document.querySelector('#error').textContent,answer:document.querySelector('#answer').textContent}),busyStart);
 result.checks.push({id:'stop-work-during-briefing',pass:/requested stop/.test(busy.answer)&&!busy.events.some(e=>e.phase==='error'),observedError:busy.error});
 await frame.locator('#stop').click();await page.waitForTimeout(600);
 // Isolate conversational latency from unsolicited real-thread updates.
 if(!/updates quiet/.test(await frame.locator('#mode').textContent())){
  await frame.locator('#quiet').click();await wait(()=>/updates quiet/.test(document.querySelector('#mode').textContent));await frame.locator('#stop').click();await page.waitForTimeout(600);
 }
 const second=await browser.newPage();await second.goto(base);const f2=second.frameLocator('iframe[title="Jarvis conversation"]');await f2.locator('#text-start').click();await f2.locator('#error').filter({hasText:/already active/}).waitFor();result.checks.push({id:'second-owner-rejected',pass:true});await second.close();
 for(let round=0;round<3;round++)for(const c of cases){
  const turn={id:c.id,round:round+1};result.turns.push(turn);
  try{
   await wait(()=>!['Jarvis is thinking…','Jarvis is speaking'].includes(document.querySelector('#state').textContent));
   const bytes=fs.readFileSync(path.join(out,c.id+'.wav')).toString('base64');
   turn.inputAt=await frame.evaluate(async b=>{const {c,d}=window.fixture,s=c.createBufferSource();s.buffer=await c.decodeAudioData(Uint8Array.from(atob(b),x=>x.charCodeAt(0)).buffer);s.connect(d);s.start();return performance.now();},bytes);
   await wait(t=>window.auditEvents.some(e=>e.monotonicMs>t&&e.phase==='transcribed'),turn.inputAt);
   await wait(t=>window.auditEvents.some(e=>e.monotonicMs>t&&e.phase==='response'),turn.inputAt);
   const response=(await events()).find(e=>e.monotonicMs>turn.inputAt&&e.phase==='response');
   turn.answer=await frame.locator('#answer').textContent();turn.transcript=await frame.locator('#heard').textContent();turn.responseId=response.utteranceId;
   await wait(id=>window.auditEvents.some(e=>e.phase==='playout-ended'&&e.utteranceId===id),turn.responseId);
   const data=await frame.evaluate(t=>({events:window.auditEvents.filter(e=>e.monotonicMs>t),levels:window.levels.filter(l=>l.at>t)}),turn.inputAt);
   const end=data.events.find(e=>e.phase==='user-state'&&e.state==='listening');const stt=data.events.find(e=>e.phase==='transcribed');const firstAudio=data.levels.find(l=>l.at>response.monotonicMs&&l.rms>.005);
   turn.endToAudioMs=end&&firstAudio?Math.round(firstAudio.at-end.monotonicMs):null;turn.sttMs=stt?.durationMs;turn.audio=!!firstAudio;
   turn.responseCount=data.events.filter(e=>e.phase==='response').length;
   turn.pass=new RegExp(`\\b(?:${c.expect})\\b`,'i').test(turn.answer)&&turn.audio&&turn.responseCount===1&&!data.events.some(e=>e.phase==='error');
  }catch(e){turn.pass=false;turn.failure=String(e);await frame.locator('#stop').click().catch(()=>{});}
  console.log(JSON.stringify({id:turn.id,round:turn.round,pass:turn.pass,endToAudioMs:turn.endToAudioMs,failure:turn.failure}));write();
 }
 await frame.locator('#mic').click();await frame.locator('#draft').fill('What is six plus six? Answer only the number.');const typedAt=await frame.evaluate(()=>performance.now());await frame.locator('#send').click();
 await wait(t=>window.auditEvents.some(e=>e.monotonicMs>t&&e.phase==='response'),typedAt);await wait(t=>window.levels.some(l=>l.at>t&&l.rms>.005),typedAt);
 const captureOff=await frame.locator('#mic').textContent()==='Microphone on';
 result.checks.push({id:'typed-with-microphone-off',pass:/\b(?:12|twelve)\b/i.test(await frame.locator('#answer').textContent())&&captureOff,captureOff});
 await frame.locator('#end').click();
 // Fault injection tests browser recovery only; no synthetic model/service.
 const fault=await browser.newPage();await fault.route('**/livekit-session',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Injected voice companion unavailable'})}));await fault.goto(base);const ff=fault.frameLocator('iframe[title="Jarvis conversation"]');await ff.locator('#text-start').click();await ff.locator('#error').filter({hasText:/unavailable/}).waitFor();
 result.checks.push({id:'typed-fallback-voice-service-unavailable',pass:await ff.locator('#send').isEnabled(),observedError:await ff.locator('#error').textContent(),method:'Client HTTP fault injection; no model call'});await fault.close();
}catch(e){result.fatal=String(e);console.error(e);}
finally{
 if(frame){result.events=await events().catch(()=>[]);await frame.locator('#end').click({timeout:2000}).catch(()=>{});}
 write();await browser.close();
}
const latencies=result.turns.map(t=>t.endToAudioMs).filter(Number.isFinite).sort((a,b)=>a-b);
result.summary={attempted:result.turns.length,passed:result.turns.filter(t=>t.pass).length,failed:result.turns.filter(t=>!t.pass).length,latencySamples:latencies.length,p50Ms:latencies[Math.ceil(latencies.length*.5)-1],p95Ms:latencies[Math.ceil(latencies.length*.95)-1],checksPassed:result.checks.filter(c=>c.pass).length,checksFailed:result.checks.filter(c=>!c.pass).length};result.summary.latencyPassed=latencies.length===30&&result.summary.p50Ms<=800&&result.summary.p95Ms<2000;write();console.log(JSON.stringify(result.summary));
if(result.fatal||result.summary.failed||result.summary.checksFailed||!result.summary.latencyPassed||result.pageErrors.length)process.exitCode=1;
