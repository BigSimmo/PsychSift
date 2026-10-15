import { z } from "zod";
import { createHash } from "node:crypto";
import { buildDocumentSections } from "../src/lib/deep-memory-preparation";
import { assembleWholeOriginalProducerManifest } from "./whole-original-supplier";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  issuedAttemptControlSchema,
  parseOriginalApplicabilityWitness,
} from "../src/lib/ingestion-generation-evidence";
import { parseIngestionFence, type IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { candidateChunkId, preparedRowSchema, type CandidateChunkRow } from "./candidate-chunks";
import type { buildGenerationRetentionPacket } from "./generation-evidence";
import type { ExtractedDocument } from "../src/lib/types";
import { committedJson } from "./managed-vector-final";
import { assessDocumentIndexQuality } from "../src/lib/index-quality";

const sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const identitySchema = issuedAttemptControlSchema
  .extend({
    ownerId: z.uuid(),
    sourceSha256: sha,
    sourceByteLength: z.number().int().positive(),
    sourceExpectationDigest: sha,
  })
  .strict();
const legacyAdminTextPacketSchema = z
  .object({
    version: z.literal("managed-admin-text-complete-v1"),
    identity: identitySchema,
    chunks: z
      .array(
        z
          .object({
            id: z.uuid(),
            chunkIndex: z.number().int().nonnegative(),
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
            sha256: sha,
          })
          .strict(),
      )
      .min(1)
      .max(2000),
    quality: z
      .object({
        quality_score: z.number().min(0).max(1),
        extraction_quality: z.enum(["good", "partial", "poor", "unknown"]),
        issues: z.array(z.string()),
        metrics: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
const sectionBodySchema = z
  .object({
    document_id: z.uuid(),
    owner_id: z.uuid(),
    section_index: z.number().int().nonnegative(),
    heading: z.string().min(1),
    heading_path: z.array(z.string()),
    page_start: z.literal(1),
    page_end: z.literal(1),
    chunk_ids: z.array(z.uuid()).min(1),
    summary: z.string(),
    tags: z.array(z.string()),
    extraction_quality: z.enum(["good", "partial", "poor"]),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
const adminTextSectionsSchema = z
  .array(
    z
      .object({
        id: z.uuid(),
        body: sectionBodySchema,
        dependencies: z.array(z.object({ family: z.literal("chunks"), key: z.string() }).strict()).min(1),
        sourceEvidenceIds: z.array(z.string()).min(1),
      })
      .strict(),
  )
  .max(2000);
export const adminTextPacketSchema = z.discriminatedUnion("version", [
  legacyAdminTextPacketSchema,
  legacyAdminTextPacketSchema
    .extend({ version: z.literal("managed-admin-text-complete-v2"), sections: adminTextSectionsSchema })
    .strict(),
]);
export type ManagedAdminTextTerminalPacket = z.infer<typeof adminTextPacketSchema>;
type SourceInput = {
  packet: ReturnType<typeof buildGenerationRetentionPacket>;
  originalBytes: Buffer;
  witnessBytes: Buffer;
  extracted: ExtractedDocument;
};
import type { ManagedAdminTextSourceSectionLayout } from "../src/lib/admin-text-source-section-layout";
export type { ManagedAdminTextSourceSectionLayout } from "../src/lib/admin-text-source-section-layout";
const sourceSectionLayoutSchema = z
  .object({
    sourceSha256: sha,
    units: z
      .array(
        z
          .object({
            sourceUnitId: z.string().min(1),
            headingByteStart: z.number().int().nonnegative().safe().nullable(),
            headingByteEnd: z.number().int().positive().safe().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();
const refuse = (reason: string): never => {
  throw new Error(`managed_admin_text_${reason}`);
};
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
const copy = <T>(value: T): T => JSON.parse(generationEvidenceBytes(value).toString("utf8")) as T;

function inspectSource(args: SourceInput) {
  if (args.originalBytes.length > 2097152) return refuse("source_size");
  let text: string;
  try {
    text = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(args.originalBytes);
  } catch {
    return refuse("utf8");
  }
  if (!Buffer.from(text, "utf8").equals(args.originalBytes) || !text.trim()) return refuse("utf8");
  if (
    args.extracted.images.length ||
    args.extracted.pages.length !== 1 ||
    args.extracted.pages[0].pageNumber !== 1 ||
    args.extracted.pages[0].ocrUsed ||
    args.extracted.pages[0].text !== text
  )
    return refuse("extracted_text_mismatch");
  const applicability = parseOriginalApplicabilityWitness({
    sourceExpectation: args.packet.registration.sourceExpectation,
    originalBytes: args.originalBytes,
    witnessBytes: args.witnessBytes,
  });
  if (applicability.status !== "typed_original_requirements") return refuse("independent_expectation_required");
  for (const group of applicability.groups) {
    if (group.population.tag !== "known") return refuse("original_family_unknown");
    if (group.family === "chunks" ? !group.population.requirements.length : group.population.requirements.length !== 0)
      return refuse("unsupported_original_requirements");
  }
  // Every independent source unit must be covered by the original byte domain.
  const units = args.packet.registration.sourceExpectation.units!;
  const spans = units
    .map((unit) => {
      const match = /^utf8-bytes:(0|[1-9][0-9]*):([1-9][0-9]*)$/.exec(unit.locator);
      if (!match) return refuse("source_locator_unsupported");
      const start = Number(match[1]),
        end = Number(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end || end > args.originalBytes.length)
        return refuse("source_locator_invalid");
      return { sourceUnitId: unit.id, start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let covered = 0;
  for (const span of spans) {
    if (span.start > covered) return refuse("source_coverage_gap");
    covered = Math.max(covered, span.end);
  }
  if (covered !== args.originalBytes.length) return refuse("source_coverage_gap");
  const chunkRefs = new Set(
    applicability.groups.flatMap((g) =>
      g.family === "chunks" && g.population.tag === "known"
        ? g.population.requirements.flatMap((r) => r.sourceEvidenceIds)
        : [],
    ),
  );
  if (units.some((u) => u.required && !chunkRefs.has(u.id))) return refuse("source_obligation_unrepresented");
  return { text, spans };
}

function decodeSourceSlice(originalBytes: Buffer, start: number, end: number) {
  const bytes = originalBytes.subarray(start, end);
  try {
    const content = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(content, "utf8").equals(bytes)) return refuse("section_utf8_boundary");
    return content;
  } catch {
    return refuse("section_utf8_boundary");
  }
}

/** Literal, contiguous source slices; no title prefixes, normalization or generated synopsis. */
export function buildManagedAdminTextChunks(
  args: SourceInput & { documentId: string; sourceSectionLayout?: ManagedAdminTextSourceSectionLayout },
): CandidateChunkRow[] {
  const { text, spans } = inspectSource(args);
  if (args.sourceSectionLayout !== undefined) {
    const parsed = sourceSectionLayoutSchema.safeParse(args.sourceSectionLayout);
    if (!parsed.success) return refuse("section_layout_invalid");
    const layout = parsed.data;
    if (layout.sourceSha256 !== bytesDigest(args.originalBytes)) return refuse("section_source_mismatch");
    const layoutUnits = new Map(layout.units.map((unit) => [unit.sourceUnitId, unit]));
    if (
      layoutUnits.size !== layout.units.length ||
      layoutUnits.size !== spans.length ||
      spans.some((span) => !layoutUnits.has(span.sourceUnitId))
    )
      return refuse("section_unit_population_mismatch");
    let covered = 0;
    return spans.map((span, chunkIndex) => {
      // This supported layout is an exact partition, unlike ordinary overlapping source obligations.
      if (span.start !== covered) return refuse("section_unit_partition_mismatch");
      covered = span.end;
      const unit = layoutUnits.get(span.sourceUnitId)!;
      const { headingByteStart, headingByteEnd } = unit;
      if (
        (headingByteStart === null) !== (headingByteEnd === null) ||
        (headingByteStart !== null &&
          (headingByteStart !== span.start || headingByteEnd! <= headingByteStart || headingByteEnd! > span.end))
      )
        return refuse("section_heading_span_mismatch");
      const content = decodeSourceSlice(args.originalBytes, span.start, span.end);
      const heading =
        headingByteStart === null ? null : decodeSourceSlice(args.originalBytes, headingByteStart, headingByteEnd!);
      if (heading !== null && !heading.trim()) return refuse("section_heading_span_mismatch");
      return preparedRowSchema.parse({
        id: candidateChunkId(args.documentId, args.packet.generationId, chunkIndex),
        document_id: args.documentId,
        page_number: 1,
        chunk_index: chunkIndex,
        section_heading: heading,
        section_path: heading === null ? [] : [heading],
        heading_level: heading === null ? null : 1,
        parent_heading: null,
        anchor_id: null,
        content,
        retrieval_synopsis: null,
        token_estimate: Math.ceil(content.length / 4),
        image_ids: [],
        content_hash: bytesDigest(Buffer.from(content, "utf8")).slice(7),
        index_generation_id: args.packet.generationId,
        metadata: {
          index_generation_id: args.packet.generationId,
          extractor: "literal-admin-utf8-source-unit-v1",
          source_unit_id: span.sourceUnitId,
          source_byte_start: span.start,
          source_byte_end: span.end,
          heading_byte_start: headingByteStart,
          heading_byte_end: headingByteEnd,
        },
      });
    });
  }
  const characters = Array.from(text);
  const rows: CandidateChunkRow[] = [];
  for (let offset = 0; offset < characters.length; offset += 1800) {
    const content = characters.slice(offset, offset + 1800).join("");
    const chunkIndex = rows.length;
    rows.push(
      preparedRowSchema.parse({
        id: candidateChunkId(args.documentId, args.packet.generationId, chunkIndex),
        document_id: args.documentId,
        page_number: 1,
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
        content_hash: bytesDigest(Buffer.from(content)).slice(7),
        index_generation_id: args.packet.generationId,
        metadata: { index_generation_id: args.packet.generationId, extractor: "literal-admin-utf8-text-v1" },
      }),
    );
  }
  return rows;
}

export function prepareManagedAdminTextTerminalPacket(
  args: SourceInput & {
    issued: z.infer<typeof issuedAttemptControlSchema>;
    ownerId: string;
    chunkRows: readonly CandidateChunkRow[];
    sectionPlan?: ReturnType<typeof prepareManagedAdminTextSections>;
  },
): ManagedAdminTextTerminalPacket {
  inspectSource(args);
  let offset = 0;
  const chunks = args.chunkRows.map((row, index) => {
    const bytes = Buffer.from(row.content, "utf8"),
      start = offset;
    offset += bytes.length;
    if (
      row.chunk_index !== index ||
      row.page_number !== 1 ||
      row.document_id !== args.issued.documentId ||
      row.index_generation_id !== args.issued.generationId ||
      !args.originalBytes.subarray(start, offset).equals(bytes)
    )
      return refuse("chunk_coverage_mismatch");
    return { id: row.id, chunkIndex: index, start, end: offset, sha256: bytesDigest(bytes) };
  });
  if (offset !== args.originalBytes.length || args.packet.generationId !== args.issued.generationId)
    return refuse("chunk_coverage_mismatch");
  const metrics = {
    page_count: 1,
    ocr_page_count: 0,
    needs_ocr_page_count: 0,
    text_character_count: args.extracted.pages[0].text.length,
    extracted_image_count: 0,
    searchable_image_count: 0,
    skipped_image_count: 0,
  };
  const assessment = assessDocumentIndexQuality({
    metrics,
    chunks: args.chunkRows.map((r) => ({
      content: r.content,
      section_heading: r.section_heading,
      section_path: r.section_path,
    })),
    insertedImages: [],
    sectionCount: args.sectionPlan?.sections.length ?? 0,
    memoryCardCount: 0,
    documentEmbeddingFieldTypes: [],
  });
  const quality = {
    quality_score: assessment.qualityScore,
    extraction_quality: assessment.extractionQuality,
    issues: [...assessment.issues, "optional_enrichment_deferred", "clinical_approval_not_assessed"],
    metrics: { ...metrics, ...assessment.metrics },
  };
  if (args.sectionPlan) {
    const expected = prepareManagedAdminTextSections({
      ...args,
      document: args.sectionPlan.document,
      sourceSectionLayout: args.sectionPlan.sourceSectionLayout,
    });
    if (!same(expected, args.sectionPlan)) return refuse("section_plan_mismatch");
  }
  return freezeGenerationEvidence(
    adminTextPacketSchema.parse({
      version: args.sectionPlan ? "managed-admin-text-complete-v2" : "managed-admin-text-complete-v1",
      identity: {
        ...args.issued,
        ownerId: args.ownerId,
        sourceSha256: bytesDigest(args.originalBytes),
        sourceByteLength: args.originalBytes.length,
        sourceExpectationDigest: args.packet.registration.sourceExpectationSha256,
      },
      chunks,
      ...(args.sectionPlan ? { sections: args.sectionPlan.sections } : {}),
      quality,
    }),
  );
}

/** Only independently supplied literal headings enter the existing pure section builder.
 * Complementary prose and page markers stay chunks; they cannot mint inferred sections. */
export function prepareManagedAdminTextSections(
  args: SourceInput & {
    issued: z.infer<typeof issuedAttemptControlSchema>;
    document: Parameters<typeof buildDocumentSections>[0]["document"];
    chunkRows: readonly CandidateChunkRow[];
    sourceSectionLayout: ManagedAdminTextSourceSectionLayout;
  },
) {
  if (
    args.document.id !== args.issued.documentId ||
    !args.document.owner_id ||
    args.packet.generationId !== args.issued.generationId
  )
    return refuse("section_document_mismatch");
  const expected = buildManagedAdminTextChunks({ ...args, documentId: args.issued.documentId });
  if (!same(expected, args.chunkRows)) return refuse("section_chunk_population_mismatch");
  const eligible = expected.filter((row) => row.section_heading !== null);
  const byId = new Map(eligible.map((row) => [row.id, row]));
  const sections = buildDocumentSections({ document: args.document, chunks: eligible }).map((built, ordinal) => {
    const parents = built.chunk_ids.map((id) => byId.get(id) ?? refuse("section_parent_mismatch"));
    const hash = createHash("sha256")
      .update(
        generationEvidenceBytes(["admin-txt-sections-v2", args.issued.documentId, args.issued.generationId, ordinal]),
      )
      .digest()
      .subarray(0, 16);
    hash[6] = (hash[6] & 15) | 0x50;
    hash[8] = (hash[8] & 63) | 0x80;
    const hex = hash.toString("hex");
    return {
      id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
      body: sectionBodySchema.parse({
        ...built,
        metadata: {
          ...built.metadata,
          artifact_generation_id: args.issued.generationId,
          source_sha256: args.packet.registration.sourceSha256,
          source_expectation_digest: args.packet.registration.sourceExpectationSha256,
          source_units: parents.map((row) => ({
            id: row.metadata.source_unit_id,
            start: row.metadata.source_byte_start,
            end: row.metadata.source_byte_end,
            headingStart: row.metadata.heading_byte_start,
            headingEnd: row.metadata.heading_byte_end,
          })),
        },
      }),
      dependencies: parents.map((row) => ({ family: "chunks" as const, key: `${row.id}:final` })),
      sourceEvidenceIds: parents.map((row) => String(row.metadata.source_unit_id)),
    };
  });
  const manifest = assembleWholeOriginalProducerManifest({
    state: "prepared",
    group: {
      family: "sections",
      groupKey: "deep_memory",
      declaration: {
        producer: { name: "managed-admin-text-sections", version: "managed-admin-text-sections-v2" },
        artifactGenerationId: null,
        population: {
          tag: "known",
          expectedUnits: sections.map((row) => ({ family: "sections", key: row.id })),
          basis: [
            {
              reference: "actual literal-heading-only section builder outputs",
              sha256: generationEvidenceDigest(sections),
            },
          ],
          reason: sections.length ? null : "no_units_expected",
        },
      },
    },
    units: sections.map((row) => ({
      declaration: {
        id: { family: "sections", key: row.id },
        groupKey: "deep_memory",
        required: true,
        dependencies: row.dependencies,
        sourceEvidenceIds: [],
        qualification: "derived_unverified",
        representation: "provenance_json",
      },
      body: row.body,
      artifactLocator: `prepared:sections:${row.id}`,
      providerInputText: null,
      inputReferences: row.dependencies,
      originalReferences: row.sourceEvidenceIds,
      auxiliary: false,
    })),
  });
  return freezeGenerationEvidence({
    document: args.document,
    sourceSectionLayout: args.sourceSectionLayout,
    sourceExpectationDigest: args.packet.registration.sourceExpectationSha256,
    sections,
    manifest,
  });
}

export async function stageManagedAdminTextSections(args: {
  plan: ReturnType<typeof prepareManagedAdminTextSections>;
  generationId: string;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const { manifest } = args.plan;
  const layoutBytes = generationEvidenceBytes(args.plan.sourceSectionLayout);
  const calls: [string, Record<string, unknown>][] = [
    [
      "register_admin_text_source_section_layout",
      {
        p_source_expectation_digest: args.plan.sourceExpectationDigest,
        p_layout: args.plan.sourceSectionLayout,
        p_layout_hex: layoutBytes.toString("hex"),
        p_layout_sha256: bytesDigest(layoutBytes),
      },
    ],
    [
      "declare_ingestion_generation_evidence",
      { p_declarations: { version: 1, groups: [manifest.group], units: manifest.units.map((u) => u.declaration) } },
    ],
    ["retain_ingestion_generation_artifacts", { p_artifacts: manifest.units.map((u) => u.artifact) }],
    [
      "record_ingestion_generation_outcomes",
      {
        p_outcomes: manifest.units.map((u) => ({
          unitId: u.declaration.id,
          groupKey: "deep_memory",
          disposition: "retained",
          artifactSha256: u.artifact.sha256,
          limitation: null,
        })),
      },
    ],
  ];
  for (const [name, payload] of calls) {
    const result = await args.mutation(name, { p_generation: args.generationId, ...payload });
    if (result.ok !== true) return refuse("section_stage_current_attempt_required");
  }
}

export function decodeManagedAdminTextTerminalReadback(packet: ManagedAdminTextTerminalPacket, response: unknown) {
  if (generationEvidenceBytes(response).length > 2097152) return refuse("transport_limit");
  const parsed = z
    .object({
      ok: z.literal(true),
      managedAdminTextTerminal: z
        .object({
          status: z.literal("admin_text_completed"),
          replay: z.enum(["completed", "already_completed"]),
          activated: z.literal(true),
          seal: z.object({ bytesHex: z.string(), sha256: sha, byteLength: z.number().int().positive() }).strict(),
        })
        .strict(),
    })
    .strict()
    .parse(copy(response)).managedAdminTextTerminal;
  const committed = committedJson(parsed.seal);
  const body = committed.body as Record<string, unknown>;
  if (
    body.version !== "managed-admin-text-seal-v1" ||
    !same(body.packet, packet) ||
    body.activated !== true ||
    body.scope !== "whole_retained_utf8_txt" ||
    body.clinicalApproval !== "not_assessed" ||
    body.publicationApproval !== "not_granted"
  )
    return refuse("receipt_mismatch");
  return freezeGenerationEvidence(parsed);
}

/** Serialize once, drain heartbeat, recover a lost response only by completed read. */
export function completeManagedAdminTextAttempt(args: {
  attempt: IngestionAttempt;
  packet: ManagedAdminTextTerminalPacket;
  stopHeartbeat: () => void;
  rpc: (
    name: string,
    payload: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  args.stopHeartbeat();
  return args.attempt.serialize(async () => {
    const packet = adminTextPacketSchema.parse(copy(args.packet));
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
      return refuse("fence_mismatch");
    const dispatch = async (readOnly: boolean) => {
      const { data, error } = await args.rpc("complete_managed_admin_text", {
        p_fence: copy(fence),
        p_generation: packet.identity.generationId,
        p_packet: copy(packet),
        p_read_only: readOnly,
      });
      if (error) throw new Error(error.message);
      return decodeManagedAdminTextTerminalReadback(packet, data);
    };
    try {
      args.attempt.check();
      let written: ReturnType<typeof decodeManagedAdminTextTerminalReadback> | undefined;
      let response: unknown,
        received = false;
      try {
        const result = await args.rpc("complete_managed_admin_text", {
          p_fence: copy(fence),
          p_generation: packet.identity.generationId,
          p_packet: copy(packet),
          p_read_only: false,
        });
        if (result.error) throw new Error(result.error.message);
        response = result.data;
        received = true;
      } catch {
        /* Completed read is the only recovery. */
      }
      if (received) {
        try {
          written = decodeManagedAdminTextTerminalReadback(packet, response);
        } catch {
          /* An unverified acknowledgement is ambiguous; only the strict completed read can establish completion. */
        }
      }
      const read = await dispatch(true);
      if (written && !same(written.seal, read.seal)) return refuse("replay_mismatch");
      return read;
    } finally {
      args.attempt.cancel();
    }
  });
}
