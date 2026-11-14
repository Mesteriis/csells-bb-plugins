import { VoiceActivityDetector, rmsOf } from "./vad";
import { toSpeakable, SentenceStream } from "../speech";
import type { ConversationState } from "../conversation";
import { RealtimeTurnState } from "../vendor/qwen/realtime-turn-state.mjs";

type Command = (input: {
  action: string;
  clientId: string;
  enabled?: boolean;
  takeover?: boolean;
  text?: string;
  utteranceId?: string;
  status?: string;
}) => Promise<ConversationState>;
export interface VoiceView {
  active: boolean;
  listening: boolean;
  speaking: boolean;
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
  private output = new Set<AudioBufferSourceNode>();
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
  private rpc: Command;
  constructor(rpc: Command) {
    this.rpc = rpc;
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
    if (!this.closed)
      this.update({
        error: e instanceof Error ? e.message : String(e),
        thinking: false,
      });
  };
  async connect(listen: boolean, takeover = false) {
    this.closed = false;
    // Resume directly in the initial user gesture; never silently acquire a mic.
    this.audio ??= new AudioContext({ sampleRate: 16000 });
    await this.audio.resume();
    const state = await this.rpc({
      action: "start",
      clientId: this.clientId,
      takeover,
    });
    this.update({ active: true, error: "", state });
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
    extra: { enabled?: boolean; text?: string } = {},
    speak = true,
  ) {
    let generation = this.generation;
    try {
      if (!this.view.active) await this.connect(false);
      if (action !== "heartbeat" && action !== "next") this.interruptLocal();
      generation = this.generation;
      if (action !== "next") this.update({ thinking: true, error: "" });
      const state = await this.rpc({
        action,
        clientId: this.clientId,
        ...extra,
      });
      if (generation !== this.generation || this.closed) return;
      this.update({ state, thinking: false });
      if (speak && state.utterance) {
        const played = await this.speak(state.utterance.text);
        await this.rpc({
          action: "ack",
          clientId: this.clientId,
          utteranceId: state.utterance.id,
          status: played ? "played" : "interrupted",
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
      const state = await this.rpc({
        action: "heartbeat",
        clientId: this.clientId,
      });
      this.update({ state });
      if (
        !this.view.speaking &&
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
    for (const source of this.output) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    this.output.clear();
    this.update({ speaking: false, thinking: false });
  }
  async interrupt() {
    this.interruptLocal();
    try {
      await this.rpc({ action: "interrupt", clientId: this.clientId });
    } catch (e) {
      this.fail(e);
    }
  }
  async speak(markdown: string) {
    if (!this.audio || this.closed) return false;
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
      signal = this.playback.signal;
    this.update({ speaking: true, caption: markdown });
    let cursor = this.audio.currentTime + 0.05;
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
        let odd: number | null = null;
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          if (generation !== this.generation || signal.aborted) return false;
          let bytes: Uint8Array = chunk;
          if (odd !== null) {
            const prefixed = new Uint8Array(chunk.length + 1);
            prefixed[0] = odd;
            prefixed.set(chunk, 1);
            bytes = prefixed;
            odd = null;
          }
          if (bytes.length % 2) {
            odd = bytes[bytes.length - 1]!;
            bytes = bytes.subarray(0, bytes.length - 1);
          }
          if (!bytes.length) continue;
          const samples = new Float32Array(bytes.length / 2);
          const data = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
          );
          for (let i = 0; i < samples.length; i++)
            samples[i] = data.getInt16(i * 2, true) / 32768;
          const buffer = this.audio.createBuffer(1, samples.length, 24000);
          buffer.copyToChannel(samples, 0);
          const source = this.audio.createBufferSource();
          source.buffer = buffer;
          source.connect(this.audio.destination);
          source.onended = () => {
            this.output.delete(source);
            source.disconnect();
          };
          this.output.add(source);
          cursor = Math.max(cursor, this.audio.currentTime + 0.02);
          source.start(cursor);
          cursor += buffer.duration;
        }
      }
      while (this.output.size && !signal.aborted)
        await new Promise((resolve) => setTimeout(resolve, 40));
      return !signal.aborted;
    } catch (e) {
      if (!signal.aborted) this.fail(e);
      return false;
    } finally {
      if (generation === this.generation) this.update({ speaking: false });
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
    for (const track of this.stream.getAudioTracks())
      track.onended = () => {
        void this.releaseMic();
        this.update({
          error: "The microphone disconnected. Tap Start Jarvis to reconnect.",
        });
      };
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
        this.captureId = crypto.randomUUID();
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
      "x-jarvis-client": this.clientId,
      "x-jarvis-lease": this.view.state?.owner?.leaseKey ?? "",
    };
  }
  private async checkTurn() {
    this.checking = true;
    const captureId = this.captureId;
    const captured = joined(this.frames);
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
      const transcript = await fetch(base + "transcribe", {
        method: "POST",
        headers: { "content-type": "application/json", ...this.mediaHeaders() },
        body: JSON.stringify({ audio: encoded(wav(captured)) }),
        signal: this.captureAbort.signal,
      });
      if (!transcript.ok)
        throw Error("I could not transcribe that. Please try again.");
      const { text } = await transcript.json();
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
        } else void this.act("talk", { text });
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
    this.captureAbort.abort();
    this.worklet?.disconnect();
    this.worklet?.port.close();
    this.worklet = null;
    this.mic?.disconnect();
    this.mic = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.frames = [];
    this.capturing = false;
    this.vad.reset();
    this.update({ listening: false, hearing: false });
  }
  async stop() {
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
