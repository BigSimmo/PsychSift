/** Whole inspected PDF generation. Structural coverage is not clinical approval. */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  parseIssuedAttemptControl,
  originalApplicabilityFamilies,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
  type IssuedAttemptControl,
} from "../src/lib/ingestion-generation-evidence";
import { EMBEDDING_MAX_INPUT_UTF8_BYTES, batchEmbeddingInputs } from "../src/lib/embedding-input-budget";
import { assertEmbeddingDim } from "../src/lib/embedding-dimensions";
import { assessDocumentIndexQuality } from "../src/lib/index-quality";
import { assertLegacyIndexPromotion } from "./legacy-index-promotion";
import { buildDocumentSections, buildDocumentMemoryCards } from "../src/lib/deep-memory-preparation";
import { buildDocumentIndexUnitInputs, embeddingTextForDocumentIndexUnit } from "../src/lib/document-index-units";
import type { ExtractedDocument } from "../src/lib/types";
import type { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { buildTableFactRows, type TableFactImageRow } from "./table-facts";
import { buildAdditionalEmbeddingFieldInputs } from "./embedding-fields";
import { committedJson } from "./managed-vector-final";
import type { CapturedGenerationImage, buildGenerationRetentionPacket } from "./generation-evidence";
import { inspectRichPdfSource, type RichPdfInspectionReview } from "./rich-pdf-inspection";
import type { ManagedProviderEmbeddingBatchContext } from "./managed-provider-vectors";
import type { JobRow } from "./types";

export const FULL_PDF_PROFILE = "administrator-inspected-full-pdf-v1" as const;
/** Requirements come from the independent original-source feature inventory.
 * Derivative producer output counts are deliberately absent from this witness. */
export function buildInternalRichPdfExpectation(originalBytes: Buffer, input: RichPdfInspectionReview) {
  const review = inspectRichPdfSource(input, originalBytes, input.binding);
  const pageIds: string[] = [],
    visualIds: string[] = [],
    tableIds: string[] = [];
  const units: NonNullable<SourceExpectation["units"]> = [];
  for (const page of review.sourceInventory) {
    const id = `source-page-${page.pageNumber}`;
    pageIds.push(id);
    units.push({
      id,
      required: true,
      dependencies: [],
      locator: `pdf-page:${page.pageNumber}:original-native:${page.nativeTextSha256}`,
      nativeMapping: "unavailable",
    });
    for (const [family, boxes] of [
      ["raster", page.rasterBboxes],
      ["figure", page.vectorBboxes],
      ["table", page.tableBboxes],
    ] as const)
      for (const [index, box] of boxes.entries()) {
        const featureId = `${id}-${family}-${index}`;
        visualIds.push(featureId);
        if (family === "table") tableIds.push(featureId);
        units.push({
          id: featureId,
          required: true,
          dependencies: [id],
          locator: `pdf-page:${page.pageNumber}:${family}:${index}:${generationEvidenceDigest(box)}`,
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
        family === "chunks" ? pageIds : family === "images" ? visualIds : family === "table_facts" ? tableIds : [];
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
      reference: "independent-original-rich-pdf-structural-inventory-v1",
      sha256: bytesDigest(sourceExpectationWitnessBytes),
    },
    limitation: null,
  };
  return { sourceExpectation, sourceExpectationWitnessBytes };
}
type Row = Record<string, unknown> & { id: string };
export type FullPdfRows = {
  chunks: Row[];
  images: Row[];
  table_facts: Row[];
  embedding_fields: Row[];
  index_units: Row[];
  sections: Row[];
  memory_cards: Row[];
};
export type FullPdfInput = {
  job: JobRow;
  issued: IssuedAttemptControl;
  retentionPacket: ReturnType<typeof buildGenerationRetentionPacket>;
  originalBytes: Buffer;
  review: RichPdfInspectionReview;
  extracted: ExtractedDocument;
  capturedImages: readonly CapturedGenerationImage[];
  stewardId: string;
};
function refuse(reason: string): never {
  throw new Error(`managed_full_pdf_${reason}`);
}
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
function rowId(doc: string, generation: string, family: string, index: number, profile: string = FULL_PDF_PROFILE) {
  const b = createHash("sha256")
    .update(generationEvidenceBytes([profile, doc, generation, family, index]))
    .digest()
    .subarray(0, 16);
  b[6] = (b[6] & 15) | 80;
  b[8] = (b[8] & 63) | 128;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function partitions(text: string): string[] {
  if (!text.trim()) {
    if (text.length) refuse("whitespace_only_page_unsupported");
    return [];
  }
  if (!text.isWellFormed()) refuse("invalid_source_utf8");
  const bytes = Buffer.from(text);
  const trimmed = text.trimEnd();
  let last = trimmed.length - 1;
  if (/[\uDC00-\uDFFF]/.test(trimmed[last])) last--;
  const lastStart = Buffer.byteLength(text.slice(0, last)),
    lastEnd = Buffer.byteLength(trimmed);
  if (bytes.length - lastStart > EMBEDDING_MAX_INPUT_UTF8_BYTES) refuse("whitespace_tail_exceeds_embedding_budget");
  const output: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + EMBEDDING_MAX_INPUT_UTF8_BYTES);
    while (end < bytes.length && (bytes[end] & 192) === 128) end--;
    if (end >= lastEnd && end < bytes.length)
      end = bytes.length - start <= EMBEDDING_MAX_INPUT_UTF8_BYTES ? bytes.length : lastStart;
    if (end <= start) refuse("invalid_text_partition");
    const value = bytes.subarray(start, end).toString("utf8");
    if (!value.trim()) refuse("empty_embedding_partition");
    output.push(value);
    start = end;
  }
  return output;
}

/** Shared derivative algorithms; caller supplies independently validated source evidence. */
export function buildManagedPdfRowPlan(input: {
  job: JobRow;
  issued: IssuedAttemptControl;
  extracted: ExtractedDocument;
  imageRows: FullPdfRows["images"];
  imageInputs: TableFactImageRow[];
  imageMetadata: readonly Record<string, unknown>[];
  metadata: Record<string, unknown>;
  featureCoverage: unknown;
  profileId: string;
}) {
  const { job, issued, extracted, imageRows, imageInputs, metadata } = input;
  const chunks: Row[] = [];
  for (const page of extracted.pages)
    for (const content of partitions(page.text)) {
      const i = chunks.length;
      chunks.push({
        id: rowId(job.document_id, issued.generationId, "chunks", i, input.profileId),
        document_id: job.document_id,
        index_generation_id: issued.generationId,
        page_number: page.pageNumber,
        chunk_index: i,
        section_heading: null,
        section_path: [],
        heading_level: null,
        parent_heading: null,
        anchor_id: null,
        content,
        retrieval_synopsis: null,
        token_estimate: Math.ceil(Buffer.byteLength(content) / 4),
        image_ids: imageRows.filter((r) => r.page_number === page.pageNumber).map((r) => r.id),
        content_hash: createHash("sha256").update(content).digest("hex"),
        metadata: { ...metadata, ocr_used: Boolean(page.ocrUsed) },
      });
    }
  const typedChunks = chunks.map((r) => ({
    id: r.id,
    document_id: job.document_id,
    page_number: r.page_number as number,
    chunk_index: r.chunk_index as number,
    section_heading: null,
    section_path: [],
    content: r.content as string,
    image_ids: r.image_ids as string[],
    metadata: r.metadata as Record<string, unknown>,
  }));
  const facts = buildTableFactRows({ job, chunkRows: typedChunks, insertedImages: imageInputs }).map((row, i) => ({
    ...row,
    id: rowId(job.document_id, issued.generationId, "table_facts", i, input.profileId),
    index_generation_id: issued.generationId,
    metadata: { ...row.metadata, ...metadata },
  }));
  const document = {
    id: job.document_id,
    owner_id: job.documents.owner_id,
    title: job.documents.title,
    file_name: job.documents.file_name,
    source_path: job.documents.source_path ?? null,
  };
  const builtSections = buildDocumentSections({ document, chunks: typedChunks });
  const sections = builtSections.map((row, i) => ({
    ...row,
    id: rowId(job.document_id, issued.generationId, "sections", i, input.profileId),
    index_generation_id: issued.generationId,
    producer: "local-worker",
    artifact_generation_id: issued.generationId,
    metadata: { ...row.metadata, ...metadata },
  }));
  const memory = buildDocumentMemoryCards({ document, chunks: typedChunks, sections: builtSections }).map((row, i) => ({
    ...row,
    id: rowId(job.document_id, issued.generationId, "memory_cards", i, input.profileId),
    section_id: typeof row.section_index === "number" ? (sections[row.section_index]?.id ?? null) : null,
    index_generation_id: issued.generationId,
    producer: "local-worker",
    artifact_generation_id: issued.generationId,
    metadata: { ...row.metadata, ...metadata },
  }));
  const fields = buildAdditionalEmbeddingFieldInputs({
    job,
    chunkRows: typedChunks,
    insertedImages: imageInputs,
    tableFacts: facts,
  }).map((row, i) => ({
    ...row,
    id: rowId(job.document_id, issued.generationId, "embedding_fields", i, input.profileId),
    // Existing table trigger owns this legacy MD5 content identifier; byte/source
    // commitments elsewhere remain SHA256. Match its actual persisted value.
    content_hash: createHash("md5").update(row.content).digest("hex"),
    index_generation_id: issued.generationId,
    metadata: { ...row.metadata, ...metadata },
  }));
  const units = buildDocumentIndexUnitInputs({
    document,
    chunks: typedChunks,
    sections: builtSections,
    tableFacts: facts,
  }).map((row, i) => ({
    ...row,
    id: rowId(job.document_id, issued.generationId, "index_units", i, input.profileId),
    index_generation_id: issued.generationId,
    producer: "local-worker",
    artifact_generation_id: issued.generationId,
    metadata: { ...row.metadata, ...metadata },
  }));
  const rows: FullPdfRows = {
    chunks,
    images: imageRows,
    table_facts: facts,
    embedding_fields: fields,
    index_units: units,
    sections,
    memory_cards: memory,
  };
  const qualityImages = imageInputs
    .map((image, index) => ({
      sourceKind: image.sourceKind,
      tableRows: image.tableRows,
      metadata: input.imageMetadata[index] ?? {},
      searchable: imageRows[index].searchable === true,
    }))
    .filter((image) => image.searchable);
  assertLegacyIndexPromotion({ extracted, chunks: typedChunks, insertedImages: qualityImages });
  const observedMetrics = {
    page_count: extracted.pages.length,
    text_character_count: extracted.pages.reduce((n, page) => n + page.text.length, 0),
    extracted_image_count: extracted.images.length,
    searchable_image_count: qualityImages.length,
    ocr_page_count: extracted.pages.filter((page) => page.ocrUsed).length,
    needs_ocr_page_count: extracted.pages.filter((page) => page.needsOcr).length,
  };
  const assessed = assessDocumentIndexQuality({
    metrics: observedMetrics,
    chunks: typedChunks,
    insertedImages: qualityImages,
    sectionCount: sections.length,
    memoryCardCount: memory.length,
    documentEmbeddingFieldTypes: fields.map((field) => field.field_type),
    includeOptionalEnrichment: false,
  });
  const quality = {
    quality_score: assessed.qualityScore,
    extraction_quality: assessed.extractionQuality,
    issues: assessed.issues,
    metrics: {
      ...observedMetrics,
      ...assessed.metrics,
      quality_assessment_version: "existing-core-index-quality-v1",
      feature_coverage: input.featureCoverage,
      semantic_approval: "not_assessed",
      optional_model_interpretation: "deferred",
    },
  };
  const embeddingUnits = [
    ...chunks.map((r) => ({ family: "chunks" as const, id: r.id, text: r.content as string })),
    ...fields.map((r) => ({ family: "embedding_fields" as const, id: r.id, text: r.content })),
    ...units.map((r) => ({ family: "index_units" as const, id: r.id, text: embeddingTextForDocumentIndexUnit(r) })),
    ...memory.map((r) => ({ family: "memory_cards" as const, id: r.id, text: r.content })),
  ];
  batchEmbeddingInputs(
    embeddingUnits.map((u) => u.text),
    128,
    "text-embedding-3-small",
  );
  return { rows, quality, embeddingUnits };
}

export function prepareManagedFullPdfGeneration(input: FullPdfInput) {
  const issued = parseIssuedAttemptControl(input.issued);
  const { job, extracted } = input;
  const review = inspectRichPdfSource(input.review, input.originalBytes, input.review.binding);
  if (
    job.document_id !== issued.documentId ||
    job.id !== issued.jobId ||
    job.lease_write_generation_id !== issued.generationId ||
    review.binding.jobId !== job.id ||
    review.binding.generationId !== issued.generationId ||
    review.binding.leaseId !== issued.firstLeaseToken ||
    review.binding.authorityDigest !== issued.authorityDigest ||
    input.retentionPacket.registration.sourceSha256 !== review.sourceSha256 ||
    extracted.pages.length !== review.pages.length ||
    input.capturedImages.length !== review.images.length ||
    extracted.images.length !== review.images.length
  )
    refuse("identity_or_inventory_mismatch");
  z.uuid().parse(input.stewardId);
  for (const [index, page] of extracted.pages.entries())
    if (
      page.pageNumber !== index + 1 ||
      page.text !== review.pages[index].text ||
      Boolean(page.ocrUsed) !== review.pages[index].ocrUsed ||
      generationEvidenceDigest(page.metadata?.source_provenance ?? {}) !== review.pages[index].sourceProvenanceSha256
    )
      refuse("page_fidelity_mismatch");
  const metadata = {
    index_generation_id: issued.generationId,
    artifact_generation_id: issued.generationId,
    source_sha256: review.sourceSha256,
    full_pdf_profile: FULL_PDF_PROFILE,
    inspection_scope: review.verificationScope,
  };
  const imageRows: Row[] = input.capturedImages.map((capture, index) => {
    const inspected = review.images[index];
    if (
      capture.ordinal !== index + 1 ||
      capture.sha256 !== inspected.sha256 ||
      capture.byteLength !== inspected.byteLength ||
      bytesDigest(Buffer.from(capture.bytesHex, "hex")) !== capture.sha256 ||
      generationEvidenceDigest(capture.descriptor) !== inspected.descriptorSha256 ||
      generationEvidenceDigest(capture.descriptor.metadata ?? {}) !== inspected.metadataSha256
    )
      refuse("image_fidelity_mismatch");
    return {
      id: rowId(job.document_id, issued.generationId, "images", index),
      document_id: job.document_id,
      index_generation_id: issued.generationId,
      page_number: inspected.pageNumber,
      storage_path: `managed-pdf/${job.document_id}/${issued.generationId}/${capture.ordinal}`,
      mime_type: capture.descriptor.mimeType ?? "image/png",
      caption: "",
      image_type: inspected.sourceKind === "table_crop" ? "clinical_table" : "unclear",
      searchable: inspected.sourceKind !== "cover_page",
      clinical_relevance_score: 0,
      source_kind: inspected.sourceKind,
      width: inspected.width,
      height: inspected.height,
      image_hash: inspected.sha256.slice(7),
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
    };
  });
  const imageInputs: TableFactImageRow[] = imageRows.map((image, index) => {
    const source = review.tables.find((table) => table.imageOrdinal === index + 1);
    const m = input.capturedImages[index].descriptor.metadata ?? {};
    return {
      id: image.id,
      pageNumber: image.page_number as number,
      sourceKind: image.source_kind as string,
      tableRows: source?.rows,
      tableColumns: source?.rows[0],
      tableTitle: typeof m.table_title === "string" ? m.table_title : null,
      tableLabel: typeof m.table_label === "string" ? m.table_label : null,
      tableRole: typeof m.table_role === "string" ? m.table_role : null,
      accessibleTableMarkdown: typeof m.accessible_table_markdown === "string" ? m.accessible_table_markdown : null,
      tableMergedCells: Array.isArray(m.table_merged_cells) ? (m.table_merged_cells as [number, number][]) : undefined,
      tableRowBreaks: Array.isArray(m.table_row_breaks) ? (m.table_row_breaks as number[]) : undefined,
    };
  });
  const { rows, quality, embeddingUnits } = buildManagedPdfRowPlan({
    job,
    issued,
    extracted,
    imageRows,
    imageInputs,
    metadata,
    imageMetadata: input.capturedImages.map((image) => image.descriptor.metadata ?? {}),
    featureCoverage: review.featureCoverage,
    profileId: FULL_PDF_PROFILE,
  });
  const identity = {
    ...issued,
    documentOwnerId: job.documents.owner_id,
    stewardId: input.stewardId,
    sourceSha256: review.sourceSha256,
    sourceByteLength: review.sourceByteLength,
    sourceExpectationDigest: input.retentionPacket.registration.sourceExpectationSha256,
  };
  const packet = {
    version: "managed-full-pdf-packet-v1",
    profileId: FULL_PDF_PROFILE,
    identity,
    inspection: review,
    rows,
    quality,
    deferredOptionalFamilies: ["model_summary", "vision_interpretation", "clinical_semantic_signoff"],
    clinicalApproval: "not_granted",
    publicationApproval: "not_granted",
  };
  const planDigest = generationEvidenceDigest(packet);
  if (
    generationEvidenceBytes(packet).length > 48 * 1024 * 1024 ||
    Object.values(rows).reduce((n, r) => n + r.length, 0) > 20000
  )
    refuse("packet_budget_exceeded");
  return freezeGenerationEvidence({ planDigest, packet, embeddingUnits });
}

export type ManagedFullPdfPlan = ReturnType<typeof prepareManagedFullPdfGeneration>;
/** Common executor shape: distinct inspection/profile packets keep their own validators. */
export type ManagedPdfExecutionPlan = {
  planDigest: string;
  packet: {
    identity: ManagedFullPdfPlan["packet"]["identity"];
    rows: FullPdfRows;
    [key: string]: unknown;
  };
  embeddingUnits: ManagedFullPdfPlan["embeddingUnits"];
};
export async function runManagedFullPdfGeneration(args: {
  plan: ManagedPdfExecutionPlan;
  attempt: IngestionAttempt;
  embed: (texts: string[], context: ManagedProviderEmbeddingBatchContext) => Promise<number[][]>;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  stopHeartbeat: () => void;
  rpc: (
    name: string,
    payload: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const packet = JSON.parse(generationEvidenceBytes(args.plan.packet).toString("utf8")) as typeof args.plan.packet;
  const rendered =
    packet.version === "managed-rendered-pdf-packet-v1" &&
    packet.profileId === "administrator-reviewed-rendered-full-pdf-v1";
  const native =
    packet.profileId === FULL_PDF_PROFILE &&
    (packet.version === "managed-full-pdf-packet-v1" ||
      (packet.version === "managed-full-pdf-packet-v2" &&
        z
          .object({
            version: z.literal("managed-pdf-summary-projection-v1"),
            summary: z.record(z.string(), z.unknown()),
            labels: z.array(z.record(z.string(), z.unknown())),
          })
          .strict()
          .safeParse(packet.summaryProjection).success));
  if (!rendered && !native) refuse("packet_profile_unsupported");
  for (let start = 0; start < args.plan.embeddingUnits.length; start += 32) {
    args.attempt.check();
    const batch = args.plan.embeddingUnits.slice(start, start + 32);
    const context = {
      planDigest: args.plan.planDigest,
      units: batch.map((u) => ({ unitId: { family: u.family, key: u.id }, providerInputText: u.text })),
    };
    const vectors = await args.embed(
      batch.map((u) => u.text),
      context,
    );
    if (vectors.length !== batch.length) refuse("embedding_population_mismatch");
    for (const [index, u] of batch.entries()) {
      const row = packet.rows[u.family].find((r) => r.id === u.id);
      if (!row) refuse("embedding_row_missing");
      row.embedding = assertEmbeddingDim(vectors[index], `managed_full_pdf.${u.family}.${u.id}`);
    }
  }
  args.attempt.check();
  const staged = await args.mutation("stage_managed_full_pdf", {
    p_generation: packet.identity.generationId,
    p_packet: packet,
  });
  if (
    staged.ok !== true ||
    typeof staged.packetDigest !== "string" ||
    !same(
      committedJson(z.object({ bytesHex: z.string(), sha256: z.string(), byteLength: z.number() }).parse(staged.packet))
        .body,
      packet,
    )
  )
    refuse("stage_readback_mismatch");
  args.stopHeartbeat();
  return args.attempt.serialize(async () => {
    const dispatch = async (readOnly: boolean) => {
      const response = await args.rpc("complete_managed_full_pdf", {
        p_fence: args.attempt.fence,
        p_generation: packet.identity.generationId,
        p_packet_digest: staged.packetDigest,
        p_read_only: readOnly,
      });
      if (response.error) throw new Error(response.error.message);
      const r = z
        .object({
          ok: z.literal(true),
          managedFullPdfTerminal: z
            .object({
              activated: z.literal(true),
              replay: z.enum(["completed", "already_completed"]),
              seal: z.object({ bytesHex: z.string(), sha256: z.string(), byteLength: z.number() }).strict(),
            })
            .strict(),
        })
        .strict()
        .parse(response.data);
      const seal = committedJson(r.managedFullPdfTerminal.seal).body as Record<string, unknown>;
      if (
        seal.version !== (rendered ? "managed-rendered-pdf-seal-v1" : "managed-full-pdf-seal-v1") ||
        seal.packetDigest !== staged.packetDigest ||
        !same(seal.identity, packet.identity) ||
        seal.publicationApproval !== "not_granted" ||
        seal.clinicalApproval !== "not_granted"
      )
        refuse("terminal_readback_mismatch");
      if (rendered) {
        const inspection = packet.inspection as Record<string, unknown>;
        const record = inspection.reviewRecord as { reviewer: unknown };
        if (
          seal.profileId !== packet.profileId ||
          seal.inspectionScope !== inspection.verificationScope ||
          seal.reviewSha256 !== inspection.reviewSha256 ||
          !same(seal.reviewer, record.reviewer) ||
          seal.nativeLayerDisposition !== "excluded_from_admitted_evidence" ||
          seal.originalNativeConflict !== "unresolved" ||
          seal.sourceSha256 !== packet.identity.sourceSha256 ||
          seal.sourceByteLength !== packet.identity.sourceByteLength
        )
          refuse("terminal_rendered_review_mismatch");
      }
      return r;
    };
    try {
      args.attempt.check();
      let write: Awaited<ReturnType<typeof dispatch>> | undefined;
      try {
        write = await dispatch(false);
      } catch {
        /* strict completed read only */
      }
      const read = await dispatch(true);
      if (write && !same(write.managedFullPdfTerminal.seal, read.managedFullPdfTerminal.seal))
        refuse("terminal_replay_mismatch");
      return read;
    } finally {
      args.attempt.cancel();
    }
  });
}
