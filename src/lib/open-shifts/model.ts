import type { RosterGrade, RosterOpenShift } from "@/lib/roster/team/model";
import { gradeRank } from "@/lib/roster/team/eligibility";
import { addDaysToDate, perthDateOf, perthTimeOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/**
 * Open shifts, version 1: the open shifts a doctor's Roster teams already
 * post (`roster_open_shifts`), gathered across every team they belong to.
 * Nothing new is stored. A listing is one team's `requests` row plus the
 * team and site names the same team's `overview` read gives.
 */

export type OpenShiftListing = RosterOpenShift & {
  readonly serviceId: string;
  readonly teamName: string;
  readonly siteName: string | null;
  /** The reader's grade in this team; grade can differ between teams. */
  readonly myGrade: RosterGrade | null;
};

export type TimeOfDay = "day" | "evening" | "night";

export const TIME_OF_DAY: readonly TimeOfDay[] = ["day", "evening", "night"];

/** The bands the mock-up shows beside each choice. */
export const TIME_OF_DAY_LABEL: Readonly<Record<TimeOfDay, { label: string; range: string }>> = {
  day: { label: "Day", range: "07:00–13:59" },
  evening: { label: "Evening", range: "14:00–19:59" },
  night: { label: "Night", range: "20:00–06:59" },
};

/** Day 07:00–13:59, evening 14:00–19:59, night 20:00–06:59, by the Perth start time. */
export function timeOfDay(startsAt: string): TimeOfDay {
  const [hours] = perthTimeOf(startsAt).split(":").map(Number);
  if (hours >= 7 && hours < 14) return "day";
  if (hours >= 14 && hours < 20) return "evening";
  return "night";
}

/** The browse window: today and the 13 days after, as Perth dates. */
export const WINDOW_DAYS = 14;

export function windowOf(today: string): { start: string; end: string } {
  return { start: today, end: addDaysToDate(today, WINDOW_DAYS - 1) };
}

export function inWindow(listing: Pick<OpenShiftListing, "startsAt">, today: string): boolean {
  const date = perthDateOf(listing.startsAt);
  const { start, end } = windowOf(today);
  return date >= start && date <= end;
}

/** Shifts a doctor could ask for: open, not their own post, not already theirs, not started. */
export function isBrowsable(listing: OpenShiftListing, now: Date): boolean {
  return (
    listing.status === "open" && !listing.mine && !listing.claimedByMe && Date.parse(listing.startsAt) > now.getTime()
  );
}

/** True when the shift is for a lower level than the reader's own in that team. */
export function isBelowMyLevel(listing: OpenShiftListing): boolean {
  const mine = gradeRank(listing.myGrade);
  const minimum = gradeRank(listing.minGrade);
  return mine !== null && minimum !== null && minimum < mine;
}

/** Hours, to one decimal place, between two instants. */
export function hoursBetween(startsAt: string, endsAt: string): number {
  return Math.round(((Date.parse(endsAt) - Date.parse(startsAt)) / 3_600_000) * 10) / 10;
}

/** "8.5 h" */
export function formatHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} h`;
}

/** Whether the shift ends on a later Perth day than it starts. */
export function endsNextDay(startsAt: string, endsAt: string): boolean {
  return perthDateOf(endsAt) > perthDateOf(startsAt);
}

const GRADE_LABEL: Readonly<Record<RosterGrade, string>> = {
  intern: "Intern",
  resident: "Resident",
  registrar: "Registrar",
  fellow: "Fellow",
  consultant: "Consultant",
  other: "Other",
};

export function gradeLabel(grade: RosterGrade | null): string {
  return grade ? GRADE_LABEL[grade] : "Any level";
}

const KIND_LABEL: Readonly<Record<RosterOpenShift["kind"], string>> = {
  day: "Day shift",
  evening: "Evening shift",
  night: "Night shift",
  on_call: "On call",
  other: "Shift",
};

export function kindLabel(kind: RosterOpenShift["kind"]): string {
  return KIND_LABEL[kind];
}

/** A Perth start and end from a date and two wall times; an end at or before the start is the next day. */
export function gapTimes(date: string, start: string, end: string): { startsAt: string; endsAt: string } | null {
  const startsAt = perthWallToIso(date, start);
  const endsAt = perthWallToIso(end > start ? date : addDaysToDate(date, 1), end);
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}
