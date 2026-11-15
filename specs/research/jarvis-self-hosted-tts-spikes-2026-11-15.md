# Jarvis self-hosted TTS comparison — 2026-11-15

This is a working staging comparison of Kokoro, Qwen3-TTS and CosyVoice3 through
Jarvis's real LiveKit/BB path. It is not production acceptance or a claim that
Android/car audio quality is fixed. No hosted TTS credentials are involved.

## Result

Kokoro and CosyVoice are enabled for listening review. Qwen can produce usable
recordings, but **failed the final continuous-conversation test**: after its first
successful audible interruption, the next synthesis exceeded LiveKit's 10-second
idle deadline and no next reply played. Its live profile is now visibly unavailable;
there is no silent fallback or recommendation to test that broken flow in the car.
The next Qwen experiment needs faster/incremental serving, not a larger timeout
presented as responsiveness. Its native/browser WAVs remain available to grade
voice character separately from this failed conversational result.

All browser passage captures below used the 1.4 preset and had zero clipped
samples. Transcription is a word-coverage proxy, not a subjective clarity score.

| Voice | Passage transcription | Captured pace | Final audible interruptions | Review status |
|---|---|---:|---|---|
| Kokoro George | 53/53, no edits | 221 words/min | 876 / 421 / 473 ms; next turns passed | Enabled; stock British |
| Kokoro Fable | 53/53, no edits | 251 words/min | Not separately rerun for this stock voice | Enabled; stock British |
| CosyVoice Alfred | 53/53, no edits | 197 words/min | 655 / 611 / 611 ms; next turns passed | Enabled; reference clone |
| Qwen Alfred | 53 recognized, one article substitution | 168 words/min including gaps | First stop 535 ms, then next-reply timeout | Disabled for live review |

The final 24 native samples comprise 12 Kokoro and six each Qwen/CosyVoice, at
1.25 and 1.4. Across these samples, native first-audio times were 1.35–10.62 seconds
for Kokoro, 1.44–3.77 for CosyVoice and 1.70–5.63 for Qwen. Request chunk boundaries
differ, so these are diagnostic ranges, not an apples-to-apples response ranking.
Qwen's total synthesis real-time factor was 1.77–2.19; it cannot sustain continuous
playback at those requested rates on this setup. CosyVoice ranged 0.76–1.08;
Kokoro 0.51–1.16 with observed CPU throttling.

The candidate passes 57 plugin and 16 companion tests, typecheck/build, phone-width
voice/grade rendering and grade download. All 75 plugin source files and seven
inference source files match their VMs. [Sanitized measurements](evidence/jarvis-self-hosted-tts-2026-11-15.json)
retain the failed Qwen run, numerical targets and per-WAV hashes. The engine
matrix is **not all green**. No subjective grades were invented and no stable
installation was promoted.

## Implementation and source

The plugin, director adapter and LiveKit companion remain TypeScript. A small
`LocalTTS` adapter consumes framed PCM from the official inference engines.
LiveKit owns sentence scheduling, playback and interruption. The adapter serializes
sentence requests, drops canceled queued work, disconnects active HTTP synthesis,
and treats cancellation as expected rather than a fatal pipeline error. Truncated
PCM is an error. There is no fallback to another engine or voice.

- [Kokoro source review](kokoro-local-spike-source.md): official Node/ONNX, FP32,
  two stock British voices (George/Fable); no Alfred cloning.
- [Qwen source review](qwen3-tts-local-spike-source.md): official 0.6B Base,
  BF16/SDPA CUDA in isolated Python; same authorized Alfred reference.
- [CosyVoice source review](cosyvoice-local-spike-source.md): official 0.5B
  CosyVoice3, fp16 CUDA in separate Python environment; same Alfred reference.
- [Runnable spike and reproduction notes](spikes/local-tts/README.md).

Each model finishes a bounded phrase before returning audio. This does **not**
prove incremental decoder streaming. Qwen speed uses FFmpeg `atempo` once per
phrase. CosyVoice uses its native nonstreaming speed parameter (its streaming
path ignores speed). Kokoro uses its native speed. The selector offers 1.0,
1.25 and 1.4, defaulting to 1.25; only the latter two were sampled in this matrix.

The backend prepares and warms the selected engine before starting the room.
Only one GPU engine fits at once. Changing engines may take several seconds;
normal turns reuse the loaded model. A hard timeout bounds hangs. Canceling
playback does not instantly stop upstream GPU computation: the current phrase
can drain while its obsolete output is discarded.

## Real staging and safe capacity reclamation

Chris authorized retirement of an older Jarvis staging VM after ownership and
archive verification. Lynx VM210 belonged to idle thread `thr_69yhhw5bmr`; the
fixture heartbeat had stopped advancing. The verified archive outside the VM
contains 28,989 entries (505,999,948 bytes), plus the prior evidence directory.
Archive extraction/read checks passed before deletion. VM210 disks, dedicated
cloud-init snippet, tunnel LaunchAgent and dedicated SSH authorization/key were
removed; its registry record is retired. Shared services and other VMs remain.

Replacement VM222 has 4 vCPU, 10 GiB RAM and 80 GiB disk. Other running guests
reserve 48 GiB; total reservations of 58 GiB leave 4,338 MiB host headroom.
Stopped VM220 cannot safely start alongside these reservations without releasing
capacity. The lab registry records that admission constraint.

The unallocated NVIDIA RTX 1000 Ada Laptop GPU (6 GiB VRAM) was exclusively
assigned to VM222. Intel i915 remains the host framebuffer; no host reboot or
console change was required. q35/ROM-on failed guest boot; original i440fx with
`rombar=0` booted and CUDA computation/inference passed. Guest driver 550.163.01
requires headers matching the actual cloud kernel before DKMS. Registry cleanup
must release the GPU and restore its original nouveau binding after ownership
verification. VM/tunnel/credential expiry remains November 18.

Jarvis/LiveKit remains in Dragon VM100; private loopback SSH tunnels connect the
inference VM. The existing authenticated review URL is unchanged:
https://csells-mac-mini--4840.getbb.app/plugins/jarvis/staff
The shared Pocket voice installation and its credentials were not modified.

## Evidence and failures retained

Private evidence root, outside both VMs:
`/Users/csells/.bb/thread-storage/thr_qpanimf2w7/jarvis-staging/local-tts-spikes`.
It contains WAV captures, per-sample timings, model dependency freezes, service
logs, browser diagnostics, source manifests and the VM210 archive. Original
reference audio/transcripts are private and excluded from Git.

Native samples use the same acknowledgement, 53-word passage and technical text.
Browser checks use actual model/STT/director/TTS services and decoded WebRTC
output with a synthetic microphone. They do not exercise physical Android capture,
car echo cancellation, route selection or listening quality.

The first Qwen run forced greedy decoding and stalled on a short acknowledgement.
Its 60-second watchdog terminated the worker; the error was not hidden. Restoring
the upstream sampling defaults completed the six-sample matrix. Low-memory CPU
trials and the first cold-load timeout are preserved as failed configurations,
not measurements of the final GPU setup.

The initial 20.8-second Alfred reference produced a CosyVoice browser sentence
of only 440 ms for seven words; transcription omitted that entire sentence.
The native passage also omitted four words near a forced phrase boundary.
Upstream warns about short synthesis relative to a long reference. The revised
comparison uses a 4.95-second complete opening excerpt with independently checked
transcript and preserves punctuation boundaries before the maximum phrase bound.
The revised native passage transcribes all 53 words. This is a tested improvement,
not proof that stochastic omission can never recur.

CosyVoice's optional wetext model download failed (403). The optional package is
omitted; upstream's built-in English normalization and number expansion remain.
Runtime/build setuptools is pinned to 80.10.2 for upstream `pkg_resources` imports.
Speaker/token reference extraction uses CPU ONNX; synthesis uses CUDA. No service
key was requested to work around the optional model download.

## Acceptance still required

Use Voice and Pace before Start Jarvis; End before changing voices. The optional
**Grade this voice** panel downloads clarity/character/pace/interruption ratings
with profile and diagnostics. An empty form or a successful download is not a
human grade. Voice character, fuzz, intelligibility in the car and repeated
physical interruption still require Chris's listening comparison.

The original 250 ms interruption objective remains unchanged. Functional tests
also report a looser 1,500 ms stop threshold so a functional pass cannot silently
be presented as meeting the original target. The broader 54-family Jarvis gap
analysis and unqualified acceptance scenarios remain open; this spike does not
close them.

## Reproducibility and measurement corrections

Kokoro's convenience export exposes a small wrapper, not Transformers.js's full
`env`. The final worker imports the actual Transformers.js environment, caches
under the fixed model revision and rejects an ONNX SHA-256 mismatch at startup.
The earlier cache's ONNX, config and tokenizer bytes match the pinned revision,
so earlier browser recordings did not use different weights. The published
[model pointer](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model.onnx)
and measured ONNX hash are
`8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb`.
Unsupported thread options were removed from that convenience API; the systemd
CPU quota is the enforced bound. On the expanded VM, native long-phrase latency
is worse than the original two-vCPU sample, with substantial cgroup throttling.
Do not extrapolate the earlier favorable native numbers to the final allocation.

The final interruption probe requires decoded non-silent audio immediately before
injection. Merely seeing “speaking” is insufficient: Qwen's between-sentence gaps
produced misleading 180/209 ms readings in the first test. Those readings are
retained but excluded from final interruption conclusions. A separate literal-word
assertion rejected a valid forest story that used “Bramblewood” and “trees” without
“forest”; the corrected test requires recognized topic, a new correlated reply
and substantial response text, with the actual stories retained for review.

A matching rate multiplier does not imply matching perceived pace across engines.
Browser passage duration includes internal synthesis gaps; native PCM duration
does not. The user should grade audible pace separately from the numerical preset.
