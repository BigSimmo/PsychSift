import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import { resolvePythonBin } from "../src/lib/python-bin";
import {
  GENERAL_PDF_INSPECTION_VERSION,
  GENERAL_PDF_MAX_SOURCE_BYTES,
  generalPdfInspectionReviewSchema,
  inspectGeneralPdfSource,
  type GeneralPdfInspectionReview,
} from "./general-pdf-inspection";

const structuralResult = generalPdfInspectionReviewSchema
  .omit({
    version: true,
    binding: true,
    inspectedAt: true,
    expiresAt: true,
  })
  .extend({
    version: z.literal("native-pdf-structural-inspection-v1"),
    status: z.literal("inspected"),
    profile: z.literal("visible-native-text-conservative-v1"),
    producer: z.object({ pymupdfVersion: z.string().min(1).max(100) }).strict(),
    limitations: z.tuple([
      z.literal("not_clinical_or_semantic_completeness"),
      z.literal("not_table_or_image_acceptance"),
      z.literal("unsupported_display_features_refused"),
    ]),
  })
  .strict();

function refuse(reason: string): never {
  throw new Error(`general_pdf_inspection_producer_${reason}`);
}

/** Actually inspects a detached private original in a bounded parser subprocess.
 * This establishes the narrow structural profile only, never legal permission,
 * independent clinical obligations, table relationships or image completeness. */
export async function inspectNativePdfBytes(
  bytes: Uint8Array,
  binding: Readonly<ProviderEgressBinding>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<GeneralPdfInspectionReview> {
  options.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) return refuse("timeout_invalid");
  if (bytes.length < 1 || bytes.length > GENERAL_PDF_MAX_SOURCE_BYTES) return refuse("source_budget_exceeded");
  const original = Buffer.from(bytes);
  const sourceSha256 = `sha256:${createHash("sha256").update(original).digest("hex")}`;
  if (sourceSha256 !== binding.contentSha256) return refuse("source_binding_mismatch");
  const sourceBinding = { ...binding };
  const inspectedAt = new Date().toISOString();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "psychsift-source-inspection-"));
  try {
    const sourcePath = path.join(temporary, "source.pdf");
    await writeFile(sourcePath, original, { mode: 0o600, flag: "wx" });
    options.signal?.throwIfAborted();
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        resolvePythonBin(),
        [
          path.join(process.cwd(), "worker", "python", "inspect_native_pdf_source.py"),
          sourcePath,
          String(timeoutMs / 1000),
        ],
        {
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
          signal: options.signal,
        },
        (error, output) => {
          if (error) {
            // Never surface parser output, private paths or document bytes in logs.
            let code = "failed";
            try {
              const result = JSON.parse(output) as { status?: unknown; reason?: unknown };
              if (
                result.status === "refused" &&
                typeof result.reason === "string" &&
                /^[a-z_]{1,80}$/.test(result.reason)
              )
                code = result.reason;
            } catch {
              /* A timeout, abort or malformed response is a refusal. */
            }
            reject(new Error(`general_pdf_inspection_producer_${code}`));
          } else resolve(output);
        },
      );
    });
    options.signal?.throwIfAborted();
    let output: unknown;
    try {
      output = JSON.parse(stdout);
    } catch {
      return refuse("response_invalid");
    }
    const parsed = structuralResult.safeParse(output);
    if (!parsed.success) return refuse("response_invalid");
    const result = parsed.data;
    const review: GeneralPdfInspectionReview = {
      version: GENERAL_PDF_INSPECTION_VERSION,
      binding: sourceBinding,
      sourceSha256: result.sourceSha256,
      sourceByteLength: result.sourceByteLength,
      pageCount: result.pageCount,
      pages: result.pages,
      pageInventory: result.pageInventory,
      activeContent: result.activeContent,
      encryption: result.encryption,
      hiddenText: result.hiddenText,
      inspectedAt,
      expiresAt: new Date(Date.parse(inspectedAt) + 3600000).toISOString(),
    };
    inspectGeneralPdfSource(review, original, sourceBinding);
    return review;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
