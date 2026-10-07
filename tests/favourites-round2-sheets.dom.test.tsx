/** @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText, Phone } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArrangeShelfSheet, CustomiseFavouritesSheet } from "@/components/favourites/customise-favourites-sheet";
import { EditFavouriteSheet } from "@/components/favourites/edit-favourite-sheet";
import { numberToItem } from "@/components/favourites/favourite-items";
import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import { NumberActionsSheet, NumberFormSheet } from "@/components/favourites/number-sheets";
import {
  addSavedNumber,
  loadFavouritesLocal,
  resetFavouritesLocalForTesting,
  setFavouriteOverride,
  type SavedNumber,
} from "@/lib/favourites/favourites-local";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));

function clinicalItem(id: string, title: string, extra: Partial<FavouriteItem> = {}): FavouriteItem {
  return {
    id,
    title,
    description: "",
    type: "Form",
    tabId: "forms",
    set: "Unsorted",
    evidence: "",
    lastUsed: "Saved",
    openedAt: null,
    action: "Open",
    href: `/forms/${id}`,
    icon: FileText,
    ...extra,
  };
}

function savedNumber(): SavedNumber {
  const result = addSavedNumber({ label: "Psych liaison pager", number: "6457 2210", note: "Ask for the registrar" });
  if (!result.ok) throw new Error("seed failed");
  return loadFavouritesLocal().numbers.find((entry) => entry.id === result.id)!;
}

beforeEach(() => {
  localStorage.clear();
  resetFavouritesLocalForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NumberFormSheet", () => {
  it("shows the field problems on save and saves nothing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NumberFormSheet open onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Add a number" })).toBeTruthy();
    expect(screen.queryAllByTestId("field-error")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Save number" }));
    expect(screen.getByText("Give it a name, such as Ward 4B or Pharmacy.")).toBeTruthy();
    expect(screen.getByText("Add the number.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(loadFavouritesLocal().numbers).toHaveLength(0);

    await user.type(screen.getByLabelText(/^Number/), "abc");
    expect(screen.getByText("Use digits, with spaces or brackets if you like.")).toBeTruthy();
  });

  it("shows a problem after a field is left", async () => {
    const user = userEvent.setup();
    render(<NumberFormSheet open onClose={vi.fn()} />);
    await user.click(screen.getByLabelText(/^Name/));
    expect(screen.queryByText("Give it a name, such as Ward 4B or Pharmacy.")).toBeNull();
    await user.tab();
    expect(screen.getByText("Give it a name, such as Ward 4B or Pharmacy.")).toBeTruthy();
  });

  it("blocks a patient's details as a name", async () => {
    const user = userEvent.setup();
    render(<NumberFormSheet open onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Name/), "Mr J Smith bed 4");
    await user.type(screen.getByLabelText(/^Number/), "6457 2210");
    await user.click(screen.getByRole("button", { name: "Save number" }));
    expect(screen.getByText(/looks like a patient's details/)).toBeTruthy();
    expect(loadFavouritesLocal().numbers).toHaveLength(0);
  });

  it("adds a number, pinned when asked, and reports its id", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<NumberFormSheet open onClose={onClose} onSaved={onSaved} />);
    const numberField = screen.getByLabelText(/^Number/);
    expect(numberField.getAttribute("type")).toBe("tel");
    expect(numberField.getAttribute("inputmode")).toBe("tel");
    await user.type(screen.getByLabelText(/^Name/), "Ward 4B");
    await user.type(numberField, "08 9224 (2104)");
    await user.type(screen.getByLabelText(/^Note/), "Nurse in charge");
    await user.click(screen.getByRole("switch", { name: "Pin to My Day" }));
    await user.click(screen.getByRole("button", { name: "Save number" }));

    const [saved] = loadFavouritesLocal().numbers;
    expect(saved).toMatchObject({ label: "Ward 4B", number: "08 9224 (2104)", note: "Nurse in charge" });
    expect(saved!.pinnedAt).not.toBeNull();
    expect(onSaved).toHaveBeenCalledWith(saved!.id);
    expect(onClose).toHaveBeenCalled();
  });

  it("turns Pin to My Day off, and says why, when My Day holds four pins", async () => {
    const user = userEvent.setup();
    render(<NumberFormSheet open onClose={vi.fn()} pinRoom={false} />);
    const pin = screen.getByRole("switch", { name: /^Pin to My Day/ });
    expect(pin).toBeDisabled();
    expect(pin).toHaveAttribute("aria-checked", "false");
    expect(pin).toHaveAccessibleDescription("My Day holds four pins. Unpin one first.");
    await user.type(screen.getByLabelText(/^Name/), "Ward 4B");
    await user.type(screen.getByLabelText(/^Number/), "9224 2104");
    await user.click(screen.getByRole("button", { name: "Save number" }));
    expect(loadFavouritesLocal().numbers[0]!.pinnedAt).toBeNull();
  });

  it("edits an existing number", async () => {
    const user = userEvent.setup();
    const entry = savedNumber();
    render(<NumberFormSheet open onClose={vi.fn()} editing={entry} />);
    expect(screen.getByRole("dialog", { name: "Edit number" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Pin to My Day" })).toBeNull();
    const name = screen.getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Liaison pager");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(loadFavouritesLocal().numbers[0]!.label).toBe("Liaison pager");
  });

  it("gives a quiet reminder for a mobile, without blocking it", async () => {
    const user = userEvent.setup();
    render(<NumberFormSheet open onClose={vi.fn()} />);
    expect(screen.queryByTestId("number-mobile-warning")).toBeNull();
    await user.type(screen.getByLabelText(/^Name/), "Registrar on call");
    await user.type(screen.getByLabelText(/^Number/), "0412 555 018");
    expect(screen.getByTestId("number-mobile-warning").textContent).toBe(
      "Mobiles usually belong to a person. Save work numbers only.",
    );
    await user.click(screen.getByRole("button", { name: "Save number" }));
    expect(loadFavouritesLocal().numbers).toHaveLength(1);
  });

  it("says when the phone is full", async () => {
    const user = userEvent.setup();
    for (let index = 0; index < 40; index += 1) addSavedNumber({ label: `Ward ${index}`, number: "6457 2210" });
    render(<NumberFormSheet open onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Name/), "Pharmacy");
    await user.type(screen.getByLabelText(/^Number/), "6457 2211");
    await user.click(screen.getByRole("button", { name: "Save number" }));
    expect(screen.getByTestId("number-form-error").textContent).toContain("You can keep 40 numbers. Remove one first.");
  });
});

describe("NumberActionsSheet", () => {
  it("calls through a tel link and records the open", async () => {
    const user = userEvent.setup();
    const entry = savedNumber();
    const item = numberToItem(entry);
    render(
      <NumberActionsSheet item={item} onClose={vi.fn()} onEdit={vi.fn()} onTogglePin={vi.fn()} onRemove={vi.fn()} />,
    );
    const call = screen.getByRole("link", { name: /Call 6457 2210/ });
    expect(call.getAttribute("href")).toBe("tel:64572210");
    call.addEventListener("click", (event) => event.preventDefault());
    await user.click(call);
    expect(loadFavouritesLocal().numbers[0]!.openedAt).not.toBeNull();
    expect(screen.getByText("Ask for the registrar")).toBeTruthy();
  });

  it("explains when a number cannot be called", () => {
    const item: FavouriteItem = { ...clinicalItem("number:x", "Odd"), type: "Number", phone: "12", icon: Phone };
    render(
      <NumberActionsSheet item={item} onClose={vi.fn()} onEdit={vi.fn()} onTogglePin={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByRole("link", { name: /Call/ })).toBeNull();
    expect(screen.getByText("This number is too short to call. Edit it to fix.")).toBeTruthy();
  });

  it("copies the number and confirms, and says when copying fails", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const item = numberToItem(savedNumber());
    render(
      <NumberActionsSheet item={item} onClose={vi.fn()} onEdit={vi.fn()} onTogglePin={vi.fn()} onRemove={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /Copy number/ }));
    expect(writeText).toHaveBeenCalledWith("64572210");
    await waitFor(() => expect(screen.getByRole("button", { name: /Copied/ })).toBeTruthy());

    writeText.mockRejectedValueOnce(new Error("blocked"));
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    await user.click(screen.getByRole("button", { name: /Copied/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Not copied/ })).toBeTruthy());
  });

  it("hands edit, pin and remove to the caller", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onTogglePin = vi.fn();
    const onRemove = vi.fn();
    const item = numberToItem(savedNumber());
    const { rerender } = render(
      <NumberActionsSheet
        item={item}
        onClose={vi.fn()}
        onEdit={onEdit}
        onTogglePin={onTogglePin}
        onRemove={onRemove}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    expect(onEdit).toHaveBeenCalledWith(item);
    await user.click(screen.getByRole("button", { name: "Pin to My Day" }));
    expect(onTogglePin).toHaveBeenCalledWith(item);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith(item);
    rerender(
      <NumberActionsSheet
        item={{ ...item, pinned: true }}
        onClose={vi.fn()}
        onEdit={onEdit}
        onTogglePin={onTogglePin}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByRole("button", { name: "Unpin from My Day" })).toBeTruthy();
  });
});

describe("EditFavouriteSheet", () => {
  const item = clinicalItem("forms:cto", "Community treatment order");

  it("saves a name and note, and refuses patient details", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EditFavouriteSheet item={item} onClose={onClose} />);
    expect(screen.getByTestId("edit-favourite-original").textContent).toContain("Community treatment order");
    const name = screen.getByLabelText(/^Name you see/);
    expect(name.getAttribute("placeholder")).toBe("Community treatment order");

    await user.type(name, "Mr J Smith bed 4");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/looks like a patient's details/)).toBeTruthy();
    expect(loadFavouritesLocal().overrides["forms:cto"]).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();

    await user.clear(name);
    await user.type(name, "CTO");
    await user.type(screen.getByLabelText(/^Note/), "Check the review date");
    expect(screen.getByText("21 of 160")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(loadFavouritesLocal().overrides["forms:cto"]).toEqual({ name: "CTO", note: "Check the review date" });
    expect(onClose).toHaveBeenCalled();
  });

  it("resets to the original name", async () => {
    const user = userEvent.setup();
    expect(setFavouriteOverride("forms:cto", { name: "CTO" })).toEqual({ ok: true });
    const renamed = { ...item, title: "CTO", originalTitle: "Community treatment order" };
    const onClose = vi.fn();
    render(<EditFavouriteSheet item={renamed} overrideName="CTO" onClose={onClose} />);
    expect(screen.getByTestId("edit-favourite-original").textContent).toContain("Community treatment order");
    await user.click(screen.getByRole("button", { name: "Reset to original" }));
    expect(loadFavouritesLocal().overrides["forms:cto"]).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("CustomiseFavouritesSheet", () => {
  it("moves a section and hides one, saving at once", async () => {
    const user = userEvent.setup();
    render(<CustomiseFavouritesSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Move Continue up" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Move Work pages down" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Move Numbers up" }));
    expect(loadFavouritesLocal().layout.order).toEqual(["continue", "numbers", "shelf", "clinical", "work"]);

    await user.click(screen.getByRole("switch", { name: "Show Continue" }));
    expect(loadFavouritesLocal().layout.hidden).toEqual(["continue"]);
    expect(screen.getByRole("switch", { name: "Show Continue" }).getAttribute("aria-checked")).toBe("false");

    await user.click(screen.getByRole("radio", { name: "Work" }));
    await user.click(screen.getByRole("radio", { name: "A to Z" }));
    await user.click(screen.getByRole("radio", { name: "4 tiles" }));
    expect(loadFavouritesLocal().layout).toMatchObject({ scope: "work", view: "az", shelfSize: 4 });
  });

  it("asks before resetting the layout", async () => {
    const user = userEvent.setup();
    render(<CustomiseFavouritesSheet open onClose={vi.fn()} />);
    await user.click(screen.getByRole("switch", { name: "Show Numbers" }));
    await user.click(screen.getByRole("button", { name: "Reset layout" }));
    const confirm = screen.getByTestId("reset-layout-confirm");
    await user.click(within(confirm).getByRole("button", { name: "Keep layout" }));
    expect(loadFavouritesLocal().layout.hidden).toEqual(["numbers"]);
    await user.click(screen.getByRole("button", { name: "Reset layout" }));
    await user.click(within(screen.getByTestId("reset-layout-confirm")).getByRole("button", { name: "Reset" }));
    expect(loadFavouritesLocal().layout.hidden).toEqual([]);
  });
});

describe("ArrangeShelfSheet", () => {
  const a = clinicalItem("forms:a", "Delirium");
  const b = clinicalItem("forms:b", "CTO");
  const c = clinicalItem("forms:c", "Liaison");
  const d = clinicalItem("forms:d", "Renewals");

  it("reorders the pins into layout.pinOrder", async () => {
    const user = userEvent.setup();
    render(
      <ArrangeShelfSheet open onClose={vi.fn()} pinned={[a, b, c]} unpinned={[d]} pinLimit={4} onTogglePin={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Move Delirium up" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Move CTO up" }));
    expect(loadFavouritesLocal().layout.pinOrder).toEqual(["forms:b", "forms:a", "forms:c"]);
  });

  it("unpins, pins, and explains a full shelf", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    const { rerender } = render(
      <ArrangeShelfSheet open onClose={vi.fn()} pinned={[a]} unpinned={[d]} pinLimit={2} onTogglePin={onTogglePin} />,
    );
    await user.click(screen.getByRole("button", { name: "Unpin Delirium" }));
    expect(onTogglePin).toHaveBeenCalledWith(a);
    await user.click(screen.getByRole("button", { name: "Pin Renewals" }));
    expect(onTogglePin).toHaveBeenCalledWith(d);

    rerender(
      <ArrangeShelfSheet
        open
        onClose={vi.fn()}
        pinned={[a, b]}
        unpinned={[d]}
        pinLimit={2}
        onTogglePin={onTogglePin}
      />,
    );
    expect(screen.getByRole("button", { name: "Pin Renewals" })).toHaveProperty("disabled", true);
    expect(screen.getByText("My Day holds 2 pins. Unpin one first.")).toBeTruthy();
  });
});
