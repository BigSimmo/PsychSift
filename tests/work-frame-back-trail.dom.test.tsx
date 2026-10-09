/** @vitest-environment jsdom */

// Work mode improvements, 8 Oct 2026: an inner area's back arrow (Notifications,
// Open shifts, Manage team, Assessments) goes back to the work page it was opened
// from, and to its parent only when opened fresh.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  markWorkReturn,
  recordWorkPageVisit,
  resetWorkTrailForTests,
  useWorkAreaOrigin,
} from "@/components/work-frame/work-frame-store";
import { EMPTY_WORK_TRAIL, visitWorkPage, type WorkTrail, type WorkVisit } from "@/lib/work-frame/back-trail";
import { WORK_AREAS, type WorkAreaId } from "@/lib/work-frame/areas";

const page = (areaId: WorkAreaId, href: string | null): WorkVisit => ({ areaId, href });
const inner = (areaId: WorkAreaId) => Boolean(WORK_AREAS[areaId].parent);

function walk(visits: readonly (WorkVisit & { readonly back?: boolean })[]): WorkTrail {
  return visits.reduce(
    (trail, visit) =>
      visitWorkPage(trail, page(visit.areaId, visit.href), { inner: inner(visit.areaId), returning: !!visit.back }),
    EMPTY_WORK_TRAIL,
  );
}

describe("where an inner area goes back to", () => {
  it("remembers the work page the bell was tapped on", () => {
    const trail = walk([page("rost", "/roster"), page("notify", "/my-day/notifications")]);
    expect(trail.origins.notify).toEqual(page("rost", "/roster"));
  });

  it("remembers Manage team, or the side menu's page, for Open shifts", () => {
    expect(walk([page("manage", "/roster/manage"), page("open", "/open-shifts")]).origins.open).toEqual(
      page("manage", "/roster/manage"),
    );
    expect(walk([page("teach", "/teaching"), page("open", "/open-shifts")]).origins.open).toEqual(
      page("teach", "/teaching"),
    );
  });

  it("has nothing when opened fresh, so it falls back to its parent", () => {
    expect(walk([page("open", "/open-shifts")]).origins.open).toBeUndefined();
  });

  it("keeps it while the reader moves between the inner area's own pages", () => {
    const trail = walk([page("teach", "/teaching"), page("open", "/open-shifts"), page("open", "/open-shifts/mine")]);
    expect(trail.origins.open).toEqual(page("teach", "/teaching"));
  });

  it("never sends the reader back and forth between two inner areas", () => {
    const trail = walk([
      page("rost", "/roster"),
      page("manage", "/roster/manage"),
      page("open", "/open-shifts"),
      // Open shifts' back arrow returns to Manage team, which keeps Roster as its way back.
      { ...page("manage", "/roster/manage"), back: true },
    ]);
    expect(trail.origins.manage).toEqual(page("rost", "/roster"));
    expect(trail.origins.open).toEqual(page("manage", "/roster/manage"));
  });

  it("takes a fresh way back when the reader opens it again from somewhere else", () => {
    const trail = walk([
      page("rost", "/roster"),
      page("notify", "/my-day/notifications"),
      page("cpd", "/cme"),
      page("notify", "/my-day/notifications"),
    ]);
    expect(trail.origins.notify).toEqual(page("cpd", "/cme"));
  });

  it("gives a top-level area no way back of its own", () => {
    expect(walk([page("rost", "/roster"), page("teach", "/teaching")]).origins).toEqual({});
  });
});

describe("the frame's memory of it", () => {
  afterEach(() => resetWorkTrailForTests());

  it("tells the back arrow, and counts the phone's Back as a return", () => {
    const { result } = renderHook(() => useWorkAreaOrigin("notify"));
    expect(result.current).toBeNull();
    act(() => {
      recordWorkPageVisit(page("rost", "/roster"), false);
      recordWorkPageVisit(page("notify", "/my-day/notifications"), true);
    });
    expect(result.current).toEqual(page("rost", "/roster"));
    act(() => {
      recordWorkPageVisit(page("open", "/open-shifts"), true);
      window.dispatchEvent(new PopStateEvent("popstate"));
      recordWorkPageVisit(page("notify", "/my-day/notifications"), true);
    });
    expect(result.current).toEqual(page("rost", "/roster"));
  });

  it("counts a tapped back arrow as a return", () => {
    const { result } = renderHook(() => useWorkAreaOrigin("manage"));
    act(() => {
      recordWorkPageVisit(page("rost", "/roster"), false);
      recordWorkPageVisit(page("manage", "/roster/manage"), true);
      recordWorkPageVisit(page("open", "/open-shifts"), true);
      markWorkReturn();
      recordWorkPageVisit(page("manage", "/roster/manage"), true);
    });
    expect(result.current).toEqual(page("rost", "/roster"));
  });
});
