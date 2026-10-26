import { expectedFileCoverage } from "@/lib/eval-document-matching";
import type { RagEvalCase } from "@/lib/rag/rag-eval-cases";
import type { OpenAITokenUsage, RagAnswer, SearchResult, VisualEvidenceCard } from "@/lib/types";
import { findOwnerIdByEmail } from "./lib/find-owner-id-by-email";

export { expectedFileCoverage, type ExpectedFileCoverage } from "@/lib/eval-document-matching";

export type SupabaseAdmin = Awaited<ReturnType<typeof loadAdminClient>>;

export async function loadAdminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function evalCaseDelayMs() {
  const parsed = Number.parseInt(process.env.RAG_EVAL_CASE_DELAY_MS ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function evalForceEmbeddingDelayMs() {
  const parsed = Number.parseInt(process.env.RAG_EVAL_FORCE_EMBEDDING_DELAY_MS ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function pauseBetweenEvalCases(options: { caseIndex: number; forceEmbedding?: boolean }) {
  if (options.caseIndex <= 0) return;
  let delayMs = evalCaseDelayMs();
  if (options.forceEmbedding) delayMs += evalForceEmbeddingDelayMs();
  if (delayMs > 0) await sleep(delayMs);
}

function providerRetryNumber(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function providerErrorText(error: unknown) {
  const maybeRecord = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message =
    error instanceof Error
      ? error.message
      : typeof maybeRecord.message === "string"
        ? maybeRecord.message
        : String(error);
  const maybeDetails =
    maybeRecord.details && typeof maybeRecord.details === "object"
      ? (maybeRecord.details as Record<string, unknown>)
      : {};
  return [
    error instanceof Error ? error.name : "",
    message,
    maybeRecord.status,
    maybeRecord.code,
    maybeRecord.type,
    maybeDetails.code,
  ]
    .filter(Boolean)
    .join(" ");
}

export function isProviderQuotaError(error: unknown) {
  return /\b(?:insufficient[_\s-]?quota|quota|billing)\b/i.test(providerErrorText(error));
}

export function isProviderRateLimitError(error: unknown) {
  const message = providerErrorText(error);
  return !isProviderQuotaError(error) && /\b(?:429|rate[_\s-]?limit(?:ed)?|too many requests)\b/i.test(message);
}

export async function withProviderBackoff<T>(
  label: string,
  operation: () => Promise<T>,
  options: { maxAttempts?: number; initialDelayMs?: number; maxDelayMs?: number; onFailedAttempt?: () => void } = {},
) {
  const maxAttempts = options.maxAttempts ?? providerRetryNumber(process.env.RAG_EVAL_PROVIDER_RETRY_ATTEMPTS, 4);
  const initialDelayMs =
    options.initialDelayMs ?? providerRetryNumber(process.env.RAG_EVAL_PROVIDER_RETRY_INITIAL_MS, 5_000);
  const maxDelayMs = options.maxDelayMs ?? providerRetryNumber(process.env.RAG_EVAL_PROVIDER_RETRY_MAX_MS, 45_000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      options.onFailedAttempt?.();
      if (!isProviderRateLimitError(error) || attempt >= maxAttempts) throw error;
      const delayMs = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      console.warn(
        `[eval] Provider rate limit during ${label}; retrying attempt ${attempt + 1}/${maxAttempts} in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`Provider retry loop exhausted for ${label}.`);
}

export async function withProviderBackoffProgress<TProgress, TResult>(
  label: string,
  operation: (onProgress: (event: TProgress) => void) => Promise<TResult>,
  options: { maxAttempts?: number; initialDelayMs?: number; maxDelayMs?: number } = {},
) {
  let successfulProgress: TProgress[] = [];
  const result = await withProviderBackoff(
    label,
    async () => {
      const attemptProgress: TProgress[] = [];
      const attemptResult = await operation((event) => attemptProgress.push(event));
      successfulProgress = attemptProgress;
      return attemptResult;
    },
    options,
  );
  return { result, progress: successfulProgress };
}

/** Shared owner lookup; see scripts/lib/find-owner-id-by-email.ts. Re-exported so eval callers keep their import. */
export { findOwnerIdByEmail };

/**
 * Committed default eval owner. Since the 2026-07-06 public promotion the live corpus is entirely
 * `owner_id = NULL`, so owner-scoped retrieval must run as the public-owner sentinel
 * (`retrieval_owner_matches` maps it to NULL-owner rows, mirroring anonymous production search). A
 * real owner UUID now scopes retrieval to zero documents. See docs/retrieval-quality-runbook.md.
 */
export const DEFAULT_EVAL_OWNER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Resolve the owner id for a READ/eval run. Precedence: explicit `--owner-id` / `RAG_EVAL_OWNER_ID`
 * / `LOCAL_NO_AUTH_OWNER_ID` (already folded into `args.ownerId`) → `--owner-email` /
 * `RAG_EVAL_OWNER_EMAIL` lookup → the public-owner sentinel. Emits a one-line warning when it falls
 * back to the sentinel so the narrowing to public-only scope is visible, not silent.
 *
 * Do NOT use in write/backfill scripts — defaulting an owner there could write under the wrong owner.
 */
export async function resolveEvalOwnerId(
  supabase: SupabaseAdmin,
  args: { ownerId?: string; ownerEmail?: string },
): Promise<string> {
  const resolved = args.ownerId ?? (args.ownerEmail ? await findOwnerIdByEmail(supabase, args.ownerEmail) : undefined);
  if (resolved) return resolved;
  console.warn(
    `[eval] No eval owner set (RAG_EVAL_OWNER_ID / LOCAL_NO_AUTH_OWNER_ID / --owner-id / --owner-email); ` +
      `defaulting to the public-owner sentinel ${DEFAULT_EVAL_OWNER_ID}. The live corpus is all-public ` +
      `(owner_id = NULL); set an explicit owner to scope the eval to a real owner instead.`,
  );
  return DEFAULT_EVAL_OWNER_ID;
}

export function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

export function expectedFileHit(
  expectedFiles: string[],
  sources: Array<Pick<SearchResult, "file_name" | "title">>,
  limit = 3,
) {
  return expectedFileCoverage(expectedFiles, sources, limit).anyHit;
}

export function hasInvalidVisualEvidence(cards: VisualEvidenceCard[] = []) {
  return cards.some((card) => card.image_type === "logo_decorative" || card.clinical_relevance_score === 0);
}

const directClaimClinicalTargetSource = String.raw`(?:the\s+)?(?:(?:treating|responsible|senior|on[-\s]?call)\s+(?:doctor|clinician|medical\s+officer|prescriber)|(?:treating|responsible|senior|on[-\s]?call|medical|clinical)\s+team|prescriber)`;
const directClaimPrescriptiveEscalationPattern = new RegExp(
  String.raw`(?:^|[,;:]\s*)(?:please\s+)?(?:escalate\b[^.!?]{0,180}\b(?:to|with)\s+${directClaimClinicalTargetSource}\b|(?:contact|notify|inform|consult)\s+${directClaimClinicalTargetSource}\b)|\b(?:must|should|needs?\s+to|is\s+to|are\s+to|required\s+to)\s+(?:(?:promptly|urgently|immediately|directly|also|then)\s+){0,2}(?:be\s+)?escalat(?:e|ed)\b[^.!?]{0,120}\b(?:to|with)\s+${directClaimClinicalTargetSource}\b`,
  "i",
);
const directClaimMedicationEntityPattern = /\b(?:neuroleptic|antipsychotic)\b/i;
const directClaimSideEffectPattern = /\b(?:side|adverse)\s+effects?\b/i;
const directClaimDistressTriggerPattern =
  /(?:\b(?:side|adverse)\s+effects?\b[^.!?]{0,70}\bcaus(?:e|es|ed|ing)\b[^.!?]{0,30}\bdistress\b|\bdistressing\b[^.!?]{0,50}\b(?:side|adverse)\s+effects?\b|\b(?:side|adverse)\s+effects?\b[^.!?]{0,35}\b(?:is|are|becomes?|became)\s+distressing\b)/i;
const directClaimScoreIndependencePattern =
  /(?:\b(?:irrespective|regardless|independent(?:ly)?)\s+of\s+(?:the\s+)?(?:lunsers\s+)?scores?\b|\bno\s+matter\s+(?:what|which)\s+(?:the\s+)?(?:lunsers\s+)?scores?\b|\bscor(?:e|es|ed|ing)\b[^.!?]{0,80}\bnot\s+essential\b[^.!?]{0,60}\bactions?\b)/i;
const directClaimNegatedOrOppositeActionPattern =
  /(?:\bde[-\s]?escalat\w*\b|\b(?:do|does|did|should|must|need)\s+not\b[^.!?]{0,60}\b(?:escalat\w*|contact|notify|inform|consult)\b|\bnot\s+to\s+(?:escalat\w*|contact|notify|inform|consult)\b|\b(?:no|without)\s+(?:need|requirement)\s+to\s+(?:escalat\w*|contact|notify|inform|consult)\b|\b(?:escalation|contact|notification|review)\b[^.!?]{0,25}\b(?:not\s+(?:required|indicated)|unnecessary|contraindicated)\b|\b(?:escalate|contact|notify|inform|consult)\s+(?:no|neither)\b|\b(?:no|neither)\s+(?:(?:neuroleptic|antipsychotic)\s+)?(?:side|adverse)\s+effects?\b|\b(?:do|does|did)\s+not\s+caus(?:e|es|ed|ing)\b|\b(?:without|not)\s+(?:(?:necessarily|always)\s+)?caus(?:e|es|ed|ing)\b[^.!?]{0,30}\bdistress\b|\bcaus(?:e|es|ed|ing)\b[^.!?]{0,20}\b(?:no|neither)\s+distress\b|\b(?:not|never)\s+distressing\b|\b(?:not|never)\s+(?:irrespective|regardless|independent(?:ly)?)\s+of\s+(?:the\s+)?(?:lunsers\s+)?scores?\b)/i;
const directClaimHistoricalOrDescriptivePattern =
  /(?:\b(?:audit|audited|retrospective|case\s+review|incident\s+report|minutes?|case\s+notes?|historical|study|survey)\b|\b(?:was|were|has\s+been|had\s+been)\s+(?:recorded|reported|documented|noted|found|observed|audited)\b|\b(?:previous|prior|earlier|former|superseded|obsolete|archived|withdrawn|legacy|retired|repealed|discontinued|outdated)\b)/i;
const directClaimScoreDependentActionPattern =
  /(?:\b(?:only|solely)\s+(?:when|if)\b[^.!?]{0,60}\b(?:score|scoring)\b|\b(?:score|scoring)\b[^.!?]{0,60}\b(?:must|should|needs?\s+to|has\s+to)\s+be\s+(?:high|elevated|above|over)\b)/i;

function satisfiesDirectClaimSemanticContract(
  text: string,
  semanticContract: NonNullable<RagEvalCase["requiredDirectClaim"]>["semanticContract"],
) {
  if (!semanticContract) return true;
  if (semanticContract !== "positive_prescriptive_score_independent_distress_escalation") return false;

  return text
    .replace(/\s+/g, " ")
    .split(/(?:(?<=[.!?])\s+|\s*;\s*|\s*\b(?:but|whereas|while|however)\b\s*)/i)
    .some(
      (sentence) =>
        !directClaimNegatedOrOppositeActionPattern.test(sentence) &&
        !directClaimHistoricalOrDescriptivePattern.test(sentence) &&
        !directClaimScoreDependentActionPattern.test(sentence) &&
        directClaimMedicationEntityPattern.test(sentence) &&
        directClaimSideEffectPattern.test(sentence) &&
        directClaimPrescriptiveEscalationPattern.test(sentence) &&
        directClaimDistressTriggerPattern.test(sentence) &&
        directClaimScoreIndependencePattern.test(sentence),
    );
}

export function validateRagAnswer(testCase: RagEvalCase, answer: RagAnswer) {
  const failures: string[] = [];
  const expectedCoverage = expectedFileCoverage(
    testCase.expectedFiles,
    answer.sources,
    testCase.expectedFiles.length > 1 ? 5 : 3,
  );
  const expectedHit = testCase.expectedFiles.length > 1 ? expectedCoverage.allHit : expectedCoverage.anyHit;
  const expectedCitationCoverage = expectedFileCoverage(
    testCase.expectedFiles,
    answer.citations,
    answer.citations.length,
  );
  const route = answer.routingMode ?? "unsupported";
  const visualEvidence = answer.visualEvidence ?? [];
  const routingReasons = (answer.routingReason ?? "").split(";").map((reason) => reason.trim().toLowerCase());
  const acceptedReviewFallback =
    testCase.acceptedReviewFallbackReason !== undefined &&
    !answer.grounded &&
    routingReasons.includes("source_backed_review_fallback") &&
    routingReasons.includes(`extractive_quality_gate:${testCase.acceptedReviewFallbackReason}`);

  if (acceptedReviewFallback) {
    if (!testCase.allowedRoutes.includes(route)) failures.push(`unexpected route ${route}`);
    if (testCase.expectedQueryClass && answer.queryClass !== testCase.expectedQueryClass) {
      failures.push(`expected query class ${testCase.expectedQueryClass}, got ${answer.queryClass ?? "none"}`);
    }
    return { expectedHit, expectedCoverage, failures };
  }

  // acceptSourceOnly cases (diffuse questions with no single authoritative source) may
  // legitimately return a source-only answer (grounded=false); the retrieval regression
  // guard for them is the expected-document coverage check below, not grounding.
  if (testCase.supported && !answer.grounded && !testCase.acceptSourceOnly) {
    failures.push("expected grounded answer");
  }
  if (!testCase.supported && answer.grounded) failures.push("expected unsupported answer");
  if (testCase.falsePositiveControl && answer.grounded)
    failures.push("false-positive control produced grounded answer");
  if (!testCase.allowedRoutes.includes(route)) failures.push(`unexpected route ${route}`);
  if (testCase.expectedQueryClass && answer.queryClass !== testCase.expectedQueryClass) {
    failures.push(`expected query class ${testCase.expectedQueryClass}, got ${answer.queryClass ?? "none"}`);
  }
  if (answer.citations.length < testCase.minCitations)
    failures.push(`expected at least ${testCase.minCitations} citations`);
  if (testCase.requireExpectedFileCitation && !expectedCitationCoverage.allHit) {
    failures.push(`expected documents missing from citations: ${expectedCitationCoverage.missingFiles.join(", ")}`);
  }
  if (testCase.requiredDirectClaim) {
    const requiredDirectClaim = testCase.requiredDirectClaim;
    const normalizedConcept = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const qualifyingClaim = (answer.supportedClaims ?? []).find((claim) => {
      if (claim.riskClass !== requiredDirectClaim.riskClass || claim.supportStatus !== "direct") return false;
      const claimText = normalizedConcept(claim.text);
      return (
        (requiredDirectClaim.conceptAlternatives ?? []).every((alternatives) =>
          alternatives.some((alternative) => claimText.includes(normalizedConcept(alternative))),
        ) && satisfiesDirectClaimSemanticContract(claim.text, requiredDirectClaim.semanticContract)
      );
    });
    const supportingIds = new Set(qualifyingClaim?.supportingChunkIds ?? []);
    const supportingCitations = answer.citations.filter((citation) => supportingIds.has(citation.chunk_id));
    const supportingExpectedCoverage = expectedFileCoverage(
      testCase.expectedFiles,
      supportingCitations,
      supportingCitations.length,
    );
    if (!qualifyingClaim || supportingCitations.length === 0 || !supportingExpectedCoverage.allHit) {
      failures.push("required direct claim is not fully covered by an expected-file citation");
    }
  }
  if (testCase.expectedFiles.length > 1 && !expectedCoverage.allHit) {
    failures.push(`expected documents missing from top 5: ${expectedCoverage.missingFiles.join(", ")}`);
  } else if (testCase.expectedFiles.length === 1 && !expectedCoverage.anyHit) {
    failures.push("expected document not in retrieved sources");
  }
  if (testCase.requireVisualEvidence && visualEvidence.length === 0) failures.push("expected visual evidence");
  if (hasInvalidVisualEvidence(visualEvidence)) failures.push("decorative or zero-relevance visual evidence returned");
  if (testCase.category === "complex" && (answer.latencyTimings?.total_latency_ms ?? 0) > testCase.latencyTargetMs) {
    failures.push(`latency over ${testCase.latencyTargetMs}ms`);
  }
  if (testCase.supported && ((answer.unverifiedNumericTokens?.length ?? 0) > 0 || answer.faithfulnessWarning)) {
    failures.push(
      `clinical numeric faithfulness warning present (${answer.unverifiedNumericTokens?.length ?? 0} unverified token(s))`,
    );
  }

  return { expectedHit, expectedCoverage, failures };
}

export function configuredCostRates() {
  const input = Number(process.env.RAG_EVAL_INPUT_USD_PER_MILLION);
  const cachedInput = Number(process.env.RAG_EVAL_CACHED_INPUT_USD_PER_MILLION);
  const output = Number(process.env.RAG_EVAL_OUTPUT_USD_PER_MILLION);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;

  return {
    input,
    cachedInput: Number.isFinite(cachedInput) ? cachedInput : input,
    output,
  };
}

export function estimateCostUsd(result: { inputTokens: number; cachedInputTokens: number; outputTokens: number }) {
  const rates = configuredCostRates();
  if (!rates) return null;

  const uncachedInput = Math.max(result.inputTokens - result.cachedInputTokens, 0);
  return (
    (uncachedInput * rates.input + result.cachedInputTokens * rates.cachedInput + result.outputTokens * rates.output) /
    1_000_000
  );
}

/** Explicit USD per million token rates. No provider lookup or inferred model aliases. */
export type EvalModelPrices = Record<
  string,
  { input: number; cachedInput?: number; cacheWrite?: number; output: number }
>;
export type EvalProviderAttempt = { model: string; usage?: OpenAITokenUsage };
export type EvalCostEstimate = {
  estimatedCostUsd: number | null;
  pricingBasis: "usage_estimate" | "cache_write_upper_bound" | "legacy_rate_estimate" | "provider_free" | "unknown";
};

const validCostNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function estimateProviderAttemptsCost(
  attempts: readonly EvalProviderAttempt[],
  prices: EvalModelPrices,
): EvalCostEstimate {
  let total = 0;
  let boundedCacheWrite = false;
  for (const attempt of attempts) {
    const rates = Object.hasOwn(prices, attempt.model) ? prices[attempt.model] : undefined;
    const usage = attempt.usage;
    if (
      !rates ||
      !usage ||
      !validCostNumber(rates.input) ||
      !validCostNumber(rates.output) ||
      (rates.cachedInput !== undefined && !validCostNumber(rates.cachedInput)) ||
      (rates.cacheWrite !== undefined && !validCostNumber(rates.cacheWrite)) ||
      !validCostNumber(usage.input_tokens) ||
      !validCostNumber(usage.output_tokens) ||
      (usage.cached_input_tokens !== undefined && !validCostNumber(usage.cached_input_tokens)) ||
      (usage.cache_write_tokens !== undefined && !validCostNumber(usage.cache_write_tokens))
    )
      return { estimatedCostUsd: null, pricingBasis: "unknown" };
    const cached = usage.cached_input_tokens ?? 0;
    const uncached = usage.input_tokens - cached;
    if (uncached < 0 || (usage.cache_write_tokens ?? 0) > uncached) {
      return { estimatedCostUsd: null, pricingBasis: "unknown" };
    }
    const writeRate = rates.cacheWrite ?? rates.input;
    // When the provider does not expose cache-write usage, reserve its possible premium
    // over every uncached input token. This is an upper estimate, never measured writes.
    const unknownWritePremium = usage.cache_write_tokens === undefined && writeRate > rates.input && uncached > 0;
    const writes = usage.cache_write_tokens ?? (unknownWritePremium ? uncached : 0);
    boundedCacheWrite ||= unknownWritePremium;
    // Reasoning tokens are a subset of output_tokens, so never add them again.
    total +=
      ((uncached - writes) * rates.input +
        writes * writeRate +
        cached * (rates.cachedInput ?? rates.input) +
        usage.output_tokens * rates.output) /
      1_000_000;
  }
  return Number.isFinite(total)
    ? { estimatedCostUsd: total, pricingBasis: boundedCacheWrite ? "cache_write_upper_bound" : "usage_estimate" }
    : { estimatedCostUsd: null, pricingBasis: "unknown" };
}

export function estimateProviderAttemptsCostUsd(attempts: readonly EvalProviderAttempt[], prices: EvalModelPrices) {
  return estimateProviderAttemptsCost(attempts, prices).estimatedCostUsd;
}

/** Model-priced mode fails closed when only aggregate/final-model telemetry is available. */
export function estimateAnswerCost(
  answer: Pick<RagAnswer, "openAIUsage" | "openAIUsageAttempts">,
  providerAttempted: boolean,
  unpricedAttempts = 0,
): EvalCostEstimate {
  if (unpricedAttempts > 0) return { estimatedCostUsd: null, pricingBasis: "unknown" };
  if (!providerAttempted && !answer.openAIUsageAttempts?.length) {
    return { estimatedCostUsd: 0, pricingBasis: "provider_free" };
  }
  const rawPrices = process.env.RAG_EVAL_MODEL_PRICES_JSON;
  if (rawPrices !== undefined) {
    if (!answer.openAIUsageAttempts?.length) return { estimatedCostUsd: null, pricingBasis: "unknown" };
    try {
      const prices: unknown = JSON.parse(rawPrices);
      if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
        return { estimatedCostUsd: null, pricingBasis: "unknown" };
      }
      return estimateProviderAttemptsCost(answer.openAIUsageAttempts, prices as EvalModelPrices);
    } catch {
      return { estimatedCostUsd: null, pricingBasis: "unknown" };
    }
  }
  // Existing env overrides retain their historical aggregate estimate. A failed
  // observed attempt without usage must still make even this estimate unknown.
  if (
    answer.openAIUsageAttempts?.some(
      ({ usage }) =>
        !usage ||
        !validCostNumber(usage.input_tokens) ||
        !validCostNumber(usage.output_tokens) ||
        (usage.cached_input_tokens !== undefined &&
          (!validCostNumber(usage.cached_input_tokens) || usage.cached_input_tokens > usage.input_tokens)) ||
        (usage.cache_write_tokens !== undefined &&
          (!validCostNumber(usage.cache_write_tokens) ||
            usage.cache_write_tokens > usage.input_tokens - (usage.cached_input_tokens ?? 0))),
    )
  ) {
    return { estimatedCostUsd: null, pricingBasis: "unknown" };
  }
  const usage = answer.openAIUsage;
  const estimatedCostUsd =
    usage && (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) > 0
      ? estimateCostUsd({
          inputTokens: usage.input_tokens ?? 0,
          cachedInputTokens: usage.cached_input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
        })
      : null;
  return { estimatedCostUsd, pricingBasis: estimatedCostUsd === null ? "unknown" : "legacy_rate_estimate" };
}
