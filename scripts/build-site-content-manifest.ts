import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { allSiteContentRecords } from "../src/lib/site-content/adapters";
import {
  buildStaticSiteContentManifest,
  canonicalSiteContentJson,
  compareCanonicalSiteContentIdentifiers,
  type StaticSiteContentManifest,
  validateStaticSiteContentManifest,
} from "../src/lib/site-content/site-content-manifest";
import { SITE_CONTENT_REGISTRY_VERSION } from "../src/lib/site-content/site-content-registry";

const defaultBaselinePath = "tests/fixtures/site-content/static-manifest-baseline.json";

type CliOptions = {
  check: boolean;
  outPath?: string;
  baselinePath?: string;
  diffPath?: string;
};

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check") {
      options.check = true;
      continue;
    }
    if (token === "--out" || token === "--baseline" || token === "--diff") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a path.`);
      if (token === "--out") options.outPath = value;
      if (token === "--baseline") options.baselinePath = value;
      if (token === "--diff") options.diffPath = value;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.check && !options.outPath && !options.diffPath) {
    throw new Error("Use --check, --out <path>, or --baseline <path> --diff <path>.");
  }
  if (options.diffPath && !options.baselinePath) throw new Error("--diff requires --baseline <path>.");
  return options;
}

function currentGitSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function readManifest(path: string): StaticSiteContentManifest {
  try {
    return validateStaticSiteContentManifest(JSON.parse(readFileSync(path, "utf8")), {
      expectedRegistryVersion: SITE_CONTENT_REGISTRY_VERSION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid static site-content manifest ${path}: ${message}`);
  }
}

function pathIdentity(path: string) {
  const absolute = resolve(path);
  let existingAncestor = absolute;
  const unresolvedSuffix: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    unresolvedSuffix.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  const canonicalAncestor = existsSync(existingAncestor) ? realpathSync.native(existingAncestor) : existingAncestor;
  const canonical = resolve(canonicalAncestor, ...unresolvedSuffix);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function resolvePaths(options: CliOptions) {
  const baselinePath = options.baselinePath ?? (options.check ? defaultBaselinePath : undefined);
  const paths = {
    baselinePath: baselinePath ? resolve(baselinePath) : undefined,
    outPath: options.outPath ? resolve(options.outPath) : undefined,
    diffPath: options.diffPath ? resolve(options.diffPath) : undefined,
  };
  const specified = Object.entries(paths).filter((entry): entry is [string, string] => Boolean(entry[1]));
  for (let leftIndex = 0; leftIndex < specified.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < specified.length; rightIndex += 1) {
      const left = specified[leftIndex]!;
      const right = specified[rightIndex]!;
      if (pathIdentity(left[1]) === pathIdentity(right[1])) {
        throw new Error(`${left[0]} and ${right[0]} must not resolve to the same path.`);
      }
    }
  }
  return paths;
}

type AtomicWriteOperations = {
  writeFileSync: (path: string, value: string, encoding: "utf8") => void;
  renameSync: (source: string, target: string) => void;
  rmSync: (path: string, options: { force: true }) => void;
};

export function writeJsonAtomically(
  path: string,
  value: unknown,
  operations: AtomicWriteOperations = { writeFileSync, renameSync, rmSync },
) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    operations.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    operations.renameSync(temporaryPath, path);
  } catch (error) {
    operations.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function manifestDiff(baseline: StaticSiteContentManifest, candidate: StaticSiteContentManifest) {
  const baselineById = new Map(baseline.records.map((record) => [record.logicalId, record] as const));
  const candidateById = new Map(candidate.records.map((record) => [record.logicalId, record] as const));
  const added = [...candidateById.keys()]
    .filter((id) => !baselineById.has(id))
    .sort(compareCanonicalSiteContentIdentifiers);
  const removed = [...baselineById.keys()]
    .filter((id) => !candidateById.has(id))
    .sort(compareCanonicalSiteContentIdentifiers);
  const changed = [...candidateById.entries()]
    .filter(([id, record]) => {
      const previous = baselineById.get(id);
      return previous && canonicalSiteContentJson(previous) !== canonicalSiteContentJson(record);
    })
    .map(([logicalId]) => logicalId)
    .sort(compareCanonicalSiteContentIdentifiers);
  return {
    version: "clinical-kb-site-static-manifest-diff-v1",
    baselineDigest: baseline.staticManifestDigest,
    candidateDigest: candidate.staticManifestDigest,
    added,
    removed,
    changed,
    unchanged:
      baseline.version === candidate.version &&
      baseline.registryVersion === candidate.registryVersion &&
      baseline.staticManifestDigest === candidate.staticManifestDigest &&
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0,
  };
}

function summary(manifest: StaticSiteContentManifest) {
  const domains = Object.fromEntries(
    [...new Set(manifest.records.map((record) => record.domain))]
      .sort(compareCanonicalSiteContentIdentifiers)
      .map((domain) => [domain, manifest.records.filter((record) => record.domain === domain).length]),
  );
  return {
    version: manifest.version,
    registryVersion: manifest.registryVersion,
    recordCount: manifest.records.length,
    eligibleCount: manifest.records.filter((record) => record.eligible).length,
    staticManifestDigest: manifest.staticManifestDigest,
    domains,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(options);
  const candidate = validateStaticSiteContentManifest(
    buildStaticSiteContentManifest(allSiteContentRecords, {
      gitSha: currentGitSha(),
      registryVersion: SITE_CONTENT_REGISTRY_VERSION,
    }),
    { expectedRegistryVersion: SITE_CONTENT_REGISTRY_VERSION },
  );

  let diff: ReturnType<typeof manifestDiff> | undefined;
  if (paths.baselinePath) {
    diff = manifestDiff(readManifest(paths.baselinePath), candidate);
  }
  if (options.check && !diff?.unchanged) {
    throw new Error(`Static site-content manifest differs from ${paths.baselinePath}.`);
  }
  if (paths.outPath) writeJsonAtomically(paths.outPath, candidate);
  if (paths.diffPath) writeJsonAtomically(paths.diffPath, diff);
  console.log(
    JSON.stringify({
      status: options.check ? "checked" : "built",
      ...summary(candidate),
      ...(diff
        ? {
            baselineDigest: diff.baselineDigest,
            addedCount: diff.added.length,
            removedCount: diff.removed.length,
            changedCount: diff.changed.length,
          }
        : {}),
      ...(options.outPath ? { output: options.outPath } : {}),
      ...(options.diffPath ? { diffOutput: options.diffPath } : {}),
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(existsSync(process.argv[1]) ? realpathSync(resolve(process.argv[1])) : resolve(process.argv[1])).href
)
  main();
