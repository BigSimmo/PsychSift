export type ReindexQueueSnapshot = {
  openJobs: number;
  queuedDocuments: number;
  processingDocuments: number;
  failedDocuments: number;
};

export type AbandonedReindexGenerationCounts = {
  document_chunks?: number;
  document_images?: number;
  document_table_facts?: number;
  document_embedding_fields?: number;
  document_index_units?: number;
  document_memory_cards?: number;
  document_sections?: number;
};

export type DocumentGenerationPromotionIdentity = Readonly<{
  kind: "document_generation";
  documentId: string;
  generationId: string;
  generationDigest: string;
  previousGenerationId: string;
  previousGenerationDigest: string;
}>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const documentGenerationPromotionIdentityKeys = [
  "documentId",
  "generationDigest",
  "generationId",
  "kind",
  "previousGenerationDigest",
  "previousGenerationId",
];

function requiredBoundedIdentity(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 200 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty bounded identity.`);
  }
  return value;
}

export function assertDocumentGenerationPromotionIdentity(value: unknown): DocumentGenerationPromotionIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Document generation promotion identity must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\n") !== documentGenerationPromotionIdentityKeys.join("\n")) {
    throw new Error("Document generation promotion identity has missing or unsupported fields.");
  }
  if (record.kind !== "document_generation") {
    throw new Error("Document generation promotion identity kind is invalid.");
  }
  requiredBoundedIdentity(record.documentId, "documentId");
  const generationId = requiredBoundedIdentity(record.generationId, "generationId");
  const previousGenerationId = requiredBoundedIdentity(record.previousGenerationId, "previousGenerationId");
  if (generationId === previousGenerationId) {
    throw new Error("Current and previous generation identities must be distinct.");
  }
  if (typeof record.generationDigest !== "string" || !SHA256_PATTERN.test(record.generationDigest)) {
    throw new Error("generationDigest must be a lowercase SHA-256 digest.");
  }
  if (typeof record.previousGenerationDigest !== "string" || !SHA256_PATTERN.test(record.previousGenerationDigest)) {
    throw new Error("previousGenerationDigest must be a lowercase SHA-256 digest.");
  }
  return value as DocumentGenerationPromotionIdentity;
}

export function isReindexQueueClear(snapshot: ReindexQueueSnapshot) {
  return (
    snapshot.openJobs === 0 &&
    snapshot.queuedDocuments === 0 &&
    snapshot.processingDocuments === 0 &&
    snapshot.failedDocuments === 0
  );
}

export function hasIncompleteDocumentsWithoutOpenJobs(snapshot: ReindexQueueSnapshot) {
  return (
    snapshot.openJobs === 0 &&
    snapshot.queuedDocuments === 0 &&
    (snapshot.processingDocuments > 0 || snapshot.failedDocuments > 0)
  );
}

export function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

export function committedIndexGeneration(metadata: unknown) {
  const generation = metadataRecord(metadata).index_generation_id;
  return typeof generation === "string" && generation.trim() ? generation.trim() : null;
}

export function isAtomicReindexCandidate(document: { status?: string | null; metadata?: unknown }) {
  return document.status === "indexed";
}

/**
 * Mirror of the SQL predicate `public.is_committed_document_generation`:
 *
 *   select row_generation is null or row_generation = document_generation;
 *
 * Audit L11: the second arm used to fail OPEN in TypeScript — a document whose
 * `metadata.index_generation_id` was absent accepted rows from ANY generation,
 * while the SQL comparison against a NULL document generation yields NULL and
 * excludes them. During the first atomic reindex of a legacy (never-stamped)
 * indexed document, that let the document viewer interleave staged,
 * uncommitted chunks/pages/images/table facts with the live ones — duplicate or
 * half-built evidence on screen that `search_document_chunks` would never
 * return. A row that carries a generation is committed only when the document
 * names that same generation.
 */
export function isCommittedGenerationMetadata(args: { rowMetadata?: unknown; committedGeneration?: string | null }) {
  const rowGeneration = committedIndexGeneration(args.rowMetadata);
  if (!rowGeneration) return true;
  if (!args.committedGeneration) return false;
  return rowGeneration === args.committedGeneration;
}

/**
 * Which stored page rows a reader should see. Mirrors the SQL predicate
 * `public.is_visible_document_page` (behind the `document_current_pages` view) without needing the
 * document's `page_storage_mode`, which readers here do not select:
 *
 *   (mode = 'legacy_unqualified' and page_generation is null)
 *   or (mode = 'typed_exact' and page_generation = document_generation)
 *
 * Page rows are stamped only by the typed commit, which also switches the document to
 * 'typed_exact' and writes the generation into `documents.metadata.index_generation_id`. So a
 * document with any stamped page row is typed, and only its committed generation's pages are
 * current; a document with no stamped rows is legacy, and its unstamped rows are current.
 *
 * Page metadata never carries `index_generation_id`, so `isCommittedGenerationMetadata` kept every
 * stored copy of a page after a re-index, and the viewer showed whichever copy came back last
 * (RAG and ingestion audit 2026-10-24, E2E-02). When a document names a committed generation that
 * has no rows in the set, nothing is returned: the unstamped rows are older text, and showing them
 * as current is the hazard this guards against. Only a document naming no generation reads its
 * unstamped rows.
 */
export function currentDocumentPageRows<T extends { index_generation_id?: string | null }>(
  rows: T[],
  documentMetadata: unknown,
): T[] {
  if (!rows.some((row) => row.index_generation_id)) return rows;
  const committedGeneration = committedIndexGeneration(documentMetadata);
  return committedGeneration
    ? rows.filter((row) => row.index_generation_id === committedGeneration)
    : rows.filter((row) => !row.index_generation_id);
}

export function imageRowNeedsGenerationRestamp(args: {
  indexGenerationId: string | null;
  metadata: unknown;
  committedGeneration: string;
}) {
  if (args.indexGenerationId !== args.committedGeneration) return true;
  return committedIndexGeneration(args.metadata) !== args.committedGeneration;
}

export function isAbandonedStagedGeneration(args: {
  rowMetadata?: unknown;
  rowGenerationId?: string | null;
  committedGeneration?: string | null;
}) {
  const rowGeneration =
    typeof args.rowGenerationId === "string" && args.rowGenerationId.trim()
      ? args.rowGenerationId.trim()
      : committedIndexGeneration(args.rowMetadata);
  if (!rowGeneration) return false;
  return rowGeneration !== (args.committedGeneration ?? null);
}

export function abandonedReindexGenerationTotal(counts: AbandonedReindexGenerationCounts) {
  return Object.values(counts).reduce((total, value) => total + (Number.isFinite(value) ? Number(value) : 0), 0);
}

export function hasAbandonedReindexGenerations(counts: AbandonedReindexGenerationCounts) {
  return abandonedReindexGenerationTotal(counts) > 0;
}

/**
 * Exit code for a read-only (dry-run) pass of the abandoned-generation cleanup.
 *
 * A dry run that finds abandoned staged rows still exits 0 today, so a scheduled
 * probe could not tell "nothing to reap" from "rows are leaking". `--alert-on-abandoned`
 * makes detection loud: non-zero so `.github/workflows/reindex-reaper.yml` can open an
 * alert issue. Mirrors `--alert-on-stuck` in `scripts/ingestion-autopilot.ts`.
 *
 * Detection only — this never deletes anything, and it does NOT close `#Q4Y7TR`.
 * The recorded fix there is for the commit RPC to enqueue `storage_cleanup_jobs`
 * rows for superseded generations at commit time; that is a migration and ships
 * in a separate batch.
 */
export function abandonedReindexGenerationAlertExitCode(args: {
  counts: AbandonedReindexGenerationCounts;
  alertOnAbandoned: boolean;
  apply: boolean;
}) {
  // Never re-purpose the apply path's exit code: --apply already reports its own
  // success/failure, and an alert exit there would mask a real cleanup failure.
  if (!args.alertOnAbandoned || args.apply) return 0;
  return hasAbandonedReindexGenerations(args.counts) ? 2 : 0;
}

export const DEFAULT_ABANDONED_CLEANUP_LIMIT = 100;
export const MAX_ABANDONED_CLEANUP_LIMIT = 500;

export function clampAbandonedCleanupLimit(limit?: unknown, maxLimit: number = MAX_ABANDONED_CLEANUP_LIMIT): number {
  const parsed = typeof limit === "number" ? limit : Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ABANDONED_CLEANUP_LIMIT;
  }
  return Math.min(Math.floor(parsed), maxLimit);
}

export type StagedGenerationCandidate = {
  generationId: string;
  createdAt?: string | number | Date | null;
  [key: string]: unknown;
};

export type FilterReapableAbandonedGenerationsArgs<T = string | StagedGenerationCandidate> = {
  documentId?: string;
  metadata?: unknown;
  committedGeneration?: string | null;
  generations: T[];
};

/**
 * Keep-most-recent-generation guard:
 * - Skips legacy documents where metadata.index_generation_id is absent so pre-generation-stamping documents are never falsely reaped.
 * - Preserves the newest non-committed generation if a reindex is still in flight or uncommitted.
 * - Excludes any generation that matches the committed generation.
 * - Returns only the older abandoned staged generations.
 */
export function filterReapableAbandonedGenerations<T extends string | StagedGenerationCandidate>(
  input: FilterReapableAbandonedGenerationsArgs<T> | T[],
  options?: { metadata?: unknown; committedGeneration?: string | null },
): T[] {
  let generations: T[];
  let committedGen: string | null = null;

  if (Array.isArray(input)) {
    generations = input;
    committedGen = options?.committedGeneration ?? committedIndexGeneration(options?.metadata);
  } else {
    generations = input.generations ?? [];
    committedGen = input.committedGeneration ?? committedIndexGeneration(input.metadata);
  }

  // Safety guard: skip legacy documents where metadata.index_generation_id is absent
  if (!committedGen) {
    return [];
  }

  const getGenId = (item: T): string => {
    if (typeof item === "string") return item.trim();
    return String(item.generationId ?? "").trim();
  };

  const getCreatedAtTime = (item: T, fallbackIndex: number): number => {
    if (typeof item !== "string" && item.createdAt) {
      const time = new Date(item.createdAt).getTime();
      if (!Number.isNaN(time)) return time;
    }
    return fallbackIndex;
  };

  // Exclude committed generation
  const nonCommitted = generations.filter((item) => {
    const id = getGenId(item);
    return id.length > 0 && id !== committedGen;
  });

  // If 0 or 1 staged generation, preserve it (it's the newest staged generation, possibly in-flight)
  if (nonCommitted.length <= 1) {
    return [];
  }

  // Find the newest non-committed generation
  let newestIndex = 0;
  let maxTime = -Infinity;
  nonCommitted.forEach((item, index) => {
    const t = getCreatedAtTime(item, index);
    if (t > maxTime) {
      maxTime = t;
      newestIndex = index;
    }
  });

  const newestGenId = getGenId(nonCommitted[newestIndex]);

  // Keep the newest staged generation; return older abandoned generations
  return nonCommitted.filter((item) => getGenId(item) !== newestGenId);
}

export type AbandonedGenerationImageRow = {
  storage_path: string;
  document_id?: string;
  index_generation_id?: string | null;
  metadata?: unknown;
  created_at?: string | number | Date | null;
  [key: string]: unknown;
};

export type AbandonedGenerationStorageCleanupJob = {
  document_id: string | null;
  document_bucket: string;
  document_paths: string[];
  image_bucket: string;
  image_paths: string[];
  owner_id: string | null;
  status: "pending";
  metadata: Record<string, unknown>;
};

export type BuildAbandonedGenerationStorageCleanupJobsArgs = {
  documentId: string;
  documentMetadata?: unknown;
  committedGeneration?: string | null;
  imageRows: AbandonedGenerationImageRow[];
  ownerId?: string | null;
  documentBucket?: string;
  imageBucket?: string;
  activeStagedGenerationId?: string | null;
  preserveNewestStagedGeneration?: boolean;
  documentIdInJob?: boolean;
};

/**
 * Builds storage_cleanup_jobs payload rows from abandoned document_images / generation storage paths.
 * Deduplicates object paths and excludes any path still referenced by the document's committed
 * metadata.index_generation_id, an unassigned legacy image row, or (by default) the most-recent staged generation.
 * Also skips legacy documents where metadata.index_generation_id is absent.
 */
export function buildAbandonedGenerationStorageCleanupJobs(
  input: BuildAbandonedGenerationStorageCleanupJobsArgs | BuildAbandonedGenerationStorageCleanupJobsArgs[],
): AbandonedGenerationStorageCleanupJob[] {
  if (Array.isArray(input)) {
    return input.flatMap((item) => buildAbandonedGenerationStorageCleanupJobs(item));
  }

  const committedGen = input.committedGeneration ?? committedIndexGeneration(input.documentMetadata);
  // Safety guard: skip legacy documents without committed generation
  if (!committedGen) {
    return [];
  }

  const imageRows = input.imageRows ?? [];
  if (imageRows.length === 0) {
    return [];
  }

  const getRowGen = (row: AbandonedGenerationImageRow): string | null => {
    if (typeof row.index_generation_id === "string" && row.index_generation_id.trim()) {
      return row.index_generation_id.trim();
    }
    return committedIndexGeneration(row.metadata);
  };

  const getCreatedAtTime = (row: AbandonedGenerationImageRow, fallbackIndex: number): number => {
    if (row.created_at) {
      const time = new Date(row.created_at).getTime();
      if (!Number.isNaN(time)) return time;
    }
    return fallbackIndex;
  };

  // Paths referenced by the committed generation
  const committedPaths = new Set<string>();
  // Paths unassigned to any generation (legacy image rows belonging to document)
  const unassignedPaths = new Set<string>();

  // Map of non-committed staged generation -> { maxTime: number, paths: Set<string> }
  const stagedGenerations = new Map<string, { maxTime: number; paths: Set<string> }>();

  imageRows.forEach((row, index) => {
    const path = typeof row.storage_path === "string" ? row.storage_path.trim() : "";
    if (!path) return;

    const rowGen = getRowGen(row);
    if (!rowGen) {
      unassignedPaths.add(path);
      return;
    }

    if (rowGen === committedGen) {
      committedPaths.add(path);
      return;
    }

    const t = getCreatedAtTime(row, index);
    const existing = stagedGenerations.get(rowGen);
    if (!existing) {
      stagedGenerations.set(rowGen, { maxTime: t, paths: new Set([path]) });
    } else {
      existing.maxTime = Math.max(existing.maxTime, t);
      existing.paths.add(path);
    }
  });

  // If no staged generations, there is nothing abandoned
  if (stagedGenerations.size === 0) {
    return [];
  }

  const shouldPreserveNewest = input.preserveNewestStagedGeneration ?? true;
  let newestStagedGenId = input.activeStagedGenerationId?.trim() ?? null;
  if (!newestStagedGenId && shouldPreserveNewest) {
    let maxTime = -Infinity;
    for (const [genId, info] of stagedGenerations.entries()) {
      if (info.maxTime > maxTime) {
        maxTime = info.maxTime;
        newestStagedGenId = genId;
      }
    }
  }

  const newestStagedPaths =
    newestStagedGenId && stagedGenerations.has(newestStagedGenId)
      ? stagedGenerations.get(newestStagedGenId)!.paths
      : new Set<string>();

  const abandonedGenIds = Array.from(stagedGenerations.keys()).filter((genId) => genId !== newestStagedGenId);
  if (abandonedGenIds.length === 0) {
    return [];
  }

  // Collect candidate orphaned paths
  const candidatePaths = new Set<string>();
  for (const genId of abandonedGenIds) {
    const info = stagedGenerations.get(genId);
    if (!info) continue;
    for (const p of info.paths) {
      // Exclude paths referenced by committed generation, preserved staged generation, or unassigned rows.
      if (!committedPaths.has(p) && !newestStagedPaths.has(p) && !unassignedPaths.has(p)) {
        candidatePaths.add(p);
      }
    }
  }

  if (candidatePaths.size === 0) {
    return [];
  }

  const job: AbandonedGenerationStorageCleanupJob = {
    document_id: input.documentIdInJob ? input.documentId : null,
    document_bucket: input.documentBucket ?? "clinical-documents",
    document_paths: [],
    image_bucket: input.imageBucket ?? "clinical-images",
    image_paths: Array.from(candidatePaths).sort(),
    owner_id: input.ownerId ?? null,
    status: "pending",
    metadata: {
      operation: "abandoned_reindex_generation_storage_cleanup",
      document_id: input.documentId,
      abandoned_generations: abandonedGenIds.sort(),
      reaped_paths_count: candidatePaths.size,
    },
  };

  return [job];
}
