import { describe, expect, it } from "vitest";

import {
  cmeDashboardModuleIds,
  defaultCmeModuleOrder,
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
    const originalIndex = order.indexOf("audited-today");

    const movedUp = moveModuleId(order, "audited-today", -1);
    expect(movedUp.indexOf("audited-today")).toBe(originalIndex - 1);

    const movedDown = moveModuleId(order, "audited-today", 1);
    expect(movedDown.indexOf("audited-today")).toBe(originalIndex + 1);
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

describe("canMoveModuleId", () => {
  it("allows a move only past a neighbour in the same Today section", async () => {
    const { canMoveModuleId } = await import("@/lib/cme/module-order");
    const order = ["requirements", "routines-due", "audited-today", "year-dates", "provenance"] as const;
    expect(canMoveModuleId(order, "requirements", 1)).toBe(false);
    expect(canMoveModuleId(order, "routines-due", -1)).toBe(false);
    expect(canMoveModuleId(order, "routines-due", 1)).toBe(false);
    expect(canMoveModuleId(order, "audited-today", 1)).toBe(true);
    expect(canMoveModuleId(order, "provenance", 1)).toBe(false);
  });
});
