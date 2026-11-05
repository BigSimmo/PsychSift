import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderedPdfReviewCliFailure, validateRenderedPdfReviewCli } from "../scripts/validate-rendered-pdf-review";
import { inspectRenderedPdfOriginal, type RenderedPdfInspection } from "../worker/rendered-pdf-inspection-producer";
import { resolvePythonBin } from "../src/lib/python-bin";
import { generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";
import {
  renderedPdfReviewDigest,
  type RenderedPdfReview,
  type RenderedPdfReviewResult,
} from "../worker/rendered-pdf-review";

const hash = `sha256:${"1".repeat(64)}`;
const otherHash = `sha256:${"2".repeat(64)}`;
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function fixture() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "render-review-cli-"));
  folders.push(folder);
  const source = path.join(folder, "synthetic.pdf");
  const reviewFile = path.join(folder, "review.json");
  const artifactRoot = path.join(folder, "artifacts");
  const bytes = Buffer.from("%PDF-1.7\nSYNTHETIC\n%%EOF");
  const runtime = {
    pythonVersion: "3.12",
    pymupdfVersion: "1.26",
    mupdfVersion: "1.26",
    tesseractVersion: "5.4",
    pillowVersion: "13.0",
    pytesseractVersion: "0.3.13",
    rendererScriptSha256: hash,
    extractorScriptSha256: hash,
  };
  const review: RenderedPdfReview = {
    version: "administrator-rendered-pdf-inspection-v1",
    verificationScope: "source_anchored_render_review_not_clinical_signoff",
    authority: "render_review_only_no_ingestion_provider_publication_or_clinical_approval",
    sourceSha256: hash,
    sourceByteLength: bytes.length,
    pageCount: 1,
    nativeLayerDisposition: "excluded_from_admitted_evidence",
    originalNativeConflict: "unresolved",
    runtime,
    rasterContainer: { sha256: hash, byteLength: 10 },
    reviewer: {
      reviewerId: "11111111-1111-4111-8111-111111111111",
      reviewedAt: "2026-01-01T00:00:00Z",
      referenceSha256: hash,
    },
    pageCoverage: "reviewed_complete",
    pages: [
      {
        pageNumber: 1,
        fullPageReviewed: true,
        coordinateSpace: "render_pixels",
        originalGeometrySha256: hash,
        render: { sha256: hash, byteLength: 10, width: 100, height: 100 },
        ocrTextSha256: hash,
        ocrTextByteLength: 0,
        textCoverage: "reviewed_complete",
        text: [],
        tables: { status: "absent" },
        diagrams: { status: "absent" },
        unresolvedHolds: [],
      },
    ],
  };
  await writeFile(source, bytes);
  await writeFile(reviewFile, JSON.stringify(review));
  const approvedDigest = renderedPdfReviewDigest(review);
  const argv = [
    "--source",
    source,
    "--artifact-root",
    artifactRoot,
    "--source-sha256",
    hash,
    "--review",
    reviewFile,
    "--approved-review-sha256",
    approvedDigest,
  ];
  // Synthetic dependencies exercise CLI wiring; the real validator has its own binding tests.
  const inspection = {} as RenderedPdfInspection;
  const inspect = vi.fn().mockResolvedValue(inspection);
  const validate = vi.fn().mockResolvedValue({
    reviewSha256: approvedDigest,
    reviewedPages: review.pages,
    reviewedTables: [],
    reviewedDiagrams: [],
  } as unknown as RenderedPdfReviewResult);
  return { source, reviewFile, artifactRoot, bytes, review, argv, approvedDigest, inspection, inspect, validate };
}

describe("offline rendered review validation CLI", () => {
  it("validates a synthetic record from a first real inspection against a fresh second inspection", async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "render-review-replay-"));
    folders.push(folder);
    const source = path.join(folder, "synthetic.pdf");
    execFileSync(
      resolvePythonBin(),
      [
        "-c",
        "import pymupdf as f,sys; d=f.open(); p=d.new_page(width=160,height=80); p.insert_text((12,35),'VISIBLE SOURCE 47'); d.save(sys.argv[1]); d.close()",
        source,
      ],
      { timeout: 10000, stdio: "pipe" },
    );
    const sourceBytes = await readFile(source);
    const digest = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const sourceSha256 = digest(sourceBytes);
    const artifactRoot = path.join(folder, "artifacts");
    const first = await inspectRenderedPdfOriginal(source, artifactRoot, sourceSha256);
    const page = first.renderPages[0]!;
    const ocr = first.extraction.pages[0]!.text;
    expect(ocr).toContain("VISIBLE SOURCE 47");
    // Test-only synthetic review; no real reviewer, source approval or policy is created.
    const review: RenderedPdfReview = {
      version: "administrator-rendered-pdf-inspection-v1",
      verificationScope: "source_anchored_render_review_not_clinical_signoff",
      authority: "render_review_only_no_ingestion_provider_publication_or_clinical_approval",
      sourceSha256,
      sourceByteLength: sourceBytes.length,
      pageCount: 1,
      nativeLayerDisposition: "excluded_from_admitted_evidence",
      originalNativeConflict: "unresolved",
      runtime: first.runtime,
      rasterContainer: { sha256: first.rasterContainer.sha256, byteLength: first.rasterContainer.byteLength },
      reviewer: {
        reviewerId: "11111111-1111-4111-8111-111111111111",
        reviewedAt: "2026-01-01T00:00:00Z",
        referenceSha256: digest("SYNTHETIC TEST REVIEW ONLY"),
      },
      pageCoverage: "reviewed_complete",
      pages: [
        {
          pageNumber: 1,
          fullPageReviewed: true,
          coordinateSpace: "render_pixels",
          originalGeometrySha256: generationEvidenceDigest(page.originalGeometry),
          render: {
            sha256: page.artifact.sha256,
            byteLength: page.artifact.byteLength,
            width: page.artifact.width,
            height: page.artifact.height,
          },
          ocrTextSha256: digest(ocr),
          ocrTextByteLength: Buffer.byteLength(ocr),
          textCoverage: "reviewed_complete",
          text: [
            {
              origin: "render_ocr",
              region: [0, 0, page.artifact.width, page.artifact.height],
              start: 0,
              end: ocr.length,
              text: ocr,
            },
          ],
          tables: { status: "absent" },
          diagrams: { status: "absent" },
          unresolvedHolds: [],
        },
      ],
    };
    const reviewFile = path.join(folder, "synthetic-review.json");
    await writeFile(reviewFile, JSON.stringify(review));
    const result = await validateRenderedPdfReviewCli([
      "--source",
      source,
      "--artifact-root",
      artifactRoot,
      "--source-sha256",
      sourceSha256,
      "--review",
      reviewFile,
      "--approved-review-sha256",
      renderedPdfReviewDigest(review),
    ]);
    expect(result).toMatchObject({ status: "structurally_validated", pageCount: 1, tableCount: 0, diagramCount: 0 });
    expect(await readFile(source)).toEqual(sourceBytes);
    expect(first.status).toBe("held_for_review");
  }, 30000);

  it("forwards the explicit approval to the existing validator and emits only structural metadata", async () => {
    const f = await fixture();
    const beforeReview = await readFile(f.reviewFile);
    const result = await validateRenderedPdfReviewCli(f.argv, f);
    expect(f.inspect).toHaveBeenCalledExactlyOnceWith(f.source, f.artifactRoot, hash);
    expect(f.validate).toHaveBeenCalledExactlyOnceWith({
      review: f.review,
      inspection: f.inspection,
      sourcePath: f.source,
      originalBytes: f.bytes,
      approvedReviewSha256: new Set([f.approvedDigest]),
    });
    expect(result).toEqual({
      status: "structurally_validated",
      scope: "render_review_only_not_owner_authentication_or_clinical_acceptance",
      sourceSha256: hash,
      reviewSha256: f.approvedDigest,
      pageCount: 1,
      tableCount: 0,
      diagramCount: 0,
    });
    expect(await readFile(f.source)).toEqual(f.bytes);
    expect(await readFile(f.reviewFile)).toEqual(beforeReview);
  });

  it.each(["missing", "duplicate", "unknown", "relative", "bad-digest"])(
    "refuses %s arguments before inspecting a source",
    async (kind) => {
      const f = await fixture();
      if (kind === "missing") f.argv.splice(-2);
      if (kind === "duplicate") f.argv.push("--review", f.reviewFile);
      if (kind === "unknown") f.argv[0] = "--approve";
      if (kind === "relative") f.argv[1] = "synthetic.pdf";
      if (kind === "bad-digest") f.argv[f.argv.length - 1] = "1".repeat(64);
      await expect(validateRenderedPdfReviewCli(f.argv, f)).rejects.toThrow("arguments_invalid");
      expect(f.inspect).not.toHaveBeenCalled();
      expect(f.validate).not.toHaveBeenCalled();
    },
  );

  it.each(["malformed", "extra-field", "invalid-utf8", "oversize", "symlink"])(
    "refuses a %s review before inspecting a source",
    async (kind) => {
      const f = await fixture();
      if (kind === "malformed") await writeFile(f.reviewFile, "{");
      if (kind === "extra-field") await writeFile(f.reviewFile, JSON.stringify({ ...f.review, approved: true }));
      if (kind === "invalid-utf8") await writeFile(f.reviewFile, Buffer.from([0xff]));
      if (kind === "oversize") await truncate(f.reviewFile, 8 * 1024 * 1024 + 1);
      if (kind === "symlink") {
        const link = `${f.reviewFile}.link`;
        await symlink(f.reviewFile, link);
        f.argv[7] = link;
      }
      await expect(validateRenderedPdfReviewCli(f.argv, f)).rejects.toThrow("rendered_pdf_review_cli_");
      expect(f.inspect).not.toHaveBeenCalled();
      expect(f.validate).not.toHaveBeenCalled();
    },
  );

  it("refuses a different external digest instead of approving the record's own digest", async () => {
    const f = await fixture();
    f.argv[f.argv.length - 1] = otherHash;
    await expect(validateRenderedPdfReviewCli(f.argv, f)).rejects.toThrow("digest_not_approved");
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.validate).not.toHaveBeenCalled();
  });

  it("refuses a different expected source identity before inspection", async () => {
    const f = await fixture();
    f.argv[5] = otherHash;
    await expect(validateRenderedPdfReviewCli(f.argv, f)).rejects.toThrow("source_binding_mismatch");
    expect(f.inspect).not.toHaveBeenCalled();
  });

  it("preserves a validator refusal without exposing source text or paths", async () => {
    const f = await fixture();
    f.validate.mockRejectedValue(new Error("rendered_pdf_review_page_binding_mismatch"));
    await expect(validateRenderedPdfReviewCli(f.argv, f)).rejects.toThrow("rendered_pdf_review_page_binding_mismatch");
    expect(renderedPdfReviewCliFailure(new Error("rendered_pdf_review_page_binding_mismatch"))).toEqual({
      status: "refused",
      reasonCode: "rendered_pdf_review_page_binding_mismatch",
    });
    expect(renderedPdfReviewCliFailure(new Error(`private source text at ${f.source}`))).toEqual({
      status: "refused",
      reasonCode: "rendered_pdf_review_cli_validation_failed",
    });
  });
});
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
