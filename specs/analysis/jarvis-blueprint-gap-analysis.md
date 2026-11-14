# Jarvis blueprint gap analysis

Date: 2026-11-14. Scope: specification coverage, not implementation correctness. No plugin has been implemented or verified by this assessment.

> Revision note (2026-11-14): This assessment describes the specs before the requested revisions. G1–G7 are now captured in the vision and plans; see the [delivery plan’s gap traceability](../plans/0001-jarvis.md#blueprint-gap-traceability). The findings below remain historical evidence, not a claim that the revised specs still omit these requirements. Implementation and end-to-end verification remain pending.

## Verdict

The vision and plans specify a credible BB chief of staff, with particularly strong voice approval, cancellation, task recovery and memory controls. They do not yet specify the full blueprint experience. Natural turn detection and real-life outcome measurement need more detail before implementation; external awareness and scheduled initiative have no concrete delivery plan. The vision's statement that it covers all seven capabilities is broader than the planned behavior.

Keep the agreed BB-centric design. Close the specification gaps through BB agents, sessions and supported event/scheduling capabilities rather than adding another orchestration platform. Explicit microphone activation, cloud-capable quality-first models and Alfred are user choices, not defects to reverse.

## Evidence and interpretation

Read the local `/Users/csells/code/csells/awesome-jarvis/blueprint.md` in full and all four specification files. The blueprint has no working-tree changes and no difference between local HEAD `635d026d07e58fa1ef4bf2cfd51b4bc28f97d340` and the previously fetched origin/main `0378a6801dda9a3345ea7d4a53614f3cd410763f`. This analysis did not refetch upstream or research the projects named in the blueprint. Its source is the local blueprint requested by Chris, matching the [pinned blueprint](https://github.com/csells/awesome-jarvis/blob/0378a6801dda9a3345ea7d4a53614f3cd410763f/blueprint.md) cited in the vision.

Compared documents:

- [Vision](../vision/jarvis.md).
- [0001: Delivery plan](../plans/0001-jarvis.md).
- [0002: Conversation and speech](../plans/0002-jarvis-conversation-and-speech.md).
- [0003: Coordination and memory](../plans/0003-jarvis-coordination-and-memory.md).

“Covered” below means an explicit requirement and meaningful planned verification, not a delivered capability. “Partial” means important behavior or acceptance is unspecified. “Deferred” means intentionally outside the initial release; it can still leave the full vision incomplete. The blueprint's three starter builds are alternatives, not a requirement to install every named product.

## Coverage of the seven capabilities

| Blueprint capability | Specification evidence | Assessment |
| --- | --- | --- |
| 1. Natural listening with rare interruption and roughly 800 ms response | Vision: Settled product choices; 0002: Audio behavior, Acceptance and measurement | **Partial.** Open-session activation is agreed; latency, barge-in and echo cancellation are specified. VAD/end-of-turn behavior and its tests are missing. Wake words and closed-session listening are deferred. |
| 2. Personal memory separate from transcript | Vision: Authority, attention, and memory; 0003: Durable records, Personal memory | **Substantially covered.** Provenance, corrections, deletion, export and scoped retrieval are specified. Recall of past conversations beyond extracted facts has no explicit acceptance journey. |
| 3. Act on home, calendar, email, browser and computer with explicit authority | Vision: Purpose and Example journeys; 0003: Delegation and recovery, Approval and cancellation contract | **Partial.** Routing through BB workers is correct for the agreed design. Domain capability discovery, action-policy examples and successful real-life workflows are underspecified. |
| 4. Notice context when the user is not talking | 0003: Selective awareness; vision: Quality and limits | **Partial/deferred.** BB session events are covered. Selected BB session context is mentioned; its capture contract is absent. External events, presence and screen/camera inputs are deferred. |
| 5. Speak first through heartbeats, schedules and events | 0003: Selective awareness; 0001: Release slices | **Partial/deferred.** Consequential session events and quiet mode are covered. No scheduled review, commitment follow-up or external-event workflow is planned concretely. |
| 6. Show assistant state and every running task | 0002: Presentation and Audio behavior; 0003: Task records and Selective awareness | **Mostly covered.** Assistant states and owned workers have clear representations. Coverage of watched sessions not created by Jarvis is ambiguous in the task dashboard. |
| 7. Delegate, supervise, relay questions and stop workers | 0003: Delegation and recovery, Approval and cancellation contract; 0002: Acceptance | **Substantially covered.** Asynchronous control, durable state, exact interactions and real process cancellation are specified. Ordinary questions outside BB's structured interaction mechanism need a defined route. |

## Prioritized findings

Priority 1 means resolve before implementing the affected first-release behavior. Priority 2 means close before claiming the initial or full vision complete, with scope stated below. These are recommendations, not changes already made to the plans.

### G1 — Natural turn-taking is assumed rather than specified — Priority 1

**Evidence:** The blueprint's loop explicitly includes VAD plus turn detection. Plan 0002 describes “hearing,” transcription and barge-in, and measures end-of-speech detection, but never specifies how speech is segmented or when the user has finished.

**Consequence:** An implementation could meet every listed state/UI requirement while cutting off a thoughtful pause, waiting through long silence, losing the first word, or treating background conversation as a command. Removing the wake word from initial scope does not remove this requirement after Start.

**Recommended addition to 0002:** Specify continuous listening after activation, speech onset/pre-roll, end-of-turn detection, maximum utterance bounds, noise/non-speech rejection, and how a resumed utterance cancels a premature reply. Select the algorithm through measured quality rather than prematurely mandating a library. Separate acoustic silence from conversational completion.

**Closure evidence:** Exercise short answers, pauses mid-sentence, corrections, quiet speech, background speech, echo and repeated conversational turns through the actual microphone. Report clipped turns, premature replies, missed turns and unintended activations alongside latency. Wake-word false accepts are inapplicable until a wake word exists; unintended turn/command rates are applicable now.

### G2 — Domain authority is not yet concrete enough to validate — Priority 1

**Evidence:** The blueprint calls for explicit action authority enforced in the tool layer, with examples spanning email, spending, code and locks. Plan 0003 carefully validates coordinator actions and exact pending interactions, but delegates downstream authority to existing BB/provider permissions without a representative action-policy matrix.

**Consequence:** Correct approval routing does not establish that a worker's broad shell/browser tool will request approval for the consequential action Chris cares about. Conversely, an implementation might ask repeatedly for actions already authorized. The plans acknowledge enforcement limitations, but do not define which real-life paths must be demonstrated before claiming authority is enforced.

**Recommended addition to 0003:** Map representative actions to the source of authority and actual enforcing component: read versus send email, research versus purchase, inspect versus modify infrastructure, prepare versus push/promote code, inspect versus change physical security. Preserve existing user instructions and explicit authorization; do not invent a universal ask-every-time rule. For each path identify whether enforcement is real, prompt-only, or unsupported, and how Jarvis presents that limitation.

**Closure evidence:** Trace an authorized and an unauthorized path through an actual selected worker/tool integration. Confirm neither another agent's text nor broad tool access bypasses the required decision, and that already-authorized work proceeds without a redundant approval. Use safe real operations or actual denied requests; do not perform dangerous side effects just to test the boundary.

### G3 — Measurements emphasize the voice pipeline over useful outcomes — Priority 1

**Evidence:** The blueprint explicitly asks for how often workers need the user and success on household tasks, as well as latency and wake accuracy. Plan 0002 has detailed latency measurements; 0003 has control-path scenarios. Neither defines intervention rate, end-task success rate, or a representative real-life task suite.

**Consequence:** The candidate could pass by coordinating two generic workers and speaking quickly while failing to manage a real household task. An event labeled complete is not an independently verified outcome.

**Recommended addition to 0001 and 0003:** Define a small set of real BB-agent journeys spanning lab diagnosis, research/browser work, calendar or email when available, and concurrent task management. For each, specify the desired outcome, evidence, allowed side effects and required integrations. Mark unavailable integrations unverified rather than substituting a made-up service.

Track attempted/completed/verified/failed tasks, questions requiring Chris, mandatory approvals separately from avoidable clarification, erroneous interruptions, and time to resolve a blocker. Include the sample counts and denominator; do not optimize away necessary approvals. Set initial acceptance thresholds from a named baseline before claiming a result.

**Closure evidence:** A report of actual outcomes and interventions on the task suite, in addition to the existing 30-turn audio measurements. Add end-to-end spoken-stop-to-worker-termination timing; the existing 250 ms playback cutoff target does not measure work cancellation.

### G4 — The full-vision claim outruns awareness and proactivity delivery — Priority 2, full vision

**Evidence:** Vision Experience says the complete vision covers all seven blueprint capabilities. Its Quality and limits section defers external context and scheduled checks; 0001's Later slice and 0003's Selective awareness leave them without a concrete milestone or acceptance journey.

**Consequence:** “Notices things” and “speaks first” largely collapse into reporting existing BB session activity. Remembering a commitment does not mean noticing its deadline. This is a valid initial product but an incomplete account of the broader blueprint.

**Recommended addition:** Qualify the initial coverage claim and add a later, explicit milestone for one opted-in external event and one scheduled commitment/checklist review through BB agents. Reuse BB scheduling/skills where supported. Define deduplication, missed-run recovery, quiet-mode handling, expiration and disabling. A due reminder does not itself authorize a consequential action.

**Closure evidence:** With no fresh user utterance, a real enabled event or due schedule starts the intended BB work and produces a relevant, nonduplicate update. Keep camera, presence and ambient screen capture as explicit optional deferrals; the blueprint does not require adopting all sensors at once.

### G5 — Voice availability is coupled too tightly to microphone ownership — Priority 2, initial voice release

**Evidence:** The vision says watching does not require an open microphone and distinguishes quiet mode from mute. Plan 0002 releases the Pocket lease on Stop listening and describes playback ownership as an active audio session. It does not say how an unsolicited update is spoken when watching remains enabled but the microphone is off.

**Consequence:** Two reasonable implementations differ: one can speak relevant updates in a passive listening mode; another only shows them visually until the microphone is restarted. The former needs supported browser playback permission and speech-resource acquisition; the latter narrows the vision's speak-first behavior.

**Recommended addition to 0002:** Define microphone capture, permission to play audio, proactive announcement preference and Pocket reservation as separate states. After a user gesture enables playback, permit microphone-off announcements when configured; otherwise visibly queue them. Acquire shared speech capacity through the supported lease path and handle another owner's reservation honestly. No requirement for closed-tab or locked-phone playback follows from this.

**Closure evidence:** A real worker completes while microphone capture is off, watching is on, and quiet mode is off. Verify the specified spoken/queued outcome without silently reacquiring the microphone, then verify quiet mode suppresses the announcement.

### G6 — Existing staff coverage has two unspecified edges — Priority 2, initial coordination release

**Evidence:** The blueprint asks for every running task and relayed worker questions. The vision watches all visible top-level sessions. Plan 0003's task ledger is based on Jarvis requests, while its approval/question mechanism centers on structured BB interactions. It does not explicitly cover displaying pre-existing watched sessions or routing a question that appears as an ordinary assistant message.

**Consequence:** A session can be watched yet absent from the dashboard, or finish its turn with a real question that never becomes a pending-decision card. An idle event must not automatically classify that as completed work.

**Recommended addition to 0003:** Define separate owned-task and watched-session views, with clear control authority. Route ordinary worker questions by their source message and current conversational context; use ordinary BB messaging for the answer rather than fabricating an approval interaction. Detect possible unanswered questions conservatively and show uncertainty when structured state is unavailable.

**Closure evidence:** A session created outside Jarvis appears with accurate state and a link, remains untouched unless targeted, asks an ordinary textual question, receives Chris's relayed answer, and resumes. An owned descendant remains visible under its parent without duplicate announcements.

### G7 — Personal recall and persona remain thinner than the rest of the experience — Priority 2, initial vision completion

**Evidence:** The blueprint calls for remembering past conversations and a persona. The plans specify sourced facts/preferences and short speech, but no concrete episodic recall journey or behavioral persona beyond being a personal assistant with Alfred's voice.

**Consequence:** The assistant can remember a preference but fail “Why did we decide that last time?” It can also use the desired voice while sounding like a generic status bot. A voice selection is not a conversational character.

**Recommended additions:** Add a source-grounded past-decision recall journey to 0003, using relevant BB history without wholesale ingestion. Define a short persona contract in the vision: tone, directness, brevity, when to give a recommendation, how to disagree and acknowledge uncertainty, and how to avoid narrating routine implementation details. These can be stated as editable defaults using the preferences already supplied, without extending the interview unnecessarily.

**Closure evidence:** Jarvis explains a prior decision with the correct source, distinguishes changed preferences, and admits missing history. Review representative status, blocker, error and completion dialogue for consistent style. Do not treat subjective persona quality as a substitute for functional acceptance.

## Deliberate departures and already-recorded risks

These should not inflate the count of missing requirements:

| Item | Classification and disposition |
| --- | --- |
| Always listening with BB closed, locked-phone use, wake words | Agreed open-session scope plus documented deferrals. Do not reopen the choice merely to match the blueprint literally. G1 applies within the chosen active session. |
| Fully local/offline operation | Explicitly not an initial constraint; cloud quality is the agreed priority. Pocket's local speech can coexist with a cloud talker. |
| Direct MCP integrations, ACP harness, Home Assistant deployment, particular memory libraries | Starter-build choices. BB agents/providers/skills can supply equivalent roles; no need to duplicate them in the plugin or adopt every named library. |
| Ambient cameras, presence sensors, room satellites, wearable displays | Documented initial exclusions. G4 asks for honest full-vision scope and a useful event/schedule path, not compulsory surveillance hardware. |
| Alfred versus the blueprint's preference for an original voice | Intentional user-directed selection. Existing service documentation describes a reference-conditioned profile; this is a literal departure from the blueprint's voice-design advice, not an unknown gap. Keep private profiles out of plugin distribution as already specified. |
| Talker responsiveness through a BB session | Explicit feasibility gate in 0001. No evidence yet that the model/session path meets 800 ms. Investigate before committing the voice architecture; do not count a planned target as delivered. |
| Pocket public reachability and unattended lease issuance | Already called out in 0001/0002. Local WAV verification proves neither remote operation nor unattended renewal/reacquisition. This assessment did not retest service health. |
| Stable-safe access to real BB sessions from disposable staging | Explicit integration gate in 0001; a separate empty BB instance is not a sufficient test. Not a newly discovered omission. |
| Stop scope limited to Jarvis-owned/adopted work | Documented implementation default protecting unrelated sessions. Named cancellation can target others when requested. The plan already requires real termination evidence and acknowledges completed effects cannot be undone. |

## Recommended specification revision order

1. Update 0002 with G1 and G5 before building the microphone/session controller.
2. Update 0003 with G2 and G6 before implementing delegation and approval routing.
3. Add G3's real-task acceptance scorecard to 0001 and the relevant detailed plans before defining release completion.
4. Correct the full-coverage wording and add G4's later milestone with explicit acceptance. Preserve the agreed initial scope.
5. Add G7's recall journey and persona defaults before calling Slice C the complete initial experience.

No new product interview is required to make most of these specifications concrete. Reopen a user decision only if a proposed change expands approved observation/action scope or resolves a genuinely consequential tradeoff. This analysis leaves the vision and plans unchanged so the findings remain distinguishable from accepted revisions.
