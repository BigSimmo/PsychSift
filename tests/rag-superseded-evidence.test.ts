import { describe, expect, it } from "vitest";
import { excludeSupersededEvidence } from "../src/lib/rag/superseded-evidence";
import type { SearchResult } from "../src/lib/types";

type Status = NonNullable<SearchResult["source_metadata"]>["document_status"];
const row = (id: string, status?: Status) =>
  ({ id, source_metadata: status ? { document_status: status } : undefined }) as unknown as SearchResult;

describe("superseded sources are never used as evidence (#BFCTST)", () => {
  it("removes outdated sources and keeps current, review-due, unknown and unlabelled ones in order", () => {
    const kept = excludeSupersededEvidence([
      row("current", "current"),
      row("old", "outdated"),
      row("review-due", "review_due"),
      row("unknown", "unknown"),
      row("unlabelled"),
    ]).map((result) => result.id);
    expect(kept).toEqual(["current", "review-due", "unknown", "unlabelled"]);
  });

  it("leaves no evidence when every match is superseded, so the answer degrades to an evidence gap", () => {
    expect(excludeSupersededEvidence([row("old-1", "outdated"), row("old-2", "outdated")])).toEqual([]);
  });
});
