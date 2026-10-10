/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MedicationDetail } from "@/components/medications/medication-detail";
import type { MedicationRecord } from "@/lib/medications";

vi.mock("next/navigation", () => ({
  usePathname: () => "/medications/test-med",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

const { useMedicationDetail } = vi.hoisted(() => ({ useMedicationDetail: vi.fn() }));
vi.mock("@/components/clinical-dashboard/use-medication-catalog", () => ({ useMedicationDetail }));
vi.mock("@/components/clinical-dashboard/patient-profile-panel", () => ({
  PatientProfilePanel: () => <p>patient-profile-panel</p>,
}));
vi.mock("@/components/clinical-dashboard/medication-considerations", () => ({
  MedicationConsiderations: () => <p>medication-considerations</p>,
  MedicationInteractionCallout: () => <p>medication-interaction-callout</p>,
}));

const sampleMed: MedicationRecord = {
  slug: "test-med",
  name: "Test Medication",
  class: "Antidepressant",
  subclass: "SSRI",
  category: "Mood",
  accent: "#0f766e",
  tag: "",
  schedule: "S4",
  stats: [
    { label: "Max Dose", value: "200 mg/day", cls: "hi", flag: "hi" },
    { label: "Half-life", value: "24 h" },
  ],
  quick: [{ label: "Usual Dose & Max", value: "50-100 mg daily. Max 200 mg/day." }],
  sections: [
    {
      title: "Rapid Summary",
      type: "summary",
      rows: [
        { key: "Indication", val: "Major depressive disorder" },
        { key: "Maximum Dose", val: "Max 200 mg/day (do not exceed)." },
      ],
    },
    {
      title: "Dosing & Administration",
      type: "dose",
      rows: [{ key: "Initial dose", val: "50 mg daily." }],
    },
  ],
};

describe("Medication detail max dose deduplication (#J7RV8Q)", () => {
  it("renders Max Dose in key figures and quick reference, but deduplicates the duplicate row in summary section", () => {
    useMedicationDetail.mockReturnValue({
      data: { record: sampleMed, governance: null },
      loading: false,
      error: null,
      notFound: false,
    });
    render(<MedicationDetail slug="test-med" fallbackRecord={sampleMed} />);

    // 1. Appears in Key figures hero metrics
    const figures = screen.getAllByTestId("medication-figure");
    expect(figures.some((f) => f.textContent?.includes("Max Dose"))).toBe(true);

    // 2. Appears in Quick Reference sidebar
    expect(screen.getByText("Usual Dose & Max")).toBeInTheDocument();

    // 3. Deduplicated from Rapid Summary card (no duplicate "Maximum Dose" row)
    const summaryPanel = document.getElementById("medication-panel-summary");
    expect(summaryPanel).toBeInTheDocument();
    if (summaryPanel) {
      expect(within(summaryPanel).getByText("Indication")).toBeInTheDocument();
      expect(within(summaryPanel).queryByText("Maximum Dose")).not.toBeInTheDocument();
    }
  });

  it("also deduplicates when row key is labelled 'Max Dose'", () => {
    const medWithMaxDoseRow: MedicationRecord = {
      ...sampleMed,
      sections: [
        {
          title: "Rapid Summary",
          type: "summary",
          rows: [
            { key: "Indication", val: "Major depressive disorder" },
            { key: "Max Dose", val: "200 mg/day" },
          ],
        },
      ],
    };
    useMedicationDetail.mockReturnValue({
      data: { record: medWithMaxDoseRow, governance: null },
      loading: false,
      error: null,
      notFound: false,
    });
    render(<MedicationDetail slug="test-med" fallbackRecord={medWithMaxDoseRow} />);

    const summaryPanel = document.getElementById("medication-panel-summary");
    expect(summaryPanel).toBeInTheDocument();
    if (summaryPanel) {
      expect(within(summaryPanel).getByText("Indication")).toBeInTheDocument();
      expect(within(summaryPanel).queryByText("Max Dose")).not.toBeInTheDocument();
    }
  });
});
