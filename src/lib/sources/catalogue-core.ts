import { createHash } from "node:crypto";

import {
  classifySourceAuthority,
  normalizeSourceAuthorityText,
  sourceCatalogueDesignation,
  sourceCatalogueGeographyScope,
} from "@/lib/source-authority-registry";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import { hasInvalidStructuredSourceDate, strictSourceDate } from "@/lib/sources/source-date-policy";
import {
  SOURCE_RATING_WEIGHTS,
  type ClinicalSourceCatalogueEntry,
  type ClinicalSourceReferenceInput,
  type ClinicalSourceRating,
  type ClinicalSourceType,
  type SourceCanonicalLocation,
  type SourceCatalogueWarning,
  type SourceGeographyScope,
  type SourceLifecycleStatus,
  type SourceUsage,
} from "@/lib/sources/catalogue-types";
import { qualityBandForScore } from "@/lib/sources/rating-method";
import { safeCanonicalSourceUrl } from "@/lib/sources/source-url-policy";

const ACCURACY = { approved: 25, locally_reviewed: 20, unverified: 5, unknown: 0 } as const;
const EVIDENCE = {
  guideline: 20,
  standard: 20,
  legislation: 20,
  regulatory: 20,
  systematic_review: 18,
  primary_study: 14,
  professional_reference: 12,
  consumer_reference: 8,
  uploaded_document: 6,
  dataset: 6,
  other: 4,
  unknown: 0,
} as const;
const AUSTRALIAN = { wa: 15, australian_national: 13, australian_state: 11, international: 6, unknown: 0 } as const;
const CURRENCY = { current: 15, review_due: 8, unknown: 4, outdated: 0 } as const;
const BAND_ORDER = { A: 0, B: 1, C: 2, D: 3, excluded: 4 } as const;
const INCOMPLETE_METADATA_WARNINGS = new Set<SourceCatalogueWarning>([
  "missing_publisher",
  "missing_version",
  "missing_dates",
  "unknown_jurisdiction",
  "unknown_evidence_type",
  "verification_unknown",
  "invalid_date",
]);
const RESOLVED_METADATA_GAP_WARNINGS = new Set<SourceCatalogueWarning>([
  "missing_publisher",
  "missing_version",
  "missing_dates",
  "unknown_jurisdiction",
]);
const COMPATIBILITY_FIELDS = ["publisher", "publisherCode", "jurisdiction", "version"] as const;

function opaqueSourceId(identity: string) {
  return `src_${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

export function safeHttpsUrl(value: string | null) {
  return safeCanonicalSourceUrl(value);
}

function baseIdentity(input: ClinicalSourceReferenceInput) {
  if (input.documentId) return `document:${input.documentId}`;
  if (input.sourceId) return `source:${input.sourceId.trim().toLowerCase()}`;
  const url = safeHttpsUrl(input.canonicalUrl);
  if (url) return `url:${url}`;
  if (input.publisher && input.title) {
    return `title:${normalizeSourceAuthorityText(input.publisher)}|${normalizeSourceAuthorityText(input.title)}|${input.version ?? "unknown"}`;
  }
  const provisionalIdentity = normalizeSourceAuthorityText(input.referenceText ?? input.title);
  return provisionalIdentity ? `provisional:${provisionalIdentity}` : "provisional:unresolved";
}

function metadataValue(value: string | null) {
  return normalizeSourceAuthorityText(value);
}

function compatibleMetadata(left: ClinicalSourceReferenceInput, right: ClinicalSourceReferenceInput) {
  return COMPATIBILITY_FIELDS.every((field) => {
    const leftValue = metadataValue(left[field]);
    const rightValue = metadataValue(right[field]);
    return !leftValue || !rightValue || leftValue === rightValue;
  });
}

function partitionCompatibleReferences(inputs: readonly ClinicalSourceReferenceInput[]) {
  const partitions: ClinicalSourceReferenceInput[][] = [];
  for (const input of [...inputs].sort((left, right) =>
    compareText(canonicalReferenceKey(left), canonicalReferenceKey(right)),
  )) {
    const matches = partitions.filter((partition) =>
      partition.every((candidate) => compatibleMetadata(candidate, input)),
    );
    if (matches.length === 1) matches[0].push(input);
    else partitions.push([input]);
  }
  return partitions;
}

function metadataPartitionKey(inputs: readonly ClinicalSourceReferenceInput[]) {
  return COMPATIBILITY_FIELDS.map((field) => {
    const values = [...new Set(inputs.map((input) => metadataValue(input[field])).filter(Boolean))].sort(compareText);
    return values.join(",") || "unknown";
  }).join("|");
}

function metadataFor(input: ClinicalSourceReferenceInput) {
  return normalizeSourceMetadata({
    source_kind: input.documentId ? "document" : null,
    source_title: input.title,
    publisher: input.publisher,
    publisher_code: input.publisherCode,
    jurisdiction: input.jurisdiction,
    version: input.version,
    publication_date: input.publicationDate,
    review_date: input.reviewDate,
    document_status: input.documentStatus,
    clinical_validation_status: input.validationStatus,
    extraction_quality: input.contentMode === "indexed_content" ? "good" : "unknown",
  });
}

function authorityFor(input: ClinicalSourceReferenceInput) {
  return classifySourceAuthority(metadataFor(input));
}

function geographyFor(input: ClinicalSourceReferenceInput) {
  const classification = authorityFor(input);
  if (classification.conflict) return { scope: "unknown" as const, label: "Unknown" };
  const authority = classification.authority;
  const scope: SourceGeographyScope = authority?.scope ?? sourceCatalogueGeographyScope(input) ?? "unknown";
  const fallbackLabel = {
    wa: "Western Australia",
    australian_national: "Australia",
    australian_state: "Australian state",
    international: "International",
    unknown: "Unknown",
  }[scope];
  return { scope, label: scope === "unknown" ? fallbackLabel : (input.jurisdiction?.trim() ?? fallbackLabel) };
}

function hasStableIdentity(input: ClinicalSourceReferenceInput) {
  return Boolean(
    input.documentId ||
    input.sourceId ||
    safeHttpsUrl(input.canonicalUrl) ||
    (input.publisher?.trim() && input.title?.trim()),
  );
}

function canonicalLocationFor(inputs: readonly ClinicalSourceReferenceInput[]): SourceCanonicalLocation {
  const documentId = uniqueStrings(inputs.map((input) => input.documentId)).at(0);
  if (documentId) {
    return {
      kind: "document",
      documentId,
      href: `/documents/${encodeURIComponent(documentId)}`,
    };
  }
  const href = uniqueStrings(inputs.map((input) => safeHttpsUrl(input.canonicalUrl))).at(0);
  if (href) return { kind: "url", href };
  const dataset = uniqueStrings(inputs.map((input) => input.datasetLocation)).at(0);
  if (dataset) return { kind: "dataset", label: dataset };
  return { kind: "none" };
}

function hasText(value: string | null) {
  return Boolean(value?.trim());
}

function isPastExpiryDate(value: string | null) {
  const date = strictSourceDate(value);
  return Boolean(date && date < new Date().toISOString().slice(0, 10));
}

function effectiveDocumentStatus(input: ClinicalSourceReferenceInput) {
  if (hasInvalidStructuredSourceDate(input.expiryDate)) return "unknown" as const;
  return isPastExpiryDate(input.expiryDate) ? ("outdated" as const) : input.documentStatus;
}

function hasIdentifiedReplacement(input: ClinicalSourceReferenceInput) {
  return input.supersededBy.some(hasText);
}

function effectiveLifecycleStatus(input: ClinicalSourceReferenceInput): SourceLifecycleStatus {
  return hasIdentifiedReplacement(input) ? "excluded" : input.lifecycleStatus;
}

/**
 * True only when the catalogue itself would treat the reference as current and
 * in use: documentStatus `current` after the expiry-date override, and not
 * excluded or superseded. Surfaces that show a source as unqualified guidance
 * use this so they never disagree with the catalogue's own currency verdict.
 */
export function isCurrentActiveSourceReference(input: ClinicalSourceReferenceInput): boolean {
  return effectiveDocumentStatus(input) === "current" && effectiveLifecycleStatus(input) === "active";
}

function sourceWarnings(input: ClinicalSourceReferenceInput): SourceCatalogueWarning[] {
  const authority = authorityFor(input);
  const warnings: SourceCatalogueWarning[] = [];
  if (!hasStableIdentity(input)) warnings.push("ambiguous_identity");
  if (authority.conflict) warnings.push("metadata_conflict");
  if (input.canonicalUrl && !safeHttpsUrl(input.canonicalUrl)) warnings.push("unsafe_location");
  const lastUpdatedDate = input.lastUpdatedDate ?? null;
  if (
    [input.publicationDate, input.reviewDate, lastUpdatedDate, input.expiryDate].some(hasInvalidStructuredSourceDate)
  ) {
    warnings.push("invalid_date");
  }
  if (!hasText(input.publisher)) warnings.push("missing_publisher");
  if (!hasText(input.version)) warnings.push("missing_version");
  if (![input.publicationDate, input.reviewDate, lastUpdatedDate, input.expiryDate].some(hasText)) {
    warnings.push("missing_dates");
  }
  if (!hasText(input.jurisdiction) || geographyFor(input).scope === "unknown") warnings.push("unknown_jurisdiction");
  if (input.evidenceType === "unknown") warnings.push("unknown_evidence_type");
  if (input.validationStatus === "unverified" || input.validationStatus === "unknown") {
    warnings.push("verification_unknown");
  }
  if (effectiveDocumentStatus(input) === "outdated") warnings.push("outdated");
  if (hasIdentifiedReplacement(input)) warnings.push("superseded");
  return sortedWarnings(warnings);
}

function rateClinicalSourceWithWarnings(
  input: ClinicalSourceReferenceInput,
  warnings: readonly SourceCatalogueWarning[],
): ClinicalSourceRating {
  const designation = sourceCatalogueDesignation(input);
  const geography = geographyFor(input);
  const accuracyAssurance = ACCURACY[input.validationStatus];
  const reliability =
    designation === "official"
      ? 20
      : designation === "trusted"
        ? 16
        : hasStableIdentity(input) && Boolean(input.publisher?.trim())
          ? 8
          : 0;
  const evidenceQuality = EVIDENCE[input.evidenceType];
  const currency = CURRENCY[effectiveDocumentStatus(input)];
  const australianApplicability = AUSTRALIAN[geography.scope];
  const traceability = [
    hasStableIdentity(input),
    Boolean(input.version),
    Boolean(input.publicationDate || input.reviewDate || input.lastUpdatedDate || input.expiryDate),
    canonicalLocationFor([input]).kind !== "none",
    Boolean(input.usage.recordId && input.usage.recordLabel && input.usage.field),
  ].filter(Boolean).length;
  const dimensions = {
    accuracyAssurance,
    reliability,
    evidenceQuality,
    currency,
    australianApplicability,
    traceability,
  };
  const score = Object.values(dimensions).reduce((total, value) => total + value, 0);
  const incompleteMetadata = warnings.some((warning) => INCOMPLETE_METADATA_WARNINGS.has(warning));
  const materialUncertainty = warnings.some(
    (warning) =>
      INCOMPLETE_METADATA_WARNINGS.has(warning) ||
      ["ambiguous_identity", "unsafe_location", "metadata_conflict"].includes(warning),
  );
  const lifecycleStatus = effectiveLifecycleStatus(input);
  // Exclusion and material uncertainty are decided before any score, exactly as
  // the published method says. Only a clean score reaches the band table, which
  // `/sources/method` renders from the same definition — see rating-method.ts.
  const band = lifecycleStatus === "excluded" ? "excluded" : materialUncertainty ? "D" : qualityBandForScore(score);

  return {
    score,
    band,
    dimensions,
    weights: SOURCE_RATING_WEIGHTS,
    reasons: [
      `Accuracy assurance: ${accuracyAssurance}/${SOURCE_RATING_WEIGHTS.accuracyAssurance}`,
      `Reliability: ${reliability}/${SOURCE_RATING_WEIGHTS.reliability}`,
      `Evidence quality: ${evidenceQuality}/${SOURCE_RATING_WEIGHTS.evidenceQuality}`,
      `Currency: ${currency}/${SOURCE_RATING_WEIGHTS.currency}`,
      `Australian applicability: ${australianApplicability}/${SOURCE_RATING_WEIGHTS.australianApplicability}`,
      `Traceability: ${traceability}/${SOURCE_RATING_WEIGHTS.traceability}`,
      ...(lifecycleStatus === "excluded"
        ? [
            hasIdentifiedReplacement(input)
              ? "Excluded because a current replacement is identified"
              : "Excluded by lifecycle status",
          ]
        : materialUncertainty
          ? [
              incompleteMetadata
                ? "Incomplete source metadata requires review"
                : "Material identity or verification uncertainty requires review",
            ]
          : []),
    ],
  };
}

export function rateClinicalSource(input: ClinicalSourceReferenceInput): ClinicalSourceRating {
  return rateClinicalSourceWithWarnings(input, sourceWarnings(input));
}

function uniqueStrings(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort(
    compareText,
  );
}

function sortedWarnings(values: readonly SourceCatalogueWarning[]) {
  return [...new Set(values)].sort(compareText);
}

// Hoisted collators. `localeCompare(value, locale, options)` is specified as
// constructing a fresh Intl.Collator per call, so building them once here is the
// same comparison with the construction cost paid once instead of O(n log n)
// times per sort. Ordering is byte-identical — see tests/source-catalogue-collation.test.ts.
const BASE_COLLATOR = new Intl.Collator("en-AU", { sensitivity: "base" });
const FULL_COLLATOR = new Intl.Collator("en-AU");

function compareText(left: string, right: string) {
  return BASE_COLLATOR.compare(left, right) || FULL_COLLATOR.compare(left, right);
}

function canonicalReferenceKey(input: ClinicalSourceReferenceInput) {
  return JSON.stringify([
    input.sourceId,
    input.documentId,
    input.title,
    [...input.aliases].sort(compareText),
    input.publisher,
    input.publisherCode,
    input.jurisdiction,
    input.version,
    input.canonicalUrl,
    input.datasetLocation,
    input.publicationDate,
    input.reviewDate,
    input.expiryDate,
    input.evidenceType,
    input.documentStatus,
    input.validationStatus,
    input.contentMode,
    input.lifecycleStatus,
    [...input.supersedes].sort(compareText),
    [...input.supersededBy].sort(compareText),
    [...input.topics].sort(compareText),
    input.usage.modeId,
    input.usage.recordId,
    input.usage.recordLabel,
    input.usage.field,
    input.referenceText,
    // Appended only when present, so the key of every reference without an update
    // stamp — and therefore its merge order — is byte-identical to before.
    ...(input.lastUpdatedDate ? [input.lastUpdatedDate] : []),
  ]);
}

function uniqueUsages(values: readonly SourceUsage[]) {
  const usages = new Map<string, SourceUsage>();
  for (const usage of values) {
    const key = [usage.modeId, usage.recordId, usage.recordLabel, usage.field].join("\u0000");
    usages.set(key, usage);
  }
  return [...usages.values()].sort((left, right) =>
    compareText(
      [left.modeId, left.recordLabel, left.recordId, left.field].join("\u0000"),
      [right.modeId, right.recordLabel, right.recordId, right.field].join("\u0000"),
    ),
  );
}

function firstString(values: readonly (string | null | undefined)[]) {
  return uniqueStrings(values).at(0) ?? null;
}

function worstValue<T extends string>(values: readonly T[], orderedWorstFirst: readonly T[]) {
  const present = new Set(values);
  return orderedWorstFirst.find((value) => present.has(value)) ?? values[0];
}

function mergedReference(inputs: readonly ClinicalSourceReferenceInput[]): ClinicalSourceReferenceInput {
  const ordered = [...inputs].sort((left, right) =>
    compareText(canonicalReferenceKey(left), canonicalReferenceKey(right)),
  );
  const title = firstString(ordered.map((input) => input.title));
  const referenceText = title ? null : firstString(ordered.map((input) => input.referenceText));
  return {
    ...ordered[0],
    sourceId: firstString(ordered.map((input) => input.sourceId)),
    documentId: firstString(ordered.map((input) => input.documentId)),
    title,
    aliases: uniqueStrings(
      ordered.flatMap((input) => [...input.aliases, ...(input.title && input.title !== title ? [input.title] : [])]),
    ),
    publisher: firstString(ordered.map((input) => input.publisher)),
    publisherCode: firstString(ordered.map((input) => input.publisherCode)),
    canonicalUrl: firstString(ordered.map((input) => safeHttpsUrl(input.canonicalUrl))),
    datasetLocation: firstString(ordered.map((input) => input.datasetLocation)),
    version: firstString(ordered.map((input) => input.version)),
    publicationDate: firstString(ordered.map((input) => strictSourceDate(input.publicationDate))),
    reviewDate: firstString(ordered.map((input) => strictSourceDate(input.reviewDate))),
    lastUpdatedDate: firstString(ordered.map((input) => strictSourceDate(input.lastUpdatedDate ?? null))),
    expiryDate: firstString(ordered.map((input) => strictSourceDate(input.expiryDate))),
    evidenceType: worstValue(
      ordered.map((input) => input.evidenceType),
      [
        "unknown",
        "other",
        "dataset",
        "uploaded_document",
        "consumer_reference",
        "professional_reference",
        "primary_study",
        "systematic_review",
        "guideline",
        "standard",
        "legislation",
        "regulatory",
      ] satisfies ClinicalSourceType[],
    ),
    documentStatus: worstValue(ordered.map(effectiveDocumentStatus), ["outdated", "review_due", "unknown", "current"]),
    validationStatus: worstValue(
      ordered.map((input) => input.validationStatus),
      ["unknown", "unverified", "locally_reviewed", "approved"],
    ),
    contentMode: worstValue(
      ordered.map((input) => input.contentMode),
      ["metadata_only", "link_only", "indexed_content"],
    ),
    lifecycleStatus: worstValue(ordered.map(effectiveLifecycleStatus), [
      "excluded",
      "inactive",
      "active",
    ] satisfies SourceLifecycleStatus[]),
    supersedes: uniqueStrings(ordered.flatMap((input) => input.supersedes)),
    supersededBy: uniqueStrings(ordered.flatMap((input) => input.supersededBy)),
    topics: uniqueStrings(ordered.flatMap((input) => input.topics)),
    usage: uniqueUsages(ordered.map((input) => input.usage))[0],
    referenceText,
  };
}

function catalogueEntry(
  identity: string,
  inputs: readonly ClinicalSourceReferenceInput[],
  metadataConflict: boolean,
): ClinicalSourceCatalogueEntry {
  const merged = mergedReference(inputs);
  const aliases = uniqueStrings(
    inputs.flatMap((input) => [
      ...input.aliases,
      ...(input.title && input.title !== merged.title ? [input.title] : []),
    ]),
  );
  const warnings = sortedWarnings([
    ...sourceWarnings(merged),
    ...inputs.flatMap(sourceWarnings).filter((warning) => !RESOLVED_METADATA_GAP_WARNINGS.has(warning)),
    ...(metadataConflict ? (["metadata_conflict"] satisfies SourceCatalogueWarning[]) : []),
  ]);
  const canonicalLocation = canonicalLocationFor(inputs);
  const title = merged.title ?? firstString(inputs.map((input) => input.referenceText)) ?? "Untitled clinical source";
  return {
    id: opaqueSourceId(identity),
    sourceId: merged.sourceId,
    title,
    aliases,
    version: merged.version,
    publisher: merged.publisher,
    publisherCode: merged.publisherCode,
    sourceType: merged.evidenceType,
    canonicalLocation,
    geography: geographyFor(merged),
    topics: merged.topics,
    publicationDate: merged.publicationDate,
    reviewDate: merged.reviewDate,
    // Only on an entry that has one, so no other entry's shape or payload changes.
    ...(merged.lastUpdatedDate ? { lastUpdatedDate: merged.lastUpdatedDate } : {}),
    expiryDate: merged.expiryDate,
    documentStatus: merged.documentStatus,
    validationStatus: merged.validationStatus,
    contentMode: merged.contentMode,
    lifecycleStatus: merged.lifecycleStatus,
    supersedes: merged.supersedes,
    supersededBy: merged.supersededBy,
    usedBy: uniqueUsages(inputs.map((input) => input.usage)),
    rating: rateClinicalSourceWithWarnings(merged, warnings),
    warnings,
  };
}

export function canonicalizeSourceReferences(
  inputs: readonly ClinicalSourceReferenceInput[],
): ClinicalSourceCatalogueEntry[] {
  const identityGroups = new Map<string, ClinicalSourceReferenceInput[]>();
  const unresolvedByKey = new Map<string, ClinicalSourceReferenceInput[]>();
  // Append in place rather than rebuilding each group array. Rebuilding copied the
  // whole accumulated group per input, so one heavily-shared identity cost O(n^2).
  // Append order and Map insertion order are unchanged, so grouping is identical.
  const appendTo = (
    groups: Map<string, ClinicalSourceReferenceInput[]>,
    key: string,
    input: ClinicalSourceReferenceInput,
  ) => {
    const existing = groups.get(key);
    if (existing) existing.push(input);
    else groups.set(key, [input]);
  };
  for (const input of inputs) {
    const identity = baseIdentity(input);
    if (identity === "provisional:unresolved") {
      appendTo(unresolvedByKey, canonicalReferenceKey(input), input);
      continue;
    }
    appendTo(identityGroups, identity, input);
  }

  const entries = [...unresolvedByKey.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .flatMap(([key, keyInputs]) =>
      keyInputs.map((input, index) =>
        catalogueEntry(`provisional:unresolved|key:${key}|occurrence:${index}`, [input], false),
      ),
    );
  for (const [identity, identityInputs] of identityGroups) {
    const partitions = partitionCompatibleReferences(identityInputs);
    const metadataConflict = partitions.length > 1;
    for (const partition of partitions) {
      entries.push(
        catalogueEntry(
          metadataConflict ? `${identity}|compatibility:${metadataPartitionKey(partition)}` : identity,
          partition,
          metadataConflict,
        ),
      );
    }
  }
  return entries.sort(compareClinicalSources);
}

export function compareClinicalSources(left: ClinicalSourceCatalogueEntry, right: ClinicalSourceCatalogueEntry) {
  return (
    BAND_ORDER[left.rating.band] - BAND_ORDER[right.rating.band] ||
    right.rating.score - left.rating.score ||
    right.rating.dimensions.australianApplicability - left.rating.dimensions.australianApplicability ||
    right.rating.dimensions.currency - left.rating.dimensions.currency ||
    compareText(left.title, right.title) ||
    compareText(left.id, right.id)
  );
}
