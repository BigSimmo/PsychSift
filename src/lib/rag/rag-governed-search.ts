import type { RawPublishedOriginalRowObserver } from "@/lib/rag/rag-source-block";
import { rankClinicalResults } from "@/lib/clinical-search";
import { governedPublicRetrievalAccessScope } from "@/lib/owner-scope";
import { embedTextWithTelemetry } from "@/lib/openai";
import { searchGovernedCorpora } from "@/lib/rag/rag-candidate-sources";
import {
  evaluateShadowCandidateMatchCounts,
  mergeEvidenceByCoverageAndSourceRole,
  selectConflictAwareCoverageEvidence,
} from "@/lib/rag/rag-coverage";
import { governedCorpusComponentState, type SearchChunksArgs, type SearchTelemetry } from "@/lib/rag/rag-contracts";
import { attachDocumentRankingMetadata, attachPageVisualEvidence } from "@/lib/rag/rag-hydration";
import { isSourceOnlyMode, SOURCE_ONLY_EMBEDDING_SKIP_REASON } from "@/lib/rag/rag-provider";
import type { RagProgrammeMode } from "@/lib/rag/rag-programme-eval";
import { buildRagQueryPlan } from "@/lib/rag/rag-query-plan";
import { revalidateReviewedPolicyRequest } from "@/lib/rag/rag-reviewed-policy-input";
import { buildRagRetrievalVariantPlan, fetchEnabledRagAliases } from "@/lib/rag/rag-retrieval-variants";
import { applySecondStageRerankIfNeeded } from "@/lib/rag/rag-second-stage";
import { selectRetrievalEvidence } from "@/lib/retrieval-selection";
import {
  classifyClaimRoleForSubquestion,
  retainCanonicalSourcePolicyConflicts,
  searchResultEligibilityForClaim,
} from "@/lib/source-role-policy";
import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  ClinicalQueryAnalysis,
  RagQueryClass,
  RagQueryPlan,
  SearchResult,
  SourcePolicyConflict,
} from "@/lib/types";

type GovernedModeResult = { candidateResults: SearchResult[]; results: SearchResult[]; served: boolean };

function prevalidatedConflictGroups(args: {
  candidates: SearchResult[];
  conflicts: readonly SourcePolicyConflict[];
  queryPlan: RagQueryPlan;
}) {
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const subquestion of args.queryPlan.subquestions) {
    const claimRole = classifyClaimRoleForSubquestion(subquestion);
    const eligible = args.candidates.filter(
      (candidate) => searchResultEligibilityForClaim(candidate, claimRole).eligible,
    );
    const canonical = retainCanonicalSourcePolicyConflicts({
      conflicts: args.conflicts,
      local: eligible.filter((candidate) => candidate.corpus_scope === "uploaded_local"),
      australian: eligible.filter((candidate) => candidate.corpus_scope === "australian_public"),
      claimRole,
    });
    for (const conflict of canonical) {
      if (seen.has(conflict.id)) continue;
      seen.add(conflict.id);
      groups.push([...new Set([...conflict.local.supportingChunkIds, ...conflict.australian.supportingChunkIds])]);
    }
  }
  return groups;
}

/** Build the candidate plan from public-only analysis and aliases, independently of a shadow control. */
export async function planGovernedCandidateSearch(input: {
  analysis: Promise<ClinicalQueryAnalysis>;
  mode: RagProgrammeMode;
  query: string;
  originalAdaptiveRequest?: string;
  queryClass?: RagQueryClass;
  signal?: AbortSignal;
  supabase: ReturnType<typeof createAdminClient>;
}) {
  if (input.mode === "legacy") return null;
  const [resolvedAnalysis, aliases] = await Promise.all([
    input.analysis,
    fetchEnabledRagAliases(input.supabase, undefined, governedPublicRetrievalAccessScope(), input.signal),
  ]);
  const analysis = input.queryClass ? { ...resolvedAnalysis, queryClass: input.queryClass } : resolvedAnalysis;
  const queryPlan = buildRagQueryPlan(input.query, analysis, input.originalAdaptiveRequest);
  return {
    analysis,
    queryPlan,
    variantPlan: buildRagRetrievalVariantPlan(input.query, analysis, aliases, queryPlan, input.mode, input.signal),
  };
}

/** Run one v3 candidate lane; shadow observes it while canary serves its public-only output. */
export async function routeGovernedSearch(input: {
  args: SearchChunksArgs;
  supabase: ReturnType<typeof createAdminClient>;
  queryPlan: RagQueryPlan;
  queryVariants: string[];
  telemetry: SearchTelemetry;
  observeRawPublishedRow?: RawPublishedOriginalRowObserver;
}): Promise<GovernedModeResult | null> {
  const { args, queryPlan, queryVariants, supabase, telemetry } = input;
  if (args.ragQueryPlanMode === "legacy") return null;
  const shadow = args.ragQueryPlanMode === "shadow";
  telemetry.governed_component_state = governedCorpusComponentState(args.governedCorpusComponents);
  if (!args.governedCorpusComponents || !args.ragRequestContext) {
    return shadow ? null : { candidateResults: [], results: [], served: true };
  }
  const providerSourceOnly = isSourceOnlyMode();
  const sourceOnly = providerSourceOnly || Boolean(args.lexicalOnly);
  const retrievalMode = shadow || sourceOnly ? "text" : args.forceEmbedding ? "vector" : "hybrid";
  const documentFilters = args.documentIds?.length ? args.documentIds : args.documentId ? [args.documentId] : undefined;
  const query = queryPlan.originalQuery;
  const queryClass = (telemetry.query_class ?? "broad_summary") as RagQueryClass;
  const candidateMultiplier = queryClass === "comparison" ? 7 : 5;
  const candidateFloor = queryClass === "comparison" ? 72 : 48;
  const startedAt = Date.now();
  let embeddingLatencyMs = 0;
  let rpcCalls = 0;
  const candidateResults = await searchGovernedCorpora({
    supabase,
    queryVariants,
    queryPlan,
    retrievalMode,
    embedQuery: async (embeddingQuery, signal) => {
      const embeddingStartedAt = Date.now();
      try {
        const result = await embedTextWithTelemetry(embeddingQuery, { signal });
        telemetry.embedding_cache_hit = result.cacheHit;
        return result.embedding;
      } finally {
        embeddingLatencyMs += Date.now() - embeddingStartedAt;
      }
    },
    documentFilters,
    matchCount: Math.max((args.topK ?? 8) * candidateMultiplier, candidateFloor),
    minSimilarity: args.minSimilarity,
    snapshot: args.ragRequestContext.snapshot,
    components: args.governedCorpusComponents,
    targetSiteDomains: queryPlan.siteDomainDecision === "inferred" ? [] : queryPlan.targetSiteDomains,
    answerSourcePolicy: args.answerSourcePolicy ?? queryPlan.sourcePolicy,
    signal: args.signal,
    maxRpcCalls: shadow ? 1 : 3,
    observeRawPublishedRow: shadow ? undefined : input.observeRawPublishedRow,
    onRpcCall: () => {
      rpcCalls += 1;
    },
  });
  telemetry.governed_candidate_rpc_calls = rpcCalls;
  telemetry.governed_candidate_count = candidateResults.length;
  telemetry.governed_candidate_site_domains = queryPlan.targetSiteDomains;
  telemetry.candidate_match_counts = evaluateShadowCandidateMatchCounts(queryPlan, candidateResults);
  telemetry.embedding_latency_ms += embeddingLatencyMs;
  telemetry.supabase_rpc_latency_ms += Math.max(0, Date.now() - startedAt - embeddingLatencyMs);
  if (shadow) return { candidateResults, results: [], served: false };
  if (retrievalMode === "text") {
    telemetry.embedding_skipped = true;
    telemetry.embedding_skip_reason = providerSourceOnly ? SOURCE_ONLY_EMBEDDING_SKIP_REASON : "lexical_only";
  }

  const hydrated = await attachDocumentRankingMetadata(supabase, candidateResults, undefined, undefined, args.signal);
  const reviewed = revalidateReviewedPolicyRequest(args, hydrated);
  telemetry.reviewed_input_state = reviewed.state;
  args.sourcePolicyConflicts = reviewed.conflicts;
  args.captureSourcePolicyConflicts?.(reviewed.conflicts);
  const topK = args.topK ?? 8;
  const maxResultsPerDocument = queryClass === "comparison" ? 2 : 4;
  const coverageSelections = mergeEvidenceByCoverageAndSourceRole({
    plan: queryPlan,
    candidates: hydrated,
    siteContentState: args.ragRequestContext.snapshot.publicSiteContent.state,
    sourcePolicyConflicts: args.sourcePolicyConflicts,
    maxPerSubquestion: topK,
    maxPerDocument: maxResultsPerDocument,
  });
  const policyPool = selectConflictAwareCoverageEvidence(coverageSelections, {
    limit: topK,
    maxPerDocument: maxResultsPerDocument,
  }).results;
  const conflictGroups = prevalidatedConflictGroups({
    candidates: policyPool,
    conflicts: args.sourcePolicyConflicts ?? [],
    queryPlan,
  });
  const selection = selectRetrievalEvidence({
    query,
    queryClass,
    results: rankClinicalResults(query, policyPool),
    topK,
    maxResultsPerDocument,
    prevalidatedAtomicGroups: conflictGroups,
  });
  telemetry.retrieval_intent = selection.intent;
  telemetry.retrieval_selection = selection.summary;
  let results = await attachPageVisualEvidence(supabase, selection.results, args.signal);
  results = applySecondStageRerankIfNeeded({
    queryClass,
    results,
    telemetry,
    topK,
  });
  telemetry.retrieval_strategy =
    retrievalMode === "text" ? "text_fast_path" : retrievalMode === "vector" ? "vector_fallback" : "hybrid";
  return { candidateResults, results, served: true };
}
