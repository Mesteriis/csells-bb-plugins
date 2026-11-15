import {pipecatPage} from "./spikes/pipecat/page.mjs";
import {duplexPage} from "./spikes/duplex-page.mjs";
import {duplexVoice} from "./spikes/duplex-voice.mjs";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createCoordinator } from "./coordinator.mjs";

const session = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: z.string(),
  providerId: z.string(),
});
const task = z.object({
  operationId: z.string(),
  prompt: z.string(),
  threadId: z.string().optional(),
  dispatch: z.string(),
  dispatchEnabled: z.boolean(),
  cancellation: z.string(),
  verification: z.string(),
  session: session.optional(),
});
const interaction = z
  .object({
    id: z.string(),
    threadId: z.string(),
    status: z.string(),
    payload: z.object({ kind: z.string() }).passthrough(),
  })
  .passthrough();
export const rpcContract = defineRpcContract({
  assistant: {
    input: z.object({
      action: z.enum([
        "state",
        "start",
        "heartbeat",
        "interrupt",
        "close",
        "watch",
        "quiet",
        "brief",
        "questions",
        "answer",
        "next",
        "talk",
        "ack",
      ]),
      clientId: z.string().uuid(),
      requestId: z.string().uuid().optional(),
      enabled: z.boolean().optional(),
      takeover: z.boolean().optional(),
      text: z.string().max(8000).optional(),
      playbackClaim: z.string().uuid().optional(),
      presentedQuestion: z.string().max(300).optional(),
      utteranceId: z.string().uuid().optional(),
      status: z.enum(["played", "interrupted", "failed"]).optional(),
    }),
    output: z.unknown(),
  },
  sessions: {
    input: z.object({ offset: z.number().int().min(0).max(10000).default(0) }),
    output: z.array(session),
  },
  tasks: { input: z.null(), output: z.array(task) },
  inspect: {
    input: z.object({ threadId: z.string().max(80) }),
    output: z.object({
      session,
      output: z.string(),
      owned: z.boolean(),
      interactions: z.array(z.object({ interaction, revision: z.string() })),
    }),
  },
  delegate: {
    input: z.object({
      operationId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
      prompt: z.string().trim().min(1).max(8000),
    }),
    output: task,
  },
  stop: { input: z.object({ operationId: z.string().max(80) }), output: task },
  reconcile: {
    input: z.object({ operationId: z.string().max(80) }),
    output: task,
  },
  decide: {
    input: z.object({
      operationId: z.string().max(80),
      interactionId: z.string().max(80),
      revision: z.string().length(64),
      decision: z.enum(["allow_once", "deny"]),
    }),
    output: z.object({
      decision: z.string(),
      revision: z.string(),
      state: z.string(),
    }),
  },
});
export type Session = z.infer<typeof session>;
export type Task = z.infer<typeof task>;
export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    projectId: {
      type: "string",
      label: "Project for delegated work",
      default: "",
    },
    environmentId: {
      type: "string",
      label: "Environment for delegated work",
      default: "",
    },
    providerId: {
      type: "string",
      label: "Provider for delegated work",
      default: "",
    },
    relayBaseUrl: {
      type: "string",
      label: "Staging relay loopback URL",
      default: "",
    },
    relayToken: {
      type: "string",
      label: "Staging relay credential",
      secret: true,
      default: "",
    },
  });
  const config = await settings.get();
  let call: (method: string, input: unknown) => Promise<unknown>;
  if (config.relayBaseUrl) {
    const url = new URL(config.relayBaseUrl);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw Error(
        "Staging relay must be a loopback HTTP origin reached through the dedicated SSH tunnel",
      );
    const abort = new AbortController();
    bb.onDispose(() => abort.abort());
    call = async (method, input) => {
      const response = await fetch(new URL(method, url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.relayToken}`,
          "x-jarvis-request":
            typeof (input as { requestId?: string })?.requestId === "string"
              ? (input as { requestId: string }).requestId
              : "",
        },
        body: JSON.stringify(input ?? {}),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]),
        redirect: "error",
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw Error(
          failure?.error ?? `Relay request failed (${response.status})`,
        );
      }
      return response.json();
    };
  } else {
    const coordinator = createCoordinator({
      sdk: bb.sdk,
      store: {
        read: () => bb.storage.kv.get("coordinator-v1"),
        write: (value: unknown) => bb.storage.kv.set("coordinator-v1", value),
      },
      config: { ...config, owner: "jarvis", maxTasks: 100 },
    });
    call = async (method, input) => {
      if (
        ["delegate", "stop", "decide"].includes(method) &&
        (!config.projectId || !config.environmentId || !config.providerId)
      )
        throw Error(
          "Configure the work project, environment and provider first",
        );
      if (method === "assistant")
        throw Error("Configure the conversation relay before starting Jarvis");
      if (method === "tasks") return coordinator.tasks();
      return coordinator[method as Exclude<keyof typeof coordinator, "tasks">](
        input as never,
      );
    };
  }
  bb.rpc.register(rpcContract, {
    assistant: async (input) => call("assistant", input),
    sessions: async (input) =>
      rpcContract.sessions.output.parse(await call("sessions", input)),
    tasks: async () => rpcContract.tasks.output.parse(await call("tasks", {})),
    inspect: async (input) =>
      rpcContract.inspect.output.parse(await call("inspect", input)),
    delegate: async (input) =>
      rpcContract.delegate.output.parse(await call("delegate", input)),
    stop: async (input) =>
      rpcContract.stop.output.parse(await call("stop", input)),
    reconcile: async (input) =>
      rpcContract.reconcile.output.parse(await call("reconcile", input)),
    decide: async (input) =>
      rpcContract.decide.output.parse(await call("decide", input)),
  });
  if (config.relayBaseUrl) {
    bb.http.route("GET", "/pipecat", async () => new Response(pipecatPage, {headers:{"content-type":"text/html; charset=utf-8", "cache-control":"no-store"}}), {auth:"local"});
    bb.http.route("GET", "/pipecat-ice", async () => {
      const r=await fetch("http://127.0.0.1:4844/ice",{headers:{authorization:`Bearer ${config.relayToken}`},signal:AbortSignal.timeout(10000)});
      return new Response(r.body,{status:r.status,headers:{"content-type":"application/json","cache-control":"no-store"}});
    }, {auth:"local"});
    bb.http.route("POST", "/pipecat-offer", async (context) => {
      const raw=await context.req.text();
      if(raw.length>100000) return context.text("Offer too large",413);
      try {
        const r=await fetch("http://127.0.0.1:4844/offer",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${config.relayToken}`},body:raw,signal:AbortSignal.timeout(25000)});
        if(!r.ok) return context.text("Pipecat connection failed; check staging logs",502);
        return new Response(r.body,{headers:{"content-type":"application/json","cache-control":"no-store"}});
      } catch { return context.text("Pipecat service unavailable",503); }
    }, {auth:"local"});
    bb.http.route("GET", "/duplex", async () => new Response(duplexPage.replace("__VOICE__", duplexVoice), {headers:{"content-type":"text/html; charset=utf-8", "cache-control":"no-store"}}), {auth:"local"});
    for (const path of ["speech", "transcribe", "turn", "diagnostics"] as const)
      bb.http.route(
        "POST",
        "/" + path,
        async (context) => {
          const raw = await context.req.text();
          if (raw.length > 2000000)
            return context.text("Audio or speech request is too large", 413);
          let bytes: Uint8Array;
          try {
            if (path === "speech" || path === "diagnostics")
              bytes = new TextEncoder().encode(raw);
            else {
              const input = z
                .object({
                  audio: z
                    .string()
                    .max(1500000)
                    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
                })
                .strict()
                .parse(JSON.parse(raw));
              bytes = Buffer.from(input.audio, "base64");
            }
          } catch {
            return context.text("Invalid voice input", 400);
          }
          const endpoint =
            path === "turn"
              ? "http://127.0.0.1:4843/turn"
              : new URL(path, config.relayBaseUrl).href;
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: {
                "content-type":
                  path === "speech" || path === "diagnostics"
                    ? "application/json"
                    : path === "turn"
                      ? "application/octet-stream"
                      : "audio/wav",
                "x-jarvis-request":
                  context.req.header("x-jarvis-request") ?? "",
                "x-jarvis-client": context.req.header("x-jarvis-client") ?? "",
                "x-jarvis-lease": context.req.header("x-jarvis-lease") ?? "",
                ...(path === "turn"
                  ? {}
                  : { authorization: `Bearer ${config.relayToken}` }),
              },
              body: bytes as BodyInit,
              signal: AbortSignal.any([
                context.req.raw.signal,
                AbortSignal.timeout(60000),
              ]),
              redirect: "error",
            });
            return new Response(response.body, {
              status: response.status,
              headers: {
                "content-type":
                  response.headers.get("content-type") ?? "application/json",
                "cache-control": "no-store",
              },
            });
          } catch {
            return context.json(
              {
                error:
                  "Voice connection failed. Typed conversation is still available.",
              },
              503,
            );
          }
        },
        { auth: "local" },
      );
  }
}
