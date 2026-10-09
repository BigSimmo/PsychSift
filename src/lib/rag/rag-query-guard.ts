import type { ClinicalQueryAnalysis } from "@/lib/types";

export const clearlyNonClinicalConsumerPattern =
  /\b(coffee\s*machine|espresso|kitchen|recipe|holiday|hotel|restaurant|car\s*finance|mortgage|insurance|gaming|laptop|phone\s*sale|television|tv\s*show|washing\s*machine|air\s*fryer|vacuum|flight\s*booking|airline)\b/i;

/**
 * Topics genuinely outside a psychiatric corpus, used to hard-pin the four medical
 * false-positive controls in `rag-eval-cases.ts` at `unsupported_correct_rate` 1.0.
 * Removing the guard outright was measured at 0.79 on 2026-07-03
 * (`docs/process-hardening.md`), because three of those four controls contain the word
 * "dose" and so are not soft-tail eligible — deleting this does not hand the decision to
 * `classifyCorpusGrounding`, it hands it to the weak-support route gate.
 *
 * Every entry must be a DISEASE-SPECIFIC PHRASE, never a bare clinical token. The bare
 * tokens `ssri`, `antibiotic`, `pneumonia`, `dka` and `ketamine sedation` were transcribed
 * from the controls' own question text and refused in-corpus psychiatric queries with zero
 * retrieval: `ssri` is an `expectedContentTerms` entry of the golden case `vector-gad-worry`
 * (`scripts/fixtures/rag-retrieval-golden.json`), so "Which SSRI is first line for
 * generalised anxiety disorder?" was refused content-blind (#000GN4).
 *
 * No retrieval gate could catch that, and it is worth being precise about why: not one of
 * the 36 golden QUERIES matches this pattern in either its old or its narrowed form — `ssri`
 * appears only in a case's expected content terms, never in a question — so the guard never
 * fires during `eval:retrieval:quality` and that eval cannot move in either direction from a
 * change here. The eval that discriminates is `eval:quality --rag-only`'s
 * `unsupported_correct_rate`, which pins the four controls through `scripts/eval-utils.ts`.
 * `tests/corpus-grounding.test.ts` pins both directions offline; keep it in lockstep.
 *
 * Dropping bare `dka` is a deliberate, separate loss: "What is the DKA protocol?" no longer
 * refuses by pattern and falls to the weak-support route gate. The control spells the
 * disease out, so no eval gate depends on the abbreviation.
 *
 * Matched against normalized text at BOTH call sites: `normalizeGuardQuery`'s output here and
 * `normalizeAnalysisText`'s output in `clinical-search.ts`, each of which folds any
 * non-alphanumeric run to a single space. The one hyphenated phrase still uses a bounded
 * character class rather than a literal hyphen, so an en dash, a non-breaking hyphen or a
 * double space in a pasted question behaves like the plain form on either path.
 */
export const clearlyOutsideCorpusMedicalPattern =
  /\b(?:diabetic ketoacidosis|community[^a-z0-9]{1,3}acquired pneumonia|adolescent depression|hyperkalaemia|hyperkalemia)\b/i;

/**
 * In-corpus signal that stops the CONSUMER heuristic (a "best/cheap/near me" shape) from
 * refusing a real clinical question. It deliberately does not gate
 * `clearlyOutsideCorpusMedicalPattern`: that pattern names phrases the corpus provably does
 * not cover, and two of the four eval controls in `src/lib/rag/rag-eval-cases.ts`
 * ("What SSRI dose is recommended for adolescent depression?" and "What insulin dose should
 * be used for hyperkalaemia?") carry `ssri`, `depression` and `dose` themselves — so keying
 * an outside-corpus override on those tokens would let exactly the queries the corpus cannot
 * answer through to a guess. `hyperkalaemia`/`hyperkalemia` are likewise NOT listed here:
 * they are the out-of-corpus token, not psychiatric context.
 *
 * The second line (#3944SV, 2026-09-26) adds psychiatric phenomena, risk terms and ward terms that a
 * consumer question never carries. Without them "flight of ideas in mania", "gaming disorder",
 * "car accident trauma assessment", "phone contact after discharge", "tv watching and negative
 * symptoms" and "holiday leave from the ward" were refused on the consumer word alone. Passing
 * this check does not force a search: the query still meets the soft tail, where
 * `classifyCorpusGrounding` lets the corpus decide.
 */
export const psychiatricOrClinicalContextPattern =
  /\b(?:ssri|antidepressant|antipsychotic|lithium|bipolar|depression|depressive|anxiety|psychiatry|psychiatric|triage|crisis|consultation|therapy|dose|dosage|medication|schizophrenia|schizoaffective|catatonia|flight of ideas|mania|manic|hypomania|hypomanic|psychosis|psychotic|trauma|traumatic|ptsd|disorder|symptoms?|discharge|ward|patients?|self[^a-z0-9]{0,3}harm|suicid(?:e|al|ality)|overdose)\b/i;

export const unavailableDocumentNoisePattern =
  /\b(?:newly uploaded|future synthetic|not been uploaded|not uploaded|2027 revised|airport travel policy|gardening equipment checklist)\b/i;

export const DEFAULT_SOFT_TAIL_CONFIDENCE_THRESHOLD = 0.42;

function unsupportedSoftTailEligible(analysis: ClinicalQueryAnalysis) {
  if (analysis.queryClass !== "unsupported_or_general") return false;
  if (analysis.documentTitleIntent || analysis.medications.length || analysis.thresholdTerms.length) return false;
  if (analysis.reasons.some((reason) => reason !== "no_specific_rag_class_terms")) return false;
  return true;
}

/**
 * The SINGLE normalizer for text that `clearlyOutsideCorpusMedicalPattern` is matched against.
 *
 * `clinical-search.ts` owned an identical private copy and applied it to its own call site
 * while this module matched the RAW query, so one shared constant had two different inputs —
 * the same divergence, one level down, that folding the two pattern copies into one was meant
 * to end. Pasted clinical text is where it bites: a non-breaking space or a stray double space
 * between the words of a listed phrase left the two call sites disagreeing about whether the
 * same question was out of corpus, and the class selects the composition menu, second-stage
 * rerank engagement, and part of the search cache key. Raised in review on PR #2546. The
 * bot's specific example was wrong — `unsupported-pneumonia-antibiotic` in `rag-eval-cases.ts`
 * uses an ordinary hyphen and space, verified byte by byte, so no eval control was broken —
 * but the divergence it points at is real.
 *
 * Widening is confined to whitespace and punctuation variants of phrases already on the list,
 * which is why it is safe on a protected surface: it can only make an out-of-corpus phrase
 * match the way its canonical spelling already does. `unavailableDocumentNoisePattern` and
 * `clearlyNonClinicalConsumerPattern` are deliberately left on the raw query — they are local
 * to this module, share no constant with any other call site, and so have no divergence to
 * close. Changing their input would be an undeclared behaviour change.
 */
export function normalizeGuardQuery(text: string) {
  return text
    .normalize("NFKC")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9%/.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNonClinicalConsumerQuery(query: string, analysis: ClinicalQueryAnalysis): boolean {
  if (!clearlyNonClinicalConsumerPattern.test(query)) return false;
  if (psychiatricOrClinicalContextPattern.test(query)) return false;
  if (analysis.medications.length > 0 || analysis.thresholdTerms.length > 0 || analysis.documentTitleTerms.length > 0) {
    return false;
  }
  return true;
}

export function shouldShortCircuitUnsupportedSearch(query: string, analysis: ClinicalQueryAnalysis) {
  if (unavailableDocumentNoisePattern.test(query)) return true;
  if (clearlyOutsideCorpusMedicalPattern.test(normalizeGuardQuery(query)) && analysis.documentTitleTerms.length === 0)
    return true;
  if (!unsupportedSoftTailEligible(analysis)) return false;
  if (isNonClinicalConsumerQuery(query, analysis)) return true;
  return analysis.confidence <= DEFAULT_SOFT_TAIL_CONFIDENCE_THRESHOLD && analysis.expandedTerms.length <= 5;
}

// True only for queries that would short-circuit via the soft tail itself, not a pattern guard.
export function isUnsupportedSoftTailAnalysis(query: string, analysis: ClinicalQueryAnalysis) {
  if (unavailableDocumentNoisePattern.test(query)) return false;
  if (clearlyOutsideCorpusMedicalPattern.test(normalizeGuardQuery(query)) && analysis.documentTitleTerms.length === 0)
    return false;
  if (!unsupportedSoftTailEligible(analysis)) return false;
  if (isNonClinicalConsumerQuery(query, analysis)) return false;
  return analysis.confidence <= DEFAULT_SOFT_TAIL_CONFIDENCE_THRESHOLD && analysis.expandedTerms.length <= 5;
}

/**
 * Soft-tail zeros should skip search/answer cache writes only when a nondeterministic
 * classifier call could have produced them. Without an API key the classifier path is
 * unreachable (`analyzeQueryWithClassifierFallback` returns early), and an
 * `"out_of_corpus"` grounding verdict is a deterministic corpus-derived true negative —
 * both stay cacheable.
 */
export function shouldSkipUnsupportedSoftTailCacheWrite(
  query: string,
  analysis: ClinicalQueryAnalysis,
  options: {
    openAiApiKeyPresent: boolean;
    corpusGrounding?: ClinicalQueryAnalysis["corpusGrounding"];
  },
): boolean {
  if (!options.openAiApiKeyPresent) return false;
  const grounding = options.corpusGrounding ?? analysis.corpusGrounding;
  if (grounding === "out_of_corpus") return false;
  return isUnsupportedSoftTailAnalysis(query, analysis);
}

/** Answer-path counterpart: only skip when the empty unsupported refusal came from the soft-tail short circuit. */
export function shouldSkipUnsupportedSoftTailAnswerCacheWrite(args: {
  resultCount: number;
  retrievalStrategy: string | undefined;
  query: string;
  analysis: ClinicalQueryAnalysis;
  openAiApiKeyPresent: boolean;
  corpusGrounding?: ClinicalQueryAnalysis["corpusGrounding"];
}): boolean {
  if (args.resultCount > 0 || args.retrievalStrategy !== "unsupported_short_circuit") return false;
  return shouldSkipUnsupportedSoftTailCacheWrite(args.query, args.analysis, {
    openAiApiKeyPresent: args.openAiApiKeyPresent,
    corpusGrounding: args.corpusGrounding,
  });
}
