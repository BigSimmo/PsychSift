#!/usr/bin/env node
/**
 * run-lighthouse-budget — measure this build's routes with Lighthouse and grade the
 * result against the committed baseline (`scripts/check-lighthouse-budget.mjs`).
 *
 * Builds and serves an isolated production app the same way the Playwright runner
 * does: offline provider mode, demo corpus, inert loopback Supabase URL, a safe
 * project port, and an isolated `.next-playwright/<run-id>/dist` output directory
 * (that exact prefix is required by the boot guard in `next.config.ts` — see the
 * run-root comment below). That matters for two reasons — the production boot guard
 * only permits this profile when credentials are absent, and demo mode makes the
 * measured pages deterministic so a number movement means the app changed rather
 * than the corpus.
 *
 * Lighthouse itself comes from `npx --yes lighthouse@<pinned>`, matching
 * `.github/workflows/live-web-vitals.yml`. It is deliberately not a devDependency:
 * it pulls a large tree that nothing else in the repo imports, and pinning at the
 * call site keeps the two Lighthouse entry points on one version.
 *
 * A per-route Lighthouse failure is NOT downgraded to a warning here (unlike the
 * live workflow, which is grading a flaky public network): a route that produced no
 * report is incomplete evidence, and the grader fails closed on it.
 *
 * A cell that produced no measurement AT ALL — no report file, invalid JSON, or a
 * report carrying only a `runtimeError` such as Lighthouse's own `NO_NAVSTART` — gets
 * exactly ONE announced retry first (`lighthouse-measurement-outcome.mjs` draws that
 * line). That is not a softening: a run that never started measured nothing about this
 * diff, and if the retry also produces nothing the grader still fails closed. Every
 * retry is reported to the run summary and written to `retries.txt` whether or not it
 * recovered, so a chronically flaky route cannot hide behind a green run. A cell that
 * DID measure outside its numeric budget gets exactly two targeted confirmations.
 * Only that cell is repeated, all three reports are retained in the artifact, and
 * the required gate uses their majority so neither one noisy spike nor one lucky
 * recheck decides the result.
 *
 * Build reuse: when LIGHTHOUSE_REUSE_BUILD_ROOT_ID names a `.next-playwright/<id>`
 * build root that already holds a finished build (CI downloads the same run's shared
 * `playwright-next-build-<run id>` artifact there, built from the same checkout), this
 * runner serves that build instead of compiling its own copy. Both are the isolated
 * offline/demo `next build --webpack` with the same environment overrides
 * (tests/check-lighthouse-budget.test.ts pins the parity). A missing build fails
 * closed rather than silently rebuilding, and a reused root is never deleted here.
 *
 * Flags: --dry-run (print the plan and exit), --update (refresh the baseline),
 *        --keep (leave reports in place), --dir <path>.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { childProcessExitCode, childProcessFailureSummary } from "./child-process-result.mjs";
import { offlineTestEnvironment } from "./test-environment.mjs";
import { acquireHeavyRunLock } from "./test-run-lock.mjs";
import { removePathSync } from "./retryable-fs.mjs";
import {
  compareToLighthouseBudget,
  loadBudget,
  majorityBreachDecision,
  numericBreachConfirmationRuns,
  readReports,
} from "./check-lighthouse-budget.mjs";
import { measurementFailureReason } from "./lighthouse-measurement-outcome.mjs";
import {
  deadlineAfter,
  lighthouseBuildTimeoutMs,
  LIGHTHOUSE_MEASUREMENT_SUITE_TIMEOUT_MS,
  LIGHTHOUSE_PROCESS_TIMEOUT_MS,
  LIGHTHOUSE_SERVER_READY_TIMEOUT_MS,
  processTimeoutMs,
  remainingMs,
} from "./lighthouse-time-budget.mjs";
import { routeWithLighthouseParams } from "./lib/lighthouse-route-params.mjs";
import {
  appName,
  circularProjectPortRange,
  isReservedDevPort,
  localProjectId,
  stableProjectPort,
} from "../src/lib/local-server-utils.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const update = argv.includes("--update");
const keep = argv.includes("--keep");
const dirIndex = argv.indexOf("--dir");
const reportDirectory = path.resolve(projectRoot, dirIndex >= 0 ? (argv[dirIndex + 1] ?? "lighthouse") : "lighthouse");

// `next.config.ts` guards NEXT_DIST_DIR/NEXT_TSCONFIG_PATH against an allowlist —
// `.next-playwright/<run-id>/{dist,tsconfig.json}` — so a production build can only
// ever write to an owned, throwaway output. That guard is deliberate and is NOT
// widened for this runner: the prefix means "isolated ephemeral build output", which
// is exactly what this is. The run id carries `lighthouse-` so a stray directory is
// still attributable to the runner that made it, and `[a-z0-9-]+` accepts it.
const reuseBuildRootId = process.env.LIGHTHOUSE_REUSE_BUILD_ROOT_ID?.trim() || null;
if (reuseBuildRootId && !/^[A-Za-z0-9-]+$/.test(reuseBuildRootId)) {
  console.error("LIGHTHOUSE_REUSE_BUILD_ROOT_ID must contain only letters, numbers, and hyphens.");
  process.exit(1);
}
const runId = reuseBuildRootId ?? `lighthouse-${process.pid}-${Date.now()}`;
const relativeRunRoot = `.next-playwright/${runId}`;
const absoluteRunRoot = path.join(projectRoot, relativeRunRoot);
const relativeDistDir = `${relativeRunRoot}/dist`;
const relativeTsConfigPath = `${relativeRunRoot}/tsconfig.json`;

/**
 * Layout-shift audits, newest Lighthouse naming first.
 *
 * `layout-shifts` is the Lighthouse 12 audit and the only one that itemises a
 * shift per element. `layout-shift-elements` is its pre-12 name, kept so a
 * pinned-version rollback still attributes. `cumulative-layout-shift` is the
 * metric audit itself: it carries `debugdata` rather than nodes, so it is the
 * last resort and usually contributes nothing but the score.
 */
const LAYOUT_SHIFT_AUDIT_IDS = ["layout-shifts", "layout-shift-elements", "cumulative-layout-shift"];

/**
 * Print the elements Lighthouse blamed for layout shift, for every measured
 * route, when grading has already failed.
 *
 * Purely diagnostic: it reads the reports this runner just wrote and writes to
 * the log. It never grades, never mutates a report, and swallows every error —
 * a malformed report must not convert a graded failure into a crash, because
 * the grader's exit code is the verdict and this only annotates it.
 */
function reportLayoutShiftAttribution(directory) {
  try {
    if (!existsSync(directory)) return;
    const lines = [];
    for (const file of readdirSync(directory).sort()) {
      if (!file.endsWith(".json") || file === "summary.json") continue;
      let audits;
      try {
        audits = JSON.parse(readFileSync(path.join(directory, file), "utf8"))?.audits;
      } catch {
        continue;
      }
      if (!audits) continue;
      const cell = file.replace(/\.json$/, "");
      const cls = audits["cumulative-layout-shift"]?.numericValue;
      const items = LAYOUT_SHIFT_AUDIT_IDS.flatMap((id) =>
        Array.isArray(audits[id]?.details?.items) ? audits[id].details.items : [],
      );
      const nodes = items
        .flatMap((item) => [item, ...(Array.isArray(item?.subItems?.items) ? item.subItems.items : [])])
        .map((item) => ({
          score: typeof item?.score === "number" ? item.score : null,
          node: item?.node ?? item?.extra ?? null,
        }))
        .filter((entry) => entry.node)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 6);
      if (nodes.length === 0 && !(cls > 0)) continue;
      lines.push(`${cell}  cls=${typeof cls === "number" ? cls.toFixed(4) : "n/a"}`);
      if (nodes.length === 0) {
        lines.push("    (no element attribution in this report)");
        continue;
      }
      for (const { score, node } of nodes) {
        const where = node.selector || node.nodeLabel || node.path || "(unnamed node)";
        const snippet = String(node.snippet ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 160);
        lines.push(`    ${score === null ? "     -" : score.toFixed(4)}  ${where}`);
        if (snippet) lines.push(`             ${snippet}`);
      }
      // The selector alone says WHICH element moved, not WHY. Lighthouse's own
      // root-cause sub-items (unsized media, a web font swapping, an injected
      // iframe, a running animation) and the shift's timing live in the raw
      // item, and naming the element was not enough to close `#TYZK23` — the
      // first attributed run pointed at `.pwa-notice-stack`, and the obvious
      // reading of that (it paints before the shell decides its geometry) was
      // measured and refuted. So print the item itself for the worst cell.
      if (cls > 0.05 && items.length > 0) {
        const worst = items.reduce((a, b) => ((b?.score ?? 0) > (a?.score ?? 0) ? b : a), items[0]);
        lines.push(`    raw: ${JSON.stringify(worst).slice(0, 1400)}`);
      }
    }
    if (lines.length === 0) return;
    console.log("::group::lighthouse layout-shift attribution");
    for (const line of lines) console.log(line);
    console.log("::endgroup::");
  } catch {
    // Diagnostics must never mask the graded result.
  }
}

/**
 * Refuse to recursively delete anything but a runner-owned reports directory.
 *
 * `--dir` is documented and user-supplied, and `path.resolve` happily accepts `.`,
 * `..` or an absolute path — so the report-clearing step below would erase the
 * repository or unrelated files on a typo. This is the last check before an
 * irreversible delete, so it fails closed: inside the repository, not the root
 * itself, and never inside a tracked source tree.
 */
const PROTECTED_TOP_LEVEL = new Set([
  ".git",
  ".github",
  "docs",
  "node_modules",
  "public",
  "scripts",
  "src",
  "supabase",
  "tests",
  "worker",
]);

function assertOwnedReportDirectory(directory) {
  const relative = path.relative(projectRoot, directory);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`--dir must name a directory inside the repository, not ${directory}.`);
  }
  const [top] = relative.split(path.sep);
  if (PROTECTED_TOP_LEVEL.has(top)) {
    throw new Error(`--dir must not point inside ${top}/ — refusing to clear it. Got ${relative}.`);
  }
  return relative;
}

/** Filename-safe slug, matching scripts/summarise-web-vitals.mjs `routeSlug`. */
function slugFor(route) {
  return route.replace(/^\//, "").replaceAll("/", "-") || "root";
}

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => socket.destroy(void resolve(true)));
    socket.once("error", () => resolve(false));
    setTimeout(() => socket.destroy(void resolve(false)), 500);
  });
}

async function findFreePort(startPort) {
  for (const port of circularProjectPortRange(startPort)) {
    if (isReservedDevPort(port)) continue;
    if (!(await canConnect(port, "127.0.0.1"))) return port;
  }
  throw new Error("No free Lighthouse server port found in the configured project range.");
}

function get(url, timeoutMs) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(response.statusCode === 200 ? body : null));
    });
    request.on("timeout", () => request.destroy(void resolve(null)));
    request.on("error", () => resolve(null));
  });
}

/** Whether /api/local-project-id identifies THIS project on a safe local origin. */
function isThisProject(body) {
  try {
    const payload = JSON.parse(body);
    return (
      payload.appName === appName &&
      payload.projectId === localProjectId(projectRoot) &&
      payload.localServer?.safeLocalOrigin === true
    );
  } catch {
    return false;
  }
}

async function waitForServer(baseUrl, server, timeoutMs) {
  const deadline = deadlineAfter(timeoutMs);
  while (remainingMs(deadline) > 0) {
    if (server.exitCode !== null || server.signalCode) {
      throw new Error("Lighthouse-owned Next server exited before it became ready.");
    }
    // Same identity check the rest of the repo's tooling uses, so this can never
    // attach to another project's server on a shared machine.
    const requestTimeout = Math.min(5_000, remainingMs(deadline));
    // Node treats a zero HTTP timeout as "disabled". The deadline can elapse
    // between the loop condition and this request, so never pass zero through.
    if (requestTimeout === 0) break;
    const body = await get(`${baseUrl}/api/local-project-id`, requestTimeout);
    // A 200 with any body is not proof this is our app: another service could have
    // taken the port between the availability probe and Next binding it, and
    // Lighthouse would then measure the wrong application. Verify identity the way
    // scripts/playwright-base-url.ts does before accepting readiness.
    if (body && isThisProject(body)) return;
    const delayMs = Math.min(1_000, remainingMs(deadline));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timed out waiting for the Lighthouse-owned server at ${baseUrl}.`);
}

let server = null;
let released = false;
let lock = null;

function stopOwnedProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function cleanup() {
  if (released) return;
  released = true;
  if (server?.pid) {
    try {
      process.kill(process.platform === "win32" ? server.pid : -server.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  // A reused build root belongs to whoever produced it (the CI artifact download, or
  // a developer's kept Playwright build); only a root this runner created is removed.
  if (!reuseBuildRootId) {
    try {
      removePathSync(absoluteRunRoot, { recursive: true });
    } catch {
      /* best effort */
    }
  }
  lock?.release();
}

process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.once("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
process.once("exit", cleanup);

const budget = loadBudget();
const routes = budget.routes ?? [];
const strategies = budget.strategies ?? ["mobile", "desktop"];

/**
 * Pinned in `lighthouse-budget.json` so this runner and the live-domain workflow
 * share one version; `tests/check-lighthouse-budget.test.ts` fails if they drift.
 * The env override exists for a deliberate one-off comparison, not for CI.
 */
const LIGHTHOUSE_VERSION = process.env.LIGHTHOUSE_VERSION ?? budget.lighthouseVersion ?? "12.8.2";

function resolveNpxInvocation() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    const npxCli = path.join(path.dirname(npmExecPath), "npx-cli.js");
    if (existsSync(npxCli)) {
      return { command: process.env.npm_node_execpath ?? process.execPath, prefixArgs: [npxCli] };
    }
  }

  if (process.platform === "win32") {
    throw new Error(
      "run-lighthouse-budget: npm_execpath did not identify npx-cli.js on Windows; run through `npm run verify:lighthouse`.",
    );
  }
  return { command: "npx", prefixArgs: [] };
}

if (routes.length === 0) {
  console.error("run-lighthouse-budget: lighthouse-budget.json lists no routes to measure.");
  process.exit(1);
}

if (dryRun) {
  console.log("run-lighthouse-budget plan");
  console.log(`  lighthouse    npx --yes lighthouse@${LIGHTHOUSE_VERSION}`);
  console.log(`  reports       ${path.relative(projectRoot, reportDirectory)}/<strategy>-<slug>.json`);
  console.log(`  enforce       ${Boolean(budget.enforce)}`);
  console.log(`  baseline      ${budget.baseline ? `${Object.keys(budget.baseline).length} run(s)` : "none recorded"}`);
  console.log(`  build         ${reuseBuildRootId ? `reuse ${relativeDistDir}` : `isolated ${relativeDistDir}`}`);
  for (const strategy of strategies) {
    for (const route of routes)
      console.log(`  measure       ${strategy} ${route} -> ${strategy}-${slugFor(route)}.json`);
  }
  process.exit(0);
}

// Invoke npm's JavaScript CLI through Node when available. Direct child-process
// launches of `npx`/`npx.cmd` fail with ENOENT/EINVAL on current Windows Node,
// while this path is identical across shells and preserves argument boundaries.
const npxInvocation = resolveNpxInvocation();

try {
  // Lighthouse drives a real browser against a production build, so it takes the
  // same exclusive admission as Playwright rather than racing a concurrent build.
  lock = acquireHeavyRunLock({ projectRoot, command: "run-lighthouse-budget" });

  const port = await findFreePort(stableProjectPort(projectRoot));
  const baseUrl = `http://localhost:${port}`;
  mkdirSync(absoluteRunRoot, { recursive: true });
  // Validated before the recursive delete, never after.
  assertOwnedReportDirectory(reportDirectory);
  // Clear any reports retained by a previous --keep run. Otherwise a route that
  // fails to measure this time leaves the stale file in place, and the grader would
  // treat the evidence as complete — or bake it into a refreshed baseline.
  removePathSync(reportDirectory, { recursive: true });
  mkdirSync(reportDirectory, { recursive: true });
  if (reuseBuildRootId) {
    // Fail closed: a requested reuse that finds no finished build must not quietly
    // measure something else or spend the build time it was meant to save.
    for (const required of [
      path.join(absoluteRunRoot, "dist", "BUILD_ID"),
      path.join(absoluteRunRoot, "tsconfig.json"),
    ]) {
      if (!existsSync(required)) {
        throw new Error(
          `LIGHTHOUSE_REUSE_BUILD_ROOT_ID=${reuseBuildRootId} but ${path.relative(projectRoot, required)} is missing; ` +
            "download the shared Playwright Next build first or unset it to build here.",
        );
      }
    }
  }
  // The isolated build needs its own tsconfig for the same reason the Playwright
  // runner writes one: `@/*` must still resolve from the repository root while the
  // build output lives under the run root.
  if (!reuseBuildRootId)
    writeFileSync(
      path.join(absoluteRunRoot, "tsconfig.json"),
      `${JSON.stringify(
        {
          // The root config explicitly includes `.next/types`. An isolated build
          // must not inherit stale route validators from an earlier root build;
          // Next still validates the generated types in this run's dist tree.
          extends: "../../tsconfig.typecheck.json",
          compilerOptions: {
            // TypeScript 6 deprecates baseUrl (TS5101). Next 16.3+ typechecks this
            // isolated config during `next build`, so silence until paths migrate.
            ignoreDeprecations: "6.0",
            baseUrl: "../..",
            paths: { "@/*": ["src/*"] },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

  const offlineEnv = offlineTestEnvironment(lock.environment ?? process.env, {
    PORT: String(port),
    // Same local-http flag the Playwright runner sets (src/lib/security-headers.ts
    // drops HSTS/upgrade-insecure-requests on http://localhost). It is baked into the
    // static headers at build time, so setting it here keeps this runner's own build
    // identical to the shared Playwright build it reuses in CI, and a baseline refresh
    // (which builds here) comparable with the gate (which reuses that build).
    PLAYWRIGHT_BASE_URL: baseUrl,
    NEXT_DIST_DIR: relativeDistDir,
    NEXT_TSCONFIG_PATH: relativeTsConfigPath,
    NODE_ENV: "production",
    PLAYWRIGHT_OFFLINE_MODE: "true",
    NEXT_PUBLIC_MOCKUPS_ENABLED: "false",
  });

  const buildTimeoutMs = lighthouseBuildTimeoutMs({
    platform: process.platform,
    ci: process.env.CI !== undefined,
  });
  if (reuseBuildRootId) {
    console.log(`Reusing the shared production build for Lighthouse (${relativeRunRoot})`);
  } else {
    console.log(`Building isolated production app for Lighthouse (${relativeRunRoot})`);
    const build = spawnSync(process.execPath, ["--max-old-space-size=8192", nextBin, "build", "--webpack"], {
      cwd: projectRoot,
      env: offlineEnv,
      stdio: "inherit",
      timeout: buildTimeoutMs,
    });
    if (childProcessExitCode(build) !== 0) {
      throw new Error(`Lighthouse production build failed (${childProcessFailureSummary(build)}).`);
    }
  }

  console.log(`Starting isolated production server at ${baseUrl}`);
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    env: offlineEnv,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  await waitForServer(baseUrl, server, LIGHTHOUSE_SERVER_READY_TIMEOUT_MS);

  // Warm up runner and routes before collecting graded runs to eliminate cold-start timing bimodality
  // across runners (especially /documents/search on GitHub Actions runners).
  console.log("Warming up routes before measurement...");
  const warmupRoutes = Array.from(new Set([...routes, "/documents/search"]));
  for (const route of warmupRoutes) {
    try {
      await get(`${baseUrl}${routeWithLighthouseParams(route)}`, 15_000);
    } catch {
      // Warmup is best-effort; failures do not block the suite
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const chromePath = process.env.CHROME_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "";
  const failures = [];
  const retried = [];
  const cellsByRun = new Map();

  const suiteDeadline = deadlineAfter(LIGHTHOUSE_MEASUREMENT_SUITE_TIMEOUT_MS);
  console.log(`Lighthouse measurement suite has ${LIGHTHOUSE_MEASUREMENT_SUITE_TIMEOUT_MS / 60_000} minutes.`);

  const measure = (strategy, route, output, timeoutMs) =>
    new Promise((resolve) => {
      const child = spawn(
        npxInvocation.command,
        [
          ...npxInvocation.prefixArgs,
          "--yes",
          `lighthouse@${LIGHTHOUSE_VERSION}`,
          `${baseUrl}${routeWithLighthouseParams(route)}`,
          "--output=json",
          `--output-path=${output}`,
          `--preset=${strategy === "desktop" ? "desktop" : "perf"}`,
          "--only-categories=performance",
          "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage",
          "--max-wait-for-load=60000",
          "--quiet",
        ],
        {
          cwd: projectRoot,
          env: { ...offlineEnv, ...(chromePath ? { CHROME_PATH: chromePath } : {}) },
          stdio: "inherit",
          // Own the npx/Lighthouse/Chrome tree so a per-cell timeout can SIGTERM
          // the whole group. spawnSync's timeout only stops the npx wrapper.
          detached: process.platform !== "win32",
        },
      );

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      child.on("error", (error) => finish({ status: 1, error }));
      child.on("close", (code, signal) => finish({ status: code, signal }));

      const timer = setTimeout(() => {
        stopOwnedProcessTree(child);
      }, timeoutMs);
    });

  const readIfPresent = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);

  for (const strategy of strategies) {
    for (const route of routes) {
      const cell = `${strategy} ${route}`;
      const output = path.join(reportDirectory, `${strategy}-${slugFor(route)}.json`);
      cellsByRun.set(`${strategy}-${slugFor(route)}`, { strategy, route, cell, output });
      const firstAttemptTimeout = processTimeoutMs(suiteDeadline, LIGHTHOUSE_PROCESS_TIMEOUT_MS);
      if (firstAttemptTimeout === 0) {
        failures.push(cell);
        console.log(`::warning::lighthouse ${cell} was not measured: the 28-minute suite deadline expired`);
        continue;
      }
      console.log(`Measuring ${cell}`);
      let result = await measure(strategy, route, output, firstAttemptTimeout);
      let reason = measurementFailureReason(childProcessExitCode(result), readIfPresent(output));

      if (!reason && childProcessExitCode(result) !== 0) {
        console.log(
          `::warning::lighthouse ${cell} wrote a parseable report but ${childProcessFailureSummary(result)} after measurement; grading the report`,
        );
      }

      if (reason) {
        // ONE retry, and it is announced. A cell that never started measured nothing
        // about this diff, so treating it as a regression is wrong — but so is
        // treating it as a pass, which is why nothing below is downgraded. If the
        // retry also produces no measurement the report stays missing or errored and
        // the grader's incompleteBudgetEvidence still fails closed regardless of
        // `enforce`. The retry is reported either way, so a chronically flaky route
        // cannot hide behind a green run.
        const retryTimeout = processTimeoutMs(suiteDeadline, LIGHTHOUSE_PROCESS_TIMEOUT_MS);
        if (retryTimeout === 0) {
          failures.push(cell);
          console.log(
            `::warning::lighthouse ${cell} produced no measurement (${reason}); the suite deadline expired before retry`,
          );
          continue;
        }
        console.log(`::warning::lighthouse ${cell} produced no measurement (${reason}); retrying once`);
        // Never leave the first attempt's file behind: a runtimeError report would
        // otherwise be graded, or baked into a refreshed baseline, if the retry fails
        // before writing.
        removePathSync(output);
        result = await measure(strategy, route, output, retryTimeout);
        const after = measurementFailureReason(childProcessExitCode(result), readIfPresent(output));
        if (!after && childProcessExitCode(result) !== 0) {
          console.log(
            `::warning::lighthouse ${cell} wrote a parseable report on retry but ${childProcessFailureSummary(result)} after measurement; grading the report`,
          );
        }
        retried.push(`${cell} (${reason}${after ? ` -> still ${after}` : " -> recovered"})`);
        reason = after;
      }

      if (reason) {
        failures.push(cell);
        console.log(
          `::warning::lighthouse ${cell} failed after one retry (${reason}; ${childProcessFailureSummary(result)})`,
        );
      }
    }
  }

  // Emitted whether or not the retry recovered: a retry is a fact about the evidence
  // and belongs in the run summary and the artifact, not only in the scrollback.
  if (retried.length > 0) {
    const line = `lighthouse retried ${retried.length} cell(s): ${retried.join("; ")}`;
    console.log(`::warning::${line}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n> Lighthouse ${line}\n`);
    }
    // Deliberately .txt, not .json: `readReports` in check-lighthouse-budget.mjs
    // globs *.json and skips only summary.json, so a JSON sidecar here would be
    // parsed as a Lighthouse report and become a phantom row named `retries`.
    writeFileSync(path.join(reportDirectory, "retries.txt"), `${retried.join("\n")}\n`, "utf8");
  }

  if (failures.length > 0) console.log(`::warning::lighthouse failed for ${failures.join(", ")}`);

  // Local Lighthouse numbers are noisy enough that one isolated spike should not
  // block a merge, while one lucky recheck must not clear a real regression. Confirm
  // only cells with a real numeric breach; never repeat cells that passed. The
  // initial sample plus two confirmations form a majority decision. If either
  // confirmation is unavailable or incomplete, retain the initial failing report so
  // the required gate fails closed. All samples stay in the artifact for diagnosis.
  const confirmations = [];
  if (!update && failures.length === 0) {
    const breachRuns = numericBreachConfirmationRuns(readReports(reportDirectory), budget);
    if (breachRuns.length > 0) {
      const confirmationDirectory = path.join(reportDirectory, "confirmations");
      mkdirSync(confirmationDirectory, { recursive: true });
      for (const run of breachRuns) {
        const target = cellsByRun.get(run);
        if (!target) continue;
        const initial = path.join(confirmationDirectory, `${run}-initial.json`);
        copyFileSync(target.output, initial);
        const samples = [true];
        let unavailable = null;
        console.log(`::warning::lighthouse ${target.cell} breached its numeric budget; collecting two confirmations`);
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const confirmation = path.join(confirmationDirectory, `${run}-confirmation-${attempt}.json`);
          const timeoutMs = processTimeoutMs(suiteDeadline, LIGHTHOUSE_PROCESS_TIMEOUT_MS);
          if (timeoutMs === 0) {
            unavailable = "suite deadline expired";
            break;
          }
          const result = await measure(target.strategy, target.route, confirmation, timeoutMs);
          const reason = measurementFailureReason(childProcessExitCode(result), readIfPresent(confirmation));
          if (reason) {
            unavailable = reason;
            break;
          }
          copyFileSync(confirmation, target.output);
          const comparison = compareToLighthouseBudget(readReports(reportDirectory), budget);
          if (comparison.incomplete.length > 0) {
            unavailable = `incomplete evidence: ${comparison.incomplete.join("; ")}`;
            break;
          }
          samples.push(comparison.breaches.some((breach) => breach.run === run));
        }

        const decision = majorityBreachDecision(samples);
        if (unavailable || !decision) {
          copyFileSync(initial, target.output);
          confirmations.push(`${target.cell} (confirmation unavailable: ${unavailable ?? "incomplete sample set"})`);
          continue;
        }

        if (decision.breached) copyFileSync(initial, target.output);
        confirmations.push(
          `${target.cell} (${decision.breached ? "confirmed regression" : "transient first measurement"}; ` +
            `${decision.breachCount}/${decision.sampleCount} samples breached)`,
        );
      }
    }
  }

  if (confirmations.length > 0) {
    const line = `lighthouse evaluated ${confirmations.length} numeric breach cell(s): ${confirmations.join("; ")}`;
    console.log(`::warning::${line}`);
    writeFileSync(path.join(reportDirectory, "confirmations.txt"), `${confirmations.join("\n")}\n`, "utf8");
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n> ${line}\n`);
  }

  // --require-reports: this runner OWNS the directory and has just tried to measure
  // every route, so an empty directory means every Lighthouse invocation failed (e.g.
  // Chrome could not launch). That must fail rather than grade as success.
  const gradeArgs = [
    "--dir",
    path.relative(projectRoot, reportDirectory),
    "--require-reports",
    ...(update ? ["--update"] : []),
  ];
  const grade = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "check-lighthouse-budget.mjs"), ...gradeArgs],
    {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  // A failing CLS cell used to be a bare number: the grader prints
  // `mobile-root cls +0.207 vs baseline` and nothing about WHICH element moved,
  // so every investigation had to download the retained artifact — and ledger
  // `#TYZK23` stalled precisely there, because the shift is bistable and fires
  // only on CI (four local configurations, up to 20x CPU throttling and a
  // throttled network, all measured 0.000). The report already carries the
  // answer; print it into the job log so a red gate names its own cause.
  // Log-only: it never changes the verdict, and it runs before the reports are
  // cleared for a non-`--keep` run.
  if (childProcessExitCode(grade) !== 0) reportLayoutShiftAttribution(reportDirectory);

  if (!keep) removePathSync(reportDirectory, { recursive: true });
  const exitCode = childProcessExitCode(grade);
  cleanup();
  process.exit(exitCode);
} catch (error) {
  cleanup();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
