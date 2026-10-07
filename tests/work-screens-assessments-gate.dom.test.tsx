/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssessmentsSampleGate } from "@/components/work-screens/assessments/assessments-sample-gate";

const auth = vi.hoisted(() => ({ status: "loading", authEpoch: 0 }));
const redirect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("next/navigation", () => ({ redirect }));

function renderGate(demoMode = false) {
  return render(<AssessmentsSampleGate demoMode={demoMode} render={() => <p data-testid="sample-page">Sample</p>} />);
}

beforeEach(() => {
  auth.status = "loading";
  redirect.mockClear();
});

describe("Assessments made-up records gate", () => {
  it("holds the page's space while the sign-in status is unknown, instead of flashing the signed-in notice", () => {
    renderGate();
    expect(screen.getByTestId("work-screens-assessments-gate-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("work-screens-assessments-not-kept")).toBeNull();
  });

  it("shows made-up records to a signed-out visitor, and offers them to a signed-in doctor", () => {
    auth.status = "signed_out";
    const { unmount } = renderGate();
    expect(screen.getByTestId("sample-page")).toBeInTheDocument();
    unmount();
    auth.status = "authenticated";
    renderGate();
    expect(screen.getByTestId("work-screens-assessments-not-kept")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("work-screens-assessments-try"));
    expect(screen.getByTestId("sample-page")).toBeInTheDocument();
  });

  it("goes straight to the records in the demo, whatever the sign-in status", () => {
    renderGate(true);
    expect(screen.getByTestId("sample-page")).toBeInTheDocument();
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
