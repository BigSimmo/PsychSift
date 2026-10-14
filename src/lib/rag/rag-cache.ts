import { answerContractForRollout, type RagProgrammeRolloutDecision } from "@/lib/rag/rag-rollout";
import { isIssuedRagShadowControl } from "@/lib/rag/rag-rollout";
import { reviewedPolicyStateForRequest } from "@/lib/rag/rag-reviewed-policy-input";
import { sanitizeRagEvalDiagnostics } from "@/lib/rag/rag-eval-diagnostics";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildClinicalTextSearchQuery } from "@/lib/clinical-search";
import { readExpiringCacheEntry, writeBoundedExpiringCacheEntry } from "@/lib/bounded-ttl-cache";
import { ragDeepMemoryVersion } from "@/lib/deep-memory";
import { env } from "@/lib/env";
import { hashQueryText, queryCacheKeyForStorage } from "@/lib/query-privacy";
import { ragCacheKeyMatchesOwner } from "@/lib/rag/rag-cache-utils";
import { ragContextPackVersion } from "@/lib/rag/rag-context-pack";
import { retrievalAccessScopeForArgs, retrievalAccessScopeKey, type RetrievalAccessScope } from "@/lib/owner-scope";
import { assertRagRequestContextIntegrity } from "@/lib/rag/rag-context-snapshot";
import { governedCorpusComponentState, sanitizeRagCandidateMatchCounts } from "@/lib/rag/rag-contracts";
import { sanitizeRagQueryPlanDiagnostics } from "@/lib/rag/rag-retrieval-variants";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import {
  retrievalPlanForQueryClass,
  type RagRequestContext,
  type SearchChunksArgs,
  type SearchTelemetry,
} from "@/lib/rag/rag-contracts";
import type { Json } from "@/lib/supabase/database.types";
import type { RagAnswer, RagQueryClass, SearchResult, SourcePolicyConflict } from "@/lib/types";
import { restoreCachedContextPackAdmission } from "@/lib/rag/rag-context-admission";
import {
  ragAnswerInputVersion,
  ragIndexingPromptVersion,
  ragQueryClassifierPromptVersion,
} from "@/lib/rag/rag-versioning";

export type RagAnswerQueryPlanDiagnostics = Readonly<{
  queryPlanKind: import("@/lib/rag/rag-programme-eval").RagQueryPlanKind;
  subquestionCount: number;
  candidateMatchCounts?: import("@/lib/rag/rag-contracts").RagCandidateMatchCounts;
}>;
const answerQueryPlanDiagnostics = new WeakMap<RagAnswer, RagAnswerQueryPlanDiagnostics>();
const answerCache = new Map<string, { expiresAt: number; answer: RagAnswer; indexingVersion: string }>();
export const answerInflight = new Map<string, Promise<RagAnswer>>();
const searchCache = new Map<
  string,
  { expiresAt: number; results: SearchResult[]; telemetry: SearchTelemetry; indexingVersion: string }
>();
// v22 (ledger #ZK460W): the source-backed review fallback used to relabel a rejected answer
// `grounded: true` with `deterministic_support` citations. The extractive arm of that route
// carries no `generation_fallback:` marker, so `getSharedCachedAnswer` does not evict those
// rows — a repeat query would keep serving the unsafe shape for the whole answer-cache TTL
// after rollout.
// v23/v24 landed on main for unrelated reasons while that defect was still live, so production
// still writes unsafe review-fallback answers under v24. v25 re-issues the intentional
// #ZK460W invalidation: rows written under v24 (and earlier) become unreachable. The bump
// costs one cold cache and is the mechanism this constant exists for.
export const ragCacheDependencyVersion = "rag-cache-v25";
const cacheIndexingVersionTtlMs = 5000;
const cacheIndexingVersionMaxEntries = 512;
const cacheIndexingVersionCache = new Map<string, { expiresAt: number; value: string }>();
/**
 * The two corpus-staleness stamps that carry no information about the corpus.
 *
 * Audit L21: a PostgREST `error` on the `documents` stamp query used to be
 * folded into INDEXING_STAMP_EMPTY_CORPUS, making a failed read indistinguishable
 * from "nothing is indexed". Both constants are stable across requests, so two
 * stamp failures bracketing a worker-side reindex (which cannot call this
 * process's in-process invalidation) let a pre-reindex answer be served with
 * `answer_cache_hit` — the exact staleness this stamp exists to prevent. An
 * error now produces the distinct UNAVAILABLE stamp, and neither read nor write
 * trusts it.
 */
const INDEXING_STAMP_UNAVAILABLE = "index-stamp-unavailable";
const INDEXING_STAMP_EMPTY_CORPUS = "no-indexed-documents";

function isUnavailableIndexingStamp(indexingVersion: string) {
  return indexingVersion.endsWith(`:${INDEXING_STAMP_UNAVAILABLE}`);
}
/**
 * Invalidation generations for deferred `setCachedAnswer` promotions. Review /
 * table-fact mutations do not change the documents indexing stamp, so the
 * mid-request staleness guard alone cannot catch them. Epochs are owner-scoped
 * so one tenant's invalidation cannot suppress another tenant's valid write;
 * a null/undefined ownerId bump (full clear) advances the global epoch.
 */
let ragCacheGlobalInvalidationEpoch = 0;
const ragCacheOwnerInvalidationEpoch = new Map<string, number>();

type InvalidationEpochStamp = { global: number; owner: number };

function captureInvalidationEpoch(ownerId?: string | null): InvalidationEpochStamp {
  return {
    global: ragCacheGlobalInvalidationEpoch,
    owner: ownerId ? (ragCacheOwnerInvalidationEpoch.get(ownerId) ?? 0) : 0,
  };
}

function invalidationEpochChanged(ownerId: string | null | undefined, stamp: InvalidationEpochStamp) {
  if (ragCacheGlobalInvalidationEpoch !== stamp.global) return true;
  if (ownerId && (ragCacheOwnerInvalidationEpoch.get(ownerId) ?? 0) !== stamp.owner) return true;
  return false;
}

function bumpInvalidationEpoch(ownerId?: string | null) {
  if (!ownerId) {
    ragCacheGlobalInvalidationEpoch += 1;
    return;
  }
  ragCacheOwnerInvalidationEpoch.set(ownerId, (ragCacheOwnerInvalidationEpoch.get(ownerId) ?? 0) + 1);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function requestSnapshotCacheKey(args: Pick<SearchChunksArgs, "ragRequestContext">) {
  if (!args.ragRequestContext) return "";
  assertRagRequestContextIntegrity(args.ragRequestContext);
  return args.ragRequestContext.snapshotCacheKey;
}

function requestCacheNamespace(args: Pick<SearchChunksArgs, "ragRequestContext" | "ragProgrammeRollout">) {
  const snapshot = requestSnapshotCacheKey(args);
  const decision = args.ragProgrammeRollout;
  if (decision?.servedMode !== "candidate") return snapshot;
  return hashQueryText(
    JSON.stringify([
      decision.cacheNamespace,
      args.ragRequestContext?.snapshot.version,
      args.ragRequestContext?.snapshot.rolloutVersion,
      ...(decision.components.siteContent ? [snapshot] : []),
    ]),
  );
}

function siteAwareAnswerOwnerToken(ownerId: string) {
  const ownerHash = createHash("sha256").update(`rag-site-aware-answer-owner-v1\0${ownerId}`).digest("hex");
  return `answer-owner:${ownerHash}`;
}

export function isRagCacheAccessAllowed(args: Pick<SearchChunksArgs, "ownerId" | "accessScope" | "ragRequestContext">) {
  try {
    if (!requestSnapshotCacheKey(args)) return true;
  } catch {
    return false;
  }
  const scope = retrievalAccessScopeForArgs(args);
  return scope.includePublic === true && !scope.ownerId;
}

function documentScopeKey(args: Pick<SearchChunksArgs, "documentId" | "documentIds">) {
  const scope = args.documentIds?.length
    ? [...args.documentIds].sort().join(",")
    : args.documentId
      ? args.documentId
      : "all-documents";
  return scope;
}

function scopeKey(args: Pick<SearchChunksArgs, "documentId" | "documentIds" | "ownerId" | "accessScope">) {
  return `${retrievalAccessScopeKey(retrievalAccessScopeForArgs(args))}|${documentScopeKey(args)}`;
}

function normalizedCacheQuery(query: string) {
  return buildClinicalTextSearchQuery(query).toLowerCase().replace(/\s+/g, " ").trim();
}

function cacheIndexingVersionCacheKey(
  args: Pick<SearchChunksArgs, "documentId" | "documentIds" | "ownerId" | "accessScope">,
) {
  return scopeKey(args);
}

function modeKey(args: Pick<SearchChunksArgs, "queryMode">) {
  return args.queryMode ?? "auto";
}

export function governedCorpusComponentCacheNamespace(
  base: string,
  components: SearchChunksArgs["governedCorpusComponents"],
) {
  if (!components) return base;
  return `${base}|site:${components?.siteContent ? "on" : "off"}|australian:${components?.australianAugmentation ? "on" : "off"}|australian-current:${components?.australianCurrent ? "on" : "off"}`;
}

export type AnswerGenerationFingerprintInput = {
  answerModel: string;
  fastModel: string;
  strongModel: string;
  classifierModel: string;
  indexingModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  fastReasoningEffort: string;
  strongReasoningEffort: string;
  answerVerbosity: string;
  maxOutputTokens: number;
  providerMode: string;
  promptVersion: string;
  answerInputVersion?: string;
  contextPackVersion: string;
  schemaVersion: string;
  classifierPromptVersion: string;
  retrievalVersion: string;
  indexingPromptVersion: string;
  semanticRerankEnabled: boolean;
  semanticRerankModel: string;
};

export function buildAnswerGenerationFingerprint(input: AnswerGenerationFingerprintInput) {
  return createHash("sha256")
    .update(JSON.stringify({ ...input, answerInputVersion: input.answerInputVersion ?? ragAnswerInputVersion }))
    .digest("hex")
    .slice(0, 20);
}

export function answerGenerationFingerprint(decision?: RagProgrammeRolloutDecision) {
  const contract = answerContractForRollout(decision);
  return buildAnswerGenerationFingerprint({
    answerModel: env.OPENAI_ANSWER_MODEL,
    fastModel: env.OPENAI_FAST_ANSWER_MODEL,
    strongModel: env.OPENAI_STRONG_ANSWER_MODEL,
    classifierModel: env.OPENAI_QUERY_CLASSIFIER_MODEL,
    indexingModel: env.OPENAI_INDEXING_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    embeddingDimensions: env.EMBEDDING_DIMENSIONS,
    fastReasoningEffort: env.OPENAI_FAST_REASONING_EFFORT,
    strongReasoningEffort: env.OPENAI_STRONG_REASONING_EFFORT,
    answerVerbosity: env.OPENAI_TEXT_VERBOSITY,
    maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
    providerMode: env.RAG_PROVIDER_MODE,
    promptVersion: contract.promptVersion,
    contextPackVersion: ragContextPackVersion,
    schemaVersion: contract.schemaVersion,
    classifierPromptVersion: ragQueryClassifierPromptVersion,
    retrievalVersion: ragDeepMemoryVersion,
    indexingPromptVersion: ragIndexingPromptVersion,
    semanticRerankEnabled: env.RAG_SEMANTIC_RERANK_ENABLED,
    semanticRerankModel: env.OPENAI_RERANK_MODEL,
  });
}

export type RagCacheFingerprintInput = Pick<
  SearchChunksArgs,
  | "query"
  | "queryMode"
  | "ragRequestContext"
  | "ragQueryPlanVersion"
  | "ragQueryPlanMode"
  | "ragProgrammeRollout"
  | "governedCorpusComponents"
  | "governedInternationalCoverageGap"
  | "answerSourcePolicy"
>;

/** Full answer semantics, unlike deliberately lossy retrieval normalization. */
export function ragCacheFingerprint(args: RagCacheFingerprintInput): string {
  return (
    "answer-request:" +
    hashQueryText(
      JSON.stringify([
        ragCacheDependencyVersion,
        args.query.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "),
        modeKey(args),
        args.answerSourcePolicy ?? "primary_plus_approved_supplements",
        args.ragQueryPlanVersion ?? "rag-query-plan-v1",
        args.ragProgrammeRollout?.servedMode === "legacy" ? "legacy" : (args.ragQueryPlanMode ?? "legacy"),
        answerGenerationFingerprint(args.ragProgrammeRollout),
        requestCacheNamespace(args),
        governedCorpusComponentCacheNamespace(
          "corpora",
          args.ragProgrammeRollout?.servedMode === "legacy" ? undefined : args.governedCorpusComponents,
        ),
      ]),
    )
  );
}

export function sharedAnswerNormalizedQuery(args: RagCacheFingerprintInput) {
  return ragCacheFingerprint(args);
}

export function scopedAnswerCacheKey(
  args: RagCacheFingerprintInput &
    Pick<
      SearchChunksArgs,
      "documentId" | "documentIds" | "ownerId" | "accessScope" | "ragQueryPlanKind" | "ragSubquestionCount"
    >,
) {
  // Keep only a hashed owner tag outside the digest for scoped invalidation.
  const owner = args.ownerId ? siteAwareAnswerOwnerToken(args.ownerId) : "anonymous";
  return [ragCacheDependencyVersion, hashQueryText(scopeKey(args)), owner, ragCacheFingerprint(args)].join("|");
}

function boundedAnswerQueryPlanDiagnostics(
  input:
    Pick<SearchChunksArgs, "ragQueryPlanKind" | "ragSubquestionCount" | "ragCandidateMatchCounts"> | null | undefined,
): RagAnswerQueryPlanDiagnostics | undefined {
  const diagnostics = sanitizeRagQueryPlanDiagnostics({
    query_plan_kind: input?.ragQueryPlanKind,
    subquestion_count: input?.ragSubquestionCount,
  });
  const candidateMatchCounts = sanitizeRagCandidateMatchCounts(
    input?.ragCandidateMatchCounts,
    diagnostics.subquestion_count,
  );
  return diagnostics.query_plan_kind !== undefined && diagnostics.subquestion_count !== undefined
    ? {
        queryPlanKind: diagnostics.query_plan_kind,
        subquestionCount: diagnostics.subquestion_count,
        ...(candidateMatchCounts ? { candidateMatchCounts } : {}),
      }
    : undefined;
}

function persistableAnswerQueryPlanDiagnostics(
  diagnostics: RagAnswerQueryPlanDiagnostics | undefined,
): RagAnswerQueryPlanDiagnostics | undefined {
  return diagnostics
    ? {
        queryPlanKind: diagnostics.queryPlanKind,
        subquestionCount: diagnostics.subquestionCount,
      }
    : undefined;
}

function markAnswerQueryPlanDiagnostics(answer: RagAnswer, diagnostics: RagAnswerQueryPlanDiagnostics | undefined) {
  if (diagnostics) answerQueryPlanDiagnostics.set(answer, diagnostics);
  return answer;
}

function storedAnswerQueryPlanDiagnostics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const stored = value as Record<string, unknown>;
  return boundedAnswerQueryPlanDiagnostics({
    ragQueryPlanKind: stored.queryPlanKind as SearchChunksArgs["ragQueryPlanKind"],
    ragSubquestionCount: stored.subquestionCount as number,
  });
}

export function ragAnswerQueryPlanDiagnostics(answer: RagAnswer): RagAnswerQueryPlanDiagnostics | undefined {
  return answerQueryPlanDiagnostics.get(answer);
}

export function restoreRagAnswerQueryPlanArgs(
  answer: RagAnswer,
  args: Pick<SearchChunksArgs, "ragQueryPlanKind" | "ragSubquestionCount" | "ragCandidateMatchCounts">,
) {
  const diagnostics = answerQueryPlanDiagnostics.get(answer);
  if (diagnostics) {
    args.ragQueryPlanKind = diagnostics.queryPlanKind;
    args.ragSubquestionCount = diagnostics.subquestionCount;
    args.ragCandidateMatchCounts = diagnostics.candidateMatchCounts;
  }
}

export function withRagAnswerQueryPlanDiagnostics(
  answer: RagAnswer,
  input: Pick<
    SearchChunksArgs,
    "ragQueryPlanKind" | "ragSubquestionCount" | "ragCandidateMatchCounts" | "reviewedPolicyRequest"
  >,
) {
  answer.ragDiagnostics = sanitizeRagEvalDiagnostics({
    ...answer.ragDiagnostics,
    query_plan_kind: input.ragQueryPlanKind,
    subquestion_count: input.ragSubquestionCount,
    reviewed_input_state: reviewedPolicyStateForRequest(input.reviewedPolicyRequest),
  });
  return markAnswerQueryPlanDiagnostics(
    answer,
    boundedAnswerQueryPlanDiagnostics(input) ?? answerQueryPlanDiagnostics.get(answer),
  );
}

export function cloneAnswer(answer: RagAnswer) {
  return markAnswerQueryPlanDiagnostics(structuredClone(answer), answerQueryPlanDiagnostics.get(answer));
}

/** Anonymous callers share no stable identity, so their PHI-bearing answers must never be cached or coalesced. */
export function answerCacheAllowedForOwner(ownerId?: string | null) {
  return Boolean(ownerId);
}

/** Canonical conflict payloads remain request-local and never enter cache identity or telemetry. */
export function answerCacheAllowedForSourcePolicyConflicts(conflicts?: readonly SourcePolicyConflict[]) {
  return !conflicts?.length;
}

type AnswerCachePolicyArgs = SearchChunksArgs & { sourcePolicyConflicts?: readonly SourcePolicyConflict[] };

export function answerCoalescingAllowedForRequest(args: AnswerCachePolicyArgs) {
  return (
    (args.ragQueryPlanMode !== "shadow" || isIssuedRagShadowControl(args)) &&
    answerCacheAllowedForOwner(args.ownerId) &&
    !args.loadReviewedSourcePolicyInput &&
    args.reviewedPolicyRequest?.state !== "reviewed" &&
    answerCacheAllowedForSourcePolicyConflicts(args.sourcePolicyConflicts) &&
    isRagCacheAccessAllowed(args) &&
    !args.skipCache &&
    env.RAG_ANSWER_CACHE_TTL_MS > 0 &&
    env.RAG_ANSWER_CACHE_SIZE > 0
  );
}

export function answerCacheLookupAllowedForRequest(args: AnswerCachePolicyArgs, adversarialQuery: boolean) {
  return (
    (args.ragQueryPlanMode !== "shadow" || isIssuedRagShadowControl(args)) &&
    !adversarialQuery &&
    !args.loadReviewedSourcePolicyInput &&
    args.reviewedPolicyRequest?.state !== "reviewed" &&
    answerCacheAllowedForSourcePolicyConflicts(args.sourcePolicyConflicts) &&
    answerCacheAllowedForOwner(args.ownerId) &&
    !args.skipCache &&
    env.RAG_ANSWER_CACHE_TTL_MS > 0
  );
}

type RagPublicCacheKind = "search" | "answer";
type RagPublicCacheEvidence = Pick<SearchResult, "document_id" | "id">;
export type RagPublicCacheWriteProof = Readonly<{
  version: "rag-public-cache-write-proof-v1";
  cacheKind: RagPublicCacheKind;
  snapshotCacheKey: string;
  selectedEvidenceDigest: string;
  allSelectedEvidencePublic: true;
  pendingExclusion: "not_required" | "proven";
}>;

function selectedEvidenceDigest(selectedEvidence: readonly RagPublicCacheEvidence[]) {
  if (
    selectedEvidence.some(
      (result) =>
        typeof result.document_id !== "string" ||
        result.document_id.length === 0 ||
        typeof result.id !== "string" ||
        result.id.length === 0,
    )
  ) {
    throw new Error("Public cache proof requires stable selected-evidence identities.");
  }
  const tuples = selectedEvidence
    .map((result) => [result.document_id, result.id] as const)
    .sort(([leftDocument, leftId], [rightDocument, rightId]) => {
      const left = `${leftDocument}\0${leftId}`;
      const right = `${rightDocument}\0${rightId}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return createHash("sha256")
    .update(`rag-public-selected-evidence-v1\0${JSON.stringify(tuples)}`)
    .digest("hex");
}

export function createRagPublicCacheWriteProof(input: {
  cacheKind: RagPublicCacheKind;
  requestContext: RagRequestContext;
  accessScope: RetrievalAccessScope;
  selectedEvidence: readonly RagPublicCacheEvidence[];
  allSelectedEvidencePublic: true;
  pendingExclusion: "not_required" | "proven";
}): RagPublicCacheWriteProof {
  assertRagRequestContextIntegrity(input.requestContext);
  if (!(["search", "answer"] as const).includes(input.cacheKind)) {
    throw new Error("Public cache proof requires a supported cache kind.");
  }
  if (!(["not_required", "proven"] as const).includes(input.pendingExclusion)) {
    throw new Error("Public cache proof requires an explicit pending-exclusion verdict.");
  }
  const scope = retrievalAccessScopeForArgs({ accessScope: input.accessScope });
  if (!scope.includePublic || scope.ownerId) throw new Error("Public cache proof requires exact public-only scope.");
  if (input.allSelectedEvidencePublic !== true)
    throw new Error("Public cache proof requires explicit public evidence.");
  const { snapshot, snapshotCacheKey } = input.requestContext;
  if (!/^[0-9a-f]{64}$/.test(snapshotCacheKey) || !["current", "updating"].includes(snapshot.publicSiteContent.state)) {
    throw new Error("Public cache proof requires a current or updating site snapshot.");
  }
  if (snapshot.publicSiteContent.state === "updating" && input.pendingExclusion !== "proven") {
    throw new Error("Updating public cache proof requires exact pending-record exclusion.");
  }
  return Object.freeze({
    version: "rag-public-cache-write-proof-v1",
    cacheKind: input.cacheKind,
    snapshotCacheKey,
    selectedEvidenceDigest: selectedEvidenceDigest(input.selectedEvidence),
    allSelectedEvidencePublic: true,
    pendingExclusion: input.pendingExclusion,
  });
}

function cacheWriteProofAllows(
  args: Pick<SearchChunksArgs, "ragRequestContext" | "ragProgrammeRollout">,
  cacheKind: RagPublicCacheKind,
  selectedEvidence: readonly RagPublicCacheEvidence[],
  proof?: RagPublicCacheWriteProof,
) {
  const snapshotCacheKey = requestSnapshotCacheKey(args);
  if (!snapshotCacheKey) return true;
  const snapshot = args.ragRequestContext?.snapshot;
  if (!snapshot || !proof || !Object.isFrozen(proof)) return false;
  const proofKeys = [
    "allSelectedEvidencePublic",
    "cacheKind",
    "pendingExclusion",
    "selectedEvidenceDigest",
    "snapshotCacheKey",
    "version",
  ];
  if (Object.keys(proof).sort().join("|") !== proofKeys.join("|")) return false;
  if (!/^[0-9a-f]{64}$/.test(snapshotCacheKey)) return false;
  if (!["current", "updating"].includes(snapshot.publicSiteContent.state)) return false;
  if (!["not_required", "proven"].includes(proof.pendingExclusion)) return false;
  if (snapshot.publicSiteContent.state === "updating" && proof.pendingExclusion !== "proven") return false;
  try {
    return (
      proof.version === "rag-public-cache-write-proof-v1" &&
      proof.cacheKind === cacheKind &&
      proof.snapshotCacheKey === snapshotCacheKey &&
      proof.allSelectedEvidencePublic === true &&
      proof.selectedEvidenceDigest === selectedEvidenceDigest(selectedEvidence)
    );
  } catch {
    return false;
  }
}

type SiteAwareWriteArgs = Pick<
  SearchChunksArgs,
  | "query"
  | "documentId"
  | "documentIds"
  | "ownerId"
  | "accessScope"
  | "skipCache"
  | "queryMode"
  | "topK"
  | "minSimilarity"
  | "forceEmbedding"
  | "lexicalOnly"
  | "signal"
  | "ragRequestContext"
  | "ragQueryPlanVersion"
  | "ragQueryPlanMode"
  | "ragProgrammeRollout"
  | "ragQueryPlanKind"
  | "ragSubquestionCount"
  | "governedCorpusComponents"
  | "governedInternationalCoverageGap"
  | "answerSourcePolicy"
>;

type SiteAwareWriteDescriptor = Readonly<{
  args: Readonly<SiteAwareWriteArgs>;
  signal?: AbortSignal;
  invalidationOwnerId: string | null;
  normalizedQuery: string;
  localCacheKey: string;
  sharedOwnerId: string | null;
  sharedScopeKey: string;
  sharedNormalizedQuery: string;
  queryClass?: RagQueryClass;
  queryVariants: readonly string[];
}>;

type SharedCacheRowIdentity = Readonly<{
  ownerId: string | null;
  kind: SharedCacheKind;
  scopeKey: string;
  normalizedQuery: string;
  indexingVersion: string;
  dependencyVersion: typeof ragCacheDependencyVersion;
}>;

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function captureSiteAwareWriteArgs(args: SiteAwareWriteArgs): Readonly<SiteAwareWriteArgs> {
  if (!args.ragRequestContext) throw new Error("Invalid RAG request context.");
  assertRagRequestContextIntegrity(args.ragRequestContext);
  const documentIds = args.documentIds ? ([...args.documentIds] as string[]) : undefined;
  if (documentIds) Object.freeze(documentIds);
  const accessScope = Object.freeze(retrievalAccessScopeForArgs(args));
  const governedCorpusComponents = args.governedCorpusComponents
    ? Object.freeze({ ...args.governedCorpusComponents })
    : undefined;
  return Object.freeze({
    query: args.query,
    answerSourcePolicy: args.answerSourcePolicy,
    documentId: args.documentId,
    documentIds,
    ownerId: args.ownerId,
    accessScope,
    skipCache: args.skipCache,
    queryMode: args.queryMode,
    topK: args.topK,
    minSimilarity: args.minSimilarity,
    forceEmbedding: args.forceEmbedding,
    lexicalOnly: args.lexicalOnly,
    signal: args.signal,
    ragRequestContext: args.ragRequestContext,
    ragQueryPlanVersion: args.ragQueryPlanVersion,
    ragQueryPlanMode: args.ragQueryPlanMode,
    ragProgrammeRollout: args.ragProgrammeRollout,
    ragQueryPlanKind: args.ragQueryPlanKind,
    ragSubquestionCount: args.ragSubquestionCount,
    governedCorpusComponents,
  });
}

function createSiteAwareAnswerWriteDescriptor(args: SiteAwareWriteArgs): SiteAwareWriteDescriptor {
  const capturedArgs = captureSiteAwareWriteArgs(args);
  const queryVariants = Object.freeze([]) as unknown as string[];
  return Object.freeze({
    args: capturedArgs,
    signal: capturedArgs.signal,
    invalidationOwnerId: capturedArgs.ownerId ?? null,
    normalizedQuery: normalizedCacheQuery(capturedArgs.query),
    localCacheKey: scopedAnswerCacheKey(capturedArgs),
    sharedOwnerId: capturedArgs.ownerId ?? null,
    sharedScopeKey: scopeKey(capturedArgs),
    sharedNormalizedQuery: sharedAnswerNormalizedQuery(capturedArgs),
    queryVariants,
  });
}

function sharedCacheRowIdentity(
  descriptor: SiteAwareWriteDescriptor,
  kind: SharedCacheKind,
  indexingVersion: string,
): SharedCacheRowIdentity {
  return Object.freeze({
    ownerId: descriptor.sharedOwnerId,
    kind,
    scopeKey: descriptor.sharedScopeKey,
    normalizedQuery: descriptor.sharedNormalizedQuery,
    indexingVersion,
    dependencyVersion: ragCacheDependencyVersion,
  });
}

export async function getCachedAnswer(
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "accessScope"
    | "skipCache"
    | "queryMode"
    | "ragRequestContext"
    | "ragQueryPlanVersion"
    | "ragQueryPlanMode"
    | "ragProgrammeRollout"
    | "governedCorpusComponents"
    | "governedInternationalCoverageGap"
    | "answerSourcePolicy"
    | "ragQueryPlanKind"
    | "ragSubquestionCount"
  >,
  startedAt: number,
  options?: { indexingVersionAtRequestStart?: string | null },
): Promise<RagAnswer | null> {
  if (
    (args.ragQueryPlanMode === "shadow" && !isIssuedRagShadowControl(args)) ||
    !answerCacheAllowedForOwner(args.ownerId) ||
    args.skipCache ||
    !isRagCacheAccessAllowed(args)
  )
    return null;
  if (env.RAG_ANSWER_CACHE_TTL_MS <= 0 || env.RAG_ANSWER_CACHE_SIZE <= 0) return null;

  const key = scopedAnswerCacheKey(args);
  const cached = answerCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    answerCache.delete(key);
    return null;
  }
  const indexingVersion = options?.indexingVersionAtRequestStart ?? (await cacheIndexingVersion(args));
  if (cached.indexingVersion !== indexingVersion) {
    answerCache.delete(key);
    return null;
  }

  // LRU recency bump (audit L134): a Map preserves insertion order, so without
  // the re-insert a repeatedly-read hot answer still ages out in insertion order
  // and is evicted before answers nobody has asked for since.
  answerCache.delete(key);
  answerCache.set(key, cached);

  const answer = cloneAnswer(cached.answer);
  answer.routingReason = answer.routingReason ? `${answer.routingReason}; answer_cache_hit` : "answer_cache_hit";
  answer.latencyTimings = {
    ...answer.latencyTimings,
    total_latency_ms: Date.now() - startedAt,
  };
  return answer;
}

/**
 * Store an answer in the process-local cache (and, fire-and-forget, the shared cache).
 *
 * Callers may deliberately NOT await this — it is a cache write, never part of the
 * response contract. `answerQuestionWithScopeUncoalesced` defers it on a shared-cache
 * hit precisely so the fastest path in the system does not pay this function's
 * `documents` round trip before responding (latency audit 2026-07-28, L1-1). Deferring
 * is safe only while nothing mutates `answer` after the call: the clone below happens
 * after an `await`, so a caller that mutates it in the meantime would cache the mutation.
 *
 * Do NOT drop the `forceRefresh: true` below to save that round trip. The freshly read
 * indexing version is compared against `indexingVersionAtRetrievalStart` to DISCARD the
 * write when the corpus changed mid-request; reusing an already-held stamp would defeat
 * that staleness guard.
 *
 * Deferred callers must also survive `invalidateRagCachesForOwner` during the await:
 * the owner-scoped invalidation epoch checks below discard a post-invalidation write
 * even when the documents indexing stamp is unchanged (table-fact / review mutations),
 * including after the shared-cache row commit so a late invalidation cannot leave a
 * stale shared answer behind.
 *
 * The shared-cache promote itself stays off the response path (fire-and-forget): cold
 * generation callers `await setCachedAnswer` only for the local write + indexing stamp
 * round trip, not for the `rag_response_cache` delete/insert.
 */
export async function setCachedAnswer(
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "accessScope"
    | "skipCache"
    | "queryMode"
    | "forceEmbedding"
    | "signal"
    | "ragRequestContext"
    | "ragQueryPlanVersion"
    | "ragQueryPlanMode"
    | "ragProgrammeRollout"
    | "ragQueryPlanKind"
    | "ragSubquestionCount"
    | "governedCorpusComponents"
    | "governedInternationalCoverageGap"
    | "answerSourcePolicy"
  >,
  answer: RagAnswer,
  options?: { indexingVersionAtRetrievalStart?: string | null; publicCacheWriteProof?: RagPublicCacheWriteProof },
): Promise<void> {
  if (
    (args.ragQueryPlanMode === "shadow" && !isIssuedRagShadowControl(args)) ||
    !answerCacheAllowedForOwner(args.ownerId) ||
    args.skipCache ||
    !isRagCacheAccessAllowed(args)
  )
    return;
  const queryPlanDiagnostics = persistableAnswerQueryPlanDiagnostics(
    boundedAnswerQueryPlanDiagnostics(args) ?? answerQueryPlanDiagnostics.get(answer),
  );
  const snapshotCacheKey = requestSnapshotCacheKey(args);
  if (snapshotCacheKey) {
    const proof = options?.publicCacheWriteProof;
    if (!proof || !cacheWriteProofAllows(args, "answer", answer.sources ?? [], proof)) return;
    if (env.RAG_ANSWER_CACHE_TTL_MS <= 0 || env.RAG_ANSWER_CACHE_SIZE <= 0) return;
    const capturedAnswer = deepFreeze(markAnswerQueryPlanDiagnostics(cloneAnswer(answer), queryPlanDiagnostics));
    const descriptor = createSiteAwareAnswerWriteDescriptor(args);
    if (!cacheWriteProofAllows(descriptor.args, "answer", capturedAnswer.sources ?? [], proof)) return;
    const indexingVersionAtRetrievalStart = options?.indexingVersionAtRetrievalStart;
    const invalidationEpochAtStart = captureInvalidationEpoch(descriptor.invalidationOwnerId);
    const indexingVersion = await cacheIndexingVersion(descriptor.args, { forceRefresh: true });
    throwIfAborted(descriptor.signal);
    if (invalidationEpochChanged(descriptor.invalidationOwnerId, invalidationEpochAtStart)) return;
    if (indexingVersionAtRetrievalStart && indexingVersion !== indexingVersionAtRetrievalStart) return;
    answerCache.set(descriptor.localCacheKey, {
      expiresAt: Date.now() + env.RAG_ANSWER_CACHE_TTL_MS,
      answer: capturedAnswer,
      indexingVersion,
    });

    while (answerCache.size > env.RAG_ANSWER_CACHE_SIZE) {
      const oldestKey = answerCache.keys().next().value;
      if (!oldestKey) break;
      answerCache.delete(oldestKey);
    }
    if (invalidationEpochChanged(descriptor.invalidationOwnerId, invalidationEpochAtStart)) {
      answerCache.delete(descriptor.localCacheKey);
      return;
    }
    const rowIdentity = sharedCacheRowIdentity(descriptor, "answer", indexingVersion);
    void (async () => {
      await setSharedSiteAwareCachedAnswer(descriptor, rowIdentity, capturedAnswer, proof);
      if (!invalidationEpochChanged(descriptor.invalidationOwnerId, invalidationEpochAtStart)) return;
      answerCache.delete(descriptor.localCacheKey);
      await deleteSharedCacheRowByIdentity(rowIdentity);
    })().catch(() => undefined);
    return;
  }
  if (!cacheWriteProofAllows(args, "answer", answer.sources ?? [], options?.publicCacheWriteProof)) return;
  if (env.RAG_ANSWER_CACHE_TTL_MS <= 0 || env.RAG_ANSWER_CACHE_SIZE <= 0) return;

  const invalidationEpochAtStart = captureInvalidationEpoch(args.ownerId);
  const indexingVersion = await cacheIndexingVersion(args, { forceRefresh: true });
  if (invalidationEpochChanged(args.ownerId, invalidationEpochAtStart)) return;
  if (options?.indexingVersionAtRetrievalStart && indexingVersion !== options.indexingVersionAtRetrievalStart) return;
  // An unavailable stamp cannot vouch for the corpus, so a write under it would
  // be matched later by another failed read and served as fresh (audit L21).
  if (isUnavailableIndexingStamp(indexingVersion)) return;
  const key = scopedAnswerCacheKey(args);
  // Delete before set so a refreshed answer moves to the most-recent position
  // rather than keeping its original insertion slot (audit L134).
  answerCache.delete(key);
  answerCache.set(key, {
    expiresAt: Date.now() + env.RAG_ANSWER_CACHE_TTL_MS,
    answer: markAnswerQueryPlanDiagnostics(cloneAnswer(answer), queryPlanDiagnostics),
    indexingVersion,
  });

  while (answerCache.size > env.RAG_ANSWER_CACHE_SIZE) {
    const oldestKey = answerCache.keys().next().value;
    if (!oldestKey) break;
    answerCache.delete(oldestKey);
  }
  if (invalidationEpochChanged(args.ownerId, invalidationEpochAtStart)) {
    answerCache.delete(key);
    return;
  }
  void (async () => {
    await setSharedCachedAnswer(args, answer, indexingVersion, options?.publicCacheWriteProof);
    if (!invalidationEpochChanged(args.ownerId, invalidationEpochAtStart)) return;
    answerCache.delete(key);
    await deleteSharedCachedAnswerRow(args, indexingVersion);
  })().catch(() => undefined);
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function retrievalPlanCacheQuery(
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "queryMode"
    | "topK"
    | "minSimilarity"
    | "forceEmbedding"
    | "lexicalOnly"
    | "ragRequestContext"
    | "ragQueryPlanVersion"
    | "ragQueryPlanMode"
    | "ragProgrammeRollout"
    | "governedCorpusComponents"
    | "governedInternationalCoverageGap"
    | "answerSourcePolicy"
  >,
  queryClass?: RagQueryClass,
  queryVariants: string[] = [],
) {
  const normalizedQuery = normalizedCacheQuery(args.query);
  const variantHash = stableHash(queryVariants.join("\n"));
  const cacheKey = [
    `plan:${retrievalPlanForQueryClass(queryClass)}`,
    `class:${queryClass ?? "unknown"}`,
    `query:${normalizedQuery}`,
    ...(args.ragProgrammeRollout?.servedMode === "candidate" ? [`request:${ragCacheFingerprint(args)}`] : []),
    `variants:${variantHash}`,
    `queryPlan:${args.ragQueryPlanVersion ?? "rag-query-plan-v1"}`,
    `queryPlanMode:${args.ragProgrammeRollout?.servedMode === "legacy" ? "legacy" : (args.ragQueryPlanMode ?? "legacy")}`,
    governedCorpusComponentCacheNamespace(
      "corpora",
      args.ragProgrammeRollout?.servedMode === "legacy" ? undefined : args.governedCorpusComponents,
    ),
    `mode:${modeKey(args)}`,
    `topK:${args.topK ?? 8}`,
    `min:${args.minSimilarity ?? 0.15}`,
    `forceEmbedding:${args.forceEmbedding ? "1" : "0"}`,
    `lexicalOnly:${args.lexicalOnly ? "1" : "0"}`,
    `rag:${ragDeepMemoryVersion}`,
    `force:${args.forceEmbedding ? 1 : 0}`,
    ...(env.RAG_SEMANTIC_RERANK_ENABLED ? [`semanticRerank:${env.OPENAI_RERANK_MODEL}`] : []),
    ...(requestCacheNamespace(args) ? [`snapshot:${requestCacheNamespace(args)}`] : []),
  ].join("|");
  return queryCacheKeyForStorage(cacheKey, args.query);
}

export function scopedSearchCacheKey(args: SearchChunksArgs, queryClass?: RagQueryClass, queryVariants: string[] = []) {
  return [
    ragCacheDependencyVersion,
    args.ragProgrammeRollout?.servedMode === "candidate"
      ? `${hashQueryText(scopeKey(args))}|${args.ownerId ? siteAwareAnswerOwnerToken(args.ownerId) : "anonymous"}`
      : scopeKey(args),
    retrievalPlanCacheQuery(args, queryClass, queryVariants),
  ].join("|");
}

function createSiteAwareSearchWriteDescriptor(
  args: SearchChunksArgs,
  queryClass: RagQueryClass | undefined,
  queryVariants: string[],
): SiteAwareWriteDescriptor {
  const capturedArgs = captureSiteAwareWriteArgs(args);
  const capturedVariants = Object.freeze([...queryVariants]) as unknown as string[];
  return Object.freeze({
    args: capturedArgs,
    signal: capturedArgs.signal,
    invalidationOwnerId: capturedArgs.ownerId ?? null,
    normalizedQuery: normalizedCacheQuery(capturedArgs.query),
    localCacheKey: scopedSearchCacheKey(capturedArgs as SearchChunksArgs, queryClass, capturedVariants),
    sharedOwnerId: null,
    sharedScopeKey: scopeKey(capturedArgs),
    sharedNormalizedQuery: retrievalPlanCacheQuery(capturedArgs, queryClass, capturedVariants),
    queryClass,
    queryVariants: capturedVariants,
  });
}

function cloneSearchResults(results: SearchResult[]) {
  return restoreCachedContextPackAdmission(structuredClone(results));
}

function normalizeCacheStorageTelemetry(telemetry: SearchTelemetry, shadowControl = false): SearchTelemetry {
  const cacheTelemetry = { ...telemetry };
  delete cacheTelemetry.candidate_match_counts;
  if (shadowControl) {
    delete cacheTelemetry.shadow_retrieval_state;
    delete cacheTelemetry.candidate_retrieval_query_variant_count;
  }
  const {
    query_plan_kind,
    subquestion_count,
    query_plan_reason_codes,
    candidate_retrieval_query_variant_count,
    ...cacheSafeTelemetry
  } = cacheTelemetry;
  return {
    ...cacheSafeTelemetry,
    ...sanitizeRagQueryPlanDiagnostics({
      query_plan_kind,
      subquestion_count,
      query_plan_reason_codes,
      candidate_retrieval_query_variant_count,
    }),
    shared_cache_hit: false,
    shared_cache_status: undefined,
    shared_cache_miss_reason: null,
    search_total_latency_ms: undefined,
    retrieval_phase_latencies_ms: undefined,
  };
}

// Single source of truth for whether the process-local search cache is active
// for a request. Shared with the observability counter so a size-0 (or TTL-0 /
// skipCache) deployment records the lookup as neither hit nor miss rather than a
// false miss (the shared-cache lookup does not itself short-circuit on size).
export function isSearchCacheEnabled(args: Pick<SearchChunksArgs, "skipCache">): boolean {
  return !args.skipCache && env.RAG_SEARCH_CACHE_TTL_MS > 0 && env.RAG_SEARCH_CACHE_SIZE > 0;
}

export function isSearchCacheLookupEnabled(args: Pick<SearchChunksArgs, "skipCache">): boolean {
  return !args.skipCache && env.RAG_SEARCH_CACHE_TTL_MS > 0;
}

export async function getCachedSearch(
  args: SearchChunksArgs,
  queryClass?: RagQueryClass,
  queryVariants: string[] = [],
  options?: { indexingVersionAtRequestStart?: string | null },
): Promise<{ results: SearchResult[]; telemetry: SearchTelemetry } | null> {
  throwIfAborted(args.signal);
  if (!isSearchCacheEnabled(args) || !isRagCacheAccessAllowed(args)) return null;

  const key = scopedSearchCacheKey(args, queryClass, queryVariants);
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  const indexingVersion = options?.indexingVersionAtRequestStart ?? (await cacheIndexingVersion(args));
  throwIfAborted(args.signal);
  if (cached.indexingVersion !== indexingVersion) {
    searchCache.delete(key);
    return null;
  }

  return {
    results: cloneSearchResults(cached.results),
    telemetry: {
      ...cached.telemetry,
      search_cache_hit: true,
      retrieval_strategy: "search_cache" as const,
      text_fast_path_latency_ms: 0,
      embedding_latency_ms: 0,
      supabase_rpc_latency_ms: 0,
      rerank_latency_ms: 0,
      semantic_rerank_invoked: false,
      semantic_rerank_candidate_count: 0,
      semantic_rerank_latency_ms: 0,
      semantic_rerank_outcome: "not_invoked" as const,
      semantic_rerank_fallback_reason: undefined,
      shared_cache_hit: false,
      shared_cache_status: undefined,
      shared_cache_miss_reason: null,
    },
  };
}

export async function setCachedSearch(
  args: SearchChunksArgs,
  results: SearchResult[],
  telemetry: SearchTelemetry,
  queryVariants: string[] = [],
  options?: { indexingVersionAtRetrievalStart?: string | null; publicCacheWriteProof?: RagPublicCacheWriteProof },
): Promise<void> {
  throwIfAborted(args.signal);
  if (args.ragQueryPlanMode === "shadow" && !isIssuedRagShadowControl(args)) return;
  if (
    args.skipCache ||
    env.RAG_SEARCH_CACHE_TTL_MS <= 0 ||
    env.RAG_SEARCH_CACHE_SIZE <= 0 ||
    !isRagCacheAccessAllowed(args)
  )
    return;
  const snapshotCacheKey = requestSnapshotCacheKey(args);
  if (snapshotCacheKey) {
    const proof = options?.publicCacheWriteProof;
    if (!proof || !cacheWriteProofAllows(args, "search", results, proof)) return;
    const capturedResults = deepFreeze(cloneSearchResults(results));
    const capturedTelemetry = deepFreeze(
      structuredClone(normalizeCacheStorageTelemetry(telemetry, isIssuedRagShadowControl(args))),
    );
    const descriptor = createSiteAwareSearchWriteDescriptor(args, capturedTelemetry.query_class, queryVariants);
    if (!cacheWriteProofAllows(descriptor.args, "search", capturedResults, proof)) return;
    const indexingVersionAtRetrievalStart = options?.indexingVersionAtRetrievalStart;
    const indexingVersion = await cacheIndexingVersion(descriptor.args, { forceRefresh: true });
    throwIfAborted(descriptor.signal);
    if (indexingVersionAtRetrievalStart && indexingVersion !== indexingVersionAtRetrievalStart) return;
    searchCache.set(descriptor.localCacheKey, {
      expiresAt: Date.now() + env.RAG_SEARCH_CACHE_TTL_MS,
      results: capturedResults,
      telemetry: capturedTelemetry,
      indexingVersion,
    });

    while (searchCache.size > env.RAG_SEARCH_CACHE_SIZE) {
      const oldestKey = searchCache.keys().next().value;
      if (!oldestKey) break;
      searchCache.delete(oldestKey);
    }
    setSharedSiteAwareCachedSearch(descriptor, capturedResults, capturedTelemetry, indexingVersion, proof);
    return;
  }
  if (!cacheWriteProofAllows(args, "search", results, options?.publicCacheWriteProof)) return;
  const cacheTelemetry = normalizeCacheStorageTelemetry(telemetry, isIssuedRagShadowControl(args));
  const clonedResults = cloneSearchResults(results);

  const indexingVersion = await cacheIndexingVersion(args, { forceRefresh: true });
  throwIfAborted(args.signal);
  if (options?.indexingVersionAtRetrievalStart && indexingVersion !== options.indexingVersionAtRetrievalStart) return;
  if (isUnavailableIndexingStamp(indexingVersion)) return;
  const key = scopedSearchCacheKey(args, telemetry.query_class, queryVariants);
  searchCache.delete(key);
  searchCache.set(key, {
    expiresAt: Date.now() + env.RAG_SEARCH_CACHE_TTL_MS,
    results: clonedResults,
    telemetry: { ...cacheTelemetry },
    indexingVersion,
  });

  while (searchCache.size > env.RAG_SEARCH_CACHE_SIZE) {
    const oldestKey = searchCache.keys().next().value;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
  setSharedCachedSearch(
    args,
    clonedResults,
    cacheTelemetry,
    indexingVersion,
    queryVariants,
    options?.publicCacheWriteProof,
  );
}

type SharedCacheKind = "search" | "answer";
type SharedCacheMissReason =
  "cache_lookup_error" | "cache_lookup_exception" | "cache_payload_invalid" | "unknown_filter_miss";

function sharedCacheSelector(
  supabase: ReturnType<typeof createAdminClient>,
  kind: SharedCacheKind,
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "accessScope"
    | "queryMode"
    | "forceEmbedding"
    | "signal"
    | "ragRequestContext"
  >,
  indexingVersion: string,
  // Required, not defaulted: "search" and "answer" rows key their query differently (plan
  // versus question identity), so there is no safe default a caller can fall back into.
  normalizedQuery: string,
) {
  let query = supabase
    .from("rag_response_cache")
    .select("payload")
    .eq("cache_kind", kind)
    .eq("scope_key", scopeKey(args))
    .eq("normalized_query", normalizedQuery)
    .eq("indexing_version", indexingVersion)
    .eq("dependency_version", ragCacheDependencyVersion)
    .gt("expires_at", new Date().toISOString())
    .limit(1);

  const ownerId = kind === "search" && requestSnapshotCacheKey(args) ? null : args.ownerId;
  query = ownerId ? query.eq("owner_id", ownerId) : query.is("owner_id", null);
  return query;
}

const GENERATION_FALLBACK_MARKER = /(?:^|;\s*)generation_fallback(?::|$)/i;
function isGenerationFallbackAnswer(answer: Pick<RagAnswer, "routingReason" | "degradedMode">) {
  return (
    GENERATION_FALLBACK_MARKER.test(answer.routingReason ?? "") ||
    GENERATION_FALLBACK_MARKER.test(answer.degradedMode?.reason ?? "")
  );
}

export async function cacheIndexingVersion(
  args: Pick<SearchChunksArgs, "documentId" | "documentIds" | "ownerId" | "accessScope" | "signal">,
  options?: { forceRefresh?: boolean },
) {
  throwIfAborted(args.signal);
  const cacheKey = cacheIndexingVersionCacheKey(args);
  if (options?.forceRefresh) cacheIndexingVersionCache.delete(cacheKey);
  const cached = readExpiringCacheEntry(cacheIndexingVersionCache, cacheKey);
  if (cached) return cached.value;

  let value = `${ragDeepMemoryVersion}:${INDEXING_STAMP_UNAVAILABLE}`;
  try {
    const supabase = createAdminClient();
    const documentFilters = args.documentIds?.length ? args.documentIds : args.documentId ? [args.documentId] : null;
    let query = supabase
      .from("documents")
      .select("id,updated_at,metadata")
      .eq("status", "indexed")
      .order("updated_at", { ascending: false })
      .limit(1);
    const accessScope = retrievalAccessScopeForArgs(args);
    if (accessScope.ownerId && accessScope.includePublic) {
      query = query.or(`owner_id.eq.${accessScope.ownerId},owner_id.is.null`);
    } else if (accessScope.ownerId) {
      query = query.eq("owner_id", accessScope.ownerId);
    } else {
      query = query.is("owner_id", null);
    }
    if (documentFilters?.length) query = query.in("id", documentFilters);
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query;
    throwIfAborted(args.signal);
    if (error) {
      // A failed read is NOT an empty corpus (audit L21).
      value = `${ragDeepMemoryVersion}:${INDEXING_STAMP_UNAVAILABLE}`;
    } else if (!data?.length) {
      value = `${ragDeepMemoryVersion}:${INDEXING_STAMP_EMPTY_CORPUS}`;
    } else {
      const latest = data[0] as { id?: string; updated_at?: string | null; metadata?: unknown };
      const metadata = normalizeSourceMetadata(latest.metadata);
      const indexedAt = metadata.indexed_at ?? latest.updated_at ?? "unknown";
      const generationId =
        latest.metadata && typeof latest.metadata === "object" && "index_generation_id" in latest.metadata
          ? String((latest.metadata as { index_generation_id?: unknown }).index_generation_id ?? "")
          : "";
      value = `${ragDeepMemoryVersion}:${latest.id ?? "all"}:${indexedAt}:${generationId}`;
    }
  } catch {
    if (args.signal?.aborted) throw abortReason(args.signal);
    value = `${ragDeepMemoryVersion}:${INDEXING_STAMP_UNAVAILABLE}`;
  }
  throwIfAborted(args.signal);
  writeBoundedExpiringCacheEntry(
    cacheIndexingVersionCache,
    cacheKey,
    { value, expiresAt: Date.now() + cacheIndexingVersionTtlMs },
    cacheIndexingVersionMaxEntries,
  );
  return value;
}

export async function getSharedCachedSearch(
  args: SearchChunksArgs,
  queryClass?: RagQueryClass,
  queryVariants: string[] = [],
  options?: { indexingVersionAtRequestStart?: string | null },
): Promise<
  | { kind: "hit"; results: SearchResult[]; telemetry: SearchTelemetry }
  | { kind: "miss"; reason: SharedCacheMissReason }
  | null
> {
  throwIfAborted(args.signal);
  if (args.skipCache || env.RAG_SEARCH_CACHE_TTL_MS <= 0 || !isRagCacheAccessAllowed(args)) return null;
  const normalizedQuery = retrievalPlanCacheQuery(args, queryClass, queryVariants);
  const indexingVersion = options?.indexingVersionAtRequestStart ?? (await cacheIndexingVersion(args));
  try {
    let query = sharedCacheSelector(createAdminClient(), "search", args, indexingVersion, normalizedQuery);
    if (args.signal) query = query.abortSignal(args.signal);
    const { data, error } = await query.maybeSingle();
    throwIfAborted(args.signal);
    if (error) return { kind: "miss", reason: "cache_lookup_error" };
    // The selector deliberately folds TTL, dependency, and indexing-version
    // validity into the hit query. Keep a filtered miss coarse rather than pay
    // a second cross-region lookup solely to distinguish those miss classes.
    if (!data?.payload) return { kind: "miss", reason: "unknown_filter_miss" };
    const payload = data.payload as { results?: SearchResult[]; telemetry?: Partial<SearchTelemetry> };
    if (!Array.isArray(payload.results)) {
      return { kind: "miss", reason: "cache_payload_invalid" };
    }
    return {
      kind: "hit",
      results: cloneSearchResults(payload.results),
      telemetry: {
        search_cache_hit: true,
        shared_cache_hit: true,
        shared_cache_status: "hit",
        shared_cache_miss_reason: null,
        governed_component_state: governedCorpusComponentState(args.governedCorpusComponents),
        query_class: payload.telemetry?.query_class,
        corpus_grounding: payload.telemetry?.corpus_grounding,
        vector_candidate_count: payload.telemetry?.vector_candidate_count,
        text_candidate_count: payload.telemetry?.text_candidate_count,
        embedding_field_count: payload.telemetry?.embedding_field_count,
        retrieval_query_variant_count: payload.telemetry?.retrieval_query_variant_count ?? 0,
        ...sanitizeRagQueryPlanDiagnostics({
          query_plan_kind: payload.telemetry?.query_plan_kind,
          subquestion_count: payload.telemetry?.subquestion_count,
          query_plan_reason_codes: payload.telemetry?.query_plan_reason_codes,
          candidate_retrieval_query_variant_count: payload.telemetry?.candidate_retrieval_query_variant_count,
        }),
        text_fast_path_latency_ms: 0,
        text_candidate_budget: payload.telemetry?.text_candidate_budget,
        text_fast_path_reason: payload.telemetry?.text_fast_path_reason ?? null,
        embedding_skipped: true,
        embedding_skip_reason: payload.telemetry?.embedding_skip_reason ?? "search_cache",
        embedding_latency_ms: 0,
        embedding_cache_hit: false,
        supabase_rpc_latency_ms: 0,
        rerank_latency_ms: 0,
        memory_card_count: payload.telemetry?.memory_card_count ?? 0,
        memory_top_score: payload.telemetry?.memory_top_score ?? 0,
        index_unit_count: payload.telemetry?.index_unit_count ?? 0,
        index_unit_top_score: payload.telemetry?.index_unit_top_score ?? 0,
        retrieval_plan: payload.telemetry?.retrieval_plan ?? retrievalPlanForQueryClass(payload.telemetry?.query_class),
        retrieval_intent: payload.telemetry?.retrieval_intent,
        retrieval_selection: payload.telemetry?.retrieval_selection,
        retrieval_layer_counts: payload.telemetry?.retrieval_layer_counts ?? {},
        retrieval_layer_top_scores: payload.telemetry?.retrieval_layer_top_scores ?? {},
        retrieval_layer_latencies_ms: payload.telemetry?.retrieval_layer_latencies_ms ?? {},
        retrieval_provenance_counts: payload.telemetry?.retrieval_provenance_counts ?? {},
        coverage_gate_decision: payload.telemetry?.coverage_gate_decision,
        coverage_gate_reason: payload.telemetry?.coverage_gate_reason ?? null,
        vector_skipped_reason: payload.telemetry?.vector_skipped_reason ?? null,
        source_image_required: payload.telemetry?.source_image_required ?? false,
        source_image_satisfied: payload.telemetry?.source_image_satisfied ?? false,
        second_stage_rerank_used: payload.telemetry?.second_stage_rerank_used ?? false,
        second_stage_rerank_latency_ms: 0,
        semantic_rerank_eligibility: payload.telemetry?.semantic_rerank_eligibility,
        semantic_rerank_invoked: false,
        semantic_rerank_model: payload.telemetry?.semantic_rerank_model,
        semantic_rerank_candidate_count: 0,
        semantic_rerank_latency_ms: 0,
        semantic_rerank_outcome: "not_invoked" as const,
        semantic_rerank_fallback_reason: undefined,
        visual_direct_image_count: payload.telemetry?.visual_direct_image_count ?? 0,
        weighted_top_score: payload.telemetry?.weighted_top_score ?? 0,
        rrf_top_score: payload.telemetry?.rrf_top_score ?? 0,
        retrieval_strategy: "search_cache" as const,
      },
    };
  } catch {
    if (args.signal?.aborted) throw abortReason(args.signal);
    return { kind: "miss", reason: "cache_lookup_exception" };
  }
}

export async function getSharedCachedAnswer(
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "accessScope"
    | "skipCache"
    | "queryMode"
    | "forceEmbedding"
    | "signal"
    | "ragRequestContext"
    | "ragQueryPlanVersion"
    | "ragQueryPlanMode"
    | "ragProgrammeRollout"
    | "governedCorpusComponents"
    | "governedInternationalCoverageGap"
    | "answerSourcePolicy"
  >,
  startedAt: number,
  options?: { indexingVersionAtRequestStart?: string | null },
) {
  throwIfAborted(args.signal);
  if (
    (args.ragQueryPlanMode === "shadow" && !isIssuedRagShadowControl(args)) ||
    !answerCacheAllowedForOwner(args.ownerId) ||
    args.skipCache ||
    env.RAG_ANSWER_CACHE_TTL_MS <= 0 ||
    !isRagCacheAccessAllowed(args)
  )
    return null;
  try {
    const indexingVersion = options?.indexingVersionAtRequestStart ?? (await cacheIndexingVersion(args));
    const { data, error } = await sharedCacheSelector(
      createAdminClient(),
      "answer",
      args,
      indexingVersion,
      sharedAnswerNormalizedQuery(args),
    ).maybeSingle();
    if (error || !data?.payload) return null;
    throwIfAborted(args.signal);
    const payload = data.payload as { answer: RagAnswer; queryPlanDiagnostics?: unknown };
    const answer = markAnswerQueryPlanDiagnostics(
      cloneAnswer(payload.answer),
      storedAnswerQueryPlanDiagnostics(payload.queryPlanDiagnostics),
    );
    if (isGenerationFallbackAnswer(answer)) {
      await deleteSharedCachedAnswerRow({ ...args, accessScope: retrievalAccessScopeForArgs(args) }, indexingVersion);
      return null;
    }
    answer.routingReason = answer.routingReason
      ? `${answer.routingReason}; shared_answer_cache_hit`
      : "shared_answer_cache_hit";
    answer.latencyTimings = {
      ...answer.latencyTimings,
      search_cache_hit: true,
      shared_cache_hit: true,
      shared_cache_status: "hit",
      shared_cache_miss_reason: null,
      total_latency_ms: Date.now() - startedAt,
    };
    return answer;
  } catch {
    if (args.signal?.aborted) throw abortReason(args.signal);
    return null;
  }
}

async function replaceLegacySharedCacheRow(
  kind: SharedCacheKind,
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "accessScope"
    | "queryMode"
    | "forceEmbedding"
    | "signal"
    | "ragRequestContext"
  >,
  payload: unknown,
  ttlMs: number,
  indexingVersion: string,
  // Required for the same reason as in `sharedCacheSelector`: a defaulted key here would
  // write an answer row under the search cache's lossy plan key.
  normalizedQuery: string,
) {
  if (ttlMs <= 0) return;
  try {
    if (args.signal?.aborted) return;
    const ownerId = kind === "search" && requestSnapshotCacheKey(args) ? null : args.ownerId;
    const supabase = createAdminClient();
    let deleteQuery = supabase
      .from("rag_response_cache")
      .delete()
      .eq("cache_kind", kind)
      .eq("scope_key", scopeKey(args))
      .eq("normalized_query", normalizedQuery)
      .eq("indexing_version", indexingVersion)
      .eq("dependency_version", ragCacheDependencyVersion);
    deleteQuery = ownerId ? deleteQuery.eq("owner_id", ownerId) : deleteQuery.is("owner_id", null);
    if (args.signal) deleteQuery = deleteQuery.abortSignal(args.signal);
    await deleteQuery;
    if (args.signal?.aborted) return;
    let insertQuery = supabase.from("rag_response_cache").insert({
      owner_id: ownerId ?? null,
      cache_kind: kind,
      scope_key: scopeKey(args),
      normalized_query: normalizedQuery,
      indexing_version: indexingVersion,
      dependency_version: ragCacheDependencyVersion,
      // JSON-serializable by contract of the response cache.
      payload: payload as Json,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
    if (args.signal) insertQuery = insertQuery.abortSignal(args.signal);
    await insertQuery;
  } catch {
    // Shared cache must never be part of the correctness path.
  }
}

async function replaceSharedCacheRow(
  identity: SharedCacheRowIdentity,
  payload: unknown,
  ttlMs: number,
  signal?: AbortSignal,
) {
  if (ttlMs <= 0) return;
  try {
    if (signal?.aborted) return;
    const supabase = createAdminClient();
    let deleteQuery = supabase
      .from("rag_response_cache")
      .delete()
      .eq("cache_kind", identity.kind)
      .eq("scope_key", identity.scopeKey)
      .eq("normalized_query", identity.normalizedQuery)
      .eq("indexing_version", identity.indexingVersion)
      .eq("dependency_version", identity.dependencyVersion);
    deleteQuery = identity.ownerId ? deleteQuery.eq("owner_id", identity.ownerId) : deleteQuery.is("owner_id", null);
    if (signal) deleteQuery = deleteQuery.abortSignal(signal);
    await deleteQuery;
    if (signal?.aborted) return;
    let insertQuery = supabase.from("rag_response_cache").insert({
      owner_id: identity.ownerId,
      cache_kind: identity.kind,
      scope_key: identity.scopeKey,
      normalized_query: identity.normalizedQuery,
      indexing_version: identity.indexingVersion,
      dependency_version: identity.dependencyVersion,
      payload: payload as Json,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
    if (signal) insertQuery = insertQuery.abortSignal(signal);
    await insertQuery;
  } catch {
    // Shared cache must never be part of the correctness path.
  }
}

function setSharedCachedSearch(
  args: SearchChunksArgs,
  results: SearchResult[],
  telemetry: SearchTelemetry,
  indexingVersion: string,
  queryVariants: string[] = [],
  publicCacheWriteProof?: RagPublicCacheWriteProof,
) {
  if (
    args.skipCache ||
    env.RAG_SEARCH_CACHE_TTL_MS <= 0 ||
    !isRagCacheAccessAllowed(args) ||
    !cacheWriteProofAllows(args, "search", results, publicCacheWriteProof)
  )
    return;
  void replaceLegacySharedCacheRow(
    "search",
    args,
    { results: cloneSearchResults(results), telemetry },
    env.RAG_SEARCH_CACHE_TTL_MS,
    indexingVersion,
    retrievalPlanCacheQuery(args, telemetry.query_class, queryVariants),
  );
}

function setSharedSiteAwareCachedSearch(
  descriptor: SiteAwareWriteDescriptor,
  results: readonly SearchResult[],
  telemetry: Readonly<SearchTelemetry>,
  indexingVersion: string,
  publicCacheWriteProof: RagPublicCacheWriteProof,
) {
  if (descriptor.signal?.aborted || env.RAG_SEARCH_CACHE_TTL_MS <= 0) return;
  if (!cacheWriteProofAllows(descriptor.args, "search", results, publicCacheWriteProof)) return;
  const isolatedResults = deepFreeze(cloneSearchResults(results as SearchResult[]));
  const isolatedTelemetry = deepFreeze(structuredClone(telemetry));
  const payload = deepFreeze({ results: isolatedResults, telemetry: isolatedTelemetry });
  const rowIdentity = sharedCacheRowIdentity(descriptor, "search", indexingVersion);
  void replaceSharedCacheRow(rowIdentity, payload, env.RAG_SEARCH_CACHE_TTL_MS, descriptor.signal);
}

async function setSharedCachedAnswer(
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "accessScope"
    | "skipCache"
    | "queryMode"
    | "forceEmbedding"
    | "ragRequestContext"
    | "ragQueryPlanVersion"
    | "ragQueryPlanMode"
    | "ragProgrammeRollout"
    | "ragQueryPlanKind"
    | "ragSubquestionCount"
    | "governedCorpusComponents"
    | "governedInternationalCoverageGap"
    | "answerSourcePolicy"
  >,
  answer: RagAnswer,
  indexingVersion: string,
  publicCacheWriteProof?: RagPublicCacheWriteProof,
) {
  if (
    (args.ragQueryPlanMode === "shadow" && !isIssuedRagShadowControl(args)) ||
    !answerCacheAllowedForOwner(args.ownerId) ||
    args.skipCache ||
    env.RAG_ANSWER_CACHE_TTL_MS <= 0 ||
    !isRagCacheAccessAllowed(args) ||
    !cacheWriteProofAllows(args, "answer", answer.sources ?? [], publicCacheWriteProof)
  )
    return;
  await replaceLegacySharedCacheRow(
    "answer",
    args,
    {
      answer: cloneAnswer(answer),
      queryPlanDiagnostics: persistableAnswerQueryPlanDiagnostics(
        answerQueryPlanDiagnostics.get(answer) ?? boundedAnswerQueryPlanDiagnostics(args),
      ),
    },
    env.RAG_ANSWER_CACHE_TTL_MS,
    indexingVersion,
    sharedAnswerNormalizedQuery(args),
  );
}

async function setSharedSiteAwareCachedAnswer(
  descriptor: SiteAwareWriteDescriptor,
  rowIdentity: SharedCacheRowIdentity,
  answer: Readonly<RagAnswer>,
  publicCacheWriteProof: RagPublicCacheWriteProof,
) {
  if (
    descriptor.signal?.aborted ||
    env.RAG_ANSWER_CACHE_TTL_MS <= 0 ||
    !cacheWriteProofAllows(descriptor.args, "answer", answer.sources ?? [], publicCacheWriteProof)
  )
    return;
  const isolatedAnswer = deepFreeze(cloneAnswer(answer as RagAnswer));
  const payload = deepFreeze({
    answer: isolatedAnswer,
    queryPlanDiagnostics: persistableAnswerQueryPlanDiagnostics(
      answerQueryPlanDiagnostics.get(answer as RagAnswer) ?? boundedAnswerQueryPlanDiagnostics(descriptor.args),
    ),
  });
  await replaceSharedCacheRow(rowIdentity, payload, env.RAG_ANSWER_CACHE_TTL_MS, descriptor.signal);
}

async function deleteSharedCacheRowByIdentity(identity: SharedCacheRowIdentity) {
  try {
    let deleteQuery = createAdminClient()
      .from("rag_response_cache")
      .delete()
      .eq("cache_kind", identity.kind)
      .eq("scope_key", identity.scopeKey)
      .eq("normalized_query", identity.normalizedQuery)
      .eq("indexing_version", identity.indexingVersion)
      .eq("dependency_version", identity.dependencyVersion);
    deleteQuery = identity.ownerId ? deleteQuery.eq("owner_id", identity.ownerId) : deleteQuery.is("owner_id", null);
    await deleteQuery;
  } catch (error) {
    console.warn("Shared answer cache post-invalidation cleanup failed:", error);
  }
}

async function deleteSharedCachedAnswerRow(
  args: Pick<
    SearchChunksArgs,
    | "query"
    | "documentId"
    | "documentIds"
    | "ownerId"
    | "accessScope"
    | "queryMode"
    | "ragRequestContext"
    | "ragQueryPlanVersion"
    | "ragQueryPlanMode"
    | "ragProgrammeRollout"
    | "governedCorpusComponents"
    | "governedInternationalCoverageGap"
    | "answerSourcePolicy"
  >,
  indexingVersion: string,
) {
  try {
    const normalizedQuery = sharedAnswerNormalizedQuery(args);
    let deleteQuery = createAdminClient()
      .from("rag_response_cache")
      .delete()
      .eq("cache_kind", "answer")
      .eq("scope_key", scopeKey(args))
      .eq("normalized_query", normalizedQuery)
      .eq("indexing_version", indexingVersion)
      .eq("dependency_version", ragCacheDependencyVersion);
    deleteQuery = args.ownerId ? deleteQuery.eq("owner_id", args.ownerId) : deleteQuery.is("owner_id", null);
    await deleteQuery;
  } catch (error) {
    // Shared cache cleanup after a raced invalidation is best effort.
    console.warn("Shared answer cache post-invalidation cleanup failed:", error);
  }
}

export function invalidateRagCachesForOwner(ownerId?: string | null) {
  // Epoch first so any in-flight deferred promotion that resumes after this
  // clear still sees a mismatch and discards its write.
  bumpInvalidationEpoch(ownerId);
  if (!ownerId) {
    answerCache.clear();
    answerInflight.clear();
    searchCache.clear();
    cacheIndexingVersionCache.clear();
    void (async () => {
      try {
        await createAdminClient().from("rag_response_cache").delete().in("cache_kind", ["search", "answer"]);
      } catch (error) {
        // Shared cache invalidation is best effort.
        console.warn("Shared cache invalidation failed (all kinds):", error);
      }
    })();
    return;
  }

  const sharedCacheOwnerId = ownerId === "anonymous" ? null : ownerId;
  for (const key of answerCache.keys()) {
    if (ragCacheKeyMatchesOwner(key, ownerId) || key.includes(siteAwareAnswerOwnerToken(ownerId))) {
      answerCache.delete(key);
    }
  }
  for (const key of answerInflight.keys()) {
    if (ragCacheKeyMatchesOwner(key, ownerId) || key.includes(siteAwareAnswerOwnerToken(ownerId))) {
      answerInflight.delete(key);
    }
  }
  for (const key of searchCache.keys()) {
    if (ragCacheKeyMatchesOwner(key, ownerId) || key.includes(siteAwareAnswerOwnerToken(ownerId)))
      searchCache.delete(key);
  }
  for (const key of cacheIndexingVersionCache.keys()) {
    if (ragCacheKeyMatchesOwner(key, ownerId)) cacheIndexingVersionCache.delete(key);
  }
  void (async () => {
    try {
      const deleteQuery = createAdminClient().from("rag_response_cache").delete();
      const scopedQuery = sharedCacheOwnerId
        ? deleteQuery.eq("owner_id", sharedCacheOwnerId)
        : deleteQuery.is("owner_id", null);
      await scopedQuery.in("cache_kind", ["search", "answer"]);
    } catch (error) {
      // Shared cache invalidation is best effort.
      console.warn("Shared cache invalidation failed for owner:", error);
    }
  })();
}

function invalidateAnonymousSharedRagCaches() {
  void (async () => {
    try {
      await createAdminClient()
        .from("rag_response_cache")
        .delete()
        .is("owner_id", null)
        .in("cache_kind", ["search", "answer"]);
    } catch (error) {
      // Shared cache invalidation is best effort.
      console.warn("Shared cache invalidation failed for anonymous:", error);
    }
  })();
}

export function invalidateRagCachesForDocumentMutation(
  ownerId: string,
  options: { affectsPublicCorpus?: boolean } = {},
) {
  invalidateRagCachesForOwner(ownerId);
  if (options.affectsPublicCorpus !== false) invalidateAnonymousSharedRagCaches();
}

export {
  attachAdjacentContext,
  packAdjacentSourceContext,
  packedContextCacheKey,
  sourceContextPackLimit,
} from "@/lib/rag/rag-context-pack";
