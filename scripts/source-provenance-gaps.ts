/**
 * Offline report: indexed documents missing a licence basis, publication date or review, and any
 * whose licence no longer permits indexing (audit 2026-10-24 E2E-10). Reads an export only.
 *
 *   npm run provenance:gaps -- --input documents-export.json
 *   npm run provenance:gaps -- --input documents-export.json --list
 *   npm run provenance:gaps -- --input documents-export.json --expected-count 3
 *
 * The export is a JSON array of `documents` rows with `id`, `title`, `status` and `metadata`, for
 * example the result of `select id, title, status, metadata from documents` saved as JSON. It never
 * reads or writes the database itself. A document listed under "licence forbids indexing" should
 * be marked outdated, which removes it from answers.
 */
import { readFileSync } from "node:fs";

import { buildSourceProvenanceGapReport, type SourceProvenanceRow } from "@/lib/source-provenance-gaps";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const documentStatuses = new Set(["queued", "processing", "indexed", "failed"]);

export function parseSourceProvenanceExport(value: unknown, expectedCount?: number): SourceProvenanceRow[] {
  if (!Array.isArray(value)) throw new Error("The export must be a JSON array of documents rows.");
  if (expectedCount !== undefined && value.length !== expectedCount) {
    throw new Error("Export row count does not match --expected-count; no provenance report was produced.");
  }
  const ids = new Set<string>();
  return value.map((value: unknown, index) => {
    const label = `Export row ${index + 1}`;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} must be a document object; no rows may be silently omitted.`);
    }
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim() || /\p{Cc}/u.test(row.id)) {
      throw new Error(`${label} must have a nonempty document id without control characters.`);
    }
    if (row.id !== row.id.trim()) throw new Error(`${label} document id must not have surrounding whitespace.`);
    if (ids.has(row.id)) throw new Error(`${label} duplicates a document id; counts would not be reliable.`);
    ids.add(row.id);
    if (row.title !== null && typeof row.title !== "string") {
      throw new Error(`${label} title must be a string or null.`);
    }
    if (typeof row.title === "string" && /\p{Cc}/u.test(row.title)) {
      throw new Error(`${label} title must not contain control characters.`);
    }
    if (row.status != null && (typeof row.status !== "string" || !documentStatuses.has(row.status))) {
      throw new Error(`${label} has an invalid document status; it cannot be silently excluded.`);
    }
    if (row.metadata !== null && (!row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata))) {
      throw new Error(`${label} metadata must be an object or null.`);
    }
    return { id: row.id, title: row.title, status: row.status as string | null | undefined, metadata: row.metadata };
  });
}

export function parseSourceProvenanceArgs(argv: string[]) {
  let input: string | undefined;
  let list = false;
  let expectedCount: number | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--input", "--list", "--expected-count"].includes(flag)) throw new Error("Unknown provenance report option.");
    if (seen.has(flag)) throw new Error(`${flag} may be supplied only once.`);
    seen.add(flag);
    if (flag === "--list") {
      list = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    if (flag === "--input") input = value;
    else {
      if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error("--expected-count must be a non-negative safe integer.");
      }
      expectedCount = Number(value);
    }
  }
  if (!input) {
    throw new Error("Pass --input <documents export JSON>. This report never reads the live database.");
  }
  return { input, list, expectedCount };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseSourceProvenanceArgs(argv);
  const raw = readFileSync(args.input, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The export must be valid JSON; no provenance report was produced.");
  }
  const rows = parseSourceProvenanceExport(parsed, args.expectedCount);
  const report = buildSourceProvenanceGapReport(rows);
  console.log("=== Source provenance gaps (offline) ===");
  console.log(`Rows read: ${rows.length}; searchable (indexed, not outdated): ${report.searchable}`);
  console.log(
    args.expectedCount === undefined
      ? "Export completeness unverified: no independently measured --expected-count supplied."
      : "Export row count matches --expected-count; source fidelity and clinical approval are not assessed.",
  );
  console.log(`Licence forbids indexing: ${report.counts.licence_forbids_indexing}`);
  console.log(`No licence basis: ${report.counts.no_licence_basis}`);
  console.log(`No publication date: ${report.counts.no_publication_date}`);
  console.log(`Not reviewed: ${report.counts.not_reviewed}`);
  const list = args.list
    ? report.documents
    : report.documents.filter((document) => document.gaps.includes("licence_forbids_indexing"));
  if (list.length > 0) {
    console.log("\nDocuments:");
    for (const document of list) {
      console.log(`  ${document.id}  ${document.title ?? "(untitled)"}  [${document.gaps.join(", ")}]`);
    }
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
