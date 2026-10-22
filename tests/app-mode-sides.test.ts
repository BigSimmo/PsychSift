import { describe, expect, it } from "vitest";

import { ALERT_AREAS } from "@/lib/alerts/areas";
import { appModeDefinitions, appModeSide, type AppModeId } from "@/lib/app-modes";
import { myDaySourceModes } from "@/lib/my-day/model";
import { notificationAreas } from "@/lib/needs-you/feed";
import { phoneModeGroups } from "@/lib/phone-mode-groups";
import { BELL_PHONE_AREAS } from "@/lib/reminders/settings-model";
import { workSearchAreas } from "@/lib/work-search/model";

/**
 * Each mode's own definition says which side of the app it is on (owner
 * decision, 21 Oct 2026: Clinical and Work). The Work areas used to be listed
 * by hand in several places, under different names, so a change to one could
 * miss another. The types now tie those lists to the Work side; these cases
 * catch what the types cannot (a list that is widened to `string`, or a menu
 * group drawn on the wrong side).
 */
describe("app mode sides", () => {
  const workModes = appModeDefinitions.filter((mode) => mode.side === "work").map((mode) => mode.id);

  it("puts the working day on the Work side and everything else on Clinical", () => {
    expect([...workModes].sort()).toEqual(
      ["cme", "my-day", "my-work", "on-call", "open-shifts", "roster", "teaching"].sort(),
    );
  });

  it("draws every menu group on the side its modes belong to", () => {
    for (const group of phoneModeGroups) {
      for (const modeId of group.modeIds as readonly AppModeId[]) {
        expect({ group: group.id, modeId, side: appModeSide(modeId) }).toEqual({
          group: group.id,
          modeId,
          side: group.side,
        });
      }
    }
  });

  it.each([
    ["notification areas", notificationAreas],
    ["reminder phone areas", BELL_PHONE_AREAS],
    ["My Day sources", myDaySourceModes],
    ["Work search areas", workSearchAreas],
    ["alert area colours", Object.values(ALERT_AREAS).map((area) => area.mode)],
  ] as const)("names only Work modes in the %s", (_name, modeIds) => {
    for (const modeId of modeIds) expect(workModes).toContain(modeId);
  });
});
