import { describe, expect, it } from "vitest";

import { evaluateAnswerCoverage } from "@/lib/rag/rag-coverage";
import type { RagQueryPlan, SearchResult, SourcePolicyConflict } from "@/lib/types";

function result(id: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id,
    document_id: `document-${id}`,
    title: "Clinical guidance",
    file_name: "guidance.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "Monitor the patient and escalate when the threshold is reached.",
    image_ids: [],
    similarity: 0.8,
    images: [],
    corpus_scope: "uploaded_local",
    site_content_domain: null,
    ...overrides,
  };
}

const plan: RagQueryPlan = {
  version: "rag-query-plan-v1",
  kind: "decomposed",
  originalQuery: "How should this be managed and monitored?",
  interpretation: "management and monitoring",
  subquestions: [
    { id: "sq-1", question: "What is the primary management?", purpose: "primary", required: true },
    { id: "sq-2", question: "What monitoring is required?", purpose: "monitoring", required: true },
  ],
  targetSiteDomains: [],
  siteDomainDecision: "none",
  reasonCodes: ["broad_management"],
};

describe("answer coverage", () => {
  it("counts only directly selected and cited chunks, never metadata-only candidates", () => {
    const coverage = evaluateAnswerCoverage({
      plan,
      selectedEvidence: [result("direct"), result("metadata-only")],
      evidenceBySubquestion: [
        { subquestionId: "sq-1", selectedChunkIds: ["direct"], citedChunkIds: ["direct"] },
        { subquestionId: "sq-2", selectedChunkIds: ["metadata-only"], citedChunkIds: [] },
      ],
    });

    expect(coverage.coverage).toEqual([
      expect.objectContaining({ subquestionId: "sq-1", status: "direct", chunkIds: ["direct"] }),
      expect.objectContaining({ subquestionId: "sq-2", status: "absent", chunkIds: [] }),
    ]);
    expect(coverage.overall).toBe("partial");
    expect(coverage.insufficiencyReason).toBe("insufficient_claim_support");
  });

  it("rejects absent, unknown, and mislabelled registry scopes instead of guessing", () => {
    const unscoped = result("unscoped");
    delete unscoped.corpus_scope;
    const unknown = result("unknown", { corpus_scope: "external" as SearchResult["corpus_scope"] });
    const mislabelledRegistry = result("registry", {
      corpus_scope: "uploaded_local",
      source_metadata: { source_kind: "registry_record" },
    });

    const coverage = evaluateAnswerCoverage({
      plan: { ...plan, kind: "single", subquestions: [plan.subquestions[0]] },
      selectedEvidence: [unscoped, unknown, mislabelledRegistry],
      evidenceBySubquestion: [
        {
          subquestionId: "sq-1",
          selectedChunkIds: ["unscoped", "unknown", "registry"],
          citedChunkIds: ["unscoped", "unknown", "registry"],
        },
      ],
    });

    expect(coverage.coverage[0]).toMatchObject({ status: "absent", chunkIds: [] });
    expect(coverage.coverage[0].reasonCodes).toEqual(expect.arrayContaining(["candidate_scope_rejected"]));
  });

  it("marks a canonical conflict only when both conflict sides remain directly cited", () => {
    const conflict = {
      id: "conflict-1",
      local: { supportingChunkIds: ["local"] },
      australian: { supportingChunkIds: ["australian"] },
    } as SourcePolicyConflict;
    const coverage = evaluateAnswerCoverage({
      plan: { ...plan, kind: "single", subquestions: [plan.subquestions[0]] },
      selectedEvidence: [result("local"), result("australian", { corpus_scope: "australian_public" })],
      evidenceBySubquestion: [
        {
          subquestionId: "sq-1",
          selectedChunkIds: ["local", "australian"],
          citedChunkIds: ["local", "australian"],
        },
      ],
      conflicts: [conflict],
    });

    expect(coverage.coverage[0]).toMatchObject({
      status: "conflicting",
      chunkIds: ["local", "australian"],
    });
    expect(coverage.conflicts).toEqual([conflict]);
    expect(coverage.overall).toBe("conflicting");
    expect(coverage.insufficiencyReason).toBe("source_conflict");
  });
});
