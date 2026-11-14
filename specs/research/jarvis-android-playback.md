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
