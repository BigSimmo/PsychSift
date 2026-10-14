import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forms/test-form",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

import { FormDetailPage } from "@/components/forms/form-detail-page";
import { getFormRecord } from "@/lib/forms";

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

// Adoption evidence: these form assertions exercise DisclosureGroup.items[].extendDescription.
describe("Form information disclosures", () => {
  it("says plainly that the app does not fill in, sign or submit the form", () => {
    const form = getFormRecord("form-1a");
    expect(form).toBeTruthy();
    if (!form) return;
    render(<FormDetailPage form={form} />);
    expect(screen.getByTestId("form-product-boundary")).toHaveTextContent(/does not fill in, sign or submit this form/);
  });

  it("expands a tick row to reveal the full information content", async () => {
    const user = userEvent.setup();
    const form = getFormRecord("form-1a");
    expect(form).toBeTruthy();
    if (!form) return;

    const doesNotAuthorise = form.referralInfo?.find((row) => row.label === "Does not authorise");
    const fullText = doesNotAuthorise?.value;
    expect(fullText).toEqual(expect.any(String));
    if (!fullText) return;

    render(<FormDetailPage form={form} />);

    const section = screen.getByRole("region", { name: "Form information" });
    const trigger = within(section).getByRole("button", { name: "Does not authorise" });
    expect(trigger).toHaveAccessibleName("Does not authorise");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("data-state", "collapsed");

    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toEqual(expect.any(String));
    if (!panelId) return;
    const panel = document.getElementById(panelId);
    expect(panel).toBeTruthy();
    if (!panel) return;
    expect(panel).toHaveAttribute("data-state", "collapsed");
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel).toHaveClass("hidden", "print:block");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("data-state", "expanded");
    expect(panel).toHaveAttribute("data-state", "expanded");
    expect(within(trigger).queryByText(fullText)).not.toBeInTheDocument();
    expect(panel).not.toHaveClass("hidden");
    expect(panel).not.toHaveClass("border-t");
    expect(within(panel).getByText(fullText)).toBeVisible();
  });

  it("keeps duplicate labels on independent disclosure triggers", async () => {
    const user = userEvent.setup();
    const base = getFormRecord("form-1a");
    expect(base).toBeTruthy();
    if (!base) return;

    const form = {
      ...base,
      referralInfo: [
        { label: "Clinical note", value: "First clinical detail" },
        { label: "Clinical note", value: "Second clinical detail" },
      ],
    };

    render(<FormDetailPage form={form} />);

    const section = screen.getByRole("region", { name: "Form information" });
    const triggers = within(section).getAllByRole("button", { name: "Clinical note" });
    expect(triggers).toHaveLength(2);

    const panelIds = triggers.map((trigger) => trigger.getAttribute("aria-controls"));
    expect(panelIds.every((id) => Boolean(id))).toBe(true);
    expect(new Set(panelIds).size).toBe(2);

    await user.click(triggers[0]);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "true");
    expect(triggers[1]).toHaveAttribute("aria-expanded", "false");

    const firstPanel = document.getElementById(panelIds[0]!);
    expect(firstPanel).toBeTruthy();
    if (!firstPanel) return;
    expect(firstPanel).not.toHaveClass("hidden");
    expect(within(firstPanel).getByText("First clinical detail")).toBeVisible();

    await user.click(triggers[1]);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "true");
    expect(triggers[1]).toHaveAttribute("aria-expanded", "true");
    const secondPanel = document.getElementById(panelIds[1]!);
    expect(secondPanel).toBeTruthy();
    if (!secondPanel) return;
    expect(within(secondPanel).getByText("Second clinical detail")).toBeVisible();
  });
});
