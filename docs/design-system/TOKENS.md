# Clinical KB design system — TOKENS

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

| Group            | Roles                                                                                                                                     | Notes                                                                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space scale      | `--space-0` … `--space-11`                                                                                                                | 4px base. Markup never references the raw scale — semantic tokens only.                                                                                                                                                                                                                      |
| Semantic gaps    | `--gap-tight` · `--gap-inline` · `--gap-stack` · `--gap-block` · `--gap-section`                                                          | The only inter-element spacing markup may use.                                                                                                                                                                                                                                               |
| Semantic padding | `--pad-chip-x` · `--pad-control-x` · `--pad-cta-x` · `--pad-card` · `--pad-panel` · `--pad-strip`                                         | Heading-inset convention rides on these (SPEC §4.6).                                                                                                                                                                                                                                         |
| Page             | `--page-gutter` · `--page-max` · `--measure` · `--header-h`                                                                               | `--measure` is the prose measure — never wider.                                                                                                                                                                                                                                              |
| Type steps       | `--text-{xs,sm,body,md,lg,xl}` each with `-lh` and `-tr` · `--text-hero` · `--text-hero--line-height` · `--text-hero-tr`                  | Seven steps, per-step line-height and tracking (gated). ⚠️ `--text-hero--line-height` is the one double-dash name — keep as-is; renaming is churn without a defect.                                                                                                                          |
| Chip sizes       | `Chip` `compact` → `--text-2xs` (legacy compat step); `standard` (default) → `--text-xs`                                                  | Canonical (#220): dense surfaces opt into `size="compact"`; default adoption keeps `--text-xs`. `--text-2xs` stays a compatibility alias for Chip compact / legacy call sites — not a new v2 type step to invent against. Do not densify every Chip to chase the globals “small chips” note. |
| Type companions  | `--leading-prose` · `--tracking-eyebrow` · `--nums`                                                                                       | `--nums` = numeric variant for all data.                                                                                                                                                                                                                                                     |
| Weights          | `--font-weight-{body,label,heading,value}`                                                                                                | One job each; display uses heading weight (SPEC §4.6).                                                                                                                                                                                                                                       |
| Radius           | `--radius-{sm,md,lg,xl,2xl}`                                                                                                              | One step per surface role. v2 and live `--radius-md` agreed in PR 5c and are now pinned to each other by the live token contract.                                                                                                                                                            |
| Icons            | `--icon-{xs,sm,md,lg}`                                                                                                                    | Paired to adjacent type steps.                                                                                                                                                                                                                                                               |
| Density          | `--tap-min` (alias of `--spacing-tap`, §1) · `--chip-height` · `--row-comfortable` · `--row-compact` · `--cell-pad-{comfortable,compact}` | Tap target is not row height (gated on resolved values, not strings, now that `--tap-min` is an alias).                                                                                                                                                                                      |
| Accent rules     | `--rule-w` · `--rule-accent` · `--rule-warning`                                                                                           | ⚠️ Reference `var(--clinical-accent)` / `var(--warning)` **without declaring them** — v2 depends on the live layer for both (§5).                                                                                                                                                            |
| Evidence gutter  | `--gutter-col` · `--gutter-dot` · `--gutter-line-w`                                                                                       | One gutter column owns line and dot (SPEC §7).                                                                                                                                                                                                                                               |
| Evidence spine   | `--spine-w` · `--spine-current` · `--spine-stale`                                                                                         | Authored `59e4c3dfc` (§1); derived from rule/accent/warning roles.                                                                                                                                                                                                                           |
| Status mark      | `--status-mark-size` · `--status-mark-stroke`                                                                                             | Authored `59e4c3dfc` (§1); codifies `StatusMark`'s inline geometry.                                                                                                                                                                                                                          |
| Quantity         | `--quantity-unit-tracking` · `--quantity-unit-gap`                                                                                        | Winners per §1.                                                                                                                                                                                                                                                                              |
| Dashed edge      | `--border-dashed`                                                                                                                         | Drop targets / "nothing here yet" — distinct from `--border-strong`, which means emphasis.                                                                                                                                                                                                   |
| Stacking         | `--z-{base,raised,chrome,overlay,popover,modal,toast}`                                                                                    | Each rung names its `--eN` partner; toast above modal deliberately.                                                                                                                                                                                                                          |
| Motion           | `--duration-{fast,base,slow}` · `--ease-standard` · `--ease-physical`                                                                     | Durations zero under `prefers-reduced-motion` (gated).                                                                                                                                                                                                                                       |


`--spacing-compact-meta` (`min-h-compact-meta`, 40px) is metadata/disclosure only — never a primary CTA or tap-floor substitute; Agent 2 will expand this policy.

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

| Role                                                    | Owner            | Rule                                                                                                                        |
| ------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--spacing-tap`                                         | `@theme`         | **The** tap knob; generates `min-h-tap`/`h-tap`/`size-tap`/`min-w-tap`/`w-tap` (426 call sites). 44→48 landed here (PR 5b). |
| `--clinical-accent`                                     | `live`           | Consumed by v2 `--rule-accent` without declaration — inherited dependency.                                                  |
| `--warning`                                             | `live`           | Consumed by v2 `--rule-warning` — same.                                                                                     |
| `--danger`, `--danger-solid`, `--danger-solid-contrast` | `live`           | Filled danger pairs with `--danger-solid-contrast` (HCM-mapped to `MarkText`); pairing enforced from PR 3.                  |
| `--success`, `--info`                                   | `live`           | Clinical/status palette — reserved channel.                                                                                 |
| `--focus`                                               | `live`           | The only focus outline colour; no companion ring, ever.                                                                     |
| `--ring-highlight`, `--ring-glass`                      | `live`           | Highlight rings on lux surfaces; each carries its own per-theme value, so `dark:ring-*` is gated at zero (GATES §3).        |
| `--text-placeholder`                                    | `planned` (PR 3) | New role ≥4.5:1; until it exists, placeholders use `--text-muted`.                                                          |

## 6 · Deprecations and deletions

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

| Group                                                                         | Allowed                                       | Forbidden                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Ink (`--text*`, `--decoration-soft`, `--disabled`)                            | Per the SPEC §4.3 role table                  | `--decoration-soft`/`--text-soft` on any text node; darkening the decoration tier to "pass" |
| Clinical state (`--danger*`, `--warning`, `--success`)                        | Source state and sanctioned urgency only      | Decoration, numerals, charts, identity, category colour                                     |
| Category (`--tone-*`)                                                         | Within-surface category chips/pills           | Mode identity; new hues; delete-and-alias                                                   |
| Identity (`--kind-*`)                                                         | Surface-kind identity per SPEC §3             | Varying by clinical state                                                                   |
| Elevation (`--e0…--e4`, `--ring-hairline`, `--shadow-inset`, `--shadow-well`) | One edge owner; ladder per SPEC §4.7          | 1px spread terms; child heavier than parent; v2 redeclaring the bevel                       |
| Stacking (`--z-*`)                                                            | Via `OverlayRoot`/named rungs only            | Any raw `z-` value; new rungs without an `--eN` partner                                     |
| Motion (`--duration-*`, `--ease-*`)                                           | All transitions/animations                    | Hardcoded durations; animating layout properties                                            |
| Density (`--spacing-tap`, `--tap-min`, rows, cells)                           | Utilities from `@theme`; `--tap-min` as alias | Setting the pair independently; reducing any 48px target                                    |
| Space/type/radius                                                             | Semantic tokens in markup                     | Raw scale values or literals in components; `--measure` on non-prose                        |
| Quantity/spine/status-mark                                                    | Their named components only                   | Reuse as generic decoration                                                                 |
| Ward-scoped (`--ward-*`, `--net-*`, `--co-*`)                                 | Inside `src/components/ward-management/**`    | Any use outside that directory; adding a name without a §9 row                              |

## 8 · Naming rules going forward

- No new token without a call site and a usage rule (SPEC §12).
- Roles are named for their job, never their appearance or a place ("well", "bevel",
  "placeholder" — not "grey-2").
- A deprecation ships with an alias, a lint rule, and a named deletion condition.
- The design-sync manifest is generated; a hand-edited token entry anywhere under `_ds/` is a
  defect regardless of its content.

## 9 · Component-scoped families the contract does not govern

One family exists outside the layers above. It is recorded here because an unregistered
token family is indistinguishable from drift, and §8 forbids a token without a usage rule —
so leaving it undocumented made the rule unenforceable rather than satisfied.

| Family                          | Where declared                                                                                                                               | Names | Rule                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------- |
| `--ward-*`, `--net-*`, `--co-*` | `ward-management.module.css`, `ward-management-modes.module.css`, `ward-management-network.module.css`, `coordinator/coordinator.module.css` | 89    | Scoped to `src/components/ward-management/**`. No new name without a row in this table. |

**What it is.** A private spacing, line-height and z-index vocabulary for the ward bed board,
declared three times in near-duplicate across the four stylesheets. Colour is **not** part of
it: every colour property in those files already aliases a real theme token
(`--ward-blue: var(--clinical-accent)`), and the files carry zero hex literals.

**Why it is a documented exception rather than a cleanup.** The ward surfaces are a dense
clinical grid, and `--ward-space-*` is a 1px-granular scale — 8 of its 15 steps sit off the
4px grid in §2. Mapping it onto `--gap-*`/`--pad-*` would reflow the bed board, which is a
visual decision for the owner, not a token migration. Measured 2026-08-21: **307** spacing
references in these files, **0** of them to the real semantic roles.

**Known cost, accepted for now.** These names are invisible to the design-system contract
(no lint rule inspects CSS-module custom-property declarations), so the family can grow
without any gate noticing. The rule in §7 and this table are the only thing holding it.
Two consequences already observed and fixed elsewhere: 44px tap targets survived the repo-wide
44→48 sweep here because they were hand-rolled module heights, and `--ward-z-*` bypasses the
named `--z-*` ladder entirely.

**To retire it**, map the spacing scale onto `--gap-*`/`--pad-*`, route `--ward-z-*` onto local
stacking contexts using the named rungs, and adopt the per-step `--text-*-lh` companions in
place of `--ward-leading-*`. Each is a visual change and wants its own review.
