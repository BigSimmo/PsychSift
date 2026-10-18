import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, taught this repo's `@theme`.
 *
 * `cn()` used to be a plain `join(" ")`, so a later class could not override an
 * earlier one and every size/colour override had to be worked around at the call
 * site (see the notes in `page-header.tsx`, `document-search-results.tsx`,
 * `master-search-header.tsx` and `mode-home-template.tsx`). twMerge fixes that —
 * but ONLY if it is told about the scales Tailwind generates from
 * `src/app/globals.css`, which is the single source of truth for every name below.
 *
 * Two distinct failure modes motivate this config; both are silent, with no type
 * or lint signal:
 *
 *  1. **Misclassification (deletes a class).** Stock tailwind-merge falls back to
 *     "text colour" for any `text-<x>` it does not recognise as a font size. Its
 *     built-in font-size scale is t-shirt-shaped, so `text-2xs` / `text-3xs`
 *     happen to survive, but `text-sm-minus`, `text-base-minus`, `text-lg-minus`,
 *     `text-2xl-minus`, `text-3xl-minus` and `text-hero` do
 *     not — each was measured being **deleted** when it met the sibling
 *     `text-[color:var(--text-muted)]` in the same `cn()` call. `eyebrowText` is
 *     exactly that pair. Declaring the scale under `theme.text` moves them into
 *     the font-size group, where they belong.
 *
 *  2. **Non-recognition (silently fails to merge).** `size-icon-md`,
 *     `tracking-label`, `leading-prose`, `ease-out-soft`, `animate-shimmer` and
 *     `pt-safe` are not in any stock scale, so twMerge passes them through
 *     untouched and a later `size-icon-lg` does not replace them — the same
 *     override failure `cn()` is being changed to fix.
 *
 * Declaring a family is not free: it changes which class wins at any call site
 * that already writes two of them. Every family below was measured against all
 * 1 409 `cn()` call sites and introduces **zero** new class deletions. The one
 * family that did — `--spacing-tap` — is held back, for the reason recorded
 * against `spacing` below.
 *
 * Radius (`--radius-xs … --radius-2xl`) and the font families reuse Tailwind's own
 * names, so they need no entry. The elevation ladder (`--e0 … --e4`) and the
 * remaining `--shadow-*` roles are plain custom properties consumed as
 * `shadow-[var(--e1)]`; they generate no `shadow-<name>` utility and
 * stock twMerge already groups the arbitrary form correctly. `--spring-*` sit
 * outside a Tailwind namespace and generate nothing.
 *
 * Adding a token to `@theme` in `globals.css` means adding it here too.
 */
export const CLINICAL_TWMERGE_THEME = {
  // globals.css @theme --text-* — size-only steps (no baked leading/tracking).
  // `3xs`/`2xs` already resolve as t-shirt sizes; listed so the scale reads
  // whole and stays correct if that heuristic ever narrows.
  text: ["3xs", "2xs", "sm-minus", "secondary", "base-minus", "lg-minus", "2xl-minus", "3xl-minus", "hero", "display"],

  // globals.css @theme --leading-* — the two steps Tailwind's scale cannot
  // express. Tailwind still owns tight/snug/normal/relaxed.
  leading: ["display", "prose"],

  // globals.css @theme --tracking-* — five named roles. `normal` is also a
  // stock name and needs no entry, but is listed to keep the role set whole.
  tracking: ["display", "normal", "label", "eyebrow", "kicker"],

  // globals.css @theme --spacing-* — generates size-icon-* / h-icon-* /
  // w-icon-* and the mode-home composer reserves. `safe` / `safe-2` are the
  // @utility pt-safe / pb-safe / pb-safe-2 rules further down globals.css,
  // which are padding utilities and should conflict with pt-*/pb-* like any
  // other.
  //
  // `tap` (--spacing-tap, the 48px target knob) was held out of this list until
  // 8 August 2026. The stated reason was that declaring it hands the win to the
  // later class — "22 call sites, 18 of which would drop from 48px to
  // 32/36/40/42px". That figure did not survive re-measurement (#270), and the
  // omission is no longer justified:
  //
  //   - There are ZERO same-variant tap/numeric pairs in production source. The
  //     84 survivors the old scan counted are cross-variant responsive
  //     step-downs (`min-h-tap` with `sm:min-h-9`, `h-10.5` with `sm:h-tap`),
  //     and tailwind-merge groups by variant, so declaring `tap` cannot reach
  //     them. They are live breakpoint steps, not dead classes — deleting them
  //     would RAISE those controls at their breakpoint.
  //   - The named call sites were stale: DocumentManagerPanel and
  //     settings-dialog carry no tap token at all, and document-admin and
  //     service-detail-page pair theirs with no numeric height.
  //   - A per-string-literal scan cannot see a conflict composed across `cn()`
  //     arguments — `cn(recipe, "min-h-tap")` pairs the recipe's `min-h-7` with
  //     the token. A composition-aware sweep that resolves constant recipe
  //     identifiers at each of the 1418 `cn()` call sites finds zero
  //     same-variant pairs in either direction. It was mutation-tested against
  //     synthetic `cn("h-tap", "h-4")` and `cn("min-h-tap", recipe)` probes,
  //     both of which it flags, so that zero is a measurement rather than a
  //     pattern that never matches.
  //
  // AGENTS.md and SPEC §4.10 remain explicit that no production target is ever
  // reduced. That rule is unchanged; what changed is the evidence that declaring
  // `tap` would reduce one. Re-measure before introducing a same-variant pair:
  // order decides the outcome, and tap-then-numeric is the forbidden direction.
  spacing: [
    "compact-meta",
    "disclosure-icon",
    "hero-medallion",
    "icon-2xs",
    "icon-xs",
    "icon-sm",
    "icon-md",
    "icon-lg",
    "icon-xl",
    "mode-home-composer-phone",
    "mode-home-composer-wide",
    "phone-frame",
    "safe",
    "safe-2",
    "search-band-badge",
    "specifier-map-aside",
    "specifier-map-jump",
    "specifier-map-step-number",
    "tap",
  ],

  // globals.css @theme --ease-*.
  ease: ["out-soft", "spring"],

  // globals.css @theme --animate-*.
  animate: [
    "fade-up",
    "overlay-in",
    "sheet-up",
    "sheet-left",
    "pop-in",
    "dialog-rise",
    "action-tray-in",
    "shimmer",
    "answer-progress-breath",
  ],
} as const;

export const twMergeClinical = extendTailwindMerge({
  // Spread rather than inline so `tests/tailwind-merge-config.test.ts` can compare
  // this exact object against the `@theme` block in globals.css. A token added to
  // one and not the other is the silent failure this whole module exists to stop.
  extend: { theme: { ...CLINICAL_TWMERGE_THEME } },
});
