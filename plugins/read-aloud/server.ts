// bb-plugin-read-aloud — backend entry.
//
// Prepare speakable text, serve validated retryable audio chunks, and release
// the read on completion or cancellation. Synthesis uses the native protocol.
import { AudioJob } from "./audio-job";
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  activeClientVersion,
  configureClientVersion,
  listVoices,
  synthesize,
} from "./synth";

/** Frontend listens on this and stops playback. */
const STOP_CHANNEL = "read-aloud/stop";

const JOB_TTL_MS = 10 * 60_000;
const MAX_JOBS = 32;

const CHUNK_TARGET_CHARS = 400;
const CHUNK_RAMP_CHARS = [150, 300];

export const rpcContract = defineRpcContract({
  status: {
    input: z.null(),
    output: z.object({
      ready: z.boolean(),
      voice: z.string(),
      detail: z.string(),
    }),
  },
});

/** What to do with a fenced code block. See the `codeBlocks` setting. */
export type CodeBlockMode = "describe" | "read" | "skip";

export interface SpeakableOptions {
  codeBlocks?: CodeBlockMode;
}

/** A fence opener: ``` or ~~~, with an optional language tag. */
const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
/** A table row: a line that both starts and ends with a pipe. */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** A table's `|---|:--:|` separator, which is layout and never spoken. */
const SEPARATOR_CELL = /^:?-{1,}:?$/;

/** Splits one table row into trimmed cells, honoring escaped pipes. */
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

/**
 * Linearizes a table so every cell keeps the column it belongs to.
 *
 * A sighted reader gets the column from its position; a listener cannot, so
 * "Signal, HOLD, CUT" is three floating values. Repeating the header with each
 * cell is wordier on the page and the only version that survives being heard.
 * The first column becomes the row's label, which is what it almost always is.
 */
function speakTable(rows: string[]): string {
  const parsed = rows.map(tableCells);
  const headed = parsed.length >= 2 && isSeparatorRow(parsed[1] ?? []);
  const body = (headed ? parsed.slice(2) : parsed).filter(
    (cells) => !isSeparatorRow(cells) && cells.some((cell) => cell !== ""),
  );
  if (body.length === 0) return "";

  // No header row means no columns to name; fall back to a plain clause.
  const header = headed ? (parsed[0] ?? []) : null;
  if (header === null) {
    return body
      .map((cells) => cells.filter(Boolean).join(", ") + ".")
      .join("\n");
  }

  const spoken = body.map((cells) => {
    const label = (cells[0] ?? "").trim();
    const parts: string[] = [];
    for (let column = 1; column < cells.length; column += 1) {
      const cell = (cells[column] ?? "").trim();
      if (cell === "") continue;
      const name = (header[column] ?? "").trim();
      parts.push(name === "" ? `${cell}.` : `${name}: ${cell}.`);
    }
    return (label === "" ? "" : `${label}. `) + parts.join(" ");
  });
  return [
    `Table, ${body.length} row${body.length === 1 ? "" : "s"}.`,
    ...spoken,
  ].join("\n");
}

/**
 * Says what a code block is instead of reading it. Braces, sigils and
 * indentation are noise aloud, but silence leaves the listener wondering what
 * they missed — so name the language and the size, which is what they would
 * want in order to decide whether to go look.
 */
function speakCode(
  language: string,
  lines: string[],
  mode: CodeBlockMode,
): string {
  if (mode === "skip") return "";
  if (mode === "read") return lines.join("\n");
  const count = lines.filter((line) => line.trim() !== "").length;
  const named = language.trim() === "" ? "code block" : `${language} code block`;
  return `(${named}, ${count} line${count === 1 ? "" : "s"})`;
}

/**
 * Rewrites the shorthand that reads correctly but speaks badly. "$120K/yr"
 * comes out as letters and a slash; the spelled-out form is what a person
 * would say.
 */
function speakNotation(text: string): string {
  return (
    text
      // Money shorthand. "$$" is a literal dollar sign in a replacement.
      .replace(/\$(\d[\d,]*(?:\.\d+)?)\s?K\b/g, "$$$1 thousand")
      .replace(/\$(\d[\d,]*(?:\.\d+)?)\s?M\b/g, "$$$1 million")
      .replace(/\$(\d[\d,]*(?:\.\d+)?)\s?B\b/g, "$$$1 billion")
      // Rates.
      .replace(/\/yr\b/g, " per year")
      .replace(/\/mo\b/g, " per month")
      .replace(/\/hr\b/g, " per hour")
      // Abbreviations a voice stumbles over or spells out.
      .replace(/\bvs\.?(?=\s)/gi, "versus")
      .replace(/\be\.g\.(?=\s)/gi, "for example,")
      .replace(/\bi\.e\.(?=\s)/gi, "that is,")
      // Arrows, which otherwise read as punctuation or nothing at all.
      .replace(/\s(?:->|=>|→)\s/g, " to ")
  );
}

/**
 * Markdown is written to be read, not heard. Left raw, a TTS engine says
 * "hash hash Loose ends" and spells out URLs a character at a time. This
 * flattens the message into something speakable while keeping the prose.
 *
 * Fences and tables are handled by scanning lines rather than by regex over
 * the whole string: a regex pair-matches fences positionally, so one stray
 * ``` swallows everything to the next one, and a table needs its header row
 * to make sense of the rows beneath it.
 */
export function toSpeakable(
  markdown: string,
  options: SpeakableOptions = {},
): string {
  const codeBlocks = options.codeBlocks ?? "describe";
  const lines = markdown.split("\n");
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const fence = FENCE_OPEN.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "```";
      const language = fence[2] ?? "";
      const body: string[] = [];
      index += 1;
      // An unterminated fence runs to the end of the message, which is what
      // the renderer shows and therefore what the listener sees.
      while (index < lines.length) {
        const current = lines[index] ?? "";
        if (new RegExp(`^\\s{0,3}${marker[0] ?? "`"}{3,}\\s*$`).test(current)) {
          break;
        }
        body.push(current);
        index += 1;
      }
      blocks.push(speakCode(language, body, codeBlocks));
      continue;
    }

    if (TABLE_ROW.test(line)) {
      const rows: string[] = [];
      while (index < lines.length && TABLE_ROW.test(lines[index] ?? "")) {
        rows.push(lines[index] ?? "");
        index += 1;
      }
      index -= 1;
      blocks.push(speakTable(rows));
      continue;
    }

    blocks.push(line);
  }

  let text = blocks.join("\n");

  // Images before links: an image's alt text is rarely worth speaking.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Links -> their label. A bare autolink keeps nothing worth saying.
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/<https?:\/\/[^>]+>/g, "");
  text = text.replace(/https?:\/\/\S+/g, "");

  // Inline code -> its contents. Identifiers read better than backticks.
  text = text.replace(/`([^`]+)`/g, "$1");

  // Headings become their own sentence so the voice lands a full stop.
  text = text.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "$1.");
  // Blockquote and list markers.
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, "");
  text = text.replace(/^\s{0,3}\d+\.\s+/gm, "");
  // Horizontal rules.
  text = text.replace(/^\s{0,3}([-*_]\s*){3,}$/gm, "");
  // Emphasis / strikethrough, keeping the words. Underscore emphasis has to
  // refuse intra-word matches or it eats the middle of snake_case_names.
  text = text.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1");
  text = text.replace(/\*(?=\S)([^*\n]*?\S)\*/g, "$1");
  text = text.replace(/(^|[^\w\\])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1$2");
  text = text.replace(/(^|[^\w\\])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2");
  text = text.replace(/~~(.*?)~~/g, "$1");
  // Leftover HTML tags.
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");

  text = speakNotation(text);

  // Collapse whitespace; a blank line becomes a paragraph break, which the
  // synth renders as a longer pause than a newline would.
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/ *\n */g, "\n");
  // "..." reads as a stumble; a period is cleaner.
  text = text.replace(/\.{3,}/g, ".");
  return text.trim();
}

/**
 * Splits speakable text into synthesis turns at sentence boundaries.
 *
 * Boundaries matter: cutting mid-sentence makes the voice land a false full
 * stop where the chunk ends, which is audible. A sentence longer than the
 * target is broken anyway, because one unbounded turn is the thing this
 * exists to prevent.
 */
export function chunkForSynthesis(
  text: string,
  target: number = CHUNK_TARGET_CHARS,
  ramp: readonly number[] = CHUNK_RAMP_CHARS,
): string[] {
  const chunks: string[] = [];
  let current = "";

  // Early chunks are smaller, but never larger than the caller's target — so
  // an explicit small target still means what it says.
  const limit = () => Math.min(ramp[chunks.length] ?? target, target);

  const flush = () => {
    if (current !== "") chunks.push(current);
    current = "";
  };

  for (const piece of text.split(/(?<=[.!?])\s+|\n{2,}/)) {
    const part = piece.trim();
    if (part === "") continue;
    if (current !== "" && current.length + part.length + 1 > limit()) flush();
    if (part.length > limit()) {
      flush();
      let at = 0;
      while (at < part.length) {
        // Re-read the limit each time: pushing a piece advances the ramp.
        const size = limit();
        chunks.push(part.slice(at, at + size));
        at += size;
      }
      continue;
    }
    current = current === "" ? part : `${current} ${part}`;
  }
  flush();
  return chunks;
}

/** Pulls just enough of a synthesis to prove the handshake works. */
async function probeSynthesis(voice: string, rate: string): Promise<void> {
  for await (const chunk of synthesize({ text: "ok", voice, rate })) { if (chunk.length === 0) throw new Error("Empty speech frame"); }
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    voice: {
      type: "string",
      label: "Voice",
      description:
        'Microsoft neural voice, e.g. en-US-AndrewMultilingualNeural. Run "bb read-aloud voices" to list them.',
      default: "en-US-AndrewMultilingualNeural",
    },
    rate: {
      type: "string",
      label: "Rate",
      description:
        'Synthesis speed, e.g. "+8%" or "-10%". Empty means the natural pace. Playback speed is separate, in the player.',
      default: "+8%",
    },
    codeBlocks: {
      type: "select",
      label: "Code blocks",
      description:
        'What to do with fenced code. "describe" names the language and line count, "read" speaks it verbatim, "skip" passes over it in silence.',
      options: ["describe", "read", "skip"],
      default: "describe",
    },
    clientVersion: {
      type: "string",
      label: "Client version override",
      description:
        "Advanced. Pin the Sec-MS-GEC client version, e.g. 143.0.3650.75. Leave empty to negotiate automatically, which is almost always right.",
      default: "",
    },
  });

  // Client-version rot handling. The service enforces a minimum version and no
  // maximum, so a pin that falls below the floor is recoverable by escalating.
  // Remember whatever worked, so the retry cost is paid once per install
  // instead of once per synthesis. An explicit override skips negotiation.
  const LEARNED_VERSION_KEY = "client-version";
  const initial = await settings.get();
  configureClientVersion({
    override: initial.clientVersion,
    learned: await bb.storage.kv.get<string>(LEARNED_VERSION_KEY),
    onLearned: (version) => {
      bb.log.info(`negotiated a newer client version: ${version}`);
      void bb.storage.kv.set(LEARNED_VERSION_KEY, version);
    },
  });

  const jobs = new Map<string, AudioJob>();

  function sweepJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs) if (job.lastUsedAt < cutoff) { job.dispose(); jobs.delete(id); }
    // Hard cap, oldest first, so a client that never plays cannot grow this.
    while (jobs.size > MAX_JOBS) {
      const oldest = [...jobs.entries()].sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )[0];
      if (oldest === undefined) break;
      oldest[1].dispose();
      jobs.delete(oldest[0]);
    }
  }

  const expirationTimer = setInterval(sweepJobs, 60_000);

  bb.rpc.register(rpcContract, {
    status: async () => {
      const { voice, rate } = await settings.get();
      try {
        await probeSynthesis(voice, rate);
        return {
          ready: true,
          voice,
          detail: `synthesis reachable (client ${activeClientVersion()})`,
        };
      } catch (cause) {
        return {
          ready: false,
          voice,
          detail:
            cause instanceof Error
              ? `synthesis failed: ${cause.message}`
              : "synthesis failed",
        };
      }
    },
  });

  bb.http.route(
    "POST",
    "/prepare",
    async (context) => {
      const body: unknown = await context.req.json().catch(() => null);
      const parsed = z.object({ text: z.string() }).safeParse(body);
      if (!parsed.success) {
        return context.json({ error: "expected { text: string }" }, 400);
      }
      // No length cap: truncating here is exactly the "it stopped before the
      // end" failure, and silently. Long messages are chunked at synthesis
      // time instead.
      const { codeBlocks } = await settings.get();
      const text = toSpeakable(parsed.data.text, {
        codeBlocks: codeBlocks as CodeBlockMode,
      });
      if (text === "") return context.json({ error: "nothing to speak" }, 400);

      sweepJobs();
      const id = randomUUID();
      const { voice, rate } = await settings.get();
      const job = new AudioJob(chunkForSynthesis(text),
        (text, signal) => synthesize({ text, voice, rate, signal }),
        (message) => { bb.log.warn(`read ${id}: ${message}`); });
      jobs.set(id, job);
      sweepJobs();
      bb.log.info(`read ${id}: prepared ${job.texts.length} chunks, ${text.length} characters`);
      return context.json({ id, characters: text.length, chunks: job.texts.length });
    },
    { auth: "local" },
  );

  bb.http.route("GET", "/chunk", async (context) => {
    sweepJobs();
    const id = context.req.query("id") ?? "";
    const job = jobs.get(id);
    if (job === undefined) return context.json({ error: "Read expired; start read aloud again." }, 404);
    const raw = context.req.query("index");
    const index = raw === undefined || raw === "" ? NaN : Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= job.texts.length) {
      return context.json({ error: "Invalid audio chunk index" }, 400);
    }
    try {
      const bytes = await job.chunk(index);
      bb.log.info(`read ${id}: verified chunk ${index + 1}/${job.texts.length}, ${bytes.length} bytes`);
      return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: {
        "Content-Type": "audio/mpeg", "Content-Length": String(bytes.length), "Cache-Control": "no-store",
      } });
    } catch (cause) {
      if (job.controller.signal.aborted) {
        bb.log.info(`read ${id}: chunk ${index + 1} cancelled`);
        return context.json({ error: "Read cancelled" }, 410);
      }
      const error = cause instanceof Error ? cause.message : String(cause);
      bb.log.error(`read ${id}: ${error}`);
      return context.json({ error }, 502);
    }
  }, { auth: "local" });

  bb.http.route("DELETE", "/job", (context) => {
    const id = context.req.query("id") ?? "";
    jobs.get(id)?.dispose();
    jobs.delete(id);
    bb.log.info(`read ${id}: released`);
    return context.json({ released: true });
  }, { auth: "local" });

  // Auto-stop when the user sends a new prompt. Doing this server-side covers
  // every composer surface and layout, which a frontend-only submit hook would
  // not. The frontend filters on threadId so background threads do not
  // interrupt listening.
  bb.events.on("thread.active", ({ thread }) => {
    bb.realtime.publish(STOP_CHANNEL, {
      reason: "thread-active",
      threadId: thread.id,
    });
  });

  bb.cli.register({
    name: "read-aloud",
    summary: "Inspect the Read Aloud plugin's speech setup",
    commands: [
      {
        name: "status",
        summary: "Check that synthesis is reachable",
        usage: "bb read-aloud status",
      },
      {
        name: "voices",
        summary: "List available neural voices",
        usage: "bb read-aloud voices [filter]",
      },
    ],
    async run(argv) {
      const [command, ...args] = argv;
      switch (command) {
        case "status": {
          const { voice, rate } = await settings.get();
          try {
            await probeSynthesis(voice, rate);
            return {
              exitCode: 0,
              stdout: [
                "synthesis: reachable (native, no external binary)",
                `voice:     ${voice}`,
                `rate:      ${rate || "(natural)"}`,
                `client:    ${activeClientVersion()}${initial.clientVersion.trim() === "" ? " (negotiated)" : " (pinned)"}`,
              ].join("\n"),
            };
          } catch (cause) {
            return {
              exitCode: 1,
              stderr: [
                `synthesis unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
                "A 403 at every client version means the token scheme changed again (see gec.ts).",
              ].join("\n"),
            };
          }
        }
        case "voices": {
          const filter = (args[0] ?? "en-").toLowerCase();
          try {
            const voices = await listVoices();
            const rows = voices
              .filter(
                (voice) =>
                  voice.shortName.toLowerCase().includes(filter) ||
                  voice.locale.toLowerCase().includes(filter),
              )
              .map(
                (voice) =>
                  `${voice.shortName.padEnd(38)} ${voice.gender.padEnd(7)} ${voice.personalities}`,
              );
            return {
              exitCode: 0,
              stdout: rows.join("\n") || "No matching voices.",
            };
          } catch (cause) {
            return {
              exitCode: 1,
              stderr: cause instanceof Error ? cause.message : String(cause),
            };
          }
        }
        default:
          return {
            exitCode: 1,
            stderr:
              "Usage:\n  bb read-aloud status\n  bb read-aloud voices [filter]",
          };
      }
    },
  });

  bb.onDispose(() => {
    clearInterval(expirationTimer);
    for (const job of jobs.values()) job.dispose();
    jobs.clear();
  });
}
