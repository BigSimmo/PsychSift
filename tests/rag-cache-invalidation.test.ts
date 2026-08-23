import { describe, expect, it, vi } from "vitest";
import type { RagAnswer } from "../src/lib/types";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sampleAnswer(answer = "Cached clinical answer."): RagAnswer {
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

type FilterCall =
  | { method: "eq"; column: string; value: unknown }
  | { method: "is"; column: string; value: unknown }
  | { method: "in"; column: string; value: unknown };

class DeleteQuery implements PromiseLike<{ data: null; error: null }> {
  constructor(private readonly calls: FilterCall[]) {}

  eq(column: string, value: unknown) {
    this.calls.push({ method: "eq", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.calls.push({ method: "is", column, value });
    return this;
  }

  in(column: string, value: unknown) {
    this.calls.push({ method: "in", column, value });
    return this;
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

describe("RAG cache invalidation", () => {
  it("rechecks the lifecycle epoch after deferred request work before a real local answer-cache read", async () => {
    vi.resetModules();
    let lifecycleEpoch = "1";
    const rpc = vi.fn(async () => ({ data: lifecycleEpoch, error: null }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc,
        from: vi.fn((table: string) => {
          if (table === "documents") {
            const builder = {
              select: vi.fn(() => builder),
              eq: vi.fn(() => builder),
              is: vi.fn(() => builder),
              or: vi.fn(() => builder),
              in: vi.fn(() => builder),
              order: vi.fn(() => builder),
              limit: vi.fn(async () => ({
                data: [{ id: "doc-1", updated_at: "2026-08-24T00:00:00.000Z", metadata: {} }],
                error: null,
              })),
              abortSignal: vi.fn(() => builder),
            };
            return builder;
          }
          return {
            delete: vi.fn(() => new DeleteQuery([])),
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }),
      }),
    }));

    const { cacheIndexingVersion, getCachedAnswer, setCachedAnswer } = await import("../src/lib/rag/rag-cache");
    const args = {
      query: "synthetic deferred classification",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };
    const requestStartStamp = await cacheIndexingVersion(args, { forceRefresh: true });
    await setCachedAnswer(args, sampleAnswer("epoch-one answer"), {
      indexingVersionAtRetrievalStart: requestStartStamp,
    });
    const callsBeforeLookup = rpc.mock.calls.length;

    // Models classification/alias work yielding while an activation commits epoch 2.
    lifecycleEpoch = "2";
    await expect(
      getCachedAnswer(args, Date.now(), { indexingVersionAtRequestStart: requestStartStamp }),
    ).resolves.toBeNull();
    expect(rpc.mock.calls.length).toBeGreaterThan(callsBeforeLookup);
  });

  it("bypasses every cache surface when the public-source lifecycle epoch cannot be read", async () => {
    vi.resetModules();
    const from = vi.fn(() => {
      throw new Error("cache tables must not be touched without lifecycle authority");
    });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: vi.fn(async () => ({ data: null, error: { message: "synthetic epoch unavailable" } })),
        from,
      }),
    }));

    const { cacheIndexingVersion } = await import("../src/lib/rag/rag-cache");
    await expect(
      cacheIndexingVersion({ ownerId, accessScope: { ownerId, includePublic: true } }, { forceRefresh: true }),
    ).resolves.toMatch(/public-authority-unavailable/);
    expect(from).not.toHaveBeenCalled();
  });

  it("clears anonymous shared cache rows with owner_id is null instead of writing the anonymous sentinel to UUID filters", async () => {
    vi.resetModules();
    const calls: FilterCall[][] = [];

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: vi.fn((table: string) => ({
          delete: vi.fn(() => {
            expect(table).toBe("rag_response_cache");
            const queryCalls: FilterCall[] = [];
            calls.push(queryCalls);
            return new DeleteQuery(queryCalls);
          }),
        })),
      }),
    }));

    const { invalidateRagCachesForDocumentMutation } = await import("../src/lib/rag/rag");

    invalidateRagCachesForDocumentMutation(ownerId);

    await vi.waitFor(() => expect(calls.length).toBe(2), { timeout: 10000 });

    expect(calls[0]).toContainEqual({ method: "eq", column: "owner_id", value: ownerId });
    expect(calls.flat()).not.toContainEqual({ method: "eq", column: "owner_id", value: "anonymous" });
    expect(calls[1]).toContainEqual({ method: "is", column: "owner_id", value: null });
    expect(calls[1]).toContainEqual({ method: "in", column: "cache_kind", value: ["search", "answer"] });

    calls.length = 0;
    invalidateRagCachesForDocumentMutation(ownerId, { affectsPublicCorpus: false });
    await vi.waitFor(() => expect(calls.length).toBe(1), { timeout: 10000 });
    expect(calls[0]).toContainEqual({ method: "eq", column: "owner_id", value: ownerId });

    calls.length = 0;
    invalidateRagCachesForDocumentMutation(ownerId, { affectsPublicCorpus: true });
    await vi.waitFor(() => expect(calls.length).toBe(2), { timeout: 10000 });
    expect(calls[1]).toContainEqual({ method: "is", column: "owner_id", value: null });
  });

  it("discards a deferred setCachedAnswer that resumes after invalidateRagCachesForOwner", async () => {
    vi.resetModules();

    let releaseIndexingVersion: (() => void) | undefined;
    const indexingVersionGate = new Promise<void>((resolve) => {
      releaseIndexingVersion = resolve;
    });
    const indexingStamp = "rag-deep-memory-v1:doc-1:2026-07-01T00:00:00.000Z::public:1";

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: vi.fn(async () => ({ data: "1", error: null })),
        from: vi.fn((table: string) => {
          if (table === "documents") {
            const builder = {
              select: vi.fn(() => builder),
              eq: vi.fn(() => builder),
              is: vi.fn(() => builder),
              or: vi.fn(() => builder),
              in: vi.fn(() => builder),
              order: vi.fn(() => builder),
              limit: vi.fn(() => builder),
              abortSignal: vi.fn(() => builder),
              then: (onfulfilled?: (value: { data: unknown; error: null }) => unknown) =>
                indexingVersionGate
                  .then(() =>
                    Promise.resolve({
                      data: [{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }],
                      error: null,
                    }),
                  )
                  .then(onfulfilled),
            };
            return builder;
          }

          const deleteCalls: FilterCall[] = [];
          return {
            delete: vi.fn(() => new DeleteQuery(deleteCalls)),
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }),
      }),
    }));

    const { getCachedAnswer, invalidateRagCachesForOwner, setCachedAnswer } = await import("../src/lib/rag/rag-cache");

    const args = {
      query: "clozapine monitoring",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };
    const promotion = setCachedAnswer(args, sampleAnswer("pre-review answer"), {
      indexingVersionAtRetrievalStart: indexingStamp,
    });

    // Simulate a table-fact / review mutation while the deferred promotion awaits
    // its forced indexing-version read. Review metadata does not change that stamp.
    invalidateRagCachesForOwner(ownerId);
    releaseIndexingVersion?.();
    await promotion;

    const cached = await getCachedAnswer(args, Date.now(), {
      indexingVersionAtRequestStart: indexingStamp,
    });
    expect(cached).toBeNull();
  });

  it("does not let one owner's invalidation discard another owner's deferred setCachedAnswer", async () => {
    vi.resetModules();

    const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let releaseIndexingVersion: (() => void) | undefined;
    const indexingVersionGate = new Promise<void>((resolve) => {
      releaseIndexingVersion = resolve;
    });
    const indexingStamp = "rag-deep-memory-v1:doc-1:2026-07-01T00:00:00.000Z::public:1";

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        rpc: vi.fn(async () => ({ data: "1", error: null })),
        from: vi.fn((table: string) => {
          if (table === "documents") {
            const builder = {
              select: vi.fn(() => builder),
              eq: vi.fn(() => builder),
              is: vi.fn(() => builder),
              or: vi.fn(() => builder),
              in: vi.fn(() => builder),
              order: vi.fn(() => builder),
              limit: vi.fn(() => builder),
              abortSignal: vi.fn(() => builder),
              then: (onfulfilled?: (value: { data: unknown; error: null }) => unknown) =>
                indexingVersionGate
                  .then(() =>
                    Promise.resolve({
                      data: [{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }],
                      error: null,
                    }),
                  )
                  .then(onfulfilled),
            };
            return builder;
          }

          const deleteCalls: FilterCall[] = [];
          return {
            delete: vi.fn(() => new DeleteQuery(deleteCalls)),
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }),
      }),
    }));

    const { getCachedAnswer, invalidateRagCachesForOwner, setCachedAnswer } = await import("../src/lib/rag/rag-cache");

    const argsB = {
      query: "clozapine monitoring",
      ownerId: ownerB,
      accessScope: { ownerId: ownerB, includePublic: true as const },
    };
    const promotionB = setCachedAnswer(argsB, sampleAnswer("owner-b answer"), {
      indexingVersionAtRetrievalStart: indexingStamp,
    });

    invalidateRagCachesForOwner(ownerA);
    releaseIndexingVersion?.();
    await promotionB;

    const cachedB = await getCachedAnswer(argsB, Date.now(), {
      indexingVersionAtRequestStart: indexingStamp,
    });
    expect(cachedB?.answer).toBe("owner-b answer");
  });
});
