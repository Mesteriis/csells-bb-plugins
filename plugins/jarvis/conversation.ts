export interface Utterance {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  kind?: string;
}
export interface ConversationState {
  watch: boolean;
  quiet: boolean;
  coverage: {
    recent: number;
    total: number;
    complete: boolean;
    observedAt: number;
  } | null;
  history: Utterance[];
  pending: number;
  focus: {
    id: string;
    threadId: string;
    title: string;
    kind: string;
    question?: string;
    payload?: unknown;
  } | null;
  owner: { clientId: string; until: number; leaseKey: string } | null;
  utterance?: Utterance;
}
