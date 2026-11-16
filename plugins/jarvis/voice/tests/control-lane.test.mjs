import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ControlLane} from '../dist/control-lane.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('stop preempts preparation; stale completion cannot speak or unlock a newer command',async()=>{
 const lane=new ControlLane(),brief=deferred(),stop=deferred(),spoken=[];
 const first=lane.run(async current=>{await brief.promise;if(current())spoken.push('brief');});
 await assert.rejects(lane.run(async()=>{}),/still running/);
 const second=lane.run(async current=>{await stop.promise;if(current())spoken.push('stop');},{preempt:true});
 brief.resolve();await first;assert.equal(lane.busy,true);assert.deepEqual(spoken,[]);
 stop.resolve();await second;assert.equal(lane.busy,false);assert.deepEqual(spoken,['stop']);
});
test('superseded failure is ignored, current failure is reported and releases the lane',async()=>{
 const lane=new ControlLane(),old=deferred();
 const first=lane.run(async()=>old.promise);
 await lane.run(async()=>{},{preempt:true});old.reject(Error('aborted briefing'));await first;
 await assert.rejects(lane.run(async()=>{throw Error('actual stop failure');}),/actual stop failure/);
 assert.equal(lane.busy,false);
});
test('close fences late presentation and prevents new control operations',async()=>{
 const lane=new ControlLane(),pending=deferred();let presented=false;
 const work=lane.run(async current=>{await pending.promise;presented=current();});
 lane.close();pending.resolve();await work;assert.equal(presented,false);
 await assert.rejects(lane.run(async()=>{},{preempt:true}),/closed/);
});
test('cancel fences pending speech but allows the next control',async()=>{
 const lane=new ControlLane(),pending=deferred();let spoke=false;
 const work=lane.run(async current=>{await pending.promise;if(current())spoke=true;});
 lane.cancel();pending.resolve();await work;assert.equal(spoke,false);assert.equal(lane.busy,false);
 await lane.run(async current=>assert(current()));
});
