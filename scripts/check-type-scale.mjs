#!/usr/bin/env node
// Guardrail/diagnostic: flags arbitrary Tailwind font-size utilities and raw
// font sizes in the shared clinical/Work mode stylesheets.
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
//                                               into `verify:full` with the backlog
//                                               cleared to 0, so this is a hard zero
//                                               gate (no baseline) — unlike the
//                                               ratcheting design-system contract.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import postcss from "postcss";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const ARBITRARY = /\btext-\[(\d*\.?\d+)(px|rem|em)\]/g;
const SHARED_MODE_STYLESHEETS = new Set(["src/app/clinical-mode.css", "src/app/work-mode.css"]);

/** Remove var() references with their nested fallbacks before checking literals. */
function withoutCustomPropertyReferences(value) {
  let remaining = value.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
  let match;
  while ((match = /\bvar\s*\(/i.exec(remaining))) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < remaining.length && depth > 0) {
      if (remaining[end] === "(") depth += 1;
      else if (remaining[end] === ")") depth -= 1;
      end += 1;
    }
    remaining = `${remaining.slice(0, match.index)} ${remaining.slice(end)}`;
  }
  return remaining;
}

/**
 * Bounded stylesheet enforcement, not a ban on all CSS typography geometry.
 * globals.css retains its root-density, iOS input-floor, print and measured
 * annotation exceptions. Shared mode styles use type roles; responsive bounds
 * such as min(var(--text-xl), 10cqi) and var() fallback sizes remain valid.
 */
export function findRawSharedModeFontSizes(relativePath, sourceText) {
  if (!SHARED_MODE_STYLESHEETS.has(relativePath)) return [];
  const hits = [];
  postcss.parse(sourceText, { from: relativePath }).walkDecls(/^(?:font-size|font)$/i, (declaration) => {
    const hasTypeRole = /var\(\s*--text-[\w-]+\s*[,)]/.test(declaration.value);
    const value = withoutCustomPropertyReferences(declaration.value);
    const lengths = [
      ...value.matchAll(
        /(?<![\w-])-?(?:\d*\.)?\d+(?:px|rem|em|pt|pc|in|cm|mm|q|ch|ex|lh|rlh|%|[sld]?v[whib]|cq[whib]|cqmin|cqmax|vmin|vmax)(?![\w-])/gi,
      ),
    ];
    const rawLengths = lengths.filter(
      ([length]) => !hasTypeRole || !/(?:[sld]?v[whib]|cq[whib]|cqmin|cqmax|vmin|vmax)$/i.test(length),
    );
    if (
      rawLengths.length > 0 ||
      (declaration.prop.toLowerCase() === "font-size" && /^0(?:\.0+)?$/.test(value.trim()))
    ) {
      hits.push({ file: relativePath, line: declaration.source?.start?.line ?? 1, match: declaration.toString() });
    }
  });
  return hits;
}

function main() {
  const strict = process.argv.includes("--strict");
  // Tracked source files under src (fast; respects .gitignore).
  const files = execSync("git ls-files src", { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(tsx?|jsx?|css)$/.test(f));

  const utilityHits = [];
  const stylesheetHits = [];
  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    source.split("\n").forEach((line, i) => {
      for (const match of line.matchAll(ARBITRARY)) {
        utilityHits.push({ file, line: i + 1, match: match[0] });
      }
    });
    stylesheetHits.push(...findRawSharedModeFontSizes(file, source));
  }

  if (utilityHits.length === 0 && stylesheetHits.length === 0) {
    console.log(
      "✓ type-scale: no arbitrary text-[<n>px|rem|em] font sizes in src; shared mode stylesheet font sizes use tokens.",
    );
    return 0;
  }

  if (utilityHits.length > 0) {
    const bySize = new Map();
    for (const hit of utilityHits) bySize.set(hit.match, (bySize.get(hit.match) ?? 0) + 1);
    const fileCount = new Set(utilityHits.map((hit) => hit.file)).size;
    console.log(
      `type-scale: ${utilityHits.length} arbitrary font-size utilities bypass the scale (across ${fileCount} files):\n`,
    );
    for (const [size, count] of [...bySize.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${size}`);
    }
  }
  if (stylesheetHits.length > 0) {
    console.log(`type-scale: ${stylesheetHits.length} raw shared mode stylesheet font sizes bypass the scale:\n`);
    for (const hit of stylesheetHits) console.log(`  ${hit.file}:${hit.line} (${hit.match})`);
  }
  console.log("\nPrefer a named type role from src/app/globals.css or ckb-v2-tokens.css.");
  console.log("Colour utilities and font-size var() fallbacks are fine and not counted.");
  if (strict) {
    console.error("\n✗ --strict: arbitrary font sizes present.");
    return 1;
  }
  return 0;
}

if (isDirectEntrypoint(import.meta.url)) process.exitCode = main();
