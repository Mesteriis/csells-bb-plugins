import type { BbPluginApi } from '@get-bb/plugin-sdk';

// Keep signaling on the authenticated BB origin. Media still travels over
// LiveKit WebRTC/TURN; this forwards protocol bytes without interpreting them.
export function registerLiveKitSignaling(bb: BbPluginApi) {
  for (const path of ['rtc', 'rtc/v1']) {
    bb.http.experimental_websocket(`/livekit-signal/${path}`, (context) => {
      let upstream: WebSocket | undefined;
      let ready: Promise<void> | undefined;
      let closed = false;
      return {
        onOpen(socket) {
          upstream = new WebSocket(`ws://127.0.0.1:7880/${path}${context.url.search}`);
          upstream.binaryType = 'arraybuffer';
          ready = new Promise<void>((resolve,reject)=>{
            const timeout=setTimeout(()=>{reject(Error('Signal timeout'));socket.close(1011,'Signal timeout');upstream?.close();},10000);
            upstream!.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
            upstream!.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Signal connection failed'));socket.close(1011,'Signal connection failed');},{once:true});
          });
          void ready.catch(()=>{});
          upstream.addEventListener('message',e=>{if(!closed)socket.send(typeof e.data==='string'?e.data:new Uint8Array(e.data));});
          upstream.addEventListener('close',()=>{closed=true;socket.close(1000,'Signal closed');});
        },
        async onMessage(socket,data) {
          try {await ready;if(!closed&&upstream?.readyState===WebSocket.OPEN){if(upstream.bufferedAmount>1048576){socket.close(1011,'Signal backpressure');return;}upstream.send(data);}}
          catch {socket.close(1011,'Signal unavailable');}
        },
        onClose(){closed=true;upstream?.close();},
        onError(){closed=true;upstream?.close();},
      };
    }, {auth:'local'});
    bb.http.route('GET',`/livekit-signal/${path}/validate`,async context=>{
      const query=new URL(context.req.url).search;
      const response=await fetch(`http://127.0.0.1:7880/${path}/validate${query}`,{signal:AbortSignal.timeout(5000)});
      return new Response(response.body,{status:response.status,headers:{'content-type':'text/plain','cache-control':'no-store'}});
    },{auth:'local'});
  }
}
