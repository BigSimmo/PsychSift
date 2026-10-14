import {
  buildDocxSourceProvenance,
  docxPageSourceProvenanceSchema,
  extractedTextSha256,
} from "@/lib/extractors/docx-source-provenance";
import {
  pdfPageSourceProvenanceSchema,
  PdfSourceProvenanceError,
  validatePdfSourcePages,
} from "@/lib/extractors/pdf-source-provenance";
import {
  buildTextSourceProvenance,
  textPageSourceProvenanceSchema,
  TextSourceProvenanceError,
  validateTextSourcePages,
} from "@/lib/extractors/text-source-provenance";
import {
  extractOriginalXlsxDocument,
  xlsxPageSourceProvenanceSchema,
  validateXlsxSourcePages,
  XlsxSourceProvenanceError,
} from "@/lib/extractors/xlsx-source-provenance";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import JSZip from "jszip";
import { z } from "zod";
import type { ExtractedDocument, ExtractedPage } from "@/lib/types";
import {
  assertDeclaredDocxMediaBudget,
  assertDeclaredDocxTextBudget,
  DocxExtractionBudgetTracker,
} from "@/lib/extractors/docx-extraction-budget";
import {
  assertExtractedPdfBudget,
  isPdfExtractionResourceError,
  isPdfUnreadableError,
  PDF_EXTRACTION_BUDGET,
  PDF_UNREADABLE_PREFIX,
  PdfExtractionBudgetTracker,
  PdfExtractionResourceError,
  PdfUnreadableError,
  type PdfExtractionBudget,
} from "@/lib/extractors/pdf-extraction-budget";
import { resolvePythonBin } from "@/lib/python-bin";

const extractedPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  ocrUsed: z.boolean().optional(),
  needsOcr: z.boolean().optional(),
  metadata: z
    .object({
      source_provenance: z
        .union([
          docxPageSourceProvenanceSchema,
          pdfPageSourceProvenanceSchema,
          textPageSourceProvenanceSchema,
          xlsxPageSourceProvenanceSchema,
        ])
        .optional(),
      // Existing Python PDF diagnostic; validate explicitly without accepting arbitrary metadata.
      image_coverage_ratio: z.number().finite().min(0).max(1).optional(),
    })
    .strict()
    .optional(),
});

const extractedImageSchema = z.object({
  pageNumber: z.number().int().positive().nullable(),
  path: z.string().min(1),
  mimeType: z.string().min(1),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  sourceKind: z.enum(["embedded", "table_crop", "diagram_crop", "page_region", "fallback", "cover_page"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const extractedDocumentSchema = z.object({
  pages: z.array(extractedPageSchema),
  images: z.array(extractedImageSchema),
  warnings: z.array(z.string()).optional(),
  temporaryPaths: z.array(z.string()).optional(),
  extractor: z
    .object({
      name: z.string().min(1).max(100),
      version: z.string().min(1).max(100),
      pymupdf: z.string().max(100).optional(),
      tableStrategy: z.string().max(100).optional(),
    })
    .optional(),
  budgetUsage: z
    .object({
      pages: z.number().int().nonnegative(),
      artifacts: z.number().int().nonnegative(),
      artifactBytes: z.number().int().nonnegative(),
      textBytes: z.number().int().nonnegative(),
    })
    .optional(),
});

export function parseExtractedDocumentPayload(raw: string): ExtractedDocument {
  const payload = JSON.parse(raw);
  const hasXlsxProvenance =
    Array.isArray(payload?.pages) &&
    payload.pages.some(
      (page: { metadata?: { source_provenance?: { format?: string } } }) =>
        page?.metadata?.source_provenance?.format === "xlsx",
    );
  if (hasXlsxProvenance) {
    if (!Array.isArray(payload.images) || payload.images.length)
      throw new XlsxSourceProvenanceError("XLSX_SOURCE_PROVENANCE_INVALID");
    validateXlsxSourcePages(payload.pages);
  }
  const hasTextProvenance =
    Array.isArray(payload?.pages) &&
    payload.pages.some(
      (page: { metadata?: { source_provenance?: { format?: string } } }) =>
        page?.metadata?.source_provenance?.format === "txt",
    );
  if (hasTextProvenance) validateTextSourcePages(payload.pages);
  if (Array.isArray(payload?.pages)) validatePdfSourcePages(payload.pages);
  const result = extractedDocumentSchema.safeParse(payload);
  if (!result.success) {
    if (hasXlsxProvenance) throw new XlsxSourceProvenanceError("XLSX_SOURCE_PROVENANCE_INVALID");
    if (hasTextProvenance) throw new TextSourceProvenanceError("TXT_SOURCE_PROVENANCE_INVALID");
    if (
      Array.isArray(payload?.pages) &&
      payload.pages.some(
        (page: { metadata?: { source_provenance?: { format?: string } } }) =>
          page?.metadata &&
          Object.hasOwn(page.metadata, "source_provenance") &&
          page.metadata.source_provenance?.format !== "docx",
      )
    )
      throw new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_INVALID");
    throw result.error;
  }
  return result.data;
}

export function isUsableFallbackPdfImage(image: {
  data?: Uint8Array | null;
  width?: number | null;
  height?: number | null;
}) {
  return (
    Boolean(image.data?.byteLength) &&
    typeof image.width === "number" &&
    Number.isInteger(image.width) &&
    image.width > 0 &&
    typeof image.height === "number" &&
    Number.isInteger(image.height) &&
    image.height > 0
  );
}

class PdfExtractorProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractorProcessError";
  }
}

// The extractor prints one `PDF_UNREADABLE: <reason>` line; keep only that reason so
// the stored job error is the plain sentence, not a traceback.
function unreadableReason(stderr: string) {
  const line = stderr.split(/\r?\n/).find((entry) => entry.startsWith(PDF_UNREADABLE_PREFIX));
  const reason = line?.slice(PDF_UNREADABLE_PREFIX.length).trim();
  return (reason || "PDF could not be opened.").slice(0, 500);
}

function isRecoverableFallbackPdfImageError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /^Image object .+(?:: (?:data field is empty or invalid|data buffer is empty)| not found)/.test(error.message);
}

export async function terminateProcessTree(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      });
      killer.once("close", () => resolve());
    });
    return;
  }

  // Always attempt a process-group kill first. Skipping when `exitCode` is set
  // left detached grandchildren alive after the leader had already exited.
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    if (child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1_000);
    timer.unref();
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function runPythonPdfExtractor(
  filePath: string,
  outputDir: string,
  limits: PdfExtractionBudget = PDF_EXTRACTION_BUDGET,
  scriptPathOverride?: string,
) {
  const scriptPath = scriptPathOverride ?? path.join(process.cwd(), "worker", "python", "extract_pdf_assets.py");
  const scriptSha256 = extractedTextSha256(await readFile(scriptPath));
  const sourceSha256 = extractedTextSha256(await readFile(filePath));
  const outputJsonPath = path.join(outputDir, "extract.json");
  const budgetPath = path.join(path.dirname(outputDir), "pdf-extraction-budget.json");
  await writeFile(budgetPath, JSON.stringify(limits), "utf8");

  return new Promise<ExtractedDocument>((resolve, reject) => {
    const child = spawn(resolvePythonBin(), [scriptPath, filePath, outputDir, outputJsonPath, budgetPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let deadlineExceeded = false;
    let outputExceeded = false;
    let settled = false;
    let terminationPromise: Promise<void> | null = null;
    const terminate = () => {
      terminationPromise ??= terminateProcessTree(child);
      return terminationPromise;
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };
    const deadline = setTimeout(() => {
      deadlineExceeded = true;
      void terminate();
    }, limits.totalTimeoutMs);
    deadline.unref();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, "utf8") > limits.maxResultBytes) {
        outputExceeded = true;
        void terminate();
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 1024 * 1024) stderr += chunk.toString();
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.on("close", async (code, signal) => {
      await terminationPromise;
      if (deadlineExceeded) {
        finish(() =>
          reject(
            new PdfExtractionResourceError(
              "PDF_EXTRACTION_DEADLINE_EXCEEDED",
              `Python extraction exceeded ${limits.totalTimeoutMs} ms`,
            ),
          ),
        );
        return;
      }
      if (outputExceeded) {
        finish(() =>
          reject(
            new PdfExtractionResourceError(
              "PDF_EXTRACTION_BUDGET_EXCEEDED",
              `extractor stdout exceeded ${limits.maxResultBytes} bytes`,
            ),
          ),
        );
        return;
      }
      if (signal || code === 137) {
        finish(() =>
          reject(
            new PdfExtractorProcessError(stderr || `PDF extractor exited with code ${code} (${signal || "SIGKILL"})`),
          ),
        );
        return;
      }
      if (code !== 0) {
        if (code === 4 || stderr.includes(PDF_UNREADABLE_PREFIX)) {
          finish(() => reject(new PdfUnreadableError(unreadableReason(stderr))));
          return;
        }
        if (code === 3 || stderr.includes("PDF_EXTRACTION_BUDGET_EXCEEDED")) {
          finish(() =>
            reject(
              new PdfExtractionResourceError(
                "PDF_EXTRACTION_BUDGET_EXCEEDED",
                stderr.trim() || "Python extraction exceeded a resource limit",
              ),
            ),
          );
          return;
        }
        finish(() => reject(new Error(stderr || `PDF extractor exited with code ${code}`)));
        return;
      }

      try {
        const outputMetadata = await stat(outputJsonPath).catch(() => null);
        if (outputMetadata && outputMetadata.size > limits.maxResultBytes) {
          throw new PdfExtractionResourceError(
            "PDF_EXTRACTION_BUDGET_EXCEEDED",
            `result JSON exceeds ${limits.maxResultBytes} bytes`,
          );
        }
        const jsonPayload = outputMetadata ? await readFile(outputJsonPath, "utf8") : extractJsonFromStdout(stdout);
        const rawPayload = JSON.parse(jsonPayload);
        if (!Array.isArray(rawPayload?.pages)) throw new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_INVALID");
        validatePdfSourcePages(rawPayload.pages, { sourceSha256, scriptSha256, requireEveryPage: !scriptPathOverride });
        if (
          extractedTextSha256(await readFile(scriptPath)) !== scriptSha256 ||
          extractedTextSha256(await readFile(filePath)) !== sourceSha256
        )
          throw new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
        const extracted = parseExtractedDocumentPayload(jsonPayload);
        await assertExtractedPdfBudget(extracted, jsonPayload, limits);
        finish(() => resolve(extracted));
      } catch (error) {
        finish(() =>
          reject(
            !scriptPathOverride && !(error instanceof PdfSourceProvenanceError) && !isPdfExtractionResourceError(error)
              ? new PdfSourceProvenanceError("PDF_SOURCE_PROVENANCE_INVALID")
              : error,
          ),
        );
      }
    });
  });
}

function extractJsonFromStdout(stdout: string) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return stdout;
  return stdout.slice(start, end + 1);
}

function directPdfDictionaryInteger(dictionary: string, key: "Width" | "Height") {
  const match = dictionary.match(new RegExp(`/${key}\\s+(\\d+)(?:\\s+(\\d+)\\s+R)?\\b`));
  if (!match || match[2] !== undefined) return null;
  return Number(match[1]);
}

/**
 * pdf.js 5 can silently remove an image that exceeds maxImageSize instead of
 * surfacing its worker error. Check ordinary direct image dictionaries too so
 * the ingestion contract still receives a classified resource-budget failure.
 * The parser ceiling remains the fail-safe for compressed or indirect objects.
 */
function assertDeclaredPdfImageDimensions(buffer: Buffer, limits: PdfExtractionBudget) {
  const subtypeMarker = Buffer.from("/Subtype", "latin1");
  const dictionaryStartMarker = Buffer.from("<<", "latin1");
  const dictionaryEndMarker = Buffer.from(">>", "latin1");
  const maxDictionaryBytes = 64 * 1024;
  let offset = 0;
  const budget = new PdfExtractionBudgetTracker(limits);

  while (offset < buffer.length) {
    const subtypeOffset = buffer.indexOf(subtypeMarker, offset);
    if (subtypeOffset === -1) return;
    offset = subtypeOffset + subtypeMarker.length;
    const candidateStart = Math.max(0, subtypeOffset - maxDictionaryBytes);
    const relativeDictionaryStart = buffer.subarray(candidateStart, subtypeOffset).lastIndexOf(dictionaryStartMarker);
    if (relativeDictionaryStart === -1) continue;
    const dictionaryStart = candidateStart + relativeDictionaryStart;
    const candidateEnd = Math.min(buffer.length, dictionaryStart + maxDictionaryBytes + dictionaryEndMarker.length);
    const relativeDictionaryEnd = buffer.subarray(offset, candidateEnd).indexOf(dictionaryEndMarker);
    if (relativeDictionaryEnd === -1) continue;
    const dictionaryEnd = offset + relativeDictionaryEnd;
    const dictionary = buffer.subarray(dictionaryStart, dictionaryEnd + dictionaryEndMarker.length).toString("latin1");
    if (!/\/Subtype\s*\/Image\b/.test(dictionary)) continue;
    const width = directPdfDictionaryInteger(dictionary, "Width");
    const height = directPdfDictionaryInteger(dictionary, "Height");
    if (width !== null && height !== null) budget.assertRenderDimensions(width, height);
  }
}

export async function extractPdf(
  buffer: Buffer,
  options: { limits?: PdfExtractionBudget; scriptPathOverride?: string } = {},
) {
  const limits = options.limits ?? PDF_EXTRACTION_BUDGET;
  const tempRoot = await mkdtemp(path.join(tmpdir(), "clinical-kb-"));
  const pdfPath = path.join(tempRoot, "document.pdf");
  const imageDir = path.join(tempRoot, "images");
  await mkdir(imageDir, { recursive: true });
  await writeFile(pdfPath, buffer);

  try {
    const extracted = await runPythonPdfExtractor(pdfPath, imageDir, limits, options.scriptPathOverride);
    validatePdfSourcePages(extracted.pages, {
      sourceSha256: extractedTextSha256(buffer),
      scriptSha256: extractedTextSha256(
        await readFile(
          options.scriptPathOverride ?? path.join(process.cwd(), "worker", "python", "extract_pdf_assets.py"),
        ),
      ),
      requireEveryPage: !options.scriptPathOverride,
    });
    return { ...extracted, temporaryPaths: [tempRoot] };
  } catch (error) {
    if (
      isPdfExtractionResourceError(error) ||
      isPdfUnreadableError(error) ||
      error instanceof PdfExtractorProcessError ||
      error instanceof PdfSourceProvenanceError
    ) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    // Fallback for developer machines without PyMuPDF/pytesseract. It still
    // indexes text PDFs, but scanned PDFs and image extraction need the Python
    // helper dependencies listed in worker/python/requirements.txt.
    const textParser = new PDFParse({
      data: buffer,
      maxImageSize: limits.maxRenderPixels,
    });
    const imageParser = new PDFParse({
      data: buffer,
      maxImageSize: limits.maxRenderPixels,
      // pdf.js only raises its pre-decode maxImageSize rejection when parse
      // errors are not ignored. Scope this to image extraction so unrelated
      // recoverable PDF errors do not block text fallback extraction.
      stopAtErrors: true,
    });
    try {
      assertDeclaredPdfImageDimensions(buffer, limits);
      const parsed = await textParser.getText();
      const budget = new PdfExtractionBudgetTracker(limits);
      const rawPages: ExtractedPage[] =
        parsed.pages.length > 0
          ? parsed.pages.map((page: { num: number; text?: string }) => ({
              pageNumber: page.num,
              text: page.text || "",
              ocrUsed: false,
            }))
          : [{ pageNumber: 1, text: parsed.text || "", ocrUsed: false }];
      for (const page of rawPages) budget.addPage(page.text);

      const images: ExtractedDocument["images"] = [];
      const imageCountByPage = new Map<number, number>();
      const malformedImagePages = new Set<number>();
      // Extract one page at a time so aggregate limits can stop subsequent decoding, and
      // request only binary data to avoid holding a duplicate base64 representation.
      for (const rawPage of rawPages) {
        let imageResult: Awaited<ReturnType<PDFParse["getImage"]>>;
        try {
          imageResult = await imageParser.getImage({
            partial: [rawPage.pageNumber],
            imageBuffer: true,
            imageDataUrl: false,
            imageThreshold: 20,
          });
        } catch (imageError) {
          if (!isRecoverableFallbackPdfImageError(imageError)) throw imageError;
          imageCountByPage.set(rawPage.pageNumber, (imageCountByPage.get(rawPage.pageNumber) ?? 0) + 1);
          malformedImagePages.add(rawPage.pageNumber);
          continue;
        }
        for (const page of imageResult.pages) {
          imageCountByPage.set(page.pageNumber, (imageCountByPage.get(page.pageNumber) ?? 0) + page.images.length);
          for (const [index, image] of page.images.entries()) {
            if (!isUsableFallbackPdfImage(image)) continue;
            budget.assertRenderDimensions(image.width, image.height);
            budget.assertArtifact(image.data.byteLength);
            const mimeType = "image/png";
            const extension = mimeType.includes("jpeg") ? "jpg" : "png";
            const outputPath = path.join(imageDir, `fallback-page-${page.pageNumber}-image-${index + 1}.${extension}`);
            const bytes = Buffer.from(image.data);
            budget.addArtifact(bytes.byteLength);
            await writeFile(outputPath, bytes);
            images.push({
              pageNumber: page.pageNumber,
              path: outputPath,
              mimeType,
              bbox: null,
              width: image.width,
              height: image.height,
              sourceKind: "fallback",
              metadata: { source_kind: "fallback" },
            });
          }
        }
      }
      await textParser.destroy();
      await imageParser.destroy();

      // IDX-H3: the JS fallback cannot OCR. A scanned / image-only page yields little or no
      // embedded text, so without flagging it the document would index as near-empty yet still
      // be marked "indexed" — invisible to retrieval. Mark any page that has image content but
      // below-threshold text as needsOcr so index_quality surfaces it (and the worker refuses
      // to mark an image-only PDF as fully indexed).
      const JS_FALLBACK_MIN_TEXT_CHARS = 40;
      const pages: ExtractedPage[] = rawPages.map((page) => {
        const textLength = page.text.trim().length;
        const hasImages = (imageCountByPage.get(page.pageNumber) ?? 0) > 0;
        const needsOcr = textLength < JS_FALLBACK_MIN_TEXT_CHARS && hasImages;
        return { pageNumber: page.pageNumber, text: page.text, ocrUsed: false, needsOcr };
      });

      const warnings = ["Used JavaScript PDF fallback; install Python PDF/OCR prerequisites for scanned PDFs."];
      if (malformedImagePages.size > 0) {
        warnings.push(
          `malformed_fallback_images: skipped unusable image data on ${malformedImagePages.size} page(s); review or OCR sparse pages.`,
        );
      }
      const ocrNeededPages = pages.filter((page) => page.needsOcr).length;
      if (ocrNeededPages > 0) {
        warnings.push(`needs_ocr: ${ocrNeededPages} page(s) appear image-only and were not OCR'd by the JS fallback.`);
      }

      const result = { pages, images, warnings, temporaryPaths: [tempRoot] };
      budget.assertResult(JSON.stringify(result));
      return result;
    } catch (fallbackError) {
      await textParser.destroy().catch(() => undefined);
      await imageParser.destroy().catch(() => undefined);
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      if (fallbackError instanceof Error && fallbackError.message.includes("Image exceeded maximum allowed size")) {
        throw new PdfExtractionResourceError(
          "PDF_EXTRACTION_BUDGET_EXCEEDED",
          `embedded image exceeds ${limits.maxRenderPixels} pixels`,
        );
      }
      throw fallbackError;
    }
  }
}

async function extractDocx(buffer: Buffer) {
  const budget = new DocxExtractionBudgetTracker();
  const zip = await JSZip.loadAsync(buffer);
  const wordXml = Object.keys(zip.files)
    .filter((name) => name.startsWith("word/") && name.endsWith(".xml"))
    .map((name) => zip.files[name])
    .filter((entry) => !entry.dir);
  assertDeclaredDocxTextBudget(wordXml);
  const media = Object.keys(zip.files)
    .filter((name) => name.startsWith("word/media/"))
    .map((name) => [name, zip.files[name]] as const)
    .filter((entry) => !entry[1].dir);
  assertDeclaredDocxMediaBudget(media.map((entry) => entry[1]));

  // Validate bounded namespace-aware source XML before the existing text reader.
  const provenance = await buildDocxSourceProvenance({ zip, buffer, originalText: "" });
  const raw = await mammoth.extractRawText({ buffer });
  const textHash = extractedTextSha256(raw.value || "");
  provenance.textIdentity.originalExtractedTextSha256 = textHash;
  provenance.textIdentity.persistedTextSha256 = textHash;
  budget.assertText(raw.value || "");

  const tempRoot = await mkdtemp(path.join(tmpdir(), "clinical-kb-docx-"));
  const images: ExtractedDocument["images"] = [];

  try {
    for (const [index, [name, file]] of media.entries()) {
      const bytes = await file.async("nodebuffer");
      budget.addArtifact(bytes.byteLength);
      const ext = path.extname(name).toLowerCase() || ".png";
      // Map the actual media extension to its real MIME type. Previously every
      // non-jpg/webp extension (including .emf/.wmf/.tiff/.bmp/.gif vector and
      // legacy-raster figures common in clinical .docx) was mislabeled image/png,
      // which was then written to storage/DB and sent to the vision API as PNG.
      const docxImageMimeByExt: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".emf": "image/emf",
        ".wmf": "image/wmf",
        ".svg": "image/svg+xml",
      };
      const mimeType = docxImageMimeByExt[ext] ?? "application/octet-stream";
      const outputPath = path.join(tempRoot, `docx-image-${index}${ext}`);
      await writeFile(outputPath, bytes);
      images.push({
        pageNumber: null,
        path: outputPath,
        mimeType,
        bbox: null,
        width: null,
        height: null,
        sourceKind: "embedded",
        metadata: { source_kind: "docx_media", file_name: name },
      });
    }

    return {
      pages: [{ pageNumber: 1, text: raw.value || "", ocrUsed: false, metadata: { source_provenance: provenance } }],
      images,
      temporaryPaths: [tempRoot],
    } satisfies ExtractedDocument;
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function assertOoxmlArchiveBudget(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > 10_000) throw new Error("OOXML archive contains too many entries.");
  const expandedBytes = entries.reduce((total, file) => {
    const data = (file as unknown as { _data?: { uncompressedSize?: number } })._data;
    return total + Math.max(0, Number(data?.uncompressedSize ?? 0));
  }, 0);
  const maxExpandedBytes = 512 * 1024 * 1024;
  const maxRatioBytes = Math.max(buffer.byteLength * 100, 16 * 1024 * 1024);
  if (expandedBytes > maxExpandedBytes || expandedBytes > maxRatioBytes) {
    throw new Error("OOXML archive exceeds the safe expanded-size budget.");
  }
}

function extractTxt(buffer: Buffer, knownText = false) {
  const text = buffer.toString("utf8");
  const metadata = knownText ? { source_provenance: buildTextSourceProvenance(buffer, text) } : undefined;
  return {
    pages: [{ pageNumber: 1, text, ocrUsed: false, ...(metadata ? { metadata } : {}) }],
    images: [],
  } satisfies ExtractedDocument;
}

export async function extractDocument(args: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<ExtractedDocument> {
  if (args.mimeType === "application/pdf" || args.fileName.toLowerCase().endsWith(".pdf")) {
    return extractPdf(args.buffer);
  }

  if (
    args.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    args.fileName.toLowerCase().endsWith(".docx")
  ) {
    await assertOoxmlArchiveBudget(args.buffer);
    return extractDocx(args.buffer);
  }

  if (
    args.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    args.fileName.toLowerCase().endsWith(".xlsx")
  ) {
    return extractOriginalXlsxDocument(args.buffer);
  }

  return extractTxt(args.buffer, args.mimeType === "text/plain" || args.fileName.toLowerCase().endsWith(".txt"));
}
