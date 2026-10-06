/** @vitest-environment jsdom */

// Opening a medicine page notes it for the Medicines hub's "Recent" list, by
// slug and name only, and only while "Save recent searches" is on.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MedicationRecordPage } from "@/components/clinical-dashboard/medication-record-page";
import { clearMedicineVisits, readMedicineVisits } from "@/lib/medicines-recent";
import type { MedicationRecord } from "@/lib/medications";

vi.mock("next/navigation", () => ({
  usePathname: () => "/medications/lithium",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));
const { useMedicationDetail } = vi.hoisted(() => ({ useMedicationDetail: vi.fn() }));
vi.mock("@/components/clinical-dashboard/use-medication-catalog", () => ({ useMedicationDetail }));
const prefs = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ canRecordRecentSearches: prefs.allowed }),
  mayRecordRecentSearches: () => prefs.allowed,
}));
vi.mock("@/components/clinical-dashboard/patient-profile-panel", () => ({ PatientProfilePanel: () => null }));
vi.mock("@/components/clinical-dashboard/medication-considerations", () => ({
  MedicationConsiderations: () => null,
  MedicationInteractionCallout: () => null,
}));

const lithium: MedicationRecord = {
  slug: "lithium",
  name: "Lithium carbonate",
  class: "Mood stabiliser",
  subclass: "",
  category: "",
  accent: "",
  tag: "",
  schedule: "",
  stats: [],
  sections: [],
  quick: [],
};

afterEach(() => {
  cleanup();
  clearMedicineVisits();
  prefs.allowed = true;
});

describe("MedicationRecordPage recent recording", () => {
  it("records the opened medicine by slug and name", () => {
    useMedicationDetail.mockReturnValue({ data: { record: lithium }, loading: false, error: null, notFound: false });
    render(<MedicationRecordPage slug="lithium" fallbackRecord={lithium} />);
    expect(readMedicineVisits().map(({ slug, name }) => ({ slug, name }))).toEqual([
      { slug: "lithium", name: "Lithium carbonate" },
    ]);
  });

  it("records nothing while Save recent searches is off, or when the page failed", () => {
    prefs.allowed = false;
    useMedicationDetail.mockReturnValue({ data: { record: lithium }, loading: false, error: null, notFound: false });
    render(<MedicationRecordPage slug="lithium" fallbackRecord={lithium} />);
    expect(readMedicineVisits()).toEqual([]);
    cleanup();

    prefs.allowed = true;
    useMedicationDetail.mockReturnValue({
      data: null,
      loading: false,
      error: "Request failed (503)",
      notFound: false,
      retry: vi.fn(),
    });
    render(<MedicationRecordPage slug="lithium" />);
    expect(readMedicineVisits()).toEqual([]);
  });
});
