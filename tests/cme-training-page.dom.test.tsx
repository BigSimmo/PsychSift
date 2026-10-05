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
import {
  SAMPLE_TRAINING_MILESTONES,
  SAMPLE_TRAINING_NOW_ISO,
  SAMPLE_TRAINING_PERIODS,
  sampleTrainingAssessments,
} from "@/lib/cme/training-assessments-sample";
import type { TrainingMilestone, TrainingPeriod } from "@/lib/cme/training-timeline";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.load.mockReset();
});

/** Opens one part of the training record from its summary row. */
async function openRecordPart(name: "Stages, rotations and breaks" | "Milestones") {
  await userEvent.setup().click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
}

const NOT_RECORDED = "Not recorded in PsychSift yet. Keep them in InTrain (RANZCP) or your ePortfolio (interns).";

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
  it("draws the timeline above the list of periods", async () => {
    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[]} demoMode={false} />);
    expect(screen.queryByTestId("cme-training-periods")).toBeNull();
    await openRecordPart("Stages, rotations and breaks");
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
    expect(screen.getByTestId("cme-training-record-periods")).toHaveTextContent("Nothing recorded yet");
    // An empty record starts open, so the doctor sees where to begin.
    expect(screen.getByTestId("cme-training-record-periods")).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByTestId("cme-training-stage")).toBeNull();
  });

  it("shows where the trainee is, the training clock, and an overdue milestone", async () => {
    render(
      <CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[OVERDUE_EXAM]} demoMode={false} />,
    );
    expect(screen.getByTestId("cme-training-record-periods")).toHaveTextContent(
      "Stages, rotations and breaksStage 2 · rotation 2 of 2 · 1 rotation done",
    );
    expect(screen.getByTestId("cme-training-record-milestones")).toHaveTextContent(
      "Milestones1 open · overdue since Tue 1 Sep",
    );
    await openRecordPart("Stages, rotations and breaks");
    await openRecordPart("Milestones");
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

  it("says the clock is paused on a break", async () => {
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
    await openRecordPart("Stages, rotations and breaks");
    await openRecordPart("Milestones");
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

  it("shows the EPA, term and A to D headings signed in, with an honest line and no counts", () => {
    render(<CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[]} demoMode={false} />);
    const page = screen.getByTestId("cme-training");
    for (const id of [
      "cme-training-epas",
      "cme-training-this-term",
      "cme-training-epa-assessments",
      "cme-training-experience",
    ]) {
      expect(screen.getByTestId(id)).toHaveTextContent(NOT_RECORDED);
    }
    expect(screen.getByTestId("cme-training-epas")).toHaveTextContent("EPAs this rotation");
    expect(screen.getByTestId("cme-training-epas")).toHaveTextContent(
      "The minimum is 2 for each 6-month full-time rotation, pro rata if part-time.",
    );
    expect(screen.getByTestId("cme-training-epas")).toHaveTextContent("RANZCP · not yet checked against the source");
    expect(screen.getByTestId("cme-training-epa-assessments")).toHaveTextContent(
      "AMC framework · not yet checked against the source",
    );
    for (const id of ["cme-training-epas", "cme-training-epa-assessments", "cme-training-cpd-rule"]) {
      expect(screen.getByTestId(id)).toHaveTextContent("Not signed off");
    }
    // Nothing counted, nothing that would look like it saves.
    expect(page).not.toHaveTextContent(/marked attained|WBAs logged|\b0 of 2\b|\bof 3\b|\blogged ·/);
    expect(screen.queryByTestId("cme-training-epas-figure")).toBeNull();
    expect(screen.queryByTestId("cme-training-term-chart")).toBeNull();
    expect(screen.queryByTestId("cme-training-experience-grid")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add an EPA/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Draft a WBA request/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Log an EPA assessment/ })).toBeNull();
    expect(page).not.toHaveTextContent("Dr Example");
    expect(screen.queryByTestId("cme-training-example-switch")).toBeNull();
    // The official records are linked.
    expect(screen.getByTestId("cme-training-portal")).toHaveTextContent(
      "Open your college training portalInTrain is the official record",
    );
    expect(screen.getByTestId("cme-training-eportfolio")).toHaveTextContent(
      "Your ePortfolioThe official record of your training",
    );
    expect(page).not.toHaveTextContent(/\bAMA\b/);
  });

  it("works the CPD rule out from the training record, read-only", () => {
    const { unmount } = render(
      <CmeTrainingPage nowIso={NOW_ISO} initialPeriods={PERIODS} initialMilestones={[]} demoMode={false} />,
    );
    expect(screen.getByTestId("cme-training-cpd-rule")).toHaveTextContent("Medical Board · checked Oct 2026");
    expect(screen.getByTestId("cme-training-cpd-rule-result")).toHaveTextContent(
      "Trainee in an accredited college programmeCovered by your training",
    );
    expect(screen.getByTestId("cme-training-cpd-rule-basis")).toHaveTextContent("Stage 2 covers today");
    // There is no stored rule setting, so nothing offers to change it in Set up.
    expect(screen.queryByTestId("cme-training-cpd-rule-change")).toBeNull();
    unmount();

    const { unmount: unmount2 } = render(
      <CmeTrainingPage nowIso={NOW_ISO} initialPeriods={[]} initialMilestones={[]} demoMode={false} />,
    );
    // An empty record is not a reading: nothing is ticked.
    expect(screen.getByTestId("cme-training-cpd-rule-result")).toHaveTextContent("Not worked out here");
    expect(screen.getByTestId("cme-training-cpd-rule-basis")).toHaveTextContent("empty or was not read here");
    unmount2();

    // A break inside a stage leaves the rule unworked-out rather than "covered by your training".
    const { unmount: unmount3 } = render(
      <CmeTrainingPage
        nowIso={NOW_ISO}
        initialPeriods={[
          { id: "s1", kind: "stage", label: "Stage 2", startsOn: "2026-02-01", endsOn: "2027-02-01", fte: 1 },
          { id: "b1", kind: "break", label: "Parental leave", startsOn: "2026-08-01", endsOn: "2026-12-01", fte: 0 },
        ]}
        initialMilestones={[]}
        demoMode={false}
      />,
    );
    expect(screen.getByTestId("cme-training-cpd-rule-result")).toHaveTextContent("Not worked out here");
    expect(screen.getByTestId("cme-training-cpd-rule-result")).not.toHaveTextContent("Covered by your training");
    expect(screen.getByTestId("cme-training-cpd-rule-basis")).toHaveTextContent("a break within Stage 2 today");
    unmount3();

    // A break or a rotation alone never counts as being covered by training.
    render(
      <CmeTrainingPage
        nowIso={NOW_ISO}
        initialPeriods={[
          { id: "b1", kind: "break", label: "Parental leave", startsOn: "2026-08-01", endsOn: "2027-02-01", fte: 0 },
          {
            id: "r9",
            kind: "rotation",
            label: "Adult inpatient",
            startsOn: "2026-08-03",
            endsOn: "2027-01-29",
            fte: 1,
          },
        ]}
        initialMilestones={[]}
        demoMode={false}
      />,
    );
    expect(screen.getByTestId("cme-training-cpd-rule-result")).toHaveTextContent("Everyone else");
    expect(screen.getByTestId("cme-training-cpd-rule-basis")).toHaveTextContent(
      "A break alone is not counted as training",
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
    await openRecordPart("Milestones");
    expect(screen.getByTestId("cme-training-milestones")).toHaveTextContent("You marked it done on 14 September 2026");
    await user.click(screen.getByRole("button", { name: "Edit Mid-rotation review" }));
    await user.click(screen.getByRole("button", { name: "Delete this milestone" }));
    expect(screen.getByRole("button", { name: "Delete milestone" })).toBeInTheDocument();
  });
});

describe("CME training page, the mock-up's sample people", () => {
  function renderSample(view: "registrar" | "intern") {
    return render(
      <CmeTrainingPage
        nowIso={SAMPLE_TRAINING_NOW_ISO}
        initialPeriods={SAMPLE_TRAINING_PERIODS}
        initialMilestones={SAMPLE_TRAINING_MILESTONES}
        demoMode
        assessments={sampleTrainingAssessments(view)}
      />,
    );
  }

  it("shows the registrar example with the mock-up's values", async () => {
    renderSample("registrar");
    expect(screen.getByTestId("cme-training-this-rotation")).toHaveTextContent("This rotation · Adult inpatient");
    expect(screen.getByTestId("cme-rotation-track-words")).toHaveTextContent(
      "Rotation runs 3 August 2026 to 29 January 2027.",
    );
    expect(screen.getByTestId("cme-training-rotation-milestone")).toHaveTextContent(
      "Mid-rotation reviewYour milestone · Mon 2 Nov",
    );
    expect(screen.getByTestId("cme-training-epas")).toHaveTextContent("EPAs this rotation");
    expect(screen.getByTestId("cme-training-epas")).toHaveTextContent("Not signed off");
    expect(screen.getByTestId("cme-training-epas-figure")).toHaveTextContent("1 of 2marked attained");
    const segments = screen.getByTestId("cme-training-epas-segments").children;
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveAttribute("data-filled", "true");
    expect(segments[1]).toHaveAttribute("data-filled", "false");
    expect(screen.getByText("1 of the minimum 2 EPAs marked attained this rotation.")).toHaveClass("sr-only");
    expect(screen.getByTestId("cme-training-epas-next")).toHaveTextContent(
      "At least 1 more by 29 January. The minimum is 2 for each 6-month full-time rotation, pro rata if part-time.",
    );
    const list = screen.getByTestId("cme-training-epa-list");
    expect(list).toHaveTextContent("EPAs in progress · 2");
    expect(screen.getByTestId("cme-training-epa-sample-epa-1")).toHaveTextContent(
      "Example EPA one2 of 3 WBAs logged · Dr ExampleDraft a WBA request",
    );
    expect(screen.getByTestId("cme-training-epa-sample-epa-2")).toHaveTextContent(
      "Example EPA two0 of 3 WBAs logged · not startedDraft a WBA request",
    );
    expect(screen.getByTestId("cme-training-epa-sample-epa-3")).toHaveTextContent(
      "Example EPA threeYou marked it attained on 14 Sep · keep your COE form in InTrain",
    );
    expect(screen.getByTestId("cme-training-wba-note")).toHaveTextContent(
      "A WBA request opens a draft for you to send. PsychSift sends nothing. Three WBAs do not by themselves mean an EPA is attained (RANZCP).",
    );
    expect(screen.getByTestId("cme-training-record-periods")).toHaveTextContent(
      "Stages, rotations and breaksStage 3 · rotation 2 of 4 · 1 rotation done",
    );
    expect(screen.getByTestId("cme-training-record-milestones")).toHaveTextContent("Milestones3 open · next Mon 2 Nov");
    expect(screen.getByTestId("cme-training-portal")).toHaveTextContent(
      "Open your college training portalInTrain is the official record",
    );
    expect(screen.getByTestId("cme-training-footer")).toHaveTextContent(
      "Your Director of Training has the final word on every requirement.",
    );
    // The junior doctor parts belong to the other example.
    expect(screen.queryByTestId("cme-training-epa-assessments")).toBeNull();
    expect(screen.queryByTestId("cme-training-cpd-rule")).toBeNull();
    expect(screen.getByRole("link", { name: "See the junior doctor example" })).toHaveAttribute(
      "href",
      "/cme/training?example=intern",
    );

    // A sample button saves and drafts nothing, and says so.
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await userEvent.setup().click(screen.getByRole("button", { name: "Draft a WBA request: Example EPA one" }));
    expect(list).toHaveTextContent("This is an example.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the junior doctor example with the mock-up's values", () => {
    renderSample("intern");
    expect(screen.getByTestId("cme-training-this-term")).toHaveTextContent("This term · general medicine");
    expect(screen.getByTestId("cme-training-mid-term")).toHaveTextContent(
      "Mid-term assessmentWith your term supervisor · Fri 16 Oct, in 12 days",
    );
    expect(screen.getByTestId("cme-training-term")).toHaveTextContent("Term 4Mon 14 Sep to Sun 22 Nov · week 3 of 10");
    const epas = screen.getByTestId("cme-training-epa-assessments");
    expect(epas).toHaveTextContent("EPA assessments · 2026");
    expect(epas).toHaveTextContent("AMC framework · not yet checked against the source");
    expect(screen.getByTestId("cme-training-epa-assessments-figure")).toHaveTextContent(
      "7logged · at least 10 a year, at least 2 each term",
    );
    expect(["1", "2", "3", "4", "5"].map((n) => screen.getByTestId(`cme-training-term-${n}`).textContent)).toEqual([
      "3",
      "2",
      "2",
      "0 of 2",
      "Nov",
    ]);
    expect(screen.getByTestId("cme-training-term-chart")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("cme-training-term-chart-words")).toHaveTextContent(
      "Term 1: 3, term 2: 2, term 3: 2, term 4: 0 so far, term 5 not started.",
    );
    expect(epas).toHaveTextContent("EPA 1 at least once each term. EPAs 2 to 4 at least twice a year.");
    expect(screen.getByRole("button", { name: "Log an EPA assessment" })).toBeInTheDocument();
    const grid = screen.getByTestId("cme-training-experience");
    expect(grid).toHaveTextContent("Clinical experience · terms done");
    expect(screen.getByTestId("cme-training-experience-A")).toHaveTextContent("AUndifferentiated illness");
    expect(screen.getByTestId("cme-training-experience-A")).toHaveTextContent("2 of 3");
    expect(screen.getByTestId("cme-training-experience-B")).toHaveTextContent("Chronic illness");
    expect(screen.getByTestId("cme-training-experience-B")).toHaveTextContent("1 of 3");
    expect(screen.getByTestId("cme-training-experience-C")).toHaveTextContent("2 of 3");
    expect(screen.getByTestId("cme-training-experience-D")).toHaveTextContent("Peri-procedural care");
    expect(screen.getByTestId("cme-training-experience-D")).toHaveTextContent("0 of 3");
    expect(screen.getByTestId("cme-training-experience-A")).toHaveTextContent("Term 4: this term, not finished");
    expect(grid).toHaveTextContent(
      "Filled: covered in that term. Dashed: this term, not finished. Category D applies to PGY1.",
    );
    // The CPD rule is never worked out from the registrar example's record.
    expect(screen.getByTestId("cme-training-cpd-rule-result")).toHaveTextContent("Not worked out here");
    expect(screen.getByTestId("cme-training-eportfolio")).toHaveTextContent(
      "Your ePortfolioThe official record of your training",
    );
    expect(screen.getByRole("link", { name: /Intern teaching/ })).toHaveAttribute("href", "/teaching");
    expect(screen.getByTestId("cme-training-footer")).toHaveTextContent(
      "Your term supervisor and medical education unit have the final word.",
    );
    // The registrar's parts are not on this example.
    expect(screen.queryByTestId("cme-training-this-rotation")).toBeNull();
    expect(screen.queryByTestId("cme-training-epas")).toBeNull();
    expect(screen.queryByTestId("cme-training-position")).toBeNull();
    expect(screen.getByRole("link", { name: "See the registrar example" })).toHaveAttribute("href", "/cme/training");
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
    expect(screen.getByTestId("cme-training-epas-figure")).toHaveTextContent("1 of 2marked attained");
  });

  it("switches the demo to the junior doctor example with ?example=intern", async () => {
    mocks.load.mockResolvedValue({
      state: "ready",
      demoMode: true,
      periods: SAMPLE_TRAINING_PERIODS,
      milestones: SAMPLE_TRAINING_MILESTONES,
      now: new Date(SAMPLE_TRAINING_NOW_ISO),
    });
    render(await CmeTrainingRoute({ searchParams: Promise.resolve({ example: "intern" }) }));
    expect(screen.getByTestId("cme-training-epa-assessments-figure")).toHaveTextContent("7logged");
    expect(screen.queryByTestId("cme-training-epas")).toBeNull();
  });

  it("never shows sample figures to a signed-in doctor, even with ?example=intern", async () => {
    mocks.load.mockResolvedValue({
      state: "ready",
      demoMode: false,
      periods: [],
      milestones: [],
      now: new Date(NOW_ISO),
    });
    render(await CmeTrainingRoute({ searchParams: Promise.resolve({ example: "intern" }) }));
    expect(screen.getByTestId("cme-training-epa-assessments")).toHaveTextContent(NOT_RECORDED);
    expect(screen.queryByTestId("cme-training-epa-assessments-figure")).toBeNull();
    expect(screen.getByTestId("cme-training")).not.toHaveTextContent("Dr Example");
  });
});
