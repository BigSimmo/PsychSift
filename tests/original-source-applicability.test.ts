import { describe, expect, it } from "vitest";
import {
  bytesDigest,
  generationEvidenceBytes,
  originalApplicabilityFamilies,
  parseOriginalApplicabilityWitness,
  type SourceExpectation,
  type OriginalApplicabilityWitness,
} from "@/lib/ingestion-generation-evidence";
import { buildGenerationRetentionPacket, resumeGenerationRetentionPacket } from "../worker/generation-evidence";

const original = Buffer.from("SYNTHETIC QA ONLY\nQ-A: 2 mg, QA only\nDo not combine QA scenarios.\nEND-QA\n");
function fixture() {
  const sourceUnits: NonNullable<SourceExpectation["units"]> = [
    { id: "scope", required: true, dependencies: [], locator: "authored scope", nativeMapping: "unavailable" as const },
    {
      id: "qualifier",
      required: true,
      dependencies: ["scope"],
      locator: "authored qualifier",
      nativeMapping: "unavailable" as const,
    },
    {
      id: "dose",
      required: true,
      dependencies: ["qualifier"],
      locator: "authored dose",
      nativeMapping: "unavailable" as const,
    },
  ];
  const body: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1" as const,
    qualification: "independently_declared_unverified" as const,
    sourceSha256: bytesDigest(original),
    sourceByteLength: original.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population:
        family === "chunks"
          ? {
              tag: "known" as const,
              requirements: [
                {
                  id: "authored-dose-obligation",
                  required: true as const,
                  sourceEvidenceIds: ["dose", "qualifier", "scope"],
                },
              ],
              basis: { scope: "whole_original" as const, kind: "independent_original_declaration" as const },
              reason: null,
            }
          : family === "images"
            ? {
                tag: "known" as const,
                requirements: [],
                basis: { scope: "whole_original" as const, kind: "independent_original_declaration" as const },
                reason: "no_original_requirements_in_scope" as const,
              }
            : { tag: "unknown" as const, limitation: "original_applicability_unavailable" },
    })),
  };
  return { body, sourceUnits };
}
function argsFor(body: ReturnType<typeof fixture>["body"], sourceUnits = body.sourceUnits) {
  const witnessBytes = generationEvidenceBytes(body);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(original),
    tag: "known",
    units: sourceUnits,
    witness: { reference: "independent synthetic original declaration", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  return { sourceExpectation, originalBytes: original, witnessBytes };
}
function chunks(body: ReturnType<typeof fixture>["body"]) {
  const population = body.groups.find((group) => group.family === "chunks")!.population;
  if (population.tag !== "known") throw new Error("fixture");
  return population;
}
function retentionArgs(input = argsFor(fixture().body)) {
  return {
    documentId: "00000000-0000-4000-8000-000000000001",
    generationId: "00000000-0000-4000-8000-000000000002",
    originalBytes: original,
    sourceExpectation: input.sourceExpectation,
    sourceExpectationWitnessBytes: input.witnessBytes,
    extracted: { pages: [{ pageNumber: 1, text: original.toString("utf8"), metadata: {} }], images: [] },
    persistedPages: [{ page_number: 1, text: original.toString("utf8"), ocr_used: false, metadata: {} }],
  };
}
describe("bound original applicability obligations", () => {
  it("binds actual bytes and full qualifier closure without granting producer/native/source completeness", () => {
    const { body } = fixture();
    const input = argsFor(body);
    const before = structuredClone(body);
    const result = parseOriginalApplicabilityWitness(input);
    expect(result.status).toBe("typed_original_requirements");
    if (result.status !== "typed_original_requirements") throw new Error("fixture");
    expect(result.groups.find((group) => group.family === "images")!.population).toEqual(body.groups[1].population);
    expect(result.groups.filter((group) => group.population.tag === "unknown")).toHaveLength(3);
    expect([result.nativeMapping, result.sourceCompleteness, result.producerCoverage]).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
    expect(Object.isFrozen(result.groups[0].population)).toBe(true);
    expect(body).toEqual(before);
    expect(Object.isFrozen(body)).toBe(false);
  });
  it("keeps absent and arbitrary historical witnesses unavailable without rewriting expectations", () => {
    const { body } = fixture();
    const input = argsFor(body);
    expect(parseOriginalApplicabilityWitness({ ...input, witnessBytes: undefined }).status).toBe("unavailable");
    const witnessBytes = Buffer.from("independent original expectation");
    const expectation = {
      ...input.sourceExpectation,
      witness: { reference: "legacy", sha256: bytesDigest(witnessBytes) },
    };
    const before = structuredClone(expectation);
    expect(parseOriginalApplicabilityWitness({ ...input, sourceExpectation: expectation, witnessBytes })).toMatchObject(
      {
        status: "unavailable",
        reason: "untyped_source_witness",
      },
    );
    expect(expectation).toEqual(before);
    expect(
      parseOriginalApplicabilityWitness({
        originalBytes: original,
        sourceExpectation: {
          version: 1,
          sourceSha256: bytesDigest(original),
          tag: "unknown",
          units: null,
          witness: null,
          limitation: "missing",
        },
      }),
    ).toMatchObject({ status: "unavailable", reason: "source_expectation_unavailable" });
  });
  it("refuses changed original and changed witness bytes independently", () => {
    const input = argsFor(fixture().body);
    expect(() => parseOriginalApplicabilityWitness({ ...input, originalBytes: Buffer.from("other original") })).toThrow(
      "original_applicability_source_mismatch",
    );
    expect(() =>
      parseOriginalApplicabilityWitness({
        ...input,
        witnessBytes: Buffer.concat([input.witnessBytes, Buffer.from(" ")]),
      }),
    ).toThrow("original_applicability_witness_mismatch");
  });
  it.each(["length", "source", "units", "requiredness"])(
    "refuses valid-rehashed %s drift from the original expectation",
    (kind) => {
      const { body, sourceUnits } = fixture();
      const expected = structuredClone(sourceUnits);
      if (kind === "length") body.sourceByteLength += 1;
      if (kind === "source") body.sourceSha256 = bytesDigest(Buffer.from("foreign"));
      if (kind === "units") body.sourceUnits[0].locator = "different original location";
      if (kind === "requiredness") body.sourceUnits[0].required = false;
      expect(() => parseOriginalApplicabilityWitness(argsFor(body, expected))).toThrow(
        "original_applicability_source_units_mismatch",
      );
    },
  );
  it.each(["missing", "duplicate", "undefined"])("never derives empty applicability from a %s group", (kind) => {
    const { body } = fixture();
    if (kind === "missing") body.groups.pop();
    if (kind === "duplicate") body.groups[4] = structuredClone(body.groups[3]);
    if (kind === "undefined") (body.groups[4] as unknown as Record<string, unknown>).population = null;
    expect(() => parseOriginalApplicabilityWitness(argsFor(body))).toThrow(
      kind === "undefined"
        ? "invalid_original_applicability_witness"
        : "original_applicability_group_population_mismatch",
    );
  });
  it("requires an explicit whole-original empty basis and rejects a producer-output basis", () => {
    const { body } = fixture();
    const population = chunks(body);
    population.requirements = [];
    expect(() => parseOriginalApplicabilityWitness(argsFor(body))).toThrow(
      "original_applicability_empty_basis_required",
    );
    population.reason = "no_original_requirements_in_scope";
    (population.basis as unknown as Record<string, unknown>).kind = "produced_empty_rows";
    expect(() => parseOriginalApplicabilityWitness(argsFor(body))).toThrow("invalid_original_applicability_witness");
  });
  it.each(["empty", "foreign", "duplicate", "missing-transitive"])(
    "rejects %s requirement references even with a valid new hash",
    (kind) => {
      const { body } = fixture();
      chunks(body).requirements[0].sourceEvidenceIds =
        kind === "empty"
          ? []
          : kind === "foreign"
            ? ["foreign"]
            : kind === "duplicate"
              ? ["scope", "scope"]
              : ["dose", "qualifier"];
      expect(() => parseOriginalApplicabilityWitness(argsFor(body))).toThrow(
        kind === "empty"
          ? "invalid_original_applicability_witness"
          : kind === "missing-transitive"
            ? "original_applicability_qualification_dependency_missing"
            : "original_applicability_source_reference_mismatch",
      );
    },
  );
  it("rejects duplicate obligations and cyclic qualification dependencies", () => {
    const { body } = fixture();
    chunks(body).requirements.push(structuredClone(chunks(body).requirements[0]));
    expect(() => parseOriginalApplicabilityWitness(argsFor(body))).toThrow(
      "original_applicability_duplicate_requirement",
    );
    const cyclic = fixture().body;
    cyclic.sourceUnits[0].dependencies = ["dose"];
    expect(() => parseOriginalApplicabilityWitness(argsFor(cyclic))).toThrow("original_applicability_dependency_cycle");
  });
  it("handles a long qualification chain without storing all transitive pairs", () => {
    const body = fixture().body;
    body.sourceUnits = Array.from({ length: 4000 }, (_, index) => ({
      id: `original-${index}`,
      required: true,
      dependencies: index ? [`original-${index - 1}`] : [],
      locator: `independently authored unit ${index}`,
      nativeMapping: "unavailable" as const,
    }));
    chunks(body).requirements[0].sourceEvidenceIds = body.sourceUnits.map((unit) => unit.id);
    expect(parseOriginalApplicabilityWitness(argsFor(body)).status).toBe("typed_original_requirements");
    chunks(body).requirements[0].sourceEvidenceIds.shift();
    expect(() => parseOriginalApplicabilityWitness(argsFor(body))).toThrow(
      "original_applicability_qualification_dependency_missing",
    );
  });
  it("accepts shared diamond dependencies and refuses the missing transitive qualification", () => {
    const body = fixture().body;
    body.sourceUnits = [
      { id: "scope", required: true, dependencies: [], locator: "scope", nativeMapping: "unavailable" },
      { id: "left", required: true, dependencies: ["scope"], locator: "left", nativeMapping: "unavailable" },
      { id: "right", required: true, dependencies: ["scope"], locator: "right", nativeMapping: "unavailable" },
      { id: "dose", required: true, dependencies: ["left", "right"], locator: "dose", nativeMapping: "unavailable" },
    ];
    chunks(body).requirements[0].sourceEvidenceIds = ["dose", "left", "right", "scope"];
    expect(parseOriginalApplicabilityWitness(argsFor(body)).status).toBe("typed_original_requirements");
    chunks(body).requirements[0].sourceEvidenceIds = ["dose", "left", "right"];
    expect(() => parseOriginalApplicabilityWitness(argsFor(body))).toThrow(
      "original_applicability_qualification_dependency_missing",
    );
  });
  it("rejects dangling source dependencies, optional relabelling and unsupported authority fields", () => {
    const dangling = fixture().body;
    dangling.sourceUnits[0].dependencies = ["not-an-original-unit"];
    expect(() => parseOriginalApplicabilityWitness(argsFor(dangling))).toThrow("source_dependency_population_mismatch");
    const optional = fixture().body;
    (chunks(optional).requirements[0] as unknown as Record<string, unknown>).required = false;
    expect(() => parseOriginalApplicabilityWitness(argsFor(optional))).toThrow(
      "invalid_original_applicability_witness",
    );
    const forged = fixture().body;
    (forged as unknown as Record<string, unknown>).sourceComplete = true;
    expect(() => parseOriginalApplicabilityWitness(argsFor(forged))).toThrow("invalid_original_applicability_witness");
  });
  it("refuses accessor-bearing expectation data before evaluating the accessor", () => {
    const input = argsFor(fixture().body);
    let reads = 0;
    Object.defineProperty(input.sourceExpectation, "units", {
      enumerable: true,
      get: () => {
        reads += 1;
        return [];
      },
    });
    expect(() => parseOriginalApplicabilityWitness(input)).toThrow("generation_evidence_requires_plain_data");
    expect(reads).toBe(0);
  });
  it("validates typed witness obligations in the actual retention entry without adding producer declarations", () => {
    const input = argsFor(fixture().body);
    const makePacket = (sourceInput = input) => buildGenerationRetentionPacket(retentionArgs(sourceInput));
    const packet = makePacket();
    expect(packet.registration.sourceExpectation).toEqual(input.sourceExpectation);
    expect(packet.declarations.groups.some((group) => group.family === "chunks")).toBe(false);
    expect(
      packet.artifacts.find((artifact) => artifact.representation === "source_expectation_witness")!.bytesHex,
    ).toBe(input.witnessBytes.toString("hex"));
    const malformed = fixture().body;
    chunks(malformed).requirements[0].sourceEvidenceIds = ["dose"];
    expect(() => makePacket(argsFor(malformed))).toThrow("original_applicability_qualification_dependency_missing");
  });
  it.each(["typed", "opaque"])(
    "replays the exact explicitly supplied %s witness, preserving absent-witness replay and refusing conflicts",
    (kind) => {
      const input = argsFor(fixture().body);
      if (kind === "opaque") {
        input.witnessBytes = Buffer.from("independent original expectation");
        input.sourceExpectation.witness!.sha256 = bytesDigest(input.witnessBytes);
      }
      const args = retentionArgs(input);
      const registered = buildGenerationRetentionPacket(args);
      const inventory = {
        documentId: args.documentId,
        generationId: args.generationId,
        sourceSha256: registered.registration.sourceSha256,
        sourceByteLength: original.length,
        sourceExpectation: registered.registration.sourceExpectation,
        sourceExpectationDigest: registered.registration.sourceExpectationSha256,
        registration: registered.registration,
        artifacts: registered.artifacts.map(({ unitId, sha256, representation }) => ({
          unitId,
          sha256,
          representation,
        })),
      };
      const resumed = resumeGenerationRetentionPacket(args, inventory);
      expect(resumed.registration).toEqual(registered.registration);
      expect(
        resumed.artifacts.find((artifact) => artifact.representation === "source_expectation_witness")!.bytesHex,
      ).toBe(input.witnessBytes.toString("hex"));
      const absent = resumeGenerationRetentionPacket(
        { ...args, sourceExpectation: undefined, sourceExpectationWitnessBytes: undefined },
        inventory,
      );
      expect(absent.registration).toEqual(registered.registration);
      expect(absent.artifacts.some((artifact) => artifact.representation === "source_expectation_witness")).toBe(false);
      expect(() =>
        resumeGenerationRetentionPacket(
          { ...args, sourceExpectationWitnessBytes: Buffer.from("conflicting bytes") },
          inventory,
        ),
      ).toThrow("independent_source_witness_not_retained");
      const conflicting = argsFor(fixture().body);
      if (kind === "opaque") conflicting.witnessBytes = Buffer.from("different independent original expectation");
      else {
        const body = fixture().body;
        chunks(body).requirements[0].id = "different original obligation";
        conflicting.witnessBytes = generationEvidenceBytes(body);
      }
      conflicting.sourceExpectation.witness!.sha256 = bytesDigest(conflicting.witnessBytes);
      expect(() => resumeGenerationRetentionPacket(retentionArgs(conflicting), inventory)).toThrow(
        "original_applicability_witness_mismatch",
      );
      const altered = structuredClone(inventory);
      altered.registration.declarations.groups[0].declaration.producer.version = "different declared producer version";
      expect(() => resumeGenerationRetentionPacket(args, altered)).toThrow("immutable_generation_registration");
    },
  );
});
