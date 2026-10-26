import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Answer, Patient details, therapy ranking, scoring and the originals need sign-in from
// 1 November 2026 (docs/decisions/2026-10-20-clinical-decision-tools-need-sign-in.md).

// A signed-in reader holds the current health professional declaration unless a test clears it
// (D26-07: the declaration moved to first open, before any clinical tool).
const auth = vi.hoisted(() => ({ status: "signed_out" as string, declared: true }));

vi.mock("@/lib/supabase/client", async () => {
  const { TERMS_VERSION } = await import("@/lib/front-door-content");
  const { TERMS_METADATA_KEY } = await import("@/lib/terms-acceptance");
  const session = () => ({
    user: {
      id: "synthetic-user",
      user_metadata: auth.declared
        ? { [TERMS_METADATA_KEY]: { version: TERMS_VERSION, acceptedAt: "2026-10-26T00:00:00.000Z" } }
        : {},
    },
  });
  return {
    useAuthSession: () => ({ status: auth.status, session: auth.status === "authenticated" ? session() : null }),
    useOptionalAuthSession: () => ({
      status: auth.status,
      session: auth.status === "authenticated" ? session() : null,
    }),
  };
});
vi.mock("@/components/clinical-dashboard/signed-image", () => ({
  SignedImage: () => <div data-testid="signed-image-stub" />,
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => <div role="dialog" aria-label="Continue to your workspace" />,
}));

import { PatientDetailsGate } from "@/components/clinical-dashboard/patient-details-gate";
import { PatientProfileProvider, usePatientProfile } from "@/components/clinical-dashboard/patient-profile-context";
import { CalculatorItems } from "@/components/calculators/calculator-ui";
import { CalculatorSheet } from "@/components/calculators/calculator-sheet";
import { calculators } from "@/components/calculators/calculator-fixtures";
import { useSignedOutSessionReset } from "@/components/calculators/use-signed-out-session-reset";
import { DocumentImage } from "@/components/document-viewer/source-panels";
import type { ImageRow } from "@/components/document-viewer/types";
import {
  clinicalToolAccessForSession,
  clinicalToolAccessForStatus,
  clinicalToolLocked,
} from "@/components/mode-kit/use-clinical-tool-access";
import {
  CLINICAL_DECLARATION_COPY,
  CLINICAL_SIGN_IN_COPY,
  CLINICAL_SIGN_IN_INVITE_NOTE,
  TERMS_VERSION,
} from "@/lib/front-door-content";
import { TERMS_METADATA_KEY, TERMS_PROMPT_REQUEST_EVENT } from "@/lib/terms-acceptance";
import { resetPatientProfile, writePatientProfile, EMPTY_PATIENT_PROFILE } from "@/lib/patient-profile-storage";

beforeEach(() => {
  window.sessionStorage.clear();
  resetPatientProfile();
});

afterEach(() => {
  cleanup();
  auth.status = "signed_out";
  auth.declared = true;
});

describe("clinicalToolAccessForStatus", () => {
  it("opens the tools to a signed-in user, demo mode and a bare render", () => {
    expect(clinicalToolAccessForStatus("authenticated")).toBe("allowed");
    expect(clinicalToolAccessForStatus("unconfigured")).toBe("allowed");
    expect(clinicalToolAccessForStatus(null)).toBe("allowed");
  });

  it("fails closed in a production build with no Supabase config unless it is a demo deploy (N-03)", () => {
    const previous = process.env.NEXT_PUBLIC_DEMO_MODE;
    try {
      delete process.env.NEXT_PUBLIC_DEMO_MODE;
      expect(clinicalToolAccessForStatus("unconfigured", "production")).toBe("sign-in-required");
      expect(clinicalToolAccessForStatus("authenticated", "production")).toBe("allowed");
      process.env.NEXT_PUBLIC_DEMO_MODE = "true";
      expect(clinicalToolAccessForStatus("unconfigured", "production")).toBe("allowed");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = previous;
    }
  });

  it("waits while the session loads and asks everyone else to sign in", () => {
    expect(clinicalToolAccessForStatus("loading")).toBe("checking");
    expect(clinicalToolAccessForStatus("signed_out")).toBe("sign-in-required");
    expect(clinicalToolAccessForStatus("expired")).toBe("sign-in-required");
    expect(clinicalToolAccessForStatus("error")).toBe("sign-in-required");
  });
});

describe("clinicalToolAccessForSession (D26-07)", () => {
  const declared = { [TERMS_METADATA_KEY]: { version: TERMS_VERSION, acceptedAt: "2026-10-26T00:00:00.000Z" } };

  it("holds a signed-in account at the declaration until its account record has the current version", () => {
    expect(clinicalToolAccessForSession("authenticated", declared)).toBe("allowed");
    expect(clinicalToolAccessForSession("authenticated", {})).toBe("declaration-required");
    expect(clinicalToolAccessForSession("authenticated", undefined)).toBe("declaration-required");
    expect(
      clinicalToolAccessForSession("authenticated", {
        [TERMS_METADATA_KEY]: { version: "2020-01-01", acceptedAt: "2020-01-01T00:00:00.000Z" },
      }),
    ).toBe("declaration-required");
  });

  it("leaves sign-in, loading, demo and bare renders as they were", () => {
    expect(clinicalToolAccessForSession("signed_out", declared)).toBe("sign-in-required");
    expect(clinicalToolAccessForSession("loading", undefined)).toBe("checking");
    expect(clinicalToolAccessForSession("unconfigured", undefined)).toBe("allowed");
    expect(clinicalToolAccessForSession(null, undefined)).toBe("allowed");
  });

  it("counts both refusals as locked", () => {
    expect(clinicalToolLocked("sign-in-required")).toBe(true);
    expect(clinicalToolLocked("declaration-required")).toBe(true);
    expect(clinicalToolLocked("checking")).toBe(false);
    expect(clinicalToolLocked("allowed")).toBe(false);
  });

  it("shows the declaration card, not Sign in, and its button reopens the Terms prompt", () => {
    auth.status = "authenticated";
    auth.declared = false;
    const opened = vi.fn();
    window.addEventListener(TERMS_PROMPT_REQUEST_EVENT, opened);
    try {
      render(
        <PatientDetailsGate>
          <p>patient form</p>
        </PatientDetailsGate>,
      );
      expect(screen.queryByText("patient form")).toBeNull();
      expect(screen.getByText(CLINICAL_DECLARATION_COPY.title)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: CLINICAL_DECLARATION_COPY.action }));
      expect(opened).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(TERMS_PROMPT_REQUEST_EVENT, opened);
    }
  });

  it("keeps scoring read-only for an account without the declaration", () => {
    auth.status = "authenticated";
    auth.declared = false;
    render(<CalculatorItems calc={calculators[0]!} answers={{}} onAnswersChange={vi.fn()} />);
    expect(screen.getByTestId("calculator-items-read-only")).toBeInTheDocument();
    expect(screen.getByText(CLINICAL_DECLARATION_COPY.title)).toBeInTheDocument();
  });
});

describe("Patient details", () => {
  it("shows the sign-in card in place of the form when signed out", () => {
    render(
      <PatientDetailsGate>
        <p>patient form</p>
      </PatientDetailsGate>,
    );
    expect(screen.queryByText("patient form")).toBeNull();
    expect(screen.getByText(CLINICAL_SIGN_IN_COPY.patientDetails.title)).toBeInTheDocument();
    expect(screen.getByText(CLINICAL_SIGN_IN_INVITE_NOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the form when signed in", () => {
    auth.status = "authenticated";
    render(
      <PatientDetailsGate>
        <p>patient form</p>
      </PatientDetailsGate>,
    );
    expect(screen.getByText("patient form")).toBeInTheDocument();
  });

  function ProfileProbe() {
    const { profile, isEmpty } = usePatientProfile();
    return <p data-testid="probe">{isEmpty ? "empty" : `age ${profile.ageYears}`}</p>;
  }

  it("gives every reader an empty profile while signed out, so no flag can show", () => {
    // Synthetic value; no patient data.
    writePatientProfile({ ...EMPTY_PATIENT_PROFILE, ageYears: 70 });
    const view = render(
      <PatientProfileProvider>
        <ProfileProbe />
      </PatientProfileProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("empty");
    auth.status = "authenticated";
    view.rerender(
      <PatientProfileProvider>
        <ProfileProbe />
      </PatientProfileProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("age 70");
  });

  it("exposes neither the stored profile nor the form while the session is still loading", () => {
    // Synthetic value; no patient data.
    writePatientProfile({ ...EMPTY_PATIENT_PROFILE, ageYears: 70 });
    auth.status = "loading";
    render(
      <PatientProfileProvider>
        <ProfileProbe />
        <PatientDetailsGate>
          <p>patient form</p>
        </PatientDetailsGate>
      </PatientProfileProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("empty");
    expect(screen.queryByText("patient form")).toBeNull();
  });
});

describe("Questionnaire scoring", () => {
  const calc = calculators[0]!;

  it("keeps the questions readable but offers no way to answer them when signed out", () => {
    const onAnswersChange = vi.fn();
    render(<CalculatorItems calc={calc} answers={{}} onAnswersChange={onAnswersChange} />);
    expect(screen.getByText(CLINICAL_SIGN_IN_COPY.scoring.title)).toBeInTheDocument();
    const list = screen.getByTestId("calculator-items-read-only");
    expect(list.querySelectorAll("li")).toHaveLength(calc.items.length);
    expect(screen.getByText(calc.items[0]!.text)).toBeInTheDocument();
    // The only button is Sign in.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Sign in"]);
  });

  it("clears earlier answers once signed out, so no previous score stays on screen", () => {
    Element.prototype.scrollTo = vi.fn();
    const onAnswersChange = vi.fn();
    const answers = { [calc.items[0]!.id]: 1 } as never;
    render(<CalculatorSheet calc={calc} answers={answers} onAnswersChange={onAnswersChange} onClose={vi.fn()} />);
    expect(onAnswersChange).toHaveBeenCalledWith({});
  });

  it("clears the page's whole answer session on sign-out, with no calculator open", () => {
    auth.status = "authenticated";
    const stored = { [calc.id]: { [calc.items[0]!.id]: 1 } } as Record<string, unknown>;
    const setSession = vi.fn();
    const { result, rerender } = renderHook(() => useSignedOutSessionReset(stored, setSession));
    expect(result.current).toBe(stored);
    expect(setSession).not.toHaveBeenCalled();

    auth.status = "signed_out";
    rerender();
    expect(result.current).toEqual({});
    expect(setSession).toHaveBeenCalledWith({});
  });

  it("lets a signed-in user answer", () => {
    auth.status = "authenticated";
    render(<CalculatorItems calc={calc} answers={{}} onAnswersChange={vi.fn()} />);
    expect(screen.queryByText(CLINICAL_SIGN_IN_COPY.scoring.title)).toBeNull();
    expect(screen.queryByTestId("calculator-items-read-only")).toBeNull();
  });
});

describe("Original figures and tables", () => {
  // Synthetic figure; only the fields the card reads.
  const figure = {
    id: "img-synthetic",
    page_number: 2,
    caption: "Synthetic figure",
    image_type: "figure",
    labels: [],
    width: 400,
    height: 300,
    source_kind: "figure",
  } as unknown as ImageRow;

  it("asks a signed-out reader to sign in instead of loading the image", () => {
    render(<DocumentImage image={figure} />);
    expect(screen.queryByTestId("signed-image-stub")).toBeNull();
    expect(screen.getByTestId("document-image-sign-in").textContent).toBe(`${CLINICAL_SIGN_IN_COPY.original.title}.`);
  });

  it("loads the image when signed in", () => {
    auth.status = "authenticated";
    render(<DocumentImage image={figure} />);
    expect(screen.getByTestId("signed-image-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("document-image-sign-in")).toBeNull();
  });
});
