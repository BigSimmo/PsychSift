import { describe, expect, it, vi } from "vitest";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceDigest,
  originalApplicabilityFamilies,
  type IssuedAttemptControl,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { attachAttemptControlEvidence, buildGenerationRetentionPacket } from "../worker/generation-evidence";
import { prepareManagedPrivateSupplier, type ManagedPreparedSupplierInput } from "../worker/managed-prepared-supplier";
import { produceManagedProviderVectors } from "../worker/managed-provider-vectors";
import { embeddingTextForDocumentIndexUnit, type DocumentIndexUnitInput } from "../src/lib/document-index-units";

vi.mock("../src/lib/openai", () => {
  throw new Error("provider import forbidden in injected vector production");
});
vi.mock("../src/lib/supabase/admin", () => {
  throw new Error("database import forbidden in injected vector production");
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const page =
    "SYNTHETIC QA ONLY. Review the specimen weekly. Monitor its synthetic QA marker and document the QA observation.";
  const originalBytes = Buffer.from(`${page}\n\f\n${page}`);
  const sourceUnits = [
    {
      id: "authored-original",
      required: true,
      dependencies: [],
      locator: "synthetic original",
      nativeMapping: "unavailable" as const,
    },
  ];
  const witnessBytes = generationEvidenceBytes({
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: { tag: "unknown", limitation: "synthetic original applicability not assessed" },
    })),
  });
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(originalBytes),
    tag: "known",
    units: sourceUnits,
    witness: { reference: "synthetic independent witness", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const issued: IssuedAttemptControl = {
    documentId: id(1),
    generationId: id(2),
    jobId: id(3),
    workerId: "synthetic-worker",
    firstLeaseToken: id(4),
    attemptNumber: 1,
    batchId: null,
    authorityDigest: generationEvidenceDigest("synthetic authority"),
    predecessorGenerationId: null,
  };
  const extracted = {
    pages: [1, 2].map((pageNumber) => ({ pageNumber, text: page, ocrUsed: false, metadata: {} })),
    images: [],
  };
  const base = buildGenerationRetentionPacket({
    documentId: issued.documentId,
    generationId: issued.generationId,
    originalBytes,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted,
    persistedPages: extracted.pages.map((row) => ({
      page_number: row.pageNumber,
      text: row.text,
      ocr_used: false,
      metadata: {},
    })),
    capturedImages: [],
    deferOptionalProducerDeclarations: true,
  });
  const retentionPacket = attachAttemptControlEvidence({
    packet: base,
    issued,
    inventory: {
      documentId: issued.documentId,
      generationId: issued.generationId,
      jobId: issued.jobId,
      firstLeaseToken: issued.firstLeaseToken,
      authorityDigest: issued.authorityDigest,
      predecessorGenerationId: null,
      sourceSha256: bytesDigest(originalBytes),
      sourceByteLength: originalBytes.length,
      sourceExpectationDigest: base.registration.sourceExpectationSha256,
    },
  });
  const input: ManagedPreparedSupplierInput = {
    issued,
    originalBytes,
    witnessBytes,
    retentionPacket,
    extracted,
    includeLocalMemory: true,
    embeddingModel: "synthetic-model-label-only",
    indexingVersion: "synthetic-index-version",
    job: {
      id: issued.jobId,
      document_id: issued.documentId,
      locked_by: issued.workerId,
      lease_token: issued.firstLeaseToken,
      lease_expected_generation_id: null,
      lease_write_generation_id: issued.generationId,
      lease_authority_digest: issued.authorityDigest,
      lease_expires_at: "2099-01-01T00:00:00Z",
      lease_duration_seconds: 30,
      batch_id: null,
      attempt_count: 1,
      max_attempts: 3,
      documents: {
        id: issued.documentId,
        owner_id: id(5),
        title: "Synthetic vector QA",
        file_name: "synthetic.txt",
        file_type: "text/plain",
        storage_path: "synthetic-private.txt",
        source_path: "synthetic/qa.txt",
        metadata: {},
      },
    },
  };
  const plan = prepareManagedPrivateSupplier(input);
  const selected = plan.producerManifests
    .flatMap((manifest) => manifest.units)
    .filter(
      (unit) =>
        unit.declaration.groupKey === "worker_core" &&
        ["chunks", "embedding_fields", "index_units"].includes(unit.declaration.id.family) &&
        unit.providerInputText !== null,
    );
  const texts = selected.map((unit) => unit.providerInputText!);
  const unique = [...new Set(texts)];
  const embedding = (text: string) => Array.from({ length: 1536 }, () => (unique.indexOf(text) + 1) / 100);
  const args: Parameters<typeof produceManagedProviderVectors>[0] = {
    input,
    expectedPlanDigest: plan.digest,
    issued: { ...issued },
    batchSize: 2,
    embed: vi.fn(async (batch: string[]) => batch.map(embedding)),
    assertEmbedding: vi.fn((value: number[]) => value),
    check: vi.fn(() => {}),
  };
  return { args, plan, selected, texts, embedding };
}

describe("managed injected provider vector production", () => {
  it("covers all actual core vector families with their canonical provider text", async () => {
    const { args, selected } = fixture();
    expect([...new Set(selected.map((unit) => unit.declaration.id.family))].sort()).toEqual([
      "chunks",
      "embedding_fields",
      "index_units",
    ]);
    for (const unit of selected) {
      const body = unit.body as Record<string, unknown>;
      expect(unit.providerInputText).toBe(
        unit.declaration.id.family === "index_units"
          ? embeddingTextForDocumentIndexUnit(body as DocumentIndexUnitInput)
          : body.content,
      );
    }
    const output = await produceManagedProviderVectors(args);
    expect(output.rows.map((row) => row.family)).toEqual(selected.map((unit) => unit.declaration.id.family));
  });

  it("uses exact ordered provider text, preserves duplicate association and every prepared body/reference", async () => {
    const { args, plan, selected, texts, embedding } = fixture();
    const before = generationEvidenceBytes(plan);
    const result = await produceManagedProviderVectors(args);
    expect(vi.mocked(args.embed).mock.calls.flatMap(([batch]) => batch)).toEqual(texts);
    expect(new Set(texts).size).toBeLessThan(texts.length);
    expect(result.rows).toHaveLength(selected.length);
    for (const [index, row] of result.rows.entries()) {
      const unit = selected[index];
      const { id: ordinaryId, embedding: actualVector, ...unchanged } = row.body;
      const original = unit.body as Record<string, unknown>;
      const { id: originalId, ...originalFields } = original;
      expect(generationEvidenceBytes(unchanged)).toEqual(generationEvidenceBytes(originalFields));
      expect(ordinaryId).toBe(unit.declaration.id.key);
      if (originalId !== undefined) expect(ordinaryId).toBe(originalId);
      expect(actualVector).toEqual(embedding(unit.providerInputText!));
      expect(row.preparedUnitId).toEqual(unit.declaration.id);
      expect(row.preparedArtifact).toEqual(unit.artifact);
      expect(Object.isFrozen(actualVector)).toBe(true);
    }
    expect(generationEvidenceBytes(plan)).toEqual(before);
    expect(result.planDigest).toBe(plan.digest);
    expect(result.rows.every((row) => row.groupKey === "worker_core")).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["issued", "planDigest", "rows"]);
    expect(result).not.toHaveProperty("receipt");
    expect(result).not.toHaveProperty("activated");
  });

  it("owns returned vectors even when the callback and dimension checker retain mutable aliases", async () => {
    const { args, texts, embedding } = fixture();
    args.batchSize = 500;
    const shared = texts.map(embedding);
    args.embed = vi.fn(async () => shared);
    const checkerAliases: number[][] = [];
    args.assertEmbedding = vi.fn((value) => {
      checkerAliases.push(value);
      return value;
    });
    const output = await produceManagedProviderVectors(args);
    const first = output.rows[0].body.embedding[0];
    shared[0][0] = 99;
    checkerAliases[0][0] = 88;
    expect(output.rows[0].body.embedding[0]).toBe(first);
  });

  it.each(["digest", "issued", "batch", "input"])("rejects %s mismatch before embedding", async (mode) => {
    const { args } = fixture();
    if (mode === "digest") args.expectedPlanDigest = generationEvidenceDigest("foreign plan");
    if (mode === "issued") args.issued.generationId = id(99);
    if (mode === "batch") args.batchSize = 0;
    if (mode === "input") args.input.job.documents.title = "Changed prepared input";
    await expect(produceManagedProviderVectors(args)).rejects.toThrow();
    expect(args.embed).not.toHaveBeenCalled();
  });

  it.each(["short-count", "long-count", "dimension", "nan", "infinity", "string"])(
    "rejects invalid provider %s without emitting a packet",
    async (mode) => {
      const { args } = fixture();
      args.embed = vi.fn(async (texts) => {
        const vectors = texts.map(() => Array.from({ length: 1536 }, () => 0.1));
        if (mode === "short-count") vectors.pop();
        if (mode === "long-count") vectors.push([...vectors[0]]);
        if (mode === "dimension") vectors[0].pop();
        if (mode === "nan") vectors[0][0] = NaN;
        if (mode === "infinity") vectors[0][0] = Infinity;
        if (mode === "string") (vectors[0] as unknown[])[0] = "0.1";
        return vectors;
      });
      await expect(produceManagedProviderVectors(args)).rejects.toThrow();
    },
  );

  it("propagates a later provider failure rather than returning successful earlier batches", async () => {
    const { args, embedding } = fixture();
    args.batchSize = 1;
    let calls = 0;
    args.embed = vi.fn(async (texts) => {
      if (++calls === 2) throw new Error("synthetic provider failure");
      return texts.map(embedding);
    });
    await expect(produceManagedProviderVectors(args)).rejects.toThrow("synthetic provider failure");
    expect(args.embed).toHaveBeenCalledTimes(2);
  });

  it.each(["cancel", "source", "issued", "text-array"])("rejects %s drift during awaited work", async (mode) => {
    const { args, embedding } = fixture();
    let cancelled = false;
    args.check = vi.fn(() => {
      if (cancelled) throw new Error("synthetic cancellation");
    });
    args.embed = vi.fn(async (texts) => {
      const result = texts.map(embedding);
      if (mode === "cancel") cancelled = true;
      if (mode === "source") args.input.originalBytes[0] ^= 1;
      if (mode === "issued") args.issued.firstLeaseToken = id(99);
      if (mode === "text-array") texts[0] = "mutated provider input";
      await Promise.resolve();
      return result;
    });
    await expect(produceManagedProviderVectors(args)).rejects.toThrow();
    expect(args.embed).toHaveBeenCalledTimes(1);
  });

  it("rejects dimension-checker output drift and cancellation after vector validation", async () => {
    const invalid = fixture();
    invalid.args.assertEmbedding = vi.fn(() => [0.1]);
    await expect(produceManagedProviderVectors(invalid.args)).rejects.toThrow("invalid_vector");
    const changed = fixture();
    changed.args.assertEmbedding = vi.fn((value) => {
      value[0] = 7;
      return value;
    });
    await expect(produceManagedProviderVectors(changed.args)).rejects.toThrow("embedding_checker_changed_vector");
    const cancelled = fixture();
    let stop = false;
    cancelled.args.assertEmbedding = vi.fn((value) => {
      stop = true;
      return value;
    });
    cancelled.args.check = vi.fn(() => {
      if (stop) throw new Error("synthetic cancellation after validation");
    });
    await expect(produceManagedProviderVectors(cancelled.args)).rejects.toThrow(
      "synthetic cancellation after validation",
    );
    expect(cancelled.args.embed).toHaveBeenCalledTimes(1);
  });

  it("retains the original cancellation check when callbacks change during an await", async () => {
    const { args, embedding } = fixture();
    let cancelled = false;
    const originalCheck = vi.fn(() => {
      if (cancelled) throw new Error("original cancellation");
    });
    args.check = originalCheck;
    args.embed = vi.fn(async (texts) => {
      const result = texts.map(embedding);
      await Promise.resolve();
      cancelled = true;
      args.check = vi.fn(() => {});
      args.embed = vi.fn(async () => []);
      args.assertEmbedding = vi.fn(() => []);
      return result;
    });
    await expect(produceManagedProviderVectors(args)).rejects.toThrow("original cancellation");
    expect(originalCheck).toHaveBeenCalled();
    expect(args.check).not.toHaveBeenCalled();
    expect(args.embed).not.toHaveBeenCalled();
    expect(args.assertEmbedding).not.toHaveBeenCalled();
  });

  it("checks cancellation before the first provider call", async () => {
    const { args } = fixture();
    args.check = vi.fn(() => {
      throw new Error("synthetic initial cancellation");
    });
    await expect(produceManagedProviderVectors(args)).rejects.toThrow("synthetic initial cancellation");
    expect(args.embed).not.toHaveBeenCalled();
  });
});
