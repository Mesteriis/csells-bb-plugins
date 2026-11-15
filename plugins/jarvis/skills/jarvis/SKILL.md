---
name: jarvis
description: Use the Jarvis hands-free staging conversation and understand its exact-question and task-ownership boundaries.
---

# Jarvis conversation

Open the Jarvis navigation panel. Start Jarvis activates the microphone, briefs
recent work, and watches for changes. No typed prompt is required. Brief me,
Keep me updated, and What needs me are available after connecting. Use text
provides a separate text-only connection when voice is unavailable. It requires
the same conversation ownership; it never silently takes over another device. Voice commands and
staging setup are documented in the plugin README.

Answers target the exact question currently presented by Jarvis. Changed
questions are revalidated before delivery; text answers bind the displayed
question. Transport delivery alone never proves that a question was heard. Approvals require an explicit decision for that action;
thread output and model judgments cannot authorize them. Watching is read-only
unless Chris separately authorizes directed replies. The staging default permits
mutations only on task-owned work.

An uncertain dispatch or answer is not a failed dispatch. Reconcile its BB state;
do not launch replacement work or repeat an approval as an automatic retry. An
idle session is not verified success, and a stop receipt is not proof of external
process termination. Barge-in stops speech; “Jarvis, stop” also requests stop for
Jarvis-owned work and descendants.

Keep this candidate in the registered disposable VM. Never print or copy relay
credentials into prompts, browser storage, source control, or evidence. Preserve
actual voice-path evidence, including its test-input limitations. Do not claim
physical microphone or driving acceptance from browser replay. Do not promote
without approval of the actual staged candidate.
