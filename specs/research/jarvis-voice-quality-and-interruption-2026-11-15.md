# Rushed speech and repeated interruption investigation

User report: Alfred sounded rushed/mumbled through Android car Bluetooth. The
first interruption stopped the opening briefing; a later interruption was
ignored until Stop speaking was pressed. This report separates the concrete
speech-rate repair from the **still unresolved physical-device interruption**.

**Subsequent user feedback:** background fuzz remains and normal speed is too
slow. The reduction to 1.0 did not resolve perceived quality and is not the user's
desired pace. See [replacement TTS research](jarvis-tts-provider-options-2026-11-15.md).

## What the actual user session shows

The session beginning 20:32:15Z on 2026-11-15 recorded the first speech detection
at 20:32:45.279Z and agent-listening at 20:32:45.439Z: 160ms after detection. The
next reply began at 20:32:55.645Z. There was **no user speech-detection event during
that reply** before playback was interrupted at 20:33:19.862Z. Detection resumed
later, at 20:33:28.509Z. The user reports that the manual Stop caused playback to
stop; the old logs do not identify that button separately.

All 18 browser media samples reported microphone enabled and playback permitted,
with zero downstream packets lost; jitter reached 50ms. Those are not microphone
level, upstream packet or acoustic measurements. They cannot distinguish a silent
capture path from missing transport, speech suppression, or a detector failure.
No microphone recording of that real session exists. Its original log is retained
privately outside the VM.

## Speech rate: confirmed and changed

The plugin explicitly requested `speed: 1.25` from Alfred. The shared service's
[contract](https://github.com/csells/awesome-jarvis/blob/main/lab/voice-server/managed/ALFRED.md)
also defaults to 1.25, so merely omitting speed would not help. The Jarvis adapter
now explicitly requests **1.0**. The shared voice service, profile and other apps'
configuration are unchanged.

A controlled 53-word passage through the real Alfred service measured:

| Requested speed | Source duration | Effective words/minute |
| --- | --- | --- |
| 1.25 | 12.096s | 262.90 |
| 1.0 | 14.960s | 212.57 |

The same passage then passed through the actual staged BB panel, real model,
Alfred and LiveKit into captured browser audio: **15.033s, 211.53 words/minute,
zero clipped samples**. BB's configured transcription recognized **53/53 words,
zero word edits**, after case/punctuation normalization. The capture starts only
for this known synthetic passage; no personal briefing audio was retained.

This verifies a slower rate and an intelligible generated sample after browser
transport. It cannot certify perceived quality after the physical Bluetooth/car
speaker path. The voice's timbre is unchanged; subsequent feedback says normal
speed is too slow. No unsupported claim of “car audio fixed” follows.

## Repeated interruption: desktop passes, phone cause remains open

The new [browser regression](probes/jarvis-repeat-interruption.mjs) asks for three
long responses through generated microphone input. It interrupts the briefing,
then the response to that interruption, then the next response. Each interruption
must occur during playback, stop decoded audio within 1.5s, produce a real STT
transcript, and get the new relevant answer through the actual model and Alfred.
It checks audio silence, not just the Speaking label.

Before changing speed or telemetry, all three interruptions passed, with onset to
decoded silence of **644, 700 and 723ms**. Thus this test did **not** reproduce the
user's phone failure, and cannot establish an interruption bug has been fixed.
It is a useful regression for the previously untested multi-turn sequence. These
numbers also do not pass the original 250ms interruption target. After deployment,
all three passed again at **742, 801 and 634ms**, with advancing browser input
transmission counters and nonzero server input levels verified for each prompt.

LiveKit's pinned Node source and [turn-handling contract](https://docs.livekit.io/agents/logic/turns/)
enable interruption by default; scheduled briefing speech also explicitly allows
it. There is no evidence yet that response speech is deliberately uninterruptible.
The configured VAD mode is retained. Browser AEC, noise suppression and automatic
gain remain enabled, following the supported [media-processing path](https://docs.livekit.io/transport/media/noise-cancellation/).
Turning off AEC or lowering speech thresholds without capture evidence could
reintroduce the already-rejected self-interruption behavior.

## Diagnostics added to resolve the missing boundary

While the user is connected, the candidate now reports:

- Browser microphone mute/ended state, upstream bytes/packets, and available
  source level/energy/duration counters every five seconds.
- Server-received microphone sample count, RMS and peak level once per second,
  alongside current agent state. A separate public RTC audio stream measures
  input without changing the STT/VAD stream. Samples are consumed and discarded;
  no raw microphone waveform is stored or transmitted as diagnostics.
- Speech-handle interruption eligibility, microphone mute/unmute, input end/error,
  and the existing speech detection, transcript, reply and output events.

This distinguishes “browser captured no signal”, “browser sent but server did
not receive”, and “server received signal without speech detection” on the next
real device session. It does not automatically diagnose AEC, infer that noise is
speech, take over the microphone, or silently restart the user's capture.

The content-free meter has a regression for scalar-only output and resetting
quiet windows; the VM passes **57 plugin + 7 companion tests**, builds and type
checks. The repeated-interruption runner also verifies actual browser input
counters advance and server levels reflect the injected speech after deployment.
Detailed sanitized evidence is in [the evidence record](evidence/jarvis-voice-quality-2026-11-15.json).

The [output-quality runner](probes/jarvis-output-quality.mjs) uses the same
JARVIS_PLAYWRIGHT_MODULE, JARVIS_CHROME, JARVIS_REVIEW_URL and JARVIS_AUDIT_DIR
variables as the existing audit. Transcribe its `browser-known-passage.wav`
through `bb voice transcribe` and compare with the known passage; received energy
alone is not intelligibility. The interruption runner requires first.wav,
second.wav and third.wav generated from the lighthouse/mountain/forest requests
recorded with the private evidence; set JARVIS_EXPECT_INPUT_METRICS=1 for the new
telemetry assertions. Both runners close their browser and conversation.

Stable BB remains unchanged. Only the owned staging VM and restricted staging
relay have new code. Shared Alfred credentials remain on their owning host.
