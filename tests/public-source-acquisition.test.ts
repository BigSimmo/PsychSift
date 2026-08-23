import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { australianSourceByKey } from "@/lib/australian-source-catalogue";
import {
  australianSourcePolicyDigest,
  buildPublicSourceActivationManifest,
} from "@/lib/public-source-activation-manifest";
import {
  acquirePublicSourceVersion,
  checkPublicSourceChange,
  evaluateTrustedPageContent,
  planAcquisition,
  validateAcquisitionUrl,
  validateRedirect,
  type PublicSourceAcquisitionPlan,
  type PublicSourceStagingCandidate,
} from "@/lib/public-source-acquisition";
import { runCheckPublicSourceChangesCli } from "../scripts/check-public-source-changes";
import { runFetchApprovedPublicSourceVersionsCli } from "../scripts/fetch-approved-public-source-versions";
import {
  publicSourceAcquisitionManifestDigest,
  runPlanPublicSourceAcquisitionCli,
} from "../scripts/plan-public-source-acquisition";

const ownerId = "11111111-1111-4111-8111-111111111111";
const operatorId = "22222222-2222-4222-8222-222222222222";
const exactUrl = "https://www.health.wa.gov.au/guidelines/synthetic-guideline.pdf";
const publicAddress = [{ address: "8.8.8.8", family: 4 as const }];
const cliWorkdir = mkdtempSync(join(tmpdir(), "public-source-cli-"));

afterAll(() => rmSync(cliWorkdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

function activationManifest() {
  return buildPublicSourceActivationManifest({
    catalogueKey: "wa-health",
    decision: "activate",
    operatorId,
    reason: "Approved source definition for bounded exact-version acquisition.",
    evidenceReferences: ["source-review:wa-health:2026-08-20"],
  });
}

function activeDefinition() {
  const definition = australianSourceByKey("wa-health");
  if (!definition) throw new Error("wa-health fixture is missing");
  return definition;
}

async function validPlan(overrides: Record<string, unknown> = {}) {
  return planAcquisition({
    catalogueKey: "wa-health",
    url: exactUrl,
    exactVersion: "2026-08-20",
    exactDocumentLicence: "public_index_permitted",
    licenceEvidenceDigest: `sha256:${"a".repeat(64)}`,
    stagingOwnerId: ownerId,
    activationManifest: activationManifest(),
    ...overrides,
  });
}

function syntheticPdf() {
  return new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n");
}

function response(body: Uint8Array | string, init: ResponseInit = {}) {
  return new Response(body instanceof Uint8Array ? (body.slice().buffer as ArrayBuffer) : body, {
    status: 200,
    headers: { "content-type": "application/pdf", ...init.headers },
    ...init,
  });
}

function connectedResponse(value: Response, remoteAddress = publicAddress[0]!.address) {
  return { response: value, remoteAddress };
}

describe("public source acquisition", () => {
  it("rejects excluded and link-only sources before network access", async () => {
    const fetch = vi.fn();
    await expect(
      planAcquisition({ catalogueKey: "etg-complete", url: "https://www.tg.org.au/", fetch }),
    ).rejects.toThrow(/link-only/i);
    await expect(
      planAcquisition({ catalogueKey: "healthdirect", url: "https://www.healthdirect.gov.au/", fetch }),
    ).rejects.toThrow(/not in the active catalogue/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects redirects off the exact allowlisted host and private network targets", async () => {
    await expect(validateAcquisitionUrl("http://127.0.0.1/internal", activeDefinition())).rejects.toThrow(
      /https|private/i,
    );
    await expect(validateRedirect("https://evil.example/file.pdf", activeDefinition())).rejects.toThrow(/allowlisted/i);
    await expect(
      validateAcquisitionUrl(exactUrl, activeDefinition(), async () => [{ address: "10.0.0.8", family: 4 }] as const),
    ).rejects.toThrow(/private/i);
    await expect(
      validateAcquisitionUrl(exactUrl, activeDefinition(), async () => [{ address: "::ffff:127.0.0.1", family: 6 }]),
    ).rejects.toThrow(/private/i);
    for (const address of [
      { address: "240.0.0.1", family: 4 as const },
      { address: "192.0.2.1", family: 4 as const },
      { address: "2001:db8::1", family: 6 as const },
    ]) {
      await expect(validateAcquisitionUrl(exactUrl, activeDefinition(), async () => [address])).rejects.toThrow(
        /private|non-global/i,
      );
    }
  });

  it("rejects a response whose transport connected outside the validated address set", async () => {
    const stageOwnedDocument = vi.fn(async () => ({
      documentId: "33333333-3333-4333-8333-333333333333",
      ownerId,
    }));
    await expect(
      acquirePublicSourceVersion(await validPlan(), {
        fetch: async () => connectedResponse(response(syntheticPdf()), "10.0.0.8"),
        resolve: async () => publicAddress,
        scan: async () => ({ accepted: true as const }),
        findDuplicateVersion: async () => null,
        stageOwnedDocument,
        enqueue: vi.fn(),
      }),
    ).rejects.toThrow(/validated.*address|transport/i);
    expect(stageOwnedDocument).not.toHaveBeenCalled();
  });

  it("creates only an immutable, exact-policy, owned-staging dry-run plan", async () => {
    const fetch = vi.fn();
    const plan = await validPlan({ fetch });

    expect(fetch).not.toHaveBeenCalled();
    expect(plan).toMatchObject({
      schemaVersion: "public-source-acquisition-v1",
      sourcePolicyVersion: "australian-source-policy-v1",
      sourcePolicyDigest: australianSourcePolicyDigest,
      catalogueKey: "wa-health",
      exactUrl,
      exactVersion: "2026-08-20",
      exactDocumentLicence: "public_index_permitted",
      stagingOwnerId: ownerId,
      targetLifecycle: "shadow",
    });
    expect(Object.isFrozen(plan)).toBe(true);
    await expect(validPlan({ stagingOwnerId: "" })).rejects.toThrow(/staging owner/i);
    await expect(validPlan({ exactDocumentLicence: "review_required" })).rejects.toThrow(/licence/i);
    await expect(
      validPlan({ activationManifest: { ...activationManifest(), decision: "quarantine" } }),
    ).rejects.toThrow(/active source definition/i);
  });

  it("hashes a bounded validated stream and stages it with provenance before enqueue", async () => {
    const bytes = syntheticPdf();
    const stageOwnedDocument = vi.fn(async (candidate) => ({
      documentId: "33333333-3333-4333-8333-333333333333",
      ownerId: candidate.ownerId,
    }));
    const enqueue = vi.fn(async () => undefined);
    const scan = vi.fn(async () => ({ accepted: true as const }));
    const fetch = vi.fn(async () => connectedResponse(response(bytes)));
    const resolve = vi.fn(async () => publicAddress);

    const result = await acquirePublicSourceVersion(await validPlan(), {
      fetch,
      resolve,
      scan,
      findDuplicateVersion: async () => null,
      stageOwnedDocument,
      enqueue,
    });

    const expectedHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    expect(result).toMatchObject({
      lifecycle: "shadow",
      contentHash: expectedHash,
      ownerId,
      documentId: "33333333-3333-4333-8333-333333333333",
    });
    expect(scan).toHaveBeenCalledWith(expect.objectContaining({ bytes, contentType: "application/pdf" }));
    expect(stageOwnedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        lifecycle: "shadow",
        metadata: expect.objectContaining({
          source_policy_version: "australian-source-policy-v1",
          source_policy_digest: australianSourcePolicyDigest,
          source_catalogue_key: "wa-health",
          content_hash: expectedHash,
          licence_evidence_digest: `sha256:${"a".repeat(64)}`,
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "33333333-3333-4333-8333-333333333333",
        ownerId,
        contentMode: "indexed_content",
        exactDocumentLicence: "public_index_permitted",
      }),
    );
  });

  it("fails closed on content type, declared or streamed size, redirect count, and DNS rebinding", async () => {
    const base = {
      resolve: vi.fn(async () => publicAddress),
      scan: vi.fn(async () => ({ accepted: true as const })),
      findDuplicateVersion: vi.fn(async () => null),
      stageOwnedDocument: vi.fn(),
      enqueue: vi.fn(),
    };
    const plan = await validPlan({ maxBytes: 64 });

    await expect(
      acquirePublicSourceVersion(plan, {
        ...base,
        fetch: async () => connectedResponse(response("not a document", { headers: { "content-type": "image/png" } })),
      }),
    ).rejects.toThrow(/content type/i);
    await expect(
      acquirePublicSourceVersion(plan, {
        ...base,
        fetch: async () => connectedResponse(response("small", { headers: { "content-length": "65" } })),
      }),
    ).rejects.toThrow(/size/i);
    await expect(
      acquirePublicSourceVersion(plan, {
        ...base,
        fetch: async () => connectedResponse(response("x".repeat(65))),
      }),
    ).rejects.toThrow(/size/i);
    await expect(
      acquirePublicSourceVersion(plan, {
        ...base,
        fetch: async () => connectedResponse(new Response(null, { status: 302, headers: { location: exactUrl } })),
      }),
    ).rejects.toThrow(/redirect/i);

    const resolve = vi.fn().mockResolvedValue(publicAddress);
    await expect(
      acquirePublicSourceVersion(await validPlan(), {
        ...base,
        resolve,
        fetch: async () => connectedResponse(response(syntheticPdf()), "1.1.1.1"),
      }),
    ).rejects.toThrow(/validated.*address|transport/i);
    expect(base.stageOwnedDocument).not.toHaveBeenCalled();
    expect(base.enqueue).not.toHaveBeenCalled();
  });

  it("rejects duplicate versions and a changed policy digest before storage or enqueue", async () => {
    const fetch = vi.fn(async () => connectedResponse(response(syntheticPdf())));
    const stageOwnedDocument = vi.fn();
    const enqueue = vi.fn();
    const deps = {
      fetch,
      resolve: async () => publicAddress,
      scan: async () => ({ accepted: true as const }),
      findDuplicateVersion: async () => "existing-version-id",
      stageOwnedDocument,
      enqueue,
    };
    await expect(acquirePublicSourceVersion(await validPlan(), deps)).rejects.toThrow(/duplicate/i);
    await expect(
      acquirePublicSourceVersion(
        { ...(await validPlan()), sourcePolicyDigest: `sha256:${"0".repeat(64)}` } as PublicSourceAcquisitionPlan,
        deps,
      ),
    ).rejects.toThrow(/policy digest/i);
    expect(stageOwnedDocument).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("requires the staging adapter to preserve a non-null exact owner", async () => {
    const enqueue = vi.fn();
    await expect(
      acquirePublicSourceVersion(await validPlan(), {
        fetch: async () => connectedResponse(response(syntheticPdf())),
        resolve: async () => publicAddress,
        scan: async () => ({ accepted: true as const }),
        findDuplicateVersion: async () => null,
        stageOwnedDocument: async () => ({
          documentId: "33333333-3333-4333-8333-333333333333",
          ownerId: null,
        }),
        enqueue,
      }),
    ).rejects.toThrow(/owner/i);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never copies an upstream response body into logs or errors", async () => {
    const secretBody = "SENTINEL-UPSTREAM-BODY-MUST-NOT-LEAK";
    const log = vi.fn();
    let caught: unknown;
    try {
      await acquirePublicSourceVersion(await validPlan(), {
        fetch: async () => connectedResponse(response(secretBody, { status: 500, statusText: "Upstream failure" })),
        resolve: async () => publicAddress,
        scan: async () => ({ accepted: true as const }),
        findDuplicateVersion: async () => null,
        stageOwnedDocument: vi.fn(),
        enqueue: vi.fn(),
        log,
      });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).not.toContain(secretBody);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secretBody);
  });

  it("drops trusted-page chrome links and quarantines a marker retained in main content", () => {
    const fixture = readFileSync(
      new URL("./fixtures/public-sources/trusted-page-with-healthdirect-chrome.html", import.meta.url),
      "utf8",
    );
    const accepted = evaluateTrustedPageContent(fixture);
    expect(accepted).toMatchObject({ eligibleForIndex: true, disposition: "accepted" });
    expect(accepted.mainText).toContain("Synthetic clinical guideline");
    expect(accepted.mainText).not.toMatch(/healthdirect/i);
    expect(accepted.retainedLinks).toEqual([]);

    expect(
      evaluateTrustedPageContent(
        fixture.replace(
          "This synthetic main-content fixture contains no clinical recommendation.",
          "Healthdirect is named in retained main content.",
        ),
      ),
    ).toMatchObject({ eligibleForIndex: false, disposition: "quarantine", mainText: "" });

    for (const protectedText of [
      "eTG protected excerpt retained in main content.",
      "Therapeutic Guidelines protected excerpt retained in main content.",
      "AMH protected excerpt retained in main content.",
      "Australian Medicines Handbook protected excerpt retained in main content.",
    ]) {
      expect(
        evaluateTrustedPageContent(
          fixture.replace("This synthetic main-content fixture contains no clinical recommendation.", protectedText),
        ),
      ).toMatchObject({ eligibleForIndex: false, disposition: "quarantine", mainText: "" });
    }
  });

  it("rejects retained protected-source text and synthetic PDF text before staging or enqueue", async () => {
    const stageOwnedDocument = vi.fn(async () => ({
      documentId: "33333333-3333-4333-8333-333333333333",
      ownerId,
    }));
    const enqueue = vi.fn();
    for (const [contentType, bytes] of [
      ["text/plain", new TextEncoder().encode("Australian Medicines Handbook protected excerpt")],
      [
        "application/pdf",
        new TextEncoder().encode(
          "%PDF-1.7\n1 0 obj\n<<>>\nstream\nTherapeutic Guidelines protected excerpt\nendstream\nendobj\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n",
        ),
      ],
    ] as const) {
      await expect(
        acquirePublicSourceVersion(await validPlan({ allowedContentTypes: [contentType] }), {
          fetch: async () => connectedResponse(response(bytes, { headers: { "content-type": contentType } })),
          resolve: async () => publicAddress,
          scan: async () => ({ accepted: true as const }),
          findDuplicateVersion: async () => null,
          stageOwnedDocument,
          enqueue,
        }),
      ).rejects.toThrow(/protected|link-only|quarantine/i);
    }
    expect(stageOwnedDocument).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("hashes the exact canonical staged bytes and preserves separate upstream HTML provenance", async () => {
    const fixture = readFileSync(
      new URL("./fixtures/public-sources/trusted-page-with-healthdirect-chrome.html", import.meta.url),
      "utf8",
    );
    const upstreamBytes = new TextEncoder().encode(fixture);
    const upstreamHash = `sha256:${createHash("sha256").update(upstreamBytes).digest("hex")}`;
    const stageOwnedDocument = vi.fn(async (candidate: PublicSourceStagingCandidate) => ({
      documentId: "33333333-3333-4333-8333-333333333333",
      ownerId: candidate.ownerId,
    }));
    await acquirePublicSourceVersion(await validPlan({ allowedContentTypes: ["text/html"] }), {
      fetch: async () => connectedResponse(response(upstreamBytes, { headers: { "content-type": "text/html" } })),
      resolve: async () => publicAddress,
      scan: async () => ({ accepted: true as const }),
      findDuplicateVersion: async () => null,
      stageOwnedDocument,
      enqueue: async () => undefined,
    });

    const candidate = stageOwnedDocument.mock.calls[0]![0];
    const stagedHash = `sha256:${createHash("sha256").update(candidate.bytes).digest("hex")}`;
    expect(candidate.contentHash).toBe(stagedHash);
    expect(candidate.metadata).toMatchObject({
      content_hash: stagedHash,
      source_content_hash: upstreamHash,
    });
    expect(candidate).toMatchObject({ sourceBytes: upstreamBytes, sourceContentHash: upstreamHash });
  });

  it("stages only retained trusted-page text and quarantines a retained excluded-source marker", async () => {
    const fixture = readFileSync(
      new URL("./fixtures/public-sources/trusted-page-with-healthdirect-chrome.html", import.meta.url),
      "utf8",
    );
    const scan = vi.fn(async (_input: { bytes: Uint8Array; contentType: string; catalogueKey: string }) => ({
      accepted: true as const,
    }));
    const stageOwnedDocument = vi.fn(async (_candidate: PublicSourceStagingCandidate) => ({
      documentId: "33333333-3333-4333-8333-333333333333",
      ownerId,
    }));
    const plan = await validPlan({ allowedContentTypes: ["text/html"] });
    await acquirePublicSourceVersion(plan, {
      fetch: async () => connectedResponse(response(fixture, { headers: { "content-type": "text/html" } })),
      resolve: async () => publicAddress,
      scan,
      findDuplicateVersion: async () => null,
      stageOwnedDocument,
      enqueue: async () => undefined,
    });
    const scanned = scan.mock.calls[0]![0];
    expect(scanned.contentType).toBe("text/plain");
    expect(new TextDecoder().decode(scanned.bytes)).toContain("Synthetic clinical guideline");
    expect(new TextDecoder().decode(scanned.bytes)).not.toMatch(/healthdirect/i);
    expect(stageOwnedDocument.mock.calls[0]![0]).toMatchObject({ contentType: "text/plain" });

    const quarantined = fixture.replace(
      "This synthetic main-content fixture contains no clinical recommendation.",
      "Healthdirect is named in retained main content.",
    );
    await expect(
      acquirePublicSourceVersion(plan, {
        fetch: async () => connectedResponse(response(quarantined, { headers: { "content-type": "text/html" } })),
        resolve: async () => publicAddress,
        scan,
        findDuplicateVersion: async () => null,
        stageOwnedDocument,
        enqueue: async () => undefined,
      }),
    ).rejects.toThrow(/quarantine/i);
    expect(stageOwnedDocument).toHaveBeenCalledTimes(1);
  });

  it("rejects tampered manifest limits, owners, lifecycle, and types before fetch", async () => {
    const fetch = vi.fn();
    const base = await validPlan();
    const deps = {
      fetch,
      resolve: async () => publicAddress,
      scan: async () => ({ accepted: true as const }),
      findDuplicateVersion: async () => null,
      stageOwnedDocument: vi.fn(),
      enqueue: vi.fn(),
    };
    for (const mutation of [
      { maxBytes: 151 * 1024 * 1024 },
      { stagingOwnerId: "" },
      { targetLifecycle: "active" },
      { allowedContentTypes: ["image/png"] },
      { exactUrl: "https://evil.example/source.pdf" },
    ]) {
      await expect(
        acquirePublicSourceVersion({ ...base, ...mutation } as PublicSourceAcquisitionPlan, deps),
      ).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records unchanged checks, stages changed content as owned shadow, and tombstones withdrawals", async () => {
    const recordCheck = vi.fn(async () => undefined);
    const stageChangedVersion = vi.fn(async () => ({ versionId: "version-new", ownerId }));
    const tombstoneCurrentVersion = vi.fn(async () => undefined);
    const queueHumanReview = vi.fn(async () => undefined);
    const plan = await validPlan();

    await expect(
      checkPublicSourceChange({
        plan,
        currentVersion: {
          catalogueKey: plan.catalogueKey,
          versionId: "version-current",
          exactUrl: plan.exactUrl,
          exactVersion: plan.exactVersion,
          contentHash: `sha256:${"b".repeat(64)}`,
        },
        observed: { kind: "content", contentHash: `sha256:${"b".repeat(64)}` },
        recordCheck,
        stageChangedVersion,
        tombstoneCurrentVersion,
        queueHumanReview,
      }),
    ).resolves.toEqual({ outcome: "unchanged" });
    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({ outcome: "unchanged" }));

    await expect(
      checkPublicSourceChange({
        plan,
        currentVersion: {
          catalogueKey: plan.catalogueKey,
          versionId: "version-current",
          exactUrl: plan.exactUrl,
          exactVersion: plan.exactVersion,
          contentHash: `sha256:${"b".repeat(64)}`,
        },
        observed: { kind: "content", contentHash: `sha256:${"c".repeat(64)}` },
        recordCheck,
        stageChangedVersion,
        tombstoneCurrentVersion,
        queueHumanReview,
      }),
    ).resolves.toMatchObject({ outcome: "changed", lifecycle: "shadow", ownerId });
    expect(stageChangedVersion).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle: "shadow", ownerId, supersedesVersionId: null, activate: false }),
    );

    await expect(
      checkPublicSourceChange({
        plan,
        currentVersion: {
          catalogueKey: plan.catalogueKey,
          versionId: "version-current",
          exactUrl: plan.exactUrl,
          exactVersion: plan.exactVersion,
          contentHash: `sha256:${"b".repeat(64)}`,
        },
        observed: { kind: "withdrawn", reason: "Publisher returned a bounded withdrawal signal." },
        recordCheck,
        stageChangedVersion,
        tombstoneCurrentVersion,
        queueHumanReview,
      }),
    ).resolves.toEqual({ outcome: "tombstoned" });
    expect(tombstoneCurrentVersion).toHaveBeenCalledBefore(queueHumanReview);
  });

  it("rejects a cross-catalogue current-version identity before a withdrawal tombstone", async () => {
    const tombstoneCurrentVersion = vi.fn();
    const plan = await validPlan();
    await expect(
      checkPublicSourceChange({
        plan,
        currentVersion: {
          catalogueKey: "tga",
          versionId: "55555555-5555-4555-8555-555555555555",
          exactUrl: plan.exactUrl,
          exactVersion: plan.exactVersion,
          contentHash: `sha256:${"b".repeat(64)}`,
        },
        observed: { kind: "withdrawn", reason: "Publisher returned bounded withdrawal status 410." },
        recordCheck: vi.fn(),
        stageChangedVersion: vi.fn(),
        tombstoneCurrentVersion,
        queueHumanReview: vi.fn(),
      }),
    ).rejects.toThrow(/catalogue|identity/i);
    expect(tombstoneCurrentVersion).not.toHaveBeenCalled();
  });

  it("maps arbitrary scanner and live-adapter diagnostics to fixed public-source error codes", async () => {
    const sentinel = "SENTINEL-PROTECTED-CONTENT-AND-SECRET";
    let caught: unknown;
    try {
      await acquirePublicSourceVersion(await validPlan(), {
        fetch: async () => connectedResponse(response(syntheticPdf())),
        resolve: async () => publicAddress,
        scan: async () => ({ accepted: false as const, reasonCode: sentinel as never }),
        findDuplicateVersion: async () => null,
        stageOwnedDocument: vi.fn(),
        enqueue: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }
    expect(String(caught)).not.toContain(sentinel);
    expect(String(caught)).toMatch(/blocked|validation/i);

    const liveAdapter = readFileSync(
      new URL("../scripts/fetch-approved-public-source-versions.ts", import.meta.url),
      "utf8",
    );
    expect(liveAdapter).not.toMatch(/throw new Error\([^\n]*\.message/);
  });

  it("keeps acquisition CLIs import-safe, dry-run by default, and apply-confirmation bound", async () => {
    const inputPath = join(cliWorkdir, "exact-versions.json");
    const manifestPath = join(cliWorkdir, "manifest.json");
    writeFileSync(
      inputPath,
      JSON.stringify([
        {
          catalogueKey: "wa-health",
          url: exactUrl,
          exactVersion: "2026-08-20",
          exactDocumentLicence: "public_index_permitted",
          licenceEvidenceDigest: `sha256:${"a".repeat(64)}`,
          stagingOwnerId: ownerId,
          sourceActivationEventId: "44444444-4444-4444-8444-444444444444",
          activationManifest: activationManifest(),
        },
      ]),
    );
    const planOutput = vi.fn();
    await runPlanPublicSourceAcquisitionCli(["--input", inputPath, "--output", manifestPath], {
      stdout: planOutput,
    });
    expect(planOutput).toHaveBeenCalledWith(expect.stringContaining('"mode":"dry-run"'));

    const dependencyFactory = vi.fn();
    await expect(
      runFetchApprovedPublicSourceVersionsCli(["--manifest", manifestPath], {
        dependenciesForPlan: dependencyFactory,
        stdout: vi.fn(),
      }),
    ).resolves.toEqual({ applied: false, count: 1 });
    expect(dependencyFactory).not.toHaveBeenCalled();

    const rawManifest = readFileSync(manifestPath, "utf8");
    const tamperedManifestPath = join(cliWorkdir, "tampered-manifest.json");
    const tamperedManifest = JSON.parse(rawManifest) as {
      plans: Array<PublicSourceAcquisitionPlan & { maxBytes: number }>;
    };
    tamperedManifest.plans[0]!.maxBytes = 151 * 1024 * 1024;
    const rawTamperedManifest = JSON.stringify(tamperedManifest);
    writeFileSync(tamperedManifestPath, rawTamperedManifest);
    const tamperedDependencyFactory = vi.fn();
    await expect(
      runFetchApprovedPublicSourceVersionsCli(
        [
          "--manifest",
          tamperedManifestPath,
          "--expected-count",
          "1",
          "--manifest-sha256",
          publicSourceAcquisitionManifestDigest(rawTamperedManifest),
          "--apply",
        ],
        { dependenciesForPlan: tamperedDependencyFactory, stdout: vi.fn() },
      ),
    ).rejects.toThrow(/limits|content types/i);
    expect(tamperedDependencyFactory).not.toHaveBeenCalled();

    const authorizePlan = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => connectedResponse(response(syntheticPdf())));
    dependencyFactory.mockResolvedValue({
      authorizePlan,
      fetch,
      resolve: async () => publicAddress,
      scan: async () => ({ accepted: true as const }),
      findDuplicateVersion: async () => null,
      stageOwnedDocument: async () => ({
        documentId: "33333333-3333-4333-8333-333333333333",
        ownerId,
      }),
      enqueue: async () => undefined,
    });
    await expect(
      runFetchApprovedPublicSourceVersionsCli(
        [
          "--manifest",
          manifestPath,
          "--expected-count",
          "1",
          "--manifest-sha256",
          publicSourceAcquisitionManifestDigest(rawManifest),
          "--apply",
        ],
        { dependenciesForPlan: dependencyFactory, stdout: vi.fn() },
      ),
    ).resolves.toMatchObject({ applied: true, count: 1 });
    expect(authorizePlan).toHaveBeenCalledBefore(fetch);

    const currentPath = join(cliWorkdir, "current.json");
    writeFileSync(
      currentPath,
      JSON.stringify([
        {
          catalogueKey: "wa-health",
          versionId: "55555555-5555-4555-8555-555555555555",
          exactUrl,
          exactVersion: "2026-08-20",
          contentHash: `sha256:${"b".repeat(64)}`,
          lifecycle: "active",
        },
      ]),
    );
    const changeFactory = vi.fn();
    await expect(
      runCheckPublicSourceChangesCli(["--manifest", manifestPath, "--current", currentPath], {
        dependenciesForPlan: changeFactory,
        stdout: vi.fn(),
      }),
    ).resolves.toEqual({ applied: false, count: 1 });
    expect(changeFactory).not.toHaveBeenCalled();

    const rawCurrent = readFileSync(currentPath, "utf8");
    await expect(
      runCheckPublicSourceChangesCli(
        [
          "--manifest",
          manifestPath,
          "--current",
          currentPath,
          "--expected-count",
          "1",
          "--manifest-sha256",
          publicSourceAcquisitionManifestDigest(rawManifest),
          "--apply",
        ],
        { dependenciesForPlan: changeFactory, stdout: vi.fn() },
      ),
    ).resolves.toEqual({ applied: false, count: 1 });
    expect(rawCurrent).not.toHaveLength(0);
    expect(changeFactory).not.toHaveBeenCalled();
  });

  it("rechecks the persisted activation immediately before live upload and enqueue", () => {
    const source = readFileSync(
      new URL("../scripts/fetch-approved-public-source-versions.ts", import.meta.url),
      "utf8",
    );
    const authorizationCalls = [...source.matchAll(/await authorizePlan\(plan\);/g)].map((match) => match.index);
    expect(authorizationCalls).toHaveLength(2);
    expect(authorizationCalls[0]).toBeLessThan(source.indexOf(".upload(storagePath"));
    expect(authorizationCalls[1]).toBeLessThan(source.indexOf("result = await enqueueDocumentReindexJob"));
  });
});
