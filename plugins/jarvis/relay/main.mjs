import {
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createCoordinator } from "../coordinator.mjs";
import { createRelayServer } from "./http.mjs";
import { createDirector } from "./director.mjs";
import { createTalker } from "./model.mjs";
import { createDiagnostics } from "./diagnostics.mjs";
import { createVoice } from "./voice.mjs";

// Operator-owned private config, never accepted over HTTP. Use the public
// installed bb-app export; no dependency on a private BB workspace package.
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!Number.isFinite(Date.parse(config.expiresAt)))
  throw Error("Invalid relay expiry");
if (Date.now() >= Date.parse(config.expiresAt)) process.exit(0);
const diagnostics = createDiagnostics(config.journal + ".diagnostics");
diagnostics.record({ stage: "relay", phase: "start", pid: process.pid });
process.on("uncaughtExceptionMonitor", () =>
  diagnostics.record({ stage: "relay", phase: "failed", pid: process.pid }),
);
process.on("exit", (code) =>
  diagnostics.record({
    stage: "relay",
    phase: "exit",
    pid: process.pid,
    exitCode: code,
  }),
);
const { BBSdk } = await import(pathToFileURL(config.sdkModule).href);
const sdk = new BBSdk({ timeoutMs: 15000 });
const model = createTalker({
  baseUrl: config.poolBaseUrl ?? process.env.BB_ACCOUNT_POOL_PARENT_URL,
  // Read on the owning host, without copying credentials into service config
  // or the candidate VM. Re-read per request to honor host token rotation.
  token: config.poolTokenPath
    ? () => JSON.parse(readFileSync(config.poolTokenPath, "utf8")).value
    : process.env.BB_ACCOUNT_POOL_PARENT_TOKEN,
  model: config.talkerModel,
  onTiming: (timing) => console.log(JSON.stringify({stage:"model",at:new Date().toISOString(),...timing})),
});
mkdirSync(dirname(config.journal), { recursive: true, mode: 0o700 });
// The exclusive loopback listener is the single-writer lock. Journal reads
// and writes are lazy and happen only after bind succeeds. A crashed process
// releases the socket, so supervisor restart cannot be stranded by a PID file.
function journalStore(path) {
  return {
    read: async () => {
      try {
        return JSON.parse(readFileSync(path, "utf8"));
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    write: async (state) => {
      const temp = `${path}.next`;
      const fd = openSync(temp, "w", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(state));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, path);
      const dir = openSync(dirname(path), "r");
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    },
  };
}
const store = journalStore(config.journal);
const coordinator = createCoordinator({ sdk, store, config });
const director = createDirector({
  sdk,
  model,
  coordinator,
  store: journalStore(config.journal + ".assistant"),
  allowWatchedReplies: config.allowWatchedReplies === true,
});
const voice = createVoice({
  sdk,
  baseUrl: config.voiceBaseUrl,
  adminKeyPath: config.voiceAdminKeyPath,
});
const server = createRelayServer({
  coordinator,
  director,
  voice,
  diagnostics,
  token: config.token,
  expiresAt: Date.parse(config.expiresAt),
});
server.on("error", () => {
  diagnostics.record({ stage: "relay", phase: "failed", pid: process.pid });
  process.exit(1);
});
server.listen(config.port, "127.0.0.1", () =>
  console.log(`Jarvis restricted relay listening on loopback:${config.port}`),
);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  director.dispose();
  setTimeout(() => process.exit(0), 5000).unref();
  server.close(() => {
    process.exit(0);
  });
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
const expiry = setTimeout(
  close,
  Math.max(0, Date.parse(config.expiresAt) - Date.now()),
);
expiry.unref();
