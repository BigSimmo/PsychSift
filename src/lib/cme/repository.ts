import { cpdTextPatientProblem, cpdTitlePatientProblem } from "@/lib/cme/patient-detail-check";
import { cmeEntryCreateSchema } from "@/lib/cme/schemas";
import { cmeYearConfigurationState } from "@/lib/cme/year-configuration";
import { rowsToCmeYearClose, type CmeCloseEvaluation } from "@/lib/cme/year-close";
import { randomUUID } from "node:crypto";
import type { CmeRoutine, CmeRoutineCadence } from "@/lib/cme/routines";
import type { Json } from "@/lib/supabase/database.types";
import { PublicApiError } from "@/lib/http";
import type {
  CmeAllocation,
  CmeCategory,
  CmeEntry,
  CmeRequirement,
  CmeRequirementSet,
  CmeRequirementSource,
  CmeRequirementSpec,
  CmeYearClose,
} from "@/lib/cme/types";
import type { Database } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

type CmeEntryInsert = Database["public"]["Tables"]["cme_entries"]["Insert"];
type CmeYearRow = Database["public"]["Tables"]["cme_years"]["Row"];
type CmeRequirementRow = Database["public"]["Tables"]["cme_requirements"]["Row"];

/**
 * A generous ceiling on one owner's year, so a runaway import or a corrupted routine
 * cannot page forever. Reused for `cme_requirements`, whose per-year count is always a
 * handful, purely so every bounded read in this module shares one documented ceiling
 * rather than inventing a second magic number for a table that will never approach it.
 */
export const CME_MAX_ENTRIES = 2000;

/**
 * `CmeEntry` -> the `cme_entries` insert payload.
 *
 * `id` is deliberately not part of the returned row: it is spelled out again on the
 * insert call itself (see `insertCmeEntry`), the same explicit-restamp idiom
 * `src/lib/on-call/repository.ts` uses for `owner_id`, so the identity a caller writes is
 * visible on the statement that writes it rather than buried inside a mapper.
 */
export function cmeEntryToRow(entry: CmeEntry, ownerId: string, yearId: string): CmeEntryInsert {
  return {
    owner_id: ownerId,
    year_id: yearId,
    formal_peer_review_hours: entry.formalPeerReviewHours ?? 0,
    source_url: entry.sourceUrl ?? null,
    archived_at: entry.archivedAt ?? null,
    activity_date: entry.date,
    title: entry.title,
    reflection: entry.reflection,
    cost_cents: entry.costCents,
    // Stored as the instant it was transcribed, not a boolean column — see the migration.
    // `rowToCmeEntry` reads only whether this is null, never the instant itself, so the
    // exact timestamp carries no meaning a caller can rely on today.
    transcribed_at: entry.transcribed ? new Date().toISOString() : null,
    routine_id: entry.routineId,
    document_id: entry.documentId,
    buckets: [...entry.buckets],
  };
}

/**
 * A `cme_entries` row (plus its joined `cme_allocations`) -> `CmeEntry`.
 *
 * `row` is untyped `Record<string, unknown>` rather than `CmeEntryRow` because every
 * caller in this module selects `cme_allocations` as a joined relation alongside it
 * (`select("*, cme_allocations!cme_allocations_entry_owner_fk(category, hours)")`), a shape the generated `Database`
 * type does not describe. Allocations travel as a separate argument for the same reason
 * `src/lib/on-call/repository.ts` takes its joined shape apart before mapping it.
 */
export function rowToCmeEntry(row: Record<string, unknown>, allocations: readonly CmeAllocation[]): CmeEntry {
  return {
    id: String(row.id),
    ...(Number(row.formal_peer_review_hours ?? 0) > 0
      ? { formalPeerReviewHours: Number(row.formal_peer_review_hours) }
      : {}),
    ...(row.archived_at ? { archivedAt: String(row.archived_at) } : {}),
    ...(row.source_url ? { sourceUrl: String(row.source_url) } : {}),
    date: String(row.activity_date),
    title: String(row.title),
    allocations: allocations.map((allocation) => ({ ...allocation })),
    reflection: String(row.reflection ?? ""),
    costCents: row.cost_cents == null ? null : Number(row.cost_cents),
    transcribed: row.transcribed_at != null,
    routineId: row.routine_id == null ? null : String(row.routine_id),
    documentId: row.document_id == null ? null : String(row.document_id),
    buckets: Array.isArray(row.buckets) ? row.buckets.map(String) : [],
  };
}

/**
 * A `cme_requirements` row -> `CmeRequirement`.
 *
 * `spec` is cast rather than schema-validated: the shape contract for it lives in Task 2's
 * `@/lib/cme/schemas.ts`, which this task does not own, and every row here was written by
 * this application's own insert path (mirrors `registry-records.ts`, which casts its own
 * jsonb governance columns the same way rather than re-validating application-written data
 * on every read).
 */
function rowToCmeRequirement(row: CmeRequirementRow): CmeRequirement {
  return {
    id: row.id,
    label: row.label,
    source: row.source as CmeRequirementSource,
    spec: row.spec as CmeRequirementSpec,
    completedOn: row.completed_on ?? null,
  };
}

/**
 * A `cme_years` row plus its `cme_requirements` rows -> `CmeRequirementSet`.
 *
 * Carries the year row's `id` alongside the `CmeRequirementSet` fields, even though
 * `CmeRequirementSet` itself has no id column: `insertCmeEntry` below takes a `yearId` it
 * has no other way to obtain, and `fetchOwnerCmeYear` is the one read this module offers
 * that resolves an owner+calendar-year pair to that row.
 */
function rowToCmeRequirementSet(
  yearRow: CmeYearRow,
  requirementRows: readonly CmeRequirementRow[],
): CmeRequirementSet & { readonly id: string } {
  return {
    id: yearRow.id,
    year: yearRow.year,
    ...(yearRow.closed_at ? { closedAt: yearRow.closed_at } : {}),
    confirmedOn: yearRow.confirmed_on,
    confirmedSource: yearRow.confirmed_source,
    totalHours: yearRow.total_hours,
    requirements: requirementRows
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(rowToCmeRequirement),
  };
}

/**
 * The owner's confirmed targets and requirements for one CPD year, or `null` when that
 * year has not been confirmed yet (no `cme_years` row exists for it).
 */
export async function fetchOwnerCmeYear(
  supabase: AdminClient,
  ownerId: string,
  year: number,
): Promise<(CmeRequirementSet & { readonly id: string }) | null> {
  if (!ownerId) throw new Error("A CME year was requested without an ownerId; refusing to run.");

  // The owner predicate rides the same chain as `.from()` on every read below.
  // `npm run check:owner-scope` is the gate that proves no query here can read another
  // owner's records; splitting the builder across a variable would defeat it.
  const { data: yearRow, error: yearError } = await supabase
    .from("cme_years")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("year", year)
    .maybeSingle();
  if (yearError) throw cmeRepositoryError(yearError);
  if (!yearRow) return null;

  const { data: requirementRows, error: requirementError } = await supabase
    .from("cme_requirements")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("year_id", yearRow.id)
    .order("sort_order", { ascending: true })
    .limit(CME_MAX_ENTRIES);
  if (requirementError) throw cmeRepositoryError(requirementError);

  return rowToCmeRequirementSet(yearRow, requirementRows ?? []);
}

/** Year ids for the signed-in owner's cross-year Log, bounded by the supported CPD calendar range. */
export async function fetchOwnerCmeYears(
  supabase: AdminClient,
  ownerId: string,
): Promise<readonly { id: string; year: number }[]> {
  if (!ownerId) throw new Error("CME years were requested without an ownerId; refusing to run.");
  const { data, error } = await supabase
    .from("cme_years")
    .select("id, year")
    .eq("owner_id", ownerId)
    .order("year", { ascending: false })
    .limit(102);
  if (error) throw cmeRepositoryError(error);
  if ((data?.length ?? 0) > 101) {
    throw new PublicApiError("The complete CPD year list could not be displayed.", 409);
  }
  return (data ?? []).map((row) => ({ id: row.id, year: row.year }));
}

/** Every logged entry for one owner's CPD year, most recent first. */
export async function fetchOwnerCmeEntries(
  supabase: AdminClient,
  ownerId: string,
  yearId: string,
  options: { includeArchived?: boolean } = {},
): Promise<CmeEntry[]> {
  if (!ownerId) throw new Error("CME entries were requested without an ownerId; refusing to run.");

  // The owner predicate rides the same chain as `.from()`. `npm run check:owner-scope`
  // cannot prove it in any other form, and this is the single regression class this
  // tenancy design is exposed to.
  const { data, error, count } = await supabase
    .from("cme_entries")
    .select("*, cme_allocations!cme_allocations_entry_owner_fk(category, hours)", { count: "exact" })
    .eq("owner_id", ownerId)
    .eq("year_id", yearId)
    .order("activity_date", { ascending: false })
    .limit(CME_MAX_ENTRIES + 1);
  if (error) throw cmeRepositoryError(error);
  if (count === null || count === undefined || count !== (data?.length ?? 0) || count > CME_MAX_ENTRIES)
    throw new PublicApiError(
      "This year exceeds the supported entry limit. The whole record cannot be displayed or exported.",
      409,
    );

  return (data ?? [])
    .filter((row) => options.includeArchived || !(row as Record<string, unknown>).archived_at)
    .map((entryRow) => {
      // Cast once, through the index-signature type, rather than a second direct cast from
      // the generated row type: the generated `Database` types carry no `Relationships` for
      // these tables yet (see `cme_entries`/`cme_allocations` in database.types.ts), so
      // supabase-js cannot resolve the joined `cme_allocations` embed's type and a second
      // direct cast on the original row type is rejected as insufficiently overlapping.
      const row = entryRow as Record<string, unknown>;
      const joinedAllocations = (row.cme_allocations as { category: string; hours: number }[] | undefined) ?? [];
      return rowToCmeEntry(
        row,
        joinedAllocations.map((allocation) => ({
          category: allocation.category as CmeCategory,
          hours: allocation.hours,
        })),
      );
    });
}

/**
 * Insert one CME entry and its allocations atomically, returning the stored entry.
 *
 * The PostgreSQL RPC owns the transaction, owner checks, retry identity, and
 * routine advancement. Failure rolls back the entire write.
 */
export async function insertCmeEntry(
  supabase: AdminClient,
  ownerId: string,
  yearId: string,
  entry: CmeEntry,
  requestId?: string,
): Promise<CmeEntry> {
  return saveCmeEntry(supabase, ownerId, yearId, entry, true, requestId);
}

/** Coherent entry+allocation+routine save: PostgreSQL rolls back every step on failure. */
export async function saveCmeEntry(
  supabase: AdminClient,
  ownerId: string,
  yearId: string,
  entry: CmeEntry,
  create = false,
  requestId?: string,
): Promise<CmeEntry> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const parsed = cmeEntryCreateSchema.safeParse(entry);
  if (!parsed.success) throw new PublicApiError("Invalid CPD entry details or allocations.", 400);
  const payload = parsed.data;
  const { data, error } = await supabase.rpc("cme_save_entry", {
    p_owner_id: ownerId,
    p_year_id: yearId,
    p_entry_id: entry.id,
    p_entry: { ...payload, formalPeerReviewHours: entry.formalPeerReviewHours ?? 0 } as Json,
    p_create: create,
    p_request_id: requestId ?? null,
  });
  if (error) throw cmeRepositoryError(error);
  return joinedEntry(data as Record<string, unknown>);
}

export function cmeRepositoryError(error: { message: string }): Error {
  const safe: Record<string, [string, number]> = {
    cme_entry_archived: ["Restore this archived entry before editing or copying it.", 409],
    cme_year_closed: [
      "This CPD year is closed. Change one of its activities by recording an amendment from the activity's page.",
      409,
    ],
    cme_year_open: ["This CPD year is not closed. Edit the activity instead of amending it.", 409],
    cme_close_conflict: ["Your record changed while the year was being closed. Reload and try again.", 409],
    cme_plan_conflict: ["Your plan changed in another tab. Reload before saving it.", 409],
    cme_goal_not_found: ["This goal is no longer available. Reload the plan and try again.", 404],
    cme_goal_limit: ["The next year's plan already has ten goals.", 409],
    cme_carry_unavailable: ["Goal carry is available from 17 December through January.", 409],
    cme_amendment_reason_invalid: ["Give a reason for this amendment (3 to 1000 characters).", 400],
    cme_year_not_confirmed: ["Confirm your CPD year before saving an entry.", 400],
    cme_entry_not_found: ["CPD entry not found.", 404],
    cme_retry_conflict: [
      "This save request was already used for different details. Reload the saved entry before editing it.",
      409,
    ],
    cme_invalid_link: ["The selected source or routine is unavailable.", 400],
    cme_invalid_request: ["Check the entry details and try again.", 400],
    cme_invalid_allocations: ["Check the category hours and peer review credit.", 400],
  };
  const match = safe[error.message];
  return match
    ? new PublicApiError(match[0], match[1], { code: error.message })
    : new Error("CME storage operation failed.");
}

function joinedEntry(row: Record<string, unknown>): CmeEntry {
  return rowToCmeEntry(row, (row.cme_allocations ?? []) as CmeAllocation[]);
}

export async function confirmCmeYear(supabase: AdminClient, ownerId: string, set: CmeRequirementSet) {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { error } = await supabase.rpc("cme_confirm_year", {
    p_owner_id: ownerId,
    p_set: JSON.parse(JSON.stringify(set)) as Json,
  });
  if (error) throw cmeRepositoryError(error);
  return fetchOwnerCmeYear(supabase, ownerId, set.year);
}

export async function fetchOwnerCmeEntry(supabase: AdminClient, ownerId: string, id: string): Promise<CmeEntry | null> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { data, error } = await supabase
    .from("cme_entries")
    .select("*, cme_allocations!cme_allocations_entry_owner_fk(category, hours)")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw cmeRepositoryError(error);
  return data ? joinedEntry(data as Record<string, unknown>) : null;
}

function rowToRoutine(row: Database["public"]["Tables"]["cme_routines"]["Row"]): CmeRoutine {
  return {
    id: row.id,
    title: row.title,
    cadence: row.cadence as CmeRoutineCadence,
    usualHours: row.usual_hours,
    usualAllocations: row.usual_allocations as CmeAllocation[],
    nextDue: row.next_due,
    archivedAt: row.archived_at,
  };
}
export async function fetchOwnerCmeRoutines(supabase: AdminClient, ownerId: string): Promise<CmeRoutine[]> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { data, error } = await supabase
    .from("cme_routines")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(CME_MAX_ENTRIES);
  if (error) throw cmeRepositoryError(error);
  return (data ?? []).map(rowToRoutine);
}
export async function saveCmeRoutine(
  supabase: AdminClient,
  ownerId: string,
  routine: Omit<CmeRoutine, "id">,
  id?: string,
): Promise<CmeRoutine> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const row = {
    title: routine.title,
    cadence: routine.cadence,
    usual_hours: routine.usualHours,
    usual_allocations: [...routine.usualAllocations] as Json,
    next_due: routine.nextDue,
    archived_at: routine.archivedAt,
  };
  const result = id
    ? await supabase.from("cme_routines").update(row).eq("owner_id", ownerId).eq("id", id).select("*").maybeSingle()
    : await supabase
        .from("cme_routines")
        .insert({ ...row, id: randomUUID(), owner_id: ownerId })
        .select("*")
        .single();
  if (result.error) throw cmeRepositoryError(result.error);
  if (!result.data) throw new PublicApiError("CPD routine not found.", 404);
  return rowToRoutine(result.data);
}

/**
 * The server's backstop for the entry form's patient-detail check: the same CPD readings of the
 * title and reflection, so a caller that skips the form (a stale tab, a script) cannot store a
 * patient detail the form would have refused. The account work-sync and answer-feedback writes
 * re-check on the server the same way.
 */
export function assertNoCmeEntryPatientDetail(entry: { readonly title: string; readonly reflection: string }): void {
  if (cpdTitlePatientProblem(entry.title) || cpdTextPatientProblem(entry.reflection)) {
    throw new PublicApiError(
      "The title or reflection looks like it holds a patient detail, so it was not saved. Take it out and save again.",
      422,
      { code: "patient_detail" },
    );
  }
}

/**
 * Reject `routineId` / `documentId` that do not belong to this owner.
 *
 * Foreign keys only prove the target row exists somewhere. Without an owner
 * check, a caller who knows another owner's UUID can attach it and learn
 * whether it exists from success versus failure — an existence oracle on an
 * otherwise owner-scoped record. Same closed message for missing and
 * cross-owner ids, matching `assertValidLinkedDocumentIds` for On Call.
 */
export async function assertValidCmeLinkedIds(
  supabase: AdminClient,
  ownerId: string,
  links: { readonly routineId: string | null; readonly documentId: string | null },
): Promise<void> {
  if (!ownerId) throw new Error("CME linked ids were checked without an ownerId; refusing to run.");

  if (links.documentId) {
    const { data, error } = await supabase
      .from("documents")
      .select("id")
      .eq("id", links.documentId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      throw new PublicApiError("Invalid linked document ID: the document does not exist.", 400);
    }
  }

  if (links.routineId) {
    const { data, error } = await supabase
      .from("cme_routines")
      .select("id")
      .eq("id", links.routineId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      throw new PublicApiError("Invalid linked routine ID: the routine does not exist.", 400);
    }
  }
}

/** Update the copy state of one owner-scoped, editable entry. */
async function setCmeEntryTranscribed(
  supabase: AdminClient,
  ownerId: string,
  entryId: string,
  transcribed: boolean,
): Promise<CmeEntry> {
  if (!ownerId) throw new Error("A CME entry was transcribed without an ownerId; refusing to run.");

  const { data: existing, error: existingError } = await supabase
    .from("cme_entries")
    .select("*, cme_allocations!cme_allocations_entry_owner_fk(category, hours)")
    .eq("id", entryId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new PublicApiError("CPD entry not found.", 404, { code: "cme_entry_not_found" });

  if ((existing as Record<string, unknown>).archived_at) throw cmeRepositoryError({ message: "cme_entry_archived" });
  const confirmedYear = await fetchOwnerCmeYear(supabase, ownerId, Number(String(existing.activity_date).slice(0, 4)));
  if (cmeYearConfigurationState(confirmedYear) === "unavailable") {
    throw new PublicApiError("Your saved CPD targets could not be read. They have not been changed.", 503, {
      code: "cme_year_unavailable",
    });
  }
  if (cmeYearConfigurationState(confirmedYear) !== "ready") {
    throw new PublicApiError("Confirm all of your CPD targets before updating this entry.", 400, {
      code: "cme_year_not_confirmed",
    });
  }

  const { data: updated, error: updateError } = await supabase
    .from("cme_entries")
    .update({ transcribed_at: transcribed ? new Date().toISOString() : null })
    .eq("id", entryId)
    .eq("owner_id", ownerId)
    .select("*, cme_allocations!cme_allocations_entry_owner_fk(category, hours)")
    .maybeSingle();
  if (updateError) throw cmeRepositoryError(updateError);
  if (!updated) throw new PublicApiError("CPD entry not found.", 404, { code: "cme_entry_not_found" });

  const row = updated as Record<string, unknown>;
  const joined = (row.cme_allocations as { category: string; hours: number }[] | undefined) ?? [];
  return rowToCmeEntry(
    row,
    joined.map((allocation) => ({
      category: allocation.category as CmeCategory,
      hours: allocation.hours,
    })),
  );
}

/** Stamp the copy time after a successful clipboard copy. */
export async function markCmeEntryTranscribed(
  supabase: AdminClient,
  ownerId: string,
  entryId: string,
): Promise<CmeEntry> {
  return setCmeEntryTranscribed(supabase, ownerId, entryId, true);
}

/** Undo a copy by clearing its time, subject to the same owner and year checks. */
export async function clearCmeEntryTranscribed(
  supabase: AdminClient,
  ownerId: string,
  entryId: string,
): Promise<CmeEntry> {
  return setCmeEntryTranscribed(supabase, ownerId, entryId, false);
}

/**
 * @deprecated Do not use. Write allocations only through `saveCmeEntry` (the
 * `cme_save_entry` database function), which saves an entry and its allocations
 * in one transaction and refuses a closed or archived year. This helper deletes
 * then inserts in separate requests, skips those year checks, and its restore is
 * best effort, so a double failure can leave an entry with no allocations.
 * Nothing calls it; it is kept only until it can be removed under
 * docs/agents/dead-code-deletion.md.
 */
export async function replaceCmeAllocations(
  supabase: AdminClient,
  ownerId: string,
  entryId: string,
  allocations: readonly CmeAllocation[],
): Promise<{ readonly written: CmeAllocation[]; readonly prior: CmeAllocation[] }> {
  if (!ownerId) throw new Error("CME allocations were replaced without an ownerId; refusing to run.");
  if (allocations.length === 0) {
    throw new PublicApiError("A CPD entry needs at least one category allocation.", 400);
  }
  const categories = allocations.map((allocation) => allocation.category);
  if (new Set(categories).size !== categories.length) {
    throw new PublicApiError("A CPD entry cannot allocate hours to the same category twice.", 400);
  }

  const { data: priorRows, error: priorError } = await supabase
    .from("cme_allocations")
    .select("category, hours")
    .eq("owner_id", ownerId)
    .eq("entry_id", entryId);
  if (priorError) throw new Error(priorError.message);
  const prior: CmeAllocation[] = (priorRows ?? []).map((row) => ({
    category: row.category as CmeCategory,
    hours: row.hours,
  }));

  const { error: deleteError } = await supabase
    .from("cme_allocations")
    .delete()
    .eq("owner_id", ownerId)
    .eq("entry_id", entryId);
  if (deleteError) throw new Error(deleteError.message);

  const allocationRows = allocations.map((allocation) => ({
    owner_id: ownerId,
    entry_id: entryId,
    category: allocation.category,
    hours: allocation.hours,
  }));
  const { data: insertedAllocations, error: insertError } = await supabase
    .from("cme_allocations")
    .insert(allocationRows)
    .select("category, hours");
  if (insertError) {
    if (prior.length > 0) {
      const { error: restoreError } = await supabase.from("cme_allocations").insert(
        prior.map((allocation) => ({
          owner_id: ownerId,
          entry_id: entryId,
          category: allocation.category,
          hours: allocation.hours,
        })),
      );
      if (restoreError) {
        throw new Error(
          `Allocation insert failed (${insertError.message}); restore also failed (${restoreError.message}).`,
        );
      }
    }
    throw new Error(insertError.message);
  }

  const written = (insertedAllocations ?? allocationRows).map((allocation) => ({
    category: allocation.category as CmeCategory,
    hours: allocation.hours,
  }));
  return { written, prior };
}

/**
 * @deprecated Do not use; see `replaceCmeAllocations`. Allocations are written only
 * through `saveCmeEntry`, which is atomic and checks the year.
 */
export async function restoreCmeAllocations(
  supabase: AdminClient,
  ownerId: string,
  entryId: string,
  prior: readonly CmeAllocation[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("cme_allocations")
    .delete()
    .eq("owner_id", ownerId)
    .eq("entry_id", entryId);
  if (deleteError) throw new Error(deleteError.message);
  if (prior.length === 0) return;
  const { error: insertError } = await supabase.from("cme_allocations").insert(
    prior.map((allocation) => ({
      owner_id: ownerId,
      entry_id: entryId,
      category: allocation.category,
      hours: allocation.hours,
    })),
  );
  if (insertError) throw new Error(insertError.message);
}

/** Archive/restore is atomic and retains allocations, sources and evidence. */
export async function setCmeEntryArchived(
  supabase: AdminClient,
  ownerId: string,
  entryId: string,
  archived: boolean,
): Promise<CmeEntry> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { data, error } = await supabase.rpc("cme_set_entry_archived", {
    p_owner_id: ownerId,
    p_entry_id: entryId,
    p_archived: archived,
  });
  if (error) throw cmeRepositoryError(error);
  return joinedEntry(data as Record<string, unknown>);
}

/**
 * Close one CPD year: the database freezes a snapshot of the record under the owner lock and
 * sets `closed_at` in the same transaction. `evaluation` must agree with the rows on total
 * hours and activity count, or nothing is written (`cme_close_conflict`).
 */
export async function closeCmeYear(
  supabase: AdminClient,
  ownerId: string,
  yearId: string,
  evaluation: CmeCloseEvaluation,
  shortfallNote: string | null,
): Promise<void> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { error } = await supabase.rpc("cme_close_year", {
    p_owner_id: ownerId,
    p_year_id: yearId,
    p_evaluation: JSON.parse(JSON.stringify(evaluation)) as Json,
    p_shortfall_note: shortfallNote,
  });
  if (error) throw cmeRepositoryError(error);
}

/**
 * Amend one activity in a closed year. The database records the previous version, the new
 * one and the reason, dated, before applying the change; the closing snapshot is untouched.
 */
export async function amendClosedCmeEntry(
  supabase: AdminClient,
  ownerId: string,
  entry: CmeEntry,
  reason: string,
): Promise<CmeEntry> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const parsed = cmeEntryCreateSchema.safeParse(entry);
  if (!parsed.success) throw new PublicApiError("Invalid CPD entry details or allocations.", 400);
  const { data, error } = await supabase.rpc("cme_amend_closed_entry", {
    p_owner_id: ownerId,
    p_entry_id: entry.id,
    p_entry: { ...parsed.data, formalPeerReviewHours: entry.formalPeerReviewHours ?? 0 } as Json,
    p_reason: reason,
  });
  if (error) throw cmeRepositoryError(error);
  return joinedEntry(data as Record<string, unknown>);
}

/** The closing snapshot and amendment history for one closed year, or `null` if it has none. */
export async function fetchOwnerCmeYearClose(
  supabase: AdminClient,
  ownerId: string,
  yearId: string,
): Promise<CmeYearClose | null> {
  if (!ownerId) throw new Error("Missing CME owner.");
  const { data: snapshot, error: snapshotError } = await supabase
    .from("cme_year_snapshots")
    .select("closed_at, shortfall_note, total_hours, target_hours, record, evaluation")
    .eq("owner_id", ownerId)
    .eq("year_id", yearId)
    .maybeSingle();
  if (snapshotError) throw cmeRepositoryError(snapshotError);
  if (!snapshot) return null;
  const { data: amendments, error: amendmentError } = await supabase
    .from("cme_year_amendments")
    .select("id, entry_id, amended_at, reason, before, after")
    .eq("owner_id", ownerId)
    .eq("year_id", yearId)
    .order("amended_at", { ascending: true })
    .limit(CME_MAX_ENTRIES);
  if (amendmentError) throw cmeRepositoryError(amendmentError);
  return rowsToCmeYearClose(snapshot, amendments ?? []);
}
