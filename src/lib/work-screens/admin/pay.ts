import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { fortnightFor, summariseHours, type HoursExtra, type HoursShift } from "@/lib/roster/hours";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import type { PayslipCheck } from "@/lib/work-screens/admin/paperwork-model";

/**
 * Admin · Pay: a payslip check against the doctor's own roster. The roster's
 * hours come from the same helpers Roster and My Day use (`summariseHours`,
 * `fortnightFor`), and extra time from the record Roster keeps
 * (`/api/roster/extra-time`). The doctor types the hours printed on the
 * payslip. The check compares hours only: PsychSift holds no pay rates, award
 * clauses or entitlements, so it never says what the pay should be.
 */

/** Differences smaller than this (about a minute) read as a match, so rounding never raises a flag. */
export const PAY_HOURS_TOLERANCE = 0.02;

export type PayWindow = { readonly start: string; readonly end: string };

/** This pay fortnight and the one before, newest first. */
export function payWindows(today: string, anchor: string | null): [PayWindow, PayWindow] {
  const current = fortnightFor(today, anchor);
  const previous = fortnightFor(addDaysToDate(current.start, -1), anchor);
  return [current, previous];
}

export function formatPayWindow(window: PayWindow): string {
  const start = formatRecordedDate(window.start).replace(/\s\d{4}$/, "");
  return `${start} to ${formatRecordedDate(window.end).replace(/\s\d{4}$/, "")}`;
}

export function formatPayHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  const text = rounded.toFixed(2).replace(/\.?0+$/, "");
  return `${text} h`;
}

export interface RosterHoursForWindow {
  readonly rosteredHours: number;
  readonly extraHours: number;
}

export function rosterHoursFor(
  shifts: readonly HoursShift[],
  extras: readonly HoursExtra[],
  window: PayWindow,
): RosterHoursForWindow {
  const summary = summariseHours(shifts, extras, window);
  return { rosteredHours: summary.totalHours, extraHours: summary.extraHours };
}

export type PayCompare = "match" | "fewer" | "more";

export interface PayslipResult {
  readonly ordinary: { readonly compare: PayCompare; readonly difference: number };
  /** Null when the doctor left the payslip's extra hours blank. */
  readonly extra: { readonly compare: PayCompare; readonly difference: number } | null;
  readonly matches: boolean;
}

function compare(payslip: number, roster: number): { compare: PayCompare; difference: number } {
  const difference = Math.round((payslip - roster) * 100) / 100;
  if (Math.abs(difference) < PAY_HOURS_TOLERANCE) return { compare: "match", difference: 0 };
  return { compare: difference < 0 ? "fewer" : "more", difference: Math.abs(difference) };
}

export function payslipResult(
  check: Pick<PayslipCheck, "payslipOrdinaryHours" | "payslipExtraHours" | "rosteredHours" | "loggedExtraHours">,
): PayslipResult {
  const ordinary = compare(check.payslipOrdinaryHours, check.rosteredHours);
  const extra = check.payslipExtraHours === undefined ? null : compare(check.payslipExtraHours, check.loggedExtraHours);
  return { ordinary, extra, matches: ordinary.compare === "match" && (extra === null || extra.compare === "match") };
}

export function payslipResultWord(result: PayslipResult, resolved: boolean | undefined): string {
  if (result.matches) return "Hours match";
  return resolved ? "Sorted" : "Hours differ";
}

export function compareLine(label: string, part: { compare: PayCompare; difference: number }): string {
  if (part.compare === "match") return `${label} match`;
  return `${label}: payslip shows ${formatPayHours(part.difference)} ${part.compare === "fewer" ? "fewer" : "more"}`;
}

/** A message the doctor sends payroll themselves when the hours differ. Hours only, no pay figures. */
export function payrollMessage(check: PayslipCheck): string {
  const window = formatPayWindow({ start: check.periodStart, end: check.periodEnd });
  const lines = [`Could you please check my pay for ${window}?`];
  lines.push(
    `My payslip shows ${formatPayHours(check.payslipOrdinaryHours)} ordinary hours. My roster shows ${formatPayHours(check.rosteredHours)}.`,
  );
  if (check.payslipExtraHours !== undefined) {
    lines.push(
      `It shows ${formatPayHours(check.payslipExtraHours)} of extra hours. I logged ${formatPayHours(check.loggedExtraHours)} of extra time.`,
    );
  }
  lines.push("Thank you.");
  return lines.join("\n");
}

export interface PayslipDraft {
  readonly windowIndex: 0 | 1;
  readonly paidOn: string;
  readonly ordinary: string;
  readonly extra: string;
  readonly rostered: string;
  readonly logged: string;
  readonly note: string;
}

/** A number of hours as typed: digits with an optional decimal, or "7:30" as hours and minutes. */
export function parseHours(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(value);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(value)) return null;
  const hours = Number(value.replace(",", "."));
  return Number.isFinite(hours) && hours <= 400 ? hours : null;
}

export function validatePayslipDraft(draft: PayslipDraft): {
  ordinary?: string;
  extra?: string;
  rostered?: string;
  logged?: string;
} {
  const errors: { ordinary?: string; extra?: string; rostered?: string; logged?: string } = {};
  if (parseHours(draft.ordinary) === null)
    errors.ordinary = "Type the ordinary hours from your payslip, like 76 or 76.5.";
  if (draft.extra.trim() && parseHours(draft.extra) === null)
    errors.extra = "Type hours, like 2 or 1.5, or leave it blank.";
  if (parseHours(draft.rostered) === null) errors.rostered = "Type your rostered hours, like 80.";
  if (draft.logged.trim() && parseHours(draft.logged) === null)
    errors.logged = "Type hours, like 2, or leave it blank.";
  return errors;
}

export function payslipFromDraft(draft: PayslipDraft, window: PayWindow, id: string, checkedOn: string): PayslipCheck {
  const extra = parseHours(draft.extra);
  const check: PayslipCheck = {
    id,
    periodStart: window.start,
    periodEnd: window.end,
    payslipOrdinaryHours: parseHours(draft.ordinary) ?? 0,
    rosteredHours: parseHours(draft.rostered) ?? 0,
    loggedExtraHours: parseHours(draft.logged) ?? 0,
    checkedOn,
    ...(extra !== null ? { payslipExtraHours: extra } : {}),
    ...(draft.paidOn ? { paidOn: draft.paidOn } : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  };
  return check;
}

/** Newest pay period first. */
export function sortPayslips(checks: readonly PayslipCheck[]): PayslipCheck[] {
  return [...checks].sort((a, b) =>
    a.periodStart === b.periodStart ? (a.checkedOn < b.checkedOn ? 1 : -1) : a.periodStart < b.periodStart ? 1 : -1,
  );
}
