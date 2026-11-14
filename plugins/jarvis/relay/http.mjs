import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export function createRelayServer({coordinator,token,expiresAt,now=Date.now}) {
  if(typeof token!=='string' || token.length<40 || !Number.isFinite(expiresAt)) throw Error('Invalid relay credential');
  const expected=Buffer.from(`Bearer ${token}`);
  const methods=new Set(['sessions','inspect','tasks','delegate','reconcile','stop','decide']);
  return createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:8192},async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
    const supplied=Buffer.from(req.headers.authorization??'');
    if(now()>=expiresAt || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) return reply(401,{error:'Unauthorized or expired relay credential'});
    if(req.headers.origin || req.method!=='POST' || req.headers['content-type']!=='application/json') return reply(403,{error:'Server-to-server JSON only'});
    const method=req.url?.slice(1);
    if(!methods.has(method)) return reply(404,{error:'Unknown operation'});
    try {
      let size=0; const chunks=[];
      for await(const chunk of req) {size+=chunk.length;if(size>16384) {reply(413,{error:'Request too large'});return;}chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!input || typeof input!=='object' || Array.isArray(input)) return reply(400,{error:'Object required'});
      // No parameter may select an SDK method, host, URL, project, environment,
      // credentials or file path. Coordinator methods select all authority.
      const keys={sessions:['offset'],inspect:['threadId'],tasks:[],delegate:['operationId','prompt'],reconcile:['operationId'],stop:['operationId'],decide:['operationId','interactionId','revision','decision']}[method];
      if(Object.keys(input).some(key=>!keys.includes(key))) return reply(400,{error:'Unknown field'});
      const value=await coordinator[method](input);
      if(now()>=expiresAt) return reply(401,{error:'Relay credential expired'});
      reply(200,value);
    } catch {
      reply(409,{error:'Operation rejected or outcome uncertain; inspect current task state before retrying'});
    }
  });
}
