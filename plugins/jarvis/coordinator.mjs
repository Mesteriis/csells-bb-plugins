import { createHash, randomUUID } from 'node:crypto';

// BB is the execution authority. This journal records intent and uncertainty;
// transport failure is never permission to dispatch the same work again.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const visible = row => row && row.visibility === 'visible' && !row.parentThreadId && !row.archivedAt && !row.deletedAt;
const summary = row => ({ id:row.id, projectId:row.projectId, title:row.title ?? row.titleFallback ?? 'Untitled', status:row.status, providerId:row.providerId });
function text(value, name, max = 8000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`Invalid ${name}`);
  return value;
}
export function createCoordinator({sdk, store, config}) {
  let tail = Promise.resolve();
  const serial = fn => { const result = tail.then(fn); tail = result.catch(()=>{}); return result; };
  async function load() {
    const state = await store.read() ?? {version:1,tasks:{}};
    if (state.version !== 1 || !state.tasks || Array.isArray(state.tasks)) throw Error('Unsupported task journal');
    return state;
  }
  function task(state, id) {
    if (!Object.hasOwn(state.tasks,id)) throw Error('Unknown task; mutation denied');
    return state.tasks[id];
  }
  async function ownedThread(t) {
    if (!t.threadId) throw Error('Dispatch is uncertain; reconcile before control');
    const row = await sdk.threads.get({threadId:t.threadId});
    if (row.projectId !== config.projectId || row.environmentId !== config.environmentId || row.deletedAt) throw Error('Task ownership scope changed');
    return row;
  }
  async function snapshot(t) {
    if (!t.threadId) return {...t};
    const row = await ownedThread(t);
    return {...t, session:summary(row)};
  }
  async function delegate({operationId, prompt}) {
    text(operationId,'operationId',80); text(prompt,'prompt');
    if (!/^[a-zA-Z0-9_-]+$/.test(operationId)) throw Error('Invalid operationId');
    return serial(async()=>{
      const state = await load();
      const fingerprint = hash({prompt});
      if (Object.hasOwn(state.tasks, operationId)) {
        const previous = task(state,operationId);
        if (previous.fingerprint !== fingerprint) throw Error('Operation id belongs to a different request');
        return snapshot(previous);
      }
      if (Object.keys(state.tasks).length >= (config.maxTasks ?? 100)) throw Error('Task capacity reached');
      const t = {operationId,fingerprint,prompt,correlation:randomUUID(),createdAt:Date.now(),dispatch:'unknown',dispatchEnabled:true,generation:1,verification:'unverified',notification:'pending',cancellation:'none'};
      Object.defineProperty(state.tasks,operationId,{value:t,enumerable:true,writable:true,configurable:true});
      // Persist before the first side effect. Even a crash here is uncertain.
      await store.write(state);
      try {
        const row = await sdk.threads.spawn({
          projectId:config.projectId, environment:{type:'reuse',environmentId:config.environmentId},
          providerId:config.providerId, origin:'sdk', visibility:'visible',
          title:`Jarvis · ${prompt.split(/[.!?]\s|\n/)[0].replace(/\s+/g," ").slice(0,100)}`,
          prompt:`Jarvis task correlation: ${t.correlation}\n\n${prompt}`, parentNotifications:'off',
        });
        t.threadId = row.id;
        t.dispatch = 'accepted';
      } catch {
        // Do not leak transport details, credentials or another session's data.
        t.dispatch = 'unknown';
      }
      await store.write(state);
      return {...t};
    });
  }
  async function reconcile({operationId}) {
    return serial(async()=>{
      const state=await load();const t=task(state,operationId);
      if(t.threadId) return snapshot(t);
      if(!t.correlation) return {...t};
      const matches=[];let complete=false;
      // Correlation is generated and persisted by this authority before spawn.
      // Neither a candidate-supplied thread ID nor an editable title can grant
      // ownership. Require the original BB spawn event and exact issued input.
      for(let offset=0;offset<1000;offset+=50) {
        const rows=await sdk.threads.list({projectId:config.projectId,environmentId:config.environmentId,includeHidden:true,limit:50,offset});
        for(const row of rows) {
          if(row.projectId!==config.projectId || row.environmentId!==config.environmentId || row.createdAt<t.createdAt || row.deletedAt) continue;
          const events=await sdk.threads.events.list({threadId:row.id,order:'asc',limit:'1'});
          const e=events[0];
          if(e?.type==='client/turn/requested' && e.data?.source==='spawn' && e.data.input?.length===1 && e.data.input[0].type==='text' && e.data.input[0].text===`Jarvis task correlation: ${t.correlation}\n\n${t.prompt}`) matches.push(row.id);
        }
        if(rows.length<50){complete=true;break;}
      }
      if(complete && matches.length===1){t.threadId=matches[0];t.dispatch='accepted';t.reconciledAt=Date.now();}
      t.reconciliation=complete?matches.length===1?'matched':matches.length?'ambiguous':'not-found':'incomplete';
      // Absence is not proof a timed-out spawn cannot still arrive. Never retry.
      await store.write(state);return snapshot(t);
    });
  }
  async function sessions({offset=0}={}) {
    if (!Number.isInteger(offset) || offset<0 || offset>10000) throw Error('Invalid offset');
    const rows = await sdk.threads.list({hasParent:false,archived:false,includeHidden:false,limit:50,offset});
    return rows.filter(visible).map(summary);
  }
  async function inspect({threadId}) {
    text(threadId,'threadId',80);
    const row = await sdk.threads.get({threadId});
    const state = await load();
    const own = Object.values(state.tasks).find(t=>t.threadId===threadId);
    if (own) await ownedThread(own);
    else if (!visible(row)) throw Error('Session is outside observation scope');
    const [output, interactions] = await Promise.all([sdk.threads.output({threadId}),sdk.threads.interactions.list({threadId})]);
    // Recheck visibility after reads, before returning sensitive content.
    const current=await sdk.threads.get({threadId});
    if (!own && !visible(current)) throw Error('Session visibility changed');
    return {session:summary(current),output:(output.output??'').slice(-16000),owned:Boolean(own),
      interactions:interactions.filter(i=>i.status==='pending').slice(0,20).map(i=>({interaction:i,revision:hash(i)}))};
  }
  async function stop({operationId}) {
    return serial(async()=>{
      const state=await load(); const t=task(state,operationId);
      await ownedThread(t);
      t.dispatchEnabled=false; t.generation++; t.cancellation='unconfirmed';
      await store.write(state);
      const failures=new Set(); let previousScope=''; let quietPasses=0;
      // Re-enumerate descendants and queued work. API acknowledgement alone
      // cannot establish termination, nor can a finite observation prove that
      // unmanaged subprocesses have exited. The UI names this observed-idle.
      for(let pass=0;pass<3;pass++) {
        const result=await sdk.threads.experimental_listDescendants({threadIds:[t.threadId],includeHidden:true,includeArchived:true});
        const ids=[t.threadId,...new Set(result.threads.flatMap(r=>r.descendantIds))];
        let quiet=true;
        for(const threadId of ids) {
          try {
            const pending=await sdk.threads.interactions.list({threadId});
            for(const i of pending) if(i.status==='pending') await sdk.threads.interactions.cancel({threadId,interactionId:i.id});
            const queue=await sdk.threads.queuedMessages.list({threadId});
            for(const q of queue) await sdk.threads.queuedMessages.delete({threadId,queuedMessageId:q.id});
            await sdk.threads.stop({threadId});
            const row=await sdk.threads.get({threadId});
            const remaining=await sdk.threads.queuedMessages.list({threadId});
            quiet &&= ['idle','error'].includes(row.status) && !row.activeBackgroundAgentCount && !remaining.length;
          } catch { failures.add(threadId); quiet=false; }
        }
        const scope=ids.sort().join(',');
        quietPasses=quiet && scope===previousScope ? quietPasses+1 : 0;
        previousScope=scope;
      }
      t.cancellation=quietPasses>=2 && !failures.size?'observed-idle':'unconfirmed';
      t.stopFailures=[...failures]; t.stopObservedAt=Date.now();
      await store.write(state); return {...t};
    });
  }
  async function decide({operationId,interactionId,revision,decision}) {
    if(!['allow_once','deny'].includes(decision)) throw Error('Unsupported decision');
    return serial(async()=>{
      const state=await load(); const t=task(state,operationId); await ownedThread(t);
      if(!t.dispatchEnabled) throw Error('Task is stopped');
      const args={threadId:t.threadId,interactionId};
      const current=await sdk.threads.interactions.get(args);
      if(current.threadId!==t.threadId || current.status!=='pending' || current.payload.kind!=='approval' || hash(current)!==revision || (current.expiresAt && current.expiresAt<=Date.now())) throw Error('Stale or mismatched approval');
      t.decisions??={};
      if(Object.hasOwn(t.decisions,interactionId)) throw Error('Decision already submitted or uncertain; inspect current state');
      t.decisions[interactionId]={decision,revision,state:'unknown'};
      await store.write(state);
      try {
        await sdk.threads.interactions.resolve({...args,resolution:decision==='deny'?{decision}:{decision,grantedPermissions:null}});
        const observed=await sdk.threads.interactions.get(args);
        t.decisions[interactionId].state=observed.status==='resolved'?'resolved':'unknown';
      } catch { /* Never replay an uncertain decision. */ }
      await store.write(state); return {...t.decisions[interactionId]};
    });
  }
  async function steer({operationId, requestId, message}) {
    text(operationId,'operationId',80);text(requestId,'requestId',80);text(message,'message');
    if(!/^[a-zA-Z0-9_-]+$/.test(requestId))throw Error('Invalid requestId');
    return serial(async()=>{
      const state=await load(),t=task(state,operationId);await ownedThread(t);
      if(!t.dispatchEnabled)throw Error('Stopped task cannot be steered');
      t.steers??={};const fingerprint=hash({message});
      if(Object.hasOwn(t.steers,requestId)){
        if(t.steers[requestId].fingerprint!==fingerprint)throw Error('Request id reused with different direction');
        return {...t.steers[requestId]};
      }
      if(Object.keys(t.steers).length>=100)throw Error('Task direction capacity reached');
      const receipt={fingerprint,state:'unknown'};t.steers[requestId]=receipt;
      await store.write(state);
      try{await sdk.threads.send({threadId:t.threadId,mode:"auto",input:[{type:"text",text:message,mentions:[]}]});receipt.state='accepted';}catch{}
      await store.write(state);return {...receipt};
    });
  }
  return {delegate,reconcile,sessions,inspect,stop,decide,steer,
    tasks:()=>serial(async()=>Promise.all(Object.values((await load()).tasks).map(snapshot)))};
}
