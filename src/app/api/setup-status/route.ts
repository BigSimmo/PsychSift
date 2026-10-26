import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { env, isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { allowDeepHealthProbe } from "@/lib/deep-probe-auth";
import { PublicApiError } from "@/lib/http";
import { localProjectRequestIdentityPayload, unsafeLocalProjectResponse } from "@/lib/local-project-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser } from "@/lib/supabase/auth";
import { formatSupabaseUnavailableError, isSupabaseUnavailableError, probeSupabaseHealth } from "@/lib/supabase/health";
import { checkSupabaseProjectConfig, formatSupabaseProjectCheck } from "@/lib/supabase/project";
import { assertSearchSchemaHealth } from "@/lib/validation/row-contracts";
import { describeEvidencePreviewForAnyCaller, describeEvidencePreviewForOperator } from "@/lib/answer-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SetupCheckStatus = "ready" | "needs_setup" | "unknown";
type SetupCheckId = "env" | "project" | "schema" | "search" | "openai" | "worker" | "answerPreview";

type SetupCheck = {
  id: SetupCheckId;
  label: string;
  status: SetupCheckStatus;
  detail: string;
};

type WorkerStatus = {
  check: SetupCheck;
  activeWork: boolean;
};

type SetupStatusPayload = {
  demoMode: boolean;
  checks: SetupCheck[];
  indexingActive: boolean;
  pollAfterMs: number | null;
  generatedAt: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

const requiredSupabaseEnvPresent = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
const supabaseProjectCheck = checkSupabaseProjectConfig(env, { requireMetadata: true });
const supabaseProjectCanBeQueried = requiredSupabaseEnvPresent && supabaseProjectCheck.status !== "mismatch";
const ACTIVE_INDEXING_POLL_MS = Math.max(3_000, Math.min(env.WORKER_POLL_MS, 15_000));
const SETUP_RECHECK_POLL_MS = 60_000;
const SETUP_STATUS_ACTIVE_CACHE_MS = Math.max(2_000, Math.min(ACTIVE_INDEXING_POLL_MS, 5_000));
const SETUP_STATUS_IDLE_CACHE_MS = 30_000;
const SETUP_STATUS_OUTAGE_CACHE_MS = 120_000;
const SETUP_STATUS_MAX_STALE_MS = 10 * 60_000;

/**
 * Held on `globalThis` because a production build gives `instrumentation.ts` its own copy of this
 * module (checked 2026-09-26, `next build --webpack`). The startup warm there only helps if the
 * route handler reads the same cached payload.
 */
const setupStatusStateKey = Symbol.for("psychsift.setupStatusCache");
type SetupStatusState = {
  cache: { expiresAt: number; payload: SetupStatusPayload } | null;
  inFlight: Promise<SetupStatusPayload> | null;
};
const setupStatusState = ((globalThis as { [setupStatusStateKey]?: SetupStatusState })[setupStatusStateKey] ??= {
  cache: null,
  inFlight: null,
});
let supabaseOutageBackoffUntil = 0;
let supabaseOutageDetail: string | null = null;

function check(id: SetupCheckId, label: string, status: SetupCheckStatus, detail: string): SetupCheck {
  return { id, label, status, detail };
}

function projectSetupCheckStatus(status: ReturnType<typeof checkSupabaseProjectConfig>["status"]) {
  return status === "ready" || status === "warning" ? "ready" : "needs_setup";
}

async function readSupabaseAvailability(supabase: AdminClient | null) {
  if (!requiredSupabaseEnvPresent || !supabaseProjectCanBeQueried || !supabase) return null;
  const now = Date.now();
  if (supabaseOutageBackoffUntil > now) {
    return supabaseOutageDetail ?? "Supabase is temporarily unavailable; setup checks are backing off.";
  }

  try {
    const health = await probeSupabaseHealth(supabase);
    if (!health.ok) {
      if (health.failureKind !== "unavailable") {
        supabaseOutageBackoffUntil = 0;
        supabaseOutageDetail = null;
        return null;
      }
      supabaseOutageBackoffUntil = Date.now() + SETUP_STATUS_OUTAGE_CACHE_MS;
      supabaseOutageDetail = health.message;
      return health.message;
    }
    supabaseOutageBackoffUntil = 0;
    supabaseOutageDetail = null;
    return null;
  } catch (error) {
    if (!isSupabaseUnavailableError(error)) return null;
    const message = formatSupabaseUnavailableError(error);
    supabaseOutageBackoffUntil = Date.now() + SETUP_STATUS_OUTAGE_CACHE_MS;
    supabaseOutageDetail = message;
    return message;
  }
}

async function readSchemaStatus(supabase: AdminClient | null) {
  if (!requiredSupabaseEnvPresent) {
    return check(
      "schema",
      "supabase/schema.sql applied",
      "unknown",
      "Supabase environment is missing, so schema checks were skipped.",
    );
  }

  if (!supabaseProjectCanBeQueried) {
    return check(
      "schema",
      "supabase/schema.sql applied",
      "unknown",
      "Supabase project mismatch detected, so schema checks were skipped.",
    );
  }

  try {
    if (!supabase) {
      throw new Error("Supabase admin client is unavailable.");
    }
    const [documents, jobs, batches, buckets, cleanupJobs] = await Promise.all([
      supabase.from("documents").select("id,content_hash,import_batch_id").limit(1),
      supabase.from("ingestion_jobs").select("id,attempt_count,max_attempts,locked_at").limit(1),
      supabase.from("import_batches").select("id").limit(1),
      supabase.storage.listBuckets(),
      supabase.from("storage_cleanup_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    const hasRequiredBuckets =
      !buckets.error &&
      buckets.data?.some((bucket) => bucket.id === env.SUPABASE_DOCUMENT_BUCKET) &&
      buckets.data?.some((bucket) => bucket.id === env.SUPABASE_IMAGE_BUCKET);

    if (documents.error || jobs.error || batches.error || cleanupJobs.error || !hasRequiredBuckets) {
      return check(
        "schema",
        "supabase/schema.sql applied",
        "needs_setup",
        "Required tables or private storage buckets were not confirmed.",
      );
    }

    const pendingCleanup = cleanupJobs.count ?? 0;
    const cleanupNote = pendingCleanup > 0 ? ` (${pendingCleanup} pending cleanup jobs)` : "";

    return check(
      "schema",
      "supabase/schema.sql applied",
      "ready",
      `Required tables and storage buckets responded successfully${cleanupNote}.`,
    );
  } catch {
    return check(
      "schema",
      "supabase/schema.sql applied",
      "needs_setup",
      "Schema check could not complete with the configured Supabase service role.",
    );
  }
}

async function readSearchSchemaStatus(supabase: AdminClient | null) {
  const label = "Search RPC and vector indexes";
  if (!requiredSupabaseEnvPresent) {
    return check("search", label, "unknown", "Supabase environment is missing, so search health checks were skipped.");
  }

  if (!supabaseProjectCanBeQueried) {
    return check("search", label, "unknown", "Supabase project mismatch detected, so search checks were skipped.");
  }

  try {
    if (!supabase) throw new Error("Supabase admin client is unavailable.");
    const { data, error } = await supabase.rpc("search_schema_health");
    if (error) {
      return check("search", label, "needs_setup", "Search health checks are temporarily unavailable.");
    }
    const health = data ?? {};
    assertSearchSchemaHealth(health);
    const missing = health.missing;
    if (!health.ok || missing.length > 0) {
      return check(
        "search",
        label,
        "needs_setup",
        `Missing or stale search schema items: ${missing.join(", ") || "unknown"}.`,
      );
    }
    return check(
      "search",
      label,
      "ready",
      `Vector RPC signatures and trigram indexes are ready${health.vector_extension_schema ? ` (${health.vector_extension_schema})` : ""}.`,
    );
  } catch {
    return check("search", label, "needs_setup", "Search schema health could not be checked.");
  }
}

async function readWorkerStatus(supabase: AdminClient | null): Promise<WorkerStatus> {
  const label = "npm run worker running";

  if (!requiredSupabaseEnvPresent) {
    return {
      check: check("worker", label, "unknown", "Worker status cannot be inferred until Supabase is configured."),
      activeWork: false,
    };
  }

  if (!supabaseProjectCanBeQueried) {
    return {
      check: check(
        "worker",
        label,
        "unknown",
        "Worker status cannot be inferred while Supabase points at the wrong project.",
      ),
      activeWork: false,
    };
  }

  try {
    if (!supabase) {
      throw new Error("Supabase admin client is unavailable.");
    }
    const [latestResult, activeResult] = await Promise.all([
      supabase.from("ingestion_jobs").select("status,updated_at").order("updated_at", { ascending: false }).limit(1),
      supabase
        .from("ingestion_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "processing"]),
    ]);

    if (latestResult.error || activeResult.error) {
      return {
        check: check("worker", label, "unknown", "Ingestion jobs could not be checked."),
        activeWork: false,
      };
    }

    const latest = latestResult.data?.[0];
    const activeWork = (activeResult.count ?? 0) > 0;
    if (!latest?.updated_at) {
      return {
        check: check("worker", label, "unknown", "No ingestion activity has been recorded yet."),
        activeWork,
      };
    }

    const updatedAt = new Date(latest.updated_at).getTime();
    const recentWindowMs = Math.max(env.WORKER_POLL_MS * 6, 60_000);
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt <= recentWindowMs) {
      return {
        check: check("worker", label, "ready", "Recent ingestion activity was detected."),
        activeWork,
      };
    }

    if ((activeResult.count ?? 0) === 0 && latest.status === "completed") {
      return {
        check: check("worker", label, "ready", "No queued ingestion work is waiting; the latest job completed."),
        activeWork: false,
      };
    }

    return {
      check: check(
        "worker",
        label,
        "unknown",
        "Queued or processing ingestion work exists, but no recent activity proves the worker is active.",
      ),
      activeWork,
    };
  } catch {
    return {
      check: check("worker", label, "unknown", "Worker status could not be inferred."),
      activeWork: false,
    };
  }
}

function setupStatusCacheTtl(payload: SetupStatusPayload) {
  if (payload.checks.some((item) => item.detail.includes("temporarily unavailable"))) {
    return SETUP_STATUS_OUTAGE_CACHE_MS;
  }
  return payload.indexingActive ? SETUP_STATUS_ACTIVE_CACHE_MS : SETUP_STATUS_IDLE_CACHE_MS;
}

function setupStatusResponse(payload: SetupStatusPayload) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, max-age=5, stale-while-revalidate=30",
      // GET below picks between the full diagnostic payload and the coarse one using the
      // operator token (`x-health-deep-token`, see allowDeepHealthProbe) and the
      // administrator bearer in `Authorization`. Both variants are cacheable for the same
      // URL, so a cache with no Vary can replay one caller's detail level to the other
      // (2026-09-02 audit, L110). `private` already keeps this inside one browser.
      Vary: "Authorization, x-health-deep-token",
      "X-Poll-After-Ms": String(payload.pollAfterMs ?? ""),
    },
  });
}

// Coarse per-check detail for anonymous production callers. The full `detail` strings can carry
// raw Supabase error text and project-config specifics (schema/search/worker fan-out errors,
// formatSupabaseProjectCheck), which must not leak to unauthenticated internet clients. Status
// and label are preserved so the polled setup UI still renders; operators fetch full detail with
// the shared deep-probe secret.
const COARSE_SETUP_DETAIL: Record<SetupCheckStatus, string> = {
  ready: "Ready.",
  needs_setup: "Setup incomplete. Operators can see specifics via the health deep probe or server logs.",
  unknown: "Status unavailable. Operators can see specifics via the health deep probe or server logs.",
};

// `answerPreview` is the one check whose detail survives, and it is REBUILT here rather than
// passed through. It is a diagnostic for the clinician using the app, not operator telemetry:
// blanking it left the person reporting "the sources never appear" reading `Ready.` whatever had
// happened. `describeEvidencePreviewForAnyCaller` assembles its string from a fixed enum and a
// timestamp and nothing else, so rebuilding rather than copying keeps that guarantee even if the
// authorized detail is later widened.
function coarseSetupStatusPayload(payload: SetupStatusPayload): SetupStatusPayload {
  return {
    ...payload,
    checks: payload.checks.map((item) =>
      item.id === "answerPreview"
        ? { ...item, detail: describeEvidencePreviewForAnyCaller() }
        : { ...item, detail: COARSE_SETUP_DETAIL[item.status] },
    ),
  };
}

/** Why the answer wait did or did not show its sources.
 *
 * Diagnostic, not setup: it reports `ready` whenever the feature is enabled, so a withheld
 * preview never reads as a broken installation. It exists because the preview is discarded at
 * several points that recorded nothing, and a clinician reporting "the sources never appear"
 * could not be answered without guessing — three rounds of guessing, in the case that prompted
 * it. One enum and a timestamp; no query, document, owner, or clinical text ever reaches here.
 */
function answerPreviewCheck(): SetupCheck {
  // The operator form, with the exact timestamp. `coarseSetupStatusPayload` swaps in the bucketed
  // form for an anonymous caller — the only difference between the two is the precision of "when",
  // never the decision word, so the anonymous reader is not shown a weaker truth.
  const status = env.RAG_INCREMENTAL_EVIDENCE_PREVIEW ? "ready" : "needs_setup";
  return check("answerPreview", "Answer wait shows sources", status, describeEvidencePreviewForOperator());
}

async function buildSetupStatusPayload(): Promise<SetupStatusPayload> {
  const supabase = supabaseProjectCanBeQueried ? createAdminClient() : null;
  const unavailable = await readSupabaseAvailability(supabase);
  if (unavailable) {
    const checks = [
      check(
        "env",
        ".env.local configured",
        requiredSupabaseEnvPresent ? "ready" : "needs_setup",
        requiredSupabaseEnvPresent
          ? "Required Supabase server environment variables are present."
          : "Set the required Supabase URL and server key.",
      ),
      check(
        "project",
        "PsychSift Production target",
        projectSetupCheckStatus(supabaseProjectCheck.status),
        formatSupabaseProjectCheck(supabaseProjectCheck),
      ),
      check(
        "schema",
        "supabase/schema.sql applied",
        "unknown",
        `Supabase is temporarily unavailable; schema fan-out checks are backing off. Last error: ${unavailable}`,
      ),
      check(
        "search",
        "Search RPC and vector indexes",
        "unknown",
        `Supabase is temporarily unavailable; search health checks are backing off. Last error: ${unavailable}`,
      ),
      check(
        "openai",
        "OpenAI API key available",
        env.OPENAI_API_KEY ? "ready" : "needs_setup",
        env.OPENAI_API_KEY
          ? "OPENAI_API_KEY is present for answers, embeddings, and captions."
          : "Set OPENAI_API_KEY before real indexing or answers.",
      ),
      check(
        "worker",
        "npm run worker running",
        "unknown",
        `Supabase is temporarily unavailable; worker fan-out checks are backing off. Last error: ${unavailable}`,
      ),
    ];
    return {
      demoMode: isDemoMode(),
      checks,
      indexingActive: false,
      pollAfterMs: SETUP_STATUS_OUTAGE_CACHE_MS,
      generatedAt: new Date().toISOString(),
    };
  }

  const [schema, search, worker] = await Promise.all([
    readSchemaStatus(supabase),
    readSearchSchemaStatus(supabase),
    readWorkerStatus(supabase),
  ]);

  const checks = [
    check(
      "env",
      ".env.local configured",
      requiredSupabaseEnvPresent ? "ready" : "needs_setup",
      requiredSupabaseEnvPresent
        ? "Required Supabase server environment variables are present."
        : "Set the required Supabase URL and server key.",
    ),
    check(
      "project",
      "PsychSift Production target",
      projectSetupCheckStatus(supabaseProjectCheck.status),
      formatSupabaseProjectCheck(supabaseProjectCheck),
    ),
    schema,
    search,
    check(
      "openai",
      "OpenAI API key available",
      env.OPENAI_API_KEY ? "ready" : "needs_setup",
      env.OPENAI_API_KEY
        ? "OPENAI_API_KEY is present for answers, embeddings, and captions."
        : "Set OPENAI_API_KEY before real indexing or answers.",
    ),
    worker.check,
    answerPreviewCheck(),
  ];
  const setupSettled = checks.every((item) => item.status === "ready");
  const pollAfterMs = worker.activeWork ? ACTIVE_INDEXING_POLL_MS : setupSettled ? null : SETUP_RECHECK_POLL_MS;

  return {
    demoMode: isDemoMode(),
    checks,
    indexingActive: worker.activeWork,
    pollAfterMs,
    generatedAt: new Date().toISOString(),
  };
}

async function readSetupStatusPayload() {
  const now = Date.now();
  if (setupStatusState.cache && setupStatusState.cache.expiresAt > now) {
    return setupStatusState.cache.payload;
  }

  // Serve an expired payload at once and refresh it in the background. Building a fresh one takes
  // 1-12 s in production (Railway logs, 2026-09-19..26: exact counts, a storage listing and the
  // health RPC, each crossing Singapore -> Sydney), and every page load, tab focus and poll asks
  // for it. A checklist one refresh behind is harmless; a stale payload older than the bound below
  // is not served, so a long-idle process still waits for current state.
  if (setupStatusState.cache && now - setupStatusState.cache.expiresAt <= SETUP_STATUS_MAX_STALE_MS) {
    const stalePayload = setupStatusState.cache.payload;
    void refreshSetupStatusPayload().catch((error: unknown) => {
      logger.warn("Background setup-status refresh failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return undefined;
    });
    return stalePayload;
  }

  return refreshSetupStatusPayload();
}

async function refreshSetupStatusPayload() {
  if (setupStatusState.inFlight) {
    return setupStatusState.inFlight;
  }

  const promise = buildSetupStatusPayload().then((payload) => {
    setupStatusState.cache = {
      expiresAt: Date.now() + setupStatusCacheTtl(payload),
      payload,
    };
    return payload;
  });
  setupStatusState.inFlight = promise;

  try {
    return await promise;
  } finally {
    if (setupStatusState.inFlight === promise) {
      setupStatusState.inFlight = null;
    }
  }
}

export async function GET(request: Request) {
  const identity = localProjectRequestIdentityPayload(request);
  if (!identity.localServer.safeLocalOrigin) {
    return unsafeLocalProjectResponse(identity);
  }

  const payload = await readSetupStatusPayload();
  // Whether the caller may see raw per-check detail (raw Supabase error text / project posture).
  // Gate on trusted server-side signals, never request.url's client-controlled host.
  const requiresAuthorization = process.env.NODE_ENV === "production" && !isDemoMode() && !isLocalNoAuthMode();
  let authorizedForDetail = !requiresAuthorization || allowDeepHealthProbe(request);

  if (!authorizedForDetail && request.headers.has("authorization")) {
    try {
      await requireAuthenticatedUser(request, createAdminClient(), { administrator: true });
      authorizedForDetail = true;
    } catch (error) {
      const expectedAuthorizationFailure =
        error instanceof AuthenticationError || (error instanceof PublicApiError && error.status === 403);
      if (!expectedAuthorizationFailure) {
        console.error("setup-status: unexpected error checking administrator elevation", error);
      }
      // Invalid, expired, and non-administrator credentials receive the same
      // coarse posture as an anonymous caller; setup status is not an auth or role oracle.
    }
  }

  return setupStatusResponse(authorizedForDetail ? payload : coarseSetupStatusPayload(payload));
}
