#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

export const RESERVED_HOSTED_ROLE = ["supabase", "admin"].join("_");
export const IMMUTABLE_HISTORICAL_MIGRATION = [
  "supabase",
  "migrations",
  `20260713102000_revoke_${RESERVED_HOSTED_ROLE}_default_privileges.sql`,
].join("/");
export const IMMUTABLE_HISTORICAL_SHA256 = "39a5f310f2207aed473b92128dd414d4fd8903d56d5802a3d749f81850cca541";

const GUARDED_EXACT_PATHS = new Set([
  "AGENTS.md",
  "package.json",
  "supabase/schema.sql",
  "supabase/roles.sql",
  "docs/disaster-recovery-runbook.md",
]);
const GUARDED_PATH_PREFIXES = [".github/actions/", ".github/workflows/", "scripts/", "supabase/migrations/"];
const BASE_REF = "origin/main";
const UNAVAILABLE = "unavailable";
const RESERVED_ROLE_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_])${RESERVED_HOSTED_ROLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_])`,
  "i",
);

function normalizePath(filePath) {
  return String(filePath)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function defaultRunGit(args, repoRoot) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function defaultInspectPath(absolutePath) {
  const stat = lstatSync(absolutePath);
  if (stat.isFile()) return { kind: "file", content: readFileSync(absolutePath) };
  if (stat.isDirectory()) return { kind: "directory" };
  if (stat.isSymbolicLink()) return { kind: "symbolic-link" };
  return { kind: "non-regular" };
}

function unavailableCoreDependency() {
  const error = new Error("repository dependency access failed");
  error.code = "DEPENDENCY_ACCESS";
  throw error;
}

function safeDependency(dependencies, key, fallback, brokenValue) {
  try {
    return dependencies?.[key] ?? fallback;
  } catch {
    return brokenValue;
  }
}

function repositoryDependencies(dependencies = {}) {
  const defaultRuntime = {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.versions.node,
  };
  return {
    runGit: safeDependency(dependencies, "runGit", defaultRunGit, unavailableCoreDependency),
    inspectPath: safeDependency(dependencies, "inspectPath", defaultInspectPath, unavailableCoreDependency),
    runtime: safeDependency(dependencies, "runtime", defaultRuntime, null),
  };
}

function sanitizedErrorCode(error, fallback = "UNKNOWN") {
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : fallback;
}

function safeRepositoryPath(filePath) {
  const normalized = normalizePath(filePath);
  const segments = normalized.split("/");
  const unsafe =
    !normalized ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..");
  return unsafe ? `<unsafe-path:${sha256(Buffer.from(String(filePath))).slice(0, 12)}>` : normalized;
}

function absoluteRepositoryPath(repoRoot, filePath) {
  const normalized = normalizePath(filePath);
  if (safeRepositoryPath(normalized).startsWith("<unsafe-path:")) return null;
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return null;
  return absolute;
}

function provenanceLabel(entry) {
  return entry.provenance === "tracked" || entry.provenance === "untracked" ? entry.provenance : "unknown";
}

function parseNulPaths(output) {
  return String(output ?? "")
    .split("\0")
    .filter(Boolean);
}

function migrationFilenameRange(paths, complete) {
  if (!complete) return { count: UNAVAILABLE, first: UNAVAILABLE, last: UNAVAILABLE };
  const filenames = paths
    .map(normalizePath)
    .filter((filePath) => filePath.startsWith("supabase/migrations/"))
    .map((filePath) => safeRepositoryPath(path.posix.basename(filePath)))
    .sort();
  return {
    count: filenames.length,
    first: filenames.at(0) ?? "none",
    last: filenames.at(-1) ?? "none",
  };
}

export function isGuardedMigrationRolePath(filePath) {
  const normalized = normalizePath(filePath);
  return GUARDED_EXACT_PATHS.has(normalized) || GUARDED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function referenceLines(content) {
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => RESERVED_ROLE_PATTERN.test(line))
    .map(({ lineNumber }) => lineNumber);
}

export function validateMigrationRoleEntries(entries, { requireHistorical = true } = {}) {
  const failures = [];
  let sawHistoricalMigration = false;

  for (const entry of entries) {
    const filePath = normalizePath(entry.path);
    const reportedPath = safeRepositoryPath(filePath);
    const provenance = provenanceLabel(entry);

    if (entry.inspectionError) {
      failures.push(
        `${reportedPath} [${provenance}]: guarded entry could not be inspected ` +
          `(category=${entry.inspectionError.category}, code=${entry.inspectionError.code})`,
      );
      if (filePath === IMMUTABLE_HISTORICAL_MIGRATION) sawHistoricalMigration = true;
      continue;
    }

    if (filePath === IMMUTABLE_HISTORICAL_MIGRATION) {
      sawHistoricalMigration = true;
      if (entry.content === null || entry.content === undefined) {
        failures.push(`${reportedPath} [${provenance}]: immutable applied migration is missing`);
        continue;
      }
      const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
      const actualHash = sha256(content);
      if (actualHash !== IMMUTABLE_HISTORICAL_SHA256) {
        failures.push(
          `${reportedPath} [${provenance}]: immutable applied migration changed ` +
            `(expected SHA-256 ${IMMUTABLE_HISTORICAL_SHA256}, got ${actualHash})`,
        );
      }
      continue;
    }

    if (!isGuardedMigrationRolePath(filePath)) continue;

    if (filePath.toLowerCase().includes(RESERVED_HOSTED_ROLE)) {
      failures.push(`${reportedPath} [${provenance}]: active file name references the reserved hosted role`);
    }

    if (entry.content === null || entry.content === undefined) continue;
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    if (content.includes(0)) continue;
    const lines = referenceLines(content.toString("utf8"));
    if (lines.length > 0) {
      failures.push(
        `${reportedPath} [${provenance}]: active content references the reserved hosted role ` +
          `(lines ${lines.join(",")}); hosted SQL and tooling must use postgres`,
      );
    }
  }

  if (requireHistorical && !sawHistoricalMigration) {
    failures.push(`${IMMUTABLE_HISTORICAL_MIGRATION} [not-discovered]: immutable applied migration is missing`);
  }

  return failures;
}

export function discoverRepositoryEntries(repoRoot = process.cwd(), dependencies = {}) {
  const { runGit, inspectPath } = repositoryDependencies(dependencies);
  const collectionFailures = [];

  function discover(provenance, args) {
    try {
      return { complete: true, paths: parseNulPaths(runGit(args, repoRoot)) };
    } catch (error) {
      collectionFailures.push(
        `repository ${provenance} discovery could not be completed (code=${sanitizedErrorCode(error)})`,
      );
      return { complete: false, paths: [] };
    }
  }

  const tracked = discover("tracked", ["ls-files", "--cached", "-z"]);
  const untracked = discover("untracked", ["ls-files", "--others", "--exclude-standard", "-z"]);
  const discoveredPaths = [...tracked.paths, ...untracked.paths];
  const entries = [];
  const seen = new Set();

  for (const [provenance, paths] of [
    ["tracked", tracked.paths],
    ["untracked", untracked.paths],
  ]) {
    for (const rawPath of paths) {
      const filePath = normalizePath(rawPath);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      if (!isGuardedMigrationRolePath(filePath)) continue;

      const absolutePath = absoluteRepositoryPath(repoRoot, filePath);
      if (!absolutePath) {
        entries.push({
          path: filePath,
          provenance,
          content: null,
          inspectionError: { category: "invalid-path", code: "INVALID_PATH" },
        });
        continue;
      }

      try {
        const inspection = inspectPath(absolutePath, filePath);
        if (inspection?.kind !== "file") {
          const directory = inspection?.kind === "directory";
          entries.push({
            path: filePath,
            provenance,
            content: null,
            inspectionError: {
              category: directory ? "directory" : "non-regular",
              code: directory ? "EISDIR" : "NON_REGULAR",
            },
          });
          continue;
        }
        if (inspection.content === null || inspection.content === undefined) {
          entries.push({
            path: filePath,
            provenance,
            content: null,
            inspectionError: { category: "read-error", code: "NO_CONTENT" },
          });
          continue;
        }
        entries.push({ path: filePath, provenance, content: inspection.content });
      } catch (error) {
        entries.push({
          path: filePath,
          provenance,
          content: null,
          inspectionError: { category: "read-error", code: sanitizedErrorCode(error) },
        });
      }
    }
  }

  const complete = tracked.complete && untracked.complete;
  return {
    entries,
    collectionFailures,
    counts: {
      tracked: tracked.complete ? tracked.paths.length : UNAVAILABLE,
      untracked: untracked.complete ? untracked.paths.length : UNAVAILABLE,
      guarded: complete ? entries.length : UNAVAILABLE,
      readErrors: complete ? entries.filter((entry) => entry.inspectionError).length : UNAVAILABLE,
    },
    migrations: migrationFilenameRange(discoveredPaths, complete),
  };
}

export function repositoryEntries(repoRoot = process.cwd(), dependencies = {}) {
  return discoverRepositoryEntries(repoRoot, dependencies).entries;
}

function safeRuntimeValue(runtime, field) {
  try {
    const normalized = String(runtime?.[field] ?? "");
    return /^[A-Za-z0-9._-]{1,64}$/.test(normalized) ? normalized : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

function exactSha(value) {
  const normalized = String(value ?? "").trim();
  return /^[a-f0-9]{40}$/i.test(normalized) ? normalized.toLowerCase() : UNAVAILABLE;
}

function diagnosticGit(runGit, repoRoot, args) {
  try {
    return String(runGit(args, repoRoot) ?? "").trim();
  } catch {
    return UNAVAILABLE;
  }
}

export function collectRepositoryDiagnostics(repoRoot, discovery, dependencies = {}) {
  const { runGit, runtime } = repositoryDependencies(dependencies);
  const head = exactSha(diagnosticGit(runGit, repoRoot, ["rev-parse", "--verify", "HEAD"]));
  const shallowOutput = diagnosticGit(runGit, repoRoot, ["rev-parse", "--is-shallow-repository"]);
  const shallow = shallowOutput === "true" || shallowOutput === "false" ? shallowOutput : UNAVAILABLE;
  const baseCommit = exactSha(
    diagnosticGit(runGit, repoRoot, ["rev-parse", "--verify", "--quiet", `${BASE_REF}^{commit}`]),
  );
  const baseRef = baseCommit === UNAVAILABLE ? UNAVAILABLE : BASE_REF;
  let mergeBase = UNAVAILABLE;
  let ahead = UNAVAILABLE;
  let behind = UNAVAILABLE;

  if (baseRef !== UNAVAILABLE && shallow === "false") {
    mergeBase = exactSha(diagnosticGit(runGit, repoRoot, ["merge-base", "HEAD", BASE_REF]));
    const relationship = diagnosticGit(runGit, repoRoot, ["rev-list", "--left-right", "--count", `${BASE_REF}...HEAD`]);
    const match = /^(\d+)\s+(\d+)$/.exec(relationship);
    if (match) {
      behind = Number(match[1]);
      ahead = Number(match[2]);
    }
  }

  return {
    head,
    base: { ref: baseRef, commit: baseCommit, mergeBase, ahead, behind },
    shallow,
    runtime: {
      platform: safeRuntimeValue(runtime, "platform"),
      architecture: safeRuntimeValue(runtime, "architecture"),
      nodeVersion: safeRuntimeValue(runtime, "nodeVersion"),
    },
    counts: { ...discovery.counts },
    migrations: { ...discovery.migrations },
  };
}

function renderRepositoryDiagnostics(diagnostics) {
  const base = diagnostics.base;
  const runtime = diagnostics.runtime;
  const counts = diagnostics.counts;
  const migrations = diagnostics.migrations;
  return [
    "Hosted migration-role diagnostics:",
    `- HEAD: ${diagnostics.head}`,
    `- base: ref=${base.ref} commit=${base.commit} merge-base=${base.mergeBase} ahead=${base.ahead} behind=${base.behind}`,
    `- shallow: ${diagnostics.shallow}`,
    `- runtime: platform=${runtime.platform} architecture=${runtime.architecture} node=${runtime.nodeVersion}`,
    `- entries: tracked=${counts.tracked} untracked=${counts.untracked} guarded=${counts.guarded} read-errors=${counts.readErrors}`,
    `- migrations: count=${migrations.count} first=${migrations.first} last=${migrations.last}`,
  ].join("\n");
}

export function formatRepositoryDiagnostics(diagnostics) {
  try {
    return renderRepositoryDiagnostics(diagnostics);
  } catch {
    return renderRepositoryDiagnostics(unavailableRepositoryDiagnostics());
  }
}

export function inspectMigrationRoleRepository(repoRoot = process.cwd(), dependencies = {}) {
  const discovery = discoverRepositoryEntries(repoRoot, dependencies);
  const failures = [...discovery.collectionFailures, ...validateMigrationRoleEntries(discovery.entries)];
  return {
    failures,
    diagnostics: failures.length > 0 ? collectRepositoryDiagnostics(repoRoot, discovery, dependencies) : null,
  };
}

export function validateRepository(repoRoot = process.cwd(), dependencies = {}) {
  return inspectMigrationRoleRepository(repoRoot, dependencies).failures;
}

function unavailableDiscovery() {
  return {
    counts: { tracked: UNAVAILABLE, untracked: UNAVAILABLE, guarded: UNAVAILABLE, readErrors: UNAVAILABLE },
    migrations: { count: UNAVAILABLE, first: UNAVAILABLE, last: UNAVAILABLE },
  };
}

function unavailableRepositoryDiagnostics() {
  const discovery = unavailableDiscovery();
  return {
    head: UNAVAILABLE,
    base: {
      ref: UNAVAILABLE,
      commit: UNAVAILABLE,
      mergeBase: UNAVAILABLE,
      ahead: UNAVAILABLE,
      behind: UNAVAILABLE,
    },
    shallow: UNAVAILABLE,
    runtime: { platform: UNAVAILABLE, architecture: UNAVAILABLE, nodeVersion: UNAVAILABLE },
    counts: discovery.counts,
    migrations: discovery.migrations,
  };
}

export function runMigrationRoleGuard({
  repoRoot = process.cwd(),
  dependencies = {},
  writeOutput = console.log,
  writeError = console.error,
} = {}) {
  let result;
  try {
    result = inspectMigrationRoleRepository(repoRoot, dependencies);
  } catch {
    result = {
      failures: ["repository inspection could not be completed (code=UNEXPECTED)"],
      diagnostics: unavailableRepositoryDiagnostics(),
    };
  }

  const { failures } = result;
  if (failures.length > 0) {
    writeError("Hosted migration-role guard failed:");
    for (const failure of failures) writeError(`- ${failure}`);
    writeError(formatRepositoryDiagnostics(result.diagnostics));
    writeError(
      `Only ${IMMUTABLE_HISTORICAL_MIGRATION} may retain the legacy role reference, and its bytes are pinned. ` +
        "Use role postgres for hosted migrations, schema snapshots, CI, and deployment tooling.",
    );
    return 1;
  }

  writeOutput(
    "Hosted migration-role guard passed: active hosted SQL/tooling uses postgres and immutable applied history is unchanged.",
  );
  return 0;
}

if (isDirectEntrypoint(import.meta.url)) process.exitCode = runMigrationRoleGuard();
