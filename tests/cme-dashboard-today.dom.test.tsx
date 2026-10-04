import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { CmeDashboard } from "@/components/cme/cme-dashboard";
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
  it("is headed Year, matching its tab", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Year" })).toBeInTheDocument();
  });

  it("lists every requirement once, biggest gap first, with met ones folded under N done", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    expect(screen.queryByTestId("cme-fact-tiles")).toBeNull();
    expect(screen.queryByText("Next to log")).toBeNull();
    const list = screen.getByTestId("cme-requirements");
    expect(within(list).getByRole("heading", { name: "What's left" })).toBeInTheDocument();
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Big gap requirement20 h to go"),
      expect.stringContaining("Small gap requirement1 h to go"),
      expect.stringContaining("Professional development planNot started"),
      expect.stringContaining("Measuring requirementReached"),
    ]);
    const done = screen.getByTestId("cme-requirements-done");
    expect(done.tagName).toBe("DETAILS");
    expect(done).not.toHaveAttribute("open");
    expect(within(done).getByText("1 done")).toBeInTheDocument();
    expect(within(done).getByRole("listitem")).toHaveAttribute("data-met", "true");
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

  it("shows things to finish as chips: not copied, the year check, drafts", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} draftsToFinish={1} />);
    const chips = screen.getByTestId("cme-today-shortcuts");
    expect(within(chips).getByRole("link", { name: /^Not copied\s*2/ })).toHaveAttribute(
      "href",
      "/cme/log?year=2026&copy=todo",
    );
    const check = within(chips).getByTestId("cme-year-check-link");
    expect(check).toHaveAttribute("href", "/cme/check?year=2026");
    expect(check).toHaveTextContent(/^Year check\d+ of \d+$/);
    expect(within(chips).getByRole("link", { name: /^Drafts to finish\s*1/ })).toBeInTheDocument();
    for (const link of within(chips).getAllByRole("link")) expect(link.className).toMatch(/min-h-tap/);
  });
});

describe("the catch-up planner card", () => {
  it("splits what is left into logged, routines likely and still to find, and says it is an estimate", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} routines={[ROUTINE]} />);
    const card = screen.getByTestId("cme-catch-up");
    expect(within(card).getByRole("heading", { name: "To reach 50 h by 31 Dec" })).toBeInTheDocument();
    expect(within(card).getByTestId("cme-catch-up-logged-hours")).toHaveTextContent("11 h");
    // 1 Oct, 1 Nov, 1 Dec × 2 h.
    expect(within(card).getByTestId("cme-catch-up-routine-hours")).toHaveTextContent("≈ 6 h");
    // 33 h over 103 days (14.7 weeks).
    expect(within(card).getByTestId("cme-catch-up-remaining-hours")).toHaveTextContent("33 h · 2.2 h a week");
    expect(within(card).getByTestId("cme-catch-up-gap")).toHaveTextContent(
      /^Biggest gap: Big gap requirement \(20\sh to go\)$/,
    );
    expect(card).toHaveTextContent("Estimate from your routines");
    expect(card).not.toHaveTextContent(/ahead|behind/i);
    expect(within(card).getByTestId("cme-catch-up-bar").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("sits right after the hero", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={NOW} />);
    expect(screen.getByTestId("cme-hero-summary").nextElementSibling).toBe(screen.getByTestId("cme-catch-up"));
    expect(screen.getByTestId("cme-hero-summary").parentElement?.className).toMatch(/md:grid-cols-2/);
  });

  it("gives no weekly figure in the first four weeks, as the hero does not", () => {
    render(<CmeDashboard set={SET} entries={[]} now={new Date("2026-01-06T02:00:00Z")} />);
    expect(screen.getByTestId("cme-catch-up-remaining-hours")).toHaveTextContent(/^50 h$/);
  });

  it("is hidden once the total is reached, and once the year has ended", () => {
    const view = render(
      <CmeDashboard set={{ ...SET, totalHours: 10 }} entries={ENTRIES} now={NOW} routines={[ROUTINE]} />,
    );
    expect(screen.queryByTestId("cme-catch-up")).toBeNull();
    // With no second card the hero spans the row instead of leaving a blank column.
    expect(screen.getByTestId("cme-hero-summary").parentElement?.className).not.toMatch(/md:grid-cols-2/);
    view.rerender(<CmeDashboard set={SET} entries={ENTRIES} now={new Date("2027-01-10T02:00:00Z")} />);
    expect(screen.queryByTestId("cme-catch-up")).toBeNull();
    expect(screen.getByTestId("cme-hero-summary").parentElement?.className).not.toMatch(/md:grid-cols-2/);
  });
});
