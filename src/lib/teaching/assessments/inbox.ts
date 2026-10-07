import { checkReminderText } from "@/lib/alerts/remind-me";
import { epa as epaInfo, type EpaNumber, type SupervisionLevel } from "@/lib/teaching/assessments/content";
import { looksLikePatientDetails, stage, type AssessmentsState } from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, WINDOW_DAYS } from "@/lib/teaching/assessments/sample";

/*
 * The consultant inbox (feature 16, mock-up nf_assess_inbox): every assessment request waiting for the
 * supervisor in one list, opened in one tap, answered with a supervision level and a few lines.
 *
 * MADE-UP SAMPLE ONLY. Like the rest of /teaching/assessments it runs on invented doctors in page memory:
 * nothing is fetched, saved or sent, and the page says so. Dr Sam Lee's requests come from the sample's own
 * story (the end-of-term form and any EPA Sam asked for), so they open the real sample screens; the other
 * doctors are short made-up EPA requests answered here. A voice note is not built (it would need the
 * microphone, which Teaching never uses).
 */

export type InboxKind = "epa" | "form";
export type InboxStatus = "waiting" | "sending" | "sent" | "passed" | "later";
export type CantReason = "not_seen" | "other_consultant" | "not_this_week";

export const CANT_REASONS: readonly { id: CantReason; title: string; detail: string }[] = [
  { id: "not_seen", title: "I did not see this work", detail: "The doctor can ask someone who did" },
  { id: "other_consultant", title: "Better from another consultant", detail: "The doctor is told to ask someone else" },
  { id: "not_this_week", title: "Not this week", detail: "Moves it to Later" },
];

export type InboxOpen =
  | { readonly kind: "feedback" }
  | { readonly kind: "sheet"; readonly index: number }
  | { readonly kind: "href"; readonly view: "form" | "side" }
  | { readonly kind: "status" };

export interface InboxRequest {
  readonly id: string;
  readonly doctor: { readonly name: string; readonly initials: string; readonly grade: "PGY1" | "PGY2" };
  readonly kind: InboxKind;
  readonly epa: EpaNumber | null;
  /** "EPA 2 · Acutely unwell patient", "End-of-term assessment" */
  readonly title: string;
  /** "Fri 2 Oct" */
  readonly askedOn: string;
  /** Days since asked, on the made-up calendar. */
  readonly age: number;
  /** "By Sun 8 Nov", "Due Fri 16 Oct", or null. */
  readonly due: string | null;
  /** Days from Mon 5 Oct to the due date, for sorting by due date; null when there is none. */
  readonly dueDay: number | null;
  readonly overdue: boolean;
  readonly status: InboxStatus;
  readonly open: InboxOpen;
  /** What was sent, for the Done list: "Proximal · sent today". */
  readonly doneLine: string | null;
}

/** Day 0 is Mon 5 Oct, the sample's starting "today". Window days map onto the same count. */
export function sampleDayOffset(now: number): number {
  const day = WINDOW_DAYS[now];
  if (!day) return 0;
  return day[2] === "Oct" ? day[1] - 5 : 26 + day[1];
}

/** Per-request answers kept in page memory by the inbox. */
export interface InboxAnswer {
  readonly status: Exclude<InboxStatus, "waiting"> | "waiting";
  readonly level: SupervisionLevel | null;
  readonly text: string;
  readonly reason: CantReason | null;
}

export const EMPTY_ANSWER: InboxAnswer = { status: "waiting", level: null, text: "", reason: null };

type MadeUp = Omit<InboxRequest, "status" | "doneLine" | "age" | "overdue"> & { askedDay: number };

/** Made-up requests from doctors whose forms are not built into this sample: a few lines answers them. */
const MADE_UP: readonly MadeUp[] = [
  {
    id: "mia-epa-2",
    doctor: { name: "Dr Mia Chen", initials: "MC", grade: "PGY2" },
    kind: "epa",
    epa: 2,
    title: `EPA 2 · ${epaInfo(2).title}`,
    askedOn: "Fri 2 Oct",
    askedDay: -3,
    due: null,
    dueDay: null,
    open: { kind: "feedback" },
  },
  {
    id: "ella-epa-4",
    doctor: { name: "Dr Ella Okafor", initials: "EO", grade: "PGY1" },
    kind: "epa",
    epa: 4,
    title: `EPA 4 · ${epaInfo(4).title}`,
    askedOn: "Tue 29 Sep",
    askedDay: -6,
    due: null,
    dueDay: null,
    open: { kind: "feedback" },
  },
  {
    id: "ravi-epa-3",
    doctor: { name: "Dr Ravi Kaur", initials: "RK", grade: "PGY1" },
    kind: "epa",
    epa: 3,
    title: `EPA 3 · ${epaInfo(3).title}`,
    askedOn: "Mon 5 Oct",
    askedDay: 0,
    due: null,
    dueDay: null,
    open: { kind: "feedback" },
  },
];

const SAM = { name: SAMPLE_DOCTOR.name, initials: SAMPLE_DOCTOR.initials, grade: "PGY1" as const };

/** Every request for the supervisor, with page-memory answers applied. */
export function inboxRequests(s: AssessmentsState, answers: Readonly<Record<string, InboxAnswer>>): InboxRequest[] {
  const today = sampleDayOffset(s.now);
  const items: InboxRequest[] = [];
  // Dr Ben Ortiz's mid-term: the same made-up row the supervisor home shows, overdue once the window opens.
  const benOverdue = s.now >= 0;
  items.push({
    id: "ben-mid",
    doctor: { name: "Dr Ben Ortiz", initials: "BO", grade: "PGY2" },
    kind: "form",
    epa: null,
    title: "Mid-term assessment",
    askedOn: "Mon 28 Sep",
    age: today + 7,
    due: benOverdue ? "Overdue since Fri 16 Oct" : "Due Fri 16 Oct",
    dueDay: 11,
    overdue: benOverdue,
    status: "waiting",
    open: { kind: "status" },
    doneLine: null,
  });
  if (s.request.sent) {
    const st = stage(s);
    const signed = st === "sup-signed" || st === "doc-signed";
    items.push({
      id: "sam-eot",
      doctor: SAM,
      kind: "form",
      epa: null,
      title: "End-of-term assessment",
      askedOn: WINDOW_DAYS[s.request.sentOn] ? dayText(s.request.sentOn) : "Mon 5 Oct",
      age: today - sampleDayOffset(s.request.sentOn),
      due: "Due Fri 20 Nov",
      dueDay: 46,
      overdue: false,
      status: signed ? "sent" : "waiting",
      open: { kind: "href", view: st === "requested" || st === "sup-draft" ? "form" : "side" },
      doneLine: signed ? "Signed by you" : null,
    });
  }
  s.epaRequests.forEach((request, index) => {
    if (request.who !== "sup") return;
    items.push({
      id: `sam-epa-${index}`,
      doctor: SAM,
      kind: "epa",
      epa: request.epa,
      title: `EPA ${request.epa} · ${epaInfo(request.epa).title}`,
      askedOn: dayText(s.now),
      age: 0,
      due: "By Sun 8 Nov",
      dueDay: 34,
      overdue: false,
      status: request.status === "done" ? "sent" : "waiting",
      open: { kind: "sheet", index },
      doneLine: request.status === "done" ? "Recorded in the sample" : null,
    });
  });
  for (const made of MADE_UP) {
    const answer = answers[made.id] ?? EMPTY_ANSWER;
    const { askedDay, ...rest } = made;
    items.push({
      ...rest,
      age: today - askedDay,
      overdue: false,
      status: answer.status,
      doneLine: doneLineFor(answer),
    });
  }
  return items;
}

function dayText(now: number): string {
  const day = WINDOW_DAYS[now];
  return day ? `${day[0]} ${day[1]} ${day[2]}` : "Mon 5 Oct";
}

function doneLineFor(answer: InboxAnswer): string | null {
  if (answer.status === "sent" || answer.status === "sending")
    return [answer.level ? levelWord(answer.level) : null, answer.text.trim() ? "with a few lines" : null]
      .filter(Boolean)
      .join(", ");
  if (answer.status === "passed")
    return answer.reason === "other_consultant" ? "Passed on to another consultant" : "Not seen by you";
  if (answer.status === "later") return "Moved to Later";
  return null;
}

function levelWord(level: SupervisionLevel): string {
  return level === "direct" ? "Direct" : level === "proximal" ? "Proximal" : "Minimal";
}

/** "1 day", "4 days", "today" */
export function ageText(age: number): string {
  if (age <= 0) return "Today";
  return age === 1 ? "1 day" : `${age} days`;
}

export type InboxFilter = "all" | "overdue" | "epas" | "forms";
export type InboxSort = "oldest" | "due" | "doctor";

export const INBOX_FILTERS: readonly { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "epas", label: "EPAs" },
  { id: "forms", label: "Forms" },
];

export function isWaiting(item: Pick<InboxRequest, "status">): boolean {
  return item.status === "waiting" || item.status === "later";
}

export function matchesFilter(item: InboxRequest, filter: InboxFilter): boolean {
  if (filter === "overdue") return item.overdue;
  if (filter === "epas") return item.kind === "epa";
  if (filter === "forms") return item.kind === "form";
  return true;
}

export function filterCounts(items: readonly InboxRequest[]): Record<InboxFilter, number> {
  const waiting = items.filter(isWaiting);
  return {
    all: waiting.length,
    overdue: waiting.filter((i) => matchesFilter(i, "overdue")).length,
    epas: waiting.filter((i) => matchesFilter(i, "epas")).length,
    forms: waiting.filter((i) => matchesFilter(i, "forms")).length,
  };
}

/** Overdue first, Later last, then by the chosen order. */
export function sortInbox(items: readonly InboxRequest[], sort: InboxSort): InboxRequest[] {
  const by = (a: InboxRequest, b: InboxRequest) => {
    if (sort === "doctor") return a.doctor.name.localeCompare(b.doctor.name) || b.age - a.age;
    if (sort === "due") return (a.dueDay ?? 999) - (b.dueDay ?? 999) || b.age - a.age;
    return b.age - a.age;
  };
  return [...items].sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) || Number(a.status === "later") - Number(b.status === "later") || by(a, b),
  );
}

export const FEEDBACK_MAX_CHARS = 500;

export type FeedbackProblem = { title: string; body: string; suggestion: string | null };

/**
 * The patient-detail catch for a few lines of feedback: the reminder check (names, initials, ages, dates
 * of birth, phone, bed and record numbers) plus the assessment form's own check. It says plainly that it
 * catches some details, not all.
 */
export function feedbackProblem(text: string): FeedbackProblem | null {
  if (!text.trim()) return null;
  const found = checkReminderText(text);
  if (found)
    return {
      title: found.title,
      body: "Feedback can't hold patient details. This check catches some details, not all.",
      suggestion: found.suggestion,
    };
  if (looksLikePatientDetails(text))
    return {
      title: "This may be patient details",
      body: "It looks like a record number, a date, a title and name, or a bed number. Remove it to send.",
      suggestion: null,
    };
  return null;
}

/** Why Send is not available yet, in plain words; null when it can go. */
export function sendBlocker(answer: Pick<InboxAnswer, "level" | "text">): string | null {
  if (!answer.level) return "Choose the supervision the doctor needed.";
  if (answer.text.length > FEEDBACK_MAX_CHARS) return `Keep it to ${FEEDBACK_MAX_CHARS} characters.`;
  if (feedbackProblem(answer.text)) return "Remove the patient details to send.";
  return null;
}
