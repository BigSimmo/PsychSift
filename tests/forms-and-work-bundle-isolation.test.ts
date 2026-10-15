import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import mhaSections from "../data/mha-2014-sections.json";
import { ACT_SECTION_CHIP_LIMIT, mhaActMetadata, PRIORITY_FACT_CARD_LABELS } from "@/lib/form-catalog-constants";
import {
  ACT_SECTION_CHIP_LIMIT as reexportedLimit,
  PRIORITY_FACT_CARD_LABELS as reexportedLabels,
} from "@/lib/form-catalog";

const ROOT = process.cwd();

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Forms and Work client bundle isolation", () => {
  it("keeps form-catalog-constants.ts free of JSON imports and aligned with mha-2014-sections.json", () => {
    const constantsSource = readWorkspaceFile("src/lib/form-catalog-constants.ts");

    expect(constantsSource).not.toMatch(/\.json["']/);
    expect(PRIORITY_FACT_CARD_LABELS).toEqual({
      clock: "Clock / review",
      authority: "Made by / authority",
      criteria: "Criteria / threshold",
    });
    expect(ACT_SECTION_CHIP_LIMIT).toBe(6);
    expect(reexportedLabels).toEqual(PRIORITY_FACT_CARD_LABELS);
    expect(reexportedLimit).toBe(ACT_SECTION_CHIP_LIMIT);
    expect(mhaActMetadata).toEqual({
      actVersion: mhaSections.exportMetadata.actVersion,
      actAsAt: mhaSections.exportMetadata.actAsAt,
      sourceUrl: mhaSections.exportMetadata.sourceUrl,
    });
  });

  it("prevents form-priority-facts-section.tsx from pulling form-catalog or mha-act-sections into client bundles", () => {
    const source = readWorkspaceFile("src/components/forms/form-priority-facts-section.tsx");

    expect(source).not.toMatch(/from\s+["']@\/lib\/form-catalog["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/mha-act-sections["']/);
    expect(source).toMatch(/from\s+["']@\/lib\/form-catalog-constants["']/);
    expect(source).toMatch(/from\s+["']@\/lib\/form-ranker["']/);
    expect(source).toContain("ignoreUnavailableActivation");
    expect(source).toContain('aria-disabled="true"');
    expect(source).toContain("onClick={ignoreUnavailableActivation}");
    expect(source).not.toContain('rel="noreferrer"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain("form-act-section-overflow-drafted-");
    expect(source).toContain("Awaiting clinical review");
  });

  it("keeps my-day-week-page.tsx isolated from my-day-today-cards and removes the dead month view branch", () => {
    const source = readWorkspaceFile("src/components/my-day/my-day-week-page.tsx");

    expect(source).not.toContain("my-day-today-cards");
    expect(source).not.toContain('view === "month"');
    expect(source).not.toContain("<MonthView");
  });

  it("loads sample assessment screens in teaching-assessments.tsx via next/dynamic instead of top-level static imports", () => {
    const source = readWorkspaceFile("src/components/teaching/assessments/teaching-assessments.tsx");

    const sampleModules = [
      "@/components/teaching/assessments/assessments-assessor",
      "@/components/teaching/assessments/assessments-home",
      "@/components/teaching/assessments/assessments-year",
      "@/components/teaching/assessments/assessments-form",
      "@/components/teaching/assessments/assessments-steps",
      "@/components/teaching/assessments/assessments-report",
      "@/components/teaching/assessments/assessments-supervisor",
      "@/components/teaching/assessments/assessments-inbox",
      "@/components/teaching/assessments/assessments-term-overview",
    ];

    for (const modulePath of sampleModules) {
      expect(source).not.toMatch(new RegExp(`^import\\s+(?!type\\b).*from\\s+["']${modulePath}["']`, "m"));
      expect(source).toContain(`import("${modulePath}")`);
    }
    expect(source).not.toMatch(
      /^import\s+\{[^}]*\b(DctHome|DctPlan|DctSignoff)\b[^}]*\}\s+from\s+["']@\/components\/teaching\/assessments\/assessments-dct["']/m,
    );
    expect(source).toContain('import("@/components/teaching/assessments/assessments-dct")');
  });
});
