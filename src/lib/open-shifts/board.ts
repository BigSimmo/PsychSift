import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterManageOpenShift } from "@/lib/roster/team/model";

/**
 * The manager's week board: posted shifts by site (rows) and day (columns),
 * Monday to Sunday of the week that holds `anyDay`. Cancelled shifts are left
 * off; an open shift starting within 48 hours shows as "unfilled".
 */

type Row = Pick<RosterManageOpenShift, "id" | "status" | "startsAt" | "endsAt"> & {
  readonly serviceId: string;
  readonly teamName: string;
  readonly siteName: string | null;
};

export type BoardCellStatus = "requested" | "open" | "unfilled" | "filled" | "reported";

export type BoardWeek<T extends Row> = {
  readonly days: readonly string[];
  readonly rows: readonly {
    readonly key: string;
    readonly site: string;
    readonly team: string;
    readonly cells: readonly (readonly { shift: T; status: BoardCellStatus }[])[];
  }[];
  readonly counts: { all: number; open: number; requested: number; unfilled: number; filled: number; reported: number };
};

const UNFILLED_MS = 48 * 3_600_000;

export function boardStatus(row: Pick<Row, "status" | "startsAt">, now: Date): BoardCellStatus | null {
  switch (row.status) {
    case "claimed":
      return "requested";
    case "approved":
      return "filled";
    case "reported":
      return "reported";
    case "open":
      return Date.parse(row.startsAt) - now.getTime() <= UNFILLED_MS ? "unfilled" : "open";
    default:
      return null;
  }
}

export function weekStart(anyDay: string): string {
  const weekday = (new Date(`${anyDay}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysToDate(anyDay, -weekday);
}

export function boardWeek<T extends Row>(shifts: readonly T[], anyDay: string, now: Date): BoardWeek<T> {
  const monday = weekStart(anyDay);
  const days = Array.from({ length: 7 }, (_, index) => addDaysToDate(monday, index));
  const rows = new Map<
    string,
    { key: string; site: string; team: string; cells: { shift: T; status: BoardCellStatus }[][] }
  >();
  const counts = { all: 0, open: 0, requested: 0, unfilled: 0, filled: 0, reported: 0 };
  const sorted = [...shifts].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (const shift of sorted) {
    const index = days.indexOf(perthDateOf(shift.startsAt));
    if (index < 0) continue;
    const status = boardStatus(shift, now);
    if (!status) continue;
    const site = shift.siteName ?? "No site given";
    const key = `${shift.serviceId}:${site}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, site, team: shift.teamName, cells: days.map(() => []) };
      rows.set(key, row);
    }
    row.cells[index]!.push({ shift, status });
    counts.all += 1;
    if (status === "open") counts.open += 1;
    if (status === "unfilled") counts.unfilled += 1;
    if (status === "requested") counts.requested += 1;
    if (status === "filled") counts.filled += 1;
    if (status === "reported") counts.reported += 1;
  }
  return {
    days,
    rows: [...rows.values()].sort((a, b) => a.team.localeCompare(b.team) || a.site.localeCompare(b.site)),
    counts,
  };
}
