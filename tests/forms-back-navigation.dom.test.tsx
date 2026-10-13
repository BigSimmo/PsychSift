import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormDetailPage } from "@/components/forms/form-detail-page";
import { formRecords } from "@/lib/forms";
import { withTopBarLeadingSlot } from "./helpers/top-bar-slot";

vi.mock("next/navigation", () => ({
  usePathname: () => "/forms/transport-crisis-form",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

describe("Form detail back navigation", () => {
  withTopBarLeadingSlot();

  it("links to the canonical Forms home with focus", () => {
    render(<FormDetailPage form={formRecords[0]} />);
    const back = screen.getByRole("link", { name: /Forms/i });
    expect(back).toHaveAttribute("href", "/?mode=forms&focus=1");
  });
});
