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
    const now = new Date("2026-09-19T02:00:00Z");
    const view = render(<CmeDashboard set={set} entries={[]} now={now} />);
    const link = screen.getByTestId("cme-first-nations-learning-link");
    expect(link).toHaveAttribute("href", "/first-nations/talking");
    expect(link).toHaveTextContent("Optional learning");
    expect(link).toHaveTextContent("Opening this resource does not log a CPD activity.");

    view.rerender(<CmeDashboard set={set} entries={[entry]} now={now} />);
    expect(screen.queryByTestId("cme-first-nations-learning-link")).toBeNull();
    view.rerender(<CmeDashboard set={set} entries={[{ ...entry, archivedAt: "2026-07-01" }]} now={now} />);
    expect(screen.getByTestId("cme-first-nations-learning-link")).toBeInTheDocument();
    view.rerender(<CmeDashboard set={set} entries={[{ ...entry, date: "2025-06-01" }]} now={now} />);
    expect(screen.getByTestId("cme-first-nations-learning-link")).toBeInTheDocument();
    view.rerender(<CmeDashboard set={{ ...set, requirements: [] }} entries={[]} now={now} />);
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

  it("leads with the hero summary and one action, with no pace tick and no category bar", () => {
    renderAt("2026-09-19T02:00:00Z");
    const hero = screen.getByTestId("cme-hero-summary");
    expect(within(hero).getByTestId("cme-hero-season")).toHaveTextContent("Year ends 31 Dec 2026, in 15 weeks");
    expect(within(hero).getByTestId("cme-total-hours")).toHaveTextContent("32.5 of 50 h");
    expect(within(hero).getByTestId("cme-pace-sentence")).toHaveTextContent(
      "About 1.2 h a week reaches 50 h by 31 Dec",
    );
    expect(screen.queryByTestId("progress-mark")).toBeNull();
    expect(screen.queryByTestId("cme-category-bar")).toBeNull();
    expect(screen.getByTestId("cme-next-action")).toBeInTheDocument();
  });

  it("keeps 48 px clear under the last module for the floating + Log (spec §5)", () => {
    const { container } = renderAt("2026-09-19T02:00:00Z");
    // The button sits max(16 px, the home indicator) off the bottom and is 48 px tall; 6rem more is those 48 px plus 48 px clear.
    expect(container.querySelector("main")?.className).toContain("pb-[calc(max(1rem,var(--safe-area-bottom))+6rem)]");
  });

  it("says nothing about pace in January and points at the plan instead", () => {
    const earlyYearSet: CmeRequirementSet = {
      ...DEMO_CME_YEAR,
      requirements: DEMO_CME_YEAR.requirements.map((requirement) =>
        requirement.id === "plan" ? { ...requirement, completedOn: null } : requirement,
      ),
    };
    render(<CmeDashboard set={earlyYearSet} entries={DEMO_CME_ENTRIES} now={new Date("2026-01-06T02:00:00Z")} />);
    expect(screen.queryByTestId("cme-pace-sentence")).toBeNull();
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

  it("shows a legitimate zero as a zero", () => {
    render(<CmeDashboard set={DEMO_CME_YEAR} entries={[]} now={new Date("2026-09-19T02:00:00Z")} />);
    expect(screen.getByTestId("cme-total-hours")).toHaveTextContent("0");
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
    const next = screen.getByTestId("cme-next-action");
    expect(next).toHaveTextContent(/total cpd hours/i);
    expect(next).toHaveTextContent(/45 h to go/i);
    expect(next).toHaveAttribute("href", "/cme/new?year=2026");
    expect(next).not.toHaveTextContent(/every target is reached/i);
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
});
