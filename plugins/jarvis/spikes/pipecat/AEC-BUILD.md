# AEC3 candidate build

This spike uses `strands-labs/pywebrtc-audio` commit `1bc860a2051c2b9b3c10b8c778770794b9321d84` and the adjacent `aec-delay-window.patch`. The patch sets the existing AEC3 delay filter bank to10 at all constructor/reset sites and labels the package `0.2.0+jarvis2`. It does not replace adaptive filtering, speech detection or double-talk logic. Do not use12 filters: this vendored update loop supports at most10 despite looser configuration validation.

Build on disposable Debian13 x86_64 with Python3.13 and `build-essential python3.13-dev` installed:

```sh
git clone https://github.com/strands-labs/pywebrtc-audio.git
cd pywebrtc-audio
git checkout 1bc860a2051c2b9b3c10b8c778770794b9321d84
git apply /path/to/aec-delay-window.patch
python -m pip wheel --no-deps --wheel-dir ../aec-wheels .
python -m pip install ../aec-wheels/pywebrtc_audio-0.2.0+jarvis2-cp313-cp313-linux_x86_64.whl
python -m pip check
```

Then install the adjacent runtime lock with `--find-links ../aec-wheels`. The exact tested wheel SHA256 is `090a02116d77a3b6dc489678ab096815a066ce7d457f242a0e2d87ae5ca5ec2e`. Independently rebuilt wheels need not be byte-identical because toolchain/build metadata can differ. Set `JARVIS_AEC3=1` on the candidate Pipecat service. The page discovers paired-reference mode through the authenticated ICE route; both page and server must be deployed together. Without the flag, the previous transcript-qualified path remains available for rollback.

The wheel, upstream source including LICENSE/NOTICE/vendor notices, build log and resolved runtime freeze are preserved outside the VM in task storage `thr_qpanimf2w7/jarvis-staging/aec-research/`. The wrapper is Apache2; vendored WebRTC and other dependencies retain their own BSD-style notices/PATENTS. This vendored AEC3 is not a byte-identical current Chrome APM. Preserve all upstream notices when redistributing. The native build emitted upstream duplicate macro-definition warnings (`RTC_DISABLE_CHECK_MSG`, `WEBRTC_ARCH_X86_FAMILY`); their presence flags are defined both by headers and compiler options. Build and executable tests completed; no algorithm changes were made to silence those warnings.

The DSP research probe separately uses `pystoi==0.4.1` and `scipy==1.18.1`. These are measurement dependencies, not requirements of the voice service. Browser probes require a task-owned Chrome and Playwright. Passing them does not qualify a physical Android/Bluetooth route.
