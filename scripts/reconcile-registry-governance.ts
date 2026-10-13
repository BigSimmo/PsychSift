import { loadEnvConfig } from "@next/env";

import type { DifferentialRecordRow } from "@/lib/differential-records";
import type { MedicationRecordRow } from "@/lib/medication-records";
import type { RegistryRecordRow } from "@/lib/registry-records";
import { mergeRegistryGeneratedLabelMetadata } from "@/lib/registry-corpus";
import type { Json, TablesInsert } from "@/lib/supabase/database.types";
import type { RegistryCorpusKind, RegistryGovernanceProjection } from "@/lib/registry-corpus";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

loadEnvConfig(process.cwd());

const PRODUCTION_PROJECT_REF = "sjrfecxgysukkwxsowpy";
const READ_BATCH_SIZE = 100;
const WRITE_CONCURRENCY = 8;

export const expectedRegistryProjectionCounts = {
  service: 222,
  form: 4,
  medication: 328,
  differential: 232,
} as const satisfies Record<RegistryCorpusKind, number>;

type Args = {
  ownerId?: string;
  expectedProjectRef?: string;
  write: boolean;
  confirmed: boolean;
  json: boolean;
};

export type RegistryGovernanceDocument = {
  id: string;
  owner_id: string | null;
  metadata: Json | null;
};

export type RegistryGovernanceLabel = {
  id: string;
  document_id: string;
  owner_id: string | null;
  label: string;
  label_type: string;
  source: string;
  confidence: number | null;
  metadata: Json | null;
};

type RegistryGovernanceDocumentUpdate = {
  id: string;
  ownerId: string | null;
  metadata: Record<string, Json>;
};

export type RegistryGovernancePlan = {
  ownerId: string;
  projections: RegistryGovernanceProjection[];
  documentUpdates: RegistryGovernanceDocumentUpdate[];
  labelsToInsert: TablesInsert<"document_labels">[];
  labelsToUpdate: TablesInsert<"document_labels">[];
  labelIdsToDelete: string[];
  publicDocumentCount: number;
  ownerScopedDocumentCount: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { write: false, confirmed: false, json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--confirm") {
      args.confirmed = true;
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    if (token === "--owner-id") args.ownerId = value;
    else if (token === "--expected-project-ref") args.expectedProjectRef = value;
    else throw new Error(`Unknown argument: ${token}`);
    index += 1;
  }

  if (args.write && !args.confirmed) {
    throw new Error("Refusing to write without both --write and --confirm.");
  }
  if (args.write && args.expectedProjectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Production writes require --expected-project-ref ${PRODUCTION_PROJECT_REF}; no other project is authorized.`,
    );
  }
  return args;
}

function metadataRecord(value: Json | null): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json>) : {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues].sort();
}

function expectedLabelCurrent(existing: RegistryGovernanceLabel, expected: TablesInsert<"document_labels">) {
  return (
    existing.owner_id === expected.owner_id &&
    existing.confidence === expected.confidence &&
    stableJson(metadataRecord(existing.metadata)) === stableJson(expected.metadata ?? {})
  );
}

export function buildRegistryGovernancePlan(args: {
  projections: RegistryGovernanceProjection[];
  documents: RegistryGovernanceDocument[];
  labels: RegistryGovernanceLabel[];
  expectedOwnerId?: string;
  expectedCounts?: Record<RegistryCorpusKind, number>;
}): RegistryGovernancePlan {
  const expectedCounts = args.expectedCounts ?? expectedRegistryProjectionCounts;
  const observedCounts = { service: 0, form: 0, medication: 0, differential: 0 } satisfies Record<
    RegistryCorpusKind,
    number
  >;
  for (const projection of args.projections) observedCounts[projection.kind] += 1;
  for (const kind of Object.keys(expectedCounts) as RegistryCorpusKind[]) {
    if (observedCounts[kind] !== expectedCounts[kind]) {
      throw new Error(
        `Registry projection count mismatch for ${kind}: expected ${expectedCounts[kind]}, found ${observedCounts[kind]}.`,
      );
    }
  }

  const ownerIds = new Set(args.projections.map((projection) => projection.ownerId));
  if (ownerIds.size !== 1) {
    throw new Error(`Registry projections must resolve to one owner; found ${ownerIds.size}.`);
  }
  const ownerId = [...ownerIds][0];
  if (!ownerId) throw new Error("Registry projections did not resolve an owner.");
  if (args.expectedOwnerId && ownerId !== args.expectedOwnerId) {
    throw new Error(`Registry owner mismatch: expected ${args.expectedOwnerId}, found ${ownerId}.`);
  }

  const duplicateSourceIdentities = duplicates(
    args.projections.map((projection) => `${projection.kind}:${projection.recordId}`),
  );
  const duplicateProjectionIds = duplicates(args.projections.map((projection) => projection.documentId));
  const duplicateDocumentIds = duplicates(args.documents.map((document) => document.id));
  const duplicateGeneratedLabelKeys = duplicates(
    args.labels
      .filter((label) => label.source === "generated")
      .map((label) => `${label.document_id}:${label.label_type}:${label.label}:${label.source}`),
  );
  const duplicateProblems = [
    ...duplicateSourceIdentities.map((value) => `source ${value}`),
    ...duplicateProjectionIds.map((value) => `projection ${value}`),
    ...duplicateDocumentIds.map((value) => `document ${value}`),
    ...duplicateGeneratedLabelKeys.map((value) => `generated label ${value}`),
  ];
  if (duplicateProblems.length > 0) {
    throw new Error(`Duplicate registry governance identities: ${duplicateProblems.slice(0, 10).join(", ")}.`);
  }

  const documentById = new Map(args.documents.map((document) => [document.id, document]));
  const missingDocumentIds = args.projections
    .map((projection) => projection.documentId)
    .filter((documentId) => !documentById.has(documentId));
  if (missingDocumentIds.length > 0) {
    throw new Error(
      `Missing ${missingDocumentIds.length} deterministic registry document projection(s): ${missingDocumentIds.slice(0, 10).join(", ")}.`,
    );
  }

  // Registry source records remain owner-scoped, but production deliberately
  // promotes the public service/form/medication projections to owner_id = null.
  // Accept that public scope while continuing to reject any different tenant.
  const publicProjectionKinds = new Set<RegistryCorpusKind>(["service", "form", "medication"]);
  const ownerMismatches = args.projections.filter((projection) => {
    const documentOwnerId = documentById.get(projection.documentId)?.owner_id;
    return (
      documentOwnerId !== projection.ownerId &&
      !(documentOwnerId === null && publicProjectionKinds.has(projection.kind))
    );
  });
  if (ownerMismatches.length > 0) {
    throw new Error(
      `Registry document foreign-owner mismatch for ${ownerMismatches.length} projection(s): ${ownerMismatches
        .slice(0, 10)
        .map((projection) => projection.documentId)
        .join(", ")}.`,
    );
  }

  const labelOwnerMismatches = args.labels.filter((label) => {
    const document = documentById.get(label.document_id);
    return document && label.owner_id !== document.owner_id;
  });
  if (labelOwnerMismatches.length > 0) {
    throw new Error(
      `Registry label owner mismatch for ${labelOwnerMismatches.length} label(s): ${labelOwnerMismatches
        .slice(0, 10)
        .map((label) => label.id)
        .join(", ")}.`,
    );
  }

  const labelsByDocument = new Map<string, RegistryGovernanceLabel[]>();
  for (const label of args.labels) {
    labelsByDocument.set(label.document_id, [...(labelsByDocument.get(label.document_id) ?? []), label]);
  }

  const documentUpdates: RegistryGovernanceDocumentUpdate[] = [];
  const labelsToInsert: TablesInsert<"document_labels">[] = [];
  const labelsToUpdate: TablesInsert<"document_labels">[] = [];
  const labelIdsToDelete: string[] = [];

  for (const projection of args.projections) {
    const document = documentById.get(projection.documentId)!;
    const mergedMetadata = { ...metadataRecord(document.metadata), ...projection.requiredMetadata };
    if (stableJson(mergedMetadata) !== stableJson(metadataRecord(document.metadata))) {
      documentUpdates.push({ id: document.id, ownerId: document.owner_id, metadata: mergedMetadata });
    }

    const documentLabels = labelsByDocument.get(projection.documentId) ?? [];
    for (const label of documentLabels) {
      if (label.source !== "generated") continue;
      if (label.label_type === "site") labelIdsToDelete.push(label.id);
      if (label.label_type === "document_intent" && label.label !== projection.intentLabel.label) {
        labelIdsToDelete.push(label.id);
      }
    }

    const expectedLabel = documentLabels.find(
      (label) =>
        label.source === "generated" &&
        label.label_type === "document_intent" &&
        label.label === projection.intentLabel.label,
    );
    const intentLabel = {
      ...projection.intentLabel,
      owner_id: document.owner_id,
      confidence: expectedLabel?.confidence ?? projection.intentLabel.confidence,
      metadata: mergeRegistryGeneratedLabelMetadata(
        expectedLabel?.metadata ?? null,
        projection.intentLabel.metadata ?? null,
      ),
    };
    if (!expectedLabel) labelsToInsert.push(intentLabel);
    else if (!expectedLabelCurrent(expectedLabel, intentLabel)) labelsToUpdate.push(intentLabel);
  }

  return {
    ownerId,
    projections: args.projections,
    documentUpdates,
    labelsToInsert,
    labelsToUpdate,
    labelIdsToDelete: [...new Set(labelIdsToDelete)].sort(),
    publicDocumentCount: args.documents.filter((document) => document.owner_id === null).length,
    ownerScopedDocumentCount: args.documents.filter((document) => document.owner_id === ownerId).length,
  };
}

export function assertExpectedRegistryProjectRef(args: {
  expectedProjectRef: string;
  configuredProjectRef?: string;
  supabaseUrl?: string;
}) {
  const configuredProjectRef = args.configuredProjectRef?.trim();
  if (configuredProjectRef !== args.expectedProjectRef) {
    throw new Error(
      `Supabase project ref mismatch: expected ${args.expectedProjectRef}, configured ${configuredProjectRef || "not set"}.`,
    );
  }
  let urlProjectRef = "";
  try {
    urlProjectRef = args.supabaseUrl ? (new URL(args.supabaseUrl).hostname.split(".")[0] ?? "") : "";
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
  if (urlProjectRef !== args.expectedProjectRef) {
    throw new Error(
      `Supabase URL project mismatch: expected ${args.expectedProjectRef}, observed ${urlProjectRef || "not set"}.`,
    );
  }
}

function chunks<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type AdminClient = Awaited<ReturnType<typeof loadAdminClient>>;

async function loadAllRows<Row>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
) {
  const rows: Row[] = [];
  const pageSize = 1000;
  while (true) {
    const { data, error } = await loadPage(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

type OwnerCounts = Record<RegistryCorpusKind, number>;

async function resolveProductionOwner(supabase: AdminClient, requestedOwnerId?: string) {
  const [registryRows, medicationRows, differentialRows] = await Promise.all([
    loadAllRows<{ owner_id: string; kind: string }>((from, to) =>
      supabase.from("clinical_registry_records").select("owner_id,kind").range(from, to),
    ),
    loadAllRows<{ owner_id: string }>((from, to) =>
      supabase.from("medication_records").select("owner_id").range(from, to),
    ),
    loadAllRows<{ owner_id: string }>((from, to) =>
      supabase.from("differential_records").select("owner_id").range(from, to),
    ),
  ]);
  const counts = new Map<string, OwnerCounts>();
  const ownerCounts = (ownerId: string) => {
    const current = counts.get(ownerId) ?? { service: 0, form: 0, medication: 0, differential: 0 };
    counts.set(ownerId, current);
    return current;
  };
  for (const row of registryRows) ownerCounts(row.owner_id)[row.kind === "form" ? "form" : "service"] += 1;
  for (const row of medicationRows) ownerCounts(row.owner_id).medication += 1;
  for (const row of differentialRows) ownerCounts(row.owner_id).differential += 1;

  const candidates = [...counts.entries()].filter(([, count]) =>
    (Object.keys(expectedRegistryProjectionCounts) as RegistryCorpusKind[]).every(
      (kind) => count[kind] === expectedRegistryProjectionCounts[kind],
    ),
  );
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one owner with the production registry profile; found ${candidates.length}.`);
  }
  const ownerId = candidates[0]![0];
  if (requestedOwnerId && ownerId !== requestedOwnerId) {
    throw new Error(`Resolved production owner ${ownerId} does not match --owner-id ${requestedOwnerId}.`);
  }
  return ownerId;
}

async function loadProjections(supabase: AdminClient, ownerId: string) {
  const [registryResult, medicationResult, differentialResult] = await Promise.all([
    supabase.from("clinical_registry_records").select("*").eq("owner_id", ownerId).order("kind").order("title"),
    supabase.from("medication_records").select("*").eq("owner_id", ownerId).order("name"),
    supabase.from("differential_records").select("*").eq("owner_id", ownerId).order("kind").order("title"),
  ]);
  if (registryResult.error) throw new Error(`Could not load registry records: ${registryResult.error.message}`);
  if (medicationResult.error) throw new Error(`Could not load medication records: ${medicationResult.error.message}`);
  if (differentialResult.error)
    throw new Error(`Could not load differential records: ${differentialResult.error.message}`);

  const {
    clinicalRegistryRowsToCorpusEntries,
    differentialRowsToCorpusEntries,
    medicationRowsToCorpusEntries,
    registryGovernanceProjection,
  } = await import("@/lib/registry-corpus");
  return [
    ...clinicalRegistryRowsToCorpusEntries((registryResult.data ?? []) as RegistryRecordRow[]),
    ...medicationRowsToCorpusEntries((medicationResult.data ?? []) as MedicationRecordRow[]),
    ...differentialRowsToCorpusEntries((differentialResult.data ?? []) as DifferentialRecordRow[]),
  ].map(registryGovernanceProjection);
}

async function loadExistingGovernance(supabase: AdminClient, documentIds: string[]) {
  const documents: RegistryGovernanceDocument[] = [];
  const labels: RegistryGovernanceLabel[] = [];
  for (const documentIdBatch of chunks(documentIds, READ_BATCH_SIZE)) {
    const [documentResult, labelResult] = await Promise.all([
      supabase.from("documents").select("id,owner_id,metadata").in("id", documentIdBatch),
      supabase
        .from("document_labels")
        .select("id,document_id,owner_id,label,label_type,source,confidence,metadata")
        .in("document_id", documentIdBatch),
    ]);
    if (documentResult.error) throw new Error(`Registry document preflight failed: ${documentResult.error.message}`);
    if (labelResult.error) throw new Error(`Registry label preflight failed: ${labelResult.error.message}`);
    documents.push(...((documentResult.data ?? []) as RegistryGovernanceDocument[]));
    labels.push(...((labelResult.data ?? []) as RegistryGovernanceLabel[]));
  }
  return { documents, labels };
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      if (item) await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
}

async function applyPlan(supabase: AdminClient, plan: RegistryGovernancePlan) {
  await runWithConcurrency(plan.documentUpdates, WRITE_CONCURRENCY, async (update) => {
    const updateQuery = supabase.from("documents").update({ metadata: update.metadata }).eq("id", update.id);
    const scopedUpdate =
      update.ownerId === null ? updateQuery.is("owner_id", null) : updateQuery.eq("owner_id", update.ownerId);
    const { data, error } = await scopedUpdate.select("id");
    if (error) throw new Error(`Registry metadata update failed for ${update.id}: ${error.message}`);
    if (data?.length !== 1) throw new Error(`Registry metadata update did not match exactly one row for ${update.id}.`);
  });

  for (const labelIdBatch of chunks(plan.labelIdsToDelete, READ_BATCH_SIZE)) {
    const { error } = await supabase.from("document_labels").delete().in("id", labelIdBatch);
    if (error) throw new Error(`Registry generated-label cleanup failed: ${error.message}`);
  }
  for (const labelBatch of chunks([...plan.labelsToInsert, ...plan.labelsToUpdate], READ_BATCH_SIZE)) {
    const { error } = await supabase
      .from("document_labels")
      .upsert(labelBatch, { onConflict: "document_id,label_type,label,source" });
    if (error) throw new Error(`Registry intent-label upsert failed: ${error.message}`);
  }
}

function reportForPlan(plan: RegistryGovernancePlan, write: boolean) {
  return {
    mode: write ? "write" : "dry-run",
    owner_id: plan.ownerId,
    documents_inspected: plan.projections.length,
    documents_updated: plan.documentUpdates.length,
    labels_inserted: plan.labelsToInsert.length,
    labels_updated: plan.labelsToUpdate.length,
    labels_deleted: plan.labelIdsToDelete.length,
    public_documents: plan.publicDocumentCount,
    owner_scoped_documents: plan.ownerScopedDocumentCount,
    chunk_rows_touched: 0,
    openai_calls: 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const expectedProjectRef = args.expectedProjectRef ?? PRODUCTION_PROJECT_REF;
  assertExpectedRegistryProjectRef({
    expectedProjectRef,
    configuredProjectRef: process.env.SUPABASE_PROJECT_REF,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const { requireServerEnv } = await import("@/lib/env");
  requireServerEnv();
  const supabase = await loadAdminClient();
  const ownerId = await resolveProductionOwner(supabase, args.ownerId);
  const projections = await loadProjections(supabase, ownerId);
  const existing = await loadExistingGovernance(
    supabase,
    projections.map((projection) => projection.documentId),
  );
  const plan = buildRegistryGovernancePlan({ ...existing, projections, expectedOwnerId: ownerId });
  const report = reportForPlan(plan, args.write);

  if (args.write) await applyPlan(supabase, plan);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("[registry:reconcile-governance]");
    for (const [key, value] of Object.entries(report)) console.log(`  ${key}: ${value}`);
    if (!args.write) {
      console.log(
        `Dry run only. Re-run with --write --confirm --expected-project-ref ${PRODUCTION_PROJECT_REF} to apply this exact scope.`,
      );
    }
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[registry:reconcile-governance] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
