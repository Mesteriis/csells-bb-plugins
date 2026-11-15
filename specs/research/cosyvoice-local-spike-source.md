# CosyVoice local spike: source findings

Researched 2026-11-15. This is a source and model-manifest review, not a successful installation, latency benchmark, or listening test. No lab services were changed.

## Decision

CosyVoice3 is a credible self-hosted voice-cloning candidate, but its stock Python HTTP demo is not a production-ready LiveKit TTS server. Keep the Jarvis/LiveKit agent in TypeScript and put the upstream Python model behind a local PCM service. The two material gaps are exact accelerated speaking rates during streaming and reliable cancellation of model work. Neither should be marked supported merely because an HTTP request can be aborted.

Use `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` for the initial spike. Official code currently recommends this generation; English and voice cloning are supported. The repository and model metadata identify Apache-2.0 licensing. That license does not establish rights to an arbitrary reference speaker recording. Use the already authorized Alfred reference, with its provenance retained. [Official repository](https://github.com/QwenAudio/CosyVoice), [official model](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512).

Pinned revisions inspected:

- Code: `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc`.
- Model: `29e01c4e8d000f4bcd70751be16fa94bf3d85a18`.

## Runtime and installation

The official implementation is Python/PyTorch. The documented environment is Python 3.10, recursive checkout with `third_party/Matcha-TTS`, then the pinned requirements. Significant pins include PyTorch/torchaudio 2.3.1, transformers 4.51.3, numpy 1.26.4, onnxruntime 1.18.0, and HyperPyYAML 1.2.3. There is no first-party TypeScript inference runtime in the inspected path. [Install instructions](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/README.md#install), [requirements](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/requirements.txt).

Device selection is explicitly CUDA when available, otherwise CPU. Apple MPS is not selected. A Mac can therefore be a CPU feasibility target with this upstream implementation; an Apple-GPU result would require another backend or adaptation and must be labeled separately. The main CosyVoice3 initializer disables fp16/TensorRT when CUDA is absent. The speaker embedding ONNX session always uses CPU; speech tokenizer ONNX uses CUDA or CPU. No reliable minimum RAM/VRAM or x86 CPU real-time throughput was established by this review. Weight download size is not resident-memory demand. [Model device selection](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/model.py#L397), [initializer](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/cosyvoice.py#L189), [ONNX providers](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/frontend.py#L42).

For a CPU-only disposable VM, do not blindly install the complete Linux requirements: they include deepspeed, GPU ONNX Runtime, and three TensorRT packages. Prepare and retain a documented CPU requirements variant that removes those acceleration packages, installs `onnxruntime==1.18.0`, and installs matching CPU torch/torchaudio wheels. This is an implementation recommendation, not an install proven in this review. Keep `load_trt=False`, `load_vllm=False`, `fp16=False`. Do not add vLLM initially: upstream explicitly rejects streaming text input when vLLM is active. Optional `ttsfrd` is not necessary; upstream supports `wetext` fallback. [Requirements](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/requirements.txt), [text-stream constraint](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/model.py#L101).

## Model download budget

The official Hugging Face manifest reports 9,747,516,745 bytes (~9.75 GB) across all files. A normal PyTorch inference subset is approximately 5,427,165,532 bytes (~5.43 GB, 5.05 GiB) when excluding `llm.rl.pt`, `speech_tokenizer_v3.batch.onnx`, and `flow.decoder.estimator.fp32.onnx`. This estimate includes the small documentation files. Dependencies and caches are additional. [Official model manifest API](https://huggingface.co/api/models/FunAudioLLM/Fun-CosyVoice3-0.5B-2512?blobs=true), [pinned model tree](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512/tree/29e01c4e8d000f4bcd70751be16fa94bf3d85a18).

| Required large file | Bytes |
|---|---:|
| `CosyVoice-BlankEN/model.safetensors` | 988,097,824 |
| `llm.pt` | 2,024,669,519 |
| `flow.pt` | 1,329,116,148 |
| `hift.pt` | 83,202,622 |
| `speech_tokenizer_v3.onnx` | 969,451,503 |
| `campplus.onnx` | 28,303,423 |

Keep `CosyVoice-BlankEN` intact: the YAML initializes `Qwen2Encoder`, which loads its pretrained model before the CosyVoice LLM checkpoint is applied. A manifest filtered to only `*.pt` will fail. Also retain `cosyvoice3.yaml`, tokenizers, and model/config JSON files. [Qwen2 initialization](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/llm/llm.py#L226), [model configuration](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512/blob/29e01c4e8d000f4bcd70751be16fa94bf3d85a18/cosyvoice3.yaml).

## Alfred reference and speaking rate

The zero-shot API accepts reference audio plus its transcript. For CosyVoice3, use the official example prefix `You are a helpful assistant.<|endofprompt|>` followed by the actual reference transcript. Reference extraction rejects audio over 30 seconds. Input is converted to mono and resampled separately to 16 kHz for speech tokens/speaker embedding and 24 kHz for acoustic features. Use a clean, short recording at 24 kHz or higher, with an accurate transcript; do not pass an old Pocket embedding as though it were audio. `add_zero_shot_spk` caches the extracted conditioning so each utterance need not reprocess the reference. [Example](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/example.py#L71), [reference extraction](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/frontend.py#L95), [cache API](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/cosyvoice.py#L69).

`inference_zero_shot(..., stream=False, speed=1.25)` and `speed=1.4` reach the acoustic interpolation operation. With `stream=True`, the streaming branch does not forward `speed` to `token2wav`; it therefore silently retains the default 1.0. The speed implementation itself asserts that it is non-streaming. A UI must never label that stream “1.4×” simply because it supplied that argument. [Streaming versus non-streaming call paths](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/model.py#L328), [speed assertion](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/model.py#L444).

The official instruct example requests fast speech through natural-language conditioning. That can be tested with `inference_instruct2`, but it is not calibrated to 1.25× or 1.4×. This mode removes LLM prompt speech tokens and uses the instruction as prompt text while retaining audio conditioning, so it is a separate voice/prosody condition to grade. To preserve streaming and guarantee numerical acceleration, an independently tested streaming time-stretch stage would be necessary; that is additional infrastructure, not an upstream capability. First compare complete-utterance native-speed samples at 1.0/1.25/1.4 to assess whether the voice merits the integration work. [Instruct example](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/example.py#L85), [frontend mode](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/frontend.py#L209).

## Streaming and interruption are separate capabilities

CosyVoice3 emits mono 24 kHz waveform tensors. Its streaming loop waits for speech tokens, polls every 100 ms, calls the flow/vocoder, and yields audio chunks. Initial hop is 25 tokens at 25 tokens/second, increasing to 50 then 100. The first chunk also depends on reference token padding and three-token lookahead. These represent generated-audio spans, not measured wall-clock latency. `self.token_hop_len` is mutated on the shared model, so repeated-request chunk sizing needs measurement; do not assume every utterance restarts with the first-turn chunk budget. [Streaming loop and model constants](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/model.py#L343), [24 kHz/25 Hz configuration](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512/blob/29e01c4e8d000f4bcd70751be16fa94bf3d85a18/cosyvoice3.yaml#L8).

The bundled FastAPI handler wraps output in `StreamingResponse`, but does not set `stream=True`. It therefore does not activate incremental model decoding. It also preloads audio into a tensor, whereas the current frontend calls `load_wav` on its input; a thin adapter should follow the current Python API directly rather than trust this older demo path. Convert/clamp tensors to PCM16 little-endian, advertise the actual format/sample rate, and feed those bytes into a TypeScript LiveKit TTS adapter. Use bounded buffers and request IDs. [Official HTTP demo](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/runtime/python/fastapi/server.py#L44), [waveform loader](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/utils/file_utils.py#L44).

The inspected generator starts an LLM thread. There is no cancellation token checked in its token loop; cleanup of per-request dictionaries occurs after yields, outside `finally`. Closing an HTTP stream cannot be assumed to stop generation, reclaim that state, or unblock a following utterance. An exception in the LLM thread also does not visibly set its completion flag through `finally`, creating a possible endless polling path. These are source-derived risks, not failures reproduced here. [LLM job](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/model.py#L101), [request lifecycle](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/model.py#L328).

For a bounded spike, stop LiveKit playout immediately, discard stale output, and explicitly record whether backend computation continues. Fully drain a cancelled generator to allow normal cleanup, or isolate model work in a worker process with a timeout/restart strategy. Draining is not compute cancellation and can delay the next answer. A cooperative cancellation patch would need explicit finally cleanup, worker error propagation, and tests. Do not hide that work behind a “cancel supported” checkbox.

## Tests required before grading it viable

1. Pin/install real model; record CPU/GPU, available memory, model revisions, dependency changes, cold-load time, peak RSS/VRAM.
2. Generate identical English Jarvis briefings and short acknowledgements from the same Alfred reference at native 1.0/1.25/1.4. Record actual durations, first audio latency, real-time factor, pronunciation, noise, intelligibility, and speaker likeness. Retain WAV files.
3. Test true streaming at 1.0 and instructed-fast separately. Record first/second/later chunk latency and repeated-turn behavior; do not mislabel instructed-fast as exact numeric speed.
4. Browser→LiveKit→actual STT/LLM→CosyVoice→LiveKit→browser on real Android/car route. Capture received PCM timing and actual playback evidence; HTTP success does not demonstrate audibility.
5. Interrupt the briefing and at least three later replies. Verify prompt playout stop, no old speech after resuming, bounded engine work/state, and successful next answer. Include HTTP disconnect, worker exception, and inference timeout.
6. Grade CPU deployment independently from voice quality: good offline samples with a real-time factor above 1 are not a viable live-conversation result on that host.

No hosted service, API key, or LiveKit Python migration is necessary for this architecture. The unproven parts are local runtime performance, desired voice quality, accelerated streaming, and cancellation behavior.
