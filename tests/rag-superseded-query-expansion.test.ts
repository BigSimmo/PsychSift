/**
 * Audit RET-N5 (24 Oct 2026): the document-name lookup added candidate titles and headings to the
 * text used for the meaning-based search without checking for superseded documents, so an old
 * version's title could pull that search towards rows that are then thrown away (#BFCTST).
 */
import { describe, expect, it } from "vitest";
import { expandClinicalQueryWithCandidateMetadata } from "../src/lib/rag/rag-metadata-expansion";
import type { SearchResult } from "../src/lib/types";

function candidate(status: "current" | "outdated") {
  return {
    id: `chunk-${status}`,
    document_id: `doc-${status}`,
    title: "Clozapine Haematological Monitoring Protocol",
    file_name: "clozapine-haematological-monitoring.pdf",
    section_heading: "Neutrophil monitoring thresholds",
    content: "Synthetic passage.",
    source_metadata: { document_status: status },
  } as unknown as SearchResult;
}

describe("query expansion ignores superseded candidates (RET-N5)", () => {
  const query = "clozapine neutrophil threshold";

  it("adds a current candidate's title terms (control)", () => {
    expect(expandClinicalQueryWithCandidateMetadata(query, query, [candidate("current")])).not.toBe(query);
  });

  it("adds nothing from a superseded candidate", () => {
    expect(expandClinicalQueryWithCandidateMetadata(query, query, [candidate("outdated")])).toBe(query);
  });
});
