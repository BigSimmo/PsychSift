#!/usr/bin/env node
/**
 * check-dependency-drift — has a surface's GROUND moved, not just its own files.
 *
 * Every staleness check in this repository asks "has a file I NAMED changed?" while
 * presenting itself as answering "has anything my code DEPENDS ON changed?" Those are
 * different questions, and the second one needs the import closure — the full transitive
 * set of files a surface reaches through its own imports — which nobody computes. A file
 * that changed underneath a surface, three imports deep, with a name that shares nothing
 * with the surface's own directory, is invisible to `git diff` read by eye and invisible to
 * a name/grep search for the surface's directory. This script computes the closure and
 * reports exactly which changed files a name search would have missed.
 *
 * ALGORITHM:
 *   1. SEED    — every .ts/.tsx file under --surface.
 *   2. CLOSURE — follow every relative ("./", "../") and aliased ("@/") import
 *                transitively, resolving each specifier by trying, in order: the literal
 *                path, +".ts", +".tsx", +".js", +".jsx", +"/index.ts", +"/index.tsx". Bare
 *                package specifiers (react, next/*, lucide-react, ...) are ignored but
 *                counted. Iterated to a fixed point.
 *   3. DIFF    — `git diff --name-only $(git merge-base HEAD <against>) <against>`.
 *   4. Intersect the closure with that diff.
 *   5. Split the intersection into files whose path contains the surface directory's own
 *      basename ("findable by a name search") and files that do not ("INVISIBLE to a name
 *      search"). That split is the entire point of this tool.
 *
 * TWO CONTROLS, built into the tool rather than left to documentation:
 *   CONTROL A — unresolved local specifiers. A broken resolver yields a short closure and a
 *               confidently clean answer, which is worse than no answer. Any relative or
 *               "@/" specifier that fails every resolution attempt is reported by name and
 *               file, and the run exits non-zero before it ever prints a report.
 *   CONTROL B — self-intersection. `intersect(closure, closure)` must equal `closure`; if it
 *               does not, the set-comparison logic itself is dropping rows and the run exits
 *               non-zero before trusting anything downstream of it.
 *
 * FOUR LIMITS, printed on every run (not just documented here):
 *   - File-level, not symbol-level. N changed files is NOT N problems — it is N places where
 *     "nothing I depend on moved" was assumed and is false.
 *   - Static imports only. A dynamic import() built from a template literal is invisible.
 *     "Zero unresolved" proves every specifier it MATCHED resolved, NOT that it matched
 *     every specifier there was.
 *   - Outward only. It answers "has my ground moved", not "what else did I break".
 *   - It is a snapshot: both the resolved HEAD sha and the --against ref's sha are printed.
 *
 * Usage:
 *   node scripts/check-dependency-drift.mjs --surface <path-under-repo> --against <git-ref>
 *
 * Exit 0 = report printed (the report can still show invisible drift — that is a finding,
 * not a failure). Exit 1 = a control tripped, or the closure/diff computation itself failed.
 * Exit 2 = bad arguments.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename as pathBasename, dirname, relative, resolve } from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

/**
 * @typedef {object} FileSystemAdapter
 * @property {(path: string, encoding: "utf8") => string} readFileSync
 * @property {(path: string, options: { withFileTypes: true }) => import("node:fs").Dirent[]} readdirSync
 * @property {(path: string) => import("node:fs").Stats} statSync
 */

/** @type {FileSystemAdapter} */
const NODE_FILE_SYSTEM = { readFileSync, readdirSync, statSync };

/** @typedef {(args: string[], root: string) => string} GitRunner */

const errorMessage = (error) => (error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error));

/** Repository paths are always reported with `/`, including on Windows. */
export function normalizeRepoPath(file) {
  return String(file)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
}

const absoluteRepoPath = (root, file) => resolve(root, ...normalizeRepoPath(file).split("/").filter(Boolean));

const relativeRepoPath = (root, file) => normalizeRepoPath(relative(resolve(root), file));

/** Git is repository-guaranteed, but every failed command is a safety error. @type {GitRunner} */
const sh = (args, root = process.cwd()) => {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.stdout?.toString().trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail.split(/\r?\n/, 1)[0]}` : ""}`, { cause: error });
  }
};

// ---------------------------------------------------------------------------------------
// SEED
// ---------------------------------------------------------------------------------------

function walkTypeScriptFiles(absoluteDirectory, fileSystem) {
  const found = [];

  function visit(directory) {
    let entries;
    try {
      entries = fileSystem.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`cannot list ${directory}: ${errorMessage(error)}`, { cause: error });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(path);
    }
  }

  visit(absoluteDirectory);
  return found;
}

// ---------------------------------------------------------------------------------------
// CLOSURE — static import extraction and resolution
// ---------------------------------------------------------------------------------------

// Each pattern excludes `'`, `"` and `;` from its "anything goes" span, which is what stops
// a statement with no resolvable specifier (a bare side-effect import with no closing
// quote reached, an unrelated later statement) from letting the match run on past it. That
// is a deliberate property of these patterns, not an incidental one — see the walk-through
// in the module doc comment above ("static imports only").
const IMPORT_FROM_RE = /\bimport\s+(?:type\s+)?[^'";]*?\bfrom\s+["']([^"']+)["']/g;
const EXPORT_FROM_RE =
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+["']([^"']+)["']/g;

/** Best-effort static extraction. A specifier built from a template literal is invisible — see the "static imports only" limit. */
export function extractImportSpecifiers(source) {
  const specifiers = [];
  for (const pattern of [IMPORT_FROM_RE, EXPORT_FROM_RE, DYNAMIC_IMPORT_RE, SIDE_EFFECT_IMPORT_RE]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) specifiers.push(match[1]);
  }
  return specifiers;
}

/** @returns {"relative" | "aliased" | "bare"} */
export function classifySpecifier(specifier) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return "relative";
  if (specifier.startsWith("@/")) return "aliased";
  return "bare";
}

const RESOLUTION_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];

/** Tries, in order: the literal path, then each suffix appended to it. First existing file wins. */
function resolveToExistingFile(basePathWithoutSuffix, fileSystem) {
  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = `${basePathWithoutSuffix}${suffix}`;
    try {
      if (fileSystem.statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next suffix
    }
  }
  return null;
}

/**
 * Resolves one relative/aliased specifier to an absolute file path, or null if unresolved.
 * `@/*` maps to `<root>/src/*`, matching this repo's tsconfig `paths`.
 */
export function resolveSpecifier(specifier, kind, importingAbsoluteFile, root, fileSystem = NODE_FILE_SYSTEM) {
  const basePath =
    kind === "relative" ? resolve(dirname(importingAbsoluteFile), specifier) : resolve(root, "src", specifier.slice(2));
  return resolveToExistingFile(basePath, fileSystem);
}

/**
 * @param {object} options
 * @param {string} options.surfaceAbsoluteDir
 * @param {string} options.root
 * @param {FileSystemAdapter} [options.fileSystem]
 * @returns {{
 *   seedFiles: string[],
 *   closure: Set<string>,
 *   unresolved: Array<{ file: string, specifier: string }>,
 *   bareSpecifiers: Set<string>,
 * }} repo-relative, forward-slash paths throughout.
 */
export function computeClosure({ surfaceAbsoluteDir, root, fileSystem = NODE_FILE_SYSTEM }) {
  const seedAbsoluteFiles = walkTypeScriptFiles(surfaceAbsoluteDir, fileSystem);
  const closureAbsolute = new Set(seedAbsoluteFiles);
  const queue = [...seedAbsoluteFiles];
  const unresolved = [];
  const seenUnresolved = new Set();
  const bareSpecifiers = new Set();

  while (queue.length) {
    const currentAbsolute = queue.shift();
    let source;
    try {
      source = fileSystem.readFileSync(currentAbsolute, "utf8");
    } catch {
      // A resolved-but-unreadable file (permissions, race) is not a specifier-resolution
      // failure; it simply contributes no further edges to the closure.
      continue;
    }

    for (const specifier of extractImportSpecifiers(source)) {
      const kind = classifySpecifier(specifier);
      if (kind === "bare") {
        bareSpecifiers.add(specifier);
        continue;
      }

      const resolved = resolveSpecifier(specifier, kind, currentAbsolute, root, fileSystem);
      if (!resolved) {
        const file = relativeRepoPath(root, currentAbsolute);
        const key = `${file}::${specifier}`;
        if (!seenUnresolved.has(key)) {
          seenUnresolved.add(key);
          unresolved.push({ file, specifier });
        }
        continue;
      }

      if (!closureAbsolute.has(resolved)) {
        closureAbsolute.add(resolved);
        queue.push(resolved);
      }
    }
  }

  return {
    seedFiles: seedAbsoluteFiles.map((file) => relativeRepoPath(root, file)).sort(),
    closure: new Set([...closureAbsolute].map((file) => relativeRepoPath(root, file))),
    unresolved,
    bareSpecifiers,
  };
}

// ---------------------------------------------------------------------------------------
// Set logic (CONTROL B lives on this) and the findable/invisible split
// ---------------------------------------------------------------------------------------

/** @param {Set<string>} setA @param {Set<string>} setB @returns {Set<string>} */
export function intersect(setA, setB) {
  const result = new Set();
  for (const item of setA) if (setB.has(item)) result.add(item);
  return result;
}

/**
 * The entire point of this tool: which changed dependencies would a name search for the
 * surface's own directory have found, and which would it have missed entirely.
 * @param {Iterable<string>} paths
 * @param {string} surfaceBasename
 */
export function splitByFindability(paths, surfaceBasename) {
  const findable = [];
  const invisible = [];
  for (const path of paths) {
    if (path.includes(surfaceBasename)) findable.push(path);
    else invisible.push(path);
  }
  findable.sort();
  invisible.sort();
  return { findable, invisible };
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

const CLI_USAGE = "usage: --surface <path-under-repo> --against <git-ref>";

function parseArguments(argv) {
  const values = { surface: null, against: null };
  const optionKeys = new Map([
    ["--surface", "surface"],
    ["--against", "against"],
  ]);

  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    const key = optionKeys.get(option);
    if (!key) throw new Error(`unknown argument: ${option}`);
    if (values[key] !== null) throw new Error(`duplicate option: ${option}`);

    const value = argv[++index];
    if (typeof value !== "string" || value.length === 0) throw new Error(`${option} requires a value`);
    if (value.startsWith("-")) throw new Error(`${option} requires a non-option value`);
    values[key] = value;
  }

  if (!values.surface || !values.against) throw new Error("--surface and --against are both required");
  return { surface: values.surface, against: values.against };
}

export function main(
  argv = process.argv.slice(2),
  {
    root = process.cwd(),
    runGit = sh,
    fileSystem = NODE_FILE_SYSTEM,
    stdout = console.log,
    stderr = console.error,
  } = {},
) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    stderr(`${errorMessage(error)}\n${CLI_USAGE}`);
    return 2;
  }

  const surfaceRelative = normalizeRepoPath(parsed.surface);
  const surfaceBasename = pathBasename(surfaceRelative);
  const surfaceAbsoluteDir = absoluteRepoPath(root, surfaceRelative);

  let closureResult;
  try {
    closureResult = computeClosure({ surfaceAbsoluteDir, root, fileSystem });
  } catch (error) {
    stderr(`[dependency-drift] REFUSE — closure computation failed: ${errorMessage(error)}`);
    return 1;
  }
  const { seedFiles, closure, unresolved, bareSpecifiers } = closureResult;

  // CONTROL A — an unresolved local specifier makes the closure short and the answer a lie.
  if (unresolved.length > 0) {
    stderr(
      `[dependency-drift] CONTROL A FAILED — ${unresolved.length} unresolved local specifier(s). ` +
        `A broken resolver yields a short closure and a confidently clean answer; refusing to report.`,
    );
    for (const { file, specifier } of unresolved) stderr(`    ${file} -> ${specifier}`);
    return 1;
  }

  // CONTROL B — the set-comparison logic must not drop rows on its own output.
  const selfIntersection = intersect(closure, closure);
  if (selfIntersection.size !== closure.size) {
    stderr(
      `[dependency-drift] CONTROL B FAILED — self-intersection has ${selfIntersection.size} member(s), ` +
        `closure has ${closure.size}. The set-comparison logic is dropping rows; refusing to report.`,
    );
    return 1;
  }

  let headSha;
  let againstSha;
  let mergeBaseSha;
  let diffFiles;
  try {
    headSha = runGit(["rev-parse", "HEAD"], root).trim();
    againstSha = runGit(["rev-parse", parsed.against], root).trim();
    mergeBaseSha = runGit(["merge-base", "HEAD", parsed.against], root).trim();
    diffFiles = runGit(["diff", "--name-only", mergeBaseSha, parsed.against], root)
      .split(/\r?\n/)
      .filter(Boolean)
      .map(normalizeRepoPath);
  } catch (error) {
    stderr(`[dependency-drift] REFUSE — git setup failed: ${errorMessage(error)}`);
    return 1;
  }

  const changed = intersect(closure, new Set(diffFiles));
  const { findable, invisible } = splitByFindability(changed, surfaceBasename);
  const ratio = seedFiles.length > 0 ? closure.size / seedFiles.length : 0;

  stdout(`[dependency-drift] surface: ${surfaceRelative}`);
  stdout(`[dependency-drift] HEAD: ${headSha}`);
  stdout(`[dependency-drift] against: ${parsed.against} (${againstSha})`);
  stdout(`[dependency-drift] merge-base: ${mergeBaseSha}`);
  stdout(`[dependency-drift] control A: 0 unresolved local specifiers`);
  stdout(`[dependency-drift] control B: self-intersection holds (${closure.size})`);
  stdout(
    `[dependency-drift] seed: ${seedFiles.length} · closure: ${closure.size} · ratio: ${ratio.toFixed(1)}x ` +
      `· bare package specifiers referenced: ${bareSpecifiers.size}`,
  );
  stdout(
    `[dependency-drift] closure ∩ diff (changed dependencies): ${changed.size} — ` +
      `${findable.length} findable, ${invisible.length} INVISIBLE`,
  );
  stdout(`[dependency-drift]   findable by a name search for "${surfaceBasename}": ${findable.length}`);
  for (const file of findable) stdout(`      ${file}`);
  stdout(`[dependency-drift]   INVISIBLE to a name search for "${surfaceBasename}": ${invisible.length}`);
  for (const file of invisible) stdout(`      ${file}`);
  stdout("");
  stdout("[dependency-drift] limits — read before trusting the numbers above:");
  stdout(
    '  - File-level, not symbol-level. N changed files is NOT N problems — it is N places where "nothing I' +
      ' depend on moved" was assumed and is false.',
  );
  stdout(
    '  - Static imports only. A dynamic import() built from a template literal is invisible. "Zero' +
      ' unresolved" proves every specifier it MATCHED resolved, NOT that it matched every specifier.',
  );
  stdout('  - Outward only. It answers "has my ground moved", not "what else did I break".');
  stdout(`  - This is a snapshot: HEAD=${headSha}, --against ${parsed.against}=${againstSha}.`);

  return 0;
}

const invokedAsScript = isDirectEntrypoint(import.meta.url);
if (invokedAsScript) process.exitCode = main();
