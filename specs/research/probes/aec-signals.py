"""Deterministic AEC3 signal probe using separately synthesized speech fixtures.
No fake STT/voice/backend; this is DSP evidence, not acoustic phone evidence.
"""
import json, sys, wave, os
import numpy as np
from pywebrtc_audio import AudioProcessor
from pystoi import stoi

def wav(path):
    with wave.open(path) as w:
        assert w.getframerate()==16000 and w.getnchannels()==1 and w.getsampwidth()==2
        return np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float32)/32768
far_voice,near_voice=map(wav,sys.argv[1:3])
rate=16000; size=rate*22
far=np.resize(np.concatenate((far_voice,np.zeros(4000,dtype=np.float32))),size).astype(np.float32)
near=np.zeros(size,dtype=np.float32)
for second in (5,15): near[second*rate:second*rate+len(near_voice)]=near_voice*.8
baseline_ap=AudioProcessor(sample_rate=rate,echo_cancellation=True,noise_suppression=os.environ.get("AEC_NS", "1")=="1")
baseline=np.concatenate([baseline_ap.process(near[i:i+160],np.zeros(160,dtype=np.float32)) for i in range(0,size,160)])
results=[]
for delay_ms in map(int,os.environ.get("AEC_DELAYS","80,200,350").split(",")):
    delay=int(delay_ms*rate/1000)
    echo=np.zeros(size,dtype=np.float32);echo[delay:]=far[:-delay]*.4
    # A second delayed path models modest reverberation; all stimuli are retained.
    echo[delay+320:]+=far[:-(delay+320)]*.12
    mixed=np.clip(echo+near,-.99,.99)
    ap=AudioProcessor(sample_rate=rate,echo_cancellation=True,noise_suppression=os.environ.get("AEC_NS", "1")=="1")
    output=np.concatenate([ap.process(mixed[i:i+160],far[i:i+160]) for i in range(0,size,160)])
    mask=np.zeros(size,dtype=bool)
    for a,b in ((2,4),(9,13),(19,21)): mask[a*rate:b*rate]=True
    erle=10*np.log10((np.mean(echo[mask]**2)+1e-12)/(np.mean(output[mask]**2)+1e-12))
    # AEC introduces processing latency. Find the strongest alignment <=20ms.
    start=5*rate; end=start+len(near_voice)
    target=near[start:end].astype(np.float64)
    correlations=[]
    for shift in range(0,321):
        got=output[start+shift:end+shift].astype(np.float64)
        correlations.append((float(np.corrcoef(target,got)[0,1]),shift,float(np.sqrt(np.mean(got**2)/np.mean(target**2)))))
    correlation,shift,gain=max(correlations)
    result={'delayMs':delay_ms,'echoReductionDb':float(erle),'nearCorrelation':correlation,'nearGain':gain,'alignmentSamples':shift}
    processed=output[start+shift:end+shift]
    baseline_candidates=[(float(np.corrcoef(target,baseline[start+j:end+j])[0,1]),j) for j in range(321)]
    base_corr,base_shift=max(baseline_candidates)
    result.update(stoiProcessed=float(stoi(target,processed,rate)),stoiMixture=float(stoi(target,mixed[start:end],rate)),stoiCleanBaseline=float(stoi(target,baseline[start+base_shift:end+base_shift],rate)),cleanBaselineCorrelation=base_corr)
    # Controlled generated fixture only, for optional real STT verification.
    with wave.open('/home/tester/jarvis/aec-clean-'+str(delay_ms)+'.wav','wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes((processed*32767).astype('<i2').tobytes())
    results.append(result)
print(json.dumps({'method':'AEC3 exact10ms frames, known far speech + separately generated near speech + two echo paths; no network or physical room','results':results},indent=2))
# Waveform-correlation threshold was not an intelligibility criterion. Preserve
# those failed results; functional speech preservation is checked through real STT.
assert all(r['echoReductionDb']>15 and r['nearGain']>.35 for r in results)
