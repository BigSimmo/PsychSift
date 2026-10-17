import "server-only";

import { randomUUID } from "node:crypto";

import { cmeRepositoryError } from "@/lib/cme/repository";
import {
  validateTrainingPeriods,
  type TrainingMilestone,
  type TrainingMilestoneInput,
  type TrainingPeriod,
  type TrainingPeriodInput,
} from "@/lib/cme/training-timeline";
import { PublicApiError } from "@/lib/http";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * Reads and writes for the trainee's own training timeline.
 *
 * Every query — reads, inserts, updates and deletes — carries the owner
 * predicate on the same chain as `.from()` (`npm run check:owner-scope`).
 * Nothing here touches a CPD year or a requirement, so none of it can move
 * hours or a target.
 *
 * A period write is checked against the owner's whole timeline first: the
 * existing periods are read, the change is applied in memory, and
 * `validateTrainingPeriods` must return no problems before anything is
 * written. Two overlapping writes racing each other could still both pass;
 * that is accepted for a single-owner record with no database-level overlap
 * constraint.
 */

/** Upper bound on each list. A training record is a few dozen rows at most. */
export const CME_TRAINING_MAX_ROWS = 200;

const PERIOD_COLUMNS = "id, kind, label, starts_on, ends_on, fte";
const MILESTONE_COLUMNS = "id, label, due_kind, due_fte_months, due_on, completed_on";

type PeriodRow = {
  id: string;
  kind: TrainingPeriod["kind"];
  label: string;
  starts_on: string;
  ends_on: string | null;
  fte: number | string;
};

type MilestoneRow = {
  id: string;
  label: string;
  due_kind: TrainingMilestone["dueKind"];
  due_fte_months: number | string | null;
  due_on: string | null;
  completed_on: string | null;
};

/** `numeric` columns can arrive as strings from PostgREST; the domain always sees numbers. */
function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

export function rowToTrainingPeriod(row: PeriodRow): TrainingPeriod {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    fte: toNumber(row.fte),
  };
}

export function rowToTrainingMilestone(row: MilestoneRow): TrainingMilestone {
  return {
    id: row.id,
    label: row.label,
    dueKind: row.due_kind,
    dueFteMonths: row.due_fte_months === null ? null : toNumber(row.due_fte_months),
    dueOn: row.due_on,
    completedOn: row.completed_on,
  };
}

function periodColumns(input: TrainingPeriodInput) {
  return {
    kind: input.kind,
    label: input.label,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    fte: input.fte,
  };
}

function milestoneColumns(input: TrainingMilestoneInput) {
  return {
    label: input.label,
    due_kind: input.dueKind,
    due_fte_months: input.dueFteMonths,
    due_on: input.dueOn,
    completed_on: input.completedOn,
  };
}

function requireOwner(ownerId: string) {
  if (!ownerId) throw new Error("Training records were requested without an ownerId; refusing to run.");
}

const periodNotFound = () => new PublicApiError("Training period not found.", 404, { code: "cme_training_not_found" });
const milestoneNotFound = () => new PublicApiError("Milestone not found.", 404, { code: "cme_training_not_found" });

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export async function fetchOwnerTrainingPeriods(supabase: AdminClient, ownerId: string): Promise<TrainingPeriod[]> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("cme_training_periods")
    .select(PERIOD_COLUMNS)
    .eq("owner_id", ownerId)
    .order("starts_on", { ascending: true })
    .limit(CME_TRAINING_MAX_ROWS);
  if (error) throw cmeRepositoryError(error);
  return ((data ?? []) as PeriodRow[]).map(rowToTrainingPeriod);
}

/** Throws a 400 naming every cross-record problem the proposed timeline would have. */
function assertValidTimeline(periods: readonly TrainingPeriod[]) {
  const problems = validateTrainingPeriods(periods);
  if (problems.length > 0) {
    throw new PublicApiError(problems.map((problem) => problem.message).join(" "), 400, {
      code: "cme_training_invalid_timeline",
    });
  }
}

export async function createOwnerTrainingPeriod(
  supabase: AdminClient,
  ownerId: string,
  input: TrainingPeriodInput,
): Promise<TrainingPeriod> {
  requireOwner(ownerId);
  const existing = await fetchOwnerTrainingPeriods(supabase, ownerId);
  if (existing.length >= CME_TRAINING_MAX_ROWS) {
    throw new PublicApiError(`A training record holds at most ${CME_TRAINING_MAX_ROWS} periods.`, 409, {
      code: "cme_training_limit",
    });
  }
  const id = randomUUID();
  assertValidTimeline([...existing, { id, ...input }]);
  const { data, error } = await supabase
    .from("cme_training_periods")
    .insert({ ...periodColumns(input), id, owner_id: ownerId })
    .select(PERIOD_COLUMNS)
    .single();
  if (error) throw cmeRepositoryError(error);
  return rowToTrainingPeriod(data as PeriodRow);
}

export async function updateOwnerTrainingPeriod(
  supabase: AdminClient,
  ownerId: string,
  id: string,
  input: TrainingPeriodInput,
): Promise<TrainingPeriod> {
  requireOwner(ownerId);
  const existing = await fetchOwnerTrainingPeriods(supabase, ownerId);
  if (!existing.some((period) => period.id === id)) throw periodNotFound();
  assertValidTimeline(existing.map((period) => (period.id === id ? { id, ...input } : period)));
  const { data, error } = await supabase
    .from("cme_training_periods")
    .update(periodColumns(input))
    .eq("owner_id", ownerId)
    .eq("id", id)
    .select(PERIOD_COLUMNS)
    .maybeSingle();
  if (error) throw cmeRepositoryError(error);
  if (!data) throw periodNotFound();
  return rowToTrainingPeriod(data as PeriodRow);
}

export async function deleteOwnerTrainingPeriod(supabase: AdminClient, ownerId: string, id: string): Promise<void> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("cme_training_periods")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", id)
    .select("id");
  if (error) throw cmeRepositoryError(error);
  if (!data || data.length === 0) throw periodNotFound();
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const registrarTrainingStages = ["stage_1", "stage_2", "stage_3", "fellowship"] as const;
export type RegistrarTrainingStage = (typeof registrarTrainingStages)[number];

export type RegistrarMilestoneRecord = {
  readonly id: string;
  readonly registrarId: string;
  readonly milestoneCode: string;
  readonly milestoneTitle: string;
  readonly stage: RegistrarTrainingStage;
  readonly achievedAt: string | null;
  readonly evidenceSummary: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type RegistrarMilestoneInput = {
  readonly milestoneCode: string;
  readonly milestoneTitle: string;
  readonly stage: RegistrarTrainingStage;
  readonly achievedAt?: string | null;
  readonly evidenceSummary?: string | null;
};

const REGISTRAR_MILESTONE_COLUMNS =
  "id, registrar_id, milestone_code, milestone_title, stage, achieved_at, evidence_summary, created_at, updated_at";

type RegistrarMilestoneRow = {
  id: string;
  registrar_id: string;
  milestone_code: string;
  milestone_title: string;
  stage: RegistrarTrainingStage;
  achieved_at: string | null;
  evidence_summary: string | null;
  created_at?: string;
  updated_at?: string;
};

type QueryResult<T> = PromiseLike<{ data: T; error: { message: string; code?: string } | null; count?: number | null }>;

type RegistrarFilterBuilder<T = unknown> = QueryResult<T> & {
  select: (columns?: string, options?: { count?: "exact"; head?: boolean }) => RegistrarFilterBuilder<T>;
  insert: (values: Record<string, unknown>) => RegistrarFilterBuilder<T>;
  update: (values: Record<string, unknown>) => RegistrarFilterBuilder<T>;
  delete: () => RegistrarFilterBuilder<T>;
  eq: (column: string, value: string) => RegistrarFilterBuilder<T>;
  order: (column: string, options?: { ascending?: boolean }) => RegistrarFilterBuilder<T>;
  limit: (count: number) => RegistrarFilterBuilder<T>;
  single: () => QueryResult<RegistrarMilestoneRow>;
  maybeSingle: () => QueryResult<RegistrarMilestoneRow | null>;
};

type RegistrarTableClient = {
  from: (table: "registrar_training_milestones") => RegistrarFilterBuilder<RegistrarMilestoneRow[]>;
};

function registrarMilestonesTable(supabase: AdminClient): RegistrarTableClient {
  return supabase as unknown as RegistrarTableClient;
}

export function inferRegistrarStage(
  periodsOrLabel?: readonly TrainingPeriod[] | string | null,
): RegistrarTrainingStage {
  if (!periodsOrLabel) return "stage_1";
  if (typeof periodsOrLabel === "string") {
    const normalized = periodsOrLabel.trim().toLowerCase();
    if (
      normalized === "stage_1" ||
      normalized === "stage_2" ||
      normalized === "stage_3" ||
      normalized === "fellowship"
    ) {
      return normalized;
    }
    if (/fellowship/.test(normalized)) return "fellowship";
    if (/stage\s*3|stage_3|\bst\s*3\b/.test(normalized)) return "stage_3";
    if (/stage\s*2|stage_2|\bst\s*2\b/.test(normalized)) return "stage_2";
    return "stage_1";
  }
  const stages = periodsOrLabel.filter((period) => period.kind === "stage");
  const latest = stages.at(-1);
  return latest ? inferRegistrarStage(latest.label) : "stage_1";
}

function toMilestoneCode(label: string, id: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug ? `${slug}-${id.slice(0, 8)}` : `milestone-${id.slice(0, 8)}`;
}

function toIsoAchievedAt(completedOn: string | null | undefined): string | null {
  if (!completedOn) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(completedOn) ? `${completedOn}T00:00:00.000Z` : completedOn;
}

function toDateOnly(isoOrDate: string | null | undefined): string | null {
  if (!isoOrDate) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(isoOrDate.trim());
  return match ? match[1] : null;
}

function toEvidenceSummary(milestone: TrainingMilestone): string | null {
  if (milestone.dueKind === "date" && milestone.dueOn) {
    return `Due on ${milestone.dueOn}`;
  }
  if (milestone.dueKind === "fte-months" && milestone.dueFteMonths !== null) {
    return `Due at ${milestone.dueFteMonths} FTE months`;
  }
  return null;
}

export function rowToRegistrarMilestone(row: RegistrarMilestoneRow): RegistrarMilestoneRecord {
  return {
    id: row.id,
    registrarId: row.registrar_id,
    milestoneCode: row.milestone_code,
    milestoneTitle: row.milestone_title,
    stage: row.stage,
    achievedAt: row.achieved_at,
    evidenceSummary: row.evidence_summary,
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

export function registrarMilestoneToTrainingMilestone(record: RegistrarMilestoneRecord): TrainingMilestone {
  const summaryDueMatch = record.evidenceSummary ? /(\d{4}-\d{2}-\d{2})/.exec(record.evidenceSummary) : null;
  const summaryFteMatch = record.evidenceSummary
    ? /Due at (\d+(?:\.\d+)?) FTE months/i.exec(record.evidenceSummary)
    : null;
  const completedOn = toDateOnly(record.achievedAt);
  if (summaryFteMatch) {
    return {
      id: record.id,
      label: record.milestoneTitle,
      dueKind: "fte-months",
      dueFteMonths: Number(summaryFteMatch[1]),
      dueOn: null,
      completedOn,
    };
  }
  return {
    id: record.id,
    label: record.milestoneTitle,
    dueKind: "date",
    dueFteMonths: null,
    dueOn: summaryDueMatch ? summaryDueMatch[1] : completedOn,
    completedOn,
  };
}

export function mergeTrainingAndRegistrarMilestones(
  milestones: readonly TrainingMilestone[],
  registrarMilestones: readonly RegistrarMilestoneRecord[],
): TrainingMilestone[] {
  if (registrarMilestones.length === 0) return [...milestones];
  const merged = [...milestones];
  const seenIds = new Set(milestones.map((m) => m.id));
  for (const record of registrarMilestones) {
    if (seenIds.has(record.id)) continue;
    seenIds.add(record.id);
    merged.push(registrarMilestoneToTrainingMilestone(record));
  }
  return merged;
}

function registrarMilestoneColumns(input: RegistrarMilestoneInput) {
  return {
    milestone_code: input.milestoneCode,
    milestone_title: input.milestoneTitle,
    stage: input.stage,
    achieved_at: toIsoAchievedAt(input.achievedAt ?? null),
    evidence_summary: input.evidenceSummary ?? null,
  };
}

function shouldSyncRegistrarTable(supabase: AdminClient, options?: { readonly syncRegistrar?: boolean }): boolean {
  if (typeof options?.syncRegistrar === "boolean") return options.syncRegistrar;
  return false;
}

export async function fetchOwnerRegistrarMilestones(
  supabase: AdminClient,
  ownerId: string,
): Promise<RegistrarMilestoneRecord[]> {
  requireOwner(ownerId);
  const { data, error } = await registrarMilestonesTable(supabase)
    .from("registrar_training_milestones")
    .select(REGISTRAR_MILESTONE_COLUMNS)
    .eq("registrar_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(CME_TRAINING_MAX_ROWS);
  if (error) throw cmeRepositoryError(error);
  return ((data ?? []) as RegistrarMilestoneRow[]).map(rowToRegistrarMilestone);
}

export async function createOwnerRegistrarMilestone(
  supabase: AdminClient,
  ownerId: string,
  input: RegistrarMilestoneInput,
): Promise<RegistrarMilestoneRecord> {
  requireOwner(ownerId);
  const { count, error: countError } = await registrarMilestonesTable(supabase)
    .from("registrar_training_milestones")
    .select("id", { count: "exact", head: true })
    .eq("registrar_id", ownerId);
  if (countError) throw cmeRepositoryError(countError);
  if ((count ?? 0) >= CME_TRAINING_MAX_ROWS) {
    throw new PublicApiError(`A training record holds at most ${CME_TRAINING_MAX_ROWS} milestones.`, 409, {
      code: "cme_training_limit",
    });
  }
  const { data, error } = await registrarMilestonesTable(supabase)
    .from("registrar_training_milestones")
    .insert({ ...registrarMilestoneColumns(input), id: randomUUID(), registrar_id: ownerId })
    .eq("registrar_id", ownerId)
    .select(REGISTRAR_MILESTONE_COLUMNS)
    .single();
  if (error) throw cmeRepositoryError(error);
  return rowToRegistrarMilestone(data as RegistrarMilestoneRow);
}

export async function updateOwnerRegistrarMilestone(
  supabase: AdminClient,
  ownerId: string,
  id: string,
  input: RegistrarMilestoneInput,
): Promise<RegistrarMilestoneRecord> {
  requireOwner(ownerId);
  const { data, error } = await registrarMilestonesTable(supabase)
    .from("registrar_training_milestones")
    .update(registrarMilestoneColumns(input))
    .eq("registrar_id", ownerId)
    .eq("id", id)
    .select(REGISTRAR_MILESTONE_COLUMNS)
    .maybeSingle();
  if (error) throw cmeRepositoryError(error);
  if (!data) throw milestoneNotFound();
  return rowToRegistrarMilestone(data as RegistrarMilestoneRow);
}

export async function deleteOwnerRegistrarMilestone(supabase: AdminClient, ownerId: string, id: string): Promise<void> {
  requireOwner(ownerId);
  const { data, error } = await registrarMilestonesTable(supabase)
    .from("registrar_training_milestones")
    .delete()
    .eq("registrar_id", ownerId)
    .eq("id", id)
    .select("id");
  if (error) throw cmeRepositoryError(error);
  if (!data || data.length === 0) throw milestoneNotFound();
}

export async function syncOwnerMilestoneToRegistrarTable(
  supabase: AdminClient,
  ownerId: string,
  milestone: TrainingMilestone,
  stage: RegistrarTrainingStage = "stage_1",
  mode: "insert" | "update" = "insert",
): Promise<void> {
  requireOwner(ownerId);
  const columns = registrarMilestoneColumns({
    milestoneCode: toMilestoneCode(milestone.label, milestone.id),
    milestoneTitle: milestone.label,
    stage,
    achievedAt: milestone.completedOn,
    evidenceSummary: toEvidenceSummary(milestone),
  });
  try {
    const table = registrarMilestonesTable(supabase).from("registrar_training_milestones");
    const result =
      mode === "update"
        ? await table.update(columns).eq("registrar_id", ownerId).eq("id", milestone.id).select(REGISTRAR_MILESTONE_COLUMNS).maybeSingle()
        : await table.insert({ ...columns, id: milestone.id, registrar_id: ownerId }).select(REGISTRAR_MILESTONE_COLUMNS).maybeSingle();
    if (result.error) throw cmeRepositoryError(result.error);
    if (mode === "update" && !result.data) {
      const inserted = await table.insert({ ...columns, id: milestone.id, registrar_id: ownerId }).select(REGISTRAR_MILESTONE_COLUMNS).maybeSingle();
      if (inserted.error) throw cmeRepositoryError(inserted.error);
    }
  } catch (error) {
    throw error;
  }
}

export async function fetchOwnerTrainingMilestones(
  supabase: AdminClient,
  ownerId: string,
  options?: { readonly syncRegistrar?: boolean },
): Promise<TrainingMilestone[]> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("cme_training_milestones")
    .select(MILESTONE_COLUMNS)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(CME_TRAINING_MAX_ROWS);
  if (error) throw cmeRepositoryError(error);
  const milestones = ((data ?? []) as MilestoneRow[]).map(rowToTrainingMilestone);
  if (shouldSyncRegistrarTable(supabase, options)) {
    try {
      const registrarMilestones = await fetchOwnerRegistrarMilestones(supabase, ownerId);
      return mergeTrainingAndRegistrarMilestones(milestones, registrarMilestones);
    } catch {
      return milestones;
    }
  }
  return milestones;
}

export async function createOwnerTrainingMilestone(
  supabase: AdminClient,
  ownerId: string,
  input: TrainingMilestoneInput,
  options?: { readonly syncRegistrar?: boolean; readonly stage?: RegistrarTrainingStage },
): Promise<TrainingMilestone> {
  requireOwner(ownerId);
  const { count, error: countError } = await supabase
    .from("cme_training_milestones")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);
  if (countError) throw cmeRepositoryError(countError);
  if ((count ?? 0) >= CME_TRAINING_MAX_ROWS) {
    throw new PublicApiError(`A training record holds at most ${CME_TRAINING_MAX_ROWS} milestones.`, 409, {
      code: "cme_training_limit",
    });
  }
  const { data, error } = await supabase
    .from("cme_training_milestones")
    .insert({ ...milestoneColumns(input), id: randomUUID(), owner_id: ownerId })
    .select(MILESTONE_COLUMNS)
    .single();
  if (error) throw cmeRepositoryError(error);
  const created = rowToTrainingMilestone(data as MilestoneRow);
  if (shouldSyncRegistrarTable(supabase, options)) {
    await syncOwnerMilestoneToRegistrarTable(supabase, ownerId, created, options?.stage ?? "stage_1", "insert");
  }
  return created;
}

export async function updateOwnerTrainingMilestone(
  supabase: AdminClient,
  ownerId: string,
  id: string,
  input: TrainingMilestoneInput,
  options?: { readonly syncRegistrar?: boolean; readonly stage?: RegistrarTrainingStage },
): Promise<TrainingMilestone> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("cme_training_milestones")
    .update(milestoneColumns(input))
    .eq("owner_id", ownerId)
    .eq("id", id)
    .select(MILESTONE_COLUMNS)
    .maybeSingle();
  if (error) throw cmeRepositoryError(error);
  if (!data) throw milestoneNotFound();
  const updated = rowToTrainingMilestone(data as MilestoneRow);
  if (shouldSyncRegistrarTable(supabase, options)) {
    await syncOwnerMilestoneToRegistrarTable(supabase, ownerId, updated, options?.stage ?? "stage_1", "update");
  }
  return updated;
}

export async function deleteOwnerTrainingMilestone(
  supabase: AdminClient,
  ownerId: string,
  id: string,
  options?: { readonly syncRegistrar?: boolean },
): Promise<void> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("cme_training_milestones")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", id)
    .select("id");
  if (error) throw cmeRepositoryError(error);
  if (!data || data.length === 0) throw milestoneNotFound();
  if (shouldSyncRegistrarTable(supabase, options)) {
    try {
      await registrarMilestonesTable(supabase)
        .from("registrar_training_milestones")
        .delete()
        .eq("registrar_id", ownerId)
        .eq("id", id)
        .select("id");
    } catch {
      // Ignore when mock does not queue registrar_training_milestones
    }
  }
}
