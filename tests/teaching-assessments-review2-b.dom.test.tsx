/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssessorForm } from "@/components/teaching/assessments/assessments-assessor";
import { DctHome } from "@/components/teaching/assessments/assessments-dct";
import { ConcernsHelp } from "@/components/teaching/assessments/assessments-help";
import { AssessmentsKeptInCla } from "@/components/teaching/assessments/assessments-kept-in-cla";
import { TeachingAssessments, type ScreenProps } from "@/components/teaching/assessments/teaching-assessments";
import { readExampleData, resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";
import { dctReducer, initialDctState } from "@/lib/teaching/assessments/dct";
import { assessmentsReducer, initialAssessmentsState, type AssessmentsAction } from "@/lib/teaching/assessments/model";

const auth = vi.hoisted(() => ({ status: "authenticated", authEpoch: 0 }));
const nav = vi.hoisted(() => ({ search: "", refresh: vi.fn(), push: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/teaching/assessments",
}));

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
  auth.status = "authenticated";
  nav.search = "";
  nav.refresh.mockClear();
});

function props(s = initialAssessmentsState(), extra: Partial<ScreenProps> = {}): ScreenProps {
  return {
    s,
    dispatch: vi.fn(),
    params: new URLSearchParams(),
    role: "doctor",
    openSheet: vi.fn(),
    go: vi.fn(),
    saveEpa: vi.fn(),
    dct: initialDctState(),
    ...extra,
  };
}

const withRequest = (...more: AssessmentsAction[]) =>
  [{ type: "request-epa", epa: 1, who: "sup" } as AssessmentsAction, ...more].reduce(
    assessmentsReducer,
    initialAssessmentsState(),
  );

describe("Assessments: the doctor's look at the assessor's form (site audit B3)", () => {
  it("is a read-only preview, with no way to answer their own EPA", () => {
    const saveEpa = vi.fn();
    render(
      <AssessorForm
        {...props(withRequest(), { role: "doctor", saveEpa, params: new URLSearchParams({ view: "epaform", i: "0" }) })}
      />,
    );
    expect(screen.getByRole("heading", { name: "What the assessor sees" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit EPA/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Can't assess yet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send back" })).toBeNull();
    expect(screen.getByRole("radio", { name: /I directly observed some part of it/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Requires minimal supervision/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Low" })).toBeDisabled();
    expect(screen.getByLabelText(/Agreed learning goal/)).toHaveAttribute("readonly");
    expect(saveEpa).not.toHaveBeenCalled();
  });

  it("stays the live form on the supervisor's side", () => {
    render(
      <AssessorForm
        {...props(withRequest(), { role: "supervisor", params: new URLSearchParams({ view: "epaform", i: "0" }) })}
      />,
    );
    expect(screen.getByRole("heading", { name: /asked you to assess EPA 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit EPA 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument();
  });
});

describe("Assessments: Get help on each side (M15, M20, A9, U3)", () => {
  it("speaks to the doctor being assessed, with the checked phone numbers and how to find the MEU", () => {
    render(<ConcernsHelp {...props()} />);
    expect(screen.getByText("For the doctor being assessed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Disagree with a report/ })).toBeInTheDocument();
    expect(screen.getByText("(08) 9222 4010")).toBeInTheDocument();
    expect(screen.getByText("(08) 6388 4904")).toBeInTheDocument();
    expect(screen.queryByText("(08) 9321 3098")).toBeNull();
    expect(screen.queryByText(/to be checked/)).toBeNull();
    expect(screen.getByText(/find it on your hospital's intranet, or ask your term supervisor/)).toBeInTheDocument();
    expect(screen.getByText("Your Director of Clinical Training (DCT)")).toBeInTheDocument();
    expect(screen.queryByText(/Postgraduate Medical Education/)).toBeNull();
    expect(screen.getByText(/Some hospitals use a different title/)).toBeInTheDocument();
  });

  it("gives a supervisor the short version", () => {
    render(<ConcernsHelp {...props(undefined, { role: "supervisor" })} />);
    expect(screen.getByText("For supervisors")).toBeInTheDocument();
    expect(screen.getByText("Worried about a doctor? Talk to your DCT or MEU.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Disagree with a report/ })).toBeNull();
  });
});

describe("Assessments: the CLA notice (M7, M12, W4)", () => {
  it("names PMCWA's page and registrar supervision, and who does each term assessment", () => {
    render(<AssessmentsKeptInCla />);
    expect(screen.getByTestId("teaching-assessments-open-cla")).toHaveTextContent("About CLA (PMCWA)");
    expect(screen.getByRole("link", { name: "Registrar supervision" })).toHaveAttribute(
      "href",
      "/teaching/supervision",
    );
    const card = screen.getByTestId("teaching-assessments-how-cla");
    expect(card).toHaveTextContent("Mid-term, usually by your primary clinical supervisor.");
    expect(card).toHaveTextContent("someone they delegate, which they then countersign.");
    expect(card).toHaveTextContent("primary clinical supervisor or an equivalent specialist");
  });
});

describe("Assessments: the DCT's guest assessors (M13)", () => {
  function Home({ s }: { s: ReturnType<typeof initialAssessmentsState> }) {
    const [dct, dctDispatch] = useReducer(dctReducer, undefined, initialDctState);
    return <DctHome s={s} params={new URLSearchParams()} go={vi.fn()} dct={dct} dctDispatch={dctDispatch} />;
  }

  it("lists the story's own open guest request beside the made-up ones", () => {
    const s = [{ type: "request-epa", epa: 2, who: "guest", guest: "nurse" } as AssessmentsAction].reduce(
      assessmentsReducer,
      initialAssessmentsState(),
    );
    render(<Home s={s} />);
    fireEvent.click(screen.getByRole("button", { name: /Guest assessors/ }));
    const guests = screen.getByTestId("assess-dct-guests");
    expect(within(guests).getByText("Nurse")).toBeInTheDocument();
    expect(within(guests).getByText("EPA 2 for Dr Sam Karri")).toBeInTheDocument();
    expect(within(guests).getByText(/Alex Tuart/)).toBeInTheDocument();
  });
});

describe("Assessments: a page with the example off (A1, B6)", () => {
  it("lets a signed-in reader open Get help, with no made-up names", () => {
    nav.search = "view=help";
    render(<TeachingAssessments demoMode={false} />);
    expect(screen.getByRole("heading", { name: "Concerns and help" })).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-assessments-kept-in-cla")).toBeNull();
    expect(screen.queryByText(/Wattle/)).toBeNull();
  });

  it("lets a signed-in reader open Help and words", () => {
    nav.search = "view=words";
    render(<TeachingAssessments demoMode={false} />);
    expect(screen.getByRole("heading", { name: "Help and words" })).toBeInTheDocument();
  });

  it("keeps every other view behind the CLA notice when signed in, with no example button", () => {
    nav.search = "view=all";
    render(<TeachingAssessments demoMode={false} />);
    expect(screen.getByTestId("teaching-assessments-kept-in-cla")).toBeInTheDocument();
    expect(screen.queryByTestId("teaching-assessments-look-around")).toBeNull();
  });

  it("offers a signed-out reader the example back", () => {
    auth.status = "signed_out";
    act(() => setExampleDataOn(false));
    render(<TeachingAssessments demoMode={false} />);
    expect(screen.getByTestId("teaching-assessments-kept-in-cla")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("teaching-assessments-look-around"));
    expect(readExampleData().choice).toBe("on");
    expect(nav.refresh).toHaveBeenCalled();
  });
});
