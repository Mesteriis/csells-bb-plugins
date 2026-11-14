import { test } from "node:test";
import assert from "node:assert/strict";
import { readPcmFrames, pcmFrame } from "../lib/pcm-stream.mjs";
import { createRelayServer } from "../relay/http.mjs";
function stream(bytes) {
  return new ReadableStream({
    start(c) {
      for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
      c.close();
    },
  });
}
test("PCM frames tolerate split headers and require an explicit completion marker", async () => {
  const data = Uint8Array.of(1, 0, 2, 0),
    framed = pcmFrame(data);
  const out = [];
  for await (const b of readPcmFrames(stream([...framed, 0, 0, 0, 0])))
    out.push(...b);
  assert.deepEqual(out, [...data]);
  await assert.rejects(async () => {
    for await (const b of readPcmFrames(stream(framed))) {
    }
  }, /incomplete/i);
  await assert.rejects(async () => {
    for await (const b of readPcmFrames(stream([0, 0, 0, 0]))) {
    }
  }, /empty/i);
});
test("relay never reports complete playback when synthesis fails after audio starts", async (t) => {
  const server = createRelayServer({
    token: "t".repeat(48),
    expiresAt: Date.now() + 60000,
    director: { mediaSignal: () => new AbortController().signal },
    voice: {
      speech: async () => ({
        body: (async function* () {
          yield Buffer.from([1, 0]);
          await new Promise((r) => setTimeout(r, 30));
          throw Error("provider failed");
        })(),
        release: async () => {},
      }),
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/speech`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${"t".repeat(48)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Hello" }),
    },
  );
  assert.equal(
    response.headers.get("content-type"),
    "application/x-jarvis-pcm",
  );
  await assert.rejects(async () => {
    for await (const b of readPcmFrames(response.body)) {
    }
  });
});
