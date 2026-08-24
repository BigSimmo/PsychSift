import { buildDefaultDifferentialRows, loadDifferentialSnapshot } from "@/lib/differential-fixtures";
import { type DifferentialRecordRow } from "@/lib/differential-records";
import { safeErrorLogDetails } from "@/lib/privacy";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

export { loadDifferentialSnapshot } from "@/lib/differential-fixtures";

export async function ensureDifferentialsSeeded(
  supabase: AdminClient,
  ownerId: string,
): Promise<DifferentialRecordRow[]> {
  const rows = buildDefaultDifferentialRows(ownerId);
  const { data, error } = await supabase
    .from("differential_records")
    .upsert(rows, { onConflict: "owner_id,kind,slug" })
    .select("*");
  if (error) throw new Error(`Differential seed failed: ${error.message}`);
  return (data ?? []) as DifferentialRecordRow[];
}

export async function fetchOwnerDifferentialRowsWithSeed(
  supabase: AdminClient,
  ownerId: string,
  kind: DifferentialRecordRow["kind"],
  maxRecords = 500,
): Promise<DifferentialRecordRow[]> {
  const fetchRecords = async () => {
    const { data, error } = await supabase
      .from("differential_records")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("kind", kind)
      .order("title")
      .limit(maxRecords);
    if (error) throw new Error(error.message);
    return (data ?? []) as DifferentialRecordRow[];
  };

  let rows = await fetchRecords();
  if (rows.length === 0) {
    let seedError: unknown = null;
    try {
      await ensureDifferentialsSeeded(supabase, ownerId);
    } catch (error) {
      seedError = error;
      console.error("[differentials] auto-seed failed", safeErrorLogDetails(error));
    }
    rows = await fetchRecords();
    if (rows.length === 0 && seedError) throw seedError;
  }
  return rows;
}

/** Seeded presentation rows whose slug the current snapshot no longer produces.
 *  Retitling the trap-tables appendix changed its slug ("urgency-urgent" ->
 *  "focused-diagnostic-trap-tables"); seeding upserts by slug and never
 *  deletes, so the old slug lingers for already-seeded owners until pruned.
 *  Diagnoses are deliberately not pruned: their slugs merge and churn across
 *  snapshot versions, so set-difference pruning would be unsafe there. */
export function staleSeededPresentations<Row extends { kind: string; slug: string }>(rows: Row[]): Row[] {
  const validSlugs = new Set(loadDifferentialSnapshot().presentations.map((presentation) => presentation.id));
  return rows.filter((row) => row.kind === "presentation" && !validSlugs.has(row.slug));
}
