/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  act(() => setExampleDataOn(false));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CME Claim Pack button on Annual Summary surface (#GR72PF)", () => {
  it("renders Export claim pack on CmeAnnualSummary and transitions to Claim pack exported when clicked", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cme-claim-pack");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const entriesWithCost = DEMO_CME_ENTRIES.map((entry, idx) =>
      idx === 0 ? { ...entry, costCents: 25000, archivedAt: null } : entry,
    );

    render(<CmeAnnualSummary set={DEMO_CME_YEAR} entries={entriesWithCost} now={now} />);

    const button = screen.getByTestId("cme-claim-pack-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Export claim pack");

    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveTextContent("Claim pack exported");
    });
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    revokeObjectUrl.mockRestore();
  });

  it("respects guardExampleAction when example data mode is active", () => {
    const blocked = vi.fn();
    window.addEventListener(EXAMPLE_BLOCKED_EVENT, blocked);
    try {
      act(() => setExampleDataOn(true));
      render(<CmeAnnualSummary set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={now} demoMode />);
      const button = screen.getByTestId("cme-claim-pack-button");
      fireEvent.click(button);
      expect(blocked).toHaveBeenCalledTimes(1);
      expect(button).toHaveTextContent("Export claim pack");
    } finally {
      window.removeEventListener(EXAMPLE_BLOCKED_EVENT, blocked);
    }
  });
});
