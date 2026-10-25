import { describe, expect, it, vi } from "vitest";

import {
  carryImageReview,
  carryTableFactReview,
  loadPriorImageReviews,
  priorImageReviews,
  priorTableFactReviews,
} from "../worker/review-carry-forward";

// Audit E2E-04 (24 Oct 2026): an owner's table and figure reviews were lost on re-index, so a table
// switched off as a bad extraction came back into answers. Synthetic rows only.
const badExtraction = {
  review_class: "bad_extraction",
  clinical_use_class: "ambiguous",
  table_role: "unrelated",
  reviewed_by: "owner-1",
  reviewed_at: "2026-10-20T00:00:00.000Z",
};

const fact = {
  page_number: 11,
  table_title: "Clozapine blood monitoring",
  row_label: "ANC below 1.5",
  clinical_parameter: "ANC",
  threshold_value: "< 1.5",
  action: "withhold clozapine",
};

describe("review carry-forward across a re-index (E2E-04)", () => {
  it("keeps a reviewed figure unsearchable on the new generation, matched by image content", () => {
    const reviews = priorImageReviews([
      { image_hash: "hash-a", metadata: badExtraction, index_generation_id: "gen-old" },
    ]);
    const carried = carryImageReview(
      {
        image_hash: "hash-a",
        searchable: true,
        metadata: { index_generation_id: "gen-new", clinical_use_class: "clinical_evidence" },
      },
      reviews,
    );
    expect(carried.searchable).toBe(false);
    expect(carried.metadata).toMatchObject({
      index_generation_id: "gen-new",
      review_class: "bad_extraction",
      clinical_use_class: "ambiguous",
      review_carried_from_generation: "gen-old",
    });
    const unrelated = carryImageReview({ image_hash: "hash-b", searchable: true, metadata: {} }, reviews);
    expect(unrelated.searchable).toBe(true);
  });

  it("never makes searchable a figure the new extraction left unsearchable", () => {
    const reviews = priorImageReviews([
      {
        image_hash: "hash-a",
        metadata: { ...badExtraction, review_class: "clinical_useful" },
        index_generation_id: null,
      },
    ]);
    expect(carryImageReview({ image_hash: "hash-a", searchable: false, metadata: {} }, reviews).searchable).toBe(false);
  });

  it("carries a table fact's review when the page, title, row and cells match, ignoring case and spacing", () => {
    const reviews = priorTableFactReviews([{ ...fact, metadata: badExtraction, index_generation_id: "gen-old" }]);
    const carried = carryTableFactReview(
      {
        ...fact,
        row_label: "ANC  below 1.5",
        table_title: "clozapine blood monitoring",
        metadata: { index_generation_id: "gen-new" },
      },
      reviews,
    );
    expect(carried.metadata).toMatchObject({
      review_class: "bad_extraction",
      review_carried_from_generation: "gen-old",
    });
    const changedCell = carryTableFactReview({ ...fact, threshold_value: "< 2.0", metadata: {} }, reviews);
    expect(changedCell.metadata).not.toHaveProperty("review_class");
  });

  it("uses the most recent review when the same content was reviewed on more than one generation", () => {
    const reviews = priorTableFactReviews([
      {
        ...fact,
        metadata: { ...badExtraction, reviewed_at: "2026-10-01T00:00:00.000Z" },
        index_generation_id: "gen-1",
      },
      {
        ...fact,
        metadata: { ...badExtraction, review_class: "clinical_useful", reviewed_at: "2026-10-22T00:00:00.000Z" },
        index_generation_id: "gen-2",
      },
    ]);
    expect(carryTableFactReview({ ...fact, metadata: {} }, reviews).metadata).toMatchObject({
      review_class: "clinical_useful",
      review_carried_from_generation: "gen-2",
    });
  });

  it("reads reviewed rows from every other generation of the document, legacy unstamped rows included", async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const query = {
      select: (...args: unknown[]) => (calls.push(["select", ...args]), query),
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), query),
      or: (...args: unknown[]) => (calls.push(["or", ...args]), query),
      not: (...args: unknown[]) => (calls.push(["not", ...args]), query),
      limit: (...args: unknown[]) => (
        calls.push(["limit", ...args]),
        Promise.resolve({
          data: [{ image_hash: "hash-a", metadata: badExtraction, index_generation_id: null }],
          error: null,
        })
      ),
    };
    const supabase = { from: vi.fn(() => query) };
    const reviews = await loadPriorImageReviews(supabase as never, "doc-1", "gen-new");
    expect(supabase.from).toHaveBeenCalledWith("document_images");
    expect(calls).toContainEqual(["eq", "document_id", "doc-1"]);
    expect(calls).toContainEqual(["or", "index_generation_id.is.null,index_generation_id.neq.gen-new"]);
    expect(calls).toContainEqual(["not", "metadata->>review_class", "is", null]);
    expect(reviews.get("hash-a")?.review.review_class).toBe("bad_extraction");
  });

  it("fails the job rather than dropping reviews when they cannot be read", async () => {
    const query = {
      select: () => query,
      eq: () => query,
      or: () => query,
      not: () => query,
      limit: () => Promise.resolve({ data: null, error: { message: "timeout" } }),
    };
    await expect(loadPriorImageReviews({ from: () => query } as never, "doc-1", "gen-new")).rejects.toThrow(
      "Could not read prior document_images reviews: timeout",
    );
  });
});
