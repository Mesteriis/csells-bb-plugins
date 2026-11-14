# Jarvis

Implementation in progress. The initial panel observes visible top-level BB
sessions and delegates work to a configured BB project, environment and provider.
It persists operation identities before dispatch, refuses automatic replay after
uncertain delivery, binds decisions to exact pending approvals, and limits Stop
to delegated tasks and their descendants. Idle is not verified task success.

Requires BB0.49+ and Plugin SDK0.6.132. Build with `npm ci`,
`npm run typecheck`, `npm test`, and `bb plugin build .`. Install only into
the disposable staging instance until its candidate receives promotion approval.

Configure `projectId`, `environmentId`, and `providerId` for local operation.
The staging alternative uses `relayBaseUrl` and the secret `relayToken` setting.
Reload after settings changes. The relay URL must be loopback, transported through
the dedicated authenticated SSH tunnel. Never give the browser a relay credential.

`relay/main.mjs` takes an operator-owned private JSON configuration file containing
`sdkModule` (the installed public bb-app entry), `owner`, `projectId`, `environmentId`,
`providerId`, `journal`, `port`, `token`, and ISO `expiresAt`. Mint a new random
staging token; never reuse a BB/provider credential. Keep the file and journal in
private task storage outside this package. One relay process owns the journal;
after an unclean exit verify the recorded PID has exited before clearing its lock.
The relay automatically closes at credential expiry.

The initial UI has no microphone or speech activation. Conversation, sourced
memory, notification delivery, ordinary question routing, and scheduled initiative
remain planned. Approval transport has focused race tests but still needs actual
provider approval acceptance. Stop reports observed BB state separately from
external process verification; it does not promise arbitrary detached-process
termination or indefinite inhibition of other actors' future submissions.

Research, reuse decisions and staging constraints are in
[`specs/research`](../../specs/research/jarvis-bootstrap-decisions.md).
Copied source and notices are recorded in [PROVENANCE.md](PROVENANCE.md).
