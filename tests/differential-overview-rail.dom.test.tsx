import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DifferentialOverviewRail } from "@/components/differentials/differential-overview-rail";
import { curatedEntryFor } from "@/lib/differential-curated";
import type { DifferentialDetailContext } from "@/lib/differential-detail";
import type { DifferentialRecord } from "@/lib/differentials";

const detailContext: DifferentialDetailContext = {
  knownRelatedSlugs: ["verified-related"],
  relatedMapDetails: {},
  termLinks: {},
  overlapLinks: {},
  comparePresentation: null,
  curated: null,
  source: {
    version: "v10",
    exportedAt: "2026-07-11T00:00:00.000Z",
    reviewStatus: "Pending review",
    sourceTitle: "Differentials",
    sourceStatus: "review_due",
    validationStatus: "unverified",
  },
};

function makeRecord(overrides: Partial<DifferentialRecord> = {}): DifferentialRecord {
  return {
    slug: "focus-diagnosis",
    title: "Focus diagnosis",
    status: "urgent",
    subtitle: "Focus subtitle",
    clinicalHinge: "Focus clinical hinge.",
    safetySnapshot: { summary: "Focus safety summary.", tags: ["Focus risk"] },
    sections: [],
    related: [
      { id: "verified-related", label: "Verified related", likelihood: "possible", note: "Note." },
      { id: "dangerous-related", label: "Dangerous related", likelihood: "must-not-miss", note: "Urgent note." },
    ],
    currentPresentation: [],
    investigations: ["Serum electrolytes", "Full blood count"],
    immediateActions: ["Stop the offending agent", "Escalate to the medical registrar"],
    ...overrides,
  };
}

describe("DifferentialOverviewRail", () => {
  it("summarises the record's own actionable content", () => {
    render(<DifferentialOverviewRail record={makeRecord()} detailContext={detailContext} onOpenSource={() => {}} />);

    const rail = screen.getByTestId("differential-overview-rail");
    expect(within(rail).getByText("Points for this presentation")).toBeInTheDocument();
    expect(within(rail).getByText("Stop the offending agent")).toBeInTheDocument();
    expect(within(rail).getByText("Serum electrolytes")).toBeInTheDocument();
    expect(within(rail).getByText("Focus risk")).toBeInTheDocument();

    // Only slugs verified against the catalogue become links, so no rail row
    // navigates to a page that does not exist.
    expect(within(rail).getByRole("link", { name: /Verified related/ })).toHaveAttribute(
      "href",
      "/differentials/diagnoses/verified-related",
    );
    expect(within(rail).queryByRole("link", { name: /Dangerous related/ })).toBeNull();
    expect(within(rail).getByText("Exclude")).toBeInTheDocument();

    expect(within(rail).getByText("Review due")).toBeInTheDocument();
    expect(within(rail).getByText(/v10 · exported 2026-07-11/)).toBeInTheDocument();
  });

  it("draws no empty headings for a sparse record", () => {
    // 150 of the 201 catalogue records carry no investigations and 110 carry no
    // immediate actions, so this is the common case, not the edge case.
    const sparse = makeRecord({
      investigations: [],
      immediateActions: [],
      related: [],
      safetySnapshot: { summary: "", tags: [] },
    });
    render(<DifferentialOverviewRail record={sparse} detailContext={detailContext} onOpenSource={() => {}} />);

    const rail = screen.getByTestId("differential-overview-rail");
    expect(within(rail).queryByText("Do now")).toBeNull();
    expect(within(rail).queryByText("First-line tests")).toBeNull();
    expect(within(rail).queryByText("Watch for")).toBeNull();
    expect(within(rail).queryByText("Also consider")).toBeNull();
    // Provenance is the one block that always renders: an unverified record is
    // exactly the one a reader needs the source state for.
    expect(within(rail).getByText("Source and review")).toBeInTheDocument();
  });

  it("prefers authored first moves and says so", () => {
    // `lithium-physiological-withdrawal-tremor` is one of the seeded records:
    // its generated "immediate actions" are four statements about akathisia and
    // parkinsonism, none of which is an action.
    render(
      <DifferentialOverviewRail
        record={makeRecord({
          slug: "lithium-physiological-withdrawal-tremor",
          immediateActions: ["One of the most commonly missed and most distressing psychiatric side effects"],
        })}
        // The authored entry is resolved server-side and travels on the
        // context, so the corpus never reaches the client bundle.
        detailContext={{ ...detailContext, curated: curatedEntryFor("lithium-physiological-withdrawal-tremor") }}
        onOpenSource={() => {}}
      />,
    );

    const rail = screen.getByTestId("differential-overview-rail");
    expect(within(rail).getByText(/Characterise the tremor/)).toBeInTheDocument();
    expect(within(rail).queryByText(/One of the most commonly missed/)).toBeNull();
    expect(within(rail).getByText("Locally authored — verify before use")).toBeInTheDocument();
  });
});
