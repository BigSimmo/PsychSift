import type { ProviderFailureKind } from "@/lib/rag/rag-provider";
import type { RagAnswer, RagFallbackReasonCode, RagInsufficiencyReason, RetrievalDiagnostics } from "@/lib/types";

const fallbackCodes = new Set<RagFallbackReasonCode>([
  "provider_offline",
  "provider_missing_key",
  "provider_auth",
  "provider_quota",
  "provider_rate_limit",
  "provider_timeout",
  "provider_failure",
  "retrieval_degraded",
  "no_candidates",
  "low_signal",
  "coverage_gap",
  "source_role_mismatch",
  "source_conflict",
  "source_governance_block",
  "site_content_updating",
  "site_content_stale",
  "site_content_unavailable",
  "citation_or_claim_gate",
  "unsupported",
  "unknown",
]);

export function normalizeRagFallbackReasonCode(value: unknown): RagFallbackReasonCode | null {
  if (value == null) return null;
  return typeof value === "string" && fallbackCodes.has(value as RagFallbackReasonCode)
    ? (value as RagFallbackReasonCode)
    : "unknown";
}

export function isRagFallbackReasonCode(value: unknown): value is RagFallbackReasonCode {
  return typeof value === "string" && normalizeRagFallbackReasonCode(value) === value;
}

export type RagFallbackInput = {
  fallbackReasonCode?: RagFallbackReasonCode | null;
  insufficiencyReason?: RagInsufficiencyReason | null;
  providerFailure?: ProviderFailureKind | null;
  routingReason?: string | null;
};

const insufficiencyFallback: Record<RagInsufficiencyReason, RagFallbackReasonCode> = {
  not_in_corpus: "coverage_gap",
  retrieval_miss: "no_candidates",
  insufficient_claim_support: "coverage_gap",
  source_role_mismatch: "source_role_mismatch",
  source_conflict: "source_conflict",
  governance_block: "source_governance_block",
  site_content_updating: "site_content_updating",
  site_content_stale: "site_content_stale",
  site_content_unavailable: "site_content_unavailable",
  timeout: "provider_timeout",
  provider_failure: "provider_failure",
};

const providerFailureCodes: Record<ProviderFailureKind, RagFallbackReasonCode> = {
  missing_key: "provider_missing_key",
  auth_failed: "provider_auth",
  quota_exhausted: "provider_quota",
  rate_limited: "provider_rate_limit",
  timeout: "provider_timeout",
  provider_failed: "provider_failure",
};

function legacyFallbackReason(reason: string): RagFallbackReasonCode {
  const normalized = reason.trim().toLowerCase();
  if (normalized === "source_only_auth_failed") return "provider_auth";
  if (normalized === "source_only_provider_failed") return "provider_failure";
  if (
    /\b(?:adversarial[_ -]?manipulation[_ -]?refused|governance[_ -]?block|source[_ -]?governance)\b/.test(normalized)
  ) {
    return "source_governance_block";
  }
  if (/\bsource[_ -]?role[_ -]?mismatch\b/.test(normalized)) return "source_role_mismatch";
  if (/\bsource[_ -]?conflict\b/.test(normalized)) return "source_conflict";
  if (/\bsite[_ -]?content[_ -]?updating\b/.test(normalized)) return "site_content_updating";
  if (/\bsite[_ -]?content[_ -]?stale\b/.test(normalized)) return "site_content_stale";
  if (/\bsite[_ -]?content[_ -]?unavailable\b/.test(normalized)) return "site_content_unavailable";
  if (
    /\b(?:post[_ -]?generation[_ -]?claim[_ -]?quality[_ -]?gate|citation[_ -]?(?:gate|failure|unsupported))\b/.test(
      normalized,
    )
  ) {
    return "citation_or_claim_gate";
  }
  if (/(?:claim[_ -]?support|numeric[_ -]?faithfulness|generation[_ -]?quality)(?:[_ -]|$)/.test(normalized)) {
    return "citation_or_claim_gate";
  }
  if (/\b(?:no[_ -]?(?:candidates?|results?|retrieved[_ -]?sources?))\b/.test(normalized)) return "no_candidates";
  if (/\b(?:confidence[_ -]?gate[_ -]?blocked|low[_ -]?signal|below[_ -]?threshold)\b/.test(normalized)) {
    return "low_signal";
  }
  if (
    /\b(?:comparison[_ -]?evidence[_ -]?gap|coverage[_ -]?gap|not[_ -]?in[_ -]?corpus|insufficient[_ -]?claim[_ -]?support|provider[_ -]?source[_ -]?gap|source[_ -]?gap)\b/.test(
      normalized,
    )
  ) {
    return "coverage_gap";
  }
  if (/(?:^|[_\s-])(?:timeout|timed out|etimedout|deadline exceeded)\b/.test(normalized)) return "provider_timeout";
  if (/\bsource_only_offline_mode\b/.test(normalized)) return "provider_offline";
  if (/\bsource_only_(?:no_api|missing_key)\b/.test(normalized)) return "provider_missing_key";
  if (/\b(?:missing|no)[_ -]?(?:api[_ -]?)?key\b/.test(normalized)) return "provider_missing_key";
  if (/provider[_ -]?auth(?:[_ -]?failed)?/.test(normalized)) return "provider_auth";
  if (/(?:provider[_ -]?quota|quota[_ -]?exhausted)/.test(normalized)) return "provider_quota";
  if (/provider[_ -]?rate[_ -]?limit(?:ed)?/.test(normalized)) return "provider_rate_limit";
  if (/\b(?:unauthori[sz]ed|authentication|invalid[_ -]?key|\b401\b|\b403\b)\b/.test(normalized)) {
    return "provider_auth";
  }
  if (/\b(?:quota|insufficient[_ -]?credits?)\b/.test(normalized)) return "provider_quota";
  if (/\b(?:rate[_ -]?limit|too many requests|\b429\b)\b/.test(normalized)) return "provider_rate_limit";
  if (/\b(?:provider[_ -]?offline|provider[_ -]?unavailable)\b/.test(normalized)) return "provider_offline";
  if (/\b(?:retrieval[_ -]?degraded|vector[_ -]?fallback|hybrid[_ -]?fallback)\b/.test(normalized)) {
    return "retrieval_degraded";
  }
  if (/\bunsupported\b/.test(normalized)) return "unsupported";
  if (/\b(?:generation_fallback|hybrid_error|provider_error|generation_error)\b/.test(normalized)) {
    return "provider_failure";
  }
  return "unknown";
}

export function classifyRagFallbackReason(input: RagFallbackInput): RagFallbackReasonCode {
  if (input.fallbackReasonCode != null) return normalizeRagFallbackReasonCode(input.fallbackReasonCode) ?? "unknown";
  if (input.insufficiencyReason) return insufficiencyFallback[input.insufficiencyReason] ?? "unknown";
  if (input.providerFailure) return providerFailureCodes[input.providerFailure] ?? "unknown";
  return input.routingReason ? legacyFallbackReason(input.routingReason) : "unknown";
}

const legacyFallbackMarker =
  /source_only_[a-z_]+|fallback|unsupported|no_|limited_retrieval|gap|conflict|failed|confidence_gate|low_signal|adversarial|governance|citation|claim_quality/i;

export function fallbackReasonFromRouting(input: RagFallbackInput | string): RagFallbackReasonCode | null;
export function fallbackReasonFromRouting(input: null | undefined): null;
export function fallbackReasonFromRouting(
  input: RagFallbackInput | string | null | undefined,
): RagFallbackReasonCode | null;
export function fallbackReasonFromRouting(
  input: RagFallbackInput | string | null | undefined,
): RagFallbackReasonCode | null {
  if (input == null) return null;
  if (typeof input !== "string" && (input.fallbackReasonCode || input.insufficiencyReason || input.providerFailure)) {
    return classifyRagFallbackReason(input);
  }
  const routingReason = typeof input === "string" ? input : input.routingReason;
  return routingReason && legacyFallbackMarker.test(routingReason)
    ? classifyRagFallbackReason({ routingReason })
    : null;
}

const strongerGovernanceCodes = new Set<RagFallbackReasonCode>([
  "source_role_mismatch",
  "source_conflict",
  "source_governance_block",
  "site_content_updating",
  "site_content_stale",
  "site_content_unavailable",
  "citation_or_claim_gate",
]);

export function isStrongerGovernanceFallbackReasonCode(code?: RagFallbackReasonCode | null): boolean {
  return code != null && strongerGovernanceCodes.has(code);
}

/** Return only governance failures that may supersede an earlier provider/base fallback. */
export function strongerGovernanceFallbackReasonFromRouting(reason?: string | null): RagFallbackReasonCode | null {
  const inferred = fallbackReasonFromRouting(reason);
  return isStrongerGovernanceFallbackReasonCode(inferred) ? inferred : null;
}

const providerGenerationFallbackCodes = new Set<RagFallbackReasonCode>([
  "provider_offline",
  "provider_missing_key",
  "provider_auth",
  "provider_quota",
  "provider_rate_limit",
  "provider_timeout",
  "provider_failure",
]);

export function isProviderGenerationFallbackCode(code?: RagFallbackReasonCode | null): boolean {
  return code != null && providerGenerationFallbackCodes.has(code);
}

export function generationFallbackReasonCode(
  providerFailure: NonNullable<RagFallbackInput["providerFailure"]>,
  legacyReason: string,
): RagFallbackReasonCode {
  if (legacyReason === "provider_source_gap") return "coverage_gap";
  if (/(?:generation_quality|source_backed_extractive_recovery|faithfulness)/.test(legacyReason)) {
    return "citation_or_claim_gate";
  }
  return classifyRagFallbackReason({ providerFailure });
}

const publicReasons: Record<RagFallbackReasonCode, string> = {
  provider_offline: "Answer generation is temporarily unavailable; the verified source-backed portion is shown.",
  provider_missing_key: "Answer generation is not configured; the verified source-backed portion is shown.",
  provider_auth: "Answer generation could not be authorized; the verified source-backed portion is shown.",
  provider_quota: "Answer generation is temporarily unavailable; the verified source-backed portion is shown.",
  provider_rate_limit: "Answer generation is temporarily busy; the verified source-backed portion is shown.",
  provider_timeout: "Answer generation timed out; the verified source-backed portion is shown.",
  provider_failure: "The generated answer could not be completed; the verified source-backed portion is shown.",
  retrieval_degraded: "Search used a reduced retrieval path; review the cited sources carefully.",
  no_candidates: "No directly relevant source passage was found in the active corpus.",
  low_signal: "The available source passages did not provide a strong enough match.",
  coverage_gap: "The active sources support only part of this question.",
  source_role_mismatch: "The available sources are not suitable for this clinical claim.",
  source_conflict: "Current sources contain a material difference that requires review.",
  source_governance_block: "Available material did not meet the source-governance requirements.",
  site_content_updating: "Relevant first-party content is currently updating.",
  site_content_stale: "Relevant first-party content is stale and was not used as current evidence.",
  site_content_unavailable: "Relevant first-party content is currently unavailable.",
  citation_or_claim_gate: "The answer could not be verified against its cited source passages.",
  unsupported: "The active sources do not support this request.",
  unknown: "The answer could not be completed from the currently verified sources.",
};

export function publicFallbackReason(code: RagFallbackReasonCode): string {
  return publicReasons[code] ?? publicReasons.unknown;
}

export const NO_CONFIRMED_SOURCES_REASON =
  "Source evidence could not be confirmed, so no verified passages are shown. Please try again.";

/**
 * The degraded-mode sentence for an answer. A provider code's own wording promises a verified
 * source-backed portion, which is false when no source came back: a search that timed out also
 * reports provider_timeout (audit NEW-G-04).
 */
export function publicDegradedReason(code: RagFallbackReasonCode, sourceCount: number): string {
  if (isProviderGenerationFallbackCode(code) && sourceCount === 0) return NO_CONFIRMED_SOURCES_REASON;
  return publicFallbackReason(code);
}

/** Annotate answer with diagnostics. */
export function annotateAnswerWithDiagnostics<T extends RagAnswer>(
  answer: T,
  diagnostics: RetrievalDiagnostics,
  override?: { fallbackReason?: string | null; fallbackReasonCode?: RagFallbackReasonCode | null },
): T {
  const fallbackReason = override?.fallbackReason ?? diagnostics.fallbackReason ?? null;
  return {
    ...answer,
    ...(override?.fallbackReasonCode == null
      ? {}
      : {
          fallbackReasonCode: isStrongerGovernanceFallbackReasonCode(answer.fallbackReasonCode)
            ? answer.fallbackReasonCode
            : override.fallbackReasonCode,
        }),
    retrievalDiagnostics: {
      ...diagnostics,
      fallbackReason,
      retrievalReason: fallbackReason,
    },
  };
}
