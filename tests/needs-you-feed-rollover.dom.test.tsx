/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { myDaySourceModes, type MyDaySourceMode } from "@/lib/my-day/model";

// The header bell lives for the whole session, so its reads must move to the new
// work-zone day without a reload (audit finding, 25 Oct 2026).

const reads = vi.hoisted(() => ({ myDay: [] as Date[], onCall: [] as Date[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/my-day",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: "authenticated", authEpoch: 0 }),
}));

vi.mock("@/components/my-day/use-my-day-items", () => ({
  useMyDayItems: ({ now }: { now: Date }) => {
    reads.myDay.push(now);
    return {
      status: "ready",
      items: [],
      retry: () => undefined,
      sources: myDaySourceModes.map((mode: MyDaySourceMode) => ({ mode, status: "ready", items: [] })),
    };
  },
}));

vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => ({ entries: [] }),
}));

vi.mock("@/lib/on-call/notifications", async () => {
  const actual = await vi.importActual<typeof import("@/lib/on-call/notifications")>("@/lib/on-call/notifications");
  return {
    ...actual,
    deriveOnCallNotifications: (_entries: unknown, now: Date) => {
      reads.onCall.push(now);
      return [];
    },
    visibleOnCallNotifications: (list: unknown[]) => list,
  };
});

vi.mock("@/components/clinical-dashboard/use-app-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/clinical-dashboard/use-app-preferences")>()),
  useAppPreferences: () => ({
    preferences: { reminders: { types: {} } },
    setPreference: vi.fn(),
  }),
}));

const { useNotificationFeed } = await import("@/components/needs-you/use-notification-feed");
const { useNotificationClock } = await import("@/components/needs-you/needs-you-sheet");

/** 22:00 Perth (UTC+8) on Tue 6 Oct 2026, and 07:00 Perth the next morning. */
const EVENING = new Date("2026-10-06T14:00:00.000Z");
const NEXT_MORNING = new Date("2026-10-06T23:00:00.000Z");

beforeEach(() => {
  window.localStorage.clear();
  reads.myDay = [];
  reads.onCall = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Notification feed across midnight", () => {
  it("reads again once the clock reaches a new work-zone day, and not before", () => {
    vi.useFakeTimers({ now: EVENING });
    const { rerender } = renderHook(({ clock }) => useNotificationFeed({ clock }), {
      initialProps: { clock: EVENING },
    });
    expect(reads.myDay.at(-1)?.getTime()).toBe(EVENING.getTime());
    expect(reads.onCall.at(-1)?.getTime()).toBe(EVENING.getTime());

    // A later minute on the same day only re-sorts what loaded.
    vi.setSystemTime(new Date(EVENING.getTime() + 60 * 60_000));
    rerender({ clock: new Date(EVENING.getTime() + 60 * 60_000) });
    expect(reads.myDay.at(-1)?.getTime()).toBe(EVENING.getTime());

    vi.setSystemTime(NEXT_MORNING);
    rerender({ clock: NEXT_MORNING });
    expect(reads.myDay.at(-1)?.getTime()).toBe(NEXT_MORNING.getTime());
    expect(reads.onCall.at(-1)?.getTime()).toBe(NEXT_MORNING.getTime());
  });

  it("moves the closed bell's clock at the work-zone midnight", () => {
    // 23:59 Perth.
    const beforeMidnight = new Date("2026-10-06T15:59:00.000Z");
    vi.useFakeTimers({ now: beforeMidnight });
    const { result } = renderHook(() => useNotificationClock(false));
    expect(result.current.getTime()).toBe(beforeMidnight.getTime());
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.getTime()).toBe(beforeMidnight.getTime());
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.getTime()).toBe(new Date("2026-10-06T16:00:00.000Z").getTime());
  });
});
