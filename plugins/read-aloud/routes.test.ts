import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
const synth = vi.hoisted(() => ({ calls: 0, waitForAbort: false }));
vi.mock("./synth", () => ({
  configureClientVersion: vi.fn(), activeClientVersion: () => "143.0.3650.75", listVoices: async () => [],
  synthesize: async function* (options: { signal: AbortSignal }) {
    synth.calls++;
    if (synth.waitForAbort) await new Promise<void>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => { reject(new DOMException("Read aborted", "AbortError")); }, { once: true });
    });
    yield new Uint8Array([1, 2, 3]);
  },
}));
import plugin from "./server";
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); synth.calls = 0; synth.waitForAbort = false; });
describe("read lifecycle over HTTP", () => {
  it("prepares the whole message, reuses a verified chunk and releases it on stop", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "read-aloud" });
    disposals.push(() => harness.lifecycle.dispose());
    await plugin(bb);
    const prepared = await harness.behavior.fetchHttp("POST", "/prepare", { body: JSON.stringify({ text: "Read all of this." }), headers: { "content-type": "application/json" } });
    const { id, chunks } = await prepared.json() as { id: string; chunks: number };
    expect(chunks).toBe(1);
    const first = await harness.behavior.fetchHttp("GET", `/chunk?id=${id}&index=0`);
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([1, 2, 3]);
    const duplicate = await harness.behavior.fetchHttp("GET", `/chunk?id=${id}&index=0`);
    expect(duplicate.status).toBe(200);
    expect(synth.calls).toBe(1);
    expect((await harness.behavior.fetchHttp("GET", `/chunk?id=${id}&index=-1`)).status).toBe(400);
    await harness.behavior.fetchHttp("DELETE", `/job?id=${id}`);
    expect((await harness.behavior.fetchHttp("GET", `/chunk?id=${id}&index=0`)).status).toBe(404);
  });
  it("reports user cancellation separately from synthesis failure", async () => {
    synth.waitForAbort = true;
    const { bb, harness } = createFakePluginHost({ pluginId: "read-aloud" });
    disposals.push(() => harness.lifecycle.dispose());
    await plugin(bb);
    const response = await harness.behavior.fetchHttp("POST", "/prepare", { body: JSON.stringify({ text: "Read this." }), headers: { "content-type": "application/json" } });
    const { id } = await response.json() as { id: string };
    const pending = harness.behavior.fetchHttp("GET", `/chunk?id=${id}&index=0`);
    await vi.waitFor(() => { expect(synth.calls).toBe(1); });
    await harness.behavior.fetchHttp("DELETE", `/job?id=${id}`);
    expect((await pending).status).toBe(410);
  });

});
