import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import { resolvePythonBin } from "../src/lib/python-bin";
import { inspectNativePdfBytes } from "../worker/general-pdf-inspection-producer";

const python = resolvePythonBin();
const fixture = (alter = "") =>
  execFileSync(python, [
    "-c",
    `import pymupdf as fitz\nimport sys\nd=fitz.open();p=d.new_page();p.insert_text((72,72),'Synthetic source paragraph. Threshold < 3.5.')\n${alter}\nsys.stdout.buffer.write(d.tobytes())`,
  ]);
function binding(bytes: Uint8Array): ProviderEgressBinding {
  const uuid = "00000000-0000-4000-8000-000000000001";
  return {
    admissionEventId: uuid,
    documentId: uuid,
    generationId: uuid,
    jobId: uuid,
    leaseId: uuid,
    attemptId: "synthetic-attempt",
    contentSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    authorityDigest: `sha256:${"a".repeat(64)}`,
  };
}
describe("real native PDF inspection producer", () => {
  it("binds complete real parser observations to the exact admitted source and lease", async () => {
    const bytes = fixture();
    const review = await inspectNativePdfBytes(bytes, binding(bytes));
    expect(review.binding).toEqual(binding(bytes));
    expect(review.pages).toHaveLength(1);
    expect(review.pages[0]!.text).toContain("Threshold < 3.5.");
    expect(review.activeContent).toBe("absent");
    expect(review.hiddenText).toBe("consistent");
  });
  it("refuses invisible text and active source actions without invoking provider transport", async () => {
    for (const alter of [
      "p.insert_text((72,120),'Invisible synthetic',render_mode=3)",
      "d.xref_set_key(d.pdf_catalog(),'OpenAction','<</S/JavaScript/JS(synthetic)>>')",
    ]) {
      const bytes = fixture(alter);
      await expect(inspectNativePdfBytes(bytes, binding(bytes))).rejects.toThrow("general_pdf_inspection_producer_");
    }
  });
  it("enforces an external process deadline and caller cancellation", async () => {
    const bytes = fixture();
    await expect(inspectNativePdfBytes(bytes, binding(bytes), { timeoutMs: 1 })).rejects.toThrow(
      "general_pdf_inspection_producer_",
    );
    const controller = new AbortController();
    controller.abort();
    await expect(inspectNativePdfBytes(bytes, binding(bytes), { signal: controller.signal })).rejects.toThrow();
  });
  it("refuses source hash mismatch before constructing subprocess work", async () => {
    const bytes = fixture();
    await expect(
      inspectNativePdfBytes(bytes, { ...binding(bytes), contentSha256: `sha256:${"b".repeat(64)}` }),
    ).rejects.toThrow("source_binding_mismatch");
  });
});
