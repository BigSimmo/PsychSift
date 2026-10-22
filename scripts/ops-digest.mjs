#!/usr/bin/env node
/**
 * ops-digest — render a one-screen operational summary from the live deep health
 * probe, for the six-hourly ops-digest workflow.
 *
 * The app already exposes rich signal at GET /api/health?deep=1 (SLO counters,
 * cache hit-rate, answer spend, degraded/truncation rates), but nothing surfaces
 * it proactively — a regression is only found when someone looks. This fetches
 * that probe and renders Markdown so the workflow can post it to a rolling issue.
 *
 * Config (all via env, so nothing is hardcoded):
 *   PROD_HEALTH_URL           base URL of the deployment (e.g. https://app.example)
 *                             OR the full health URL; the script appends
 *                             /api/health?deep=1 when only a base is given.
 *   HEALTH_DEEP_PROBE_SECRET  deep-probe token (sent as x-health-deep-token)
 *   OPS_DIGEST_TIMEOUT_MS     fetch timeout (default 20000)
 * Flags:
 *   --out <path>   also write the Markdown to a file (for the workflow to read)
 *
 * Always exits 0 after writing a digest — an unreachable/degraded app is itself
 * the report, not a script failure. Emits `status=ok|degraded|unreachable` and
 * `alerting=true|false` to $GITHUB_OUTPUT when present so the workflow can flag
 * the run without re-parsing.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import {
  ANSWER_QUALITY_THRESHOLDS,
  ANSWER_QUALITY_WINDOW_MINUTES,
  evaluateOperationalAlerts,
  summarizeOperationalAlerts,
} from "./lib/operational-alerts.mjs";

const allowedStatuses = new Set(["ok", "degraded", "unreachable", "unknown"]);
const allowedSeverities = new Set(["none", "unknown", "warning", "page"]);

export function normalizeOpsStatus(value) {
  return allowedStatuses.has(value) ? value : "unknown";
}

export function serializeGitHubOutputs(status, summary) {
  const safeStatus = normalizeOpsStatus(status);
  const safeSeverity = allowedSeverities.has(summary?.severity) ? summary.severity : "unknown";
  const safeSummary = {
    alerting: Boolean(summary?.alerting),
    severity: safeSeverity,
    count: Number.isInteger(summary?.count) && summary.count >= 0 ? summary.count : 0,
    codes: Array.isArray(summary?.codes)
      ? summary.codes.filter((code) => typeof code === "string" && /^OPS_[A-Z0-9_]+$/.test(code)).slice(0, 32)
      : [],
  };
  const singleLine = (value) => String(value).replace(/[\r\n\u2028\u2029]/g, " ");
  return [
    `status=${singleLine(safeStatus)}`,
    `alerting=${safeSummary.alerting}`,
    `severity=${singleLine(safeSeverity)}`,
    `alert_summary=${singleLine(JSON.stringify(safeSummary))}`,
    "",
  ].join("\n");
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const hourlyWindowMs = 60 * 60 * 1000;
const hourlyHistoryVersion = 1;
// The paging rule counts consecutive digest samples, not consecutive UTC hours. Scheduled runs are
// six hours apart, GitHub cron fires can arrive late or be dropped, and a manual run between them
// shares the same history file. Any positive gap up to two schedule intervals therefore joins the
// sequence; samples further apart than that are not treated as the same persistent failure.
const scheduleIntervalMs = 6 * hourlyWindowMs;
const maxConsecutiveSampleGapMs = 2 * scheduleIntervalMs;

function hourStart(instant) {
  const epoch = instant instanceof Date ? instant.getTime() : Date.parse(String(instant));
  if (!Number.isFinite(epoch)) return null;
  return new Date(Math.floor(epoch / hourlyWindowMs) * hourlyWindowMs).toISOString();
}

function canonicalRpcNames(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const names = Object.entries(value)
    .filter(([name, count]) => /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(name) && Number.isInteger(count) && count > 0)
    .map(([name]) => name)
    .sort();
  return Array.from(new Set(names));
}

function canonicalHistory(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== hourlyHistoryVersion || !Array.isArray(raw.windows)) return [];
  const byHour = new Map();
  for (const entry of raw.windows) {
    const hour = hourStart(entry?.hour);
    const rpcNames = Array.isArray(entry?.rpcNames)
      ? Array.from(
          new Set(
            entry.rpcNames.filter((name) => typeof name === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(name)),
          ),
        ).sort()
      : null;
    if (hour) byHour.set(hour, { hour, rpcNames });
  }
  return [...byHour.values()].sort((left, right) => left.hour.localeCompare(right.hour)).slice(-3);
}

export function updateHybridRpcHourlyEvidence(rawHistory, health, observedAt = new Date()) {
  const hour = hourStart(observedAt);
  if (!hour) return { history: { version: hourlyHistoryVersion, windows: [] }, repeatedRpcNames: [] };
  const prior = canonicalHistory(rawHistory).filter((entry) => entry.hour !== hour);
  const slo = health?.slo;
  const rpcNames = slo?.hybridRpcIdentityEvidenceComplete === true ? canonicalRpcNames(slo.hybridRpcErrorCounts) : null;
  const windows = [...prior, { hour, rpcNames }].sort((left, right) => left.hour.localeCompare(right.hour)).slice(-3);
  const lastThree = windows.slice(-3);
  const contiguous =
    lastThree.length === 3 &&
    lastThree.every((entry) => Array.isArray(entry.rpcNames)) &&
    lastThree.every((entry, index) => {
      if (index === 0) return true;
      const gapMs = Date.parse(entry.hour) - Date.parse(lastThree[index - 1].hour);
      return gapMs > 0 && gapMs <= maxConsecutiveSampleGapMs;
    });
  const repeatedRpcNames = contiguous
    ? lastThree[0].rpcNames.filter((name) => lastThree.every((entry) => entry.rpcNames.includes(name)))
    : [];
  return { history: { version: hourlyHistoryVersion, windows }, repeatedRpcNames };
}

function readHybridRpcHistory(path) {
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
export function resolveHealthUrl(raw) {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (/\/api\/health/.test(trimmed)) return trimmed;
  return `${trimmed}/api/health?deep=1`;
}

function pct(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—";
}

function usd(value) {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "—";
}

const storageCleanupRunbook = "docs/observability-slos.md#storage-cleanup-backlog";

function backlogCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * One digest line for the deep probe's `storageCleanup` block, or null when the probe did not
 * report it (older build, query error, or readiness-only response). Counts that are not
 * non-negative integers are treated as absent rather than rendered as zero.
 */
export function renderStorageCleanupBacklog(block, now = Date.now()) {
  if (!block || typeof block !== "object") return null;
  const pending = backlogCount(block.pending);
  const failed = backlogCount(block.failed);
  if (pending === null || failed === null) return null;
  // Older builds do not report expired claims; treat that as none.
  const expiredClaims = backlogCount(block.expiredClaims) ?? 0;
  const outstanding = pending + failed + expiredClaims;
  const oldestEpoch = typeof block.oldestOutstandingAt === "string" ? Date.parse(block.oldestOutstandingAt) : NaN;
  const oldest = Number.isFinite(oldestEpoch) ? new Date(oldestEpoch).toISOString() : null;
  // A `pending` row exists for the few seconds a delete is running, so only a failed row, or an
  // outstanding row older than an hour, means something is waiting for the manual drain.
  const stale = Number.isFinite(oldestEpoch) && now - oldestEpoch > 60 * 60 * 1000;
  const attention =
    failed > 0 || (outstanding > 0 && stale)
      ? `  ⚠ drain with \`npm run cleanup:storage\` ([runbook](${storageCleanupRunbook}))`
      : "";
  const expired = expiredClaims > 0 ? `, expired claims ${expiredClaims}` : "";
  return `**Storage cleanup backlog:** ${outstanding} outstanding (pending ${pending}, failed ${failed}${expired})${
    oldest ? ` · oldest ${oldest}` : ""
  }${attention}`;
}

/**
 * One digest line for the ingestion worker's intended state (audit EVAL-03). The worker has no
 * public address and the deep probe does not reach it, so the operator records a deliberate pause
 * in the repository variable INGESTION_WORKER_PAUSED. A pause is shown as paused — not healthy,
 * not an outage — and never raises an alert here; the ingestion autopilot alerts when an upload
 * waits more than 30 minutes without being claimed.
 */
export function renderIngestionWorkerState(value) {
  const state = String(value ?? "")
    .trim()
    .toLowerCase();
  if (state === "true") {
    return "**Ingestion worker:** ⏸ paused on purpose (repository variable INGESTION_WORKER_PAUSED=true). Uploaded documents are not processed until it is resumed. Not an outage: the ingestion autopilot alerts only if an upload waits more than 30 minutes.";
  }
  if (state === "false") return "**Ingestion worker:** expected to be running.";
  return "**Ingestion worker:** state not recorded (set repository variable INGESTION_WORKER_PAUSED to true or false).";
}

/**
 * Digest lines for one answer-SLO snapshot. `alertWindow` marks the snapshot the alert rules
 * judge: the trailing six-hour `sloTrailing` block, or the hourly `slo` from an older build.
 */
function renderAnswerWindow(s, { alertWindow }) {
  // A current build marks a failed trailing query explicitly; it is unknown, not an empty window.
  if (s.unavailable === true) {
    return [
      "",
      `**Answer quality** (trailing ${s.windowMinutes ?? "?"}m, the window alerts judge)`,
      "**Snapshot query failed—answer quality not assessed.**",
    ];
  }
  const expectedWindowMinutes = alertWindow && s.windowMinutes !== 60 ? ANSWER_QUALITY_WINDOW_MINUTES : 60;
  const noAnswerActivity = s.windowMinutes === expectedWindowMinutes && s.totalQueries === 0;
  const sloPct = (value) => (noAnswerActivity ? "N/A" : pct(value));
  const heading =
    alertWindow && s.windowMinutes === ANSWER_QUALITY_WINDOW_MINUTES
      ? `**Answer quality** (trailing ${s.windowMinutes}m, the window alerts judge)`
      : `**Answer SLO** (trailing ${s.windowMinutes ?? "?"}m)`;
  const emptyNote = !noAnswerActivity
    ? ""
    : alertWindow
      ? "**No answered queries observed—answer quality not assessed.**"
      : "No answered queries in the last 60 minutes.";
  const lowVolumeNote =
    alertWindow &&
    Number.isInteger(s.totalQueries) &&
    s.totalQueries > 0 &&
    s.totalQueries < ANSWER_QUALITY_THRESHOLDS.minimumQueries
      ? `Fewer than ${ANSWER_QUALITY_THRESHOLDS.minimumQueries} answers: source-gap, unsupported and latency-budget rates are not judged.`
      : "";
  const lines = [
    "",
    heading,
    emptyNote,
    lowVolumeNote,
    `- queries: ${s.totalQueries ?? 0}`,
    `- hybrid RPC errors: ${s.hybridRpcErrorQueries ?? 0} (${sloPct(s.hybridRpcErrorRate)})`,
    `- degraded/source-only: ${s.degradedQueries ?? 0} (${sloPct(s.degradedRate)})`,
    `- truncation fallbacks: ${s.truncationFallbackQueries ?? 0} (${sloPct(s.truncationFallbackRate)})`,
    `- timeout fallbacks: ${s.timeoutFallbackQueries ?? 0} (${sloPct(s.timeoutFallbackRate)})`,
    `- source gaps: ${s.sourceGapQueries ?? 0} (${sloPct(s.sourceGapRate)})`,
    `- unsupported: ${s.unsupportedQueries ?? 0} (${sloPct(s.unsupportedRate)})`,
  ];
  if (s.latencyP95MsByRouteMode && typeof s.latencyP95MsByRouteMode === "object" && !noAnswerActivity) {
    const routes = ["fast", "strong", "extractive"]
      .map((mode) => {
        const entry = s.latencyP95MsByRouteMode[mode];
        const p95 = typeof entry?.p95Ms === "number" ? `${(entry.p95Ms / 1000).toFixed(1)}s` : "—";
        return `${mode} ${p95} (n=${Number.isInteger(entry?.samples) ? entry.samples : 0})`;
      })
      .join(", ");
    lines.push(`- p95 latency: ${routes}${s.latencySampleTruncated ? " ⚠ sample capped" : ""}`);
  }
  return lines;
}

export function renderDigest(health, meta = {}) {
  const lines = [];
  const stamp = new Date().toISOString();
  const status = normalizeOpsStatus(health?.status ?? "unreachable");
  const badge =
    status === "ok"
      ? "🟢 ok"
      : status === "degraded"
        ? "🟠 degraded"
        : status === "unknown"
          ? "⚪ unknown"
          : "🔴 unreachable";
  lines.push(`### Ops digest — ${stamp}`, "", `**Service readiness:** ${badge}`);
  if (meta.error) lines.push("", `> Probe error: \`${meta.error}\``);
  // Independent of the app probe, so it is shown even when the probe did not answer.
  if (Object.hasOwn(meta, "ingestionWorkerPaused")) {
    lines.push(renderIngestionWorkerState(meta.ingestionWorkerPaused));
  }

  /**
   * WHICH BUILD THIS MEASURED, and when the container answered.
   *
   * The digest rendered readiness, SLO, cache and spend without ever saying what
   * was running, so a reader could not tell a healthy new deploy from a healthy
   * three-day-old one — which is precisely the state the site sat in for three
   * days while 24 rollbacks went unnoticed. The payload has carried
   * `deploymentCommitSha` all along (src/lib/health-response.ts:249) and nothing
   * read it.
   *
   * `stamp` above is render time. `health.timestamp` is when the container
   * answered. They differ by the probe round trip, and on a timeout only the
   * first exists — so an absent build line means the probe did not come back,
   * not that the deployment is unknown to us.
   */
  if (health?.deploymentCommitSha || health?.timestamp) {
    const sha = health.deploymentCommitSha ? `\`${String(health.deploymentCommitSha).slice(0, 12)}\`` : "unknown";
    const observed = health.timestamp ?? "not reported";
    lines.push(`**Build:** ${sha}  ·  **Container answered:** ${observed}`);
  }

  if (health) {
    if (typeof health.uptimeSeconds === "number") {
      const h = Math.floor(health.uptimeSeconds / 3600);
      lines.push(`**Uptime:** ${h}h  ·  **Demo mode:** ${health.demoMode ? "yes" : "no"}`);
    }
    if (health.checks) {
      const checks = Object.entries(health.checks)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      lines.push(`**Checks:** ${checks}`);
    }

    // Audit EVAL-02: alerts judge the trailing six-hour `sloTrailing` window when the probe
    // supplies it, so it is shown first and named as the alert window. The hourly block stays
    // because it feeds the hybrid-RPC identity history.
    const trailing = health.sloTrailing && typeof health.sloTrailing === "object" ? health.sloTrailing : null;
    if (trailing) lines.push(...renderAnswerWindow(trailing, { alertWindow: true }));
    if (health.slo) lines.push(...renderAnswerWindow(health.slo, { alertWindow: !trailing }));

    if (health.cache) {
      const c = health.cache;
      lines.push("", `**Cache:** ${c.hits ?? 0}/${c.lookups ?? 0} hits (${pct(c.hitRate)})`);
    }

    if (health.spend) {
      const sp = health.spend;
      const routes = Object.entries(sp.usdByRoute ?? {})
        .map(([r, v]) => `${r} ${usd(v)}`)
        .join(", ");
      lines.push(
        "",
        `**Spend** (trailing ${sp.windowMinutes ?? "?"}m): ${usd(sp.usd)} · answers ${sp.answers ?? 0}`,
        `- projected/day: ${usd(sp.projectedDailyUsd)}${
          sp.alertDailyUsdThreshold ? ` (threshold ${usd(sp.alertDailyUsdThreshold)})` : ""
        }${sp.alerting ? "  ⚠ OVER THRESHOLD" : ""}`,
        routes ? `- by route: ${routes}` : "",
        sp.sampleTruncated ? "- ⚠ sample truncated — figures are a lower bound" : "",
      );
    }

    // Audit F-10: failed storage deletions queue in storage_cleanup_jobs and are drained only
    // by the manual `npm run cleanup:storage`, so the backlog is shown here rather than nowhere.
    const backlog = renderStorageCleanupBacklog(health.storageCleanup);
    if (backlog) lines.push("", backlog);
  }

  const alerts = evaluateOperationalAlerts(health, meta);
  const alertSummary = summarizeOperationalAlerts(alerts);
  lines.push("", `**Alert state:** ${alertSummary.severity} (${alertSummary.count})`);
  for (const item of alerts) {
    const observed = item.observedValue === null ? "unknown" : String(item.observedValue);
    lines.push(
      `- **${item.severity.toUpperCase()} ${item.code}** — observed ${observed}; owner ${item.owner}; escalate ${item.escalationOwner}; [runbook](${item.runbook})${item.reason ? ` — ${item.reason}` : ""}`,
    );
  }

  lines.push("", "_Read-only deep-probe snapshot. Enable/adjust in `.github/workflows/ops-digest.yml`._");
  return lines.filter((l) => l !== "").join("\n") + "\n";
}

async function main() {
  const url = resolveHealthUrl(process.env.PROD_HEALTH_URL);
  const token = process.env.HEALTH_DEEP_PROBE_SECRET;
  const timeoutMs = Number.parseInt(process.env.OPS_DIGEST_TIMEOUT_MS ?? "20000", 10) || 20000;

  let health = null;
  let error;
  if (!url) {
    error = "PROD_HEALTH_URL not set";
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: token ? { "x-health-deep-token": token } : {},
        signal: controller.signal,
      });
      const text = await res.text();
      try {
        health = JSON.parse(text);
      } catch {
        error = `non-JSON response (HTTP ${res.status})`;
      }
    } catch (e) {
      error = e?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : (e?.message ?? String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  const historyPath = argValue("--history");
  const hourlyEvidence = updateHybridRpcHourlyEvidence(readHybridRpcHistory(historyPath), health);
  if (historyPath) writeFileSync(historyPath, JSON.stringify(hourlyEvidence.history) + "\n");

  const alertContext = {
    error,
    canaryStale: process.env.EVAL_CANARY_STALE === "true",
    canaryMessage: process.env.EVAL_CANARY_MESSAGE,
    ingestionWorkerPaused: process.env.INGESTION_WORKER_PAUSED,
    repeatedHybridRpcNames: hourlyEvidence.repeatedRpcNames,
  };
  const digest = renderDigest(health, alertContext);
  process.stdout.write(digest);
  const out = argValue("--out");
  if (out) writeFileSync(out, digest);

  const status = normalizeOpsStatus(health?.status ?? "unreachable");
  const alerts = evaluateOperationalAlerts(health, alertContext);
  const summary = summarizeOperationalAlerts(alerts);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, serializeGitHubOutputs(status, summary));
  }
  // Always exit 0 — the digest content carries the health signal.
  process.exit(0);
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  main();
}
