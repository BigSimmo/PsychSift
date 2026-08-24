import { describe, expect, it } from "vitest";

import { createSiteContentReleaseVerificationEvidence } from "../src/lib/site-content/site-content-release-evidence";
import {
  createSiteContentEvidenceValidationBinding,
  createSiteContentRecoveryValidationBinding,
  verifySiteContentRecoveryValidationBinding,
  type SiteContentRecoveryValidationPurpose,
} from "../src/lib/site-content/site-content-recovery-authority";
import { planSiteContentSync, type SiteContentSyncPlan } from "../src/lib/site-content/site-content-sync";
import { createSiteContentTransactionAuthority } from "../src/lib/site-content/site-content-transaction-reference";
import {
  fixtureSha,
  siteReleaseCandidateId,
  siteReleaseGenerationId,
  siteReleaseNow,
  siteReleasePreviousId,
  siteReleaseProjectRef,
  validSiteReleaseRecoveryFixture,
} from "./fixtures/site-release-recovery";

const secret = "synthetic-validation-secret-with-32-bytes";
const emptyAuthorityId = "00000000-0000-4000-8000-000000000000";
const recovery = validSiteReleaseRecoveryFixture();

const record = (logicalId: string, contentHash: `sha256:${string}`) => ({
  logicalId,
  domain: "medications" as const,
  recordKind: "medication",
  slug: logicalId.split(":")[1]!,
  payload: { logicalId, contentHash },
  governance: {},
  publicationVersion: "2026-08-24T00:00:00.000Z",
  contentHash,
  sourceLineageDigest: fixtureSha("a"),
});

function verification(plan: SiteContentSyncPlan) {
  const logicalIds = plan.operations
    .filter((operation) => operation.operation !== "tombstone")
    .map((operation) => operation.logicalId);
  return createSiteContentReleaseVerificationEvidence(plan, {
    publicVisibility: { observedLogicalIds: logicalIds, checkedAt: siteReleaseNow.toISOString() },
    governance: {
      reviewedLogicalIds: logicalIds,
      reviewEvidenceDigest: fixtureSha("b"),
      checkedAt: siteReleaseNow.toISOString(),
    },
    mustPass: {
      caseSetDigest: fixtureSha("c"),
      caseResults: [{ caseId: "site-content-release", outcome: "passed" }],
      checkedAt: siteReleaseNow.toISOString(),
    },
  });
}

function evidenceBinding(purpose: "adopt" | "begin" | "verify", payload: unknown) {
  return createSiteContentEvidenceValidationBinding(purpose, recovery.evidence, payload, {
    expectedProjectRef: siteReleaseProjectRef,
    now: siteReleaseNow,
    secret,
  });
}

function authority() {
  return createSiteContentTransactionAuthority({
    bindingVerifier: (purpose, payload, binding) =>
      verifySiteContentRecoveryValidationBinding(binding, {
        secret,
        expectedPurpose: purpose as SiteContentRecoveryValidationPurpose,
        expectedProjectRef: siteReleaseProjectRef,
        expectedRecoveryEvidenceDigest: recovery.evidence.digest,
        payload,
        now: siteReleaseNow,
      }),
  });
}

describe("offline site-content transaction authority", () => {
  it("uses real signer/verifier bindings to produce empty, current, updating, and atomically activated partitions", () => {
    const transaction = authority();
    expect(transaction.partition("medications")).toMatchObject({ state: "unavailable", records: [] });
    const oldA = record("medication:a", fixtureSha("1"));
    const stableB = record("medication:b", fixtureSha("2"));
    const adoptionPlan = planSiteContentSync({
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleasePreviousId,
      previousReleaseId: emptyAuthorityId,
      generationId: siteReleaseGenerationId,
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: fixtureSha("5"),
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      desiredRecords: [oldA, stableB],
      activeProjections: [],
      legacyRows: [],
      legacyDispositions: [],
      batchSize: 25,
      write: true,
      recoveryEvidence: recovery.evidence,
      now: siteReleaseNow,
    });
    const adoption = { plan: adoptionPlan, records: [oldA, stableB], verificationEvidence: verification(adoptionPlan) };
    transaction.adoptBaseline(adoption, evidenceBinding("adopt", adoption));
    expect(transaction.partition("medications")).toMatchObject({ state: "current" });

    const newA = record("medication:a", fixtureSha("3"));
    const addedC = record("medication:c", fixtureSha("4"));
    const plan = planSiteContentSync({
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleaseCandidateId,
      previousReleaseId: siteReleasePreviousId,
      generationId: siteReleaseGenerationId,
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: fixtureSha("5"),
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      desiredRecords: [newA, stableB, addedC],
      activeProjections: [oldA, stableB].map((entry) => ({
        logicalId: entry.logicalId,
        contentHash: entry.contentHash,
        embedding: { model: "synthetic", dimensions: 3, contentHash: entry.contentHash, digest: fixtureSha("6") },
      })),
      legacyRows: [],
      legacyDispositions: [],
      batchSize: 25,
      write: true,
      recoveryEvidence: recovery.evidence,
      now: siteReleaseNow,
    });
    transaction.beginCandidate(plan, evidenceBinding("begin", plan));
    transaction.publish(newA);
    transaction.publish(addedC);
    expect(transaction.partition("medications")).toMatchObject({
      state: "updating",
      records: [expect.objectContaining({ logicalId: "medication:b" })],
    });
    for (const operation of plan.operations) transaction.completeOperation(operation);
    const verificationPayload = { plan, verificationEvidence: verification(plan) };
    transaction.verifyCandidate(verificationPayload, evidenceBinding("verify", verificationPayload));
    const activation = validSiteReleaseRecoveryFixture({
      candidateReleaseDigest: plan.releaseDigest,
      previousReleaseDigest: adoptionPlan.releaseDigest,
      stateDigest: plan.dynamicStateDigest,
    }).activation;
    const activationPayload = { action: "activate" as const, evidence: recovery.evidence, activation };
    const activationBinding = createSiteContentRecoveryValidationBinding(
      {
        ...activationPayload,
        expected: {
          resource: activation.resource,
          previousResource: activation.previousResource,
          stateDigest: activation.stateDigest,
        },
      },
      { expectedProjectRef: siteReleaseProjectRef, now: siteReleaseNow, secret },
    );
    transaction.activate(plan.candidateReleaseId, activationPayload, activationBinding);
    expect(transaction.partition("medications")).toMatchObject({
      state: "current",
      records: [
        expect.objectContaining({ logicalId: "medication:a" }),
        expect.objectContaining({ logicalId: "medication:b" }),
        expect.objectContaining({ logicalId: "medication:c" }),
      ],
    });
  });

  it("rejects a binding signed with a disconnected secret", () => {
    const transaction = authority();
    const baseline = record("medication:a", fixtureSha("1"));
    const plan = planSiteContentSync({
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleasePreviousId,
      previousReleaseId: emptyAuthorityId,
      generationId: siteReleaseGenerationId,
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: fixtureSha("5"),
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      desiredRecords: [baseline],
      activeProjections: [],
      legacyRows: [],
      legacyDispositions: [],
      batchSize: 25,
      write: true,
      recoveryEvidence: recovery.evidence,
      now: siteReleaseNow,
    });
    const adoption = { plan, records: [baseline], verificationEvidence: verification(plan) };
    const forged = createSiteContentEvidenceValidationBinding("adopt", recovery.evidence, adoption, {
      expectedProjectRef: siteReleaseProjectRef,
      now: siteReleaseNow,
      secret: "different-synthetic-validation-secret-32-bytes",
    });
    expect(() => transaction.adoptBaseline(adoption, forged)).toThrow(/binding/i);
  });
});
