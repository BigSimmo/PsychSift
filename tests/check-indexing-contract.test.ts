import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hasChunkCountMismatch,
  isEmptyIndexedDocument,
  type IndexingHealthDocument,
} from "../scripts/lib/indexing-health-document";

const source = readFileSync(new URL("../scripts/check-indexing.ts", import.meta.url), "utf8");
const smartBackfillSource = readFileSync(new URL("../scripts/backfill-smart-index.ts", import.meta.url), "utf8");
const enrichDocumentsSource = readFileSync(new URL("../scripts/enrich-documents.ts", import.meta.url), "utf8");

describe("indexing health scan", () => {
  it("does not require an OpenAI key for the staging offline profile", () => {
    expect(source).toContain('if (env.RAG_PROVIDER_MODE !== "offline") requireOpenAIEnv();');
  });

  it("uses bounded document batches large enough for the production corpus", () => {
    const batchSize = Number(source.match(/const documentIdBatchSize = (\d+);/)?.[1]);
    expect(batchSize).toBeGreaterThanOrEqual(50);
  });

  it("loads independent artifact families concurrently", () => {
    expect(source).toMatch(
      /const \[sections, memoryCards, chunks, tableFacts, embeddingFields, qualityRows\] = await Promise\.all/,
    );
    expect(source).toMatch(
      /const \[enrichmentRows, deepMemoryRows, registryChunkRows\] = await Promise\.all\(\[\s*loadEnrichmentRows/,
    );
  });

  it("keeps lightweight registry projections in core search checks without requiring PDF artifacts", () => {
    expect(source).toContain("const richIndexedDocuments = indexedDocuments.filter");
    expect(source).toContain("searchable registry projections");
    expect(source).toContain("indexedDocuments.filter(isEmptyIndexedDocument)");
    expect(source).toContain('loadRowsForDocuments(supabaseForChecks, "document_chunks", "document_id"');
    expect(source).toContain("for (const chunk of registryChunkRows)");
    expect(source).toContain("const documentsWithChunkCountMismatch = indexedDocuments.filter");

    const registryProjection: IndexingHealthDocument = {
      status: "indexed",
      file_name: "australian-medicine-handbook.registry.json",
      page_count: 0,
      chunk_count: 1,
      metadata: { source_kind: "registry_record", registry_record_id: "synthetic-service-record" },
    };

    expect(isEmptyIndexedDocument(registryProjection)).toBe(false);
    expect(isEmptyIndexedDocument({ ...registryProjection, chunk_count: 0 })).toBe(true);
    expect(isEmptyIndexedDocument({ ...registryProjection, file_name: "guideline.pdf" })).toBe(true);
    expect(hasChunkCountMismatch(registryProjection, 0)).toBe(true);
    expect(hasChunkCountMismatch(registryProjection, 1)).toBe(false);
  });
});

describe("smart-index repair selection", () => {
  it("does not combine an exact document id with an ambient owner default", () => {
    expect(smartBackfillSource).toContain("if (args.documentId) args.ownerId = undefined");
  });

  it.each([
    ["smart backfill", smartBackfillSource],
    ["document enrichment", enrichDocumentsSource],
  ])("binds %s to typed/raw exact-generation authority before source/provider work", (_label, scriptSource) => {
    expect(scriptSource).toContain("index_generation_id");
    expect(scriptSource).toContain("requireExactSourceAnchoredGeneration");
    expect(scriptSource).toContain('.eq("index_generation_id", indexGenerationId)');
    expect(scriptSource).toContain("assertSourceAnchoredSummaryPreflight");
    expect(scriptSource).toContain("SOURCE_ANCHORED_MAX_CHUNKS");
    expect(scriptSource).toContain("SOURCE_ANCHORED_MAX_IMAGES");
    expect(scriptSource).toContain("source_anchored_summary_source_limit_exceeded");
    expect(scriptSource).toMatch(/upsertDocumentEnrichment\(\{[\s\S]*?indexGenerationId(?:\s*:\s*generationId)?,/);
  });

  it("does not use metadata repair/random UUID fallback as summary generation authority", () => {
    const enrichmentSection = smartBackfillSource.slice(
      smartBackfillSource.indexOf("async function processDocument"),
    );
    expect(enrichmentSection).not.toContain("repairChunkIndexingMetadata(");
    expect(enrichmentSection).not.toContain("randomUUID(");
  });
});
