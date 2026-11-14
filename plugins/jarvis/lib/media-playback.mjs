// Native media playback uses the browser's media output path rather than the
// 16kHz microphone AudioContext. Acoustic audibility still needs device evidence.
export function pcmWave(pcm) {
  if (!pcm.length || pcm.length % 2 || pcm.length > 12000000)
    throw Error("Invalid PCM audio");
  const out = new Uint8Array(44 + pcm.length),
    v = new DataView(out.buffer);
  const text = (at, s) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true);
  v.setUint32(28, 48000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
export class MediaPlayback {
  constructor(audio = new Audio(), report = (_phase, _metadata = {}) => {}) {
    this.audio = audio;
    this.report = report;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
  }
  async play(pcm, signal) {
    signal.throwIfAborted();
    const audio = this.audio,
      url = URL.createObjectURL(
        new Blob([pcmWave(pcm)], { type: "audio/wav" }),
      );
    audio.src = url;
    audio.muted = false;
    audio.volume = 1;
    let cleanup = () => {};
    try {
      await new Promise((resolve, reject) => {
        const ended = () => {
          this.report("complete", { positionMs: audio.currentTime * 1000 });
          resolve();
        };
        const failed = () => reject(Error("Media playback failed"));
        const aborted = () =>
          reject(signal.reason ?? Error("Playback interrupted"));
        const running = () =>
          this.report("running", { positionMs: audio.currentTime * 1000 });
        const waiting = () =>
          this.report("waiting", { positionMs: audio.currentTime * 1000 });
        const timer = setTimeout(
          () => reject(Error("Media playback timed out")),
          pcm.length / 48 + 10000,
        );
        cleanup = () => {
          clearTimeout(timer);
          audio.removeEventListener("ended", ended);
          audio.removeEventListener("error", failed);
          audio.removeEventListener("playing", running);
          audio.removeEventListener("waiting", waiting);
          signal.removeEventListener("abort", aborted);
        };
        audio.addEventListener("ended", ended, { once: true });
        audio.addEventListener("error", failed, { once: true });
        audio.addEventListener("playing", running);
        audio.addEventListener("waiting", waiting);
        signal.addEventListener("abort", aborted, { once: true });
        Promise.resolve(audio.play()).catch(reject);
      });
    } finally {
      cleanup();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    }
  }
}
