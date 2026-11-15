# Integrated LiveKit candidate — 2026-11-15

Chris authorized implementation after the successful Android LiveKit spike. This
candidate moves the proven TypeScript transport into `plugins/jarvis/voice` and
embeds its authenticated page in the BB Jarvis panel. Stable BB is unchanged.
No production promotion is implied by spike feedback or this implementation.

## Implemented

- Start obtains the conversation lease, connects native WebRTC audio, enables
  watching, and speaks a real recent-thread briefing. Text mode uses the same
  director and output pipeline with the microphone off. Microphone denial leaves
  text/audio available and visibly explains the failure.
- Idle polling delivers consequential changes and exact current questions.
  User speech wins over an update in progress. Updates are refreshed before
  replay, quiet mode retains changes, and completion is attached to the actual
  LiveKit speech handle. Transport completion is distinct from hearing an answer.
- Ordinary chat combines classification and reply in one model request. Actions
  retain BB ownership, permission and exact-question checks. Task steering has a
  persisted request receipt before dispatch; uncertain delivery is not retried.
- Named task requests, task status, natural-language steering, and separate
  speech/work stops are available. Task focus can resolve the original request
  even when the BB title differs. Automatic announcements name the thread.
- A session-correlated diagnostics download survives End. Client media counters,
  pipeline stages, transcription durations and model first-text/total durations
  distinguish transport, synthesis and director delays. Microphone audio is not
  persisted. Private director history still contains conversation text.
- A systemd example and explicit companion install/build/start commands document
  lifecycle dependencies. Service provisioning remains operator-managed.

## Verification

Actual disposable VM: 57 policy/coordinator tests and three PCM framing tests
pass, along with TypeScript checks and plugin/companion builds. Coverage includes
stale question rejection, quiet updates, exact delivery claims, ownership,
uncertain dispatch and steering idempotency. Tests do not prove physical audibility.

The actual BB panel renders at 390px width without horizontal overflow or page
errors. Typed input returns an Alfred reply through LiveKit with microphone off.
A real task-owned BB worker received the exact bound answer “Violet” and returned
`VIOLET_LANTERN_RESULT Violet`; its BB event history independently confirms the
answer, rather than relying on Jarvis's acknowledgement. A second worker was
announced automatically by name, accepted “Amber,” and returned
`AMBER_KITE_RESULT Amber`. Directing that task through Jarvis produced
`AMBER_KITE_STEERING_VERIFIED` in its real BB output. Quiet mode and scoped stop
passed in the panel; five owned tasks reported idle. A live steering failure
exposed an incorrect SDK argument shape, which was fixed with a regression test
that first failed against the old implementation. The uncertain receipt was
retained and never automatically resent.

After a companion service restart, a browser with microphone permission denied
showed the explicit fallback and still completed a typed delegation with voice
output. The task panel showed Cedar Pause starting; Stop delegated work reported
one targeted task idle, and the refreshed task card showed `observed-idle`.
Unrelated BB threads remained running. This validates BB task cancellation, not
termination of arbitrary detached OS processes. See
`integrated-restart-fallback-evidence.json`. All task-owned browsers closed and
sessions released at the end of the checks. Public review access without owner
login returns 401.

Recorded microphone -> actual staged LiveKit -> real BB STT/director -> Alfred
-> browser audio passed. The injected utterance interrupted a briefing and
received “2 plus 2 is 4.” No page errors or reported packet loss. The test bypasses
physical microphone/AEC and is not a second Android/car acceptance claim.

For that utterance:

| Measurement | Observed |
|---|---:|
| Detected user-speaking -> agent-listening event | 160 ms |
| Detected end of speech -> STT result | 1.01 s |
| Director model request total | 2.36 s |
| Detected end of speech -> agent-speaking event | 3.87 s |
| Detected end of speech -> measured received audio | about 4.00 s |

The previous Android spike measured 6.2–9.9 seconds to speaking. This single
controlled sample supports the faster path, not a production latency percentile
or an apples-to-apples physical-device benchmark. Initial briefings still wait
for full model text (about 8–10 seconds in these runs); token streaming into
speech and streaming STT remain unimplemented.

Detailed private evidence and harnesses are retained outside the VM in
`thread-storage/thr_qpanimf2w7/jarvis-staging/`: `livekit-integrated-roundtrip.json`,
`integrated-ui-evidence.json`, screenshots, candidate source archives and service
journals. Earlier failed UI checks are retained: a harness argument bug first
missed a valid response; a subsequent check exposed unnamed question updates,
which prompted the thread-name fix. Neither failed check counts as a pass. The steering-failure run is retained as
`integrated-ui-before-steering-fix.json`; final control results are in
`integrated-controls-evidence.json`. A repository-root test invocation also found
missing Vitest/Zod dependencies in unrelated plugins; the scoped Jarvis suite and
actual VM builds passed. No unrelated plugin source was changed.

## Remaining scope

The full vision is not complete. Persistent personal memory and recall, external
events, scheduled reviews, fully automatic companion provisioning, exact heard
transcripts and latency percentile dashboards remain later work. The integrated
candidate still needs long conversation, cellular recovery, Android/Bluetooth
route-change and background/locked-screen qualification. The successful physical
spike test remains evidence for the transport choice, not for every integration
behavior. Service/room reconnection cannot guarantee arbitrary detached task
process cancellation.

Review uses the existing task VM and restricted host relay. Candidate-only
credentials, TURN route expiry, source/evidence backups and cleanup ownership
remain in the lab registry. Stable promotion requires explicit review approval.
