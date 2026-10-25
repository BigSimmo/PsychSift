import { normalizeSourceMetadata } from "@/lib/source-metadata";

/**
 * Which searchable documents are missing the facts that say whether they should answer at all
 * (audit 2026-10-24 E2E-10).
 *
 * In the default search mode a passage is fetched when its document is the owner's, indexed and
 * on its current version. Licence, publication date and review are checked when a file is
 * admitted, not when its passages are fetched, so a document whose licence no longer permits
 * indexing still answers until someone marks it outdated. This report lists those documents so
 * an operator can act. It reads rows only, so it runs offline against an export.
 */

export type SourceProvenanceRow = {
  id: string;
  title: string | null;
  status?: string | null;
  metadata: unknown;
};

export type SourceProvenanceGap =
  /** The licence forbids indexing its text, yet the document is still searchable. */
  "licence_forbids_indexing" | "no_licence_basis" | "no_publication_date" | "not_reviewed";

export type SourceProvenanceGapReport = {
  /** Indexed documents not marked outdated: the ones that can answer. */
  searchable: number;
  counts: Record<SourceProvenanceGap, number>;
  documents: Array<{ id: string; title: string | null; gaps: SourceProvenanceGap[] }>;
};

const FORBIDDING_LICENCES = new Set(["index_forbidden", "metadata_link_only"]);

export function sourceProvenanceGaps(row: SourceProvenanceRow): SourceProvenanceGap[] {
  const source = normalizeSourceMetadata(row.metadata);
  const gaps: SourceProvenanceGap[] = [];
  if (source.licence_policy && FORBIDDING_LICENCES.has(source.licence_policy)) gaps.push("licence_forbids_indexing");
  if (!source.licence_policy) gaps.push("no_licence_basis");
  if (!source.publication_date) gaps.push("no_publication_date");
  if (source.clinical_validation_status !== "locally_reviewed" && source.clinical_validation_status !== "approved") {
    gaps.push("not_reviewed");
  }
  return gaps;
}

export function buildSourceProvenanceGapReport(rows: SourceProvenanceRow[]): SourceProvenanceGapReport {
  const counts: Record<SourceProvenanceGap, number> = {
    licence_forbids_indexing: 0,
    no_licence_basis: 0,
    no_publication_date: 0,
    not_reviewed: 0,
  };
  const documents: SourceProvenanceGapReport["documents"] = [];
  let searchable = 0;
  for (const row of rows) {
    // A row without a status (an export that left the column out) is treated as searchable, so
    // a missing column can only widen the report, never hide a document.
    if (row.status != null && row.status !== "indexed") continue;
    if (normalizeSourceMetadata(row.metadata).document_status === "outdated") continue;
    searchable += 1;
    const gaps = sourceProvenanceGaps(row);
    if (gaps.length === 0) continue;
    for (const gap of gaps) counts[gap] += 1;
    documents.push({ id: row.id, title: row.title, gaps });
  }
  // The licence problem first: it is the one that should stop a document answering.
  documents.sort(
    (a, b) =>
      Number(b.gaps.includes("licence_forbids_indexing")) - Number(a.gaps.includes("licence_forbids_indexing")) ||
      b.gaps.length - a.gaps.length ||
      a.id.localeCompare(b.id),
  );
  return { searchable, counts, documents };
}
