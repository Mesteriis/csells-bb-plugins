import { test } from "node:test";
import assert from "node:assert/strict";
import { pcmWave, MediaPlayback } from "../lib/media-playback.mjs";
class Audio extends EventTarget {
  currentTime = 0;
  paused = true;
  muted = false;
  volume = 1;
  setAttribute() {}
  removeAttribute() {}
  load() {}
  pause() {
    this.paused = true;
  }
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
}
test("PCM wave retains sample bytes and declares 24kHz mono PCM16", () => {
  const wave = pcmWave(Uint8Array.of(12, 0, 24, 0));
  const v = new DataView(wave.buffer);
  assert.equal(new TextDecoder().decode(wave.slice(0, 4)), "RIFF");
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint16(22, true), 1);
  assert.deepEqual([...wave.slice(44)], [12, 0, 24, 0]);
  assert.throws(() => pcmWave(Uint8Array.of(1)), /PCM/);
});
test("media completion requires ended; abort pauses and never acknowledges completion", async () => {
  const audio = new Audio(),
    events = [],
    player = new MediaPlayback(audio, (phase) => events.push(phase));
  const abort = new AbortController();
  const playing = player.play(Uint8Array.of(1, 0, 2, 0), abort.signal);
  await Promise.resolve();
  assert.equal(audio.paused, false);
  assert.deepEqual(events, ["running"]);
  abort.abort();
  await assert.rejects(playing);
  assert.equal(audio.paused, true);
  assert.ok(!events.includes("complete"));
  const second = player.play(
    Uint8Array.of(1, 0, 2, 0),
    new AbortController().signal,
  );
  audio.dispatchEvent(new Event("ended"));
  await second;
  assert.ok(events.includes("complete"));
});
test("blocked media play surfaces failure instead of completing", async () => {
  const audio = new Audio();
  audio.play = async () => {
    throw new DOMException("Blocked", "NotAllowedError");
  };
  await assert.rejects(
    new MediaPlayback(audio).play(
      Uint8Array.of(1, 0),
      new AbortController().signal,
    ),
    /Blocked/,
  );
});
