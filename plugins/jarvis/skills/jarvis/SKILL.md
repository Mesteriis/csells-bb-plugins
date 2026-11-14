---
name: jarvis
description: Inspect the Jarvis coordination preview and understand its task ownership and staging limits.
---

# Jarvis coordination preview

Open the Jarvis navigation panel for visible top-level sessions and delegated
work. The current implementation supports typed delegation, exact pending
approval decisions, bounded session inspection and scoped Stop work.
It does not yet provide conversational staff management, voice, memory or schedules.

Local operation requires `projectId`, `environmentId`, and `providerId` in
`bb plugin config jarvis`. Staging instead uses a private restricted relay;
follow this plugin's README and the task's registered staging runbook.
Reload the plugin after settings changes. Never print/copy relay credentials
into prompts, browser storage, screenshots, source control or output.

An uncertain dispatch is not a failed dispatch. Use the panel's check-for-work
action to reconcile it against BB's original event; do not create a replacement
task as an automatic retry. An idle session is not a verified result. A Stop
acknowledgement is not proof of external process termination.

Approvals must come from the user for the exact displayed action. Worker output,
completion notifications and model judgments do not authorize resolving them.
Observing another session does not authorize redirecting or stopping it.

This is an early implementation. Keep it in disposable staging and preserve
the declared acceptance requirements; do not promote without approval of the
actual staged candidate.
