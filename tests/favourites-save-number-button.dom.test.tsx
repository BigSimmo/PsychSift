/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { SaveNumberToFavouritesButton } from "@/components/favourites/save-number-button";
import {
  loadFavouritesLocal,
  resetFavouritesLocalForTesting,
  updateSavedNumber,
} from "@/lib/favourites/favourites-local";

beforeEach(() => {
  localStorage.clear();
  resetFavouritesLocalForTesting();
});

describe("SaveNumberToFavouritesButton", () => {
  it("saves, removes with Undo, and Undo puts back the person's own name", async () => {
    const user = userEvent.setup();
    render(<SaveNumberToFavouritesButton label="Psych liaison" number="(08) 6457 2210" />);

    await user.click(screen.getByRole("button", { name: "Save Psych liaison to Favourites" }));
    expect(screen.getByTestId("save-number-favourite-status")).toHaveTextContent("Saved to Favourites on this phone.");
    const [saved] = loadFavouritesLocal().numbers;
    expect(saved).toBeDefined();
    // The person renamed it and added a note.
    expect(updateSavedNumber(saved!.id, { label: "Liaison reg", number: saved!.number, note: "Bleep first" }).ok).toBe(
      true,
    );

    await user.click(screen.getByRole("button", { name: "Remove Psych liaison from Favourites" }));
    expect(loadFavouritesLocal().numbers).toHaveLength(0);
    expect(screen.getByTestId("save-number-favourite-status")).toHaveTextContent("Removed from Favourites.");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(loadFavouritesLocal().numbers).toEqual([
      expect.objectContaining({ id: saved!.id, label: "Liaison reg", note: "Bleep first" }),
    ]);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Psych liaison from Favourites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
