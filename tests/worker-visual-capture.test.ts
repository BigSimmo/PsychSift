import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorkerIngestionSource } from "./helpers/worker-ingestion-source";

// worker/main.ts plus the ingestion stages extracted from it, joined in pipeline order.
const workerSource = readWorkerIngestionSource();
const extractorSource = readFileSync(new URL("../worker/python/extract_pdf_assets.py", import.meta.url), "utf8");
// Fenced leases (PR #3546) moved the lease-bound RPC seams into worker/behavior.ts.
const behaviorSource = readFileSync(new URL("../worker/behavior.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
// ING-B-10: the admission-bound caption cache.
const captionCacheSource = readFileSync(new URL("../worker/image-caption-cache.ts", import.meta.url), "utf8");

function sourceWindow(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const to = source.indexOf(end, from);
  expect(to, end).toBeGreaterThan(from);
  return source.slice(from, to);
}

function fencedCompleteIngestionJobBody() {
  const start = schemaSource.lastIndexOf(
    "create or replace function public.complete_ingestion_job(p_fence jsonb, p_batch_id uuid, p_stage text)",
  );
  expect(start).toBeGreaterThan(-1);
  const end = schemaSource.indexOf("create or replace function", start + 1);
  return schemaSource.slice(start, end === -1 ? undefined : end);
}

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
      /embedding: assertEmbeddingDim\(\s*unitEmbeddings\[start \+ index\],\s*`document_index_units\.visual\.\$\{start \+ index\}`,?\s*\)/,
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
    // The job/worker identity now travels in the durable lease fence (p_fence), not loose args.
    expect(workerSource).toContain('await mutation(attemptForJob(args.jobId), "commit_document_index_generation", {');
    expect(workerSource).toContain("p_generation: args.indexGenerationId");
    expect(behaviorSource).toContain("job_id: job.id,");
    expect(behaviorSource).toContain("worker_id: job.locked_by,");
    expect(behaviorSource).toContain("result = await rpc(name, { ...payload, p_fence: attempt.fence });");
    expect(workerSource).not.toContain("await replacePageRows(args.documentId, args.pages)");
    // The commit RPC prunes stale/legacy generation rows and upserts index quality atomically
    // server-side; the worker must surface any RPC failure (fail closed) rather than run a
    // client-side fallback that could partially write after an error.
    expect(behaviorSource).toContain("if (result.error) throw new Error(result.error.message);");
    expect(behaviorSource).toMatch(/catch \(error\) \{\s*attempt\.cancel\(\);\s*throw error;\s*\}/);
    expect(workerSource).not.toContain("deleteStaleIndexGenerationRows");
    // Image objects are generation-scoped under the server-prepared, lease-scoped prefix.
    expect(workerSource).toMatch(/await persistIngestionImage\(\{\s*attempt,\s*generation: indexGenerationId,/);
    expect(behaviorSource).toContain(
      "const prefix = `${args.attempt.fence.document_id}/${args.attempt.fence.lease_token}/${args.generation}/`;",
    );
    expect(behaviorSource).toContain("!prepared.storage_path.startsWith(prefix)");
    expect(workerSource).toContain('indexing_v3_agent_repair_reason: "core_index_committed"');
    expect(workerSource).toContain("indexing_v3_agent_repair_reason: null");
  });

  it("uses the strict completion RPC when inline enrichment succeeds", () => {
    expect(workerSource).toContain("async function completeStrictEnrichmentJob(job: JobRow)");
    expect(workerSource).toContain("return runIngestionStrictCompletion(");
    expect(behaviorSource).toContain(
      'await rpc("complete_strict_enrichment_job", { ...payload, p_fence: attempt.fence });',
    );
    expect(workerSource).toContain('p_agent_version: "visual-core-v3"');
    expect(workerSource).toContain('p_visual_indexing_version: "visual-v3"');
    expect(workerSource).toContain('strictCompletion.missing.includes("strict_completion_rpc_failed")');
    expect(workerSource).toContain("indexing_v3_agent_repair_reason: strictCompletionRepairReason");
  });

  it("refreshes import-batch status inside the fenced completion RPC, with no unfenced client fallback", () => {
    // Fenced leases: a client-side import_batches write would be an unfenced mutation, so the
    // batch refresh moved into complete_ingestion_job's own transaction under the fence.
    expect(workerSource).toMatch(
      /await mutation\(attemptForJob\(job\.id\), "complete_ingestion_job", \{\s*p_batch_id: job\.batch_id,/,
    );
    expect(workerSource).not.toContain("Import batch status fallback update failed");
    expect(workerSource).not.toMatch(/\.from\("import_batches"\)/);
    const completion = fencedCompleteIngestionJobBody();
    expect(completion).toContain("public.assert_current_ingestion_attempt(p_fence");
    expect(completion).toMatch(/update public\.import_batches set status=/);
  });

  it("invalidates stale image caption cache entries by policy, prompt, and context versions", () => {
    expect(workerSource).toContain('const imageCaptionCacheVersion = "clinical-image-caption-cache-v2"');
    expect(workerSource).toContain('const visionClassificationPromptVersion = "clinical-image-classification-v1"');
    // Fenced leases: legacy cache entries lack admission/source identity and are never read.
    // ING-B-10 re-enabled reuse only for rows bound to the same admitted source: the identity
    // covers the document, admission event, content hash, authority digest, image hash and
    // the versioned context hash, and a hit still passes the current provider-egress gate.
    expect(workerSource).not.toMatch(/(get|set)CachedImageClassification/);
    for (const binding of [
      "documentId: args.job.document_id,",
      "admissionEventId,",
      "contentHash,",
      "authorityDigest,",
      "imageHash: args.imageHash,",
      "contextHash: args.contextHash,",
    ]) {
      expect(captionCacheSource).toContain(binding);
    }
    expect(captionCacheSource).toContain("parsed.data.metadata.cache_identity !== key.identity");
    const hit = sourceWindow(workerSource, "if (cached) {", "classificationCacheHit: true");
    expect(hit).toContain("await assertIngestionProviderEgress(");
    // The versions still key the context hash and are stamped on every persisted image.
    expect(workerSource).toContain("cacheVersion: imageCaptionCacheVersion,");
    expect(workerSource).toContain("promptVersion: visionClassificationPromptVersion,");
    expect(workerSource).toContain("policyVersion: clinicalImagePolicyVersion,");
    expect(workerSource).toContain("image_caption_cache_version: imageCaptionCacheVersion,");
    expect(workerSource).toContain("image_policy_version: clinicalImagePolicyVersion,");
    expect(workerSource).toContain("visual_intelligence_version: visualIntelligenceVersion,");
    expect(workerSource).toContain("caption_context_hash: contextHash,");
  });

  it("redacts captions before cache writes", () => {
    expect(workerSource).toContain("function redactImageClassification");
    // The caption cache (ING-B-10) stores only the redacted classification.
    expect(workerSource).not.toMatch(/setCachedImageClassification/);
    const cacheWrite = sourceWindow(
      captionCacheSource,
      "export async function writeCachedImageClassification(",
      ".upsert(",
    );
    expect(cacheWrite).toContain("const redacted = redactImageClassification(classification);");
    expect(captionCacheSource).toContain("caption: redacted.caption,");
    expect(captionCacheSource).toContain("classification: redacted,");
    expect(workerSource).toContain("caption: redactCaptionIdentifiers(cleanString(classification.caption)),");
    expect(workerSource).toMatch(
      /structured_visual_profile: redactCaptionMetadataValue\(\s*\(classification as ImageClassificationWithVisualProfile\)\.structured_visual_profile,/,
    );
    const redactIndex = workerSource.indexOf(
      "let classification = redactImageClassification(resolved.classification);",
    );
    expect(redactIndex).toBeGreaterThan(-1);
    expect(workerSource.indexOf("const data = await persistIngestionImage({", redactIndex)).toBeGreaterThan(
      redactIndex,
    );
    expect(workerSource).toContain("caption: classification.caption");
    expect(workerSource).toMatch(
      /structured_visual_profile: normalizeStructuredVisualProfile\(\s*redactCaptionMetadataValue\(/,
    );
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
