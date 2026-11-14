import { createServer } from "node:http";
import { once } from "node:events";
import { pcmFrame } from "../lib/pcm-stream.mjs";
import { timingSafeEqual, randomUUID } from "node:crypto";

export function createRelayServer({
  coordinator,
  director,
  voice,
  token,
  expiresAt,
  now = Date.now,
  diagnostics = { record: () => {}, snapshot: () => [] },
}) {
  if (
    typeof token !== "string" ||
    token.length < 40 ||
    !Number.isFinite(expiresAt)
  )
    throw Error("Invalid relay credential");
  const expected = Buffer.from(`Bearer ${token}`);
  const methods = new Set([
    "sessions",
    "inspect",
    "tasks",
    "delegate",
    "reconcile",
    "stop",
    "decide",
  ]);
  return createServer(
    { requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 },
    async (req, res) => {
      const reply = (status, body) => {
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(JSON.stringify(body));
      };
      const supplied = Buffer.from(req.headers.authorization ?? "");
      if (
        now() >= expiresAt ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        return reply(401, {
          error: "Unauthorized or expired relay credential",
        });
      if (req.headers.origin || req.method !== "POST")
        return reply(403, { error: "Server-to-server only" });
      const method = req.url?.slice(1);
      const requestId = /^[a-f0-9-]{36}$/i.test(
        req.headers["x-jarvis-request"] ?? "",
      )
        ? req.headers["x-jarvis-request"]
        : randomUUID();
      const started = now();
      const stage = ["speech", "transcribe"].includes(method)
        ? method
        : "command";
      const record = (phase, extra = {}) =>
        diagnostics.record({
          stage,
          phase,
          requestId,
          clientId: req.headers["x-jarvis-client"],
          durationMs: now() - started,
          ...extra,
        });
      if (method !== "diagnostics") {
        record("start");
        res.on("finish", () =>
          record(res.statusCode >= 400 ? "failed" : "complete", {
            httpStatus: res.statusCode,
          }),
        );
      }
      if (method === "transcribe" && voice) {
        try {
          const ownership = director.mediaSignal(
            req.headers["x-jarvis-client"],
            req.headers["x-jarvis-lease"],
          );
          if (req.headers["content-type"] !== "audio/wav")
            return reply(400, { error: "WAV audio required" });
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 2000000) return reply(413, { error: "Audio too long" });
            chunks.push(chunk);
          }
          const result = await voice.transcribe(
            Buffer.concat(chunks),
            req.headers["content-type"] ?? "audio/wav",
            AbortSignal.any([ownership, AbortSignal.timeout(30000)]),
          );
          ownership.throwIfAborted();
          return reply(200, result);
        } catch {
          return reply(503, {
            error: "Transcription failed. Please try again.",
          });
        }
      }
      if (req.headers["content-type"] !== "application/json")
        return reply(403, { error: "JSON required" });
      if (
        (method === "assistant" && director) ||
        (method === "speech" && voice) ||
        method === "diagnostics"
      ) {
        try {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16384) return reply(413, { error: "Request too large" });
            chunks.push(chunk);
          }
          const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (method === "diagnostics") {
            if (!Array.isArray(input.events) || input.events.length > 30)
              return reply(400, { error: "Invalid diagnostic batch" });
            for (const event of input.events) diagnostics.record(event);
            return reply(200, { accepted: true });
          }
          if (method === "assistant")
            return reply(200, await director.command(input));
          if (!input || Object.keys(input).some((k) => k !== "text"))
            return reply(400, { error: "Invalid speech request" });
          const ownership = director.mediaSignal(
            req.headers["x-jarvis-client"],
            req.headers["x-jarvis-lease"],
          );
          const controller = new AbortController();
          ownership.addEventListener("abort", () => controller.abort(), {
            once: true,
            signal: controller.signal,
          });
          res.on("close", () => controller.abort());
          const audio = await voice.speech(input.text, controller.signal);
          try {
            res.writeHead(200, {
              "content-type": "application/x-jarvis-pcm",
              "x-audio-sample-rate": "24000",
              "cache-control": "no-store",
            });
            let bytes = 0;
            for await (const chunk of audio.body) {
              controller.signal.throwIfAborted();
              if (!bytes) record("first-byte");
              bytes += chunk.length;
              if (!res.write(pcmFrame(chunk)))
                await once(res, "drain", { signal: controller.signal });
            }
            controller.signal.throwIfAborted();
            record("ready", { bytes });
          } finally {
            await audio.release();
          }
          controller.signal.throwIfAborted();
          res.end(pcmFrame(new Uint8Array(0)));
        } catch (e) {
          record("failed");
          if (!res.headersSent)
            reply(503, {
              error: e instanceof Error ? e.message : "Assistant unavailable",
            });
          else res.destroy();
        }
        return;
      }
      if (!methods.has(method))
        return reply(404, { error: "Unknown operation" });
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) {
            reply(413, { error: "Request too large" });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!input || typeof input !== "object" || Array.isArray(input))
          return reply(400, { error: "Object required" });
        // No parameter may select an SDK method, host, URL, project, environment,
        // credentials or file path. Coordinator methods select all authority.
        const keys = {
          sessions: ["offset"],
          inspect: ["threadId"],
          tasks: [],
          delegate: ["operationId", "prompt"],
          reconcile: ["operationId"],
          stop: ["operationId"],
          decide: ["operationId", "interactionId", "revision", "decision"],
        }[method];
        if (Object.keys(input).some((key) => !keys.includes(key)))
          return reply(400, { error: "Unknown field" });
        const value = await coordinator[method](input);
        if (now() >= expiresAt)
          return reply(401, { error: "Relay credential expired" });
        reply(200, value);
      } catch {
        reply(409, {
          error:
            "Operation rejected or outcome uncertain; inspect current task state before retrying",
        });
      }
    },
  );
}
