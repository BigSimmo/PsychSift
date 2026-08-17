import { describe, expect, it } from "vitest";

import { defaultSidebarPinnedModeIds, readSidebarPinnedModes } from "@/components/clinical-dashboard/use-sidebar-pins";

describe("sidebar pin persistence", () => {
  it("uses the six product defaults for missing or malformed preferences", () => {
    expect(readSidebarPinnedModes(null)).toEqual(defaultSidebarPinnedModeIds);
    expect(readSidebarPinnedModes("not-json")).toEqual(defaultSidebarPinnedModeIds);
    expect(readSidebarPinnedModes(JSON.stringify({ answer: true }))).toEqual(defaultSidebarPinnedModeIds);
  });

  it("keeps an intentional empty list and removes unknown or duplicate mode ids", () => {
    expect(readSidebarPinnedModes("[]")).toEqual([]);
    expect(readSidebarPinnedModes(JSON.stringify(["forms", "unknown", "forms", "answer"]))).toEqual([
      "forms",
      "answer",
    ]);
  });
});
