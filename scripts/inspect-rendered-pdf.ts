/** Private local inspection; deliberately emits no source text or artifact paths.
 * node --import tsx --import ./scripts/enable-server-only-stub.mjs
 *   scripts/inspect-rendered-pdf.ts original.pdf private-artifact-root sha256:...
 * Retained run directories are owned by the caller. This does not admit evidence.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRenderedPdfOriginal } from "../worker/rendered-pdf-inspection-producer";

async function main() {
  const [source, artifactRoot, expectedSha256] = process.argv.slice(2);
  if (!source || !artifactRoot || !expectedSha256 || process.argv.length !== 5)
    throw new Error("inspection_arguments_invalid");
  const result = await inspectRenderedPdfOriginal(source, artifactRoot, expectedSha256);
  console.log(
    JSON.stringify({
      version: result.version,
      status: result.status,
      sourceSha256: result.sourceSha256,
      sourceByteLength: result.sourceByteLength,
      pageCount: result.pageCount,
      nativeLayerDisposition: result.nativeLayerDisposition,
      runtime: result.runtime,
      pageText: result.extraction.pages.map((page) => ({
        pageNumber: page.pageNumber,
        utf8Bytes: Buffer.byteLength(page.text),
        textSha256: `sha256:${createHash("sha256").update(page.text).digest("hex")}`,
        ocrUsed: page.ocrUsed,
        needsOcr: page.needsOcr,
      })),
      imageCount: result.extraction.images.length,
      budgetUsage: result.budgetUsage,
      limitations: result.limitations,
    }),
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error: unknown) => {
    const reason =
      error instanceof Error && /^(?:rendered_pdf_inspection_[a-z_]+|inspection_arguments_invalid)$/.test(error.message)
        ? error.message
        : "rendered_pdf_inspection_failed";
    console.error(JSON.stringify({ status: "refused", reasonCode: reason }));
    process.exitCode = 1;
  });
}
