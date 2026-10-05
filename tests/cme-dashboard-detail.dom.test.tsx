import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CmeDashboard } from "@/components/cme/cme-dashboard";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

const set: CmeRequirementSet = {
  year: 2026,
  confirmedOn: "2026-01-08",
  confirmedSource: "College CPD guide",
  totalHours: 10,
  requirements: [
    {
      id: "education",
      label: "Educational activities",
      source: "national",
      spec: { shape: "hours-in-category", category: "educational", minimumHours: 5 },
      completedOn: null,
    },
  ],
};
const entries: CmeEntry[] = [
  {
    id: "one",
    date: "2026-04-01",
    title: "Journal club",
    allocations: [
      { category: "educational", hours: 2 },
      { category: "reviewing", hours: 1 },
    ],
    reflection: "Useful",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  },
  {
    id: "archived",
    date: "2026-05-01",
    title: "Archived",
    allocations: [{ category: "educational", hours: 9 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    archivedAt: "2026-05-02T00:00:00Z",
  },
];
const routines: CmeRoutine[] = [
  {
    id: "journal",
    title: "Journal club",
    cadence: "monthly",
    usualHours: 2,
    usualAllocations: [{ category: "educational", hours: 2 }],
    nextDue: "2026-10-01",
    archivedAt: null,
  },
];

function renderDashboard() {
  return render(
    <CmeDashboard set={set} entries={entries} routines={routines} now={new Date("2026-09-26T04:00:00Z")} />,
  );
}

describe("Today figure details", () => {
  it("names the saved-record snapshot with a still tick, never an animated dot", () => {
    renderDashboard();
    const freshness = screen.getByTestId("cme-data-freshness");
    expect(freshness).toHaveTextContent("Saved records loaded at");
    expect(freshness.querySelector(".mode-band__saved-tick")).not.toBeNull();
    expect(freshness.querySelector("[class*='animate-']")).toBeNull();
  });

  it("opens the total from saved, unarchived activities and links to the year Log", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(within(screen.getByTestId("cme-hero-summary")).getByRole("button"));
    const sheet = screen.getByTestId("cme-today-detail-sheet");
    expect(within(sheet).getByTestId("cme-today-detail-total")).toHaveTextContent("3 h from 1 saved activity");
    expect(within(sheet).getByText(/College CPD guide/)).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "View this year's Log" })).toHaveAttribute(
      "href",
      "/cme/log?year=2026",
    );
  });

  it("explains a category figure and opens Log filtered to that category", async () => {
    const user = userEvent.setup();
    renderDashboard();
    // The requirement's own row in "What's left" opens its detail (the separate fact tiles are gone).
    await user.click(
      within(screen.getByTestId("cme-requirements")).getByRole("button", { name: /Educational activities/ }),
    );
    const sheet = screen.getByTestId("cme-today-detail-sheet");
    expect(within(sheet).getByTestId("cme-today-detail-total")).toHaveTextContent("2 h from 1 saved activity");
    expect(within(sheet).getByRole("link", { name: /educational activities in Log/i })).toHaveAttribute(
      "href",
      "/cme/log?year=2026&category=educational",
    );
  });

  it("shows a routine scenario without counting it as completed work", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(screen.getByTestId("cme-close-gap"));
    const sheet = screen.getByTestId("cme-today-detail-sheet");
    expect(within(sheet).getByText(/7 h remain to your 10 h target/)).toBeInTheDocument();
    expect(within(sheet).getByTestId("cme-gap-scenarios")).toHaveTextContent(
      /3 × 2\s+h = 6\s+h by 31\s+Dec, short of the gap/,
    );
    expect(within(sheet).getByText(/Only activities you actually do and save count/)).toBeInTheDocument();
  });
});
