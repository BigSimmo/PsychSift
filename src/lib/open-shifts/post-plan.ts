import { addDaysToDate, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { ROSTER_OPEN_SHIFT_KINDS, type RosterManageOpenShift } from "@/lib/roster/team/model";

/**
 * The poster's two shortcuts on "Post a shift", worked out without React:
 *
 * - Several dates at once. Roster's `open.post` takes one shift, so a plan of
 *   dates becomes one post per date, sent one after another by the page.
 * - "Post again". A posted shift's times, kind, code, level, site and urgent
 *   flag ride to the Post page in its address. Everything read back from the
 *   address is checked here, and anything that doesn't fit is dropped rather
 *   than guessed. The date is never carried: the manager chooses it.
 *
 * Nothing is saved; the server rechecks every post.
 */

/** Dates in one go, the first date included. */
export const MAX_POST_DATES = 14;

export type PostKind = (typeof ROSTER_OPEN_SHIFT_KINDS)[number];
export const POST_LEVELS = ["intern", "resident", "registrar", "fellow", "consultant"] as const;
export type PostLevel = (typeof POST_LEVELS)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The first date followed by the extra dates, in the order the manager added them. */
export function planDates(first: string, extras: readonly string[]): string[] {
  return [first, ...extras];
}

/** Why this set of dates can't be posted, or null when it can. */
export function datesProblem(dates: readonly string[], today: string): string | null {
  if (dates.length > MAX_POST_DATES) return `Choose up to ${MAX_POST_DATES} dates.`;
  if (dates.some((date) => !ISO_DATE.test(date))) return "Choose a date for each line.";
  if (dates.some((date) => date < today)) return "One of the dates has passed.";
  if (new Set(dates).size !== dates.length) return "The same date is chosen twice.";
  return null;
}

/** The date "Add another date" starts on: the day after the latest chosen date, else tomorrow. */
export function nextExtraDate(dates: readonly string[], today: string): string {
  const chosen = dates.filter((date) => ISO_DATE.test(date));
  const latest = chosen.length ? chosen.reduce((a, b) => (a > b ? a : b)) : today;
  return addDaysToDate(latest, 1);
}

export type PostAttempt =
  | { readonly date: string; readonly ok: true; readonly openShiftId: string | null }
  | { readonly date: string; readonly ok: false; readonly message: string };

/** Split a run of posts into the dates that went live and the ones that didn't. */
export function splitAttempts(attempts: readonly PostAttempt[]): {
  posted: string[];
  failed: { date: string; message: string }[];
} {
  const posted: string[] = [];
  const failed: { date: string; message: string }[] = [];
  for (const attempt of attempts) {
    if (attempt.ok) posted.push(attempt.date);
    else failed.push({ date: attempt.date, message: attempt.message });
  }
  return { posted, failed };
}

// ------------------------------------------------------------------ post again

export type PostAgainPrefill = {
  readonly serviceId?: string;
  readonly kind?: PostKind;
  readonly code?: string;
  readonly start?: string;
  readonly end?: string;
  /** "" is "Any level". */
  readonly level?: PostLevel | "";
  readonly siteId?: string;
  readonly urgent?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
// A roster code: letters, numbers and a little punctuation, as Roster shows them.
const CODE = /^[\p{L}\p{N} ._/+-]{1,12}$/u;

/** The Post page's address for "Post again": everything but the date. */
export function postAgainHref(
  base: string,
  shift: Pick<RosterManageOpenShift, "startsAt" | "endsAt" | "kind" | "shiftCode" | "minGrade" | "siteId" | "urgent">,
  serviceId: string,
): string {
  const params = new URLSearchParams({
    team: serviceId,
    kind: shift.kind,
    code: shift.shiftCode,
    start: perthTimeOf(shift.startsAt),
    end: perthTimeOf(shift.endsAt),
    // `other` can't be posted as a minimum level, so it goes as "Any level".
    level: shift.minGrade && (POST_LEVELS as readonly string[]).includes(shift.minGrade) ? shift.minGrade : "any",
  });
  if (shift.siteId) params.set("site", shift.siteId);
  if (shift.urgent) params.set("urgent", "1");
  return `${base}?${params.toString()}`;
}

/** Read "Post again" details back from an address's query string, keeping only what is valid. */
export function parsePostAgain(search: string): PostAgainPrefill {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return {};
  }
  const out: {
    serviceId?: string;
    kind?: PostKind;
    code?: string;
    start?: string;
    end?: string;
    level?: PostLevel | "";
    siteId?: string;
    urgent?: boolean;
  } = {};
  const team = params.get("team");
  if (team && UUID.test(team)) out.serviceId = team.toLowerCase();
  const kind = params.get("kind");
  if (kind && (ROSTER_OPEN_SHIFT_KINDS as readonly string[]).includes(kind)) out.kind = kind as PostKind;
  const code = params.get("code")?.trim();
  if (code && CODE.test(code)) out.code = code;
  const start = params.get("start");
  const end = params.get("end");
  // Times travel as a pair: one without the other would give a shift nobody chose.
  if (start && end && CLOCK.test(start) && CLOCK.test(end)) {
    out.start = start;
    out.end = end;
  }
  const level = params.get("level");
  if (level === "any") out.level = "";
  else if (level && (POST_LEVELS as readonly string[]).includes(level)) out.level = level as PostLevel;
  const site = params.get("site");
  if (site && UUID.test(site)) out.siteId = site.toLowerCase();
  if (params.has("urgent")) out.urgent = params.get("urgent") === "1";
  return out;
}
