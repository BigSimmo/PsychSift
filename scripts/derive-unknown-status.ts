import { loadEnvConfig } from "@next/env";
import type { Json } from "@/lib/supabase/database.types";
import {
  DEFAULT_REVIEW_CYCLE_YEARS,
  UNKNOWN_STATUS_DERIVATION_VERSION,
  deriveUnknownStatus,
  reviewCycleAppliesTo,
  unknownStatusDerivationBasis,
} from "@/lib/unknown-status-derivation";

loadEnvConfig(process.cwd());

/**
 * Status-derivation pass for documents left at `document_status = "unknown"`.
 *
 * Background: `scripts/backfill-source-metadata.ts` derives `document_status`
 * from an *explicit* review date found in the source text (or, for BMJ, a
 * recent `Last updated`). A residual set of documents carry a publisher and a
 * `publication_date` but no parseable review date, so they stay "unknown" and
 * trip the retrieval governance warning ("Review status unknown").
 *
 * This pass resolves ONLY the sub-set where a status can be defensibly inferred:
 * a document with a `publication_date` and no explicit review date is assigned a
 * review date of `publication_date + REVIEW_CYCLE_YEARS` (WA Health documents
 * carry a standard review cycle, default 3 years), then classified current /
 * review_due against that inferred date.
 *
 * Deliberately conservative:
 *  - Only touches documents whose recorded publisher is WA Health
 *    (`REVIEW_CYCLE_AUTHORITY_KEYS`); the cycle is not assumed for anyone else.
 *  - Only touches `document_status = "unknown"`; never overwrites a derived status.
 *    Each row is re-read just before its write and skipped if its status or
 *    publication date changed meanwhile; only the derived keys are merged onto
 *    the fresh metadata, so a concurrent worker update is not overwritten.
 *  - Only touches docs WITH a `publication_date`; date-less unknowns stay unknown
 *    (there is nothing to infer from).
 *  - Skips future/implausible publication dates (likely mis-extractions) so a bad
 *    date can't fabricate a "current" status.
 *  - The inferred review date is flagged (`review_date_inferred: true`) and the
 *    basis recorded, so every change is auditable and reversible by querying the
 *    version stamp.
 *
 * This encodes a policy assumption (the standard review cycle). Runs in dry-run
 * by default; review the reported split, then pass `--apply` to write.
 */

type DocumentRow = {
  id: string;
  title: string;
  file_name: string;
  metadata: Record<string, unknown> | null;
};

const APPLY = process.argv.includes("--apply");

function reviewCycleYears() {
  const raw = process.env.REVIEW_CYCLE_YEARS;
  if (!raw) return DEFAULT_REVIEW_CYCLE_YEARS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error(`Invalid REVIEW_CYCLE_YEARS: ${raw} (expected integer 1-10)`);
  }
  return value;
}

const REVIEW_CYCLE_YEARS = reviewCycleYears();
const NOW = new Date();

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

async function loadUnknownDocuments() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createAdminClient();
  const documents: DocumentRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("documents")
      .select("id,title,file_name,metadata")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as DocumentRow[];
    for (const row of rows) {
      const status = metadataRecord(row.metadata).document_status;
      if ((status ?? "unknown") === "unknown") documents.push(row);
    }
    if (rows.length < pageSize) break;
  }
  return documents;
}

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createAdminClient();
  const documents = await loadUnknownDocuments();

  const derived: Array<{
    document: DocumentRow;
    publicationDate: unknown;
    updates: Record<string, unknown>;
    reviewDate: string;
    status: string;
  }> = [];
  const skipCounts: Record<string, number> = {};

  for (const document of documents) {
    const metadata = metadataRecord(document.metadata);
    if (!reviewCycleAppliesTo(metadata)) {
      skipCounts.publisher_without_review_cycle = (skipCounts.publisher_without_review_cycle ?? 0) + 1;
      continue;
    }
    const result = deriveUnknownStatus(metadata.publication_date, { reviewCycleYears: REVIEW_CYCLE_YEARS, now: NOW });
    if (result.kind === "skip") {
      skipCounts[result.reason] = (skipCounts[result.reason] ?? 0) + 1;
      continue;
    }
    const updates: Record<string, unknown> = {
      document_status: result.status,
      review_date: result.reviewDate,
      review_date_inferred: true,
      unknown_status_derivation_version: UNKNOWN_STATUS_DERIVATION_VERSION,
      unknown_status_derivation_basis: unknownStatusDerivationBasis(REVIEW_CYCLE_YEARS),
      unknown_status_derived_at: new Date().toISOString(),
    };
    derived.push({
      document,
      publicationDate: metadata.publication_date,
      updates,
      reviewDate: result.reviewDate,
      status: result.status,
    });
  }

  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    review_cycle_years: REVIEW_CYCLE_YEARS,
    unknown_documents_seen: documents.length,
    documents_derived: derived.length,
    derived_status_counts: derived.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {}),
    left_unknown: skipCounts,
    sample: derived.slice(0, 15).map((item) => ({
      title: item.document.title,
      file_name: item.document.file_name,
      inferred_review_date: item.reviewDate,
      document_status: item.status,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!APPLY) return;

  let written = 0;
  let changedSinceRead = 0;
  for (const item of derived) {
    // Re-read so a worker or backfill that touched this row since the scan is not
    // overwritten with the start-up copy, and only the derived keys are merged in.
    const { data: fresh, error: readError } = await supabase
      .from("documents")
      .select("metadata")
      .eq("id", item.document.id)
      .single();
    if (readError) throw new Error(`Failed to re-read ${item.document.file_name}: ${readError.message}`);
    const current = metadataRecord(fresh?.metadata);
    if ((current.document_status ?? "unknown") !== "unknown" || current.publication_date !== item.publicationDate) {
      changedSinceRead += 1;
      continue;
    }
    const { error } = await supabase
      .from("documents")
      .update({ metadata: { ...current, ...item.updates } as Json })
      .eq("id", item.document.id);
    if (error) throw new Error(`Failed to update ${item.document.file_name}: ${error.message}`);
    written += 1;
  }
  console.log(
    `Derived document_status for ${written} previously-unknown documents` +
      (changedSinceRead ? `; skipped ${changedSinceRead} that changed since the scan.` : "."),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
