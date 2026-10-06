# PsychSift design system — TOKENS

**The reconciled token inventory (conflict C1 resolved): every role, its winning name, its
owner, and what it replaces. Never values** — values live only in the owner file named per
row. A value restated here is a defect in this document.

- **Date:** 31 July 2026 · companions: [SPEC.md](SPEC.md) · [DECISIONS.md](DECISIONS.md) ·
  [GATES.md](GATES.md)
- **Canonical file:** `src/app/ckb-v2-tokens.css` on `main` (merged via PR #1538) — the
  **single reconciled copy**, also written to design project `08d6f126…` root. The design
  side conforms to it. SHAs are pinned only in DECISIONS' resolution log.
- **History:** the design side's divergent 31 July copy proved unrecoverable (the design
  project was last updated 2026-07-13; that copy was never written to it), so the
  divergences below were resolved by reconciling the repo file and authoring the missing
  family names repo-side (DECISIONS §Resolution log).

**Owner key:** `@theme` — the `@theme` block of `src/app/globals.css` (generates Tailwind
utilities) · `live` — `globals.css` `:root` / `.dark` compatibility layer · `v2` — target
layer `ckb-v2-tokens.css` ·
`design` — design-project copy only · `planned` — nowhere yet.

---

## 1 · The divergences, resolved

This is the two-sources-of-truth failure C1 exists to kill. One winner per role:

| Role                     | Design side has                              | Repo side has                                            | **Winner**                                          | Action                                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recessed well shadow     | `--shadow-well`                              | _(had overridden `--shadow-inset` in both themes)_       | **`--shadow-well`** (new role, both themes)         | **Done (`59e4c3dfc`).** The two v2 `--shadow-inset` overrides became `--shadow-well`, so the DS bevel inherits from `live` again; the contract test now pins `--shadow-well` as a true inset and asserts `--shadow-inset` is _not_ redeclared in `v2`.                     |
| DS bevel                 | `--shadow-inset` (inherited, un-overridden)  | `--shadow-inset` (overridden to a true inset)            | **`--shadow-inset` stays the bevel, owner `live`**  | The v2 override was the wrong move (it stripped a highlight from ~40 surfaces); reverted per above.                                                                                                                                                                        |
| Quantity unit typography | `--quantity-unit-scale`                      | `--quantity-unit-tracking` + `--quantity-unit-gap`       | **repo pair wins**                                  | Two real physical properties beat one ambiguous scale factor; unit _size_ comes from the type scale (one step down), never a bespoke multiplier. Design side deletes `--quantity-unit-scale` at next sync.                                                                 |
| Tap target knob          | `--spacing-tap` declared inside the v2 layer | `--tap-min` literal in `v2`; `--spacing-tap` in `@theme` | **`--spacing-tap`, owner `@theme` — the only knob** | C2 (DECISIONS): **done (PR 5b)** — the 44→48 change landed in `@theme`, `v2`'s `--tap-min` is now the pure alias `var(--spacing-tap)`, and the contract test pins both the alias and the 48px floor. Never set independently; the v2 layer never declares `--spacing-tap`. |
| Evidence-spine roles     | present (names unrecoverable)                | `--spine-w` · `--spine-current` · `--spine-stale`        | **repo names win (authored `59e4c3dfc`)**           | The design-side copy proved unrecoverable, so the names were authored repo-side, derived from existing roles (`--rule-w`, `--clinical-accent`, `--warning`) rather than reconstructed from prose.                                                                          |
| Status-mark roles        | present (names unrecoverable)                | `--status-mark-size` · `--status-mark-stroke`            | **repo names win (authored `59e4c3dfc`)**           | Codifies `StatusMark`'s previously-inline geometry (`--gutter-dot` size; the component's own stroke).                                                                                                                                                                      |
| Confidence-meter roles   | present (names unrecoverable)                | _(absent, deliberately)_                                 | **deferred — no call site**                         | `ConfidenceMeter` (P2) is unbuilt; no new token without a call site. The family enters `v2` with the component.                                                                                                                                                            |

---

## 2 · v2 structural inventory — owner `v2`, uncontested names

Declared in the `.ckb-v2` structural block **[verified: full read at `ef13a072a`]**.

| Group            | Roles                                                                                                                                                                | Notes                                                                                                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space scale      | `--space-0` … `--space-11`                                                                                                                                           | 4px base. Markup never references the raw scale — semantic tokens only.                                                                                                                                                                                                                        |
| Semantic gaps    | `--gap-tight` · `--gap-inline` · `--gap-stack` · `--gap-block` · `--gap-section`                                                                                     | The only inter-element spacing markup may use.                                                                                                                                                                                                                                                 |
| Semantic padding | `--pad-chip-x` · `--pad-control-x` · `--pad-cta-x` · `--pad-card` · `--pad-panel` · `--pad-strip`                                                                    | Heading-inset convention rides on these (SPEC §4.6).                                                                                                                                                                                                                                           |
| Page             | `--page-gutter` · `--page-max` · `--measure` · `--header-h`                                                                                                          | `--measure` is the prose measure — never wider.                                                                                                                                                                                                                                                |
| Type steps       | `--text-{xs,sm,body,md,lg,xl}` · `--text-hero` · `--text-hero--line-height` · `--text-hero-tr`                                                                       | Seven steps. Shared `--leading-prose`; hero keeps `--text-hero--line-height` / `--text-hero-tr` (gated). Unused xs–xl `-lh`/`-tr` companions are orphans — do not re-require them. ⚠️ `--text-hero--line-height` is the one double-dash name — keep as-is; renaming is churn without a defect. |
| Chip sizes       | `Chip` `compact` → `--text-2xs` (legacy compat step); `standard` (default) → `--text-xs`                                                                             | Canonical (#220): dense surfaces opt into `size="compact"`; default adoption keeps `--text-xs`. `--text-2xs` stays a compatibility alias for Chip compact / legacy call sites — not a new v2 type step to invent against. Do not densify every Chip to chase the globals “small chips” note.   |
| Type companions  | `--leading-prose` · `--tracking-eyebrow` · `--nums`                                                                                                                  | `--nums` = numeric variant for all data.                                                                                                                                                                                                                                                       |
| Weights          | `--font-weight-{body,label,heading,value}`                                                                                                                           | One job each; display uses heading weight (SPEC §4.6).                                                                                                                                                                                                                                         |
| Radius           | `--radius-{sm,md,lg,xl,2xl}`                                                                                                                                         | One step per surface role. v2 and live `--radius-md` agreed in PR 5c and are now pinned to each other by the live token contract.                                                                                                                                                              |
| Icons            | `--icon-{xs,sm,md,lg}`                                                                                                                                               | Paired to adjacent type steps.                                                                                                                                                                                                                                                                 |
| Density          | `--tap-min` (alias of `--spacing-tap`, §1) · `--spacing-compact-meta` · `--chip-height` · `--row-comfortable` · `--row-compact` · `--cell-pad-{comfortable,compact}` | Tap target is not row height (gated on resolved values, not strings, now that `--tap-min` is an alias). Compact-meta is 40px metadata/disclosure only; `--row-compact` is 36px row height, never a tap substitute.                                                                             |
| Accent rules     | `--rule-w` · `--rule-accent` · `--rule-warning`                                                                                                                      | ⚠️ Reference `var(--clinical-accent)` / `var(--warning)` **without declaring them** — v2 depends on the live layer for both (§5).                                                                                                                                                              |
| Evidence gutter  | `--gutter-col` · `--gutter-dot` · `--gutter-line-w`                                                                                                                  | One gutter column owns line and dot (SPEC §7).                                                                                                                                                                                                                                                 |
| Evidence spine   | `--spine-w` · `--spine-current` · `--spine-stale`                                                                                                                    | Authored `59e4c3dfc` (§1); derived from rule/accent/warning roles.                                                                                                                                                                                                                             |
| Status mark      | `--status-mark-size` · `--status-mark-stroke`                                                                                                                        | Authored `59e4c3dfc` (§1); codifies `StatusMark`'s inline geometry.                                                                                                                                                                                                                            |
| Quantity         | `--quantity-unit-tracking` · `--quantity-unit-gap`                                                                                                                   | Winners per §1.                                                                                                                                                                                                                                                                                |
| Dashed edge      | `--border-dashed`                                                                                                                                                    | Drop targets / "nothing here yet" — distinct from `--border-strong`, which means emphasis.                                                                                                                                                                                                     |
| Stacking         | `--z-{base,raised,chrome,overlay,popover,modal,toast}`                                                                                                               | Each rung names its `--eN` partner; toast above modal deliberately.                                                                                                                                                                                                                            |
| Motion           | `--duration-{fast,base,slow}` · `--ease-standard` · `--ease-physical`                                                                                                | Durations zero under `prefers-reduced-motion` (gated).                                                                                                                                                                                                                                         |

### Compact-meta vs tap (DS-P1-09 / DS-P2-24)

`--spacing-compact-meta` (`2.5rem` / 40px) lives next to `--spacing-tap` in `@theme` and generates `min-h-compact-meta` / `min-w-compact-meta`. It is **not** a second tap floor.

| Role         | Token / utility                                 | Height | Use on                                                                                                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tap          | `--spacing-tap` → `min-h-tap`                   | 48px   | **Every primary CTA, at every breakpoint.** Apply/Done, Compare, Show more, empty-state command, command/save, View PDF, and any other filled command action. No `sm:`/`lg:` step-down.                                                                                                        |
| Compact-meta | `--spacing-compact-meta` → `min-h-compact-meta` | 40px   | Metadata, disclosure, filter chips, table micro-actions, source `<summary>` rows, search-results header-band chrome, catalogue “Show all” chips, answer view-mode segments. Comment each call site. Prefixed `sm:min-h-compact-meta` / `lg:min-h-compact-meta` is the named desktop step-down. |
| Row compact  | `--row-compact` / `min-h-9`                     | 36px   | Table/list **row height** only. Never a tap target and never a compact-meta stand-in.                                                                                                                                                                                                          |

Hard bans:

- **Never `min-h-11`.** 44px reintroduces the `ui-smoke` sub-pixel rounding flake. The phone composer 44px-below-431px exception is search chrome, not this token.
- **Never reuse `--row-compact` (36px) as tap.** `sm:min-h-9` / `lg:min-h-9` on an interactive control is the defect this rule exists to close: either keep `min-h-tap` (primary) or migrate to `min-h-compact-meta` (documented metadata/disclosure).
- **Never step a primary down at `sm`/`lg`.** Phone already has `min-h-tap`; a prefixed compact class is an override, not “desktop polish”.

Named compact-meta recipes in `ui-primitives.tsx`: `interactiveCompact`, `tableMicroActionRow`. `controlBase` / `primaryControl` stay tap-sized.

## 3 · v2 shell inventory — light and dark blocks

Light block roles **[verified]**: `--background` · `--surface` · `--surface-chrome` ·
`--surface-raised` · `--surface-lux` · `--surface-subtle` · `--surface-wash` ·
`--surface-inset` · `--surface-highlight` · `--clinical-chat-table-header` ·
`--clinical-chat-document` · `--border` · `--border-strong` · `--border-lux` ·
`--text-heading` · `--text` · `--text-muted` · `--text-soft` (deprecated alias) ·
`--decoration-soft` (canonical) · `--disabled` · `--command` · `--command-hover` ·
`--command-active` · `--command-contrast` · `--clinical-accent-soft` ·
`--clinical-accent-border` · `--primary-soft` · `--ring-hairline` · `--e0`…`--e4` ·
`--shadow-well` (recessed well, per §1) · `--glow-primary` · `--glow-soft` ·
`--overlay-backdrop`.

Since the cascade port (PR #1538), the dark block **re-declares every colour role the light
block declares** — required because the light `.ckb-v2` block matches inside dark subtrees,
so any light-declared role left undeclared in dark resolves to its light value (the dark-ink
bug, DECISIONS §Resolution log 6). Standing rule: **a colour role added to the light block is
added to the dark block in the same commit.** Ink is contract-enforced (dark `--text` /
`--text-heading` ≥4.5:1 on the dark surface); the remaining roles are review-guarded until
the full pair-matrix gate lands (GATES §2, gate 1).

## 4 · Identity and category tokens

| Role family                                                                         | Owner     | Status                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--kind-source` · `--kind-answer` · `--kind-workspace`                              | `planned` | The three identity families (SPEC §3, DECISIONS §C5). No values exist yet anywhere; they enter `v2` with their first call site.                                                                |
| `--tone-{purple,indigo,rose,slate}` each with `-soft` and `-border` (twelve tokens) | `live`    | **Frozen, not deleted.** Live across 16 call sites; in dark none matches its nearest `--type-*`, so delete-and-alias would silently change four dark colours. Category channel only (SPEC §3). |
| `--type-*` families                                                                 | `live`    | Information-type colour; unchanged by this pass.                                                                                                                                               |

## 5 · Live-layer roles the v2 contract governs but does not declare

The v2 layer _references_ or _depends on_ these; their values stay in `live` / `@theme`:

| Role                                                    | Owner    | Rule                                                                                                                        |
| ------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--spacing-tap`                                         | `@theme` | **The** tap knob; generates `min-h-tap`/`h-tap`/`size-tap`/`min-w-tap`/`w-tap` (426 call sites). 44→48 landed here (PR 5b). |
| `--clinical-accent`                                     | `live`   | Consumed by v2 `--rule-accent` without declaration — inherited dependency.                                                  |
| `--warning`                                             | `live`   | Consumed by v2 `--rule-warning` — same.                                                                                     |
| `--danger`, `--danger-solid`, `--danger-solid-contrast` | `live`   | Filled danger pairs with `--danger-solid-contrast` (HCM-mapped to `MarkText`); pairing enforced from PR 3.                  |
| `--success`, `--info`                                   | `live`   | Clinical/status palette — reserved channel.                                                                                 |
| `--focus`                                               | `live`   | The only focus outline colour; no companion ring, ever.                                                                     |
| `--ring-highlight`, `--ring-glass`                      | `live`   | Highlight rings on lux surfaces; each carries its own per-theme value, so `dark:ring-*` is gated at zero (GATES §3).        |
| `--text-placeholder`                                    | `live`   | Declared in globals and v2; ≥4.5:1 placeholder ink. Not planned. No further role migration this sweep.                      |

## 6 · Deprecations and deletions

**Type-scale mapping (canonical role → live utility).** SPEC §4.5 is the 7-step
map. `.ckb-v2` remaps those tokens onto the live Tailwind / `@theme` names below.
The 705 legacy minus-steps stay until Hazard 12+ — **do not delete them**. Under
`.ckb-v2`, `text-sm` and `text-sm-minus` currently render the same size (13px);
they will diverge when the legacy notches retire. **Do not mix `text-sm` and
`text-sm-minus` in one component without a named density reason.** Soft-gated by
`sameFileTextSmMinusMix` (warn + per-path ratchet, not a hard zero).

| Role (SPEC §4.5)               | Canonical token | Live utility to pick           | Compact / legacy live name                 |
| ------------------------------ | --------------- | ------------------------------ | ------------------------------------------ |
| Eyebrows / chips / captions    | `--text-xs`     | `text-xs`                      | `text-2xs` (Chip `compact` only)           |
| Metadata / dense cells / hints | `--text-sm`     | `text-sm`                      | `text-sm-minus` (named density only)       |
| UI body / row titles           | `--text-body`   | `text-base-minus`              | —                                          |
| Answer prose                   | `--text-md`     | `text-[length:var(--text-md)]` | `text-lg-minus`                            |
| Card and panel titles          | `--text-lg`     | `text-xl`                      | `text-lg` (Tailwind 18px, not the v2 role) |
| Page titles                    | `--text-xl`     | `text-2xl`                     | —                                          |
| Hero counts                    | `--text-hero`   | `text-hero`                    | —                                          |

| Token                                                                                                               | Disposition                                                                                                                                                                                                                                                                                                | Gate                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--text-soft`                                                                                                       | Deprecated alias of `--decoration-soft`; both resolve identically during the window. Delete when zero references remain outside the alias declaration.                                                                                                                                                     | Contract test pins the tier from both sides; a lint for `--text-soft`/`--decoration-soft` on text-bearing nodes is planned (GATES §1). |
| `--shadow-focus`                                                                                                    | **Delete** (PR 9) — encodes a companion focus ring the conventions forbid; a trap for the next person who greps "focus".                                                                                                                                                                                   | Planned lint after deletion.                                                                                                           |
| `--shadow-lift`                                                                                                     | Retire into the `--eN` ladder (PR 9).                                                                                                                                                                                                                                                                      | Planned.                                                                                                                               |
| `--shadow-card`, `--shadow-soft`                                                                                    | Aliases of a ladder step; retire **inside the recipes first**, then delete.                                                                                                                                                                                                                                | Planned.                                                                                                                               |
| `--spring-bouncy` + two other dead springs                                                                          | Delete (PR 9); byte-duplicate and unused curves.                                                                                                                                                                                                                                                           | Planned.                                                                                                                               |
| `--quantity-unit-scale` (design side)                                                                               | Never lands; superseded per §1.                                                                                                                                                                                                                                                                            | Next design sync removes it.                                                                                                           |
| Legacy type steps (`text-2xs`/`3xs`, `sm-minus`, `base-minus`, `2xl-minus`, `lg-minus`, `3xl-minus`, `3xl/4xl/5xl`) | Retired **last of all** — ≈663 call sites; `--text-md` arrives additively first. ⚠️ `Quantity` currently consumes `text-base-minus` — fix in the retirement tranche. `--text-2xl-compact` left this list early (`#297`): it had zero consumers, so retiring it needed no tranche and rendered identically. | Contract ratchet extension, planned.                                                                                                   |

## 7 · Usage rules — allowed and forbidden, per group

| Group                                                                         | Allowed                                                                                 | Forbidden                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Ink (`--text*`, `--decoration-soft`, `--disabled`)                            | Per the SPEC §4.3 role table                                                            | `--decoration-soft`/`--text-soft` on any text node; darkening the decoration tier to "pass"                 |
| Clinical state (`--danger*`, `--warning`, `--success`)                        | Source state and sanctioned urgency only                                                | Decoration, numerals, charts, identity, category colour                                                     |
| Category (`--tone-*`)                                                         | Within-surface category chips/pills                                                     | Mode identity; new hues; delete-and-alias                                                                   |
| Identity (`--kind-*`)                                                         | Surface-kind identity per SPEC §3                                                       | Varying by clinical state                                                                                   |
| Elevation (`--e0…--e4`, `--ring-hairline`, `--shadow-inset`, `--shadow-well`) | One edge owner; ladder per SPEC §4.7                                                    | 1px spread terms; child heavier than parent; v2 redeclaring the bevel                                       |
| Stacking (`--z-*`)                                                            | Via `OverlayRoot`/named rungs only                                                      | Any raw `z-` value; new rungs without an `--eN` partner                                                     |
| Motion (`--duration-*`, `--ease-*`)                                           | All transitions/animations                                                              | Hardcoded durations; animating layout properties                                                            |
| Density (`--spacing-tap`, `--tap-min`, `--spacing-compact-meta`, rows, cells) | Utilities from `@theme`; `--tap-min` as alias; compact-meta only on metadata/disclosure | Setting the pair independently; reducing any 48px **primary**; `--row-compact`/`min-h-9` as tap; `min-h-11` |
| Space/type/radius                                                             | Semantic tokens in markup                                                               | Raw scale values or literals in components; `--measure` on non-prose                                        |
| Quantity/spine/status-mark                                                    | Their named components only                                                             | Reuse as generic decoration                                                                                 |
| Mode identity (`--mode-identity*`)                                            | A mode's OWN chrome — its switcher pill, its in-page bar — via `data-mode-identity`     | Page content; clinical state; a semantic hue; a mode without a §7.1 row                                     |
| Dashboard style (`--dash-*`, `font-dash-*`)                                   | Inside `.dash-surface` only — My Day and the Psychiatry hub, per §7.2                   | Clinical pages; source or clinical state; any surface outside `.dash-surface`                               |

### 7.1 · Mode identity — the owner decision, 2026-09-13

The Category row above forbids `--tone-*` for mode identity, and it still does. Mode identity
has its own family instead, for two reasons that are not preference: the category triads carry
no contrast partner, so a filled shape in one has no defined glyph colour (a white glyph on the
dark-theme mauve fails 4.5:1 badly), and `APP_MODE_ACCENT` was written for a different job —
extending it would drag in tests that mean something else.

| Mode    | Light     | Dark      | Ratio against its own contrast token |
| ------- | --------- | --------- | ------------------------------------ |
| On Call | `#175f63` | `#8fc9c5` | 7.4:1 light, 8.2:1 dark              |

Rules, all enforced by `tests/design-token-contract.test.ts`:

- **Every mode defaults to the product accent.** The `:root` values alias `--clinical-accent*`,
  so stamping `data-mode-identity` on every mode's pill changes nothing until a mode declares a
  hue. Light, dark and forced-colors come free, because `.ckb-v2`, `.dark` and the forced-colors
  block all land on `<html>` — the same element as `:root`.
- **Four tokens or none.** Accent, soft, border and a contrast partner. The partner is what
  makes the hue safe on a fill rather than only as text, and both ratios are computed and pinned.
- **It flattens under forced colors** to `LinkText`/`Canvas`/`ButtonBorder`/`ButtonText`, the
  same pairing the accent uses. Identity is a decorative distinction; high contrast has no room.
- **Delivery is the attribute, on the narrowest wrapper that needs it.** The attribute remaps
  `--clinical-accent*` locally, so everything already painting that chrome repaints together and
  cannot drift. Today that is exactly two elements — the mode pill's `<button>` and the in-page
  bar's `<nav>`. Tinting a whole mode is a separate, deliberate decision.
- **Nothing semantic, ever.** A mode's hue must not repaint clinical state, source state, or a
  category chip. It says which mode you are in and nothing else.

### 7.2 · Dashboard style — an owner-approved exception, 2026-10-03

The personal My Day dashboard (`/my-day`, its Today, Work and Me pages) is drawn in a
dashboard style that the owner approved from the v13 design review mock-up (concept D) and
asked to match closely: "fix it up for me so it almost completely matches the mockup with the
polished perfected style". It is an **exception for that one personal page**, not a new house
style. Clinical pages, answers, sources and every source-status meaning are untouched.

What the exception allows, all scoped to the `.dash-surface` wrapper in
`src/app/globals.css`, with light, dark (`.dark .dash-surface`) and forced-colors values:

- **Its own palette** (`--dash-page`, `--dash-card`, `--dash-raised`, `--dash-line*`,
  `--dash-ink`, `--dash-muted`, `--dash-faint`, `--dash-blue*`, `--dash-green*`,
  `--dash-amber*`, `--dash-night*`, `--dash-flag`, `--dash-hero-*`), copied from the mock-up.
  The flag card is green, the CPD rings are blue, green and amber (one per CPD type), and the
  mode chips and colleague avatars are tinted, as in the mock-up.
- **Heavier type**: `--font-weight-dash-title: 700` and `--font-weight-dash-figure: 800` in
  `@theme` (utilities `font-dash-title`, `font-dash-figure`), for card titles and figures only.
  SPEC §4.6's weight roles still hold everywhere else.
- **A blue hero gradient** (`.dash-hero`), wallet and avatar gradients, chart bar gradients.
- **A 16–20px card corner** (`rounded-2xl`) and tinted icon chips, from `dashboard-kit`.

What it never allows:

- **Colour as state.** On this dashboard a colour is decoration or a category (a CPD type, a
  mode chip, a colleague). Amber marks only a recorded date that has passed, and always with
  the words "Date passed" or "Overdue" beside it. No `--dash-*` colour may stand for a source's
  validation status, a clinical risk, or any `--danger*`/`--warning`/`--success` meaning.
- **Use outside `.dash-surface`.** The tokens resolve only inside that wrapper; a clinical
  page that borrowed a `--dash-*` name would get nothing.
- **Smaller tap targets.** The 48px rule (`min-h-12`) stands on every control; compact faces
  sit inside a 48px hit area.

Components live in `src/components/dashboard-kit/` (hero/flag/default card, icon chip, stat
tile, progress ring and ring stack, item row, pill, segmented switch, week tiles, quick
actions). A second page wanting this style is a new owner decision, not a reuse of this one.

**Second owner decision, 2026-10-03: the Psychiatry hub (`/psychiatry`).** The owner rejected a
plain clinical hub ("the psych hub is poorly designed… I want it where possible designed like the
personal hub") and approved the v2 mock-up in this style. The hub is a front door of links into
the psychiatry sections, not clinical content, so it may use `.dash-surface` with these limits:
blues and neutrals only (no `--dash-green*` or `--dash-amber*`, because on clinical pages those
hues read as source status); every figure real or absent; and the sections it links to keep the
mode kit. Any other page still needs its own owner decision.

## 8 · Naming rules going forward

- No new token without a call site and a usage rule (SPEC §12).
- Roles are named for their job, never their appearance or a place ("well", "bevel",
  "placeholder" — not "grey-2").
- A deprecation ships with an alias, a lint rule, and a named deletion condition.
- The design-sync manifest is generated; a hand-edited token entry anywhere under `_ds/` is a
  defect regardless of its content.

## 9 · Component-scoped families the contract does not govern

None today. The one family this section recorded — `--ward-*`, `--net-*` and `--co-*`, the Ward
Flow bed board's private spacing, line-height and z-index vocabulary — was retired with the Ward
Flow prototype on 2026-09-26. A new component-scoped family needs a row here before it ships: an
unregistered token family is indistinguishable from drift, and §8 forbids a token without a usage
rule.
