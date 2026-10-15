import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/specifiers",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import { SpecifierReferencePage } from "@/components/specifiers/specifier-reference-page";
import { specifierCatalogItems, type SpecifierCatalogItem } from "@/lib/specifiers-content";

// An unsigned catalogue entry withholds its generated definition and says so; a complete
// clinician sign-off is what shows it, attributed to the reviewer and scoped to the
// definition. The review fields are the ones `npm run clinical:review -- --kind specifier`
// writes into the entry's native `review` object.
const defined = specifierCatalogItems().find(
  (item) => item.definitionStatus === "defined" && item.definition?.meaning && item.definition.clinicalNote,
)!;
const placeholder = specifierCatalogItems().find(
  (item) => item.definitionStatus === "needs-manual-or-clinician-verification" && item.definition,
)!;

// Built explicitly rather than read from disk, so the page's behaviour is pinned whatever
// has been signed in the data file since.
function unsigned(item: SpecifierCatalogItem): SpecifierCatalogItem {
  const review = { ...item.review, clinicianReviewStatus: "clinician-review-pending" };
  delete review.reviewedBy;
  delete review.reviewedAt;
  delete review.reviewedContentSha256;
  return { ...item, review };
}

function signed(item: SpecifierCatalogItem, overrides: Partial<SpecifierCatalogItem["review"]> = {}) {
  return {
    ...item,
    review: {
      ...unsigned(item).review,
      clinicianReviewStatus: "clinician-reviewed",
      reviewedBy: "Dr Alex Example",
      reviewedAt: "2026-09-26T03:00:00.000Z",
      reviewedContentSha256: "a".repeat(64),
      ...overrides,
    },
  };
}

describe("specifier reference page clinician review", () => {
  it("withholds an unsigned definition and reads pending", () => {
    render(<SpecifierReferencePage item={unsigned(defined)} />);
    expect(screen.getByText("Definition pending verification")).toBeInTheDocument();
    expect(screen.getByText("Pending qualified review")).toBeInTheDocument();
    expect(screen.queryByText(defined.definition!.meaning)).toBeNull();
    expect(screen.queryByText(/Definition reviewed by/)).toBeNull();
  });

  it("shows a signed definition, attributed to the reviewer, and nothing reads pending", () => {
    render(<SpecifierReferencePage item={signed(defined)} />);
    expect(screen.getByText(defined.definition!.meaning)).toBeInTheDocument();
    expect(screen.getByText(defined.definition!.clinicalNote)).toBeInTheDocument();
    expect(screen.getAllByText("Definition reviewed by Dr Alex Example on 26 September 2026").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("Definition pending verification")).toBeNull();
    expect(screen.queryByText("Pending qualified review")).toBeNull();
    expect(screen.queryByText(/pending qualified clinician/)).toBeNull();
  });

  it("never shows a placeholder row's stand-in definition", () => {
    render(<SpecifierReferencePage item={signed(placeholder)} />);
    expect(screen.queryByText(placeholder.definition!.meaning)).toBeNull();
  });

  it("fails closed on a partial sign-off", () => {
    render(<SpecifierReferencePage item={signed(defined, { reviewedBy: null })} />);
    expect(screen.getByText("Definition pending verification")).toBeInTheDocument();
    expect(screen.queryByText(defined.definition!.meaning)).toBeNull();
  });
});
