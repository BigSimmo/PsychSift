import type { RagFallbackReasonCode, RagInsufficiencyReason } from "@/lib/types";

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

export type RagFallbackInput = {
  fallbackReasonCode?: RagFallbackReasonCode | null;
  insufficiencyReason?: RagInsufficiencyReason | null;
  providerFailure?: "offline" | "missing_key" | "auth" | "quota" | "rate_limit" | "timeout" | "failure" | null;
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

const providerFailureCodes: Record<string, RagFallbackReasonCode> = {
  offline: "provider_offline",
  missing_key: "provider_missing_key",
  auth: "provider_auth",
  quota: "provider_quota",
  rate_limit: "provider_rate_limit",
  timeout: "provider_timeout",
  failure: "provider_failure",
};

function legacyFallbackReason(reason: string): RagFallbackReasonCode {
  const normalized = reason.toLowerCase();
  if (/\b(?:generation_fallback|hybrid_error|provider_error|generation_error)\b/.test(normalized)) {
    return "provider_failure";
  }
  if (/\b(?:missing|no)[_ -]?(?:api[_ -]?)?key\b/.test(normalized)) return "provider_missing_key";
  if (/\b(?:unauthori[sz]ed|authentication|invalid[_ -]?key|\b401\b|\b403\b)\b/.test(normalized)) {
    return "provider_auth";
  }
  if (/\b(?:quota|insufficient[_ -]?credits?)\b/.test(normalized)) return "provider_quota";
  if (/\b(?:rate[_ -]?limit|too many requests|\b429\b)\b/.test(normalized)) return "provider_rate_limit";
  if (/\b(?:timeout|timed out|etimedout|deadline exceeded)\b/.test(normalized)) return "provider_timeout";
  if (/\b(?:provider[_ -]?offline|provider[_ -]?unavailable)\b/.test(normalized)) return "provider_offline";
  if (/\b(?:retrieval[_ -]?degraded|vector[_ -]?fallback|hybrid[_ -]?fallback)\b/.test(normalized)) {
    return "retrieval_degraded";
  }
  if (/\b(?:no[_ -]?candidates?|no[_ -]?results?)\b/.test(normalized)) return "no_candidates";
  if (/\b(?:low[_ -]?signal|below[_ -]?threshold)\b/.test(normalized)) return "low_signal";
  if (/\b(?:coverage[_ -]?gap|not[_ -]?in[_ -]?corpus|insufficient[_ -]?claim[_ -]?support)\b/.test(normalized)) {
    return "coverage_gap";
  }
  if (/\bsource[_ -]?role[_ -]?mismatch\b/.test(normalized)) return "source_role_mismatch";
  if (/\bsource[_ -]?conflict\b/.test(normalized)) return "source_conflict";
  if (/\b(?:governance[_ -]?block|source[_ -]?governance)\b/.test(normalized)) return "source_governance_block";
  if (/\bsite[_ -]?content[_ -]?updating\b/.test(normalized)) return "site_content_updating";
  if (/\bsite[_ -]?content[_ -]?stale\b/.test(normalized)) return "site_content_stale";
  if (/\bsite[_ -]?content[_ -]?unavailable\b/.test(normalized)) return "site_content_unavailable";
  if (/\b(?:citation|claim)[_ -]?(?:gate|failure|unsupported)\b/.test(normalized)) return "citation_or_claim_gate";
  if (/\bunsupported\b/.test(normalized)) return "unsupported";
  return "unknown";
}

export function classifyRagFallbackReason(input: RagFallbackInput): RagFallbackReasonCode {
  if (input.fallbackReasonCode && fallbackCodes.has(input.fallbackReasonCode)) return input.fallbackReasonCode;
  if (input.insufficiencyReason) return insufficiencyFallback[input.insufficiencyReason] ?? "unknown";
  if (input.providerFailure) return providerFailureCodes[String(input.providerFailure).toLowerCase()] ?? "unknown";
  return input.routingReason ? legacyFallbackReason(input.routingReason) : "unknown";
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
