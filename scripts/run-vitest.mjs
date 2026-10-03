#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { childProcessExitCode } from "./child-process-result.mjs";
import { consultGateReceipt, recordGateReceipt } from "./gate-receipts.mjs";
import { offlineTestEnvironment } from "./test-environment.mjs";
import { acquireHeavyRunLock } from "./test-run-lock.mjs";
import { vitestLeaseMode } from "./test-run-selection.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestBin = path.join(projectRoot, "node_modules", "vitest", "vitest.mjs");
const args = process.argv.slice(2);

const configuredWaitTimeoutMs = Number(process.env.HEAVY_RUN_WAIT_TIMEOUT_MS);
const waitTimeoutMs = Number.isFinite(configuredWaitTimeoutMs) ? configuredWaitTimeoutMs : undefined;
/** Keep in sync with `HEAVY_RUN_ADMISSION_BUSY_*` in `scripts/guard-push.mjs`. */
export const ADMISSION_BUSY_EXIT = 75;
export const ADMISSION_BUSY_MARKER = "DATABASE_HEAVY_RUN_ADMISSION_BUSY";
// Anchored to the coordinator's own capacity messages (test-run-lock.mjs
// busyMessage() and the initializing branch), following run-playwright.mjs rather
// than run-heavy.mjs: a loose prose match also catches inherited-lease mismatches
// and coordinator setup failures, which are configuration bugs and must keep
// failing with the ordinary exit 1.
export const ADMISSION_BUSY_PATTERN =
  /^(?:Database focused-test capacity is full|Another Database heavyweight command is active|A Database heavyweight coordinator is being initialized\b.*retry shortly\.)/;

export const VITEST_BUILTIN_REPORTERS = new Set([
  "default",
  "agent",
  "minimal",
  "blob",
  "verbose",
  "dot",
  "json",
  "tap",
  "tap-flat",
  "junit",
  "tree",
  "hanging-process",
  "github-actions",
]);

export function isValidReporter(reporter) {
  if (VITEST_BUILTIN_REPORTERS.has(reporter)) return true;
  if (reporter.includes("/") || reporter.includes("\\") || /\.[mc]?[jt]sx?$/.test(reporter)) {
    return true;
  }
  return false;
}

export function extractReporters(argumentList) {
  const reporters = [];
  for (let i = 0; i < argumentList.length; i++) {
    const arg = argumentList[i];
    if (arg.startsWith("--reporter=")) {
      const val = arg.slice("--reporter=".length);
      reporters.push(
        ...val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg === "--reporter" || arg === "-r") {
      const next = argumentList[i + 1];
      if (next && !next.startsWith("-")) {
        reporters.push(
          ...next
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        i++;
      }
    } else if (arg.startsWith("-r=")) {
      const val = arg.slice("-r=".length);
      reporters.push(
        ...val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
  }
  return reporters;
}

export function validateReporters(argumentList) {
  const reporters = extractReporters(argumentList);
  const invalid = reporters.filter((r) => !isValidReporter(r));
  if (invalid.length > 0) {
    return {
      valid: false,
      invalidReporters: invalid,
      error: `Unrecognized Vitest reporter(s): ${invalid.join(", ")}. Valid built-in reporters: ${Array.from(VITEST_BUILTIN_REPORTERS).join(", ")}. Custom reporters must be valid file paths.`,
    };
  }
  return { valid: true, invalidReporters: [], error: null };
}

// Only plain result-producing runs are memoisable. A coverage run's artefact IS
// part of its output, watch mode has no terminal result to record, and snapshot
// updates mutate the tree they were keyed on.
//
// Matched by prefix, not by equality: Vitest accepts `--coverage.enabled` and
// `--coverage=true` as well as the bare `--coverage`, and an exact-match list let a
// dotted invocation be memoised — after which a later identical run would skip and
// leave `coverage/` stale or missing for the gates that read it. Reported by Codex
// review on PR #2216. `--no-coverage` correctly does not match, so it stays
// memoisable; an explicit `--coverage=false` merely runs the gate, which is the safe
// direction.
const NON_MEMOISABLE_ARGUMENT = /^--(?:coverage|watch|update|ui)(?:[.=]|$)/;
export const vitestRunIsMemoisable = (argumentList) =>
  !argumentList.some((argument) => argument === "-u" || NON_MEMOISABLE_ARGUMENT.test(argument));

export async function main() {
  const reporterValidation = validateReporters(args);
  if (!reporterValidation.valid) {
    console.error(`[run-vitest] ERROR: ${reporterValidation.error}`);
    process.exit(1);
  }

  const mode = vitestLeaseMode(args);

  const memoisable = vitestRunIsMemoisable(args);
  // Consulted before the lease request so a proven run does not queue for capacity.
  const receipt = memoisable
    ? consultGateReceipt({ projectRoot, gate: "vitest", args, env: process.env })
    : { reuse: false, key: null, gate: "vitest", args, reason: "artefact-producing or interactive run" };
  if (receipt.reuse) {
    console.log(receipt.message);
    process.exit(0);
  }

  // Admission refusal must be distinguishable from a test failure. Without this,
  // a refused run threw out of `main()` and exited 1 with a stack trace, so an
  // agent waiting on a busy coordinator was told its code was broken (#M8SP5M).
  // `run-heavy.mjs` and `run-playwright.mjs` have had this since they were written.
  let lock;
  try {
    lock = acquireHeavyRunLock({
      projectRoot,
      command: `vitest ${args.join(" ")}`,
      mode,
      ...(waitTimeoutMs === undefined ? {} : { waitTimeoutMs }),
    });
  } catch (error) {
    const message = String(error?.message ?? error);
    if (ADMISSION_BUSY_PATTERN.test(message)) {
      console.error(ADMISSION_BUSY_MARKER);
      console.error(`Vitest did not run: ${message}`);
      console.error("Wait for the active heavyweight run to finish, then retry this command.");
      process.exit(ADMISSION_BUSY_EXIT);
    }
    console.error(message);
    process.exit(1);
  }
  const configuredWorkers = Number(process.env.VITEST_MAX_WORKERS);
  const sharedWorkers =
    Number.isFinite(configuredWorkers) && configuredWorkers > 0 ? Math.min(configuredWorkers, 2) : 2;
  const environment = offlineTestEnvironment(lock.environment, {
    NODE_ENV: "test",
    ...(mode === "shared" ? { VITEST_MAX_WORKERS: String(sharedWorkers) } : {}),
  });

  function runVitest() {
    const child = spawn(process.execPath, [vitestBin, ...args], {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
    });
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (status, signal) => resolve(childProcessExitCode({ status, signal })));
    });
  }

  let exitCode = 1;
  try {
    exitCode = await runVitest();
  } finally {
    lock.release();
  }

  const recorded = recordGateReceipt({ projectRoot, decision: receipt, exitCode, env: process.env });
  if (exitCode === 0 && recorded.recorded) {
    console.log(`[gate-receipts] recorded a pass for "vitest ${args.join(" ")}" (${receipt.fileCount} input files).`);
  }

  process.exit(exitCode);
}

const isEntrypoint = isDirectEntrypoint(import.meta.url);
if (isEntrypoint) {
  await main();
}
