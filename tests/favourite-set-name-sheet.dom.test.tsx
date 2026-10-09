import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FavouriteSetNameSheet } from "@/components/favourites/favourite-sheets";

const suggestions = ["Ward round", "On call"] as const;

function open(props: Partial<Parameters<typeof FavouriteSetNameSheet>[0]> = {}) {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(
    <FavouriteSetNameSheet
      mode="create"
      open
      existingNames={["Ward round"]}
      suggestedNames={suggestions.filter((name) => name !== "Ward round")}
      movingCount={0}
      onClose={onClose}
      onChoose={onChoose}
      {...props}
    />,
  );
  return { onChoose, onClose };
}

describe("FavouriteSetNameSheet", () => {
  it("saves a typed name, normalised", async () => {
    const user = userEvent.setup();
    const { onChoose } = open();

    await user.type(screen.getByRole("textbox", { name: /Set name/ }), "  Clozapine  clinic  ");
    await user.click(screen.getByRole("button", { name: "Create set" }));

    expect(onChoose).toHaveBeenCalledWith("Clozapine clinic");
  });

  it("refuses a name holding a UMRN, and says why without sending it", async () => {
    const user = userEvent.setup();
    const { onChoose } = open();

    await user.type(screen.getByRole("textbox", { name: /Set name/ }), "Smith D4678677");
    await user.click(screen.getByRole("button", { name: "Create set" }));

    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByText(/UMRN, date or phone number/)).toBeInTheDocument();
  });

  it("refuses a name the account already uses, whatever the case", async () => {
    const user = userEvent.setup();
    const { onChoose } = open();

    await user.type(screen.getByRole("textbox", { name: /Set name/ }), "ward round");
    await user.click(screen.getByRole("button", { name: "Create set" }));

    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByText(/already have a set called/)).toBeInTheDocument();
  });

  it("still offers the unused original names as one-tap suggestions", async () => {
    const user = userEvent.setup();
    const { onChoose } = open();

    await user.click(screen.getByRole("button", { name: "On call" }));

    expect(onChoose).toHaveBeenCalledWith("On call");
  });

  it("opens a rename on the current name and closes when it is unchanged", async () => {
    const user = userEvent.setup();
    const { onChoose, onClose } = open({ mode: "rename", currentName: "Ward round" });

    expect(screen.getByRole("textbox", { name: /Set name/ })).toHaveValue("Ward round");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(onChoose).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
