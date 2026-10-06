#!/usr/bin/env node
/**
 * probe-answer-timing.mjs — ask the live site one question and print where the time went.
 *
 * WHY THIS EXISTS. On 2026-09-17 the owner reported Answer mode slow on psychiatry.tools, from
 * Perth. Nothing in this repository could say where the seconds went. `docs/observability-slos.md`
 * states it plainly: "No production monitor computes an answer-latency percentile ... a breach is
 * invisible until an operator runs the query." The catalogue-latency audit of the previous day was
 * found the same way — by the owner, in a browser, seven days in.
 *
 * The data was already there. `/api/answer` returns a `Server-Timing` header naming every stage of
 * the request, built by `src/lib/server-timing.ts` and wired at `src/app/api/answer/route.ts`.
 * Nobody had read it, because reading it meant hand-running curl and interpreting a raw header.
 * This turns that into one command and a readable table.
 *
 * WHAT IT IS NOT. It is not a monitor. Nothing schedules it, no workflow calls it, and it joins no
 * verification chain. That is deliberate: `#TN512M` records that this repository already has more
 * working detection than it has attention, and says "do not add further monitoring checks" until a
 * red check reaches a human. An operator tool you run on purpose is a different class of thing, and
 * the manual-SQL section it is documented beside keeps its "not alerted" label.
 *
 * IT REFUSES TO RUN WITHOUT PERMISSION. Asking the live site a question spends OpenAI credit and
 * writes a telemetry row, so it is provider-backed under the API and provider confirmation boundary
 * in AGENTS.md. Following `scripts/check-github-shell-access.mjs`, no network call happens without
 * an explicit `--allow-provider`, and the refusal names the authorised command.
 *
 * The parsing and the reporting are pure functions, tested offline in
 * `tests/probe-answer-timing.test.ts`. The precedent is deliberate: the first version of the
 * deployment-freshness check measured the wrong thing and only a test caught it. A probe nobody can
 * test is a probe nobody can trust.
 */

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const allowProviderFlag = "--allow-provider";
const allowProviderEnv = "ALLOW_ANSWER_TIMING_PROBE";

/**
 * Plain-English label for each metric `/api/answer` emits, and how it nests.
 *
 * `group` matters for arithmetic, not decoration. The stages are NOT additive: `search` already
 * contains `rpc`, `embedding` and `rerank`, and `answer`/`total` are whole-request totals. Summing
 * the column would double-count, and a table that invites that is worse than no table.
 */
export const answerTimingStages = [
  { name: "auth", label: "Sign-in check", group: "preamble" },
  { name: "ratelimit", label: "Rate limit", group: "preamble" },
  { name: "scope", label: "Choosing which documents are in scope", group: "preamble" },
  { name: "search", label: "Searching the documents", group: "phase" },
  { name: "rpc", label: "database queries", group: "within-search" },
  { name: "embedding", label: "turning the question into a vector", group: "within-search" },
  { name: "rerank", label: "re-ranking the passages", group: "within-search" },
  { name: "generation", label: "Writing the answer", group: "phase" },
  { name: "answer", label: "Answer engine, end to end", group: "total" },
  { name: "total", label: "Whole request, measured on the server", group: "total" },
];

/**
 * Parse a `Server-Timing` header into entries.
 *
 * Hand-written rather than split(", ") because `desc` is a quoted string and
 * `sanitizeDescription` in `src/lib/server-timing.ts` strips CR, LF, quote and backslash but NOT
 * commas — so a description may legally contain the very delimiter a naive split would trust.
 * No answer route emits `desc` today; this parser does not depend on that staying true.
 *
 * @param {string|null|undefined} header
 * @returns {Array<{name: string, durMs: number|null}>}
 */
export function parseServerTiming(header) {
  if (typeof header !== "string" || header.trim() === "") return [];
  const parts = [];
  let current = "";
  let inQuotes = false;
  for (const character of header) {
    if (character === '"') {
      inQuotes = !inQuotes;
      current += character;
      continue;
    }
    if (character === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);

  const entries = [];
  for (const part of parts) {
    const segments = part.split(";");
    const name = segments[0]?.trim();
    if (!name) continue;
    let durMs = null;
    for (const segment of segments.slice(1)) {
      const match = /^\s*dur\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*$/.exec(segment);
      // A malformed or absent dur leaves the entry present with a null duration rather than
      // dropping it. A stage that reported no number is a fact worth showing, not an absence.
      if (match) durMs = Number(match[1]);
    }
    entries.push({ name, durMs });
  }
  return entries;
}

/**
 * Turn parsed entries into the report.
 *
 * @param {Array<{name: string, durMs: number|null}>} entries
 * @param {number|null} clientTotalMs  wall clock measured here, including network both ways
 */
export function summariseAnswerTiming(entries, clientTotalMs = null) {
  const byName = new Map(entries.map((entry) => [entry.name, entry.durMs]));
  const value = (name) => {
    const found = byName.get(name);
    return typeof found === "number" && Number.isFinite(found) ? found : null;
  };

  const totalMs = value("total");
  const rows = answerTimingStages
    .filter((stage) => byName.has(stage.name))
    .map((stage) => ({
      ...stage,
      durMs: value(stage.name),
      // Share is only meaningful against the server total, and only for stages that are not
      // themselves a total.
      share: totalMs && totalMs > 0 && stage.group !== "total" ? value(stage.name) / totalMs : null,
    }));

  const preambleMs = rows
    .filter((row) => row.group === "preamble" && typeof row.durMs === "number")
    .reduce((sum, row) => sum + row.durMs, 0);

  // The dominant phase is chosen among the three that do not overlap: everything before the
  // search, the search itself, and writing the answer.
  const candidates = [
    {
      label: "everything before the search starts",
      durMs: rows.some((row) => row.group === "preamble") ? preambleMs : null,
    },
    { label: "searching the documents", durMs: value("search") },
    { label: "writing the answer", durMs: value("generation") },
  ].filter((candidate) => typeof candidate.durMs === "number");
  const dominant = candidates.length
    ? candidates.reduce((slowest, candidate) => (candidate.durMs > slowest.durMs ? candidate : slowest))
    : null;

  return {
    ok: rows.length > 0,
    rows,
    preambleMs: rows.some((row) => row.group === "preamble") ? preambleMs : null,
    totalMs,
    clientTotalMs,
    dominant,
    // Network and queuing: what the caller waited for, minus what the server says it spent.
    overheadMs:
      typeof clientTotalMs === "number" && typeof totalMs === "number" ? Math.max(0, clientTotalMs - totalMs) : null,
  };
}

const seconds = (ms) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "—");
const percent = (share) => (typeof share === "number" ? `${Math.round(share * 100)}%` : "");

/** @param {ReturnType<typeof summariseAnswerTiming>} summary */
export function renderAnswerTimingReport(summary) {
  if (!summary.ok) {
    return "The response carried no Server-Timing header. /api/answer emits one; check the URL and that the request reached the app rather than a proxy.";
  }
  const lines = ["Where the answer time went", ""];
  for (const row of summary.rows) {
    const indent = row.group === "within-search" ? "    " : "  ";
    const label = row.group === "total" ? row.label : `${indent}${row.label}`;
    lines.push(`${label.padEnd(46)}${seconds(row.durMs).padStart(8)}  ${percent(row.share)}`);
  }
  if (typeof summary.clientTotalMs === "number") {
    lines.push(
      "",
      `${"Measured from here, including network".padEnd(46)}${seconds(summary.clientTotalMs).padStart(8)}`,
    );
    if (typeof summary.overheadMs === "number") {
      lines.push(`${"  of which network and queueing".padEnd(46)}${seconds(summary.overheadMs).padStart(8)}`);
    }
  }
  lines.push(
    "",
    "The stages are nested, not additive: searching already contains the database, vector and re-ranking lines.",
  );
  if (summary.dominant) {
    lines.push(`Slowest phase: ${summary.dominant.label}, ${seconds(summary.dominant.durMs)}.`);
  }
  return lines.join("\n");
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env  only the opt-in key is read, so the caller need
 *   not supply a whole ProcessEnv — a test asserting the refusal should not have to fake NODE_ENV.
 */
export function providerAccessAuthorized(argv = process.argv, env = process.env) {
  return argv.includes(allowProviderFlag) || env[allowProviderEnv] === "true";
}

async function main() {
  if (!providerAccessAuthorized()) {
    console.error(
      [
        "Refusing to probe the live site without confirmation.",
        "This asks psychiatry.tools one real question: it spends OpenAI credit and writes a telemetry row.",
        `Re-run with ${allowProviderFlag} (or ${allowProviderEnv}=true) once that is approved.`,
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const domainUrl = process.env.LIVE_DOMAIN_URL || "https://psychiatry.tools";
  const query = process.env.ANSWER_PROBE_QUERY || "What FBC threshold should stop clozapine?";
  const timeoutMs = Number(process.env.ANSWER_PROBE_TIMEOUT_MS || 120_000);

  const url = new URL("/api/answer", domainUrl);
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Drain the body before stopping the clock, so the measurement covers the whole response rather
  // than the headers alone.
  await response.arrayBuffer().catch(() => null);
  const clientTotalMs = Date.now() - startedAt;

  console.log(`${url.href} — HTTP ${response.status}`);
  if (response.status !== 200) {
    console.log(`The request did not succeed, so any timing below describes a failed request.`);
    process.exitCode = 1;
  }
  const summary = summariseAnswerTiming(parseServerTiming(response.headers.get("server-timing")), clientTotalMs);
  console.log(renderAnswerTimingReport(summary));
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`Answer timing probe failed: ${error.message}`);
    process.exitCode = 1;
  });
}
