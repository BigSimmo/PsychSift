import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

function renderAt(iso: string) {
  return render(<CmeDashboard set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={new Date(iso)} />);
}

/**
 * Two unmet `hours-in-category` requirements, deliberately listed with the
 * SMALLER gap first. `evaluateYear` preserves `set.requirements` order in
 * `unmet`, so a next-action picker that took `unmet[0]` — list order — would
 * point at "Small gap" here, even though "Big gap" is nineteen hours further
 * from being met. Only a picker that actually compares the two gaps gets
 * this right regardless of which requirement happens to be listed first.
 */
const FURTHEST_FROM_MET_SET: CmeRequirementSet = {
  year: 2026,
  confirmedOn: "2026-01-01",
  confirmedSource: "Test fixture",
  totalHours: 50,
  requirements: [
    {
      id: "req-small-gap",
      label: "Small gap requirement",
      source: "national",
      spec: { shape: "hours-in-category", category: "educational", minimumHours: 10 },
      completedOn: null,
    },
    {
      id: "req-big-gap",
      label: "Big gap requirement",
      source: "national",
      spec: { shape: "hours-in-category", category: "reviewing", minimumHours: 20 },
      completedOn: null,
    },
  ],
};

const FURTHEST_FROM_MET_ENTRIES: readonly CmeEntry[] = [
  {
    id: "fixture-entry-1",
    date: "2026-06-01",
    title: "Some activity",
    allocations: [{ category: "educational", hours: 9 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  },
];

describe("the dashboard", () => {
  it("offers First Nations Talking as optional learning only while nothing is logged for that domain", () => {
    const set: CmeRequirementSet = {
      year: 2026,
      confirmedOn: "2026-01-01",
      confirmedSource: "Test fixture",
      totalHours: 50,
      requirements: [
        {
          id: "practice-domains",
          label: "Practice domains",
          source: "national",
          spec: {
            shape: "activity-count",
            buckets: ["Culturally safe practice", "Professionalism"],
            minimumPerBucket: 2,
          },
          completedOn: null,
        },
      ],
    };
    const entry: CmeEntry = {
      id: "cultural-learning",
      date: "2026-06-01",
      title: "Learning activity",
      allocations: [{ category: "educational", hours: 1 }],
      reflection: "",
      costCents: null,
      transcribed: false,
      routineId: null,
      documentId: null,
      buckets: ["Culturally safe practice"],
    };
    // Something else is logged, so the page is past its "nothing logged yet" state.
    const other: CmeEntry = { ...entry, id: "other-learning", buckets: [] };
    const now = new Date("2026-09-19T02:00:00Z");
    const view = render(<CmeDashboard set={set} entries={[other]} now={now} />);
    const link = screen.getByTestId("cme-first-nations-learning-link");
    expect(link).toHaveAttribute("href", "/first-nations/talking");
    expect(link).toHaveTextContent("Optional learning");
    expect(link).toHaveTextContent("Opening it does not log CPD");

    view.rerender(<CmeDashboard set={set} entries={[other, entry]} now={now} />);
    expect(screen.queryByTestId("cme-first-nations-learning-link")).toBeNull();
    view.rerender(<CmeDashboard set={set} entries={[other, { ...entry, archivedAt: "2026-07-01" }]} now={now} />);
    expect(screen.getByTestId("cme-first-nations-learning-link")).toBeInTheDocument();
    view.rerender(<CmeDashboard set={set} entries={[other, { ...entry, date: "2025-06-01" }]} now={now} />);
    expect(screen.getByTestId("cme-first-nations-learning-link")).toBeInTheDocument();
    view.rerender(<CmeDashboard set={{ ...set, requirements: [] }} entries={[other]} now={now} />);
    expect(screen.queryByTestId("cme-first-nations-learning-link")).toBeNull();
  });

  it("shows a linked training line only for a supplied current period", () => {
    const without = renderAt("2026-09-19T02:00:00Z");
    expect(screen.queryByTestId("cme-training-position-link")).toBeNull();
    without.unmount();

    render(
      <CmeDashboard
        set={DEMO_CME_YEAR}
        entries={DEMO_CME_ENTRIES}
        now={new Date("2026-09-19T02:00:00Z")}
        currentTrainingPosition={{
          stage: { id: "stage", kind: "stage", label: "Stage 2", startsOn: "2026-01-01", endsOn: null, fte: 1 },
          rotation: { id: "rotation", kind: "rotation", label: "Acute", startsOn: "2026-07-01", endsOn: null, fte: 1 },
          rotationIndex: 3,
          rotationCount: 4,
          onBreak: false,
          breakPeriod: null,
        }}
      />,
    );
    expect(screen.getByTestId("cme-training-position-link")).toHaveTextContent("Stage 2 · rotation 3 of 4");
    expect(screen.getByTestId("cme-training-position-link")).toHaveAttribute("href", "/cme/training");
  });
  it("offers one-tap Log N h from the Routines due module", async () => {
    const user = userEvent.setup();
    const onLogRoutine = vi.fn();
    const routine: CmeRoutine = {
      id: "routine-due",
      title: "Peer review group",
      cadence: "monthly",
      usualHours: 1,
      usualAllocations: [{ category: "reviewing", hours: 1 }],
      nextDue: "2026-09-01",
      archivedAt: null,
    };
    render(
      <CmeDashboard
        set={DEMO_CME_YEAR}
        entries={DEMO_CME_ENTRIES}
        now={new Date("2026-09-19T02:00:00Z")}
        routines={[routine]}
        onLogRoutine={onLogRoutine}
      />,
    );
    // Changed 2026-09-24: a due routine no longer takes the single Next slot,
    // which hid the requirement gap and the year-end reminder. It is logged
    // from its own row in the Routines due module. The route one-tap saves.
    expect(screen.getByTestId("cme-next-action")).not.toHaveTextContent(/peer review group/i);
    const due = screen.getByTestId("cme-routines-due");
    const log = within(due).getByRole("button", { name: /log/i });
    expect(log.className).toMatch(/min-h-(?:12|tap)/);
    await user.click(log);
    expect(onLogRoutine).toHaveBeenCalledWith({
      routineId: "routine-due",
      date: "2026-09-19",
      title: "Peer review group",
      hours: 1,
      allocations: [{ category: "reviewing", hours: 1 }],
    });
  });

  it("leads with the summary card: weeks left, percent, hours, the categories in words, then the pace", () => {
    renderAt("2026-09-19T02:00:00Z");
    const summary = screen.getByTestId("cme-year-summary");
    expect(within(summary).getByTestId("cme-year-label")).toHaveTextContent("2026 · about 15 weeks left");
    expect(within(summary).getByTestId("cme-year-percent")).toHaveTextContent("65%");
    expect(within(summary).getByTestId("cme-total-hours")).toHaveTextContent("32.5of 50 h logged");
    const legend = within(summary).getByRole("list", { name: "Hours by category" });
    const rows = within(legend)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(rows.slice(0, 3)).toEqual([
      expect.stringMatching(/^Educational[\d.]+ h$/),
      expect.stringMatching(/^Reviewing performance[\d.]+ h$/),
      expect.stringMatching(/^Measuring outcomes[\d.]+ h$/),
    ]);
    expect(within(summary).getByTestId("cme-pace-sentence")).toHaveTextContent(/^17\.5 h to go, about 1\.2 h a week\./);
    expect(within(summary).getAllByTestId("cme-week-bar")).toHaveLength(53);
    expect(screen.queryByTestId("progress-mark")).toBeNull();
    expect(screen.getByTestId("cme-next-action")).toBeInTheDocument();
  });

  it("has one filled button, Log an activity, and leaves the floating + Log off this page", () => {
    const { container } = renderAt("2026-09-19T02:00:00Z");
    const log = screen.getByTestId("cme-log-activity");
    expect(log).toHaveTextContent("Log an activity");
    // Without the quick-log panel on the page, it opens the full form.
    expect(log).toHaveAttribute("href", "/cme/new?year=2026");
    expect(log).toHaveAttribute("data-cme-log-trigger");
    expect(
      container.querySelectorAll(
        'a[class*="bg-[color:var(--clinical-accent)]"], button[class*="bg-[color:var(--clinical-accent)]"], a[class*="bg-[color:var(--cme-filled)]"], button[class*="bg-[color:var(--cme-filled)]"]',
      ),
    ).toHaveLength(1);
    // No floating button to keep clear of: the page ends with ordinary room under the last block.
    expect(container.querySelector("main")?.className).toContain("pb-[calc(max(1rem,var(--safe-area-bottom))+2.5rem)]");
  });

  it("says nothing about pace in January and points at the plan instead", () => {
    const earlyYearSet: CmeRequirementSet = {
      ...DEMO_CME_YEAR,
      requirements: DEMO_CME_YEAR.requirements.map((requirement) =>
        requirement.id === "plan" ? { ...requirement, completedOn: null } : requirement,
      ),
    };
    render(<CmeDashboard set={earlyYearSet} entries={DEMO_CME_ENTRIES} now={new Date("2026-01-06T02:00:00Z")} />);
    // No weekly figure before four weeks have passed: the sentence says only what is left.
    expect(screen.queryByTestId("cme-pace-sentence")?.textContent ?? "").not.toMatch(/a week/);
    expect(screen.queryByTestId("progress-mark")).toBeNull();
    expect(screen.getByTestId("cme-next-action")).toHaveTextContent(/development plan/i);
  });

  it("turns into the year-end checklist in the last fortnight", () => {
    renderAt("2026-12-28T02:00:00Z");
    const next = screen.getByTestId("cme-next-action");
    // Today opens the year-end checklist rather than bypassing it with a summary link.
    expect(within(next).getByTestId("cme-year-end-open")).toHaveTextContent(/close the year/i);
    expect(within(next).queryByRole("link")).toBeNull();
  });

  it("points a closed year at its snapshot instead of at more logging", () => {
    render(
      <CmeDashboard
        set={{ ...DEMO_CME_YEAR, closedAt: "2026-12-20T02:00:00Z" }}
        entries={DEMO_CME_ENTRIES}
        now={new Date("2026-12-28T02:00:00Z")}
      />,
    );
    const next = screen.getByTestId("cme-next-action");
    expect(next).toHaveTextContent(/this cpd year is closed/i);
    expect(next).toHaveAttribute("href", "/cme/summary?year=2026");
  });

  it("says plainly when nothing is logged yet, with the target and a first-activity button (screen 08)", () => {
    render(<CmeDashboard set={DEMO_CME_YEAR} entries={[]} now={new Date("2026-09-19T02:00:00Z")} />);
    expect(screen.getByTestId("cme-total-hours")).toHaveTextContent("Nothing logged yet");
    expect(screen.getByTestId("cme-empty-target-line")).toHaveTextContent(
      "Your target is 50 h for 2026. Log your first activity and it will show here.",
    );
    expect(screen.getByTestId("cme-log-activity")).toHaveTextContent("Log your first activity");
    // Nothing to count yet, so no chips, no checklist and no week chart.
    expect(screen.queryByTestId("cme-today-shortcuts")).toBeNull();
    expect(screen.queryByTestId("cme-requirements")).toBeNull();
    expect(screen.queryByTestId("cme-week-bar")).toBeNull();
    expect(screen.getByTestId("cme-routines-setup")).toHaveTextContent("Set up a routine");
    expect(screen.getByTestId("cme-provenance")).toHaveTextContent("Targets");
  });

  it("shows hours without a target when none is confirmed (screen 10)", () => {
    render(
      <CmeDashboard
        set={{ ...DEMO_CME_YEAR, totalHours: 0, requirements: [] }}
        entries={DEMO_CME_ENTRIES}
        now={new Date("2026-09-19T02:00:00Z")}
      />,
    );
    const summary = screen.getByTestId("cme-year-summary");
    expect(within(summary).getByTestId("cme-total-hours")).toHaveTextContent("32.5 hlogged");
    expect(summary).toHaveTextContent("You have not confirmed a yearly target, so nothing is measured against one.");
    expect(within(summary).getByRole("link", { name: "Set up your year" })).toHaveAttribute(
      "href",
      "/cme/setup?year=2026",
    );
    expect(summary).not.toHaveTextContent(/%|of \d+ h/);
    expect(within(screen.getByTestId("cme-logged-by-category")).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByTestId("cme-requirements")).toBeNull();
    expect(screen.queryByTestId("cme-next-action")).toBeNull();
  });

  it("keeps the total-hours shortfall actionable after every named requirement is met", () => {
    const set: CmeRequirementSet = {
      year: 2026,
      confirmedOn: "2026-01-01",
      confirmedSource: "Test fixture",
      totalHours: 50,
      requirements: [
        {
          id: "education-minimum",
          label: "Educational activities",
          source: "national",
          spec: { shape: "hours-in-category", category: "educational", minimumHours: 5 },
          completedOn: null,
        },
      ],
    };
    const entries: readonly CmeEntry[] = [
      {
        id: "education-five",
        date: "2026-06-01",
        title: "Education",
        allocations: [{ category: "educational", hours: 5 }],
        reflection: "",
        costCents: null,
        transcribed: false,
        routineId: null,
        documentId: null,
        buckets: [],
      },
    ];
    render(<CmeDashboard set={set} entries={entries} now={new Date("2026-09-19T02:00:00Z")} />);
    // The step is What's left's own "Hours in total" row, not a second row saying the same thing.
    const next = screen.getAllByTestId("cme-next-action");
    expect(next).toHaveLength(1);
    expect(next[0]).toHaveTextContent(/^Hours in total45 h to go$/);
    expect(next[0]).toHaveAttribute("data-met", "false");
    expect(next[0]).not.toHaveTextContent(/every target is reached/i);
  });

  it("points the next action at whichever requirement is furthest from being met, not the first unmet in list order", () => {
    render(
      <CmeDashboard
        set={FURTHEST_FROM_MET_SET}
        entries={FURTHEST_FROM_MET_ENTRIES}
        now={new Date("2026-09-19T02:00:00Z")}
      />,
    );
    const nextAction = screen.getByTestId("cme-next-action");
    // "Big gap requirement" (19 hours further from met) must be named, not
    // "Small gap requirement" — which lists first but is nearly met.
    expect(nextAction).toHaveTextContent(/Big gap requirement/);
    expect(nextAction).toHaveTextContent(/20 h to go/);
    expect(nextAction).not.toHaveTextContent(/Small gap requirement/);
  });

  it("names Teaching's own count of sessions not yet logged, and never asks for it in the demo", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ count: 3 }), { status: 200 }));
    const view = renderAt("2026-09-19T02:00:00Z");
    const row = screen.getByTestId("cme-teaching-link");
    expect(row).toHaveTextContent("Teaching you gave");
    await within(row).findByText("3 sessions are not logged yet");
    expect(row).toHaveAttribute("href", "/teaching/review");
    view.unmount();
    fetchMock.mockClear();

    render(
      <CmeDashboard set={DEMO_CME_YEAR} entries={DEMO_CME_ENTRIES} now={new Date("2026-09-19T02:00:00Z")} demoMode />,
    );
    expect(screen.getByTestId("cme-teaching-link")).toHaveAttribute("href", "/teaching");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("lists due routines with a quiet Log link and a snooze, in the mock-up's words", () => {
    const routine: CmeRoutine = {
      id: "peer",
      title: "Peer review group",
      cadence: "monthly",
      usualHours: 1,
      usualAllocations: [{ category: "reviewing", hours: 1 }],
      nextDue: "2026-09-01",
      archivedAt: null,
    };
    render(
      <CmeDashboard
        set={DEMO_CME_YEAR}
        entries={DEMO_CME_ENTRIES}
        now={new Date("2026-09-19T02:00:00Z")}
        routines={[routine]}
        onSnoozeReminder={vi.fn()}
      />,
    );
    const due = screen.getByTestId("cme-routines-due");
    expect(within(due).getByRole("heading", { name: "Routines due · 1" })).toBeInTheDocument();
    expect(due).toHaveTextContent("Peer review groupMonthly · usually 1 h");
    expect(within(due).getByRole("button", { name: "Log 1 h" })).toBeInTheDocument();
    expect(within(due).getByRole("button", { name: "Snooze for a week: CPD routines due" })).toBeInTheDocument();
  });
});
