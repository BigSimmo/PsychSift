import { afterEach, describe, expect, it, vi } from "vitest";
import type { RagAnswer } from "../src/lib/types";

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("RAG programme telemetry writers", () => {
  it.each([
    ["local cache", { cache: answer() }],
    ["in-flight coalescing", { coalesced: answer() }],
  ])("writes the same route UUID for %s outcomes", async (_label, options) => {
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
  });

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
});
