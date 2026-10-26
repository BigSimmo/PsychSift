/**
 * Offline report: indexed documents missing a licence basis, publication date or review, and any
 * whose licence no longer permits indexing (audit 2026-10-24 E2E-10). Reads an export only.
 *
 *   npm run provenance:gaps -- --input documents-export.json
 *   npm run provenance:gaps -- --input documents-export.json --list
 *
 * The export is a JSON array of `documents` rows with `id`, `title`, `status` and `metadata`, for
 * example the result of `select id, title, status, metadata from documents` saved as JSON. It never
 * reads or writes the database itself. A document listed under "licence forbids indexing" should
 * be marked outdated, which removes it from answers.
 */
import { readFileSync } from "node:fs";

import { buildSourceProvenanceGapReport, type SourceProvenanceRow } from "@/lib/source-provenance-gaps";

function main() {
  const inputIndex = process.argv.indexOf("--input");
  const input = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  if (!input || input.startsWith("--")) {
    throw new Error("Pass --input <documents export JSON>. This report never reads the live database.");
  }
  const parsed: unknown = JSON.parse(readFileSync(input, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("The export must be a JSON array of documents rows.");
  const rows = parsed.filter(
    (row): row is SourceProvenanceRow =>
      Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string",
  );

  const report = buildSourceProvenanceGapReport(rows);
  console.log("=== Source provenance gaps (offline) ===");
  console.log(`Rows read: ${rows.length}; searchable (indexed, not outdated): ${report.searchable}`);
  console.log(`Licence forbids indexing: ${report.counts.licence_forbids_indexing}`);
  console.log(`No licence basis: ${report.counts.no_licence_basis}`);
  console.log(`No publication date: ${report.counts.no_publication_date}`);
  console.log(`Not reviewed: ${report.counts.not_reviewed}`);
  const list = process.argv.includes("--list")
    ? report.documents
    : report.documents.filter((document) => document.gaps.includes("licence_forbids_indexing"));
  if (list.length > 0) {
    console.log("\nDocuments:");
    for (const document of list) {
      console.log(`  ${document.id}  ${document.title ?? "(untitled)"}  [${document.gaps.join(", ")}]`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
