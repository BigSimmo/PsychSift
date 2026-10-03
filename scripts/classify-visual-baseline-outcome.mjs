#!/usr/bin/env node
/**
 * Decide whether a failed `test:e2e:visual` run was pixel drift (advisory) or an
 * infrastructure / non-comparison failure that must stay red.
 *
 * Exit 0 → advisory drift only (or no failures found in an existing report).
 * Exit 1 → missing report, missing baselines, runtime/assertion failures, or mixed.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

/**
 * Must match the junit `outputFile` in `playwright.visual.config.ts` — NOT the
 * `playwright-junit.xml` that `playwright.config.ts` writes for the production-UI suite.
 * Both defaults were originally copied from that other config, so this script read a
 * report the visual suite never writes, took the "no report at all" branch on every real
 * drift, and reported `infrastructure` instead of `pixel-drift`. That inverted the whole
 * point of the classifier: the advisory path was unreachable and the job went hard red.
 * `tests/classify-visual-baseline-outcome.test.ts` now parses the config and pins this.
 */
export const DEFAULT_JUNIT = "test-results/visual-junit.xml";
/**
 * The visual config registers only `list` and `junit` reporters, so there is no JSON
 * report to read. Empty rather than a plausible-looking path: a default that can never
 * exist is how the junit constant above went unnoticed. Callers may still pass one.
 */
const DEFAULT_RESULTS = "";

const decode = (value) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const attribute = (attributes, name) => {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decode(match[1]) : "";
};

/** Failure/error bodies from a Playwright JUnit report. */
export function failureBodiesFromJunit(xml) {
  return [...xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)].flatMap((match) => {
    const title = attribute(match[1], "name");
    const classname = attribute(match[1], "classname");
    return [...match[2].matchAll(/<(?:failure|error)\b([^>]*)>([\s\S]*?)<\/(?:failure|error)>/g)].map((failure) => ({
      title,
      classname,
      message: attribute(failure[1], "message"),
      body: decode(failure[2]).trim(),
    }));
  });
}

function collectErrorMessages(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectErrorMessages(item, out);
    return out;
  }
  if (node.error?.message) out.push(String(node.error.message));
  if (Array.isArray(node.errors)) {
    for (const error of node.errors) {
      if (error?.message) out.push(String(error.message));
    }
  }
  for (const value of Object.values(node)) collectErrorMessages(value, out);
  return out;
}

export function failureMessagesFromResults(resultsJson) {
  return collectErrorMessages(resultsJson);
}

/** Pixel-drift only: toHaveScreenshot mismatch with an existing baseline. */
export function isPixelDriftFailure(text) {
  const haystack = String(text ?? "");
  if (!haystack) return false;
  if (/snapshot doesn't exist/i.test(haystack)) return false;
  if (/AWAITING_BASELINE/i.test(haystack)) return false;
  // `toHaveScreenshot` names the assertion, not the outcome — a page that closes, a
  // navigation that fails, or a timeout while that assertion is pending still puts the
  // matcher name in the JUnit title/message even though no pixel comparison ever ran.
  // Recognise those runtime failures explicitly and keep them red rather than trusting
  // the matcher name alone.
  if (/has been closed|target (?:page|closed)|test timeout|navigation failed|net::err_/i.test(haystack)) {
    return false;
  }
  return /toHaveScreenshot/i.test(haystack) || /Screenshot comparison failed/i.test(haystack);
}

function listDiffPngs(root = "test-results") {
  if (!existsSync(root)) return [];
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /-diff\.png$/i.test(entry.name)) found.push(full);
    }
  };
  walk(root);
  return found;
}

export function classifyVisualBaselineOutcome({
  junitPath = DEFAULT_JUNIT,
  resultsPath = DEFAULT_RESULTS,
  testResultsDir = "test-results",
} = {}) {
  const hasJunit = Boolean(junitPath) && existsSync(junitPath);
  const hasResults = Boolean(resultsPath) && existsSync(resultsPath);
  if (!hasJunit && !hasResults) {
    return {
      kind: "infrastructure",
      reason: "No Playwright JUnit or JSON report after visual comparison failure.",
    };
  }

  const messages = [];
  if (hasJunit) {
    for (const failure of failureBodiesFromJunit(readFileSync(junitPath, "utf8"))) {
      messages.push([failure.message, failure.body, failure.title].filter(Boolean).join("\n"));
    }
  }
  if (hasResults) {
    messages.push(...failureMessagesFromResults(JSON.parse(readFileSync(resultsPath, "utf8"))));
  }

  const unique = [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
  if (unique.length === 0) {
    const diffs = listDiffPngs(testResultsDir);
    if (diffs.length > 0) {
      return {
        kind: "pixel-drift",
        reason: `Found ${diffs.length} screenshot diff artifact(s) without parsed failure text.`,
      };
    }
    return {
      kind: "infrastructure",
      reason: "Visual comparison failed but the report contains no failed testcases.",
    };
  }

  const nonDrift = unique.filter((message) => !isPixelDriftFailure(message));
  if (nonDrift.length > 0) {
    return {
      kind: "non-drift",
      reason: `Non-comparison failure(s) present (${nonDrift.length}/${unique.length}).`,
      samples: nonDrift.slice(0, 3),
    };
  }

  return {
    kind: "pixel-drift",
    reason: `All ${unique.length} failure(s) are toHaveScreenshot pixel mismatches.`,
  };
}

function main() {
  const outcome = classifyVisualBaselineOutcome();
  if (outcome.kind === "pixel-drift") {
    console.log(`Visual baseline outcome: pixel-drift — ${outcome.reason}`);
    process.exitCode = 0;
    return;
  }
  console.error(`Visual baseline outcome: ${outcome.kind} — ${outcome.reason}`);
  for (const sample of outcome.samples ?? []) {
    console.error(`- ${sample.split("\n")[0].slice(0, 200)}`);
  }
  process.exitCode = 1;
}

if (isDirectEntrypoint(import.meta.url)) main();
