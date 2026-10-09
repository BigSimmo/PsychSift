/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "signed_out", authEpoch: 0 }) }));

import { AssessmentsExportPage } from "@/components/work-screens/assessments/assessments-export-page";
import { initialAssessmentsState } from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR } from "@/lib/teaching/assessments/sample";
import { EXAMPLE_NOT_SAVED, exportDoctors } from "@/lib/work-screens/assessments/export";

describe("Assessments export", () => {
  it("never offers to save made-up records, and says why", () => {
    render(<AssessmentsExportPage />);
    expect(screen.queryByTestId("assessments-export-save")).toBeNull();
    expect(screen.getByTestId("assessments-export-blocker")).toHaveTextContent(EXAMPLE_NOT_SAVED);
  });

  it("lists your own doctors only", () => {
    render(<AssessmentsExportPage />);
    const chips = within(screen.getByRole("group", { name: "Doctors" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    const names = exportDoctors(initialAssessmentsState()).map((d) => d.name);
    expect(names).toHaveLength(3);
    expect(chips).toEqual(["All", ...names]);
  });

  it("explains a doctor with no forms here, and keeps every link in the supervisor's view", () => {
    render(<AssessmentsExportPage />);
    fireEvent.click(screen.getByTestId("assessments-export-doctor-ben"));
    expect(screen.getByTestId("assessments-export-no-forms")).toHaveTextContent(
      `This sample holds signed forms for ${SAMPLE_DOCTOR.name} only.`,
    );
    fireEvent.click(screen.getByTestId("assessments-export-doctor-all"));
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").toContain("as=supervisor");
    }
  });

  it("says the real form is signed off in CLA, and leaves registrar supervision hours out", () => {
    render(<AssessmentsExportPage />);
    const page = screen.getByTestId("assessments-export-page");
    expect(page).toHaveTextContent("The real form is completed and signed off in CLA.");
    expect(page).not.toHaveTextContent(/email/i);
    expect(page).not.toHaveTextContent(/supervision hours/i);
    expect(screen.queryByRole("link", { name: /supervision hours/i })).toBeNull();
  });

  it("asks for a choice when nothing is included", () => {
    render(<AssessmentsExportPage />);
    for (const id of ["forms", "epas", "status"]) fireEvent.click(screen.getByTestId(`assessments-export-${id}`));
    expect(screen.getByTestId("assessments-export-forms")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("assessments-export-blocker")).toHaveTextContent("Choose what to include.");
    expect(screen.queryByTestId("assessments-export-form-list")).toBeNull();
  });
});
