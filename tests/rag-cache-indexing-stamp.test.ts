import { withMockRagScopeRevision } from "./rag-cache-test-revision";
/**
 * The indexing-stamp corpus-staleness guard (audit L21).
 *
 * Cache keys only. Nothing here touches ranking, ordering, selection, or the
 * retrieval RPCs — see docs/rag-behaviour/safeguards.md.
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

describe("indexing-stamp error is not an empty corpus (L21)", () => {
  it("gives a PostgREST error on the stamp query a distinct value from a genuinely empty corpus", async () => {
    vi.resetModules();
    let mode: "error" | "empty" = "error";
    mockDocumentsQuery(() =>
      mode === "error"
        ? { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } }
        : { data: [], error: null },
    );

    const { cacheIndexingVersion } = await import("../src/lib/rag/rag-cache");
    const args = { ownerId, accessScope: { ownerId, includePublic: true as const } };

    const errorStamp = await cacheIndexingVersion(args, { forceRefresh: true });
    mode = "empty";
    const emptyStamp = await cacheIndexingVersion(args, { forceRefresh: true });

    expect(errorStamp).not.toBe(emptyStamp);
    expect(errorStamp).toContain("index-stamp-unavailable");
    expect(emptyStamp).toContain("rag-cache-scope-v1:");
  });

  it("does not write an answer to the cache under an unavailable stamp", async () => {
    vi.resetModules();
    let mode: "error" | "ok" = "error";
    mockDocumentsQuery(() =>
      mode === "error"
        ? { data: null, error: { message: "fetch failed" } }
        : { data: [{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }], error: null },
    );

    const { getCachedAnswer, setCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const args = { query: "clozapine monitoring", ownerId, accessScope: { ownerId, includePublic: true as const } };

    await setCachedAnswer(args, sampleAnswer("written during the stamp outage"));

    // The stamp query recovers, the corpus was reindexed in the meantime, and a
    // second stamp failure must not be able to hand back the pre-reindex answer.
    mode = "ok";
    expect(await getCachedAnswer(args, Date.now())).toBeNull();
    mode = "error";
    expect(await getCachedAnswer(args, Date.now())).toBeNull();
  });
});
