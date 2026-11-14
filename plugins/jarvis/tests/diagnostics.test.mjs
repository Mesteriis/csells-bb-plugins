import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnostic } from "../lib/diagnostics.mjs";
import { createDiagnostics } from "../relay/diagnostics.mjs";
test("diagnostics reject content, credentials, arbitrary errors, and invalid metadata", () => {
  const record = diagnostic(
    {
      stage: "speech",
      phase: "failed",
      text: "private transcript",
      error: "Bearer secret",
      leaseKey: "private",
      requestId: "not-a-uuid",
      browser: "secret",
      durationMs: NaN,
      httpStatus: 503,
    },
    123,
  );
  assert.deepEqual(record, {
    at: 123,
    stage: "speech",
    phase: "failed",
    httpStatus: 503,
  });
  assert.equal(diagnostic({ stage: "secret", phase: "failed" }), null);
});
test("diagnostics survive restart, cap records and expire after one day", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-diag-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "events.json");
  let now = 1000;
  const d = createDiagnostics(path, () => now);
  for (let i = 0; i < 1010; i++)
    d.record({ stage: "relay", phase: "start", pid: i });
  assert.equal(JSON.parse(readFileSync(path)).length, 1000);
  const restarted = createDiagnostics(path, () => now);
  assert.equal(restarted.snapshot().length, 1000);
  now += 86400001;
  assert.equal(restarted.snapshot().length, 0);
  restarted.record({ stage: "relay", phase: "ready" });
  assert.equal(JSON.parse(readFileSync(path)).length, 1);
});

test("uploaded diagnostics preserve device event time separately from receipt time", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-diag-delay-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const d = createDiagnostics(join(dir, "events.json"), () => 200000);
  d.record({ stage: "media", phase: "running", at: 80000 });
  assert.equal(d.snapshot()[0].clientAt, 80000);
  assert.equal(d.snapshot()[0].at, 200000);
});
