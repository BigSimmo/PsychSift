#!/usr/bin/env node
import { readFileSync } from "node:fs";

const budgets = new Map([
  // Chrome ownership/reporting lives in use-dashboard-chrome-coordinator; keep
  // the reclaimed monolith budget so it cannot silently drift back to 4160.
  // 3600: ratcheted down toward actual line count (~3521) to eliminate slack.
  ["src/components/ClinicalDashboard.tsx", 3600],
  // Evidence coverage, per-request hydration, and second-stage ranking live in
  // focused rag modules; keep the reclaimed budget so it cannot silently drift back.
  // 4362: soft-tail answer-cache skip call site (logic in rag-query-guard.ts).
  ["src/lib/rag/rag.ts", 4362],
  ["src/components/DocumentViewer.tsx", 1734],
  ["supabase/functions/indexing-v3-agent/index.ts", 2191],
  // Added 2026-10-06 with no prior cap. The search header and the extractive
  // answer builder are capped near their current size; split them, never grow them.
  ["src/components/clinical-dashboard/master-search-header.tsx", 2900],
  // 2026-10-16: split into four layered modules behind rag-extractive-answer.ts, which now only
  // re-exports. Each part is capped at its size on the split.
  ["src/lib/rag/rag-extractive-answer.ts", 72],
  ["src/lib/rag/rag-extractive-signals.ts", 1002],
  ["src/lib/rag/rag-answer-shape-checks.ts", 425],
  ["src/lib/rag/rag-extractive-builder.ts", 2345],
  ["src/lib/rag/rag-answer-quality-gate.ts", 1690],
  // globals.css keeps a little headroom because most UI changes still add CSS
  // here and dozens of contract tests read this file directly. Ratchet it down
  // as area stylesheets move out behind @import (see mode-band.css).
  ["src/app/globals.css", 6550],
]);

function sourceLineCount(file) {
  const source = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const lines = source.split("\n");
  return source.endsWith("\n") ? lines.length - 1 : lines.length;
}

const failures = [];
for (const [file, maximum] of budgets) {
  const actual = sourceLineCount(file);
  if (actual > maximum) failures.push(`${file}: ${actual} lines exceeds the ${maximum}-line no-growth budget`);
  else console.log(`[maintainability] ${file}: ${actual}/${maximum} lines`);
}

if (failures.length) {
  console.error("Maintainability hotspot budget exceeded. Extract a cohesive module instead of growing the monolith:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("Maintainability hotspot budgets passed.");
