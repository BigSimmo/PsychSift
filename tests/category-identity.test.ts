import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { appModeIcons } from "../src/lib/app-mode-icons";
import { appModeIds } from "../src/lib/app-modes";
import {
  APP_MODE_ACCENT,
  APP_MODE_ICON,
  CATEGORY_ACCENTS,
  CATEGORY_ICON_KEYS,
  TOOL_AREA_ACCENT,
  TOOL_AREA_LABEL,
  TOOL_ICON,
  toolIdentity,
} from "../src/lib/category-identity";
import { categoryIconComponent } from "../src/lib/category-identity-icons";
import { toolCatalogRecords } from "../src/lib/tools-catalog";

const globalsCss = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("category identity registry", () => {
  it("covers every tool in the catalogue", () => {
    for (const tool of toolCatalogRecords) {
      expect(TOOL_ICON[tool.id], `tool "${tool.id}" has no glyph`).toBeTruthy();
      expect(TOOL_AREA_ACCENT[tool.area], `area "${tool.area}" has no accent`).toBeTruthy();
    }
  });

  it("covers every app mode", () => {
    for (const mode of appModeIds) {
      expect(APP_MODE_ICON[mode], `mode "${mode}" has no glyph`).toBeTruthy();
    }
  });

  it("covers every app mode with a category accent", () => {
    for (const mode of appModeIds) {
      expect(APP_MODE_ACCENT[mode], `mode "${mode}" has no accent`).toBeTruthy();
      expect(CATEGORY_ACCENTS, `mode "${mode}" accent is not a category accent`).toContain(APP_MODE_ACCENT[mode]);
    }
  });

  it("gives the also-matches screenshot cluster distinct accents", () => {
    const cluster = ["prescribing", "services", "forms", "dsm"] as const;
    const accents = cluster.map((mode) => APP_MODE_ACCENT[mode]);
    expect(new Set(accents).size).toBe(cluster.length);
  });

  it("paints also-matches cards from APP_MODE_ACCENT through data-category-accent", () => {
    const source = readFileSync(
      new URL("../src/components/clinical-dashboard/universal-search-also-matches.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("APP_MODE_ACCENT");
    expect(source).toContain("data-category-accent={accent}");
    expect(source).not.toContain("cardAccentEdge");
    expect(source).toContain("search.statusLabel");
    expect(source).toContain("bg-[color:var(--cat-soft)]");
    expect(source).toContain("grid-cols-1");
    expect(source).toContain("Also matches");
    expect(source).not.toContain("Across PsychSift");
  });

  it("tints library chips from APP_MODE_ACCENT", () => {
    const source = readFileSync(
      new URL("../src/components/clinical-dashboard/cross-mode-links.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("APP_MODE_ACCENT[link.modeId]");
    expect(source).toContain("data-category-accent={APP_MODE_ACCENT[link.modeId]}");
    // The card is a listitem div: an article may not take that role (axe aria-allowed-role).
    expect(source).toMatch(/<div\s+role="listitem"[\s\S]*?data-category-accent=\{APP_MODE_ACCENT\[link\.modeId\]\}/);
    expect(source).toContain("hover:text-[color:var(--cat-accent)]");
    expect(source).toContain("hover:border-[color:var(--cat-border)]");
    expect(source).toContain("hover:bg-[color:var(--cat-soft)]");
    expect(source).not.toMatch(/hover:(?:text|border|bg)-\[color:var\(--clinical-accent(?:-border|-soft)?\)\]/);
  });

  // The defect this registry was built to stop: `guidelines` and `risk-safety`
  // both carried ShieldCheck on the launcher, so one screen showed the same
  // shield for "clinical guidance" and for "risk and safety". A glyph is the
  // only thing distinguishing two cards that share an accent, so a collision
  // inside one axis erases the distinction entirely.
  it("gives every tool a glyph no other tool uses", () => {
    const used = new Map<string, string[]>();
    for (const tool of toolCatalogRecords) {
      const key = TOOL_ICON[tool.id];
      used.set(key, [...(used.get(key) ?? []), tool.id]);
    }
    const collisions = [...used.entries()].filter(([, ids]) => ids.length > 1);
    expect(collisions, `glyph reused within the tools axis: ${JSON.stringify(collisions)}`).toEqual([]);
  });

  it("gives every app mode a glyph no other mode uses", () => {
    const keys = appModeIds.map((mode) => APP_MODE_ICON[mode]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses the library glyph for Sources on both independent identity axes", () => {
    expect(APP_MODE_ICON.sources).toBe("libraryBig");
    expect(TOOL_ICON["source-catalogue"]).toBe("libraryBig");
    expect(categoryIconComponent("libraryBig").displayName ?? categoryIconComponent("libraryBig").name).toMatch(
      /LibraryBig/,
    );
  });

  it("resolves every declared glyph key to a component", () => {
    for (const key of CATEGORY_ICON_KEYS) {
      expect(typeof categoryIconComponent(key), `glyph "${key}" does not resolve`).not.toBe("undefined");
    }
  });

  it("declares no glyph key nothing uses", () => {
    const referenced = new Set<string>([...Object.values(APP_MODE_ICON), ...Object.values(TOOL_ICON)]);
    // "chat" is reserved for the factsheets Therapies category, which resolves
    // through the same table; everything else must be reachable from an axis.
    const unused = CATEGORY_ICON_KEYS.filter((key) => !referenced.has(key) && key !== "chat");
    expect(unused).toEqual([]);
  });

  it("labels every tool area", () => {
    for (const area of Object.keys(TOOL_AREA_ACCENT)) {
      expect(TOOL_AREA_LABEL[area as keyof typeof TOOL_AREA_LABEL]).toBeTruthy();
    }
  });

  it("resolves a tool's full identity in one call", () => {
    expect(toolIdentity("risk-safety", "care")).toEqual({ icon: "shieldCheck", accent: "document" });
  });

  it("keeps appModeIcons derived rather than a second hand-maintained map", () => {
    for (const mode of appModeIds) {
      expect(appModeIcons[mode]).toBe(categoryIconComponent(APP_MODE_ICON[mode]));
    }
  });

  // Every accent must have a `[data-category-accent="…"]` rule, or the card
  // renders with the :root fallback and silently loses its category.
  it("delivers every accent through globals.css", () => {
    for (const accent of CATEGORY_ACCENTS) {
      expect(globalsCss, `no [data-category-accent="${accent}"] rule`).toContain(`[data-category-accent="${accent}"]`);
    }
  });

  // The separation that keeps identity out of the six-tone badge vocabulary.
  // A category is a family of content; a semantic tone is a claim about safety.
  // Painting "Tests & procedures" in --warning asserts caution about a whole
  // category that nothing has reviewed, which is what factsheets did before.
  it("never resolves a category accent to a semantic token", () => {
    const semantic = /--(danger|warning|success|info)\b/;
    for (const accent of CATEGORY_ACCENTS) {
      const block = globalsCss.split(`[data-category-accent="${accent}"] {`)[1]?.split("}")[0] ?? "";
      expect(block.length, `accent "${accent}" has an empty rule`).toBeGreaterThan(0);
      expect(semantic.test(block), `accent "${accent}" resolves to a semantic token: ${block.trim()}`).toBe(false);
    }
  });
});
