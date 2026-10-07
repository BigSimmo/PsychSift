/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFeatureNotificationSources } from "@/components/needs-you/use-feature-notification-sources";
import { setSharedDevice } from "@/lib/alerts/shared-device";
import type { CmeEntry } from "@/lib/cme/types";

const sharedGet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shared-get", () => ({ sharedGet }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "signed-in", authEpoch: 1 }) }));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => ({
    entries: [],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
  }),
}));
vi.mock("@/components/on-call/first-week/use-first-week-pack", () => ({
  useFirstWeekPack: () => ({
    sample: false,
    startState: "ready",
    landAlert: true,
    startsOn: null,
    progress: {},
    phase: "none",
    handbook: { status: "idle" },
  }),
}));
vi.mock("@/lib/teaching/term-tracker-store", () => ({ useTermTrackerStore: () => ({ state: null }) }));

// 7 December 2026 in Perth: CPD Home's "make your file" month.
const DECEMBER = new Date("2026-12-07T01:00:00Z");

function entry(id: string): CmeEntry {
  return {
    id,
    date: "2026-11-02",
    title: `Activity ${id}`,
    allocations: [{ category: "educational", hours: 1 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  };
}

function renderSources() {
  return renderHook(() => useFeatureNotificationSources({ enabled: true, clock: DECEMBER, readAt: DECEMBER }));
}

const cpdHome = (sources: ReturnType<typeof useFeatureNotificationSources>) =>
  sources.find((source) => source.id === "cpd-home");

beforeEach(() => {
  localStorage.clear();
  sharedGet.mockReset();
  sharedGet.mockResolvedValue(
    new Response(JSON.stringify({ entries: [entry("a"), entry("b")], year: 2026 }), { status: 200 }),
  );
});

afterEach(() => {
  act(() => setSharedDevice(false));
});

describe("CPD Home in the Notification centre", () => {
  it("asks for the year's file in December on the doctor's own device", async () => {
    const { result } = renderSources();
    await waitFor(() => expect(cpdHome(result.current)?.items).toHaveLength(1));
    expect(cpdHome(result.current)?.items[0]).toMatchObject({ id: "cpd:cpd-home:year-end:2026", area: "cme" });
  });

  it("shows nothing and reads nothing on a device marked shared", async () => {
    act(() => setSharedDevice(true));
    const { result } = renderSources();
    await waitFor(() => expect(cpdHome(result.current)?.status).toBe("ready"));
    expect(cpdHome(result.current)?.items).toEqual([]);
    expect(sharedGet).not.toHaveBeenCalled();
  });
});
