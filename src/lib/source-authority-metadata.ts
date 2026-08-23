import {
  classifySourceAuthority,
  sourceAuthorityForPublisher,
  sourceAuthorityForPublisherCode,
  sourceAuthorityRegistry,
  type SourceAuthorityDefinition,
} from "@/lib/source-authority-registry";
import {
  australianSourceCatalogue,
  australianSourcePolicyVersion,
  type AustralianSourceDefinition,
} from "@/lib/australian-source-catalogue";

export const localityMetadataKeys = ["publisher_code", "publisher", "jurisdiction"] as const;

export type LocalityMetadataKey = (typeof localityMetadataKeys)[number];

export type SourceAuthorityDocumentIdentity = {
  id?: string;
  title: string;
  file_name: string;
  source_path?: string | null;
};

export type SourceAuthorityDocument = SourceAuthorityDocumentIdentity & {
  metadata: Record<string, unknown> | null;
};

export type SourceIdentityAuthorityMatch = {
  authority: SourceAuthorityDefinition | null;
  code: string | null;
  codes: string[];
  conflict: boolean;
  authorityKeys: string[];
};

export type SourceLocalityAnalysis = {
  authority: SourceAuthorityDefinition | null;
  matchedBy: "publisher_code" | "identity_code" | "publisher_alias" | "none";
  excludedReason: "registry_record" | null;
  targetCode: string | null;
  conflicts: string[];
  unresolvedConflict: boolean;
  missingLocalityKeys: LocalityMetadataKey[];
  changes: Partial<Record<LocalityMetadataKey, string>>;
  changedKeys: LocalityMetadataKey[];
};

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedCode(value: unknown) {
  return metadataString(value)?.toUpperCase() ?? null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const registeredCodes = sourceAuthorityRegistry
  .flatMap((authority) => authority.codes.map((code) => ({ code: code.toUpperCase(), authority })))
  .sort((left, right) => right.code.length - left.code.length || left.code.localeCompare(right.code));

const caseSensitiveIdentityCodes = new Set(["WHO"]);

const compiledRegisteredCodes = registeredCodes.map((candidate) => {
  const flags = caseSensitiveIdentityCodes.has(candidate.code) ? "" : "i";
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(candidate.code)}(?=$|[^A-Za-z0-9])`, flags);
  return { ...candidate, pattern };
});

function authorityMatchesInField(field: string) {
  return compiledRegisteredCodes
    .filter((candidate) => {
      candidate.pattern.lastIndex = 0;
      return candidate.pattern.test(field);
    })
    .map((candidate) => ({ code: candidate.code, authority: candidate.authority }));
}

function preferredIdentityMatches(identity: SourceAuthorityDocumentIdentity) {
  const trailingParenthetical = identity.file_name.match(/\(([^()]*)\)\s*(?:\.[^./\\]+)?$/)?.[1];
  const trailingMatches = trailingParenthetical ? authorityMatchesInField(trailingParenthetical) : [];
  if (trailingMatches.length > 0) return trailingMatches;

  const fileMatches = authorityMatchesInField(identity.file_name);
  if (fileMatches.length > 0) return fileMatches;

  const titleMatches = authorityMatchesInField(identity.title);
  if (titleMatches.length > 0) return titleMatches;

  const pathSegments = (identity.source_path ?? "")
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reverse();
  for (const segment of pathSegments) {
    const segmentMatches = authorityMatchesInField(segment);
    if (segmentMatches.length > 0) return segmentMatches;
  }

  return [];
}

/**
 * Infer an authority only from exact registered code tokens in document identity
 * fields. Publisher names and clinical document prose are never authority evidence.
 */
export function inferSourceAuthorityFromIdentity(
  identity: SourceAuthorityDocumentIdentity,
): SourceIdentityAuthorityMatch {
  const matches = preferredIdentityMatches(identity).filter(
    (candidate, index, all) => all.findIndex((match) => match.code === candidate.code) === index,
  );

  const authorityKeys = [...new Set(matches.map((match) => match.authority.key))];
  const conflict = authorityKeys.length > 1;
  const first = matches[0] ?? null;

  return {
    authority: conflict ? null : (first?.authority ?? null),
    code: conflict ? null : (first?.code ?? null),
    codes: matches.map((match) => match.code),
    conflict,
    authorityKeys,
  };
}

function canonicalJurisdiction(authority: SourceAuthorityDefinition) {
  return authority.jurisdictions[0] ?? null;
}

function valuesDiffer(current: unknown, next: string | null) {
  if (!next) return false;
  return metadataString(current) !== next;
}

export function isRegistryRecordSource(document: Pick<SourceAuthorityDocument, "metadata">) {
  return metadataRecord(document.metadata).source_kind === "registry_record";
}

export function analyzeSourceLocality(document: SourceAuthorityDocument): SourceLocalityAnalysis {
  const metadata = metadataRecord(document.metadata);
  if (isRegistryRecordSource(document)) {
    return {
      authority: null,
      matchedBy: "none",
      excludedReason: "registry_record",
      targetCode: null,
      conflicts: [],
      unresolvedConflict: false,
      missingLocalityKeys: [],
      changes: {},
      changedKeys: [],
    };
  }
  const existingCode = normalizedCode(metadata.publisher_code);
  const codeAuthority = sourceAuthorityForPublisherCode(existingCode);
  const publisherAuthority = sourceAuthorityForPublisher(metadataString(metadata.publisher));
  const identityMatch = inferSourceAuthorityFromIdentity(document);
  const classification = classifySourceAuthority(metadata);
  const identityClassification = identityMatch.code
    ? classifySourceAuthority({ ...metadata, publisher_code: identityMatch.code })
    : null;
  const conflicts: string[] = [...classification.conflicts];
  let unresolvedConflict = identityMatch.conflict;

  if (identityMatch.conflict) conflicts.push(`identity_multiple_authorities:${identityMatch.authorityKeys.join(",")}`);
  if (
    codeAuthority &&
    publisherAuthority &&
    codeAuthority.key !== publisherAuthority.key &&
    classification.conflicts.includes("publisher_mismatch")
  ) {
    conflicts.push(`publisher_code_publisher_conflict:${codeAuthority.key}/${publisherAuthority.key}`);
    unresolvedConflict = true;
  }
  if (codeAuthority && identityMatch.authority && codeAuthority.key !== identityMatch.authority.key) {
    conflicts.push(`publisher_code_identity_conflict:${codeAuthority.key}/${identityMatch.authority.key}`);
    unresolvedConflict = true;
  }
  if (
    !codeAuthority &&
    identityMatch.authority &&
    publisherAuthority &&
    identityMatch.authority.key !== publisherAuthority.key &&
    identityClassification?.conflicts.includes("publisher_mismatch")
  ) {
    conflicts.push(`publisher_identity_conflict:${publisherAuthority.key}/${identityMatch.authority.key}`);
    unresolvedConflict = true;
  }

  const authority = unresolvedConflict ? null : (codeAuthority ?? identityMatch.authority ?? publisherAuthority);
  if (authority && existingCode && !codeAuthority) conflicts.push(`publisher_code_unrecognized:${existingCode}`);
  const matchedBy = codeAuthority
    ? "publisher_code"
    : identityMatch.authority
      ? "identity_code"
      : publisherAuthority
        ? "publisher_alias"
        : "none";
  const targetCode = authority
    ? codeAuthority?.key === authority.key && existingCode
      ? existingCode
      : identityMatch.authority?.key === authority.key && identityMatch.code
        ? identityMatch.code
        : (authority.codes[0] ?? null)
    : null;
  const targetJurisdiction = authority ? canonicalJurisdiction(authority) : null;
  const changes: Partial<Record<LocalityMetadataKey, string>> = {};

  if (authority && targetCode && valuesDiffer(metadata.publisher_code, targetCode)) changes.publisher_code = targetCode;
  if (authority && valuesDiffer(metadata.publisher, authority.publisher)) changes.publisher = authority.publisher;
  if (authority && targetJurisdiction && valuesDiffer(metadata.jurisdiction, targetJurisdiction)) {
    changes.jurisdiction = targetJurisdiction;
  }

  const missingLocalityKeys =
    authority && authority.scope !== "international"
      ? localityMetadataKeys.filter((key) => !metadataString(metadata[key]))
      : [];

  return {
    authority,
    matchedBy,
    excludedReason: null,
    targetCode,
    conflicts: [...new Set(conflicts)],
    unresolvedConflict,
    missingLocalityKeys,
    changes,
    changedKeys: localityMetadataKeys.filter((key) => changes[key] !== undefined),
  };
}

export function assertLocalityMetadataPatch(patch: Record<string, unknown>) {
  const invalidKeys = Object.keys(patch).filter(
    (key): key is string => !localityMetadataKeys.includes(key as LocalityMetadataKey),
  );
  if (invalidKeys.length > 0) {
    throw new Error(`Locality-only metadata patch contains disallowed keys: ${invalidKeys.sort().join(", ")}`);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Locality-only metadata patch ${key} must be a non-empty string.`);
    }
  }
}

function compactAuthorityDocument(document: SourceAuthorityDocument, analysis: SourceLocalityAnalysis) {
  const metadata = metadataRecord(document.metadata);
  return {
    id: document.id ?? null,
    title: document.title,
    file_name: document.file_name,
    publisher_code: metadataString(metadata.publisher_code),
    publisher: metadataString(metadata.publisher),
    jurisdiction: metadataString(metadata.jurisdiction),
    authority_key: analysis.authority?.key ?? null,
    authority_scope: analysis.authority?.scope ?? null,
    matched_by: analysis.matchedBy,
    source_kind: metadataString(metadata.source_kind),
    excluded_reason: analysis.excludedReason,
  };
}

/** Merge the full safe locality patch so audit designations match proposed corrections. */
function metadataWithProposedLocality(document: SourceAuthorityDocument, analysis: SourceLocalityAnalysis) {
  const metadata = { ...metadataRecord(document.metadata) };
  for (const key of localityMetadataKeys) {
    const next = analysis.changes[key];
    if (next !== undefined) metadata[key] = next;
  }
  return metadata;
}

function designationForAudit(document: SourceAuthorityDocument, analysis: SourceLocalityAnalysis) {
  if (analysis.excludedReason === "registry_record") return "unclassified";
  return classifySourceAuthority(metadataWithProposedLocality(document, analysis)).designation;
}

export function auditSourceAuthorityDocuments(documents: SourceAuthorityDocument[]) {
  const analyses = documents.map((document) => ({ document, analysis: analyzeSourceLocality(document) }));
  const recognized = analyses.filter(({ analysis }) => analysis.authority);
  const australianCandidates = recognized.filter(({ analysis }) => analysis.authority?.scope !== "international");
  const conflicts = analyses.filter(({ analysis }) => analysis.conflicts.length > 0);
  const missingLocality = australianCandidates.filter(({ analysis }) => analysis.missingLocalityKeys.length > 0);
  const proposedCorrections = analyses.filter(
    ({ analysis }) => !analysis.unresolvedConflict && analysis.changedKeys.length > 0,
  );
  const designationCounts = analyses.reduce<Record<string, number>>(
    (counts, { document, analysis }) => {
      const designation = designationForAudit(document, analysis);
      counts[designation] = (counts[designation] ?? 0) + 1;
      return counts;
    },
    { official: 0, trusted: 0, unclassified: 0 },
  );
  const unclassifiedSamples = analyses
    .filter(({ document, analysis }) => designationForAudit(document, analysis) === "unclassified")
    .slice(0, 20);
  const conflictReasonCounts = conflicts.reduce<Record<string, number>>((counts, { analysis }) => {
    for (const conflict of analysis.conflicts) counts[conflict] = (counts[conflict] ?? 0) + 1;
    return counts;
  }, {});
  const excludedRegistryRecords = analyses.filter(({ analysis }) => analysis.excludedReason === "registry_record");

  return {
    recognized_documents: recognized.length,
    australian_authority_candidates: australianCandidates.length,
    international_authority_documents: recognized.length - australianCandidates.length,
    excluded_registry_record_count: excludedRegistryRecords.length,
    designation_counts: designationCounts,
    unclassified_sample_count: unclassifiedSamples.length,
    authority_conflict_count: conflicts.length,
    authority_conflict_reason_counts: Object.fromEntries(
      Object.entries(conflictReasonCounts).sort(([left], [right]) => left.localeCompare(right)),
    ),
    unresolved_authority_conflict_count: conflicts.filter(({ analysis }) => analysis.unresolvedConflict).length,
    missing_australian_locality_count: missingLocality.length,
    proposed_locality_correction_count: proposedCorrections.length,
    passed: conflicts.length === 0 && missingLocality.length === 0,
    unclassified_samples: unclassifiedSamples.map(({ document, analysis }) =>
      compactAuthorityDocument(document, analysis),
    ),
    conflicts: conflicts.map(({ document, analysis }) => ({
      ...compactAuthorityDocument(document, analysis),
      conflicts: analysis.conflicts,
      safe_correction_available: !analysis.unresolvedConflict && analysis.changedKeys.length > 0,
    })),
    missing_australian_locality: missingLocality.map(({ document, analysis }) => ({
      ...compactAuthorityDocument(document, analysis),
      missing_keys: analysis.missingLocalityKeys,
    })),
    proposed_locality_corrections: proposedCorrections.map(({ document, analysis }) => ({
      ...compactAuthorityDocument(document, analysis),
      changed_keys: analysis.changedKeys,
      changes: analysis.changes,
    })),
  };
}

function catalogueEntryForDocument(document: SourceAuthorityDocument): AustralianSourceDefinition | null {
  if (isRegistryRecordSource(document)) return null;
  const metadata = metadataRecord(document.metadata);
  const publisherCode = normalizedCode(metadata.publisher_code);
  const publisher = metadataString(metadata.publisher);
  const jurisdiction = metadataString(metadata.jurisdiction);
  if (!publisherCode || !publisher || !jurisdiction) return null;
  const entry = australianSourceCatalogue.find((candidate) => candidate.publisherCode === publisherCode);
  if (!entry) return null;
  const classification = classifySourceAuthority(metadata);
  if (classification.conflict || classification.authorityKey !== entry.key) return null;
  return entry;
}

/**
 * Build a content-free, read-only proposal report. This intentionally returns
 * no patch or mutation shape: Task 4's reviewed manifest is the only future
 * route for writing Australian policy metadata.
 */
export function auditProposedSourcePolicyMetadata(documents: SourceAuthorityDocument[]) {
  const excludedRegistryRecordCount = documents.filter(isRegistryRecordSource).length;
  const proposals = documents.flatMap((document) => {
    const source = catalogueEntryForDocument(document);
    if (!source) return [];
    return [
      {
        id: document.id ?? null,
        source_catalogue_key: source.key,
        source_policy_version: australianSourcePolicyVersion,
        corpus_scope: source.corpusScope,
        content_mode: source.contentMode,
        licence_policy: source.licencePolicy,
      },
    ];
  });

  return {
    proposed_policy_metadata_count: proposals.length,
    excluded_registry_record_count: excludedRegistryRecordCount,
    proposed_policy_metadata: proposals,
  };
}
