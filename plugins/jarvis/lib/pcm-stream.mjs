// Network frames: uint32 BE byte length, PCM16 payload, then zero length only
// after synthesis AND lease release succeed. EOF is never a completion signal.
export function pcmFrame(bytes) {
  const frame = new Uint8Array(4 + bytes.length);
  new DataView(frame.buffer).setUint32(0, bytes.length);
  frame.set(bytes, 4);
  return frame;
}
export async function* readPcmFrames(body) {
  if (!body) throw Error("Missing audio stream");
  const reader = body.getReader(); // Supported on mobile without stream async iteration.
  let pending = new Uint8Array(0),
    complete = false,
    total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const joined = new Uint8Array(pending.length + value.length);
      joined.set(pending);
      joined.set(value, pending.length);
      pending = joined;
      while (pending.length >= 4) {
        if (complete) throw Error("Audio after completion");
        const size = new DataView(
          pending.buffer,
          pending.byteOffset,
          4,
        ).getUint32(0);
        if (size > 1048576) throw Error("Invalid audio frame");
        if (pending.length < size + 4) break;
        const payload = pending.slice(4, size + 4);
        pending = pending.slice(size + 4);
        if (!size) complete = true;
        else {
          total += size;
          yield payload;
        }
      }
    }
    if (!complete || pending.length || total % 2)
      throw Error("Audio stream incomplete");
    if (!total) throw Error("Audio stream empty");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
