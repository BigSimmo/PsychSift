import { describe, expect, it } from "vitest";

import {
  answerDegradedModeSignal,
  buildGovernedEmptyScopeAnswerClientResponse,
  buildGovernedAnswerClientResponse,
  buildGovernedDemoAnswerClientResponse,
} from "../src/lib/answer-response";
import { projectClientAnswerPayload, toClientSearchScopeSummary } from "../src/lib/answer-client-payload";
import { readAnswerStream } from "../src/components/clinical-dashboard/search-utils";
import { answerUsesSourceOnlyProvenance } from "../src/components/ui/answer-state";
import type { RagAnswer, SearchResult } from "../src/lib/types";

function source(documentStatus: "current" | "outdated" = "current"): SearchResult {
  return {
    id: "chunk-1",
    document_id: "document-1",
    title: "Clinical guideline",
    file_name: "clinical-guideline.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "Use the current monitoring pathway.",
    image_ids: [],
    images: [],
    similarity: 0.9,
    source_metadata: {
      source_title: "Clinical guideline",
      publisher: "WA Health",
      publisher_code: "WA_HEALTH",
      jurisdiction: "Australia/WA",
      version: null,
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: documentStatus,
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
  };
}

function answer(overrides: Partial<RagAnswer> = {}): RagAnswer {
  return {
    answer: "Use the cited monitoring pathway.",
    grounded: true,
    confidence: "high",
    citations: [
      {
        chunk_id: "chunk-1",
        document_id: "document-1",
        title: "Clinical guideline",
        file_name: "clinical-guideline.pdf",
        page_number: 1,
        chunk_index: 0,
      },
    ],
    sources: [source()],
    ...overrides,
  };
}

describe("governed answer response", () => {
  it.each([
    [
      "generation_fallback:provider_timeout",
      "provider_timeout",
      "Answer generation timed out; the verified source-backed portion is shown.",
    ],
    ["coverage_gap", "coverage_gap", "The active sources support only part of this question."],
  ])("FR1 normalizes legacy %s through JSON and final SSE", async (routingReason, code, reason) => {
    const result = buildGovernedAnswerClientResponse(answer({ routingReason, answerQualityTier: "model_synthesis" }));
    const json = JSON.parse(JSON.stringify(result.payload));
    expect(json).toMatchObject({ fallbackReasonCode: code, degradedMode: { active: true, reason } });
    expect(projectClientAnswerPayload(json, true)).toEqual(json);
    const streamed = await readAnswerStream(new Response(`event: final\ndata: ${JSON.stringify(json)}\n\n`), () => {});
    expect(streamed).toEqual(json);
    expect(answerUsesSourceOnlyProvenance(streamed)).toBe(false);
  });

  it("keeps a normal grounded answer and derives source-only degradation consistently", () => {
    const result = buildGovernedAnswerClientResponse(
      answer({
        answerQualityTier: "source_only",
        fallbackReasonCode: "provider_timeout",
        fallbackReason: "generation_fallback: socket private-host?token=secret",
        routingReason: "generation_fallback: socket private-host?token=secret",
        degradedMode: { active: true, reason: "socket private-host?token=secret" },
        queryAnalysis: { secret: "private-query" } as never,
        retrievalDiagnostics: { gateStatus: "blocked", secret: "private-diagnostics" } as never,
        openAIRequestIds: ["req_secret"],
      }),
    );

    expect(result.refused).toBe(false);
    expect(result.payload).toMatchObject({
      answer: "Use the cited monitoring pathway.",
      fallbackReasonCode: "provider_timeout",
      degradedMode: {
        active: true,
        reason: "Answer generation timed out; the verified source-backed portion is shown.",
      },
      retrievalGateBlocked: true,
    });
    expect(result.payload).not.toHaveProperty("routingReason");
    expect(result.payload).not.toHaveProperty("fallbackReason");
    expect(result.payload).not.toHaveProperty("queryAnalysis");
    expect(result.payload).not.toHaveProperty("retrievalDiagnostics");
    expect(result.payload).not.toHaveProperty("openAIRequestIds");
    expect(JSON.stringify(result.payload)).not.toMatch(
      /private-host|token=secret|private-query|private-diagnostics|req_secret/,
    );
    expect(answerDegradedModeSignal()).toEqual({ active: false, reason: null });
  });

  // Audit NEW-G-04: a search timeout reports provider_timeout with no sources, and the banner used
  // to say a verified source-backed portion was shown when nothing was.
  it("does not promise a verified portion when a search timeout returned no sources", async () => {
    const { retrievalDeadlineExceededAnswer } = await import("../src/lib/rag/rag-route-budget");
    const timedOut = retrievalDeadlineExceededAnswer({ searchStartedAt: 0, startedAt: 0, budgetMs: 1 });
    const signal = answerDegradedModeSignal(timedOut);
    expect(signal.active).toBe(true);
    expect(signal.reason).toBe(
      "Source evidence could not be confirmed, so no verified passages are shown. Please try again.",
    );
    expect(buildGovernedAnswerClientResponse(timedOut).payload.degradedMode?.reason).not.toMatch(
      /verified source-backed portion/,
    );
    expect(answerDegradedModeSignal({ ...timedOut, sources: [source()] }).reason).toBe(
      "Answer generation timed out; the verified source-backed portion is shown.",
    );
  });

  it("normalizes malformed runtime fallback codes and activates valid typed degradation", () => {
    const malformed = buildGovernedAnswerClientResponse(
      answer({ fallbackReasonCode: "provider_timeout\nprivate-host?token=secret" as never }),
    );
    expect(malformed.payload).toMatchObject({
      fallbackReasonCode: "unknown",
      degradedMode: {
        active: true,
        reason: "The answer could not be completed from the currently verified sources.",
      },
    });
    expect(JSON.stringify(malformed.payload)).not.toMatch(/private-host|token=secret/);

    const coverageGap = buildGovernedAnswerClientResponse(answer({ fallbackReasonCode: "coverage_gap" }));
    expect(coverageGap.payload).toMatchObject({
      fallbackReasonCode: "coverage_gap",
      degradedMode: {
        active: true,
        reason: "The active sources support only part of this question.",
      },
    });
  });

  it("fails closed without leaking answer-only fields when any answer route sees danger governance", () => {
    const result = buildGovernedAnswerClientResponse(
      answer({
        sources: [source("outdated")],
        smartPanel: { query: "monitoring" } as RagAnswer["smartPanel"],
        smartApiPlan: { displayMode: "direct" } as unknown as RagAnswer["smartApiPlan"],
      }),
    );

    expect(result.refused).toBe(true);
    expect(result.payload).toMatchObject({ grounded: false, confidence: "unsupported", citations: [], sources: [] });
    expect(result.payload).not.toHaveProperty("smartPanel");
    expect(result.payload).not.toHaveProperty("smartApiPlan");
    expect(result.telemetryAnswer.routingReason).toContain("source_governance_refusal");
  });

  it("applies the same governed and degraded contract to demo answers", () => {
    const result = buildGovernedDemoAnswerClientResponse(
      answer({
        sources: [source("outdated")],
        smartPanel: { query: "monitoring" } as RagAnswer["smartPanel"],
      }),
      "supabase_api_key_configuration",
    );

    expect(result).toMatchObject({
      demoMode: true,
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [],
      fallbackReasonCode: "source_governance_block",
      degradedMode: {
        active: true,
        reason: "Available material did not meet the source-governance requirements.",
      },
      fallbackMode: "non_production_demo",
    });
    expect(result).not.toHaveProperty("fallbackReason");
    expect(result).not.toHaveProperty("smartPanel");
  });

  it("preserves an existing governance refusal when adding the demo marker", () => {
    const result = buildGovernedDemoAnswerClientResponse(
      answer({
        answerQualityTier: "source_only",
        fallbackReasonCode: "source_governance_block",
        fallbackReason: "source_governance_refusal",
      }),
      "supabase_api_key_configuration",
    );

    expect(result).toMatchObject({
      demoMode: true,
      fallbackMode: "non_production_demo",
      fallbackReasonCode: "source_governance_block",
      degradedMode: {
        active: true,
        reason: "Available material did not meet the source-governance requirements.",
      },
    });
  });

  it.each(["citation_or_claim_gate", "source_role_mismatch", "source_conflict"] as const)(
    "preserves stronger governed %s state when adding a demo fallback",
    (fallbackReasonCode) => {
      const result = buildGovernedDemoAnswerClientResponse(
        answer({
          answerQualityTier: "source_only",
          fallbackReasonCode,
          fallbackReason: fallbackReasonCode,
          degradedMode: { active: true, reason: "private raw reason" },
        }),
        "supabase_api_key_configuration",
      );

      expect(result.fallbackReasonCode).toBe(fallbackReasonCode);
      expect(result.degradedMode.reason).not.toContain("private raw reason");
    },
  );

  it("projects route scope through one bounded allowlist", () => {
    const projected = toClientSearchScopeSummary(
      {
        documentIds: ["private-document-id"],
        filters: { collections: ["private-filter"] },
        activeFilterCount: 2,
        matchedDocumentCount: 1,
        warnings: ["review the selected scope"],
        summary: "Two active filters",
        futureInternalField: "private" as never,
      } as never,
      "monitoring_schedule",
    );

    expect(Object.keys(projected)).toEqual([
      "summary",
      "activeFilterCount",
      "matchedDocumentCount",
      "warnings",
      "queryMode",
    ]);
    expect(JSON.stringify(projected)).not.toMatch(/private-document-id|private-filter|futureInternalField/);
  });

  it("builds direct empty-scope JSON and SSE payloads through the same safe projection", () => {
    const first = buildGovernedEmptyScopeAnswerClientResponse("No indexed documents matched.");
    const second = buildGovernedEmptyScopeAnswerClientResponse("No indexed documents matched.");

    expect(first.payload).toEqual(second.payload);
    expect(first.payload).toMatchObject({
      answer: "No indexed documents matched.",
      grounded: false,
      confidence: "unsupported",
      fallbackReasonCode: "no_candidates",
      degradedMode: {
        active: true,
        reason: "No directly relevant source passage was found in the active corpus.",
      },
    });
    expect(first.payload).not.toHaveProperty("routingReason");
    expect(first.payload).not.toHaveProperty("fallbackReason");
  });
});
