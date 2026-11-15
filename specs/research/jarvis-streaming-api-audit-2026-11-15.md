# Startup latency and streaming API audit — November 15, 2026

Chris's acceptance requirement is **under 1,000 ms from Start conversation to
first spoken audio**. The previous quality/interruption comparison did not gate
this and must not be treated as conversational acceptance. Valid batch API calls
were the wrong integration choice for that requirement.

## Reproduced failure

`probes/jarvis-start-latency.mjs` now measures a trusted button click against the
first decoded, non-silent WebRTC output. Both warm-model trials fail:

| Voice | Click to first audio | Under 1 second |
|---|---:|---|
| CosyVoice Alfred | 13,083 ms | Fail |
| Kokoro George | 14,403 ms | Fail |

One trial per engine, with real staging services and synthetic silent microphone;
not a latency distribution, physical car measurement or controlled Pocket comparison.
[Sanitized evidence](evidence/jarvis-start-latency-2026-11-15.json). Raw traces remain
outside the VMs in the task evidence directory under `start-latency-cosy` and
`start-latency-kokoro`. Both test browsers closed and conversations ended.

The CosyVoice trace separates:

- Voice selection/preparation returned at 466 ms: the model was already warm.
- Media connected at 1,131 ms; briefing preparation began at 1,800 ms.
- Complete briefing text became available at 11,603 ms.
- First synthesis metric reported 1,351 ms for a 23-character phrase.
- Decoded non-silent audio arrived at 13,083 ms.

Thus roughly 1.8 s precedes briefing preparation, 9.8 s goes to refreshing context
and preparing the full model briefing, and 1.5 s goes to initial synthesis/playout.
This is not just a cold model or Bluetooth routing problem. Streaming TTS alone
cannot fix the entire Start path.

## What the tests actually generated

`measure.mjs` feeds three fixed texts directly into each engine, synthesizing
fresh audio each time. No prerecorded playback is used. The browser quality test
asks the real director/model to repeat a known 53-word passage, asserts its complete
returned text, and then captures newly synthesized speech. Repeated-interruption
tests request dynamically generated stories through the real STT/model path.

The actual Start button generates a new briefing of real BB threads. Its path is:
prepare voice → open/join LiveKit → enable microphone → enable watching → refresh
thread context → await complete model briefing → present full text → synthesize.
The page showing text means the model finished; it does not mean audio was already
synthesized or that model tokens are streaming to TTS.

Source: `plugins/jarvis/voice/src/server.ts` (`open`, `start`),
`plugins/jarvis/relay/director.mjs` (`brief`, `infer`), and
`plugins/jarvis/voice/src/relay.ts` (`BBDirectorStream.run`, `speakState`).
Even `BBDirectorStream` emits the entire returned response as one delta; its class
name does not establish token streaming.

## Are the speech APIs used correctly?

For batch quality sampling, yes. For low-latency conversation, no:

- **CosyVoice:** the adapter explicitly uses `stream=False`, collects the entire
  generator into a list and concatenates its waveforms. Upstream `stream=True`
  does yield PCM while generation continues. Native speed control is only applied
  to the nonstreaming path; choosing batch mode to obtain 1.25/1.4 pace sacrificed
  the primary latency requirement. Proper evaluation must forward actual PCM
  yields and separately qualify continuous tempo processing, without restarting
  the tempo filter on every chunk. [Pinned upstream implementation](https://github.com/QwenAudio/CosyVoice/blob/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc/cosyvoice/cli/model.py).
- **Kokoro JS:** `generate()` returns a completed waveform. Its `stream()` API
  loops over text segments and awaits a whole waveform for each; it is not an
  incremental audio decoder. Simply switching that method name cannot establish
  sub-second output. Shorter first segments, inference settings and the actual
  runtime/hardware need measured qualification. [Official implementation](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/src/kokoro.js).
- **Qwen:** the selected official `generate_voice_clone()` wrapper returns full
  waveforms. Its `non_streaming_mode=False` flag does not enable streaming
  generation. The failed spike rejects that serving configuration on this hardware,
  not every possible Qwen streaming runtime. [Pinned wrapper and docstring](https://github.com/QwenLM/Qwen3-TTS/blob/022e286b98fbec7e1e916cb940cdf532cd9f488e/qwen_tts/inference/qwen3_tts_model.py).

The local adapter declares `streaming:false` to LiveKit, correctly describing
its current capability. LiveKit's sentence adapter and HTTP chunked delivery
cannot undo the upstream waits for complete text/waveforms. Cutting completed
PCM into network frames is not incremental synthesis.

## Correction required, not yet implemented

Keep model/reference preparation and as much media setup as possible off the
Start critical path. Prepare a fresh, grounded briefing ahead of playback or
stream its model output instead of awaiting the complete paragraph. Do not use
stale question bindings or a canned greeting to make the timer appear green.

Measure true streaming CosyVoice first, including the requested brisk pace,
actual first non-silent decoded audio, repeated interruptions, abandoned-inference
recovery and missing-word checks. Keep separate tests for prepared-text → audio,
Start → first relevant spoken content, and spoken-turn completion → answer audio.
A faster first-byte metric must not conceal silent buffers or slower next turns.

The new startup gate is red. No runtime implementation was changed in this audit;
no claim is made that turning on streaming will meet the deadline on this GPU.
