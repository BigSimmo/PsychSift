import { afterEach, describe, expect, it, vi } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";

// Finding #11 interim fix: the LLM classifier verdict must be deterministic per query for
// the memo TTL window, so the unsupported short-circuit cannot flip run-to-run and return
// 0 results for a valid in-corpus topic on some runs but not others.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.useRealTimers();
});

async function loadWithClassifierMock(mock: ReturnType<typeof vi.fn>) {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_QUERY_CLASSIFIER_MODEL", "gpt-classifier-test");
  vi.doMock("@/lib/openai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/openai")>();
    return { ...actual, generateParsedTextResult: mock };
  });
  const rag = await import("../src/lib/rag/rag");
  const { analyzeClinicalQuery } = await import("../src/lib/clinical-search");
  const { isUnsupportedSoftTailAnalysis } = await import("../src/lib/rag/rag-query-guard");
  rag.resetClassifierVerdictMemoForTests();
  return { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis };
}

function classifierResponse(overrides: Record<string, unknown> = {}) {
  return {
    parsed: {
      queryClass: "broad_summary",
      confidence: 0.9,
      reasons: ["classifier_test"],
      expandedTerms: ["mood disorder"],
      ...overrides,
    },
  };
}

function fallbackQueryAnalysis(
  analyzeClinicalQuery: (typeof import("../src/lib/clinical-search"))["analyzeClinicalQuery"],
  isUnsupportedSoftTailAnalysis: (typeof import("../src/lib/rag/rag-query-guard"))["isUnsupportedSoftTailAnalysis"],
) {
  // A bare condition query above the short-query deterministic fallback threshold still needs
  // the LLM fallback (confidence below 0.58 with class unsupported_or_general).
  const query = "bipolar disorder long term care";
  const analysis = analyzeClinicalQuery(query);
  expect(analysis.needsClassifierFallback).toBe(true);
  // Pin the non-soft-tail shape explicitly so a scoring tweak cannot silently move this
  // fixture into the soft-tail bucket (and vice versa) without failing loudly.
  expect(isUnsupportedSoftTailAnalysis(query, analysis)).toBe(false);
  return { query, analysis };
}

describe("classifier verdict memoization", () => {
  it("does not re-call the model for a repeated query and returns an identical verdict", async () => {
    const mock = vi.fn(async () => classifierResponse());
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    const first = await rag.analyzeQueryWithClassifierFallback(query, analysis);
    const second = await rag.analyzeQueryWithClassifierFallback(query, analysis);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.objectContaining({
        model: "gpt-classifier-test",
        promptCacheKey: "clinical-rag-query-classifier-v1",
      }),
    );
    expect(first.queryClass).toBe("broad_summary");
    expect(second.queryClass).toBe("broad_summary");
    expect(second).toEqual(first);
  });

  it("builds a bounded plan after the finalized classifier verdict without another provider call", async () => {
    const mock = vi.fn(async () => classifierResponse());
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { buildRagQueryPlan } = await import("../src/lib/rag/rag-query-plan");
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    const finalized = await rag.analyzeQueryWithClassifierFallback(query, analysis);
    const plan = buildRagQueryPlan(query, finalized);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(plan.kind).toBe("decomposed");
    expect(plan.subquestions.length).toBeLessThanOrEqual(4);
  });

  it("memoizes rejected verdicts so a rejection is also deterministic", async () => {
    const mock = vi.fn(async () => classifierResponse({ confidence: 0.3 }));
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    const first = await rag.analyzeQueryWithClassifierFallback(query, analysis);
    const second = await rag.analyzeQueryWithClassifierFallback(query, analysis);

    expect(mock).toHaveBeenCalledTimes(1);
    // Rejected verdict (confidence < 0.58) leaves the deterministic analysis untouched.
    expect(first).toBe(analysis);
    expect(second).toBe(analysis);
  });

  // "catatonia" is a bare single-word query: low confidence, no medications/thresholds/title
  // terms, few expanded terms — exactly the soft-tail bucket the unsupported short-circuit
  // treats specially (isUnsupportedSoftTailAnalysis true), unlike fallbackQueryAnalysis's
  // multi-word fixture above (confidence 0.45, just above the 0.42 soft-tail ceiling).
  function softTailQueryAnalysis(
    analyzeClinicalQuery: (typeof import("../src/lib/clinical-search"))["analyzeClinicalQuery"],
    isUnsupportedSoftTailAnalysis: (typeof import("../src/lib/rag/rag-query-guard"))["isUnsupportedSoftTailAnalysis"],
  ) {
    const query = "catatonia";
    // Mirror production: searchChunksWithTelemetry always passes opts.corpusGrounding, and a
    // corpus-grounding verdict of "inconclusive" (no matching document title, so the query can't
    // be deterministically rescued) is what routes a bare in-corpus topic like "catatonia" to the
    // classifier at all — otherwise the Finding #2 deterministic short-query fallback (rag.ts
    // ~1122-1134) rescues it before ever calling the classifier, and these tests would prove
    // nothing about the memo. Setting corpusGrounding directly reproduces that gate without
    // depending on the corpus-grounding module's live database call.
    const analysis = { ...analyzeClinicalQuery(query), corpusGrounding: "inconclusive" as const };
    expect(analysis.needsClassifierFallback).toBe(true);
    // Pin soft-tail eligibility explicitly so a scoring tweak cannot silently move this
    // fixture out of the soft-tail bucket without failing loudly.
    expect(isUnsupportedSoftTailAnalysis(query, analysis)).toBe(true);
    return { query, analysis };
  }

  it("still memoizes a rejected soft-tail verdict within its short TTL (bounded, not unlimited retries)", async () => {
    const mock = vi.fn(async () => classifierResponse({ confidence: 0.3 }));
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = softTailQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    const first = await rag.analyzeQueryWithClassifierFallback(query, analysis);
    const second = await rag.analyzeQueryWithClassifierFallback(query, analysis);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(first).toBe(analysis);
    expect(second).toBe(analysis);
  });

  it("re-calls the classifier for a rejected soft-tail verdict after its short TTL expires, so it can recover", async () => {
    // The two-call proof Codex review asked for on PR #1646: reject on call 1, recover on call 2
    // — reachable only once the short soft-tail TTL (60s, well under the full 15-minute TTL)
    // expires, never on an immediate repeat (see the previous test).
    vi.useFakeTimers({ now: new Date("2026-07-06T00:00:00Z") });
    const mock = vi
      .fn()
      .mockResolvedValueOnce(classifierResponse({ confidence: 0.3 }))
      .mockResolvedValueOnce(classifierResponse());
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = softTailQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    const first = await rag.analyzeQueryWithClassifierFallback(query, analysis);
    vi.setSystemTime(new Date("2026-07-06T00:01:01Z"));
    const second = await rag.analyzeQueryWithClassifierFallback(query, analysis);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(first).toBe(analysis);
    expect(first.queryClass).toBe("unsupported_or_general");
    expect(second.queryClass).toBe("broad_summary");
    expect(second.needsClassifierFallback).toBe(false);
  });

  it("sends only supported structural constraints to Structured Outputs", async () => {
    const mock = vi.fn(async () => classifierResponse());
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    await rag.analyzeQueryWithClassifierFallback(query, analysis);

    const calls = mock.mock.calls as unknown as Array<[unknown, ZodType, unknown]>;
    const format = zodTextFormat(calls[0]![1], "classifier_schema_probe");
    const schemaJson = JSON.stringify(format);
    expect(schemaJson).not.toMatch(/"(?:minimum|maximum|maxItems|maxLength)"/);
  });

  it("rejects out-of-bounds classifier output after parsing and keeps it retryable", async () => {
    const mock = vi.fn(async () =>
      classifierResponse({
        confidence: 1.1,
        reasons: Array.from({ length: 5 }, (_, index) => `reason-${index}`),
        expandedTerms: Array.from({ length: 11 }, (_, index) => `term-${index}`),
      }),
    );
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    const first = await rag.analyzeQueryWithClassifierFallback(query, analysis);
    const second = await rag.analyzeQueryWithClassifierFallback(query, analysis);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(first).toBe(analysis);
    expect(second).toBe(analysis);
  });

  it("threads a pseudonymous safety identifier for an authenticated classifier request", async () => {
    vi.stubEnv("OPENAI_SAFETY_IDENTIFIER_SECRET", "test-secret-that-is-at-least-thirty-two-characters");
    const mock = vi.fn(async () => classifierResponse());
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    await rag.analyzeQueryWithClassifierFallback(query, analysis, { ownerId: "owner-a" });

    const calls = mock.mock.calls as unknown as Array<[unknown, unknown, { safetyIdentifier?: string }]>;
    const options = calls[0]?.[2];
    expect(options?.safetyIdentifier).toMatch(/^[a-f0-9]{64}$/);
    expect(options?.safetyIdentifier).not.toContain("owner-a");
  });

  it("does not memoize transport errors — the next request retries the classifier", async () => {
    const mock = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(classifierResponse());
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    const first = await rag.analyzeQueryWithClassifierFallback(query, analysis);
    const second = await rag.analyzeQueryWithClassifierFallback(query, analysis);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(first).toBe(analysis);
    expect(second.queryClass).toBe("broad_summary");
  });

  it("deduplicates concurrent in-flight calls for the same query", async () => {
    let resolveCall: ((value: ReturnType<typeof classifierResponse>) => void) | undefined;
    const mock = vi.fn(
      () =>
        new Promise<{ parsed: ReturnType<typeof classifierResponse>["parsed"] }>((resolve) => {
          resolveCall = resolve;
        }),
    );
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    const firstPromise = rag.analyzeQueryWithClassifierFallback(query, analysis);
    const secondPromise = rag.analyzeQueryWithClassifierFallback(query, analysis);
    resolveCall?.(classifierResponse());
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(first.queryClass).toBe("broad_summary");
    expect(second.queryClass).toBe("broad_summary");
  });

  it("skips the classifier when fallback is not required", async () => {
    const mock = vi.fn();
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);
    const fallback = { ...analysis, needsClassifierFallback: false, queryClass: "unsupported_or_general" as const };
    const result = await rag.analyzeQueryWithClassifierFallback(query, fallback);

    expect(mock).toHaveBeenCalledTimes(0);
    expect(result).toBe(fallback);
    expect(result.queryClass).toBe("unsupported_or_general");
  });

  it("re-calls the model after the memo TTL expires", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-06T00:00:00Z") });
    const mock = vi.fn(async () => classifierResponse());
    const { rag, analyzeClinicalQuery, isUnsupportedSoftTailAnalysis } = await loadWithClassifierMock(mock);
    const { query, analysis } = fallbackQueryAnalysis(analyzeClinicalQuery, isUnsupportedSoftTailAnalysis);

    await rag.analyzeQueryWithClassifierFallback(query, analysis);
    vi.setSystemTime(new Date("2026-07-06T00:16:00Z"));
    await rag.analyzeQueryWithClassifierFallback(query, analysis);

    expect(mock).toHaveBeenCalledTimes(2);
  });
});
