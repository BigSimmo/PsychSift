import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
const behaviorSource = readFileSync(new URL("../worker/behavior.ts", import.meta.url), "utf8");
const extractorSource = readFileSync(new URL("../worker/python/extract_pdf_assets.py", import.meta.url), "utf8");

describe("worker visual capture hardening", () => {
  it("routes final shadow metadata to its private component before any live completion", () => {
    expect(workerSource).toContain("await persistIngestionQuality({ attempt, shadow, quality: sanitizeJsonbRecord(quality)");
    const start = workerSource.indexOf("await persistIngestionShadowWorkerProjection({ attempt");
    expect(start).toBeGreaterThan(0);
    const finalization = workerSource.slice(start, workerSource.indexOf("let completionStage", start));
    expect(finalization).toContain("...committedCoreMetadata, ...finalMetadata");
    expect(finalization).toContain("chunk_count: chunks.length, image_count: imageCount");
    const sealed = finalization.indexOf("await stageIngestionShadowGeneration({ attempt, shadow,");
    const returned = finalization.indexOf("return;", sealed);
    const liveUpdate = finalization.indexOf("await updateDocument(");
    expect(sealed).toBeGreaterThan(0);
    expect(returned).toBeGreaterThan(sealed);
    expect(liveUpdate).toBeGreaterThan(returned);
    const outcome = workerSource.indexOf('if (enrichmentOutcome.status === "failed")');
    const postOutcome = workerSource.slice(outcome, workerSource.indexOf("// Packet B4", outcome));
    expect(postOutcome).toContain("finalQuality = buildIndexQualityPayload({ job, metrics, chunks, insertedImages, sectionCount, memoryCardCount,");
    expect(postOutcome).toContain("documentEmbeddingFieldTypes, optionalIndexWriteIssues });");
    expect(postOutcome.indexOf("finalQuality = buildIndexQualityPayload(")).toBeLessThan(postOutcome.indexOf("await upsertIndexQuality(finalQuality)"));
  });

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
    expect(workerSource).toContain(
      "embedding: assertEmbeddingDim(unitEmbeddings[start + index], `document_index_units.visual.${start + index}`)",
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

  it("uses durable core and immutable image publication seams without direct fallbacks", () => {
    expect(behaviorSource).toContain('name: "commit_document_index_generation"');
    expect(behaviorSource).toContain("p_generation: args.generation");
    expect(workerSource).toContain("await writeIngestionCoreGeneration({");
    expect(workerSource).toContain("generation: args.indexGenerationId");
    expect(workerSource).toContain("selectIngestionEnrichmentGeneration({ job, attempt, document: enrichmentDocument,");
    for (const producer of ["upsertDocumentEnrichment", "upsertDocumentDeepMemory"]) {
      const call = workerSource.match(new RegExp(`await ${producer}\\(\\{([\\s\\S]*?)\\n        \\}\\)`));
      expect(call?.[1]).toContain("shadow: shadowProducerPersistence(job)");
      if (producer === "upsertDocumentEnrichment") expect(call?.[1]).toContain("indexGenerationId: producerGenerationId");
    }
    expect(workerSource).toContain("runIngestionMutation(attempt");
    expect(workerSource).toContain("await persistIngestionImage(publication)");
    expect(workerSource).toContain("await prepareIngestionImageStorage(publication)");
    expect(workerSource).toContain("pendingUploads.push(() => persistIngestionImage({ ...publication, preparedStoragePath: storagePath }))");
    expect(workerSource).toContain("for (const publish of pendingUploads) await publish()");
    expect(workerSource).not.toContain("compensateUploadedArtifactAndThrow");
    expect(workerSource).not.toContain("deleteStaleIndexGenerationRows");
    expect(workerSource).toContain('indexing_v3_agent_repair_reason: "core_index_committed"');
    expect(workerSource).toContain("indexing_v3_agent_repair_reason: null");
  });

  it("uses the strict completion RPC when inline enrichment succeeds", () => {
    expect(workerSource).toContain("async function completeStrictEnrichmentJob(job: JobRow)");
    expect(workerSource).toContain("complete_strict_enrichment_job");
    expect(workerSource).toContain('p_agent_version: "visual-core-v3"');
    expect(workerSource).toContain('p_visual_indexing_version: "visual-v3"');
    expect(workerSource).toContain('strictCompletion.missing.includes("strict_completion_rpc_failed")');
    expect(workerSource).toContain("indexing_v3_agent_repair_reason: strictCompletionRepairReason");
  });

  it("leaves terminal/batch writes in the fenced SQL owner without fallback", () => {
    expect(workerSource).not.toContain("fallbackUpdateError");
    expect(workerSource).not.toContain('from("import_batches")');
    expect(workerSource).toContain('"complete_ingestion_job"');
    expect(workerSource).toContain("p_batch_id: job.batch_id");
  });

  it("invalidates stale image caption cache entries by policy, prompt, and context versions", () => {
    expect(workerSource).toContain('const imageCaptionCacheVersion = "clinical-image-caption-cache-v2"');
    expect(workerSource).toContain('const visionClassificationPromptVersion = "clinical-image-classification-v1"');
    expect(workerSource).toContain("metadata.image_caption_cache_version !== imageCaptionCacheVersion");
    expect(workerSource).toContain("metadata.image_policy_version !== clinicalImagePolicyVersion");
    expect(workerSource).toContain("metadata.visual_intelligence_version !== visualIntelligenceVersion");
    expect(workerSource).toContain("metadata.caption_context_hash !== contextHash");
  });

  it("redacts captions before cache writes", () => {
    expect(workerSource).toContain("function redactImageClassification");
    expect(workerSource).toContain("const classification = redactImageClassification(args.classification);");
    expect(workerSource).toContain("let classification = redactImageClassification(resolved.classification);");
    expect(workerSource).toContain("caption: classification.caption");
    expect(workerSource).toContain("const structuredProfile = normalizeStructuredVisualProfile(");
    expect(workerSource).toContain("redactCaptionMetadataValue(metadata.structured_visual_profile)");
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

describe("U04 shadow producer failure retention", () => {
  it("distinguishes a cache lookup failure from a clean miss before classification can continue", () => {
    expect(workerSource).toContain('| { kind: "failed" }');
    const lookupStart = workerSource.indexOf("const shadowCacheLookups = shadow");
    const lookup = workerSource.slice(lookupStart, workerSource.indexOf("const batchResults = await Promise.all(", lookupStart));
    expect(lookup).toContain('lookup.kind === "failed"');
    expect(lookup).toContain('phase: "cache_lookup"');
    expect(lookup).toContain('code: "producer_failed"');
    expect(lookup).toContain("tasks: batch");
    expect(lookup).toContain("resolvedTasks");
    expect(workerSource.slice(workerSource.indexOf("const batchResults = await Promise.all(", lookupStart)))
      .toContain("await getCachedImageClassification(job.documents.owner_id, task.imageHash, task.contextHash)");
  });

  it("retains each caught worker-core failure before the ordinary optional fallback", () => {
    const phases = [
      ["section_context", "section-context embedding field"],
      ["table_facts", "table fact"],
      ["visual_index_units", "visual index unit"],
      ["supplemental_embedding_fields", "supplemental embedding field"],
    ] as const;
    for (const [phase, ordinaryFallback] of phases) {
      const failure = workerSource.indexOf('"' + phase + '"');
      const fallback = workerSource.indexOf('optionalIndexWriteWarning("' + ordinaryFallback + '"', failure);
      expect(failure).toBeGreaterThan(0);
      expect(fallback).toBeGreaterThan(failure);
      expect(workerSource.slice(failure, fallback)).toContain("retainShadowProducerFailure(");
    }
  });

  it("records configured enrichment skip and failed enrichment before any late shadow stage", () => {
    const inlineBranch = workerSource.indexOf("if (env.WORKER_INLINE_ENRICHMENT)");
    const lateStage = workerSource.indexOf("await stageIngestionShadowGeneration(", inlineBranch);
    const bounded = workerSource.slice(inlineBranch, lateStage);
    expect(bounded).toContain('phase: "summary_generation"');
    expect(bounded).toMatch(/retainShadowProducerFailure\(\s*job,\s*"document_embedding_fields"/);
    expect(bounded).toContain('phase: "enrichment_policy"');
    expect(bounded).toContain('code: "producer_skipped"');
    expect(bounded.indexOf('phase: "enrichment_policy"')).toBeLessThan(
      bounded.indexOf('stage: "core index complete; enrichment deferred"'),
    );
  });
});
