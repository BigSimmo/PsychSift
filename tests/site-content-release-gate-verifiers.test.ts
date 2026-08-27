import { describe, expect, it } from "vitest";

import {
  SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST,
  SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST,
} from "../src/lib/site-content/site-content-gate-owners";
import {
  SITE_CONTENT_MUST_PASS_CASE_IDS,
  SITE_CONTENT_MUST_PASS_CASE_SET_FINGERPRINT,
  SITE_CONTENT_GATE_RECEIPT_MAX_AGE_MS,
  verifySiteContentReleaseGateArtifacts,
} from "../src/lib/site-content/site-content-release-evidence";
import { planSiteContentSync, siteContentSyncDigest } from "../src/lib/site-content/site-content-sync";
import {
  fixtureSha,
  siteReleaseCandidateId,
  siteReleaseGenerationId,
  siteReleaseNow,
  siteReleasePreviousId,
  siteReleaseProjectRef,
  validSiteReleaseRecoveryFixture,
} from "./fixtures/site-release-recovery";

function plan() {
  const recovery = validSiteReleaseRecoveryFixture();
  return planSiteContentSync({
    projectRef: siteReleaseProjectRef,
    expectedProjectRef: siteReleaseProjectRef,
    candidateReleaseId: siteReleaseCandidateId,
    previousReleaseId: siteReleasePreviousId,
    generationId: siteReleaseGenerationId,
    registryVersion: "site-content-registry-v1",
    deploymentSha: "4".repeat(40),
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

function receipt<T extends object>(value: T) {
  return { ...value, digest: siteContentSyncDigest(value) };
}

function artifacts(syncPlan = plan()) {
  const observedAt = "2026-08-24T11:59:00.000Z";
  const subject = {
    projectRef: syncPlan.projectRef,
    releaseId: syncPlan.candidateReleaseId,
    planDigest: syncPlan.planDigest,
    releaseDigest: syncPlan.releaseDigest,
  };
  const subjectDigest = siteContentSyncDigest(subject);
  const population = syncPlan.operations
    .filter((operation) => operation.operation !== "tombstone")
    .map(({ logicalId, contentHash }) => ({ logicalId, contentHash }));
  return {
    version: "site-content-release-gate-artifacts-v1" as const,
    subject,
    subjectDigest,
    publicVisibility: receipt({
      owner: "public-site-content-reader-v1" as const,
      subjectDigest,
      observedAt,
      population,
      populationDigest: siteContentSyncDigest(population),
    }),
    governance: receipt({
      owner: "site-content-governance-registry-v1" as const,
      subjectDigest,
      observedAt,
      population,
      registryVersion: syncPlan.registryVersion,
      staticManifestDigest: syncPlan.staticManifestDigest,
      sourceStatus: "current" as const,
      validationStatus: "locally_reviewed" as const,
    }),
    mustPass: receipt({
      owner: "rag-programme-eval-v1" as const,
      subjectDigest,
      observedAt,
      caseSetFingerprint: SITE_CONTENT_MUST_PASS_CASE_SET_FINGERPRINT,
      evaluatedCaseIds: [...SITE_CONTENT_MUST_PASS_CASE_IDS],
      failedCaseIds: [],
      runDigest: fixtureSha("4"),
      gatePolicyDigest: SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST,
      gateDecisionDigest: SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST,
    }),
  };
}

describe("production site-content release gate verifiers", () => {
  it("derives signed evidence only from exact fresh fixed-owner system artifacts", () => {
    const syncPlan = plan();
    const evidence = verifySiteContentReleaseGateArtifacts(syncPlan, artifacts(syncPlan), { now: siteReleaseNow });
    expect(evidence.subject.planDigest).toBe(syncPlan.planDigest);
    expect(evidence.publicVisibility.owner).toBe("public-site-content-reader-v1");
    expect(evidence.governance.owner).toBe("site-content-governance-registry-v1");
    expect(evidence.mustPass.owner).toBe("rag-programme-eval-v1");
  });

  it("rejects arbitrary owners/digests/results and stale or future outputs", () => {
    const syncPlan = plan();
    const valid = artifacts(syncPlan);
    const mutations = [
      { ...valid, publicVisibility: receipt({ ...valid.publicVisibility, digest: undefined, owner: "administrator" }) },
      { ...valid, governance: { ...valid.governance, staticManifestDigest: fixtureSha("9") } },
      {
        ...valid,
        mustPass: receipt({
          ...valid.mustPass,
          digest: undefined,
          failedCaseIds: [SITE_CONTENT_MUST_PASS_CASE_IDS[0]!],
        }),
      },
      { ...valid, mustPass: receipt({ ...valid.mustPass, digest: undefined, caseSetFingerprint: fixtureSha("8") }) },
      { ...valid, mustPass: receipt({ ...valid.mustPass, digest: undefined, gatePolicyDigest: fixtureSha("8") }) },
      { ...valid, mustPass: receipt({ ...valid.mustPass, digest: undefined, gateDecisionDigest: fixtureSha("8") }) },
      {
        ...valid,
        publicVisibility: receipt({
          ...valid.publicVisibility,
          digest: undefined,
          observedAt: "2026-08-24T11:40:00.000Z",
        }),
      },
      {
        ...valid,
        publicVisibility: receipt({
          ...valid.publicVisibility,
          digest: undefined,
          observedAt: "2026-08-24T12:01:00.000Z",
        }),
      },
      {
        ...valid,
        publicVisibility: receipt({
          ...valid.publicVisibility,
          digest: undefined,
          observedAt: "2026-08-24 11:59:00Z",
        }),
      },
    ];
    for (const mutation of mutations) {
      expect(() => verifySiteContentReleaseGateArtifacts(syncPlan, mutation, { now: siteReleaseNow })).toThrow();
    }
  });

  it("accepts the exact inclusive stale edge and rejects one millisecond beyond either boundary", () => {
    const syncPlan = plan();
    const boundary = siteReleaseNow.getTime() - SITE_CONTENT_GATE_RECEIPT_MAX_AGE_MS;
    const withOwnerTime = (observedAt: string) => {
      const valid = artifacts(syncPlan);
      return {
        ...valid,
        governance: receipt({ ...valid.governance, digest: undefined, observedAt }),
        mustPass: receipt({ ...valid.mustPass, digest: undefined, observedAt }),
      };
    };
    expect(() =>
      verifySiteContentReleaseGateArtifacts(syncPlan, withOwnerTime(new Date(boundary).toISOString()), {
        now: siteReleaseNow,
      }),
    ).not.toThrow();
    expect(() =>
      verifySiteContentReleaseGateArtifacts(syncPlan, withOwnerTime(new Date(boundary - 1).toISOString()), {
        now: siteReleaseNow,
      }),
    ).toThrow(/stale/i);
    expect(() =>
      verifySiteContentReleaseGateArtifacts(
        syncPlan,
        withOwnerTime(new Date(siteReleaseNow.getTime() + 1).toISOString()),
        { now: siteReleaseNow },
      ),
    ).toThrow(/future/i);
  });
});
