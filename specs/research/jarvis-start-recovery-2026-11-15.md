# Stop/start recovery — November 15, 2026

Chris reported Ended in the browser while the server rejected Start with an
active-conversation error. Server logs show Qwen closing at 02:41:32 UTC, followed
by a CosyVoice reservation connected at 02:41:56 that never began its briefing.
The exact browser-side trigger is not available; a lost startup response
reproduces the same orphan reservation and error.

Previously, the browser only learned its cancellation credentials from the
completed startup response. If that response was lost, its failure cleanup had
nothing to close. The server retained the reservation until its idle expiry.

The browser now creates random reservation credentials before startup and sends
them with the request. End can cancel preparation, startup completions are fenced
by a generation counter, and concurrent End calls share cleanup. Failed close
retains credentials and offers retry instead of declaring Ended. Server startup
checks cancellation after preparation and asynchronous resource acquisition.

`probes/jarvis-start-recovery.mjs` reproduced the exact active-conversation error
before deployment by discarding a real Qwen startup response. After deployment,
the same test successfully started Kokoro; it also stopped Qwen during speech,
ended, and immediately started Kokoro again. All task browsers closed. This is
real browser/LiveKit/model testing with a synthetic silent mic, not Android or
physical acoustic verification. Build and 16 companion tests passed.

[Before/after evidence](evidence/jarvis-start-recovery-2026-11-15.json).
Reload staging to get the new startup protocol. This fixes the reproduced
reservation leak, not Qwen's independent synthesis latency/recovery limitations.
