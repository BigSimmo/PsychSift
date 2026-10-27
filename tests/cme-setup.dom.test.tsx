/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeSetupPage } from "@/components/cme/cme-setup-page";
import { DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeRequirementSet } from "@/lib/cme/types";

afterEach(cleanup);

describe("CME requirement confirmation", () => {
  it("offers only available CPD homes and labels the RANZCP preset as a draft", async () => {
    const user = userEvent.setup();
    render(<CmeSetupPage year={2026} set={null} />);
    expect(screen.getByRole("heading", { name: "Your CPD home for 2026" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "National baseline only" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "RANZCP" }));
    expect(screen.getByText(/check your CPD-home programme structure/i)).toBeInTheDocument();
    expect(screen.getByTestId("cme-setup-preset")).toHaveTextContent("Starting preset: RANZCP");
    expect(screen.queryByRole("radio", { name: /other college/i })).toBeNull();
  });

  it("submits the edited source and complete requirement set", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CmeSetupPage year={2026} set={DEMO_CME_YEAR} onConfirm={onConfirm} />);

    const source = screen.getByLabelText(/source you checked/i);
    await user.type(screen.getByLabelText(/CPD home name/), "Specialist programme");
    await user.clear(source);
    await user.type(source, "My CPD home guide, 2026 edition");
    await user.click(screen.getByRole("button", { name: /add college extra/i }));
    await user.click(screen.getByRole("button", { name: /re-confirm requirements/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      year: 2026,
      confirmedSource: "CPD home: Other — Specialist programme\nSource checked: My CPD home guide, 2026 edition",
    });
    expect(onConfirm.mock.calls[0][0].requirements.some((item: { source: string }) => item.source === "college")).toBe(
      true,
    );
  });

  it("records a task completion date without claiming the app completed it", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<CmeSetupPage year={2026} set={DEMO_CME_YEAR} onConfirm={onConfirm} />);
    await user.type(screen.getByLabelText(/CPD home name/), "Specialist programme");
    const taskDate = screen.getAllByLabelText(/completion date/i)[0];
    await user.clear(taskDate);
    await user.type(taskDate, "01/03/2026");
    await user.click(screen.getByRole("button", { name: /re-confirm requirements/i }));
    expect(
      onConfirm.mock.calls[0][0].requirements.some(
        (item: { completedOn: string | null }) => item.completedOn === "2026-03-01",
      ),
    ).toBe(true);
  });

  it("keeps demo confirmation visibly read-only", () => {
    render(<CmeSetupPage year={2026} set={DEMO_CME_YEAR} demoMode />);
    expect(screen.getByText(/these are example records/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /re-confirm requirements/i })).toBeNull();
  });

  it("hides a future RANZCP preset that has not been authored", () => {
    render(<CmeSetupPage year={2027} set={null} />);
    expect(screen.queryByRole("radio", { name: "RANZCP" })).toBeNull();
    expect(screen.getByRole("radio", { name: "National baseline only" })).toBeChecked();
  });

  it.each([
    ["National baseline only", "CPD home: National baseline only\nSource checked: https://example.test/national"],
    ["Other", "CPD home: Other — Specialist programme\nSource checked: https://example.test/other"],
  ])("repairs an empty %s set without adding college targets", async (_label, confirmedSource) => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <CmeSetupPage year={2026} set={{ ...DEMO_CME_YEAR, requirements: [], confirmedSource }} onConfirm={onConfirm} />,
    );
    await user.click(screen.getByRole("button", { name: "Load the starting preset" }));
    await user.click(screen.getByRole("button", { name: /re-confirm requirements/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const saved = onConfirm.mock.calls[0][0] as CmeRequirementSet;
    expect(saved.confirmedSource).toBe(confirmedSource);
    expect(saved.requirements.length).toBeGreaterThan(0);
    expect(saved.requirements.every((requirement) => requirement.source === "national")).toBe(true);
  });

  it.each([
    ["National baseline only", "national"],
    ["RANZCP", "ranzcp"],
    ["Other", "other"],
  ])("keeps the %s choice after an injected save and reload", async (label, kind) => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<(set: CmeRequirementSet) => Promise<void>>().mockResolvedValue(undefined);
    const first = render(<CmeSetupPage year={2026} set={null} onConfirm={onConfirm} />);
    if (kind !== "national") await user.click(screen.getByRole("radio", { name: label }));
    if (kind === "other") {
      await user.type(screen.getByLabelText(/CPD home name/), "Specialist programme");
      await user.type(screen.getByLabelText(/Source you checked/), "Guide 2026");
    }
    await user.click(screen.getByRole("button", { name: "Confirm requirements" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const saved = onConfirm.mock.calls[0][0];
    first.unmount();
    render(<CmeSetupPage year={2026} set={saved} onConfirm={onConfirm} />);
    expect(screen.getByRole("radio", { name: label })).toBeChecked();
  });
});
