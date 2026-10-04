import { describe, expect, it } from "vitest";

import { appModeIds, type AppModeId } from "@/lib/app-modes";
import { orderByPhoneModeGroups, phoneModeGroups } from "@/lib/phone-mode-groups";

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

  it("draws five doors: My Day with the work areas, On Call alone, then Search, Psychiatry, Medicines & tools", () => {
    const groupOf = (modeId: AppModeId) =>
      phoneModeGroups.find((group) => (group.modeIds as readonly AppModeId[]).includes(modeId));
    // Modes review, phase 1: the work areas sit behind My Day, which leads.
    expect(groupOf("my-day")).toMatchObject({
      id: "my-day",
      label: "My Day",
      modeIds: ["my-day", "roster", "teaching", "cme", "my-work"],
    });
    // On Call stays a door of its own, second, so the urgent screen is never buried.
    expect(groupOf("on-call")).toMatchObject({ id: "on-call", label: "On Call", modeIds: ["on-call"] });
    // First Nations culturally safe care is clinical guidance, beside diagnosis and formulation.
    expect(groupOf("first-nations")?.id).toBe("psychiatry");
    expect(groupOf("prescribing")).toMatchObject({ id: "care", label: "Medicines & tools" });
    expect(phoneModeGroups.map((group) => group.id)).toEqual(["my-day", "on-call", "find", "psychiatry", "care"]);
  });

  it("orders modes the way the grouped menus draw them, for arrow-key focus", () => {
    const registryOrder = appModeIds.map((id) => ({ id }));
    expect(orderByPhoneModeGroups(registryOrder).map((mode) => mode.id)).toEqual(groupedModeIds);
    // A session that hides some modes keeps the drawn order for the rest.
    const someModes = (["cme", "psychiatry", "forms", "answer"] as const).map((id) => ({ id }));
    expect(orderByPhoneModeGroups(someModes).map((mode) => mode.id)).toEqual(["cme", "answer", "psychiatry", "forms"]);
  });
});
