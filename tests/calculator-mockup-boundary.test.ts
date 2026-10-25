import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const searchMockups = ["search-detail-mockup.tsx", "search-page-mockup.tsx"];
const forbiddenProductionFeatures = [
  "@/components/calculators/",
  "@/components/clinical-dashboard/",
  "@/components/mode-home-template",
  "@/components/privacy-input-notice",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe("calculator mockup import boundary", () => {
  it.each(searchMockups)("keeps %s independent from production feature modules", (file) => {
    const source = readFileSync(resolve(process.cwd(), "src/components/calculator-mockups", file), "utf8");

    for (const forbiddenImport of forbiddenProductionFeatures) {
      expect(source, `${file} imports ${forbiddenImport}`).not.toContain(forbiddenImport);
    }
  });

  it("keeps production source independent from calculator mockups", () => {
    const productionFiles = sourceFiles(resolve(process.cwd(), "src")).filter((file) => {
      const normalized = file.replaceAll("\\", "/");
      return !normalized.includes("/src/app/mockups/") && !normalized.includes("/src/components/calculator-mockups/");
    });

    for (const file of productionFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} imports calculator mockups`).not.toContain("@/components/calculator-mockups");
    }
  });

  it("keeps production source independent from src/app/mockups", () => {
    const productionFiles = sourceFiles(resolve(process.cwd(), "src")).filter((file) => {
      const normalized = file.replaceAll("\\", "/");
      return !normalized.includes("/src/app/mockups/");
    });

    for (const file of productionFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} imports from @/app/mockups`).not.toContain("@/app/mockups");
    }
  });
});
