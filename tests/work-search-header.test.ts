import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { appModeDefinitions, appModeHasWorkSearch } from "@/lib/app-modes";

describe("Search my work header icon", () => {
  it("shows on the six staff work modes and nowhere else", () => {
    const withIcon = appModeDefinitions.map((mode) => mode.id).filter((id) => appModeHasWorkSearch(id));
    expect(withIcon.sort()).toEqual(["cme", "my-day", "my-work", "on-call", "roster", "teaching"]);
  });

  it("is gated on the mode declaration, not a mode-id branch in the header", () => {
    const header = readFileSync("src/components/clinical-dashboard/master-search-header.tsx", "utf8");
    expect(header).toContain("appModeHasWorkSearch(selectedAppMode.id)");
    expect(header).not.toMatch(/searchMode === "(?:roster|teaching|cme|my-work|my-day)"/);
  });

  it("keeps the search screen out of the header's own bundle", () => {
    // The header loads on every page; it may import the icon only. The icon may
    // import the lazy wrapper only, which loads the screen with a dynamic import.
    const header = readFileSync("src/components/clinical-dashboard/master-search-header.tsx", "utf8");
    expect(header.match(/@\/components\/work-search\/[\w-]+/g)).toEqual(["@/components/work-search/work-search-button"]);

    const button = readFileSync("src/components/work-search/work-search-button.tsx", "utf8");
    expect(button.match(/@\/(?:components|lib)\/work-search\/[\w-]+/g)?.sort()).toEqual([
      "@/components/work-search/lazy-work-search-sheet",
      "@/lib/work-search/model",
    ]);
    const model = readFileSync("src/lib/work-search/model.ts", "utf8");
    expect(model.match(/^import .+$/gm)).toEqual(['import type { AppModeId } from "@/lib/app-modes";']);

    const lazy = readFileSync("src/components/work-search/lazy-work-search-sheet.tsx", "utf8");
    expect(lazy).toMatch(/import\("@\/components\/work-search\/work-search-sheet"\)/);
    expect(lazy).not.toMatch(/^import .*work-search-sheet/m);
  });
});
