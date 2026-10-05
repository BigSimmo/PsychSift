import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => "/cme/training",
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));
vi.mock("@/lib/cme/training-page-data", () => ({ loadCmeTrainingPageData: mocks.load }));

import CmeTrainingRoute from "@/app/(search-app)/cme/training/page";
import { CmeTrainingPage } from "@/components/cme/cme-training-page";
import type { TrainingMilestone, TrainingPeriod } from "@/lib/cme/training-timeline";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.load.mockReset();
});

/** 28 September 2026, 10:00 Perth. */
const NOW_ISO = "2026-09-28T02:00:00.000Z";

const PERIODS: TrainingPeriod[] = [
  { id: "s2", kind: "stage", label: "Stage 2", startsOn: "2026-02-02", endsOn: null, fte: 1 },
  { id: "r1", kind: "rotation", label: "Adult inpatient", startsOn: "2026-02-02", endsOn: "2026-07-31", fte: 1 },
  {
    id: "r2",
    kind: "rotation",
    label: "Consultation liaison",
    startsOn: "2026-08-03",
    endsOn: "2027-01-29",
    fte: 0.5,
  },
];

const OVERDUE_EXAM: TrainingMilestone = {
  id: "m1",
  label: "Written examination",
  dueKind: "date",
  dueFteMonths: null,
  dueOn: "2026-09-01",
  completedOn: null,
};

describe("CME training page", () => {
  it("draws the timeline above the list of periods", () => {
    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[]} demoMode={false} />);
    const timeline = screen.getByTestId("cme-training-timeline");
    const list = screen.getByTestId("cme-training-periods");
    expect(timeline.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("cme-training-timeline-now")).toHaveTextContent(
      "Now, Mon 28 Sep: Consultation liaison, rotation 2 of 2",
    );
  });

  it("explains that nothing is preloaded when the record is empty", () => {
    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={[]} initialMilestones={[]} demoMode={false} />);
    expect(screen.getByTestId("cme-training")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Training" })).toBeInTheDocument();
    expect(
      screen.getByText(/It is not the college's record, and nothing here changes your CPD targets\./),
    ).toBeTruthy();
    const empty = screen.getByTestId("cme-training-empty");
    expect(empty).toHaveTextContent("Nothing is preloaded here.");
    expect(empty).toHaveTextContent("your college's current requirements");
    expect(screen.queryByTestId("cme-training-position")).toBeNull();
  });

  it("shows where the trainee is, the training clock, and an overdue milestone", () => {
    render(
      <CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[OVERDUE_EXAM]} demoMode={false} />,
    );
    expect(screen.queryByTestId("cme-training-empty")).toBeNull();
    expect(screen.getByTestId("cme-training-stage")).toHaveTextContent("Stage 2");
    expect(screen.getByTestId("cme-training-rotation")).toHaveTextContent(
      "Consultation liaison, rotation 2 of 2, at 0.5 FTE",
    );
    // 180 full-time days + 57 half-time days = 208.5 FTE days = 6.85 FTE months.
    expect(screen.getByTestId("cme-training-clock")).toHaveTextContent("6.9 FTE months");
    expect(screen.getByText(/Half-time counts half, and breaks pause the clock\./)).toBeTruthy();
    expect(screen.getByTestId("cme-training-next")).toHaveTextContent("Written examination");
    expect(screen.getByTestId("cme-training-next-detail")).toHaveTextContent(
      "Overdue: it was due on 1 September 2026.",
    );
  });

  it("says the clock is paused on a break", () => {
    render(
      <CmeTrainingPage
        nowIso={NOW_ISO}
        initialPeriods={[
          { id: "b1", kind: "break", label: "Parental leave", startsOn: "2026-09-01", endsOn: null, fte: 0 },
        ]}
        initialMilestones={[]}
        demoMode={false}
      />,
    );
    expect(screen.getByTestId("cme-training-on-break")).toHaveTextContent(
      "On a break: Parental leave. Your training clock is paused.",
    );
    expect(screen.getByTestId("cme-training-clock")).toHaveTextContent("0 FTE months");
    expect(screen.getByTestId("cme-training-next-detail")).toHaveTextContent("No milestones yet.");
  });

  it("adds a rotation through the API and shows it", async () => {
    const user = userEvent.setup();
    const saved: TrainingPeriod = {
      id: "55555555-5555-4555-8555-555555555555",
      kind: "rotation",
      label: "Child and adolescent",
      startsOn: "2027-02-01",
      endsOn: null,
      fte: 0.8,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ period: saved }), { status: 201 }));
    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[]} demoMode={false} />);

    await user.click(screen.getByRole("button", { name: "Add stage, rotation or break" }));
    await user.type(screen.getByLabelText(/^Label/), "Child and adolescent");
    await user.type(screen.getByLabelText(/^Start date/), "01/02/2027");
    const fte = screen.getByLabelText(/^FTE/);
    await user.clear(fte);
    await user.type(fte, "0.8");
    await user.click(screen.getByRole("button", { name: "Save period" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/cme/training");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "period",
      kind: "rotation",
      label: "Child and adolescent",
      startsOn: "2027-02-01",
      endsOn: null,
      fte: 0.8,
    });
    await waitFor(() => expect(screen.getByTestId("cme-training-periods")).toHaveTextContent("Child and adolescent"));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows an overlap inline and does not call the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[]} demoMode={false} />);

    await user.click(screen.getByRole("button", { name: "Add stage, rotation or break" }));
    await user.type(screen.getByLabelText(/^Label/), "Old age");
    await user.type(screen.getByLabelText(/^Start date/), "01/09/2026");
    await user.click(screen.getByRole("button", { name: "Save period" }));

    expect(await screen.findByTestId("cme-training-period-problems")).toHaveTextContent(/overlap/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to save when an optional end date is mistyped, instead of keeping the old date", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={[]} initialMilestones={[]} demoMode={false} />);

    await user.click(screen.getByRole("button", { name: "Add stage, rotation or break" }));
    await user.type(screen.getByLabelText(/^Label/), "Demo rotation");
    await user.type(screen.getByLabelText(/^Start date/), "01/02/2026");
    await user.type(screen.getByLabelText(/^End date/), "31/06/2026");
    await user.click(screen.getByRole("button", { name: "Save period" }));

    expect(await screen.findByText("Fix the date before saving.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save period" })).toBeInTheDocument();

    // Once the day is readable, the same form saves.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          period: {
            id: "p1",
            kind: "rotation",
            label: "Demo rotation",
            startsOn: "2026-02-01",
            endsOn: "2026-06-30",
            fte: 1,
          },
        }),
        { status: 201 },
      ),
    );
    const end = screen.getByLabelText(/^End date/);
    await user.clear(end);
    await user.type(end, "30/06/2026");
    await user.click(screen.getByRole("button", { name: "Save period" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).endsOn).toBe("2026-06-30");
  });
});

describe("CME training page, mock-up layout", () => {
  const MID_REVIEW: TrainingMilestone = {
    id: "m2",
    label: "Mid-rotation review",
    dueKind: "date",
    dueFteMonths: null,
    dueOn: "2026-11-02",
    completedOn: null,
  };

  it("draws this rotation with the doctor's own milestone and the rotation's end", () => {
    render(
      <CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[MID_REVIEW]} demoMode={false} />,
    );
    const group = screen.getByTestId("cme-training-this-rotation");
    expect(group).toHaveTextContent("This rotation · Consultation liaison");
    expect(screen.getByTestId("cme-rotation-track-marker")).toBeInTheDocument();
    expect(screen.getByTestId("cme-rotation-track-words")).toHaveTextContent(
      "Rotation runs 3 August 2026 to 29 January 2027. Today is about 30% of the way through.",
    );
    expect(screen.getByTestId("cme-training-rotation-milestone")).toHaveTextContent(
      "Mid-rotation reviewYour milestone · Mon 2 Nov, in 5 weeks",
    );
    expect(screen.getByTestId("cme-training-rotation-end")).toHaveTextContent(
      "End of rotationFri 29 Jan 2027 · in about 18 weeks",
    );
  });

  it("shows rule figures with their source, check month and Not signed off, and counts nothing", () => {
    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[]} demoMode={false} />);
    const assessments = screen.getByTestId("cme-training-assessments");
    expect(assessments).toHaveTextContent("PsychSift does not record EPAs, WBAs or term assessments yet");
    expect(screen.getByTestId("cme-training-rule-ranzcp-epa")).toHaveTextContent(
      "At least 2 for each 6-month full-time rotation, pro rata if part-time.",
    );
    expect(screen.getByTestId("cme-training-rule-ranzcp-epa")).toHaveTextContent("RANZCP · checked Oct 2026");
    expect(screen.getByTestId("cme-training-rule-amc-epa")).toHaveTextContent("run in WA by PMCWA");
    for (const id of ["cme-training-rule-ranzcp-epa", "cme-training-rule-amc-epa", "cme-training-cpd-rule"]) {
      expect(screen.getByTestId(id)).toHaveTextContent("Not signed off");
    }
    expect(screen.getByTestId("cme-training")).not.toHaveTextContent(/\bAMA\b/);
  });

  it("works the CPD rule out from the training record, read-only, with a link to Set up", () => {
    const { unmount } = render(
      <CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[]} demoMode={false} />,
    );
    expect(screen.getByTestId("cme-training-cpd-rule")).toHaveTextContent("Medical Board · checked Oct 2026");
    expect(screen.getByTestId("cme-training-cpd-rule-result")).toHaveTextContent(
      "In a training programmeCovered by your training",
    );
    expect(screen.getByTestId("cme-training-cpd-rule-basis")).toHaveTextContent("Consultation liaison covers today");
    expect(screen.getByTestId("cme-training-cpd-rule-change")).toHaveAttribute("href", "/cme/setup");
    unmount();

    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={[]} initialMilestones={[]} demoMode={false} />);
    expect(screen.getByTestId("cme-training-cpd-rule-result")).toHaveTextContent(
      "Everyone else50 h a year with a CPD home, a written plan and category minimums",
    );
    expect(screen.getByTestId("cme-training-cpd-rule-basis")).toHaveTextContent(
      "no stage, rotation or break covers today",
    );
  });

  it("says a milestone marked done in the doctor's words, and deletes from inside the edit form", async () => {
    const user = userEvent.setup();
    render(
      <CmeTrainingPage
        nowIso={NOW_ISO}
        initialPeriods={PERIODS}
        initialMilestones={[{ ...MID_REVIEW, completedOn: "2026-09-14" }]}
        demoMode={false}
      />,
    );
    expect(screen.getByTestId("cme-training-milestones")).toHaveTextContent("You marked it done on 14 September 2026");
    await user.click(screen.getByRole("button", { name: "Edit Mid-rotation review" }));
    await user.click(screen.getByRole("button", { name: "Delete this milestone" }));
    expect(screen.getByRole("button", { name: "Delete milestone" })).toBeInTheDocument();
  });
});

describe("CME training route", () => {
  it("shows the sign-in notice when signed out", async () => {
    mocks.load.mockResolvedValue({
      state: "signed-out",
      demoMode: false,
      periods: [],
      milestones: [],
      now: new Date(NOW_ISO),
    });
    render(await CmeTrainingRoute());
    expect(screen.getByTestId("cme-signed-out")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Training" })).toBeInTheDocument();
    expect(screen.queryByTestId("cme-training")).toBeNull();
  });

  it("renders the page when ready", async () => {
    mocks.load.mockResolvedValue({
      state: "ready",
      demoMode: true,
      periods: [],
      milestones: [],
      now: new Date(NOW_ISO),
    });
    render(await CmeTrainingRoute());
    expect(screen.getByTestId("cme-training-empty")).toBeInTheDocument();
  });
});
