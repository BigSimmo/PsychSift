/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnCallShiftSwitch } from "@/components/on-call/shift/shift-switch";

// The Shift tab's switch (On Call overhaul, owner approval 20 Oct 2026): Handover, Call log and
// Breaks are each their own page, so the switch is three links with the current one marked.

vi.mock("@/components/on-call/handover/call-log", () => ({
  OnCallCallLogCard: () => <section data-testid="call-log-card">Log a call</section>,
}));

afterEach(cleanup);

describe("OnCallShiftSwitch", () => {
  it("links the three Shift pages in order and marks only the current one", () => {
    render(<OnCallShiftSwitch current="calls" />);
    const nav = screen.getByRole("navigation", { name: "Shift pages" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Handover", "/on-call/handover"],
      ["Call log", "/on-call/calls"],
      ["Breaks", "/on-call/pulse"],
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, "page", null]);
  });

  it("keeps every segment at the 48px tap height", () => {
    render(<OnCallShiftSwitch current="handover" />);
    for (const link of screen.getAllByRole("link")) expect(link).toHaveClass("min-h-tap");
  });
});

describe("OnCallCallLogPage", () => {
  it("puts the switch above the same call log Now opens as a sheet", async () => {
    const { OnCallCallLogPage } = await import("@/components/on-call/shift/call-log-page");
    render(<OnCallCallLogPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Call log" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Shift pages" });
    expect(within(nav).getByRole("link", { name: "Call log" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("call-log-card")).toBeInTheDocument();
    expect(
      nav.compareDocumentPosition(screen.getByTestId("call-log-card")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
