import { describe, expect, it } from "vitest";

import {
  WORK_AREAS,
  workAreaFor,
  workAreaItems,
  workAreaParent,
  workFrameCurrentItem,
  workFrameExtraTabs,
  workFrameTabLabel,
  workFrameTabRow,
  parseWorkTabPicks,
} from "@/lib/work-frame/areas";
import { searchWorkPages, workSearchPages } from "@/lib/work-search/pages";

// Navigation follow-up, owner request 7 Oct 2026: the fourth tab names the More
// page you're on, big groups are inner areas with their own tabs, and a swipe
// reaches the open More page.
describe("work frame navigation", () => {
  const areas = Object.values(WORK_AREAS);

  it("gives every More page a fourth-tab name short enough for a 320px phone", () => {
    for (const area of areas) {
      for (const item of area.groups.flatMap((group) => group.items)) {
        // Only pages that can be current under the band ever name the fourth tab.
        const canBeCurrent =
          item.href && !item.action && !item.opens && item.band !== false && item.paths?.length !== 0;
        if (!canBeCurrent) continue;
        expect(workFrameTabLabel(item).length, `${area.name}: ${item.label}`).toBeLessThanOrEqual(11);
      }
    }
  });

  it("links every inner area from its parent's More, and back to that parent", () => {
    const inner = areas.filter((area) => area.parent);
    expect(inner.map((area) => area.id).sort()).toEqual(["assess", "manage", "notify", "open"]);
    for (const area of inner) {
      const parent = workAreaParent(area)!;
      const entry = workAreaItems(parent).find((item) => item.opens === area.id);
      expect(entry, `${parent.name} opens ${area.name}`).toBeDefined();
      expect(entry!.href?.split("?")[0]).toBe(area.tabs[0].href?.split("?")[0]);
      // An entry row is never the current page in the parent.
      expect(entry!.paths).toEqual([]);
    }
    for (const area of areas)
      for (const item of workAreaItems(area))
        if (item.opens) expect(WORK_AREAS[item.opens].parent, item.label).toBe(area.id);
  });

  it("draws Manage team and Open shifts as their own areas, with views as tabs", () => {
    const manage = workAreaFor("roster", "/roster/manage");
    expect(manage?.id).toBe("manage");
    expect(workFrameCurrentItem(manage!, "/roster/manage", "")?.label).toBe("Inbox");
    expect(workFrameCurrentItem(manage!, "/roster/manage", "view=cover")?.label).toBe("Cover");
    expect(workFrameCurrentItem(manage!, "/roster/manage", "?view=team&team=a")?.label).toBe("Team");
    expect(workAreaFor("roster", "/roster/requests")?.id).toBe("rost");
    expect(workAreaFor("open-shifts", "/open-shifts/mine")?.id).toBe("open");
  });

  // Alerts work, owner approval 7 Oct 2026: one Notifications area inside My Day
  // (To do, Earlier, Settings) for the new work mode; classic readers keep Needs
  // you and Alerts in My Day's More.
  it("draws Notifications inside My Day and keeps My Day's old pages for classic readers", () => {
    expect(workAreaFor("my-day", "/my-day/notifications")?.id).toBe("notify");
    expect(workAreaFor("my-day", "/my-day/notifications/earlier")?.id).toBe("notify");
    expect(workAreaFor("my-day", "/my-day/notificationsx")?.id).toBe("day");
    expect(workAreaFor("my-day", "/my-day/alerts")?.id).toBe("day");
    const notify = WORK_AREAS.notify;
    expect(notify.parent).toBe("day");
    expect(notify.tabs.map((tab) => [tab.label, tab.href])).toEqual([
      ["To do", "/my-day/notifications"],
      ["Earlier", "/my-day/notifications/earlier"],
      ["Settings", "/my-day/notifications/settings"],
    ]);
    const day = workAreaItems(WORK_AREAS.day);
    const byId = (id: string) => day.find((item) => item.id === id);
    expect(byId("my-day-notifications")?.opens).toBe("notify");
    expect(byId("my-day-all")?.gate).toBe("classic-work-mode");
    expect(byId("my-day-alerts")?.gate).toBe("classic-work-mode");
    expect(byId("my-day-earlier-alerts")).toBeUndefined();
  });

  it("offers the next plain pages from More as extra tabs for wider screens", () => {
    const labels = (id: keyof typeof WORK_AREAS) => workFrameExtraTabs(WORK_AREAS[id]).map((item) => item.label);
    expect(labels("rost").slice(0, 3)).toEqual(["Today", "My shifts", "Leave"]);
    // Pages with their own header, inner areas and links into other areas never become tabs.
    expect(labels("rost")).not.toContain("Calendar sync");
    expect(labels("rost")).not.toContain("Open shifts");
    expect(labels("admin")).not.toContain("Overtime");
    expect(labels("day")).not.toContain("Reminders");
    const hours = workFrameCurrentItem(WORK_AREAS.rost, "/roster", "view=hours")!;
    expect(workFrameTabLabel(hours)).toBe("Hours");
  });

  it("lists inner area pages in AI Search, but never a manager's pages", () => {
    const ids = workSearchPages().map((page) => page.id);
    expect(ids).toContain("open:open-shifts-browse");
    expect(ids.some((id) => id.startsWith("manage:"))).toBe(false);
    expect(searchWorkPages("locum")[0]?.page.href).toBe("/open-shifts");
  });

  it("puts the reader's chosen tabs first, then the area's own, then the rest by width", () => {
    const all = () => true;
    const ids = (row: ReturnType<typeof workFrameTabRow>) =>
      [row.first, row.extras].map((items) => items.map((item) => item.id));
    const own = workFrameTabRow(WORK_AREAS.rost, undefined, all);
    expect(own.first.map((item) => item.id)).toEqual(WORK_AREAS.rost.tabs.map((item) => item.id));
    const leave = workFrameTabRow(WORK_AREAS.rost, ["requests"], all);
    expect(ids(leave)[0]).toEqual(["requests", ...WORK_AREAS.rost.tabs.slice(0, 2).map((item) => item.id)]);
    // The displaced own tab leads the extras; nothing shows twice, never more than six.
    expect(ids(leave)[1][0]).toBe(WORK_AREAS.rost.tabs[2].id);
    expect(new Set([...ids(leave)[0], ...ids(leave)[1]]).size).toBe(leave.first.length + leave.extras.length);
    expect(leave.first.length + leave.extras.length).toBeLessThanOrEqual(6);
    // Gone, gated or repeated picks are skipped, and the row still starts with three.
    const odd = workFrameTabRow(WORK_AREAS.rost, ["nope", "requests", "requests"], (item) => item.id !== "month");
    expect(odd.first.map((item) => item.id)).toEqual(["requests", "team", "swaps"]);
  });

  it("reads stored tab picks defensively", () => {
    expect(parseWorkTabPicks(null)).toEqual({});
    expect(parseWorkTabPicks("not json")).toEqual({});
    expect(parseWorkTabPicks("[1,2]")).toEqual({});
    expect(parseWorkTabPicks(JSON.stringify({ rost: ["a", "a", 3, "b", "c", "d"], nowhere: ["x"] }))).toEqual({
      rost: ["a", "b", "c"],
    });
  });
});
