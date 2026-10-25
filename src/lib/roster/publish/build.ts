import { z } from "zod";

import { PERTH_TIME_ZONE, perthDateOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";
import {
  ROSTER_ASSIGNMENT_KINDS,
  ROSTER_GRADES,
  ROSTER_OPEN_SHIFT_KINDS,
  type RosterAssignmentKind,
  type RosterGrade,
} from "@/lib/roster/team/model";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().refine((value) => Number.isFinite(Date.parse(value)));

// The database counts a publish period in Perth dates, and the server checks with Perth too, so the
// browser checks in Perth whatever work zone the manager chose. Otherwise a shift the browser accepts
// can be refused on the server.
const periodDateOf = (instant: string) => perthDateOf(instant, PERTH_TIME_ZONE);

export type RosterPublishRow = {
  rowName: string;
  userId: string | null;
  rosterName: string | null;
  siteId: string | null;
  startsAt: string;
  endsAt: string;
  shiftCode: string;
  kind: RosterAssignmentKind;
  grade: RosterGrade | null;
};

export const publishRowSchema = z
  .object({
    rowName: z.string().trim().min(1).max(80),
    userId: uuid.nullable(),
    rosterName: z.string().trim().min(1).max(80).nullable(),
    siteId: uuid.nullable(),
    startsAt: instant,
    endsAt: instant,
    shiftCode: z.string().trim().min(1).max(12),
    kind: z.enum(ROSTER_ASSIGNMENT_KINDS),
    grade: z.enum(ROSTER_GRADES).nullable(),
  })
  .strict();

export type PublishPeriod = { start: string; end: string };
export type PublishPayload = {
  kind: "full";
  periodStart: string;
  periodEnd: string;
  sourceName: string | null;
  assignments: Omit<RosterPublishRow, "rowName">[];
};

export const publishOpenShiftSchema = z
  .object({
    startsAt: instant,
    endsAt: instant,
    shiftCode: z.string().trim().min(1).max(12),
    kind: z.enum(ROSTER_OPEN_SHIFT_KINDS),
    siteId: uuid.nullable().default(null),
    minGrade: z.enum(["intern", "resident", "registrar", "fellow", "consultant"]).nullable().default(null),
    urgent: z.boolean().default(false),
  })
  .strict();
export type PublishOpenShift = z.infer<typeof publishOpenShiftSchema>;

export function validateOpenShifts({
  period,
  openShifts,
  now = new Date(),
}: {
  period: PublishPeriod;
  openShifts: readonly unknown[];
  now?: Date;
}): PublishOpenShift[] {
  validatePublishPeriod(period);
  if (openShifts.length > 1000) throw new Error("A team roster can post at most 1,000 open shifts.");
  return openShifts.map((raw) => {
    const parsed = publishOpenShiftSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Open shifts need a valid type, time and site.");
    const open = parsed.data;
    if (Date.parse(open.startsAt) <= now.getTime()) throw new Error("Open shifts must start in the future.");
    if (Date.parse(open.endsAt) <= Date.parse(open.startsAt))
      throw new Error("An open shift must end after it starts.");
    const startDate = periodDateOf(open.startsAt);
    if (startDate < period.start || startDate > period.end)
      throw new Error("An open shift starts outside the chosen period.");
    return open;
  });
}

/** An open row is an atomic offer, never an assignment with a fabricated name. */
export function buildOpenShifts({
  period,
  rows,
  now,
}: {
  period: PublishPeriod;
  rows: readonly RosterPublishRow[];
  now?: Date;
}): PublishOpenShift[] {
  return validateOpenShifts({
    period,
    now,
    openShifts: rows.map((row) => ({
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      shiftCode: row.shiftCode,
      kind: row.kind,
      siteId: row.siteId,
      minGrade: null,
      urgent: false,
    })),
  });
}

export function validatePublishPeriod(period: PublishPeriod): number {
  if (!date.safeParse(period.start).success || !date.safeParse(period.end).success) {
    throw new Error("Choose valid roster dates.");
  }
  if (!perthWallToIso(period.start, "00:00") || !perthWallToIso(period.end, "00:00")) {
    throw new Error("Choose valid roster dates.");
  }
  const from = Date.parse(`${period.start}T00:00:00Z`);
  const to = Date.parse(`${period.end}T00:00:00Z`);
  const days = Math.round((to - from) / 86_400_000);
  if (!Number.isFinite(days) || days < 0 || days > 186) throw new Error("Choose a period of at most 186 days.");
  return days;
}

/** Validate every row before sending one byte of a publish request. */
export function buildPublishPayload({
  period,
  sourceName,
  rows,
}: {
  period: PublishPeriod;
  sourceName: string | null;
  rows: readonly RosterPublishRow[];
  choices?: Record<string, "keep" | "file">;
}): PublishPayload {
  validatePublishPeriod(period);
  if (rows.length > 5000) throw new Error("A team roster can contain at most 5,000 shifts.");
  if (sourceName !== null && (sourceName.trim().length < 1 || sourceName.length > 120)) {
    throw new Error("Check the file name.");
  }
  const assignments = rows.map((raw) => {
    const parsed = publishRowSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Sort every roster row before publishing.");
    const row = parsed.data;
    if (!row.userId && !row.rosterName) throw new Error("Sort every roster row before publishing.");
    if (Date.parse(row.endsAt) <= Date.parse(row.startsAt)) throw new Error("A shift must end after it starts.");
    const startDate = periodDateOf(row.startsAt);
    if (startDate < period.start || startDate > period.end)
      throw new Error("A shift starts outside the chosen period.");
    const { rowName: _rowName, ...assignment } = row;
    void _rowName;
    return assignment;
  });
  return {
    kind: "full",
    periodStart: period.start,
    periodEnd: period.end,
    sourceName: sourceName?.trim() || null,
    assignments,
  };
}

export const publishPayloadSchema = z
  .object({
    kind: z.literal("full"),
    periodStart: date,
    periodEnd: date,
    sourceName: z.string().trim().min(1).max(120).nullable(),
    assignments: z.array(publishRowSchema.omit({ rowName: true })).max(5000),
  })
  .strict();

/** The server reuses the same boundary, including Perth dates and no anonymous empty names. */
export function validatePublishPayload(value: unknown): PublishPayload {
  const parsed = publishPayloadSchema.parse(value);
  return buildPublishPayload({
    period: { start: parsed.periodStart, end: parsed.periodEnd },
    sourceName: parsed.sourceName,
    rows: parsed.assignments.map((row) => ({ ...row, rowName: row.rosterName ?? row.userId ?? "row" })),
  });
}
