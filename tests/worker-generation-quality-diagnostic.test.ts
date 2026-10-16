import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  attachPrerequisiteQualityDiagnostic,
  buildGenerationRetentionPacket,
  captureGenerationImages,
  stageGenerationPrerequisite,
} from "../worker/generation-evidence";
import {
  bytesDigest,
  generationEvidenceBytes,
  parseGenerationArtifact,
  parseGenerationDeclarations,
} from "@/lib/ingestion-generation-evidence";
import type { ExtractedDocument } from "@/lib/types";

const documentId = "00000000-0000-4000-8000-000000000001";
const generationId = "00000000-0000-4000-8000-000000000002";
function fixture(known = false) {
  const extracted: ExtractedDocument = {
    pages: [
      { pageNumber: 1, text: "SYNTHETIC qualifier", ocrUsed: true, needsOcr: false },
      { pageNumber: 2, text: "SYNTHETIC tail", ocrUsed: false, needsOcr: true },
      { pageNumber: 3, text: "SYNTHETIC unknown" },
    ],
    images: [],
  };
  const originalBytes = Buffer.from("SYNTHETIC ORIGINAL ONLY");
  const witness = Buffer.from("SYNTHETIC INDEPENDENT EXPECTATION");
  const packet = buildGenerationRetentionPacket({
    documentId,
    generationId,
    originalBytes,
    extracted,
    ...(known
      ? {
          sourceExpectation: {
            version: 1 as const,
            sourceSha256: bytesDigest(originalBytes),
            tag: "known" as const,
            units: [
              {
                id: "independent-required",
                required: true,
                dependencies: [],
                locator: "whole_received_buffer",
                nativeMapping: "unavailable" as const,
              },
            ],
            witness: { reference: "independent synthetic expectation", sha256: bytesDigest(witness) },
            limitation: null,
          },
          sourceExpectationWitnessBytes: witness,
        }
      : {}),
    persistedPages: extracted.pages.map((page) => ({
      page_number: page.pageNumber,
      text: page.text,
      ocr_used: Boolean(page.ocrUsed),
      metadata: {},
    })),
  });
  return { documentId, packet, extracted };
}
function diagnostic(packet: ReturnType<typeof buildGenerationRetentionPacket>) {
  const artifact = packet.artifacts.find((row) => row.unitId.family === "quality")!;
  return { artifact, body: JSON.parse(Buffer.from(artifact.bytesHex, "hex").toString("utf8")) };
}
describe("actual extraction-retention quality diagnostic", () => {
  it("declares one required private diagnostic before effects and preserves unknown flags/warnings", async () => {
    const f = fixture();
    const packet = attachPrerequisiteQualityDiagnostic(f);
    const { artifact, body } = diagnostic(packet);
    expect(body).toMatchObject({
      stage: "extraction_retention",
      qualification: "derived_unverified",
      observations: {
        pageCount: 3,
        capturedImageCount: 0,
        ocrUsed: { true: 1, false: 1, unknown: 1 },
        needsOcr: { true: 1, false: 1, unknown: 1 },
        warnings: { known: false, entries: [] },
      },
      downstream: {
        status: "unavailable",
        reason: "downstream_stages_not_executed",
        qualityScore: null,
        extractionQuality: null,
      },
    });
    expect(body.observations.extractedUtf8ByteLength).toBe(
      f.extracted.pages.reduce((n, page) => n + Buffer.byteLength(page.text, "utf8"), 0),
    );
    const unit = packet.declarations.units.find((row) => row.id.family === "quality")!;
    expect(unit).toMatchObject({
      id: { family: "quality", key: "singleton" },
      required: true,
      representation: "provenance_json",
      qualification: "derived_unverified",
      sourceEvidenceIds: [],
    });
    expect(unit.dependencies).toEqual(body.references.map((ref: { unitId: unknown }) => ref.unitId));
    expect(packet.outcomes.filter((row) => row.unitId.family === "quality")).toEqual([
      {
        unitId: artifact.unitId,
        groupKey: "worker_core",
        disposition: "retained",
        artifactSha256: artifact.sha256,
        limitation: null,
      },
    ]);
    const calls: string[] = [];
    await stageGenerationPrerequisite({
      packet,
      mutation: async (name) => {
        calls.push(name);
        return { accounting: { result: "unavailable" } };
      },
    });
    expect(calls.indexOf("declare_ingestion_generation_evidence")).toBeLessThan(
      calls.indexOf("retain_ingestion_generation_artifacts"),
    );
    expect(calls).not.toContain("persist_ingestion_index_quality");
    expect(calls).not.toContain("commit_document_index_generation");
    expect(calls).not.toContain("complete_ingestion_job");
  });
  it("distinguishes unknown warnings from explicit empty and hashes actual warnings without exposing them", () => {
    const f = fixture();
    const empty = diagnostic(
      attachPrerequisiteQualityDiagnostic({ ...f, extracted: { ...f.extracted, warnings: [] } }),
    ).body;
    expect(empty.observations.warnings).toEqual({ known: true, entries: [] });
    const warning = "SYNTHETIC ONLY: unverified extraction warning /private/path";
    const { body, artifact } = diagnostic(
      attachPrerequisiteQualityDiagnostic({ ...f, extracted: { ...f.extracted, warnings: [warning] } }),
    );
    expect(body.observations.warnings).toEqual({
      known: true,
      entries: [{ sha256: bytesDigest(Buffer.from(warning)), byteLength: Buffer.byteLength(warning) }],
    });
    expect(Buffer.from(artifact.bytesHex, "hex").toString("utf8")).not.toContain(warning);
    expect(body).not.toHaveProperty("metadata");
  });
  it("keeps explicit undefined flags unknown and replay stable", () => {
    const f = fixture();
    f.extracted.pages[2].ocrUsed = undefined;
    f.extracted.pages[2].needsOcr = undefined;
    const first = attachPrerequisiteQualityDiagnostic(f);
    expect(diagnostic(first).body.pageObservations[2]).toEqual({ pageNumber: 3, ocrUsed: null, needsOcr: null });
    expect(attachPrerequisiteQualityDiagnostic(f)).toEqual(first);
  });
  it("preserves known original expectation without giving the diagnostic source-evidence credit", () => {
    const f = fixture(true);
    const packet = attachPrerequisiteQualityDiagnostic(f);
    expect(diagnostic(packet).body.sourceExpectationDigest).toBe(f.packet.registration.sourceExpectationSha256);
    expect(packet.registration).toEqual(f.packet.registration);
    expect(packet.declarations.units.find((row) => row.id.family === "quality")!.sourceEvidenceIds).toEqual([]);
    expect(
      packet.declarations.groups.find((row) => row.family === "native_structure")!.declaration.population.tag,
    ).toBe("unknown");
  });
  it("rejects foreign document, changed extraction text/page population and malformed flags", () => {
    const f = fixture();
    for (const change of [
      { ...f, documentId: generationId },
      { ...f, extracted: { ...f.extracted, pages: f.extracted.pages.slice(1) } },
      {
        ...f,
        extracted: {
          ...f.extracted,
          pages: [{ ...f.extracted.pages[0], text: "FORGED" }, ...f.extracted.pages.slice(1)],
        },
      },
      {
        ...f,
        extracted: {
          ...f.extracted,
          pages: [{ ...f.extracted.pages[0], ocrUsed: "false" }, ...f.extracted.pages.slice(1)],
        },
      } as never,
    ])
      expect(() => attachPrerequisiteQualityDiagnostic(change)).toThrow();
  });
  it("rejects forged references/bytes and missing projection", () => {
    const f = fixture();
    for (const mutate of [
      (packet: typeof f.packet) => {
        packet.artifacts[0].sha256 = bytesDigest(Buffer.from("foreign"));
      },
      (packet: typeof f.packet) => {
        packet.artifacts = packet.artifacts.filter((row) => !(row.unitId.family === "pages" && row.unitId.key === "1"));
      },
      (packet: typeof f.packet) => {
        packet.registration.sourceExpectationSha256 = bytesDigest(Buffer.from("foreign expectation"));
      },
      (packet: typeof f.packet) => {
        packet.generationId = documentId;
      },
    ]) {
      const packet = structuredClone(f.packet);
      mutate(packet);
      expect(() => attachPrerequisiteQualityDiagnostic({ ...f, packet })).toThrow();
    }
  });
  it("counts actual owned image placements separately even when their captured bytes match", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "synthetic-quality-images-"));
    try {
      const f = fixture();
      const bytes = Buffer.from("SYNTHETIC IMAGE BYTES ONLY");
      const first = path.join(root, "first.png");
      const second = path.join(root, "second.png");
      await writeFile(first, bytes);
      await writeFile(second, bytes);
      const extracted = {
        ...f.extracted,
        images: [
          { pageNumber: 1, path: first, mimeType: "image/png", sourceKind: "embedded" as const },
          { pageNumber: 2, path: second, mimeType: "image/png", sourceKind: "embedded" as const },
        ],
      };
      const capturedImages = await captureGenerationImages({
        extracted,
        trustedTemporaryRoots: [root],
        fileName: "synthetic.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const packet = buildGenerationRetentionPacket({
        documentId,
        generationId,
        originalBytes: Buffer.from("SYNTHETIC ORIGINAL ONLY"),
        extracted,
        capturedImages,
        persistedPages: extracted.pages.map((page) => ({
          page_number: page.pageNumber,
          text: page.text,
          ocr_used: Boolean(page.ocrUsed),
          metadata: {},
        })),
      });
      const { body, artifact } = diagnostic(attachPrerequisiteQualityDiagnostic({ documentId, packet, extracted }));
      expect(body.observations.capturedImageCount).toBe(2);
      expect(
        body.references.filter((ref: { representation: string }) => ref.representation === "image_binary"),
      ).toHaveLength(2);
      expect(Buffer.from(artifact.bytesHex, "hex").toString("utf8")).not.toContain(root);
      expect(() =>
        attachPrerequisiteQualityDiagnostic({
          documentId,
          packet,
          extracted: { ...extracted, images: extracted.images.slice(1) },
        }),
      ).toThrow();
      expect(() =>
        attachPrerequisiteQualityDiagnostic({
          documentId,
          packet,
          extracted: { ...extracted, images: [{ ...extracted.images[0], pageNumber: 3 }, extracted.images[1]] },
        }),
      ).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects rehashed bad count partitions, downstream success, extra raw data and changed singleton plans", () => {
    const f = fixture();
    const packet = attachPrerequisiteQualityDiagnostic(f);
    const { artifact, body } = diagnostic(packet);
    for (const mutate of [
      (value: typeof body) => {
        value.observations.ocrUsed.false = 2;
      },
      (value: typeof body) => {
        value.downstream.qualityScore = 1;
      },
      (value: typeof body) => {
        value.rawText = f.extracted.pages[0].text;
      },
      (value: typeof body) => {
        value.references[0].representation = "document_projection";
      },
    ]) {
      const value = structuredClone(body);
      mutate(value);
      const bytes = generationEvidenceBytes(value);
      expect(() =>
        parseGenerationArtifact({
          ...artifact,
          bytesHex: bytes.toString("hex"),
          sha256: bytesDigest(bytes),
          byteLength: bytes.length,
        }),
      ).toThrow("quality_diagnostic_identity_mismatch");
    }
    const declarations = {
      version: 1,
      groups: [...packet.registration.declarations.groups, ...packet.declarations.groups],
      units: [...packet.registration.declarations.units, ...packet.declarations.units],
    };
    const changed = structuredClone(declarations);
    changed.units.find((row) => row.id.family === "quality")!.id.key = "later_score";
    expect(() => parseGenerationDeclarations(changed)).toThrow();
  });
});
