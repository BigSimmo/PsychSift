import { statusDotMuted, statusDotReady, statusDotReview, type StatusDotTone } from "@/components/ui-primitives";
import { sourceResultHref } from "@/components/clinical-dashboard/source-actions";
import { normalizeSourceMetadata, sourceStatusLabel } from "@/lib/source-metadata";
import { type CanonicalAnswerTableRecord, type SourceLink } from "@/lib/answer-render-policy";
import type { VisualEvidenceCard } from "@/lib/types";
import type {
  ClientBestSourceRecommendation as BestSourceRecommendation,
  ClientSearchResult as SearchResult,
} from "@/lib/answer-client-payload";

/**
 * One cited document as the answer surface shows it: the shape the source rail
 * lists and the source drawer pages through.
 *
 * This module is a leaf on purpose. The rail, the drawer, and `answer-content`
 * all need these helpers, and `answer-content` re-exports the public ones, so
 * keeping the derivations here is what stops those three from importing each
 * other in a cycle.
 */
export type AnswerSourceRow = {
  id: string;
  documentId: string;
  title: string;
  fileName?: string;
  pageNumber: number | null;
  metadata: ReturnType<typeof normalizeSourceMetadata>;
  sourceMetadata?: SearchResult["source_metadata"];
  score: number;
  href: string;
  snippet?: string;
  sourceStrength?:
    SourceLink["sourceStrength"] | BestSourceRecommendation["source_strength"] | SearchResult["source_strength"];
  /**
   * Whether the drawer will show a table or an image for this source. Set by
   * {@link annotateSourceAttachments} from the same matching rule the drawer
   * pages with, so the marker on a card can never advertise an attachment the
   * drawer then does not show.
   */
  hasTable?: boolean;
  hasImage?: boolean;
  /**
   * False for a row that only made the retrieved set — the "also found" group on
   * the rail. Cited rows come from the answer's own primary sources and are the
   * only ones an in-prose mark can point at.
   */
  cited?: boolean;
};

/** Back-compat alias for the capsule-era name. */
export type CapsulePreviewSource = AnswerSourceRow;

/**
 * The one "Sources" summary shown when the rail is collapsed.
 *
 * With the compact-citations preference on, the chip drops its text label to
 * icon + count; the "No direct source found" warning always stays worded —
 * compact mode must never hide a missing-source signal.
 */
export function sourceCapsuleDisplay({ sourceCount, compact = false }: { sourceCount: number; compact?: boolean }): {
  label: string;
  showLabelText: boolean;
  showCountBadge: boolean;
} {
  if (sourceCount <= 0) return { label: "No direct source found", showLabelText: true, showCountBadge: false };
  return { label: "Sources", showLabelText: !compact, showCountBadge: true };
}

export function sourceStatusDotTone(
  metadata: ReturnType<typeof normalizeSourceMetadata> | null | undefined,
): StatusDotTone {
  if (!metadata) return "muted";
  if (metadata.document_status === "current") return "ready";
  if (metadata.document_status === "review_due" || metadata.document_status === "outdated") return "review";
  return "muted";
}

export function sourceStatusDotClass(metadata: ReturnType<typeof normalizeSourceMetadata> | null | undefined) {
  const tone = sourceStatusDotTone(metadata);
  if (tone === "ready") return statusDotReady;
  if (tone === "review") return statusDotReview;
  return statusDotMuted;
}

export function sourceStatusShortLabel(metadata: ReturnType<typeof normalizeSourceMetadata>) {
  if (metadata.document_status === "review_due") return "Review due";
  if (metadata.document_status === "outdated") return "Outdated";
  if (metadata.document_status === "current") return "Current";
  // "Review status unknown" is 21 characters on a card whose whole title is
  // truncated at about 156px, so the one line that has to carry page AND status became
  // mostly status. Same statement, short enough to sit beside the page number.
  // Registry summaries keep their own wording.
  if (
    metadata.source_kind !== "registry_record" &&
    (!metadata.document_status || metadata.document_status === "unknown")
  )
    return "Status unknown";
  return sourceStatusLabel(metadata);
}

/** Decision 1 (2026-08-24): staleness is carried by the row and the drawer, never by the reference mark. */
export function sourceRowIsStale(source: AnswerSourceRow) {
  return source.metadata.document_status === "review_due" || source.metadata.document_status === "outdated";
}

/**
 * The visible digit. One numbering system across the in-prose mark, the rail
 * card, the drawer's title pill and its pager — a mark reading "2" beside a card
 * reading "S2" is two systems the reader has to reconcile.
 */
export function sourceBadgeLabel(index: number) {
  return String(index + 1);
}

/**
 * The spoken form. `aria-label` replaces a control's own text, so a bare "2"
 * would announce as a number with no noun; every accessible name built from a
 * source number starts here.
 */
export function sourceSpokenLabel(index: number) {
  return `Source ${index + 1}`;
}

/**
 * What a surface prints where a source number would go.
 *
 * A retrieved-but-uncited row takes an em-dash instead of a digit. The numbers
 * are the same numbers the in-prose marks use, and `answer-content` masks
 * uncited rows out of the markable ids, so a digit here would name a source no
 * mark can reach — a reference the reader can look for and never find.
 *
 * This lives beside {@link sourceBadgeLabel} rather than in any one component
 * because three surfaces print it — the rail card, the drawer's title pill and
 * the drawer's pager — and the rail alone having the rule is how the drawer came
 * to number an "Also found" row that the card beside it dashed.
 *
 * Not a SPEC.md §11 MissingValue site, deliberately: every consumer renders
 * this in an `aria-hidden` numeral badge sized for one digit, not a text
 * field, and its own accessible name is {@link sourceSpokenName} below
 * ("Also found", never "Source 4" or a dash) — the exact failure §11 exists
 * to prevent is already closed by a different, badge-appropriate mechanism.
 * Swapping the dash for one of the four §11 phrases would overflow the
 * badge for no accessibility gain.
 */
export function sourceBadgeDisplay(source: AnswerSourceRow, index: number) {
  return source.cited === false ? "—" : sourceBadgeLabel(index);
}

/** The spoken counterpart, so an uncited row is never announced as "Source 4". */
export function sourceSpokenName(source: AnswerSourceRow, index: number) {
  return source.cited === false ? "Also found" : sourceSpokenLabel(index);
}

/**
 * The same name for a pager step, which has to name a thing to move to rather
 * than label a card already on screen — so an uncited row reads "also found
 * source" where the rail card reads "Also found".
 */
export function sourceStepSpokenLabel(source: AnswerSourceRow, index: number) {
  return source.cited === false ? "Also found source" : sourceSpokenLabel(index);
}

export function sourceBadgeToneClass(metadata: ReturnType<typeof normalizeSourceMetadata>, index: number) {
  if (metadata.document_status === "review_due" || metadata.document_status === "outdated") {
    return "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]";
  }
  if (index === 0) {
    return "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]";
  }
  return "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";
}

/**
 * How strongly this document backs the answer, read from the row's own strength
 * and nothing else.
 *
 * It previously also returned "Direct" for `index === 0`. That branch was
 * unreachable — every other strength is handled above it — but it read as though
 * the first row were promoted to direct support by position, which is exactly
 * the claim this surface must never make. Removed with the index parameter.
 */
export function sourceSupportLabel(source: AnswerSourceRow) {
  if (!source.sourceStrength || source.sourceStrength === "none") return "Unsupported";
  if (source.sourceStrength === "strong") return "Direct";
  return "Partial";
}

/**
 * The drawer's support clause, or `null` when there is no claim to speak about.
 *
 * `index === null` means the drawer was opened from the source list rather than
 * from a claim. That case used to print "Opened from the source list, so this is
 * the document, not a claim." — a sentence whose whole content is the absence of
 * a claim, sitting where the passage should be. Returning `null` says the same
 * thing by saying nothing: the drawer asserts support only when a claim is what
 * opened it, and otherwise goes straight to the passage. Nothing is lost from
 * the safety side, because the removed wording made no support claim either.
 *
 * When a claim opened the drawer, `claimSupport` is that claim's recorded
 * status — not the row's document-level `sourceStrength`. Those fields are
 * independent: a partial mark can sit on a strong row, and the sentence must
 * match the mark the clinician just tapped.
 */
export function sourceSupportSentence(
  source: AnswerSourceRow | null,
  index: number | null,
  claimSupport?: "direct" | "partial" | "unsupported" | null,
): string | null {
  if (!source || index === null) return null;
  const support =
    claimSupport === "direct"
      ? "Direct"
      : claimSupport === "partial"
        ? "Partial"
        : claimSupport === "unsupported"
          ? "Unsupported"
          : sourceSupportLabel(source);
  if (support === "Direct") return "This page states the claim directly.";
  if (support === "Partial")
    return "This page supports part of the claim. Read the passage before relying on the rest.";
  return "Related to the question — this page does not state the claim.";
}

/** Exact final citations that the canonical adaptive projection renders. */
export function citedSourceIdsForAnswerProjection(projection: {
  leadCitationSources: Array<Pick<SearchResult, "id">>;
  sections: Array<{ citationSources: Array<Pick<SearchResult, "id">> }>;
}) {
  return new Set([
    ...projection.leadCitationSources.map((source) => source.id),
    ...projection.sections.flatMap((section) => section.citationSources.map((source) => source.id)),
  ]);
}

/**
 * Builds the rail's ordered, de-duplicated source list from the three shapes the
 * answer surface has on hand.
 *
 * The cap is six rather than the capsule's four: the rail is the whole cited
 * list now rather than a preview of it, and `trustCaps` admits six primary
 * sources at high trust. The drawer's pager is what absorbs the extra rows.
 */
export function buildAnswerSourceRows(
  bestSource: BestSourceRecommendation | null,
  sources: SearchResult[],
  sourceLinks: SourceLink[] = [],
  citedSourceIds?: ReadonlySet<string>,
): AnswerSourceRow[] {
  const rows: AnswerSourceRow[] = [];
  const seen = new Set<string>();
  const isCited = (id: string, legacyFallback: boolean) =>
    citedSourceIds === undefined ? legacyFallback : citedSourceIds.has(id);
  const pushRow = (row: AnswerSourceRow) => {
    const key = `${row.id}:${row.title}:${row.pageNumber ?? "n/a"}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  sourceLinks.slice(0, 6).forEach((source) => {
    pushRow({
      id: source.chunk_id,
      documentId: source.document_id,
      title: source.title || source.file_name || "Source",
      fileName: source.file_name,
      pageNumber: source.page_number,
      metadata: normalizeSourceMetadata(source.sourceMetadata),
      sourceMetadata: source.sourceMetadata,
      score: source.score ?? 0,
      href: source.href,
      snippet: source.snippet,
      sourceStrength: source.sourceStrength,
      cited: isCited(source.chunk_id, true),
    });
  });

  if (bestSource) {
    pushRow({
      id: bestSource.chunk_id,
      documentId: bestSource.document_id,
      title: bestSource.title || bestSource.file_name || "Source",
      fileName: bestSource.file_name,
      pageNumber: bestSource.page_number,
      metadata: normalizeSourceMetadata(bestSource.source_metadata),
      sourceMetadata: bestSource.source_metadata,
      score: bestSource.score,
      href: bestSource.viewer_href,
      sourceStrength: bestSource.source_strength,
      cited: isCited(bestSource.chunk_id, true),
    });
  }

  sources.slice(0, 6).forEach((source) => {
    pushRow({
      id: source.id,
      documentId: source.document_id,
      title: source.title || source.file_name || "Source",
      fileName: source.file_name,
      pageNumber: source.page_number,
      metadata: normalizeSourceMetadata(source.source_metadata),
      sourceMetadata: source.source_metadata,
      score: source.hybrid_score ?? source.similarity ?? source.lexical_score ?? 0,
      href: sourceResultHref(source),
      sourceStrength: source.source_strength,
      // Retrieved but not cited by the answer: the rail's "also found" group.
      cited: isCited(source.id, false),
    });
  });

  return rows.slice(0, 6);
}

/** DOM id for a rail row, so a Sheet can resolve its return-focus target late. */
export function answerSourceRailRowId(index: number) {
  return `answer-source-rail-row-${index}`;
}

/**
 * Attaches each table to the source it was cited from.
 *
 * A table whose `source.chunkId` matches no row still has to be reachable —
 * losing the wide-screen table column was an accepted cost, losing the tables
 * was not — so anything unmatched falls to the first source.
 */
export function tablesForSource(tables: CanonicalAnswerTableRecord[], sources: AnswerSourceRow[], index: number) {
  const chunkIds = new Set(sources.map((source) => source.id));
  const source = sources[index];
  if (!source) return [];
  return tables.filter((table) => {
    const chunkId = table.source?.chunkId;
    if (chunkId && chunkIds.has(chunkId)) return chunkId === source.id;
    return index === 0;
  });
}

/**
 * Attaches each image to the source it was cited from.
 *
 * Same rule as {@link tablesForSource}: a card whose `source_chunk_id` matches a
 * rail row stays on that row only. Anything unmatched falls to the first source
 * so it stays reachable after the table column was removed — never to every row
 * that happens to share a `documentId`.
 */
export function imagesForSource(visualEvidence: VisualEvidenceCard[], sources: AnswerSourceRow[], index: number) {
  const chunkIds = new Set(sources.map((source) => source.id));
  const source = sources[index];
  if (!source) return [];
  return visualEvidence.filter((card) => {
    const chunkId = card.source_chunk_id;
    if (chunkId && chunkIds.has(chunkId)) return chunkId === source.id;
    return index === 0;
  });
}

/**
 * Stamps each row with whether the drawer will have a table or an image to show
 * for it, so a rail card's attachment marker and the drawer's contents are one
 * decision made once rather than two rules that can drift apart.
 */
export function annotateSourceAttachments(
  rows: AnswerSourceRow[],
  {
    tables = [],
    visualEvidence = [],
  }: { tables?: CanonicalAnswerTableRecord[]; visualEvidence?: VisualEvidenceCard[] } = {},
): AnswerSourceRow[] {
  if (!tables.length && !visualEvidence.length) return rows;
  return rows.map((row, index) => ({
    ...row,
    hasTable: tablesForSource(tables, rows, index).length > 0,
    hasImage: imagesForSource(visualEvidence, rows, index).length > 0,
  }));
}
