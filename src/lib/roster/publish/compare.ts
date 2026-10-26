import { PERTH_TIME_ZONE, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAssignment, RosterChanges } from "@/lib/roster/team/model";

import type { PublishPeriod, RosterPublishRow } from "./build";

export type SwapUndo = {
  swapId: string;
  names: string[];
  date: string;
  decidedAt: string;
  keepLive: RosterPublishRow[];
  useFile: RosterPublishRow[];
};

export type OpenClaimUndo = {
  openShiftId: string;
  name: string;
  date: string;
  decidedAt: string;
  keepLive: RosterPublishRow;
};

export type PublishComparison = {
  rows: RosterPublishRow[];
  unchanged: number;
  added: RosterPublishRow[];
  changed: { before: RosterAssignment; after: RosterPublishRow }[];
  removed: RosterAssignment[];
  byPerson: { userId: string | null; name: string; count: number }[];
  undoesSwaps: SwapUndo[];
  openShifts: RosterPublishRow[];
  undoesOpenClaims: OpenClaimUndo[];
};

export function personKey(row: { userId: string | null; name?: string | null; rosterName?: string | null }): string {
  return row.userId ?? `named:${(row.rosterName ?? row.name ?? "").trim().toLowerCase()}`;
}

function key(row: {
  userId: string | null;
  name?: string | null;
  rosterName?: string | null;
  startsAt: string;
  kind: string;
}): string {
  return `${personKey(row)}|${perthDateOf(row.startsAt)}|${row.kind}`;
}

function equivalent(before: RosterAssignment, after: RosterPublishRow): boolean {
  return (
    before.userId === after.userId &&
    (before.userId !== null || before.name?.trim().toLowerCase() === after.rosterName?.trim().toLowerCase()) &&
    before.siteId === after.siteId &&
    Date.parse(before.startsAt) === Date.parse(after.startsAt) &&
    Date.parse(before.endsAt) === Date.parse(after.endsAt) &&
    before.shiftCode === after.shiftCode &&
    before.kind === after.kind &&
    before.grade === after.grade
  );
}

function liveRow(live: RosterAssignment): RosterPublishRow {
  return {
    rowName: live.name ?? "Team member",
    userId: live.userId,
    rosterName: live.userId ? null : live.name,
    siteId: live.siteId,
    startsAt: live.startsAt,
    endsAt: live.endsAt,
    shiftCode: live.shiftCode,
    kind: live.kind,
    grade: live.grade,
  };
}

function sameSlot(a: RosterPublishRow, b: RosterAssignment): boolean {
  return (
    Date.parse(a.startsAt) === Date.parse(b.startsAt) &&
    Date.parse(a.endsAt) === Date.parse(b.endsAt) &&
    a.kind === b.kind &&
    a.shiftCode === b.shiftCode &&
    a.siteId === b.siteId
  );
}

/**
 * Preserve an approved swap by default. A newer uploaded file often prints
 * the old owner; matching only by person would quietly reverse the agreement.
 */
export function compareWithLive({
  fileRows,
  live,
  approvedChanges,
  approvedOpenShifts = [],
  fileOpenShifts = [],
  period,
  choices = {},
  openChoices = {},
}: {
  fileRows: readonly RosterPublishRow[];
  fileOpenShifts?: readonly RosterPublishRow[];
  live: readonly RosterAssignment[];
  approvedChanges: readonly RosterChanges["swaps"][number][];
  approvedOpenShifts?: readonly RosterChanges["openShifts"][number][];
  period: PublishPeriod;
  choices?: Readonly<Record<string, "keep" | "file">>;
  openChoices?: Readonly<Record<string, "keep" | "file">>;
}): PublishComparison {
  const inPeriod = live.filter((row) => {
    // In Perth, as the database counts the period it replaces (see `build.ts`).
    const date = perthDateOf(row.startsAt, PERTH_TIME_ZONE);
    return date >= period.start && date <= period.end;
  });
  let rows = [...fileRows];
  const openShifts = [...fileOpenShifts];
  const undoesSwaps: SwapUndo[] = [];
  const undoesOpenClaims: OpenClaimUndo[] = [];
  const byId = new Map(inPeriod.map((row) => [row.id, row]));
  for (const swap of approvedChanges) {
    const affected = [swap.giveAssignmentId, swap.takeAssignmentId].flatMap((id) => {
      const row = id ? byId.get(id) : null;
      return row ? [row] : [];
    });
    if (!affected.length) continue;
    const reverted = affected.filter(
      (assignment) => !rows.some((row) => sameSlot(row, assignment) && row.userId === assignment.userId),
    );
    if (!reverted.length) continue;
    const useFile = rows.filter((row) => affected.some((assignment) => sameSlot(row, assignment)));
    const keepLive = affected.map(liveRow);
    undoesSwaps.push({
      swapId: swap.swapId,
      names: affected.map((assignment) => assignment.name ?? "a colleague"),
      date: perthDateOf(affected[0]!.startsAt),
      decidedAt: swap.decidedAt,
      keepLive,
      useFile,
    });
    if (choices[swap.swapId] === "file") continue;
    // Keep other staff on the same kind and date: remove only the old owner
    // of each affected assignment, then put the approved live assignment in.
    rows = rows.filter(
      (row) =>
        !affected.some(
          (assignment) =>
            sameSlot(row, assignment) && (row.userId === swap.requesterId || row.userId === swap.counterpartyId),
        ),
    );
    for (const keep of keepLive) {
      if (!rows.some((row) => row.userId === keep.userId && row.startsAt === keep.startsAt && row.kind === keep.kind)) {
        rows.push(keep);
      }
    }
  }

  for (const claim of approvedOpenShifts) {
    if (!claim.assignmentId || !claim.claimedBy) continue;
    const assignment = byId.get(claim.assignmentId);
    if (!assignment || assignment.userId !== claim.claimedBy) continue;
    if (rows.some((row) => equivalent(assignment, row))) continue;
    const keep = liveRow(assignment);
    undoesOpenClaims.push({
      openShiftId: claim.openShiftId,
      name: assignment.name ?? "a colleague",
      date: perthDateOf(assignment.startsAt),
      decidedAt: claim.decidedAt,
      keepLive: keep,
    });
    if (openChoices[claim.openShiftId] === "file") continue;
    // An approved claim must remain an assignment, never turn back into an
    // open offer because an older file still says TBA.
    const claimedVacancy = openShifts.findIndex((row) => sameSlot(row, assignment));
    if (claimedVacancy >= 0) openShifts.splice(claimedVacancy, 1);
    if (!rows.some((row) => equivalent(assignment, row))) rows.push(keep);
  }

  const oldByKey = new Map<string, RosterAssignment[]>();
  for (const row of inPeriod) oldByKey.set(key(row), [...(oldByKey.get(key(row)) ?? []), row]);
  const unchanged: RosterPublishRow[] = [];
  const added: RosterPublishRow[] = [];
  const changed: { before: RosterAssignment; after: RosterPublishRow }[] = [];
  for (const row of rows) {
    const candidates = oldByKey.get(key(row)) ?? [];
    const exactIndex = candidates.findIndex((before) => equivalent(before, row));
    if (exactIndex >= 0) {
      unchanged.push(row);
      candidates.splice(exactIndex, 1);
    } else if (candidates.length) {
      changed.push({ before: candidates.shift()!, after: row });
    } else {
      added.push(row);
    }
  }
  const removed = [...oldByKey.values()].flat();
  const changedPeople = new Map<string, { userId: string | null; name: string; count: number }>();
  const count = (row: { userId: string | null; name?: string | null; rowName?: string }) => {
    const id = personKey(row);
    const previous = changedPeople.get(id);
    changedPeople.set(id, {
      userId: row.userId,
      name: row.rowName ?? row.name ?? "Team member",
      count: (previous?.count ?? 0) + 1,
    });
  };
  added.forEach(count);
  changed.forEach(({ after }) => count(after));
  removed.forEach(count);
  return {
    rows,
    unchanged: unchanged.length,
    added,
    changed,
    removed,
    byPerson: [...changedPeople.values()].sort((a, b) => a.name.localeCompare(b.name)),
    undoesSwaps,
    openShifts,
    undoesOpenClaims,
  };
}
