import { createServer } from "node:http";
import { once } from "node:events";
import { timingSafeEqual } from "node:crypto";

export function createRelayServer({
  coordinator,
  director,
  voice,
  token,
  expiresAt,
  now = Date.now,
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
        (method === "speech" && voice)
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
              "content-type": "audio/pcm",
              "x-audio-sample-rate": "24000",
              "cache-control": "no-store",
            });
            for await (const chunk of audio.body) {
              if (controller.signal.aborted) break;
              if (!res.write(chunk))
                await once(res, "drain", { signal: controller.signal });
            }
            res.end();
          } finally {
            await audio.release();
          }
        } catch (e) {
          if (!res.headersSent)
            reply(503, {
              error: e instanceof Error ? e.message : "Assistant unavailable",
            });
          else res.end();
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
