import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { australianSourceByKey } from "@/lib/australian-source-catalogue";
import {
  createPublicSourceActivationManifest,
  publicSourcePolicyDigest,
} from "@/lib/public-source-activation-manifest";
import {
  acquisitionPlanDigest,
  classifyPublicSourceChange,
  extractTrustedHtmlContent,
  fetchApprovedPublicSource,
  isGlobalPublicAddress,
  normalizeAcquisitionMime,
  parseFetchApprovedSourceArgs,
  planAcquisition,
  PublicSourceAcquisitionError,
  validateAcquisitionUrl,
  validateRedirect,
  validateFetchedPublicSource,
  type AcquisitionRequest,
  type PublicSourceAcquisitionPlan,
} from "@/lib/public-source-acquisition";
import {
  parseSignedPublicSourceUploadAuthority,
  stageFetchedPublicSource,
  uploadPublicSourceWithSignedAuthority,
  type PublicSourceStagingDependencies,
} from "../scripts/fetch-approved-public-source-versions";
import {
  processControlledPublicSourceCleanup,
  publicSourceCleanupIdentityError,
  type CleanupJob,
} from "../scripts/cleanup-storage";

vi.mock("@next/env", () => ({ loadEnvConfig: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { SUPABASE_DOCUMENT_BUCKET: "offline-test", WORKER_MAX_ATTEMPTS: 3 } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("default admin client is forbidden in provider-free tests");
  },
}));

const stewardId = "22222222-2222-4222-8222-222222222222";
const activationEventId = "33333333-3333-4333-8333-333333333333";
const activationSequence = 17;
const licenceEvidenceDigest = "a".repeat(64);
const reservationLease = {
  storageBucket: "offline-test",
  uploadLeaseToken: "66666666-6666-4666-8666-666666666666",
  uploadLeaseExpiresAt: "2026-08-24T00:15:00.000Z",
  uploadState: "reserved",
};

const uploadAttemptId = "77777777-7777-4777-8777-777777777777";

function signedUploadToken(expiresAtSeconds: number) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: expiresAtSeconds })}.offline-signature`;
}

function signedUploadFixture(storagePath: string, expiresAtSeconds = 1_777_000_000) {
  const token = signedUploadToken(expiresAtSeconds);
  return {
    token,
    path: storagePath,
    signedUrl: `https://offline-project.supabase.co/storage/v1/object/upload/sign/offline-test/${storagePath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?token=${token}`,
  };
}

function authorizedUploadState(reservation: {
  id: string;
  reservedDocumentId: string;
  storagePath: string;
  storageBucket: string;
  uploadLeaseToken: string;
  uploadLeaseExpiresAt: string;
}) {
  return {
    id: reservation.id,
    lifecycle: "discovered",
    staging_document_id: null,
    reserved_document_id: reservation.reservedDocumentId,
    reserved_storage_path: reservation.storagePath,
    storage_bucket: reservation.storageBucket,
    upload_lease_token: reservation.uploadLeaseToken,
    upload_lease_expires_at: reservation.uploadLeaseExpiresAt,
    upload_state: "uploading",
    steward_id: stewardId,
  };
}

function activation(catalogueKey = "wa-health") {
  return createPublicSourceActivationManifest({
    version: 1,
    sourcePolicyVersion: "australian-source-policy-v1",
    sourcePolicyDigest: publicSourcePolicyDigest,
    catalogueKey,
    decision: "activate",
    operatorId: "11111111-1111-4111-8111-111111111111",
    reason: "Controlled acquisition approved after legal review.",
    evidenceReferences: ["legal-review:2026-08"],
  });
}

function planInput(overrides: Record<string, unknown> = {}) {
  return {
    catalogueKey: "wa-health",
    exactUrl: "https://www.health.wa.gov.au/versioned/policy.pdf",
    exactVersion: "2026-08-24",
    exactDocumentLicence: "public_index_permitted" as const,
    licenceEvidenceDigest,
    stewardId,
    activationEventId,
    activationSequence,
    activationManifest: activation(),
    ...overrides,
  };
}

async function activePlan(overrides: Record<string, unknown> = {}) {
  return planAcquisition(planInput(overrides));
}

function chunks(...values: Array<string | Uint8Array>): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) yield typeof value === "string" ? Buffer.from(value) : value;
    },
  };
}

describe("public source acquisition", () => {
  it("rejects excluded and link-only sources before DNS or network access", async () => {
    const resolve = vi.fn();
    const request = vi.fn();

    await expect(
      planAcquisition(
        planInput({
          catalogueKey: "etg-complete",
          exactUrl: "https://www.tg.org.au/guide.pdf",
          activationManifest: { ...activation(), catalogueKey: "etg-complete" },
          resolve,
          request,
        }),
      ),
    ).rejects.toThrow(/link-only/i);
    await expect(
      planAcquisition(
        planInput({
          catalogueKey: "healthdirect",
          exactUrl: "https://www.healthdirect.gov.au/guide.pdf",
          activationManifest: { ...activation(), catalogueKey: "healthdirect" },
          resolve,
          request,
        }),
      ),
    ).rejects.toThrow(/not in the active catalogue/i);
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("requires matching source activation, exact-document licence, and a non-null steward", async () => {
    await expect(activePlan({ activationManifest: { ...activation(), decision: "quarantine" } })).rejects.toThrow(
      /active source definition/i,
    );
    await expect(activePlan({ exactDocumentLicence: "review_required" })).rejects.toThrow(/document licence/i);
    await expect(activePlan({ stewardId: null })).rejects.toThrow(/steward/i);
    await expect(activePlan({ activationEventId: null })).rejects.toThrow(/activation event/i);
  });

  it("emits an immutable, deterministic exact-version acquisition plan without network access", async () => {
    const resolve = vi.fn();
    const request = vi.fn();
    const plan = await activePlan({ resolve, request });

    expect(plan).toMatchObject({
      version: 1,
      sourcePolicyDigest: publicSourcePolicyDigest,
      catalogueKey: "wa-health",
      activationSequence,
      exactVersion: "2026-08-24",
      lifecycle: "discovered",
      stewardId,
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(acquisitionPlanDigest(plan)).toMatch(/^[0-9a-f]{64}$/);
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.health.wa.gov.au/policy.pdf",
    "https://user:pass@www.health.wa.gov.au/policy.pdf",
    "https://www.health.wa.gov.au:444/policy.pdf",
    "https://www.health.wa.gov.au/policy.pdf#fragment",
    "https://127.0.0.1/policy.pdf",
    "https://evil.example/policy.pdf",
  ])("rejects unsafe exact URLs before DNS: %s", async (url) => {
    const resolve = vi.fn();
    await expect(validateAcquisitionUrl(url, australianSourceByKey("wa-health")!, { resolve })).rejects.toThrow(
      /https|credentials|port|fragment|literal|allowlisted/i,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.2",
    "203.0.113.2",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    "0:0:0:0:0:ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::192.0.2.1",
    "100::1",
    "64:ff9b:1::1",
    "2001:2::1",
    "2001:db8::1",
    "2002:c000:0201::1",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff00::1",
  ])("rejects non-global IPv4 and IPv6 address %s", (address) => {
    expect(isGlobalPublicAddress(address)).toBe(false);
  });

  it("rejects the whole DNS answer when any address is non-global", async () => {
    await expect(
      validateAcquisitionUrl("https://www.health.wa.gov.au/file.pdf", australianSourceByKey("wa-health")!, {
        resolve: async () => [
          { address: "1.1.1.1", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toThrow(/non-global|private/i);
  });

  it("pins the validated address into each request and re-resolves every manual redirect", async () => {
    const plan = await activePlan();
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "2606:4700:4700::1111", family: 6 }]);
    const request = vi
      .fn<AcquisitionRequest>()
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: "/final.pdf" },
        body: chunks(),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: chunks("%PDF-1.4\n%%EOF"),
      });

    const fetched = await fetchApprovedPublicSource(plan, { resolve, request });

    expect(fetched.contentHash).toBe("4f1949e95440af0ece666ebd5f399c1d77d22de639950784d349fa5feb47dca5");
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ hostname: "www.health.wa.gov.au", address: "1.1.1.1" });
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      hostname: "www.health.wa.gov.au",
      address: "2606:4700:4700::1111",
    });
  });

  it("rejects off-host redirects, redirect loops, and more than three redirects", async () => {
    const definition = australianSourceByKey("wa-health")!;
    await expect(validateRedirect("https://evil.example/file.pdf", definition, { resolve: vi.fn() })).rejects.toThrow(
      /allowlisted/i,
    );

    const plan = await activePlan();
    const resolve = async () => [{ address: "1.1.1.1", family: 4 as const }];
    await expect(
      fetchApprovedPublicSource(plan, {
        resolve,
        request: async () => ({ status: 302, headers: { location: "/again" }, body: chunks() }),
      }),
    ).rejects.toThrow(/redirect loop/i);

    let redirect = 0;
    await expect(
      fetchApprovedPublicSource(plan, {
        resolve,
        request: async () => ({
          status: 302,
          headers: { location: `/redirect-${redirect++}` },
          body: chunks(),
        }),
      }),
    ).rejects.toThrow(/three redirects/i);
  });

  it("redacts rejected redirect locations and content-validation details", async () => {
    const plan = await activePlan();
    const resolve = async () => [{ address: "1.1.1.1", family: 4 as const }];
    const redirectError = await fetchApprovedPublicSource(plan, {
      resolve,
      request: async () => ({
        status: 302,
        headers: { location: "https://[invalid-query-secret" },
        body: chunks(),
      }),
    }).catch((caught: unknown) => caught);
    expect(redirectError).toBeInstanceOf(PublicSourceAcquisitionError);
    expect(JSON.stringify(redirectError)).not.toContain("invalid-query-secret");

    const validationError = await fetchApprovedPublicSource(plan, {
      resolve,
      request: async () => ({
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: chunks("content-validation-secret"),
      }),
    }).catch((caught: unknown) => caught);
    expect(validationError).toBeInstanceOf(PublicSourceAcquisitionError);
    expect(JSON.stringify(validationError)).not.toContain("content-validation-secret");
  });

  it("enforces the streamed limit after decompression and cancels partial content", async () => {
    const plan = await activePlan();
    const cancel = vi.fn();
    const compressed = gzipSync(Buffer.from("x".repeat(2_048)));

    await expect(
      fetchApprovedPublicSource(plan, {
        maxBytes: 1_024,
        resolve: async () => [{ address: "1.1.1.1", family: 4 }],
        request: async () => ({
          status: 200,
          headers: { "content-type": "text/plain", "content-encoding": "gzip" },
          body: chunks(compressed),
          cancel,
        }),
      }),
    ).rejects.toThrow(/size|bytes|limit/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("honours caller cancellation before network access", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();

    await expect(
      fetchApprovedPublicSource(await activePlan(), {
        signal: controller.signal,
        resolve: async () => [{ address: "1.1.1.1", family: 4 }],
        request,
      }),
    ).rejects.toThrow(/cancel|abort/i);
    expect(request).not.toHaveBeenCalled();
  });

  it("bounds a never-resolving DNS resolver under total timeout and caller abort", async () => {
    const plan = await activePlan();
    const never = vi.fn(() => new Promise<never>(() => undefined));
    await expect(fetchApprovedPublicSource(plan, { resolve: never, totalTimeoutMs: 20 })).rejects.toThrow(
      /cancel|timeout|dns/i,
    );

    const controller = new AbortController();
    const pending = fetchApprovedPublicSource(plan, {
      resolve: never,
      signal: controller.signal,
      totalTimeoutMs: 5_000,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancel|abort|timeout|dns/i);
  });

  it("normalizes MIME parameters and reuses file signature and structure validation", async () => {
    expect(normalizeAcquisitionMime("Application/PDF; charset=binary")).toBe("application/pdf");
    await expect(
      validateFetchedPublicSource({ mime: "application/pdf; charset=binary", content: Buffer.from("not a PDF") }),
    ).rejects.toThrow(/declared type|structure/i);
    await expect(
      validateFetchedPublicSource({ mime: "application/pdf", content: Buffer.from("%PDF-1.4\n%%EOF") }),
    ).resolves.toMatchObject({ mime: "application/pdf", disposition: "shadow" });
  });

  it("drops navigation, footer, active resources, and link targets from trusted HTML", () => {
    const html = `<!doctype html><html><body>
      <nav>Healthdirect <a href="https://www.healthdirect.gov.au/private?q=secret">external</a></nav>
      <main><h1>WA policy</h1><p>Retained clinical guidance.</p><img src="https://tracker.example/pixel"></main>
      <footer>Healthdirect footer</footer><script>window.secret = 'body-secret'</script>
    </body></html>`;

    const extracted = extractTrustedHtmlContent(html);

    expect(extracted.disposition).toBe("shadow");
    expect(extracted.text).toContain("WA policy");
    expect(extracted.text).toContain("Retained clinical guidance.");
    expect(extracted.text).not.toMatch(/healthdirect|tracker|private\?q|body-secret/i);
  });

  it("quarantines HTML when the Healthdirect marker remains in retained main content", () => {
    const extracted = extractTrustedHtmlContent(
      "<html><body><main><h1>Clinical page</h1><p>Republished from Healthdirect Australia.</p></main></body></html>",
    );
    expect(extracted).toMatchObject({ disposition: "quarantined" });
  });

  it("uses parsed visible content for entity decoding and quarantine decisions", () => {
    const extracted = extractTrustedHtmlContent(`
      <html><body><main>
        <p hidden>Health&#x64;irect hidden marker</p>
        <p aria-hidden="true">Healthdirect hidden marker</p>
        <p>Republished from Health&#100;irect&nbsp;Australia &amp; partners.</p>
      </main></body></html>
    `);
    expect(extracted.disposition).toBe("quarantined");
    expect(extracted.text).toContain("Healthdirect Australia & partners.");
    expect(extracted.text).not.toContain("hidden marker");
    expect(() => extractTrustedHtmlContent("<main hidden><p>Health&#x64;irect</p></main>")).toThrow(/main|article/i);
  });

  it("inherits hidden state from ancestors before choosing retained main content", () => {
    const extracted = extractTrustedHtmlContent(`
      <html><body>
        <section hidden><main>Healthdirect hidden ancestor marker</main></section>
        <section aria-hidden="true"><article>Healthdirect aria-hidden ancestor marker</article></section>
        <div style="display: none"><main>Healthdirect inline-hidden ancestor marker</main></div>
        <main><p>Visible clinical guidance.</p></main>
      </body></html>
    `);
    expect(extracted).toMatchObject({ disposition: "shadow" });
    expect(extracted.text).toBe("Visible clinical guidance.");
  });

  it("persists retained HTML byte integrity separately from streamed raw-response provenance", async () => {
    const plan = await activePlan({ exactUrl: "https://www.health.wa.gov.au/versioned/policy.html" });
    const rawHtml = Buffer.from(
      "<html><body><nav>Discarded chrome &amp; links</nav><main><h1>Clinical &amp; care</h1></main></body></html>",
      "utf8",
    );
    const fetched = await fetchApprovedPublicSource(plan, {
      resolve: async () => [{ address: "1.1.1.1", family: 4 }],
      request: async () => ({
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: chunks(rawHtml),
      }),
    });
    const storedHash = createHash("sha256").update(fetched.content).digest("hex");
    const rawHash = createHash("sha256").update(rawHtml).digest("hex");
    expect(fetched).toMatchObject({
      mime: "text/plain",
      contentHash: storedHash,
      byteCount: fetched.content.byteLength,
      rawResponseHash: rawHash,
      rawResponseByteCount: rawHtml.byteLength,
    });
    expect(fetched.contentHash).not.toBe(fetched.rawResponseHash);
    const changedChrome = Buffer.from(
      "<html><body><nav>Entirely different discarded chrome</nav><main><h1>Clinical &amp; care</h1></main></body></html>",
      "utf8",
    );
    const fetchedChangedChrome = await fetchApprovedPublicSource(plan, {
      resolve: async () => [{ address: "1.1.1.1", family: 4 }],
      request: async () => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: chunks(changedChrome),
      }),
    });
    expect(fetchedChangedChrome.contentHash).toBe(fetched.contentHash);
    expect(fetchedChangedChrome.rawResponseHash).not.toBe(fetched.rawResponseHash);

    const identityKeys: unknown[] = [];
    const duplicateDependencies: PublicSourceStagingDependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async ({ manifest }) => {
        identityKeys.push((manifest as Record<string, unknown>).reservationKey);
        return {
          id: "44444444-4444-4444-8444-444444444444",
          reservedDocumentId: "55555555-5555-4555-8555-555555555555",
          storagePath: `${stewardId}/public-source-staging/retained/source.txt`,
          stagingDocumentId: "55555555-5555-4555-8555-555555555555",
          lifecycle: "shadow",
          ...reservationLease,
        };
      }),
      authorizeUpload: vi.fn(async () => {
        throw new Error("duplicate path must not authorize");
      }),
      upload: vi.fn(async () => {
        throw new Error("duplicate path must not upload");
      }),
      finalize: vi.fn(async () => {
        throw new Error("duplicate path must not finalize");
      }),
      lookup: vi.fn(async () => null),
    };
    await stageFetchedPublicSource(plan, fetched, duplicateDependencies);
    await stageFetchedPublicSource(plan, fetchedChangedChrome, duplicateDependencies);
    expect(identityKeys).toHaveLength(2);
    expect(identityKeys[1]).toBe(identityKeys[0]);
    expect(duplicateDependencies.authorizeUpload).not.toHaveBeenCalled();

    const versionId = "44444444-4444-4444-8444-444444444444";
    const documentId = "55555555-5555-4555-8555-555555555555";
    const storagePath = `${stewardId}/public-source-staging/${versionId}/source.txt`;
    let uploaded = Buffer.alloc(0);
    let finalized: Record<string, unknown> = {};
    const dependencies: PublicSourceStagingDependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async () => ({
        id: versionId,
        reservedDocumentId: documentId,
        storagePath,
        stagingDocumentId: null,
        lifecycle: "discovered",
        ...reservationLease,
      })),
      authorizeUpload: vi.fn(async () =>
        authorizedUploadState({
          id: versionId,
          reservedDocumentId: documentId,
          storagePath,
          ...reservationLease,
        }),
      ),
      upload: vi.fn(async ({ content }) => {
        uploaded = Buffer.from(content);
      }),
      finalize: vi.fn(async ({ manifest }) => {
        finalized = manifest as Record<string, unknown>;
        return { id: versionId, lifecycle: "shadow", staging_document_id: documentId };
      }),
      lookup: vi.fn(async () => null),
    };

    await stageFetchedPublicSource(plan, fetched, dependencies);

    const document = finalized.document as Record<string, unknown>;
    const metadata = document.metadata as Record<string, unknown>;
    expect(createHash("sha256").update(uploaded).digest("hex")).toBe(finalized.contentHash);
    expect(document.content_hash).toBe(finalized.contentHash);
    expect(metadata.content_hash).toBe(finalized.contentHash);
    expect(document.file_size).toBe(uploaded.byteLength);
    expect(finalized).toMatchObject({
      rawResponseHash: rawHash,
      rawResponseByteCount: rawHtml.byteLength,
    });
    expect(metadata).toMatchObject({
      raw_response_hash: rawHash,
      raw_response_byte_count: rawHtml.byteLength,
    });
  });

  it("never includes response bodies, query strings, signed URLs, or operator identities in errors", async () => {
    const request = async () => ({
      status: 503,
      headers: { "content-type": "text/plain", "x-secret": "header-secret" },
      body: chunks("response-body-secret"),
    });
    const plan = await activePlan({
      exactUrl: "https://www.health.wa.gov.au/file.pdf?signature=query-secret",
    });

    const error = await fetchApprovedPublicSource(plan, {
      resolve: async () => [{ address: "1.1.1.1", family: 4 }],
      request,
    }).catch((caught: unknown) => caught);
    const rendered = JSON.stringify(error);
    expect(rendered).toContain("wa-health");
    expect(rendered).toContain("www.health.wa.gov.au");
    expect(rendered).not.toMatch(/response-body-secret|header-secret|query-secret|11111111/i);
  });

  it("classifies duplicate, changed, and withdrawal outcomes without automatic activation or supersession", async () => {
    const plan = await activePlan();
    expect(classifyPublicSourceChange({ plan, currentHash: "b".repeat(64), fetchedHash: "b".repeat(64) })).toEqual({
      disposition: "unchanged",
      createVersion: false,
    });
    expect(classifyPublicSourceChange({ plan, currentHash: "b".repeat(64), fetchedHash: "c".repeat(64) })).toEqual({
      disposition: "shadow",
      createVersion: true,
      supersedeCurrent: false,
    });
    expect(classifyPublicSourceChange({ plan, currentHash: "b".repeat(64), withdrawal: true })).toEqual({
      disposition: "tombstoned",
      createVersion: false,
      removeFromRetrieval: true,
      queueHumanReview: true,
    });
  });

  it("reserves authority before upload and recovers an ambiguous committed finalization", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "d".repeat(64),
      byteCount: 12,
      mime: "text/plain" as const,
      content: Buffer.from("clinical text"),
      text: "clinical text",
      disposition: "quarantined" as const,
    };
    const calls: string[] = [];
    const committed = {
      id: "44444444-4444-4444-8444-444444444444",
      lifecycle: "quarantined",
      staging_document_id: "55555555-5555-4555-8555-555555555555",
    };
    let reservedManifest: Record<string, string | number> = {};
    const dependencies: PublicSourceStagingDependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async ({ manifest }) => {
        calls.push("reserve");
        reservedManifest = manifest as unknown as Record<string, string | number>;
        return {
          id: committed.id,
          reservedDocumentId: committed.staging_document_id,
          storagePath: `${stewardId}/public-source-staging/${committed.id}/source.txt`,
          stagingDocumentId: null,
          lifecycle: "discovered",
          ...reservationLease,
        };
      }),
      authorizeUpload: vi.fn(async () => {
        calls.push("authorize");
        return authorizedUploadState({
          id: committed.id,
          reservedDocumentId: committed.staging_document_id,
          storagePath: `${stewardId}/public-source-staging/${committed.id}/source.txt`,
          ...reservationLease,
        });
      }),
      upload: vi.fn(async () => {
        calls.push("upload");
      }),
      finalize: vi.fn(async () => {
        calls.push("finalize");
        throw new Error("ambiguous transport failure after commit");
      }),
      lookup: vi.fn(async () => {
        calls.push("lookup");
        return {
          ...committed,
          reservation_key: reservedManifest.reservationKey as string,
          source_catalogue_key: plan.catalogueKey,
          source_policy_version: plan.sourcePolicyVersion,
          source_policy_digest: plan.sourcePolicyDigest,
          activation_event_id: plan.activationEventId,
          activation_sequence: plan.activationSequence,
          exact_canonical_url: australianSourceByKey(plan.catalogueKey)!.canonicalUrl,
          exact_version_url: plan.exactUrl,
          exact_version: plan.exactVersion,
          content_hash: fetched.contentHash,
          raw_response_hash: fetched.contentHash,
          raw_response_byte_count: fetched.byteCount,
          licence_evidence_digest: plan.licenceEvidenceDigest,
          steward_id: plan.stewardId,
          intended_disposition: fetched.disposition,
          reserved_document_id: committed.staging_document_id,
          reserved_storage_path: `${stewardId}/public-source-staging/${committed.id}/source.txt`,
          storage_bucket: reservationLease.storageBucket,
          upload_lease_token: reservationLease.uploadLeaseToken,
          upload_lease_expires_at: reservationLease.uploadLeaseExpiresAt,
          upload_state: "finalized",
        };
      }),
    };

    await expect(stageFetchedPublicSource(plan, fetched, dependencies)).resolves.toMatchObject({
      disposition: "quarantined",
      version: committed,
    });
    expect(calls).toEqual(["reserve", "authorize", "upload", "finalize", "lookup"]);
    expect(dependencies.upload).toHaveBeenCalledWith(
      expect.objectContaining({ storagePath: `${stewardId}/public-source-staging/${committed.id}/source.txt` }),
    );
  });

  it.each(["denied", "stale"])("checks %s current authority before DNS, HTTP, reservation, or upload", async () => {
    const plan = await activePlan();
    const execution = (await import("../scripts/fetch-approved-public-source-versions")) as unknown as {
      fetchAndStageApprovedPublicSource?: (
        plan: PublicSourceAcquisitionPlan,
        dependencies: Record<string, unknown>,
        acquisition: { resolve: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> },
      ) => Promise<unknown>;
    };
    expect(execution.fetchAndStageApprovedPublicSource).toBeTypeOf("function");
    const resolve = vi.fn();
    const request = vi.fn();
    const reserve = vi.fn();
    const upload = vi.fn();
    const preflight = vi.fn(async () => {
      throw new Error("Current public source authority denied the stale manifest.");
    });
    await expect(
      execution.fetchAndStageApprovedPublicSource!(
        plan,
        {
          storageBucket: "offline-test",
          preflight,
          reserve,
          authorizeUpload: vi.fn(),
          upload,
          finalize: vi.fn(),
          lookup: vi.fn(),
          abandon: vi.fn(),
          remove: vi.fn(),
        },
        { resolve, request },
      ),
    ).rejects.toThrow(/authority|stale|denied/i);
    expect(preflight).toHaveBeenCalledWith({
      manifest: expect.objectContaining({
        catalogueKey: plan.catalogueKey,
        activationEventId: plan.activationEventId,
        activationSequence,
        sourcePolicyVersion: plan.sourcePolicyVersion,
        sourcePolicyDigest: plan.sourcePolicyDigest,
        exactVersionUrl: plan.exactUrl,
        storageBucket: "offline-test",
        stewardId: plan.stewardId,
      }),
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("uses the same injected preflight before change-detection fetch", async () => {
    const plan = await activePlan();
    const changes = (await import("../scripts/check-public-source-changes")) as unknown as {
      fetchPublicSourceChangeCandidate?: (
        plan: PublicSourceAcquisitionPlan,
        currentHash: string,
        dependencies: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    expect(changes.fetchPublicSourceChangeCandidate).toBeTypeOf("function");
    const resolve = vi.fn();
    const request = vi.fn();
    const upload = vi.fn();
    await expect(
      changes.fetchPublicSourceChangeCandidate!(plan, "a".repeat(64), {
        storageBucket: "offline-test",
        preflight: vi.fn(async () => {
          throw new Error("Stale activation sequence.");
        }),
        resolve,
        request,
        upload,
      }),
    ).rejects.toThrow(/stale|authority/i);
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("requires a current reservation-bound upload lease before touching storage", async () => {
    const plan = await activePlan();
    const upload = vi.fn();
    const leaseToken = "66666666-6666-4666-8666-666666666666";
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async () => ({
        id: "44444444-4444-4444-8444-444444444444",
        reservedDocumentId: "55555555-5555-4555-8555-555555555555",
        storagePath: `${stewardId}/public-source-staging/lease/source.txt`,
        storageBucket: "offline-test",
        uploadLeaseToken: leaseToken,
        uploadLeaseExpiresAt: "2026-08-24T00:15:00.000Z",
        uploadState: "reserved",
        stagingDocumentId: null,
        lifecycle: "discovered",
      })),
      authorizeUpload: vi.fn(async ({ manifest }: { manifest: Record<string, unknown> }) => {
        expect(manifest).toMatchObject({
          storageBucket: "offline-test",
          uploadLeaseToken: leaseToken,
          stewardId: plan.stewardId,
        });
        throw new Error("Upload lease expired or steward authority was revoked.");
      }),
      upload,
      finalize: vi.fn(),
      lookup: vi.fn(),
    } as unknown as PublicSourceStagingDependencies;
    await expect(
      stageFetchedPublicSource(
        plan,
        {
          finalUrl: plan.exactUrl,
          contentHash: "5".repeat(64),
          byteCount: 12,
          mime: "text/plain",
          content: Buffer.from("clinical text"),
          disposition: "shadow",
        },
        dependencies,
      ),
    ).rejects.toThrow(/lease|steward|authority/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps janitor cleanup bound to immutable non-default bucket/path identity after metadata mutation", () => {
    const cleanupSource = readFileSync("scripts/cleanup-storage.ts", "utf8");
    expect(cleanupSource).toContain("public_source_reservation_id");
    expect(cleanupSource).toContain("public_source_storage_bucket");
    expect(cleanupSource).toContain("public_source_storage_path");
    expect(cleanupSource).toContain("public_source_cleanup_not_before");
    expect(cleanupSource).toContain('.rpc("claim_public_source_cleanup_job"');
    expect(cleanupSource).toContain('.rpc("complete_public_source_cleanup_job"');
    expect(cleanupSource).toContain('.rpc("release_public_source_cleanup_job"');
    expect(cleanupSource).toContain('.rpc("reap_expired_public_source_upload_attempts"');
    expect(cleanupSource).not.toContain("Date.now()");
    expect(cleanupSource).not.toContain("public_source_cleanup_not_before.lte");
    const update = cleanupSource.slice(cleanupSource.indexOf('.from("storage_cleanup_jobs")\n      .update'));
    expect(update).not.toContain("public_source_reservation_id:");
    expect(update).not.toContain("public_source_storage_bucket:");
    expect(update).not.toContain("public_source_storage_path:");
  });

  it("does not let a persistent generic cleanup backlog starve controlled cleanup claims", () => {
    const cleanupSource = readFileSync("scripts/cleanup-storage.ts", "utf8");
    expect(cleanupSource).toContain("processControlledPublicSourceCleanup(args.limit");
    expect(cleanupSource).not.toContain("args.limit - jobs.length");
  });

  it("validates the durable janitor job shape without trusting mutable metadata or image paths", () => {
    const path = `${stewardId}/public-source-staging/lease/source.txt`;
    const job: CleanupJob = {
      id: "77777777-7777-4777-8777-777777777777",
      document_id: null,
      document_bucket: "offline-test",
      document_paths: [path],
      image_bucket: "clinical-images",
      image_paths: [],
      attempts: 2,
      public_source_reservation_id: "44444444-4444-4444-8444-444444444444",
      public_source_upload_attempt_id: uploadAttemptId,
      public_source_storage_bucket: "offline-test",
      public_source_storage_path: path,
      public_source_cleanup_not_before: "2026-08-24T00:20:00.000Z",
    };
    expect(publicSourceCleanupIdentityError({ ...job, metadata: { mutated: true } } as CleanupJob)).toBeNull();
    expect(publicSourceCleanupIdentityError({ ...job, document_bucket: "clinical-documents" })).toMatch(/identity/i);
    expect(publicSourceCleanupIdentityError({ ...job, document_paths: ["wrong/path"] })).toMatch(/identity/i);
    expect(publicSourceCleanupIdentityError({ ...job, image_paths: ["unrelated/image.png"] })).toMatch(/identity/i);
  });

  it("lets the database clock decide cleanup eligibility despite a skewed worker clock", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
      const claim = vi.fn(async () => null);
      const remove = vi.fn();
      await expect(
        processControlledPublicSourceCleanup(1, {
          claim,
          remove,
          complete: vi.fn(),
          release: vi.fn(),
        }),
      ).resolves.toEqual({ completed: 0, failed: 0 });
      expect(claim).toHaveBeenCalledWith(25);
      expect(remove).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses exact non-default bucket and CAS tokens across cleanup release and retry", async () => {
    const path = `${stewardId}/public-source-staging/retry/source.txt`;
    const firstToken = "88888888-8888-4888-8888-888888888888";
    const secondToken = "99999999-9999-4999-8999-999999999999";
    const claimBase = {
      id: "77777777-7777-4777-8777-777777777777",
      claimExpiresAt: "2026-08-24T00:22:00.000Z",
      reservationId: "44444444-4444-4444-8444-444444444444",
      uploadAttemptId,
      bucket: "offline-test",
      path,
      imagePaths: [],
      attempts: 1,
    };
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ ...claimBase, claimToken: firstToken })
      .mockResolvedValueOnce({ ...claimBase, claimToken: secondToken, attempts: 2 });
    const remove = vi
      .fn()
      .mockResolvedValueOnce({ removed: 0, warnings: ["provider detail must not cross the RPC boundary"] })
      .mockResolvedValueOnce({ removed: 1, warnings: [] });
    const complete = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const dependencies = { claim, remove, complete, release };

    await expect(processControlledPublicSourceCleanup(1, dependencies)).resolves.toEqual({ completed: 0, failed: 1 });
    expect(release).toHaveBeenCalledWith({
      jobId: claimBase.id,
      claimToken: firstToken,
      error: "storage_delete_failed",
    });
    await expect(processControlledPublicSourceCleanup(1, dependencies)).resolves.toEqual({ completed: 1, failed: 0 });
    expect(remove).toHaveBeenNthCalledWith(1, "offline-test", path);
    expect(remove).toHaveBeenNthCalledWith(2, "offline-test", path);
    expect(complete).toHaveBeenCalledWith({ jobId: claimBase.id, claimToken: secondToken, storageRemoved: 1 });
  });

  it("rejects a claimed Task2 cleanup containing image paths before storage deletion", async () => {
    const remove = vi.fn();
    await expect(
      processControlledPublicSourceCleanup(1, {
        claim: vi.fn(async () => ({
          id: "77777777-7777-4777-8777-777777777777",
          claimToken: "88888888-8888-4888-8888-888888888888",
          claimExpiresAt: "2026-08-24T00:22:00.000Z",
          reservationId: "44444444-4444-4444-8444-444444444444",
          uploadAttemptId,
          bucket: "offline-test",
          path: `${stewardId}/public-source-staging/forged/source.txt`,
          imagePaths: ["unrelated/image.png"],
          attempts: 1,
        })),
        remove,
        complete: vi.fn(),
        release: vi.fn(),
      }),
    ).rejects.toThrow(/identity/i);
    expect(remove).not.toHaveBeenCalled();
  });

  it("lets a duplicate caller observe an active attempt without abandoning its owner", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "1".repeat(64),
      byteCount: 12,
      mime: "text/plain" as const,
      content: Buffer.from("clinical text"),
      disposition: "shadow" as const,
    };
    const initialReservation = {
      id: "44444444-4444-4444-8444-444444444444",
      reservedDocumentId: "55555555-5555-4555-8555-555555555555",
      storagePath: `${stewardId}/public-source-staging/exclusive/reserved/source.txt`,
      stagingDocumentId: null,
      lifecycle: "discovered",
      ...reservationLease,
    };
    const attemptToken = "88888888-8888-4888-8888-888888888888";
    const attemptExpiry = "2026-08-24T00:17:00.000Z";
    const attemptPath = `${stewardId}/public-source-staging/${initialReservation.id}/${uploadAttemptId}/source.txt`;
    const activeReservation = {
      ...initialReservation,
      storagePath: attemptPath,
      uploadLeaseToken: attemptToken,
      uploadLeaseExpiresAt: attemptExpiry,
      uploadState: "uploading",
      uploadAttemptId,
    };
    let authorizeCalls = 0;
    let reservedManifest: Record<string, string | number> = {};
    let releaseUpload!: () => void;
    const uploadHeld = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const upload = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      await uploadHeld;
    });
    const abandon = vi.fn();
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async ({ manifest }: { manifest: Record<string, string | number> }) => {
        reservedManifest = manifest;
        return authorizeCalls === 0 ? initialReservation : activeReservation;
      }),
      authorizeUpload: vi.fn(async () => {
        authorizeCalls += 1;
        if (authorizeCalls > 1) throw new Error("Upload attempt is already claimed.");
        return {
          ...authorizedUploadState(activeReservation),
          upload_attempt_id: uploadAttemptId,
          reserved_storage_path: attemptPath,
          upload_lease_token: attemptToken,
          upload_lease_expires_at: attemptExpiry,
        };
      }),
      upload,
      finalize: vi.fn(async ({ manifest }: { manifest: Record<string, unknown> }) => {
        expect(manifest).toMatchObject({
          uploadAttemptId,
          reservedStoragePath: attemptPath,
          uploadLeaseToken: attemptToken,
          uploadLeaseExpiresAt: attemptExpiry,
        });
        return {
          id: initialReservation.id,
          lifecycle: "shadow",
          staging_document_id: initialReservation.reservedDocumentId,
        };
      }),
      lookup: vi.fn(async () => ({
        ...authorizedUploadState(activeReservation),
        upload_attempt_id: uploadAttemptId,
        reservation_key: reservedManifest.reservationKey,
        source_catalogue_key: plan.catalogueKey,
        source_policy_version: plan.sourcePolicyVersion,
        source_policy_digest: plan.sourcePolicyDigest,
        activation_event_id: plan.activationEventId,
        activation_sequence: plan.activationSequence,
        exact_canonical_url: australianSourceByKey(plan.catalogueKey)!.canonicalUrl,
        exact_version_url: plan.exactUrl,
        exact_version: plan.exactVersion,
        content_hash: fetched.contentHash,
        raw_response_hash: fetched.contentHash,
        raw_response_byte_count: fetched.byteCount,
        licence_evidence_digest: plan.licenceEvidenceDigest,
        intended_disposition: fetched.disposition,
      })),
      abandon,
    } as unknown as PublicSourceStagingDependencies;

    const first = stageFetchedPublicSource(plan, fetched, dependencies, { uploadTimeoutMs: 5_000 });
    void first.catch(() => undefined);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    await expect(
      stageFetchedPublicSource(plan, fetched, dependencies, { uploadTimeoutMs: 5_000 }),
    ).resolves.toMatchObject({ disposition: "in_progress" });
    expect(upload).toHaveBeenCalledOnce();
    expect(abandon).not.toHaveBeenCalled();
    releaseUpload();
    await expect(first).resolves.toMatchObject({ disposition: "shadow" });
  });

  it("does not adopt or abandon a discovered attempt after an ambiguous authorize response", async () => {
    const plan = await activePlan();
    const attemptToken = "88888888-8888-4888-8888-888888888888";
    const attemptExpiry = "2026-08-24T00:17:00.000Z";
    const attemptPath = `${stewardId}/public-source-staging/44444444-4444-4444-8444-444444444444/${uploadAttemptId}/source.txt`;
    const reservation = {
      id: "44444444-4444-4444-8444-444444444444",
      reservedDocumentId: "55555555-5555-4555-8555-555555555555",
      storagePath: attemptPath,
      stagingDocumentId: null,
      lifecycle: "discovered",
      ...reservationLease,
      uploadAttemptId,
      uploadLeaseToken: attemptToken,
      uploadLeaseExpiresAt: attemptExpiry,
      uploadState: "uploading",
    };
    const abandon = vi.fn();
    const upload = vi.fn();
    let reservedManifest: Record<string, string | number> = {};
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async ({ manifest }: { manifest: Record<string, string | number> }) => {
        reservedManifest = manifest;
        return reservation;
      }),
      authorizeUpload: vi.fn(async () => {
        throw new Error("response lost after exclusive claim may have committed");
      }),
      upload,
      finalize: vi.fn(),
      lookup: vi.fn(async () => ({
        ...authorizedUploadState(reservation),
        upload_attempt_id: uploadAttemptId,
        reservation_key: reservedManifest.reservationKey,
        source_catalogue_key: plan.catalogueKey,
        source_policy_version: plan.sourcePolicyVersion,
        source_policy_digest: plan.sourcePolicyDigest,
        activation_event_id: plan.activationEventId,
        activation_sequence: plan.activationSequence,
        exact_canonical_url: australianSourceByKey(plan.catalogueKey)!.canonicalUrl,
        exact_version_url: plan.exactUrl,
        exact_version: plan.exactVersion,
        content_hash: "4".repeat(64),
        raw_response_hash: "4".repeat(64),
        raw_response_byte_count: 12,
        licence_evidence_digest: plan.licenceEvidenceDigest,
        intended_disposition: "shadow",
      })),
      abandon,
    } as unknown as PublicSourceStagingDependencies;
    await expect(
      stageFetchedPublicSource(
        plan,
        {
          finalUrl: plan.exactUrl,
          contentHash: "4".repeat(64),
          byteCount: 12,
          mime: "text/plain",
          content: Buffer.from("clinical text"),
          disposition: "shadow",
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ disposition: "in_progress" });
    expect(upload).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
  });

  it("parses, bounds, and redacts the fixed two-hour signed-upload authority", () => {
    const path = `${stewardId}/public-source-staging/version/attempt/source.txt`;
    const now = 1_776_992_800;
    const fixture = signedUploadFixture(path, now + 7_200);
    expect(
      parseSignedPublicSourceUploadAuthority(fixture, {
        supabaseUrl: "https://offline-project.supabase.co",
        storageBucket: "offline-test",
        storagePath: path,
        nowEpochSeconds: now,
      }),
    ).toMatchObject({
      signedUrl: fixture.signedUrl,
      storagePath: path,
      expiresAt: new Date((now + 7_200) * 1_000).toISOString(),
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    for (const malformed of [
      signedUploadFixture(path, now - 1),
      signedUploadFixture(path, now + 7_261),
      { ...fixture, token: "not-a-jwt" },
      { ...fixture, path: `${path}.other` },
    ]) {
      expect(() =>
        parseSignedPublicSourceUploadAuthority(malformed, {
          supabaseUrl: "https://offline-project.supabase.co",
          storageBucket: "offline-test",
          storagePath: path,
          nowEpochSeconds: now,
        }),
      ).toThrow(/signed upload authority/i);
      try {
        parseSignedPublicSourceUploadAuthority(malformed, {
          supabaseUrl: "https://offline-project.supabase.co",
          storageBucket: "offline-test",
          storagePath: path,
          nowEpochSeconds: now,
        });
      } catch (error) {
        expect(String(error)).not.toContain(fixture.token);
        expect(String(error)).not.toContain(fixture.signedUrl);
      }
    }
  });

  it("uses the installed two-hour signed-upload primitive without privileged upload headers", () => {
    const installed = readFileSync("node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts", "utf8");
    expect(installed).toContain("They are valid for 2 hours.");
    expect(installed).toContain("async createSignedUploadUrl(");
    expect(installed).toContain("options?: { upsert: boolean }");
    const runtime = readFileSync("scripts/fetch-approved-public-source-versions.ts", "utf8");
    expect(runtime).toContain(".createSignedUploadUrl(storagePath, { upsert: false })");
    const transportStart = runtime.indexOf("export async function uploadPublicSourceWithSignedAuthority(");
    const transportEnd = runtime.indexOf("export function parsePublicSourceStorageBucket", transportStart);
    const transport = runtime.slice(transportStart, transportEnd);
    expect(transport).toContain('method: "PUT"');
    expect(transport).toContain('redirect: "error"');
    expect(transport).not.toContain("authorization");
    expect(transport).not.toContain("apikey");
    expect(transport).not.toContain("serviceRoleKey");
  });

  it("recovers a lost signed-authority bind only for the locally claimed exact attempt", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "d".repeat(64),
      byteCount: 12,
      mime: "text/plain" as const,
      content: Buffer.from("clinical text"),
      disposition: "shadow" as const,
    };
    const reservation = {
      id: "44444444-4444-4444-8444-444444444444",
      reservedDocumentId: "55555555-5555-4555-8555-555555555555",
      storagePath: `${stewardId}/public-source-staging/${uploadAttemptId}/reserved.txt`,
      stagingDocumentId: null,
      lifecycle: "discovered",
      ...reservationLease,
    };
    const claimedToken = "88888888-8888-4888-8888-888888888888";
    const claimedExpiry = new Date(Date.now() + 120_000).toISOString();
    const attemptPath = `${stewardId}/public-source-staging/${reservation.id}/${uploadAttemptId}/source.txt`;
    const authority = parseSignedPublicSourceUploadAuthority(
      signedUploadFixture(attemptPath, Math.floor(Date.now() / 1000) + 7_200),
      {
        supabaseUrl: "https://offline-project.supabase.co",
        storageBucket: "offline-test",
        storagePath: attemptPath,
      },
    );
    const order: string[] = [];
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async () => reservation),
      authorizeUpload: vi.fn(async () => {
        order.push("authorize");
        return {
          ...authorizedUploadState({
            ...reservation,
            storagePath: attemptPath,
            uploadLeaseToken: claimedToken,
            uploadLeaseExpiresAt: claimedExpiry,
          }),
          upload_attempt_id: uploadAttemptId,
        };
      }),
      createSignedUploadAuthority: vi.fn(async () => {
        order.push("sign");
        return authority;
      }),
      bindUploadAuthority: vi.fn(async () => {
        order.push("bind");
        throw new Error("response lost after bind commit");
      }),
      lookupAttempt: vi.fn(async () => ({
        id: uploadAttemptId,
        version_id: reservation.id,
        claim_token: claimedToken,
        storage_bucket: "offline-test",
        storage_path: attemptPath,
        signed_authority_digest: authority.digest,
        signed_authority_expires_at: authority.expiresAt,
        state: "bound",
      })),
      upload: vi.fn(async ({ signedAuthority }: { signedAuthority?: { digest: string } }) => {
        order.push("upload");
        expect(signedAuthority?.digest).toBe(authority.digest);
      }),
      finalize: vi.fn(async ({ manifest }: { manifest: Record<string, unknown> }) => {
        order.push("finalize");
        expect(manifest).toMatchObject({
          uploadAttemptId,
          uploadLeaseToken: claimedToken,
          reservedStoragePath: attemptPath,
          signedAuthorityDigest: authority.digest,
          signedAuthorityExpiresAt: authority.expiresAt,
        });
        expect(JSON.stringify(manifest)).not.toContain(new URL(authority.signedUrl).searchParams.get("token")!);
        expect(manifest).not.toHaveProperty("signedUrl");
        return { id: reservation.id, lifecycle: "shadow", staging_document_id: reservation.reservedDocumentId };
      }),
      lookup: vi.fn(),
      abandon: vi.fn(),
    } as unknown as PublicSourceStagingDependencies;
    await expect(stageFetchedPublicSource(plan, fetched, dependencies)).resolves.toMatchObject({
      disposition: "shadow",
    });
    expect(order).toEqual(["authorize", "sign", "bind", "upload", "finalize"]);
    expect(dependencies.abandon).not.toHaveBeenCalled();
  });

  it("uses only the signed attempt URL and lets Storage reject a suspended expired writer", async () => {
    const pathA = `${stewardId}/public-source-staging/version/attempt-a/source.txt`;
    const pathB = `${stewardId}/public-source-staging/version/attempt-b/source.txt`;
    const now = 1_776_992_800;
    const authorityA = parseSignedPublicSourceUploadAuthority(signedUploadFixture(pathA, now + 7_200), {
      supabaseUrl: "https://offline-project.supabase.co",
      storageBucket: "offline-test",
      storagePath: pathA,
      nowEpochSeconds: now,
    });
    let providerNow = now;
    const authorityB = parseSignedPublicSourceUploadAuthority(signedUploadFixture(pathB, now + 7_320), {
      supabaseUrl: "https://offline-project.supabase.co",
      storageBucket: "offline-test",
      storagePath: pathB,
      nowEpochSeconds: now + 120,
    });
    expect(authorityA.storagePath).not.toBe(authorityB.storagePath);
    const objects = new Set<string>();
    const signedEndpoint = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("PUT");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(new Headers(init?.headers).has("apikey")).toBe(false);
      const token = url.searchParams.get("token")!;
      const exp = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")).exp as number;
      if (providerNow >= exp) return new Response(null, { status: 401 });
      objects.add(url.pathname);
      return new Response(null, { status: 200 });
    });
    await uploadPublicSourceWithSignedAuthority(
      authorityA,
      Buffer.from("old attempt"),
      "text/plain",
      new AbortController().signal,
      signedEndpoint,
    );
    providerNow += 120; // the database lease expired and a new unique attempt was authorized
    await uploadPublicSourceWithSignedAuthority(
      authorityA,
      Buffer.from("still-valid old attempt"),
      "text/plain",
      new AbortController().signal,
      signedEndpoint,
    );
    await uploadPublicSourceWithSignedAuthority(
      authorityB,
      Buffer.from("new attempt"),
      "text/plain",
      new AbortController().signal,
      signedEndpoint,
    );
    expect(objects.size).toBe(2);

    providerNow = now + 7_200 + 360; // signed expiry plus upload bound and cleanup grace
    objects.delete(new URL(authorityA.signedUrl).pathname); // database-clock janitor cleanup
    await expect(
      uploadPublicSourceWithSignedAuthority(
        authorityA,
        Buffer.from("suspended stale writer"),
        "text/plain",
        new AbortController().signal,
        signedEndpoint,
      ),
    ).rejects.toThrow(/storage write failed/i);
    expect(objects).toEqual(new Set([new URL(authorityB.signedUrl).pathname]));

    const rawToken = new URL(authorityA.signedUrl).searchParams.get("token")!;
    try {
      await uploadPublicSourceWithSignedAuthority(
        authorityA,
        Buffer.from("clinical text"),
        "text/plain",
        new AbortController().signal,
        vi.fn(async () => {
          throw new Error(`transport rejected ${authorityA.signedUrl}`);
        }),
      );
    } catch (error) {
      expect(String(error)).toMatch(/storage write failed/i);
      expect(String(error)).not.toContain(rawToken);
      expect(String(error)).not.toContain(authorityA.signedUrl);
    }
  });

  it("aborts and settles a held upload before abandonment when its total timeout expires", async () => {
    vi.useFakeTimers();
    try {
      const plan = await activePlan();
      const reservation = {
        id: "44444444-4444-4444-8444-444444444444",
        reservedDocumentId: "55555555-5555-4555-8555-555555555555",
        storagePath: `${stewardId}/public-source-staging/timeout/source.txt`,
        stagingDocumentId: null,
        lifecycle: "discovered",
        ...reservationLease,
      };
      const attemptToken = "99999999-9999-4999-8999-999999999999";
      const events: string[] = [];
      let reservedManifest: Record<string, string | number> = {};
      const dependencies = {
        storageBucket: "offline-test",
        reserve: vi.fn(async ({ manifest }: { manifest: Record<string, string | number> }) => {
          reservedManifest = manifest;
          return reservation;
        }),
        authorizeUpload: vi.fn(async () => ({
          ...authorizedUploadState(reservation),
          upload_lease_token: attemptToken,
        })),
        upload: vi.fn(
          ({ signal }: { signal: AbortSignal }) =>
            new Promise<void>((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  events.push("transport-aborted");
                  reject(signal.reason);
                },
                { once: true },
              );
            }),
        ),
        finalize: vi.fn(),
        lookup: vi.fn(async () => ({
          id: reservation.id,
          lifecycle: "discovered",
          staging_document_id: null,
          reservation_key: reservedManifest.reservationKey,
          source_catalogue_key: plan.catalogueKey,
          source_policy_version: plan.sourcePolicyVersion,
          source_policy_digest: plan.sourcePolicyDigest,
          activation_event_id: plan.activationEventId,
          activation_sequence: plan.activationSequence,
          exact_canonical_url: australianSourceByKey(plan.catalogueKey)!.canonicalUrl,
          exact_version_url: plan.exactUrl,
          exact_version: plan.exactVersion,
          content_hash: "2".repeat(64),
          raw_response_hash: "2".repeat(64),
          raw_response_byte_count: 12,
          licence_evidence_digest: plan.licenceEvidenceDigest,
          steward_id: plan.stewardId,
          intended_disposition: "shadow",
          reserved_document_id: reservation.reservedDocumentId,
          reserved_storage_path: reservation.storagePath,
          storage_bucket: reservation.storageBucket,
          upload_lease_token: attemptToken,
          upload_lease_expires_at: reservation.uploadLeaseExpiresAt,
          upload_state: "uploading",
        })),
        abandon: vi.fn(async ({ manifest }: { manifest: Record<string, unknown> }) => {
          events.push("abandon");
          expect(manifest.uploadLeaseToken).toBe(attemptToken);
          return { status: "abandoned", storagePath: reservation.storagePath, storageOwned: false };
        }),
      } as unknown as PublicSourceStagingDependencies;
      const operation = stageFetchedPublicSource(
        plan,
        {
          finalUrl: plan.exactUrl,
          contentHash: "2".repeat(64),
          byteCount: 12,
          mime: "text/plain",
          content: Buffer.from("clinical text"),
          disposition: "shadow",
        },
        dependencies,
        { uploadTimeoutMs: 25 },
      );
      void operation.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(25);
      await expect(operation).rejects.toThrow(/abandon|cleanup/i);
      expect(events).toEqual(["transport-aborted", "abandon"]);
      expect(dependencies.finalize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates caller abort to the storage transport and never finalizes", async () => {
    const plan = await activePlan();
    const controller = new AbortController();
    const reservation = {
      id: "44444444-4444-4444-8444-444444444444",
      reservedDocumentId: "55555555-5555-4555-8555-555555555555",
      storagePath: `${stewardId}/public-source-staging/caller-abort/source.txt`,
      stagingDocumentId: null,
      lifecycle: "discovered",
      ...reservationLease,
    };
    let transportAborted = false;
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async () => reservation),
      authorizeUpload: vi.fn(async () => authorizedUploadState(reservation)),
      upload: vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                transportAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      ),
      finalize: vi.fn(),
      lookup: vi.fn(async () => null),
    } as unknown as PublicSourceStagingDependencies;
    const operation = stageFetchedPublicSource(
      plan,
      {
        finalUrl: plan.exactUrl,
        contentHash: "3".repeat(64),
        byteCount: 12,
        mime: "text/plain",
        content: Buffer.from("clinical text"),
        disposition: "shadow",
      },
      dependencies,
      { signal: controller.signal, uploadTimeoutMs: 5_000 },
    );
    void operation.catch(() => undefined);
    await vi.waitFor(() => expect(dependencies.upload).toHaveBeenCalledOnce());
    controller.abort(new Error("caller cancelled"));
    await expect(operation).rejects.toThrow(/finalization|storage/i);
    expect(transportAborted).toBe(true);
    expect(dependencies.finalize).not.toHaveBeenCalled();
  });

  it("recovers ambiguous finalization from legal committed descendant lifecycles", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "c".repeat(64),
      byteCount: 12,
      mime: "text/plain" as const,
      content: Buffer.from("clinical text"),
      text: "clinical text",
      disposition: "shadow" as const,
    };
    let reservedManifest: Record<string, string | number> = {};
    const reservation = {
      id: "44444444-4444-4444-8444-444444444444",
      reservedDocumentId: "55555555-5555-4555-8555-555555555555",
      storagePath: `${stewardId}/public-source-staging/descendant/source.txt`,
      stagingDocumentId: null,
      lifecycle: "discovered",
      ...reservationLease,
    };
    const lookup = vi.fn(async () => ({
      id: reservation.id,
      lifecycle: "active",
      staging_document_id: reservation.reservedDocumentId,
      reservation_key: reservedManifest.reservationKey,
      source_catalogue_key: plan.catalogueKey,
      source_policy_version: plan.sourcePolicyVersion,
      source_policy_digest: plan.sourcePolicyDigest,
      activation_event_id: plan.activationEventId,
      activation_sequence: plan.activationSequence,
      exact_canonical_url: australianSourceByKey(plan.catalogueKey)!.canonicalUrl,
      exact_version_url: plan.exactUrl,
      exact_version: plan.exactVersion,
      content_hash: fetched.contentHash,
      raw_response_hash: fetched.contentHash,
      raw_response_byte_count: fetched.byteCount,
      licence_evidence_digest: plan.licenceEvidenceDigest,
      steward_id: plan.stewardId,
      intended_disposition: fetched.disposition,
      reserved_document_id: reservation.reservedDocumentId,
      reserved_storage_path: reservation.storagePath,
      storage_bucket: reservation.storageBucket,
      upload_lease_token: reservation.uploadLeaseToken,
      upload_lease_expires_at: reservation.uploadLeaseExpiresAt,
      upload_state: "finalized",
    }));
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async ({ manifest }: { manifest: Record<string, string | number> }) => {
        reservedManifest = manifest;
        return reservation;
      }),
      authorizeUpload: vi.fn(async () => authorizedUploadState(reservation)),
      upload: vi.fn(async () => undefined),
      finalize: vi.fn(async () => {
        throw new Error("ambiguous after commit");
      }),
      lookup,
      abandon: vi.fn(),
      remove: vi.fn(),
    } as unknown as PublicSourceStagingDependencies;
    await expect(stageFetchedPublicSource(plan, fetched, dependencies)).resolves.toMatchObject({
      version: { lifecycle: "active", staging_document_id: reservation.reservedDocumentId },
    });
    expect(lookup).toHaveBeenCalledOnce();
    expect((dependencies as unknown as { abandon: ReturnType<typeof vi.fn> }).abandon).not.toHaveBeenCalled();
    expect((dependencies as unknown as { remove: ReturnType<typeof vi.fn> }).remove).not.toHaveBeenCalled();
  });

  it("abandons only a definitively unowned reservation before durable cleanup", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "b".repeat(64),
      byteCount: 12,
      mime: "text/plain" as const,
      content: Buffer.from("clinical text"),
      text: "clinical text",
      disposition: "shadow" as const,
    };
    const calls: string[] = [];
    let reservedManifest: Record<string, string | number> = {};
    const reservation = {
      id: "44444444-4444-4444-8444-444444444444",
      reservedDocumentId: "55555555-5555-4555-8555-555555555555",
      storagePath: `${stewardId}/public-source-staging/abandon/source.txt`,
      stagingDocumentId: null,
      lifecycle: "discovered",
      ...reservationLease,
    };
    const recoveryState = () => ({
      id: reservation.id,
      lifecycle: "discovered",
      staging_document_id: null,
      reservation_key: reservedManifest.reservationKey,
      source_catalogue_key: plan.catalogueKey,
      source_policy_version: plan.sourcePolicyVersion,
      source_policy_digest: plan.sourcePolicyDigest,
      activation_event_id: plan.activationEventId,
      activation_sequence: plan.activationSequence,
      exact_canonical_url: australianSourceByKey(plan.catalogueKey)!.canonicalUrl,
      exact_version_url: plan.exactUrl,
      exact_version: plan.exactVersion,
      content_hash: fetched.contentHash,
      raw_response_hash: fetched.contentHash,
      raw_response_byte_count: fetched.byteCount,
      licence_evidence_digest: plan.licenceEvidenceDigest,
      steward_id: plan.stewardId,
      intended_disposition: fetched.disposition,
      reserved_document_id: reservation.reservedDocumentId,
      reserved_storage_path: reservation.storagePath,
      storage_bucket: reservation.storageBucket,
      upload_lease_token: reservation.uploadLeaseToken,
      upload_lease_expires_at: reservation.uploadLeaseExpiresAt,
      upload_state: "uploading",
    });
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async ({ manifest }: { manifest: Record<string, string | number> }) => {
        calls.push("reserve");
        reservedManifest = manifest;
        return reservation;
      }),
      authorizeUpload: vi.fn(async () => {
        calls.push("authorize");
        return authorizedUploadState(reservation);
      }),
      upload: vi.fn(async () => calls.push("upload")),
      finalize: vi.fn(async () => {
        calls.push("finalize");
        throw new Error("authority revoked before finalize");
      }),
      lookup: vi.fn(async () => {
        calls.push("lookup");
        return recoveryState();
      }),
      abandon: vi.fn(async () => {
        calls.push("abandon");
        return { status: "abandoned", storagePath: reservation.storagePath, storageOwned: false };
      }),
      remove: vi.fn(async () => calls.push("remove")),
    } as unknown as PublicSourceStagingDependencies;
    await expect(stageFetchedPublicSource(plan, fetched, dependencies)).rejects.toThrow(/abandon|fresh authority/i);
    expect(calls).toEqual(["reserve", "authorize", "upload", "finalize", "lookup", "abandon"]);
  });

  it("rechecks an ambiguous abandonment and relies only on its durable cleanup result", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "6".repeat(64),
      byteCount: 12,
      mime: "text/plain" as const,
      content: Buffer.from("clinical text"),
      text: "clinical text",
      disposition: "shadow" as const,
    };
    let manifest: Record<string, string | number> = {};
    let lookupCount = 0;
    const reservation = {
      id: "44444444-4444-4444-8444-444444444444",
      reservedDocumentId: "55555555-5555-4555-8555-555555555555",
      storagePath: `${stewardId}/public-source-staging/ambiguous-abandon/source.txt`,
      stagingDocumentId: null,
      lifecycle: "discovered",
      ...reservationLease,
    };
    const state = (lifecycle: string) => ({
      id: reservation.id,
      lifecycle,
      staging_document_id: null,
      reservation_key: manifest.reservationKey as string,
      source_catalogue_key: plan.catalogueKey,
      source_policy_version: plan.sourcePolicyVersion,
      source_policy_digest: plan.sourcePolicyDigest,
      activation_event_id: plan.activationEventId,
      activation_sequence: plan.activationSequence,
      exact_canonical_url: australianSourceByKey(plan.catalogueKey)!.canonicalUrl,
      exact_version_url: plan.exactUrl,
      exact_version: plan.exactVersion,
      content_hash: fetched.contentHash,
      raw_response_hash: fetched.contentHash,
      raw_response_byte_count: fetched.byteCount,
      licence_evidence_digest: plan.licenceEvidenceDigest,
      steward_id: plan.stewardId,
      intended_disposition: fetched.disposition,
      reserved_document_id: reservation.reservedDocumentId,
      reserved_storage_path: reservation.storagePath,
      storage_bucket: reservation.storageBucket,
      upload_lease_token: reservation.uploadLeaseToken,
      upload_lease_expires_at: reservation.uploadLeaseExpiresAt,
      upload_state: lifecycle === "abandoned" ? "cleanup_pending" : "uploading",
    });
    const abandon = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost after commit"))
      .mockResolvedValueOnce({ status: "abandoned", storagePath: reservation.storagePath, storageOwned: false });
    const remove = vi.fn(async () => undefined);
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async ({ manifest: reserved }: { manifest: Record<string, string | number> }) => {
        manifest = reserved;
        return reservation;
      }),
      authorizeUpload: vi.fn(async () => authorizedUploadState(reservation)),
      upload: vi.fn(async () => undefined),
      finalize: vi.fn(async () => {
        throw new Error("authority revoked");
      }),
      lookup: vi.fn(async () => state(lookupCount++ === 0 ? "discovered" : "abandoned")),
      abandon,
      remove,
    } as unknown as PublicSourceStagingDependencies;
    await expect(stageFetchedPublicSource(plan, fetched, dependencies)).rejects.toThrow(/abandon|fresh authority/i);
    expect(abandon).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects mismatched recovery identity and never cleans up after an ambiguous lookup", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "9".repeat(64),
      byteCount: 12,
      mime: "text/plain" as const,
      content: Buffer.from("clinical text"),
      text: "clinical text",
      disposition: "shadow" as const,
    };
    const abandon = vi.fn();
    const remove = vi.fn();
    const dependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async () => ({
        id: "44444444-4444-4444-8444-444444444444",
        reservedDocumentId: "55555555-5555-4555-8555-555555555555",
        storagePath: `${stewardId}/public-source-staging/mismatch/source.txt`,
        stagingDocumentId: null,
        lifecycle: "discovered",
        ...reservationLease,
      })),
      authorizeUpload: vi.fn(async () =>
        authorizedUploadState({
          id: "44444444-4444-4444-8444-444444444444",
          reservedDocumentId: "55555555-5555-4555-8555-555555555555",
          storagePath: `${stewardId}/public-source-staging/mismatch/source.txt`,
          ...reservationLease,
        }),
      ),
      upload: vi.fn(async () => undefined),
      finalize: vi.fn(async () => {
        throw new Error("ambiguous finalize");
      }),
      lookup: vi.fn(async () => {
        throw new Error("ambiguous recovery lookup");
      }),
      abandon,
      remove,
    } as unknown as PublicSourceStagingDependencies;
    await expect(stageFetchedPublicSource(plan, fetched, dependencies)).rejects.toThrow(/recovery|lookup|ambiguous/i);
    expect(abandon).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not accept a bound recovery row whose immutable hash or reservation identity changed", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "8".repeat(64),
      byteCount: 12,
      mime: "text/plain" as const,
      content: Buffer.from("clinical text"),
      text: "clinical text",
      disposition: "shadow" as const,
    };
    const documentId = "55555555-5555-4555-8555-555555555555";
    const dependencies: PublicSourceStagingDependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async () => ({
        id: "44444444-4444-4444-8444-444444444444",
        reservedDocumentId: documentId,
        storagePath: `${stewardId}/public-source-staging/mismatch/source.txt`,
        stagingDocumentId: null,
        lifecycle: "discovered",
        ...reservationLease,
      })),
      authorizeUpload: vi.fn(async () =>
        authorizedUploadState({
          id: "44444444-4444-4444-8444-444444444444",
          reservedDocumentId: documentId,
          storagePath: `${stewardId}/public-source-staging/mismatch/source.txt`,
          ...reservationLease,
        }),
      ),
      upload: vi.fn(async () => undefined),
      finalize: vi.fn(async () => {
        throw new Error("ambiguous finalize");
      }),
      lookup: vi.fn(async () => ({
        id: "44444444-4444-4444-8444-444444444444",
        lifecycle: "shadow",
        staging_document_id: documentId,
        reservation_key: "wrong-reservation-key",
        content_hash: "7".repeat(64),
      })),
    };
    await expect(stageFetchedPublicSource(plan, fetched, dependencies)).rejects.toThrow(/identity|recovery|committed/i);
  });

  it("does not upload a finalized retry or expose a destructive cleanup dependency", async () => {
    const plan = await activePlan();
    const fetched = {
      finalUrl: plan.exactUrl,
      contentHash: "e".repeat(64),
      byteCount: 12,
      mime: "text/plain",
      content: Buffer.from("clinical text"),
      disposition: "shadow" as const,
    };
    const upload = vi.fn();
    const finalize = vi.fn();
    const lookup = vi.fn();
    const dependencies: PublicSourceStagingDependencies = {
      storageBucket: "offline-test",
      reserve: vi.fn(async () => ({
        id: "44444444-4444-4444-8444-444444444444",
        reservedDocumentId: "55555555-5555-4555-8555-555555555555",
        storagePath: `${stewardId}/public-source-staging/final/source.txt`,
        stagingDocumentId: "55555555-5555-4555-8555-555555555555",
        lifecycle: "shadow",
        ...reservationLease,
      })),
      authorizeUpload: vi.fn(async () => undefined as never),
      upload,
      finalize,
      lookup,
    };
    await expect(stageFetchedPublicSource(plan, fetched, dependencies)).resolves.toMatchObject({
      disposition: "duplicate",
    });
    expect(upload).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(dependencies).not.toHaveProperty("remove");
  });

  it("keeps plan and change CLI imports behind direct-entry guards", () => {
    for (const file of ["scripts/plan-public-source-acquisition.ts", "scripts/check-public-source-changes.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/isDirectEntrypoint|import \{ pathToFileURL \} from "node:url"/);
      expect(source).toMatch(/isDirectEntrypoint|import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
    }
  });

  it("requires every explicit fetch confirmation while keeping dry-run arguments network-free", async () => {
    const plan = (await activePlan()) as PublicSourceAcquisitionPlan;
    const digest = acquisitionPlanDigest(plan);
    expect(parseFetchApprovedSourceArgs(["--manifest", "plan.json"])).toEqual({
      manifestPath: "plan.json",
      apply: false,
    });
    expect(() => parseFetchApprovedSourceArgs(["--manifest", "plan.json", "--apply"])).toThrow(/expected-count/i);
    expect(() =>
      parseFetchApprovedSourceArgs([
        "--manifest",
        "plan.json",
        "--expected-count",
        "1",
        "--confirm-sha256",
        digest,
        "--apply",
      ]),
    ).not.toThrow();
  });
});
