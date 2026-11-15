// Real staged BB/model tests. text-outage must run with the companion stopped.
// Every relay-owned task must be test-owned: this suite clicks scoped Stop.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const required=n=>{if(!process.env[n])throw Error(`Set ${n}`);return process.env[n];};
const {chromium}=await import(pathToFileURL(required('JARVIS_PLAYWRIGHT_MODULE')).href);
const mode=required('JARVIS_CONTROL_MODE');
assert(['voice','text-outage','process'].includes(mode));
assert.equal(process.env.JARVIS_TEST_OWNED_WORK,'1');
const out=required('JARVIS_AUDIT_DIR');fs.mkdirSync(out,{recursive:true});
const evidence={at:new Date().toISOString(),mode,checks:[],pageErrors:[]};
const browser=await chromium.launch({executablePath:required('JARVIS_CHROME'),headless:true});
let frame;
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',e=>evidence.pageErrors.push(String(e)));
 const mediaRequests=[];
 page.on('request',r=>{if(/livekit-(session|ready|text|command|signal)/.test(new URL(r.url()).pathname))mediaRequests.push(new URL(r.url()).pathname);});
 await page.addInitScript(()=>{
  window.testEvents=[];addEventListener('jarvis-diagnostic',e=>window.testEvents.push(e.detail));
  navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();const d=c.createMediaStreamDestination(),osc=c.createOscillator(),g=c.createGain();g.gain.value=0;osc.connect(g).connect(d);osc.start();window.fixture={c,d};return d.stream;};
 });
 await page.goto(required('JARVIS_REVIEW_URL'));
 await page.frameLocator('iframe[title="Jarvis conversation"]').locator('#start').waitFor();
 frame=page.frames().find(f=>f.url().endsWith('/livekit'));
 const wait=(fn,arg,timeout=60000)=>frame.waitForFunction(fn,arg,{timeout});
 const check=name=>{evidence.checks.push(name);console.log('PASS '+name);};
 assert(await frame.evaluate(()=>document.body.scrollWidth<=innerWidth));check('phone-width layout');
 let workerPid;
 if(mode==='process'){
  const pidFile=required('JARVIS_WORKER_PID_FILE');
  const resume=process.env.JARVIS_RESUME_WORKER==='1';
  assert(resume||!fs.existsSync(pidFile),'Use a fresh task-owned PID file');
  if(!resume){
  const python=`import os,time,pathlib; pathlib.Path(${JSON.stringify(pidFile)}).write_text(str(os.getpid())); time.sleep(240)`;
  const shellCommand=`python3 -c '${python.replaceAll("'", "'\"'\"'")}'`;
  await frame.locator('#text-start').click();await wait(()=>!document.querySelector('#send').disabled);
  await frame.locator('#draft').fill(`Start a new task to run Jarvis bounded process cancellation acceptance. This is task-owned staging validation. Execute exactly one foreground exec_command: ${shellCommand}. Do not background, detach, spawn agents, edit any other files, or retry after interruption. The test controller will stop you while this process runs.`);
  await frame.locator('#send').click();await wait(()=>/started that task/.test(document.querySelector('#answer').textContent));
  for(let i=0;i<120&&!fs.existsSync(pidFile);i++)await page.waitForTimeout(1000);
  assert(fs.existsSync(pidFile),'Real worker did not start its bounded process');
  await frame.locator('#end').click();await wait(()=>!document.querySelector('#start').disabled);
  }
  workerPid=Number(fs.readFileSync(pidFile,'utf8'));assert(Number.isInteger(workerPid)&&workerPid>1);
  const command=execFileSync('ps',['-p',String(workerPid),'-o','command='],{encoding:'utf8'});
  assert(command.includes(pidFile),'PID identity must match this exact test');
  evidence.workerPid=workerPid;check('real delegated worker started verified foreground process');
 }
 if(mode!=='text-outage'){
  await frame.evaluate(()=>{window.testEvents=[];});
  await frame.locator('#start').click();
  await wait(()=>window.testEvents.some(e=>e.phase==='briefing'));
  assert.equal(await frame.evaluate(()=>window.testEvents.some(e=>e.phase==='response')),false,'Must stop before briefing response');
  const stopAt=Date.now();
  await frame.locator('#stop-work').click();
  await wait(()=>/requested stop/.test(document.querySelector('#answer').textContent));
  if(workerPid){
   const alive=()=>{try{process.kill(workerPid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
   for(let i=0;i<100&&alive();i++)await page.waitForTimeout(100);
   assert(!alive(),'Stop receipt did not terminate the foreground process');
   evidence.stopToObservedExitMs=Date.now()-stopAt;
   check('foreground process termination independently observed');
  }
  check('stop during opening briefing preparation');
  await frame.locator('#stop').click();
  await wait(()=>!['Jarvis is speaking','Jarvis is thinking…'].includes(document.querySelector('#state').textContent));
  await page.waitForTimeout(1000);
  await frame.locator('#brief').click();
  await wait(()=>window.testEvents.some(e=>e.phase==='response'&&e.kind==='brief'));
  await wait(()=>document.querySelector('#state').textContent==='Jarvis is speaking');
  // Prove decoded audio, not just the displayed Speaking label.
  await frame.evaluate(async()=>{
   const c=new AudioContext();await c.resume();const a=c.createAnalyser();c.createMediaStreamSource(document.querySelector('#media audio').srcObject).connect(a);
   window.hasAudio=false;window.audioTimer=setInterval(()=>{const f=new Float32Array(a.fftSize);a.getFloatTimeDomainData(f);if(Math.sqrt(f.reduce((s,x)=>s+x*x,0)/f.length)>.005)window.hasAudio=true;},20);
  });
  await wait(()=>window.hasAudio);
  await frame.locator('#stop-work').click();
  await wait(()=>/requested stop/.test(document.querySelector('#answer').textContent));
  check('stop during decoded briefing playback');
  await frame.locator('#stop').click();
  await page.waitForTimeout(1500);
  assert.equal(await frame.locator('#error').textContent(),'');
  const second=await browser.newPage();await second.goto(required('JARVIS_REVIEW_URL'));
  const other=second.frameLocator('iframe[title="Jarvis conversation"]');await other.locator('#text-start').click();
  await other.locator('#error').filter({hasText:/active on another device/}).waitFor();
  assert(await other.locator('#send').isDisabled());await second.close();
  check('text client cannot steal active voice ownership');
 }else{
  await frame.locator('#text-start').click();
  await wait(()=>!document.querySelector('#send').disabled);
  assert(await frame.locator('#mic').isDisabled());
  await frame.locator('#draft').fill('What is six plus six? Reply only with the number.');await frame.locator('#send').click();
  await wait(()=>/\b(?:12|twelve)\b/i.test(document.querySelector('#answer').textContent));
  check('cold text load and real model answer with companion stopped');
  await frame.locator('#stop-work').click();await wait(()=>/requested stop/.test(document.querySelector('#answer').textContent));
  check('scoped stop independent of voice outage');
  await frame.locator('#brief').click();await wait(()=>document.querySelector('#state').textContent==='Jarvis is thinking…');
  await frame.locator('#stop-work').click();await wait(()=>/requested stop/.test(document.querySelector('#answer').textContent));
  await page.waitForTimeout(1500);assert(/requested stop/.test(await frame.locator('#answer').textContent()));
  check('text stop supersedes briefing without stale output');
  assert.deepEqual(mediaRequests,[]);check('no media-session dependency in text mode');
  assert.equal(await frame.locator('#error').textContent(),'');
 }
 await page.screenshot({path:path.join(out,`controls-${mode}.png`),fullPage:true});
 assert.deepEqual(evidence.pageErrors,[]);
}catch(error){evidence.failure=String(error);console.error(error);process.exitCode=1;}
finally{
 if(frame){evidence.events=await frame.evaluate(()=>window.testEvents).catch(()=>[]);await frame.locator('#end').click({timeout:3000}).catch(()=>{});}
 fs.writeFileSync(path.join(out,`controls-${mode}.json`),JSON.stringify(evidence,null,2));await browser.close();
}
