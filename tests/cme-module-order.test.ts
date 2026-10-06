import { describe, expect, it } from "vitest";

import {
  cmeDashboardModuleIds,
  defaultCmeModuleOrder,
  canMoveModule,
  moveModuleId,
  readCmeModuleOrder,
  toggleModuleId,
} from "@/lib/cme/module-order";

describe("CME dashboard module order", () => {
  it("shows every module, in the product default order, for a missing or malformed preference", () => {
    expect(defaultCmeModuleOrder).toEqual(cmeDashboardModuleIds);
    expect(readCmeModuleOrder(null)).toEqual([...defaultCmeModuleOrder]);
    expect(readCmeModuleOrder(undefined)).toEqual([...defaultCmeModuleOrder]);
    expect(readCmeModuleOrder("not-json")).toEqual([...defaultCmeModuleOrder]);
    expect(readCmeModuleOrder(JSON.stringify({ requirements: true }))).toEqual([...defaultCmeModuleOrder]);
  });

  it("keeps an intentional empty list — every module hidden — rather than falling back to the default", () => {
    expect(readCmeModuleOrder("[]")).toEqual([]);
  });

  it("drops unknown and duplicate ids, keeping the owner's order", () => {
    expect(readCmeModuleOrder(JSON.stringify(["provenance", "unknown", "provenance", "requirements"]))).toEqual([
      "provenance",
      "requirements",
    ]);
  });

  it("moves a module up or down by one position", () => {
    const order = [...defaultCmeModuleOrder];
    const originalIndex = order.indexOf("year-dates");

    const movedUp = moveModuleId(order, "year-dates", -1);
    expect(movedUp.indexOf("year-dates")).toBe(originalIndex - 1);

    const movedDown = moveModuleId(order, "year-dates", 1);
    expect(movedDown.indexOf("year-dates")).toBe(originalIndex + 1);
  });

  it("only moves a module past another in the same Today section", () => {
    const order = [...defaultCmeModuleOrder];
    // "What's left" (Needs you) and "Routines due" (Coming up) are in different sections.
    expect(moveModuleId(order, "requirements", 1)).toEqual(order);
    expect(canMoveModule(order, "requirements", 1)).toBe(false);
    expect(canMoveModule(order, "routines-due", -1)).toBe(false);
    // A same-section module further along is reachable even with another section's module between.
    const interleaved = ["audited-today", "routines-due", "year-dates"] as const;
    expect(moveModuleId(interleaved, "audited-today", 1)).toEqual(["year-dates", "routines-due", "audited-today"]);
    expect(canMoveModule(interleaved, "routines-due", 1)).toBe(false);
  });

  it("refuses to move a module past either end of the order", () => {
    const order = [...defaultCmeModuleOrder];
    expect(moveModuleId(order, order[0]!, -1)).toEqual(order);
    expect(moveModuleId(order, order[order.length - 1]!, 1)).toEqual(order);
  });

  it("hides a visible module and shows a hidden one again at the end of the order", () => {
    const withoutProvenance = toggleModuleId(defaultCmeModuleOrder, "provenance");
    expect(withoutProvenance).not.toContain("provenance");
    expect(withoutProvenance).toHaveLength(defaultCmeModuleOrder.length - 1);

    const restored = toggleModuleId(withoutProvenance, "provenance");
    expect(restored).toEqual([...withoutProvenance, "provenance"]);
  });
});
