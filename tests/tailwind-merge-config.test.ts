import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cn } from "@/components/ui-primitives";
import { CLINICAL_TWMERGE_THEME, twMergeClinical } from "@/lib/tailwind-merge";

const GLOBALS_CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * `cn()` runs every className in the product through tailwind-merge, and
 * tailwind-merge only knows the scales it is told about. An undeclared custom
 * `text-*` step is classified as a text COLOUR and silently deleted when it meets
 * a real colour in the same call — no type error, no lint error, just a smaller
 * or differently-coloured element. These tests are the signal that does not
 * otherwise exist.
 */
describe("cn()", () => {
  it("keeps the pre-tailwind-merge signature: falsy arguments are dropped", () => {
    expect(cn("a", false, "b", null, undefined, "")).toBe("a b");
    expect(cn()).toBe("");
    expect(cn(false, null, undefined)).toBe("");
  });

  it("resolves a genuine conflict last-wins rather than emitting both", () => {
    expect(cn("rounded-md", "rounded-lg")).toBe("rounded-lg");
    expect(cn("px-2", "px-5")).toBe("px-5");
    expect(cn("text-sm", "text-xs")).toBe("text-xs");
    expect(cn("shadow-[var(--e1)]", "shadow-[var(--shadow-hover)]")).toBe("shadow-[var(--shadow-hover)]");
  });

  it("lets a caller override a recipe, which a plain join could not", () => {
    // The whole point of #218: the second argument is the caller's className.
    expect(cn("rounded-lg bg-[color:var(--surface)] p-4", "p-2")).toBe("rounded-lg bg-[color:var(--surface)] p-2");
  });
});

describe("custom @theme scales are not misclassified", () => {
  // Every non-t-shirt custom step. Without `theme.text` each of these is treated
  // as a text colour and deleted by the colour beside it.
  const CUSTOM_TEXT_STEPS = [
    "text-3xs",
    "text-2xs",
    "text-sm-minus",
    "text-secondary",
    "text-base-minus",
    "text-lg-minus",
    "text-2xl-minus",
    "text-3xl-minus",
    "text-hero",
    "text-display",
  ];

  it.each(CUSTOM_TEXT_STEPS)("keeps %s beside a text colour", (step) => {
    expect(cn(step, "text-[color:var(--text-muted)]")).toBe(`${step} text-[color:var(--text-muted)]`);
  });

  it("keeps the eyebrow recipe's size and colour together", () => {
    // eyebrowText in ui-primitives.tsx is exactly the pair that breaks.
    const eyebrow = "text-2xs font-semibold uppercase leading-4 tracking-label text-[color:var(--text-muted)]";
    expect(cn(eyebrow)).toBe(eyebrow);
  });

  it("treats custom text steps as sizes that conflict with each other", () => {
    expect(cn("text-sm-minus", "text-base-minus")).toBe("text-base-minus");
    expect(cn("text-2xs", "text-sm")).toBe("text-sm");
    expect(cn("text-secondary", "text-sm")).toBe("text-sm");
    expect(cn("text-sm", "text-secondary")).toBe("text-secondary");
    expect(cn("text-hero", "text-2xl")).toBe("text-2xl");
  });

  it.each([
    ["tracking-label", "tracking-kicker"],
    ["tracking-eyebrow", "tracking-normal"],
    ["leading-prose", "leading-display"],
    ["leading-display", "leading-5"],
    ["size-icon-md", "size-icon-lg"],
    ["h-icon-sm", "h-icon-xl"],
    ["ease-out-soft", "ease-spring"],
    ["animate-shimmer", "animate-fade-up"],
    ["pt-safe", "pt-4"],
    ["pb-safe-2", "pb-safe"],
  ])("merges %s and %s to the last one", (first, second) => {
    expect(cn(first, second)).toBe(second);
  });

  it("does not collide custom families with one another", () => {
    const composed = cn(
      "text-2xs",
      "tracking-label",
      "leading-prose",
      "size-icon-md",
      "ease-out-soft",
      "animate-fade-up",
      "text-[color:var(--text-muted)]",
    );
    for (const cls of [
      "text-2xs",
      "tracking-label",
      "leading-prose",
      "size-icon-md",
      "ease-out-soft",
      "animate-fade-up",
      "text-[color:var(--text-muted)]",
    ]) {
      expect(composed.split(" ")).toContain(cls);
    }
  });
});

describe("--spacing-tap merges, and only within a variant", () => {
  // `tap` was pinned out of the merge config on the premise that declaring it
  // would drop 18 production targets below 48px across 22 call sites. That did
  // not survive re-measurement (#270): a composition-aware sweep resolving
  // constant recipe identifiers at all 1418 `cn()` call sites finds ZERO
  // same-variant tap/numeric pairs, so there is nothing for the merge to lower.
  it("merges a same-variant pair, last class winning", () => {
    expect(cn("min-h-9", "min-h-tap")).toBe("min-h-tap");
    expect(cn("h-10.5", "h-tap")).toBe("h-tap");
  });

  // The load-bearing half. The 84 surviving pairs in production are all
  // cross-variant responsive step-downs, and tailwind-merge groups by variant,
  // so they must pass through untouched. If this ever merges, a control loses
  // its breakpoint step and the sweep's zero stops meaning anything.
  it("leaves cross-variant responsive step-downs alone", () => {
    expect(cn("min-h-tap", "sm:min-h-9")).toBe("min-h-tap sm:min-h-9");
    expect(cn("h-10.5", "sm:h-tap")).toBe("h-10.5 sm:h-tap");
    expect(cn("min-h-tap", "lg:min-h-9")).toBe("min-h-tap lg:min-h-9");
  });
});

describe("the config tracks globals.css", () => {
  /**
   * The failure this guards is a silent one: a token added to `@theme` and not
   * added to the merge config is misclassified or unmergeable from the moment it
   * ships, with nothing to say so. Compare the two lists directly.
   */
  const themeBlock = (() => {
    const start = GLOBALS_CSS.indexOf("@theme {");
    let depth = 0;
    for (let i = start + 7; i < GLOBALS_CSS.length; i += 1) {
      if (GLOBALS_CSS[i] === "{") depth += 1;
      else if (GLOBALS_CSS[i] === "}" && --depth === 0) return GLOBALS_CSS.slice(start, i);
    }
    throw new Error("unterminated @theme block in globals.css");
  })();

  const declared = (namespace: string) =>
    [...themeBlock.matchAll(new RegExp(`^\\s*--${namespace}-([a-z0-9-]+):`, "gim"))]
      .map((m) => m[1])
      .filter((name) => !name.endsWith("--line-height"));

  // Compared against the exported config object, so editing the config without
  // editing globals.css (or the reverse) fails here.
  it.each(["text", "leading", "tracking", "ease", "animate"] as const)(
    "declares exactly the --%s-* tokens globals.css defines",
    (namespace) => {
      expect([...CLINICAL_TWMERGE_THEME[namespace]].sort()).toEqual(declared(namespace).sort());
    },
  );

  it("declares every --spacing-* token, including the tap knob", () => {
    const fromCss = declared("spacing");
    expect(fromCss).toContain("tap");
    expect([...CLINICAL_TWMERGE_THEME.spacing].sort()).toEqual(
      // `safe` / `safe-2` come from @utility rules, not @theme, so they are
      // config-only and are added to the CSS-derived list for the comparison.
      [...fromCss, "safe", "safe-2"].sort(),
    );
  });

  it("exposes the configured merge for callers that are not cn()", () => {
    expect(twMergeClinical("p-2 p-4")).toBe("p-4");
  });
});

describe("cn module location", () => {
  const recipesSource = readFileSync(join(process.cwd(), "src/components/primitive-recipes/recipes.ts"), "utf8");

  it("lives in src/lib/cn.ts and is re-exported from the primitive recipes", async () => {
    const libCnSource = readFileSync(join(process.cwd(), "src/lib/cn.ts"), "utf8");
    expect(libCnSource).toMatch(/export function cn\(/);
    expect(libCnSource).toContain("twMergeClinical");
    expect(recipesSource).toMatch(/from ["\']@\/lib\/cn["\']/);
    expect(recipesSource).toMatch(/export \{[\s\S]*?\bcn\b[\s\S]*?\}/);
    expect(recipesSource).not.toMatch(/export function cn\(/);

    const lib = await import("@/lib/cn");
    expect(cn).toBe(lib.cn);
  });
});
