import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CmeNewEntryRoute } from "@/components/cme/cme-new-entry-route";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeRoutine } from "@/lib/cme/routines";

// work-mode redesign, owner request 6 Oct 2026: the form page now has its own back header, which reads the path.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cme/new",
}));

describe("Log again chips on the new-entry form", () => {
  it("offers up to five recent activities, each opening the existing repeat prefill", () => {
    render(<CmeNewEntryRoute set={DEMO_CME_YEAR} existingEntries={DEMO_CME_ENTRIES} demoMode />);
    const row = screen.getByRole("navigation", { name: "Log again" });
    const chips = within(row).getAllByRole("link");
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(5);
    for (const chip of chips) {
      expect(chip.getAttribute("href")).toMatch(/^\/cme\/new\?year=\d{4}&repeat=[^&]+$/);
      expect(chip.className).toContain("min-h-tap");
      expect(chip.textContent).toMatch(/· [\d.]+ h$/);
    }
  });

  it("stays away when the form is already filled from somewhere else, or the log is empty", () => {
    const routine = { id: "r1", title: "Journal club", usualHours: 1 } as unknown as CmeRoutine;
    const { unmount } = render(
      <CmeNewEntryRoute set={DEMO_CME_YEAR} existingEntries={DEMO_CME_ENTRIES} routine={routine} demoMode />,
    );
    expect(screen.queryByTestId("cme-log-again")).toBeNull();
    unmount();
    render(<CmeNewEntryRoute set={DEMO_CME_YEAR} existingEntries={[]} demoMode />);
    expect(screen.queryByTestId("cme-log-again")).toBeNull();
  });
});
