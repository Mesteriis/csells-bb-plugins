import { describe, expect, it, vi } from "vitest";
import { AudioJob } from "./audio-job";

describe("verified audio chunks", () => {
  it("discards an interrupted attempt and serves only the complete retry, including on a repeated download", async () => {
    let attempts = 0;
    const synth = vi.fn(async function* () {
      attempts++;
      yield new Uint8Array([attempts]);
      if (attempts === 1) throw new Error("connection lost before turn.end");
      yield new Uint8Array([9]);
    });
    const job = new AudioJob(["All the words."], synth, vi.fn());
    const [first, duplicate] = await Promise.all([job.chunk(0), job.chunk(0)]);
    expect([...first]).toEqual([2, 9]);
    expect(duplicate).toBe(first);
    expect(await job.chunk(0)).toBe(first);
    expect(synth).toHaveBeenCalledTimes(2);
  });
  it("reports exhausted retries without returning partial audio", async () => {
    const synth = vi.fn(async function* () { yield new Uint8Array([1]); throw new Error("lost"); });
    const job = new AudioJob(["Words"], synth, vi.fn());
    await expect(job.chunk(0)).rejects.toThrow(/chunk 1.*3 attempts.*lost/i);
    expect(synth).toHaveBeenCalledTimes(3);
  });
  it("aborts pending synthesis when the read is released", async () => {
    const job = new AudioJob(["Words"], async function* (_text, signal) {
      await new Promise<void>((_resolve, reject) => { signal.addEventListener("abort", () => { reject(new DOMException("Read aborted", "AbortError")); }, { once: true }); });
      yield new Uint8Array([1]);
    }, vi.fn());
    const pending = job.chunk(0);
    job.dispose();
    await expect(pending).rejects.toThrow(/abort/i);
  });
  it("cancels a retry backoff without starting another speech request", async () => {
    const synth = vi.fn(async function* () { yield new Uint8Array([1]); throw new Error("lost"); });
    const warn = vi.fn();
    const job = new AudioJob(["Words"], synth, warn);
    const pending = job.chunk(0);
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(1); });
    job.dispose();
    await expect(pending).rejects.toThrow(/abort/i);
    expect(synth).toHaveBeenCalledTimes(1);
  });

});
