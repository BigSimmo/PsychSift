import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("search workspace INP memoization and deferred filtering", () => {
  it("memoizes DSM search filtering, chapter grouping, and category counts with useDeferredValue", () => {
    const source = readWorkspaceFile("src/components/dsm/dsm-search-page.tsx");

    expect(source).toContain("useDeferredValue");
    expect(source).toContain("const deferredQuery = useDeferredValue(query)");
    expect(source).toContain("const deferredResults = useDeferredValue(queryResults)");
    expect(source).toMatch(/const\s+filtered\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+grouped\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+categoryCounts\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+totalMatchingConditions\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+filterGroups\s*=\s*useMemo\(/);
  });

  it("memoizes Dictionary catalogue filtering, letter grouping, and facet counts with useDeferredValue", () => {
    const source = readWorkspaceFile("src/components/dictionary/dictionary-catalogue-pages.tsx");

    expect(source).toContain("useDeferredValue");
    expect(source).toContain("const deferredParams = useDeferredValue(params)");
    expect(source).toMatch(/const\s+filteredEntries\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+groupedByLetter\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+categoryCounts\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+groups\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+letterGroups\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+appliedFilters\s*=\s*useMemo\(/);
  });

  it("memoizes Specifiers filtering, sorting, category counts, and facet groups with useDeferredValue", () => {
    const source = readWorkspaceFile("src/components/specifiers/specifiers-home-page.tsx");

    expect(source).toContain("useDeferredValue");
    expect(source).toContain("const deferredQuery = useDeferredValue(query)");
    expect(source).toMatch(/const\s+filteredEntries\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+sortedEntries\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+categoryCounts\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+grouped\s*=\s*useMemo\(/);
  });

  it("memoizes Medication Prescribing visible cards, grouped sections, and filter chip counts with useDeferredValue", () => {
    const source = readWorkspaceFile("src/components/clinical-dashboard/medication-prescribing-workspace.tsx");

    expect(source).toContain("useDeferredValue");
    expect(source).toContain("const deferredQuery = useDeferredValue(query)");
    expect(source).toMatch(/const\s+filterChipCounts\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+visibleCards\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+groupedSections\s*=\s*useMemo\(/);
    expect(source).toMatch(/const\s+appliedFilters\s*=\s*useMemo\(/);
  });
});
