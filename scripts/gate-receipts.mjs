#!/usr/bin/env node
/**
 * gate-receipts.mjs — content-addressed memoisation for the expensive local gates.
 *
 * `AGENTS.md` has said "Do not rerun an unchanged successful gate" since the
 * process-hardening phases were written, but nothing enforced it, so the rule was
 * only ever as good as the agent's memory of what it had already run. The common
 * shape is a session that runs `npm run test`, fixes a doc, runs
 * `npm run verify:pr-local` (which runs `lint`, `typecheck` and `test` again), and
 * pays for the same full Vitest suite twice before CI pays for it a third time.
 *
 * This module removes the local half of that duplication. Before an allowlisted
 * gate runs, its wrapper computes a signature over exactly the content that gate
 * reads; if a receipt records that the same gate already exited 0 on that
 * signature, the wrapper reports the reuse and exits 0 without re-running.
 *
 * Deliberate boundaries:
 *
 * - **CI never reuses a receipt.** `receiptsEnabled()` returns false whenever `CI`
 *   is set. GitHub remains the authoritative merge gate and must re-run everything
 *   it is scoped to run; the duplication this file removes is local-only.
 * - **Receipts are never committed.** They live under `node_modules/.cache/`, so
 *   they are per-worktree, ignored by git, and destroyed by `npm ci` — which is
 *   correct, because a reinstall changes the toolchain the receipt vouched for.
 * - **Failure is never memoised.** Only a zero exit writes a receipt.
 * - **Fail open.** Any problem reading git state, or a scope that resolves to zero
 *   files, runs the gate. A bug here costs a redundant run, never a skipped one.
 * - **Artefact-producing gates are excluded.** `build` and `test:coverage` are not
 *   memoisable: their value is partly the `.next/` and `coverage/` trees they
 *   leave behind, and `check:bundle-budget` reading a stale `.next` is a known
 *   trap (see the "Bundle budget" section of `AGENTS.md`).
 *
 * A reused receipt is evidence that the gate passed on this exact content — it is
 * not evidence that it ran just now. The reuse line says so, and reports of a
 * reused gate must say "reused receipt from <time>", never "I ran it".
 *
 * CLI: `node scripts/gate-receipts.mjs [--self-test|status|clear] [gate]`
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

/**
 * Bumping this invalidates every stored receipt. Change it whenever the signature
 * inputs or their encoding change, so an old receipt cannot vouch for a gate under
 * new hashing rules.
 */
/**
 * @typedef {Record<string, string | undefined>} GateEnvironment
 * @typedef {{ key: string, recordedAt: string, inputHash?: string, environmentHash?: string, args?: string[], fileCount?: number }} GateReceipt
 * @typedef {{ gates: Record<string, GateReceipt[]> }} ReceiptStore
 * @typedef {{ reuse: boolean, reason: string, message: string | null, gate: string, args: string[], key: string | null, inputHash: string | null, environmentHash: string | null, fileCount: number }} GateDecision
 */

export const RECEIPT_FORMAT_VERSION = 2;

/** Receipts kept per gate before the oldest is dropped (branch switching thrashes otherwise). */
export const MAX_RECEIPTS_PER_GATE = 8;

export const RECEIPT_STORE_RELATIVE_PATH = path.join("node_modules", ".cache", "database-gate-receipts.json");

/** Same path, POSIX-separated, for comparison against git's always-forward-slash output. */
export const RECEIPT_STORE_POSIX_PATH = "node_modules/.cache/database-gate-receipts.json";

/**
 * Gates whose result may be reused, mapped to the repository content they read.
 *
 * Every entry is `null` — "the whole tracked tree" — and that is deliberate, not a
 * placeholder. A narrower scope buys only tolerance of edits the gate does not read
 * (a docs change leaving `lint` valid), and it buys that at the price of a false
 * skip if the scope is wrong. Both candidates for narrowing turned out to read far
 * more than they appear to: `tsconfig.typecheck.json` includes every `.ts` file
 * under the repository root with `resolveJsonModule`, so `data/` counts, and the Vitest
 * suite holds contract tests that read `.github/workflows/`, `docs/`,
 * `supabase/` and `package.json`.
 *
 * Whole-tree signatures still remove the duplication that actually costs: the same
 * gate running twice on content that did not change between the two runs, which is
 * what `verify:pr-local` followed by `verify:cheap` does to `lint`, `typecheck` and
 * the full Vitest suite today.
 *
 * A future narrowing is a declared array of path prefixes (directories end in `/`)
 * or exact paths. The self-test asserts every declared path exists and resolves to
 * a non-empty file set, so a rename cannot silently shrink a signature.
 */
export const GATE_INPUT_SCOPES = {
  "lint:internal": null,
  "typecheck:internal": null,
  vitest: null,
};

/** Gates that must never be memoised, with the reason, so a future edit is a conscious one. */
export const NEVER_MEMOISED = new Map([
  ["build", "produces .next/, which check:bundle-budget reads — a skipped build leaves stale output"],
  ["coverage", "produces coverage/, which the reporting gates read"],
  ["watch", "long-running; a receipt would defeat the point"],
]);

export function typecheckScopeAlias(gate) {
  return gate === "typecheck:source:internal" ? "typecheck:internal" : gate;
}

/**
 * @param {GateEnvironment} [env]
 * @returns {{ enabled: boolean, refresh: boolean, reason: string }}
 */
export function receiptsEnabled(env = process.env) {
  // CI is the authoritative merge gate. It must never reuse a receipt, and no
  // receipt produced anywhere may influence what CI decides to run.
  if (env.CI) return { enabled: false, refresh: false, reason: "CI is set — CI never reuses gate receipts" };
  const setting = String(env.GATE_RECEIPTS ?? "").toLowerCase();
  if (setting === "off" || setting === "0" || setting === "false") {
    return { enabled: false, refresh: false, reason: "GATE_RECEIPTS is off" };
  }
  if (setting === "refresh") return { enabled: true, refresh: true, reason: "GATE_RECEIPTS=refresh" };
  return { enabled: true, refresh: false, reason: "enabled" };
}

/**
 * True when `file` sits inside one of `scopes`. A scope ending in `/` is a directory
 * prefix; anything else must match the path exactly.
 * @param {string} file
 * @param {string[]} scopes
 * @returns {boolean}
 */
export function fileInScope(file, scopes) {
  return scopes.some((scope) => (scope.endsWith("/") ? file.startsWith(scope) : file === scope));
}

function runGit(projectRoot, args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function splitNul(output) {
  return output.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Blob hashes for the working-tree content of `files`, batched through a single
 * `git hash-object` call. Falls back to one call per file when a path contains a
 * newline, which `--stdin-paths` cannot express.
 * @param {string} projectRoot
 * @param {string[]} files
 * @param {{ git?: typeof runGit }} [options]
 * @returns {Map<string, string>}
 */
export function hashWorkingTreeFiles(projectRoot, files, { git = runGit } = {}) {
  const hashes = new Map();
  const present = files.filter((file) => existsSync(path.join(projectRoot, file)));
  if (present.length === 0) return hashes;

  if (present.some((file) => file.includes("\n"))) {
    for (const file of present) hashes.set(file, git(projectRoot, ["hash-object", "--", file]).trim());
    return hashes;
  }

  const output = execFileSync("git", ["hash-object", "--stdin-paths"], {
    cwd: projectRoot,
    encoding: "utf8",
    input: `${present.join("\n")}\n`,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = output.split("\n").filter((line) => line.length > 0);
  present.forEach((file, index) => {
    if (lines[index]) hashes.set(file, lines[index].trim());
  });
  return hashes;
}

/**
 * Parse `git diff --raw -z`, whose entries alternate metadata and path:
 * `:<srcmode> <dstmode> <srcsha> <dstsha> <status>` then the path.
 * Returns path -> destination mode ("000000" for a deletion).
 * @param {string[]} entries
 * @returns {Map<string, string>}
 */
export function parseRawDiff(entries) {
  const modes = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry.startsWith(":")) continue;
    const destinationMode = entry.slice(1).split(" ")[1];
    const file = entries[index + 1];
    if (file) modes.set(file, destinationMode ?? "");
    index += 1;
  }
  return modes;
}

/**
 * Git-style mode for a file with no diff entry (an untracked file).
 * @param {string} projectRoot
 * @param {string} file
 * @returns {string}
 */
export function workingTreeMode(projectRoot, file) {
  try {
    const stats = lstatSync(path.join(projectRoot, file));
    if (stats.isSymbolicLink()) return "120000";
    return (stats.mode & 0o111) === 0 ? "100644" : "100755";
  } catch {
    return "100644";
  }
}

/**
 * Content signature for a gate's scope.
 *
 * Tracked content comes from the index (`git ls-files -s` is a single index read,
 * ~3ms on this repo's 3.9k files), then working-tree modifications and untracked
 * non-ignored files are overlaid so an unstaged edit invalidates the receipt.
 * Ignored paths are excluded by design: nothing in the memoised set reads them.
 *
 * @param {string} projectRoot
 * @param {string[] | null} scopes
 * @returns {{ hash: string, fileCount: number } | null} null when the signature cannot be trusted.
 */
export function computeInputSignature(projectRoot, scopes, { git = runGit } = {}) {
  let indexEntries;
  let modified;
  let untracked;
  try {
    indexEntries = splitNul(git(projectRoot, ["ls-files", "-s", "-z"]));
    modified = parseRawDiff(splitNul(git(projectRoot, ["diff", "--raw", "-z"])));
    untracked = splitNul(git(projectRoot, ["ls-files", "-o", "--exclude-standard", "-z"]));
  } catch {
    return null; // Not a git worktree, or git is unavailable — run the gate.
  }

  // The store lives under node_modules/, which this repository gitignores — but a
  // worktree with a different ignore configuration would otherwise see the receipt
  // it just wrote as new untracked content and invalidate itself on every run.
  // Excluding it explicitly makes the memo independent of ignore rules.
  const excluded = (file) => file.startsWith("node_modules/") || file === RECEIPT_STORE_POSIX_PATH;
  const inScope = (file) => !excluded(file) && (scopes === null || fileInScope(file, scopes));
  const contents = new Map();
  for (const entry of indexEntries) {
    // "<mode> <sha> <stage>\t<path>"
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const file = entry.slice(tab + 1);
    if (!inScope(file)) continue;
    const [mode, sha] = entry.slice(0, tab).split(" ");
    // The MODE is part of the content, not decoration. `git update-index --chmod=+x`
    // leaves the blob SHA untouched, so a signature over the SHA alone cannot see a
    // hook's executable bit flip — and that bit is exactly what
    // `tests/session-start-hook.test.ts` asserts (see the hook-scripts section of
    // AGENTS.md: a `100644` hook is unrunnable in the one environment it exists for).
    // Hashing SHA-only let that fix reuse the pre-fix pass. Reported by Codex review
    // on PR #2216 and reproduced: chmod +x, identical blob, identical signature.
    contents.set(file, `${mode ?? ""} ${sha ?? ""}`);
  }

  const dirty = [...modified.keys(), ...untracked].filter(inScope);
  const dirtyHashes = hashWorkingTreeFiles(projectRoot, dirty, { git });
  for (const file of dirty) {
    const hash = dirtyHashes.get(file);
    // A file listed as modified but absent from disk was deleted in the working
    // tree; dropping it from the map is what makes the deletion change the hash.
    if (!hash) {
      contents.delete(file);
      continue;
    }
    // Keep BOTH modes. The index mode and the working-tree mode answer different
    // questions and different gates read different ones: `git update-index --chmod=+x`
    // moves only the index (which is what `tests/session-start-hook.test.ts` inspects
    // and what CI checks out), while a bare `chmod` moves only the disk. Overwriting
    // one with the other cancels exactly the change being detected — the first attempt
    // at this fix did that and still reused the pre-chmod receipt.
    //
    // `git diff --raw` reports the working-tree mode git itself would record, which
    // respects `core.fileMode`; the Windows Dev Drive sets it false, so a raw
    // filesystem stat would disagree there. Untracked files have no index entry and no
    // diff entry, so they fall back to the executable bit.
    const indexPart = contents.get(file) ?? "untracked";
    const workingMode = modified.get(file) ?? workingTreeMode(projectRoot, file);
    contents.set(file, `${indexPart}|${workingMode} ${hash}`);
  }

  if (contents.size === 0) return null; // Empty scope: a stale path list, not a provable pass.

  const digest = createHash("sha256");
  for (const file of [...contents.keys()].sort()) digest.update(`${file}\0${contents.get(file)}\0`);
  return { hash: digest.digest("hex"), fileCount: contents.size };
}

/**
 * Environment variables that change what a gate DECIDES, not merely how fast it runs.
 *
 * `FAST_CHECK_SEED` is the motivating case: `tests/property-seed.ts` reads it at import
 * time to seed the property suite, and `docs/testing.md` documents setting it precisely
 * to reproduce a failing run. Left out of the key, `FAST_CHECK_SEED=123 npm run test`
 * would serve the default seed's pass and never execute the seed being investigated —
 * the exact opposite of what the developer asked for. Reported by Codex review on
 * PR #2216.
 *
 * Locale and timezone are here because they move date and collation assertions;
 * `NODE_OPTIONS` can change runtime behaviour outright. Performance-only knobs such as
 * `VITEST_MAX_WORKERS` are deliberately absent — they do not change the verdict.
 */
export const OUTCOME_AFFECTING_ENV_VARS = [
  "ALLOW_PROVIDER_TESTS",
  "FAST_CHECK_SEED",
  "LANG",
  "LC_ALL",
  "NODE_OPTIONS",
  "PYTHON_BIN",
  "TZ",
];

// Every Vitest selection can reach Python through imports or file-read contracts.
// Until dependencies are declared per test, fingerprint it for all Vitest receipts.
// Import probes distinguish an installed-but-broken package from a usable one;
// the distribution inventory also covers versions of their transitive dependencies.
const pythonIdentityProgram = `
import hashlib, importlib, importlib.metadata, json, os, sys
executable = os.path.realpath(sys.executable)
with open(executable, "rb") as binary:
    digest = hashlib.sha256()
    for block in iter(lambda: binary.read(1024 * 1024), b""):
        digest.update(block)
    executable_hash = digest.hexdigest()
prerequisites = {}
for name, distribution in (("fitz", "PyMuPDF"), ("pymupdf", "PyMuPDF"), ("PIL", "Pillow"), ("pytesseract", "pytesseract")):
    try:
        module = importlib.import_module(name)
    except ModuleNotFoundError as error:
        prerequisites[name] = {"available": False, "error": type(error).__name__, "missing": error.name}
    except Exception as error:
        prerequisites[name] = {"available": False, "error": type(error).__name__}
    else:
        prerequisites[name] = {"available": True, "version": importlib.metadata.version(distribution), "path": os.path.realpath(module.__file__)}
distributions = sorted((item.metadata["Name"], item.version) for item in importlib.metadata.distributions())
print(json.dumps({"executable": executable, "executableHash": executable_hash, "version": sys.version, "prefix": sys.prefix, "path": sys.path, "prerequisites": prerequisites, "distributions": distributions}, sort_keys=True))
`;

/**
 * An unidentifiable external runtime cannot certify a reusable test result.
 * @param {string} projectRoot
 * @param {GateEnvironment} [env]
 */
export function pythonToolchainSignature(projectRoot, env = process.env, { probe = spawnSync } = {}) {
  const pythonBin = env.PYTHON_BIN?.trim() || (process.platform === "win32" ? "python" : "python3");
  try {
    const result = probe(pythonBin, ["-c", pythonIdentityProgram], {
      cwd: projectRoot,
      env,
      encoding: "utf8",
      timeout: 5000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    if (result.error || result.status !== 0 || result.signal) return null;
    const identity = JSON.parse(result.stdout);
    if (
      typeof identity.executable !== "string" ||
      !path.isAbsolute(identity.executable) ||
      !/^[a-f0-9]{64}$/.test(identity.executableHash) ||
      typeof identity.version !== "string" ||
      !identity.version.trim() ||
      typeof identity.prefix !== "string" ||
      !Array.isArray(identity.path) ||
      !Array.isArray(identity.distributions) ||
      !identity.distributions.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every((value) => typeof value === "string" && value.length > 0),
      ) ||
      !["fitz", "pymupdf", "PIL", "pytesseract"].every((name) => {
        const prerequisite = identity.prerequisites?.[name];
        return prerequisite?.available === false
          ? typeof prerequisite.error === "string"
          : prerequisite?.available === true &&
              typeof prerequisite.version === "string" &&
              prerequisite.version.length > 0 &&
              typeof prerequisite.path === "string";
      })
    )
      return null;
    return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Toolchain identity. `node_modules/.package-lock.json` changes on every install, so
 * its size and mtime are enough to invalidate receipts across a reinstall without
 * reading a multi-megabyte file.
 * @param {string} projectRoot
 * @param {GateEnvironment} [env]
 * @returns {string | null}
 */
export function environmentSignature(projectRoot, env = process.env, { gate } = {}) {
  const externalTools = gate === "vitest" ? pythonToolchainSignature(projectRoot, env) : "not-required";
  if (externalTools === null) return null;
  const installStampPath = path.join(projectRoot, "node_modules", ".package-lock.json");
  let installStamp = "absent";
  try {
    const stats = statSync(installStampPath);
    installStamp = `${stats.size}:${Math.trunc(stats.mtimeMs)}`;
  } catch {
    /* no install stamp — recorded as "absent", which is itself a distinct signature */
  }
  const declaredEnvironment = OUTCOME_AFFECTING_ENV_VARS.map((name) => `${name}=${env[name] ?? ""}`);
  return createHash("sha256")
    .update(
      [
        RECEIPT_FORMAT_VERSION,
        process.version,
        process.platform,
        process.arch,
        installStamp,
        externalTools,
        ...declaredEnvironment,
      ].join("\0"),
      "utf8",
    )
    .digest("hex");
}

/**
 * @param {{ gate: string, args?: string[], inputHash: string, environmentHash: string }} parts
 */
export function receiptKey({ gate, args, inputHash, environmentHash }) {
  return createHash("sha256")
    .update([RECEIPT_FORMAT_VERSION, gate, JSON.stringify(args ?? []), inputHash, environmentHash].join("\0"), "utf8")
    .digest("hex");
}

export function storePath(projectRoot) {
  return path.join(projectRoot, RECEIPT_STORE_RELATIVE_PATH);
}

/**
 * @param {string} projectRoot
 * @returns {ReceiptStore}
 */
export function loadStore(projectRoot) {
  try {
    const parsed = JSON.parse(readFileSync(storePath(projectRoot), "utf8"));
    if (parsed?.version !== RECEIPT_FORMAT_VERSION || typeof parsed.gates !== "object") return { gates: {} };
    return { gates: parsed.gates ?? {} };
  } catch {
    return { gates: {} };
  }
}

function saveStore(projectRoot, store) {
  const target = storePath(projectRoot);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: RECEIPT_FORMAT_VERSION, gates: store.gates }, null, 2)}\n`);
  renameSync(temporary, target); // Atomic swap: a crash mid-write cannot leave a half-parsed store.
}

/**
 * Append a receipt, keeping the most recent `MAX_RECEIPTS_PER_GATE` for the gate.
 * Exported for the self-test; `recordGateReceipt` is the wrapper-facing entry point.
 * @param {ReceiptStore} store
 * @param {string} gate
 * @param {GateReceipt} receipt
 * @returns {ReceiptStore}
 */
export function appendReceipt(store, gate, receipt) {
  const existing = (store.gates[gate] ?? []).filter((entry) => entry.key !== receipt.key);
  store.gates[gate] = [receipt, ...existing].slice(0, MAX_RECEIPTS_PER_GATE);
  return store;
}

/**
 * Decide whether `gate` may be skipped.
 *
 * The returned object is passed back to `recordGateReceipt` after the run so the
 * signature is computed once, and so recording can verify the content did not
 * change while the gate was running.
 *
 * @param {{ projectRoot: string, gate: string, args?: string[], env?: GateEnvironment, now?: () => Date }} options
 * @returns {GateDecision}
 */
export function consultGateReceipt({ projectRoot, gate, args = [], env = process.env, now = () => new Date() }) {
  const miss = (reason) => ({
    reuse: false,
    reason,
    message: null,
    gate,
    args,
    key: null,
    inputHash: null,
    environmentHash: null,
    fileCount: 0,
  });

  const scopeGate = typecheckScopeAlias(gate);
  if (!(scopeGate in GATE_INPUT_SCOPES)) return miss(`${gate} is not a memoised gate`);

  const setting = receiptsEnabled(env);
  if (!setting.enabled) return miss(setting.reason);

  const signature = computeInputSignature(projectRoot, GATE_INPUT_SCOPES[scopeGate]);
  if (!signature) return miss("input signature unavailable — running the gate");

  const environmentHash = environmentSignature(projectRoot, env, { gate: scopeGate });
  if (!environmentHash) return miss("external tool identity unavailable — running without a reusable receipt");
  const key = receiptKey({ gate: scopeGate, args, inputHash: signature.hash, environmentHash });
  const base = {
    reuse: false,
    reason: "no receipt for these inputs",
    message: null,
    gate: scopeGate,
    args,
    key,
    inputHash: signature.hash,
    environmentHash,
    fileCount: signature.fileCount,
  };

  if (setting.refresh) return { ...base, reason: "GATE_RECEIPTS=refresh — re-running" };

  const stored = (loadStore(projectRoot).gates[scopeGate] ?? []).find((entry) => entry.key === key);
  if (!stored) return base;

  const age = Math.max(0, Math.round((now().getTime() - Date.parse(stored.recordedAt)) / 1000));
  return {
    ...base,
    reuse: true,
    reason: "receipt matches",
    message:
      `[gate-receipts] REUSED — "${scopeGate}" already exited 0 on this exact content ` +
      `${describeAge(age)} (${stored.recordedAt}).\n` +
      `[gate-receipts] inputs ${signature.fileCount} files, hash ${signature.hash.slice(0, 12)}. ` +
      `This is a reused receipt, not a fresh run.\n` +
      `[gate-receipts] Force a re-run with GATE_RECEIPTS=refresh, or disable with GATE_RECEIPTS=off.`,
  };
}

export function describeAge(seconds) {
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * Record a passing gate.
 *
 * The signature is recomputed and compared with the pre-run one: a session that
 * edits a file while the suite runs must not receive a receipt claiming the new
 * content passed.
 *
 * @param {{ projectRoot: string, decision: Partial<GateDecision> | null | undefined, exitCode: number, env?: GateEnvironment, now?: () => Date }} options
 * @returns {{ recorded: boolean, reason: string }}
 */
export function recordGateReceipt({ projectRoot, decision, exitCode, env = process.env, now = () => new Date() }) {
  if (exitCode !== 0) return { recorded: false, reason: "non-zero exit — failures are never memoised" };
  if (!decision?.key) return { recorded: false, reason: decision?.reason ?? "no signature to record" };
  if (!receiptsEnabled(env).enabled) return { recorded: false, reason: "receipts disabled" };

  const scopeGate = typecheckScopeAlias(decision.gate);
  const after = computeInputSignature(projectRoot, GATE_INPUT_SCOPES[scopeGate]);
  if (!after || after.hash !== decision.inputHash) {
    return { recorded: false, reason: "content changed while the gate ran — not recorded" };
  }
  const afterEnvironment = environmentSignature(projectRoot, env, { gate: scopeGate });
  if (!afterEnvironment || afterEnvironment !== decision.environmentHash) {
    return {
      recorded: false,
      reason: "environment changed while the gate ran or tool identity unavailable — not recorded",
    };
  }

  const store = loadStore(projectRoot);
  appendReceipt(store, scopeGate, {
    key: decision.key,
    recordedAt: now().toISOString(),
    inputHash: decision.inputHash,
    environmentHash: decision.environmentHash,
    args: decision.args ?? [],
    fileCount: decision.fileCount,
  });
  try {
    saveStore(projectRoot, store);
  } catch (error) {
    return { recorded: false, reason: `could not write the receipt store: ${String(error?.message ?? error)}` };
  }
  return { recorded: true, reason: "recorded" };
}

/**
 * Wrapper helper: consult, run, record. `run` returns the gate's exit code.
 * @param {{ projectRoot: string, gate: string, args?: string[], env?: GateEnvironment, run: () => Promise<number>, log?: (message: string) => void }} options
 */
export async function withGateReceipt({ projectRoot, gate, args = [], env = process.env, run, log = console.log }) {
  const decision = consultGateReceipt({ projectRoot, gate, args, env });
  if (decision.reuse) {
    log(decision.message);
    return 0;
  }
  const exitCode = await run();
  const recorded = recordGateReceipt({ projectRoot, decision, exitCode, env });
  if (exitCode === 0 && recorded.recorded) {
    log(`[gate-receipts] recorded a pass for "${decision.gate}" (${decision.fileCount} input files).`);
  }
  return exitCode;
}

/* ------------------------------ CLI ------------------------------ */

function cliStatus(projectRoot) {
  const store = loadStore(projectRoot);
  const setting = receiptsEnabled(process.env);
  console.log(`gate-receipts: ${setting.enabled ? "enabled" : "disabled"} (${setting.reason})`);
  console.log(`store: ${RECEIPT_STORE_RELATIVE_PATH}`);
  const gates = Object.keys(GATE_INPUT_SCOPES);
  for (const gate of gates) {
    const signature = computeInputSignature(projectRoot, GATE_INPUT_SCOPES[gate]);
    const receipts = store.gates[gate] ?? [];
    const current = signature ? receipts.filter((entry) => entry.inputHash === signature.hash).length : 0;
    console.log(
      `- ${gate.padEnd(22)} scope ${(GATE_INPUT_SCOPES[gate] === null ? "whole tree" : `${GATE_INPUT_SCOPES[gate].length} paths`).padEnd(11)}` +
        ` inputs ${String(signature?.fileCount ?? 0).padStart(5)} files` +
        ` hash ${signature ? signature.hash.slice(0, 12) : "unavailable"}` +
        ` receipts ${receipts.length} (${current} valid now)`,
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function selfTest(projectRoot) {
  assert(fileInScope("src/lib/rag/rag.ts", ["src/"]), "directory scope must match a nested file");
  assert(!fileInScope("srcx/thing.ts", ["src/"]), "directory scope must not match a sibling prefix");
  assert(fileInScope("package.json", ["package.json"]), "exact scope must match");
  assert(!fileInScope("docs/package.json", ["package.json"]), "exact scope must not match a suffix");

  assert(!receiptsEnabled({ CI: "true" }).enabled, "CI must never reuse receipts");
  assert(!receiptsEnabled({ GATE_RECEIPTS: "off" }).enabled, "GATE_RECEIPTS=off must disable reuse");
  assert(receiptsEnabled({ GATE_RECEIPTS: "refresh" }).refresh, "GATE_RECEIPTS=refresh must force a run");
  assert(receiptsEnabled({}).enabled, "receipts are enabled by default outside CI");

  assert(typecheckScopeAlias("typecheck:source:internal") === "typecheck:internal", "typecheck wrappers share a scope");

  const keyA = receiptKey({ gate: "vitest", args: ["run"], inputHash: "a", environmentHash: "e" });
  const keyB = receiptKey({ gate: "vitest", args: ["run", "tests/x.test.ts"], inputHash: "a", environmentHash: "e" });
  const keyC = receiptKey({ gate: "vitest", args: ["run"], inputHash: "b", environmentHash: "e" });
  const keyD = receiptKey({ gate: "vitest", args: ["run"], inputHash: "a", environmentHash: "f" });
  assert(new Set([keyA, keyB, keyC, keyD]).size === 4, "gate, args, inputs and environment must all key the receipt");

  const store = appendReceipt({ gates: {} }, "vitest", { key: "k1", recordedAt: "2026-01-01T00:00:00.000Z" });
  appendReceipt(store, "vitest", { key: "k1", recordedAt: "2026-01-02T00:00:00.000Z" });
  assert(store.gates.vitest.length === 1, "re-recording the same key must not duplicate it");
  for (let index = 0; index < MAX_RECEIPTS_PER_GATE + 3; index += 1) {
    appendReceipt(store, "vitest", { key: `bulk-${index}`, recordedAt: "2026-01-03T00:00:00.000Z" });
  }
  assert(store.gates.vitest.length === MAX_RECEIPTS_PER_GATE, "receipt history must stay capped");

  assert(
    recordGateReceipt({ projectRoot, decision: { key: "k", gate: "vitest" }, exitCode: 1 }).recorded === false,
    "a failing gate must never be memoised",
  );

  for (const [gate, scopes] of Object.entries(GATE_INPUT_SCOPES)) {
    if (scopes === null) continue;
    for (const scope of scopes) {
      assert(
        existsSync(path.join(projectRoot, scope)),
        `gate-receipts: "${gate}" declares input scope "${scope}", which does not exist — a renamed path would silently shrink the signature.`,
      );
    }
    const signature = computeInputSignature(projectRoot, scopes);
    assert(signature && signature.fileCount > 0, `gate-receipts: "${gate}" resolved to an empty input set`);
  }

  for (const gate of Object.keys(GATE_INPUT_SCOPES)) {
    assert(!NEVER_MEMOISED.has(gate), `gate-receipts: "${gate}" is both memoised and listed as never-memoised`);
  }

  console.log("gate-receipts self-test OK: scope matching, CI refusal, keying, capping, and declared scopes all hold.");
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const command = process.argv[2] ?? "status";
  try {
    if (command === "--self-test") selfTest(projectRoot);
    else if (command === "status") cliStatus(projectRoot);
    else if (command === "clear") {
      rmSync(storePath(projectRoot), { force: true });
      console.log(`gate-receipts: cleared ${RECEIPT_STORE_RELATIVE_PATH}`);
    } else {
      console.error(`Usage: node scripts/gate-receipts.mjs [--self-test|status|clear]`);
      process.exit(2);
    }
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}
