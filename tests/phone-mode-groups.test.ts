import { describe, expect, it } from "vitest";

import { appModeIds, type AppModeId } from "@/lib/app-modes";
import {
  clinicalBandAttribute,
  modeMenuSideForMode,
  modeMenuSides,
  orderByPhoneModeGroups,
  orderModesForSide,
  phoneModeGroups,
  phoneModeGroupsForSide,
} from "@/lib/phone-mode-groups";

/**
 * The phone mode sheet renders a grouped list rather than the flat
 * `appModeDefinitions` the desktop menu uses, so it carries its own copy of the
 * mode ids. The render loop drops any mode no group names, and the `satisfies`
 * constraint on `phoneModeGroups` checks membership without checking
 * exhaustiveness — so a mode added to the registry and forgotten here vanishes
 * from every phone with nothing going red.
 *
 * That is exactly what happened to Sources. These cases are the missing gate.
 */
describe("phone mode groups", () => {
  const groupedModeIds = phoneModeGroups.flatMap((group) => group.modeIds as readonly AppModeId[]);

  it("reaches every app mode", () => {
    expect([...groupedModeIds].sort()).toEqual([...appModeIds].sort());
  });

  it("places each mode in exactly one group", () => {
    const seen = new Map<AppModeId, number>();
    for (const modeId of groupedModeIds) seen.set(modeId, (seen.get(modeId) ?? 0) + 1);
    expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([]);
  });

  it("names only real modes, under unique group ids", () => {
    for (const modeId of groupedModeIds) expect(appModeIds).toContain(modeId);
    const groupIds = phoneModeGroups.map((group) => group.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
  });

  it("draws Clinical as Search, Psychiatry, Medicines and the library, and Work as one list with On Call in it", () => {
    const groupOf = (modeId: AppModeId) =>
      phoneModeGroups.find((group) => (group.modeIds as readonly AppModeId[]).includes(modeId));
    expect(modeMenuSides.map((side) => side.id)).toEqual(["clinical", "work"]);
    expect(phoneModeGroupsForSide("clinical").map((group) => group.id)).toEqual([
      "find",
      "psychiatry",
      "care",
      "library",
    ]);
    expect(phoneModeGroupsForSide("work").map((group) => group.id)).toEqual(["work"]);
    expect(groupOf("on-call")?.side).toBe("work");
    expect(groupOf("my-day")).toMatchObject({
      id: "work",
      showHeading: false,
      modeIds: ["my-day", "on-call", "open-shifts", "roster", "teaching", "cme", "my-work"],
    });
    expect(groupOf("first-nations")?.id).toBe("psychiatry");
    expect(groupOf("prescribing")).toMatchObject({ id: "care", label: "Medicines" });
    expect(groupOf("answer")?.modeIds).toEqual(["answer", "documents", "services"]);
    expect(groupOf("favourites")?.modeIds).toEqual(["favourites", "sources"]);
    expect(groupOf("medicines")?.modeIds).toEqual(["medicines", "prescribing", "factsheets"]);
    // Rating scales and psychiatric terms sit with Psychiatry (audit item 8).
    expect(groupOf("calculators")?.id).toBe("psychiatry");
    expect(groupOf("dictionary")?.id).toBe("psychiatry");
    // The Tools page is retired: still a Clinical mode for old links, never drawn.
    expect(groupOf("tools")).toMatchObject({ id: "retired", drawn: false });
    expect(modeMenuSideForMode("tools")).toBe("clinical");
    expect(phoneModeGroupsForSide("clinical").flatMap((group) => group.modeIds)).not.toContain("tools");
    expect(phoneModeGroups.map((group) => group.id)).toEqual([
      "find",
      "psychiatry",
      "care",
      "library",
      "retired",
      "work",
    ]);
    expect(modeMenuSideForMode("on-call")).toBe("work");
    expect(modeMenuSideForMode("answer")).toBe("clinical");
  });

  it("orders modes the way the grouped menus draw them, for arrow-key focus", () => {
    const registryOrder = appModeIds.map((id) => ({ id }));
    const drawnModeIds = phoneModeGroups
      .filter((group) => group.drawn)
      .flatMap((group) => group.modeIds as readonly AppModeId[]);
    // Undrawn (retired) modes sort after everything drawn rather than vanishing.
    expect(orderByPhoneModeGroups(registryOrder).map((mode) => mode.id)).toEqual([...drawnModeIds, "tools"]);
    // A session that hides some modes keeps the drawn order for the rest: Clinical, then Work.
    const someModes = (["cme", "psychiatry", "forms", "answer"] as const).map((id) => ({ id }));
    expect(orderByPhoneModeGroups(someModes).map((mode) => mode.id)).toEqual(["answer", "psychiatry", "forms", "cme"]);
    expect(orderModesForSide(someModes, "work").map((mode) => mode.id)).toEqual(["cme"]);
    expect(orderModesForSide(someModes, "clinical").map((mode) => mode.id)).toEqual(["answer", "psychiatry", "forms"]);
  });
});

describe("clinicalBandAttribute", () => {
  it("tints a Clinical page", () => {
    expect(clinicalBandAttribute("dictionary", "/dictionary", false)).toBe("");
  });

  it("leaves the shared home, Work areas and Work modes untinted", () => {
    expect(clinicalBandAttribute("dictionary", "/", false)).toBeUndefined();
    expect(clinicalBandAttribute("dictionary", null, false)).toBeUndefined();
    expect(clinicalBandAttribute("dictionary", "/admin", true)).toBeUndefined();
    expect(clinicalBandAttribute("roster", "/roster", false)).toBeUndefined();
  });
});
