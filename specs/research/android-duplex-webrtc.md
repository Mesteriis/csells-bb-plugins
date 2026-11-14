# Android duplex voice: WebRTC implementation research

Date: 2026-11-14. Question: can Jarvis use a proven browser voice transport to keep microphone capture and car-speaker output active at once? This is source research and spike design, not physical-device acceptance. No services were changed by this investigation.

## Finding

Use a real remote WebRTC audio track as the next controlled experiment. Jarvis currently fetches synthesized PCM, wraps a complete sentence as WAV, and plays local media while separately capturing the microphone. Pipecat and LiveKit instead put microphone uplink and bot downlink into peer connections and attach the received track to a media element. That is a materially different path worth testing. It does **not** guarantee a fix: LiveKit's own browser issue tracker contains Android Bluetooth routing failures in its agent playground.

Do not promise that changing to LiveKit, adding Opus, or switching to a MediaStream alone overrides Android's routing decisions. Also do not describe a microphone-off fallback as full duplex.

## Source coverage and pinned implementations

Inspected these repositories directly, not only their marketing documentation:

- Pipecat client transports commit `09956702aea9d01ee46cebbfcc9911d913e360b9`, cloned to `/tmp/jarvis-duplex-research/transports`.
- LiveKit JS commit `15ca1f39f0eded2b4ce2f525a7dcbcf6e7e3b9c7`, cloned to `/tmp/jarvis-duplex-research/livekit`.
- Pipecat server main resolved to `1bc2e37b15566cd34bb6941a335ce09c3bbbab8c`. Read the raw server transport source and verified the branch head with git.

### Pipecat

[SmallWebRTC client implementation](https://github.com/pipecat-ai/pipecat-client-web-transports/blob/09956702aea9d01ee46cebbfcc9911d913e360b9/transports/small-webrtc-transport/src/smallWebRTCTransport.ts) creates an audio `sendrecv` transceiver, places the local microphone track on its sender, and handles incoming remote tracks. It performs offer/answer signaling separately from media and handles ICE/reconnection. Client and server transport implementations must match.

Its default device manager is [DailyMediaManager](https://github.com/pipecat-ai/pipecat-client-web-transports/blob/09956702aea9d01ee46cebbfcc9911d913e360b9/lib/src/media-mgmt/dailyMediaManager.ts), instantiated with its local WAV player and recorder disabled. Device initialization goes through Daily's camera/audio device-management layer, and selected microphone changes replace the existing sender track. Consequently, adopting this package is more than copying a few raw getUserMedia calls; it already incorporates device lifecycle handling.

The [basic client example](https://github.com/pipecat-ai/pipecat-client-web-transports/blob/09956702aea9d01ee46cebbfcc9911d913e360b9/examples/basic-js/client/src/app.ts) binds the bot's received audio track to the audio element's `srcObject` using a MediaStream. Local microphone audio is metered but not played back. Do not accidentally attach local capture to the speaker in a duplex spike.

The [server audio track](https://github.com/pipecat-ai/pipecat/blob/1bc2e37b15566cd34bb6941a335ce09c3bbbab8c/src/pipecat/transports/smallwebrtc/transport.py) divides PCM into 10 ms frames, emits silence when idle by default, advances sample timestamps continuously, and paces frames in `recv()`. Incoming audio can be resampled for the processing pipeline. Reuse these timing and lifecycle contracts rather than inventing a sentence-file queue. Its enqueue future indicates that frames were consumed by the outgoing track, not that a physical speaker played them.

Pipecat's [transport guide](https://docs.pipecat.ai/client/concepts/choosing-a-transport) recommends WebRTC for browser voice because it supplies media timing, jitter handling and network behavior that a custom reliable byte stream must otherwise rebuild. SmallWebRTC is its self-hosted option; Daily and LiveKit add transport infrastructure. This supports WebRTC architecture selection but supplies no evidence of compatibility with Chris's specific car/headset combination. The guide's broad statement about echo cancellation and arbitrary streams should not be read as saying getUserMedia constraints cease to exist outside WebRTC.

### LiveKit

[RemoteAudioTrack.attach](https://github.com/livekit/client-sdk-js/blob/15ca1f39f0eded2b4ce2f525a7dcbcf6e7e3b9c7/src/room/track/RemoteAudioTrack.ts) normally attaches the received track to an HTML media element. The underlying [track attachment](https://github.com/livekit/client-sdk-js/blob/15ca1f39f0eded2b4ce2f525a7dcbcf6e7e3b9c7/src/room/track/Track.ts) manages the MediaStream, mute state and playback lifecycle. If an AudioContext is supplied, the remote track instead connects into a Web Audio graph and the element is silenced to avoid duplicate audio. [Defaults](https://github.com/livekit/client-sdk-js/blob/15ca1f39f0eded2b4ce2f525a7dcbcf6e7e3b9c7/src/room/defaults.ts) disable Web Audio mixing. Therefore, the first LiveKit-like spike should retain default media-element playout rather than reintroducing Jarvis's custom output graph.

[StartAudio](https://docs.livekit.io/reference/components/react/component/startaudio/) addresses rejected autoplay through a user gesture. It does not claim to repair Bluetooth routing when the browser already reports playing.

[LiveKit issue 1507](https://github.com/livekit/client-sdk-js/issues/1507) reports reproducible Bluetooth failures across several Android device/headset combinations in actual LiveKit browser agents, including wrong output or a switch away from Bluetooth. Other combinations worked. The issue was closed as not planned in March 2026; later comments do not establish a fix. This is a user-reported upstream issue, not a controlled diagnosis of Jarvis, but it rules out treating WebRTC as a universal routing guarantee.

## Ordered spikes and decision gates

1. **Local routing comparison.** On a standalone staging page, compare the same known Alfred clip with (a) no mic, (b) active mic plus WAV, and (c) active mic plus a real received track from a pair of local RTCPeerConnections. Attach only the receiver's remote track to the output element. Keep capture enabled throughout (b)/(c). A local peer pair removes the model, remote server and internet media path from the experiment while exercising RTP playout. It is a diagnostic routing experiment, not a substitute for VM-to-phone acceptance.
2. **Device-selection comparison.** Repeat the failing case with each actually enumerated microphone input, particularly a distinct phone microphone if exposed. Do not infer labels or fabricate an output picker. Record which requested constraints were actually granted. A browser's available inputs and output control vary; lack of exposed devices is a result, not permission to guess.
3. **Real server media.** If (c) works, run matching SmallWebRTC client/server on the disposable VM. Send microphone RTP to the real processing pipeline and stream actual Alfred PCM into the outgoing paced track. Keep one active session and persistent receiver track. Verify simultaneous speech capture during bot audio, cancellation of old output, and device reconnect.

The existing HTTPS BB Connect/SSH port route carries signaling and HTTP data; that does not establish UDP media connectivity from a cellular phone to a private NAT VM. Validate ICE candidates and the selected pair. If direct reachability fails, use a real authorized TURN service or a supported existing transport service; do not disguise a local loopback pass as a successful internet deployment. STUN discovery alone is not a guarantee of reachability.

## Measurements and acceptance

Record user gesture, capture acquisition, granted settings, local track enabled/muted/readyState, ICE/peer state, selected candidate transport, outbound and inbound packet counters, media playing/timeupdate, and interruption cleanup. Keep device event time and server receipt time separate.

Use [WebRTC statistics](https://www.w3.org/TR/webrtc-stats/) to distinguish delivery stages: inbound bytes/packets show transport arrival; audio energy/sample counters show decoded signal; interval deltas of jitter-buffer delay divided by emitted count estimate buffering. Audio playout statistics, where implemented, add another stage. None of these proves the car speakers were audible. Require Chris's audible confirmation while speaking into an active microphone, with no late replay after an interruption.

Every variant must stop capture tracks, close both peer connections, pause and detach the audio element, and close any source AudioContext before the next trial. Otherwise retained audio routing from a previous variant confounds the result. Use the same clip, device, browser, Bluetooth connection and volume for comparison. Repeat a passing duplex case, then verify the actual full Jarvis pipeline. A half-duplex result is a fallback only and does not meet the stated requirement.
