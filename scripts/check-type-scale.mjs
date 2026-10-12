#!/usr/bin/env node
// Guardrail/diagnostic: flags arbitrary Tailwind font-size utilities
// (e.g. text-[12px], text-[1.45rem]) that bypass the design type scale.
//
// The scale lives in the @theme block of src/app/globals.css: named steps
// text-3xs … text-3xl-minus, on top of Tailwind's default xs/sm/base/lg/xl/2xl/3xl.
// 12px is the floor: text-3xs and text-2xs are legacy names that now alias xs
// (owner decision 12 Oct 2026); the old 8px text-4xs step is retired.
// Arbitrary text-[<n><unit>] values re-introduce off-scale sizes; this check
// tracks that drift. Colour utilities (text-[color:var(--…)]) are the sanctioned
// token-access form and are intentionally NOT flagged.
//
// Usage:
//   node scripts/check-type-scale.mjs           report only, exit 0 (default)
//   node scripts/check-type-scale.mjs --strict  exit 1 if any found. Already wired
//                                               into `verify:cheap` with the backlog
//                                               cleared to 0, so this is a hard zero
//                                               gate (no baseline) — unlike the
//                                               ratcheting design-system contract.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const strict = process.argv.includes("--strict");
const ARBITRARY = /\btext-\[(\d*\.?\d+)(px|rem|em)\]/g;

// Tracked source files under src (fast; respects .gitignore).
const files = execSync("git ls-files src", { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(tsx?|jsx?|css)$/.test(f));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(ARBITRARY)) {
      hits.push({ file, line: i + 1, match: m[0] });
    }
  });
}

if (hits.length === 0) {
  console.log("✓ type-scale: no arbitrary text-[<n>px|rem|em] font sizes in src.");
  process.exit(0);
}

const bySize = new Map();
for (const h of hits) bySize.set(h.match, (bySize.get(h.match) ?? 0) + 1);
const fileCount = new Set(hits.map((h) => h.file)).size;

console.log(`type-scale: ${hits.length} arbitrary font-size utilities bypass the scale (across ${fileCount} files):\n`);
for (const [size, n] of [...bySize.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${size}`);
}
console.log("\nPrefer a named @theme step from src/app/globals.css (text-3xs, text-sm-minus, text-2xl-minus, …).");
console.log("Colour utilities like text-[color:var(--…)] are fine and not counted.");

if (strict) {
  console.error("\n✗ --strict: arbitrary font sizes present.");
  process.exit(1);
}
process.exit(0);
