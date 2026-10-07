/** @vitest-environment jsdom */

// The Medicines & tools hub is Psychiatry's twin: a front door to the sections
// it gathers. Each section tile must point at that section's existing home,
// the hub must list exactly the sections the menu's Medicines & tools group
// lists, and the find box runs the medication search.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/medicines" }));

import { MedicinesHome, type MedicinesSectionCounts } from "@/components/medicines/medicines-home";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { clearMedicineVisits, recordMedicineVisit } from "@/lib/medicines-recent";
import { phoneModeGroups } from "@/lib/phone-mode-groups";

const counts: MedicinesSectionCounts = { medications: 120, calculators: 14, tools: 19, factsheets: 1, dictionary: 300 };
const now = new Date("2026-10-03T04:00:00Z");

beforeEach(() => push.mockReset());
afterEach(cleanup);

describe("MedicinesHome", () => {
  it("links every section in the menu's Medicines & tools group to its existing home, with its count", () => {
    render(<MedicinesHome counts={counts} now={now} />);

    expect(screen.getByRole("heading", { level: 1, name: "Medicines & tools" })).toBeTruthy();

    const group = phoneModeGroups.find((candidate) => candidate.id === "care");
    expect(group?.modeIds[0]).toBe("medicines");
    const sections = (group?.modeIds ?? []).filter((modeId: AppModeId) => modeId !== "medicines");
    expect(sections).toEqual(["prescribing", "tools", "calculators", "factsheets", "dictionary"]);

    const list = screen.getByRole("list", { name: "Medicines and tools sections" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(sections.length);
    sections.forEach((modeId, index) => {
      expect(links[index]).toHaveTextContent(appModeDefinition(modeId).label);
      expect(links[index]?.getAttribute("href")).toBe(appModeHomeHref(modeId));
    });
    expect(links[0]).toHaveTextContent("120 medicines");
    expect(links[3]).toHaveTextContent("1 factsheet");
  });

  it("sends a typed medicine to the medication search, and ignores an empty box", () => {
    render(<MedicinesHome counts={counts} now={now} />);
    const input = screen.getByTestId("medicines-find-input");
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  lithium  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(push).toHaveBeenCalledWith(appModeHomeHref("prescribing", { query: "lithium", run: true }));
  });

  it("opens every outside reference and chart in a new tab, and never copies their content", () => {
    render(<MedicinesHome counts={counts} now={now} />);
    const references = within(screen.getByRole("list", { name: "Outside medicine references" })).getAllByRole("link");
    expect(references.map((link) => link.textContent)).toEqual([
      "F1Formulary One(opens in a new tab)",
      "AMHMedicines Handbook(opens in a new tab)",
      "TGTherapeutic Guidelines(opens in a new tab)",
      "HPHealth\u00adPathways WA(opens in a new tab)",
    ]);
    const charts = within(
      screen.getByRole("list", { name: "WA statewide mental health medication charts" }),
    ).getAllByRole("link");
    expect(charts).toHaveLength(3);
    for (const link of [...references, ...charts, screen.getByTestId("medicines-card-pbs").querySelector("a")!]) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("names this month's PBS update by the Perth calendar", () => {
    render(<MedicinesHome counts={counts} now={new Date("2026-10-31T17:00:00Z")} />);
    expect(screen.getByTestId("medicines-card-pbs")).toHaveTextContent("PBS updated 1 November");
  });

  it("shows the Perth date in the header", () => {
    render(<MedicinesHome counts={counts} now={now} />);
    expect(screen.getByTestId("medicines-header")).toHaveTextContent("Saturday 3 October");
  });
});

describe("MedicinesHome mock-up v6", () => {
  afterEach(() => {
    clearMedicineVisits();
    vi.restoreAllMocks();
  });

  it("titles the groups as the mock-up does, with the real chart count", () => {
    render(<MedicinesHome counts={counts} now={now} />);
    expect(screen.getByRole("heading", { level: 2, name: "Which medicine are you checking?" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "This month" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Outside references" })).toBeTruthy();
    const charts = screen.getByTestId("medicines-card-charts");
    expect(within(charts).getByRole("heading", { name: "WA statewide charts" })).toBeTruthy();
    expect(charts).toHaveTextContent(/WA statewide charts3/);
  });

  it("hides Recent until a medicine page has been opened, then lists the last three by name with Clear", () => {
    render(<MedicinesHome counts={counts} now={now} />);
    expect(screen.queryByTestId("medicines-recent")).toBeNull();

    const at = Date.now();
    act(() => {
      ["Lithium", "Clozapine", "Valproate", "Sertraline"].forEach((name, index) =>
        recordMedicineVisit({ slug: name.toLowerCase(), name, at: at + index }),
      );
    });
    const recent = screen.getByRole("list", { name: "Recently opened medicines" });
    const links = within(recent).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "SertralineMedication",
      "ValproateMedication",
      "ClozapineMedication",
    ]);
    expect(links[0]?.getAttribute("href")).toBe("/medications/sertraline");

    fireEvent.click(screen.getByRole("button", { name: "Clear recent medicines" }));
    expect(screen.queryByTestId("medicines-recent")).toBeNull();
  });

  it("says so when offline, and outside links say they need a connection", () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<MedicinesHome counts={counts} now={now} />);
    expect(screen.getByTestId("medicines-offline")).toHaveTextContent(
      "No connectionSearch, sections and outside links need a connection. They open again when you reconnect.",
    );
    expect(within(screen.getByTestId("medicines-card-charts")).getAllByText("Needs a connection")).toHaveLength(3);
    expect(screen.getByTestId("medicines-card-pbs")).toHaveTextContent("Needs a connection");
    // Still links: the browser's signal is only a hint, so nothing is blocked.
    for (const link of within(screen.getByTestId("medicines-card-charts")).getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
    }
  });

  it("shows no offline note while connected", () => {
    render(<MedicinesHome counts={counts} now={now} />);
    expect(screen.queryByTestId("medicines-offline")).toBeNull();
  });
});
