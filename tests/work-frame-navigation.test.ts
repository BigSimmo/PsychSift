import { describe, expect, it } from "vitest";

import {
  WORK_AREAS,
  workAreaFor,
  workAreaItems,
  workAreaParent,
  workFrameCurrentItem,
  workFrameExtraTabs,
  workFrameTabLabel,
} from "@/lib/work-frame/areas";

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
    expect(inner.map((area) => area.id).sort()).toEqual(["assess", "manage", "open"]);
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
});
