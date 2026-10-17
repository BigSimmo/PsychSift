#!/usr/bin/env node
/**
 * ops-digest — render a one-screen operational summary from the live deep health
 * probe, for the daily ops-digest workflow.
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
import { evaluateOperationalAlerts, summarizeOperationalAlerts } from "./lib/operational-alerts.mjs";

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
      // Scheduled runs are six hours apart, and a manual run between them shares the same history
      // file, so any positive whole-hour gap up to six hours still counts as consecutive evidence.
      return gapMs > 0 && gapMs <= 6 * hourlyWindowMs;
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

    if (health.slo) {
      const s = health.slo;
      const noAnswerActivity = s.windowMinutes === 60 && s.totalQueries === 0;
      const sloPct = (value) => (noAnswerActivity ? "N/A" : pct(value));
      lines.push(
        "",
        "**Answer SLO** (trailing " + (s.windowMinutes ?? "?") + "m)",
        noAnswerActivity ? "**No answered queries observed—answer quality not assessed.**" : "",
        `- queries: ${s.totalQueries ?? 0}`,
        `- hybrid RPC errors: ${s.hybridRpcErrorQueries ?? 0} (${sloPct(s.hybridRpcErrorRate)})`,
        `- degraded/source-only: ${s.degradedQueries ?? 0} (${sloPct(s.degradedRate)})`,
        `- truncation fallbacks: ${s.truncationFallbackQueries ?? 0} (${sloPct(s.truncationFallbackRate)})`,
        `- timeout fallbacks: ${s.timeoutFallbackQueries ?? 0} (${sloPct(s.timeoutFallbackRate)})`,
      );
    }

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
