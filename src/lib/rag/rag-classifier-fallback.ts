import { createAdminClient } from "@/lib/supabase/admin";
import { classifyCorpusGrounding } from "@/lib/corpus-grounding";
import { generateParsedTextResult, openAISafetyIdentifier } from "@/lib/openai";
import { env } from "@/lib/env";
import { ragQueryClassifierPromptVersion } from "@/lib/rag/rag-versioning";
import { hasAdversarialManipulationIntent } from "@/lib/rag/rag-routing";
import {
  clearlyOutsideCorpusMedicalPattern,
  isDeterministicNonClinicalConsumerRefusal,
  isUnsupportedSoftTailAnalysis,
  unavailableDocumentNoisePattern,
} from "@/lib/rag/rag-query-guard";
import { awaitWithCallerSignal } from "@/lib/rag/rag-abort-signal";
import type { ClinicalQueryAnalysis } from "@/lib/types";
import { z } from "zod";

const queryClassifierParseSchema = z
  .object({
    queryClass: z.enum([
      "document_lookup",
      "table_threshold",
      "medication_dose_risk",
      "comparison",
      "broad_summary",
      "unsupported_or_general",
    ]),
    confidence: z.number(),
    reasons: z.array(z.string()),
    expandedTerms: z.array(z.string()),
  })
  .strict();

const queryClassifierVerdictSchema = queryClassifierParseSchema.extend({
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().max(80)).max(4),
  expandedTerms: z.array(z.string().max(60)).max(10),
});

/** Unique text values. */
export function uniqueTextValues(values: Array<string | null | undefined>, limit = 32) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

type ClassifierVerdict = z.infer<typeof queryClassifierVerdictSchema>;

// Finding #11 interim fix (docs/process-hardening.md): the LLM classifier verdict flips
// run-to-run for the same query, so the unsupported short-circuit downstream intermittently
// returned 0 results for valid in-corpus topics. Memoizing successful verdicts makes the
// verdict — and therefore retrieval behaviour — deterministic per query for the TTL window.
// Only *successful* classifier calls are memoized (accepted and rejected verdicts alike);
// transport errors and timeouts stay retryable, otherwise one transient 6s timeout would pin
// a query's classification for the whole TTL. The full corpus-grounded relevance fix remains
// scoped to RAG optimisation Phase 2.
const classifierVerdictMemoTtlMs = 15 * 60 * 1000;
// Finding #11 follow-up: bounds retries for a rejected soft-tail verdict (isUnsupportedSoftTailAnalysis).
const rejectedSoftTailMemoTtlMs = 60 * 1000;
const classifierVerdictMemoMaxEntries = 500;
const classifierVerdictMemo = new Map<string, { expiresAt: number; verdict: ClassifierVerdict }>();
const classifierVerdictInflight = new Map<string, Promise<ClassifierVerdict>>();

/** Classifier verdict memo key. */
function classifierVerdictMemoKey(query: string, analysis: ClinicalQueryAnalysis) {
  const normalizedQuery = query.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  // The deterministic class + confidence bucket are part of the key so a deterministic-analyzer
  // change invalidates stale verdicts instead of replaying them against a different baseline.
  return [
    env.OPENAI_QUERY_CLASSIFIER_MODEL,
    ragQueryClassifierPromptVersion,
    normalizedQuery,
    analysis.queryClass,
    analysis.confidence.toFixed(2),
  ].join("::");
}

/** Store classifier verdict memo. */
function storeClassifierVerdictMemo(key: string, verdict: ClassifierVerdict, ttlMs = classifierVerdictMemoTtlMs) {
  if (classifierVerdictMemo.size >= classifierVerdictMemoMaxEntries) {
    const oldestKey = classifierVerdictMemo.keys().next().value;
    if (oldestKey !== undefined) classifierVerdictMemo.delete(oldestKey);
  }
  classifierVerdictMemo.set(key, { expiresAt: Date.now() + ttlMs, verdict });
}

/** Reset classifier verdict memo for tests. */
export function resetClassifierVerdictMemoForTests() {
  classifierVerdictMemo.clear();
  classifierVerdictInflight.clear();
}

/** Request classifier verdict. */
async function requestClassifierVerdict(
  query: string,
  analysis: ClinicalQueryAnalysis,
  ownerId?: string | null,
): Promise<ClassifierVerdict> {
  const result = await generateParsedTextResult(
    [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Query: ${query}`,
              `Deterministic query class: ${analysis.queryClass}`,
              `Deterministic confidence: ${analysis.confidence}`,
              `Known expanded terms: ${analysis.expandedTerms.join(", ") || "none"}`,
            ].join("\n"),
          },
        ],
      },
    ],
    queryClassifierParseSchema,
    {
      model: env.OPENAI_QUERY_CLASSIFIER_MODEL,
      maxOutputTokens: 220,
      operation: "text_generation",
      instructions:
        "Classify this query for retrieval routing only. Do not answer the clinical question. Prefer unsupported when the query is not about indexed clinical document retrieval.",
      reasoningEffort: "low",
      textVerbosity: "low",
      schemaName: "clinical_rag_query_classifier",
      promptCacheKey: ragQueryClassifierPromptVersion,
      timeoutMs: 6000,
      safetyIdentifier: env.OPENAI_SAFETY_IDENTIFIER_SECRET ? openAISafetyIdentifier(ownerId) : undefined,
    },
  );
  return queryClassifierVerdictSchema.parse(result.parsed);
}

/** Apply classifier verdict. */
function applyClassifierVerdict(analysis: ClinicalQueryAnalysis, parsed: ClassifierVerdict): ClinicalQueryAnalysis {
  if (parsed.confidence < 0.58 || parsed.queryClass === "unsupported_or_general") return analysis;
  return {
    ...analysis,
    queryClass: parsed.queryClass,
    confidence: Math.max(analysis.confidence, parsed.confidence),
    needsClassifierFallback: false,
    needsSynthesis:
      analysis.needsSynthesis ||
      parsed.queryClass === "comparison" ||
      parsed.queryClass === "broad_summary" ||
      parsed.queryClass === "medication_dose_risk",
    expandedTerms: uniqueTextValues([...analysis.expandedTerms, ...parsed.expandedTerms], 36),
    queryRewrite: {
      ...analysis.queryRewrite,
      expansions: uniqueTextValues([...analysis.queryRewrite.expansions, ...parsed.expandedTerms], 48),
      searchQuery: uniqueTextValues(
        [analysis.queryRewrite.searchQuery, ...analysis.queryRewrite.expansions, ...parsed.expandedTerms],
        60,
      ).join(" "),
      reasons: uniqueTextValues([...analysis.queryRewrite.reasons, ...parsed.reasons, "classifier_fallback"], 16),
    },
    reasons: uniqueTextValues([...analysis.reasons, ...parsed.reasons, "classifier_fallback"], 12),
  } satisfies ClinicalQueryAnalysis;
}

/** Analyze query with classifier fallback. */
export async function analyzeQueryWithClassifierFallback(
  query: string,
  analysis: ClinicalQueryAnalysis,
  opts?: {
    // Finding #11 corpus grounding: when provided, unsupported-soft-tail queries are checked
    // against the corpus BEFORE the nondeterministic LLM classifier. Scoped with the exact
    // owner_filter retrieval will use so grounding can never see documents retrieval cannot.
    corpusGrounding?: { supabase: ReturnType<typeof createAdminClient>; ownerFilter: string | null };
    ownerId?: string | null;
    signal?: AbortSignal;
  },
) {
  if (
    // Fail closed before any generative model call: an adversarial-manipulation
    // query is routed to "unsupported" downstream, so never send its text to the
    // LLM query classifier. (Embedding-based retrieval is non-generative and not
    // an injection surface.)
    hasAdversarialManipulationIntent(query) ||
    unavailableDocumentNoisePattern.test(query) ||
    (clearlyOutsideCorpusMedicalPattern.test(query) && analysis.documentTitleTerms.length === 0) ||
    // A plainly non-clinical consumer question ("best coffee machine") with no clinical word the
    // model could rescue it on: the classifier would only add latency before the same refusal.
    isDeterministicNonClinicalConsumerRefusal(query, analysis)
  ) {
    return { ...analysis, needsClassifierFallback: false } satisfies ClinicalQueryAnalysis;
  }

  // Finding #11 corpus-grounded relevance: for queries that would hit the unsupported soft
  // tail, the corpus — not the LLM — decides. An in-corpus bare topic ("bipolar disorder")
  // deterministically reclassifies to broad_summary (mirroring what an accepted classifier
  // verdict would have done, minus the coin flip); a corpus-absent query ("florbizone syndrome
  // management") skips the LLM entirely so the soft-tail refusal is deterministic — and typos
  // remain rescuable because the short-circuit path still runs trigram correction afterwards.
  // "inconclusive" (including DB errors and an unapplied migration) keeps legacy behaviour.
  // This deliberately runs before the OPENAI_API_KEY gate: offline/source-only deployments
  // still retrieve lexically, so in-corpus bare topics should answer there too.
  if (opts?.corpusGrounding && isUnsupportedSoftTailAnalysis(query, analysis)) {
    const grounding = await classifyCorpusGrounding({
      supabase: opts.corpusGrounding.supabase,
      query,
      ownerFilter: opts.corpusGrounding.ownerFilter,
    });
    if (grounding.verdict === "in_corpus_topic") {
      return {
        ...analysis,
        queryClass: "broad_summary",
        confidence: Math.max(analysis.confidence, 0.62),
        needsSynthesis: true,
        needsClassifierFallback: false,
        corpusGrounding: "in_corpus_topic",
        reasons: uniqueTextValues([...analysis.reasons, "corpus_topic_grounding"], 12),
      } satisfies ClinicalQueryAnalysis;
    }
    if (grounding.verdict === "out_of_corpus") {
      // Do NOT touch queryClass/confidence/reasons: the existing soft-tail short-circuit (and
      // its alias-expansion + trigram-correction escape hatches) must keep firing exactly as
      // before — only the LLM lottery is removed.
      return {
        ...analysis,
        needsClassifierFallback: false,
        corpusGrounding: "out_of_corpus",
      } satisfies ClinicalQueryAnalysis;
    }
    analysis = { ...analysis, corpusGrounding: "inconclusive" };
  }

  // Finding #2: Deterministic fallback routing for short clinical queries.
  // Short, bare clinical search queries (e.g., "bipolar disorder", "anorexia management")
  // can be misclassified by the generative LLM. We route them deterministically.
  if (
    analysis.needsClassifierFallback &&
    analysis.corpusGrounding !== "inconclusive" &&
    query.trim().split(/\s+/).length <= 4 &&
    (analysis.documentTitleTerms.length > 0 || analysis.canonicalTerms.length > 0)
  ) {
    return {
      ...analysis,
      queryClass: "broad_summary",
      needsClassifierFallback: false,
      reasons: uniqueTextValues([...analysis.reasons, "deterministic_short_clinical_query_fallback"], 12),
    } satisfies ClinicalQueryAnalysis;
  }

  if (!analysis.needsClassifierFallback || !env.OPENAI_API_KEY) return analysis;

  const memoKey = classifierVerdictMemoKey(query, analysis);
  const memoized = classifierVerdictMemo.get(memoKey);
  if (memoized) {
    if (memoized.expiresAt > Date.now()) return applyClassifierVerdict(analysis, memoized.verdict);
    classifierVerdictMemo.delete(memoKey);
  }

  let pending = classifierVerdictInflight.get(memoKey);
  if (!pending) {
    pending = requestClassifierVerdict(query, analysis, opts?.ownerId).finally(() => {
      classifierVerdictInflight.delete(memoKey);
    });
    classifierVerdictInflight.set(memoKey, pending);
  }

  try {
    const verdict = await awaitWithCallerSignal(pending, opts?.signal);
    // Finding #11 follow-up: bounded TTL for a rejected soft-tail verdict — see the constant above.
    const rejected = verdict.confidence < 0.58 || verdict.queryClass === "unsupported_or_general";
    const softTail = rejected && isUnsupportedSoftTailAnalysis(query, analysis);
    storeClassifierVerdictMemo(memoKey, verdict, softTail ? rejectedSoftTailMemoTtlMs : undefined);
    return applyClassifierVerdict(analysis, verdict);
  } catch (error) {
    if (
      error &&
      (error instanceof DOMException || typeof error === "object") &&
      (error as { name?: string }).name === "AbortError"
    )
      throw error;
    // Transport/parse failures are deliberately NOT memoized: fall back to the deterministic
    // analysis for this request only, and let the next request retry the classifier.
    return analysis;
  }
}
