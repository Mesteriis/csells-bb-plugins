# First integrated LiveKit candidate

Authorized by Chris on 2026-11-15 after the successful Android spike.
Stable stays unchanged; the actual candidate runs in disposable staging.

Deliver the BB panel with Start/briefing, automatic thread updates and exact
questions, directed answers, typed fallback, task visibility, delegation/steering,
separate speech/work stops, and observable recovery. Reuse LiveKit's media and
turn handling. Preserve question binding, ownership and BB permission checks.

Implementation sequence:
1. Move the successful TypeScript companion into the plugin's supported voice
   component. Embed its authenticated interface in the BB panel and package its
   installation, health and lifecycle configuration.
2. Connect quiet/watch/update delivery to the live conversation; prioritize user
   input, suppress stale updates and bind delivery completion to its speech handle.
3. Remove the redundant conversational classification round trip where safe;
   measure real model time-to-first-text/total and retain explicit action guards.
4. Exercise real owned workers: delegation, unsolicited question, directed answer,
   steering and verified scoped stop. Test typed input through the same contract.
5. Verify candidate builds, policy/recovery tests, rendered BB integration, real
   voice service round trips, restart/reconnect and desktop/phone acceptance.

Evidence goes in specs/research/. Existing research remains historical. A successful
integration does not complete memory, recall, scheduled reviews or external event
milestones. No production promotion follows without review of this candidate.

Current status: the integrated candidate is implemented and staged. Real BB
worker delegation, named automatic announcement, exact directed answer and
steering are verified; quiet mode, startup cancellation, service restart and
microphone-denied text/audio fallback are verified in the panel.
57 policy tests and three PCM framing tests pass on the VM. The initial measured
conversational response reached browser audio about four seconds after detected
speech end. See [integration evidence](../research/jarvis-livekit-integration.md).

Remaining qualification: extended Android/car conversations, route changes and
cellular recovery/background behavior. Initial briefing still waits for complete
model text, and companion provisioning remains operator-managed. These limits
are preserved as work; this candidate does not close the full Jarvis roadmap.
