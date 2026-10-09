import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { appModeDefinitions, appModeHasWorkSearch } from "@/lib/app-modes";

describe("AI Search header icon", () => {
  // Open shifts joined (work-mode redesign, owner request 6 Oct 2026): it sits inside Roster's frame.
  it("shows on the seven staff work modes and nowhere else", () => {
    const withIcon = appModeDefinitions.map((mode) => mode.id).filter((id) => appModeHasWorkSearch(id));
    expect(withIcon.sort()).toEqual(["cme", "my-day", "my-work", "on-call", "open-shifts", "roster", "teaching"]);
  });

  it("is named AI Search wherever the reader meets it, never Search my work", () => {
    // Josh, 7 Oct 2026: the control is "AI Search". It searches the reader's own work records only.
    const button = readFileSync("src/components/work-search/work-search-button.tsx", "utf8");
    expect(button).toContain('aria-label="AI Search"');
    expect(button).toContain('title="AI Search"');
    const sheet = readFileSync("src/components/work-search/work-search-sheet.tsx", "utf8");
    expect(sheet).toContain('ariaLabel="AI Search"');
    for (const file of [
      "src/components/work-search/work-search-button.tsx",
      "src/components/work-search/work-search-sheet.tsx",
      "src/components/work-search/work-search-keys.tsx",
      "src/lib/work-help/topics/privacy.ts",
    ]) {
      const strings = readFileSync(file, "utf8").match(/"[^"\n]*"|>[^<{\n]+</g) ?? [];
      expect(
        strings.filter((text) => /search my work/i.test(text)),
        file,
      ).toEqual([]);
    }
  });

  it("draws the lens-and-stars mark as one inline SVG with a mask id unique to each copy", () => {
    const glyph = readFileSync("src/components/work-search/work-search-glyph.tsx", "utf8");
    expect(glyph).not.toMatch(/lucide-react/);
    expect(glyph).toContain('viewBox="0 0 24 24"');
    expect(glyph).toContain("useId()");
    expect(glyph).toContain("url(#${maskId})");
    expect(glyph).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("is gated on the mode declaration, not a mode-id branch in the header", () => {
    const header = readFileSync("src/components/clinical-dashboard/master-search-header.tsx", "utf8");
    expect(header).toContain("appModeHasWorkSearch(selectedAppMode.id)");
    expect(header).not.toMatch(/searchMode === "(?:roster|teaching|cme|my-work|my-day)"/);
  });

  it("keeps the search screen out of the header's own bundle", () => {
    // The header loads on every page; it may import the icon only. The icon may
    // import its glyph and the lazy wrapper, which loads the screen with a dynamic import.
    const header = readFileSync("src/components/clinical-dashboard/master-search-header.tsx", "utf8");
    expect(header.match(/@\/components\/(?:work-search|needs-you)\/[\w-]+/g)).toEqual([
      "@/components/needs-you/staff-work-header-controls",
    ]);

    const controls = readFileSync("src/components/needs-you/staff-work-header-controls.tsx", "utf8");
    expect(controls.match(/@\/components\/(?:work-search|needs-you)\/[\w-]+/g)).toEqual([
      "@/components/needs-you/needs-you-button",
      "@/components/work-search/work-search-button",
    ]);
    expect(controls.indexOf("<NeedsYouButton")).toBeLessThan(controls.indexOf("<WorkSearchButton"));

    const button = readFileSync("src/components/work-search/work-search-button.tsx", "utf8");
    expect(button.match(/@\/(?:components|lib)\/work-search\/[\w-]+/g)?.sort()).toEqual([
      "@/components/work-search/lazy-work-search-sheet",
      "@/components/work-search/work-search-glyph",
      "@/lib/work-search/model",
    ]);
    const glyph = readFileSync("src/components/work-search/work-search-glyph.tsx", "utf8");
    expect(glyph).not.toMatch(/work-search\/(?!work-search-glyph)/);
    const model = readFileSync("src/lib/work-search/model.ts", "utf8");
    expect(model.match(/^import .+$/gm)).toEqual(['import type { AppModeId } from "@/lib/app-modes";']);

    const lazy = readFileSync("src/components/work-search/lazy-work-search-sheet.tsx", "utf8");
    expect(lazy).toMatch(/import\("@\/components\/work-search\/work-search-sheet"\)/);
    expect(lazy).not.toMatch(/^import .*work-search-sheet/m);
  });
});
