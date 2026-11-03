import { createHash } from "node:crypto";
import { z } from "zod";
import type { ContentSha256, ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import type { ManagedProviderEmbeddingRequestContext } from "./managed-provider-vectors";

export const GENERAL_PDF_INSPECTION_VERSION = "administrator-general-native-pdf-inspection-v1" as const;
export const GENERAL_PDF_MAX_SOURCE_BYTES = 150 * 1024 * 1024;
export const GENERAL_PDF_MAX_TEXT_BYTES = 8 * 1024 * 1024;
export const GENERAL_PDF_MAX_PAGE_TEXT_BYTES = 2 * 1024 * 1024;
export const GENERAL_PDF_MAX_PAGES = 1000;
const MAX_VALIDITY_MS = 86400000;
const sha = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value) => value as ContentSha256);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const bindingSchema = z
  .object({
    admissionEventId: uuid,
    documentId: uuid,
    generationId: uuid,
    jobId: uuid,
    attemptId: z.string().min(1).max(256),
    leaseId: uuid,
    contentSha256: sha,
    authorityDigest: sha,
  })
  .strict();
export const generalPdfInspectionReviewSchema = z
  .object({
    version: z.literal(GENERAL_PDF_INSPECTION_VERSION),
    binding: bindingSchema,
    sourceSha256: sha,
    sourceByteLength: z.number().int().positive().max(GENERAL_PDF_MAX_SOURCE_BYTES),
    pageCount: z.number().int().positive().max(GENERAL_PDF_MAX_PAGES),
    pages: z
      .array(
        z
          .object({
            pageNumber: z.number().int().positive().max(GENERAL_PDF_MAX_PAGES),
            text: z.string().max(GENERAL_PDF_MAX_PAGE_TEXT_BYTES),
            textSha256: sha,
          })
          .strict(),
      )
      .min(1)
      .max(GENERAL_PDF_MAX_PAGES),
    pageInventory: z.literal("complete"),
    activeContent: z.literal("absent"),
    encryption: z.literal("not_encrypted"),
    hiddenText: z.literal("consistent"),
    inspectedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

/** Current trusted inspection evidence, supplied separately from document metadata.
 * Hashes authenticate its original/page binding; the commissioned inspector still owns
 * actual PDF safety and completeness observations. This contract creates no clearance. */
export type GeneralPdfInspectionReview = z.infer<typeof generalPdfInspectionReviewSchema>;

const hash = (value: Uint8Array | string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function refuse(reason: string): never {
  throw new Error(`general_pdf_inspection_${reason}`);
}
function validatedReview(review: unknown): GeneralPdfInspectionReview {
  const parsed = generalPdfInspectionReviewSchema.safeParse(review);
  if (!parsed.success) return refuse("review_invalid");
  const r = parsed.data;
  const start = Date.parse(r.inspectedAt);
  const end = Date.parse(r.expiresAt);
  const now = Date.now();
  if (start > now || end <= now || end <= start || end - start > MAX_VALIDITY_MS) refuse("review_not_current");
  if (r.pageCount !== r.pages.length) refuse("page_inventory_incomplete");
  let totalBytes = 0;
  for (const [index, page] of r.pages.entries()) {
    const size = Buffer.byteLength(page.text, "utf8");
    totalBytes += size;
    if (
      page.pageNumber !== index + 1 ||
      hash(page.text) !== page.textSha256 ||
      Buffer.from(page.text, "utf8").toString("utf8") !== page.text
    )
      refuse("page_binding_mismatch");
    if (size > GENERAL_PDF_MAX_PAGE_TEXT_BYTES || totalBytes > GENERAL_PDF_MAX_TEXT_BYTES)
      refuse("text_budget_exceeded");
  }
  if (!totalBytes) refuse("empty_source_text");
  return r;
}

/** Checks all original bytes and every page, never truncating or rewriting source text. */
export function inspectGeneralPdfSource(
  review: unknown,
  sourceBytes: Uint8Array,
  binding: Readonly<ProviderEgressBinding>,
): string[] {
  const r = validatedReview(review);
  if (
    sourceBytes.length !== r.sourceByteLength ||
    sourceBytes.length > GENERAL_PDF_MAX_SOURCE_BYTES ||
    hash(sourceBytes) !== r.sourceSha256 ||
    r.sourceSha256 !== binding.contentSha256 ||
    Object.keys(r.binding).some(
      (key) => r.binding[key as keyof typeof r.binding] !== binding[key as keyof ProviderEgressBinding],
    )
  ) {
    refuse("source_binding_mismatch");
  }
  if (!Buffer.from(sourceBytes.subarray(0, 5)).equals(Buffer.from("%PDF-"))) refuse("source_format_unsupported");
  return r.pages.map((page) => page.text);
}

/** Embedding chunks must be exact substrings of individual inspected pages. A caller
 * with a managed plan additionally binds every input to the exact selected chunk IDs. */
export function assertGeneralPdfEmbeddingInputs(
  review: unknown,
  inputs: readonly string[],
  batch?: ManagedProviderEmbeddingRequestContext,
): void {
  const r = validatedReview(review);
  if (
    !inputs.length ||
    inputs.length > 128 ||
    inputs.some(
      (input) => typeof input !== "string" || !input.trim() || !r.pages.some((page) => page.text.includes(input)),
    )
  ) {
    refuse("payload_not_source_derived");
  }
  if (
    batch &&
    (!/^sha256:[a-f0-9]{64}$/.test(batch.planDigest) ||
      batch.inputs.length !== inputs.length ||
      batch.inputs.some(
        (item, index) =>
          item.providerInputText !== inputs[index] ||
          !item.sourceUnitIds.length ||
          item.sourceUnitIds.some((unit) => unit.family !== "chunks" || !uuid.safeParse(unit.key).success),
      ))
  ) {
    refuse("embedding_batch_mismatch");
  }
}
