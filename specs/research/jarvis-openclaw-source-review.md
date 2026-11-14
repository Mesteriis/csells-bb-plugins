# OpenClaw source review for BB Jarvis

Reviewed 2026-11-14. Scope: implementation research before writing Jarvis code. Current upstream main was cloned read-only at **6012559a07fd823d40d4fde1d9847ac305e411d4** into `/tmp/jarvis-openclaw-review`; no dependencies installed, applications launched, tests executed, or service state changed. This is source inspection, not fresh hands-on verification. The shallow checkout contains approximately 65,000 tracked files: observations below are targeted paths, not a whole-repository audit.

## Decision

Use OpenClaw as a reference for durable orchestration, cancellation races, source-bound delivery and memory deletion. **Do not embed its gateway or agent runtime in BB.** BB already owns provider sessions, execution, permissions and scheduling. Importing the entire runtime would duplicate those responsibilities and its permission defaults do not match Jarvis's authority contract. Adapt its proven design intent and failure-case test scenarios to BB's actual SDK; code presence and upstream test assertions do not prove those tests pass on our stack.

There is no claim that OpenClaw is the best voice front end. Chris's own lab results found real speech and barge-in but click-only approvals, and a spoken browser cancellation followed by re-sending the request. The macOS test used actual cancellation controls, but spoken “allow” and “stop” became chat text. Preserve these as regression scenarios rather than assuming this newer source fixed them. See the [local test report](/Users/csells/code/csells/awesome-jarvis/testing.md) and [recorded cancellation evidence](/Users/csells/code/csells/awesome-jarvis/lab/evidence/openclaw/mac-app-cancel-subagent.txt).

## Findings and transfer to BB

### 0. Delegation returns an accepted receipt, not the finished answer

**Observed:** Native subagent spawn prepares ownership/context, admits and registers the child, releases preparation capacity, and returns `accepted` with child-session key, run ID, mode and expected completion delivery. ACP spawn returns the same accepted-result shape after its spawn pipeline; its comment explicitly avoids a duplicate task-registry projection because the gateway manager already publishes it. Sources: [native spawn](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/subagents/spawn/subagent-spawn.ts#L665), [ACP spawn](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/subagents/spawn/acp-spawn.ts#L690).

**Apply:** The BB talker should receive an accepted task receipt promptly and later source-bound completion events. Do not wait for worker completion inside its delegation tool. Admission/setup still takes time: an accepted-return architecture does not itself establish the 800 ms voice target. Persist only Jarvis-specific correlations and delivery state; avoid a second authoritative copy of BB execution state.

### 1. Execution, result and notification are different state machines

**Observed:** The registry projection carries separate execution status/timestamps, completion state, and delivery status/disposition. Normalization resets an `in_progress` delivery without a durable queue ID to pending after restart. An in-process cleanup lock is reset when durable cleanup completion was not recorded. Maintenance preserves pending delivery and kill-reconciliation tombstones. A pause notice is consumed separately from the completion wake. Source: [delivery state implementation](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/subagents/registry/subagent-delivery-state.ts).

**Apply:** Jarvis's task row needs independently persisted execution observation, verified outcome, and announcement delivery. A worker going idle cannot imply result verified, nor can a successfully spoken message imply work succeeded. After restart, retry notification only through a durable delivery identity; keep unfinished cleanup visible. This is particularly important when a task finishes with its microphone off or quiet mode on.

**Reuse:** Adapt the states and invariant tests; do not copy the full registry module, which imports OpenClaw execution/session state throughout. Start with the smaller BB-owned task ledger and notification outbox already required by plan 0003.

### 2. Mutation outcomes can be unknown, even when the caller sees an error

**Observed:** Registry persistence serializes writes by source and keeps pending write records. It explicitly distinguishes committed-but-unreadable receipts from unknown outcomes. `assertSubagentRegistryWriteOutcomeKnown` prevents dependent work for affected run IDs while an uncertain write remains. Database custody is checked independently of the original caller's authorization. Source: [registry persistence implementation](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/subagents/registry/subagent-registry-persistence.ts).

**Apply:** Persist dispatch intent and a unique request/correlation ID before spawning a BB worker. If an HTTP reply is lost, reconcile actual BB state rather than dispatch again. Use a stable originating request plus operation generation, not a fresh random identity on every retry. Preserve an unknown outcome when BB cannot prove whether a mutation happened. This also applies to the approved staging relay: the VM losing the response must not duplicate a real worker.

**Reuse:** Pattern and failure tests. BB plugin SQLite transactions can implement a much smaller operation journal without OpenClaw's process/database-worker infrastructure.

### 3. Stop is a scoped lifecycle operation, not an abort flag

**Observed:** Kill selection checks expected generation, owner and optional exact session ID. The code captures the execution, records acceptance separately, joins disposal outside exclusive mutation, and reports `cleanupPending` versus completed cleanup errors. It drains exact-request commands even after a model turn has ended. It refreshes the descendant frontier while cancelling, so a child registered during cancellation is not ignored; failures in a parent do not silently eliminate all attempts on descendants. Sources: [kill traversal and settlement](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/subagents/registry/subagent-control-kill.ts) and [exact kill-intent matching](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/subagents/registry/subagent-control-kill-intent.ts).

**Apply:** Capture the owned BB task/descendant set and request generation before cancellation. Inhibit Jarvis's queued continuations while the stop is in flight, reconcile late descendants, and distinguish request accepted, actual worker stopped and cleanup unconfirmed. A later reused-session generation must survive a stale stop. Model silence and API `{ok:true}` are insufficient evidence.

**Meaningful upstream test:** [accepted-stop tests](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/subagents/registry/subagent-control.accepted-stop.test.ts) includes a case joining execution registered while an accepted Stop is still awaiting kill-claim persistence, plus waiting for terminal controller disposal. Adapt these races to actual BB sessions and bounded real processes, alongside the original lab's “spoken stop causes resubmission” regression.

### 4. Approval revalidation belongs at the last execution boundary

**Observed:** [execution approval binding](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/bash-tools.exec-approval-binding.ts) revalidates both a mutable file binding and the approved working-directory snapshot immediately before spawn, returning an explicit denied tool result on drift. The approval documentation says policy, allowlist and approval interact, but documents a `full` / `off` baseline for an unconfigured node/Gateway and full-session exceptions. It also limits file binding to recognized cases rather than claiming every interpreter is secured. Source: [exec approval policy](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/docs/tools/exec-approvals.md).

**Apply:** Jarvis should bind a voice answer to the exact current BB interaction, action details and source generation, then re-read it before resolution. The relay must enforce its owned-target allowlist independently of model text. Existing BB provider/tool policy remains the downstream enforcement layer; routing a “yes” accurately does not secure an unrestricted shell/browser path.

**Avoid copying:** OpenClaw's permissive defaults, self-approval through a model, or an assumption that a command-string hash captures every consequential effect. Reuse the boundary-revalidation concept, with denied, stale and competing-client tests. The source does not establish a complete domain policy for email, spending or infrastructure.

### 5. Completion delivery keeps the original authority and origin

**Observed:** [completion authority/routing contract](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/docs/tools/subagents/announce.md) describes duplicate suppression through persisted completion/source-message facts, captured requester-turn origin for routing, and aggregation scoped to the requester run. It explicitly states child completion does not grant global write access. [completion retry classification](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/agents/subagents/announce/subagent-announce-delivery-retry.ts) distinguishes permanent delivery errors from retryable failures and recognizes evidence that delivery happened before an error. It treats source-lifecycle changes as their own failure.

**Apply:** Completion records should retain original task, worker thread, initiating request and source event. Never route to whichever thread happens to be selected now. Before announcing or accepting a response, check that the notification/decision is still current. A message delivered before a transport error must not be blindly repeated. Terminal permission failures should produce a visible limitation rather than repeated inference loops.

**Reuse:** Retry classification and delivery receipts as patterns; BB's event cursor and current thread/interaction snapshot remain the source of truth. Ordinary worker questions need a separate response route, not a forged approval interaction.

### 6. Scheduled recovery must distinguish missed work from uncertain work

**Observed:** [cron startup recovery](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/cron/service/startup-run-repair.ts) repairs interrupted runs with an explicit error and unknown delivery state. A started one-shot whose outcome is uncertain is not automatically replayed; a distinct replacement occurrence preserves its own eligibility. [cron delivery fence](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/cron/service/delivery-attempt-fence.ts) checks agent availability, lifecycle generation, cancellation and job removal before delivery and commits a delivery-start record; a lost reply alone does not authorize sending.

**Apply:** For plan 0004, “catch up missed checks” must not mean re-execute an already-started consequential action. Store occurrence identity, start receipt, observed result and notification state. A missed read-only review can be coalesced; an uncertain side effect needs reconciliation. Editing/disabling a schedule must fence older delivery attempts while allowing explicitly retained work to report honestly.

**Reuse:** Requirements and race tests through BB scheduling. Do not port OpenClaw's cron engine into the plugin.

### 7. Heartbeats separate observation from interruption

**Observed:** [heartbeat response/filter contract](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/src/auto-reply/heartbeat.ts) instructs the model to follow supplied monitor context rather than infer old tasks from chat, directs recurring tasks to automations, and defines a structured `heartbeat_respond` outcome with `notify=false` for quiet observations. It supports silent-result filtering rather than turning every check into speech.

**Apply:** Jarvis should perform deterministic change filtering first, then ask whether a new relevant condition merits an update. Keep internal monitor context separate from the user's utterances. Scheduled work requires explicit configuration; remembered unfinished work is not permission to create recurring jobs. Use a typed notification result plus source/event dedupe, not a text magic word as the sole policy boundary.

**Coverage limit:** Inspected the response/filter contract and cron recovery, not every heartbeat scheduler path. Wake latency and notification quality are unmeasured.

### 8. Forgetting is a recoverable purge of derived state

**Observed:** [forget implementation](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/extensions/memory-core/src/memory-forget.ts) requires a selector, supports dry run, locks the workspace, resolves source origins, and handles mixed lineage. It commits tombstones before purging and leaves the marker durable when purge fails. Later artifact writes compare expected content and can fail on drift rather than overwrite concurrent work. [forget recovery tests](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/extensions/memory-core/src/memory-forget-recovery.test.ts) seeds mixed and clean provenance, derived corpus/backup/index artifacts, and faults index, sources, backup, memory, corpus or origin cleanup to test recovery while preserving unrelated facts.

**Apply:** Jarvis's forget operation needs an operation ID, content-free suppression identity, provenance and retryable cleanup of facts, summaries, indexes and caches. Track deletion pending until all derived stores are cleared. Preserve original BB transcript retention separately, as agreed in the vision. Test a restart or failure after each purge phase and then replay the source event: the forgotten fact must not return. Mixed-source summaries must be regenerated or removed conservatively.

**Reuse:** The tombstone-before-purge sequence and fault matrix. Do not adopt its full “dreaming” memory subsystem or mutate BB transcript files. OpenClaw's artifact layout is not BB's storage contract.

### 9. Voice recovery uses ownership generations

**Observed:** [native realtime Talk ownership](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/apps/macos/Sources/OpenClaw/TalkModeRuntime+Realtime.swift) checks lifecycle/relay generation and exact session ownership, retires a disconnected relay before recovery, and notes that accepted agent work must survive relay recovery. It contains explicit native-speech fallback states. This is a macOS implementation, not a reusable browser audio package.

**Apply:** Tie Pocket synthesis chunks and playback queues to a response/audio-owner generation. Reconnect or barge-in invalidates old audio; it does not silently stop already-accepted workers. Keep the separate explicit Stop work route. Jarvis's agreed adapter policy requires visible failure and explicitly selected alternatives, so do not copy automatic voice substitution merely because this client uses it.

## Reuse and license disposition

The inspected root LICENSE is MIT, copyright OpenClaw Foundation 2026, requiring retention of its notice for copies/substantial portions. Third-party code and assets need their own notice review. This establishes a plausible source-reuse route, not blanket license clearance for every dependency. No source has been copied into our implementation. Source: [MIT license](https://github.com/openclaw/openclaw/blob/6012559a07fd823d40d4fde1d9847ac305e411d4/LICENSE).

| Candidate reuse | Choice | Reason |
| --- | --- | --- |
| Complete OpenClaw runtime/gateway | Reject | Duplicates BB orchestration and permission/session infrastructure |
| Delivery, kill and persistence state machines | Adapt their invariants and tests | Directly address our known failure cases; implementation is deeply tied to OpenClaw internals |
| Pure error/state helpers | Consider narrow attributed ports only after extracting dependencies and tests | Potential savings, but no demonstrated self-contained package boundary yet |
| Cron engine | Use BB scheduling; borrow occurrence/receipt rules | Avoid a second scheduler |
| Memory engine | Borrow provenance/tombstone/failure-recovery design | Preserve BB retention and keep initial scope small |
| Native Talk client | Borrow generation and reconnect behavior | Swift/macOS code cannot bootstrap browser audio directly |

## Bootstrap order suggested by this review

1. Extend the implementation design with distinct operation, execution and notification identities; map each to supported BB APIs before coding.
2. Start tests from transport ambiguity, stale authority, late descendants and cancelled continuations rather than only happy-path delegation.
3. Implement the smallest BB-backed coordinator/relay that satisfies those cases, reusing BB state and controls.
4. Layer voice over those same typed operations. Reproduce Chris's earlier cancellation/approval failures as actual staged acceptance journeys.
5. Add provenance and deletion recovery before automatic memory capture, then occurrence-based proactivity through BB scheduling.

No benchmarks were rerun. No claim is made that the current upstream passes the historical voice failures. Full end-to-end verification remains required for our candidate.
