"""AEC3 on synchronized microphone/render-reference channels from the browser.

Channel0 is microphone, channel1 is the received remote track. Network jitter
acts on both together. Browser playback/Bluetooth delay remains for AEC3 to
estimate. No adaptive filtering or speech classification is implemented here.
Experimental: failed short-control preservation; not qualified for production.
"""
from collections import deque
from importlib.metadata import version
import time
import numpy as np
from pywebrtc_audio import AudioProcessor
from pipecat.frames.frames import InputAudioRawFrame
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection

if version('pywebrtc-audio') != '0.2.0+jarvis2':
    raise RuntimeError('This spike requires the pinned AEC3 build with10 delay filters')


class EchoInput(FrameProcessor):
    def __init__(self, event):
        super().__init__()
        self.event = event
        self.ap = AudioProcessor(sample_rate=16000, echo_cancellation=True,
                                 noise_suppression=True, auto_gain_control=False)
        self.pending = bytearray()
        self.history_far = deque(maxlen=200)
        self.history_near = deque(maxlen=200)
        self.before = self.after = self.reference_energy = self.samples = 0
        self.last_report = time.monotonic()

    def process_audio(self, block):
        channels = np.frombuffer(block,dtype='<i2').reshape(-1,2)
        near = np.ascontiguousarray(channels[:,0])
        far = np.ascontiguousarray(channels[:,1])
        self.history_far.append(far.astype(np.float32)[::4])
        self.history_near.append(near.astype(np.float32)[::4])
        clean = self.ap.process(near,far)
        self.before += float(np.sum(near.astype(np.float64)**2))
        self.after += float(np.sum(clean.astype(np.float64)**2))
        self.reference_energy += float(np.sum(far.astype(np.float64)**2))
        self.samples += len(near)
        if time.monotonic()-self.last_report >= 1:
            lag_ms=None; coherence=0
            if len(self.history_far)==200:
                reference=np.concatenate(self.history_far)
                capture=np.concatenate(self.history_near)[-2000:]
                corr=np.correlate(reference,capture,'valid')
                energy=np.convolve(reference**2,np.ones(len(capture),dtype=np.float32),'valid')
                score=np.abs(corr)/np.sqrt(np.maximum(energy*np.sum(capture**2),1))
                peak=int(np.argmax(score)); coherence=round(float(score[peak]),3)
                if coherence>.5: lag_ms=round((len(reference)-len(capture)-peak)/4)
            self.event('aec',referenceLagMs=lag_ms,referenceCoherence=coherence,
                       inputRms=round((self.before/self.samples)**.5/32768,5),
                       outputRms=round((self.after/self.samples)**.5/32768,5),
                       referenceRms=round((self.reference_energy/self.samples)**.5/32768,5),
                       captureChannels=2)
            self.before=self.after=self.reference_energy=self.samples=0
            self.last_report=time.monotonic()
        return clean.tobytes()

    async def process_frame(self, frame, direction):
        await super().process_frame(frame,direction)
        if direction==FrameDirection.DOWNSTREAM and isinstance(frame,InputAudioRawFrame):
            if frame.sample_rate!=16000 or frame.num_channels!=2:
                self.event('error',text='Paired microphone/reference audio was not negotiated. End and restart.',reason='aec-channel-format')
                raise RuntimeError('AEC requires stereo16k capture')
            self.pending.extend(frame.audio)
            output=bytearray()
            # Exactly160 interleaved stereo samples: no per-call padding/drift.
            while len(self.pending)>=640:
                output.extend(self.process_audio(bytes(self.pending[:640])))
                del self.pending[:640]
            if output:
                clean=InputAudioRawFrame(bytes(output),16000,1)
                clean.pts=frame.pts
                await self.push_frame(clean,direction)
            return
        await self.push_frame(frame,direction)
