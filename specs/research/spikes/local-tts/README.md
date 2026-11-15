# Self-hosted LiveKit voice comparison

Disposable spike, not a production inference service. The BB plugin and LiveKit
companion are TypeScript. Kokoro is Node/ONNX; the upstream Qwen and CosyVoice
runtimes are isolated Python processes in the inference VM.

## Reproduce the inference environment

The `qwen-requirements.lock` and `cosy-requirements.lock` files record the tested
GPU environments (use the corresponding official PyTorch CUDA wheel indexes).
They complement the source/model pins; they do not contain weights or credentials.

Use the exact code/model revisions in the three `*-local-spike-source.md` reports.
Node 24.22.3: run `npm ci` in this directory. Kokoro weights are pinned by the
worker's remote path and checked against the published ONNX SHA-256. The actual
Transformers.js `env` must be imported directly; Kokoro's wrapper only exposes
WASM configuration. Model downloads need network; ordinary inference does not.

For the GPU engines, use separate environments under `ENGINE_ROOT`:

- `qwen-env`: Python 3.12, official pinned qwen-tts source, Transformers 4.57.3,
  PyTorch/torchaudio 2.6.0+cu124.
- `cosy-env`: Python 3.10, pinned CosyVoice source with submodules in `cosy-source`.
  `prepare-cosy-cpu.py` produces a minimal upstream dependency set without optional
  TensorRT/DeepSpeed. Install with build constraint `setuptools==80.10.2`, also
  install that version into the runtime, omit optional `wetext` (its model download
  is unavailable in this lab; upstream English normalization remains), then replace CPU torch/torchaudio with
  2.3.1+cu121. The runtime setuptools pin is required for upstream `pkg_resources`.
- NVIDIA guest driver 550.163.01; install headers matching the actual cloud kernel
  before DKMS. Validate CUDA computation in both environments, not just nvidia-smi.
- `download-models.py` downloads pinned snapshots into `models/qwen` and
  `models/cosyvoice`. Keep weights and virtual environments out of Git.
- Supply authorized `alfred-reference.wav` and exact `reference-transcript.txt`
  privately in `ENGINE_ROOT`. Use the validated 4.95-second complete opening
  excerpt for this comparison; a long reference caused short-utterance omissions
  in the initial CosyVoice run. Neither belongs in Git or a public sample endpoint.

The measured lab VM has 4 vCPU, 10 GiB RAM and an exclusively assigned NVIDIA
RTX 1000 Ada Laptop (6 GiB VRAM). Preserve the host's Intel display. The lab
registry owns VM/GPU/tunnel allocation and teardown details; scripts here must
not be used to guess ownership or provision over existing workloads.

Install the two example systemd units after adjusting paths. Kokoro listens on
loopback 4854; the broker listens on 4850 and starts one GPU worker on 4853. Bind
only loopback. The existing candidate connects through task-owned SSH tunnels.

## Native measurements

```sh
MODEL=kokoro-fp32 OUT=samples-kokoro node measure.mjs
MODEL=qwen3-tts-0.6b OUT=samples-qwen node measure.mjs
MODEL=cosyvoice3 OUT=samples-cosy node measure.mjs
```

Run sequentially without installs or other inference competing for resources.
Each uses the same acknowledgement, passage and technical text at 1.25 and 1.4.
The output contains WAVs and per-request first-audio time, duration and real-time
factor. Native HTTP time is not browser latency. Do not grade voice character by
clipping/RMS or transcription alone.

## LiveKit and interruption checks

Configure `plugins/jarvis/voice/deploy/speech.example.json` on the candidate.
The browser selects a server-owned profile and prepares it before acquiring a
conversation. No provider API keys or automatic fallback are used.

Run `specs/research/probes/jarvis-output-quality.mjs` and
`jarvis-repeat-interruption.mjs` against the actual authenticated staging page.
Select a profile with `JARVIS_TTS_VOICE` and pace with `JARVIS_TTS_SPEED`.
Keep captures and raw diagnostics outside the VM. Use `bb voice transcribe` on
the controlled browser passage to check missing words. This validates the real
browser/LiveKit/models route with synthetic microphone input; Android/car acoustic
echo, perceived clarity and voice fit still require the user's listening grade.

All engines currently finish bounded phrases before emitting PCM. The SDK's
sentence adapter supplies conversational streaming. This is not evidence of
incremental decoder latency. HTTP cancellation discards pending/stale audio;
upstream GPU computation can continue until the current phrase completes. The
60-second worker watchdog terminates hangs. Browser interruption latency and
next-turn readiness must be measured separately.
