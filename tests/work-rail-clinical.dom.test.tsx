/** @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/my-day",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { WorkRail } from "@/components/work-frame/work-rail";
import { setWorkSideCounts } from "@/components/work-frame/work-frame-store";
import { LAST_APP_MODE_STORAGE_KEY } from "@/components/clinical-dashboard/use-last-app-mode";

const identity = { signedIn: false, displayName: "", initials: "G" } as Parameters<typeof WorkRail>[0]["identity"];

describe("WorkRail Clinical button", () => {
  afterEach(() => {
    window.localStorage.clear();
    act(() => setWorkSideCounts(null));
  });

  it("goes back to Clinical Answer by default", () => {
    render(<WorkRail identity={identity} currentArea="day" onOpenSettings={() => {}} />);
    const link = screen.getByTestId("work-rail-clinical");
    expect(link).toHaveAccessibleName("Clinical, Answer");
    expect(link.getAttribute("href")).toContain("mode=answer");
  });

  it("goes back to the Clinical mode used last", () => {
    window.localStorage.setItem(LAST_APP_MODE_STORAGE_KEY, "dsm");
    render(<WorkRail identity={identity} currentArea="day" onOpenSettings={() => {}} />);
    const link = screen.getByTestId("work-rail-clinical");
    expect(link.getAttribute("href")).toContain("mode=dsm");
    expect(link).toHaveTextContent("Clinical");
  });

  it.each(["roster", "my-day"])("never links to a Work page when %s was the mode used last", (mode) => {
    window.localStorage.setItem(LAST_APP_MODE_STORAGE_KEY, mode);
    render(<WorkRail identity={identity} currentArea="day" onOpenSettings={() => {}} />);
    const link = screen.getByTestId("work-rail-clinical");
    expect(link).toHaveAccessibleName("Clinical, Answer");
    expect(link.getAttribute("href")).toContain("mode=answer");
  });
});

describe("WorkRail counts", () => {
  afterEach(() => act(() => setWorkSideCounts(null)));

  it("keeps a capped waiting count and its exact value in the accessible name and hover detail", () => {
    setWorkSideCounts({ areas: { cpd: { total: 125, overdue: 0 } }, total: 125, overdue: 0, reminders: 0 });
    render(<WorkRail identity={identity} currentArea="cpd" onOpenSettings={() => {}} />);
    const link = screen.getByTestId("work-rail-area-cpd");
    expect(link).toHaveAccessibleName("CPD, 125 waiting");
    expect(link).toHaveAttribute("title", "CPD, 125 waiting");
    expect(link.querySelector(".work-rail__count")).toHaveTextContent("99+");
    expect(link.querySelector(".work-rail__count")).not.toHaveAttribute("data-overdue");
  });

  it("marks only the overdue portion as urgent while preserving the full waiting count", () => {
    setWorkSideCounts({ areas: { cpd: { total: 25, overdue: 2 } }, total: 25, overdue: 2, reminders: 0 });
    render(<WorkRail identity={identity} currentArea="cpd" onOpenSettings={() => {}} />);
    const link = screen.getByTestId("work-rail-area-cpd");
    expect(link).toHaveAccessibleName("CPD, 25 waiting, 2 overdue");
    expect(link).toHaveAttribute("title", "CPD, 25 waiting, 2 overdue");
    expect(link.querySelector(".work-rail__count")).toHaveTextContent("2");
    expect(link.querySelector(".work-rail__count")).toHaveAttribute("data-overdue", "true");
  });
});
