import { formatRelativeDate, renewalStartOn } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { RequirementChecklistRow } from "@/lib/admin/requirements";
import { onCallTeachingDateParts } from "@/lib/on-call/teaching-schedule";

/**
 * The row's urgency, as a shape and a plain word — never colour (final design,
 * screens-v3, spec rule 2 as carried into this round): a triangle means "start
 * renewing now", a diamond means the recorded date has passed, and a dashed
 * ring means nothing has been recorded yet. A row that is recorded but not yet
 * due for renewal carries no shape at all — the future start date is enough —
 * and a row recorded with no end date at all reads as plain grey "Recorded".
 *
 * This is a different axis from `AdminUrgencyMark`'s bands (which shapes by
 * CONSEQUENCE — what lapsing this costs). Here the shape follows STATE — where
 * this particular date sits in time — which is what the final design's rows
 * show. Both are legitimate readings of the same row; this file owns the one
 * the Renewals checklist draws.
 */
export type RowUrgencyShape = "triangle" | "diamond" | "ring" | null;

export interface RowUrgency {
  readonly shape: RowUrgencyShape;
  readonly word: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `YYYY-MM-DD` as "2 Nov" — day and month, no year, exactly as the checklist's
 *  future "Start" rows print it. `formatRecordedDate` always carries the year,
 *  which is right for an expiry but too long for this short trailing word. */
export function shortStartDate(date: string): string {
  const { day, month } = onCallTeachingDateParts(date);
  if (day && month) return `${day} ${month}`;
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${Number(match[2])} ${MONTHS[Number(match[1]) - 1]}` : date;
}

export function requirementRowUrgency(row: RequirementChecklistRow, now: Date): RowUrgency {
  if (row.state === "not-recorded") return { shape: "ring", word: "Not recorded yet" };
  if (row.state === "no-end-date") return { shape: null, word: "Recorded" };
  const today = perthCalendarDate(now);
  const expiresOn = row.expiresOn as string;
  if (expiresOn < today) return { shape: "diamond", word: "Date passed" };
  const startOn = row.entry ? renewalStartOn(row.entry) : undefined;
  if (startOn && startOn <= today) return { shape: "triangle", word: "Start renewing" };
  return { shape: null, word: startOn ? `Start ${shortStartDate(startOn)}` : "Recorded" };
}

/** The one line under a title: the absolute recorded date, then the relative
 *  wording, exactly as the mockups print it ("3 Sep 2026 · 3 weeks ago"). */
export function requirementDateLine(expiresOn: string | undefined, now: Date): string | null {
  if (!expiresOn) return null;
  const today = perthCalendarDate(now);
  const { day, month, year } = onCallTeachingDateParts(expiresOn);
  const absolute = day && month ? `${day} ${month} ${year}` : expiresOn;
  const relative = formatRelativeDate(expiresOn, today);
  return relative ? `${absolute} · ${relative}` : absolute;
}

/** "14 Oct", with the year only when it is not this year ("12 Mar 2027"). */
export function shortDateFrom(date: string, today: string): string {
  const short = shortStartDate(date);
  return date.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${date.slice(0, 4)}`;
}

/**
 * The mockup's mono line under a checklist row's name (work-mode redesign,
 * 6 Oct 2026): "Passed 3 Sep · 3 weeks ago", "Renew by 14 Oct · in 8 days",
 * "Renew by 30 Sep 2027", or "Not recorded yet". Dates the reader entered,
 * said as dates, never as a verdict.
 */
export function requirementActionLine(row: RequirementChecklistRow, now: Date): string {
  if (row.state === "not-recorded") return "Not recorded yet";
  if (!row.expiresOn) return "Recorded, no end date";
  const today = perthCalendarDate(now);
  const relative = formatRelativeDate(row.expiresOn, today);
  const when = shortDateFrom(row.expiresOn, today);
  if (row.expiresOn < today) return `Passed ${when} · ${relative}`;
  const startOn = row.entry ? renewalStartOn(row.entry) : undefined;
  if (startOn && startOn <= today) return `Renew by ${when} · ${relative}`;
  return `Renew by ${when}`;
}
