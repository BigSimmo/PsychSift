/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCourseChangeSource, useHospitalSickSource } from "@/components/needs-you/use-admin-notification-sources";
import { useFeatureNotificationSources } from "@/components/needs-you/use-feature-notification-sources";
import type { NotificationItem } from "@/lib/needs-you/feed";

const state = vi.hoisted(() => ({
  held: [] as string[],
  preview: false,
  hidden: [] as string[],
}));
const watchHospitalSickNeedsYou = vi.hoisted(() => vi.fn());
const readCourseChanges = vi.hoisted(() => vi.fn());

// One session object, as the provider memoises it, so the reads are not started again on every render.
const auth = vi.hoisted(() => ({
  status: "signed-in",
  authEpoch: 1,
  session: { user: { id: "user-1" } },
  authorizationHeader: { Authorization: "Bearer t" },
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("@/components/work-frame/use-held-work-roles", () => ({
  useHeldWorkRoles: (signedIn: boolean) => (signedIn ? state.held : []),
}));
vi.mock("@/components/live-version/live-version-provider", () => ({ useLivePreview: () => state.preview }));
vi.mock("@/components/work-mode-launch/work-mode-launch-provider", () => ({
  useWorkModeRouteVisible: () => (href: string) => !state.hidden.some((path) => href.startsWith(path)),
}));
vi.mock("@/components/needs-you/hospital-sick-feed", () => ({ watchHospitalSickNeedsYou }));
vi.mock("@/components/needs-you/course-change-feed", () => ({ readCourseChanges }));
vi.mock("@/lib/shared-get", () => ({ sharedGet: vi.fn(() => Promise.reject(new Error("offline"))) }));
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

const NOW = new Date("2026-10-09T00:00:00Z");
const ZONE = "Australia/Perth";

const SICK_ITEM: NotificationItem = {
  id: "my-work:hospital-sick:h1",
  title: "Sick calls at Fiona Stanley",
  detail: "2 need cover this week",
  due: "2026-10-10",
  area: "my-work",
  href: "/admin/hospital/sick?hospitalId=h1",
  kind: "update",
};
const COURSE_ITEM: NotificationItem = {
  id: "my-work:course-change:c1:2026-10-05T02:00:00Z",
  title: "Course moved: Basic life support",
  due: "2026-10-20",
  area: "my-work",
  href: "/admin/bookings?course=c1",
  kind: "update",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  localStorage.clear();
  state.held = [];
  state.preview = false;
  state.hidden = [];
  watchHospitalSickNeedsYou.mockReset();
  watchHospitalSickNeedsYou.mockImplementation((_input, onRead: (read: unknown) => void) => {
    onRead({ status: "ready", items: [SICK_ITEM] });
    return () => undefined;
  });
  readCourseChanges.mockReset();
  readCourseChanges.mockResolvedValue({ status: "ready", items: [COURSE_ITEM] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Sick calls source", () => {
  const render = () => renderHook(() => useHospitalSickSource({ enabled: true, demo: false, readAt: NOW, zone: ZONE }));

  it("reads nothing for a reader without Medical Workforce or the administrator role", () => {
    state.held = ["manager", "supervisor"];
    const { result } = render();
    expect(result.current).toMatchObject({ id: "hospital-sick", status: "ready", items: [] });
    expect(watchHospitalSickNeedsYou).not.toHaveBeenCalled();
  });

  it("lists the hospital's sick calls for Medical Workforce", async () => {
    state.held = ["workforce"];
    const { result } = render();
    await waitFor(() => expect(result.current.items).toEqual([SICK_ITEM]));
    expect(watchHospitalSickNeedsYou).toHaveBeenCalledTimes(1);
    expect(watchHospitalSickNeedsYou).toHaveBeenCalledWith(
      { userId: "user-1", now: NOW, zone: ZONE },
      expect.any(Function),
    );
  });

  it("reads nothing where the launch switch hides the Sick calls screen", () => {
    state.held = ["administrator"];
    state.hidden = ["/admin/hospital"];
    const { result } = render();
    expect(result.current).toMatchObject({ status: "ready", items: [] });
    expect(watchHospitalSickNeedsYou).not.toHaveBeenCalled();
  });

  it("reads nothing in the demo build", () => {
    state.held = ["workforce"];
    const { result } = renderHook(() => useHospitalSickSource({ enabled: true, demo: true, readAt: NOW, zone: ZONE }));
    expect(result.current).toMatchObject({ status: "unavailable", items: [] });
    expect(watchHospitalSickNeedsYou).not.toHaveBeenCalled();
  });
});

describe("Course changes source", () => {
  const render = () => renderHook(() => useCourseChangeSource({ enabled: true, demo: false, today: "2026-10-09" }));

  it("reads nothing outside the course-bookings preview", () => {
    const { result } = render();
    expect(result.current).toMatchObject({ id: "course-changes", status: "ready", items: [] });
    expect(readCourseChanges).not.toHaveBeenCalled();
  });

  it("lists changed courses in the preview", async () => {
    state.preview = true;
    const { result } = render();
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.items).toEqual([COURSE_ITEM]));
    expect(readCourseChanges).toHaveBeenCalledTimes(1);
    expect(readCourseChanges).toHaveBeenCalledWith(
      { headers: { Authorization: "Bearer t" }, today: "2026-10-09" },
      expect.any(AbortSignal),
    );
  });

  it("says the check failed when the read fails", async () => {
    state.preview = true;
    readCourseChanges.mockRejectedValue(new Error("boom"));
    const { result } = render();
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.items).toEqual([]);
  });
});

describe("registration", () => {
  it("adds both sources to the feature sources the bell reads", async () => {
    state.held = ["workforce"];
    state.preview = true;
    const { result } = renderHook(() =>
      useFeatureNotificationSources({ enabled: true, clock: NOW, readAt: NOW, zone: ZONE }),
    );
    await waitFor(() => {
      const ids = result.current.flatMap((source) => source.items.map((item) => item.id));
      expect(ids).toEqual(expect.arrayContaining([SICK_ITEM.id, COURSE_ITEM.id]));
    });
  });

  it("adds nothing while signed out", () => {
    state.held = ["workforce"];
    state.preview = true;
    const { result } = renderHook(() =>
      useFeatureNotificationSources({ enabled: false, clock: NOW, readAt: NOW, zone: ZONE }),
    );
    expect(result.current).toEqual([]);
    expect(watchHospitalSickNeedsYou).not.toHaveBeenCalled();
    expect(readCourseChanges).not.toHaveBeenCalled();
  });
});
