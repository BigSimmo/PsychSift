/**
 * Audit E2E-04 (24 Oct 2026): an administrator's review of a table or figure ("bad extraction",
 * "not clinically useful") is stored on that index generation's rows. A re-index writes fresh rows,
 * so without this a table switched off as wrong came back into answers with no warning. Before the
 * new generation's rows are written, the latest review of a matching row on an earlier generation
 * of the same document is copied onto it. Rows match on content, never on id: an image by its exact
 * content hash, a table fact by its page, title, row and cell text.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const reviewFields = [
  "review_class",
  "review_notes",
  "review_confidence",
  "reviewed_by",
  "reviewed_at",
  "clinical_use_class",
  "table_role",
] as const;

type ReviewFields = Partial<Record<(typeof reviewFields)[number], unknown>>;
type CarriedReview = { review: ReviewFields; generation: string | null };

type ReviewedRow = { metadata: unknown; index_generation_id: string | null };
type ReviewedImageRow = ReviewedRow & { image_hash: string | null };
type ReviewedFactRow = ReviewedRow & TableFactKeyFields;

type TableFactKeyFields = {
  page_number: number | null;
  table_title: string | null | undefined;
  row_label: string | null;
  clinical_parameter: string | null | undefined;
  threshold_value: string | null;
  action: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizedCell(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function tableFactReviewKey(fact: TableFactKeyFields) {
  return [
    fact.page_number ?? "",
    fact.table_title,
    fact.row_label,
    fact.clinical_parameter,
    fact.threshold_value,
    fact.action,
  ]
    .map(normalizedCell)
    .join("␟");
}

/** Keep the most recent review per key, so a later re-review on an older generation still wins. */
function latestReviews<T extends ReviewedRow>(rows: readonly T[], keyFor: (row: T) => string | null) {
  const reviews = new Map<string, CarriedReview & { reviewedAt: string }>();
  for (const row of rows) {
    const metadata = record(row.metadata);
    const key = keyFor(row);
    if (!key || typeof metadata.review_class !== "string") continue;
    const reviewedAt = typeof metadata.reviewed_at === "string" ? metadata.reviewed_at : "";
    const existing = reviews.get(key);
    if (existing && existing.reviewedAt >= reviewedAt) continue;
    const review: ReviewFields = {};
    for (const field of reviewFields) if (field in metadata) review[field] = metadata[field];
    reviews.set(key, { review, generation: row.index_generation_id, reviewedAt });
  }
  return new Map([...reviews].map(([key, { review, generation }]) => [key, { review, generation }]));
}

export function priorImageReviews(rows: readonly ReviewedImageRow[]) {
  return latestReviews(rows, (row) => row.image_hash || null);
}

export function priorTableFactReviews(rows: readonly ReviewedFactRow[]) {
  return latestReviews(rows, (row) => tableFactReviewKey(row));
}

function withReview(metadata: unknown, carried: CarriedReview) {
  return { ...record(metadata), ...carried.review, review_carried_from_generation: carried.generation };
}

/** Same rule as the review route: only "clinically useful" and "reference" stay searchable. */
function reviewedSearchable(reviewClass: unknown) {
  return reviewClass === "clinical_useful" || reviewClass === "reference";
}

export function carryImageReview<T extends { image_hash?: string | null; searchable: boolean; metadata: unknown }>(
  row: T,
  reviews: ReadonlyMap<string, CarriedReview>,
): T {
  const carried = row.image_hash ? reviews.get(row.image_hash) : undefined;
  if (!carried) return row;
  return {
    ...row,
    searchable: row.searchable && reviewedSearchable(carried.review.review_class),
    metadata: withReview(row.metadata, carried),
  };
}

export function carryTableFactReview<T extends TableFactKeyFields & { metadata: Record<string, unknown> }>(
  fact: T,
  reviews: ReadonlyMap<string, CarriedReview>,
): T {
  const carried = reviews.get(tableFactReviewKey(fact));
  return carried ? { ...fact, metadata: withReview(fact.metadata, carried) } : fact;
}

/** Reviewed rows of this document on any generation other than the one being written. */
async function loadReviewedRows<T>(
  supabase: SupabaseClient,
  table: "document_images" | "document_table_facts",
  columns: string,
  documentId: string,
  writeGeneration: string,
) {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("document_id", documentId)
    // Legacy rows carry no generation, and a bare neq would skip them (NULL never compares).
    .or(`index_generation_id.is.null,index_generation_id.neq.${writeGeneration}`)
    .not("metadata->>review_class", "is", null)
    .limit(5000);
  // Fail the job rather than silently dropping an owner's review: a retry is cheap, a lost
  // "bad extraction" mark is not.
  if (error) throw new Error(`Could not read prior ${table} reviews: ${error.message}`);
  return (data ?? []) as T[];
}

export async function loadPriorImageReviews(supabase: SupabaseClient, documentId: string, writeGeneration: string) {
  return priorImageReviews(
    await loadReviewedRows<ReviewedImageRow>(
      supabase,
      "document_images",
      "image_hash,metadata,index_generation_id",
      documentId,
      writeGeneration,
    ),
  );
}

export async function loadPriorTableFactReviews(supabase: SupabaseClient, documentId: string, writeGeneration: string) {
  return priorTableFactReviews(
    await loadReviewedRows<ReviewedFactRow>(
      supabase,
      "document_table_facts",
      "page_number,table_title,row_label,clinical_parameter,threshold_value,action,metadata,index_generation_id",
      documentId,
      writeGeneration,
    ),
  );
}
