import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildChunks } from "../src/lib/chunking";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceDigest,
  originalApplicabilityFamilies,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { buildGenerationRetentionPacket } from "../worker/generation-evidence";
import {
  candidateChunkId,
  prepareCandidateChunks,
  serializeCandidateChunkRows,
  serializeChunkForPersistence,
  stageCandidateChunks,
  type CandidateChunkRow,
  type CandidateImageRow,
  type CandidateTableFactRow,
  prepareScopedCandidateProjection,
  stageScopedCandidateProjection,
} from "../worker/candidate-chunks";

const documentId = "00000000-0000-4000-8000-000000000001";
const generationId = "00000000-0000-4000-8000-000000000002";
const original = Buffer.from(
  "SYNTHETIC QA ONLY\nQA scenario requires 2 mg daily only within this authored synthetic example.\nDo not combine the independent QA scenarios or omit their qualification.\nEND-QA complete authored tail.",
);
function fixture() {
  const sourceUnits: NonNullable<SourceExpectation["units"]> = [
    { id: "scope", required: true, dependencies: [], locator: "authored scope", nativeMapping: "unavailable" },
    {
      id: "dose",
      required: true,
      dependencies: ["scope"],
      locator: "authored synthetic dose",
      nativeMapping: "unavailable",
    },
  ];
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(original),
    sourceByteLength: original.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population:
        family === "chunks"
          ? {
              tag: "known",
              requirements: [{ id: "original-dose-obligation", required: true, sourceEvidenceIds: ["dose", "scope"] }],
              basis: { scope: "whole_original", kind: "independent_original_declaration" },
              reason: null,
            }
          : family === "images"
            ? {
                tag: "known",
                requirements: [],
                basis: { scope: "whole_original", kind: "independent_original_declaration" },
                reason: "no_original_requirements_in_scope",
              }
            : { tag: "unknown", limitation: "original_applicability_unavailable" },
    })),
  };
  return fromWitness(witness);
}
function fromWitness(witness: OriginalApplicabilityWitness) {
  const witnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(original),
    tag: "known",
    units: witness.sourceUnits,
    witness: { reference: "authored synthetic original requirements", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const extracted = { pages: [{ pageNumber: 1, text: original.toString("utf8"), metadata: {} }], images: [] };
  const packet = buildGenerationRetentionPacket({
    documentId,
    generationId,
    originalBytes: original,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted,
    persistedPages: [{ page_number: 1, text: original.toString("utf8"), ocr_used: false, metadata: {} }],
  });
  const built = buildChunks([
    {
      documentId,
      pageNumber: 1,
      pageText: extracted.pages[0].text,
      images: [],
      metadata: { index_generation_id: generationId, extractor: "local-worker" },
    },
  ]);
  const chunkRows = serializeCandidateChunkRows(built, {
    documentId,
    generationId,
    cleanString: (value) => value,
    sanitizeJsonbRecord: (value) => value as Record<string, unknown>,
  });
  return { packet, originalBytes: original, witnessBytes, extracted, chunkRows, witness };
}
function readback(plan: ReturnType<typeof prepareCandidateChunks>, rows: CandidateChunkRow[]) {
  return {
    ok: true,
    chunkEvidence: rows.map((row) => ({
      preparedUnitId: { family: "chunks", key: `${row.id}:prepared` },
      finalUnitId: { family: "chunks", key: `${row.id}:final` },
      preparedSha256: plan.artifacts.find((artifact) => artifact.unitId.key === `${row.id}:prepared`)!.sha256,
      finalSha256: bytesDigest(Buffer.from(`mocked database persisted row ${row.id}`)),
      finalByteLength: 123,
    })),
  };
}
describe("managed candidate chunk production", () => {
  it("plans actual chunker output before embedding without claiming original obligations are covered", () => {
    const args = fixture();
    const before = generationEvidenceBytes(args.chunkRows).toString("hex");
    const plan = prepareCandidateChunks(args);
    expect(plan.rows).toHaveLength(args.chunkRows.length);
    expect(plan.declarations.units).toHaveLength(args.chunkRows.length * 2);
    expect(
      plan.declarations.units.every(
        (unit) => unit.required && unit.sourceEvidenceIds.length === 0 && unit.qualification === "derived_unverified",
      ),
    ).toBe(true);
    const final = plan.declarations.units.find((unit) => unit.id.key.endsWith(":final"))!;
    expect(final.dependencies).toEqual([{ family: "chunks", key: `${plan.rows[0].id}:prepared` }]);
    expect(plan.outcomes.every((outcome) => outcome.unitId.key.endsWith(":prepared"))).toBe(true);
    expect(plan.sourceCompleteness).toBe("unavailable");
    expect(plan.nativeMapping).toBe("unavailable");
    expect(generationEvidenceBytes(args.chunkRows).toString("hex")).toBe(before);
    expect(Object.isFrozen(plan.rows[0].metadata)).toBe(true);
    expect(Object.isFrozen(args.chunkRows[0].metadata)).toBe(false);
    expect(prepareCandidateChunks(fixture()).artifacts).toEqual(plan.artifacts);
  });
  it("uses complete declarations and prepared retention before the actual injected embedding/persistence seams", async () => {
    const plan = prepareCandidateChunks(fixture());
    const operations: string[] = [];
    const mutation = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      operations.push(name);
      if (name === "write_ingestion_base_artifacts") {
        expect(payload.p_images).toEqual([]);
        expect(payload.p_embedding_fields).toEqual([]);
        return readback(plan, payload.p_chunks as CandidateChunkRow[]);
      }
      return name === "record_ingestion_generation_accounting"
        ? { ok: true, accounting: { result: "unavailable" } }
        : { ok: true };
    });
    const result = await stageCandidateChunks({
      plan,
      batchSize: 2,
      mutation,
      embed: async (texts) => {
        operations.push("actual_embedding_seam_mocked");
        return texts.map(() => [0.25, -0.25]);
      },
      assertEmbedding: (embedding) => embedding,
      check: () => undefined,
    });
    expect(operations.slice(0, 4)).toEqual([
      "declare_ingestion_generation_evidence",
      "retain_ingestion_generation_artifacts",
      "record_ingestion_generation_outcomes",
      "actual_embedding_seam_mocked",
    ]);
    expect(operations).not.toContain("commit_document_index_generation");
    expect(operations).not.toContain("complete_ingestion_job");
    expect(operations).not.toContain("finish_ingestion_job_stage");
    expect(result).toMatchObject({ result: "unavailable", persistedChunks: plan.rows.length, stages: "incomplete" });
    const retained = mutation.mock.calls.filter(([name]) => name === "retain_ingestion_generation_artifacts");
    expect(retained).toHaveLength(1); // SQL, never the caller, supplies final artifacts.
  });
  it("leaves required finals missing when the real provider seam fails", async () => {
    const plan = prepareCandidateChunks(fixture());
    const mutation = vi.fn(async () => ({ ok: true }));
    await expect(
      stageCandidateChunks({
        plan,
        batchSize: 5,
        mutation,
        embed: async () => {
          throw new Error("synthetic provider failure");
        },
        assertEmbedding: (embedding) => embedding,
        check: () => undefined,
      }),
    ).rejects.toThrow("synthetic provider failure");
    expect(mutation.mock.calls).toHaveLength(3);
    expect(
      plan.declarations.units.filter((unit) => unit.id.key.endsWith(":final")).every((unit) => unit.required),
    ).toBe(true);
  });
  it("refuses a missing embedding or foreign/duplicate database evidence without manufacturing final outcomes", async () => {
    const plan = prepareCandidateChunks(fixture());
    for (const corrupt of [
      "missing_embedding",
      "foreign",
      "duplicate",
      "wrong_prepared_hash",
      "missing_final",
    ] as const) {
      const mutation = vi.fn(async (name: string, payload: Record<string, unknown>) => {
        if (name !== "write_ingestion_base_artifacts") return { ok: true };
        const result = readback(plan, payload.p_chunks as CandidateChunkRow[]);
        if (corrupt === "foreign") result.chunkEvidence[0].finalUnitId.key = `${generationId}:final`;
        if (corrupt === "duplicate") result.chunkEvidence.push(result.chunkEvidence[0]);
        if (corrupt === "wrong_prepared_hash")
          result.chunkEvidence[0].preparedSha256 = bytesDigest(Buffer.from("foreign"));
        if (corrupt === "missing_final") result.chunkEvidence = [];
        return result;
      });
      await expect(
        stageCandidateChunks({
          plan,
          batchSize: 5,
          mutation,
          embed: async (texts) => (corrupt === "missing_embedding" ? [] : texts.map(() => [0.1])),
          assertEmbedding: (embedding) => embedding,
          check: () => undefined,
        }),
      ).rejects.toThrow(
        corrupt === "missing_embedding"
          ? "candidate_chunks_embedding_population_mismatch"
          : "candidate_chunks_readback_mismatch",
      );
      expect(mutation.mock.calls.some(([name]) => name === "record_ingestion_generation_accounting")).toBe(false);
    }
  });
  it("does not infer empty image applicability from extracted survivors or opaque/absent witnesses", () => {
    const args = fixture();
    expect(() => prepareCandidateChunks({ ...args, witnessBytes: undefined })).toThrow(
      "candidate_chunks_original_applicability_unavailable",
    );
    const unknown = structuredClone(args.witness);
    unknown.groups.find((group) => group.family === "images")!.population = {
      tag: "unknown",
      limitation: "unknown original media",
    };
    expect(() => prepareCandidateChunks(fromWitness(unknown))).toThrow("candidate_chunks_image_stage_unavailable");
    const required = structuredClone(args.witness);
    required.groups.find((group) => group.family === "images")!.population = {
      tag: "known",
      requirements: [{ id: "authored-media", required: true, sourceEvidenceIds: ["scope"] }],
      basis: { scope: "whole_original", kind: "independent_original_declaration" },
      reason: null,
    };
    expect(() => prepareCandidateChunks(fromWitness(required))).toThrow("candidate_chunks_image_stage_unavailable");
    expect(() =>
      prepareCandidateChunks({
        ...args,
        extracted: { ...args.extracted, images: [{ pageNumber: 1, path: "unused", mimeType: "image/png" }] },
      }),
    ).toThrow("candidate_chunks_image_stage_unavailable");
  });
  it("refuses changed original/extracted bytes, forged retained references, duplicate indices, and wrong generation", () => {
    const args = fixture();
    expect(() => prepareCandidateChunks({ ...args, originalBytes: Buffer.from("changed") })).toThrow();
    expect(() =>
      prepareCandidateChunks({
        ...args,
        extracted: { ...args.extracted, pages: [{ ...args.extracted.pages[0], text: "changed" }] },
      }),
    ).toThrow("candidate_chunks_identity_mismatch");
    const packet = structuredClone(args.packet);
    packet.artifacts.find((artifact) => artifact.representation === "persisted_utf8")!.bytesHex = "00";
    expect(() => prepareCandidateChunks({ ...args, packet })).toThrow("retained_artifact_bytes_mismatch");
    expect(() => prepareCandidateChunks({ ...args, chunkRows: [...args.chunkRows, args.chunkRows[0]] })).toThrow(
      "candidate_chunks_identity_mismatch",
    );
    expect(() =>
      prepareCandidateChunks({
        ...args,
        chunkRows: args.chunkRows.map((row) => ({ ...row, index_generation_id: documentId })),
      }),
    ).toThrow("candidate_chunks_identity_mismatch");
    expect(() => prepareCandidateChunks({ ...args, chunkRows: [] })).toThrow("candidate_chunks_identity_mismatch");
  });
  it("guards transport accessors before they can execute and returns fixed row refusal details", () => {
    const args = fixture();
    const getter = vi.fn(() => "PRIVATE_SENTINEL");
    Object.defineProperty(args.chunkRows[0], "content", { get: getter, enumerable: true });
    expect(() => prepareCandidateChunks(args)).toThrow("generation_evidence_requires_plain_data");
    expect(getter).not.toHaveBeenCalled();
    const malformed = fixture();
    Object.assign(malformed.chunkRows[0], { PRIVATE_SENTINEL: "private details" });
    expect(() => prepareCandidateChunks(malformed)).toThrow("candidate_chunks_identity_mismatch");
  });
  it("supports null logical page for document-strategy output with actual retained page dependencies", () => {
    const args = fixture();
    args.chunkRows[0].page_number = null;
    const plan = prepareCandidateChunks(args);
    expect(plan.declarations.units[0].dependencies).toContainEqual({ family: "pages", key: "1" });
    expect(plan.rows[0].page_number).toBeNull();
  });
  it("shares the ordinary row projection and preserves the existing whitespace-normalized content hash", () => {
    const args = fixture();
    const built = buildChunks([
      {
        documentId,
        pageNumber: 1,
        pageText: original.toString("utf8"),
        images: [],
        metadata: { index_generation_id: generationId },
      },
    ]);
    const sanitation = {
      cleanString: (value: string) => value.replace(/\0/g, ""),
      sanitizeJsonbRecord: (value: unknown) => value as Record<string, unknown>,
    };
    const ordinary = serializeChunkForPersistence(built[0], { ...sanitation, id: args.chunkRows[0].id, generationId });
    const managed = serializeCandidateChunkRows(built, { ...sanitation, documentId, generationId })[0];
    expect(managed).toEqual({
      ...ordinary,
      retrieval_synopsis: ordinary.retrieval_synopsis ?? null,
      heading_level: ordinary.heading_level ?? null,
    });
    expect(managed.id).toBe(candidateChunkId(documentId, generationId, 0));
    expect(candidateChunkId(documentId, documentId, 0)).not.toBe(managed.id);
    expect(ordinary.content_hash).toBe(
      createHash("sha256")
        .update(`${built[0].section_heading ?? ""}\n${built[0].content}`.replace(/\s+/g, " ").trim())
        .digest("hex"),
    );
  });
});

// Independently authored synthetic unit fixture, without native/source acceptance.
function scopedFixture() {
  const columns = ["Scenario", "Concentration", "Amount", "Volume", "Interval"];
  const cells = [
    ["Q-A", "0.5 mg/mL", "2 mg", "4 mL", "24 h"],
    ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"],
  ];
  const qualificationText =
    "Rows A and B are alternative QA scenarios. Do not combine them. No conversion to a real medicine is supported.";
  const narrative =
    "SYNTHETIC QA ONLY\n| Scenario | Concentration | Amount | Volume | Interval |\n| --- | --- | --- | --- | --- |\n| Q-A | 0.5 mg/mL | 2 mg | 4 mL | 24 h |\n| Q-B | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |\n" +
    qualificationText;
  const source = Buffer.from("Synthetic original unit fixture: original pages remain unverified.");
  const sourceUnits = Array.from({ length: 8 }, (_, i) => ({
    id: `E-Q0${i + 1}`,
    required: true as const,
    dependencies: i === 2 || i === 3 ? ["E-Q01", "E-Q05"] : [],
    locator: `authored-${i + 1}`,
    nativeMapping: "unavailable" as const,
  }));
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(source),
    sourceByteLength: source.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: { tag: "unknown" as const, limitation: "Full original population remains unknown" },
    })),
  };
  const witnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(source),
    tag: "known",
    units: sourceUnits,
    witness: { reference: "independent authored mock", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const descriptors = [
    {
      pageNumber: 2,
      mimeType: "image/png",
      sourceKind: "table_crop" as const,
      metadata: {
        table_columns: columns,
        table_rows: [columns, ...cells],
        table_title: null,
        table_role: "unclear",
        table_text: narrative
          .split("\n")
          .filter((line) => line.startsWith("|"))
          .join("\n"),
      },
    },
    {
      pageNumber: 1,
      mimeType: "image/png",
      sourceKind: "cover_page" as const,
      metadata: { candidate_type: "document_cover" },
    },
  ];
  const extracted = {
    pages: [1, 2, 3].map((pageNumber) => ({
      pageNumber,
      text: pageNumber === 2 ? narrative : `Synthetic page ${pageNumber}`,
      metadata: {},
    })),
    images: descriptors.map((d, i) => ({ ...d, path: `mock-${i}` })),
  };
  const packet = buildGenerationRetentionPacket({
    documentId,
    generationId,
    originalBytes: source,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted,
    persistedPages: extracted.pages.map((p) => ({
      page_number: p.pageNumber,
      text: p.text,
      ocr_used: false,
      metadata: {},
    })),
    capturedImages: descriptors.map((descriptor, i) => {
      const b = Buffer.from(`mock binary ${i}`);
      return { ordinal: i + 1, descriptor, bytesHex: b.toString("hex"), sha256: bytesDigest(b), byteLength: b.length };
    }),
  });
  const ownerId = "00000000-0000-4000-8000-000000000009";
  const images: CandidateImageRow[] = descriptors.map((descriptor, i) => ({
    id: `00000000-0000-4000-8000-00000000001${i}`,
    document_id: documentId,
    owner_id: ownerId,
    index_generation_id: generationId,
    page_number: descriptor.pageNumber,
    capture_ordinal: i + 1,
    caption: null,
    image_type: null,
    labels: null,
    clinical_relevance_score: null,
    source_kind: descriptor.sourceKind,
    descriptor,
    metadata: { ...descriptor.metadata, index_generation_id: generationId },
  }));
  const base = fixture().chunkRows[0];
  const chunk = {
    ...base,
    id: "00000000-0000-4000-8000-000000000030",
    page_number: 2,
    content: narrative,
    image_ids: [images[0].id],
    content_hash: createHash("sha256")
      .update(`${base.section_heading ?? ""}\n${narrative}`.replace(/\s+/g, " ").trim())
      .digest("hex"),
  };
  const facts: CandidateTableFactRow[] = cells.map((row, i) => ({
    id: `00000000-0000-4000-8000-00000000002${i}`,
    document_id: documentId,
    owner_id: ownerId,
    index_generation_id: generationId,
    source_chunk_id: chunk.id,
    source_image_id: images[0].id,
    page_number: 2,
    table_title: null,
    row_label: row[0],
    clinical_parameter: row[0],
    threshold_value: null,
    action: null,
    normalized_terms: [],
    metadata: { row_index: i + 1, cells: row, columns, index_generation_id: generationId },
  }));
  function refs(keys: string[]) {
    return packet.artifacts
      .filter((a) => a.unitId.family === "private_objects" && keys.includes(a.unitId.key))
      .map(({ unitId, sha256, byteLength, representation }) => ({ unitId, sha256, byteLength, representation }));
  }
  const common = ["original-source", "original-source-expectation-witness"];
  const imageEntries = images.map((image) => ({
    family: "images" as const,
    row: image,
    dependencies: [],
    references: refs([...common, `image:${image.capture_ordinal}:binary`, `image:${image.capture_ordinal}:provenance`]),
    sourceEvidenceIds: [],
  }));
  const pageRefs = refs([...common, "page:2:persisted", "image:1:binary", "image:1:provenance"]);
  const manifest = {
    version: "ingestion-private-scoped-manifest-v1" as const,
    projectionId: "00000000-0000-4000-8000-000000000040",
    scope: "fixed_capture_projection" as const,
    qualification: "derived_unverified" as const,
    identity: {
      documentId,
      ownerId,
      generationId,
      jobId: "00000000-0000-4000-8000-000000000050",
      leaseToken: "00000000-0000-4000-8000-000000000060",
      authorityDigest: bytesDigest(Buffer.from("mock authority")),
      admissionEventId: "00000000-0000-4000-8000-000000000070",
      sourceSha256: bytesDigest(source),
      sourceByteLength: source.length,
      sourceExpectationDigest: packet.registration.sourceExpectationSha256,
    },
    basis: [
      {
        reference: "independently authored synthetic projection",
        sha256: generationEvidenceDigest({ columns, cells, narrative }),
      },
    ],
    originalUnits: sourceUnits,
    qualificationText,
    generatedImageAnnotation: "",
    expectedRows: [
      ...imageEntries,
      {
        family: "chunks" as const,
        row: chunk,
        dependencies: [{ family: "images" as const, rowId: images[0].id }],
        references: pageRefs,
        sourceEvidenceIds: [],
      },
      ...facts.map((row) => ({
        family: "table_facts" as const,
        row,
        dependencies: [
          { family: "images" as const, rowId: images[0].id },
          { family: "chunks" as const, rowId: chunk.id },
        ],
        references: pageRefs,
        sourceEvidenceIds: [],
      })),
    ],
    wholeOriginalFamilies: "unknown" as const,
    sourceCompleteness: "unavailable" as const,
    nativeMapping: "unavailable" as const,
  };
  return { packet, originalBytes: source, witnessBytes, extracted, manifest };
}

describe("explicit private fixed-capture projection", () => {
  it("prepares exactly five rows without adding whole-original declarations or outcomes", () => {
    const args = scopedFixture();
    const before = generationEvidenceBytes(args.packet);
    const plan = prepareScopedCandidateProjection(args);
    expect(plan.prepared).toHaveLength(5);
    expect(plan.manifestData.expectedRows.map((e) => e.family)).toEqual([
      "images",
      "images",
      "chunks",
      "table_facts",
      "table_facts",
    ]);
    expect(plan).not.toHaveProperty("declarations");
    expect(plan).not.toHaveProperty("outcomes");
    expect(generationEvidenceBytes(args.packet)).toEqual(before);
    expect(plan.manifestData.wholeOriginalFamilies).toBe("unknown");
    expect(plan.wholeOriginalReadiness).toBe("unavailable");
    expect(() => prepareCandidateChunks({ ...args, chunkRows: [] })).toThrow(
      "candidate_chunks_image_stage_unavailable",
    );
  });
  it("rejects a whole-original known claim, missing witness, or changed retained capture bytes", () => {
    const args = scopedFixture();
    expect(() => prepareScopedCandidateProjection({ ...args, witnessBytes: Buffer.from("changed") })).toThrow();
    const packet = structuredClone(args.packet);
    packet.artifacts.find((a) => a.representation === "image_binary")!.bytesHex = "00";
    expect(() => prepareScopedCandidateProjection({ ...args, packet })).toThrow();
    const witness = JSON.parse(args.witnessBytes.toString("utf8"));
    witness.groups[0].population = {
      tag: "known",
      requirements: [],
      basis: { scope: "whole_original", kind: "independent_original_declaration" },
      reason: "no_original_requirements_in_scope",
    };
    expect(() =>
      prepareScopedCandidateProjection({ ...args, witnessBytes: generationEvidenceBytes(witness) }),
    ).toThrow();
  });
  it("refuses population, cover, page, owner, mapping and neutral-cell substitutions", () => {
    for (const mutate of [
      (m: ReturnType<typeof scopedFixture>["manifest"]) => m.expectedRows.pop(),
      (m: ReturnType<typeof scopedFixture>["manifest"]) => {
        m.expectedRows[1].row.page_number = 2;
      },
      (m: ReturnType<typeof scopedFixture>["manifest"]) => {
        m.identity.ownerId = documentId;
      },
      (m: ReturnType<typeof scopedFixture>["manifest"]) => {
        Object.assign(m.expectedRows[0], { sourceEvidenceIds: ["E-Q01"] });
      },
      (m: ReturnType<typeof scopedFixture>["manifest"]) => {
        Object.assign(m.expectedRows[3].row, { threshold_value: "0.5 mg/mL" });
      },
      (m: ReturnType<typeof scopedFixture>["manifest"]) => {
        Object.assign(m.expectedRows[4].row.metadata, { cells: ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "24 h"] });
      },
    ]) {
      const args = scopedFixture();
      mutate(args.manifest);
      expect(() => prepareScopedCandidateProjection(args)).toThrow();
    }
  });
  it("permits only the exact predeclared descriptor tag after the entire source narrative", () => {
    const args = scopedFixture();
    const image = args.manifest.expectedRows[0].row as CandidateImageRow;
    const descriptor = image.descriptor as { metadata: { table_text: string } };
    const annotation = `[[IMAGE_DATA_START]] Image ID: ${image.id}; Source kind: table_crop; Table role: unclear; Table text: ${descriptor.metadata.table_text.replace(/\s+/g, " ").trim()}; Description:  [[IMAGE_DATA_END]]`;
    args.manifest.generatedImageAnnotation = annotation;
    const chunk = args.manifest.expectedRows[2].row as CandidateChunkRow;
    chunk.content += "\n\n" + annotation;
    chunk.content_hash = createHash("sha256")
      .update(`${chunk.section_heading ?? ""}\n${chunk.content}`.replace(/\s+/g, " ").trim())
      .digest("hex");
    expect(prepareScopedCandidateProjection(args).prepared).toHaveLength(5);
    args.manifest.generatedImageAnnotation = annotation.replace(
      "Description: ",
      "Description: clinical action invented",
    );
    expect(() => prepareScopedCandidateProjection(args)).toThrow();
  });
  it("refuses missing Q05 and exact source narrative changes even with a recomputed content hash", () => {
    const args = scopedFixture();
    const row = args.manifest.expectedRows[2].row as CandidateChunkRow;
    row.content = row.content.replace("Do not combine them.", "Do combine them.");
    row.content_hash = createHash("sha256")
      .update(`${row.section_heading ?? ""}\n${row.content}`.replace(/\s+/g, " ").trim())
      .digest("hex");
    expect(() => prepareScopedCandidateProjection(args)).toThrow();
  });
  it("retains all prepared rows before private images, chunks and facts, without embedding effects", async () => {
    const args = scopedFixture();
    const plan = prepareScopedCandidateProjection(args);
    const phases: string[] = [];
    const mutation = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      if (name === "begin_ingestion_generation_evidence") {
        phases.push("register");
        return { ok: true, projectionId: plan.projectionId };
      }
      expect(name).toBe("retain_ingestion_generation_artifacts");
      const p = payload.p_artifacts as { phase: string; family?: string; rows?: unknown[] };
      phases.push(p.phase === "prepared" ? "prepared" : p.family!);
      return p.phase === "prepared"
        ? { ok: true, projectionId: plan.projectionId, preparedCount: 5 }
        : { ok: true, projectionId: plan.projectionId, family: p.family, rowCount: p.rows!.length };
    });
    await stageScopedCandidateProjection({ plan, originalBytes: args.originalBytes, mutation, check: () => {} });
    expect(phases).toEqual(["register", "prepared", "images", "chunks", "table_facts"]);
  });
  it("stops before row effects when actual registration or prepared response is missing", async () => {
    const args = scopedFixture();
    const plan = prepareScopedCandidateProjection(args);
    const mutation = vi.fn(async () => ({ ok: true }));
    await expect(
      stageScopedCandidateProjection({ plan, originalBytes: args.originalBytes, mutation, check: () => {} }),
    ).rejects.toThrow("private_scoped_projection_identity_mismatch");
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});
