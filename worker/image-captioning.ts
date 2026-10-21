// The image stage of legacy ingestion: select caption candidates, caption them under the
// attempt, then persist each retained image. Moved from worker/main.ts and split into its
// three phases; the runtime services arrive through IngestionStageContext.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../src/lib/env";
import {
  deterministicStructuredVisualProfile,
  normalizeStructuredVisualProfile,
  rankVisualCandidates,
  selectCaptionCandidateIndexes,
  visualIntelligenceVersion,
  type StructuredVisualProfile,
} from "../src/lib/visual-intelligence";
import {
  assessClinicalImageUse,
  cheapImageSkipReason,
  classifiedImageSkipReason,
  clinicalImagePolicyVersion,
  lowSignalImageTextSkipReason,
  lightweightPerceptualHash,
  imagePlacementDedupeKey,
} from "../src/lib/image-filtering";
import {
  assertIngestionProviderEgress,
  createIngestionProviderEgressOperation,
} from "../src/lib/ingestion-provider-egress";
import { deleteImageCaptionCacheForDocument } from "../src/lib/image-caption-cache-cleanup";
import { classifyAndCaptionImageFromBase64 } from "../src/lib/openai";
import type { ExtractedDocument, ImageEvidenceCategory } from "../src/lib/types";
import {
  CONTROL_PLANE_RPCS,
  controlPlaneAbortSignal,
  dataPlaneAbortSignal,
  persistIngestionImage,
  runIngestionPreparedWork,
  visionImageRejectionSkipReason,
} from "./behavior";
import {
  imageCaptionCacheKey,
  readCachedImageClassification,
  writeCachedImageClassification,
} from "./image-caption-cache";
import { rethrowTerminalProviderError } from "./ingestion-errors";
import { cleanString, hashBytes, sanitizeJsonbRecord } from "./ingestion-sanitize";
import {
  captionContextHash,
  imageCaptionCacheVersion,
  imageEvidenceCategories,
  imageTableMetadata,
  nonClinicalTableClassification,
  noteSkippedImage,
  redactCaptionMetadataValue,
  redactImageClassification,
  visionClassificationPromptVersion,
  visionRejectedClassification,
  type ImageClassification,
  type ImageClassificationWithVisualProfile,
} from "./image-classification";
import type { IngestionStageContext } from "./ingestion-stage-context";
import type { JobRow } from "./types";

type InsertedImage = {
  id: string;
  caption: string;
  pageNumber: number | null;
  imageType: ImageEvidenceCategory;
  sourceKind: string | null;
  labels: string[];
  tableLabel: string | null;
  tableTitle: string | null;
  tableTextSnippet: string | null;
  tableRole: string | null;
  accessibleTableMarkdown: string | null;
  tableRows: string[][] | null;
  tableColumns: string[] | null;
  tableMergedCells: [number, number][] | null;
  tableRowBreaks: number[] | null;
  structuredVisualProfile: StructuredVisualProfile | null;
  candidatePriorityScore: number;
  imageQualityScore: number;
  cropCompleteness: number;
  ocrTextDensity: number;
};

// Keep selection, de-dupe, and budget checks sequential so the chosen images
// are deterministic; only the expensive cache/model calls run concurrently.
export type CaptionTask = {
  candidate: ReturnType<typeof rankVisualCandidates>[number];
  index: number;
  image: ExtractedDocument["images"][number];
  perceptualHash: string;
  imageHash: string;
  nearbyText: string | undefined;
  tableMetadata: ReturnType<typeof imageTableMetadata>;
  contextHash: string;
  presetClassification: ImageClassification | null;
};

type ResolvedCaptionTask = {
  task: CaptionTask;
  classification: ImageClassification;
  classificationCacheHit: boolean;
};

/** Skip accounting shared by all three phases, in the order the phases record it. */
type ImageSkipTally = { skippedImages: number; skipReasons: Map<string, number> };

export async function uploadAndCaptionImages(
  ctx: IngestionStageContext,
  job: JobRow,
  extracted: ExtractedDocument,
  pagesByNumber: Map<number, string>,
  indexGenerationId: string,
) {
  const tally: ImageSkipTally = { skippedImages: 0, skipReasons: new Map<string, number>() };
  const captionTasks = await prepareCaptionTasks(extracted, pagesByNumber, tally);
  const resolvedTasks = await resolveCaptionTasks(ctx, job, captionTasks, tally.skipReasons);
  const { insertedImages, coverImageId, imageTypeCounts } = await persistCaptionedImages(
    ctx,
    job,
    resolvedTasks,
    indexGenerationId,
    tally,
  );

  return {
    insertedImages,
    coverImageId,
    skippedImages: tally.skippedImages,
    skipReasons: Object.fromEntries(tally.skipReasons.entries()),
    imageTypeCounts: Object.fromEntries(imageTypeCounts.entries()),
  };
}

/** Phase 1: hash, rank and budget the extracted images into an ordered caption task list. */
async function prepareCaptionTasks(
  extracted: ExtractedDocument,
  pagesByNumber: Map<number, string>,
  tally: ImageSkipTally,
): Promise<CaptionTask[]> {
  const seenImagePlacements = new Set<string>();
  // Deliberate trade-off (audit L11): image bytes are re-read from disk at
  // each stage (hash here, caption on cache miss, upload) instead of being
  // cached, because holding every extracted image Buffer for a large document
  // (hundreds of multi-MB page images) would multiply the worker's peak
  // memory. Disk I/O is the cheaper resource for this background pipeline.
  const preparedImages: Array<{ imageHash: string; bytesLength: number; perceptualHash: string }> = [];
  for (const image of extracted.images) {
    const bytes = await readFile(image.path);
    preparedImages.push({
      imageHash: hashBytes(bytes),
      bytesLength: bytes.length,
      perceptualHash: lightweightPerceptualHash(bytes, image.width, image.height),
    });
  }
  const scoredCandidates = rankVisualCandidates(
    extracted.images.map((image, index) => ({
      pageNumber: image.pageNumber,
      width: image.width ?? null,
      height: image.height ?? null,
      bbox: image.bbox ?? null,
      sourceKind: image.sourceKind ?? null,
      imageHash: preparedImages[index]?.imageHash ?? null,
      perceptualHash: preparedImages[index]?.perceptualHash ?? null,
      metadata: image.metadata ?? {},
      nearbyText: image.pageNumber ? pagesByNumber.get(image.pageNumber) : null,
    })),
  );
  // Cover thumbnails are display-only; keep them out of the clinical caption budget.
  const selectedCaptionCandidateIndexes = selectCaptionCandidateIndexes(
    scoredCandidates.filter((candidate) => candidate.sourceKind !== "cover_page"),
    env.WORKER_MAX_CAPTIONED_IMAGES_PER_DOCUMENT,
    env.WORKER_MAX_CAPTIONED_IMAGES_PER_PAGE,
  );

  const captionTasks: CaptionTask[] = [];
  for (const candidate of scoredCandidates) {
    const index = candidate.originalIndex;
    const image = extracted.images[index];
    const preparedImage = preparedImages[index];
    const imageHash = preparedImage.imageHash;
    const skipReason = cheapImageSkipReason({
      bytesLength: preparedImage.bytesLength,
      imageHash,
      seenHashes: seenImagePlacements,
      image,
    });
    if (skipReason) {
      tally.skippedImages += 1;
      noteSkippedImage(tally.skipReasons, skipReason);
      continue;
    }
    const placementKey = imagePlacementDedupeKey({ imageHash, image });
    if (placementKey) seenImagePlacements.add(placementKey);

    const nearbyText = image.pageNumber ? pagesByNumber.get(image.pageNumber) : undefined;
    const tableMetadata = imageTableMetadata(image);
    const contextHash = captionContextHash({ image, tableMetadata, nearbyText });
    const lowSignalSkipReason = lowSignalImageTextSkipReason({
      sourceKind: image.sourceKind ?? null,
      tableRole: tableMetadata.tableRole,
      tableText: tableMetadata.tableText,
      tableTitle: tableMetadata.tableTitle,
      tableLabel: tableMetadata.tableLabel,
      width: image.width ?? null,
      height: image.height ?? null,
    });
    if (
      lowSignalSkipReason &&
      image.sourceKind !== "table_crop" &&
      image.sourceKind !== "cover_page" &&
      !["administrative table without clinical facts"].includes(lowSignalSkipReason)
    ) {
      tally.skippedImages += 1;
      noteSkippedImage(tally.skipReasons, lowSignalSkipReason);
      continue;
    }
    const presetClassification: ImageClassification | null =
      image.sourceKind === "cover_page"
        ? {
            image_type: "unclear",
            caption: "Document cover page preview.",
            searchable: false,
            clinical_relevance_score: 0,
            labels: ["cover-page"],
            skip_reason: "cover page thumbnail",
            clinical_use_class: "decorative_or_empty",
            clinical_use_reason: "First-page cover thumbnail for search cards; not clinical evidence.",
            clinical_signal_score: 0,
            admin_signal_score: 0,
            structured_visual_profile: deterministicStructuredVisualProfile({
              imageType: "unclear",
              caption: "Document cover page preview.",
              tableTitle: null,
              tableLabel: null,
              tableTextSnippet: null,
              tableRows: null,
              tableColumns: null,
              metadata: { source_kind: "cover_page", candidate_type: "document_cover" },
            }),
            structured_extraction_confidence: 0.1,
          }
        : image.sourceKind === "table_crop"
          ? nonClinicalTableClassification({ tableMetadata, sourceKind: image.sourceKind })
          : null;
    const retainUncaptionedForDocumentView =
      ["table_crop", "diagram_crop", "page_region"].includes(image.sourceKind ?? "") &&
      !selectedCaptionCandidateIndexes.has(index);
    if (!presetClassification && !selectedCaptionCandidateIndexes.has(index) && !retainUncaptionedForDocumentView) {
      tally.skippedImages += 1;
      noteSkippedImage(tally.skipReasons, "visual intelligence candidate below caption budget");
      continue;
    }
    const fallbackClassification: ImageClassification | null = retainUncaptionedForDocumentView
      ? {
          image_type: image.sourceKind === "table_crop" ? "clinical_table" : "unclear",
          caption:
            tableMetadata.tableTitle ||
            tableMetadata.tableLabel ||
            (image.sourceKind === "page_region"
              ? "Document page region retained for review."
              : "Document image retained for review."),
          searchable: false,
          clinical_relevance_score: 0,
          labels: ["needs-review"],
          skip_reason: "retained for document view without captioning",
          clinical_use_class: "ambiguous",
          clinical_use_reason: "Retained for document viewing without model captioning.",
          clinical_signal_score: 0,
          admin_signal_score: 0,
          structured_visual_profile: deterministicStructuredVisualProfile({
            imageType: image.sourceKind === "table_crop" ? "clinical_table" : "unclear",
            caption:
              tableMetadata.tableTitle ||
              tableMetadata.tableLabel ||
              (image.sourceKind === "page_region"
                ? "Document page region retained for review."
                : "Document image retained for review."),
            tableTitle: tableMetadata.tableTitle,
            tableLabel: tableMetadata.tableLabel,
            tableTextSnippet: tableMetadata.tableTextSnippet,
            tableRows: tableMetadata.tableRows as string[][] | null,
            tableColumns: tableMetadata.tableColumns as string[] | null,
            metadata: {},
          }),
          structured_extraction_confidence: 0.25,
        }
      : null;
    captionTasks.push({
      candidate,
      index,
      image,
      perceptualHash: preparedImage.perceptualHash,
      imageHash,
      nearbyText,
      tableMetadata,
      contextHash,
      presetClassification: presetClassification ?? fallbackClassification,
    });
  }
  return captionTasks;
}

/** Phase 2: caption the tasks in bounded concurrent batches under the job's attempt. */
export async function resolveCaptionTasks(
  ctx: IngestionStageContext,
  job: JobRow,
  captionTasks: CaptionTask[],
  skipReasons: Map<string, number>,
): Promise<ResolvedCaptionTask[]> {
  const { attemptForJob, mutation, providerContextForJob, supabase, updateJobProgress } = ctx;
  const captionConcurrency = env.WORKER_VISION_CONCURRENCY;
  const resolvedTasks: ResolvedCaptionTask[] = [];
  const cacheIdentities = new Set<string>();
  for (let start = 0; start < captionTasks.length; start += captionConcurrency) {
    const batch = captionTasks.slice(start, start + captionConcurrency);
    await updateJobProgress(job.id, {
      stage: `captioning images ${start + 1}-${start + batch.length}/${captionTasks.length}`,
      progress: Math.min(70, 35 + Math.round(((start + batch.length) / Math.max(captionTasks.length, 1)) * 25)),
    });
    const batchResults = await Promise.all(
      batch.map(async (task) => {
        let classification: ImageClassification | null = task.presetClassification;
        if (!classification) {
          const bytes = await readFile(task.image.path);
          const classifierInputs = {
            nearbyText: task.nearbyText,
            sourceKind: task.image.sourceKind ?? null,
            candidateType: task.tableMetadata.candidateType,
            tableLabel: task.tableMetadata.tableLabel,
            tableTitle: task.tableMetadata.tableTitle,
            tableRole: task.tableMetadata.tableRole,
            tableText: task.tableMetadata.tableText,
          };
          // ING-B-10: reuse this admitted source's own earlier caption of the same image and
          // context. Legacy rows carry no admission/source identity and never match.
          const cacheKey = imageCaptionCacheKey({
            job,
            imageHash: task.imageHash,
            contextHash: task.contextHash,
            mimeType: task.image.mimeType,
            classifierInputs,
          });
          if (cacheKey) cacheIdentities.add(cacheKey.identity);
          const cached = cacheKey
            ? await readCachedImageClassification(
                supabase,
                cacheKey,
                dataPlaneAbortSignal(attemptForJob(job.id).signal),
              )
            : null;
          if (cached) {
            attemptForJob(job.id).check();
            // A reuse passes the same current provider-egress gate as a dispatch, so a revoked,
            // refused or unavailable source cannot complete from the cache.
            await assertIngestionProviderEgress(
              createIngestionProviderEgressOperation(providerContextForJob(job)),
              "caption",
              bytes,
              attemptForJob(job.id).signal,
            );
            attemptForJob(job.id).check();
            return { task, classification: cached, classificationCacheHit: true };
          }
          try {
            attemptForJob(job.id).check();
            classification = await runIngestionPreparedWork(
              attemptForJob(job.id),
              () => mutation(attemptForJob(job.id), "heartbeat_ingestion_job"),
              () =>
                classifyAndCaptionImageFromBase64({
                  signal: attemptForJob(job.id).signal,
                  ingestionEgress: providerContextForJob(job),
                  base64: bytes.toString("base64"),
                  mimeType: task.image.mimeType,
                  ...classifierInputs,
                }),
            );
          } catch (error) {
            // A non-retryable rejection of THIS image must not fail the whole
            // document (audit L12). Anything else â€” rate limits, timeouts,
            // provider outages, unknown faults â€” still propagates.
            attemptForJob(job.id).check();
            rethrowTerminalProviderError(error);
            const skipReason = visionImageRejectionSkipReason(error);
            if (!skipReason) throw error;
            noteSkippedImage(skipReasons, skipReason);
            return {
              task,
              classification: visionRejectedClassification({
                skipReason,
                tableMetadata: task.tableMetadata,
                sourceKind: task.image.sourceKind ?? null,
              }),
              classificationCacheHit: false,
            };
          }
          if (cacheKey) {
            attemptForJob(job.id).check();
            await writeCachedImageClassification(
              supabase,
              cacheKey,
              classification,
              task.image.mimeType,
              dataPlaneAbortSignal(attemptForJob(job.id).signal),
            );
          }
        }
        return { task, classification, classificationCacheHit: false };
      }),
    );
    resolvedTasks.push(...batchResults);
  }
  // #3730: a reprocess leaves this document's rows for identities it no longer produces (new
  // content, admission or authority facts), and nothing would ever read them again. Prune them
  // once every caption resolved, keeping the ones this run can reuse. A run that bound no
  // identity at all (captioning off, or a source it cannot bind) prunes nothing.
  const ownerId = job.documents.owner_id;
  if (ownerId && cacheIdentities.size > 0) {
    attemptForJob(job.id).check();
    await deleteImageCaptionCacheForDocument(supabase, {
      ownerId,
      documentId: job.document_id,
      keepIdentities: Array.from(cacheIdentities),
      signal: dataPlaneAbortSignal(attemptForJob(job.id).signal),
    });
  }
  return resolvedTasks;
}

/** Phase 3: apply the clinical image policy and persist each retained image, in task order. */
async function persistCaptionedImages(
  ctx: IngestionStageContext,
  job: JobRow,
  resolvedTasks: ResolvedCaptionTask[],
  indexGenerationId: string,
  tally: ImageSkipTally,
) {
  const { attemptForJob, ingestionRpcClient, supabase } = ctx;
  const insertedImages: InsertedImage[] = [];
  let coverImageId: string | null = null;
  const imageTypeCounts = new Map<string, number>();
  for (const resolved of resolvedTasks) {
    const { task, classificationCacheHit } = resolved;
    const { candidate, image, perceptualHash, imageHash, nearbyText, tableMetadata, contextHash } = task;
    let classification = redactImageClassification(resolved.classification);
    const retainedWithoutCaptioning =
      task.presetClassification?.skip_reason === "retained for document view without captioning";
    const policyAssessment = assessClinicalImageUse({
      imageType: classification.image_type,
      searchable: classification.searchable,
      clinicalRelevanceScore: classification.clinical_relevance_score,
      sourceKind: image.sourceKind ?? null,
      tableRole: tableMetadata.tableRole,
      tableText: tableMetadata.tableText,
      tableTitle: tableMetadata.tableTitle,
      tableLabel: tableMetadata.tableLabel,
      caption: classification.caption,
      labels: classification.labels,
      skipReason: classification.skip_reason,
    });
    classification = {
      ...classification,
      searchable: policyAssessment.searchable,
      clinical_relevance_score: policyAssessment.clinical_relevance_score,
      skip_reason: policyAssessment.searchable ? classification.skip_reason : policyAssessment.clinical_use_reason,
      clinical_use_class: policyAssessment.clinical_use_class,
      clinical_use_reason: policyAssessment.clinical_use_reason,
      clinical_signal_score: policyAssessment.clinical_signal_score,
      admin_signal_score: policyAssessment.admin_signal_score,
      structured_visual_profile: normalizeStructuredVisualProfile(
        redactCaptionMetadataValue((classification as ImageClassificationWithVisualProfile).structured_visual_profile),
        {
          fallbackText: [
            tableMetadata.tableTitle,
            tableMetadata.tableLabel,
            classification.caption,
            tableMetadata.tableTextSnippet,
            nearbyText,
          ]
            .filter(Boolean)
            .join(" | "),
          fallbackConfidence: classification.clinical_relevance_score,
        },
      ),
    };
    const structuredVisualProfile = (classification as ImageClassificationWithVisualProfile).structured_visual_profile;
    const structuredExtractionConfidence =
      (classification as ImageClassificationWithVisualProfile).structured_extraction_confidence ??
      structuredVisualProfile?.confidence ??
      0.5;

    const classifiedSkipReason = classifiedImageSkipReason(classification);
    const retainAsCover = image.sourceKind === "cover_page";
    const retainAsAuditTable =
      image.sourceKind === "table_crop" &&
      ["administrative", "reference"].includes(policyAssessment.clinical_use_class) &&
      classification.image_type !== "logo_decorative";
    const retainForDocumentView =
      retainAsAuditTable ||
      retainAsCover ||
      (["table_crop", "diagram_crop", "page_region"].includes(image.sourceKind ?? "") && retainedWithoutCaptioning);
    if (classifiedSkipReason && !retainAsAuditTable && !retainForDocumentView) {
      tally.skippedImages += 1;
      noteSkippedImage(tally.skipReasons, classifiedSkipReason);
      continue;
    }
    const persistedSearchable = !retainAsCover && !retainedWithoutCaptioning && policyAssessment.searchable;
    if (persistedSearchable) {
      imageTypeCounts.set(classification.image_type, (imageTypeCounts.get(classification.image_type) ?? 0) + 1);
    }

    const ext = path.extname(image.path) || ".png";
    const bytes = await readFile(image.path);
    const attempt = attemptForJob(job.id);
    const data = await persistIngestionImage({
      attempt,
      generation: indexGenerationId,
      extension: ext.slice(1).toLowerCase(),
      rpc: (name, payload) =>
        ingestionRpcClient
          .rpc(name, payload)
          .abortSignal(
            CONTROL_PLANE_RPCS.has(name)
              ? controlPlaneAbortSignal(attempt.signal)
              : dataPlaneAbortSignal(attempt.signal),
          ),
      upload: (storagePath, options) =>
        supabase.storage
          .from(env.SUPABASE_IMAGE_BUCKET)
          .upload(storagePath, bytes, { contentType: image.mimeType, ...options }),
      row: {
        id: randomUUID(),
        index_generation_id: indexGenerationId,
        document_id: job.document_id,
        page_number: image.pageNumber,
        mime_type: image.mimeType,
        caption: classification.caption,
        bbox: image.bbox ?? null,
        image_type: classification.image_type,
        searchable: persistedSearchable,
        clinical_relevance_score: persistedSearchable ? classification.clinical_relevance_score : 0,
        source_kind: image.sourceKind ?? "embedded",
        width: image.width ?? null,
        height: image.height ?? null,
        image_hash: imageHash,
        perceptual_hash: perceptualHash,
        labels: classification.labels.map(cleanString),
        metadata: sanitizeJsonbRecord({
          ...(image.metadata ?? {}),
          extractor: "local-worker",
          index_generation_id: indexGenerationId,
          image_hash: imageHash,
          perceptual_hash: perceptualHash,
          classification_cache_hit: classificationCacheHit,
          candidate_type: tableMetadata.candidateType ?? image.metadata?.candidate_type ?? null,
          table_label: tableMetadata.tableLabel,
          table_title: tableMetadata.tableTitle,
          table_text: tableMetadata.tableText,
          table_text_snippet: tableMetadata.tableTextSnippet,
          table_role: tableMetadata.tableRole,
          table_confidence: tableMetadata.tableConfidence,
          table_rows: tableMetadata.tableRows,
          table_columns: tableMetadata.tableColumns,
          table_merged_cells: tableMetadata.tableMergedCells,
          table_row_breaks: tableMetadata.tableRowBreaks,
          accessible_table_markdown: tableMetadata.accessibleTableMarkdown,
          clinical_use_class: policyAssessment.clinical_use_class,
          clinical_use_reason: policyAssessment.clinical_use_reason,
          clinical_signal_score: policyAssessment.clinical_signal_score,
          admin_signal_score: policyAssessment.admin_signal_score,
          image_policy_version: clinicalImagePolicyVersion,
          visual_intelligence_version: visualIntelligenceVersion,
          image_caption_cache_version: imageCaptionCacheVersion,
          vision_classification_prompt_version: visionClassificationPromptVersion,
          caption_context_hash: contextHash,
          visual_family_id: image.metadata?.visual_family_id ?? perceptualHash,
          parent_visual_id: image.metadata?.parent_visual_id ?? null,
          candidate_priority_score: candidate.candidatePriorityScore,
          image_quality_score: candidate.imageQualityScore,
          crop_completeness: candidate.cropCompleteness,
          ocr_text_density: candidate.ocrTextDensity,
          caption_confidence: classification.clinical_relevance_score,
          structured_extraction_confidence: structuredExtractionConfidence,
          visual_duplicate_group: candidate.duplicateGroup,
          structured_visual_profile: structuredVisualProfile,
          visual_budget_class: candidate.captionBudgetClass,
          visual_priority_reasons: candidate.reasons,
          retained_for_audit: retainAsAuditTable || undefined,
          retained_for_document_view: retainForDocumentView || undefined,
          skip_reason: retainAsAuditTable ? classifiedSkipReason : classification.skip_reason,
        }),
      },
    });
    if (image.sourceKind === "cover_page" && !coverImageId) {
      coverImageId = data.id;
    }
    // View-only retained images stay out of retrieval indexes: insertedImages
    // feeds document_index_units / embedding fields. searchable=false must not enter.
    if (data.searchable !== false) {
      insertedImages.push({
        id: data.id,
        caption: data.caption,
        pageNumber: data.page_number,
        imageType: imageEvidenceCategories.has(data.image_type as ImageEvidenceCategory)
          ? (data.image_type as ImageEvidenceCategory)
          : "unclear",
        sourceKind: image.sourceKind ?? "embedded",
        labels: data.labels ?? [],
        tableLabel: tableMetadata.tableLabel,
        tableTitle: tableMetadata.tableTitle,
        tableTextSnippet: tableMetadata.tableTextSnippet,
        tableRole: tableMetadata.tableRole,
        accessibleTableMarkdown: tableMetadata.accessibleTableMarkdown,
        tableRows: tableMetadata.tableRows,
        tableColumns: tableMetadata.tableColumns,
        tableMergedCells: tableMetadata.tableMergedCells,
        tableRowBreaks: tableMetadata.tableRowBreaks,
        structuredVisualProfile: structuredVisualProfile ?? null,
        candidatePriorityScore: candidate.candidatePriorityScore,
        imageQualityScore: candidate.imageQualityScore,
        cropCompleteness: candidate.cropCompleteness,
        ocrTextDensity: candidate.ocrTextDensity,
      });
    }
  }

  return { insertedImages, coverImageId, imageTypeCounts };
}
