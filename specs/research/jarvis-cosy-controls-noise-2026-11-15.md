# CosyVoice control and noise follow-up — November 15, 2026

Chris prefers CosyVoice but hears background noise and reported an error when
pressing What needs me during speech. This is preference, not voice acceptance.

The control failure reproduced in the real browser: startup retained the control
lane until playout completed, so an ordinary question command threw "Another
command is still running" before reaching interruption. Explicit controls now
preempt that lane. The same browser probe now interrupts the stock passage and
speaks the real question response. It passed again after the noise change.

Quiet-window analysis of the reference and historical native output found
approximately half their quiet-window spectral energy below 100 Hz, with peaks
at 70 and 50 Hz respectively. This is evidence of low-frequency content before
WebRTC, not proof that all of Chris's perceived noise comes from the reference.
Quietest windows may include speech; these are not calibrated SNR estimates.

A reversible staging-only CosyVoice filter applies `highpass=f=70,afftdn=nr=6:nf=-50`
after generation. The original reference is preserved. One identical-input test
reduced the quiet-window level from -43.75 to -46.26 dBFS, preserving 480,480 samples;
FFmpeg took 79 ms. This modest reduction needs subjective listening and does not
establish noise-free output or preserve the outstanding startup latency target.
The broker enables it with `JARVIS_COSY_CLEANUP=1` in its cleanup.conf drop-in.
CosyVoice is the staging default, labeled "light noise cleanup".

The final browser capture completed a known 53-word passage in 16.02 seconds
at Brisk, with no clipped samples or page errors and successful playout completion.
Raw capture remains outside the VM in the task's browser-cosy-clean directory.
BB configured transcription reproduced all 53 words exactly.
Companion build and all 16 tests passed. Both test browsers closed.
[Evidence](evidence/jarvis-cosy-controls-noise-2026-11-15.json).
