const {chromium}=await import(process.env.JARVIS_PLAYWRIGHT_MODULE);
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=process.env.JARVIS_EVIDENCE_DIR;
const run=process.env.AEC_RUN??'before';
const echoDelay=Number(process.env.AEC_DELAY??.12), nearGain=Number(process.env.AEC_NEAR_GAIN??1),echoGain=Number(process.env.AEC_ECHO_GAIN??.35);
const browser=await chromium.launch({executablePath:process.env.JARVIS_CHROME,headless:true});
let page;
try {
 page=await browser.newPage();
 await page.addInitScript(()=>{
  window.events=[];
  const orig=RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel=function(...args){
   window.testPc=this;const dc=orig.apply(this,args);
   dc.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='jarvis')window.events.push({...m,at:performance.now()});}catch{}});return dc;
  };
  navigator.mediaDevices.getUserMedia=async()=>{
   const c=new AudioContext();await c.resume();const d=c.createMediaStreamDestination();const o=c.createOscillator(),g=c.createGain();g.gain.value=0;o.connect(g).connect(d);o.start();window.capture={c,d};return d.stream;
  };
 });
 await page.goto(process.env.JARVIS_SPIKE_URL);
 await page.locator('#start').click();await page.waitForFunction(()=>!document.querySelector('#brief').disabled,null,{timeout:30000});
 await page.locator('#brief').click();await page.waitForFunction(()=>window.events.some(e=>e.phase==='speaking'),null,{timeout:60000});
 await page.waitForFunction(()=>window.events.some(e=>e.phase==='aec'&&e.referenceRms>.01&&e.inputRms<.0001),null,{timeout:10000});
 const channelSeparation=true;
 const initial=await page.evaluate(()=>window.events.filter(e=>e.phase==='interrupted').length);
 await page.evaluate(({echoDelay,echoGain})=>{
  const {c,d}=window.capture;const source=c.createMediaStreamSource(document.querySelector('#out').srcObject),gain=c.createGain(),delay=c.createDelay(1);
  delay.delayTime.value=echoDelay;gain.gain.value=echoGain;source.connect(delay).connect(gain).connect(d);window.echo={source,gain,delay};
 },{echoDelay,echoGain});
 await page.evaluate(async()=>{const c=new AudioContext();await c.resume();const a=c.createAnalyser();c.createMediaStreamSource(document.querySelector('#out').srcObject).connect(a);window.levels=[];window.levelTimer=setInterval(()=>{const f=new Float32Array(a.fftSize);a.getFloatTimeDomainData(f);window.levels.push({at:performance.now(),rms:Math.sqrt(f.reduce((s,x)=>s+x*x,0)/f.length)});},20);});
 await page.waitForTimeout(10000);
 const falseInterruptions=await page.evaluate(initial=>window.events.filter(e=>e.phase==='interrupted').length-initial,initial);
 await page.waitForFunction(()=>window.levels.slice(-5).filter(s=>s.rms>.01).length>=4,null,{timeout:15000});
 await page.evaluate(async ({wav,nearGain})=>{
  const {c,d}=window.capture;const source=c.createBufferSource();source.buffer=await c.decodeAudioData(Uint8Array.from(atob(wav),c=>c.charCodeAt(0)).buffer);const volume=c.createGain();volume.gain.value=nearGain;source.connect(volume).connect(d);window.nearStart=performance.now();source.start();
 },{wav:fs.readFileSync(process.env.JARVIS_NEAR_WAV).toString('base64'),nearGain});
 await page.waitForFunction(()=>window.events.some(e=>e.phase==='transcript'&&e.at>window.nearStart),null,{timeout:30000});
 await page.waitForFunction(()=>window.events.some(e=>e.phase==='speaking'&&e.at>window.nearStart),null,{timeout:60000});
 await page.waitForTimeout(1500);
 const result=await page.evaluate(()=>({events:window.events,nearStart:window.nearStart,levels:window.levels}));
 const interruption=result.events.find(e=>e.phase==='interrupted'&&e.at>result.nearStart);
 const onsetMs=interruption?interruption.at-result.nearStart:null;
 const quiet=result.levels.find((s,i)=>s.at>(interruption?.at??Infinity)&&result.levels.slice(i,i+5).length===5&&result.levels.slice(i,i+5).every(v=>v.rms<.002));
 const decodedQuietMs=quiet?quiet.at-result.nearStart:null;
 const transcript=result.events.find(e=>e.phase==='transcript'&&e.at>result.nearStart)?.text;
 const errors=result.events.filter(e=>e.phase==='error');
 const secondSpeaking=result.events.filter(e=>e.phase==='speaking').at(-1).at;const lastOld=result.levels.filter(v=>v.at>result.nearStart&&v.at<secondSpeaking&&v.rms>.002).at(-1);const decodedStopMs=lastOld?lastOld.at-result.nearStart+20:null;
 const evidence={at:new Date().toISOString(),method:'Actual staged WebRTC/STT/Jarvis/Alfred. Delayed digital echo at0.35 plus independent macOS Samantha spoken input. Not physical car.',channelSeparation,echoDelay,echoGain,nearGain,falseInterruptions,onsetMs,decodedQuietMs,decodedStopMs,transcript,events:result.events.map(({text,question,...e})=>({...e,characters:text?.length??0})),errors};
 fs.writeFileSync(root+'/aec-doubletalk-'+run+'.json',JSON.stringify(evidence,null,2));console.log({...evidence,events:evidence.events.filter(e=>e.phase!=='aec')});
 assert.equal(falseInterruptions,0,'Echo-only must not interrupt');
 assert.ok(onsetMs!==null&&onsetMs<1000,'Speech-onset interruption must be under1sec spike ceiling;250ms final target remains');
 assert.ok(decodedStopMs!==null&&decodedStopMs<1000,'Last decoded old audio must stop within1sec of stimulus');
 assert.ok(decodedQuietMs!==null&&decodedQuietMs<1000,'Decoded audio must become quiet within1sec of stimulus');assert.ok(result.levels.some(v=>v.at>result.events.filter(e=>e.phase==='speaking').at(-1).at&&v.rms>.005),'Replacement reply must have decoded audio');assert.match(transcript,new RegExp(process.env.JARVIS_EXPECT_TRANSCRIPT??'two|2','i'));assert.equal(errors.length,0);
} catch(error) { if(page){const detail=await page.evaluate(()=>({events:window.events.map(({text,question,...e})=>({...e,characters:text?.length??0})),nearStart:window.nearStart}));fs.writeFileSync(root+'/aec-failed-'+run+'.json',JSON.stringify({error:error.message,...detail},null,2));}throw error; } finally {if(page){await page.locator('#end').click().catch(()=>{});await page.waitForTimeout(500);}await browser.close();}
