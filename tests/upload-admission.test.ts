import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { loadTrustedBackendConfig } from "../scripts/import-documents";
import {
  acquireUploadAdmission,
  parseUploadContentLength,
  resetUploadAdmissionForTests,
} from "../src/lib/upload-admission";

afterEach(() => resetUploadAdmissionForTests());

describe("upload admission", () => {
  it("parses valid content lengths and rejects malformed or negative values", () => {
    expect(parseUploadContentLength(null)).toBeNull();
    expect(parseUploadContentLength("1024")).toBe(1024);
    expect(() => parseUploadContentLength("-1")).toThrow(/content-length/i);
    expect(() => parseUploadContentLength("12.5")).toThrow(/content-length/i);
    expect(() => parseUploadContentLength("not-a-number")).toThrow(/content-length/i);
  });

  it("rejects concurrent capacity and releases the slot", () => {
    const first = acquireUploadAdmission({ bytes: 10, maxConcurrent: 1, maxBytes: 100 });
    expect(first.ok).toBe(true);
    expect(acquireUploadAdmission({ bytes: 10, maxConcurrent: 1, maxBytes: 100 })).toEqual({
      ok: false,
      reason: "concurrency",
    });
    if (first.ok) first.release();
    expect(acquireUploadAdmission({ bytes: 10, maxConcurrent: 1, maxBytes: 100 }).ok).toBe(true);
  });

  it("rejects reservations over the byte budget and releases bytes exactly once", () => {
    const first = acquireUploadAdmission({ bytes: 80, maxConcurrent: 2, maxBytes: 100 });
    expect(first.ok).toBe(true);
    expect(acquireUploadAdmission({ bytes: 30, maxConcurrent: 2, maxBytes: 100 })).toEqual({
      ok: false,
      reason: "bytes",
    });
    if (first.ok) {
      first.release();
      first.release();
    }
    expect(acquireUploadAdmission({ bytes: 100, maxConcurrent: 2, maxBytes: 100 }).ok).toBe(true);
  });
});

describe("trusted backend import admission", () => {
  const authority = {
    version: 1,
    sourceRole: "local_guideline",
    authorityBasis: "backend_manifest",
    licencePolicy: "public_index_permitted",
    rightsEvidenceRef: "test-fixture:rights-review",
    publisher: "Test Health Service",
    jurisdiction: "Australia",
    publicationDate: "2026-01-01",
    effectiveDate: null,
    reviewDate: null,
    expiryDate: null,
    currentness: "current",
    supersedesDocumentId: null,
    purpose: "clinical_retrieval",
    supportedFeatures: ["text"],
    providerProcessing: "permitted",
  };

  it("validates strict backend authority and capability without exposing the capability", () => {
    const capability = "a".repeat(64);
    expect(
      loadTrustedBackendConfig({
        NODE_ENV: "test",
        TRUSTED_INGESTION_BACKEND_PRINCIPAL: "fixture-importer",
        TRUSTED_INGESTION_BACKEND_CAPABILITY: capability,
        TRUSTED_INGESTION_AUTHORITY_JSON: JSON.stringify(authority),
      }),
    ).toEqual({ principal: "fixture-importer", capability, authority });
    expect(() =>
      loadTrustedBackendConfig({
        NODE_ENV: "test",
        TRUSTED_INGESTION_BACKEND_PRINCIPAL: "fixture-importer",
        TRUSTED_INGESTION_BACKEND_CAPABILITY: "SECRET-CAPABILITY",
        TRUSTED_INGESTION_AUTHORITY_JSON: JSON.stringify(authority),
      }),
    ).toThrow("must be exactly 64 lowercase hexadecimal characters");
  });

  it("guards import execution and refuses force before scanning", () => {
    const importer = readFileSync(new URL("../scripts/import-documents.ts", import.meta.url), "utf8");
    expect(importer).toContain("import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href");
    expect(importer.indexOf("if (args.force)")).toBeLessThan(importer.indexOf("scanImportFiles("));
    expect(importer.indexOf("loadTrustedBackendConfig()")).toBeLessThan(importer.indexOf("scanImportFiles("));
    expect(importer).not.toContain("reset_document_index");
  });

  it("looks up the deterministic admission row directly and reuses immutable source_title for replay naming", () => {
    const importer = readFileSync(new URL("../scripts/import-documents.ts", import.meta.url), "utf8");
    const exactLookup = importer.indexOf('.eq("id", documentId)');
    const retainedPlan = importer.indexOf("retainedImportNamePlan(retainedDocument)");
    expect(exactLookup).toBeGreaterThan(-1);
    expect(exactLookup).toBeLessThan(retainedPlan);
    expect(importer).toContain("title: metadata.source_title");
    expect(importer).toContain('.select("id,title,file_name,storage_path,content_hash,metadata")');
    expect(importer).toContain("assertTrustedDocumentStoragePath(ownerId, documentId, retainedDocument.storage_path)");
    expect(importer).toContain("uploadTrustedDocumentBytes({");
    expect(importer).toContain("contentSha256: file.contentHash");
    const positiveWinnerReplay = importer.indexOf('if (winnerReplay.outcome !== "not_found")');
    expect(positiveWinnerReplay).toBeGreaterThan(-1);
    expect(importer.indexOf("namePlan = winnerNamePlan;", positiveWinnerReplay)).toBeGreaterThan(positiveWinnerReplay);
    expect(importer.indexOf("wasReplay = true;", positiveWinnerReplay)).toBeGreaterThan(positiveWinnerReplay);
    expect(importer).not.toContain("existingDocsForPlanning.find((document) => document.id === documentId)");
  });
});
