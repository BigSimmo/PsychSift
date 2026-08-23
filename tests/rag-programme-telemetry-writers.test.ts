import { afterEach, describe, expect, it, vi } from "vitest";
import type { RagAnswer } from "../src/lib/types";

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NESTED_REASON_CANARY = "provider-error-canary: raw upstream body";

type Insert = { table: string; row: Record<string, unknown> };

function answer(): RagAnswer {
  return {
    answer: "Cached clinical answer.",
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [],
    routingMode: "fast",
    routingReason: "strong_routine_retrieval",
    modelUsed: "test-model",
  };
}

function contaminatedNestedReasonAnswer(): RagAnswer {
  const diagnostics = governanceRefusalAnswer().programmeDiagnostics;
  return {
    ...answer(),
    grounded: false,
    confidence: "unsupported",
    routingReason: "routing-reason-canary: protected route text",
    fallbackReason: "fallback-reason-canary: protected source text",
    degradedMode: { active: true, reason: "degraded-reason-canary: raw provider text" },
    programmeDiagnostics: {
      ...diagnostics,
      coverageCounts: { direct: 0, partial: 0, conflicting: 0, absent: 1 },
      candidateCounts: {
        uploaded_local: 0,
        clinical_kb_site: 0,
        australian_public: 0,
        international_supplementary: 0,
      },
      selectedCounts: {
        uploaded_local: 0,
        clinical_kb_site: 0,
        australian_public: 0,
        international_supplementary: 0,
      },
      insufficiencyReason: NESTED_REASON_CANARY,
      generationOutcome: "failed",
    } as unknown as NonNullable<RagAnswer["programmeDiagnostics"]>,
  };
}

function governanceRefusalAnswer(): RagAnswer {
  const source = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    document_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title: "Outdated clinical guideline",
    file_name: "outdated-guideline.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "Use the superseded monitoring pathway.",
    image_ids: [],
    images: [],
    similarity: 0.9,
    source_metadata: {
      source_title: "Outdated clinical guideline",
      publisher: "WA Health",
      publisher_code: "WA_HEALTH",
      jurisdiction: "Australia/WA",
      version: null,
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: "outdated" as const,
      clinical_validation_status: "approved" as const,
      extraction_quality: "good" as const,
    },
  };
  return {
    answer: "Generated answer that must not be served.",
    grounded: true,
    confidence: "high",
    citations: [
      {
        chunk_id: source.id,
        document_id: source.document_id,
        title: source.title,
        file_name: source.file_name,
        page_number: source.page_number,
        chunk_index: source.chunk_index,
      },
    ],
    sources: [source],
    responseMode: "document_lookup",
    routingMode: "strong",
    routingReason: "strong_routine_retrieval",
    modelUsed: "test-model",
    programmeDiagnostics: {
      queryPlanKind: "single",
      subquestionCount: 1,
      materialAmbiguity: false,
      coverageCounts: { direct: 1, partial: 0, conflicting: 0, absent: 0 },
      candidateCounts: {
        uploaded_local: 1,
        clinical_kb_site: 0,
        australian_public: 0,
        international_supplementary: 0,
      },
      selectedCounts: {
        uploaded_local: 1,
        clinical_kb_site: 0,
        australian_public: 0,
        international_supplementary: 0,
      },
      selectedSiteDomains: [],
      siteCandidateCount: 0,
      siteSelectedCount: 0,
      publicSiteContentState: "disabled",
      siteStaticManifestMatch: null,
      sitePendingCount: null,
      augmentationOutcome: "disabled",
      roleExclusionCount: 0,
      insufficiencyReason: null,
      generationOutcome: "generated",
      verifiedUnitsEmitted: 0,
      verifiedUnitsDiscarded: 0,
      reconciliationOutcome: "not_applicable",
    },
  };
}

async function responseInteractionId(response: Response) {
  const payload = (await response.json()) as { interactionId: string; programmeDiagnostics?: unknown };
  expect(payload).not.toHaveProperty("programmeDiagnostics");
  return payload.interactionId;
}

function sseInteractionId(body: string) {
  const data = body
    .split(/\n\n+/)
    .map((frame) => frame.split("\n"))
    .find((lines) => lines.includes("event: final"))
    ?.find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!data) return undefined;
  const payload = JSON.parse(data) as { interactionId: string; programmeDiagnostics?: unknown };
  expect(payload).not.toHaveProperty("programmeDiagnostics");
  return payload.interactionId;
}

async function installHarness(options: {
  cache?: RagAnswer;
  coalesced?: RagAnswer;
  emptyScope?: boolean;
  emptySummary?: boolean;
}) {
  vi.resetModules();
  const inserts: Insert[] = [];
  const client = {
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      }),
    })),
  };

  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
  vi.doMock("@/lib/env", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/env")>();
    return {
      ...actual,
      env: {
        ...actual.env,
        RAG_ANSWER_CACHE_TTL_MS: 60_000,
        RAG_ANSWER_CACHE_SIZE: 100,
        RAG_AWAIT_QUERY_LOGS: true,
        RAG_TELEMETRY_EXTENDED: true,
      },
      isDemoMode: () => false,
      isLocalNoAuthMode: () => false,
    };
  });
  vi.doMock("@/lib/rag/rag-cache", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/rag/rag-cache")>();
    return {
      ...actual,
      answerCacheAllowedForOwner: () => true,
      cacheIndexingVersion: vi.fn(async () => "test-version"),
      getCachedAnswer: vi.fn(async () => options.cache ?? null),
      getSharedCachedAnswer: vi.fn(async () => null),
      scopedAnswerCacheKey: () => "telemetry-key",
      answerInflight: new Map(options.coalesced ? [["telemetry-key", Promise.resolve(options.coalesced)]] : []),
    };
  });
  vi.doMock("@/lib/public-api-access", () => ({
    publicAccessContext: vi.fn(async () => ({
      authenticated: true,
      ownerId: OWNER_ID,
      rateLimitSubject: { kind: "owner", id: OWNER_ID },
    })),
  }));
  vi.doMock("@/lib/api-rate-limit", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/api-rate-limit")>();
    const allowed = {
      limited: false,
      limit: 100,
      remaining: 99,
      retryAfterSeconds: 0,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
    };
    return {
      ...actual,
      consumeSubjectApiRateLimit: vi.fn(async () => allowed),
      consumeSummaryRateLimits: vi.fn(async () => ({ bucket: "document_summarize", rateLimit: allowed })),
    };
  });
  vi.doMock("@/lib/search-scope", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/search-scope")>()),
    resolveSearchScope: vi.fn(async () => ({
      documentIds: options.emptyScope
        ? []
        : options.emptySummary
          ? ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]
          : undefined,
      filters: {},
      activeFilterCount: 0,
      warnings: [],
    })),
  }));
  vi.doMock("@/lib/rag/rag-document-summary-context", () => ({
    loadDocumentSummaryContext: vi.fn(async () => ({
      document: { title: "Summary document", metadata: {} },
      chunks: [],
    })),
  }));

  return { inserts };
}

function expectJoinedWrites(inserts: Insert[], interactionId: string | undefined) {
  expect(interactionId).toEqual(expect.any(String));
  const query = inserts.find((insert) => insert.table === "rag_queries");
  const retrieval = inserts.find((insert) => insert.table === "rag_retrieval_logs");
  expect((query?.row.metadata as { interaction_id?: string } | undefined)?.interaction_id).toBe(interactionId);
  expect(
    (retrieval?.row.metadata as { answer?: { interaction_id?: string } } | undefined)?.answer?.interaction_id,
  ).toBe(interactionId);
}

function reasonFields(value: unknown) {
  const entries: Array<[string, unknown]> = [];
  function visit(current: unknown, path: string) {
    if (!current || typeof current !== "object") return;
    for (const [key, nested] of Object.entries(current)) {
      const nestedPath = `${path}.${key}`;
      if (/(?:^|_)reason$/i.test(key)) entries.push([nestedPath, nested]);
      visit(nested, nestedPath);
    }
  }
  visit(value, "$" as const);
  return Object.fromEntries(entries);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("RAG programme telemetry writers", () => {
  it.each([
    ["local cache", { cache: answer() }],
    ["in-flight coalescing", { coalesced: answer() }],
  ])(
    "writes the same route UUID for %s outcomes",
    async (_label, options) => {
      const { inserts } = await installHarness(options);
      const { POST } = await import("../src/app/api/answer/route");
      const response = await POST(
        new Request("http://localhost/api/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "cached clinical question" }),
        }),
      );
      const interactionId = await responseInteractionId(response);
      await vi.waitFor(() => expect(inserts).toHaveLength(2));
      expectJoinedWrites(inserts, interactionId);
    },
    60_000,
  );

  it.each([
    ["local cache", { cache: contaminatedNestedReasonAnswer() }],
    ["in-flight coalescing", { coalesced: contaminatedNestedReasonAnswer() }],
  ])(
    "bounds nested reason canaries in both complete rows for %s outcomes",
    async (_label, options) => {
      const { inserts } = await installHarness(options);
      const { POST } = await import("../src/app/api/answer/route");
      await POST(
        new Request("http://localhost/api/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "cached clinical question" }),
        }),
      );
      await vi.waitFor(() => expect(inserts).toHaveLength(2));
      const query = inserts.find((insert) => insert.table === "rag_queries")?.row;
      const retrieval = inserts.find((insert) => insert.table === "rag_retrieval_logs")?.row;

      expect(JSON.stringify(inserts)).not.toContain("-reason-canary");
      expect(JSON.stringify(inserts)).not.toContain(NESTED_REASON_CANARY);
      expect(reasonFields(query)).toEqual({
        "$.metadata.insufficiency_reason": "insufficient_claim_support",
        "$.metadata.routing_reason": "fast",
        "$.metadata.fallback_reason": "insufficient_claim_support",
      });
      expect(reasonFields(retrieval)).toEqual({
        "$.miss_reason": "insufficient_claim_support",
        "$.metadata.answer.routing_reason": "fast",
        "$.metadata.answer.fallback_reason": "insufficient_claim_support",
      });
    },
    60_000,
  );

  it("writes the same route UUID for a streaming summary with no committed chunks", async () => {
    const { inserts } = await installHarness({ emptySummary: true });
    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "summarize this document",
          documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          summaryMode: true,
        }),
      }),
    );
    const interactionId = sseInteractionId(await response.text());
    await vi.waitFor(() => expect(inserts).toHaveLength(2));
    expectJoinedWrites(inserts, interactionId);
  });

  it("writes the same route UUID for an empty-scope early answer", async () => {
    const { inserts } = await installHarness({ emptyScope: true });
    const { POST } = await import("../src/app/api/answer/route");
    const response = await POST(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "question outside selected scope" }),
      }),
    );
    const interactionId = await responseInteractionId(response);
    await vi.waitFor(() => expect(inserts).toHaveLength(2));
    expectJoinedWrites(inserts, interactionId);
  });

  it("records the final served governance refusal in both stores", async () => {
    const { inserts } = await installHarness({ cache: governanceRefusalAnswer() });
    const { POST } = await import("../src/app/api/answer/route");
    const response = await POST(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "use the outdated monitoring guideline" }),
      }),
    );
    const payload = (await response.json()) as { grounded: boolean; confidence: string; interactionId: string };
    await vi.waitFor(() => expect(inserts).toHaveLength(2));
    const query = inserts.find((insert) => insert.table === "rag_queries")?.row;
    const retrieval = inserts.find((insert) => insert.table === "rag_retrieval_logs")?.row;

    expect(payload).toMatchObject({ grounded: false, confidence: "unsupported" });
    expect(query?.metadata).toMatchObject({
      interaction_id: payload.interactionId,
      grounded: false,
      confidence: "unsupported",
      coverage_counts: { direct: 0, partial: 0, conflicting: 0, absent: 1 },
      insufficiency_reason: "governance_block",
      generation_outcome: "failed",
    });
    expect(retrieval).toMatchObject({
      metadata: {
        answer: {
          interaction_id: payload.interactionId,
          grounded: false,
          confidence: "unsupported",
          response_mode: "evidence_gap",
          fallback_reason: "governance_block",
        },
      },
    });
  });
});
