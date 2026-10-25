import { describe, expect, it } from "vitest";

import { buildSourceProvenanceGapReport, sourceProvenanceGaps } from "@/lib/source-provenance-gaps";

const complete = {
  licence_policy: "public_index_permitted",
  publication_date: "2024-03-01",
  clinical_validation_status: "locally_reviewed",
  document_status: "current",
};

describe("source provenance gaps (audit 2026-10-24 E2E-10)", () => {
  it("finds nothing missing on a complete, reviewed document", () => {
    expect(sourceProvenanceGaps({ id: "a", title: "A", status: "indexed", metadata: complete })).toEqual([]);
  });

  it("names each missing fact on a fresh upload", () => {
    expect(sourceProvenanceGaps({ id: "b", title: "B", status: "indexed", metadata: {} })).toEqual([
      "no_licence_basis",
      "no_publication_date",
      "not_reviewed",
    ]);
  });

  it("puts a still-searchable document whose licence forbids indexing first", () => {
    const report = buildSourceProvenanceGapReport([
      { id: "fresh", title: "Fresh upload", status: "indexed", metadata: {} },
      {
        id: "downgraded",
        title: "Licence withdrawn",
        status: "indexed",
        metadata: { ...complete, licence_policy: "index_forbidden" },
      },
      { id: "fine", title: "Fine", status: "indexed", metadata: complete },
    ]);
    expect(report.searchable).toBe(3);
    expect(report.documents.map((document) => document.id)).toEqual(["downgraded", "fresh"]);
    expect(report.counts).toEqual({
      licence_forbids_indexing: 1,
      no_licence_basis: 1,
      no_publication_date: 1,
      not_reviewed: 1,
    });
  });

  it("leaves out documents that cannot answer: not indexed, or already marked outdated", () => {
    const report = buildSourceProvenanceGapReport([
      { id: "queued", title: null, status: "queued", metadata: {} },
      {
        id: "outdated",
        title: null,
        status: "indexed",
        metadata: { licence_policy: "index_forbidden", document_status: "outdated" },
      },
    ]);
    expect(report).toEqual({
      searchable: 0,
      counts: { licence_forbids_indexing: 0, no_licence_basis: 0, no_publication_date: 0, not_reviewed: 0 },
      documents: [],
    });
  });

  it("counts a row with no status column as searchable, so a thin export can only widen the report", () => {
    expect(buildSourceProvenanceGapReport([{ id: "x", title: null, metadata: {} }]).searchable).toBe(1);
  });
});
