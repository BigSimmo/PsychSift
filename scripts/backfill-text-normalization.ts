/**
 * In-place text-normalization backfill (no re-index, no re-embed).
 *
 * Applies the shared, lossless `normalizeExtractedGlyphs` transform to the stored
 * `document_chunks.content` (and `section_heading`) of already-indexed documents.
 * `retrieval_synopsis` additionally gets `polishStoredSynopsis` (protective-marking
 * banner removal + truncated-tail repair) — the synopsis is a derived display/
 * retrieval summary, never quoted verbatim, so the stronger polish is safe there
 * and only there. Only rows whose text actually changes are updated. Embeddings
 * are NEVER recomputed, so vector/semantic retrieval is unchanged by
 * construction; the generated `search_tsv` column refreshes automatically and
 * can only improve.
 *
 * Safety:
 *   - Confirms the Supabase project before writing.
 *   - Dry-run by default; requires BOTH --write and --confirm to mutate.
 *   - Writes a JSON backup of every changed row (id, old content/heading) before
 *     updating, so the change is fully revertible.
 *
 * Usage:
 *   npm run backfill:text-normalization                       # dry-run, all indexed docs
 *   npm run backfill:text-normalization -- --limit 50         # dry-run sample
 *   npm run backfill:text-normalization -- --document-id <id> # single document
 *   npm run backfill:text-normalization -- --write --confirm  # apply (with backup)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type Args = {
  limit: number;
  documentId?: string;
  write: boolean;
  confirm: boolean;
};

// The backup is deliberately NOT optional: every write run must leave a
// revertible artifact, so there is no --no-backup escape hatch.
function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 0, write: false, confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write") {
      args.write = true;
      continue;
    }
    if (token === "--confirm") {
      args.confirm = true;
      continue;
    }
    if (token !== "--limit" && token !== "--document-id") {
      throw new Error(`Unknown flag: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
    index += 1;
    if (token === "--limit") {
      const parsed = Number.parseInt(value, 10);
      // Validate at parse time: NaN and 0 are falsy, so a later truthiness
      // check would silently treat "--limit foo" / "--limit 0" as unlimited.
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--limit must be a positive integer (got "${value}").`);
      }
      args.limit = parsed;
    }
    if (token === "--document-id") args.documentId = value;
  }
  return args;
}

type ChunkRow = {
  id: string;
  document_id: string;
  content: string | null;
  section_heading: string | null;
  retrieval_synopsis: string | null;
};

type ChangedRow = {
  id: string;
  document_id: string;
  content_changed: boolean;
  heading_changed: boolean;
  synopsis_changed: boolean;
  old_content: string | null;
  new_content: string | null;
  old_section_heading: string | null;
  new_section_heading: string | null;
  old_retrieval_synopsis: string | null;
  new_retrieval_synopsis: string | null;
};

type SelectResult = Promise<{ data: ChunkRow[] | null; error: { message: string } | null }> & {
  eq: (column: string, value: unknown) => SelectResult;
  order: (column: string, opts: { ascending: boolean }) => SelectResult;
  range: (from: number, to: number) => SelectResult;
};

type QueryError = { message: string } | null;

/** The three cache-invalidation reads and writes run after an applied backfill. */
type CacheInvalidationClient = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => Promise<{ data: Array<{ document_id: string; revision: number | string }> | null; error: QueryError }>;
    };
    upsert: (rows: Array<{ document_id: string; revision: number }>) => Promise<{ error: QueryError }>;
    delete: () => { in: (column: string, values: string[]) => Promise<{ error: QueryError }> };
  };
};

type AdminClient = {
  from: (table: string) => {
    select: (columns: string) => SelectResult;
    update: (patch: Record<string, string | null>) => {
      eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

const PAGE_SIZE = 1000;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [
    { requireServerEnv },
    { createAdminClient },
    { normalizeExtractedGlyphs, polishStoredSynopsis },
    projectModule,
  ] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/supabase/admin"),
    import("@/lib/source-text-sanitizer"),
    import("@/lib/supabase/project"),
  ]);
  requireServerEnv();

  const { checkSupabaseProjectConfig, expectedSupabaseProject, formatSupabaseProjectCheck } = projectModule;
  const projectCheck = checkSupabaseProjectConfig(
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
      SUPABASE_PROJECT_NAME: process.env.SUPABASE_PROJECT_NAME,
    },
    { requireMetadata: false },
  );
  if (projectCheck.status === "missing" || projectCheck.status === "mismatch") {
    console.error(formatSupabaseProjectCheck(projectCheck));
    throw new Error(`Refusing to run: Supabase project is not ${expectedSupabaseProject.name}.`);
  }

  const supabase = createAdminClient() as unknown as AdminClient;

  const writeEnabled = args.write && args.confirm;
  if (args.write && !args.confirm) console.log("WRITE requested without --confirm; staying in dry-run mode.");
  console.log(
    `Text-normalization backfill ${writeEnabled ? "WRITE" : "DRY-RUN"} against ${expectedSupabaseProject.name} (${expectedSupabaseProject.ref})`,
  );

  // In dry-run mode only a counter and capped samples are kept; the full
  // changed-row list (old + new text for the mandatory backup) is materialized
  // only when writes are enabled, so a corpus-wide dry run stays flat in memory.
  const changed: ChangedRow[] = [];
  let changedCount = 0;
  const sampleDiffs: Array<{ id: string; before: string; after: string }> = [];
  let scanned = 0;
  let offset = 0;

  for (;;) {
    let query = supabase
      .from("document_chunks")
      .select("id,document_id,content,section_heading,retrieval_synopsis")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (args.documentId) query = query.eq("document_id", args.documentId);

    const { data, error } = (await query) as { data: ChunkRow[] | null; error: { message: string } | null };
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const newContent = row.content == null ? row.content : normalizeExtractedGlyphs(row.content);
      const newHeading =
        row.section_heading == null ? row.section_heading : normalizeExtractedGlyphs(row.section_heading);
      const newSynopsis =
        row.retrieval_synopsis == null ? row.retrieval_synopsis : polishStoredSynopsis(row.retrieval_synopsis);
      const contentChanged = newContent !== row.content;
      const headingChanged = newHeading !== row.section_heading;
      const synopsisChanged = newSynopsis !== row.retrieval_synopsis;
      if (!contentChanged && !headingChanged && !synopsisChanged) continue;

      changedCount += 1;
      if (writeEnabled && (!args.limit || changed.length < args.limit)) {
        changed.push({
          id: row.id,
          document_id: row.document_id,
          content_changed: contentChanged,
          heading_changed: headingChanged,
          synopsis_changed: synopsisChanged,
          old_content: row.content,
          new_content: newContent,
          old_section_heading: row.section_heading,
          new_section_heading: newHeading,
          old_retrieval_synopsis: row.retrieval_synopsis,
          new_retrieval_synopsis: newSynopsis,
        });
      }
      if ((contentChanged || synopsisChanged) && sampleDiffs.length < 8) {
        // Prefer showing the content diff; fall back to the synopsis diff for
        // synopsis-only rows so the dry run still demonstrates the change.
        sampleDiffs.push(
          contentChanged
            ? { id: row.id, before: (row.content ?? "").slice(0, 160), after: (newContent ?? "").slice(0, 160) }
            : {
                id: row.id,
                before: (row.retrieval_synopsis ?? "").slice(0, 160),
                after: (newSynopsis ?? "").slice(0, 160),
              },
        );
      }
    }

    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
    if (args.limit && changedCount >= args.limit) break;
  }

  // --limit bounds the number of rows we will WRITE, not just how far we page.
  const reportedCount = args.limit ? Math.min(changedCount, args.limit) : changedCount;

  console.log(
    `Scanned ${scanned} chunks; ${reportedCount} would change${args.limit ? ` (capped at --limit ${args.limit})` : ""}.`,
  );
  for (const diff of sampleDiffs) {
    console.log(`\n  chunk ${diff.id}`);
    console.log(`    before: ${JSON.stringify(diff.before)}`);
    console.log(`    after:  ${JSON.stringify(diff.after)}`);
  }

  if (changedCount === 0) {
    console.log("\nNothing to update.");
    return;
  }

  if (!writeEnabled) {
    console.log("\nDRY-RUN complete. Re-run with --write --confirm to apply (a JSON backup is written first).");
    return;
  }

  // Mandatory revertible backup before any write — there is no opt-out.
  const backupDir = resolve(process.cwd(), "output", "backfills");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(backupDir, `text-normalization-${stamp}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      changed.map((row) => ({
        id: row.id,
        document_id: row.document_id,
        old_content: row.old_content,
        old_section_heading: row.old_section_heading,
        old_retrieval_synopsis: row.old_retrieval_synopsis,
      })),
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nBackup of ${changed.length} rows written to ${backupPath}`);

  let updated = 0;
  for (const row of changed) {
    const patch: Record<string, string | null> = {};
    if (row.content_changed) patch.content = row.new_content;
    if (row.heading_changed) patch.section_heading = row.new_section_heading;
    if (row.synopsis_changed) patch.retrieval_synopsis = row.new_retrieval_synopsis;
    const { error } = (await supabase.from("document_chunks").update(patch).eq("id", row.id)) as {
      error: { message: string } | null;
    };
    if (error) throw new Error(`Update failed for chunk ${row.id}: ${error.message}`);
    updated += 1;
    if (updated % 250 === 0) console.log(`  updated ${updated}/${changed.length}`);
  }

  console.log(`\nDone. Updated ${updated} chunks in place (no embeddings changed).`);

  // Whole-codebase audit 2026-10-24: chunk edits do not touch the documents row, so cached
  // answers quoting the old text stayed valid. Bump each edited document's evidence revision
  // (part of every app copy's cache scope revision) and clear the shared answer and search cache.
  const cacheClient = supabase as unknown as CacheInvalidationClient;
  const documentIds = [...new Set(changed.map((row) => row.document_id))];
  for (let index = 0; index < documentIds.length; index += 200) {
    const batch = documentIds.slice(index, index + 200);
    const { data: revisions, error: readError } = await cacheClient
      .from("document_evidence_revisions")
      .select("document_id,revision")
      .in("document_id", batch);
    if (readError) throw new Error(`Reading evidence revisions failed: ${readError.message}`);
    const current = new Map((revisions ?? []).map((row) => [row.document_id, Number(row.revision) || 0]));
    const { error: bumpError } = await cacheClient
      .from("document_evidence_revisions")
      .upsert(batch.map((documentId) => ({ document_id: documentId, revision: (current.get(documentId) ?? 0) + 1 })));
    if (bumpError) throw new Error(`Bumping evidence revisions failed: ${bumpError.message}`);
  }
  const { error: cacheError } = await supabase
    .from("rag_response_cache")
    .delete()
    .in("cache_kind", ["search", "answer"]);
  if (cacheError) throw new Error(`Clearing the shared answer cache failed: ${cacheError.message}`);
  console.log(`Answer caches invalidated for ${documentIds.length} documents.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
