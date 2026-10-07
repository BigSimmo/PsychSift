import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/*
 * Teaching's type and wording rules: nothing heavier than 700, every figure
 * 400 and tabular (300 only for the hero's `text-hero` figure), colours from
 * tokens, a non-breaking space between a number and its unit, two elevations,
 * and never "verified" or "CME" in anything a reader sees.
 */
const ROOTS = ["src/components/teaching", "src/app/(search-app)/teaching", "src/app/(display)/teaching"];

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  for (const root of ROOTS) if (existsSync(join(process.cwd(), root))) walk(join(process.cwd(), root));
  return files;
}

const files = sourceFiles().map((path) => [relative(process.cwd(), path).split(sep).join("/"), path] as const);
const withoutComments = (path: string) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("Teaching type weight and wording", () => {
  it("finds Teaching's files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  // Work-mode redesign, owner request 6 Oct 2026: the mockup draws titles,
  // figures and the hero at 700, so 700 (font-bold) is now the ceiling. Nothing
  // heavier: no extrabold or black, no 800 or 900.
  it.each(files)("%s sets nothing heavier than 700", (_name, path) => {
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/\bfont-(extrabold|black)\b/);
    expect(source).not.toMatch(/font-\[(8|9)00\]|fontWeight:\s*["']?(8|9)00/);
  });

  // Work-mode redesign, owner request 6 Oct 2026: the mockup's figures (times,
  // counts, the hero figure) are drawn at 700, so a figure may now be regular or
  // bold. It must still name its weight, so none inherits one by accident.
  it.each(files)("%s sets every figure's weight on purpose, regular or bold", (_name, path) => {
    for (const [literal] of readFileSync(path, "utf8").matchAll(/"[^"\n]*\bnums\b[^"\n]*"/g)) {
      expect(/\bfont-(normal|bold)\b/.test(literal), `${literal}: use modeNumberText, font-normal or font-bold`).toBe(
        true,
      );
    }
  });

  it.each(files)("%s takes every colour from a token", (_name, path) => {
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
    expect(source).not.toMatch(/\b(rgb|rgba|hsl|oklch)\(/);
  });

  it.each(files)("%s joins every number to its unit with a non-breaking space", (_name, path) => {
    for (const [literal] of withoutComments(path).matchAll(/"[^"\n]*"|`[^`\n]*`/g)) {
      expect(literal, `${literal}: use withUnit()`).not.toMatch(
        /(\d|\}) (h|min|sessions?|of|weeks?|items?|members?)(?![\w-])/,
      );
    }
  });

  it.each(files)("%s uses only the two elevations", (_name, path) => {
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/var\(--e[023]\)/);
    expect(source).not.toMatch(/--shadow-(card|soft|hover|elevated|overlay|lux|lift|inset)\b/);
    expect(source).not.toMatch(/\bshadow-(xs|sm|md|lg|xl|2xl)\b/);
  });

  it.each(files)("%s never says verified or CME to a reader", (_name, path) => {
    for (const [literal] of withoutComments(path).matchAll(/"[^"\n]*"|`[^`\n]*`|>[^<>{}\n]+</g)) {
      if (/^["`](@\/|\.{0,2}\/)/.test(literal)) continue;
      expect(literal).not.toMatch(/\bverified\b/i);
      expect(literal).not.toMatch(/\bCME\b/);
    }
  });
});
