import { z } from "zod";
import { decodeAdminReferencePreparationEvidence } from "../src/lib/admin-reference-preparation-receipt";
import { assertAustralianPublicActivationMetadata } from "../src/lib/publication-manifest";
import { isPublicDocument } from "../src/lib/documents/is-public-document";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceDigest,
  parseOriginalApplicabilityWitness,
  parseSourceExpectation,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { decodeRetainedOriginalWitness } from "./original-witness-readback";
import type { ManagedAdminTextSourceSectionLayout } from "../src/lib/admin-text-source-section-layout";

const uuid = z.uuid();
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const rowSchema = z
  .object({
    id: uuid,
    document_id: uuid,
    index_generation_id: uuid,
    content: z.string(),
    content_hash: z.string().regex(/^[0-9a-f]{64}$/),
    section_heading: z.string().nullable(),
    section_path: z.array(z.string()),
    parent_heading: z.string().nullable(),
    anchor_id: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .passthrough();
const publicationSchema = z
  .object({
    approvalId: uuid,
    manifestVersion: z.literal(2),
    manifestDigest: z.string().regex(/^[0-9a-f]{64}$/),
    reviewedStateDigest: z.string().regex(/^[0-9a-f]{64}$/),
    reviewedIndexGenerationId: uuid,
    sourceCatalogueKey: z.literal("nhmrc"),
    sourcePolicyVersion: z.string(),
    approvingOperatorId: uuid,
    approvedAt: z.string().datetime({ offset: true }),
    preparationReceiptSha256: digest,
  })
  .strict() satisfies z.ZodType<PublishedAdminSectionProjection["publication"]>;
const replySchema = z
  .object({
    version: z.literal("published-admin-text-source-layout-v1"),
    provenanceOwnerId: uuid,
    document: z
      .object({
        owner_id: z.null(),
        status: z.literal("indexed"),
        index_generation_id: uuid,
        metadata: z.record(z.string(), z.unknown()),
      })
      .strict(),
    publication: publicationSchema,
    evidenceReferences: z.array(z.string().min(1).max(500)).min(1).max(50),
    preparationReceipt: z
      .object({
        bytesHex: z
          .string()
          .regex(/^(?:[0-9a-f]{2})+$/)
          .max(27000),
        sha256: digest,
      })
      .strict(),
    documentId: uuid,
    generationId: uuid,
    requesterId: uuid,
    original: z
      .object({
        bytesHex: z
          .string()
          .regex(/^(?:[0-9a-f]{2})+$/)
          .max(4194304),
        sha256: digest,
        byteLength: z.number().int().min(1).max(2097152),
      })
      .strict(),
    inventory: z.unknown(),
    rows: z.array(rowSchema).min(1).max(6),
  })
  .strict();

import type {
  PublishedAdminSectionProjection,
  PublishedAdminSectionRequest,
} from "./published-admin-source-layout-contract";
export type {
  PublishedAdminSectionProjection,
  PublishedAdminSectionRequest,
} from "./published-admin-source-layout-contract";

type Reader = (
  name: "read_published_admin_text_source_layout",
  args: {
    p_requester_id: string;
    p_document_id: string;
    p_generation: string;
    p_publication_approval_id: string;
    p_chunk_ids: string[];
  },
) => PromiseLike<{ data: unknown; error: unknown }>;
function refuse(reason: string): never {
  throw new Error(`published_admin_source_layout_${reason}`);
}
function literal(bytes: Buffer) {
  try {
    const text = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(text, "utf8").equals(bytes)) return refuse("utf8");
    return text;
  } catch {
    return refuse("utf8");
  }
}
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
const detach = <T>(value: T): T => JSON.parse(generationEvidenceBytes(value).toString("utf8")) as T;

/**
 * Configure only from an independently authorized server/pilot scope and frozen original plan.
 * This reads actual V2 publication and preparation evidence; it never claims a private owner lease.
 * A matching DTO or metadata cannot substitute for this actual RPC read.
 */
export function createPublishedAdminTextSectionLayoutLoader(args: {
  requesterId: string;
  documentId: string;
  sourceExpectation: SourceExpectation;
  sourceSectionLayout: ManagedAdminTextSourceSectionLayout;
  rpc: Reader;
}) {
  const requesterId = uuid.parse(args.requesterId),
    documentId = uuid.parse(args.documentId);
  const expectation = parseSourceExpectation(detach(args.sourceExpectation));
  const layout = detach(args.sourceSectionLayout);
  const rpc = args.rpc;
  if (
    expectation.tag !== "known" ||
    expectation.units?.length !== 6 ||
    layout.units.length !== 6 ||
    expectation.sourceSha256 !== layout.sourceSha256 ||
    !digest.safeParse(layout.sourceSha256).success
  )
    return refuse("independent_plan");

  return async (input: PublishedAdminSectionRequest): Promise<PublishedAdminSectionProjection> => {
    input.signal?.throwIfAborted();
    if (
      input.requesterId !== requesterId ||
      input.documentId !== documentId ||
      !uuid.safeParse(input.expectedIndexGenerationId).success ||
      !uuid.safeParse(input.publicationApprovalId).success ||
      input.selectedResults.length < 1 ||
      input.selectedResults.length > 6
    )
      return refuse("scope");
    const expectedGeneration = input.expectedIndexGenerationId;
    const selected = input.selectedResults.map((row) => {
      if (!uuid.safeParse(row.id).success || row.document_id !== documentId || typeof row.content !== "string")
        return refuse("selected_identity");
      const metadata = row.source_metadata;
      if (
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata) ||
        (metadata as Record<string, unknown>).index_generation_id !== expectedGeneration
      )
        return refuse("selected_generation");
      return detach({
        id: row.id,
        content: row.content,
        section_heading: row.section_heading,
        section_path: row.section_path ?? [],
        parent_heading: row.parent_heading ?? null,
        anchor_id: row.anchor_id ?? null,
      });
    });
    if (new Set(selected.map((r) => r.id)).size !== selected.length) return refuse("selected_duplicate");
    const result = await rpc("read_published_admin_text_source_layout", {
      p_requester_id: requesterId,
      p_document_id: documentId,
      p_generation: expectedGeneration,
      p_publication_approval_id: input.publicationApprovalId,
      p_chunk_ids: selected.map((r) => r.id),
    });
    input.signal?.throwIfAborted();
    if (result.error) return refuse("reader_refused");
    if (generationEvidenceBytes(result.data).length > 8388608) return refuse("response_bound");
    const reply = replySchema.parse(detach(result.data));
    if (
      reply.requesterId !== requesterId ||
      reply.documentId !== documentId ||
      reply.generationId !== expectedGeneration ||
      reply.rows.length !== selected.length ||
      reply.original.bytesHex.length !== reply.original.byteLength * 2
    )
      return refuse("reply_identity");
    if (
      reply.document.index_generation_id !== expectedGeneration ||
      reply.publication.approvalId !== input.publicationApprovalId ||
      reply.publication.reviewedIndexGenerationId !== expectedGeneration ||
      !isPublicDocument(reply.document)
    )
      return refuse("publication_identity");
    assertAustralianPublicActivationMetadata(reply.document.metadata, reply.publication.sourceCatalogueKey);
    const preparation = decodeAdminReferencePreparationEvidence(reply.evidenceReferences);
    const receipt = preparation.receipt;
    if (
      preparation.bytes.toString("hex") !== reply.preparationReceipt.bytesHex ||
      preparation.sha256 !== reply.preparationReceipt.sha256 ||
      preparation.sha256 !== reply.publication.preparationReceiptSha256 ||
      receipt.documentId !== documentId ||
      receipt.generationId !== expectedGeneration ||
      receipt.provenanceOwnerId !== reply.provenanceOwnerId ||
      receipt.preparedReviewedStateDigest !== reply.publication.reviewedStateDigest ||
      receipt.delta.source_catalogue_key.afterValue !== reply.publication.sourceCatalogueKey ||
      receipt.delta.source_policy_version.afterValue !== reply.publication.sourcePolicyVersion ||
      receipt.source.sha256 !== expectation.sourceSha256 ||
      receipt.source.expectationDigest !== generationEvidenceDigest(expectation)
    )
      return refuse("preparation_identity");
    const originalBytes = Buffer.from(reply.original.bytesHex, "hex");
    if (bytesDigest(originalBytes) !== reply.original.sha256 || reply.original.sha256 !== expectation.sourceSha256)
      return refuse("original_identity");
    const originalText = literal(originalBytes);
    const inventory = reply.inventory as Record<string, unknown>;
    if (!inventory || !same(inventory.sourceExpectation, expectation)) return refuse("independent_expectation");
    const retained = decodeRetainedOriginalWitness({
      documentId,
      generationId: expectedGeneration,
      originalBytes,
      inventory: reply.inventory,
    });
    if (retained.status !== "retained") return refuse("witness_unavailable");
    const applicability = parseOriginalApplicabilityWitness({
      sourceExpectation: expectation,
      originalBytes,
      witnessBytes: retained.witnessBytes,
    });
    if (applicability.status !== "typed_original_requirements") return refuse("independent_witness");
    const specs = new Map(layout.units.map((unit) => [unit.sourceUnitId, unit]));
    if (specs.size !== 6) return refuse("unit_population");
    let cursor = 0;
    const originalUnits = expectation.units!.map((unit) => {
      const span = /^utf8-bytes:(0|[1-9][0-9]*):([1-9][0-9]*)$/.exec(unit.locator);
      const spec = specs.get(unit.id);
      if (!span || !spec) return refuse("unit_population");
      const start = Number(span[1]),
        end = Number(span[2]);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start !== cursor ||
        start >= end ||
        end > originalBytes.length
      )
        return refuse("unit_partition");
      cursor = end;
      literal(originalBytes.subarray(start, end));
      const hs = spec.headingByteStart,
        he = spec.headingByteEnd;
      if (
        (hs === null) !== (he === null) ||
        (hs !== null &&
          (!Number.isSafeInteger(hs) || !Number.isSafeInteger(he) || hs !== start || he! <= hs || he! > end))
      )
        return refuse("heading_span");
      const heading = hs === null ? null : literal(originalBytes.subarray(hs, he!));
      if (heading !== null && (!heading.trim() || Buffer.byteLength(heading, "utf8") > 512))
        return refuse("heading_span");
      return Object.freeze({
        sourceUnitId: unit.id,
        kind: heading === null ? ("complementary" as const) : ("section" as const),
        utf8Start: start,
        utf8EndExclusive: end,
        section_heading: heading,
        section_path: Object.freeze(heading === null ? [] : [heading]),
        parent_heading: null,
        anchor_id: null,
      });
    });
    if (cursor !== originalBytes.length || originalUnits.filter((u) => u.kind === "section").length !== 3)
      return refuse("unit_partition");
    const storedRows = new Map(reply.rows.map((row) => [row.id, row]));
    if (storedRows.size !== selected.length) return refuse("stored_duplicate");
    const usedUnits = new Set<string>();
    const rowBindings = selected.map((selectedRow) => {
      const row = storedRows.get(selectedRow.id);
      if (
        !row ||
        row.document_id !== documentId ||
        row.index_generation_id !== expectedGeneration ||
        row.content !== selectedRow.content
      )
        return refuse("stored_identity");
      const unit = originalUnits.find((u) => u.sourceUnitId === row.metadata.source_unit_id);
      if (!unit || usedUnits.has(unit.sourceUnitId)) return refuse("stored_unit");
      usedUnits.add(unit.sourceUnitId);
      const spec = specs.get(unit.sourceUnitId)!;
      const expectedFields = {
        section_heading: unit.section_heading,
        section_path: unit.section_path,
        parent_heading: unit.parent_heading,
        anchor_id: unit.anchor_id,
      };
      const storedFields = {
        section_heading: row.section_heading,
        section_path: row.section_path,
        parent_heading: row.parent_heading,
        anchor_id: row.anchor_id,
      };
      const selectedFields = {
        section_heading: selectedRow.section_heading,
        section_path: selectedRow.section_path,
        parent_heading: selectedRow.parent_heading,
        anchor_id: selectedRow.anchor_id,
      };
      if (
        !same(expectedFields, storedFields) ||
        !same(expectedFields, selectedFields) ||
        row.metadata.source_byte_start !== unit.utf8Start ||
        row.metadata.source_byte_end !== unit.utf8EndExclusive ||
        row.metadata.heading_byte_start !== spec.headingByteStart ||
        row.metadata.heading_byte_end !== spec.headingByteEnd ||
        row.metadata.index_generation_id !== expectedGeneration ||
        row.content_hash !== bytesDigest(Buffer.from(row.content, "utf8")).slice(7) ||
        !Buffer.from(row.content, "utf8").equals(originalBytes.subarray(unit.utf8Start, unit.utf8EndExclusive))
      )
        return refuse("stored_source_binding");
      return Object.freeze({ resultId: row.id, sourceUnitId: unit.sourceUnitId });
    });
    input.signal?.throwIfAborted();
    return Object.freeze({
      version: "published-admin-text-section-projection-v1",
      provenanceOwnerId: reply.provenanceOwnerId,
      publication: Object.freeze(detach(reply.publication)),
      requesterId,
      documentId,
      indexGenerationId: expectedGeneration,
      original: Object.freeze({
        sha256: reply.original.sha256 as `sha256:${string}`,
        utf8ByteLength: originalBytes.length,
        exactUtf8Text: originalText,
      }),
      retainedWitness: Object.freeze({
        artifactId: "private_objects:original-source-expectation-witness",
        sha256: bytesDigest(retained.witnessBytes) as `sha256:${string}`,
      }),
      originalUnits: Object.freeze(originalUnits),
      rowBindings: Object.freeze(rowBindings),
    });
  };
}
