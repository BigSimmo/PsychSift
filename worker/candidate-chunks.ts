import { createHash } from "node:crypto";
import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  parseGenerationArtifact,
  parseGenerationDeclarations,
  parseOriginalApplicabilityWitness,
  parseRetainedImageDescriptor,
  unitIdentity,
  type GenerationArtifactInput,
  type GenerationUnitDeclaration,
} from "../src/lib/ingestion-generation-evidence";
import type { DocumentChunk, ExtractedDocument } from "../src/lib/types";
import type { buildGenerationRetentionPacket } from "./generation-evidence";

const uuid = z.uuid();
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
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
type RetentionPacket = ReturnType<typeof buildGenerationRetentionPacket>;
function fail(): never {
  throw new Error("candidate_chunks_identity_mismatch");
}

/** Stable output identity within an immutable candidate, independent of embedding batches. */
export function candidateChunkId(documentId: string, generationId: string, chunkIndex: number) {
  if (
    !uuid.safeParse(documentId).success ||
    !uuid.safeParse(generationId).success ||
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0
  )
    fail();
  const bytes = createHash("sha256")
    .update(JSON.stringify([documentId, generationId, chunkIndex]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type ChunkSanitation = {
  cleanString: (value: string) => string;
  sanitizeJsonbRecord: (value: unknown) => Record<string, unknown>;
};
/** The existing worker row projection, shared by ordinary and managed persistence. */
export function serializeChunkForPersistence(
  chunk: DocumentChunk,
  args: ChunkSanitation & { id: string; generationId: string },
) {
  const { cleanString, sanitizeJsonbRecord } = args;
  return {
    id: args.id,
    document_id: chunk.document_id,
    page_number: chunk.page_number,
    chunk_index: chunk.chunk_index,
    section_heading: chunk.section_heading ? cleanString(chunk.section_heading) : null,
    section_path: Array.isArray(chunk.section_path) ? chunk.section_path.map(cleanString) : [],
    heading_level: chunk.heading_level,
    parent_heading: chunk.parent_heading ? cleanString(chunk.parent_heading) : null,
    anchor_id: chunk.anchor_id ? cleanString(chunk.anchor_id) : null,
    content: cleanString(chunk.content),
    retrieval_synopsis: chunk.retrieval_synopsis ? cleanString(chunk.retrieval_synopsis) : undefined,
    token_estimate: chunk.token_estimate,
    image_ids: chunk.image_ids,
    content_hash: createHash("sha256")
      .update(`${chunk.section_heading ?? ""}\n${chunk.content}`.replace(/\s+/g, " ").trim())
      .digest("hex"),
    index_generation_id: args.generationId,
    metadata: sanitizeJsonbRecord(chunk.metadata),
  };
}
/** Explicit nulls make the complete pre-embedding projection match the SQL row contract. */
export function serializeCandidateChunkRows(
  chunks: readonly DocumentChunk[],
  args: ChunkSanitation & { documentId: string; generationId: string },
): CandidateChunkRow[] {
  return chunks.map((chunk) => {
    const row = serializeChunkForPersistence(chunk, {
      ...args,
      id: candidateChunkId(args.documentId, args.generationId, chunk.chunk_index),
    });
    return { ...row, retrieval_synopsis: row.retrieval_synopsis ?? null, heading_level: row.heading_level ?? null };
  });
}

/** Explicit original applicability is checked before any image/caption/provider effect. */
export function assertCandidateChunkApplicability(args: {
  packet: RetentionPacket;
  originalBytes: Buffer;
  witnessBytes?: Buffer;
  extracted: ExtractedDocument;
}) {
  const applicability = parseOriginalApplicabilityWitness({
    sourceExpectation: args.packet.registration.sourceExpectation,
    originalBytes: args.originalBytes,
    witnessBytes: args.witnessBytes,
  });
  if (applicability.status !== "typed_original_requirements")
    throw new Error("candidate_chunks_original_applicability_unavailable");
  const images = applicability.groups.find((group) => group.family === "images")!.population;
  const chunks = applicability.groups.find((group) => group.family === "chunks")!.population;
  if (
    images.tag !== "known" ||
    images.requirements.length !== 0 ||
    images.reason !== "no_original_requirements_in_scope" ||
    args.extracted.images.length !== 0 ||
    args.packet.artifacts.some((artifact) => artifact.representation === "image_binary")
  )
    throw new Error("candidate_chunks_image_stage_unavailable");
  if (chunks.tag !== "known") throw new Error("candidate_chunks_original_applicability_unavailable");
  return applicability;
}

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

/** Producer output plan only. Original obligations, native fidelity and coverage remain unavailable. */
export function prepareCandidateChunks(args: {
  packet: RetentionPacket;
  originalBytes: Buffer;
  witnessBytes?: Buffer;
  extracted: ExtractedDocument;
  chunkRows: readonly CandidateChunkRow[];
}) {
  assertCandidateChunkApplicability(args);
  generationEvidenceBytes(args.chunkRows);
  const packet = args.packet;
  const checkedArtifacts = packet.artifacts.map((input) => {
    try {
      return parseGenerationArtifact(input);
    } catch (error) {
      if (error instanceof z.ZodError) fail();
      throw error;
    }
  });
  const original = checkedArtifacts.find((artifact) => artifact.representation === "original_binary");
  if (
    !original ||
    original.sha256 !== bytesDigest(args.originalBytes) ||
    original.byteLength !== args.originalBytes.length ||
    packet.registration.sourceExpectationSha256 !== generationEvidenceDigest(packet.registration.sourceExpectation)
  )
    fail();
  const documentId = checkedArtifacts.find((artifact) => artifact.representation === "document_projection");
  if (!documentId) fail();
  let projection: Record<string, unknown>;
  try {
    projection = JSON.parse(Buffer.from(documentId.bytesHex, "hex").toString("utf8")) as Record<string, unknown>;
  } catch {
    fail();
  }
  if (
    !projection ||
    projection.documentId === undefined ||
    projection.generationId !== packet.generationId ||
    projection.sourceSha256 !== original.sha256
  )
    fail();
  const parsedRows = z.array(preparedRowSchema).safeParse(args.chunkRows);
  if (!parsedRows.success || parsedRows.data.length === 0) fail();
  // Copy before freezing: no caller's rows, metadata, or extraction object is mutated.
  const rows = JSON.parse(generationEvidenceBytes(parsedRows.data).toString("utf8")) as CandidateChunkRow[];
  const references = checkedArtifacts
    .filter(
      (artifact) =>
        artifact.unitId.family === "pages" ||
        (artifact.unitId.family === "private_objects" &&
          (artifact.unitId.key === "original-source" ||
            artifact.unitId.key === "original-source-expectation-witness" ||
            /^page:[1-9][0-9]*:(extracted|persisted|original-provenance|persisted-provenance)$/.test(
              artifact.unitId.key,
            ))),
    )
    .map((artifact) => {
      return {
        unitId: artifact.unitId,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
        representation: artifact.representation,
      };
    });
  if (
    new Set(references.map((ref) => unitIdentity(ref.unitId))).size !== references.length ||
    !references.some((ref) => ref.representation === "source_expectation_witness")
  )
    fail();
  const pages = new Set(args.extracted.pages.map((page) => page.pageNumber));
  for (const page of args.extracted.pages) {
    const ref = references.find(
      (item) => item.unitId.family === "private_objects" && item.unitId.key === `page:${page.pageNumber}:extracted`,
    );
    if (
      !ref ||
      ref.sha256 !== bytesDigest(Buffer.from(page.text, "utf8")) ||
      ref.byteLength !== Buffer.byteLength(page.text, "utf8")
    )
      fail();
  }
  const units: GenerationUnitDeclaration[] = [];
  const artifacts: GenerationArtifactInput[] = [];
  for (const [index, row] of rows.entries()) {
    if (
      row.document_id !== projection.documentId ||
      row.index_generation_id !== packet.generationId ||
      row.chunk_index !== index ||
      row.id !== candidateChunkId(row.document_id, packet.generationId, index) ||
      row.image_ids.length !== 0 ||
      (row.page_number !== null && !pages.has(row.page_number)) ||
      row.metadata.index_generation_id !== packet.generationId
    )
      fail();
    const preparedId = { family: "chunks" as const, key: `${row.id}:prepared` };
    const finalId = { family: "chunks" as const, key: `${row.id}:final` };
    units.push(
      {
        id: preparedId,
        groupKey: "worker_core",
        required: true,
        dependencies: references.map((ref) => ref.unitId),
        sourceEvidenceIds: [],
        qualification: "derived_unverified",
        representation: "provenance_json",
      },
      {
        id: finalId,
        groupKey: "worker_core",
        required: true,
        dependencies: [preparedId],
        sourceEvidenceIds: [],
        qualification: "derived_unverified",
        representation: "provenance_json",
      },
    );
    const bytes = generationEvidenceBytes({
      version: "ingestion-prepared-chunk-v1",
      qualification: "derived_unverified",
      documentId: row.document_id,
      generationId: packet.generationId,
      sourceSha256: original.sha256,
      sourceExpectationDigest: packet.registration.sourceExpectationSha256,
      chunkId: row.id,
      chunkIndex: row.chunk_index,
      row,
      references,
    });
    artifacts.push({
      unitId: preparedId,
      groupKey: "worker_core",
      representation: "provenance_json",
      bytesHex: bytes.toString("hex"),
      sha256: bytesDigest(bytes),
      byteLength: bytes.length,
      locator: `ingestion_chunk:${row.id}:prepared`,
    });
  }
  const declarations = parseGenerationDeclarations({
    version: 1,
    groups: [
      {
        family: "chunks",
        groupKey: "worker_core",
        declaration: {
          producer: {
            name: "worker_candidate_chunks",
            version: "ingestion-prepared-chunk-v1",
            outputManifestDigest: generationEvidenceDigest({ version: 1, units }),
          },
          artifactGenerationId: null,
          population: {
            tag: "known",
            expectedUnits: units.map((unit) => unit.id),
            basis: [
              {
                reference: "actual_prepared_chunks",
                sha256: generationEvidenceDigest(artifacts.map((artifact) => artifact.sha256)),
              },
            ],
            reason: null,
          },
        },
      },
    ],
    units,
  });
  return freezeGenerationEvidence({
    generationId: packet.generationId,
    declarations,
    artifacts,
    rows,
    outcomes: artifacts.map((artifact) => ({
      unitId: artifact.unitId,
      groupKey: "worker_core",
      disposition: "retained" as const,
      artifactSha256: artifact.sha256,
      limitation: null,
    })),
    sourceCompleteness: "unavailable" as const,
    nativeMapping: "unavailable" as const,
  });
}

/** Uses real embedding and fenced persistence seams; final evidence is supplied only by SQL. */
export async function stageCandidateChunks(args: {
  plan: ReturnType<typeof prepareCandidateChunks>;
  batchSize: number;
  embed: (texts: string[]) => Promise<number[][]>;
  assertEmbedding: (embedding: number[], context: string) => number[];
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  check: () => void;
}) {
  if (!Number.isSafeInteger(args.batchSize) || args.batchSize < 1) fail();
  const { plan, mutation } = args;
  const batchSize = Math.min(args.batchSize, 500);
  await mutation("declare_ingestion_generation_evidence", {
    p_generation: plan.generationId,
    p_declarations: plan.declarations,
  });
  await mutation("retain_ingestion_generation_artifacts", {
    p_generation: plan.generationId,
    p_artifacts: plan.artifacts,
  });
  await mutation("record_ingestion_generation_outcomes", {
    p_generation: plan.generationId,
    p_outcomes: plan.outcomes,
  });
  const evidence: Array<{
    preparedUnitId: { family: "chunks"; key: string };
    finalUnitId: { family: "chunks"; key: string };
    preparedSha256: string;
    finalSha256: string;
    finalByteLength: number;
  }> = [];
  for (let start = 0; start < plan.rows.length; start += batchSize) {
    args.check();
    const batch = plan.rows.slice(start, start + batchSize);
    const embeddings = await args.embed(batch.map((row) => row.content));
    if (embeddings.length !== batch.length) throw new Error("candidate_chunks_embedding_population_mismatch");
    const rows = batch.map((row, index) => ({
      ...row,
      embedding: args.assertEmbedding(embeddings[index], `document_chunks.${row.chunk_index}`),
    }));
    args.check();
    const result = await mutation("write_ingestion_base_artifacts", {
      p_generation: plan.generationId,
      p_chunks: rows,
      p_images: [],
      p_table_facts: [],
      p_embedding_fields: [],
      p_index_units: [],
    });
    generationEvidenceBytes(result);
    const readback = z
      .array(
        z
          .object({
            preparedUnitId: z.object({ family: z.literal("chunks"), key: z.string() }).strict(),
            finalUnitId: z.object({ family: z.literal("chunks"), key: z.string() }).strict(),
            preparedSha256: digest,
            finalSha256: digest,
            finalByteLength: z.number().int().positive().safe(),
          })
          .strict(),
      )
      .safeParse(result.chunkEvidence);
    if (result.ok !== true || !readback.success || readback.data.length !== batch.length)
      throw new Error("candidate_chunks_readback_mismatch");
    const seen = new Set<string>();
    for (const item of readback.data) {
      const row = batch.find((row) => item.preparedUnitId.key === `${row.id}:prepared`);
      const prepared = plan.artifacts.find(
        (artifact) => unitIdentity(artifact.unitId) === unitIdentity(item.preparedUnitId),
      );
      if (
        !row ||
        !prepared ||
        item.finalUnitId.key !== `${row.id}:final` ||
        item.preparedSha256 !== prepared.sha256 ||
        seen.has(item.finalUnitId.key)
      )
        throw new Error("candidate_chunks_readback_mismatch");
      seen.add(item.finalUnitId.key);
      evidence.push(item);
    }
  }
  const accounting = await mutation("record_ingestion_generation_accounting", { p_generation: plan.generationId });
  if (
    !accounting.accounting ||
    typeof accounting.accounting !== "object" ||
    (accounting.accounting as Record<string, unknown>).result !== "unavailable"
  )
    throw new Error("invalid_prerequisite_accounting_result");
  return freezeGenerationEvidence({
    result: "unavailable" as const,
    chunkEvidence: evidence,
    persistedChunks: evidence.length,
    stages: "incomplete" as const,
    sourceCompleteness: "unavailable" as const,
    nativeMapping: "unavailable" as const,
  });
}

export { prepareScopedCandidateProjection, stageScopedCandidateProjection } from "./scoped-candidate-projection";
