# Qwen3-TTS self-hosted Jarvis spike: source findings

Research date: 2026-11-15. Source inspected; inference and hardware benchmarks have **not** been run by this research task. No hosted inference or paid API is required.

## Recommendation

Use **Qwen3-TTS-12Hz-0.6B-Base** for an initial Alfred-reference quality baseline; use 1.7B-Base as a second quality point if resources permit. For a genuinely streaming conversation on available Apple Silicon, evaluate the **MLX Audio** implementation. The official Python package is a valid offline synthesis baseline but its current public wrapper is not an incremental audio API. Do not present its full WAV, subsequently split into network chunks, as streaming inference.

Keep Jarvis and its LiveKit agent in TypeScript. Run the selected engine as a separate, isolated Python inference service. No verified first-party TypeScript-only Qwen runtime was found. That service must be in the approved staging arrangement; this research does not authorize changing the stable Mac voice installation.

## Reproducible versions

| Component | Revision | Role/license |
|---|---|---|
| [Official Qwen source](https://github.com/QwenLM/Qwen3-TTS/tree/022e286b98fbec7e1e916cb940cdf532cd9f488e) | `022e286b98fbec7e1e916cb940cdf532cd9f488e` | Python `qwen-tts` 0.1.1; Apache-2.0 |
| [0.6B-Base weights](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base/tree/5d83992436eae1d760afd27aff78a71d676296fc) | `5d83992436eae1d760afd27aff78a71d676296fc` | Reference voice cloning; Apache-2.0 |
| [1.7B-Base weights](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base/tree/fd4b254389122332181a7c3db7f27e918eec64e3) | `fd4b254389122332181a7c3db7f27e918eec64e3` | Larger clone model; validate incremental quality benefit |
| [MLX Audio source](https://github.com/Blaizzy/mlx-audio/tree/b5fcbe964b9e4cad4b06782f97d3e51fe74a8702) | `b5fcbe964b9e4cad4b06782f97d3e51fe74a8702` | Community Apple implementation; MIT |
| [MLX 0.6B-Base BF16 weights](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16/tree/1eccf1cb2519b5a4e8a95b5f0544f3303568164f) | `1eccf1cb2519b5a4e8a95b5f0544f3303568164f` | Converted weights; Apache-2.0 |

Model identity/revisions were read from Hugging Face's model API. Weights are downloadable without buying hosted inference. License of a reference voice recording is separate from engine/model licensing. Use the already-authorized Alfred reference, not an unrelated person's recording.

## What the source actually does

### Official Qwen package

[`generate_voice_clone`](https://github.com/QwenLM/Qwen3-TTS/blob/022e286b98fbec7e1e916cb940cdf532cd9f488e/qwen_tts/inference/qwen3_tts_model.py#L470) calls model generation to completion, decodes accumulated codes, removes reference-prefix audio, then returns `(wavs, sample_rate)`. Its docstring at line 513 explicitly explains that `non_streaming_mode=False` simulates streaming input and does not enable true streaming generation. The model-family streaming claim and advertised 97 ms latency do not establish that this wrapper meets our needs.

Reference cloning belongs to **Base** checkpoints. Pass the local WAV and its exact transcript (`ref_text`) for in-context cloning. `x_vector_only_mode=True` accepts speaker embedding alone but discards the transcript/acoustic prompt; grade it separately rather than treating it as equivalent. The wrapper supports building/caching `create_voice_clone_prompt` once and reusing it across utterances. CustomVoice has preset speakers; VoiceDesign takes a description. Neither is a drop-in way to reproduce the existing Alfred reference.

Cancellation is a real limitation: [`Qwen3TTSForConditionalGeneration.generate`](https://github.com/QwenLM/Qwen3-TTS/blob/022e286b98fbec7e1e916cb940cdf532cd9f488e/qwen_tts/core/models/modeling_qwen3_tts.py#L2022) accepts `**kwargs`, but constructs a fixed `talker_kwargs` dictionary and passes only that at line 2272. It does **not** forward an arbitrary `stopping_criteria` hook. Closing an HTTP connection therefore does not prove inference stopped. A disposable worker process can be terminated for hard cancellation, with an expensive reload; a warm worker that finishes abandoned work has worse next-turn latency. Do not quietly promise token-level cancellation through this API.

No numeric speed parameter is implemented in this wrapper. Generation token budget is not speech speed. A maximum of 4096 codec tokens can represent a long utterance; cap sentence length and token count for a spike, and retain end-of-speech completeness checks.

[`pyproject.toml`](https://github.com/QwenLM/Qwen3-TTS/blob/022e286b98fbec7e1e916cb940cdf532cd9f488e/pyproject.toml) requires Python >=3.9, pins transformers 4.57.3 and accelerate 1.12.0, and includes torchaudio, librosa, soundfile, sox, onnxruntime, einops and Gradio. Python 3.12 in a separate environment is a reasonable reproducible choice. FlashAttention is an optional CUDA optimization, not a requirement for the CPU baseline. Do not mix this environment with current MLX Audio's incompatible transformer major version.

### MLX Audio streaming implementation

The [Base clone path](https://github.com/Blaizzy/mlx-audio/blob/b5fcbe964b9e4cad4b06782f97d3e51fe74a8702/mlx_audio/tts/models/qwen3_tts/qwen3_tts.py#L2243) prefills text, primes decoder context from the reference, generates codec tokens, calls `decoder.streaming_step`, then yields PCM before all tokens exist. This is actual incremental synthesis. `streaming_interval=0.32` means approximately four codec frames at 12.5 Hz, **not** a guaranteed 320 ms wall-clock first-byte time. Default interval is two seconds and is unsuitable as an unexamined conversation setting. Model config declares mono 24 kHz output.

[`generate`](https://github.com/Blaizzy/mlx-audio/blob/b5fcbe964b9e4cad4b06782f97d3e51fe74a8702/mlx_audio/tts/models/qwen3_tts/qwen3_tts.py#L1151) accepts a `speed` argument but documents it as unsupported and never applies it. Passing 1.25 or 1.4 will not produce the requested tempo. The HTTP server forwards that field unchanged; it does not repair this omission.

The existing [MLX HTTP server](https://github.com/Blaizzy/mlx-audio/blob/b5fcbe964b9e4cad4b06782f97d3e51fe74a8702/mlx_audio/server.py#L896) cancels a broker handle on disconnect/finalization. The [generation worker](https://github.com/Blaizzy/mlx-audio/blob/b5fcbe964b9e4cad4b06782f97d3e51fe74a8702/mlx_audio/server.py#L693) checks cancellation between yielded chunks. This is cooperative cancellation; it cannot preempt a running GPU kernel or text prefill. Verify cancellation-to-idle and next-turn latency empirically. A wrapper should serialize access to a model's streaming decoder state and reset it after abandoned generations; normal reset follows completion, so do not assume early generator exit ran every cleanup line.

Current [MLX dependencies](https://github.com/Blaizzy/mlx-audio/blob/b5fcbe964b9e4cad4b06782f97d3e51fe74a8702/pyproject.toml#L18) require Python >=3.10, mlx >=0.32.4, transformers[chat-template] >=5.14.0, numpy, scipy, miniaudio, sounddevice and others. The server extra adds FastAPI and uvicorn. This is a community implementation, not Qwen's official package. Its Apple GPU path is a realistic candidate; using this path on the existing x86 Linux staging VM is not an option to assume. CPU fallback or Linux accelerator support must be demonstrated for the actual runtime/platform before claiming viability.

## Executable baseline recipe

These commands are a proposed isolated spike, not a record that they have already run. Execute in the disposable candidate only. `alfred-reference.wav` and `alfred-reference.txt` denote the authorized clean reference and exact spoken text.

```bash
python3.12 -m venv .venv-qwen
.venv-qwen/bin/pip install 'git+https://github.com/QwenLM/Qwen3-TTS.git@022e286b98fbec7e1e916cb940cdf532cd9f488e'
.venv-qwen/bin/python - <<'PY'
from pathlib import Path
import torch
import soundfile as sf
from huggingface_hub import snapshot_download
from qwen_tts import Qwen3TTSModel
path = snapshot_download('Qwen/Qwen3-TTS-12Hz-0.6B-Base',
    revision='5d83992436eae1d760afd27aff78a71d676296fc')
model = Qwen3TTSModel.from_pretrained(path,
    device_map='cpu', dtype=torch.float32, attn_implementation='eager')
prompt = model.create_voice_clone_prompt(
    ref_audio='alfred-reference.wav',
    ref_text=Path('alfred-reference.txt').read_text().strip())
wavs, sr = model.generate_voice_clone(
    text='Three threads need your attention. The build passed; one agent has a question.',
    language='English', voice_clone_prompt=prompt, max_new_tokens=500)
sf.write('qwen-alfred-native.wav', wavs[0], sr)
PY
ffmpeg -i qwen-alfred-native.wav -af atempo=1.25 qwen-alfred-125.wav
ffmpeg -i qwen-alfred-native.wav -af atempo=1.4 qwen-alfred-140.wav
```

The CPU recipe is a compatibility/quality attempt, not a performance claim. The official examples use CUDA/BF16 plus FlashAttention2. On suitable CUDA hardware change device/dtype/attention together; inspect available VRAM and record actual peak memory before a longer sample. No fixed CPU latency or VRAM threshold has been established here. On Apple, use the separate MLX environment for streaming rather than assuming official Torch MPS support.

Apple streaming quality harness, after provisioning a permitted isolated Apple runtime:

```bash
python3.12 -m venv .venv-mlx-qwen
.venv-mlx-qwen/bin/pip install 'mlx-audio[server] @ git+https://github.com/Blaizzy/mlx-audio.git@b5fcbe964b9e4cad4b06782f97d3e51fe74a8702'
.venv-mlx-qwen/bin/python - <<'PY'
from pathlib import Path
import time
import numpy as np
import soundfile as sf
from huggingface_hub import snapshot_download
from mlx_audio.tts.utils import load_model
path = snapshot_download('mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16',
    revision='1eccf1cb2519b5a4e8a95b5f0544f3303568164f')
model = load_model(path)
start = time.monotonic()
chunks = []
for result in model.generate(
    text='Three threads need your attention. The build passed; one agent has a question.',
    ref_audio='alfred-reference.wav',
    ref_text=Path('alfred-reference.txt').read_text().strip(),
    lang_code='English', stream=True, streaming_interval=0.32):
    if not chunks:
        print('first_pcm_ms', round((time.monotonic()-start)*1000))
    chunks.append(np.asarray(result.audio))
    # The service must emit this PCM here, not wait for concatenation below.
sf.write('qwen-mlx-alfred-native.wav', np.concatenate(chunks), result.sample_rate)
PY
```

The scripts do not pin every transitive wheel. Capture `pip freeze`, Python/platform versions, model revisions, reference SHA256 and FFmpeg version with benchmark evidence after successful installation. Readiness is not established by a successful package install alone.

## LiveKit integration and grading gates

Use the existing TypeScript LiveKit TTS adapter boundary. Raw PCM must be mono signed 16-bit little-endian with the correct declared sample rate. One persistent pitch-preserving tempo processor per utterance should apply 1.25/1.4, then flush exactly once at EOF. Resetting `atempo` per tiny chunk introduces avoidable boundaries and lost tails. Do not change the sample-rate declaration to fake faster speech.

An interruption must immediately stop LiveKit playout, invalidate queued chunks by utterance ID, abort the engine HTTP request, and terminate/flush no old tempo stream into a new turn. The engine alone does not solve barge-in: LiveKit's speech detection/turn handling owns that behavior. Confirm cancellation is effective on the second and third interruptions, not just the opening briefing.

Grade the same reference and same texts across native, 1.25 and 1.4 speeds: intelligibility, Alfred resemblance, background fuzz, syllable clipping, sentence endings, chunk seams, audio speed actually measured from duration, first PCM, first browser playout, synthesis throughput, CPU/GPU memory, cancellation-to-silence, cancellation-to-worker-idle, next-turn start and stale audio after reconnect. Require a long briefing plus short question, consecutive interruptions, silent-microphone playback, and real Android/car Bluetooth listening. First-PCM and browser-planning metrics cannot certify the Bluetooth acoustic experience.

For this candidate the decision is: **official CPU wrapper = offline quality evidence unless measured otherwise; MLX Base clone = plausible streaming conversation candidate requiring real hardware validation; neither natively honors numeric tempo.** Do not select Qwen over other engines solely from the model card's streaming claim.
