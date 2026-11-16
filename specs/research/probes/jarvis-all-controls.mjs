// Real staging UI, models and relay; synthetic silent mic. Never answers a real question.
import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.JARVIS_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:process.env.JARVIS_CHROME,headless:true});
const result={at:new Date().toISOString(),checks:[],errors:[]};let frame;
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>result.errors.push(String(e)));
 await page.addInitScript(()=>{
  const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(window.blockPlayback&&this.srcObject)return Promise.reject(new DOMException('Audit autoplay denial','NotAllowedError'));return play.call(this);};
  window.events=[];addEventListener('jarvis-diagnostic',e=>window.events.push(e.detail));
  navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const d=c.createMediaStreamDestination();window.micTrack=d.stream.getAudioTracks()[0];return d.stream;};
 });
 await page.goto('http://127.0.0.1:4840/plugins/jarvis/staff');await page.frameLocator('iframe[title="Jarvis conversation"]').locator('#start').waitFor();frame=page.frames().find(f=>f.url().endsWith('/livekit'));
 const wait=(fn,arg,timeout=60000)=>frame.waitForFunction(fn,arg,{timeout});
 const click=id=>frame.locator('#'+id).click();
 const clean=async()=>assert.equal(await frame.locator('#error').textContent(),'');
 const pass=name=>{result.checks.push(name);console.log('PASS '+name);};
 const speech=()=>wait(()=>document.querySelector('#state').textContent==='Jarvis is speaking');
 const end=async()=>{await click('end');await wait(()=>document.querySelector('#state').textContent==='Ended');};
 const command=async(id,pattern)=>{const count=await frame.evaluate(()=>window.events.filter(e=>e.phase==='response').length);await click(id);await wait(n=>window.events.filter(e=>e.phase==='response').length>n,count);if(pattern)assert.match(await frame.locator('#answer').textContent(),pattern);await clean();};
 await wait(()=>!document.querySelector('#voice').disabled);assert.equal(await frame.locator('#voice').inputValue(),'cosyvoice-alfred');
 assert(await frame.evaluate(()=>document.body.scrollWidth<=innerWidth));
 for(const id of ['end','stop','brief','questions','watch','quiet','mic','stop-work','send'])assert(await frame.locator('#'+id).isDisabled(),id+' before start');pass('idle disabled controls; phone layout; CosyVoice default');
 if(process.env.JARVIS_CONTROLS_MODE!=='recovery'){
 await frame.locator('#pace').selectOption('1.4');await frame.locator('#voice').selectOption('kokoro-george');await frame.locator('#voice').selectOption('cosyvoice-alfred');pass('voice and pace selectors');
 await click('start');await speech();assert(await frame.locator('#voice').isDisabled());assert(await frame.locator('#pace').isDisabled());pass('Start; settings locked during speech');
 await click('mic');assert.equal(await frame.locator('#mic').textContent(),'Microphone on');assert.equal(await frame.evaluate(()=>window.micTrack.enabled),false);await click('mic');assert.equal(await frame.evaluate(()=>window.micTrack.enabled),true);pass('microphone off/on during speech');
 await command('questions');await speech();pass('What needs me during speech');
 await command('brief');await speech();pass('Brief me during speech');
 await command('watch');assert.equal(await frame.locator('#watch').textContent(),'Pause watching');await speech();
 await command('watch');assert.equal(await frame.locator('#watch').textContent(),'Keep me updated');pass('watch on/off during speech');
 const quietLabel=await frame.locator('#quiet').textContent();
 await command('quiet');assert.notEqual(await frame.locator('#quiet').textContent(),quietLabel);await speech();
 await command('quiet');assert.equal(await frame.locator('#quiet').textContent(),quietLabel);pass('quiet/resume during speech');
 await speech();await click('stop');await wait(()=>document.querySelector('#state').textContent!=='Jarvis is speaking');await clean();pass('Stop speaking during speech');
 // A stop while the model is preparing must fence its eventual completion.
 const old=await frame.evaluate(()=>window.events.filter(e=>e.phase==='response').length);
 await click('brief');await page.waitForTimeout(150);await click('stop');await page.waitForTimeout(12000);
 assert.equal(await frame.evaluate(()=>window.events.filter(e=>e.phase==='response').length),old,'Stop must discard pending briefing');pass('Stop speaking during briefing preparation');
 await command('brief');await speech();await frame.locator('#draft').fill('What is six plus six? Reply only with the number.');await click('send');await wait(()=>/^(12|twelve)[.!]?$/i.test(document.querySelector('#answer').textContent.trim()));await clean();pass('typed Send interrupts speech and returns real model answer');
 await frame.locator('summary').filter({hasText:'Diagnostics'}).click();let download=page.waitForEvent('download');await click('diagnostics');let file=await download;const diag=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert(diag.sessionId&&diag.events.some(e=>e.event==='start-click'));pass('Download diagnostics contains current session/events');
 await frame.locator('summary').filter({hasText:'Grade this voice'}).click();await frame.locator('#grade-clarity').selectOption({index:1});await frame.locator('#grade-character').selectOption({index:2});await frame.locator('#grade-pace').selectOption({index:1});await frame.locator('#grade-interruptions').selectOption({index:1});await frame.locator('#grade-notes').fill('Task-owned automated control audit');download=page.waitForEvent('download');await click('grade-save');file=await download;const grade=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.equal(grade.profile.voice,'alfred');assert.equal(grade.ratings.notes,'Task-owned automated control audit');pass('voice grade controls and JSON export');
 await frame.locator('summary').filter({hasText:'Delegated work'}).click();assert(!/unavailable|Start Jarvis/.test(await frame.locator('#tasks').textContent()));pass('delegated work expansion and live list');
 await command('stop-work',/requested stop/i);await clean();pass('Stop delegated work dispatch (existing test-owned tasks)');
 await end();await clean();pass('End during response; selectors re-enabled');
 await click('start');await click('end');await wait(()=>document.querySelector('#state').textContent==='Ended');await page.waitForTimeout(2500);assert.equal(await frame.locator('#state').textContent(),'Ended');pass('End during startup; no late resurrection');
 await click('text-start');await wait(()=>document.querySelector('#state').textContent==='Ready · text only');assert(await frame.locator('#mic').isDisabled());assert(await frame.locator('#stop').isDisabled());pass('Use text; audio-only controls disabled');
 for(const id of ['questions','brief','watch','watch','quiet','quiet','stop-work']){await command(id);pass('text '+id);}
 await frame.locator('#draft').fill('What is six plus six? Reply only with the number.');await click('send');await wait(()=>/^(12|twelve)[.!]?$/i.test(document.querySelector('#answer').textContent.trim()));await clean();pass('text Send real model answer');await end();pass('text End');
 }
 await frame.evaluate(()=>{window.blockPlayback=true;});await click('start');
 await frame.locator('#audio').waitFor({state:'visible',timeout:30000});
 await frame.evaluate(()=>{window.blockPlayback=false;});await click('audio');await frame.locator('#audio').waitFor({state:'hidden',timeout:10000});await speech();await clean();pass('Enable audio recovers injected autoplay denial');
 await page.route('**/livekit-close',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Injected cleanup failure'})}),{times:1});
 await click('end');await wait(()=>document.querySelector('#state').textContent.includes('Cleanup failed'));
 assert(await frame.locator('#start').isDisabled());assert(!(await frame.locator('#end').isDisabled()));await end();await clean();pass('End retry after failed close preserves ownership and clears the recovered error');
 assert.deepEqual(result.errors,[]);
}catch(e){result.failure=String(e);process.exitCode=1;console.error(String(e));}
finally{if(frame)await frame.locator('#end').click({timeout:2000}).catch(()=>{});await browser.close();fs.writeFileSync(process.env.JARVIS_AUDIT_RESULT,JSON.stringify(result,null,2));}
