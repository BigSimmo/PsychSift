import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function classify(files: string[]) {
  return JSON.parse(
    execFileSync(process.execPath, ["scripts/ci-change-scope.mjs", "--json", "--files", ...files], {
      encoding: "utf8",
    }),
  ) as Record<string, boolean | string[]>;
}

describe("site-content CI change scope", () => {
  it.each([
    "src/lib/site-content/adapters/index.ts",
    "src/lib/site-content/site-content-registry.ts",
    "src/lib/specifiers-content.ts",
    "src/data/dsm-clinical-content.json",
    "src/data/formulation-content.json",
    "src/data/therapies-source.json",
    "src/lib/dictionary-data.ts",
    "src/components/factsheets/factsheets-data.ts",
    "src/components/calculators/calculator-fixtures.ts",
    "src/lib/tools-catalog.ts",
    "src/lib/registry-corpus.ts",
    "scripts/embed-registry-records.ts",
    "src/lib/retrieval-selection.ts",
  ])("selects bounded manifest and domain-fixture validation for %s", (file) => {
    expect(classify([file]).site_content_changed).toBe(true);
  });

  it("keeps the workflow and selector self-selecting", () => {
    expect(classify([".github/workflows/ci.yml"]).site_content_changed).toBe(true);
    expect(classify(["scripts/ci-change-scope.mjs"]).site_content_changed).toBe(true);
  });

  it.each([
    "docs/testing.md",
    "src/components/clinical-dashboard/dashboard-nav.tsx",
    "src/lib/app-modes.ts",
    "tests/ward-clock.test.ts",
  ])("does not treat unrelated repository change %s as a site re-index trigger", (file) => {
    expect(classify([file]).site_content_changed).toBe(false);
  });
});
