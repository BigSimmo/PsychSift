import * as nextEnv from "@next/env";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { reviewDocumentTagQuality } from "@/lib/document-tags";
import type { DocumentLabel } from "@/lib/types";
import { isRegistryProjectionDocument } from "./lib/registry-projection-document";

const loadEnvConfig =
  nextEnv.loadEnvConfig ??
  (nextEnv as unknown as { default?: { loadEnvConfig?: typeof nextEnv.loadEnvConfig } }).default?.loadEnvConfig;

if (!loadEnvConfig) throw new Error("Unable to load @next/env loadEnvConfig.");
loadEnvConfig(process.cwd());

type CoverageArgs = {
  json: boolean;
  help: boolean;
  allowedSiteMissingPath?: string;
  allowedDocumentTypeMissingPath?: string;
};

type SupabaseAdmin = Awaited<ReturnType<typeof loadAdminClient>>;

export type DocumentLabelCoverageDocument = {
  id: string;
  title: string;
  file_name: string;
  file_type: string | null;
  source_path: string | null;
  metadata: Record<string, unknown> | null;
};

export type DocumentLabelCoverageLabel = {
  id: string;
  document_id: string;
  label: string;
  label_type: DocumentLabel["label_type"];
  source: DocumentLabel["source"];
  confidence: number;
};

type QueryResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

type QueryBuilder<T> = PromiseLike<QueryResult<T>> & {
  eq(column: string, value: unknown): QueryBuilder<T>;
  order(column: string, options: { ascending: boolean }): QueryBuilder<T>;
  gt(column: string, value: unknown): QueryBuilder<T>;
  limit(value: number): QueryBuilder<T>;
};

async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function parseArgs(argv: string[]): CoverageArgs {
  const args: CoverageArgs = { json: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);

    if (token === "--allow-site-missing") {
      args.allowedSiteMissingPath = value;
      index += 1;
      continue;
    }
    if (token === "--allow-document-type-missing") {
      args.allowedDocumentTypeMissingPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  return args;
}

function usage() {
  return [
    "Usage: npm run check:document-label-coverage -- [options]",
    "",
    "Checks physical-document labels and registry metadata/smart-v2 contracts.",
    "",
    "Options:",
    "  --json                           Print machine-readable JSON.",
    "  --allow-site-missing <path>      Allow indexed docs without site labels from this ID allowlist.",
    "  --allow-document-type-missing <path> Allow indexed docs without document_type labels from this ID allowlist.",
    "  --help                           Show this help.",
  ].join("\n");
}

function parseAllowlistValue(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (!entry || typeof entry !== "object") return "";
        const obj = entry as { document_id?: unknown; id?: unknown; documentId?: unknown };
        if (typeof obj.document_id === "string") return obj.document_id.trim();
        if (typeof obj.id === "string") return obj.id.trim();
        if (typeof obj.documentId === "string") return obj.documentId.trim();
        return "";
      })
      .filter((entry): entry is string => Boolean(entry));
  } catch {
    return trimmed
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

async function loadAllowlist(path: string | undefined) {
  if (!path) return new Set<string>();
  const resolved = resolve(path);
  const raw = await fs.readFile(resolved, "utf8");
  return new Set(parseAllowlistValue(raw));
}

async function fetchAll<T extends { id: string }>(
  supabase: SupabaseAdmin,
  table: "documents" | "document_labels",
  select: string,
  filter: (query: QueryBuilder<T>) => QueryBuilder<T>,
) {
  const rows: T[] = [];
  const pageSize = 1000;
  let cursor: string | null = null;

  while (true) {
    let query = supabase
      .from(table)
      .select(select)
      .order("id", { ascending: true })
      .limit(pageSize) as unknown as QueryBuilder<T>;
    if (cursor) query = query.gt("id", cursor);
    const filtered = filter(query);
    const { data, error } = await filtered;
    if (error) throw new Error(error.message);
    const nextRows = data ?? [];
    rows.push(...nextRows);
    if (nextRows.length < pageSize) break;
    const lastId = nextRows[nextRows.length - 1]?.id;
    if (!lastId || lastId === cursor) break;
    cursor = lastId;
  }

  return rows;
}

function countByLabelType(labels: DocumentLabelCoverageLabel[]) {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label.label_type, (counts.get(label.label_type) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
}

const smartV2LabelTypes = new Set(["clinical_action", "care_phase", "document_intent", "content_feature"]);
const registryKinds = new Set(["service", "form", "medication", "differential"]);
const registryIntentByKind = {
  service: "operational-process",
  form: "documentation-requirement",
  medication: "medication-instruction",
  differential: "decision-support",
} as const;
const requiredRegistryMetadataKeys = [
  "source_kind",
  "registry_record_kind",
  "registry_record_id",
  "registry_record_slug",
  "publisher",
  "document_status",
  "clinical_validation_status",
  "clinical_validation_evidence",
  "extraction_quality",
] as const;

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonEmptyMetadataValue(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;
  return value !== undefined && value !== null;
}

function registryKindFor(document: DocumentLabelCoverageDocument) {
  const metadata = metadataRecord(document.metadata);
  const kind = typeof metadata.registry_record_kind === "string" ? metadata.registry_record_kind : "";
  return registryKinds.has(kind) ? (kind as keyof typeof registryIntentByKind) : null;
}

function countQualityIssues(issues: ReturnType<typeof reviewDocumentTagQuality>) {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort());
}

export function buildDocumentLabelCoverageReport(args: {
  documents: DocumentLabelCoverageDocument[];
  labels: DocumentLabelCoverageLabel[];
  allowedSiteMissing?: Set<string>;
  allowedDocumentTypeMissing?: Set<string>;
}) {
  const { documents, labels } = args;
  const allowedSiteMissing = args.allowedSiteMissing ?? new Set<string>();
  const allowedDocumentTypeMissing = args.allowedDocumentTypeMissing ?? new Set<string>();
  const documentIds = new Set(documents.map((document) => document.id));
  const physicalDocuments = documents.filter((document) => !isRegistryProjectionDocument(document));
  const registryDocuments = documents.filter(isRegistryProjectionDocument);
  const generatedDocumentIds = new Set(labels.map((label) => label.document_id));
  const siteDocumentIds = new Set(
    labels.filter((label) => label.label_type === "site").map((label) => label.document_id),
  );
  const documentTypeDocumentIds = new Set(
    labels.filter((label) => label.label_type === "document_type").map((label) => label.document_id),
  );
  const smartV2Labels = labels.filter((label) => smartV2LabelTypes.has(label.label_type));
  const smartV2DocumentIds = new Set(smartV2Labels.map((label) => label.document_id));
  const labelsByDocument = new Map<string, DocumentLabelCoverageLabel[]>();
  for (const label of labels) {
    labelsByDocument.set(label.document_id, [...(labelsByDocument.get(label.document_id) ?? []), label]);
  }

  const missingGenerated = [...documentIds].filter((id) => !generatedDocumentIds.has(id));
  const missingSmartV2 = [...documentIds].filter((id) => !smartV2DocumentIds.has(id));
  const allowedSiteMissingDocs = [...allowedSiteMissing].filter(
    (id) => !siteDocumentIds.has(id) && physicalDocuments.some((document) => document.id === id),
  );
  const allowedDocumentTypeMissingDocs = [...allowedDocumentTypeMissing].filter(
    (id) => !documentTypeDocumentIds.has(id) && physicalDocuments.some((document) => document.id === id),
  );
  const missingSite = physicalDocuments
    .map((document) => document.id)
    .filter((id) => !siteDocumentIds.has(id) && !allowedSiteMissing.has(id));
  const missingDocumentType = physicalDocuments
    .map((document) => document.id)
    .filter((id) => !documentTypeDocumentIds.has(id) && !allowedDocumentTypeMissing.has(id));

  const registryContractGaps = registryDocuments.flatMap((document) => {
    const metadata = metadataRecord(document.metadata);
    const missingKeys: string[] = requiredRegistryMetadataKeys.filter((key) => {
      if (key === "source_kind") return metadata.source_kind !== "registry_record";
      if (key === "registry_record_kind") return registryKindFor(document) === null;
      return !nonEmptyMetadataValue(metadata[key]);
    });
    const kind = registryKindFor(document);
    const documentLabels = labelsByDocument.get(document.id) ?? [];
    const expectedIntent = kind ? registryIntentByKind[kind] : null;
    const hasExpectedIntent =
      expectedIntent !== null &&
      documentLabels.some(
        (label) =>
          label.source === "generated" && label.label_type === "document_intent" && label.label === expectedIntent,
      );
    const hasGeneratedSite = documentLabels.some(
      (label) => label.source === "generated" && label.label_type === "site",
    );
    if (!hasExpectedIntent) missingKeys.push("smart_v2_document_intent");
    if (hasGeneratedSite) missingKeys.push("generated_site_label");
    return missingKeys.length > 0
      ? [{ id: document.id, title: document.title, file_name: document.file_name, missing_keys: [...missingKeys] }]
      : [];
  });

  const qualityIssues = reviewDocumentTagQuality(
    documents.map((document) => ({
      ...document,
      labels: labelsByDocument.get(document.id) ?? [],
    })),
  );
  const passed =
    missingGenerated.length === 0 &&
    missingSite.length === 0 &&
    missingDocumentType.length === 0 &&
    registryContractGaps.length === 0;

  return {
    indexed_documents: documents.length,
    physical_documents: physicalDocuments.length,
    registry_documents: registryDocuments.length,
    generated_label_rows: labels.length,
    generated_documents: generatedDocumentIds.size,
    indexed_without_generated: missingGenerated.length,
    indexed_without_site: missingSite.length,
    indexed_without_document_type: missingDocumentType.length,
    smart_v2_label_rows: smartV2Labels.length,
    smart_v2_documents: smartV2DocumentIds.size,
    indexed_without_smart_v2: missingSmartV2.length,
    labels_by_type: countByLabelType(labels),
    smart_v2_labels_by_type: countByLabelType(smartV2Labels),
    label_quality_issue_count: qualityIssues.length,
    label_quality_issue_counts: countQualityIssues(qualityIssues),
    sample_label_quality_issues: qualityIssues.slice(0, 10).map((issue) => ({
      kind: issue.kind,
      label: issue.label,
      canonical_label: issue.canonicalLabel,
      label_type: issue.label_type,
      count: issue.count,
      reason: issue.reason,
      examples: issue.examples,
      document_titles: issue.documentTitles,
    })),
    physical_contract: {
      indexed_documents: physicalDocuments.length,
      without_site: missingSite.length,
      without_document_type: missingDocumentType.length,
      passed: missingSite.length === 0 && missingDocumentType.length === 0,
    },
    registry_contract: {
      indexed_documents: registryDocuments.length,
      documents_with_gaps: registryContractGaps.length,
      sample_gaps: registryContractGaps.slice(0, 25),
      passed: registryContractGaps.length === 0,
    },
    sample_missing_generated: missingGenerated.slice(0, 10),
    sample_missing_site: missingSite.slice(0, 10),
    sample_missing_document_type: missingDocumentType.slice(0, 10),
    sample_missing_smart_v2: missingSmartV2.slice(0, 10),
    allowed_site_missing: allowedSiteMissing.size,
    allowed_document_type_missing: allowedDocumentTypeMissing.size,
    allowed_site_missing_docs: allowedSiteMissingDocs,
    allowed_document_type_missing_docs: allowedDocumentTypeMissingDocs,
    passed,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const supabase = await loadAdminClient();
  const allowedSiteMissing = await loadAllowlist(args.allowedSiteMissingPath);
  const allowedDocumentTypeMissing = await loadAllowlist(args.allowedDocumentTypeMissingPath);
  const documents = await fetchAll<DocumentLabelCoverageDocument>(
    supabase,
    "documents",
    "id,title,file_name,file_type,source_path,metadata",
    (query) => query.eq("status", "indexed"),
  );
  const labels = await fetchAll<DocumentLabelCoverageLabel>(
    supabase,
    "document_labels",
    "id,document_id,label,label_type,source,confidence",
    (query) => query.eq("source", "generated"),
  );

  const report = buildDocumentLabelCoverageReport({
    documents,
    labels,
    allowedSiteMissing,
    allowedDocumentTypeMissing,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("[Document Label Coverage]");
    console.log(`Indexed documents: ${report.indexed_documents}`);
    console.log(`Physical documents: ${report.physical_documents}`);
    console.log(`Registry documents: ${report.registry_documents}`);
    console.log(`Generated label rows: ${report.generated_label_rows}`);
    console.log(`Documents with generated labels: ${report.generated_documents}`);
    console.log(`Indexed without generated labels: ${report.indexed_without_generated}`);
    console.log(`Indexed without site label: ${report.indexed_without_site}`);
    console.log(`Indexed without document_type label: ${report.indexed_without_document_type}`);
    console.log(`Smart-v2 label rows: ${report.smart_v2_label_rows}`);
    console.log(`Documents with smart-v2 labels: ${report.smart_v2_documents}`);
    console.log(`Indexed without smart-v2 labels: ${report.indexed_without_smart_v2}`);
    console.log(
      `Labels by type: ${Object.entries(report.labels_by_type)
        .map(([type, count]) => `${type}=${count}`)
        .join(", ")}`,
    );
    console.log(
      `Smart-v2 labels by type: ${Object.entries(report.smart_v2_labels_by_type)
        .map(([type, count]) => `${type}=${count}`)
        .join(", ")}`,
    );
    console.log(`Label quality issues: ${report.label_quality_issue_count}`);
    console.log(
      `Label quality issue counts: ${Object.entries(report.label_quality_issue_counts)
        .map(([type, count]) => `${type}=${count}`)
        .join(", ")}`,
    );
    console.log(`Registry contract gaps: ${report.registry_contract.documents_with_gaps}`);
    if (report.allowed_site_missing_docs.length) {
      console.log(
        `Allowed indexed docs without site labels (from allowlist): ${report.allowed_site_missing_docs.length}`,
      );
    }
    if (report.allowed_document_type_missing_docs.length) {
      console.log(
        `Allowed indexed docs without document_type labels (from allowlist): ${report.allowed_document_type_missing_docs.length}`,
      );
    }
    console.log(
      report.passed ? "PASS: generated label coverage is complete." : "FAIL: generated label coverage has gaps.",
    );
  }

  if (!report.passed) process.exitCode = 1;
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
