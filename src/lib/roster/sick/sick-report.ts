import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import { WEEKDAYS, addDaysToDate, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment, RosterAssignmentKind, RosterOpenShift } from "@/lib/roster/team/model";

/**
 * "I am sick for tomorrow" (feature #5), the pure part.
 *
 * The send itself is the existing `open.report` team action: it puts the
 * shift on the team's open-shift list as `reported` and urgent, and alerts the
 * team's roster managers (`src/lib/roster/alerts/dispatch.ts`). A manager then
 * releases it to the in-house pool (`open.release`). The reporter can take it
 * back with `open.cancel` until it is approved for someone else.
 *
 * Nothing here asks for, or keeps, a reason or any health detail. Only shifts
 * on a confirmed team roster can be reported; shifts on the doctor's own copy
 * of a roster are listed honestly as "PsychSift can't tell anyone about this".
 */

/** Below this, the page also asks the doctor to phone: the pool alone may not find cover in time. */
export const SICK_SHORT_NOTICE_MS = 4 * 3_600_000;

/** A shift starting today from this Perth time is "tonight". */
const TONIGHT_FROM = "17:00";

export type SickShift = {
  readonly assignmentId: string;
  readonly serviceId: string;
  readonly teamName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly shiftCode: string;
  readonly kind: RosterAssignmentKind;
  readonly siteName: string | null;
};

/** A shift on the doctor's own roster copy only: no team roster, so nobody can be told from here. */
export type SickPersonalShift = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly title: string;
  readonly workplace: string | null;
};

export type SickTeamRead = {
  readonly team: { readonly serviceId: string; readonly name: string };
  readonly assignments: readonly RosterAssignment[];
};

/** Today and tomorrow, as Perth dates. A shift starting on either can be reported here. */
export function sickWindow(now: Date): { readonly from: string; readonly to: string } {
  const today = perthDateOf(now);
  return { from: today, to: addDaysToDate(today, 1) };
}

const byStart = <T extends { startsAt: string }>(a: T, b: T) => Date.parse(a.startsAt) - Date.parse(b.startsAt);

/** My working shifts on a team roster that start between now and the end of tomorrow. */
export function sickCandidates(reads: readonly SickTeamRead[], actorId: string, now: Date): SickShift[] {
  const { from, to } = sickWindow(now);
  return reads
    .flatMap(({ team, assignments }) =>
      assignments
        .filter((row) => {
          const day = perthDateOf(row.startsAt);
          return (
            row.userId === actorId &&
            row.kind !== "leave" &&
            Date.parse(row.startsAt) > now.getTime() &&
            day >= from &&
            day <= to
          );
        })
        .map((row): SickShift => ({
          assignmentId: row.id,
          serviceId: team.serviceId,
          teamName: team.name,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          shiftCode: row.shiftCode,
          kind: row.kind,
          siteName: row.siteName,
        })),
    )
    .sort(byStart);
}

/**
 * Shifts on the doctor's own roster copy in the same window that are not also
 * on a team roster (same start and end), so a team shift is never listed twice.
 */
export function personalOnlyShifts(
  own: readonly SickPersonalShift[],
  team: readonly Pick<SickShift, "startsAt" | "endsAt">[],
  now: Date,
): SickPersonalShift[] {
  const { from, to } = sickWindow(now);
  const key = (row: { startsAt: string; endsAt: string }) => `${Date.parse(row.startsAt)}:${Date.parse(row.endsAt)}`;
  const onTeam = new Set(team.map(key));
  return own
    .filter((row) => {
      const day = perthDateOf(row.startsAt);
      return Date.parse(row.startsAt) > now.getTime() && day >= from && day <= to && !onTeam.has(key(row));
    })
    .sort(byStart);
}

/** `Today`, `Tonight` (today, starting 17:00 or later) or `Wed 7`. */
export function sickDayWord(startsAt: string, now: Date): string {
  const day = perthDateOf(startsAt);
  if (day === perthDateOf(now)) return perthTimeOf(startsAt) >= TONIGHT_FROM ? "Tonight" : "Today";
  return `${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]} ${Number(day.slice(8, 10))}`;
}

/** `Wed 7 · Day`. */
export function sickShiftTitle(shift: Pick<SickShift, "startsAt" | "kind">, now: Date): string {
  return `${sickDayWord(shift.startsAt, now)} · ${SHIFT_KIND_LABEL[shift.kind]}`;
}

/** `08:00 to 16:30`, or `21:30 to Wed 08:00` when it ends on a later day. */
export function sickTimes(shift: Pick<SickShift, "startsAt" | "endsAt">): string {
  const startDay = perthDateOf(shift.startsAt);
  const endDay = perthDateOf(shift.endsAt);
  const end = perthTimeOf(shift.endsAt);
  if (startDay === endDay) return `${perthTimeOf(shift.startsAt)} to ${end}`;
  return `${perthTimeOf(shift.startsAt)} to ${WEEKDAYS[new Date(`${endDay}T00:00:00Z`).getUTCDay()]} ${end}`;
}

/** `1 h 40`, `45 min`, `3 h`. Never negative. */
export function startsInWords(startsAt: string, now: Date): string {
  const minutes = Math.max(0, Math.round((Date.parse(startsAt) - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

/**
 * Short notice: the shift starts within the existing four hours, or later the
 * same Perth day (the spec's "same morning" case, such as 00:30 for an 08:00
 * start). The doctor is then asked to phone as well.
 */
export function isShortNotice(startsAt: string, now: Date): boolean {
  return Date.parse(startsAt) - now.getTime() < SICK_SHORT_NOTICE_MS || perthDateOf(startsAt) === perthDateOf(now);
}

/**
 * The shift ticked when the page opens: the next one that has not started,
 * judged in Perth time. So between midnight and the start of today's shift,
 * today's shift comes first (00:30 Wed picks Wed 08:00, not Thu 08:00). Once it
 * is evening, tonight's shift is offered unticked and tomorrow's is ticked, as
 * the spec asks, unless there is nothing tomorrow.
 */
export function sickDefaultPick<T extends Pick<SickShift, "startsAt">>(
  pickable: readonly T[],
  now: Date,
): T | undefined {
  const upcoming = pickable.filter((shift) => Date.parse(shift.startsAt) > now.getTime()).sort(byStart);
  const first = upcoming[0];
  if (!first) return undefined;
  const today = perthDateOf(now);
  if (perthTimeOf(now) >= TONIGHT_FROM && perthDateOf(first.startsAt) === today) {
    const tomorrow = addDaysToDate(today, 1);
    return upcoming.find((shift) => perthDateOf(shift.startsAt) === tomorrow) ?? first;
  }
  return first;
}

/** The page title, from the day of what is picked (or offered), never from the clock alone. */
export function sickPageTitle(shifts: readonly Pick<SickShift, "startsAt">[], now: Date): string {
  const today = perthDateOf(now);
  return shifts.length > 0 && shifts.every((shift) => perthDateOf(shift.startsAt) === today)
    ? "Sick today"
    : "Sick for tomorrow";
}

/** The main button's words, matching the day actually picked. */
export function sickButtonLabel(picked: readonly Pick<SickShift, "startsAt">[], now: Date): string {
  if (picked.length === 0) return "Pick a shift first";
  if (picked.length > 2) return `I'm sick for all ${picked.length}`;
  if (picked.length === 2) return "I'm sick for both";
  const word = sickDayWord(picked[0]!.startsAt, now);
  if (word === "Today") return "I'm sick for today's shift";
  if (word === "Tonight") return "I'm sick for tonight's shift";
  return "I'm sick for tomorrow";
}

/** Who is told: a single named manager, else the team's roster managers. Never a guessed name. */
export function managerWord(managers: readonly { readonly name: string | null }[] | undefined): string {
  const named = (managers ?? []).filter((manager) => manager.name && manager.name.trim());
  if ((managers ?? []).length === 1 && named.length === 1) return named[0]!.name!.trim();
  return "your roster managers";
}

// ------------------------------------------------------------------ after sending

export type SickPhase = "reported" | "open" | "claimed" | "covered" | "taken-back" | "expired";

/** The open shift my report created for this shift: mine, urgent, same start, end and code. */
export function reportFor(
  openShifts: readonly RosterOpenShift[],
  shift: Pick<SickShift, "startsAt" | "endsAt" | "shiftCode">,
): RosterOpenShift | null {
  const start = Date.parse(shift.startsAt);
  const end = Date.parse(shift.endsAt);
  const matches = openShifts.filter(
    (item) =>
      item.mine &&
      Date.parse(item.startsAt) === start &&
      Date.parse(item.endsAt) === end &&
      item.shiftCode === shift.shiftCode,
  );
  // A live one wins over an older cancelled one for the same shift.
  return matches.find((item) => LIVE.has(item.status)) ?? matches.find((item) => item.status === "approved") ?? null;
}

const LIVE = new Set<RosterOpenShift["status"]>(["reported", "open", "claimed"]);

export function isLiveReport(item: Pick<RosterOpenShift, "status">): boolean {
  return LIVE.has(item.status);
}

/** My urgent reports (open.report always sets urgent) that are still shown: live or covered. */
export function myReports(openShifts: readonly RosterOpenShift[]): RosterOpenShift[] {
  return openShifts.filter((item) => item.mine && item.urgent && (LIVE.has(item.status) || item.status === "approved"));
}

export function sickPhase(item: Pick<RosterOpenShift, "status">): SickPhase {
  switch (item.status) {
    case "reported":
      return "reported";
    case "open":
      return "open";
    case "claimed":
      return "claimed";
    case "approved":
      return "covered";
    case "cancelled":
      return "taken-back";
    default:
      return "expired";
  }
}

/** d done, c happening now, w needs attention, x not needed, todo still to come. */
export type SickStepState = "done" | "current" | "warning" | "skipped" | "todo";
export type SickStep = { readonly state: SickStepState; readonly title: string; readonly sub: string };

/**
 * What happens next, in the order the existing roster actions make it happen.
 * Wording only claims what the app does: managers see it in Manage team and get
 * an alert if they switched alerts on; the pool sees it once a manager releases
 * it; a locum is the manager's own process and PsychSift never contacts one.
 */
export function sickTimeline(phase: SickPhase | "plan" | "holding", who: string): SickStep[] {
  const Who = who.charAt(0).toUpperCase() + who.slice(1);
  const told = (state: SickStepState, sub: string, title?: string): SickStep => ({
    state,
    title: title ?? (who === "your roster managers" ? "Your roster managers are told" : `${Who} is told`),
    sub,
  });
  const pool = (state: SickStepState, title: string, sub: string): SickStep => ({ state, title, sub });
  const locum = (state: SickStepState, title: string, sub: string): SickStep => ({ state, title, sub });
  switch (phase) {
    case "plan":
      return [
        told("todo", "In Manage team straight away"),
        pool("todo", "Posted on Open shifts", "Your team's in-house pool first"),
        locum("todo", "A locum only if nobody takes it", "Your roster manager's usual process"),
      ];
    case "holding":
      return [
        told("current", "Sending when the 10 seconds are up"),
        pool("todo", "Posted on Open shifts", "Your team's in-house pool first"),
        locum("todo", "A locum only if nobody takes it", "Your roster manager's usual process"),
      ];
    case "reported":
      return [
        told("done", "It is in their Manage team list"),
        pool("current", "Waiting to go on Open shifts", "Your roster manager posts it to the pool"),
        locum("todo", "A locum only if nobody takes it", "Your roster manager's usual process"),
      ];
    case "open":
      return [
        told("done", "It is in their Manage team list"),
        pool("current", "On Open shifts", "Marked urgent · no taker yet"),
        locum("todo", "A locum only if nobody takes it", "Your roster manager's usual process"),
      ];
    case "claimed":
      return [
        told("done", "It is in their Manage team list"),
        pool("current", "Someone asked to take it", "Your roster manager is deciding"),
        locum("todo", "A locum only if nobody takes it", "Your roster manager's usual process"),
      ];
    case "covered":
      return [
        told("done", "It is in their Manage team list"),
        pool("done", "Taken from Open shifts", "Approved for a colleague"),
        locum("skipped", "Locum not needed", "Filled in house"),
      ];
    case "taken-back":
      return [
        told("skipped", "Your shift is yours again", "Report taken back"),
        pool("skipped", "Not on Open shifts", "Removed from the pool"),
        locum("skipped", "No locum", "Nothing to cover"),
      ];
    case "expired":
      return [
        told("done", "It was in their Manage team list"),
        pool("warning", "Not taken on Open shifts", "The shift started without a taker"),
        locum("todo", "Check with your roster manager", "Cover is their usual process"),
      ];
  }
}

/** Short status words for a report, for a tag. */
export const SICK_PHASE_TAG: Record<SickPhase, string> = {
  reported: "Told",
  open: "On Open shifts",
  claimed: "Someone asked",
  covered: "Covered",
  "taken-back": "Taken back",
  expired: "Not covered",
};

export type SickMessageShift = Pick<SickShift, "startsAt" | "endsAt" | "kind"> & {
  /** True only when this shift's report went through and is still live. */
  readonly reported: boolean;
};

function shiftWords(shifts: readonly Pick<SickShift, "startsAt" | "endsAt" | "kind">[], now: Date): string {
  const parts = shifts.map((shift) => {
    const word = sickDayWord(shift.startsAt, now);
    const when = word === "Today" || word === "Tonight" ? word.toLowerCase() : `on ${word}`;
    return `${SHIFT_KIND_LABEL[shift.kind].toLowerCase()} shift ${when} (${sickTimes(shift)})`;
  });
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * A short message to send your manager by text if you also phone or message
 * them. It names only the shifts given (the ones the doctor picked or already
 * reported), never a reason or any health detail. It says "I've reported it"
 * only for a shift whose report actually went through: before sending, offline
 * or for a shift that can't be reported, it asks for cover instead.
 */
export function sickMessage(shifts: readonly SickMessageShift[], now: Date): string {
  if (shifts.length === 0) return "";
  const sorted = [...shifts].sort(byStart);
  const reported = sorted.filter((shift) => shift.reported);
  const notYet = sorted.filter((shift) => !shift.reported);
  const opening = `Hi, I'm unwell and can't work my ${shiftWords(sorted, now)}.`;
  const it = (list: readonly unknown[]) => (list.length === 1 ? "it" : "them");
  if (!reported.length)
    return `${opening} ${notYet.length === 1 ? "It isn't" : "They aren't"} reported in PsychSift Roster yet. Could you arrange cover?`;
  if (!notYet.length)
    return `${opening} I've reported ${it(reported)} in PsychSift Roster so ${reported.length === 1 ? "it" : "they"} can go on Open shifts.`;
  return `${opening} I've reported the ${shiftWords(reported, now)} in PsychSift Roster so ${reported.length === 1 ? "it" : "they"} can go on Open shifts. The ${shiftWords(notYet, now)} ${notYet.length === 1 ? "isn't" : "aren't"} reported there. Could you arrange cover for ${it(notYet)}?`;
}

// ------------------------------------------------------------------ errors

/** Plain words for a refused send. Never a raw code. */
export function sickErrorWords(code: string, message: string): string {
  switch (code) {
    case "roster_request_exists":
      return "This shift already has a swap or offer waiting. Withdraw it on Swaps first, or phone your roster manager.";
    case "roster_not_found":
      return "This shift has changed or already ended. Refresh to check your roster.";
    case "roster_auth_required":
      return "Sign in again to send this.";
    case "roster_role_denied":
      return "This can't be changed now. Phone your roster manager.";
    case "sample_read_only":
    case "demo_mode_unavailable":
      return "This is an example team, so nothing can be sent. Phone your roster manager.";
    case "roster_unavailable":
      return "No connection to the roster. Nothing was sent. Phone your roster manager, or try again.";
    default:
      return message || "It couldn't be sent. Phone your roster manager, or try again.";
  }
}

// ------------------------------------------------------------------ hand-offs for other areas

export type RosterNeedsYouItem = {
  /** `roster:sick:<open shift id>`, stable while the report waits, so a snooze holds. */
  readonly id: string;
  readonly title: string;
  readonly dueOn: string;
  readonly area: "roster";
  readonly href: string;
  readonly kind: "action" | "update";
};

/**
 * Needs you: a sick report still waiting for cover. A report already covered,
 * taken back or past is not shown. Only the shift words, never a reason.
 */
export function sickNeedsYouItems(openShifts: readonly RosterOpenShift[], now: Date): RosterNeedsYouItem[] {
  return myReports(openShifts)
    .filter((item) => isLiveReport(item) && Date.parse(item.endsAt) > now.getTime())
    .sort(byStart)
    .map((item) => ({
      id: `roster:sick:${item.id}`,
      title: `${sickShiftTitle(item, now)} not covered yet`,
      dueOn: perthDateOf(item.startsAt),
      area: "roster" as const,
      href: "/roster/sick",
      kind: "update" as const,
    }));
}

export type RosterSearchRecord = {
  readonly title: string;
  readonly area: "roster";
  readonly keywords: readonly string[];
  readonly href: string;
};

/** Work search entries for the two pages. Static words only, no roster data. */
export const ROSTER_FEATURE_SEARCH_RECORDS: readonly RosterSearchRecord[] = [
  {
    title: "Sick for tomorrow",
    area: "roster",
    keywords: ["sick", "unwell", "ill", "call in sick", "can't work", "cant make it", "off sick", "sick leave"],
    href: "/roster/sick",
  },
  {
    title: "Team staffing",
    area: "roster",
    keywords: ["staffing", "who is on", "leave", "annual leave", "short staffed", "plan leave", "minimum staffing"],
    href: "/roster/staffing",
  },
];
