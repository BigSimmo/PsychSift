import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";

import { checkCoverageInventory, lcovSourceFiles, missingCoverageRoots } from "../scripts/check-coverage-inventory.mjs";
import { COVERAGE_INCLUDE_GLOBS, COVERAGE_INVENTORY_ROOTS } from "../scripts/coverage-contract.mjs";

const completeLcov = [
  "TN:",
  "SF:src/lib/example.ts",
  "end_of_record",
  "SF:scripts/example.mjs",
  "end_of_record",
  "SF:worker/main.ts",
  "end_of_record",
  "SF:supabase/functions/example/index.ts",
  "end_of_record",
].join("\n");

describe("coverage inventory", () => {
  it("accepts LCOV containing every declared executable root", () => {
    const result = checkCoverageInventory(completeLcov);
    expect(result.missing).toEqual([]);
    expect(result.sourceFiles).toHaveLength(4);
  });

  it("fails closed when Supabase Edge Functions disappear", () => {
    const files = lcovSourceFiles(completeLcov).filter((file: string) => !file.startsWith("supabase/functions/"));
    expect(missingCoverageRoots(files)).toEqual(["supabase/functions/"]);
  });

  it("normalizes Windows LCOV paths", () => {
    expect(lcovSourceFiles("SF:supabase\\functions\\worker\\index.ts\nend_of_record\n")).toEqual([
      "supabase/functions/worker/index.ts",
    ]);
  });

  it("keeps every inventory root represented by a shared include glob", () => {
    for (const root of COVERAGE_INVENTORY_ROOTS) {
      expect(COVERAGE_INCLUDE_GLOBS.some((glob) => glob.startsWith(root))).toBe(true);
    }
  });

  it.each([
    "src/lib/answer-pilot-budget.js",
    "src/lib/answer-pilot-diagnostic.js",
    "src/lib/answer-pilot-ticket.js",
    "src/lib/answer-wire-budget-guard.js",
  ])("includes the production budget-control module %s in measured coverage", (file) => {
    expect(COVERAGE_INCLUDE_GLOBS.some((glob) => matchesGlob(file, glob))).toBe(true);
  });

  it("rejects an LCOV report that has every root but omits production budget controls", () => {
    const result = checkCoverageInventory(completeLcov);
    expect(result.missingFiles).toContain("src/lib/answer-pilot-budget.js");
  });

  it("accepts an LCOV report containing every required production budget control", () => {
    const controls = [
      "answer-pilot-budget",
      "answer-pilot-diagnostic",
      "answer-pilot-ticket",
      "answer-wire-budget-guard",
    ]
      .map((name) => `SF:src/lib/${name}.js\nend_of_record`)
      .join("\n");
    expect(checkCoverageInventory(`${completeLcov}\n${controls}`).missingFiles).toEqual([]);
  });

  it("keeps conservative whole-repository floors alongside scoped ratchets", () => {
    const config = readFileSync(new URL("../vitest.config.mts", import.meta.url), "utf8");
    expect(config).toMatch(/thresholds:\s*\{\s*\/\/[\s\S]*?statements: 52,[\s\S]*?branches: 49,/);
    expect(config).toMatch(/functions: 54,[\s\S]*?lines: 53,/);
    expect(config).toContain('"src/{lib/**/*.ts,app/**/route.ts,components/**/*.{ts,tsx}}"');
  });
});
