/** @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { AssessmentsSampleGate } from "@/components/work-screens/assessments/assessments-sample-gate";
import { AssessmentsTraineeScreen } from "@/components/work-screens/assessments/assessments-screens";
import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";

const auth = vi.hoisted(() => ({ status: "loading", authEpoch: 0 }));
const redirect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ refresh: vi.fn() }) }));

function renderGate(demoMode = false) {
  return render(
    <AssessmentsSampleGate
      demoMode={demoMode}
      what="Assessments Export"
      render={() => <p data-testid="sample-page">Sample</p>}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
  auth.status = "loading";
  redirect.mockClear();
});

describe("Assessments example-only gate", () => {
  it("holds the page's space while the sign-in status is unknown, instead of flashing the not-connected notice", () => {
    renderGate();
    expect(screen.getByTestId("work-screens-assessments-gate-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("work-screens-assessments-not-kept")).toBeNull();
  });

  it("shows example records to a signed-out visitor, and where the records are kept once signed in", () => {
    auth.status = "signed_out";
    const { unmount } = renderGate();
    expect(screen.getByTestId("sample-page")).toBeInTheDocument();
    unmount();
    auth.status = "authenticated";
    renderGate();
    // Owner decision 7 Oct 2026: assessment records stay in CLA, so a signed-in doctor is told so and
    // is offered no look at the made-up records.
    expect(screen.getByTestId("teaching-assessments-kept-in-cla")).toHaveTextContent("Assessments are kept in CLA");
    expect(screen.getByTestId("teaching-assessments-open-cla")).toHaveAttribute(
      "href",
      "https://pmcwa.org.au/education-training/cla",
    );
    expect(screen.queryByTestId("example-only-gate-look")).toBeNull();
    expect(screen.queryByTestId("sample-page")).toBeNull();
  });

  it("never shows the made-up records signed in, even with the example data on, and follows the switch signed out", () => {
    auth.status = "authenticated";
    act(() => setExampleDataOn(true));
    const { unmount } = renderGate();
    expect(screen.getByTestId("teaching-assessments-kept-in-cla")).toBeInTheDocument();
    expect(screen.queryByTestId("sample-page")).toBeNull();
    unmount();
    auth.status = "signed_out";
    act(() => setExampleDataOn(false));
    renderGate();
    expect(screen.getByTestId("work-screens-assessments-not-kept")).toHaveTextContent(
      "Assessments Export is not connected yet",
    );
  });

  it("goes straight to the records in the demo, whatever the sign-in status", () => {
    renderGate(true);
    expect(screen.getByTestId("sample-page")).toBeInTheDocument();
  });

  it("reads the trainee view's example supervision from the shared registry, holding the space meanwhile", async () => {
    auth.status = "signed_out";
    render(
      <ToastProvider>
        <AssessmentsTraineeScreen demoMode={false} doctorId="sam" />
      </ToastProvider>,
    );
    expect(screen.getByTestId("assessments-trainee-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("assessments-trainee-confirm-example:sam-s3")).toBeInTheDocument();
  });
});

describe("older Assessments addresses", () => {
  it("land on the supervisor's views", async () => {
    const record = (await import("@/app/(search-app)/teaching/assessments/record/page")).default;
    await record({ searchParams: Promise.resolve({}) });
    await record({ searchParams: Promise.resolve({ tab: "history" }) });
    (await import("@/app/(search-app)/teaching/assessments/help/page")).default();
    (await import("@/app/(search-app)/teaching/assessments/trainee/page")).default();
    expect(redirect.mock.calls.map((call) => call[0])).toEqual([
      "/teaching/assessments?view=record&as=supervisor",
      "/teaching/assessments?view=all&as=supervisor",
      "/teaching/assessments?view=words&as=supervisor",
      "/teaching/assessments?view=overview&as=supervisor",
    ]);
  });
});
