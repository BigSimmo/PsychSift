import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { resolvePythonBin } from "../src/lib/python-bin";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import { inspectRichPdfBytes } from "../worker/rich-pdf-inspection-producer";
const python = resolvePythonBin();
function fixture(kind: "table" | "scan" | "figure") {
  const code =
    `import pymupdf as f,sys\nd=f.open();p=d.new_page()\np.insert_text((72,72),'SYNTHETIC SOURCE THRESHOLDS AND ACTIONS',fontsize=14)\n` +
    (kind === "table"
      ? `\nfor x in (40,240,460): p.draw_line((x,100),(x,220))\nfor y in (100,140,180,220): p.draw_line((40,y),(460,y))\nfor y,cells in ((125,('Threshold','Action')),(165,('< 3.5','HOLD EXAMPLE')),(205,('> 3.5','REVIEW EXAMPLE'))):\n for x,t in zip((50,250),cells): p.insert_text((x,y),t,fontsize=12)\n`
      : kind === "figure"
        ? `p.draw_rect(f.Rect(72,140,280,240),fill=(0.4,0.7,0.3));p.insert_text((85,180),'SYNTHETIC FIGURE')\n`
        : `p.insert_text((72,110),'Scan-only synthetic source. Review example threshold.',fontsize=15)\npix=p.get_pixmap(dpi=180);s=f.open();s.new_page().insert_image(p.rect,pixmap=pix);d=s\n`) +
    `sys.stdout.buffer.write(d.tobytes())`;
  return execFileSync(python, ["-c", code], { maxBuffer: 16 * 1024 * 1024 });
}
function binding(bytes: Buffer): ProviderEgressBinding {
  const id = "00000000-0000-4000-8000-000000000001";
  const sha = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  return {
    admissionEventId: id,
    documentId: id,
    generationId: id,
    jobId: id,
    leaseId: id,
    attemptId: "synthetic",
    contentSha256: sha,
    authorityDigest: sha,
  };
}
describe("real rich PDF original and production extraction", () => {
  it.each(["table", "figure", "scan"] as const)(
    "preserves %s source features and their actual extraction",
    async (kind) => {
      const bytes = fixture(kind);
      const result = await inspectRichPdfBytes(bytes, binding(bytes), { timeoutMs: 120000 });
      try {
        expect(result.review.images.length).toBeGreaterThan(0);
        expect(result.capturedImages).toHaveLength(result.review.images.length);
        expect(result.review.verificationScope).toContain("not_clinical_semantic_approval");
        if (kind === "table") {
          expect(result.review.tables.length).toBeGreaterThan(0);
          expect(JSON.stringify(result.review.tables)).toContain("3.5");
          expect(JSON.stringify(result.review.tables)).toContain("HOLD EXAMPLE");
        }
        if (kind === "scan") {
          expect(result.review.featureCoverage.ocr).toBe("complete");
          expect(result.review.pages[0]!.ocrUsed).toBe(true);
          expect(result.review.pages[0]!.text.toLowerCase()).toContain("synthetic");
        }
        if (kind === "figure") expect(result.review.sourceInventory[0]!.vectorDrawings).toBeGreaterThan(0);
      } finally {
        await Promise.all(
          (result.extracted.temporaryPaths ?? []).map((directory) => rm(directory, { recursive: true, force: true })),
        );
      }
    },
    130000,
  );
});
