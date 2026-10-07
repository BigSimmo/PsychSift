/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "signed_out", authEpoch: 0 }) }));

import { AssessmentsExportPage } from "@/components/work-screens/assessments/assessments-export-page";
import { initialAssessmentsState } from "@/lib/teaching/assessments/model";
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
    expect(screen.getByTestId("assessments-export-no-forms")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("assessments-export-doctor-all"));
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      expect(href === "/teaching/supervision" || href.includes("as=supervisor")).toBe(true);
    }
  });

  it("asks for a choice when nothing is included", () => {
    render(<AssessmentsExportPage />);
    for (const id of ["forms", "epas", "status"]) fireEvent.click(screen.getByTestId(`assessments-export-${id}`));
    expect(screen.getByTestId("assessments-export-forms")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("assessments-export-blocker")).toHaveTextContent("Choose what to include.");
    expect(screen.queryByTestId("assessments-export-form-list")).toBeNull();
  });
});
