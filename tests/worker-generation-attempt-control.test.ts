import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  attachAttemptControlEvidence,
  buildGenerationRetentionPacket,
  captureIssuedAttemptControl,
  resumeGenerationRetentionPacket,
  stageGenerationPrerequisite,
} from "../worker/generation-evidence";
import {
  bytesDigest,
  generationEvidenceBytes,
  parseGenerationArtifact,
  parseGenerationDeclarations,
  outcomeInputSchema,
} from "@/lib/ingestion-generation-evidence";

const documentId = "00000000-0000-4000-8000-000000000001";
const generationId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const token = "00000000-0000-4000-8000-000000000004";
const batch = "00000000-0000-4000-8000-000000000005";
function fixture(known = false) {
  const originalBytes = Buffer.from("SYNTHETIC ONLY: retain the final qualifier.");
  const witness = Buffer.from("independent synthetic expectation");
  const args = {
    documentId,
    generationId,
    originalBytes,
    extracted: { pages: [{ pageNumber: 1, text: originalBytes.toString("utf8"), ocrUsed: false }], images: [] },
    persistedPages: [{ page_number: 1, text: originalBytes.toString("utf8"), ocr_used: false, metadata: {} }],
  };
  const packet = buildGenerationRetentionPacket({
    ...args,
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
  });
  const job = {
    id: jobId,
    document_id: documentId,
    locked_by: "actual-worker",
    lease_token: token,
    lease_expected_generation_id: null,
    lease_write_generation_id: generationId,
    lease_authority_digest: bytesDigest(Buffer.from("issued authority")),
    attempt_count: 3,
    batch_id: batch,
  };
  const issued = captureIssuedAttemptControl(job);
  const inventory = {
    documentId,
    generationId,
    jobId,
    firstLeaseToken: token,
    authorityDigest: job.lease_authority_digest,
    predecessorGenerationId: null,
    sourceSha256: packet.registration.sourceSha256,
    sourceByteLength: originalBytes.length,
    sourceExpectationDigest: packet.registration.sourceExpectationSha256,
    sourceExpectation: packet.registration.sourceExpectation,
    registration: packet.registration,
    artifacts: packet.artifacts,
  };
  return { args, packet, job, issued, inventory };
}
describe("actual issued attempt-control prerequisite", () => {
  it("declares both required phases, retaining only the actual issued claim before unavailable accounting", async () => {
    const f = fixture();
    const packet = attachAttemptControlEvidence(f);
    const control = packet.declarations.groups.find((group) => group.family === "attempt_control")!;
    expect(control.declaration.population).toMatchObject({
      tag: "known",
      expectedUnits: [
        { family: "attempt_control", key: "claim_checkpoint" },
        { family: "attempt_control", key: "preseal_checkpoint" },
      ],
    });
    const units = packet.declarations.units.filter((unit) => unit.id.family === "attempt_control");
    expect(units.map((unit) => [unit.required, unit.representation, unit.sourceEvidenceIds])).toEqual([
      [true, "provenance_json", []],
      [true, "provenance_json", []],
    ]);
    const claim = packet.artifacts.find((artifact) => artifact.unitId.family === "attempt_control")!;
    expect(JSON.parse(Buffer.from(claim.bytesHex, "hex").toString("utf8"))).toMatchObject({
      phase: "claim",
      attemptNumber: 3,
      batchId: batch,
      workerId: "actual-worker",
      sourceExpectationDigest: f.inventory.sourceExpectationDigest,
    });
    expect(packet.artifacts.some((artifact) => artifact.unitId.key === "preseal_checkpoint")).toBe(false);
    expect(packet.outcomes.some((outcome) => outcome.unitId.key === "preseal_checkpoint")).toBe(false);
    const calls: string[] = [];
    await stageGenerationPrerequisite({
      packet,
      mutation: async (name) => {
        calls.push(name);
        return { ok: true, accounting: { result: "unavailable" } };
      },
    });
    expect(calls.indexOf("declare_ingestion_generation_evidence")).toBeLessThan(
      calls.indexOf("retain_ingestion_generation_artifacts"),
    );
    expect(calls).not.toContain("complete_ingestion_job");
  });
  it("replays original bytes after mutable heartbeat changes and preserves an issued null batch", () => {
    const f = fixture();
    const first = attachAttemptControlEvidence(f);
    const heartbeatJob = { ...f.job, locked_at: "later", heartbeat_at: "later", stage: "later" };
    const next = captureIssuedAttemptControl(heartbeatJob);
    expect(attachAttemptControlEvidence({ ...f, issued: next })).toEqual(first);
    const issued = captureIssuedAttemptControl({ ...f.job, batch_id: null });
    const claim = attachAttemptControlEvidence({ ...f, issued }).artifacts.find(
      (row) => row.unitId.family === "attempt_control",
    )!;
    expect(JSON.parse(Buffer.from(claim.bytesHex, "hex").toString("utf8")).batchId).toBeNull();
  });
  it("binds a known expectation from reconciled resume without changing its original witness", () => {
    const f = fixture(true);
    const resumed = resumeGenerationRetentionPacket(f.args, f.inventory);
    const packet = attachAttemptControlEvidence({ ...f, packet: resumed });
    const claim = packet.artifacts.find((row) => row.unitId.family === "attempt_control")!;
    expect(JSON.parse(Buffer.from(claim.bytesHex, "hex").toString("utf8")).sourceExpectationDigest).toBe(
      f.packet.registration.sourceExpectationSha256,
    );
    expect(packet.registration).toEqual(f.packet.registration);
  });
  it.each([
    "documentId",
    "generationId",
    "jobId",
    "firstLeaseToken",
    "authorityDigest",
    "predecessorGenerationId",
  ] as const)("rejects mismatched issued %s", (key) => {
    const f = fixture();
    const issued = { ...f.issued, [key]: key === "authorityDigest" ? bytesDigest(Buffer.from("foreign")) : token };
    if (key === "firstLeaseToken") issued.firstLeaseToken = jobId;
    expect(() => attachAttemptControlEvidence({ ...f, issued })).toThrow("attempt_control_claim_identity_mismatch");
  });
  it("rejects missing issued batch/attempt rather than defaulting them", () => {
    const f = fixture();
    for (const job of [{ ...f.job, attempt_count: 0 }, { ...f.job, batch_id: undefined } as never]) {
      const issued = captureIssuedAttemptControl(job);
      expect(() => attachAttemptControlEvidence({ ...f, issued })).toThrow();
    }
  });
  it("preserves an unmanaged nil batch snapshot but refuses it as managed control evidence", () => {
    const f = fixture();
    let visits = 0;
    const job = {
      ...f.job,
      batch_id: "00000000-0000-0000-0000-000000000000",
      unrelatedOptional: undefined,
      get documents(): never {
        visits += 1;
        throw new Error("unrelated data must not be visited");
      },
    };
    const issued = captureIssuedAttemptControl(job);
    expect(issued.batchId).toBe(job.batch_id);
    expect(Object.isFrozen(issued)).toBe(true);
    job.batch_id = batch;
    expect(issued.batchId).toBe("00000000-0000-0000-0000-000000000000");
    expect(visits).toBe(0);
    expect(() => attachAttemptControlEvidence({ ...f, issued })).toThrow();

    const worker = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
    const process = worker.slice(worker.indexOf("async function processJob(job: JobRow)"));
    const capture = process.indexOf("const issuedControlSnapshot = captureIssuedAttemptControl(job)");
    const heartbeat = process.indexOf("const heartbeat = setInterval(");
    const lifecycle = process.indexOf("try {");
    const inventory = process.indexOf('"read_ingestion_generation_inventory"');
    const savingPages = process.indexOf('stage: "saving pages"');
    const managed = process.indexOf("if (evidenceInventory.managed === true)", savingPages);
    const attachment = process.indexOf("attachAttemptControlEvidence({", managed);
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(lifecycle).toBeGreaterThanOrEqual(0);
    expect(savingPages).toBeGreaterThan(inventory);
    expect(managed).toBeGreaterThan(savingPages);
    expect(attachment).toBeGreaterThanOrEqual(0);
    expect(capture).toBeLessThan(heartbeat);
    expect(lifecycle).toBeLessThan(inventory);
    expect(inventory).toBeLessThan(managed);
    expect(managed).toBeLessThan(attachment);
    expect(process.slice(managed, attachment)).not.toContain("} else");
  });
  it("captures selected issued fields without visiting unrelated optional job data", () => {
    const f = fixture();
    let visits = 0;
    const job = {
      ...f.job,
      unrelatedOptional: undefined,
      get documents(): never {
        visits += 1;
        throw new Error("unrelated data must not be visited");
      },
    };
    expect(captureIssuedAttemptControl(job)).toEqual(f.issued);
    expect(visits).toBe(0);
  });
  it("rejects a truncated control plan, optional preseal or null representation", () => {
    const f = fixture();
    const packet = attachAttemptControlEvidence(f);
    const complete = {
      version: 1,
      groups: [...packet.registration.declarations.groups, ...packet.declarations.groups],
      units: [...packet.registration.declarations.units, ...packet.declarations.units],
    };
    for (const change of [
      (value: typeof complete) => {
        value.units = value.units.filter((unit) => unit.id.key !== "preseal_checkpoint");
      },
      (value: typeof complete) => {
        value.units.find((unit) => unit.id.key === "preseal_checkpoint")!.representation = null;
      },
      (value: typeof complete) => {
        value.units.find((unit) => unit.id.key === "preseal_checkpoint")!.required = false;
      },
    ]) {
      const copy = structuredClone(complete);
      change(copy);
      expect(() => parseGenerationDeclarations(copy)).toThrow();
    }
  });
  it("refuses every premature preseal artifact and outcome", () => {
    const f = fixture();
    const packet = attachAttemptControlEvidence(f);
    const claim = packet.artifacts.find((row) => row.unitId.family === "attempt_control")!;
    expect(() =>
      parseGenerationArtifact({ ...claim, unitId: { family: "attempt_control", key: "preseal_checkpoint" } }),
    ).toThrow("attempt_control_preseal_unavailable");
    for (const disposition of ["retained", "failed", "skipped", "excluded"] as const) {
      expect(() =>
        outcomeInputSchema.parse({
          unitId: { family: "attempt_control", key: "preseal_checkpoint" },
          groupKey: "control",
          disposition,
          artifactSha256: disposition === "retained" ? claim.sha256 : null,
          limitation:
            disposition === "retained"
              ? null
              : { code: "producer_unavailable", scope: "preseal", capability: "source_inventory" },
        }),
      ).toThrow();
    }
  });
  it("rejects rehashed foreign phase, qualifier and extra mutable fields", () => {
    const f = fixture();
    const claim = attachAttemptControlEvidence(f).artifacts.find((row) => row.unitId.family === "attempt_control")!;
    for (const change of [{ phase: "preseal" }, { qualification: "source_bytes_exact" }, { heartbeatAt: "later" }]) {
      const bytes = generationEvidenceBytes({
        ...JSON.parse(Buffer.from(claim.bytesHex, "hex").toString("utf8")),
        ...change,
      });
      expect(() =>
        parseGenerationArtifact({
          ...claim,
          bytesHex: bytes.toString("hex"),
          sha256: bytesDigest(bytes),
          byteLength: bytes.length,
        }),
      ).toThrow();
    }
  });
});
