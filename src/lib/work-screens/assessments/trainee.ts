import { extrasReducer, initialExtras, type ExtrasAction, type ExtrasState } from "@/lib/teaching/assessments/extras";
import { inboxRequests, isWaiting, type InboxRequest } from "@/lib/teaching/assessments/inbox";
import type { AssessmentsState } from "@/lib/teaching/assessments/model";
import { doctorTimeline, overviewDoctors, type OverviewDoctor } from "@/lib/teaching/assessments/overview";
import { SAMPLE_SUPERVISOR } from "@/lib/teaching/assessments/sample";
import type {
  ExampleSupervisionByDoctor,
  ExampleSupervisionCorrection as SampleCorrection,
  ExampleSupervisionSession as SampleSession,
} from "@/lib/example-data/datasets/assessments-supervision";

export type {
  ExampleSupervisionCorrection as SampleCorrection,
  ExampleSupervisionSession as SampleSession,
} from "@/lib/example-data/datasets/assessments-supervision";

/*
 * Assessments › one doctor, as their supervisor sees it (`/teaching/assessments/trainee/[id]`, mock-ups
 * assess_sup and assess_correct): what the doctor has asked of you, the supervision sessions waiting
 * for your confirmation (your sign-off), a correction the doctor proposed, and a way to ask the doctor
 * to correct a record. Reached from the consultant inbox.
 *
 * MADE-UP SAMPLE ONLY, in page memory. The doctors, their status and their requests are the sample's
 * own (`overview.ts`, `inbox.ts`). The supervision sessions are example rows for this screen, read
 * through the shared registry (`loadExampleDataset("assessments.supervision")`) with ids starting
 * "example:", and passed in here: supervision for real lives in Teaching › Supervision, and a supervisor's
 * trainees have no store yet. Nothing here is kept or sent.
 */

export type SessionStatus = "waiting" | "sending" | "queued" | "confirmed" | "asked";

export type CorrectionStatus = "waiting" | "confirmed" | "later";

export const ASK_FIELDS: readonly { id: string; label: string }[] = [
  { id: "length", label: "Length" },
  { id: "date", label: "Date" },
  { id: "kind", label: "Individual or group" },
  { id: "topics", label: "Topics" },
];

export interface CorrectionAsk {
  readonly field: string;
  readonly note: string;
}

export interface TraineeState {
  readonly extras: ExtrasState;
  readonly sessions: Readonly<Record<string, SessionStatus>>;
  readonly asks: Readonly<Record<string, CorrectionAsk>>;
  readonly corrections: Readonly<Record<string, CorrectionStatus>>;
}

export const initialTraineeState: TraineeState = { extras: initialExtras, sessions: {}, asks: {}, corrections: {} };

export type TraineeAction =
  | { type: "extras"; action: ExtrasAction }
  | { type: "confirm"; id: string; offline: boolean }
  /** Back online: a confirmation kept as To send starts its 10 second Undo. */
  | { type: "confirm-send"; id: string }
  | { type: "confirm-commit"; id: string }
  | { type: "confirm-undo"; id: string }
  | { type: "ask"; id: string; ask: CorrectionAsk }
  | { type: "ask-undo"; id: string }
  | { type: "correction"; id: string; to: Exclude<CorrectionStatus, "waiting"> }
  /** Undo puts the correction back as it was before (waiting, or Later). */
  | { type: "correction-undo"; id: string; to: Exclude<CorrectionStatus, "confirmed"> };

/**
 * The doctor pages' own records as the page opens again in this tab. A confirmation still in its
 * 10 seconds when the page closed was cancelled with it, so it is waiting again. One kept as To send
 * while offline stays kept.
 */
export function reopenTraineeState(kept: Omit<TraineeState, "extras">, extras: ExtrasState): TraineeState {
  const sessions: Record<string, SessionStatus> = {};
  for (const [id, status] of Object.entries(kept.sessions)) sessions[id] = status === "sending" ? "waiting" : status;
  return { ...kept, sessions, extras };
}

export function sessionStatus(state: TraineeState, session: SampleSession): SessionStatus {
  return state.sessions[session.id] ?? (session.confirmed ? "confirmed" : "waiting");
}

export function traineeReducer(state: TraineeState, a: TraineeAction): TraineeState {
  const put = (id: string, status: SessionStatus) => ({ ...state, sessions: { ...state.sessions, [id]: status } });
  const current = (id: string) => state.sessions[id] ?? "waiting";
  switch (a.type) {
    case "extras":
      return { ...state, extras: extrasReducer(state.extras, a.action) };
    case "confirm":
      return current(a.id) === "waiting" ? put(a.id, a.offline ? "queued" : "sending") : state;
    case "confirm-send":
      return current(a.id) === "queued" ? put(a.id, "sending") : state;
    case "confirm-commit":
      return current(a.id) === "sending" || current(a.id) === "queued" ? put(a.id, "confirmed") : state;
    case "confirm-undo":
      return current(a.id) === "sending" || current(a.id) === "queued" ? put(a.id, "waiting") : state;
    case "ask": {
      if (!a.ask.field || current(a.id) !== "waiting") return state;
      return { ...put(a.id, "asked"), asks: { ...state.asks, [a.id]: a.ask } };
    }
    case "ask-undo": {
      if (current(a.id) !== "asked") return state;
      const asks = { ...state.asks };
      delete asks[a.id];
      return { ...put(a.id, "waiting"), asks };
    }
    case "correction": {
      // A correction left for Later can still be confirmed. Only an open one can be left for Later.
      const was = state.corrections[a.id] ?? "waiting";
      const allowed = a.to === "confirmed" ? was !== "confirmed" : was === "waiting";
      return allowed ? { ...state, corrections: { ...state.corrections, [a.id]: a.to } } : state;
    }
    case "correction-undo":
      return { ...state, corrections: { ...state.corrections, [a.id]: a.to } };
  }
}

export interface TraineeView {
  readonly row: OverviewDoctor;
  /**
   * True when the sample supervisor ("you") supervises this doctor, so you can confirm supervision and
   * review corrections. Requests the doctor asked of you show either way: any consultant can be asked for
   * an EPA, and the inbox already shows them to you.
   */
  readonly yours: boolean;
  readonly timeline: ReturnType<typeof doctorTimeline>;
  readonly waiting: readonly InboxRequest[];
  readonly answered: readonly InboxRequest[];
  readonly toConfirm: readonly SampleSession[];
  readonly recent: readonly SampleSession[];
  readonly correction: SampleCorrection | null;
  readonly correctionStatus: CorrectionStatus;
  /** Sessions confirmed so far, in minutes, from this sample only. */
  readonly confirmedMinutes: number;
}

export function traineeView(
  s: AssessmentsState,
  state: TraineeState,
  id: string,
  supervisionByDoctor: ExampleSupervisionByDoctor,
): TraineeView | null {
  const row = overviewDoctors(s).find((r) => r.id === id);
  if (!row) return null;
  const yours = row.supervisor === SAMPLE_SUPERVISOR.name;
  const requests = inboxRequests(s, state.extras.answers).filter((item) => item.doctor.name === row.name);
  const supervision = yours ? supervisionByDoctor[id] : undefined;
  const sessions = supervision?.sessions ?? [];
  const toConfirm = sessions.filter((x) => sessionStatus(state, x) !== "confirmed");
  const recent = sessions.filter((x) => sessionStatus(state, x) === "confirmed");
  return {
    row,
    yours,
    timeline: doctorTimeline(row),
    waiting: requests.filter(isWaiting),
    answered: requests.filter((item) => !isWaiting(item)),
    toConfirm,
    recent,
    correction: supervision?.correction ?? null,
    correctionStatus: supervision?.correction ? (state.corrections[supervision.correction.id] ?? "waiting") : "waiting",
    confirmedMinutes: recent.reduce((sum, x) => sum + x.minutes, 0),
  };
}

/** "Mon 5 Oct · 60 min · Individual", with a no-break space before the unit. */
export function sessionLine(session: Pick<SampleSession, "date" | "minutes" | "kind">): string {
  return `${session.date} · ${session.minutes} min · ${session.kind}`;
}

/** "1 h", "2.5 h" from minutes. */
export function hoursWords(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10} h`;
}

/** How many things wait for the supervisor on this doctor: requests, sessions and an open correction. */
export function waitingCount(view: TraineeView, state: TraineeState): number {
  const sessions = view.toConfirm.filter((x) => sessionStatus(state, x) === "waiting").length;
  const correction = view.correction && view.correctionStatus === "waiting" ? 1 : 0;
  return view.waiting.length + sessions + correction;
}
