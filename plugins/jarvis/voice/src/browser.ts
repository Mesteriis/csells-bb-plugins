import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';
import type { State } from './relay.js';
const element=(id:string)=>document.getElementById(id)!;
const button=(id:string)=>element(id) as HTMLButtonElement;
const status=(text:string)=>{element('state').textContent=text;};
let room:Room|undefined, credentials:{id:string;controlToken:string}|undefined, heartbeat:ReturnType<typeof setInterval>|undefined;
let textClient:string|undefined, textFocus:string|undefined, textEpoch=0, textBusy=0;
let lastSessionId:string|undefined, watching=false, quiet=false;
const activeControls=['end','stop','brief','questions','watch','quiet','mic','stop-work','send'];
const evidence:Record<string,unknown>[]=[];
function record(event:string,data:Record<string,unknown>={}){const entry={at:Date.now(),monotonicMs:performance.now(),event,...data};evidence.push(entry);window.dispatchEvent(new CustomEvent('jarvis-diagnostic',{detail:entry}));if(evidence.length>2000)evidence.shift();}
async function request(action:string,body:unknown={}){
  const r=await fetch(`livekit-${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(data.error??`Request failed (${r.status})`);return data;
}
async function control(action:string,body:unknown){
  const r=await fetch(`control-${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(data.error??`Control failed (${r.status})`);return data;
}
function showMode(state:State){
  watching=!!state.watch;quiet=!!state.quiet;
  element('mode').textContent=watching?(quiet?'Watching · updates quiet':'Watching recent threads'):'Updates paused';
  button('watch').textContent=watching?'Pause watching':'Keep me updated';
  button('quiet').textContent=quiet?'Resume updates':'Quiet updates';
}
async function textAction(action:string,args:Record<string,unknown>={},background=false){
  const clientId=textClient;if(!clientId)return;
  const epoch=background?textEpoch:++textEpoch;
  textBusy++;
  if(!background)status('Jarvis is thinking…');
  try {
    const state:State=await control('assistant',{action,clientId,requestId:crypto.randomUUID(),...args});
    if(textClient!==clientId||epoch!==textEpoch)return;
    showMode(state);
    if(state.utterance){
      textFocus=state.focus?.binding;
      element('answer').textContent=state.utterance.text;
      element('question').textContent=state.focus?`Current question: ${state.focus.displayText}`:'';
      record('agent',{phase:'response',utteranceId:state.utterance.id,transport:'text'});
      await control('assistant',{action:'ack',clientId,utteranceId:state.utterance.id,playbackClaim:state.utterance.playbackClaim,status:'delivered'});
    }
  }catch(error){if(textClient===clientId&&epoch===textEpoch)throw error;}
  finally {textBusy--;if(textClient===clientId&&epoch===textEpoch)status('Ready · text only');}
}
async function startText(){
  button('start').disabled=true;button('text-start').disabled=true;element('error').textContent='';status('Connecting text…');
  const clientId=crypto.randomUUID();
  try {
    const initial:State=await control('assistant',{action:'start',clientId});
    showMode(initial);
    textClient=clientId;lastSessionId=clientId;textFocus=undefined;
    for(const id of activeControls)button(id).disabled=['mic','stop'].includes(id);
    status('Ready · text only');
    heartbeat=setInterval(()=>{
      if(textClient!==clientId)return;
      void control('assistant',{action:'heartbeat',clientId}).catch(fail);
      void refreshTasks();
      if(!textBusy)void textAction('next',{},true).catch(fail);
    },5000);
    await refreshTasks();
  }catch(error){fail(error);if(!textClient){button('start').disabled=false;button('text-start').disabled=false;status('Text connection failed');}}
}
function fail(error:unknown){record('error',{message:String(error)});element('error').textContent=String(error);}
async function end(){
  clearInterval(heartbeat); const old=credentials;credentials=undefined;
  const oldText=textClient;textClient=undefined;textFocus=undefined;textEpoch++;
  if(oldText)await control('assistant',{action:'close',clientId:oldText}).catch(fail);
  await room?.disconnect();room=undefined;
  if(old)await request('close',old).catch(fail);
  element('media').replaceChildren();button('start').disabled=false;button('text-start').disabled=false;for(const id of activeControls)button(id).disabled=true;status('Ended');record('ended');
}
async function start(withMicrophone=true){
  button('start').disabled=true;button('text-start').disabled=true;element('error').textContent='';status('Connecting…');
  room=new Room({adaptiveStream:true,dynacast:true,audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
  const unlock=room.startAudio();
  room.on(RoomEvent.TrackSubscribed,track=>{if(track.kind===Track.Kind.Audio){const audio=track.attach();audio.autoplay=true;element('media').append(audio);audio.addEventListener('playing',()=>record('media-playing'));audio.addEventListener('error',()=>record('media-error'));record('audio-subscribed');}});
  room.on(RoomEvent.AudioPlaybackStatusChanged,()=>{button('audio').hidden=room?.canPlaybackAudio??true;record('audio-permission',{allowed:room?.canPlaybackAudio});});
  room.on(RoomEvent.ConnectionStateChanged,state=>{record('connection',{state});if(state===ConnectionState.Reconnecting)status('Reconnecting…');});
  room.on(RoomEvent.Disconnected,()=>{if(credentials){status('Disconnected');void end();}});
  room.on(RoomEvent.DataReceived,(bytes,_participant,_kind,topic)=>{
    if(topic!=='jarvis')return;
    const e=JSON.parse(new TextDecoder().decode(bytes));
    const {text,question,...safe}=e;record('agent',safe);
    if(e.phase==='conversation-state')showMode(e);
    if(e.phase==='response'){element('answer').textContent=text??'';element('question').textContent=question?`Current question: ${question}`:'';}
    if(e.phase==='transcribed')element('heard').textContent=`You: ${text}`;
    if(e.phase==='agent-state')status(e.state==='speaking'?'Jarvis is speaking':e.state==='thinking'?'Jarvis is thinking…':room?.localParticipant.isMicrophoneEnabled?'Listening':'Ready · microphone off');
    if(e.phase==='briefing')status('Preparing your briefing…');
    if(e.phase==='error'||e.phase==='update-error')fail(text);
  });
  try {
    await unlock;
    const data=await request('session');credentials={id:data.id,controlToken:data.controlToken};lastSessionId=data.id;
    const signalUrl=new URL('livekit-signal',location.href);signalUrl.protocol=location.protocol==='https:'?'wss:':'ws:';
    await room.connect(signalUrl.toString(),data.token,{rtcConfig:{iceTransportPolicy:'relay',iceServers:data.iceServers}});
    if(withMicrophone)try{await room.localParticipant.setMicrophoneEnabled(true);}catch{fail('Microphone unavailable. You can type below and still hear replies.');}
    button('mic').textContent=room.localParticipant.isMicrophoneEnabled?'Microphone off':'Microphone on';
    const publication=[...room.localParticipant.audioTrackPublications.values()][0];
    const settings=publication?.track?.mediaStreamTrack.getSettings();record('microphone',{settings});
    for(const id of activeControls)button(id).disabled=false;status('Connected');
    heartbeat=setInterval(()=>{if(credentials){
      void request('heartbeat',credentials).catch(fail);void refreshTasks();
      for(const participant of room?.remoteParticipants.values()??[]) for(const pub of participant.audioTrackPublications.values()) {
        void pub.track?.getRTCStatsReport().then(stats=>{stats?.forEach(report=>{if(report.type==='inbound-rtp'&&report.kind==='audio'){
          const detail={bytesReceived:report.bytesReceived,packetsLost:report.packetsLost,jitter:report.jitter,audioLevel:report.audioLevel,totalAudioEnergy:report.totalAudioEnergy,totalSamplesDuration:report.totalSamplesDuration,playbackAllowed:room?.canPlaybackAudio,micEnabled:room?.localParticipant.isMicrophoneEnabled};
          record('media-stats',detail);if(credentials)void request('telemetry',{...credentials,detail}).catch(()=>{});
        }});}).catch(()=>{});
      }
    }},5000);
    await request('ready',credentials);void refreshTasks();
  }catch(error){fail(error);await end();}
};
button('start').onclick=()=>void start();
button('text-start').onclick=()=>void startText();
button('end').onclick=()=>void end();
button('stop').onclick=()=>{if(credentials)void request('stop-speaking',credentials).catch(fail);};
button('audio').onclick=()=>void room?.startAudio().catch(fail);
button('diagnostics').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({userAgent:navigator.userAgent,sessionId:lastSessionId,events:evidence},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='jarvis-livekit-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('pagehide',()=>{
 if(credentials)navigator.sendBeacon('livekit-close',new Blob([JSON.stringify(credentials)],{type:'application/json'}));
 if(textClient)navigator.sendBeacon('control-assistant',new Blob([JSON.stringify({action:'close',clientId:textClient})],{type:'application/json'}));
});

async function command(action:string,args:Record<string,unknown>={}){
 if(textClient){await textAction(action==='stop-work'?'talk':action,action==='stop-work'?{text:'stop work'}:args);return;}
 if(credentials)await request('command',{...credentials,action,...args});
}
for(const action of ['brief','questions','stop-work'])button(action).onclick=()=>void command(action).catch(fail);
button('watch').onclick=()=>void command('watch',{enabled:!watching}).catch(fail);
button('quiet').onclick=()=>void command('quiet',{enabled:!quiet}).catch(fail);
button('mic').onclick=async()=>{if(room){try{await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);button('mic').textContent=room.localParticipant.isMicrophoneEnabled?'Microphone off':'Microphone on';}catch(e){fail(e);}}};
element('text-form').onsubmit=async e=>{e.preventDefault();const draft=element('draft') as HTMLInputElement;if((!credentials&&!textClient)||!draft.value.trim())return;const text=draft.value;draft.value='';element('heard').textContent=`You: ${text}`;try{if(textClient)await textAction('talk',{text,...(textFocus?{presentedQuestion:textFocus}:{})});else await request('text',{...credentials,text});}catch(error){draft.value=text;fail(error);}};
let loadingTasks=false;
async function refreshTasks(){if((!credentials&&!textClient)||loadingTasks)return;loadingTasks=true;try{
 const tasks=textClient?await control('tasks',null):await request('tasks',credentials);element('tasks').replaceChildren();
 if(!tasks.length)element('tasks').textContent='No delegated work yet. Ask Jarvis to start a task.';
 for(const task of tasks){const item=document.createElement('div');item.className='task';item.textContent=`${task.session?.title??task.prompt} — ${task.session?.status??task.dispatch}${task.cancellation!=='none'?` · Stop: ${task.cancellation}`:''}`;element('tasks').append(item);}
}catch{element('tasks').textContent='Task status unavailable; retrying.';}finally{loadingTasks=false;}}
