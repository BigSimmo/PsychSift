#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { childProcessExitCode, childProcessFailureSummary } from "./child-process-result.mjs";
import { assertPlaywrightBrowsersReady } from "./playwright-browser-preflight.mjs";
import { removePathSync } from "./retryable-fs.mjs";
import { offlineTestEnvironment } from "./test-environment.mjs";
import { acquireHeavyRunLock } from "./test-run-lock.mjs";
import {
  appName,
  circularProjectPortRange,
  isReservedDevPort,
  localProjectId,
  stableProjectPort,
} from "../src/lib/local-server-utils.mjs";

if (Number(process.versions.node.split(".")[0]) !== 24) {
  console.error(`PsychSift Playwright checks require Node 24.x. Current runtime: ${process.versions.node}.`);
  process.exit(1);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightBin = path.join(projectRoot, "node_modules", "playwright", "cli.js");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const identityPath = "/api/local-project-id";
const startupTimeoutMs = 180_000;
const missingErrorComponentsNeedle = "missing required error components";
const routeSmokePaths = [
  "/",
  "/applications",
  "/?mode=tools",
  "/documents/search?mode=documents",
  "/forms/transport-crisis-form",
];
const playwrightArgs = process.argv.slice(2);
const explicitProjectRequested = playwrightArgs.some(
  (argument) => argument === "--project" || argument.startsWith("--project="),
);
const mockupProjectRequested =
  !explicitProjectRequested ||
  playwrightArgs.some(
    (argument, index) =>
      argument === "--project=chromium-mockups" ||
      (argument === "--project" && playwrightArgs[index + 1] === "chromium-mockups"),
  );

// Fail loud on missing browser binaries before the heavy lock or production build.
// Otherwise launch failures surface as "N failed" product tests and are easy to misread
// when a caller pipes output without `pipefail` (outstanding-issues #120).
// A build-only run (CI's shared Playwright build) exits before any browser starts, so it
// needs no browser and its job does not install one; every lane that runs tests still checks.
const browserPreflight =
  process.env.PLAYWRIGHT_BUILD_ONLY?.trim() === "true"
    ? { checked: [] }
    : assertPlaywrightBrowsersReady(playwrightArgs);
const preinstalledChromium = browserPreflight.checked.find(
  (entry) => entry.source === "preinstalled container Chromium (PLAYWRIGHT_BROWSERS_PATH)",
);
if (preinstalledChromium && !process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = preinstalledChromium.path;
  console.error(
    `[playwright] Managed Chromium is unavailable; using the preinstalled container browser at ${preinstalledChromium.path}.`,
  );
}

const requestedRunId = process.env.PLAYWRIGHT_BUILD_ROOT_ID?.trim();
if (requestedRunId && !/^[a-z0-9-]+$/i.test(requestedRunId)) {
  console.error("PLAYWRIGHT_BUILD_ROOT_ID must contain only letters, numbers, and hyphens.");
  process.exit(1);
}
const keepBuildRootValue = process.env.PLAYWRIGHT_KEEP_BUILD_ROOT?.trim();
if (keepBuildRootValue && keepBuildRootValue !== "true") {
  console.error('PLAYWRIGHT_KEEP_BUILD_ROOT must be unset or exactly "true".');
  process.exit(1);
}
const keepBuildRoot = keepBuildRootValue === "true";
if (keepBuildRoot && !requestedRunId) {
  console.error("PLAYWRIGHT_KEEP_BUILD_ROOT requires PLAYWRIGHT_BUILD_ROOT_ID.");
  process.exit(1);
}
const runId = requestedRunId || `${process.pid}-${Date.now()}`;
const relativeRunRoot = `.next-playwright/${runId}`;
const absoluteRunRoot = path.join(projectRoot, relativeRunRoot);
const relativeDistDir = `${relativeRunRoot}/dist`;
const relativeTsConfigPath = `${relativeRunRoot}/tsconfig.json`;
const configuredWaitTimeoutMs = Number(process.env.HEAVY_RUN_WAIT_TIMEOUT_MS);
const waitTimeoutMs = Number.isFinite(configuredWaitTimeoutMs) ? configuredWaitTimeoutMs : undefined;
const ADMISSION_BUSY_EXIT = 75;
const ADMISSION_BUSY_MARKER = "DATABASE_HEAVY_RUN_ADMISSION_BUSY";
// Match only the coordinator's actual capacity/timeout messages (test-run-lock.mjs
// busyMessage() and the initializing-coordinator branch) — not every error that
// merely mentions "Database heavyweight", such as an inherited-lease mismatch or a
// coordinator-directory setup failure. Those are configuration bugs, not admission
// contention, and must keep failing with the ordinary exit 1 below.
const ADMISSION_BUSY_PATTERN =
  /^(?:Database focused-test capacity is full|Another Database heavyweight command is active|A Database heavyweight coordinator is being initialized\b.*retry shortly\.)/;

let lock;
try {
  lock = acquireHeavyRunLock({
    projectRoot,
    command: `playwright ${playwrightArgs.join(" ")}`,
    ...(waitTimeoutMs === undefined ? {} : { waitTimeoutMs }),
  });
} catch (error) {
  const message = String(error?.message ?? error);
  if (ADMISSION_BUSY_PATTERN.test(message)) {
    console.error(ADMISSION_BUSY_MARKER);
    console.error(`Playwright did not run: ${message}`);
    console.error("Wait for the active heavyweight run to finish, then retry this command.");
    process.exit(ADMISSION_BUSY_EXIT);
  }
  console.error(message);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canListenOnHost(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve(error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL"));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

function canConnectToHost(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function canListen(port) {
  for (const host of ["127.0.0.1", "localhost", "::1"]) if (await canConnectToHost(port, host)) return false;
  for (const host of ["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"]) {
    if (!(await canListenOnHost(port, host))) return false;
  }
  return true;
}

async function findFreePort(startPort) {
  for (const port of circularProjectPortRange(startPort)) {
    if (!isReservedDevPort(port) && (await canListen(port))) return port;
  }
  throw new Error("No free Playwright server port found in the configured project range.");
}

function request(url, { json = false, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    const pending = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 400) return resolve(null);
        if (!json) return resolve(body);
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    pending.on("timeout", () => {
      pending.destroy();
      resolve(null);
    });
    pending.on("error", () => resolve(null));
  });
}

function isVerifiedProjectPayload(payload) {
  return (
    payload?.appName === appName &&
    payload?.projectId === localProjectId(projectRoot) &&
    payload?.localServer?.safeLocalOrigin === true
  );
}

async function waitForServer(baseUrl, server) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    // Read from the child itself, so the launch failure reported is always that server's own.
    if (server.launchError) {
      throw new Error(`Playwright-owned Next server failed to launch: ${server.launchError.message}`);
    }
    if (server.exitCode !== null || server.signalCode) {
      throw new Error(
        `Playwright-owned Next server exited before readiness (${server.exitCode !== null ? `code ${server.exitCode}` : `signal ${server.signalCode}`}).`,
      );
    }
    const payload = await request(`${baseUrl}${identityPath}`, {
      json: true,
      timeoutMs: 5000,
    });
    if (isVerifiedProjectPayload(payload)) {
      let healthy = true;
      for (const smokePath of routeSmokePaths) {
        // request() returns null on transport/status failure, or a string body on
        // 2xx/3xx (including empty redirect bodies from legacy route handlers).
        const body = await request(`${baseUrl}${smokePath}`);
        if (body === null || body.includes(missingErrorComponentsNeedle)) {
          healthy = false;
          break;
        }
      }
      if (healthy) return;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for the Playwright-owned PsychSift server at ${baseUrl}.`);
}

/**
 * One `next start` from this run's isolated build, on one port, with one environment.
 *
 * The launch shape — detached process group, inherited stdio, and the per-child `launchError`
 * `waitForServer` reads — lives in one place.
 */
function startIsolatedServer(serverPort, env) {
  const child = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(serverPort)], {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  child.once("error", (error) => {
    child.launchError = error;
  });
  return child;
}

/**
 * Runs a child to completion without blocking the event loop, so the heavy-run lease
 * heartbeat (a setInterval in test-run-lock.mjs) keeps refreshing owner.json during
 * long builds and test runs. Resolves with a spawnSync-shaped result.
 */
function runChild(args, { capture = false, ...options } = {}) {
  return new Promise((resolve) => {
    const result = { status: null, signal: null, error: undefined, stdout: "", stderr: "" };
    let child;
    try {
      child = spawn(process.execPath, args, { ...options, stdio: capture ? "pipe" : "inherit" });
      activeChild = child;
    } catch (error) {
      resolve({ ...result, error });
      return;
    }
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        result.stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        result.stderr += chunk;
      });
    }
    child.once("error", (error) => {
      result.error = error;
      // A child that never started may not emit "close"; resolving twice is harmless.
      if (child.pid === undefined) resolve(result);
    });
    child.once("close", (status, signal) => {
      // A launch failure reports a negative errno as the status; keep it a failure.
      result.status = result.error ? null : status;
      result.signal = signal;
      resolve(result);
    });
  });
}

function stopOwnedProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

let server;
// The build or test child currently running, so a signal-driven cleanup does not release the
// lease and leave it running unsupervised.
let activeChild;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) activeChild.kill("SIGTERM");
    stopOwnedProcessTree(server);
    if (!keepBuildRoot) {
      removePathSync(absoluteRunRoot, { recursive: true });
      try {
        rmdirSync(path.dirname(absoluteRunRoot));
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
      }
    } else {
      console.log(`Keeping Playwright build root for cache reuse (${relativeRunRoot})`);
    }
  } catch (error) {
    console.error(`Playwright cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    lock.release();
  }
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

// This isolated run's tsconfig.json (below) cannot simply inherit the root
// tsconfig.json's `exclude` — see the comment on `include`/`exclude` at its call
// site for why the whole include/exclude pair must be redeclared rather than left
// unset. But redeclaring `exclude` as a second hand-typed copy of the root's list
// is exactly the shape that has gone stale before: two near-identical lists where
// only one gets a fix. Derive it from the root config instead, so there is only
// one list to maintain — this reads the root config through TypeScript's own
// JSONC-tolerant parser (tsconfig.json allows comments; a plain JSON.parse would
// break on them) and prefixes each root-relative entry with the `../../` this
// isolated run root needs, then appends only the entries genuinely specific to
// this isolated build (currently just `.next/**`, justified above).
function deriveIsolatedRunExclude(rootProjectRoot, isolatedRunExtraEntries) {
  const rootTsconfigPath = path.join(rootProjectRoot, "tsconfig.json");
  const { config, error } = ts.readConfigFile(rootTsconfigPath, (file) => readFileSync(file, "utf8"));
  if (error) {
    throw new Error(
      `Could not parse ${rootTsconfigPath} while deriving the isolated Playwright run's tsconfig exclude list: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
    );
  }
  const rootExclude = config?.exclude;
  if (!Array.isArray(rootExclude) || rootExclude.length === 0) {
    throw new Error(
      `${rootTsconfigPath} has no non-empty "exclude" array; the isolated Playwright run's tsconfig cannot derive one from it.`,
    );
  }
  const derivedEntries = rootExclude.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.startsWith("/") || entry.startsWith(".")) {
      throw new Error(
        `${rootTsconfigPath} "exclude" entry ${JSON.stringify(entry)} is not a plain root-relative pattern; the isolated Playwright run's tsconfig cannot safely rewrite it to "../../".`,
      );
    }
    return `../../${entry}`;
  });
  return [...derivedEntries, ...isolatedRunExtraEntries];
}

try {
  const port = await findFreePort(stableProjectPort(projectRoot));
  const baseUrl = `http://127.0.0.1:${port}`;
  mkdirSync(absoluteRunRoot, { recursive: true });
  writeFileSync(
    path.join(absoluteRunRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        extends: "../../tsconfig.json",
        compilerOptions: {
          // TypeScript 6 deprecates baseUrl (TS5101). Next 16.3+ typechecks this
          // isolated config during `next build`, so silence until paths migrate.
          ignoreDeprecations: "6.0",
          baseUrl: "../..",
          paths: { "@/*": ["src/*"] },
        },
        // Declaring include/exclude here (rather than leaving them unset and
        // inheriting the root tsconfig.json's) is deliberate. TypeScript resolves
        // an extended config's *inherited* relative include/exclude entries
        // against the repo root, so an unset include here would still resolve
        // "**/*.ts" and ".next/dev/types/**/*.ts" against the shared top-level
        // .next/ directory — not this isolated run's own NEXT_DIST_DIR output
        // under `dist/`. That pulls stale/foreign route types from whatever the
        // top-level .next happens to contain (a prior `npm run dev` or `npm run
        // build`) into this run's typecheck. Excluding the repo-root .next/ and
        // pointing at this run's own dist/types + dist/dev/types keeps the
        // isolated build's typecheck scoped to itself (outstanding-issues #210).
        // `include` stays hand-declared for that reason. `exclude` does not: it is
        // derived from the root tsconfig.json's own "exclude" (deriveIsolatedRunExclude,
        // above) plus this isolated build's own `.next/**` entry, so the two configs
        // cannot silently diverge on the entries they share.
        include: [
          "../../next-env.d.ts",
          "../../**/*.ts",
          "../../**/*.tsx",
          "../../**/*.mts",
          "dist/types/**/*.ts",
          "dist/dev/types/**/*.ts",
        ],
        exclude: deriveIsolatedRunExclude(projectRoot, ["../../.next/**"]),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const offlineEnv = offlineTestEnvironment(lock.environment, {
    PORT: String(port),
    PLAYWRIGHT_BASE_URL: baseUrl,
    NEXT_DIST_DIR: relativeDistDir,
    NEXT_TSCONFIG_PATH: relativeTsConfigPath,
    NODE_ENV: "production",
    PLAYWRIGHT_OFFLINE_MODE: "true",
    NEXT_PUBLIC_MOCKUPS_ENABLED: mockupProjectRequested ? "true" : "false",
  });
  const reuseBuild = process.env.PLAYWRIGHT_REUSE_BUILD?.trim() === "true";
  const buildOnly = process.env.PLAYWRIGHT_BUILD_ONLY?.trim() === "true";
  const distDirAbsolute = path.join(projectRoot, relativeDistDir);
  const distReady = (() => {
    try {
      return existsSync(distDirAbsolute) && existsSync(path.join(distDirAbsolute, "BUILD_ID"));
    } catch {
      return false;
    }
  })();

  if (reuseBuild && !distReady) {
    throw new Error(
      `PLAYWRIGHT_REUSE_BUILD=true but ${relativeDistDir} is missing a usable Next build (expected BUILD_ID).`,
    );
  }

  if (reuseBuild && distReady) {
    console.log(`Reusing isolated production Playwright build (${relativeRunRoot})`);
  } else {
    console.log(`Building isolated production Playwright app (${relativeRunRoot})`);

    const buildResult = await runChild(["--max-old-space-size=8192", nextBin, "build", "--webpack"], {
      cwd: projectRoot,
      env: offlineEnv,
      capture: true,
    });
    const buildExitCode = childProcessExitCode(buildResult);
    if (buildExitCode !== 0) {
      if (buildResult.stdout) {
        console.error(`[playwright] build stdout:\n${buildResult.stdout}`);
      }
      if (buildResult.stderr) {
        console.error(`[playwright] build stderr:\n${buildResult.stderr}`);
      }
      const combinedOutput = `${buildResult.stdout ?? ""}\n${buildResult.stderr ?? ""}`;
      if (
        combinedOutput.includes("EBUSY") ||
        combinedOutput.includes("EPERM") ||
        combinedOutput.includes("resource busy or locked") ||
        buildResult.error?.code === "EBUSY" ||
        buildResult.error?.code === "EPERM"
      ) {
        console.error(
          `[playwright] directory lock contention detected in ${relativeRunRoot}. Another process may be accessing or locking this directory.`,
        );
      }
      const memory = process.memoryUsage();
      console.error(
        `[playwright] build diagnostics: status=${buildResult.status}, signal=${buildResult.signal ?? "none"}, error=${buildResult.error?.message ?? "none"}, memory(rss=${Math.round(memory.rss / (1024 * 1024))}MB, heapTotal=${Math.round(memory.heapTotal / (1024 * 1024))}MB, heapUsed=${Math.round(memory.heapUsed / (1024 * 1024))}MB)`,
      );
      throw new Error(`Playwright production build failed (${childProcessFailureSummary(buildResult)}).`);
    }
  }

  if (buildOnly) {
    if (!keepBuildRoot) {
      throw new Error(
        "PLAYWRIGHT_BUILD_ONLY=true requires PLAYWRIGHT_KEEP_BUILD_ROOT=true so CI can upload the build.",
      );
    }
    console.log(`Playwright build-only complete (${relativeRunRoot}); skipping servers/tests.`);
    cleanup();
    // Propagate build status via childProcessExitCode (failures already threw above).
    process.exit(childProcessExitCode({ status: 0, signal: null }));
  }

  console.log(`Starting isolated production Playwright server at ${baseUrl} (${relativeRunRoot})`);

  server = startIsolatedServer(port, offlineEnv);
  await waitForServer(baseUrl, server);

  const result = await runChild([playwrightBin, "test", ...playwrightArgs], {
    cwd: projectRoot,
    env: offlineEnv,
  });
  const exitCode = childProcessExitCode(result);
  cleanup();
  process.exit(exitCode);
} catch (error) {
  cleanup();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
