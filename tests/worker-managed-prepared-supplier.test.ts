import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildChunks } from "../src/lib/chunking";
import { buildDocumentIndexUnitInputs, buildVisualDocumentIndexUnitInputs } from "../src/lib/document-index-units";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceDigest,
  generationEvidenceSlots,
  originalApplicabilityFamilies,
  type IssuedAttemptControl,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { attachAttemptControlEvidence, buildGenerationRetentionPacket } from "../worker/generation-evidence";
import {
  prepareManagedPrivateSupplier,
  runManagedPrivateSupplier,
  type ManagedPreparedSupplierInput,
} from "../worker/managed-prepared-supplier";
import { buildTableFactRows } from "../worker/table-facts";
import { buildAdditionalEmbeddingFieldInputs } from "../worker/embedding-fields";
import type { WholeOriginalRoleRequirements } from "../worker/whole-original-supplier";
import { assembleWholeOriginalProducerManifest, prepareWholeOriginalSupplier } from "../worker/whole-original-supplier";
import { prepareManagedLocalMemoryProducer } from "../worker/managed-local-memory-producer";

// If a future adapter imports the provider module, fail at module evaluation before any call.
vi.mock("../src/lib/openai", () => {
  throw new Error("provider import forbidden in pure preparation");
});
vi.mock("../src/lib/supabase/admin", () => {
  throw new Error("database import forbidden in pure preparation");
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function nativeTableMetadata() {
  const columns = ["Scenario", "Concentration", "Amount", "Volume", "Interval"];
  const rows = [columns, ["Q-A", "0.5 mg/mL", "2 mg", "4 mL", "24 h"], ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"]];
  const markdown = [columns, columns.map(() => "---"), ...rows.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
  return {
    candidate_type: "table",
    source_kind: "table_crop",
    extraction_method: "pymupdf_find_tables",
    pageNumber: 2,
    table_index: 1,
    table_rows: rows,
    table_columns: columns,
    row_count: rows.length,
    column_count: columns.length,
    rows_truncated: false,
    table_role: "unclear",
    table_title: null,
    table_label: null,
    table_text: markdown,
    accessible_table_markdown: markdown,
  };
}
function fixture(
  generationId = id(2),
  nativeMetadata?: Record<string, unknown>,
  independent?: { pages: string[]; sourceUnits: NonNullable<SourceExpectation["units"]> },
  deferOptionalProducerDeclarations = true,
): ManagedPreparedSupplierInput {
  const pages = independent?.pages ?? [
    "SYNTHETIC QA ONLY. Review specimen QA marker 2 mg. END A.",
    nativeMetadata
      ? `Separate SYNTHETIC QA ONLY.\n${String(nativeMetadata.table_text ?? "")}\nRows A and B are alternative QA scenarios. Do not combine them. END B.`
      : "Separate SYNTHETIC QA ONLY. Monitor the second specimen. END B.",
  ];
  const originalBytes = Buffer.from(pages.join("\n\f\n"));
  const sourceUnits = independent?.sourceUnits ?? [
    {
      id: "authored-original",
      required: true,
      dependencies: [],
      locator: "synthetic authored original",
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
      population: { tag: "unknown", limitation: "synthetic original applicability not independently assessed" },
    })),
  });
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(originalBytes),
    tag: "known",
    units: sourceUnits,
    witness: { reference: "independent synthetic source witness", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const issued: IssuedAttemptControl = {
    documentId: id(1),
    generationId,
    jobId: id(4),
    workerId: "synthetic-worker",
    firstLeaseToken: id(5),
    attemptNumber: 1,
    batchId: null,
    authorityDigest: generationEvidenceDigest("synthetic authority"),
    predecessorGenerationId: null,
  };
  const descriptors = [
    {
      pageNumber: 1,
      mimeType: "image/png",
      sourceKind: "cover_page" as const,
      bbox: [0, 0, 10, 20] as [number, number, number, number],
      width: 10,
      height: 20,
      metadata: { synthetic: "cover bytes" },
    },
    {
      pageNumber: 2,
      mimeType: "image/png",
      sourceKind: "table_crop" as const,
      bbox: [1, 2, 30, 40] as [number, number, number, number],
      width: 30,
      height: 40,
      metadata: nativeMetadata ?? { synthetic: "unclassified pixels" },
    },
  ];
  const extracted = {
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text, ocrUsed: false, metadata: { synthetic_page: i + 1 } })),
    images: descriptors.map((d) => ({ ...d, path: "synthetic-unused-local-path" })),
  };
  const capturedImages = descriptors.map((descriptor, i) => {
    const bytes = Buffer.from([0, 1, 255, i, 42, 0]);
    return {
      ordinal: i + 1,
      descriptor,
      bytesHex: bytes.toString("hex"),
      sha256: bytesDigest(bytes),
      byteLength: bytes.length,
    };
  });
  const base = buildGenerationRetentionPacket({
    documentId: issued.documentId,
    generationId: issued.generationId,
    originalBytes,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted,
    persistedPages: pages.map((text, i) => ({
      page_number: i + 1,
      text,
      ocr_used: false,
      metadata: { synthetic_page: i + 1 },
    })),
    capturedImages,
    deferOptionalProducerDeclarations,
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
  return {
    issued,
    extracted,
    retentionPacket,
    originalBytes,
    witnessBytes,
    embeddingModel: "synthetic-embedding-label-only",
    indexingVersion: "synthetic-index-version",
    job: {
      locked_by: issued.workerId,
      lease_token: issued.firstLeaseToken,
      lease_expected_generation_id: null,
      lease_write_generation_id: issued.generationId,
      lease_authority_digest: issued.authorityDigest,
      lease_expires_at: "2099-01-01T00:00:00Z",
      lease_duration_seconds: 30,
      id: issued.jobId,
      document_id: issued.documentId,
      batch_id: null,
      attempt_count: 1,
      max_attempts: 3,
      documents: {
        id: issued.documentId,
        owner_id: id(3),
        title: "Synthetic QA",
        file_name: "synthetic.pdf",
        file_type: "application/pdf",
        storage_path: "synthetic-private.pdf",
        metadata: {},
      },
    },
  };
}
function currentInventory(plan: ReturnType<typeof prepareManagedPrivateSupplier>) {
  return {
    version: 1,
    documentId: plan.issued.documentId,
    generationId: plan.issued.generationId,
    jobId: plan.issued.jobId,
    firstLeaseToken: plan.issued.firstLeaseToken,
    authorityDigest: plan.issued.authorityDigest,
    predecessorGenerationId: plan.issued.predecessorGenerationId,
    sourceSha256: plan.source.sha256,
    sourceByteLength: plan.source.byteLength,
    sourceExpectationDigest: plan.retentionPacket.registration.sourceExpectationSha256,
    registration: plan.retentionPacket.registration,
    units: plan.declarations.units,
    groups: generationEvidenceSlots.map(([family, groupKey]) => {
      const group = plan.declarations.groups.find((g) => g.family === family && g.groupKey === groupKey);
      return { family, groupKey, state: group ? "declared" : "pending", declaration: group?.declaration ?? null };
    }),
  };
}

// Independently authored synthetic source literals, including the complete multiline qualification.
const declaredScope = "SYNTHETIC QA ONLY. Review specimen QA marker 2 mg. END A.";
const declaredQualifier =
  "Rows A and B are alternative QA scenarios. Do not combine them.\nNo conversion to a real medicine is supported.";
const declaredRows = ["| Q-A | 0.5 mg/mL | 2 mg | 4 mL | 24 h |", "| Q-B | 0.5 mg/mL | 3.5 mg | 7 mL | 48 h |"];
function declaredFixture() {
  const metadata = nativeTableMetadata();
  const input = fixture(id(2), metadata, {
    pages: [declaredScope, `Separate SYNTHETIC QA ONLY.\n${metadata.table_text}\n${declaredQualifier}`],
    sourceUnits: [
      { id: "scope", required: true, dependencies: [], locator: "authored scope", nativeMapping: "unavailable" },
      {
        id: "qualification",
        required: true,
        dependencies: [],
        locator: "authored qualification",
        nativeMapping: "unavailable",
      },
      ...["row-a", "row-b"].map((id) => ({
        id,
        required: true,
        dependencies: ["scope", "qualification"],
        locator: `authored ${id}`,
        nativeMapping: "unavailable" as const,
      })),
    ],
  });
  const baseline = prepareManagedPrivateSupplier(input);
  const units = baseline.producerManifests.flatMap((manifest) => manifest.units);
  const chunk = (page: number) =>
    units.find(
      (unit) => unit.declaration.id.family === "chunks" && (unit.body as { page_number: number }).page_number === page,
    )!;
  const pin = (unit: (typeof units)[number]) => ({
    sha256: unit.artifact.sha256,
    byteLength: unit.artifact.byteLength,
  });
  const role = (sourceEvidenceId: string, literal: string, page: number) => ({
    sourceEvidenceId,
    role: "independently authored synthetic literal",
    evidence: [
      {
        unitId: { family: "private_objects" as const, key: `page:${page}:extracted` },
        byteOffset: Buffer.from(input.extracted.pages[page - 1].text).indexOf(Buffer.from(literal)),
        bytesHex: Buffer.from(literal).toString("hex"),
      },
    ],
    candidateUnits: [chunk(page).declaration.id],
  });
  const roles: WholeOriginalRoleRequirements = {
    ...baseline.roleRequirements,
    requirements: [
      role("scope", declaredScope, 1),
      role("qualification", declaredQualifier, 2),
      role("row-a", declaredRows[0], 2),
      role("row-b", declaredRows[1], 2),
    ],
    tableRows: [
      ["Q-A", "0.5 mg/mL", "2 mg", "4 mL", "24 h"],
      ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"],
    ].map((cells, ordinal) => {
      const fact = units.find(
        (unit) =>
          unit.declaration.id.family === "table_facts" &&
          (unit.body as { metadata: { row_index: number } }).metadata.row_index === ordinal + 1,
      )!;
      const candidate = units.find(
        (unit) =>
          unit.declaration.id.family === "index_units" &&
          (unit.body as { unit_type: string; metadata: { row_index: number } }).unit_type === "table_fact" &&
          (unit.body as { metadata: { row_index: number } }).metadata.row_index === ordinal + 1,
      )!;
      const image = units.find((unit) => unit.declaration.id.family === "images" && !unit.auxiliary)!;
      return {
        sourceEvidenceId: ordinal ? "row-b" : "row-a",
        candidateUnitId: candidate.declaration.id,
        candidateArtifact: pin(candidate),
        tableFactUnitId: fact.declaration.id,
        tableFactArtifact: pin(fact),
        sourceChunkId: chunk(2).declaration.id.key,
        sourceChunkArtifact: pin(chunk(2)),
        sourceImageId: image.declaration.id.key,
        sourceImageArtifact: pin(image),
        ownerId: id(3),
        pageNumber: 2,
        tableIndex: 1,
        rowIndex: ordinal + 1,
        columns: ["Scenario", "Concentration", "Amount", "Volume", "Interval"],
        cells,
        qualifications: [
          ["scope", declaredScope, 1],
          ["qualification", declaredQualifier, 2],
        ].map(([sourceEvidenceId, literal, page]) => {
          const unit = chunk(page as number);
          return {
            sourceEvidenceId: sourceEvidenceId as string,
            chunkId: unit.declaration.id.key,
            chunkArtifact: pin(unit),
            pageNumber: page as number,
            contentByteOffset: Buffer.from((unit.body as { content: string }).content).indexOf(
              Buffer.from(literal as string),
            ),
            bytesHex: Buffer.from(literal as string).toString("hex"),
          };
        }),
      };
    }),
  };
  return { input, baseline, roles };
}

describe("managed local memory integration", () => {
  it("appends actual local declarations to pending slots while preserving all prior declarations", async () => {
    const input = fixture();
    const baseline = prepareManagedPrivateSupplier(input);
    const inventory = currentInventory(baseline);
    const previous = generationEvidenceBytes(inventory);
    expect(
      inventory.groups
        .filter((group) => group.groupKey === "deep_memory")
        .every((group) => group.state === "pending" && group.declaration === null),
    ).toBe(true);
    const extended = prepareManagedPrivateSupplier({ ...input, includeLocalMemory: true });
    const calls: string[] = [];
    const mutation = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      calls.push(name);
      if (name === "declare_ingestion_generation_evidence") {
        expect(payload.p_declarations).toEqual(extended.declarations);
        for (const group of baseline.declarations.groups) expect(extended.declarations.groups).toContainEqual(group);
        for (const unit of baseline.declarations.units) expect(extended.declarations.units).toContainEqual(unit);
        for (const manifest of baseline.producerManifests) expect(extended.producerManifests).toContainEqual(manifest);
        expect(
          extended.declarations.groups.filter(
            (group) =>
              group.groupKey === "deep_memory" && ["sections", "memory_cards", "index_units"].includes(group.family),
          ),
        ).toHaveLength(3);
        throw new Error("synthetic transport stop after checked declaration");
      }
      return { ok: true };
    });
    await expect(
      runManagedPrivateSupplier({
        input: { ...input, includeLocalMemory: true },
        currentInventory: inventory,
        mutation,
        check: () => {},
      }),
    ).rejects.toThrow("synthetic transport stop after checked declaration");
    expect(calls).toEqual(["begin_ingestion_generation_evidence", "declare_ingestion_generation_evidence"]);
    expect(generationEvidenceBytes(inventory)).toEqual(previous);
  });

  it("refuses genuine previously declared skipped local populations before any RPC", async () => {
    const previous = prepareManagedPrivateSupplier(fixture(id(2), undefined, undefined, false));
    const inventory = currentInventory(previous);
    const groups = inventory.groups.filter((group) => group.groupKey === "deep_memory");
    expect(groups.length).toBeGreaterThan(0);
    expect(
      groups.every((group) => group.state === "declared" && group.declaration?.population.tag === "unavailable"),
    ).toBe(true);
    const mutation = vi.fn(async () => ({ ok: true }));
    await expect(
      runManagedPrivateSupplier({
        input: { ...fixture(), includeLocalMemory: true },
        currentInventory: inventory,
        mutation,
        check: () => {},
      }),
    ).rejects.toThrow("current_inventory_declaration_conflict");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("preserves default preparation and packages genuine invoked local outputs when explicitly enabled", () => {
    const input = fixture();
    const base = prepareManagedPrivateSupplier(input);
    expect(prepareManagedPrivateSupplier({ ...input, includeLocalMemory: false }).digest).toBe(base.digest);
    const extended = prepareManagedPrivateSupplier({ ...input, includeLocalMemory: true });
    const actual = prepareManagedLocalMemoryProducer({
      document: { ...input.job.documents, source_path: input.job.documents.source_path ?? null },
      issued: input.issued,
      coreUnits: base.producerManifests.flatMap((manifest) => manifest.units),
    });
    const local = extended.producerManifests.filter((manifest) => manifest.group.groupKey === "deep_memory");
    expect(local.map((manifest) => manifest.group.family)).toEqual(["sections", "memory_cards", "index_units"]);
    expect(local.map((manifest) => manifest.units.map((unit) => unit.body))).toEqual([
      actual.sections.map((row) => row.body),
      actual.memoryCards.map((row) => row.body),
      actual.indexUnits.map((row) => row.body),
    ]);
    expect(extended.producerManifests.filter((manifest) => manifest.group.groupKey !== "deep_memory")).toEqual(
      base.producerManifests,
    );
    const byId = new Map(extended.declarations.units.map((unit) => [JSON.stringify(unit.id), unit]));
    for (const manifest of local)
      for (const unit of manifest.units) {
        expect(unit.declaration.qualification).toBe("derived_unverified");
        expect(unit.declaration.sourceEvidenceIds).toEqual([]);
        expect(unit.originalReferences).toEqual([]);
        expect(unit.providerInputText).toBeNull();
        expect(unit.declaration.dependencies.length).toBeGreaterThan(0);
        for (const parent of unit.inputReferences) expect(byId.has(JSON.stringify(parent))).toBe(true);
        expect(unit.artifact.bytesHex).toBe(generationEvidenceBytes(unit.body).toString("hex"));
      }
    expect(extended.status).toBe("prepared_blocked");
    expect(extended.activated).toBe(false);
    expect(extended.blockers).toEqual(
      expect.arrayContaining([
        "source_completeness_unavailable",
        "provider_vectors_unavailable",
        "preseal_unavailable",
        "publication_unavailable",
      ]),
    );
    expect(prepareManagedPrivateSupplier({ ...input, includeLocalMemory: true }).digest).toBe(extended.digest);
  });

  it("keeps independently declared full row qualifications on the unchanged core output", () => {
    const declared = declaredFixture();
    const input = { ...declared.input, independentSourceRoles: declared.roles };
    const base = prepareManagedPrivateSupplier(input);
    const extended = prepareManagedPrivateSupplier({ ...input, includeLocalMemory: true });
    expect(extended.declaredTableAssociations).toEqual(base.declaredTableAssociations);
    expect(extended.retainedLiteralAvailability).toEqual(base.retainedLiteralAvailability);
    expect(extended.preparedCandidateCoverage).toEqual(base.preparedCandidateCoverage);
  });

  it("rejects invalid explicit options and foreign inventory before any mutation", async () => {
    const input = fixture();
    expect(() => prepareManagedPrivateSupplier({ ...input, includeLocalMemory: "true" as unknown as boolean })).toThrow(
      "local_memory_option_invalid",
    );
    const extendedInput = { ...input, includeLocalMemory: true };
    const inventory = currentInventory(prepareManagedPrivateSupplier(extendedInput));
    inventory.generationId = id(900);
    const mutation = vi.fn(async () => ({ ok: true }));
    await expect(
      runManagedPrivateSupplier({ input: extendedInput, currentInventory: inventory, mutation, check: () => {} }),
    ).rejects.toThrow("current_inventory_identity_mismatch");
    expect(mutation).not.toHaveBeenCalled();
  });

  it.each(["section-edge", "chunk-edge", "input-reference", "generation"])(
    "rejects coherently reassembled local section indexes with missing %s",
    (mode) => {
      const input = { ...fixture(), includeLocalMemory: true };
      const plan = prepareManagedPrivateSupplier(input);
      const manifests = JSON.parse(JSON.stringify(plan.producerManifests)) as typeof plan.producerManifests;
      const index = manifests.find(
        (manifest) => manifest.group.family === "index_units" && manifest.group.groupKey === "deep_memory",
      )!;
      const unit = index.units.find(
        (row) => (row.body as { metadata: { source: string } }).metadata.source === "document_sections",
      )!;
      expect(unit).toBeDefined();
      if (mode === "section-edge" || mode === "chunk-edge") {
        const family = mode === "section-edge" ? "sections" : "chunks";
        const omitted = unit.declaration.dependencies.find((ref) => ref.family === family)!;
        unit.declaration.dependencies = unit.declaration.dependencies.filter(
          (ref) => JSON.stringify(ref) !== JSON.stringify(omitted),
        );
        unit.inputReferences = unit.inputReferences.filter((ref) => JSON.stringify(ref) !== JSON.stringify(omitted));
      }
      if (mode === "input-reference")
        unit.inputReferences = unit.inputReferences.filter((ref) => ref.family !== "sections");
      if (mode === "generation")
        (unit.body as { metadata: { index_generation_id: string } }).metadata.index_generation_id = id(900);
      const { outputManifestDigest, ...producer } = index.group.declaration.producer;
      void outputManifestDigest;
      const replacement = assembleWholeOriginalProducerManifest({
        state: index.state,
        group: { ...index.group, declaration: { ...index.group.declaration, producer } },
        units: index.units.map((row) => ({
          declaration: row.declaration,
          body: row.body,
          artifactLocator: row.artifact.locator,
          providerInputText: row.providerInputText,
          inputReferences: row.inputReferences,
          originalReferences: row.originalReferences,
          auxiliary: row.auxiliary,
        })),
      });
      manifests[manifests.indexOf(index)] = replacement;
      expect(() =>
        prepareWholeOriginalSupplier({
          originalBytes: input.originalBytes,
          witnessBytes: input.witnessBytes,
          sourceExpectation: plan.retentionPacket.registration.sourceExpectation,
          issued: input.issued,
          retentionPacket: plan.retentionPacket,
          roleRequirements: plan.roleRequirements,
          producerManifests: manifests,
        }),
      ).toThrow(mode === "generation" ? "body_control_mismatch" : "body_reference_dependency_mismatch");
    },
  );
});

describe("managed pure private supplier preparation", () => {
  it("preserves the exact legacy plan when independent declarations are absent or undefined", () => {
    const input = fixture(id(2), nativeTableMetadata());
    expect(
      generationEvidenceDigest(prepareManagedPrivateSupplier({ ...input, independentSourceRoles: undefined })),
    ).toBe(generationEvidenceDigest(prepareManagedPrivateSupplier(input)));
  });

  it("binds independent two-row declarations and full qualifiers without changing bodies or source authority", () => {
    const { input, baseline, roles } = declaredFixture();
    const plan = prepareManagedPrivateSupplier({ ...input, independentSourceRoles: roles });
    expect(plan.declaredTableAssociations?.status).toBe("matched_declared_association_unverified");
    expect(plan.declaredTableAssociations?.rows).toHaveLength(2);
    expect(plan.blockers).toContain("native_mapping_unavailable");
    expect(plan.blockers).toContain("source_completeness_unavailable");
    expect(plan.blockers).not.toContain("source_roles_uncovered");
    const units = plan.producerManifests.flatMap((manifest) => manifest.units);
    const previous = baseline.producerManifests.flatMap((manifest) => manifest.units);
    for (const unit of units) {
      const old = previous.find(
        (candidate) =>
          generationEvidenceDigest(candidate.declaration.id) === generationEvidenceDigest(unit.declaration.id),
      )!;
      expect(unit.body).toEqual(old.body);
      expect(unit.artifact).toEqual(old.artifact);
      expect(unit.declaration.sourceEvidenceIds).toEqual([]);
      expect(unit.declaration.qualification).toBe("derived_unverified");
      if (unit.auxiliary) {
        expect(unit.originalReferences).toEqual([]);
        expect(unit.declaration.dependencies).toEqual([{ family: "private_objects", key: "image:1:binary" }]);
      }
    }
    for (const binding of roles.tableRows!) {
      for (const ref of [binding.candidateUnitId, binding.tableFactUnitId]) {
        const unit = units.find(
          (unit) => generationEvidenceDigest(unit.declaration.id) === generationEvidenceDigest(ref),
        )!;
        expect(unit.originalReferences).toEqual(
          expect.arrayContaining([binding.sourceEvidenceId, "scope", "qualification"]),
        );
        for (const qualifier of binding.qualifications) {
          const qualifierRef = { family: "chunks", key: qualifier.chunkId };
          expect(unit.inputReferences).toContainEqual(qualifierRef);
          expect(unit.declaration.dependencies).toContainEqual(qualifierRef);
        }
      }
    }
    const tableFields = units.filter(
      (unit) =>
        unit.declaration.id.family === "embedding_fields" &&
        (unit.body as { metadata: { source: string } }).metadata.source === "document_table_facts",
    );
    expect(tableFields.length).toBeGreaterThan(0);
    for (const unit of tableFields) {
      expect(unit.inputReferences.filter((ref) => ref.family === "table_facts")).toHaveLength(2);
      expect(unit.originalReferences).toEqual(expect.arrayContaining(["row-a", "row-b", "scope", "qualification"]));
    }
    expect(generationEvidenceDigest(prepareManagedPrivateSupplier({ ...input, independentSourceRoles: roles }))).toBe(
      generationEvidenceDigest(plan),
    );
    expect(roles).toEqual(declaredFixture().roles);
  });

  it.each(["sourceSha256", "witnessSha256", "sourceExpectationDigest"] as const)(
    "refuses a foreign independent %s before transport",
    async (property) => {
      const { input, roles } = declaredFixture();
      const mutation = vi.fn();
      await expect(
        runManagedPrivateSupplier({
          input: { ...input, independentSourceRoles: { ...roles, [property]: "0".repeat(64) } },
          currentInventory: {},
          mutation,
          check: () => {},
        }),
      ).rejects.toThrow();
      expect(mutation).not.toHaveBeenCalled();
    },
  );

  it("refuses foreign prepared identifiers and a cover supplied as a source candidate before transport", async () => {
    for (const cover of [false, true]) {
      const { input, baseline, roles } = declaredFixture();
      roles.requirements[0].candidateUnits = [cover ? baseline.auxiliaryUnits[0] : { family: "chunks", key: id(999) }];
      const mutation = vi.fn();
      await expect(
        runManagedPrivateSupplier({
          input: { ...input, independentSourceRoles: roles },
          currentInventory: {},
          mutation,
          check: () => {},
        }),
      ).rejects.toThrow();
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it.each([
    "swapped row",
    "wrong row ordinal",
    "wrong commitment",
    "truncated qualification",
    "newline removed",
    "summary substitution",
    "removed qualification",
  ])("keeps %s explicitly incomplete and refuses it before transport", async (change) => {
    const { input, roles } = declaredFixture();
    const row = roles.tableRows![0];
    if (change === "swapped row") row.cells = [...roles.tableRows![1].cells];
    if (change === "wrong row ordinal") row.rowIndex = 2;
    if (change === "wrong commitment") row.candidateArtifact.sha256 = `sha256:${"0".repeat(64)}`;
    if (change === "truncated qualification")
      row.qualifications[1].bytesHex = Buffer.from("Rows A and B are alternative QA scenarios.").toString("hex");
    if (change === "newline removed")
      row.qualifications[1].bytesHex = Buffer.from(declaredQualifier.replace("\n", " ")).toString("hex");
    if (change === "summary substitution")
      row.qualifications[1].bytesHex = Buffer.from("Synthetic QA alternatives.").toString("hex");
    if (change === "removed qualification") row.qualifications.pop();
    const plan = prepareManagedPrivateSupplier({ ...input, independentSourceRoles: roles });
    expect(plan.declaredTableAssociations?.status).toBe("incomplete_derived_association");
    expect(plan.blockers).toContain("declared_table_association_incomplete");
    expect(plan.blockers).toContain("native_mapping_unavailable");
    const mutation = vi.fn();
    await expect(
      runManagedPrivateSupplier({
        input: { ...input, independentSourceRoles: roles },
        currentInventory: {},
        mutation,
        check: () => {},
      }),
    ).rejects.toThrow("independent_association_incomplete");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses a crop or a different-page chunk supplied as a literal role before transport", async () => {
    for (const crop of [true, false]) {
      const { input, roles } = declaredFixture();
      if (crop) roles.requirements[1].evidence[0].unitId = { family: "private_objects", key: "image:2:binary" };
      else roles.requirements[1].candidateUnits = roles.requirements[0].candidateUnits;
      const mutation = vi.fn();
      await expect(
        runManagedPrivateSupplier({
          input: { ...input, independentSourceRoles: roles },
          currentInventory: {},
          mutation,
          check: () => {},
        }),
      ).rejects.toThrow("independent_same_page_chunk_required");
      expect(mutation).not.toHaveBeenCalled();
    }
  });

  it("refuses a stale generation's declared parents before transport", async () => {
    const { input, roles } = declaredFixture();
    const replacement = fixture(id(22), nativeTableMetadata(), {
      pages: input.extracted.pages.map((page) => page.text),
      sourceUnits: input.retentionPacket.registration.sourceExpectation.units!,
    });
    const mutation = vi.fn();
    await expect(
      runManagedPrivateSupplier({
        input: { ...replacement, independentSourceRoles: roles },
        currentInventory: {},
        mutation,
        check: () => {},
      }),
    ).rejects.toThrow();
    expect(mutation).not.toHaveBeenCalled();
  });

  it("rejects independent role getters without invoking them", () => {
    const input = fixture();
    const getter = vi.fn();
    Object.defineProperty(input, "independentSourceRoles", { enumerable: true, get: getter });
    expect(() => prepareManagedPrivateSupplier(input)).toThrow("plain_arguments_required");
    expect(getter).not.toHaveBeenCalled();
  });
  it("projects actual retained native structure into neutral facts and exact named-cell rows with real parents", () => {
    const metadata = nativeTableMetadata();
    const input = fixture(id(2), metadata);
    const plan = prepareManagedPrivateSupplier(input);
    const units = plan.producerManifests.flatMap((manifest) => manifest.units);
    const tableImage = units.find((unit) => unit.declaration.id.family === "images" && !unit.auxiliary)!;
    expect(tableImage.body).toMatchObject({
      descriptor: { metadata },
      metadata,
      caption: null,
      image_type: null,
      labels: null,
    });
    const facts = units.filter((unit) => unit.declaration.id.family === "table_facts");
    expect(facts).toHaveLength(2);
    const rows = units.filter(
      (unit) =>
        unit.declaration.id.family === "index_units" && (unit.body as { unit_type: string }).unit_type === "table_fact",
    );
    expect(rows).toHaveLength(2);
    for (const [ordinal, fact] of facts.entries()) {
      const cells = metadata.table_rows[ordinal + 1];
      const body = fact.body as { source_chunk_id: string; metadata: Record<string, unknown> };
      expect(body).toMatchObject({
        id: fact.declaration.id.key,
        owner_id: id(3),
        document_id: input.issued.documentId,
        index_generation_id: input.issued.generationId,
        source_image_id: tableImage.declaration.id.key,
        page_number: 2,
        row_label: cells[0],
        clinical_parameter: cells[0],
        threshold_value: null,
        action: null,
        metadata: { row_index: ordinal + 1, cells, columns: metadata.table_columns },
      });
      expect(fact.declaration.dependencies).toContainEqual({ family: "images", key: tableImage.declaration.id.key });
      expect(fact.declaration.dependencies).toContainEqual({ family: "chunks", key: body.source_chunk_id });
      const row = rows.find(
        (unit) => (unit.body as { metadata: Record<string, unknown> }).metadata.row_index === ordinal + 1,
      )!;
      expect(row.body).toMatchObject({
        source_chunk_id: body.source_chunk_id,
        source_image_id: tableImage.declaration.id.key,
        content: metadata.table_columns.map((column, index) => `${column}: ${cells[index]}`).join(" | "),
        metadata: {
          named_cells: metadata.table_columns.map((column, index) => ({ column, cell: cells[index] })),
          native_table_descriptor: metadata,
          table_fact_metadata: body.metadata,
          threshold_value: null,
          action: null,
          source_qualification: "derived_unverified",
        },
      });
      expect(row.declaration.dependencies).toContainEqual(fact.declaration.id);
      expect(row.inputReferences).toContainEqual(fact.declaration.id);
      for (const unit of [fact, row]) {
        expect(unit.declaration.sourceEvidenceIds).toEqual([]);
        expect(unit.originalReferences).toEqual([]);
        expect(unit.artifact.bytesHex).toBe(generationEvidenceBytes(unit.body).toString("hex"));
      }
    }
    expect(plan.digest).toBe(prepareManagedPrivateSupplier(fixture(id(2), nativeTableMetadata())).digest);
    expect(plan.blockers).toContain("source_roles_uncovered");
    expect(plan.roleRequirements.requirements).toEqual([]);
    expect(plan.roleRequirements).not.toHaveProperty("tableRows");
    const fields = units.filter(
      (unit) =>
        unit.declaration.id.family === "embedding_fields" &&
        (unit.body as { metadata: Record<string, unknown> }).metadata.source === "document_table_facts",
    );
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const body = field.body as { source_chunk_id: string; metadata: Record<string, unknown> };
      const parents = facts.filter((fact) => {
        const source = fact.body as {
          source_chunk_id: string;
          source_image_id: string;
          table_title: string | null;
          page_number: number;
        };
        return (
          source.source_chunk_id === body.source_chunk_id &&
          source.source_image_id === body.metadata.source_image_id &&
          source.table_title === body.metadata.table_title &&
          source.page_number === body.metadata.page_number
        );
      });
      expect(parents.length).toBeGreaterThan(0);
      for (const parent of parents) {
        expect(field.declaration.dependencies).toContainEqual(parent.declaration.id);
        expect(field.inputReferences).toContainEqual(parent.declaration.id);
      }
    }
    const cover = units.find((unit) => unit.auxiliary)!;
    for (const unit of units.filter((unit) => unit.declaration.id.family !== "images"))
      expect(unit.declaration.dependencies).not.toContainEqual(cover.declaration.id);
  });

  it.each(["truncated", "wrong-column", "nonstring-cell", "missing-row", "incorrect-count", "unknown-method"])(
    "refuses unsupported retained structural input without substituting a table: %s",
    (mode) => {
      const metadata: Record<string, unknown> = nativeTableMetadata();
      if (mode === "truncated") metadata.rows_truncated = true;
      if (mode === "wrong-column") metadata.table_columns = ["Drug", "Concentration", "Amount", "Volume", "Interval"];
      if (mode === "nonstring-cell")
        metadata.table_rows = [
          ["Scenario", "Concentration", "Amount", "Volume", "Interval"],
          ["Q-A", 0.5, "2 mg", "4 mL", "24 h"],
        ];
      if (mode === "missing-row") metadata.table_rows = [];
      if (mode === "incorrect-count") metadata.row_count = 400;
      if (mode === "unknown-method") metadata.extraction_method = "unassessed_native_tool";
      expect(() => prepareManagedPrivateSupplier(fixture(id(2), metadata))).toThrow("native_table_shape_unavailable");
    },
  );

  it.each(["duplicate-row", "leading-space", "repeated-space", "blank-row"])(
    "refuses coherent native normalization/deduplication before any RPC: %s",
    async (mode) => {
      const metadata = nativeTableMetadata();
      if (mode === "duplicate-row") metadata.table_rows.push([...metadata.table_rows[1]]);
      if (mode === "leading-space") metadata.table_rows[1][2] = " 2 mg";
      if (mode === "repeated-space") metadata.table_rows[1][2] = "2  mg";
      if (mode === "blank-row") metadata.table_rows.push(metadata.table_columns.map(() => ""));
      metadata.row_count = metadata.table_rows.length;
      metadata.table_text = [
        metadata.table_columns,
        metadata.table_columns.map(() => "---"),
        ...metadata.table_rows.slice(1),
      ]
        .map((row) => `| ${row.join(" | ")} |`)
        .join("\n");
      metadata.accessible_table_markdown = metadata.table_text;
      const input = fixture(id(2), metadata);
      // The inventory need not be considered: refusal occurs inside actual preparation before any transport.
      let calls = 0;
      await expect(
        runManagedPrivateSupplier({
          input,
          currentInventory: {},
          check: () => {},
          mutation: async () => {
            calls++;
            return { ok: true };
          },
        }),
        // The blank-row specimen first loses the ordinary chunk's image association and is
        // refused by the earlier actual-parent guard; the other cases reach population comparison.
      ).rejects.toThrow(mode === "blank-row" ? "native_table_parent_unavailable" : "native_table_population_changed");
      expect(calls).toBe(0);
    },
  );

  it("retains full page/image bytes and actual neutral output bodies without effect or source credit", () => {
    const args = fixture();
    const before = generationEvidenceBytes({ packet: args.retentionPacket, extracted: args.extracted });
    const plan = prepareManagedPrivateSupplier(args);
    expect(generationEvidenceBytes({ packet: args.retentionPacket, extracted: args.extracted })).toEqual(before);
    expect(plan.status).toBe("prepared_blocked");
    expect(plan.activated).toBe(false);
    expect(plan.roleRequirements.requirements).toEqual([]);
    expect(plan.roleRequirements).not.toHaveProperty("tableRows");
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "source_roles_uncovered",
        "provider_vectors_unavailable",
        "captureApplicability_unknown",
        "summary_pending",
        "model_unavailable",
        "deepMemory_pending",
        "publication_unavailable",
      ]),
    );
    for (const artifact of args.retentionPacket.artifacts)
      expect(
        plan.retentionPacket.artifacts.find(
          (a) => generationEvidenceDigest(a.unitId) === generationEvidenceDigest(artifact.unitId),
        ),
      ).toEqual(artifact);
    const prepared = plan.producerManifests.flatMap((m) => m.units);
    const images = prepared.filter((u) => u.declaration.id.family === "images");
    expect(images).toHaveLength(2);
    for (const [index, unit] of images.entries()) {
      const descriptor = Object.fromEntries(Object.entries(args.extracted.images[index]).filter(([k]) => k !== "path"));
      expect(unit.body).toMatchObject({
        id: unit.declaration.id.key,
        owner_id: id(3),
        document_id: args.issued.documentId,
        index_generation_id: args.issued.generationId,
        descriptor,
        capture_ordinal: index + 1,
        caption: null,
        image_type: null,
        labels: null,
        clinical_relevance_score: null,
      });
      expect(unit.declaration.dependencies).toEqual([{ family: "private_objects", key: `image:${index + 1}:binary` }]);
      expect(unit.inputReferences).toEqual(unit.declaration.dependencies);
      expect(unit.auxiliary).toBe(index === 0);
    }
    const chunks = prepared.filter((u) => u.declaration.id.family === "chunks");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect((chunk.body as { image_ids: string[] }).image_ids).not.toContain(images[0].declaration.id.key);
      expect(chunk.declaration.dependencies).not.toContainEqual(images[0].declaration.id);
      expect(chunk.auxiliary).toBe(false);
    }
    const text = chunks.map((u) => (u.body as { content: string }).content).join("\n");
    expect(text).toContain("END A.");
    expect(text).toContain("END B.");
    for (const unit of prepared) {
      expect(unit.artifact.bytesHex).toBe(generationEvidenceBytes(unit.body).toString("hex"));
      expect(unit.declaration.qualification).toBe("derived_unverified");
      expect(unit.declaration.sourceEvidenceIds).toEqual([]);
      expect(unit.originalReferences).toEqual([]);
      expect(unit.body).not.toHaveProperty("embedding");
      for (const dependency of unit.declaration.dependencies)
        expect(
          plan.declarations.units.some((u) => generationEvidenceDigest(u.id) === generationEvidenceDigest(dependency)),
        ).toBe(true);
    }
    for (const unit of chunks) {
      for (const page of args.extracted.pages)
        expect(unit.declaration.dependencies).toContainEqual({
          family: "private_objects",
          key: `page:${page.pageNumber}:extracted`,
        });
      for (const imageId of (unit.body as { image_ids: string[] }).image_ids)
        expect(unit.declaration.dependencies).toContainEqual({ family: "images", key: imageId });
    }
  });

  it("declares only actually invoked local output populations and matches genuine pure builder counts", () => {
    const args = fixture();
    const plan = prepareManagedPrivateSupplier(args);
    const manifest = (family: string) => plan.producerManifests.find((m) => m.group.family === family)!;
    const chunkRows = manifest("chunks").units.map((u) => u.body) as Parameters<
      typeof buildTableFactRows
    >[0]["chunkRows"];
    const imageInputs = manifest("images")
      .units.filter((u) => !u.auxiliary)
      .map((u) => {
        const row = u.body as { id: string; page_number: number; source_kind: string };
        return { id: row.id, pageNumber: row.page_number, sourceKind: row.source_kind, caption: "" };
      });
    const tableFacts = buildTableFactRows({ job: args.job, chunkRows, insertedImages: imageInputs });
    expect(tableFacts).toEqual([]);
    expect(manifest("table_facts").units).toEqual([]);
    const document = {
      id: args.issued.documentId,
      owner_id: id(3),
      title: args.job.documents.title,
      file_name: args.job.documents.file_name,
    };
    const indexChunks = chunkRows as Parameters<typeof buildDocumentIndexUnitInputs>[0]["chunks"];
    const deterministic = buildDocumentIndexUnitInputs({ document, chunks: indexChunks });
    const visual = buildVisualDocumentIndexUnitInputs({
      document,
      chunks: indexChunks,
      images: imageInputs,
      tableFacts,
    });
    expect(manifest("index_units").units).toHaveLength(deterministic.length + visual.length);
    expect(visual).toHaveLength(2);
    expect(visual.map((unit) => unit.unit_type).sort()).toEqual(["table_threshold", "visual_askable_question"]);
    const tableImageId = imageInputs[0].id;
    const neutralTableImage = manifest("images").units.find((unit) => unit.declaration.id.key === tableImageId)!;
    expect(neutralTableImage.body).toMatchObject({ caption: null, image_type: null, labels: null });
    for (const fallback of visual) {
      expect(fallback.extraction_mode).toBe("deterministic");
      expect(fallback.source_image_id).toBe(tableImageId);
      if (fallback.unit_type === "table_threshold")
        expect(fallback.metadata.visual_item_type).toBe("sparse_visual_fallback");
      else expect(fallback.metadata.visual_item_type).toBeUndefined();
      const supplied = manifest("index_units").units.find(
        (unit) =>
          generationEvidenceDigest(unit.body) ===
          generationEvidenceDigest({
            ...fallback,
            metadata: { ...fallback.metadata, index_generation_id: args.issued.generationId },
          }),
      );
      expect(supplied).toBeDefined();
      expect(supplied!.declaration.dependencies).toContainEqual({ family: "images", key: tableImageId });
      expect(supplied!.declaration.sourceEvidenceIds).toEqual([]);
      expect(supplied!.originalReferences).toEqual([]);
      expect(supplied!.declaration.qualification).toBe("derived_unverified");
    }
    const rawChunks = buildChunks(
      args.extracted.pages.map((page) => ({
        documentId: args.issued.documentId,
        pageNumber: page.pageNumber,
        pageText: page.text,
        images: imageInputs.filter((i) => i.pageNumber === page.pageNumber),
      })),
    );
    const fields = buildAdditionalEmbeddingFieldInputs({
      job: args.job,
      chunkRows,
      insertedImages: imageInputs,
      tableFacts,
      qualityHint: {
        duplicateChunkRatio: 0,
        headingDensity: Number(
          (rawChunks.length ? rawChunks.filter((c) => c.section_heading).length / rawChunks.length : 0).toFixed(3),
        ),
      },
    });
    expect(manifest("embedding_fields").units).toHaveLength(fields.length);
    for (const unit of manifest("embedding_fields").units) {
      const body = unit.body as { source_chunk_id: string };
      expect(unit.declaration.dependencies).toContainEqual({ family: "chunks", key: body.source_chunk_id });
    }
    for (const producer of plan.producerManifests) {
      expect(producer.group.declaration.population).toMatchObject({
        tag: "known",
        expectedUnits: producer.units.map((u) => u.declaration.id),
      });
      expect(producer.group.groupKey).toBe("worker_core");
    }
    expect(plan.producerManifests.some((m) => m.group.groupKey === "deep_memory")).toBe(false);
  });

  it.each([
    "witness",
    "unknown",
    "foreign-job",
    "wrong-token",
    "foreign-owner",
    "page-text",
    "page-metadata",
    "image-descriptor",
    "image-bytes",
  ])("refuses unavailable or changed actual inputs: %s", (mode) => {
    const args = fixture();
    if (mode === "witness") args.witnessBytes = Buffer.from("no matching witness");
    if (mode === "unknown")
      args.retentionPacket = {
        ...args.retentionPacket,
        registration: {
          ...args.retentionPacket.registration,
          sourceExpectation: {
            version: 1,
            tag: "unknown",
            sourceSha256: bytesDigest(args.originalBytes),
            units: null,
            witness: null,
            limitation: "original witness unavailable",
          },
        },
      };
    if (mode === "foreign-job") args.job.id = id(900);
    if (mode === "wrong-token") args.job.lease_token = id(900);
    if (mode === "foreign-owner") args.job.documents.owner_id = null;
    if (mode === "page-text") args.extracted.pages[1].text = "truncated body";
    if (mode === "page-metadata") args.extracted.pages[1].metadata = { synthetic_page: 900 };
    if (mode === "image-descriptor") args.extracted.images[1].width = 900;
    if (mode === "image-bytes")
      args.retentionPacket = {
        ...args.retentionPacket,
        artifacts: args.retentionPacket.artifacts.map((a) =>
          a.representation === "image_binary" ? { ...a, bytesHex: "0000" } : a,
        ),
      };
    expect(() => prepareManagedPrivateSupplier(args)).toThrow();
  });

  it("does not import the worker entrypoint or provider/transport modules", () => {
    const source = readFileSync(new URL("../worker/managed-prepared-supplier.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:\/main|\/openai|\/supabase|provider-egress)["']/);
    expect(source.split("export async function runManagedPrivateSupplier")[0]).not.toMatch(
      /\b(?:fetch|stageWholeOriginalSupplier|readWholeOriginalSupplier|mutation)\s*\(/,
    );
  });

  it("refuses outer accessors/proxies without executing them", () => {
    const args = fixture();
    let getterCalls = 0;
    Object.defineProperty(args, "job", {
      enumerable: true,
      get: () => {
        getterCalls++;
        throw new Error("getter invoked");
      },
    });
    expect(() => prepareManagedPrivateSupplier(args)).toThrow("plain_arguments_required");
    expect(getterCalls).toBe(0);
    expect(() =>
      prepareManagedPrivateSupplier(
        new Proxy(fixture(), {
          get: () => {
            getterCalls++;
            throw new Error("proxy invoked");
          },
        }),
      ),
    ).toThrow("plain_arguments_required");
    expect(getterCalls).toBe(0);
  });

  it("replays exact same-generation plans and uses new keys for a new generation", () => {
    const first = prepareManagedPrivateSupplier(fixture());
    expect(prepareManagedPrivateSupplier(fixture()).digest).toBe(first.digest);
    const replacement = prepareManagedPrivateSupplier(fixture(id(900)));
    const firstIds = first.producerManifests.flatMap((m) => m.units.map((u) => u.declaration.id.key));
    expect(
      replacement.producerManifests
        .flatMap((m) => m.units.map((u) => u.declaration.id.key))
        .some((key) => firstIds.includes(key)),
    ).toBe(false);
    expect(replacement.issued.generationId).toBe(id(900));
  });

  it("runs the actual fenced stage/read sequence and rejects fabricated readback", async () => {
    const input = fixture();
    const plan = prepareManagedPrivateSupplier(input);
    const calls: string[] = [];
    await expect(
      runManagedPrivateSupplier({
        input,
        currentInventory: currentInventory(plan),
        check: () => {},
        mutation: async (name) => {
          calls.push(name);
          return name === "record_ingestion_generation_accounting"
            ? { ok: true, accounting: { result: "unavailable", terminalSeal: null } }
            : { ok: true };
        },
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([
      "begin_ingestion_generation_evidence",
      "declare_ingestion_generation_evidence",
      "retain_ingestion_generation_artifacts",
      "record_ingestion_generation_outcomes",
      "record_ingestion_generation_accounting",
      "read_ingestion_prepared_supplier_artifacts",
    ]);
  });

  it.each(["changed-body", "foreign-generation", "cancelled"])("refuses %s before any supplied RPC", async (mode) => {
    const input = fixture();
    const inventory = currentInventory(prepareManagedPrivateSupplier(input));
    if (mode === "changed-body") input.job.documents.title = "Coherently changed derived body";
    if (mode === "foreign-generation") inventory.generationId = id(900);
    let calls = 0;
    await expect(
      runManagedPrivateSupplier({
        input,
        currentInventory: inventory,
        check: () => {
          if (mode === "cancelled") throw new Error("cancelled");
        },
        mutation: async () => {
          calls++;
          return { ok: true };
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("preserves a previously declared pending table producer instead of replacing it with invoked zero outputs", async () => {
    const input = fixture();
    const inventory = currentInventory(prepareManagedPrivateSupplier(input));
    const table = inventory.groups.find((group) => group.family === "table_facts")!;
    if (!table.declaration) throw new Error("Expected actual declared table population");
    table.declaration = {
      ...table.declaration,
      population: {
        tag: "unknown",
        limitation: {
          code: "producer_unavailable",
          scope: "actual prior table producer is pending",
          capability: "optional_derivative",
        },
      },
    };
    let calls = 0;
    await expect(
      runManagedPrivateSupplier({
        input,
        currentInventory: inventory,
        check: () => {},
        mutation: async () => {
          calls++;
          return { ok: true };
        },
      }),
    ).rejects.toThrow("current_inventory_declaration_conflict");
    expect(calls).toBe(0);
  });

  it("stops after cancellation during a stage RPC without later retention or readback", async () => {
    const input = fixture();
    const inventory = currentInventory(prepareManagedPrivateSupplier(input));
    let cancelled = false;
    const calls: string[] = [];
    await expect(
      runManagedPrivateSupplier({
        input,
        currentInventory: inventory,
        check: () => {
          if (cancelled) throw new Error("cancelled after declaration");
        },
        mutation: async (name) => {
          calls.push(name);
          if (name === "declare_ingestion_generation_evidence") cancelled = true;
          return { ok: true };
        },
      }),
    ).rejects.toThrow("cancelled after declaration");
    expect(calls).toEqual(["begin_ingestion_generation_evidence", "declare_ingestion_generation_evidence"]);
  });
});
