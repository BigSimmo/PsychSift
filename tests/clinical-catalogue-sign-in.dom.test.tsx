import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// #3728: library search, medicines and differentials need sign-in from 1 November 2026.
// A signed-out reader sees the sign-in card, not a screen whose requests would be refused.

const auth = vi.hoisted(() => ({ status: "signed_out" as string }));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: auth.status }),
  useOptionalAuthSession: () => ({ status: auth.status }),
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => <div role="dialog" aria-label="Continue to your workspace" />,
}));

import { ClinicalCatalogueGate } from "@/components/mode-kit/clinical-catalogue-gate";
import { CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";

afterEach(() => {
  cleanup();
  auth.status = "signed_out";
});

describe.each([
  ["medicines", CLINICAL_SIGN_IN_COPY.medicines, "medications-sign-in"],
  ["differentials", CLINICAL_SIGN_IN_COPY.differentials, "differentials-sign-in"],
  ["library", CLINICAL_SIGN_IN_COPY.library, "library-sign-in"],
] as const)("%s gate", (_name, copy, testId) => {
  function renderGate() {
    return render(
      <ClinicalCatalogueGate copy={copy} testId={testId}>
        <div data-testid="catalogue-screen">screen</div>
      </ClinicalCatalogueGate>,
    );
  }

  it("shows the sign-in card in place of the screen when signed out", () => {
    renderGate();
    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(screen.queryByTestId("catalogue-screen")).toBeNull();
  });

  it("renders nothing while the session is loading, so no refused request is sent", () => {
    auth.status = "loading";
    renderGate();
    expect(screen.queryByTestId(testId)).toBeNull();
    expect(screen.queryByTestId("catalogue-screen")).toBeNull();
  });

  it.each(["authenticated", "unconfigured"])("shows the screen when the session is %s", (status) => {
    auth.status = status;
    renderGate();
    expect(screen.getByTestId("catalogue-screen")).toBeTruthy();
    expect(screen.queryByTestId(testId)).toBeNull();
  });
});

describe("sign-in copy", () => {
  it("no longer promises signed-out access to library search or medicine records", () => {
    expect(CLINICAL_SIGN_IN_COPY.answer.stillOpen).not.toMatch(/still show/i);
    expect(CLINICAL_SIGN_IN_COPY.patientDetails.stillOpen).not.toMatch(/stays open/i);
  });
});
