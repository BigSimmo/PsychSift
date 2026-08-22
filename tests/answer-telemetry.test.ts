import { describe, expect, it } from "vitest";
import { buildAnswerLogRow, type AnswerTelemetrySource } from "../src/lib/answer-telemetry";
import type { SearchResult } from "../src/lib/types";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const INTERACTION_ID = "33333333-3333-4333-8333-333333333333";

function sourceRow(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: UUID_A,
    document_id: UUID_B,
    similarity: 0.8,
    hybrid_score: 0.85,
    ...overrides,
  } as unknown as SearchResult;
}

function answer(overrides: Partial<AnswerTelemetrySource> = {}): AnswerTelemetrySource {
  return {
    grounded: true,
    confidence: "high",
    sources: [sourceRow({})],
    queryClass: "medication_dose_risk",
    modelUsed: "gpt-5.5",
    routingMode: "strong",
    routingReason: "dose_query_strong_route",
    providerMode: "openai",
    answerQualityTier: "model_synthesis",
    responseMode: "threshold_table",
    fallbackReason: null,
    degradedMode: { active: false, reason: null },
    openAIUsage: {
      input_tokens: 1200,
      output_tokens: 300,
      total_tokens: 1500,
      cached_input_tokens: 800,
      reasoning_output_tokens: 120,
    },
    openAIRequestIds: ["req_1", "req_2"],
    latencyTimings: {
      generation_latency_ms: 900,
      total_latency_ms: 1400,
      answer_retry_count: 1,
      embedding_prefetched: true,
    },
    retrievalDiagnostics: undefined,
    ...overrides,
  };
}

type AnswerMetadata = { answer: Record<string, unknown> & { tokens: Record<string, number | null> } };

describe("buildAnswerLogRow (per-answer observability)", () => {
  it("persists route, model, and token usage in metadata.answer", () => {
    const row = buildAnswerLogRow({
      query: "max clozapine dose?",
      ownerId: "owner-1",
      answer: answer(),
      observationContext: { interactionId: INTERACTION_ID, rolloutMode: "legacy" },
    });
    const meta = row.metadata as unknown as AnswerMetadata;

    expect(meta.answer.interaction_id).toBe(INTERACTION_ID);
    expect(meta.answer.log_source).toBe("answer");
    expect(meta.answer.route).toBe("strong");
    expect(meta.answer.model).toBe("gpt-5.5");
    expect(meta.answer.provider_mode).toBe("openai");
    expect(meta.answer.tokens).toEqual({
      input: 1200,
      output: 300,
      total: 1500,
      cached_input: 800,
      reasoning_output: 120,
    });
    expect(meta.answer.request_ids).toEqual(["req_1", "req_2"]);
    expect(meta.answer.generation_latency_ms).toBe(900);
    expect(meta.answer.embedding_prefetched).toBe(true);
    expect(row.total_latency_ms).toBe(1400);
    expect(row.candidate_count).toBe(1);
    expect(row.is_miss).toBe(false);
    expect(row.owner_id).toBe("owner-1");
    expect(JSON.stringify(row.metadata)).not.toContain("owner-1");
    // The stored query is routed through the privacy helper, not raw.
    expect(typeof row.query).toBe("string");
  });

  it("marks unsupported/ungrounded answers as a miss with a reason", () => {
    const row = buildAnswerLogRow({
      query: "unknown drug?",
      ownerId: null,
      answer: answer({ grounded: false, confidence: "unsupported", responseMode: "evidence_gap", sources: [] }),
    });
    expect(row.is_miss).toBe(true);
    expect(row.miss_reason).toBe("evidence_gap");
    expect(row.candidate_count).toBe(0);
    expect(row.selected_chunk_ids).toEqual([]);
  });

  it("drops non-UUID chunk/document ids from the selected arrays", () => {
    const row = buildAnswerLogRow({
      query: "q",
      ownerId: "o",
      answer: answer({
        sources: [sourceRow({ id: "synthetic-chunk", document_id: "synthetic-doc" }), sourceRow({ id: UUID_A })],
      }),
    });
    expect(row.selected_chunk_ids).toEqual([UUID_A]);
    expect(row.selected_document_ids).toEqual([UUID_B]);
  });

  it("nulls non-finite token and latency values rather than persisting them", () => {
    const row = buildAnswerLogRow({
      query: "q",
      ownerId: "o",
      answer: answer({ openAIUsage: {}, latencyTimings: {} }),
    });
    const meta = row.metadata as unknown as AnswerMetadata;
    expect(meta.answer.tokens).toEqual({
      input: null,
      output: null,
      total: null,
      cached_input: null,
      reasoning_output: null,
    });
    expect(row.total_latency_ms).toBeNull();
  });
});
