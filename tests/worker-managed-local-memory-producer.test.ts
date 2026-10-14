import { describe, expect, it, vi } from "vitest";
import * as memory from "../src/lib/deep-memory-preparation";
import { buildDocumentIndexUnitInputs } from "../src/lib/document-index-units";
import {
  generationEvidenceBytes,
  generationEvidenceDigest,
  type IssuedAttemptControl,
} from "../src/lib/ingestion-generation-evidence";
import { candidateChunkId } from "../worker/candidate-chunks";
import { prepareManagedLocalMemoryProducer } from "../worker/managed-local-memory-producer";
import type { WholeOriginalPreparedUnit } from "../worker/whole-original-supplier";

// Throw at module evaluation, before any provider or persistence function could run.
vi.mock("@/lib/openai", () => {
  throw new Error("provider import forbidden in pure preparation");
});
vi.mock("@/lib/model-index-extraction", () => {
  throw new Error("model producer import forbidden in pure preparation");
});
vi.mock("@/lib/supabase/admin", () => {
  throw new Error("database import forbidden in pure preparation");
});
vi.mock("@/lib/deep-memory", () => {
  throw new Error("persistence module import forbidden in pure preparation");
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const issued: IssuedAttemptControl = {
    documentId: id(1),
    generationId: id(2),
    jobId: id(3),
    workerId: "synthetic-worker",
    firstLeaseToken: id(4),
    attemptNumber: 1,
    batchId: null,
    authorityDigest: generationEvidenceDigest("synthetic authority"),
    predecessorGenerationId: id(8),
  };
  const document = {
    id: id(1),
    owner_id: id(5),
    title: "Synthetic QA protocol",
    file_name: "synthetic.txt",
    source_path: "synthetic/qa.txt",
    metadata: { index_generation_id: id(8) },
  };
  const chunks = [
    "SYNTHETIC QA ONLY. Review the specimen weekly and document the synthetic observation in the QA record.",
    "SYNTHETIC QA ONLY. Monitor the second specimen monthly. Escalate the synthetic alarm immediately to the QA reviewer.",
  ].map((content, chunk_index) => ({
    id: candidateChunkId(id(1), id(2), chunk_index),
    document_id: id(1),
    page_number: 1,
    chunk_index,
    section_heading: "Synthetic observations",
    section_path: ["Synthetic observations"],
    heading_level: 1,
    parent_heading: null,
    anchor_id: null,
    content,
    retrieval_synopsis: null,
    token_estimate: 30,
    image_ids: [] as string[],
    content_hash: "synthetic",
    index_generation_id: id(2),
    metadata: { index_generation_id: id(2), source_path: document.source_path },
  }));
  const image = {
    id: id(6),
    document_id: id(1),
    owner_id: id(5),
    index_generation_id: id(2),
    page_number: 1,
    capture_ordinal: 1,
    caption: null,
    image_type: null,
    labels: null,
    clinical_relevance_score: null,
    source_kind: "embedded_image",
    descriptor: {},
    metadata: {},
  };
  const prepared = (
    family: "chunks" | "images",
    body: typeof image | (typeof chunks)[number],
    auxiliary = false,
  ): WholeOriginalPreparedUnit => {
    const planningId = { family, key: body.id };
    const bytes = generationEvidenceBytes(body);
    return {
      declaration: {
        id: planningId,
        groupKey: "worker_core",
        required: true,
        dependencies: [],
        sourceEvidenceIds: [],
        qualification: "derived_unverified",
        representation: "provenance_json",
      },
      body,
      artifact: {
        unitId: planningId,
        groupKey: "worker_core",
        representation: "provenance_json",
        bytesHex: bytes.toString("hex"),
        byteLength: bytes.length,
        sha256: generationEvidenceDigest(body),
        locator: "synthetic",
      },
      providerInputText: null,
      inputReferences: [],
      originalReferences: [],
      auxiliary,
    };
  };
  const coreUnits = [...chunks.map((chunk) => prepared("chunks", chunk)), prepared("images", image)];
  return { document, issued, coreUnits, chunks, image, prepared };
}

function prepare(input: Parameters<typeof prepareManagedLocalMemoryProducer>[0]) {
  return prepareManagedLocalMemoryProducer({
    document: input.document,
    issued: input.issued,
    coreUnits: input.coreUnits,
  });
}
describe("managed deterministic local memory producer", () => {
  it("returns genuine builder bodies with separate disjoint stable planning identities", () => {
    const input = fixture();
    const sections = memory.buildDocumentSections(input);
    const memoryCards = memory.buildDocumentMemoryCards({
      ...input,
      images: [input.image],
      sections,
      modelProfile: null,
    });
    const indexes = buildDocumentIndexUnitInputs({
      ...input,
      sections,
      modelProfile: null,
      summary: null,
      images: [{ id: input.image.id, pageNumber: 1, sourceKind: input.image.source_kind, caption: null, metadata: {} }],
    });
    const output = prepare(input);
    expect(output.sections.map((row) => row.body)).toEqual(sections);
    expect(output.memoryCards.map((row) => row.body)).toEqual(memoryCards);
    expect(output.indexUnits.map((row) => row.body)).toEqual(indexes);
    expect(output).toEqual(prepare(input));
    const keys = [...output.sections, ...output.memoryCards, ...output.indexUnits].map((row) => row.planningId.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(input.coreUnits.some((unit) => unit.declaration.id.key === key)).toBe(false);
    }
    expect(input.document.metadata.index_generation_id).toBe(id(8));
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.memoryCards[0].body)).toBe(true);
  });

  it("keeps section-summary chunks even when the builder has empty source_chunk_ids", () => {
    const input = fixture();
    const output = prepare(input);
    const summary = output.memoryCards.find((row) => row.body.card_type === "section_summary")!;
    expect(summary.body.source_chunk_ids).toEqual([]);
    expect(summary.body.metadata?.chunk_ids).toEqual(input.chunks.map((chunk) => chunk.id));
    expect(summary.body.section_id).toBeNull();
    expect(summary.dependencies).toEqual([
      ...input.chunks.map((chunk) => ({ family: "chunks", key: chunk.id })),
      output.sections[0].planningId,
    ]);
    const index = output.indexUnits.find((row) => row.body.metadata.source === "document_sections")!;
    expect(index.dependencies).toEqual(summary.dependencies);
    expect(output.sections[0].dependencies).toEqual(input.chunks.map((chunk) => ({ family: "chunks", key: chunk.id })));
    const sourcedCard = output.memoryCards.find((row) => row.body.source_chunk_ids.length > 0)!;
    expect(sourcedCard.body.source_image_ids).toEqual([input.image.id]);
    expect(sourcedCard.dependencies).toContainEqual({ family: "images", key: input.image.id });
    expect(sourcedCard.dependencies).toContainEqual({ family: "chunks", key: sourcedCard.body.source_chunk_ids[0] });
  });

  it("excludes retained auxiliary covers and refuses inconsistent classification", () => {
    const input = fixture();
    const cover = { ...input.image, id: id(9), source_kind: "cover_page" };
    input.coreUnits.push(input.prepared("images", cover, true));
    const output = prepare(input);
    expect(
      [...output.memoryCards, ...output.indexUnits]
        .flatMap((row) => row.dependencies)
        .some((ref) => ref.key === cover.id),
    ).toBe(false);
    input.coreUnits.at(-1)!.auxiliary = false;
    expect(() => prepare(input)).toThrow("auxiliary_classification_mismatch");
  });

  it.each([
    "document",
    "owner",
    "generation",
    "metadata_generation",
    "source",
    "image_owner",
    "image_generation",
    "parent",
    "group",
    "future_id",
  ])("refuses %s drift before calling builders", (caseName) => {
    const input = fixture();
    const chunk = input.coreUnits[0].body as (typeof input.chunks)[number];
    const image = input.coreUnits[2].body as typeof input.image;
    if (caseName === "document") input.document.id = id(10);
    if (caseName === "owner") input.document.owner_id = id(10);
    if (caseName === "generation") chunk.index_generation_id = id(10);
    if (caseName === "metadata_generation") chunk.metadata.index_generation_id = id(10);
    if (caseName === "source") chunk.metadata.source_path = "synthetic/foreign.txt";
    if (caseName === "image_owner") image.owner_id = id(10);
    if (caseName === "image_generation") image.index_generation_id = id(10);
    if (caseName === "parent") chunk.image_ids = [id(10)];
    if (caseName === "group") input.coreUnits[0].declaration.groupKey = "deep_memory";
    if (caseName === "future_id") {
      chunk.id = candidateChunkId(id(1), id(10), chunk.chunk_index);
      input.coreUnits[0].declaration.id.key = chunk.id;
    }
    expect(() => prepare(input)).toThrow(/managed_local_memory_/);
  });

  it("refuses missing current chunks, wrapper identity drift and accessor inputs", () => {
    const input = fixture();
    expect(() => prepare({ ...input, coreUnits: [] })).toThrow("chunks_required");
    input.coreUnits[0].declaration.id.key = id(10);
    expect(() => prepare(input)).toThrow("chunk_control_mismatch");
    const clean = fixture();
    const getter = vi.fn(() => id(1));
    Object.defineProperty(clean.document, "id", { get: getter, enumerable: true });
    expect(() => prepare(clean)).toThrow("generation_evidence_requires_plain_data");
    expect(getter).not.toHaveBeenCalled();
  });

  it("bounds content before invoking the existing producers", () => {
    const input = fixture();
    (input.coreUnits[0].body as (typeof input.chunks)[number]).content = "S".repeat(4_000_001);
    expect(() => prepare(input)).toThrow("input_budget_exceeded");
  });

  it("produces data-only bodies without undefined optional section_index values", () => {
    const output = prepare(fixture());
    for (const entry of [...output.sections, ...output.memoryCards, ...output.indexUnits])
      expect(() => generationEvidenceBytes(entry.body)).not.toThrow();
    for (const entry of output.memoryCards) {
      expect(entry.body.section_index).toEqual(expect.any(Number));
      expect(entry.body.section_id).toBeNull();
    }
    // Existing general-purpose builders can return an optional undefined index when
    // explicitly supplied no sections. Preserve that API; the managed producer
    // supplies its actual generated sections, so no omission/normalization is needed.
    const input = fixture();
    const unsectioned = memory.buildDocumentMemoryCards({
      document: input.document,
      chunks: input.chunks,
      sections: [],
      images: [],
      modelProfile: null,
    });
    expect(unsectioned.some((card) => Object.hasOwn(card, "section_index") && card.section_index === undefined)).toBe(
      true,
    );
  });

  it("does not call providers or persistence, or create vector/model/alias/summary evidence", () => {
    const output = prepare(fixture());
    expect(Object.keys(output).sort()).toEqual(["indexUnits", "memoryCards", "sections"]);
    for (const row of [...output.sections, ...output.memoryCards, ...output.indexUnits]) {
      expect(row.body).not.toHaveProperty("embedding");
      expect(row.body).not.toHaveProperty("id");
      expect(row.body.metadata?.model_profile_version ?? null).toBeNull();
      expect(String(row.body.metadata?.source ?? "")).not.toContain("model_");
    }
    expect(output.indexUnits.some((row) => ["alias", "vocabulary_term"].includes(row.body.unit_type))).toBe(false);
  });
});
