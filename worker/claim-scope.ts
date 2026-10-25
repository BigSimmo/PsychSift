// Claim allowlist parsing, kept free of heavy imports so the health endpoint can report the
// worker's scope without bundling the extractors (worker/behavior.ts re-exports it).

export type WorkerClaimScopeFilter = {
  allowedDocumentIds: ReadonlySet<string>;
  allowedFileTypes: ReadonlySet<string>;
  active: boolean;
  /** A malformed allowlist (no valid entries, or a non-UUID document ID): claim nothing rather than everything. */
  claimsNothing: boolean;
  /** Why the configured scope was rejected, for one operator-facing warning. */
  configurationError: string | null;
};

const claimDocumentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normalizeClaimDocumentId(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeClaimMimeType(value?: string | null): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

export function resolveWorkerClaimScopeFilter(
  environment: Record<string, string | undefined> = process.env,
): WorkerClaimScopeFilter {
  const parseList = (raw: string | undefined, normalize: (item: string) => string) =>
    new Set(
      (raw ?? "")
        .split(",")
        .map((item) => normalize(item))
        .filter(Boolean),
    );
  const allowedDocumentIds = parseList(environment.WORKER_ALLOWED_DOCUMENT_IDS, normalizeClaimDocumentId);
  const allowedFileTypes = parseList(environment.WORKER_ALLOWED_FILE_TYPES, normalizeClaimMimeType);
  // Blank means unset (the .env.example default). A configured list that parses to no
  // entries is malformed; dropping it would silently widen the scope to every job.
  const malformed = (raw: string | undefined, parsed: ReadonlySet<string>) =>
    (raw ?? "").trim() !== "" && parsed.size === 0;
  // claim_ingestion_jobs takes uuid[]; one bad ID would fail every claim request, so
  // reject the whole document scope instead of sending it or silently dropping the entry.
  const invalidDocumentIds = [...allowedDocumentIds].filter((id) => !claimDocumentIdPattern.test(id));
  const configurationError =
    invalidDocumentIds.length > 0
      ? `WORKER_ALLOWED_DOCUMENT_IDS contains non-UUID value(s): ${invalidDocumentIds.slice(0, 3).join(", ")}`
      : malformed(environment.WORKER_ALLOWED_DOCUMENT_IDS, allowedDocumentIds)
        ? "WORKER_ALLOWED_DOCUMENT_IDS is set but lists no document IDs"
        : malformed(environment.WORKER_ALLOWED_FILE_TYPES, allowedFileTypes)
          ? "WORKER_ALLOWED_FILE_TYPES is set but lists no MIME types"
          : null;
  const claimsNothing = configurationError !== null;
  return {
    allowedDocumentIds,
    allowedFileTypes,
    active: claimsNothing || allowedDocumentIds.size > 0 || allowedFileTypes.size > 0,
    claimsNothing,
    configurationError,
  };
}
