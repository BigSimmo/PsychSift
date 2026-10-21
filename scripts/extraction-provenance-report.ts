/**
 * Read-only report: which reader, OCR engine and chunker produced each document's committed
 * index generation (audit F04, #2F8K1V). Use it to list the documents a parser defect touched,
 * then pass those ids to a reviewed re-extraction or `npm run reindex:rollback`.
 *
 *   npm run extraction:provenance
 *   npm run extraction:provenance -- --extractor-version 2026-10-21.merged-cell-provenance-v11 --list
 *   npm run extraction:provenance -- --chunker-version 1.3.1-page --list
 *   npm run extraction:provenance -- --ocr-engine-version 5.3.4 --list
 *
 * Selects only; it never writes, queues a job, chunks or re-indexes. It still reads the live
 * database, so it needs the owner's confirmation before it is run against production.
 * Documents indexed before the record existed report "not recorded"; list them with
 * `--extractor-version "not recorded" --list`.
 */
import { loadEnvConfig } from "@next/env";
import {
  buildProvenanceReport,
  parseProvenanceArgs,
  type ProvenanceDocumentRow,
} from "@/lib/extraction-provenance-report";
import { assertSupabaseHealthy, probeSupabaseHealth } from "@/lib/supabase/health";

loadEnvConfig(process.cwd());

const PAGE = 1000;

async function main() {
  const args = parseProvenanceArgs(process.argv.slice(2));
  const [{ env, requireServerEnv }, { createAdminClient }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/supabase/admin"),
  ]);
  requireServerEnv();
  const supabase = createAdminClient();

  console.log("=== Extraction provenance report (read-only) ===");
  console.log(`Supabase project: ${env.SUPABASE_PROJECT_NAME ?? "unknown"} (${env.SUPABASE_PROJECT_REF ?? "unknown"})`);
  assertSupabaseHealthy(await probeSupabaseHealth(supabase), "Extraction provenance report");

  const rows: ProvenanceDocumentRow[] = [];
  // Keyset paging, so documents added or removed during the scan cannot shift a page.
  for (let lastId: string | null = null; ;) {
    let query = supabase.from("documents").select("id,title,metadata").order("id").limit(PAGE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ProvenanceDocumentRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
    lastId = page[page.length - 1].id;
  }

  const report = buildProvenanceReport(rows, args);
  console.log(`Documents scanned: ${report.scanned}; matching filter: ${report.matched.length}`);
  for (const [label, counts] of [
    ["Extractor version", report.byExtractorVersion],
    ["Chunker version", report.byChunkerVersion],
    ["OCR engine version", report.byOcrEngineVersion],
  ] as const) {
    console.log(`\n${label}:`);
    const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) console.log("  (none)");
    for (const [version, count] of entries) console.log(`  ${version}: ${count}`);
  }
  if (args.listDocuments) {
    console.log("\nDocuments:");
    for (const document of report.matched) console.log(`  ${document.id}  ${document.title ?? "(untitled)"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
