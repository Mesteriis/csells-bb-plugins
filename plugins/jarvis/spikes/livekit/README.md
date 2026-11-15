# LiveKit conversation spike

A disposable, self-hosted TypeScript companion for the Jarvis BB plugin. It uses
LiveKit Agents 1.10.0, rtc-node 1.2.2, browser client 2.24.1, and LiveKit Server
1.13.11. No Python voice worker or LiveKit Cloud credential is required.

The authenticated BB page is `/api/v1/plugins/jarvis/http/livekit`. Start acquires
the existing Jarvis conversation lease, joins a private two-participant LiveKit
room, enables native browser microphone capture, and speaks a briefing of real
recent BB threads. The user can speak over it. End releases the microphone,
room, worker session, and conversation lease. Idle abandoned clients expire
within 90 seconds. Existing BB question bindings and authorization remain in the
restricted relay; interrupting speech does not stop delegated BB work.

The companion binds loopback port 4846. The BB plugin forwards authenticated HTTP
controls and WebSocket signaling to the companion and local media server. The
browser receives a five-minute room-scoped JWT and short-lived TURN credentials,
never the LiveKit API secret or BB relay token. No second public signaling share
is needed. LiveKit uses the existing task-owned TURN route for cellular media.

## Run in the disposable staging VM

Requires Node 24+, the real restricted Jarvis relay on loopback 4842, a locally
running LiveKit Server, and the existing task TURN service. Run all candidate
services in the disposable VM; do not install the candidate in stable BB.

```sh
ONNXRUNTIME_NODE_INSTALL=skip npm ci
npm run build
npm test
JARVIS_LIVEKIT_CONFIG=/private/path/livekit-private.json npm start
```

`ONNXRUNTIME_NODE_INSTALL=skip` skips optional CUDA binaries, not CPU inference or
package lifecycle scripts. Silero CPU inference uses the bundled ONNX runtime.
The config file must be mode 0600 and contain `apiKey`, `apiSecret`, `relayToken`,
`turnSecretPath`, and `turnUrl`. Generate a fresh candidate-only LiveKit key and
secret; obtain the restricted relay credential under the existing staging
approval. Keep configuration outside source control. The media server uses the
matching API key/secret, signal port 7880, and configured RTC ports. Deployment,
ownership, networking, cleanup and rollback references are in the lab registry.

Build and reload the parent Jarvis plugin in the same candidate BB instance after
changing its HTTP/signaling routes. The browser bundle is served by the companion.

## What is delegated to LiveKit

- Browser media capture and remote track playback use `livekit-client`.
- Native browser echo cancellation, noise suppression and gain control are
  requested. There is no application microphone AudioContext or server echo filter.
- LiveKit's Silero VAD and STT stream adapter segment the existing batch STT.
- `BBDirector` is a real SDK LLM provider. Automatic retries are disabled because
  a director request may dispatch an explicitly directed answer.
- The documented TTS node converts Alfred's framed PCM into SDK AudioFrames.
  LiveKit controls pacing, queues, WebRTC output, interruption and pause/resume.
- VAD interruption requires 200 ms; framework false-interruption recovery is
  enabled with a two-second timeout. No custom echo-text similarity rejection,
  microphone gating, output flushing on every VAD event, or homemade turn loop.

## Evidence and limits

See `specs/research/jarvis-livekit-spike.md` in the repository for measured checks
and outstanding device acceptance. This is a conversation transport spike, not
completion of the full Jarvis vision. In particular, batch STT is still batch,
semantic interruption detection and enhanced cloud noise filters are not enabled,
continuous watched-update polling is not wired into this spike, and the external
BB director retains generated-text history rather than an exact heard transcript.

The page displays generated text and the current bound question. Displayed text
and server playout do not prove physical audibility. Browser diagnostics contain
session IDs, phases, RTP counters, playback permission, microphone state and
latency measurements; periodic media counters are also in the companion journal.
There is no persisted microphone recording. Actual Android/Bluetooth behavior,
backgrounding, route changes, prolonged cellular loss and acoustic echo remain
separate acceptance checks.
