import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { initializeLogger, voice } from '@livekit/agents';
import { VAD } from '@livekit/agents-plugin-silero';
import { AudioStream, TrackSource, type RemoteAudioTrack, Room, RoomEvent } from '@livekit/rtc-node';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { SpeechCatalog, SpeechSelectionError, type SpeechSelection } from './speech.js';
import { InputMeter } from './input-meter.js';
import { ControlLane } from './control-lane.js';
import { BBSTT, BBDirector, JarvisAgent, AlfredAgent, Relay } from './relay.js';
initializeLogger({pretty:false, level:'warn'});
const configPath=process.env.JARVIS_VOICE_CONFIG??process.env.JARVIS_LIVEKIT_CONFIG;
if(!configPath)throw Error("Set JARVIS_VOICE_CONFIG to the private companion configuration file");
const config = JSON.parse(await readFile(configPath,'utf8')) as {apiKey:string; apiSecret:string; relayToken:string; turnSecretPath:string; turnUrl:string; speech?:unknown; startupBriefing?:'sample'};
const speechCatalog=new SpeechCatalog(config.speech);
const sampleBriefing = config.startupBriefing==='sample'
  ? "Good evening, Chris. This is the stock Jarvis voice comparison. Every voice reads these same words, with fresh audio generated after you press Start. Listen for a clear, brisk delivery without fuzz or missing words. You can interrupt me, or ask for your real thread briefing when you are ready."
  : undefined;
const rooms = new RoomServiceClient('http://127.0.0.1:7880',config.apiKey,config.apiSecret);
const vad = await VAD.load();
const sessions = new Map<string, Connection>();
function equal(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
function log(session:string,phase:string,detail:Record<string,unknown>={}) {
  const safe = Object.fromEntries(Object.entries(detail).filter(([k])=>['durationMs','audioMs','state','interrupted','reason','kind','bytesReceived','packetsLost','jitter','audioLevel','totalAudioEnergy','totalSamplesDuration','playbackAllowed','micEnabled','inputSamples','inputRms','inputPeak','inputBytesSent','inputPacketsSent','inputAudioLevel','inputTotalAudioEnergy','inputTotalSamplesDuration','inputMuted','inputEnded','allowInterruptions','provider','model','voice','speed','ttfbMs','charactersCount','cancelled','streamed'].includes(k)));
  console.log(JSON.stringify({at:new Date().toISOString(),session,phase,...safe}));
}
async function jwt(room:string,identity:string,agent=false) {
  const token = new AccessToken(config.apiKey,config.apiSecret,{identity,ttl:'5m',name:agent?'Jarvis':'Chris'});
  token.addGrant({roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:true, ...(agent?{agent:true,canUpdateOwnMetadata:true}:{canPublishSources:[2]})});
  return token.toJwt();
}
class Connection {
  id:string = randomUUID(); secret = randomBytes(32).toString('hex');
  name = `jarvis-${this.id}`; identity = `user-${this.id}`;
  room = new Room(); relay = new Relay(`Bearer ${config.relayToken}`, (p,d)=>this.event(p,d));
  tts:ReturnType<SpeechCatalog['create']>|undefined;
  agent:JarvisAgent;
  session:voice.AgentSession;
  constructor(readonly speechChoice?:SpeechSelection, reservation?:{id:string;controlToken:string}) {
    if(reservation){this.id=reservation.id;this.secret=reservation.controlToken;this.name=`jarvis-${this.id}`;this.identity=`user-${this.id}`;}
    this.tts=speechChoice?speechCatalog.create(speechChoice):undefined;
    this.agent=speechChoice?new JarvisAgent(this.relay):new AlfredAgent(this.relay);
    this.session = new voice.AgentSession({vad,tts:this.tts,stt:new BBSTT(this.relay),llm:new BBDirector(this.relay),turnHandling:{turnDetection:'vad',endpointing:{minDelay:500},interruption:{mode:'vad',minDuration:200,minWords:0,falseInterruptionTimeout:2000,resumeFalseInterruption:true},preemptiveGeneration:{enabled:false}}});
  }
  ready!: Promise<void>; closed=false; started=false; touched=Date.now(); heartbeat?:NodeJS.Timeout; watcher?:NodeJS.Timeout; polling=false; backgroundEpoch=0; controls=new ControlLane();
  inputReader?:ReturnType<AudioStream['getReader']>; inputMeterGeneration=0;
  async meterInput(track:RemoteAudioTrack){
    const generation=++this.inputMeterGeneration;
    await this.inputReader?.cancel();
    if(this.closed||generation!==this.inputMeterGeneration)return;
    const reader=new AudioStream(track,{sampleRate:16000,numChannels:1}).getReader();
    this.inputReader=reader;const meter=new InputMeter();let last=Date.now();
    try {
      while(!this.closed){const item=await reader.read();if(item.done)break;meter.add(item.value.data);
        if(Date.now()-last>=1000){this.event('input-audio',{...meter.take(),state:this.session.agentState});last=Date.now();}
      }
    }catch{if(!this.closed)this.event('input-audio-error',{kind:'capture-meter'});}
    finally{await reader.cancel();reader.releaseLock();if(this.inputReader===reader)this.inputReader=undefined;this.event('input-audio-ended');}
  }
  event(phase:string,detail:Record<string,unknown>={}) {
    log(this.id,phase,detail);
    if (this.room.localParticipant) void this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({phase,...detail,at:Date.now()})),{reliable:true,topic:'jarvis'}).catch(()=>{});
  }
  async open() {
    const live=()=>{if(this.closed)throw Error("Conversation cancelled during startup");};
    await speechCatalog.prepare(this.speechChoice);live();
    await this.relay.command('start');live();
    await rooms.createRoom({name:this.name,maxParticipants:2,emptyTimeout:60,departureTimeout:20});live();
    await this.room.connect('ws://127.0.0.1:7880',await jwt(this.name,`agent-${this.id}`,true),{autoSubscribe:true,dynacast:false});live();
    this.room.on(RoomEvent.TrackSubscribed,(track,publication,participant)=>{
      if(participant.identity===this.identity&&publication.source===TrackSource.SOURCE_MICROPHONE)void this.meterInput(track as RemoteAudioTrack).catch(()=>this.event('input-audio-error',{kind:'capture-meter-start'}));
    });
    this.room.on(RoomEvent.TrackMuted,(publication,participant)=>{if(participant.identity===this.identity&&publication.source===TrackSource.SOURCE_MICROPHONE)this.event('microphone-track',{inputMuted:true});});
    this.room.on(RoomEvent.TrackUnmuted,(publication,participant)=>{if(participant.identity===this.identity&&publication.source===TrackSource.SOURCE_MICROPHONE)this.event('microphone-track',{inputMuted:false});});
    this.room.on(RoomEvent.ParticipantDisconnected, p=>{if(p.identity===this.identity) void this.close();});
    this.session.on(voice.AgentSessionEventTypes.SpeechCreated,e=>{this.relay.activeSpeech=e.speechHandle;this.event('speech-created',{allowInterruptions:e.speechHandle.allowInterruptions});});
    this.session.on(voice.AgentSessionEventTypes.MetricsCollected,({metrics:m})=>{
      if(m.type==='tts_metrics')this.event('synthesis-metrics',{ttfbMs:m.ttfbMs,durationMs:m.durationMs,audioMs:m.audioDurationMs,charactersCount:m.charactersCount,cancelled:m.cancelled,streamed:m.streamed});
    });
    this.session.on(voice.AgentSessionEventTypes.AgentStateChanged,e=>this.event('agent-state',{state:e.newState}));
    this.session.on(voice.AgentSessionEventTypes.UserStateChanged,e=>{
      this.event('user-state',{state:e.newState});
      if(e.newState==='speaking')this.backgroundEpoch++;
    });
    this.session.on(voice.AgentSessionEventTypes.AgentFalseInterruption,()=>this.event('false-interruption-resumed'));
    this.session.on(voice.AgentSessionEventTypes.Error,()=>this.event('error',{text:'Voice pipeline failed. End and restart the conversation.',kind:'pipeline'}));
    this.session.on(voice.AgentSessionEventTypes.Close,()=>{if(!this.closed) void this.close();});
    this.ready = this.session.start({agent:this.agent,room:this.room,inputOptions:{participantIdentity:this.identity,audioSampleRate:16000,textEnabled:false},outputOptions:{audioSampleRate:24000,syncTranscription:true}});
    void this.ready.catch(()=>{this.event('error',{kind:'start',text:'Voice session could not start.'});void this.close();});
    this.heartbeat=setInterval(()=>{
      if(Date.now()-this.touched>90000) {void this.close();return;}
      void this.relay.command('heartbeat').catch(()=>{this.event('error',{kind:'ownership',text:'Conversation ownership expired.'});void this.close();});
    },10000);
    this.event('connected');
    this.event('speech-profile',this.speechChoice?{provider:this.speechChoice.provider,model:this.speechChoice.model,voice:this.speechChoice.voice,speed:this.speechChoice.speed}:{provider:'local',model:'pocket-tts',voice:'alfred',speed:1.25});
    const turnSecret=await readFile(config.turnSecretPath,'utf8');
    const username=`${Math.floor(Date.now()/1000)+3600}:jarvis-livekit`;
    return {id:this.id,controlToken:this.secret,speech:this.speechChoice?{...this.speechChoice}:{label:'Alfred · local',speed:1.25},token:await jwt(this.name,this.identity),iceServers:[{urls:[config.turnUrl],username,credential:createHmac('sha1',turnSecret.trim()).update(username).digest('base64')}]};
  }
  async start() {
    if(this.started) return;
    this.started=true; await this.ready;
    try {
      await this.controls.run(async current=>{
        if(sampleBriefing){
          const paused=await this.relay.command('watch',{enabled:false});
          await this.relay.acknowledge(paused,'delivered');
          if(current()){
            this.event('briefing',{kind:'sample'});
            await this.agent.speakSample(sampleBriefing);
          }
          return;
        }
        const watching=await this.relay.command('watch',{enabled:true});
        await this.relay.acknowledge(watching,'delivered');
        if(!current())return;
        this.event('briefing');
        const state=await this.relay.command('brief');
        if(current())await this.agent.speakState(state);
        else await this.relay.acknowledge(state,'interrupted');
      });
    } finally {
      if(!this.closed)this.watcher=setInterval(()=>void this.poll(),3000);
    }
  }
  idle() {return !this.closed && !this.controls.busy && !this.relay.busy && this.session.agentState==='listening' && this.session.userState!=='speaking' && (!this.relay.activeSpeech || this.relay.activeSpeech.done());}
  async poll() {
    if(!this.idle() || this.polling)return;
    this.polling=true; const epoch=this.backgroundEpoch;
    try {
      const state=await this.relay.command('next');
      // User speech takes priority. Unclaimed updates remain pending in the relay
      // and are refreshed/revalidated before a subsequent delivery attempt.
      if(epoch===this.backgroundEpoch && this.idle() && state.utterance)await this.agent.speakState(state);
    } catch {if(!this.closed)this.event('update-error',{text:'Updates could not refresh; retrying automatically.'});}
    finally {this.polling=false;}
  }
  async command(action:string,args:Record<string,unknown>={}) {
    const stopping=action==='stop-work';
    await this.controls.run(async current=>{
      this.backgroundEpoch++;
      // A broken media session must never prevent dispatch of scoped stop.
      try {this.session.interrupt();}
      catch {this.event('update-error',{text:'Audio could not be interrupted; sending the work control.'});}
      const state=await this.relay.command(stopping?'talk':action,stopping?{text:'stop work'}:args);
      if(current())await this.agent.speakState(state);
      else await this.relay.acknowledge(state,'interrupted');
    },{preempt:true});
  }
  async close() {
    if(this.closed) return; this.closed=true; this.controls.close();
    clearInterval(this.heartbeat); clearInterval(this.watcher); sessions.delete(this.id);
    this.event('closing');
    await Promise.allSettled([this.inputReader?.cancel(),this.session.close(),this.relay.command('close')]);
    await this.tts?.close().catch(()=>log(this.id,'tts-close-failed'));
    await this.room.disconnect().catch(()=>{});
    await rooms.deleteRoom(this.name).catch(()=>{});
    log(this.id,'closed');
  }
}
async function jsonBody(req:IncomingMessage) {
  let size=0; const parts:Buffer[]=[];
  for await(const chunk of req) {size+=chunk.length;if(size>8192)throw Error('Request too large');parts.push(chunk);}
  return JSON.parse(Buffer.concat(parts).toString()||'{}') as Record<string,unknown>;
}
const server=createServer(async(req,res)=>{
  const send=(status:number,body:unknown,type='application/json')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body);};
  try {
    if(!equal(req.headers.authorization??'',`Bearer ${config.relayToken}`)) {send(401,{error:'Unauthorized'});return;}
    if(req.method==='GET'&&req.url==='/browser.js'){send(200,await readFile(new URL('./browser.bundle.js',import.meta.url)),'application/javascript');return;}
    if(req.method==='GET'&&req.url==='/health'){send(200,{ok:true,framework:'livekit-agents-node',sessions:sessions.size});return;}
    if(req.method!=='POST'){send(405,{error:'Method not allowed'});return;}
    const body=await jsonBody(req);
    if(req.url==='/voices'){send(200,{...speechCatalog.describe(),sampleBriefing});return;}
    if(req.url==='/session') {
      if(sessions.size) {send(409,{error:'A LiveKit conversation is already active. End it first or wait 90 seconds for cleanup.'});return;}
      if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id)||typeof body.controlToken!=='string'||!/^[a-f0-9-]{36}$/.test(body.controlToken)){send(400,{error:'Invalid startup reservation'});return;}
      const connection=new Connection(speechCatalog.select(body),{id:body.id,controlToken:body.controlToken}); sessions.set(connection.id,connection);
      try {send(200,await connection.open());}catch(e){await connection.close();throw e;}return;
    }
    const c=sessions.get(String(body.id));
    if(!c&&req.url==='/close'){send(200,{ok:true});return;}
    if(!c||!equal(String(body.controlToken??''),c.secret)){send(403,{error:'Conversation expired'});return;}
    c.touched=Date.now();
    if(req.url==='/ready'){void c.start().catch(()=>c.event('error',{kind:'brief',text:'Jarvis could not prepare the briefing.'}));send(200,{ok:true});return;}
    if(req.url==='/text'){
      if(typeof body.text!=='string'||!body.text.trim()||body.text.length>8000){send(400,{error:'Enter a message of at most 8000 characters.'});return;}
      c.backgroundEpoch++;c.session.interrupt();c.session.generateReply({userInput:body.text});send(200,{ok:true});return;
    }
    if(req.url==='/command'){
      if(!['brief','questions','watch','quiet','stop-work'].includes(String(body.action))){send(400,{error:'Unknown command'});return;}
      if(['watch','quiet'].includes(String(body.action))&&typeof body.enabled!=='boolean'){send(400,{error:'Invalid mode'});return;}
      void c.command(String(body.action),['watch','quiet'].includes(String(body.action))?{enabled:body.enabled}:{}).catch(()=>c.event('error',{kind:'command',text:'Command failed; inspect the current state before retrying.'}));send(200,{ok:true});return;
    }
    if(req.url==='/tasks'){
      const r=await c.relay.request('tasks','{}','application/json');send(200,await r.json());return;
    }
    if(req.url==='/telemetry'){
      const detail=body.detail&&typeof body.detail==='object'?body.detail as Record<string,unknown>:{};
      const safe=Object.fromEntries(Object.entries(detail).filter(([,v])=>typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v))));
      log(c.id,body.input===true?'browser-microphone':'browser-media',safe);send(200,{ok:true});return;
    }
    if(req.url==='/heartbeat'){send(200,{ok:true});return;}
    if(req.url==='/close'){await c.close();send(200,{ok:true});return;}
    if(req.url==='/stop-speaking'){c.session.interrupt();send(200,{ok:true});return;}
    send(404,{error:'Not found'});
  } catch(e) {if(e instanceof SpeechSelectionError){send(e.status,{error:e.message});return;}log('service','request-failed',{kind:e instanceof Error?e.message:'unknown'});send(502,{error:'Voice request failed; check Jarvis diagnostics.'});}
});
server.listen(4846,'127.0.0.1',()=>log('service','ready'));
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{server.close();void Promise.allSettled([...sessions.values()].map(c=>c.close())).finally(()=>process.exit(0));});
