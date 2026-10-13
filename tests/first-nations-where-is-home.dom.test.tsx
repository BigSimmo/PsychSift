/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WhereIsHomePanel } from "@/components/first-nations/where-is-home";
import { bedsideFixture, resetAfterEach } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model } = bedsideFixture();
const renderPanel = () =>
  render(<WhereIsHomePanel regions={model.regions} map={model.map} interpreter={model.interpreter} />);

describe("WhereIsHomePanel", () => {
  it("lists services and languages near home, ready for the letter", () => {
    renderPanel();
    expect(screen.getByText("Never saved or sent")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Goldfields" }));
    expect(screen.getByText("Near home · Goldfields")).toBeTruthy();
    expect(screen.getByText("Wangkatha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to letter" }));
    expect(screen.getByText("Aboriginal Interpreting WA · 1800 000 012")).toBeTruthy();
    expect(screen.getByText("Interpreter: Wangkatha")).toBeTruthy();
  });
  it("clears the letter when a different home region is chosen", () => {
    const goldfields = model.regions.find((r) => r.label === "Goldfields")!;
    const other = { ...goldfields, id: "test-other-region", label: "Other region", services: [], languages: [] };
    render(<WhereIsHomePanel regions={[goldfields, other]} map={model.map} interpreter={model.interpreter} />);
    fireEvent.click(screen.getByRole("button", { name: "Goldfields" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to letter" }));
    expect(screen.getByText("Interpreter: Wangkatha")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Other region" }));
    expect(screen.queryByText("For the letter")).toBeNull();
    expect(screen.queryByText("Interpreter: Wangkatha")).toBeNull();
  });
  it("has one filled button: Add to letter", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Goldfields" }));
    const filled = document.querySelectorAll("[data-mode-filled]");
    expect(filled).toHaveLength(1);
    expect(filled[0].textContent).toBe("Add to letter");
  });
  it("says so when copying is not possible (Review Focus 3)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Goldfields" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    expect(await screen.findByText("Copying isn't available on this phone")).toBeTruthy();
  });
});
