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
    // work-mode redesign, owner request 6 Oct 2026: orders are now saved as
    // { v: 2, shown }. A list saved before "Also for you" existed says nothing
    // about it, so it shows; a v2 empty list keeps everything hidden.
    expect(readCmeModuleOrder("[]")).toEqual(["also-for-you"]);
    expect(readCmeModuleOrder(JSON.stringify({ v: 2, shown: [] }))).toEqual([]);
  });

  it("hides a module added later only when a v2 order leaves it out", () => {
    expect(readCmeModuleOrder(JSON.stringify(["requirements"]))).toEqual(["requirements", "also-for-you"]);
    expect(readCmeModuleOrder(JSON.stringify({ v: 2, shown: ["requirements"] }))).toEqual(["requirements"]);
    expect(canMoveModule([...defaultCmeModuleOrder], "also-for-you", -1)).toBe(false);
  });

  it("drops unknown and duplicate ids, keeping the owner's order", () => {
    expect(readCmeModuleOrder(JSON.stringify(["provenance", "unknown", "provenance", "requirements"]))).toEqual([
      "provenance",
      "requirements",
      // work-mode redesign, owner request 6 Oct 2026: a pre-v2 list gains the newer module.
      "also-for-you",
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
