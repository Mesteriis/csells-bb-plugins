export const duplexPage = String.raw`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jarvis duplex lab</title>
<style>body{font:18px system-ui;background:#141414;color:#eee;max-width:800px;margin:24px auto;padding:16px}button,select{font:inherit;padding:14px;margin:5px;border-radius:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}meter{width:100%}button:disabled{opacity:.5}</style>
<h1>Hands-free audio check</h1>
<p>Park first and end the normal Jarvis conversation.</p>
<p>Tap Start. Alfred will speak for 12 seconds. Say “one, two, three” while he speaks. The bar should move with your voice.</p>
<button id="guided">Start hands-free check</button><button id="stop">Stop</button>
<h2 id="status">Ready</h2><meter id="meter" min="0" max="0.2" value="0"></meter>
<div id="verdict" hidden><p>Could you hear Alfred while the microphone bar moved with your voice?</p><button id="heard">Yes, both worked</button><button id="silent">No, something failed</button></div>
<details><summary>Technical tests and results</summary><p>Optional controls for diagnosis. Changing microphone may change the speaker route.</p><select id="device"><option value="">Default microphone</option></select><div id="buttons"></div><button id="export">Download results</button><pre id="stats"></pre><pre id="results"></pre></details>
<script type="module">
const voice=Uint8Array.from(atob('__VOICE__'),c=>c.charCodeAt(0));
const modes=['mic-off','media-before-mic','media-after-mic','unprocessed','webrtc','jarvis-graph','native-graph','webrtc-jarvis'];
const clientId=crypto.randomUUID(),events=[],base='/api/v1/plugins/jarvis/http/';let run=null,last=null;
const $=id=>document.getElementById(id);
function report(phase,extra={}) {const e={stage:'duplex',phase,clientId,requestId:last?.id,at:Date.now(),mode:last?.mode,...extra};events.push(e);$('results').textContent=events.slice(-6).map(x=>JSON.stringify(x)).join('\n');fetch(base+'diagnostics',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({events:[e]})}).then(r=>{if(!r.ok)throw Error('Upload rejected');}).catch(()=>{$('results').textContent+='\nDiagnostic upload unavailable; download results.';});}
function clean(target=run){if(!target)return;const r=target;if(run===r)run=null;clearInterval(r.timer);clearTimeout(r.end);for(const t of r.tracks)t.stop();for(const p of r.peers)p.close();for(const a of r.audio){a.pause();a.srcObject=null;a.removeAttribute('src');a.load();}for(const c of r.contexts)c.close().catch(e=>console.warn('Audio cleanup failed',e.name));for(const u of r.urls)URL.revokeObjectURL(u);}
function audio(r){const a=new Audio();a.loop=true;a.setAttribute('playsinline','');r.audio.push(a);return a;}
async function start(mode){clean();last={mode,id:crypto.randomUUID()};const r=run={tracks:[],peers:[],audio:[],contexts:[],urls:[],started:performance.now()};$('status').textContent=mode==='webrtc-jarvis'?'Connecting call audio…':mode;$('verdict').hidden=true;report('start');
try{
const out=audio(r);const url=URL.createObjectURL(new Blob([voice],{type:'audio/wav'}));r.urls.push(url);
if(mode==='media-before-mic'){out.src=url;await out.play();}
let mic,analyser,buf;
if(mode!=='mic-off'){
const processing=mode!=='unprocessed';const device=$('device').value;
mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:processing,noiseSuppression:processing,autoGainControl:processing,...(device?{deviceId:{exact:device}}:{})},video:false});r.tracks.push(...mic.getTracks());if(run!==r){clean(r);return;}
const c=new AudioContext((mode==='jarvis-graph'||mode==='webrtc-jarvis')?{sampleRate:16000}:{});r.contexts.push(c);await c.resume();r.contextRate=c.sampleRate;analyser=c.createAnalyser();buf=new Float32Array(analyser.fftSize);const input=c.createMediaStreamSource(mic);input.connect(analyser);
if(mode==='jarvis-graph'||mode==='native-graph'||mode==='webrtc-jarvis'){const code="class Capture extends AudioWorkletProcessor {process(inputs){if(inputs[0]?.[0])this.port.postMessage(inputs[0][0].length);return true;}}registerProcessor('duplex-capture',Capture);";const u=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));r.urls.push(u);await c.audioWorklet.addModule(u);const w=new AudioWorkletNode(c,'duplex-capture',mode==='webrtc-jarvis'?{numberOfInputs:1,numberOfOutputs:0}:{});w.port.onmessage=e=>{r.captureSamples=(r.captureSamples??0)+e.data;};input.connect(w);if(mode!=='webrtc-jarvis')w.connect(c.destination);}
const devices=await navigator.mediaDevices.enumerateDevices();const selected=$('device').value;for(const d of devices.filter(d=>d.kind==='audioinput'))if(![...$('device').options].some(o=>o.value===d.deviceId))$('device').add(new Option(d.label||'Microphone',d.deviceId));$('device').value=selected;
r.settings=mic.getAudioTracks()[0].getSettings();
}
if(mode==='webrtc'||mode==='webrtc-jarvis'){
const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]});r.peers.push(a,b);const qa=[],qb=[];
a.onicecandidate=e=>{if(e.candidate)(b.remoteDescription?b.addIceCandidate(e.candidate).catch(fail):qb.push(e.candidate));};b.onicecandidate=e=>{if(e.candidate)(a.remoteDescription?a.addIceCandidate(e.candidate).catch(fail):qa.push(e.candidate));};
for(const t of mic.getAudioTracks())a.addTrack(t,mic);
const c=new AudioContext();r.contexts.push(c);await c.resume();const dest=c.createMediaStreamDestination(),source=c.createBufferSource();source.buffer=await c.decodeAudioData(voice.slice().buffer);source.loop=true;source.connect(dest);r.tracks.push(...dest.stream.getTracks());for(const t of dest.stream.getTracks())b.addTrack(t,dest.stream);
a.ontrack=e=>{out.srcObject=e.streams[0]??new MediaStream([e.track]);out.play().catch(fail);};
await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription);for(const x of qb)await b.addIceCandidate(x);await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription);for(const x of qa)await a.addIceCandidate(x);source.start();r.pc=a;
}else if(mode!=='media-before-mic'){out.src=url;await out.play();}
if(run!==r){clean(r);return;}
r.timer=setInterval(async()=>{if(run!==r)return;let rms=0;if(analyser){analyser.getFloatTimeDomainData(buf);rms=Math.sqrt(buf.reduce((n,x)=>n+x*x,0)/buf.length);}$('meter').value=rms;let sent=0,received=0;if(r.pc)for(const x of (await r.pc.getStats()).values()){if(x.type==='outbound-rtp'&&x.kind==='audio')sent+=x.bytesSent??0;if(x.type==='inbound-rtp'&&x.kind==='audio')received+=x.bytesReceived??0;}
if(run!==r)return;const sample={rms,positionMs:out.currentTime*1000,durationMs:performance.now()-r.started,bytesSent:sent,bytesReceived:received,sampleRate:r.settings?.sampleRate??0,contextSampleRate:r.contextRate??0,samples:r.captureSamples??0,micLive:mic?.getAudioTracks()[0]?.readyState==='live',echoCancellation:r.settings?.echoCancellation??false,noiseSuppression:r.settings?.noiseSuppression??false,autoGainControl:r.settings?.autoGainControl??false};$('stats').textContent=JSON.stringify(sample,null,2);if(mode==='webrtc-jarvis')$('status').textContent='Speak while Alfred talks · '+Math.max(0,12-Math.floor(sample.durationMs/1000))+' seconds';report('running',sample);},1000);
r.end=setTimeout(()=>{report('complete');clean();$('status').textContent='Check complete';$('verdict').hidden=false;},12000);
}catch(e){fail(e);}
function fail(e){if(run!==r)return;report('failed',{errorKind:e.name});$('status').textContent=e.name+': '+e.message;clean();}
}
for(const mode of modes){const b=document.createElement('button');b.textContent=mode;b.onclick=()=>start(mode);$('buttons').append(b);}
$('guided').onclick=()=>start('webrtc-jarvis');
$('stop').onclick=()=>{report('interrupted');clean();$('status').textContent='Stopped';};$('heard').onclick=()=>{report('audible');$('status').textContent='Result sent: audio and microphone worked together';};$('silent').onclick=()=>{report('silent');$('status').textContent='Result sent: the check failed';};$('export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(events,null,2)],{type:'application/json'}));a.download='jarvis-duplex-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};window.addEventListener('pagehide',()=>clean());
</script>`;
