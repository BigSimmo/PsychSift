import { NextResponse } from "next/server";
import { allowDeepHealthProbe } from "@/lib/deep-probe-auth";
import { env, isDemoMode } from "@/lib/env";
import type { AnswerSloSnapshot, SloProbeClient } from "@/lib/observability/answer-slo";
import { cacheMetricsSnapshot, type CacheMetricsSnapshot } from "@/lib/observability/cache-metrics";
import {
  answerCoalescingMetricsSnapshot,
  type AnswerCoalescingMetricsSnapshot,
} from "@/lib/observability/answer-coalescing-metrics";
import type { SpendProbeClient, SpendSnapshot } from "@/lib/observability/spend-metrics";
import { resolveDeploymentCommitSha } from "@/lib/observability/sentry-release";
import type {
  ActiveSiteContentRelease,
  SiteContentPartitionSnapshot,
} from "@/lib/site-content/site-content-contracts";
import {
  assertSiteContentPartitionSnapshot,
  siteContentPendingLogicalIdsDigest,
} from "@/lib/site-content/site-content-registry";

const SITE_CONTENT_SYNCHRONIZER_FRESH_MS = 5 * 60 * 1000;
const SITE_CONTENT_PENDING_STOP_SECONDS = 10 * 60;
const SITE_CONTENT_HEALTH_COUNT_MAX = 999_999;
const SITE_CONTENT_HEALTH_AGE_MAX_SECONDS = 86_400;

type SiteContentDomainHealthEvidence = Readonly<{
  domain: string;
  reviewState: "unreviewed" | "reviewed";
  eligibility: "eligible" | "reviewed_ineligible";
  sourceStatus: "current" | "review_due" | "outdated" | "unknown";
  validationStatus: "unverified" | "locally_reviewed" | "approved";
}>;

export type SiteContentActiveReleaseHealthEvidence = ActiveSiteContentRelease &
  Readonly<{
    deploymentSha: string;
    changeEpoch: string;
    pendingLogicalIds: string[];
    pendingLogicalIdsDigest: string;
    rollbackAvailable: boolean;
    integrity: Readonly<{
      expectedRecordCount: number;
      publishedRecordCount: number;
      untrackedDeletionCount: number;
      duplicatePublishedLogicalIdCount: number;
      nonAdminPublicationCount: number;
      domains: SiteContentDomainHealthEvidence[];
    }>;
  }>;

export type SiteContentQueueHealth = Readonly<{
  observedAt: string;
  synchronizerDeployed: boolean;
  lastHeartbeatAt: string | null;
  lastInvocationAt: string | null;
  changeEpoch: string;
  pendingLogicalIds: string[];
  pendingLogicalIdsDigest: string;
  pendingCount: number;
  oldestPendingAgeSeconds: number | null;
  failedCount: number;
}>;

export type SiteContentHealthInput = Readonly<{
  expectedStaticManifestDigest: string;
  activeRelease: SiteContentActiveReleaseHealthEvidence | null;
  queueHealth: SiteContentQueueHealth;
  deploymentSha: string;
}>;

export type SiteContentHealthStopReason =
  | "missing_active_release"
  | "invalid_release_identity"
  | "invalid_expected_static_digest"
  | "invalid_active_static_digest"
  | "invalid_dynamic_state_digest"
  | "invalid_release_digest"
  | "static_manifest_mismatch"
  | "invalid_deployment_sha"
  | "deployment_sha_mismatch"
  | "invalid_release_integrity"
  | "partial_population"
  | "untracked_deletion"
  | "duplicate_published_logical_id"
  | "non_admin_publication"
  | "unreviewed_domain"
  | "reviewed_ineligible_domain"
  | "stale_source_status"
  | "stale_validation_status"
  | "invalid_queue_health"
  | "synchronizer_not_deployed"
  | "stale_worker_heartbeat"
  | "stale_worker_invocation"
  | "failed_queue_item"
  | "pending_exclusion_mismatch"
  | "pending_epoch_mismatch"
  | "release_partition_mismatch"
  | "pending_item_over_age";

export type SiteContentHealthProjection = Readonly<{
  publicReleaseId: string | null;
  staticManifestMatch: boolean;
  releaseDigestPrefix: string | null;
  state: "current" | "updating" | "failure";
  synchronizerDeployed: boolean;
  synchronizerInvocationFresh: boolean;
  queue: Readonly<{
    pendingCount: number;
    oldestPendingAgeSeconds: number | null;
    failedCount: number;
  }>;
  lastActivation: string | null;
  rollbackAvailable: boolean;
}>;

export type SiteContentHealthClassification = Readonly<{
  health: SiteContentHealthProjection;
  stopReasons: readonly SiteContentHealthStopReason[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256Digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function deploymentCommit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function exactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalLogicalIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((id) => !nonEmpty(id))) return null;
  const ids = value as string[];
  const canonical = [...ids].sort();
  if (new Set(ids).size !== ids.length || ids.some((id, index) => canonical[index] !== id)) return null;
  return ids;
}

function boundedCount(value: unknown) {
  return nonNegativeInteger(value) ? Math.min(value, SITE_CONTENT_HEALTH_COUNT_MAX) : 0;
}

function boundedAge(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), SITE_CONTENT_HEALTH_AGE_MAX_SECONDS)
    : null;
}

function timestampFresh(value: unknown, observedAt: number) {
  if (!exactIsoTimestamp(value)) return false;
  const timestamp = Date.parse(value);
  return timestamp <= observedAt && observedAt - timestamp <= SITE_CONTENT_SYNCHRONIZER_FRESH_MS;
}

export function classifySiteContentHealth(input: unknown): SiteContentHealthClassification {
  const root = isRecord(input) ? input : {};
  const active = isRecord(root.activeRelease) ? root.activeRelease : null;
  const queue = isRecord(root.queueHealth) ? root.queueHealth : {};
  const reasons: SiteContentHealthStopReason[] = [];
  const add = (reason: SiteContentHealthStopReason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  if (!active) add("missing_active_release");
  if (
    active &&
    (active.version !== "clinical-kb-site-release-v1" ||
      active.state !== "active" ||
      !nonEmpty(active.releaseId) ||
      !nonEmpty(active.registryVersion) ||
      !exactIsoTimestamp(active.activatedAt))
  ) {
    add("invalid_release_identity");
  }

  const expectedStaticDigest = root.expectedStaticManifestDigest;
  const activeStaticDigest = active?.staticManifestDigest;
  const dynamicStateDigest = active?.dynamicStateDigest;
  const releaseDigest = active?.releaseDigest;
  if (!sha256Digest(expectedStaticDigest)) add("invalid_expected_static_digest");
  if (!sha256Digest(activeStaticDigest)) add("invalid_active_static_digest");
  if (!sha256Digest(dynamicStateDigest)) add("invalid_dynamic_state_digest");
  if (!sha256Digest(releaseDigest)) add("invalid_release_digest");
  const staticManifestMatch =
    sha256Digest(expectedStaticDigest) &&
    sha256Digest(activeStaticDigest) &&
    expectedStaticDigest === activeStaticDigest;
  if (sha256Digest(expectedStaticDigest) && sha256Digest(activeStaticDigest) && !staticManifestMatch) {
    add("static_manifest_mismatch");
  }

  if (!deploymentCommit(root.deploymentSha) || (active && !deploymentCommit(active.deploymentSha))) {
    add("invalid_deployment_sha");
  } else if (active && root.deploymentSha !== active.deploymentSha) {
    add("deployment_sha_mismatch");
  }

  const integrity = active && isRecord(active.integrity) ? active.integrity : null;
  if (!integrity || !Array.isArray(integrity.domains) || integrity.domains.length === 0) {
    add("invalid_release_integrity");
  } else {
    const expectedCount = integrity.expectedRecordCount;
    const publishedCount = integrity.publishedRecordCount;
    if (!nonNegativeInteger(expectedCount) || expectedCount === 0 || !nonNegativeInteger(publishedCount)) {
      add("invalid_release_integrity");
    } else if (expectedCount !== publishedCount) {
      add("partial_population");
    }
    for (const [value, reason] of [
      [integrity.untrackedDeletionCount, "untracked_deletion"],
      [integrity.duplicatePublishedLogicalIdCount, "duplicate_published_logical_id"],
      [integrity.nonAdminPublicationCount, "non_admin_publication"],
    ] as const) {
      if (!nonNegativeInteger(value)) add("invalid_release_integrity");
      else if (value > 0) add(reason);
    }
    for (const domain of integrity.domains) {
      if (!isRecord(domain) || !nonEmpty(domain.domain)) {
        add("invalid_release_integrity");
        continue;
      }
      if (domain.reviewState === "unreviewed") add("unreviewed_domain");
      else if (domain.reviewState !== "reviewed") add("invalid_release_integrity");
      if (domain.eligibility === "reviewed_ineligible") add("reviewed_ineligible_domain");
      else if (domain.eligibility !== "eligible") add("invalid_release_integrity");
      if (domain.sourceStatus !== "current") add("stale_source_status");
      if (domain.validationStatus !== "locally_reviewed" && domain.validationStatus !== "approved") {
        add("stale_validation_status");
      }
    }
  }

  const observedAtValid = exactIsoTimestamp(queue.observedAt);
  const observedAt = observedAtValid ? Date.parse(queue.observedAt as string) : Number.NaN;
  const activeTimestampValid = active ? exactIsoTimestamp(active.activatedAt) : false;
  const queueCountsValid =
    nonNegativeInteger(queue.pendingCount) &&
    nonNegativeInteger(queue.failedCount) &&
    ((queue.pendingCount === 0 && queue.oldestPendingAgeSeconds === null) ||
      (queue.pendingCount > 0 &&
        typeof queue.oldestPendingAgeSeconds === "number" &&
        Number.isFinite(queue.oldestPendingAgeSeconds) &&
        queue.oldestPendingAgeSeconds >= 0));
  if (
    !observedAtValid ||
    !queueCountsValid ||
    typeof queue.synchronizerDeployed !== "boolean" ||
    (activeTimestampValid && Date.parse(active!.activatedAt as string) > observedAt)
  ) {
    add("invalid_queue_health");
  }

  const synchronizerDeployed = queue.synchronizerDeployed === true;
  const heartbeatFresh = observedAtValid && timestampFresh(queue.lastHeartbeatAt, observedAt);
  const invocationFresh = observedAtValid && timestampFresh(queue.lastInvocationAt, observedAt);
  if (!synchronizerDeployed) add("synchronizer_not_deployed");
  if (!heartbeatFresh) add("stale_worker_heartbeat");
  if (!invocationFresh) add("stale_worker_invocation");
  if (nonNegativeInteger(queue.failedCount) && queue.failedCount > 0) add("failed_queue_item");
  if (
    typeof queue.oldestPendingAgeSeconds === "number" &&
    Number.isFinite(queue.oldestPendingAgeSeconds) &&
    queue.oldestPendingAgeSeconds > SITE_CONTENT_PENDING_STOP_SECONDS
  ) {
    add("pending_item_over_age");
  }

  const activePendingIds = canonicalLogicalIds(active?.pendingLogicalIds);
  const queuePendingIds = canonicalLogicalIds(queue.pendingLogicalIds);
  const activePendingDigest = active?.pendingLogicalIdsDigest;
  const queuePendingDigest = queue.pendingLogicalIdsDigest;
  const pendingSetsMatch =
    activePendingIds !== null &&
    queuePendingIds !== null &&
    JSON.stringify(activePendingIds) === JSON.stringify(queuePendingIds) &&
    nonEmpty(activePendingDigest) &&
    nonEmpty(queuePendingDigest) &&
    activePendingDigest === siteContentPendingLogicalIdsDigest(activePendingIds) &&
    queuePendingDigest === siteContentPendingLogicalIdsDigest(queuePendingIds) &&
    activePendingDigest === queuePendingDigest &&
    nonNegativeInteger(queue.pendingCount) &&
    queue.pendingCount === queuePendingIds.length;
  if (!pendingSetsMatch) add("pending_exclusion_mismatch");
  if (!nonEmpty(active?.changeEpoch) || !nonEmpty(queue.changeEpoch) || active?.changeEpoch !== queue.changeEpoch) {
    add("pending_epoch_mismatch");
  }

  const pendingCount = boundedCount(queue.pendingCount);
  const hasPending = Boolean(activePendingIds?.length || queuePendingIds?.length || pendingCount > 0);
  if (active) {
    const partitionState = staticManifestMatch ? (hasPending ? "updating" : "current") : "stale";
    const partitionSnapshot: SiteContentPartitionSnapshot = {
      registryVersion: nonEmpty(active.registryVersion) ? active.registryVersion : null,
      releaseId: nonEmpty(active.releaseId) ? active.releaseId : null,
      expectedStaticManifestDigest: nonEmpty(expectedStaticDigest) ? expectedStaticDigest : null,
      activeStaticManifestDigest: nonEmpty(activeStaticDigest) ? activeStaticDigest : null,
      staticManifestDigest: nonEmpty(activeStaticDigest) ? activeStaticDigest : null,
      staticManifestMatch,
      dynamicStateDigest: nonEmpty(dynamicStateDigest) ? dynamicStateDigest : null,
      releaseDigest: nonEmpty(releaseDigest) ? releaseDigest : null,
      changeEpoch: nonEmpty(active.changeEpoch) ? active.changeEpoch : null,
      pendingLogicalIds: activePendingIds ?? [],
      pendingLogicalIdsDigest: nonEmpty(activePendingDigest) ? activePendingDigest : null,
      state: partitionState,
    };
    try {
      assertSiteContentPartitionSnapshot(partitionSnapshot);
    } catch {
      add("release_partition_mismatch");
    }
  }
  const health: SiteContentHealthProjection = {
    publicReleaseId: active && nonEmpty(active.releaseId) ? active.releaseId : null,
    staticManifestMatch,
    releaseDigestPrefix: sha256Digest(releaseDigest) ? releaseDigest.slice(0, 19) : null,
    state: reasons.length > 0 ? "failure" : hasPending ? "updating" : "current",
    synchronizerDeployed,
    synchronizerInvocationFresh: heartbeatFresh && invocationFresh,
    queue: {
      pendingCount,
      oldestPendingAgeSeconds: boundedAge(queue.oldestPendingAgeSeconds),
      failedCount: boundedCount(queue.failedCount),
    },
    lastActivation: active && exactIsoTimestamp(active.activatedAt) ? active.activatedAt : null,
    rollbackAvailable: active?.rollbackAvailable === true,
  };
  return Object.freeze({
    health: Object.freeze(health),
    stopReasons: Object.freeze([...reasons]),
  });
}

type HealthResponseOptions = {
  forceDeep?: boolean;
  allowUnauthenticatedDeep?: boolean;
  includeSlo?: boolean;
  includeCache?: boolean;
  includeCoalescing?: boolean;
  includeSpend?: boolean;
  siteContentHealthInput?: SiteContentHealthInput;
};

export async function healthResponse(request: Request, options: HealthResponseOptions = {}) {
  const deep = options.forceDeep || new URL(request.url).searchParams.get("deep") === "1";
  const supabaseConfigured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  const openAIConfigured = Boolean(env.OPENAI_API_KEY);
  const checks: Record<string, "ok" | "missing" | "error" | "skipped" | "unauthorized"> = {
    supabaseConfig: supabaseConfigured ? "ok" : "missing",
    openaiConfig: openAIConfigured ? "ok" : env.RAG_PROVIDER_MODE === "offline" ? "skipped" : "missing",
  };
  let slo: AnswerSloSnapshot | null = null;
  let cache: CacheMetricsSnapshot | null = null;
  let coalescing: AnswerCoalescingMetricsSnapshot | null = null;
  let spend: SpendSnapshot | null = null;
  const siteContent = options.siteContentHealthInput ? classifySiteContentHealth(options.siteContentHealthInput) : null;

  if (deep) {
    const tokenAuthorized = allowDeepHealthProbe(request);
    if (!options.allowUnauthenticatedDeep && !tokenAuthorized) {
      checks.supabase = "unauthorized";
    } else {
      // Cache hit-rate is operator-gated internal telemetry (the in-process
      // hot-path half of the silent-degradation counters). Expose it only to a
      // genuinely token-authorized deep probe — never the unauthenticated
      // readiness endpoint, which exposes no diagnostic details — and only when
      // not explicitly suppressed. Reads a cumulative counter (no DB), so it is
      // available even in demo mode. Like `slo`, it never flips liveness.
      if (tokenAuthorized && options.includeCache !== false) {
        cache = cacheMetricsSnapshot();
      }
      if (tokenAuthorized && options.includeCoalescing !== false) {
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
          const health = await probeSupabaseHealth(admin);
          checks.supabase = health.ok ? "ok" : "error";
          if (health.ok && options.includeSlo !== false) {
            try {
              // Avoid recursively instantiating the full generated PostgREST
              // client type against the intentionally tiny SLO query surface.
              slo = await answerSloSnapshot(admin as unknown as SloProbeClient);
            } catch {
              slo = null;
            }
          }
          // Answer-generation spend, gated like `slo` (token-authorized deep probe
          // + healthy Supabase). Derives USD from already-recorded token counts and
          // a configurable price; errors are swallowed to null and never flip
          // liveness. Suppressed only when explicitly disabled.
          if (health.ok && tokenAuthorized && options.includeSpend !== false) {
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
        } catch {
          checks.supabase = "error";
        }
      } else {
        checks.supabase = "skipped";
      }
    }
  }

  const ready =
    !Object.values(checks).some((value) => value === "missing" || value === "error" || value === "unauthorized") &&
    siteContent?.health.state !== "failure";

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      demoMode: isDemoMode(),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      deploymentCommitSha: resolveDeploymentCommitSha(),
      checks,
      ...(slo ? { slo } : {}),
      ...(cache ? { cache } : {}),
      ...(coalescing ? { coalescing } : {}),
      ...(spend ? { spend } : {}),
      ...(siteContent ? { siteContent: siteContent.health } : {}),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
