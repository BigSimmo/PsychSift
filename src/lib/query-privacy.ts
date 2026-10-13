import { isAnswerRequestContextQuery } from "@/lib/answer-request-context";
import { createHash, createHmac } from "node:crypto";
import { clinicalVocabularyMatches } from "@/lib/clinical-vocabulary";
import { env } from "@/lib/env";

export function normalizeQueryText(query: string) {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

// Audit M15: an unsalted SHA-256 of a short, low-entropy clinical query is
// dictionary-reversible (hash candidate patient/drug strings offline and
// match) and lets any reader of the log tables correlate the same query
// across rows — undermining the redaction it implements. When
// RAG_QUERY_HASH_SECRET is set, the stored hash is a keyed pseudonym
// (HMAC-SHA256): not offline-reversible and not correlatable outside this
// deployment. Without the secret, the legacy unsalted digest is kept so
// existing stored rows still join/dedup; set the secret in any environment
// where real clinical queries are logged.
const NON_PRODUCTION_QUERY_HASH_SALT = "psychsift-non-production-query-hash-salt";

export function hashQueryText(query: string) {
  const normalized = normalizeQueryText(query);
  const secret =
    env.RAG_QUERY_HASH_SECRET || (process.env.NODE_ENV !== "production" ? NON_PRODUCTION_QUERY_HASH_SALT : undefined);
  if (secret) {
    return createHmac("sha256", secret).update(normalized).digest("hex");
  }
  return createHash("sha256").update(normalized).digest("hex");
}

function queryHashStorageText(query: string) {
  return `redacted-query:${hashQueryText(query)}`;
}

const medicarePattern = /\b[2-6]\d{3}\s?\d{5}\s?\d\b/g;
const phonePattern = /(?<!\w)(?:\+?61[\s.-]?[2-478]|\(?0[2-478]\)?)(?:[\s.-]?\d){8}\b/g;
const mrnPattern = /\b(?:MRN|UR|UMRN)[:#\s]*(?=[A-Z0-9-]{6,12}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/gi;
const dobPattern = /\b(?:DOB|D\.O\.B\.|born)[:\s]*(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/gi;

/**
 * Best-effort scrubbing of supported identifier formats in query-text columns.
 * This does not guarantee complete de-identification.
 */
export function scrubPotentialPhi(text: string): string {
  if (!text) return "";
  return text
    .replace(medicarePattern, "[REDACTED_MEDICARE]")
    .replace(phonePattern, "[REDACTED_PHONE]")
    .replace(mrnPattern, "[REDACTED_MRN]")
    .replace(dobPattern, "[REDACTED_DOB]");
}

// Raw clinical search queries are potential PHI. Unless raw retention is
// explicitly enabled, persist only a deterministic hash placeholder (RET-H4).
// When raw retention is enabled, supported formats are scrubbed in these two text columns.
// Other raw-retention paths remain separately controlled; this is not a complete PHI filter.
// The `query`/`normalized_query` columns are NOT NULL, so the placeholder keeps
// joins/dedup possible without storing patient-identifying text.
export function queryTextForStorage(query: string): string {
  return env.RAG_PERSIST_RAW_QUERY_TEXT && !isAnswerRequestContextQuery(query)
    ? scrubPotentialPhi(query)
    : queryHashStorageText(query);
}

export function normalizedQueryTextForStorage(query: string): string {
  return env.RAG_PERSIST_RAW_QUERY_TEXT && !isAnswerRequestContextQuery(query)
    ? normalizeQueryText(scrubPotentialPhi(query))
    : queryHashStorageText(query);
}

// PIA-3: the generated answer is stored verbatim in rag_queries.answer (and in
// promoted-eval-case metadata), so it can restate patient specifics echoed from
// the query. Unless answer retention is explicitly enabled, drop the answer text
// at rest and keep only the row's non-PHI telemetry (source chunk ids, model,
// hash metadata). The column is nullable, so null is the valid "not retained"
// marker. This is the single chokepoint governing answer-text persistence.
export function answerTextForStorage(answer: string | null | undefined): string | null {
  return env.RAG_PERSIST_ANSWER_TEXT ? (answer ?? null) : null;
}

// Privacy metadata to fold into a persisted row that carries an answer: records
// whether the generated answer text was retained, mirroring raw_query_retained.
export function answerPrivacyMetadata() {
  return { answer_retained: env.RAG_PERSIST_ANSWER_TEXT };
}

export function queryCacheKeyForStorage(cacheKey: string, originalQuery?: string): string {
  return env.RAG_PERSIST_RAW_QUERY_TEXT && !isAnswerRequestContextQuery(originalQuery ?? cacheKey)
    ? cacheKey
    : `redacted-cache:${hashQueryText(cacheKey)}`;
}

export function queryDerivedTokensForStorage(tokens: string[], originalQuery?: string): string[] {
  return env.RAG_PERSIST_RAW_QUERY_TEXT && !isAnswerRequestContextQuery(originalQuery ?? "") ? tokens : [];
}

// RET-H4-safe candidate aliases for the alias-promotion pipeline (rag-hybrid-findings
// item 17): every returned string is a canonical term from the curated clinical
// vocabulary that the query MATCHED — the output text comes from the fixed vocabulary
// table, never from the raw query — so patient-identifying text cannot leak even with
// raw retention off. This unblocks rag_query_misses.candidate_aliases, which was always
// empty under redaction and starved data-driven promotion into rag_aliases.
export function queryVocabularyAliasesForStorage(query: string, limit = 10): string[] {
  return Array.from(new Set(clinicalVocabularyMatches(query, limit).map((entry) => entry.canonical))).slice(0, limit);
}

// Privacy metadata to fold into a logged row's `metadata` jsonb: a stable hash
// for joins/dedup and a flag recording whether raw text was retained.
export function queryPrivacyMetadata(query: string) {
  return {
    query_hash: hashQueryText(query),
    raw_query_retained: env.RAG_PERSIST_RAW_QUERY_TEXT && !isAnswerRequestContextQuery(query),
  };
}
