import { ragProgrammeHealth } from "@/lib/rag/rag-rollout";
import { NextResponse } from "next/server";
import { isAbortError } from "@/lib/abort-error";
import { allowDeepHealthProbe } from "@/lib/deep-probe-auth";
import { env, isDemoMode } from "@/lib/env";
import type { AnswerSloSnapshot, SloProbeClient } from "@/lib/observability/answer-slo";
import { cacheMetricsSnapshot, type CacheMetricsSnapshot } from "@/lib/observability/cache-metrics";
import {
  answerCoalescingMetricsSnapshot,
  type AnswerCoalescingMetricsSnapshot,
} from "@/lib/observability/answer-coalescing-metrics";
import type { SpendProbeClient, SpendSnapshot } from "@/lib/observability/spend-metrics";
import type { CleanupBacklogProbeClient, StorageCleanupBacklogSnapshot } from "@/lib/observability/cleanup-backlog";
import { resolveDeploymentCommitSha } from "@/lib/observability/sentry-release";
import type { SiteContentPublicHealthProjection } from "@/lib/site-content/site-content-health";

type HealthResponseOptions = {
  forceDeep?: boolean;
  allowUnauthenticatedDeep?: boolean;
  /**
   * WHAT THIS RESPONSE IS FOR, and the reason the deploy gate survives a new probe being added.
   *
   * "readiness" answers one question — can THIS CONTAINER serve requests — and runs the
   * container-level checks only: configuration presence, and one bounded `select ... limit 1`
   * against Supabase. Every optional probe below is OFF under it, whatever its individual flag
   * says, because the gate is this one value rather than a list of exceptions.
   *
   * That inversion is the fix for how 24 production deploys died. `/api/health/ready` used to
   * opt INTO the deep branch and then switch each expensive probe off by name, six `false`s
   * long. A deny-list like that is only correct until the next probe is added, and it silently
   * stops being correct the moment one is: whatever lands in the deep branch is live on the
   * deploy gate until somebody remembers to write a seventh `false`. The site-content audit was
   * that seventh thing, so a ~7 s whole-corpus integrity query ran on an endpoint Railway gives
   * ten seconds, and every merge for three days built, started, answered too slowly and was
   * rolled back.
   *
   * It had already happened once before on the same mechanism and was read as a one-probe bug:
   * see the `includeSlo` case in `tests/health-response-deep-probe.test.ts`, whose own comment
   * ends "one flag at one caller, not a gate". This is the gate.
   *
   * So: a new probe added below is diagnostic-only by construction and cannot reach the deploy
   * gate by omission. Putting one on readiness now takes a deliberate edit here, next to this
   * paragraph. `tests/health-response-deep-probe.test.ts` pins the readiness response shape
   * exactly, so anything that does leak in fails a test rather than a rollout.
   */
  probes?: "readiness" | "diagnostic";
  includeSlo?: boolean;
  includeCache?: boolean;
  includeCoalescing?: boolean;
  includeSpend?: boolean;
  /** Outstanding `storage_cleanup_jobs` counts (audit F-10), operator-gated like `spend`. */
  includeStorageCleanup?: boolean;
  includeOperatorDiagnostics?: boolean;
  /** The site-content control-plane audit. See the block guarding it below. */
  includeSiteContent?: boolean;
};

/**
 * Deadline for readiness's one Supabase call.
 *
 * `probeSupabaseHealth` is a single `select id ... limit 1`, but until this existed it was the
 * last unbounded thing on the deploy gate: on a cold container — no warm connection, no cached
 * plan, cold PostgREST schema cache — even that can outrun Railway's ten-second window, and an
 * unbounded call has no way to answer before the gate gives up. Five seconds leaves half the
 * window spare, and turns the worst case from an indistinguishable timeout into a fast 503 that
 * names the failing check and leaves room for Railway's remaining retries.
 */
const READINESS_SUPABASE_PROBE_TIMEOUT_MS = 5_000;

/**
 * Deadline for the site-content evidence read. It exists so a slow control-plane audit degrades
 * one field instead of hanging a request, and it is bounded on BOTH sides by measurement rather
 * than chosen for roundness:
 *
 * - It must sit well ABOVE the audit's healthy cost. Nine token-authorized deep probes against
 *   the live warm container on 2026-09-14 took 7.18 s to 7.86 s, every one of them HTTP 200
 *   (`docs/deployment-architecture.md` § Readiness). A deadline under that does not bound a
 *   fault, it manufactures one — the abort
 *   lands in the `catch` below as `checks.siteContent = "error"`, which is indistinguishable from
 *   a genuine corpus inconsistency and drops the whole probe to 503. That would break the one
 *   surface this endpoint still exists to provide, because `scripts/lib/deployment-rag-activation.mjs`
 *   reads exactly this response and fails `check:production-readiness` on a non-2xx.
 * - It must sit BELOW the readiness prober's own whole-response budget, which is
 *   `AbortSignal.timeout(15000)` in that same file. A deadline above it would never be reached:
 *   the caller would give up first, turning a diagnosable one-field timeout into an opaque
 *   `health_probe_failed`.
 *
 * Ten seconds clears the slowest of those nine samples by about 27% and still leaves the whole
 * deep probe comfortably inside the caller's 15 s budget. That headroom is thin, and deliberately
 * so: it is sized for the corpus as measured, not for an arbitrary future one. The way to widen
 * it is to make the audit cheaper — the profiling work queued in `/issues` — not to raise this
 * number until it collides with the caller's timeout. `tests/health-response-deep-probe.test.ts`
 * pins both bounds, because the value going in below the measured cost is the defect this replaced.
 */
export const SITE_CONTENT_PROBE_TIMEOUT_MS = 10_000;

/**
 * Length of the `sloTrailing` answer snapshot: one ops-digest interval (the digest runs every six
 * hours). The hourly `slo` snapshot alone left five hours in every six unexamined, so rising
 * source-gap, unsupported or fallback rates went unnoticed (audit EVAL-02, 2026-10-20). Must equal
 * `ANSWER_QUALITY_WINDOW_MINUTES` in scripts/lib/operational-alerts.mjs, which judges it;
 * tests/health-response-deep-probe.test.ts pins the two together.
 */
export const ANSWER_SLO_TRAILING_WINDOW_MINUTES = 360;

export async function healthResponse(request: Request, options: HealthResponseOptions = {}) {
  const deep = options.forceDeep || new URL(request.url).searchParams.get("deep") === "1";
  const tokenAuthorized = allowDeepHealthProbe(request);
  const readinessOnly = options.probes === "readiness";
  /**
   * The single gate every optional probe passes through. A probe runs only when this response is
   * NOT a readiness check and its own flag has not been turned off. Adding a probe below without
   * routing it through here puts it back on the deploy gate, which is the bug this replaced.
   */
  const probeEnabled = (flag: boolean | undefined) => !readinessOnly && flag !== false;
  const operatorDiagnostics = tokenAuthorized && probeEnabled(options.includeOperatorDiagnostics);
  const supabaseConfigured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  const openAIConfigured = Boolean(env.OPENAI_API_KEY);
  const checks: Record<string, "ok" | "missing" | "error" | "timeout" | "skipped" | "unauthorized"> = {
    supabaseConfig: supabaseConfigured ? "ok" : "missing",
    openaiConfig: openAIConfigured ? "ok" : env.RAG_PROVIDER_MODE === "offline" ? "skipped" : "missing",
    siteContent: "skipped",
  };
  let slo: AnswerSloSnapshot | null = null;
  // `{ unavailable: true }` marks a trailing query that failed on this build, so the digest reports
  // answer quality as unknown rather than treating the response as an older hourly-only build.
  let sloTrailing: AnswerSloSnapshot | { windowMinutes: number; unavailable: true } | null = null;
  let cache: CacheMetricsSnapshot | null = null;
  let coalescing: AnswerCoalescingMetricsSnapshot | null = null;
  let spend: SpendSnapshot | null = null;
  let siteContent: SiteContentPublicHealthProjection | null = null;
  let storageCleanup: StorageCleanupBacklogSnapshot | null = null;

  if (deep) {
    if (!options.allowUnauthenticatedDeep && !tokenAuthorized) {
      checks.supabase = "unauthorized";
    } else {
      // Cache hit-rate is operator-gated internal telemetry (the in-process
      // hot-path half of the silent-degradation counters). Expose it only to a
      // genuinely token-authorized deep probe — never the unauthenticated
      // readiness endpoint, which exposes no diagnostic details — and only when
      // not explicitly suppressed. Reads a cumulative counter (no DB), so it is
      // available even in demo mode. Like `slo`, it never flips liveness.
      if (operatorDiagnostics && probeEnabled(options.includeCache)) {
        cache = cacheMetricsSnapshot();
      }
      if (operatorDiagnostics && probeEnabled(options.includeCoalescing)) {
        coalescing = answerCoalescingMetricsSnapshot();
      }

      if (supabaseConfigured && !isDemoMode()) {
        try {
          const [{ createAdminClient }, { probeSupabaseHealth }, { answerSloSnapshot }] = await Promise.all([
            import("@/lib/supabase/admin"),
            import("@/lib/supabase/health"),
            import("@/lib/observability/answer-slo"),
          ]);
          const admin = createAdminClient();
          const health = await probeSupabaseHealth(
            admin,
            readinessOnly ? AbortSignal.timeout(READINESS_SUPABASE_PROBE_TIMEOUT_MS) : undefined,
          );
          checks.supabase = health.ok ? "ok" : "error";
          // NOT on the readiness path, deliberately. `read_site_content_health()` is a
          // whole-corpus integrity audit — record counts, digest comparisons, tombstone
          // reconciliation — and it costs about seven seconds against the live database.
          // Railway allows each healthcheck attempt ten, so between 2026-09-11 and 2026-09-14
          // this single call failed 24 production deploys: every merge built, started, answered
          // this endpoint too slowly, and was rolled back, silently pinning the live site to
          // three-day-old code. Readiness answers "can THIS CONTAINER serve requests"; whether
          // the shared control plane is internally consistent is a monitoring question, and it
          // keeps its home on the token-gated `/api/health?deep=1` and in
          // `npm run check:production-readiness`. `tests/health-response-deep-probe.test.ts`
          // pins both halves of that split.
          if (health.ok && probeEnabled(options.includeSiteContent)) {
            try {
              const [{ readSiteContentHealthEvidence }, { classifySiteContentHealth, classifySiteContentPartition }] =
                await Promise.all([
                  import("@/lib/site-content/site-content-publication"),
                  import("@/lib/site-content/site-content-health"),
                ]);
              const evidence = await readSiteContentHealthEvidence(
                admin,
                AbortSignal.timeout(SITE_CONTENT_PROBE_TIMEOUT_MS),
              );
              const partition = classifySiteContentPartition({
                expectedSiteStaticManifestDigest: env.SITE_CONTENT_EXPECTED_STATIC_MANIFEST_DIGEST,
                activePublicSiteRelease: evidence.activePublicSiteRelease,
                publicSiteChangeEpoch: evidence.publicSiteChangeEpoch,
                pendingPublicSiteChangeCount: evidence.outstandingHeadCount,
              });
              const classification = classifySiteContentHealth({
                ...evidence,
                partition,
                now: new Date().toISOString(),
              });
              siteContent = classification.publicProjection;
              checks.siteContent = classification.operationStop ? "error" : "ok";
            } catch (error) {
              // A deadline and a corpus inconsistency arrive through the same `catch` and call for
              // opposite responses: one is "this query has outgrown its budget, go profile it", the
              // other is "the control plane disagrees with itself, go look at the data". Collapsing
              // both into "error" sent the last investigation to the wrong place, so they are named
              // apart here. Both still fail the probe closed — an audit that did not finish is not
              // evidence that the corpus is sound.
              checks.siteContent = isAbortError(error) ? "timeout" : "error";
            }
          }
          // `operatorDiagnostics &&` matches `spendSnapshot` below and makes the gate real: the
          // SLO aggregate is a deliberate CROSS-TENANT read (see its entry in
          // scripts/lib/tenancy-scan.mjs, which states this exact gate). Without it the
          // snapshot also ran for any caller passing `allowUnauthenticatedDeep`, so the only
          // thing holding the claim true was `/api/health/ready` opting out via
          // `includeSlo: false` — one flag at one caller, not a gate.
          if (health.ok && operatorDiagnostics && probeEnabled(options.includeSlo)) {
            // Avoid recursively instantiating the full generated PostgREST
            // client type against the intentionally tiny SLO query surface.
            const sloClient = admin as unknown as SloProbeClient;
            // Hourly (hybrid-RPC identity history) and trailing (answer-rate alerts) snapshots
            // run side by side; either failing drops only its own block.
            const [hourly, trailing] = await Promise.allSettled([
              answerSloSnapshot(sloClient),
              answerSloSnapshot(sloClient, ANSWER_SLO_TRAILING_WINDOW_MINUTES),
            ]);
            slo = hourly.status === "fulfilled" ? hourly.value : null;
            sloTrailing =
              trailing.status === "fulfilled"
                ? trailing.value
                : { windowMinutes: ANSWER_SLO_TRAILING_WINDOW_MINUTES, unavailable: true };
          }
          // Answer-generation spend, gated like `slo` (token-authorized deep probe
          // + healthy Supabase). Derives USD from already-recorded token counts and
          // a configurable price; errors are swallowed to null and never flip
          // liveness. Suppressed only when explicitly disabled.
          if (health.ok && operatorDiagnostics && probeEnabled(options.includeSpend)) {
            try {
              const { spendSnapshot } = await import("@/lib/observability/spend-metrics");
              // admin is structurally a SpendProbeClient; cast avoids a deep
              // instantiation check against the full PostgREST client type (TS2589),
              // matching how answer-slo/health treat the admin client.
              spend = await spendSnapshot(admin as unknown as SpendProbeClient, {
                pricing: {
                  inputPerMTok: env.OPENAI_PRICE_INPUT_PER_MTOK,
                  cachedInputPerMTok: env.OPENAI_PRICE_CACHED_INPUT_PER_MTOK,
                  outputPerMTok: env.OPENAI_PRICE_OUTPUT_PER_MTOK,
                },
                alertDailyUsd: env.SPEND_ALERT_DAILY_USD,
              });
            } catch {
              spend = null;
            }
          }
          // Storage cleanup backlog (audit F-10): failed storage deletions are queued in
          // `storage_cleanup_jobs` and drained only by the manual `npm run cleanup:storage`,
          // so the count is surfaced for the ops digest. Head-only counts plus one timestamp,
          // gated like `spend`; a query error drops the block and never flips liveness.
          if (health.ok && operatorDiagnostics && probeEnabled(options.includeStorageCleanup)) {
            try {
              const { storageCleanupBacklogSnapshot } = await import("@/lib/observability/cleanup-backlog");
              storageCleanup = await storageCleanupBacklogSnapshot(admin as unknown as CleanupBacklogProbeClient);
            } catch {
              storageCleanup = null;
            }
          }
        } catch {
          checks.supabase = "error";
        }
      } else {
        checks.supabase = "skipped";
      }
    }
  }

  const ready = !Object.values(checks).some(
    (value) => value === "missing" || value === "error" || value === "timeout" || value === "unauthorized",
  );

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      demoMode: isDemoMode(),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      deploymentCommitSha: resolveDeploymentCommitSha(),
      checks,
      ...(slo ? { slo } : {}),
      ...(sloTrailing ? { sloTrailing } : {}),
      ...(cache ? { cache } : {}),
      ...(coalescing ? { coalescing } : {}),
      ...(spend ? { spend } : {}),
      ...(storageCleanup ? { storageCleanup } : {}),
      ...(siteContent ? { siteContent } : {}),
      ...(deep && operatorDiagnostics
        ? { ragProgramme: { ...ragProgrammeHealth(), siteContentFreshness: siteContent?.state ?? "unavailable" } }
        : {}),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
