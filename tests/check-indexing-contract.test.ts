import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { offlineTestEnvironment } from "../scripts/test-environment.mjs";
import {
  hasChunkCountMismatch,
  isEmptyIndexedDocument,
  type IndexingHealthDocument,
} from "../scripts/lib/indexing-health-document";

const source = readFileSync(new URL("../scripts/check-indexing.ts", import.meta.url), "utf8");
const smartBackfillSource = readFileSync(new URL("../scripts/backfill-smart-index.ts", import.meta.url), "utf8");

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
      file_name: "synthetic-crisis-service.registry.json",
      page_count: 0,
      chunk_count: 1,
      metadata: { source_kind: "registry_record", registry_record_id: "synthetic-crisis-service" },
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

  it.each([{ mode: [] }, { mode: ["--metadata-only"] }])(
    "refuses legacy writes before credential validation, provider calls or database mutations ($mode)",
    ({ mode }) => {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/run-tsx.mjs",
          "scripts/backfill-smart-index.ts",
          "--document-id",
          "11111111-1111-4111-8111-111111111111",
          "--write",
          "--confirm",
          ...mode,
        ],
        {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          env: { ...offlineTestEnvironment(process.env), NODE_ENV: "test" },
          encoding: "utf8",
          timeout: 15_000,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Legacy smart-index writes require scanner-bound worker admission");
      expect(result.stderr).not.toContain("Missing server environment variables");
      expect(result.stdout).not.toMatch(/WROTE|REPAIRED/);
    },
    20_000,
  );
});
