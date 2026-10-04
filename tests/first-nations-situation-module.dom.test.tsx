/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SituationModule, SituationProvider, SituationSidePanel } from "@/components/first-nations/situation-module";
import { bedsideFixture, resetAfterEach, riskLineApproval } from "./fixtures/first-nations-models";

vi.mock("@/components/first-nations/kit", async () => await import("./fixtures/first-nations-kit-double"));
resetAfterEach();
const { model, hospital } = bedsideFixture();
const situation = () => screen.getByRole("region", { name: "Situation" });
const renderModule = (situations = model.situations) =>
  render(
    <SituationProvider situations={situations} liaison={hospital.liaison}>
      <SituationModule />
      <SituationSidePanel />
    </SituationProvider>,
  );

describe("SituationModule", () => {
  it("opens on New admission and steps through three phrases", () => {
    renderModule();
    expect(within(situation()).getByRole("button", { name: "New admission", pressed: true })).toBeTruthy();
    expect(within(situation()).getByText("1 of 3")).toBeTruthy();
    for (const n of [2, 3, 1]) {
      fireEvent.click(within(situation()).getByRole("button", { name: "Next phrase" }));
      expect(within(situation()).getByText(`${n} of 3`)).toBeTruthy();
    }
  });

  it("shows the risk line only when the model carries it approved", () => {
    renderModule();
    fireEvent.click(within(situation()).getByRole("button", { name: "Wants to leave" }));
    expect(screen.queryByText(/Immediate risk\?/)).toBeNull();
    cleanup();
    renderModule(bedsideFixture([riskLineApproval()]).model.situations);
    fireEvent.click(within(situation()).getByRole("button", { name: "Wants to leave" }));
    expect(screen.getAllByText(/Immediate risk\?/).length).toBeGreaterThan(0);
  });

  it("opens the plan as a sheet that says nothing is saved and opens unticked", () => {
    renderModule();
    fireEvent.click(screen.getByRole("button", { name: /Plan · 3 steps/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("3 steps · nothing is saved")).toBeTruthy();
    fireEvent.click(within(sheet).getAllByRole("checkbox")[0]);
    expect(within(sheet).getAllByRole("checkbox")[0]).toHaveProperty("checked", true);
    fireEvent.keyDown(sheet, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Plan · 3 steps/ }));
    expect(within(screen.getByRole("dialog")).getAllByRole("checkbox")[0]).toHaveProperty("checked", false);
  });

  it("has one filled button in the plan sheet: the call its steps name", () => {
    renderModule();
    fireEvent.click(screen.getByRole("button", { name: /Plan · 3 steps/ }));
    const sheet = screen.getByRole("dialog");
    const filled = sheet.querySelectorAll("[data-mode-filled]");
    expect(filled).toHaveLength(1);
    expect(filled[0].textContent).toBe("Call Aboriginal Interpreting WA");
    expect(filled[0].getAttribute("href")).toBe("tel:1800000012");
  });

  it("says so when Copy steps cannot copy (Review Focus 3)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false);
    renderModule();
    fireEvent.click(screen.getByRole("button", { name: /Plan · 3 steps/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Copy steps" }));
    expect(await within(screen.getByRole("dialog")).findByText("Copying isn't available on this phone")).toBeTruthy();
  });

  it("moves the chosen situation with the side panel's arrows", () => {
    renderModule();
    fireEvent.click(screen.getByRole("button", { name: "Next situation" }));
    expect(within(situation()).getByRole("button", { name: "Wants to leave", pressed: true })).toBeTruthy();
    expect(screen.getByText("2 of 6")).toBeTruthy();
  });

  it("jumps to a dial control when a situation chip is chosen", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderModule();
    fireEvent.click(within(situation()).getByRole("button", { name: "Wants to leave" }));
    const dial = screen.getByTestId("fn-situation-dial");
    expect(within(dial).getByRole("link", { name: /Call/ })).toBeTruthy();
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});
