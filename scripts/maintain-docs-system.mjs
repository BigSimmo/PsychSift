#!/usr/bin/env node
// Automated Documentation & File-Organisation Maintenance Pipeline for PsychSift.
//
// Modes:
//   - Default (write/maintain): `node scripts/maintain-docs-system.mjs` (`npm run docs:maintain`)
//     Auto-places unplaced files into `docs/organisation/systems/*.json`, runs `check:organisation -- --fix`,
//     syncs the `Areas` section of `docs/codebase-index.md`, refreshes inventory counts, sitemap,
//     repo-awareness snapshot, outstanding-issues snapshot, hazard-register snapshot,
//     branch-review index, and doc pins, then verifies that all documentation and organisation gates pass.
//   - Check mode (read-only): `node scripts/maintain-docs-system.mjs --check` (`npm run docs:maintain:check`)
//     Runs all offline documentation, organisation, snapshot, instruction, decision, and skill checks
//     without mutating files, failing if any gate fails or if any file is unplaced.
//   - Classify mode: `node scripts/maintain-docs-system.mjs --classify <path...>`
//     Prints deterministic JSON classification for one or more repository-relative paths.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compilePattern } from "./check-organisation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "..");

/** @type {Map<string, string>} */
const RESOLVED_TO_LOGICAL_SYSTEM = new Map([
  ["answer-engine", "search-and-answers"],
  ["source-intake", "sources-and-ingestion"],
  ["personal-practice", "personal-practice"],
  ["clinical-content", "clinical-modes"],
  ["knowledge", "knowledge"],
  ["app-experience", "shell-and-design"],
  ["design-system", "shell-and-design"],
  ["data-platform", "operations-and-governance"],
  ["delivery", "operations-and-governance"],
]);

/** @type {Map<string, Array<{ system: string, pattern: string, exact: boolean, rank: number, regex: RegExp | null }>>} */
const compiledRulesCache = new Map();

function loadCompiledSystemRules(root = DEFAULT_ROOT) {
  const cached = compiledRulesCache.get(root);
  if (cached) return cached;

  const systemsDir = path.join(root, "docs", "organisation", "systems");
  if (!fs.existsSync(systemsDir)) {
    compiledRulesCache.set(root, []);
    return [];
  }

  const rules = [];
  const entries = fs
    .readdirSync(systemsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const entry of entries) {
    const absFile = path.join(systemsDir, entry);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(absFile, "utf8"));
    } catch {
      continue;
    }
    const systemId = typeof data?.id === "string" ? data.id : path.posix.basename(entry, ".json");
    const paths = Array.isArray(data?.paths) ? data.paths : Array.isArray(data?.files) ? data.files : [];
    for (const pattern of paths) {
      if (typeof pattern !== "string" || !pattern.trim()) continue;
      const star = pattern.indexOf("*");
      const exact = star === -1;
      rules.push({
        system: systemId,
        pattern,
        exact,
        rank: exact ? Number.POSITIVE_INFINITY : star,
        regex: exact ? null : compilePattern(pattern),
      });
    }
  }

  compiledRulesCache.set(root, rules);
  return rules;
}

function matchManifestRule(relPath, root = DEFAULT_ROOT) {
  const rules = loadCompiledSystemRules(root);
  if (rules.length === 0) return null;

  for (const rule of rules) {
    if (rule.exact && rule.pattern === relPath) {
      return rule;
    }
  }

  // Only evaluate glob rules from the manifest when the file exists on disk or the glob prefix
  // is not a generic catch-all (`src/app/**/page.tsx`), so synthetic test paths still exercise heuristics.
  const existsOnDisk = fs.existsSync(path.join(root, relPath));
  let best = null;
  for (const rule of rules) {
    if (rule.exact || !rule.regex) continue;
    if (!existsOnDisk && rule.pattern.startsWith("src/app/**/")) continue;
    if (rule.regex.test(relPath)) {
      if (!best || rule.rank > best.rank) {
        best = rule;
      }
    }
  }
  return best;
}

/**
 * Normalizes a repository-relative path to POSIX forward slashes without leading `./` or `/`.
 * @param {string} rawPath
 * @returns {string}
 */
export function normalizeRepoPath(rawPath) {
  return String(rawPath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

/**
 * Deterministic path classifier mapping any repository-relative path into one of the
 * canonical documentation/system areas (plus resolved on-disk system file in `docs/organisation/systems/`).
 *
 * @param {string} relativePath
 * @param {{ root?: string }} [options]
 * @returns {{
 *   path: string,
 *   system: string,
 *   systemFile: string,
 *   resolvedSystem: string,
 *   resolvedSystemFile: string,
 *   reason: string
 * }}
 */
export function classifyRepositoryPath(relativePath, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const rel = normalizeRepoPath(relativePath);
  const lower = rel.toLowerCase();
  const base = path.posix.basename(lower);

  const buildResult = (system, resolvedSystem, reason) => ({
    path: rel,
    system,
    systemFile: `docs/organisation/systems/${system}.json`,
    resolvedSystem,
    resolvedSystemFile: `docs/organisation/systems/${resolvedSystem}.json`,
    reason,
  });

  // 0. If the path already matches an organisation rule in `docs/organisation/systems/*.json`,
  //    return that rule's area so `--classify` and `check:organisation` never diverge.
  const manifestHit = matchManifestRule(rel, root);
  if (manifestHit) {
    const resolvedSystem = manifestHit.system;
    const logicalSystem = RESOLVED_TO_LOGICAL_SYSTEM.get(resolvedSystem) ?? resolvedSystem;
    return buildResult(
      logicalSystem,
      resolvedSystem,
      `Matches organisation manifest rule \`${manifestHit.pattern}\` in \`docs/organisation/systems/${resolvedSystem}.json\`.`,
    );
  }

  // 1. search-and-answers / answer-engine (RAG, retrieval, grounding, rerank, search, answers, citations, query classification)
  if (
    lower.startsWith("src/lib/rag/") ||
    lower === "src/lib/rag" ||
    lower.startsWith("src/app/api/answers/") ||
    lower === "src/app/api/answers" ||
    lower.startsWith("src/app/api/ask/") ||
    lower === "src/app/api/ask" ||
    lower.startsWith("src/app/api/search/") ||
    lower === "src/app/api/search" ||
    /^docs\/(rag|answer|search(?!-chrome)|query)/.test(lower) ||
    (lower.startsWith("docs/") &&
      /\b(rag|retrieval|grounding|rerank|citation|citations|query-classification)\b/.test(base))
  ) {
    return buildResult(
      "search-and-answers",
      "answer-engine",
      "Matches RAG, retrieval, grounding, search, answer generation, or query classification paths.",
    );
  }

  // 2. clinical-content owns the source library, matching the organisation rules.
  if (lower.startsWith("src/lib/sources/") || lower === "src/lib/sources") {
    return buildResult(
      "clinical-modes",
      "clinical-content",
      "Matches the source library owned by the clinical-content area.",
    );
  }

  // 3. sources-and-ingestion / source-intake (source registry, document upload, extraction, ingestion workers, storage)
  if (
    lower.startsWith("src/lib/ingest/") ||
    lower === "src/lib/ingest" ||
    lower.startsWith("src/app/sources/") ||
    lower === "src/app/sources" ||
    /^docs\/(source|ingest|document)/.test(lower)
  ) {
    return buildResult(
      "sources-and-ingestion",
      "source-intake",
      "Matches source registry, document upload/extraction, ingestion worker, or storage paths.",
    );
  }

  // 4. personal-practice (CME/CPD, roster, my-day, teaching, open-shifts, work, diary, workspace)
  if (
    lower.startsWith("src/app/workspace/") ||
    lower === "src/app/workspace" ||
    lower.startsWith("src/app/diary/") ||
    lower === "src/app/diary" ||
    /^src\/app\/(cme|roster|my-day|teaching|open-shifts|work)(\/|$)/.test(lower) ||
    /^src\/app\/api\/(cme|roster|teaching|work)(\/|$)/.test(lower) ||
    /^src\/components\/(cme|roster|my-day|teaching|work-frame)(\/|$)/.test(lower) ||
    /^src\/lib\/(cme|roster|teaching|work-frame)(\/|$)/.test(lower) ||
    /^docs\/(personal|workspace|diary|cme)/.test(lower)
  ) {
    return buildResult(
      "personal-practice",
      "personal-practice",
      "Matches personal practice, CME/CPD, roster, teaching, clinician workspace, or diary paths.",
    );
  }

  // 5. clinical-modes / clinical-content (psychiatry, therapy, formulation, diagnosis, medications, sleep, scales, calculators, ect, ranzcp, dsm, differentials, on-call, care-plan, dictionary)
  if (
    /^src\/app\/(psychiatry|therapy|medications|medicines|formulation|diagnosis|dsm|differentials|forms|services|dictionary|new-starters|on-call|scales|calculators|ect|sleep|ranzcp)(\/|$)/.test(
      lower,
    ) ||
    /^src\/components\/(psychiatry|therapy|medications|dsm|differentials|forms|services|dictionary|new-starters|on-call|calculators|care-plan)(\/|$)/.test(
      lower,
    ) ||
    /^src\/lib\/(psychiatry|therapy|medications|dsm|differentials|forms|services|dictionary|new-starters|on-call|calculators|care-plan)(\/|$)/.test(
      lower,
    ) ||
    /^docs\/(clinical(?!-safety|-governance|-hazard|-sign-off)|medication|therapy|psychiatry|formulation|diagnosis|dsm|differential|dictionary|care-plan|scales|calculators|ect|sleep|ranzcp)/.test(
      lower,
    )
  ) {
    return buildResult(
      "clinical-modes",
      "clinical-content",
      "Matches clinical mode routes, calculators, scales, therapy, psychiatry, or medication guidance paths.",
    );
  }

  // 6. knowledge (entry docs, agent tooling, ledgers, organisation map, decisions, knowledge graph, library)
  if (
    lower.startsWith("src/lib/knowledge/") ||
    lower === "src/lib/knowledge" ||
    lower.startsWith("src/app/knowledge/") ||
    lower === "src/app/knowledge" ||
    /^(agents|claude|gemini|project-instructions-continuation|readme|context|contributing|security|license)\.md$/.test(
      lower,
    ) ||
    /^(\.agents|\.claude|\.cursor|\.codex|\.superpowers)\//.test(lower) ||
    /^docs\/(knowledge|library|agents|organisation|decisions|adr|prompts|plans|superpowers|archive|audit|redesign|readme\.md|docs-system\.md|codebase-index\.md|site-map\.md|scripts-index\.md|task-receipts\.md|outstanding-issues|branch-review)/.test(
      lower,
    ) ||
    lower === "scripts/maintain-docs-system.mjs" ||
    lower === "tests/maintain-docs-system.test.ts"
  ) {
    return buildResult(
      "knowledge",
      "knowledge",
      "Matches knowledge graph, clinical topics, agent instructions, documentation indexes, or ledger records.",
    );
  }

  // 7. shell-and-design (navigation, global search shell, header, dock, theme, CSS tokens, design system, UI components)
  if (
    lower.startsWith("src/components/") ||
    lower === "src/components" ||
    lower === "src/app/globals.css" ||
    lower === "src/app/design-tokens.css" ||
    /^docs\/(design|brand|ui|search-chrome|search-results-bar|filter-contract|wiring-conventions|frontend-architecture|pwa|navigation)/.test(
      lower,
    )
  ) {
    const isDesignTokensOrSystem =
      lower === "src/app/globals.css" ||
      lower === "src/app/design-tokens.css" ||
      /^docs\/(design|brand|ui)/.test(lower);
    return buildResult(
      "shell-and-design",
      isDesignTokensOrSystem ? "design-system" : "app-experience",
      "Matches shared UI components, navigation, search chrome, CSS tokens, or design system paths.",
    );
  }

  // 8. operations-and-governance (data-platform vs delivery)
  const isDataPlatform =
    lower === ".env.example" ||
    lower === "src/proxy.ts" ||
    lower.startsWith("supabase/") ||
    lower === "supabase" ||
    /^src\/(app\/(auth|api\/(account|health|setup-status|webhooks))|lib\/(supabase|observability|validation|webhooks|work-mode-launch))(\/|$)/.test(
      lower,
    ) ||
    /^src\/lib\/(auth|authorization|owner-scope|privacy|query-privacy|private-search-scope|account-|api-csrf|api-rate-limit|security-headers|deep-probe-auth|patient-label-storage|signed-url-cache|audit|env|client-env)/.test(
      lower,
    ) ||
    /^docs\/(privacy|multi-user-auth|auth-connection-cap|database-|db-maintenance|supabase-|disaster-recovery|observability|error-tracking|openai-cross-border|operations-runbook)/.test(
      lower,
    ) ||
    /^scripts\/(sql\/|.*(drift|migration|privacy|owner-scope|cross-tenant|tenancy|function-grants|default-acl|supabase))/.test(
      lower,
    ) ||
    /\b(privacy|auth|authorization|authentication|owner-scope|tenancy|cross-tenant|rls|drift|migration)\b/.test(base);

  return buildResult(
    "operations-and-governance",
    isDataPlatform ? "data-platform" : "delivery",
    isDataPlatform
      ? "Matches database, migration, drift, authentication, authorization, owner-scope, or privacy paths owned by data-platform."
      : "Matches CI, scripts, tests, build, release, or operational delivery paths.",
  );
}

/**
 * Reads `output/organisation/latest.json` (resolving pointer files when present) and returns
 * the parsed organisation report plus a normalized list of unplaced repository paths.
 *
 * @param {string} [root]
 * @returns {{ report: Record<string, any> | null, unplacedCount: number, unplacedFiles: string[] }}
 */
export function readOrganisationReport(root = DEFAULT_ROOT) {
  const latestPath = path.join(root, "output", "organisation", "latest.json");
  if (!fs.existsSync(latestPath)) {
    return { report: null, unplacedCount: 0, unplacedFiles: [] };
  }

  const latestRaw = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  let report = latestRaw;
  if (typeof latestRaw?.json === "string") {
    const pointerTarget = path.join(root, "output", "organisation", latestRaw.json);
    if (fs.existsSync(pointerTarget)) {
      report = JSON.parse(fs.readFileSync(pointerTarget, "utf8"));
    }
  }

  const unplacedSet = new Set();
  if (Array.isArray(report?.unplaced)) {
    for (const item of report.unplaced) {
      if (typeof item === "string" && item.trim()) {
        unplacedSet.add(normalizeRepoPath(item));
      } else if (item && typeof item.path === "string") {
        unplacedSet.add(normalizeRepoPath(item.path));
      }
    }
  }

  if (Array.isArray(report?.findings)) {
    for (const finding of report.findings) {
      if (
        typeof finding?.key === "string" &&
        finding.key.startsWith("unplaced:") &&
        typeof finding?.subject === "string"
      ) {
        unplacedSet.add(normalizeRepoPath(finding.subject));
      }
    }
  }

  if (report?.placement && typeof report.placement === "object") {
    for (const [filePath, target] of Object.entries(report.placement)) {
      if (target === "(unplaced)") {
        unplacedSet.add(normalizeRepoPath(filePath));
      }
    }
  }

  const unplacedFiles = [...unplacedSet].sort();
  const explicitCount =
    typeof report?.counts?.unplaced === "number"
      ? report.counts.unplaced
      : typeof report?.totals?.unplaced === "number"
        ? report.totals.unplaced
        : unplacedFiles.length;

  return {
    report,
    unplacedCount: explicitCount,
    unplacedFiles,
  };
}

/**
 * Resolves which system JSON file on disk should receive a classified path.
 * Prefers `classification.systemFile` if it exists on disk, falling back to
 * `classification.resolvedSystemFile` if present on disk.
 *
 * @param {string} root
 * @param {ReturnType<typeof classifyRepositoryPath>} classification
 * @returns {string}
 */
function resolveTargetSystemFile(root, classification) {
  const primaryAbs = path.join(root, classification.systemFile);
  if (fs.existsSync(primaryAbs)) {
    return classification.systemFile;
  }
  const resolvedAbs = path.join(root, classification.resolvedSystemFile);
  if (fs.existsSync(resolvedAbs)) {
    return classification.resolvedSystemFile;
  }
  return classification.systemFile;
}

/**
 * Auto-places any unplaced files reported by `output/organisation/latest.json` into the
 * appropriate `docs/organisation/systems/<area>.json` manifest (updating `paths` and/or `files`
 * arrays in sorted, deduplicated order).
 *
 * @param {string} [root]
 * @param {{ runCheckFirst?: boolean }} [options]
 * @returns {{ placed: Array<{ path: string, system: string, systemFile: string, reason: string }>, updatedSystemFiles: string[] }}
 */
export function placeUnplacedFiles(root = DEFAULT_ROOT, options = {}) {
  const { runCheckFirst = false } = options;
  if (runCheckFirst) {
    const checkScript = path.join(root, "scripts", "check-organisation.mjs");
    if (fs.existsSync(checkScript)) {
      try {
        execFileSync(process.execPath, [checkScript], { cwd: root, stdio: "pipe" });
      } catch {
        // Non-zero exit is expected when unplaced files exist before placement.
      }
    }
  }

  const { unplacedFiles } = readOrganisationReport(root);
  if (unplacedFiles.length === 0) {
    return { placed: [], updatedSystemFiles: [] };
  }

  /** @type {Map<string, string[]>} */
  const additionsBySystemFile = new Map();
  /** @type {Array<{ path: string, system: string, systemFile: string, reason: string }>} */
  const placed = [];

  for (const relPath of unplacedFiles) {
    const classification = classifyRepositoryPath(relPath, { root });
    const targetRelFile = resolveTargetSystemFile(root, classification);
    if (!additionsBySystemFile.has(targetRelFile)) {
      additionsBySystemFile.set(targetRelFile, []);
    }
    additionsBySystemFile.get(targetRelFile).push(relPath);
    placed.push({
      path: relPath,
      system: classification.system,
      systemFile: targetRelFile,
      reason: classification.reason,
    });
  }

  const updatedSystemFiles = [];
  for (const [targetRelFile, newPaths] of additionsBySystemFile.entries()) {
    const absFile = path.join(root, targetRelFile);
    let systemObj = {
      version: 1,
      id: path.posix.basename(targetRelFile, ".json"),
      paths: [],
      files: [],
    };
    if (fs.existsSync(absFile)) {
      systemObj = JSON.parse(fs.readFileSync(absFile, "utf8"));
    } else {
      fs.mkdirSync(path.dirname(absFile), { recursive: true });
    }

    const usesPaths = Array.isArray(systemObj.paths);
    const usesFiles = Array.isArray(systemObj.files);

    if (usesPaths || !usesFiles) {
      const existingPaths = Array.isArray(systemObj.paths)
        ? systemObj.paths.map((item) => normalizeRepoPath(item))
        : [];
      systemObj.paths = [...new Set([...existingPaths, ...newPaths])].sort();
    }
    if (usesFiles) {
      const existingFiles = systemObj.files.map((item) => normalizeRepoPath(item));
      systemObj.files = [...new Set([...existingFiles, ...newPaths])].sort();
    }

    fs.writeFileSync(absFile, `${JSON.stringify(systemObj, null, 2)}\n`, "utf8");
    updatedSystemFiles.push(targetRelFile);
  }

  compiledRulesCache.delete(root);
  return { placed, updatedSystemFiles: updatedSystemFiles.sort() };
}

/**
 * Updates `docs/organisation/pins.json` ONLY for explicitly specified `options.paths` whose
 * files exist on disk, pinning them to a verified `main`-line commit (`git merge-base HEAD origin/main`
 * or `options.headSha`) rather than blindly overwriting every pin with a branch `HEAD`.
 *
 * @param {string} [root]
 * @param {{ headSha?: string, paths?: string[] }} [options]
 * @returns {{ updated: boolean, headSha: string | null, updatedPaths: string[] }}
 */
export function refreshDocPins(root = DEFAULT_ROOT, options = {}) {
  const pinsPath = path.join(root, "docs", "organisation", "pins.json");
  if (!fs.existsSync(pinsPath)) {
    return { updated: false, headSha: null, updatedPaths: [] };
  }

  const targetPaths = Array.isArray(options.paths)
    ? new Set(options.paths.map((p) => normalizeRepoPath(p)).filter(Boolean))
    : null;
  if (!targetPaths || targetPaths.size === 0) {
    return { updated: false, headSha: null, updatedPaths: [] };
  }

  let headSha = options.headSha || null;
  if (!headSha) {
    const candidateCommands = [
      ["merge-base", "HEAD", "origin/main"],
      ["merge-base", "HEAD", "main"],
    ];
    for (const gitArgs of candidateCommands) {
      try {
        const resolved = execFileSync("git", gitArgs, {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (resolved) {
          headSha = resolved;
          break;
        }
      } catch {
        // Try next main-line ref.
      }
    }
  }

  if (!headSha) {
    return { updated: false, headSha: null, updatedPaths: [] };
  }

  const rawText = fs.readFileSync(pinsPath, "utf8");
  const parsed = JSON.parse(rawText);
  const updatedPaths = [];

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const entryPath = normalizeRepoPath(entry?.path || entry?.file);
      if (entryPath && targetPaths.has(entryPath) && fs.existsSync(path.join(root, entryPath))) {
        if ("reviewedCommit" in entry && entry.reviewedCommit !== headSha) {
          entry.reviewedCommit = headSha;
          updatedPaths.push(entryPath);
        } else if ("commit" in entry && entry.commit !== headSha) {
          entry.commit = headSha;
          updatedPaths.push(entryPath);
        } else if (!("reviewedCommit" in entry) && !("commit" in entry)) {
          entry.reviewedCommit = headSha;
          updatedPaths.push(entryPath);
        }
      }
    }
  } else if (parsed && typeof parsed === "object") {
    if (parsed.pins && typeof parsed.pins === "object" && !Array.isArray(parsed.pins)) {
      for (const rawDocPath of Object.keys(parsed.pins)) {
        const docPath = normalizeRepoPath(rawDocPath);
        if (targetPaths.has(docPath) && fs.existsSync(path.join(root, docPath))) {
          const currentVal = parsed.pins[rawDocPath];
          if (typeof currentVal === "string") {
            if (currentVal !== headSha) {
              parsed.pins[rawDocPath] = headSha;
              updatedPaths.push(docPath);
            }
          } else if (currentVal && typeof currentVal === "object") {
            if (currentVal.reviewedCommit !== headSha) {
              currentVal.reviewedCommit = headSha;
              updatedPaths.push(docPath);
            }
          }
        }
      }
    } else if (Array.isArray(parsed.pins)) {
      for (const entry of parsed.pins) {
        const entryPath = normalizeRepoPath(entry?.path || entry?.file);
        if (entryPath && targetPaths.has(entryPath) && fs.existsSync(path.join(root, entryPath))) {
          if (entry.reviewedCommit !== headSha) {
            entry.reviewedCommit = headSha;
            updatedPaths.push(entryPath);
          }
        }
      }
    }
  }

  const nextText = `${JSON.stringify(parsed, null, 2)}\n`;
  if (nextText !== rawText) {
    fs.writeFileSync(pinsPath, nextText, "utf8");
    return { updated: true, headSha, updatedPaths };
  }

  return { updated: false, headSha, updatedPaths };
}

/**
 * Runs a node script relative to `root` if that script exists on disk.
 * @param {string} root
 * @param {string} relScript
 * @param {string[]} [args]
 */
function runNodeScriptIfPresent(root, relScript, args = []) {
  const scriptPath = path.join(root, relScript);
  if (!fs.existsSync(scriptPath)) {
    return false;
  }
  execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    stdio: "inherit",
  });
  return true;
}

function runNodeScriptJson(root, relScript, args = []) {
  const scriptPath = path.join(root, relScript);
  if (!fs.existsSync(scriptPath)) throw new Error(`Required script is missing: ${relScript}`);
  const output = execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(output);
}

function runAdvisoryNodeScript(root, relScript, args = []) {
  try {
    return runNodeScriptIfPresent(root, relScript, args);
  } catch (error) {
    console.warn(`[docs:maintain] advisory check failed: ${relScript}: ${error.message}`);
    return false;
  }
}

/**
 * Runs a TypeScript script via `scripts/run-tsx.mjs` if both exist on disk.
 * @param {string} root
 * @param {string} relTsScript
 * @param {string[]} [args]
 */
function runTsxScriptIfPresent(root, relTsScript, args = []) {
  const runnerPath = path.join(root, "scripts", "run-tsx.mjs");
  const scriptPath = path.join(root, relTsScript);
  if (!fs.existsSync(runnerPath) || !fs.existsSync(scriptPath)) {
    return false;
  }
  execFileSync(process.execPath, [runnerPath, relTsScript, ...args], {
    cwd: root,
    stdio: "inherit",
  });
  return true;
}

/**
 * Executes the documentation & file-organisation maintenance pipeline.
 *
 * @param {{
 *   root?: string,
 *   check?: boolean,
 *   classifyPaths?: string[],
 *   refreshPinPaths?: string[]
 * }} [options]
 */
export function runDocsMaintain(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const check = Boolean(options.check);
  const classifyPaths = Array.isArray(options.classifyPaths) ? options.classifyPaths : [];
  const refreshPinPaths = Array.isArray(options.refreshPinPaths) ? options.refreshPinPaths : [];

  if (classifyPaths.length > 0) {
    const results = classifyPaths.map((p) => classifyRepositoryPath(p, { root }));
    const payload = results.length === 1 ? results[0] : results;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return { mode: "classify", results };
  }

  if (check) {
    const requiredScripts = [
      "scripts/check-organisation.mjs",
      "scripts/check-codebase-index-coverage.mjs",
      "scripts/check-docs-script-refs.mjs",
      "scripts/check-docs-links.mjs",
      "scripts/check-outstanding-issues-snapshot.mjs",
      "scripts/check-clinical-hazard-controls.mjs",
      "scripts/organisation/check-instructions.mjs",
      "scripts/organisation/decisions.mjs",
      "scripts/list-database-skills.mjs",
      "scripts/generate-branch-review-index.mjs",
    ];
    for (const relScript of requiredScripts) {
      if (!fs.existsSync(path.join(root, relScript))) throw new Error(`Required script is missing: ${relScript}`);
    }

    // 1. Verify organisation manifest & unplaced count === 0
    const organisationCheck = runNodeScriptJson(root, "scripts/check-organisation.mjs", ["--no-report", "--json"]);
    const unplacedCount = organisationCheck?.totals?.unplaced ?? 0;
    const unplacedFromFindings = Array.isArray(organisationCheck?.findings)
      ? organisationCheck.findings
          .filter((finding) => typeof finding?.key === "string" && finding.key.startsWith("unplaced:"))
          .map((finding) =>
            typeof finding.subject === "string" ? finding.subject : finding.key.slice("unplaced:".length),
          )
      : [];
    const unplacedFromPlacement = Object.entries(organisationCheck?.placement ?? {})
      .filter(([, area]) => area === "(unplaced)")
      .map(([file]) => file);
    const unplacedFiles = [...new Set([...unplacedFromFindings, ...unplacedFromPlacement])].sort();
    if (unplacedCount !== 0 || unplacedFiles.length > 0) {
      throw new Error(`Organisation check reported ${unplacedCount} unplaced file(s): ${unplacedFiles.join(", ")}`);
    }

    // 2. Verify codebase index, script-refs, links, inventory, sitemap, snapshots, instructions, decisions, skills, and ledger index
    runNodeScriptIfPresent(root, "scripts/check-codebase-index-coverage.mjs");
    runNodeScriptIfPresent(root, "scripts/check-docs-script-refs.mjs");
    runNodeScriptIfPresent(root, "scripts/check-docs-links.mjs");
    runNodeScriptIfPresent(root, "scripts/update-docs-inventory.mjs", ["--check"]);
    runTsxScriptIfPresent(root, "scripts/generate-site-map.ts", ["--check"]);
    runTsxScriptIfPresent(root, "scripts/generate-repo-awareness-snapshot.ts", ["--check"]);
    runNodeScriptIfPresent(root, "scripts/check-outstanding-issues-snapshot.mjs");
    runNodeScriptIfPresent(root, "scripts/generate-hazard-register-snapshot.mjs", ["--check"]);
    runNodeScriptIfPresent(root, "scripts/check-clinical-hazard-controls.mjs");
    runNodeScriptIfPresent(root, "scripts/organisation/check-instructions.mjs");
    runNodeScriptIfPresent(root, "scripts/organisation/decisions.mjs", ["check"]);
    runNodeScriptIfPresent(root, "scripts/list-database-skills.mjs", ["--check"]);
    runAdvisoryNodeScript(root, "scripts/generate-branch-review-index.mjs", ["--check"]);

    return { mode: "check", unplacedCount: 0 };
  }

  // Write / Maintain mode:
  // Step 1: Run check-organisation and auto-place any unplaced files, then tidy via --fix
  const placementResult = placeUnplacedFiles(root, { runCheckFirst: true });
  runNodeScriptIfPresent(root, "scripts/check-organisation.mjs", ["--fix"]);

  // Step 2: Sync codebase-index Areas section, inventory counts, sitemap, snapshots, and branch-review index
  runNodeScriptIfPresent(root, "scripts/organisation/codebase-index-section.mjs", ["--write"]);
  runNodeScriptIfPresent(root, "scripts/update-docs-inventory.mjs");
  runTsxScriptIfPresent(root, "scripts/generate-site-map.ts");
  runTsxScriptIfPresent(root, "scripts/generate-repo-awareness-snapshot.ts");
  runNodeScriptIfPresent(root, "scripts/generate-outstanding-issues-snapshot.mjs");
  runNodeScriptIfPresent(root, "scripts/generate-hazard-register-snapshot.mjs");
  runNodeScriptIfPresent(root, "scripts/generate-branch-review-index.mjs");

  // Step 3: Refresh pins ONLY if explicit paths were passed via --refresh-pins
  const pinResult = refreshPinPaths.length > 0 ? refreshDocPins(root, { paths: refreshPinPaths }) : { updated: false };

  // Step 4: Run full --check verification to confirm clean state
  runDocsMaintain({ root, check: true });

  return {
    mode: "write",
    placed: placementResult.placed,
    updatedSystemFiles: placementResult.updatedSystemFiles,
    pinsRefreshed: pinResult.updated,
  };
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  let check = false;
  let classifyMode = false;
  let refreshPinsMode = false;
  const classifyPaths = [];
  const refreshPinPaths = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--check") {
      check = true;
      classifyMode = false;
      refreshPinsMode = false;
    } else if (arg === "--classify") {
      classifyMode = true;
      refreshPinsMode = false;
    } else if (arg === "--refresh-pins") {
      refreshPinsMode = true;
      classifyMode = false;
    } else if (classifyMode) {
      classifyPaths.push(arg);
    } else if (refreshPinsMode) {
      refreshPinPaths.push(arg);
    }
  }

  return { check, classifyMode, classifyPaths, refreshPinPaths };
}

function isExecutedDirectly() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (isExecutedDirectly()) {
  try {
    const { check, classifyMode, classifyPaths, refreshPinPaths } = parseCliArgs(process.argv);
    if (classifyMode && classifyPaths.length === 0) {
      console.error("Usage: node scripts/maintain-docs-system.mjs --classify <path...>");
      process.exit(1);
    }
    runDocsMaintain({ check, classifyPaths, refreshPinPaths });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
