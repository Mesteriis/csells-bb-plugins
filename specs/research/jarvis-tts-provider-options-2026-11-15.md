# Replacing Pocket TTS for clear, brisk Jarvis speech

Research date: 2026-11-15. Scope: provider selection and integration design; no provider switch, account creation, paid synthesis, or deployment performed. Inspected Jarvis at `f23c3268c05d9d622e2ac3f2a5f6d0fb29e7960f`, official provider documentation, and published LiveKit Node plugin packages at version 1.10.0.

Subsequent authorized implementation: [integration and credential-gate report](jarvis-tts-integration-2026-11-15.md). The research below records the selection rationale; hosted synthesis remains unverified pending API keys.

## Finding and recommendation

Chris reports background fuzz remains and explicitly rejects normal-speed playback as too slow. The earlier speed reduction did not solve the problem. The requirement is clear speech at a brisk, adjustable pace, with repeated interruptions working throughout a conversation.

Recommend comparing **Cartesia Sonic 3.6 first, Inworld Realtime TTS-2 second**, using stock voices through our existing LiveKit browser path. Both have official streaming Node plugins and provider-side pace controls. Keep ElevenLabs Flash v2.5 as a third candidate and the existing local Kokoro service as an inexpensive baseline. This ranking is an engineering-fit recommendation, **not a measured listening-quality ranking**: none of these replacements has been auditioned in this Jarvis implementation during this research.

A provider replacement does not require replacing LiveKit, rewriting the BB plugin in Python, or adopting a provider's full agent platform. The direct provider plugins use their own API credentials; LiveKit Inference is a separate managed option. [LiveKit provider overview](https://docs.livekit.io/agents/models/tts/)

## Shortlist

| Candidate | Relevant capability | Pace and caveats | Cost snapshot, USD |
| --- | --- | --- | --- |
| Cartesia Sonic 3.6 | Official Node streaming plugin; model snapshots; stock voices recommended for agents | Guidance range 0.6–1.5, not an exact duration multiplier. Professional voice clones do not support request-time pace changes. | Pro $5/month includes 100,000 credits; pricing page estimates about 133 TTS minutes. |
| Inworld Realtime TTS-2 | Official Node streaming plugin; delivery steering and stable/balanced modes | Speaking rate 0.5–1.5. Start with TTS-2 for quality; compare Flash if synthesis latency matters. | On demand: TTS-2 $25/million characters; Flash $15/million. |
| ElevenLabs Flash v2.5 | Official Node streaming plugin; configurable voices and stability | Numeric speed 0.7–1.2. Newer expressive models have different speed support; do not assume all models honor it. | Starter $6/month, 30,000 credits; Creator $22/month, 121,000 credits. Flash API use consumes 0.5–1 credit/character depending on plan. |
| Local Kokoro | Already exposed by our shared voice gateway; open-weight local alternative | Existing service supports speed; audition stock voices rather than carrying over Alfred's reference voice. | No new hosted TTS bill; existing compute and operation still cost money. |

Cartesia details: [model and dated snapshot](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest), [speed controls and cloning limitation](https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion), [pricing](https://www.cartesia.ai/pricing), [LiveKit integration](https://docs.livekit.io/agents/models/tts/cartesia/). Start an evaluation with a pinned `sonic-3.6-2026-08-27` model and stock voice, for example Daniel or Archie; the model documentation recommends both for agent use. Start pace trials at 1.25 and 1.4, then measure actual words/minute. A professional clone is a poor initial choice given the speed limitation.

Inworld details: [models](https://docs.inworld.ai/tts/tts-models), [speech API rate controls](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-stream), [pricing](https://inworld.ai/pricing), [LiveKit integration](https://docs.livekit.io/agents/models/tts/inworld/). Provider-reported TTS-2/Flash latency is server-side and excludes the network; it is not a prediction of our phone's response time. At 100,000 generated characters, on-demand synthesis costs $2.50 for TTS-2 or $1.50 for Flash, before other components. No subscription is needed to get those published on-demand rates.

ElevenLabs details: [models](https://elevenlabs.io/docs/overview/models), [speed controls](https://elevenlabs.io/docs/eleven-agents/customization/voice/speed-control), [pricing](https://elevenlabs.io/pricing), [LiveKit integration](https://docs.livekit.io/agents/models/tts/elevenlabs/). Its generic help page says all models support speed, but the model-specific agent guide excludes v3, v4 and v4 Turbo. Treat that conflict as unresolved for those models; Flash v2.5 is the conservative numeric-speed choice. ElevenLabs was retired from LiveKit Inference on August 31, 2026, but its direct provider plugin remains supported. A 1.2 setting is not necessarily slower than another provider at 1.25: voices have different natural rates.

Kokoro details: [LiveKit guide](https://docs.livekit.io/agents/models/tts/kokoro/) documents a Python OpenAI-compatible-server example, not a dedicated Node Kokoro plugin. Our existing [shared service contract](https://github.com/csells/awesome-jarvis/blob/main/lab/voice-server/managed/ALFRED.md) says Kokoro remains available independently of Pocket/Alfred. Calling that service from TypeScript does not introduce Python into the BB plugin. Current service health, voice inventory, and acoustic quality were not retested here.

Provider minute estimates assume different speaking rates and character densities. Compare metered characters and actual bills, not headline minutes. These prices exclude BB model/STT usage, infrastructure, and taxes. Hosted TTS sends the spoken response text to that provider; the local baseline avoids that additional external processing.

## OpenAI and wider alternatives

OpenAI has an official Node TTS plugin, but its current first-party documentation marks `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` deprecated, with shutdown on January 6, 2027. The recommended replacement uses the Realtime API and is not accepted by `/v1/audio/speech`. Therefore it is a poor new drop-in investment for this repair despite older LiveKit examples still recommending it. [OpenAI migration notice](https://developers.openai.com/api/docs/guides/text-to-speech), [TypeScript speech API](https://developers.openai.com/api/reference/typescript/resources/audio/subresources/speech/methods/create).

LiveKit lists additional providers, including Deepgram and Rime. They were not evaluated in equivalent depth here. This is a focused shortlist for the existing Node implementation, not an exhaustive market ranking. No independent listening leaderboard or vendor claim establishes that a voice will be clear over this particular car Bluetooth route.

## Source verification and integration work

Read published `package/dist/tts.d.ts` and `package/dist/tts.js` from the npm tarballs linked by these version-specific metadata records:

- [Cartesia 1.10.0](https://registry.npmjs.org/@livekit/agents-plugin-cartesia/1.10.0): `speed`, configurable model, PCM output, streaming enabled.
- [Inworld 1.10.0](https://registry.npmjs.org/@livekit/agents-plugin-inworld/1.10.0): `speakingRate` sent in audio configuration, TTS-2 default, streaming enabled.
- [ElevenLabs 1.10.0](https://registry.npmjs.org/@livekit/agents-plugin-elevenlabs/1.10.0): `voiceSettings.speed`, configurable model, streaming enabled.
- [OpenAI 1.10.0](https://registry.npmjs.org/@livekit/agents-plugin-openai/1.10.0): speed/base URL options, PCM output, SDK capability `streaming: false` (distinct from receiving an HTTP response incrementally).

All declare peers matching our `@livekit/agents` 1.10.0 and RTC ^1.2.2. Cartesia's package validation warns only above 2.0, while its provider documentation caps speed at 1.5; follow the stricter provider contract. Package inspection establishes interface compatibility, not an authenticated working integration.

Current Jarvis overrides `JarvisAgent.ttsNode` and supplies separately generated audio in `speakState`. Both call the restricted host `/speech` route, which hardcodes Pocket/Alfred at 1.0. Merely adding `tts: new cartesia.TTS(...)` to the session would leave those overrides using Pocket. The implementation must route **both ordinary replies and proactive briefings/questions** through the selected provider. See [agent speech paths](../../plugins/jarvis/voice/src/relay.ts) and [host adapter](../../plugins/jarvis/relay/voice.mjs).

Proposed implementation:

1. Configure one official provider TTS instance on the Node session. Delegate ordinary response synthesis to LiveKit's default TTS node and use session speech for proactive text, preserving question focus and speech tracking.
2. Make model, voice and speaking pace explicit. Keep credentials server-side. Give staging its own least-privilege provider credential; do not copy shared secrets or alter the shared voice service.
3. Let LiveKit own playout and cancellation. Feed documented PCM formats at their declared sample rates; do not relabel sample rates to accelerate speech or add a second browser player.
4. Retain existing BB director and real-session authorization. The director currently yields a complete response, so switching to streaming TTS does not make the model response token-streamed. Measure that delay separately.

## Verification needed before declaring the change successful

The earlier desktop sample had no clipping and transcribed correctly. That does not establish freedom from fuzz or acceptable perceived quality. The physical phone's later missed interruption also remains unresolved. [Prior evidence](jarvis-voice-quality-and-interruption-2026-11-15.md)

Use one simple comparison flow in disposable staging, with real providers and existing BB connections:

- Same representative text, similar loudness and measured brisk pace across providers. Include a short answer, a 60–90 second briefing, project names, numbers, and agent questions. Prefer stock voices initially.
- Retain known non-sensitive provider PCM and decoded browser audio for comparison. Measure clipping, gaps, duration, words/minute and transcription omissions. Listen for fuzz and artifacts; a successful transcription is not an acoustic-quality score.
- Exercise microphone off/on, followed by at least three successive spoken interruptions during different replies. Check decoded audio cessation and the relevance of the next answer, not just UI labels. Preserve the existing 250ms interruption target and report misses.
- Separate request-to-first-PCM, first browser playout, model latency, and interruption-to-silence metrics. Record provider/model/voice/pace with each run.
- Compare source and browser recordings to locate introduced noise. The Android/car acoustic route remains a separate device-specific verification boundary; desktop results cannot certify it.

The agent should run all accessible browser/model regressions and present straightforward audio samples alongside results. Success requires both clearer brisk speech and no conversation regressions. A TTS swap alone does not establish that the phone's capture/VAD issue is repaired.
