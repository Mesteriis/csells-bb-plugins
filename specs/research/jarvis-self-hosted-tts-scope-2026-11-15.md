# Jarvis speech evaluation: corrected self-hosted scope

Chris clarified on 2026-11-15 that the evaluation is for **open-source,
self-hosted speech synthesis engines used with LiveKit**. Hosted Cartesia,
Inworld and ElevenLabs services are outside this task. The previous recommendation
and provider integration followed the wrong interpretation. Do not request
commercial API credentials or activate those services.

The BB credential request has ended with `Secret request cancelled (timeout)`.
No hosted provider was activated or purchased. Staging remains on local
Alfred/Pocket at the brisk preset. The unused hosted integration remains in
commit a0a93d1 as historical work; it is not the intended solution and its
constructor tests are not evidence for any self-hosted replacement.

## Correct evaluation

Keep the Node/TypeScript BB and LiveKit orchestration. Evaluate downloadable
engines on lab hardware through a local service interface, preserving LiveKit's
playout, cancellation and browser microphone path. A locally authenticated
service is not a commercial-provider API dependency. Prefer a maintained runtime
that fits the user's preference to avoid Python; distinguish the engine's runtime
from the BB plugin language and record unavoidable runtime requirements before
choosing a deployment.

Initial source screening, not a completed comparison:

- **Kokoro:** available in the existing local voice service. Its upstream
  [82M model card](https://huggingface.co/hexgrad/Kokoro-82M) identifies Apache-licensed
  weights. Use stock voices as the first local baseline and measure pace/clarity.
- **Qwen3-TTS:** the [official repository](https://github.com/QwenLM/Qwen3-TTS)
  describes expressive and streaming speech generation. Investigate the actual
  serving path, cancellation, rate controls, runtime and hardware requirements;
  advertised streaming does not prove our local deployment streams promptly.
- **CosyVoice:** inspect the [official source](https://github.com/QwenAudio/CosyVoice)
  and model-serving implementation as another candidate. No Jarvis quality,
  resource-fit or integration result has been established yet.
- **Chatterbox:** the [upstream README](https://github.com/resemble-ai/chatterbox/blob/master/README.md)
  now describes the project as retired and unmaintained. Preserve that maintenance
  concern rather than recommending it from older reviews without qualification.

Research belongs in `specs/research/`. Deep source inspection and lab resource
discovery must precede selecting a replacement. Compare clear stock voices at
brisk speaking rates, actual first-audio latency, continuous output, repeated
interruptions and engine cancellation. Use the real disposable staging VM and
normal interfaces to lab services. Retain the 250ms interruption target and the
unresolved Android/car behavior; desktop checks do not close either gap.

No new engine was installed or auditioned as part of this scope correction.

Subsequent implementation: [the three-engine spike report](jarvis-self-hosted-tts-spikes-2026-11-15.md)
records actual installations, source pins, GPU qualification, browser evidence,
failures and remaining acceptance. Kokoro was deployed in the disposable inference
VM; this work did not activate or modify any engine in the shared voice service.
