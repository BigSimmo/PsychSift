import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
const behaviorSource = readFileSync(new URL("../worker/behavior.ts", import.meta.url), "utf8");
const fencedSql = readFileSync(
  new URL("../supabase/migrations/20261013075944_administrator_txt_fenced_runtime_cutover.sql", import.meta.url),
  "utf8",
);
const extractorSource = readFileSync(new URL("../worker/python/extract_pdf_assets.py", import.meta.url), "utf8");

describe("worker visual capture hardening", () => {
  it("guards every local worker vector write before Supabase inserts", () => {
    expect(workerSource).toContain('import { assertEmbeddingDim } from "../src/lib/embedding-dimensions"');
    expect(workerSource).toContain(
      "embedding: assertEmbeddingDim(embeddings[index], `document_chunks.${chunk.chunk_index}`)",
    );
    expect(workerSource).toContain(
      "embedding: assertEmbeddingDim(embeddings[index], `document_embedding_fields.${field.field_type}`)",
    );
    expect(workerSource).toContain(
      "embedding: assertEmbeddingDim(fieldEmbeddings[index], `document_embedding_fields.section_context.${index}`)",
    );
    expect(workerSource).toMatch(
      /embedding:\s*assertEmbeddingDim\(\s*unitEmbeddings\[start \+ index\],\s*`document_index_units\.visual\.\$\{start \+ index\}`/,
    );
    expect(workerSource).toContain(
      "embedding: assertEmbeddingDim(additionalEmbeddings[index], `document_embedding_fields.${field.field_type}`)",
    );
  });

  it("keeps view-only retained images out of retrieval index inputs", () => {
    expect(workerSource).toContain("!retainAsCover && !retainedWithoutCaptioning && policyAssessment.searchable");
    expect(workerSource).toContain("if (data.searchable !== false) {");
    expect(workerSource).toContain("insertedImages.push({");
    // The prior broadening pulled document-view-only rows into chunk/index/embedding inputs.
    expect(workerSource).not.toContain("if (data.searchable !== false || retainForDocumentView)");
  });

  it("captures first-page cover thumbnails without spending clinical caption budget", () => {
    expect(extractorSource).toContain("def save_cover_page(");
    expect(extractorSource).toContain('"sourceKind": "cover_page"');
    expect(workerSource).toContain('candidate.sourceKind !== "cover_page"');
    expect(workerSource).toContain('const retainAsCover = image.sourceKind === "cover_page"');
    expect(workerSource).toContain("cover_image_id: coverImageId");
  });

  it("fails closed when the lease-fenced commit RPC is unavailable and keeps image uploads generation-scoped", () => {
    expect(workerSource).toContain('mutation(attemptForJob(args.jobId), "commit_document_index_generation"');
    expect(workerSource).toContain("p_generation: args.indexGenerationId");
    expect(behaviorSource).toContain("p_fence: attempt.fence");
    expect(behaviorSource).toContain("attempt.handoff(result.data, payload.p_generation)");
    expect(workerSource).not.toContain("await replacePageRows(args.documentId, args.pages)");
    // The commit RPC prunes stale/legacy generation rows and upserts index quality atomically
    // server-side; the worker must surface any RPC failure (fail closed) rather than run a
    // client-side fallback that could partially write after an error.
    const mutation = behaviorSource.slice(
      behaviorSource.indexOf("export async function runIngestionMutation("),
      behaviorSource.indexOf("export function claimedJobFence("),
    );
    expect(mutation).toContain("if (result.error) throw new Error(result.error.message)");
    expect(mutation).toContain("attempt.cancel();");
    expect(mutation).toContain("throw error;");
    expect(workerSource).not.toContain("deleteStaleIndexGenerationRows");
    expect(workerSource).toContain("generation: indexGenerationId");
    expect(behaviorSource).toContain(
      "`${args.attempt.fence.document_id}/${args.attempt.fence.lease_token}/${args.generation}/`",
    );
    expect(behaviorSource).toContain("!prepared.storage_path.startsWith(prefix)");
    expect(behaviorSource).toContain("args.upload(prepared.storage_path, { upsert: false })");
    expect(workerSource).toContain('indexing_v3_agent_repair_reason: "core_index_committed"');
    expect(workerSource).toContain("indexing_v3_agent_repair_reason: null");
  });

  it("uses the strict completion RPC when inline enrichment succeeds", () => {
    expect(workerSource).toContain("async function completeStrictEnrichmentJob(job: JobRow)");
    expect(workerSource).toContain("return runIngestionStrictCompletion(");
    expect(behaviorSource).toContain('rpc("complete_strict_enrichment_job", { ...payload, p_fence: attempt.fence })');
    expect(workerSource).toContain('p_agent_version: "visual-core-v3"');
    expect(workerSource).toContain('p_visual_indexing_version: "visual-v3"');
    expect(workerSource).toContain('strictCompletion.missing.includes("strict_completion_rpc_failed")');
    expect(workerSource).toContain("indexing_v3_agent_repair_reason: strictCompletionRepairReason");
  });

  it("keeps batch status updates inside fenced terminal transitions", () => {
    expect(workerSource).toContain('mutation(attemptForJob(job.id), "complete_ingestion_job"');
    expect(workerSource).toContain('mutation(attemptForJob(args.job.id), "fail_or_retry_ingestion_job"');
    expect(workerSource).not.toContain('.from("import_batches")');
    for (const name of ["complete_ingestion_job", "fail_or_retry_ingestion_job"]) {
      const start = fencedSql.indexOf(`create or replace function public.${name}(`);
      const body = fencedSql.slice(start, fencedSql.indexOf("end $$;", start));
      expect(body).toContain("v_locked := public.assert_current_ingestion_attempt(p_fence,");
      expect(body.indexOf("if v_locked is null then return")).toBeLessThan(
        body.indexOf("update public.import_batches"),
      );
      expect(body).toContain("v_batch := (v_locked->'job'->>'batch_id')::uuid");
      expect(body).toContain("update public.import_batches set status=");
    }
  });

  it("refuses legacy caption cache reuse without admission and source identity", () => {
    const start = workerSource.indexOf("batch.map(async (task) => {");
    const caption = workerSource.slice(start, workerSource.indexOf("resolvedTasks.push(...batchResults)", start));
    expect(caption).toContain("const classificationCacheHit = false");
    expect(caption).toContain("ingestionEgress: providerContextForJob(job)");
    expect(workerSource).not.toContain('.from("image_caption_cache")');
  });

  it("redacts captions and structured profile content before fenced image persistence", () => {
    expect(workerSource).toContain("function redactImageClassification");
    expect(workerSource).toContain("caption: redactCaptionIdentifiers(cleanString(classification.caption))");
    expect(workerSource).toContain("let classification = redactImageClassification(resolved.classification);");
    expect(workerSource).toContain("caption: classification.caption");
    expect(workerSource).toMatch(
      /structured_visual_profile: normalizeStructuredVisualProfile\(\s*redactCaptionMetadataValue\(/,
    );
    expect(workerSource).toContain("persistIngestionImage({");
    expect(
      workerSource.indexOf("let classification = redactImageClassification(resolved.classification);"),
    ).toBeLessThan(workerSource.indexOf("await persistIngestionImage({"));
  });

  it("computes perceptual duplicate groups before caption budget selection", () => {
    expect(workerSource.indexOf("const preparedImages: Array")).toBeLessThan(
      workerSource.indexOf("const scoredCandidates = rankVisualCandidates"),
    );
    expect(workerSource).not.toContain("preparedImage.bytes.toString");
    expect(workerSource).toContain("lightweightPerceptualHash(bytes, image.width, image.height)");
    expect(workerSource).toContain("perceptualHash: preparedImages[index]?.perceptualHash ?? null");
  });

  it("propagates OCR failures and captures image-dominant page regions", () => {
    expect(extractorSource).toContain('return "", f"OCR failed on page');
    expect(extractorSource).toContain("warnings.append(ocr_warning)");
    expect(extractorSource).toContain('"warnings": warnings');
    expect(extractorSource).toContain("image_dominant_page_region");
    expect(extractorSource).toContain("source_regions");
    expect(extractorSource).toContain("render_dpi");
  });
});
