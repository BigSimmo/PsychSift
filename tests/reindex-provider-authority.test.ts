import { describe, it, expect, vi } from "vitest";
import { IngestionAttempt, type IngestionFence } from "../supabase/functions/_shared/ingestion-attempt";
import {
  parseAdministratorReindexAuthorityFacts,
  readAdministratorReindexAuthorityFacts,
} from "../worker/reindex-provider-authority";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = `sha256:${"a".repeat(64)}` as const;
const fence: IngestionFence = {
  job_kind: "node",
  job_id: id(1),
  document_id: id(2),
  worker_id: "synthetic",
  lease_token: id(3),
  expected_generation_id: null,
  authority_digest: sha,
};
const binding: ProviderEgressBinding = {
  admissionEventId: id(4),
  documentId: id(2),
  generationId: id(5),
  jobId: id(1),
  attemptId: "synthetic",
  leaseId: id(3),
  contentSha256: sha,
  authorityDigest: sha,
};
function response() {
  return {
    ok: true,
    providerAuthority: {
      version: "administrator-reindex-authority-facts-v1",
      scope: "existing_shared_library_stewardship",
      documentId: id(2),
      documentOwnerId: null as string | null,
      stewardId: id(6),
      jobId: id(1),
      generationId: id(5),
      authorityDigest: sha,
      sourceSha256: sha,
      sourceByteLength: 200,
      mimeType: "application/pdf",
      fileNameSha256: sha,
      storagePathSha256: sha,
      admissionEventId: id(4),
      admissionDigest: sha,
      admissionPolicyVersion: "trusted-document-admission-v1",
      declaredAuthority: {
        version: 1,
        sourceRole: "clinical_reference",
        authorityBasis: "administrator_template",
        licencePolicy: "review_required",
        rightsEvidenceRef: "synthetic pending review",
        publisher: "Synthetic",
        jurisdiction: "Australia/WA",
        publicationDate: null,
        effectiveDate: null,
        reviewDate: null,
        expiryDate: null,
        currentness: "unknown",
        supersedesDocumentId: null,
        purpose: "clinical_retrieval",
        supportedFeatures: ["images", "tables", "text"],
        providerProcessing: "permitted",
      },
      currentRightsEvidence: "unavailable",
      historicalUploadOrigin: "not_established",
    },
  };
}
describe("current reindex stewardship facts", () => {
  it("keeps actual null owner distinct from the accountable administrator", async () => {
    const attempt = new IngestionAttempt(fence),
      rpc = vi.fn(async () => ({ data: response(), error: null }));
    const actual = await readAdministratorReindexAuthorityFacts({
      attempt,
      generationId: id(5),
      sourceBinding: binding,
      rpc,
    });
    expect(actual.documentOwnerId).toBeNull();
    expect(actual.stewardId).toBe(id(6));
    expect(actual.currentRightsEvidence).toBe("unavailable");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_administrator_reindex_authority", {
      p_fence: fence,
      p_generation: id(5),
    });
  });
  it("accepts a genuine private owner-administrator", () => {
    const value = response();
    value.providerAuthority.scope = "owner_private";
    value.providerAuthority.documentOwnerId = id(6);
    expect(parseAdministratorReindexAuthorityFacts(value, fence, id(5), binding).documentOwnerId).toBe(id(6));
  });
  it.each(["documentId", "jobId", "generationId", "admissionEventId", "authorityDigest", "sourceSha256"])(
    "refuses mismatched %s",
    (key) => {
      const value = response();
      Reflect.set(
        value.providerAuthority,
        key,
        key.endsWith("Digest") || key.endsWith("Sha256") ? `sha256:${"b".repeat(64)}` : id(9),
      );
      expect(() => parseAdministratorReindexAuthorityFacts(value, fence, id(5), binding)).toThrow(
        "ingestion_rpc_invalid",
      );
    },
  );
  it("refuses ownership substitution and unknown scope", () => {
    const value = response();
    value.providerAuthority.documentOwnerId = id(6);
    expect(() => parseAdministratorReindexAuthorityFacts(value, fence, id(5), binding)).toThrow();
    value.providerAuthority.scope = "owner_private";
    value.providerAuthority.documentOwnerId = id(9);
    expect(() => parseAdministratorReindexAuthorityFacts(value, fence, id(5), binding)).toThrow();
  });
  it("cancels the attempt after an uncertain read", async () => {
    const attempt = new IngestionAttempt(fence);
    await expect(
      readAdministratorReindexAuthorityFacts({
        attempt,
        generationId: id(5),
        sourceBinding: binding,
        rpc: async () => {
          throw new Error("unavailable");
        },
      }),
    ).rejects.toThrow();
    expect(attempt.signal.aborted).toBe(true);
  });
});
