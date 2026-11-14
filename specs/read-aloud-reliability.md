# Read Aloud reliability: root cause analysis and candidate

Owner: thr_apgrfz3e88. Stable plugin: 0.1.5, source in csells/bb-plugins.
Candidate was developed in isolated thread storage and reviewed in a disposable VM.
Chris approved production promotion and push on 2026-11-14; completion is recorded below.

## Incident and evidence

The final reply in thr_4kiidv8zxv was 2,266 Markdown characters. Its original
seven chunk log entries include a 19-second delivery gap. Replaying the exact
text through the stable HTTP endpoint returned 461,808 bytes in 44.53 seconds,
with a 10.87-second gap. This reproduced uneven delivery, not the original
browser's terminal cutoff. The original logs do not record protocol completion,
byte counts, close codes, browser media events or a read ID; they cannot establish
which condition ended that particular playback.

## Confirmed defects

1. `synthesize` treated any WebSocket close as success, without requiring the
   speech protocol `turn.end`. A harness using the actual function returned
   partial bytes on close1006 without throwing. A regression test failed before
   the correction. Empty completed turns also succeeded; a second test failed.
2. Server retries stopped being possible once any bytes were consumed. Partial
   audio went downstream before completion validation; failed attempts could
   neither be replayed safely nor recovered by the browser's single GET.
3. A fixed four-second starting buffer was smaller than measured delivery gaps.
   It did not rebuild a meaningful cushion on starvation. Faster playback makes
   the delivery deficit worse. This is a confirmed vulnerability; the replay
   does not prove the precise cause of the user's original stop.
4. AbortSignal was not connected to the opening handshake. A Stop-during-connect
   regression test timed out before the correction.
5. Successful `playing`/`pause`/`ended` events could overwrite asynchronous
   download errors or turn an incomplete read into apparently normal completion.
6. The status probe returned after its first audio bytes. It proved reachability,
   not complete synthesis. It now drains and validates a full turn.

## Corrections

- Require nonempty audio and protocol completion; report abnormal disconnects.
- Buffer each short turn until verified; retry a whole failed turn up to three
  attempts before exposing an error. Retain verified bytes per read.
- Download chunks with three-way bounded concurrency, consume them in order and
  retry transport failures for the same cached chunk. Explicit server failures
  are surfaced without multiplying exhausted synthesis attempts.
- Start with fifteen seconds of actual decoded buffered audio scaled by speed,
  or the completed message when shorter. On starvation, pause and rebuild the
  cushion before resuming; preserve deliberate user pause. Engines without MP3
  MediaSource receive a complete seekable blob.
- Abort opening and active speech sockets, downloads and MediaSource waits.
  Ignore stale results; preserve error state across later media events.
- Release each read explicitly; expire abandoned reads after ten idle minutes,
  sweep periodically, and dispose retained audio and sockets on plugin unload.
- Log read IDs, indexed chunk attempts, verified byte counts and release events.

## Validation

Red tests were run before the changes for interrupted/empty synthesis and
handshake cancellation. Chunk recovery and download tests were run red before
those modules existed, then green. Existing text normalization and chunking
coverage remains in place. Current results and live browser evidence are retained
outside the VM in the owning thread storage; final observations are appended below.

## Live incident reproduction

Staging reproduced an upstream close1006 on chunk2/7 before turn.end on all
three attempts, with the candidate reporting a visible error instead of accepting
partial audio. A sequential real-service replay subsequently retried that same
chunk successfully (44.01s including its failed first attempt), ruling out
concurrency alone or an unsupported fixed text fragment as sufficient causes.
The full verified replay returned 858,096 bytes (~143s), compared with 461,808
bytes (~77s) from the original stable replay. The old close-as-success behavior
can silently lose a substantial part of the response; the original client trace
still isn't available to attribute every observed browser event.

The actual BB host also rejected DELETE cleanup without JSON content type/body
(415). The frontend now sends JSON and reports cleanup failures; a real request
with that shape returned200. Fake-host tests do not enforce this middleware,
which is why live host verification is necessary.

## Limits

An undocumented external speech endpoint and connectivity cannot be made
infallible. Exhausted recovery must be visible, never silent success. The new
startup cushion deliberately trades some startup latency for continuity. This
candidate does not claim a proven explanation for the original browser cutoff
without a captured failing browser trace.

## Verified candidate results

- Candidate version0.1.6; real BB0.49.0 / SDK0.6.132; disposable Bumble VM1941.
- 51 tests pass; strict TypeScript and targeted ESLint pass; production plugin
  build passes. Host CLI emits its existing Node26 module.register deprecation
  warning; that warning is outside this plugin's code. Staging uses Node22.
- Actual BB plugin HTTP lifecycle validates complete chunks and duplicate
  downloads; real JSON cleanup request returns200.
- Chromium156 in the VM played the exact analytics response to143.303999s,
  matching its decoded duration, including user Pause/Resume and2x playback.
- Final candidate run discarded a completed HTTP download for chunk3 and retried
  it once from the verified cache. Delaying chunk4 by35s caused starvation at
 48.406s, automatic pause and later automatic resume. Playback still ended at
 143.303999s and released its job with HTTP200. Trace asserts the duration,
 retry count, waiting/resume events and release; saved as browser-recovery.json.
- Review uses the actual message-action callback and overlay in a real BB host.
  The staging-only nav page embeds the original response; no agent credentials,
  copied production secrets or fabricated thread records are used.
- Review endpoint's configured HTTPS origin is accepted by the BB plugin route
  (HTTP200); the BB Connect share requires the owner's existing getbb.app login.

The null ALSA configuration is for this headless guest's missing physical sound
hardware. Media decode, playback clock, completion and UI are verified; audible
physical speaker output is not measured in the guest. Chromium UPower and
on-device-model warnings concern absent laptop/AI hardware in a CPU-only test
VM, not speech synthesis; the player passed despite them. Do not interpret them
as speech-provider failures.

Final cancellation checks: a user Stop while prepare was delayed2s prevented all
chunk downloads and playback, and released the late-created job withHTTP200.
An injected exhausted-synthesis error remained visible after later playing,
pause and ended events, with playback paused. Normal cancellation of an active
chunk is classifiedHTTP410 and logged as cancellation rather than an upstream
failure; its regression was run red (502), then green.

## Production promotion — 2026-11-14

Chris approved this staged candidate, promotion, merge into main and push.
Runtime changes were pushed as `3b09b3c2be975d7805819871aea4596e743ca0a6`.
The production plugin is version 0.1.6, installed from the permanent clean main
worktree at `/Users/csells/code/csells/bb-plugins.worktrees/read-aloud-main/plugins/read-aloud`.
The original checkout's branch and unrelated README, lockfile and open-in-window
work were preserved. All five runtime source hashes match the staged approval.

The permanent installation's locked dependencies passed all 51 tests, TypeScript
checks and the production build. Plugin settings match the previous settings
exactly. The actual production BB message action read the original analytics reply
through all seven verified chunks and its natural 143.303999-second endpoint.
Paced playback took 76.245 wall-clock seconds including 2x speed, and the job
released with HTTP200. The headless test has no physical speaker; a separate
accelerated null-sink trace was excluded from this paced-playback assertion.

Previous source/bundles/settings were backed up before promotion and restored
from encrypted Google Drive snapshot `dd89e9c43b5725e0e129ba611e52b8561c14344d699aec6db56b6196afa79d0a`.
Final source, bundles, staging and production evidence, previous version and
recovery instructions are in the central backup controller's encrypted Drive
snapshot `598da7a16ca25ab63c09478f31cb859a1647233128c14d7ac268b5d2da6ebeef`.
All six files restored byte-for-byte and every member of all four tar archives
was read. Temporary controller exports and restore copies were removed.

Bumble VM1941 (`read-aloud-stage`) and its root/cloud-init disks were permanently
deleted after rechecking name, owner, MAC and disk identity. Template9001 and all
unrelated guests were preserved. Its 1536MiB/2vCPU/8GiB reservation was released;
staging credentials, browser profile, Connect share38941 and temporary listeners
were removed. The stage registry record is retired; the production BB record has
the deployed version, verification and recovery references.

Detailed traces and cleanup receipts remain outside the VM under
`/Users/csells/.bb/thread-storage/thr_apgrfz3e88/promotion`.
