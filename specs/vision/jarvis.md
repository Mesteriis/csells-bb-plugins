# Jarvis for BB

Status: specified after product interview; implementation not started. Updated 2026-11-14.

## Purpose

Jarvis is Chris's personal assistant for his whole digital life. It manages that life through the agents and sessions provided by BB. BB remains the execution platform: projects, environments, providers, conversations, permissions, and worker histories remain visible there.

Chris speaks naturally to a responsive assistant, delegates work, follows its progress, answers questions and approvals, and stops work without hunting through conversations. Jarvis stays available while its agents work. The first delivery milestone is coordination of BB threads; the vision extends to home-lab operations, research, calendar, email, and other work through BB agents with the relevant skills and tools.

## Settled product choices

- Ship as a BB plugin, initially in an open BB session on desktop and phone.
- Explicit microphone activation starts a natural conversation. Closed-browser and locked-phone listening are outside the initial scope.
- Prioritize conversational quality. Cloud services are acceptable; reuse BB providers and speech capabilities where suitable. Local-only operation is not an initial constraint.
- Prefer Chris's Alfred voice from the registered Pocket service. The talker model is selected independently of the speech service's bundled model.
- Build the specifications from current main; inspect and selectively reuse the existing Jarvis branch rather than treating its behavior as the finished design.

## Experience

Jarvis stays responsive in conversation while BB agents carry out longer work. It can answer a second question while a task is running. Spoken updates are short; the screen carries details and links to the actual BB conversations. The assistant exposes listening, thinking, speaking, disconnected, and muted states alongside a view of working, blocked, and completed tasks.

The full ambition spans all seven blueprint capabilities: natural listening, durable personal memory, acting through tools, awareness of relevant context, selective proactive updates, visible work, and supervised workers. The initial experience focuses awareness and initiative on BB sessions. A later milestone adds explicitly enabled external events and scheduled follow-ups; the full vision remains incomplete until those journeys work.

After activating the microphone once, Chris can speak across repeated turns, pause to think, give a short answer, or correct himself without being cut off or losing words. Jarvis gives him room to finish and avoids treating background noise or its own voice as instructions.

The work view includes existing watched sessions as well as work Jarvis starts, with clear distinctions between observation and control. Questions reach Chris even when a worker asks in ordinary conversation. He can see what needs him without mistaking a pause in work for success.

Voice approval must resolve a specific pending BB interaction through the same enforced authority boundary used by the worker. A conversational “yes” must not become blanket permission. Cancellation must report whether actual work stopped; muting audio alone is insufficient. “Jarvis, stop” silences speech and cancels work delegated by Jarvis, including its owned descendants. Barge-in alone silences the reply and lets Chris steer the conversation. Unrelated sessions remain running unless Chris targets them explicitly. Cancellation cannot undo completed external actions.

## Authority, attention, and memory

Chris authorizes Jarvis to create, resume, and coordinate BB agents as needed within his request and existing permissions. Jarvis should not ask again for routine delegation. Observation of an unrelated session confers no authority to redirect it. Actions that exceed the request or require a BB/provider approval remain gated; the talker cannot grant itself broader permissions. External content, worker reports, and remembered facts are context, not authorization. Chris can tell what Jarvis may inspect, prepare, or change in each domain, including sending messages, spending money, changing infrastructure, publishing code, and operating physical security. Already-authorized work proceeds without repeated permission requests; unsupported enforcement is disclosed rather than presented as protection.

Watch all visible top-level sessions by default. Announce consequential completions, failures, and decisions requiring Chris. Routine progress stays on screen. Quiet mode collects updates until requested; microphone mute and quiet mode are independent. Hidden implementation workers are observed through their owning task so they do not produce duplicate announcements. Watching begins when enabled during onboarding; it does not require keeping a microphone open. With announcements enabled and playback available, consequential updates can be spoken while the microphone is off. Otherwise they remain visibly available, and quiet mode still suppresses unsolicited speech.

When Chris enables a particular external event or scheduled review, Jarvis notices relevant changes and follows up on commitments without needing a fresh spoken request. It explains why it spoke up, avoids stale or repeated reminders, and makes each source easy to pause or disable. A reminder does not confer new authority to act.

Automatically remember stable preferences, people, commitments, and decisions across conversations, with source links and controls to inspect, correct, and delete. Keep credentials in existing secret stores and temporary task details in BB sessions. Inferred preferences remain distinguishable from Chris's explicit statements. Memory is private to the user and only relevant material reaches a worker. Forgetting removes derived memory and retrieval entries; it does not silently rewrite the original BB history. Chris can also ask why a past decision was made, hear its original reasoning with a source, and distinguish that decision from a later change of mind. Missing history produces an honest limitation rather than invented recall.

## Conversational character

Jarvis is calm, concise, candid, and attentive. It leads with the result or the decision Chris needs, recommends a course when useful, and disagrees plainly with a reason. It acknowledges uncertainty and errors without fuss. Routine implementation detail belongs in the supporting view unless it helps Chris decide. These are editable defaults; Alfred is the preferred sound, while this behavior defines the character.

## Example journeys

- “Find out why my backups failed.” Jarvis starts an appropriately scoped BB worker using the home-lab skill, confirms delegation briefly, and remains available for another question. The worker's proposed repair and any approval return to the same conversation.
- “What needs me?” Jarvis summarizes pending decisions across visible sessions, presents their exact action cards, and applies each spoken answer to its corresponding live interaction.
- “Research the trip and draft an email.” Jarvis coordinates the work in BB, remembers agreed travel preferences with sources, and observes existing authorization boundaries before sending anything.
- “Why did we choose that last time?” Jarvis recalls the decision and reasoning, links the conversation, and notes any subsequent correction.
- An enabled commitment review or relevant external event prompts a timely update while Chris is not talking, with its source and an easy way to disable future updates.
- “Jarvis, stop.” Speech halts immediately, the backend cancels delegated work, and Jarvis shows which tasks stopped and any cancellation still unconfirmed.

## Quality and limits

The assistant must remain responsive during worker activity and must never claim a task succeeded just because its agent went idle. Report evidence, questions, and unresolved outcomes honestly. Prefer short, useful speech with richer visual details, keyboard access, captions, and equivalent typed controls.

The blueprint's approximately 800 ms response budget guides measurement and model selection. Quality first means comparing useful, correct replies as well as speed. Success means verified results on Chris’s actual household and digital tasks, with fewer avoidable interventions and irrelevant interruptions. Necessary approvals remain part of good performance. Fast speech and a worker’s completion claim alone do not establish usefulness. Earcons and canned acknowledgments do not satisfy conversational latency. Pocket Alfred is the preferred personal voice; the plugin must remain configurable without bundling private voice profiles or requiring other users to access Chris's lab.

Initial scope excludes ambient camera/screen surveillance, room satellites, background listening with BB closed, and direct implementations of calendar/email/home control inside Jarvis. Those domains are reached through BB agents. Later context sources and scheduled checks are enabled explicitly with a clear purpose; the full vision does not imply collecting everything.

## Source and existing work

The source blueprint is [awesome-jarvis/blueprint.md](https://github.com/csells/awesome-jarvis/blob/0378a6801dda9a3345ea7d4a53614f3cd410763f/blueprint.md), fetched 2026-11-14. Repository main was 0378a6801dda9a3345ea7d4a53614f3cd410763f; the blueprint's last change was be7360b7556b35fd4457ced1da7b9023f8475251. Its roughly 800 ms end-of-speech-to-first-audio budget is a design target, not a measured promise.

BB plugins base: main 1c66e84c37dbd3f4a396d42dc55ac1a1bcf159a7. All current local and fetched remote branches were inspected. Existing Jarvis is on origin/eli at 758fb4ecc82e5d9e0f3c24dcdceae40de02e8f0d, absent from main. It supplies a pinned Claude brain, microphone input, sentence-based Edge speech, an orb and stage, event batching, and a thread-management skill. Its interrupt RPC only mutes the brain follower; the skill can wait synchronously for workers; approval handling is agent-directed. These are gaps against the blueprint, not live-tested failure claims.

See [delivery plan](../plans/0001-jarvis.md).
