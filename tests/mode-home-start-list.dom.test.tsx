/** @vitest-environment jsdom */

// Clinical mode homes' start list (site recommendations 12 Oct 2026, item 3):
// Continue, this mode's Favourites and a Browse link under the unchanged
// composer, each group hidden when empty. Answer and the other modes keep
// their home exactly as it was.

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedHomeEmptyState } from "@/components/clinical-dashboard/answer-status";
import { ModeHomeStartList, modeHomeStartListConfig } from "@/components/mode-home-start-list";
import { clearRecentPages } from "@/lib/recent-pages";
import { recordRecentPage } from "@/lib/recent-pages-record";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  clearRecentPages();
  window.localStorage.clear();
});

describe("mode home start list", () => {
  it("is offered on the Clinical mode homes, and not on Answer, Psychiatry or On Call", () => {
    for (const modeId of [
      "dsm",
      "prescribing",
      "therapy-compass",
      "documents",
      "differentials",
      "formulation",
      "specifiers",
      "forms",
      "factsheets",
      "dictionary",
      "services",
    ] as const) {
      expect(modeHomeStartListConfig(modeId), modeId).not.toBeNull();
    }
    for (const modeId of ["answer", "psychiatry", "on-call", "calculators", "sources"] as const) {
      expect(modeHomeStartListConfig(modeId), modeId).toBeNull();
    }
  });

  it("shows an empty home two Browse links to the mode's existing pages", () => {
    render(<ModeHomeStartList modeId="dsm" />);
    expect(screen.queryByTestId("mode-home-continue")).toBeNull();
    const browse = screen.getByTestId("mode-home-browse-list");
    expect(
      within(browse)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Browse all diagnoses", "/dsm/search"],
      ["Compare diagnoses", "/dsm/compare"],
    ]);
    cleanup();

    // Medication has no medicine catalogue page: its links go to the Medicines pages around it.
    render(<ModeHomeStartList modeId="prescribing" />);
    expect(
      within(screen.getByTestId("mode-home-browse-list"))
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/factsheets/search", "/medicines"]);
    cleanup();

    for (const modeId of ["therapy-compass", "differentials", "formulation", "specifiers", "forms"] as const) {
      render(<ModeHomeStartList modeId={modeId} />);
      const count = within(screen.getByTestId("mode-home-browse-list")).getAllByRole("link").length;
      expect(count, modeId).toBe(2);
      cleanup();
    }
  });

  it("keeps only the first Browse link once Continue has something", () => {
    recordRecentPage("/dsm/diagnoses/a", "Disorder A");
    render(<ModeHomeStartList modeId="dsm" />);
    expect(screen.getByTestId("mode-home-continue")).toBeTruthy();
    expect(screen.queryByTestId("mode-home-browse-list")).toBeNull();
    expect(screen.getByTestId("mode-home-browse").getAttribute("href")).toBe("/dsm/search");
  });

  it("continues with the last three records of this mode, newest first", () => {
    const now = Date.now();
    recordRecentPage("/dsm/diagnoses/a", "Disorder A", now - 5);
    recordRecentPage("/medications/lithium", "Lithium", now - 4);
    recordRecentPage("/dsm/diagnoses/b", "Disorder B", now - 3);
    recordRecentPage("/dsm/diagnoses/c", "Disorder C", now - 2);
    recordRecentPage("/dsm/diagnoses/d", "Disorder D", now - 1);

    render(<ModeHomeStartList modeId="dsm" />);
    const group = screen.getByTestId("mode-home-continue");
    const links = within(group).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Disorder D", "Disorder C", "Disorder B"]);
    expect(links[0]?.getAttribute("href")).toBe("/dsm/diagnoses/d");
  });

  it("updates when a page is opened in another part of the app", () => {
    render(<ModeHomeStartList modeId="prescribing" />);
    expect(screen.queryByTestId("mode-home-continue")).toBeNull();
    act(() => recordRecentPage("/medications/lithium", "Lithium"));
    expect(within(screen.getByTestId("mode-home-continue")).getByRole("link", { name: "Lithium" })).toBeTruthy();
  });

  it("hangs under the shared home without joining its flow, and leaves the Answer home alone", () => {
    render(<SharedHomeEmptyState modeId="dsm" />);
    const home = screen.getByTestId("shared-home-empty-state");
    expect(home.className).toContain("relative");
    const hanging = home.querySelector(".mode-home-start");
    expect(hanging?.className).toContain("absolute");
    expect(hanging?.className).toContain("top-full");
    expect(within(home).getByTestId("mode-home-start-list")).toBeTruthy();
    cleanup();

    render(<SharedHomeEmptyState modeId="answer" />);
    expect(screen.getByTestId("shared-home-empty-state").querySelector(".mode-home-start")).toBeNull();
  });
});
