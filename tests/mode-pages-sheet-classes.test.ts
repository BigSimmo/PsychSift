import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  modePagesCheckClass,
  modePagesGroupHeadingClass,
  modePagesIconClass,
  modePagesIconStroke,
  modePagesLabelClass,
  modePagesRowClass,
  modePagesSheetTitleClass,
  modePagesTileClass,
} from "@/components/clinical-dashboard/mode-pages-sheet-classes";

/**
 * The "<Mode> pages" level of the pill's sheet, on the 48/52 rule (standard §5,
 * kit 1.7). The "Choose mode" level keeps its 40px tiles, which
 * `tests/ui-smoke.spec.ts` pins in a browser; these recipes are only for the
 * pages level.
 */
describe("mode pages sheet recipes", () => {
  it("draws 52px rows with inset hairlines and a product-blue selection", () => {
    expect(modePagesRowClass(false)).toMatch(/\bmin-h-13\b/);
    expect(modePagesRowClass(false)).toMatch(/before:h-px/);
    expect(modePagesRowClass(true)).not.toMatch(/--mode-identity/);
    expect(modePagesCheckClass).toMatch(/\bsize-icon-lg\b/);
    expect(modePagesCheckClass).toMatch(/--clinical-accent\)/);
  });

  it("uses a 32px tile at the 10px radius with a hairline and a 16px glyph at 1.5 stroke", () => {
    expect(modePagesTileClass(false)).toMatch(/\bsize-8\b/);
    expect(modePagesTileClass(false)).toMatch(/\brounded-md\b/);
    expect(modePagesTileClass(false)).toMatch(/\bborder\b/);
    expect(modePagesIconClass).toMatch(/\bsize-icon-md\b/);
    expect(modePagesIconStroke).toBe(1.5);
  });

  it("sets the label at 15/500, the title at 17/600, and nothing heavier than 600", () => {
    expect(modePagesLabelClass).toMatch(/\btext-base-minus\b/);
    expect(modePagesLabelClass).toMatch(/\bfont-medium\b/);
    expect(modePagesSheetTitleClass).toMatch(/\btext-lg-minus\b/);
    expect(modePagesSheetTitleClass).toMatch(/\bfont-semibold\b/);
    expect(modePagesGroupHeadingClass).toMatch(/\bfont-semibold\b/);
    for (const recipe of [
      modePagesRowClass(true),
      modePagesTileClass(true),
      modePagesLabelClass,
      modePagesSheetTitleClass,
      modePagesGroupHeadingClass,
    ]) {
      expect(recipe).not.toMatch(/font-(bold|extrabold|black)/);
      expect(recipe).not.toMatch(/\btruncate\b/);
    }
  });

  it("keeps the direct mode label and every page/area label at 600", () => {
    // The direct switcher says Modes away from the shared home; home and Work
    // retain the page/mode and area-only variants. All visible label branches
    // share the owner's 600-weight ceiling.
    const source = readFileSync(
      path.join(process.cwd(), "src/components/clinical-dashboard/master-search-header.tsx"),
      "utf8",
    );
    const start = source.indexOf('{!routeWorkArea && currentPathname !== "/" ? (');
    expect(start).toBeGreaterThan(-1);
    const pill = source.slice(start, source.indexOf("<ChevronDown", start));
    expect(pill).toContain(">Modes</span>");
    const labelClasses = Array.from(pill.matchAll(/<span\b[^>]*className="([^"]*)"[^>]*>/g), (match) => match[1]);
    expect(labelClasses).toHaveLength(5);
    for (const classes of labelClasses) {
      expect(classes).toMatch(/\bfont-semibold\b/);
      expect(classes).not.toMatch(/font-(bold|extrabold|black)/);
    }
  });
});
