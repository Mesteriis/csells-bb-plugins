# Jarvis implementation gap analysis

Assessment date: 2026-11-14. Implementation reviewed: `81ecef2b4247d8a272593b72a28799bfa1fc5345`. This is an implementation/evidence audit, not a declaration that the plans have passed. No service code or runtime configuration was changed in this audit.

Jarvis has a working, narrowly tested voice-and-thread coordination path. It is an early implementation, with substantial functionality and reliability work remaining. It is not close to satisfying the complete vision. None of the four delivery slices has met its complete acceptance gate. Calling the earlier staging build a complete hands-free service overstated what had been established.

Follow-up: [voice reliability fixes and verification](jarvis-voice-reliability.md). The assessment below is preserved as the original baseline.

## Completion by planned milestone

| Milestone | Current position | What blocks completion |
| --- | --- | --- |
| A — Responsive chief of staff | Partially implemented | General delegation/steering, project/session selection, visible task management, domain authority validation, complete recovery, real approval/cancellation acceptance |
| B — Voice-complete interaction | Partially implemented; current user attempt failed | Android/Bluetooth playback, natural turns and corrections, latency, durable diagnostics, reliable service lifecycle, complete typed fallback, handoff/reconnect and failure recovery |
| C — Complete initial experience | Memory and recall absent; persona and thread awareness partial | Sourced memory capture/retrieval/correction/deletion/export, past-decision recall, selective notifications and real-task scorecard |
| D — Complete planned vision | Not implemented | External-event adapter, scheduled review, configuration/authority, deduplication, missed-run recovery and disable controls |

The parent plan explicitly defines A+B as the first review candidate, C as completion of the initial experience, and D as completion of the broader planned vision. We have demonstrated portions of A+B; we have not passed A+B. A percentage would obscure this distinction and imply an effort estimate we have not established. Two partially built slices and two largely unbuilt slices is the defensible measure of progress, not “almost done except phone testing.”

## What exists and what the evidence establishes

- The entry screen has Start Jarvis, Brief me, Keep me updated, and What needs me. Captions, recent conversation, microphone/quiet/stop controls and an explicit device takeover action exist.
- The assistant reads real BB root sessions, summarizes recent work, and maintains one focused question. Native single-select/free-text questions and Codex asynchronous question cards have adapters; multi-question forms collect answers sequentially.
- The browser captures audio with an AudioWorklet. Acoustic onset gating, bounded pre-roll, Pipecat Smart Turn, BB transcription, model responses, and streamed Pocket/Alfred PCM are wired together.
- The coordinator persists dispatch intent, protects repeated operation IDs, reconciles uncertain spawn replies, validates exact pending interactions, and attempts stop across owned descendants and queued work.
- A private journal retains conversation/decisions/notifications. There is an expiring conversation owner, explicit takeover, local playback cancellation, some generation checks, and played/interrupted acknowledgements.
- Recorded speech through a controlled desktop-browser MediaStream successfully answered an ordinary question and a real Codex question card; real BB agents confirmed the chosen color. A foreground-process cancellation sample and a spawn-restart reconciliation sample also exist.
- All **35 existing tests passed again during this audit**. Eleven exercise copied Qwen primitives; those tests do not establish the behavior of every runtime path. In particular, the vendored notification queue is tested but is not imported by the runtime director.

These facts establish useful integration progress. They do not establish a reliable driving assistant, measured acoustic playback, broad useful-task completion, or full recovery correctness.

## Current failed user attempt and observability

Chris reported using an Android phone connected to car Bluetooth: Jarvis displayed recognized text, then “Speaking,” produced no audible response, and failed. YouTube playback through the car and Gboard dictation work. That establishes functioning device audio paths; this incident must not be dismissed as unconfigured car audio. The exact mobile browser/version remains unrecorded.

Observed during this audit:

- The assistant journal contains recent transcriptions and generated replies, with pending, interrupted and played delivery states.
- The staging BB service and semantic turn detector were active. The BB log contains `assistant failed: fetch failed` around **20:12:46 UTC**.
- A direct read-only request to the host relay on loopback port 4842 failed with **ECONNREFUSED**. Its previously recorded agent execution handle was no longer available.
- The deployment record states that this relay was an agent execution process, not boot-persistent service supervision. The required backend is unavailable. Its exact exit reason is not retained; we cannot prove which process lifecycle event killed it.
- `VoiceConversation.speak()` sets `speaking: true` **before** requesting synthesized audio. Thus “Speaking” does not establish successful synthesis, audio receipt, or device playback.
- “Played” means scheduled browser sources ended. There is no captured output/device evidence; this does not prove sound reached the Bluetooth speakers. The absent relay explains subsequent connection failure, but does not by itself explain the earlier inaudible interval.

**Thorough analytics and diagnostic logging are not implemented.** Available records are operational journals, generic BB server errors, startup output, and one-off test evidence. Browser exceptions remain in local UI state. There is no durable per-turn trace across capture, endpointing, STT, inference, TTS, proxy delivery and playback. There are no latency distributions, listening-hour false-activation measurements, audio-route records, or usable crash report tied to the failed utterance.

Required diagnostics: correlated turn/request/generation IDs; stage start/end/failure and duration; HTTP status and transport termination; PCM byte/sample counts; AudioContext state and playback start/end/abort; capture loss, ownership and lease transitions; browser/OS/version and available output-route diagnostics; bounded redacted client-error reporting; and an exportable support bundle. Record metadata rather than raw audio or secrets by default. Distinguish preparing audio, receiving audio, playback scheduled, playback running, interrupted and failed; do not equate a UI label with audible output.

Evidence: [voice controller](../../plugins/jarvis/lib/conversation.ts), especially `speak`, `fail`, and `poll`; [relay HTTP](../../plugins/jarvis/relay/http.mjs); [relay lifecycle](../../plugins/jarvis/relay/main.mjs). Private user utterances are deliberately not copied into this report.

## Functional and architectural gaps

| Area | Implemented | Remaining gap / impact |
| --- | --- | --- |
| Natural delegation | Intent classification plus a narrow “start a new task to …” pattern | Ordinary requests such as “find out why my backups failed” do not have a general execution route. Every new task uses one configured project, environment and provider. No session reuse/adoption, general steering, skill/account discovery or multi-task planning. |
| Task visibility | Backend task/session/inspect RPCs | Current UI only calls the assistant RPC. No staff/task list, real thread links, selected-session picker, task cards, descendant grouping or app-wide active orb. Navigating away unmounts and stops the conversation. |
| Task lifecycle | Dispatch/cancellation receipts; live BB snapshots | No full queued/working/needs-user/completed/failed/unknown lifecycle with independent result evidence. `verification` stays `unverified`; no result-verification workflow. Task capacity counts all retained tasks rather than a managed active-work queue. |
| Observation scope | Visible root listing, recent snapshot summaries | Detailed reading is restricted to the last 72 hours plus selected active/error statuses; general conversation uses 20 roots and briefings 40. Older outstanding work can be omitted. Owned descendants are only enumerated for stop, not continuously observed under tasks. |
| Ordinary questions | Last-line question-mark detection on idle output | Misses non-final, multi-line or implicit requests and can mistake quoted/rhetorical questions for outstanding input. Uses event sequence and excerpt hash rather than a precise source-message record. |
| Exact answers | Current interaction/hash validation and delivery-before-mutation receipt | No automatic reconciliation of uncertain answers or systematic verification that the worker resumed. Full pre-existing-session and competing-client acceptance is not established. Unsupported plugin forms/multi-select remain unanswerable by voice. |
| Approvals | Exact allow-once/deny paths and validation | Real spoken allow/deny matrix, ambiguous speech, actual domain permissions and competing-client coverage remain unverified. Bare “yes” is deliberately unsupported, despite the plan describing a focused yes. |
| Cancellation | Root/descendant stop, queued-message removal, finite idle checks | No named-session stop/adoption scope, complete UI outcomes or ongoing late-descendant fence. Stop waits for coordinator task reads/serialization. Global dispatch inhibition is absent. One process sample is not general cancellation acceptance. |
| Domain authority | Narrow relay methods; task ownership; current-question authorization | No integration capability/authority matrix for email/calendar, spending, infrastructure, code or physical security. Inherited BB permissions are not evidence that these domain boundaries have been validated. |
| Notification filtering | Changed snapshots, batching, quiet flag, durable delivery entries | Routine progress can be spoken after a throttle; no source mute/dismiss, priority/expiry policy, durable event cursors, explicit exclusion of auxiliary work, or stale-notification supersession. |
| Watching/recovery | Event subscription marks snapshots dirty; active browser polls | No independent durable event processor. Quiet mode returns before refreshing; it does not continuously accumulate a complete queue. Closed/reloaded clients recover snapshots, not a persisted event history. Passive clients do not load live state until they start interacting. |
| Speech latency | PCM streaming and sentence splitting | The model SSE response is fully accumulated before TTS starts. General conversation usually performs intent inference and response inference serially. No end-to-first-audio p50/p95 suite; the ~800 ms / <2 s targets are not established. |
| Natural turn-taking | Semantic detector, pre-roll, generation invalidation | After endpointing, prior frames are cleared; a resumed utterance is not merged into a continuing thought. Real microphone calibration, quiet onset, short replies, corrections, background speech and speaker echo are not validated. The short “Use blue” replay already failed transcription. |
| Audio reliability | Capture permission, output context, error text, basic echo substring check | No Android/Bluetooth acceptance; no robust AudioContext suspension/route handling. Output may be claimed before any audio exists. Playback/source completion is not acoustic-output verification. |
| Microphone-off output | Architectural path exists | No complete real completion + mic-off + quiet + autoplay-blocked/busy-service acceptance. No explicit queued-audio recovery UI; failed speech becomes interrupted and loses automatic retry eligibility. |
| Device ownership | Lease and explicit takeover | No real desktop/phone handoff proof. Browser heartbeat notices takeover later; already-buffered old-device audio is not synchronously invalidated by a server push. Ack lacks delivery generation/claim validation. |
| Voice service lifecycle | Fresh 120-second leases; host-only admin-key access | No production least-privilege issuer, renewal/recovery manager or persisted release-cleanup state. Post-header stream/release failures can be reduced to normal response end. Public Pocket path remains unproven after earlier 502s. |
| Configuration/deployment | Staging-specific host relay + VM detector | Ordinary local plugin mode cannot run the assistant without the relay. No supported unattended installation/startup/restart path. Model is operator-configured; voice/persona are hardcoded. This is not yet portable plugin configuration. |
| Personal memory | Recent conversation history only | No facts/preferences/people/commitments/decisions store, provenance, explicit-vs-inferred ranking, relevant retrieval, correction, deletion/suppression, export or memory-off controls. |
| Past-decision recall | Last 12 conversational items and recent thread excerpts | No bounded history search or sourced decision/reasoning/later-correction retrieval. Recent chat history is not the planned memory or recall system. |
| External events/schedules | Nothing specific | No enabled source/review records, scheduler integration, event/run correlation, timezone policy, due execution, catch-up, deduplication, edit/pause/disable or revocation cleanup. |
| Durable storage | Version-one JSON journals; atomic filesystem writes | No schema migration suite, complete audit retention policy, bounded decision/task lifecycle or recovery implementation for all side effects. Conversation is stored in a private relay journal, not a dedicated BB talker transcript. |

Source anchors: [coordinator](../../plugins/jarvis/coordinator.mjs), [director](../../plugins/jarvis/relay/director.mjs), [UI](../../plugins/jarvis/app.tsx), [model adapter](../../plugins/jarvis/relay/model.mjs), [question adapter](../../plugins/jarvis/relay/questions.mjs), [speech adapter](../../plugins/jarvis/relay/voice.mjs), [plugin integration](../../plugins/jarvis/server.ts).

## Reproduced correctness gaps

The audit ran isolated contract probes, with no real-session mutations. Reproduction: `node specs/research/evidence/jarvis-gap-probes.mjs`. [Source](evidence/jarvis-gap-probes.mjs), [observed output](evidence/jarvis-gap-probes.jsonl).

1. **Typed fallback depends on audio.** Present a question and submit a typed answer without a played ack: zero messages are sent; the director insists on reading the question first. When audio is broken, the promised equivalent typed question/approval path is blocked. Chat text still works, which is not sufficient fallback.
2. **An interruption does not fence an in-flight answer.** Hold the SDK read during answer validation, issue interrupt, then complete the read: one answer is still sent. The mutation path checks ownership, but not the conversational generation after its awaits. Existing late-model-response tests do not cover this path.

Additional source-confirmed gaps requiring focused regression tests:

- Conversational delegation creates a fresh random operation ID for each call. The coordinator's duplicate-ID guarantee does not deduplicate a retry of the original conversational request.
- `next` returns an unheard persisted update before refreshing the source; an obsolete question can be replayed even though subsequent answer validation prevents sending to the stale target.
- Failed playback and deliberate interruption share one delivery status. `next` retries only pending updates, so a transient voice outage can remove an update from automatic delivery without a visible recovery queue.
- `repeat` emits an ordinary reply without the question's presentation binding. Replaying an interrupted question this way cannot satisfy the exact-question playback requirement.
- Post-header relay audio errors end the stream without a completion/error envelope, leaving the browser unable to distinguish some truncated responses from normal EOF.

## Acceptance still missing

The required 30-turn suite on each primary desktop and phone configuration has not run. Neither latency distributions nor a listening-hour noise/false-command denominator exist. No acoustic/Bluetooth output capture establishes the audio Chris actually hears. UI width checks are not phone acceptance.

The parent real-task scorecard has no frozen direct-BB baseline, thresholds or scored suite. There is no independently verified Jarvis journey for the planned real home-lab diagnosis, research deliverable, calendar/email preparation, or concurrent two-worker management. Color-answer transport checks are useful tests, not substitutes for those outcomes.

Real approval allow/deny and stale/concurrent cases, disconnected worker stop, multi-device takeover, busy/expired Pocket, microphone-off announcements, restart without obsolete speech, domain out-of-scope denial, retention inspection and migration recovery remain incomplete. The current user failure is adverse acceptance evidence, not merely a missing test.

Closed-browser listening, locked-phone playback, room satellites, surveillance and direct calendar/email implementations were explicitly excluded or deferred. They should not be counted as unfinished initial-release requirements. Android foreground use with car audio is within the intended experience and remains unresolved.

## Recommended order to finish

1. **Restore a diagnosable, supervised voice service.** Establish why the relay exited, give it an appropriate supervised lifecycle, persist bounded correlated client/server traces, reproduce the Android/Bluetooth failure, and verify actual audible output. Correct misleading playback state and make typed control independent of successful audio.
2. **Close control correctness.** Fence every mutation after asynchronous work, carry originating request IDs through conversational delegation, reconcile uncertain answers, validate playback claims/generations, and complete real approval/stop/handoff tests.
3. **Complete A's staff behavior.** Natural delegation, target/project/provider selection, existing-thread steering within authorization, visible tasks/source links, descendant observation, result evidence and domain capability validation.
4. **Complete B's conversation and attention.** Continuation merging, short-answer/echo calibration, first-sentence model-to-speech streaming, source-aware notification suppression/recovery, mic-off playback and service-failure handling. Run the desktop and Android suites against declared targets.
5. **Complete C.** Sourced memory and past-decision recall, correction/deletion/export/suppression, relevant retrieval and the real-task scorecard. This is a substantial feature milestone, not UI polish.
6. **Complete D.** One explicitly enabled real external event and one real scheduled review, with their recovery/disable contracts and outcome evidence.
7. **Promote only an accepted candidate.** Preserve evidence/rollback outside the VM, obtain approval of the actual candidate, verify production and perform the mandated staging cleanup.

The supported model-only talker adaptation and restricted staging relay were documented decisions. They do not waive transcript persistence, latency, general plugin operation or the public Pocket reachability requirement. The latter still needs a verified route or an explicit plan revision; local endpoint success cannot silently close it.
