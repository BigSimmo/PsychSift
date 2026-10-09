/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TermAddItem } from "@/components/teaching/teaching-term-kit";

afterEach(() => cleanup());

describe("TermAddItem", () => {
  it("adds plain text and clears the field", () => {
    const onAdd = vi.fn();
    render(<TermAddItem label="Add a goal" placeholder="Add a goal" onAdd={onAdd} />);
    const field = screen.getByRole("textbox", { name: "Add a goal" });
    fireEvent.change(field, { target: { value: "Lead a family meeting" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    expect(onAdd).toHaveBeenCalledWith("Lead a family meeting");
    expect((field as HTMLInputElement).value).toBe("");
  });

  it("refuses text that reads as a patient detail and says why", () => {
    const onAdd = vi.fn();
    render(<TermAddItem label="Add something to raise" placeholder="Add something to raise" onAdd={onAdd} />);
    const field = screen.getByRole("textbox", { name: "Add something to raise" });
    fireEvent.change(field, { target: { value: "Discuss URN 1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Add something to raise" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Take out the patient details to add it/);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    // Editing clears the warning, and the field keeps what was typed.
    fireEvent.change(field, { target: { value: "Discuss leave dates" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
