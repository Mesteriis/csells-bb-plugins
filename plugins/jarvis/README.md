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
interrupted; quiet mode retains changes. The transcript remains available if
speech fails. Stale questions and uncertain answer deliveries are never retried
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
`voiceAdminKeyPath`. The host process inherits BB's account-pool URL/token;
provider credentials are not copied to the VM. Pocket's admin key remains on its
owning host. `allowWatchedReplies` defaults false and must remain false until
Chris authorizes directed replies to existing watched threads. Watching itself
never grants write authority. All other mutations remain task-owned.

One relay process owns the durable journal. Before removing a stale lock, verify
its recorded PID has exited. The relay expires automatically. Keep its process
supervised in task storage; restarting it requires the normal host BB model
connection. The assistant journal is separate from the coordinator journal.

`turn/server.py` runs in the disposable VM on loopback 4843 using the pinned
requirements and separately provisioned Smart Turn v3.2 CPU model. Set
`JARVIS_TURN_MODEL` to that model. Expected SHA-256:
`2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f`.
Browser audio enters BB as bounded base64 JSON, is decoded server-side, and is
never written to disk. Alfred output streams as 24 kHz signed 16-bit mono PCM.

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
