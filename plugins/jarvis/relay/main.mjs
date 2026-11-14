import {
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createCoordinator } from "../coordinator.mjs";
import { createRelayServer } from "./http.mjs";
import { createDirector } from "./director.mjs";
import { createTalker } from "./model.mjs";
import { createVoice } from "./voice.mjs";

// Operator-owned private config, never accepted over HTTP. Use the public
// installed bb-app export; no dependency on a private BB workspace package.
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { BBSdk } = await import(pathToFileURL(config.sdkModule).href);
const sdk = new BBSdk({ timeoutMs: 15000 });
const model = createTalker({
  baseUrl: process.env.BB_ACCOUNT_POOL_PARENT_URL,
  token: process.env.BB_ACCOUNT_POOL_PARENT_TOKEN,
  model: config.talkerModel,
});
mkdirSync(dirname(config.journal), { recursive: true, mode: 0o700 });
// Single writer. After an unclean exit an operator must confirm the old PID
// has exited before removing its lock. Never guess that an extant lock is stale.
const lock = openSync(`${config.journal}.lock`, "wx", 0o600);
writeFileSync(lock, String(process.pid));
closeSync(lock);
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
  token: config.token,
  expiresAt: Date.parse(config.expiresAt),
});
server.listen(config.port, "127.0.0.1", () =>
  console.log(`Jarvis restricted relay listening on loopback:${config.port}`),
);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  director.dispose();
  server.close(() => {
    unlinkSync(`${config.journal}.lock`);
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
