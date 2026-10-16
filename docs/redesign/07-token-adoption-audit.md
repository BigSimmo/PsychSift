# Token Adoption Audit — Clinical KB (July 2026)

## July 3 run — design-token adoption sweep across `src/components`

This run audits **how consistently the codebase consumes the design tokens**, not the
token system itself. The token _foundation_ in `src/app/globals.css` is strong; the
findings below are all about call-site adoption drift — tokens that exist but are
reached past, defined-but-unused utilities, and hardcoded values that bypass the scale.

Scope: `src/components` (50 `.tsx` files, ~40 className recipes in
`src/components/ui-primitives.tsx`) plus a repo-wide check for the `@theme inline`
bridge utilities. Two files carry most of the palette leaks
(`ClinicalDashboard.tsx`, `differentials/differential-presentation-workflow-page.tsx`)
and are both active mockup surfaces on `feature/tools-page-mockups` — treat their
findings as "clean before the pattern spreads," not shipped-primitive regressions.

**Score: 78/100** — 0 critical · 3 medium · 6 low.

## Summary

| Area                     | State  | Note                                                                                                                             |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Token foundation         | Keep   | Full neutral + accent ramps, semantic triads, dark, forced-colors, reduced-motion, elevation, motion, safe-areas. Best-in-class. |
| Color discipline (hex)   | Keep   | 0 hardcoded hex in components (1 legit SVG logo fill). Palette leaks contained to 2 mockup files.                                |
| Token-access consistency | Fix    | A defined-but-dead utility bridge means two ways to reach every color; the verbose form is used universally.                     |
| Type scale               | Fix    | Scale mostly followed, but ~295 hardcoded px font sizes; the `text-2xs` token is defined yet unadopted.                          |
| File naming              | Polish | PascalCase vs kebab-case split, mixed inside the same folder.                                                                    |
| Component docs           | Polish | Recipe pattern is sound but has no documented state/variant contract.                                                            |

## Findings

### Naming consistency

| Location                               | Finding                                                                                                                                                                                                             | Class  | Planned action                                           | Tier |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- | ---- |
| `src/components/*` file names          | 11 PascalCase files (`ClinicalDashboard`, `ClinicalSidebar`, `DocumentManagerPanel`…) vs ~39 kebab-case, **mixed inside the same folder** (`clinical-dashboard/ClinicalSidebar.tsx` next to `dashboard-shell.tsx`). | Polish | Standardize on kebab-case (majority + newer convention). | 3    |
| `src/components/ServiceDetailPage.tsx` | 1-line re-export shim to `services/service-detail-page.tsx`; PascalCase shims keep the naming drift alive.                                                                                                          | Polish | Track for removal once import paths are migrated.        | 3    |

### Token coverage

| Location                                                                                            | Finding                                                                                                                                                                                                                                                                                                                                                                                | Class   | Planned action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Tier |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `globals.css:46-77` (`@theme inline` bridge)                                                        | **M1.** Defines `--color-surface`/`--color-muted`/`--color-heading`/`--color-clinical-accent`… → generates `bg-surface`/`text-muted`/`text-heading` utilities. **Repo-wide usage: 0.** All ~1374 call sites use the verbose `text-[color:var(--text-muted)]` form instead. The line-45 comment ("lets new/refactored code use bg-surface, text-muted") is aspirational — no code does. | Fix     | Decide: adopt short utilities repo-wide (1374-site churn) **or** delete the dead bridge + fix the comment (small, safe — zero-usage confirmed across `src`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 2    |
| `ClinicalDashboard.tsx:6052-6055`; `differential-presentation-workflow-page.tsx:47-72`              | **M2.** Hand-rolled tone helpers re-implement the danger/info/warning/success triads with raw Tailwind palette classes (`border-red-200 bg-red-50 text-red-700`). They **don't respond to `.dark`** and are mutually inconsistent (differentials maps *warning*→`rose`; the `--warning-*` token is amber). 27 raw-palette instances, confined to these 2 mockup files.                 | ✅ Done | **Resolved on `feature/tools-page-mockups`.** All raw-palette instances routed through the `--danger`/`--info`/`--warning`/`--success` triads (+ `bg-white`→`--surface`); verified 0 raw-palette / `bg-white` remain, all tokens resolve in light + `.dark` + `forced-colors`. **Correction to the prescription:** differentials `warning` → `--danger` (red), **not** amber — that tone renders "Must-not-miss" red-flags (`src/lib/differentials.ts`); amber would understate a safety-critical signal. Amber `--warning` stays reserved for `status === "urgent"`.                                                                                                                                                                                                                                                                                                                                                                                              | 2    |
| `text-[11px]` ×142 (`text-2xs` ×2), `text-[10px]` ×58, `text-[15px]` ×45, `text-[13px]` ×30, +8/9px | **M3.** ~295 hardcoded px font sizes bypass the scale. `--text-2xs` (11px) is defined with its own line-height + letter-spacing yet almost unused. Sub-`xs` (8–10px) and "between" sizes (13px, 15px) have **no** scale tokens. Default scale is otherwise well followed (`text-xs` ×452, `text-sm` ×383).                                                                             | Fix     | Add tokens for 13/15px (optionally 8–10px). **Note:** `text-[11px]`→`text-2xs` is _not_ a pure swap — `text-2xs` adds `letter-spacing: 0.06em` + `line-height: 1rem`, so it changes rendering. Needs a visual pass, not a codemod.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 2    |
| `bg-white` ×7, `text-white`/`ring-white` ×35, `bg-black` ×1                                         | **L4.** Hardcoded white/black neutrals. `bg-white` is the real dark-mode risk (should be `--surface`); `text-white`/`ring-white` on accent buttons should use `--clinical-accent-contrast` / `--command-contrast`.                                                                                                                                                                     | Polish  | Swap `bg-white`→`--surface`; accent-button text→`*-contrast` tokens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2    |
| `ClinicalDashboard.tsx:6138`                                                                        | **L5.** Hardcoded `border-blue-400` + arbitrary accent shadow bypasses `--clinical-accent` / `--glow-*`.                                                                                                                                                                                                                                                                               | Polish  | Use accent + glow tokens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 3    |
| `min-h-[44px]`/`min-h-[48px]`/`min-w-[48px]`/`h-[44px]`/`w-[44px]` ~74×                             | **L6.** Repeated WCAG tap-target magic numbers with no token. Good that the minimums exist; bad that they're copy-pasted px.                                                                                                                                                                                                                                                           | ✅ Done | **Resolved by standardizing on the default `-11`/`-12` scale, not a new token.** The codebase already had two 44px conventions — arbitrary `[44px]` (69×) _and_ scale `-11` (164×, adopted by the design-review commit); `-11` is also used for decorative 44px, so a semantic `-tap` token would need per-site tap-vs-decorative judgment across ~200 sites. Swapped the 69 arbitrary `min-h-[44px]`→`min-h-11`, `[48px]`→`min-h-12`, `h/w-[44px]`→`h/w-11`, `min-w-[48px]`→`min-w-12` (identical at the default 16px root size; rem-based utilities scale with interface density) across 8 files; 0 arbitrary tap tokens remain repo-wide except 1 deliberate `!min-h-[48px]` floor in `src/components/clinical-dashboard/account-setup-dialog.tsx:246` (which holds a hard 48px floor against root `font-size: 15px` density scaling where `min-h-12` / `3rem` shrinks to 45px, preserving the `ui-smoke` 48px bounding-box assertion on SSO provider buttons). | 3    |
| `rounded-[var(--radius-lg)]` ×4                                                                     | **L7.** Token reached the long way when the `rounded-lg` utility exists.                                                                                                                                                                                                                                                                                                               | Polish  | Replace with `rounded-lg`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 3    |

### Component layer

| Location                          | Finding                                                                                                                                                                                                                                                                               | Class   | Planned action                                                                                                                                                                                                                                                                                                                                           | Tier |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `ui-primitives.tsx` (~40 recipes) | **L8.** The "component library" is ~40 className _recipes_ (`primaryControl`, `fieldControl`, `metadataPill`…) + `cn()`, plus one real React component (`ui/sheet.tsx`). Solid pattern, but no documented state contract (hover/active/disabled/loading) per recipe and no docs file. | ✅ Done | **Reference written: `09-ui-primitives-recipes.md`** — documents the pattern, the state/variant contract (tap-size / hover / active / focus-visible / disabled / loading), a full recipe catalog, and the React components. It also surfaces the contract **gaps** (e.g. `focus-visible` missing on the `controlBase` button family) as a11y follow-ups. | 3    |

## Priority actions

1. **M1 — ✅ DONE.** The dead `@theme inline` colour bridge + misleading comment were
   deleted from `globals.css` (0 consumers across `src`, confirmed). Change lives in the
   working tree; ensure it lands with the branch.
2. **M2 — ✅ DONE (`feature/tools-page-mockups`).** Both mockup files' tone helpers now
   route through the semantic triads (dark-mode-safe). Correction: differentials
   `warning` resolved to `--danger` (red), not amber — it renders "Must-not-miss"
   red-flags. _(NB: this file was re-clobbered to raw `rose` once by concurrent WIP and
   re-fixed — keep an eye on it until committed.)_
3. **M3 — partly unblocked.** The missing scale tokens have since been **added** to
   `@theme` (`--text-4xs` 8px, `--text-3xs` 10px, `--text-2xs` 11px [now tracking-free],
   `--text-sm-minus` 13px, `--text-base-minus` 15px), and they are intentionally
   **size-only** — so `text-[Npx]`→token is now a _pure_ swap for exact-match sizes
   (8/10/11/13/15px), no longer the tracking-shifting hazard the original note warned
   about. **Remaining:** adopt the tokens (~295 `text-[Npx]` sites); `text-[9px]` has no
   exact token (snaps to 8px `--text-4xs`) so needs a per-site call, not a blind swap.

## Method / reproduce

- Hardcoded hex: `rg '#[0-9a-fA-F]{3,8}\b' src/components -g '*.tsx'`
- Raw palette: `rg '\b(bg|text|border|ring|from|to|via|fill|stroke)-(gray|slate|…|rose)-(50|…|950)\b' src/components -g '*.tsx'`
- Dead bridge: `rg '("|'"'"'| )(bg-surface|text-muted|text-heading|…)( |"|'"'"')' src` → 0 hits.
- Arbitrary values ranked: `rg -oN '…-\[[^]]+\]' src/components -g '*.tsx' | sort | uniq -c | sort -rn`

## July 18 run — Phase 5 design-polish sweep (re-score + live route sweep)

Scope: full re-run of the July 3 grep method on current `main`, plus a live
route sweep — 15 production routes × (1440×1000 desktop + 390×844 phone),
320×844 spot checks on the 4 densest routes, and dark / reduced-motion /
forced-colors desktop spots on `/`, `/differentials`, `/documents/search`.
Server identity confirmed via `/api/local-project-id` before attaching.

**Score: 92/100** — 0 critical · 0 medium · 2 low (naming consistency and the
mockup-file palette leaks, both unchanged P3 charter exclusions).

### Re-score of July 3 findings

| Item                              | July 3           | July 18                                                                                                                                                          |
| --------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 dead `@theme inline` bridge    | Fix              | ✅ Resolved (bridge deleted).                                                                                                                                    |
| M2 raw-palette tone helpers       | Done on branch   | ✅ Landed; production `src/components` has 0 raw-palette classes (3 mockup files only).                                                                          |
| M3 ~295 hardcoded px font sizes   | Partly unblocked | ✅ Adopted; `check:type-scale --strict` passes with 0 arbitrary sizes in `src`.                                                                                  |
| L4 hardcoded white/black neutrals | Polish           | ✅ Down to 4 sites, all the deliberate `ring-1 ring-white/N dark:ring-white/10` glass-highlight idiom with explicit dark variants. 0 accent-button `text-white`. |
| L5 `border-blue-400`              | Polish           | ✅ Gone.                                                                                                                                                         |
| L6 tap-target magic numbers       | Done             | ✅ Holds (0 arbitrary tap tokens except 1 deliberate `!min-h-[48px]` floor in `account-setup-dialog.tsx:246` against root `font-size` scaling).                  |
| L7 `rounded-[var(--radius-lg)]`   | Polish           | ✅ Gone.                                                                                                                                                         |
| L8 recipe contract docs           | Done             | ✅ Holds (`09-ui-primitives-recipes.md`).                                                                                                                        |

Hex audit note: every current hex hit in production components is a legitimate
class — print-handout surfaces (`FactsheetPrintSheet`, therapy-compass sheet
`@media print`), official provider brand marks (Google/Microsoft), web-vitals
console-log colors, PR-number code comments (regex false positives), and the
white switch-knob-on-accent-track pattern.

### Route sweep result

43 captures: 0 horizontal overflow at any viewport (including 320px), 0
console errors, 0 failed network requests. Mode-home template routes render
consistently across desktop/phone/320; dark theme and reduced-motion spots
clean.

### New findings (all fixed in this pass)

1. **Forced-colors blank button labels** (`globals.css` forced-colors block).
   Chromium paints a Canvas backplate behind every glyph run in forced-colors
   mode, so glyph tokens that resolved to the Canvas/ButtonFace family
   (`--command-contrast`, `--primary-contrast`, `--clinical-accent-contrast`,
   `--danger-solid-contrast`) rendered solid-button labels as blank boxes —
   invisible to axe, which reads CSS rather than painted pixels. SVG strokes
   get no backplate, so the dark `--command` fill also swallowed ButtonText
   icons. Fix: command controls flatten to the native HCM pairing
   (ButtonFace fill / ButtonText glyphs); accent fills keep their system
   colors and flip only their glyph tokens to ButtonText. Regression-locked by
   a new `ui-accessibility.spec.ts` test asserting the glyph tokens never
   resolve to the Canvas color.
2. **Tools quick-action rail title truncation at 1440×1000**
   (`applications-launcher-page.tsx`). The desktop 6-up rail left ~85px for
   text against ~92px titles ("Ask eviden…", "Safety che…"). Fix: tightened
   card metrics (icon column 2.25rem→2rem, gap-3→gap-2, px-3→px-2.5, icon
   h-9→h-8); all six titles now render whole, descriptions remain
   designed-supplementary ellipsis (full copy lives in the All-tools cards and
   aria-labels). Phone icon-grid variant untouched.
3. **Privacy-page microcopy** (`src/app/privacy/page.tsx`). JSX drops a
   newline adjacent to a tag, rendering "…patient-record systemand does not
   ask…". Fixed with an explicit `{" "}`; locked by a `privacy-ui.test.ts`
   assertion.

Observation, no action: a sub-perceptual glass-header backdrop-gradient ghost
at the content top-left (visible only at 4× zoom) — by-design translucency.
