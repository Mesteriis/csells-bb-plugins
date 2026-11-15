import {LocalTTS} from './local-tts.js';

type Profile={id:string;label:string;provider:'self-hosted';voice:string;model:string;endpoint:string;available:boolean};
export type SpeechSelection=Omit<Profile,'endpoint'|'available'> & {speed:number};
export class SpeechSelectionError extends Error {
  constructor(message:string,readonly status=400){super(message);}
}
/** Clients choose IDs and pace. Local addresses remain in server-owned configuration. */
export class SpeechCatalog {
  private profiles:Profile[]=[];
  private defaultVoice='alfred';
  constructor(config:unknown){
    if(config===undefined)return;
    if(!config||typeof config!=='object')throw Error('Invalid speech configuration');
    const value=config as Record<string,unknown>;
    if(!Array.isArray(value.voices)||!value.voices.length)throw Error('Configure at least one speech voice');
    const ids=new Set<string>();
    for(const p of value.voices){
      if(!p||typeof p!=='object'||p.provider!=='self-hosted'||
        !['id','label','voice','model','endpoint'].every(k=>typeof p[k]==='string'&&p[k].trim().length>0&&p[k].length<200)||
        !/^[a-z0-9-]+$/.test(p.id)||ids.has(p.id))throw Error('Invalid or duplicate speech profile');
      const endpoint=new URL(p.endpoint);
      if(endpoint.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('Speech endpoint must use a loopback HTTP service or tunnel');
      ids.add(p.id);this.profiles.push({id:p.id,label:p.label,provider:p.provider,voice:p.voice,model:p.model,endpoint:p.endpoint,available:p.available!==false});
    }
    if(typeof value.defaultVoice!=='string'||!ids.has(value.defaultVoice))throw Error('Unknown default speech voice');
    this.defaultVoice=value.defaultVoice;
  }
  describe(){return {defaultVoice:this.defaultVoice,defaultSpeed:1.25,voices:this.profiles.length?
    this.profiles.map(p=>({id:p.id,label:p.label,available:p.available})):
    [{id:'alfred',label:'Alfred · Pocket baseline',available:true}]};}
  select(input:Record<string,unknown>):SpeechSelection|undefined {
    const id=input.voice===undefined?this.defaultVoice:input.voice;
    const speed=input.speed===undefined?1.25:input.speed;
    if(typeof speed!=='number'||![1,1.25,1.4].includes(speed))throw new SpeechSelectionError('Choose a supported speech pace');
    if(!this.profiles.length&&id==='alfred'){if(speed!==1.25)throw new SpeechSelectionError('Pocket baseline supports the Brisk preset only');return undefined;}
    const profile=this.profiles.find(p=>p.id===id);
    if(!profile)throw new SpeechSelectionError('Unknown voice');
    if(!profile.available)throw new SpeechSelectionError(`${profile.label} is not ready for conversation.`,503);
    const {endpoint,available,...safe}=profile;return {...safe,speed};
  }
  async prepare(selected?:SpeechSelection):Promise<void>{
    if(!selected)return;
    const profile=this.profiles.find(p=>p.id===selected.id);
    if(!profile?.available)throw new SpeechSelectionError('Local voice unavailable',503);
    const response=await fetch(new URL('prepare',profile.endpoint),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:profile.model}),signal:AbortSignal.timeout(50000)});
    if(!response.ok){await response.body?.cancel();throw new SpeechSelectionError(`${profile.label} could not become ready.`,503);}
    await response.body?.cancel();
  }
  create(selected:SpeechSelection):LocalTTS {
    const profile=this.profiles.find(p=>p.id===selected.id);
    if(!profile?.available)throw new SpeechSelectionError('Local voice unavailable',503);
    return new LocalTTS(profile.endpoint,profile.model,profile.voice,selected.speed);
  }
}
