import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forms/extension-transport-order",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

import { FormDetailPage } from "@/components/forms/form-detail-page";
import { formRecords } from "@/lib/forms";

// Design audit D-16: the Pathway / Source info tabs followed the tab role without its keys,
// and pointed aria-controls at a panel that was not rendered.
describe("form decision context tabs", () => {
  const form = formRecords.find((record) => record.slug === "extension-transport-order") ?? formRecords[0];

  it("moves between tabs with the arrow keys and only points at the panel that exists", () => {
    render(<FormDetailPage form={form} />);
    // The page draws the context card for phone and desktop; each copy behaves the same.
    const tablist = screen.getAllByRole("tablist", { name: "Decision context sections" })[0];
    const pathway = within(tablist).getByRole("tab", { name: "Pathway" });
    const source = within(tablist).getByRole("tab", { name: "Source info" });
    expect(pathway).toHaveAttribute("tabindex", "0");
    expect(source).toHaveAttribute("tabindex", "-1");
    expect(source).not.toHaveAttribute("aria-controls");
    expect(document.getElementById(pathway.getAttribute("aria-controls") ?? "")).not.toBeNull();

    fireEvent.keyDown(pathway, { key: "ArrowRight" });

    expect(source).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(source);
    expect(document.getElementById(source.getAttribute("aria-controls") ?? "")).not.toBeNull();

    fireEvent.keyDown(source, { key: "Home" });
    expect(pathway).toHaveAttribute("aria-selected", "true");
  });

  it("links to the official source when one is recorded", () => {
    render(<FormDetailPage form={form} />);
    const card = screen.getByTestId("form-decision-context-desktop");
    expect(within(card).getByRole("link", { name: /Open official source \/ pathway/ })).toHaveAttribute("href");
  });

  it("offers a disabled control, never a link without href, when no source URL is recorded", () => {
    const withoutSource = { ...form, source: form.source ? { ...form.source, url: undefined } : form.source };
    withoutSource.catalogPayload = undefined;
    render(<FormDetailPage form={withoutSource} />);
    const card = screen.getByTestId("form-decision-context-desktop");

    expect(within(card).queryByRole("link", { name: /Open official source/ })).toBeNull();
    expect(card.querySelector("a:not([href])")).toBeNull();
    const control = within(card).getByRole("button", { name: /Open official source \/ pathway/ });
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAccessibleDescription("No official source URL is recorded for this form.");
  });
});
