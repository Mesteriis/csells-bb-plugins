# Adopt an OSS conversation stack for Jarvis

2026-11-15. Research and source inspection only; no runtime changes or new service credentials. Recommendation is an engineering judgment, not a claim of verified Android/car performance.

## Recommendation

Adopt **LiveKit Agents' complete AgentSession and standard room audio output**, paired with the official React voice frontend. Following Chris's preference, use the official TypeScript/Node.js Agents SDK; Python is not required for this architecture. Keep Jarvis's BB coordination and authorization as application integrations. Retire the custom voice conversation controller and experimental server AEC from the proposed production path.

LiveKit is the strongest fit for minimizing the code we own: its session implementation already owns speech lifecycle, tentative interruption, retained playback, recovery, and provider integration. Pipecat remains a credible second choice if used as a complete pipeline. Our failed custom Bridge is not evidence that upstream Pipecat is incapable of good conversation.

The distinction matters: installing an OSS transport while continuing to own turn handling, buffering and recovery repeats the previous mistake. Neither framework is a ready-made BB coordinator; session selection, briefing, watching questions and authorized answers remain Jarvis responsibilities.

## Comparison

| Project | Evidence and licensing | Fit for this task | Selection |
|---|---|---|---|
| **LiveKit Agents** | Apache-2.0 framework; source includes AgentSession, pause-capable room output and conditional false-interruption recovery. Self-hostable media server. | Most complete ownership of conversation and playout among the inspected candidates; official web and native clients. Requires rooms, tokens, signaling and reachable media. | **First choice.** |
| **Pipecat** | BSD-2-Clause framework; source includes VAD/turn strategies, provider services and interruption propagation. | Strong flexible pipeline and smaller migration from our spike. We must use its actual service/turn abstractions. The inspected output interruption path clears queues; that alone does not provide recoverable playback. | **Second choice**, with more composition work for our requirements. |
| **FastRTC** | MIT; WebRTC transport and ReplyOnPause handler inspected. | Useful for exposing Python audio functions. Default response/interruption decisions depend on pause detection; adopting it would leave significant conversation policy to us. | Too low-level for reducing our ownership of the difficult behavior. |
| **TEN Framework** | Root license adds deployment restrictions to Apache text, including end-user-device and competing-service restrictions. Inspected example uses Agora RTC and separately flushes output stages. | Relevant technical implementation, but not an unrestricted OSS replacement and adds another RTC/provider dependency. | Exclude from the OSS shortlist. |
| **Moshi** | Kyutai publishes a full-duplex speech-model implementation, browser client, and Python/MLX/Rust runtimes. Code and model artifacts have distinct licensing. | Genuine simultaneous speech generation, but replaces the conversational model/voice architecture. It does not drop in as a controller for existing Jarvis + Alfred. | Separate model research, not the replacement middleware. |

Primary sources: [LiveKit Agents](https://github.com/livekit/agents), [Pipecat source](https://github.com/pipecat-ai/pipecat/tree/1bc2e37b15566cd34bb6941a335ce09c3bbbab8c), [FastRTC source](https://github.com/gradio-app/fastrtc/tree/59ca4f77e1669a9599c0895fd0d7c39f356bf89f), [TEN license](https://github.com/TEN-framework/ten-framework/blob/main/LICENSE), [Moshi repository](https://github.com/kyutai-labs/moshi).

The prior [fifteen-project audit](mobile-duplex-source-synthesis.md) also covers Qwen Audio Agent, Paseo, Moltis, Sutando, AIRI, N.E.K.O, Ultravox, Vapi, ElevenLabs, Hume and OpenAI Agents JS. Those results remain useful: assistant apps contain application-specific voice machinery, while several attractive open client SDKs delegate the conversation engine to hosted services. An open client is not an OSS server replacement. Reusing those apps would bring more unrelated behavior than adopting a conversation framework. They were not all freshly rerun or re-audited in this pass.

## What LiveKit supplies that we should actually reuse

Source checked at `livekit/agents@cbb5770c716c70009969cd7fa88e3c3662222ce9`:

- [Room audio output](https://github.com/livekit/agents/blob/cbb5770c716c70009969cd7fa88e3c3662222ce9/livekit-agents/livekit/agents/voice/room_io/_output.py): pause stops playback progression while retaining its buffer; resume continues retained output. This directly addresses our destructive-flush/resume mistake. Playback offsets and runs are tracked by the framework.
- [Agent activity](https://github.com/livekit/agents/blob/cbb5770c716c70009969cd7fa88e3c3662222ce9/livekit-agents/livekit/agents/voice/agent_activity.py): interruption decisions distinguish tentative pauses, committed interruption and recovery; stale/completed speech handles are checked before resumption.
- [Agent extension nodes](https://github.com/livekit/agents/blob/cbb5770c716c70009969cd7fa88e3c3662222ce9/livekit-agents/livekit/agents/voice/agent.py): STT, LLM and TTS integration are supported extension points.
- [Batch STT adapter](https://github.com/livekit/agents/blob/cbb5770c716c70009969cd7fa88e3c3662222ce9/livekit-agents/livekit/agents/stt/stream_adapter.py): VAD emits speech activity independently of final recognition. Existing BB batch transcription can be bridged without inventing a new capture state machine. It will still have batch recognition latency; wrapping it does not make it streaming ASR.

False-interruption recovery is conditional on pause-capable output and configured policy. It is not a promise that every cough or backchannel is correctly classified. Standard room output must remain in charge; a custom output implementation can disable these benefits. Current [turn-tuning documentation](https://docs.livekit.io/agents/logic/turns/tuning/) describes these separate controls.

## OSS versus cloud features

A fully self-hosted baseline can use the OSS server, client SDK, AgentSession, VAD, provider plugins and standard room playout. Our existing external services do not become OSS merely because the framework is OSS.

**Adaptive interruption inference is a cloud dependency.** Current documentation says the acoustic classifier uses LiveKit Cloud project credentials, including when explicitly enabled by a self-hosted agent. Without the supported setup, ordinary VAD is the default. Its more sophisticated distinction between intentional interruption and acknowledgments must not be advertised as a local OSS capability. [Adaptive interruption documentation](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/).

Browser WebRTC echo processing and enhanced noise/voice isolation are also different features. LiveKit documents browser processing separately from enhanced Cloud integrations. A self-hosted installation does not automatically include those enhancements. [Noise and echo documentation](https://docs.livekit.io/transport/media/noise-cancellation/).

## Concrete upstream starting point

Inspected official starter repositories, including license files and actual application source:

- [Python starter](https://github.com/livekit-examples/agent-starter-python/tree/228095c442fcb259c80e9786fc0d7c5534e6af46), MIT, revision `228095c442fcb259c80e9786fc0d7c5534e6af46`. `src/agent.py` uses AgentSession and room IO, and initiates a greeting. Its current defaults use hosted inference and an enhanced audio plugin. README explicitly describes provider/plugin changes for self-hosting. Do not deploy the stock defaults and call that an all-local stack.
- [React starter](https://github.com/livekit-examples/agent-starter-react/tree/9e1fc2f40fd7ceaccbe4a872b21765b49eefea80), MIT, revision `9e1fc2f40fd7ceaccbe4a872b21765b49eefea80`. `components/app/app.tsx` uses the supported session hook; controls and agent error handling are supplied. Preserve its media/session lifecycle when adding BB-specific entry buttons.

The current starter's dependency range is newer than some previously inspected internals. Before implementation, resolve and pin a compatible released SDK/provider/client set and confirm the same contracts in that exact version. These source inspections are not an executed compatibility test.

## Proposed adoption boundary

1. Establish the official frontend + agent baseline in disposable staging with actual services and standard microphone/remote-track WebRTC. Retain native endpoint AEC; remove the paired-reference/server-canceller experiment from this candidate. Choose self-hosted or explicitly cloud-assisted features openly, rather than allowing defaults to decide.
2. Add BB briefing, watched updates and exact-question answers as tools/events through the existing restricted relay. AgentSession owns conversation lifecycle; the relay remains the authority for which BB operations are permitted. Voice interruption must not silently cancel delegated work.
3. Use supported STT/LLM/TTS adapters. Existing BB batch STT is compatible in principle but preserves its latency cost. Alfred needs a correctly cancellable streaming TTS adapter; keep the framework's output queue. Missing word timestamps must not be fabricated.
4. Reconcile the BB director's separate history and displayed-question state with actual delivery. Framework playout accounting cannot automatically repair an external director that records all generated text as heard.
5. Keep one user-facing Start Jarvis action that immediately briefs and starts watching, plus clear stop/quiet/end controls. An upstream starter supplies the voice shell; it does not implement the original Jarvis product vision by itself.

Custom code should be limited to BB tools/authorization, service adapters and product presentation. We should not own an echo algorithm, microphone PCM graph, VAD implementation, general turn controller, or recoverable speaker queue.

## Verification and remaining uncertainty

Before calling a replacement ready, exercise the unmodified baseline and then the integrated candidate through the real browser/media/provider path: short “wait/stop/yes/no” controls, full sentences, sustained output, double-talk, false starts with lossless recovery, repeated turns, network loss/reconnect, and no stale output or duplicate BB actions. Keep the original 250 ms interruption and 30-turn acceptance requirements; do not replace them with the numbers a convenient fixture produces. Record speech onset, last old audio, resumed position, recognition and replacement audio separately.

No OSS choice guarantees the Android Bluetooth route. [LiveKit issue1507](https://github.com/livekit/client-sdk-js/issues/1507) documents failures on some Android/headset combinations, including the upstream playground, and is closed as not planned. It is historical ecosystem evidence, not proof that the current SDK fails on Chris's device. Native Android starter availability supplies a possible later fallback; this research does not change the browser requirement or authorize an app migration.

Our injected digital echo tests bypass the browser's physical capture AEC. They qualify an added server canceller, not the stock client's real acoustic cancellation. Do not repeat the inference that every production framework needs our custom server canceller because that digital fixture fails.

## Source coverage

Fresh primary documentation and pinned starter source inspected on November15; existing pinned framework source reopened, with independent review of LiveKit playout/adapters and Pipecat turn responsibilities. [Prior manifest](evidence/mobile-duplex-source-manifest.json) supplies framework/client pins and source paths. Moshi was evaluated from its official repository/README, not a full source audit or GPU run. No upstream applications, model benchmarks or physical phone tests were run for this research. No stable or staging service was modified.

## Follow-up: TypeScript and BB plugin compatibility

2026-11-15. Chris accepted LiveKit and prefers avoiding Python. Adopt TypeScript/Node.js for the agent worker. The earlier Python source audit was a research starting point, not a runtime requirement.

Verified [official Node starter](https://github.com/livekit-examples/agent-starter-node): `src/main.ts` creates `voice.AgentSession`, provider/turn configuration and room IO; `src/agent.ts` exposes typed tools. Current package metadata requires Node24+ and includes `@livekit/agents` and native `@livekit/rtc-node`, with no Python application dependency. Cloud-enhancement boundaries still apply.

Fresh source inspection: `livekit/agents-js@1fa759cf67477f19466a68cb15e2e17de1908e04`. [Room output](https://github.com/livekit/agents-js/blob/1fa759cf67477f19466a68cb15e2e17de1908e04/agents/src/voice/room_io/_output.ts) declares pause support and implements pause/resume; [agent activity](https://github.com/livekit/agents-js/blob/1fa759cf67477f19466a68cb15e2e17de1908e04/agents/src/voice/agent_activity.ts) includes conditional false-interruption recovery with speech identity checks. This verifies presence of the essential machinery in Node, not complete Python/Node feature parity or runtime acceptance. Current adaptive-interruption docs identify some tuning features as Python-only.

Recommended BB integration: keep the existing React/TypeScript plugin UI and server-side BB authority; embed LiveKit browser components in that UI; run the TypeScript voice worker as a supervised companion process connected to the existing restricted BB interface and speech services. The LiveKit media server is separate infrastructure or a managed service. Native RTC dependencies and worker lifecycle are reasons to keep the worker outside the plugin bundle; this is an architecture recommendation, not a claim that we tested embedding it directly in BB's runtime. Users continue opening Jarvis inside BB. Existing Python Pipecat/SmartTurn spike components need not remain in the proposed voice application path; existing separately hosted providers may have their own runtimes.

This is a supported integration direction. Exact SDK versions, adapters, BB embedding and Android/car behavior still require end-to-end staging validation.
