# Stock briefing comparison — November 15, 2026

Chris requested identical prepared text at Start to isolate voice startup from
briefing-model generation. Staging now sets `startupBriefing: "sample"` in the
private companion configuration. The UI says **Start voice test**, explains
fresh synthesis, and exposes the stock text. No audio is cached. Normal startup
remains the default when that setting is absent.

Start pauses automatic updates and speaks the fixed passage without a briefing
model call or thread refresh. LiveKit media establishment and engine preparation
remain included. **Brief me** and subsequent conversation retain the real BB
path. Sample speech does not claim to deliver a real pending question.

All four voice options are selectable, including Qwen for this comparison only;
its earlier interruption/recovery failure is unresolved and the UI warns it may
stall. No inference implementation or true-streaming improvement is included.

| Voice | Click to first decoded audio at 1.4x |
|---|---:|
| Kokoro George, warm | 2,222 ms |
| Kokoro Fable, warm | 2,141 ms |
| CosyVoice Alfred, warm | 2,606 ms |
| Qwen Alfred, switching/loading model | 13,427 ms |
| Qwen Alfred, warm repeat | 4,013 ms |

Every trial verified the Start label, stock transcript and non-silent WebRTC
output. Every under-one-second assertion **still fails**. One trial per case,
not a latency distribution or physical Android/Bluetooth measurement. The probe
ends after first audio: it does not requalify full-passage or interruption quality.
All test browsers closed; companion health returned sessions 0 afterward.
Companion build and all 16 existing tests pass; staged plugin build passes.
[Evidence](evidence/jarvis-stock-briefing-2026-11-15.json).

Reload [staging](https://csells-mac-mini--4840.getbb.app/plugins/jarvis/staff),
choose a voice/pace, and press **Start voice test**. End before switching voice.
Repeat the same voice to compare warm startup; switching between Qwen and
CosyVoice can load a different model into the shared GPU. This is a stock-text
startup test, not a claim of sub-second synthesis or production acceptance.
