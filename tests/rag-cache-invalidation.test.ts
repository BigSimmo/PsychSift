import { withMockRagScopeRevision, mockRagScopeRevision } from "./rag-cache-test-revision";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchChunksArgs, SearchTelemetry } from "../src/lib/rag/rag-contracts";
import type { RagAnswer, SearchResult } from "../src/lib/types";

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

afterEach(() => {
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/openai");
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function installAnswerCacheEntrypointHarness(
  sharedPayload?:
    Record<string, unknown> | ((filters: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>),
  options: { admittedSource?: SearchResult } = {},
) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const state = { updatedAt: "2026-08-30T00:00:00.000Z" };
  const documentBuilder = {
    select: () => documentBuilder,
    eq: () => documentBuilder,
    is: () => documentBuilder,
    or: () => documentBuilder,
    in: () => documentBuilder,
    order: () => documentBuilder,
    limit: () => documentBuilder,
    abortSignal: () => documentBuilder,
    then: (
      resolve: (value: { data: Array<{ id: string; updated_at: string; metadata: object }>; error: null }) => unknown,
    ) =>
      Promise.resolve({
        data: [{ id: "doc-1", updated_at: state.updatedAt, metadata: {} }],
        error: null,
      }).then(resolve),
  };
  const makeResponseBuilder = () => {
    const filters: Record<string, unknown> = {};
    const responseBuilder = {
      select: () => responseBuilder,
      delete: () => responseBuilder,
      insert: (value: Record<string, unknown>) => {
        insertedRows.push(value);
        return responseBuilder;
      },
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return responseBuilder;
      },
      is: (key: string, value: unknown) => {
        filters[key] = value;
        return responseBuilder;
      },
      in: () => responseBuilder,
      gt: () => responseBuilder,
      order: () => responseBuilder,
      limit: () => responseBuilder,
      abortSignal: () => responseBuilder,
      maybeSingle: async () => {
        const payload = typeof sharedPayload === "function" ? await sharedPayload(filters) : sharedPayload;
        return { data: payload ? { payload } : null, error: null };
      },
      then: (resolve: (value: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return responseBuilder;
  };
  const admissionBuilder = {
    select: () => admissionBuilder,
    in: async () => ({
      data: options.admittedSource
        ? [
            {
              id: options.admittedSource.id,
              document_id: options.admittedSource.document_id,
              index_generation_id: "generation-v1",
              documents: {
                owner_id: null,
                status: "indexed",
                index_generation_id: "generation-v1",
                metadata: {
                  corpus_scope: "australian_public",
                  publication_manifest_version: 2,
                  source_policy_version: "source-policy-v1",
                  publication_source_policy_version: "source-policy-v1",
                  publication_reviewed_index_generation_id: "generation-v1",
                },
              },
            },
          ]
        : [],
      error: null,
    }),
  };
  const from = vi.fn((table: string) =>
    table === "documents"
      ? documentBuilder
      : table === "document_chunks" && options.admittedSource
        ? admissionBuilder
        : makeResponseBuilder(),
  );
  const rpc = vi.fn(async (name: string) => ({
    data: name.endsWith("_v3") && options.admittedSource ? [options.admittedSource] : [],
    error: null,
  }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => withMockRagScopeRevision({ from, rpc }) }));
  return { from, rpc, insertedRows, state };
}

async function admittedShadowCacheHarness() {
  vi.stubEnv("RAG_GOVERNED_RETRIEVAL_ENABLED", "true");
  vi.stubEnv("RAG_PROGRAMME_MODE", "legacy");
  vi.stubEnv("RAG_PROGRAMME_CANARY_BASIS_POINTS", "0");
  vi.stubEnv("RAG_SITE_CONTENT_ENABLED", "false");
  vi.stubEnv("RAG_AUSTRALIAN_AUGMENTATION_ENABLED", "false");
  vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "60000");
  vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "100");
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "60000");
  vi.stubEnv("RAG_SEARCH_CACHE_SIZE", "100");
  const source: SearchResult = {
    id: "control-chunk",
    document_id: "control-document",
    title: "Australian clozapine guidance",
    file_name: "clozapine.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Definition",
    content: "Clozapine is an antipsychotic medication.",
    image_ids: [],
    images: [],
    similarity: 0.97,
    text_rank: 1.1,
    hybrid_score: 0.97,
    corpus_scope: "australian_public",
    site_content_domain: null,
    source_metadata: {
      source_title: "Australian clozapine guidance",
      publisher: "Office of the Chief Psychiatrist WA",
      publisher_code: "OCPWA",
      jurisdiction: "Australia/WA",
      version: "1",
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
      corpus_scope: "australian_public",
      source_kind: "document",
      source_role: "clinical_guideline",
      content_mode: "indexed_content",
      source_policy_version: "australian-source-policy-v1",
      source_catalogue_key: "wa-chief-psychiatrist",
      licence_policy: "public_index_permitted",
    },
  };
  let rows: Array<Record<string, unknown>> = [];
  const reads: Array<Record<string, unknown>> = [];
  let readGate: Promise<void> | undefined;
  const storage = installAnswerCacheEntrypointHarness(
    async (filters) => {
      reads.push(filters);
      if (readGate) await readGate;
      return rows.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value))?.payload as
        Record<string, unknown> | undefined;
    },
    { admittedSource: source },
  );
  rows = storage.insertedRows;
  const provider = vi.fn(async () => {
    throw new Error("Unexpected cache-hit provider invocation");
  });
  vi.doMock("@/lib/openai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/openai")>()),
    generateStructuredTextResult: provider,
    generateParsedTextResult: provider,
    embedTextWithTelemetry: provider,
  }));
  const { env } = await import("../src/lib/env");
  const rollout = await import("../src/lib/rag/rag-rollout");
  const cache = await import("../src/lib/rag/rag-cache");
  const { withRagRequestContext } = await import("../src/lib/rag/rag-context-snapshot");
  const input = {
    query: "What is clozapine?",
    ownerId,
    accessScope: { includePublic: true },
    allowGlobalSearch: true,
    ragContextSnapshotInput: {
      expectedSiteStaticManifestDigest: "a".repeat(64),
      activePublicSiteRelease: {
        version: "clinical-kb-site-release-v1",
        releaseId: "11111111-1111-5111-8111-111111111111",
        registryVersion: "site-content-registry-v1",
        staticManifestDigest: "a".repeat(64),
        dynamicStateDigest: "b".repeat(64),
        releaseDigest: "c".repeat(64),
        state: "active",
        activatedAt: "2026-08-29T00:00:00.000Z",
      },
      publicSiteChangeEpoch: "1",
      pendingPublicSiteChangeCount: 0,
      documentIndexGeneration: "generation-v1",
      sourcePolicyVersion: "source-policy-v1",
      rolloutVersion: "rollout-v1",
    },
  } satisfies SearchChunksArgs;
  const request = withRagRequestContext(input);
  const { searchGovernedCorpora } = await import("../src/lib/rag/rag-candidate-sources");
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admitted = await searchGovernedCorpora({
    supabase: createAdminClient(),
    queryVariants: [request.query],
    retrievalMode: "text",
    matchCount: 8,
    snapshot: request.ragRequestContext.snapshot,
    components: { siteContent: false, australianAugmentation: true, australianCurrent: true },
    targetSiteDomains: [],
  });
  const { contextPackAdmissionMatches } = await import("../src/lib/rag/rag-context-admission");
  expect(admitted).toHaveLength(1);
  expect(contextPackAdmissionMatches(admitted[0], { includePublic: true }, request.ragRequestContext.snapshot)).toBe(
    true,
  );
  const { citationFromResult } = await import("../src/lib/citations");
  const { assessAndEnforceClaimSupport } = await import("../src/lib/rag/rag-claim-support");
  const answer = assessAndEnforceClaimSupport({
    answer: source.content,
    grounded: true,
    confidence: "high",
    citations: admitted.map((row) => citationFromResult(row, "model_selected")),
    sources: admitted,
    routingMode: "fast",
    routingReason: "supported_control_fixture",
    modelUsed: "mocked-model",
  });
  expect(answer.grounded).toBe(true);
  expect(answer.answer).toBe(source.content);
  const { answerRouteResultCanBeCached } = await import("../src/lib/rag/rag-route-budget");
  expect(answerRouteResultCanBeCached({ deadlineExceeded: false }, answer)).toBe(true);
  const args = (mode: "legacy" | "shadow", overrides: Partial<SearchChunksArgs> = {}) => {
    env.RAG_PROGRAMME_MODE = mode;
    return rollout.withRagProgrammeRollout({ ...request, ...overrides });
  };
  const proof = (kind: "answer" | "search") =>
    cache.createRagPublicCacheWriteProof({
      cacheKind: kind,
      requestContext: request.ragRequestContext,
      accessScope: { includePublic: true },
      selectedEvidence: admitted,
      allSelectedEvidencePublic: true,
      pendingExclusion: "not_required",
    });
  const seed = async (mode: "legacy" | "shadow" = "legacy", overrides: Partial<SearchChunksArgs> = {}) => {
    const target = args(mode, overrides);
    await cache.setCachedAnswer(target, answer, { publicCacheWriteProof: proof("answer") });
    return target;
  };
  const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
  const { toClientAnswerPayload } = await import("../src/lib/answer-client-payload");
  const run = (mode: "legacy" | "shadow", overrides: Partial<SearchChunksArgs> = {}) => {
    env.RAG_PROGRAMME_MODE = mode;
    return answerQuestionWithScope({ ...request, ...overrides, logQuery: false });
  };
  return {
    storage,
    rows,
    reads,
    provider,
    env,
    cache,
    rollout,
    request,
    admitted,
    answer,
    args,
    proof,
    seed,
    run,
    toClientAnswerPayload,
    setReadGate: (gate: Promise<void> | undefined) => {
      readGate = gate;
    },
  };
}

describe("RAG cache invalidation", () => {
  it("bumps dependency version past v24 so #ZK460W evicts unsafe shared review-fallback rows", async () => {
    vi.resetModules();
    const { ragCacheDependencyVersion } = await import("../src/lib/rag/rag-cache");
    // Main still writes the unsafe grounded/non-review_only shape under v24; extractive
    // review fallback lacks generation_fallback:, so getSharedCachedAnswer will not evict.
    // v26 retains v25's intentional invalidation and adds governance freshness. Staying on v24 would reintroduce the blocker.
    expect(ragCacheDependencyVersion).toBe("rag-cache-v26");
    expect(ragCacheDependencyVersion).not.toBe("rag-cache-v24");
  });

  it.each(["local", "shared"] as const)(
    "P09 shadow serves admitted warm %s legacy answers without re-originating",
    async (layer) => {
      const h = await admittedShadowCacheHarness();
      await h.seed();
      await vi.waitFor(() => expect(h.rows).toHaveLength(1));
      expect(await h.cache.getCachedAnswer(h.args("legacy"), Date.now())).not.toBeNull();
      if (layer === "shared") h.env.RAG_ANSWER_CACHE_SIZE = 0;
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T12:00:00Z"));
      h.storage.rpc.mockClear();
      h.provider.mockClear();
      const legacy = await h.run("legacy");
      const shadow = await h.run("shadow");
      expect(legacy.answer).toBe(h.answer.answer);
      expect(legacy.grounded).toBe(true);
      expect(legacy.routingReason).toContain(layer === "local" ? "answer_cache_hit" : "shared_answer_cache_hit");
      expect(JSON.stringify(h.toClientAnswerPayload(shadow))).toBe(JSON.stringify(h.toClientAnswerPayload(legacy)));
      expect(h.storage.rpc).not.toHaveBeenCalled();
      expect(h.provider).not.toHaveBeenCalled();
    },
  );
  it("P09 issued shadow retains admitted control coalescing with distinct request identities", async () => {
    const h = await admittedShadowCacheHarness();
    await h.seed();
    await vi.waitFor(() => expect(h.rows).toHaveLength(1));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.setReadGate(gate);
    // Force a shared-cache wait while leaving coalescing eligible.
    await h.seed("legacy", { query: "What is clozapine used for?" });
    h.env.RAG_ANSWER_CACHE_SIZE = 1;
    await h.seed("legacy", { query: "Describe clozapine medication" });
    h.reads.length = 0;
    const one = h.run("shadow");
    const same = h.run("shadow");
    const other = h.run("shadow", { query: "What is clozapine used for?" });
    try {
      await vi.waitFor(() => expect(h.cache.answerInflight.size).toBe(2));
      await vi.waitFor(() => expect(h.reads).toHaveLength(2));
    } finally {
      release();
      h.setReadGate(undefined);
      await Promise.allSettled([one, same, other]);
    }
    const [a, b, c] = await Promise.all([one, same, other]);
    expect(a.answer).toBe(h.answer.answer);
    expect(b.answer).toBe(a.answer);
    expect(b.routingReason).toContain("answer_inflight_coalesced");
    expect(c.routingReason).not.toContain("answer_inflight_coalesced");
    expect(h.cache.answerInflight.size).toBe(0);
    expect(h.provider).not.toHaveBeenCalled();
  });
  it("P09 otherwise-eligible served shadow control populates legacy answer and search rows", async () => {
    const h = await admittedShadowCacheHarness();
    const shadow = await h.seed("shadow");
    await vi.waitFor(() => expect(h.rows).toHaveLength(1));
    expect((await h.run("legacy")).answer).toBe(h.answer.answer);
    const telemetry: SearchTelemetry = {
      search_cache_hit: false,
      text_fast_path_latency_ms: 0,
      embedding_skipped: true,
      embedding_latency_ms: 0,
      embedding_cache_hit: false,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
      shadow_retrieval_state: "completed",
      candidate_match_counts: { matched: 1, partial_match: 0, absent: 0 },
      candidate_retrieval_query_variant_count: 3,
      // Per-request measurement from the populating run must never be replayed on a hit.
      retrieval_stage_timeline_ms: [{ stage: "text_candidates", started_offset_ms: 0, finished_offset_ms: 9_000 }],
      text_rpc_variant_timings: [
        {
          rpc: "match_document_chunks_text",
          variant_index: 0,
          role: "primary",
          ran: true,
          started_offset_ms: 0,
          finished_offset_ms: 9_000,
          rpc_ms: 9_000,
          row_count: 30,
        },
      ],
    };
    await h.cache.setCachedSearch(shadow, h.admitted, telemetry, [], { publicCacheWriteProof: h.proof("search") });
    await vi.waitFor(() => expect(h.rows).toHaveLength(2));
    const hit = await h.cache.getCachedSearch(h.args("legacy"));
    expect(hit?.results.map((row) => row.id)).toEqual(h.admitted.map((row) => row.id));
    expect(hit?.telemetry.text_rpc_variant_timings).toBeUndefined();
    expect(hit?.telemetry.retrieval_stage_timeline_ms).toBeUndefined();
    expect(JSON.stringify(h.rows)).not.toContain("text_rpc_variant_timings");
    expect(JSON.stringify(h.rows)).not.toContain("retrieval_stage_timeline_ms");
    expect(JSON.stringify(h.rows)).not.toContain("candidate_match_counts");
    expect(JSON.stringify(h.rows)).not.toContain("shadow_retrieval_state");
    expect(JSON.stringify(h.rows)).not.toContain("candidate_retrieval_query_variant_count");
  });

  it("P09 shadow control authentication rejects transplanted decisions and preserves access/snapshot identities", async () => {
    const h = await admittedShadowCacheHarness();
    await h.seed();
    await vi.waitFor(() => expect(h.rows).toHaveLength(1));
    const shadow = h.args("shadow");
    expect(h.rollout.isIssuedRagShadowControl(shadow)).toBe(true);
    const changedSnapshot = h.rollout.withRagProgrammeRollout({
      ...h.request,
      ragRequestContext: undefined,
      ragContextSnapshotInput: { ...h.request.ragContextSnapshotInput, documentIndexGeneration: "generation-v2" },
    });
    const changedOwner = h.args("shadow", { ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(h.cache.scopedAnswerCacheKey(changedSnapshot)).not.toBe(h.cache.scopedAnswerCacheKey(shadow));
    expect(h.cache.scopedAnswerCacheKey(changedOwner)).not.toBe(h.cache.scopedAnswerCacheKey(shadow));
    for (const request of [
      changedSnapshot,
      changedOwner,
      h.args("shadow", { accessScope: { ownerId, includePublic: true } }),
    ]) {
      expect(await h.cache.getCachedAnswer(request, Date.now())).toBeNull();
      expect(await h.cache.getSharedCachedAnswer(request, Date.now())).toBeNull();
    }
    for (const request of [
      { ...shadow, ragProgrammeRollout: { ...shadow.ragProgrammeRollout } },
      { ...shadow, ragProgrammeRollout: undefined },
      { ...shadow, query: "transplanted query" },
      { ...shadow, ragRequestContext: changedSnapshot.ragRequestContext },
      {
        ...shadow,
        governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
      },
      { ...shadow, ragProgrammeRollout: { ...shadow.ragProgrammeRollout, servedMode: "candidate" as const } },
    ]) {
      expect(h.rollout.isIssuedRagShadowControl(request)).toBe(false);
      expect(h.cache.answerCoalescingAllowedForRequest(request)).toBe(false);
      expect(h.cache.answerCacheLookupAllowedForRequest(request, false)).toBe(false);
      expect(await h.cache.getCachedAnswer(request, Date.now())).toBeNull();
      expect(await h.cache.getSharedCachedAnswer(request, Date.now())).toBeNull();
      await h.cache.setCachedAnswer(
        request,
        { ...h.answer, answer: "candidate poison" },
        { publicCacheWriteProof: h.proof("answer") },
      );
    }
    expect(h.rows).toHaveLength(1);
    expect((await h.run("shadow")).answer).toBe(h.answer.answer);
  });

  it.each(["legacy", "shadow"] as const)("P09 %s rejects stale warm answers at the exported boundary", async (mode) => {
    const h = await admittedShadowCacheHarness();
    await h.seed();
    await vi.waitFor(() => expect(h.rows).toHaveLength(1));
    h.storage.state.updatedAt = "2026-09-01T00:00:00.000Z";
    await h.cache.cacheIndexingVersion(h.args(mode), { forceRefresh: true });
    const answer = await h.run(mode);
    expect(answer.routingReason).not.toContain("answer_cache_hit");
    expect(answer.answer).not.toBe(h.answer.answer);
    expect(h.rows).toHaveLength(1);
  });

  it("P09 shadow retains missing/mismatched proof, unauthorized, skip and abort write rejection", async () => {
    const h = await admittedShadowCacheHarness();
    const shadow = h.args("shadow");
    await h.cache.setCachedAnswer(shadow, h.answer);
    await h.cache.setCachedAnswer(
      shadow,
      { ...h.answer, sources: [{ ...h.admitted[0], id: "unadmitted-candidate" }] },
      { publicCacheWriteProof: h.proof("answer") },
    );
    const changedSnapshot = h.rollout.withRagProgrammeRollout({
      ...h.request,
      ragRequestContext: undefined,
      ragContextSnapshotInput: { ...h.request.ragContextSnapshotInput, documentIndexGeneration: "generation-v2" },
    });
    await h.cache.setCachedAnswer(changedSnapshot, h.answer, { publicCacheWriteProof: h.proof("answer") });
    await h.cache.setCachedAnswer(h.args("shadow", { accessScope: { ownerId, includePublic: true } }), h.answer, {
      publicCacheWriteProof: h.proof("answer"),
    });
    await h.cache.setCachedAnswer({ ...shadow, skipCache: true }, h.answer, {
      publicCacheWriteProof: h.proof("answer"),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      h.cache.setCachedAnswer({ ...shadow, signal: controller.signal }, h.answer, {
        publicCacheWriteProof: h.proof("answer"),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(h.rows).toHaveLength(0);
    expect(await h.cache.getCachedAnswer(shadow, Date.now())).toBeNull();
  });

  it("P09 candidate local/shared search writes keep snapshot proof separate from rollout identity and remain owner-invalidatable", async () => {
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "60000");
    vi.stubEnv("RAG_SEARCH_CACHE_SIZE", "100");
    const harness = installAnswerCacheEntrypointHarness();
    const { withRagRequestContext } = await import("../src/lib/rag/rag-context-snapshot");
    const { decideRagProgrammeRollout } = await import("../src/lib/rag/rag-rollout");
    const cache = await import("../src/lib/rag/rag-cache");
    const args = withRagRequestContext({
      query: "What is clozapine?",
      ownerId,
      accessScope: { includePublic: true as const },
      ragContextSnapshotInput: {
        expectedSiteStaticManifestDigest: "a".repeat(64),
        activePublicSiteRelease: {
          version: "clinical-kb-site-release-v1" as const,
          releaseId: "11111111-1111-5111-8111-111111111111",
          registryVersion: "registry-v1",
          staticManifestDigest: "a".repeat(64),
          dynamicStateDigest: "b".repeat(64),
          releaseDigest: "c".repeat(64),
          state: "active" as const,
          activatedAt: "2026-08-29T00:00:00.000Z",
        },
        publicSiteChangeEpoch: "1",
        pendingPublicSiteChangeCount: 0,
        documentIndexGeneration: "test-rag-version:rag-cache-scope-v1:" + "0".repeat(32),
        sourcePolicyVersion: "policy-v1",
        rolloutVersion: "rollout-v1",
      },
    });
    const decision = decideRagProgrammeRollout({
      configuredMode: "canary",
      ownerId,
      serverSalt: "synthetic-salt-012345678901234567890123456789",
      canaryBasisPoints: 10000,
      queryPlanVersion: "v1",
      sourcePolicyVersion: "policy-v1",
      indexGeneration: "test-rag-version:rag-cache-scope-v1:" + "0".repeat(32),
      publicSiteContentReleaseId: args.ragRequestContext.snapshot.publicSiteContent.releaseId,
      publicSiteContentStaticManifestDigest: "a".repeat(64),
      publicSiteContentReleaseDigest: "c".repeat(64),
      publicSiteContentChangeEpoch: "1",
      publicSiteContentState: "current",
      governedRetrievalEnabled: true,
      siteContentEnabled: false,
      australianAugmentationEnabled: false,
      adaptiveAnswerEnabled: false,
      adaptiveRenderEnabled: false,
    });
    const candidate = { ...args, ragProgrammeRollout: decision, ragQueryPlanMode: "canary" as const };
    const proof = cache.createRagPublicCacheWriteProof({
      cacheKind: "search",
      requestContext: args.ragRequestContext,
      accessScope: args.accessScope,
      selectedEvidence: [],
      allSelectedEvidencePublic: true,
      pendingExclusion: "not_required",
    });
    const telemetry = {
      search_cache_hit: false,
      text_fast_path_latency_ms: 0,
      embedding_skipped: true,
      embedding_latency_ms: 0,
      embedding_cache_hit: false,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
    };
    await cache.setCachedSearch(candidate, [], telemetry, [], { publicCacheWriteProof: proof });
    await vi.waitFor(() => expect(harness.insertedRows).toHaveLength(1));
    expect(await cache.getCachedSearch(candidate)).not.toBeNull();
    expect(await cache.getCachedSearch({ ...args, ragQueryPlanMode: "legacy" })).toBeNull();
    expect(JSON.stringify(harness.insertedRows)).not.toContain(ownerId);
    cache.invalidateRagCachesForOwner(ownerId);
    expect(await cache.getCachedSearch(candidate)).toBeNull();
  });
  it("T8-R6 redacts context from real shared-search persistence even with raw retention", async () => {
    vi.stubEnv("RAG_PERSIST_RAW_QUERY_TEXT", "true");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "60000");
    const rows: Array<Record<string, unknown>> = [];
    const harness = installAnswerCacheEntrypointHarness(
      async (filters) =>
        rows.find((row) => row.normalized_query === filters.normalized_query)?.payload as
          Record<string, unknown> | undefined,
    );
    const cache = await import("../src/lib/rag/rag-cache");
    const args = { query: 'Follow-up to "CANARYCONTEXT lithium dosing": what about renal impairment?', ownerId };
    const telemetry = {
      search_cache_hit: false,
      text_fast_path_latency_ms: 0,
      embedding_skipped: true,
      embedding_latency_ms: 0,
      embedding_cache_hit: false,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
    };
    await cache.setCachedSearch(args, [], telemetry);
    await vi.waitFor(() => expect(harness.insertedRows).toHaveLength(1));
    rows.push(...harness.insertedRows);
    expect(JSON.stringify(rows).toLowerCase()).not.toContain("canarycontext");
    expect(await cache.getSharedCachedSearch(args)).toMatchObject({ kind: "hit" });
  });
  it("P08C keeps real concurrent answer entrypoints separate while coalescing identical requests", async () => {
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "60000");
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "100");
    const observedKeys: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installAnswerCacheEntrypointHarness(async (filters) => {
      observedKeys.push(String(filters.normalized_query));
      await gate;
      return { answer: sampleAnswer(String(filters.normalized_query)) };
    });
    const cache = await import("../src/lib/rag/rag-cache");
    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const prefix =
      "lithium clozapine valproate olanzapine quetiapine risperidone aripiprazole haloperidol sertraline fluoxetine paroxetine venlafaxine duloxetine mirtazapine";
    const adult = { query: prefix + " adults", ownerId, logQuery: false };
    const child = { ...adult, query: prefix + " children" };
    const first = answerQuestionWithScope(adult);
    const same = answerQuestionWithScope(adult);
    const distinct = answerQuestionWithScope(child);
    await vi.waitFor(() => expect(observedKeys).toHaveLength(2));
    expect(new Set(observedKeys).size).toBe(2);
    expect(cache.answerInflight.size).toBe(2);
    release();
    const [a, equivalent, b] = await Promise.all([first, same, distinct]);
    expect(equivalent.routingReason).toContain("answer_inflight_coalesced");
    // The support gate may truthfully replace both unsupported fixtures with identical gap prose.
    // Distinct cache lookups and simultaneous originations above prove request isolation.
    expect(b.routingReason).not.toContain("answer_inflight_coalesced");
    expect(equivalent.answer).toBe(a.answer);
    expect(cache.answerInflight.size).toBe(0);
  });

  it("P08C separates cold/warm local and shared cache answers by full context and source policy", async () => {
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "60000");
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "100");
    let rows: Array<Record<string, unknown>> = [];
    const harness = installAnswerCacheEntrypointHarness(
      async (filters) =>
        rows.find(
          (row) =>
            row.normalized_query === filters.normalized_query && row.dependency_version === filters.dependency_version,
        )?.payload as Record<string, unknown> | undefined,
    );
    rows = harness.insertedRows;
    const cache = await import("../src/lib/rag/rag-cache");
    const base = { query: 'Follow-up to "lithium dosing": what about renal impairment?', ownerId };
    const variants = [
      base,
      { ...base, query: base.query.replace("renal", "hepatic") },
      { ...base, answerSourcePolicy: "only_this_source" as const },
    ];
    for (const [index, args] of variants.entries()) {
      expect(await cache.getCachedAnswer(args, Date.now())).toBeNull();
      expect(await cache.getSharedCachedAnswer(args, Date.now())).toBeNull();
      await cache.setCachedAnswer(args, sampleAnswer("variant-" + index));
      await vi.waitFor(() => expect(rows.length).toBe(index + 1));
    }
    for (const [index, args] of variants.entries()) {
      expect((await cache.getCachedAnswer(args, Date.now()))?.answer).toBe("variant-" + index);
      expect((await cache.getSharedCachedAnswer(args, Date.now()))?.answer).toBe("variant-" + index);
    }
    expect(rows.every((row) => row.dependency_version === "rag-cache-v26")).toBe(true);
  });

  it("P08C distinguishes full request suffixes in every answer identity without retaining request text", async () => {
    const cache = await import("../src/lib/rag/rag-cache");
    const prefix =
      "lithium clozapine valproate olanzapine quetiapine risperidone aripiprazole haloperidol sertraline fluoxetine paroxetine venlafaxine duloxetine mirtazapine";
    const inputs = [" adults", " children", " not children", " explain in detail", " only this source"].map(
      (suffix) => ({ query: prefix + suffix, ownerId }),
    );
    expect(new Set(inputs.map(cache.sharedAnswerNormalizedQuery)).size).toBe(inputs.length);
    expect(new Set(inputs.map(cache.scopedAnswerCacheKey)).size).toBe(inputs.length);
    for (const input of inputs) {
      expect(cache.scopedAnswerCacheKey(input)).not.toContain("lithium");
      expect(cache.sharedAnswerNormalizedQuery(input)).not.toContain("lithium");
    }
    expect(cache.sharedAnswerNormalizedQuery({ query: "  Lithium   dosing " })).toBe(
      cache.sharedAnswerNormalizedQuery({ query: "lithium dosing" }),
    );
  });

  it("preserves decomposed telemetry through the real local-answer cache entrypoint", async () => {
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "60000");
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "100");
    const harness = installAnswerCacheEntrypointHarness();
    const cache = await import("../src/lib/rag/rag-cache");
    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const { ragProgrammeTelemetryForAnswer } = await import("../src/lib/rag/rag-programme-telemetry");
    const args = {
      query: "cached decomposed local plan",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
      ragQueryPlanVersion: "rag-query-plan-v1",
      ragQueryPlanMode: "legacy" as const,
      ragQueryPlanKind: "decomposed" as const,
      ragSubquestionCount: 3,
      ragCandidateMatchCounts: { matched: 1, partial_match: 1, absent: 1 },
    };
    await cache.setCachedAnswer(args, sampleAnswer("Local cached answer."));
    await vi.waitFor(() => expect(harness.insertedRows).toHaveLength(1));

    const answer = await answerQuestionWithScope({
      query: args.query,
      ownerId,
      accessScope: args.accessScope,
      logQuery: false,
      observationContext: {
        interactionId: "11111111-1111-4111-8111-111111111111",
        rolloutMode: "legacy",
      },
    });

    expect(answer.routingReason).toContain("answer_cache_hit");
    expect(ragProgrammeTelemetryForAnswer(answer)).toMatchObject({
      query_plan_kind: "decomposed",
      subquestion_count: 3,
      candidate_match_counts: null,
    });
    expect(cache.ragAnswerQueryPlanDiagnostics(answer)?.candidateMatchCounts).toBeUndefined();
    expect(harness.insertedRows[0]?.payload).not.toHaveProperty("queryPlanDiagnostics.candidateMatchCounts");
  });

  it("preserves decomposed telemetry through the real shared-answer cache entrypoint", async () => {
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "60000");
    vi.stubEnv("RAG_ANSWER_CACHE_SIZE", "100");
    installAnswerCacheEntrypointHarness({
      answer: sampleAnswer("Shared cached answer."),
      queryPlanDiagnostics: {
        queryPlanKind: "decomposed",
        subquestionCount: 3,
        candidateMatchCounts: { matched: 3, partial_match: 0, absent: 0 },
      },
    });
    const cache = await import("../src/lib/rag/rag-cache");
    const { answerQuestionWithScope } = await import("../src/lib/rag/rag");
    const { ragProgrammeTelemetryForAnswer } = await import("../src/lib/rag/rag-programme-telemetry");

    const answer = await answerQuestionWithScope({
      query: "cached decomposed shared plan",
      ownerId,
      accessScope: { ownerId, includePublic: true },
      logQuery: false,
      observationContext: {
        interactionId: "22222222-2222-4222-8222-222222222222",
        rolloutMode: "legacy",
      },
    });

    expect(answer.routingReason).toContain("shared_answer_cache_hit");
    expect(ragProgrammeTelemetryForAnswer(answer)).toMatchObject({
      query_plan_kind: "decomposed",
      subquestion_count: 3,
      candidate_match_counts: null,
    });
    expect(cache.ragAnswerQueryPlanDiagnostics(answer)?.candidateMatchCounts).toBeUndefined();
  });

  it("performs no local, shared, or deferred cache writes for unissued shadow inputs", async () => {
    vi.resetModules();
    const from = vi.fn(() => {
      throw new Error("shadow cache writes must not touch storage");
    });
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => withMockRagScopeRevision({ from }) }));

    const { getCachedAnswer, setCachedAnswer, setCachedSearch } = await import("../src/lib/rag/rag-cache");
    const args = {
      query: "compare clozapine and olanzapine monitoring",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
      ragQueryPlanVersion: "rag-query-plan-v1",
      ragQueryPlanMode: "shadow" as const,
      ragQueryPlanKind: "decomposed" as const,
      ragSubquestionCount: 3,
    };

    await setCachedAnswer(args, sampleAnswer());
    await setCachedSearch(
      args,
      [],
      {
        search_cache_hit: false,
        text_fast_path_latency_ms: 0,
        embedding_skipped: true,
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
      },
      [],
    );

    expect(await getCachedAnswer(args, Date.now(), { indexingVersionAtRequestStart: "unused" })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("partitions query-plan versions and modes without exposing candidate subqueries", async () => {
    vi.resetModules();
    const { withRagRequestContext } = await import("../src/lib/rag/rag-context-snapshot");
    const { ragCacheDependencyVersion, retrievalPlanCacheQuery, scopedAnswerCacheKey } =
      await import("../src/lib/rag/rag-cache");
    const requestArgs: SearchChunksArgs = {
      query: "lithium monitoring",
      ownerId,
      accessScope: { ownerId, includePublic: true as const },
    };
    const request = withRagRequestContext(requestArgs);
    const legacyV1 = {
      ...request,
      ragQueryPlanVersion: "rag-query-plan-v1",
      ragQueryPlanMode: "legacy" as const,
    };
    const shadowV1 = { ...legacyV1, ragQueryPlanMode: "shadow" as const };
    const shadowV2 = { ...shadowV1, ragQueryPlanVersion: "rag-query-plan-v2" };

    // Ledger #ZK460W: must stay ahead of main's v24 while that namespace still holds
    // unsafe grounded/non-review_only review-fallback rows that lack generation_fallback:.
    expect(ragCacheDependencyVersion).toBe("rag-cache-v26");
    expect(ragCacheDependencyVersion).not.toBe("rag-cache-v24");
    expect(scopedAnswerCacheKey(legacyV1)).toMatch(/^rag-cache-v26\|/);
    expect(scopedAnswerCacheKey(legacyV1)).not.toBe(scopedAnswerCacheKey(shadowV1));
    expect(scopedAnswerCacheKey(shadowV1)).not.toBe(scopedAnswerCacheKey(shadowV2));
    const searchKeys = [legacyV1, shadowV1, shadowV2].map((args) =>
      retrievalPlanCacheQuery(args, undefined, ["candidate subquestion secret"]),
    );
    expect(new Set(searchKeys).size).toBe(3);
    expect(searchKeys.every((key) => !key.includes("candidate subquestion secret"))).toBe(true);
  });

  it("removes only the matching hashed site-aware answer and in-flight identities", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () =>
        withMockRagScopeRevision({
          from: () => ({
            delete: () => new DeleteQuery([]),
          }),
        }),
    }));

    const { withRagRequestContext } = await import("../src/lib/rag/rag-context-snapshot");
    const { answerInflight, invalidateRagCachesForOwner, scopedAnswerCacheKey } =
      await import("../src/lib/rag/rag-cache");
    const input = {
      expectedSiteStaticManifestDigest: "a".repeat(64),
      activePublicSiteRelease: {
        version: "clinical-kb-site-release-v1" as const,
        releaseId: "11111111-1111-5111-8111-111111111111",
        registryVersion: "site-content-registry-v1",
        staticManifestDigest: "a".repeat(64),
        dynamicStateDigest: "b".repeat(64),
        releaseDigest: "c".repeat(64),
        state: "active" as const,
        activatedAt: "2026-08-29T00:00:00.000Z",
      },
      publicSiteChangeEpoch: "1",
      pendingPublicSiteChangeCount: 0,
      documentIndexGeneration: "generation-v1",
      sourcePolicyVersion: "source-policy-v1",
      rolloutVersion: "rollout-v1",
    };
    const publicRequest = withRagRequestContext({
      query: "clozapine monitoring",
      accessScope: { includePublic: true as const },
      ragContextSnapshotInput: input,
    });
    const ownerAArgs = { ...publicRequest, ownerId };
    const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const ownerBArgs = { ...publicRequest, ownerId: ownerB };
    const ownerAKey = scopedAnswerCacheKey(ownerAArgs);
    const ownerBKey = scopedAnswerCacheKey(ownerBArgs);
    answerInflight.set(ownerAKey, Promise.resolve(sampleAnswer("owner-a")));
    answerInflight.set(ownerBKey, Promise.resolve(sampleAnswer("owner-b")));

    expect(ownerAKey).not.toContain(ownerId);
    invalidateRagCachesForOwner(ownerId);

    expect(answerInflight.has(ownerAKey)).toBe(false);
    expect(answerInflight.has(ownerBKey)).toBe(true);
    invalidateRagCachesForOwner(ownerB);
  });

  it("clears anonymous shared cache rows with owner_id is null instead of writing the anonymous sentinel to UUID filters", async () => {
    vi.resetModules();
    const calls: FilterCall[][] = [];

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () =>
        withMockRagScopeRevision({
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
    const indexingStamp = `rag-deep-memory-v2:${mockRagScopeRevision([{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }])}`;

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () =>
        withMockRagScopeRevision({
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
    // its forced document-revision read. A table-fact mutation is outside that revision.
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
    const indexingStamp = `rag-deep-memory-v2:${mockRagScopeRevision([{ id: "doc-1", updated_at: "2026-07-01T00:00:00.000Z", metadata: {} }])}`;

    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () =>
        withMockRagScopeRevision({
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
