import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { CPD_APPLICATIONS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { cmeModuleOrderStorageKey } from "@/lib/cme/module-order-keys";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeCategory, CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

function entry(id: string, hours: number, category: CmeCategory, transcribed = false): CmeEntry {
  return {
    id,
    date: "2026-06-01",
    title: "Activity",
    allocations: [{ category, hours }],
    reflection: "Reflected",
    costCents: null,
    transcribed,
    routineId: null,
    documentId: null,
    buckets: [],
  };
}

/** Listed small gap first, so only a ranked list puts the big gap on top. */
const SET: CmeRequirementSet = {
  year: 2026,
  confirmedOn: "2026-01-05",
  confirmedSource: "Test fixture",
  totalHours: 50,
  requirements: [
    {
      id: "small",
      label: "Small gap requirement",
      source: "national",
      spec: { shape: "hours-in-category", category: "educational", minimumHours: 10 },
      completedOn: null,
    },
    {
      id: "plan",
      label: "Professional development plan",
      source: "national",
      spec: { shape: "task" },
      completedOn: null,
    },
    {
      id: "big",
      label: "Big gap requirement",
      source: "national",
      spec: { shape: "hours-in-category", category: "reviewing", minimumHours: 20 },
      completedOn: null,
    },
    {
      id: "measuring",
      label: "Measuring requirement",
      source: "national",
      spec: { shape: "hours-in-category", category: "measuring", minimumHours: 1 },
      completedOn: null,
    },
  ],
};

// 11 h: educational 9 (1 h short), measuring 2 (met), reviewing 0 (20 h short). Two not copied.
const ENTRIES = [entry("a", 9, "educational"), entry("b", 2, "measuring", true), entry("c", 0, "educational")];
const NOW = new Date("2026-09-19T02:00:00Z");
const ROUTINE: CmeRoutine = {
  id: "journal",
  title: "Journal club",
  cadence: "monthly",
  usualHours: 2,
  usualAllocations: [],
  nextDue: "2026-10-01",
  archivedAt: null,
};

beforeEach(() => window.localStorage.removeItem(cmeModuleOrderStorageKey));

describe("Today", () => {
  it("shows the Job applications Today card when a season date is coming, linking to the page", () => {
    localStorage.setItem(
      CPD_APPLICATIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        dates: [{ stage: "close", on: "2099-10-09", time: "", source: "", remind: true, addedOn: "2026-10-01" }],
        referees: [],
        statement: "",
        hiddenCvLines: [],
      }),
    );
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    expect(screen.getByTestId("applications-today-card").getAttribute("href")).toBe("/cme/applications");
    localStorage.removeItem(CPD_APPLICATIONS_STORAGE_KEY);
  });

  it("is headed Year, matching its tab", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Year" })).toBeInTheDocument();
  });

  it("lists the year check's open items one per row, biggest gap first, with done ones folded", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    expect(screen.queryByTestId("cme-fact-tiles")).toBeNull();
    expect(screen.queryByText("Next to log")).toBeNull();
    const list = screen.getByTestId("cme-requirements");
    // The count is the year check's own open rows.
    expect(within(list).getByRole("heading", { name: "What's left · 6" })).toBeInTheDocument();
    expect(within(list).getByTestId("cme-year-check-link")).toHaveAttribute("href", "/cme/check?year=2026");
    const rows = within(list)
      .getAllByRole("listitem")
      .filter((row) => row.getAttribute("data-met") === "false");
    expect(rows.map((row) => row.textContent?.replace(/\u00a0/g, " "))).toEqual([
      "Hours in total39 h to go",
      "Big gap requirement0 of 20 h",
      "Small gap requirement9 of 10 h",
      "Professional development planNot started",
      // No evidence counts were loaded, so the check says so rather than guessing.
      "Evidence kept for each activityNot checked",
      "Copied to your CPD home2 activities not marked copied",
    ]);
    const done = screen.getByTestId("cme-requirements-done");
    expect(done.tagName).toBe("DETAILS");
    expect(done).not.toHaveAttribute("open");
    expect(done).toHaveTextContent("2 done · Measuring requirement, a reflection on each activity");
    const doneRows = within(done).getAllByRole("listitem");
    expect(doneRows).toHaveLength(2);
    for (const row of doneRows) expect(row).toHaveAttribute("data-met", "true");
    // Each requirement row appears exactly once on the page.
    for (const requirement of SET.requirements) {
      expect(
        screen.getAllByRole("listitem").filter((row) => row.textContent?.startsWith(requirement.label)),
      ).toHaveLength(1);
    }
  });

  it("makes the biggest gap row the one next step, without repeating it in a separate row", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    const next = screen.getAllByTestId("cme-next-action");
    expect(next).toHaveLength(1);
    expect(next[0]).toHaveTextContent(/^Big gap requirement/);
    expect(next[0]).toHaveAttribute("data-met", "false");
  });

  it("keeps the next step as its own row when What's left is hidden in Customise", () => {
    window.localStorage.setItem(cmeModuleOrderStorageKey, JSON.stringify(["routines-due"]));
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    expect(screen.queryByTestId("cme-requirements")).toBeNull();
    const next = screen.getAllByTestId("cme-next-action");
    expect(next).toHaveLength(1);
    expect(next[0]).toHaveTextContent(/Big gap requirement/);
  });

  it("opens a task row on the setup screen", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    expect(screen.getByRole("link", { name: /Professional development plan/ })).toHaveAttribute(
      "href",
      "/cme/setup?year=2026#cme-requirement-plan",
    );
  });

  it("shows things to finish as chips, counted by the year check: not marked copied, no reflection, drafts", () => {
    const noReflection = { ...ENTRIES[0]!, id: "d", reflection: " " };
    render(<CmeDashboard set={SET} entries={[...ENTRIES, noReflection]} now={NOW} draftsToFinish={1} />);
    const chips = screen.getByTestId("cme-today-shortcuts");
    expect(
      within(chips)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Not marked copied3", "No reflection1", "Draft to finish1"]);
    expect(within(chips).getByRole("link", { name: /^Not marked copied\s*3/ })).toHaveAttribute(
      "href",
      "/cme/log?year=2026&copy=todo",
    );
    expect(within(chips).getByRole("link", { name: /^No reflection\s*1/ })).toHaveAttribute(
      "href",
      "/cme/log?year=2026&fix=reflection",
    );
    // The 32 px chip face carries a 48 px tap area.
    for (const link of within(chips).getAllByRole("link")) expect(link.className).toContain("min-h-12");
  });

  it("still shows drafts to finish before anything is logged, and no other chip", () => {
    render(<CmeDashboard set={SET} entries={[]} now={NOW} draftsToFinish={2} />);
    const chips = screen.getByTestId("cme-today-shortcuts");
    expect(
      within(chips)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Drafts to finish2"]);
  });

  it("leaves out a chip with nothing in it, and the drafts chip when drafts did not load", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} draftsToFinish={null as unknown as number} />);
    const chips = screen.getByTestId("cme-today-shortcuts");
    expect(
      within(chips)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Not marked copied2"]);
  });
});

describe("the summary's catch-up line", () => {
  it("adds what routines will likely add to the legend and the bar, and says what is still to find", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} routines={[ROUTINE]} />);
    const summary = screen.getByTestId("cme-year-summary");
    // 1 Oct, 1 Nov, 1 Dec × 2 h.
    expect(within(summary).getByTestId("cme-catch-up-routine-hours")).toHaveTextContent("6 h");
    expect(within(summary).getByTestId("cme-close-gap")).toHaveAccessibleName(
      "Your routines will likely add 6 h. See how they would close the gap",
    );
    // 39 h over 103 days (14.7 weeks).
    expect(within(summary).getByTestId("cme-pace-sentence")).toHaveTextContent(
      "39 h to go, about 2.7 h a week. After routines, 33 h is still to find.",
    );
    expect(summary).not.toHaveTextContent(/ahead|behind/i);
    const bar = within(summary).getByTestId("cme-summary-bar");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar.querySelector('[data-category="routines"]')).not.toBeNull();
  });

  it("sits in one card before the one filled button", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    const summary = screen.getByTestId("cme-year-summary");
    expect(summary.nextElementSibling).toBe(screen.getByTestId("cme-log-activity"));
  });

  it("gives no weekly figure in the first four weeks", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={new Date("2026-01-06T02:00:00Z")} />);
    expect(screen.getByTestId("cme-pace-sentence")).toHaveTextContent(/^39 h to go\.$/);
  });

  it("says when the total was reached, and says nothing once the year has ended", () => {
    const view = render(
      <CmeDashboard set={{ ...SET, totalHours: 10 }} entries={ENTRIES} now={NOW} routines={[ROUTINE]} />,
    );
    expect(screen.getByTestId("cme-pace-sentence")).toHaveTextContent("10 h reached on 1 Jun.");
    expect(screen.queryByTestId("cme-close-gap")).toBeNull();
    view.rerender(<CmeDashboard set={SET} entries={ENTRIES} now={new Date("2027-01-10T02:00:00Z")} />);
    expect(screen.queryByTestId("cme-pace-sentence")).toBeNull();
    expect(screen.getByTestId("cme-year-label")).toHaveTextContent("2026 · year ended");
  });
});
