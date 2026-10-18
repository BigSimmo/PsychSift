import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { findRawSharedModeFontSizes } from "../scripts/check-type-scale.mjs";

const clinical = "src/app/clinical-mode.css";
const work = "src/app/work-mode.css";

describe("shared mode stylesheet type scale", () => {
  it("catches raw font sizes in nested rules and font shorthands with useful locations", () => {
    const findings = findRawSharedModeFontSizes(
      clinical,
      ".title { font-size: 25px; }\n@media (min-width: 40rem) { .label { font: 600 0.8125rem/1.5 sans-serif; } }",
    );
    expect(findings).toEqual([
      { file: clinical, line: 1, match: "font-size: 25px" },
      { file: clinical, line: 2, match: "font: 600 0.8125rem/1.5 sans-serif" },
    ]);
  });

  it("does not let a token elsewhere in an expression hide a raw size or a zero-sized label", () => {
    expect(
      findRawSharedModeFontSizes(
        work,
        ".label { font-size: calc(var(--text-sm) + 1px); } .hidden-label { font-size: 0; }",
      ),
    ).toHaveLength(2);
    expect(findRawSharedModeFontSizes(work, ".title { font-size: 10cqi; }")).toHaveLength(1);
  });

  it("preserves token fallbacks, token-bounded responsive type and inherited sizes", () => {
    expect(
      findRawSharedModeFontSizes(
        work,
        [
          ".label { font-size: var(--text-sm, 0.8125rem); }",
          ".body { font-size: var(--text-body, var(--text-base-minus, 15px)); }",
          ".title { font-size: min(var(--text-xl), 10cqi); }",
          ".inherited { font-size: inherit; font: inherit; }",
          '.family { font: var(--text-body) "A font named 14px"; }',
          '/* .old { font-size: 11px; } */ .note::before { content: "font-size: 10px"; --text-example: 12px; }',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("keeps globals density, input floor, print and annotation metrics outside this bounded migration", () => {
    expect(
      findRawSharedModeFontSizes(
        "src/app/globals.css",
        'html[data-density="compact"] { font-size: 15px; } input { font-size: 16px; } @media print { body { font-size: 9pt; } } .annotation { font-size: 0.85em; }',
      ),
    ).toEqual([]);
  });

  it.each([clinical, work])("keeps %s free of raw font-size declarations", (file) => {
    expect(findRawSharedModeFontSizes(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))).toEqual([]);
  });
});
