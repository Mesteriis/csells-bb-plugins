# Jarvis

Jarvis is a spoken chief of staff for BB threads. **Start Jarvis** opens a LiveKit
conversation, reads a briefing, and watches recently active work. **Use text**
opens a text-only connection to the same director, even if the voice companion
is unavailable. The page must stay open;
the initial tap grants browser playback/microphone access.

Ask “what’s going on?”, “what needs me?”, “switch to [thread title]”, “quiet”,
“resume updates”, “repeat”, or “skip”. Answer the current exact question by voice
or text. Approval requires “approve once” or “deny” for that pending action.
“Start a new task to …” delegates work through BB. Name an existing delegated
task to direct it. Interrupting speech leaves work running; **Stop delegated
work** (or “stop work”) requests cancellation of Jarvis-owned work. The task list
shows current BB status and stop receipts, not independently verified outcomes.

Watching covers the last 72 hours plus running/error/attention states. Quiet mode
retains changes; obsolete updates/questions are refreshed before delivery. One
device owns the conversation at a time. Uncertain mutations are not automatically
resent. Watching never grants control authority over unrelated threads.

## Development and staging

Requires BB 0.49+, Plugin SDK 0.6.132 and Node 24+ for the voice companion.

```sh
npm ci
npm run voice:install
npm run typecheck
npm test
npm run build
npm run voice:test
```

Voice requires the separate TypeScript companion, LiveKit Server and TURN
connectivity. Both voice and text require the restricted relay. The browser bundle
is embedded in the BB plugin build, so text does not depend on those media services. See [voice/README.md](voice/README.md)
for configuration and the example systemd service. Installation is currently
operator-managed; building the plugin does not provision these services.
Run the candidate only in disposable staging until Chris approves promotion.

Set the plugin's `relayBaseUrl` and secret `relayToken`. The URL reaches the
restricted host relay through a dedicated loopback SSH tunnel. Never expose that
credential to the browser. Local coordinator RPCs also accept `projectId`,
`environmentId` and `providerId`; conversation requires the relay. Reload after
settings changes.

`relay/main.mjs` takes a private JSON file outside source control: `sdkModule`
(installed public bb-app entry), `owner`, `projectId`, `environmentId`,
`providerId`, `journal`, `port`, fresh `token`, ISO `expiresAt`, `voiceBaseUrl`,
and `voiceAdminKeyPath`. Model access uses `poolBaseUrl` and `poolTokenPath` on
the owning BB host. The token is reread per request and never copied to the VM,
logs or launchd environment. The voice service admin key likewise stays on its
owning host. `allowWatchedReplies` defaults false; enable it only with explicit
authorization for directed replies to exact current questions in watched threads.
Other mutations remain task-owned.

One relay process owns its durable journal through an exclusive loopback port.
Supervise it with launchd `RunAtLoad`, `KeepAlive: {SuccessfulExit: false}` and
`ThrottleInterval: 5`, absolute Node/source paths and `BB_SERVER_URL`. Successful
credential expiry exits without a restart loop. Coordinator and conversation
journals are separate. Older browser audio and Pipecat experiments are historical;
the active panel uses LiveKit and does not require their Python services.

## Diagnostics and acceptance

Download diagnostics exports up to 2,000 in-memory browser events, retaining the
session ID after End. It includes state transitions, monotonic timing, microphone
settings, RTP counters and playback permission. It omits utterance text and
credentials. The companion journal records session-correlated stages and media
counters; host relay logs include model first-text/total duration. Conversation
text remains in the private director journal. No microphone recordings are kept.
This is operational tracing, not a completed analytics service or retention policy.

Displayed text may contain words interrupted before hearing them. Framework
playout acknowledgement consumes an update but does not prove physical audibility
or authorize a spoken approval. Exact question bindings and BB permission checks
remain authoritative. Native questions and Codex async question cards are
supported; unsupported forms are reported rather than guessed.

This remains a staging candidate. The LiveKit spike passed Chris's Android/car
trial; the integrated panel still needs device acceptance. Background/locked
screen behavior, route changes, prolonged cellular loss and long conversations
remain acceptance work. Stop receipts do not prove all detached processes ended.
Persistent personal memory, recall, schedules and external events remain later
milestones.

See [control regression evidence](../../specs/research/jarvis-control-recovery-2026-11-15.md),
[integration evidence](../../specs/research/jarvis-livekit-integration.md),
[spike evidence](../../specs/research/jarvis-livekit-spike.md), and
[code provenance](PROVENANCE.md).
