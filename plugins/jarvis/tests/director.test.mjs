import { test } from "node:test";
import assert from "node:assert/strict";
import { createDirector } from "../relay/director.mjs";
const clientId = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
function fixture({
  owned = true,
  interaction = null,
  allowWatchedReplies = false,
  model = async () => "Here is your briefing.",
} = {}) {
  let saved = null,
    changed,
    seq = 1,
    output = "Which branch should I use?";
  const calls = [];
  const row = {
    id: "thread",
    title: "Example task",
    status: "idle",
    visibility: "visible",
    updatedAt: Date.now(),
  };
  const sdk = {
    subscribe: ({ callback }) => {
      changed = callback;
      return () => {};
    },
    threads: {
      list: async () => [row],
      get: async () => row,
      output: async () => ({ output }),
      events: { list: async () => [{ seq }] },
      interactions: {
        list: async () => (interaction ? [interaction] : []),
        get: async () => structuredClone(interaction),
        respond: async (args) => {
          calls.push(args);
          interaction.status = "resolved";
        },
      },
      send: async (args) => calls.push(args),
    },
  };
  const store = {
    read: async () => structuredClone(saved),
    write: async (s) => {
      saved = structuredClone(s);
    },
  };
  const coordinator = {
    tasks: async () => (owned ? [{ threadId: "thread" }] : []),
  };
  const make = () =>
    createDirector({ sdk, store, coordinator, model, allowWatchedReplies });
  const d = make();
  const command = (action, extra = {}) =>
    d.command({ action, clientId, ...extra });
  return {
    d,
    command,
    make,
    calls,
    row,
    change() {
      seq++;
      output = "Should I use the new branch?";
      row.updatedAt++;
      changed();
    },
    saved: () => saved,
  };
}
test("one start, brief, and exact owned answer use the real SDK send contract", async () => {
  const f = fixture();
  await f.command("start");
  const b = await f.command("brief");
  assert.equal(b.focus.threadId, "thread");
  assert.match(b.utterance.text, /Which branch/);
  await f.command("ack", { utteranceId: b.utterance.id, status: "played" });
  await f.command("answer", { text: "Use the feature branch" });
  assert.deepEqual(f.calls, [
    {
      threadId: "thread",
      mode: "auto",
      input: [{ type: "text", text: "Use the feature branch", mentions: [] }],
    },
  ]);
});
test("watching a real unrelated thread never authorizes answering it", async () => {
  const f = fixture({ owned: false });
  await f.command("start");
  const q = await f.command("questions");
  await f.command("ack", { utteranceId: q.utterance.id, status: "played" });
  const reply = await f.command("answer", { text: "Proceed" });
  assert.match(reply.utterance.text, /restricted/);
  assert.equal(f.calls.length, 0);
});
test("stale ordinary question cannot receive a voice answer", async () => {
  const f = fixture();
  await f.command("start");
  const q = await f.command("questions");
  await f.command("ack", { utteranceId: q.utterance.id, status: "played" });
  f.change();
  await assert.rejects(f.command("answer", { text: "Yes" }), /changed/);
  assert.equal(f.calls.length, 0);
});
test("explicit device takeover fences old commands and active audio", async () => {
  const f = fixture();
  const s = await f.command("start");
  const signal = f.d.mediaSignal(clientId, s.owner.leaseKey);
  await assert.rejects(
    f.d.command({ action: "start", clientId: other }),
    /another device/,
  );
  await f.d.command({ action: "start", clientId: other, takeover: true });
  assert.equal(signal.aborted, true);
  await assert.rejects(f.command("answer", { text: "Yes" }), /no longer owns/);
  assert.throws(() => f.d.mediaSignal(other, s.owner.leaseKey), /Expired/);
});
test("interrupt discards a late model result", async () => {
  let resolve, started;
  const ready = new Promise((r) => (started = r));
  const f = fixture({
    model: () =>
      new Promise((r) => {
        resolve = r;
        started();
      }),
  });
  await f.command("start");
  const brief = f.command("brief");
  await ready;
  await f.command("interrupt");
  resolve("stale");
  await assert.rejects(brief, /superseded/);
  assert.equal(f.saved().history.length, 0);
});
test("unheard updates survive process restart and complete only on playback ack", async () => {
  const f = fixture();
  await f.command("start");
  await f.command("watch", { enabled: true });
  f.change();
  const update = await f.command("next");
  assert.equal(update.utterance.kind, "update");
  f.d.dispose();
  const restart = f.make();
  await restart.command({ action: "start", clientId });
  const replay = await restart.command({ action: "next", clientId });
  assert.equal(replay.utterance.id, update.utterance.id);
  await restart.command({
    action: "ack",
    clientId,
    utteranceId: replay.utterance.id,
    status: "played",
  });
  assert.equal(
    (await restart.command({ action: "next", clientId })).utterance,
    undefined,
  );
});
test("command schema rejects unexpected authority fields", async () => {
  const f = fixture();
  await assert.rejects(
    f.command("start", { url: "https://arbitrary.example" }),
    /Invalid command/,
  );
  await assert.rejects(
    f.command("watch", { enabled: "false" }),
    /Invalid mode/,
  );
});
test("concurrent duplicate answers dispatch at most once", async () => {
  const f = fixture();
  await f.command("start");
  const q = await f.command("questions");
  await f.command("ack", { utteranceId: q.utterance.id, status: "played" });
  await Promise.allSettled([
    f.command("answer", { text: "Branch A" }),
    f.command("answer", { text: "Branch A" }),
  ]);
  assert.equal(f.calls.length, 1);
});

test("an answer cannot execute before the focused question finishes playing", async () => {
  const f = fixture();
  await f.command("start");
  await f.command("questions");
  const result = await f.command("answer", { text: "Yes" });
  assert.match(result.utterance.text, /read the current question/);
  assert.equal(f.calls.length, 0);
});

test("Codex async questions are read one by one and submitted once through respond", async () => {
  const interaction = {
    id: "pending",
    threadId: "thread",
    status: "pending",
    origin: {
      kind: "plugin",
      pluginId: "provider-codex",
      rendererId: "async-question",
    },
    payload: {
      kind: "plugin",
      data: {
        questions: [
          { title: "Which color?", options: ["Blue", "Green"] },
          { title: "Which size?", options: null },
        ],
      },
    },
  };
  const f = fixture({ interaction });
  await f.command("start");
  let q = await f.command("questions");
  assert.match(q.utterance.text, /question 1 of 2/);
  await f.command("ack", { utteranceId: q.utterance.id, status: "played" });
  q = await f.command("answer", { text: "Blue." });
  assert.equal(f.calls.length, 0);
  assert.match(q.utterance.text, /question 2 of 2/);
  const early = await f.command("answer", { text: "Large" });
  assert.match(early.utterance.text, /read the current question/);
  await f.command("ack", { utteranceId: early.utterance.id, status: "played" });
  await f.command("answer", { text: "Large" });
  assert.deepEqual(f.calls, [
    {
      threadId: "thread",
      interactionId: "pending",
      value: {
        answers: {
          "question-1": { selected: ["option-1"] },
          "question-2": { selected: [], freeText: "Large" },
        },
      },
    },
  ]);
});
test("an unrelated plugin cannot impersonate the supported question renderer", async () => {
  const interaction = {
    id: "pending",
    threadId: "thread",
    status: "pending",
    origin: { kind: "plugin", pluginId: "other", rendererId: "async-question" },
    payload: {
      kind: "plugin",
      data: { questions: [{ title: "Run something?", options: null }] },
    },
  };
  const f = fixture({ interaction });
  await f.command("start");
  const q = await f.command("questions");
  assert.match(q.utterance.text, /provider-specific/);
  await f.command("ack", { utteranceId: q.utterance.id, status: "played" });
  await f.command("answer", { text: "Yes" });
  assert.equal(f.calls.length, 0);
});

test("a thread first discovered after watch starts creates an update", async () => {
  const f = fixture();
  await f.command("start");
  await f.command("watch", { enabled: true });
  f.row.id = "new-thread";
  f.change();
  const result = await f.command("next");
  assert.equal(result.utterance.kind, "update");
  assert.equal(result.focus.threadId, "new-thread");
});

test("explicitly enabled watched replies retain exact-question checks", async () => {
  const f = fixture({ owned: false, allowWatchedReplies: true });
  await f.command("start");
  const q = await f.command("questions");
  await f.command("ack", { utteranceId: q.utterance.id, status: "played" });
  await f.command("answer", { text: "Use blue" });
  assert.equal(f.calls.length, 1);
});
