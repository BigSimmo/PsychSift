import { NextResponse } from "next/server";
import { apiErrorPayloadSchema } from "@/lib/api-error-payload";
import { isLocalNoAuthMode } from "@/lib/env";
import { PublicApiError } from "@/lib/http";
import type { RateLimitSubject } from "@/lib/public-api-access";
export type { RateLimitSubject };
import { SENTRY_LOG_MESSAGES, sentryLog } from "@/lib/observability/sentry-logging";
import type { createAdminClient } from "@/lib/supabase/admin";

/** Prefer durable RPC rate limits; fall back to per-instance memory when the DB function is unavailable. */
export function allowRateLimitInMemoryFallbackOnUnavailable() {
  return isLocalNoAuthMode() || process.env.NODE_ENV === "production";
}

// Buckets that must FAIL CLOSED (503) rather than fall back to a per-instance in-memory limiter
// when the durable limiter is unavailable. A per-process Map gives N× the intended limit across N
// horizontally-scaled instances during a limiter outage — unacceptable for expensive/abusable
// paths: provider-backed answer/Clinical Ask/transcription and document upload ingestion.
function failsClosedOnLimiterUnavailable(bucket: ApiRateLimitBucket) {
  return (
    bucket === "answer" ||
    bucket === "clinical_ask" ||
    bucket === "speech_transcription" ||
    bucket === "document_upload"
  );
}

/** Production multi-instance deploys fail closed for expensive buckets. Single-instance
 *  local/dev (including secret-backed cloud agents) keeps the in-memory fallback so Answer
 *  remains usable when the durable rate-limit RPC is misconfigured or unavailable. */
function mustFailClosedOnLimiterUnavailable(bucket: ApiRateLimitBucket) {
  if (!failsClosedOnLimiterUnavailable(bucket)) return false;
  if (isLocalNoAuthMode() || process.env.NODE_ENV !== "production") return false;
  return true;
}

function allowAnonymousRateLimitFallback(bucket: ApiRateLimitBucket, allowInMemoryFallbackOnUnavailable?: boolean) {
  // Fail-closed buckets must not fall back to a per-instance limiter in a distributed production
  // runtime. If the durable limiter is unavailable, fail closed before any expensive work starts.
  if (mustFailClosedOnLimiterUnavailable(bucket)) return false;
  if (allowInMemoryFallbackOnUnavailable) return true;

  // Anonymous public read/search paths must stay reachable if the durable limiter
  // migration is temporarily unavailable; the per-instance limiter still applies.
  return bucket === "answer" || bucket === "search" || bucket === "document_read" || bucket === "registry";
}

export type ApiRateLimitBucket =
  | "answer"
  | "clinical_ask"
  | "speech_transcription"
  | "search"
  | "document_read"
  | "document_upload"
  | "document_summarize"
  | "document_reindex"
  | "bulk_reindex"
  | "source_review"
  | "answer_feedback"
  | "registry"
  | "document_admin"
  | "ingestion_admin"
  | "on_call"
  | "cme"
  | "teaching"
  | "teaching_code"
  | "roster"
  | "work_sync"
  | "work_bookings";

export type ApiRateLimitResult = {
  limited: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
  /**
   * Which ceiling produced this decision. `anonymous_generation_ceiling` marks the
   * aggregate all-anonymous provider-spend ceiling so the 429 can carry its own code
   * rather than being read as an ordinary per-caller limit.
   */
  scope?: ApiRateLimitScope;
};

export type ApiRateLimitScope = "subject" | "anonymous_generation_ceiling";

const apiRateLimitDefaults = {
  answer: { limit: 30, windowSeconds: 60 },
  clinical_ask: { limit: 20, windowSeconds: 60 },
  speech_transcription: { limit: 12, windowSeconds: 60 },
  search: { limit: 240, windowSeconds: 60 },
  document_read: { limit: 180, windowSeconds: 60 },
  document_upload: { limit: 12, windowSeconds: 60 },
  document_summarize: { limit: 12, windowSeconds: 60 },
  document_reindex: { limit: 6, windowSeconds: 60 },
  bulk_reindex: { limit: 2, windowSeconds: 60 },
  source_review: { limit: 30, windowSeconds: 60 },
  answer_feedback: { limit: 30, windowSeconds: 60 },
  registry: { limit: 120, windowSeconds: 60 },
  // Authenticated owner document-admin writes (bulk metadata, label edits, table-fact review).
  // Generous for interactive single-owner admin use, bounded against an abusive/compromised client.
  document_admin: { limit: 60, windowSeconds: 60 },
  // Authenticated owner ingestion/eval admin tooling (ingestion-quality dashboard, eval-case capture).
  // Generous for interactive/polling admin use, bounded against an abusive/compromised client.
  ingestion_admin: { limit: 60, windowSeconds: 60 },
  // On Call entry reads/writes: an owner's private hospital contact/orientation notes.
  // Generous for interactive single-owner admin use, bounded against an abusive/compromised client.
  on_call: { limit: 60, windowSeconds: 60 },
  // CME entry/year reads and writes: an owner's own CPD log and confirmed targets. Same
  // shape as on_call — generous for interactive single-owner use, bounded against abuse.
  cme: { limit: 60, windowSeconds: 60 },
  // Teaching reads and writes: a doctor's week, logbook and check-ins, and an organiser's
  // programme. Same shape as on_call and cme.
  teaching: { limit: 60, windowSeconds: 60 },
  // Typed six-digit check-in codes can be guessed, so a signed-in doctor gets few attempts.
  // Scanned codes carry a 128-bit MAC and cannot be guessed; see the anonymous entry below.
  teaching_code: { limit: 12, windowSeconds: 60 },
  // Roster own-shift reads/writes: an owner's own imported/hand-added shifts, calendar
  // links and settings. Same shape as on_call — generous for interactive single-owner
  // use, bounded against abuse.
  roster: { limit: 60, windowSeconds: 60 },
  // Work choices that follow the doctor between devices (saved work pages, My Day
  // choices). Each change is one small write; same shape as roster.
  work_sync: { limit: 60, windowSeconds: 60 },
  // Admin Bookings: booking or cancelling a place, and an organiser posting or changing a
  // course. Each is one small write; same shape as work_sync.
  work_bookings: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<ApiRateLimitBucket, { limit: number; windowSeconds: number }>;

const anonymousApiRateLimitDefaults: Partial<Record<ApiRateLimitBucket, { limit: number; windowSeconds: number }>> = {
  answer: { limit: 6, windowSeconds: 60 },
  clinical_ask: { limit: 4, windowSeconds: 60 },
  speech_transcription: { limit: 3, windowSeconds: 60 },
  search: { limit: 60, windowSeconds: 60 },
  document_read: { limit: 45, windowSeconds: 60 },
  document_upload: { limit: 3, windowSeconds: 60 },
  answer_feedback: { limit: 12, windowSeconds: 60 },
  // Anonymous curated-catalog reads (medications/registry/differentials) return the full
  // seed corpus (~MBs). Halve the authenticated allowance so an unauthenticated caller
  // cannot use the public catalog endpoints as a high-volume egress lever, while still
  // leaving ample headroom for legitimate public browsing.
  registry: { limit: 60, windowSeconds: 60 },
  // Signed-out QR scans and display-screen polling. A lecture theatre on hospital Wi-Fi shares
  // one network address, and the scanned code cannot be guessed, so this is load protection
  // only: generous enough for a full room scanning in the same minute.
  teaching_code: { limit: 300, windowSeconds: 60 },
};

/**
 * Aggregate ceiling on ALL anonymous provider-backed generation, counted in one shared
 * bucket across every anonymous caller and every generation route.
 *
 * The two tables above bound a single caller. They cannot bound total spend: an anonymous
 * caller is identified only by a hashed forwarding IP, every caller without a trusted
 * forwarding header shares one `unknown-ip` bucket, and each generation bucket carries its
 * own separate all-anonymous ceiling (answer 30/min + clinical_ask 20/min +
 * speech_transcription 12/min = 62 paid calls a minute before anything says no). Rotating
 * network identities therefore multiply paid OpenAI calls without limit over an hour.
 *
 * Numbers, and why:
 * - **300 requests per 3600 s**, shared by `answer`, `clinical_ask`, `speech_transcription`
 *   and anonymous document summaries.
 * - The per-minute per-bucket ceilings already bound bursts, so this window is deliberately
 *   long: it is a sustained-spend cap, not a burst cap. 300/hour is ~5 paid calls a minute
 *   sustained — far above ordinary anonymous browsing of a single-clinician reference site,
 *   and roughly a twelfth of the 62/min the per-bucket ceilings alone would permit.
 * - Denials are reported with {@link ANONYMOUS_GENERATION_CEILING_CODE} rather than the
 *   generic `rate_limited`, so an operator reading logs can tell "one caller is hammering
 *   us" from "the site as a whole has hit its anonymous spend ceiling".
 * - Authenticated callers never consume or observe this ceiling; signing in is the
 *   documented way past it.
 *
 * Raising these numbers raises the owner's maximum unauthenticated provider bill, so treat a
 * change here as a spend decision, not a tuning knob.
 */
export const ANONYMOUS_GENERATION_CEILING = { limit: 300, windowSeconds: 3600 } as const;

/** Single durable-limiter row shared by every anonymous generation call. */
export const ANONYMOUS_GENERATION_CEILING_SUBJECT_KEY = "anon:generation:aggregate";

/** Bucket column value for the aggregate row; deliberately not an {@link ApiRateLimitBucket}. */
export const ANONYMOUS_GENERATION_CEILING_BUCKET = "anonymous_generation";

/** Distinct 429 code for aggregate-ceiling denials. */
export const ANONYMOUS_GENERATION_CEILING_CODE = "anonymous_generation_ceiling";

const ANONYMOUS_GENERATION_CEILING_MESSAGE =
  "The shared limit for anonymous generated answers has been reached. Sign in to continue, or retry later.";

/** Provider-backed generation buckets that count against the aggregate anonymous ceiling. */
function isAnonymousGenerationBucket(bucket: ApiRateLimitBucket) {
  return bucket === "answer" || bucket === "clinical_ask" || bucket === "speech_transcription";
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

type RateLimitRpcRow = {
  bucket?: string | null;
  limited?: boolean;
  limit_value?: number;
  remaining?: number;
  retry_after_seconds?: number;
  reset_at?: string;
};

type InMemoryRateLimitWindow = {
  windowStartMs: number;
  requestCount: number;
  resetAtMs: number;
};

/**
 * Short-lived negative cache for subjects already limited by durable storage.
 * Never caches allow decisions — that would under-count across instances.
 * Only skips RPC RTT while a recent durable consume already returned limited=true.
 */
type DurableRateLimitDenyCacheEntry = {
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAtMs: number;
};

type GlobalWithRateLimitFallback = typeof globalThis & {
  __clinicalKbInMemoryApiRateLimits?: Map<string, InMemoryRateLimitWindow>;
  __clinicalKbDurableApiRateLimitDenyCache?: Map<string, DurableRateLimitDenyCacheEntry>;
};

const inMemoryApiRateLimits = ((globalThis as GlobalWithRateLimitFallback).__clinicalKbInMemoryApiRateLimits ??=
  new Map<string, InMemoryRateLimitWindow>());

const durableApiRateLimitDenyCache = ((
  globalThis as GlobalWithRateLimitFallback
).__clinicalKbDurableApiRateLimitDenyCache ??= new Map<string, DurableRateLimitDenyCacheEntry>());

const DURABLE_DENY_CACHE_MAX_ENTRIES = 2000;

function durableDenyCacheKey(identity: string, bucket: string) {
  return `${identity}:${bucket}`;
}

function durableDenyCacheEnabled() {
  // Vitest workers share process-global Maps across unrelated route suites; keep the
  // cache off unless a focused unit test explicitly opts in.
  if (process.env.VITEST === "true" && process.env.ALLOW_DURABLE_RATE_LIMIT_DENY_CACHE_IN_TESTS !== "1") {
    return false;
  }
  return true;
}

function tryReadDurableRateLimitDenyCache(identity: string, bucket: string): ApiRateLimitResult | null {
  if (!durableDenyCacheEnabled()) return null;
  const key = durableDenyCacheKey(identity, bucket);
  const entry = durableApiRateLimitDenyCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (now >= entry.resetAtMs) {
    durableApiRateLimitDenyCache.delete(key);
    return null;
  }
  return {
    limited: true,
    limit: entry.limit,
    remaining: entry.remaining,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAtMs - now) / 1000)),
    resetAt: new Date(entry.resetAtMs).toISOString(),
  };
}

function rememberDurableRateLimitDenyCache(identity: string, bucket: string, result: ApiRateLimitResult) {
  if (!durableDenyCacheEnabled()) return;
  const key = durableDenyCacheKey(identity, bucket);
  if (!result.limited) {
    durableApiRateLimitDenyCache.delete(key);
    return;
  }
  const now = Date.now();
  const resetAtMs = Date.parse(result.resetAt);
  if (!Number.isFinite(resetAtMs) || resetAtMs <= now) return;
  // Entries were only ever removed when the same subject came back, so every
  // limited subject that never returned stayed for the life of the process.
  // Same ceiling as the in-memory limiter: sweep expired entries, then drop
  // the oldest. Dropping one is safe: the next request asks the durable limiter.
  if (durableApiRateLimitDenyCache.size >= DURABLE_DENY_CACHE_MAX_ENTRIES) {
    for (const [cachedKey, cached] of durableApiRateLimitDenyCache) {
      if (now >= cached.resetAtMs) durableApiRateLimitDenyCache.delete(cachedKey);
    }
    while (durableApiRateLimitDenyCache.size >= DURABLE_DENY_CACHE_MAX_ENTRIES) {
      const oldest = durableApiRateLimitDenyCache.keys().next().value;
      if (oldest === undefined) break;
      durableApiRateLimitDenyCache.delete(oldest);
    }
  }
  durableApiRateLimitDenyCache.set(key, {
    limit: result.limit,
    remaining: result.remaining,
    retryAfterSeconds: result.retryAfterSeconds,
    resetAtMs,
  });
}

/** Test helper: clear durable deny-cache entries between cases. */
export function resetDurableRateLimitDenyCacheForTests() {
  durableApiRateLimitDenyCache.clear();
}

/** Test helper: how many subjects the durable deny cache currently holds. */
export function durableRateLimitDenyCacheSizeForTests() {
  return durableApiRateLimitDenyCache.size;
}

/** @deprecated Use resetDurableRateLimitDenyCacheForTests — name kept for older test imports. */
export function resetDurableRateLimitLeasesForTests() {
  resetDurableRateLimitDenyCacheForTests();
}
export class ApiRateLimitUnavailableError extends PublicApiError {
  constructor() {
    super("Rate limit check is temporarily unavailable.", 503, { code: "rate_limit_unavailable" });
    this.name = "ApiRateLimitUnavailableError";
  }
}

function parseRateLimitRow(data: unknown): RateLimitRpcRow | null {
  if (Array.isArray(data)) return (data[0] as RateLimitRpcRow | undefined) ?? null;
  return data && typeof data === "object" ? (data as RateLimitRpcRow) : null;
}

export async function consumeApiRateLimit(args: {
  supabase: SupabaseAdmin;
  ownerId: string;
  bucket: ApiRateLimitBucket;
  limit?: number;
  windowSeconds?: number;
  allowInMemoryFallbackOnUnavailable?: boolean;
}): Promise<ApiRateLimitResult> {
  const defaults = apiRateLimitDefaults[args.bucket];
  const limit = args.limit ?? defaults.limit;
  const windowSeconds = args.windowSeconds ?? defaults.windowSeconds;
  const denied = tryReadDurableRateLimitDenyCache(args.ownerId, args.bucket);
  if (denied) return denied;

  const { data, error } = await args.supabase.rpc("consume_api_rate_limit", {
    p_owner_id: args.ownerId,
    p_bucket: args.bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    if (args.allowInMemoryFallbackOnUnavailable) {
      // Wide-event log: static message + operational attributes only (no owner id / PII).
      sentryLog.warn(SENTRY_LOG_MESSAGES.API_RATE_LIMIT_FALLBACK, {
        bucket: args.bucket,
        code: error.code,
        backend: "in_memory",
        fallback: true,
      });
      return consumeInMemoryApiRateLimit({ ownerId: args.ownerId, bucket: args.bucket, limit, windowSeconds });
    }
    throw new ApiRateLimitUnavailableError();
  }
  const row = parseRateLimitRow(data);
  if (!row || typeof row.limited !== "boolean") {
    if (args.allowInMemoryFallbackOnUnavailable) {
      sentryLog.warn(SENTRY_LOG_MESSAGES.API_RATE_LIMIT_INVALID_PAYLOAD, {
        bucket: args.bucket,
        backend: "in_memory",
        fallback: true,
      });
      return consumeInMemoryApiRateLimit({ ownerId: args.ownerId, bucket: args.bucket, limit, windowSeconds });
    }
    throw new ApiRateLimitUnavailableError();
  }

  const result: ApiRateLimitResult = {
    limited: row.limited,
    limit: Number(row.limit_value ?? limit),
    remaining: Number(row.remaining ?? 0),
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? windowSeconds)),
    resetAt: String(row.reset_at ?? new Date(Date.now() + windowSeconds * 1000).toISOString()),
  };
  rememberDurableRateLimitDenyCache(args.ownerId, args.bucket, result);
  return result;
}

/**
 * Consumes one unit of the aggregate anonymous generation ceiling (see
 * {@link ANONYMOUS_GENERATION_CEILING}). Shared by every anonymous provider-backed generation
 * path so they all draw down the same durable row.
 */
async function consumeAnonymousGenerationCeiling(args: {
  supabase: SupabaseAdmin;
  allowInMemoryFallbackOnUnavailable: boolean;
}): Promise<ApiRateLimitResult> {
  const scope = "anonymous_generation_ceiling" as const;
  const cached = tryReadDurableRateLimitDenyCache(
    ANONYMOUS_GENERATION_CEILING_SUBJECT_KEY,
    ANONYMOUS_GENERATION_CEILING_BUCKET,
  );
  if (cached) return { ...cached, scope };

  const { data, error } = await args.supabase.rpc("consume_api_subject_rate_limit", {
    p_subject_key: ANONYMOUS_GENERATION_CEILING_SUBJECT_KEY,
    p_bucket: ANONYMOUS_GENERATION_CEILING_BUCKET,
    p_limit: ANONYMOUS_GENERATION_CEILING.limit,
    p_window_seconds: ANONYMOUS_GENERATION_CEILING.windowSeconds,
  });

  const row = error ? null : parseRateLimitRow(data);
  if (!row || typeof row.limited !== "boolean") {
    // The ceiling exists to bound paid provider work, so an unreadable limiter must not open it.
    // Only the explicitly permitted single-instance fallback may substitute a per-process count.
    if (!args.allowInMemoryFallbackOnUnavailable) throw new ApiRateLimitUnavailableError();
    sentryLog.warn(SENTRY_LOG_MESSAGES.API_RATE_LIMIT_FALLBACK, {
      bucket: ANONYMOUS_GENERATION_CEILING_BUCKET,
      backend: "in_memory",
      fallback: true,
      event: "anonymous",
    });
    return {
      ...consumeInMemoryApiRateLimit({
        ownerId: ANONYMOUS_GENERATION_CEILING_SUBJECT_KEY,
        bucket: ANONYMOUS_GENERATION_CEILING_BUCKET,
        limit: ANONYMOUS_GENERATION_CEILING.limit,
        windowSeconds: ANONYMOUS_GENERATION_CEILING.windowSeconds,
      }),
      scope,
    };
  }

  const result = {
    limited: row.limited,
    limit: Number(row.limit_value ?? ANONYMOUS_GENERATION_CEILING.limit),
    remaining: Number(row.remaining ?? 0),
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? ANONYMOUS_GENERATION_CEILING.windowSeconds)),
    resetAt: String(
      row.reset_at ?? new Date(Date.now() + ANONYMOUS_GENERATION_CEILING.windowSeconds * 1000).toISOString(),
    ),
  } satisfies ApiRateLimitResult;
  rememberDurableRateLimitDenyCache(
    ANONYMOUS_GENERATION_CEILING_SUBJECT_KEY,
    ANONYMOUS_GENERATION_CEILING_BUCKET,
    result,
  );
  return { ...result, scope };
}

/**
 * The anonymous subject, global and (for generation buckets) aggregate-ceiling checks in ONE database
 * round trip, in the same order and with the same stop-at-first-denial accounting as the serial calls
 * below. Each serial call crossed from the app's region to the database's, so an anonymous answer
 * used to spend ~1.4 s here. Returns null when the function is unavailable or returns an unreadable
 * row, so the caller falls back to the serial path and its existing unavailable handling.
 */
async function consumeAnonymousRateLimitsAtomic(args: {
  supabase: SupabaseAdmin;
  subjectKey: string;
  bucket: ApiRateLimitBucket;
  limit: number;
  windowSeconds: number;
  globalKey: string;
  globalLimit: number;
  globalWindowSeconds: number;
}): Promise<ApiRateLimitResult | null> {
  const withCeiling = isAnonymousGenerationBucket(args.bucket);
  const { data, error } = await args.supabase.rpc("consume_anonymous_rate_limits_atomic", {
    p_subject_key: args.subjectKey,
    p_bucket: args.bucket,
    p_subject_limit: args.limit,
    p_subject_window_seconds: args.windowSeconds,
    p_global_key: args.globalKey,
    p_global_limit: args.globalLimit,
    p_global_window_seconds: args.globalWindowSeconds,
    p_ceiling_key: withCeiling ? ANONYMOUS_GENERATION_CEILING_SUBJECT_KEY : null,
    p_ceiling_bucket: withCeiling ? ANONYMOUS_GENERATION_CEILING_BUCKET : null,
    p_ceiling_limit: withCeiling ? ANONYMOUS_GENERATION_CEILING.limit : null,
    p_ceiling_window_seconds: withCeiling ? ANONYMOUS_GENERATION_CEILING.windowSeconds : null,
  });
  if (error) return null;
  const row = parseRateLimitRow(data) as (RateLimitRpcRow & { scope?: string | null }) | null;
  if (!row || typeof row.limited !== "boolean") return null;
  const denyingScope = row.limited ? row.scope : null;
  if (row.limited && denyingScope !== "subject" && denyingScope !== "global" && denyingScope !== "ceiling") return null;

  const fallbackWindowSeconds =
    denyingScope === "ceiling"
      ? ANONYMOUS_GENERATION_CEILING.windowSeconds
      : denyingScope === "global"
        ? args.globalWindowSeconds
        : args.windowSeconds;
  const result: ApiRateLimitResult = {
    limited: row.limited,
    limit: Number(row.limit_value ?? args.limit),
    remaining: Number(row.remaining ?? 0),
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? fallbackWindowSeconds)),
    resetAt: String(row.reset_at ?? new Date(Date.now() + fallbackWindowSeconds * 1000).toISOString()),
  };
  if (denyingScope === "ceiling") {
    rememberDurableRateLimitDenyCache(
      ANONYMOUS_GENERATION_CEILING_SUBJECT_KEY,
      ANONYMOUS_GENERATION_CEILING_BUCKET,
      result,
    );
    return { ...result, scope: "anonymous_generation_ceiling" };
  }
  rememberDurableRateLimitDenyCache(denyingScope === "global" ? args.globalKey : args.subjectKey, args.bucket, result);
  return result;
}

type SubjectRateLimitArgs = {
  supabase: SupabaseAdmin;
  subject: RateLimitSubject;
  bucket: ApiRateLimitBucket;
  limit?: number;
  windowSeconds?: number;
  allowInMemoryFallbackOnUnavailable?: boolean;
};

/**
 * The "registry" bucket guards the read-only catalogue routes (medication, differential and
 * service lists and details, and the universal typeahead, whose document lane is lexical only).
 * They serve public reference data that is usually already in memory and carry no provider cost,
 * so waiting a cross-region round trip for the durable limiter before each one is pure latency.
 *
 * For them the durable consume still runs for every request, so the shared count is exactly what
 * it was, but the response does not wait for it. Enforcement comes from two places instead:
 * a subject the durable limiter has already denied is refused from the deny cache before any work,
 * and a per-instance limiter with the same limit and window refuses a burst on this instance before
 * the durable denial arrives. Across instances a flooding caller can get at most about one round
 * trip's worth of extra requests on each instance before its denial is cached.
 *
 * Tied to the deny cache: when that is off (the default under Vitest), every registry request
 * waits for the durable result as before.
 */
function deferRegistryDurableConsume(bucket: ApiRateLimitBucket) {
  return bucket === "registry" && durableDenyCacheEnabled();
}

function consumeRegistryRateLimitDeferred(args: SubjectRateLimitArgs): ApiRateLimitResult {
  const identity = args.subject.kind === "owner" ? args.subject.ownerId : args.subject.subjectKey;
  // While a durable denial is cached the awaited path makes no RPC either, so neither does this.
  const denied = tryReadDurableRateLimitDenyCache(identity, args.bucket);
  if (denied) return denied;
  const defaults =
    args.subject.kind === "owner"
      ? apiRateLimitDefaults[args.bucket]
      : (anonymousApiRateLimitDefaults[args.bucket] ?? apiRateLimitDefaults[args.bucket]);
  // Counted durably for every request that reaches here, served or refused, as the awaited path
  // counts it; a denial it returns is cached for this subject's next request.
  void consumeSubjectApiRateLimitDurable(args).catch((error: unknown) => {
    sentryLog.warn(SENTRY_LOG_MESSAGES.API_RATE_LIMIT_FALLBACK, {
      bucket: args.bucket,
      backend: "deferred",
      fallback: false,
      code: error instanceof PublicApiError ? error.details?.code : undefined,
    });
  });
  // Its own key, so the durable path's in-memory fallback never double-counts on this instance.
  return consumeInMemoryApiRateLimit({
    ownerId: identity,
    bucket: `${args.bucket}:served`,
    limit: args.limit ?? defaults.limit,
    windowSeconds: args.windowSeconds ?? defaults.windowSeconds,
  });
}

/**
 * Applies an API rate limit to an owner or anonymous subject.
 *
 * Anonymous requests to answer and document upload buckets are constrained by
 * both subject-specific and aggregate bucket limits. Limiter unavailability may
 * use an in-memory fallback when permitted.
 *
 * @param args - Rate-limiting configuration and request subject.
 * @param args.subject - The authenticated owner or anonymous subject to limit.
 * @param args.bucket - The API resource bucket being limited.
 * @param args.limit - Optional subject-specific request limit.
 * @param args.windowSeconds - Optional subject-specific rate-limit window.
 * @param args.allowInMemoryFallbackOnUnavailable - Whether local fallback may be used when the durable limiter is unavailable.
 * @returns The computed rate-limit outcome.
 */
export async function consumeSubjectApiRateLimit(args: SubjectRateLimitArgs): Promise<ApiRateLimitResult> {
  if (deferRegistryDurableConsume(args.bucket)) return consumeRegistryRateLimitDeferred(args);
  return consumeSubjectApiRateLimitDurable(args);
}

async function consumeSubjectApiRateLimitDurable(args: SubjectRateLimitArgs): Promise<ApiRateLimitResult> {
  const allowInMemoryFallbackOnUnavailable = mustFailClosedOnLimiterUnavailable(args.bucket)
    ? false
    : args.allowInMemoryFallbackOnUnavailable;

  if (args.subject.kind === "owner") {
    return consumeApiRateLimit({
      supabase: args.supabase,
      ownerId: args.subject.ownerId,
      bucket: args.bucket,
      limit: args.limit,
      windowSeconds: args.windowSeconds,
      allowInMemoryFallbackOnUnavailable,
    });
  }

  const defaults = anonymousApiRateLimitDefaults[args.bucket] ?? apiRateLimitDefaults[args.bucket];
  const limit = args.limit ?? defaults.limit;
  const windowSeconds = args.windowSeconds ?? defaults.windowSeconds;
  const consumeAnonymousLimit = async (
    subjectKey: string,
    requestedLimit: number,
    requestedWindowSeconds: number,
    limiterBucket: string = args.bucket,
  ) => {
    const denied = tryReadDurableRateLimitDenyCache(subjectKey, limiterBucket);
    if (denied) return denied;

    const { data, error } = await args.supabase.rpc("consume_api_subject_rate_limit", {
      p_subject_key: subjectKey,
      p_bucket: limiterBucket,
      p_limit: requestedLimit,
      p_window_seconds: requestedWindowSeconds,
    });

    if (error) {
      if (allowAnonymousRateLimitFallback(args.bucket, allowInMemoryFallbackOnUnavailable)) {
        sentryLog.warn(SENTRY_LOG_MESSAGES.API_RATE_LIMIT_FALLBACK, {
          bucket: args.bucket,
          code: error.code,
          backend: "in_memory",
          fallback: true,
          event: "anonymous",
        });
        return consumeInMemoryApiRateLimit({
          ownerId: subjectKey,
          bucket: limiterBucket,
          limit: requestedLimit,
          windowSeconds: requestedWindowSeconds,
        });
      }
      throw new ApiRateLimitUnavailableError();
    }

    const row = parseRateLimitRow(data);
    if (!row || typeof row.limited !== "boolean") {
      if (allowAnonymousRateLimitFallback(args.bucket, allowInMemoryFallbackOnUnavailable)) {
        sentryLog.warn(SENTRY_LOG_MESSAGES.API_RATE_LIMIT_INVALID_PAYLOAD, {
          bucket: args.bucket,
          backend: "in_memory",
          fallback: true,
          event: "anonymous",
        });
        return consumeInMemoryApiRateLimit({
          ownerId: subjectKey,
          bucket: limiterBucket,
          limit: requestedLimit,
          windowSeconds: requestedWindowSeconds,
        });
      }
      throw new ApiRateLimitUnavailableError();
    }

    const result = {
      limited: row.limited,
      limit: Number(row.limit_value ?? requestedLimit),
      remaining: Number(row.remaining ?? 0),
      retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? requestedWindowSeconds)),
      resetAt: String(row.reset_at ?? new Date(Date.now() + requestedWindowSeconds * 1000).toISOString()),
    } satisfies ApiRateLimitResult;
    rememberDurableRateLimitDenyCache(subjectKey, limiterBucket, result);
    return result;
  };

  if (
    args.bucket !== "answer" &&
    args.bucket !== "clinical_ask" &&
    args.bucket !== "speech_transcription" &&
    args.bucket !== "document_upload"
  ) {
    return consumeAnonymousLimit(args.subject.subjectKey, limit, windowSeconds);
  }

  // A stable global ceiling prevents rotated/spoofed network identities from
  // multiplying paid generation or upload/ingestion capacity. Reuse each
  // bucket's authenticated allowance as the aggregate anonymous ceiling.
  const globalDefaults = apiRateLimitDefaults[args.bucket];
  const globalKey = `anon:${args.bucket}:global`;

  const cachedSubjectDenial = tryReadDurableRateLimitDenyCache(args.subject.subjectKey, args.bucket);
  if (cachedSubjectDenial) return cachedSubjectDenial;

  const cachedGlobalDenial = tryReadDurableRateLimitDenyCache(globalKey, args.bucket);
  if (cachedGlobalDenial) return cachedGlobalDenial;

  const atomicResult = await consumeAnonymousRateLimitsAtomic({
    supabase: args.supabase,
    subjectKey: args.subject.subjectKey,
    bucket: args.bucket,
    limit,
    windowSeconds,
    globalKey,
    globalLimit: globalDefaults.limit,
    globalWindowSeconds: globalDefaults.windowSeconds,
  });
  if (atomicResult) return atomicResult;

  // The one-round-trip function was unavailable (for example before its migration applied), so
  // make the same checks as separate calls. Their own unavailable handling applies unchanged.
  const subjectResult = await consumeAnonymousLimit(args.subject.subjectKey, limit, windowSeconds);
  if (subjectResult.limited) return subjectResult;
  const globalResult = await consumeAnonymousLimit(globalKey, globalDefaults.limit, globalDefaults.windowSeconds);
  if (globalResult.limited) return globalResult;

  // Aggregate provider-spend ceiling across every anonymous generation route. Consumed last so
  // a caller already denied by a narrower limit does not also burn the shared allowance.
  if (isAnonymousGenerationBucket(args.bucket)) {
    const ceilingResult = await consumeAnonymousGenerationCeiling({
      supabase: args.supabase,
      allowInMemoryFallbackOnUnavailable: allowAnonymousRateLimitFallback(
        args.bucket,
        allowInMemoryFallbackOnUnavailable,
      ),
    });
    if (ceilingResult.limited) return ceilingResult;
    return {
      ...subjectResult,
      remaining: Math.min(subjectResult.remaining, globalResult.remaining, ceilingResult.remaining),
    };
  }

  return {
    ...subjectResult,
    remaining: Math.min(subjectResult.remaining, globalResult.remaining),
  };
}

export type SummaryRateLimitBucket = "answer" | "document_summarize";

export type SummaryRateLimitDecision = {
  bucket: SummaryRateLimitBucket | null;
  rateLimit: ApiRateLimitResult;
};

/**
 * Atomically applies the answer and document-summary policies used by streamed
 * summaries. The database function locks every participating bucket in a
 * stable order, avoiding the partial accounting and lock-order risk of two
 * serial RPC calls.
 */
export async function consumeSummaryRateLimits(args: {
  supabase: SupabaseAdmin;
  subject: RateLimitSubject;
}): Promise<SummaryRateLimitDecision> {
  const answerDefaults =
    args.subject.kind === "owner"
      ? apiRateLimitDefaults.answer
      : (anonymousApiRateLimitDefaults.answer ?? apiRateLimitDefaults.answer);
  const summaryDefaults = apiRateLimitDefaults.document_summarize;
  const globalAnswerDefaults = apiRateLimitDefaults.answer;
  const { data, error } = await args.supabase.rpc("consume_summary_rate_limits_atomic", {
    p_owner_id: args.subject.kind === "owner" ? args.subject.ownerId : null,
    p_subject_key: args.subject.kind === "anonymous" ? args.subject.subjectKey : null,
    p_answer_limit: answerDefaults.limit,
    p_answer_window_seconds: answerDefaults.windowSeconds,
    p_summary_limit: summaryDefaults.limit,
    p_summary_window_seconds: summaryDefaults.windowSeconds,
    p_global_answer_limit: globalAnswerDefaults.limit,
    p_global_answer_window_seconds: globalAnswerDefaults.windowSeconds,
  });

  if (error) throw new ApiRateLimitUnavailableError();

  const row = parseRateLimitRow(data);
  const bucket = row?.bucket;
  const validBucket = bucket === "answer" || bucket === "document_summarize" ? bucket : null;
  if (!row || typeof row.limited !== "boolean" || (row.limited && validBucket === null)) {
    throw new ApiRateLimitUnavailableError();
  }

  const rateLimit: ApiRateLimitResult = {
    limited: row.limited,
    limit: Number(row.limit_value ?? summaryDefaults.limit),
    remaining: Number(row.remaining ?? 0),
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? summaryDefaults.windowSeconds)),
    resetAt: String(row.reset_at ?? new Date(Date.now() + summaryDefaults.windowSeconds * 1000).toISOString()),
  };

  // Streamed summaries are provider-backed generation too, so anonymous ones draw down the same
  // aggregate ceiling. Consumed after the atomic decision so a caller already denied by the answer
  // or summary bucket does not also burn the shared allowance.
  if (!rateLimit.limited && args.subject.kind === "anonymous") {
    const ceiling = await consumeAnonymousGenerationCeiling({
      supabase: args.supabase,
      allowInMemoryFallbackOnUnavailable: false,
    });
    if (ceiling.limited) return { bucket: "answer", rateLimit: ceiling };
    rateLimit.remaining = Math.min(rateLimit.remaining, ceiling.remaining);
  }

  return { bucket: validBucket, rateLimit };
}

function consumeInMemoryApiRateLimit({
  ownerId,
  bucket,
  limit,
  windowSeconds,
}: {
  ownerId: string;
  // Plain string: the aggregate anonymous ceiling keys its own row and is not an API bucket.
  bucket: string;
  limit: number;
  windowSeconds: number;
}): ApiRateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const key = `${ownerId}:${bucket}`;

  // Lazy per-key eviction: the most common path touches only the accessed entry.
  // A full-map sweep runs only when the map exceeds a size ceiling so stale entries
  // don't accumulate indefinitely, without scanning on every request.
  const EVICTION_SIZE_CEILING = 2000;
  const stale = inMemoryApiRateLimits.get(key);
  if (stale && now >= stale.resetAtMs) {
    inMemoryApiRateLimits.delete(key);
  }
  if (inMemoryApiRateLimits.size > EVICTION_SIZE_CEILING) {
    for (const [k, v] of inMemoryApiRateLimits.entries()) {
      if (now >= v.resetAtMs) inMemoryApiRateLimits.delete(k);
    }
  }

  const current = inMemoryApiRateLimits.get(key);
  const windowStartMs = current && now - current.windowStartMs < windowMs ? current.windowStartMs : now;
  const requestCount = (current && current.windowStartMs === windowStartMs ? current.requestCount : 0) + 1;
  const resetAtMs = windowStartMs + windowMs;

  inMemoryApiRateLimits.set(key, { windowStartMs, requestCount, resetAtMs });

  return {
    limited: requestCount > limit,
    limit,
    remaining: Math.max(limit - requestCount, 0),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    resetAt: new Date(resetAtMs).toISOString(),
  };
}

export function rateLimitJsonResponse(
  message: string,
  rateLimit: ApiRateLimitResult,
  meta?: { bucket?: ApiRateLimitBucket },
) {
  // An aggregate-ceiling denial is not the caller's own quota running out: it says the site as a
  // whole has spent its anonymous generation allowance, and signing in is the way past it. Give it
  // its own code and message so clients and logs can tell the two apart.
  const hitAnonymousGenerationCeiling = rateLimit.scope === "anonymous_generation_ceiling";
  const code = hitAnonymousGenerationCeiling ? ANONYMOUS_GENERATION_CEILING_CODE : "rate_limited";
  const publicMessage = hitAnonymousGenerationCeiling ? ANONYMOUS_GENERATION_CEILING_MESSAGE : message;
  // Example wide event: denial counts by bucket without subject identifiers.
  sentryLog.warn(SENTRY_LOG_MESSAGES.API_RATE_LIMITED, {
    code,
    status: 429,
    bucket: meta?.bucket,
    retry_after_seconds: rateLimit.retryAfterSeconds,
    limit: rateLimit.limit,
    remaining: rateLimit.remaining,
  });
  return NextResponse.json(
    apiErrorPayloadSchema.parse({
      error: publicMessage,
      message: publicMessage,
      code,
      details: {
        kind: "rate_limit",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        resetAt: rateLimit.resetAt,
      },
    }),
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(rateLimit.retryAfterSeconds),
      },
    },
  );
}
