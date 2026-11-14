import {useCallback,useEffect,useRef,useState} from 'react';
import {definePluginApp,useRpc,Markdown} from '@get-bb/plugin-sdk/app';
import type {rpcContract,Session,Task} from './server';
import {Orb} from './components/Orb';

function Jarvis() {
  const rpc=useRpc<typeof rpcContract>();
  const [sessions,setSessions]=useState<Session[]>([]);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [detail,setDetail]=useState<Awaited<ReturnType<typeof inspect>>|null>(null);
  const [draft,setDraft]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const [observedAt,setObservedAt]=useState<number|null>(null);
  const request=useRef<{operationId:string;prompt:string}|null>(null);
  const inspect=(threadId:string)=>rpc.call('inspect',{threadId});
  const refresh=useCallback(async()=>{
    try {const [s,t]=await Promise.all([rpc.call('sessions',{offset:0}),rpc.call('tasks')]);setSessions(s);setTasks(t);setObservedAt(Date.now());setError('');}
    catch(e){setError(String(e));}
  },[rpc]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[refresh]);
  async function delegate() {
    setBusy(true);
    // Keep operation identity after a network error. Editing the request is
    // explicit new intent; refreshing never automatically submits work.
    if(!request.current || request.current.prompt!==draft) request.current={operationId:crypto.randomUUID(),prompt:draft};
    try {await rpc.call('delegate',request.current);setDraft('');request.current=null;await refresh();}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function show(id:string) {try{setDetail(await inspect(id));}catch(e){setError(String(e));}}
  const owned=detail?tasks.find(t=>t.threadId===detail.session.id):undefined;
  return <section aria-label="Jarvis staff" className="mx-auto min-w-0 w-full max-w-5xl space-y-6 overflow-auto p-4 sm:p-8" style={{overflowWrap:'anywhere'}}>
    <header className="flex items-center gap-4"><Orb mode={busy?'sending':'off'} size={84}/><div><h1 className="text-2xl font-semibold">Jarvis</h1><p className="text-muted-foreground">Your work, in view.</p></div></header>
    <p className="text-sm text-muted-foreground">Typed coordination preview. Voice and conversational staff management are still being built.</p>
    {error&&<p role="alert" className="rounded border border-destructive p-3">{error}</p>}
    <form onSubmit={e=>{e.preventDefault();void delegate();}} className="space-y-3">
      <label className="block font-medium" htmlFor="jarvis-task">Delegate a task</label>
      <textarea id="jarvis-task" className="min-h-24 w-full rounded-lg border bg-background p-3" value={draft} maxLength={8000} onChange={e=>setDraft(e.target.value)} placeholder="Describe the work and any limits…"/>
      <button className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy||!draft.trim()}>{busy?'Submitting…':'Delegate'}</button>
    </form>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Delegated work</h2>
      {!tasks.length&&<p className="text-muted-foreground">No delegated tasks yet.</p>}
      {tasks.map(task=><article key={task.operationId} className="rounded-lg border p-4"><p>{task.prompt}</p><p className="mt-2 text-sm text-muted-foreground">{task.session?.status??task.dispatch} · Result {task.verification} · Stop: {task.cancellation}</p>
        {task.threadId&&<div className="mt-3 flex gap-4"><button className="underline" onClick={()=>void show(task.threadId!)}>View session</button><button className="underline" onClick={async()=>{try{await rpc.call('stop',{operationId:task.operationId});await refresh();}catch(e){setError(String(e));}}}>Stop work</button></div>}
        {task.dispatch==='unknown'&&<p className="mt-2">Submission outcome is uncertain. It will not be repeated automatically. <button className="underline" onClick={async()=>{try{await rpc.call('reconcile',{operationId:task.operationId});await refresh();}catch(e){setError(String(e));}}}>Check for accepted work</button></p>}
        {task.cancellation==='observed-idle'&&<p className="mt-2 text-sm">BB reports idle with no queued work. External process termination has not been independently verified.</p>}
      </article>)}
    </section>
    {detail&&<section className="space-y-3 rounded-lg border p-4"><div className="flex justify-between"><h2 className="font-semibold">{detail.session.title}</h2><button onClick={()=>setDetail(null)}>Close</button></div><Markdown content={detail.output||'No response yet.'}/>
      {detail.interactions.map(({interaction,revision})=><div className="rounded border p-3" key={interaction.id}><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{JSON.stringify(interaction.payload,null,2)}</pre>
        {owned&&interaction.payload.kind==='approval'&&<div className="mt-3 flex gap-4">{(['allow_once','deny'] as const).map(decision=><button key={decision} className="underline" onClick={async()=>{try{await rpc.call('decide',{operationId:owned.operationId,interactionId:interaction.id,revision,decision});await show(detail.session.id);}catch(e){setError(String(e));}}}>{decision==='deny'?'Deny':'Allow this action once'}</button>)}</div>}
      </div>)}
    </section>}
    <section><div className="mb-3 flex justify-between"><h2 className="text-lg font-semibold">Existing sessions</h2><button className="underline" onClick={()=>void refresh()}>Refresh</button></div>
      <p className="mb-3 text-sm text-muted-foreground">First 50 visible top-level sessions. {observedAt?`Observed ${new Date(observedAt).toLocaleTimeString()}`:'Connecting…'}</p>
      <ul className="divide-y rounded-lg border">{sessions.map(s=><li key={s.id}><button className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-muted" onClick={()=>void show(s.id)}><span>{s.title}</span><span className="text-sm text-muted-foreground">{s.status}</span></button></li>)}</ul>
    </section>
  </section>;
}
export default definePluginApp(app=>{app.slots.navPanel({id:'jarvis',title:'Jarvis',icon:'AudioLines',path:'staff',component:Jarvis});});
