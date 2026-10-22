import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { demoDocuments, demoImages, getDemoImage } from "@/lib/demo-data";
import { toDocumentMatch } from "@/lib/document-enrichment";
import { isClinicalImageEvidence } from "@/lib/image-filtering";
import type { RelatedDocument } from "@/lib/types";
import { isMissingStorageObject, selectCommittedCovers } from "../scripts/archive/backfill-document-covers.mjs";
import { readWorkerIngestionSource } from "./helpers/worker-ingestion-source";

const extractorSource = readFileSync(new URL("../worker/python/extract_pdf_assets.py", import.meta.url), "utf8");
// worker/main.ts plus the ingestion stages extracted from it (image captioning holds the cover logic).
const workerSource = readWorkerIngestionSource();
const backfillSource = readFileSync(
  new URL("../scripts/archive/backfill-document-covers.mjs", import.meta.url),
  "utf8",
);

describe("document cover thumbnails", () => {
  it("pages cover backfill with stable ORDER BY for PostgREST range scans", () => {
    expect(backfillSource).toContain('.eq("source_kind", "cover_page")');
    expect(backfillSource).toMatch(
      /\.eq\("source_kind", "cover_page"\)\s*\n\s*\.order\("id", \{ ascending: true \}\)\s*\n\s*\.range\(from, from \+ 999\)/,
    );
    expect(backfillSource).toMatch(
      /\.order\("created_at", \{ ascending: true \}\)\s*\n\s*\.order\("id", \{ ascending: true \}\)\s*\n\s*\.range\(from, from \+ 999\)/,
    );
  });

  it("audits every selected PDF and repairs missing objects or cover metadata", () => {
    expect(backfillSource).toContain('const all = hasFlag("--all")');
    expect(backfillSource).toContain("loadCurrentDocument(candidate.id)");
    expect(backfillSource).toContain("loadCurrentCovers(doc.id)");
    expect(backfillSource).toContain("existingObjectIsLive");
    expect(backfillSource).toContain("recovered cover metadata");
    expect(backfillSource).toContain('.eq("metadata->>index_generation_id", expectedGeneration)');
    expect(backfillSource).toContain("rolled back generation-changed cover repair");
    expect(backfillSource).not.toContain("coveredIds.has(String(doc.id))");
  });

  it("fails closed when a cover probe reports anything except a definite missing object", () => {
    expect(isMissingStorageObject({ status: 404 })).toBe(true);
    expect(isMissingStorageObject({ code: "NoSuchKey" })).toBe(true);
    expect(isMissingStorageObject({ statusCode: "404" })).toBe(true);
    expect(isMissingStorageObject({ status: 403, code: "AccessDenied" })).toBe(false);
    expect(isMissingStorageObject({ status: 503, code: "InternalError" })).toBe(false);
    expect(backfillSource).toContain("probe.error && !isMissingStorageObject(probe.error)");
  });

  it("prefers the document pointer when duplicate committed covers remain", () => {
    const covers = [
      { id: "old", index_generation_id: "generation-a", metadata: {} },
      { id: "pointed", index_generation_id: "generation-a", metadata: {} },
      { id: "staged", index_generation_id: "generation-b", metadata: {} },
    ];

    expect(selectCommittedCovers(covers, "generation-a", "pointed")).toEqual({
      selected: covers[1],
      matches: covers.slice(0, 2),
    });
  });

  it("uses compare-and-swap metadata writes and owned rollback cleanup", () => {
    expect(backfillSource).toContain('.eq("metadata", JSON.stringify(current))');
    expect(backfillSource).toMatch(/cover-page-1-\$\{repairId\}\.png/);
    expect(backfillSource).toContain("failed to roll back replacement cover row");
    expect(backfillSource).toContain("fresh?.metadata?.cover_image_id === insertedId");
    expect(backfillSource).toMatch(
      /failed to roll back replacement cover row[\s\S]*?removeOrQueueReplacedImage\(targetDocument, imagePath\)/,
    );
  });

  it("retires replaced rows only after the pointer moves and preserves storage cleanup", () => {
    expect(backfillSource).toContain("Insert first and retire the previous row only after the document");
    expect(backfillSource).toMatch(
      /patchCoverImageId\(doc\.id, inserted\.id, committedGeneration\)[\s\S]*?retireCoverRow\(doc, existingCover\)/,
    );
    expect(backfillSource).toContain("removeOrQueueReplacedImage(targetDocument, coverRow.storage_path)");
    expect(backfillSource).toContain('supabase.from("storage_cleanup_jobs").insert({');
    expect(backfillSource).toContain('operation: "replace_document_cover"');
  });

  it("extracts a first-page cover_page artifact in the PDF worker", () => {
    expect(extractorSource).toContain("def save_cover_page(");
    expect(extractorSource).toContain('"sourceKind": "cover_page"');
    expect(extractorSource).toContain("Optional cover after searchable artifacts");
  });

  it("persists covers as non-searchable display artifacts outside retrieval inputs", () => {
    expect(workerSource).toContain('image.sourceKind === "cover_page"');
    expect(workerSource).toContain('const retainAsCover = image.sourceKind === "cover_page"');
    expect(workerSource).toContain("cover_image_id: coverImageId");
    expect(workerSource).toContain('candidate.sourceKind !== "cover_page"');
    expect(workerSource).toContain("if (data.searchable !== false) {");
  });

  it("excludes cover pages from clinical image evidence", () => {
    expect(
      isClinicalImageEvidence({
        searchable: false,
        source_kind: "cover_page",
        image_type: "unclear",
        clinicalUseClass: "decorative_or_empty",
      }),
    ).toBe(false);
    expect(
      isClinicalImageEvidence({
        searchable: true,
        sourceKind: "cover_page",
        image_type: "unclear",
      }),
    ).toBe(false);
  });

  it("wires demo cover images onto every demo document and DocumentMatch", () => {
    for (const document of demoDocuments) {
      const cover = demoImages.find((image) => image.document_id === document.id && image.source_kind === "cover_page");
      expect(cover).toBeTruthy();
      expect(cover?.searchable).toBe(false);
      expect(getDemoImage(cover!.id)?.signed_url).toMatch(/-cover\.png$/);
    }

    const related: RelatedDocument = {
      document_id: demoDocuments[0].id,
      title: demoDocuments[0].title,
      file_name: demoDocuments[0].file_name,
      labels: [],
      summary: null,
      best_pages: [1],
      best_chunk_ids: ["chunk-1"],
      image_count: 0,
      table_count: 0,
      cover_image_id: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
      match_reason: "Matched 1 indexed passage",
      score: 1,
    };
    expect(toDocumentMatch(related).coverImageId).toBe("c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0");
  });
});
