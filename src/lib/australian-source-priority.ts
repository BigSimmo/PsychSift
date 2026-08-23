import { classifySourceAuthority, type AustralianSourceTier } from "@/lib/source-authority-registry";
import { filterSourcesEligibleForClaim } from "@/lib/source-governance";
import type { ClinicalClaimRole, SearchResult } from "@/lib/types";

export type { AustralianSourceTier, SourceAuthorityClassification } from "@/lib/source-authority-registry";

export type AustralianSourceSelectionSummary = {
  candidateCount: number;
  selectedCount: number;
  australianCandidateCount: number;
  australianSelectedCount: number;
  waCandidateCount: number;
  waSelectedCount: number;
  authoritativeAustralianDocumentCount: number;
  authorityConflictCount: number;
  usedSupplementaryFallback: boolean;
};

const tierRank: Record<AustralianSourceTier, number> = {
  wa_validated: 0,
  australian_national: 1,
  australian_state: 2,
  supplementary: 3,
};

const relevanceRank = {
  direct: 0,
  partial: 1,
  nearby: 2,
  none: 3,
} as const;

export function australianSourceClassification(result: Pick<SearchResult, "source_metadata">) {
  return classifySourceAuthority(result.source_metadata);
}

export function australianSourceTier(result: Pick<SearchResult, "source_metadata">): AustralianSourceTier {
  return australianSourceClassification(result).tier;
}

export function isAustralianSourceTier(tier: AustralianSourceTier) {
  return tier !== "supplementary";
}

function capClinicalContextPerDocument(results: SearchResult[], maxPerDocument: number) {
  if (new Set(results.map((result) => result.document_id)).size < 2) return results;

  const documentCounts = new Map<string, number>();
  return results.filter((result) => {
    const count = documentCounts.get(result.document_id) ?? 0;
    if (count >= maxPerDocument) return false;
    documentCounts.set(result.document_id, count + 1);
    return true;
  });
}

function resultRelevanceRank(result: SearchResult) {
  return result.relevance?.verdict ? relevanceRank[result.relevance.verdict] : relevanceRank.direct;
}

function isSupplementaryPadding(args: {
  candidate: { result: SearchResult; tier: AustralianSourceTier };
  ranked: Array<{ result: SearchResult; tier: AustralianSourceTier }>;
  sufficientAustralianChunks: number;
}) {
  if (isAustralianSourceTier(args.candidate.tier)) return false;
  const candidateRelevance = resultRelevanceRank(args.candidate.result);
  const australianAtLeastAsRelevant = args.ranked.filter(
    ({ result, tier }) => isAustralianSourceTier(tier) && resultRelevanceRank(result) <= candidateRelevance,
  );
  return (
    australianAtLeastAsRelevant.length >= args.sufficientAustralianChunks &&
    new Set(australianAtLeastAsRelevant.map(({ result }) => result.document_id)).size >= 2
  );
}

/**
 * Select a bounded clinical context while preferring authoritative Australian
 * evidence inside the same relevance band. Supplementary material remains
 * available until Australian evidence is sufficient on its own.
 */
export function selectAustralianClinicalContext(
  results: SearchResult[],
  options: {
    claimRole: ClinicalClaimRole;
    limit?: number;
    maxPerDocument?: number;
    sufficientAustralianChunks?: number;
    omitSupplementaryPadding?: boolean;
  },
) {
  if (!options?.claimRole) throw new Error("A verified claim role is required before source ranking.");
  const limit = options.limit ?? 6;
  const maxPerDocument = options.maxPerDocument ?? 2;
  const sufficientAustralianChunks = options.sufficientAustralianChunks ?? 4;
  const omitSupplementaryPadding = options.omitSupplementaryPadding ?? true;
  const eligibleResults = filterSourcesEligibleForClaim(results, options.claimRole);
  const ranked = eligibleResults
    .map((result, index) => ({ result, index, tier: australianSourceTier(result) }))
    .filter(({ result }) => result.relevance?.verdict !== "none")
    .sort((left, right) => {
      const leftRelevance = resultRelevanceRank(left.result);
      const rightRelevance = resultRelevanceRank(right.result);
      return leftRelevance - rightRelevance || tierRank[left.tier] - tierRank[right.tier] || left.index - right.index;
    });
  const withoutSupplementaryPadding = omitSupplementaryPadding
    ? ranked.filter((candidate) => !isSupplementaryPadding({ candidate, ranked, sufficientAustralianChunks }))
    : ranked;
  const capped = capClinicalContextPerDocument(
    withoutSupplementaryPadding.map(({ result }) => result),
    maxPerDocument,
  );
  return capped.slice(0, limit);
}

export function summarizeAustralianSourceSelection(
  candidates: SearchResult[],
  selected: SearchResult[],
): AustralianSourceSelectionSummary {
  const candidateClassifications = candidates.map(australianSourceClassification);
  const selectedTiers = selected.map(australianSourceTier);
  const authoritativeDocuments = new Set(
    selected
      .filter((result) => isAustralianSourceTier(australianSourceTier(result)))
      .map((result) => result.document_id),
  );

  return {
    candidateCount: candidates.length,
    selectedCount: selected.length,
    australianCandidateCount: candidateClassifications.filter((item) => isAustralianSourceTier(item.tier)).length,
    australianSelectedCount: selectedTiers.filter(isAustralianSourceTier).length,
    waCandidateCount: candidateClassifications.filter((item) => item.tier === "wa_validated").length,
    waSelectedCount: selectedTiers.filter((tier) => tier === "wa_validated").length,
    authoritativeAustralianDocumentCount: authoritativeDocuments.size,
    authorityConflictCount: candidateClassifications.filter((item) => item.conflict).length,
    usedSupplementaryFallback: selectedTiers.some((tier) => tier === "supplementary"),
  };
}
