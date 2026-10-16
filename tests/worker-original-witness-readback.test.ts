import { describe, expect, it } from "vitest";
import { extractDocument } from "@/lib/extractors/document";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceSlots,
  originalApplicabilityFamilies,
  parseOriginalApplicabilityWitness,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "@/lib/ingestion-generation-evidence";
import { buildDocumentPageRowsForPersistence, serializeDocumentPageRowsForCommit } from "../worker/behavior";
import { buildGenerationRetentionPacket, resumeGenerationRetentionPacket } from "../worker/generation-evidence";
import { decodeRetainedOriginalWitness } from "../worker/original-witness-readback";

const documentId = "00000000-0000-4000-8000-000000000001";
const generationId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const originalBytes = Buffer.from("SYNTHETIC QA ONLY\nQ-A: 2 mg; do not combine QA scenarios.\nEND-QA\n");
const witnessKey = "original-source-expectation-witness";
const mismatch = "retained_original_witness_identity_mismatch";

async function fixture(opaqueBytes?: Buffer, unknown = false) {
  const sourceUnits: NonNullable<SourceExpectation["units"]> = [
    { id: "scope", required: true, dependencies: [], locator: "authored scope", nativeMapping: "unavailable" },
    { id: "dose", required: true, dependencies: ["scope"], locator: "authored QA dose", nativeMapping: "unavailable" },
  ];
  const body: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population:
        family === "chunks"
          ? {
              tag: "known",
              requirements: [{ id: "original-QA-dose", required: true, sourceEvidenceIds: ["dose", "scope"] }],
              basis: { scope: "whole_original", kind: "independent_original_declaration" },
              reason: null,
            }
          : family === "images"
            ? {
                tag: "known",
                requirements: [],
                basis: { scope: "whole_original", kind: "independent_original_declaration" },
                reason: "no_original_requirements_in_scope",
              }
            : { tag: "unknown", limitation: "original_applicability_unavailable" },
    })),
  };
  const witnessBytes = opaqueBytes ?? generationEvidenceBytes(body);
  const sourceExpectation: SourceExpectation = unknown
    ? {
        version: 1,
        sourceSha256: bytesDigest(originalBytes),
        tag: "unknown",
        units: null,
        witness: null,
        limitation: "independent_original_expectation_not_available",
      }
    : {
        version: 1,
        sourceSha256: bytesDigest(originalBytes),
        tag: "known",
        units: sourceUnits,
        witness: { reference: "independent synthetic authored requirements", sha256: bytesDigest(witnessBytes) },
        limitation: null,
      };
  const extracted = await extractDocument({ buffer: originalBytes, fileName: "synthetic.txt", mimeType: "text/plain" });
  const sanitation = {
    cleanString: (text: string) => text,
    sanitizeJsonbRecord: (value: unknown) => value as Record<string, unknown>,
  };
  const pages = buildDocumentPageRowsForPersistence(documentId, extracted, sanitation);
  const persistedPages = serializeDocumentPageRowsForCommit(pages, sanitation);
  const producerArgs = { documentId, generationId, originalBytes, extracted, persistedPages };
  const packet = buildGenerationRetentionPacket({
    ...producerArgs,
    sourceExpectation,
    ...(unknown ? {} : { sourceExpectationWitnessBytes: witnessBytes }),
  });
  const groups = [...packet.registration.declarations.groups, ...packet.declarations.groups];
  const inventory = {
    version: 1 as const,
    documentId,
    generationId,
    jobId: otherId,
    firstLeaseToken: otherId,
    authorityDigest: bytesDigest(Buffer.from("synthetic authority")),
    predecessorGenerationId: null,
    sourceSha256: packet.registration.sourceSha256,
    sourceByteLength: originalBytes.length,
    sourceExpectation: structuredClone(packet.registration.sourceExpectation),
    sourceExpectationDigest: packet.registration.sourceExpectationSha256,
    expectedInventoryDigest: null,
    registration: structuredClone(packet.registration),
    groups: generationEvidenceSlots.map(([family, groupKey]) => ({
      family,
      groupKey,
      state: groups.some((row) => row.family === family && row.groupKey === groupKey) ? "declared" : "pending",
      declaration: structuredClone(
        groups.find((row) => row.family === family && row.groupKey === groupKey)?.declaration ?? null,
      ),
    })),
    units: structuredClone([...packet.registration.declarations.units, ...packet.declarations.units]),
    outcomes: structuredClone(packet.outcomes),
    artifacts: packet.artifacts.map((row) => ({
      unitId: row.unitId,
      groupKey: row.groupKey,
      representation: row.representation,
      sha256: row.sha256,
      byteLength: row.byteLength,
      locator: row.locator,
      sourceSha256: packet.registration.sourceSha256,
    })),
    retainedOriginalWitness: unknown
      ? { status: "unavailable", reason: "source_expectation_unavailable" }
      : {
          status: "retained",
          documentId,
          generationId,
          sourceSha256: packet.registration.sourceSha256,
          sourceByteLength: originalBytes.length,
          sourceExpectationDigest: packet.registration.sourceExpectationSha256,
          unitId: { family: "private_objects", key: witnessKey },
          representation: "source_expectation_witness",
          bytesHex: witnessBytes.toString("hex"),
          sha256: bytesDigest(witnessBytes),
          byteLength: witnessBytes.length,
        },
  };
  return { body, witnessBytes, producerArgs, inventory };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const decode = (f: Fixture) =>
  decodeRetainedOriginalWitness({ documentId, generationId, originalBytes, inventory: f.inventory });
const payload = (f: Fixture) => f.inventory.retainedOriginalWitness as Record<string, unknown>;
function rebindWitness(f: Fixture, bytes: Buffer) {
  const hash = bytesDigest(bytes);
  f.inventory.sourceExpectation.witness!.sha256 = hash;
  f.inventory.registration.sourceExpectation.witness!.sha256 = hash;
  const expectationBytes = generationEvidenceBytes(f.inventory.sourceExpectation);
  f.inventory.registration.sourceExpectationHex = expectationBytes.toString("hex");
  f.inventory.registration.sourceExpectationSha256 = bytesDigest(expectationBytes);
  f.inventory.sourceExpectationDigest = bytesDigest(expectationBytes);
  Object.assign(payload(f), {
    bytesHex: bytes.toString("hex"),
    sha256: hash,
    byteLength: bytes.length,
    sourceExpectationDigest: bytesDigest(expectationBytes),
  });
  Object.assign(
    f.inventory.artifacts.find((row) => row.unitId.key === witnessKey)!,
    { sha256: hash, byteLength: bytes.length },
  );
}

describe("current-fenced original witness delivery", () => {
  it("delivers exact typed bytes into the real resume caller without changing its immutable registration or native authority", async () => {
    const f = await fixture();
    const before = generationEvidenceBytes(f.inventory);
    const result = decode(f);
    expect(result.status).toBe("retained");
    if (result.status !== "retained") throw new Error("fixture");
    expect(result.witnessBytes.equals(f.witnessBytes)).toBe(true);
    const observed = parseOriginalApplicabilityWitness({
      sourceExpectation: f.inventory.sourceExpectation,
      originalBytes,
      witnessBytes: result.witnessBytes,
    });
    expect(observed.status).toBe("typed_original_requirements");
    expect(observed.nativeMapping).toBe("unavailable");
    expect(observed.sourceCompleteness).toBe("unavailable");
    expect(observed.producerCoverage).toBe("unavailable");
    const resumed = resumeGenerationRetentionPacket(
      { ...f.producerArgs, sourceExpectationWitnessBytes: result.witnessBytes },
      f.inventory,
    );
    expect(resumed.registration).toEqual(f.inventory.registration);
    expect(resumed.artifacts.find((row) => row.unitId.key === witnessKey)?.bytesHex).toBe(
      f.witnessBytes.toString("hex"),
    );
    expect(resumed.declarations.groups.some((group) => group.family === "chunks")).toBe(false);
    expect(generationEvidenceBytes(f.inventory).equals(before)).toBe(true);
  });
  it.each([Buffer.from("opaque legacy QA declaration"), Buffer.alloc(0)])(
    "preserves genuine opaque witness bytes including empty bytes without making typed applicability available",
    async (bytes) => {
      const f = await fixture(bytes);
      const result = decode(f);
      if (result.status !== "retained") throw new Error("fixture");
      expect(result.witnessBytes.equals(bytes)).toBe(true);
      expect(
        parseOriginalApplicabilityWitness({
          sourceExpectation: f.inventory.sourceExpectation,
          originalBytes,
          witnessBytes: result.witnessBytes,
        }),
      ).toMatchObject({ status: "unavailable", reason: "untyped_source_witness", nativeMapping: "unavailable" });
      expect(
        resumeGenerationRetentionPacket(
          { ...f.producerArgs, sourceExpectationWitnessBytes: result.witnessBytes },
          f.inventory,
        ).registration,
      ).toEqual(f.inventory.registration);
    },
  );
  it("keeps unknown, known-but-not-retained and old absent payloads explicitly unavailable", async () => {
    expect(decode(await fixture(undefined, true))).toEqual({
      status: "unavailable",
      reason: "source_expectation_unavailable",
    });
    const missing = await fixture();
    missing.inventory.artifacts = missing.inventory.artifacts.filter((row) => row.unitId.key !== witnessKey);
    Object.assign(payload(missing), { status: "unavailable", reason: "witness_not_retained" });
    missing.inventory.retainedOriginalWitness = { status: "unavailable", reason: "witness_not_retained" };
    expect(decode(missing)).toEqual({ status: "unavailable", reason: "witness_not_retained" });
    const legacy = await fixture();
    delete (legacy.inventory as Record<string, unknown>).retainedOriginalWitness;
    expect(decode(legacy)).toEqual({ status: "unavailable", reason: "legacy_inventory_payload_missing" });
  });
  it.each([
    "documentId",
    "generationId",
    "sourceSha256",
    "sourceByteLength",
    "sourceExpectationDigest",
    "sha256",
    "byteLength",
    "bytesHex",
    "unitId",
    "representation",
  ])("refuses substituted %s before returning bytes", async (key) => {
    const f = await fixture();
    const bad: Record<string, unknown> = {
      documentId: otherId,
      generationId: otherId,
      sourceSha256: bytesDigest(Buffer.from("other")),
      sourceByteLength: originalBytes.length + 1,
      sourceExpectationDigest: bytesDigest(Buffer.from("other")),
      sha256: bytesDigest(Buffer.from("other")),
      byteLength: f.witnessBytes.length + 1,
      bytesHex: f.witnessBytes.toString("hex").slice(2),
      unitId: { family: "pages", key: "1" },
      representation: "original_binary",
    };
    payload(f)[key] = bad[key];
    expect(() => decode(f)).toThrow(mismatch);
  });
  it.each(["0g", "0", "AA", "zz", " "])("refuses malformed hex %s", async (hex) => {
    const f = await fixture();
    payload(f).bytesHex = hex;
    expect(() => decode(f)).toThrow(mismatch);
  });
  it.each([-1, 0.5])("refuses invalid byte length %s", async (byteLength) => {
    const f = await fixture();
    payload(f).byteLength = byteLength;
    expect(() => decode(f)).toThrow(mismatch);
  });
  it("refuses an unsafe integer length at the earlier plain-data boundary", async () => {
    const f = await fixture();
    payload(f).byteLength = Number.MAX_SAFE_INTEGER + 1;
    expect(() => decode(f)).toThrow("generation_evidence_requires_plain_data");
  });
  it("refuses foreign original bytes, stale registration, duplicate/missing refs and wrong source/group bindings", async () => {
    const f = await fixture();
    expect(() =>
      decodeRetainedOriginalWitness({
        documentId,
        generationId,
        originalBytes: Buffer.from("other original"),
        inventory: f.inventory,
      }),
    ).toThrow(mismatch);
    f.inventory.registration.sourceExpectationSha256 = bytesDigest(Buffer.from("stale"));
    expect(() => decode(f)).toThrow(mismatch);
    for (const change of ["duplicate", "missing", "source", "group", "representation"]) {
      const next = await fixture();
      const ref = next.inventory.artifacts.find((row) => row.unitId.key === witnessKey)!;
      if (change === "duplicate") next.inventory.artifacts.push({ ...ref });
      else if (change === "missing") next.inventory.artifacts = next.inventory.artifacts.filter((row) => row !== ref);
      else if (change === "source") ref.sourceSha256 = bytesDigest(Buffer.from("foreign source"));
      else if (change === "group") ref.groupKey = "worker_core";
      else ref.representation = "provenance_json";
      expect(() => decode(next)).toThrow(mismatch);
    }
  });
  it("rejects coherently rehashed malformed typed context instead of laundering it through byte identity", async () => {
    const f = await fixture();
    const forged = structuredClone(f.body);
    forged.sourceByteLength += 1;
    rebindWitness(f, generationEvidenceBytes(forged));
    expect(() => decode(f)).toThrow("original_applicability_source_units_mismatch");
  });
  it.each(["sourceExpectation", "registrationDeclarations"])(
    "keeps unexpected private key names out of %s errors",
    async (target) => {
      const f = await fixture();
      const privateKey = "SYNTH_PRIVATE_DETAIL__QA_dose_2mg";
      const privateValue = "SYNTH_PRIVATE_BODY__fictional_qualifier";
      const object =
        target === "sourceExpectation" ? f.inventory.sourceExpectation : f.inventory.registration.declarations;
      Object.assign(object, { [privateKey]: privateValue });
      let observed: unknown;
      try {
        decode(f);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(Error);
      expect((observed as Error).message).toBe(mismatch);
      expect((observed as Error).message).not.toContain(privateKey);
      expect((observed as Error).message).not.toContain(privateValue);
      expect((observed as Error).message).not.toContain(originalBytes.toString("utf8"));
    },
  );
  it("rejects false unavailable status, unknown retained data and accessors without invoking them", async () => {
    const f = await fixture();
    f.inventory.retainedOriginalWitness = { status: "unavailable", reason: "witness_not_retained" };
    expect(() => decode(f)).toThrow(mismatch);
    const unknown = await fixture(undefined, true);
    unknown.inventory.retainedOriginalWitness = (await fixture()).inventory.retainedOriginalWitness;
    expect(() => decode(unknown)).toThrow(mismatch);
    const accessor = await fixture();
    let reads = 0;
    Object.defineProperty(accessor.inventory, "retainedOriginalWitness", {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    expect(() => decode(accessor)).toThrow("generation_evidence_requires_plain_data");
    expect(reads).toBe(0);
  });
});
