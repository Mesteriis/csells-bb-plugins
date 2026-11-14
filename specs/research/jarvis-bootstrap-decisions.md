# Jarvis implementation bootstrap decisions

Date: 2026-11-14. Requested prerequisite: inspect the strongest implementations in Chris's awesome-jarvis repository before writing implementation code. Research is complete for the targeted source paths below; live qualification is still pending. No upstream applications or test suites were executed during the research phase. Implementation began afterward; Qwen lifecycle primitives and the existing BB orb have now been incorporated with provenance and focused tests.

## Mobile media revision, 2026-11-14

The [fifteen-project browser duplex audit](mobile-duplex-source-synthesis.md) extends this initial research after actual Android/car playback failures. Its new media decision selects Pipecat SmallWebRTC and the server voice pipeline as the implementation candidate, retaining BB orchestration, existing STT and Alfred. This supersedes the narrow Smart Turn-only reuse choice for the upcoming media integration; the existing narrow sidecar and custom browser media path remain the currently implemented behavior. No remote-media migration or phone acceptance is claimed. The original orchestration, authority and durable-work requirements below remain applicable.

## Decision

Bootstrap the plugin from the existing BB Jarvis branch plus small, source-attributed Qwen modules. Reuse BB's agent/session/runtime machinery and the registered Pocket Alfred service. Use established turn detection rather than inventing a semantic detector. Borrow specific recovery, approval and memory invariants from OpenClaw, Hermes, Happy and Moltis where their implementations solve our concrete gaps.

This is selective reuse, not a fork of another assistant: the strongest implementations separate input, spoken presentation and accepted work. Their whole runtimes would duplicate BB's responsibilities. The proposed BB integration and approved staging relay remain necessary new code; the source review narrows that code and supplies failure tests.

## Selection and coverage

“Best” here means strongest evidence for a required capability and compatibility with a BB plugin. Chris's [curated scorecard](https://github.com/csells/awesome-jarvis/blob/0378a6801dda9a3345ea7d4a53614f3cd410763f/README.md#scorecard) and [lab results](https://github.com/csells/awesome-jarvis/blob/0378a6801dda9a3345ea7d4a53614f3cd410763f/testing.md) guided selection. Those results include failed voice approvals and subprocess cancellation, so a high overall score does not justify copying defaults uncritically.

| Source | Why inspected | Detailed evidence |
| --- | --- | --- |
| Qwen Audio Agent | Closest voice-plus-background-agent architecture; small extractable lifecycle modules | [Voice review](jarvis-voice-source-review.md) |
| Paseo | Real browser/phone voice with streamed audio and agent execution; historical cancellation failure gives a concrete regression | [Voice review](jarvis-voice-source-review.md) |
| OpenClaw | Durable work supervision, scoped cancellation, notification recovery and provenance-aware forgetting | [OpenClaw review](jarvis-openclaw-source-review.md) |
| Hermes | Bounded personal memory, separate history recall, desktop conversation and async staff | [Hermes/Happy review](jarvis-hermes-happy-source-review.md) |
| Happy | Supervision of existing sessions, targeted permission routing and cancellation ordering | [Hermes/Happy review](jarvis-hermes-happy-source-review.md) |
| Moltis | Typed task/permission controls and deterministic validation of model-proposed memory changes | [Moltis/BB review](jarvis-moltis-and-bb-source-review.md) |
| Pipecat and LiveKit Agents | Existing semantic turn detection and interruption-state implementations | [Voice review](jarvis-voice-source-review.md) |
| BB `origin/eli` Jarvis | Existing integration, orb/stage, speech normalization and sentence/event parsing | [Moltis/BB review](jarvis-moltis-and-bb-source-review.md) |

All detailed reviews pin exact commits, cite code and tests, identify root license notices, and distinguish observed source from recommendations. This is not an exhaustive audit of every project listed. Native-only assistants, projects with noncommercial/source-available constraints, and commercial products were not chosen as code donors when these sources already cover the required paths. That selection does not claim the other products are inferior overall.

## Concrete reuse ledger

| Capability | Bootstrap source | Reuse form | Required BB adaptation |
| --- | --- | --- | --- |
| Speech normalization and sentence streaming | BB `plugins/jarvis/speech.ts` plus tests at `758fb4e` | Selective direct reuse | Reconcile current main read-aloud improvements; bounded Pocket chunks and unclosed-fence handling |
| Glanceable presence | BB `components/Orb.tsx`, `Stage.tsx` | Selective direct reuse | Independent input/output/task states, existing-session dashboard, accessibility |
| Turn generations | Qwen `realtime-turn-state.mjs`, `turn-correlation.mjs` at `02990dc` | Unmodified dependency-light JavaScript pair and race tests, behind typed plugin boundaries | Bind voice/manual input to BB dispatch; stale transcripts cannot redirect new work |
| Notification ownership | Qwen `task-notification-queue.mjs` | Unmodified small injected-state module reserved for the durable delivery wrapper | Transactional BB storage, mandatory claimant/generation checks, quiet/expiry policy and playback acknowledgements |
| Semantic turn detection | Pipecat `LocalSmartTurnAnalyzerV3` at `1bc2e37` | Evaluate actual pinned dependency in narrow VM sidecar | Model artifact/terms review, 16 kHz preprocessing, measured latency and room quality; no full voice/runtime replacement |
| Streaming STT/audio | Paseo turn-controller and PCM contracts | Adapt interface and test scenarios; optional small helper after quality review | BB transcription/Pocket leases, finalization uncertainty, correct 24 kHz output |
| Durable work and cancellation | OpenClaw lifecycle/receipt invariants; Happy abort ordering | Adapt state model and regression cases | BB IDs, owned descendants, queue inhibition, provider-specific actual termination |
| Exact approvals | Qwen broker + Happy owner/current-generation lookup | Adapt validation and races | Actual BB interaction schema, user authority and current action binding; no model self-approval |
| Personal memory and recall | Hermes bounded mutations/history search; Moltis validated forget; OpenClaw tombstones | Adapt storage/recall algorithms and failure tests | Structured source records, correction revisions, content-free replay suppression; original BB history remains separate |
| Schedules and initiative | OpenClaw occurrence/recovery rules and deterministic heartbeat eligibility | Adapt rules/tests, reuse BB scheduler | Explicit source enablement; missed read checks versus uncertain started work; disable fences |

When incorporating code, retain applicable notices, record full revision and modifications in the package's provenance ledger, and check dependencies/assets separately. Qwen and Paseo carry Apache-2.0 notices; inspected OpenClaw, Hermes, Happy, Moltis and BB roots carry MIT; Pipecat source carries BSD-2-Clause. LiveKit has separate terms for covered models: the standalone BB detector must not assume its code license covers extracting those weights. This is an observed notice inventory, not a blanket dependency license audit.

## Design consequences

1. **Separate execution from delivery.** Task execution, result verification and notification delivery each have their own persisted state. A reconnect may retry a notification; it must not reexecute accepted work. A spoken message is delivered only after current-owner playback acknowledgement or explicit visual disposition, not after synthesis starts.
2. **Fence asynchronous work by generation.** Check input, presentation, interaction and task generation after awaits, not only before. Barge-in discards an obsolete response; explicit Stop work additionally inhibits dispatch and queued continuations. Refresh owned descendants while cancellation settles. A stale stop must not kill newer work in a reused session.
3. **Treat uncertain mutations explicitly.** Persist an operation identity before dispatch and reconcile real BB state after lost replies. Never transform transport failure into a fresh spawn. Cancellation and approval replies distinguish accepted, confirmed, stale and unknown.
4. **Keep internal events out of the user-input lane.** Worker completion cannot interrupt the active user conversation or become fresh authorization. Queue/coalesce updates, preserve original task/request/source identity, and distinguish ordinary worker prose from structured approval.
5. **Use a real detector and measure it.** Existing energy-VAD defaults range from 750 to 2,500 ms silence; copying them would consume or exceed the complete response budget. Compare the Pipecat dependency with supported provider detection before committing. Keep the existing BB pre-roll/generation lessons; do not mistake acoustic silence for conversational completion.
6. **Make forgetting restart-safe.** Commit suppression identity before purging derived facts, summaries, indexes and caches. Surface pending cleanup and resume it after failure. Relevant history recall is a separate bounded BB search/read path, not wholesale transcript ingestion.
7. **Keep schedules from replaying uncertain actions.** A missed read-only review can be coalesced. A started occurrence with unknown side effects needs reconciliation, not catch-up execution. Disabling or editing fences old delivery attempts.

## First implementation sequence

Before coding, complete the [approved staging setup](jarvis-staging-preflight.md). Then:

1. Create the current-SDK plugin shell and provenance ledger; port reusable pure modules with upstream regression cases. Keep component changes attributable rather than merging `origin/eli` wholesale.
2. Implement the durable BB coordinator and restricted relay using the same typed operations. Start with unknown-dispatch recovery, cross-client decision races and cancellation of late descendants. No broad RPC proxy or new agent runtime.
3. Connect the reused UI to actual existing sessions; test typed delegation, question relay, exact decisions and scoped stop against real BB.
4. Add Qwen-derived conversation generation and claimed announcement delivery, BB speech formatting and Pocket streaming. Evaluate the actual turn detector before choosing defaults.
5. Add sourced memory and fault-recoverable forgetting, then enabled event/schedule journeys. Reuse BB history/scheduling services throughout.

The acceptance suite must reproduce the historical failures that motivated the design: spoken yes becoming plain chat, stop leaving a subprocess alive, stop followed by automatic resubmission, busy-parent interruption from internal completion, and late speech/transcription returning after a new turn. Upstream test scenarios provide the starting cases; only the actual staged candidate can establish our outcome.
