import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
const {chromium}=await import(pathToFileURL(process.env.JARVIS_PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({executablePath:process.env.JARVIS_CHROME,headless:true});
const evidence={at:new Date().toISOString(),checks:[]};let frame,orphan;
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();await c.resume();return c.createMediaStreamDestination().stream;};});
 await page.goto('http://127.0.0.1:4840/plugins/jarvis/staff');
 await page.frameLocator('iframe[title="Jarvis conversation"]').locator('#start').waitFor();frame=page.frames().find(f=>f.url().endsWith('/livekit'));
 await frame.waitForFunction(()=>!document.querySelector('#start').disabled);
 await frame.locator('#voice').selectOption('qwen-alfred');
 await page.route('**/livekit-session',async route=>{const r=await route.fetch({timeout:60000});orphan=await r.json();await route.abort('failed');},{times:1});
 await frame.locator('#start').click();
 await frame.waitForFunction(()=>document.querySelector('#state').textContent==='Ended',undefined,{timeout:70000});
 await frame.locator('#voice').selectOption('kokoro-george');await frame.locator('#start').click();
 await frame.waitForFunction(()=>document.querySelector('#answer').textContent.startsWith('Good evening')||document.querySelector('#error').textContent,undefined,{timeout:60000});
 assert.equal(await frame.locator('#error').textContent(),'');evidence.checks.push('Lost Qwen session response released reservation; Kokoro restarted');
 await frame.waitForFunction(()=>document.querySelector('#state').textContent==='Jarvis is speaking',undefined,{timeout:30000});
 await frame.locator('#end').click();await frame.waitForFunction(()=>document.querySelector('#state').textContent==='Ended');
 await frame.locator('#voice').selectOption('qwen-alfred');await frame.locator('#start').click();
 await frame.waitForFunction(()=>document.querySelector('#state').textContent==='Jarvis is speaking',undefined,{timeout:60000});
 await frame.locator('#stop').click();await frame.locator('#end').click();await frame.waitForFunction(()=>document.querySelector('#state').textContent==='Ended');
 await frame.locator('#voice').selectOption('kokoro-george');await frame.locator('#start').click();
 await frame.waitForFunction(()=>document.querySelector('#state').textContent==='Jarvis is speaking'||document.querySelector('#error').textContent,undefined,{timeout:60000});
 assert.equal(await frame.locator('#error').textContent(),'');evidence.checks.push('Stop Qwen, End, immediately restart Kokoro');
}catch(e){evidence.failure=String(e);process.exitCode=1;}
finally{
 if(frame){await frame.locator('#end').click({timeout:2000}).catch(()=>{});if(orphan?.id)await frame.evaluate(async c=>{await fetch('livekit-close',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:c.id,controlToken:c.controlToken})});},orphan).catch(()=>{});}
 await browser.close();fs.writeFileSync(process.env.JARVIS_RECOVERY_EVIDENCE,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
