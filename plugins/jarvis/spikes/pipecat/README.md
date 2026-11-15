# Pipecat round-trip spike

Disposable candidate only. Question: can a persistent WebRTC call carry real Jarvis input/output and spoken interruption while capture stays live?

The authenticated BB routes `/pipecat`, `/pipecat-ice`, and `/pipecat-offer` serve the page and proxy loopback4844. `server.py` uses Pipecat SmallWebRTC, Silero VAD, and output queues. It adapts the existing restricted relay on4842 for real STT/Jarvis/Alfred and Smart Turn on4843. No new model credentials or raw-audio persistence. Start does not take over another audio owner.

Runtime: Python3.13; Pipecat source pinned at `1bc2e37b15566cd34bb6941a335ce09c3bbbab8c` with `[webrtc]`, plus aiohttp and fastapi. Install in an isolated venv, then run `python server.py`. Existing relay and turn services are required. Deployment and resolved dependencies are preserved in the task staging evidence directory; this is not a standalone production installer.

TURN credentials are HMAC-issued for five minutes from the candidate-only `/home/tester/jarvis/turn-secret`. Set `JARVIS_TURN_URL` to the reachable TCP TURN URL. Default is the private test tunnel `turn:127.0.0.1:4845?transport=tcp`; it does not work on a user's remote phone. Coturn restricts peer destinations to the candidate VM, quotas to four allocations and relay ports49160–49163. Only TCP3478 needs public forwarding because both the TURN relay and Pipecat peer terminate in this VM. Chris approved temporary TCP3478 forwarding on2026-11-14; it is installed through Dragon to the candidate until2026-11-18T23:59:59Z. The running candidate overrides JARVIS_TURN_URL with the verified public address; the source default remains a private development tunnel.

The UI has Start, What's going on, Stop speaking, and End. Microphone speech goes through the same real director as the main plugin. Interrupt cancels the active adapter task, broadcasts Pipecat interruption to clear pending output, and cancels the director generation. Capture remains active. Output pacing bounds application queue growth. The probe keeps the audio track alive; it does not close it on each interruption.

Limits: speech-end analysis and STT use existing utterance adapters, not streaming STT; no false-interruption resume; no unsolicited watch polling; no word-accurate heard-text alignment; generated completion is not reported as physical playback or used to mark questions heard. Captions explicitly bind displayed questions. A substring echo guard rejects suspected self-speech, but this is not acoustic qualification. Reconnect currently requires End/Start. Actual Android/car and cellular verification remain separate. Do not promote this prototype as the completed conversation implementation.

See `specs/research/jarvis-pipecat-spike.md` for evidence and remaining acceptance.
