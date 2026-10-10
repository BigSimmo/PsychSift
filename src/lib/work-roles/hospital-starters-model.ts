import { formatZonedDay } from "@/lib/work-time/format";

/**
 * New starters (`/admin/hospital/starters`): the New job progress of doctors
 * in one hospital's teams who chose to share it with Medical Workforce. This
 * file is pure and client safe. It holds the shape the API sends, the lenient
 * parse, the grouping the screen draws, and the one rule for reading a
 * doctor's sharing choice. The server reader is `hospital-starters.ts`.
 *
 * Sharing is OFF unless the doctor turned it on, on their own New job page.
 * Only `true` counts as on: a missing, malformed or `false` choice is off.
 */

/** New starters for one hospital. The hub's Workforce "New starters" row links here. */
export const HOSPITAL_STARTERS_HREF = "/admin/hospital/starters";

export function hospitalStartersHref(hospitalId: string | null): string {
  return hospitalId
    ? `${HOSPITAL_STARTERS_HREF}?${new URLSearchParams({ hospitalId }).toString()}`
    : HOSPITAL_STARTERS_HREF;
}

/** Where the doctor's choice lives: `user_preferences.preferences.starterSharing`. */
export const STARTER_SHARING_PREFERENCE_KEY = "starterSharing";

export type StarterSharingChoice = {
  /** True only when the doctor turned sharing on. */
  readonly workforce: boolean;
  readonly updatedAt: string | null;
};

/** Reads the stored choice. Anything other than an explicit `workforce: true` is off. */
export function readStarterSharingChoice(preferences: unknown): StarterSharingChoice {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return { workforce: false, updatedAt: null };
  }
  const stored = (preferences as Record<string, unknown>)[STARTER_SHARING_PREFERENCE_KEY];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { workforce: false, updatedAt: null };
  const record = stored as Record<string, unknown>;
  return {
    workforce: record.workforce === true,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

/** One doctor who shares, as `GET /api/work/hospital/starters` sends it. */
export type HospitalStarter = {
  /** The doctor's account id, used only as a stable key. */
  readonly id: string;
  readonly name: string;
  /** The hospital's teams they are an active member of, by name. */
  readonly teams: readonly string[];
  /** `YYYY-MM-DD` as the doctor entered it, or null when they have not set one. */
  readonly startsOn: string | null;
  /** Shared (not personal) New job items ticked done. */
  readonly done: number;
  /** Shared (not personal) New job items. */
  readonly total: number;
  /** Titles of shared items still to do, in the doctor's own order. */
  readonly toDo: readonly string[];
};

export type HospitalStartersView = {
  readonly hospital: { readonly id: string; readonly name: string };
  readonly teams: readonly { readonly serviceId: string; readonly name: string }[];
  readonly starters: readonly HospitalStarter[];
};

/** Example records for New starters, one view per example hospital. */
export type ExampleHospitalStarters = {
  readonly hospitals: readonly HospitalStartersView[];
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseStarter(value: unknown): HospitalStarter | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const done = count(row.done);
  const total = count(row.total);
  if (!id || done === null || total === null || done > total) return null;
  const startsOn = text(row.startsOn);
  return {
    id,
    name: text(row.name) ?? "Team member",
    teams: Array.isArray(row.teams) ? row.teams.flatMap((team) => (text(team) ? [team as string] : [])) : [],
    startsOn: startsOn && DATE_KEY.test(startsOn) ? startsOn : null,
    done,
    total,
    toDo: Array.isArray(row.toDo) ? row.toDo.flatMap((title) => (text(title) ? [title as string] : [])) : [],
  };
}

/** Reads the API's answer leniently: a row it cannot read is dropped, never shown half right. */
export function parseHospitalStartersView(body: unknown): HospitalStartersView | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const hospital = record.hospital as Record<string, unknown> | null | undefined;
  const id = text(hospital?.id);
  if (!id) return null;
  const teams = Array.isArray(record.teams)
    ? record.teams.flatMap((team) => {
        const row = (team ?? {}) as Record<string, unknown>;
        const serviceId = text(row.serviceId);
        return serviceId ? [{ serviceId, name: text(row.name) ?? "Team" }] : [];
      })
    : [];
  const starters = Array.isArray(record.starters)
    ? record.starters.flatMap((starter) => {
        const parsed = parseStarter(starter);
        return parsed ? [parsed] : [];
      })
    : [];
  return { hospital: { id, name: text(hospital?.name) ?? "Your hospital" }, teams, starters };
}

/* -------------------------------------------------------------- grouping */

/** A starter who began more than this many days ago is shown folded away. */
export const STARTER_PAST_AFTER_DAYS = 28;

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

export type HospitalStarterGroups = {
  /** Starting today or later, soonest first. */
  readonly upcoming: readonly HospitalStarter[];
  /** Started in the last four weeks, most recent first. */
  readonly recent: readonly HospitalStarter[];
  /** No start date set, by name. */
  readonly undated: readonly HospitalStarter[];
  /** Started more than four weeks ago, most recent first. Shown folded away. */
  readonly past: readonly HospitalStarter[];
};

const byName = (a: HospitalStarter, b: HospitalStarter) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Sorts starters by how near their start date is to `today` (`YYYY-MM-DD`), nearest first in each group. */
export function groupHospitalStarters(starters: readonly HospitalStarter[], today: string): HospitalStarterGroups {
  const now = dayNumber(today);
  const upcoming: HospitalStarter[] = [];
  const recent: HospitalStarter[] = [];
  const undated: HospitalStarter[] = [];
  const past: HospitalStarter[] = [];
  for (const starter of starters) {
    if (!starter.startsOn) {
      undated.push(starter);
      continue;
    }
    const days = dayNumber(starter.startsOn) - now;
    if (days >= 0) upcoming.push(starter);
    else if (days >= -STARTER_PAST_AFTER_DAYS) recent.push(starter);
    else past.push(starter);
  }
  const soonest = (a: HospitalStarter, b: HospitalStarter) =>
    (a.startsOn as string).localeCompare(b.startsOn as string) || byName(a, b);
  const latest = (a: HospitalStarter, b: HospitalStarter) =>
    (b.startsOn as string).localeCompare(a.startsOn as string) || byName(a, b);
  return {
    upcoming: upcoming.sort(soonest),
    recent: recent.sort(latest),
    undated: undated.sort(byName),
    past: past.sort(latest),
  };
}

/** "Starts Mon 2 Nov", "Started Mon 5 Oct" or "No start date set". */
export function starterStartLine(starter: Pick<HospitalStarter, "startsOn">, today: string): string {
  if (!starter.startsOn) return "No start date set";
  const day = formatZonedDay(starter.startsOn, today);
  return starter.startsOn >= today ? `Starts ${day}` : `Started ${day}`;
}

/** "3 of 7 done", or "No shared items yet" when the doctor shares none. */
export function starterProgressLine(starter: Pick<HospitalStarter, "done" | "total">): string {
  return starter.total === 0 ? "No shared items yet" : `${starter.done} of ${starter.total} done`;
}

/** The row's short line: "Ward A psychiatry · Starts Mon 2 Nov". */
export function starterLine(starter: HospitalStarter, today: string): string {
  const teams = starter.teams.length ? starter.teams.join(", ") : "Team";
  return `${teams} · ${starterStartLine(starter, today)}`;
}

/** "2 doctors share their New job list", "1 doctor shares…" or "Nobody shares yet". */
export function startersSummaryLine(starters: readonly HospitalStarter[]): string {
  if (starters.length === 0) return "Nobody shares their New job list yet";
  return starters.length === 1
    ? "1 doctor shares their New job list"
    : `${starters.length} doctors share their New job list`;
}
