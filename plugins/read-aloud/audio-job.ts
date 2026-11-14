import { setTimeout as delay } from "node:timers/promises";

/** A read retains verified chunks so a failed HTTP download is safe to repeat. */
export type SynthesizeChunk = (text: string, signal: AbortSignal) => AsyncIterable<Uint8Array>;

export class AudioJob {
  readonly createdAt = Date.now();
  lastUsedAt = this.createdAt;
  readonly controller = new AbortController();
  private readonly audio = new Map<number, Promise<Uint8Array>>();

  readonly texts: readonly string[];
  private readonly synthesize: SynthesizeChunk;
  private readonly warn: (message: string) => void;

  constructor(texts: readonly string[], synthesize: SynthesizeChunk, warn: (message: string) => void) {
    this.texts = texts;
    this.synthesize = synthesize;
    this.warn = warn;
  }

  chunk(index: number): Promise<Uint8Array> {
    if (!Number.isInteger(index) || index < 0 || index >= this.texts.length) {
      return Promise.reject(new Error("Invalid audio chunk index"));
    }
    this.lastUsedAt = Date.now();
    this.controller.signal.throwIfAborted();
    let pending = this.audio.get(index);
    if (pending === undefined) {
      pending = this.generate(index);
      this.audio.set(index, pending);
    }
    return pending;
  }

  private async generate(index: number): Promise<Uint8Array> {
    const signal = this.controller.signal;
    const text = this.texts[index];
    if (text === undefined) throw new Error("Invalid audio chunk index");
    let last: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      signal.throwIfAborted();
      if (attempt > 1) await delay(500 * 2 ** (attempt - 2), undefined, { signal });
      let receivedBytes = 0;
      try {
        const parts: Uint8Array[] = [];
        let size = 0;
        for await (const bytes of this.synthesize(text, signal)) {
          signal.throwIfAborted();
          parts.push(bytes);
          size += bytes.length;
          receivedBytes += bytes.length;
        }
        signal.throwIfAborted();
        if (size === 0) throw new Error("No audio received");
        const audio = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) { audio.set(part, offset); offset += part.length; }
        return audio;
      } catch (cause) {
        signal.throwIfAborted();
        last = cause;
        this.warn(`chunk ${index + 1}/${this.texts.length} attempt ${attempt}/3 failed after ${receivedBytes} bytes: ${String(cause)}`);
      }
    }
    throw new Error(`Audio chunk ${index + 1} failed after 3 attempts: ${String(last)}`);
  }

  dispose(): void {
    this.controller.abort();
    this.audio.clear();
  }
}
