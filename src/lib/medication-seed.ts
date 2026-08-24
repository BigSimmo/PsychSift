import { buildDefaultMedicationRows, defaultMedicationRecords } from "@/lib/medication-fixtures";
import { type MedicationRecordInsert, type MedicationRecordRow } from "@/lib/medication-records";
import { invalidateOwnerCatalogueCache } from "@/lib/owner-catalogue-cache";
import { safeErrorLogDetails } from "@/lib/privacy";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

type OwnerMedicationFetchOptions = {
  signal?: AbortSignal;
  select?: string;
};

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

export function buildMedicationSeedRows(ownerId: string): MedicationRecordInsert[] {
  return buildDefaultMedicationRows(ownerId);
}

export async function ensureMedicationsSeeded(
  supabase: AdminClient,
  ownerId: string,
  options: Pick<OwnerMedicationFetchOptions, "signal"> = {},
): Promise<MedicationRecordRow[]> {
  const rows = buildMedicationSeedRows(ownerId);
  let query = supabase.from("medication_records").upsert(rows, { onConflict: "owner_id,slug" }).select("*");
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw new Error(`Medication seed failed: ${error.message}`);
  invalidateOwnerCatalogueCache({ ownerId, kind: "medication", preserveSignal: options.signal });
  throwIfAborted(options.signal);
  return (data ?? []) as MedicationRecordRow[];
}

export { defaultMedicationRecords };

/**
 * Fetch an owner's medication rows, lazily seeding the curated defaults on the
 * first visit (extracted from /api/medications so the route and universal
 * search share one code path). Seed write is best-effort; re-read is not.
 */
export async function fetchOwnerMedicationRowsWithSeed(
  supabase: AdminClient,
  ownerId: string,
  maxRecords = 500,
  options: OwnerMedicationFetchOptions = {},
): Promise<MedicationRecordRow[]> {
  const fetchRecords = async () => {
    let query = supabase
      .from("medication_records")
      .select(options.select ?? "*")
      .eq("owner_id", ownerId)
      .order("name")
      .limit(maxRecords);
    if (options.signal) query = query.abortSignal(options.signal);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    throwIfAborted(options.signal);
    // The optional projection is intentionally narrower than the generated
    // table Row type; callers map only the fields they requested.
    return (data ?? []) as unknown as MedicationRecordRow[];
  };

  let rows = await fetchRecords();
  if (rows.length === 0) {
    let seedError: unknown = null;
    try {
      await ensureMedicationsSeeded(supabase, ownerId, { signal: options.signal });
    } catch (error) {
      seedError = error;
      console.error("[medications] auto-seed failed", safeErrorLogDetails(error));
    }
    rows = await fetchRecords();
    if (rows.length === 0 && seedError) throw seedError;
  }
  return rows;
}
