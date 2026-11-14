# bb-plugin-read-aloud

Speak any chat message out loud, with a streaming neural voice and a real
transport: seek, speed, pause, stop.

Adds a speaker button to every message's action row.
Click it and a floating pill appears with elapsed time, ±10s seek, pause,
playback speed, and stop.

![The speaker button in a message's action row, and the transport pill mid-playback showing elapsed time, back ten seconds, pause, forward ten seconds, 1.5x speed, and stop](docs/player.png)

No API key, no metering, and **no external binary** — synthesis speaks
Microsoft Edge's Read Aloud protocol directly over a WebSocket.

## Install

```bash
bb plugin install <this directory or git url>
```

That is the whole setup. Verify with:

```bash
bb read-aloud status
bb read-aloud voices en-GB     # filter the live voice catalog
```

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Voice | `en-US-AndrewMultilingualNeural` | Any Microsoft neural voice |
| Rate | `+8%` | **Synthesis** speed, baked into the audio |
| Code blocks | `describe` | `describe` names the language and line count; `read` speaks it verbatim; `skip` stays silent |
| Client version override | *(empty)* | Advanced; empty negotiates automatically |

Playback speed is separate and lives in `localStorage`: it is a per-device UI
preference you change mid-sentence, whereas plugin settings are server-side,
global, and read once per load.

## How it works

**Native synthesis.** `synth.ts` implements the protocol: the `Sec-MS-GEC`
token (derived from the current Windows FILETIME rounded to a five-minute
boundary, which must be computed with `BigInt` — the tick count exceeds
`Number.MAX_SAFE_INTEGER` and floating point silently hashes to a rejected
token), the WebSocket handshake, and the binary framing.

In October 2026 the service retired the v1 token, a plain SHA-256 of that
string, and began refusing every handshake with 403 at every client version.
`gec.ts` ports the v2 token from the reference `edge-tts` client (7.3.0): a
SHA-256 behind a secret prefix, resumed from a published midstate, plus a keyed
"CS64" checksum, sent as `Sec-MS-GEC-Version: 2-<version>` with a random
`muid` cookie. Version escalation cannot recover from a scheme change like
this; `bb read-aloud status` reporting 403 at every version is the signature. The only
dependency is `ws`, needed because the browser WebSocket API cannot set the
`Origin`/`User-Agent` headers the service checks.

Earlier versions shelled out to the Python `edge-tts` CLI, which made the
plugin uninstallable for anyone without that virtualenv. The npm ports were not
usable either: `edge-tts-node` pins its client version to Chromium 130 and the
service now refuses that handshake outright (close 1006), while `msedge-tts`
ships a `preinstall: npx only-allow pnpm` hook that aborts any npm install.

**Client-version rot fixes itself.** The service checks
`Sec-MS-GEC-Version` against a *minimum* and enforces no maximum. Measured
directly against the endpoint:

| version | result |  | version | result |
| --- | --- | --- | --- | --- |
| `131.0.0.0` | 403 |  | `143.0.3650.75` | OK |
| `132.0.0.0` | OK |  | `999.0.0.0` | OK |

So the floor sits at 132 while current Edge is ~143 — it ratchets upward but
lags real releases by roughly a year. Because nothing rejects a *higher*
version, a stale pin is always recoverable by escalating. On a refused
handshake the plugin retries with progressively higher majors (+20, +60, +150)
and remembers whatever worked, so the retry cost is paid once per install
rather than once per synthesis. That is why `edge-tts-node`'s hard pin at 130
is permanently broken while this is not. An explicit override is used verbatim
and never escalated, because a version you set deliberately should mean what it
says. `bb read-aloud status` reports which version is live and whether it was
negotiated or pinned.

**Verified, retryable chunks.** Text is split at sentence boundaries. Each
chunk must receive audio and the speech protocol's `turn.end` marker before
any of its bytes are released. Interrupted or empty turns are discarded and
retried with backoff for up to three attempts; an exhausted chunk returns a visible error.

`POST /prepare` returns a read ID and chunk count. `GET /chunk?id=...&index=...`
returns a complete MP3 chunk with a content length. Downloads run with bounded
look-ahead and are consumed in order. A failed network download retries the
same chunk, reusing the server's verified audio without repeating synthesis.
`DELETE /job?id=...` aborts synthesis and releases the retained audio. Abandoned
reads expire after ten minutes without a chunk request.

**Playback uses MediaSource** for seeking through received audio. It waits for
15 seconds of audio, scaled by playback speed, or the whole message if shorter.
If delivery falls behind, playback pauses to rebuild that cushion and resumes
automatically. User pause remains paused. Failures remain visible rather than
being overwritten by later media events. Engines without MP3 MediaSource wait
for a complete file, then play a seekable blob.

**Stop cancels connecting and active speech sockets.** New reads and Stop also
cancel pending downloads, MediaSource waits and appends. A stale response cannot
start playback or overwrite a newer read.

**Markdown is flattened first.** Raw markdown through a TTS engine says "hash
hash Loose ends" and spells out URLs character by character. Links reduce to
their labels and headings gain a full stop so the voice lands.

Two constructs need more than stripping, because they carry meaning in their
layout and a listener has no layout:

- **Tables** are linearized with every cell paired to its column header, and
  the first column used as the row's label — "Signal. Fixed: HOLD. Risk-based:
  CUT." Flattening a row to "Signal, HOLD, CUT" is wordier to read and
  impossible to follow by ear, since position is the only thing saying which
  value belongs to which column.
- **Code fences** are named rather than read: "(python code block, 12 lines)".
  Braces and indentation are noise aloud, but silence leaves the listener
  unable to judge whether to go and look. Set **Code blocks** to `read` to hear
  the code verbatim, or `skip` for silence.

Fences and tables are found by scanning lines, not by regex over the whole
message: a regex pairs fences positionally, so one stray fence swallows every
word up to the next one. Money and rate shorthand is spoken as words, so
"$120K/yr" comes out as "$120 thousand per year" rather than as letters and a
slash.

**Auto-stop** happens two ways. Switching threads is detected in the overlay
via `useBbContext()`. New prompts go through the backend: `thread.active`
publishes on a realtime channel and the overlay stops, filtered to the thread
being read so background threads never interrupt you. The server-side signal
covers every composer surface and layout, unlike a frontend submit hook.

**Why two registrations.** `messageAction` is host-rendered chrome — `run` is a
plain callback, not a component — so it cannot draw transport buttons as
siblings of itself. The button triggers; `experimental_appOverlay` renders the
transport. A module-level store bridges them, because `run` fires outside React
and the overlay mounts and unmounts underneath it.

## Mobile

Touch targets grow on coarse pointers using BB's own `coarse-pointer-sizing`
classes. The pill clears the mobile composer and respects
`env(safe-area-inset-bottom)`, constrains itself to the viewport width, and
drops its text label first on narrow screens so the controls always fit.

## Known limitations

- **The protocol endpoint is undocumented,** so there is no SLA. Client-version
  rot is handled (see below), but a change to the token scheme itself would
  need a code change, as it would for every client.
- Voice catalog only — no cloning, and no control over the 24kHz/48kbps output
  format.
- Without MP3 MediaSource, playback starts only after the complete message downloads.
- Network or speech-provider outages can still prevent reading; failures are shown explicitly.

## Selection reading

Highlight text inside a message and the action also appears in the selection
menu, reading only what you highlighted.

### Third-party notices

`gec.ts` is a TypeScript adaptation of `edge-tts` 7.3.0's `drm.py` and
retains its LGPLv3 license. Its source link and modification notice are in
the file header; upstream notices and license terms are in `licenses/`.
The repository's MIT license applies to the other original plugin code.
