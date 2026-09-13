import type { createAdminClient } from "@/lib/supabase/admin";
import type { CorpusGroundingVerdict } from "@/lib/types";
import { normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { isMissingRetrievalRpcError } from "@/lib/retrieval-rpc-rollout";
import {
  PUBLIC_OWNER_FILTER_SENTINEL,
  resolveRetrievalAccessScope,
  retrievalAccessScopeKey,
  type RetrievalAccessScope,
} from "@/lib/owner-scope";
import {
  acceptRagEvaluationRead,
  ragEvaluationReadScope,
  type RagEvaluationContext,
} from "@/lib/rag/rag-contracts";

type AbortableQuery<T> = PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> };

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

async function resolveAbortableQuery<T>(query: AbortableQuery<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw abortReason(signal);
  const pending = signal && typeof query.abortSignal === "function" ? query.abortSignal(signal) : query;
  const result = await pending;
  if (signal?.aborted) throw abortReason(signal);
  return result;
}

// Finding #11 (corpus-grounded relevance): the deterministic query analyzer cannot tell an
// in-corpus bare topic ("bipolar disorder") from an invented one ("florbizone syndrome
// management") — both land in the unsupported soft tail with identical confidence, and the LLM
// classifier fallback answers or refuses nondeterministically. Only the corpus can separate
// them, so this module classifies the query's content tokens against corpus statistics served
// by the `corpus_topic_term_stats` RPC (scoped exactly like retrieval):
//
//   * a token is ABSENT when no committed chunk has ever seen it (and no title matches) — the
//     signature of invented/unknown terms. Any absent token => "out_of_corpus". Typos are also
//     absent, and stay rescuable: the caller skips the LLM but the downstream short-circuit
//     still runs trigram correction before giving up.
//   * a token is a TOPIC ANCHOR when it matches at least one indexed document title AND its
//     title share stays under the genericity ceiling. Title words that headline a large share
//     of the corpus ("management" ~18%, "guideline" ~20% of titles, measured live 2026-07-07)
//     are scaffolding, not topics; real topics measure far lower (assessment 3.0%, disorder
//     1.6%, bipolar/anorexia <0.1%). No absent tokens + at least one anchor => "in_corpus_topic".
//   * anything else => "inconclusive", which callers must treat as "behave exactly as before"
//     (LLM classifier fallback + memoization). DB errors, demo mode, and a missing RPC also
//     fail open to "inconclusive" so this can never take retrieval down.
export type { CorpusGroundingVerdict };

export type CorpusGroundingResult = {
  verdict: CorpusGroundingVerdict;
  anchorTerms: string[];
  absentTerms: string[];
};

export type CorpusTopicTermStats = {
  term: string;
  has_ts_signal: boolean;
  title_doc_count: number;
  chunk_present: boolean;
  total_doc_count: number;
};

// Title-share above this is corpus scaffolding ("management" 18.2%, "guideline" 19.6% measured
// live), well clear of the largest measured real topic share ("assessment" 3.0%).
const topicGenericityCeiling = 0.05;
const maxGroundingTerms = 8;
const termStatsCacheTtlMs = 10 * 60 * 1000;
const termStatsCacheMaxEntries = 1024;

const termStatsCache = new Map<string, { expiresAt: number; stats: CorpusTopicTermStats }>();
const inFlightGroundingQueries = new Map<string, Promise<CorpusTopicTermStats[]>>();

export function resetCorpusGroundingCacheForTests() {
  termStatsCache.clear();
  inFlightGroundingQueries.clear();
}

function cacheKey(ownerScopeKey: string, term: string) {
  return `${ownerScopeKey}|${term}`;
}

function readCachedStats(ownerScopeKey: string, term: string): CorpusTopicTermStats | null {
  const cached = termStatsCache.get(cacheKey(ownerScopeKey, term));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    termStatsCache.delete(cacheKey(ownerScopeKey, term));
    return null;
  }
  return cached.stats;
}

function storeCachedStats(ownerScopeKey: string, stats: CorpusTopicTermStats) {
  if (termStatsCache.size >= termStatsCacheMaxEntries) {
    const oldestKey = termStatsCache.keys().next().value;
    if (oldestKey !== undefined) termStatsCache.delete(oldestKey);
  }
  termStatsCache.set(cacheKey(ownerScopeKey, stats.term), {
    expiresAt: Date.now() + termStatsCacheTtlMs,
    stats,
  });
}

export function corpusGroundingTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of normalizedClinicalSearchTokens(query)) {
    if (/^\d+$/.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= maxGroundingTerms) break;
  }
  return terms;
}

export function classifyCorpusGroundingFromStats(stats: CorpusTopicTermStats[]): CorpusGroundingResult {
  // Stopword-ish tokens stem to an empty tsquery and carry no corpus signal either way.
  const signals = stats.filter((entry) => entry.has_ts_signal);
  if (signals.length === 0) return { verdict: "inconclusive", anchorTerms: [], absentTerms: [] };

  const totalDocs = signals[0]?.total_doc_count ?? 0;
  if (totalDocs <= 0) return { verdict: "inconclusive", anchorTerms: [], absentTerms: [] };

  const absentTerms = signals
    .filter((entry) => !entry.chunk_present && entry.title_doc_count === 0)
    .map((entry) => entry.term);
  const anchorTerms = signals
    .filter((entry) => entry.title_doc_count >= 1 && entry.title_doc_count / totalDocs <= topicGenericityCeiling)
    .map((entry) => entry.term);

  if (absentTerms.length > 0) return { verdict: "out_of_corpus", anchorTerms, absentTerms };
  if (anchorTerms.length > 0) return { verdict: "in_corpus_topic", anchorTerms, absentTerms };
  return { verdict: "inconclusive", anchorTerms, absentTerms };
}

export async function classifyCorpusGrounding(args: {
  supabase: ReturnType<typeof createAdminClient> | null;
  query: string;
  // The exact owner_filter retrieval will use (null = unscoped, zero-UUID = public docs only).
  ownerFilter: string | null;
  accessScope?: RetrievalAccessScope;
  signal?: AbortSignal;
  evaluation?: RagEvaluationContext;
}): Promise<CorpusGroundingResult> {
  if (args.signal?.aborted) throw abortReason(args.signal);
  const terms = corpusGroundingTerms(args.query);
  if (terms.length === 0) return { verdict: "inconclusive", anchorTerms: [], absentTerms: [] };
  if (args.evaluation) {
    const evaluation = args.evaluation;
    const rows = await acceptRagEvaluationRead(evaluation, "corpus_terms", () =>
      evaluation.readers.readCorpusTermStats({
        ...ragEvaluationReadScope(evaluation),
        terms,
      }),
    );
    if (
      rows.length !== terms.length ||
      new Set(rows.map((row) => row.term)).size !== rows.length ||
      rows.some((row) => !terms.includes(row.term))
    ) {
      evaluation.failures.record({ code: "malformed_result", operation: "corpus_terms" });
      throw new Error("U04 corpus term read did not echo every requested term.");
    }
    return classifyCorpusGroundingFromStats(rows.map((row) => ({ ...row })));
  }
  const supabase = args.supabase;
  if (!supabase) throw new Error("Supabase client is required outside U04 evaluation.");

  const accessScope =
    args.accessScope ??
    resolveRetrievalAccessScope(
      args.ownerFilter && args.ownerFilter !== PUBLIC_OWNER_FILTER_SENTINEL ? args.ownerFilter : undefined,
    );
  const ownerScopeKey = retrievalAccessScopeKey(accessScope);
  const stats: CorpusTopicTermStats[] = [];
  const missing: string[] = [];
  for (const term of terms) {
    const cached = readCachedStats(ownerScopeKey, term);
    if (cached) stats.push(cached);
    else missing.push(term);
  }

  if (missing.length > 0) {
    const flightKey = `${ownerScopeKey}:${[...missing].sort().join(",")}`;
    try {
      let flight = inFlightGroundingQueries.get(flightKey);
      if (!flight) {
        flight = (async () => {
          const ownerFilter = accessScope.ownerId ?? PUBLIC_OWNER_FILTER_SENTINEL;
          const versioned = await resolveAbortableQuery(
            supabase.rpc("corpus_topic_term_stats_v2", {
              terms: missing,
              owner_filter: ownerFilter,
              include_public: accessScope.includePublic,
            }),
            args.signal,
          );
          const calls =
            !versioned || isMissingRetrievalRpcError(versioned.error)
              ? await Promise.all([
                  resolveAbortableQuery(
                    supabase.rpc("corpus_topic_term_stats", { terms: missing, owner_filter: ownerFilter }),
                    args.signal,
                  ),
                  accessScope.ownerId && accessScope.includePublic
                    ? resolveAbortableQuery(
                        supabase.rpc("corpus_topic_term_stats", {
                          terms: missing,
                          owner_filter: PUBLIC_OWNER_FILTER_SENTINEL,
                        }),
                        args.signal,
                      )
                    : Promise.resolve({ data: [], error: null }),
                ])
              : [versioned];
          if (calls.some((call) => call.error)) throw calls.find((call) => call.error)?.error;
          const byTerm = new Map<string, CorpusTopicTermStats>();
          for (const call of calls) {
            for (const row of (call.data ?? []) as CorpusTopicTermStats[]) {
              const current = byTerm.get(row.term);
              byTerm.set(
                row.term,
                current
                  ? {
                      term: row.term,
                      has_ts_signal: current.has_ts_signal || row.has_ts_signal,
                      title_doc_count: current.title_doc_count + row.title_doc_count,
                      chunk_present: current.chunk_present || row.chunk_present,
                      total_doc_count: current.total_doc_count + row.total_doc_count,
                    }
                  : row,
              );
            }
          }
          return [...byTerm.values()];
        })();
        inFlightGroundingQueries.set(flightKey, flight);
      }

      const rows = await flight;
      // A term the RPC did not echo back got dropped SQL-side (blank after trim); treat the
      // whole classification as inconclusive rather than guessing.
      if (rows.length !== missing.length) return { verdict: "inconclusive", anchorTerms: [], absentTerms: [] };
      if (args.signal?.aborted) throw abortReason(args.signal);
      for (const row of rows) {
        storeCachedStats(ownerScopeKey, row);
        stats.push(row);
      }
    } catch {
      if (args.signal?.aborted) throw abortReason(args.signal);
      // Fail open: missing RPC (migration not applied), transient DB error, demo mode — the
      // caller keeps today's behaviour (LLM classifier fallback + soft-tail short-circuit).
      return { verdict: "inconclusive", anchorTerms: [], absentTerms: [] };
    } finally {
      inFlightGroundingQueries.delete(flightKey);
    }
  }

  return classifyCorpusGroundingFromStats(stats);
}
