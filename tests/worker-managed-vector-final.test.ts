import { createHash } from "node:crypto";
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
import {
  decodeManagedVectorFinalReadback,
  prepareManagedVectorFinalPacket,
  preflightManagedVectorFinal,
  produceManagedVectorFinalPacket,
  stageManagedVectorFinal,
  type ManagedVectorFinalPacket,
} from "../worker/managed-vector-final";
vi.mock("../src/lib/openai", () => {
  throw new Error("provider import forbidden in managed final rows");
});
vi.mock("../src/lib/supabase/admin", () => {
  throw new Error("database import forbidden in managed final rows");
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
function fixture(withImage = false) {
  const text =
    "SYNTHETIC QA ONLY. Review the specimen weekly. Monitor its synthetic QA marker and document the QA observation.";
  const originalBytes = Buffer.from(text);
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
      population: { tag: "unknown", limitation: "synthetic applicability unassessed" },
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
  const descriptor = {
    pageNumber: 1,
    mimeType: "image/png",
    sourceKind: "table_crop" as const,
    bbox: [1, 2, 30, 40] as [number, number, number, number],
    width: 30,
    height: 40,
    metadata: { synthetic: "unclassified pixels" },
  };
  const image = Buffer.from([0, 1, 255, 42, 0]);
  const extracted = {
    pages: [{ pageNumber: 1, text, ocrUsed: false, metadata: {} }],
    images: withImage ? [{ ...descriptor, path: "synthetic-unused-path" }] : [],
  };
  const base = buildGenerationRetentionPacket({
    documentId: issued.documentId,
    generationId: issued.generationId,
    originalBytes,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted,
    persistedPages: [{ page_number: 1, text, ocr_used: false, metadata: {} }],
    capturedImages: withImage
      ? [
          {
            ordinal: 1,
            descriptor,
            bytesHex: image.toString("hex"),
            sha256: bytesDigest(image),
            byteLength: image.length,
          },
        ]
      : [],
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
        title: "Synthetic final vector QA",
        file_name: "synthetic.txt",
        file_type: "text/plain",
        storage_path: "synthetic-private.txt",
        source_path: "synthetic/qa.txt",
        metadata: {},
      },
    },
  };
  const plan = prepareManagedPrivateSupplier(input);
  const basis = { input, issued: { ...issued }, expectedPlanDigest: plan.digest };
  const callbacks = {
    batchSize: 500,
    embed: vi.fn(async (texts: string[]) => texts.map(() => Array(1536).fill(0.1) as number[])),
    assertEmbedding: (values: number[]) => values,
    check: vi.fn(() => {}),
  };
  return { basis, plan, callbacks };
}

// Explicit synthetic SQL-response fixture. PostgreSQL JSONB key order and whitespace
// differ from JSON.stringify; this formatter tests byte authentication without SQL execution.
function sqlText(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(sqlText).join(", ")}]`;
  if (x !== null && typeof x === "object")
    return `{${Object.entries(x)
      .sort(([a], [b]) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([k, v]) => `${JSON.stringify(k)}: ${sqlText(v)}`)
      .join(", ")}}`;
  return JSON.stringify(x);
}
const commitment = (x: unknown) => {
  const bytes = Buffer.from(sqlText(x));
  return { bytesHex: bytes.toString("hex"), sha256: bytesDigest(bytes), byteLength: bytes.length };
};
function mockSqlResponse(f: ReturnType<typeof fixture>, packet: ManagedVectorFinalPacket) {
  const identity = {
    ...packet.issued,
    ownerId: f.basis.input.job.documents.owner_id,
    sourceSha256: f.plan.source.sha256,
    sourceByteLength: f.plan.source.byteLength,
    sourceExpectationDigest: f.plan.retentionPacket.registration.sourceExpectationSha256,
  };
  const units = new Map(
    f.plan.producerManifests
      .flatMap((m) => m.units)
      .map((u) => [`${u.declaration.id.family}:${u.declaration.id.key}`, u]),
  );
  const artifacts = new Map(
    [...f.plan.retentionPacket.artifacts, ...[...units.values()].map((u) => u.artifact)].map((a) => [
      `${a.unitId.family}:${a.unitId.key}`,
      a,
    ]),
  );
  const normalized = new Map<string, Record<string, unknown>>(
    packet.rows.map((row) => {
      const body = clone(row.body);
      body.embedding = (body.embedding as number[]).map(Math.fround);
      body.metadata = {
        ...(body.metadata as object),
        index_generation_id: packet.issued.generationId,
        ingestion_job_kind: "node",
        ingestion_job_id: packet.issued.jobId,
        ingestion_lease_token: packet.issued.firstLeaseToken,
      };
      if (row.family !== "chunks") body.index_generation_id = packet.issued.generationId;
      if (row.family === "embedding_fields")
        body.content_hash = createHash("md5")
          .update(body.content as string)
          .digest("hex");
      if (row.family === "index_units") {
        body.producer = "local-worker";
        body.artifact_generation_id = packet.issued.generationId;
        body.quality_score = Math.fround(body.quality_score as number);
      }
      return [`${row.family}:${body.id}`, body] as const;
    }),
  );
  const counts = { chunks: 0, embedding_fields: 0, index_units: 0 };
  const rows = packet.rows.map((row) => {
    counts[row.family]++;
    const k = `${row.family}:${row.body.id}`;
    const u = units.get(k)!;
    const a = u.artifact;
    const prepared = { unitId: a.unitId, sha256: a.sha256, byteLength: a.byteLength, locator: a.locator };
    const parents = u.declaration.dependencies.map((dep) => {
      const a = artifacts.get(`${dep.family}:${dep.key}`)!;
      return dep.family === "chunks"
        ? {
            kind: "row",
            unitId: dep,
            preparedSha256: a.sha256,
            preparedByteLength: a.byteLength,
            finalIdentity: { version: "managed-vector-final-row-v1", family: "chunks", rowId: dep.key },
            normalizedRowSha256: commitment(normalized.get(`${dep.family}:${dep.key}`)).sha256,
          }
        : {
            kind: "retained",
            unitId: dep,
            sha256: a.sha256,
            byteLength: a.byteLength,
            representation: a.representation,
          };
    });
    const body = normalized.get(k)!;
    const text = Buffer.from(u.providerInputText!);
    const receipt = commitment({
      version: "managed-vector-final-row-v1",
      qualification: "derived_unverified",
      identity,
      family: row.family,
      groupKey: "worker_core",
      rowId: row.body.id,
      prepared,
      parents,
      vectorInput: { sha256: bytesDigest(text), byteLength: text.length, provenance: "supplied_unverified" },
      row: body,
    });
    return { family: row.family, rowId: row.body.id, prepared, row: body, receipt };
  });
  const population = rows.map((row) => ({
    family: row.family,
    rowId: row.rowId,
    preparedSha256: row.prepared.sha256,
    preparedByteLength: row.prepared.byteLength,
    normalizedRowSha256: commitment(row.row).sha256,
    receiptSha256: row.receipt.sha256,
  }));
  const populationCommitment = commitment({
    version: "managed-vector-final-population-v1",
    identity,
    planDigest: packet.planDigest,
    population,
  });
  return {
    ok: true,
    managedVectorFinalRows: {
      version: "managed-vector-final-readback-v1",
      status: "retained_unverified",
      activated: false,
      terminalEligibility: "unavailable",
      providerExecution: "unverified",
      identity,
      planDigest: packet.planDigest,
      sqlPopulationDigest: populationCommitment.sha256,
      populationCommitment,
      counts,
      rows,
    },
  };
}
async function prepared() {
  const f = fixture();
  const vectors = await produceManagedProviderVectors({ ...f.basis, ...f.callbacks });
  const packet = prepareManagedVectorFinalPacket({ ...f.basis, vectors });
  return { f, vectors, packet, response: mockSqlResponse(f, packet) };
}
describe("managed private vector final packet", () => {
  it("preserves actual complete prepared bodies and declarations, sorts UUIDs, and authenticates SQL-formatted receipt bytes", async () => {
    const { f, packet, response } = await prepared();
    const before = generationEvidenceDigest(f.plan);
    const decoded = decodeManagedVectorFinalReadback({ ...f.basis, packet, response });
    expect(decoded.counts.chunks).toBeGreaterThan(0);
    expect(decoded.counts.embedding_fields).toBeGreaterThan(0);
    expect(decoded.counts.index_units).toBeGreaterThan(0);
    expect(decoded.activated).toBe(false);
    expect(decoded.providerExecution).toBe("unverified");
    expect(Object.isFrozen(decoded.rows[0].row)).toBe(true);
    expect(generationEvidenceDigest(prepareManagedPrivateSupplier(f.basis.input))).toBe(before);
    for (const row of packet.rows) {
      const u = f.plan.producerManifests.flatMap((m) => m.units).find((u) => u.declaration.id.key === row.body.id)!;
      expect(row.preparedArtifact).toEqual(u.artifact);
      const { id: rowId, embedding, ...body } = row.body;
      void embedding;
      if (row.family === "chunks") expect({ ...body, id: rowId }).toEqual(u.body);
      else expect(body).toEqual(u.body);
    }
  });
  it("refuses omitted families, duplicate rows and changed prepared bytes before transport", async () => {
    const { f, vectors } = await prepared();
    for (const rows of [
      vectors.rows.filter((row) => row.family !== "embedding_fields"),
      [...vectors.rows.slice(1), vectors.rows[1]],
    ])
      expect(() => prepareManagedVectorFinalPacket({ ...f.basis, vectors: { ...vectors, rows } })).toThrow(
        "population_mismatch",
      );
    const changed = clone(vectors);
    changed.rows[0].preparedArtifact.bytesHex = "00";
    expect(() => prepareManagedVectorFinalPacket({ ...f.basis, vectors: changed })).toThrow("population_mismatch");
    const body = clone(vectors);
    body.rows[0].body.content = "invented";
    expect(() => prepareManagedVectorFinalPacket({ ...f.basis, vectors: body })).toThrow("prepared_body_changed");
  });
  it("refuses oversized numeric data and wrong dimensions before writes", async () => {
    const { f, vectors } = await prepared();
    for (const [value, reason] of [
      [Array(1535).fill(0), "invalid_vector"],
      [Array(1536).fill(1e39), "generation_evidence_requires_plain_data"],
    ] as const) {
      const changed = clone(vectors);
      changed.rows[0].body.embedding = [...value];
      expect(() => prepareManagedVectorFinalPacket({ ...f.basis, vectors: changed })).toThrow(reason);
    }
  });
  it("refuses foreign full issued identity and data accessors without evaluating them", async () => {
    const { f, packet, response } = await prepared();
    expect(() =>
      decodeManagedVectorFinalReadback({
        ...f.basis,
        issued: { ...f.basis.issued, attemptNumber: 2 },
        packet,
        response,
      }),
    ).toThrow("plan_identity_mismatch");
    const getter = vi.fn(() => true);
    const guarded = {};
    Object.defineProperty(guarded, "ok", { enumerable: true, get: getter });
    expect(() => decodeManagedVectorFinalReadback({ ...f.basis, packet, response: guarded })).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(["counts", "identity", "bytes", "metadata", "vector", "parent", "input", "population"])(
    "rejects synthetic rehashed or mismatched %s readback",
    async (kind) => {
      const { f, packet, response } = await prepared();
      const r = clone(response);
      const out = r.managedVectorFinalRows;
      if (kind === "counts") out.counts.chunks++;
      if (kind === "identity") out.identity.attemptNumber++;
      if (kind === "bytes") out.rows[0].receipt.bytesHex = "00";
      if (kind === "metadata") out.rows[0].row.metadata = { forged: true };
      if (kind === "vector") (out.rows[0].row.embedding as number[])[0] = 2;
      if (["parent", "input"].includes(kind)) {
        const row = out.rows.find((r) => r.family === "embedding_fields")!;
        const body = JSON.parse(Buffer.from(row.receipt.bytesHex, "hex").toString()) as Record<string, unknown>;
        if (kind === "parent") body.parents = [];
        else
          body.vectorInput = {
            sha256: bytesDigest(Buffer.from("invented")),
            byteLength: 8,
            provenance: "supplied_unverified",
          };
        row.receipt = commitment(body);
      }
      if (kind === "population") {
        const body = JSON.parse(Buffer.from(out.populationCommitment.bytesHex, "hex").toString());
        body.population.pop();
        out.populationCommitment = commitment(body);
        out.sqlPopulationDigest = out.populationCommitment.sha256;
      }
      expect(() => decodeManagedVectorFinalReadback({ ...f.basis, packet, response: r })).toThrow();
    },
  );
  it("refuses actual image-associated prepared text plan before injected provider work", async () => {
    const f = fixture(true);
    expect(() => preflightManagedVectorFinal(f.basis)).toThrow("parent_not_staged");
    await expect(produceManagedVectorFinalPacket({ ...f.basis, ...f.callbacks })).rejects.toThrow("parent_not_staged");
    expect(f.callbacks.embed).not.toHaveBeenCalled();
  });
  it("uses separate writer and wrapped reader, preserves deterministic replay and captures trusted callbacks", async () => {
    const { f, packet, response } = await prepared();
    const fence = {
      job_kind: "node" as const,
      job_id: f.basis.issued.jobId,
      document_id: f.basis.issued.documentId,
      worker_id: f.basis.issued.workerId,
      lease_token: f.basis.issued.firstLeaseToken,
      expected_generation_id: null,
      authority_digest: f.basis.issued.authorityDigest,
    };
    const writeRpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      void name;
      void payload;
      return clone(response);
    });
    const readRpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      void name;
      void payload;
      return clone(response);
    });
    const args: Parameters<typeof stageManagedVectorFinal>[0] = {
      ...f.basis,
      packet,
      fence,
      writeRpc,
      readRpc,
      check: vi.fn(() => {}),
    };
    const first = await stageManagedVectorFinal(args);
    expect(await stageManagedVectorFinal(args)).toEqual(first);
    expect(writeRpc.mock.calls[0][0]).toBe("write_ingestion_base_artifacts");
    expect(readRpc.mock.calls[0][0]).toBe("read_ingestion_prepared_supplier_artifacts");
    const readPayload = readRpc.mock.calls[0][1];
    expect(readPayload.p_fence).toEqual({
      version: "managed-vector-final-read-v1",
      fence,
      expectedPlanDigest: f.plan.digest,
    });
    let cancelled = false;
    args.check = () => {
      if (cancelled) throw new Error("cancelled");
    };
    args.writeRpc = async () => {
      cancelled = true;
      args.check = () => {};
      return clone(response);
    };
    await expect(stageManagedVectorFinal(args)).rejects.toThrow("cancelled");
    expect(readRpc).toHaveBeenCalledTimes(2);
  });
  it("refuses input mutation across a successful write acknowledgement before reading", async () => {
    const { f, packet, response } = await prepared();
    const readRpc = vi.fn(async () => response);
    const fence = {
      job_kind: "node" as const,
      job_id: f.basis.issued.jobId,
      document_id: f.basis.issued.documentId,
      worker_id: f.basis.issued.workerId,
      lease_token: f.basis.issued.firstLeaseToken,
      expected_generation_id: null,
      authority_digest: f.basis.issued.authorityDigest,
    };
    await expect(
      stageManagedVectorFinal({
        ...f.basis,
        packet,
        fence,
        check: () => {},
        readRpc,
        writeRpc: async () => {
          f.basis.input.job.documents.title = "changed";
          return response;
        },
      }),
    ).rejects.toThrow("plan_identity_mismatch");
    expect(readRpc).not.toHaveBeenCalled();
  });
});
