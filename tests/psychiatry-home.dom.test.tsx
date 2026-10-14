/** @vitest-environment jsdom */

// The Psychiatry hub is a front door to the sections it gathers. Every section
// keeps its own address, so each section tile must point at that section's
// existing home, and the hub must list exactly the sections the menu's
// Psychiatry group lists. Home's question box runs the cited answer search,
// Home reaches every builder and comparison the retired Tools page listed, and
// the on-device history only shows what this device recorded.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let pageParam = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/psychiatry",
  useSearchParams: () => new URLSearchParams(pageParam ? { page: pageParam } : {}),
}));

import {
  parsePsychiatryPage,
  PsychiatryHome,
  type PsychiatrySectionCounts,
} from "@/components/psychiatry/psychiatry-home";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { clearPsychiatryVisits, recordPsychiatryVisit } from "@/lib/psychiatry-hub/visits";
import { desktopPageComposerSlotId } from "@/lib/mode-home-composer";

const counts: PsychiatrySectionCounts = {
  dsm: 146,
  differentials: 201,
  presentations: 31,
  specifiers: 12,
  formulation: 12,
  therapy: 205,
  forms: 54,
  calculators: 14,
  dictionary: 300,
};
const now = new Date("2026-10-03T04:00:00Z");

beforeEach(() => {
  window.localStorage.clear();
  clearPsychiatryVisits();
  push.mockReset();
  pageParam = "";
});
afterEach(cleanup);

describe("PsychiatryHome", () => {
  it("links every section in the menu's Psychiatry group to its existing home, with its count", () => {
    render(<PsychiatryHome counts={counts} now={now} />);

    expect(screen.getByRole("heading", { level: 1, name: "Psychiatry" })).toBeTruthy();

    const group = phoneModeGroups.find((candidate) => candidate.id === "psychiatry");
    const sections = (group?.modeIds ?? []).filter((modeId: AppModeId) => modeId !== "psychiatry");
    expect(sections).toEqual([
      "dsm",
      "differentials",
      "specifiers",
      "formulation",
      "therapy-compass",
      "forms",
      "calculators",
      "dictionary",
      "first-nations",
    ]);

    const list = screen.getByRole("list", { name: "Psychiatry sections" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(sections.length);
    sections.forEach((modeId, index) => {
      expect(links[index]).toHaveTextContent(appModeDefinition(modeId).label);
      expect(links[index]).toHaveAttribute("href", appModeHomeHref(modeId));
    });
    expect(links[0]).toHaveTextContent("146 diagnoses");
    expect(links[1]).toHaveTextContent("201 diagnoses · 31 presentations");
  });

  it("draws no search box of its own: the shared Clinical box asks the question", () => {
    // Owner request, 13 Oct 2026: the bottom box on phones, under the band from
    // tablet up, and no second box at the top of the page.
    render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.getByTestId("psychiatry-composer")).toHaveAttribute("id", desktopPageComposerSlotId);
  });

  it("shows no history figures until this device has recorded something", () => {
    render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.queryByTestId("psychiatry-month")).toBeNull();
    expect(screen.queryByTestId("psychiatry-resume")).toBeNull();
    expect(screen.getByTestId("psychiatry-continue-empty")).toBeTruthy();
    expect(screen.getByTestId("psychiatry-mha-search")).toHaveAttribute("href", "/forms/search");
  });

  it("updates the empty Continue line as soon as Save recent searches is switched off", () => {
    render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.getByTestId("psychiatry-continue-empty")).toHaveTextContent(/will appear here/);
    act(() => {
      window.localStorage.setItem("clinical-kb-preferences", JSON.stringify({ saveRecentSearches: false }));
      window.dispatchEvent(new Event("clinical-kb-preferences-change"));
    });
    expect(screen.getByTestId("psychiatry-continue-empty")).toHaveTextContent(/Turn on Save recent searches/);
  });

  it("offers the last record, the month's count and the most-opened forms from this device", () => {
    const at = now.getTime() - 60 * 60 * 1000;
    recordPsychiatryVisit({ href: "/forms/form-1a", title: "Form 1A", kind: "forms", at: at - 60_000 });
    recordPsychiatryVisit({ href: "/dsm/diagnoses/mdd", title: "Major depressive disorder", kind: "dsm", at });
    render(<PsychiatryHome counts={counts} now={now} />);

    expect(screen.getByTestId("psychiatry-resume-open")).toHaveAttribute("href", "/dsm/diagnoses/mdd");
    expect(screen.getByTestId("psychiatry-resume-open")).toHaveTextContent("Pick up where you left off");
    const recent = screen.getByRole("list", { name: "Recently opened" });
    expect(
      within(recent)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/forms/form-1a"]); // the newest is the resume row above, not repeated
    expect(within(screen.getByTestId("psychiatry-mha-links")).getByText("Form 1A")).toBeTruthy();
    expect(within(screen.getByTestId("psychiatry-mha-links")).getByText("Opened once on this phone")).toBeTruthy();

    // With something in it, Continue sits at the top of the content, before "For a shift".
    const continueCard = screen.getByTestId("psychiatry-card-continue");
    const shiftCard = screen.getByTestId("psychiatry-card-shift");
    expect(continueCard.compareDocumentPosition(shiftCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByTestId("psychiatry-continue-clear"));
    expect(screen.queryByTestId("psychiatry-resume")).toBeNull();
  });

  it("reaches every builder and comparison the retired Tools page listed, from Home", () => {
    render(<PsychiatryHome counts={counts} now={now} />);
    const builders = within(screen.getByRole("list", { name: "Builders" }));
    const hrefs = builders.getAllByRole("link").map((link) => link.getAttribute("href"));
    for (const href of [
      "/specifiers/builder",
      "/specifiers/compare",
      "/formulation/builder",
      "/formulation/map",
      "/therapy-compass/pathways",
      "/therapy-compass/compare",
      "/therapy-compass/recommend",
      "/differentials/presentations",
      "/dsm/compare",
    ]) {
      expect(hrefs).toContain(href);
    }
    // First Nations is listed once, in Sections, not again in Builders.
    expect(hrefs).not.toContain(appModeHomeHref("first-nations"));
    expect(
      within(screen.getByRole("list", { name: "Psychiatry sections" }))
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href") === appModeHomeHref("first-nations")),
    ).toHaveLength(1);
    // One link to the plain list of every tool.
    expect(screen.getAllByRole("link", { name: "All tools" })).toHaveLength(1);
    expect(screen.getByTestId("psychiatry-all-tools")).toHaveAttribute("href", "/tools");
    // The Act, the MHA clock and Safety plan each sit once, in their own sections.
    expect(screen.getByTestId("psychiatry-mha-act")).toHaveAttribute("href", "/forms/act");
    expect(screen.getByTestId("psychiatry-shift-mha-clock")).toHaveAttribute("href", "/psychiatry/mha-clock");
    expect(screen.getByTestId("psychiatry-shift-safety-plan")).toHaveAttribute("href", "/safety-plan");
    // The weekly chart and the Medicines signpost went with the Tools page.
    expect(screen.queryByTestId("psychiatry-card-week")).toBeNull();
    expect(screen.queryByTestId("psychiatry-medicines-signpost")).toBeNull();
  });

  it("switches search off and says so when the browser is offline", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      render(<PsychiatryHome counts={counts} now={now} />);
      expect(screen.getByTestId("psychiatry-offline")).toHaveTextContent("Search needs a connection.");
      cleanup();
      render(<PsychiatryHome counts={counts} now={now} initialPage="saved" />);
      expect(screen.getByTestId("psychiatry-offline")).toHaveTextContent("Search needs a connection.");
    } finally {
      onLine.mockRestore();
    }
  });

  it("draws no tab row of its own: the band's Home and Saved tabs switch the page by ?page=", () => {
    render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("list", { name: "Psychiatry sections" })).toBeTruthy();
  });

  it("opens the page named by ?page=, and falls back to Home for anything else", () => {
    pageParam = "saved";
    const { unmount } = render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.queryByRole("list", { name: "Psychiatry sections" })).toBeNull();
    unmount();
    pageParam = "nonsense";
    render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.getByRole("list", { name: "Psychiatry sections" })).toBeTruthy();
  });

  it("lands an old ?page=tools link on Home, with the tools it used to hold", () => {
    expect(parsePsychiatryPage("tools", "saved")).toBe("ask");
    pageParam = "tools";
    render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.getByRole("list", { name: "Psychiatry sections" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Builders" })).toBeTruthy();
  });
});
