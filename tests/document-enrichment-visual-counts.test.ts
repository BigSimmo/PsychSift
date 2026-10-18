import { describe, expect, it, vi } from "vitest";

import { fetchRelatedDocumentMetadata, fetchRelatedDocuments } from "../src/lib/document-enrichment";
import type { SearchResult } from "../src/lib/types";
import { documentMetadataFixture } from "./helpers/document-metadata-fixture";

const results = [
  {
    id: "chunk-1",
    document_id: "document-1",
    title: "Clozapine monitoring",
    file_name: "clozapine.pdf",
    page_number: 2,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "Clozapine monitoring guidance.",
    image_ids: [],
    similarity: 0.9,
    hybrid_score: 0.92,
    images: [],
  },
] as SearchResult[];

function metadataTables() {
  return documentMetadataFixture({
    documents: [{ id: "document-1", owner_id: null, status: "indexed", metadata: { public_corpus: true } }],
    document_summaries: [
      { id: "summary-1", document_id: "document-1", owner_id: null, summary: "Monitoring guidance.", metadata: {} },
    ],
  });
}

describe("related-document visual counts", () => {
  it("skips the visual-count query when includeVisualCounts is false", async () => {
    const supabase = metadataTables();

    const related = await fetchRelatedDocuments({
      supabase: supabase as never,
      query: "clozapine",
      results,
      includeVisualCounts: false,
    });

    expect(supabase.from).not.toHaveBeenCalledWith("document_images");
    expect(related[0]).toMatchObject({ document_id: "document-1", image_count: 0, table_count: 0 });
  });

  it("keeps visual counts enabled by default", async () => {
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      neq: vi.fn(async () => ({
        data: [
          {
            id: "cover-1",
            document_id: "document-1",
            page_number: 1,
            source_kind: "cover_page",
            searchable: false,
            image_type: "unclear",
            clinical_relevance_score: 0,
            metadata: { clinical_use_class: "decorative_or_empty" },
          },
          {
            id: "image-1",
            document_id: "document-1",
            page_number: 2,
            source_kind: "table_crop",
            searchable: true,
            image_type: "table",
            clinical_relevance_score: 0.9,
            metadata: { clinical_use_class: "clinical_evidence" },
          },
        ],
        error: null,
      })),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    const metadata = metadataTables();
    const from = vi.fn((table: string) => (table === "document_images" ? query : metadata.from(table)));
    const supabase = { from };

    const related = await fetchRelatedDocuments({
      supabase: supabase as never,
      query: "clozapine",
      results,
    });

    expect(from.mock.calls.filter(([table]) => table === "document_images")).toHaveLength(1);
    expect(from).toHaveBeenCalledWith("document_images");
    expect(related[0]).toMatchObject({
      document_id: "document-1",
      image_count: 1,
      table_count: 1,
      cover_image_id: "cover-1",
    });
  });

  it("aborts metadata source reads with the caller signal", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    const supabase = documentMetadataFixture({}, { onRead: () => controller.abort(reason) });

    await expect(
      fetchRelatedDocumentMetadata({
        supabase: supabase as never,
        documentIds: ["document-1"],
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
  });
});
