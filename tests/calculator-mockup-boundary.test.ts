import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe("mockup import boundary", () => {
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
