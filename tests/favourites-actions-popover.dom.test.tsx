/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { type FavouriteItem } from "@/components/clinical-dashboard/favourites-command-library-page";
import { FavouriteActionsSheet } from "@/components/favourites/favourite-sheets";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));

const item: FavouriteItem = {
  id: "service:adult-community-mental-health",
  title: "Adult community mental health",
  description: "Service details",
  type: "Service",
  tabId: "services",
  set: "Unsorted",
  evidence: "Source-backed",
  lastUsed: "Never",
  openedAt: null,
  action: "Open",
  href: "/services/adult-community-mental-health",
  icon: FileText,
  contentType: "service",
  contentKey: "adult-community-mental-health",
  setId: null,
  sortOrder: 10,
};

describe("favourite row actions sheet", () => {
  it("uses dialog semantics and reaches Move in the natural tab sequence", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <FavouriteActionsSheet
        item={item}
        open
        onClose={vi.fn()}
        canMutate
        onOpen={vi.fn()}
        onTogglePin={vi.fn()}
        onCopyCitation={vi.fn(async () => true)}
        onMove={onMove}
        onRemove={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: /Actions for/ });
    expect(within(dialog).queryByRole("menu")).toBeNull();
    const pin = within(dialog).getByRole("button", { name: "Pin to My Day" });
    const move = within(dialog).getByRole("button", { name: /Move to a set/ });
    const copy = within(dialog).getByRole("button", { name: "Copy link with source" });
    pin.focus();
    await user.tab();
    expect(move).toHaveFocus();
    await user.tab();
    expect(copy).toHaveFocus();
    await user.click(move);
    expect(onMove).toHaveBeenCalledWith(item);
  });
});
