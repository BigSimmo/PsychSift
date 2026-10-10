/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { perthDateKey } from "@/components/teaching/teaching-dates";
import { AssessorForm } from "@/components/teaching/assessments/assessments-assessor";
import { FormPdf } from "@/components/teaching/assessments/assessments-pdf";
import { AssessmentsHome } from "@/components/teaching/assessments/assessments-home";
import { AssessmentReport } from "@/components/teaching/assessments/assessments-report";
import { EndOfTermSteps } from "@/components/teaching/assessments/assessments-steps";
import { BeginningOfTerm, TermDetails, YearRequirements } from "@/components/teaching/assessments/assessments-year";
import { TeachingAssessments, type ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { TEACHING_TERM_TRACKER_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { resetExampleDataForTests } from "@/lib/example-data/store";
import { initialDctState } from "@/lib/teaching/assessments/dct";
import {
  assessmentsReducer,
  initialAssessmentsState,
  type AssessmentsAction,
  type AssessmentsState,
  type Signature,
} from "@/lib/teaching/assessments/model";
import { sampleTermTracker } from "@/lib/teaching/term-tracker";

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 0 }));
const nav = vi.hoisted(() => ({ search: "" }));

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/teaching/assessments",
}));

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
  auth.status = "authenticated";
  nav.search = "";
});

function props(s: AssessmentsState = initialAssessmentsState(), query = "", extra: Partial<ScreenProps> = {}) {
  return {
    s,
    dispatch: vi.fn(),
    params: new URLSearchParams(query),
    role: "doctor",
    openSheet: vi.fn(),
    go: vi.fn(),
    saveEpa: vi.fn(),
    dct: initialDctState(),
    ...extra,
  } satisfies ScreenProps;
}

const sig = (date: string, day: number): Signature => ({ typed: "Sam Karri", image: null, date, day });
/** Dr Wattle has signed term 4, and then Sam. */
const supSigned: AssessmentsState = { ...initialAssessmentsState(), sigs: { sup: sig("Mon 2 Nov", 0), doc: null } };
const bothSigned: AssessmentsState = { ...supSigned, sigs: { sup: sig("Mon 2 Nov", 0), doc: sig("Tue 3 Nov", 1) } };

describe("What happens next, after the doctor signs (A3, item 11)", () => {
  it("shows acknowledge in CLA, DCT sign-off next, the 14-day reply and Open CLA once Sam has signed", () => {
    render(<EndOfTermSteps {...props(bothSigned)} />);
    const next = screen.getByTestId("assess-what-next");
    expect(within(next).getByText("Signed here")).toBeInTheDocument();
    expect(within(next).getByText(/Acknowledge the form in CLA too/)).toBeInTheDocument();
    expect(within(next).getByText("DCT sign-off")).toBeInTheDocument();
    expect(within(next).getByText(/write to the DCT within 14 days/)).toBeInTheDocument();
    expect(within(next).getByRole("link", { name: /Open CLA/ })).toHaveAttribute(
      "href",
      "https://cla.epads.mkmapps.com",
    );
    expect(screen.getByText(/find it on your hospital's intranet, or ask your term supervisor/)).toBeInTheDocument();
  });

  it("asks the doctor to read and acknowledge first while only the supervisor has signed", () => {
    render(<EndOfTermSteps {...props(supSigned)} />);
    expect(within(screen.getByTestId("assess-what-next")).getByText("Read and acknowledge")).toBeInTheDocument();
  });

  it("is not shown before the supervisor signs", () => {
    render(<EndOfTermSteps {...props()} />);
    expect(screen.queryByTestId("assess-what-next")).toBeNull();
  });
});

describe("The beginning-of-term discussion and the mid-term, openable (A6, item 14)", () => {
  it("opens from To do and from Term details", () => {
    const { unmount } = render(<AssessmentsHome {...props()} />);
    expect(screen.getByRole("link", { name: /Beginning-of-term discussion/ })).toHaveAttribute(
      "href",
      "/teaching/assessments?view=botd&term=t4",
    );
    unmount();
    render(<TermDetails {...props(initialAssessmentsState(), "view=term&term=t1")} />);
    expect(screen.getByRole("link", { name: /Beginning-of-term discussion/ })).toHaveAttribute(
      "href",
      "/teaching/assessments?view=botd&term=t1",
    );
  });

  it("shows the goals agreed, and who does the mid-term", () => {
    render(<BeginningOfTerm {...props(initialAssessmentsState(), "view=botd&term=t4")} />);
    expect(screen.getByRole("list", { name: "Goals agreed" }).children).toHaveLength(3);
    expect(screen.getByText("Present a full formulation on ward round.")).toBeInTheDocument();
    expect(screen.getByText(/A required discussion between you and your term supervisor/)).toBeInTheDocument();
    const plan = screen.getByRole("list", { name: "Assessments for the term" });
    expect(plan).toHaveTextContent(
      "By your primary clinical supervisor. A registrar can do it, with formal sign-off by your primary clinical supervisor.",
    );
    expect(within(plan).getByRole("link", { name: /Mid-term/ })).toHaveAttribute(
      "href",
      "/teaching/assessments?view=report&of=mid",
    );
    expect(screen.getByText("Wed 2 Sep (made-up)")).toBeInTheDocument();
  });

  it("says on the mid-term report that the primary clinical supervisor does it", () => {
    render(<AssessmentReport {...props(initialAssessmentsState(), "view=report&of=mid")} />);
    expect(screen.getByText(/Your primary clinical supervisor does the mid-term/)).toBeInTheDocument();
    expect(screen.getByText("Primary clinical supervisor")).toBeInTheDocument();
  });
});

describe("Delegation in the example story (A7, item 12)", () => {
  it("shows term 2's end-of-term completed by a clinical supervisor and countersigned by the term supervisor", () => {
    render(<TermDetails {...props(initialAssessmentsState(), "view=term&term=t2")} />);
    expect(
      screen.getByText(/Completed by Dr Morgan Wandoo \(clinical supervisor\) and countersigned by Dr Casey Marri/),
    ).toBeInTheDocument();
  });

  it("shows term 3's registrar mid-term with the primary clinical supervisor's sign-off", () => {
    render(<TermDetails {...props(initialAssessmentsState(), "view=term&term=t3")} />);
    expect(screen.getByText(/Dr Pat Tingle \(registrar\), with formal sign-off/)).toBeInTheDocument();
    expect(screen.queryByText(/countersign/i)).toBeNull();
  });

  it("names both kinds of experience for a two-kind term", () => {
    render(<TermDetails {...props(initialAssessmentsState(), "view=term&term=t1")} />);
    expect(screen.getByText("A and C · Undifferentiated illness and acute and critical illness")).toBeInTheDocument();
  });
});

describe("Year rules and year end on Progress (items 16, 17, 19)", () => {
  it("lists the clinical team and specialty rules, the transcript step and how to reach the MEU", () => {
    render(<YearRequirements {...props(initialAssessmentsState(), "view=progress")} tab />);
    expect(screen.getByText(/^At least 4\sterms in different specialties\.$/)).toBeInTheDocument();
    expect(screen.getByText(/would not normally count/)).toBeInTheDocument();
    const yearEnd = screen.getByTestId("assess-year-end");
    expect(within(yearEnd).getByText("Transcript of learning")).toBeInTheDocument();
    expect(screen.getByText(/find it on your hospital's intranet/)).toBeInTheDocument();
  });
});

describe("The assessor's outcome statements (item 15)", () => {
  const asked = [{ type: "request-epa", epa: 1, who: "sup" } as AssessmentsAction].reduce(
    assessmentsReducer,
    initialAssessmentsState(),
  );

  it("starts with the doctor's ticks, lets the assessor untick one, and saves only the confirmed ones", () => {
    const saveEpa = vi.fn();
    render(<AssessorForm {...props(asked, "view=epaform&i=0", { role: "supervisor", saveEpa })} />);
    const group = screen.getByRole("group", { name: "Outcome statements Sam ticked" });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    for (const box of boxes) expect(box).toBeChecked();
    fireEvent.click(within(group).getByRole("checkbox", { name: /Investigations/ }));
    fireEvent.click(screen.getByRole("radio", { name: /I directly observed some part of it/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Requires proximal supervision|Proximal/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit EPA 1" }));
    expect(saveEpa).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "record-epa",
        feedback: expect.objectContaining({ observed: "direct", outcomes: ["1.2", "1.4", "1.7"] }),
      }),
    );
  });

  it("shows each confirmed outcome by its number and wording once submitted", () => {
    const saveEpa = vi.fn();
    render(<AssessorForm {...props(asked, "view=epaform&i=0", { role: "supervisor", saveEpa })} />);
    fireEvent.click(screen.getByRole("radio", { name: /I directly observed some part of it/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Requires proximal supervision|Proximal/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit EPA 1" }));
    const done = assessmentsReducer(asked, saveEpa.mock.calls[0]![0] as AssessmentsAction);
    document.body.innerHTML = "";
    render(<AssessorForm {...props(done, "view=epaform&i=0", { role: "supervisor" })} />);
    const row = screen.getByText("Outcome statements confirmed").parentElement!;
    expect(row.textContent).toMatch(/1\.2 [A-Z]/);
  });

  it("shows the outcome statements read-only in the doctor's preview", () => {
    render(<AssessorForm {...props(asked, "view=epaform&i=0", { role: "doctor" })} />);
    const group = screen.getByRole("group", { name: "Outcome statements Sam ticked" });
    for (const box of within(group).getAllByRole("checkbox")) expect(box).toBeDisabled();
  });
});

describe("A signed-in doctor's Progress tab (A2, item 20)", () => {
  it("shows their own EPA counts from Teaching, not a second copy of the CLA notice", async () => {
    const today = perthDateKey(new Date());
    const tracker = sampleTermTracker(today);
    // Only one EPA, logged today, so the counts are exact whatever the date the suite runs on.
    const epas = [{ id: "today", termId: tracker.currentTermId!, epa: 2 as const, on: today }];
    window.localStorage.setItem(TEACHING_TERM_TRACKER_STORAGE_KEY, JSON.stringify({ ...tracker, epas }));
    nav.search = "view=progress";
    render(<TeachingAssessments demoMode={false} />);
    const progress = screen.getByTestId("teaching-assessments-progress");
    expect(screen.queryByTestId("teaching-assessments-kept-in-cla")).toBeNull();
    expect(within(progress).getByRole("link", { name: "Count EPAs" })).toHaveAttribute("href", "/teaching/term");
    expect(await within(progress).findByText(/EPAs this year/)).toBeInTheDocument();
    expect(progress).toHaveTextContent("Your forms and EPAs themselves stay in CLA.");
    // Each EPA's count this year sits under the term card, one row per EPA.
    const byEpa = await within(progress).findByTestId("assessments-epa-counts");
    const rows = within(byEpa).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(byEpa).toHaveTextContent("Recognition and care of the acutely unwell patient");
    // The one logged EPA counts against EPA 2 only.
    expect(rows.map((row) => row.textContent?.match(/EPA (\d):.*?(\d+) this year$/)?.slice(1))).toEqual([
      ["1", "0"],
      ["2", "1"],
      ["3", "0"],
      ["4", "0"],
    ]);
  });

  it("leaves out the per-EPA list until an EPA is logged", async () => {
    const today = perthDateKey(new Date());
    window.localStorage.setItem(
      TEACHING_TERM_TRACKER_STORAGE_KEY,
      JSON.stringify({ ...sampleTermTracker(today), epas: [] }),
    );
    nav.search = "view=progress";
    render(<TeachingAssessments demoMode={false} />);
    const progress = screen.getByTestId("teaching-assessments-progress");
    await within(progress).findByText(/EPAs this year/);
    expect(within(progress).queryByTestId("assessments-epa-counts")).toBeNull();
  });

  it("shows a supervisor or DCT address the CLA notice, never this account's counts", () => {
    nav.search = "view=progress&as=supervisor";
    render(<TeachingAssessments demoMode={false} />);
    expect(screen.getByTestId("teaching-assessments-kept-in-cla")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-assessments-progress")).toBeNull();
  });

  it("keeps the CLA notice on To do", () => {
    render(<TeachingAssessments demoMode={false} />);
    expect(screen.getByTestId("teaching-assessments-kept-in-cla")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-assessments-progress")).toBeNull();
  });
});

describe("A delegated end-of-term's signed copy (AMC Section 3A)", () => {
  it("names the clinical supervisor who completed it and the term supervisor who countersigned", () => {
    render(<FormPdf {...props(initialAssessmentsState(), "view=form&of=past&term=t2&kind=eot")} />);
    expect(screen.getByText("Completed by (clinical supervisor)")).toBeInTheDocument();
    expect(screen.getAllByText("Dr Morgan Wandoo").length).toBeGreaterThan(0);
    expect(screen.getByText("Countersigned by (term supervisor)")).toBeInTheDocument();
  });

  it("keeps an ordinary term's form as it was", () => {
    render(<FormPdf {...props(initialAssessmentsState(), "view=form&of=past&term=t1&kind=eot")} />);
    expect(screen.queryByText("Completed by (clinical supervisor)")).toBeNull();
  });
});
