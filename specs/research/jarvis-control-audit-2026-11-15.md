# Full test-panel control audit — November 15, 2026

The previous checks covered reported defects, not the whole UI. This audit adds
`probes/jarvis-all-controls.mjs`, using the real staged BB relay, model and
CosyVoice/LiveKit. The microphone is a silent synthetic track. All 14 button IDs
are exercised, plus selectors, disclosure controls and download payloads.

| Controls | Browser verification |
|---|---|
| Start, End | Fresh speech; End during speech and startup; no late startup resurrection |
| Use text, Send | Real model answer in text and voice; typed Send interrupts speech |
| Brief me, What needs me | Both during speech and in text mode |
| Keep me updated / Pause watching | Both transitions during speech and in text mode |
| Quiet / Resume updates | Both transitions, preserving the initial quiet setting |
| Microphone off/on | Button label and actual synthetic track enabled state |
| Stop speaking | During speech and while the briefing model is preparing |
| Stop delegated work | Real scoped dispatch, existing task-owned idle jobs; not a new foreground-process cancellation trial |
| Enable audio | Real SDK recovery after injected browser play rejection |
| Download diagnostics | Actual downloaded JSON has current session and start event |
| Download voice grade | Actual JSON includes selected voice and entered ratings/notes |
| Voice/pace, disclosures | Selectability, active lock, live task list, phone-width layout |

Two additional defects were reproduced and fixed:

1. Stop speaking did not invalidate pending briefing generation; the eventual
   response began speaking after Stop. Stop and typed Send now invalidate control
   presentation and cancel relay inference. A unit regression and the real browser
   preparation/Stop regression pass.
2. A successful retry of End after a failed close left the old error visible.
   Recovery now clears that resolved error. Failed cleanup retains credentials,
   keeps Start disabled, and offers End again.

The complete run passed 29 checks with no page errors. The strengthened recovery
check subsequently reproduced the stale-error problem, then passed after its
small UI fix. The complete run is not represented as rerun after that last fix;
its affected autoplay/close/error path was retested. Companion build and 17
component tests pass; plugin build passes.

This establishes the listed control paths on desktop staging with CosyVoice.
It is not every possible concurrent click ordering, every engine combination,
physical Android/Bluetooth qualification, active-worker cancellation requalification,
or approval to promote. Startup latency and subjective noise acceptance remain open.

[Before/after evidence](evidence/jarvis-control-audit-2026-11-15.json).
