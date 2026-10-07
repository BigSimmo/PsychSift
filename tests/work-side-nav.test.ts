import { describe, expect, it } from "vitest";

import { workAreaIdForPath } from "@/lib/work-frame/areas";
import {
  WORK_SIDE_AREAS,
  workSideAreaId,
  workSideBadgeText,
  workSideCountLabel,
  workSideCounts,
} from "@/lib/work-frame/side-nav";

describe("work side menu and rail", () => {
  it("lists the seven work areas in the mockup's order, each opening its area's first tab", () => {
    expect(WORK_SIDE_AREAS.map((entry) => entry.label)).toEqual([
      "My Day",
      "On Call",
      "Open shifts",
      "Roster",
      "Teaching",
      "CPD",
      "Admin",
    ]);
    for (const entry of WORK_SIDE_AREAS) expect(entry.href.startsWith("/")).toBe(true);
    expect(WORK_SIDE_AREAS.find((entry) => entry.id === "admin")?.href).toBe("/admin");
  });

  it("lights the parent's row for inner areas that are not modes", () => {
    expect(workSideAreaId("manage")).toBe("rost");
    expect(workSideAreaId("assess")).toBe("teach");
    expect(workSideAreaId("open")).toBe("open");
    expect(workSideAreaId("day")).toBe("day");
    expect(workSideAreaId("notify")).toBe("day");
  });

  it("finds the most specific area for an address", () => {
    expect(workAreaIdForPath("/roster")).toBe("rost");
    expect(workAreaIdForPath("/roster/manage")).toBe("manage");
    expect(workAreaIdForPath("/teaching/assessments")).toBe("assess");
    expect(workAreaIdForPath("/open-shifts")).toBe("open");
    expect(workAreaIdForPath("/dsm")).toBeNull();
  });

  it("counts each item once under the area its page belongs to", () => {
    const counts = workSideCounts([
      { href: "/roster/swaps", overdue: false },
      { href: "/roster/manage?view=cover", overdue: true },
      { href: "/teaching/assessments", overdue: false },
      { href: "/admin/renewals#x", overdue: true },
      { href: "/my-day/alerts", overdue: false },
      { href: "/my-day/notifications/earlier", overdue: false },
      { href: "/dsm", overdue: false },
    ]);
    expect(counts.rost).toEqual({ total: 2, overdue: 1 });
    expect(counts.teach).toEqual({ total: 1, overdue: 0 });
    expect(counts.admin).toEqual({ total: 1, overdue: 1 });
    expect(counts.day).toBeUndefined();
    expect(counts.manage).toBeUndefined();
  });

  it("says counts in plain words and caps the badge", () => {
    expect(workSideCountLabel({ total: 3, overdue: 1 })).toBe("3 waiting, 1 overdue");
    expect(workSideCountLabel({ total: 2, overdue: 0 })).toBe("2 waiting");
    expect(workSideCountLabel(undefined)).toBe("");
    expect(workSideBadgeText(7)).toBe("7");
    expect(workSideBadgeText(120)).toBe("99+");
  });
});
