/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { CompareCatalogPicker } from "@/components/compare";

afterEach(() => {
  cleanup();
});

describe("CompareCatalogPicker", () => {
  it("assigns the highlighted hit to the active slot and skips duplicates", async () => {
    const user = userEvent.setup();
    const chosen: string[] = [];
    render(
      <CompareCatalogPicker
        items={[
          { id: "mse", title: "MSE", snippet: "Mental state examination" },
          { id: "mmse", title: "MMSE", snippet: "Mini-mental state examination" },
        ]}
        query=""
        onQueryChange={() => {}}
        selectedIds={["mse", null]}
        maxCount={2}
        activeSlot={1}
        onChoose={(id) => chosen.push(id)}
        searchPlaceholder="Search term or abbreviation"
      />,
    );

    await user.click(screen.getByRole("option", { name: /MMSE/ }));
    expect(chosen).toEqual(["mmse"]);

    await user.click(
      screen.getByRole("option", {
        name: (accessibleName: string) => accessibleName.startsWith("MSE") && !accessibleName.startsWith("MMSE"),
      }),
    );
    expect(chosen).toEqual(["mmse"]);
    expect(
      screen.getByRole("option", {
        name: (accessibleName: string) => accessibleName.startsWith("MSE") && !accessibleName.startsWith("MMSE"),
      }),
    ).toBeDisabled();
    expect(screen.getByRole("option", { name: /^MSE / })).toHaveClass("disabled:text-[color:var(--disabled)]!");
  });

  it("names the arrow-key highlight to assistive technology through the combobox", async () => {
    const user = userEvent.setup();
    render(
      <CompareCatalogPicker
        items={[
          { id: "mse", title: "MSE", snippet: "Mental state examination" },
          { id: "mmse", title: "MMSE", snippet: "Mini-mental state examination" },
        ]}
        query=""
        onQueryChange={() => {}}
        selectedIds={[null, null]}
        maxCount={2}
        activeSlot={0}
        onChoose={() => {}}
        searchPlaceholder="Search term or abbreviation"
      />,
    );

    const input = screen.getByRole("combobox", { name: "Search term or abbreviation" });
    const listbox = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);

    await user.click(input);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-activedescendant", options[1]!.id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });
});
