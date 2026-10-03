#!/usr/bin/env node

/**
 * Explicit-root, report-only inventory for worktree fleets and standalone clones.
 *
 * The scanner uses lexical paths, lstat, and batched Windows FileAttributes probes. It never
 * resolves through or descends into a symbolic link, junction, or other reparse boundary, and
 * exposes no removal API.
 */
import { lstatSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import {
  assertReportOnlyOptions,
  classifyLiveness,
  inspectReparsePoints,
  inspectWindowsReparsePaths,
  normalizeWorktreePath,
  parseWorktreePorcelain,
  runReadOnlyGit,
} from "./clean-worktree.mjs";

const ZERO_MUTATIONS = Object.freeze({ cleaned: 0, pruned: 0, removed: 0, deregistered: 0 });
const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

function sanitizedCode(value, fallback = "UNKNOWN") {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]{1,40}$/.test(text) ? text : fallback;
}

function mutationOptionToken(token) {
  return token === "--remove" || token.startsWith("--remove=") || token === "--apply" || token.startsWith("--apply=");
}

function requiredValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${name}.`);
  return value;
}

function normalizedRootKey(value) {
  return normalizeWorktreePath(path.resolve(value));
}

function isSameOrAncestor(candidate, target) {
  const relative = path.relative(path.resolve(candidate), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertNarrowInventoryRoots(roots) {
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (normalizeWorktreePath(resolved) === normalizeWorktreePath(path.parse(resolved).root)) {
      throw new Error("Inventory root is too broad; filesystem roots are refused.");
    }
    if (isSameOrAncestor(resolved, homedir())) {
      throw new Error("Inventory root is too broad; home directories and their ancestors are refused.");
    }
  }
}

export function parseInventoryArgs(argv) {
  const tokens = Array.isArray(argv) ? argv : [];
  if (tokens.some(mutationOptionToken)) {
    throw new Error("Mutation options are unsupported: worktree inventory is permanently report-only.");
  }

  const roots = [];
  const options = {
    reportOnly: true,
    help: false,
    selfTest: false,
    json: false,
    roots,
    repositoryRoot: path.resolve(process.cwd()),
    maxDepth: 4,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--help" || token === "-h") options.help = true;
    else if (token === "--self-test") options.selfTest = true;
    else if (token === "--json") options.json = true;
    else if (token === "--root") {
      roots.push(path.resolve(requiredValue(tokens, index, "--root")));
      index += 1;
    } else if (token.startsWith("--root=")) {
      const value = token.slice("--root=".length);
      if (!value) throw new Error("Missing value for --root.");
      roots.push(path.resolve(value));
    } else if (token === "--repository") {
      options.repositoryRoot = path.resolve(requiredValue(tokens, index, "--repository"));
      index += 1;
    } else if (token.startsWith("--repository=")) {
      const value = token.slice("--repository=".length);
      if (!value) throw new Error("Missing value for --repository.");
      options.repositoryRoot = path.resolve(value);
    } else if (token === "--max-depth") {
      const value = requiredValue(tokens, index, "--max-depth");
      options.maxDepth = Number.parseInt(value, 10);
      index += 1;
    } else if (token.startsWith("--max-depth=")) {
      options.maxDepth = Number.parseInt(token.slice("--max-depth=".length), 10);
    } else {
      throw new Error(`Unknown argument: ${token}. Run with --help for usage.`);
    }
  }

  if (!Number.isInteger(options.maxDepth) || options.maxDepth < 1 || options.maxDepth > 12) {
    throw new Error("--max-depth must be an integer from 1 to 12.");
  }
  const uniqueRoots = new Map();
  for (const root of roots) uniqueRoots.set(normalizedRootKey(root), path.resolve(root));
  options.roots = [...uniqueRoots.values()].sort((left, right) =>
    normalizeWorktreePath(left).localeCompare(normalizeWorktreePath(right)),
  );
  assertNarrowInventoryRoots(options.roots);
  if (!options.help && !options.selfTest && options.roots.length === 0) {
    throw new Error("At least one --root is required; implicit home or fleet scans are not allowed.");
  }
  return options;
}

function gitError(category, result, extra = {}) {
  return { category, code: sanitizedCode(result?.errorCode ?? result?.code), ...extra };
}

/**
 * Inspect every lexical segment before a root. The function stops at the first unavailable or
 * link-like segment, so the target itself is never reached through a reparse parent.
 */
export function inspectPathSegmentsForReparse(
  targetPath,
  { lstatFn = lstatSync, platform = process.platform, reparseBatchFn = inspectWindowsReparsePaths } = {},
) {
  const target = path.resolve(targetPath);
  const parsed = path.parse(target);
  const relative = path.relative(parsed.root, target);
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = parsed.root;
  const candidates = [current];
  for (const segment of segments) {
    current = path.join(current, segment);
    candidates.push(current);
  }

  if (platform === "win32") {
    let evidence;
    try {
      evidence = reparseBatchFn(candidates, { platform, stopOnBoundary: true });
    } catch (error) {
      return { state: "unknown", path: target, code: sanitizedCode(error?.code, "PROBE_ERROR") };
    }
    for (let index = 0; index < evidence.length; index += 1) {
      if (evidence[index]?.state === "reparse") {
        return { state: "excluded-reparse", path: path.resolve(candidates[index]), code: "REPARSE" };
      }
      if (evidence[index]?.state !== "safe") {
        return {
          state: "unknown",
          path: path.resolve(candidates[index]),
          code: sanitizedCode(evidence[index]?.code, "PROBE_RESULT"),
        };
      }
    }
    if (evidence.length !== candidates.length) {
      return {
        state: "unknown",
        path: path.resolve(candidates[evidence.length] ?? target),
        code: "MISSING_PROBE_RESULT",
      };
    }
    return { state: "safe" };
  }

  for (const candidate of candidates) {
    try {
      const stat = lstatFn(candidate);
      let evidence;
      if (stat?.isSymbolicLink?.() === true || stat?.reparsePoint === true) {
        evidence = { state: "reparse", code: "REPARSE" };
      } else if (stat?.reparsePoint === false || platform !== "win32") {
        evidence = { state: "safe" };
      } else {
        [evidence] = reparseBatchFn([candidate], { platform, stopOnBoundary: true });
      }
      if (evidence?.state === "reparse") {
        return { state: "excluded-reparse", path: path.resolve(candidate) };
      }
      if (evidence?.state !== "safe") {
        return {
          state: "unknown",
          path: path.resolve(candidate),
          code: sanitizedCode(evidence?.code, "PROBE_RESULT"),
        };
      }
    } catch (error) {
      if (error?.code === "ENOENT") return { state: "missing", path: path.resolve(candidate), code: "ENOENT" };
      return {
        state: "unknown",
        path: path.resolve(candidate),
        code: sanitizedCode(error?.code),
      };
    }
  }
  return { state: "safe" };
}

function remoteIdentity(value, cwd) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${port}${parsed.pathname.replace(/\.git$/, "")}`;
  } catch {
    // SCP-style Git remotes: drop the user component before comparing internally.
    const scp = /^(?:[^@\s]+@)?([^:\s]+):(.+)$/.exec(raw);
    if (scp)
      return `${scp[1].toLowerCase()}/${scp[2]
        .replace(/\\/g, "/")
        .replace(/\.git$/, "")
        .toLowerCase()}`;
    return normalizeWorktreePath(path.resolve(cwd, raw.replace(/\.git$/, "")));
  }
}

function buildDefaultRepositoryInspector(repositoryRoot, gitFn) {
  const errors = [];
  const root = path.resolve(repositoryRoot);
  const top = gitFn(["rev-parse", "--show-toplevel"], { cwd: root });
  const common = gitFn(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root });
  const listed = gitFn(["worktree", "list", "--porcelain", "-z"], { cwd: root });
  const remote = gitFn(["remote", "get-url", "origin"], { cwd: root });
  if (!top.ok || !top.stdout) errors.push(gitError("anchor-toplevel-unavailable", top));
  if (!common.ok || !common.stdout) errors.push(gitError("anchor-common-dir-unavailable", common));
  if (!listed.ok) errors.push(gitError("anchor-worktree-list-unavailable", listed));
  if (!remote.ok) errors.push(gitError("anchor-remote-identity-unavailable", remote));

  const anchorTop = top.ok && top.stdout ? path.resolve(top.stdout) : root;
  const anchorCommon = common.ok && common.stdout ? path.resolve(common.stdout) : null;
  const registeredPaths = new Set(
    listed.ok ? parseWorktreePorcelain(listed.stdout).map((item) => normalizeWorktreePath(item.path)) : [],
  );
  const anchorRemote = remote.ok ? remoteIdentity(remote.stdout, anchorTop) : null;
  if (remote.ok && !anchorRemote) {
    errors.push({ category: "anchor-remote-identity-invalid", code: "INVALID_REMOTE" });
  }

  const inspect = (candidatePath) => {
    const candidate = path.resolve(candidatePath);
    const candidateErrors = [];
    const candidateTop = gitFn(["rev-parse", "--show-toplevel"], { cwd: candidate });
    const candidateCommon = gitFn(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: candidate,
    });
    const candidateRemote = gitFn(["remote", "get-url", "origin"], { cwd: candidate });
    if (!candidateTop.ok || !candidateTop.stdout) {
      candidateErrors.push(gitError("checkout-toplevel-unavailable", candidateTop));
    }
    if (!candidateCommon.ok || !candidateCommon.stdout) {
      candidateErrors.push(gitError("checkout-common-dir-unavailable", candidateCommon));
    }
    if (candidateTop.ok && normalizeWorktreePath(candidateTop.stdout) !== normalizeWorktreePath(candidate)) {
      candidateErrors.push({ category: "checkout-toplevel-mismatch", code: "MISMATCH" });
    }

    const commonPath = candidateCommon.ok && candidateCommon.stdout ? path.resolve(candidateCommon.stdout) : null;
    let classification = "repository-unknown";
    const sameCommonDir =
      commonPath && anchorCommon && normalizeWorktreePath(commonPath) === normalizeWorktreePath(anchorCommon);
    if (sameCommonDir && listed.ok) {
      classification = registeredPaths.has(normalizeWorktreePath(candidate))
        ? "registered-worktree"
        : "unregistered-linked-checkout";
    } else if (commonPath && anchorCommon && !sameCommonDir && anchorRemote) {
      const identity = candidateRemote.ok ? remoteIdentity(candidateRemote.stdout, candidate) : null;
      if (!candidateRemote.ok) candidateErrors.push(gitError("checkout-remote-identity-unavailable", candidateRemote));
      if (identity && anchorRemote && identity === anchorRemote) classification = "separate-clone";
      else if (identity) classification = "other-repository";
    }
    if (candidateErrors.length > 0) classification = "repository-unknown";
    return { complete: candidateErrors.length === 0, classification, inspectionErrors: candidateErrors };
  };

  return { inspect, errors };
}

/**
 * @param {{ roots: string[], repositoryRoot?: string, maxDepth?: number, remove?: boolean, apply?: boolean }} options
 * @param {{ lstatFn?: typeof lstatSync, readdirFn?: typeof readdirSync,
 *   inspectPathSegmentsFn?: typeof inspectPathSegmentsForReparse,
 *   inspectRepositoryFn?: (path: string) => any, livenessResolver?: (path: string) => any,
 *   gitFn?: typeof runReadOnlyGit }} [adapters]
 */
export function scanInventoryRoots(options, adapters = {}) {
  assertReportOnlyOptions(options);
  if (!Array.isArray(options?.roots) || options.roots.length === 0) {
    throw new Error("At least one explicit inventory root is required.");
  }
  const sortedRoots = [
    ...new Map(options.roots.map((root) => [normalizedRootKey(root), path.resolve(root)])).values(),
  ].sort((left, right) => normalizeWorktreePath(left).localeCompare(normalizeWorktreePath(right)));
  assertNarrowInventoryRoots(sortedRoots);
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 4;
  if (maxDepth < 1 || maxDepth > 12) {
    throw new Error("--max-depth must be an integer from 1 to 12.");
  }
  const lstatFn = adapters.lstatFn ?? lstatSync;
  const readdirFn = adapters.readdirFn ?? readdirSync;
  const inspectPathSegmentsFn = adapters.inspectPathSegmentsFn ?? inspectPathSegmentsForReparse;
  const platform = adapters.platform ?? process.platform;
  const reparseBatchFn = adapters.reparseBatchFn ?? inspectWindowsReparsePaths;
  const reparsePointsFn = adapters.reparsePointsFn ?? inspectReparsePoints;
  const livenessResolver = adapters.livenessResolver ?? (() => undefined);
  const gitFn = adapters.gitFn ?? runReadOnlyGit;
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());

  let inspectRepositoryFn = adapters.inspectRepositoryFn;
  const inspectionErrors = [];
  if (!inspectRepositoryFn) {
    let anchorBoundary;
    try {
      anchorBoundary = inspectPathSegmentsFn(repositoryRoot, { lstatFn, platform, reparseBatchFn });
    } catch (error) {
      anchorBoundary = { state: "unknown", code: sanitizedCode(error?.code) };
    }
    if (anchorBoundary?.state === "safe") {
      const built = buildDefaultRepositoryInspector(repositoryRoot, gitFn);
      inspectRepositoryFn = built.inspect;
      inspectionErrors.push(...built.errors);
    } else {
      inspectionErrors.push({
        path: path.resolve(anchorBoundary?.path ?? repositoryRoot),
        category:
          anchorBoundary?.state === "excluded-reparse"
            ? "anchor-reparse-boundary-excluded"
            : "anchor-boundary-inspection-failed",
        code: sanitizedCode(anchorBoundary?.code, anchorBoundary?.state === "excluded-reparse" ? "REPARSE" : "UNKNOWN"),
      });
      inspectRepositoryFn = () => ({ complete: false, classification: "repository-unknown" });
    }
  }

  const roots = [];
  const checkouts = [];
  const emptyDirectories = [];
  const excludedBoundaries = [];
  const seenEmpty = new Set();
  const seenExcluded = new Set();
  const seenCheckouts = new Set();

  const addError = (pathValue, category, code = "UNKNOWN") => {
    inspectionErrors.push({ path: path.resolve(pathValue), category, code: sanitizedCode(code) });
  };

  const addExclusion = (rootPath, pathValue, category) => {
    const resolvedRoot = path.resolve(rootPath);
    const excludedPath = path.resolve(pathValue);
    const key = `${normalizeWorktreePath(resolvedRoot)}\0${normalizeWorktreePath(excludedPath)}\0${category}`;
    if (seenExcluded.has(key)) return;
    seenExcluded.add(key);
    excludedBoundaries.push({ root: resolvedRoot, path: excludedPath, category });
    addError(
      excludedPath,
      category === "reparse-boundary" ? "reparse-boundary-excluded" : "bounded-scan-exclusion",
      category === "reparse-boundary" ? "REPARSE" : "BOUNDED_EXCLUSION",
    );
  };

  const inspectLiveness = (candidatePath) => {
    let evidence;
    try {
      evidence = livenessResolver(candidatePath);
    } catch (error) {
      addError(candidatePath, "liveness-inspection-failed", error?.code);
    }
    return classifyLiveness(evidence);
  };

  const probeRecords = (records) => {
    try {
      const evidence = reparsePointsFn(records, { platform, batchFn: reparseBatchFn });
      if (Array.isArray(evidence) && evidence.length === records.length) return evidence;
    } catch {
      // A probe failure is represented uniformly below and always refuses descent.
    }
    return records.map(() => ({ state: "unknown", code: "MALFORMED_PROBE" }));
  };

  const walk = (currentPath, rootPath, depth, knownStat, knownReparse) => {
    const current = path.resolve(currentPath);
    let stat = knownStat;
    if (!stat) {
      try {
        stat = lstatFn(current);
      } catch (error) {
        addError(current, "lstat-unavailable", error?.code);
        return;
      }
    }
    const reparse = knownReparse ?? probeRecords([{ path: current, stat }])[0];
    if (reparse?.state === "reparse") {
      addExclusion(rootPath, current, "reparse-boundary");
      return;
    }
    if (reparse?.state !== "safe") {
      addError(current, "reparse-boundary-inspection-failed", reparse?.code);
      return;
    }
    if (!stat?.isDirectory?.()) {
      addError(current, "inventory-path-not-directory", "NOT_DIRECTORY");
      return;
    }

    let entries;
    try {
      entries = [...readdirFn(current, { withFileTypes: true })].sort((left, right) =>
        String(left.name).localeCompare(String(right.name)),
      );
    } catch (error) {
      addError(current, "readdir-unavailable", error?.code);
      return;
    }

    const marker = entries.find((entry) => entry.name === ".git");
    if (marker) {
      const markerPath = path.join(current, marker.name);
      let markerStat;
      try {
        markerStat = lstatFn(markerPath);
      } catch (error) {
        addError(markerPath, "git-marker-lstat-unavailable", error?.code);
        return;
      }
      const markerReparse = probeRecords([{ path: markerPath, stat: markerStat }])[0];
      if (markerReparse?.state === "reparse") {
        addExclusion(rootPath, markerPath, "reparse-boundary");
        return;
      }
      if (markerReparse?.state !== "safe") {
        addError(markerPath, "reparse-boundary-inspection-failed", markerReparse?.code);
        return;
      }
      let repository;
      try {
        repository = inspectRepositoryFn(current);
      } catch (error) {
        addError(current, "repository-inspection-threw", error?.code);
        return;
      }
      const repoErrors = Array.isArray(repository?.inspectionErrors) ? repository.inspectionErrors : [];
      for (const error of repoErrors) addError(current, error.category ?? "repository-inspection-failed", error.code);
      if (repository?.complete !== true && repoErrors.length === 0) {
        addError(current, "repository-inspection-incomplete", "INCOMPLETE");
      }

      const key = normalizeWorktreePath(current);
      if (!seenCheckouts.has(key)) {
        seenCheckouts.add(key);
        checkouts.push({
          root: rootPath,
          path: current,
          classification: repository?.classification ?? "repository-unknown",
          liveness: inspectLiveness(current),
          disposition: "report-only; no automated removal path exists",
        });
      }
      return;
    }

    if (entries.length === 0) {
      if (depth > 0) {
        const key = normalizeWorktreePath(current);
        if (!seenEmpty.has(key)) {
          seenEmpty.add(key);
          emptyDirectories.push({
            root: rootPath,
            path: current,
            liveness: inspectLiveness(current),
            disposition: "report-only; empty-directory removal is not available",
          });
        }
      }
      return;
    }
    if (depth >= maxDepth) {
      addError(current, "max-depth-reached", "DEPTH_LIMIT");
      return;
    }

    const childRecords = [];
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      let childStat;
      try {
        childStat = lstatFn(child);
      } catch (error) {
        addError(child, "lstat-unavailable", error?.code);
        continue;
      }
      childRecords.push({ entry, path: child, stat: childStat });
    }
    const childReparse = probeRecords(childRecords);
    for (let index = 0; index < childRecords.length; index += 1) {
      const { entry, path: child, stat: childStat } = childRecords[index];
      const reparseState = childReparse[index];
      if (reparseState?.state === "reparse") {
        addExclusion(rootPath, child, "reparse-boundary");
        continue;
      }
      if (reparseState?.state !== "safe") {
        addError(child, "reparse-boundary-inspection-failed", reparseState?.code);
        continue;
      }
      if (!childStat?.isDirectory?.()) continue;
      if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        addExclusion(rootPath, child, "bounded-scan-exclusion");
        continue;
      }
      walk(child, rootPath, depth + 1, childStat, reparseState);
    }
  };

  for (const root of sortedRoots) {
    let boundary;
    try {
      boundary = inspectPathSegmentsFn(root, { lstatFn, platform, reparseBatchFn });
    } catch (error) {
      boundary = { state: "unknown", path: root, code: sanitizedCode(error?.code) };
    }
    if (boundary?.state !== "safe") {
      roots.push({ path: root, complete: false, boundary: boundary?.state ?? "unknown" });
      if (boundary?.state === "excluded-reparse") {
        addExclusion(root, boundary.path ?? root, "reparse-boundary");
      } else {
        addError(boundary?.path ?? root, "root-boundary-inspection-failed", boundary?.code);
      }
      continue;
    }
    const errorsBefore = inspectionErrors.length;
    walk(root, root, 0, undefined, { state: "safe" });
    roots.push({ path: root, complete: inspectionErrors.length === errorsBefore });
  }

  roots.sort((left, right) => normalizeWorktreePath(left.path).localeCompare(normalizeWorktreePath(right.path)));
  checkouts.sort(
    (left, right) =>
      left.classification.localeCompare(right.classification) ||
      normalizeWorktreePath(left.path).localeCompare(normalizeWorktreePath(right.path)),
  );
  emptyDirectories.sort((left, right) =>
    normalizeWorktreePath(left.path).localeCompare(normalizeWorktreePath(right.path)),
  );
  excludedBoundaries.sort((left, right) =>
    normalizeWorktreePath(left.path).localeCompare(normalizeWorktreePath(right.path)),
  );
  inspectionErrors.sort(
    (left, right) =>
      normalizeWorktreePath(left.path ?? "").localeCompare(normalizeWorktreePath(right.path ?? "")) ||
      left.category.localeCompare(right.category),
  );

  return {
    mode: "report-only",
    complete: inspectionErrors.length === 0,
    repositoryRoot,
    maxDepth,
    roots,
    checkouts,
    emptyDirectories,
    excludedBoundaries,
    inspectionErrors,
    mutations: { ...ZERO_MUTATIONS },
  };
}

export function renderInventoryReport(report, { stdout = process.stdout } = {}) {
  const counts = new Map();
  for (const checkout of report.checkouts) {
    counts.set(checkout.classification, (counts.get(checkout.classification) ?? 0) + 1);
  }
  const lines = [
    "[worktree-inventory] REPORT ONLY — no files, refs, objects, registrations, or directories were changed.",
    `[worktree-inventory] Roots=${report.roots.length} checkouts=${report.checkouts.length} empty=${report.emptyDirectories.length} excluded-boundaries=${report.excludedBoundaries.length}.`,
    `[worktree-inventory] Inspection=${report.complete ? "complete" : "INCOMPLETE"}.`,
  ];
  for (const [classification, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`  - ${classification}: ${count}`);
  }
  if (!report.complete) {
    lines.push(`[worktree-inventory] Refused complete verdict: ${report.inspectionErrors.length} inspection error(s).`);
  }
  lines.push("[worktree-inventory] Mutations: cleaned=0 pruned=0 removed=0 deregistered=0.");
  stdout.write(`${lines.join("\n")}\n`);
}

export function runInventory(options, adapters = {}) {
  assertReportOnlyOptions(options);
  const report = scanInventoryRoots(options, adapters);
  if (options.json === true) (adapters.stdout ?? process.stdout).write(`${JSON.stringify(report, null, 2)}\n`);
  else renderInventoryReport(report, adapters);
  return report;
}

export function printHelp() {
  console.log(`worktrees:inventory — explicit-root, report-only fleet inventory.

Usage:
  npm run worktrees:inventory -- --root <path> [--root <path> ...] [options]

Options:
  --root <path>        Required, repeatable inventory root. No home-directory default exists.
  --repository <path>  Reference checkout used only for cached repository identity comparison.
  --max-depth <1..12>  Bounded traversal depth (default: 4); hitting it makes the report incomplete.
  --json               Emit structured JSON.
  --self-test          Run pure offline contract assertions.

The scanner never follows symbolic links, junctions, or link-like reparse boundaries.
Mutation flags are unsupported, and absence of process evidence remains liveness=unknown.`);
}

export function selfTest() {
  const parsed = parseInventoryArgs(["--root", "./fixture", "--root=./fixture"]);
  if (parsed.roots.length !== 1) throw new Error("self-test: roots were not deduplicated");
  let refused = false;
  try {
    parseInventoryArgs(["--apply"]);
  } catch {
    refused = true;
  }
  if (!refused) throw new Error("self-test: mutation option was accepted");
  console.log("[worktree-inventory] Report-only self-test passed.");
}

function main() {
  try {
    const options = parseInventoryArgs(process.argv.slice(2));
    if (options.help) return printHelp();
    if (options.selfTest) return selfTest();
    const report = runInventory(options);
    if (!report.complete) process.exitCode = 1;
  } catch (error) {
    console.error(`[worktree-inventory] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const isDirectRun = isDirectEntrypoint(import.meta.url);
if (isDirectRun) main();
