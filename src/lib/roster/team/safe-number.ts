import { ROSTER_OPEN_SHIFT_KINDS, type RosterMaker, type RosterStaffingNeedInput } from "@/lib/roster/team/model";

/**
 * The team's safe number, the pure part of the manager's editor in Manage,
 * Team settings. It is the team's own number of people needed on each shift,
 * set by its roster manager. It is never an official staffing figure.
 *
 * The editor owns one slice of `roster_staffing_needs`: whole-team weekday
 * needs (no date, no grade, no site) for Day, Evening and Night, one number
 * for each weekday. Every other need (a dated one, a grade or a site need, an
 * on-call need) is kept exactly as it is, because `needs.set` deletes the
 * team's whole list and inserts the one it is given.
 *
 * A zero is "no number set" for that shift and is not written, so a team with
 * every number at zero reads "not set" on the Cover tab and the staffing check.
 */

export const SAFE_NUMBER_KINDS = ["day", "evening", "night"] as const;
export type SafeNumberKind = (typeof SAFE_NUMBER_KINDS)[number];

/** The largest number the editor offers for one shift. The database allows up to 200. */
export const SAFE_NUMBER_MAX = 99;

/** Monday (1) to Friday (5), then Saturday (6) and Sunday (7): the database's weekday numbers. */
export const SAFE_NUMBER_GROUPS = [
  { id: "weekdays", label: "Monday to Friday", weekdays: [1, 2, 3, 4, 5] },
  { id: "weekend", label: "Saturday and Sunday", weekdays: [6, 7] },
] as const;
export type SafeNumberGroupId = (typeof SAFE_NUMBER_GROUPS)[number]["id"];

export const SAFE_NUMBER_WEEKDAYS: readonly { weekday: number; label: string }[] = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 7, label: "Sunday" },
];

/** For each kind, the number for each weekday: index 0 is Monday, 6 is Sunday. */
export type SafeNumberGrid = Readonly<Record<SafeNumberKind, readonly number[]>>;

/** A need as the `maker` read returns it (its id is not needed here), or as `needs.set` sends it. */
type Need = Omit<RosterMaker["needs"][number], "id">;

const isSafeNumberKind = (kind: string): kind is SafeNumberKind =>
  (SAFE_NUMBER_KINDS as readonly string[]).includes(kind);

/** A need the editor owns: a whole-team weekday need for Day, Evening or Night. */
export function isEditorNeed(need: Need): boolean {
  return (
    need.date === null &&
    need.weekday !== null &&
    need.weekday >= 1 &&
    need.weekday <= 7 &&
    need.grade === null &&
    need.siteId === null &&
    isSafeNumberKind(need.kind)
  );
}

export function clampSafeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(SAFE_NUMBER_MAX, Math.max(0, Math.round(value)));
}

export function emptySafeNumberGrid(): SafeNumberGrid {
  return { day: [0, 0, 0, 0, 0, 0, 0], evening: [0, 0, 0, 0, 0, 0, 0], night: [0, 0, 0, 0, 0, 0, 0] };
}

/**
 * The editor's numbers from the team's needs. Two owned needs for the same
 * weekday and kind add up, as the Cover tab adds them.
 */
export function safeNumberGrid(needs: readonly Need[]): SafeNumberGrid {
  const grid = { day: [0, 0, 0, 0, 0, 0, 0], evening: [0, 0, 0, 0, 0, 0, 0], night: [0, 0, 0, 0, 0, 0, 0] };
  for (const need of needs) {
    if (!isEditorNeed(need)) continue;
    const kind = need.kind as SafeNumberKind;
    grid[kind][need.weekday! - 1] += need.needed;
  }
  return grid;
}

/** Each kind has one number for Monday to Friday and one for the weekend, so the short view loses nothing. */
export function safeNumberIsGrouped(grid: SafeNumberGrid): boolean {
  return SAFE_NUMBER_KINDS.every((kind) =>
    SAFE_NUMBER_GROUPS.every(({ weekdays }) =>
      weekdays.every((day) => grid[kind][day - 1] === grid[kind][weekdays[0] - 1]),
    ),
  );
}

export function sameSafeNumbers(a: SafeNumberGrid, b: SafeNumberGrid): boolean {
  return SAFE_NUMBER_KINDS.every((kind) => a[kind].every((value, index) => value === b[kind][index]));
}

/** One number changed: a single weekday, or every weekday in a group. */
export function setSafeNumber(
  grid: SafeNumberGrid,
  kind: SafeNumberKind,
  weekdays: readonly number[],
  value: number,
): SafeNumberGrid {
  const next = clampSafeNumber(value);
  return { ...grid, [kind]: grid[kind].map((current, index) => (weekdays.includes(index + 1) ? next : current)) };
}

/** A need as `needs.set` takes it: no id. Null when the table would refuse it, so it can never be sent. */
function toInput(need: Need): RosterStaffingNeedInput | null {
  if (!(ROSTER_OPEN_SHIFT_KINDS as readonly string[]).includes(need.kind)) return null;
  if (need.grade === "other") return null;
  return {
    weekday: need.weekday,
    date: need.date,
    kind: need.kind as RosterStaffingNeedInput["kind"],
    grade: need.grade,
    siteId: need.siteId,
    needed: need.needed,
  };
}

/**
 * The whole list `needs.set` is sent: every need the editor does not own,
 * unchanged, then the editor's numbers (zeros left out).
 */
export function safeNumberNeeds(grid: SafeNumberGrid, current: readonly Need[]): RosterStaffingNeedInput[] {
  const kept = current
    .filter((need) => !isEditorNeed(need))
    .map(toInput)
    .filter((need): need is RosterStaffingNeedInput => need !== null);
  // A team can contain duplicate owned rows (for example after an import). Keep
  // their aggregate, but split it into database-sized rows rather than making
  // one row whose `needed` value is above the table's limit.
  const owned = SAFE_NUMBER_KINDS.flatMap((kind) =>
    grid[kind].flatMap((needed, index): RosterStaffingNeedInput[] => {
      const rows: RosterStaffingNeedInput[] = [];
      let remaining = Math.max(0, Math.round(needed));
      while (remaining > 0) {
        const part = Math.min(200, remaining);
        rows.push({ weekday: index + 1, date: null, kind, grade: null, siteId: null, needed: part });
        remaining -= part;
      }
      return rows;
    }),
  );
  return [...kept, ...owned];
}

/** How many needs the editor leaves alone (dated, grade, site or on-call needs), for the note under the editor. */
export function otherNeedCount(current: readonly Need[]): number {
  return current.filter((need) => !isEditorNeed(need) && toInput(need) !== null).length;
}
