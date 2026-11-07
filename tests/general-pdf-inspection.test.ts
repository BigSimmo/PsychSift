import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContentSha256, ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import {
  GENERAL_PDF_INSPECTION_VERSION,
  assertGeneralPdfEmbeddingInputs,
  inspectGeneralPdfSource,
  type GeneralPdfInspectionReview,
} from "../worker/general-pdf-inspection";

const hash = (value: Uint8Array | string): ContentSha256 =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const bytes = Buffer.from("%PDF-1.7\nSynthetic bounded PDF source, never a clinical document.\n%%EOF");
const uuid = "00000000-0000-4000-8000-000000000001";
const binding: ProviderEgressBinding = {
  admissionEventId: uuid,
  documentId: uuid,
  generationId: uuid,
  jobId: uuid,
  attemptId: "synthetic-attempt",
  leaseId: uuid,
  contentSha256: hash(bytes),
  authorityDigest: hash("authority"),
};
function review(): GeneralPdfInspectionReview {
  const texts = [
    "Synthetic heading\nAlpha source paragraph with threshold < 3.5.",
    "Second page\nA distinct action remains attached to its threshold.",
  ];
  return {
    version: GENERAL_PDF_INSPECTION_VERSION,
    binding: { ...binding },
    sourceSha256: hash(bytes),
    sourceByteLength: bytes.length,
    pageCount: 2,
    pages: texts.map((text, index) => ({ pageNumber: index + 1, text, textSha256: hash(text) })),
    pageInventory: "complete",
    activeContent: "absent",
    encryption: "not_encrypted",
    hiddenText: "consistent",
    inspectedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
}
describe("general native PDF inspection evidence", () => {
  it("validates the complete dynamic page inventory and allows unchanged source substrings", () => {
    const r = review();
    expect(inspectGeneralPdfSource(r, bytes, binding)).toEqual(r.pages.map((page) => page.text));
    expect(() => assertGeneralPdfEmbeddingInputs(r, ["threshold < 3.5.", "A distinct action"])).not.toThrow();
  });
  it.each([
    [
      "foreign source",
      (r: GeneralPdfInspectionReview) => {
        r.sourceSha256 = hash("foreign");
      },
    ],
    [
      "foreign attempt",
      (r: GeneralPdfInspectionReview) => {
        r.binding.attemptId = "other";
      },
    ],
    [
      "dropped page",
      (r: GeneralPdfInspectionReview) => {
        r.pages.pop();
      },
    ],
    [
      "duplicate page",
      (r: GeneralPdfInspectionReview) => {
        r.pages[1]!.pageNumber = 1;
      },
    ],
    [
      "changed page text",
      (r: GeneralPdfInspectionReview) => {
        r.pages[0]!.text += " fabricated";
      },
    ],
    [
      "wrong byte count",
      (r: GeneralPdfInspectionReview) => {
        r.sourceByteLength++;
      },
    ],
    [
      "expired evidence",
      (r: GeneralPdfInspectionReview) => {
        r.expiresAt = new Date(Date.now() - 1).toISOString();
      },
    ],
    [
      "future evidence",
      (r: GeneralPdfInspectionReview) => {
        r.inspectedAt = new Date(Date.now() + 5000).toISOString();
      },
    ],
    [
      "unbounded lifetime",
      (r: GeneralPdfInspectionReview) => {
        r.expiresAt = new Date(Date.now() + 86400001).toISOString();
      },
    ],
    [
      "active content",
      (r: GeneralPdfInspectionReview) => {
        Object.assign(r, { activeContent: "detected" });
      },
    ],
    [
      "encrypted",
      (r: GeneralPdfInspectionReview) => {
        Object.assign(r, { encryption: "supported" });
      },
    ],
    [
      "hidden conflict",
      (r: GeneralPdfInspectionReview) => {
        Object.assign(r, { hiddenText: "conflict" });
      },
    ],
  ])("refuses %s before provider work", (_label, mutate) => {
    const r = review();
    mutate(r);
    expect(() => inspectGeneralPdfSource(r, bytes, binding)).toThrow("general_pdf_inspection_");
  });
  it("rejects altered numbers, cross-page stitching, empty inputs and mismatched source batches", () => {
    const r = review();
    for (const input of ["threshold < 35.", "3.5.\nSecond page", ""]) {
      expect(() => assertGeneralPdfEmbeddingInputs(r, [input])).toThrow("general_pdf_inspection_");
    }
    expect(() =>
      assertGeneralPdfEmbeddingInputs(r, ["Alpha source"], {
        planDigest: hash("plan"),
        inputs: [{ providerInputText: "different", sourceUnitIds: [{ family: "chunks", key: uuid }] }],
      }),
    ).toThrow("general_pdf_inspection_");
  });
  it("requires actual PDF source bytes and rejects text claimed as a PDF", () => {
    const source = Buffer.from("not a PDF");
    const r = review();
    Object.assign(r, {
      sourceSha256: hash(source),
      sourceByteLength: source.length,
      binding: { ...binding, contentSha256: hash(source) },
    });
    expect(() => inspectGeneralPdfSource(r, source, r.binding)).toThrow("general_pdf_inspection_");
  });
  it("keeps blank pages in the inventory and refuses oversized UTF-8 or unpaired surrogate text", () => {
    const r = review();
    r.pages[1]!.text = "";
    r.pages[1]!.textSha256 = hash("");
    expect(inspectGeneralPdfSource(r, bytes, binding)).toHaveLength(2);
    for (const text of ["é".repeat(1048577), "unpaired \ud800"]) {
      r.pages[0]!.text = text;
      r.pages[0]!.textSha256 = hash(text);
      expect(() => inspectGeneralPdfSource(r, bytes, binding)).toThrow("general_pdf_inspection_");
    }
  });
});
