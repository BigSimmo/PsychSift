#!/usr/bin/env node
// Weekly report section (stage 3): where the repository's older path classifiers disagree with
// the organisation map. Report only. The classifiers keep deciding what they always decided; the
// map never overrides them and this never edits them (owner decision: "Report").
//
// The seven path classifiers that existed before the map, each of which sorts files by path:
//   1. PR policy (scripts/pr-policy.mjs): ranking-protected, clinical-risk, migration,
//      operational-risk and UI files.
//   2. CI change scope (scripts/ci-change-scope.mjs): which CI lanes a change runs.
//   3. Flight-plan risk classes (scripts/productivity-core.mjs `classifyRisks`).
//   4. Clear PRs protected paths (scripts/pr-batch-core.mjs `protectedPath`).
//   5. Browser test planner (scripts/browser-test-plan.mjs).
//   6. CODEOWNERS (.github/CODEOWNERS).
//   7. Site-content owners (src/lib/site-content/site-content-change-owners.json).
// A pairing "class => areas" is compared only where it means something about a file's job. The
// others sort by risk, protection or which checks to run, which differs from the map by design.
//
// Classifiers are called without side effects: modules are imported (pure functions), and
// ci-change-scope, which has no main guard and appends to $GITHUB_OUTPUT on import, runs as a
// child process in its --json mode with that variable removed. Its answer is for a whole file
// list, so single files are found by splitting positive lists in half (its lanes are "any file
// matches", so a list is positive exactly when one of its files is).
//
// `--update-baseline` rewrites docs/organisation/classifier-baseline.json with today's
// disagreements; the report lists only disagreements that are not in it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { areasOf, codeSpan, headCommit, mapAtHead, mdEscape } from "../map-placement.mjs";

export const BASELINE_FILE = "docs/organisation/classifier-baseline.json";
const BASELINE_VERSION = 1;
const LIST_CAP = 30;
const CHUNK = 100;

/**
 * @typedef {{ cls: string, flag: string, expect: string[], only?: RegExp }} Pairing
 * @typedef {{ id: string, name: string, pairings: Pairing[], notCompared: string,
 *   classify?: (root: string, candidates: Map<string, string[]>) => Promise<Map<string, string[]>> }} Classifier
 * @typedef {{ classifier: string, file: string, area: string }} BaselineEntry
 */

async function importFromRoot(root, file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`${file} is missing`);
  return import(pathToFileURL(full).href);
}

// Each classify(root, candidates) gets, per class, the files placed outside that class's expected
// areas, and returns, per class, the ones the classifier puts in the class.
function filterPerClass(candidates, inClass) {
  const out = new Map();
  for (const [cls, files] of candidates)
    out.set(
      cls,
      files.filter((file) => inClass(file, cls)),
    );
  return out;
}

function limiter(max) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function runCiScope(root, files) {
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  delete env.GITHUB_STEP_SUMMARY;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/ci-change-scope.mjs", "--json", "--", ...files], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ci-change-scope exited ${code}: ${err.trim().split("\n")[0]}`));
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(new Error(`ci-change-scope printed unreadable JSON: ${error.message}`));
      }
    });
  });
}

/**
 * Files in `files` for which `test(list)` is true on their own, found by halving positive lists.
 * @param {string[]} files
 * @param {(list: string[]) => Promise<boolean>} test
 * @returns {Promise<string[]>}
 */
export async function findPositives(files, test) {
  if (!files.length || !(await test(files))) return [];
  if (files.length === 1) return files;
  const mid = Math.ceil(files.length / 2);
  const halves = await Promise.all([findPositives(files.slice(0, mid), test), findPositives(files.slice(mid), test)]);
  return halves.flat();
}

/** @type {Classifier[]} */
export const CLASSIFIERS = [
  {
    id: "pr-policy",
    name: "PR policy",
    pairings: [
      { cls: "ranking-protected", flag: "ragRanking", expect: ["answer-engine", "source-intake"] },
      { cls: "migration", flag: "migration", expect: ["data-platform"] },
      { cls: "operational-risk", flag: "operationalRisk", expect: ["delivery"] },
      // Every page sits in App experience whatever mode it serves (owner decision, 2026-09-26), so
      // a page filed in any other area is misplaced. Only pages: route handlers (`route.ts`) are server
      // code, and the UI class also covers components and assets that an area's tools may keep.
      {
        cls: "UI pages",
        flag: "ui",
        only: /^src\/app\/(?!api\/)(?!.*\/route\.[cm]?[jt]sx?$)/,
        expect: ["app-experience", "design-system", "prototypes"],
      },
    ],
    notCompared:
      "its clinical-risk class sorts by risk, which spans areas by design, and its UI class is compared for pages only",
    async classify(root, candidates) {
      const { classifyPullRequestFiles } = await importFromRoot(root, "scripts/pr-policy.mjs");
      const flags = new Map(this.pairings.map((p) => [p.cls, p.flag]));
      return filterPerClass(candidates, (file, cls) => Boolean(classifyPullRequestFiles([file])[flags.get(cls)]));
    },
  },
  {
    id: "ci-change-scope",
    name: "CI change scope",
    pairings: [
      { cls: "database lane", flag: "db_changed", expect: ["data-platform"] },
      { cls: "ingestion scan lane", flag: "ingestion_sast_changed", expect: ["source-intake"] },
    ],
    notCompared: "its other lanes choose which CI jobs run, not what a file does",
    async classify(root, candidates) {
      if (!fs.existsSync(path.join(root, "scripts/ci-change-scope.mjs"))) {
        throw new Error("scripts/ci-change-scope.mjs is missing");
      }
      const limit = limiter(Math.max(2, Math.min(8, os.availableParallelism?.() ?? 4)));
      const cache = new Map();
      const run = (files) => {
        const key = files.join("\n");
        if (!cache.has(key))
          cache.set(
            key,
            limit(() => runCiScope(root, files)),
          );
        return cache.get(key);
      };
      const out = new Map();
      for (const pairing of this.pairings) {
        const files = candidates.get(pairing.cls) ?? [];
        const chunks = [];
        for (let i = 0; i < files.length; i += CHUNK) chunks.push(files.slice(i, i + CHUNK));
        const found = await Promise.all(
          chunks.map((chunk) => findPositives(chunk, async (list) => Boolean((await run(list))[pairing.flag]))),
        );
        out.set(pairing.cls, found.flat());
      }
      return out;
    },
  },
  {
    id: "flight-plan",
    name: "Flight-plan risk classes",
    pairings: [
      { cls: "deployment", flag: "deployment", expect: ["delivery"] },
      { cls: "dependency", flag: "dependency", expect: ["delivery"] },
    ],
    notCompared:
      "its retrieval, database, clinical, privacy, UI and workflow classes sort by risk and include API routes and tests from several areas",
    async classify(root, candidates) {
      const { classifyRisks } = await importFromRoot(root, "scripts/productivity-core.mjs");
      const flags = new Map(this.pairings.map((p) => [p.cls, p.flag]));
      return filterPerClass(candidates, (file, cls) => Boolean(classifyRisks([file])[flags.get(cls)]));
    },
  },
  {
    id: "clear-prs",
    name: "Clear PRs protected paths",
    pairings: [],
    notCompared: "it sorts by what an unattended merge batch may touch, not by job",
  },
  {
    id: "browser-test-plan",
    name: "Browser test planner",
    pairings: [],
    notCompared: "it picks browser journeys by what a change can break, not by job",
  },
  {
    id: "codeowners",
    name: "CODEOWNERS",
    pairings: [],
    notCompared: "one owner covers every path, and its sections restate the risk surfaces",
  },
  {
    id: "site-content-owners",
    name: "Site-content owners",
    pairings: [],
    notCompared: "content producers sit in clinical content, client-side search and retrieval by design",
  },
];

/**
 * Today's disagreements: files a classifier puts in a paired class while the map places them
 * outside every expected area. Unplaced, ignored and not-yet-placed files are not compared.
 * @param {{ root: string, classifiers?: Classifier[] }} options
 * @returns {Promise<{ disagreements: Array<BaselineEntry & { expected: string[] }>,
 *   unavailable: Array<{ classifier: string, reason: string }> }>}
 */
export async function findDisagreements({ root, classifiers = CLASSIFIERS } = {}) {
  const map = mapAtHead(root);
  const placed = [...map.files]
    .map((file) => ({ file, areas: areasOf(map.placement[file]) }))
    .filter((f) => f.areas.length)
    .sort((a, b) => a.file.localeCompare(b.file));
  const disagreements = [];
  const unavailable = [];
  for (const classifier of classifiers) {
    if (!classifier.pairings.length) continue;
    const candidates = new Map(
      classifier.pairings.map((p) => [
        p.cls,
        placed
          .filter((f) => (!p.only || p.only.test(f.file)) && !f.areas.some((a) => p.expect.includes(a)))
          .map((f) => f.file),
      ]),
    );
    let found;
    try {
      found = await classifier.classify(root, candidates);
    } catch (error) {
      unavailable.push({ classifier: classifier.name, reason: error.message });
      continue;
    }
    for (const pairing of classifier.pairings) {
      for (const file of found.get(pairing.cls) ?? []) {
        disagreements.push({
          classifier: `${classifier.name}: ${pairing.cls}`,
          file,
          area: map.placement[file],
          expected: pairing.expect,
        });
      }
    }
  }
  disagreements.sort((a, b) => a.classifier.localeCompare(b.classifier) || a.file.localeCompare(b.file));
  return { disagreements, unavailable };
}

const keyOf = (entry) => `${entry.classifier}\0${entry.file}`;

/**
 * The committed baseline from the working tree, or null when missing or unreadable.
 * @param {string} root
 * @returns {BaselineEntry[] | null}
 */
export function readBaseline(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, BASELINE_FILE), "utf8"));
    if (data?.version !== BASELINE_VERSION || !Array.isArray(data.disagreements)) return null;
    return data.disagreements;
  } catch {
    return null;
  }
}

export function baselineText(disagreements) {
  const entries = disagreements.map(({ classifier, file, area }) => ({ classifier, file, area }));
  return `${JSON.stringify({ version: BASELINE_VERSION, disagreements: entries }, null, 2)}\n`;
}

/**
 * Rewrites the baseline with today's disagreements. Refuses when a classifier could not run.
 * @param {{ root: string, classifiers?: Classifier[] }} options
 * @returns {Promise<number>} how many disagreements were recorded
 */
export async function updateBaseline({ root, classifiers = CLASSIFIERS } = {}) {
  const { disagreements, unavailable } = await findDisagreements({ root, classifiers });
  if (unavailable.length) {
    throw new Error(`not updating the baseline: ${unavailable.map((u) => `${u.classifier} (${u.reason})`).join("; ")}`);
  }
  fs.writeFileSync(path.join(root, BASELINE_FILE), baselineText(disagreements));
  return disagreements.length;
}

function describePairings(classifiers) {
  const compared = [];
  const skipped = [];
  for (const c of classifiers) {
    for (const p of c.pairings) compared.push(`${c.name} "${p.cls}" belongs in ${p.expect.join(" or ")}`);
    skipped.push(`${c.name}: ${c.notCompared}`);
  }
  return { compared, skipped };
}

/**
 * @param {{ root: string, now?: Date, classifiers?: Classifier[] }} options
 * @returns {Promise<{ title: string, markdown: string }>}
 */
export async function section({ root, now, classifiers = CLASSIFIERS } = {}) {
  void now; // the result depends only on HEAD and the committed baseline
  const title = "Where the older path classifiers disagree with the map";
  const { disagreements, unavailable } = await findDisagreements({ root, classifiers });
  const baseline = readBaseline(root);
  const lines = [
    "The older path classifiers keep deciding what they always decided; the map never overrides them. " +
      "Each is compared with the map only where a pairing says something about a file's job.",
    "",
  ];
  if (baseline === null) {
    lines.push(
      `No readable baseline at \`${BASELINE_FILE}\`, so every disagreement is listed. ` +
        "Record today's with `node scripts/organisation/weekly/classifier-disagreements.mjs --update-baseline`.",
      "",
    );
  }
  const known = new Set((baseline ?? []).map(keyOf));
  const today = new Set(disagreements.map(keyOf));
  const fresh = disagreements.filter((d) => !known.has(keyOf(d)));
  const resolved = (baseline ?? []).filter((d) => !today.has(keyOf(d)));
  lines.push(
    `**${fresh.length} new disagreement${fresh.length === 1 ? "" : "s"}** ` +
      `(${disagreements.length} today, ${baseline?.length ?? 0} in the baseline).`,
  );
  if (fresh.length) {
    lines.push("");
    for (const d of fresh.slice(0, LIST_CAP)) {
      lines.push(
        `- ${codeSpan(d.file)}: ${d.classifier} (expected in ${d.expected.join(" or ")}), ` +
          `but the map places it in ${mdEscape(d.area)}`,
      );
    }
    if (fresh.length > LIST_CAP) lines.push(`- …and ${fresh.length - LIST_CAP} more`);
    lines.push(
      "",
      "For each: either the map line is wrong (move the file to the right area) or the classifier's list is out of " +
        "date (fix it in its own PR, with that list's usual review). If both are right, record it with " +
        "`--update-baseline`.",
    );
  }
  if (resolved.length) {
    lines.push(
      "",
      `${resolved.length} baseline entr${resolved.length === 1 ? "y no longer disagrees" : "ies no longer disagree"}; ` +
        "`--update-baseline` drops them.",
    );
  }
  if (unavailable.length) {
    lines.push("", "Could not run, so not compared:", "");
    for (const u of unavailable) lines.push(`- ${u.classifier}: ${mdEscape(u.reason)}`);
  }
  const { compared, skipped } = describePairings(classifiers);
  lines.push(
    "",
    "<details><summary>What is compared</summary>",
    "",
    ...compared.map((c) => `- ${c}`),
    "",
    "Not compared, because they sort files by something other than their job:",
    "",
    ...skipped.map((s) => `- ${s}`),
    "",
    "</details>",
  );
  return { title, markdown: `${lines.join("\n")}\n` };
}

async function main(argv) {
  const rootIndex = argv.indexOf("--root");
  const root = path.resolve(
    rootIndex >= 0 ? argv[rootIndex + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  );
  if (argv.includes("--update-baseline")) {
    const count = await updateBaseline({ root });
    console.log(`classifier baseline: ${count} disagreement(s) recorded in ${BASELINE_FILE} at ${headCommit(root)}`);
    return 0;
  }
  const { title, markdown } = await section({ root });
  process.stdout.write(`## ${title}\n\n${markdown}`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error) => {
      console.error(`classifier disagreements: ${error.message}`);
      process.exitCode = 2;
    },
  );
}
