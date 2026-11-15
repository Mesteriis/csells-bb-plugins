# Pipecat Jarvis round-trip spike

2026-11-14 local date; evidence timestamps UTC November15. Disposable VM100, existing task-owned restricted BB relay and real services. Not promoted.

## What runs

Authenticated BB route `/api/v1/plugins/jarvis/http/pipecat` serves one conversation page. Its SDP and short-lived ICE credentials go through authenticated BB routes. Pipecat SmallWebRTC receives microphone RTP, Silero detects speech onset/end, the existing real Smart Turn service evaluates end-of-turn, and existing configured BB STT transcribes the utterance. The real Jarvis director answers with real session context; Alfred PCM streams back through Pipecat's persistent RTP output track. The browser has no16k capture worklet or sentence WAV queue on this path.

The custom spike adapter retains buffered-utterance STT and has no false-interruption resume. Speech onset cancels its pending task/HTTP stream, broadcasts Pipecat InterruptionFrame and interrupts the director generation. The call and microphone remain active. Capture pre-roll and bounded utterances are retained. Explicit displayed-question identity is passed into the existing answer routing. Suspected self-echo is rejected before dispatch. No raw microphone data is saved.

## Verification

[Browser evidence](evidence/jarvis-pipecat-roundtrip.json) came from the actual candidate endpoint and actual STT/model/Alfred services. A known spoken WAV fixture was injected into the browser microphone MediaStream; this is a repeatable input stimulus, not a fake backend. A real briefing played with decoded RMS0.117. Injecting speech during it produced interruption, transcription, a second Jarvis response and nonzero decoded replacement audio. No page errors. The first quiet sample after the interruption event was202.5ms later. This is one browser measurement, not a p95, an acoustic measurement, or proof no future stale response can ever replay. The test did not use a physical Android microphone or car speakers. 51 existing tests and VM typecheck/build passed.

Private harness and screenshot are preserved outside the VM under `thread-storage/thr_qpanimf2w7/jarvis-staging/browser-runtime/pipecat-roundtrip.mjs` and the task evidence directory. Pipecat source archive, resolved dependencies and service definitions are also retained there.

## Networking finding and prepared action

Direct ICE failed from the real browser through the lab NAT despite successful HTTPS signaling. The authenticated coturn relay fixed the browser-to-VM connection when accessed through a private SSH TCP tunnel. Forced-relay browser ICE then reached the Pipecat peer inside the VM.

The candidate TURN service listens on3478, issues five-minute HMAC credentials, permits only peer10.77.0.100, limits allocations to four, and uses internal relay ports49160–49163. The secret is new and candidate-owned; it is never copied to the browser. Only short-lived credentials are returned after BB authentication. Because TURN and Pipecat are on the same VM, the public proposal needs only TCP3478 → Dragon192.168.4.39 → candidate10.77.0.100:3478; the internal UDP relay range need not be exposed. This avoids exposing unrestricted UDP destinations.

No public forward has been created. Eero inventory was read;3478 was absent. Exact temporary forwarding approval was requested, through the existing staging expiry2026-11-18T23:59:59Z. The default ICE URL remains the private test tunnel, so the public page is **not yet phone-review-ready**. After approval: verify Dragon ownership/reservation, add task-labelled DNAT/firewall allowance and the exact Eero TCP forward, set the public TURN URL, verify readback and external connection, and update registry/cleanup evidence. Do not call the private-tunnel pass cellular acceptance.

## Remaining limits

- Public TURN exposure and external network verification pending approval.
- Android/car audibility, echo, interruption and reconnect remain unqualified.
- Existing utterance STT and model latency remain; the measured replacement response began about3.57sec after transcription started. This does not meet the original2sec p95 target.
- The prototype does not poll unsolicited watched updates, implement false-interruption resume, or align model history at word-level playback offsets. Captions remain available. Generation completion is not marked as acoustic playback/approval delivery.
- Session reconnect is explicit End/Start. Full30-turn acceptance, locked/background behavior, takeover races and unconfirmed-task cancellation are not established by this spike.
- Audio-only Pipecat logs missing-video-transceiver warnings; no video is requested or used. ONNX initial device-ID persistence warning comes from the read-only service home; runtime telemetry is disabled before model construction. Coturn SQLite setup was moved to its private temporary directory after its initial permission warning; it uses HMAC credentials, not a user database.

## Cleanup

Existing staging expiry/owner remain. Delete candidate VM/disks and its task TURN secret with normal teardown; remove jarvis-pipecat and jarvis-turn-relay services with the VM. If approved, remove exactly the3478 Eero rule and task-labelled Dragon NAT/firewall rules. Preserve source, dependency lock and evidence outside the VM first. Stop the task's private4845 SSH tunnel after tests. Stable BB and unrelated lab services are unchanged.
