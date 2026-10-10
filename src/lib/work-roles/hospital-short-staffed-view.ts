import { safeWords, type CountedKind, type SafeJudgement, type SafeShort } from "@/lib/roster/staffing/team-staffing";
import type { WorkRoleGrant } from "@/lib/work-roles/model";
import { formatZonedDay, zonedDateOf } from "@/lib/work-time/format";
import { DEFAULT_WORK_TIME_ZONE } from "@/lib/work-time/zones";

import { sickDayLabel, teamCoverHref, type HospitalRef } from "./hospital-hub";

/**
 * Short-staffed days (`/admin/hospital/short-staffed`), the pure part. Every
 * upcoming day on which a team linked to the hospital has fewer people on than
 * its safe number, for Medical Workforce and the site administrator. Counts and
 * team names only: never who is on leave or why. This file is client safe. The
 * server read is `hospital-short-staffed.ts`, which judges each day with the
 * same helpers the leave staffing check uses (`team-staffing.ts`).
 */

/** How far ahead the screen looks: today and the 27 days after it, so four whole weeks. */
export const SHORT_STAFFED_DAYS = 28;

export type ShortStaffedWindow = { readonly from: string; readonly to: string };

/** Today in the work time zone through the last of the four weeks. */
export function shortStaffedWindow(now: Date, zone: string = DEFAULT_WORK_TIME_ZONE): ShortStaffedWindow {
  const from = zonedDateOf(now, zone);
  return { from, to: addDays(from, SHORT_STAFFED_DAYS - 1) };
}

export type ShortStaffedTeam = {
  readonly serviceId: string;
  readonly name: string;
  /** The team has a whole-team Day or Evening safe number, so its days can be judged. */
  readonly safeNumber: boolean;
  /** The last day in the window the published roster reaches, or null when it reaches none of it. */
  readonly checkedThrough: string | null;
};

/** One team on one day, below its safe number. Counts only. */
export type ShortStaffedDay = {
  readonly date: string;
  readonly serviceId: string;
  readonly teamName: string;
  /** People on a Day or Evening shift. */
  readonly on: number;
  /** The day's safe number. */
  readonly needed: number;
  /** Each kind with fewer on than it needs. Empty when only the day as a whole is short. */
  readonly short: readonly SafeShort[];
  /** The kinds the safe number covers that day, for the tag when no single kind is short. */
  readonly kinds: readonly CountedKind[];
};

export type HospitalShortStaffedView = {
  readonly hospital: HospitalRef;
  readonly window: ShortStaffedWindow;
  readonly teams: readonly ShortStaffedTeam[];
  readonly days: readonly ShortStaffedDay[];
};

const KINDS: readonly CountedKind[] = ["day", "evening"];
const KIND_WORDS: Readonly<Record<CountedKind, string>> = { day: "Day", evening: "Evening" };

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------- parse */

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const kindOf = (value: unknown): CountedKind | null => KINDS.find((kind) => kind === value) ?? null;

function parseShort(value: unknown): SafeShort | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const kind = kindOf(row.kind);
  const on = count(row.on);
  const needed = count(row.needed);
  return kind && on !== null && needed !== null ? { kind, on, needed } : null;
}

function parseDay(value: unknown): ShortStaffedDay | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const serviceId = text(row.serviceId);
  const on = count(row.on);
  const needed = count(row.needed);
  if (!isDate(row.date) || !serviceId || on === null || needed === null) return null;
  const short = Array.isArray(row.short) ? row.short.map(parseShort) : [];
  // A day with a short kind it cannot read is dropped, never shown half right.
  if (short.some((entry) => entry === null)) return null;
  const kinds = Array.isArray(row.kinds)
    ? row.kinds.map(kindOf).filter((kind): kind is CountedKind => kind !== null)
    : [];
  return {
    date: row.date,
    serviceId,
    teamName: text(row.teamName) ?? "Team",
    on,
    needed,
    short: short as SafeShort[],
    kinds,
  };
}

/** Reads the API's answer leniently: a row it cannot read is dropped, never shown half right. */
export function parseHospitalShortStaffedView(body: unknown): HospitalShortStaffedView | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const hospital = (record.hospital ?? {}) as Record<string, unknown>;
  const window = (record.window ?? {}) as Record<string, unknown>;
  const id = text(hospital.id);
  if (!id || !isDate(window.from) || !isDate(window.to)) return null;
  const teams = Array.isArray(record.teams)
    ? record.teams.flatMap((team): ShortStaffedTeam[] => {
        const row = (team ?? {}) as Record<string, unknown>;
        const serviceId = text(row.serviceId);
        if (!serviceId) return [];
        return [
          {
            serviceId,
            name: text(row.name) ?? "Team",
            safeNumber: row.safeNumber === true,
            checkedThrough: isDate(row.checkedThrough) ? row.checkedThrough : null,
          },
        ];
      })
    : [];
  const days = Array.isArray(record.days)
    ? record.days.flatMap((day) => {
        const parsed = parseDay(day);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    hospital: { id, name: text(hospital.name) ?? "Your hospital" },
    window: { from: window.from, to: window.to },
    teams,
    days,
  };
}

/* ---------------------------------------------------------------- words */

function judgementOf(day: ShortStaffedDay): SafeJudgement {
  return { on: day.on, needed: day.needed, below: true, short: day.short };
}

/** `3 on, needs 4`, or per kind when one kind is short, exactly as the leave staffing check says it. */
export function shortStaffedWords(day: ShortStaffedDay): string {
  return safeWords(judgementOf(day));
}

/** The kind that is short: `Day`, `Evening` or `Day and Evening`. */
export function shortStaffedKindWords(day: ShortStaffedDay): string {
  const kinds = day.short.length ? day.short.map((row) => row.kind) : day.kinds;
  const ordered = KINDS.filter((kind) => kinds.includes(kind));
  return ordered.length ? ordered.map((kind) => KIND_WORDS[kind]).join(" and ") : "Day and Evening";
}

/** How many people short the day is: the bigger of the whole day's gap and any one kind's. */
export function shortStaffedGap(day: ShortStaffedDay): number {
  return Math.max(day.needed - day.on, ...day.short.map((row) => row.needed - row.on));
}

export type ShortStaffedDate = {
  readonly date: string;
  /** "Today", "Tomorrow", else "Mon 3 Oct". */
  readonly label: string;
  /** Worst first, then by team name. */
  readonly rows: readonly ShortStaffedDay[];
};

/** Groups the short days by date, soonest first, and puts the worst team first within each day. */
export function groupShortStaffedDays(days: readonly ShortStaffedDay[], today: string): readonly ShortStaffedDate[] {
  const byDate = new Map<string, ShortStaffedDay[]>();
  for (const day of days) {
    const list = byDate.get(day.date);
    if (list) list.push(day);
    else byDate.set(day.date, [day]);
  }
  return [...byDate.keys()].sort().map((date) => ({
    date,
    label: sickDayLabel(date, today),
    rows: [...byDate.get(date)!].sort(
      (a, b) =>
        shortStaffedGap(b) - shortStaffedGap(a) ||
        a.teamName.localeCompare(b.teamName) ||
        a.serviceId.localeCompare(b.serviceId),
    ),
  }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Ward A psychiatry", "Ward A and Ward B", or "Ward A, Ward B and Ward C". */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "3 days with a team below its safe number", or null when none. */
export function shortStaffedSummary(view: HospitalShortStaffedView): string | null {
  const dates = new Set(view.days.map((day) => day.date)).size;
  if (dates === 0) return null;
  return `${plural(dates, "day", "days")} with a team below its safe number`;
}

/** Teams with no safe number set, so silence is never read as fine. */
export function teamsWithoutSafeNumber(view: HospitalShortStaffedView): readonly ShortStaffedTeam[] {
  return view.teams.filter((team) => !team.safeNumber);
}

/** "2 teams have no safe number set: Ward A psychiatry and Community team." Null when every team has one. */
export function noSafeNumberLine(view: HospitalShortStaffedView): string | null {
  const teams = teamsWithoutSafeNumber(view);
  if (!teams.length) return null;
  const lead = teams.length === 1 ? "1 team has no safe number set" : `${teams.length} teams have no safe number set`;
  return `${lead}: ${nameList(teams.map((team) => team.name))}.`;
}

/**
 * Teams with a safe number whose published roster stops before the four weeks
 * end. Those days are not rostered yet, so they are not checked, never "fine".
 * "Not rostered yet, so not checked: Ward B psychiatry from Sat 24 Oct, Emergency psychiatry for all 4 weeks."
 */
export function notRosteredLine(view: HospitalShortStaffedView): string | null {
  const parts = view.teams
    .filter((team) => team.safeNumber && (team.checkedThrough === null || team.checkedThrough < view.window.to))
    .map((team) =>
      team.checkedThrough === null
        ? `${team.name} for all 4 weeks`
        : `${team.name} from ${formatZonedDay(addDays(team.checkedThrough, 1))}`,
    );
  return parts.length ? `Not rostered yet, so not checked: ${parts.join(", ")}.` : null;
}

/** True when at least one team has a safe number and some published days, so a day could be judged. */
export function anyDayJudged(view: HospitalShortStaffedView): boolean {
  return view.teams.some((team) => team.safeNumber && team.checkedThrough !== null);
}

/** A team's Cover view, only for that team's own roster manager. Everyone else gets no link. */
export function shortStaffedTeamHref(serviceId: string, grants: readonly WorkRoleGrant[]): string | null {
  return grants.some((grant) => grant.role === "manager" && grant.serviceId === serviceId)
    ? teamCoverHref(serviceId)
    : null;
}
