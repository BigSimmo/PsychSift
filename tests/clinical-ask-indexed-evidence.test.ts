import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchChunksWithTelemetry } = vi.hoisted(() => ({ searchChunksWithTelemetry: vi.fn() }));
vi.mock("@/lib/rag/rag", () => ({ searchChunksWithTelemetry }));

import { retrieveIndexedEvidence } from "@/lib/clinical-ask/indexed-evidence";
import type { RetrievalAccessScope } from "@/lib/owner-scope";
import { clinicalAskCases } from "./fixtures/clinical-ask-cases";

const result = {
  id: "chunk-private",
  document_id: "document-private",
  title: "Example clinical guideline",
  file_name: "guideline.pdf",
  page_number: 4,
  chunk_index: 3,
  section_heading: "Eligibility",
  content: "Adults are eligible for the example pathway.",
  image_ids: [],
  images: [],
  similarity: 0.91,
  source_metadata: {
    source_title: "Example clinical guideline",
    publisher: "Example Health Service",
    jurisdiction: "Example jurisdiction",
    version: "1",
    publication_date: "2026-01-01",
    review_date: "2026-06-01",
    uploaded_at: "2026-01-02",
    indexed_at: "2026-01-03",
    uploaded_by: null,
    document_status: "current",
    clinical_validation_status: "approved",
    extraction_quality: "good",
  },
};

describe("retrieveIndexedEvidence", () => {
  beforeEach(() => {
    searchChunksWithTelemetry.mockReset();
    searchChunksWithTelemetry.mockResolvedValue({ results: [result], telemetry: { private: "not projected" } });
  });

  it.each([
    [{ ownerId: "owner-a", includePublic: true }, false],
    [{ includePublic: true }, true],
  ] as Array<[RetrievalAccessScope, boolean]>)("preserves owner scope %#", async (accessScope, allowGlobalSearch) => {
    const request = clinicalAskCases[0];
    const signal = new AbortController().signal;

    const evidence = await retrieveIndexedEvidence(request, accessScope, signal);

    expect(searchChunksWithTelemetry).toHaveBeenCalledWith({
      query: request.question,
      topK: 12,
      accessScope,
      allowGlobalSearch,
      signal,
    });
    expect(searchChunksWithTelemetry.mock.calls[0][0]).not.toHaveProperty("ownerId");
    expect(evidence).toEqual([
      {
        id: "indexed:chunk-private",
        tier: "indexed",
        title: "Example clinical guideline",
        publisher: "Example Health Service",
        jurisdiction: "Example jurisdiction",
        href: "/documents/document-private?page=4&chunk=chunk-private",
        extract: result.content,
        reviewState: "reviewed",
        publishedAt: "2026-01-01",
        updatedAt: "2026-06-01",
        retrievedAt: null,
      },
    ]);
    expect(JSON.stringify(evidence)).not.toMatch(/similarity|telemetry|document-private.*document-private/);
  });

  it("never uses a superseded (outdated) source as evidence (#BFCTST, E2E-06)", async () => {
    const outdated = {
      ...result,
      id: "chunk-outdated",
      source_metadata: { ...result.source_metadata, document_status: "outdated" },
    };
    searchChunksWithTelemetry.mockResolvedValue({ results: [outdated, result], telemetry: {} });

    const evidence = await retrieveIndexedEvidence(
      clinicalAskCases[0],
      { includePublic: true },
      new AbortController().signal,
    );

    expect(evidence.map((item) => item.id)).toEqual(["indexed:chunk-private"]);
  });
});
