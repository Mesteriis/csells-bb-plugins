# Jarvis control recovery after the gap audit

This candidate addresses the two reproduced defects in the
[full gap analysis](jarvis-full-gap-analysis-2026-11-15.md). It does not complete
release slices A/B or the rest of the Jarvis roadmap. Stable BB is unchanged.
The registered disposable VM serves the actual BB panel and uses the real
restricted relay, model, STT and Alfred services.

## Changes

- Stop delegated work can preempt briefing preparation, briefing playback and an
  ordinary control operation. A generation-scoped control lane prevents stale
  responses or cleanup from replacing/unlocking the newer control. The stop
  dispatch does not depend on successfully interrupting media first.
- Opening-briefing failure still installs the update watcher. Update-refresh
  errors are visible in the browser instead of being ignored.
- Use text connects through authenticated BB HTTP to the existing director,
  bypassing media session creation. It retains director ownership, exact
  displayed-question binding and delivered-text acknowledgments. It does not
  silently take over another active device. Text updates poll while idle.
- BB serves the browser bundle from its built plugin artifact, rather than
  fetching it from the companion. A cold page can therefore load while the
  companion is stopped. Use text is explicitly text-only; ordinary voice mode
  still supports typed replies with its microphone off.
- The parent build/typecheck builds the companion/browser first. Development
  instructions now install those dependencies before building. This does not
  provision media services or resolve the portable-installation gap.

## Verified behavior

The candidate VM passes its build, TypeScript checks, **57 plugin tests and six
companion tests**. Three new control tests cover preemption, late completion,
stale/current failures and closure. The original browser failures provide the
behavioral red baseline; the new component tests initially failed before their
implementation existed.

The checked-in [control regression runner](probes/jarvis-control-regression.mjs)
verified through the actual BB panel:

1. Stop during opening-briefing preparation, before a briefing response exists.
2. Stop during briefing playback, after measuring nonzero decoded remote audio.
3. A competing text client cannot steal an active voice conversation.
4. Cold browser loading, a real model reply, and scoped Stop while the candidate
   companion is **actually stopped**, restored by a shell trap afterward.
5. A text Stop supersedes an in-flight briefing without stale output replacing it.
6. Text-only operation makes no media-session/control/signaling requests.
7. A real BB worker was delegated through the browser and model to execute one
   bounded foreground process. Its PID and command were verified independently.
   Stop during briefing preparation terminated that process; it was observed
   absent **546 ms after the click**. BB independently reports its task idle,
   cancellation observed-idle, and further dispatch disabled.

The process run initially failed a harness assertion because it counted the
previous text-delegation response as an opening voice response. The event window
was corrected. The same verified process was reused; no duplicate was spawned.
Both the failed harness evidence and successful run are preserved privately.

The phone-width layout (390px) has no horizontal overflow. Rendered screenshots
were inspected. These checks use isolated Chrome for Testing, not Chris's
physical Android microphone or Bluetooth route. No physical-audibility claim
follows from decoded audio or a Speaking label.

## Voice regression and latency

The full browser audit also passed **30/30** generated voice turns through the
real STT/model/Alfred path, with **six of six** behavioral checks passing and no
browser page exceptions. The repaired voice-start-failure case now proceeds to
Use text and requires a real model answer. All **68 plugin source files** match
between the working source and staged VM.

Detected-end-to-decoded-audio remains **p50 3,340 ms / p95 4,306 ms**. The audit
therefore still exits nonzero on the unchanged latency gate (<=800ms / <2s).
This repair does not claim a latency improvement or full release acceptance.

## Evidence and limits

Sanitized results are in [the evidence record](evidence/jarvis-control-recovery-2026-11-15.json).
Raw traces, screenshots, build output, source rollback archive and process checks
are retained outside the VM under the task's
`jarvis-staging/control-fixes-20261115/` directory. The
[reproduction guide](probes/jarvis-browser-audit.md) documents the required owned
scope and real-service environment.

This closes the **reproduced busy-stop defect (C10)** and the **cold-start
voice-outage text defect (V11)**. It gives C11 another narrow foreground-process
sample. It does not prove detached-process cleanup, spoken stop timing, late
future descendants, interrupted action reconciliation, or immediate transfer
from an orphaned voice lease after a mid-session companion crash. Those remain
explicit acceptance cases. No automatic ownership takeover was added.

The real spoken allow/deny matrix, two-worker concurrent supervision, uncertain
mutation/restart matrix, physical-device qualification and useful-task scorecard
remain open. Latency, personal memory, sourced recall and event/schedule adapters
are unchanged. The dated gap matrix remains the historical baseline; these
specific results must not be used to mark whole scenario families complete.
