import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/specifiers/builder",
  useSearchParams: () => new URLSearchParams(),
}));

import { SpecifierBuilderPage } from "@/components/specifiers/specifier-builder-page";
import { builderCatalogGroups, catalogDiagnosisId } from "@/lib/specifier-builder-diagnoses";

// The catalogue option inputs set `aria-label`, which overrides the surrounding
// label's descendant text. Without an explicit description the review badge would be
// visible but silent, which defeats the point of showing it at the moment of choosing.
describe("catalogue option review status", () => {
  it("reaches assistive tech through the control's description, not only the badge", async () => {
    const user = userEvent.setup();
    render(<SpecifierBuilderPage />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Diagnostic phrase" }),
      catalogDiagnosisId("ndv", "Autism Spectrum Disorder"),
    );

    const group = builderCatalogGroups(catalogDiagnosisId("ndv", "Autism Spectrum Disorder")).find(
      (candidate) => candidate.label === "Severity",
    )!;
    await user.click(screen.getByRole("button", { name: new RegExp(`Step \\d+ of \\d+: ${group.label}`) }));

    for (const item of group.items) {
      const control = screen.getByRole("radio", { name: item.label });
      const describedBy = control.getAttribute("aria-describedby");
      expect(describedBy).toBe(`${item.slug}-review-status`);
      expect(document.getElementById(describedBy!)?.textContent).toMatch(
        /Review due|Source checked, not signed off|Source n\/a/,
      );
    }
  });
});
