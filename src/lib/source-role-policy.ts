import {
  australianSourceByKey,
  australianSourcePolicyVersion,
  type AustralianSourceDefinition,
} from "@/lib/australian-source-catalogue";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import type {
  ClinicalClaimRole,
  ClinicalSourceMetadata,
  ClinicalSourceRole,
  SearchResult,
  SourceEligibilityDecision,
  SourcePolicyConflict,
  SourcePolicyConflictSide,
  SourcePrimaryDecision,
  VerifiedSourcePolicyDifference,
} from "@/lib/types";

const eligibleSourceRoles: Record<ClinicalClaimRole, ReadonlySet<ClinicalSourceRole>> = {
  treatment: new Set(["local_guideline", "clinical_guideline", "clinical_reference", "professional_review"]),
  dose_or_monitoring: new Set([
    "local_guideline",
    "clinical_guideline",
    "clinical_reference",
    "regulatory",
    "professional_review",
  ]),
  safety: new Set([
    "local_guideline",
    "clinical_guideline",
    "clinical_reference",
    "safety_alert",
    "regulatory",
    "quality_standard",
    "professional_review",
  ]),
  legal: new Set(["legal", "regulatory", "service_policy"]),
  subsidy: new Set(["subsidy"]),
  quality: new Set(["quality_standard", "service_policy", "clinical_guideline"]),
  service_workflow: new Set([
    "local_guideline",
    "clinical_guideline",
    "service_directory",
    "form_reference",
    "tool_reference",
    "service_policy",
  ]),
};

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isExpired(expiryDate: string | null) {
  if (!expiryDate) return false;
  const expiryTimestamp = Date.parse(expiryDate);
  return Number.isFinite(expiryTimestamp) && expiryTimestamp < Date.now();
}

function matchesCatalogueIdentity(source: ClinicalSourceMetadata, catalogue: AustralianSourceDefinition | null) {
  if (!catalogue) return false;
  return (
    source.source_policy_version === australianSourcePolicyVersion &&
    source.content_mode === catalogue.contentMode &&
    source.publisher_code?.trim().toUpperCase() === catalogue.publisherCode.toUpperCase() &&
    source.publisher === catalogue.publisher &&
    source.jurisdiction === catalogue.jurisdiction &&
    Boolean(source.source_role && catalogue.roles.includes(source.source_role))
  );
}

export function sourceEligibilityForClaim(args: {
  source: ClinicalSourceMetadata;
  claimRole: ClinicalClaimRole;
}): SourceEligibilityDecision {
  const { source } = args;

  if (source.content_mode === "link_only" || source.source_role === "reference_link") {
    return { eligible: false, reason: "link_only" };
  }

  const catalogue = source.source_catalogue_key ? australianSourceByKey(source.source_catalogue_key) : null;
  if (source.corpus_scope === "australian_public" && !matchesCatalogueIdentity(source, catalogue)) {
    return { eligible: false, reason: "catalogue_mismatch" };
  }

  if (
    source.change_state === "withdrawn" ||
    source.change_state === "superseded" ||
    nonEmpty(source.superseded_by_document_id) ||
    catalogue?.lifecycle === "historical" ||
    catalogue?.lifecycle === "retired"
  ) {
    return { eligible: false, reason: "inactive" };
  }

  if (source.document_status !== "current" || isExpired(source.expiry_date)) {
    return { eligible: false, reason: "not_current" };
  }

  if (source.extraction_quality !== "good") {
    return { eligible: false, reason: "governance_block" };
  }

  if (source.corpus_scope === "australian_public" && source.licence_policy !== "public_index_permitted") {
    return { eligible: false, reason: "governance_block" };
  }

  if (!source.source_role || !eligibleSourceRoles[args.claimRole].has(source.source_role)) {
    return { eligible: false, reason: "role_mismatch" };
  }

  return { eligible: true, reason: "eligible" };
}

function directlySupportiveLocal(result: SearchResult) {
  const source = normalizeSourceMetadata(result.source_metadata);
  return (
    source?.corpus_scope === "uploaded_local" &&
    source.source_role === "local_guideline" &&
    (source.clinical_validation_status === "approved" || source.clinical_validation_status === "locally_reviewed") &&
    source.extraction_quality === "good" &&
    result.relevance?.verdict === "direct"
  );
}

function completeConflictSide(
  result: SearchResult,
  supportingChunkIds: string[],
  expectedCorpusScope: "uploaded_local" | "australian_public",
): SourcePolicyConflictSide | null {
  const source = result.source_metadata;
  if (
    !source ||
    source.corpus_scope !== expectedCorpusScope ||
    !nonEmpty(result.document_id) ||
    !nonEmpty(result.title) ||
    !nonEmpty(source.source_catalogue_key) ||
    !nonEmpty(source.publisher) ||
    !nonEmpty(source.jurisdiction) ||
    !source.source_role ||
    (!nonEmpty(source.publication_date) && !nonEmpty(source.effective_date)) ||
    supportingChunkIds.length === 0
  ) {
    return null;
  }

  return {
    documentId: result.document_id,
    catalogueKey: source.source_catalogue_key,
    title: result.title,
    publisher: source.publisher,
    publicationDate: source.publication_date ?? null,
    effectiveFrom: source.effective_date ?? null,
    jurisdiction: source.jurisdiction,
    sourceRole: source.source_role,
    corpusScope: source.corpus_scope,
    supportingChunkIds,
  };
}

function groupVerifiedChunksByDocument(results: SearchResult[], verifiedChunkIds: string[]) {
  const verified = new Set(verifiedChunkIds);
  const byDocument = new Map<string, { result: SearchResult; chunkIds: string[] }>();

  for (const result of [...results].sort(
    (left, right) => left.document_id.localeCompare(right.document_id) || left.id.localeCompare(right.id),
  )) {
    if (!verified.has(result.id)) continue;
    const existing = byDocument.get(result.document_id);
    if (existing) {
      if (!existing.chunkIds.includes(result.id)) existing.chunkIds.push(result.id);
    } else {
      byDocument.set(result.document_id, { result, chunkIds: [result.id] });
    }
  }

  return [...byDocument.values()];
}

function conflictId(args: {
  difference: VerifiedSourcePolicyDifference;
  localDocumentId: string;
  australianDocumentId: string;
}) {
  const segments = [
    args.difference.claimRole,
    args.difference.topicKey,
    args.localDocumentId,
    args.australianDocumentId,
    args.difference.overlapReason,
    args.difference.materialDifferenceReason,
  ];
  return `source-policy-conflict-v1:${segments.map((segment) => encodeURIComponent(segment)).join(":")}`;
}

function buildConflicts(args: {
  local: SearchResult[];
  australian: SearchResult[];
  claimRole: ClinicalClaimRole;
  verifiedDifferences: VerifiedSourcePolicyDifference[];
}) {
  const conflicts: SourcePolicyConflict[] = [];

  for (const difference of args.verifiedDifferences) {
    if (difference.claimRole !== args.claimRole || !nonEmpty(difference.topicKey)) continue;
    const localDocuments = groupVerifiedChunksByDocument(args.local, difference.localChunkIds);
    const australianDocuments = groupVerifiedChunksByDocument(args.australian, difference.australianChunkIds);

    for (const localDocument of localDocuments) {
      const localSide = completeConflictSide(localDocument.result, localDocument.chunkIds, "uploaded_local");
      if (!localSide || localSide.corpusScope !== "uploaded_local") continue;

      for (const australianDocument of australianDocuments) {
        const australianSide = completeConflictSide(
          australianDocument.result,
          australianDocument.chunkIds,
          "australian_public",
        );
        if (!australianSide || australianSide.corpusScope !== "australian_public") continue;

        conflicts.push({
          version: "source-policy-conflict-v1",
          id: conflictId({
            difference,
            localDocumentId: localSide.documentId,
            australianDocumentId: australianSide.documentId,
          }),
          claimRole: difference.claimRole,
          topicKey: difference.topicKey,
          local: localSide as SourcePolicyConflict["local"],
          australian: australianSide as SourcePolicyConflict["australian"],
          overlapReason: difference.overlapReason,
          materialDifferenceReason: difference.materialDifferenceReason,
          localPrimaryDecision: {
            selected: "uploaded_local",
            reason: "current_valid_accessible_directly_supportive",
          },
          reviewTargetDocumentId: localSide.documentId,
        });
      }
    }
  }

  const conflictsById = new Map<string, SourcePolicyConflict>();
  for (const conflict of conflicts) {
    if (!conflictsById.has(conflict.id)) conflictsById.set(conflict.id, conflict);
  }
  return [...conflictsById.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveLocalAndAustralianEvidence(args: {
  local: SearchResult[];
  australian: SearchResult[];
  claimRole: ClinicalClaimRole;
  verifiedDifferences: VerifiedSourcePolicyDifference[];
}): {
  primary: SearchResult[];
  augmentation: SearchResult[];
  conflicts: SourcePolicyConflict[];
  reviewDocumentIds: string[];
  primaryDecision: SourcePrimaryDecision;
} {
  const eligibleLocal = args.local.filter((result) => {
    const source = normalizeSourceMetadata(result.source_metadata);
    return sourceEligibilityForClaim({ source, claimRole: args.claimRole }).eligible;
  });
  const eligibleAustralian = args.australian.filter((result) => {
    const source = normalizeSourceMetadata(result.source_metadata);
    return sourceEligibilityForClaim({ source, claimRole: args.claimRole }).eligible;
  });
  const localPrimary = eligibleLocal.filter(directlySupportiveLocal);
  const primary = localPrimary.length > 0 ? localPrimary : eligibleAustralian;
  const augmentation = localPrimary.length > 0 ? eligibleAustralian : eligibleLocal;
  const primaryDecision: SourcePrimaryDecision =
    localPrimary.length > 0
      ? { selected: "uploaded_local", reason: "current_valid_accessible_directly_supportive" }
      : eligibleAustralian.length > 0
        ? {
            selected: "australian_public",
            reason: eligibleLocal.length > 0 ? "uploaded_local_not_directly_supportive" : "no_eligible_uploaded_local",
          }
        : { selected: "none", reason: "no_eligible_primary_evidence" };
  const conflicts =
    localPrimary.length > 0
      ? buildConflicts({
          local: localPrimary,
          australian: eligibleAustralian,
          claimRole: args.claimRole,
          verifiedDifferences: args.verifiedDifferences,
        })
      : [];
  const reviewDocumentIds = [...new Set(conflicts.map((conflict) => conflict.reviewTargetDocumentId))].sort(
    (left, right) => left.localeCompare(right),
  );

  return { primary, augmentation, conflicts, reviewDocumentIds, primaryDecision };
}
