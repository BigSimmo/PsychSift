import { isLocalSource, normalizeSourceMetadata } from "@/lib/source-metadata";
import type { SearchScopeFilters } from "@/lib/search-scope";
import type { ClinicalDocument, DocumentLabelType } from "@/lib/types";

export type DocumentLabelFilterKey =
  | "medications"
  | "topics"
  | "documentTypes"
  | "sites"
  | "services"
  | "settings"
  | "populations"
  | "risks"
  | "workflows"
  | "clinicalActions"
  | "carePhases"
  | "documentIntents"
  | "contentFeatures";

export const documentLabelFilterFields: ReadonlyArray<{
  key: DocumentLabelFilterKey;
  label: string;
  labelType: DocumentLabelType;
}> = [
  { key: "medications", label: "Medication", labelType: "medication" },
  { key: "topics", label: "Topic", labelType: "topic" },
  { key: "documentTypes", label: "Document type", labelType: "document_type" },
  { key: "sites", label: "Site", labelType: "site" },
  { key: "services", label: "Service", labelType: "service" },
  { key: "settings", label: "Setting", labelType: "setting" },
  { key: "populations", label: "Population", labelType: "population" },
  { key: "risks", label: "Risk", labelType: "risk" },
  { key: "workflows", label: "Workflow", labelType: "workflow" },
  { key: "clinicalActions", label: "Clinical action", labelType: "clinical_action" },
  { key: "carePhases", label: "Care phase", labelType: "care_phase" },
  { key: "documentIntents", label: "Document intent", labelType: "document_intent" },
  { key: "contentFeatures", label: "Content feature", labelType: "content_feature" },
];

export const sourceStatusLabels: Record<string, string> = {
  current: "Current",
  review_due: "Review due",
  outdated: "Outdated",
  unknown: "Unknown",
};

export const validationStatusLabels: Record<string, string> = {
  approved: "Approved",
  locally_reviewed: "Locally reviewed",
  unverified: "Unverified",
  unknown: "Unknown",
};

export const extractionQualityLabels: Record<string, string> = {
  good: "Good",
  partial: "Partial",
  poor: "Poor",
  unknown: "Unknown",
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function isLocalDocument(document: ClinicalDocument): boolean {
  return isLocalSource(normalizeSourceMetadata(document.metadata));
}

function documentHasAnyLabel(document: ClinicalDocument, type: DocumentLabelType, values: readonly string[]): boolean {
  if (values.length === 0) return true;
  const wanted = new Set(values.map(normalize));
  return (document.labels ?? []).some((label) => label.label_type === type && wanted.has(normalize(label.label)));
}

export function deriveDocumentLabelOptions(
  documents: ReadonlyArray<ClinicalDocument>,
  labelType: DocumentLabelType,
): string[] {
  return [
    ...new Set(
      documents.flatMap((document) =>
        (document.labels ?? [])
          .filter((label) => label.label_type === labelType && label.label.trim())
          .map((label) => label.label.trim()),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export function filterDocumentsByRetrievalScope(
  documents: ReadonlyArray<ClinicalDocument>,
  filters: SearchScopeFilters,
  selectedDocumentIds: ReadonlySet<string> = new Set(),
): ClinicalDocument[] {
  return documents.filter((document) => {
    if (selectedDocumentIds.size > 0 && !selectedDocumentIds.has(document.id)) return false;
    const metadata = normalizeSourceMetadata(document.metadata);
    if (filters.sourceStatuses?.length && !filters.sourceStatuses.includes(metadata.document_status)) return false;
    if (
      filters.validationStatuses?.length &&
      (metadata.clinical_validation_status === "unknown" ||
        !filters.validationStatuses.includes(metadata.clinical_validation_status))
    )
      return false;
    if (filters.extractionQualities?.length && !filters.extractionQualities.includes(metadata.extraction_quality))
      return false;
    if (filters.locality === "local" && !isLocalDocument(document)) return false;
    if (filters.locality === "non_local" && isLocalDocument(document)) return false;
    for (const field of documentLabelFilterFields) {
      if (!documentHasAnyLabel(document, field.labelType, filters[field.key] ?? [])) return false;
    }
    return true;
  });
}

export function projectedDocumentScopeCount(args: {
  documents: ReadonlyArray<ClinicalDocument>;
  filters: SearchScopeFilters;
  selectedDocumentIds?: ReadonlySet<string>;
  key: DocumentLabelFilterKey | "sourceStatuses" | "validationStatuses" | "extractionQualities";
  value: string;
}): number {
  const current = new Set((args.filters[args.key] as string[] | undefined) ?? []);
  if (!current.has(args.value)) current.add(args.value);
  return filterDocumentsByRetrievalScope(
    args.documents,
    { ...args.filters, [args.key]: [...current] },
    args.selectedDocumentIds,
  ).length;
}

export function documentRetrievalFilterValueCount(filters: SearchScopeFilters, selectedDocumentCount = 0): number {
  return (
    selectedDocumentCount +
    documentLabelFilterFields.reduce((total, field) => total + (filters[field.key]?.length ?? 0), 0) +
    (filters.sourceStatuses?.length ?? 0) +
    (filters.validationStatuses?.length ?? 0) +
    (filters.extractionQualities?.length ?? 0) +
    Number(Boolean(filters.locality))
  );
}

export function publicDocumentScopeFilters(filters: SearchScopeFilters): SearchScopeFilters {
  const next = { ...filters };
  // Internal request constraints remain preserved by the caller but are not
  // represented as clinician-facing controls.
  delete next.importBatchIds;
  delete next.labelTypesAny;
  return next;
}

export function mergePublicDocumentScopeFilters(
  existing: SearchScopeFilters,
  publicFilters: SearchScopeFilters,
): SearchScopeFilters {
  return {
    ...publicFilters,
    ...(existing.importBatchIds?.length ? { importBatchIds: existing.importBatchIds } : {}),
    ...(existing.labelTypesAny?.length ? { labelTypesAny: existing.labelTypesAny } : {}),
  };
}

export function sameDocumentScope(left: SearchScopeFilters, right: SearchScopeFilters): boolean {
  const canonical = (filters: SearchScopeFilters) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(filters)
          .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value != null))
          .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value] as const)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
      ),
    );
  return canonical(left) === canonical(right);
}
