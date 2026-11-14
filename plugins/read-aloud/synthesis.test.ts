import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ mode: "complete", sockets: [] as EventEmitter[] }));
vi.mock("ws", () => ({ default: class extends EventEmitter {
  constructor() { super(); control.sockets.push(this); queueMicrotask(() => { if (control.mode !== "connecting") this.emit("open"); }); }
  send(message: string) {
    if (!message.includes("Path:ssml")) return;
    queueMicrotask(() => {
      if (control.mode !== "empty") {
        const header = Buffer.from("Path:audio\r\n");
        const size = Buffer.alloc(2); size.writeUInt16BE(header.length);
        this.emit("message", Buffer.concat([size, header, Buffer.from("audio")]), true);
      }
      if (control.mode === "complete" || control.mode === "empty") this.emit("message", Buffer.from("Path:turn.end\r\n"), false);
      else this.emit("close", 1006, Buffer.from("connection lost"));
    });
  }
  close() { this.emit("close", 1000, Buffer.alloc(0)); }
  terminate() { this.emit("close", 1006, Buffer.alloc(0)); }
} }));

afterEach(() => { control.mode = "complete"; control.sockets = []; });
async function collect(signal?: AbortSignal) {
  const { synthesize } = await import("./synth");
  const parts: Uint8Array[] = [];
  for await (const bytes of synthesize({ text: "Read all these words.", voice: "en-US-AndrewMultilingualNeural", signal })) parts.push(bytes);
  return Buffer.concat(parts);
}
describe("speech completion", () => {
  it("rejects a disconnect before the protocol completion marker", async () => {
    control.mode = "interrupted";
    await expect(collect()).rejects.toThrow(/before.*turn.end/i);
  });
  it("rejects an empty completed turn", async () => {
    control.mode = "empty";
    await expect(collect()).rejects.toThrow(/no audio/i);
  });
  it("accepts audio followed by a completed turn", async () => {
    expect((await collect()).toString()).toBe("audio");
  });
  it("cancels a handshake that has not opened", async () => {
    control.mode = "connecting";
    const controller = new AbortController();
    const result = collect(controller.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    await expect(result).rejects.toThrow(/abort/i);
  });
});
