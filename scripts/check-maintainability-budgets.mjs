#!/usr/bin/env node
import { readFileSync } from "node:fs";

const budgets = new Map([
  // Chrome ownership/reporting lives in use-dashboard-chrome-coordinator; keep
  // the reclaimed monolith budget so it cannot silently drift back to 4160.
  // 3889: per-document actions moved to use-dashboard-document-actions.ts.
  ["src/components/ClinicalDashboard.tsx", 3889],
  // Evidence coverage, per-request hydration, and second-stage ranking live in
  // focused rag modules; keep the reclaimed budget so it cannot silently drift back.
  // 4362: soft-tail answer-cache skip call site (logic in rag-query-guard.ts).
  ["src/lib/rag/rag.ts", 4362],
  ["src/components/DocumentViewer.tsx", 1734],
  ["supabase/functions/indexing-v3-agent/index.ts", 2191],
  // Added 2026-10-06 with no prior cap. The search header and the extractive
  // answer builder are capped at their current size; split them, never grow them.
  ["src/components/clinical-dashboard/master-search-header.tsx", 3241],
  ["src/lib/rag/rag-extractive-answer.ts", 5269],
  // globals.css keeps a little headroom because most UI changes still add CSS
  // here and dozens of contract tests read this file directly. Ratchet it down
  // as area stylesheets move out behind @import (see mode-band.css).
  ["src/app/globals.css", 6700],
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
