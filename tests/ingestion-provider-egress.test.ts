import { describe, expect, it, vi } from "vitest";
import {
  assertIngestionProviderEgress,
  createIngestionProviderEgressContext,
  createIngestionProviderEgressOperation,
  assertIngestionProviderEgressContextActive,
  denyIngestionProviderEgress,
  revokeIngestionProviderEgressContext,
  type IngestionProviderEgressRequest,
} from "../src/lib/ingestion-provider-egress";
import { ProviderEgressDeniedError, type ProviderEgressBinding } from "../src/lib/document-ingress-safety";

const binding: ProviderEgressBinding = {
  admissionEventId: "synthetic-admission",
  documentId: "synthetic-document",
  generationId: "synthetic-generation",
  jobId: "synthetic-job",
  attemptId: "synthetic-attempt",
  leaseId: "synthetic-lease",
  contentSha256: `sha256:${"a".repeat(64)}`,
  authorityDigest: `sha256:${"b".repeat(64)}`,
};
function clean(bound: ProviderEgressBinding, request: IngestionProviderEgressRequest) {
  return {
    binding: bound,
    policyVersion: "synthetic-v1",
    purpose: request.purpose,
    admission: "current",
    ownerScope: "permitted",
    rights: "permitted",
    purposeClearance: "permitted",
    scanner: { verdict: "clean", scannerVersion: "synthetic-scanner-v1", contentSha256: bound.contentSha256 },
    activeContent: "absent",
    identifiers: "absent",
    hiddenText: "consistent",
    encryption: "not_encrypted",
    source: "eligible",
    indexLicence: "permitted",
    sourcePolicy: "matched",
  };
}
function current(request: IngestionProviderEgressRequest) {
  return {
    sourceBinding: binding,
    sourceObservations: clean(binding, request),
    observations: clean({ ...binding, contentSha256: request.payloadSha256 }, request),
  };
}

describe("request-scoped ingestion provider egress", () => {
  it("freshly inspects a new operation after the previous operation's 30-second permit expires", async () => {
    let clock = 0;
    const loader = vi.fn(async (request: IngestionProviderEgressRequest) => current(request));
    const attempt = createIngestionProviderEgressContext({ binding, now: () => clock, loadCurrent: loader });
    const first = createIngestionProviderEgressOperation(attempt);
    await assertIngestionProviderEgress(first, "embedding", "first batch");
    clock = 30_000;
    const second = createIngestionProviderEgressOperation(attempt);
    await expect(assertIngestionProviderEgress(second, "embedding", "second batch")).resolves.toBeUndefined();
    expect(loader.mock.calls.map(([request]) => request.payload)).toEqual(["first batch", "second batch"]);
  });

  it("never renews an expired retry's permits and propagates that refusal to siblings and parent", async () => {
    let clock = 0;
    const attempt = createIngestionProviderEgressContext({
      binding,
      now: () => clock,
      loadCurrent: async (request) => current(request),
    });
    const operation = createIngestionProviderEgressOperation(attempt);
    const sibling = createIngestionProviderEgressOperation(attempt);
    await assertIngestionProviderEgress(operation, "embedding", "exact wire body");
    clock = 30_000;
    expect(createIngestionProviderEgressOperation(operation)).toBe(operation);
    const refusal = await assertIngestionProviderEgress(operation, "embedding", "exact wire body").catch(
      (error: unknown) => error,
    );
    expect(refusal).toMatchObject({ code: "provider_egress_permit_stale" });
    await expect(assertIngestionProviderEgress(sibling, "embedding", "different body")).rejects.toBe(refusal);
    expect(() => assertIngestionProviderEgressContextActive(attempt)).toThrow(refusal as Error);
    expect(() => createIngestionProviderEgressOperation(attempt)).toThrow(refusal as Error);
  });

  it.each(["contentSha256", "leaseId", "authorityDigest"] as const)(
    "refuses changed attempt %s before issuing a new operation's permits",
    async (key) => {
      let changed = false;
      const attempt = createIngestionProviderEgressContext({
        binding,
        loadCurrent: async (request) => ({
          ...current(request),
          sourceBinding: changed
            ? { ...binding, [key]: key === "leaseId" ? "replacement" : `sha256:${"c".repeat(64)}` }
            : binding,
        }),
      });
      await assertIngestionProviderEgress(createIngestionProviderEgressOperation(attempt), "embedding", "first");
      changed = true;
      await expect(
        assertIngestionProviderEgress(createIngestionProviderEgressOperation(attempt), "embedding", "second"),
      ).rejects.toMatchObject({ code: "provider_egress_binding_mismatch" });
    },
  );

  it.each(["policyVersion", "scannerVersion"] as const)(
    "preserves pinned source %s across otherwise valid new operations",
    async (field) => {
      let changed = false;
      const attempt = createIngestionProviderEgressContext({
        binding,
        loadCurrent: async (request) => {
          const loaded = current(request);
          if (changed) {
            if (field === "policyVersion") {
              loaded.sourceObservations.policyVersion = "replacement-v2";
              loaded.observations.policyVersion = "replacement-v2";
            } else loaded.sourceObservations.scanner.scannerVersion = "replacement-scanner-v2";
          }
          return loaded;
        },
      });
      await assertIngestionProviderEgress(createIngestionProviderEgressOperation(attempt), "embedding", "first");
      changed = true;
      await expect(
        assertIngestionProviderEgress(createIngestionProviderEgressOperation(attempt), "embedding", "second"),
      ).rejects.toMatchObject({ code: "provider_egress_policy_evidence_mismatch" });
    },
  );

  it.each(["parent", "operation"] as const)("shares %s revocation with all sibling operations", async (target) => {
    const attempt = createIngestionProviderEgressContext({ binding, loadCurrent: async (request) => current(request) });
    const first = createIngestionProviderEgressOperation(attempt);
    const sibling = createIngestionProviderEgressOperation(attempt);
    await assertIngestionProviderEgress(first, "embedding", "first");
    revokeIngestionProviderEgressContext(target === "parent" ? attempt : first);
    await expect(assertIngestionProviderEgress(sibling, "embedding", "second")).rejects.toMatchObject({
      code: "provider_egress_permit_revoked",
    });
    expect(() => createIngestionProviderEgressOperation(attempt)).toThrow("provider_egress_permit_revoked");
  });

  it("refuses an in-flight sibling after another operation records a terminal denial", async () => {
    let release!: () => void;
    const loader = vi.fn(
      (request: IngestionProviderEgressRequest) =>
        new Promise<ReturnType<typeof current>>((resolve) => {
          release = () => resolve(current(request));
        }),
    );
    const attempt = createIngestionProviderEgressContext({ binding, loadCurrent: loader });
    const waiting = createIngestionProviderEgressOperation(attempt);
    const refusing = createIngestionProviderEgressOperation(attempt);
    const pending = assertIngestionProviderEgress(waiting, "embedding", "waiting body");
    let refusal: unknown;
    try {
      denyIngestionProviderEgress(refusing, "provider_egress_denied");
    } catch (error) {
      refusal = error;
    }
    release();
    await expect(pending).rejects.toBe(refusal);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("rejects forged/deserialized contexts and preserves the existing denial error contract", async () => {
    await expect(assertIngestionProviderEgress({} as never, "summary", "synthetic")).rejects.toBeInstanceOf(
      ProviderEgressDeniedError,
    );
    await expect(assertIngestionProviderEgress({} as never, "summary", "synthetic")).rejects.toMatchObject({
      code: "provider_egress_permit_invalid",
    });
  });
  it("reloads and checks raw-source and exact-payload observations separately", async () => {
    const loader = vi.fn(async (request: IngestionProviderEgressRequest) => current(request));
    const context = createIngestionProviderEgressContext({ binding, loadCurrent: loader });
    await assertIngestionProviderEgress(context, "embedding", "synthetic");
    await assertIngestionProviderEgress(context, "embedding", "synthetic");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[0][0].payload).toBe("synthetic");
    expect(loader.mock.calls[0][0].payloadSha256).not.toBe(binding.contentSha256);
  });
  it.each(["sourceObservations", "observations"] as const)(
    "rejects unsafe %s with content-free remediation",
    async (field) => {
      const context = createIngestionProviderEgressContext({
        binding,
        loadCurrent: async (request) => {
          const loaded = current(request);
          loaded[field].identifiers = "detected";
          return loaded;
        },
      });
      await expect(assertIngestionProviderEgress(context, "caption", "synthetic-private-source")).rejects.toMatchObject(
        {
          name: "IngestionProviderEgressRefusal",
          code: "provider_egress_denied",
          codes: ["identifier_detected"],
          actions: ["remove_or_quarantine_unsafe_content"],
        },
      );
    },
  );
  it("fails closed without independently verified source observations", async () => {
    const context = createIngestionProviderEgressContext({
      binding,
      loadCurrent: async (request) => ({ ...current(request), sourceObservations: undefined }),
    });
    await expect(assertIngestionProviderEgress(context, "embedding", "synthetic")).rejects.toMatchObject({
      codes: expect.arrayContaining(["scanner_unavailable"]),
    });
  });
  it("denies a changed job/attempt/source authority binding", async () => {
    const context = createIngestionProviderEgressContext({
      binding,
      loadCurrent: async (request) => ({
        ...current(request),
        sourceBinding: { ...binding, attemptId: "replacement" },
      }),
    });
    await expect(assertIngestionProviderEgress(context, "embedding", "synthetic")).rejects.toMatchObject({
      code: "provider_egress_binding_mismatch",
    });
  });
  it("does not renew expired permits or adopt changed policy evidence", async () => {
    let clock = 0;
    const context = createIngestionProviderEgressContext({
      binding,
      now: () => clock,
      permitTtlMs: 10,
      loadCurrent: async (request) => current(request),
    });
    await assertIngestionProviderEgress(context, "summary", "synthetic");
    clock = 10;
    await expect(assertIngestionProviderEgress(context, "summary", "synthetic")).rejects.toMatchObject({
      code: "provider_egress_permit_stale",
    });
    let version = "synthetic-v1";
    const policyContext = createIngestionProviderEgressContext({
      binding,
      loadCurrent: async (request) => {
        const loaded = current(request);
        loaded.sourceObservations.policyVersion = version;
        return loaded;
      },
    });
    await assertIngestionProviderEgress(policyContext, "summary", "synthetic");
    version = "synthetic-v2";
    await expect(assertIngestionProviderEgress(policyContext, "summary", "new-payload")).rejects.toMatchObject({
      code: "provider_egress_policy_evidence_mismatch",
    });
  });
  it("copies mutable payload bytes and checks cancellation after awaiting the loader", async () => {
    const controller = new AbortController();
    const reason = new Error("synthetic-cancel");
    const bytes = new Uint8Array([1, 2, 3]);
    const context = createIngestionProviderEgressContext({
      binding,
      loadCurrent: async (request) => {
        (request.payload as Uint8Array)[0] = 99;
        controller.abort(reason);
        return current(request);
      },
    });
    await expect(assertIngestionProviderEgress(context, "embedding", bytes, controller.signal)).rejects.toBe(reason);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("pins raw-source policy and scanner evidence across different pipeline purposes", async () => {
    let version = "synthetic-v1";
    const context = createIngestionProviderEgressContext({
      binding,
      loadCurrent: async (request) => {
        const loaded = current(request);
        loaded.sourceObservations.policyVersion = version;
        loaded.observations.policyVersion = version;
        return loaded;
      },
    });
    await assertIngestionProviderEgress(context, "caption", "first-payload");
    await assertIngestionProviderEgress(context, "summary", "second-payload");
    version = "synthetic-v2";
    await expect(assertIngestionProviderEgress(context, "deep_memory", "third-payload")).rejects.toMatchObject({
      code: "provider_egress_policy_evidence_mismatch",
    });
  });
  it("revocation during a delayed load blocks an otherwise clean result", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const context = createIngestionProviderEgressContext({
      binding,
      loadCurrent: async (request) => {
        await wait;
        return current(request);
      },
    });
    const pending = assertIngestionProviderEgress(context, "embedding", "synthetic");
    revokeIngestionProviderEgressContext(context);
    release();
    await expect(pending).rejects.toMatchObject({ code: "provider_egress_permit_revoked" });
  });
});
