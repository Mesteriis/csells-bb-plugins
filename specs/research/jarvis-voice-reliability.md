# Jarvis voice reliability follow-up

Date: 2026-11-14. Follows the [implementation gap analysis](jarvis-implementation-gap-analysis.md), whose findings describe revision `81ecef2`. The complete vision remains open; this change addresses the reported silent-output failure and adjacent control correctness.

## Confirmed causes and limits

The previous staging relay was bound to an agent execution session and was found unavailable on port 4842. Its exact exit cause was not captured. The VM BB and turn services remained active. Browser “Speaking” was set before audio was requested. Neither observation proves why the earlier Bluetooth interval was inaudible.

A real browser failure test additionally exposed BB's rejection of an optional `undefined` RPC field in typed fallback. Omitting absent bindings fixes that boundary. A direct relay test alone did not catch it.

## Implemented

- Task-owned launchd supervision, host-local account-pool token reference, per-request token read, successful expiry/shutdown exit, crash restart and exclusive loopback binding in place of stale PID locks. No shared credential copied to the VM or supervisor config.
- Explicit framed PCM completion after synthesis and lease release. Premature EOF, malformed/empty PCM and post-header failures cannot produce successful playback acknowledgement. Browser stream reading uses `getReader()`.
- Preparing-audio state, context state diagnostics, bounded playback wait, interruption cleanup and user-triggered audio retry. A scheduled/running browser context still does not prove a physical speaker was audible.
- Typed answer binding to the displayed current question independently of audio, including stale-binding rejection. Generation/ownership fences immediately before mutation and after persistence. A canceled unsent receipt is removed so it is not misreported as an uncertain send.
- Playback claims bound to the owner lease and conversation generation; stale acknowledgements cannot authorize a voice answer. Failed audio is distinct from deliberate interruption. Repeating a question retains its presentation binding.
- Bounded, allowlisted metadata on the browser and relay: request IDs, stages, timing/counts, HTTP status, AudioContext state and browser/OS. No raw audio, transcript, prompt, arbitrary error or credentials. Local export works even if the relay is down. Retention is up to 200 browser / 1,000 relay events, filtered to 24 hours and pruned on subsequent writes.

## Verification

- Three regression failures were observed before the control fixes: typed answer rejected, stale displayed binding unsupported, and an interrupted validation still sending. All now pass, together with stale playback acknowledgement coverage.
- Audio framing tests cover byte-by-byte fragmentation, empty/truncated streams and a real HTTP response failing after initial audio. Diagnostic tests cover content/secret rejection, restart persistence, size cap and age filtering.
- VM typecheck, build and 44 tests passed on the disposable Debian candidate.
- Task-only crash injection verified the exact relay command before SIGKILL. launchd restarted it with a different PID in 771 ms; the real SDK task read recovered four persisted task records. [Restart evidence](evidence/jarvis-reliability-supervisor.json). This does not establish reboot acceptance.
- [Browser acceptance](evidence/jarvis-reliability-browser.json) passed: destination RMS 0.182, real input/output services, injected audio 503, typed chat and an exact typed answer confirmed by the owned worker; no page errors, final alerts or mobile overflow. The harness uses recorded input through a browser MediaStream and measures PCM energy at the Web Audio destination, with real turn/STT/voice services. It does not substitute for a physical Android/Bluetooth test.

The task-owned runtime evidence is retained outside the VM under `thread-storage/thr_qpanimf2w7/jarvis-staging`. Private journals are not published. No promotion occurred.

## Still open

Physical Android/car playback and exact browser/version; a full 30-turn and listening-hour suite; measured latency distributions; finer model/lease failure categories and complete support-bundle aggregation; microphone echo/continuation calibration; automatic recovery of failed notifications; conversational request deduplication, uncertain-answer reconciliation and stale notification supersession. The larger A/B staff-behavior gaps, C memory/recall and D schedules/events remain as listed in the original analysis.
