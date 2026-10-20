#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { offlineTestEnvironment } from "./test-environment.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(projectRoot, "tests", "flake-ledger.json");
const requiredFields = [
  "id",
  "title",
  "spec",
  "reason",
  "owner",
  "reproduction",
  "firstSeen",
  "lastSeen",
  "expires",
  "tracking",
];
const dayMs = 24 * 60 * 60 * 1000;

function dateValue(value, field, id) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${id}: ${field} must be YYYY-MM-DD`);
  const parsed = Date.parse(`${value}T23:59:59Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${id}: ${field} is not a valid date`);
  }
  return parsed;
}

export function validateFlakeLedgerEntries(flakes, { root = projectRoot, now = Date.now() } = {}) {
  const ids = new Set();
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  const latestAllowedExpiry = today + 31 * dayMs - 1;
  for (const flake of flakes) {
    const missing = requiredFields.filter((field) => typeof flake[field] !== "string" || !flake[field].trim());
    if (missing.length) throw new Error(`flake-ledger ${flake.id ?? "entry"} missing: ${missing.join(", ")}`);
    if (ids.has(flake.id)) throw new Error(`duplicate flake-ledger id: ${flake.id}`);
    ids.add(flake.id);

    const firstSeen = dateValue(flake.firstSeen, "firstSeen", flake.id);
    const lastSeen = dateValue(flake.lastSeen, "lastSeen", flake.id);
    const expires = dateValue(flake.expires, "expires", flake.id);
    if (firstSeen > lastSeen) throw new Error(`${flake.id}: firstSeen cannot be after lastSeen`);
    if (lastSeen > expires) throw new Error(`${flake.id}: lastSeen cannot be after expires`);
    if (expires < now) throw new Error(`${flake.id}: ledger entry expired ${flake.expires}`);
    if (expires > latestAllowedExpiry) throw new Error(`${flake.id}: expiry must be within 30 days`);
    if (flake.title.includes("@critical"))
      throw new Error(`${flake.id}: a test cannot be both @quarantine and @critical`);

    if (!/^tests\/[\w./-]+\.spec\.[cm]?[jt]sx?$/.test(flake.spec) || flake.spec.split("/").includes(".."))
      throw new Error(`${flake.id}: spec must be a repository browser spec`);
    readFileSync(path.join(root, flake.spec), "utf8");
  }
  return flakes;
}

export function loadFlakeLedger(sourcePath = ledgerPath) {
  const raw = JSON.parse(readFileSync(sourcePath, "utf8"));
  if (!raw || !Array.isArray(raw.flakes)) throw new Error("flake-ledger must contain a flakes array");
  return validateFlakeLedgerEntries(raw.flakes);
}

/** Consume Playwright's real collection, including title tags and inherited tags.
 * Collect production and mockup file patterns before either tag filter runs.
 * --list neither starts webServer nor executes hooks/tests/browser launches.
 */
export function collectBrowserTests({ root = projectRoot, run = spawnSync } = {}) {
  const result = run(
    process.execPath,
    [
      path.join(root, "node_modules/playwright/cli.js"),
      "test",
      "--list",
      "--project=chromium",
      "--project=chromium-mockups",
      "--grep=.*",
      "--grep-invert=(?!)",
      "--reporter=json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
      env: offlineTestEnvironment(process.env, { PLAYWRIGHT_BASE_URL: "http://127.0.0.1:9", CI: "true" }),
    },
  );
  if (result.error || result.status !== 0 || result.signal)
    throw new Error(
      `Playwright quarantine collection failed (status=${result.status}, signal=${result.signal ?? "none"}): ${
        [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n").slice(0, 8_000) || "no output"
      }`,
    );
  const report = JSON.parse(result.stdout);
  if (report.errors?.length || !Array.isArray(report.suites))
    throw new Error("Playwright quarantine collection is incomplete");
  const tests = browserTestsFromReport(report);
  if (!tests.length) throw new Error("Playwright quarantine collection contains no browser tests");
  return tests;
}

export function browserTestsFromReport(report) {
  const tests = [];
  const visit = (suite, ancestors = []) => {
    // File suites are identity containers, not part of JUnit testcase names.
    const titles = suite.column === 0 || suite.line === 0 ? ancestors : [...ancestors, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      tests.push({
        spec: `tests/${String(spec.file)
          .replaceAll("\\", "/")
          .replace(/^tests\//, "")}`,
        title: [...titles, spec.title].join(" › "),
        tags: (spec.tags ?? []).map((tag) => `@${tag.replace(/^@/, "")}`),
        projects: (spec.tests ?? []).map((test) => test.projectName),
      });
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites) visit(suite);
  return tests;
}

export function validateCollectedQuarantines(flakes, tests) {
  const identity = (test) => `${test.spec}\0${test.title}`;
  const registrations = new Map();
  for (const flake of flakes) {
    const key = identity(flake);
    if (registrations.has(key)) throw new Error(`duplicate flake-ledger identity: ${flake.spec} :: ${flake.title}`);
    registrations.set(key, flake);
  }
  const quarantined = new Map();
  for (const test of tests) {
    // Match the runner's grep regexes, including suffixes such as
    // @quarantine-extra. Token equality would silently lose excluded tests.
    const grepText = [test.title, ...(test.tags ?? [])].join(" ");
    if (!/@quarantine/.test(grepText)) continue;
    if (/@critical/.test(grepText)) throw new Error(`a test cannot be both @quarantine and @critical: ${test.title}`);
    const key = identity(test);
    if (quarantined.has(key)) throw new Error(`ambiguous quarantined test identity: ${test.spec} :: ${test.title}`);
    if (!registrations.has(key)) throw new Error(`unregistered @quarantine: ${test.spec} :: ${test.title}`);
    if (/@mockup/.test(grepText) && !test.projects?.includes("chromium-mockups"))
      throw new Error(`quarantined @mockup has no advisory project route: ${test.spec} :: ${test.title}`);
    quarantined.set(key, test);
  }
  for (const [key, flake] of registrations) {
    if (!quarantined.has(key))
      throw new Error(
        `${flake.id}: exact title is not present as a collected @quarantine in ${flake.spec} (stale ledger entry)`,
      );
  }
  return [...quarantined.values()];
}

function normalizeSpec(spec) {
  return String(spec ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .toLowerCase();
}

export function matchFlake(spec, testTitle, flakes = loadFlakeLedger()) {
  const normalizedSpec = normalizeSpec(spec);
  const title = String(testTitle ?? "")
    .trim()
    .toLowerCase();
  if (!normalizedSpec || !title) return null;
  return (
    flakes.find(
      (flake) => normalizeSpec(flake.spec) === normalizedSpec && flake.title.trim().toLowerCase() === title,
    ) ?? null
  );
}

function selfTest() {
  const flakes = loadFlakeLedger();
  if (new Set(flakes.map((flake) => flake.id)).size !== flakes.length) throw new Error("flake ids are not unique");
  const sample = [{ spec: "tests/example.spec.ts", title: "exact quarantined title @quarantine", id: "sample" }];
  if (matchFlake("tests/example.spec.ts", "EXACT QUARANTINED TITLE @QUARANTINE", sample)?.id !== "sample")
    throw new Error("exact title did not match");
  if (matchFlake("tests/example.spec.ts", "prefix exact quarantined title @quarantine", sample))
    throw new Error("partial title unexpectedly matched");
  if (matchFlake("tests/other.spec.ts", "exact quarantined title @quarantine", sample))
    throw new Error("cross-spec title unexpectedly matched");
  console.error(`[flake-ledger] self-test passed (${flakes.length} active entries)`);
}

function main() {
  if (process.argv.includes("--validate-collected")) {
    const quarantines = validateCollectedQuarantines(loadFlakeLedger(), collectBrowserTests());
    console.log(`[flake-ledger] collected quarantine validation passed (${quarantines.length} owned active tests)`);
    return;
  }
  if (process.argv.includes("--self-test")) return selfTest();
  if (process.argv.includes("--list")) {
    for (const flake of loadFlakeLedger()) console.log(`${flake.id}\t${flake.spec}\t${flake.title}`);
    return;
  }
  const matchIndex = process.argv.indexOf("--match");
  if (matchIndex >= 0) {
    console.log(matchFlake(process.argv[matchIndex + 1], process.argv[matchIndex + 2])?.id ?? "none");
    return;
  }
  console.error('usage: flake-ledger.mjs [--list | --self-test | --match "<exact spec>" "<exact title>"]');
  process.exitCode = 1;
}

if (isDirectEntrypoint(import.meta.url)) main();
