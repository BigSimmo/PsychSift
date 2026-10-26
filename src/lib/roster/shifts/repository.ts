import "server-only";

import type { Json } from "@/lib/supabase/database.types";
import { SHIFT_KINDS, type ShiftKind } from "@/lib/roster/shift-kind";
import { detectOwnConflicts, type OwnShiftConflict } from "@/lib/roster/shifts/conflicts";
import { diffRoster } from "@/lib/roster/shifts/diff";
import {
  ON_CALL_MANUAL_SHIFT_REPEAT_MAX_WEEKS,
  onCallShiftChangeSchema,
  type OnCallShift,
  type OnCallShiftFormat,
  type OnCallShiftImportRequest,
  type OnCallShiftImportSummary,
  type OnCallShiftInput,
  type OnCallShiftSource,
} from "@/lib/roster/shifts/model";
import { addDaysToDate, perthDateOf, perthTimeOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";
import { DEFAULT_WORK_TIME_ZONE } from "@/lib/work-time/zones";

export { detectOwnConflicts, type OwnShiftConflict };

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * Reads and writes for My shifts. Every query here filters by `owner_id`, and
 * the owner always comes from the validated session in the route, never from
 * the request body: a doctor's roster is theirs alone.
 */

const SHIFT_COLUMNS = "id,starts_at,ends_at,title,location,source_uid,kind,workplace,source,series_id";
const IMPORT_COLUMNS = "id,imported_at,format,window_start,window_end,added,changed,removed,changes,seen_at";

const KNOWN_SHIFT_FORMATS: ReadonlySet<string> = new Set(["ics", "csv", "xlsx", "pdf", "link"]);

type ShiftRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  location: string | null;
  source_uid: string | null;
  kind: string | null;
  workplace: string | null;
  source: string;
  series_id: string | null;
};

type ImportRow = {
  id: string;
  imported_at: string;
  format: string;
  window_start: string;
  window_end: string;
  added: number;
  changed: number;
  removed: number;
  changes: Json;
  seen_at: string | null;
};

function rowToShiftKind(kind: string | null): ShiftKind | null {
  return kind !== null && (SHIFT_KINDS as readonly string[]).includes(kind) ? (kind as ShiftKind) : null;
}

function rowToShiftSource(source: string): OnCallShiftSource {
  return source === "manual" ? "manual" : "import";
}

function rowToShiftFormat(format: string): OnCallShiftFormat {
  return KNOWN_SHIFT_FORMATS.has(format) ? (format as OnCallShiftFormat) : "ics";
}

function rowToShift(row: ShiftRow): OnCallShift {
  return {
    id: row.id,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    title: row.title,
    location: row.location,
    sourceUid: row.source_uid,
    kind: rowToShiftKind(row.kind ?? null),
    source: rowToShiftSource(row.source),
    seriesId: row.series_id ?? null,
    workplace: row.workplace ?? null,
  };
}

function rowToImport(row: ImportRow): OnCallShiftImportSummary {
  const changes = Array.isArray(row.changes)
    ? row.changes.flatMap((change) => {
        const parsed = onCallShiftChangeSchema.safeParse(change);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  return {
    id: row.id,
    importedAt: row.imported_at,
    format: rowToShiftFormat(row.format),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    added: row.added,
    changed: row.changed,
    removed: row.removed,
    changes,
    seenAt: row.seen_at,
  };
}

function requireOwner(ownerId: string) {
  if (!ownerId) throw new Error("Missing shift owner.");
}

/** Shifts that have not finished before `from`, soonest first. */
export async function fetchOwnerShifts(supabase: AdminClient, ownerId: string, from: Date): Promise<OnCallShift[]> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("on_call_shifts")
    .select(SHIFT_COLUMNS)
    .eq("owner_id", ownerId)
    .gt("ends_at", from.toISOString())
    .order("starts_at", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map(rowToShift);
}

/**
 * Shifts that overlap `[from, to)`, soonest first: the calendar's read for a
 * month older than the main list reaches. Uses the (owner_id, starts_at) index.
 */
export async function fetchOwnerShiftsBetween(
  supabase: AdminClient,
  ownerId: string,
  from: Date,
  to: Date,
): Promise<OnCallShift[]> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("on_call_shifts")
    .select(SHIFT_COLUMNS)
    .eq("owner_id", ownerId)
    .gt("ends_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map(rowToShift);
}

/** The owner's most recent import, or null if they have never imported. */
export async function fetchLatestShiftImport(
  supabase: AdminClient,
  ownerId: string,
): Promise<OnCallShiftImportSummary | null> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("on_call_shift_imports")
    .select(IMPORT_COLUMNS)
    .eq("owner_id", ownerId)
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToImport(data) : null;
}

/**
 * The owner's imported shifts inside a roster's dates, for one workplace. Only
 * imported rows of that workplace are compared: a hand-added shift, and an
 * import for a different workplace, are never touched by this roster's save.
 */
async function fetchOwnerShiftsInWindow(
  supabase: AdminClient,
  ownerId: string,
  window: { start: string; end: string },
  workplace: string | null,
): Promise<OnCallShift[]> {
  const from = perthWallToIso(window.start, "00:00");
  const to = perthWallToIso(addDaysToDate(window.end, 1), "00:00");
  if (!from || !to) throw new Error("Invalid roster dates.");
  const query = supabase
    .from("on_call_shifts")
    .select(SHIFT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("source", "import")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .limit(2000);
  const scoped = workplace === null ? query.is("workplace", null) : query.eq("workplace", workplace);
  const { data, error } = await scoped;
  if (error) throw error;
  return (data ?? []).map(rowToShift);
}

/**
 * Save a roster: replace the owner's shifts inside its dates and record what
 * changed, in one database transaction. The change list is worked out here,
 * from what is stored, never taken from the request.
 */
export async function replaceOwnerShifts(
  supabase: AdminClient,
  ownerId: string,
  request: OnCallShiftImportRequest,
): Promise<string> {
  requireOwner(ownerId);
  const window = { start: request.windowStart, end: request.windowEnd };
  const stored = await fetchOwnerShiftsInWindow(supabase, ownerId, window, request.workplace);
  const diff = diffRoster(stored, request.shifts, window);
  const { data, error } = await supabase.rpc("roster_own_shifts_replace", {
    p_owner_id: ownerId,
    p_window_start: window.start,
    p_window_end: window.end,
    p_format: request.format,
    p_workplace: request.workplace,
    p_file_name: request.fileName,
    p_shifts: request.shifts as unknown as Json,
    p_changes: diff.changes as unknown as Json,
    p_added: diff.added,
    p_changed: diff.changed,
    p_removed: diff.removed,
  });
  if (error) throw error;
  return String(data);
}

export async function markShiftImportSeen(supabase: AdminClient, ownerId: string, importId: string): Promise<boolean> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("on_call_shift_imports")
    .update({ seen_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("id", importId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * The same wall-clock time `weeks` weeks on, in the zone the shift was typed in.
 * A fixed 7 x 24 h would move a Sydney 08:00 shift to 09:00 once daylight saving
 * starts. A time the clock skips that day falls back to the fixed span.
 */
function addWeeks(instant: string, weeks: number, zone: string): string {
  const fixed = new Date(Date.parse(instant) + weeks * 7 * 24 * 60 * 60 * 1000).toISOString();
  const date = perthDateOf(instant, zone);
  return perthWallToIso(addDaysToDate(date, weeks * 7), perthTimeOf(instant, zone), zone) ?? fixed;
}

/**
 * Add one or more shifts by hand. A shift never touched by an import (never
 * has a workplace). When `repeatWeeks` is positive, every given shift repeats
 * weekly that many more times. Every row added here shares one new
 * `seriesId`, a one-off shift included, because that is how a hand-added
 * shift is removed.
 */
export async function addManualShifts(
  supabase: AdminClient,
  ownerId: string,
  shifts: readonly OnCallShiftInput[],
  repeatWeeks: number,
  zone: string = DEFAULT_WORK_TIME_ZONE,
): Promise<OnCallShift[]> {
  requireOwner(ownerId);
  const weeks = Math.max(0, Math.min(Math.trunc(repeatWeeks), ON_CALL_MANUAL_SHIFT_REPEAT_MAX_WEEKS));
  const seriesId = crypto.randomUUID();
  const rows = shifts.flatMap((input) =>
    Array.from({ length: weeks + 1 }, (_unused, occurrence) => ({
      owner_id: ownerId,
      starts_at: addWeeks(input.startsAt, occurrence, zone),
      ends_at: addWeeks(input.endsAt, occurrence, zone),
      title: input.title,
      location: input.location,
      source_uid: null,
      source: "manual",
      kind: input.kind ?? null,
      workplace: null,
      series_id: seriesId,
    })),
  );
  const { data, error } = await supabase.from("on_call_shifts").insert(rows).select(SHIFT_COLUMNS);
  if (error) throw error;
  return (data ?? []).map(rowToShift);
}

/**
 * Non-blocking conflict check for newly added manual shifts against the owner's
 * existing shifts in the covered window.
 */
export async function checkManualShiftConflicts(
  supabase: AdminClient,
  ownerId: string,
  addedShifts: readonly (OnCallShiftInput | OnCallShift)[],
): Promise<OwnShiftConflict[]> {
  requireOwner(ownerId);
  const starts = addedShifts.map((shift) => Date.parse(shift.startsAt)).filter(Number.isFinite);
  const ends = addedShifts.map((shift) => Date.parse(shift.endsAt)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return [];
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...ends);
  if (maxEnd <= minStart) return [];
  const existing = await fetchOwnerShiftsBetween(supabase, ownerId, new Date(minStart), new Date(maxEnd));
  const addedIds = new Set(
    addedShifts.flatMap((shift) => ("id" in shift && typeof shift.id === "string" ? [shift.id] : [])),
  );
  const prior = existing.filter((shift) => !addedIds.has(shift.id));
  return detectOwnConflicts([...prior, ...addedShifts]);
}

/** Remove every shift in one hand-added series (the shift and its weekly repeats). */
export async function deleteManualSeries(supabase: AdminClient, ownerId: string, seriesId: string): Promise<void> {
  requireOwner(ownerId);
  const { error } = await supabase
    .from("on_call_shifts")
    .delete()
    .eq("owner_id", ownerId)
    .eq("series_id", seriesId)
    .eq("source", "manual");
  if (error) throw error;
}

/**
 * Delete one workplace's imported shifts (Settings, Remove workplace). No
 * import record is written: a removal is not a roster. Hand-added shifts,
 * which never carry a workplace, are never touched.
 */
export async function deleteWorkplaceImportedShifts(
  supabase: AdminClient,
  ownerId: string,
  workplace: string,
): Promise<void> {
  requireOwner(ownerId);
  const { error } = await supabase
    .from("on_call_shifts")
    .delete()
    .eq("owner_id", ownerId)
    .eq("source", "import")
    .eq("workplace", workplace);
  if (error) throw error;
}

/**
 * Undo one import that should not have happened: a calendar-link refresh whose
 * link was removed (or Delete my data ran) while it was saving. Deletes the
 * rows that import wrote, the workplace's imported shifts inside its dates,
 * and its import record. Hand-added shifts are never touched.
 */
export async function undoShiftImport(
  supabase: AdminClient,
  ownerId: string,
  undo: { importId: string; workplace: string | null; windowStart: string; windowEnd: string },
): Promise<void> {
  requireOwner(ownerId);
  const from = perthWallToIso(undo.windowStart, "00:00");
  const to = perthWallToIso(addDaysToDate(undo.windowEnd, 1), "00:00");
  if (!from || !to) throw new Error("Invalid roster dates.");
  // A newer import for the same workplace (for example a file saved while this refresh ran)
  // now owns the window's rows: drop only this import's record, never the newer shifts.
  const own = await supabase
    .from("on_call_shift_imports")
    .select("imported_at")
    .eq("owner_id", ownerId)
    .eq("id", undo.importId)
    .maybeSingle();
  if (own.error) throw own.error;
  if (own.data) {
    const newer = supabase
      .from("on_call_shift_imports")
      .select("id")
      .eq("owner_id", ownerId)
      .neq("id", undo.importId)
      .gt("imported_at", own.data.imported_at)
      .limit(1);
    const found = await (undo.workplace === null ? newer.is("workplace", null) : newer.eq("workplace", undo.workplace));
    if (found.error) throw found.error;
    if ((found.data ?? []).length > 0) {
      const record = await supabase
        .from("on_call_shift_imports")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", undo.importId);
      if (record.error) throw record.error;
      return;
    }
  }
  const query = supabase
    .from("on_call_shifts")
    .delete()
    .eq("owner_id", ownerId)
    .eq("source", "import")
    .gte("starts_at", from)
    .lt("starts_at", to);
  const shifts = await (undo.workplace === null ? query.is("workplace", null) : query.eq("workplace", undo.workplace));
  if (shifts.error) throw shifts.error;
  const record = await supabase.from("on_call_shift_imports").delete().eq("owner_id", ownerId).eq("id", undo.importId);
  if (record.error) throw record.error;
}

/**
 * Delete every shift and import record the owner has. Delete my data calls
 * this last, after the owner's calendar links and Roster settings are gone
 * (see `DELETE /api/roster/shifts`).
 */
export async function deleteOwnerShifts(supabase: AdminClient, ownerId: string): Promise<void> {
  requireOwner(ownerId);
  const shifts = await supabase.from("on_call_shifts").delete().eq("owner_id", ownerId);
  if (shifts.error) throw shifts.error;
  const imports = await supabase.from("on_call_shift_imports").delete().eq("owner_id", ownerId);
  if (imports.error) throw imports.error;
}
