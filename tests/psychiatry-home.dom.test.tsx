/** @vitest-environment jsdom */

// The Psychiatry hub is a front door to the sections it gathers. Every section
// keeps its own address, so each section tile must point at that section's
// existing home, and the hub must list exactly the sections the menu's
// Psychiatry group lists. The Ask page's question box runs the cited answer
// search, and the on-device history only shows what this device recorded.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/psychiatry" }));

import { PsychiatryHome, type PsychiatrySectionCounts } from "@/components/psychiatry/psychiatry-home";
import { appModeDefinition, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { clearPsychiatryVisits, recordPsychiatryVisit } from "@/lib/psychiatry-hub/visits";

const counts: PsychiatrySectionCounts = {
  dsm: 146,
  differentials: 201,
  presentations: 31,
  specifiers: 12,
  formulation: 12,
  therapy: 205,
  forms: 54,
};
const now = new Date("2026-10-03T04:00:00Z");

beforeEach(() => {
  window.localStorage.clear();
  clearPsychiatryVisits();
  push.mockReset();
});
afterEach(cleanup);

describe("PsychiatryHome", () => {
  it("links every section in the menu's Psychiatry group to its existing home, with its count", () => {
    render(<PsychiatryHome counts={counts} now={now} initialPage="tools" />);

    expect(screen.getByRole("heading", { level: 1, name: "Psychiatry" })).toBeTruthy();

    const group = phoneModeGroups.find((candidate) => candidate.id === "psychiatry");
    const sections = (group?.modeIds ?? []).filter((modeId: AppModeId) => modeId !== "psychiatry");
    expect(sections).toEqual(["dsm", "differentials", "specifiers", "formulation", "therapy-compass", "forms"]);

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

  it("sends a question to the cited answer search", () => {
    render(<PsychiatryHome counts={counts} now={now} />);
    fireEvent.change(screen.getByTestId("psychiatry-ask-input"), { target: { value: "  lithium monitoring  " } });
    fireEvent.click(screen.getByTestId("psychiatry-ask-submit"));
    expect(push).toHaveBeenCalledWith(appModeHomeHref("answer", { query: "lithium monitoring", run: true }));
  });

  it("shows no history figures until this device has recorded something", () => {
    render(<PsychiatryHome counts={counts} now={now} />);
    expect(screen.queryByTestId("psychiatry-month")).toBeNull();
    expect(screen.queryByTestId("psychiatry-resume")).toBeNull();
    expect(screen.getByTestId("psychiatry-continue-empty")).toBeTruthy();
    expect(screen.getByTestId("psychiatry-mha-search")).toHaveAttribute("href", "/forms/search");
  });

  it("offers the last record, the month's count and the most-opened forms from this device", () => {
    const at = now.getTime() - 60 * 60 * 1000;
    recordPsychiatryVisit({ href: "/forms/form-1a", title: "Form 1A", kind: "forms", at: at - 60_000 });
    recordPsychiatryVisit({ href: "/dsm/diagnoses/mdd", title: "Major depressive disorder", kind: "dsm", at });
    render(<PsychiatryHome counts={counts} now={now} />);

    expect(screen.getByTestId("psychiatry-resume-open")).toHaveAttribute("href", "/dsm/diagnoses/mdd");
    expect(screen.getByTestId("psychiatry-month")).toHaveTextContent("2 records opened");
    const recent = screen.getByRole("list", { name: "Recently opened" });
    expect(
      within(recent)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/dsm/diagnoses/mdd", "/forms/form-1a"]);
    expect(within(screen.getByTestId("psychiatry-mha-links")).getByText("Form 1A")).toBeTruthy();

    fireEvent.click(screen.getByTestId("psychiatry-continue-clear"));
    expect(screen.queryByTestId("psychiatry-resume")).toBeNull();
  });
});
