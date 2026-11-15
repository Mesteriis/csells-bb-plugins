# Echo and interruption: mature conversation implementations

2026-11-14 local date / November15 UTC. Read-only research. Existing pinned source clones were re-opened; current official documentation was checked. No vendor runtime or physical Android/car was exercised in this audit. Implementation recommendation below is an inference from those sources, not a device qualification.

## Conclusion

This is an established signal-processing and conversation-control problem. The correct primary remedy is **acoustic echo cancellation before voice detection**, with a reference to rendered speaker audio. Then use voice detection for prompt interruption, turn detection for deciding when the user finished, and reversible playback pause for residual false starts. Waiting for a final transcript and comparing it to generated text is a fallback heuristic with a latency penalty, not the principal architecture used by the mature stacks examined.

Keeping the current BB transcription service does **not** require waiting for transcription before silencing the agent: speech onset and utterance transcription are separate events. With effective echo-clean input, Pipecat's existing onset strategy can yield immediately. Batch STT still affects reply latency and how quickly an ambiguous interruption can be semantically confirmed.

## Sources inspected and concrete findings

### Pipecat: reuse the audio/turn pipeline, not just its transport

Inspected checkout `1bc2e37b15566cd34bb6941a335ce09c3bbbab8c` under `/tmp/jarvis-mobile-audit/pipecat`.

[`VADUserTurnStartStrategy`](https://github.com/pipecat-ai/pipecat/blob/1bc2e37b15566cd34bb6941a335ce09c3bbbab8c/src/pipecat/turns/user_start/vad_user_turn_start_strategy.py) reports a user turn as soon as it receives `VADUserStartedSpeakingFrame`; no transcript is required. The [strategy composition](https://github.com/pipecat-ai/pipecat/blob/1bc2e37b15566cd34bb6941a335ce09c3bbbab8c/src/pipecat/turns/user_turn_strategies.py#L405) separates turn start from Smart Turn end detection. Thus the current spike's 2.66second delay is an adapter-policy consequence, not a minimum imposed by Pipecat.

Its [output interruption handling](https://github.com/pipecat-ai/pipecat/blob/1bc2e37b15566cd34bb6941a335ce09c3bbbab8c/src/pipecat/transports/base_output.py#L609) clears interruptible queued output. A flush is destructive. Broadcasting `InterruptionFrame` and later resuming the producer is not equivalent to resuming a preserved playback position. That explains why the prior tentative-pause experiment was architecturally incomplete even before judging its user experience.

[`KrispVivaFilter`](https://github.com/pipecat-ai/pipecat/blob/1bc2e37b15566cd34bb6941a335ce09c3bbbab8c/src/pipecat/audio/filters/krisp_viva_filter.py) imports proprietary `krisp_audio`, requires a model file, and accepts an API key. It processes microphone audio as a noise-reduction filter; the interface inspected does not take the rendered-output reference needed for ordinary reference-based AEC. Its optional TTS detection delays voice isolation for an iPhone screening use case; it is not documented as recognizing and subtracting Jarvis's own speaker waveform. Do not mistake this option for an off-the-shelf self-echo solution.

### LiveKit: distinct acoustic cleanup, onset interruption, and reversible pause

Inspected Agents checkout `cbb5770c716c70009969cd7fa88e3c3662222ce9` under `/tmp/jarvis-mobile-audit/agents`.

In [`agent_activity.py`](https://github.com/livekit/agents/blob/cbb5770c716c70009969cd7fa88e3c3662222ce9/livekit-agents/livekit/agents/voice/agent_activity.py#L2493), audio activity can pause current output without destroying its speech handle. False-interruption recovery requires a pausable output and enabled policy. The [resume path](https://github.com/livekit/agents/blob/cbb5770c716c70009969cd7fa88e3c3662222ce9/livekit-agents/livekit/agents/voice/agent_activity.py#L5182) checks handle identity and completion, restores the prior agent state, and resumes preserved output. A pending end-of-turn decision owns the pause: a timeout waits for that decision rather than blindly resuming mid-user-turn. Already interrupted handles cannot be revived. The same file gates activity-driven interruption during AEC warmup and substitutes silence for STT during contaminated startup; this is bounded startup protection, not continuous microphone muting as a duplex solution.

[`AgentSession`](https://github.com/livekit/agents/blob/cbb5770c716c70009969cd7fa88e3c3662222ce9/livekit-agents/livekit/agents/voice/agent_session.py#L539) explicitly exposes AEC warmup configuration and lifecycle. A production-grade conversation framework acknowledges echo convergence and startup conditions instead of assuming the first received frame is clean.

Current [turn tuning documentation](https://docs.livekit.io/agents/logic/turns/tuning/) separates audio preprocessing, interruption detection, and end-of-turn behavior. Minimum-word interruption thresholds require STT; the default documented minimum is zero words. The documented VAD duration default is0.5seconds, so adopting default settings would not establish Jarvis's250ms target. False-interruption recovery defaults to a2second timeout. These are tunable policies, not guarantees of acoustic quality.

Current [adaptive interruption documentation](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/) describes an acoustic model running after VAD that distinguishes deliberate interruptions from backchannels without waiting for transcription. It uses LiveKit Cloud inference and project credentials even when explicitly enabled in self-hosted agents. Unsupported/unavailable inference falls back to VAD. This is a credible supported option for intent discrimination, but it adds an external service and does not replace AEC. It must not be represented as a fully local open-source capability.

The [noise/echo documentation](https://docs.livekit.io/transport/media/noise-cancellation/) distinguishes client WebRTC echo/noise processing, available with any deployment, from enhanced ai-coustics/Krisp models available through LiveKit Cloud realtime transport. Voice isolation emphasizes the primary speaker; background-noise suppression targets non-speech noise. Neither description proves that a filter can distinguish the local user from a loud echo of Alfred in this car. A self-hosted LiveKit migration alone does not supply a different browser AEC implementation.

### Daily: distinguish enhanced noise suppression from echo cancellation

Current [`updateInputSettings()` documentation](https://docs.daily.co/reference/daily-js/instance-methods/update-input-settings) lets callers set microphone constraints separately from the `noise-cancellation` processor. Its current support list names desktop Chrome/Firefox/Safari and mobile iOS Safari, not Android, for that enhanced processor. The docs warn that CPU load can cause degraded calls and processing errors. Therefore “switch to Daily and enable Krisp” is not a researched Android remedy. Daily's normal WebRTC transport can remain useful, but enhanced noise processing is a separate capability with platform limits.

### AIRI: explicitly conditions automatic barge-in on echo protection

Inspected checkout `91eb562e3edfc624d1150985cdc6ffe7617e8ab7` under `/tmp/jarvis-mobile-audit/airi`.

[`voice.ts:613`](https://github.com/moeru-ai/airi/blob/91eb562e3edfc624d1150985cdc6ffe7617e8ab7/packages/stage-ui/src/stores/voice.ts#L613) conditions automatic acceptance during its own speech on platform echo cancellation or a supplied external classifier. [`audio-device.ts`](https://github.com/moeru-ai/airi/blob/91eb562e3edfc624d1150985cdc6ffe7617e8ab7/packages/stage-ui/src/composables/audio/audio-device.ts#L62) maintains processed input for speech/VAD and separately describes raw input for playback/routing uses. This supports verifying realized capture settings and keeping raw versus cleaned audio distinct. It does not establish that a true `echoCancellation` setting guarantees successful cancellation on every Android Bluetooth route.

## Recommended spike for the existing lab

1. Keep persistent SmallWebRTC microphone/remote-track media and the existing BB authority adapter, real STT, and Alfred. Do not change model/voice/services just to conceal the acoustic bug.
2. Add an explicit, maintained reference-based AEC stage before Silero, with correctly timed render reference and matching audio formats. Prefer device-side processing when available because it knows actual rendering; if a server-side AEC experiment is chosen, characterize network/codec/delay mismatch rather than assuming server PCM is the exact loudspeaker waveform. See the companion AEC-source audit for library selection.
3. Test echo-only and simultaneous **different near-end speech plus echo** before reconnecting fast onset cancellation. A gate that zeros all input while Alfred speaks is not a pass. Include delay, attenuation, resampling/codec path, clipped echo and changing delay. Measure residual echo, preservation/intelligibility of the near-end utterance, onset detection delay and false interruptions.
4. Once echo-clean speech is established, use Pipecat's onset signal to pause/yield immediately, independent of batch transcription. End-of-turn/Smart Turn remains responsible for deciding when to answer. Preserve pre-roll.
5. For reversible pauses, use a genuine pausable bounded output buffer with a retained cursor; never clear output and call that a pause. Commit cancellation only on the chosen confirmation policy; explicit Stop is final. Keep generation identity so a stale recognition result cannot resume or cancel a newer response. Alternatively, adopt LiveKit's actual playout/session implementation with its adapters/infrastructure, rather than imitating its API names over destructive queue flushes.
6. Record raw-onset, cleaned-onset, pause/commit/resume, last old-response sample, STT completion and first replacement audio independently. Never label post-cancellation audio tail as full barge-in latency.

This spike can preserve existing transcription and Alfred while answering whether acoustic separation restores fast onset. Streaming STT may improve confirmation and reply latency later; it is not the missing acoustic echo canceller. Transcript matching can remain an observed fallback rejection signal, but it must not be the condition that allows every interruption. Full physical Android/car and long-session qualification remain necessary to establish the user's actual experience.
