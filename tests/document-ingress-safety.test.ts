import { describe, expect, it, vi } from "vitest";
import {
  ProviderEgressDeniedError,
  createDocumentIngressSafetyAuthority,
  evaluateDocumentIngressSafety,
  type DocumentIngressSafetyObservations,
  type IngressHardGateCode,
  type ProviderEgressBinding,
  type ProviderEgressPermit,
  type ProviderEgressPurpose,
} from "../src/lib/document-ingress-safety";

const contentSha256 = `sha256:${"a".repeat(64)}` as const;
const authorityDigest = `sha256:${"c".repeat(64)}` as const;

function binding(overrides: Partial<ProviderEgressBinding> = {}): ProviderEgressBinding {
  return {
    admissionEventId: "admission-1",
    documentId: "document-1",
    generationId: "generation-1",
    jobId: "job-1",
    attemptId: "attempt-1",
    leaseId: "lease-1",
    contentSha256,
    authorityDigest,
    ...overrides,
  };
}

function cleanObservations(
  purpose: ProviderEgressPurpose = "caption",
  overrides: Partial<DocumentIngressSafetyObservations> = {},
): DocumentIngressSafetyObservations {
  return {
    binding: binding(),
    policyVersion: "ingress-policy-1",
    purpose,
    admission: "current",
    ownerScope: "permitted",
    rights: "permitted",
    purposeClearance: "permitted",
    scanner: { verdict: "clean", scannerVersion: "scanner-1", contentSha256 },
    activeContent: "absent",
    identifiers: "absent",
    hiddenText: "consistent",
    encryption: "not_encrypted",
    source: "eligible",
    indexLicence: "permitted",
    sourcePolicy: "matched",
    ...overrides,
  };
}

function quarantineCodes(input: unknown): readonly IngressHardGateCode[] {
  const result = evaluateDocumentIngressSafety(input);
  expect(result.verdict).toBe("quarantine");
  if (result.verdict !== "quarantine") throw new Error("expected quarantine");
  return result.codes;
}

function expectDenial(run: () => void, code: ProviderEgressDeniedError["code"]): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderEgressDeniedError);
    expect((error as ProviderEgressDeniedError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

function policyEvidence(result: ReturnType<typeof evaluateDocumentIngressSafety>) {
  return { policyVersion: result.policyVersion, evidenceDigest: result.evidenceDigest };
}

describe("document ingress safety decision", () => {
  it.each(["caption", "embedding", "summary", "deep_memory"] as const)(
    "passes complete trusted observations for the %s purpose",
    (purpose) => {
      const authority = createDocumentIngressSafetyAuthority({ permitTtlMs: 1_000 });
      const result = authority.evaluate(cleanObservations(purpose));

      expect(result).toMatchObject({
        verdict: "pass",
        binding: binding(),
        purpose,
        policyVersion: "ingress-policy-1",
      });
      expect(result.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(Object.isFrozen(result)).toBe(true);
      const permit = authority.issuePermit(result, binding(), purpose);
      expect(() => authority.assertPermit(permit, binding(), purpose, policyEvidence(result))).not.toThrow();
    },
  );

  it("returns an actionable missing-admission refusal before any provider call", () => {
    const authority = createDocumentIngressSafetyAuthority({ permitTtlMs: 1_000 });
    const provider = vi.fn();
    const result = authority.evaluate(
      cleanObservations("embedding", {
        binding: binding({ admissionEventId: "" }),
        admission: "missing",
      }),
    );

    expect(result).toMatchObject({
      verdict: "quarantine",
      reasons: expect.arrayContaining([{ code: "admission_missing", action: "obtain_current_admission" }]),
    });
    expectDenial(() => {
      const permit = authority.issuePermit(result, binding(), "embedding");
      authority.assertPermit(permit, binding(), "embedding", policyEvidence(result));
      provider();
    }, "provider_egress_denied");
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    [{ scanner: { verdict: "unavailable", scannerVersion: "scanner-1", contentSha256 } }, "scanner_unavailable"],
    [{ scanner: { verdict: "malware", scannerVersion: "scanner-1", contentSha256 } }, "malware_detected"],
    [{ activeContent: "detected" }, "active_content_detected"],
    [{ identifiers: "detected" }, "identifier_detected"],
    [{ hiddenText: "conflict" }, "hidden_text_conflict"],
    [{ encryption: "unsupported" }, "unsupported_encrypted_document"],
    [{ source: "excluded" }, "excluded_source"],
    [{ source: "link_only" }, "link_only_content"],
    [{ indexLicence: "not_permitted" }, "index_licence_not_permitted"],
    [{ sourcePolicy: "mismatch" }, "source_policy_mismatch"],
    [{ rights: "denied" }, "index_licence_not_permitted"],
    [{ ownerScope: "denied" }, "source_policy_mismatch"],
    [{ purposeClearance: "denied" }, "source_policy_mismatch"],
  ] as const)("quarantines unsafe observation %j as %s", (overrides, code) => {
    expect(quarantineCodes(cleanObservations("caption", overrides))).toContain(code);
  });

  it("fails closed when observations are missing, unknown, or bound to a different content hash", () => {
    const missing = { ...cleanObservations(), hiddenText: undefined };
    const unknown = { ...cleanObservations(), activeContent: "unknown" };
    const wrongScanHash = {
      ...cleanObservations(),
      scanner: {
        verdict: "clean",
        scannerVersion: "scanner-1",
        contentSha256: `sha256:${"b".repeat(64)}`,
      },
    };

    expect(quarantineCodes(missing)).toContain("safety_observation_invalid");
    expect(quarantineCodes(unknown)).toContain("safety_observation_invalid");
    expect(quarantineCodes(wrongScanHash)).toContain("scanner_unavailable");
  });

  it("does not pass a malformed document/generation/attempt/content binding", () => {
    const malformed = {
      ...cleanObservations(),
      binding: {
        ...binding(),
        generationId: "",
        leaseId: "",
        contentSha256: "sha256:not-a-digest",
      },
    };

    expect(quarantineCodes(malformed)).toContain("binding_invalid");
  });

  it("does not let caller-supplied raw text substitute for missing safety evidence", () => {
    const input = {
      ...cleanObservations(),
      scanner: undefined,
      documentText: "caller says this document is safe",
    };

    expect(quarantineCodes(input)).toContain("scanner_unavailable");
  });

  it("binds the evidence digest to content, execution attempt, authority, policy, purpose, and observations", () => {
    const baseline = evaluateDocumentIngressSafety(cleanObservations());
    const changes = [
      cleanObservations("embedding"),
      cleanObservations("caption", { policyVersion: "ingress-policy-2" }),
      cleanObservations("caption", { binding: binding({ generationId: "generation-2" }) }),
      cleanObservations("caption", { binding: binding({ attemptId: "attempt-2" }) }),
      cleanObservations("caption", {
        binding: binding({ authorityDigest: `sha256:${"d".repeat(64)}` }),
      }),
      cleanObservations("caption", { hiddenText: "not_applicable" }),
    ];

    for (const changed of changes) {
      expect(evaluateDocumentIngressSafety(changed).evidenceDigest).not.toBe(baseline.evidenceDigest);
    }
  });
});

describe("opaque provider-egress permits", () => {
  it("authorizes only the evaluated binding and purpose", () => {
    const authority = createDocumentIngressSafetyAuthority({ permitTtlMs: 1_000 });
    const result = authority.evaluate(cleanObservations("summary"));
    const permit = authority.issuePermit(result, binding(), "summary");

    expect(Object.isFrozen(permit)).toBe(true);
    expect(JSON.stringify(permit)).toBe("{}");
    expect(() => authority.assertPermit(permit, binding(), "summary", policyEvidence(result))).not.toThrow();
    expectDenial(
      () => authority.assertPermit(permit, binding({ documentId: "document-2" }), "summary", policyEvidence(result)),
      "provider_egress_binding_mismatch",
    );
    expectDenial(
      () => authority.assertPermit(permit, binding(), "caption", policyEvidence(result)),
      "provider_egress_purpose_mismatch",
    );
    expectDenial(
      () =>
        authority.assertPermit(permit, binding(), "summary", {
          policyVersion: "ingress-policy-2",
          evidenceDigest: result.evidenceDigest,
        }),
      "provider_egress_policy_evidence_mismatch",
    );
  });

  it("rejects forged, serialized, cross-authority, and forged-result authority", () => {
    const first = createDocumentIngressSafetyAuthority({ permitTtlMs: 1_000 });
    const second = createDocumentIngressSafetyAuthority({ permitTtlMs: 1_000 });
    const result = first.evaluate(cleanObservations());
    const permit = first.issuePermit(result, binding(), "caption");
    const forgedPermit = {} as ProviderEgressPermit;
    const serializedPermit = JSON.parse(JSON.stringify(permit)) as ProviderEgressPermit;
    const forgedResult = { ...result };

    expectDenial(
      () => first.assertPermit(forgedPermit, binding(), "caption", policyEvidence(result)),
      "provider_egress_permit_invalid",
    );
    expectDenial(
      () => first.assertPermit(serializedPermit, binding(), "caption", policyEvidence(result)),
      "provider_egress_permit_invalid",
    );
    expectDenial(
      () => second.assertPermit(permit, binding(), "caption", policyEvidence(result)),
      "provider_egress_permit_invalid",
    );
    expectDenial(() => first.issuePermit(forgedResult, binding(), "caption"), "untrusted_safety_result");
  });

  it("rejects cross-admission, stale-attempt/lease/generation, changed-content/authority, and wrong purpose", () => {
    const authority = createDocumentIngressSafetyAuthority({ permitTtlMs: 1_000 });
    const result = authority.evaluate(cleanObservations());
    const permit = authority.issuePermit(result, binding(), "caption");

    for (const changedBinding of [
      binding({ admissionEventId: "admission-2" }),
      binding({ generationId: "generation-2" }),
      binding({ jobId: "job-2" }),
      binding({ attemptId: "attempt-2" }),
      binding({ leaseId: "lease-2" }),
      binding({ contentSha256: `sha256:${"b".repeat(64)}` }),
      binding({ authorityDigest: `sha256:${"d".repeat(64)}` }),
    ]) {
      expectDenial(
        () => authority.assertPermit(permit, changedBinding, "caption", policyEvidence(result)),
        "provider_egress_binding_mismatch",
      );
    }
    expectDenial(() => authority.issuePermit(result, binding(), "embedding"), "provider_egress_purpose_mismatch");
  });

  it("rejects revoked and expired permits before a provider spy runs", () => {
    let currentTime = 100;
    const authority = createDocumentIngressSafetyAuthority({ permitTtlMs: 10, now: () => currentTime });
    const provider = vi.fn();
    const result = authority.evaluate(cleanObservations());
    const revoked = authority.issuePermit(result, binding(), "caption");
    authority.revokePermit(revoked);

    expectDenial(() => {
      authority.assertPermit(revoked, binding(), "caption", policyEvidence(result));
      provider();
    }, "provider_egress_permit_revoked");

    const expired = authority.issuePermit(result, binding(), "caption");
    currentTime = 110;
    expectDenial(() => {
      authority.assertPermit(expired, binding(), "caption", policyEvidence(result));
      provider();
    }, "provider_egress_permit_stale");
    expect(provider).not.toHaveBeenCalled();
  });

  it("copies and freezes authority data so post-issuance input mutation cannot widen a permit", () => {
    const authority = createDocumentIngressSafetyAuthority({ permitTtlMs: 1_000 });
    const input = cleanObservations() as DocumentIngressSafetyObservations & {
      binding: ProviderEgressBinding & { documentId: string };
    };
    const result = authority.evaluate(input);
    const permit = authority.issuePermit(result, binding(), "caption");

    (input.binding as { documentId: string }).documentId = "document-2";
    expect(result.binding?.documentId).toBe("document-1");
    expect(() => authority.assertPermit(permit, binding(), "caption", policyEvidence(result))).not.toThrow();
    expectDenial(
      () => authority.assertPermit(permit, binding({ documentId: "document-2" }), "caption", policyEvidence(result)),
      "provider_egress_binding_mismatch",
    );
  });
});
