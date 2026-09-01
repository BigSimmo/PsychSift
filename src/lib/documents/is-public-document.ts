import type { ClinicalSourceMetadata } from "@/lib/types";

/**
 * Common shape representing either a raw metadata record or a document row
 * containing metadata and/or owner_id.
 */
export type DocumentVisibilityTarget =
  | {
      owner_id?: string | null;
      metadata?: Record<string, unknown> | null;
      [key: string]: unknown;
    }
  | Record<string, unknown>
  | null
  | undefined;

function nestedOrSelfMetadata(record: Record<string, unknown>): Record<string, unknown> {
  return record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : record;
}

function recordedOwnerId(record: Record<string, unknown>, metadata: Record<string, unknown>): unknown {
  if ("owner_id" in record) return record.owner_id;
  if ("owner_id" in metadata) return metadata.owner_id;
  return undefined;
}

/**
 * Standardized predicate for whether a document belongs to the public corpus.
 *
 * Access decisions must match `withOwnerReadScope`: a document is public only when
 * `owner_id` is null *and* `metadata.public_corpus` is true. `documents.owner_id` is
 * `on delete set null`, so a null owner alone is an orphan, not a publication. Legacy
 * metadata aliases (`is_public`, `public`, `visibility`, `source_kind`) do not grant
 * public access. Missing either signal fails closed.
 *
 * @param input - A document row, metadata dictionary, or source metadata object.
 * @returns `true` if the document is public, `false` otherwise.
 */
export function isPublicDocument(input: DocumentVisibilityTarget | ClinicalSourceMetadata): boolean {
  if (!input || typeof input !== "object") {
    return false;
  }

  const record = input as Record<string, unknown>;
  const metadata = nestedOrSelfMetadata(record);

  if (
    metadata.private === true ||
    metadata.is_private === true ||
    metadata.visibility === "private" ||
    record.private === true ||
    record.is_private === true ||
    record.visibility === "private"
  ) {
    return false;
  }

  return recordedOwnerId(record, metadata) === null && metadata.public_corpus === true;
}

/**
 * Alias for `isPublicDocument` when operating explicitly on full document rows.
 */
export function isPublicDocumentRow(row: DocumentVisibilityTarget): boolean {
  return isPublicDocument(row);
}

/**
 * Row-level visibility filter for **public-scoped retrieval results only** (`#ZBAC9D`).
 *
 * The retrieval RPCs resolve the public sentinel to `row_owner_id is null` and check no
 * published marker, so a document orphaned by an auth-user deletion would read as public
 * corpus. The root fix is the `on delete restrict` owner foreign keys shipped in PR #2502;
 * this is the defence-in-depth layer behind it.
 *
 * Only call this on rows returned for a PUBLIC-SCOPED query (`owner_filter` is the public
 * sentinel). Every such row already has a null document owner because the RPC enforced it,
 * so the only missing signal is the published marker. Calling it on an owner-scoped result
 * would drop that owner's own private documents, which legitimately carry no marker.
 *
 * Judged only where the payload provably carries the DOCUMENT's metadata:
 *  - rows with an `owner_id` column (e.g. `match_documents_for_query`) go through
 *    `isPublicDocument` unchanged;
 *  - rows with `source_metadata`, which the chunk RPCs populate as `d.metadata`.
 *
 * Everything else is retained. Table-fact, embedding-field and index-unit rows carry their
 * OWN `metadata` (`f.metadata`, `u.metadata`), not the document's, so judging them on that
 * field would drop every artifact row from every public search. Those surfaces remain
 * unfiltered here and are gated only by the foreign key; closing them needs `d.metadata`
 * added to their RPC return, which is a schema change.
 *
 * @param row - One retrieval result row from a public-scoped query.
 * @returns `true` if the row may be shown, `false` if it is an unpublished orphan.
 */
export function publicScopedRetrievalRowIsVisible(row: unknown): boolean {
  if (!row || typeof row !== "object") return true;
  const record = row as Record<string, unknown>;

  // Document-shaped rows carry the owner, so the full predicate applies.
  if ("owner_id" in record) return isPublicDocument(record);

  // Chunk-shaped rows: `source_metadata` is `d.metadata`, the document's own.
  if (!("source_metadata" in record)) return true;
  const raw = record.source_metadata;
  const metadata = coerceSourceMetadata(raw);
  // An absent or unreadable payload is not evidence of publication, but neither is it
  // evidence of an orphan; the FK is the load-bearing guard, so retain rather than
  // silently shrink results on a shape this function does not understand.
  if (!metadata) return true;

  if (metadata.private === true || metadata.is_private === true || metadata.visibility === "private") {
    return false;
  }
  return metadata.public_corpus === true;
}

function coerceSourceMetadata(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
