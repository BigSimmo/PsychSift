import { describe, expect, it } from "vitest";

import { exitStatusForStaleReport } from "../scripts/check-stale-docs.mjs";

describe("check-stale-docs", () => {
  it("exits 1 when a stale doc was found", () => {
    expect(exitStatusForStaleReport({ stale: [{ path: "docs/old.md" }] })).toBe(1);
  });

  it("exits 0 when nothing is stale", () => {
    expect(exitStatusForStaleReport({ stale: [] })).toBe(0);
    expect(exitStatusForStaleReport({})).toBe(0);
  });
});
