import { checkReminderText } from "@/lib/alerts/remind-me";
import { epa as epaInfo, type EpaNumber, type SupervisionLevel } from "@/lib/teaching/assessments/content";
import { looksLikePatientDetails, stage, type AssessmentsState } from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, SAMPLE_SUPERVISOR, WINDOW_DAYS } from "@/lib/teaching/assessments/sample";
import { looksLikePatientDetails as searchLooksLikePatientDetails } from "@/lib/work-search/signals";

/*
 * The consultant inbox (feature 16, mock-up nf_assess_inbox): every assessment request waiting for the
 * supervisor in one list, opened in one tap, answered with a supervision level and a few lines.
 *
 * MADE-UP SAMPLE ONLY. Like the rest of /teaching/assessments it runs on invented doctors in page memory:
 * nothing is fetched, saved or sent, and the page says so. Dr Sam Lee's requests come from the sample's own
 * story (the end-of-term form and any EPA Sam asked for), so they open the real sample screens; the other
 * doctors are short made-up EPA requests answered here. A voice note is not built (it would need the
 * microphone and somewhere to keep audio, which PsychSift does not have).
 */

export type InboxKind = "epa" | "form";
/** queued: written while offline, kept on the page as "To send" until the connection is back. */
export type InboxStatus = "waiting" | "queued" | "sending" | "sent" | "passed" | "later";
export type CantReason = "not_seen" | "other_consultant" | "not_this_week";

export const CANT_REASONS: readonly { id: CantReason; title: string; detail: string }[] = [
  { id: "not_seen", title: "I did not see this work", detail: "The doctor can ask someone who did" },
  { id: "other_consultant", title: "Better from another consultant", detail: "Suggest who below" },
  { id: "not_this_week", title: "Not this week", detail: "Moves it to Later, Mon 08:00" },
];

/** Made-up colleagues a request can be passed to (the sample's other consultants). */
export const SUGGESTED_COLLEAGUES: readonly string[] = ["Dr Omar Ahmed", "Dr Hana Ito"];

/** When Later brings a request back, on the made-up calendar. */
export const LATER_WHEN = "Mon 08:00";

/** Exactly what the doctor is shown when a request is passed on: no reason beyond these words. */
export function doctorSees(reason: CantReason, suggestion: string | null): string {
  if (reason === "not_this_week") return `Your supervisor will look at this from ${LATER_WHEN}.`;
  const base =
    reason === "not_seen"
      ? "Not able to assess this one, as I did not see this work."
      : "Better assessed by another consultant.";
  return suggestion ? `${base} Try ${suggestion}.` : `${base} Ask someone who saw it.`;
}

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
  readonly status: InboxStatus;
  readonly level: SupervisionLevel | null;
  readonly text: string;
  readonly reason: CantReason | null;
  /** Who the doctor is pointed to when it is passed on. */
  readonly suggestion?: string | null;
  /** "15:02": the real time of day it was sent. */
  readonly sentAt?: string | null;
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
    // Its form is not built into the sample, so it can only be moved to Later or passed on, never answered.
    status: benStatus(answers["ben-mid"]),
    open: { kind: "status" },
    doneLine: answers["ben-mid"] ? doneLineFor(answers["ben-mid"]) : null,
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

function benStatus(answer: InboxAnswer | undefined): InboxStatus {
  return answer && (answer.status === "later" || answer.status === "passed") ? answer.status : "waiting";
}

function dayText(now: number): string {
  const day = WINDOW_DAYS[now];
  return day ? `${day[0]} ${day[1]} ${day[2]}` : "Mon 5 Oct";
}

function doneLineFor(answer: InboxAnswer): string | null {
  if (answer.status === "sent" || answer.status === "sending" || answer.status === "queued") {
    const what = [answer.level ? levelWord(answer.level) : null, answer.text.trim() ? "with a few lines" : null]
      .filter(Boolean)
      .join(", ");
    if (answer.status === "queued")
      return answer.level ? `To send · ${what}` : "To send · choose a supervision level so it can go";
    return answer.sentAt ? `Sent ${answer.sentAt} · ${what}` : what;
  }
  if (answer.status === "passed") {
    const who = answer.suggestion ? ` · suggested ${answer.suggestion}` : "";
    return (answer.reason === "other_consultant" ? "Passed on to another consultant" : "Not seen by you") + who;
  }
  if (answer.status === "later") return "Moved to Later";
  return null;
}

export function levelWord(level: SupervisionLevel): string {
  return level === "direct" ? "Direct" : level === "proximal" ? "Proximal" : "Minimal";
}

/** "1 day", "4 days", "today", "1 week" (with a no-break space, so the number never wraps from its word) */
export function ageText(age: number): string {
  if (age <= 0) return "Today";
  if (age >= 7) {
    const weeks = Math.floor(age / 7);
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  return age === 1 ? "1 day" : `${age} days`;
}

/** A request waiting this many days or more is "waiting long": an amber rail and tag. */
export const WAITING_LONG_DAYS = 4;

export type InboxRail = "overdue" | "long" | "new" | "none";
export type InboxTagTone = "bad" | "warm" | "accent" | "neutral";

/**
 * A row's thin status rail and its one tag, so colour never carries the meaning alone: red overdue, amber
 * waiting long, the Teaching colour new, nothing for the rest.
 */
export function inboxRowStatus(item: InboxRequest): { rail: InboxRail; tag: string; tone: InboxTagTone } {
  if (item.status === "queued") return { rail: "none", tag: "To send", tone: "neutral" };
  if (item.overdue) return { rail: "overdue", tag: "Overdue", tone: "bad" };
  if (item.status === "later") return { rail: "none", tag: `Later · ${LATER_WHEN}`, tone: "neutral" };
  if (item.age >= WAITING_LONG_DAYS) return { rail: "long", tag: ageText(item.age), tone: "warm" };
  if (item.age <= 1) return { rail: "new", tag: "New", tone: "accent" };
  if (item.due) return { rail: "none", tag: item.due.replace(/^Due /, "By "), tone: "neutral" };
  return { rail: "none", tag: ageText(item.age), tone: "neutral" };
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
  return item.status === "waiting" || item.status === "later" || item.status === "queued";
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

/*
 * Pasted text often carries characters a reader cannot see: zero-width spaces, joiners, soft hyphens,
 * direction marks, and full-width letters and digits ("Ｍｒｓ", "１２３４５６７"). Each one can hide a name or a
 * number from a pattern check while the doctor still reads it plainly. So the text is folded first (NFKC
 * turns full-width and other look-alike forms into plain letters and digits, and a no-break space into a
 * space), then the invisible characters go.
 */
const INVISIBLE = /[\p{Cf}\u115F\u1160\u2800\u3164\uFFA0]/gu;

/** The feedback as it is checked and sent: folded to plain characters, invisible ones removed. */
export function cleanFeedbackText(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "").trim();
}

/** Ages written out in words: "45 year old male", "45-year-old", "aged 45", "45 y.o. woman". */
const AGE_WORDS = [
  /\b\d{1,3}\s*[-\u2010\u2011]?\s*(?:years?|yrs?|y)\s*[-\u2010\u2011]?\s*old\b/i,
  /\b(?:aged?|age:)\s*\d{1,3}\b/i,
  /\b\d{1,3}\s*(?:y\.\s?o\.?|yo)\s*(?:male|female|man|woman|boy|girl)\b/i,
];
/** Words after "Patient" that are not a name ("Patient Safety week"). */
const NOT_A_NAME = new Set(["Safety", "Care", "Centred", "Centered", "Experience", "Feedback", "Journey", "Flow"]);
/** "Patient John Smith", "Pt: Smith", "client Jones": a capitalised word straight after the patient. */
const PATIENT_NAME = /\b(?:[Pp]atient|PATIENT|[Pp]t|PT|[Cc]lient|[Cc]onsumer)\b\s*[:.-]?\s+(\p{Lu}[\p{L}'-]+)/gu;

function hasPatientName(text: string): boolean {
  for (const match of text.matchAll(PATIENT_NAME)) if (!NOT_A_NAME.has(match[1]!)) return true;
  return false;
}

function problemIn(text: string): FeedbackProblem | null {
  const found = checkReminderText(text);
  if (found)
    return {
      title: found.title,
      body: "Feedback can't hold patient details. This check catches some details, not all.",
      suggestion: found.suggestion,
    };
  if (AGE_WORDS.some((pattern) => pattern.test(text)))
    return {
      title: "This looks like an age",
      body: "Feedback can't hold patient details. This check catches some details, not all.",
      suggestion: null,
    };
  if (hasPatientName(text))
    return {
      title: "This looks like a name",
      body: "Feedback can't hold patient details. This check catches some details, not all.",
      suggestion: null,
    };
  if (looksLikePatientDetails(text) || searchLooksLikePatientDetails(text))
    return {
      title: "This may be patient details",
      body: "It looks like a record number, a date, a title and name, or a bed number. Remove it to send.",
      suggestion: null,
    };
  return null;
}

/**
 * The patient-detail catch for a few lines of feedback: the reminder check (names, initials, ages, dates
 * of birth, phone, bed and record numbers), the assessment form's own check and the search screen's, plus
 * ages in words and "Patient <Name>". It reads the folded text twice: once with the invisible characters
 * removed ("Sm\u200Bith" is "Smith") and once with each one as a space ("Mr\u200BSmith" is "Mr Smith"). It says
 * plainly that it catches some details, not all.
 */
export function feedbackProblem(text: string): FeedbackProblem | null {
  if (!text.trim()) return null;
  const folded = text.normalize("NFKC");
  const joined = folded.replace(INVISIBLE, "");
  const spaced = folded.replace(INVISIBLE, " ");
  if (!joined.trim()) return null;
  return problemIn(joined) ?? (spaced === joined ? null : problemIn(spaced));
}

/** Why Send is not available yet, in plain words; null when it can go. */
export function sendBlocker(answer: Pick<InboxAnswer, "level" | "text">): string | null {
  if (!answer.level) return "Choose the supervision the doctor needed.";
  if (answer.text.length > FEEDBACK_MAX_CHARS) return `Keep it to ${FEEDBACK_MAX_CHARS} characters.`;
  if (feedbackProblem(answer.text)) return "Remove the patient details to send.";
  return null;
}

/* ---------- what the doctor sees, and the copy for Clinical Learning Australia ---------- */

export interface DoctorView {
  readonly heading: string;
  /** "Today 15:02 · you asked Fri 2 Oct" */
  readonly when: string;
  readonly level: string | null;
  readonly words: string | null;
}

/** The answered request as the doctor sees it: the level and the few lines, nothing else. */
export function doctorView(item: InboxRequest, answer: InboxAnswer): DoctorView | null {
  if (answer.status === "passed")
    return {
      heading: "Your supervisor passed this on",
      when: `You asked ${item.askedOn}`,
      level: null,
      words: doctorSees(answer.reason ?? "not_seen", answer.suggestion ?? null),
    };
  if (answer.status !== "sent" && answer.status !== "sending") return null;
  return {
    heading: "Your supervisor answered",
    when: [answer.sentAt ? `Today ${answer.sentAt}` : "Today", `you asked ${item.askedOn}`].join(" · "),
    level: answer.level ? `${levelWord(answer.level)} supervision` : null,
    words: answer.text.trim() || null,
  };
}

/**
 * Plain text for the doctor to paste into their official record in Clinical Learning Australia. PsychSift
 * does not claim any import format, so this is words only, in the order the doctor reads them.
 */
export function claCopyText(item: InboxRequest, answer: InboxAnswer): string {
  return [
    item.title,
    `Supervisor: ${SAMPLE_SUPERVISOR.name}`,
    answer.level ? `Supervision needed: ${levelWord(answer.level)}` : null,
    answer.text.trim() ? `Feedback: ${answer.text.trim()}` : null,
    `Asked ${item.askedOn}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/* ---------- reminders from the DCT (the term overview) ---------- */

export interface DctReminder {
  readonly key: string;
  /** "Dr Ben Ortiz · mid-term" */
  readonly text: string;
  readonly at: string;
  /** The inbox request it is about, when it is in the list. */
  readonly requestId: string | null;
}

/**
 * Reminders the term overview sent to this supervisor, newest first, matched to the inbox request they are
 * about (Ben's mid-term, Sam's end-of-term once Sam asked).
 */
export function dctRemindersFor(
  reminders: readonly {
    key: string;
    doctorId: string;
    doctorName: string;
    supervisor: string;
    form: "mid" | "end";
    at: string;
  }[],
  items: readonly InboxRequest[],
): DctReminder[] {
  return reminders
    .filter((r) => r.supervisor === SAMPLE_SUPERVISOR.name)
    .map((r) => {
      const id = r.form === "mid" ? `${r.doctorId}-mid` : `${r.doctorId}-eot`;
      const item = items.find((i) => i.id === id && isWaiting(i));
      return {
        key: r.key,
        text: `${r.doctorName} · ${r.form === "mid" ? "mid-term" : "end-of-term"}`,
        at: r.at,
        requestId: item ? item.id : null,
      };
    })
    .reverse();
}
