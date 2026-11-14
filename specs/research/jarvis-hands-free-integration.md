# Hands-free implementation correction — 2026-11-14

The first staging candidate exposed a typed coordination test panel. It did not satisfy the approved driving use case. The replacement acceptance path is: tap Start Jarvis once, receive a cross-thread spoken briefing, keep listening for conversational directions, hear meaningful changes and exact agent questions, answer the focused question without navigating to its thread, and interrupt speech or delegated work by voice.

## Source-backed bootstrap

The earlier source reviews remain the basis. This revision incorporates BB Jarvis's acoustic VAD and speech normalization, Qwen's generation boundaries, and Pipecat's actual semantic turn classifier rather than treating an RMS silence timer as natural turn completion. Pipecat's model and feature extraction are pinned to `1bc2e37b15566cd34bb6941a335ce09c3bbbab8c`. The [model card](https://huggingface.co/pipecat-ai/smart-turn-v3) and [upstream license](https://github.com/pipecat-ai/smart-turn/blob/main/LICENSE) specify BSD-2-Clause. The bundled feature extractor retains its separate Apache-derived notices.

The candidate uses local 16 kHz acoustic onset gating, then Smart Turn v3.2 CPU inference in the disposable VM. Finished utterances go through the real BB transcription API. Spoken output uses the registered Pocket/Alfred service with a newly issued short-lived exclusive lease per utterance. Microphone audio remains in memory; only conversation text and state are persisted.

## Integration findings

- A real cold BB agent thread took about 4.3 seconds to produce its first text delta in one observed sample. A tool-free call through BB's existing account-pool Responses route completed a short reply in about 1.9 seconds. The conversational layer therefore uses that existing host model connection with no tools. Durable task execution, questions, permissions, and cancellation remain BB operations. This is an explicit adaptation of the earlier BB-thread talker preference, not a new worker runtime.
- The public registered Alfred endpoint returned 502 during testing. The same registered service's local host endpoint was ready. The approved restricted adapter reaches that local endpoint and streams audio through the staging tunnel. Its administrator key is read only on the owning Mac; neither it nor the inherited model credential is copied to the VM.
- BB `auth: local` HTTP mutations require JSON. Binary microphone requests returned 415 during browser testing. The corrected browser transport wraps bounded audio as base64 JSON; the plugin decodes it before calling the real services. Speech responses remain streamed PCM.
- Real Alfred synthesized the test phrase “Jarvis, what needs me?” in 388 ms in one sample. BB transcribed that generated recording correctly in 1,168 ms. Smart Turn classified its completed form with probability 0.97194. These are integration samples, not percentile latency or vehicle-microphone claims.
- The real briefing inspected 20 recently active/attention-needed roots out of 163 visible roots in one snapshot, with complete read coverage. Briefings label agent reports as reports, not independently verified success.

## Authority and delivery

One device holds a renewable conversation lease. Explicit takeover aborts the old device's audio and invalidates its commands. Current question payload/hash or ordinary-message sequence is revalidated immediately before answering. The delivery intent is persisted before BB mutation; uncertain outcomes are not replayed. Staging writes remain test-owned unless Chris separately authorizes directed answers to watched threads.

Changed-thread notifications and unheard update utterances persist across relay restart. The browser marks an utterance played only after all scheduled audio sources finish; interruption is recorded separately. Quiet mode retains updates. Generation checks discard late model and transcription output.

## Remaining acceptance evidence

Browser replay uses a generated test recording through Chromium's capture interface. It must be described as a transport/interaction test, never as a physical microphone, iPhone background-audio, Bluetooth, or in-car test. Full hands-free staging acceptance requires the watched-question → spoken answer → real agent continuation path and barge-in testing. Do not equate unit tests or a visible Start button with completion.

## Verified browser-to-worker paths

On 2026-11-14, isolated Chrome for Testing 155 consumed recorded Pocket speech through a browser MediaStream and exercised the actual candidate's AudioWorklet, semantic detector, BB transcription, model routing, streamed Alfred playback, and BB mutation adapter:

1. Start Jarvis began a briefing of real visible BB roots.
2. Speaking over that briefing interrupted playback; “Jarvis, what needs me?” was transcribed correctly and caused an exact agent question to be read.
3. The browser acknowledged the question only after audio playback finished.
4. “Please use the color blue for the acceptance test” reached task-owned thread `thr_iu4jajwgu3`; its real agent replied “Voice answer received: blue”.
5. The same voice loop answered a real Codex `async-question` card in `thr_7rgcfua6ug`; BB's plugin response adapter resumed that agent, which replied “Voice form answer received: Blue”.
6. Both passing paths recorded no browser page errors or displayed alerts. Artifacts are outside the VM at `thread-storage/thr_qpanimf2w7/jarvis-staging/controlled-voice-evidence.json` and `voice-form-evidence.json`.

A deliberately short generated “Use blue” sample was mistranscribed; the conversational layer asked for clarification and no answer was dispatched. A fuller utterance succeeded. This is an actual remaining speech-quality concern for device acceptance, not evidence that all short answers work. Chromium file-capture testing also produced unreliable capture; the passing tests use explicitly controlled MediaStream replay, not the physical microphone or an emulated user device.

The Codex adapter was checked against the installed BB 0.49 public renderer: `provider-codex/async-question` maps question indices to `question-N`, option indices to `option-N`, and submits `{answers}` through `threads.interactions.respond`. Native questions use `interactions.resolve`. Other plugin identities cannot borrow this adapter. Multi-question single-select forms collect one spoken answer at a time and submit only once the complete form is answered.

Chris subsequently explicitly authorized directed answers to exact current questions in existing watched threads. The staging configuration now enables that narrow reply capability. General redirection, stopping unrelated work, and arbitrary SDK forwarding remain outside this grant.
