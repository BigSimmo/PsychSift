import { describe, expect, it } from "vitest";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  generationEvidenceSlots,
  originalApplicabilityFamilies,
  type GenerationArtifactInput,
  type GenerationGroupDeclaration,
  type GenerationUnitDeclaration,
  type IssuedAttemptControl,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { attachAttemptControlEvidence, buildGenerationRetentionPacket } from "../worker/generation-evidence";
import {
  assembleWholeOriginalProducerManifest,
  prepareWholeOriginalSupplier,
  stageWholeOriginalSupplier,
  decodeWholeOriginalSupplierReadback,
  readWholeOriginalSupplier,
  type WholeOriginalPreparedUnit,
  type WholeOriginalProducerManifest,
  type WholeOriginalProducerAssemblyInput,
  type WholeOriginalRoleRequirements,
} from "../worker/whole-original-supplier";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const documentId = id(1);
const generationId = id(2);
const ownerId = id(3);

function supplierReadback(plan: ReturnType<typeof prepareWholeOriginalSupplier>) {
  const artifacts = [
    ...plan.retentionPacket.artifacts,
    ...plan.producerManifests.flatMap((m) => m.units.map((u) => u.artifact)),
  ];
  const outcomes = [
    ...plan.retentionPacket.outcomes,
    ...plan.producerManifests.flatMap((m) =>
      m.units.map((u) => ({
        unitId: u.declaration.id,
        groupKey: u.declaration.groupKey,
        disposition: "retained",
        artifactSha256: u.artifact.sha256,
        limitation: null,
      })),
    ),
  ];
  return {
    ok: true,
    managed: true,
    preparedSupplierArtifacts: {
      version: "ingestion-prepared-supplier-artifacts-v1",
      identity: {
        documentId: plan.issued.documentId,
        ownerId,
        generationId: plan.issued.generationId,
        jobId: plan.issued.jobId,
        firstLeaseToken: plan.issued.firstLeaseToken,
        authorityDigest: plan.issued.authorityDigest,
        sourceSha256: plan.source.sha256,
        sourceByteLength: plan.source.byteLength,
        sourceExpectationDigest: plan.retentionPacket.registration.sourceExpectationSha256,
      },
      inventory: {
        version: 1,
        documentId: plan.issued.documentId,
        generationId: plan.issued.generationId,
        jobId: plan.issued.jobId,
        firstLeaseToken: plan.issued.firstLeaseToken,
        authorityDigest: plan.issued.authorityDigest,
        predecessorGenerationId: plan.issued.predecessorGenerationId,
        sourceSha256: plan.source.sha256,
        sourceByteLength: plan.source.byteLength,
        sourceExpectation: plan.retentionPacket.registration.sourceExpectation,
        sourceExpectationDigest: plan.retentionPacket.registration.sourceExpectationSha256,
        registration: plan.retentionPacket.registration,
        groups: generationEvidenceSlots.map(([family, groupKey]) => {
          const group = plan.declarations.groups.find((g) => g.family === family && g.groupKey === groupKey);
          return { family, groupKey, state: group ? "declared" : "pending", declaration: group?.declaration ?? null };
        }),
        units: plan.declarations.units,
        outcomes,
        artifacts: artifacts.map(({ bytesHex, ...metadata }) => {
          void bytesHex;
          return { ...metadata, sourceSha256: plan.source.sha256 };
        }),
      },
      artifacts,
    },
  };
}

describe("whole-original private supplier transport", () => {
  it("stages full populations through existing RPCs and stops before any activation", async () => {
    const plan = prepareWholeOriginalSupplier(fixture());
    const calls: { name: string; payload: Record<string, unknown> }[] = [];
    const result = await stageWholeOriginalSupplier({
      plan,
      check: () => {},
      mutation: async (name, payload) => {
        calls.push({ name, payload });
        return name === "record_ingestion_generation_accounting"
          ? { ok: true, accounting: { result: "unavailable", terminalSeal: null } }
          : { ok: true };
      },
    });
    expect(calls.map((c) => c.name)).toEqual([
      "begin_ingestion_generation_evidence",
      "declare_ingestion_generation_evidence",
      "retain_ingestion_generation_artifacts",
      "record_ingestion_generation_outcomes",
      "record_ingestion_generation_accounting",
    ]);
    expect(calls[1].payload.p_declarations).toEqual(plan.declarations);
    expect(calls[2].payload.p_artifacts).toHaveLength(result.artifactCount);
    expect(result).toMatchObject({ status: "retained_unverified", activated: false, planDigest: plan.digest });
  });
  it("rejects a changed plan before any transport call", async () => {
    const plan = JSON.parse(JSON.stringify(prepareWholeOriginalSupplier(fixture())));
    plan.blockers = [];
    let calls = 0;
    await expect(
      stageWholeOriginalSupplier({
        plan,
        check: () => {},
        mutation: async () => {
          calls++;
          return { ok: true };
        },
      }),
    ).rejects.toThrow("readback_plan_mismatch");
    expect(calls).toBe(0);
  });
  it("rejects a valid oversized prepared plan before any transport call", async () => {
    const args = fixture();
    const unit = args.producerManifests[1].units[0];
    // Grow a permitted synthetic metadata field without changing original text or source roles.
    (unit.body as { metadata: Record<string, unknown> }).metadata.synthetic_transport_padding = "Q".repeat(
      2 * 1024 * 1024,
    );
    refreshPreparedBody(unit);
    resync(args);
    const plan = prepareWholeOriginalSupplier(args);
    let calls = 0;
    await expect(
      stageWholeOriginalSupplier({
        plan,
        check: () => {},
        mutation: async () => {
          calls++;
          return { ok: true };
        },
      }),
    ).rejects.toThrow("stage_transport_limit_exceeded");
    expect(calls).toBe(0);
  });
  it("stops after a lost lease without subsequent writes", async () => {
    const plan = prepareWholeOriginalSupplier(fixture());
    const calls: string[] = [];
    await expect(
      stageWholeOriginalSupplier({
        plan,
        check: () => {},
        mutation: async (name) => {
          calls.push(name);
          return calls.length === 2 ? { ok: false, reason: "lease_lost" } : { ok: true };
        },
      }),
    ).rejects.toThrow("stage_current_attempt_required");
    expect(calls).toHaveLength(2);
  });
  it("does not accept a transport response claiming positive eligibility", async () => {
    await expect(
      stageWholeOriginalSupplier({
        plan: prepareWholeOriginalSupplier(fixture()),
        check: () => {},
        mutation: async (name) =>
          name === "record_ingestion_generation_accounting"
            ? { ok: true, accounting: { result: "eligible", terminalSeal: {} } }
            : { ok: true },
      }),
    ).rejects.toThrow("stage_unexpected_accounting");
  });
  it("checks full stored bytes and preserves the existing blocked result", async () => {
    const plan = prepareWholeOriginalSupplier(fixture());
    const result = decodeWholeOriginalSupplierReadback({ expected: plan, ownerId, result: supplierReadback(plan) });
    expect(result.artifactCount).toBe(supplierReadback(plan).preparedSupplierArtifacts.artifacts.length);
    expect(result).toMatchObject({ activated: false, expectedPlanDigest: plan.digest });
    expect(result.blockers).toEqual(plan.blockers);
  });
  it.each([
    "missing_artifact",
    "coherent_replacement",
    "missing_outcome",
    "changed_dependency",
    "unexpected_group",
    "duplicate_artifact",
    "wrong_owner",
    "wrong_generation",
    "wrong_first_lease",
  ])("refuses %s rather than returning a partial bundle", (kind) => {
    const plan = prepareWholeOriginalSupplier(fixture());
    const result = JSON.parse(JSON.stringify(supplierReadback(plan)));
    const payload = result.preparedSupplierArtifacts;
    if (kind === "missing_artifact") payload.artifacts.pop();
    if (kind === "duplicate_artifact") payload.artifacts.push(payload.artifacts[0]);
    if (kind === "coherent_replacement") {
      const a = payload.artifacts.at(-1);
      const bytes = Buffer.from("coherently changed body");
      a.bytesHex = bytes.toString("hex");
      a.sha256 = bytesDigest(bytes);
      a.byteLength = bytes.length;
    }
    if (kind === "missing_outcome") payload.inventory.outcomes.pop();
    if (kind === "changed_dependency") payload.inventory.units[0].dependencies.push({ family: "chunks", key: id(900) });
    if (kind === "unexpected_group")
      payload.inventory.groups.find((g: { state: string }) => g.state === "pending").state = "declared";
    if (kind === "wrong_owner") payload.identity.ownerId = id(901);
    if (kind === "wrong_generation") payload.identity.generationId = id(902);
    if (kind === "wrong_first_lease") payload.identity.firstLeaseToken = id(903);
    expect(() => decodeWholeOriginalSupplierReadback({ expected: plan, ownerId, result })).toThrow();
  });
  it("uses only the fenced read RPC and checks cancellation after it", async () => {
    const plan = prepareWholeOriginalSupplier(fixture());
    let checks = 0;
    const calls: string[] = [];
    const result = await readWholeOriginalSupplier({
      expected: plan,
      ownerId,
      check: () => {
        checks++;
      },
      mutation: async (name) => {
        calls.push(name);
        return supplierReadback(plan);
      },
    });
    expect(calls).toEqual(["read_ingestion_prepared_supplier_artifacts"]);
    expect(checks).toBe(2);
    expect(result.activated).toBe(false);
  });
});
const pages = [
  "Fictional QA only. Q drug orally at 20:00. 3.2 mmol/L <= x < 4.1 mmol/L. Repeat 15 min then 30 min; stop if result missing.",
  "Q-A | 2.50 | mg | oral | 15 min\nQ-B | 0.75 | mg | oral | 30 min\nAlternatives only; do not combine; no real medicine.",
  "END-QA-731 QA-L9 missing-result; clinically unsuitable.",
];
const sourceLiterals = [
  [0, "scope", "Fictional QA only.", []],
  [0, "dose", "Q drug orally at 20:00.", ["scope"]],
  [1, "row-a", "Q-A | 2.50 | mg | oral | 15 min", ["scope", "alternatives"]],
  [1, "row-b", "Q-B | 0.75 | mg | oral | 30 min", ["scope", "alternatives"]],
  [1, "alternatives", "Alternatives only; do not combine; no real medicine.", []],
  [0, "inequality", "3.2 mmol/L <= x < 4.1 mmol/L.", ["scope"]],
  [0, "stop", "Repeat 15 min then 30 min; stop if result missing.", ["scope"]],
  [2, "tail", "END-QA-731 QA-L9 missing-result; clinically unsuitable.", []],
] as const;
function artifact(
  unitId: GenerationUnitDeclaration["id"],
  groupKey: string,
  representation: GenerationArtifactInput["representation"],
  bytes: Buffer,
) {
  return {
    unitId,
    groupKey,
    representation,
    bytesHex: bytes.toString("hex"),
    sha256: bytesDigest(bytes),
    byteLength: bytes.length,
    locator: `prepared:${unitId.family}:${unitId.key}`,
  };
}
function prepared(
  family: "chunks" | "images" | "index_units" | "embedding_fields" | "table_facts",
  key: string,
  body: unknown,
  dependencies: GenerationUnitDeclaration["id"][],
  providerInputText: string | null,
  groupKey = "worker_core",
  auxiliary = false,
): WholeOriginalPreparedUnit {
  const declaration: GenerationUnitDeclaration = {
    id: { family, key },
    groupKey,
    required: family === "chunks",
    dependencies,
    sourceEvidenceIds: [],
    qualification: "derived_unverified",
    representation: "provenance_json",
  };
  return {
    declaration,
    body,
    artifact: artifact(declaration.id, groupKey, "provenance_json", generationEvidenceBytes(body)),
    providerInputText,
    inputReferences: dependencies,
    originalReferences: [],
    auxiliary,
  };
}
function manifest(units: WholeOriginalPreparedUnit[]): WholeOriginalProducerManifest {
  const { family } = units[0].declaration.id;
  const { groupKey } = units[0].declaration;
  const inputReferences = [
    ...new Map(units.flatMap((unit) => unit.inputReferences).map((ref) => [JSON.stringify(ref), ref])).values(),
  ];
  const preparedManifestDigest = generationEvidenceDigest({ state: "prepared", units, inputReferences });
  const group: GenerationGroupDeclaration = {
    family,
    groupKey,
    declaration: {
      producer: {
        name: `ordinary-${family}-${groupKey}`,
        version: "supplied-input-v1",
        outputManifestDigest: preparedManifestDigest,
      },
      artifactGenerationId: groupKey === "deep_memory" ? id(20) : null,
      population: {
        tag: "known",
        expectedUnits: units.map((unit) => unit.declaration.id),
        basis: [{ reference: "synthetic producer-own prepared output population", sha256: preparedManifestDigest }],
        reason: null,
      },
    },
  };
  return { group, state: "prepared", units, inputReferences, preparedManifestDigest };
}
function fixture(extra = false) {
  const originalBytes = Buffer.from(pages.join("\n\f\n"));
  const sourceUnits = sourceLiterals.map(([, sourceId, , dependencies]) => ({
    id: sourceId,
    required: true,
    dependencies: [...dependencies],
    locator: `authored:${sourceId}`,
    nativeMapping: "unavailable" as const,
  }));
  const witnessBytes = generationEvidenceBytes({
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: { tag: "unknown", limitation: "whole-original applicability unassessed" },
    })),
  });
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(originalBytes),
    tag: "known",
    units: sourceUnits,
    witness: { reference: "authored independent roles", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const descriptors = [
    { pageNumber: 2, mimeType: "image/png", sourceKind: "table_crop" as const },
    { pageNumber: 1, mimeType: "image/png", sourceKind: "cover_page" as const },
  ];
  const capturedImages = descriptors.map((descriptor, ordinal) => {
    const bytes = Buffer.from(`synthetic retained raster ${ordinal}`);
    return {
      ordinal: ordinal + 1,
      descriptor,
      bytesHex: bytes.toString("hex"),
      sha256: bytesDigest(bytes),
      byteLength: bytes.length,
    };
  });
  const issued: IssuedAttemptControl = {
    documentId,
    generationId,
    jobId: id(4),
    workerId: "synthetic-worker",
    firstLeaseToken: id(5),
    attemptNumber: 1,
    batchId: null,
    authorityDigest: generationEvidenceDigest("authority"),
    predecessorGenerationId: null,
  };
  const base = buildGenerationRetentionPacket({
    documentId,
    generationId,
    originalBytes,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted: {
      pages: pages.map((text, index) => ({ pageNumber: index + 1, text, metadata: {} })),
      images: descriptors.map((descriptor) => ({ ...descriptor, path: "synthetic-unused-path" })),
    },
    persistedPages: pages.map((text, index) => ({ page_number: index + 1, text, ocr_used: false, metadata: {} })),
    capturedImages,
    deferOptionalProducerDeclarations: true,
  });
  const retentionPacket = attachAttemptControlEvidence({
    packet: base,
    issued,
    inventory: {
      documentId,
      generationId,
      jobId: issued.jobId,
      firstLeaseToken: issued.firstLeaseToken,
      authorityDigest: issued.authorityDigest,
      predecessorGenerationId: null,
      sourceSha256: bytesDigest(originalBytes),
      sourceByteLength: originalBytes.length,
      sourceExpectationDigest: base.registration.sourceExpectationSha256,
    },
  });
  const imageUnits = descriptors.map((descriptor, i) =>
    prepared(
      "images",
      id(30 + i),
      {
        id: id(30 + i),
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
        metadata: {},
      },
      [{ family: "private_objects", key: `image:${i + 1}:binary` }],
      null,
      "worker_core",
      i === 1,
    ),
  );
  const chunks = pages.map((content, i) =>
    prepared(
      "chunks",
      id(40 + i),
      {
        id: id(40 + i),
        document_id: documentId,
        page_number: i + 1,
        chunk_index: i,
        section_heading: null,
        section_path: [],
        heading_level: null,
        parent_heading: null,
        anchor_id: null,
        content,
        retrieval_synopsis: null,
        token_estimate: content.length,
        image_ids: i === 1 ? [id(30)] : [],
        content_hash: generationEvidenceDigest(content),
        index_generation_id: generationId,
        metadata: {},
      },
      [{ family: "pages", key: String(i + 1) }, ...(i === 1 ? [{ family: "images" as const, key: id(30) }] : [])],
      content,
    ),
  );
  if (extra)
    chunks.push(
      prepared(
        "chunks",
        id(43),
        {
          ...(chunks[0].body as object),
          id: id(43),
          chunk_index: 3,
          content: "Additional actual overlap",
          image_ids: [],
        },
        [{ family: "pages", key: "1" }],
        "Additional actual overlap",
      ),
    );
  const indexBody = {
    owner_id: ownerId,
    document_id: documentId,
    unit_type: "visual_summary",
    source_chunk_id: id(40),
    source_image_id: id(31),
    page_start: 1,
    page_end: 1,
    heading_path: [],
    title: "Cover",
    content: "Display preview only",
    normalized_terms: [],
    source_span: null,
    quality_score: 0,
    extraction_mode: "deterministic",
    metadata: {},
  };
  const coreIndex = prepared(
    "index_units",
    "core:cover",
    indexBody,
    [
      { family: "chunks", key: id(40) },
      { family: "images", key: id(31) },
    ],
    null,
    "worker_core",
    true,
  );
  const deepIndex = prepared(
    "index_units",
    "deep:cover",
    indexBody,
    [
      { family: "chunks", key: id(40) },
      { family: "images", key: id(31) },
    ],
    null,
    "deep_memory",
    true,
  );
  const facts = ["Q-A", "Q-B"].map((label, i) =>
    prepared(
      "table_facts",
      id(50 + i),
      {
        id: id(50 + i),
        document_id: documentId,
        owner_id: ownerId,
        index_generation_id: generationId,
        source_chunk_id: id(41),
        source_image_id: id(30),
        page_number: 2,
        table_title: "Synthetic alternatives",
        row_label: label,
        clinical_parameter: null,
        threshold_value: null,
        action: null,
        normalized_terms: [],
        metadata: { cells: [label, i ? "0.75" : "2.50", "mg", "oral", i ? "30 min" : "15 min"] },
      },
      [
        { family: "chunks", key: id(41) },
        { family: "images", key: id(30) },
      ],
      null,
    ),
  );
  const field = prepared(
    "embedding_fields",
    "section:1",
    {
      document_id: documentId,
      owner_id: ownerId,
      source_chunk_id: id(40),
      field_type: "section_context",
      content: "Synthetic title | source.pdf",
      metadata: {},
    },
    [{ family: "chunks", key: id(40) }],
    "Synthetic title | source.pdf",
  );
  const producerManifests = [
    manifest(imageUnits),
    manifest(chunks),
    manifest(facts),
    manifest([field]),
    manifest([coreIndex]),
    manifest([deepIndex]),
  ];
  const roleRequirements: WholeOriginalRoleRequirements = {
    version: "whole-original-source-roles-v1",
    sourceSha256: bytesDigest(originalBytes),
    witnessSha256: bytesDigest(witnessBytes),
    sourceExpectationDigest: generationEvidenceDigest(sourceExpectation),
    capabilities: { captureApplicability: "unknown", summary: "pending", model: "unavailable", deepMemory: "pending" },
    requirements: sourceLiterals.map(([page, sourceEvidenceId, literal]) => ({
      sourceEvidenceId,
      role: "independent retained literal",
      candidateUnits: [{ family: "chunks", key: id(40 + page) }],
      evidence: [
        {
          unitId: { family: "private_objects", key: `page:${page + 1}:extracted` },
          byteOffset: Buffer.byteLength(pages[page].slice(0, pages[page].indexOf(literal))),
          bytesHex: Buffer.from(literal).toString("hex"),
        },
      ],
    })),
  };
  return {
    originalBytes,
    witnessBytes,
    sourceExpectation,
    issued,
    retentionPacket: JSON.parse(generationEvidenceBytes(retentionPacket).toString("utf8")) as typeof retentionPacket,
    roleRequirements,
    producerManifests,
  };
}
function resync(args: ReturnType<typeof fixture>) {
  args.producerManifests = args.producerManifests.map((old) => {
    const result = manifest(old.units);
    return {
      ...result,
      group: {
        ...old.group,
        declaration: {
          ...old.group.declaration,
          producer: { ...old.group.declaration.producer, outputManifestDigest: result.preparedManifestDigest },
        },
      },
    };
  });
}
function assemblyInput(manifest: WholeOriginalProducerManifest): WholeOriginalProducerAssemblyInput {
  const { name, version } = manifest.group.declaration.producer;
  return {
    group: { ...manifest.group, declaration: { ...manifest.group.declaration, producer: { name, version } } },
    state: manifest.state,
    units: manifest.units.map(({ artifact, ...unit }) => ({ ...unit, artifactLocator: artifact.locator })),
  };
}
function assembledFixture() {
  const args = fixture();
  args.producerManifests = args.producerManifests.map((manifest) =>
    assembleWholeOriginalProducerManifest(assemblyInput(manifest)),
  );
  return args;
}
function tableAssociationFixture() {
  const args = fixture();
  const columns = ["Scenario", "Amount", "Unit", "Route", "Interval"];
  const specs = [
    {
      sourceId: "row-a",
      rowKey: "core:row-a",
      factKey: id(50),
      rowIndex: 1,
      cells: ["Q-A", "2.50", "mg", "oral", "15 min"],
    },
    {
      sourceId: "row-b",
      rowKey: "core:row-b",
      factKey: id(51),
      rowIndex: 2,
      cells: ["Q-B", "0.75", "mg", "oral", "30 min"],
    },
  ];
  const image = args.producerManifests[0].units[0];
  const imageBody = JSON.parse(generationEvidenceBytes(image.body).toString("utf8"));
  imageBody.descriptor.metadata = {
    table_index: 1,
    table_columns: columns,
    table_rows: [columns, ...specs.map((spec) => spec.cells)],
  };
  image.body = imageBody;
  image.artifact = artifact(
    image.declaration.id,
    image.declaration.groupKey,
    "provenance_json",
    generationEvidenceBytes(imageBody),
  );
  const placementArtifact = args.retentionPacket.artifacts.find((row) => row.unitId.key === "image:1:provenance")!;
  const placement = JSON.parse(Buffer.from(placementArtifact.bytesHex, "hex").toString("utf8"));
  placement.descriptor = imageBody.descriptor;
  Object.assign(
    placementArtifact,
    artifact(
      placementArtifact.unitId,
      placementArtifact.groupKey,
      placementArtifact.representation,
      generationEvidenceBytes(placement),
    ),
  );
  args.retentionPacket.outcomes.find((row) => row.unitId.key === placementArtifact.unitId.key)!.artifactSha256 =
    placementArtifact.sha256;
  args.producerManifests[1].units[0].originalReferences = ["scope"];
  args.producerManifests[1].units[1].originalReferences = ["alternatives"];
  const rows = specs.map((spec, index) => {
    const fact = args.producerManifests[2].units[index];
    const factBody = JSON.parse(generationEvidenceBytes(fact.body).toString("utf8"));
    factBody.metadata = { ...factBody.metadata, columns, row_index: spec.rowIndex, index_generation_id: generationId };
    fact.body = factBody;
    fact.artifact = artifact(
      fact.declaration.id,
      fact.declaration.groupKey,
      "provenance_json",
      generationEvidenceBytes(factBody),
    );
    fact.originalReferences = [spec.sourceId, "scope", "alternatives"];
    fact.declaration.dependencies = [...fact.declaration.dependencies, { family: "chunks", key: id(40) }];
    fact.inputReferences = [...fact.declaration.dependencies];
    const row = prepared(
      "index_units",
      spec.rowKey,
      {
        owner_id: ownerId,
        document_id: documentId,
        unit_type: "table_fact",
        source_chunk_id: id(41),
        source_image_id: id(30),
        page_start: 2,
        page_end: 2,
        heading_path: [],
        title: spec.cells[0],
        content: columns.map((column, cellIndex) => `${column}: ${spec.cells[cellIndex]}`).join(" | "),
        normalized_terms: [],
        source_span: null,
        quality_score: 0,
        extraction_mode: "deterministic",
        metadata: {
          columns,
          cells: [...spec.cells],
          row_index: spec.rowIndex,
          named_cells: columns.map((column, cellIndex) => ({ column, cell: spec.cells[cellIndex] })),
          table_fact_metadata: JSON.parse(generationEvidenceBytes(factBody.metadata).toString("utf8")),
          native_table_descriptor: JSON.parse(generationEvidenceBytes(imageBody.descriptor.metadata).toString("utf8")),
          threshold_value: null,
          action: null,
          source_qualification: "derived_unverified",
          index_generation_id: generationId,
        },
      },
      [
        { family: "table_facts", key: spec.factKey },
        { family: "chunks", key: id(41) },
        { family: "images", key: id(30) },
        { family: "chunks", key: id(40) },
      ],
      null,
    );
    row.originalReferences = [spec.sourceId, "scope", "alternatives"];
    return row;
  });
  args.producerManifests[4] = manifest(rows);
  resync(args);
  const pin = (unit: WholeOriginalPreparedUnit) => ({
    sha256: unit.artifact.sha256,
    byteLength: unit.artifact.byteLength,
  });
  // Snapshot commitments are frozen before mutations; independently authored row/role expectations remain separate.
  args.roleRequirements.tableRows = freezeGenerationEvidence(
    specs.map((spec, index) => ({
      sourceEvidenceId: spec.sourceId,
      candidateUnitId: { family: "index_units" as const, key: spec.rowKey },
      candidateArtifact: pin(rows[index]),
      tableFactUnitId: { family: "table_facts" as const, key: spec.factKey },
      tableFactArtifact: pin(args.producerManifests[2].units[index]),
      sourceChunkId: id(41),
      sourceChunkArtifact: pin(args.producerManifests[1].units[1]),
      sourceImageId: id(30),
      sourceImageArtifact: pin(image),
      ownerId,
      pageNumber: 2,
      tableIndex: 1,
      rowIndex: spec.rowIndex,
      columns: [...columns],
      cells: [...spec.cells],
      qualifications: [
        { sourceId: "scope", chunkIndex: 0, pageNumber: 1 },
        { sourceId: "alternatives", chunkIndex: 1, pageNumber: 2 },
      ].map((qualifier) => {
        const chunk = args.producerManifests[1].units[qualifier.chunkIndex];
        const literal = sourceLiterals.find((source) => source[1] === qualifier.sourceId)![2];
        const content = (chunk.body as { content: string }).content;
        return {
          sourceEvidenceId: qualifier.sourceId,
          chunkId: chunk.declaration.id.key,
          chunkArtifact: pin(chunk),
          pageNumber: qualifier.pageNumber,
          contentByteOffset: Buffer.byteLength(content.slice(0, content.indexOf(literal))),
          bytesHex: Buffer.from(literal).toString("hex"),
        };
      }),
    })),
  );
  return args;
}
function refreshPreparedBody(unit: WholeOriginalPreparedUnit) {
  unit.artifact = artifact(
    unit.declaration.id,
    unit.declaration.groupKey,
    "provenance_json",
    generationEvidenceBytes(unit.body),
  );
}

describe("declared table row qualification associations", () => {
  it("packages both full declared rows with separately located full qualification bodies while blocked", () => {
    const args = tableAssociationFixture();
    const before = generationEvidenceBytes(args.producerManifests);
    const plan = prepareWholeOriginalSupplier(args);
    expect(generationEvidenceBytes(plan.producerManifests)).toEqual(before);
    expect(plan.declaredTableAssociations?.status).toBe("matched_declared_association_unverified");
    expect(plan.declaredTableAssociations?.rows).toHaveLength(2);
    for (const row of plan.declaredTableAssociations!.rows) {
      expect(row.status).toBe("matched_declared_association_unverified");
      if (row.status !== "matched_declared_association_unverified") throw new Error("Expected matched table row");
      expect(row.row?.body).toEqual(
        args.producerManifests[4].units.find((unit) => unit.declaration.id.key === row.candidateUnitId.key)!.body,
      );
      expect(row.qualifications?.map((qualification) => qualification!.pageNumber)).toEqual([1, 2]);
      expect(row.qualifications?.map((qualification) => qualification!.body.content)).toEqual([pages[0], pages[1]]);
      expect(Object.isFrozen(row.qualifications?.[1]?.body)).toBe(true);
    }
    expect(plan.status).toBe("prepared_blocked");
    expect(plan.activated).toBe(false);
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        "native_mapping_unavailable",
        "source_completeness_unavailable",
        "ordinary_transport_readback_unavailable",
      ]),
    );
  });
  it("keeps legacy result shape identical and reports explicitly empty independent associations", () => {
    const args = fixture();
    const plan = prepareWholeOriginalSupplier(args);
    expect(plan).not.toHaveProperty("declaredTableAssociations");
    expect(plan.digest).toBe(prepareWholeOriginalSupplier(fixture()).digest);
    args.roleRequirements.tableRows = [];
    const empty = prepareWholeOriginalSupplier(args);
    expect(empty.declaredTableAssociations).toEqual({
      status: "incomplete_derived_association",
      limitation: "independent_table_associations_unavailable",
      rows: [],
    });
    expect(empty.blockers).toContain("declared_table_association_incomplete");
  });
  it.each(["missing-literal", "truncated-literal", "compact-summary"])(
    "keeps coherent %s substitution incomplete",
    (mode) => {
      const args = tableAssociationFixture();
      const chunk = args.producerManifests[1].units[1];
      const body = chunk.body as { content: string; content_hash: string };
      const literal = sourceLiterals.find((source) => source[1] === "alternatives")![2];
      body.content =
        mode === "compact-summary"
          ? literal
          : body.content.replace(literal, mode === "missing-literal" ? "" : "Alternatives only.");
      body.content_hash = generationEvidenceDigest(body.content);
      chunk.providerInputText = body.content;
      refreshPreparedBody(chunk);
      resync(args);
      const plan = prepareWholeOriginalSupplier(args);
      expect(plan.declaredTableAssociations?.status).toBe("incomplete_derived_association");
      for (const row of plan.declaredTableAssociations!.rows) {
        expect(row.reasons).toContain("full_qualification_chunk_mismatch");
        expect(row).not.toHaveProperty("row");
        expect(row).not.toHaveProperty("qualifications");
      }
    },
  );
  it("refuses attaching the crop as the qualification source", () => {
    const args = tableAssociationFixture();
    args.roleRequirements.requirements.find((role) => role.sourceEvidenceId === "alternatives")!.candidateUnits = [
      { family: "images", key: id(30) },
    ];
    const plan = prepareWholeOriginalSupplier(args);
    expect(plan.declaredTableAssociations?.rows[0].reasons).toContain("qualification_retained_role_anchor_unavailable");
    expect(plan.declaredTableAssociations?.rows[0]).not.toHaveProperty("qualifications");
  });
  it("keeps missing independent qualification associations unavailable despite intact full chunks", () => {
    const args = tableAssociationFixture();
    args.roleRequirements.tableRows = args.roleRequirements.tableRows!.map((binding) => ({
      ...binding,
      qualifications: binding.qualifications.filter(
        (qualification) => qualification.sourceEvidenceId !== "alternatives",
      ),
    }));
    const row = prepareWholeOriginalSupplier(args).declaredTableAssociations!.rows[0];
    expect(row.reasons).toContain("declared_qualification_association_missing");
    expect(row).not.toHaveProperty("qualifications");
  });
  it("distinguishes the repeated unit cell by its independently declared whole-row anchor", () => {
    const args = tableAssociationFixture();
    const other = args.roleRequirements.requirements.find((role) => role.sourceEvidenceId === "row-b")!;
    args.roleRequirements.requirements.find((role) => role.sourceEvidenceId === "row-a")!.evidence = JSON.parse(
      generationEvidenceBytes(other.evidence).toString("utf8"),
    );
    const row = prepareWholeOriginalSupplier(args).declaredTableAssociations!.rows[0];
    expect(row.reasons).toContain("declared_row_literal_mismatch");
    expect(row).not.toHaveProperty("row");
  });
  it.each(["row-index", "fact-rebinding", "cell-column", "same-literal-column"])(
    "does not accept coherent %s mutation",
    (mode) => {
      const args = tableAssociationFixture();
      const unit = args.producerManifests[4].units[0];
      const body = unit.body as { metadata: Record<string, unknown>; content: string };
      if (mode === "row-index") body.metadata.row_index = 2;
      if (mode === "fact-rebinding") {
        unit.declaration.dependencies = unit.declaration.dependencies.map((ref) =>
          ref.family === "table_facts" ? { family: "table_facts", key: id(51) } : ref,
        );
        unit.inputReferences = [...unit.declaration.dependencies];
        body.metadata.table_fact_metadata = JSON.parse(
          generationEvidenceBytes((args.producerManifests[2].units[1].body as { metadata: unknown }).metadata).toString(
            "utf8",
          ),
        );
      }
      if (mode === "cell-column") body.metadata.named_cells = [{ column: "Amount", cell: "Q-A" }];
      if (mode === "same-literal-column")
        body.metadata.named_cells = [
          { column: "Route", cell: "mg" },
          { column: "Unit", cell: "oral" },
        ];
      refreshPreparedBody(unit);
      resync(args);
      const row = prepareWholeOriginalSupplier(args).declaredTableAssociations!.rows[0];
      expect(row.status).toBe("incomplete_derived_association");
      expect(row.reasons).toContain("prepared_body_commitment_mismatch");
      expect(row).not.toHaveProperty("row");
    },
  );
  it.each(["foreign-generation", "auxiliary-chunk"])("refuses %s qualifications", (mode) => {
    const args = tableAssociationFixture();
    const unit = args.producerManifests[1].units[0];
    if (mode === "foreign-generation")
      (unit.body as { metadata: Record<string, unknown> }).metadata.index_generation_id = id(999);
    else {
      unit.auxiliary = true;
      unit.originalReferences = [];
    }
    refreshPreparedBody(unit);
    resync(args);
    expect(() => prepareWholeOriginalSupplier(args)).toThrow(
      mode === "foreign-generation" ? "declared_table_binding_control_mismatch" : "auxiliary_source_credit",
    );
  });
});

describe("ordinary prepared manifest assembly", () => {
  it("preserves full ordinary bodies and supplied declarations through blocked reconciliation", () => {
    const args = fixture();
    const before = generationEvidenceBytes(args.producerManifests.map((manifest) => manifest.units));
    args.producerManifests = args.producerManifests.map((manifest) =>
      assembleWholeOriginalProducerManifest(assemblyInput(manifest)),
    );
    const plan = prepareWholeOriginalSupplier(args);
    expect(generationEvidenceBytes(plan.producerManifests.map((manifest) => manifest.units))).toEqual(before);
    expect(plan.producerManifests[2].units[0].body).toMatchObject({
      metadata: { cells: ["Q-A", "2.50", "mg", "oral", "15 min"] },
      source_chunk_id: id(41),
      source_image_id: id(30),
    });
    expect(plan.producerManifests[3].units[0].body).not.toHaveProperty("id");
    expect(plan.producerManifests[4].units[0].body).not.toHaveProperty("id");
    expect(
      plan.producerManifests
        .flatMap((manifest) => manifest.units)
        .every((unit) => unit.declaration.sourceEvidenceIds.length === 0),
    ).toBe(true);
    expect(plan.originalApplicability.nativeMapping).toBe("unavailable");
    expect(plan.status).toBe("prepared_blocked");
    expect(plan.activated).toBe(false);
  });
  it.each(["missing", "extra", "duplicate", "foreign-family"])("rejects declared output population %s", (mode) => {
    const input = assemblyInput(fixture().producerManifests[1]);
    if (input.group.declaration.population.tag !== "known") throw new Error("fixture population");
    const expected = input.group.declaration.population.expectedUnits;
    if (mode === "missing") expected.pop();
    if (mode === "extra") expected.push({ family: "chunks", key: id(998) });
    if (mode === "duplicate") expected.push(expected[0]);
    if (mode === "foreign-family") expected[0] = { family: "images", key: id(40) };
    expect(() => assembleWholeOriginalProducerManifest(input)).toThrow("producer_population_mismatch");
  });
  it.each(["prepared", "pending", "unavailable"] as const)("preserves empty %s producer state", (state) => {
    const args = fixture();
    const input = assemblyInput(args.producerManifests[5]);
    input.state = state;
    input.units = [];
    input.group.declaration.population =
      state === "prepared"
        ? {
            tag: "known",
            expectedUnits: [],
            reason: "no_units_expected",
            basis: [{ reference: "supplied empty prepared outputs", sha256: generationEvidenceDigest([]) }],
          }
        : {
            tag: state === "pending" ? "unknown" : "unavailable",
            limitation: {
              code: "producer_unavailable",
              scope: "supplied deep producer state",
              capability: "optional_derivative",
            },
          };
    args.producerManifests[5] = assembleWholeOriginalProducerManifest(input);
    const plan = prepareWholeOriginalSupplier(args);
    expect(plan.producerManifests[5].state).toBe(state);
    expect(plan.producerManifests[5].units).toEqual([]);
    expect(plan.producerManifests[5].group.declaration.population).toEqual(input.group.declaration.population);
    expect(plan.status).toBe("prepared_blocked");
  });
  it("adds only supplied qualification chunk bindings and retains independent original references", () => {
    const args = fixture();
    const input = assemblyInput(args.producerManifests[2]);
    input.units[0].qualificationChunkIds = [id(40)];
    input.units[0].originalReferences = ["row-a", "scope", "alternatives"];
    args.producerManifests[2] = assembleWholeOriginalProducerManifest(input);
    const plan = prepareWholeOriginalSupplier(args);
    const unit = plan.producerManifests[2].units[0];
    expect(unit.declaration.dependencies).toContainEqual({ family: "chunks", key: id(40) });
    expect(unit.inputReferences).toContainEqual({ family: "chunks", key: id(40) });
    expect(unit.originalReferences).toEqual(["row-a", "scope", "alternatives"]);
    expect(unit.declaration.sourceEvidenceIds).toEqual([]);
    expect(unit.declaration.qualification).toBe("derived_unverified");
    expect(unit.body).toEqual(input.units[0].body);
    input.units[0].originalReferences = ["row-a", "alternatives"];
    args.producerManifests[2] = assembleWholeOriginalProducerManifest(input);
    expect(() => prepareWholeOriginalSupplier(args)).toThrow("qualification_dependency_missing");
  });
  it("keeps truncated qualification bodies visible to existing literal coverage checks", () => {
    const args = fixture();
    const input = assemblyInput(args.producerManifests[1]);
    const body = input.units[0].body as { content: string; content_hash: string };
    body.content = body.content.replace("Fictional QA only.", "Removed scope.");
    body.content_hash = generationEvidenceDigest(body.content);
    input.units[0].providerInputText = body.content;
    args.producerManifests[1] = assembleWholeOriginalProducerManifest(input);
    const plan = prepareWholeOriginalSupplier(args);
    expect(plan.preparedCandidateCoverage).toContainEqual({
      sourceEvidenceId: "scope",
      unitId: { family: "chunks", key: id(40) },
      status: "missing_literal",
    });
    expect(plan.blockers).toContain("prepared_candidate_literal_loss");
    expect(plan.status).toBe("prepared_blocked");
  });
  it.each(["absent-dependency", "foreign-dependency", "malformed"])(
    "rejects invalid supplied input reference %s",
    (mode) => {
      const args = fixture();
      const input = assemblyInput(args.producerManifests[3]);
      // The fixture shares these arrays; detach so each case changes only its intended graph edge.
      input.units[0].declaration.dependencies = input.units[0].declaration.dependencies.map((ref) => ({ ...ref }));
      if (mode === "malformed") input.units[0].inputReferences = [{ family: "unknown" as "chunks", key: id(999) }];
      else input.units[0].inputReferences.push({ family: "chunks", key: id(999) });
      if (mode === "foreign-dependency")
        input.units[0].declaration.dependencies.push({ family: "chunks", key: id(999) });
      if (mode === "foreign-dependency") {
        args.producerManifests[3] = assembleWholeOriginalProducerManifest(input);
        expect(() => prepareWholeOriginalSupplier(args)).toThrow("foreign_or_missing_dependency");
      } else expect(() => assembleWholeOriginalProducerManifest(input)).toThrow();
    },
  );
  it("preserves null provider input while refusing missing input and mismatched actual provider text", () => {
    const args = assembledFixture();
    expect(prepareWholeOriginalSupplier(args).producerManifests[4].units[0].providerInputText).toBeNull();
    const missing = assemblyInput(fixture().producerManifests[4]);
    Reflect.deleteProperty(missing.units[0], "providerInputText");
    expect(() => assembleWholeOriginalProducerManifest(missing)).toThrow();
    const field = assemblyInput(fixture().producerManifests[3]);
    field.units[0].providerInputText = "truncated actual field input";
    args.producerManifests[3] = assembleWholeOriginalProducerManifest(field);
    expect(() => prepareWholeOriginalSupplier(args)).toThrow("field_provider_input_mismatch");
  });
  it.each(["foreign-generation", "auxiliary-credit"])("retains reconciliation rejection for %s", (mode) => {
    const args = fixture();
    const index = mode === "foreign-generation" ? 1 : 0;
    const input = assemblyInput(args.producerManifests[index]);
    if (mode === "foreign-generation")
      (input.units[0].body as { index_generation_id: string }).index_generation_id = id(999);
    else input.units[1].originalReferences = ["scope"];
    if (mode === "auxiliary-credit")
      expect(() => assembleWholeOriginalProducerManifest(input)).toThrow("auxiliary_source_credit");
    else {
      args.producerManifests[index] = assembleWholeOriginalProducerManifest(input);
      expect(() => prepareWholeOriginalSupplier(args)).toThrow("body_control_mismatch");
    }
  });
  it("copies and freezes assembled bodies without invoking accessor or proxy code", () => {
    const input = assemblyInput(fixture().producerManifests[1]);
    const manifest = assembleWholeOriginalProducerManifest(input);
    const replay = assembleWholeOriginalProducerManifest(input);
    expect(replay.preparedManifestDigest).toBe(manifest.preparedManifestDigest);
    (input.units[0].body as { content: string }).content = "caller changed";
    expect((manifest.units[0].body as { content: string }).content).toBe(pages[0]);
    expect(Object.isFrozen(manifest.units[0].body)).toBe(true);
    let calls = 0;
    Object.defineProperty(input.units[0], "providerInputText", {
      enumerable: true,
      get() {
        calls += 1;
        return "unsafe";
      },
    });
    expect(() => assembleWholeOriginalProducerManifest(input)).toThrow("generation_evidence_requires_plain_data");
    const proxy = new Proxy(input, {
      get() {
        calls += 1;
        throw new Error("unsafe");
      },
    });
    expect(() => assembleWholeOriginalProducerManifest(proxy)).toThrow("generation_evidence_requires_plain_data");
    expect(calls).toBe(0);
  });
});

describe("whole-original supplied prepared manifest composer", () => {
  it.each([false, true])(
    "keeps mixed chunk cover association separate from frozen prose availability (loss=%s)",
    (loseProse) => {
      const args = fixture();
      const unit = args.producerManifests[1].units[0];
      const body = unit.body as { content: string; content_hash: string; image_ids: string[] };
      body.image_ids = [id(31)];
      unit.declaration.dependencies.push({ family: "images", key: id(31) });
      unit.originalReferences = ["scope"];
      if (loseProse) body.content = body.content.replace("Fictional QA only.", "Changed prose.");
      body.content_hash = generationEvidenceDigest(body.content);
      unit.providerInputText = body.content;
      unit.artifact = artifact(
        unit.declaration.id,
        unit.declaration.groupKey,
        "provenance_json",
        generationEvidenceBytes(body),
      );
      resync(args);
      const plan = prepareWholeOriginalSupplier(args);
      expect(plan.producerManifests[1].units[0].auxiliary).toBe(false);
      expect(plan.producerManifests[1].units[0].originalReferences).toEqual(["scope"]);
      expect(plan.producerManifests[1].units[0].declaration.sourceEvidenceIds).toEqual([]);
      expect(plan.producerManifests[1].units[0].declaration.qualification).toBe("derived_unverified");
      expect(plan.retainedLiteralAvailability).toContainEqual({
        sourceEvidenceId: "scope",
        status: "available_unverified",
      });
      expect(plan.preparedCandidateCoverage).toContainEqual({
        sourceEvidenceId: "scope",
        unitId: unit.declaration.id,
        status: loseProse ? "missing_literal" : "matched_literal_unverified",
      });
      if (loseProse) expect(plan.blockers).toContain("prepared_candidate_literal_loss");
      expect(plan.status).toBe("prepared_blocked");
      expect(plan.activated).toBe(false);
    },
  );
  it.each(["scope", "alternatives", "tail", "row-a", "row-b", "inequality"])(
    "reports coherent prepared literal loss for %s separately from retained availability",
    (sourceId) => {
      const args = fixture();
      const [page, , literal] = sourceLiterals.find((row) => row[1] === sourceId)!;
      const unit = args.producerManifests[1].units[page];
      const body = unit.body as { content: string; content_hash: string };
      body.content = body.content.replace(literal, "Changed prepared content.");
      body.content_hash = generationEvidenceDigest(body.content);
      unit.providerInputText = body.content;
      unit.artifact = artifact(
        unit.declaration.id,
        unit.declaration.groupKey,
        "provenance_json",
        generationEvidenceBytes(body),
      );
      resync(args);
      const plan = prepareWholeOriginalSupplier(args);
      expect(plan.uncovered).toEqual([]);
      expect(plan.retainedLiteralAvailability).toContainEqual({
        sourceEvidenceId: sourceId,
        status: "available_unverified",
      });
      expect(plan.preparedCandidateCoverage).toContainEqual({
        sourceEvidenceId: sourceId,
        unitId: unit.declaration.id,
        status: "missing_literal",
      });
      expect(plan.blockers).toContain("prepared_candidate_literal_loss");
      expect(plan.activated).toBe(false);
    },
  );
  it("labels omitted and nontext candidate coverage unassessed without inferring completeness", () => {
    const args = fixture();
    args.roleRequirements.requirements[0].candidateUnits = [];
    args.roleRequirements.requirements[2].candidateUnits = [{ family: "table_facts", key: id(50) }];
    const plan = prepareWholeOriginalSupplier(args);
    expect(plan.preparedCandidateCoverage).toContainEqual({
      sourceEvidenceId: "scope",
      unitId: null,
      status: "unassessed_no_candidates",
    });
    expect(plan.preparedCandidateCoverage).toContainEqual({
      sourceEvidenceId: "row-a",
      unitId: { family: "table_facts", key: id(50) },
      status: "unassessed_nontext",
    });
    expect(plan.blockers).toContain("prepared_candidate_coverage_unassessed");
  });
  it.each(["page-projection", "unreferenced-provenance"])(
    "refuses missing retained population %s even with unchanged literal evidence",
    (mode) => {
      const args = fixture();
      const removed =
        mode === "page-projection"
          ? { family: "pages", key: "1" }
          : { family: "private_objects", key: "page:1:original-provenance" };
      args.retentionPacket.artifacts = args.retentionPacket.artifacts.filter(
        (row) => JSON.stringify(row.unitId) !== JSON.stringify(removed),
      );
      args.retentionPacket.outcomes = args.retentionPacket.outcomes.filter(
        (row) => JSON.stringify(row.unitId) !== JSON.stringify(removed),
      );
      expect(() => prepareWholeOriginalSupplier(args)).toThrow("retained_declaration_population_missing");
    },
  );
  it.each(["original-getter", "witness-getter", "witness-function", "subclass-prototype"])(
    "refuses unsafe %s buffer without calling supplied code",
    (mode) => {
      const args = fixture();
      let calls = 0;
      const buffer = mode === "original-getter" ? args.originalBytes : args.witnessBytes;
      if (mode.endsWith("getter"))
        Object.defineProperty(buffer, "toString", {
          get() {
            calls += 1;
            throw new Error("getter executed");
          },
        });
      if (mode === "witness-function")
        Object.defineProperty(buffer, "toString", {
          value() {
            calls += 1;
            throw new Error("function executed");
          },
        });
      if (mode === "subclass-prototype")
        Object.setPrototypeOf(buffer, {
          ...Buffer.prototype,
          toString() {
            calls += 1;
            throw new Error("override executed");
          },
        });
      expect(() => prepareWholeOriginalSupplier(args)).toThrow("requires_retained_buffers");
      expect(calls).toBe(0);
    },
  );
  it("retains immutable byte snapshots after caller buffer mutation", () => {
    const args = fixture();
    const plan = prepareWholeOriginalSupplier(args);
    args.originalBytes.fill(0);
    args.witnessBytes.fill(0);
    expect(plan.source.sha256).toBe(prepareWholeOriginalSupplier(fixture()).source.sha256);
    expect(plan.digest).toBe(prepareWholeOriginalSupplier(fixture()).digest);
  });
  it.each(["binary-substitution", "provenance-id", "provenance-hash", "provenance-length", "duplicate-ordinal"])(
    "refuses coherent image placement %s",
    (mode) => {
      const args = fixture();
      if (mode === "binary-substitution") {
        const unit = args.producerManifests[0].units[0];
        unit.declaration.dependencies = [{ family: "private_objects", key: "image:2:binary" }];
        unit.inputReferences = unit.declaration.dependencies;
      } else if (mode === "duplicate-ordinal") {
        const unit = args.producerManifests[0].units[1];
        const first = args.producerManifests[0].units[0];
        unit.body = { ...(first.body as object), id: id(31) };
        unit.artifact = artifact(
          unit.declaration.id,
          unit.declaration.groupKey,
          "provenance_json",
          generationEvidenceBytes(unit.body),
        );
      } else {
        const row = args.retentionPacket.artifacts.find((value) => value.unitId.key === "image:1:provenance")!;
        const placement = JSON.parse(Buffer.from(row.bytesHex, "hex").toString("utf8"));
        if (mode === "provenance-id") placement.binary.unitId.key = "image:2:binary";
        if (mode === "provenance-hash") placement.binary.sha256 = generationEvidenceDigest("foreign bytes");
        if (mode === "provenance-length") placement.binary.byteLength += 1;
        Object.assign(row, artifact(row.unitId, row.groupKey, row.representation, generationEvidenceBytes(placement)));
        const outcome = args.retentionPacket.outcomes.find((value) => value.unitId.key === row.unitId.key)!;
        outcome.artifactSha256 = row.sha256;
      }
      resync(args);
      expect(() => prepareWholeOriginalSupplier(args)).toThrow(
        mode === "duplicate-ordinal" ? "duplicate_image_capture_ordinal" : "image_retention_binary_binding_mismatch",
      );
    },
  );
  it.each(["strong-qualification", "authenticated-source-ids"])("refuses prepared %s credit", (mode) => {
    const args = fixture();
    const unit = args.producerManifests[1].units[0];
    if (mode === "strong-qualification") unit.declaration.qualification = "source_bytes_exact";
    unit.declaration.sourceEvidenceIds = ["dose"];
    resync(args);
    expect(() => prepareWholeOriginalSupplier(args)).toThrow("prepared_source_credit_unavailable");
  });
  it.each(["metadata-only", "conflicting", "plural-cover", "foreign-image-array", "foreign-chunk-array"])(
    "checks every independent metadata reference %s",
    (mode) => {
      const args = fixture();
      const unit = args.producerManifests[4].units[0];
      const body = unit.body as { source_image_id: string | null; metadata: Record<string, unknown> };
      unit.auxiliary = false;
      unit.originalReferences = ["scope"];
      body.source_image_id = mode === "conflicting" ? id(30) : null;
      if (mode === "metadata-only" || mode === "conflicting") body.metadata.source_image_id = id(31);
      if (mode === "plural-cover") body.metadata.source_image_ids = [id(31)];
      if (mode === "foreign-image-array") body.metadata.source_image_ids = [id(999)];
      if (mode === "foreign-chunk-array") body.metadata.source_chunk_ids = [id(999)];
      if (mode === "conflicting") {
        unit.declaration.dependencies.push({ family: "images", key: id(30) });
        // inputReferences is the same supplied list in this independent fixture.
      }
      unit.artifact = artifact(
        unit.declaration.id,
        unit.declaration.groupKey,
        "provenance_json",
        generationEvidenceBytes(body),
      );
      resync(args);
      expect(() => prepareWholeOriginalSupplier(args)).toThrow(
        mode.startsWith("foreign") ? "body_reference_dependency_mismatch" : "auxiliary_source_credit",
      );
    },
  );
  it("preserves exact nonnull ordinary index provider text and field inputs without row IDs", () => {
    const args = fixture();
    const unit = args.producerManifests[4].units[0];
    unit.body = JSON.parse(generationEvidenceBytes(unit.body).toString("utf8"));
    const body = unit.body as { heading_path: string[]; normalized_terms: string[] };
    body.heading_path = ["Source", "Preview"];
    body.normalized_terms = ["display", "preview"];
    unit.providerInputText =
      "Type: visual_summary\nTitle: Cover\nPath: Source > Preview\nContent: Display preview only\nTerms: display, preview";
    unit.artifact = artifact(
      unit.declaration.id,
      unit.declaration.groupKey,
      "provenance_json",
      generationEvidenceBytes(body),
    );
    resync(args);
    const plan = prepareWholeOriginalSupplier(args);
    expect(plan.producerManifests[4].units[0].providerInputText).toBe(unit.providerInputText);
    expect(plan.producerManifests[3].units[0].body).not.toHaveProperty("id");
    expect(plan.producerManifests[4].units[0].body).not.toHaveProperty("id");
    unit.providerInputText += "\nwrong";
    resync(args);
    expect(() => prepareWholeOriginalSupplier(args)).toThrow("index_provider_input_mismatch");
  });
  it("retains three pages, both captures, complete ordinary outputs and separate producer namespaces without source credit", () => {
    const args = fixture();
    const plan = prepareWholeOriginalSupplier(args);
    expect(plan.uncovered).toEqual([]);
    expect(plan.status).toBe("prepared_blocked");
    expect(plan.activated).toBe(false);
    expect(plan.originalApplicability.nativeMapping).toBe("unavailable");
    if (plan.originalApplicability.status === "typed_original_requirements")
      expect(plan.originalApplicability.groups.every((group) => group.population.tag === "unknown")).toBe(true);
    expect(
      plan.producerManifests.filter((item) => item.group.family === "index_units").map((item) => item.group.groupKey),
    ).toEqual(["worker_core", "deep_memory"]);
    expect(plan.auxiliaryUnits).toEqual([
      { family: "images", key: id(31) },
      { family: "index_units", key: "core:cover" },
      { family: "index_units", key: "deep:cover" },
    ]);
    expect(plan.blockers).toContain("preseal_unavailable");
    expect(plan.blockers).toContain("provider_vectors_unavailable");
    expect(plan.blockers).toContain("ordinary_transport_readback_unavailable");
    expect(plan.producerManifests[2].units.map((unit) => unit.body)).toEqual(
      args.producerManifests[2].units.map((unit) => unit.body),
    );
  });
  it("copies and freezes exact bytes/text and replays deterministically across arbitrary populations", () => {
    const args = fixture();
    const plan = prepareWholeOriginalSupplier(args);
    expect(prepareWholeOriginalSupplier(fixture()).digest).toBe(plan.digest);
    expect(prepareWholeOriginalSupplier(fixture(true)).digest).not.toBe(plan.digest);
    expect(Object.isFrozen(plan.producerManifests[1].units[0].body)).toBe(true);
    expect(plan.producerManifests[1].units[0].providerInputText).toBe(pages[0]);
    args.producerManifests[1].units[0].providerInputText = "changed";
    expect(plan.producerManifests[1].units[0].providerInputText).toBe(pages[0]);
    const { digest, ...body } = plan;
    expect(generationEvidenceDigest(body)).toBe(digest);
  });
  it.each(["scope", "alternatives", "tail", "row-a", "row-b", "inequality"])(
    "reports exact changed literal %s without repairing it",
    (sourceId) => {
      const args = fixture();
      const role = args.roleRequirements.requirements.find((row) => row.sourceEvidenceId === sourceId)!;
      role.evidence[0].bytesHex = Buffer.from("different literal").toString("hex");
      expect(prepareWholeOriginalSupplier(args).uncovered).toContainEqual({
        sourceEvidenceId: sourceId,
        reason: "literal_bytes_missing_or_changed",
      });
    },
  );
  it("reports missing qualification and retains pending outcomes", () => {
    const args = fixture();
    args.roleRequirements.requirements = args.roleRequirements.requirements.filter(
      (row) => row.sourceEvidenceId !== "scope",
    );
    const plan = prepareWholeOriginalSupplier(args);
    expect(plan.uncovered).toContainEqual({ sourceEvidenceId: "scope", reason: "source_role_missing" });
    expect(plan.uncovered).toContainEqual({ sourceEvidenceId: "dose", reason: "qualifier_role_missing" });
    expect(plan.blockers).toContain("summary_pending");
    expect(plan.blockers).toContain("model_unavailable");
  });
  it.each(["foreign", "cycle", "extra", "missing", "duplicate"])(
    "refuses malformed cross-manifest population %s",
    (mode) => {
      const args = fixture();
      if (mode === "foreign")
        args.producerManifests[1].units[0].declaration.dependencies.push({ family: "images", key: id(999) });
      if (mode === "cycle") {
        args.producerManifests[0].units[0].declaration.dependencies.push({ family: "chunks", key: id(41) });
      }
      if (mode === "extra")
        args.producerManifests[1].group.declaration.population = {
          tag: "known",
          expectedUnits: [
            ...args.producerManifests[1].units.map((row) => row.declaration.id),
            { family: "chunks", key: id(998) },
          ],
          basis: [{ reference: "test", sha256: generationEvidenceDigest("test") }],
          reason: null,
        };
      if (mode === "missing") args.producerManifests[1].units.pop();
      if (mode === "duplicate") args.producerManifests.push(args.producerManifests[1]);
      if (mode !== "duplicate") resync(args);
      expect(() => prepareWholeOriginalSupplier(args)).toThrow();
    },
  );
  it.each(["control", "source", "literal-ref", "auxiliary", "body", "provider", "wrapper", "field-id"])(
    "refuses %s drift",
    (mode) => {
      const args = fixture();
      if (mode === "control") args.issued.firstLeaseToken = id(900);
      if (mode === "source") args.originalBytes = Buffer.from("different source");
      if (mode === "literal-ref") args.roleRequirements.requirements[0].evidence[0].unitId.key = "foreign";
      if (mode === "auxiliary") args.producerManifests[0].units[1].originalReferences.push("scope");
      if (mode === "body") (args.producerManifests[1].units[0].body as { content: string }).content = "changed";
      if (mode === "provider") args.producerManifests[1].units[0].providerInputText = "truncated";
      if (mode === "wrapper") args.producerManifests[1].units[0].declaration.id.key = id(999);
      if (mode === "field-id") (args.producerManifests[3].units[0].body as Record<string, unknown>).id = id(999);
      resync(args);
      expect(() => prepareWholeOriginalSupplier(args)).toThrow();
    },
  );
  it.each(["direct-index", "field-metadata"])("refuses unflagged cover-derived %s source credit", (mode) => {
    const args = fixture();
    if (mode === "direct-index") {
      const unit = args.producerManifests[4].units[0];
      unit.auxiliary = false;
      unit.originalReferences = ["scope"];
    } else {
      const unit = args.producerManifests[3].units[0];
      (unit.body as { metadata: Record<string, unknown> }).metadata.source_image_id = id(31);
      unit.declaration.dependencies.push({ family: "images", key: id(31) });
      unit.artifact = artifact(
        unit.declaration.id,
        unit.declaration.groupKey,
        "provenance_json",
        generationEvidenceBytes(unit.body),
      );
      unit.originalReferences = ["scope"];
    }
    resync(args);
    expect(() => prepareWholeOriginalSupplier(args)).toThrow("auxiliary_source_credit");
  });
  it("refuses unavailable-to-empty substitution and arbitrary data executable objects", () => {
    const args = fixture();
    args.producerManifests[0].state = "unavailable";
    const item = args.producerManifests[0];
    item.preparedManifestDigest = generationEvidenceDigest({
      state: item.state,
      units: item.units,
      inputReferences: item.inputReferences,
    });
    item.group.declaration.producer.outputManifestDigest = item.preparedManifestDigest;
    expect(() => prepareWholeOriginalSupplier(args)).toThrow("unavailable_is_not_empty");
    const bad = fixture();
    Object.defineProperty(bad.producerManifests[1].units[0].body, "evil", {
      enumerable: true,
      get() {
        throw new Error("getter executed");
      },
    });
    expect(() => prepareWholeOriginalSupplier(bad)).toThrow("generation_evidence_requires_plain_data");
  });
  it("rejects top-level accessors and proxies without executing caller code", () => {
    const args = fixture();
    let reads = 0;
    Object.defineProperty(args, "sourceExpectation", {
      enumerable: true,
      get() {
        reads += 1;
        return null;
      },
    });
    expect(() => prepareWholeOriginalSupplier(args)).toThrow("requires_plain_arguments");
    expect(reads).toBe(0);
    const proxy = new Proxy(fixture(), {
      get() {
        reads += 1;
        throw new Error("proxy executed");
      },
    });
    expect(() => prepareWholeOriginalSupplier(proxy)).toThrow("requires_plain_arguments");
    expect(reads).toBe(0);
  });
});
