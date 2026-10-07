import type { z } from "zod";

import { checkReminderText, type ReminderTextProblem } from "@/lib/alerts/remind-me";
import { complianceExpiryHistory, fullBody } from "@/lib/admin/renewals";
import { complianceLeadTimeDays, formatDateEcho, utcDay } from "@/lib/admin/renewal-dates";
import { addDays, addMonthsClamped, type CalendarEvent } from "@/lib/calendar/calendar-event";
import { toIcs } from "@/lib/calendar/ics";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { createOnCallEntrySchema, updateOnCallEntrySchema } from "@/lib/on-call/api-schemas";
import { complianceExpiresOn, isComplianceEntry } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

/**
 * Contract end tracker (junior feature #6, owner request 6 Oct 2026).
 *
 * The contract end date is one of the doctor's own private compliance rows,
 * written through the existing entries API: `details.kind = "compliance"`,
 * category "Personal", `expiresOn` = the end date from the letter. No new
 * table and nothing on the device. Because it is an ordinary personal
 * renewal, Admin Today and Renewals already show it from its first reminder,
 * and Renewals' calendar file already carries it.
 *
 * The two reminder points (3 months and 6 weeks before the end) are worked
 * out from the end date, never typed. Which ones are on is stored in the
 * row's own fields: `leadTimeDays` is the earliest reminder that is on (so
 * "Start renewing" on Today lands on that day), and one tag records the 6
 * week reminder being off while the 3 month one is on. See
 * `contractReminders` and `buildContractRemindersBody`.
 *
 * Nothing here is checked with the employer. The page says "Dates you
 * entered from your letter, not a check".
 */

type CreateBody = z.input<typeof createOnCallEntrySchema>;
type UpdateBody = z.input<typeof updateOnCallEntrySchema>;

export const CONTRACT_END_SLUG_PREFIX = "contract-end-";
export const CONTRACT_END_TITLE = "Contract end";
/** Tag meaning "the 6 week reminder is off" while the 3 month one is on. */
export const CONTRACT_SIX_WEEK_OFF_TAG = "contract-reminder-6-weeks-off";
export const SIX_WEEKS_DAYS = 42;
/** The note is a proof note ("offer letter in Documents"), held to the same 120 characters. */
export const CONTRACT_NOTE_LIMIT = 120;
export const CONTRACT_EMPLOYER_LIMIT = 80;
/** A typed end date this far out is almost certainly a wrong year. */
const MAX_YEARS_AHEAD = 10;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function detailsOf(entry: OnCallEntry): Record<string, unknown> {
  return typeof entry.details === "object" && entry.details !== null ? (entry.details as Record<string, unknown>) : {};
}

function isRealDate(value: string): boolean {
  return DATE_KEY.test(value) && utcDay(value) !== null;
}

function daysBetween(from: string, to: string): number {
  const a = utcDay(from);
  const b = utcDay(to);
  return a === null || b === null ? 0 : Math.round(b - a);
}

export function isContractEndEntry(entry: OnCallEntry): boolean {
  return isComplianceEntry(entry) && entry.slug.startsWith(CONTRACT_END_SLUG_PREFIX);
}

/**
 * The reader's contract row. Should two exist (an old tab saved twice), the
 * one ending latest wins, so a renewed contract is never hidden behind the old.
 */
export function selectContractEnd(own: readonly OnCallEntry[]): OnCallEntry | null {
  let found: OnCallEntry | null = null;
  for (const entry of own) {
    if (!isContractEndEntry(entry) || entry.isOwn === false) continue;
    const end = complianceExpiresOn(entry);
    if (!end) continue;
    const foundEnd = found ? complianceExpiresOn(found) : undefined;
    if (!found || !foundEnd || end > foundEnd) found = entry;
  }
  return found;
}

export function contractEmployer(entry: OnCallEntry): string | null {
  const value = detailsOf(entry).issuingBody;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function contractNote(entry: OnCallEntry): string | null {
  const value = detailsOf(entry).proofNote;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Earlier end dates, newest first, kept by "Got a new contract?". */
export function contractEndHistory(entry: OnCallEntry): string[] {
  return complianceExpiryHistory(entry);
}

export interface ContractReminderPoints {
  /** 3 calendar months before the end (clamped to a shorter month). */
  readonly threeMonths: string;
  /** 6 weeks (42 days) before the end. */
  readonly sixWeeks: string;
}

export function contractReminderPoints(endsOn: string): ContractReminderPoints {
  return { threeMonths: addMonthsClamped(endsOn, -3), sixWeeks: addDays(endsOn, -SIX_WEEKS_DAYS) };
}

export interface ContractReminders {
  readonly threeMonths: boolean;
  readonly sixWeeks: boolean;
}

export const BOTH_REMINDERS_ON: ContractReminders = { threeMonths: true, sixWeeks: true };

/** Which reminders are on, read back from the row's lead time and tag. */
export function contractReminders(entry: OnCallEntry): ContractReminders {
  const end = complianceExpiresOn(entry);
  const lead = complianceLeadTimeDays(entry);
  const sixWeeksOff = entry.tags.includes(CONTRACT_SIX_WEEK_OFF_TAG);
  if (!end) return BOTH_REMINDERS_ON;
  const threeMonths = lead > SIX_WEEKS_DAYS;
  const sixWeeks = !sixWeeksOff && lead > 0;
  return { threeMonths, sixWeeks };
}

/** The lead time and tags that store a reminder choice for this end date. */
export function reminderFields(
  endsOn: string,
  reminders: ContractReminders,
  tags: readonly string[] = [],
): { leadTimeDays: number; tags: string[] } {
  const others = tags.filter((tag) => tag !== CONTRACT_SIX_WEEK_OFF_TAG);
  const points = contractReminderPoints(endsOn);
  if (reminders.threeMonths) {
    return {
      leadTimeDays: daysBetween(points.threeMonths, endsOn),
      tags: reminders.sixWeeks ? others : [...others, CONTRACT_SIX_WEEK_OFF_TAG],
    };
  }
  if (reminders.sixWeeks) return { leadTimeDays: SIX_WEEKS_DAYS, tags: others };
  return { leadTimeDays: 0, tags: [...others, CONTRACT_SIX_WEEK_OFF_TAG] };
}

export type ContractReminderKind = "three-months" | "six-weeks";

export interface ContractReminderMark {
  readonly kind: ContractReminderKind;
  readonly label: string;
  readonly date: string;
  readonly on: boolean;
  /** today is on or after this reminder. */
  readonly reached: boolean;
}

export type ContractPhase =
  "far" | "before-reminders" | "reminder-today" | "between" | "final-weeks" | "ends-today" | "ended";

export interface ContractStatus {
  readonly endsOn: string;
  readonly today: string;
  /** Whole days from today to the end; negative once it has passed. */
  readonly daysLeft: number;
  readonly phase: ContractPhase;
  readonly marks: readonly ContractReminderMark[];
  /** The next reminder still to come and on, if any. */
  readonly nextReminder: ContractReminderMark | null;
  /** A reminder that falls on today, if any. */
  readonly reminderToday: ContractReminderMark | null;
}

export function contractStatus(endsOn: string, today: string, reminders: ContractReminders): ContractStatus {
  const points = contractReminderPoints(endsOn);
  const marks: ContractReminderMark[] = [
    {
      kind: "three-months",
      label: "3 months",
      date: points.threeMonths,
      on: reminders.threeMonths,
      reached: today >= points.threeMonths,
    },
    {
      kind: "six-weeks",
      label: "6 weeks",
      date: points.sixWeeks,
      on: reminders.sixWeeks,
      reached: today >= points.sixWeeks,
    },
  ];
  const daysLeft = daysBetween(today, endsOn);
  const reminderToday = marks.find((mark) => mark.on && mark.date === today) ?? null;
  const nextReminder = marks.find((mark) => mark.on && mark.date > today) ?? null;
  let phase: ContractPhase;
  if (daysLeft < 0) phase = "ended";
  else if (daysLeft === 0) phase = "ends-today";
  else if (reminderToday) phase = "reminder-today";
  else if (today >= points.sixWeeks) phase = "final-weeks";
  else if (today >= points.threeMonths) phase = "between";
  else if (daysBetween(today, points.threeMonths) > 92) phase = "far";
  else phase = "before-reminders";
  return { endsOn, today, daysLeft, phase, marks, nextReminder, reminderToday };
}

/** "Sat 31 Oct, in 25 days" style words for a reminder. */
function reminderWords(mark: ContractReminderMark, today: string): string {
  const days = daysBetween(today, mark.date);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return `${formatDateEcho(mark.date)}, ${when}`;
}

/** The one line under the hero strip. */
export function contractPanelLine(status: ContractStatus): string {
  const onMarks = status.marks.filter((mark) => mark.on);
  if (status.phase === "ended") return "This end date has passed. Got a new contract? Add the new end date.";
  if (status.phase === "ends-today") return "Your contract ends today.";
  if (status.reminderToday) {
    const after = status.nextReminder ? ` Next reminder ${formatDateEcho(status.nextReminder.date)}.` : "";
    return `Reminder today: ${status.reminderToday.label} to go. Ask your questions this week.${after}`;
  }
  if (onMarks.length === 0) return "Both reminders are off. Turn one on below.";
  const upcoming = onMarks.filter((mark) => mark.date > status.today);
  const [first, second] = upcoming;
  if (!first) return "No reminders left before the end.";
  if (second) return `First reminder ${reminderWords(first, status.today)}. Then ${formatDateEcho(second.date)}.`;
  return onMarks.length === 2
    ? `Next reminder ${reminderWords(first, status.today)}.`
    : `One reminder: ${reminderWords(first, status.today)}.`;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface ContractStripSegment {
  readonly label: string;
  /** Share of the strip, 0 to 1. */
  readonly width: number;
  /** How much of this month has passed, 0 to 1. */
  readonly filled: number;
}

export interface ContractStripMark extends ContractReminderMark {
  /** Position along the strip, 0 to 1. */
  readonly position: number;
}

export interface ContractStrip {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly segments: readonly ContractStripSegment[];
  readonly marks: readonly ContractStripMark[];
  /** Position of today along the strip, or null when today is outside it. */
  readonly todayPosition: number | null;
  readonly startLabel: string;
  readonly endLabel: string;
  /** Everything the strip shows, in one sentence for screen readers. */
  readonly accessibleLabel: string;
}

function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
  ];
  const monthName = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][month! - 1];
  return `${weekday} ${day} ${monthName} ${year}`;
}

/**
 * The signature countdown strip: the last six calendar months of the
 * contract, one segment per month, filled up to today, with the two reminder
 * points marked. Today outside the window draws no today tick.
 */
export function contractStrip(status: ContractStatus): ContractStrip {
  const [endYear, endMonth] = status.endsOn.split("-").map(Number);
  const startIndex = endYear! * 12 + (endMonth! - 1) - 5;
  const startsOn = `${Math.floor(startIndex / 12)}-${String((startIndex % 12) + 1).padStart(2, "0")}-01`;
  const first = utcDay(startsOn) ?? 0;
  const last = (utcDay(status.endsOn) ?? first) + 1;
  const total = Math.max(1, last - first);
  const todayDay = utcDay(status.today) ?? first;
  const segments: ContractStripSegment[] = [];
  for (let index = 0; index < 6; index += 1) {
    const monthIndex = startIndex + index;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const from = Date.UTC(year, month, 1) / 86_400_000;
    const to = Math.min(Date.UTC(year, month + 1, 1) / 86_400_000, last);
    const span = Math.max(0, to - from);
    segments.push({
      label: MONTH_SHORT[month]!,
      width: span / total,
      filled: span === 0 ? 0 : Math.max(0, Math.min(1, (todayDay - from) / span)),
    });
  }
  const position = (date: string) => Math.max(0, Math.min(1, ((utcDay(date) ?? first) - first) / total));
  const marks = status.marks.map((mark) => ({ ...mark, position: position(mark.date) }));
  const inside = todayDay >= first && todayDay < last;
  const todayPosition = inside ? position(status.today) : null;
  const [, startMonth] = startsOn.split("-").map(Number);
  const startLabel = `1 ${MONTH_SHORT[startMonth! - 1]}${inside ? "" : ` ${startsOn.slice(0, 4)}`}`;
  const endLabel = `Ends ${Number(status.endsOn.slice(8))} ${MONTH_SHORT[endMonth! - 1]}`;
  const reminderWordsList = marks.map((mark) =>
    mark.on ? `${mark.label} reminder ${longDate(mark.date)}` : `${mark.label} reminder off`,
  );
  const accessibleLabel = [
    "Last 6 months of your contract.",
    inside
      ? `Today ${longDate(status.today)}.`
      : status.daysLeft < 0
        ? "The end date has passed."
        : "Today is before this window.",
    `${reminderWordsList.join(". ")}.`,
    `Ends ${longDate(status.endsOn)}.`,
  ].join(" ");
  return { startsOn, endsOn: status.endsOn, segments, marks, todayPosition, startLabel, endLabel, accessibleLabel };
}

/* ---------------------------------------------------------------- form */

export interface ContractFormInput {
  readonly endsOn: string;
  readonly employer: string;
  readonly note: string;
  readonly reminders: ContractReminders;
}

export interface ContractFormErrors {
  endsOn?: string;
  employer?: string;
  note?: string;
  /** A patient-detail catch, with a safer wording when one exists. */
  employerProblem?: ReminderTextProblem;
  noteProblem?: ReminderTextProblem;
}

export function validateContractForm(input: ContractFormInput, today: string): ContractFormErrors {
  const errors: ContractFormErrors = {};
  const end = input.endsOn.trim();
  if (!end) errors.endsOn = "Type the end date from your letter.";
  else if (!isRealDate(end)) errors.endsOn = "Use the date picker, or type the date as YYYY-MM-DD.";
  else if (end < today) errors.endsOn = "That date has passed. Check the year on your letter.";
  else if (daysBetween(today, end) > MAX_YEARS_AHEAD * 366)
    errors.endsOn = "That is more than 10 years away. Check the year.";
  const employer = input.employer.trim();
  if (employer.length > CONTRACT_EMPLOYER_LIMIT)
    errors.employer = `Keep the employer to ${CONTRACT_EMPLOYER_LIMIT} characters.`;
  else if (employer) {
    const problem = checkReminderText(employer);
    if (problem) errors.employerProblem = problem;
  }
  const note = input.note.trim();
  if (note.length > CONTRACT_NOTE_LIMIT) errors.note = `Keep the note to ${CONTRACT_NOTE_LIMIT} characters.`;
  else if (note) {
    const problem = checkReminderText(note);
    if (problem) errors.noteProblem = { ...problem, body: "Notes here cannot hold patient details." };
  }
  return errors;
}

export function contractFormHasErrors(errors: ContractFormErrors): boolean {
  return Object.values(errors).some(Boolean);
}

function contractDetails(input: ContractFormInput, base: Record<string, unknown>, leadTimeDays: number) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop them from `rest`
  const { issuingBody: _employer, proofNote: _note, ...rest } = base;
  const employer = input.employer.trim();
  const note = input.note.trim();
  return {
    ...rest,
    kind: "compliance" as const,
    category: "Personal",
    expiresOn: input.endsOn.trim(),
    leadTimeDays,
    provenance: "typed" as const,
    ...(employer ? { issuingBody: employer } : {}),
    ...(note ? { proofNote: note } : {}),
  };
}

/** The first save: a new private compliance row. */
export function buildContractCreateBody(input: ContractFormInput, slugSuffix: string): CreateBody {
  const fields = reminderFields(input.endsOn.trim(), input.reminders);
  return {
    section: "logistics",
    slug: `${CONTRACT_END_SLUG_PREFIX}${slugSuffix}`,
    title: CONTRACT_END_TITLE,
    subtitle: null,
    body: null,
    details: contractDetails(input, {}, fields.leadTimeDays),
    linkedDocumentIds: [],
    tags: fields.tags,
    // Compliance rows are private by the server whatever the body says; say so here too.
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
  };
}

/** "Edit dates": the same row, fields replaced. A changed end date keeps the old one in history. */
export function buildContractEditBody(entry: OnCallEntry, input: ContractFormInput): UpdateBody {
  const previous = complianceExpiresOn(entry);
  const next = input.endsOn.trim();
  const fields = reminderFields(next, input.reminders, entry.tags);
  const details = contractDetails(input, detailsOf(entry), fields.leadTimeDays);
  const history =
    previous && previous !== next
      ? [previous, ...complianceExpiryHistory(entry)].slice(0, 10)
      : complianceExpiryHistory(entry);
  return {
    ...fullBody(entry, history.length ? { ...details, expiryHistory: history } : details),
    tags: fields.tags,
  };
}

export type ContractRenewResult =
  | { ok: true; body: UpdateBody }
  | { ok: false; reason: "missing" | "malformed" | "unchanged" | "not-later" | "passed" };

/**
 * "Got a new contract?": a later end date. Both reminders move with it, the
 * old end date goes into history, and the reminder choice is kept. The
 * "Asked, waiting" marks start fresh unless the doctor keeps them.
 */
export function buildContractRenewBody(
  entry: OnCallEntry,
  newEndsOn: string,
  today: string,
  { keepAnswers = false }: { keepAnswers?: boolean } = {},
): ContractRenewResult {
  const next = newEndsOn.trim();
  if (!next) return { ok: false, reason: "missing" };
  if (!isRealDate(next)) return { ok: false, reason: "malformed" };
  const previous = complianceExpiresOn(entry);
  if (previous === next) return { ok: false, reason: "unchanged" };
  if (previous && next < previous) return { ok: false, reason: "not-later" };
  if (next < today) return { ok: false, reason: "passed" };
  const reminders = contractReminders(entry);
  const fields = reminderFields(next, reminders, entry.tags);
  const history = previous
    ? [previous, ...complianceExpiryHistory(entry)].slice(0, 10)
    : complianceExpiryHistory(entry);
  return {
    ok: true,
    body: {
      ...fullBody(entry, {
        ...detailsOf(entry),
        expiresOn: next,
        leadTimeDays: fields.leadTimeDays,
        expiryHistory: history,
        provenance: "typed",
      }),
      tags: keepAnswers ? fields.tags : withAskedTags(fields.tags, []),
    },
  };
}

export const CONTRACT_RENEW_REASON: Record<Exclude<ContractRenewResult, { ok: true }>["reason"], string> = {
  missing: "Type the new end date from the letter.",
  malformed: "Use the date picker, or type the date as YYYY-MM-DD.",
  unchanged: "That is the end date already recorded.",
  "not-later": "A new contract ends after the old one. To fix a typo, use Edit dates.",
  passed: "That date has passed. Check the year on the letter.",
};

/** A reminder switch flipped. */
export function buildContractRemindersBody(entry: OnCallEntry, reminders: ContractReminders): UpdateBody | null {
  const end = complianceExpiresOn(entry);
  if (!end) return null;
  const fields = reminderFields(end, reminders, entry.tags);
  return { ...fullBody(entry, { ...detailsOf(entry), leadTimeDays: fields.leadTimeDays }), tags: fields.tags };
}

/* ----------------------------------------------------------- questions */

export type ContractQuestionId =
  "training-program" | "parental-leave" | "untaken-leave" | "in-writing" | "keep-copy" | "who-to-ask";

export interface ContractQuestion {
  readonly id: ContractQuestionId;
  readonly title: string;
  readonly hint: string;
  /** The words that go into a message, as a clause after "Could you tell me". */
  readonly ask: string | null;
  /** The sentence a doctor copies on its own. */
  readonly question: string;
}

/**
 * What to ask before the contract ends. General questions only: no clause
 * numbers, no entitlement figures, no recruitment dates (Josh's rule).
 */
export const CONTRACT_QUESTIONS: readonly ContractQuestion[] = [
  {
    id: "training-program",
    title: "Does the next one cover your whole training program?",
    hint: "Ask before you sign",
    ask: "whether the next contract will run for my whole training program",
    question: "Will my next contract run for my whole training program, or only for the next year?",
  },
  {
    id: "parental-leave",
    title: "Planned parental leave",
    hint: "Ask if it falls inside the next contract",
    ask: "whether planned parental leave would fall inside the next contract",
    question:
      "If I take parental leave during my next contract, does the contract include it, and does my service carry over?",
  },
  {
    id: "untaken-leave",
    title: "Leave you have not taken",
    hint: "Ask what happens to it at the end",
    ask: "what happens to leave I have not taken by the end date",
    question: "What happens to annual leave I have not taken when this contract ends?",
  },
  {
    id: "in-writing",
    title: "Start date, site and hours in writing",
    hint: "Before you accept",
    ask: "the start date, site and hours of the next contract, in writing",
    question: "Could I have the start date, site and hours of my next contract in writing before I accept?",
  },
  {
    id: "keep-copy",
    title: "Keep a copy of this contract",
    hint: "Note where it is, in the note above",
    ask: null,
    question: "Could you send me a copy of my signed contract?",
  },
  {
    id: "who-to-ask",
    title: "Who to ask",
    hint: "Medical Workforce, for contracts, pay and leave",
    ask: null,
    question: "Who should I talk to about my next contract?",
  },
];

export const CONTRACT_ASK_DEFAULT: readonly ContractQuestionId[] = [
  "training-program",
  "parental-leave",
  "untaken-leave",
];

/* --------------------------------------------------------- asked marks */

/**
 * "Asked, waiting": the doctor's own mark that a question has gone to
 * Medical Workforce. One tag per question on the same private row, so it
 * follows the account and never sits on the phone. The app never learns
 * whether an answer came, so the words stay "Asked, waiting".
 */
export const CONTRACT_ASKED_TAG_PREFIX = "contract-asked-";

const QUESTION_IDS = new Set<string>(CONTRACT_QUESTIONS.map((question) => question.id));

/** Questions marked as asked, in the list's own order. */
export function contractAskedQuestions(entry: OnCallEntry | null): ContractQuestionId[] {
  if (!entry) return [];
  const asked = new Set(
    entry.tags
      .filter((tag) => tag.startsWith(CONTRACT_ASKED_TAG_PREFIX))
      .map((tag) => tag.slice(CONTRACT_ASKED_TAG_PREFIX.length))
      .filter((id) => QUESTION_IDS.has(id)),
  );
  return CONTRACT_QUESTIONS.filter((question) => asked.has(question.id)).map((question) => question.id);
}

function withAskedTags(tags: readonly string[], asked: readonly ContractQuestionId[]): string[] {
  const others = tags.filter((tag) => !tag.startsWith(CONTRACT_ASKED_TAG_PREFIX));
  const ordered = CONTRACT_QUESTIONS.filter((question) => asked.includes(question.id));
  return [...others, ...ordered.map((question) => `${CONTRACT_ASKED_TAG_PREFIX}${question.id}`)];
}

/** Mark questions as asked (or not). Everything else on the row stays as it is. */
export function buildContractAskedBody(
  entry: OnCallEntry,
  ids: readonly ContractQuestionId[],
  asked: boolean,
): UpdateBody {
  const current = contractAskedQuestions(entry);
  const next = asked
    ? [...current, ...ids.filter((id) => !current.includes(id))]
    : current.filter((id) => !ids.includes(id));
  return { ...fullBody(entry, detailsOf(entry)), tags: withAskedTags(entry.tags, next) };
}

/** Questions that can go in a message and are not marked as asked yet. */
export function contractOpenAskable(asked: readonly ContractQuestionId[]): ContractQuestionId[] {
  return CONTRACT_QUESTIONS.filter((question) => question.ask && !asked.includes(question.id)).map(
    (question) => question.id,
  );
}

/** The message for Medical Workforce, built from the chosen questions. No personal dates other than the end. */
export function contractAskMessage(
  chosen: readonly ContractQuestionId[],
  endsOn: string | null,
): { subject: string; body: string } | null {
  const asks = CONTRACT_QUESTIONS.filter((question) => chosen.includes(question.id) && question.ask).map(
    (question) => question.ask!,
  );
  if (asks.length === 0) return null;
  const list = asks.length === 1 ? asks[0]! : `${asks.slice(0, -1).join(", ")}, and ${asks[asks.length - 1]}`;
  const subject = endsOn ? `My contract ends ${formatDateEcho(endsOn)}` : "My next contract";
  const opener = endsOn ? `My contract ends on ${formatDateEcho(endsOn)}. ` : "";
  return { subject, body: `Hi Medical Workforce,\n\n${opener}Could you tell me ${list}?\n\nThanks` };
}

/** A mail draft link with no address filled in: the doctor chooses who it goes to. */
export function mailtoHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ------------------------------------------------------------ calendar */

/** 09:00 Perth on a calendar day, as a UTC instant (Perth has no daylight saving). */
function perthNineAm(date: string): string {
  return `${date}T01:00:00.000Z`;
}

/**
 * One all-day event on the end date with an alert at 09:00 Perth on each
 * reminder that is on and still ahead. The id is stable, so downloading
 * again updates the event rather than adding a second.
 */
export function contractCalendarFile(entry: OnCallEntry, now: Date): string | null {
  const end = complianceExpiresOn(entry);
  if (!end) return null;
  const status = contractStatus(end, perthCalendarDate(now), contractReminders(entry));
  const alarms = status.marks
    .filter((mark) => mark.on)
    .map((mark) => perthNineAm(mark.date))
    .filter((instant) => Date.parse(instant) > now.getTime());
  const event: CalendarEvent = {
    id: `psychsift-contract-end-${entry.id}`,
    title: "Contract ends",
    date: end,
    kind: "expiry",
    notes: "Dates you entered from your letter, not a check.",
    href: "/admin/contract",
    alarmsAt: alarms,
  };
  return toIcs([event], { now });
}

/* --------------------------------------------- hooks for the main build */

export interface AdminFeatureNeedsYouItem {
  readonly id: string;
  readonly title: string;
  readonly dueOn: string;
  readonly area: "admin";
  readonly href: string;
  readonly kind: "action" | "update";
}

/**
 * Needs-you source: a contract reminder that is due (on and reached, while
 * the contract has not ended). Pure, for the notification centre to wire in.
 */
export function selectContractEndNeedsYou(own: readonly OnCallEntry[], now: Date): AdminFeatureNeedsYouItem[] {
  const entry = selectContractEnd(own);
  const end = entry ? complianceExpiresOn(entry) : undefined;
  if (!entry || !end) return [];
  const status = contractStatus(end, perthCalendarDate(now), contractReminders(entry));
  if (status.daysLeft < 0) {
    return [
      {
        id: `contract-end-passed-${entry.id}`,
        title: "Contract end date has passed. Add your new end date",
        dueOn: end,
        area: "admin",
        href: "/admin/contract",
        kind: "action",
      },
    ];
  }
  const reached = status.marks.filter((mark) => mark.on && mark.reached);
  const latest = reached[reached.length - 1];
  if (!latest) return [];
  return [
    {
      id: `contract-end-${latest.kind}-${entry.id}`,
      title: `Contract ends ${formatDateEcho(end)}. Ask your questions`,
      dueOn: latest.date,
      area: "admin",
      href: "/admin/contract",
      kind: "action",
    },
  ];
}

export interface AdminFeatureSearchRecord {
  readonly id: string;
  readonly title: string;
  readonly area: "admin";
  readonly keywords: readonly string[];
  readonly href: string;
}

/** Work-search provider: the page itself, plus the recorded end date when there is one. */
export function contractEndSearchRecords(own: readonly OnCallEntry[]): AdminFeatureSearchRecord[] {
  const entry = selectContractEnd(own);
  const end = entry ? complianceExpiresOn(entry) : undefined;
  return [
    {
      id: "admin-contract",
      title: end ? `Contract ends ${formatDateEcho(end)}` : "Contract end tracker",
      area: "admin",
      keywords: ["contract", "end date", "contract end", "renewal", "next contract", "medical workforce", "reminder"],
      href: "/admin/contract",
    },
  ];
}
