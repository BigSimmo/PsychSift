/** @vitest-environment jsdom */

// My Day's Teaching source: a demo-mode refusal is "unavailable", a real error is "failed".
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  byUrl: {} as Record<string, { status: string; code: string | null }>,
}));

vi.mock("@/components/teaching/use-teaching-resource", () => ({
  useTeachingResource: (url: string | null) => ({
    ...(url ? (mocks.byUrl[url] ?? { status: "ready", code: null }) : { status: "idle", code: null }),
    data: null,
    refreshing: false,
    retry: () => {},
  }),
}));
vi.mock("@/components/clinical-dashboard/use-app-preferences", () => ({
  useAppPreferences: () => ({ preferences: { reminders: undefined } }),
}));

import { useTeachingMyDaySource } from "@/components/my-day/sources/teaching";

const now = new Date("2026-10-03T04:00:00Z");

describe("useTeachingMyDaySource in the synthetic demo", () => {
  beforeEach(() => {
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

  it("still reports a real error as failed", () => {
    mocks.byUrl["/api/teaching/depth?view=teach"] = { status: "error", code: "server_error" };
    const { result } = renderHook(() => useTeachingMyDaySource({ enabled: true, now }));
    expect(result.current.result.status).toBe("failed");
  });
});
