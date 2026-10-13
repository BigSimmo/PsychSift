import * as nextEnv from "@next/env";
import { documentLabelTier, normalizeDocumentLabelForStorage } from "@/lib/document-tags";
import { isRegistryProjectionDocument } from "./lib/registry-projection-document";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export { isRegistryProjectionDocument } from "./lib/registry-projection-document";

const loadEnvConfig =
  nextEnv.loadEnvConfig ??
  (nextEnv as unknown as { default?: { loadEnvConfig?: typeof nextEnv.loadEnvConfig } }).default?.loadEnvConfig;

if (!loadEnvConfig) throw new Error("Unable to load @next/env loadEnvConfig.");
loadEnvConfig(process.cwd());

type ClassifyArgs = {
  allOwners: boolean;
  ownerId?: string;
  documentId?: string;
  limit: number;
  offset: number;
  write: boolean;
  confirm: boolean;
  help: boolean;
  onlyMissingSmartV2: boolean;
};

type SupabaseAdmin = Awaited<ReturnType<typeof loadAdminClient>>;
type DocumentRow = {
  id: string;
  owner_id: string | null;
  title: string;
  file_name: string;
  source_path: string | null;
  status: string;
  metadata: unknown;
};

type Classification = Awaited<ReturnType<typeof classifyDocument>>;
type ClassificationPlan = { document: DocumentRow; classification: Classification };
type GeneratedLabelRow = {
  document_id: string;
  owner_id: string | null;
  label: string;
  label_type: string;
  confidence: number;
  source: "generated";
  metadata: {
    generated_by: "document-organization-classifier";
    organization_profile_version: "document-organization-v1";
    classified_at: string;
    label_tier: string;
    review_status: string;
    [key: string]: unknown;
  };
};

type DatabaseError = {
  message: string;
};

const generatedLabelTypes = [
  "site",
  "document_type",
  "population",
  "topic",
  "setting",
  "service",
  "workflow",
  "medication",
  "risk",
  "clinical_action",
  "care_phase",
  "document_intent",
  "content_feature",
] as const;

const smartV2GeneratedLabelTypes = new Set(["clinical_action", "care_phase", "document_intent", "content_feature"]);

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function parseArgs(argv: string[]): ClassifyArgs {
  const args: ClassifyArgs = {
    allOwners: false,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    limit: 100,
    offset: 0,
    write: false,
    confirm: false,
    help: false,
    onlyMissingSmartV2: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all-owners") {
      args.allOwners = true;
      continue;
    }
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--confirm") {
      args.confirm = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--only-missing-smart-v2") {
      args.onlyMissingSmartV2 = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;
    if (token === "--owner-id") args.ownerId = value;
    else if (token === "--document-id") args.documentId = value;
    else if (token === "--limit") args.limit = Number(value);
    else if (token === "--offset") args.offset = Number(value);
    else throw new Error(`Unknown option: ${token}`);
  }

  if (args.help) return args;
  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error("--limit must be a positive integer.");
  if (!Number.isInteger(args.offset) || args.offset < 0) throw new Error("--offset must be a non-negative integer.");
  if (!args.allOwners && !args.ownerId && !args.documentId) {
    throw new Error("Pass --owner-id, --document-id, or --all-owners. Dry-run is still the default.");
  }
  if (args.write && !args.confirm) throw new Error("Writing requires --write --confirm after reviewing a dry-run.");
  return args;
}

function usage() {
  return [
    "Usage: npm run classify:documents -- [scope] [options]",
    "",
    "Scopes:",
    "  --owner-id <uuid>       Classify indexed documents for one owner.",
    "  --document-id <uuid>    Classify one indexed document.",
    "  --all-owners           Classify across all owners.",
    "",
    "Options:",
    "  --limit <count>        Batch size for scoped runs. Default: 100.",
    "  --offset <count>       Skip this many indexed documents before the batch. Default: 0.",
    "  --only-missing-smart-v2  Classify only loaded documents missing smart-v2 generated labels.",
    "  --write --confirm      Persist reviewed classifications. Dry-run is the default.",
    "  --help, -h             Show this help.",
  ].join("\n");
}

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

type ExistingGeneratedLabelRow = {
  id: string;
  document_id: string;
  label_type: string;
  label: string;
  metadata: unknown;
};

function assertMutationRows(
  result: { data: unknown[] | null; error: DatabaseError | null },
  expected: number,
  operation: string,
) {
  if (result.error) throw new Error(result.error.message);
  const actual = result.data?.length ?? 0;
  if (actual !== expected) {
    throw new Error(`${operation} expected ${expected} row(s), received ${actual}.`);
  }
}

function labelIdentity(row: { document_id: string; label_type: string; label: string }) {
  return `${row.document_id}|${row.label_type}|${row.label}`;
}

function dedupeGeneratedLabels(rows: GeneratedLabelRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = labelIdentity(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preservedReviewMetadata(metadata: unknown) {
  const record = metadataRecord(metadata);
  const preserved: Record<string, unknown> = {};
  for (const key of [
    "review_status",
    "reviewed_at",
    "reviewed_by",
    "review_note",
    "review_reason",
    "hidden_at",
    "hidden_by",
    "hidden_reason",
    "approved_at",
    "approved_by",
  ]) {
    if (record[key] !== undefined) preserved[key] = record[key];
  }
  return preserved;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function loadDocuments(supabase: SupabaseAdmin, args: ClassifyArgs) {
  const documents: DocumentRow[] = [];
  const pageSize = Math.min(args.limit, 1000);
  const totalToLoad = args.documentId ? 1 : args.limit;

  while (documents.length < totalToLoad) {
    const start = args.documentId ? 0 : args.offset + documents.length;
    const end = args.documentId ? 0 : start + Math.min(pageSize, totalToLoad - documents.length) - 1;
    let query = supabase
      .from("documents")
      .select("id,owner_id,title,file_name,source_path,status,metadata")
      .eq("status", "indexed")
      .order("id", { ascending: true })
      .range(start, end);

    if (args.documentId) query = query.eq("id", args.documentId);
    if (!args.allOwners && args.ownerId) query = query.eq("owner_id", args.ownerId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DocumentRow[];
    documents.push(...rows);
    if (args.documentId || rows.length < end - start + 1) break;
  }

  return documents;
}

async function filterDocumentsMissingSmartV2(supabase: SupabaseAdmin, documents: DocumentRow[]) {
  const smartV2LabelTypes = ["clinical_action", "care_phase", "document_intent", "content_feature"];
  const documentIds = documents.map((document) => document.id);
  const documentsWithSmartV2 = new Set<string>();

  for (const ids of chunkArray(documentIds, 100)) {
    const { data, error } = await supabase
      .from("document_labels")
      .select("document_id")
      .in("document_id", ids)
      .eq("source", "generated")
      .in("label_type", smartV2LabelTypes);
    if (error) throw new Error(error.message);
    for (const label of data ?? []) {
      if (typeof label.document_id === "string") documentsWithSmartV2.add(label.document_id);
    }
  }

  return documents.filter((document) => !documentsWithSmartV2.has(document.id));
}

async function loadEvidenceText(supabase: SupabaseAdmin, documentId: string) {
  const [{ data: chunks, error: chunkError }, { data: summary, error: summaryError }] = await Promise.all([
    supabase
      .from("document_chunks")
      .select("content,chunk_index")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true })
      .limit(80),
    supabase.from("document_summaries").select("summary").eq("document_id", documentId).maybeSingle(),
  ]);
  if (chunkError) throw new Error(chunkError.message);
  if (summaryError) throw new Error(summaryError.message);
  return {
    contentText: (chunks ?? []).map((chunk) => String(chunk.content ?? "")).join("\n\n"),
    summaryText: typeof summary?.summary === "string" ? summary.summary : "",
  };
}

function generatedLabelsForPlan(plan: ClassificationPlan, stampedAt: string): GeneratedLabelRow[] {
  const siteLabels = plan.classification.labels.filter(
    (label) => label.label_type === "site" && label.confidence >= 0.75,
  );
  const typeLabels = plan.classification.labels.filter(
    (label) => label.label_type === "document_type" && label.confidence >= 0.5,
  );
  const secondaryLabels = plan.classification.labels.filter(
    (label) =>
      [
        "population",
        "topic",
        "setting",
        "service",
        "workflow",
        "medication",
        "risk",
        "clinical_action",
        "care_phase",
        "document_intent",
        "content_feature",
      ].includes(label.label_type) && label.confidence >= 0.5,
  );

  const rows = [...siteLabels, ...typeLabels, ...secondaryLabels].flatMap((label) => {
    const normalized = normalizeDocumentLabelForStorage({
      label: label.label,
      label_type: label.label_type,
      confidence: label.confidence,
      source: "generated",
    });
    if (!normalized) return [];

    return [
      {
        document_id: plan.document.id,
        owner_id: plan.document.owner_id,
        label: normalized.label,
        label_type: normalized.label_type,
        confidence: normalized.confidence,
        source: "generated" as const,
        metadata: {
          generated_by: "document-organization-classifier" as const,
          organization_profile_version: "document-organization-v1" as const,
          classified_at: stampedAt,
          label_tier: documentLabelTier(normalized.label, normalized.label_type),
          review_status: "new" as const,
        },
      },
    ];
  });
  if (!rows.some((row) => smartV2GeneratedLabelTypes.has(row.label_type))) {
    const fallbackIntent =
      plan.classification.profile.document_type.label === "form" ? "documentation-requirement" : "staff-guidance";
    const normalized = normalizeDocumentLabelForStorage({
      label: fallbackIntent,
      label_type: "document_intent",
      confidence: 0.55,
      source: "generated",
    });
    if (normalized) {
      rows.push({
        document_id: plan.document.id,
        owner_id: plan.document.owner_id,
        label: normalized.label,
        label_type: normalized.label_type,
        confidence: normalized.confidence,
        source: "generated",
        metadata: {
          generated_by: "document-organization-classifier",
          organization_profile_version: "document-organization-v1",
          classified_at: stampedAt,
          label_tier: documentLabelTier(normalized.label, normalized.label_type),
          review_status: "new",
        },
      });
    }
  }
  return rows;
}

async function writeClassifications(supabase: SupabaseAdmin, plans: ClassificationPlan[]) {
  const writeBatchSize = 100;
  const documentUpdateConcurrency = 10;
  const labelUpsertBatchSize = 500;
  let updated = 0;

  for (const batch of chunkArray(plans, writeBatchSize)) {
    const stampedAt = new Date().toISOString();
    const documentRows = batch.map((plan) => ({
      id: plan.document.id,
      metadata: {
        ...metadataRecord(plan.document.metadata),
        ...plan.classification.metadata,
        organization_profile_updated_at: stampedAt,
        organization_profile_updated_by: "classify-documents",
      },
    }));

    for (const documentBatch of chunkArray(documentRows, documentUpdateConcurrency)) {
      const results = await Promise.all(
        documentBatch.map((document) =>
          supabase
            .from("documents")
            .update({ metadata: document.metadata })
            .eq("id", document.id)
            .eq("status", "indexed")
            .select("id"),
        ),
      );
      for (const result of results) {
        assertMutationRows(
          result as { data: unknown[] | null; error: DatabaseError | null },
          1,
          "document metadata update",
        );
      }
    }

    const documentIds = batch.map((plan) => plan.document.id);
    const generatedLabels = dedupeGeneratedLabels(batch.flatMap((plan) => generatedLabelsForPlan(plan, stampedAt)));
    const desiredLabelKeys = new Set(generatedLabels.map(labelIdentity));
    const { data: existingGenerated, error: existingGeneratedError } = (await supabase
      .from("document_labels")
      .select("id,document_id,label_type,label,metadata")
      .in("document_id", documentIds)
      .eq("source", "generated")
      .in("label_type", [...generatedLabelTypes])) as {
      data: ExistingGeneratedLabelRow[] | null;
      error: DatabaseError | null;
    };
    if (existingGeneratedError) throw new Error(existingGeneratedError.message);

    const labelsToDelete = (existingGenerated ?? [])
      .filter((label) => !desiredLabelKeys.has(labelIdentity(label)))
      .map((label) => label.id);
    const existingGeneratedByKey = new Map((existingGenerated ?? []).map((label) => [labelIdentity(label), label]));
    const labelsForUpsert = generatedLabels.map((label) => {
      const preserved = preservedReviewMetadata(existingGeneratedByKey.get(labelIdentity(label))?.metadata);
      return {
        ...label,
        metadata: {
          ...label.metadata,
          ...preserved,
        },
      };
    });

    for (const labels of chunkArray(labelsForUpsert, labelUpsertBatchSize)) {
      if (!labels.length) continue;
      const { data, error: labelError } = await supabase
        .from("document_labels")
        .upsert(labels, { onConflict: "document_id,label_type,label,source" })
        .select("id,document_id,label_type,label");
      if (labelError) throw new Error(labelError.message);
      if (data?.length !== labels.length) {
        throw new Error(`generated label upsert expected ${labels.length} row(s), received ${data?.length ?? 0}.`);
      }
    }

    for (const labelIds of chunkArray(labelsToDelete, labelUpsertBatchSize)) {
      if (!labelIds.length) continue;
      const { data, error: labelDeleteError } = await supabase
        .from("document_labels")
        .delete()
        .in("id", labelIds)
        .select("id");
      if (labelDeleteError) throw new Error(labelDeleteError.message);
      assertMutationRows({ data: data ?? null, error: null }, labelIds.length, "generated label cleanup");
    }

    updated += batch.length;
    console.log(`Updated ${updated}/${plans.length} document organization profile(s).`);
  }
}

async function classifyDocument(supabase: SupabaseAdmin, document: DocumentRow) {
  const [{ classifyDocumentOrganization }, evidence] = await Promise.all([
    import("@/lib/document-organization"),
    loadEvidenceText(supabase, document.id),
  ]);
  return classifyDocumentOrganization({
    title: document.title,
    file_name: document.file_name,
    source_path: document.source_path,
    metadata: document.metadata,
    contentText: evidence.contentText,
    summaryText: evidence.summaryText,
  });
}

function printPlan(plans: ClassificationPlan[], write: boolean) {
  const confident = plans.filter((plan) => plan.classification.profile.review_status === "confident").length;
  const needsReview = plans.filter((plan) => plan.classification.profile.review_status === "needs_review").length;
  const withSite = plans.filter((plan) => plan.classification.profile.site.label).length;
  const labelCounts = plans.map((plan) => plan.classification.labels.length);
  const labelsByType = new Map<string, number>();
  for (const plan of plans) {
    for (const label of plan.classification.labels) {
      labelsByType.set(label.label_type, (labelsByType.get(label.label_type) ?? 0) + 1);
    }
  }

  console.log(`${write ? "WRITE" : "DRY-RUN"} document organization classification`);
  console.log(`documents scanned: ${plans.length}`);
  console.log(`confident profiles: ${confident}`);
  console.log(`needs review: ${needsReview}`);
  console.log(`assigned site labels: ${withSite}`);
  console.log(
    `generated labels: total=${labelCounts.reduce((sum, count) => sum + count, 0)} avg=${
      labelCounts.length ? (labelCounts.reduce((sum, count) => sum + count, 0) / labelCounts.length).toFixed(2) : "0.00"
    } max=${labelCounts.length ? Math.max(...labelCounts) : 0}`,
  );
  console.log(
    `labels by type: ${[...labelsByType.entries()]
      .sort()
      .map(([type, count]) => `${type}=${count}`)
      .join(", ")}`,
  );
  console.log("");

  for (const plan of plans.slice(0, 25)) {
    const profile = plan.classification.profile;
    const site =
      profile.site.label ?? (profile.site.candidates.map((candidate) => candidate.label).join(", ") || "none");
    console.log(`- ${plan.document.title}`);
    console.log(`  display: ${profile.canonical_display_title}`);
    console.log(`  site: ${site}; type: ${profile.document_type.label}; review: ${profile.review_status}`);
    if (profile.raw_bracket_tags.length) console.log(`  bracket tags: ${profile.raw_bracket_tags.join(", ")}`);
  }
  const needsReviewPlans = plans.filter((plan) => plan.classification.profile.review_status === "needs_review");
  if (needsReviewPlans.length > 0) {
    console.log("\nNeeds review before write:");
    for (const plan of needsReviewPlans.slice(0, 25)) {
      const profile = plan.classification.profile;
      const site =
        profile.site.label ?? (profile.site.candidates.map((candidate) => candidate.label).join(", ") || "none");
      console.log(`- ${plan.document.title}: site=${site}; type=${profile.document_type.label}`);
    }
  }
  if (!write) console.log("\nNo writes performed. Re-run with --write --confirm after reviewing this output.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const supabase = await loadAdminClient();
  const loadedDocuments = await loadDocuments(supabase, args);
  const registryDocuments = loadedDocuments.filter(isRegistryProjectionDocument);
  const classifiableDocuments = loadedDocuments.filter((document) => !isRegistryProjectionDocument(document));
  if (registryDocuments.length > 0) {
    console.log(
      `[classify:documents] Skipped ${registryDocuments.length} registry projection(s); use registry:reconcile-governance to repair deterministic governance metadata and labels without embeddings.`,
    );
  }
  const documents = args.onlyMissingSmartV2
    ? await filterDocumentsMissingSmartV2(supabase, classifiableDocuments)
    : classifiableDocuments;
  const plans = [];

  for (const document of documents) {
    plans.push({ document, classification: await classifyDocument(supabase, document) });
  }

  printPlan(plans, args.write);
  if (!args.write) return;

  await writeClassifications(supabase, plans);
  console.log(`\nUpdated ${plans.length} document organization profile(s).`);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
