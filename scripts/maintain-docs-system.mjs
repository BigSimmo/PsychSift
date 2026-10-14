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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "..");

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
 * @returns {{
 *   path: string,
 *   system: string,
 *   systemFile: string,
 *   resolvedSystem: string,
 *   resolvedSystemFile: string,
 *   reason: string
 * }}
 */
export function classifyRepositoryPath(relativePath) {
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

  // 2. sources-and-ingestion / source-intake (source registry, document upload, extraction, ingestion workers, storage)
  if (
    lower.startsWith("src/lib/sources/") ||
    lower === "src/lib/sources" ||
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

  // 3. personal-practice (CME/CPD, roster, my-day, teaching, open-shifts, work, diary, workspace)
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

  // 4. clinical-modes / clinical-content (psychiatry, therapy, formulation, diagnosis, medications, sleep, scales, calculators, ect, ranzcp, dsm, differentials, on-call, care-plan, dictionary)
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

  // 5. knowledge (entry docs, agent tooling, ledgers, organisation map, decisions, knowledge graph, library)
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

  // 6. shell-and-design (navigation, global search shell, header, dock, theme, CSS tokens, design system, UI components)
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

  // 7. operations-and-governance (CI, scripts, tests, migrations, Supabase, security, privacy, release, fallback)
  const isDataPlatform = lower.startsWith("supabase/") || lower === "supabase";
  return buildResult(
    "operations-and-governance",
    isDataPlatform ? "data-platform" : "delivery",
    "Matches CI, scripts, tests, migrations, security/privacy/clinical governance, or operational paths.",
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
    const classification = classifyRepositoryPath(relPath);
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

  return { placed, updatedSystemFiles: updatedSystemFiles.sort() };
}

/**
 * Updates `docs/organisation/pins.json` so every pinned document whose file exists on disk
 * has its reviewed commit pin refreshed to the current `HEAD` SHA.
 *
 * @param {string} [root]
 * @param {{ headSha?: string }} [options]
 * @returns {{ updated: boolean, headSha: string | null, updatedPaths: string[] }}
 */
export function refreshDocPins(root = DEFAULT_ROOT, options = {}) {
  const pinsPath = path.join(root, "docs", "organisation", "pins.json");
  if (!fs.existsSync(pinsPath)) {
    return { updated: false, headSha: null, updatedPaths: [] };
  }

  let headSha = options.headSha || null;
  if (!headSha) {
    try {
      headSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return { updated: false, headSha: null, updatedPaths: [] };
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
      const entryPath = entry?.path || entry?.file;
      if (typeof entryPath === "string" && fs.existsSync(path.join(root, entryPath))) {
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
      for (const docPath of Object.keys(parsed.pins)) {
        if (fs.existsSync(path.join(root, docPath))) {
          const currentVal = parsed.pins[docPath];
          if (typeof currentVal === "string") {
            if (currentVal !== headSha) {
              parsed.pins[docPath] = headSha;
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
        const entryPath = entry?.path || entry?.file;
        if (typeof entryPath === "string" && fs.existsSync(path.join(root, entryPath))) {
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
 *   classifyPaths?: string[]
 * }} [options]
 */
export function runDocsMaintain(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const check = Boolean(options.check);
  const classifyPaths = Array.isArray(options.classifyPaths) ? options.classifyPaths : [];

  if (classifyPaths.length > 0) {
    const results = classifyPaths.map((p) => classifyRepositoryPath(p));
    const payload = results.length === 1 ? results[0] : results;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return { mode: "classify", results };
  }

  if (check) {
    // 1. Verify organisation manifest & unplaced count === 0
    runNodeScriptIfPresent(root, "scripts/check-organisation.mjs");
    const { unplacedCount, unplacedFiles } = readOrganisationReport(root);
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
    runNodeScriptIfPresent(root, "scripts/generate-outstanding-issues-snapshot.mjs", ["--check"]);
    runNodeScriptIfPresent(root, "scripts/generate-hazard-register-snapshot.mjs", ["--check"]);
    runNodeScriptIfPresent(root, "scripts/check-clinical-hazard-controls.mjs");
    runNodeScriptIfPresent(root, "scripts/organisation/check-instructions.mjs");
    runNodeScriptIfPresent(root, "scripts/organisation/decisions.mjs", ["check"]);
    runNodeScriptIfPresent(root, "scripts/list-database-skills.mjs", ["--check"]);
    runNodeScriptIfPresent(root, "scripts/generate-branch-review-index.mjs", ["--check"]);

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

  // Step 3: Refresh reviewed commit pins in docs/organisation/pins.json
  const pinResult = refreshDocPins(root);

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
  const classifyPaths = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--check") {
      check = true;
    } else if (arg === "--classify") {
      classifyMode = true;
    } else if (classifyMode) {
      classifyPaths.push(arg);
    }
  }

  return { check, classifyMode, classifyPaths };
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
    const { check, classifyMode, classifyPaths } = parseCliArgs(process.argv);
    if (classifyMode && classifyPaths.length === 0) {
      console.error("Usage: node scripts/maintain-docs-system.mjs --classify <path...>");
      process.exit(1);
    }
    runDocsMaintain({ check, classifyPaths });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
