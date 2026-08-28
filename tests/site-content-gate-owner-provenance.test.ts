import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createSiteContentGovernanceOwnerReceipt,
  createSiteContentMustPassOwnerReceipt,
  SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST,
  SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST,
  verifySiteContentGateOwnerReceipt,
} from "../src/lib/site-content/site-content-gate-owners";
import { parseRagProgrammeFixture, ragProgrammeGatePolicy } from "../src/lib/rag/rag-programme-eval";
import { siteContentSha256 } from "../src/lib/site-content/site-content-manifest";
import {
  planSiteContentSync,
  siteContentSyncCanonicalJson,
  siteContentSyncDigest,
} from "../src/lib/site-content/site-content-sync";
import {
  fixtureSha,
  siteReleaseCandidateId,
  siteReleaseGenerationId,
  siteReleaseNow,
  siteReleasePreviousId,
  siteReleaseProjectRef,
  validSiteReleaseRecoveryFixture,
} from "./fixtures/site-release-recovery";

const root = resolve(import.meta.dirname, "..");
const secret = "synthetic-independent-gate-owner-secret";

function planAndManifest() {
  const manifest = {
    version: "clinical-kb-site-static-manifest-v1" as const,
    gitSha: "4".repeat(40),
    registryVersion: "site-content-registry-v1",
    generatedAt: "2026-08-24T11:50:00.000Z",
    records: [
      {
        logicalId: "medication:a",
        domain: "medications" as const,
        route: "/medications/a",
        contentHash: fixtureSha("2"),
        lineageDigest: fixtureSha("3"),
        validationStatus: "locally_reviewed" as const,
        sourceStatus: "current" as const,
        eligible: true,
        exclusionReason: null,
      },
    ],
    staticManifestDigest: "",
  };
  const digestPayload = {
    version: manifest.version,
    registryVersion: manifest.registryVersion,
    records: manifest.records,
  };
  manifest.staticManifestDigest = siteContentSha256(digestPayload);
  const recovery = validSiteReleaseRecoveryFixture();
  const publications = manifest.records.map((record) => ({
    logicalId: record.logicalId,
    domain: record.domain,
    kind: "medication",
    slug: "a",
    payload: { title: "Medication A", body: "Reviewed synthetic content." },
    governance: { sourceStatus: record.sourceStatus, validationStatus: record.validationStatus },
    publicationVersion: manifest.generatedAt,
    contentHash: record.contentHash,
    sourceLineageDigest: record.lineageDigest,
  }));
  const plan = planSiteContentSync({
    projectRef: siteReleaseProjectRef,
    expectedProjectRef: siteReleaseProjectRef,
    candidateReleaseId: siteReleaseCandidateId,
    previousReleaseId: siteReleasePreviousId,
    generationId: siteReleaseGenerationId,
    registryVersion: manifest.registryVersion,
    deploymentSha: manifest.gitSha,
    staticManifestDigest: manifest.staticManifestDigest as `sha256:${string}`,
    expectedEmbedding: { model: "synthetic", dimensions: 3 },
    desiredRecords: manifest.records.map((record) => ({
      logicalId: record.logicalId,
      domain: record.domain,
      publicationVersion: manifest.generatedAt,
      contentHash: record.contentHash,
      sourceLineageDigest: record.lineageDigest,
    })),
    activeProjections: [],
    legacyRows: [],
    legacyDispositions: [],
    batchSize: 25,
    write: true,
    recoveryEvidence: recovery.evidence,
    now: siteReleaseNow,
  });
  return { plan, manifest, publications };
}

describe("fixed site-content release gate owners", () => {
  it("derives deterministic governance and must-pass receipts from canonical owned outputs", () => {
    const { plan, manifest, publications } = planAndManifest();
    const fixture = JSON.parse(readFileSync(resolve(root, "scripts/fixtures/rag-programme-failures.v1.json"), "utf8"));
    const parsed = parseRagProgrammeFixture(fixture);
    const run = {
      caseSetFingerprint: parsed.caseSetFingerprint,
      populationFingerprint: parsed.population.populationFingerprint,
      cases: parsed.population.cases.map((entry) => ({
        ...entry,
        passed: true,
        falseInsufficiency: false,
        supportedPartRetained: true,
        documentReciprocalRank: entry.rankApplicability === "correct_negative" ? 0 : 1,
        contentReciprocalRank: entry.rankApplicability === "correct_negative" ? 0 : 1,
        hardViolations: [],
        failedExpectations: [],
        totalLatencyMs: 1,
        estimatedCostUsd: 0,
      })),
    };
    const governance = createSiteContentGovernanceOwnerReceipt(plan, manifest, {
      now: siteReleaseNow,
      secret,
      publications,
    });
    const mustPass = createSiteContentMustPassOwnerReceipt(plan, fixture, run, run, {
      now: siteReleaseNow,
      secret,
    });
    expect(verifySiteContentGateOwnerReceipt(governance, { secret, now: siteReleaseNow })).toBe(true);
    expect(verifySiteContentGateOwnerReceipt(mustPass, { secret, now: siteReleaseNow })).toBe(true);
    expect(governance.population).toEqual([{ logicalId: "medication:a", contentHash: fixtureSha("2") }]);
    expect(governance.projectionBindings).toEqual([
      expect.objectContaining({ logicalId: "medication:a", contentHash: fixtureSha("2") }),
    ]);
    expect(mustPass.evaluatedCaseIds).toHaveLength(29);
    expect(mustPass.gatePolicyDigest).toBe(SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST);
    expect(mustPass.gatePolicyDigest).toBe(siteContentSyncDigest(ragProgrammeGatePolicy));
    expect(mustPass.gateDecisionDigest).toBe(SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST);
    expect(JSON.stringify({ governance, mustPass })).not.toContain('"passed"');
    expect(
      verifySiteContentGateOwnerReceipt(
        { ...mustPass, candidateRunDigest: fixtureSha("f") },
        { secret, now: siteReleaseNow },
      ),
    ).toBe(false);
    expect(
      verifySiteContentGateOwnerReceipt(mustPass, {
        secret: "wrong-independent-gate-owner-secret",
        now: siteReleaseNow,
      }),
    ).toBe(false);
    const failedRun = {
      ...run,
      cases: run.cases.map((entry, index) =>
        index === 0 ? { ...entry, passed: false, failedExpectations: ["synthetic-failure"] } : entry,
      ),
    };
    expect(() =>
      createSiteContentMustPassOwnerReceipt(plan, fixture, run, failedRun, {
        now: siteReleaseNow,
        secret,
      }),
    ).toThrow(/did not pass/i);
    expect(() =>
      createSiteContentGovernanceOwnerReceipt(
        plan,
        {
          ...manifest,
          records: manifest.records.map((record) => ({ ...record, sourceStatus: "review_due" as const })),
        },
        { now: siteReleaseNow, secret, publications },
      ),
    ).toThrow();
    const changedProjection = createSiteContentGovernanceOwnerReceipt(plan, manifest, {
      now: siteReleaseNow,
      secret,
      publications: publications.map((publication) => ({
        ...publication,
        payload: { title: "Medication A", body: "Changed after governance review." },
      })),
    });
    expect(changedProjection.projectionBindings).not.toEqual(governance.projectionBindings);

    const changedPolicyDigest = siteContentSyncDigest({
      ...ragProgrammeGatePolicy,
      maximumP95LatencyMultiplier: ragProgrammeGatePolicy.maximumP95LatencyMultiplier + 0.01,
    });
    const { mac: _mac, ...changedPolicyReceipt } = { ...mustPass, gatePolicyDigest: changedPolicyDigest };
    const resigned = {
      ...changedPolicyReceipt,
      mac: createHmac("sha256", secret).update(siteContentSyncCanonicalJson(changedPolicyReceipt)).digest("hex"),
    };
    expect(verifySiteContentGateOwnerReceipt(resigned, { secret, now: siteReleaseNow })).toBe(false);
  });

  it("has no generic recorder and binds the real route to narrow derived SQL owners", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql"),
      "utf8",
    );
    expect(migration).not.toMatch(/record_site_content_release_gate_artifact/i);
    expect(migration).toMatch(/derive_site_content_release_gate_artifacts[\s\S]*site_content_release_projections/i);
    expect(migration).toMatch(
      /site_content_gate_owner_receipt_valid[\s\S]*extensions\.hmac[\s\S]*rag_programme_gate_owner_secret/i,
    );
    expect(migration).toContain(SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST);
    expect(migration).toContain(SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST);
    expect(migration).not.toMatch(
      /grant execute on function public\.derive_site_content_release_gate_artifacts[^;]*service_role/i,
    );
    const route = readFileSync(resolve(root, "src/app/api/admin/site-content/publish/route.ts"), "utf8");
    expect(route).toMatch(/derive_site_content_release_gate_artifacts[\s\S]*read_site_content_release_gate_artifacts/i);
    const ownerCli = readFileSync(resolve(root, "scripts/create-site-content-gate-owner-receipt.ts"), "utf8");
    expect(ownerCli).toMatch(/createSiteContentGovernanceOwnerReceipt[\s\S]*createSiteContentMustPassOwnerReceipt/i);
    expect(ownerCli).toMatch(/SITE_CONTENT_GOVERNANCE_GATE_OWNER_SECRET[\s\S]*RAG_PROGRAMME_GATE_OWNER_SECRET/i);
  });
});
