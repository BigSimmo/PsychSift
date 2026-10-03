#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { loadFlakeLedger, matchFlake } from "./flake-ledger.mjs";

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

const repositorySpec = (classname) => {
  const normalized = classname.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized.startsWith("tests/") ? normalized : `tests/${normalized}`;
};

export function failedTestcasesFromJunit(xml) {
  return [...xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)]
    .filter((match) => {
      const body = match[2].replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!--[\s\S]*?-->/g, "");
      return /<(?:failure|error)\b/.test(body);
    })
    .map((match) => ({ spec: repositorySpec(attribute(match[1], "classname")), title: attribute(match[1], "name") }))
    .filter((testcase) => testcase.spec && testcase.title);
}

function main() {
  const reportPath = process.argv[2] ?? "test-results/playwright-junit.xml";
  if (!existsSync(reportPath)) {
    console.error(`Playwright JUnit report not found: ${reportPath}`);
    process.exitCode = 1;
    return;
  }

  const failures = failedTestcasesFromJunit(readFileSync(reportPath, "utf8"));
  if (failures.length === 0) {
    console.log("No failed Playwright testcases were found in the JUnit report.");
    return;
  }

  const flakes = loadFlakeLedger();
  console.log("Playwright failure classification:");
  for (const { spec, title } of failures) {
    const known = matchFlake(spec, title, flakes);
    console.log(`- ${spec} :: ${title}: ${known ? `known quarantine (${known.id})` : "needs investigation"}`);
  }
}

if (isDirectEntrypoint(import.meta.url)) main();
