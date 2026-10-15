import { z } from "zod";
import {
  generationEvidenceDigest,
  parseGenerationArtifact,
  parseRetainedImageDescriptor,
  unitIdentity,
} from "../src/lib/ingestion-generation-evidence";
import type { buildGenerationRetentionPacket } from "./generation-evidence";

const uuid = z.uuid();
type RetentionPacket = ReturnType<typeof buildGenerationRetentionPacket>;
function fail(): never {
  throw new Error("candidate_chunks_identity_mismatch");
}

export const preparedRowSchema = z
  .object({
    id: uuid,
    document_id: uuid,
    page_number: z.number().int().positive().safe().nullable(),
    chunk_index: z.number().int().nonnegative().safe(),
    section_heading: z.string().nullable(),
    section_path: z.array(z.string()),
    heading_level: z.number().int().nullable(),
    parent_heading: z.string().nullable(),
    anchor_id: z.string().nullable(),
    content: z.string().min(1),
    retrieval_synopsis: z.string().nullable(),
    token_estimate: z.number().int().nonnegative().safe(),
    image_ids: z.array(uuid),
    content_hash: z.string(),
    index_generation_id: uuid,
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CandidateChunkRow = z.infer<typeof preparedRowSchema>;

/** Private rows have no public storage locator and make no caption/classification claim. */
export const candidateImageRowSchema = z
  .object({
    id: uuid,
    document_id: uuid,
    owner_id: uuid,
    index_generation_id: uuid,
    page_number: z.number().int().positive().safe(),
    capture_ordinal: z.number().int().positive().safe(),
    caption: z.null(),
    image_type: z.null(),
    labels: z.null(),
    clinical_relevance_score: z.null(),
    source_kind: z.string(),
    descriptor: z.unknown(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
export const candidateTableFactRowSchema = z
  .object({
    id: uuid,
    document_id: uuid,
    owner_id: uuid,
    index_generation_id: uuid,
    source_chunk_id: uuid,
    source_image_id: uuid,
    page_number: z.number().int().positive().safe(),
    table_title: z.string().nullable(),
    row_label: z.string().nullable(),
    clinical_parameter: z.string().nullable(),
    threshold_value: z.string().nullable(),
    action: z.string().nullable(),
    normalized_terms: z.array(z.string()),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CandidateImageRow = z.infer<typeof candidateImageRowSchema>;
export type CandidateTableFactRow = z.infer<typeof candidateTableFactRowSchema>;

export function retainedCandidateImages(packet: RetentionPacket) {
  return packet.artifacts
    .filter((artifact) => artifact.representation === "image_provenance")
    .map((artifact) => {
      const checked = parseGenerationArtifact(artifact);
      const body = JSON.parse(Buffer.from(checked.bytesHex, "hex").toString("utf8"));
      const descriptor = parseRetainedImageDescriptor(body.descriptor);
      const ordinal = Number(body.placementId);
      const binary = packet.artifacts.find(
        (item) => item.unitId.family === "private_objects" && item.unitId.key === `image:${ordinal}:binary`,
      );
      const declarations = [...packet.registration.declarations.units, ...packet.declarations.units].filter(
        (item) => unitIdentity(item.id) === unitIdentity(checked.unitId),
      );
      const declaration = declarations.length === 1 ? declarations[0] : undefined;
      if (
        !binary ||
        !declaration ||
        !Number.isSafeInteger(ordinal) ||
        ordinal < 1 ||
        binary.representation !== "image_binary" ||
        checked.unitId.family !== "private_objects" ||
        checked.unitId.key !== `image:${ordinal}:provenance` ||
        declaration.groupKey !== "private_objects" ||
        declaration.qualification !== "derived_unverified" ||
        declaration.representation !== "image_provenance" ||
        body.documentId === undefined ||
        body.generationId !== packet.generationId ||
        body.sourceSha256 !== packet.registration.sourceExpectation.sourceSha256 ||
        body.qualification !== "derived_unverified" ||
        body.version !== 1 ||
        generationEvidenceDigest(body.binary) !==
          generationEvidenceDigest({ unitId: binary.unitId, sha256: binary.sha256, byteLength: binary.byteLength })
      )
        fail();
      parseGenerationArtifact(binary);
      return {
        ordinal,
        descriptor,
        documentId: body.documentId as string,
        binary,
        provenance: checked,
        sourceEvidenceIds: declaration.sourceEvidenceIds,
      };
    });
}
