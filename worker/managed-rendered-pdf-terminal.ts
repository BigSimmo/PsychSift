/** Exact approved rendered evidence; native-layer conflict remains unresolved. */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  parseIssuedAttemptControl,
  originalApplicabilityFamilies,
  type IssuedAttemptControl,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import type { ExtractedDocument } from "../src/lib/types";
import {
  captureGenerationImages,
  type buildGenerationRetentionPacket,
  type CapturedGenerationImage,
} from "./generation-evidence";
import { assertValidatedRenderedPdfReview, type RenderedPdfReviewResult } from "./rendered-pdf-review";
import { buildManagedPdfRowPlan, type FullPdfRows } from "./managed-full-pdf-terminal";
import type { TableFactImageRow } from "./table-facts";
import type { JobRow } from "./types";

export const RENDERED_FULL_PDF_PROFILE = "administrator-reviewed-rendered-full-pdf-v1" as const;
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
function refuse(reason: string): never {
  throw new Error(`managed_rendered_pdf_${reason}`);
}
function rowId(doc: string, generation: string, index: number) {
  const b = createHash("sha256")
    .update(generationEvidenceBytes([RENDERED_FULL_PDF_PROFILE, doc, generation, "images", index]))
    .digest()
    .subarray(0, 16);
  b[6] = (b[6] & 15) | 80;
  b[8] = (b[8] & 63) | 128;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** This is a reviewed render inventory, never a native-text inventory. */
export function buildInternalRenderedPdfExpectation(accepted: RenderedPdfReviewResult) {
  assertValidatedRenderedPdfReview(accepted);
  const { review, reviewSha256 } = accepted;
  const units: NonNullable<SourceExpectation["units"]> = [];
  const pageIds: string[] = [],
    tableIds: string[] = [],
    diagramIds: string[] = [];
  for (const page of review.pages) {
    const id = `source-page-${page.pageNumber}`;
    pageIds.push(id);
    units.push({
      id,
      required: true,
      dependencies: [],
      locator: `pdf-page:${page.pageNumber}:source:${review.sourceSha256}:render:${page.render.sha256}:ocr:${page.ocrTextSha256}:review:${reviewSha256}`,
      nativeMapping: "unavailable",
    });
    for (const [kind, records] of [
      ["table", page.tables.status === "reviewed_complete" ? page.tables.records : []],
      ["diagram", page.diagrams.status === "reviewed_complete" ? page.diagrams.records : []],
    ] as const)
      for (const item of records) {
        const featureId = `${id}-${kind}-${item.id}`;
        (kind === "table" ? tableIds : diagramIds).push(featureId);
        units.push({
          id: featureId,
          required: true,
          dependencies: [id],
          locator: `pdf-page:${page.pageNumber}:render:${page.render.sha256}:review:${reviewSha256}:${kind}:${item.id}:${generationEvidenceDigest(item)}`,
          nativeMapping: "unavailable",
        });
      }
  }
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: review.sourceSha256,
    sourceByteLength: review.sourceByteLength,
    sourceUnits: units,
    groups: originalApplicabilityFamilies.map((family) => {
      const ids =
        family === "chunks"
          ? pageIds
          : family === "images"
            ? [...pageIds, ...tableIds]
            : family === "table_facts"
              ? tableIds
              : family === "index_units"
                ? diagramIds
                : [];
      return {
        family,
        population: {
          tag: "known",
          requirements: ids.map((id) => ({
            id: `required-${family}-${id}`,
            required: true,
            sourceEvidenceIds: [id, ...(units.find((unit) => unit.id === id)?.dependencies ?? [])],
          })),
          basis: { scope: "whole_original", kind: "independent_original_declaration" },
          reason: ids.length ? null : "no_original_requirements_in_scope",
        },
      };
    }),
  };
  const sourceExpectationWitnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: review.sourceSha256,
    tag: "known",
    units,
    witness: {
      reference: "independent-original-rendered-pdf-reviewed-inventory-v1",
      sha256: bytesDigest(sourceExpectationWitnessBytes),
    },
    limitation: null,
  };
  return { sourceExpectation, sourceExpectationWitnessBytes };
}
/** Read retained full-page bytes through the existing owned-file capture boundary.
 * Each table references those same pixels, with an explicit reviewed region. */
export async function captureManagedRenderedPdfArtifacts(accepted: RenderedPdfReviewResult) {
  assertValidatedRenderedPdfReview(accepted);
  const extracted: ExtractedDocument = structuredClone(accepted.extracted);
  for (const { pageNumber, table } of accepted.reviewedTables) {
    const page = accepted.fullPageRenders[pageNumber - 1]!;
    extracted.images.push({
      pageNumber,
      path: page.path,
      mimeType: "image/png",
      width: page.width,
      height: page.height,
      sourceKind: "table_crop",
      metadata: {
        rendered_pdf_review: extracted.pages[pageNumber - 1]!.metadata!.rendered_pdf_review,
        source_kind: "reviewed_table_full_page_pixels",
        full_page_render: true,
        reviewed_table_id: table.id,
        table_rows: table.rows.map((r) => r.cells.map((c) => c.content.text)),
        reviewed_render_region: {
          coordinateSpace: "render_pixels",
          region: table.region,
          renderSha256: page.sha256,
          fullPageImageOrdinal: pageNumber,
          pixelScope: "full_page_reuse_not_cropped",
        },
      },
    });
  }
  const capturedImages = await captureGenerationImages({
    extracted,
    trustedTemporaryRoots: extracted.temporaryPaths ?? [],
    fileName: "reviewed.pdf",
    mimeType: "application/pdf",
  });
  for (const capture of capturedImages) {
    const render = accepted.fullPageRenders[capture.descriptor.pageNumber! - 1]!;
    if (
      capture.sha256 !== render.sha256 ||
      capture.byteLength !== render.byteLength ||
      capture.descriptor.width !== render.width ||
      capture.descriptor.height !== render.height
    )
      refuse("render_fidelity_mismatch");
  }
  return { extracted, capturedImages };
}
export type ManagedRenderedPdfInput = {
  job: JobRow;
  issued: IssuedAttemptControl;
  retentionPacket: ReturnType<typeof buildGenerationRetentionPacket>;
  originalBytes: Buffer;
  acceptedReview: RenderedPdfReviewResult;
  binding: ProviderEgressBinding;
  capturedImages: readonly CapturedGenerationImage[];
  stewardId: string;
};
export async function prepareManagedRenderedPdfGeneration(input: ManagedRenderedPdfInput) {
  assertValidatedRenderedPdfReview(input.acceptedReview);
  const issued = parseIssuedAttemptControl(input.issued),
    { job, acceptedReview: accepted, binding } = input;
  const { review, reviewSha256 } = accepted;
  const expected = buildInternalRenderedPdfExpectation(accepted);
  if (
    job.document_id !== issued.documentId ||
    job.id !== issued.jobId ||
    job.lease_write_generation_id !== issued.generationId ||
    binding.documentId !== issued.documentId ||
    binding.jobId !== issued.jobId ||
    binding.generationId !== issued.generationId ||
    binding.leaseId !== issued.firstLeaseToken ||
    binding.attemptId !== `${issued.jobId}:${issued.attemptNumber}:${issued.firstLeaseToken}` ||
    binding.authorityDigest !== issued.authorityDigest ||
    binding.contentSha256 !== review.sourceSha256 ||
    bytesDigest(input.originalBytes) !== review.sourceSha256 ||
    input.originalBytes.length !== review.sourceByteLength ||
    input.retentionPacket.registration.sourceSha256 !== review.sourceSha256 ||
    input.retentionPacket.registration.sourceExpectationSha256 !== generationEvidenceDigest(expected.sourceExpectation)
  )
    refuse("identity_or_inventory_mismatch");
  z.uuid().parse(input.stewardId);
  const { extracted, capturedImages } = await captureManagedRenderedPdfArtifacts(accepted);
  if (!same(capturedImages, input.capturedImages)) refuse("captured_image_fidelity_mismatch");
  const metadata = {
    index_generation_id: issued.generationId,
    artifact_generation_id: issued.generationId,
    source_sha256: review.sourceSha256,
    full_pdf_profile: RENDERED_FULL_PDF_PROFILE,
    inspection_scope: review.verificationScope,
    review_sha256: reviewSha256,
    native_layer_disposition: review.nativeLayerDisposition,
    original_native_conflict: review.originalNativeConflict,
  };
  const imageRows: FullPdfRows["images"] = capturedImages.map((capture, index) => ({
    id: rowId(job.document_id, issued.generationId, index),
    document_id: job.document_id,
    index_generation_id: issued.generationId,
    page_number: capture.descriptor.pageNumber,
    storage_path: `managed-pdf/${job.document_id}/${issued.generationId}/${capture.ordinal}`,
    mime_type: "image/png",
    caption: "",
    image_type: capture.descriptor.sourceKind === "table_crop" ? "clinical_table" : "unclear",
    searchable: true,
    clinical_relevance_score: 0,
    source_kind: capture.descriptor.sourceKind,
    width: capture.descriptor.width,
    height: capture.descriptor.height,
    image_hash: capture.sha256.slice(7),
    labels: [],
    metadata: {
      ...capture.descriptor.metadata,
      ...metadata,
      managed_artifact_reference: {
        version: "managed-pdf-image-v1",
        documentId: job.document_id,
        generationId: issued.generationId,
        imageOrdinal: capture.ordinal,
        sha256: capture.sha256,
      },
    },
  }));
  const tables = accepted.reviewedTables.map(({ pageNumber, table }, i) => ({
    imageOrdinal: review.pageCount + i + 1,
    pageNumber,
    reviewedTableId: table.id,
    region: table.region,
    rows: table.rows.map((r) => r.cells.map((c) => c.content.text)),
    renderSha256: review.pages[pageNumber - 1]!.render.sha256,
  }));
  const imageInputs: TableFactImageRow[] = imageRows.map((image, i) => ({
    id: image.id,
    pageNumber: image.page_number as number,
    sourceKind: image.source_kind as string,
    tableTitle: null,
    tableLabel: null,
    tableRole: null,
    accessibleTableMarkdown: null,
    tableRows: tables.find((t) => t.imageOrdinal === i + 1)?.rows,
    tableColumns: tables.find((t) => t.imageOrdinal === i + 1)?.rows[0],
  }));
  const featureCoverage = {
    renderedPages: "complete",
    reviewedText: "complete",
    reviewedTables: tables.length ? "complete" : "not_present",
    reviewedDiagrams: accepted.reviewedDiagrams.length ? "complete" : "not_present",
    nativeLayer: "excluded_from_admitted_evidence",
    ocr: "complete",
  };
  const { rows, quality, embeddingUnits } = buildManagedPdfRowPlan({
    job,
    issued,
    extracted,
    imageRows,
    imageInputs,
    imageMetadata: capturedImages.map((c) => c.descriptor.metadata ?? {}),
    metadata,
    featureCoverage,
    profileId: RENDERED_FULL_PDF_PROFILE,
  });
  // Each derivative keeps the exact page's review provenance, without inventing native-v2 evidence.
  for (const row of rows.chunks)
    row.metadata = {
      ...(row.metadata as Record<string, unknown>),
      ...extracted.pages[(row.page_number as number) - 1]!.metadata,
    };
  // Conservative observation time tolerates small worker/database clock skew.
  // It never precedes the approved review, and only shortens the validity window;
  // the source and retained bytes above were still checked during this preparation.
  const inspectedAt = new Date(Math.max(Date.now() - 1000, Date.parse(review.reviewer.reviewedAt))).toISOString();
  const inspection = {
    version: "managed-rendered-pdf-inspection-view-v1",
    sourceSha256: review.sourceSha256,
    sourceByteLength: review.sourceByteLength,
    pageCount: review.pageCount,
    verificationScope: review.verificationScope,
    binding: structuredClone(binding),
    reviewSha256,
    reviewRecord: review,
    inspectedAt,
    expiresAt: new Date(Date.parse(inspectedAt) + 24 * 60 * 60 * 1000).toISOString(),
    nativeLayerDisposition: review.nativeLayerDisposition,
    originalNativeConflict: review.originalNativeConflict,
    pages: extracted.pages.map((p, i) => ({
      pageNumber: p.pageNumber,
      text: p.text,
      ocrUsed: true,
      sourceProvenanceSha256: generationEvidenceDigest(p.metadata ?? {}),
      renderSha256: review.pages[i]!.render.sha256,
      ocrTextSha256: review.pages[i]!.ocrTextSha256,
    })),
    images: capturedImages.map((c) => ({
      ordinal: c.ordinal,
      pageNumber: c.descriptor.pageNumber,
      sourceKind: c.descriptor.sourceKind,
      sha256: c.sha256,
      byteLength: c.byteLength,
      width: c.descriptor.width,
      height: c.descriptor.height,
      descriptorSha256: generationEvidenceDigest(c.descriptor),
      metadataSha256: generationEvidenceDigest(c.descriptor.metadata ?? {}),
    })),
    tables,
    diagrams: accepted.reviewedDiagrams.map(({ pageNumber, diagram }) => ({
      pageNumber,
      reviewedDiagramId: diagram.id,
      region: diagram.region,
      nodes: diagram.nodes,
      edges: diagram.edges,
      renderSha256: review.pages[pageNumber - 1]!.render.sha256,
    })),
    featureCoverage,
  };
  const packet = {
    version: "managed-rendered-pdf-packet-v1",
    profileId: RENDERED_FULL_PDF_PROFILE,
    identity: {
      ...issued,
      documentOwnerId: job.documents.owner_id,
      stewardId: input.stewardId,
      sourceSha256: review.sourceSha256,
      sourceByteLength: review.sourceByteLength,
      sourceExpectationDigest: input.retentionPacket.registration.sourceExpectationSha256,
    },
    inspection,
    rows,
    quality,
    deferredOptionalFamilies: ["model_summary", "vision_interpretation", "clinical_semantic_signoff"],
    clinicalApproval: "not_granted",
    publicationApproval: "not_granted",
  };
  if (
    generationEvidenceBytes(packet).length > 48 * 1024 * 1024 ||
    Object.values(rows).reduce((n, r) => n + r.length, 0) > 20000
  )
    refuse("packet_budget_exceeded");
  return freezeGenerationEvidence({ planDigest: generationEvidenceDigest(packet), packet, embeddingUnits });
}
export type ManagedRenderedPdfPlan = Awaited<ReturnType<typeof prepareManagedRenderedPdfGeneration>>;
