import { describe, expect, it } from "vitest";
import {
  matchesShadowCoreStoredRowV1,
  matchesShadowPrivateObjectAttachmentV1,
  type ShadowCoreFamilyV1,
  type ShadowCoreMemberBindingV1,
  type ShadowCoreAnchorRepairV1,
} from "../scripts/lib/reindex-core-row-reconciliation";
import { createHash } from "node:crypto";

const binding: ShadowCoreMemberBindingV1 = Object.freeze({
  documentId: "11111111-1111-1111-1111-111111111111",
  ownerId: "22222222-2222-2222-2222-222222222222",
  candidateGenerationId: "33333333-3333-3333-3333-333333333333",
  jobId: "44444444-4444-4444-4444-444444444444",
  firstLeaseToken: "55555555-5555-5555-5555-555555555555",
});
const id = "66666666-6666-6666-6666-666666666666";
const time = "2026-09-13T01:02:03.123456+00:00";
const embedding = Object.freeze(Array.from({ length: 1536 }, (_, index) => index === 0 ? 0.1 : 0));
const metadata = Object.freeze({ source: "synthetic", qualification: "Only after assessment" });
const stampedMetadata = Object.freeze({ ...metadata, index_generation_id: binding.candidateGenerationId,
  ingestion_job_kind: "node", ingestion_job_id: binding.jobId, ingestion_lease_token: binding.firstLeaseToken });
type Fixture = { family: ShadowCoreFamilyV1; input: Record<string, unknown>; stored: Record<string, unknown> };

function chunk(): Fixture {
  return { family: "chunks", input: { id, document_id: binding.documentId, chunk_index: 0, content: "Full evidence", metadata, embedding },
    stored: { id, document_id: binding.documentId, page_number: null, chunk_index: 0, section_heading: null,
      section_path: [], heading_level: null, parent_heading: null, anchor_id: null, content: "Full evidence",
      retrieval_synopsis: null, content_hash: null, index_generation_id: binding.candidateGenerationId, token_estimate: 0,
      image_ids: [], metadata: stampedMetadata, embedding: JSON.stringify(embedding), created_at: time, search_tsv: "'evid':2 'full':1" } };
}
function image(): Fixture {
  return { family: "images", input: { id, document_id: binding.documentId, storage_path: "private/synthetic.png", labels: [], metadata,
      caption_confidence: 0.7 },
    stored: { id, document_id: binding.documentId, page_number: null, storage_path: "private/synthetic.png", mime_type: "image/png",
      caption: "", bbox: null, image_type: "unclear", searchable: true, clinical_relevance_score: 0, skip_reason: null,
      source_kind: "embedded", width: null, height: null, image_hash: null, perceptual_hash: null, labels: [],
      index_generation_id: binding.candidateGenerationId, caption_confidence: 0.7, clinical_priority_score: null,
      crop_completeness: null, image_quality_score: null, ocr_text_density: null, structured_extraction_confidence: null,
      visual_duplicate_group: null, metadata: stampedMetadata, created_at: time } };
}
function fact(): Fixture {
  return { family: "table_facts", input: { id, document_id: binding.documentId, threshold_value: "5 mg", action: "Review", metadata },
    stored: { id, owner_id: binding.ownerId, document_id: binding.documentId, source_chunk_id: null, source_image_id: null,
      page_number: null, table_title: null, row_label: null, clinical_parameter: null, threshold_value: "5 mg", action: "Review",
      normalized_terms: [], index_generation_id: binding.candidateGenerationId, metadata: stampedMetadata,
      created_at: time, search_tsv: "'5':1 'mg':2 'review':3" } };
}
function field(): Fixture {
  return { family: "embedding_fields", input: { id, document_id: binding.documentId, field_type: "clinical_action",
      content: "Review", content_hash: "synthetic-hash", embedding, metadata },
    stored: { id, owner_id: binding.ownerId, document_id: binding.documentId, source_chunk_id: null, field_type: "clinical_action",
      content: "Review", content_hash: "synthetic-hash", embedding: JSON.stringify(embedding),
      index_generation_id: binding.candidateGenerationId, metadata: stampedMetadata, created_at: time, search_tsv: "'review':1" } };
}
function unit(): Fixture {
  return { family: "index_units", input: { id, document_id: binding.documentId, unit_type: "clinical_fact", title: "Qualification",
      content: "Only after assessment", embedding, metadata },
    stored: { id, owner_id: binding.ownerId, document_id: binding.documentId, unit_type: "clinical_fact", source_chunk_id: null,
      source_image_id: null, page_start: null, page_end: null, heading_path: [], title: "Qualification", content: "Only after assessment",
      normalized_terms: [], source_span: null, quality_score: 0.7, extraction_mode: "deterministic",
      index_generation_id: binding.candidateGenerationId, producer: "local-worker", artifact_generation_id: null,
      embedding: JSON.stringify(embedding), metadata: stampedMetadata, created_at: time, updated_at: time, search_tsv: "'assess':3" } };
}
function page(): Fixture {
  const pageMetadata = { ...metadata, ranges: [{ start: 0, end: 12, relation: "qualifier" }], lateEvidence: "Final qualification" };
  return { family: "pages", input: {
    input: { document_id: binding.documentId, page_number: 1, text: "Full evidence", ocr_used: false, metadata: pageMetadata },
    extractedPage: { pageNumber: 1, text: "Full\\u0000 evidence", needsOcr: true },
  }, stored: { id, document_id: binding.documentId, index_generation_id: binding.candidateGenerationId,
    page_number: 1, text: "Full evidence", ocr_used: false,
    metadata: { ...pageMetadata, ...stampedMetadata }, created_at: time } };
}
function matches(fixture: Fixture) {
  return matchesShadowCoreStoredRowV1(fixture.family, binding, fixture.input, fixture.stored);
}

describe("matchesShadowCoreStoredRowV1", () => {
  it("reconciles all six complete after-images and their distinct server defaults", () => {
    for (const fixture of [chunk(), image(), fact(), field(), unit(), page()]) expect(matches(fixture), fixture.family).toBe(true);
    const publicFact = fact();
    publicFact.stored.owner_id = null;
    expect(matchesShadowCoreStoredRowV1("table_facts", { ...binding, ownerId: null }, publicFact.input, publicFact.stored)).toBe(true);
  });

  it("refuses changed native semantics or changed retained rows even when transport bytes could be rehashed", () => {
    const changedNative = fact();
    changedNative.input.threshold_value = "50 mg";
    expect(matches(changedNative)).toBe(false);
    const changedStored = chunk();
    changedStored.stored.content = "Different evidence";
    expect(matches(changedStored)).toBe(false);
    const missingQualifier = unit();
    missingQualifier.stored.metadata = { ...stampedMetadata, qualification: "" };
    expect(matches(missingQualifier)).toBe(false);
  });

  it("binds owner, candidate and first lease token independently", () => {
    for (const key of ["ownerId", "candidateGenerationId", "firstLeaseToken"] as const) {
      const fixture = fact();
      expect(matchesShadowCoreStoredRowV1(fixture.family, { ...binding, [key]: id }, fixture.input, fixture.stored), key).toBe(false);
    }
    const wrongStamp = chunk();
    wrongStamp.stored.metadata = { ...stampedMetadata, ingestion_job_id: id };
    expect(matches(wrongStamp)).toBe(false);
  });

  it("compares exact float32 vector values rather than doubles, norms or tolerances", () => {
    const rounded = field();
    rounded.stored.embedding = JSON.stringify(embedding.map(Math.fround));
    expect(matches(rounded)).toBe(true);
    const different = field();
    different.stored.embedding = JSON.stringify(embedding.map((value, index) => index === 0 ? 0.10000001 : value));
    expect(matches(different)).toBe(false);
    for (const invalid of [[0.1], [...embedding.slice(1), 1e40], [...embedding.slice(1), 1e-50]]) {
      const fixture = field(); fixture.input.embedding = invalid;
      expect(matches(fixture)).toBe(false);
    }
    const midpoint = field();
    midpoint.input.embedding = embedding.map((value, index) => index === 0 ? 1 + 2 ** -24 : value);
    midpoint.stored.embedding = JSON.stringify(embedding.map((value, index) => index === 0 ? 1 : value));
    expect(matches(midpoint)).toBe(false);
  });

  it("preserves page native text, OCR state and complete metadata without inventing normalization", () => {
    const changedNative = page();
    (changedNative.input.extractedPage as Record<string, unknown>).text = "Other evidence";
    expect(matches(changedNative)).toBe(false);
    const changedMetadata = page();
    changedMetadata.stored.metadata = { ...stampedMetadata };
    expect(matches(changedMetadata)).toBe(false);
    const changedOcr = page(); changedOcr.stored.ocr_used = true;
    expect(matches(changedOcr)).toBe(false);
    const rawNul = page(); (rawNul.input.extractedPage as Record<string, unknown>).text = "Full\u0000 evidence";
    expect(matches(rawNul)).toBe(false);
  });

  it("refuses unknown native and stored columns and missing generated columns", () => {
    const nativeExtra = chunk(); nativeExtra.input.hidden_context = "Unexpected";
    expect(matches(nativeExtra)).toBe(false);
    const storedExtra = image(); storedExtra.stored.hidden_context = "Unexpected";
    expect(matches(storedExtra)).toBe(false);
    const generatedMissing = unit(); delete generatedMissing.stored.updated_at;
    expect(matches(generatedMissing)).toBe(false);
    const badTimestamp = page(); badTimestamp.stored.created_at = "2026-02-30T00:00:00Z";
    expect(matches(badTimestamp)).toBe(false);
    badTimestamp.stored.created_at = "0000-01-01T00:00:00Z";
    expect(matches(badTimestamp)).toBe(false);
  });

  it("refuses anchor repair until its separate admitted repair proof is supplied by integration", () => {
    const fixture = chunk(); fixture.stored.anchor_id = "repaired-anchor";
    expect(matches(fixture)).toBe(false);
  });

  it("does not invoke getters or accept unknown PostgreSQL coercions", () => {
    let invoked = false;
    const fixture = chunk();
    Object.defineProperty(fixture.input, "content", { enumerable: true, get() { invoked = true; return "Full evidence"; } });
    expect(matches(fixture)).toBe(false);
    expect(invoked).toBe(false);
    const coercion = chunk(); coercion.input.chunk_index = "0";
    expect(matches(coercion)).toBe(false);
    const explicitNull = chunk(); explicitNull.input.section_path = null;
    expect(matches(explicitNull)).toBe(false);
  });

  it("reconciles an admitted null-anchor repair without changing either original input", () => {
    const fixture = chunk();
    const repair: ShadowCoreAnchorRepairV1 = Object.freeze({ chunkId: id, anchorId: "section-1",
      documentIntelligenceVersion: "document-intelligence-v2" });
    fixture.stored.anchor_id = repair.anchorId;
    fixture.stored.metadata = { ...stampedMetadata, anchor_id: repair.anchorId, anchor_repaired_by: repair.documentIntelligenceVersion };
    const before = JSON.stringify(fixture);
    expect(matchesShadowCoreStoredRowV1("chunks", binding, fixture.input, fixture.stored, repair)).toBe(true);
    expect(JSON.stringify(fixture)).toBe(before);
    expect(matches(fixture)).toBe(false);
  });

  it("refuses unrelated semantic or metadata substitutions alongside an admitted anchor repair", () => {
    const repair: ShadowCoreAnchorRepairV1 = { chunkId: id, anchorId: "section-1", documentIntelligenceVersion: "document-intelligence-v2" };
    for (const tamper of ["metadata", "content"] as const) {
      const fixture = chunk();
      fixture.stored.anchor_id = repair.anchorId;
      fixture.stored.metadata = { ...stampedMetadata, anchor_id: repair.anchorId, anchor_repaired_by: repair.documentIntelligenceVersion };
      if (tamper === "metadata") fixture.stored.metadata = { ...fixture.stored.metadata as Record<string, unknown>, extra_semantics: "unadmitted" };
      else fixture.stored.content = "Changed evidence";
      expect(matchesShadowCoreStoredRowV1("chunks", binding, fixture.input, fixture.stored, repair), tamper).toBe(false);
    }
  });

  it("refuses mismatched or malformed descriptors, other families and preexisting anchors", () => {
    const repair: ShadowCoreAnchorRepairV1 = { chunkId: id, anchorId: "section-1", documentIntelligenceVersion: "document-intelligence-v2" };
    const fixture = chunk();
    fixture.stored.anchor_id = repair.anchorId;
    fixture.stored.metadata = { ...stampedMetadata, anchor_id: repair.anchorId, anchor_repaired_by: repair.documentIntelligenceVersion };
    for (const invalid of [
      { ...repair, chunkId: binding.documentId }, { ...repair, anchorId: "other-anchor" },
      { ...repair, documentIntelligenceVersion: "document-intelligence-v1" }, { ...repair, extra: true },
    ]) expect(matchesShadowCoreStoredRowV1("chunks", binding, fixture.input, fixture.stored, invalid as ShadowCoreAnchorRepairV1)).toBe(false);
    fixture.input.anchor_id = "preexisting-anchor";
    expect(matchesShadowCoreStoredRowV1("chunks", binding, fixture.input, fixture.stored, repair)).toBe(false);
    const otherFamily = image();
    expect(matchesShadowCoreStoredRowV1("images", binding, otherFamily.input, otherFamily.stored, repair)).toBe(false);
  });
});

describe("matchesShadowPrivateObjectAttachmentV1", () => {
  const content = Buffer.from("complete synthetic image bytes");
  const imageHash = createHash("sha256").update(content).digest("hex");
  const objectPath = `${binding.documentId}/${binding.firstLeaseToken}/${binding.candidateGenerationId}/${id}.png`;
  const planned = {
    tag: "private_object",
    ref: { tag: "private_object", bucket: "synthetic-private-images", objectPath, objectVersion: null,
      sha256: `sha256:${imageHash}`, byteLength: content.length, mediaType: "image/png" },
    bytes: { encoding: "base64", content: content.toString("base64") },
  };
  const stored = { ...image().stored, storage_path: objectPath, image_hash: imageHash,
    metadata: { ...stampedMetadata, extractor: "local-worker", image_hash: imageHash } };

  it("matches canonical retained bytes to their exact local-worker image attachment", () => {
    expect(matchesShadowPrivateObjectAttachmentV1(binding, planned, stored)).toBe(true);
  });

  it.each([
    ["owner format", { ...binding, ownerId: "not-a-uuid" }, planned, stored],
    ["generation", { ...binding, candidateGenerationId: "77777777-7777-7777-7777-777777777777" }, planned, stored],
    ["hash", binding, { ...planned, ref: { ...planned.ref, sha256: `sha256:${"a".repeat(64)}` } }, stored],
    ["MIME", binding, { ...planned, ref: { ...planned.ref, mediaType: "image/webp" } }, stored],
    ["path", binding, { ...planned, ref: { ...planned.ref, objectPath: `${objectPath}.other` } }, stored],
  ] as const)("refuses wrong %s attachment evidence", (_name, candidateBinding, candidatePlan, candidateStored) => {
    expect(matchesShadowPrivateObjectAttachmentV1(candidateBinding, candidatePlan, candidateStored)).toBe(false);
  });

  it.each([
    ["noncanonical", { ...planned, bytes: { ...planned.bytes, content: `${planned.bytes.content}\n` } }],
    ["length", { ...planned, ref: { ...planned.ref, byteLength: planned.ref.byteLength + 1 } }],
    ["encoding", { ...planned, bytes: { ...planned.bytes, encoding: "utf8" } }],
  ])("refuses malformed %s byte evidence", (_name, candidate) => {
    expect(matchesShadowPrivateObjectAttachmentV1(binding, candidate, stored)).toBe(false);
  });

  it.each([
    ["outer", { ...planned, provenance: "invented" }],
    ["reference", { ...planned, ref: { ...planned.ref, provenance: "invented" } }],
    ["bytes", { ...planned, bytes: { ...planned.bytes, byteLength: content.length } }],
  ])("refuses unknown %s fields", (_name, candidate) => {
    expect(matchesShadowPrivateObjectAttachmentV1(binding, candidate, stored)).toBe(false);
  });

  it("does not invoke attachment accessors", () => {
    let invoked = false;
    const accessor = { ...planned };
    Object.defineProperty(accessor, "ref", { enumerable: true, get() { invoked = true; return planned.ref; } });
    expect(matchesShadowPrivateObjectAttachmentV1(binding, accessor, stored)).toBe(false);
    expect(invoked).toBe(false);
  });
});
