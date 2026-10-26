import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The health professional declaration check has its own tests
// (tests/health-professional-declaration.test.ts); these route tests use accounts that hold it.
vi.mock("@/lib/clinical-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clinical-access")>()),
  requireHealthProfessionalDeclaration: async () => undefined,
}));

/**
 * Admission-cost guard for the /api/answer preamble (latency audit 2026-07-28, L1-2).
 *
 * A denied request must cost zero scope queries. `resolveSearchScope` pages
 * `documents` and their labels whenever the caller sends filters or explicit ids, and
 * an AbortSignal cancels the client request without un-executing a query Postgres has
 * already started — so "start scope early and abort on deny" is NOT free, and was
 * removed after review. These tests pin the ordering so a future latency pass cannot
 * reintroduce the overlap, and pin the signal threading that was kept.
 */

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const publicAccessContext = vi.fn();
const consumeSubjectApiRateLimit = vi.fn();
const resolveSearchScope = vi.fn();
const answerQuestionWithScope = vi.fn();

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isDemoMode: () => false,
  isLocalNoAuthMode: () => false,
}));
vi.mock("@/lib/supabase/admin", () => ({
  // Only the route's fire-and-forget telemetry insert touches the client directly;
  // scope and the limiter are mocked below. Without `from` the insert logs a noisy
  // failure that has nothing to do with what these tests assert.
  createAdminClient: () => ({
    from: () => ({ insert: async () => ({ data: null, error: null }) }),
  }),
}));
vi.mock("@/lib/public-api-access", () => ({ publicAccessContext }));
vi.mock("@/lib/api-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-rate-limit")>()),
  consumeSubjectApiRateLimit,
}));
vi.mock("@/lib/search-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search-scope")>()),
  resolveSearchScope,
}));
vi.mock("@/lib/rag/rag", () => ({ answerQuestionWithScope }));

function answerRequest() {
  return new Request("http://localhost/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "clozapine monitoring thresholds" }),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function rateLimitDecision(limited: boolean) {
  return {
    limited,
    limit: 100,
    remaining: limited ? 0 : 99,
    retryAfterSeconds: limited ? 60 : 0,
    resetAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

const normalScope = {
  documentIds: ["private-scope-document-id"],
  filters: { collections: ["private-filter"] },
  activeFilterCount: 1,
  matchedDocumentCount: 1,
  warnings: ["Scoped to one current source."],
  summary: "One active filter",
  futureInternalField: "private",
};

const coverageGapAnswer = {
  answer: "The active sources support only part of this question.",
  grounded: false,
  confidence: "unsupported",
  citations: [],
  sources: [
    {
      id: "coverage-chunk-1",
      document_id: "public-source-document-1",
      title: "Current clinical guidance",
      file_name: "current-guidance.pdf",
      page_number: 2,
      chunk_index: 1,
      section_heading: "Monitoring",
      content: "The source confirms monitoring is required but does not cover the requested threshold.",
      image_ids: [],
      similarity: 0.81,
      adjacent_before: [{ id: "private-adjacent-chunk" }],
    },
  ],
  fallbackReasonCode: "coverage_gap",
  fallbackReason: "private_raw_coverage_reason",
  routingReason: "private_internal_route_reason",
  degradedMode: { active: true, reason: "private_raw_coverage_reason" },
};

beforeEach(() => {
  publicAccessContext.mockResolvedValue({
    ownerId,
    authenticated: true,
    rateLimitSubject: { kind: "owner", id: ownerId },
  });
  answerQuestionWithScope.mockResolvedValue({
    answer: "stub",
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [],
    latencyTimings: { total_latency_ms: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("/api/answer preamble", () => {
  it.each(["shadow", "canary"] as const)(
    "preserves the resolved %s observation at the JSON response boundary",
    async (rolloutMode) => {
      consumeSubjectApiRateLimit.mockResolvedValue(rateLimitDecision(false));
      resolveSearchScope.mockResolvedValue({ documentIds: undefined, filters: {}, activeFilterCount: 0, warnings: [] });
      const { observeRagAnswer, ragProgrammeTelemetryForAnswer } = await import("@/lib/rag/rag-programme-telemetry");
      const answer = observeRagAnswer(
        { answer: "Use the cited source.", grounded: false, confidence: "unsupported", citations: [], sources: [] },
        { interactionId: "b460aaf8-e955-48cb-955c-547f494ad428", rolloutMode },
      );
      answerQuestionWithScope.mockResolvedValue(answer);
      const { POST } = await import("../src/app/api/answer/route");
      expect((await POST(answerRequest())).status).toBe(200);
      expect(ragProgrammeTelemetryForAnswer(answer)?.rollout_mode).toBe(rolloutMode);
      expect(ragProgrammeTelemetryForAnswer(answer)?.interaction_id).toBe("b460aaf8-e955-48cb-955c-547f494ad428");
    },
  );
  it("does not begin scope resolution until the limiter has admitted the request", async () => {
    const limiter = deferred<ReturnType<typeof rateLimitDecision>>();
    consumeSubjectApiRateLimit.mockReturnValue(limiter.promise);
    resolveSearchScope.mockResolvedValue({ documentIds: undefined, filters: {}, activeFilterCount: 0, warnings: [] });

    const { POST } = await import("../src/app/api/answer/route");
    const response = POST(answerRequest());

    // Anchor on a limiter-start signal rather than a fixed sleep. A timeout can
    // expire before the handler even reaches the limiter, which would let this
    // pass without proving anything; waiting for the limiter to be entered means
    // the route is demonstrably inside the preamble when scope is checked.
    await vi.waitFor(() => expect(consumeSubjectApiRateLimit).toHaveBeenCalledTimes(1));
    expect(resolveSearchScope).not.toHaveBeenCalled();

    limiter.resolve(rateLimitDecision(false));
    expect((await response).status).toBe(200);
    expect(resolveSearchScope).toHaveBeenCalledTimes(1);
  });

  it("dispatches no scope query at all when the limiter denies", async () => {
    consumeSubjectApiRateLimit.mockResolvedValue(rateLimitDecision(true));
    resolveSearchScope.mockResolvedValue({ documentIds: undefined, filters: {}, activeFilterCount: 0, warnings: [] });

    const { POST } = await import("../src/app/api/answer/route");
    // Filters are what push resolveSearchScope past its zero-query early returns
    // (search-scope.ts:242,253) and into the paginated `documents` loop, so this
    // is the shape that made the old overlap expensive for a throttled caller.
    const response = await POST(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "clozapine monitoring", filters: { sourceStatuses: ["current"] } }),
      }),
    );

    expect(response.status).toBe(429);
    expect(resolveSearchScope).not.toHaveBeenCalled();
  });

  it("threads an abort signal so a client disconnect cancels scope's paginated queries", async () => {
    consumeSubjectApiRateLimit.mockResolvedValue(rateLimitDecision(false));
    let observed: AbortSignal | undefined;
    resolveSearchScope.mockImplementation(async (args: { signal?: AbortSignal }) => {
      observed = args.signal;
      return { documentIds: undefined, filters: {}, activeFilterCount: 0, warnings: [] };
    });

    const { POST } = await import("../src/app/api/answer/route");
    const clientAbort = new AbortController();
    const request = new Request("http://localhost/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "lithium range" }),
      signal: clientAbort.signal,
    });

    await POST(request);
    expect(observed).toBeInstanceOf(AbortSignal);
    expect(observed?.aborted).toBe(false);
    clientAbort.abort();
    expect(observed?.aborted).toBe(true);
  });

  it("surfaces a scope failure rather than swallowing it with the settle wrapper", async () => {
    consumeSubjectApiRateLimit.mockResolvedValue(rateLimitDecision(false));
    resolveSearchScope.mockRejectedValue(new Error("scope query failed"));

    const { POST } = await import("../src/app/api/answer/route");
    const response = await POST(answerRequest());

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("projects an empty scope through the same bounded answer payload", async () => {
    consumeSubjectApiRateLimit.mockResolvedValue(rateLimitDecision(false));
    resolveSearchScope.mockResolvedValue({
      documentIds: [],
      filters: { collections: ["private-filter"] },
      activeFilterCount: 1,
      matchedDocumentCount: 0,
      warnings: ["No indexed documents matched."],
      summary: "One active filter",
      futureInternalField: "private",
    });

    const { POST } = await import("../src/app/api/answer/route");
    const response = await POST(answerRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      fallbackReasonCode: "no_candidates",
      degradedMode: { active: true, reason: expect.any(String) },
      sources: [],
    });
    expect(payload).not.toHaveProperty("routingReason");
    expect(payload).not.toHaveProperty("fallbackReason");
    expect(Object.keys(payload.scope)).toEqual([
      "summary",
      "activeFilterCount",
      "matchedDocumentCount",
      "warnings",
      "queryMode",
    ]);
    expect(payload.scope).toEqual({
      summary: "One active filter",
      activeFilterCount: 1,
      matchedDocumentCount: 0,
      warnings: ["No indexed documents matched."],
      queryMode: "auto",
    });
    expect(JSON.stringify(payload.scope)).not.toMatch(/private-filter|futureInternalField|documentIds|filters/);
    expect(answerQuestionWithScope).not.toHaveBeenCalled();
  });

  it("projects a non-empty coverage gap and normal scope through the governed JSON boundary", async () => {
    consumeSubjectApiRateLimit.mockResolvedValue(rateLimitDecision(false));
    resolveSearchScope.mockResolvedValue(normalScope);
    answerQuestionWithScope.mockResolvedValue(coverageGapAnswer);

    const { POST } = await import("../src/app/api/answer/route");
    const response = await POST(answerRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      fallbackReasonCode: "coverage_gap",
      degradedMode: {
        active: true,
        reason: "The active sources support only part of this question.",
      },
      sources: [{ id: "coverage-chunk-1", document_id: "public-source-document-1" }],
    });
    expect(Object.keys(payload.scope)).toEqual([
      "summary",
      "activeFilterCount",
      "matchedDocumentCount",
      "warnings",
      "queryMode",
    ]);
    expect(payload.scope).toEqual({
      summary: "One active filter",
      activeFilterCount: 1,
      matchedDocumentCount: 1,
      warnings: ["Scoped to one current source."],
      queryMode: "auto",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private-scope-document-id|private-filter|futureInternalField|private-adjacent-chunk|private_raw_coverage_reason|private_internal_route_reason/,
    );
  });
});
