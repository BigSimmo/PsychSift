import "server-only";

import { z } from "zod";
import { resolvePythonBin } from "@/lib/python-bin";
import { assertExpectedSupabaseProjectConfig, checkSupabaseProjectConfig } from "@/lib/supabase/project";
import { MAX_UPLOAD_MB_CEILING } from "@/lib/upload-limits";

/** Treat blank/whitespace as unset so offline scrub can pin "" without failing `.url()`. */
function coerceBlankUrlEnv(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_PROJECT_REF: z.string().optional(),
  SUPABASE_PROJECT_NAME: z.string().optional(),
  // Optional: declares a second accepted (staging) Supabase project so the
  // identity guard accepts it. Both must be set; the ref must differ from
  // production. See docs/staging-setup.md and src/lib/supabase/project.ts.
  SUPABASE_STAGING_PROJECT_REF: z.string().optional(),
  SUPABASE_STAGING_PROJECT_NAME: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SITE_CONTENT_RECOVERY_VALIDATION_SECRET: z.string().min(32).optional(),
  SITE_CONTENT_GOVERNANCE_GATE_OWNER_SECRET: z.string().min(32).optional(),
  RAG_PROGRAMME_GATE_OWNER_SECRET: z.string().min(32).optional(),
  SUPABASE_DB_URL: z.string().url().optional(),
  HEALTH_DEEP_PROBE_SECRET: z.string().min(16).optional(),
  // Inbound webhook receivers. Each shared secret gates a machine-to-machine
  // endpoint under /api/webhooks/* and fails closed when unset (the route 503s
  // rather than trusting an unauthenticated caller). See docs/webhooks.md.
  // Railway deploy webhook -> chat forwarder. Railway only lets you configure a
  // target URL (no custom headers), so this secret travels as `?token=` in the
  // configured URL and is compared constant-time. Min 16 chars.
  RAILWAY_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Supabase Database Webhook -> ingestion enqueue. Supabase webhooks DO allow
  // custom headers, so this secret is sent as `Authorization: Bearer` (or the
  // `x-webhook-secret` header) and compared constant-time. Min 16 chars.
  SUPABASE_INGESTION_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Optional outbound chat destinations shared by every /api/webhooks/* forwarder
  // and the CI-failure GitHub workflow. Set either, both, or neither; a receiver
  // with no destination configured accepts the event and reports it undelivered.
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  WORKER_FAILURE_WEBHOOK_URL: z.string().url().optional(),
  NEXT_PUBLIC_LOCAL_NO_AUTH: z.enum(["true", "false"]).optional().default("false"),
  LOCAL_NO_AUTH: z.enum(["true", "false"]).optional().default("false"),
  LOCAL_NO_AUTH_OWNER_EMAIL: z.string().optional(),
  LOCAL_NO_AUTH_OWNER_ID: z.string().uuid().optional(),
  NEXT_PUBLIC_MOCKUPS_ENABLED: z.enum(["true", "false"]).optional(),
  // Keep `z.` at the call site so `check-env-parity` parseEnvSchemaNames sees these names.
  NEXT_PUBLIC_SENTRY_DSN: z.preprocess(coerceBlankUrlEnv, z.string().url().optional()),
  NEXT_PUBLIC_SENTRY_RELEASE: z.string().optional(),
  // Optional release tag for Sentry production readability and source-map correlation
  // (for example: a short git SHA or deployment ID).
  SENTRY_RELEASE: z.string().optional(),
  // Optional Sentry build-time sourcemap credentials (CI/build environment only).
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  SENTRY_DSN: z.preprocess(coerceBlankUrlEnv, z.string().url().optional()),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  // Must match the vector(N) dimension in supabase/schema.sql. Changing the embedding
  // model without updating this (and the schema) silently corrupts ingestion (IDX-C2).
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  OPENAI_ANSWER_MODEL: z.string().default("gpt-5.6-terra"),
  OPENAI_FAST_ANSWER_MODEL: z.string().default("gpt-5.6-terra"),
  OPENAI_STRONG_ANSWER_MODEL: z.string().default("gpt-5.6-sol"),
  // Workload-specific overrides keep rollout experiments isolated. When omitted,
  // the resolved values below preserve the existing answer-tier behaviour.
  OPENAI_QUERY_CLASSIFIER_MODEL: z.string().optional(),
  OPENAI_SUMMARY_MODEL: z.string().optional(),
  OPENAI_INDEXING_MODEL: z.string().optional(),
  OPENAI_RERANK_MODEL: z.string().default("gpt-5.6-luna"),
  // Reasoning models (gpt-5*) draw reasoning tokens from this SAME budget as the
  // visible answer, so a low cap makes medium/high-effort reasoning consume the whole
  // budget *thinking* and return `incomplete: max_output_tokens` BEFORE it writes the
  // JSON answer — the answer is then discarded and the request degrades to
  // "unsupported" after 60-90s of wasted generation (GEN-C1). The old 4000 default did
  // exactly this on the strong route in production (confirmed via rag_queries telemetry).
  // 16000 gives ample headroom for reasoning + a full clinical answer; it is a CEILING
  // (billed per token actually used), not a spend commitment, so raising it costs
  // nothing when answers finish early. responseBody() additionally floors the effective
  // budget by reasoning effort so no call site can under-provision (reasoningHeadroomFloor
  // in openai.ts), and the answer path self-heals a truncation by retrying with a larger
  // cap before falling back.
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(16000),
  // Answer-generation pricing for the /api/health `spend` block (USD per 1,000,000
  // tokens). Operator-tunable PLACEHOLDERS — set these to the live OpenAI price for
  // the answer model. They only derive a cost SIGNAL from already-recorded token
  // counts (src/lib/observability/spend-metrics.ts); they have no billing effect.
  // Cached input is a subset of input billed at the cached rate; reasoning tokens
  // are billed within output, so output covers them.
  OPENAI_PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().default(1.25),
  OPENAI_PRICE_CACHED_INPUT_PER_MTOK: z.coerce.number().nonnegative().default(0.125),
  OPENAI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().default(10),
  // Projected-daily-spend alert threshold (USD) for the `spend` block. 0 disables
  // the alert flag (the spend figures are still reported).
  SPEND_ALERT_DAILY_USD: z.coerce.number().nonnegative().default(0),
  OPENAI_QUERY_CACHE_SIZE: z.coerce.number().int().nonnegative().default(200),
  // Max inputs per embeddings request. The OpenAI embeddings endpoint caps a single
  // request at 2048 inputs / ~300k tokens; a full-corpus re-embed of ~400k texts in one
  // call would exceed that and fail (IDX-C3). embedTexts splits unique inputs into
  // batches of this size. 256 keeps total tokens well under the ceiling even for the
  // largest (narrative-profile) chunks while staying far below the 2048 input cap.
  OPENAI_EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().max(2048).default(256),
  OPENAI_EMBEDDING_CONCURRENCY_LIMIT: z.coerce.number().int().positive().default(5),
  OPENAI_VISION_MODEL: z.string().default("gpt-5.6-terra"),
  OPENAI_VISION_IMAGE_DETAIL: z.enum(["auto", "low", "high"]).default("auto"),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  // Answer generation has a source-backed fallback path, but a too-tight budget
  // makes a strong reasoning model time out and silently degrade to stitched
  // extractive prose (the "unnatural answer" failure mode). The product decision is
  // to favour natural, model-written answers within ~20-30s, so this sits well above
  // the old 12s default while staying under the OPENAI_REQUEST_TIMEOUT_MS ceiling.
  // 30s (up from 25s) gives verbose strong-route answers margin so they finish rather
  // than fail-closed; strong reasoning effort is also query-class-capped to keep the
  // tail latency in budget (see strongReasoningEffortForQueryClass).
  OPENAI_ANSWER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  OPENAI_GENERATION_MAX_RETRIES: z.coerce.number().int().nonnegative().default(0),
  // Legacy Responses prompt-cache retention for pre-5.6 models. GPT-5.6 uses
  // OPENAI_PROMPT_CACHE_TTL and never receives this deprecated field.
  OPENAI_PROMPT_CACHE_RETENTION: z.enum(["off", "in_memory", "24h"]).default("24h"),
  OPENAI_PROMPT_CACHE_TTL: z.enum(["off", "30m"]).optional(),
  // Optional deployment-secret HMAC key for privacy-preserving Responses API
  // safety identifiers. Raw owner/user identifiers are never sent to OpenAI.
  OPENAI_SAFETY_IDENTIFIER_SECRET: z.string().min(32).optional(),
  OPENAI_STORE_RESPONSES: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OPENAI_FAST_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh"]).default("low"),
  // "high" reasoning on gpt-5.5 is both slow (overruns OPENAI_ANSWER_TIMEOUT_MS ->
  // provider_timeout) and token-hungry (exhausts OPENAI_MAX_OUTPUT_TOKENS -> truncation) —
  // the two dominant answer-generation failure modes seen in production. "medium" is ample
  // for answers grounded in retrieved sources and roughly halves generation time. Note
  // strongReasoningEffortForQueryClass() previously kept the FULL configured effort for the
  // safety-critical medication_dose_risk/table_threshold classes, so with the old "high"
  // default those exact classes ran high-effort and starved first; medium fixes them too.
  // That function never raises effort above this configured value.
  OPENAI_STRONG_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh"]).default("medium"),
  OPENAI_SUMMARY_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh"]).default("medium"),
  OPENAI_VISION_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh"]).default("low"),
  OPENAI_TEXT_VERBOSITY: z.enum(["low", "medium", "high"]).default("low"),
  // Answer/search provider mode. Controls whether OpenAI (embeddings + synthesis) is used.
  // - "auto" (default): use OpenAI when a usable key is present and the call succeeds;
  //   automatically degrade to a source-only (embedding-free, deterministic) answer when
  //   the key is missing/invalid or the provider fails. The fallback is ON BY DEFAULT.
  // - "openai": legacy behaviour — always attempt OpenAI; do not pre-empt with source-only.
  // - "offline": never call OpenAI at all (no embeddings, no generation); lexical retrieval
  //   + deterministic source-only answers only. Fails closed when evidence is weak.
  RAG_PROVIDER_MODE: z.enum(["auto", "openai", "offline"]).default("auto"),
  // Optional JSON override for app-layer ranking weights (see src/lib/ranking-config.ts).
  // Lets tuning/eval experiments adjust the second-stage rerank weights, document-diversity
  // demotion, and freshness decay WITHOUT a code change. Omitted/malformed => current defaults.
  RAG_RANKING_CONFIG: z.string().optional(),
  // Optional ambiguity-only semantic reranker. Default OFF: deterministic ranking remains
  // authoritative until a provider-backed canary is explicitly approved.
  RAG_SEMANTIC_RERANK_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // B1 telemetry extension (docs/rag-improvement/README.md §B1). Default OFF: when true,
  // the allow-listed extended answer-telemetry fields (numbers only, projected through
  // src/lib/rag/rag-answer-telemetry-metadata.ts) are added to rag_queries.metadata.
  // Rollback for the whole B1 surface is RAG_TELEMETRY_EXTENDED=false.
  RAG_TELEMETRY_EXTENDED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // P8b extension: when strict-AND text retrieval returns weak-but-nonzero matches (sparse
  // result set or negligible top text_rank), append OR-relaxed recall behind the strict
  // matches. Default OFF: with it on, the golden retrieval eval measured OR-noise displacing
  // the expected document out of top-5 (opioid-withdrawal-doses docRecall@5 1.0 -> 0.0) —
  // "append-only" at the RPC merge is not append-only after re-ranking. Opt-in experiment
  // flag only; re-enable solely behind a fresh 34/34 golden run.
  RAG_TEXT_WEAK_OR_RELAXATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // #100 Phase 1: emit a governed, client-trimmed evidence preview as a verified unit on
  // the answer stream once retrieval + ranking complete. Default OFF: server emission is
  // enabled deliberately after the offline contract proof; rendering is a separate client
  // flag per docs/verified-answer-incremental-delivery-design.md.
  RAG_INCREMENTAL_EVIDENCE_PREVIEW: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  RAG_REGISTRY_CORPUS_EMBEDDING: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  RAG_ANSWER_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(300000),
  RAG_ANSWER_CACHE_SIZE: z.coerce.number().int().nonnegative().default(100),
  RAG_SEARCH_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(60000),
  RAG_SEARCH_CACHE_SIZE: z.coerce.number().int().nonnegative().default(200),
  RAG_AWAIT_QUERY_LOGS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Clinical search queries can contain patient-identifying text (names, MRNs,
  // "patient with X on Y dose"). Default OFF: persist only hash-derived
  // placeholders. Set true only where retaining raw query
  // text is permitted and a retention policy exists (RET-H4).
  RAG_PERSIST_RAW_QUERY_TEXT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // PIA-3: rag_queries.answer holds the full generated answer text, which can
  // restate patient specifics echoed from the query (the query is hashed, the
  // answer is not). Default OFF: do not persist generated answer text at rest.
  // The offline eval/quality pipeline reads the in-memory answer (logQuery:false)
  // and never reads this column back, so persistence-off is safe. Set true only
  // where retaining answer text is permitted and a retention policy exists
  // (owner-scoped + 30-day purge). Blocked in production readiness.
  RAG_PERSIST_ANSWER_TEXT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Audit M15: server-side key for the redacted query hash. When set, stored
  // query hashes are HMAC-SHA256 (not offline-reversible, not correlatable
  // outside this deployment). When unset, the legacy unsalted SHA-256 is kept
  // for continuity with previously stored rows.
  RAG_QUERY_HASH_SECRET: z.string().min(16).optional(),
  SUPABASE_DOCUMENT_BUCKET: z.string().default("clinical-documents"),
  SUPABASE_IMAGE_BUCKET: z.string().default("clinical-images"),
  // Capped at the ceiling the browser pre-checks against, so a configured limit
  // can only ever be lower than what the client rejects up front.
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(MAX_UPLOAD_MB_CEILING).default(MAX_UPLOAD_MB_CEILING),
  MAX_CONCURRENT_UPLOADS: z.coerce.number().int().positive().default(1),
  MAX_IN_FLIGHT_UPLOAD_MB: z.coerce.number().int().positive().default(151),
  MAX_IMPORT_JOBS_PER_RUN: z.coerce.number().int().positive().default(5),
  MAX_IMPORT_BYTES_PER_RUN: z.coerce.number().int().positive().default(157286400),
  CHUNK_SIZE: z.coerce.number().int().positive().default(2000),
  CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(200),
  // Chunking strategy (CI-1). "page" (default) = the current page-bounded chunker, byte-for-
  // byte unchanged. "document" = structure-aware chunking that lets a chunk span a page break
  // within a section, so dose tables / monitoring protocols split across a page boundary stay
  // together. Enabled only for the eval-gated shadow re-index, never silently for live users.
  CHUNK_STRATEGY: z.enum(["page", "document"]).default("page"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(30000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(3),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  WORKER_STALE_AFTER_MINUTES: z.coerce.number().int().positive().default(45),
  WORKER_HEALTH_BACKOFF_MS: z.coerce.number().int().positive().default(120000),
  WORKER_MAX_CLAIM_FAILURES: z.coerce.number().int().positive().default(3),
  WORKER_PROGRESS_UPDATE_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  WORKER_MAX_CAPTIONED_IMAGES_PER_DOCUMENT: z.coerce.number().int().nonnegative().default(15),
  WORKER_MAX_CAPTIONED_IMAGES_PER_PAGE: z.coerce.number().int().nonnegative().default(2),
  WORKER_VISION_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_INLINE_ENRICHMENT: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Eval-gated experiment: tag chunk metadata with medspaCy ConText assertion status
  // (negated/uncertain/family/historical) at ingestion. Default off — requires the
  // optional medspacy Python dependency and a reviewed `npm run eval:assertions` run
  // before enabling. Nothing consumes the annotations yet (answer-verification is
  // deliberately NOT wired to them). See worker/assertion-tagging.ts.
  WORKER_MEDSPACY_ASSERTION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Packet B4 (docs/rag-improvement/README.md §B4; Gate B PASS 2026-08-18). "legacy"
  // (default) = the current extractor only, byte-for-byte unchanged. "shadow" = after the
  // legacy index generation is COMMITTED, docling additionally runs on a small
  // index-quality-selected cohort of PDFs and only an aggregate numeric record lands in
  // documents.metadata.shadow_extraction — no chunk, embedding, index, or table-fact writes.
  // Kill switch and one-step rollback: set back to "legacy" (no migration, no reindex).
  WORKER_DOCUMENT_EXTRACTOR_MODE: z.enum(["legacy", "shadow"]).default("legacy"),
  // Deterministic percentage of eligible documents that shadow-run (zod-bounded to the
  // authorised 1–5 % window; the owner-approved default is 2 %). See worker/shadow-extraction.ts.
  WORKER_SHADOW_EXTRACTION_COHORT_PERCENT: z.coerce.number().int().min(1).max(5).default(2),
  // Interpreter of the docling venv (Dockerfile.worker sets /opt/docling-venv/bin/python).
  // Unset ⇒ shadow mode records `runtime_unavailable` without spawning anything.
  WORKER_DOCLING_PYTHON_BIN: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  PYTHON_BIN: z.string().default(resolvePythonBin()),
  NEXT_PUBLIC_DEMO_MODE: z.enum(["true", "false"]).optional().default("false"),
  DOCUMENT_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(600),
});

const parsedEnv = envSchema.parse(process.env);
const nonProAnswerModelFallback = "gpt-5.6-terra";

function isProAnswerModel(model: string) {
  return /(?:^|[-_])pro(?:$|[-_])/i.test(model);
}

function runtimeAnswerModel(model: string) {
  return isProAnswerModel(model) ? nonProAnswerModelFallback : model;
}

export const requestedOpenAIAnswerModels = {
  answer: parsedEnv.OPENAI_ANSWER_MODEL,
  fastAnswer: parsedEnv.OPENAI_FAST_ANSWER_MODEL,
  strongAnswer: parsedEnv.OPENAI_STRONG_ANSWER_MODEL,
} as const;

export const env = {
  ...parsedEnv,
  OPENAI_ANSWER_MODEL: runtimeAnswerModel(parsedEnv.OPENAI_ANSWER_MODEL),
  OPENAI_FAST_ANSWER_MODEL: runtimeAnswerModel(parsedEnv.OPENAI_FAST_ANSWER_MODEL),
  OPENAI_STRONG_ANSWER_MODEL: runtimeAnswerModel(parsedEnv.OPENAI_STRONG_ANSWER_MODEL),
  OPENAI_QUERY_CLASSIFIER_MODEL: runtimeAnswerModel(
    parsedEnv.OPENAI_QUERY_CLASSIFIER_MODEL ?? parsedEnv.OPENAI_FAST_ANSWER_MODEL,
  ),
  OPENAI_SUMMARY_MODEL: runtimeAnswerModel(parsedEnv.OPENAI_SUMMARY_MODEL ?? parsedEnv.OPENAI_ANSWER_MODEL),
  OPENAI_INDEXING_MODEL: runtimeAnswerModel(parsedEnv.OPENAI_INDEXING_MODEL ?? parsedEnv.OPENAI_STRONG_ANSWER_MODEL),
  OPENAI_RERANK_MODEL: runtimeAnswerModel(parsedEnv.OPENAI_RERANK_MODEL),
} satisfies typeof parsedEnv;

export function requireServerEnv(): {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
} {
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL],
    ["SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(
      `Missing server environment variables: ${missing.map(([key]) => key).join(", ")}. See .env.example.`,
    );
  }

  assertExpectedSupabaseProjectConfig(env);
  return env as { NEXT_PUBLIC_SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string };
}

export function requireOpenAIEnv() {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. See .env.example.");
  }
}

function isPlaceholderValue(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("replace-with") ||
    normalized.includes("your-") ||
    normalized.includes("placeholder") ||
    normalized.includes("example.org")
  );
}

export function requireSentryEnv() {
  const publicDsn = env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  const serverDsn = env.SENTRY_DSN?.trim();

  if (publicDsn && serverDsn && publicDsn !== serverDsn) {
    throw new Error(
      "Mismatch between NEXT_PUBLIC_SENTRY_DSN and SENTRY_DSN. Set both to the same DSN so client/server events stay on the same project.",
    );
  }

  if (isPlaceholderValue(publicDsn) || isPlaceholderValue(serverDsn)) {
    throw new Error("Sentry DSN in .env contains a placeholder value. Set a real DSN URL.");
  }

  // SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN are build-time sourcemap upload
  // credentials. next.config.ts already gates upload on the complete set; do not
  // re-validate them at runtime or a partial build env leaked into the process
  // will crash production startup.
}

// Clinical query text is redacted to a keyed HMAC pseudonym before it is logged
// (see query-privacy.ts). Without RAG_QUERY_HASH_SECRET the hash silently degrades
// to an unsalted, dictionary-reversible SHA-256, which defeats the redaction: a
// reader of the log tables can hash candidate patient/drug strings offline and match
// rows. Production must fail closed rather than log real clinical queries under the
// weak digest. See docs/privacy-impact-assessment.md (PIA-2).
export function requireQueryHashSecret() {
  if (!env.RAG_QUERY_HASH_SECRET) {
    throw new Error(
      "Missing RAG_QUERY_HASH_SECRET. It is required in production so logged clinical-query hashes are keyed HMAC-SHA256 pseudonyms, not offline-reversible SHA-256. Set a random secret (min 16 chars). See docs/privacy-impact-assessment.md (PIA-2).",
    );
  }
}

export function isDemoMode() {
  // Explicit opt-in is honored in every environment (e.g. a deliberate demo deploy).
  if (env.NEXT_PUBLIC_DEMO_MODE === "true") {
    return true;
  }
  // Production must never silently fall back to demo mode: missing or mismatched
  // Supabase config has to fail loudly (see requireServerEnv / instrumentation.ts),
  // not serve unauthenticated demo content from the 22 routes that gate on this
  // (DEMO fail-open guard). Mirrors the prod guard in isLocalNoAuthMode below.
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  const projectCheck = checkSupabaseProjectConfig(env);
  return !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || projectCheck.status === "mismatch";
}

export function isLocalNoAuthMode() {
  const publicNoAuth = process.env.NEXT_PUBLIC_LOCAL_NO_AUTH === "true";
  const serverNoAuth = typeof window === "undefined" && env.LOCAL_NO_AUTH === "true";

  return process.env.NODE_ENV !== "production" && (publicNoAuth || serverNoAuth);
}

export function mockupsEnabled() {
  // Design-exploration mockup routes (/mockups/*) are a development surface.
  // They stay reachable in dev/test builds, but a production deploy 404s them
  // unless explicitly opted in (mirrors the prod guard in isLocalNoAuthMode).
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  return env.NEXT_PUBLIC_MOCKUPS_ENABLED === "true";
}
