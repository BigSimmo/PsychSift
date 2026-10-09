import type {
  RosterAction,
  RosterAssignment,
  RosterCommandResult,
  RosterGrade,
  RosterReadResult,
  RosterReadWhat,
  RosterTeam,
} from "@/lib/roster/team/model";
import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import type { OnCallShift } from "@/lib/roster/shifts/model";
import { addDaysToDate, perthDateOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/**
 * The pure data half of the invented team (no server imports), so the browser's
 * signed-out sample can reuse it. `demo-team.ts` re-exports it for the API and
 * turns an unsupported read into the API's own "check the request" error.
 *
 * One invented team for synthetic demo mode, so offline browser checks have
 * something to draw. Every name, place and id is made up. The reader is
 * "Dr Alex Example", a registrar and the team's roster manager. Dates are
 * worked out from `now`, so the demo always has a current and a next fortnight.
 *
 * THE ONE EXAMPLE ROSTER. Dr Alex Example's own shifts (`exampleOwnShift`) are
 * the example roster every work area shows: Roster (team and personal), My Day,
 * Open shifts' roster check, work search and the local demo build's
 * `/api/roster/shifts` all read them through `demoMyShifts`, so they agree about
 * the same day. On Call's example ("on call tonight, 17:00 to 08:00") matches it.
 */

/** A read the sample team has no answer for; the API maps it to its invalid-request error. */
export class DemoReadUnsupportedError extends Error {
  constructor() {
    super("The sample team has no answer for that read.");
    this.name = "DemoReadUnsupportedError";
  }
}

export const DEMO_SERVICE_ID = "d0000000-0000-4000-8000-000000000001";
const DEMO_SITE_ID = "d0000000-0000-4000-8000-000000000002";
const DEMO_PUBLICATION_ID = "d0000000-0000-4000-8000-000000000003";
const DEMO_SWAP_ID = "d0000000-0000-4000-8000-000000000004";
const DEMO_OPEN_SHIFT_ID = "d0000000-0000-4000-8000-000000000005";
const DEMO_MANAGE_SWAP_ID = "d0000000-0000-4000-8000-000000000007";
export const DEMO_ME_ID = "d0000000-0000-4000-8000-0000000000a1";

const PEOPLE: readonly { userId: string; name: string; grade: RosterGrade; manager?: boolean }[] = [
  { userId: DEMO_ME_ID, name: "Dr Alex Example", grade: "registrar", manager: true },
  { userId: "d0000000-0000-4000-8000-0000000000a2", name: "Dr Sam Example", grade: "registrar" },
  { userId: "d0000000-0000-4000-8000-0000000000a3", name: "Dr Mei Example", grade: "resident" },
  { userId: "d0000000-0000-4000-8000-0000000000a4", name: "Dr Noor Example", grade: "resident" },
  { userId: "d0000000-0000-4000-8000-0000000000a5", name: "Dr Kai Example", grade: "intern" },
  { userId: "d0000000-0000-4000-8000-0000000000a6", name: "Dr Jordan Example", grade: "consultant" },
  { userId: "d0000000-0000-4000-8000-0000000000a7", name: "Dr Lee Example", grade: "intern" },
];

const PATTERN = [
  { code: "D", kind: "day", start: "08:00", end: "16:30", overnight: false },
  { code: "E", kind: "evening", start: "14:00", end: "22:30", overnight: false },
  { code: "N", kind: "night", start: "21:30", end: "08:00", overnight: true },
] as const;

type PatternShift = {
  readonly code: string;
  readonly kind: RosterAssignment["kind"];
  readonly start: string;
  readonly end: string;
  readonly overnight: boolean;
};

const OWN_ON_CALL: PatternShift = { code: "C", kind: "on_call", start: "17:00", end: "08:00", overnight: true };
/** Days in the example doctor's own cycle, counted from today. */
const OWN_CYCLE_DAYS = 8;

/** The sample reader's leave: one working week, five weeks after this Monday. */
function leaveStart(now: Date): string {
  return addDaysToDate(periodStart(now), 35);
}

/**
 * Dr Alex Example's own shift on `date`, or null on a day off. An eight-day
 * cycle counted from today: on call from 17:00 to 08:00 (tonight is the first),
 * a day off, day shifts on the weekdays between, a day off, a night shift, and a
 * day off before the next on call. Nothing is rostered during their leave.
 */
function exampleOwnShift(date: string, now: Date): PatternShift | null {
  const leave = leaveStart(now);
  if (date >= leave && date <= addDaysToDate(leave, 4)) return null;
  const offset = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${perthDateOf(now)}T00:00:00Z`)) / 86_400_000,
  );
  const step = ((offset % OWN_CYCLE_DAYS) + OWN_CYCLE_DAYS) % OWN_CYCLE_DAYS;
  if (step === 0) return OWN_ON_CALL;
  if (step === 6) return PATTERN[2];
  if (step === 1 || step === 5 || step === 7) return null;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6 ? null : PATTERN[0];
}

function periodStart(now: Date): string {
  const today = perthDateOf(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  // The fortnight starts on the Monday of this week.
  return addDaysToDate(today, -((weekday + 6) % 7));
}

function hexId(n: number): string {
  return `d0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** Days before and after the current Monday that the sample roster covers. */
const DEMO_DAYS_BEFORE = 21;
const DEMO_DAYS_AFTER = 42;

function demoAssignments(now: Date): RosterAssignment[] {
  const start = periodStart(now);
  const rows: RosterAssignment[] = [];
  for (let day = -DEMO_DAYS_BEFORE; day < DEMO_DAYS_AFTER; day += 1) {
    const date = addDaysToDate(start, day);
    PEOPLE.forEach((person, index) => {
      // The reader keeps the one example roster; everyone else works five days
      // in seven, rotating through day, evening and night.
      let shift: PatternShift | null;
      if (person.userId === DEMO_ME_ID) shift = exampleOwnShift(date, now);
      else if ((((day + index) % 7) + 7) % 7 >= 5) shift = null;
      else shift = PATTERN[(((Math.floor(day / 7) + index) % PATTERN.length) + PATTERN.length) % PATTERN.length];
      if (!shift) return;
      rows.push({
        id: hexId(0x1000 + (day + DEMO_DAYS_BEFORE) * 16 + index),
        userId: person.userId,
        name: person.name,
        grade: person.grade,
        siteId: DEMO_SITE_ID,
        siteName: "Example Hospital",
        startsAt: perthWallToIso(date, shift.start)!,
        endsAt: perthWallToIso(shift.overnight ? addDaysToDate(date, 1) : date, shift.end)!,
        shiftCode: shift.code,
        kind: shift.kind,
      });
    });
  }
  return rows;
}

const overlaps = (a: RosterAssignment, b: RosterAssignment) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(a.endsAt) > Date.parse(b.startsAt);

/** Free for `shift` once `handedOver` is gone: none of `userId`'s other shifts overlaps it. */
function freeFor(rows: readonly RosterAssignment[], userId: string, shift: RosterAssignment, handedOver: string) {
  return !rows.some((row) => row.userId === userId && row.id !== handedOver && overlaps(row, shift));
}

/** The reader's and Dr Sam's shifts for the sample swap, same kind first, that neither would clash taking. */
function acceptableSwap(future: readonly RosterAssignment[], rows: readonly RosterAssignment[]) {
  const sam = PEOPLE[1].userId;
  const mineAll = future.filter((a) => a.userId === DEMO_ME_ID);
  const samsAll = future.filter((a) => a.userId === sam);
  const fits = (mine: RosterAssignment, theirs: RosterAssignment) =>
    freeFor(rows, DEMO_ME_ID, theirs, mine.id) && freeFor(rows, sam, mine, theirs.id);
  for (const sameKind of [true, false]) {
    for (const mine of mineAll) {
      const theirs = samsAll.find((a) => (!sameKind || a.kind === mine.kind) && fits(mine, a));
      if (theirs) return { mine, theirs };
    }
  }
  return { mine: mineAll[0], theirs: samsAll[0] ?? null };
}

export function demoRosterTeams(): RosterTeam[] {
  return [
    {
      serviceId: DEMO_SERVICE_ID,
      name: "Example Health Service · General Medicine",
      enabled: true,
      role: "manager",
      grade: "registrar",
    },
  ];
}

export function demoRosterRead<W extends RosterReadWhat>(
  what: W,
  range: { from?: string; to?: string },
  now = new Date(),
): RosterReadResult<W> {
  const start = periodStart(now);
  const assignments = demoAssignments(now);
  const future = assignments.filter((a) => Date.parse(a.startsAt) > now.getTime() + 8 * 86_400_000);
  // The swap waiting on the reader is one that can really be accepted: neither
  // doctor is already working when they would take the other's shift.
  const { mine, theirs } = acceptableSwap(future, assignments);
  const publishedAt = perthWallToIso(addDaysToDate(start, -5), "16:10")!;
  const swap = {
    id: DEMO_SWAP_ID,
    status: "requested" as const,
    autoApproved: false,
    needsManagerBecause: null,
    cancelReason: null,
    requesterId: PEOPLE[1].userId,
    counterpartyId: DEMO_ME_ID,
    give: theirs,
    take: mine,
    expiresAt: mine.startsAt,
    createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
    decidedAt: null,
  };
  // A swap between two residents that waits on the manager because it is within 7 days.
  const soon = assignments.filter(
    (a) => Date.parse(a.startsAt) > now.getTime() && Date.parse(a.startsAt) < now.getTime() + 7 * 86_400_000,
  );
  const residentGives = soon.find((a) => a.userId === PEOPLE[2].userId);
  const residentTakes = soon.find((a) => a.userId === PEOPLE[3].userId && a.kind !== residentGives?.kind);
  const managedSwap = {
    id: DEMO_MANAGE_SWAP_ID,
    status: "accepted" as const,
    autoApproved: false,
    needsManagerBecause: "within_7_days" as const,
    requesterId: PEOPLE[2].userId,
    counterpartyId: PEOPLE[3].userId,
    give: residentGives ?? null,
    take: residentTakes ?? null,
    decidedAt: null,
    requesterName: PEOPLE[2].name,
    counterpartyName: PEOPLE[3].name,
  };
  // Weekday targets for day, evening and night: Monday (1) to Friday (5).
  const needs = ([1, 2, 3, 4, 5] as const).flatMap((weekday, index) =>
    PATTERN.map((shift, kindIndex) => ({
      id: hexId(0x2000 + index * 3 + kindIndex),
      weekday,
      date: null,
      kind: shift.kind,
      grade: null,
      siteId: null,
      needed: shift.kind === "day" ? 2 : 1,
    })),
  );
  const openDay = addDaysToDate(start, 12);
  const openShift = {
    id: DEMO_OPEN_SHIFT_ID,
    status: "open" as const,
    urgent: false,
    startsAt: perthWallToIso(openDay, "14:00")!,
    endsAt: perthWallToIso(openDay, "22:30")!,
    shiftCode: "E",
    kind: "evening" as const,
    minGrade: "resident" as const,
    siteId: DEMO_SITE_ID,
  };
  const answers: Record<RosterReadWhat, () => unknown> = {
    overview: () => ({
      service: { id: DEMO_SERVICE_ID, name: "General Medicine" },
      me: { role: "manager", grade: "registrar", rotationEndsOn: addDaysToDate(start, 69) },
      latestPublication: {
        id: DEMO_PUBLICATION_ID,
        version: 1,
        publishedAt,
        periodStart: start,
        periodEnd: addDaysToDate(start, 27),
      },
      seenLatest: true,
      settings: {
        swapApproval: "auto_same_grade",
        rules: { minBreakHours: 10 },
        rulesSource: null,
        payFortnightAnchor: start,
      },
      sites: [{ id: DEMO_SITE_ID, name: "Example Hospital" }],
    }),
    assignments: () => ({
      assignments: assignments.filter((a) => {
        const date = perthDateOf(a.startsAt);
        return (!range.from || date >= range.from) && (!range.to || date <= range.to);
      }),
    }),
    requests: () => ({ swaps: [swap], openShifts: [{ ...openShift, mine: false, claimedByMe: false }] }),
    unavailability: () => ({ unavailability: [] }),
    leave_overlap: () => ({ alreadyOff: 0 }),
    manage: () => ({
      swaps: [managedSwap],
      openShifts: [{ ...openShift, postedBy: PEOPLE[3].userId, claimedBy: null, claimedAt: null }],
      seen: {
        publicationId: DEMO_PUBLICATION_ID,
        version: 1,
        seen: 5,
        members: PEOPLE.length,
        notSeen: [PEOPLE[4].userId, PEOPLE[6].userId],
      },
    }),
    people: () => ({
      people: PEOPLE.map((person) => ({
        userId: person.userId,
        displayName: person.name,
        joinedAt: publishedAt,
        serviceRole: "member",
        role: person.manager ? "manager" : "member",
        grade: person.grade,
        rosterName: null,
        rotationEndsOn: null,
      })),
    }),
    members: () => ({
      members: PEOPLE.map((person) => ({ userId: person.userId, name: person.name, grade: person.grade })),
    }),
    publications: () => ({
      publications: [
        {
          id: DEMO_PUBLICATION_ID,
          version: 1,
          kind: "full",
          periodStart: start,
          periodEnd: addDaysToDate(start, 27),
          sourceName: "example-roster.xlsx",
          publishedAt,
        },
      ],
    }),
    maker: () => ({
      codes: PATTERN.map((shift) => ({
        code: shift.code,
        kind: shift.kind,
        starts: shift.start,
        ends: shift.end,
        label: null,
      })),
      needs,
      drafts: [],
    }),
    changes: () => {
      throw new DemoReadUnsupportedError();
    },
    team_leave: () => {
      throw new DemoReadUnsupportedError();
    },
    my_changes: () => {
      throw new DemoReadUnsupportedError();
    },
  };
  return answers[what]() as RosterReadResult<W>;
}

/**
 * The sample reader's own shifts (Dr Alex Example's), as a personal roster: the
 * one example roster (see the top of this file). Same shifts as the sample team
 * shows.
 */
export function demoMyShifts(now = new Date()): OnCallShift[] {
  return demoAssignments(now)
    .filter((row) => row.userId === DEMO_ME_ID)
    .map((row) => ({
      id: `sample-${row.id}`,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      title: row.kind === "on_call" ? "On call" : `${SHIFT_KIND_LABEL[row.kind as ShiftKind] ?? row.shiftCode} shift`,
      location: row.siteName,
      sourceUid: null,
      kind: row.kind as ShiftKind,
      source: "import" as const,
      seriesId: null,
      workplace: row.siteName,
    }));
}

/** The sample reader's own leave: one week of approved annual leave next month. */
export function demoRosterLeave(now = new Date()) {
  const start = leaveStart(now);
  return [
    {
      id: "d0000000-0000-4000-8000-000000000006",
      kind: "annual" as const,
      startsOn: start,
      endsOn: addDaysToDate(start, 4),
      status: "approved" as const,
      serviceId: DEMO_SERVICE_ID,
    },
  ];
}

/** The sample team's publish preview for a period: its current shifts, people and codes. */
export function demoPublishPreview(from: string, to: string, now = new Date()) {
  return {
    freshnessToken: "sample",
    assignments: demoRosterRead("assignments", { from, to }, now).assignments,
    changes: { swaps: [], openShifts: [] },
    people: demoRosterRead("people", {}, now).people,
    codes: demoRosterRead("maker", {}, now).codes,
  };
}

/** An example publish receipt. Nothing is published and nobody is told. */
export function demoPublishReceipt() {
  return {
    publicationId: crypto.randomUUID(),
    version: 2,
    swapsCancelled: [],
    changedUserIds: [],
    openShiftIds: [],
    overridesRecorded: [],
  };
}

/**
 * The sample team's answer to a team action while the real-staff release is
 * held: the receipt a real team would give, so the screen carries on (a swap
 * shows as sent, a give-away as posted). Nothing is saved, and the next read
 * shows the sample team unchanged.
 */
export function demoRosterCommand(action: RosterAction): RosterCommandResult {
  const id = crypto.randomUUID();
  switch (action.action) {
    case "swap.create":
      return { ok: true, swapId: id, status: "requested", autoApproved: false };
    case "swap.accept":
      return { ok: true, swapId: action.swapId, status: "approved", autoApproved: true };
    case "swap.approve":
      return { ok: true, swapId: action.swapId, status: "approved" };
    case "swap.decline":
      return { ok: true, swapId: action.swapId, status: "declined" };
    case "swap.cancel":
    case "swap.undo":
      return { ok: true, swapId: action.swapId, status: "cancelled" };
    case "open.post":
      return { ok: true, openShiftId: id, status: "open" };
    case "open.claim":
      return { ok: true, openShiftId: action.openShiftId, status: "claimed" };
    case "open.approve":
      return { ok: true, openShiftId: action.openShiftId, status: "filled" };
    case "open.decline":
    case "open.release":
      return { ok: true, openShiftId: action.openShiftId, status: "open" };
    case "open.cancel":
      return { ok: true, openShiftId: action.openShiftId, status: "cancelled" };
    default:
      return { ok: true };
  }
}
