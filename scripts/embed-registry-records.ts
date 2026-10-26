import { loadEnvConfig } from "@next/env";

import { confirm } from "./cli-utils";
import type { DifferentialRecordRow } from "@/lib/differential-records";
import type { MedicationRecordRow } from "@/lib/medication-records";
import type { RegistryRecordKind, RegistryRecordRow } from "@/lib/registry-records";

loadEnvConfig(process.cwd());

type EmbedKind = RegistryRecordKind | "medication" | "differential" | "all";

type Args = {
  ownerId?: string;
  kind: EmbedKind;
  slug?: string;
  write: boolean;
  confirmed: boolean;
  listOwners: boolean;
};

/** Parse args. */
function parseArgs(argv: string[]): Args {
  const args: Args = {
    ownerId: process.env.LOCAL_NO_AUTH_OWNER_ID,
    kind: "all",
    write: false,
    confirmed: false,
    listOwners: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--list-owners") {
      args.listOwners = true;
      continue;
    }
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--confirm") {
      args.confirmed = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    if (token === "--owner-id") args.ownerId = value;
    else if (token === "--slug") args.slug = value;
    else if (token === "--kind") {
      if (!["service", "form", "medication", "differential", "all"].includes(value)) {
        throw new Error("--kind must be service, form, medication, differential, or all.");
      }
      args.kind = value as EmbedKind;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
    index += 1;
  }

  return args;
}

/** Load admin client. */
async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/** Registry kinds. */
function registryKinds(kind: EmbedKind): RegistryRecordKind[] {
  if (kind === "all") return ["service", "form"];
  if (kind === "service" || kind === "form") return [kind];
  return [];
}

/**
 * Every row a query matches. One PostgREST response stops at the project's row cap (1000 by
 * default), so an unpaged read silently skips records once a table outgrows it.
 */
async function readAllPages<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  what: string,
): Promise<Row[]> {
  const pageSize = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < pageSize) return rows;
  }
}

/** Load registry rows. */
async function loadRegistryRows(supabase: Awaited<ReturnType<typeof loadAdminClient>>, args: Args, ownerId: string) {
  const kinds = registryKinds(args.kind);
  if (kinds.length === 0) return [] as RegistryRecordRow[];
  const page = (from: number, to: number) => {
    let query = supabase.from("clinical_registry_records").select("*").eq("owner_id", ownerId).in("kind", kinds);
    if (args.slug) query = query.eq("slug", args.slug);
    return query.order("kind").order("title").order("id").range(from, to);
  };
  return readAllPages<RegistryRecordRow>(page, "registry records");
}

/** Load medication rows. */
async function loadMedicationRows(supabase: Awaited<ReturnType<typeof loadAdminClient>>, args: Args, ownerId: string) {
  if (args.kind !== "all" && args.kind !== "medication") return [] as MedicationRecordRow[];
  const page = (from: number, to: number) => {
    let query = supabase.from("medication_records").select("*").eq("owner_id", ownerId);
    if (args.slug) query = query.eq("slug", args.slug);
    return query.order("name").order("id").range(from, to);
  };
  return readAllPages<MedicationRecordRow>(page, "medication records");
}

/** Load differential rows. */
async function loadDifferentialRows(
  supabase: Awaited<ReturnType<typeof loadAdminClient>>,
  args: Args,
  ownerId: string,
) {
  if (args.kind !== "all" && args.kind !== "differential") return [] as DifferentialRecordRow[];
  const page = (from: number, to: number) => {
    let query = supabase.from("differential_records").select("*").eq("owner_id", ownerId);
    if (args.slug) query = query.eq("slug", args.slug);
    return query.order("kind").order("title").order("id").range(from, to);
  };
  return readAllPages<DifferentialRecordRow>(page, "differential records");
}

type OwnerCounts = {
  ownerId: string;
  service: number;
  form: number;
  medication: number;
  differential: number;
};

/** Ensure owner count. */
function ensureOwnerCount(counts: Map<string, OwnerCounts>, ownerId: string) {
  let count = counts.get(ownerId);
  if (!count) {
    count = { ownerId, service: 0, form: 0, medication: 0, differential: 0 };
    counts.set(ownerId, count);
  }
  return count;
}

/** List eligible owner counts. */
async function listEligibleOwnerCounts(supabase: Awaited<ReturnType<typeof loadAdminClient>>) {
  const counts = new Map<string, OwnerCounts>();

  // Page through registry records
  let registryOffset = 0;
  const pageSize = 1000;
  while (true) {
    const { data: registryRows, error: registryError } = await supabase
      .from("clinical_registry_records")
      .select("owner_id, kind")
      .range(registryOffset, registryOffset + pageSize - 1);
    if (registryError) throw new Error(`Could not load registry owner counts: ${registryError.message}`);
    if (!registryRows || registryRows.length === 0) break;
    for (const row of registryRows) {
      const ownerId = typeof row.owner_id === "string" ? row.owner_id : null;
      if (!ownerId) continue;
      const count = ensureOwnerCount(counts, ownerId);
      if (row.kind === "form") count.form += 1;
      else count.service += 1;
    }
    if (registryRows.length < pageSize) break;
    registryOffset += pageSize;
  }

  // Page through medication records
  let medicationOffset = 0;
  while (true) {
    const { data: medicationRows, error: medicationError } = await supabase
      .from("medication_records")
      .select("owner_id")
      .range(medicationOffset, medicationOffset + pageSize - 1);
    if (medicationError) throw new Error(`Could not load medication owner counts: ${medicationError.message}`);
    if (!medicationRows || medicationRows.length === 0) break;
    for (const row of medicationRows) {
      const ownerId = typeof row.owner_id === "string" ? row.owner_id : null;
      if (!ownerId) continue;
      ensureOwnerCount(counts, ownerId).medication += 1;
    }
    if (medicationRows.length < pageSize) break;
    medicationOffset += pageSize;
  }

  // Page through differential records
  let differentialOffset = 0;
  while (true) {
    const { data: differentialRows, error: differentialError } = await supabase
      .from("differential_records")
      .select("owner_id")
      .range(differentialOffset, differentialOffset + pageSize - 1);
    if (differentialError) throw new Error(`Could not load differential owner counts: ${differentialError.message}`);
    if (!differentialRows || differentialRows.length === 0) break;
    for (const row of differentialRows) {
      const ownerId = typeof row.owner_id === "string" ? row.owner_id : null;
      if (!ownerId) continue;
      ensureOwnerCount(counts, ownerId).differential += 1;
    }
    if (differentialRows.length < pageSize) break;
    differentialOffset += pageSize;
  }

  return [...counts.values()].sort((left, right) => {
    const leftTotal = left.service + left.form + left.medication + left.differential;
    const rightTotal = right.service + right.form + right.medication + right.differential;
    return rightTotal - leftTotal || left.ownerId.localeCompare(right.ownerId);
  });
}

/** Main. */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = await loadAdminClient();

  if (args.listOwners) {
    const ownerCounts = await listEligibleOwnerCounts(supabase);
    console.log("[registry:embed] eligible owner counts");
    if (ownerCounts.length === 0) {
      console.log("  No registry, medication, or differential rows found.");
      return;
    }
    for (const count of ownerCounts) {
      const total = count.service + count.form + count.medication + count.differential;
      console.log(
        `  ${count.ownerId} total=${total} service=${count.service} form=${count.form} medication=${count.medication} differential=${count.differential}`,
      );
    }
    return;
  }

  const ownerId = args.ownerId;
  if (!ownerId) throw new Error("No owner id. Pass --owner-id <uuid>, --list-owners, or set LOCAL_NO_AUTH_OWNER_ID.");

  const {
    clinicalRegistryRowsToCorpusEntries,
    differentialRowsToCorpusEntries,
    embedClinicalRegistryRows,
    embedDifferentialRows,
    embedMedicationRows,
    medicationRowsToCorpusEntries,
    registryCorpusEmbeddingEnabled,
  } = await import("@/lib/registry-corpus");

  const [registryRows, medicationRows, differentialRows] = await Promise.all([
    loadRegistryRows(supabase, args, ownerId),
    loadMedicationRows(supabase, args, ownerId),
    loadDifferentialRows(supabase, args, ownerId),
  ]);
  const registryEntries = clinicalRegistryRowsToCorpusEntries(registryRows);
  const medicationEntries = medicationRowsToCorpusEntries(medicationRows);
  const differentialEntries = differentialRowsToCorpusEntries(differentialRows);
  const total = registryEntries.length + medicationEntries.length + differentialEntries.length;

  console.log(`[registry:embed] owner ${ownerId}`);
  console.log(
    `[registry:embed] loaded ${registryEntries.length} service/form, ${medicationEntries.length} medication, ${differentialEntries.length} differential entr${total === 1 ? "y" : "ies"}`,
  );
  for (const entry of [...registryEntries, ...medicationEntries, ...differentialEntries].slice(0, 20)) {
    console.log(`  ${entry.kind.padEnd(12)} ${entry.slug.padEnd(42)} ${entry.title}`);
  }
  if (total > 20) console.log(`  ... ${total - 20} more`);

  if (!args.write) {
    if (total === 0) {
      console.log(
        "[registry:embed] No eligible rows found for this owner. Re-run with --list-owners to find owners with registry rows.",
      );
    }
    console.log(
      "[registry:embed] Dry run. Re-run with --write --confirm and RAG_REGISTRY_CORPUS_EMBEDDING=true to write embeddings.",
    );
    return;
  }
  if (!registryCorpusEmbeddingEnabled()) {
    throw new Error("Refusing to write registry corpus embeddings unless RAG_REGISTRY_CORPUS_EMBEDDING=true.");
  }
  if (!args.confirmed) {
    const proceed = await confirm(`Embed and upsert ${total} registry corpus entr${total === 1 ? "y" : "ies"}?`);
    if (!proceed) {
      console.log("[registry:embed] Aborted.");
      return;
    }
  }

  const registryResult = await embedClinicalRegistryRows(supabase, registryRows);
  const medicationResult = await embedMedicationRows(supabase, medicationRows);
  const differentialResult = await embedDifferentialRows(supabase, differentialRows);
  const chunkCount = registryResult.chunkCount + medicationResult.chunkCount + differentialResult.chunkCount;
  console.log(`[registry:embed] Done. Upserted ${chunkCount} registry corpus chunk(s).`);
}

main().catch((error) => {
  console.error(`[registry:embed] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
