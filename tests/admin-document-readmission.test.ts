import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareAdministratorDocumentReadmission } from "../src/lib/admin-document-readmission";
const administratorId = "71000000-0000-4000-8000-000000000001";
const documentId = "71000000-0000-4000-8000-000000000002";
const correlationId = "71000000-0000-4000-8000-000000000003";
const bytes = Buffer.from("%PDF-synthetic source binding");
const authority = {
  version: 1,
  sourceRole: "clinical_guideline",
  authorityBasis: "administrator_template",
  licencePolicy: "review_required",
  rightsEvidenceRef: "owner:current-reindex-request",
  publisher: "Synthetic publisher",
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
};
function input() {
  return {
    administratorId,
    correlationId,
    maxAttempts: 1,
    authority,
    document: {
      id: documentId,
      owner_id: null,
      file_name: "old-reference.pdf",
      storage_path: "legacy-objects/original-reference.pdf",
      file_type: "application/pdf" as const,
      file_size: bytes.length,
      content_hash: createHash("sha256").update(bytes).digest("hex"),
      metadata: { public_corpus: true, clinical_validation_status: "unverified" },
    },
  };
}
describe("current administrator legacy reindex readmission", () => {
  it("preserves ownerless existing shared-library identity and exact historical storage binding", () => {
    const source = input();
    const before = structuredClone(source);
    const payload = prepareAdministratorDocumentReadmission(source, bytes);
    expect(payload.p_expected_owner_id).toBeNull();
    expect(payload.p_expected_public_corpus).toBe(true);
    expect(payload.p_source_sha256).toBe(`sha256:${source.document.content_hash}`);
    expect(payload.p_storage_path_sha256).toBe(
      `sha256:${createHash("sha256").update(source.document.storage_path).digest("hex")}`,
    );
    expect(payload.p_authority.currentness).toBe("unknown");
    expect(source).toEqual(before);
    expect(payload).not.toHaveProperty("p_owner_id");
    expect(payload).not.toHaveProperty("clinicalApproval");
  });
  it("accepts the administrator's own private source without a publication marker", () => {
    const source = {
      ...input(),
      document: { ...input().document, owner_id: administratorId, metadata: { public_corpus: false } },
    };
    const payload = prepareAdministratorDocumentReadmission(source, bytes);
    expect(payload.p_expected_owner_id).toBe(administratorId);
    expect(payload.p_expected_public_corpus).toBe(false);
  });
  it("refuses another owner's source and unmarked ownerless records", () => {
    expect(() =>
      prepareAdministratorDocumentReadmission(
        { ...input(), document: { ...input().document, owner_id: documentId } },
        bytes,
      ),
    ).toThrow("scope_required");
    expect(() =>
      prepareAdministratorDocumentReadmission(
        { ...input(), document: { ...input().document, metadata: { public_corpus: "true" } } },
        bytes,
      ),
    ).toThrow("scope_required");
  });
  it("refuses source substitution, forbidden provider processing and clinical-source withdrawal", () => {
    expect(() => prepareAdministratorDocumentReadmission(input(), Buffer.from("%PDF-other source"))).toThrow(
      "source_identity_mismatch",
    );
    expect(() =>
      prepareAdministratorDocumentReadmission(
        { ...input(), authority: { ...authority, providerProcessing: "forbidden" } },
        bytes,
      ),
    ).toThrow("processing_forbidden");
    expect(() =>
      prepareAdministratorDocumentReadmission(
        { ...input(), authority: { ...authority, currentness: "withdrawn" } },
        bytes,
      ),
    ).toThrow("withdrawn");
  });
});
