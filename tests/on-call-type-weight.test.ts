import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { relativeSourceFiles, scanOffendingLines } from "./helpers/type-weight-scanner";

/**
 * Nothing on an On Call page is heavier than 600 (owner 16:01Z; standard §1;
 * plan Global Constraint 14): no `font-bold`, `font-extrabold` or `font-black`,
 * and no arbitrary weight of 650 or more. The pill's own lines are guarded in
 * `tests/mode-pages-sheet-classes.test.ts`.
 */
const HEAVY = /\bfont-(bold|extrabold|black)\b|font-\[(6[5-9]\d|[7-9]\d\d)\]|font-\[var\(--font-weight-value\)\]/;
const ROOTS = ["src/components/on-call", "src/app/(search-app)/on-call"];

/** Files a page lane owns and clears in its own build; Task 6 empties this set. */
const LANE_PENDING = new Set<string>([]);

/** Teaching moves to Teaching mode; no new work here (owner). */
const FROZEN_TEACHING = new Set(["src/components/on-call/on-call-teaching-strip.tsx"]);

const files = relativeSourceFiles(ROOTS);

describe("On Call type weight", () => {
  it("scans the On Call components and routes", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("uses nothing heavier than 600 outside the files a lane still owns", () => {
    const activeFiles = files.filter((file) => !LANE_PENDING.has(file) && !FROZEN_TEACHING.has(file));
    expect(scanOffendingLines(activeFiles, HEAVY, { format: "space", useRepoRelative: false })).toEqual([]);
  });

  it("keeps the exemption lists honest: every listed file exists and still needs its exemption", () => {
    for (const file of [...LANE_PENDING, ...FROZEN_TEACHING]) {
      expect(files, `${file} is exempt but no longer exists; remove it from the list`).toContain(file);
      expect(HEAVY.test(readFileSync(file, "utf8")), `${file} is clean now; remove it from the exemption list`).toBe(
        true,
      );
    }
  });
});
