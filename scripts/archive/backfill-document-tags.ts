import { replaceMaintenanceArtifacts } from "@/lib/ingestion-maintenance";
import { loadEnvConfig } from "@next/env";
import { normalizeDocumentLabelForStorage } from "@/lib/document-tags";
import type { DocumentLabel, DocumentLabelType } from "@/lib/types";

loadEnvConfig(process.cwd());

type BackfillArgs = {
  allOwners: boolean;
  ownerId?: string;
  documentId?: string;
  limit: number;
  write: boolean;
  confirm: boolean;
  onlyMissing: boolean;
};

type DocumentRow = {
  id: string;
  owner_id: string | null;
  title: string;
  file_name: string;
  source_path?: string | null;
  status: string;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type CleanGeneratedLabel = {
  label: string;
  label_type: DocumentLabelType;
  confidence: number;
  sourceLabelIds: string[];
  examples: string[];
};

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = {
    allOwners: false,
    ownerId: process.env.RAG_EVAL_OWNER_ID ?? process.env.LOCAL_NO_AUTH_OWNER_ID,
    limit: 100,
    write: false,
    confirm: false,
    onlyMissing: false,
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
    if (token === "--only-missing") {
      args.onlyMissing = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;
    if (token === "--owner-id") args.ownerId = value;
    if (token === "--document-id") args.documentId = value;
    if (token === "--limit") args.limit = Number.parseInt(value, 10);
  }

  if (!Number.isInteger(args.limit) || args.limit <= 0) throw new Error("--limit must be a positive integer.");
  if (!args.allOwners && !args.ownerId && !args.documentId) {
    throw new Error("Pass --owner-id, --document-id, or --all-owners. Dry-run is still the default.");
  }
  if (args.write && !args.confirm) throw new Error("Writing requires --write --confirm after reviewing a dry-run.");
  return args;
}

async function loadDocuments(supabase: Awaited<ReturnType<typeof loadAdminClient>>, args: BackfillArgs) {
  let query = supabase
    .from("documents")
    .select("id,owner_id,title,file_name,source_path,status,metadata,updated_at")
    .eq("status", "indexed")
    .order("created_at", { ascending: true })
    .limit(args.documentId ? 1 : args.limit);

  if (args.documentId) query = query.eq("id", args.documentId);
  if (!args.allOwners && args.ownerId) query = query.eq("owner_id", args.ownerId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentRow[];
}

async function loadLabels(supabase: Awaited<ReturnType<typeof loadAdminClient>>, documentIds: string[]) {
  const labels: DocumentLabel[] = [];
  for (let start = 0; start < documentIds.length; start += 100) {
    const ids = documentIds.slice(start, start + 100);
    const { data, error } = await supabase
      .from("document_labels")
      .select("id,document_id,owner_id,label,label_type,source,confidence,metadata,created_at,updated_at")
      .in("document_id", ids);
    if (error) throw new Error(error.message);
    labels.push(...((data ?? []) as DocumentLabel[]));
  }
  return labels;
}

function cleanGeneratedLabels(labels: DocumentLabel[]) {
  const cleaned = new Map<string, CleanGeneratedLabel>();
  const dropped: DocumentLabel[] = [];

  for (const label of labels.filter((item) => item.source === "generated")) {
    const normalized = normalizeDocumentLabelForStorage({ ...label, source: "generated" });
    if (!normalized) {
      dropped.push(label);
      continue;
    }
    const key = `${normalized.label_type}:${normalized.label}`;
    const existing = cleaned.get(key);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, normalized.confidence);
      existing.sourceLabelIds.push(label.id);
      existing.examples.push(label.label);
    } else {
      cleaned.set(key, {
        label: normalized.label,
        label_type: normalized.label_type,
        confidence: normalized.confidence,
        sourceLabelIds: [label.id],
        examples: [label.label],
      });
    }
  }

  return { cleaned: [...cleaned.values()], dropped };
}

function planDocument(
  document: DocumentRow,
  labels: DocumentLabel[],
  inferLabels: (
    document: Pick<DocumentRow, "title" | "file_name" | "source_path">,
  ) => Array<Pick<CleanGeneratedLabel, "label" | "label_type" | "confidence">>,
) {
  const generated = labels.filter((label) => label.source === "generated");
  const manualCount = labels.filter((label) => label.source === "manual").length;
  const { cleaned, dropped } = cleanGeneratedLabels(labels);
  if (generated.length === 0) {
    cleaned.push(
      ...inferLabels(document).map((label) => ({
        label: label.label,
        label_type: label.label_type,
        confidence: label.confidence,
        sourceLabelIds: [],
        examples: [label.label],
      })),
    );
  }
  const currentKeys = generated
    .map((label) => `${label.label_type}:${label.label}:${Math.round(label.confidence * 1000)}`)
    .sort();
  const nextKeys = cleaned
    .map((label) => `${label.label_type}:${label.label}:${Math.round(label.confidence * 1000)}`)
    .sort();
  const changed = currentKeys.length !== nextKeys.length || currentKeys.some((key, index) => key !== nextKeys[index]);

  return {
    document,
    generatedCount: generated.length,
    manualCount,
    cleaned,
    dropped,
    changed,
  };
}

async function writePlan(
  supabase: Awaited<ReturnType<typeof loadAdminClient>>,
  plan: ReturnType<typeof planDocument>,
  stampedAt: string,
  ragEnrichmentVersion: string,
) {
  await replaceMaintenanceArtifacts({
    supabase,
    document: plan.document,
    operation: "labels",
    payload: {
      labels: plan.cleaned.map((label) => ({
        label: label.label,
        label_type: label.label_type,
        confidence: label.confidence,
        metadata: {
          generated_by: "smart-tag-backfill",
          source_label_ids: label.sourceLabelIds,
          source_label_examples: label.examples,
          rag_enrichment_version: ragEnrichmentVersion,
          smart_tag_backfilled_at: stampedAt,
        },
      })),
    },
  });
}

function printPlan(plans: Array<ReturnType<typeof planDocument>>, write: boolean) {
  const changed = plans.filter((plan) => plan.changed);
  const dropped = plans.reduce((count, plan) => count + plan.dropped.length, 0);
  const deduped = plans.reduce((count, plan) => count + Math.max(0, plan.generatedCount - plan.cleaned.length), 0);
  console.log(`${write ? "WRITE" : "DRY-RUN"} smart tag backfill`);
  console.log(`documents scanned: ${plans.length}`);
  console.log(`documents with generated-tag changes: ${changed.length}`);
  console.log(`generated labels dropped: ${dropped}`);
  console.log(`generated labels deduped/renamed: ${deduped}`);
  console.log("manual labels preserved: yes");
  console.log("");

  for (const plan of changed.slice(0, 25)) {
    console.log(`- ${plan.document.title || plan.document.file_name}`);
    console.log(`  generated: ${plan.generatedCount} -> ${plan.cleaned.length}; manual preserved: ${plan.manualCount}`);
    if (plan.dropped.length)
      console.log(
        `  drop: ${plan.dropped
          .map((label) => label.label)
          .slice(0, 6)
          .join(", ")}`,
      );
    console.log(
      `  keep: ${plan.cleaned
        .map((label) => `${label.label_type}:${label.label}`)
        .slice(0, 8)
        .join(", ")}`,
    );
  }
  if (!write) console.log("\nNo writes performed. Re-run with --write --confirm after reviewing this output.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { inferLabels, ragEnrichmentVersion } = await import("@/lib/document-enrichment");
  const supabase = await loadAdminClient();
  const documents = await loadDocuments(supabase, args);
  const labels = await loadLabels(
    supabase,
    documents.map((document) => document.id),
  );
  const labelsByDocument = new Map<string, DocumentLabel[]>();
  for (const label of labels)
    labelsByDocument.set(label.document_id, [...(labelsByDocument.get(label.document_id) ?? []), label]);
  const plans = documents
    .map((document) => planDocument(document, labelsByDocument.get(document.id) ?? [], inferLabels))
    .filter((plan) => !args.onlyMissing || plan.generatedCount === 0);

  printPlan(plans, args.write);
  if (!args.write) return;

  const stampedAt = new Date().toISOString();
  for (const plan of plans.filter((item) => item.changed)) {
    await writePlan(supabase, plan, stampedAt, ragEnrichmentVersion);
  }
  console.log(`\nUpdated ${plans.filter((plan) => plan.changed).length} documents.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
