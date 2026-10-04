import { describe, expect, it } from "vitest";
import { isPdfDocument } from "@/lib/pdf-documents";

describe("isPdfDocument", () => {
  it("lists PDFs by file type or, when the type is missing, by file name", () => {
    expect(isPdfDocument({ file_type: "application/pdf", file_name: "guideline.pdf" })).toBe(true);
    expect(isPdfDocument({ file_name: "Guideline.PDF" })).toBe(true);
  });

  it("keeps registry entries and other file types out of the Documents lists", () => {
    expect(
      isPdfDocument({
        file_type: "application/vnd.clinical-kb.registry+json",
        file_name: "medication-ziprasidone.registry.json",
      }),
    ).toBe(false);
    expect(isPdfDocument({ file_name: "medication-ziprasidone.registry.json" })).toBe(false);
    expect(isPdfDocument({ file_type: "text/plain", file_name: "web-capture.txt" })).toBe(false);
    expect(
      isPdfDocument({
        file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_name: "policy.docx",
      }),
    ).toBe(false);
  });
});
