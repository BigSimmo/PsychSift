/**
 * Administrator readmission keeps a document's flat ranking fields unchanged
 * until a successful reindex terminal applies them (migration
 * 20261106184724_defer_readmission_ranking_authority.sql). While the attempt
 * runs, the declared values sit in `metadata.pending_reindex_authority.values`.
 *
 * Supplier checks that compare flat metadata with the admitted authority must
 * compare against those pending values, exactly as the database authority
 * digest does. A malformed block, or one from another admission, returns null
 * so callers fail closed.
 */
export const PENDING_REINDEX_AUTHORITY_KEYS = [
  "source_role",
  "licence_policy",
  "rights_evidence_ref",
  "publisher",
  "jurisdiction",
  "publication_date",
  "effective_date",
  "review_date",
  "expiry_date",
  "document_status",
  "supersedes_document_id",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function effectiveReindexAuthorityMetadata(
  metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  if (!Object.hasOwn(metadata, "pending_reindex_authority")) return metadata;
  const pending = metadata.pending_reindex_authority;
  if (
    !hasExactKeys(pending, ["version", "admissionEventId", "values", "prior"]) ||
    pending.version !== "pending-reindex-authority-v1" ||
    typeof pending.admissionEventId !== "string" ||
    pending.admissionEventId !== metadata.admission_event_id ||
    !hasExactKeys(pending.values, PENDING_REINDEX_AUTHORITY_KEYS) ||
    !hasExactKeys(pending.prior, PENDING_REINDEX_AUTHORITY_KEYS)
  )
    return null;
  return { ...metadata, ...pending.values };
}
