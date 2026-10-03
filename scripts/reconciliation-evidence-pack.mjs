#!/usr/bin/env node

/**
 * Deterministic, secret-safe reconciliation evidence pack (#078).
 *
 * Report-only: never fetches, never calls providers, never mutates refs, and
 * never deletes work. Writes atomically so an interrupted run cannot leave a
 * false completion record at the final output path.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { execFileSync } from "node:child_process";
import { redactSensitiveText } from "./sensitive-text.mjs";
import { collectReconciliationState, reconciliationPreflightInternals } from "./reconciliation-preflight.mjs";

const defaultRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { operationMarkers } = reconciliationPreflightInternals;

function git(args, cwd, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function listArchiveRefs(repositoryRoot) {
  const output = git(["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/archive"], repositoryRoot, {
    allowFailure: true,
  });
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [ref, object] = line.split("\t");
      return { ref, object };
    })
    .sort((left, right) => left.ref.localeCompare(right.ref));
}

async function inspectBundle(bundlePath, repositoryRoot) {
  if (!bundlePath) {
    return { provided: false, path: null, exists: false, sizeBytes: null, sha256: null, verify: null };
  }
  const resolved = path.resolve(bundlePath);
  if (!existsSync(resolved)) {
    return {
      provided: true,
      path: resolved,
      exists: false,
      sizeBytes: null,
      sha256: null,
      verify: { ok: false, detail: "bundle-missing" },
    };
  }
  const sizeBytes = statSync(resolved).size;
  const sha256 = await sha256File(resolved);
  let verify;
  try {
    const detail = git(["bundle", "verify", resolved], repositoryRoot);
    verify = { ok: true, detail: redactSensitiveText(detail.split(/\r?\n/)[0] ?? "verified") };
  } catch (error) {
    verify = {
      ok: false,
      detail: redactSensitiveText(error instanceof Error ? error.message : String(error)),
    };
  }
  return { provided: true, path: resolved, exists: true, sizeBytes, sha256, verify };
}

function treeEquality(repositoryRoot, baseRef, baseCommit, headCommit) {
  if (!baseCommit || !headCommit) {
    return { comparable: false, equal: false, baseTree: null, headTree: null };
  }
  const baseTree = git(["rev-parse", `${baseCommit}^{tree}`], repositoryRoot, { allowFailure: true }) || null;
  const headTree = git(["rev-parse", `${headCommit}^{tree}`], repositoryRoot, { allowFailure: true }) || null;
  return {
    comparable: Boolean(baseTree && headTree),
    equal: Boolean(baseTree && headTree && baseTree === headTree),
    baseRef,
    baseTree,
    headTree,
  };
}

function defaultDispositions(worktrees) {
  return worktrees
    .map((item) => {
      let disposition = "retained";
      if (item.inspectionErrors?.length) disposition = "inspection-failed";
      else if (item.operations?.length) disposition = "active-operation";
      else if (item.statusEntries > 0) disposition = "dirty-preserve";
      else if (item.prunable) disposition = "prunable-candidate";
      return {
        path: item.path,
        head: item.head,
        branch: item.branch,
        disposition,
        operations: [...(item.operations ?? [])].sort(),
        statusEntries: item.statusEntries,
        ahead: item.ahead,
        behind: item.behind,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function deepRedact(value) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => deepRedact(item));
  if (value && typeof value === "object") {
    const next = {};
    for (const key of Object.keys(value).sort()) next[key] = deepRedact(value[key]);
    return next;
  }
  return value;
}

/**
 * @param {{
 *   repositoryRoot?: string,
 *   baseRef?: string,
 *   dispositions?: Array<Record<string, unknown>>,
 *   bundlePath?: string | null,
 *   remotePrState?: unknown,
 *   now?: () => Date,
 *   preflight?: ReturnType<typeof collectReconciliationState>,
 * }} [options]
 */
export async function buildReconciliationEvidencePack({
  repositoryRoot = defaultRepositoryRoot,
  baseRef,
  dispositions,
  bundlePath = null,
  remotePrState = undefined,
  now = () => new Date(),
  preflight,
} = {}) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const state =
    preflight ??
    collectReconciliationState({
      repositoryRoot: resolvedRoot,
      baseRef,
      now,
    });
  const primaryHead = state.worktrees[0]?.head ?? null;
  const pack = {
    schemaVersion: 1,
    kind: "reconciliation-evidence-pack",
    status: "complete",
    generatedAt: now().toISOString(),
    cachedRefsOnly: true,
    fetched: false,
    providerCalls: false,
    mutations: false,
    repositoryRoot: resolvedRoot,
    frozen: {
      baseRef: state.baseRef,
      baseCommit: state.baseCommit,
      primaryPath: state.primaryPath,
      primaryHead,
    },
    totals: {
      ...state.totals,
      retainedWorktrees: state.totals.worktrees,
    },
    findings: state.findings,
    operationMarkersCatalog: [...operationMarkers],
    dispositions: dispositions ? deepRedact(dispositions) : defaultDispositions(state.worktrees),
    archiveRefs: listArchiveRefs(resolvedRoot),
    bundle: await inspectBundle(bundlePath, resolvedRoot),
    localBaseTreeEquality: treeEquality(resolvedRoot, state.baseRef, state.baseCommit, primaryHead),
    remotePrState:
      remotePrState === undefined ? { included: false } : { included: true, value: deepRedact(remotePrState) },
  };
  return deepRedact(pack);
}

/**
 * Atomically write the pack. The final path appears only after a successful write.
 * @param {{ outputPath: string, pack: Record<string, unknown> }} options
 */
export function writeReconciliationEvidencePack({ outputPath, pack }) {
  const resolved = path.resolve(outputPath);
  const directory = path.dirname(resolved);
  mkdirSync(directory, { recursive: true });
  const partialPath = `${resolved}.partial`;
  const body = `${JSON.stringify(pack, null, 2)}\n`;
  try {
    writeFileSync(partialPath, body, "utf8");
    renameSync(partialPath, resolved);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
  return resolved;
}

function parseArgs(argv) {
  const options = {
    outputPath: undefined,
    baseRef: undefined,
    bundlePath: undefined,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${token}`);
      index += 1;
      return value;
    };
    if (token === "--output" || token === "-o") options.outputPath = next();
    else if (token === "--base-ref") options.baseRef = next();
    else if (token === "--bundle") options.bundlePath = next();
    else if (token === "--json") options.json = true;
    else if (token === "--help" || token === "-h") options.help = true;
    else throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.outputPath) {
    console.log(
      "Usage: node scripts/reconciliation-evidence-pack.mjs --output <path> [--base-ref <ref>] [--bundle <path>] [--json]",
    );
    if (!options.help && !options.outputPath) process.exitCode = 1;
    return;
  }
  const pack = await buildReconciliationEvidencePack({
    baseRef: options.baseRef,
    bundlePath: options.bundlePath,
  });
  const written = writeReconciliationEvidencePack({ outputPath: options.outputPath, pack });
  if (options.json) console.log(JSON.stringify({ written, pack }, null, 2));
  else {
    console.log(`Wrote reconciliation evidence pack: ${written}`);
    console.log(
      `Worktrees: ${pack.totals.retainedWorktrees}; local/base trees equal: ${pack.localBaseTreeEquality.equal}`,
    );
  }
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[reconciliation-evidence-pack] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
