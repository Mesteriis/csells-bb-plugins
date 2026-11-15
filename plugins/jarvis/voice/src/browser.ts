import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';
const element=(id:string)=>document.getElementById(id)!;
const button=(id:string)=>element(id) as HTMLButtonElement;
const status=(text:string)=>{element('state').textContent=text;};
let room:Room|undefined, credentials:{id:string;controlToken:string}|undefined, heartbeat:ReturnType<typeof setInterval>|undefined;
let lastSessionId:string|undefined, watching=false, quiet=false;
const activeControls=['end','stop','brief','questions','watch','quiet','mic','stop-work','send'];
const evidence:Record<string,unknown>[]=[];
function record(event:string,data:Record<string,unknown>={}){const entry={at:Date.now(),monotonicMs:performance.now(),event,...data};evidence.push(entry);window.dispatchEvent(new CustomEvent('jarvis-diagnostic',{detail:entry}));if(evidence.length>2000)evidence.shift();}
async function request(action:string,body:unknown={}){
  const r=await fetch(`livekit-${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(data.error??`Request failed (${r.status})`);return data;
}
function fail(error:unknown){record('error',{message:String(error)});element('error').textContent=String(error);}
async function end(){
  clearInterval(heartbeat); const old=credentials;credentials=undefined;
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
    if(e.phase==='conversation-state'){watching=!!e.watch;quiet=!!e.quiet;element('mode').textContent=watching?(quiet?'Watching · updates quiet':'Watching recent threads'):'Updates paused';button('watch').textContent=watching?'Pause watching':'Keep me updated';button('quiet').textContent=quiet?'Resume updates':'Quiet updates';}
    if(e.phase==='response'){element('answer').textContent=text??'';element('question').textContent=question?`Current question: ${question}`:'';}
    if(e.phase==='transcribed')element('heard').textContent=`You: ${text}`;
    if(e.phase==='agent-state')status(e.state==='speaking'?'Jarvis is speaking':e.state==='thinking'?'Jarvis is thinking…':room?.localParticipant.isMicrophoneEnabled?'Listening':'Ready · microphone off');
    if(e.phase==='briefing')status('Preparing your briefing…');
    if(e.phase==='error')fail(text);
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
button('text-start').onclick=()=>void start(false);
button('end').onclick=()=>void end();
button('stop').onclick=()=>{if(credentials)void request('stop-speaking',credentials).catch(fail);};
button('audio').onclick=()=>void room?.startAudio().catch(fail);
button('diagnostics').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({userAgent:navigator.userAgent,sessionId:lastSessionId,events:evidence},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='jarvis-livekit-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('pagehide',()=>{if(credentials)navigator.sendBeacon('livekit-close',new Blob([JSON.stringify(credentials)],{type:'application/json'}));});

async function command(action:string,args:Record<string,unknown>={}){if(credentials)await request('command',{...credentials,action,...args});}
for(const action of ['brief','questions','stop-work'])button(action).onclick=()=>void command(action).catch(fail);
button('watch').onclick=()=>void command('watch',{enabled:!watching}).catch(fail);
button('quiet').onclick=()=>void command('quiet',{enabled:!quiet}).catch(fail);
button('mic').onclick=async()=>{if(room){try{await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);button('mic').textContent=room.localParticipant.isMicrophoneEnabled?'Microphone off':'Microphone on';}catch(e){fail(e);}}};
element('text-form').onsubmit=async e=>{e.preventDefault();const draft=element('draft') as HTMLInputElement;if(!credentials||!draft.value.trim())return;const text=draft.value;draft.value='';element('heard').textContent=`You: ${text}`;try{await request('text',{...credentials,text});}catch(error){draft.value=text;fail(error);}};
let loadingTasks=false;
async function refreshTasks(){if(!credentials||loadingTasks)return;loadingTasks=true;try{
 const tasks=await request('tasks',credentials);element('tasks').replaceChildren();
 if(!tasks.length)element('tasks').textContent='No delegated work yet. Ask Jarvis to start a task.';
 for(const task of tasks){const item=document.createElement('div');item.className='task';item.textContent=`${task.session?.title??task.prompt} — ${task.session?.status??task.dispatch}${task.cancellation!=='none'?` · Stop: ${task.cancellation}`:''}`;element('tasks').append(item);}
}catch{element('tasks').textContent='Task status unavailable; retrying.';}finally{loadingTasks=false;}}
