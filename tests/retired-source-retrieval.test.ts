import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../src/lib/types";

// CH-02 / RAG-A-04 (audit 2026-10-20): a document the owner marked superseded, rejected or
// decommissioned (document_status "outdated"), or one whose publisher withdrew or superseded it
// (change_state) or whose expiry date has passed, must not be retrievable on the legacy search
// path. Before this, such a document stayed retrievable, so the answer boundary refused the whole
// grounded answer even when its replacement was present and answered the question.
//
// All data here is synthetic.

const NOW = new Date("2026-10-20T02:00:00.000Z"); // 10:00 on 20 Oct 2026 in Perth

function ancThresholdFact(documentId: string, chunkId: string, threshold: string) {
  return {
    id: `${documentId}-anc-threshold`,
    document_id: documentId,
    source_chunk_id: chunkId,
    source_image_id: null,
    page_number: 11,
    table_title: "Clozapine ANC thresholds",
    row_label: `ANC below ${threshold}`,
    clinical_parameter: "ANC",
    threshold_value: `below ${threshold}`,
    action: "Withhold clozapine and repeat FBC.",
  };
}

// Metadata overrides are deliberately partial raw rows, as retrieval RPCs return them.
type ChunkOverrides = Omit<Partial<SearchResult>, "source_metadata"> & {
  source_metadata?: Record<string, unknown> | null;
};

function chunk(overrides: ChunkOverrides = {}) {
  const { source_metadata, ...rest } = overrides;
  return {
    id: "replacement-chunk-1",
    document_id: "replacement-doc",
    title: "Clozapine Prescribing Administration Monitoring",
    file_name: "clozapine-current.pdf",
    page_number: 11,
    chunk_index: 0,
    section_heading: "Monitoring",
    content:
      "Withhold clozapine if the absolute neutrophil count (ANC) falls below 1.5 x10^9/L. Mandatory FBC monitoring is weekly for the first 18 weeks of clozapine treatment.",
    image_ids: [],
    similarity: 0.9,
    hybrid_score: 0.9,
    text_rank: 1.0,
    table_facts: [ancThresholdFact("replacement-doc", "replacement-chunk-1", "1.5 x 10^9/L")],
    images: [],
    source_metadata: {
      publisher: "Local service",
      jurisdiction: "Australia/WA",
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
      ...(source_metadata ?? {}),
    },
    ...rest,
  } as SearchResult;
}

const supersededOld = chunk({
  id: "old-chunk-1",
  document_id: "old-doc",
  file_name: "clozapine-2019.pdf",
  title: "Clozapine Prescribing Administration Monitoring (2019)",
  content:
    "Withhold clozapine if the absolute neutrophil count (ANC) falls below 2.0 x10^9/L. Mandatory FBC monitoring is weekly for the first 18 weeks of clozapine treatment.",
  similarity: 0.97,
  hybrid_score: 0.97,
  text_rank: 1.4,
  table_facts: [ancThresholdFact("old-doc", "old-chunk-1", "2.0 x 10^9/L")],
  source_metadata: { document_status: "outdated", governance_disposition: "superseded" },
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("isRetiredSourceMetadata", () => {
  it("treats owner retirement, publisher withdrawal or supersession, and a passed expiry date as retired", async () => {
    const { isRetiredSourceMetadata } = await import("../src/lib/source-governance");
    const base = { document_status: "current" as const, change_state: "unchanged" as const, expiry_date: null };

    expect(isRetiredSourceMetadata(base, NOW)).toBe(false);
    expect(isRetiredSourceMetadata({ ...base, document_status: "outdated" }, NOW)).toBe(true);
    expect(isRetiredSourceMetadata({ ...base, change_state: "withdrawn" }, NOW)).toBe(true);
    expect(isRetiredSourceMetadata({ ...base, change_state: "superseded" }, NOW)).toBe(true);
    expect(isRetiredSourceMetadata({ ...base, expiry_date: "2026-10-19" }, NOW)).toBe(true);
  });

  it("does not retire a source on missing, unknown, review-due or not-yet-passed metadata", async () => {
    const { isRetiredSourceMetadata } = await import("../src/lib/source-governance");
    const base = { document_status: "current" as const, change_state: "unchanged" as const, expiry_date: null };

    // Unknown is not bad (docs/rag-behaviour/refuted-approaches.md, Refutation 3).
    expect(isRetiredSourceMetadata({ ...base, document_status: "unknown", change_state: "unknown" }, NOW)).toBe(false);
    expect(isRetiredSourceMetadata({ ...base, document_status: "review_due" }, NOW)).toBe(false);
    expect(isRetiredSourceMetadata({ ...base, change_state: "changed" }, NOW)).toBe(false);
    // The expiry day itself is still in date (Perth calendar date).
    expect(isRetiredSourceMetadata({ ...base, expiry_date: "2026-10-20" }, NOW)).toBe(false);
    expect(isRetiredSourceMetadata({ ...base, expiry_date: "2027-01-01" }, NOW)).toBe(false);
    expect(isRetiredSourceMetadata({}, NOW)).toBe(false);
  });

  it("excludes retired results without touching the order or identity of the rest", async () => {
    const { excludeRetiredSources } = await import("../src/lib/source-governance");
    const current = chunk();
    const unenriched = chunk({ id: "plain-chunk", document_id: "plain-doc", source_metadata: null });
    (unenriched as { source_metadata: unknown }).source_metadata = null;
    const withdrawn = chunk({ id: "w", document_id: "w-doc", source_metadata: { change_state: "withdrawn" } });
    const expired = chunk({ id: "e", document_id: "e-doc", source_metadata: { expiry_date: "2025-12-31" } });

    const untouched = [current, unenriched];
    expect(excludeRetiredSources(untouched, NOW)).toBe(untouched);
    expect(excludeRetiredSources([withdrawn, current, supersededOld, unenriched, expired], NOW)).toEqual([
      current,
      unenriched,
    ]);
  });
});

describe("legacy retrieval selection", () => {
  it("drops retired candidates before selection so the replacement takes the slot", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { selectRankedRetrievalResults } = await import("../src/lib/rag/rag-hydration");

    const selected = selectRankedRetrievalResults({
      query: "What ANC threshold should withhold clozapine?",
      queryClass: "table_threshold",
      candidates: [supersededOld, chunk()],
      topK: 1,
      maxResultsPerDocument: 4,
    });

    expect(selected.map((result) => result.document_id)).toEqual(["replacement-doc"]);
  });
});

class EmptyQuery implements PromiseLike<{ data: unknown[]; error: null }> {
  select() {
    return this;
  }
  in() {
    return this;
  }
  eq() {
    return this;
  }
  neq() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  abortSignal() {
    return this;
  }
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

function mockOfflineRetrieval(textRows: SearchResult[]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("RAG_PROVIDER_MODE", "offline");
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
  vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");
  const rpc = vi.fn(async (name: string) => {
    if (name === "match_document_chunks_text_v2" || name === "match_document_chunks_text") {
      return { data: textRows, error: null };
    }
    return { data: [], error: null };
  });
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({ rpc, from: vi.fn(() => new EmptyQuery()) }),
  }));
  const generateStructuredTextResult = vi.fn();
  const embedTextWithTelemetry = vi.fn();
  vi.doMock("@/lib/openai", () => ({ embedTextWithTelemetry, generateStructuredTextResult }));
}

describe("legacy search and answer paths", () => {
  it("answers from the replacement guideline instead of refusing when the superseded one also matches", async () => {
    mockOfflineRetrieval([supersededOld, chunk()]);
    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const { buildGovernedAnswerClientResponse } = await import("../src/lib/answer-response");

    const answer = await answerQuestionWithScope({
      query: "What ANC threshold should withhold clozapine?",
      ownerId: undefined,
      logQuery: false,
      skipCache: true,
    });

    expect(answer.sources.map((source) => source.document_id)).not.toContain("old-doc");
    expect(answer.citations.map((citation) => citation.document_id)).toEqual(["replacement-doc"]);
    expect(answer.grounded).toBe(true);
    expect(answer.answer).toContain("1.5");
    expect(answer.answer).not.toContain("2.0");

    const boundary = buildGovernedAnswerClientResponse(answer);
    expect(boundary.refused).toBe(false);
  });

  it("leaves withdrawn, superseded and expired documents out of Search results", async () => {
    const withdrawn = chunk({
      id: "withdrawn-chunk",
      document_id: "withdrawn-doc",
      file_name: "withdrawn.pdf",
      text_rank: 1.3,
      source_metadata: { change_state: "withdrawn" },
    });
    const expired = chunk({
      id: "expired-chunk",
      document_id: "expired-doc",
      file_name: "expired.pdf",
      text_rank: 1.2,
      source_metadata: { expiry_date: "2026-06-30" },
    });
    mockOfflineRetrieval([supersededOld, withdrawn, expired, chunk()]);
    const { searchChunksWithTelemetry } = await import("../src/lib/rag/rag");

    const { results } = await searchChunksWithTelemetry({
      query: "What ANC threshold should withhold clozapine?",
      ownerId: "owner-1",
      topK: 8,
      skipCache: true,
    });

    expect(results.map((result) => result.document_id)).toEqual(["replacement-doc"]);
  });
});

describe("answer boundary backstop", () => {
  it("flags every retired source as outdated danger, using the same predicate retrieval filters on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { sourceGovernanceWarnings, OUTDATED_SOURCE_WARNING_MESSAGE } = await import("../src/lib/source-governance");
    const retired = [
      supersededOld,
      chunk({ id: "w", document_id: "w-doc", source_metadata: { change_state: "withdrawn" } }),
      chunk({ id: "s", document_id: "s-doc", source_metadata: { change_state: "superseded" } }),
      chunk({ id: "e", document_id: "e-doc", source_metadata: { expiry_date: "2026-10-19" } }),
    ];

    for (const result of retired) {
      expect(sourceGovernanceWarnings({ results: [result] })).toContainEqual(
        expect.objectContaining({ severity: "danger", message: OUTDATED_SOURCE_WARNING_MESSAGE }),
      );
    }
    const inDate = chunk({ source_metadata: { expiry_date: "2026-10-20" } });
    expect(sourceGovernanceWarnings({ results: [inDate] }).some((warning) => warning.severity === "danger")).toBe(
      false,
    );
  });
});
