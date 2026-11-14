// BB 0.49 native questions and the public Codex async-question renderer contract.
// Unknown plugin forms never become generic interaction.respond forwarding.
export function questionForm(interaction) {
  if (interaction.payload.kind === "user_question")
    return { kind: "native", questions: interaction.payload.questions };
  if (
    interaction.origin?.kind !== "plugin" ||
    interaction.origin.pluginId !== "provider-codex" ||
    interaction.origin.rendererId !== "async-question" ||
    interaction.payload.kind !== "plugin"
  )
    return null;
  const questions = interaction.payload.data?.questions;
  if (
    !Array.isArray(questions) ||
    !questions.length ||
    questions.length > 3 ||
    questions.some(
      (q) =>
        typeof q.title !== "string" ||
        !q.title.trim() ||
        q.title.length > 4000 ||
        (q.options != null &&
          (!Array.isArray(q.options) ||
            q.options.some((o) => typeof o !== "string" || !o.trim()))),
    )
  )
    return null;
  return {
    kind: "plugin",
    questions: questions.map((q, i) => ({
      id: `question-${i + 1}`,
      prompt: q.title,
      allowFreeText: true,
      multiSelect: false,
      options: (q.options ?? []).map((label, n) => ({
        value: `option-${n + 1}`,
        label,
      })),
    })),
  };
}
export const questionBinding = (q) =>
  q ? `${q.id}:${q.revision}:${q.part ?? 0}` : null;
