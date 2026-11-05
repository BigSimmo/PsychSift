/** Offline structural validation only; never issues an approval or starts ingestion. */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { inspectRenderedPdfOriginal } from "../worker/rendered-pdf-inspection-producer";
import {
  renderedPdfReviewDigest,
  renderedPdfReviewSchema,
  validateRenderedPdfReview,
} from "../worker/rendered-pdf-review";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const sha = /^sha256:[a-f0-9]{64}$/;
const MAX_REVIEW_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 150 * 1024 * 1024;
const flags = ["--source", "--artifact-root", "--source-sha256", "--review", "--approved-review-sha256"];

function refuse(reason: string): never {
  throw new Error(`rendered_pdf_review_cli_${reason}`);
}

async function boundedFile(file: string, maximum: number): Promise<Buffer> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum) refuse("file_invalid");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size)
      refuse("file_changed");
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length !== info.size) refuse("file_changed");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/** Dependencies allow synthetic wiring checks without running an OCR process. */
export async function validateRenderedPdfReviewCli(
  argv: readonly string[],
  dependencies: {
    inspect?: typeof inspectRenderedPdfOriginal;
    validate?: typeof validateRenderedPdfReview;
  } = {},
) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!;
    const value = argv[index + 1];
    if (!flags.includes(flag) || args.has(flag) || !value || /[\u0000-\u001f\u007f]/.test(value))
      refuse("arguments_invalid");
    args.set(flag, value);
  }
  if (args.size !== flags.length) refuse("arguments_invalid");
  const source = args.get("--source")!;
  const artifactRoot = args.get("--artifact-root")!;
  const reviewFile = args.get("--review")!;
  const sourceSha256 = args.get("--source-sha256")!;
  const approvedDigest = args.get("--approved-review-sha256")!;
  if (
    ![source, artifactRoot, reviewFile].every((file) => path.isAbsolute(file)) ||
    !sha.test(sourceSha256) ||
    !sha.test(approvedDigest)
  )
    refuse("arguments_invalid");

  const reviewBytes = await boundedFile(reviewFile, MAX_REVIEW_BYTES);
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reviewBytes));
  } catch {
    refuse("record_invalid");
  }
  const parsed = renderedPdfReviewSchema.safeParse(input);
  if (!parsed.success) refuse("record_invalid");
  const review = parsed.data;
  if (renderedPdfReviewDigest(review) !== approvedDigest) refuse("digest_not_approved");
  if (review.sourceSha256 !== sourceSha256) refuse("source_binding_mismatch");

  const originalBytes = await boundedFile(source, MAX_SOURCE_BYTES);
  const inspection = await (dependencies.inspect ?? inspectRenderedPdfOriginal)(source, artifactRoot, sourceSha256);
  const result = await (dependencies.validate ?? validateRenderedPdfReview)({
    review,
    inspection,
    sourcePath: source,
    originalBytes,
    approvedReviewSha256: new Set([approvedDigest]),
  });
  return {
    status: "structurally_validated",
    scope: "render_review_only_not_owner_authentication_or_clinical_acceptance",
    sourceSha256: review.sourceSha256,
    reviewSha256: result.reviewSha256,
    pageCount: result.reviewedPages.length,
    tableCount: result.reviewedTables.length,
    diagramCount: result.reviewedDiagrams.length,
  };
}

export function renderedPdfReviewCliFailure(error: unknown) {
  const reasonCode =
    error instanceof Error && /^rendered_pdf_(?:review(?:_cli)?|inspection)_[a-z_]+$/.test(error.message)
      ? error.message
      : "rendered_pdf_review_cli_validation_failed";
  return { status: "refused", reasonCode };
}

if (isDirectEntrypoint(import.meta.url)) {
  void validateRenderedPdfReviewCli(process.argv.slice(2)).then(
    (result) => console.log(JSON.stringify(result)),
    (error: unknown) => {
      console.error(JSON.stringify(renderedPdfReviewCliFailure(error)));
      process.exitCode = 1;
    },
  );
}
