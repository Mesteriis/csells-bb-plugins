# Hosted TTS integration: implementation and credential gate

**Superseded direction:** Chris clarified that the task requires open-source, self-hosted speech engines. The hosted-provider activation steps and credential gate below are historical, not current next steps. The credential request is closed; no provider was activated. See [the corrected scope](jarvis-self-hosted-tts-scope-2026-11-15.md).

Status on 2026-11-15: Cartesia/Inworld integration implemented and built in the
disposable staging VM. **Neither hosted provider has synthesized speech in this
candidate yet.** Dedicated API keys are missing. The secure BB request is pending;
Dashlane password and secure-note searches returned no entries for either provider
or ElevenLabs. No account, subscription or provider purchase was created.

## Implemented

- Official Cartesia and Inworld Node plugins pinned at 1.10.0, matching Agents.
- Server-owned voice catalog with stock Daniel and Dennis profiles, a pinned
  Cartesia snapshot, and Inworld TTS-2 with stable delivery.
- Voice selection and Brisk (1.25) / Faster (1.4) synthesis pace before Start.
  Controls stay locked during conversations; session diagnostics identify the
  chosen provider/model/voice/rate. No browser playback-rate modification.
- Both normal model replies and proactive briefings/questions use the SDK TTS
  path. The legacy Alfred override is a separate explicit compatibility path.
  A configured hosted provider never silently falls back to Alfred.
- Missing credentials disable that voice in the UI and cause a server-side 503
  before session ownership is acquired. Text controls remain independent.
- SDK synthesis timing, audio duration, character counts, streaming/cancellation
  metadata; explicit provider connection cleanup when a conversation closes.
- Existing browser audio and repeated-interruption probes accept provider/rate
  choices. Interruption reports now distinguish their functional 1.5-second
  regression threshold from the **unchanged 250ms acceptance target**.

Operator configuration is in [the companion README](../../plugins/jarvis/voice/README.md)
and [speech.example.json](../../plugins/jarvis/voice/deploy/speech.example.json).
The example file is the `speech` member of the existing private configuration,
not a replacement for its LiveKit credentials.

## Verification actually performed

On the actual disposable VM, Jarvis type checking/builds and **57 plugin + 12
companion tests passed**. The new tests exercise credential/selection boundaries,
both SDK provider constructors, inherited synthesis routing, proactive question
speech, and legacy operation without a configured SDK TTS. Constructor tests use
test-only credential strings and perform no network synthesis; they are not
provider acceptance.

The real BB browser panel, real director model and retained local Alfred service
completed the known 53-word passage at requested speed 1.25: **11.560 seconds,
275.09 words/minute, zero clipped samples**. BB's transcription returned all 53
words, unchanged apart from surrounding whitespace. This is a compatibility
regression and brisk-rate baseline, not proof that background fuzz is resolved.

Three successive generated-microphone interruptions during different responses
stopped decoded output after **625, 669 and 774ms**. Each produced a transcript
and relevant replacement answer through the real model. Browser upstream counters
advanced and server input telemetry reflected speech. All three **miss the 250ms
target**. This is desktop/generated-input evidence, not Android/car qualification.

Temporarily configuring both real hosted profiles without keys exercised the
actual VM/browser failure path: two unavailable voice choices, disabled Start,
no automatic Alfred fallback, a server 503 for Cartesia, and working text-only
session controls. The phone-width screenshot was inspected; no horizontal
overflow or page errors. The prior explicit local configuration was restored
afterward. All task browsers closed; companion health reports sessions 0.

Sanitized results: [evidence JSON](evidence/jarvis-tts-integration-2026-11-15.json).
Private source rollback archive, recordings, screenshot, detailed event logs and
VM build output are outside the VM in the task's `tts-comparison-20261115` artifact
directory. Stable BB and the shared voice service were not changed. Only the
owned staging relay's Alfred request was restored to 1.25; it is still the active
voice while credentials are pending.

## Next gated work

When the secure credential form completes, install its dedicated keys into the
VM's protected systemd EnvironmentFile, add the example speech configuration, and
restart the owned companion after checking there is no active conversation.
Never print key values. This request explicitly describes the keys as candidate
credentials to be installed in that VM. Retire them with staging.

Run Cartesia and Inworld at both pace presets through the existing browser probes,
with microphone on and off, plus the repeated-interruption regression. Measure
first audio, actual pace, clipping, omitted words and gaps; compare known-passage
provider audio with browser recordings and assess audible artifacts. Preserve
source/evidence outside staging. Do not claim a quality winner or a repaired
Android capture path before the relevant evidence exists. Keep the original
250ms target and physical-device gap visible.

## Dependency warnings investigated

`npm audit` reports nine affected entries, including three high-severity entries.
The underlying versions (`adm-zip` 0.5.18, `glob` 13.0.7, `minimatch` 10.2.6,
`onnxruntime-node` 1.24.3 and `@livekit/throws-transformer` 0.1.8) are unchanged
from the preceding commit; two added provider packages inherit the Agents warning.
Source inspection locates ZIP extraction in ONNX installation utilities and glob
usage in the throws-transformer build CLI. The candidate uses
`ONNXRUNTIME_NODE_INSTALL=skip` for optional CUDA downloads and does not accept
user ZIP archives or run that CLI on user glob patterns. This limits the identified
exposure; it does not remove the vulnerable dependencies.

Do not apply `npm audit fix --force`: its suggested remediation downgrades the
pinned LiveKit packages and breaks their matching-version contract. Track a
compatible dependency update separately, owner this task, next check 2026-11-16.
Builds and CPU inference passed on the actual VM despite local npm's install-script
approval notices. The local Node 26 plugin builder also reports a module.register
deprecation; the VM's supported Node 24 build passes without that warning.
