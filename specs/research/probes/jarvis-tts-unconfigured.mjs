// Exercise an actual candidate configured with hosted profiles but no API keys.
// No provider responses or BB records are substituted.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const need=n=>{if(!process.env[n])throw Error(`Set ${n}`);return process.env[n];};
const {chromium}=await import(pathToFileURL(need('JARVIS_PLAYWRIGHT_MODULE')).href);
const browser=await chromium.launch({executablePath:need('JARVIS_CHROME'),headless:true});
const out=need('JARVIS_AUDIT_DIR'),result={at:new Date().toISOString(),checks:[],errors:[]};let frame;
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>result.errors.push(String(e)));
 await page.goto(need('JARVIS_REVIEW_URL'));await page.frameLocator('iframe[title="Jarvis conversation"]').locator('#voice').waitFor();frame=page.frames().find(f=>f.url().endsWith('/livekit'));
 await frame.waitForFunction(()=>document.querySelector('#error').textContent.includes('API key'));
 assert(await frame.locator('#start').isDisabled());assert(await frame.locator('#text-start').isEnabled());
 assert.equal(await frame.locator('#voice option:disabled').count(),2);
 assert.equal(await frame.locator('#voice option[value="alfred"]').count(),0);
 result.checks.push('unavailable providers are explicit; no silent Alfred fallback');
 const denied=await frame.evaluate(async()=>{const r=await fetch('livekit-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({voice:'cartesia',speed:1.25})});return {status:r.status,body:await r.json()};});
 assert.equal(denied.status,503);assert.match(denied.body.error,/not configured/);result.checks.push('server refuses unconfigured synthesis before acquiring a session');
 assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(out,'missing-keys.png'),fullPage:true});
 await frame.locator('#text-start').click();await frame.waitForFunction(()=>document.querySelector('#state').textContent==='Ready · text only');
 assert.equal(await frame.locator('#media audio').count(),0);result.checks.push('text controls remain available without a voice provider');
 assert.deepEqual(result.errors,[]);console.log(JSON.stringify(result));
}catch(e){result.failure=String(e);console.error(e);process.exitCode=1;}
finally{try{if(frame&&await frame.locator('#end').isEnabled())await frame.locator('#end').click();fs.writeFileSync(path.join(out,'missing-keys.json'),JSON.stringify(result,null,2));}finally{await browser.close();}}
