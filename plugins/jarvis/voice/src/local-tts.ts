import {randomUUID} from 'node:crypto';
import {tts, DEFAULT_API_CONNECT_OPTIONS, type APIConnectOptions} from '@livekit/agents';
import {decodePCM} from './relay.js';
import type {ReadableStream} from 'node:stream/web';

/** Transport only: official engines synthesize; LiveKit owns buffering and interruption. */
export class LocalTTS extends tts.TTS {
  label='jarvis.self-hosted';
  constructor(readonly endpoint:string,readonly modelId:string,readonly voice:string,readonly speed:number){
    super(24000,1,{streaming:false});
  }
  private tail:Promise<void>=Promise.resolve();
  async acquire(signal:AbortSignal):Promise<()=>void>{
    const previous=this.tail;let release!:()=>void;
    this.tail=new Promise<void>(resolve=>{release=resolve;});
    let onAbort!:()=>void;
    const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(signal.reason??Error('Cancelled'));signal.addEventListener('abort',onAbort,{once:true});});
    try {signal.throwIfAborted();await Promise.race([previous,aborted]);signal.throwIfAborted();return release;}
    catch(error){void previous.then(release);throw error;}
    finally{signal.removeEventListener('abort',onAbort);}
  }
  synthesize(text:string,options?:APIConnectOptions,signal?:AbortSignal){return new LocalStream(this,text,options,signal);}
  stream():tts.SynthesizeStream {throw Error('Use LiveKit sentence streaming adapter');}
}
class LocalStream extends tts.ChunkedStream {
  label='jarvis.self-hosted.stream';
  constructor(readonly local:LocalTTS,readonly text:string,options?:APIConnectOptions,signal?:AbortSignal){
    super(text,local,{...DEFAULT_API_CONNECT_OPTIONS,...options,maxRetry:0},signal);
  }
  async run(){
    try { await this.synthesizeLocal(); }
    catch(error){if(!this.abortSignal.aborted)throw error;}
  }
  private async synthesizeLocal(){
    const id=randomUUID();
    const release=await this.local.acquire(this.abortSignal);
    const signal=AbortSignal.any([this.abortSignal,AbortSignal.timeout(60000)]);
    try {
    const response=await fetch(this.local.endpoint,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({text:this.text,model:this.local.modelId,voice:this.local.voice,speed:this.local.speed}),signal});
    if(!response.ok){await response.body?.cancel();throw Error(`Local synthesis failed (${response.status})`);}
    if(response.headers.get('content-type')!=='application/x-jarvis-pcm'||!response.body){await response.body?.cancel();throw Error('Unexpected local speech format');}
    const audio=decodePCM(response.body as unknown as ReadableStream<Uint8Array>);
    try {for await(const frame of audio){if(signal.aborted)break;this.queue.put({requestId:id,segmentId:id,frame,final:false});}}
    finally{await audio.return(undefined);}
    }finally{release();}
  }
}
