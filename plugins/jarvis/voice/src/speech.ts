import type {tts} from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as inworld from '@livekit/agents-plugin-inworld';

type Profile = {id:string;label:string;provider:'cartesia'|'inworld';voice:string;model:string};
export type SpeechSelection = Profile & {speed:number};
export class SpeechSelectionError extends Error {
  constructor(message:string,readonly status=400){super(message);}
}
/** Server-owned catalog. Clients select IDs and pace, never provider endpoints or secrets. */
export class SpeechCatalog {
  private profiles:Profile[]=[];
  private defaultVoice='alfred';
  constructor(config:unknown,private readonly env:NodeJS.ProcessEnv=process.env){
    if(config===undefined)return; // Explicit legacy installation, not provider failure fallback.
    if(!config||typeof config!=='object')throw Error('Invalid speech configuration');
    const value=config as Record<string,unknown>;
    if(!Array.isArray(value.voices)||!value.voices.length)throw Error('Configure at least one speech voice');
    const ids=new Set<string>();
    for(const p of value.voices){
      if(!p||typeof p!=='object'||!['cartesia','inworld'].includes(p.provider)||
        !['id','label','voice','model'].every(k=>typeof p[k]==='string'&&p[k].trim().length>0&&p[k].length<200)||
        !/^[a-z0-9-]+$/.test(p.id)||ids.has(p.id))throw Error('Invalid or duplicate speech profile');
      ids.add(p.id);this.profiles.push({id:p.id,label:p.label,provider:p.provider,voice:p.voice,model:p.model});
    }
    if(typeof value.defaultVoice!=='string'||!ids.has(value.defaultVoice))throw Error('Unknown default speech voice');
    this.defaultVoice=value.defaultVoice;
  }
  private key(p:Profile){return this.env[p.provider==='cartesia'?'CARTESIA_API_KEY':'INWORLD_API_KEY']?.trim();}
  describe(){return {defaultVoice:this.defaultVoice,defaultSpeed:1.25,voices:this.profiles.length?
    this.profiles.map(p=>({id:p.id,label:p.label,available:!!this.key(p)})):
    [{id:'alfred',label:'Alfred · local',available:true}]};}
  select(input:Record<string,unknown>):SpeechSelection|undefined {
    const id=input.voice===undefined?this.defaultVoice:input.voice;
    const speed=input.speed===undefined?1.25:input.speed;
    if(typeof speed!=='number'||!Number.isFinite(speed)||speed<0.6||speed>1.5)throw new SpeechSelectionError('Choose a speech pace between 0.6 and 1.5');
    if(!this.profiles.length&&id==='alfred'){if(speed!==1.25)throw new SpeechSelectionError('The legacy Alfred voice supports the Brisk preset only');return undefined;}
    const profile=this.profiles.find(p=>p.id===id);
    if(!profile)throw new SpeechSelectionError('Unknown voice');
    if(!this.key(profile))throw new SpeechSelectionError(`${profile.label} is not configured. Add its staging API key.`,503);
    return {...profile,speed};
  }
  create(selected:SpeechSelection):tts.TTS {
    const apiKey=this.key(selected);
    if(!apiKey)throw new SpeechSelectionError(`${selected.label} is not configured. Add its staging API key.`,503);
    if(selected.provider==='cartesia')return new cartesia.TTS({apiKey,model:selected.model,voice:selected.voice,speed:selected.speed,sampleRate:24000,encoding:'pcm_s16le'});
    return new inworld.TTS({apiKey,model:selected.model,voice:selected.voice,speakingRate:selected.speed,sampleRate:24000,encoding:'PCM',deliveryMode:'STABLE'});
  }
}
