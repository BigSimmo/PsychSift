import { withMockRagScopeRevision } from "./rag-cache-test-revision";
/**
 * Audit RAG-B-01: a model answer that marks itself `grounded: false` but still cites a retrieved
 * passage and keeps a confidence above "unsupported" used to skip claim-support enforcement, the
 * final quality gate's ungrounded path and the browser-boundary governance refusal, so its
 * figure-free unverified clinical statements were delivered and cached.
 *
 * Answer gating only. Nothing here touches retrieval, ranking or ordering — see
 * docs/rag-behaviour/safeguards.md. All data is synthetic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildGovernedAnswerClientResponse } from "../src/lib/answer-response";
import { parseAnswerJson } from "../src/lib/rag/rag";
import { finalizeRagAnswerQuality } from "../src/lib/rag/rag-answer-quality-gate";
import type { RagAnswer, SearchResult } from "../src/lib/types";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const query = "What is the usual sertraline dose range?";

function source(documentStatus: "current" | "outdated" = "current"): SearchResult {
  return {
    id: "c1",
    document_id: "d1",
    title: "Synthetic sertraline prescribing guide",
    file_name: "synthetic-sertraline.pdf",
    page_number: 3,
    chunk_index: 0,
    section_heading: "Dosing",
    content:
      "Sertraline: usual starting dose 50 mg once daily. Increase in 50 mg steps at intervals of at least one week. Maximum 200 mg daily.",
    image_ids: [],
    images: [],
    similarity: 0.82,
    source_metadata: {
      source_title: "Synthetic sertraline prescribing guide",
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

// The figure-free probe from the audit (A7 CH-01): no number for numeric verification to catch.
const unsupportedFigureFreeClaim = "Sertraline should always be taken with food and is contraindicated in pregnancy.";

function modelPayload(grounded: boolean, answer = unsupportedFigureFreeClaim) {
  return JSON.stringify({
    answer,
    grounded,
    confidence: "medium",
    answerSections: [],
    citations: [{ chunk_id: "c1", document_id: "d1" }],
    quoteCards: [],
    conflictsOrGaps: [],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("RAG-B-01 self-reported ungrounded model answers", () => {
  it("parses a cited answer the model marked ungrounded as unsupported, not as a medium-confidence answer", () => {
    const parsed = parseAnswerJson(modelPayload(false), [source()], query);

    expect(parsed.grounded).toBe(false);
    expect(parsed.confidence).toBe("unsupported");
  });

  it("leaves a cited answer the model marked grounded with its derived confidence", () => {
    const parsed = parseAnswerJson(
      modelPayload(true, "Sertraline is usually started at 50 mg once daily."),
      [source()],
      query,
    );

    expect(parsed.grounded).toBe(true);
    expect(parsed.confidence).not.toBe("unsupported");
  });

  it("does not deliver the figure-free unverified claim through the final quality gate", () => {
    const parsed = parseAnswerJson(modelPayload(false), [source()], query);
    parsed.routingMode = "strong";
    parsed.modelUsed = "synthetic-strong";
    parsed.queryClass = "medication_dose_risk";

    const finalized = finalizeRagAnswerQuality(parsed, query, "medication_dose_risk", [source()]);

    expect(finalized).toMatchObject({ grounded: false, confidence: "unsupported", responseMode: "evidence_gap" });
    expect(finalized.answer).not.toMatch(/contraindicated|taken with food/i);
    expect(finalized.routingReason).toContain("final_quality_gate:");
  });

  it("refuses an ungrounded answer that still carries a confidence when danger governance applies", () => {
    const result = buildGovernedAnswerClientResponse({
      answer: unsupportedFigureFreeClaim,
      grounded: false,
      confidence: "medium",
      citations: [
        {
          chunk_id: "c1",
          document_id: "d1",
          title: "Synthetic sertraline prescribing guide",
          file_name: "synthetic-sertraline.pdf",
          page_number: 3,
          chunk_index: 0,
        },
      ],
      sources: [source("outdated")],
    } satisfies RagAnswer);

    expect(result.refused).toBe(true);
    expect(result.payload).toMatchObject({ grounded: false, confidence: "unsupported", citations: [], sources: [] });
    expect(result.payload.answer).not.toMatch(/contraindicated/i);
  });

  it("still passes an evidence-gap answer through the governance boundary unchanged", () => {
    const result = buildGovernedAnswerClientResponse({
      answer: "No current source with dose guidance for this query was found.",
      grounded: false,
      confidence: "unsupported",
      citations: [],
      sources: [source("outdated")],
      responseMode: "evidence_gap",
    } satisfies RagAnswer);

    expect(result.refused).toBe(false);
  });

  it("treats a cached pre-fix ungrounded generated answer as a miss on the local cache", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () =>
        withMockRagScopeRevision({
          from: vi.fn(() => {
            const builder: Record<string, unknown> = {};
            for (const method of ["select", "eq", "is", "or", "in", "order", "limit", "abortSignal", "gt"]) {
              builder[method] = vi.fn(() => builder);
            }
            builder.delete = vi.fn(() => builder);
            builder.insert = vi.fn(async () => ({ data: null, error: null }));
            builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
            builder.then = (onfulfilled?: (value: { data: unknown; error: null }) => unknown) =>
              Promise.resolve({
                data: [{ id: "d1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }],
                error: null,
              }).then(onfulfilled);
            return builder;
          }),
        }),
    }));
    const { getCachedAnswer, setCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const scope = { ownerId, accessScope: { ownerId, includePublic: true as const } };
    const base = {
      answer: unsupportedFigureFreeClaim,
      citations: [],
      sources: [],
      routingMode: "strong" as const,
      routingReason: "test",
      modelUsed: "synthetic-strong",
    };

    await setCachedAnswer({ ...scope, query: "ungated" }, { ...base, grounded: false, confidence: "medium" });
    await setCachedAnswer({ ...scope, query: "gated" }, { ...base, grounded: false, confidence: "unsupported" });
    await setCachedAnswer({ ...scope, query: "grounded" }, { ...base, grounded: true, confidence: "medium" });

    expect(await getCachedAnswer({ ...scope, query: "ungated" }, Date.now())).toBeNull();
    expect(await getCachedAnswer({ ...scope, query: "gated" }, Date.now())).not.toBeNull();
    expect(await getCachedAnswer({ ...scope, query: "grounded" }, Date.now())).not.toBeNull();
  });

  it("does not serve a pre-fix ungrounded generated answer from the shared cache and removes the row", async () => {
    vi.resetModules();
    const payload = {
      answer: {
        answer: unsupportedFigureFreeClaim,
        grounded: false,
        confidence: "medium",
        citations: [],
        sources: [],
        routingMode: "fast",
        routingReason: "clinical_fast_grounded_synthesis",
        modelUsed: "synthetic-fast",
      },
    };
    let deletionCalls = 0;
    const sharedBuilder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "in", "gt", "order", "limit"]) {
      sharedBuilder[method] = () => sharedBuilder;
    }
    sharedBuilder.maybeSingle = async () => ({ data: { payload }, error: null });
    const deleteBuilder: Record<string, unknown> = {};
    for (const method of ["eq", "is", "in"]) deleteBuilder[method] = () => deleteBuilder;
    deleteBuilder.then = (resolve: (value: { data: null; error: null }) => unknown) => {
      deletionCalls += 1;
      return Promise.resolve({ data: null, error: null }).then(resolve);
    };
    const cacheTable = { ...sharedBuilder, delete: () => deleteBuilder };
    const docBuilder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "or", "gt", "order", "limit"]) {
      docBuilder[method] = () => docBuilder;
    }
    docBuilder.maybeSingle = async () => ({ data: null, error: null });
    docBuilder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data: [{ id: "d1", updated_at: "2026-07-14T00:00:00.000Z", metadata: {} }],
        error: null,
      }).then(resolve);

    vi.doMock("@/lib/env", () => ({
      env: {
        RAG_SEARCH_CACHE_TTL_MS: 60_000,
        RAG_SEARCH_CACHE_SIZE: 200,
        RAG_ANSWER_CACHE_TTL_MS: 60_000,
        RAG_ANSWER_CACHE_SIZE: 200,
        RAG_PERSIST_RAW_QUERY_TEXT: false,
        RAG_QUERY_HASH_SECRET: "test-query-hash-secret",
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    }));
    vi.doMock("@/lib/deep-memory", () => ({ ragDeepMemoryVersion: "test-rag-version" }));
    vi.doMock("@/lib/clinical-search", () => ({
      buildClinicalTextSearchQuery: (text: string) => text.trim(),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () =>
        withMockRagScopeRevision({
          from: (table: string) => (table === "rag_response_cache" ? cacheTable : docBuilder),
        }),
    }));

    const { getSharedCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const result = await getSharedCachedAnswer(
      { query: "sertraline food", ownerId, queryMode: "auto", forceEmbedding: false },
      Date.now(),
    );

    expect(result).toBeNull();
    expect(deletionCalls).toBe(1);
  });
});
