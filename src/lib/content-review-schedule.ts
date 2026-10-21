import { confirmedSourceChangesAfter, type SourceChangeEvent } from "@/lib/sources/source-change-events";

/**
 * When a reference record is next due for clinical review, and why.
 *
 * Owner decision (21 Oct 2026): medications and interactions are reviewed every 12
 * months, therapy and forms every 24 months, and any of them immediately when a
 * guideline it cites changes. See docs/decisions/2026-10-21-content-review-intervals.md.
 *
 * The schedule is worked out here, at read time, from the record's own last-reviewed
 * date. Nothing is stored, so a date can never sit in a column and stop ageing.
 *
 * Due is disclosed, never enforced: a record past its date stays readable and says so,
 * the same disclosure rule therapy has followed since 19 Aug 2026.
 */
export type ReviewedContentKind = "medication" | "interaction" | "therapy" | "form";

export const REVIEW_INTERVAL_MONTHS: Readonly<Record<ReviewedContentKind, number>> = {
  medication: 12,
  interaction: 12,
  therapy: 24,
  form: 24,
};

/**
 * The register sources every WA Mental Health Act form is drafted from: the Act itself
 * and the Chief Psychiatrist's page for it. A confirmed change to either makes every
 * signed-off form due for review.
 */
export const FORM_CITED_SOURCE_IDS: readonly string[] = [
  "mental-health-act-2014-wa",
  "dictionary-wa-ocp-mental-health-act-2014",
];

/** How far ahead a coming due date is flagged. */
export const REVIEW_DUE_SOON_DAYS = 30;

/**
 * - `current`: reviewed within its interval.
 * - `due_soon`: due within `REVIEW_DUE_SOON_DAYS`.
 * - `due`: the interval has passed.
 * - `guideline_changed`: a cited source changed after the last review. Due now,
 *   whatever the interval says.
 * - `unknown`: no usable last-reviewed date, so no due date can be stated.
 */
export type ContentReviewState = "current" | "due_soon" | "due" | "guideline_changed" | "unknown";

export type ContentReviewSchedule = {
  kind: ReviewedContentKind;
  state: ContentReviewState;
  /** ISO calendar date (yyyy-mm-dd) of the last review, or null when unknown. */
  lastReviewedOn: string | null;
  /** ISO calendar date the interval runs out, or null when unknown. */
  dueOn: string | null;
  /** Confirmed changes to cited sources since the last review, newest first. */
  changedSources: readonly SourceChangeEvent[];
};

// A review date ahead of the reading clock cannot describe a review that has already
// happened. One day absorbs the Perth (UTC+8) to UTC gap; anything further is a typo
// and is treated as unknown, matching `evaluateSourceStatus` for medications.
const FUTURE_DATE_TOLERANCE_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date part of an ISO date or instant, or null when it is not a real date. */
export function isoCalendarDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Add whole calendar months, clamping to the last day of a shorter month
 * (31 Jan + 1 month = 28 or 29 Feb), so a due date is never pushed into the
 * following month.
 */
export function addCalendarMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}

function utcDay(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000Z`);
}

export function contentReviewSchedule(input: {
  kind: ReviewedContentKind;
  /** ISO date or instant of the last review. Null, blank or malformed means unknown. */
  lastReviewedAt: string | null | undefined;
  /** Source-register ids the record cites. A confirmed change to any of them makes it due now. */
  citedSourceIds?: readonly string[];
  referenceDate?: Date;
  /** Override for tests; defaults to the committed change register. */
  changeEvents?: readonly SourceChangeEvent[];
}): ContentReviewSchedule {
  const referenceDate = input.referenceDate ?? new Date();
  const today = referenceDate.toISOString().slice(0, 10);
  let lastReviewedOn = isoCalendarDate(input.lastReviewedAt);
  if (lastReviewedOn && utcDay(lastReviewedOn) - utcDay(today) > FUTURE_DATE_TOLERANCE_DAYS * DAY_MS) {
    lastReviewedOn = null;
  }

  const changedSources = confirmedSourceChangesAfter(input.citedSourceIds ?? [], lastReviewedOn, input.changeEvents);
  const dueOn = lastReviewedOn ? addCalendarMonths(lastReviewedOn, REVIEW_INTERVAL_MONTHS[input.kind]) : null;

  let state: ContentReviewState;
  if (changedSources.length > 0) state = "guideline_changed";
  else if (!dueOn) state = "unknown";
  else if (utcDay(today) >= utcDay(dueOn)) state = "due";
  else if (utcDay(dueOn) - utcDay(today) <= REVIEW_DUE_SOON_DAYS * DAY_MS) state = "due_soon";
  else state = "current";

  return { kind: input.kind, state, lastReviewedOn, dueOn, changedSources };
}

/** True when the record needs a review now: past its date, or a cited guideline changed. */
export function isReviewDueNow(schedule: Pick<ContentReviewSchedule, "state">): boolean {
  return schedule.state === "due" || schedule.state === "guideline_changed";
}

const MONTHS = [
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
] as const;

/**
 * "3 December 2026", built from the ISO parts by hand so a server render and the
 * browser's hydration produce identical text in any locale or timezone.
 */
export function formatReviewDate(isoDate: string | null): string | null {
  const date = isoCalendarDate(isoDate);
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** One plain sentence for a record's review state, or null when there is nothing to flag. */
export function contentReviewSentence(schedule: ContentReviewSchedule): string | null {
  const due = formatReviewDate(schedule.dueOn);
  switch (schedule.state) {
    case "guideline_changed": {
      const latest = schedule.changedSources[0];
      const changedOn = formatReviewDate(latest?.changedOn ?? null);
      return changedOn
        ? `Review due now: a guideline this record cites changed on ${changedOn}.`
        : "Review due now: a guideline this record cites has changed.";
    }
    case "due":
      return due ? `Review overdue: this record was due for review on ${due}.` : "Review overdue.";
    case "due_soon":
      return due ? `Review due by ${due}.` : null;
    case "unknown":
      return "Review date unknown: no review has been recorded for this record.";
    case "current":
      return null;
  }
}
