import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computeDivergences, diffAgainstPin, readLayers, readPin } from "../scripts/token-layer-divergences.mjs";
import { sourceFrom, sourceSegment } from "./helpers/source-contract";

/**
 * Invariants of the Clinical Sky token system in `src/app/globals.css`.
 *
 * These are the properties the design review found broken and fixed — a
 * disordered surface scale, an elevation set that did not sort by name, status
 * colours bunched in one contrast band, a dark border at ~1.35:1, and a
 * duplicated accent ramp step. Every one of them was invisible to lint, to
 * typecheck, and to a screenshot diff, so they are asserted here instead of
 * trusted to review.
 *
 * Values are read out of the stylesheet rather than duplicated, so retuning a
 * token is allowed — breaking the RELATIONSHIP between tokens is not.
 */

const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const v2Stylesheet = readFileSync(new URL("../src/app/ckb-v2-tokens.css", import.meta.url), "utf8");

function themeBlock(marker: string) {
  const start = globals.indexOf(marker);
  expect(start, `${marker} block is missing from globals.css`).toBeGreaterThan(-1);
  const end = globals.indexOf("\n}", start);
  return globals.slice(start, end);
}

function allThemeBlocks(stylesheet: string, selector: string) {
  const opener = `\n${selector} {`;
  const grouped = `\n${selector},`;
  let start = stylesheet.indexOf(opener);
  if (start === -1) start = stylesheet.indexOf(grouped);
  expect(start, `${selector} block is missing`).toBeGreaterThan(-1);
  let combined = "";
  while (start > -1) {
    const end = stylesheet.indexOf("\n}", start);
    // Missing terminator would otherwise restart at 0 and loop forever.
    expect(end, `${selector} block is missing a closing brace`).toBeGreaterThan(start);
    combined += stylesheet.slice(start, end);
    const nextOpener = stylesheet.indexOf(opener, end + 1);
    const nextGrouped = stylesheet.indexOf(grouped, end + 1);
    if (nextOpener === -1) start = nextGrouped;
    else if (nextGrouped === -1) start = nextOpener;
    else start = Math.min(nextOpener, nextGrouped);
  }
  return combined;
}

const lightBlock = themeBlock("\n:root {");
const darkBlock = themeBlock("\n.dark {");
const themeConfigBlock = themeBlock("\n@theme {");

function declarations(block: string) {
  const map = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/^ {2}(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    map.set(name, value.trim());
  }
  return map;
}

const v2Light = declarations(allThemeBlocks(v2Stylesheet, ".ckb-v2.ckb-v2"));
const v2Dark = declarations(allThemeBlocks(v2Stylesheet, ".dark .ckb-v2.ckb-v2"));
const light = new Map([...declarations(lightBlock), ...v2Light]);
const dark = new Map([...declarations(darkBlock), ...v2Dark]);
const effectiveLight = light;
const effectiveDark = dark;
const themes = [
  { name: "light", tokens: light },
  { name: "dark", tokens: dark },
] as const;
const effectiveThemes = [
  { name: "light", tokens: effectiveLight },
  { name: "dark", tokens: effectiveDark },
] as const;

/** Resolves `var(--x)` chains within one theme so aliases can be compared. */
function resolve(tokens: Map<string, string>, name: string, depth = 0): string {
  const value = tokens.get(name);
  expect(value, `${name} is not defined`).toBeTruthy();
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value!);
  if (!match || depth > 8) return value!;
  return resolve(tokens, match[1], depth + 1);
}

function relativeLuminance(hex: string) {
  const normalised = hex.trim().toLowerCase();
  expect(normalised, `${hex} is not a 6-digit hex colour`).toMatch(/^#[0-9a-f]{6}$/);
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(normalised.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(firstHex: string, secondHex: string) {
  const [darker, lighter] = [relativeLuminance(firstHex), relativeLuminance(secondHex)].sort((a, b) => a - b);
  return (lighter + 0.05) / (darker + 0.05);
}

const colourOf = (tokens: Map<string, string>, name: string) => resolve(tokens, name);

describe("theme token symmetry", () => {
  it("defines every per-theme value in both themes", () => {
    // A value that reaches through var() stays theme-reactive without being
    // redeclared; everything else must be answered in both blocks or dark
    // silently inherits a light-mode colour. Structural type scale is shared across themes.
    const perTheme =
      /^--(neutral|primary|surface|text|border|clinical|type|tone|info|success|warning|danger|command|background|app-shell|disabled|overlay|panel|glow|shadow|e[0-4]$)/;
    const isStructuralTypeScale = /^--text-(xs|sm|body|md|lg|xl|hero)/;
    const missingInDark = [...light.keys()].filter(
      (name) =>
        perTheme.test(name) &&
        !isStructuralTypeScale.test(name) &&
        !dark.has(name) &&
        !light.get(name)!.includes("var("),
    );
    const missingInLight = [...dark.keys()].filter(
      (name) => perTheme.test(name) && !isStructuralTypeScale.test(name) && !light.has(name),
    );

    expect(missingInDark, "light-only per-theme tokens").toEqual([]);
    expect(missingInLight, "dark-only per-theme tokens").toEqual([]);
  });
});

describe("surface scale", () => {
  // In v2 (SPEC §4.3, §4.4):
  // Light: page, cards, and panels share one plane (--surface and --surface-raised match after v2 overlay).
  // Two non-white surfaces: --surface-subtle and --surface-inset, plus --surface-wash for quiet strips.
  // Dark: four monotonic surfaces: inset -> background -> surface -> raised -> lux, with subtle aliased UP to raised.
  it("orders light surfaces: inset → wash → subtle → surface (= raised)", () => {
    const lightLadder = ["--surface-inset", "--surface-wash", "--surface-subtle", "--surface"] as const;
    const luminances = lightLadder.map((token) => relativeLuminance(colourOf(light, token)));

    expect(luminances, "light surface ladder is out of order").toEqual([...luminances].sort((a, b) => a - b));
    expect(new Set(luminances).size, "light surface steps collapsed onto each other").toBe(lightLadder.length);
    expect(colourOf(light, "--surface-raised"), "--surface-raised matches --surface in v2 light").toBe(
      colourOf(light, "--surface"),
    );
  });

  it("orders dark surfaces: inset → background → surface → raised → lux", () => {
    const darkRamp = ["--surface-inset", "--background", "--surface", "--surface-raised", "--surface-lux"] as const;
    const luminances = darkRamp.map((token) => relativeLuminance(colourOf(dark, token)));

    expect(luminances, "dark surface ramp is out of order").toEqual([...luminances].sort((a, b) => a - b));
    expect(new Set(luminances).size, "dark surface steps collapsed onto each other").toBe(darkRamp.length);
    // --surface-subtle is aliased UP to --surface-raised so subtle lifts rather than sinks (#8, #19, SPEC §4.4)
    expect(colourOf(dark, "--surface-subtle"), "dark --surface-subtle must lift to --surface-raised").toBe(
      colourOf(dark, "--surface-raised"),
    );
  });

  it.each(themes)("keeps both border weights visible and separable in $name", ({ tokens }) => {
    // The dark --border used to track --neutral-300, which left it effectively
    // invisible against --surface. A hairline is meant to be quiet, so the
    // floor is low — but the two weights must stay meaningfully apart, or
    // "strong border" stops communicating anything.
    const hairline = contrastRatio(colourOf(tokens, "--border"), colourOf(tokens, "--surface"));
    const strong = contrastRatio(colourOf(tokens, "--border-strong"), colourOf(tokens, "--surface"));

    expect(hairline, "--border must remain perceptible").toBeGreaterThanOrEqual(1.19);
    expect(strong, "--border-strong must read as a deliberate weight").toBeGreaterThanOrEqual(1.39);
    expect(strong / hairline, "--border-strong is not distinguishable from --border").toBeGreaterThanOrEqual(1.16);
  });

  it.each(effectiveThemes)(
    "keeps both border weights visible and separable in effective cascade ($name)",
    ({ tokens }) => {
      const hairline = contrastRatio(colourOf(tokens, "--border"), colourOf(tokens, "--surface"));
      const strong = contrastRatio(colourOf(tokens, "--border-strong"), colourOf(tokens, "--surface"));

      expect(hairline, "--border must remain perceptible").toBeGreaterThanOrEqual(1.2);
      expect(strong, "--border-strong must read as a deliberate weight").toBeGreaterThanOrEqual(1.35);
      expect(strong / hairline, "--border-strong is not distinguishable from --border").toBeGreaterThanOrEqual(1.12);
    },
  );
});

describe("effective v2 surface elevation model", () => {
  // In v2, light mode intentionally unifies --surface and --surface-raised to #ffffff,
  // providing elevation via shadow tiers (--e1..--e4) rather than background step (#QAKV4N).
  it("unifies resting and raised surfaces in effective light mode", () => {
    expect(colourOf(effectiveLight, "--surface")).toBe("#fcfdfe");
    expect(colourOf(effectiveLight, "--surface-raised")).toBe("#fcfdfe");
  });

  // In dark mode, base surface sits at resting tone #12161a, with subtle and raised
  // elevated together at #1c2126 above the resting ground.
  it("elevates subtle and raised above resting surface in effective dark mode", () => {
    const surface = colourOf(effectiveDark, "--surface");
    const raised = colourOf(effectiveDark, "--surface-raised");
    const subtle = colourOf(effectiveDark, "--surface-subtle");

    expect(relativeLuminance(raised)).toBeGreaterThan(relativeLuminance(surface));
    expect(subtle).toBe(raised);
  });
});

describe("elevation ladder", () => {
  it.each(themes)("aliases every shadow role onto an --e tier in $name", ({ tokens }) => {
    const aliases = {
      "--shadow-card": "--e2",
      "--shadow-soft": "--e2",
      "--shadow-hover": "--e3",
      "--shadow-elevated": "--e4",
    } as const;

    for (const [role, tier] of Object.entries(aliases)) {
      expect(tokens.get(role), `${role} must point at ${tier}, not a hand-rolled shadow`).toBe(`var(${tier})`);
    }
    // --shadow-lux may add a top highlight, but its body is still a tier.
    expect(tokens.get("--shadow-lux")).toContain("var(--e4)");
    expect(tokens.get("--e0")).toBe("none");
  });

  // `--shadow-tight` is retired (`#262` part 1). It was a pure pass-through onto
  // `--e1` in every scope — both themes and the forced-colors flattening — so
  // the role bought nothing but a second name for one tier, and a call site had
  // no way to tell which spelling was current.
  //
  // This is asserted over the tracked tree rather than the stylesheet alone
  // because the retirement has already been un-done once: PR #1803 migrated 49
  // files, and the `acf78bf` merge on 2026-08-11 silently restored the
  // declarations AND every call site while leaving this file's prose behind.
  // A declaration-only check would have gone red on that revert, but only
  // because the declarations came back with the call sites; sweeping both
  // spellings over `src` is what makes the gate independent of which half of a
  // bad merge lands.
  it("keeps the retired --shadow-tight token deleted across the tracked tree", () => {
    const tracked = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(tsx?|css)$/.test(file))
      .filter((file) => existsSync(new URL(`../${file}`, import.meta.url)));

    const survivors = tracked.flatMap((file) => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      return source
        .split(/\r?\n/)
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => /--shadow-tight\s*:|var\(--shadow-tight\)/.test(line))
        .map(({ number }) => `${file}:${number}`);
    });

    expect(survivors, "--shadow-tight is retired; reach for the --e1 tier directly").toEqual([]);
  });

  // `--shadow-focus` is retired (`#261`). It was not an elevation alias at all:
  // it packed a 3px accent halo in FRONT of `--shadow-soft`, so its one consumer
  // — `.chat-composer-shell-delta:focus-within` — painted a companion ring on
  // top of the accent border swap, which is the second focus affordance the
  // shared `:focus-visible` treatment is written to prevent. The composer now
  // uses a quiet border shift; buttons keep the sanctioned 2px outline.
  //
  // Unlike the `--shadow-tight` assertion above this is not a raw substring
  // check: the stylesheet comment at the composer rule names the retired token
  // on purpose, so that the next author reaching for a focus halo finds the
  // reason it is gone rather than re-deriving it. The two spellings below are
  // the only ways the token can actually come back to life — a declaration and
  // a `var()` consumer — so they are what the gate rejects.
  it("keeps the retired --shadow-focus token deleted in every scope", () => {
    for (const [name, stylesheet] of [
      ["globals.css", globals],
      ["ckb-v2-tokens.css", v2Stylesheet],
    ] as const) {
      expect(stylesheet, `${name} redeclares --shadow-focus; focus is an outline, not a ring`).not.toContain(
        "--shadow-focus:",
      );
      expect(stylesheet, `${name} consumes --shadow-focus; focus is an outline, not a ring`).not.toContain(
        "var(--shadow-focus)",
      );
    }
  });

  it("flattens the ladder itself under forced colors, not only the role aliases", () => {
    const forced = sourceFrom(
      globals,
      "@media (forced-colors: active) {\n  :root,\n  .dark {\n    --background: Canvas;",
      {
        label: "globals.css theme forced-colors block",
      },
    );
    for (const tier of ["--e1", "--e2", "--e3", "--e4"]) {
      expect(forced, `${tier} must be neutralised in forced-colors mode`).toContain(`${tier}: none;`);
    }
  });

  it("pins the complete v2 forced-colors selector group", () => {
    const forced = sourceFrom(v2Stylesheet, "@media (forced-colors: active)", {
      label: "v2 forced-colors block",
    });
    expect(forced).toMatch(/\.ckb-v2\.ckb-v2,\s+\.dark \.ckb-v2\.ckb-v2,\s+\.ckb-v2\.dark\.ckb-v2\s*\{/);
  });
});

describe("status colour ranking", () => {
  it.each(themes)("keeps warning body text AA-safe on the default surface in $name", ({ tokens, name }) => {
    const ratio = contrastRatio(colourOf(tokens, "--warning"), colourOf(tokens, "--surface"));
    expect(ratio, `${name} --warning body text on --surface`).toBeGreaterThanOrEqual(4.5);
  });

  // Every status pair used to sit in a 4.6–5.2:1 band, so nothing read as more
  // urgent than anything else.
  it("clears 5.5:1 for every light-mode status pair", () => {
    for (const status of ["info", "success", "warning", "danger"]) {
      const ratio = contrastRatio(colourOf(light, `--${status}-text`), colourOf(light, `--${status}-bg`));
      expect(ratio, `light --${status}-text on --${status}-bg`).toBeGreaterThanOrEqual(5.5);
    }
  });

  it.each(themes)("keeps identity and tone chips quieter than every status colour in $name", ({ tokens, name }) => {
    // A blue "Document" chip used to out-shout an "Outdated" badge because the
    // categorical anchors were raw Tailwind hues at 2–3× the accent's chroma.
    // What makes a swatch shout is colourfulness, not luminance contrast, so
    // that is what is capped: every categorical anchor stays below the calmest
    // status colour. Status always wins the attention contest.
    const chroma = (hex: string) => {
      const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
      return Math.max(...channels) - Math.min(...channels);
    };
    const quietestStatus = Math.min(
      ...["info", "success", "warning", "danger"].map((status) => chroma(colourOf(tokens, `--${status}-text`))),
    );

    const categorical = [
      ...["document", "table", "search", "source", "service", "form"].map((type) => `--type-${type}`),
      ...["purple", "indigo", "rose", "slate"].map((tone) => `--tone-${tone}`),
    ];
    for (const token of categorical) {
      expect(chroma(colourOf(tokens, token)), `${name} ${token} must not out-shout the status set`).toBeLessThan(
        quietestStatus,
      );
    }
  });

  it.each(themes)("ships a complete triad for every categorical tone in $name", ({ tokens }) => {
    for (const tone of ["purple", "indigo", "rose", "slate"]) {
      for (const suffix of ["", "-soft", "-border"]) {
        expect(tokens.has(`--tone-${tone}${suffix}`), `--tone-${tone}${suffix} is missing`).toBe(true);
      }
    }
  });
});

describe("accent ramp", () => {
  it.each(themes)("has ten distinct steps in $name", ({ tokens, name }) => {
    // Dark shipped --primary-600 and --primary-700 as the same hex, which
    // silently collapsed every hover state onto its resting colour.
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) =>
      colourOf(tokens, `--primary-${step}`),
    );
    expect(new Set(steps).size, `${name} accent ramp has a duplicated step`).toBe(steps.length);
  });

  it("keeps the accent legible as both a fill and a text colour", () => {
    expect(contrastRatio(colourOf(light, "--primary-500"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    for (const { tokens, name } of themes) {
      expect(
        contrastRatio(colourOf(tokens, "--clinical-accent"), colourOf(tokens, "--clinical-accent-contrast")),
        `${name} accent fill vs its own label colour`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(themes)("moves a real step on hover and settles on active in $name", ({ tokens }) => {
    const rest = colourOf(tokens, "--clinical-accent");
    const hover = colourOf(tokens, "--clinical-accent-hover");
    const active = colourOf(tokens, "--clinical-accent-active");
    expect(hover, "hover must not repeat the resting colour").not.toBe(rest);
    expect(active, "active must not repeat the hover colour").not.toBe(hover);
  });

  it.each(themes)("keeps strong accent text on the high-contrast ramp step in $name", ({ tokens }) => {
    expect(resolve(tokens, "--clinical-accent-strong")).toBe(resolve(tokens, "--primary-700"));
    expect(
      contrastRatio(resolve(tokens, "--clinical-accent-strong"), colourOf(tokens, "--surface")),
      "strong accent text must remain readable on the default surface",
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("maps strong accent text to a system colour in forced-colors mode", () => {
    expect(globals).toContain("--clinical-accent-strong: LinkText;");
  });
});

describe("mode identity accent", () => {
  /**
   * A mode may carry its own hue on its own chrome — On Call's switcher pill
   * and its in-page bar. Owner decision, 2026-09-13; `docs/design-system/
   * TOKENS.md` §7 records it and says what still holds.
   *
   * The risk this pins is the one that made the category channel the wrong
   * home for it: those triads have no contrast partner, so a filled circle in
   * one has no defined glyph colour and a white glyph on the dark-theme mauve
   * fails 4.5:1 badly. This family carries the fourth token, and these cases
   * are what keep it honest.
   */
  const identityBlock = (selector: string) =>
    declarations(sourceSegment(globals, `\n${selector} {`, "\n}", { label: `${selector} block` }));
  // Every mode that names an identity: On Call's teal, CME's indigo and Admin's slate
  // (mode id `my-work`). Each case below runs once per theme of each.
  const identityThemes = (["on-call", "cme", "my-work"] as const).flatMap((mode) => [
    { name: `${mode} light`, theme: "light", tokens: identityBlock(`[data-mode-identity="${mode}"]`) },
    { name: `${mode} dark`, theme: "dark", tokens: identityBlock(`.dark [data-mode-identity="${mode}"]`) },
  ]);

  it.each(identityThemes)("clears 4.5:1 as a fill against its own label colour in $name", ({ tokens, name }) => {
    // A fill, not only text: the pill's 32px circle is painted in this colour
    // with the mode's glyph on top of it.
    expect(
      contrastRatio(tokens.get("--mode-identity")!, tokens.get("--mode-identity-contrast")!),
      `${name} mode identity fill vs its own label colour`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(identityThemes)("clears 4.5:1 as text on the page surface in $name", ({ tokens, name, theme }) => {
    // The other half of its job: the small "On Call" line under the page name
    // in the pill is this colour on the pill's own surface.
    const surface = theme === "light" ? colourOf(light, "--surface") : colourOf(dark, "--surface");
    expect(
      contrastRatio(tokens.get("--mode-identity")!, surface),
      `${name} mode identity as text`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("defaults every mode to the product accent, so naming an identity is opt-in", () => {
    // The `:root` values are pure aliases. That is what makes this safe to
    // stamp on every mode's pill: seventeen modes render exactly as they did,
    // and light, dark and forced-colors come free because `.ckb-v2`, `.dark`
    // and the forced-colors block all land on <html> — the same element as
    // `:root` — so the alias resolves against whatever accent that element got.
    // Every `:root` block, not the first: these live beside the category
    // delivery channel they are deliberately not part of, several hundred
    // lines below the accent roles.
    const roots = declarations(allThemeBlocks(globals, ":root"));
    for (const role of ["", "-soft", "-border", "-contrast"] as const) {
      expect(roots.get(`--mode-identity${role}`)).toBe(`var(--clinical-accent${role})`);
    }
  });

  it("flattens to the same system pairing the accent does under forced colors", () => {
    // Identity is a decorative distinction and high contrast has no room for
    // one. Asserted because a raw teal surviving here would be invisible.
    const forced = sourceSegment(globals, '  [data-mode-identity="on-call"] {', "\n  }", {
      label: "forced-colors mode identity block",
    });
    expect(forced).toContain("--mode-identity: LinkText;");
    expect(forced).toContain("--mode-identity-contrast: ButtonText;");
  });

  it("paints Admin in the work-mode slate, and flattens it under forced colours", () => {
    // Work-mode redesign, owner request 6 Oct 2026: Admin moved from the forms brown to slate.
    expect(identityBlock('[data-mode-identity="my-work"]').get("--mode-identity")).toBe("#44566e");
    expect(identityBlock('.dark [data-mode-identity="my-work"]').get("--mode-identity")).toBe("#a9b8cc");
    const forced = sourceSegment(globals, '  [data-mode-identity="my-work"] {', "\n  }", {
      label: "forced-colors Admin identity block",
    });
    expect(forced).toContain("--mode-identity: LinkText;");
  });

  it("keeps Admin's slate, soft and border shades pinned to the work-mode palette", () => {
    // Work-mode redesign, owner request 6 Oct 2026: Admin no longer copies `--type-form`
    // (the forms brown); it uses the mockup's slate. Each shade stays pinned, so a
    // change to one without the others still fails here.
    const slateLight = { "": "#44566e", "-soft": "#eef1f5", "-border": "#cfd7e1" } as const;
    const slateDark = { "": "#a9b8cc", "-soft": "#1b222c", "-border": "#323d4b" } as const;
    for (const suffix of ["", "-soft", "-border"] as const) {
      expect(identityBlock('[data-mode-identity="my-work"]').get(`--mode-identity${suffix}`)).toBe(slateLight[suffix]);
      expect(identityBlock('.dark [data-mode-identity="my-work"]').get(`--mode-identity${suffix}`)).toBe(
        slateDark[suffix],
      );
    }
  });

  it("delivers the hue by remapping the accent locally, never by a dynamic class", () => {
    // One attribute repaints the pill's filled circle and the bar's active
    // underline together, because both already read `--clinical-accent`; they
    // cannot end up different greens. A dynamic Tailwind class
    // (`bg-[color:var(--x-${mode})]`) produces no CSS at all, and an inline
    // style is ceilinged by `check:design-drift-ratchet`.
    const local = identityBlock('[data-mode-identity="on-call"]');
    expect(local.get("--clinical-accent")).toBe("var(--mode-identity)");
    expect(local.get("--clinical-accent-contrast")).toBe("var(--mode-identity-contrast)");
  });
});

describe("disabled and pre-paint values", () => {
  it.each(themes)("keeps disabled text readable in $name", ({ tokens, name }) => {
    // WCAG exempts disabled controls, but a clinician still has to read WHICH
    // action is unavailable. v2 light disabled tier is ~2.5:1 on white (DECISIONS §4).
    const floor = name === "light" ? 2.45 : 3;
    expect(contrastRatio(colourOf(tokens, "--disabled"), colourOf(tokens, "--surface"))).toBeGreaterThanOrEqual(floor);
  });

  it.each(effectiveThemes)("keeps disabled text readable in effective cascade ($name)", ({ tokens }) => {
    expect(contrastRatio(colourOf(tokens, "--disabled"), colourOf(tokens, "--surface"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps the pre-paint theme colours equal to the root-mounted v2 --background", () => {
    // APP_THEME_COLORS paints before any stylesheet loads; a drift here is a
    // flash of the wrong page colour and a mismatched browser chrome bar.
    const theme = readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
    const appThemeColors = sourceFrom(theme, "export const APP_THEME_COLORS", {
      label: "theme.ts export const APP_THEME_COLORS",
    });
    expect(appThemeColors).toContain(`light: "${colourOf(v2Light, "--background")}"`);
    expect(appThemeColors).toContain(`dark: "${colourOf(v2Dark, "--background")}"`);
  });

  it("keeps the brand mark on the current accent", () => {
    // The favicon and generated icon routes render outside any stylesheet, so
    // they hard-code the accent and can silently keep a retired brand colour.
    // Since the mark became symbol-on-ground rather than ink-on-tile, the accent
    // is what the glyph is drawn in and the tile only matches the surface it
    // stands on — so both roles are pinned, not just one.
    const brand = readFileSync(new URL("../src/lib/brand-mark.ts", import.meta.url), "utf8");
    expect(brand).toContain(`ink: "${colourOf(light, "--clinical-accent")}"`);
    expect(brand).toContain(`ink: "${colourOf(dark, "--clinical-accent")}"`);
    expect(brand).toContain(`tile: "${colourOf(light, "--surface-raised")}"`);
    // Require the root-mounted v2 dark --surface-raised only — never the
    // globals.css compatibility-layer value. Accepting either lets brand assets
    // permanently desync from the cascade the app actually paints.
    expect(brand).toContain(`tile: "${colourOf(dark, "--surface-raised")}"`);
  });
});

describe("radius ladder", () => {
  it("keeps every rung on the 4px grid and distinct", () => {
    // --radius-lg sat at 10px and broke the rhythm. Moving it to 12 collided
    // with --radius-xl, so the upper ladder shifted a rung — two names must
    // never share one value, or the lg/xl role split stops meaning anything.
    // Two half-steps are sanctioned: `sm` at 6px, and `md` at 10px since PR 5c,
    // where the live control radius met the v2 one (SPEC §4.6).
    const rungs = ["xs", "sm", "md", "lg", "xl", "2xl"].map((step) => {
      const value = new RegExp(`--radius-${step}:\\s*([\\d.]+)rem;`, "i").exec(themeConfigBlock);
      expect(value, `--radius-${step} is not defined in @theme`).toBeTruthy();
      return Math.round(Number.parseFloat(value![1]) * 16);
    });

    expect(rungs, "radius ladder must ascend").toEqual([...rungs].sort((a, b) => a - b));
    expect(new Set(rungs).size, "two radius names share one value").toBe(rungs.length);
    // 6px `sm` and 10px `md` are the two sanctioned half-steps; everything else
    // is a multiple of 4. Both are named here so a third one cannot slip in.
    const halfSteps = new Set([6, 10]);
    for (const rung of rungs.filter((value) => !halfSteps.has(value))) {
      expect(rung % 4, `${rung}px is off the 4px grid`).toBe(0);
    }
    // The control rung is the one the v2 layer also declares; they must agree or
    // adopting a surface reshapes every control on it.
    const v2 = readFileSync(new URL("../src/app/ckb-v2-tokens.css", import.meta.url), "utf8");
    const v2ControlRadius = /^\s*--radius-md:\s*([\d.]+)rem;/m.exec(v2)?.[1];
    expect(v2ControlRadius, "--radius-md is not declared in the v2 layer").toBeTruthy();
    expect(Math.round(Number.parseFloat(v2ControlRadius!) * 16)).toBe(rungs[2]);
  });
});

describe("type scale floor", () => {
  it("leaves no orphaned utility for the retired step", () => {
    // Retiring a --text-* token silently kills its utility: Tailwind stops
    // emitting the rule, every `text-4xs` class becomes a no-op, and the text
    // falls back to inherited size with nothing failing. Two files carrying
    // `text-4xs` landed from main while this port was in flight and were dead on
    // arrival. Mockups are NOT exempt here — a dead class breaks them too.
    const tracked = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(tsx?|css)$/.test(file))
      .filter((file) => existsSync(new URL(`../${file}`, import.meta.url)));

    const orphans = tracked.flatMap((file) => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      return (
        source
          .split(/\r?\n/)
          .map((line, index) => ({ line, number: index + 1 }))
          // Skip comment lines: the retirement is documented by name in a few places.
          .filter(({ line }) => !/^\s*(\/\/|\/\*|\*)/.test(line))
          .filter(({ line }) => /\btext-4xs\b/.test(line))
          .map(({ number }) => `${file}:${number}`)
      );
    });

    expect(orphans, "text-4xs is retired — Tailwind emits no such rule").toEqual([]);
  });

  it("has no sub-10px step", () => {
    // The 8px --text-4xs step is retired: indefensible at any density in a
    // clinical product.
    expect(themeConfigBlock).not.toContain("--text-4xs");
    const steps = [...themeConfigBlock.matchAll(/^ {2}--text-([a-z0-9-]+):\s*([\d.]+)rem;/gim)];
    expect(steps.length).toBeGreaterThan(0);
    for (const [, name, size] of steps) {
      expect(Number.parseFloat(size) * 16, `--text-${name} is below the 10px floor`).toBeGreaterThanOrEqual(10);
    }
  });
});

describe("leading vocabulary", () => {
  it("has no arbitrary leading-[…] left in production", () => {
    // Nine ad-hoc values (leading-[15px], [0.95rem], [1.05]…[1.62]) used to sit
    // alongside the named steps. They are now Tailwind's own steps plus
    // --leading-display / --leading-prose for the two contexts those could not
    // express. Mockups are design-scratch and exempt, as everywhere else.
    const production = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(tsx?|css)$/.test(file))
      .filter((file) => existsSync(new URL(`../${file}`, import.meta.url)))
      .filter((file) => !/mockup/i.test(file));

    const offenders = production.flatMap((file) => {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      return [...source.matchAll(/\bleading-\[[^\]]+\]/g)].map((match) => `${file}: ${match[0]}`);
    });

    expect(offenders).toEqual([]);
  });

  it("does not redefine Tailwind's own leading steps", () => {
    // Redefining --leading-tight/-snug in :root would silently retune every
    // existing leading-tight / leading-snug call site in the app.
    for (const reserved of ["--leading-tight", "--leading-snug", "--leading-normal", "--leading-relaxed"]) {
      expect(light.has(reserved), `${reserved} belongs to Tailwind — do not shadow it`).toBe(false);
      expect(themeConfigBlock, `${reserved} belongs to Tailwind — do not shadow it`).not.toContain(`${reserved}:`);
    }
    expect(themeConfigBlock).toContain("--leading-display:");
    expect(themeConfigBlock).toContain("--leading-prose:");
  });
});

describe("focus ring", () => {
  it("stays a single affordance", () => {
    // One focus owner: the outline. A companion box-shadow ring here would
    // stack a second affordance AND replace whatever resting elevation the
    // control had, since a blanket rule cannot know it. tests/ui-smoke.spec.ts
    // asserts the rendered consequence; this asserts the rule itself.
    const body = sourceSegment(globals, ':where(button, a, summary, input[type="checkbox"]', "}", {
      label: "shared focus rule body",
    });
    expect(body).toContain("outline: 2px solid var(--focus)");
    expect(body, "the shared focus rule must not paint a box-shadow").not.toContain("box-shadow");
  });
});

describe("category accents stay out of the semantic palette", () => {
  // Identity and status are two different vocabularies sharing one canvas.
  // `semantic-tone.ts` owns six tones where the colour IS the claim — danger,
  // warning, success, info and the two neutrals. A category accent says only
  // "this belongs with those"; it must never borrow a token that says "pause"
  // or "this passed a check".
  //
  // This is not hypothetical: factsheets shipped Therapies on `--success-text`
  // and Tests & procedures on `--warning-text`, so an entire category of
  // patient handouts wore caution-amber on its hero band without any review
  // having produced that judgement.
  const semanticFamilies = /--(danger|warning|success|info)[\w-]*/g;

  it("resolves every [data-category-accent] rule to a non-semantic triad", () => {
    const rules = [...globals.matchAll(/\[data-category-accent="([\w-]+)"\]\s*\{([^}]*)\}/g)];
    expect(rules.length, "no [data-category-accent] rules found in globals.css").toBeGreaterThan(0);
    for (const [, accent, body] of rules) {
      const borrowed = body.match(semanticFamilies) ?? [];
      expect(borrowed, `category accent "${accent}" borrows semantic token(s): ${borrowed.join(", ")}`).toEqual([]);
      expect(body, `category accent "${accent}" declares no --cat-accent`).toContain("--cat-accent:");
      expect(body, `category accent "${accent}" declares no --cat-soft`).toContain("--cat-soft:");
      expect(body, `category accent "${accent}" declares no --cat-border`).toContain("--cat-border:");
    }
  });

  // The defect site itself. `categoryTheme` returns raw CSS value strings that
  // ~20 call sites pass to inline `style`, so a semantic token written here
  // reaches the page without passing through the `[data-category-accent]` rules
  // the assertion above guards. It must stay derived from the registry rather
  // than reacquiring a hand-written per-category table.
  it("keeps the factsheet category theme derived and off semantic tokens", () => {
    const source = readFileSync(new URL("../src/lib/factsheets-data.ts", import.meta.url), "utf8");
    const block = sourceSegment(source, "export function categoryTheme(", "\n}", {
      label: "factsheet categoryTheme",
    });
    const borrowed = block.match(semanticFamilies) ?? [];
    expect(borrowed, `categoryTheme returns semantic token(s): ${borrowed.join(", ")}`).toEqual([]);
    expect(block, "categoryTheme must resolve accents through the shared registry").toContain("categoryAccentVars");
  });

  // Belt and braces for the type union itself. `CategoryAccent` is what makes a
  // semantic accent unrepresentable at every call site at once; if a member is
  // ever added from the status palette, the union stops being the guarantee.
  it("declares no semantic member on the CategoryAccent union", () => {
    const source = readFileSync(new URL("../src/lib/category-identity.ts", import.meta.url), "utf8");
    const union = sourceSegment(source, "export type CategoryAccent =", ";", { label: "CategoryAccent union" });
    for (const forbidden of ["danger", "warning", "success", "info"]) {
      expect(union, `CategoryAccent must not offer "${forbidden}" as an identity accent`).not.toContain(
        `"${forbidden}"`,
      );
    }
  });
});

describe("responsive breakpoint tokens (Task #336)", () => {
  it("declares standard named breakpoint tokens in :root, @theme, and ckb-v2", () => {
    expect(light.get("--bp-phone")).toBe("640px");
    expect(light.get("--bp-tablet")).toBe("768px");
    expect(light.get("--bp-desktop")).toBe("1024px");

    expect(v2Light.get("--bp-phone")).toBe("640px");
    expect(v2Light.get("--bp-tablet")).toBe("768px");
    expect(v2Light.get("--bp-desktop")).toBe("1024px");

    // These three have no product call site, and that is deliberate rather than
    // dead: `MIN_WIDTH_BREAKPOINT_BANDS` in design-system-contract-utils.mjs
    // models them as same-threshold aliases of sm/md/lg, and the tap-floor gate's
    // alias-collision cases in design-system-contract-utils.test.ts are the only
    // fixtures that exercise that path. Deleting them leaves the checker modelling
    // variants Tailwind no longer emits, so they are pinned present, not absent.
    expect(themeConfigBlock).toContain("--breakpoint-phone: 640px;");
    expect(themeConfigBlock).toContain("--breakpoint-tablet: 768px;");
    expect(themeConfigBlock).toContain("--breakpoint-desktop: 1024px;");
  });
});

describe("compat layer agrees with the v2 layer", () => {
  // `layout.tsx` mounts `ckb-v2` unconditionally on <html>, and `.ckb-v2.ckb-v2`
  // (0,2,0) outranks `:root` (0,1,0) on that same element. So for any role both
  // files declare, the v2 value is the one that paints and the globals.css value
  // is dead — editing it has NO visible effect, silently.
  //
  // The v2 migration is deliberate and unfinished, so divergence is pinned rather
  // than banned: `docs/design-system/token-layer-divergences.json` is the reviewed
  // set. A role that STARTS diverging fails here, and so does one that stops,
  // because a stale pin overstates the debt exactly the way GATES.md's hand-copied
  // figures did. Refresh with `npm run design-system:token-divergence:update`.
  it("has no unreviewed divergence between globals.css and ckb-v2-tokens.css", () => {
    expect(diffAgainstPin()).toEqual([]);
  });

  // A conditional `@media` override is a different comparison context from an
  // unconditional declaration. An earlier parser filtered only on `forced-colors`,
  // so any other media block was merged into the base map and its override silently
  // replaced the base value — which reports "identical" for a pair that diverges
  // everywhere the condition does not apply. globals.css has three such `:root`
  // blocks, so this is checked against the real file rather than a fixture.
  it("reads base-theme tokens from unconditional blocks, not from media overrides", () => {
    const layers = readLayers();
    const base = /^\s*--mode-home-copy-reserve:\s*(.+);\s*$/m.exec(globals.slice(globals.indexOf("\n:root {")));
    expect(base, "--mode-home-copy-reserve should still be declared unconditionally").toBeTruthy();
    expect(
      layers.light.compat.get("--mode-home-copy-reserve"),
      "the (min-width: 412px) override must not replace the unconditional value",
    ).toBe(base![1].replace(/\s+/g, " ").trim());

    // Same shape, second instance: `@theme` declares 5.5rem and a
    // (min-width: 640px) block overrides it to 10rem. The base map must hold the
    // unconditional value, because that is the one comparable to a v2 declaration.
    expect(layers.light.compat.get("--spacing-mode-home-composer-wide")).toBe("5.5rem");
  });

  it("rejects a pin whose counts metadata disagrees with divergences", () => {
    const pin = readPin();
    const bad = structuredClone(pin);
    bad.counts = { ...pin.counts, light: 0, dark: 999 };
    const problems = diffAgainstPin(computeDivergences(), bad);
    expect(problems.some((problem) => problem.includes("counts.light"))).toBe(true);
    expect(problems.some((problem) => problem.includes("counts.dark"))).toBe(true);
  });

  // These four are asserted identical on top of the pin. They are the non-colour
  // roles where a silent mismatch is most consequential, so they may not be
  // resolved by adding them to the pin — they have to actually agree.
  const mustMatch = ["text-hero", "text-hero--line-height", "leading-prose", "ease-standard"];

  function soleDeclaration(source: string, role: string, label: string) {
    const matches = [...source.matchAll(new RegExp(`^[ \\t]*--${role}:\\s*(.+);[ \\t]*$`, "gm"))];
    expect(matches.length, `--${role} should be declared exactly once in ${label}`).toBe(1);
    return matches[0][1].replace(/\s+/g, " ").trim();
  }

  for (const role of mustMatch) {
    it(`--${role} is identical in both layers`, () => {
      const compat = soleDeclaration(globals, role, "globals.css");
      const v2 = soleDeclaration(v2Stylesheet, role, "ckb-v2-tokens.css");
      expect(
        compat,
        `--${role} differs between the layers. The v2 value wins at runtime, so the ` +
          `globals.css declaration is dead weight that reads as authoritative. ` +
          `Change both together, or delete the compat declaration.`,
      ).toBe(v2);
    });
  }
});

describe("every fallback-less var() resolves to a declaration", () => {
  // A `var(--x)` with no fallback that names nothing is invalid at computed-value
  // time, so the whole declaration is dropped and the property silently falls back
  // to its initial value. Nothing errors and nothing lints — `--shadow-overlay` sat
  // undeclared in the production sidebar's Appearance menu exactly this way, so the
  // popover rendered with no shadow at all. A fallback (`var(--x, 9999px)`) is fine;
  // that is a deliberate default, not a hole.
  it("names no custom property that is never declared", () => {
    const tracked = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(tsx?|css)$/.test(file))
      .filter((file) => existsSync(new URL(`../${file}`, import.meta.url)));

    // Declarations inside a conditional theme (forced-colors, print) are
    // overrides, not base declarations - a token that exists ONLY there is still
    // unresolved during normal rendering, so they must not satisfy the check.
    const stripConditionalThemes = (source: string) => {
      let out = source;
      for (;;) {
        const at = /@media[^{]*\b(?:forced-colors|print)\b[^{]*\{/.exec(out);
        if (!at) return out;
        let i = at.index + at[0].length;
        let depth = 1;
        while (i < out.length && depth > 0) {
          if (out[i] === "{") depth++;
          else if (out[i] === "}") depth--;
          i++;
        }
        out = out.slice(0, at.index) + out.slice(i);
      }
    };

    const declared = new Set<string>();
    const declare = (rawSource: string) => {
      const source = stripConditionalThemes(rawSource);
      // `--x: value` in CSS, plus the `"--x": value` form used by inline styles.
      for (const m of source.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)) declared.add(m[1]);
      for (const m of source.matchAll(/["'](--[a-zA-Z][\w-]*)["']\s*:/g)) declared.add(m[1]);
      // next/font: `localFont({ variable: "--font-geist-sans" })` declares the name
      // as a VALUE and Next mounts it on <html> via the returned className.
      for (const m of source.matchAll(/\bvariable:\s*["'](--[a-zA-Z][\w-]*)["']/g)) declared.add(m[1]);
    };

    const sources = new Map<string, string>();
    for (const file of tracked) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      sources.set(file, source);
      declare(source);
    }
    // Declared outside src/: Tailwind's default theme arrives via `@import
    // "tailwindcss"`, and next/font mounts its `variable:` names on <html>.
    declare(readFileSync(new URL("../node_modules/tailwindcss/theme.css", import.meta.url), "utf8"));

    const orphans: string[] = [];
    for (const [file, source] of sources) {
      source.split("\n").forEach((line, index) => {
        for (const m of line.matchAll(/var\(\s*(--[a-zA-Z][\w-]*)\s*\)/g)) {
          if (!declared.has(m[1])) orphans.push(`${file}:${index + 1} references ${m[1]}`);
        }
      });
    }

    expect(
      orphans,
      "these var() references name a custom property nothing declares, so the " +
        "declaration is dropped silently at runtime. Declare the token, or give " +
        "the reference an explicit fallback.",
    ).toEqual([]);
  });
});
