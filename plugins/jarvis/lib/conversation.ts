import { MediaPlayback } from "./media-playback.mjs";
import { readPcmFrames } from "./pcm-stream.mjs";
import { diagnostic } from "./diagnostics.mjs";
import { VoiceActivityDetector, rmsOf } from "./vad";
import { toSpeakable, SentenceStream } from "../speech";
import type { ConversationState } from "../conversation";
import { RealtimeTurnState } from "../vendor/qwen/realtime-turn-state.mjs";

type Command = (input: {
  action: string;
  clientId: string;
  requestId?: string;
  enabled?: boolean;
  takeover?: boolean;
  text?: string;
  playbackClaim?: string;
  presentedQuestion?: string;
  utteranceId?: string;
  status?: string;
}) => Promise<ConversationState>;
export interface VoiceView {
  active: boolean;
  listening: boolean;
  speaking: boolean;
  preparingAudio: boolean;
  thinking: boolean;
  hearing: boolean;
  error: string;
  caption: string;
  transcript: string;
  state: ConversationState | null;
}
const base = "/api/v1/plugins/jarvis/http/";
function encoded(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < data.length; i += 8192)
    binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(binary);
}
function joined(frames: Float32Array[]) {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}
function wav(samples: Float32Array) {
  const bytes = new ArrayBuffer(44 + samples.length * 2),
    v = new DataView(bytes);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    v.setInt16(
      44 + i * 2,
      Math.max(-1, Math.min(1, samples[i]!)) * 32767,
      true,
    );
  return bytes;
}

export class VoiceConversation {
  readonly clientId = crypto.randomUUID();
  private view: VoiceView = {
    active: false,
    listening: false,
    speaking: false,
    preparingAudio: false,
    thinking: false,
    hearing: false,
    error: "",
    caption: "",
    transcript: "",
    state: null,
  };
  private listeners = new Set<() => void>();
  private moduleAdded = false;
  private audio: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private mic: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mediaOutput: MediaPlayback | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private playback = new AbortController();
  private captureAbort = new AbortController();
  private closed = false;
  private polling = false;
  private lastSpoken = "";
  private captureDuringSpeech = false;
  private wake: WakeLockSentinel | null = null;
  private turns = new RealtimeTurnState();
  private frames: Float32Array[] = [];
  private preroll: Float32Array[] = [];
  private capturing = false;
  private checking = false;
  private silentFrames = 0;
  private captureId = "";
  private vad = new VoiceActivityDetector({
    frameMs: 32,
    onsetMs: 64,
    bargeOnsetMs: 160,
    hangoverMs: 320,
    minSpeechMs: 64,
    maxSpeechMs: 30000,
  });
  private traces: Record<string, unknown>[] = [];
  private diagnosticQueue: Record<string, unknown>[] = [];
  private flushing = false;
  private traceId: string = crypto.randomUUID();
  private playbackFailed = false;
  private utteranceId: string | undefined;
  private visibilityChanged = () =>
    this.trace(
      "page",
      document.visibilityState === "visible" ? "visible" : "hidden",
    );
  private rpc: Command;
  private trace(
    stage: string,
    phase: string,
    extra: Record<string, unknown> = {},
  ) {
    const ua = navigator.userAgent;
    const browser = ua.match(/(Chrome|Firefox|Safari|Edge)\/[0-9.]+/)?.[0];
    const event = diagnostic({
      stage,
      phase,
      clientId: this.clientId,
      requestId: this.traceId,
      generation: this.generation,
      utteranceId: this.utteranceId,
      clockMs: performance.now(),
      visibility: document.visibilityState,
      browser,
      os: /Android/.test(ua)
        ? "android"
        : /iPhone|iPad/.test(ua)
          ? "ios"
          : /Mac/.test(ua)
            ? "mac"
            : "unknown",
      ...extra,
    });
    if (!event) return;
    this.traces = [
      ...this.traces.filter((e) => Number(e.at) > Date.now() - 86400000),
      event,
    ].slice(-200);
    this.diagnosticQueue = [...this.diagnosticQueue, event].slice(-100);
    try {
      localStorage.setItem(
        "jarvis-diagnostics-v1",
        JSON.stringify(this.traces),
      );
    } catch {
      /* storage disabled */
    }
    void this.flushDiagnostics();
  }
  private async flushDiagnostics() {
    if (this.flushing || !this.diagnosticQueue.length) return;
    this.flushing = true;
    const events = this.diagnosticQueue.splice(0, 30);
    let delivered = false;
    try {
      const r = await fetch(base + "diagnostics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(5000),
      });
      delivered = r.ok;
    } catch {
      /* retained locally when the relay is down */
    } finally {
      if (!delivered)
        this.diagnosticQueue = [...events, ...this.diagnosticQueue].slice(-100);
      this.flushing = false;
      if (delivered && this.diagnosticQueue.length)
        void this.flushDiagnostics();
    }
  }
  exportDiagnostics() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, events: this.traces }, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "jarvis-diagnostics.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  constructor(rpc: Command) {
    this.rpc = rpc;
    try {
      const saved = JSON.parse(
        localStorage.getItem("jarvis-diagnostics-v1") ?? "[]",
      );
      if (Array.isArray(saved))
        this.traces = saved
          .slice(-200)
          .map((e) => diagnostic(e, e.at))
          .filter((e): e is NonNullable<typeof e> => e !== null);
    } catch {
      /* no saved metadata */
    }
  }
  getSnapshot = () => this.view;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<VoiceView>) {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn();
  }
  private fail = (e: unknown) => {
    this.trace("client", "failed", {
      errorKind: e instanceof Error ? e.name : "Error",
    });
    if (!this.closed)
      this.update({
        error: e instanceof Error ? e.message : String(e),
        thinking: false,
      });
  };
  async connect(listen: boolean, takeover = false, audioEnabled = true) {
    this.closed = false;
    document.addEventListener("visibilitychange", this.visibilityChanged);
    this.visibilityChanged();
    // Resume directly in the initial user gesture; never silently acquire a mic.
    this.trace("connect", "start");
    if (audioEnabled && listen) {
      this.audio ??= new AudioContext({ sampleRate: 16000 });
      this.audio.onstatechange = () => {
        const state = this.audio?.state;
        this.trace(
          "context",
          state === "running" || state === "closed" || state === "suspended"
            ? state
            : "interrupted-context",
        );
        if (state !== "running" && this.view.speaking) {
          this.playbackFailed = true;
          this.interruptLocal();
          this.fail(
            Error(
              "Audio was suspended. Tap Start Jarvis or Retry audio to resume.",
            ),
          );
        }
      };
      await Promise.race([
        this.audio.resume(),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                Error("Audio could not start. Tap Start Jarvis to retry."),
              ),
            4000,
          ),
        ),
      ]);
      if (this.audio.state !== "running")
        throw Error("Audio is suspended. Tap Start Jarvis to resume.");
      this.trace("context", "running", { sampleRate: this.audio.sampleRate });
    }
    const state = await this.rpc({
      action: "start",
      clientId: this.clientId,
      takeover,
    });
    this.update({ active: true, error: "", state });
    this.trace("connect", "ready");
    if (listen) {
      await this.listen();
      if ("wakeLock" in navigator)
        this.wake = await navigator.wakeLock
          .request("screen")
          .catch(() => null);
    }
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 2000);
  }
  async start(takeover = false) {
    try {
      await this.connect(true, takeover);
      const generation = this.generation;
      await this.rpc({
        action: "watch",
        clientId: this.clientId,
        enabled: true,
      });
      if (generation === this.generation && !this.capturing)
        await this.act("brief");
    } catch (e) {
      this.fail(e);
      await this.releaseMic();
    }
  }
  async act(
    action: string,
    extra: {
      enabled?: boolean;
      text?: string;
      presentedQuestion?: string;
    } = {},
    speak = true,
    requestId: string = crypto.randomUUID(),
  ) {
    let generation = this.generation;
    try {
      if (!this.view.active) await this.connect(false, false, speak);
      if (action !== "heartbeat" && action !== "next") this.interruptLocal();
      generation = this.generation;
      if (action !== "next") this.update({ thinking: true, error: "" });
      this.traceId = requestId;
      this.utteranceId = undefined;
      const commandStarted = performance.now();
      this.trace("command", "start");
      const state = await this.rpc({
        action,
        requestId: this.traceId,
        clientId: this.clientId,
        ...extra,
      });
      if (generation !== this.generation || this.closed) return;
      this.utteranceId = state.utterance?.id;
      this.trace("command", "complete", {
        durationMs: performance.now() - commandStarted,
        ...(state.utterance
          ? { utteranceAgeMs: Math.max(0, Date.now() - state.utterance.at) }
          : {}),
      });
      this.update({
        state,
        thinking: false,
        ...(state.utterance ? { caption: state.utterance.text } : {}),
      });
      if (speak && state.utterance) {
        this.playbackFailed = false;
        const played = await this.speak(state.utterance.text);
        if (generation !== this.generation) return;
        await this.rpc({
          action: "ack",
          playbackClaim: state.utterance.playbackClaim,
          clientId: this.clientId,
          utteranceId: state.utterance.id,
          status: played
            ? "played"
            : this.playbackFailed
              ? "failed"
              : "interrupted",
        });
      }
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    }
  }
  private async poll() {
    if (this.polling || !this.view.active || this.closed) return;
    this.polling = true;
    try {
      void this.flushDiagnostics();
      const state = await this.rpc({
        action: "heartbeat",
        clientId: this.clientId,
      });
      this.update({ state });
      if (
        !this.view.speaking &&
        !this.view.preparingAudio &&
        !this.view.thinking &&
        !this.capturing &&
        state.watch &&
        !state.quiet
      )
        await this.act("next");
    } catch (e) {
      this.fail(e);
      await this.stop();
    } finally {
      this.polling = false;
    }
  }
  interruptLocal() {
    ++this.generation;
    this.turns.advanceBoundary();
    this.playback.abort();
    this.playback = new AbortController();
    this.update({ speaking: false, preparingAudio: false, thinking: false });
  }
  async interrupt() {
    this.interruptLocal();
    try {
      await this.rpc({ action: "interrupt", clientId: this.clientId });
    } catch (e) {
      this.fail(e);
    }
  }
  async retryAudio() {
    try {
      await this.connect(false);
      await this.act("talk", { text: "repeat that" });
    } catch (e) {
      this.fail(e);
    }
  }
  async testSpeaker() {
    try {
      if (!this.view.active) await this.connect(false, false, false);
      await this.interrupt();
      await this.releaseMic();
      await this.audio?.close();
      this.audio = null;
      this.moduleAdded = false;
      this.trace("speaker-check", "start");
      this.update({ error: "" });
      await this.speak(
        "This is Jarvis's speaker check. The microphone is off. You should hear this through your selected media speakers.",
      );
    } catch (e) {
      this.fail(e);
    }
  }
  async speak(markdown: string) {
    if (this.closed) return false;
    const text = toSpeakable(markdown);
    this.lastSpoken = text;
    const splitter = new SentenceStream();
    const parts = [...splitter.push(text), ...splitter.flush()].flatMap(
      (part) => {
        const pieces = [];
        for (let i = 0; i < part.length; i += 1800)
          pieces.push(part.slice(i, i + 1800));
        return pieces;
      },
    );
    const generation = this.generation,
      signal = this.playback.signal,
      started = performance.now();
    let totalBytes = 0;
    this.mediaOutput ??= new MediaPlayback(new Audio(), (phase, metadata) => {
      this.trace("media", phase, metadata);
      if (phase === "running")
        this.update({ speaking: true, preparingAudio: false });
    });
    this.update({ speaking: false, preparingAudio: true, caption: markdown });
    this.trace("speech", "start");
    try {
      for (const part of parts) {
        const response = await fetch(base + "speech", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...this.mediaHeaders(),
          },
          body: JSON.stringify({ text: part }),
          signal,
        });
        if (!response.ok)
          throw Error(
            "Alfred voice is unavailable. Your response is still shown below.",
          );
        if (response.headers.get("content-type") !== "application/x-jarvis-pcm")
          throw Error("Voice protocol changed. Reload Jarvis.");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of readPcmFrames(response.body)) {
          if (!totalBytes)
            this.trace("speech", "first-byte", {
              durationMs: performance.now() - started,
            });
          totalBytes += chunk.length;
          size += chunk.length;
          if (size > 12000000) throw Error("Audio response exceeded its limit");
          if (generation !== this.generation || signal.aborted) return false;
          chunks.push(chunk);
        }
        signal.throwIfAborted();
        const pcm = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          pcm.set(chunk, offset);
          offset += chunk.length;
        }
        let energy = 0;
        const data = new DataView(pcm.buffer);
        for (let i = 0; i < size; i += 2) {
          const sample = data.getInt16(i, true) / 32768;
          energy += sample * sample;
        }
        this.trace("media", "ready", {
          bytes: size,
          rms: Math.sqrt(energy / (size / 2)),
          sampleRate: 24000,
        });
        await this.mediaOutput.play(pcm, signal);
      }
      this.trace("playback", "complete", {
        bytes: totalBytes,
        durationMs: performance.now() - started,
      });
      return !signal.aborted;
    } catch (e) {
      if (!signal.aborted) {
        this.playbackFailed = true;
        this.trace("playback", "failed", {
          bytes: totalBytes,
          durationMs: performance.now() - started,
        });
        this.fail(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? Error("Audio playback was blocked. Tap Retry audio.")
            : e,
        );
      }
      return false;
    } finally {
      if (generation === this.generation)
        this.update({ speaking: false, preparingAudio: false });
    }
  }
  async listen() {
    if (this.stream || !this.audio) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    for (const track of this.stream.getAudioTracks()) {
      track.onmute = () => this.trace("capture", "muted");
      track.onunmute = () => this.trace("capture", "unmuted");
      track.onended = () => {
        void this.releaseMic();
        this.update({
          error: "The microphone disconnected. Tap Start Jarvis to reconnect.",
        });
      };
    }
    if (this.audio.sampleRate !== 16000) {
      await this.releaseMic();
      throw Error(
        "This browser did not provide the required microphone sample rate.",
      );
    }
    const code = `class Capture extends AudioWorkletProcessor {constructor(){super();this.frames=[];}process(inputs){const channel=inputs[0]?.[0];if(channel){for(const s of channel)this.frames.push(s);while(this.frames.length>=512){const frame=new Float32Array(this.frames.splice(0,512));this.port.postMessage(frame,[frame.buffer]);}}return true;}}registerProcessor('jarvis-capture',Capture);`;
    if (!this.moduleAdded) {
      const url = URL.createObjectURL(
        new Blob([code], { type: "text/javascript" }),
      );
      try {
        await this.audio.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.moduleAdded = true;
    }
    this.worklet = new AudioWorkletNode(this.audio, "jarvis-capture");
    this.worklet.port.onmessage = (e) => this.frame(e.data as Float32Array);
    this.mic = this.audio.createMediaStreamSource(this.stream);
    this.mic.connect(this.worklet);
    this.worklet.connect(this.audio.destination);
    this.captureAbort = new AbortController();
    this.update({ listening: true });
  }
  private frame(samples: Float32Array) {
    if (this.closed || !this.view.listening) return;
    const rms = rmsOf(samples);
    const event = this.vad.push(rms, this.view.speaking);
    if (event === "start") {
      if (!this.capturing) {
        this.captureDuringSpeech = this.view.speaking;
        void this.interrupt();
        this.utteranceId = undefined;
        this.captureId = crypto.randomUUID();
        this.traceId = this.captureId;
        this.trace("capture", "start");
        this.turns.beginVoice(this.captureId);
        this.frames = [...this.preroll];
        this.capturing = true;
      }
      this.silentFrames = 0;
      this.update({ hearing: true });
    }
    this.preroll.push(samples);
    if (this.preroll.length > 12) this.preroll.shift();
    if (!this.capturing) return;
    this.frames.push(samples);
    if (this.frames.length > 937) {
      this.frames = [];
      this.capturing = false;
      this.vad.reset();
      this.update({
        hearing: false,
        error:
          "That utterance was too long. Please try a shorter request; nothing was sent.",
      });
      return;
    }
    this.silentFrames =
      rms < Math.max(0.012, this.vad.noiseFloor * 3)
        ? this.silentFrames + 1
        : 0;
    if (
      (event === "end" ||
        (this.silentFrames > 10 && this.silentFrames % 15 === 0)) &&
      !this.checking
    )
      void this.checkTurn();
  }
  private mediaHeaders() {
    return {
      "x-jarvis-request": this.traceId,
      "x-jarvis-client": this.clientId,
      "x-jarvis-lease": this.view.state?.owner?.leaseKey ?? "",
    };
  }
  private async checkTurn() {
    this.checking = true;
    const captureId = this.captureId;
    const requestId = this.traceId;
    const captured = joined(this.frames);
    this.trace("turn", "start", { samples: captured.length });
    try {
      const r = await fetch(base + "turn", {
        method: "POST",
        headers: { "content-type": "application/json", ...this.mediaHeaders() },
        body: JSON.stringify({
          audio: encoded(captured.slice(-128000).buffer),
        }),
        signal: this.captureAbort.signal,
      });
      if (!r.ok)
        throw Error(
          "Turn detection is unavailable. Please use typed input until it recovers.",
        );
      const result = await r.json();
      this.trace("turn", "complete", { httpStatus: r.status });
      if (
        captureId !== this.captureId ||
        !this.capturing ||
        this.silentFrames < 10 ||
        !result.complete
      )
        return;
      const context = this.turns.current();
      this.turns.commit(context);
      this.frames = [];
      this.capturing = false;
      this.vad.reset();
      this.update({ hearing: false, thinking: true });
      const generation = this.generation;
      this.trace("transcribe", "start");
      const transcript = await fetch(base + "transcribe", {
        method: "POST",
        headers: { "content-type": "application/json", ...this.mediaHeaders() },
        body: JSON.stringify({ audio: encoded(wav(captured)) }),
        signal: this.captureAbort.signal,
      });
      if (!transcript.ok)
        throw Error("I could not transcribe that. Please try again.");
      const { text } = await transcript.json();
      this.trace("transcribe", "complete", { httpStatus: transcript.status });
      if (generation !== this.generation || this.closed) return;
      this.update({ transcript: text, thinking: false, error: "" });
      if (typeof text === "string" && text.trim()) {
        const normalized = (s: string) =>
          s
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        if (
          this.captureDuringSpeech &&
          normalized(text).length > 2 &&
          normalized(this.lastSpoken).includes(normalized(text))
        ) {
          void this.speak(
            "I may have heard my own voice. Please say your answer again.",
          );
        } else void this.act("talk", { text }, true, requestId);
      }
    } catch (e) {
      if (!this.captureAbort.signal.aborted) {
        this.frames = [];
        this.capturing = false;
        this.vad.reset();
        this.update({ hearing: false });
        this.fail(e);
      }
    } finally {
      this.checking = false;
    }
  }
  async releaseMic() {
    this.trace("capture", "closed");
    this.captureAbort.abort();
    this.worklet?.disconnect();
    this.worklet?.port.close();
    this.worklet = null;
    this.mic?.disconnect();
    this.mic = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.frames = [];
    this.preroll = [];
    this.capturing = false;
    this.vad.reset();
    this.update({ listening: false, hearing: false });
  }
  async stop() {
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.closed = true;
    this.interruptLocal();
    await this.releaseMic();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.wake?.release();
    this.wake = null;
    await this.audio?.close();
    this.audio = null;
    this.moduleAdded = false;
    try {
      await this.rpc({ action: "close", clientId: this.clientId });
    } catch {
      /* expires server-side */
    }
    this.update({ active: false });
  }
}
