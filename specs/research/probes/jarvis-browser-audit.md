# Real-service browser audit

This opt-in audit tests the actual staged Jarvis BB panel. It does not mock the
STT, director model, Alfred, BB or LiveKit services. It also runs one explicit
browser-boundary HTTP503 fault to test text fallback; that case is labeled and
cannot count as a successful model round trip.

Run only against an idle disposable candidate with normal real service access.
The busy-stop check clicks Stop delegated work. Verify every relay-owned task is
test-owned first; never point this at unrelated work or a production deployment.
The 2026-11-15 run verified all seven existing owned test tasks were already
stopped before starting. The runner creates no BB workers and tests no external
sends, purchases or infrastructure modifications.

Requires Node, Playwright Core, an isolated Chrome for Testing executable, and
known PCM WAV inputs. Set absolute paths explicitly; no secrets belong in these
environment variables. The review URL should be the BB navigation panel, ending
in `/plugins/jarvis/staff`, using a normal authorized local/staging interface.
Remote public access requires the usual owner authentication; a 401 is not a
rendering pass.

```sh
export JARVIS_AUDIT_DIR=/absolute/task-owned/evidence-directory
export JARVIS_PLAYWRIGHT_MODULE=/absolute/path/node_modules/playwright-core/index.mjs
export JARVIS_CHROME='/absolute/path/to/Chrome for Testing'
export JARVIS_REVIEW_URL='http://127.0.0.1:STAGING_PORT/plugins/jarvis/staff'
export JARVIS_SOURCE_REVISION=EXACT_RUNNING_COMMIT
export JARVIS_TEST_OWNED_WORK=1
node specs/research/probes/jarvis-audit-fixtures.mjs
node specs/research/probes/jarvis-browser-audit.mjs
```

The optional fixture generator uses macOS `say` (default installed voice). On
other hosts, supply matching `<case-id>.wav` files from the checked-in case list.
Keep their generator/version, sample format and hashes with the run. Never label
synthetic input as a physical microphone test. The audit uses a silent generated
capture stream and injects known speech; this bypasses physical AEC.

Predeclared content checks: ten known prompts, three repetitions, one response per
turn, expected answer, decoded nonzero remote audio, completed framework playout,
and no pipeline error. It measures detected user-end to decoded browser audio,
not physical mouth-to-speaker latency. It checks the rendered mobile-width panel,
opening briefing, stop during briefing, second-owner rejection, text with capture
off, and text fallback when session creation returns HTTP 503.

`browser-audit.json` checkpoints after each turn and records failures. The script
exits nonzero for a failed behavioral check, failed turn, fatal error, page error
or latency gate (p50<=800ms and p95<2s, with 30 samples).
A successful exit is not a release pass if any required scenario in the [coverage matrix](../jarvis-scenario-matrix-2026-11-15.md)
remains unmet. Small samples and this simple prompt mix are not production SLOs.

On 2026-11-15, 30/30 voice turns passed, but two browser checks failed and both
latency targets failed. The nonzero result is intentional evidence of product
failures; do not change assertions to turn it green. The generic error text is
not accepted as a successful stop, and disabled Send is not a text fallback.

The runner closes its own pages/browser and ends its conversation in `finally`.
Verify the companion reports zero test sessions afterward. Raw evidence can
include real briefing context if a turn is misrouted; retain it privately outside
the VM and commit only sanitized results. No packet/JWT dumps or credentials are
needed. Preserve failed runs and their exact candidate revision.

This is the first durable real-service baseline, not the complete release suite.
Missing approval, concurrent-worker, long-pause/noise, recovery, memory, recall,
events, schedules and real-task outcome journeys remain explicit in the matrix.


After the control repair, the outage case first fails voice session creation,
then clicks Use text and requires a real model answer with microphone controls
disabled. It does not count merely enabling Send as recovery. The old failing
baseline remains in Git and the dated evidence file.

For focused control regression, run `jarvis-control-regression.mjs` with the same
browser/output/review environment variables, plus `JARVIS_CONTROL_MODE=voice`,
`text-outage`, or `process`. The voice mode checks stop during preparation and
decoded playback, and rejects a competing text owner. For text-outage, the operator
must stop only the owned candidate companion first and restore it in a shell trap;
the test does not alter services itself. It verifies cold loading, a real model
answer, scoped Stop, and zero media-session requests.

Process mode delegates one real worker through the browser/model, verifies the
worker PID and command against `JARVIS_WORKER_PID_FILE` (a fresh absolute path in
task-owned storage), then observes process death after clicking Stop during the
briefing. The worker sleeps at most 240 seconds and never detaches. This requires
the worker and test runner to share that task-owned path/host; do not substitute a
fake process if the environment differs. Failed runs retain evidence and never
silently retry delegation. `JARVIS_RESUME_WORKER=1` allows a failed harness run to
continue against that same verified PID without spawning a duplicate. It must not
be used after that process exits. This is a button-driven foreground-process test,
not proof of spoken cancellation, detached-process cleanup or future descendants.
