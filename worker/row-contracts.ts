import { z } from "zod";
import { logger } from "../src/lib/logger";

/**
 * Runtime shape contracts for inbound database rows consumed by the ingestion worker.
 *
 * `worker/main.ts` had been asserting these shapes with `as unknown as` casts, which is a
 * compile-time claim about a live database that is known to drift: `docs/outstanding-issues.md`
 * `#316` records missing indexes and RPC bodies diverging from this repo's migrations. A
 * renamed column in the `claim_ingestion_jobs` payload then does not fail at the cast — it
 * throws a `TypeError` mid-job (before the job lifecycle's try/catch), leaving the job leased
 * and unmarked until the stale reclaim fires.
 *
 * This module is the worker counterpart of `src/lib/validation/row-contracts.ts` and
 * `src/lib/rag/rag-row-contracts.ts` and deliberately duplicates their small
 * validate-log-throw core rather than importing it, so that hardening the worker never edits
 * an API route or a protected RAG ranking surface. It is import-pure — no Supabase client and
 * no env read at module load — so Vitest can exercise it directly even though
 * `worker/main.ts` itself cannot be imported in tests.
 *
 * Every contract here follows the same two rules:
 *
 * - **`z.looseObject`, never `z.object`.** Zod strips unknown keys by default, which would be
 *   silent data loss whenever the live column set is ahead of this repo. Unknown keys pass
 *   through untouched.
 * - **Pin only what a constraint backs.** Each required field below is `not null` or carries a
 *   `check` in `supabase/schema.sql`, cited per contract, so requiring it cannot reject a row
 *   the database would accept today. Anything unconstrained stays permissive. The one
 *   deliberate exception (jsonb object-ness) is flagged where it is made.
 */

/** Cap on reported issues; a wholesale shape change would otherwise report one per row. */
const MAX_REPORTED_ISSUES = 5;

/**
 * Thrown when a claimed job row or an enrichment read-back does not satisfy its contract.
 *
 * The message carries only Zod issue paths and codes — never a row value. These rows carry
 * clinical document text and owner identifiers, so echoing one into a job `error_message`,
 * a log line, or Sentry would leak content past the worker's safe-logging boundary.
 */
export class WorkerRowShapeError extends Error {
  readonly source: string;
  readonly issues: string[];

  constructor(source: string, issues: string[]) {
    super(`"${source}" returned data that does not match the worker contract: ${issues.join("; ")}`);
    this.name = "WorkerRowShapeError";
    this.source = source;
    this.issues = issues;
  }
}

function describeIssues(error: z.ZodError): string[] {
  const described = error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`);
  const remaining = error.issues.length - described.length;
  return remaining > 0 ? [...described, `and ${remaining} more`] : described;
}

/**
 * Shared validate-log-throw step. Kept separate so every contract fails identically, and logs
 * before throwing so drift stays visible even where a caller catches and degrades — both
 * worker call sites do exactly that (the claim partition and the inline-enrichment catch).
 */
function assertAgainst(schema: z.ZodType, value: unknown, source: string): void {
  const parsed = schema.safeParse(value);
  if (parsed.success) return;
  const issues = describeIssues(parsed.error);
  logger.error("worker_row_shape_mismatch", {
    source,
    issues,
    rowCount: Array.isArray(value) ? value.length : null,
  });
  throw new WorkerRowShapeError(source, issues);
}

/**
 * The `documents` payload inside a claimed job row: `claim_ingestion_jobs` returns
 * `to_jsonb(d.*)` — the entire `public.documents` row serialized to `jsonb`, untyped on the
 * generated client. Pins mirror the table's constraints in `supabase/schema.sql`: `title`,
 * `file_name`, `file_type`, and `storage_path` are `not null`; `status` carries a four-value
 * `check`; `owner_id`, `content_hash`, `source_path`, and `import_batch_id` are nullable
 * columns and stay `.nullable()` (`to_jsonb` always emits the key). `owner_id` nullability is
 * schema-honest and already handled by every worker reader (`?? "anonymous"`, null-filtered
 * document updates, caption-cache early return).
 *
 * `metadata` is `jsonb not null default '{}'` with no `jsonb_typeof` check, so pinning it to
 * a record exceeds strict constraint backing. It is pinned anyway because (a) it is exactly
 * the claim the deleted cast made silently — `JobDocument.metadata` is
 * `Record<string, unknown> | null` and the worker spreads it into metadata merges — and
 * (b) `src/lib/rag/rag-row-contracts.ts` pins `source_metadata` on the same data-backed
 * grounds. A scalar here would corrupt every downstream metadata merge.
 */
const claimedJobDocumentSchema = z.looseObject({
  id: z.uuid(),
  owner_id: z.string().nullable(),
  title: z.string(),
  file_name: z.string(),
  file_type: z.string(),
  storage_path: z.string(),
  content_hash: z.string().nullable(),
  file_size: z.number().int().nonnegative().nullable().optional(),
  page_storage_mode: z.enum(["legacy_unqualified", "typed_exact"]).optional(),
  source_path: z.string().nullable(),
  import_batch_id: z.string().nullable(),
  status: z.enum(["queued", "processing", "indexed", "failed"]),
  metadata: z.record(z.string(), z.unknown()),
});

/**
 * A row from the `claim_ingestion_jobs` RPC. Top-level pins mirror `public.ingestion_jobs`
 * in `supabase/schema.sql`: `id` is the primary key, `document_id` is `not null`,
 * `attempt_count` and `max_attempts` are `integer not null` (the worker's retry-cap
 * comparison consumes both as trusted numbers), and `batch_id` is a nullable column — the
 * generated Supabase type says `string`, which is wrong; the schema is the authority here.
 * Unpinned RPC columns (`status`, `stage`, `progress`, `locked_at`, `locked_by`,
 * `error_message`) pass through untouched because the worker never reads them off the
 * claimed row.
 */
const claimedJobRowSchema = z
  .looseObject({
    locked_by: z.string().refine((value) => value.trim().length > 0),
    lease_token: z.uuid(),
    lease_expected_generation_id: z.uuid().nullable(),
    lease_write_generation_id: z.uuid(),
    lease_authority_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    lease_expires_at: z.iso.datetime({ offset: true }),
    lease_duration_seconds: z.number().int().min(60).max(86400),
    id: z.uuid(),
    document_id: z.uuid(),
    batch_id: z.string().nullable(),
    attempt_count: z.number().int(),
    max_attempts: z.number().int(),
    documents: claimedJobDocumentSchema,
  })
  .refine((row) => row.document_id === row.documents.id, {
    path: ["documents", "id"],
    message: "Claim document identity mismatch",
  });

/**
 * Deliberately the inferred schema type, not `JobRow`: `claimJobs`'s declared
 * `Promise<JobRow[]>` return (checked against `worker/run-loop.ts`'s `deps.claim`) is the
 * compile-time proof that this type stays assignable to `JobRow` — if the schema ever
 * weakens below `JobRow`, `tsc` fails at the wiring instead of silently unsound-asserting.
 */
export type ClaimedJobRow = z.infer<typeof claimedJobRowSchema>;

/** Validate one claimed job row before it enters the job lifecycle. */
export function assertClaimedJobRow(row: unknown): asserts row is ClaimedJobRow {
  assertAgainst(claimedJobRowSchema, row, "claim_ingestion_jobs");
}

/** Rejected rows cannot authorize any mutation; the durable lease may expire for reclaim. */
export type RejectedClaimedJobRow = {
  error: WorkerRowShapeError;
  failable: null;
};

/**
 * Partition a claimed batch into rows that may enter the job lifecycle and rows that must
 * not. Assert-only for accepted rows: they are the same references in their original order.
 *
 * This exists because a batch-wide throw would be the wrong failure mode in `claimJobs`:
 * the RPC has already committed leases and `attempt_count` increments for every row in the
 * batch, and a throw there bypasses the job lifecycle entirely (the run-loop claim catch
 * backs off and repolls; under `--once` it exits the process), orphaning valid sibling jobs.
 * Per-row rejection lets valid siblings proceed without inventing authority for rejected rows.
 */
export function partitionClaimedJobRows(rows: readonly unknown[]): {
  accepted: ClaimedJobRow[];
  rejected: RejectedClaimedJobRow[];
} {
  const accepted: ClaimedJobRow[] = [];
  const rejected: RejectedClaimedJobRow[] = [];
  for (const row of rows) {
    try {
      assertClaimedJobRow(row);
      accepted.push(row);
    } catch (error) {
      if (!(error instanceof WorkerRowShapeError)) throw error;
      rejected.push({ error, failable: null });
    }
  }
  return { accepted, rejected };
}

/**
 * Chunk rows read back by `loadEnrichmentRows` for the optional enrichment/deep-memory
 * stage — exactly the columns its `select` lists. Pins mirror `public.document_chunks` in
 * `supabase/schema.sql`: `chunk_index` and `content` are `not null` (plus the
 * content-not-blank `check`), `section_path` and `image_ids` are `not null default '{}'`
 * arrays, and `page_number`, `section_heading`, `heading_level`, `parent_heading`, and
 * `anchor_id` are nullable columns. `metadata` is record-pinned on the same grounds as the
 * claimed-document pin above — `upsertDocumentDeepMemory` types it
 * `Record<string, unknown> | null` and mutates it, which is precisely the claim the deleted
 * parameter cast waved through.
 */
const enrichmentChunkRowSchema = z.looseObject({
  id: z.string().min(1),
  document_id: z.string().min(1),
  index_generation_id: z.uuid(),
  page_number: z.number().int().nullable(),
  chunk_index: z.number().int(),
  section_heading: z.string().nullable(),
  section_path: z.array(z.string()),
  heading_level: z.number().int().nullable(),
  parent_heading: z.string().nullable(),
  anchor_id: z.string().nullable(),
  content: z.string(),
  image_ids: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
});

/**
 * Image rows read back by `loadEnrichmentRows` — exactly the columns its `select` lists.
 * Pins mirror `public.document_images` in `supabase/schema.sql`: `caption` is
 * `not null default ''`, `labels` is `not null default '{}'`, `source_kind` is `not null`,
 * `clinical_relevance_score` is `real not null default 0`, and `page_number` is nullable.
 * `image_type` carries a ten-value `check` but is deliberately kept `z.string()`: both
 * consumers type it `string | null`, and the database list diverges from the worker's
 * `ImageEvidenceCategory` union (which adds `cover_page`), so an enum pin buys no safety
 * and adds live-drift rejection risk.
 */
const enrichmentImageRowSchema = z.looseObject({
  id: z.string().min(1),
  document_id: z.string().min(1),
  index_generation_id: z.uuid(),
  page_number: z.number().int().nullable(),
  caption: z.string(),
  image_type: z.string(),
  labels: z.array(z.string()),
  source_kind: z.string(),
  clinical_relevance_score: z.number(),
  metadata: z.record(z.string(), z.unknown()),
});

export type EnrichmentChunkRow = z.infer<typeof enrichmentChunkRowSchema>;
export type EnrichmentImageRow = z.infer<typeof enrichmentImageRowSchema>;

/**
 * Validate enrichment chunk read-backs. A throw here is contained by the inline-enrichment
 * try in `worker/main.ts`: enrichment is marked failed, the job still completes, and repair
 * is queued for the indexing agent — record-and-skip, never a retry loop.
 */
type EnrichmentAuthority = { documentId: string; indexGenerationId: string };
function assertEnrichmentAuthority(
  rows: Array<{ document_id: string; index_generation_id: string; metadata: Record<string, unknown> }>,
  authority: EnrichmentAuthority | undefined,
  source: string,
) {
  if (!authority) return;
  if (
    rows.some(
      (row) =>
        row.document_id !== authority.documentId ||
        row.index_generation_id !== authority.indexGenerationId ||
        row.metadata.index_generation_id !== authority.indexGenerationId,
    )
  ) {
    throw new WorkerRowShapeError(source, ["document/generation identity mismatch"]);
  }
}
export function assertEnrichmentChunkRows(
  rows: unknown,
  authority?: EnrichmentAuthority,
): asserts rows is EnrichmentChunkRow[] {
  assertAgainst(z.array(enrichmentChunkRowSchema), rows, "document_chunks.enrichment_load");
  assertEnrichmentAuthority(rows as EnrichmentChunkRow[], authority, "document_chunks.enrichment_load");
}

/** Validate enrichment image read-backs; same containment as the chunk assert. */
export function assertEnrichmentImageRows(
  rows: unknown,
  authority?: EnrichmentAuthority,
): asserts rows is EnrichmentImageRow[] {
  assertAgainst(z.array(enrichmentImageRowSchema), rows, "document_images.enrichment_load");
  assertEnrichmentAuthority(rows as EnrichmentImageRow[], authority, "document_images.enrichment_load");
}
