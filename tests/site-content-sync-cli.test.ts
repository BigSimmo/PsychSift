import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSiteContentSyncPlanFromInputs,
  createSiteContentSyncWriteDriver,
  runSiteContentSyncCli,
} from "../scripts/sync-site-content-corpus";
import {
  createSiteContentGovernanceOwnerReceipt,
  createSiteContentMustPassOwnerReceipt,
} from "../src/lib/site-content/site-content-gate-owners";
import { parseRagProgrammeFixture } from "../src/lib/rag/rag-programme-eval";
import { siteContentSha256, type StaticSiteContentManifest } from "../src/lib/site-content/site-content-manifest";
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

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("site-content synchronization CLI contract", () => {
  it("consumes the P03 manifest and produces a real mixed disposition-bound plan", () => {
    const manifest: StaticSiteContentManifest = {
      version: "clinical-kb-site-static-manifest-v1",
      gitSha: "a".repeat(40),
      registryVersion: "site-content-registry-v1",
      generatedAt: "2026-08-24T00:00:00.000Z",
      staticManifestDigest: fixtureSha("1"),
      records: [
        ["medications:a", fixtureSha("2")],
        ["medications:b", fixtureSha("3")],
        ["medications:c", fixtureSha("4")],
      ].map(([logicalId, contentHash]) => ({
        logicalId: logicalId!,
        domain: "medications" as const,
        route: `/medications/${logicalId!.split(":")[1]}`,
        contentHash: contentHash!,
        lineageDigest: fixtureSha("5"),
        validationStatus: "locally_reviewed" as const,
        sourceStatus: "current" as const,
        eligible: true,
        exclusionReason: null,
      })),
    };
    const plan = buildSiteContentSyncPlanFromInputs({
      manifest,
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleaseCandidateId,
      previousReleaseId: siteReleasePreviousId,
      generationId: siteReleaseGenerationId,
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      activeProjections: [
        ["medications:a", fixtureSha("9")],
        ["medications:b", fixtureSha("3")],
        ["medications:removed", fixtureSha("8")],
      ].map(([logicalId, contentHash]) => ({
        logicalId: logicalId!,
        contentHash: contentHash as `sha256:${string}`,
        embedding: {
          model: "synthetic",
          dimensions: 3,
          contentHash: contentHash as `sha256:${string}`,
          digest: fixtureSha("6"),
        },
      })),
      legacyRows: [
        { rowId: "legacy-a", logicalId: "medications:a", contentHash: fixtureSha("2") },
        { rowId: "legacy-a-old", logicalId: "medications:a", contentHash: fixtureSha("9") },
      ],
      legacyDispositions: [{ logicalId: "medications:a", selectedRowId: "legacy-a", retiredRowIds: ["legacy-a-old"] }],
      batchSize: 25,
    });
    expect(plan.expectedCounts).toEqual({ desired: 3, changed: 2, unchanged: 1, tombstoned: 1 });
    expect(plan.legacyDispositions[0]).toMatchObject({ selectedRowId: "legacy-a", retiredRowIds: ["legacy-a-old"] });
  });

  it("keeps the guarded write driver inert unless explicitly enabled and sends the exact canonical plan", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const driver = createSiteContentSyncWriteDriver({ send });
    await expect(
      driver.execute({} as never, { allowWrite: false, expectedProjectRef: siteReleaseProjectRef }),
    ).rejects.toThrow(/write/i);
    expect(send).not.toHaveBeenCalled();
    const recovery = validSiteReleaseRecoveryFixture();
    await expect(
      driver.execute({ projectRef: siteReleaseProjectRef, recoveryEvidence: recovery.evidence } as never, {
        allowWrite: true,
        expectedProjectRef: siteReleaseProjectRef,
      }),
    ).rejects.toThrow(/canonical.*plan/i);

    const publication = {
      logicalId: "medication:a",
      domain: "medications" as const,
      publicationVersion: "2026-08-24T00:00:00.000Z",
      contentHash: fixtureSha("2"),
      sourceLineageDigest: fixtureSha("3"),
    };
    const writePlan = planSiteContentSync({
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleaseCandidateId,
      previousReleaseId: siteReleasePreviousId,
      generationId: siteReleaseGenerationId,
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: fixtureSha("4"),
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      desiredRecords: [publication],
      activeProjections: [],
      legacyRows: [],
      legacyDispositions: [],
      batchSize: 25,
      write: true,
      recoveryEvidence: recovery.evidence,
      now: new Date("2026-08-24T12:00:00.000Z"),
    });
    const writeSend = vi.fn(async () => ({ ok: true }));
    await createSiteContentSyncWriteDriver({
      send: writeSend,
      resolvePublication: (logicalId) => (logicalId === publication.logicalId ? publication : null),
    }).execute(writePlan, { allowWrite: true, expectedProjectRef: siteReleaseProjectRef });
    expect(writeSend).toHaveBeenNthCalledWith(1, {
      path: "/api/admin/site-content/publish",
      body: { action: "begin", plan: writePlan },
    });
    expect(writeSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "/api/admin/site-content/publish",
        body: expect.objectContaining({
          action: "publish",
          record: expect.objectContaining({ logicalId: publication.logicalId, planDigest: writePlan.planDigest }),
        }),
      }),
    );

    for (const action of ["adopt", "resume", "verify", "activate"] as const) {
      const actionSend = vi.fn(async (_request: { path: string; body: unknown }) => ({ ok: true }));
      await createSiteContentSyncWriteDriver({
        send: actionSend,
        resolvePublication: () => publication,
      }).execute(writePlan, {
        allowWrite: true,
        expectedProjectRef: siteReleaseProjectRef,
        action,
        records: [publication],
        governanceReceipt: { mac: "governance" },
        mustPassReceipt: { mac: "must-pass" },
        activation: recovery.activation,
        evidence: recovery.evidence,
      });
      expect(actionSend.mock.calls[0]?.[0]).toMatchObject({ body: { action: action === "resume" ? "begin" : action } });
    }
  });

  it("materializes the exact non-mutating write subject before fixed receipts and guarded first adoption", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(siteReleaseNow);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const directory = await mkdtemp(join(tmpdir(), "site-content-adoption-"));
    temporaryDirectories.push(directory);
    const publication = {
      logicalId: "medication:a",
      domain: "medications" as const,
      publicationVersion: "2026-08-24T00:00:00.000Z",
      contentHash: fixtureSha("2"),
      sourceLineageDigest: fixtureSha("3"),
    };
    const manifestRecords = [
      {
        logicalId: publication.logicalId,
        domain: publication.domain,
        route: "/medications/a",
        contentHash: publication.contentHash,
        lineageDigest: publication.sourceLineageDigest,
        validationStatus: "locally_reviewed" as const,
        sourceStatus: "current" as const,
        eligible: true,
        exclusionReason: null,
      },
    ];
    const manifest: StaticSiteContentManifest = {
      version: "clinical-kb-site-static-manifest-v1",
      gitSha: "a".repeat(40),
      registryVersion: "site-content-registry-v1",
      generatedAt: publication.publicationVersion,
      staticManifestDigest: siteContentSha256({
        version: "clinical-kb-site-static-manifest-v1",
        registryVersion: "site-content-registry-v1",
        records: manifestRecords,
      }),
      records: manifestRecords,
    };
    const recovery = validSiteReleaseRecoveryFixture();
    const state = {
      projectRef: siteReleaseProjectRef,
      expectedProjectRef: siteReleaseProjectRef,
      candidateReleaseId: siteReleaseCandidateId,
      previousReleaseId: siteReleasePreviousId,
      generationId: siteReleaseGenerationId,
      expectedEmbedding: { model: "synthetic", dimensions: 3 },
      activeProjections: [],
      legacyRows: [],
      legacyDispositions: [],
      batchSize: 25,
      recoveryEvidence: recovery.evidence,
      records: [publication],
    };
    const manifestPath = join(directory, "manifest.json");
    const statePath = join(directory, "state.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(statePath, JSON.stringify(state));

    const prospectivePlan = await runSiteContentSyncCli([
      "--manifest",
      manifestPath,
      "--state",
      statePath,
      "--plan-write",
    ]);
    expect(prospectivePlan.mode).toBe("write");

    const fixture = JSON.parse(
      await readFile(resolve(import.meta.dirname, "../scripts/fixtures/rag-programme-failures.v1.json"), "utf8"),
    );
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
    const governanceReceipt = createSiteContentGovernanceOwnerReceipt(prospectivePlan, manifest, {
      now: siteReleaseNow,
      secret: "governance-owner-secret-0000000002",
    });
    const mustPassReceipt = createSiteContentMustPassOwnerReceipt(prospectivePlan, fixture, run, run, {
      now: siteReleaseNow,
      secret: "rag-programme-owner-secret-00000003",
    });
    const planPath = join(directory, "write-plan.json");
    const governancePath = join(directory, "governance-receipt.json");
    const mustPassPath = join(directory, "must-pass-receipt.json");
    await Promise.all([
      writeFile(planPath, JSON.stringify(prospectivePlan)),
      writeFile(governancePath, JSON.stringify(governanceReceipt)),
      writeFile(mustPassPath, JSON.stringify(mustPassReceipt)),
    ]);
    const send = vi.fn(async () => ({ ok: true }));
    const adoptedPlan = await runSiteContentSyncCli(
      [
        "--manifest",
        manifestPath,
        "--state",
        statePath,
        "--canonical-plan",
        planPath,
        "--governance-receipt",
        governancePath,
        "--must-pass-receipt",
        mustPassPath,
        "--write",
        "--action",
        "adopt",
        "--confirm-project",
        siteReleaseProjectRef,
      ],
      { send },
    );
    expect(adoptedPlan).toEqual(prospectivePlan);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      path: "/api/admin/site-content/publish",
      body: {
        action: "adopt",
        plan: prospectivePlan,
        records: [publication],
        governanceReceipt,
        mustPassReceipt,
      },
    });
  });
});
