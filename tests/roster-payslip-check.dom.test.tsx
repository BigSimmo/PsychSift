// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Payslip check (owner idea 1, work-mode redesign, 6 Oct 2026): what the
 * fortnight's payslip should reflect, from the roster only. Invented shifts.
 */

const clipboard = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: clipboard.copy }));

import { RosterPayslipCheck } from "@/components/roster/roster-payslip-check";
import type { HoursSummary } from "@/lib/roster/hours";

function shift(id: string, date: string, kind: string, start = "08:00", end = "16:30", endDate = date) {
  return {
    id,
    startsAt: `${date}T${start}:00+08:00`,
    endsAt: `${endDate}T${end}:00+08:00`,
    title: "Shift",
    location: null,
    sourceUid: null,
    kind,
    source: "import",
    seriesId: null,
    workplace: "Example Hospital",
  } as never;
}

const shifts = [
  shift("d1", "2026-09-28", "day"),
  shift("n1", "2026-10-03", "night", "21:00", "08:30", "2026-10-04"),
  shift("oc", "2026-10-04", "on_call", "21:00", "08:00", "2026-10-05"),
  shift("al", "2026-10-06", "leave", "00:00", "00:00", "2026-10-07"),
  shift("x", "2026-10-12", "day"),
];
const summary = { start: "2026-09-28", end: "2026-10-11", totalHours: 31.5, extraHours: 2 } as unknown as HoursSummary;

afterEach(() => {
  cleanup();
  clipboard.copy.mockReset();
});

describe("Payslip check", () => {
  it("lists the fortnight's figures from the roster, with no pay amounts", () => {
    render(<RosterPayslipCheck shifts={shifts} summary={summary} extraLoaded partial={false} payAnchored />);
    const card = screen.getByTestId("roster-payslip-check");
    const value = (label: string) => within(card).getByText(label).nextSibling?.textContent;
    expect(value("Shifts")).toBe("3");
    expect(value("Nights")).toBe("1");
    expect(value("On call")).toBe("1");
    expect(value("Weekend shifts")).toBe("2");
    // Mon 28 Sep 2026 is the King's Birthday, a WA public holiday.
    expect(value("Public holiday shifts")).toBe("1");
    expect(card).toHaveTextContent("Your roster, not your pay.");
    expect(card.textContent).not.toMatch(/\$/);
  });

  it("says every figure is a minimum when part of the roster did not load, and when extra time did not load", () => {
    render(<RosterPayslipCheck shifts={shifts} summary={summary} extraLoaded={false} partial payAnchored={false} />);
    const card = screen.getByTestId("roster-payslip-check");
    expect(within(card).getByText("Nights").nextSibling).toHaveTextContent("at least 1");
    expect(within(card).getByText("Extra time you recorded").nextSibling).toHaveTextContent("not loaded");
    expect(card).toHaveTextContent("Your team has no pay date set");
  });

  it("copies the lines as text and says so, or says it could not", async () => {
    clipboard.copy.mockResolvedValueOnce(undefined);
    render(<RosterPayslipCheck shifts={shifts} summary={summary} extraLoaded partial={false} payAnchored />);
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    expect(await screen.findByText("Copied. Paste it beside your payslip.")).toBeInTheDocument();
    const text = clipboard.copy.mock.calls[0]?.[0] as string;
    expect(text).toContain("pay fortnight");
    expect(text).toContain("Nights: 1");
    expect(text).toContain("Rostered hours, not pay.");
    clipboard.copy.mockRejectedValueOnce(new Error("blocked"));
    fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
    expect(await screen.findByText("Couldn't copy on this device.")).toBeInTheDocument();
  });
});
