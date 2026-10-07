/** @vitest-environment jsdom */

// CPD exports while CPD shows example data: Save as PDF and Download CSV
// explain instead of exporting, because the CSV route reads the account and
// would hand over REAL records from a page showing examples.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmeAnnualSummary } from "@/components/cme/cme-annual-summary";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { EXAMPLE_BLOCKED_EVENT } from "@/lib/example-data/guards";
import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const now = new Date("2026-09-19T02:00:00Z");

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
});

afterEach(() => cleanup());

describe("CPD annual summary exports with example data", () => {
  it("blocks both exports while example data is on, and offers the real CSV link when it is off", () => {
    const blocked = vi.fn();
    window.addEventListener(EXAMPLE_BLOCKED_EVENT, blocked);
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      act(() => setExampleDataOn(true));
      render(<CmeAnnualSummary set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={now} demoMode />);
      expect(screen.queryByRole("link", { name: "Download CSV" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
      fireEvent.click(screen.getByTestId("cme-summary-save-pdf"));
      expect(blocked).toHaveBeenCalledTimes(2);
      expect(print).not.toHaveBeenCalled();

      act(() => setExampleDataOn(false));
      expect(screen.getByRole("link", { name: "Download CSV" }).getAttribute("href")).toBe(
        `/api/cme/export?year=${DEMO_CME_YEAR.year}`,
      );
    } finally {
      window.removeEventListener(EXAMPLE_BLOCKED_EVENT, blocked);
      print.mockRestore();
    }
  });
});
