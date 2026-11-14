import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelayServer} from '../relay/http.mjs';
test('relay rejects unauthenticated, expired, browser and arbitrary forwarding requests',async t=>{
  let calls=0; let now=1; const token='t'.repeat(48);
  const server=createRelayServer({coordinator:{sessions:async()=>{calls++;return[];}},token,expiresAt:10,now:()=>now});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body={},headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...headers},body:JSON.stringify(body)});
  assert.equal((await post('/sessions',{}, {authorization:'Bearer bad'})).status,401);
  assert.equal((await post('/sessions',{}, {origin:'http://evil.example'})).status,403);
  assert.equal((await post('/threads.delete')).status,404);
  assert.equal((await post('/sessions',{url:'http://internal'})).status,400);
  assert.equal((await post('/sessions')).status,200);
  now=11; assert.equal((await post('/sessions')).status,401);
  assert.equal(calls,1);
});
