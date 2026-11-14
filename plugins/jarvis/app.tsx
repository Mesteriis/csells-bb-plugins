import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { ConversationState } from "./conversation";
import { VoiceConversation } from "./lib/conversation";
import { Orb } from "./components/Orb";

function Jarvis() {
  const rpc = useRpc<typeof rpcContract>();
  const voiceRef = useRef<VoiceConversation | null>(null);
  if (!voiceRef.current)
    voiceRef.current = new VoiceConversation(
      (input) =>
        rpc.call(
          "assistant",
          input as Parameters<typeof rpc.call<"assistant">>[1],
        ) as Promise<ConversationState>,
    );
  const voice = voiceRef.current;
  const view = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  const [draft, setDraft] = useState("");
  useEffect(
    () => () => {
      void voice.stop();
    },
    [voice],
  );
  const status = view.hearing
    ? "Listening to you"
    : view.speaking
      ? "Speaking"
      : view.thinking
        ? "Thinking"
        : view.listening
          ? "Listening"
          : view.active
            ? "Ready · microphone off"
            : "Ready when you are";
  const mode = view.hearing
    ? "hearing"
    : view.speaking
      ? "speaking"
      : view.thinking
        ? "thinking"
        : view.listening
          ? "listening"
          : "off";
  const button =
    "min-h-12 rounded-xl border px-5 py-3 text-base hover:bg-muted disabled:opacity-50";
  return (
    <section
      aria-label="Jarvis conversation"
      className="mx-auto w-full min-w-0 max-w-4xl space-y-6 overflow-auto px-4 py-6 sm:px-8"
      style={{ overflowWrap: "anywhere" }}
    >
      <header className="flex flex-col items-center text-center">
        <Orb mode={mode} size={136} />
        <h1 className="text-3xl font-semibold">Jarvis</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Your agents, one conversation.
        </p>
        <p className="mt-3" aria-live="polite">
          {status}
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="min-h-16 rounded-xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground"
          onClick={() =>
            view.listening ? void voice.releaseMic() : void voice.start()
          }
        >
          {view.listening ? "Stop listening" : "Start Jarvis"}
        </button>
        <button className={button} onClick={() => void voice.act("brief")}>
          Brief me
        </button>
        <button
          className={button}
          aria-pressed={view.state?.watch ?? false}
          onClick={() =>
            void voice.act("watch", { enabled: !view.state?.watch })
          }
        >
          {view.state?.watch ? "Watching · pause updates" : "Keep me updated"}
        </button>
        <button className={button} onClick={() => void voice.act("questions")}>
          What needs me?
        </button>
      </div>
      {!view.active && (
        <p className="text-center text-sm text-muted-foreground">
          Start once to hear a briefing, watch recent work, and answer agent
          questions by voice. Keep this page open.
        </p>
      )}
      {view.active && (
        <div className="flex flex-wrap justify-center gap-3">
          <button
            className={button}
            aria-pressed={view.state?.quiet ?? false}
            onClick={() =>
              void voice.act("quiet", { enabled: !view.state?.quiet })
            }
          >
            {view.state?.quiet ? "Resume spoken updates" : "Quiet updates"}
          </button>
          <button className={button} onClick={() => void voice.interrupt()}>
            Stop speaking
          </button>
          <button
            className={button}
            onClick={() =>
              void voice.act("talk", { text: "Jarvis, stop work" })
            }
          >
            Stop delegated work
          </button>
          <button className={button} onClick={() => void voice.stop()}>
            End conversation
          </button>
        </div>
      )}
      {view.error.includes("another device") && (
        <button className={button} onClick={() => void voice.start(true)}>
          Use Jarvis on this device
        </button>
      )}
      {view.error && (
        <p role="alert" className="rounded-xl border border-destructive p-4">
          {view.error}
        </p>
      )}
      {view.transcript && (
        <p className="rounded-xl bg-muted p-4">
          <span className="font-medium">You: </span>
          {view.transcript}
        </p>
      )}
      {view.caption && (
        <p
          className="rounded-xl border p-5 text-xl leading-relaxed"
          aria-live="polite"
        >
          {view.caption}
        </p>
      )}
      {view.state?.focus && (
        <section className="rounded-xl border p-4">
          <h2 className="font-semibold">
            Waiting for your answer · {view.state.focus.title}
          </h2>
          <p className="mt-2">
            {view.state.focus.kind === "approval"
              ? "Say “approve once” or “deny” for this action."
              : "Your next answer goes to this question."}
          </p>
          <details className="mt-3">
            <summary>Question details</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm">
              {view.state.focus.question ??
                JSON.stringify(view.state.focus.payload, null, 2)}
            </pre>
          </details>
        </section>
      )}
      <details>
        <summary className="cursor-pointer text-muted-foreground">
          Type instead
        </summary>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) {
              void voice.act("talk", { text: draft });
              setDraft("");
            }
          }}
        >
          <input
            aria-label="Message Jarvis"
            className="min-w-0 flex-1 rounded-xl border bg-background p-3"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Talk to Jarvis…"
          />
          <button className={button}>Send</button>
        </form>
      </details>
      {view.state?.coverage && (
        <p className="text-sm text-muted-foreground">
          Watching recent work: {view.state.coverage.recent} of{" "}
          {view.state.coverage.total} visible threads were active in the last 72
          hours or still need attention.{" "}
          {view.state.coverage.complete
            ? ""
            : "Some sessions could not be read; this briefing is incomplete."}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-muted-foreground">
          Conversation
        </summary>
        <ol className="mt-3 space-y-3">
          {view.state?.history.map((message) => (
            <li key={message.id} className="rounded-xl border p-4">
              <span className="font-medium">
                {message.role === "user" ? "You" : "Jarvis"}:{" "}
              </span>
              {message.text}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "jarvis",
    title: "Jarvis",
    icon: "AudioLines",
    path: "staff",
    component: Jarvis,
  });
});
