/** @vitest-environment jsdom */

// "Recent pages" in the phone menu's Work and Clinical tabs (and the two-pane
// menu kept for when it returns): the last five pages, hidden when empty, the
// page on screen left out.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClinicalMenuRecentPages, ClinicalMenuWorkAreas } from "@/components/clinical-dashboard/clinical-menu-drawer";
import { clearRecentPages, recordRecentPage, RECENT_PAGES_SHOWN } from "@/lib/recent-pages";

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  clearRecentPages();
  window.localStorage.clear();
});

describe("Recent pages in the phone menu", () => {
  it("is hidden when nothing has been opened", () => {
    render(<ClinicalMenuRecentPages variant="clinical" onNavigate={vi.fn()} />);
    expect(screen.queryByText("Recent pages")).toBeNull();
  });

  it("lists the newest pages across Work and Clinical, without the page on screen", () => {
    const now = Date.now();
    recordRecentPage("/roster", "Roster", now - 10);
    for (let index = 0; index < 7; index += 1) {
      recordRecentPage(`/medications/med-${index}`, `Med ${index}`, now - 9 + index);
    }
    recordRecentPage("/on-call", "On Call", now);

    const onNavigate = vi.fn();
    render(<ClinicalMenuRecentPages variant="clinical" onNavigate={onNavigate} />);
    const group = screen.getByTestId("clinical-menu-recent-pages-clinical");
    const links = within(group).getAllByRole("link");
    expect(links).toHaveLength(RECENT_PAGES_SHOWN);
    expect(links[0]?.getAttribute("href")).toBe("/on-call");
    expect(links.some((link) => link.getAttribute("href") === "/roster")).toBe(false);
    expect(within(group).getAllByText("Medication").length).toBeGreaterThan(0);
    links[0]?.click();
    expect(onNavigate).toHaveBeenCalled();
  });

  it("sits under the work areas on the Work tab", () => {
    recordRecentPage("/medications/lithium", "Lithium");
    render(<ClinicalMenuWorkAreas counts={null} currentArea={null} onNavigate={vi.fn()} />);
    expect(screen.getByTestId("clinical-menu-work")).toBeTruthy();
    const group = screen.getByTestId("clinical-menu-recent-pages-work");
    expect(
      within(group)
        .getByRole("link", { name: /Lithium/ })
        .getAttribute("href"),
    ).toBe("/medications/lithium");
  });
});
