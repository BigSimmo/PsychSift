import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchTelemetry } from "../src/lib/rag/rag-contracts";
import type { RagAnswer, SearchResult } from "../src/lib/types";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const args = { query: "monitoring pathway", documentId, ownerId, accessScope: { ownerId, includePublic: true } };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function source(): SearchResult {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    document_id: documentId,
    title: "Synthetic guideline",
    file_name: "synthetic.txt",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "Use the current monitoring pathway.",
    image_ids: [],
    images: [],
    similarity: 0.9,
    source_metadata: {
      source_title: "Synthetic guideline",
      publisher: "WA Health",
      publisher_code: "WA_HEALTH",
      jurisdiction: "Australia/WA",
      version: null,
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: "2026-10-15T00:00:00.000Z",
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
  };
}

function answer(): RagAnswer {
  const evidence = source();
  return {
    answer: evidence.content,
    grounded: true,
    confidence: "high",
    sources: [evidence],
    citations: [
      {
        chunk_id: evidence.id,
        document_id: documentId,
        title: evidence.title,
        file_name: evidence.file_name,
        page_number: 1,
        chunk_index: 0,
      },
    ],
  };
}

const telemetry = {
  search_cache_hit: false,
  query_class: "document_lookup",
  text_fast_path_latency_ms: 0,
  embedding_skipped: true,
  embedding_latency_ms: 0,
  embedding_cache_hit: false,
  supabase_rpc_latency_ms: 0,
  rerank_latency_ms: 0,
} as SearchTelemetry;

/** Synthetic DB with actual matching cache-row filters, never a provider connection. */
function installStorage() {
  const document = {
    id: documentId,
    owner_id: ownerId as string | null,
    status: "indexed",
    updated_at: "2026-10-16T00:00:00.000Z",
    metadata: {
      indexed_at: "2026-10-15T00:00:00.000Z",
      index_generation_id: "generation-1",
      document_status: "current",
      clinical_validation_status: "approved",
    },
  };
  const state = {
    documents: [document],
    rows: [] as Array<Record<string, unknown>>,
    failDelete: false,
    failRevision: false,
    malformedRevision: false,
    failedDeletes: 0,
    inserts: 0,
    sharedReads: 0,
    pendingInserts: 0,
    emptyRetrieval: false,
    sharedReadGate: undefined as Promise<void> | undefined,
    sharedInsertGate: undefined as Promise<void> | undefined,
    revisionReadGate: undefined as Promise<void> | undefined,
  };
  function scopeDocuments(params: Record<string, unknown>) {
    const ids = params.p_document_ids as string[] | null;
    return state.documents.filter(
      (row) =>
        ((row.owner_id === params.p_owner_id && params.p_owner_id !== null) ||
          (row.owner_id === null && params.p_include_public === true)) &&
        (!ids?.length || ids.includes(row.id)),
    );
  }
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === "record_source_review" || name === "record_source_review_v2") {
      document.metadata.document_status = "outdated";

      document.updated_at = "2026-10-17T00:00:00.000Z";
      return { data: { id: "review-1" }, error: null };
    }
    if (name !== "rag_cache_scope_revision_v1") {
      if (state.emptyRetrieval) return { data: [], error: null };
      throw new Error(`Unexpected offline RPC: ${name}`);
    }
    const rows = scopeDocuments(params).sort((left, right) => left.id.localeCompare(right.id));
    const revision = `rag-cache-scope-v1:${createHash("md5").update(JSON.stringify(rows)).digest("hex")}`;
    await state.revisionReadGate;
    return state.failRevision
      ? { data: null, error: { code: "PGRST202", message: "RPC unavailable" } }
      : { data: state.malformedRevision ? "legacy-unversioned-stamp" : revision, error: null };
  });
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    let operation = "select";
    let inserted: Record<string, unknown> | undefined;
    let maxRows = 1;
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "or", "order", "abortSignal"]) builder[name] = () => builder;
    for (const name of ["eq", "is", "in", "gt"])
      builder[name] = (key: string, value: unknown) => {
        filters[key] = value;
        return builder;
      };
    builder.limit = (limit: number) => {
      maxRows = limit;
      return builder;
    };
    builder.delete = () => {
      operation = "delete";
      return builder;
    };
    builder.insert = (row: Record<string, unknown>) => {
      operation = "insert";
      inserted = structuredClone(row);
      return builder;
    };
    function matches(row: Record<string, unknown>) {
      return Object.entries(filters).every(([key, value]) =>
        key === "expires_at"
          ? String(row[key]) > String(value)
          : Array.isArray(value)
            ? value.includes(row[key])
            : row[key] === value,
      );
    }
    async function result(single: boolean) {
      if (table === "documents") {
        const docs = state.documents
          .filter(matches)
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
        return { data: structuredClone(single ? (docs[0] ?? null) : docs.slice(0, maxRows)), error: null };
      }
      if (table !== "rag_response_cache") {
        if (state.emptyRetrieval) return { data: single ? null : [], error: null };
        throw new Error(`Unexpected offline table: ${table}`);
      }
      if (operation === "delete") {
        if (state.failDelete) {
          state.failedDeletes++;
          return { data: null, error: { code: "57014", message: "synthetic delete timeout" } };
        }
        state.rows = state.rows.filter((row) => !matches(row));
      } else if (operation === "insert") {
        state.pendingInserts++;
        await state.sharedInsertGate;
        state.rows.push(inserted!);
        state.inserts++;
      } else {
        const row = state.rows.find(matches);
        const data = row ? { payload: structuredClone(row.payload) } : null;
        state.sharedReads++;
        await state.sharedReadGate;
        return { data, error: null };
      }
      return { data: null, error: null };
    }
    builder.maybeSingle = () => result(true);
    builder.then = (fulfilled?: (result: unknown) => unknown, rejected?: (reason: unknown) => unknown) =>
      result(false).then(fulfilled, rejected);
    return builder;
  });
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
  return { document, state, rpc, from };
}

afterEach(() => {
  vi.doUnmock("@/lib/env");
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/supabase/auth");
  vi.doUnmock("@/lib/api-rate-limit");
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setup() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  for (const key of ["RAG_ANSWER_CACHE_TTL_MS", "RAG_SEARCH_CACHE_TTL_MS"]) vi.stubEnv(key, "60000");
  for (const key of ["RAG_ANSWER_CACHE_SIZE", "RAG_SEARCH_CACHE_SIZE"]) vi.stubEnv(key, "100");
  vi.doMock("@/lib/env", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/env")>()),
    isDemoMode: () => false,
  }));
  const storage = installStorage();
  const cache = await import("../src/lib/rag/rag-cache");
  return { ...storage, cache };
}

async function seedBoth(
  cache: Awaited<ReturnType<typeof setup>>["cache"],
  state: Awaited<ReturnType<typeof setup>>["state"],
) {
  await cache.setCachedAnswer(args, answer());
  await cache.setCachedSearch(args, [source()], telemetry);
  await vi.waitFor(() => expect(state.rows).toHaveLength(2));
}

describe("durable source-governance cache fence (F13)", () => {
  it.each(["rejected", "decommissioned"])(
    "rejects retained local and shared answer/search entries after %s review",
    async (decision) => {
      const { cache, state, document } = await setup();
      await seedBoth(cache, state);
      const start = await cache.cacheIndexingVersion(args, { forceRefresh: true });
      expect(await cache.getCachedAnswer(args, Date.now())).not.toBeNull();
      expect(await cache.getCachedSearch(args, telemetry.query_class)).not.toBeNull();
      // A different replica records the review: no process-local invalidation here.
      document.updated_at = "2026-10-17T00:00:00.000Z";
      document.metadata.document_status = "outdated";
      document.metadata = { ...document.metadata, governance_disposition: decision } as typeof document.metadata;
      expect(await cache.getCachedAnswer(args, Date.now(), { indexingVersionAtRequestStart: start })).toBeNull();
      expect(
        await cache.getCachedSearch(args, telemetry.query_class, [], { indexingVersionAtRequestStart: start }),
      ).toBeNull();
      expect(await cache.getSharedCachedAnswer(args, Date.now(), { indexingVersionAtRequestStart: start })).toBeNull();
      expect(
        await cache.getSharedCachedSearch(args, telemetry.query_class, [], { indexingVersionAtRequestStart: start }),
      ).toMatchObject({ kind: "miss" });
    },
  );

  it("keeps ordinary current-source hits and keeps the fresh-metadata refusal control", async () => {
    const { cache, state } = await setup();
    await seedBoth(cache, state);
    expect((await cache.getCachedAnswer(args, Date.now()))?.routingReason).toContain("answer_cache_hit");
    expect(await cache.getCachedSearch(args, telemetry.query_class)).not.toBeNull();
    expect((await cache.getSharedCachedAnswer(args, Date.now()))?.routingReason).toContain("shared_answer_cache_hit");
    expect(await cache.getSharedCachedSearch(args, telemetry.query_class)).toMatchObject({ kind: "hit" });
    const { buildGovernedAnswerClientResponse } = await import("../src/lib/answer-response");
    expect(buildGovernedAnswerClientResponse(answer()).refused).toBe(false);
    const revoked = answer();
    revoked.sources[0].source_metadata!.document_status = "outdated";
    expect(buildGovernedAnswerClientResponse(revoked).refused).toBe(true);
  });

  it("composes the actual review route and invalidator safely when shared deletion returns an error", async () => {
    const { cache, state, rpc } = await setup();
    await seedBoth(cache, state);
    vi.doMock("@/lib/supabase/auth", () => ({
      AuthenticationError: class AuthenticationError extends Error {},
      requireAuthenticatedUser: async () => ({ id: ownerId }),
      unauthorizedResponse: vi.fn(),
    }));
    vi.doMock("@/lib/api-rate-limit", () => ({
      consumeApiRateLimit: async () => ({ limited: false }),
      rateLimitJsonResponse: vi.fn(),
    }));
    state.failDelete = true;
    const { POST } = await import("../src/app/api/documents/[id]/reviews/route");
    const response = await POST(
      new Request(`http://localhost/api/documents/${documentId}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "decommissioned", reason: "Synthetic governance review" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );
    expect(response.status, JSON.stringify(await response.json())).toBe(201);
    expect(rpc).toHaveBeenCalledWith("record_source_review", expect.objectContaining({ p_decision: "decommissioned" }));
    await vi.waitFor(() => expect(state.failedDeletes).toBeGreaterThan(0));
    expect(state.rows).toHaveLength(2);
    expect(await cache.getSharedCachedAnswer(args, Date.now())).toBeNull();
    expect(await cache.getSharedCachedSearch(args, telemetry.query_class)).toMatchObject({ kind: "miss" });
  });

  it("detects governance changes to a non-latest scoped document and ignores another owner's document", async () => {
    const { cache, state, document } = await setup();
    const other = structuredClone(document);
    other.id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    other.updated_at = "2026-10-18T00:00:00.000Z";
    state.documents.push(other);
    const globalArgs = { ...args, documentId: undefined };
    const before = await cache.cacheIndexingVersion(globalArgs, { forceRefresh: true });
    document.metadata.document_status = "outdated";
    expect(await cache.cacheIndexingVersion(globalArgs, { forceRefresh: true })).not.toBe(before);
    const after = await cache.cacheIndexingVersion(globalArgs, { forceRefresh: true });
    state.documents.push({ ...structuredClone(other), id: "foreign-document", owner_id: "foreign-owner" });
    expect(await cache.cacheIndexingVersion(globalArgs, { forceRefresh: true })).toBe(after);
  });

  it.each(["answer", "search"])("rechecks revision after an in-flight shared %s read", async (kind) => {
    const { cache, state, document } = await setup();
    await seedBoth(cache, state);
    const gate = deferred();
    state.sharedReadGate = gate.promise;
    const read =
      kind === "answer"
        ? cache.getSharedCachedAnswer(args, Date.now())
        : cache.getSharedCachedSearch(args, telemetry.query_class);
    await vi.waitFor(() => expect(state.sharedReads).toBe(1));
    document.metadata.document_status = "outdated";
    document.updated_at = "2026-10-17T00:00:00.000Z";
    gate.resolve();
    if (kind === "answer") expect(await read).toBeNull();
    else expect(await read).toMatchObject({ kind: "miss" });
  });

  it.each(["answer", "search"])(
    "cannot reuse a late shared %s write from a different replica after review",
    async (kind) => {
      const { cache, state, document } = await setup();
      const start = await cache.cacheIndexingVersion(args, { forceRefresh: true });
      const gate = deferred();
      state.sharedInsertGate = gate.promise;
      if (kind === "answer") await cache.setCachedAnswer(args, answer(), { indexingVersionAtRetrievalStart: start });
      else await cache.setCachedSearch(args, [source()], telemetry, [], { indexingVersionAtRetrievalStart: start });
      await vi.waitFor(() => expect(state.pendingInserts).toBe(1));
      document.metadata.document_status = "outdated";
      document.updated_at = "2026-10-17T00:00:00.000Z";
      gate.resolve();
      await vi.waitFor(() => expect(state.inserts).toBe(1));
      expect(await cache.getSharedCachedAnswer(args, Date.now())).toBeNull();
      expect(await cache.getSharedCachedSearch(args, telemetry.query_class)).toMatchObject({ kind: "miss" });
      expect(await cache.getCachedAnswer(args, Date.now())).toBeNull();
      await cache.setCachedSearch(args, [source()], telemetry, [], { indexingVersionAtRetrievalStart: start });
      expect(await cache.getCachedSearch(args, telemetry.query_class)).toBeNull();
    },
  );

  it.each(["answer", "search"])("fences an in-flight local %s read against same-process invalidation", async (kind) => {
    const { cache, state } = await setup();
    await seedBoth(cache, state);
    const gate = deferred();
    state.revisionReadGate = gate.promise;
    const read =
      kind === "answer" ? cache.getCachedAnswer(args, Date.now()) : cache.getCachedSearch(args, telemetry.query_class);
    // No document mutation: the local epoch must fence mutations outside documents.
    cache.invalidateRagCachesForOwner(ownerId);
    gate.resolve();
    expect(await read).toBeNull();
  });

  it("changes identity when a scoped document leaves the indexed corpus or is removed", async () => {
    const { cache, state, document } = await setup();
    const before = await cache.cacheIndexingVersion(args);
    document.status = "failed";
    const failed = await cache.cacheIndexingVersion(args);
    expect(failed).not.toBe(before);
    state.documents = [];
    const removed = await cache.cacheIndexingVersion(args);
    expect(removed).not.toBe(failed);
    expect(await cache.cacheIndexingVersion(args)).toBe(removed);
  });

  it.each(["before_waiter", "while_waiting", "epoch_invalidation"])(
    "does not deliver an older coalesced answer when review commits %s",
    async (timing) => {
      const { cache, document } = await setup();
      const { withRagProgrammeRollout } = await import("../src/lib/rag/rag-rollout");
      const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
      const request = withRagProgrammeRollout({ ...args, logQuery: false });
      await cache.setCachedAnswer(request, answer());
      const originReady = deferred();
      const gate = deferred();
      let waiterJoined = false;
      let waiterObservedProgress = false;
      const origin = answerQuestionWithScope({
        ...request,
        onProgress: async (progress) => {
          if (progress.stage === "cached" && progress.reason?.includes("answer_cache_hit")) {
            originReady.resolve();
            await gate.promise;
          }
        },
      });
      await originReady.promise;
      const reviewAndSeedCurrentAnswer = async () => {
        if (timing === "epoch_invalidation") cache.invalidateRagCachesForOwner(ownerId);
        else {
          document.metadata.document_status = "outdated";
          document.updated_at = "2026-10-17T00:00:00.000Z";
        }
        await cache.setCachedAnswer(request, {
          answer: "Fresh evidence is required after source review.",
          grounded: false,
          confidence: "unsupported",
          sources: [],
          citations: [],
        });
      };
      if (timing === "before_waiter") await reviewAndSeedCurrentAnswer();
      const waiter = answerQuestionWithScope({
        ...request,
        onProgress: (progress) => {
          waiterObservedProgress = true;
          waiterJoined ||= progress.reason?.includes("answer_inflight_coalesced") === true;
        },
      });
      try {
        await vi.waitFor(() => expect(timing !== "before_waiter" ? waiterJoined : waiterObservedProgress).toBe(true));
        if (timing !== "before_waiter") await reviewAndSeedCurrentAnswer();
      } finally {
        gate.resolve();
      }
      const delivered = await waiter;
      await origin;
      expect(delivered.sources).toEqual([]);
      expect(delivered.answer).not.toBe(answer().answer);
      expect(delivered.routingReason).not.toContain("answer_inflight_coalesced");
    },
  );

  it.each(["missing", "malformed"])("fails cold when the durable revision RPC is %s, then recovers", async (mode) => {
    const { cache, state } = await setup();
    await seedBoth(cache, state);
    state.failRevision = mode === "missing";
    state.malformedRevision = mode === "malformed";
    expect(await cache.getCachedAnswer(args, Date.now())).toBeNull();
    expect(await cache.getCachedSearch(args, telemetry.query_class)).toBeNull();
    expect(await cache.getSharedCachedAnswer(args, Date.now())).toBeNull();
    expect(await cache.getSharedCachedSearch(args, telemetry.query_class)).toMatchObject({ kind: "miss" });
    await cache.setCachedAnswer({ ...args, query: "unavailable answer write" }, answer());
    await cache.setCachedSearch({ ...args, query: "unavailable search write" }, [source()], telemetry);
    expect(state.inserts).toBe(2);
    state.failRevision = false;
    state.malformedRevision = false;
    expect(await cache.getCachedAnswer(args, Date.now())).not.toBeNull();
  });

  it("does not join an existing answer when its durable revision cannot be read", async () => {
    vi.stubEnv("RAG_PROVIDER_MODE", "offline");
    const { cache, state } = await setup();
    const { withRagProgrammeRollout } = await import("../src/lib/rag/rag-rollout");
    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const request = withRagProgrammeRollout({ ...args, logQuery: false });
    await cache.setCachedAnswer(request, answer());
    const originReady = deferred();
    const gate = deferred();
    const origin = answerQuestionWithScope({
      ...request,
      onProgress: async (progress) => {
        if (progress.stage === "cached" && progress.reason?.includes("answer_cache_hit")) {
          originReady.resolve();
          await gate.promise;
        }
      },
    });
    await originReady.promise;
    state.failRevision = true;
    state.emptyRetrieval = true;
    let waiterStarted = false;
    const waiter = answerQuestionWithScope({
      ...request,
      onProgress: (progress) => {
        waiterStarted ||=
          progress.stage !== "cached" || progress.reason?.includes("answer_inflight_coalesced") === true;
      },
    });
    try {
      await vi.waitFor(() => expect(waiterStarted).toBe(true));
    } finally {
      gate.resolve();
    }
    const delivered = await waiter;
    await origin;
    expect(delivered.sources).toEqual([]);
    expect(delivered.routingReason).not.toContain("answer_inflight_coalesced");
    expect(await cache.answerInflightCacheKey(request)).toBeNull();
  });
});
