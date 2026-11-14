import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { createCoordinator } from './coordinator.mjs';

const session = z.object({id:z.string(),projectId:z.string(),title:z.string(),status:z.string(),providerId:z.string()});
const task = z.object({operationId:z.string(),prompt:z.string(),threadId:z.string().optional(),dispatch:z.string(),dispatchEnabled:z.boolean(),cancellation:z.string(),verification:z.string(),session:session.optional()});
const interaction = z.object({id:z.string(),threadId:z.string(),status:z.string(),payload:z.object({kind:z.string()}).passthrough()}).passthrough();
export const rpcContract=defineRpcContract({
  sessions:{input:z.object({offset:z.number().int().min(0).max(10000).default(0)}),output:z.array(session)},
  tasks:{input:z.null(),output:z.array(task)},
  inspect:{input:z.object({threadId:z.string().max(80)}),output:z.object({session,output:z.string(),owned:z.boolean(),interactions:z.array(z.object({interaction,revision:z.string()}))})},
  delegate:{input:z.object({operationId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),prompt:z.string().trim().min(1).max(8000)}),output:task},
  stop:{input:z.object({operationId:z.string().max(80)}),output:task},
  reconcile:{input:z.object({operationId:z.string().max(80)}),output:task},
  decide:{input:z.object({operationId:z.string().max(80),interactionId:z.string().max(80),revision:z.string().length(64),decision:z.enum(['allow_once','deny'])}),output:z.object({decision:z.string(),revision:z.string(),state:z.string()})},
});
export type Session=z.infer<typeof session>;
export type Task=z.infer<typeof task>;
export default async function plugin(bb:BbPluginApi) {
  const settings=bb.settings.define({
    projectId:{type:'string',label:'Project for delegated work',default:''},
    environmentId:{type:'string',label:'Environment for delegated work',default:''},
    providerId:{type:'string',label:'Provider for delegated work',default:''},
    relayBaseUrl:{type:'string',label:'Staging relay loopback URL',default:''},
    relayToken:{type:'string',label:'Staging relay credential',secret:true,default:''},
  });
  const config=await settings.get();
  let call:(method:string,input:unknown)=>Promise<unknown>;
  if(config.relayBaseUrl) {
    const url=new URL(config.relayBaseUrl);
    if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw Error('Staging relay must be a loopback HTTP origin reached through the dedicated SSH tunnel');
    const abort=new AbortController();bb.onDispose(()=>abort.abort());
    call=async(method,input)=>{
      const response=await fetch(new URL(method,url),{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.relayToken}`},body:JSON.stringify(input??{}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(60000)]),redirect:'error'});
      if(!response.ok) throw Error(`Relay request failed (${response.status}); refresh task state before retrying`);
      return response.json();
    };
  } else {
    const coordinator=createCoordinator({sdk:bb.sdk,store:{read:()=>bb.storage.kv.get('coordinator-v1'),write:(value:unknown)=>bb.storage.kv.set('coordinator-v1',value)},config:{...config,owner:'jarvis',maxTasks:100}});
    call=async(method,input)=>{
      if(['delegate','stop','decide'].includes(method) && (!config.projectId || !config.environmentId || !config.providerId)) throw Error('Configure the work project, environment and provider first');
      if(method==='tasks') return coordinator.tasks();
      return coordinator[method as Exclude<keyof typeof coordinator,'tasks'>](input as never);
    };
  }
  bb.rpc.register(rpcContract,{
    sessions:async input=>rpcContract.sessions.output.parse(await call('sessions',input)),
    tasks:async()=>rpcContract.tasks.output.parse(await call('tasks',{})),
    inspect:async input=>rpcContract.inspect.output.parse(await call('inspect',input)),
    delegate:async input=>rpcContract.delegate.output.parse(await call('delegate',input)),
    stop:async input=>rpcContract.stop.output.parse(await call('stop',input)),
    reconcile:async input=>rpcContract.reconcile.output.parse(await call('reconcile',input)),
    decide:async input=>rpcContract.decide.output.parse(await call('decide',input)),
  });
}
