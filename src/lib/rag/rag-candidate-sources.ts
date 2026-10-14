import {
  publishedOriginalSectionMetadataForResult,
  type PublishedOriginalSectionPathFact,
  type RawPublishedOriginalRowObserver,
} from "@/lib/rag/rag-source-block";
import { isPublicDocument } from "@/lib/documents/is-public-document";
/**
 * rag-candidate-sources - candidate retrieval surfaces for the RAG search
 * waterfall, extracted verbatim from rag.ts (decomposition phase 1,
 * 2026-07-14; zero behavior change).
 *
 * Contents: the versioned-RPC plumbing (callVersionedRetrievalRpc + legacy
 * owner/public merge + RPC error/fan-out telemetry), the lexical chunk /
 * document-lookup / table-fact / embedding-field / index-unit candidate
 * searchers, the chunk hydrators for memory cards and signal matches, and
 * the memory-boost merge step. rag.ts re-exports the symbols its tests and
 * callers import from it.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  governedPublicRetrievalAccessScope,
  PUBLIC_OWNER_FILTER_SENTINEL,
  retrievalAccessScopeForArgs,
  retrievalAccessScopeKey,
  retrievalRpcScopeArgs,
  type RetrievalAccessScope,
} from "@/lib/owner-scope";
import {
  analyzeClinicalQuery,
  buildClinicalTextSearchQuery,
  normalizedClinicalSearchTokens,
} from "@/lib/clinical-search";
import { applyMemoryCardBoosts, fetchMemoryCardsForQuery } from "@/lib/deep-memory";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  RetrievalRowShapeError,
  assertEmbeddingFieldRows,
  assertIndexUnitRows,
  assertRetrievalRows,
  type EmbeddingFieldSignalRow,
  type IndexUnitSignalRow,
} from "@/lib/rag/rag-row-contracts";
import {
  firstVariantPoolIsStrong,
  maxTextRpcQueryVariants,
  relaxVariantToOrQuery,
  shouldRelaxWeakTextMatches,
} from "@/lib/rag/rag-retrieval-variants";
import type {
  GovernedCorpusComponents,
  GovernedCorpusRetrievalPhase,
  RetrievalCorpusScopePolicy,
  SearchTelemetry,
} from "@/lib/rag/rag-contracts";
import type { RagContextSnapshot } from "@/lib/site-content/site-content-contracts";
import { uncoveredRagSubquestions } from "@/lib/rag/rag-coverage";
import { committedIndexGeneration } from "@/lib/reindex-pipeline";
import { issueContextPackAdmissionReceipt } from "@/lib/rag/rag-context-admission";
import { isMissingRetrievalRpcError } from "@/lib/retrieval-rpc-rollout";
import { normalizeOptionalSourceMetadata, normalizeSourceMetadata } from "@/lib/source-metadata";
import { isReviewedTablePromotable } from "@/lib/table-review";
import type {
  DocumentIndexUnitMatch,
  DocumentMemoryCard,
  RagQueryPlan,
  SearchResult,
  SiteContentDomain,
  SourceCorpusScope,
} from "@/lib/types";

// P0.1: a hybrid RPC returning an error (vs zero rows) means the whole layer silently degraded.
// Previously every call site did `if (error || !data?.length) return []` and dropped the error on
// the floor, which is how the live schema drift (42702) went unnoticed. Log it structurally and,
// where telemetry is in scope, record the failing RPC + code so it shows up in rag_retrieval_logs.
export type SupabaseRpcError = { message?: string; code?: string; details?: string; hint?: string } | null;
type RpcResult<T> = Promise<{ data: T | null; error: SupabaseRpcError }>;
type AbortableRpc<T> = RpcResult<T> & {
  abortSignal?: (signal: AbortSignal) => RpcResult<T>;
};
type SupabaseRpcClient = {
  rpc: (name: string, rpcArgs: Record<string, unknown>) => AbortableRpc<unknown[]> | PromiseLike<unknown>;
};

const governedCorpusScopes = new Set<SourceCorpusScope>([
  "uploaded_local",
  "clinical_kb_site",
  "australian_public",
  "international_supplementary",
]);

type GovernedCandidateRpcRow = SearchResult & {
  corpus_scope: SourceCorpusScope;
  site_content_domain: SiteContentDomain | null;
  site_release_id?: string | null;
  site_change_epoch?: string | number | null;
  pending_exclusion_exact?: boolean | null;
};

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

/** Resolve bounded candidate phases without introducing an owner partition. */
export function retrievalCorpusScopes(policy: RetrievalCorpusScopePolicy): GovernedCorpusRetrievalPhase[] {
  const primary: SourceCorpusScope[] = ["uploaded_local"];
  if (policy.siteContentEnabled && ["current", "updating"].includes(policy.siteContentState)) {
    primary.push("clinical_kb_site");
  }
  if (policy.australianAugmentationEnabled && policy.australianCurrent) primary.push("australian_public");
  const phases: GovernedCorpusRetrievalPhase[] = [
    { corpusScopes: primary, accessScope: governedPublicRetrievalAccessScope(), phase: "primary" },
  ];
  if (policy.australianAugmentationEnabled && policy.australianCurrent) {
    phases.push({
      corpusScopes: ["international_supplementary"],
      accessScope: governedPublicRetrievalAccessScope(),
      phase: "supplementary",
    });
  }
  return phases;
}

/** Candidate v3 calls never downgrade to v2/legacy when the RPC is absent. */
export async function callGovernedRetrievalRpc<T extends unknown[] = unknown[]>(
  supabase: ReturnType<typeof createAdminClient>,
  name: "match_document_chunks_text_v3" | "match_document_chunks_hybrid_v3" | "match_document_chunks_v3",
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: T | null; error: SupabaseRpcError }> {
  throwIfAborted(signal);
  const client = supabase as unknown as SupabaseRpcClient;
  // Keep the finite v3 surface explicit so tenancy scans can inspect every RPC.
  // These calls must never enter the versioned dispatcher's legacy fallback.
  const pending = (
    name === "match_document_chunks_text_v3"
      ? client.rpc("match_document_chunks_text_v3", args)
      : name === "match_document_chunks_hybrid_v3"
        ? client.rpc("match_document_chunks_hybrid_v3", args)
        : client.rpc("match_document_chunks_v3", args)
  ) as AbortableRpc<T>;
  const result = await (signal && typeof pending.abortSignal === "function" ? pending.abortSignal(signal) : pending);
  throwIfAborted(signal);
  if (isMissingRetrievalRpcError(result.error)) return { data: [] as unknown as T, error: null };
  return result;
}

function siteSnapshotEligible(snapshot: RagContextSnapshot, enabled: boolean) {
  const site = snapshot.publicSiteContent;
  return (
    enabled &&
    (site.state === "current" || site.state === "updating") &&
    Boolean(site.releaseId && site.changeEpoch && site.releaseDigest && site.staticManifestDigest)
  );
}

function publicGovernedSourceMetadata(input: unknown) {
  const normalized = { ...normalizeSourceMetadata(input), uploaded_by: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) return normalized;
  const lineage = (input as Record<string, unknown>).site_content_lineage;
  if (!Array.isArray(lineage) || lineage.length > 32) return normalized;
  const safeLineage = lineage.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const value = entry as Record<string, unknown>;
    if (
      typeof value.sourceId !== "string" ||
      value.sourceId.length < 1 ||
      value.sourceId.length > 512 ||
      typeof value.sourceHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.sourceHash) ||
      (value.relationship !== "derived_from" && value.relationship !== "references")
    ) {
      return [];
    }
    return [{ sourceId: value.sourceId, sourceHash: value.sourceHash, relationship: value.relationship }];
  });
  return safeLineage.length === lineage.length ? { ...normalized, site_content_lineage: safeLineage } : normalized;
}

function sanitizeGovernedCandidateRows(args: {
  rows: unknown[];
  observeRawPublishedRow?: RawPublishedOriginalRowObserver;
  requestedScopes: SourceCorpusScope[];
  targetSiteDomains: SiteContentDomain[];
  snapshot: RagContextSnapshot;
}): SearchResult[] {
  try {
    assertRetrievalRows(args.rows, "governed_candidate_v3");
  } catch (error) {
    if (error instanceof RetrievalRowShapeError) return [];
    throw error;
  }
  const requestedScopes = new Set(args.requestedScopes);
  const requestedDomains = new Set(args.targetSiteDomains);
  const expectedReleaseId = args.snapshot.publicSiteContent.releaseId;
  const expectedChangeEpoch = args.snapshot.publicSiteContent.changeEpoch;
  return (args.rows as GovernedCandidateRpcRow[]).flatMap((row) => {
    if (!governedCorpusScopes.has(row.corpus_scope) || !requestedScopes.has(row.corpus_scope)) return [];
    if (row.source_metadata?.corpus_scope !== row.corpus_scope) return [];
    if (row.corpus_scope === "clinical_kb_site") {
      if (
        row.source_metadata?.source_kind !== "registry_record" ||
        !expectedReleaseId ||
        !expectedChangeEpoch ||
        row.site_release_id !== expectedReleaseId ||
        String(row.site_change_epoch) !== expectedChangeEpoch ||
        row.pending_exclusion_exact !== true ||
        !row.site_content_domain ||
        (requestedDomains.size > 0 && !requestedDomains.has(row.site_content_domain))
      ) {
        return [];
      }
    } else if (row.source_metadata?.source_kind !== "document" || row.site_content_domain !== null) {
      return [];
    }
    const { site_release_id, site_change_epoch, pending_exclusion_exact, context_pack_admission, ...publicRow } = row;
    void site_release_id;
    void site_change_epoch;
    void pending_exclusion_exact;
    void context_pack_admission;
    args.observeRawPublishedRow?.(row);
    const sanitized = { ...publicRow, source_metadata: publicGovernedSourceMetadata(publicRow.source_metadata) };
    return [
      row.corpus_scope === "clinical_kb_site"
        ? {
            ...sanitized,
            context_pack_admission: issueContextPackAdmissionReceipt({
              ownerId: null,
              sourcePolicyVersion: args.snapshot.sourcePolicyVersion,
              indexGeneration: null,
              document: null,
              siteContent: {
                releaseId: expectedReleaseId!,
                releaseDigest: args.snapshot.publicSiteContent.releaseDigest!,
                changeEpoch: expectedChangeEpoch!,
              },
            }),
          }
        : sanitized,
    ];
  });
}

type AdmissionHydrationRow = {
  id?: unknown;
  document_id?: unknown;
  index_generation_id?: unknown;
  documents?:
    | {
        owner_id?: unknown;
        status?: unknown;
        index_generation_id?: unknown;
        metadata?: unknown;
      }
    | Array<{
        owner_id?: unknown;
        status?: unknown;
        index_generation_id?: unknown;
        metadata?: unknown;
      }>;
};

async function attachDocumentContextPackAdmission(args: {
  supabase: ReturnType<typeof createAdminClient>;
  results: SearchResult[];
  snapshot: RagContextSnapshot;
}) {
  const documentResults = args.results.filter((result) => result.corpus_scope === "australian_public");
  if (!documentResults.length) return args.results;
  const client = args.supabase as unknown as {
    from?: (table: string) => {
      select: (columns: string) => {
        in: (column: string, values: string[]) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
      };
    };
  };
  if (typeof client.from !== "function") return args.results;
  try {
    const { data, error } = await client
      .from("document_chunks")
      .select("id,document_id,index_generation_id,documents!inner(owner_id,status,index_generation_id,metadata)")
      .in("id", [...new Set(documentResults.map((result) => result.id))]);
    if (error || !Array.isArray(data)) return args.results;
    const receiptByChunkId = new Map<string, ReturnType<typeof issueContextPackAdmissionReceipt>>();
    const resultByChunkId = new Map(documentResults.map((result) => [result.id, result] as const));
    for (const raw of data as AdmissionHydrationRow[]) {
      if (
        typeof raw.id !== "string" ||
        typeof raw.document_id !== "string" ||
        raw.index_generation_id !== args.snapshot.documentIndexGeneration ||
        resultByChunkId.get(raw.id)?.document_id !== raw.document_id
      )
        continue;
      const document = Array.isArray(raw.documents) ? raw.documents[0] : raw.documents;
      if (!document || document.status !== "indexed" || document.index_generation_id !== raw.index_generation_id)
        continue;
      const metadata =
        document.metadata && typeof document.metadata === "object" && !Array.isArray(document.metadata)
          ? (document.metadata as Record<string, unknown>)
          : null;
      if (
        !metadata ||
        metadata.corpus_scope !== "australian_public" ||
        metadata.publication_manifest_version !== 2 ||
        metadata.source_policy_version !== args.snapshot.sourcePolicyVersion ||
        metadata.publication_source_policy_version !== args.snapshot.sourcePolicyVersion ||
        metadata.publication_reviewed_index_generation_id !== raw.index_generation_id
      )
        continue;
      const ownerId =
        typeof document.owner_id === "string" && document.owner_id.trim() ? document.owner_id.trim() : null;
      receiptByChunkId.set(
        raw.id,
        issueContextPackAdmissionReceipt({
          ownerId,
          sourcePolicyVersion: args.snapshot.sourcePolicyVersion,
          indexGeneration: raw.index_generation_id,
          document: {
            corpusScope: "australian_public",
            documentId: raw.document_id,
            chunkId: raw.id,
          },
          siteContent: null,
        }),
      );
    }
    return args.results.map((result) => {
      if (result.corpus_scope !== "australian_public") return result;
      const receipt = receiptByChunkId.get(result.id);
      return receipt ? { ...result, context_pack_admission: receipt } : result;
    });
  } catch {
    return args.results;
  }
}

/** Execute bounded candidate-only corpus retrieval under one shared public scope. */
export async function searchGovernedCorpora(args: {
  supabase: ReturnType<typeof createAdminClient>;
  queryVariants: string[];
  queryPlan?: RagQueryPlan;
  retrievalMode?: "text" | "hybrid" | "vector";
  embedQuery?: (query: string, signal?: AbortSignal) => Promise<number[]>;
  documentFilters?: string[];
  matchCount: number;
  minSimilarity?: number;
  snapshot: RagContextSnapshot;
  components: GovernedCorpusComponents;
  targetSiteDomains: SiteContentDomain[];
  answerSourcePolicy?: "only_this_source" | "primary_plus_approved_supplements";
  /** @deprecated Supplementary retrieval derives from eligible uncovered subquestions. */
  internationalCoverageGap?: boolean;
  signal?: AbortSignal;
  maxRpcCalls?: number;
  onRpcCall?: () => void;
  observeRawPublishedRow?: RawPublishedOriginalRowObserver;
}): Promise<SearchResult[]> {
  throwIfAborted(args.signal);
  const targetSiteDomains = args.queryPlan?.siteDomainDecision === "inferred" ? [] : args.targetSiteDomains;
  const restricted = args.answerSourcePolicy === "only_this_source" || Boolean(args.documentFilters?.length);
  if (args.answerSourcePolicy === "only_this_source" && !args.documentFilters?.length) return [];
  const siteEligible = siteSnapshotEligible(args.snapshot, args.components.siteContent);
  const phases = retrievalCorpusScopes({
    siteContentEnabled: siteEligible,
    siteContentState: args.snapshot.publicSiteContent.state,
    australianAugmentationEnabled: args.components.australianAugmentation,
    australianCurrent: args.components.australianCurrent,
  });
  const originalQuery = args.queryVariants[0];
  if (!originalQuery) return [];
  const retrievalMode = args.retrievalMode ?? "text";
  let remainingRpcCalls = Math.max(1, Math.min(args.maxRpcCalls ?? maxTextRpcQueryVariants, maxTextRpcQueryVariants));
  let results: SearchResult[] = [];
  const rpcLanes: SearchResult[][] = [];
  const sharedArgs = (corpusScopes: SourceCorpusScope[]) => ({
    match_count: Math.max(1, Math.min(args.matchCount, 96)),
    owner_filter: PUBLIC_OWNER_FILTER_SENTINEL,
    include_public: true,
    corpus_scopes: corpusScopes,
    expected_site_release_id: siteEligible ? args.snapshot.publicSiteContent.releaseId : null,
    expected_site_release_digest: siteEligible ? args.snapshot.publicSiteContent.releaseDigest : null,
    expected_site_change_epoch: siteEligible ? args.snapshot.publicSiteContent.changeEpoch : null,
    site_content_domains: siteEligible && targetSiteDomains.length > 0 ? targetSiteDomains : null,
  });
  const consumeRpc = async (
    name: "match_document_chunks_text_v3" | "match_document_chunks_hybrid_v3" | "match_document_chunks_v3",
    rpcArgs: Record<string, unknown>,
    phase: GovernedCorpusRetrievalPhase,
  ) => {
    if (remainingRpcCalls <= 0) return { error: null as SupabaseRpcError, rows: [] as SearchResult[] };
    remainingRpcCalls -= 1;
    args.onRpcCall?.();
    const { data, error } = await callGovernedRetrievalRpc<GovernedCandidateRpcRow[]>(
      args.supabase,
      name,
      rpcArgs,
      args.signal,
    );
    const rows = data?.length
      ? sanitizeGovernedCandidateRows({
          rows: args.documentFilters?.length
            ? data.filter((row) => args.documentFilters!.includes(row.document_id))
            : data,
          observeRawPublishedRow: args.observeRawPublishedRow,
          requestedScopes: phase.corpusScopes,
          targetSiteDomains,
          snapshot: args.snapshot,
        })
      : [];
    if (rows.length > 0) rpcLanes.push(rows);
    results = mergeSearchResults(results, rows);
    return { error, rows };
  };
  const runQuery = async (phase: GovernedCorpusRetrievalPhase, queryText: string) => {
    throwIfAborted(args.signal);
    if (retrievalMode === "text") {
      return consumeRpc(
        "match_document_chunks_text_v3",
        { ...sharedArgs(phase.corpusScopes), query_text: queryText, document_filters: args.documentFilters ?? null },
        phase,
      );
    }
    let queryEmbedding: number[];
    try {
      if (!args.embedQuery) return { error: null as SupabaseRpcError, rows: [] as SearchResult[] };
      queryEmbedding = await args.embedQuery(queryText, args.signal);
      throwIfAborted(args.signal);
    } catch (error) {
      throwIfAborted(args.signal);
      return { error: { message: error instanceof Error ? error.message : String(error) }, rows: [] as SearchResult[] };
    }
    if (retrievalMode === "vector") {
      const filters = args.documentFilters?.length ? args.documentFilters : [undefined];
      for (const documentFilter of filters) {
        if (remainingRpcCalls <= 0) break;
        await consumeRpc(
          "match_document_chunks_v3",
          {
            ...sharedArgs(phase.corpusScopes),
            query_embedding: queryEmbedding as unknown as string,
            min_similarity: args.minSimilarity ?? 0.15,
            document_filter: documentFilter,
          },
          phase,
        );
      }
      return { error: null as SupabaseRpcError, rows: results };
    }
    const hybrid = await consumeRpc(
      "match_document_chunks_hybrid_v3",
      {
        ...sharedArgs(phase.corpusScopes),
        query_embedding: queryEmbedding as unknown as string,
        query_text: queryText,
        min_similarity: args.minSimilarity ?? 0.15,
        document_filters: args.documentFilters ?? null,
      },
      phase,
    );
    if (hybrid.error && remainingRpcCalls > 0) {
      const filters = args.documentFilters?.length ? args.documentFilters : [undefined];
      for (const documentFilter of filters) {
        if (remainingRpcCalls <= 0) break;
        await consumeRpc(
          "match_document_chunks_v3",
          {
            ...sharedArgs(phase.corpusScopes),
            query_embedding: queryEmbedding as unknown as string,
            min_similarity: args.minSimilarity ?? 0.15,
            document_filter: documentFilter,
          },
          phase,
        );
      }
    }
    return hybrid;
  };

  const primary = phases.find(({ phase }) => phase === "primary");
  const supplementary = restricted ? undefined : phases.find(({ phase }) => phase === "supplementary");
  if (primary) {
    await runQuery(primary, originalQuery);
    const primarySubquestionId = args.queryPlan?.subquestions[0]?.id;
    const attemptedSubquestionIds = new Set(primarySubquestionId ? [primarySubquestionId] : []);
    const attemptedQueries = new Set([buildClinicalTextSearchQuery(originalQuery)]);
    while (args.queryPlan) {
      const subquestion = uncoveredRagSubquestions(args.queryPlan, results).find(
        ({ id, question }) =>
          !attemptedSubquestionIds.has(id) && !attemptedQueries.has(buildClinicalTextSearchQuery(question)),
      );
      if (!subquestion) break;
      const reserveSupplementary = supplementary ? 1 : 0;
      if (remainingRpcCalls <= reserveSupplementary) break;
      attemptedSubquestionIds.add(subquestion.id);
      const queryText = buildClinicalTextSearchQuery(subquestion.question);
      attemptedQueries.add(queryText);
      await runQuery(primary, queryText);
    }
  }
  if (supplementary && remainingRpcCalls > 0) {
    const uncovered = args.queryPlan ? uncoveredRagSubquestions(args.queryPlan, results) : [];
    const subquestion = uncovered[0];
    if (subquestion) await runQuery(supplementary, buildClinicalTextSearchQuery(subquestion.question));
  }
  return attachDocumentContextPackAdmission({
    supabase: args.supabase,
    results: boundedRpcLaneResults(rpcLanes, results, Math.max(1, Math.min(args.matchCount, 96))),
    snapshot: args.snapshot,
  });
}

function boundedRpcLaneResults(lanes: readonly SearchResult[][], pool: SearchResult[], limit: number) {
  const betterById = new Map(pool.map((result) => [result.id, result]));
  const selected: SearchResult[] = [];
  const selectedIds = new Set<string>();
  const add = (result: SearchResult | undefined) => {
    const better = result ? betterById.get(result.id) : undefined;
    if (!better || selectedIds.has(better.id) || selected.length >= limit) return;
    selectedIds.add(better.id);
    selected.push(better);
  };
  for (const lane of lanes) {
    add(lane.find((result) => !selectedIds.has(result.id)));
  }
  const maxDepth = Math.max(0, ...lanes.map((lane) => lane.length));
  for (let depth = 0; depth < maxDepth && selected.length < limit; depth += 1) {
    for (const lane of lanes) add(lane[depth]);
  }
  return selected;
}

function legacyRankFields(versionedName: string) {
  if (versionedName === "match_document_chunks_v2") return ["similarity"];
  if (versionedName === "match_documents_for_query_v2") return ["text_rank"];
  if (versionedName.includes("_text_v2")) return ["hybrid_score", "text_rank"];
  return ["hybrid_score", "rrf_score", "similarity", "text_rank"];
}

function mergeLegacyAccessRows<T>(ownerRows: T[], publicRows: T[], matchCount: unknown, rankFields: string[]): T[] {
  const byKey = new Map<string, T>();
  const rowRecord = (row: T) => (row && typeof row === "object" ? (row as Record<string, unknown>) : {});
  const rowKey = (row: T) => String(rowRecord(row).id ?? rowRecord(row).document_id ?? "");
  const compare = (left: T, right: T) => {
    const leftRecord = rowRecord(left);
    const rightRecord = rowRecord(right);
    for (const field of rankFields) {
      const leftScore = typeof leftRecord[field] === "number" ? leftRecord[field] : Number.NEGATIVE_INFINITY;
      const rightScore = typeof rightRecord[field] === "number" ? rightRecord[field] : Number.NEGATIVE_INFINITY;
      if (leftScore !== rightScore) return rightScore - leftScore;
    }
    return rowKey(left).localeCompare(rowKey(right));
  };
  for (const row of [...ownerRows, ...publicRows]) {
    const key = rowKey(row) || `unkeyed:${byKey.size}`;
    const current = byKey.get(key);
    if (!current || compare(row, current) < 0) byKey.set(key, row);
  }
  const merged = [...byKey.values()].sort(compare);
  const limit = typeof matchCount === "number" ? Math.max(1, Math.min(matchCount, 100)) : merged.length;
  return merged.slice(0, limit);
}

/**
 * Executes a versioned Supabase retrieval RPC with transparent fallback to legacy RPCs and owner-scope merging.
 *
 * @param supabase - Authenticated or admin Supabase client
 * @param versionedName - The modern v2 RPC function name
 * @param legacyName - The legacy v1 RPC function name
 * @param args - RPC arguments
 * @param signal - Optional AbortSignal for query cancellation
 * @returns Object with retrieved data rows or error
 */
export async function callVersionedRetrievalRpc<T extends unknown[] = unknown[]>(
  supabase: ReturnType<typeof createAdminClient>,
  versionedName: string,
  legacyName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: T | null; error: SupabaseRpcError }> {
  const client = supabase as unknown as SupabaseRpcClient;
  const executeRpc = async (name: string, rpcArgs: Record<string, unknown>) => {
    const pending = client.rpc(name, rpcArgs) as AbortableRpc<T>;
    const pendingWithAbort =
      signal && typeof pending.abortSignal === "function" ? pending.abortSignal(signal) : pending;
    return await pendingWithAbort;
  };
  const versioned = await executeRpc(versionedName, args);
  if (versioned && !isMissingRetrievalRpcError(versioned.error)) return versioned;
  const legacyArgs = { ...args };
  delete legacyArgs.include_public;
  const ownerResult = await executeRpc(legacyName, legacyArgs);
  const ownerFilter = String(args.owner_filter ?? "");
  if (
    ownerResult.error ||
    args.include_public !== true ||
    !ownerFilter ||
    ownerFilter === PUBLIC_OWNER_FILTER_SENTINEL
  ) {
    return ownerResult;
  }
  const publicResult = await executeRpc(legacyName, {
    ...legacyArgs,
    owner_filter: PUBLIC_OWNER_FILTER_SENTINEL,
  });
  if (publicResult.error) return publicResult;
  return {
    data: mergeLegacyAccessRows(
      ownerResult.data ?? [],
      publicResult.data ?? [],
      args.match_count,
      legacyRankFields(versionedName),
    ) as T,
    error: null,
  };
}

/**
 * Logs and attaches telemetry for Supabase hybrid retrieval RPC errors.
 *
 * @param telemetry - Telemetry bucket to record error into
 * @param rpc - Name of the failing RPC
 * @param error - Supabase RPC error object
 */
export function recordHybridRpcError(telemetry: SearchTelemetry | undefined, rpc: string, error: SupabaseRpcError) {
  if (!error) return;
  const code = error.code ?? "unknown";
  logger.error("hybrid_rpc_failed", { rpc, code, message: error.message, hint: error.hint });
  if (telemetry) {
    telemetry.hybrid_rpc_errors = {
      ...(telemetry.hybrid_rpc_errors ?? {}),
      [rpc]: code,
    };
  }
}

/** Index-unit consumers read these provenance fields as maps; retain that output contract. */
function optionalJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Record how many variant RPCs a lexical surface actually issued (PT-02 early-exit). */
function recordTextVariantFanout(
  telemetry: SearchTelemetry | undefined,
  rpc: string,
  calls: number,
  earlyExit: boolean,
) {
  if (!telemetry) return;
  telemetry.text_variant_rpc_calls = {
    ...(telemetry.text_variant_rpc_calls ?? {}),
    [rpc]: calls,
  };
  if (earlyExit) telemetry.text_variant_early_exit = true;
}

/**
 * Merges primary and secondary search results, preserving the highest score per chunk ID.
 *
 * @param primary - Primary search results
 * @param secondary - Secondary search results
 * @returns Deduplicated array of merged search results
 */
export function mergeSearchResults(primary: SearchResult[], secondary: SearchResult[]) {
  const merged = new Map<string, SearchResult>();

  for (const result of [...primary, ...secondary]) {
    const existing = merged.get(result.id);
    if (!existing) {
      merged.set(result.id, result);
      continue;
    }

    const existingScore = existing.hybrid_score ?? existing.similarity;
    const resultScore = result.hybrid_score ?? result.similarity;
    merged.set(result.id, resultScore > existingScore ? result : existing);
  }

  return Array.from(merged.values());
}

/**
 * Retrieves lexical document chunk candidates for the supplied query variants.
 *
 * @param queryVariants - Query variants used for strict matching and recall-oriented fallback searches.
 * @param matchCount - Maximum number of candidates requested for the primary query.
 * @param telemetry - Optional retrieval telemetry updated with RPC failures and text-relaxation usage.
 * @returns Matching document chunks, using corrected or relaxed queries when strict matching produces no candidates.
 */
/** Read only an absent path into the request-local observer; candidate rows remain untouched. */
async function observePublishedTextRows(args: {
  supabase: ReturnType<typeof createAdminClient>;
  rows: SearchResult[];
  accessScope: RetrievalAccessScope;
  signal?: AbortSignal;
  observeRawPublishedRow: RawPublishedOriginalRowObserver;
}) {
  throwIfAborted(args.signal);
  const needed: { row: SearchResult; generation: string }[] = [];
  for (const row of args.rows) {
    if (Object.hasOwn(row, "section_path")) {
      args.observeRawPublishedRow(row);
      continue;
    }
    try {
      const facts = publishedOriginalSectionMetadataForResult(row);
      needed.push({ row, generation: facts.index_generation_id as string });
    } catch {
      // The observer keeps ordinary rows ordinary and makes malformed V2 receipts unusable.
      args.observeRawPublishedRow(row);
    }
  }
  if (!needed.length) return;
  const pathFacts = new Map<string, PublishedOriginalSectionPathFact | null>();
  const rowKey = (row: { document_id: string; id: string }) => JSON.stringify([row.document_id, row.id]);
  try {
    if (args.accessScope.includePublic) {
      const documentIds = [...new Set(needed.map(({ row }) => row.document_id))];
      const documentQuery = args.supabase
        .from("documents")
        .select("id,owner_id,status,metadata")
        .in("id", documentIds)
        .eq("status", "indexed")
        .is("owner_id", null)
        .limit(documentIds.length);
      const { data: documents, error: documentError } = await (args.signal
        ? documentQuery.abortSignal(args.signal)
        : documentQuery);
      throwIfAborted(args.signal);
      if (!documentError && documents) {
        const publicDocuments = new Map<string, string | null>();
        for (const document of documents) {
          if (!document || document.owner_id !== null || document.status !== "indexed" || !isPublicDocument(document))
            continue;
          const generation = committedIndexGeneration(document.metadata);
          if (publicDocuments.has(document.id)) publicDocuments.set(document.id, null);
          else publicDocuments.set(document.id, generation);
        }
        const eligible = needed.filter(({ row, generation }) => publicDocuments.get(row.document_id) === generation);
        if (eligible.length) {
          const chunkIds = [...new Set(eligible.map(({ row }) => row.id))];
          const eligibleDocumentIds = [...new Set(eligible.map(({ row }) => row.document_id))];
          const chunkQuery = args.supabase
            .from("document_chunks")
            .select("id,document_id,index_generation_id,content,section_path")
            .in("id", chunkIds)
            .in("document_id", eligibleDocumentIds)
            .limit(chunkIds.length);
          const { data: chunks, error: chunkError } = await (args.signal
            ? chunkQuery.abortSignal(args.signal)
            : chunkQuery);
          throwIfAborted(args.signal);
          if (!chunkError && chunks) {
            const expected = new Map(eligible.map((item) => [rowKey(item.row), item]));
            for (const chunk of chunks) {
              const key = rowKey(chunk),
                match = expected.get(key);
              if (!match) continue;
              if (pathFacts.has(key)) {
                pathFacts.set(key, null);
                continue;
              }
              if (
                chunk.index_generation_id !== match.generation ||
                chunk.content !== match.row.content ||
                !Array.isArray(chunk.section_path) ||
                !chunk.section_path.every((part) => typeof part === "string")
              ) {
                pathFacts.set(key, null);
                continue;
              }
              pathFacts.set(
                key,
                Object.freeze({
                  id: chunk.id,
                  document_id: chunk.document_id,
                  index_generation_id: chunk.index_generation_id,
                  content: chunk.content,
                  section_path: Object.freeze([...chunk.section_path]),
                }),
              );
            }
          }
        }
      }
    }
  } catch {
    // Preserve cancellation. Read/refusal failures cannot supply a factual path to a selected row.
    throwIfAborted(args.signal);
  }
  throwIfAborted(args.signal);
  for (const { row } of needed) args.observeRawPublishedRow(row, pathFacts.get(rowKey(row)) ?? null);
}

export async function searchTextChunkCandidates(args: {
  supabase: ReturnType<typeof createAdminClient>;
  queryVariants: string[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  allowGlobalSearch?: boolean;
  matchCount: number;
  telemetry?: SearchTelemetry;
  signal?: AbortSignal;
  observeRawPublishedRow?: RawPublishedOriginalRowObserver;
}) {
  const runChunkText = async (queryText: string, matchCount: number) => {
    const accessScope = retrievalAccessScopeForArgs(args);
    const { data, error } = await callVersionedRetrievalRpc<SearchResult[]>(
      args.supabase,
      "match_document_chunks_text_v2",
      "match_document_chunks_text",
      {
        query_text: queryText,
        match_count: matchCount,
        document_filters: args.documentIds ?? undefined,
        ...retrievalRpcScopeArgs(accessScope),
      },
      args.signal,
    );
    // Report the error before returning empty so a schema drift on this
    // most-terminal lexical layer surfaces in hybrid_rpc_errors telemetry
    // instead of silently degrading to zero candidates. Return value unchanged.
    if (error) recordHybridRpcError(args.telemetry, "match_document_chunks_text", error);
    if (error || !data?.length) return [] as SearchResult[];
    assertRetrievalRows(data, "match_document_chunks_text");
    if (args.observeRawPublishedRow) {
      await observePublishedTextRows({
        supabase: args.supabase,
        rows: data,
        accessScope,
        signal: args.signal,
        observeRawPublishedRow: args.observeRawPublishedRow,
      });
    }
    return data;
  };

  const variants = args.queryVariants.slice(0, maxTextRpcQueryVariants);
  const [primaryVariant, ...siblingVariants] = variants;
  const primaryResults = primaryVariant === undefined ? [] : await runChunkText(primaryVariant, args.matchCount);
  // PT-02: skip the near-duplicate sibling variants when the primary pool is
  // already deep and anchored by a precise hit; weak/empty pools keep the full
  // fan-out (one extra sequential hop) so recall is unchanged where it matters.
  const skipSiblings = siblingVariants.length > 0 && firstVariantPoolIsStrong(primaryResults, args.matchCount);
  const resultSets = skipSiblings
    ? [primaryResults]
    : [
        primaryResults,
        ...(await Promise.all(siblingVariants.map((variant) => runChunkText(variant, Math.min(args.matchCount, 32))))),
      ];
  recordTextVariantFanout(args.telemetry, "match_document_chunks_text", resultSets.length, skipSiblings);
  const merged = resultSets.reduce(
    (accumulated, resultSet) => mergeSearchResults(resultSet, accumulated),
    [] as SearchResult[],
  );
  if (args.telemetry) args.telemetry.text_or_relaxation_used = "none";
  if (merged.length > 0) {
    // P8b extension: strict-AND matched, but weakly. Append OR-relaxed recall behind the
    // strict matches so a buried chunk can enter the candidate pool without displacing any
    // precise match (mergeSearchResults keeps primary/strict precedence). Trigram correction
    // is not run here — it exists to rescue *empty* strict retrieval (RC6), and correcting a
    // query that already matched would second-guess a working query.
    if (env.RAG_TEXT_WEAK_OR_RELAXATION && shouldRelaxWeakTextMatches(merged)) {
      const weakRelaxed = relaxVariantToOrQuery(variants[0] ?? "");
      if (weakRelaxed) {
        const orResults = await runChunkText(weakRelaxed, Math.min(args.matchCount, 24));
        if (orResults.length > 0) {
          if (args.telemetry) args.telemetry.text_or_relaxation_used = "weak_augment";
          return mergeSearchResults(merged, orResults);
        }
      }
    }
    return merged;
  }

  // Strict AND variants matched nothing. Two fallbacks, in order:
  //   (item 10, RC6) a typo the hard-coded map misses can block an otherwise-precise query — so first
  //     trigram-correct against the known clinical-term vocabulary and retry the corrected query
  //     STRICTLY. This must run before OR-relaxation: otherwise a query like "clozapin monitoring"
  //     would OR-match generic "monitoring" docs and never surface the intended clozapine result.
  //   (8b) then OR-relax the best query we have to recover recall for long multi-term queries.
  // Both are reached only when every prior attempt was empty, so neither overrides a precise match.
  const primary = variants[0] ?? "";
  let effectivePrimary = primary;
  if (primary) {
    const { data: corrected } = await args.supabase.rpc("correct_clinical_query_terms", {
      input_query: primary,
      min_sim: 0.45,
    });
    if (typeof corrected === "string" && corrected && corrected !== primary) {
      const correctedResults = await runChunkText(corrected, args.matchCount);
      if (correctedResults.length > 0) return correctedResults;
      effectivePrimary = corrected;
    }
  }

  const relaxed = relaxVariantToOrQuery(effectivePrimary);
  if (relaxed) {
    const relaxedResults = await runChunkText(relaxed, args.matchCount);
    if (relaxedResults.length > 0) {
      if (args.telemetry) args.telemetry.text_or_relaxation_used = "empty_fallback";
      return relaxedResults;
    }
  }
  return merged;
}

type DocumentLookupRow = {
  id: string;
  owner_id?: string | null;
  title: string;
  file_name: string;
  status?: string;
  page_count?: number;
  chunk_count?: number;
  image_count?: number;
  metadata?: unknown;
  text_rank?: number;
  match_reason?: string;
};

type DocumentLookupChunkRow = {
  id: string;
  document_id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  section_path?: string[] | null;
  heading_level?: number | null;
  parent_heading?: string | null;
  anchor_id?: string | null;
  content: string;
  retrieval_synopsis?: string | null;
  image_ids: string[] | null;
  text_rank?: number | null;
};

export type ChunkSignalMatch = {
  chunkId: string;
  similarity: number;
  textRank: number;
  hybridScore: number;
  reason: string;
  fieldType?: string | null;
  tableFacts?: Array<{
    id: string;
    document_id: string;
    source_chunk_id: string | null;
    source_image_id: string | null;
    page_number: number | null;
    table_title: string | null;
    row_label: string | null;
    clinical_parameter: string | null;
    threshold_value: string | null;
    action: string | null;
    text_rank?: number | null;
    match_reason?: string | null;
  }>;
  indexUnit?: DocumentIndexUnitMatch | null;
};

type TableFactRpcRow = {
  id: string;
  document_id: string;
  source_chunk_id: string | null;
  source_image_id: string | null;
  page_number: number | null;
  table_title: string | null;
  row_label: string | null;
  clinical_parameter: string | null;
  threshold_value: string | null;
  action: string | null;
  text_rank?: number | null;
  match_reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Document lookup chunk terms. */
function documentLookupChunkTerms(query: string) {
  const shortClinicalTerms = new Set(["ed", "im", "po", "pt"]);
  return normalizedClinicalSearchTokens(query)
    .filter((term) => term.length >= 3 || shortClinicalTerms.has(term))
    .slice(0, 8);
}

/** Document lookup chunk score. */
function documentLookupChunkScore(chunk: DocumentLookupChunkRow, terms: string[]) {
  if (terms.length === 0) return 0;
  const heading = chunk.section_heading?.toLowerCase() ?? "";
  const content = `${chunk.retrieval_synopsis ?? ""} ${chunk.content}`.toLowerCase();
  const matched = terms.filter((term) => heading.includes(term) || content.includes(term));
  const coverage = matched.length / terms.length;
  const headingHits = matched.filter((term) => heading.includes(term)).length;
  return coverage + headingHits * 0.08 + Math.max(0, 0.08 - chunk.chunk_index * 0.0005);
}

/** Fetch best document lookup chunks. */
async function fetchBestDocumentLookupChunks(args: {
  supabase: ReturnType<typeof createAdminClient>;
  documentIds: string[];
  query: string;
  limit: number;
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  allowGlobalSearch?: boolean;
  signal?: AbortSignal;
}) {
  const terms = documentLookupChunkTerms(args.query);
  const { data: rpcChunks, error: rpcError } = await callVersionedRetrievalRpc(
    args.supabase,
    "match_document_lookup_chunks_text_v2",
    "match_document_lookup_chunks_text",
    {
      query_text: args.query,
      document_filters: args.documentIds ?? undefined,
      match_count: Math.max(args.limit * 3, 24),
      ...retrievalRpcScopeArgs(retrievalAccessScopeForArgs(args)),
    },
    args.signal,
  );
  if (!rpcError && rpcChunks?.length) {
    const ranked = (rpcChunks as DocumentLookupChunkRow[])
      .map((chunk) => ({
        chunk,
        score: Math.max(Number(chunk.text_rank ?? 0), documentLookupChunkScore(chunk, terms)),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index)
      .map((item) => item.chunk);
    if (ranked.length) return { chunks: ranked.slice(0, args.limit), terms };
  }

  const safeFilters = terms
    .map((term) => term.replace(/[%_,]/g, " ").trim())
    .filter(Boolean)
    .flatMap((term) => [
      `content.ilike.%${term}%`,
      `retrieval_synopsis.ilike.%${term}%`,
      `section_heading.ilike.%${term}%`,
    ])
    .join(",");
  const baseQuery = args.supabase
    .from("document_chunks")
    .select(
      "id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,image_ids",
    )
    .in("document_id", args.documentIds)
    .limit(Math.max(args.limit * 4, 24));

  const { data: matchedChunks, error: matchedError } = safeFilters
    ? await baseQuery.or(safeFilters)
    : await baseQuery.order("chunk_index", { ascending: true });

  if (!matchedError && matchedChunks?.length) {
    const ranked = (matchedChunks as DocumentLookupChunkRow[])
      .map((chunk) => ({ chunk, score: documentLookupChunkScore(chunk, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index)
      .map((item) => item.chunk);
    if (ranked.length) return { chunks: ranked.slice(0, args.limit), terms };
  }

  const fallbackQuery = args.supabase
    .from("document_chunks")
    .select(
      "id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,image_ids",
    )
    .in("document_id", args.documentIds)
    .order("chunk_index", { ascending: true })
    .limit(args.limit);
  const { data: fallbackChunks, error: fallbackError } = await fallbackQuery;
  if (fallbackError || !fallbackChunks?.length) return { chunks: [] as DocumentLookupChunkRow[], terms };
  return { chunks: fallbackChunks as DocumentLookupChunkRow[], terms };
}

/** Fetch document title alias rows. */
async function fetchDocumentTitleAliasRows(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
}) {
  const terms = analyzeClinicalQuery(args.query)
    .documentTitleTerms.map((term) => term.replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim())
    .filter((term) => term.length >= 4)
    .slice(0, 8);
  if (!terms.length) return [] as DocumentLookupRow[];

  const filters = terms.flatMap((term) => [`title.ilike.%${term}%`, `file_name.ilike.%${term}%`]).join(",");
  let query = args.supabase
    .from("documents")
    .select("id,owner_id,title,file_name,status,page_count,chunk_count,image_count,metadata");
  if (typeof (query as { or?: unknown }).or !== "function") return [] as DocumentLookupRow[];
  query = query.or(filters).eq("status", "indexed").limit(12);
  const accessScope = retrievalAccessScopeForArgs(args);
  if (accessScope.ownerId && accessScope.includePublic) {
    query = query.or(`owner_id.eq.${accessScope.ownerId},owner_id.is.null`);
  } else if (accessScope.ownerId) {
    query = query.eq("owner_id", accessScope.ownerId);
  } else {
    query = query.is("owner_id", null);
  }
  if (args.documentIds?.length) query = query.in("id", args.documentIds);

  const { data, error } = await query;
  if (error || !data?.length) return [] as DocumentLookupRow[];

  return (data as DocumentLookupRow[]).map((document) => ({
    ...document,
    text_rank: Math.max(Number(document.text_rank ?? 0), 0.34),
    match_reason: document.match_reason ?? "title_alias",
  }));
}

/**
 * Retrieves and ranks document chunks for document-focused queries.
 *
 * @param args - Search configuration, including the required owner scope and optional document restrictions.
 * @returns Ranked document lookup results, limited to `matchCount`.
 */
export async function searchDocumentLookupFastPath(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  queryVariants?: string[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  matchCount: number;
  telemetry?: SearchTelemetry;
  signal?: AbortSignal;
}): Promise<SearchResult[]> {
  if (!args.ownerId) return [] as SearchResult[];
  const variants = (args.queryVariants?.length ? args.queryVariants : [buildClinicalTextSearchQuery(args.query)]).slice(
    0,
    maxTextRpcQueryVariants,
  );
  const runDocumentLookup = async (variant: string, matchCount: number) => {
    const { data, error } = await callVersionedRetrievalRpc(
      args.supabase,
      "match_documents_for_query_v2",
      "match_documents_for_query",
      {
        query_text: variant,
        match_count: matchCount,
        ...retrievalRpcScopeArgs(retrievalAccessScopeForArgs(args)),
      },
      args.signal,
    );
    if (error) recordHybridRpcError(args.telemetry, "match_documents_for_query", error);
    if (error || !data?.length) return [] as DocumentLookupRow[];
    return data as DocumentLookupRow[];
  };
  // Independent of the lookup RPCs, so it runs alongside them instead of adding a serial round trip.
  const titleAliasDocumentsPromise = fetchDocumentTitleAliasRows({
    supabase: args.supabase,
    query: args.query,
    ownerId: args.ownerId,
    accessScope: args.accessScope,
    documentIds: args.documentIds,
  });
  // Keeps an early abort in the lookups below from also surfacing as an unhandled rejection here.
  titleAliasDocumentsPromise.catch(() => undefined);
  const [primaryVariant, ...siblingVariants] = variants;
  const primaryDocuments = primaryVariant === undefined ? [] : await runDocumentLookup(primaryVariant, 12);
  const skipSiblings = siblingVariants.length > 0 && firstVariantPoolIsStrong(primaryDocuments, 12);
  const documentSets = skipSiblings
    ? [primaryDocuments]
    : [primaryDocuments, ...(await Promise.all(siblingVariants.map((variant) => runDocumentLookup(variant, 8))))];
  recordTextVariantFanout(args.telemetry, "match_documents_for_query", documentSets.length, skipSiblings);
  const titleAliasDocuments = await titleAliasDocumentsPromise;
  const documentsById = new Map<string, DocumentLookupRow>();
  for (const document of [...titleAliasDocuments, ...documentSets.flat()]) {
    const existing = documentsById.get(document.id);
    if (!existing || Number(document.text_rank ?? 0) > Number(existing.text_rank ?? 0)) {
      documentsById.set(document.id, document);
    }
  }
  const documents = Array.from(documentsById.values());
  if (!documents.length) return [];

  const allowedDocuments = args.documentIds?.length ? new Set(args.documentIds) : null;
  const rankedDocuments = (documents as DocumentLookupRow[])
    .filter((document) => !allowedDocuments || allowedDocuments.has(document.id))
    .map((document) => ({
      document,
      score: Math.min(0.34, Number(document.text_rank ?? 0)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (rankedDocuments.length === 0) return [];

  const documentById = new Map(rankedDocuments.map((item) => [item.document.id, item.document]));
  const scoreByDocument = new Map(rankedDocuments.map((item) => [item.document.id, item.score]));
  // Expanded variants are intentionally broad enough to find a document, but
  // can discard intent-bearing words needed to choose a chunk inside it (for
  // example "documentation required" -> "mental health discharge"). Keep the
  // raw wording for explicit variant fanout except for the measured clozapine
  // blood-count threshold shape whose source rows use WBC/ANC and stop/cease
  // rather than the user's FBC and withhold wording.
  const useExpandedBloodCountQuery =
    Boolean(args.queryVariants?.length && primaryVariant) &&
    /\bclozapin(?:e)?\b/i.test(args.query) &&
    /\b(?:fbc|wbc|anc|blood\s+count|neutrophils?)\b/i.test(args.query) &&
    /\b(?:wbc|anc|neutrophils?)\b/i.test(primaryVariant ?? "") &&
    /\b(?:withhold|cease|stop|red\s+range)\b/i.test(primaryVariant ?? "");
  const chunkQuery = useExpandedBloodCountQuery
    ? (primaryVariant ?? args.query)
    : args.queryVariants?.length
      ? args.query
      : (primaryVariant ?? args.query);
  const { chunks, terms } = await fetchBestDocumentLookupChunks({
    supabase: args.supabase,
    documentIds: rankedDocuments.map((item) => item.document.id),
    query: chunkQuery,
    limit: Math.max(args.matchCount, rankedDocuments.length * 4),
    ownerId: args.ownerId,
    accessScope: args.accessScope,
    signal: args.signal,
  });

  if (!chunks.length) return [];

  const results: SearchResult[] = [];
  for (const chunk of chunks) {
    const document = documentById.get(chunk.document_id);
    if (!document) continue;
    const documentScore = scoreByDocument.get(chunk.document_id) ?? 0;
    const chunkScore = documentLookupChunkScore(chunk, terms);
    // Not a cosine: fabricated from title/label match strength (RC9 — tagged below).
    const similarity = Math.min(0.92, 0.58 + documentScore + Math.min(0.12, chunkScore * 0.08));
    results.push({
      similarity_origin: "synthetic_text",
      id: chunk.id,
      document_id: chunk.document_id,
      title: document.title,
      file_name: document.file_name,
      page_number: chunk.page_number,
      chunk_index: chunk.chunk_index,
      section_heading: chunk.section_heading,
      section_path: chunk.section_path ?? [],
      heading_level: chunk.heading_level ?? null,
      parent_heading: chunk.parent_heading ?? null,
      anchor_id: chunk.anchor_id ?? null,
      content: chunk.content,
      retrieval_synopsis: chunk.retrieval_synopsis ?? null,
      image_ids: chunk.image_ids ?? [],
      source_metadata: normalizeOptionalSourceMetadata(document.metadata),
      similarity,
      text_rank: documentScore,
      hybrid_score: Math.min(0.94, similarity + 0.02),
      images: [],
    });
  }

  return results
    .sort(
      (a, b) => (b.hybrid_score ?? b.similarity) - (a.hybrid_score ?? a.similarity) || a.chunk_index - b.chunk_index,
    )
    .slice(0, args.matchCount);
}

/**
 * Computes the normalized score for a memory card candidate chunk.
 *
 * @param card - Document memory card with hybrid score or confidence
 * @returns Number between 0 and 1
 */
export function memoryCardChunkScore(card: DocumentMemoryCard) {
  const hybridScore = Number(card.metadata?.memory_hybrid_score);
  if (Number.isFinite(hybridScore) && hybridScore > 0) return Math.min(1, hybridScore);
  return Math.min(1, card.confidence ?? 0.5);
}

/**
 * Loads and attaches chunk content and document metadata for matched memory cards.
 *
 * @param supabase - Admin Supabase client
 * @param cards - Array of memory cards to fetch chunks for
 * @param accessScope - Current tenant / owner visibility scope
 * @returns Search results corresponding to the memory cards
 */
export async function loadChunksForMemoryCards(
  supabase: ReturnType<typeof createAdminClient>,
  cards: DocumentMemoryCard[],
  accessScope: RetrievalAccessScope,
) {
  const documentIds = Array.from(new Set(cards.map((card) => card.document_id))).slice(0, 80);
  if (documentIds.length === 0) return [] as SearchResult[];
  let documentQuery = supabase
    .from("documents")
    .select("id,title,file_name,metadata,owner_id,status")
    .in("id", documentIds)
    .eq("status", "indexed");
  if (accessScope.ownerId && accessScope.includePublic) {
    documentQuery = documentQuery.or(`owner_id.eq.${accessScope.ownerId},owner_id.is.null`);
  } else if (accessScope.ownerId) {
    documentQuery = documentQuery.eq("owner_id", accessScope.ownerId);
  } else {
    documentQuery = documentQuery.is("owner_id", null);
  }
  const chunkColumns =
    "id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,image_ids,index_generation_id";
  const fetchChunks = (ids: string[], documentIdsForChunks: string[]) =>
    supabase
      .from("document_chunks")
      .select(chunkColumns)
      .in("id", ids)
      .in("document_id", documentIdsForChunks)
      .limit(ids.length);
  // The chunk read only needs the document gate to filter its rows, not to build its query, so when
  // the candidate set is small it runs alongside the document read instead of after it (one fewer
  // cross-region round trip). The rows kept below are exactly the ones the serial read returned.
  const candidateChunkIds = Array.from(
    new Set(
      cards.filter((card) => documentIds.includes(card.document_id)).flatMap((card) => card.source_chunk_ids ?? []),
    ),
  );
  const prefetchChunks = candidateChunkIds.length > 0 && candidateChunkIds.length <= 80;
  const [{ data: documents, error: documentsError }, prefetched] = await Promise.all([
    documentQuery,
    prefetchChunks ? fetchChunks(candidateChunkIds, documentIds) : Promise.resolve(null),
  ]);
  if (documentsError || !documents?.length) return [] as SearchResult[];

  const documentById = new Map(documents.map((document) => [document.id, document]));
  const allowedDocumentIds = new Set(documentById.keys());
  const chunkIds = Array.from(
    new Set(
      cards.filter((card) => allowedDocumentIds.has(card.document_id)).flatMap((card) => card.source_chunk_ids ?? []),
    ),
  ).slice(0, 80);
  if (chunkIds.length === 0) return [] as SearchResult[];
  const chunkIdSet = new Set(chunkIds);
  const { data: fetchedChunks, error: chunksError } =
    prefetched ?? (await fetchChunks(chunkIds, [...allowedDocumentIds]));
  const chunks = fetchedChunks?.filter(
    (chunk) => chunkIdSet.has(chunk.id) && allowedDocumentIds.has(chunk.document_id),
  );
  if (chunksError || !chunks?.length) return [] as SearchResult[];
  const bestCardByChunk = new Map<string, DocumentMemoryCard>();
  for (const card of cards) {
    for (const chunkId of card.source_chunk_ids ?? []) {
      const existing = bestCardByChunk.get(chunkId);
      if (!existing || memoryCardChunkScore(card) > memoryCardChunkScore(existing)) bestCardByChunk.set(chunkId, card);
    }
  }

  return chunks
    .map((chunk) => {
      const document = documentById.get(chunk.document_id);
      if (!document) return null;
      const committedGeneration = committedIndexGeneration(document.metadata);
      if (chunk.index_generation_id && chunk.index_generation_id !== committedGeneration) return null;
      const card = bestCardByChunk.get(chunk.id);
      // Not a cosine: fabricated from memory-card confidence (RC9 — tagged below).
      const similarity = Math.min(0.92, 0.58 + (card?.confidence ?? 0.5) * 0.28);
      return {
        similarity_origin: "synthetic_text" as const,
        id: chunk.id,
        document_id: chunk.document_id,
        title: document.title,
        file_name: document.file_name,
        page_number: chunk.page_number,
        chunk_index: chunk.chunk_index,
        section_heading: chunk.section_heading,
        section_path: chunk.section_path ?? [],
        heading_level: chunk.heading_level ?? null,
        parent_heading: chunk.parent_heading ?? null,
        anchor_id: chunk.anchor_id ?? null,
        content: chunk.content,
        retrieval_synopsis: chunk.retrieval_synopsis ?? null,
        image_ids: chunk.image_ids ?? [],
        source_metadata: normalizeOptionalSourceMetadata(document.metadata),
        similarity,
        text_rank: card?.confidence ?? 0,
        hybrid_score: Math.min(0.96, similarity + 0.03),
        images: [],
      } satisfies SearchResult;
    })
    .filter(Boolean) as SearchResult[];
}

type ChunkScopeRow = { id: string; document_id: string };

const HYDRATED_CHUNK_COLUMNS =
  "id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,image_ids,index_generation_id";

type HydratedDocumentRow = {
  id: string;
  title: string;
  file_name: string;
  metadata: unknown;
  owner_id: string | null;
  status: string;
};

type HydratedChunkRow = {
  id: string;
  document_id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  section_path: string[] | null;
  heading_level: number | null;
  parent_heading: string | null;
  anchor_id: string | null;
  content: string;
  retrieval_synopsis: string | null;
  image_ids: string[] | null;
  index_generation_id: string | null;
};

export interface ChunkLoadCache {
  chunkScopes: Map<string, Promise<ChunkScopeRow | null>>;
  documents: Map<string, Promise<HydratedDocumentRow | null>>;
  chunks: Map<string, Promise<HydratedChunkRow | null>>;
}

export function createChunkLoadCache(): ChunkLoadCache {
  return {
    chunkScopes: new Map(),
    documents: new Map(),
    chunks: new Map(),
  };
}

async function loadRowsWithCache<T extends { id: string }>(args: {
  cache: Map<string, Promise<T | null>>;
  ids: string[];
  scopeKey: string;
  fetchRows: (missingIds: string[]) => Promise<{ data: T[] | null; error: unknown }>;
}) {
  const cacheKey = (id: string) => `${args.scopeKey}\0${id}`;
  const missingIds = args.ids.filter((id) => !args.cache.has(cacheKey(id)));

  if (missingIds.length > 0) {
    const fetchPromise = Promise.resolve()
      .then(() => args.fetchRows(missingIds))
      .then(
        ({ data, error }) =>
          error || !data
            ? { ok: false as const, rows: new Map<string, T>() }
            : { ok: true as const, rows: new Map(data.map((row) => [row.id, row])) },
        () => ({ ok: false as const, rows: new Map<string, T>() }),
      );

    for (const id of missingIds) {
      const key = cacheKey(id);
      const rowPromise: Promise<T | null> = fetchPromise.then((result) => {
        if (!result.ok) {
          if (args.cache.get(key) === rowPromise) args.cache.delete(key);
          return null;
        }
        return result.rows.get(id) ?? null;
      });
      args.cache.set(key, rowPromise);
    }
  }

  return Promise.all(args.ids.map((id) => args.cache.get(cacheKey(id))!));
}

/**
 * Hydrates full chunk records, document metadata, and images for signal matches (tables, embedding fields, index units).
 *
 * @param args - Object with supabase client, signal matches, access scope, and optional chunk cache
 * @returns Fully hydrated SearchResult objects
 */
export async function loadChunksForSignalMatches(args: {
  supabase: ReturnType<typeof createAdminClient>;
  matches: ChunkSignalMatch[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  cache?: ChunkLoadCache;
}) {
  const bestMatchByChunk = new Map<string, ChunkSignalMatch>();
  for (const match of args.matches) {
    const existing = bestMatchByChunk.get(match.chunkId);
    if (!existing || match.hybridScore > existing.hybridScore) bestMatchByChunk.set(match.chunkId, match);
  }
  const chunkIds = Array.from(bestMatchByChunk.keys()).slice(0, 80);
  if (chunkIds.length === 0) return [] as SearchResult[];

  const cache = args.cache || createChunkLoadCache();
  const accessScope = retrievalAccessScopeForArgs(args);
  const cacheScopeKey = retrievalAccessScopeKey(accessScope);

  // The scope read fetches the full chunk rows, not just id + document_id, so the chunk read further
  // down can use them once the document gate has passed instead of paying a third serial round trip.
  // Rows reach the result only after that gate, exactly as before.
  const prefetchedChunkRows = new Map<string, HydratedChunkRow>();
  const chunkScopesResults = await loadRowsWithCache<ChunkScopeRow>({
    cache: cache.chunkScopes,
    ids: chunkIds,
    scopeKey: cacheScopeKey,
    fetchRows: async (missingChunkIds) => {
      const { data, error } = await args.supabase
        .from("document_chunks")
        .select(HYDRATED_CHUNK_COLUMNS)
        .in("id", missingChunkIds)
        .limit(missingChunkIds.length);
      if (!error) for (const row of (data ?? []) as HydratedChunkRow[]) prefetchedChunkRows.set(row.id, row);
      return { data: data as ChunkScopeRow[] | null, error };
    },
  });
  const chunkScopes = chunkScopesResults.filter(Boolean) as ChunkScopeRow[];
  if (!chunkScopes.length) return [] as SearchResult[];

  const documentIds = Array.from(new Set(chunkScopes.map((chunk) => chunk.document_id)));
  const documentsResults = await loadRowsWithCache<HydratedDocumentRow>({
    cache: cache.documents,
    ids: documentIds,
    scopeKey: cacheScopeKey,
    fetchRows: async (missingDocIds) => {
      let documentQuery = args.supabase
        .from("documents")
        .select("id,title,file_name,metadata,owner_id,status")
        .in("id", missingDocIds)
        .eq("status", "indexed");
      if (accessScope.ownerId && accessScope.includePublic) {
        documentQuery = documentQuery.or(`owner_id.eq.${accessScope.ownerId},owner_id.is.null`);
      } else if (accessScope.ownerId) {
        documentQuery = documentQuery.eq("owner_id", accessScope.ownerId);
      } else {
        documentQuery = documentQuery.is("owner_id", null);
      }
      const { data, error } = await documentQuery;
      return { data: data as HydratedDocumentRow[] | null, error };
    },
  });
  const documents = documentsResults.filter((document): document is HydratedDocumentRow => document !== null);
  if (!documents.length) return [] as SearchResult[];

  const documentById = new Map(documents.map((document) => [document.id, document]));
  const allowedDocumentIds = new Set(documentById.keys());
  const allowedChunkIds = chunkScopes
    .filter((chunk) => allowedDocumentIds.has(chunk.document_id))
    .map((chunk) => chunk.id);
  if (allowedChunkIds.length === 0) return [] as SearchResult[];

  const chunksResults = await loadRowsWithCache<HydratedChunkRow>({
    cache: cache.chunks,
    ids: allowedChunkIds,
    scopeKey: cacheScopeKey,
    fetchRows: async (missingAllowedChunkIds) => {
      const prefetched = missingAllowedChunkIds
        .map((id) => prefetchedChunkRows.get(id))
        .filter((row): row is HydratedChunkRow => Boolean(row && allowedDocumentIds.has(row.document_id)));
      const remainingIds = missingAllowedChunkIds.filter((id) => !prefetchedChunkRows.has(id));
      if (remainingIds.length === 0) return { data: prefetched, error: null };
      const { data, error } = await args.supabase
        .from("document_chunks")
        .select(HYDRATED_CHUNK_COLUMNS)
        .in("id", remainingIds)
        .in("document_id", [...allowedDocumentIds])
        .limit(remainingIds.length);
      if (error) return { data: null, error };
      return { data: [...prefetched, ...((data ?? []) as HydratedChunkRow[])], error: null };
    },
  });
  const chunks = chunksResults.filter((chunk): chunk is HydratedChunkRow => chunk !== null);
  if (!chunks.length) return [] as SearchResult[];

  return chunks
    .map((chunk) => {
      const document = documentById.get(chunk.document_id);
      const match = bestMatchByChunk.get(chunk.id);
      if (!document || !match) return null;
      const committedGeneration = committedIndexGeneration(document.metadata);
      if (chunk.index_generation_id && chunk.index_generation_id !== committedGeneration) return null;
      return {
        id: chunk.id,
        document_id: chunk.document_id,
        title: document.title,
        file_name: document.file_name,
        page_number: chunk.page_number,
        chunk_index: chunk.chunk_index,
        section_heading: chunk.section_heading,
        section_path: chunk.section_path ?? [],
        heading_level: chunk.heading_level ?? null,
        parent_heading: chunk.parent_heading ?? null,
        anchor_id: chunk.anchor_id ?? null,
        content: chunk.content,
        retrieval_synopsis: chunk.retrieval_synopsis ?? null,
        image_ids: chunk.image_ids ?? [],
        source_metadata: normalizeOptionalSourceMetadata(document.metadata),
        // ChunkSignalMatch similarities are fabricated from table-fact text rank (RC9).
        similarity_origin: "synthetic_text" as const,
        similarity: match.similarity,
        text_rank: match.textRank,
        hybrid_score: match.hybridScore,
        table_facts: match.tableFacts?.filter((fact) =>
          isReviewedTablePromotable((fact as { metadata?: unknown }).metadata),
        ),
        index_unit: match.indexUnit ?? null,
        match_explanation: {
          sectionHit: match.reason === "section_context" || match.indexUnit?.unit_type === "section_summary",
          tableHit: match.reason.startsWith("table") || match.indexUnit?.unit_type === "table_fact",
          indexUnitType: match.indexUnit?.unit_type ?? null,
          vectorSimilarity: match.similarity,
          textRank: match.textRank,
          fieldType: match.fieldType ?? null,
          freshness: normalizeSourceMetadata(document.metadata).document_status,
          extractionQuality: normalizeSourceMetadata(document.metadata).extraction_quality,
          reasons: [match.reason, match.indexUnit?.unit_type ? `unit:${match.indexUnit.unit_type}` : ""].filter(
            Boolean,
          ),
        },
        images: [],
      } satisfies SearchResult;
    })
    .filter(Boolean) as SearchResult[];
}
/**
 * Retrieves document chunks containing table facts relevant to a query.
 *
 * @param args - Retrieval options, including query variants, scope filters, result limit, and optional telemetry.
 * @returns Search results containing the highest-ranked table facts grouped by source chunk.
 */
export async function searchTableFactCandidates(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  queryVariants?: string[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  allowGlobalSearch?: boolean;
  matchCount: number;
  telemetry?: SearchTelemetry;
  cache?: ChunkLoadCache;
  signal?: AbortSignal;
}) {
  const variants = (args.queryVariants?.length ? args.queryVariants : [buildClinicalTextSearchQuery(args.query)]).slice(
    0,
    maxTextRpcQueryVariants,
  );
  const runTableFacts = async (variant: string, matchCount: number) => {
    const { data, error } = await callVersionedRetrievalRpc(
      args.supabase,
      "match_document_table_facts_text_v2",
      "match_document_table_facts_text",
      {
        query_text: variant,
        match_count: matchCount,
        document_filters: args.documentIds ?? undefined,
        ...retrievalRpcScopeArgs(retrievalAccessScopeForArgs(args)),
      },
      args.signal,
    );
    if (error) recordHybridRpcError(args.telemetry, "match_document_table_facts_text", error);
    if (error || !data?.length) return [] as TableFactRpcRow[];
    return data as TableFactRpcRow[];
  };
  const [primaryVariant, ...siblingVariants] = variants;
  const primaryFacts = primaryVariant === undefined ? [] : await runTableFacts(primaryVariant, args.matchCount);
  const skipSiblings = siblingVariants.length > 0 && firstVariantPoolIsStrong(primaryFacts, args.matchCount);
  const factSets = skipSiblings
    ? [primaryFacts]
    : [
        primaryFacts,
        ...(await Promise.all(siblingVariants.map((variant) => runTableFacts(variant, Math.min(args.matchCount, 24))))),
      ];
  recordTextVariantFanout(args.telemetry, "match_document_table_facts_text", factSets.length, skipSiblings);
  const data = factSets.flat();
  if (!data.length) return [] as SearchResult[];

  const grouped = new Map<string, ChunkSignalMatch>();
  for (const fact of data) {
    if (!fact.source_chunk_id) continue;
    const textRank = Number(fact.text_rank ?? 0);
    const current = grouped.get(fact.source_chunk_id);
    const tableFact = { ...fact, text_rank: textRank, match_reason: fact.match_reason ?? "table_row" };
    const next: ChunkSignalMatch = {
      chunkId: fact.source_chunk_id,
      similarity: Math.min(0.94, 0.62 + Math.min(textRank, 1) * 0.3),
      textRank,
      hybridScore: Math.min(0.97, 0.66 + Math.min(textRank, 1) * 0.3),
      reason: fact.match_reason ?? "table_row",
      tableFacts: [...(current?.tableFacts ?? []), tableFact].slice(0, 5),
    };
    if (!current || next.hybridScore > current.hybridScore) grouped.set(fact.source_chunk_id, next);
  }

  return loadChunksForSignalMatches({
    supabase: args.supabase,
    matches: Array.from(grouped.values()),
    ownerId: args.ownerId,
    accessScope: args.accessScope,
    cache: args.cache,
  });
}

/**
 * Retrieves candidate chunks by searching dense and sparse embedding fields.
 *
 * @param args - Search options with query, query embedding, owner/document filters, and limits
 * @returns Array of SearchResult candidates enriched with section context
 */
export async function searchEmbeddingFieldCandidates(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  queryEmbedding: number[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  allowGlobalSearch?: boolean;
  matchCount: number;
  telemetry?: SearchTelemetry;
  cache?: ChunkLoadCache;
  signal?: AbortSignal;
}) {
  const { data, error } = await callVersionedRetrievalRpc(
    args.supabase,
    "match_document_embedding_fields_hybrid_v2",
    "match_document_embedding_fields_hybrid",
    {
      query_embedding: args.queryEmbedding as unknown as string,
      query_text: buildClinicalTextSearchQuery(args.query),
      match_count: args.matchCount,
      min_similarity: 0.12,
      document_filters: args.documentIds ?? undefined,
      ...retrievalRpcScopeArgs(retrievalAccessScopeForArgs(args)),
    },
    args.signal,
  );
  if (error) recordHybridRpcError(args.telemetry, "match_document_embedding_fields_hybrid", error);
  if (error || !data?.length) return [] as SearchResult[];
  try {
    assertEmbeddingFieldRows(data, "match_document_embedding_fields_hybrid");
  } catch (error) {
    if (!(error instanceof RetrievalRowShapeError)) throw error;
    return [] as SearchResult[];
  }
  const matches = data
    .filter((row): row is EmbeddingFieldSignalRow & { source_chunk_id: string } => Boolean(row.source_chunk_id))
    .map((row) => ({
      chunkId: row.source_chunk_id,
      similarity: Number(row.similarity ?? 0),
      textRank: Number(row.text_rank ?? 0),
      hybridScore: Number(row.hybrid_score ?? row.similarity ?? 0),
      reason: "section_context",
      fieldType: row.field_type,
    }));
  return loadChunksForSignalMatches({
    supabase: args.supabase,
    matches,
    ownerId: args.ownerId,
    accessScope: args.accessScope,
    cache: args.cache,
  });
}

/**
 * Retrieves candidate chunks by searching structured document index units (tables, workflows, algorithms).
 *
 * @param args - Search options with query, vector embedding, scope filters, and limits
 * @returns Array of SearchResult candidates matched against index units
 */
export async function searchIndexUnitCandidates(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  queryEmbedding: number[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  allowGlobalSearch?: boolean;
  matchCount: number;
  telemetry?: SearchTelemetry;
  cache?: ChunkLoadCache;
  signal?: AbortSignal;
}) {
  const { data, error } = await callVersionedRetrievalRpc(
    args.supabase,
    "match_document_index_units_hybrid_v2",
    "match_document_index_units_hybrid",
    {
      query_embedding: args.queryEmbedding as unknown as string,
      query_text: buildClinicalTextSearchQuery(args.query),
      match_count: args.matchCount,
      min_similarity: 0.1,
      document_filters: args.documentIds ?? undefined,
      ...retrievalRpcScopeArgs(retrievalAccessScopeForArgs(args)),
    },
    args.signal,
  );
  if (error) recordHybridRpcError(args.telemetry, "match_document_index_units_hybrid", error);
  if (error || !data?.length) return [] as SearchResult[];
  try {
    assertIndexUnitRows(data, "match_document_index_units_hybrid");
  } catch (error) {
    if (!(error instanceof RetrievalRowShapeError)) throw error;
    return [] as SearchResult[];
  }
  const matches = data
    .filter((row): row is IndexUnitSignalRow & { source_chunk_id: string } => Boolean(row.source_chunk_id))
    .map((row) => ({
      chunkId: row.source_chunk_id,
      similarity: Number(row.similarity ?? 0),
      textRank: Number(row.text_rank ?? 0),
      hybridScore: Number(row.hybrid_score ?? row.similarity ?? 0),
      reason: `index_unit:${row.unit_type}`,
      fieldType: row.unit_type,
      indexUnit: {
        id: row.id,
        document_id: row.document_id,
        unit_type: row.unit_type,
        title: row.title,
        content: row.content,
        source_chunk_id: row.source_chunk_id,
        source_image_id: row.source_image_id,
        page_start: row.page_start,
        page_end: row.page_end,
        heading_path: row.heading_path ?? [],
        normalized_terms: row.normalized_terms ?? [],
        source_span: optionalJsonRecord(row.source_span),
        quality_score: row.quality_score,
        extraction_mode: row.extraction_mode,
        similarity: row.similarity,
        text_rank: row.text_rank,
        hybrid_score: row.hybrid_score,
        metadata: optionalJsonRecord(row.metadata),
      },
    }));
  return loadChunksForSignalMatches({
    supabase: args.supabase,
    matches,
    ownerId: args.ownerId,
    accessScope: args.accessScope,
    cache: args.cache,
  });
}

export type MemoryCardCache = Map<string, ReturnType<typeof fetchMemoryCardsForQuery>>;

export type MemoryBoostArtifacts = {
  cards: Awaited<ReturnType<typeof fetchMemoryCardsForQuery>>;
  memoryChunkResults: SearchResult[];
};

/** Load the memory evidence that is independent of the current candidate payload. */
export async function loadMemoryBoostArtifacts(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  queryEmbedding?: number[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  matchCount: number;
  cardCache?: MemoryCardCache;
}): Promise<MemoryBoostArtifacts> {
  const effectiveMatchCount = Math.max(args.matchCount, 48);
  const documentScope = args.documentIds?.length ? [...args.documentIds].sort().join(",") : "all-documents";
  const cacheKey = [
    retrievalAccessScopeKey(retrievalAccessScopeForArgs(args)),
    documentScope,
    args.query,
    args.queryEmbedding?.length ? "vec" : "text",
    effectiveMatchCount,
  ].join("\0");
  let cardsPromise = args.cardCache?.get(cacheKey);
  if (!cardsPromise) {
    cardsPromise = fetchMemoryCardsForQuery({
      supabase: args.supabase,
      query: args.query,
      queryEmbedding: args.queryEmbedding,
      ownerId: args.ownerId,
      accessScope: args.accessScope,
      documentIds: args.documentIds,
      matchCount: effectiveMatchCount,
    });
    args.cardCache?.set(cacheKey, cardsPromise);
  }
  const cards = await cardsPromise;
  const memoryChunkResults = cards.length
    ? await loadChunksForMemoryCards(args.supabase, cards, retrievalAccessScopeForArgs(args))
    : [];
  return { cards, memoryChunkResults };
}

/** Apply already-loaded memory evidence to the final hydrated candidate payload. */
export function applyMemoryBoostArtifacts(query: string, candidates: SearchResult[], artifacts: MemoryBoostArtifacts) {
  if (artifacts.cards.length === 0) return { results: candidates, cards: artifacts.cards };
  const merged = mergeSearchResults(artifacts.memoryChunkResults, candidates);
  return {
    results: applyMemoryCardBoosts(query, merged, artifacts.cards),
    cards: artifacts.cards,
  };
}

/**
 * Enriches candidate search results with memory card boosts and associated memory chunks.
 *
 * @param args - Search arguments and candidate pool
 * @returns Object with boosted search results and referenced memory cards
 */
export async function withMemoryBoostedCandidates(args: {
  supabase: ReturnType<typeof createAdminClient>;
  query: string;
  candidates: SearchResult[];
  queryEmbedding?: number[];
  ownerId?: string;
  accessScope?: RetrievalAccessScope;
  documentIds?: string[];
  matchCount: number;
  cardCache?: MemoryCardCache;
}) {
  const artifacts = await loadMemoryBoostArtifacts(args);
  return applyMemoryBoostArtifacts(args.query, args.candidates, artifacts);
}
