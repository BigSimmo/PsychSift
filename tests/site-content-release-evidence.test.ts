import { describe, expect, it } from "vitest";

import {
  assertSiteContentReleaseVerificationEvidence,
  createSiteContentReleaseVerificationEvidence,
} from "../src/lib/site-content/site-content-release-evidence";
import { createSiteContentEvidenceValidationBinding } from "../src/lib/site-content/site-content-recovery-authority";
import { planSiteContentSync } from "../src/lib/site-content/site-content-sync";
import {
  fixtureSha,
  siteReleaseCandidateId,
  siteReleaseGenerationId,
  siteReleaseNow,
  siteReleasePreviousId,
  siteReleaseProjectRef,
  validSiteReleaseRecoveryFixture,
} from "./fixtures/site-release-recovery";

function fixturePlan() {
  const recovery = validSiteReleaseRecoveryFixture();
  return planSiteContentSync({
    projectRef: siteReleaseProjectRef,
    expectedProjectRef: siteReleaseProjectRef,
    candidateReleaseId: siteReleaseCandidateId,
    previousReleaseId: siteReleasePreviousId,
    generationId: siteReleaseGenerationId,
    registryVersion: "site-content-registry-v1",
    staticManifestDigest: fixtureSha("1"),
    expectedEmbedding: { model: "synthetic", dimensions: 3 },
    desiredRecords: [
      {
        logicalId: "medication:a",
        domain: "medications",
        publicationVersion: "2026-08-24T00:00:00.000Z",
        contentHash: fixtureSha("2"),
        sourceLineageDigest: fixtureSha("3"),
      },
    ],
    activeProjections: [],
    legacyRows: [],
    legacyDispositions: [],
    batchSize: 25,
    write: true,
    recoveryEvidence: recovery.evidence,
    now: siteReleaseNow,
  });
}

describe("site-content release verification evidence", () => {
  it("derives exact independent artifact receipts from one canonical plan subject", () => {
    const plan = fixturePlan();
    const evidence = createSiteContentReleaseVerificationEvidence(plan, {
      publicVisibility: { observedLogicalIds: ["medication:a"], checkedAt: siteReleaseNow.toISOString() },
      governance: {
        reviewedLogicalIds: ["medication:a"],
        reviewEvidenceDigest: fixtureSha("4"),
        checkedAt: siteReleaseNow.toISOString(),
      },
      mustPass: {
        caseSetDigest: fixtureSha("5"),
        caseResults: [{ caseId: "site-content-a", outcome: "passed" }],
        checkedAt: siteReleaseNow.toISOString(),
      },
    });
    expect(assertSiteContentReleaseVerificationEvidence(evidence, plan)).toEqual(evidence);
    expect(new Set([evidence.publicVisibility.digest, evidence.governance.digest, evidence.mustPass.digest]).size).toBe(
      3,
    );
  });

  it("rejects omitted/additional subjects, self-attested failures, and any digest or plan identity mismatch", () => {
    const plan = fixturePlan();
    const valid = createSiteContentReleaseVerificationEvidence(plan, {
      publicVisibility: { observedLogicalIds: ["medication:a"], checkedAt: siteReleaseNow.toISOString() },
      governance: {
        reviewedLogicalIds: ["medication:a"],
        reviewEvidenceDigest: fixtureSha("4"),
        checkedAt: siteReleaseNow.toISOString(),
      },
      mustPass: {
        caseSetDigest: fixtureSha("5"),
        caseResults: [{ caseId: "site-content-a", outcome: "passed" }],
        checkedAt: siteReleaseNow.toISOString(),
      },
    });
    for (const mutation of [
      { ...valid, publicVisibility: { ...valid.publicVisibility, observedLogicalIds: [] } },
      { ...valid, governance: { ...valid.governance, reviewedLogicalIds: ["medication:a", "extra"] } },
      {
        ...valid,
        mustPass: { ...valid.mustPass, caseResults: [{ caseId: "site-content-a", outcome: "failed" }] },
      },
      { ...valid, subject: { ...valid.subject, releaseDigest: fixtureSha("9") } },
    ]) {
      expect(() => assertSiteContentReleaseVerificationEvidence(mutation, plan)).toThrow();
    }
  });

  it("allows the server signer to bind only independently verified canonical evidence", () => {
    const plan = fixturePlan();
    const recovery = validSiteReleaseRecoveryFixture();
    const evidence = createSiteContentReleaseVerificationEvidence(plan, {
      publicVisibility: { observedLogicalIds: ["medication:a"], checkedAt: siteReleaseNow.toISOString() },
      governance: {
        reviewedLogicalIds: ["medication:a"],
        reviewEvidenceDigest: fixtureSha("4"),
        checkedAt: siteReleaseNow.toISOString(),
      },
      mustPass: {
        caseSetDigest: fixtureSha("5"),
        caseResults: [{ caseId: "site-content-a", outcome: "passed" }],
        checkedAt: siteReleaseNow.toISOString(),
      },
    });
    const payload = { plan, verificationEvidence: evidence };
    expect(
      createSiteContentEvidenceValidationBinding("verify", recovery.evidence, payload, {
        expectedProjectRef: siteReleaseProjectRef,
        now: siteReleaseNow,
        secret: "synthetic-validation-secret-with-32-bytes",
      }),
    ).toMatchObject({ purpose: "verify", projectRef: siteReleaseProjectRef });
    expect(() =>
      createSiteContentEvidenceValidationBinding(
        "verify",
        recovery.evidence,
        {
          plan,
          verificationEvidence: {
            ...evidence,
            mustPass: { ...evidence.mustPass, caseResults: [{ caseId: "site-content-a", outcome: "failed" }] },
          },
        },
        {
          expectedProjectRef: siteReleaseProjectRef,
          now: siteReleaseNow,
          secret: "synthetic-validation-secret-with-32-bytes",
        },
      ),
    ).toThrow();
  });
});
