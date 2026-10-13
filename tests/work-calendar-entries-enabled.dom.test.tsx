/** @vitest-environment jsdom */

// A signed-out My Day reads nothing, so the work calendar sources must not fetch
// for it either (CodeAnt review on #3433: rotations were requested while signed out).

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ rotations: vi.fn(), bookings: vi.fn() }));

vi.mock("@/components/work-calendar/sources", () => ({
  WORK_CALENDAR_SOURCES: [
    {
      id: "rotations",
      read: (enabled: boolean) => {
        reads.rotations(enabled);
        return { status: enabled ? "ready" : "off", entries: [] };
      },
    },
    {
      id: "bookings",
      read: (enabled: boolean) => {
        reads.bookings(enabled);
        return { status: enabled ? "ready" : "off", entries: [] };
      },
    },
  ],
}));

import { useWorkCalendarEntries } from "@/components/work-calendar/use-work-calendar-entries";

describe("useWorkCalendarEntries enabled", () => {
  it("is on by default, for Roster and the calendar page", () => {
    reads.rotations.mockClear();
    const { result } = renderHook(() => useWorkCalendarEntries());
    expect(reads.rotations).toHaveBeenLastCalledWith(true);
    expect(result.current.status).toBe("ready");
  });

  it("asks no source to read when the caller is off (My Day signed out)", () => {
    reads.rotations.mockClear();
    reads.bookings.mockClear();
    const { result } = renderHook(() => useWorkCalendarEntries({ enabled: false }));
    expect(reads.rotations).toHaveBeenLastCalledWith(false);
    expect(reads.bookings).toHaveBeenLastCalledWith(false);
    expect(reads.rotations).not.toHaveBeenCalledWith(true);
    expect(result.current).toMatchObject({ status: "off", entries: [] });
  });
});
