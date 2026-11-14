# Android duplex routing spikes

2026-11-14. These experiments isolate the browser/Android audio boundary. They do not declare the reported car-audio bug fixed.

## Latest evidence

The latest Android trace has nonzero synthesized PCM and a visible page. Native media reports playing within roughly 8–23 ms, but a 1.856-second clip fails to reach ended and times out after about 12.4 seconds. Capture continues. Chris confirms audible output with capture off and failure with capture on. Earlier output arrived minutes late. This supports investigating capture-dependent routing/rendering rather than adding another synthesis retry. Browser playing is not acoustic proof.

Primary-source investigations:

- [Chromium/Android routing and capture effects](android-duplex-routing.md): pinned Chromium source, mode changes, stream creation order and phone versus desktop feature gates.
- [Pipecat/LiveKit transport implementations](android-duplex-webrtc.md): pinned client/server code, persistent received-track playout, paced audio, known Android Bluetooth limits and network requirements.

## Executable experiment

Source: `plugins/jarvis/spikes/duplex-page.mjs`, with a known Alfred WAV embedded in `duplex-voice.mjs`. The clip is the task's previously synthesized “Jarvis, what needs me” test input from the actual configured Pocket service, not microphone recording. The authenticated disposable VM serves it at `/api/v1/plugins/jarvis/http/duplex` through the existing BB Connect exposure.

| Mode | Controlled difference |
| --- | --- |
| mic-off | Media playback baseline with no capture |
| media-before-mic | Start native media, then acquire processed capture |
| media-after-mic | Acquire processed capture, then start native media |
| unprocessed | Keep capture active with all three processing constraints requested false; show actual settings |
| webrtc | Two actual RTCPeerConnections: microphone uplink, known Alfred downlink, received remote track attached to native media |

Additional matched controls: **jarvis-graph** opens the current-style 16 kHz microphone context with a silent worklet output connected to destination; **native-graph** uses the same graph at the device default rate. These distinguish capture graph/sample-rate changes from transport changes. The meter remains an analyser branch; no mic speech is rendered.

Each run lasts 12 seconds. A live RMS meter shows capture activity. Media position, granted capture settings and WebRTC sent/received byte counters are shown and forwarded as bounded metadata. Speak during playback; choose I heard Alfred or It was silent. Input labels are shown locally after permission, but IDs/labels and audio are not uploaded. Each trial stops tracks, closes peer connections and contexts, pauses/detaches output, and revokes object URLs. The stop control also tears down in-flight trials.

The WebRTC spike keeps both peers in the same browser intentionally. This removes internet media reachability and the model from the routing comparison while exercising real RTP sender/receiver tracks. It is not a remote VM WebRTC session and is not end-to-end Jarvis acceptance. Mic input is not played back to the user.

## Decision gates

1. If WebRTC is audible while capture remains live, use the Pipecat-style persistent remote-track path as the integration candidate. Next validate an actual VM endpoint and cellular ICE/TURN reachability, not just HTTPS signaling.
2. If creation order alone changes the result, reproduce with fresh outputs and a live input before changing production lifecycle code.
3. If only unprocessed input works, validate realized settings, intelligibility, speaker echo and false barge-ins. Do not silently disable echo cancellation in the product.
4. If none work, test exposed microphone choices. Android input selection may also change the output route. A native Android communication-device bridge remains a separate architectural option; no browser-only guarantee is justified.

A successful spike must retain input while output is audible. Microphone-off or alternating capture/playback is not a pass. Before adoption, verify actual Jarvis STT, model, streamed response, interruption and reconnect using the chosen transport on this phone/car combination.

## Agent verification

The automated browser harness loads the actual VM endpoint with a generated test microphone MediaStream, exercises all seven modes, checks media advancement and live capture RMS, and verifies RTP bytes in both directions for WebRTC. This verifies the spike apparatus and transport plumbing; it does not emulate Android Bluetooth. Results are recorded in `evidence/jarvis-duplex-desktop.json` after the run. The initial embedded-script syntax failure was reproduced and fixed before offering the page for device testing.


## Phone result and focused follow-up

Chris supplied the exported results and reported that WebRTC seemed to be the only audible case, with uncertainty caused by the confusing matrix UI. The [sanitized summary](evidence/jarvis-duplex-phone-summary.json) shows WebRTC playback advancing to 8.001 seconds, 30,338 outbound microphone bytes and 27,477 inbound audio bytes, with active microphone RMS. Microphone-first native media advanced only to 238 ms, and unprocessed capture/native media to 255 ms. This supports WebRTC as the leading path; it does not make the subjective report more certain than Chris stated. Before-mic playback varied, and several trials were manually superseded rather than run to completion.

The default page is now a one-button guided check, with the technical matrix collapsed. It tests **webrtc-jarvis**: the same two-peer RTP path with a 16 kHz capture worklet configured with zero outputs. Capture sample counts verify the worklet keeps running without a silent speaker connection. After 12 seconds the UI asks whether audio and microphone worked together. This deliberately tests the proposed capture arrangement before changing the full assistant. The worklet itself counts frames; it does not yet run Jarvis STT or semantic endpointing. Integration acceptance is still required.

The registry inventory search found no service explicitly identified as a TURN or LiveKit deployment; matches were machine/voice records with incidental references. A real remote-media endpoint still requires discovery/provisioning and verified ICE reachability. The local peer spike does not establish that infrastructure.

The focused guided-page desktop run passed: 10.996 seconds of media advancement, 44,487 bytes sent and 36,676 received, live microphone RMS 0.071, and 185,984 capture samples at 16 kHz. The advanced controls start collapsed; the result question appears after the trial; there were no page errors or mobile-width overflow. See [guided harness evidence](evidence/jarvis-duplex-guided.json). The microphone was generated by the test harness, so the realized processing settings in this desktop result do not establish Android capture settings or acoustic performance.
