# Mobile browser duplex: fifteen-project source review and Jarvis decision

2026-11-14. Question: how do existing agents implement simultaneous browser microphone/output, conversational turn-taking and interruption on mobile, and which code should bootstrap Jarvis?

## Decision

Use **Pipecat's browser SmallWebRTC transport and server voice pipeline** as the next implementation candidate. Keep BB's coordinator, task authority, real-session relay, configured STT and Alfred. Move capture decoding/resampling and turn processing into the server pipeline; render its persistent remote audio track with a native HTML audio element. Replace the normal browser 16 kHz capture/utterance-upload/sentence-WAV path rather than surrounding it with another playback workaround.

This is an implementation selection based on source and our phone transport evidence, **not a claim that the integrated implementation exists or that Android Bluetooth is solved**. Qwen's isolated Node WebRTC gateway is the concrete alternative if Pipecat integration proves impractical. LiveKit Agents is the infrastructure-backed alternative with stronger playback/false-interruption machinery, but requires an SFU/room/token deployment. Do not choose a proprietary voice SDK merely because its client is open: that would also change the model/voice/service path.

The next engineering step is a real browser-to-VM media session using existing libraries and real STT/Alfred, with instrumented interruptions. It does not depend on asking Chris to interpret another mode matrix. Physical car audibility remains a separate measurement we cannot infer from desktop automation or bytes received.

## Coverage: what was actually inspected

Fifteen distinct projects/packages: six assistants from awesome-jarvis and nine frameworks/SDKs. This is **not fifteen proven mobile full-duplex Jarvis assistants**. Moltis is a negative result; SDK clients can hide their server engines; multiple products share one media engine. Fourteen projects were inspected at pinned Git revisions, plus one versioned npm release; matching transport dependencies were pinned separately. Detailed reports pin source, cite paths/lines and state access limits. No upstream app or unit suite was executed for this review. The [source manifest](evidence/mobile-duplex-source-manifest.json) records inspected revisions and cited paths; 91 Git source citation paths were checked against the pinned local checkouts.

| Project | Browser media observed | Interruption finding | Detailed source audit |
| --- | --- | --- | --- |
| Qwen Audio Agent | Separate WebRTC gateway; main UI still WS/Web Audio | Response cancellation, server PCM clear/blocklist, heuristic playback receipts; generic server media seam | [Agents](mobile-duplex-agents-source-audit.md#qwen-audio-agent) |
| Paseo | WS PCM + browser Web Audio | Abort active output AND clear pending queue; reject stale chunks | [Agents](mobile-duplex-agents-source-audit.md#paseo) |
| Moltis | Utterance recording + TTS | Suppresses detection/recording while replying: **not duplex** | [Agents](mobile-duplex-agents-source-audit.md#moltis-useful-negative-result) |
| Sutando | WS PCM + browser Web Audio | Distinct normal-end and interrupt; capture recovery independent of connection | [Agents](mobile-duplex-agents-source-audit.md#sutando) |
| AIRI | Web Audio capture/playback | Echo-aware barge-in; abort producers; separate silence and recorded-interruption receipts | [Additional](mobile-duplex-additional-source-audit.md#airi) |
| N.E.K.O | Main companion WS PCM/Web Audio; separate visitor RTC | Speech IDs and epochs discard late decode/output; queues and producers cancelled separately | [Additional](mobile-duplex-additional-source-audit.md#neko) |
| Pipecat | SmallWebRTC browser/server RTP | Speech-start/end strategies, interrupted synthesis contexts, processor/output queue cancellation | [Frameworks](mobile-duplex-frameworks-source-audit.md#pipecat-concrete-reuse-proposal) |
| LiveKit Agents | LiveKit RTP | Playback-aware context truncation; conditional false-interruption resume | [Frameworks](mobile-duplex-frameworks-source-audit.md#livekit-stronger-playback-accounting) |
| TEN | Agora RTC | Speech onset separately flushes LLM, TTS and RTC | [Frameworks](mobile-duplex-frameworks-source-audit.md#ten-separate-cancellation-at-every-audio-stage) |
| FastRTC | Browser/server RTP | Default ReplyOnPause cancels after pause detection, not speech onset | [Frameworks](mobile-duplex-frameworks-source-audit.md#fastrtc-duplex-transport-slower-default-interruption-decision) |
| Ultravox | LiveKit, native remote-track audio | Browser lifecycle visible; server VAD/cancel/history engine private | [SDKs](mobile-duplex-sdks-source-audit.md#ultravox-persistent-call-media-teardown-correctness) |
| Vapi | Daily, native remote-track audio | Browser lifecycle visible; server conversation engine private | [SDKs](mobile-duplex-sdks-source-audit.md#vapi-daily-owns-media-application-owns-lifecycle-evidence) |
| ElevenLabs | LiveKit or WS/Web Audio | WS queue flush and stale event IDs; RTC interrupt delegated to server | [SDKs](mobile-duplex-sdks-source-audit.md#elevenlabs-explicit-transport-split-and-stale-output-suppression) |
| Hume Voice React | WS/MediaRecorder + shared native-rate AudioContext | User-interruption clears player while capture continues; server engine unverified | [SDKs](mobile-duplex-sdks-source-audit.md#hume-a-real-non-webrtc-counterexample-with-source-availability-limits) |
| OpenAI Agents JS | Browser WebRTC or WS | Cancel generation plus clear output; WS path explicitly truncates unheard context | [Additional](mobile-duplex-additional-source-audit.md#openai-agents-js-realtime-transport) |

Hume's Git repositories were unavailable; original TypeScript was inspected from a verified versioned official npm sourcemap. It is not counted as an accessible Git repository or a verified currently supported hosted product. License evidence is in each detailed report; TEN has additional root restrictions, and some SDK tarballs only declare licenses in metadata. No code was copied in this research change.

## What the implementations teach us

### 1. Duplex media and conversational interruption are separate systems

A WebRTC connection can carry audio both ways while the agent still fails to yield. FastRTC's default policy illustrates this: media stays live, but cancellation follows a detected pause. Conversely, Hume/AIRI/Sutando show that WebSocket/Web Audio can implement duplex; it is not inherently impossible. Our observed Android stall makes persistent received-track RTP the evidence-backed next path, rather than proving all Web Audio is broken.

Vapi, Ultravox and ElevenLabs delegate call media to Daily/LiveKit. OpenAI's browser transport and Qwen's gateway use the same basic application shape: persistent microphone uplink and a received audio track in a native media element. They do not need a new WAV element for every sentence. These are convergent source patterns, not independent hardware qualification results.

### 2. Interruption must cancel production, queued delivery, and stale continuations

The reusable contract is:

1. Detect new acoustic activity while capture stays live. Preserve onset/pre-roll. If supporting false-interruption recovery, distinguish a tentative pause from committed cancellation; do not wait for a final transcript to silence output.
2. On confirmed new speech or explicit stop-speaking, commit cancellation: invalidate the spoken response generation and stop its model/synthesis producers. A cancelled generation can never resume; only a still-valid tentatively paused response may resume after a false alarm.
3. Drain pending output at each queue boundary; reject late frames and callbacks belonging to that generation.
4. Account for the bounded active media/jitter tail. A sender flush cannot retract packets already delivered. Keep the call's audio track alive.
5. Record an interrupted delivery and reconcile generated versus delivered text, so future answers do not assume the user heard the unfinished sentence.
6. Continue the user's new turn. Ordinary barge-in leaves delegated BB work running; only explicit stop-work uses its cancellation authority.

AIRI separates silence from persisted interruption. N.E.K.O fences asynchronous decodes by epoch. Paseo distinguishes active output from pending output. OpenAI cancels the response and clears output separately. Pipecat exposes interruption hooks across processors, synthesis contexts and output queues. These are implementation responsibilities, not features provided automatically by switching an audio element to RTC.

### 3. Speech start, end of turn, and false interruption need different policies

Use speech onset for prompt barge-in, semantic/turn detection for response timing, and an explicit policy for coughs/backchannels. LiveKit supplies a useful model for conditional false-interruption recovery. An explicit “stop speaking” must never be undone by such recovery. Pipecat does not automatically supply the full LiveKit pause/resume mechanism: the first integration must either explicitly implement that distinction or cancel on qualified onset without promising false-interruption resumption. AEC is necessary evidence to examine, not a checkbox that guarantees echo-free audio. AIRI checks realized capture processing before allowing automatic barge-in during its own speech.

### 4. Browser lifecycle is part of the feature

Reusable invariants include per-attempt resource ownership, generation checks after awaits, separate microphone recovery from conversation recovery, bounded disconnection handling, callback-gap measurements, and distinct generation/playback completion events. A reconnect must rebuild media without replaying historical speech or dispatching a second BB task. Keep listening/hearing, generating, transmitting, playing, interrupted and disconnected states distinct.

### 5. No inspected JavaScript module overrides Android's physical route

The [Chromium source audit](android-duplex-routing.md) documents communication-mode and device-pairing behavior. [LiveKit issue 1507](https://github.com/livekit/client-sdk-js/issues/1507) reports adverse Android Bluetooth outcomes, including some successful devices; it remains closed as not planned. That issue is ecosystem evidence, not a diagnosis of this car. The phone export's advancing WebRTC media and live microphone are stronger evidence for this implementation choice than generic “mobile supported” claims, but still not acoustic proof. Foreground browser success also does not prove locked-phone/background service support.

## Current Jarvis gap, re-derived from source

At Jarvis `bff5c0149e7a34f679cb806a19755f085c237080`, `plugins/jarvis/lib/conversation.ts` opens a forced16k AudioContext, connects the capture worklet to destination, gates speech with local energy VAD, calls turn detection on buffered audio, then uploads the completed utterance for transcription. Output collects each synthesized sentence's PCM and plays it through MediaPlayback. `interruptLocal()` already advances a generation and aborts local playback, and server interruption already exists; we should preserve those safeguards rather than claim no cancellation was implemented. However:

| Current gap | Concrete replacement/reuse |
| --- | --- |
| Mic-active native-media stall on this phone; local two-peer diagnostic is not real remote transport | Pipecat browser/server SmallWebRTC and persistent remote-track output |
| Custom browser16k graph and completed-utterance upload | Native microphone track; server decode/resample/VAD/Smart Turn; existing STT adapter initially retains its actual capabilities |
| Full sentence PCM accumulated before playback | Feed Alfred PCM progressively into paced server output; preserve correct sample rate and backpressure |
| Local abort/generation checks do not define the new RTP queue or provider-cancel contract | Pipecat InterruptionFrame and TTS interrupted-context hook, explicit Alfred request abort, context-tagged stale drops |
| Played/interrupted status is coarse; generated text can exceed delivered text | Delivery ledger with response/segment identity and playback evidence; do not fabricate word-accurate truncation without alignment |
| Phone failure surfaced as “speaking” | Separate capture, connection, generation, queue, decoded output and playout progress; bounded failure detection |
| Desktop transport harness is not acoustic/mobile acceptance | Automated real-VM conversational/interrupt/reconnect suite plus separately recorded physical-device observations |

Earlier research supplied useful orchestration and turn-state reuse, but did not establish the Android browser media path. This audit changes the media integration decision. It does not erase unmet requirements or mark the conversation plan complete.

## Implementation handoff

1. Use the existing disposable candidate VM and restricted relay. Add the selected pinned Pipecat server/browser dependencies with provenance. BB remains the orchestrator; no full assistant runtime fork.
2. Expose authenticated SDP/control with the active audio-owner lease. Provision/verify real ICE reachability and short-lived TURN access if required. The existing HTTPS exposure alone does not carry RTP; the registry search has not found an existing TURN service. Inventory/provisioning is engineering work to complete, not a reason for another phone diagnostic matrix.
3. Build adapters for existing STT, BB conversation/control, and Alfred streaming PCM. Keep owning-host credentials in place. Resample at model boundaries server-side. Preserve microphone-off announcements and quiet mode without reacquiring a mic merely to play output.
4. Wire interruption through context invalidation, model/TTS abort and Pipecat output queues. The SmallWebRTC track has no ordinary flush method; do not end it for barge-in. Measure active chunk/jitter tail. Verify cancelled callbacks cannot inject new output or mark unheard announcements delivered.
5. Exercise the actual VM endpoint with actual services: repeated turns, short answers, deliberate overlap, false starts, silent delays, cancellation before first output and during queued output, reconnect, owner transfer and exact-question replies. Keep a task running to prove ordinary barge-in does not cancel it. Include invalid/stale question IDs and captured echo that must not authorize replies.
6. Retain the conversation plan's 30-turn and latency targets. Record detected-speech-to-output-stop, last old-response sample, end-of-turn-to-first-useful-audio and failure counts. Separate sender consumption, client decoded/playout evidence and physical speaker evidence. Report missing phone/background coverage honestly.

This research phase adds no running implementation and changes no stable service. The implementation candidate remains unpromoted. Source reviews are complete for the named paths; the new remote-media integration is outstanding.
