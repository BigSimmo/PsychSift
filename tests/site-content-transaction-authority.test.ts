import { describe, expect, it } from "vitest";

import { planSiteContentSync } from "../src/lib/site-content/site-content-sync";
import { createSiteContentTransactionAuthority } from "../src/lib/site-content/site-content-transaction-reference";
import {
  fixtureSha,
  siteReleaseCandidateId,
  siteReleaseGenerationId,
  siteReleasePreviousId,
  siteReleaseProjectRef,
  validSiteReleaseRecoveryFixture,
} from "./fixtures/site-release-recovery";

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

describe("offline site-content transaction authority", () => {
  it("bootstraps empty authority, hides only pending A, then swaps the complete candidate atomically", () => {
    const recovery = validSiteReleaseRecoveryFixture();
    const authority = createSiteContentTransactionAuthority({ bindingVerifier: () => true });
    const oldA = record("medication:a", fixtureSha("1"));
    const stableB = record("medication:b", fixtureSha("2"));
    authority.adoptBaseline(
      {
        projectRef: siteReleaseProjectRef,
        releaseId: siteReleasePreviousId,
        releaseDigest: recovery.activation.previousResource.releaseDigest,
        recoveryEvidenceDigest: recovery.evidence.digest as `sha256:${string}`,
        records: [oldA, stableB],
      },
      "synthetic-binding",
    );
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
      now: new Date("2026-08-24T12:00:00.000Z"),
    });
    authority.beginCandidate(plan, "synthetic-binding");
    expect(() =>
      authority.beginCandidate({ ...plan, generationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, "synthetic-binding"),
    ).toThrow();
    expect(() => authority.activate(plan.candidateReleaseId, recovery.activation, "synthetic-binding")).toThrow(
      /population|activation/i,
    );
    expect(() => authority.beginCandidate(plan, "synthetic-binding")).not.toThrow();
    authority.publish(newA);
    authority.publish(addedC);
    expect(authority.read("medications").map((entry) => entry.logicalId)).toEqual(["medication:b"]);
    expect(() => authority.publish({ ...addedC, logicalId: "medication:swapped" })).toThrow(/declared|identity/i);
    for (const operation of plan.operations) authority.completeOperation(operation, "synthetic-binding");
    authority.verifyCandidate(plan.candidateReleaseId, recovery.evidence.digest, "synthetic-binding");
    expect(authority.read("medications").map((entry) => entry.logicalId)).toEqual(["medication:b"]);
    const activation = validSiteReleaseRecoveryFixture({
      candidateReleaseDigest: plan.releaseDigest,
      stateDigest: plan.dynamicStateDigest,
    }).activation;
    authority.activate(plan.candidateReleaseId, activation, "synthetic-binding");
    expect(authority.read("medications").map((entry) => entry.logicalId)).toEqual([
      "medication:a",
      "medication:b",
      "medication:c",
    ]);
  });

  it("rejects missing, duplicate, additional, hash-swapped, generation, target, and resume mismatches", () => {
    const authority = createSiteContentTransactionAuthority({ bindingVerifier: () => false });
    expect(() =>
      authority.adoptBaseline(
        {
          projectRef: siteReleaseProjectRef,
          releaseId: siteReleasePreviousId,
          releaseDigest: fixtureSha("1"),
          recoveryEvidenceDigest: fixtureSha("2"),
          records: [],
        },
        "forged",
      ),
    ).toThrow(/binding/i);
  });
});
