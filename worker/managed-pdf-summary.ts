import { z } from "zod";
import { assertValidatedRenderedPdfReview, type RenderedPdfReviewResult } from "./rendered-pdf-review";
import {
  prepareCandidateSourceAnchoredSummary,
  type SourceAnchoredSummaryGenerationResult,
} from "../src/lib/document-enrichment";
import {
  normalizeSourceAnchoredSummary,
  projectSourceAnchoredLabels,
} from "../supabase/functions/_shared/source-anchored-summary";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceDigest,
} from "../src/lib/ingestion-generation-evidence";
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const page = z.object({ pageNumber: z.number().int().positive(), text: z.string() }).passthrough();
const inspection = z.object({ sourceSha256: sha, pages: z.array(page).min(1) }).passthrough();
const row = z
  .object({
    id: z.uuid(),
    document_id: z.uuid(),
    index_generation_id: z.uuid(),
    page_number: z.number().int().positive(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .passthrough();
const inputSchema = z.object({
  document: z.object({
    id: z.uuid(),
    title: z.string(),
    file_name: z.string(),
    source_path: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  packet: z
    .object({
      identity: z.object({ documentId: z.uuid(), generationId: z.uuid(), sourceSha256: sha }).passthrough(),
      inspection,
      rows: z.object({
        chunks: z.array(row.extend({ content: z.string(), chunk_index: z.number().int().nonnegative() })).min(1),
        images: z.array(row),
      }),
    })
    .passthrough(),
});
const contexts = new WeakSet<object>();
function refuse(reason: string): never {
  throw new Error(`managed_pdf_summary_${reason}`);
}
export function prepareManagedPdfSummaryContext(input: unknown) {
  const captured = inputSchema.parse(structuredClone(input));
  const { document, packet } = captured;
  const { documentId, generationId, sourceSha256 } = packet.identity;
  if (document.id !== documentId || packet.inspection.sourceSha256 !== sourceSha256) refuse("source_identity");
  for (const rows of [packet.rows.chunks, packet.rows.images]) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length) refuse("row_identity");
    for (const r of rows)
      if (
        r.document_id !== documentId ||
        r.index_generation_id !== generationId ||
        r.metadata.index_generation_id !== generationId ||
        !packet.inspection.pages.some((p) => p.pageNumber === r.page_number)
      )
        refuse("row_identity");
  }
  for (const [index, p] of packet.inspection.pages.entries()) {
    const chunks = packet.rows.chunks
      .filter((r) => r.page_number === p.pageNumber)
      .sort((a, b) => a.chunk_index - b.chunk_index);
    if (p.pageNumber !== index + 1 || chunks.map((r) => r.content).join("") !== p.text) refuse("source_coverage");
  }
  const sourceInput: Parameters<typeof prepareCandidateSourceAnchoredSummary>[0] = {
    document,
    indexGenerationId: generationId,
    chunks: packet.rows.chunks.map((r) => ({
      id: r.id,
      document_id: documentId,
      index_generation_id: generationId,
      page_number: r.page_number,
      chunk_index: r.chunk_index,
      content: r.content,
      section_heading: null,
      metadata: r.metadata,
    })),
    images: packet.rows.images.map((r) => ({
      id: r.id,
      document_id: documentId,
      index_generation_id: generationId,
      page_number: r.page_number,
      caption: typeof r.caption === "string" ? r.caption : "",
      image_type: typeof r.image_type === "string" ? r.image_type : "unclear",
      labels: Array.isArray(r.labels) ? r.labels.filter((v): v is string => typeof v === "string") : [],
      metadata: r.metadata,
    })),
  };
  const context = freezeGenerationEvidence({
    sourceInput,
    sourceSha256,
    inspection: packet.inspection,
    inspectionDigest: generationEvidenceDigest(packet.inspection),
    plan: prepareCandidateSourceAnchoredSummary(sourceInput),
  });
  contexts.add(context);
  return context;
}
export type ManagedPdfSummaryContext = ReturnType<typeof prepareManagedPdfSummaryContext>;
export function expectedManagedPdfSummaryBody(
  context: ManagedPdfSummaryContext,
  currentInspection: unknown,
  original: Uint8Array,
) {
  if (!contexts.has(context)) refuse("context_required");
  if (
    bytesDigest(Buffer.from(original)) !== context.sourceSha256 ||
    generationEvidenceDigest(currentInspection) !== context.inspectionDigest
  )
    refuse("current_source");
  // Re-derive from captured admitted source rows; never echo a caller-provided body/hash.
  return prepareCandidateSourceAnchoredSummary(context.sourceInput).requestBody;
}
export function expectedManagedPdfSummaryEvidence(
  context: ManagedPdfSummaryContext,
  currentInspection: unknown,
  original: Uint8Array,
) {
  const payload = expectedManagedPdfSummaryBody(context, currentInspection, original);
  return { payload, identifierTexts: summaryIdentifierTexts(context) };
}
function summaryIdentifierTexts(context: ManagedPdfSummaryContext) {
  const { document, chunks, images = [] } = context.sourceInput;
  // These are captured source fields, before server-generated anchor IDs and SDK
  // schema text are added. No UUID-shaped substring is removed from source text.
  const identifierTexts = [
    document.title,
    document.file_name,
    document.source_path ?? "",
    ...chunks.flatMap((row) => [row.content, row.section_heading ?? ""]),
    ...images.flatMap((row) => [row.caption ?? "", row.image_type ?? "", ...(row.labels ?? [])]),
  ];
  return identifierTexts;
}
export function expectedManagedRenderedPdfSummaryEvidence(
  context: ManagedPdfSummaryContext,
  current: RenderedPdfReviewResult,
  original: Uint8Array,
) {
  if (!contexts.has(context)) refuse("context_required");
  assertValidatedRenderedPdfReview(current);
  if (
    context.inspection.version !== "managed-rendered-pdf-inspection-view-v1" ||
    context.inspection.reviewSha256 !== current.reviewSha256 ||
    generationEvidenceDigest(context.inspection.reviewRecord) !== generationEvidenceDigest(current.review) ||
    bytesDigest(Buffer.from(original)) !== context.sourceSha256 ||
    context.sourceSha256 !== current.review.sourceSha256 ||
    context.inspection.pages.length !== current.extracted.pages.length
  )
    refuse("current_source");
  for (const [index, page] of context.inspection.pages.entries()) {
    const actual = current.extracted.pages[index]!;
    if (
      page.pageNumber !== actual.pageNumber ||
      page.text !== actual.text ||
      page.sourceProvenanceSha256 !== generationEvidenceDigest(actual.metadata ?? {})
    )
      refuse("current_source");
  }
  return {
    payload: prepareCandidateSourceAnchoredSummary(context.sourceInput).requestBody,
    identifierTexts: summaryIdentifierTexts(context),
  };
}
export function prepareManagedPdfSummaryProjection(
  context: ManagedPdfSummaryContext,
  result: SourceAnchoredSummaryGenerationResult,
  ownerId: string | null,
) {
  if (!contexts.has(context)) refuse("context_required");
  const payload = normalizeSourceAnchoredSummary(result.payload, context.plan.authority);
  const evidence = result.providerEvidence;
  if (
    payload.summary_kind !== "structured" ||
    evidence.requestedModel !== payload.model ||
    !evidence.providerModel ||
    !evidence.requestId
  )
    refuse("provider_identity_missing");
  const labels = projectSourceAnchoredLabels(payload).map((label) => ({
    document_id: payload.document_id,
    owner_id: ownerId,
    label: label.label,
    label_type: label.label_type,
    confidence: label.confidence,
    source: "generated",
    metadata: {
      index_generation_id: payload.index_generation_id,
      summary_version: payload.summary_version,
      source_chunk_ids: label.source_chunk_ids,
      source_image_ids: label.source_image_ids,
      pages: label.pages,
    },
  }));
  const summary = {
    document_id: payload.document_id,
    owner_id: ownerId,
    summary: payload.summary,
    clinical_specifics: payload.clinical_specifics,
    source_chunk_ids: payload.source_chunk_ids,
    source_image_ids: payload.source_image_ids,
    model: payload.model,
    generated_at: payload.generated_at,
    metadata: {
      index_generation_id: payload.index_generation_id,
      source_anchored_summary_v1: payload,
      source_anchored_summary_projection_complete_v1: true,
      managed_summary_request_sha256: bytesDigest(Buffer.from(context.plan.requestBody)),
      managed_summary_provider_evidence: JSON.parse(JSON.stringify(evidence)),
    },
  };
  return freezeGenerationEvidence({ version: "managed-pdf-summary-projection-v1", summary, labels });
}
