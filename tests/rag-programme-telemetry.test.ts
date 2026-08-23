import { describe, expect, it } from "vitest";
import {
  buildRagProgrammeDiagnostics,
  buildRagProgrammeTelemetry,
  buildRagQueryMetadata,
  buildRagRetrievalMetadata,
} from "../src/lib/rag/rag-programme-telemetry";
import { finalRagQueryFields } from "../src/lib/rag/rag-query-telemetry";
import type { RagAnswer, SearchResult, SourceCorpusScope } from "../src/lib/types";

const INTERACTION_ID = "33333333-3333-4333-8333-333333333333";

const contaminatedInput = {
  observationContext: { interactionId: INTERACTION_ID, rolloutMode: "shadow" as const },
  queryPlanKind: "decomposed" as const,
  subquestionCount: 3,
  materialAmbiguity: true,
  coverageCounts: { direct: 1, partial: 1, conflicting: 1, absent: 0 },
  candidateCounts: {
    uploaded_local: 4,
    clinical_kb_site: 3,
    australian_public: 2,
    international_supplementary: 1,
  },
  selectedCounts: {
    uploaded_local: 2,
    clinical_kb_site: 1,
    australian_public: 1,
    international_supplementary: 0,
  },
  selectedSiteDomains: ["medications", "factsheets"] as const,
  siteCandidateCount: 3,
  siteSelectedCount: 1,
  publicSiteContentState: "updating" as const,
  siteStaticManifestMatch: false,
  sitePendingCount: 4,
  augmentationOutcome: "used" as const,
  roleExclusionCount: 2,
  insufficiencyReason: "source_conflict" as const,
  generationOutcome: "generated" as const,
  verifiedUnitsEmitted: 2,
  verifiedUnitsDiscarded: 1,
  reconciliationOutcome: "matched" as const,
  query: "patient-name-canary",
  subquestions: ["subquestion-text-canary"],
  answer: "answer-text-canary",
  sourceText: "source-text-canary",
  providerError: "provider-error-canary",
  ownerId: "owner-id-canary",
};

describe("RAG programme telemetry", () => {
  it("selects original source ids for identity finalization and transformed ids for governance changes", () => {
    const originalSources = [{ id: "retrieved-a" }, { id: "retrieved-b" }] as SearchResult[];
    const selectedSource = { id: "selected" } as SearchResult;
    const transformedSource = { id: "governance-source" } as SearchResult;
    const answer = {
      answer: "Supported answer.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [selectedSource],
      routingMode: "strong",
      routingReason: "provider-error-canary: raw upstream body",
    } satisfies RagAnswer;
    const observationContext = { interactionId: INTERACTION_ID, rolloutMode: "shadow" as const };

    const identity = finalRagQueryFields(answer, (unchanged) => unchanged, originalSources, observationContext);
    expect(identity.sourceChunkIds).toEqual(["retrieved-a", "retrieved-b"]);
    expect(JSON.stringify(identity.outcomeMetadata)).not.toContain("provider-error-canary");

    const transformedAnswer = { ...answer, answer: "Governance refusal.", sources: [transformedSource] };
    const transformed = finalRagQueryFields(answer, () => transformedAnswer, originalSources, observationContext);
    expect(transformed.sourceChunkIds).toEqual(["governance-source"]);
  });

  it("uses real candidate and selected corpus outcomes instead of sources.length or an uploaded-local default", () => {
    const candidateScopes: SourceCorpusScope[] = [
      "uploaded_local",
      "uploaded_local",
      "clinical_kb_site",
      "clinical_kb_site",
      "clinical_kb_site",
      "australian_public",
      "australian_public",
      "australian_public",
      "international_supplementary",
    ];
    const candidates = candidateScopes.map(
      (corpus_scope, index) =>
        ({
          id: `candidate-${index}`,
          corpus_scope,
          site_content_domain: corpus_scope === "clinical_kb_site" ? "medications" : null,
        }) as unknown as SearchResult,
    );
    const answer = {
      answer: "bounded",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [candidates[2]!, candidates[5]!],
      retrievalDiagnostics: {
        candidateCount: 9,
        retrievalDepth: 9,
        distinctDocumentCount: 4,
        topScore: 0.9,
        secondScore: 0.8,
        scoreSpread: 0.1,
        gateStatus: "passed",
      },
    } satisfies RagAnswer;

    const diagnostics = buildRagProgrammeDiagnostics(answer, candidates);

    expect(diagnostics.candidateCounts).toEqual({
      uploaded_local: 2,
      clinical_kb_site: 3,
      australian_public: 3,
      international_supplementary: 1,
    });
    expect(Object.values(diagnostics.candidateCounts).reduce((total, count) => total + count, 0)).toBe(9);
    expect(diagnostics.selectedCounts).toEqual({
      uploaded_local: 0,
      clinical_kb_site: 1,
      australian_public: 1,
      international_supplementary: 0,
    });
    expect(diagnostics.selectedSiteDomains).toEqual(["medications"]);
  });

  it("projects only allow-listed counts, enums, booleans, and the opaque interaction id", () => {
    const projected = buildRagProgrammeTelemetry(contaminatedInput);

    expect(projected).toEqual({
      version: "rag-programme-telemetry-v1",
      interaction_id: INTERACTION_ID,
      rollout_mode: "shadow",
      query_plan_kind: "decomposed",
      subquestion_count: 3,
      material_ambiguity: true,
      coverage_counts: { direct: 1, partial: 1, conflicting: 1, absent: 0 },
      candidate_counts: {
        uploaded_local: 4,
        clinical_kb_site: 3,
        australian_public: 2,
        international_supplementary: 1,
      },
      selected_counts: {
        uploaded_local: 2,
        clinical_kb_site: 1,
        australian_public: 1,
        international_supplementary: 0,
      },
      selected_site_domains: ["medications", "factsheets"],
      site_candidate_count: 3,
      site_selected_count: 1,
      public_site_content_state: "updating",
      site_static_manifest_match: false,
      site_pending_count_bucket: "2_to_5",
      augmentation_outcome: "used",
      role_exclusion_count: 2,
      insufficiency_reason: "source_conflict",
      generation_outcome: "generated",
      verified_units_emitted: 2,
      verified_units_discarded: 1,
      reconciliation_outcome: "matched",
    });

    const serialized = JSON.stringify(projected);
    for (const forbidden of [
      "patient-name-canary",
      "subquestion-text-canary",
      "answer-text-canary",
      "source-text-canary",
      "provider-error-canary",
      "owner-id-canary",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("places the opaque interaction id in rag_queries metadata without forbidden prose", () => {
    const metadata = buildRagQueryMetadata(contaminatedInput);
    expect(metadata).toEqual({
      version: "rag-programme-telemetry-v1",
      interaction_id: INTERACTION_ID,
      rollout_mode: "shadow",
      coverage_counts: { direct: 1, partial: 1, conflicting: 1, absent: 0 },
      insufficiency_reason: "source_conflict",
      generation_outcome: "generated",
      verified_units_emitted: 2,
      verified_units_discarded: 1,
      reconciliation_outcome: "matched",
    });
    expect(JSON.stringify(metadata)).not.toContain("patient-name-canary");
    expect(JSON.stringify(metadata)).not.toContain("provider-error-canary");
    expect(JSON.stringify(metadata)).not.toContain("owner-id-canary");
  });

  it("keeps retrieval route and corpus diagnostics out of the answer/SLO owner", () => {
    expect(buildRagRetrievalMetadata(contaminatedInput)).toEqual({
      version: "rag-programme-telemetry-v1",
      interaction_id: INTERACTION_ID,
      rollout_mode: "shadow",
      query_plan_kind: "decomposed",
      subquestion_count: 3,
      material_ambiguity: true,
      candidate_counts: {
        uploaded_local: 4,
        clinical_kb_site: 3,
        australian_public: 2,
        international_supplementary: 1,
      },
      selected_counts: {
        uploaded_local: 2,
        clinical_kb_site: 1,
        australian_public: 1,
        international_supplementary: 0,
      },
      selected_site_domains: ["medications", "factsheets"],
      site_candidate_count: 3,
      site_selected_count: 1,
      public_site_content_state: "updating",
      site_static_manifest_match: false,
      site_pending_count_bucket: "2_to_5",
      augmentation_outcome: "used",
      role_exclusion_count: 2,
    });
  });
});
