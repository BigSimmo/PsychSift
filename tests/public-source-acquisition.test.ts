import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import JSZip from "jszip";
import { afterAll, describe, expect, it, vi } from "vitest";

import { australianSourceByKey } from "@/lib/australian-source-catalogue";
import {
  australianSourcePolicyDigest,
  buildPublicSourceActivationManifest,
} from "@/lib/public-source-activation-manifest";
import {
  acquirePublicSourceVersion,
  buildPublicSourceStagingCandidate,
  checkPublicSourceChange,
  evaluateTrustedPageContent,
  planAcquisition,
  validateAcquisitionUrl,
  validateRedirect,
  type PublicSourceAcquisitionPlan,
  type PublicSourceContentIdentityScan,
  type PublicSourceStagingCandidate,
} from "@/lib/public-source-acquisition";
import { runCheckPublicSourceChangesCli } from "../scripts/check-public-source-changes";
import {
  createLivePublicSourceApplyDependencies,
  runFetchApprovedPublicSourceVersionsCli,
} from "../scripts/fetch-approved-public-source-versions";
import {
  publicSourceAcquisitionManifestDigest,
  runPlanPublicSourceAcquisitionCli,
} from "../scripts/plan-public-source-acquisition";
import { forbiddenPublicSourceIdentity } from "../supabase/functions/_shared/public-source-policy";

const ownerId = "11111111-1111-4111-8111-111111111111";
const operatorId = "22222222-2222-4222-8222-222222222222";
const exactUrl = "https://www.health.wa.gov.au/guidelines/synthetic-guideline.pdf";
const publicAddress = [{ address: "8.8.8.8", family: 4 as const }];
const cliWorkdir = mkdtempSync(join(tmpdir(), "public-source-cli-"));
const trustedVerdictVersion = "public-source-content-identity-v1";
const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

function syntheticCompressedPdf(protectedText: string) {
  return Buffer.concat([
    Buffer.from("%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode /Length "),
    Buffer.from(String(deflateSync(protectedText).byteLength)),
    Buffer.from(" >>\nstream\n"),
    deflateSync(protectedText),
    Buffer.from("\nendstream\nendobj\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n"),
  ]);
}

async function syntheticCompressedDocx(protectedText: string) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${protectedText}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function response(body: Uint8Array | string, init: ResponseInit = {}) {
  return new Response(body instanceof Uint8Array ? Uint8Array.from(body).buffer : body, {
    status: 200,
    headers: { "content-type": "application/pdf", ...init.headers },
    ...init,
  });
}

function connectedResponse(value: Response, remoteAddress = publicAddress[0]!.address) {
  return { response: value, remoteAddress };
}

const trustedClearScan: PublicSourceContentIdentityScan = async (input) => {
  return {
    accepted: true as const,
    contentIdentity: "clear" as const,
    inspectedContentHash: input.contentHash,
    verdictVersion: trustedVerdictVersion,
  };
};

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

  it("rejects fragments and secret-bearing query keys without echoing the URL, but permits reviewed public params", async () => {
    const secret = "secret-value";
    const unsafeUrl = `${exactUrl}?token=${secret}#ignored`;
    let thrown: unknown;
    try {
      await planAcquisition({
        catalogueKey: "wa-health",
        url: unsafeUrl,
        exactVersion: "2026-08-20",
        exactDocumentLicence: "public_index_permitted",
        licenceEvidenceDigest: `sha256:${"a".repeat(64)}`,
        stagingOwnerId: ownerId,
        activationManifest: activationManifest(),
      });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toMatch(/fragment|query|url/i);
    expect(String(thrown)).not.toContain(secret);
    expect(String(thrown)).not.toContain(unsafeUrl);

    await expect(validPlan({ url: `${exactUrl}?version=2026-08-20&page=1` })).resolves.toMatchObject({
      exactUrl: `${exactUrl}?version=2026-08-20&page=1`,
    });
    for (const key of ["signature", "api_key", "credential", "password", "secret", "authorization"]) {
      await expect(validPlan({ url: `${exactUrl}?${key}=private` })).rejects.toThrow(/query|url/i);
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
        scan: trustedClearScan,
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
    const scan = vi.fn(trustedClearScan);
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
      scan: vi.fn(trustedClearScan),
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

  it("resumes only the exact owned shadow while true duplicate conflicts remain blocked", async () => {
    const fetch = vi.fn(async () => connectedResponse(response(syntheticPdf())));
    const stageOwnedDocument = vi.fn(async () => ({
      outcome: "conflict" as const,
      documentId: "33333333-3333-4333-8333-333333333333",
      versionId: "66666666-6666-4666-8666-666666666666",
      ownerId,
    }));
    const enqueue = vi.fn();
    const deps = {
      fetch,
      resolve: async () => publicAddress,
      scan: trustedClearScan,
      findDuplicateVersion: async () => "existing-version-id",
      stageOwnedDocument,
      enqueue,
    };
    await expect(acquirePublicSourceVersion(await validPlan(), deps)).rejects.toThrow(/duplicate/i);
    expect(stageOwnedDocument).toHaveBeenCalledTimes(1);
    stageOwnedDocument.mockClear();
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
        scan: trustedClearScan,
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
        scan: trustedClearScan,
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

  it("rejects protected identities split by markup, entities, punctuation, and whitespace", () => {
    for (const protectedText of [
      "Health<em>direct</em>",
      "Health direct",
      "Health&amp;direct",
      "Health&Tab;direct",
      "Health&NewLine;direct",
      "Health&#9direct",
      "Health&#9 direct",
      "Health&nbsp direct",
      "Health&#100;irect",
      "Health&#x64;irect",
      "Health&#100irect",
      "Health&#x64irect",
      "Health&#0;direct",
      "Health&#1;direct",
      "Health&#55296;direct",
      "Health&#x110000;direct",
      "Australian Medicines Hand-book",
      "Australian Medicines Hand book",
      "Australian Medicines&Tab;Handbook",
      "Australian Medicines&#9Handbook",
      "Australian Medicines Hand&#98;ook",
      "Therapeutic\u200bGuidelines",
      "Therapeutic&NewLine;Guidelines",
      "Therapeutic&#10Guidelines",
      "Therapeutic Guide&#108;ines",
    ]) {
      expect(forbiddenPublicSourceIdentity(protectedText)).not.toBeNull();
      expect(evaluateTrustedPageContent(`<main>${protectedText}</main>`)).toMatchObject({
        eligibleForIndex: false,
        disposition: "quarantine",
      });
    }
  });

  it("rejects non-identity transport encoding before scanning or staging", async () => {
    const scan = vi.fn(trustedClearScan);
    const stageOwnedDocument = vi.fn();
    const compressed = gzipSync(syntheticPdf());
    await expect(
      acquirePublicSourceVersion(await validPlan(), {
        fetch: async () =>
          connectedResponse(
            response(compressed, {
              headers: { "content-type": "application/pdf", "content-encoding": "gzip" },
            }),
          ),
        resolve: async () => publicAddress,
        scan,
        findDuplicateVersion: async () => null,
        stageOwnedDocument,
        enqueue: vi.fn(),
      }),
    ).rejects.toThrow(/content.encoding|identity|compressed/i);
    expect(scan).not.toHaveBeenCalled();
    expect(stageOwnedDocument).not.toHaveBeenCalled();

    const liveSource = readFileSync(
      new URL("../scripts/fetch-approved-public-source-versions.ts", import.meta.url),
      "utf8",
    );
    expect(liveSource).toContain('"accept-encoding": "identity"');
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
          scan: async (input) =>
            contentType === "application/pdf"
              ? {
                  accepted: false as const,
                  contentIdentity: "protected" as const,
                  inspectedContentHash: input.contentHash,
                  verdictVersion: trustedVerdictVersion,
                  reasonCode: "protected_source_identity" as const,
                }
              : trustedClearScan(input),
          findDuplicateVersion: async () => null,
          stageOwnedDocument,
          enqueue,
        }),
      ).rejects.toThrow(/protected|link-only|quarantine|content-identity|blocked/i);
    }
    expect(stageOwnedDocument).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails closed on opaque compressed PDF and OOXML without an exact trusted content-identity verdict", async () => {
    const protectedText = "Australian Medicines Handbook protected excerpt";
    const compressedPdf = syntheticCompressedPdf(protectedText);
    const compressedDocx = await syntheticCompressedDocx(protectedText);
    expect(new TextDecoder().decode(compressedPdf)).not.toContain(protectedText);
    expect(new TextDecoder().decode(compressedDocx)).not.toContain(protectedText);

    for (const [contentType, bytes] of [
      ["application/pdf", compressedPdf],
      [docxMime, compressedDocx],
    ] as const) {
      expect(new TextDecoder().decode(bytes)).not.toMatch(
        /healthdirect|\b(?:etg|therapeutic\s+guidelines?)\b|\b(?:amh|australian\s+medicines\s+handbook)\b/i,
      );
      const stageOwnedDocument = vi.fn(async () => ({
        documentId: "33333333-3333-4333-8333-333333333333",
        ownerId,
      }));
      const enqueue = vi.fn();
      await expect(
        acquirePublicSourceVersion(await validPlan({ allowedContentTypes: [contentType] }), {
          fetch: async () => connectedResponse(response(bytes, { headers: { "content-type": contentType } })),
          resolve: async () => publicAddress,
          scan: async ({ bytes: inspectedBytes }) => ({
            accepted: true as const,
            contentIdentity: "unknown" as const,
            inspectedContentHash: `sha256:${createHash("sha256").update(inspectedBytes).digest("hex")}`,
            verdictVersion: trustedVerdictVersion,
          }),
          findDuplicateVersion: async () => null,
          stageOwnedDocument,
          enqueue,
        }),
      ).rejects.toThrow(/trusted|identity|unknown|validation/i);
      expect(stageOwnedDocument).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    }
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
      scan: trustedClearScan,
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
    expect(candidate).toMatchObject({
      sourceContentHash: upstreamHash,
      sourceContentType: "text/html",
      sourceByteLength: upstreamBytes.byteLength,
    });
  });

  it("never exposes unsanitized upstream HTML bytes to the live storage boundary", async () => {
    const fixture = readFileSync(
      new URL("./fixtures/public-sources/trusted-page-with-healthdirect-chrome.html", import.meta.url),
      "utf8",
    );
    const upstreamBytes = new TextEncoder().encode(fixture);
    const upstreamHash = `sha256:${createHash("sha256").update(upstreamBytes).digest("hex")}`;
    let candidate: PublicSourceStagingCandidate | undefined;

    await acquirePublicSourceVersion(await validPlan({ allowedContentTypes: ["text/html"] }), {
      fetch: async () => connectedResponse(response(upstreamBytes, { headers: { "content-type": "text/html" } })),
      resolve: async () => publicAddress,
      scan: trustedClearScan,
      findDuplicateVersion: async () => null,
      stageOwnedDocument: async (value) => {
        candidate = value;
        return { documentId: "33333333-3333-4333-8333-333333333333", ownerId };
      },
      enqueue: async () => undefined,
    });

    expect(candidate).toBeDefined();
    expect("sourceBytes" in candidate!).toBe(false);
    const byteValues = Object.values(candidate!).filter((value): value is Uint8Array => value instanceof Uint8Array);
    expect(byteValues).toHaveLength(1);
    expect(new TextDecoder().decode(byteValues[0])).not.toMatch(/healthdirect|therapeutic guidelines|\bamh\b/i);
    expect(candidate!.metadata).toMatchObject({
      source_content_hash: upstreamHash,
      source_content_type: "text/html",
      source_content_byte_length: String(upstreamBytes.byteLength),
      source_content_provenance: "digest_only",
    });

    const liveAdapter = readFileSync(
      new URL("../scripts/fetch-approved-public-source-versions.ts", import.meta.url),
      "utf8",
    );
    expect(liveAdapter).not.toContain("candidate.sourceBytes");
    expect([...liveAdapter.matchAll(/\.upload\(/g)]).toHaveLength(1);
  });

  it("stages only retained trusted-page text and quarantines a retained excluded-source marker", async () => {
    const fixture = readFileSync(
      new URL("./fixtures/public-sources/trusted-page-with-healthdirect-chrome.html", import.meta.url),
      "utf8",
    );
    const scan = vi.fn(trustedClearScan);
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
      scan: trustedClearScan,
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
    const tombstoneAndQueueReview = vi.fn(async () => undefined);
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
          lifecycle: "active",
        },
        observed: { kind: "content", contentHash: `sha256:${"b".repeat(64)}` },
        recordCheck,
        stageChangedVersion,
        tombstoneAndQueueReview,
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
          lifecycle: "active",
        },
        observed: { kind: "content", contentHash: `sha256:${"c".repeat(64)}` },
        recordCheck,
        stageChangedVersion,
        tombstoneAndQueueReview,
      }),
    ).resolves.toMatchObject({ outcome: "changed", lifecycle: "shadow", ownerId });
    expect(stageChangedVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle: "shadow",
        ownerId,
        supersedesVersionId: "version-current",
        activate: false,
      }),
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
          lifecycle: "active",
        },
        observed: { kind: "withdrawn", reasonCode: "publisher_http_410" },
        recordCheck,
        stageChangedVersion,
        tombstoneAndQueueReview,
      }),
    ).resolves.toEqual({ outcome: "tombstoned" });
    expect(tombstoneAndQueueReview).toHaveBeenCalledTimes(1);
  });

  it("commits withdrawal tombstone and durable review queueing through one atomic retry-safe boundary", async () => {
    const plan = await validPlan();
    const tombstoneAndQueueReview = vi.fn(async () => ({ outcome: "tombstoned" as const }));

    await expect(
      checkPublicSourceChange({
        plan,
        currentVersion: {
          catalogueKey: plan.catalogueKey,
          versionId: "55555555-5555-4555-8555-555555555555",
          exactUrl: plan.exactUrl,
          exactVersion: plan.exactVersion,
          contentHash: `sha256:${"b".repeat(64)}`,
          lifecycle: "active",
        },
        observed: { kind: "withdrawn", reasonCode: "publisher_http_410" },
        recordCheck: vi.fn(),
        stageChangedVersion: vi.fn(),
        tombstoneAndQueueReview,
      }),
    ).resolves.toEqual({ outcome: "tombstoned" });
    expect(tombstoneAndQueueReview).toHaveBeenCalledTimes(1);
  });

  it("rejects a cross-catalogue current-version identity before a withdrawal tombstone", async () => {
    const tombstoneAndQueueReview = vi.fn();
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
          lifecycle: "active",
        },
        observed: { kind: "withdrawn", reasonCode: "publisher_http_410" },
        recordCheck: vi.fn(),
        stageChangedVersion: vi.fn(),
        tombstoneAndQueueReview,
      }),
    ).rejects.toThrow(/catalogue|identity/i);
    expect(tombstoneAndQueueReview).not.toHaveBeenCalled();
  });

  it("maps arbitrary scanner and live-adapter diagnostics to fixed public-source error codes", async () => {
    const sentinel = "SENTINEL-PROTECTED-CONTENT-AND-SECRET";
    let caught: unknown;
    try {
      await acquirePublicSourceVersion(await validPlan(), {
        fetch: async () => connectedResponse(response(syntheticPdf())),
        resolve: async () => publicAddress,
        scan: async ({ contentHash }) => ({
          accepted: false as const,
          contentIdentity: "unknown" as const,
          inspectedContentHash: contentHash,
          verdictVersion: trustedVerdictVersion,
          reasonCode: sentinel as never,
        }),
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

  it("maps malformed plan, manifest, and current JSON to fixed content-free CLI errors", async () => {
    const sentinel = "SENTINEL_SECRET_PAYLOAD_NOT_JSON";
    const malformedInput = join(cliWorkdir, "malformed-input.json");
    const malformedManifest = join(cliWorkdir, "malformed-manifest.json");
    const malformedCurrent = join(cliWorkdir, "malformed-current.json");
    writeFileSync(malformedInput, sentinel);
    writeFileSync(malformedManifest, sentinel);
    writeFileSync(malformedCurrent, sentinel);

    const errors: unknown[] = [];
    for (const operation of [
      () => runPlanPublicSourceAcquisitionCli(["--input", malformedInput]),
      () => runFetchApprovedPublicSourceVersionsCli(["--manifest", malformedManifest]),
      async () => {
        const plan = await validPlan({ sourceActivationEventId: "44444444-4444-4444-8444-444444444444" });
        const validManifest = join(cliWorkdir, "valid-for-malformed-current.json");
        writeFileSync(
          validManifest,
          JSON.stringify({ schemaVersion: "public-source-acquisition-manifest-v1", plans: [plan] }),
        );
        return runCheckPublicSourceChangesCli(["--manifest", validManifest, "--current", malformedCurrent]);
      },
    ]) {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    }
    expect(errors).toHaveLength(3);
    for (const error of errors) {
      expect(String(error)).not.toContain(sentinel);
      expect(String(error)).toMatch(/public source.*(?:input|manifest|current).*(?:read|parse|invalid)/i);
    }
  });

  it("stages and enqueues a changed shadow exactly once with the exact activation identity", async () => {
    const plan = await validPlan({ sourceActivationEventId: "44444444-4444-4444-8444-444444444444" });
    const manifestPath = join(cliWorkdir, "changed-manifest.json");
    const currentPath = join(cliWorkdir, "changed-current.json");
    const rawManifest = JSON.stringify({ schemaVersion: "public-source-acquisition-manifest-v1", plans: [plan] });
    const rawCurrent = JSON.stringify([
      {
        catalogueKey: plan.catalogueKey,
        versionId: "55555555-5555-4555-8555-555555555555",
        exactUrl: plan.exactUrl,
        exactVersion: plan.exactVersion,
        contentHash: `sha256:${"b".repeat(64)}`,
        lifecycle: "active",
      },
    ]);
    writeFileSync(manifestPath, rawManifest);
    writeFileSync(currentPath, rawCurrent);
    const calls: string[] = [];
    const stageOwnedDocument = vi.fn(async (candidate: PublicSourceStagingCandidate) => {
      calls.push("stage");
      expect(candidate.metadata.source_activation_event_id).toBe(plan.sourceActivationEventId);
      return {
        documentId: "33333333-3333-4333-8333-333333333333",
        versionId: "66666666-6666-4666-8666-666666666666",
        ownerId,
      };
    });
    const enqueue = vi.fn(async ({ metadata }: { metadata: Readonly<Record<string, string | boolean>> }) => {
      calls.push("enqueue");
      expect(metadata.source_activation_event_id).toBe(plan.sourceActivationEventId);
    });
    const dependenciesForPlan = vi.fn(async () => ({
      acquisition: {
        authorizePlan: vi.fn(async () => undefined),
        fetch: async () => connectedResponse(response(syntheticPdf())),
        resolve: async () => publicAddress,
        scan: async ({ bytes }: { bytes: Uint8Array }) => ({
          accepted: true as const,
          contentIdentity: "clear" as const,
          inspectedContentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          verdictVersion: trustedVerdictVersion,
        }),
        findDuplicateVersion: async () => null,
        stageOwnedDocument,
        enqueue,
      },
      recordCheck: vi.fn(),
      tombstoneAndQueueReview: vi.fn(),
    }));

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
          "--current-sha256",
          publicSourceAcquisitionManifestDigest(rawCurrent),
          "--apply",
        ],
        { dependenciesForPlan: dependenciesForPlan as never, stdout: vi.fn() },
      ),
    ).resolves.toMatchObject({ applied: true, count: 1 });
    expect(calls).toEqual(["stage", "enqueue"]);
    expect(stageOwnedDocument).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("resumes the exact shadow and enqueues once after a transient post-stage failure", async () => {
    const plan = await validPlan({ sourceActivationEventId: "44444444-4444-4444-8444-444444444444" });
    const bytes = syntheticPdf();
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const candidate = buildPublicSourceStagingCandidate(plan, {
      bytes,
      contentType: "application/pdf",
      contentHash,
      sourceContentType: "application/pdf",
      sourceContentHash: contentHash,
      sourceByteLength: bytes.byteLength,
    });
    const versionId = "66666666-6666-4666-8666-666666666666";
    let staged:
      | {
          versionId: string;
          documentId: string;
          ownerId: string;
          identity: Record<string, unknown>;
        }
      | undefined;
    const uploadedPaths: string[] = [];
    const insertedDocuments: string[] = [];
    const openJobs = new Set<string>();
    const enqueueDocumentReindexJob = vi
      .fn()
      .mockRejectedValueOnce(new Error("SENTINEL transient queue failure"))
      .mockImplementationOnce(async ({ document }: { document: { id: string } }) => {
        openJobs.add(document.id);
        return { outcome: "enqueued", job: { id: "job-1" } };
      });
    const sameIdentity = (value: Record<string, unknown>) =>
      staged &&
      [
        "catalogueKey",
        "exactCanonicalUrl",
        "exactUrl",
        "exactVersion",
        "contentHash",
        "stagedContentHash",
        "licenceEvidenceDigest",
        "stagingOwnerId",
        "activationEventId",
      ].every((key) => value[key] === staged!.identity[key]);
    const rpc = vi.fn(async (name: string, args: { p_version?: Record<string, unknown> }) => {
      if (name === "create_public_source_fetch_manifest") return { data: {}, error: null };
      if (name !== "stage_public_source_version" || !args.p_version) {
        return { data: null, error: { message: "unexpected rpc" } };
      }
      const identity = args.p_version;
      if (!("stagingDocumentId" in identity)) {
        if (!staged) return { data: { outcome: "missing" }, error: null };
        if (!sameIdentity(identity)) return { data: null, error: { message: "exact identity mismatch" } };
        return { data: { outcome: "resumed", ...staged }, error: null };
      }
      if (staged) return { data: null, error: { code: "23505", message: "duplicate version" } };
      staged = {
        versionId,
        documentId: String(identity.stagingDocumentId),
        ownerId,
        identity: { ...identity },
      };
      return { data: { outcome: "created", ...staged }, error: null };
    });
    const deleteChain = { eq: vi.fn(() => deleteChain) };
    const supabase = {
      rpc,
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string) => {
            uploadedPaths.push(path);
            return { error: null };
          }),
          remove: vi.fn(async () => ({ error: null })),
        })),
      },
      from: vi.fn((table: string) => {
        if (table !== "documents") throw new Error(`unexpected table ${table}`);
        return {
          insert: vi.fn(async (value: { id: string }) => {
            insertedDocuments.push(value.id);
            return { error: null };
          }),
          delete: vi.fn(() => deleteChain),
        };
      }),
    };
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => supabase }));
    vi.doMock("@/lib/env", () => ({ env: { SUPABASE_DOCUMENT_BUCKET: "synthetic-bucket" } }));
    vi.doMock("@/lib/ingestion-enqueue", () => ({ enqueueDocumentReindexJob }));

    const dependencies = await createLivePublicSourceApplyDependencies(plan);
    const first = await dependencies.stageOwnedDocument(candidate);
    await expect(
      dependencies.enqueue({
        documentId: first.documentId,
        ownerId: first.ownerId!,
        catalogueKey: plan.catalogueKey,
        contentMode: "indexed_content",
        exactDocumentLicence: "public_index_permitted",
        sourcePolicyVersion: plan.sourcePolicyVersion,
        sourcePolicyDigest: plan.sourcePolicyDigest,
        metadata: candidate.metadata,
      }),
    ).rejects.toThrow(/enqueue/i);

    const resumed = await dependencies.stageOwnedDocument(candidate);
    await dependencies.enqueue({
      documentId: resumed.documentId,
      ownerId: resumed.ownerId!,
      catalogueKey: plan.catalogueKey,
      contentMode: "indexed_content",
      exactDocumentLicence: "public_index_permitted",
      sourcePolicyVersion: plan.sourcePolicyVersion,
      sourcePolicyDigest: plan.sourcePolicyDigest,
      metadata: candidate.metadata,
    });

    expect(resumed).toMatchObject({ documentId: first.documentId, versionId, ownerId });
    expect(uploadedPaths).toHaveLength(1);
    expect(insertedDocuments).toEqual([first.documentId]);
    expect(staged?.versionId).toBe(versionId);
    expect(openJobs).toEqual(new Set([first.documentId]));
    expect(enqueueDocumentReindexJob).toHaveBeenCalledTimes(2);
  });

  it("retries a complete multi-plan fetch manifest after post-stage enqueue failure without restaging", async () => {
    const waPlan = await validPlan();
    const tgaActivation = buildPublicSourceActivationManifest({
      catalogueKey: "tga",
      decision: "activate",
      operatorId,
      reason: "Approved source definition for bounded exact-version acquisition.",
      evidenceReferences: ["source-review:tga:2026-08-20"],
    });
    const tgaPlan = await planAcquisition({
      catalogueKey: "tga",
      url: "https://www.tga.gov.au/resources/synthetic.pdf",
      exactVersion: "2026-08-20",
      exactDocumentLicence: "public_index_permitted",
      licenceEvidenceDigest: `sha256:${"c".repeat(64)}`,
      stagingOwnerId: ownerId,
      activationManifest: tgaActivation,
    });
    const manifestPath = join(cliWorkdir, "resume-multi-manifest.json");
    const rawManifest = JSON.stringify({
      schemaVersion: "public-source-acquisition-manifest-v1",
      plans: [waPlan, tgaPlan],
    });
    writeFileSync(manifestPath, rawManifest);

    const staged = new Map<string, { documentId: string; versionId: string }>();
    const created = new Map<string, number>();
    const enqueueAttempts = new Map<string, number>();
    const dependenciesForPlan = vi.fn(async (plan: PublicSourceAcquisitionPlan) => ({
      authorizePlan: vi.fn(async () => undefined),
      fetch: async () => connectedResponse(response(syntheticPdf())),
      resolve: async () => publicAddress,
      scan: trustedClearScan,
      findDuplicateVersion: async () => staged.get(plan.catalogueKey)?.versionId ?? null,
      stageOwnedDocument: async () => {
        const existing = staged.get(plan.catalogueKey);
        if (existing) return { outcome: "resumed" as const, ...existing, ownerId };
        const createdRow = {
          documentId:
            plan.catalogueKey === "wa-health"
              ? "33333333-3333-4333-8333-333333333333"
              : "77777777-7777-4777-8777-777777777777",
          versionId:
            plan.catalogueKey === "wa-health"
              ? "66666666-6666-4666-8666-666666666666"
              : "88888888-8888-4888-8888-888888888888",
        };
        staged.set(plan.catalogueKey, createdRow);
        created.set(plan.catalogueKey, (created.get(plan.catalogueKey) ?? 0) + 1);
        return { outcome: "created" as const, ...createdRow, ownerId };
      },
      enqueue: async () => {
        const attempt = (enqueueAttempts.get(plan.catalogueKey) ?? 0) + 1;
        enqueueAttempts.set(plan.catalogueKey, attempt);
        if (plan.catalogueKey === "tga" && attempt === 1) throw new Error("synthetic transient queue failure");
      },
    }));
    const argv = [
      "--manifest",
      manifestPath,
      "--expected-count",
      "2",
      "--manifest-sha256",
      publicSourceAcquisitionManifestDigest(rawManifest),
      "--apply",
    ];

    await expect(
      runFetchApprovedPublicSourceVersionsCli(argv, { dependenciesForPlan, stdout: vi.fn() }),
    ).rejects.toThrow(/enqueue/i);
    await expect(
      runFetchApprovedPublicSourceVersionsCli(argv, { dependenciesForPlan, stdout: vi.fn() }),
    ).resolves.toMatchObject({ applied: true, count: 2 });
    expect(created).toEqual(new Map(["wa-health", "tga"].map((key) => [key, 1])));
    expect(enqueueAttempts.get("tga")).toBe(2);
  });

  it("rejects non-active current evidence before dependency creation or mutation", async () => {
    const plan = await validPlan({ sourceActivationEventId: "44444444-4444-4444-8444-444444444444" });
    const manifestPath = join(cliWorkdir, "shadow-current-manifest.json");
    const currentPath = join(cliWorkdir, "shadow-current.json");
    const rawManifest = JSON.stringify({ schemaVersion: "public-source-acquisition-manifest-v1", plans: [plan] });
    const rawCurrent = JSON.stringify([
      {
        catalogueKey: plan.catalogueKey,
        versionId: "55555555-5555-4555-8555-555555555555",
        exactUrl: plan.exactUrl,
        exactVersion: plan.exactVersion,
        contentHash: `sha256:${"b".repeat(64)}`,
        lifecycle: "shadow",
      },
    ]);
    writeFileSync(manifestPath, rawManifest);
    writeFileSync(currentPath, rawCurrent);
    const dependenciesForPlan = vi.fn();
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
          "--current-sha256",
          publicSourceAcquisitionManifestDigest(rawCurrent),
          "--apply",
        ],
        { dependenciesForPlan, stdout: vi.fn() },
      ),
    ).rejects.toThrow(/active|current.*invalid/i);
    expect(dependenciesForPlan).not.toHaveBeenCalled();
  });

  it("rejects malformed current version UUIDs before unchanged audit dependency creation", async () => {
    const plan = await validPlan();
    const manifestPath = join(cliWorkdir, "malformed-current-manifest.json");
    const currentPath = join(cliWorkdir, "malformed-current-uuid.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({ schemaVersion: "public-source-acquisition-manifest-v1", plans: [plan] }),
    );
    writeFileSync(
      currentPath,
      JSON.stringify([
        {
          catalogueKey: plan.catalogueKey,
          versionId: "55555555----------------------------",
          exactUrl: plan.exactUrl,
          exactVersion: plan.exactVersion,
          contentHash: `sha256:${"b".repeat(64)}`,
          lifecycle: "active",
        },
      ]),
    );
    const dependenciesForPlan = vi.fn();
    await expect(
      runCheckPublicSourceChangesCli(["--manifest", manifestPath, "--current", currentPath], {
        dependenciesForPlan,
        stdout: vi.fn(),
      }),
    ).rejects.toThrow(/current.*invalid/i);
    expect(dependenciesForPlan).not.toHaveBeenCalled();
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
      scan: trustedClearScan,
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
