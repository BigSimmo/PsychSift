import { describe, expect, it, vi } from "vitest";
import {
  bytesDigest,
  generationEvidenceBytes,
  originalApplicabilityFamilies,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { encodeAdminReferencePreparationEvidence } from "../src/lib/admin-reference-preparation-receipt";
import { generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";
import { candidateChunkId } from "../worker/candidate-chunks";
import {
  createPublishedAdminTextSectionLayoutLoader,
  type PublishedAdminSectionRequest,
} from "../worker/published-admin-source-layout";
import { buildGenerationRetentionPacket } from "../worker/generation-evidence";

const ownerId = "00000000-0000-4000-8000-000000000001";
const documentId = "00000000-0000-4000-8000-000000000002";
const generationId = "00000000-0000-4000-8000-000000000003";
const otherId = "00000000-0000-4000-8000-000000000004";
const witnessKey = "original-source-expectation-witness";
type SourceUnits = NonNullable<SourceExpectation["units"]>;
type Layout = {
  sourceSha256: string;
  units: { sourceUnitId: string; headingByteStart: number | null; headingByteEnd: number | null }[];
};

function fixture(configure?: (plan: { units: SourceUnits; layout: Layout }) => void) {
  // Independent synthetic source plan, before any producer or supplier output.
  const parts = [
    { id: "preamble", heading: null, text: "SYNTHETIC SOURCE ONLY\r\n" },
    {
      id: "adult",
      heading: "Guideline\u00a01: Adults",
      text: "Guideline\u00a01: Adults\r\n" + "Exact Î±ðŸ˜€ qualification.\n".repeat(100),
    },
    { id: "marker", heading: null, text: "[Synthetic preparer page marker]\n" },
    {
      id: "child",
      heading: "Guideline 2: People under \n18\u00a0years",
      text: "Guideline 2: People under \n18\u00a0years\nOriginal child qualification.\n",
    },
    {
      id: "pregnancy",
      heading: "Guideline 3: Pregnant \nor\u00a0breastfeeding",
      text: "Guideline 3: Pregnant \nor\u00a0breastfeeding\nOriginal breastfeeding qualification.\n",
    },
    { id: "trailer", heading: null, text: "TRAILER\n \t" },
  ];
  const originalBytes = Buffer.from(parts.map((part) => part.text).join(""));
  let cursor = 0;
  const ranges = parts.map((part) => {
    const start = cursor;
    cursor += Buffer.byteLength(part.text);
    return { ...part, start, end: cursor };
  });
  const units: SourceUnits = ranges.map((part) => ({
    id: part.id,
    required: true,
    dependencies: [],
    locator: `utf8-bytes:${part.start}:${part.end}`,
    nativeMapping: "unavailable",
  }));
  const layout: Layout = {
    sourceSha256: bytesDigest(originalBytes),
    units: ranges.map((part) => ({
      sourceUnitId: part.id,
      headingByteStart: part.heading === null ? null : part.start,
      headingByteEnd: part.heading === null ? null : part.start + Buffer.byteLength(part.heading),
    })),
  };
  configure?.({ units, layout });
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceUnits: units,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: {
        tag: "known",
        requirements:
          family === "chunks"
            ? [{ id: "independent-source-chunks", required: true, sourceEvidenceIds: units.map((unit) => unit.id) }]
            : [],
        basis: { scope: "whole_original", kind: "independent_original_declaration" },
        reason: family === "chunks" ? null : "no_original_requirements_in_scope",
      },
    })),
  };
  const witnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    tag: "known",
    sourceSha256: bytesDigest(originalBytes),
    units,
    witness: { reference: "independently-authored synthetic section plan", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const text = originalBytes.toString("utf8");
  const packet = buildGenerationRetentionPacket({
    documentId,
    generationId,
    originalBytes,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted: { pages: [{ pageNumber: 1, text, ocrUsed: false }], images: [] },
    persistedPages: [{ document_id: documentId, page_number: 1, text, ocr_used: false, metadata: {} }],
    deferOptionalProducerDeclarations: true,
  });
  const inventory = {
    version: 1,
    documentId,
    generationId,
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceExpectation: structuredClone(packet.registration.sourceExpectation),
    sourceExpectationDigest: packet.registration.sourceExpectationSha256,
    registration: structuredClone(packet.registration),
    artifacts: packet.artifacts.map((artifact) => ({
      unitId: artifact.unitId,
      groupKey: artifact.groupKey,
      representation: artifact.representation,
      sourceSha256: bytesDigest(originalBytes),
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
    })),
    retainedOriginalWitness: {
      status: "retained",
      documentId,
      generationId,
      sourceSha256: bytesDigest(originalBytes),
      sourceByteLength: originalBytes.length,
      sourceExpectationDigest: packet.registration.sourceExpectationSha256,
      unitId: { family: "private_objects", key: witnessKey },
      representation: "source_expectation_witness",
      bytesHex: witnessBytes.toString("hex"),
      sha256: bytesDigest(witnessBytes),
      byteLength: witnessBytes.length,
    },
  };
  const rows = ranges.map((part, index) => ({
    id: candidateChunkId(documentId, generationId, index),
    document_id: documentId,
    index_generation_id: generationId,
    content: part.text,
    content_hash: bytesDigest(Buffer.from(part.text)).slice(7),
    section_heading: part.heading,
    section_path: part.heading === null ? [] : [part.heading],
    parent_heading: null,
    anchor_id: null,
    metadata: {
      index_generation_id: generationId,
      source_unit_id: part.id,
      source_byte_start: part.start,
      source_byte_end: part.end,
      heading_byte_start: part.heading === null ? null : part.start,
      heading_byte_end: part.heading === null ? null : part.start + Buffer.byteLength(part.heading),
    },
  }));
  const sha = `sha256:${"a".repeat(64)}`;
  const field = (afterValue: string) => ({ beforePresent: false, beforeValue: null, afterValue });
  const receipt = {
    version: "admin-text-reference-preparation-v1",
    documentId,
    generationId,
    provenanceOwnerId: ownerId,
    admission: { eventId: ownerId, digest: sha },
    candidate: { authorityDigest: sha, registrationDigest: sha, sourceSnapshotDigest: sha },
    sealDigest: sha,
    source: {
      sha256: bytesDigest(originalBytes),
      byteLength: originalBytes.length,
      expectationDigest: generationEvidenceDigest(sourceExpectation),
      witnessDigest: bytesDigest(witnessBytes),
    },
    populations: { chunksDigest: sha, sectionsDigest: sha },
    completedDocumentDigest: sha,
    preparedDocumentDigest: sha,
    preparedReviewedStateDigest: "b".repeat(64),
    delta: {
      corpus_scope: field("australian_public"),
      source_catalogue_key: field("nhmrc"),
      source_policy_version: field("australian-source-policy-v1"),
      publisher_code: field("NHMRC"),
      change_state: field("unchanged"),
    },
    comparison: {
      scope: "retained-current-vs-admitted-original",
      sourceSha256: bytesDigest(originalBytes),
      expectationDigest: generationEvidenceDigest(sourceExpectation),
      sourceByteLength: originalBytes.length,
      evidenceReference: "synthetic independent original",
      changeState: "unchanged",
    },
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  const reply = {
    version: "published-admin-text-source-layout-v1",
    requesterId: otherId,
    provenanceOwnerId: ownerId,
    document: {
      owner_id: null,
      status: "indexed",
      index_generation_id: generationId,
      metadata: {
        public_corpus: true,
        index_generation_id: generationId,
        corpus_scope: "australian_public",
        source_kind: "document",
        source_catalogue_key: "nhmrc",
        source_policy_version: "australian-source-policy-v1",
        publisher: "National Health and Medical Research Council",
        publisher_code: "NHMRC",
        jurisdiction: "Australia",
        source_role: "clinical_guideline",
        content_mode: "indexed_content",
        licence_policy: "public_index_permitted",
        change_state: "unchanged",
        document_status: "current",
        extraction_quality: "good",
      },
    },
    publication: {
      approvalId: documentId,
      manifestVersion: 2,
      manifestDigest: "c".repeat(64),
      reviewedStateDigest: "b".repeat(64),
      reviewedIndexGenerationId: generationId,
      sourceCatalogueKey: "nhmrc",
      sourcePolicyVersion: "australian-source-policy-v1",
      approvingOperatorId: ownerId,
      approvedAt: "2026-10-08T00:00:00Z",
      preparationReceiptSha256: bytesDigest(receiptBytes),
    },
    evidenceReferences: [...encodeAdminReferencePreparationEvidence(receiptBytes)],
    preparationReceipt: { bytesHex: receiptBytes.toString("hex"), sha256: bytesDigest(receiptBytes) },
    documentId,
    generationId,
    original: {
      bytesHex: originalBytes.toString("hex"),
      sha256: bytesDigest(originalBytes),
      byteLength: originalBytes.length,
    },
    inventory,
    rows,
  };
  const input = {
    requesterId: otherId,
    publicationApprovalId: documentId,
    documentId,
    expectedIndexGenerationId: generationId,
    selectedResults: rows.map((row) => ({
      id: row.id,
      document_id: row.document_id,
      content: row.content,
      section_heading: row.section_heading,
      section_path: [...row.section_path],
      parent_heading: row.parent_heading,
      anchor_id: row.anchor_id,
      source_metadata: { ...row.metadata },
    })),
  } satisfies PublishedAdminSectionRequest;
  const rpc = vi.fn(async () => ({ data: reply, error: null as unknown }));
  const config = { requesterId: otherId, documentId, sourceExpectation, sourceSectionLayout: layout, rpc };
  return { originalBytes, witnessBytes, ranges, layout, reply, input, rpc, config };
}

describe("published admin supplier (synthetic transport; no genuine SQL/approval proof)", () => {
  it("keeps public requester distinct while preserving six original units, bytes and exact row identity", async () => {
    const f = fixture();
    const result = await createPublishedAdminTextSectionLayoutLoader(f.config)(f.input);
    expect(result.version).toBe("published-admin-text-section-projection-v1");
    expect(result.requesterId).toBe(otherId);
    expect(result.provenanceOwnerId).toBe(ownerId);
    expect(result).not.toHaveProperty("ownerId");
    expect(result.original.exactUtf8Text).toBe(f.originalBytes.toString("utf8"));
    expect(result.originalUnits).toHaveLength(6);
    expect(result.rowBindings.map((row) => row.resultId)).toEqual(f.input.selectedResults.map((row) => row.id));
    expect(Object.isFrozen(result.publication)).toBe(true);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("read_published_admin_text_source_layout", {
      p_requester_id: otherId,
      p_document_id: documentId,
      p_generation: generationId,
      p_publication_approval_id: documentId,
      p_chunk_ids: f.input.selectedResults.map((row) => row.id),
    });
  });
  it("refuses private visibility, partial quality and mismatched real approval identity", async () => {
    for (const change of ["private", "partial", "approval"]) {
      const f = fixture();
      if (change === "private") Object.assign(f.reply.document, { owner_id: ownerId });
      if (change === "partial") f.reply.document.metadata.extraction_quality = "partial";
      if (change === "approval") f.reply.publication.approvalId = otherId;
      await expect(createPublishedAdminTextSectionLayoutLoader(f.config)(f.input)).rejects.toThrow();
    }
  });
  it("refuses missing/corrupted intrinsic evidence, requester crossing, duplicate rows and cancellation", async () => {
    const f = fixture();
    f.reply.evidenceReferences = [];
    await expect(createPublishedAdminTextSectionLayoutLoader(f.config)(f.input)).rejects.toThrow();
    const good = fixture();
    const loader = createPublishedAdminTextSectionLayoutLoader(good.config);
    await expect(loader({ ...good.input, requesterId: ownerId })).rejects.toThrow("scope");
    await expect(
      loader({ ...good.input, selectedResults: [good.input.selectedResults[0], good.input.selectedResults[0]] }),
    ).rejects.toThrow("selected_duplicate");
    const controller = new AbortController();
    controller.abort();
    await expect(loader({ ...good.input, signal: controller.signal })).rejects.toThrow();
    expect(good.rpc).not.toHaveBeenCalled();
  });
  it("checks selected byte fidelity even when source hashes and publication fields remain pinned", async () => {
    const f = fixture();
    f.input.selectedResults[1].content += " fabricated";
    await expect(createPublishedAdminTextSectionLayoutLoader(f.config)(f.input)).rejects.toThrow();
  });
});
