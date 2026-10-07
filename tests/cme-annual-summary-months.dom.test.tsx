import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CmeAnnualSummary } from "@/components/cme/cme-annual-summary";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const now = new Date("2026-09-19T02:00:00Z");

function renderSummary() {
  return render(<CmeAnnualSummary set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={now} demoMode />);
}

describe("CPD annual summary months", () => {
  it("folds the activity record by month with a count and hours on each", () => {
    renderSummary();
    const months = screen.getAllByTestId("cme-summary-month") as HTMLDetailsElement[];
    expect(months.length).toBeGreaterThan(1);
    expect(months.every((month) => !month.open)).toBe(true);
    const september = months.find((month) => month.textContent?.includes("September 2026"));
    expect(september).toBeDefined();
    expect(within(september!).getByText(/\d+ activit(y|ies) · [\d.]+ h/)).toBeInTheDocument();
  });

  it("links to Send to AMA CPD Home for the year and to Job applications", () => {
    renderSummary();
    const more = screen.getByTestId("cme-summary-more");
    expect(within(more).getByTestId("cpd-home-entry-link").getAttribute("href")).toBe(
      `/cme/cpd-home?year=${DEMO_CME_YEAR.year}`,
    );
    expect(within(more).getByTestId("applications-entry-link").getAttribute("href")).toBe("/cme/applications");
  });

  it("keeps every activity in the page so nothing is lost when folded", () => {
    renderSummary();
    const list = screen.getByTestId("cme-summary-months");
    const active = DEMO_CME_ENTRIES.filter((entry) => !entry.archivedAt && entry.date.startsWith("2026"));
    expect(list.querySelectorAll("section")).toHaveLength(active.length);
  });

  it("opens every month for printing and restores the fold afterwards", () => {
    renderSummary();
    const months = screen.getAllByTestId("cme-summary-month") as HTMLDetailsElement[];
    months[0].open = true;
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(months.every((month) => month.open)).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(months[0].open).toBe(true);
    expect(months.slice(1).every((month) => !month.open)).toBe(true);
  });
});
