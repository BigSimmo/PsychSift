// The rendered half of "a high-risk medicine never reads green without a coverage
// review" (owner decision 26 Oct 2026). `medication-interactions-high-risk-coverage.test.ts`
// pins the verdict; this pins that the empty interaction block is not green and says why.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { MedicationConsiderations } from "@/components/clinical-dashboard/medication-considerations";
import { PatientProfileProvider } from "@/components/clinical-dashboard/patient-profile-context";
import { toneSuccess } from "@/components/primitive-recipes/recipes";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import { PATIENT_PROFILE_STORAGE_KEY } from "@/lib/patient-profile-storage";
import type { MedicationRecord } from "@/lib/medications";

function renderConsiderations(slug: string, medications: string[]) {
  window.sessionStorage.setItem(PATIENT_PROFILE_STORAGE_KEY, JSON.stringify({ medications }));
  render(
    <PatientProfileProvider>
      <MedicationConsiderations record={getMedicationRecord(slug) as MedicationRecord} />
    </PatientProfileProvider>,
  );
}

function noInteractionNotice() {
  const text = screen.getByText(/No interaction found between this medication/i);
  return text.closest("[role]") as HTMLElement;
}

const successClass = toneSuccess.split(/\s+/).filter(Boolean)[0] as string;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("unreviewed high-risk interaction notice", () => {
  it.each([
    ["lithium-carbonate-ir-sr", "carbamazepine", /Lithium/],
    ["carbamazepine", "lithium-carbonate-ir-sr", /Lithium/],
    ["sertraline", "lithium-carbonate-ir-sr", /Lithium/],
    ["paracetamol", "phenelzine", /Phenelzine/],
  ])("viewing %s with %s is not shown as clear", (viewed, entered, name) => {
    renderConsiderations(viewed, [entered]);
    expect(noInteractionNotice().className).not.toContain(successClass);
    const notice = screen.getByTestId("unreviewed-high-risk-interactions");
    expect(notice.textContent).toMatch(name);
    expect(notice.textContent).toMatch(/not reviewed for this pairing\. Check the source\./);
  });

  it("stays silent, and green, for an ordinary pair", () => {
    renderConsiderations("sertraline", ["acamprosate"]);
    expect(screen.queryByTestId("unreviewed-high-risk-interactions")).not.toBeInTheDocument();
    expect(noInteractionNotice().className).toContain(successClass);
  });
});
