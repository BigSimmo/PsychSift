/**
 * Authenticated, staging-only ward-round soak test for the PsychSift app tier.
 *
 * The requests contain fixed synthetic, non-PHI queries. Search and answer
 * routes can still write normal telemetry/cache data, so this is not a
 * read-only database exercise. See docs/audit/capacity-review.md §4.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const PRODUCTION_MARKERS = ["psychiatry.tools", "sjrfecxgysukkwxsowpy"];

export type SoakArgs = {
  target: string;
  confirmStaging: boolean;
  users: number;
  durationS: number;
  rampS: number;
  thinkMs: number;
  answerShare: number;
  timeoutMs: number;
  bearer?: string;
  forbidHosts: string[];
};

export type RequestSample = {
  endpoint: "search" | "answer";
  status: number;
  latencyMs: number;
  timedOut: boolean;
};

export const soakThresholds = {
  searchP95Ms: 3_000,
  answerP95Ms: 25_000,
  maxNonRateLimitedFailureRate: 0.01,
  maxRateLimitedRate: 0.05,
} as const;

function usage(): never {
  console.log(
    [
      "Usage: npx tsx scripts/soak-test.ts --target <staging-origin> --confirm-staging [options]",
      "",
      "Options:",
      "  --target <url>          Plain HTTPS origin of the STAGING app (required)",
      "  --confirm-staging       Acknowledge the target is staging (required)",
      "  --users <n>             Virtual users (default 30)",
      "  --duration-s <n>        Steady-state duration in seconds (default 300)",
      "  --ramp-s <n>            Ramp-up window in seconds (default 60)",
      "  --think-ms <n>          Mean think time between requests (default 15000)",
      "  --answer-share <0..1>   Fraction of requests that are answers (default 0.25)",
      "  --timeout-ms <n>        Per-request timeout (default 60000)",
      "  --forbid-host <host>    Extra host substring to refuse (repeatable)",
      "",
      "Set SOAK_BEARER_TOKEN in the environment. Tokens are refused on the command line.",
    ].join("\n"),
  );
  process.exit(1);
}

export function parseSoakTargetOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--target must be a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("--target must use HTTPS.");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("--target must be a plain HTTPS origin without credentials, path, query, or fragment.");
  }
  return url.origin;
}

export function parseSoakArgs(argv: string[]): SoakArgs {
  const args: SoakArgs = {
    target: "",
    confirmStaging: false,
    users: 30,
    durationS: 300,
    rampS: 60,
    thinkMs: 15_000,
    answerShare: 0.25,
    timeoutMs: 60_000,
    bearer: process.env.SOAK_BEARER_TOKEN?.trim() || undefined,
    forbidHosts: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") usage();
    if (token === "--bearer" || token.startsWith("--bearer=")) {
      throw new Error("Refusing --bearer: set SOAK_BEARER_TOKEN so secrets do not appear in process arguments.");
    }
    if (token === "--confirm-staging") {
      args.confirmStaging = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) continue;
    if (token === "--target") args.target = value;
    if (token === "--users") args.users = Number.parseInt(value, 10);
    if (token === "--duration-s") args.durationS = Number.parseInt(value, 10);
    if (token === "--ramp-s") args.rampS = Number.parseInt(value, 10);
    if (token === "--think-ms") args.thinkMs = Number.parseInt(value, 10);
    if (token === "--answer-share") args.answerShare = Number.parseFloat(value);
    if (token === "--timeout-ms") args.timeoutMs = Number.parseInt(value, 10);
    if (token === "--forbid-host") args.forbidHosts.push(value.toLowerCase());
  }

  if (!args.target) throw new Error("Missing --target. This script never assumes a default target.");
  if (!args.confirmStaging) throw new Error("Refusing to run without --confirm-staging.");
  args.target = parseSoakTargetOrigin(args.target);
  if (!Number.isInteger(args.users) || args.users < 1 || args.users > 500) {
    throw new Error("--users must be an integer between 1 and 500.");
  }
  if (!Number.isInteger(args.durationS) || args.durationS < 0) throw new Error("--duration-s must be non-negative.");
  if (!Number.isInteger(args.rampS) || args.rampS < 0) throw new Error("--ramp-s must be non-negative.");
  if (!Number.isFinite(args.answerShare) || args.answerShare < 0 || args.answerShare > 1) {
    throw new Error("--answer-share must be between 0 and 1.");
  }
  return args;
}

export function assertTargetIsNotProduction(args: Pick<SoakArgs, "target" | "forbidHosts">) {
  const host = new URL(args.target).hostname.toLowerCase();
  const markers = [...PRODUCTION_MARKERS, ...args.forbidHosts].map((marker) => marker.toLowerCase());
  const matched = markers.find((marker) => marker && host.includes(marker));
  if (matched) throw new Error(`Refusing target ${host}: matches forbidden production marker "${matched}".`);
}

export function assertSoakAuthenticationMode(args: Pick<SoakArgs, "bearer">) {
  if (!args.bearer) {
    throw new Error("Authenticated release evidence requires SOAK_BEARER_TOKEN; anonymous soak evidence is refused.");
  }
}

export function soakStagingFetch(input: string | URL | Request, init: RequestInit = {}) {
  return fetch(input, { ...init, redirect: "error" });
}

const fallbackQueries = [
  "clozapine monitoring requirements",
  "lithium toxicity management",
  "acute dystonia treatment",
  "venlafaxine discontinuation symptoms",
  "sodium valproate in pregnancy",
  "serotonin syndrome recognition",
  "rapid tranquillisation protocol",
  "metformin renal dosing",
  "warfarin reversal steps",
  "delirium screening tools",
];

function loadQueries(): string[] {
  const fixturePath = join(process.cwd(), "scripts", "fixtures", "rag-retrieval-golden.json");
  if (!existsSync(fixturePath)) return fallbackQueries;
  try {
    const parsed: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
    if (!Array.isArray(parsed)) return fallbackQueries;
    const queries = parsed
      .map((entry) => (entry && typeof entry === "object" ? (entry as { query?: unknown }).query : null))
      .filter((query): query is string => typeof query === "string" && query.length > 0);
    return queries.length > 0 ? queries : fallbackQueries;
  } catch {
    return fallbackQueries;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredThink(meanMs: number) {
  return meanMs * (0.5 + Math.random());
}

function percentile(sorted: number[], fraction: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export async function issueSoakRequest(
  args: SoakArgs,
  endpoint: "search" | "answer",
  query: string,
): Promise<RequestSample> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await soakStagingFetch(new URL(`/api/${endpoint}`, args.target), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(args.bearer ? { authorization: `Bearer ${args.bearer}` } : {}),
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    await response.arrayBuffer();
    return { endpoint, status: response.status, latencyMs: Date.now() - startedAt, timedOut: false };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { endpoint, status: 0, latencyMs: Date.now() - startedAt, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

async function runVirtualUser(
  args: SoakArgs,
  userIndex: number,
  queries: string[],
  endAtMs: number,
  samples: RequestSample[],
) {
  await sleep((args.rampS * 1000 * userIndex) / Math.max(args.users, 1));
  while (Date.now() < endAtMs) {
    const query = queries[Math.floor(Math.random() * queries.length)];
    const endpoint = Math.random() < args.answerShare ? "answer" : "search";
    samples.push(await issueSoakRequest(args, endpoint, query));
    const remaining = endAtMs - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(jitteredThink(args.thinkMs), remaining));
  }
}

export function summarizeSoakEndpoint(samples: RequestSample[], endpoint: "search" | "answer") {
  const scoped = samples.filter((sample) => sample.endpoint === endpoint);
  const ok = scoped.filter((sample) => sample.status >= 200 && sample.status < 400);
  const rateLimited = scoped.filter((sample) => sample.status === 429);
  const authFailures = scoped.filter((sample) => sample.status === 401 || sample.status === 403);
  const failed = scoped.filter((sample) => sample.status === 0 || (sample.status >= 400 && sample.status !== 429));
  const latencies = ok.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  return {
    endpoint,
    total: scoped.length,
    ok: ok.length,
    rateLimited: rateLimited.length,
    authFailures: authFailures.length,
    failed: failed.length,
    timedOut: scoped.filter((sample) => sample.timedOut).length,
    p50: percentile(latencies, 0.5),
    p90: percentile(latencies, 0.9),
    p95: percentile(latencies, 0.95),
    max: latencies.at(-1) ?? 0,
  };
}

export function evaluateSoakResults(samples: RequestSample[]) {
  const summaries = [summarizeSoakEndpoint(samples, "search"), summarizeSoakEndpoint(samples, "answer")];
  const total = samples.length;
  const hardFailures = summaries.reduce((sum, summary) => sum + summary.failed, 0);
  const rateLimited = summaries.reduce((sum, summary) => sum + summary.rateLimited, 0);
  const authFailures = summaries.reduce((sum, summary) => sum + summary.authFailures, 0);
  const failureRate = total > 0 ? hardFailures / total : 1;
  const rateLimitedRate = total > 0 ? rateLimited / total : 1;
  const failures: string[] = [];
  for (const summary of summaries) {
    if (summary.ok === 0) failures.push(`/api/${summary.endpoint} had no successful responses`);
  }
  if (failureRate >= soakThresholds.maxNonRateLimitedFailureRate) {
    failures.push(`non-429 failure rate ${(failureRate * 100).toFixed(2)}% must remain below 1%`);
  }
  if (rateLimitedRate > soakThresholds.maxRateLimitedRate) {
    failures.push(`429 rate ${(rateLimitedRate * 100).toFixed(2)}% exceeded 5%`);
  }
  if (authFailures > 0) failures.push(`${authFailures} authentication failure(s) observed`);
  const search = summaries[0];
  const answer = summaries[1];
  if (search.p95 > soakThresholds.searchP95Ms) failures.push(`search p95 ${search.p95}ms exceeded 3000ms`);
  if (answer.p95 > soakThresholds.answerP95Ms) failures.push(`answer p95 ${answer.p95}ms exceeded 25000ms`);
  return { summaries, total, failureRate, rateLimitedRate, authFailures, failures, passed: failures.length === 0 };
}

async function main() {
  const args = parseSoakArgs(process.argv.slice(2));
  assertTargetIsNotProduction(args);
  assertSoakAuthenticationMode(args);
  const queries = loadQueries();
  console.log(`Soak target: ${args.target}`);
  console.log(
    `Profile: ${args.users} users, ramp ${args.rampS}s, steady ${args.durationS}s, ` +
      `answer share ${Math.round(args.answerShare * 100)}%, think ~${args.thinkMs}ms, ${queries.length} queries.`,
  );
  console.log("Auth: bearer token supplied through SOAK_BEARER_TOKEN.");

  const endAtMs = Date.now() + (args.rampS + args.durationS) * 1000;
  const samples: RequestSample[] = [];
  await Promise.all(
    Array.from({ length: args.users }, (_, userIndex) => runVirtualUser(args, userIndex, queries, endAtMs, samples)),
  );

  const result = evaluateSoakResults(samples);
  console.log("\nResults:");
  for (const summary of result.summaries) {
    console.log(
      `  /api/${summary.endpoint}: n=${summary.total} ok=${summary.ok} 429=${summary.rateLimited} ` +
        `failed=${summary.failed} timeouts=${summary.timedOut}`,
    );
    console.log(
      `    latency ms (ok only): p50=${summary.p50} p90=${summary.p90} p95=${summary.p95} max=${summary.max}`,
    );
  }
  console.log(
    `\nTotal requests: ${result.total}; non-429 failure rate: ${(result.failureRate * 100).toFixed(2)}%; ` +
      `429 rate: ${(result.rateLimitedRate * 100).toFixed(2)}%.`,
  );
  if (!result.passed) throw new Error(`Soak acceptance failed:\n- ${result.failures.join("\n- ")}`);
  console.log("PASS: authenticated staging soak met the release thresholds.");
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
