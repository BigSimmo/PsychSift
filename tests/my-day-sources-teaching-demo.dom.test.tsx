/** @vitest-environment jsdom */

// My Day's Teaching source: a demo-mode refusal is "unavailable", a real error is "failed".
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  byUrl: {} as Record<string, { status: string; code: string | null }>,
  asked: [] as string[],
  authStatus: "authenticated",
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: mocks.authStatus, authEpoch: 0 }),
}));
vi.mock("@/components/teaching/use-teaching-resource", () => ({
  useTeachingResource: (url: string | null) => {
    if (url) mocks.asked.push(url);
    return {
      ...(url ? (mocks.byUrl[url] ?? { status: "ready", code: null }) : { status: "idle", code: null }),
      data: null,
      refreshing: false,
      retry: () => {},
    };
  },
}));
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ preferences: { reminders: undefined } }),
}));

import { useTeachingMyDaySource } from "@/components/my-day/sources/teaching";

const now = new Date("2026-10-03T04:00:00Z");

describe("useTeachingMyDaySource in the synthetic demo", () => {
  beforeEach(() => {
    mocks.asked = [];
    mocks.authStatus = "authenticated";
    mocks.byUrl = {
      "/api/teaching?view=unlogged-count": { status: "ready", code: null },
      "/api/teaching/depth?view=teach": { status: "error", code: "demo_mode_unavailable" },
      "/api/teaching/depth?view=feedback-open": { status: "error", code: "demo_mode_unavailable" },
    };
  });

  it("reads a demo-mode refusal as unavailable, not as a failed read", () => {
    const { result } = renderHook(() => useTeachingMyDaySource({ enabled: true, now }));
    expect(result.current.result.status).toBe("unavailable");
  });

  it("does not ask the depth routes in the local demo build, and still reads as unavailable", () => {
    mocks.authStatus = "unconfigured";
    const { result } = renderHook(() => useTeachingMyDaySource({ enabled: true, now }));
    expect(result.current.result.status).toBe("unavailable");
    expect(mocks.asked.some((url) => url.startsWith("/api/teaching/depth"))).toBe(false);
  });

  it("still reports a real error as failed", () => {
    mocks.byUrl["/api/teaching/depth?view=teach"] = { status: "error", code: "server_error" };
    const { result } = renderHook(() => useTeachingMyDaySource({ enabled: true, now }));
    expect(result.current.result.status).toBe("failed");
  });
});
