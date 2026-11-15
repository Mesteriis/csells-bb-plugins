import { randomUUID } from 'node:crypto';
import { ReadableStream, type ReadableStreamReadResult } from 'node:stream/web';
import { mergeFrames, asLanguageCode, stt, voice, DEFAULT_API_CONNECT_OPTIONS, type AudioBuffer, llm } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';

export type State = {watch?:boolean; quiet?:boolean; pending?:number; owner?: {leaseKey: string}; focus?: {binding: string; displayText: string}; utterance?: {id: string; kind?:string; text: string; playbackClaim: string}};
export type EventSink = (phase: string, detail?: Record<string, unknown>) => void;
export class Relay {
  readonly clientId = randomUUID();
  lease = '';
  focus?: string;
  activeSpeech?: voice.SpeechHandle;
  busy = 0;
  constructor(readonly token: string, readonly event: EventSink) {}
  headers() { return {authorization: this.token, 'x-jarvis-client': this.clientId, 'x-jarvis-lease': this.lease}; }
  async request(path: string, body: BodyInit, contentType: string, signal?: AbortSignal) {
    const deadline = new AbortController();
    const timer = setTimeout(()=>deadline.abort(),path==='speech'?10000:60000);
    let r: Response;
    try {
      r = await fetch(`http://127.0.0.1:4842/${path}`, {method:'POST', headers: {...this.headers(), 'content-type':contentType}, body, signal: AbortSignal.any([deadline.signal, ...(signal ? [signal] : [])])});
    } finally {clearTimeout(timer);}
    if (!r.ok) { await r.body?.cancel(); throw Error(`${path} failed (${r.status})`); }
    return r;
  }
  async command(action: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<State> {
    const r = await this.request('assistant', JSON.stringify({action, clientId:this.clientId, ...args}), 'application/json', signal);
    const state = await r.json() as State;
    this.lease = state.owner?.leaseKey ?? this.lease;
    this.event("conversation-state", {watch:state.watch,quiet:state.quiet,pending:state.pending});
    return state;
  }
  async acknowledge(state: State, status: 'delivered'|'interrupted'|'failed') {
    if(!state.utterance)return;
    try {await this.command('ack',{utteranceId:state.utterance.id,playbackClaim:state.utterance.playbackClaim,status});}
    catch {this.event('delivery-superseded',{utteranceId:state.utterance.id});}
  }
  track(state:State,speech?:voice.SpeechHandle) {
    if(!speech)return;
    void speech.waitForPlayout().then(async()=>{
      const status=speech.interrupted?'interrupted':speech.exception()?'failed':'delivered';
      this.event('playout-ended',{interrupted:speech.interrupted,utteranceId:state.utterance?.id});
      await this.acknowledge(state,status);
    }).catch(()=>this.acknowledge(state,'failed'));
  }
  present(state: State) {
    this.focus = state.focus?.binding;
    this.event('response', {kind:state.utterance?.kind,text:state.utterance?.text ?? '', question:state.focus?.displayText ?? '', utteranceId:state.utterance?.id});
  }
}

export function wav(frame: AudioFrame): Buffer {
  const pcm = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(frame.channels,22);
  header.writeUInt32LE(frame.sampleRate,24); header.writeUInt32LE(frame.sampleRate * frame.channels * 2,28);
  header.writeUInt16LE(frame.channels * 2,32); header.writeUInt16LE(16,34);
  header.write('data',36); header.writeUInt32LE(pcm.length,40);
  return Buffer.concat([header,pcm]);
}
export class BBSTT extends stt.STT {
  label = 'bb.configured-stt';
  constructor(readonly relay: Relay) { super({streaming:false, interimResults:false}); }
  stream(): stt.SpeechStream { throw Error('Use LiveKit’s VAD stream adapter for batch STT'); }
  async _recognize(buffer: AudioBuffer, signal?: AbortSignal): Promise<stt.SpeechEvent> {
    const started = performance.now();
    const frame = mergeFrames(buffer);
    const response = await this.relay.request('transcribe', new Uint8Array(wav(frame)).buffer, 'audio/wav', signal);
    const result = await response.json() as {text?:string};
    const text = result.text?.trim() ?? '';
    this.relay.event('transcribed', {text, durationMs:Math.round(performance.now()-started), audioMs:Math.round(frame.samplesPerChannel/frame.sampleRate*1000)});
    return {type:stt.SpeechEventType.FINAL_TRANSCRIPT, alternatives:[{text, language:asLanguageCode('en'), startTime:0, endTime:frame.samplesPerChannel/frame.sampleRate, confidence:1}]};
  }
}

// Convert the existing provider's wire framing only. LiveKit owns pacing, buffering,
// pause/resume, interruption, RTP and captions. No audio is persisted here.
async function* chunks(body: ReadableStream<Uint8Array>) {
  const reader=body.getReader();
  try {
    while(true) {
      let timer:ReturnType<typeof setTimeout>|undefined;
      let next:ReadableStreamReadResult<Uint8Array>;
      try {
        next=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Alfred stream stalled')),20000);})]);
      } finally {clearTimeout(timer);}
      if(next.done)return;
      yield next.value;
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function* decodePCM(body: ReadableStream<Uint8Array>): AsyncGenerator<AudioFrame> {
  let carry = Buffer.alloc(0), ended = false;
  for await (const bytes of chunks(body)) {
    carry = Buffer.concat([carry, bytes]);
    while (carry.length >= 4) {
      const length = carry.readUInt32BE(0);
      if (length === 0) { ended = true; break; }
      if (length > 1048576 || length % 2) throw Error('Invalid Alfred PCM frame');
      if (carry.length < 4 + length) break;
      const pcm = carry.subarray(4,4+length);
      // 20ms chunks are conversion units, not an application playback queue.
      for (let offset=0; offset<pcm.length; offset+=960) {
        const chunk = pcm.subarray(offset, offset+960);
        const samples = new Int16Array(chunk.length/2);
        for (let i=0; i<samples.length; i++) samples[i]=chunk.readInt16LE(i*2);
        yield new AudioFrame(samples,24000,1,samples.length);
      }
      carry = carry.subarray(4+length);
    }
    if (ended) break;
  }
  if (!ended) throw Error('Alfred stream ended without successful completion');
}
function generated<T>(make: (signal: AbortSignal)=>AsyncGenerator<T>): ReadableStream<T> {
  const abort = new AbortController();
  const iterator = make(abort.signal);
  let cancelled = false;
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const item = await iterator.next();
        if (cancelled) return;
        if (item.done) controller.close(); else controller.enqueue(item.value);
      } catch (error) { if (!cancelled) controller.error(error); }
    },
    async cancel() { cancelled=true; abort.abort(); await iterator.return(undefined); },
  });
}
export class BBDirector extends llm.LLM {
  constructor(readonly relay: Relay) { super(); }
  label() { return 'bb.jarvis-director'; }
  chat(options: Parameters<llm.LLM['chat']>[0]): llm.LLMStream {
    return new BBDirectorStream(this,options);
  }
}
class BBDirectorStream extends llm.LLMStream {
  constructor(readonly director: BBDirector, options: Parameters<llm.LLM['chat']>[0]) {
    // A director request can dispatch a directed answer: never retry it implicitly.
    super(director,{...options,connOptions:{...DEFAULT_API_CONNECT_OPTIONS,...options.connOptions,maxRetry:0}});
  }
  async run() {
    const message=[...this.chatCtx.items].reverse().find(item=>item.type==='message'&&item.role==='user');
    const text=message?.type==='message'?message.textContent:undefined;
    if(!text)return;
    const relay=this.director.relay;
    const speech=relay.activeSpeech;
    relay.busy++;
    try {
      const state=await relay.command('talk',{text,requestId:randomUUID(),...(relay.focus?{presentedQuestion:relay.focus}:{})},this.abortController.signal);
      relay.present(state); relay.track(state,speech);
      if(state.utterance)this.queue.put({id:state.utterance.id,delta:{role:'assistant',content:state.utterance.text}});
    } finally {relay.busy--;}

  }
}
export class JarvisAgent extends voice.Agent {
  constructor(readonly relay: Relay) { super({instructions:'Coordinate Chris’s real BB sessions through the restricted Jarvis relay.'}); }
  async ttsNode(text: ReadableStream<string> | AsyncIterable<string>): Promise<ReadableStream<AudioFrame>> {
    const relay = this.relay;
    return generated(async function* (signal) {
      let pending = '';
      // The current director returns a complete response; preserve it intact across
      // provider request limits. This does not pretend the BB model streams tokens.
      for await (const part of text) pending += part;
      while (pending.trim()) {
        let cut = pending.length <= 1800 ? pending.length : pending.lastIndexOf(' ',1800);
        if (cut <= 0) cut = 1800;
        const segment = pending.slice(0,cut); pending = pending.slice(cut);
        const response = await relay.request('speech', JSON.stringify({text:segment}), 'application/json', signal);
        const reader = decodePCM(response.body! as unknown as ReadableStream<Uint8Array>);
        let samples = 0;
        try { for await (const frame of reader) { samples += frame.samplesPerChannel; yield frame; } }
        finally { await reader.return(undefined); }
        relay.event('synthesized', {audioMs:Math.round(samples/24)});
      }
    });
  }
  async speakState(state: State) {
    this.relay.present(state);
    if (!state.utterance) return;
    const item = state.utterance;
    const text = new ReadableStream<string>({start(c){c.enqueue(item.text);c.close();}});
    const audio = await this.ttsNode(text);
    const speech = this.session.say(item.text, {audio, allowInterruptions:true});
    this.relay.track(state,speech);
    await speech.waitForPlayout();
  }
}
