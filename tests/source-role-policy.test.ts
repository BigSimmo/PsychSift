import { describe, expect, it } from "vitest";

import { australianSourcePolicyVersion } from "../src/lib/australian-source-catalogue";
import { resolveLocalAndAustralianEvidence, sourceEligibilityForClaim } from "../src/lib/source-role-policy";
import type { ClinicalSourceMetadata, SearchResult, SourceEvidenceRelevance } from "../src/lib/types";

const directRelevance: SourceEvidenceRelevance = {
  verdict: "direct",
  label: "Direct",
  matchedTerms: [],
  missingTerms: [],
  directSourceCount: 1,
  weakSourceCount: 0,
  score: 1,
  supportReason: "Direct support",
  isSourceBacked: true,
  coverageScore: 1,
  rankScore: 1,
  titleMatchedTerms: [],
  contentMatchedTerms: [],
  metadataMatchedTerms: [],
  chips: [],
};

function metadata(overrides: Partial<ClinicalSourceMetadata> = {}): ClinicalSourceMetadata {
  return {
    source_kind: "document",
    registry_record_kind: null,
    registry_record_subkind: null,
    registry_record_id: null,
    registry_record_slug: null,
    source_title: "Local guideline",
    publisher: "WA Health",
    publisher_code: "WAHEALTH",
    jurisdiction: "local",
    version: "1",
    publication_date: "2025-01-01",
    review_date: "2027-01-01",
    uploaded_at: "2025-01-01T00:00:00.000Z",
    indexed_at: "2025-01-02T00:00:00.000Z",
    uploaded_by: null,
    document_status: "current",
    clinical_validation_status: "approved",
    clinical_validation_evidence: null,
    extraction_quality: "good",
    corpus_scope: "uploaded_local",
    source_role: "local_guideline",
    content_mode: "indexed_content",
    source_catalogue_key: "local-guideline",
    source_policy_version: australianSourcePolicyVersion,
    canonical_url: "https://example.test/local-guideline",
    effective_date: "2025-01-01",
    expiry_date: null,
    supersedes_document_id: null,
    superseded_by_document_id: null,
    retrieved_at: null,
    content_hash: "local-hash",
    change_state: "unchanged",
    licence_policy: "public_index_permitted",
    ...overrides,
  };
}

function result(
  overrides: Partial<SearchResult> & { id: string; document_id: string },
  sourceOverrides: Partial<ClinicalSourceMetadata> = {},
): SearchResult {
  return {
    title: "Local guideline",
    file_name: "guideline.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Treatment",
    content: "Directly supportive evidence.",
    image_ids: [],
    similarity: 0.9,
    images: [],
    relevance: directRelevance,
    source_metadata: metadata(sourceOverrides),
    ...overrides,
  };
}

function australianResult(overrides: Partial<SearchResult> & { id: string; document_id: string }): SearchResult {
  return result(overrides, {
    source_title: "National guideline",
    publisher: "National Health and Medical Research Council",
    publisher_code: "NHMRC",
    jurisdiction: "Australia/National",
    publication_date: "2026-06-01",
    corpus_scope: "australian_public",
    source_role: "clinical_guideline",
    source_catalogue_key: "nhmrc",
    canonical_url: "https://www.nhmrc.gov.au/guidelines/example",
    content_hash: "national-hash",
  });
}

describe("sourceEligibilityForClaim", () => {
  it("does not let PBS or legislation answer treatment claims", () => {
    expect(
      sourceEligibilityForClaim({ source: metadata({ source_role: "subsidy" }), claimRole: "treatment" }),
    ).toMatchObject({ eligible: false, reason: "role_mismatch" });
    expect(
      sourceEligibilityForClaim({ source: metadata({ source_role: "legal" }), claimRole: "treatment" }),
    ).toMatchObject({ eligible: false, reason: "role_mismatch" });
  });

  it("never uses link-only references as claim evidence", () => {
    expect(
      sourceEligibilityForClaim({
        source: metadata({ content_mode: "link_only", source_role: "reference_link" }),
        claimRole: "dose_or_monitoring",
      }),
    ).toEqual({ eligible: false, reason: "link_only" });
  });

  it("fails closed for inactive, non-current, danger-gated, and mismatched catalogue evidence", () => {
    expect(
      sourceEligibilityForClaim({ source: metadata({ change_state: "withdrawn" }), claimRole: "treatment" }),
    ).toEqual({ eligible: false, reason: "inactive" });
    expect(
      sourceEligibilityForClaim({ source: metadata({ document_status: "review_due" }), claimRole: "treatment" }),
    ).toEqual({ eligible: false, reason: "not_current" });
    expect(
      sourceEligibilityForClaim({ source: metadata({ extraction_quality: "poor" }), claimRole: "treatment" }),
    ).toEqual({ eligible: false, reason: "governance_block" });
    expect(
      sourceEligibilityForClaim({
        source: metadata({
          corpus_scope: "australian_public",
          source_role: "clinical_guideline",
          source_catalogue_key: "nhmrc",
          publisher: "National Health and Medical Research Council",
          publisher_code: "TGA",
          jurisdiction: "Australia/National",
        }),
        claimRole: "treatment",
      }),
    ).toEqual({ eligible: false, reason: "catalogue_mismatch" });
  });
});

describe("resolveLocalAndAustralianEvidence", () => {
  it("keeps the current uploaded guideline primary and surfaces a newer verified conflict", () => {
    const local = result({ id: "local-chunk", document_id: "local" });
    const national = australianResult({ id: "national-chunk", document_id: "national" });

    const resolved = resolveLocalAndAustralianEvidence({
      local: [local],
      australian: [national],
      claimRole: "treatment",
      verifiedDifferences: [
        {
          claimRole: "treatment",
          topicKey: "treatment-sequence",
          overlapReason: "same_claim",
          materialDifferenceReason: "recommendation_differs",
          localChunkIds: ["local-chunk"],
          australianChunkIds: ["national-chunk"],
        },
      ],
    });

    expect(resolved.primary.map((source) => source.document_id)).toEqual(["local"]);
    expect(resolved.augmentation.map((source) => source.document_id)).toEqual(["national"]);
    expect(resolved.conflicts).toEqual([
      expect.objectContaining({
        version: "source-policy-conflict-v1",
        id: expect.stringMatching(/^source-policy-conflict-v1:/),
        local: expect.objectContaining({
          documentId: "local",
          publicationDate: "2025-01-01",
          jurisdiction: "local",
          sourceRole: "local_guideline",
          supportingChunkIds: ["local-chunk"],
        }),
        australian: expect.objectContaining({
          documentId: "national",
          publicationDate: "2026-06-01",
          jurisdiction: "Australia/National",
          sourceRole: "clinical_guideline",
          supportingChunkIds: ["national-chunk"],
        }),
        materialDifferenceReason: "recommendation_differs",
        localPrimaryDecision: {
          selected: "uploaded_local",
          reason: "current_valid_accessible_directly_supportive",
        },
        reviewTargetDocumentId: "local",
      }),
    ]);
    expect(resolved.reviewDocumentIds).toEqual(["local"]);
  });

  it("does not infer a conflict from recency alone", () => {
    const resolved = resolveLocalAndAustralianEvidence({
      local: [result({ id: "local-chunk", document_id: "local" })],
      australian: [australianResult({ id: "national-chunk", document_id: "national" })],
      claimRole: "treatment",
      verifiedDifferences: [],
    });

    expect(resolved.conflicts).toEqual([]);
    expect(resolved.reviewDocumentIds).toEqual([]);
  });

  it("requires matching verified chunks and complete side metadata before creating a conflict", () => {
    const difference = {
      claimRole: "treatment" as const,
      topicKey: "treatment-sequence",
      overlapReason: "same_claim" as const,
      materialDifferenceReason: "recommendation_differs" as const,
      localChunkIds: ["local-chunk"],
      australianChunkIds: ["national-chunk"],
    };

    expect(
      resolveLocalAndAustralianEvidence({
        local: [result({ id: "different-local-chunk", document_id: "local" })],
        australian: [australianResult({ id: "national-chunk", document_id: "national" })],
        claimRole: "treatment",
        verifiedDifferences: [difference],
      }).conflicts,
    ).toEqual([]);

    expect(
      resolveLocalAndAustralianEvidence({
        local: [result({ id: "local-chunk", document_id: "local" }, { publisher: null })],
        australian: [australianResult({ id: "national-chunk", document_id: "national" })],
        claimRole: "treatment",
        verifiedDifferences: [difference],
      }).conflicts,
    ).toEqual([]);
  });

  it("uses eligible Australian evidence as primary when uploaded evidence is not eligible", () => {
    const resolved = resolveLocalAndAustralianEvidence({
      local: [result({ id: "stale-local-chunk", document_id: "stale-local" }, { document_status: "outdated" })],
      australian: [australianResult({ id: "national-chunk", document_id: "national" })],
      claimRole: "treatment",
      verifiedDifferences: [],
    });

    expect(resolved.primary.map((source) => source.document_id)).toEqual(["national"]);
    expect(resolved.augmentation).toEqual([]);
  });

  it("does not promote an uploaded supporting review as the local guideline primary", () => {
    const resolved = resolveLocalAndAustralianEvidence({
      local: [result({ id: "review-chunk", document_id: "local-review" }, { source_role: "professional_review" })],
      australian: [australianResult({ id: "national-chunk", document_id: "national" })],
      claimRole: "treatment",
      verifiedDifferences: [],
    });

    expect(resolved.primary.map((source) => source.document_id)).toEqual(["national"]);
    expect(resolved.augmentation.map((source) => source.document_id)).toEqual(["local-review"]);
  });

  it("does not make nearby uploaded evidence primary and returns deterministic conflict IDs", () => {
    const local = result({
      id: "local-chunk",
      document_id: "local",
      relevance: { ...directRelevance, verdict: "nearby", label: "Nearby" },
    });
    const national = australianResult({ id: "national-chunk", document_id: "national" });
    const verifiedDifference = {
      claimRole: "treatment" as const,
      topicKey: "treatment-sequence",
      overlapReason: "same_claim" as const,
      materialDifferenceReason: "recommendation_differs" as const,
      localChunkIds: ["local-chunk"],
      australianChunkIds: ["national-chunk"],
    };

    const nearby = resolveLocalAndAustralianEvidence({
      local: [local],
      australian: [national],
      claimRole: "treatment",
      verifiedDifferences: [verifiedDifference],
    });
    expect(nearby.primary.map((source) => source.document_id)).toEqual(["national"]);
    expect(nearby.conflicts).toEqual([]);

    const direct = { ...local, relevance: directRelevance };
    const first = resolveLocalAndAustralianEvidence({
      local: [direct],
      australian: [national],
      claimRole: "treatment",
      verifiedDifferences: [verifiedDifference],
    });
    const second = resolveLocalAndAustralianEvidence({
      local: [direct],
      australian: [national],
      claimRole: "treatment",
      verifiedDifferences: [verifiedDifference],
    });
    expect(first.conflicts[0]?.id).toBe(second.conflicts[0]?.id);
  });
});
