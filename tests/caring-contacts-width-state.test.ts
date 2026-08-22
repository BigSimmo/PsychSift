import { describe, expect, it } from "vitest";

import { WORKSPACE_WIDTH_BREAKPOINTS, widthStateFor } from "@/components/caring-contacts/workspace/width-state";

describe("frozen width-to-state mapping", () => {
  it("maps each required review width to its frozen state", () => {
    expect(widthStateFor(320)).toBe("compact");
    expect(widthStateFor(390)).toBe("compact");
    expect(widthStateFor(430)).toBe("compact");
    expect(widthStateFor(768)).toBe("rail");
    expect(widthStateFor(1024)).toBe("split");
    expect(widthStateFor(1440)).toBe("wide");
    expect(widthStateFor(1920)).toBe("wide");
  });

  it("treats 390 and 430 as compact samples, not additional states", () => {
    expect(new Set([widthStateFor(320), widthStateFor(390), widthStateFor(430)]).size).toBe(1);
  });

  it("changes state exactly at the frozen boundaries", () => {
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.rail - 1)).toBe("compact");
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.split - 1)).toBe("rail");
    expect(widthStateFor(WORKSPACE_WIDTH_BREAKPOINTS.wide - 1)).toBe("split");
  });
});
