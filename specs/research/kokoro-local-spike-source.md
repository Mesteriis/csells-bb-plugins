# Kokoro self-hosted Jarvis voice spike: source findings

Research date: 2026-11-15. This is source analysis and a runnable setup recommendation, **not an executed inference benchmark or a voice-quality verdict**. No lab service was inspected or modified for this report.

## Decision

Kokoro is the simplest of the three candidates to test entirely in Node: official `kokoro-js` uses Transformers.js/ONNX Runtime, supports CPU execution, and supplies British male stock voices. Start with `bm_george` and `bm_fable`, FP32, at native speeds 1.25 and 1.4. Keep LiveKit and the BB director unchanged while replacing only the synthesis adapter. [Official JavaScript implementation](https://github.com/hexgrad/kokoro/tree/main/kokoro.js)

Kokoro cannot be presented as an Alfred reference clone. The released model has no reference encoder, and the JavaScript public API selects an existing voice ID rather than accepting reference audio. It is a stock British voice candidate for the desired character. Arbitrary voice cloning would require additional work outside the supported inference path. [Model architecture](https://huggingface.co/hexgrad/Kokoro-82M#model-facts), [voice selection implementation](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/src/kokoro.js)

## Voice choices and evaluation

The author's grades estimate training data and associated inference quality; they are not our listening scores. British male options are:

| Voice | Upstream target-quality grade | Upstream overall grade | Spike order |
| --- | --- | --- | --- |
| `bm_george` | B | C | First |
| `bm_fable` | B | C | First |
| `bm_lewis` | C | D+ | Backup |
| `bm_daniel` | C | D | Backup |

These use British English phonemization. No source establishes that one sounds like the particular Jarvis/Alfred voice Chris wants. Audition them; do not relabel a stock voice as a clone. The author warns about poor very-short utterances and rushing in very-long segments, and suggests a middle range of approximately 100–200 model tokens. That means tiny chunks can damage prosody even if they improve first-audio latency. [Author's voice notes and grades](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)

Proposed listening matrix: two leading voices × speeds 1.25/1.4 × FP32/q8. Include a brief acknowledgment, a 20-word answer, a 90-second briefing, names/numbers/acronyms, and a correction after each of three interruptions. Score clarity, fuzz, intelligibility at speed, character fit, joins, and fatigue independently. Use exactly the same text and LiveKit path for every engine. A clean saved WAV does not establish clear Android/car Bluetooth output.

## Streaming and interruption implications

`generate_from_ids()` awaits the model and returns a complete 24 kHz waveform. `stream()` splits input into sentences and generates each sentence before yielding it. This is sentence-level generation, not progressive sample generation within a sentence. The numeric `speed` option is passed to model inference, so 1.25 and 1.4 are synthesis controls, not browser playback-rate changes. The public generation interface has no abort signal. Exceptionally long chunks are tokenizer-truncated in the reviewed code; input chunk bounds are needed to prevent missing spoken text. [Generation source](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/src/kokoro.js)

Use an explicit `TextSplitterStream`, call `close()` at end of text, and use `flush()` deliberately for a final fragment. Its boundary heuristic waits for lookahead; the last sentence can otherwise remain buffered. The reviewed direct-string `stream()` path creates its own splitter without closing it, so avoid that convenience path until checked against the installed package. [Splitter source](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/src/splitter.js)

Adapter recommendations, inferred from those source limitations:

- Keep the model warm in a dedicated Node inference worker/process. Do not put CPU inference on the agent's transport/event-processing path.
- Convert the returned float waveform to PCM16 once, respecting its 24 kHz sample rate, and let LiveKit own playout timing. Twenty-millisecond frames contain 480 samples at this rate.
- Associate generated audio with a turn ID. On interruption, cancel downstream playout immediately, discard late audio for that turn, and stop queuing its remaining sentences.
- Measure whether an in-flight sentence stalls the next response. Discarding output is not cancellation of CPU work; use a worker lifecycle or execution queue with explicit bounded behavior if needed.
- Do not generate an entire long briefing before sending audio. Bound sentence/chunk size and verify spoken-text coverage rather than accepting tokenizer truncation.

## Reproducible candidate and maintenance evidence

Observed upstream state on the research date:

| Component | Observed pin/state |
| --- | --- |
| npm `kokoro-js` | 1.2.1, published 2025-05-03 |
| Official repository HEAD | `dfb907a02bba8152ca444717ca5d78747ccb4bec`, 2025-08-06 |
| Last commit affecting `kokoro.js` | `d4ef0569c79046dfd77fbb128502546a3afe5bef`, 2025-08-06, voice-loader fix |
| ONNX repository | `onnx-community/Kokoro-82M-v1.0-ONNX` |
| ONNX revision | `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, last modified 2025-02-08 |
| FP32 download | `onnx/model.onnx`, 325,532,232 bytes |
| q8 download | `onnx/model_quantized.onnx`, 92,361,116 bytes |

[Published npm metadata](https://registry.npmjs.org/kokoro-js), [repository commits](https://api.github.com/repos/hexgrad/kokoro/commits?per_page=1), [JavaScript commits](https://api.github.com/repos/hexgrad/kokoro/commits?path=kokoro.js&per_page=1), [ONNX metadata](https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.0-ONNX), [ONNX files and sizes](https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.0-ONNX/tree/main/onnx)

This is an official implementation with published artifacts, but the observed release history does not justify calling it actively maintained as of November 2026. Main has changes newer than the npm release. Preserve the lockfile and exact artifacts; verify installed behavior rather than assuming all main-branch fixes are published. The package declares Transformers.js `^3.5.1`; do not independently substitute the newer major without testing. [Official package manifest](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/package.json)

## Executable baseline for the disposable candidate

Run in a new candidate-only directory with Node 24. This is intentionally a file-generation smoke test before connecting LiveKit:

```sh
npm init -y
npm install --save-exact kokoro-js@1.2.1
```

Save as `kokoro-smoke.mjs`:

```js
import { mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { KokoroTTS, env } from 'kokoro-js';

env.cacheDir = './model-cache';
await mkdir('./samples', { recursive: true });
const started = performance.now();
const tts = await KokoroTTS.from_pretrained(
  'onnx-community/Kokoro-82M-v1.0-ONNX',
  { dtype: 'fp32', device: 'cpu' },
);
console.log(JSON.stringify({ modelLoadMs: performance.now() - started }));
const text = 'Good afternoon, Chris. Two agents have finished their tasks. '
  + 'The deployment needs your answer before it can continue. '
  + 'Would you like the details, or shall I read the question first?';
for (const voice of ['bm_george', 'bm_fable']) {
  for (const speed of [1.25, 1.4]) {
    const start = performance.now();
    const audio = await tts.generate(text, { voice, speed });
    const synthesisMs = performance.now() - start;
    const seconds = audio.audio.length / audio.sampling_rate;
    await audio.save(`./samples/${voice}-${speed}.wav`);
    console.log(JSON.stringify({ voice, speed, synthesisMs, seconds,
      realTimeFactor: synthesisMs / (1000 * seconds) }));
  }
}
await tts.model.dispose();
```

```sh
node kokoro-smoke.mjs
```

The convenience loader above downloads the repository default revision. Before collecting comparison evidence, record downloaded checksums and mirror/pin the listed ONNX revision in the deployment artifact; `KokoroTTS.from_pretrained()` does not expose a `revision` parameter in its own wrapper. Node voice files ship with the npm package, unlike browser fetching. Keep the model cache in candidate storage and preserve it with evidence. No hosted synthesis key is required. [Loader and cache API](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/src/kokoro.js), [voice file loading](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/src/voices.js)

## Performance, licensing, and remaining proof

No trustworthy same-host CPU throughput or first-audio measurement was obtained in this research task. File sizes are not RAM requirements. Report model-load time separately from warm sentence latency, real-time factor, peak RSS, CPU contention, and LiveKit first-audio delay. Warm each selected voice, repeat multiple lengths, then measure after interruption. Run FP32 first to establish a quality baseline; introduce q8 only as a measured tradeoff.

Kokoro's repository, model weights, and ONNX model card declare Apache-2.0. `kokoro-js` and its declared JavaScript packages also declare Apache-2.0; `phonemizer` uses eSpeak NG, so retain transitive notices instead of treating the whole packaged dependency tree as a single license. [Kokoro license](https://github.com/hexgrad/kokoro/blob/main/LICENSE), [ONNX model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), [phonemizer package](https://registry.npmjs.org/phonemizer/latest), [phonemizer source](https://github.com/xenova/phonemizer.js)

The spike passes only after actual generated speech traverses the staging LiveKit room and Android/car setup, the user grades its voice, and repeated interruptions suppress obsolete audio without losing the next response. This report does not establish any of those results or assume an existing Kokoro installation in the lab.
