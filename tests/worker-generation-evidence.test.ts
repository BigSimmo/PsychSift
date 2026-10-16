import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGenerationRetentionPacket,
  canDeferOptionalProducerDeclarations,
  resumeGenerationRetentionPacket,
  stageGenerationPrerequisite,
} from "../worker/generation-evidence";
import { generationEvidenceDigest, generationEvidenceSlots } from "@/lib/ingestion-generation-evidence";
import { buildDocumentPageRowsForPersistence, serializeDocumentPageRowsForCommit } from "../worker/behavior";
import { sourceSegment } from "./helpers/source-contract";

const id = "00000000-0000-4000-8000-000000000001";
const generation = "00000000-0000-4000-8000-000000000002";
const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const pendingOptionalInventory = () => ({
  registration: { marker: "preserve-registration" },
  groups: [
    { family: "index_units", groupKey: "deep_memory", state: "pending", declaration: null },
    { family: "sections", groupKey: "deep_memory", state: "pending", declaration: null },
    { family: "memory_cards", groupKey: "deep_memory", state: "pending", declaration: null },
    { family: "summary", groupKey: "enrichment", state: "pending", declaration: null },
    { family: "generated_labels", groupKey: "enrichment", state: "pending", declaration: null },
    { family: "producer_aliases", groupKey: "deep_memory", state: "pending", declaration: null },
    { family: "cache_inputs", groupKey: "cache", state: "pending", declaration: null },
  ],
});
const skippedDeclaration = {
  producer: {
    name: "actual-old-producer",
    version: "retained-v1",
    outputManifestDigest: `sha256:${"a".repeat(64)}`,
  },
  artifactGenerationId: null,
  population: {
    tag: "unavailable",
    limitation: { code: "producer_skipped", scope: "prior-extraction-only-plan", capability: "optional_derivative" },
  },
};
describe("optional declaration timing from the actual inventory", () => {
  it("allows all seven pending slots without changing registration or inventory", () => {
    const inventory = pendingOptionalInventory();
    const before = generationEvidenceDigest(inventory);
    expect(canDeferOptionalProducerDeclarations(inventory)).toBe(true);
    expect(generationEvidenceDigest(inventory)).toBe(before);
    expect(Object.isFrozen(inventory.registration)).toBe(false);
  });
  it.each(["all declared", "mixed"])("preserves existing timing for %s optional producers", (mode) => {
    const inventory = pendingOptionalInventory();
    const groups = inventory.groups.map((group, index) =>
      mode === "all declared" || index === 3 ? { ...group, state: "declared", declaration: skippedDeclaration } : group,
    );
    const prior = { ...inventory, groups };
    const before = generationEvidenceDigest(prior);
    expect(canDeferOptionalProducerDeclarations(prior)).toBe(false);
    expect(generationEvidenceDigest(prior)).toBe(before);
  });
  it("validates nonoptional supplied rows without treating their declaration as optional progress", () => {
    const inventory = pendingOptionalInventory();
    expect(
      canDeferOptionalProducerDeclarations({
        ...inventory,
        groups: [
          ...inventory.groups,
          { family: "pages", groupKey: "worker_core", state: "pending", declaration: null },
        ],
      }),
    ).toBe(true);
  });
  it.each([
    ["missing inventory", null],
    ["missing groups", {}],
    ["nonarray groups", { groups: {} }],
    ["missing slot", { groups: pendingOptionalInventory().groups.slice(1) }],
    ["duplicate slot", { groups: [...pendingOptionalInventory().groups, pendingOptionalInventory().groups[0]] }],
    [
      "unknown identity",
      {
        groups: [
          ...pendingOptionalInventory().groups,
          { family: "summary", groupKey: "other", state: "pending", declaration: null },
        ],
      },
    ],
    ["untyped row", { groups: [...pendingOptionalInventory().groups, null] }],
    [
      "pending with declaration",
      {
        groups: pendingOptionalInventory().groups.map((row, index) =>
          index === 0 ? { ...row, declaration: skippedDeclaration } : row,
        ),
      },
    ],
    [
      "declared without declaration",
      {
        groups: pendingOptionalInventory().groups.map((row, index) =>
          index === 0 ? { ...row, state: "declared" } : row,
        ),
      },
    ],
    [
      "unknown state",
      {
        groups: pendingOptionalInventory().groups.map((row, index) =>
          index === 0 ? { ...row, state: "unknown" } : row,
        ),
      },
    ],
    [
      "incomplete identity",
      {
        groups: pendingOptionalInventory().groups.map((row, index) =>
          index === 0 ? { state: "pending", declaration: null } : row,
        ),
      },
    ],
  ])("refuses %s rather than inferring a fresh producer", (_label, inventory) => {
    expect(() => canDeferOptionalProducerDeclarations(inventory)).toThrow("invalid_optional_producer_inventory");
  });
  it("still refuses malformed later rows when an earlier optional producer is already declared", () => {
    const groups = pendingOptionalInventory().groups.map((row, index) =>
      index === 0 ? { ...row, state: "declared", declaration: skippedDeclaration } : row,
    );
    expect(() => canDeferOptionalProducerDeclarations({ groups: [...groups, { state: "unknown" }] })).toThrow(
      "invalid_optional_producer_inventory",
    );
  });
  it("refuses accessor data without executing it", () => {
    let reads = 0;
    const inventory = Object.defineProperty({}, "groups", {
      enumerable: true,
      get: () => {
        reads++;
        return [];
      },
    });
    expect(() => canDeferOptionalProducerDeclarations(inventory)).toThrow("invalid_optional_producer_inventory");
    expect(reads).toBe(0);
  });
});
describe("actual source to retained prerequisite packet", () => {
  it.each(["pending", "known", "skipped", "mixed"])(
    "resumes managed %s optional producers without recreating placeholders over durable declarations",
    async (mode) => {
      const args = {
        documentId: id,
        generationId: generation,
        originalBytes: Buffer.from("source"),
        extracted: { pages: [{ pageNumber: 1, text: "source" }], images: [] },
        persistedPages: [{ page_number: 1, text: "source", ocr_used: false, metadata: {} }],
      };
      const registered = buildGenerationRetentionPacket(args);
      const knownDeclaration = {
        producer: {
          name: "actual-synthetic-producer",
          version: "fixture-v1",
          outputManifestDigest: digest(Buffer.from("independent empty fixture")),
        },
        artifactGenerationId: null,
        population: {
          tag: "known",
          expectedUnits: [],
          basis: [
            { reference: "independently authored empty fixture population", sha256: digest(Buffer.from("fixture")) },
          ],
          reason: "no_units_expected",
        },
      };
      const groups = generationEvidenceSlots.map(([family, groupKey]) => {
        const optional = ["deep_memory", "enrichment", "cache"].includes(groupKey);
        const existing = [...registered.registration.declarations.groups, ...registered.declarations.groups].find(
          (group) => group.family === family && group.groupKey === groupKey,
        );
        if (optional) {
          if (mode === "pending" || (mode === "mixed" && family !== "summary"))
            return { family, groupKey, state: "pending", declaration: null };
          return {
            family,
            groupKey,
            state: "declared",
            declaration: mode === "skipped" ? skippedDeclaration : knownDeclaration,
          };
        }
        return {
          family,
          groupKey,
          state: existing ? "declared" : "pending",
          declaration: existing?.declaration ?? null,
        };
      });
      const inventory = {
        documentId: id,
        generationId: generation,
        sourceSha256: registered.registration.sourceSha256,
        sourceByteLength: args.originalBytes.length,
        sourceExpectation: registered.registration.sourceExpectation,
        sourceExpectationDigest: registered.registration.sourceExpectationSha256,
        registration: registered.registration,
        groups,
      };
      const before = generationEvidenceDigest(inventory);
      expect(canDeferOptionalProducerDeclarations(inventory)).toBe(mode === "pending");
      const resumed = resumeGenerationRetentionPacket({ ...args, deferOptionalProducerDeclarations: true }, inventory);
      const sent: unknown[] = [];
      await stageGenerationPrerequisite({
        packet: resumed,
        mutation: async (name, payload) => {
          if (name === "declare_ingestion_generation_evidence") sent.push(payload.p_declarations);
          return { ok: true, accounting: { result: "unavailable" } };
        },
      });
      expect(sent).toEqual([resumed.declarations]);
      expect(
        resumed.declarations.groups.some((group) => ["deep_memory", "enrichment", "cache"].includes(group.groupKey)),
      ).toBe(false);
      expect(resumed.registration).toEqual(registered.registration);
      expect(generationEvidenceDigest(inventory)).toBe(before);
      const malformed = {
        ...inventory,
        groups: [...groups, { family: "summary", groupKey: "enrichment", state: "pending", declaration: null }],
      };
      expect(() => canDeferOptionalProducerDeclarations(malformed)).toThrow("invalid_optional_producer_inventory");
    },
  );
  it("defers only optional producer placeholders while retaining the extraction plan and bytes", async () => {
    const args = {
      documentId: id,
      generationId: generation,
      originalBytes: Buffer.from("source"),
      extracted: { pages: [{ pageNumber: 1, text: "source" }], images: [] },
      persistedPages: [{ page_number: 1, text: "source", ocr_used: false, metadata: {} }],
    };
    const legacy = buildGenerationRetentionPacket(args);
    expect(buildGenerationRetentionPacket({ ...args, deferOptionalProducerDeclarations: false })).toEqual(legacy);
    const deferred = buildGenerationRetentionPacket({ ...args, deferOptionalProducerDeclarations: true });
    const optionalSlots = [
      ["index_units", "deep_memory"],
      ["sections", "deep_memory"],
      ["memory_cards", "deep_memory"],
      ["summary", "enrichment"],
      ["generated_labels", "enrichment"],
      ["producer_aliases", "deep_memory"],
      ["cache_inputs", "cache"],
    ];
    const placeholders = legacy.declarations.groups.filter(
      (group) => group.declaration.population.tag === "unavailable",
    );
    expect(placeholders.map((group) => [group.family, group.groupKey])).toEqual(optionalSlots);
    for (const group of placeholders) {
      expect(group.declaration.population).toEqual({
        tag: "unavailable",
        limitation: {
          code: "producer_skipped",
          scope: "prerequisite_stage_not_executed_derivative_only_no_required_dependency",
          capability: "optional_derivative",
        },
      });
    }
    expect(deferred).toEqual({
      ...legacy,
      declarations: {
        ...legacy.declarations,
        groups: legacy.declarations.groups.filter((group) => !placeholders.includes(group)),
      },
    });
    expect(deferred.declarations.groups.map((group) => [group.family, group.groupKey])).toEqual([
      ["pages", "worker_core"],
      ["native_structure", "worker_native"],
      ["document_metadata", "projection_aggregate"],
    ]);
    expect(Object.isFrozen(deferred.declarations.groups)).toBe(true);
    expect(Object.isFrozen(deferred.registration)).toBe(true);
    expect(args.extracted.pages[0].text).toBe("source");
    expect(Object.isFrozen(args.extracted)).toBe(false);
    const declarations: unknown[] = [];
    const result = await stageGenerationPrerequisite({
      packet: deferred,
      mutation: async (name, payload) => {
        if (name === "declare_ingestion_generation_evidence") declarations.push(payload.p_declarations);
        return { ok: true, accounting: { result: "unavailable" } };
      },
    });
    expect(declarations).toEqual([deferred.declarations]);
    expect(result.result).toBe("unavailable");
  });
  it("keeps the registered plan unchanged when resuming with optional declaration deferral", () => {
    const args = {
      documentId: id,
      generationId: generation,
      originalBytes: Buffer.from("source"),
      extracted: { pages: [{ pageNumber: 1, text: "source" }], images: [] },
      persistedPages: [{ page_number: 1, text: "source", ocr_used: false, metadata: {} }],
    };
    const registered = buildGenerationRetentionPacket(args);
    const inventory = {
      documentId: id,
      generationId: generation,
      sourceSha256: registered.registration.sourceSha256,
      sourceByteLength: args.originalBytes.length,
      sourceExpectation: registered.registration.sourceExpectation,
      sourceExpectationDigest: registered.registration.sourceExpectationSha256,
      registration: registered.registration,
      groups: registered.declarations.groups.map((group) => ({ ...group, state: "declared" })),
    };
    const priorDigest = generationEvidenceDigest(inventory);
    const resumed = resumeGenerationRetentionPacket({ ...args, deferOptionalProducerDeclarations: true }, inventory);
    expect(resumed.registration).toEqual(registered.registration);
    expect(
      resumed.declarations.groups.some((group) => ["deep_memory", "enrichment", "cache"].includes(group.groupKey)),
    ).toBe(false);
    expect(generationEvidenceDigest(inventory)).toBe(priorDigest);
    // Stored placeholders remain immutable; omission grants no authority to upgrade them.
    expect(inventory.groups.filter((group) => group.declaration.population.tag === "unavailable")).toHaveLength(7);
  });
  it("retains NUL source bytes, pre-sanitation extracted UTF8 and the actual final page payload separately", async () => {
    const bytes = Buffer.from("original\0é");
    const extracted = { pages: [{ pageNumber: 1, text: "extracted\0é", ocrUsed: false }], images: [] };
    const sanitation = {
      cleanString: (value: string) => value.replace(/\u0000/g, ""),
      sanitizeJsonbRecord: (value: unknown) => value as Record<string, unknown>,
    };
    const rows = buildDocumentPageRowsForPersistence(id, extracted, sanitation);
    const final = serializeDocumentPageRowsForCommit(rows, sanitation);
    const packet = buildGenerationRetentionPacket({
      documentId: id,
      generationId: generation,
      originalBytes: bytes,
      extracted,
      persistedPages: final,
    });
    const binary = packet.artifacts.find((row) => row.representation === "original_binary")!;
    const originalText = packet.artifacts.find((row) => row.representation === "extracted_utf8")!;
    const persistedText = packet.artifacts.find((row) => row.representation === "persisted_utf8")!;
    expect(binary.bytesHex).toBe(bytes.toString("hex"));
    expect(binary.sha256).toBe(digest(bytes));
    expect(Buffer.from(originalText.bytesHex, "hex").toString("utf8")).toBe("extracted\0é");
    expect(Buffer.from(persistedText.bytesHex, "hex").toString("utf8")).toBe(final[0].text);
    expect(originalText.sha256).not.toBe(persistedText.sha256);
    expect(packet.registration.sourceExpectation.tag).toBe("unknown");
    const operations: string[] = [];
    const result = await stageGenerationPrerequisite({
      packet,
      mutation: async (name) => {
        operations.push(name);
        return { ok: true, accounting: { result: "unavailable" } };
      },
    });
    expect(operations).toEqual([
      "begin_ingestion_generation_evidence",
      "declare_ingestion_generation_evidence",
      "retain_ingestion_generation_artifacts",
      "record_ingestion_generation_outcomes",
      "record_ingestion_generation_accounting",
    ]);
    expect(result.result).toBe("unavailable");
    expect(operations).not.toContain("commit_document_index_generation");
  });
  it("refuses exact retained identity for foreign final pages and unpaired-surrogate extraction", () => {
    const base = {
      documentId: id,
      generationId: generation,
      originalBytes: Buffer.from("source"),
      extracted: { pages: [{ pageNumber: 1, text: "source" }], images: [] },
    };
    expect(() =>
      buildGenerationRetentionPacket({
        ...base,
        persistedPages: [{ document_id: generation, page_number: 1, text: "source", ocr_used: false, metadata: {} }],
      }),
    ).toThrow();
    expect(() =>
      buildGenerationRetentionPacket({
        ...base,
        extracted: { pages: [{ pageNumber: 1, text: "\ud800" }], images: [] },
        persistedPages: [{ document_id: id, page_number: 1, text: "source", ocr_used: false, metadata: {} }],
      }),
    ).toThrow();
  });
  it("resumes the exact known registration and already retained witness without replacing either", async () => {
    const originalBytes = Buffer.from("source");
    const witnessBytes = Buffer.from("independent original expectation");
    const args = {
      documentId: id,
      generationId: generation,
      originalBytes,
      extracted: { pages: [{ pageNumber: 1, text: "source" }], images: [] },
      persistedPages: [{ page_number: 1, text: "source", ocr_used: false, metadata: {} }],
    };
    const registered = buildGenerationRetentionPacket({
      ...args,
      sourceExpectation: {
        version: 1,
        sourceSha256: digest(originalBytes),
        tag: "known",
        units: [
          {
            id: "independent-original-text",
            required: true,
            dependencies: [],
            locator: "whole_original_file",
            nativeMapping: "unavailable",
          },
        ],
        witness: { reference: "independent-oracle", sha256: digest(witnessBytes) },
        limitation: null,
      },
      sourceExpectationWitnessBytes: witnessBytes,
    });
    const inventory = {
      documentId: id,
      generationId: generation,
      sourceSha256: digest(originalBytes),
      sourceByteLength: originalBytes.length,
      sourceExpectation: registered.registration.sourceExpectation,
      sourceExpectationDigest: registered.registration.sourceExpectationSha256,
      registration: registered.registration,
      artifacts: registered.artifacts.map(({ unitId, sha256, representation }) => ({ unitId, sha256, representation })),
    };
    const resumed = resumeGenerationRetentionPacket(args, inventory);
    expect(generationEvidenceDigest(resumed.registration)).toBe(generationEvidenceDigest(registered.registration));
    expect(resumed.registration.sourceExpectation.tag).toBe("known");
    expect(resumed.artifacts.some((row) => row.representation === "source_expectation_witness")).toBe(false);
    const operations: string[] = [];
    await stageGenerationPrerequisite({
      packet: resumed,
      mutation: async (name, payload) => {
        operations.push(name);
        if (name === "begin_ingestion_generation_evidence")
          expect(payload.p_registration).toEqual(registered.registration);
        return { ok: true, accounting: { result: "unavailable" } };
      },
    });
    expect(operations).toHaveLength(5);
    expect(() =>
      resumeGenerationRetentionPacket(
        {
          ...args,
          extracted: { pages: [{ pageNumber: 2, text: "source" }], images: [] },
          persistedPages: [{ page_number: 2, text: "source", ocr_used: false, metadata: {} }],
        },
        inventory,
      ),
    ).toThrow("immutable_generation_registration");
    expect(() => resumeGenerationRetentionPacket(args, { ...inventory, artifacts: [] })).toThrow(
      "independent_source_witness_not_retained",
    );
  });
  it("refuses missing required image capture and resolves adoption before public document mutations", () => {
    const args = {
      documentId: id,
      generationId: generation,
      originalBytes: Buffer.from("source"),
      extracted: { pages: [{ pageNumber: 1, text: "source" }], images: [] },
      persistedPages: [{ page_number: 1, text: "source", ocr_used: false, metadata: {} }],
    };
    const withImage = { ...args.extracted, images: [{}] } as unknown as typeof args.extracted;
    expect(() => buildGenerationRetentionPacket({ ...args, extracted: withImage })).toThrow(
      "retained_image_capture_population_mismatch",
    );
    const source = readFileSync("worker/main.ts", "utf8");
    const process = source.slice(source.indexOf("async function processJob(job: JobRow)"));
    expect(process.indexOf('"read_ingestion_generation_inventory"')).toBeLessThan(
      process.indexOf("await updateDocument("),
    );
    expect(process.indexOf('"read_ingestion_generation_inventory"')).toBeLessThan(
      process.indexOf("await resetDocumentIndex("),
    );
    expect(process).toContain("if (evidenceInventory.managed !== true)");
    expect(process).toContain("resumeGenerationRetentionPacket(");
  });
  it("enables genuine local memory only in the retained-witness managed branch and preserves its refusal", () => {
    const source = readFileSync("worker/main.ts", "utf8");
    const start = source.indexOf('if (originalWitness.status === "retained") {');
    const end = source.indexOf("await stageGenerationPrerequisite(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const branch = source.slice(start, end);
    expect(branch).toMatch(
      /const supplierInput:\s*ManagedPreparedSupplierInput\s*=\s*\{[\s\S]*?includeLocalMemory:\s*true,\s*\}/,
    );
    expect(branch).toMatch(/const \{ plan \} = await runManagedPrivateSupplier\(\{\s*input:\s*supplierInput,/);
    expect(source.match(/includeLocalMemory:\s*true/g)).toHaveLength(1);
    expect(branch).toContain("witnessBytes: originalWitness.witnessBytes");
    expect(branch).toContain("retentionPacket: packet");
    expect(branch).toContain("currentInventory: evidenceInventory.inventory");
    expect(branch).toContain("mutation: (name, payload) => mutation(attempt, name, payload)");
    expect(branch).toContain("check: () => attempt.check()");
    const supplier = branch.indexOf("await runManagedPrivateSupplier(");
    const vectorProduction = branch.indexOf("await produceManagedVectorFinalPacket(");
    const vectorStage = branch.indexOf("await stageManagedVectorFinal(");
    const nativeProduction = branch.indexOf("await produceManagedNativeParentClosurePacket(");
    const nativeStage = branch.indexOf("await stageManagedNativeParentClosure(");
    const refusal = branch.search(
      /throw new Error\(\s*"technical_supplier_not_implemented: private candidate rows retained; independent completeness and required fidelity unavailable",?\s*\);/,
    );
    for (const position of [supplier, vectorProduction, vectorStage, nativeProduction, nativeStage, refusal]) {
      expect(position).toBeGreaterThan(-1);
    }
    expect(supplier).toBeLessThan(refusal);
    expect(supplier).toBeLessThan(vectorProduction);
    expect(vectorProduction).toBeLessThan(vectorStage);
    expect(vectorStage).toBeLessThan(refusal);
    expect(branch).toMatch(
      /const hasPreparedImages = plan\.producerManifests\.some\([\s\S]*?manifest\.group\.family === "images"[\s\S]*?manifest\.group\.groupKey === "worker_core"[\s\S]*?manifest\.state === "prepared"[\s\S]*?manifest\.units\.length > 0/,
    );
    const nativeBranch = sourceSegment(
      branch,
      "if (hasPreparedImages) {",
      "const vectorPacket = await produceManagedVectorFinalPacket(vectorInput);",
      { label: "managed native branch" },
    );
    const vectorBranch = sourceSegment(
      branch,
      "const vectorPacket = await produceManagedVectorFinalPacket(vectorInput);",
      "// Prepared bodies and private candidate rows",
      { label: "managed vector branch" },
    );
    expect(nativeBranch).toMatch(
      /^if \(hasPreparedImages\) \{\s*const nativePacket = await produceManagedNativeParentClosurePacket\(vectorInput\);\s*const nativeReadback = await stageManagedNativeParentClosure\(\{ \.\.\.stageInput, packet: nativePacket \}\);/,
    );
    expect(nativeBranch).toMatch(/\}\s*else\s*\{\s*$/);
    expect(vectorBranch).toMatch(
      /^const vectorPacket = await produceManagedVectorFinalPacket\(vectorInput\);\s*await stageManagedVectorFinal\(\{ \.\.\.stageInput, packet: vectorPacket \}\);\s*\}\s*$/,
    );
    expect(branch).toMatch(
      /const vectorInput = \{\s*input: supplierInput,\s*expectedPlanDigest: plan\.digest,\s*issued: issuedControlSnapshot,\s*batchSize: env\.WORKER_BATCH_SIZE,\s*embed: \(texts: string\[\], batchContext: ManagedProviderEmbeddingBatchContext\) =>\s*workerEmbedTexts\(job, texts, batchContext, plan\.digest\),\s*assertEmbedding: assertEmbeddingDim,\s*check: \(\) => attempt\.check\(\),/,
    );
    expect(branch).toMatch(
      /const stageInput = \{\s*input: supplierInput,\s*expectedPlanDigest: plan\.digest,\s*issued: issuedControlSnapshot,\s*fence: attempt\.fence,[\s\S]*?readRpc,\s*check: \(\) => attempt\.check\(\),/,
    );
    expect(supplier).toBeLessThan(nativeProduction);
    expect(nativeProduction).toBeLessThan(nativeStage);
    expect(nativeStage).toBeLessThan(refusal);
    const readStart = branch.indexOf("const readRpc = (name: string, payload: Record<string, unknown>)");
    expect(readStart).toBeGreaterThan(-1);
    const readEnd = branch.indexOf("const vectorInput =", readStart);
    expect(readEnd).toBeGreaterThan(readStart);
    const reader = branch.slice(readStart, readEnd);
    expect(reader).toContain("runIngestionPreparedWork(");
    expect(reader).toContain("ingestionRpcClient.rpc(name, payload)");
    expect(reader).toContain('mutation(attempt, "heartbeat_ingestion_job")');
    expect(reader).toContain("attempt.check()");
    expect(reader).toContain("attempt.cancel()");
    expect(reader).not.toContain("mutation(attempt, name, payload)");
    expect(branch).toContain(
      "technical_supplier_not_implemented: private candidate rows retained; independent completeness and required fidelity unavailable",
    );
  });
});
