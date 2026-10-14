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
import { expectedNormalized, pin } from "../worker/managed-vector-final";
import {
  decodeManagedNativeParentClosureReadback,
  preflightManagedNativeParentClosure,
  produceManagedNativeParentClosurePacket,
  stageManagedNativeParentClosure,
  type ManagedNativeParentClosurePacket,
} from "../worker/managed-native-parent-closure";
vi.mock("../src/lib/openai", () => {
  throw new Error("provider import forbidden in native closure");
});
vi.mock("../src/lib/supabase/admin", () => {
  throw new Error("database import forbidden in native closure");
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
function fixture(withImage = true, withTable = false, includeLocalMemory = false) {
  const columns = ["Scenario", "Concentration", "Amount", "Volume", "Interval"];
  const tableRows = [
    columns,
    ["Q-A", "0.5 mg/mL", "2 mg", "4 mL", "24 h"],
    ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"],
  ];
  const markdown = [columns, columns.map(() => "---"), ...tableRows.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
  const text =
    "SYNTHETIC QA ONLY. Review the specimen weekly. Monitor its synthetic QA marker and document the QA observation." +
    (withTable ? "\n" + markdown : "");
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
    metadata: withTable
      ? {
          candidate_type: "table",
          source_kind: "table_crop",
          extraction_method: "pymupdf_find_tables",
          pageNumber: 1,
          table_index: 1,
          table_rows: tableRows,
          table_columns: columns,
          row_count: 3,
          column_count: 5,
          rows_truncated: false,
          table_role: "unclear",
          table_title: null,
          table_label: null,
          table_text: markdown,
          accessible_table_markdown: markdown,
        }
      : { synthetic: "unclassified pixels" },
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
    includeLocalMemory,
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

// Explicit synthetic five-family SQL response; real SQL execution belongs to root's separate proof.
function mockSqlResponse(f: ReturnType<typeof fixture>, packet: ManagedNativeParentClosurePacket) {
  const basis = preflightManagedNativeParentClosure(f.basis);
  const identity = {
    ...packet.issued,
    ownerId: f.basis.input.job.documents.owner_id,
    sourceSha256: f.plan.source.sha256,
    sourceByteLength: f.plan.source.byteLength,
    sourceExpectationDigest: f.plan.retentionPacket.registration.sourceExpectationSha256,
  };
  const ordered = [...basis.selected].sort((a, b) => {
    const aId = `${a.declaration.id.family}:${a.declaration.id.key}`,
      bId = `${b.declaration.id.family}:${b.declaration.id.key}`;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
  const kind = (family: string) =>
    family === "images"
      ? "private_image_capture_capsule"
      : family === "table_facts"
        ? "private_local_native_table_fact"
        : "private_supplied_vector_row";
  const normalized = new Map<string, Record<string, unknown>>(
    ordered.map((unit) => {
      const vector = packet.rows.find(
        (r) => r.family === unit.declaration.id.family && r.preparedUnitId.key === unit.declaration.id.key,
      );
      const row: Record<string, unknown> = vector
        ? expectedNormalized(vector, packet.issued)
        : (clone(unit.body) as Record<string, unknown>);
      if (vector) {
        row.embedding = vector.body.embedding.map(Math.fround);
        if (vector.family === "index_units") row.quality_score = Math.fround(row.quality_score as number);
      }
      return [`${unit.declaration.id.family}:${unit.declaration.id.key}`, row] as const;
    }),
  );
  const retained = (
    a: ReturnType<typeof preflightManagedNativeParentClosure>["artifacts"] extends Map<string, infer A> ? A : never,
  ) => ({
    kind: "retained",
    unitId: a.unitId,
    sha256: a.sha256,
    byteLength: a.byteLength,
    representation: a.representation,
  });
  const rows = ordered.map((unit) => {
    const { family, key: rowId } = unit.declaration.id;
    const id = `${family}:${rowId}`;
    const parents = unit.declaration.dependencies.map((dep) => {
      const artifact = basis.artifacts.get(`${dep.family}:${dep.key}`)!;
      const parent = normalized.get(`${dep.family}:${dep.key}`);
      return parent
        ? {
            kind: "row",
            unitId: dep,
            preparedSha256: artifact.sha256,
            preparedByteLength: artifact.byteLength,
            finalIdentity: { version: "managed-native-parent-closure-row-v1", family: dep.family, rowId: dep.key },
            normalizedRowSha256: commitment(parent).sha256,
          }
        : retained(artifact);
    });
    const text = unit.providerInputText === null ? null : Buffer.from(unit.providerInputText);
    const provenance = basis.provenance.get(id);
    const body = {
      version: "managed-native-parent-closure-row-v1",
      qualification: "derived_unverified",
      identity,
      planDigest: packet.planDigest,
      projectionId: packet.issued.generationId,
      family,
      groupKey: "worker_core",
      rowId,
      rowKind: kind(family),
      prepared: pin(unit.artifact),
      parents,
      retainedReferences: provenance ? [retained(provenance)] : [],
      vectorInput: text
        ? { sha256: bytesDigest(text), byteLength: text.length, provenance: "supplied_unverified" }
        : null,
      row: normalized.get(id)!,
    };
    return { family, rowId, rowKind: kind(family), prepared: body.prepared, row: body.row, receipt: commitment(body) };
  });
  const manifest = commitment({
    version: "managed-native-parent-closure-manifest-v1",
    qualification: "derived_unverified",
    scope: "complete_known_local_worker_core_output",
    identity,
    planDigest: packet.planDigest,
    projectionId: packet.issued.generationId,
    sourceExpectation: f.plan.retentionPacket.registration.sourceExpectation,
    groups: basis.groups.map((g) => ({ family: g.family, groupKey: g.groupKey, declaration: g.declaration })),
    units: ordered.map((u) => ({ declaration: u.declaration, prepared: pin(u.artifact) })),
  });
  const populationCommitment = commitment({
    version: "managed-native-parent-closure-population-v1",
    identity,
    planDigest: packet.planDigest,
    projectionId: packet.issued.generationId,
    manifestSha256: manifest.sha256,
    population: rows.map((r) => ({
      family: r.family,
      rowId: r.rowId,
      rowKind: r.rowKind,
      preparedSha256: r.prepared.sha256,
      preparedByteLength: r.prepared.byteLength,
      normalizedRowSha256: commitment(r.row).sha256,
      receiptSha256: r.receipt.sha256,
    })),
  });
  const counts = Object.fromEntries(
    ["chunks", "embedding_fields", "images", "index_units", "table_facts"].map((family) => [
      family,
      rows.filter((r) => r.family === family).length,
    ]),
  );
  return {
    ok: true,
    managedNativeParentClosure: {
      version: "managed-native-parent-closure-readback-v1",
      status: "retained_unverified",
      activated: false,
      terminalEligibility: "unavailable",
      providerExecution: "unverified",
      imageProcessing: "capture_capsules_only",
      sourceAssessment: "unverified",
      identity,
      planDigest: packet.planDigest,
      projectionId: packet.issued.generationId,
      manifest,
      counts,
      rows,
      populationCommitment,
      sqlPopulationDigest: populationCommitment.sha256,
    },
  };
}

describe("managed native parent closure", () => {
  it.each([false, true])(
    "retains exact capture/fact bodies, complete known groups and immutable declarations (table=%s)",
    async (table) => {
      const f = fixture(true, table);
      const before = generationEvidenceDigest(f.plan);
      const packet = await produceManagedNativeParentClosurePacket({ ...f.basis, ...f.callbacks });
      const response = mockSqlResponse(f, packet);
      const decoded = decodeManagedNativeParentClosureReadback({ ...f.basis, packet, response });
      expect(decoded.counts.images).toBe(1);
      expect(decoded.counts.table_facts).toBe(table ? 2 : 0);
      expect(
        packet.parents.every((p) => Object.keys(p.preparedArtifact).sort().join(",") === "byteLength,locator,sha256"),
      ).toBe(true);
      for (const row of decoded.rows.filter((r) => ["images", "table_facts"].includes(r.family))) {
        const prepared = f.plan.producerManifests
          .flatMap((m) => m.units)
          .find((u) => u.declaration.id.key === row.rowId)!;
        expect(row.row).toEqual(prepared.body);
        const receipt = JSON.parse(Buffer.from(row.receipt.bytesHex, "hex").toString());
        expect(receipt.vectorInput).toBeNull();
        expect(receipt.parents).toHaveLength(prepared.declaration.dependencies.length);
        expect(receipt.retainedReferences).toHaveLength(row.family === "images" ? 1 : 0);
      }
      expect(generationEvidenceDigest(f.plan)).toBe(before);
      expect(Object.isFrozen(decoded.rows)).toBe(true);
      expect(decoded.activated).toBe(false);
      expect(decoded.providerExecution).toBe("unverified");
    },
  );
  it("refuses absent image population before embedding", async () => {
    const f = fixture(false);
    await expect(produceManagedNativeParentClosurePacket({ ...f.basis, ...f.callbacks })).rejects.toThrow();
    expect(f.callbacks.embed).not.toHaveBeenCalled();
  });
  it("retains actual optional local-memory output and finalizes the complete five-family core population", async () => {
    const f = fixture(true, true, true);
    const before = generationEvidenceDigest(f.plan);
    const optional = f.plan.producerManifests.filter((m) => m.group.groupKey === "deep_memory").flatMap((m) => m.units);
    expect(optional.length).toBeGreaterThan(0);
    expect(optional.every((u) => !u.declaration.required)).toBe(true);
    const packet = await produceManagedNativeParentClosurePacket({ ...f.basis, ...f.callbacks });
    const decoded = decodeManagedNativeParentClosureReadback({
      ...f.basis,
      packet,
      response: mockSqlResponse(f, packet),
    });
    const core = f.plan.producerManifests.filter((m) => m.group.groupKey === "worker_core").flatMap((m) => m.units);
    expect(decoded.rows).toHaveLength(core.length);
    expect(packet.rows.length + packet.parents.length).toBe(core.length);
    expect(generationEvidenceDigest(prepareManagedPrivateSupplier(f.basis.input))).toBe(before);
    expect(generationEvidenceDigest(f.plan)).toBe(before);
    expect(f.plan.producerManifests.filter((m) => m.group.groupKey === "deep_memory").flatMap((m) => m.units)).toEqual(
      optional,
    );
  });
  it.each(["required unsupported group", "optional unsupported selected parent"])(
    "refuses %s before embedding",
    async (fault) => {
      const f = fixture(true, true, true);
      const actualPrepare = prepareManagedPrivateSupplier;
      // Controlled guard fault only: start from genuine complete prepared output, then isolate the unavailable contract.
      const supplier = await import("../worker/managed-prepared-supplier");
      const spy = vi.spyOn(supplier, "prepareManagedPrivateSupplier").mockImplementation((input) => {
        const plan = clone(actualPrepare(input));
        const unsupported = plan.producerManifests.find(
          (m) => m.group.family === "index_units" && m.group.groupKey === "deep_memory",
        )!.units[0];
        if (fault === "required unsupported group") unsupported.declaration.required = true;
        else
          plan.producerManifests
            .find((m) => m.group.family === "chunks" && m.group.groupKey === "worker_core")!
            .units[0].declaration.dependencies.push(unsupported.declaration.id);
        return plan;
      });
      try {
        await expect(produceManagedNativeParentClosurePacket({ ...f.basis, ...f.callbacks })).rejects.toThrow(
          "parent_not_staged",
        );
        expect(f.callbacks.embed).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    },
  );
  it("refuses foreign issued identity, malformed vector count and unsupported prepared parents", async () => {
    const f = fixture(true, true);
    await expect(
      produceManagedNativeParentClosurePacket({
        ...f.basis,
        ...f.callbacks,
        issued: { ...f.basis.issued, generationId: id(9) },
      }),
    ).rejects.toThrow();
    expect(f.callbacks.embed).not.toHaveBeenCalled();
    await expect(
      produceManagedNativeParentClosurePacket({ ...f.basis, ...f.callbacks, embed: async () => [] }),
    ).rejects.toThrow();
    await expect(
      produceManagedNativeParentClosurePacket({
        ...f.basis,
        ...f.callbacks,
        embed: async (texts) => texts.map(() => [1]),
      }),
    ).rejects.toThrow();
    const invalid = fixture(true, true);
    invalid.basis.input.retentionPacket = clone(invalid.basis.input.retentionPacket);
    invalid.basis.input.retentionPacket.artifacts.find((a) => a.representation === "image_provenance")!.sha256 =
      generationEvidenceDigest("foreign capture");
    await expect(produceManagedNativeParentClosurePacket({ ...invalid.basis, ...invalid.callbacks })).rejects.toThrow();
    expect(invalid.callbacks.embed).not.toHaveBeenCalled();
  });
  it.each([
    "counts",
    "missing",
    "metadata",
    "receipt",
    "manifest",
    "parents",
    "provenance",
    "vector",
    "identity",
    "population",
    "v1",
  ])("refuses %s readback corruption", async (fault) => {
    const f = fixture(true, true);
    const packet = await produceManagedNativeParentClosurePacket({ ...f.basis, ...f.callbacks });
    const response = mockSqlResponse(f, packet);
    const output = response.managedNativeParentClosure;
    if (fault === "counts") output.counts.images++;
    if (fault === "missing") output.rows.pop();
    if (fault === "metadata")
      (output.rows.find((r) => r.family === "images")!.row.metadata as Record<string, unknown>).captioned = true;
    if (fault === "receipt") output.rows[0].receipt.sha256 = generationEvidenceDigest("wrong");
    if (fault === "identity") output.identity.workerId = "foreign";
    if (fault === "vector") (output.rows.find((r) => r.family === "chunks")!.row.embedding as number[])[0] = 5;
    if (fault === "v1") output.version = "managed-vector-final-readback-v1";
    if (fault === "manifest") {
      const m = JSON.parse(Buffer.from(output.manifest.bytesHex, "hex").toString());
      m.groups[0].declaration.population = { tag: "unknown", limitation: "unassessed" };
      output.manifest = commitment(m);
    }
    if (fault === "population") {
      const p = JSON.parse(Buffer.from(output.populationCommitment.bytesHex, "hex").toString());
      p.population.pop();
      output.populationCommitment = commitment(p);
      output.sqlPopulationDigest = output.populationCommitment.sha256;
    }
    if (fault === "parents" || fault === "provenance") {
      const row = output.rows.find((r) => r.family === (fault === "parents" ? "table_facts" : "images"))!;
      const receipt = JSON.parse(Buffer.from(row.receipt.bytesHex, "hex").toString());
      if (fault === "parents") receipt.parents.reverse();
      else receipt.retainedReferences = [];
      row.receipt = commitment(receipt);
    }
    expect(() => decodeManagedNativeParentClosureReadback({ ...f.basis, packet, response })).toThrow();
  });
  it("uses distinct tagged reader, exact replay and captured cancellation callback", async () => {
    const f = fixture(true, true);
    const packet = await produceManagedNativeParentClosurePacket({ ...f.basis, ...f.callbacks });
    const response = mockSqlResponse(f, packet);
    const issued = packet.issued;
    const fence = {
      job_kind: "node" as const,
      job_id: issued.jobId,
      document_id: issued.documentId,
      worker_id: issued.workerId,
      lease_token: issued.firstLeaseToken,
      expected_generation_id: issued.predecessorGenerationId,
      authority_digest: issued.authorityDigest,
    };
    const writeRpc = vi.fn(async () => response);
    const readRpc = vi.fn(async () => response);
    const args = { ...f.basis, packet, fence, writeRpc, readRpc, check: () => {} };
    const first = await stageManagedNativeParentClosure(args);
    const replay = await stageManagedNativeParentClosure(args);
    expect(first).toEqual(replay);
    expect(writeRpc).toHaveBeenCalledTimes(2);
    expect(readRpc).toHaveBeenCalledTimes(2);
    expect(readRpc.mock.calls[0]).toEqual([
      "read_ingestion_prepared_supplier_artifacts",
      {
        p_generation: issued.generationId,
        p_fence: { version: "managed-native-parent-closure-read-v1", fence, expectedPlanDigest: packet.planDigest },
      },
    ]);
    let cancelled = false;
    const reader = vi.fn(async () => response);
    const cancelledArgs = {
      ...args,
      check: () => {
        if (cancelled) throw new Error("cancelled");
      },
      readRpc: reader,
      writeRpc: async () => {
        cancelled = true;
        cancelledArgs.check = () => {};
        return response;
      },
    };
    await expect(stageManagedNativeParentClosure(cancelledArgs)).rejects.toThrow("cancelled");
    expect(reader).not.toHaveBeenCalled();
  });
  it("owns vector snapshots and refuses input mutation, failure and malformed native tables before success", async () => {
    const f = fixture(true, true);
    const values = Array(1536).fill(0.25) as number[];
    const packet = await produceManagedNativeParentClosurePacket({
      ...f.basis,
      ...f.callbacks,
      embed: async (texts) => texts.map(() => values),
    });
    values[0] = 99;
    expect(packet.rows[0].body.embedding[0]).toBe(0.25);
    await expect(
      produceManagedNativeParentClosurePacket({
        ...f.basis,
        ...f.callbacks,
        embed: async () => {
          throw new Error("synthetic failure");
        },
      }),
    ).rejects.toThrow("synthetic failure");
    await expect(
      produceManagedNativeParentClosurePacket({
        ...f.basis,
        ...f.callbacks,
        embed: async (texts) => {
          f.basis.input.job.documents.title = "mutated";
          return texts.map(() => Array(1536).fill(0.1));
        },
      }),
    ).rejects.toThrow();
    const invalid = fixture(true, true);
    invalid.basis.input.extracted.images[0].metadata!.table_columns = ["unsupported"];
    await expect(produceManagedNativeParentClosurePacket({ ...invalid.basis, ...invalid.callbacks })).rejects.toThrow();
    expect(invalid.callbacks.embed).not.toHaveBeenCalled();
  });
});
