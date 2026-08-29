import { createAdminClient } from "@/lib/supabase/admin";
import { readExpiringCacheEntry, writeBoundedExpiringCacheEntry } from "@/lib/bounded-ttl-cache";
import {
  retrievalAccessScopeForArgs,
  retrievalAccessScopeKey,
  retrievalOwnerFilter,
  type RetrievalAccessScope,
} from "@/lib/owner-scope";
import { buildClinicalTextSearchQuery, normalizedClinicalSearchTokens, queriedZoneColour } from "@/lib/clinical-search";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import type { SearchChunksArgs } from "@/lib/rag/rag-contracts";
import { shouldShortCircuitUnsupportedSearch } from "@/lib/rag/rag-query-guard";
import type { ClinicalQueryAnalysis, RagProgrammeMode, RagQueryClass, RagQueryPlan, SearchResult } from "@/lib/types";

const maxRetrievalQueryVariants = 4;
export const maxTextRpcQueryVariants = 3;
/** Aliases change rarely; longer TTL cuts cold-instance DB RTT without ranking impact. */
const ragAliasCacheTtlMs = 300_000;
const maxRagAliasCacheEntries = 256;
const maxRagAliasesPerScope = 200;
const maxRagAliasExpansions = 12;

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

/** Text candidate budget for query class. */
export function textCandidateBudgetForQueryClass(queryClass: RagQueryClass | undefined, topK: number) {
  if (queryClass === "comparison") return Math.max(topK * 7, 72);
  if (queryClass === "table_threshold" || queryClass === "medication_dose_risk") return Math.max(topK * 4, 40);
  if (queryClass === "document_lookup") return Math.max(topK * 3, 24);
  if (queryClass === "unsupported_or_general") return Math.max(topK * 2, 16);
  return Math.max(topK * 4, 32);
}

export type RagAliasInput = {
  alias: string;
  canonical: string;
  alias_type?: string | null;
  weight?: number | null;
  owner_id?: string | null;
};

const ragAliasCache = new Map<string, { expiresAt: number; aliases: RagAliasInput[] }>();

/** Normalize retrieval variant. */
export function normalizeRetrievalVariant(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Retrieval variant from terms. */
function retrievalVariantFromTerms(terms: string[]) {
  return buildClinicalTextSearchQuery(terms.filter(Boolean).join(" "));
}

/** Normalize alias lookup. */
function normalizeAliasLookup(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Escaped alias pattern. */
function escapedAliasPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

/** Alias appears in query. */
function aliasAppearsInQuery(normalizedQuery: string, alias: string) {
  const normalizedAlias = normalizeAliasLookup(alias);
  if (!normalizedQuery || !normalizedAlias) return false;
  const pattern = new RegExp(`(?:^|\\s)${escapedAliasPattern(normalizedAlias)}(?:\\s|$)`, "i");
  return pattern.test(normalizedQuery);
}

/** Select rag alias expansions. */
export function selectRagAliasExpansions(query: string, aliases: RagAliasInput[], limit = maxRagAliasExpansions) {
  const normalizedQuery = normalizeAliasLookup(query);
  const expansions: string[] = [];
  const seen = new Set<string>();

  const sorted = [...aliases].sort((left, right) => {
    const leftWeight = typeof left.weight === "number" ? left.weight : 1;
    const rightWeight = typeof right.weight === "number" ? right.weight : 1;
    return rightWeight - leftWeight;
  });

  for (const alias of sorted) {
    if (expansions.length >= limit) break;
    if (!aliasAppearsInQuery(normalizedQuery, alias.alias)) continue;
    const canonical = normalizeRetrievalVariant(alias.canonical);
    const key = canonical.toLowerCase();
    if (!canonical || seen.has(key)) continue;
    seen.add(key);
    expansions.push(canonical);
  }

  return expansions;
}

/** Should apply unsupported search short circuit. */
export function shouldApplyUnsupportedSearchShortCircuit(
  query: string,
  analysis: ClinicalQueryAnalysis,
  aliasExpansions: string[] = [],
) {
  return aliasExpansions.length === 0 && shouldShortCircuitUnsupportedSearch(query, analysis);
}

/**
 * Warm the global (owner_id IS NULL) rag_aliases cache at server startup so the
 * first search after a deploy does not pay the cold-cache DB RTT.
 * Failures are swallowed — warmup must never block boot.
 */
export async function warmEnabledRagAliasCache(
  supabase: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<void> {
  try {
    await fetchEnabledRagAliases(supabase, undefined, { includePublic: true });
  } catch (error) {
    console.warn("rag_aliases cache warmup failed; first request will retry.", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Fetch enabled rag aliases. */
export async function fetchEnabledRagAliases(
  supabase: ReturnType<typeof createAdminClient>,
  ownerId?: string,
  accessScope?: RetrievalAccessScope,
  signal?: AbortSignal,
): Promise<RagAliasInput[]> {
  throwIfAborted(signal);
  const scope = retrievalAccessScopeForArgs({ ownerId, accessScope });
  const cacheKey = retrievalAccessScopeKey(scope);
  const cached = readExpiringCacheEntry(ragAliasCache, cacheKey);
  if (cached) return cached.aliases;

  /** Read scope. */
  async function readScope(scopeOwnerId: string | null) {
    let query = supabase
      .from("rag_aliases")
      .select("alias,canonical,alias_type,weight,owner_id")
      .eq("enabled", true)
      .order("weight", { ascending: false })
      .limit(maxRagAliasesPerScope);
    query = scopeOwnerId ? query.eq("owner_id", scopeOwnerId) : query.is("owner_id", null);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    throwIfAborted(signal);
    if (error) throw error;
    return (data ?? []) as RagAliasInput[];
  }

  try {
    const [globalAliases, ownerAliases] = await Promise.all([
      readScope(null),
      scope.ownerId ? readScope(scope.ownerId) : Promise.resolve([] as RagAliasInput[]),
    ]);
    const merged: RagAliasInput[] = [];
    const seen = new Set<string>();
    for (const alias of [...ownerAliases, ...globalAliases]) {
      const key = `${normalizeAliasLookup(alias.alias)}||${normalizeAliasLookup(alias.canonical)}`;
      if (!alias.alias?.trim() || !alias.canonical?.trim() || seen.has(key)) continue;
      seen.add(key);
      merged.push(alias);
      if (merged.length >= maxRagAliasesPerScope) break;
    }
    throwIfAborted(signal);
    writeBoundedExpiringCacheEntry(
      ragAliasCache,
      cacheKey,
      { aliases: merged, expiresAt: Date.now() + ragAliasCacheTtlMs },
      maxRagAliasCacheEntries,
    );
    return merged;
  } catch {
    if (signal?.aborted) throw abortReason(signal);
    // Do not cache an empty result on a transient rag_aliases read failure: caching [] would suppress
    // alias-based query expansion (and could let an alias-rescuable query short-circuit) for the whole
    // TTL. Return empty for this call only and retry on the next call.
    return [];
  }
}

/** Assert global search allowed. */
export function assertGlobalSearchAllowed(args: SearchChunksArgs) {
  if (args.ownerId || args.allowGlobalSearch || isDemoMode() || isLocalNoAuthMode()) return;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Global RAG search requires allowGlobalSearch=true or an explicit ownerId.");
  }
}

/** Owner scope for document filtered retrieval. */
export function ownerScopeForDocumentFilteredRetrieval(
  ownerId: string | undefined,
  documentIds: string[] | undefined,
  allowGlobalSearch?: boolean,
) {
  return retrievalOwnerFilter({ ownerId, documentIds, allowGlobalSearch });
}

/** Build retrieval query variants. */
export function buildRetrievalQueryVariants(
  query: string,
  analysis: ClinicalQueryAnalysis,
  aliases: RagAliasInput[] = [],
  plan?: RagQueryPlan,
) {
  const variants: string[] = [];
  const seen = new Set<string>();
  const aliasExpansions = selectRagAliasExpansions(query, aliases);
  const addVariant = (value: string) => {
    const normalized = normalizeRetrievalVariant(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(normalized);
  };

  addVariant(buildClinicalTextSearchQuery(query));
  if (/\badmission\b/i.test(query) && /\bcommunity patients?\b/i.test(query)) {
    addVariant("admission of community patients");
    addVariant("admission community patients");
  }
  aliasExpansions.slice(0, 2).forEach(addVariant);
  if (/\bpatient property\b/i.test(query)) {
    addVariant("patient property");
  }
  if (/\bclozapine\b/i.test(query) && /\b(?:anc|fbc|wbc|neutrophil|white cell)\b/i.test(query)) {
    if (/\b(?:threshold|cut[\s-]?off|withhold|withheld|withholding|cease|stop|stopped|discontinue)\b/i.test(query)) {
      addVariant("clozapine blood results amber red range");
    }
    addVariant("clozapine anc fbc");
    addVariant("clozapine monitoring");
  }
  if (analysis.queryClass === "comparison" && /\badmission\b/i.test(query) && /\bdischarge\b/i.test(query)) {
    addVariant("admission community patients");
    addVariant("discharge community patients");
    addVariant("admission discharge");
  }
  if (
    /\b(?:flow\s*chart|flowchart|algorithm|pathway|risk[\s-]*matrix)\b/i.test(query) &&
    /\b(?:risk|red\s*zone|red|urgent|escalat|next step)\b/i.test(query)
  ) {
    addVariant("risk flow");
    // websearch_to_tsquery ANDs every term, so the previous "red zone risk flow"
    // and "risk flow review urgent escalation" variants required all terms in one
    // chunk and did not reliably contribute candidates to the pool. A "<colour> zone" variant retrieves the small,
    // precise set of zone-action chunks (escalation protocols, observation and
    // response charts, risk-matrix cells) that answer zone / next-step questions.
    // Match the zone the query actually names so an amber-zone question does not
    // pull red-zone chunks into its candidate pool.
    const zoneColour = queriedZoneColour(query);
    if (zoneColour) {
      addVariant(`${zoneColour} zone`);
    }
  }
  addVariant(analysis.queryRewrite.searchQuery);

  addVariant(
    retrievalVariantFromTerms([
      ...analysis.canonicalTerms,
      ...analysis.acronyms,
      ...analysis.typoCorrections.map((correction) => correction.to),
      ...analysis.expandedTerms.slice(0, 8),
      ...analysis.queryRewrite.expansions.slice(0, 10),
      ...aliasExpansions.slice(0, 6),
    ]),
  );

  if (analysis.documentTitleIntent) {
    addVariant(
      retrievalVariantFromTerms([
        ...analysis.documentTitleTerms,
        ...analysis.canonicalTerms.slice(0, 6),
        ...analysis.acronyms,
        ...aliasExpansions.slice(0, 4),
      ]),
    );
  }

  if (analysis.medications.length > 0 || analysis.thresholdTerms.length > 0) {
    addVariant(
      retrievalVariantFromTerms([
        ...analysis.medications,
        ...analysis.thresholdTerms,
        ...analysis.acronyms,
        ...analysis.canonicalTerms.slice(0, 8),
        ...aliasExpansions.slice(0, 6),
      ]),
    );
  }

  const normalizedTokens = normalizedClinicalSearchTokens(query);
  if (normalizedTokens.length > 10) {
    const coreTerms = [
      ...analysis.medications,
      ...analysis.thresholdTerms,
      ...analysis.documentTitleTerms,
      ...analysis.canonicalTerms,
      ...aliasExpansions.slice(0, 4),
      ...normalizedTokens,
    ];
    addVariant(retrievalVariantFromTerms(coreTerms.slice(0, 10)));
  }

  const legacyVariants = variants.slice(0, maxRetrievalQueryVariants);
  if (!plan || plan.kind !== "decomposed") return legacyVariants;

  const candidateVariants: string[] = [];
  const candidateKeys = new Set<string>();
  for (const value of [
    plan.originalQuery,
    ...plan.subquestions.slice(1).map(({ question }) => question),
    ...legacyVariants,
  ]) {
    const normalized = normalizeRetrievalVariant(buildClinicalTextSearchQuery(value));
    const key = normalized.toLowerCase();
    if (!normalized || candidateKeys.has(key)) continue;
    candidateKeys.add(key);
    candidateVariants.push(normalized);
    if (candidateVariants.length >= maxRetrievalQueryVariants) break;
  }
  return candidateVariants;
}

const queryPlanDiagnosticReasonCodes = new Set([
  "comparison_terms",
  "table_or_threshold_terms",
  "medication_dose_or_risk_terms",
  "document_lookup_terms",
  "document_include_terms",
  "broad_summary_terms",
  "typo_corrections",
  "domain_alias_terms",
  "freshness_terms",
  "no_specific_rag_class_terms",
  "document_explicit",
  "medicine_explicit",
  "population_explicit",
  "jurisdiction_explicit",
  "setting_explicit",
  "acronym_expanded",
  "medicine_alias_or_typo_preserved",
  "document_section_exact",
  "material_retrieval_ambiguity",
  "comparison_sides_identified",
  "broad_management_decomposition",
  "comparison_sides_unresolved_single_plan",
]);

function contentFreeQueryPlanReasonCodes(plan: RagQueryPlan) {
  return [...new Set(plan.reasonCodes.filter((reason) => queryPlanDiagnosticReasonCodes.has(reason)))].slice(0, 16);
}

export function buildRagRetrievalVariantPlan(
  query: string,
  analysis: ClinicalQueryAnalysis,
  aliases: RagAliasInput[],
  plan: RagQueryPlan,
  rolloutMode: RagProgrammeMode,
  signal?: AbortSignal,
) {
  const servedVariants = buildRetrievalQueryVariants(query, analysis, aliases);
  const shadow = rolloutMode === "shadow";
  if (shadow) throwIfAborted(signal);
  const candidateVariants = shadow ? buildRetrievalQueryVariants(query, analysis, aliases, plan) : servedVariants;
  if (shadow) throwIfAborted(signal);
  return {
    queryPlanVersion: plan.version,
    servedVariants,
    candidateVariants,
    diagnostics: {
      query_plan_kind: plan.kind,
      subquestion_count: plan.subquestions.length,
      query_plan_reason_codes: contentFreeQueryPlanReasonCodes(plan),
      ...(shadow ? { candidate_retrieval_query_variant_count: candidateVariants.length } : {}),
    },
  };
}

// P8b: websearch_to_tsquery ANDs every term, so a long multi-term query (e.g. "ciwa score threshold
// drug treatment alcohol withdrawal") can match zero chunks even when the answer clearly exists —
// no single chunk contains all seven terms. Relax the primary variant to a term-OR query so recall
// is recovered; ts_rank_cd still ranks chunks matching more terms highest, so topical docs surface
// on top rather than flooding with single-term matches. Only used as a fallback when the strict
// AND variants returned nothing, so it never displaces a working precise match.
/** Relax variant to or query. */
export function relaxVariantToOrQuery(variant: string): string | null {
  const tokens = Array.from(
    new Set(
      variant
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 1 && token !== "or"),
    ),
  );
  if (tokens.length < 2) return null;
  return tokens.join(" OR ");
}

// Mirrors the minimum meaningful text-signal floor used by answer routing
// (see textSignalFloor usage in rag-routing.ts): a strict-AND result set whose best
// text_rank sits below it carries almost no lexical evidence.
const weakTextMatchTopRankFloor = 0.05;
const weakTextMatchMinResultCount = 3;
// Above this rank the best strict match is a precise lexical hit; augmenting a sparse set
// around it only adds OR noise and a needless RPC round-trip (single-strong-match queries
// like exact table lookups must stay one-RPC retrievals).
const strongTextMatchTopRankBar = 0.3;

// Strict-AND matched something, but so weakly (sparse set of middling matches, or a
// negligible best text rank) that the right chunk may be buried outside the candidate pool.
// In that case OR-relaxed recall is appended BEHIND the strict matches (append-only: strict
// results keep merge precedence), so this can widen the pool but never displace a precise
// match. A sparse set anchored by a strong hit does NOT relax.
/** Should relax weak text matches. */
export function shouldRelaxWeakTextMatches(merged: SearchResult[]): boolean {
  if (merged.length === 0) return false;
  const topTextRank = merged.reduce((top, result) => Math.max(top, result.text_rank ?? 0), 0);
  if (topTextRank >= strongTextMatchTopRankBar) return false;
  if (merged.length < weakTextMatchMinResultCount) return true;
  return topTextRank < weakTextMatchTopRankFloor;
}

// PT-02: sibling query variants exist to rescue queries whose primary phrasing
// misses. When the first variant already returns a deep pool anchored by a
// precise lexical hit, firing the siblings re-derives the same evidence at two
// extra RPC round-trips per lexical surface. "Strong" reuses the same rank bar
// as the weak-OR skip above so both paths agree on what a precise hit is; the
// depth floor stops a single lucky chunk from suppressing sibling recall.
/** First-variant pool is strong enough to skip the sibling variant RPCs. */
export function firstVariantPoolIsStrong(
  results: ReadonlyArray<{ text_rank?: number | null }>,
  matchCount: number,
): boolean {
  if (results.length < Math.ceil(matchCount / 2)) return false;
  const topTextRank = results.reduce((top, result) => Math.max(top, result.text_rank ?? 0), 0);
  return topTextRank >= strongTextMatchTopRankBar;
}
