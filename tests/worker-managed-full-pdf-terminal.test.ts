import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { resolvePythonBin } from "../src/lib/python-bin";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceDigest,
} from "../src/lib/ingestion-generation-evidence";
import { buildGenerationRetentionPacket } from "../worker/generation-evidence";
import { inspectRichPdfBytes } from "../worker/rich-pdf-inspection-producer";
import {
  buildInternalRichPdfExpectation,
  prepareManagedFullPdfGeneration,
  runManagedFullPdfGeneration,
} from "../worker/managed-full-pdf-terminal";
import { prepareManagedPdfSummaryContext, prepareManagedPdfSummaryProjection } from "../worker/managed-pdf-summary";
import { normalizeSourceAnchoredSummary } from "../supabase/functions/_shared/source-anchored-summary";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import type { JobRow } from "../worker/types";
const ids = Array.from({ length: 6 }, (_, i) => `72000000-0000-4000-8000-00000000000${i + 1}`);
function source(kind: "table" | "figure" | "scan") {
  const code =
    `import pymupdf as f,sys\nd=f.open();p=d.new_page()\np.insert_text((72,72),'SYNTHETIC REFERENCE MUST RETAIN SOURCE QUALIFICATIONS',fontsize=12)\n` +
    (kind === "table"
      ? `for x in (40,240,460): p.draw_line((x,100),(x,220))\nfor y in (100,140,180,220): p.draw_line((40,y),(460,y))\nfor y,cells in ((125,('Threshold','Action')),(165,('< 3.5','HOLD EXAMPLE')),(205,('> 3.5','REVIEW EXAMPLE'))):\n for x,t in zip((50,250),cells): p.insert_text((x,y),t,fontsize=12)\n`
      : kind === "figure"
        ? `p.draw_rect(f.Rect(72,140,280,240),fill=(0.4,0.7,0.3));p.insert_text((85,180),'SYNTHETIC FIGURE')\n`
        : `p.insert_text((72,110),'Scan-only synthetic source. Monitor example threshold.',fontsize=15)\npix=p.get_pixmap(dpi=180);s=f.open();s.new_page().insert_image(p.rect,pixmap=pix);d=s\n`) +
    `sys.stdout.buffer.write(d.tobytes())`;
  return execFileSync(resolvePythonBin(), ["-c", code], { maxBuffer: 16 * 1024 * 1024 });
}
async function fixture(kind: "table" | "figure" | "scan") {
  const originalBytes = source(kind);
  const sourceSha = `sha256:${createHash("sha256").update(originalBytes).digest("hex")}` as const;
  const binding: ProviderEgressBinding = {
    documentId: ids[0],
    generationId: ids[1],
    jobId: ids[2],
    leaseId: ids[3],
    admissionEventId: ids[4],
    attemptId: `${ids[2]}:1:${ids[3]}`,
    contentSha256: sourceSha,
    authorityDigest: sourceSha,
  };
  const result = await inspectRichPdfBytes(originalBytes, binding, { timeoutMs: 120000 });
  const expectation = buildInternalRichPdfExpectation(originalBytes, result.review);
  const issued = {
    documentId: ids[0],
    generationId: ids[1],
    jobId: ids[2],
    workerId: "full-pdf-test",
    firstLeaseToken: ids[3],
    attemptNumber: 1,
    batchId: null,
    authorityDigest: sourceSha,
    predecessorGenerationId: null,
  };
  const job: JobRow = {
    id: ids[2],
    document_id: ids[0],
    batch_id: null,
    locked_by: issued.workerId,
    lease_token: ids[3],
    lease_expected_generation_id: null,
    lease_write_generation_id: ids[1],
    lease_authority_digest: sourceSha,
    lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    lease_duration_seconds: 60,
    attempt_count: 1,
    max_attempts: 1,
    documents: {
      id: ids[0],
      owner_id: null,
      title: "Synthetic current shared source",
      file_name: `${kind}.pdf`,
      file_type: "application/pdf",
      storage_path: `legacy/${kind}.pdf`,
      file_size: originalBytes.length,
      content_hash: sourceSha.slice(7),
      metadata: { public_corpus: true, admission_event_id: ids[4] },
    },
  };
  const retentionPacket = buildGenerationRetentionPacket({
    documentId: ids[0],
    generationId: ids[1],
    originalBytes,
    ...expectation,
    extracted: result.extracted,
    capturedImages: result.capturedImages,
    persistedPages: result.extracted.pages.map((p) => ({
      document_id: ids[0],
      page_number: p.pageNumber,
      text: p.text,
      ocr_used: p.ocrUsed ?? false,
      metadata: p.metadata ?? {},
    })),
    deferOptionalProducerDeclarations: true,
  });
  const input = { ...result, job, issued, retentionPacket, originalBytes, stewardId: ids[5] };
  return { ...input, plan: prepareManagedFullPdfGeneration(input) };
}
function addNativeSummary(f: Awaited<ReturnType<typeof fixture>>) {
  const context = prepareManagedPdfSummaryContext({
    document: {
      id: f.job.document_id,
      title: f.job.documents.title ?? "Synthetic reference",
      file_name: f.job.documents.file_name,
      source_path: null,
    },
    packet: f.plan.packet,
  });
  const authority = context.plan.authority,
    chunk = authority.selectedChunks[0]!;
  const claimText = "SYNTHETIC REFERENCE MUST RETAIN SOURCE QUALIFICATIONS";
  const summary = `- ${claimText}`;
  const item = {
    text: claimText,
    source_chunk_ids: [chunk.id],
    source_image_ids: [],
    pages: chunk.page_number ? [chunk.page_number] : [],
    evidence_type: "text",
    support: "direct",
  };
  const payload = normalizeSourceAnchoredSummary(
    {
      summary_kind: "structured",
      summary_version: "source-anchored-summary-v1",
      document_id: f.job.document_id,
      index_generation_id: f.issued.generationId,
      model: authority.expectedStructuredModel,
      model_version: authority.expectedStructuredModelVersion,
      generated_at: new Date().toISOString(),
      source_chunk_ids: authority.selectedChunks.map((row) => row.id),
      source_image_ids: authority.selectedImages.map((row) => row.id),
      summary,
      clinical_specifics: {
        profile: {
          overview: summary,
          applies_to: [],
          key_clinical_actions: [item],
          medication_dose_monitoring: [],
          thresholds_timing: [],
          escalation_risk_warnings: [],
          required_forms_documentation: [],
          not_covered: [],
          important_tables_images: [],
          best_questions: [],
          source_quality_notes: [],
        },
        actions: [claimText],
        thresholds_timing: [],
        medication_monitoring: [],
        risk_escalation: [],
        documentation_forms: [],
        exceptions_gaps: [],
      },
      labels: [{ label: "synthetic", label_type: "topic", confidence: 0.9 }],
      heuristic_fallback: false,
    },
    authority,
  );
  const summaryProjection = prepareManagedPdfSummaryProjection(
    context,
    {
      payload,
      providerEvidence: {
        requestedModel: payload.model,
        providerModel: "synthetic-offline-model",
        requestId: "synthetic-offline-request",
      },
    },
    null,
  );
  const packet = {
    ...f.plan.packet,
    version: "managed-full-pdf-packet-v2",
    summaryProjection,
    deferredOptionalFamilies: f.plan.packet.deferredOptionalFamilies.filter((family) => family !== "model_summary"),
  };
  return { ...f.plan, packet, planDigest: generationEvidenceDigest(packet) };
}
describe("managed complete inspected PDF generation", () => {
  it.each(["table", "figure", "scan"] as const)(
    "preserves real %s source inventory and all derived row families",
    async (kind) => {
      const f = await fixture(kind);
      try {
        expect(f.plan.packet.identity.documentOwnerId).toBeNull();
        expect(f.plan.packet.identity.stewardId).toBe(ids[5]);
        expect(f.plan.packet.rows.images).toHaveLength(f.review.images.length);
        expect(f.plan.packet.rows.chunks.map((r) => r.content).join("")).toBe(
          f.review.pages.map((p) => p.text).join(""),
        );
        expect(f.plan.packet.rows.index_units.length).toBeGreaterThan(0);
        for (const row of f.plan.packet.rows.embedding_fields)
          expect(row.content_hash).toBe(createHash("md5").update(String(row.content)).digest("hex"));
        expect(f.plan.packet.clinicalApproval).toBe("not_granted");
        if (kind === "table") {
          expect(f.plan.packet.rows.table_facts.length).toBeGreaterThan(0);
          expect(JSON.stringify(f.plan.packet.rows.table_facts)).toContain("3.5");
          expect(JSON.stringify(f.plan.packet.rows.table_facts)).toContain("HOLD EXAMPLE");
        }
        if (kind === "scan") expect(f.plan.packet.inspection.pages[0].ocrUsed).toBe(true);
        const expectation = buildInternalRichPdfExpectation(f.originalBytes, f.review);
        expect(expectation.sourceExpectation.units!.length).toBeGreaterThan(f.review.pages.length);
      } finally {
        await Promise.all((f.extracted.temporaryPaths ?? []).map((d) => rm(d, { recursive: true, force: true })));
      }
    },
    130000,
  );
  it.each([false, true])(
    "stages real producer rows with mocked vectors and accepts strict terminal replay (summary %s)",
    async (withSummary) => {
      const f = await fixture("table");
      const plan = withSummary ? addNativeSummary(f) : f.plan;
      try {
        const attempt = new IngestionAttempt({
          job_kind: "node",
          job_id: ids[2],
          document_id: ids[0],
          worker_id: f.issued.workerId,
          lease_token: ids[3],
          expected_generation_id: null,
          authority_digest: f.issued.authorityDigest,
        });
        let stagedDigest = "";
        const mutation = vi.fn(async (name: string, payload: Record<string, unknown>) => {
          expect(name).toBe("stage_managed_full_pdf");
          const packet = payload.p_packet;
          const bytes = generationEvidenceBytes(packet);
          stagedDigest = bytesDigest(bytes);
          return {
            ok: true,
            packetDigest: stagedDigest,
            packet: { bytesHex: bytes.toString("hex"), sha256: stagedDigest, byteLength: bytes.length },
          };
        });
        const embed = vi.fn(async (texts: string[]) =>
          texts.map(() => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))),
        );
        const rpc = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
          const bytes = generationEvidenceBytes({
            version: "managed-full-pdf-seal-v1",
            packetDigest: stagedDigest,
            identity: f.plan.packet.identity,
            publicationApproval: "not_granted",
            clinicalApproval: "not_granted",
          });
          return {
            data: {
              ok: true,
              managedFullPdfTerminal: {
                activated: true,
                replay: payload.p_read_only ? "already_completed" : "completed",
                seal: { bytesHex: bytes.toString("hex"), sha256: bytesDigest(bytes), byteLength: bytes.length },
              },
            },
            error: null,
          };
        });
        if (withSummary) {
          await expect(
            runManagedFullPdfGeneration({
              plan: { ...plan, packet: { ...plan.packet, summaryProjection: null } },
              attempt,
              embed,
              mutation,
              stopHeartbeat: vi.fn(),
              rpc,
            }),
          ).rejects.toThrow("packet_profile_unsupported");
          expect(embed).not.toHaveBeenCalled();
          expect(mutation).not.toHaveBeenCalled();
        }
        await runManagedFullPdfGeneration({ plan, attempt, embed, mutation, stopHeartbeat: vi.fn(), rpc });
        expect(embed.mock.calls.flatMap((call) => call[0])).toEqual(f.plan.embeddingUnits.map((u) => u.text));
        expect(mutation).toHaveBeenCalledOnce();
        expect(rpc.mock.calls.map((call) => call[1].p_read_only)).toEqual([false, true]);
      } finally {
        await Promise.all((f.extracted.temporaryPaths ?? []).map((d) => rm(d, { recursive: true, force: true })));
      }
    },
    130000,
  );
  it("refuses missing or changed required source artifacts before provider egress", async () => {
    const f = await fixture("table");
    try {
      expect(() => prepareManagedFullPdfGeneration({ ...f, capturedImages: [] })).toThrow("inventory_mismatch");
      expect(() =>
        prepareManagedFullPdfGeneration({
          ...f,
          extracted: { ...f.extracted, pages: f.extracted.pages.map((p) => ({ ...p, text: p.text + " fabricated" })) },
        }),
      ).toThrow("page_fidelity_mismatch");
      const changed = structuredClone(f.review);
      changed.featureCoverage.nativeTables = "not_present";
      expect(() => prepareManagedFullPdfGeneration({ ...f, review: changed })).toThrow("feature_coverage");
      expect(generationEvidenceDigest(f.plan.packet)).toBe(f.plan.planDigest);
    } finally {
      await Promise.all((f.extracted.temporaryPaths ?? []).map((d) => rm(d, { recursive: true, force: true })));
    }
  }, 130000);
});
