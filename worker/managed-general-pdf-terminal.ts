/** Fenced completion of the explicitly supported native-text PDF profile.
 * Image/OCR fidelity, enrichment, clinical review and public publication are separate.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  issuedAttemptControlSchema,
  parseOriginalApplicabilityWitness,
} from "../src/lib/ingestion-generation-evidence";
import type { ExtractedDocument } from "../src/lib/types";
import { EMBEDDING_MAX_INPUT_UTF8_BYTES } from "../src/lib/embedding-input-budget";
import { parseIngestionFence, type IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { candidateChunkId, preparedRowSchema, type CandidateChunkRow } from "./candidate-chunks";
import type { buildGenerationRetentionPacket } from "./generation-evidence";
import {
  inspectGeneralPdfSource,
  generalPdfInspectionReviewSchema,
  type GeneralPdfInspectionReview,
} from "./general-pdf-inspection";
import { committedJson } from "./managed-vector-final";

export const GENERAL_PDF_TEXT_PROFILE = "administrator-general-native-pdf-text-v1" as const;
const sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const pageSchema = z
  .object({
    pageNumber: z.number().int().positive().max(1000),
    textSha256: sha,
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(2 * 1024 * 1024),
  })
  .strict();
const chunkSchema = z
  .object({
    id: z.uuid(),
    chunkIndex: z.number().int().nonnegative(),
    pageNumber: z.number().int().positive(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    sha256: sha,
  })
  .strict();
export const generalPdfPacketSchema = z
  .object({
    version: z.literal("managed-general-pdf-complete-v1"),
    profileId: z.literal(GENERAL_PDF_TEXT_PROFILE),
    identity: issuedAttemptControlSchema
      .extend({
        ownerId: z.uuid(),
        sourceSha256: sha,
        sourceByteLength: z.number().int().positive(),
        sourceExpectationDigest: sha,
      })
      .strict(),
    inspection: generalPdfInspectionReviewSchema,
    retainedImageCount: z.number().int().nonnegative().max(10000),
    pages: z.array(pageSchema).min(1).max(1000),
    chunks: z.array(chunkSchema).min(1).max(10000),
    quality: z
      .object({
        quality_score: z.literal(1),
        extraction_quality: z.literal("good"),
        issues: z.array(z.string()),
        metrics: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
export type ManagedGeneralPdfTerminalPacket = z.infer<typeof generalPdfPacketSchema>;
type SourceInput = {
  packet: ReturnType<typeof buildGenerationRetentionPacket>;
  originalBytes: Buffer;
  witnessBytes: Buffer;
  extracted: ExtractedDocument;
  inspection: GeneralPdfInspectionReview;
};
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
const copy = <T>(value: T): T => JSON.parse(generationEvidenceBytes(value).toString("utf8")) as T;
function refuse(reason: string): never {
  throw new Error(`managed_general_pdf_${reason}`);
}

function sourcePages(args: SourceInput): string[] {
  const texts = inspectGeneralPdfSource(args.inspection, args.originalBytes, args.inspection.binding);
  if (
    args.packet.artifacts.filter((artifact) => artifact.representation === "image_binary").length !==
      args.extracted.images.length ||
    args.extracted.pages.length !== texts.length ||
    args.extracted.pages.some(
      (page, index) => page.pageNumber !== index + 1 || page.ocrUsed || page.text !== texts[index],
    )
  ) {
    refuse("unsupported_visual_or_extraction_mismatch");
  }
  const applicability = parseOriginalApplicabilityWitness({
    sourceExpectation: args.packet.registration.sourceExpectation,
    originalBytes: args.originalBytes,
    witnessBytes: args.witnessBytes,
  });
  if (applicability.status !== "typed_original_requirements") refuse("independent_expectation_required");
  for (const group of applicability.groups) {
    if (
      group.population.tag !== "known" ||
      (group.family === "chunks" ? !group.population.requirements.length : group.population.requirements.length !== 0)
    ) {
      refuse("unsupported_original_requirements");
    }
  }
  const units = args.packet.registration.sourceExpectation.units!;
  if (
    units.length !== texts.length ||
    units.some((unit) => unit.dependencies.length !== 0) ||
    new Set(units.map((unit) => unit.id)).size !== units.length ||
    texts.some(
      (_, index) =>
        units.filter(
          (unit) =>
            unit.required &&
            unit.locator === `pdf-page:${index + 1}:native-text:${args.inspection.pages[index].textSha256}`,
        ).length !== 1,
    )
  ) {
    refuse("source_page_inventory_mismatch");
  }
  const refs = new Set(
    applicability.groups.flatMap((group) =>
      group.family === "chunks" && group.population.tag === "known"
        ? group.population.requirements.flatMap((item) => item.sourceEvidenceIds)
        : [],
    ),
  );
  if (units.some((unit) => !refs.has(unit.id))) refuse("source_obligation_unrepresented");
  return texts;
}

/** Full literal page partitions. No generated prefix, title, normalization or synopsis. */
export function buildManagedGeneralPdfChunks(args: SourceInput & { documentId: string }): CandidateChunkRow[] {
  const texts = sourcePages(args);
  const rows: CandidateChunkRow[] = [];
  for (const [pageIndex, text] of texts.entries()) {
    if (!text.trim()) {
      if (text.length) refuse("whitespace_only_page_unsupported");
      continue;
    }
    if (!text.isWellFormed()) refuse("source_utf8_invalid");
    const utf8 = Buffer.from(text, "utf8");
    const lastVisibleEnd = text.trimEnd().length;
    let lastVisibleStart = lastVisibleEnd - 1;
    if (/[\uDC00-\uDFFF]/.test(text[lastVisibleStart])) lastVisibleStart--;
    const lastVisibleStartByte = Buffer.byteLength(text.slice(0, lastVisibleStart));
    const lastVisibleEndByte = Buffer.byteLength(text.slice(0, lastVisibleEnd));
    // Exact nonempty embedding inputs cannot represent a larger whitespace tail
    // without either discarding bytes or manufacturing repeated source content.
    if (utf8.length - lastVisibleStartByte > EMBEDDING_MAX_INPUT_UTF8_BYTES)
      refuse("whitespace_tail_exceeds_embedding_budget");
    let start = 0;
    while (start < utf8.length) {
      let end = Math.min(utf8.length, start + EMBEDDING_MAX_INPUT_UTF8_BYTES);
      // A UTF8 continuation byte belongs to the preceding codepoint.
      while (end < utf8.length && (utf8[end] & 0xc0) === 0x80) end--;
      if (end >= lastVisibleEndByte && end < utf8.length) {
        end = utf8.length - start <= EMBEDDING_MAX_INPUT_UTF8_BYTES ? utf8.length : lastVisibleStartByte;
      }
      if (end <= start) refuse("whitespace_only_chunk_unsupported");
      const content = utf8.subarray(start, end).toString("utf8");
      if (!content.trim()) refuse("whitespace_only_chunk_unsupported");
      const chunkIndex = rows.length;
      rows.push(
        preparedRowSchema.parse({
          id: candidateChunkId(args.documentId, args.packet.generationId, chunkIndex),
          document_id: args.documentId,
          index_generation_id: args.packet.generationId,
          page_number: pageIndex + 1,
          chunk_index: chunkIndex,
          section_heading: null,
          section_path: [],
          heading_level: null,
          parent_heading: null,
          anchor_id: null,
          content,
          retrieval_synopsis: null,
          token_estimate: Math.ceil(content.length / 4),
          image_ids: [],
          content_hash: createHash("sha256").update(`\n${content}`.replace(/\s+/g, " ").trim()).digest("hex"),
          metadata: {
            index_generation_id: args.packet.generationId,
            source_sha256: bytesDigest(args.originalBytes),
            source_expectation_digest: args.packet.registration.sourceExpectationSha256,
            general_pdf_profile: GENERAL_PDF_TEXT_PROFILE,
          },
        }),
      );
      start = end;
    }
  }
  if (!rows.length || rows.length > 10000) refuse("chunk_population_invalid");
  return freezeGenerationEvidence(rows);
}

export function prepareManagedGeneralPdfTerminalPacket(
  args: SourceInput & {
    issued: z.infer<typeof issuedAttemptControlSchema>;
    ownerId: string;
    chunkRows: readonly CandidateChunkRow[];
  },
): ManagedGeneralPdfTerminalPacket {
  const issued = issuedAttemptControlSchema.parse(args.issued);
  const texts = sourcePages(args);
  const expected = buildManagedGeneralPdfChunks({ ...args, documentId: issued.documentId });
  const b = args.inspection.binding;
  if (
    !same(expected, args.chunkRows) ||
    args.packet.generationId !== issued.generationId ||
    b.documentId !== issued.documentId ||
    b.generationId !== issued.generationId ||
    b.jobId !== issued.jobId ||
    b.leaseId !== issued.firstLeaseToken ||
    b.authorityDigest !== issued.authorityDigest ||
    b.contentSha256 !== args.packet.registration.sourceSha256
  )
    refuse("identity_or_chunk_mismatch");
  const cursors = new Map<number, number>();
  const chunks = expected.map((row) => {
    const pageNumber = row.page_number!;
    const start = cursors.get(pageNumber) ?? 0;
    const end = start + Buffer.byteLength(row.content, "utf8");
    cursors.set(pageNumber, end);
    return {
      id: row.id,
      chunkIndex: row.chunk_index,
      pageNumber,
      start,
      end,
      sha256: bytesDigest(Buffer.from(row.content)),
    };
  });
  return freezeGenerationEvidence(
    generalPdfPacketSchema.parse({
      version: "managed-general-pdf-complete-v1",
      profileId: GENERAL_PDF_TEXT_PROFILE,
      identity: {
        ...issued,
        ownerId: args.ownerId,
        sourceSha256: bytesDigest(args.originalBytes),
        sourceByteLength: args.originalBytes.length,
        sourceExpectationDigest: args.packet.registration.sourceExpectationSha256,
      },
      inspection: copy(args.inspection),
      retainedImageCount: args.extracted.images.length,
      pages: texts.map((text, index) => ({
        pageNumber: index + 1,
        textSha256: bytesDigest(Buffer.from(text)),
        byteLength: Buffer.byteLength(text),
      })),
      chunks,
      quality: {
        quality_score: 1,
        extraction_quality: "good",
        issues: ["native_text_profile_only", "optional_enrichment_deferred", "clinical_approval_not_assessed"],
        metrics: {
          page_count: texts.length,
          chunk_count: chunks.length,
          ocr_page_count: 0,
          public_image_count: 0,
          private_retained_image_count: args.extracted.images.length,
          scope: GENERAL_PDF_TEXT_PROFILE,
          native_text_exact: true,
          visual_fidelity: "not_assessed",
        },
      },
    }),
  );
}

export function decodeManagedGeneralPdfTerminalReadback(packet: ManagedGeneralPdfTerminalPacket, response: unknown) {
  const result = z
    .object({
      ok: z.literal(true),
      managedGeneralPdfTerminal: z
        .object({
          status: z.literal("general_pdf_text_completed"),
          replay: z.enum(["completed", "already_completed"]),
          activated: z.literal(true),
          seal: z
            .object({
              bytesHex: z.string(),
              sha256: sha,
              byteLength: z
                .number()
                .int()
                .positive()
                .max(32 * 1024 * 1024),
            })
            .strict(),
        })
        .strict(),
    })
    .strict()
    .parse(copy(response)).managedGeneralPdfTerminal;
  const body = committedJson(result.seal).body as Record<string, unknown>;
  if (
    body.version !== "managed-general-pdf-seal-v1" ||
    !same(body.packet, packet) ||
    body.scope !== GENERAL_PDF_TEXT_PROFILE ||
    body.activated !== true ||
    body.clinicalApproval !== "not_assessed" ||
    body.publicationApproval !== "not_granted" ||
    body.visualFidelity !== "not_assessed"
  )
    refuse("receipt_mismatch");
  return freezeGenerationEvidence(result);
}

/** A lost acknowledgement permits a strict completed read, never a second write. */
export function completeManagedGeneralPdfAttempt(args: {
  attempt: IngestionAttempt;
  packet: ManagedGeneralPdfTerminalPacket;
  stopHeartbeat: () => void;
  rpc: (
    name: string,
    payload: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  args.stopHeartbeat();
  return args.attempt.serialize(async () => {
    const packet = generalPdfPacketSchema.parse(copy(args.packet));
    const fence = parseIngestionFence(args.attempt.fence);
    if (
      !same(fence, {
        job_kind: "node",
        job_id: packet.identity.jobId,
        document_id: packet.identity.documentId,
        worker_id: packet.identity.workerId,
        lease_token: packet.identity.firstLeaseToken,
        expected_generation_id: packet.identity.predecessorGenerationId,
        authority_digest: packet.identity.authorityDigest,
      })
    )
      refuse("fence_mismatch");
    const dispatch = async (readOnly: boolean) => {
      const result = await args.rpc("complete_managed_general_pdf", {
        p_fence: copy(fence),
        p_generation: packet.identity.generationId,
        p_packet: copy(packet),
        p_read_only: readOnly,
      });
      if (result.error) throw new Error(result.error.message);
      return decodeManagedGeneralPdfTerminalReadback(packet, result.data);
    };
    try {
      args.attempt.check();
      let written: ReturnType<typeof decodeManagedGeneralPdfTerminalReadback> | undefined;
      try {
        written = await dispatch(false);
      } catch {
        /* Completed read is the only ambiguity recovery. */
      }
      const read = await dispatch(true);
      if (written && !same(written.seal, read.seal)) refuse("replay_mismatch");
      return read;
    } finally {
      args.attempt.cancel();
    }
  });
}
