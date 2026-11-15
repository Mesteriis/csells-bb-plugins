import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { createCoordinator } from '../coordinator.mjs';

// Contract doubles test failure paths only; staging must use real BB sessions.
function fixture(overrides = {}) {
  let saved = { version: 1, tasks: {} };
  const calls = [];
  const rows = [];
  const sdk = { threads: {
    list: async () => rows,
    get: async ({threadId}) => rows.find(r => r.id === threadId),
    spawn: async args => { calls.push(args); const row = {id:'owned', ...args, environmentId:args.environment.environmentId, status:'idle', visibility:'visible'}; rows.push(row); return row; },
    getPluginMetadata: async () => ({owner:'test', operationId:'one'}),
    ...overrides,
  }};
  const store = {read: async () => structuredClone(saved), write: async s => { saved = structuredClone(s); }};
  const config = {owner:'test', projectId:'project', environmentId:'env', providerId:'provider', maxTasks:10};
  return {sdk, calls, rows, store, config, make: () => createCoordinator({sdk,store,config})};
}
test('concurrent duplicate submission dispatches once and rejects changed intent', async () => {
  const f = fixture(); const c = f.make();
  const [a,b] = await Promise.all([c.delegate({operationId:'one',prompt:'Read status'}), c.delegate({operationId:'one',prompt:'Read status'})]);
  assert.equal(a.threadId,b.threadId); assert.equal(f.calls.length,1);
  await assert.rejects(c.delegate({operationId:'one',prompt:'Change status'}), /different request/);
  assert.equal(f.calls[0].environment.environmentId,'env');
});
test('lost spawn reply remains uncertain across restart; never automatically reexecutes', async () => {
  let dispatches=0;
  const f=fixture({spawn:async()=>{dispatches++;throw Error('lost reply');}});
  const first=await f.make().delegate({operationId:'one',prompt:'Read status'});
  assert.equal(first.dispatch,'unknown');
  const restarted=await f.make().delegate({operationId:'one',prompt:'Read status'});
  assert.equal(restarted.dispatch,'unknown'); assert.equal(dispatches,1);
});
test('unrelated mutation is denied before reaching BB', async () => {
  let stops=0; const f=fixture({stop:async()=>{stops++;}});
  await assert.rejects(f.make().stop({operationId:'not-owned'}), /Unknown task/);
  assert.equal(stops,0);
});
test('visibility filters are applied again to returned rows', async()=>{
  const f=fixture(); f.rows.push({id:'visible',visibility:'visible'}, {id:'hidden',visibility:'hidden'}, {id:'child',visibility:'visible',parentThreadId:'parent'}, {id:'archived',visibility:'visible',archivedAt:1});
  assert.deepEqual((await f.make().sessions()).map(r=>r.id),['visible']);
});
test('stop acknowledgements do not establish observed termination', async()=>{
  const f=fixture({stop:async()=>({ok:true}), experimental_listDescendants:async()=>({threads:[]}), queuedMessages:{list:async()=>[],delete:async()=>({ok:true})},interactions:{list:async()=>[],cancel:async()=>({})}});
  const c=f.make(); await c.delegate({operationId:'one',prompt:'Read status'}); f.rows[0].status='active';
  const result=await c.stop({operationId:'one'});
  assert.equal(result.cancellation,'unconfirmed');
  assert.equal(result.dispatchEnabled,false);
});
test('approval is bound to current payload and concurrent decisions resolve once',async()=>{
  const approval={id:'approval',threadId:'owned',status:'pending',payload:{kind:'approval',subject:{command:'read'}}};
  let resolutions=0;
  const f=fixture({interactions:{get:async()=>structuredClone(approval),resolve:async()=>{resolutions++;approval.status='resolved';}}});
  const c=f.make();await c.delegate({operationId:'one',prompt:'Read status'});
  const revision=createHash('sha256').update(JSON.stringify(approval)).digest('hex');
  await assert.rejects(c.decide({operationId:'one',interactionId:'approval',revision:'stale',decision:'allow_once'}),/Stale/);
  const results=await Promise.allSettled(['allow_once','deny'].map(decision=>c.decide({operationId:'one',interactionId:'approval',revision,decision})));
  assert.equal(resolutions,1);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('an uncertain approval is not replayed after restart',async()=>{
  const approval={id:'approval',threadId:'owned',status:'pending',payload:{kind:'approval'}};
  let resolutions=0;
  const f=fixture({interactions:{get:async()=>approval,resolve:async()=>{resolutions++;throw Error('lost reply');}}});
  await f.make().delegate({operationId:'one',prompt:'Read status'});
  const input={operationId:'one',interactionId:'approval',revision:createHash('sha256').update(JSON.stringify(approval)).digest('hex'),decision:'allow_once'};
  assert.equal((await f.make().decide(input)).state,'unknown');
  await assert.rejects(f.make().decide(input),/uncertain/);assert.equal(resolutions,1);
});
test('stop re-enumerates and cancels descendants discovered after first pass',async()=>{
  let passes=0;const stopped=[];const cancelled=[];const deleted=[];
  const f=fixture({
    experimental_listDescendants:async()=>({threads:[{descendantIds:++passes>1?['late']:[]}]}),
    get:async({threadId})=>({id:threadId,projectId:'project',environmentId:'env',status:'idle'}),
    stop:async({threadId})=>stopped.push(threadId),
    queuedMessages:{list:async({threadId})=>threadId==='late'&&!deleted.length?[{id:'queued'}]:[],delete:async args=>deleted.push(args)},
    interactions:{list:async({threadId})=>threadId==='late'&&!cancelled.length?[{id:'pending',status:'pending'}]:[],cancel:async args=>cancelled.push(args)},
  });
  const c=f.make();await c.delegate({operationId:'one',prompt:'Read status'});await c.stop({operationId:'one'});
  assert.ok(stopped.includes('late'));assert.equal(cancelled[0].interactionId,'pending');assert.equal(deleted[0].queuedMessageId,'queued');
});
test('visibility change during inspection prevents content return',async()=>{
  let reads=0;const f=fixture({get:async()=>({id:'other',visibility:++reads>1?'hidden':'visible'}),output:async()=>({output:'private'}),interactions:{list:async()=>[]}});
  await assert.rejects(f.make().inspect({threadId:'other'}),/visibility changed/);
});
test('lost spawn reply recovers only from the exact original BB event',async()=>{
  let issued;let dispatches=0;
  const f=fixture({spawn:async args=>{issued=args.prompt;dispatches++;throw Error('lost reply');},events:{list:async({threadId})=>[{type:'client/turn/requested',data:{source:'spawn',input:[{type:'text',text:threadId==='real'?issued:'forged title only'}]}}]}});
  await f.make().delegate({operationId:'one',prompt:'Read status'});
  f.rows.push(...['forged','real'].map(id=>({id,projectId:'project',environmentId:'env',createdAt:Date.now()+1,status:'idle'})));
  const recovered=await f.make().reconcile({operationId:'one'});
  assert.equal(recovered.threadId,'real');assert.equal(recovered.dispatch,'accepted');assert.equal(dispatches,1);
});

test('steering is owned, durable and never resends an uncertain message',async()=>{
 let sends=0;const f=fixture({send:async()=>{sends++;throw Error('lost response');}});const c=f.make();
 await c.delegate({operationId:'one',prompt:'Research'});
 const input={operationId:'one',requestId:'direction-one',message:'Summarize only the main finding.'};
 assert.equal((await c.steer(input)).state,'unknown');assert.equal((await f.make().steer(input)).state,'unknown');assert.equal(sends,1);
 await assert.rejects(c.steer({...input,message:'Different direction'}),/reused/);
 await assert.rejects(c.steer({...input,operationId:'unrelated'}),/Unknown task/);assert.equal(sends,1);
 const state=await f.store.read();state.tasks.one.dispatchEnabled=false;await f.store.write(state);
 await assert.rejects(c.steer({...input,requestId:'new-direction'}),/Stopped/);
});

test('steering uses the public BB structured message contract',async()=>{
 let sent;const f=fixture({send:async args=>{sent=args;}}),c=f.make();
 await c.delegate({operationId:'task',prompt:'Check status'});
 const r=await c.steer({operationId:'task',requestId:'direction',message:'Report what you found'});
 assert.equal(r.state,'accepted');assert.equal(sent.mode,'auto');
 assert.deepEqual(sent.input,[{type:'text',text:'Report what you found',mentions:[]}]);
 assert.equal(sent.message,undefined);
});
