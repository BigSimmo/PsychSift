import { describe, expect, it, vi } from "vitest";
import { bytesDigest, generationEvidenceBytes } from "../src/lib/ingestion-generation-evidence";
import { createRegisteredPublishedAdminSourcePlanResolver } from "../src/lib/registered-published-admin-source-plan";

const requesterId = "00000000-0000-4000-8000-000000000001";
const documentId = "00000000-0000-4000-8000-000000000002";
const generationId = "00000000-0000-4000-8000-000000000003";
const approvalId = "00000000-0000-4000-8000-000000000004";
function reply() {
  // Independently declared synthetic original plan, not reconstructed from produced rows.
  const sourceSha256 = bytesDigest(Buffer.from("Synthetic original"));
  const units = Array.from({ length: 6 }, (_, i) => ({
    id: `unit-${i}`,
    required: true,
    dependencies: [],
    locator: `utf8-bytes:${i}:${i + 1}`,
    nativeMapping: "unavailable",
  }));
  const expectation = {
    version: 1,
    sourceSha256,
    tag: "known",
    units,
    witness: { reference: "independent synthetic witness", sha256: bytesDigest(Buffer.from("synthetic witness")) },
    limitation: null,
  };
  const layout = {
    sourceSha256,
    units: units.map((unit) => ({ sourceUnitId: unit.id, headingByteStart: null, headingByteEnd: null })),
  };
  const expectationBytes = generationEvidenceBytes(expectation),
    layoutBytes = generationEvidenceBytes(layout);
  return {
    version: "registered-published-admin-source-plan-v1",
    requesterId,
    documentId,
    generationId,
    publicationApprovalId: approvalId,
    sourceExpectation: expectation,
    sourceExpectationBytesHex: expectationBytes.toString("hex"),
    sourceSectionLayout: layout,
    sourceSectionLayoutBytesHex: layoutBytes.toString("hex"),
    registrationEvidence: {
      sourceSha256,
      sourceExpectationDigest: bytesDigest(expectationBytes),
      sourceSectionLayoutDigest: bytesDigest(layoutBytes),
      registrationDigest: bytesDigest(Buffer.from("synthetic registration")),
    },
  };
}
const input = { requesterId, documentId };
describe("registered published original plan resolver", () => {
  it("uses only the exact server RPC scope and returns a detached frozen independently registered plan", async () => {
    const data = reply(),
      rpc = vi.fn().mockResolvedValue({ data, error: null });
    const plan = await createRegisteredPublishedAdminSourcePlanResolver({ rpc })(input);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("resolve_registered_published_admin_source_plan", {
      p_requester_id: requesterId,
      p_document_id: documentId,
    });
    expect(plan).toMatchObject({ documentId, generationId, publicationApprovalId: approvalId });
    expect(Object.isFrozen(plan?.sourceSectionLayout.units)).toBe(true);
    expect(plan?.sourceExpectation).not.toBe(data.sourceExpectation);
  });
  it("returns null only for the genuine unsupported/missing-plan result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(createRegisteredPublishedAdminSourcePlanResolver({ rpc })(input)).resolves.toBeNull();
    rpc.mockResolvedValue({ data: null, error: { message: "revoked publication" } });
    await expect(createRegisteredPublishedAdminSourcePlanResolver({ rpc })(input)).rejects.toThrow(
      "source_plan_refused",
    );
  });
  it("refuses corrupt scope, original digest, layout bytes and output-derived extra fields", async () => {
    for (const mutate of [
      (data: ReturnType<typeof reply>) => {
        data.documentId = approvalId;
      },
      (data: ReturnType<typeof reply>) => {
        data.registrationEvidence.sourceSha256 = bytesDigest(Buffer.from("different source"));
      },
      (data: ReturnType<typeof reply>) => {
        data.sourceSectionLayoutBytesHex = Buffer.from("{}").toString("hex");
      },
      (data: ReturnType<typeof reply>) => {
        Object.assign(data.sourceSectionLayout, { producerRows: [] });
      },
    ]) {
      const data = reply();
      mutate(data);
      await expect(
        createRegisteredPublishedAdminSourcePlanResolver({ rpc: vi.fn().mockResolvedValue({ data, error: null }) })(
          input,
        ),
      ).rejects.toThrow();
    }
  });
  it("refuses missing/duplicate independent source units rather than substituting metadata", async () => {
    const data = reply();
    data.sourceSectionLayout.units[1] = data.sourceSectionLayout.units[0];
    data.sourceSectionLayoutBytesHex = generationEvidenceBytes(data.sourceSectionLayout).toString("hex");
    data.registrationEvidence.sourceSectionLayoutDigest = bytesDigest(
      Buffer.from(data.sourceSectionLayoutBytesHex, "hex"),
    );
    await expect(
      createRegisteredPublishedAdminSourcePlanResolver({ rpc: vi.fn().mockResolvedValue({ data, error: null }) })(
        input,
      ),
    ).rejects.toThrow();
  });
  it("does not dispatch pre-aborted requests and preserves in-flight abort reason with actual transport signal", async () => {
    const controller = new AbortController(),
      reason = new Error("request cancelled");
    controller.abort(reason);
    const rpc = vi.fn();
    await expect(
      createRegisteredPublishedAdminSourcePlanResolver({ rpc })({ ...input, signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(rpc).not.toHaveBeenCalled();
    const active = new AbortController();
    const abortSignal = vi.fn().mockImplementation((signal: AbortSignal) => {
      expect(signal).toBe(active.signal);
      active.abort(reason);
      return Promise.resolve({ data: reply(), error: null });
    });
    const read = Object.assign(Promise.resolve({ data: reply(), error: null }), { abortSignal });
    await expect(
      createRegisteredPublishedAdminSourcePlanResolver({ rpc: vi.fn().mockReturnValue(read) })({
        ...input,
        signal: active.signal,
      }),
    ).rejects.toBe(reason);
    expect(abortSignal).toHaveBeenCalledOnce();
  });
});
