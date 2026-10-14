# PsychSift Design System — the front door

> **Superseded as spec (31 July 2026).** The system of record is now
> [`docs/design-system/`](./design-system/README.md) — SPEC, TOKENS, COMPONENTS, DECISIONS,
> GATES. Where this file or anything it links disagrees with that set, **the set wins**.
> This file remains useful only as a description of the live v1 layer during the transition
> (SPEC §4.11); do not extend it.

This is the single entry point for how UI is designed and built in this app. It states the
contract; the deep documents hold the rationale. Precedence when documents disagree:

1. **This file** — the working contract for day-to-day UI changes.
2. [`docs/redesign/permanent-colour-direction.md`](./redesign/permanent-colour-direction.md) — the authoritative colour specification ("Clinical White / Sky Graphite"). Colour disputes end here.
3. [`docs/redesign/02-design-direction.md`](./redesign/02-design-direction.md) — token rationale: type scale, spacing, radii, elevation, motion.
4. [`docs/redesign/09-ui-primitives-recipes.md`](./redesign/09-ui-primitives-recipes.md) — the recipe catalogue for `src/components/ui-primitives.tsx`.

Design direction is **settled**. Work on the UI is convergence — closing the gap between the
contract and the code — not reinvention. If a change genuinely needs a new direction, update
`permanent-colour-direction.md` first, then the code.

Comparison surfaces also follow [`comparison-behaviour.md`](comparison-behaviour.md). That contract
standardises selection and interaction states while leaving clinical fields and meaning with each
mode.

## 1. Non-negotiables

- **Tokens only.** Every colour comes from a CSS custom property defined in
  `src/app/globals.css` (`:root` + `.dark`). No raw Tailwind palette classes (`red-50`,
  `slate-200`, `bg-white`) and no hex values in components. **If you typed a hex or a Tailwind
  colour name in a component, you broke dark mode** — those values have no `.dark` override.
  Sanctioned raw-colour exceptions are explicit and narrow: the token definitions in
  `globals.css` itself, brand artwork, diagnostic-only visualizations, generated OpenGraph
  artwork, emergency error fallbacks, the two pre-paint theme-colour values in
  `src/lib/theme.ts` (read by the pre-hydration script before any CSS exists), the scoped
  fixed-white Therapy patient sheet, and the scoped factsheet print sheet.
  `RAW_COLOR_EXEMPTIONS` in `scripts/design-system-contract-utils.mjs` owns the path allowlist
  and each entry's `scope`. Prefer a bounded scope over `whole-file` so unrelated colours in
  the same file stay counted, and make a missing boundary fail closed; adding a category
  requires documenting why semantic app tokens are wrong.
- **Semantic vs categorical vs brand.** Three token families, never interchangeable:
  - Semantic triads (`--info/-soft/-border`, `--success-*`, `--warning-*`, `--danger-*`) mean
    something happened or matters clinically. Green is success-only; red is safety/danger-only.
  - Categorical triads (`--type-document/table/search/source/service/form` + `-soft`/`-border`)
    give _identity_ to kinds of things (chips, icon tiles). They carry no status meaning.
  - Brand: `--clinical-accent*` (Clinical Sky) for clinical/evidence identity and primary-action
    accents; `--command*` (graphite) for the primary CTA family.
- **Dark mode is class-based and mandatory.** The `.dark` block re-tunes every token; a
  pre-paint script in `src/app/layout.tsx` applies the stored theme. Nothing else is required
  from components — _if_ they use tokens.
- **Forced-colors and reduced-motion are first-class.** `globals.css` remaps all tokens under
  `@media (forced-colors: active)` and zeroes motion under `prefers-reduced-motion: reduce`.
  Never inline a style that defeats these. Every bespoke `transition`/`animate` needs
  `motion-reduce:` handling or one of the pre-wired `--animate-*` tokens. Scripted
  `scrollTo`/`scrollIntoView` must resolve `behavior` through `resolveScrollBehavior()`
  (`src/lib/scroll-behavior.ts`) — a hard-coded `behavior: "smooth"` overrides the
  reduced-motion CSS and ignores the preference.

### Legacy-hex migration table

When you meet a pre-token hardcode (mockups being promoted, old branches), map it:

| Legacy value                                  | Token                                                             |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `#007a78`, `#006d6b` (old teal action)        | `var(--clinical-accent)` / `var(--clinical-accent-hover)`         |
| `#00669a` (blue icon)                         | `var(--clinical-accent)`                                          |
| `#061740`, `#071844` (navy ink)               | `var(--text-heading)`                                             |
| `#b8dedb` / `#e3f4f5` (teal border/wash)      | `var(--clinical-accent-border)` / `var(--clinical-accent-soft)`   |
| `#f8fbfd`, `#f8fcfc`, `#fbfdff` (page washes) | `var(--surface-wash)` / `var(--surface-subtle)`                   |
| `bg-white`                                    | `bg-[color:var(--surface)]` (or `--surface-lux` for raised cards) |
| `slate-200` / `slate-500` / `slate-600`       | `var(--border)` / `var(--text-soft)` / `var(--text-muted)`        |
| ad-hoc `rgba(...)` shadows                    | an elevation tier `var(--e1…--e4)` or a role alias / `--glow-*`   |

## 2. Type & icon scale

### Type

Named steps live in the `@theme` block of `globals.css` and are **size-only** (no baked
line-height/tracking — set `leading-*`/`tracking-*` at the call site):

`text-3xs` 12px (`0.75rem`, legacy alias of `text-xs`) · `text-2xs` 12px (`0.75rem`, legacy alias of `text-xs`) · (`text-xs` 12px clinical legibility floor / `text-base` 16 from Tailwind) ·
`text-sm` / `text-sm-minus` 13px (v2 `--text-sm` equals `@theme --text-sm-minus` at
`0.8125rem`; Tailwind's default `text-sm` 14px is overridden app-wide because `ckb-v2` is
mounted on `<html>`. Pinned in `tests/ckb-v2-token-contract.test.ts`; do not restore 14px
and do not alias the two files at each other) · `text-base-minus` 15px · (`text-lg` 18 /
`text-xl` 20 / `text-2xl` 24 from Tailwind) · `text-lg-minus` 17px · `text-2xl-minus` 22px.

- **12px (`0.75rem`) is the clinical legibility floor** (owner decision 12 Oct 2026 in `src/app/globals.css`). `text-3xs` and `text-2xs` resolve to `0.75rem` (`12px`, matching `text-xs`) so legacy call sites meet the 12px floor, and an earlier 8px `text-4xs` step is retired. Do not reintroduce any sub-12px step.
- **Leading** uses Tailwind's own steps plus two named additions for the cases they cannot
  express: `leading-display` (1.05) for large display headings and `leading-prose` (1.6) for
  the `max-w-[68ch]` body measure. Arbitrary `leading-[…]` is at zero in production and
  `tests/design-token-contract.test.ts` keeps it there. **Never redefine `--leading-tight` /
  `-snug` / `-normal` / `-relaxed`** — those are Tailwind theme names, and shadowing one
  silently retunes every existing `leading-tight` / `leading-snug` call site. The same test
  fails if they reappear in `:root` or `@theme`.
- **Intermediate font weights are deliberate, not drift.** Geist is a variable face, so
  `520` / `540` / `560` / `580` / `640` / `650` / `680` interpolate rather than snapping, and
  the band/panel treatments in `globals.css` and Therapy Compass use them on purpose. Do
  **not** "normalise" them onto 600/700 — that was attempted on 2026-07-28 and reverted. Weight
  is an expressive axis here; only flag a weight that is genuinely arbitrary and unexplained.
- Arbitrary `text-[Npx]` is **banned**; `npm run check:type-scale` counts offenders.
  **Ratchet:** the count must never rise (baseline recorded in
  `docs/process-hardening.md`). When it reaches 0, wire `check:type-scale --strict` into
  `verify:full` (done — the gate lives in `verify:full:internal` / CI, not in
  `verify:cheap`).
- Tailwind's own `text-xs`/`text-sm`/… carry a baked line-height. When retiring a raw px value
  onto one of them, check the call site for `leading-*` and pin the current effective leading
  explicitly if absent, so nothing shifts.
- **Accepted exceptions:** one-off rem display headings (`text-[2rem]`, `text-[2.7rem]`, …)
  on hero/mode-home titles, and `*-mockups` files. Don't add scale steps for one-off display
  sizes.

### Icon size

Icon **glyphs** use the parallel `--spacing-icon-*` scale in `@theme`:
`size-icon-xs` 12 · `size-icon-sm` 14 · `size-icon-md` 16 (default) · `size-icon-lg` 20 ·
`size-icon-xl` 24 (px). These generate `size-icon-*` / `h-icon-*` / `w-icon-*`, exactly like
`--spacing-tap` → `size-tap`.

- Prefer `size-icon-md` over raw `h-4 w-4` for an icon glyph. `npm run check:icon-scale --strict`
  (in `verify:full` / CI) blocks the retired `4.5` (18px) half-step — icon glyphs resolve to
  `size-icon-lg`, non-icon 18px boxes to `h-5`. It does **not** touch raw `h-4 w-4` (which also
  sizes non-icons), so migrating the long tail onto `size-icon-*` is opportunistic, not enforced.
- **Responsive** icons add a breakpoint variant — `size-icon-md sm:size-icon-lg`. Reserve it for
  a few roles (nav, composer, hero, panel headings); most icons stay one fixed size.
- **Not** for container tiles (`iconTilePremium` / panel-heading tile h-9, empty-state tile h-10)
  or non-icon boxes (the `ToggleSwitch` knob, status dots) — those keep the integer spacing
  scale. Icon glyph size is independent of the tap target (§3), which stays on
  `--spacing-tap`.

## 3. Spacing & tap targets

- 4px grid via Tailwind spacing; safe-area env paddings on shell edges.
- Interactive targets use the `--spacing-tap` token (48px): `min-h-tap` / `min-w-tap` /
  `size-tap`. Do **not** hand-write `min-h-11` / `h-[44px]` for tap semantics, and size a grid
  track that holds a tap target with `var(--spacing-tap)` rather than a copy of the number.
- `min-h-12` sites now match the token instead of exceeding it — leave them; never "fix" a tap
  target down.
- Exception (documented in `globals.css`): the phone composer icon buttons stay 44px below
  431px, because the dock height is part of the search-chrome contract.

## 4. Radius & shadows

- Radii come from `@theme` — `xs` 4 · `sm` 6 · `md` 10 · `lg` 12 · `xl` 16 · `2xl` 20 (px).
  Two deliberate half-steps off the 4px grid: `sm` at 6, for chips and pills that read as too
  heavy at 8, and `md` at 10, which is the control radius the v2 layer also declares. A third
  half-step fails `tests/design-token-contract.test.ts`. Roles are unchanged: `rounded-md`
  chips/pills · `rounded-lg`
  controls/cards/panels · `rounded-xl`+ sheets/dialogs. Never pass a radius token through an
  arbitrary value (`rounded-[var(--radius-md)]` → `rounded-md`) — the plain utility is the
  same token.
- **Elevation is a numbered ladder: `--e0` … `--e4`.** One monotonic sequence that sorts by
  name, hue-tinted rather than flat grey, with negative spread so a shadow pulls inward
  instead of bleeding. `--e0` flush · `--e1` resting hairline · `--e2` cards/popovers ·
  `--e3` hover/lifted chrome · `--e4` modals/sheets/drawers. Dark lifts with a top highlight
  rather than more black.
- The remaining role names are **aliases onto tiers**, not independent values:
  `--shadow-card` / `--shadow-soft` → `--e2`; `--shadow-hover` → `--e3`; `--shadow-elevated` /
  `--shadow-lux` → `--e4`. `--shadow-inset`, `--shadow-rail-active`, `--shadow-focus` and
  `--glow-primary/soft` stay bespoke. All are removed under forced-colors, ladder included.
- No literal `box-shadow` values in components — reach for a tier
  (`shadow-[var(--e2)]`, `hover:shadow-[var(--e3)]`) or a role alias.

## 5. Z-index ladder

Documented in `globals.css` next to the radius rules. Rungs: **0–40** in-page layering ·
**60** app chrome (master search header) · **80–85** document/table overlays · **95** popovers
that beat overlays · **100** the modal layer (`Sheet`) and the skip link · **max** mockup-only
diagnostics. New overlays go through the `Sheet` primitive; anything else picks an existing
rung — never a new number.

## 6. Component recipes

- Check `src/components/ui-primitives.tsx` **before hand-rolling anything**: `cn()`,
  `primaryControl`, `fieldControl*`, `toolbarButton`, `metadataPill`, `sourceCapsule`,
  `toneSuccess/Danger/Info/Warning/Neutral`, `EmptyState`, `LoadingPanel`, `ToggleSwitch`,
  `focusRing`, and ~30 more (catalogue: `docs/redesign/09-ui-primitives-recipes.md`).
- **`src/components/ui/sheet.tsx` is the only modal/overlay primitive.** It provides focus
  trap, initial focus, return-focus-on-close, Escape, backdrop dismiss, body scroll lock,
  safe-area padding, and dark-mode surfaces. Do not hand-roll `role="dialog"` overlays —
  the applications-launcher DetailDialog migration is the template for converting one.
- Empty and loading states use `EmptyState` / `LoadingPanel`, not bespoke markup.
- **Icon-only buttons use `IconButton`** (`ui-primitives.tsx`): its `label` prop is required and
  renders `aria-label` + an `aria-hidden` glyph + a `--spacing-tap` hit area, so an unlabeled icon button
  cannot be written by accident. Pass a recipe (`toolbarButton`, …) via `className` for chrome.
- Composer-chrome caveat: the `answer-footer-search-*` / `desktop-home-search-*` classes are
  intentionally **unlayered** and beat Tailwind utilities on the same element — check the class
  body before adding a utility there (see "CSS cascade layering" in
  `docs/process-hardening.md`).

## 7. Accessibility requirements

**Target: WCAG 2.2 AA.** The rules below are the concrete, enforced floor for meeting it; partial
automated coverage is provided by `tests/ui-accessibility.spec.ts` (reduced-motion, forced-colors,
focus, labels, selected axe-core checks) for the areas it covers, rather than enforcing the full
WCAG 2.2 AA standard, with manual checks for the rest.

- Every interactive element has a visible focus state: the global `:focus-visible` rule is the
  floor; use the `focusRing` recipe on custom controls.
- Dialogs/popovers: use `Sheet` (focus handling is free). If something genuinely can't use it,
  it must implement trap + initial focus + return focus itself.
- Tab patterns: `role="tab"` requires `aria-selected`, `aria-controls`, and a reachable
  `role="tabpanel"`. Reference implementations: dashboard upload tabs
  (`src/components/ClinicalDashboard.tsx`, search `role="tablist"`) and the mobile evidence
  tabs (`src/components/clinical-dashboard/visual-evidence.tsx`).
- Disclosure buttons need `aria-expanded` + `aria-controls` (see `MobileDetailSections` in
  `src/components/applications-launcher-page.tsx`).
- Remote images: always provide a fallback alt — `alt={caption?.trim() || "Clinical document
image"}` — never a possibly-empty variable alone.
- Canonical mobile viewport for manual and automated checks: **390×820**
  (matches `tests/ui-accessibility.spec.ts`, which drives reduced-motion and forced-colors).

## 8. Do / Don't

| Don't                                                         | Do                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `border-red-200 bg-red-50 text-red-700`                       | `toneDanger` recipe, or the `--danger*` triad                   |
| `border-cyan-200 bg-cyan-50 text-cyan-700` for identity chips | a categorical `--type-*` triad                                  |
| hand-rolled `role="dialog"` + Escape listener                 | `<Sheet open onClose title …>`                                  |
| `<button>` with a chevron and no `onClick`                    | wire the disclosure or render a static row                      |
| `text-[11px]` (below the 12px clinical legibility floor)      | `text-xs` (or legacy alias `text-2xs`, both `12px` / `0.75rem`) |
| `text-[12px]` (no leading set)                                | `text-xs leading-normal` (pin the leading)                      |
| `rounded-[var(--radius-md)]`                                  | `rounded-md`                                                    |
| `Number(query.page ?? 1)`                                     | `parseInt` + `Number.isFinite` + `>= 1` clamp                   |
| `alt={caption}`                                               | `alt={caption?.trim() \|\| "Clinical document image"}`          |
| new `z-[73]` for a popover                                    | an existing ladder rung, or `Sheet`                             |
| `shadow-[0_5px_12px_rgba(0,122,120,0.16)]`                    | `shadow-[var(--e1)]`                                            |

## 9. Verification gates — Definition of Done for UI PRs

1. `npm run verify:cheap` — ordinary offline gate: lock parity + lint + typecheck + unit tests.
2. `npm run ensure` then `npm run verify:ui` — Chromium Playwright (smoke, stress,
   accessibility, tools, overlap). Required for any UI/styling/routing change.
3. `npm run check:design-system-contract` — production-only raw colours, literal shadows,
   Therapy inline-parser/style debt, and tap-token drift must not exceed the recorded baseline
   (also in `verify:full` / CI).
4. `node scripts/check-type-scale.mjs` — the count must not exceed the recorded baseline
   (also in `verify:full` / CI; not in `verify:cheap`).
5. Manual dark-mode pass on every screen you touched (theme toggle in the sidebar).
6. Reduced-motion + forced-colors spot check on touched surfaces
   (`ui-accessibility.spec.ts` covers the automated slice; emulate in devtools for the rest).
7. `npm run format:check`.
8. Fill the PR template; the clinical-governance preflight applies only if you touched
   ingestion/answer/search/source-access surfaces — pure UI work states that explicitly.

## 10. File conventions

- New component files are **kebab-case** (`master-search-header.tsx`). The 11 existing
  PascalCase files (`ClinicalDashboard.tsx`, `DocumentViewer.tsx`, …) are grandfathered —
  do not rename them; the churn outweighs the benefit.
- All 26 app modes (`src/lib/app-modes.ts`, `APP_MODES`) share these token, typography, and
  chrome conventions across their mode homes and result surfaces.
- Mockups live under `/mockups/*` routes and `*-mockups.tsx` components. They are shipped,
  noindexed (robots.ts + layout metadata), and exempt from token/type-scale rules — but
  **promoting a mockup to production means bringing it onto the token system first** (see the
  legacy-hex table above).
- **Brand mark** is the PsychSift S, single-sourced in `src/lib/brand-mark.ts` (geometry + SVG
  builders). `BrandMark` (`clinical-dashboard/brand.tsx`) renders it token-themed; `app/icon.svg`,
  `app/apple-icon`, the PWA maskable icons, `app/opengraph-image`, and the inlined mark in
  `public/offline.html` all derive from it. To change the mark, edit `brand-mark.ts` then
  `npm run brand:update`; `brand:check` (in `verify:full` / CI) guards `app/icon.svg` and the
  sentinel-delimited region of `public/offline.html` from drift. That offline page is static and
  script-free — precached by the service worker, with no bundler and no access to `globals.css` —
  so it cannot import `BrandMark` and its mark is inlined from `brandBareMarkInner()` instead; its
  two ink values are mirrored by hand and pinned to `BRAND_LIGHT.ink`/`BRAND_DARK.ink` by
  `tests/pwa-manifest.test.ts`. Regenerating that page also requires a fresh `CACHE_VERSION` in
  `public/sw.js` and a new recorded hash in the same test, or installed clients keep the old copy.
  `app/favicon.ico` is a multi-resolution binary the toolchain can't emit — regenerate it offline
  from `icon.svg` when the mark changes.
  Do not re-draw the paths by hand: they are the exact output of the construction recorded in
  `docs/brand/psychsift-logo.md`, whose master artwork is in `public/brand/`, and the two strokes
  are one path plus its point reflection — which is the only reason the cut between them stays
  parallel. `app/icon.svg` and `favicon.ico` deliberately use the mark's **small-size set**, because
  they are the files browsers render at 16–32 px: the widened cut (`BRAND_STROKE_PATH_SMALL`), the
  point slid out of its cradle (`BRAND_POINT_SMALL`), and the centring that the wider ink box needs
  (`BRAND_GLYPH_TRANSFORM_SMALL`). Those three travel together — mixing one with the other
  variant's placement puts the glyph off-centre in the tile — and `brandMarkInner(colors, true)`
  selects all three from the single `small` flag so a caller cannot pick them apart.
- **The brand sheet is mirrored into `public/`.** `docs/brand/preview.html` is the generated
  construction record; `public/brand/preview.html` is a byte-identical copy so the Developer Hub's
  "Brand and design" card can link to it as a static file (`/brand/preview.html`). It is the one
  hub panel that is not an app route, so `HubPanel.external` marks it, `PanelCard` renders it as a
  real anchor rather than a `<Link>` (the client router has no entry for a file), and
  `tests/developer-hub-panels.test.ts` both excludes it from the route-existence check and holds
  the two copies identical by hash — a stale copy would show a retired mark to the one reader most
  likely to trust it. Regenerate the doc, then copy it over the served one.
- **The brand sheet self-hosts its typefaces, and must keep doing so.** It used to pull Inter and
  IBM Plex Mono from Google Fonts, which meant the clinical origin told a third party whenever
  anyone opened `/brand/preview.html` (2026-09-02 audit, L5). The latin-subset WOFF2 files now sit
  in `public/brand/fonts/` and `docs/brand/fonts/`, declared as `@font-face` inside the sheet's own
  `<style>`, so both copies render with zero external requests. If you regenerate the sheet from a
  tool that emits a `fonts.googleapis.com` stylesheet link, strip it and restore the local faces —
  reintroducing that link silently undoes a privacy fix.
- **In the app the mark has no tile.** `BrandMark` draws the symbol alone, filled
  `--clinical-accent`, standing directly on the page ground — so on a white page it reads as a
  mark rather than an app-store tile pasted into the chrome. It uses
  `BRAND_GLYPH_TRANSFORM_BARE`, which scales the glyph to fill its box, so it occupies the same
  slot the tiled version did. The tiled form survives only where the format has no transparency
  to fall back on: `favicon.ico`, `apple-icon`, and the PWA raster icons.
- **The tile is the ground, the ink is the brand.** `BRAND_*.ink` is pinned to `--clinical-accent`
  and `BRAND_*.tile` to `--surface-raised`, per theme, by `tests/design-token-contract.test.ts`.
  So the symbol rides the application's accent and the tile only ever matches the surface behind
  it. The brand sheet's Deep Navy tile lives on in `public/brand/psychsift-mark.svg` for use off
  the app; putting the in-app mark on navy would mean moving the accent, which is an
  application-wide decision, not a brand-asset one.

## 11. What NOT to do

- No visual redesign; the direction is settled in `permanent-colour-direction.md`.
- No new colour systems, no per-page palettes, no hardcoded hex.
- No hand-rolled modals, no new z-index rungs, no z-index token machinery.
- No file renames for naming-convention reasons alone.
- Don't flip `check:type-scale --strict` while accepted rem display exceptions remain.
- Don't downgrade `min-h-12` deep-sheet controls to `min-h-tap`.
- Don't render page children inside their own Suspense fallback (duplicate-DOM bug — see
  process-hardening).
- UI PRs stay out of RAG/clinical logic (`src/lib/rag*`, ingestion, ranking, answer
  generation, Supabase schema) — that work carries its own eval gates.
