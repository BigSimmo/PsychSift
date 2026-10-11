import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PatientSafetyPlan } from "@/components/patient-safety-plan";
import { appModeHomeHref } from "@/lib/app-modes";

const router = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

describe("PatientSafetyPlan privacy contract", () => {
  const writeText = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    router.back.mockReset();
    router.replace.mockReset();
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: { canGoBack: false },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not ask for a patient identifier and explains the transient browser-only boundary", () => {
    render(<PatientSafetyPlan />);

    expect(screen.queryByLabelText(/Patient \(name or initials\)/i)).toBeNull();
    expect(screen.getByText(/Do not enter the patient(?:'|’)s name, date of birth, or record number/i)).toBeVisible();
    expect(screen.getByText(/kept only in this browser tab/i)).toBeVisible();
  });

  it("copies the plan without persisting or transmitting its working content", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");

    render(<PatientSafetyPlan />);
    fireEvent.change(screen.getByLabelText("e.g. Not sleeping for a couple of nights"), {
      target: { value: "Not sleeping" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Not sleeping"));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringMatching(/^For:/m));
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("warns that copy, print, and PDF output leave the transient app session", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);

    render(<PatientSafetyPlan />);
    expect(screen.getByText(/Copying, printing, or saving a PDF moves the plan outside PsychSift/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Print / PDF" }));

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("confirms before leaving a dirty safety plan via the header back control", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<PatientSafetyPlan />);
    fireEvent.change(screen.getByLabelText("e.g. Not sleeping for a couple of nights"), {
      target: { value: "Not sleeping" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/Leave this safety plan\?.*will be lost/i));
    expect(router.replace).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(router.replace).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith(appModeHomeHref("psychiatry"));
  });

  it("confirms before leaving unadded safety-plan step text", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<PatientSafetyPlan />);
    fireEvent.change(screen.getByLabelText("e.g. Not sleeping for a couple of nights"), {
      target: { value: "Not sleeping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("confirms before leaving unadded contact detail text", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<PatientSafetyPlan />);
    fireEvent.change(screen.getByLabelText("Name & relationship"), { target: { value: "Priya" } });
    fireEvent.change(screen.getByLabelText("Phone or how to reach them"), { target: { value: "0400 000 000" } });
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("keeps unadded draft text dirty after loading and clearing the example", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<PatientSafetyPlan />);
    fireEvent.change(screen.getByLabelText("e.g. Not sleeping for a couple of nights"), {
      target: { value: "Not sleeping" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("navigates back without confirmation when the safety plan is empty", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<PatientSafetyPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith(appModeHomeHref("psychiatry"));
  });
});
