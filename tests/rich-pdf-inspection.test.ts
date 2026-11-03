import { describe, expect, it } from "vitest";
import { bytesDigest, generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";
import type { ContentSha256, ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import {
  inspectRichPdfSource,
  RICH_PDF_INSPECTION_VERSION,
  type RichPdfInspectionReview,
} from "../worker/rich-pdf-inspection";

const original = Buffer.from("%PDF-1.7\nSYNTHETIC inspected source\n%%EOF");
const sha = bytesDigest(original) as ContentSha256;
const uuid = "00000000-0000-4000-8000-000000000001";
const binding: ProviderEgressBinding = {
  admissionEventId: uuid,
  documentId: uuid,
  generationId: uuid,
  jobId: uuid,
  leaseId: uuid,
  attemptId: "synthetic",
  contentSha256: sha,
  authorityDigest: sha,
};
function fixture(): RichPdfInspectionReview {
  const text = "SYNTHETIC threshold < 3.5. Withhold example.";
  const features = { nativeText: true, rasterImages: 0, vectorDrawings: 1, nativeTables: 1 };
  const rows = [
    ["Threshold", "Action"],
    ["< 3.5", "Withhold example"],
  ];
  return {
    version: RICH_PDF_INSPECTION_VERSION,
    binding,
    sourceSha256: sha,
    sourceByteLength: original.length,
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        text,
        textSha256: bytesDigest(Buffer.from(text)),
        nativeTextSha256: sha,
        ocrUsed: false,
        sourceProvenanceSha256: sha,
        originalFeatures: features,
        imageOrdinals: [1],
        tableOrdinals: [0],
      },
    ],
    images: [
      {
        ordinal: 1,
        pageNumber: 1,
        sha256: sha,
        byteLength: 123,
        sourceKind: "table_crop",
        width: 400,
        height: 200,
        metadataSha256: sha,
        descriptorSha256: sha,
      },
    ],
    tables: [
      {
        ordinal: 0,
        imageOrdinal: 1,
        pageNumber: 1,
        rows,
        rowsSha256: generationEvidenceDigest(rows),
        metadataSha256: sha,
      },
    ],
    sourceInventory: [
      {
        pageNumber: 1,
        nativeTextSha256: sha,
        ...features,
        rasterBboxes: [],
        vectorBboxes: [[1, 1, 100, 100]],
        tableBboxes: [[1, 1, 100, 100]],
      },
    ],
    featureCoverage: {
      nativeText: "complete",
      nativeTables: "complete",
      raster: "not_present",
      ocr: "not_present",
      figures: "complete",
    },
    activeContent: "absent",
    encryption: "not_encrypted",
    hiddenText: "consistent",
    pageInventory: "complete",
    inspectedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    verificationScope: "structural_and_extracted_bytes_not_clinical_semantic_approval",
  };
}
describe("rich PDF source inspection", () => {
  it("retains exact text, table relations and image identities", () => {
    const r = fixture();
    expect(inspectRichPdfSource(r, original, binding).tables[0]!.rows[1]).toEqual(["< 3.5", "Withhold example"]);
  });
  it.each(["text", "table", "source", "coverage", "image"])(
    "refuses %s drift without inventing completeness",
    (kind) => {
      const r = fixture();
      if (kind === "text") r.pages[0]!.text += " altered";
      if (kind === "table") r.tables[0]!.rows[1]![0] = "35";
      if (kind === "source") r.sourceSha256 = bytesDigest(Buffer.from("other"));
      if (kind === "coverage") r.featureCoverage.nativeTables = "not_present";
      if (kind === "image") r.pages[0]!.imageOrdinals = [];
      expect(() => inspectRichPdfSource(r, original, binding)).toThrow("rich_pdf_inspection_");
    },
  );
});
