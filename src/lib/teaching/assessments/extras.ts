import type { SupervisionLevel } from "@/lib/teaching/assessments/content";
import { EMPTY_ANSWER, type CantReason, type InboxAnswer } from "@/lib/teaching/assessments/inbox";

/*
 * Page-memory state for the two added sample views (the consultant inbox and the term overview). It sits
 * beside the sample's own reducer rather than inside it, so the end-of-term story stays untouched. Nothing
 * here is stored or sent: a reload starts again, as the rest of the sample does.
 */

export interface ExtrasState {
  readonly answers: Readonly<Record<string, InboxAnswer>>;
  /** Reminder keys from reminderKey(): doctor, form and made-up day. */
  readonly reminded: readonly string[];
}

export type ExtrasAction =
  | { type: "inbox-send"; id: string; level: SupervisionLevel; text: string }
  | { type: "inbox-commit"; id: string }
  | { type: "inbox-undo"; id: string }
  | { type: "inbox-cant"; id: string; reason: CantReason }
  | { type: "inbox-restore"; id: string }
  | { type: "remind"; keys: readonly string[] }
  | { type: "unremind"; keys: readonly string[] };

export const initialExtras: ExtrasState = { answers: {}, reminded: [] };

function answer(s: ExtrasState, id: string): InboxAnswer {
  return s.answers[id] ?? EMPTY_ANSWER;
}

function put(s: ExtrasState, id: string, next: InboxAnswer): ExtrasState {
  return { ...s, answers: { ...s.answers, [id]: next } };
}

export function extrasReducer(s: ExtrasState, a: ExtrasAction): ExtrasState {
  switch (a.type) {
    case "inbox-send": {
      const current = answer(s, a.id);
      if (current.status === "sent" || current.status === "sending") return s;
      return put(s, a.id, { ...current, status: "sending", level: a.level, text: a.text, reason: null });
    }
    case "inbox-commit": {
      const current = answer(s, a.id);
      return current.status === "sending" ? put(s, a.id, { ...current, status: "sent" }) : s;
    }
    case "inbox-undo": {
      // Undo keeps the level and the few lines, so reopening it carries on where it was.
      const current = answer(s, a.id);
      return current.status === "sending" ? put(s, a.id, { ...current, status: "waiting" }) : s;
    }
    case "inbox-cant": {
      const current = answer(s, a.id);
      if (current.status === "sent" || current.status === "sending") return s;
      return put(s, a.id, {
        ...current,
        status: a.reason === "not_this_week" ? "later" : "passed",
        reason: a.reason,
      });
    }
    case "inbox-restore": {
      const current = answer(s, a.id);
      return current.status === "passed" || current.status === "later"
        ? put(s, a.id, { ...current, status: "waiting", reason: null })
        : s;
    }
    case "remind": {
      const fresh = a.keys.filter((k) => !s.reminded.includes(k));
      return fresh.length ? { ...s, reminded: [...s.reminded, ...fresh] } : s;
    }
    case "unremind":
      return { ...s, reminded: s.reminded.filter((k) => !a.keys.includes(k)) };
  }
}
