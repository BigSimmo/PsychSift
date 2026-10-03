#!/usr/bin/env node
/**
 * check-dead-code-candidate — refuse to call a symbol dead on "nothing imports it".
 *
 * Written after the 2026-08-20 cleanup sweep (PR #2204) targeted ~1,644 lines on that
 * single test and had to be walked back seven times. Four of those seven survivors —
 * Ward Flow's `wallClockNow` and `movementsByStage`, Caring Contacts' fixtures, and
 * `bestEffortReembedRegistryRecordAfterEdit` — had zero importers and were all alive.
 * "No importer" is necessary and nowhere near sufficient: a module contract whose
 * consumer has not been written yet looks exactly like dead code to a reachability scan.
 *
 * Every check below exists because it caught a real would-be deletion in that sweep.
 * The gate fails CLOSED: an unanswerable question (shallow clone, unreadable file) is a
 * REFUSE, never a pass, because the sweep's whole failure mode was proceeding on a weak
 * signal when the strong one was unavailable.
 *
 * Usage:
 *   node scripts/check-dead-code-candidate.mjs --symbol <name> --file <path> [...]
 *   node scripts/check-dead-code-candidate.mjs --diff <base-ref>     # audit a whole diff
 *   node scripts/check-dead-code-candidate.mjs --self-test
 *
 * Exit 0 = every candidate cleared. Exit 1 = at least one REFUSE.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

/**
 * @param {string | number | null | undefined} [raw]
 * @returns {number}
 */
export function parseRecentDays(raw = process.env.DEAD_CODE_RECENT_DAYS) {
  const fallback = raw === undefined || raw === null || raw === "" ? 30 : raw;
  const configuredRecentDays = Number(fallback);
  if (!Number.isFinite(configuredRecentDays) || configuredRecentDays < 0) {
    throw new Error(`DEAD_CODE_RECENT_DAYS must be a non-negative number: ${raw}`);
  }
  return configuredRecentDays;
}

const RECENT_DAYS = parseRecentDays();

/**
 * Minimal dependency surface used by the injectable filesystem adapter.
 *
 * @typedef {object} FileSystemAdapter
 * @property {(path: string, encoding: "utf8") => string} readFileSync
 * @property {(path: string, options: { withFileTypes: true }) => import("node:fs").Dirent[]} readdirSync
 * @property {(path: string) => import("node:fs").Stats} statSync
 */

/** @typedef {(args: string[], root: string) => string} GitRunner */

/** @type {FileSystemAdapter} */
const NODE_FILE_SYSTEM = { readFileSync, readdirSync, statSync };

const errorMessage = (error) => (error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error));

/** Repository paths are always reported with `/`, including on Windows. */
export function normalizeRepoPath(file) {
  return String(file)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/");
}

const absoluteRepoPath = (root, file) => resolve(root, ...normalizeRepoPath(file).split("/").filter(Boolean));

const relativeRepoPath = (root, file) => normalizeRepoPath(relative(resolve(root), file));

/**
 * Git is repository-guaranteed, but every failed command is a safety error.
 * @type {GitRunner}
 */
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
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail.split(/\r?\n/, 1)[0]}` : ""}`, {
      cause: error,
    });
  }
};

function walkFiles(searchRoot, { root, fileSystem }) {
  const absoluteRoot = absoluteRepoPath(root, searchRoot);
  const files = [];

  function visit(directory) {
    let entries;
    try {
      entries = fileSystem.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      const target = relativeRepoPath(root, directory) || normalizeRepoPath(searchRoot);
      throw new Error(`content search failed for ${target}: ${errorMessage(error)}`, { cause: error });
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      } else if (entry.isSymbolicLink()) {
        // Search the target only when it is a regular file. A directory link or
        // a dangling link is not searchable content and must not fail the gate.
        let target;
        try {
          target = fileSystem.statSync(absolutePath);
        } catch (error) {
          if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
          throw new Error(`content search failed for ${relativeRepoPath(root, absolutePath)}: ${errorMessage(error)}`, {
            cause: error,
          });
        }
        if (target.isFile()) files.push(absolutePath);
      }
    }
  }

  visit(absoluteRoot);
  return files;
}

function createContentIndex({ root = process.cwd(), fileSystem = NODE_FILE_SYSTEM } = {}) {
  const rootCache = new Map();
  const bodyCache = new Map();

  const loadOnce = (cache, key, load) => {
    if (!cache.has(key)) {
      try {
        cache.set(key, { value: load() });
      } catch (error) {
        cache.set(key, { error });
      }
    }
    const cached = cache.get(key);
    if ("error" in cached) throw cached.error;
    return cached.value;
  };

  const filesForRoot = (searchRoot) =>
    loadOnce(rootCache, normalizeRepoPath(searchRoot), () => walkFiles(searchRoot, { root, fileSystem }));

  const readBody = (absolutePath) =>
    loadOnce(bodyCache, absolutePath, () => {
      try {
        return fileSystem.readFileSync(absolutePath, "utf8");
      } catch (error) {
        throw new Error(`content search failed for ${relativeRepoPath(root, absolutePath)}: ${errorMessage(error)}`, {
          cause: error,
        });
      }
    });

  return {
    read(file) {
      return readBody(absoluteRepoPath(root, file));
    },
    search(matches, searchRoots) {
      const hits = [];
      for (const searchRoot of searchRoots) {
        for (const absolutePath of filesForRoot(searchRoot)) {
          if (matches(readBody(absolutePath))) hits.push(relativeRepoPath(root, absolutePath));
        }
      }
      return [...new Set(hits)].sort();
    },
  };
}

function searchContent(
  matches,
  searchRoots,
  { root = process.cwd(), fileSystem = NODE_FILE_SYSTEM, contentIndex } = {},
) {
  const index = contentIndex ?? createContentIndex({ root, fileSystem });
  return index.search(matches, searchRoots);
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Cross-platform content search; deliberately requires no grep/rg executable. */
const rg = (symbol, searchRoots, options = {}) => {
  const pattern = new RegExp(`(?<![\\w$])${escapeRegExp(symbol)}(?![\\w$])`, "u");
  return searchContent((body) => pattern.test(body), searchRoots, options);
};

const literalHits = (literal, searchRoots, options = {}) =>
  searchContent((body) => body.includes(literal), searchRoots, options);

/** Fail closed: a shallow clone cannot date anything, and age is a load-bearing check. */
export function historyIsComplete({ root = process.cwd(), runGit = sh } = {}) {
  const state = runGit(["rev-parse", "--is-shallow-repository"], root).trim().toLowerCase();
  if (state === "true") return false;
  if (state === "false") return true;
  throw new Error(`git rev-parse returned an unexpected shallow-repository state: ${state || "<empty>"}`);
}

/**
 * A plan that has been superseded or finished is HISTORY, and its tick-boxes are formatting rather
 * than a backlog. Detected from an explicit marker only.
 *
 * Ward Flow process audit, P2-10 / P2-16. Measured 2026-08-30: the sixteen ward plans hold 12,523
 * lines, 555 unchecked boxes and ZERO checked ones — including Phases 1, 2, 3 and 7, all shipped.
 * Nobody ticks a box here; completion is recorded in prose and in commits. So `open > 0` was true of
 * every plan that has ever existed, and every symbol named in any of them was protected forever.
 * Historical formatting had become a permanent exemption from dead-code detection.
 *
 * FAIL CLOSED, deliberately: only an EXPLICIT terminal marker demotes a plan. A plan with no marker
 * is still in flight, exactly as before. This is not a threshold that can be tuned to let a diff
 * pass — there is no threshold, and the only way to exempt a plan is to state in the document that
 * it is finished, which is a claim someone has to make and a reviewer can see.
 */
const TERMINAL_PLAN_MARKER =
  /^\s*>?\s*\*{0,2}(SUPERSEDED|COMPLETE|COMPLETED|SHIPPED|ARCHIVED)\b|\bDo not execute this plan\b/im;

/**
 * Only a BANNER counts — the marker must appear in the document's opening lines, where a status
 * banner lives. Scanning the whole body would let a mid-document heading such as "Complete the
 * intake form" demote a live plan, and that error runs in the dangerous direction: it would un-guard
 * a symbol that is genuinely in flight. A missed exemption costs a refusal someone can argue with; a
 * wrong exemption costs live code.
 */
const PLAN_BANNER_LINES = 25;

export function planIsHistory(body) {
  return TERMINAL_PLAN_MARKER.test(body.split(/\r?\n/).slice(0, PLAN_BANNER_LINES).join("\n"));
}

/** A symbol named in a plan whose tasks are unchecked is scaffolding, not debris. */
export function planContractHits(symbol, options = {}) {
  const contentIndex =
    options.contentIndex ??
    createContentIndex({ root: options.root ?? process.cwd(), fileSystem: options.fileSystem ?? NODE_FILE_SYSTEM });
  const hits = rg(symbol, ["docs/superpowers/plans", "docs/superpowers/specs"], {
    ...options,
    contentIndex,
  }).filter((file) => !isExcludedDocumentationPath(file));
  return hits.map((file) => {
    const body = contentIndex.read(file);
    const open = (body.match(/^- \[ \]/gm) || []).length;
    const done = (body.match(/^- \[x\]/gim) || []).length;
    const history = planIsHistory(body);
    return { file, open, done, history, inFlight: open > 0 && !history };
  });
}

function isExcludedDocumentationPath(file) {
  const normalized = `/${normalizeRepoPath(file)}/`;
  return (
    normalized.includes("/archive/") ||
    normalized.includes("/outstanding-issues-inbox/") ||
    normalized.includes("/branch-review-records/") ||
    normalized.includes("/adoption-manifest")
  );
}

/** "Any future X must call Y" lives in ordinary docs too — that is a forward contract. */
export function docMentions(symbol, options = {}) {
  return rg(symbol, ["docs"], options).filter((file) => !isExcludedDocumentationPath(file));
}

/** A committed test naming the symbol pins it, even when no production file imports it. */
export function testPins(symbol, options = {}) {
  return rg(symbol, ["tests"], options);
}

/** A string literal is a dynamic-lookup path a reachability scan cannot see. */
export function stringLiteralHits(symbol, options = {}) {
  const roots = ["src", "tests", "scripts", "worker"];
  const contentIndex =
    options.contentIndex ??
    createContentIndex({ root: options.root ?? process.cwd(), fileSystem: options.fileSystem ?? NODE_FILE_SYSTEM });
  const searchOptions = { ...options, contentIndex };
  return [
    ...new Set([
      ...literalHits(`"${symbol}"`, roots, searchOptions),
      ...literalHits(`'${symbol}'`, roots, searchOptions),
    ]),
  ].sort();
}

/** Introduced recently = probably a consumer that has not landed yet. */
export function introducedAt(symbol, file, { root = process.cwd(), runGit = sh, completeHistory } = {}) {
  const historyComplete = completeHistory ?? historyIsComplete({ root, runGit });
  if (!historyComplete) return null;
  const out = runGit(
    ["log", "--reverse", "--format=%ad", "--date=short", "-S", symbol, "--", normalizeRepoPath(file)],
    root,
  );
  return out.split(/\r?\n/).find(Boolean) ?? null;
}

export function daysSince(isoDate, today = new Date()) {
  const then = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((today.getTime() - then) / 86_400_000);
}

/** Deleting a whole file is only safe when NOTHING else in it is still exported. */
export function otherLiveExports(file, symbol, { root = process.cwd(), fileSystem = NODE_FILE_SYSTEM } = {}) {
  let body;
  try {
    body = fileSystem.readFileSync(absoluteRepoPath(root, file), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(`cannot read ${normalizeRepoPath(file)}: ${errorMessage(error)}`, { cause: error });
  }
  const names = [
    ...body.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm),
  ]
    .map((match) => match[1])
    .filter((name) => name !== symbol);
  return [...new Set(names)];
}

export function assess(
  symbol,
  file,
  {
    today = new Date(),
    root = process.cwd(),
    runGit = sh,
    fileSystem = NODE_FILE_SYSTEM,
    contentIndex = createContentIndex({ root, fileSystem }),
  } = {},
) {
  const normalizedFile = normalizeRepoPath(file);
  const refusals = [];
  const warnings = [];
  const searchOptions = { root, fileSystem, contentIndex };
  let completeHistory = null;

  try {
    completeHistory = historyIsComplete({ root, runGit });
    if (!completeHistory) {
      refusals.push("shallow clone — cannot date this symbol; run `git fetch --deepen=2000` first");
    }
  } catch (error) {
    refusals.push(`history check failed — ${errorMessage(error)}`);
  }

  try {
    for (const plan of planContractHits(symbol, searchOptions)) {
      if (plan.inFlight) {
        refusals.push(`named in ${plan.file}, a plan with ${plan.open} unchecked task(s) — in-flight scaffolding`);
      } else {
        warnings.push(`named in ${plan.file} (all ${plan.done} tasks complete)`);
      }
    }
  } catch (error) {
    refusals.push(`plan/spec search failed — ${errorMessage(error)}`);
  }

  try {
    const docs = docMentions(symbol, searchOptions);
    if (docs.length) warnings.push(`documented in: ${docs.slice(0, 3).join(", ")} — read before deleting`);
  } catch (error) {
    refusals.push(`documentation search failed — ${errorMessage(error)}`);
  }

  try {
    const pins = testPins(symbol, searchOptions);
    if (pins.length) refusals.push(`pinned by committed test(s): ${pins.slice(0, 3).join(", ")}`);
  } catch (error) {
    refusals.push(`tests search failed — ${errorMessage(error)}`);
  }

  try {
    const literals = stringLiteralHits(symbol, searchOptions);
    if (literals.length) {
      refusals.push(`appears as a string literal in ${literals.slice(0, 3).join(", ")} — possible dynamic lookup`);
    }
  } catch (error) {
    refusals.push(`string-literal search failed — ${errorMessage(error)}`);
  }

  if (completeHistory) {
    try {
      const added = introducedAt(symbol, normalizedFile, { root, runGit, completeHistory });
      if (!added) {
        refusals.push("introduction date is unknown despite full history — deletion safety is uncertain");
      } else {
        const age = daysSince(added, today);
        if (age === null) {
          refusals.push(`introduction date ${added} is unreadable — deletion safety is uncertain`);
        } else if (age <= RECENT_DAYS) {
          refusals.push(`introduced ${added} (${age}d ago, threshold ${RECENT_DAYS}d) — likely awaiting its consumer`);
        }
      }
    } catch (error) {
      refusals.push(`introduction history failed — ${errorMessage(error)}`);
    }
  }

  try {
    const siblings = otherLiveExports(normalizedFile, symbol, searchOptions);
    if (siblings.length) {
      warnings.push(
        `${normalizedFile} still exports ${siblings.length} other symbol(s) — remove the symbol, never the file`,
      );
    }
  } catch (error) {
    refusals.push(`candidate export scan failed — ${errorMessage(error)}`);
  }

  return { symbol, file: normalizedFile, refusals, warnings, ok: refusals.length === 0 };
}

export function removedDeclarationsInDiff(base, { root = process.cwd(), runGit = sh } = {}) {
  const resolvedBase = runGit(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], root).trim();
  if (!/^[0-9a-f]{40}$/i.test(resolvedBase)) {
    throw new Error(`git rev-parse returned an invalid base commit: ${resolvedBase || "<empty>"}`);
  }
  const diff = runGit(
    [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "-U0",
      resolvedBase,
      "--",
      "src",
      "scripts",
      "worker",
    ],
    root,
  );
  const removed = [];
  const added = new Set();
  let file = null;
  let readingHeaders = false;
  let oldHeaderSeen = false;

  const parseHeader = (line, marker, prefix) => {
    const path = line.slice(marker.length);
    if (path === "/dev/null") return null;
    if (!path.startsWith(prefix)) {
      throw new Error(`quoted or unparseable git diff path header: ${line}`);
    }
    return normalizeRepoPath(path.slice(prefix.length));
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      file = null;
      readingHeaders = true;
      oldHeaderSeen = false;
      continue;
    }
    if (readingHeaders && line.startsWith("--- ")) {
      const oldFile = parseHeader(line, "--- ", "a/");
      if (oldFile) file = oldFile;
      oldHeaderSeen = true;
      continue;
    }
    if (readingHeaders && line.startsWith("+++ ")) {
      if (!oldHeaderSeen) throw new Error(`git diff new-file header appeared before its old-file header: ${line}`);
      const newFile = parseHeader(line, "+++ ", "b/");
      if (newFile) file = newFile;
      readingHeaders = false;
      continue;
    }
    if (readingHeaders && line.startsWith("@@")) {
      if (!file) throw new Error("git diff hunk has no parseable path header");
      readingHeaders = false;
    }
    if (!file) continue;
    const declaration =
      /^([-+])(?:export\s+)?(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (!declaration) continue;
    if (declaration[1] === "+") added.add(`${file}:${declaration[2]}`);
    else removed.push({ symbol: declaration[2], file });
  }
  // A signature change shows up as a removed line AND an added line for the same
  // symbol. That is a modification, not a deletion, and assessing it produced a
  // false REFUSE on this gate's own introducing commit.
  return [
    ...new Map(removed.map((declaration) => [`${declaration.file}:${declaration.symbol}`, declaration])).values(),
  ].filter((declaration) => !added.has(`${declaration.file}:${declaration.symbol}`));
}

function selfTest({ root = process.cwd(), stdout = console.log, stderr = console.error } = {}) {
  const fixedToday = new Date("2026-09-01T00:00:00Z");
  const cases = [
    ["daysSince counts whole days", daysSince("2026-08-20", fixedToday) === 12],
    ["daysSince rejects nonsense", daysSince("not-a-date", fixedToday) === null],
    [
      "otherLiveExports ignores the candidate itself",
      !otherLiveExports("scripts/check-dead-code-candidate.mjs", "assess", { root }).includes("assess"),
    ],
    [
      "otherLiveExports finds siblings",
      otherLiveExports("scripts/check-dead-code-candidate.mjs", "assess", { root }).includes("historyIsComplete"),
    ],
  ];
  let failed = 0;
  for (const [name, pass] of cases) {
    if (!pass) {
      stderr(`  FAIL ${name}`);
      failed++;
    } else stdout(`  ok   ${name}`);
  }
  if (failed) {
    stderr(`dead-code-candidate self-test: ${failed} failure(s)`);
    return 1;
  }
  stdout("dead-code-candidate self-test passed.");
  return 0;
}

const CLI_USAGE = "usage: --symbol <name> --file <path> | --diff <base-ref> | --self-test";

function parseArguments(argv) {
  if (argv.includes("--self-test")) {
    if (argv.length !== 1 || argv[0] !== "--self-test") {
      throw new Error("--self-test must be used alone");
    }
    return { mode: "self-test" };
  }

  const values = { symbol: null, file: null, diff: null };
  const optionKeys = new Map([
    ["--symbol", "symbol"],
    ["--file", "file"],
    ["--diff", "diff"],
  ]);

  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    const key = optionKeys.get(option);
    if (!key) throw new Error(`unknown argument: ${option}`);
    if (values[key] !== null) throw new Error(`duplicate option: ${option}`);

    const value = argv[++index];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${option} requires a value`);
    }
    if (value.startsWith("-")) {
      throw new Error(`${option} requires a non-option value`);
    }
    values[key] = value;
  }

  if (values.diff && (values.symbol || values.file)) {
    throw new Error("--diff cannot be combined with --symbol or --file");
  }
  if (values.diff) return { mode: "diff", base: values.diff };
  if (values.symbol || values.file) {
    if (!values.symbol || !values.file) throw new Error("--symbol and --file must be used together");
    return { mode: "symbol", symbol: values.symbol, file: values.file };
  }
  return { mode: "default" };
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
  if (parsed.mode === "self-test") return selfTest({ root, stdout, stderr });

  let candidates = [];

  if (parsed.mode === "symbol") {
    candidates = [{ symbol: parsed.symbol, file: normalizeRepoPath(parsed.file) }];
  } else {
    try {
      const base = parsed.mode === "diff" ? parsed.base : runGit(["merge-base", "origin/main", "HEAD"], root).trim();
      if (!base) throw new Error("git merge-base returned no base commit");
      candidates = removedDeclarationsInDiff(base, { root, runGit });
    } catch (error) {
      stderr(`[dead-code] REFUSE — git diff setup failed: ${errorMessage(error)}`);
      return 1;
    }
  }

  if (!candidates.length) {
    stdout("[dead-code] no removed declarations to assess.");
    return 0;
  }

  let refused = 0;
  const contentIndex = createContentIndex({ root, fileSystem });
  for (const { symbol: candidateSymbol, file: candidateFile } of candidates) {
    const result = assess(candidateSymbol, candidateFile, { root, runGit, fileSystem, contentIndex });
    if (result.ok && !result.warnings.length) {
      stdout(`  CLEAR   ${candidateSymbol}  (${candidateFile})`);
      continue;
    }
    stdout(`  ${result.ok ? "REVIEW " : "REFUSE "} ${candidateSymbol}  (${candidateFile})`);
    for (const message of result.refusals) stdout(`      x ${message}`);
    for (const message of result.warnings) stdout(`      ! ${message}`);
    if (!result.ok) refused++;
  }

  stdout(`\n[dead-code] ${candidates.length} candidate(s), ${refused} refused.`);
  if (refused) {
    stderr("[dead-code] FAIL — at least one candidate is not safe to delete on reachability alone.");
    return 1;
  }
  stdout(
    "[dead-code] PASS — no candidate tripped a safety check. Reachability is still only necessary, not sufficient.",
  );
  return 0;
}

const invokedAsScript = isDirectEntrypoint(import.meta.url);
if (invokedAsScript) process.exitCode = main();
