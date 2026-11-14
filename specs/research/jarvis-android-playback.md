# Android silent playback and focused-answer follow-up

2026-11-14, following candidate `6842929`. Chris reported that the revised candidate still produced text without audible car audio. The screenshot also shows Jarvis declining to relay a response even though the relevant question is focused. Physical-device acceptance **failed**; successful desktop tests do not override that result.

## Evidence and hypothesis

Phone metadata identifies Android, Chrome/157.0.0.0, a running 16 kHz AudioContext, audio receipt, and several browser playback-complete events. For example, one utterance received 632,832 PCM bytes and reported completion after 13.6 seconds. Chris heard nothing. The trace therefore narrows the problem to browser/device playback or routing; it does not establish a particular Bluetooth fault. Later delivery failures also exist. Private metadata is preserved in task storage, without publishing the conversation or recording.

The implementation connected synthesized 24 kHz audio to the same 16 kHz Web Audio context used for microphone capture. The candidate now plays validated PCM as bounded WAV sentences through a reusable native audio element. This changes the output path and exposes media playing/ended/error events and playback position. It waits for each sentence's complete audio before playing; incremental model-to-first-audio latency remains an open requirement.

Chromium documents switching Android output from A2DP to SCO when the Bluetooth microphone activates ([source change](https://chromium.googlesource.com/chromium/src/+/78d0de138346e6edfc8c33bdd22c45b3eec4f3d0)). This supports a routing hypothesis, not a diagnosis of this device. Chrome also requires interaction for audible autoplay and requires handling rejected play promises ([autoplay policy](https://developer.chrome.com/blog/autoplay)). Native media and microphone-off playback must be tested on Chris's device before claiming the silence is fixed.

**Test speaker · microphone off** releases microphone tracks, closes the capture context, and speaks a fixed test phrase through the real voice service. It leaves listening off so the test isolates playback. Start Jarvis resumes hands-free capture. This is a diagnostic control, not a claim that disabling listening fulfills the voice vision. Normal conversation retains continuous microphone capture and interruption handling.

## Answer routing

The intent classifier previously received only a boolean indicating whether a question existed. It could not relate “I see your text, but I absolutely do not hear the audio” to the focused question asking whether audio was audible. It now receives the current question's wording as untrusted data for classification. It preserves the answer verbatim and does not invent a selection. Existing exact-question, ownership, playback, stale-revision and explicit-approval checks remain in force.

## Validation and limits

A regression reproduced zero sends for the contextual answer before the change and now passes. Native-media tests verify WAV sample metadata and bytes, completion only on ended, cancellation, and rejected autoplay. The VM candidate passed typecheck, build and 48 tests. [Browser evidence](evidence/jarvis-native-media.json) passed against real STT, inference and TTS: native media positions advanced by 1.5–3.8 seconds per sentence, source RMS reached 0.108, the microphone-off speaker check completed, blocked autoplay surfaced an error and retry started playback. The reported sentence was relayed to a task-owned real question and the worker confirmed receipt. No page errors or final alerts occurred.

Physical Android/Bluetooth output is still unresolved pending the next device result. PCM energy and advancing browser playback position do not prove acoustic audibility. No promotion occurred. Broader gaps remain tracked in [the gap analysis](jarvis-implementation-gap-analysis.md).

## Device clarification and timing instrumentation

Chris subsequently confirmed that **the earlier response** eventually played through the car several minutes late. He also confirmed that **Test speaker · microphone off** was audible on the native-media candidate. This establishes working car output in that configuration; it does not yet establish timely playback while the microphone is listening. The issue is delayed delivery, not categorical inability to play through the car.

The successful speaker-check trace recorded first audio bytes after approximately 195 ms and an entire three-sentence playback sequence lasting 6.68 seconds. That is browser timing, not a measured acoustic start time. Earlier server synthesis segments completed in approximately 0.2–1.6 seconds; those requests do not explain a minutes-long wait by themselves. The exact location of the old response's delay remains unproven.

The investigation found that relay diagnostic ingestion replaced client event times with upload receipt time. The fix retains `clientAt` separately from server `at`, preserves a monotonic browser clock, and records media play-request-to-playing duration, utterance IDs/age, command duration, page visibility, microphone mute/unmute/release and allowlisted error kinds. Upload batches drain promptly after successful delivery and keep their pending events on failure. Raw errors, conversation content and credentials remain excluded. Device/server clocks may differ; monotonic durations and per-device event ordering are the appropriate comparisons.

A regression failed before the timestamp correction and now passes. The updated disposable VM passed typecheck, build and 49 tests. A controlled metadata request through the actual VM plugin HTTP route and real host relay verified separate device and receipt timestamps; this is instrumentation evidence, not another acoustic playback claim. The next required device result is timely native-media playback with continuous microphone capture enabled.
