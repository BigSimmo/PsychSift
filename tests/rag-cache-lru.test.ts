import { withMockRagScopeRevision } from "./rag-cache-test-revision";
/**
 * Process-local answer-cache eviction order (audit L134).
 *
 * Eviction order only. Nothing here touches ranking, ordering, selection, or
 * the retrieval RPCs — see docs/rag-behaviour/safeguards.md.
 */
import { describe, expect, it, vi } from "vitest";

import type { RagAnswer } from "../src/lib/types";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sampleAnswer(answer: string): RagAnswer {
  return {
    answer,
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [],
    routingMode: "fast",
    routingReason: "test",
    modelUsed: "test-model",
  };
}

type DocumentsResult = { data: unknown; error: unknown };

function mockDocumentsQuery(result: () => DocumentsResult) {
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () =>
      withMockRagScopeRevision({
        from: vi.fn((table: string) => {
          if (table !== "documents") {
            return {
              delete: vi.fn(() => ({
                eq: vi.fn(function eq(this: unknown) {
                  return this;
                }),
                is: vi.fn(function is(this: unknown) {
                  return this;
                }),
                in: vi.fn(function inFilter(this: unknown) {
                  return this;
                }),
                then: (onfulfilled?: (value: { data: null; error: null }) => unknown) =>
                  Promise.resolve({ data: null, error: null }).then(onfulfilled),
              })),
              insert: vi.fn(async () => ({ data: null, error: null })),
              select: vi.fn(() => ({
                eq: vi.fn(function eq(this: unknown) {
                  return this;
                }),
                then: (onfulfilled?: (value: { data: null; error: null }) => unknown) =>
                  Promise.resolve({ data: null, error: null }).then(onfulfilled),
              })),
            };
          }
          const builder: Record<string, unknown> = {};
          for (const method of ["select", "eq", "is", "or", "in", "order", "limit", "abortSignal"]) {
            builder[method] = vi.fn(() => builder);
          }
          builder.then = (onfulfilled?: (value: DocumentsResult) => unknown) =>
            Promise.resolve(result()).then(onfulfilled);
          return builder;
        }),
      }),
  }));
}

describe("process-local answer cache is LRU, not FIFO (L134)", () => {
  it("keeps the answer that was read most recently and evicts the one that was not", async () => {
    vi.resetModules();
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "2");
    mockDocumentsQuery(() => ({
      data: [{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }],
      error: null,
    }));

    const { getCachedAnswer, setCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const scope = { ownerId, accessScope: { ownerId, includePublic: true as const } };
    const a = { ...scope, query: "question a" };
    const b = { ...scope, query: "question b" };
    const c = { ...scope, query: "question c" };

    await setCachedAnswer(a, sampleAnswer("answer a"));
    await setCachedAnswer(b, sampleAnswer("answer b"));

    // The ward-round pattern: the same handful of questions repeated. Reading `a`
    // must make it the most recent entry, not leave it the oldest-inserted one.
    expect(await getCachedAnswer(a, Date.now())).not.toBeNull();

    await setCachedAnswer(c, sampleAnswer("answer c"));

    expect(await getCachedAnswer(a, Date.now())).not.toBeNull();
    expect(await getCachedAnswer(b, Date.now())).toBeNull();
    expect(await getCachedAnswer(c, Date.now())).not.toBeNull();

    vi.unstubAllEnvs();
  });

  it("moves a refreshed answer to the most-recent position instead of keeping its old slot", async () => {
    vi.resetModules();
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "2");
    mockDocumentsQuery(() => ({
      data: [{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }],
      error: null,
    }));

    const { getCachedAnswer, setCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const scope = { ownerId, accessScope: { ownerId, includePublic: true as const } };
    const a = { ...scope, query: "question a" };
    const b = { ...scope, query: "question b" };
    const c = { ...scope, query: "question c" };

    await setCachedAnswer(a, sampleAnswer("answer a"));
    await setCachedAnswer(b, sampleAnswer("answer b"));
    // Re-cache `a` without reading it first: an overwrite must re-position it.
    await setCachedAnswer(a, sampleAnswer("answer a refreshed"));
    await setCachedAnswer(c, sampleAnswer("answer c"));

    expect((await getCachedAnswer(a, Date.now()))?.answer).toBe("answer a refreshed");
    expect(await getCachedAnswer(b, Date.now())).toBeNull();

    vi.unstubAllEnvs();
  });
});
