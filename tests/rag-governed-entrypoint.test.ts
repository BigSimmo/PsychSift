import type { ReviewedPolicyEvent } from "@/lib/rag/rag-reviewed-policy-input";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RagContextSnapshotInput } from "../src/lib/rag/rag-context-snapshot";
import type { ClinicalSourceMetadata, SearchResult, SourceCorpusScope } from "../src/lib/types";

const RELEASE_ID = "e4a1dd29-14f6-556c-8fb7-f4f947d8b846";
const STATIC_DIGEST = "a".repeat(64);
const DYNAMIC_DIGEST = "b".repeat(64);
const RELEASE_DIGEST = "c".repeat(64);
const snapshotInput: RagContextSnapshotInput = {
  expectedSiteStaticManifestDigest: STATIC_DIGEST,
  activePublicSiteRelease: {
    version: "clinical-kb-site-release-v1",
    releaseId: RELEASE_ID,
    registryVersion: "site-content-registry-v1",
    staticManifestDigest: STATIC_DIGEST,
    dynamicStateDigest: DYNAMIC_DIGEST,
    releaseDigest: RELEASE_DIGEST,
    state: "active",
    activatedAt: "2026-08-30T00:00:00.000Z",
  },
  publicSiteChangeEpoch: "7",
  pendingPublicSiteChangeCount: 0,
  documentIndexGeneration: "document-generation-v1",
  sourcePolicyVersion: "source-policy-v1",
  rolloutVersion: "rollout-v1",
};

class EmptyQuery implements PromiseLike<{ data: unknown[]; error: null }> {
  select() {
    return this;
  }
  eq() {
    return this;
  }
  is() {
    return this;
  }
  in() {
    return this;
  }
  or() {
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

type GovernedTestSourceMetadata = ClinicalSourceMetadata & {
  site_content_logical_id?: string;
  site_content_lineage?: Array<{
    sourceId: string;
    sourceHash: string;
    relationship: "derived_from" | "references";
  }>;
};

type GovernedTestRow = Omit<SearchResult, "source_metadata"> & {
  source_metadata: GovernedTestSourceMetadata;
  site_release_id: string | null;
  site_change_epoch: string | null;
  pending_exclusion_exact: boolean | null;
};

function governedRow(id: string, scope: SourceCorpusScope): GovernedTestRow {
  return {
    id,
    document_id: `${id}-document`,
    title: "Clozapine monitoring",
    file_name: "clozapine-monitoring.md",
    page_number: null,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "Clozapine monitoring requires regular blood tests.",
    image_ids: [],
    images: [],
    similarity: 0.9,
    text_rank: 0.8,
    hybrid_score: 0.9,
    corpus_scope: scope,
    site_content_domain: scope === "clinical_kb_site" ? "medications" : null,
    source_metadata: {
      source_title: "Clozapine source",
      publisher: "Clinical KB",
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
      content_mode: "indexed_content",
      licence_policy: "public_index_permitted",
      corpus_scope: scope,
      source_kind: scope === "clinical_kb_site" ? "registry_record" : "document",
      source_role: "clinical_guideline",
      source_catalogue_key: `${scope}:${id}`,
    },
    site_release_id: scope === "clinical_kb_site" ? RELEASE_ID : null,
    site_change_epoch: scope === "clinical_kb_site" ? "7" : null,
    pending_exclusion_exact: scope === "clinical_kb_site" ? true : null,
  };
}

async function loadHarness(
  options: {
    abortDuringImageHydration?: { controller: AbortController; reason: Error };
    abortDuringMetadataHydration?: { controller: AbortController; reason: Error };
    divergentCorpusGrounding?: boolean;
    shadowOperation?: (
      signal: AbortSignal,
    ) => Promise<{ candidateResults: SearchResult[]; results: SearchResult[]; served: boolean }>;
    hybridError?: boolean;
    missingV3?: boolean;
    candidateRows?: GovernedTestRow[];
    sourceOnly?: boolean;
    beforeMetadataHydration?: () => void;
    hydrateAdmittedDocuments?: boolean;
    generatedAnswer?: Record<string, unknown>;
    generationContractFixture?: boolean;
  } = {},
) {
  vi.doUnmock("@/lib/rag/rag-extractive-first");
  vi.doUnmock("@/lib/rag/rag-routing");
  if (options.generationContractFixture) {
    vi.doMock("@/lib/rag/rag-extractive-first", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/rag/rag-extractive-first")>()),
      // Shared across both contracts: isolate the generated-answer delivery contract.
      chooseValidatedExtractiveShortCircuit: () => null,
    }));
    vi.doMock("@/lib/rag/rag-routing", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/lib/rag/rag-routing")>()),
      chooseAnswerRoute: () => ({
        mode: "strong",
        model: "gpt-4.1-mini",
        reason: "paired_generation_contract",
        strongestScore: 0.9,
        documentCount: options.candidateRows?.length ?? 0,
      }),
    }));
  }
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const governedCaptures: Array<{
    input: Parameters<typeof import("../src/lib/rag/rag-governed-search").routeGovernedSearch>[0];
    output: Awaited<ReturnType<typeof import("../src/lib/rag/rag-governed-search").routeGovernedSearch>>;
  }> = [];
  const packedCaptures: Array<{ input: unknown; output: unknown }> = [];
  vi.doUnmock("@/lib/rag/rag-context-pack");
  if (options.generatedAnswer)
    vi.doMock("@/lib/rag/rag-context-pack", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/lib/rag/rag-context-pack")>();
      return {
        ...actual,
        packModelContextEvidence: async (...args: Parameters<typeof actual.packModelContextEvidence>) => {
          const output = await actual.packModelContextEvidence(...args);
          packedCaptures.push({ input: args[0], output });
          return output;
        },
        packModelContextEvidencePair: async (...args: Parameters<typeof actual.packModelContextEvidencePair>) => {
          const output = await actual.packModelContextEvidencePair(...args);
          packedCaptures.push({ input: args[0], output });
          return output;
        },
      };
    });
  const setCachedSearch = vi.fn(async () => undefined);
  const attachDocumentRankingMetadata = vi.fn(
    async (_client, rows: SearchResult[], _ownerId?: string, _cache?: unknown, signal?: AbortSignal) => {
      options.beforeMetadataHydration?.();
      if (signal && options.abortDuringMetadataHydration) {
        options.abortDuringMetadataHydration.controller.abort(options.abortDuringMetadataHydration.reason);
        signal.throwIfAborted();
      }
      return rows;
    },
  );
  const attachPageVisualEvidence = vi.fn(async (_client, rows: SearchResult[], signal?: AbortSignal) => {
    if (signal && options.abortDuringImageHydration) {
      options.abortDuringImageHydration.controller.abort(options.abortDuringImageHydration.reason);
      signal.throwIfAborted();
    }
    return rows;
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const response = (() => {
      if (name.endsWith("_v3") && options.missingV3) {
        return { data: null, error: { code: "PGRST202", message: "candidate RPC is absent" } };
      }
      if (name === "match_document_chunks_hybrid_v3" && options.hybridError) {
        return { data: null, error: { code: "XX000", message: "hybrid unavailable" } };
      }
      if (name.endsWith("_v3")) {
        return { data: options.candidateRows ?? [governedRow("governed-row", "uploaded_local")], error: null };
      }
      return { data: [], error: null };
    })();
    return Object.assign(Promise.resolve(response), { abortSignal: vi.fn(async () => response) });
  });

  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      rpc,
      from: vi.fn((table: string) => {
        if (table !== "document_chunks" || !options.hydrateAdmittedDocuments) return new EmptyQuery();
        const query = {
          select: () => query,
          in: async (_column: string, ids: string[]) => ({
            data: ids.flatMap((id) => {
              const row = options.candidateRows?.find((candidate) => candidate.id === id);
              return row
                ? [
                    {
                      id,
                      document_id: row.document_id,
                      index_generation_id: "document-generation-v1",
                      documents: {
                        owner_id: null,
                        status: "indexed",
                        index_generation_id: "document-generation-v1",
                        metadata: {
                          corpus_scope: row.corpus_scope,
                          publication_manifest_version: 2,
                          source_policy_version: "source-policy-v1",
                          publication_source_policy_version: "source-policy-v1",
                          publication_reviewed_index_generation_id: "document-generation-v1",
                        },
                      },
                    },
                  ]
                : [];
            }),
            error: null,
          }),
        };
        return query;
      }),
    }),
  }));
  vi.doMock("@/lib/rag/rag-cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/rag/rag-cache")>()),
    getCachedSearch: vi.fn(async () => null),
    getSharedCachedSearch: vi.fn(async () => null),
    setCachedSearch,
  }));
  vi.doMock("@/lib/rag/rag-retrieval-variants", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/rag/rag-retrieval-variants")>()),
    fetchEnabledRagAliases: vi.fn(async () => []),
  }));
  const classifyCorpusGrounding = vi.fn(async ({ ownerFilter }: { ownerFilter: string }) => ({
    verdict: options.divergentCorpusGrounding
      ? ownerFilter === "00000000-0000-0000-0000-000000000000"
        ? "out_of_corpus"
        : "in_corpus_topic"
      : "inconclusive",
    anchorTerms: [],
    absentTerms: [],
  }));
  vi.doMock("@/lib/corpus-grounding", () => ({ classifyCorpusGrounding }));
  vi.doMock("@/lib/rag/rag-provider", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/rag/rag-provider")>()),
    isSourceOnlyMode: () => options.sourceOnly ?? false,
  }));
  const generateParsedTextResult = vi.fn(async () => {
    throw new Error("Unexpected classifier provider call");
  });
  const generateStructuredTextResult = vi.fn(async (_input: string, _schema: unknown, _options: unknown) => {
    void _input;
    void _schema;
    void _options;
    if (options.generatedAnswer)
      return {
        text: JSON.stringify(options.generatedAnswer),
        model: "gpt-4.1-mini",
        operation: "answer",
        latencyMs: 1,
        requestId: "p12c-deterministic-contract",
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
      };
    throw new Error("Unexpected answer provider call");
  });
  const embedTextWithTelemetry = vi.fn(async () => ({ embedding: [0.1, 0.2], cacheHit: false }));
  vi.doMock("@/lib/openai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/openai")>()),
    embedTextWithTelemetry,
    generateParsedTextResult,
    generateStructuredTextResult,
  }));
  vi.doMock("@/lib/rag/rag-hydration", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/lib/rag/rag-hydration")>()),
    attachDocumentRankingMetadata,
    attachPageVisualEvidence,
  }));

  vi.doMock("@/lib/rag/rag-governed-search", async (importOriginal) => {
    const original = await importOriginal<typeof import("../src/lib/rag/rag-governed-search")>();
    return {
      ...original,
      routeGovernedSearch: async (input: Parameters<typeof original.routeGovernedSearch>[0]) => {
        const output = await (input.args.ragQueryPlanMode === "shadow" && options.shadowOperation
          ? options.shadowOperation(input.args.signal!)
          : original.routeGovernedSearch(input));
        if (options.generatedAnswer) governedCaptures.push({ input, output });
        return output;
      },
    };
  });
  const entrypoints = await import("../src/lib/rag/rag");
  const { env } = await import("../src/lib/env");
  // Existing synthetic journey inputs configure the trusted server fixture, never HTTP controls.
  const configure = <T extends import("../src/lib/rag/rag-contracts").SearchChunksArgs>(args: T): T => {
    env.RAG_PROGRAMME_MODE = args.ragQueryPlanMode ?? "legacy";
    env.RAG_GOVERNED_RETRIEVAL_ENABLED = true;
    env.RAG_PROGRAMME_CANARY_BASIS_POINTS = 10000;
    env.RAG_PROGRAMME_ROLLOUT_SALT = "synthetic-rollout-salt-01234567890123456789";
    env.RAG_SITE_CONTENT_ENABLED = args.governedCorpusComponents?.siteContent ?? false;
    env.RAG_AUSTRALIAN_AUGMENTATION_ENABLED = args.governedCorpusComponents?.australianAugmentation ?? false;
    return {
      ...args,
      ownerId: args.ownerId ?? (args.ragQueryPlanMode === "canary" ? "fixture-cohort-owner" : undefined),
    };
  };
  const searchChunksWithTelemetry = (args: Parameters<typeof entrypoints.searchChunksWithTelemetry>[0]) =>
    entrypoints.searchChunksWithTelemetry(configure(args));
  const answerQuestionWithScope = (args: Parameters<typeof entrypoints.answerQuestionWithScope>[0]) =>
    entrypoints.answerQuestionWithScope(configure(args));
  return {
    rawSearch: entrypoints.searchChunksWithTelemetry,
    governedCaptures,
    packedCaptures,
    classifyCorpusGrounding,
    generateParsedTextResult,
    generateStructuredTextResult,
    embedTextWithTelemetry,
    env,
    answerQuestionWithScope,
    searchChunksWithTelemetry,
    calls,
    rpc,
    setCachedSearch,
    attachDocumentRankingMetadata,
    attachPageVisualEvidence,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// E02/E03: ordinary synthetic passages are frozen across contract/evidence variants.
// These rows use actual current site/Australian admission; uploaded admission is P16-gated.
const p12cBroadQuery = "Lithium management, actions, monitoring and risks.";
const p12cFacts = {
  management: "Lithium management uses shared decision making to agree a treatment plan.",
  action: "Lithium actions include checking current medicines before starting treatment.",
  monitoring: "Lithium monitoring includes renal function every six months. Check lithium levels every three months.",
  risk: "Lithium risks include toxicity. Vomiting and tremor require urgent clinical review.",
} as const;

function p12cRows(includeRisk = true, irrelevant = false) {
  const au = governedRow("p12c-primary", "australian_public");
  au.title = "Australian lithium management guideline";
  au.file_name = "lithium-guideline.md";
  au.content = [p12cFacts.management, p12cFacts.action, p12cFacts.monitoring].join(" ");
  au.source_metadata.source_catalogue_key = "wa-chief-psychiatrist";
  au.source_metadata.source_title = au.title;
  au.source_metadata.source_policy_version = "australian-source-policy-v1";
  au.source_metadata.publisher_code = "OCPWA";
  au.source_metadata.publisher = "Office of the Chief Psychiatrist WA";
  const site = governedRow("p12c-risk", "australian_public");
  site.title = "Australian lithium risk guideline";
  site.file_name = "lithium-risk.md";
  site.source_metadata = { ...au.source_metadata, source_title: site.title };
  site.content = p12cFacts.risk;
  const unrelated = governedRow("p12c-irrelevant", "australian_public");
  unrelated.title = "Clozapine reference";
  unrelated.content = "Clozapine monitoring requires regular blood tests.";
  unrelated.source_metadata = { ...au.source_metadata, source_title: unrelated.title };
  return [au, ...(includeRisk ? [site] : []), ...(irrelevant ? [unrelated] : [])];
}

describe("P12C same-evidence legacy and adaptive delivery", () => {
  it("answers independent admitted site catalogue and Australian clinical parts", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_PROVIDER_MODE", "auto");
    const au = p12cRows(false)[0]!;
    const site = governedRow("p12c-tool", "clinical_kb_site");
    site.title = "Lithium tool record";
    site.file_name = "lithium-tool-record.md";
    site.source_metadata.source_title = site.title;
    site.section_heading = "Tool record";
    site.site_content_domain = "tools";
    site.source_metadata.source_role = "tool_reference";
    site.content = "The lithium tool record is available in the tools catalogue.";
    const query = "Which lithium tool record is available, and what monitoring applies to lithium?";
    const harness = await loadHarness({
      candidateRows: [au, site],
      hydrateAdmittedDocuments: true,
      generationContractFixture: true,
      generatedAnswer: {
        answer: p12cFacts.monitoring,
        grounded: true,
        confidence: "high",
        citations: [{ chunk_id: au.id }, { chunk_id: site.id }],
        quoteCards: [],
        conflictsOrGaps: [],
        answerSections: [
          {
            heading: "Available tool",
            kind: "documentation",
            body: site.content,
            citation_chunk_ids: [site.id],
            supportLevel: "direct",
          },
        ],
      },
    });
    harness.env.RAG_ADAPTIVE_ANSWER_ENABLED = true;
    harness.env.RAG_ADAPTIVE_ANSWER_RENDER_ENABLED = true;
    const answer = await harness.answerQuestionWithScope({
      query,
      skipCache: true,
      ragQueryPlanMode: "canary",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: true, australianCurrent: true },
    });
    if (process.env.P12C_CAPTURE_FULL === "1")
      console.info(
        "P12C_MIXED",
        JSON.stringify({ query, answer, routes: harness.governedCaptures, packs: harness.packedCaptures }),
      );
    expect(answer.sources.map((source) => source.id)).toEqual(expect.arrayContaining([au.id, site.id]));
    expect(answer.citations.map((citation) => citation.chunk_id)).toEqual(expect.arrayContaining([au.id, site.id]));
    expect(answer.answer).toContain(p12cFacts.monitoring);
    expect(answer.answerSections?.some((section) => section.body === site.content)).toBe(true);
    expect(answer.ragDiagnostics?.coverage_counts).toMatchObject({ direct: 3, partial: 0, absent: 0 });
    expect(answer.fallbackReasonCode ?? null).toBeNull();
  });
  it.each([
    "complete",
    "partial",
    "irrelevant",
    "followup",
    "elaboration",
    "mixed-complete",
    "mixed-partial",
    "mixed-irrelevant",
    "mixed-followup",
    "mixed-elaboration",
    "narrow",
  ] as const)("preserves fixed reference parts through %s evidence", async (variant) => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("RAG_PROVIDER_MODE", "auto");
    vi.stubEnv("RAG_ANSWER_CACHE_TTL_MS", "0");
    vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");
    const narrow = variant === "narrow";
    const mixed = variant.startsWith("mixed-");
    const partial = variant.endsWith("partial");
    const followup = variant.endsWith("followup");
    const elaboration = variant.endsWith("elaboration");
    const baseQuery = narrow
      ? "How often are lithium levels checked?"
      : mixed
        ? "Which lithium tool record is available, and what monitoring and risks apply to lithium?"
        : p12cBroadQuery;
    const rows = p12cRows(!partial && !narrow, variant.endsWith("irrelevant"));
    const toolFact = "The lithium tool record is available in the tools catalogue.";
    if (mixed) {
      const tool = governedRow("p12c-tool", "clinical_kb_site");
      tool.title = "Lithium tool record";
      tool.file_name = "lithium-tool-record.md";
      tool.section_heading = "Tool record";
      tool.site_content_domain = "tools";
      tool.source_metadata.source_title = tool.title;
      tool.source_metadata.source_role = "tool_reference";
      tool.content = toolFact;
      rows.push(tool);
    }
    const requiredFacts: Record<string, string> = narrow
      ? { monitoring: "Check lithium levels every three months." }
      : mixed
        ? { monitoring: p12cFacts.monitoring, risk: p12cFacts.risk, tool: toolFact }
        : p12cFacts;
    const sections = narrow
      ? []
      : mixed
        ? [
            {
              heading: "Available tool",
              kind: "documentation",
              body: toolFact,
              citation_chunk_ids: ["p12c-tool"],
              supportLevel: "direct",
            },
            ...(!partial
              ? [
                  {
                    heading: "Risks",
                    kind: "escalation_risk",
                    body: p12cFacts.risk,
                    citation_chunk_ids: ["p12c-risk"],
                    supportLevel: "direct",
                  },
                ]
              : []),
          ]
        : [
            {
              heading: "Management",
              kind: "required_actions",
              body: p12cFacts.management,
              citation_chunk_ids: [rows[0]!.id],
              supportLevel: "direct",
            },
            {
              heading: "Actions",
              kind: "required_actions",
              body: p12cFacts.action,
              citation_chunk_ids: [rows[0]!.id],
              supportLevel: "direct",
            },
            {
              heading: "Monitoring",
              kind: "monitoring_timing",
              body: p12cFacts.monitoring,
              citation_chunk_ids: [rows[0]!.id],
              supportLevel: "direct",
            },
            ...(partial
              ? []
              : [
                  {
                    heading: "Risks",
                    kind: "escalation_risk",
                    body: p12cFacts.risk,
                    citation_chunk_ids: ["p12c-risk"],
                    supportLevel: "direct",
                  },
                ]),
          ];
    const harness = await loadHarness({
      candidateRows: rows,
      hydrateAdmittedDocuments: true,
      generationContractFixture: true,
      generatedAnswer: {
        answer: narrow ? requiredFacts.monitoring : p12cFacts.monitoring,
        grounded: true,
        confidence: "high",
        citations: rows.filter((row) => row.id !== "p12c-irrelevant").map((row) => ({ chunk_id: row.id })),
        answerSections: sections,
        quoteCards: [],
        conflictsOrGaps: [],
      },
    });
    const { buildGovernedAnswerClientResponse } = await import("../src/lib/answer-response");
    const { readAnswerStream } = await import("../src/components/clinical-dashboard/search-utils");
    const { buildAnswerRenderModel } = await import("../src/lib/answer-render-policy");
    const { buildAnswerClipboardText } = await import("../src/components/clinical-dashboard/answer-copy-payload");
    const { savePersistedAnswerThread, loadPersistedAnswerThread } = await import("../src/lib/answer-thread-storage");
    const { buildAnswerFollowUpQuery } = await import("../src/lib/answer-follow-up");
    const { parseAnswerRequestContext } = await import("../src/lib/answer-request-context");
    const { contextPackAdmissionMatches } = await import("../src/lib/rag/rag-context-admission");
    const { evaluateRagCase, ragEvalCases } = await import("../src/lib/rag/rag-eval-cases");
    const firstFollowup = buildAnswerFollowUpQuery(baseQuery, "And the risks?");
    const rawQuery = followup ? "And the risks?" : elaboration ? "Elaborate" : baseQuery;
    const resolvedQuery = followup
      ? firstFollowup
      : elaboration
        ? buildAnswerFollowUpQuery(firstFollowup, rawQuery)
        : baseQuery;
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        get length() {
          return storage.size;
        },
        key: (index: number) => [...storage.keys()][index] ?? null,
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const paired = [];
    for (const adaptive of [false, true]) {
      harness.env.RAG_ADAPTIVE_ANSWER_ENABLED = adaptive;
      harness.env.RAG_ADAPTIVE_ANSWER_RENDER_ENABLED = adaptive;
      const request = (query: string) =>
        harness.answerQuestionWithScope({
          query,
          skipCache: true,
          ragQueryPlanMode: "canary",
          ragContextSnapshotInput: snapshotInput,
          governedCorpusComponents: { siteContent: true, australianAugmentation: true, australianCurrent: true },
        });
      const priorTurns: import("../src/lib/answer-thread-storage").StoredAnswerTurn[] = [];
      let requestQuery = resolvedQuery;
      if (elaboration) {
        for (const [index, priorQuery] of [baseQuery, firstFollowup].entries()) {
          const priorServer = await request(priorQuery);
          const priorPayload = buildGovernedAnswerClientResponse(priorServer).payload;
          const priorStreamed = await readAnswerStream(
            new Response(`event: final\ndata: ${JSON.stringify(priorPayload)}\n\n`),
            () => {},
          );
          priorTurns.push({
            id: `p12c-turn-${index}`,
            query: index === 0 ? baseQuery : "And the risks?",
            resolvedQuery: priorQuery,
            answer: priorStreamed,
            sources: priorStreamed.sources ?? [],
          });
        }
        expect(
          savePersistedAnswerThread("p12c", {
            version: 3,
            priorTurns: priorTurns.slice(0, 1),
            latestTurn: priorTurns[1]!,
            collapsedTurnIds: [],
            showEarlierTurns: true,
            latestSubmissionSignature: firstFollowup,
            expiresAt: Date.now() + 60000,
          }),
        ).toBe(true);
        requestQuery = buildAnswerFollowUpQuery(loadPersistedAnswerThread("p12c")!.latestTurn!.resolvedQuery, rawQuery);
        expect(requestQuery).toBe(resolvedQuery);
      }
      const beforeCalls = harness.generateStructuredTextResult.mock.calls.length;
      const server = await request(requestQuery);
      const admittedRoute = harness.governedCaptures.at(-1)!;
      expect(
        server.sources.every((source) =>
          contextPackAdmissionMatches(
            source,
            { includePublic: true },
            admittedRoute.input.args.ragRequestContext!.snapshot,
          ),
        ),
      ).toBe(true);
      const payload = buildGovernedAnswerClientResponse(server).payload;
      if (partial && adaptive) {
        expect(
          server.answerSections?.filter((section) => section.kind === "source_gap").map((section) => section.body),
        ).toEqual(["risk: The active sources support only part of this question."]);
        expect(payload.fallbackReasonCode).toBe("coverage_gap");
        expect(payload.degradedMode?.active).toBe(true);
        expect(JSON.stringify(server.answerSections)).not.toMatch(/vomiting|tremor/i);
      }
      if (mixed && !partial) expect(server.fallbackReasonCode ?? null).toBeNull();
      const streamed = await readAnswerStream(
        new Response(`event: final\ndata: ${JSON.stringify(payload)}\n\n`),
        () => {},
      );
      expect(
        savePersistedAnswerThread("p12c", {
          version: 3,
          priorTurns,
          latestTurn: {
            query: rawQuery,
            resolvedQuery,
            answer: streamed,
            sources: streamed.sources ?? [],
          },
          collapsedTurnIds: [],
          showEarlierTurns: false,
          latestSubmissionSignature: p12cBroadQuery,
          expiresAt: Date.now() + 60000,
        }),
      ).toBe(true);
      const restoredTurn = loadPersistedAnswerThread("p12c")!.latestTurn!;
      if (elaboration)
        expect(loadPersistedAnswerThread("p12c")!.priorTurns.map((turn) => turn.answer)).toEqual(
          priorTurns.map((turn) => turn.answer),
        );
      const restored = restoredTurn.answer;
      expect(restoredTurn.query).toBe(rawQuery);
      expect(restoredTurn.resolvedQuery).toBe(resolvedQuery);
      if (elaboration)
        expect(parseAnswerRequestContext(restoredTurn.resolvedQuery!)).toMatchObject({
          subject: baseQuery,
          constraints: ["And the risks?"],
          latestRequest: "Elaborate",
          depth: "detailed",
        });
      const model = buildAnswerRenderModel(restored);
      const copy = buildAnswerClipboardText({ answer: restored, renderCopyText: model.copyText });
      const liveCopy = buildAnswerClipboardText({
        answer: payload,
        renderCopyText: buildAnswerRenderModel(payload).copyText,
      });
      expect(copy).toBe(liveCopy);
      expect(restored.answer).toBe(payload.answer);
      if (!("answerSections" in payload)) throw new Error("Expected an admitted public answer payload");
      expect(restored.answerSections).toEqual(payload.answerSections);
      if (narrow && process.env.P12C_CAPTURE_FULL === "1")
        console.info(
          "P12C_NARROW",
          JSON.stringify({
            adaptive,
            server,
            providerCalls: harness.generateStructuredTextResult.mock.calls.slice(beforeCalls),
            routes: harness.governedCaptures,
            packs: harness.packedCaptures,
          }),
        );
      if (adaptive && !mixed)
        expect(
          evaluateRagCase(
            ragEvalCases.find(
              (testCase) =>
                testCase.id ===
                (narrow ? "narrow-fact-concise" : partial ? "broad-multi-intent-partial" : "broad-supported-sections"),
            )!,
            server,
          ).failures,
        ).toEqual([]);
      paired.push({
        adaptive,
        version: server.generationDegradation?.promptVersion,
        schema: server.generationDegradation?.schemaVersion,
        providerCalls: harness.generateStructuredTextResult.mock.calls.length - beforeCalls,
        sources: server.sources.map((row) => row.id),
        citations: server.citations.map((citation) => citation.chunk_id),
        answer: server.answer,
        sections: server.answerSections,
        diagnostics: server.ragDiagnostics,
        fallbackReason: server.fallbackReasonCode ?? null,
        serverReceiptMatches: true,
        deliveryEquality: true,
        restoredPriorTurns: priorTurns.length,
        contract: harness.generateStructuredTextResult.mock.calls.slice(beforeCalls),
        retained: Object.entries(requiredFacts)
          .filter(([, fact]) => copy.includes(fact))
          .map(([part]) => part),
        copy,
      });
    }
    if (process.env.P12C_CAPTURE_FULL === "1")
      console.info(
        "P12C_PAIRED",
        JSON.stringify({
          variant,
          rawQuery,
          resolvedQuery,
          paired,
          rpc: harness.calls,
          routes: harness.governedCaptures,
          packs: harness.packedCaptures,
        }),
      );
    if (process.env.P12C_CAPTURE_OUTCOMES === "1")
      console.info(
        "P12C_OUTCOME",
        JSON.stringify({
          variant,
          rawQuery,
          resolvedQuery,
          requiredFacts,
          evidence: rows.map(({ id, content, source_metadata }) => ({ id, content, source_metadata })),
          paired: paired.map(({ contract, ...outcome }) => {
            void contract;
            return outcome;
          }),
        }),
      );
    expect(paired[1]!.sources).toContain("p12c-primary");
    expect(paired[1]!.retained).toEqual(Object.keys(requiredFacts).filter((part) => !partial || part !== "risk"));
    if (mixed) expect(paired[1]!.sources).toContain("p12c-tool");
    if (mixed && !partial) expect(paired[1]!.diagnostics?.coverage_counts).toMatchObject({ partial: 0, absent: 0 });
    expect(paired[1]!.copy).not.toContain("Clozapine monitoring");
    expect(paired[1]!.providerCalls).toBeGreaterThan(0);
    expect(paired[0]!.providerCalls).toBeGreaterThan(0);
    expect(paired.map((result) => result.version)).toEqual(["clinical-rag-answer-v19", "clinical-rag-answer-v20"]);
    expect(paired.map((result) => result.schema)).toEqual([
      "clinical-rag-answer-schema-v4",
      "clinical-rag-answer-schema-v5",
    ]);
    expect(paired[0]!.sources).toEqual(paired[1]!.sources);
    if (narrow) {
      expect(paired[1]!.copy).toBe(paired[0]!.copy);
      expect(paired[1]!.sections ?? []).toHaveLength(0);
    } else expect(paired[1]!.retained.length).toBeGreaterThan(paired[0]!.retained.length);
  });
});

describe("governed retrieval production entrypoint", () => {
  it("P09 shadow has identical final client bytes with one control analysis and zero extra provider calls", async () => {
    const harness = await loadHarness({ sourceOnly: true });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-09T00:00:00Z"));
    const args = {
      query: "bipolar disorder",
      ownerId: "owner-a",
      allowGlobalSearch: true,
      skipCache: true,
      logQuery: false,
    };
    const legacy = await harness.answerQuestionWithScope({ ...args, ragQueryPlanMode: "legacy" });
    const controlAnalysisCount = harness.classifyCorpusGrounding.mock.calls.length;
    const shadow = await harness.answerQuestionWithScope({
      ...args,
      ragQueryPlanMode: "shadow",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
    });
    expect(controlAnalysisCount).toBe(1);
    expect(harness.classifyCorpusGrounding).toHaveBeenCalledTimes(2);
    const { toClientAnswerPayload } = await import("../src/lib/answer-client-payload");
    expect(JSON.stringify(toClientAnswerPayload(shadow))).toBe(JSON.stringify(toClientAnswerPayload(legacy)));
    expect(harness.generateParsedTextResult).not.toHaveBeenCalled();
    expect(harness.generateStructuredTextResult).not.toHaveBeenCalled();
    expect(harness.embedTextWithTelemetry).not.toHaveBeenCalled();
  });

  it("P09 ignores request activation hints and observation disagreement when server mode is legacy", async () => {
    const { rawSearch, env, calls } = await loadHarness();
    env.RAG_PROGRAMME_MODE = "legacy";
    const result = await rawSearch({
      query: "What is clozapine?",
      ownerId: "owner-a",
      allowGlobalSearch: true,
      lexicalOnly: true,
      skipCache: true,
      ragQueryPlanMode: "canary",
      governedCorpusComponents: { siteContent: true, australianAugmentation: true, australianCurrent: true },
    });
    expect(result.results).toEqual([]);
    expect(calls.some((call) => call.name.endsWith("_v3"))).toBe(false);
  });
  it("full guest answer rollout keeps existing retrieval until governed retrieval is explicitly enabled", async () => {
    const { rawSearch, env, calls } = await loadHarness();
    env.RAG_PROGRAMME_MODE = "canary";
    env.RAG_PROGRAMME_CANARY_BASIS_POINTS = 10000;
    env.RAG_PROGRAMME_ROLLOUT_SALT = "synthetic-rollout-salt-01234567890123456789";
    env.RAG_GOVERNED_RETRIEVAL_ENABLED = false;
    await rawSearch({ query: "What is clozapine?", allowGlobalSearch: true, lexicalOnly: true, skipCache: true });
    expect(calls.some((call) => call.name.endsWith("_v3"))).toBe(false);
    env.RAG_GOVERNED_RETRIEVAL_ENABLED = true;
    await rawSearch({ query: "What is clozapine?", allowGlobalSearch: true, lexicalOnly: true, skipCache: true });
    expect(calls.some((call) => call.name.endsWith("_v3"))).toBe(true);
  });
  it.each([false, true])(
    "P09 completes legacy unchanged and consumes deferred shadow failure=%s with child cleanup",
    async (reject) => {
      let shadowSignal: AbortSignal | undefined;
      let settle!: () => void;
      const operation = vi.fn((signal: AbortSignal) => {
        shadowSignal = signal;
        return new Promise<{ candidateResults: SearchResult[]; results: SearchResult[]; served: boolean }>(
          (resolve, rejectPromise) => {
            settle = () =>
              reject
                ? rejectPromise(new Error("PRIVATE_SHADOW_FAILURE"))
                : resolve({ candidateResults: [], results: [], served: false });
          },
        );
      });
      const { searchChunksWithTelemetry } = await loadHarness({ shadowOperation: operation });
      const controller = new AbortController();
      const args = {
        query: "What is clozapine?",
        ownerId: "owner-a",
        allowGlobalSearch: true,
        lexicalOnly: true,
        skipCache: true,
        signal: controller.signal,
      };
      const legacy = await searchChunksWithTelemetry({ ...args, ragQueryPlanMode: "legacy" });
      const shadow = await searchChunksWithTelemetry({ ...args, ragQueryPlanMode: "shadow" });
      expect(shadow.results).toEqual(legacy.results);
      expect(shadow.telemetry.retrieval_strategy).toBe(legacy.telemetry.retrieval_strategy);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(shadowSignal?.aborted).toBe(true);
      expect(controller.signal.aborted).toBe(false);
      expect(shadow.telemetry.shadow_retrieval_state).toBe("cancelled");
      const emitted = JSON.stringify(shadow);
      settle();
      await Promise.resolve();
      await Promise.resolve();
      expect(JSON.stringify(shadow)).toBe(emitted);
      expect(emitted).not.toContain("PRIVATE_SHADOW_FAILURE");
    },
  );

  it.each(["current", "missing", "changed", "expired"] as const)(
    "T8-R8 final actual answer reports %s review evidence state",
    async (state) => {
      const fixtures = [governedRow("local", "uploaded_local"), governedRow("au", "australian_public")].map(
        (row): GovernedTestRow => ({
          ...row,
          title: "PBS subsidy policy",
          content: "PBS subsidy authority restrictions apply to this medicine.",
          section_heading: "PBS subsidy",
          source_metadata: {
            ...row.source_metadata,
            version: "fixture-v1",
            jurisdiction: "Australia",
            publication_date: "2026-01-01",
            review_date: "2027-01-01",
            source_title: "PBS subsidy policy",
            source_role: "subsidy",
            publisher: row.id === "au" ? "Pharmaceutical Benefits Scheme" : "Local service",
            publisher_code: row.id === "au" ? "PBS" : null,
            source_catalogue_key: row.id === "au" ? "pbs" : "local-policy",
            source_policy_version: "australian-source-policy-v1",
            content_hash: "a".repeat(64),
          },
        }),
      );
      const now = Date.parse("2026-09-08T12:00:00Z");
      const event: ReviewedPolicyEvent = {
        version: "reviewed-policy-event-v1",
        recordId: "fixture",
        sequence: 1,
        previousSequence: null,
        status: "approved",
        provenance: "human_review",
        reviewerRole: "clinical_source_governance",
        reviewerId: "AUDIT_CANARY",
        reviewedAt: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 1000).toISOString(),
        sourcePolicyVersion: "source-policy-v1",
        difference: {
          claimRole: "subsidy",
          topicKey: "fixture-subsidy",
          overlapReason: "same_topic_and_population",
          materialDifferenceReason: "recommendation_differs",
          localChunkIds: ["local"],
          australianChunkIds: ["au"],
        },
        evidence: fixtures.map((row) => ({
          chunkId: row.id,
          documentId: row.document_id,
          sourceVersion: "fixture-v1",
          contentHash: "a".repeat(64),
        })),
      };
      const candidateRows =
        state === "missing"
          ? fixtures.slice(1)
          : state === "changed"
            ? fixtures.map((row) => ({ ...row, source_metadata: { ...row.source_metadata, version: "changed" } }))
            : fixtures;
      const { answerQuestionWithScope, attachDocumentRankingMetadata } = await loadHarness({
        sourceOnly: true,
        candidateRows,
        beforeMetadataHydration: () => {
          if (state === "expired") vi.setSystemTime(now + 2000);
        },
      });
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const answer = await answerQuestionWithScope({
        query: "PBS subsidy restrictions",
        allowGlobalSearch: true,
        logQuery: false,
        ragQueryPlanMode: "canary",
        ragContextSnapshotInput: snapshotInput,
        governedCorpusComponents: { siteContent: true, australianAugmentation: true, australianCurrent: true },
        loadReviewedSourcePolicyInput: async () => [event],
      });
      if (state === "current") {
        const { sourceEligibilityForClaim } = await import("@/lib/source-role-policy");
        for (const row of attachDocumentRankingMetadata.mock.calls[0]?.[1] ?? [])
          expect(sourceEligibilityForClaim({ source: row.source_metadata!, claimRole: "subsidy" })).toEqual({
            eligible: true,
            reason: "eligible",
          });
        expect(
          attachDocumentRankingMetadata.mock.calls[0]?.[1].map((row) => ({
            id: row.id,
            version: row.source_metadata?.version,
            hash: row.source_metadata?.content_hash,
          })),
        ).toEqual(
          fixtures.map((row) => ({
            id: row.id,
            version: row.source_metadata.version,
            hash: row.source_metadata.content_hash,
          })),
        );
      }
      expect(answer.ragDiagnostics?.reviewed_input_state).toBe(state === "current" ? "reviewed" : "unavailable");
      expect(JSON.stringify(answer.ragDiagnostics)).not.toContain("AUDIT_CANARY");
    },
  );
  it("T8-R7 includes delayed review loading in actual answer total latency", async () => {
    const { answerQuestionWithScope } = await loadHarness({ sourceOnly: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    const pending = answerQuestionWithScope({
      query: "What is clozapine?",
      allowGlobalSearch: true,
      logQuery: false,
      ragQueryPlanMode: "canary",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
      loadReviewedSourcePolicyInput: async () => {
        await new Promise((resolve) => setTimeout(resolve, 7000));
        return [];
      },
    });
    await vi.advanceTimersByTimeAsync(7000);
    const result = await pending;
    expect(result.latencyTimings?.total_latency_ms).toBeGreaterThanOrEqual(7000);
    expect(result.ragDiagnostics?.reviewed_input_state).toBe("not_assessed");
  });
  it("P08C loads trusted review configuration at the actual entrypoint and refuses cache reuse", async () => {
    const { searchChunksWithTelemetry, setCachedSearch } = await loadHarness();
    const loader = vi.fn(async (_input: unknown) => {
      void _input;
      return [];
    });
    const capture = vi.fn();
    await searchChunksWithTelemetry({
      query: "What is clozapine?",
      allowGlobalSearch: true,
      ragQueryPlanMode: "canary",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: true, australianCurrent: true },
      loadReviewedSourcePolicyInput: loader,
      captureSourcePolicyConflicts: capture,
    });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader.mock.calls[0]?.[0]).toMatchObject({
      requestContext: { snapshot: { sourcePolicyVersion: "source-policy-v1" } },
      accessScope: { includePublic: true },
    });
    expect(capture).toHaveBeenCalledWith([]);
    expect(setCachedSearch).not.toHaveBeenCalled();
  });
  it("routes selected server cohorts through one identity-invariant v3 public population", async () => {
    const {
      searchChunksWithTelemetry,
      calls,
      setCachedSearch,
      attachDocumentRankingMetadata,
      attachPageVisualEvidence,
    } = await loadHarness();

    const resultIds = [];
    for (const ownerId of [undefined, "user-a", "administrator-a"]) {
      const result = await searchChunksWithTelemetry({
        query: "What is clozapine?",
        ownerId,
        allowGlobalSearch: true,
        skipCache: true,
        ragQueryPlanMode: "canary",
        ragContextSnapshotInput: snapshotInput,
        governedCorpusComponents: { siteContent: true, australianAugmentation: true, australianCurrent: true },
      });
      resultIds.push(result.results.map(({ document_id }) => document_id));
    }

    expect(resultIds[1]).toEqual(resultIds[0]);
    expect(resultIds[2]).toEqual(resultIds[0]);
    expect(calls).toHaveLength(6);
    expect(calls.map(({ args }) => args.query_text)).toEqual(Array(6).fill("clozapine"));
    expect(calls.map(({ args }) => args.corpus_scopes)).toEqual(
      Array.from({ length: 3 }, () => [
        ["uploaded_local", "clinical_kb_site", "australian_public"],
        ["international_supplementary"],
      ]).flat(),
    );
    expect(calls.every(({ name }) => name === "match_document_chunks_hybrid_v3")).toBe(true);
    expect(calls.every(({ args }) => args.owner_filter === "00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(calls.every(({ args }) => args.include_public === true)).toBe(true);
    expect(calls.some(({ name }) => /_v2$/.test(name) || !/_v3$/.test(name))).toBe(false);
    expect(attachDocumentRankingMetadata).toHaveBeenCalledTimes(3);
    expect(attachDocumentRankingMetadata.mock.calls.every((call) => call[2] === undefined)).toBe(true);
    expect(attachPageVisualEvidence).toHaveBeenCalledTimes(3);
    expect(setCachedSearch).not.toHaveBeenCalled();
  });

  it("uses v3 vector fallback with the same document filter and never falls through to v2", async () => {
    const { searchChunksWithTelemetry, calls } = await loadHarness();
    const controller = new AbortController();

    await searchChunksWithTelemetry({
      query: "Clozapine monitoring guideline",
      documentId: "11111111-1111-4111-8111-111111111111",
      ownerId: "user-a",
      skipCache: true,
      forceEmbedding: true,
      signal: controller.signal,
      ragQueryPlanMode: "canary",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
    });

    expect(calls.map(({ name }) => name)).toEqual(["match_document_chunks_v3"]);
    expect(calls[0]?.args.document_filter).toBe("11111111-1111-4111-8111-111111111111");
    expect(calls.every(({ name }) => name.endsWith("_v3"))).toBe(true);
  });

  it("falls back from hybrid only to vector v3 inside the shared candidate budget", async () => {
    const { searchChunksWithTelemetry, calls } = await loadHarness({ hybridError: true });

    await searchChunksWithTelemetry({
      query: "What is clozapine?",
      allowGlobalSearch: true,
      skipCache: true,
      ragQueryPlanMode: "canary",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
    });

    expect(calls.map(({ name }) => name)).toEqual(["match_document_chunks_hybrid_v3", "match_document_chunks_v3"]);
  });

  it("fails a missing candidate RPC closed at the production entrypoint without legacy fallback", async () => {
    const { searchChunksWithTelemetry, calls } = await loadHarness({ missingV3: true });

    const result = await searchChunksWithTelemetry({
      query: "What is clozapine?",
      allowGlobalSearch: true,
      skipCache: true,
      ragQueryPlanMode: "canary",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
    });

    expect(result.results).toEqual([]);
    expect(calls.map(({ name }) => name)).toEqual(["match_document_chunks_hybrid_v3"]);
  });

  it("keeps shadow v2 results as the control while its bounded candidate lane is v3-only", async () => {
    const { searchChunksWithTelemetry, calls, setCachedSearch } = await loadHarness({
      candidateRows: [
        { ...governedRow("governed-row", "uploaded_local"), document_id: "11111111-1111-4111-8111-111111111111" },
      ],
    });

    const result = await searchChunksWithTelemetry({
      query: "What is clozapine?",
      documentId: "11111111-1111-4111-8111-111111111111",
      ownerId: "user-a",
      lexicalOnly: true,
      skipCache: true,
      ragQueryPlanMode: "shadow",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
    });

    const candidateCalls = calls.filter(({ name }) => name.endsWith("_v3"));
    const controlCalls = calls.filter(({ name }) => name.endsWith("_v2"));
    expect(candidateCalls.map(({ name }) => name)).toEqual(["match_document_chunks_text_v3"]);
    expect(candidateCalls[0]?.args.document_filters).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(controlCalls.length).toBeGreaterThan(0);
    expect(result.results).toEqual([]);
    expect(["completed", "cancelled"]).toContain(result.telemetry.shadow_retrieval_state);
    expect(calls.filter(({ name }) => /^match_document_chunks(?:_text)?_v[23]$/.test(name)).length).toBeLessThanOrEqual(
      4,
    );
    expect(setCachedSearch).not.toHaveBeenCalled();
  });

  it("keeps the shadow candidate plan public and identity-invariant while preserving identity-scoped controls", async () => {
    const { searchChunksWithTelemetry, calls } = await loadHarness({ divergentCorpusGrounding: true });
    const candidateArgs: Record<string, unknown>[] = [];
    const candidateCounts = [];

    for (const ownerId of [undefined, "user-a", "administrator-a"]) {
      const callStart = calls.length;
      const result = await searchChunksWithTelemetry({
        query: "bipolar disorder",
        ownerId,
        allowGlobalSearch: true,
        lexicalOnly: true,
        skipCache: true,
        ragQueryPlanMode: "shadow",
        ragContextSnapshotInput: snapshotInput,
        governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
      });
      const requestCalls = calls.slice(callStart);
      candidateArgs.push(requestCalls.find(({ name }) => name === "match_document_chunks_text_v3")?.args ?? {});
      candidateCounts.push(result.telemetry.candidate_match_counts);
    }

    expect(candidateArgs[1]).toEqual(candidateArgs[0]);
    expect(candidateArgs[2]).toEqual(candidateArgs[0]);
    // Legacy latency differs by access scope; only completed shadow diagnostics are comparable.
    const completedCounts = candidateCounts.filter((counts) => counts !== undefined);
    for (const counts of completedCounts) expect(counts).toEqual(completedCounts[0]);
    const controlOwnerFilters = calls.filter(({ name }) => name.endsWith("_v2")).map(({ args }) => args.owner_filter);
    expect(controlOwnerFilters).toContain("user-a");
    expect(controlOwnerFilters).toContain("administrator-a");
  });

  it("propagates caller cancellation from the production v3 lane without issuing legacy retrieval", async () => {
    const { searchChunksWithTelemetry, calls, rpc } = await loadHarness();
    const controller = new AbortController();
    const reason = new DOMException("caller left governed retrieval", "AbortError");
    rpc.mockImplementationOnce((name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return {
        abortSignal: vi.fn(async (signal: AbortSignal) => {
          controller.abort(reason);
          signal.throwIfAborted();
          return { data: [], error: null };
        }),
      } as never;
    });

    await expect(
      searchChunksWithTelemetry({
        query: "What is clozapine?",
        allowGlobalSearch: true,
        skipCache: true,
        signal: controller.signal,
        ragQueryPlanMode: "canary",
        ragContextSnapshotInput: snapshotInput,
        governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
      }),
    ).rejects.toBe(reason);

    expect(calls.map(({ name }) => name)).toEqual(["match_document_chunks_hybrid_v3"]);
  });

  it("propagates caller cancellation during governed metadata hydration", async () => {
    const controller = new AbortController();
    const reason = new DOMException("caller left metadata hydration", "AbortError");
    const { searchChunksWithTelemetry, attachPageVisualEvidence } = await loadHarness({
      abortDuringMetadataHydration: { controller, reason },
    });

    await expect(
      searchChunksWithTelemetry({
        query: "What is clozapine?",
        allowGlobalSearch: true,
        skipCache: true,
        signal: controller.signal,
        ragQueryPlanMode: "canary",
        ragContextSnapshotInput: snapshotInput,
        governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
      }),
    ).rejects.toBe(reason);

    expect(attachPageVisualEvidence).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation during governed image hydration", async () => {
    const controller = new AbortController();
    const reason = new DOMException("caller left image hydration", "AbortError");
    const { searchChunksWithTelemetry, attachDocumentRankingMetadata } = await loadHarness({
      abortDuringImageHydration: { controller, reason },
    });

    await expect(
      searchChunksWithTelemetry({
        query: "What is clozapine?",
        allowGlobalSearch: true,
        skipCache: true,
        signal: controller.signal,
        ragQueryPlanMode: "canary",
        ragContextSnapshotInput: snapshotInput,
        governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
      }),
    ).rejects.toBe(reason);

    expect(attachDocumentRankingMetadata).toHaveBeenCalledOnce();
  });

  it("applies claim-role eligibility before final governed top-K", async () => {
    const wrongRole = Array.from({ length: 4 }, (_, index): GovernedTestRow => {
      const candidate = governedRow(`form-${index}`, "uploaded_local");
      return {
        ...candidate,
        content: "Clozapine maintenance treatment guidance.",
        hybrid_score: 0.99 - index * 0.01,
        similarity: 0.99 - index * 0.01,
        source_metadata: { ...candidate.source_metadata, source_role: "form_reference" },
      };
    });
    const guideline = governedRow("eligible-guideline", "uploaded_local");
    guideline.content = "Clozapine maintenance treatment guidance.";
    guideline.hybrid_score = 0.2;
    guideline.similarity = 0.2;
    guideline.source_metadata = { ...guideline.source_metadata, source_role: "local_guideline" };
    const { searchChunksWithTelemetry } = await loadHarness({ candidateRows: [...wrongRole, guideline] });

    const response = await searchChunksWithTelemetry({
      query: "What is clozapine maintenance treatment?",
      topK: 2,
      allowGlobalSearch: true,
      skipCache: true,
      lexicalOnly: true,
      ragQueryPlanMode: "canary",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: false, australianAugmentation: false, australianCurrent: false },
    });

    expect(response.results.map(({ id }) => id)).toContain("eligible-guideline");
    expect(response.results.map(({ id }) => id)).not.toContain("form-0");
  });

  it("collapses derivative lineage families before final governed top-K", async () => {
    const parentHash = "d".repeat(64);
    const derivatives = Array.from({ length: 3 }, (_, index): GovernedTestRow => {
      const candidate = governedRow(`derivative-${index}`, "clinical_kb_site");
      return {
        ...candidate,
        content: "Clinical KB clozapine medication record and product navigation.",
        hybrid_score: 0.99 - index * 0.01,
        similarity: 0.99 - index * 0.01,
        source_metadata: {
          ...candidate.source_metadata,
          source_role: "clinical_reference",
          content_hash: String(index + 1).repeat(64),
          site_content_logical_id: `medications:clozapine-${index}`,
          site_content_lineage: [
            { sourceId: "canonical-clozapine", sourceHash: parentHash, relationship: "derived_from" },
          ],
        },
      };
    });
    const independent = governedRow("independent-record", "clinical_kb_site");
    independent.content = "Clinical KB clozapine medication record and independent product navigation.";
    independent.hybrid_score = 0.2;
    independent.similarity = 0.2;
    independent.source_metadata = {
      ...independent.source_metadata,
      source_role: "clinical_reference",
      content_hash: "e".repeat(64),
      site_content_logical_id: "medications:clozapine-independent",
    };
    const { searchChunksWithTelemetry } = await loadHarness({ candidateRows: [...derivatives, independent] });

    const response = await searchChunksWithTelemetry({
      query: "Which Clinical KB clozapine medication record is available?",
      topK: 2,
      allowGlobalSearch: true,
      skipCache: true,
      lexicalOnly: true,
      ragQueryPlanMode: "canary",
      ragContextSnapshotInput: snapshotInput,
      governedCorpusComponents: { siteContent: true, australianAugmentation: false, australianCurrent: false },
    });

    expect(response.results).toHaveLength(2);
    expect(response.results.map(({ id }) => id)).toContain("independent-record");
    expect(response.results.filter(({ id }) => id.startsWith("derivative-"))).toHaveLength(1);
  });
});
