import { describe, expect, it } from "vitest";

import { scanOffendingLines, sourceFiles } from "./helpers/type-weight-scanner";

const ADMIN_ROOTS = ["src/components/admin", "src/lib/admin", "src/app/(search-app)/admin"];

/** Renewals renders On Call's compliance section, so Task 6 appends that file here. */
const ADMIN_WEIGHT_FILES: readonly string[] = sourceFiles(ADMIN_ROOTS);

/**
 * Standard §1: 400 body, 500 names and labels, 600 headings and buttons, nothing heavier.
 * `<b>` and `<strong>` render 700 under Tailwind's preflight, and arbitrary `font-[NNN]`
 * adds a weight off the token scale.
 */
const HEAVIER_THAN_600 =
  /\bfont-(?:bold|extrabold|black)\b|--font-weight-value|\bfont-\[\d+\]|fontWeight:\s*["']?(?:bold|[7-9]00|6[1-9]\d)|<(?:b|strong)[\s>]/;

describe("Admin type weights (standard §1)", () => {
  it("has Admin files to read", () => {
    expect(ADMIN_WEIGHT_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it("uses no weight above 600", () => {
    expect(scanOffendingLines(ADMIN_WEIGHT_FILES, HEAVIER_THAN_600)).toEqual([]);
  });
});
