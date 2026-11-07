import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { describe, expect, it, vi } from "vitest";
import { extractPdf } from "../src/lib/extractors/document";
import { resolvePythonBin } from "../src/lib/python-bin";
import { EMBEDDING_MAX_INPUT_UTF8_BYTES } from "../src/lib/embedding-input-budget";
import {
  bytesDigest,
  generationEvidenceBytes,
  originalApplicabilityFamilies,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import {
  buildGenerationRetentionPacket,
  captureGenerationImages,
  type CapturedGenerationImage,
} from "../worker/generation-evidence";
import { prepareNativeTextPdfCandidateChunks, stageCandidateChunks } from "../worker/candidate-chunks";
import { GENERAL_PDF_INSPECTION_VERSION, generalPdfInspectionReviewSchema } from "../worker/general-pdf-inspection";
import {
  buildManagedGeneralPdfChunks,
  completeManagedGeneralPdfAttempt,
  decodeManagedGeneralPdfTerminalReadback,
  GENERAL_PDF_TEXT_PROFILE,
  prepareManagedGeneralPdfTerminalPacket,
} from "../worker/managed-general-pdf-terminal";
import type { ExtractedDocument } from "../src/lib/types";

const documentId = "00000000-0000-4000-8000-000000000001";
const generationId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";
const lease = "00000000-0000-4000-8000-000000000004";
const ownerId = "00000000-0000-4000-8000-000000000005";
const issued = {
  documentId,
  generationId,
  jobId,
  workerId: "test-worker",
  firstLeaseToken: lease,
  attemptNumber: 1,
  batchId: null,
  authorityDigest: `sha256:${"a".repeat(64)}`,
  predecessorGenerationId: null,
};
function fixture(
  texts = ["Synthetic source α😀 qualification.\n", "Second literal source page.\n"],
  originalBytes: Buffer = Buffer.from("%PDF-synthetic-only"),
  extracted?: ExtractedDocument,
  capturedImages?: readonly CapturedGenerationImage[],
) {
  const sourceUnits = texts.map((text, index) => ({
    id: `native-page-${index + 1}`,
    required: true,
    dependencies: [],
    locator: `pdf-page:${index + 1}:native-text:${bytesDigest(Buffer.from(text))}`,
    nativeMapping: "unavailable" as const,
  }));
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: {
        tag: "known",
        requirements:
          family === "chunks"
            ? sourceUnits.map((unit) => ({ id: `chunks-${unit.id}`, required: true, sourceEvidenceIds: [unit.id] }))
            : [],
        basis: { scope: "whole_original", kind: "independent_original_declaration" },
        reason: family === "chunks" ? null : "no_original_requirements_in_scope",
      },
    })),
  };
  const witnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(originalBytes),
    tag: "known",
    units: sourceUnits,
    witness: { reference: "synthetic-independent-native-text-scope", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const doc: ExtractedDocument = extracted ?? {
    pages: texts.map((text, index) => ({ pageNumber: index + 1, text, ocrUsed: false })),
    images: [],
  };
  const packet = buildGenerationRetentionPacket({
    documentId,
    generationId,
    originalBytes,
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    extracted: doc,
    capturedImages,
    persistedPages: doc.pages.map((page) => ({
      document_id: documentId,
      page_number: page.pageNumber,
      text: page.text,
      ocr_used: page.ocrUsed ?? false,
      metadata: page.metadata ?? {},
    })),
    deferOptionalProducerDeclarations: true,
  });
  const inspection = generalPdfInspectionReviewSchema.parse({
    version: GENERAL_PDF_INSPECTION_VERSION,
    binding: {
      admissionEventId: "00000000-0000-4000-8000-000000000006",
      documentId,
      generationId,
      jobId,
      attemptId: `${jobId}:1:${lease}`,
      leaseId: lease,
      contentSha256: bytesDigest(originalBytes),
      authorityDigest: issued.authorityDigest,
    },
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    pageCount: texts.length,
    pages: texts.map((text, index) => ({ pageNumber: index + 1, text, textSha256: bytesDigest(Buffer.from(text)) })),
    pageInventory: "complete",
    activeContent: "absent",
    encryption: "not_encrypted",
    hiddenText: "consistent",
    inspectedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const input = { packet, originalBytes, witnessBytes, extracted: doc, inspection, documentId };
  const chunkRows = buildManagedGeneralPdfChunks(input);
  const terminal = prepareManagedGeneralPdfTerminalPacket({ ...input, issued, ownerId, chunkRows });
  return { ...input, chunkRows, terminal, witness, sourceExpectation };
}
function attempt() {
  return new IngestionAttempt({
    job_kind: "node",
    job_id: jobId,
    document_id: documentId,
    worker_id: issued.workerId,
    lease_token: lease,
    expected_generation_id: null,
    authority_digest: issued.authorityDigest,
  });
}
function response(
  packet: ReturnType<typeof fixture>["terminal"],
  replay: "completed" | "already_completed" = "already_completed",
) {
  const bytes = generationEvidenceBytes({
    version: "managed-general-pdf-seal-v1",
    packet,
    scope: GENERAL_PDF_TEXT_PROFILE,
    activated: true,
    clinicalApproval: "not_assessed",
    publicationApproval: "not_granted",
    visualFidelity: "not_assessed",
  });
  return {
    ok: true,
    managedGeneralPdfTerminal: {
      status: "general_pdf_text_completed",
      replay,
      activated: true,
      seal: { bytesHex: bytes.toString("hex"), sha256: bytesDigest(bytes), byteLength: bytes.length },
    },
  };
}

describe("dynamic managed native PDF text completion", () => {
  it.each([
    ["CJK", "漢字".repeat(6000) + " \t".repeat(2000)],
    ["emoji", "😀".repeat(5000) + " \t".repeat(2000)],
    ["surrogate boundary", "a".repeat(8190) + "😀" + "z".repeat(2000)],
    ["long trailing whitespace", "A".repeat(6000) + " ".repeat(8000)],
  ])("keeps %s source partitions exact within the embedding UTF8 byte bound", (_label, text) => {
    const f = fixture([text]);
    expect(f.chunkRows.map((row) => row.content).join("")).toBe(text);
    expect(f.chunkRows.every((row) => row.content.isWellFormed() && row.content.trim().length > 0)).toBe(true);
    expect(
      f.chunkRows
        .map((row) => Buffer.byteLength(row.content))
        .every((bytes) => bytes <= EMBEDDING_MAX_INPUT_UTF8_BYTES),
    ).toBe(true);
    let offset = 0;
    for (const chunk of f.terminal.chunks) {
      expect(chunk.start).toBe(offset);
      offset = chunk.end;
    }
    expect(offset).toBe(Buffer.byteLength(text));
  });
  it("refuses a whitespace-only page or a trailing whitespace span that cannot fit with a source character", () => {
    expect(() => fixture([" \t\n"])).toThrow("whitespace_only_page_unsupported");
    expect(() => fixture(["X" + " ".repeat(EMBEDDING_MAX_INPUT_UTF8_BYTES)])).toThrow(
      "whitespace_tail_exceeds_embedding_budget",
    );
  });
  it("partitions every page including unicode into literal stable chunks without a fixed PDF or page count", () => {
    const texts = ["Qualification α😀. ".repeat(500), "", "Final exact source text.\n"];
    const f = fixture(texts);
    for (let page = 1; page <= texts.length; page++) {
      expect(
        f.chunkRows
          .filter((row) => row.page_number === page)
          .map((row) => row.content)
          .join(""),
      ).toBe(texts[page - 1]);
    }
    expect(f.terminal.pages).toHaveLength(3);
    expect(f.chunkRows).toHaveLength(3);
    expect(f.chunkRows.every((row) => row.content.isWellFormed())).toBe(true);
    expect(f.terminal.quality.issues).toContain("optional_enrichment_deferred");
    expect(buildManagedGeneralPdfChunks(f)).toEqual(f.chunkRows);
  });
  it("refuses missing pages, OCR, images, stale inspection and source-byte substitution before embedding", () => {
    const f = fixture();
    const build = (patch: Partial<typeof f>) => () => buildManagedGeneralPdfChunks({ ...f, ...patch });
    expect(build({ extracted: { ...f.extracted, pages: f.extracted.pages.slice(1) } })).toThrow("extraction_mismatch");
    expect(
      build({ extracted: { ...f.extracted, pages: f.extracted.pages.map((p) => ({ ...p, ocrUsed: true })) } }),
    ).toThrow("extraction_mismatch");
    expect(build({ extracted: { ...f.extracted, images: [{} as ExtractedDocument["images"][number]] } })).toThrow(
      "unsupported_visual",
    );
    expect(build({ originalBytes: Buffer.from("%PDF-other") })).toThrow("source_binding_mismatch");
    expect(build({ inspection: { ...f.inspection, expiresAt: new Date(Date.now() - 1).toISOString() } })).toThrow(
      "review_not_current",
    );
    expect(() =>
      prepareManagedGeneralPdfTerminalPacket({
        ...f,
        issued: { ...issued, firstLeaseToken: ownerId },
        ownerId,
        chunkRows: f.chunkRows,
      }),
    ).toThrow("identity_or_chunk_mismatch");
  });
  it("rejects independent image obligations even when the extraction has no image", () => {
    const f = fixture();
    const witness = structuredClone(f.witness);
    const images = witness.groups.find((group) => group.family === "images")!;
    images.population = {
      tag: "known",
      requirements: [{ id: "required-image", required: true, sourceEvidenceIds: [witness.sourceUnits[0].id] }],
      basis: { scope: "whole_original", kind: "independent_original_declaration" },
      reason: null,
    };
    const witnessBytes = generationEvidenceBytes(witness);
    const packet = {
      ...f.packet,
      registration: {
        ...f.packet.registration,
        sourceExpectation: {
          ...f.sourceExpectation,
          witness: { reference: "independent-visual-required", sha256: bytesDigest(witnessBytes) },
        },
      },
    };
    expect(() => buildManagedGeneralPdfChunks({ ...f, packet, witnessBytes })).toThrow(
      "unsupported_original_requirements",
    );
  });
  it("uses only a completed read after a lost acknowledgement; never repeats terminal mutation", async () => {
    const f = fixture();
    const a = attempt();
    const stopHeartbeat = vi.fn();
    const rpc = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost acknowledgement"))
      .mockResolvedValueOnce({ data: response(f.terminal), error: null });
    await completeManagedGeneralPdfAttempt({ attempt: a, packet: f.terminal, rpc, stopHeartbeat });
    expect(stopHeartbeat).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.map((call) => call[1].p_read_only)).toEqual([false, true]);
    expect(rpc.mock.calls.every((call) => call[0] === "complete_managed_general_pdf")).toBe(true);
    expect(() => a.check()).toThrow();
  });
  it("does not certify a successful acknowledgement whose packet or seal is different", () => {
    const f = fixture();
    const changed = response(f.terminal);
    changed.managedGeneralPdfTerminal.seal.sha256 = `sha256:${"f".repeat(64)}`;
    expect(() => decodeManagedGeneralPdfTerminalReadback(f.terminal, changed)).toThrow();
    expect(() =>
      decodeManagedGeneralPdfTerminalReadback(
        f.terminal,
        response({ ...f.terminal, identity: { ...f.terminal.identity, generationId: ownerId } }),
      ),
    ).toThrow("receipt_mismatch");
  });
  it("rejects an incomplete embedding batch before any chunk write", async () => {
    const f = fixture();
    const plan = prepareNativeTextPdfCandidateChunks(f);
    const mutation = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      expect(payload.p_generation).toBe(generationId);
      expect(name).not.toBe("write_ingestion_base_artifacts");
      return { ok: true };
    });
    await expect(
      stageCandidateChunks({
        plan,
        batchSize: 1,
        embed: async () => [],
        assertEmbedding: (v) => v,
        mutation,
        check: () => undefined,
      }),
    ).rejects.toThrow("embedding_population_mismatch");
    expect(mutation.mock.calls.some((call) => call[0] === "write_ingestion_base_artifacts")).toBe(false);
  });
  it("refuses a cancelled lease before calling the terminal", async () => {
    const f = fixture();
    const a = attempt();
    const rpc = vi.fn();
    a.cancel();
    await expect(
      completeManagedGeneralPdfAttempt({ attempt: a, packet: f.terminal, rpc, stopHeartbeat: vi.fn() }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});

const hasPyMuPDF = spawnSync(resolvePythonBin(), ["-c", "import pymupdf as fitz"], { encoding: "utf8" }).status === 0;
it.runIf(hasPyMuPDF)(
  "runs a real synthetic PDF reader through exact chunks, mocked embeddings, fenced staging and terminal readback",
  async () => {
    const originalBytes = await new Promise<Buffer>((resolve, reject) => {
      const parts: Buffer[] = [];
      const doc = new PDFDocument({ margin: 50 });
      doc.on("data", (part) => parts.push(Buffer.from(part)));
      doc.on("error", reject);
      doc.on("end", () => resolve(Buffer.concat(parts)));
      doc.text("Synthetic reference page one. Complete qualification.");
      doc.addPage().text("Synthetic reference page two. Retain the final sentence.");
      doc.end();
    });
    const extracted = await extractPdf(originalBytes);
    try {
      const capturedImages = await captureGenerationImages({
        extracted,
        trustedTemporaryRoots: extracted.temporaryPaths ?? [],
        fileName: "synthetic-native.pdf",
        mimeType: "application/pdf",
      });
      const f = fixture(
        extracted.pages.map((page) => page.text),
        originalBytes,
        extracted,
        capturedImages,
      );
      const plan = prepareNativeTextPdfCandidateChunks(f);
      const a = attempt();
      expect(f.terminal.retainedImageCount).toBe(extracted.images.length);
      const mutation = vi.fn(async (name: string, payload: Record<string, unknown>) => {
        a.check();
        if (name === "write_ingestion_base_artifacts") {
          expect(payload.p_generation).toBe(generationId);
          return {
            ok: true,
            chunkEvidence: (payload.p_chunks as typeof f.chunkRows).map((row) => ({
              preparedUnitId: { family: "chunks", key: `${row.id}:prepared` },
              finalUnitId: { family: "chunks", key: `${row.id}:final` },
              preparedSha256: plan.artifacts.find((artifact) => artifact.unitId.key === `${row.id}:prepared`)!.sha256,
              finalSha256: bytesDigest(generationEvidenceBytes(row)),
              finalByteLength: generationEvidenceBytes(row).length,
            })),
          };
        }
        if (name === "record_ingestion_generation_accounting")
          return { ok: true, accounting: { result: "unavailable" } };
        return { ok: true };
      });
      const embed = vi.fn(async (texts: string[]) =>
        texts.map(() => Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0))),
      );
      const stage = await stageCandidateChunks({
        plan,
        batchSize: 1,
        embed,
        assertEmbedding: (v) => v,
        mutation,
        check: () => a.check(),
      });
      expect(stage.persistedChunks).toBe(f.chunkRows.length);
      expect(embed.mock.calls.flatMap((call) => call[0])).toEqual(f.chunkRows.map((row) => row.content));
      const rpc = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
        expect(payload.p_fence).toEqual(a.fence);
        return { data: response(f.terminal, payload.p_read_only ? "already_completed" : "completed"), error: null };
      });
      await completeManagedGeneralPdfAttempt({ attempt: a, packet: f.terminal, rpc, stopHeartbeat: vi.fn() });
      expect(rpc).toHaveBeenCalledTimes(2);
    } finally {
      await Promise.all(
        (extracted.temporaryPaths ?? []).map((directory) => rm(directory, { recursive: true, force: true })),
      );
    }
  },
  30000,
);
