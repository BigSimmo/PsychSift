import type { EpaObserved, SupervisionLevel } from "@/lib/teaching/assessments/content";
import { EMPTY_ANSWER, type CantReason, type InboxAnswer } from "@/lib/teaching/assessments/inbox";
import type { ReminderRecord } from "@/lib/teaching/assessments/overview";

/*
 * Page-memory state for the two added sample views (the consultant inbox and the term overview). It sits
 * beside the sample's own reducer rather than inside it, so the end-of-term story stays untouched. Nothing
 * here is stored or sent: a reload starts again, as the rest of the sample does.
 */

export interface ExtrasState {
  readonly answers: Readonly<Record<string, InboxAnswer>>;
  /** Reminders made from the term overview, oldest first. Their keys carry the made-up day. */
  readonly reminders: readonly ReminderRecord[];
}

export type ExtrasAction =
  | { type: "inbox-send"; id: string; level: SupervisionLevel; text: string; observed?: EpaObserved; at: string }
  | { type: "inbox-queue"; id: string; level: SupervisionLevel; text: string; observed?: EpaObserved }
  | { type: "inbox-commit"; id: string }
  | { type: "inbox-undo"; id: string }
  | { type: "inbox-cant"; id: string; reason: CantReason; suggestion?: string | null }
  | { type: "inbox-restore"; id: string }
  | { type: "remind"; records: readonly ReminderRecord[] }
  | { type: "unremind"; keys: readonly string[] };

export const initialExtras: ExtrasState = { answers: {}, reminders: [] };

/**
 * Answers kept as To send that can go now. One with no supervision level is left out, never given a made-up
 * level: it stays as To send, and the inbox row says to choose a level.
 */
export function readyToSend(
  answers: Readonly<Record<string, InboxAnswer>>,
): { id: string; level: SupervisionLevel; text: string; observed?: EpaObserved }[] {
  const ready: { id: string; level: SupervisionLevel; text: string; observed?: EpaObserved }[] = [];
  for (const [id, answer] of Object.entries(answers))
    if (answer.status === "queued" && answer.level && answer.observed)
      ready.push({
        id,
        level: answer.level,
        text: answer.text,
        ...(answer.observed ? { observed: answer.observed } : {}),
      });
  return ready;
}

/**
 * The answers as another screen picks them up. A send still in its 10 seconds when its screen closed was
 * cancelled with it (nothing goes once the page that held the Undo has gone), so it is back to waiting,
 * with its level and few lines kept, exactly as Undo leaves it.
 */
export function settleForAnotherScreen(s: ExtrasState): ExtrasState {
  const sending = Object.entries(s.answers).filter(([, a]) => a.status === "sending");
  if (!sending.length) return s;
  const answers = { ...s.answers };
  for (const [id, a] of sending) answers[id] = { ...a, status: "waiting", sentAt: null };
  return { ...s, answers };
}

/** The reminder keys made so far: one a day per form. */
export function remindedKeys(s: ExtrasState): string[] {
  return s.reminders.map((r) => r.key);
}

function answer(s: ExtrasState, id: string): InboxAnswer {
  return s.answers[id] ?? EMPTY_ANSWER;
}

function put(s: ExtrasState, id: string, next: InboxAnswer): ExtrasState {
  return { ...s, answers: { ...s.answers, [id]: next } };
}

const settled = (a: InboxAnswer) => a.status === "sent" || a.status === "sending";

export function extrasReducer(s: ExtrasState, a: ExtrasAction): ExtrasState {
  switch (a.type) {
    case "inbox-send": {
      const current = answer(s, a.id);
      if (settled(current)) return s;
      return put(s, a.id, {
        ...current,
        status: "sending",
        level: a.level,
        text: a.text,
        ...(a.observed ? { observed: a.observed } : {}),
        reason: null,
        suggestion: null,
        sentAt: a.at,
      });
    }
    case "inbox-queue": {
      // Offline: the answer waits on this page as "To send" and goes when the connection is back.
      const current = answer(s, a.id);
      if (settled(current)) return s;
      return put(s, a.id, {
        ...current,
        status: "queued",
        level: a.level,
        text: a.text,
        ...(a.observed ? { observed: a.observed } : {}),
        reason: null,
        suggestion: null,
      });
    }
    case "inbox-commit": {
      const current = answer(s, a.id);
      return current.status === "sending" ? put(s, a.id, { ...current, status: "sent" }) : s;
    }
    case "inbox-undo": {
      // Undo keeps the level and the few lines, so reopening it carries on where it was.
      const current = answer(s, a.id);
      return current.status === "sending" || current.status === "queued"
        ? put(s, a.id, { ...current, status: "waiting", sentAt: null })
        : s;
    }
    case "inbox-cant": {
      const current = answer(s, a.id);
      if (settled(current)) return s;
      const later = a.reason === "not_this_week";
      return put(s, a.id, {
        ...current,
        status: later ? "later" : "passed",
        reason: a.reason,
        suggestion: later ? null : (a.suggestion ?? null),
      });
    }
    case "inbox-restore": {
      const current = answer(s, a.id);
      return current.status === "passed" || current.status === "later"
        ? put(s, a.id, { ...current, status: "waiting", reason: null, suggestion: null })
        : s;
    }
    case "remind": {
      const known = new Set(remindedKeys(s));
      const fresh = a.records.filter((r) => !known.has(r.key));
      return fresh.length ? { ...s, reminders: [...s.reminders, ...fresh] } : s;
    }
    case "unremind":
      return { ...s, reminders: s.reminders.filter((r) => !a.keys.includes(r.key)) };
  }
}
