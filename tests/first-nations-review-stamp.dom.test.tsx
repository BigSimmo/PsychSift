// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewStamp } from "@/components/first-nations/review-stamp";
import { stableHash } from "@/lib/first-nations/approval";
import { buildReviewStamp } from "@/lib/first-nations/review-stamp";
import { reviewStampText } from "@/lib/first-nations/review-stamp-text";

const block = { id: "b1", kind: "tip", do: "x" };
const approval = {
  subjectId: "b1",
  body: "Reviewer Body",
  role: "Elder",
  date: "2026-03-12",
  reference: "ref",
  contentSha256: stableHash(block),
};

describe("First Nations review stamp", () => {
  it("is built from the source title and the matching approval record only", () => {
    const stamp = buildReviewStamp("Source A", [approval], [{ subjectId: "b1", content: block }]);
    expect(reviewStampText(stamp)).toBe("Source: Source A · Reviewed by Reviewer Body, Elder · 12 Mar 2026");
  });

  it("distinguishes no review from a review of stale content", () => {
    expect(reviewStampText(buildReviewStamp("Source A", [], [{ subjectId: "b1", content: block }]))).toBe(
      "Source: Source A · No current cultural review recorded",
    );
    const changed = { ...block, do: "y" };
    expect(reviewStampText(buildReviewStamp("Source A", [approval], [{ subjectId: "b1", content: changed }]))).toBe(
      "Source: Source A · No current cultural review recorded",
    );
  });

  it("renders the muted line, and nothing when there is no stamp", () => {
    const { container, rerender } = render(
      <ReviewStamp stamp={{ source: "Source A", reviewer: null, reviewedOn: null }} />,
    );
    expect(screen.getByText("Source: Source A · No current cultural review recorded")).toBeTruthy();
    rerender(<ReviewStamp />);
    expect(container.textContent).toBe("");
  });
});
