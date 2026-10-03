/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RosterChangeRows } from "@/components/roster/roster-change-rows";
import type { RosterChangeNotice } from "@/lib/roster/what-changed";

afterEach(cleanup);

function notices(count: number): RosterChangeNotice[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `import-${i}`,
    source: "import" as const,
    date: `2026-10-${String(6 + i).padStart(2, "0")}`,
    title: `Day ${i}: added`,
    detail: `Detail ${i}`,
    href: "/roster/shifts",
  }));
}

function renderRows(count: number, onDismiss = vi.fn()) {
  const view = render(
    <ul>
      <RosterChangeRows notices={notices(count)} onDismiss={onDismiss} testId="rc" />
    </ul>,
  );
  return { ...view, onDismiss };
}

describe("RosterChangeRows", () => {
  it("renders nothing when there are no notices", () => {
    const { container } = renderRows(0);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(screen.queryByText("Got it")).toBeNull();
  });

  it("shows every notice and no See all when there are two", () => {
    renderRows(2);
    expect(screen.getByText("Your roster changed · Day 0: added")).toBeTruthy();
    expect(screen.getByText("Your roster changed · Day 1: added")).toBeTruthy();
    expect(screen.queryByText(/See all/)).toBeNull();
    expect(screen.getByText("2 changes to your shifts")).toBeTruthy();
  });

  it("shows three rows then reveals all five with See all", () => {
    renderRows(5);
    expect(screen.getAllByText(/Your roster changed/)).toHaveLength(3);
    fireEvent.click(screen.getByText("See all (5)"));
    expect(screen.getAllByText(/Your roster changed/)).toHaveLength(5);
    expect(screen.queryByText(/See all/)).toBeNull();
    expect(screen.getByText("5 changes to your shifts")).toBeTruthy();
  });

  it("calls onDismiss once when Got it is pressed", () => {
    const { onDismiss } = renderRows(2);
    fireEvent.click(screen.getByText("Got it"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses the singular for one change", () => {
    renderRows(1);
    expect(screen.getByText("1 change to your shifts")).toBeTruthy();
  });
});
