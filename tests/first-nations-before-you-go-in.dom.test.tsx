/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BeforeYouGoIn, UNDO_MS } from "@/components/first-nations/before-you-go-in";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model } = bedsideFixture();
const openSheet = () => {
  render(<BeforeYouGoIn steps={model.beforeYouGoIn} />);
  fireEvent.click(screen.getByRole("button", { name: /Before you go in/ }));
  return screen.getByRole("dialog");
};

describe("BeforeYouGoIn", () => {
  it("opens unticked and says nothing is saved", () => {
    const sheet = openSheet();
    expect(within(sheet).getByText("Nothing is saved")).toBeTruthy();
    expect(
      within(sheet)
        .getAllByRole("checkbox")
        .every((c) => !(c as HTMLInputElement).checked),
    ).toBe(true);
  });
  it("shows each step's source and checked date outside its tick", () => {
    const sheet = openSheet();
    const first = within(sheet).getAllByRole("listitem")[0];
    const source = within(first).getAllByText(model.beforeYouGoIn[0].source.title, { exact: false });
    for (const el of source) expect(el.closest("label")).toBeNull();
  });
  it("clears at once with Undo for about six seconds, never 'Are you sure?'", () => {
    vi.useFakeTimers();
    const sheet = openSheet();
    fireEvent.click(within(sheet).getAllByRole("checkbox")[0]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear ticks" }));
    expect(within(sheet).getAllByRole("checkbox")[0]).toHaveProperty("checked", false);
    fireEvent.click(within(sheet).getByRole("button", { name: "Undo" }));
    expect(within(sheet).getAllByRole("checkbox")[0]).toHaveProperty("checked", true);
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear ticks" }));
    act(() => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(within(sheet).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });
});
