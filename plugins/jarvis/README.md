# Jarvis

Jarvis is a spoken chief of staff for your BB threads. **Start Jarvis** activates
continuous listening, watches recent work, and reads a briefing. **Brief me**,
**Keep me updated**, and **What needs me?** also work without entering a prompt.
The page must stay open; browser microphone permission requires the first tap.

Say “what’s going on?”, “what needs me?”, “switch to [thread title]”, “quiet”,
“resume updates”, “repeat”, or “skip”. Once Jarvis has read a current question,
speak your answer. Approval requires “approve once” or “deny” for that exact
pending action. “Start a new task to …” delegates work through BB. “Jarvis, stop”
stops speech and requests cancellation of Jarvis-owned work and descendants.
Barging in interrupts speech so you can steer the conversation.

Recently active means the last 72 hours, plus running/error/attention states.
Briefings distinguish agent-reported outcomes from independent verification.
One device owns the conversation at a time. Updates persist until played or
interrupted; failed audio is marked separately and can be retried. Quiet mode retains changes. The transcript remains available if
speech fails. Type instead supports chat, and Send answer binds a typed response
to the exact displayed question without requiring successful audio playback. Stale questions and uncertain answer deliveries are never retried
as new mutations automatically.

## Staging and development

Requires BB 0.49+ and Plugin SDK 0.6.132. Run `npm ci`, `npm run typecheck`,
`npm test`, and `bb plugin build .`. Install only in the disposable staging
instance until Chris approves the actual candidate for promotion.

The conversation candidate uses `relayBaseUrl` and secret `relayToken` settings.
The relay URL is loopback through the dedicated authenticated SSH tunnel. Never
give the browser a relay credential. Local coordinator RPCs additionally support
`projectId`, `environmentId`, and `providerId`; conversation requires the relay.
Reload after changing settings.

`relay/main.mjs` accepts a private JSON configuration outside the source tree:
`sdkModule` (installed public bb-app entry), `owner`, `projectId`, `environmentId`,
`providerId`, `journal`, `port`, fresh `token`, ISO `expiresAt`, `voiceBaseUrl`, and
`voiceAdminKeyPath`. For supervision, set `poolBaseUrl` and `poolTokenPath`
to the existing account-pool route and host-token JSON on the owning BB host.
The token is read per request to honor rotation; it is not copied into config,
launchd environment, logs or the VM. Inherited BB account-pool environment
variables remain supported for development. Pocket's admin key remains on its
owning host. `allowWatchedReplies` defaults false and must remain false until
Chris authorizes directed replies to existing watched threads. Watching itself
never grants write authority. All other mutations remain task-owned.

One relay process owns the durable journal through its exclusive loopback port;
journal access begins only after binding. No stale PID lock can prevent recovery.
Run it under launchd with `RunAtLoad`, `KeepAlive: {SuccessfulExit: false}` and
`ThrottleInterval: 5`, using an absolute Node path, task-owned source snapshot,
private configuration, and `BB_SERVER_URL` for the owning host. A crash restarts;
normal shutdown or credential expiry exits successfully without a restart loop.
The assistant journal is separate from the coordinator journal.

`turn/server.py` runs in the disposable VM on loopback 4843 using the pinned
requirements and separately provisioned Smart Turn v3.2 CPU model. Set
`JARVIS_TURN_MODEL` to that model. Expected SHA-256:
`2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f`.
Browser audio enters BB as bounded base64 JSON, is decoded server-side, and is
never written to disk. Alfred output is 24 kHz signed 16-bit mono PCM. The relay wraps each chunk with
a four-byte big-endian length; a zero-length completion frame follows successful
synthesis and lease release. The browser rejects EOF without that frame. Each complete sentence is wrapped as
24 kHz PCM16 WAV and played through a native audio element, separately from the
16 kHz microphone AudioContext. This currently buffers one sentence before playback.

## Voice diagnostics

The UI separates Preparing audio from native media playback and reports failures.
Test speaker · microphone off releases capture tracks and closes their context
before playing a fixed spoken check. It leaves listening off; Start Jarvis resumes it.
Retry audio resumes the audio context from a tap and repeats the current question
or latest reply. Playback acknowledgement is bound to the owning device lease,
delivery claim and conversational generation. It indicates native media completion,
not proof of acoustic output through a physical speaker.

Download diagnostics exports up to 200 browser events retained in local storage
for the last day. Metadata is also forwarded to the relay; relay diagnostics keep
at most 1,000 events in `<journal>.diagnostics`, filtered to the last day on read
and rewritten on the next event. Records contain only allowed stage/status values,
correlation IDs, durations/counts and browser/OS metadata. Device event time is
retained separately from upload receipt time; monotonic playback/command durations,
page visibility and microphone transitions help diagnose delayed audio. They exclude speech,
transcripts, arbitrary error strings, URLs and credentials. The separate assistant
journal still contains conversation text; these diagnostic limits do not establish
its retention policy. Browser diagnostics remain exportable during relay outages.
This is operational tracing, not a completed analytics/latency acceptance suite.

## Acceptance boundaries

This remains a staging candidate. Physical phone, Bluetooth, background/locked
screen, and driving acoustics require device acceptance; browser audio replay
cannot establish them. Native questions and Codex async question cards are supported, including sequential
answers to multi-question forms. Other provider forms and multi-select inputs that
cannot be mapped safely are reported explicitly. Read-only thread coverage is not permission
to control those threads. Stop acknowledgement does not prove arbitrary detached
process termination. Long-term personal memory and external schedules remain
separate planned milestones.

Research and integration evidence: [specs/research](../../specs/research/jarvis-hands-free-integration.md).
Reused code and licenses: [PROVENANCE.md](PROVENANCE.md).

A staging-only duplex spike is available at `/api/v1/plugins/jarvis/http/duplex`
when the relay is configured. End the normal conversation first. Its guided
check combines WebRTC playback with a zero-output 16 kHz capture worklet;
advanced comparisons are collapsed. This diagnostic route is not full Jarvis
integration or evidence of phone/car acceptance. Findings and next gates live in
[the duplex spike report](../../specs/research/android-duplex-spikes.md).
