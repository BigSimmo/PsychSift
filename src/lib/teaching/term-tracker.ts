import { z } from "zod";

/*
 * Teaching's term tracker and exam prep: the doctor's own checklist for a training term and an exam
 * year. Everything here is kept on the doctor's device (see `term-tracker-store.ts`), never sent to
 * a server, and holds no patient detail: the screens say so beside every free-text field.
 *
 * The assessments themselves are signed in the Clinical Learning Australia (CLA) ePortfolio, which
 * PMCWA runs for WA prevocational doctors; this tracker works alongside it and links out, it never
 * records a sign-off. A term carries the same fields the Assessments design uses (number, unit, dates,
 * supervisor) and EPA entries carry their term id, so that page can read these records later.
 *
 * Dates are Perth calendar-date keys ("2026-10-06"). All arithmetic is on those keys at UTC midnight,
 * so a daylight-saving change elsewhere never shifts a day.
 */

export const TERM_TRACKER_SOURCES = {
  pmcwaAssessment: "https://pmcwa.org.au/education-training/training-and-assessment",
  /** PMCWA's page about CLA in WA. Information only, not where doctors sign in. */
  pmcwaCla: "https://pmcwa.org.au/education-training/cla",
  /**
   * The CLA sign-in page itself. Checked 9 Oct 2026 against the Australian Digital Health Agency's
   * "CLA user guide for prevocational doctors" v1.1 (11 Feb 2025) and "CLA detailed FAQs" v2.0
   * (2 Jun 2025), which both give this address for signing in.
   */
  claSignIn: "https://cla.epads.mkmapps.com",
  epaSummary:
    "https://www.heti.nsw.gov.au/__data/assets/pdf_file/0010/931798/2023-11-National-Framework-Summary-for-PGY1-Trainees-V4.pdf",
} as const;

export const milestoneIds = ["start", "mid", "end"] as const;
export type MilestoneId = (typeof milestoneIds)[number];

export const milestoneLabels: Record<MilestoneId, { short: string; long: string }> = {
  start: { short: "Start", long: "Beginning-of-term discussion" },
  mid: { short: "Mid-term", long: "Mid-term assessment" },
  end: { short: "End", long: "End-of-term assessment" },
};

export const epaNumbers = [1, 2, 3, 4] as const;
export type EpaNumber = (typeof epaNumbers)[number];

/** The four EPAs of the National Framework for prevocational (PGY1 and PGY2) training. */
export const epaLabels: Record<EpaNumber, { short: string; long: string }> = {
  1: { short: "Clinical assessment", long: "Clinical assessment" },
  2: { short: "Acutely unwell patient", long: "Recognition and care of the acutely unwell patient" },
  3: { short: "Prescribing", long: "Prescribing" },
  4: { short: "Team communication", long: "Team communication" },
};

/**
 * The PGY1 minimums as the National Framework summary states them (2 a term, 10 a year). They are never
 * applied on their own: the doctor confirms them against that named document (or sets their own), and
 * until then the EPA card shows counts with no target.
 */
export const DEFAULT_EPA_TARGETS = { perTerm: 2, perYear: 10 } as const;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const shortText = z.string().trim().max(120);
const listItemText = z.string().trim().min(1).max(160);

const milestoneSchema = z.object({ dueOn: dateKey, doneOn: dateKey.nullable() });

const termSchema = z.object({
  id: z.string().min(1).max(40),
  number: z.number().int().min(1).max(20).nullable(),
  unit: shortText,
  site: shortText,
  startsOn: dateKey,
  endsOn: dateKey,
  supervisor: shortText,
  milestones: z.object({ start: milestoneSchema, mid: milestoneSchema, end: milestoneSchema }),
  goals: z.array(z.object({ id: z.string().min(1).max(40), text: listItemText, done: z.boolean() })).max(20),
  toRaise: z.array(z.object({ id: z.string().min(1).max(40), text: listItemText })).max(20),
  meeting: z
    .object({
      on: dateKey,
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .or(z.literal("")),
      place: shortText,
    })
    .nullable(),
});

const termTrackerSchema = z.object({
  version: z.literal(1),
  currentTermId: z.string().nullable(),
  terms: z.array(termSchema).max(12),
  epas: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        termId: z.string().min(1).max(40),
        epa: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        on: dateKey,
      }),
    )
    .max(200),
  /** Null until the doctor confirms a target. */
  targets: z.object({ perTerm: z.number().int().min(1).max(20), perYear: z.number().int().min(1).max(60) }).nullable(),
});

export type TermRecord = z.infer<typeof termSchema>;
export type TermTrackerState = z.infer<typeof termTrackerSchema>;
export type EpaEntry = TermTrackerState["epas"][number];

const examPrepSchema = z.object({
  version: z.literal(1),
  exam: z.object({ name: shortText.min(1), on: dateKey, planStartsOn: dateKey }).nullable(),
  /** Minutes studied, by date. */
  study: z.record(
    dateKey,
    z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
  ),
  topics: z
    .array(z.object({ id: z.string().min(1).max(40), name: listItemText, percent: z.number().int().min(0).max(100) }))
    .max(40),
  group: z
    .object({
      title: shortText.min(1),
      on: dateKey,
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .or(z.literal("")),
      place: shortText,
    })
    .nullable(),
});

export type ExamPrepState = z.infer<typeof examPrepSchema>;
export type StudyTopic = ExamPrepState["topics"][number];

export const EMPTY_TERM_TRACKER: TermTrackerState = {
  version: 1,
  currentTermId: null,
  terms: [],
  epas: [],
  targets: null,
};

export const EMPTY_EXAM_PREP: ExamPrepState = { version: 1, exam: null, study: {}, topics: [], group: null };

/** Stored JSON back to a tracker; anything unreadable or from another version is treated as empty. */
export function parseTermTracker(raw: string | null): TermTrackerState {
  if (!raw) return EMPTY_TERM_TRACKER;
  try {
    const parsed = termTrackerSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_TERM_TRACKER;
  } catch {
    return EMPTY_TERM_TRACKER;
  }
}

export function parseExamPrep(raw: string | null): ExamPrepState {
  if (!raw) return EMPTY_EXAM_PREP;
  try {
    const parsed = examPrepSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_EXAM_PREP;
  } catch {
    return EMPTY_EXAM_PREP;
  }
}

/** Validates before saving, so a bad edit can never leave the stored record unreadable. */
export function isValidTermTracker(state: TermTrackerState): boolean {
  return termTrackerSchema.safeParse(state).success;
}

export function isValidExamPrep(state: ExamPrepState): boolean {
  return examPrepSchema.safeParse(state).success;
}

/* ---------- date-key arithmetic ---------- */

function toUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

export function addDays(key: string, days: number): string {
  return fromUtc(toUtc(key) + days * DAY_MS);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Monday on or before the date. */
export function mondayOfKey(key: string): string {
  const weekday = new Date(toUtc(key)).getUTCDay(); // 0 Sunday
  return addDays(key, -((weekday + 6) % 7));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "6 Nov" */
export function dayMonth(key: string): string {
  const date = new Date(toUtc(key));
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "Thu 15 Oct" */
export function weekdayDayMonth(key: string): string {
  return `${WEEKDAYS[new Date(toUtc(key)).getUTCDay()]} ${dayMonth(key)}`;
}

export function monthShort(key: string): string {
  return MONTHS[new Date(toUtc(key)).getUTCMonth()];
}

export function dayOfMonth(key: string): number {
  return new Date(toUtc(key)).getUTCDate();
}

export function weekdayShort(key: string): string {
  return WEEKDAYS[new Date(toUtc(key)).getUTCDay()];
}

/* ---------- term ---------- */

/** Weeks in the term, counted from its first day; a part week counts as a week. */
export function termWeekCount(term: Pick<TermRecord, "startsOn" | "endsOn">): number {
  return Math.max(1, Math.ceil((daysBetween(term.startsOn, term.endsOn) + 1) / 7));
}

/** Which week of the term today falls in: 0 before it starts, `total + 1` after it ends. */
export function termWeekOf(term: Pick<TermRecord, "startsOn" | "endsOn">, today: string): number {
  const total = termWeekCount(term);
  if (today < term.startsOn) return 0;
  if (today > term.endsOn) return total + 1;
  return Math.floor(daysBetween(term.startsOn, today) / 7) + 1;
}

/**
 * Default due dates: the beginning-of-term discussion by the end of week 1, the mid-term assessment at
 * the end of the middle week, and the end-of-term assessment on the last day. The doctor edits any of
 * them to match their own MEU's dates.
 */
export function defaultMilestones(startsOn: string, endsOn: string): TermRecord["milestones"] {
  const total = termWeekCount({ startsOn, endsOn });
  const clamp = (key: string) => (key > endsOn ? endsOn : key);
  return {
    start: { dueOn: clamp(addDays(startsOn, 6)), doneOn: null },
    mid: { dueOn: clamp(addDays(startsOn, Math.ceil(total / 2) * 7 - 3)), doneOn: null },
    end: { dueOn: endsOn, doneOn: null },
  };
}

export type MilestoneState = "done" | "due" | "overdue" | "later";

/** The milestone that is next: the earliest one not yet done. */
export function nextMilestone(term: TermRecord): MilestoneId | null {
  return milestoneIds.find((id) => !term.milestones[id].doneOn) ?? null;
}

export function milestoneState(term: TermRecord, id: MilestoneId, today: string): MilestoneState {
  const milestone = term.milestones[id];
  if (milestone.doneOn) return "done";
  if (milestone.dueOn < today) return "overdue";
  return nextMilestone(term) === id ? "due" : "later";
}

export function currentTerm(state: TermTrackerState): TermRecord | null {
  return state.terms.find((term) => term.id === state.currentTermId) ?? null;
}

export interface EpaSummary {
  readonly year: number;
  readonly term: number;
  readonly byEpa: Record<EpaNumber, number>;
}

/** EPAs this calendar year, and this term (by the term's id), with the year's count for each EPA. */
export function epaSummary(state: TermTrackerState, termId: string | null, today: string): EpaSummary {
  const year = today.slice(0, 4);
  const byEpa: Record<EpaNumber, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let yearCount = 0;
  let termCount = 0;
  for (const entry of state.epas) {
    if (entry.on.slice(0, 4) === year) {
      yearCount += 1;
      byEpa[entry.epa] += 1;
    }
    if (termId && entry.termId === termId) termCount += 1;
  }
  return { year: yearCount, term: termCount, byEpa };
}

/** A short id that is unique enough for one person's own list. */
export function newItemId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

/* ---------- exam prep ---------- */

export interface HeatCell {
  readonly date: string;
  readonly minutes: number;
  /** 0 none, then four steps of study time. */
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly future: boolean;
}

function heatLevel(minutes: number): HeatCell["level"] {
  if (minutes <= 0) return 0;
  if (minutes < 45) return 1;
  if (minutes < 90) return 2;
  if (minutes < 150) return 3;
  return 4;
}

/** The last `weeks` weeks, Monday-first columns ending with this week; days after today are marked. */
export function studyHeatmap(study: ExamPrepState["study"], today: string, weeks = 12): HeatCell[][] {
  const firstMonday = addDays(mondayOfKey(today), -(weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = addDays(firstMonday, week * 7 + day);
      const minutes = study[date] ?? 0;
      return { date, minutes, level: heatLevel(minutes), future: date > today };
    }),
  );
}

/** Minutes across the heatmap's window. */
export function studyMinutesSince(study: ExamPrepState["study"], from: string, today: string): number {
  let total = 0;
  for (const [date, minutes] of Object.entries(study)) if (date >= from && date <= today) total += minutes;
  return total;
}

/**
 * Days in a row with study, ending today, or ending yesterday when today has nothing logged yet (so
 * the streak does not read as broken first thing in the morning).
 */
export function studyStreak(study: ExamPrepState["study"], today: string): number {
  let day = (study[today] ?? 0) > 0 ? today : addDays(today, -1);
  let streak = 0;
  while ((study[day] ?? 0) > 0) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

/** Week of the study plan, from the day the plan started to the exam. */
export function studyPlanWeek(
  exam: NonNullable<ExamPrepState["exam"]>,
  today: string,
): { week: number; total: number } {
  const total = Math.max(1, Math.ceil(daysBetween(exam.planStartsOn, exam.on) / 7));
  const week = Math.min(total, Math.max(0, Math.floor(daysBetween(exam.planStartsOn, today) / 7) + 1));
  return { week, total };
}

export function formatMinutesAsHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} h`;
}

/* ---------- made-up sample for visitors who are not signed in ---------- */

/** A fictional Term 4 in psychiatry, placed around today so it always reads as current. */
export function sampleTermTracker(today: string): TermTrackerState {
  const startsOn = addDays(mondayOfKey(today), -35);
  const endsOn = addDays(startsOn, 67);
  const milestones = defaultMilestones(startsOn, endsOn);
  milestones.start.doneOn = addDays(startsOn, 2);
  // The sample's mid-term meeting is coming up, so the page shows the "next" state rather than "overdue".
  milestones.mid.dueOn = addDays(today, 9);
  const termId = "sample-term-4";
  const earlier = `${today.slice(0, 4)}-03-10`;
  return {
    version: 1,
    currentTermId: termId,
    targets: { ...DEFAULT_EPA_TARGETS },
    terms: [
      {
        id: termId,
        number: 4,
        unit: "Psychiatry",
        site: "Example Hospital",
        startsOn,
        endsOn,
        supervisor: "Dr Example",
        milestones,
        goals: [
          { id: "g1", text: "Present at journal club", done: true },
          { id: "g2", text: "Lead a family meeting, supervised", done: false },
          { id: "g3", text: "Two EPAs this term", done: false },
        ],
        toRaise: [
          { id: "r1", text: "Exam leave in January" },
          { id: "r2", text: "Feedback on handovers" },
        ],
        meeting: { on: milestones.mid.dueOn, time: "16:00", place: "Office 3" },
      },
    ],
    epas: [
      { id: "e1", termId: "sample-term-1", epa: 1, on: earlier },
      { id: "e2", termId: "sample-term-1", epa: 2, on: addDays(earlier, 14) },
      { id: "e3", termId: "sample-term-2", epa: 1, on: addDays(earlier, 60) },
      { id: "e4", termId: "sample-term-2", epa: 3, on: addDays(earlier, 75) },
      { id: "e5", termId: "sample-term-2", epa: 4, on: addDays(earlier, 90) },
      { id: "e6", termId: "sample-term-3", epa: 1, on: addDays(earlier, 120) },
      { id: "e7", termId, epa: 3, on: addDays(startsOn, 20) },
    ].filter((entry) => entry.on <= today) as EpaEntry[],
  };
}

/** A fictional exam year: a written exam a few months away, nine days of study in a row, five topics. */
export function sampleExamPrep(today: string): ExamPrepState {
  // Matches the approved v5 mock-up: 111 days to go, week 6 of a 22-week plan, nine days in a row (the day
  // before them left empty) and 55.5 h across the 12-week heatmap.
  const study: Record<string, number> = {};
  const pattern = [60, 0, 60, 30, 0, 90, 30, 0, 60, 45, 0, 0, 60, 120];
  for (let back = 83; back >= 10; back -= 1) {
    const minutes = pattern[back % pattern.length];
    if (minutes) study[addDays(today, -back)] = minutes;
  }
  for (let back = 8; back >= 0; back -= 1) study[addDays(today, -back)] = [45, 60, 90, 30, 120, 60, 45, 90, 60][back];
  const examOn = addDays(today, 111);
  return {
    version: 1,
    exam: { name: "Written exam", on: examOn, planStartsOn: addDays(today, -40) },
    study,
    // Made-up topic names, shown as one doctor's own list, not a college syllabus.
    topics: [
      { id: "t1", name: "Past papers", percent: 60 },
      { id: "t2", name: "Critical appraisal", percent: 45 },
      { id: "t3", name: "Psychotherapy", percent: 30 },
      { id: "t4", name: "Old age psychiatry", percent: 20 },
      { id: "t5", name: "Child and adolescent", percent: 0 },
    ],
    group: { title: "Practice questions", on: addDays(today, 2), time: "19:00", place: "" },
  };
}
