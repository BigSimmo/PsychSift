/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { msUntilNextPerthDay, useJuniorNow } from "@/components/admin/junior/junior-shared";

afterEach(() => {
  vi.useRealTimers();
});

describe("Admin pages keep today current", () => {
  it("counts to the next Perth midnight", () => {
    // 23:30 Perth on Tue 6 Oct 2026.
    expect(msUntilNextPerthDay(new Date("2026-10-06T15:30:00Z"))).toBe(30 * 60_000);
  });

  it("moves on at Perth midnight and when the page comes back into view", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T15:30:00Z"));
    const { result } = renderHook(() => useJuniorNow());
    expect(result.current.toISOString()).toBe("2026-10-06T15:30:00.000Z");
    act(() => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    expect(result.current.toISOString()).toBe("2026-10-06T16:00:00.000Z");
    vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.toISOString()).toBe("2026-10-07T03:00:00.000Z");
  });

  it("stays on a pinned time", () => {
    const pinned = new Date("2026-10-06T01:00:00Z");
    const { result } = renderHook(() => useJuniorNow(pinned));
    expect(result.current).toBe(pinned);
  });
});
