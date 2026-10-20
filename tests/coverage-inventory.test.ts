import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  checkCoverageInventory,
  coverageSourceFiles,
  lcovSourceFiles,
  missingCoverageRoots,
} from "../scripts/check-coverage-inventory.mjs";
import {
  COVERAGE_EXCLUDE_GLOBS,
  COVERAGE_INCLUDE_GLOBS,
  COVERAGE_INVENTORY_ROOTS,
} from "../scripts/coverage-contract.mjs";

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
    const result = checkCoverageInventory(completeLcov, { expectedFiles: lcovSourceFiles(completeLcov) });
    expect(result.missing).toEqual([]);
    expect(result.missingFiles).toEqual([]);
    expect(result.sourceFiles).toHaveLength(4);
  });

  it("rejects plausible root sentinels when actual executable files are missing", () => {
    const result = checkCoverageInventory(completeLcov);
    expect(result.missing).toEqual([]);
    expect(result.missingFiles).toContain("scripts/check-coverage-inventory.mjs");
    expect(result.missingFiles).toContain("supabase/functions/ingestion-worker/index.ts");
  });

  it("rejects loss of one executable file even when every root remains", () => {
    const expectedFiles = [...lcovSourceFiles(completeLcov), "src/lib/uncovered.ts"];
    expect(checkCoverageInventory(completeLcov, { expectedFiles }).missingFiles).toEqual(["src/lib/uncovered.ts"]);
  });

  it("shares only documented non-executable/generated exclusions with Vitest", () => {
    expect(COVERAGE_EXCLUDE_GLOBS).toEqual(["**/*.d.ts", "src/lib/supabase/database.types.ts"]);
    expect(coverageSourceFiles()).not.toContain("src/lib/supabase/database.types.ts");
    const config = readFileSync(new URL("../vitest.config.mts", import.meta.url), "utf8");
    expect(config).toContain("exclude: [...COVERAGE_EXCLUDE_GLOBS]");
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

  it("keeps conservative whole-repository floors alongside scoped ratchets", () => {
    const config = readFileSync(new URL("../vitest.config.mts", import.meta.url), "utf8");
    expect(config).toMatch(/thresholds:\s*\{\s*\/\/[\s\S]*?statements: 52,[\s\S]*?branches: 49,/);
    expect(config).toMatch(/functions: 54,[\s\S]*?lines: 53,/);
    expect(config).toContain('"src/{lib/**/*.ts,app/**/route.ts,components/**/*.{ts,tsx}}"');
  });
});
