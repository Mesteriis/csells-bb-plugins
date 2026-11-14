import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { diagnostic } from "../lib/diagnostics.mjs";
export function createDiagnostics(path, now = Date.now) {
  let entries = [];
  try {
    entries = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") entries = [];
  }
  const snapshot = () =>
    entries.filter((e) => e.at >= now() - 86400000).slice(-1000);
  function record(input) {
    const event = diagnostic(input, now());
    if (!event) return;
    if (
      Number.isFinite(input.at) &&
      input.at >= 0 &&
      input.at <= 8640000000000000
    )
      event.clientAt = input.at;
    entries = [...snapshot(), event].slice(-1000);
    try {
      writeFileSync(path + ".next", JSON.stringify(entries), { mode: 0o600 });
      renameSync(path + ".next", path);
    } catch {
      console.error("Jarvis diagnostic persistence failed");
    }
  }
  return { record, snapshot };
}
