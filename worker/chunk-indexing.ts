// The legacy chunk, embedding-field, table-fact and visual index-unit writes. Moved from
// worker/main.ts; the runtime services arrive through IngestionStageContext.
import { randomUUID } from "node:crypto";
import { env } from "../src/lib/env";
import { buildChunks } from "../src/lib/chunking";
import { ragDeepMemoryVersion } from "../src/lib/deep-memory";
import { assertEmbeddingDim } from "../src/lib/embedding-dimensions";
import { buildVisualDocumentIndexUnitInputs, embeddingTextForDocumentIndexUnit } from "../src/lib/document-index-units";
import type { ExtractedDocument } from "../src/lib/types";
import { annotateChunkAssertions, defaultAssertionTargets } from "./assertion-tagging";
import { dataPlaneAbortSignal, writeIngestionTableFacts } from "./behavior";
import { serializeChunkForPersistence } from "./candidate-chunks";
import { buildAdditionalEmbeddingFieldInputs } from "./embedding-fields";
import { uploadAndCaptionImages } from "./image-captioning";
import {
  optionalIndexWriteWarning,
  rethrowTerminalProviderError,
  type OptionalIndexWriteIssue,
} from "./ingestion-errors";
import {
  cleanString,
  compactSearchText,
  hashEmbeddingFieldContent,
  hashText,
  sanitizeJsonbRecord,
} from "./ingestion-sanitize";
import type { IngestionStageContext } from "./ingestion-stage-context";
import { buildTableFactRows } from "./table-facts";
import type { JobRow } from "./types";

type IndexedChunkRow = ReturnType<typeof buildChunks>[number] & {
  id: string;
  content_hash: string;
  index_generation_id: string;
  embedding: number[];
};

function buildEmbeddingFieldInputs(job: JobRow, chunkRows: IndexedChunkRow[]) {
  const seen = new Set<string>();
  const fields: Array<{
    document_id: string;
    owner_id: string | null;
    source_chunk_id: string;
    field_type: string;
    content: string;
    metadata: Record<string, unknown>;
  }> = [];

  for (const chunk of chunkRows) {
    const sectionPath = chunk.section_path?.length
      ? chunk.section_path.join(" > ")
      : Array.isArray(chunk.metadata?.subsection_path)
        ? (chunk.metadata.subsection_path as unknown[]).map(String).join(" > ")
        : "";
    const content = compactSearchText(
      [job.documents.title, job.documents.file_name, sectionPath, chunk.section_heading].filter(Boolean).join(" | "),
      700,
    );
    if (!content) continue;
    const key = `${chunk.id}:section_context:${content.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({
      owner_id: job.documents.owner_id,
      document_id: job.document_id,
      source_chunk_id: chunk.id,
      field_type: "section_context",
      content,
      metadata: {
        chunk_index: chunk.chunk_index,
        page_number: chunk.page_number,
        anchor_id: chunk.anchor_id ?? null,
      },
    });
  }

  return fields;
}

function buildChunkQualityHint(chunks: ReturnType<typeof buildChunks>) {
  const chunkCount = chunks.length;
  const fingerprints = chunks.map((chunk) => hashText(chunk.content));
  const duplicateChunkRatio = chunkCount ? 1 - new Set(fingerprints).size / Math.max(fingerprints.length, 1) : 0;
  const headingDensity = chunkCount ? chunks.filter((chunk) => chunk.section_heading).length / chunkCount : 0;
  return {
    duplicateChunkRatio: Number(duplicateChunkRatio.toFixed(3)),
    headingDensity: Number(headingDensity.toFixed(3)),
  };
}

export async function insertDocumentLevelEmbeddingFields(
  ctx: IngestionStageContext,
  args: {
    job: JobRow;
    chunkRows: IndexedChunkRow[];
    summary: string | null;
  },
) {
  const { workerEmbedTexts, writeBaseArtifacts } = ctx;
  const sourceChunkId = args.chunkRows[0]?.id;
  if (!sourceChunkId) return [];
  const inputs = [
    {
      field_type: "document_title",
      content: compactSearchText(`${args.job.documents.title} ${args.job.documents.file_name}`, 600),
    },
    {
      field_type: "document_summary",
      content: compactSearchText(`${args.job.documents.title} ${args.summary ?? ""}`, 1200),
    },
  ].filter((field) => field.content);
  if (inputs.length === 0) return [];
  const embeddings = await workerEmbedTexts(
    args.job,
    inputs.map((field) => field.content),
  );
  const rows = inputs.map((field, index) => ({
    owner_id: args.job.documents.owner_id,
    document_id: args.job.document_id,
    source_chunk_id: sourceChunkId,
    field_type: field.field_type,
    content: field.content,
    content_hash: hashEmbeddingFieldContent(field.content),
    embedding: assertEmbeddingDim(embeddings[index], `document_embedding_fields.${field.field_type}`),
    metadata: {
      source: "document_level",
      index_generation_id: args.chunkRows[0]?.index_generation_id ?? null,
    },
  }));
  await writeBaseArtifacts(args.job, args.job.lease_write_generation_id, { embeddingFields: rows });
  return rows.map((row) => row.field_type);
}

export function buildPreparedChunks(
  job: JobRow,
  extracted: ExtractedDocument,
  insertedImages: Awaited<ReturnType<typeof uploadAndCaptionImages>>["insertedImages"],
) {
  const chunkMetadata = {
    source_path: job.documents.source_path ?? null,
    content_hash: job.documents.content_hash ?? null,
    index_generation_id: job.lease_write_generation_id,
    embedding_model: env.OPENAI_EMBEDDING_MODEL,
    extractor: "local-worker",
    rag_indexing_version: ragDeepMemoryVersion,
    rag_memory_version: ragDeepMemoryVersion,
  };
  return buildChunks(
    extracted.pages.map((page) => ({
      documentId: job.document_id,
      pageNumber: page.pageNumber,
      pageText: page.text,
      images: insertedImages.filter((image) => image.pageNumber === null || image.pageNumber === page.pageNumber),
      metadata: {
        ...chunkMetadata,
        ocr_used: Boolean(page.ocrUsed),
      },
    })),
  );
}

export async function annotatePreparedChunks(chunks: ReturnType<typeof buildChunks>) {
  if (env.WORKER_MEDSPACY_ASSERTION) {
    // Fail-open (annotateChunkAssertions never throws): a broken medspaCy install
    // degrades to unannotated chunks, never a failed ingestion job.
    const assertions = await annotateChunkAssertions(
      chunks.map((chunk, index) => ({ id: String(index), text: chunk.content })),
      defaultAssertionTargets(),
    );
    chunks.forEach((chunk, index) => {
      const assertion = assertions.get(String(index));
      if (assertion) chunk.metadata = { ...chunk.metadata, assertion };
    });
  }
}

export async function insertEmbeddedChunks(ctx: IngestionStageContext, job: JobRow, extracted: ExtractedDocument) {
  const { attemptForJob, ingestionRpcClient, updateJob, updateJobProgress, workerEmbedTexts, writeBaseArtifacts } = ctx;
  const pagesByNumber = new Map(extracted.pages.map((page) => [page.pageNumber, page.text] as const));
  const indexGenerationId = job.lease_write_generation_id;
  const imageResult = await uploadAndCaptionImages(ctx, job, extracted, pagesByNumber, indexGenerationId);
  const { insertedImages } = imageResult;
  const optionalIndexWriteIssues: OptionalIndexWriteIssue[] = [];
  await updateJob(job.id, { stage: "chunking", progress: 72 });
  const chunks = buildPreparedChunks(job, extracted, insertedImages);
  await annotatePreparedChunks(chunks);
  const indexedChunkRows: IndexedChunkRow[] = [];

  for (let start = 0; start < chunks.length; start += env.WORKER_BATCH_SIZE) {
    const batch = chunks.slice(start, start + env.WORKER_BATCH_SIZE);
    await updateJobProgress(job.id, {
      stage: `embedding chunks ${start + 1}-${start + batch.length}/${chunks.length}`,
      progress: Math.min(94, 75 + Math.round((start / Math.max(chunks.length, 1)) * 18)),
    });

    const embeddings = await workerEmbedTexts(
      job,
      batch.map((chunk) => chunk.content),
    );
    const rows = batch.map((chunk, index) => ({
      ...serializeChunkForPersistence(chunk, {
        id: randomUUID(),
        generationId: indexGenerationId,
        cleanString,
        sanitizeJsonbRecord,
      }),
      embedding: assertEmbeddingDim(embeddings[index], `document_chunks.${chunk.chunk_index}`),
    })) satisfies IndexedChunkRow[];
    indexedChunkRows.push(...rows);

    await writeBaseArtifacts(job, indexGenerationId, { chunks: rows });

    const fieldInputs = buildEmbeddingFieldInputs(job, rows);
    if (fieldInputs.length > 0) {
      try {
        const fieldEmbeddings = await workerEmbedTexts(
          job,
          fieldInputs.map((field) => field.content),
        );
        const fieldRows = fieldInputs.map((field, index) => ({
          ...field,
          content: cleanString(field.content),
          content_hash: hashEmbeddingFieldContent(cleanString(field.content)),
          embedding: assertEmbeddingDim(fieldEmbeddings[index], `document_embedding_fields.section_context.${index}`),
          metadata: sanitizeJsonbRecord({ ...field.metadata, index_generation_id: indexGenerationId }),
        }));
        for (let start = 0; start < fieldRows.length; start += 50) {
          const batch = fieldRows.slice(start, start + 50);
          await writeBaseArtifacts(job, indexGenerationId, { embeddingFields: batch });
        }
      } catch (error) {
        attemptForJob(job.id).check();
        rethrowTerminalProviderError(error);
        optionalIndexWriteIssues.push(optionalIndexWriteWarning("section-context embedding field", error));
      }
    }
  }

  const tableFacts = buildTableFactRows({ job, chunkRows: indexedChunkRows, insertedImages }).map((row) => ({
    ...row,
    table_title: row.table_title ? cleanString(row.table_title) : null,
    row_label: row.row_label ? cleanString(row.row_label) : null,
    clinical_parameter: row.clinical_parameter ? cleanString(row.clinical_parameter) : null,
    threshold_value: row.threshold_value ? cleanString(row.threshold_value) : null,
    action: row.action ? cleanString(row.action) : null,
    metadata: sanitizeJsonbRecord({ ...row.metadata, index_generation_id: indexGenerationId }),
  }));
  if (tableFacts.length > 0) {
    const attempt = attemptForJob(job.id);
    await writeIngestionTableFacts(
      attempt,
      (name, payload) => ingestionRpcClient.rpc(name, payload).abortSignal(dataPlaneAbortSignal(attempt.signal)),
      indexGenerationId,
      tableFacts,
    );
  }

  const visualIndexUnits = buildVisualDocumentIndexUnitInputs({
    document: {
      id: job.document_id,
      owner_id: job.documents.owner_id,
      title: job.documents.title,
      file_name: job.documents.file_name,
    },
    chunks: indexedChunkRows,
    images: insertedImages,
    tableFacts,
  });
  if (visualIndexUnits.length > 0) {
    try {
      const unitEmbeddings = await workerEmbedTexts(job, visualIndexUnits.map(embeddingTextForDocumentIndexUnit));
      for (let start = 0; start < visualIndexUnits.length; start += 50) {
        const batch = visualIndexUnits.slice(start, start + 50).map((unit, index) => ({
          ...unit,
          embedding: assertEmbeddingDim(unitEmbeddings[start + index], `document_index_units.visual.${start + index}`),
          metadata: sanitizeJsonbRecord({ ...unit.metadata, index_generation_id: indexGenerationId }),
        }));
        await writeBaseArtifacts(job, indexGenerationId, { indexUnits: batch });
      }
    } catch (error) {
      attemptForJob(job.id).check();
      rethrowTerminalProviderError(error);
      optionalIndexWriteIssues.push(optionalIndexWriteWarning("visual index unit", error));
    }
  }

  const additionalFieldInputs = buildAdditionalEmbeddingFieldInputs({
    job,
    chunkRows: indexedChunkRows,
    insertedImages,
    tableFacts,
    qualityHint: buildChunkQualityHint(chunks),
  });
  if (additionalFieldInputs.length > 0) {
    try {
      const additionalEmbeddings = await workerEmbedTexts(
        job,
        additionalFieldInputs.map((field) => field.content),
      );
      const additionalRows = additionalFieldInputs.map((field, index) => {
        const content = cleanString(field.content);
        return {
          ...field,
          content,
          content_hash: hashEmbeddingFieldContent(content),
          embedding: assertEmbeddingDim(additionalEmbeddings[index], `document_embedding_fields.${field.field_type}`),
          metadata: sanitizeJsonbRecord({ ...field.metadata, index_generation_id: indexGenerationId }),
        };
      });
      for (let start = 0; start < additionalRows.length; start += 50) {
        const batch = additionalRows.slice(start, start + 50);
        await writeBaseArtifacts(job, indexGenerationId, { embeddingFields: batch });
      }
    } catch (error) {
      attemptForJob(job.id).check();
      rethrowTerminalProviderError(error);
      optionalIndexWriteIssues.push(optionalIndexWriteWarning("supplemental embedding field", error));
    }
  }

  return {
    chunks,
    indexedChunkRows,
    indexGenerationId,
    imageCount: insertedImages.length,
    insertedImages,
    coverImageId: imageResult.coverImageId,
    skippedImages: imageResult.skippedImages,
    imageSkipReasons: imageResult.skipReasons,
    imageTypeCounts: imageResult.imageTypeCounts,
    optionalIndexWriteIssues,
  };
}
