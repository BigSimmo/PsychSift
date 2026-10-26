// The rendered half of the "silence is not an all-clear" guard.
//
// `medication-interactions.test.ts` pins that an entered drug outside the
// resolved interaction graph keeps the verdict off green. That is worth nothing if the reason never
// reaches the screen: the clinician sees an empty interaction block either way,
// and an empty block reads as reassurance. These cases pin that the reason is
// stated, and — just as important — that it is NOT stated for a drug the corpus
// does cover, because a warning shown on every medication is one nobody reads.
//
// Targets `MedicationConsiderations`, not `MedicationInteractionCallout`. The
// callout is the compact disclosure and returns null at zero interactions by
// design, which is precisely the case this notice covers; the always-rendered
// considerations section is where it belongs.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { MedicationConsiderations } from "@/components/clinical-dashboard/medication-considerations";
import { PatientProfileProvider } from "@/components/clinical-dashboard/patient-profile-context";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import { PATIENT_PROFILE_STORAGE_KEY } from "@/lib/patient-profile-storage";
import type { MedicationRecord } from "@/lib/medications";

function renderConsiderations(medications: string[], slug = "sertraline") {
  window.sessionStorage.setItem(PATIENT_PROFILE_STORAGE_KEY, JSON.stringify({ medications }));
  const record = getMedicationRecord(slug) as MedicationRecord;
  render(
    <PatientProfileProvider>
      <MedicationConsiderations record={record} />
    </PatientProfileProvider>,
  );
}

const NOTICE = /no machine-resolved interaction involving/i;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("unreachable-counterparty notice", () => {
  it("says so when an entered medication is outside the resolved interaction graph", () => {
    // Zolpidem is one of 20 catalogue drugs outside every resolved edge.
    renderConsiderations(["zolpidem"]);

    const notice = screen.getByText(NOTICE);
    expect(notice.textContent).toMatch(/Zolpidem/);
    // The wording has to deny the inference, not merely report the gap.
    expect(notice.textContent).toMatch(/not evidence of safety/i);
  });

  it("names every uncovered medication, not just the first", () => {
    renderConsiderations(["zolpidem", "finasteride"]);
    const notice = screen.getByText(NOTICE);
    expect(notice.textContent).toMatch(/Zolpidem/);
    expect(notice.textContent).toMatch(/Finasteride/);
    expect(notice.textContent).toMatch(/they were/);
  });

  it("stays silent for a medication the corpus does cover", () => {
    renderConsiderations(["tramadol-ir"]);
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("does not present an empty interaction block as clear when a drug is uncheckable", () => {
    // The failure this exists for: zero interactions rendered as a green
    // "No interaction found" with nothing qualifying it.
    renderConsiderations(["zolpidem"]);
    expect(screen.getByText(/No interaction found between this medication/i)).toBeInTheDocument();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });
});

describe("no-interaction-data notice", () => {
  // A slug the interaction index has no entry for, so `dataAvailable` is false.
  const uncatalogued: MedicationRecord = {
    ...(getMedicationRecord("sertraline") as MedicationRecord),
    slug: "zz-uncatalogued-test-med",
    name: "Uncatalogued Test Med",
  };

  function renderUncatalogued(medications: string[]) {
    window.sessionStorage.setItem(PATIENT_PROFILE_STORAGE_KEY, JSON.stringify({ medications }));
    render(
      <PatientProfileProvider>
        <MedicationConsiderations record={uncatalogued} />
      </PatientProfileProvider>,
    );
  }

  it("says it once, without naming an entered list, when no list is entered", () => {
    renderUncatalogued([]);
    expect(screen.getAllByText(/carries no interaction data for this medication/i)).toHaveLength(1);
    expect(screen.queryByText(/against the entered list/i)).not.toBeInTheDocument();
  });

  it("keeps the not-shown-as-clear notice when a list is entered", () => {
    renderUncatalogued(["tramadol-ir"]);
    expect(screen.getByText(/nothing could be cross-checked against the entered list/i)).toBeInTheDocument();
  });
});
