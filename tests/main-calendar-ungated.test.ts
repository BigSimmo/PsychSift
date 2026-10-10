import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WORK_AREAS, workAreaItems } from "@/lib/work-frame/areas";
import { NEW_WORK_MODE_ROUTES, workModeRouteHidden } from "@/lib/work-mode-launch/routes";

/* The one calendar ships on for everyone: no live-version preview and no launch gate. */
describe("My Day calendar has no gate", () => {
  it("lists the Calendar item without a gate", () => {
    const item = Object.values(WORK_AREAS)
      .flatMap((area) => workAreaItems(area))
      .find((entry) => entry.href === "/my-day/calendar");
    expect(item).toBeDefined();
    expect(item?.gate).toBeUndefined();
  });

  it("is not held back by the launch switch", () => {
    expect(NEW_WORK_MODE_ROUTES.some((entry) => entry.path === "/my-day/calendar")).toBe(false);
    expect(workModeRouteHidden("/my-day/calendar", { newWorkMode: false })).toBe(false);
  });

  it("does not check a preview on the page or the week card", () => {
    for (const file of [
      "src/app/(search-app)/my-day/calendar/page.tsx",
      "src/components/my-day/my-day-week-page.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/live-version|LivePreview|useWorkModeRouteVisible/);
    }
  });
});
