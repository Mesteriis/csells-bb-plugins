// Optional macOS fixture generator. The audit itself accepts ordinary WAV files.
// These are artificial test inputs; they do not qualify a physical microphone.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const out=process.env.JARVIS_AUDIT_DIR;if(!out)throw Error('Set JARVIS_AUDIT_DIR');
const cases=JSON.parse(fs.readFileSync(new URL('./jarvis-audit-cases.json',import.meta.url)));
fs.mkdirSync(out,{recursive:true});const manifest=[];
for(const c of cases){const file=path.join(out,c.id+'.wav');await promisify(execFile)('say',['--file-format=WAVE','--data-format=LEI16@16000','-o',file,c.text]);const b=fs.readFileSync(file);if(b.length<8000||b.toString('ascii',0,4)!=='RIFF')throw Error(`Invalid fixture: ${c.id}`);manifest.push({id:c.id,text:c.text,sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length});}
fs.writeFileSync(path.join(out,'fixture-manifest.json'),JSON.stringify({generator:'macOS say default system voice, mono PCM16 16000Hz',fixtures:manifest},null,2));
