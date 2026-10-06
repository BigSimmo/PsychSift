# PsychSift design system — SPEC

**The complete design system: roles, rules, rationale. Never values.** Token values live in
`src/app/ckb-v2-tokens.css` (branch copy) and `src/app/globals.css` (live layer) only — a value
restated in prose here is a defect in this document.

- **Date:** 5 August 2026
- **Applies to:** the v2 layer and components as merged to `main` (PR #1538; canonical
  token file `src/app/ckb-v2-tokens.css`) · design project `08d6f126-3fd0-4764-aedf-0062a467280a`.
  Commit SHAs are pinned only in DECISIONS' resolution log — everywhere else this set
  states rolling status, so the docs cannot silently age against the repo.
- **Replaces:** `01-MASTER-SPEC-AND-HANDOVER.md`, `HANDOVER_TO_CLAUDE_DESIGN.md`,
  `01-DESIGN-SYSTEM-SPEC-CORRECTED.md`, and the export's `DESIGN_GUIDE.md` as spec documents.
  Where any of them disagrees with this set, this set wins; where this set disagrees with the
  ranking below, the higher source wins and the contradiction is a defect **here**.
- **Companions:** [TOKENS.md](TOKENS.md) (reconciled inventory) ·
  [COMPONENTS.md](COMPONENTS.md) (public contracts, remaining specifications, maturity matrix) ·
  [DECISIONS.md](DECISIONS.md) (C1–C5, Q&A record, assumptions, blocked items) ·
  [GATES.md](GATES.md) (every rule paired with its enforcement status) ·
  [ADOPTION.md](ADOPTION.md) (PR 13 registration: order, per-surface allowlists, exclusions, pins)

**Source of truth, ranked.** 1. `AGENTS.md` · 2. `ckb-v2-tokens.css` · 3. committed tests · 4. `.design-sync/conventions.md` · 5. this document set.

**Status keys** used throughout: `main` (in production code) · `registered` (published by the
local source-derived design-sync contract; not a product-adoption claim) · `support-only`
(public entry API with no visual registry row) · `design` (landed only in the claude.ai/design
project) · `spec` (specified, not built) · `planned` (rule stated, gate not built). Claims are
marked **[verified: evidence]** or **[assumed: assumption]** where the distinction is
load-bearing.

---

## 1 · The product truths that generate every rule

1. **Clinical reference prototype, not validated clinical decision support.** Every answer must
   be verifiable against a linked source; failure degrades conservatively, never guesses.
2. **Clinicians read at speed** — ageing ward PCs, sometimes a phone at the bedside
   (confirmed real, not theoretical — see DECISIONS §Q3), sometimes on paper after printing
   (occasional but real; printouts can reach the patient record, other clinicians, and
   patients/carers — DECISIONS §Q2, §Q4).
3. **The dangerous failure is not a crash.** It is a confident-looking answer on a stale
   source, a misread dose, or a table the extractor got wrong. The unhappy path is the safety
   surface; design it first.

---

## 2 · Principles

**2.1 Clinical colour is reserved.** Green, amber and red mean _state of the source_: current,
review due, outdated. Never decoration, never a numeral colour, never a chart palette. If a
screen shows five hues and none means "unsafe", the system has failed.

**2.2 Trust is layout, not a tooltip.** Publisher, version, review date, extraction quality and
approver are content. They get a permanent place.

**2.3 The number is the answer.** Mono, tabular, value weight, the heaviest thing in its block.
The unit is demoted: sans, label weight, never uppercased — `g` ≠ `G`, `mg` ≠ `MG`; a
`text-transform` on a dose changes what the dose says.

**2.4 One edge owner.** A surface has a border **or** a ring, never both. A drop shadow may
accompany either **provided it carries no 1px spread term** — a spread is a border in disguise.
(Mechanically checkable; see GATES §8.)

**2.5 Everything scales, nothing is a literal.** A raw pixel in component markup is a defect.

**Corollary — lead with state, not volume.** "Indexed, not yet validated — 42 chunks", never
"42 chunks embedded and searchable. Validation status: unverified."

**Corollary — the degraded invariants.** _A degraded answer must never wear the confident
answer's treatment, and a partial answer must never render as a whole one._ These generate §10.

---

## 3 · Identity model — three families, three channels (C5 resolved)

Full reasoning in DECISIONS §C5. The resolution:

**Three semantically-named identity families cover the seventeen modes**, because the system has
**three separate colour channels** that must never borrow from each other:

| Channel             | Job                                                                                      | Tokens                                                      |
| ------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Kind identity**   | What am I looking at — evidence, machine output, or my own workspace?                    | `--kind-source` · `--kind-answer` · `--kind-workspace`      |
| **Category colour** | Distinguishing peer categories _within_ one surface (service pathways, specifier groups) | the twelve frozen `--tone-*` (four hues × base/soft/border) |
| **Clinical state**  | Source currency and safety — the reserved channel of §2.1                                | status/danger/warning/success roles                         |

The claim that mode identity needed more than three families conflated the first two channels.
**[verified:** the four hue tones label _categories inside_ modes, not modes — `specifier-ui.tsx`
reuses three of the same four for specifier categories. No mode carries a hue as its identity.**]**

**Mode → kind mapping** (assumed per mode, cheap to veto — DECISIONS §C5 lists the reasoning):

| Kind               | Modes                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `--kind-source`    | documents · factsheets · dictionary · dsm · specifiers · formulation · prescribing · therapy-compass · differentials |
| `--kind-answer`    | answer · calculators (generated or calculated output)                                                                |
| `--kind-workspace` | services · forms · favourites · tools                                                                                |

Rules:

- The twelve `--tone-*` are **frozen, not deleted** — live across 16 call sites, and in dark
  none matches its nearest `--type-*`, so delete-and-alias would silently change four dark
  colours. New category colour needs a role name, not a thirteenth tone.
- Category colour may not borrow clinical-state colour, with **one sanctioned exception**: a
  category that itself denotes urgency (the Services "Crisis" pathway used the danger
  tone on the retired tile home). This mirrors the `ClinicalCallout`
  rule: only contraindication and urgent escalation may use red/amber.
- Kind identity never varies by clinical state; a stale source is still `--kind-source`.

---

## 4 · Foundations

### 4.1 Theme cascade — landed (`main`, PR #1538)

```css
.ckb-v2 {
  /* structural + light */
}
.dark .ckb-v2,
.ckb-v2.dark {
  /* dark overrides */
}
```

**Never reintroduce `:not(.dark)`.** It matches a `.ckb-v2` subtree inside
`<html class="dark">`, so v2 light values override the inherited dark values — v2 dark never
worked outside same-node demos, and every dark capture from before the fix is void.

**[verified:** ported in PR #1538 with the contract test's block parser updated in the same
commit. One consequence the port created and the same PR fixed: the light `.ckb-v2` block now
matches inside dark subtrees, so **every colour role the light block declares must be
re-declared in the dark block** — otherwise it resolves to its light value (the dark-ink bug,
DECISIONS §Resolution log). Ink is contract-enforced at ≥4.5:1 on the dark surface.**]**

Constraints that survive the port:

1. **Stay class-driven.** `@media (prefers-color-scheme: dark)` would break the app —
   `THEME_BOOTSTRAP_SCRIPT` lets a user pin a theme against OS preference via localStorage,
   and a media query ignores the pin.
2. **Assert computed values**, both the ancestor form (`.dark` on `<html>`, `ckb-v2` on a
   descendant) and the same-node form.

### 4.2 Forced colours — the third theme, now owned (C4 resolved)

**Decision: forced colours is a supported theme, not best-effort.** The alternative — declare
best-effort and stop growing the block — was rejected because status encoding in this product
is safety information, and HCM is precisely the mode in which colour encoding dies. The cost
is the gate (GATES §HCM); until it exists the support claim is **[assumed]**, and 408 lines of
forced-colours CSS in `globals.css` remain untested. `StatusMark`'s forced-colour survival is
**asserted, not proven** — treat it as intent.

The v2 layer ships its own `@media (forced-colors: active)` block, and its selector list is
exactly:

```css
@media (forced-colors: active) {
  .ckb-v2,
  .dark .ckb-v2,
  .ckb-v2.dark {
    /* Canvas / CanvasText / LinkText / Highlight; elevation → none */
  }
}
```

Why all three: after the cascade fix, `.dark .ckb-v2` is specificity (0,2,0) and beats any
single-class HCM rule regardless of order; `.ckb-v2` alone ties with the theme block at
(0,1,0) and wins only because the HCM block sits **later in the same file**. That within-file
ordering is the portable justification — the "this layer loads later" argument is true in the
design project and false in the repo, where the v2 import precedes the global HCM block.
Full derivation: DECISIONS §C4.

### 4.3 Colour — light

True-white page, cards and panels. Two non-white surfaces only — `--surface-subtle` (table
headers, zebra) and `--surface-inset` (wells, inputs) — plus `--surface-wash` for quiet strips.

**Ink roles, in full** (the incomplete hierarchy is why the decoration token kept escaping
onto text):

| Role                            | Token                | Rule                                                                                                |
| ------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| Label                           | `--text`             | Sentence case, label weight. Not muted, not 600, not uppercase.                                     |
| Entered value                   | `--text`             |                                                                                                     |
| Hint / caption                  | `--text-muted`       |                                                                                                     |
| Placeholder                     | `--text-placeholder` | Placeholder is still text; it carries the expected format in clinical data entry. Must clear 4.5:1. |
| Decorative glyph, divider, rule | `--decoration-soft`  | **Never a text node.** Measured 3.07:1.                                                             |
| Disabled label                  | `--disabled`         | With an explicit contrast contract.                                                                 |

`--decoration-soft` is the canonical name; `--text-soft` is a deprecated alias to the same
value — the token was misused three times _because_ its name contained "text". The contract
test pins the tier from both sides (below 4.5:1, at or above 3:1) so nobody "fixes" it into a
text tier — **[verified:** `tests/ckb-v2-token-contract.test.ts:138-145`**]**.

**Borders are solid, never alpha.** An alpha border's strength and hue depend on its backdrop,
so the same token inverts between themes — the `--border-lux` failure. Gated:
**[verified:** contract test `:84-93`**]**.

### 4.4 Colour — dark

Four surfaces monotonically lighter as they rise: `--surface-inset` → `--background` →
`--surface` → `--surface-raised` → `--surface-lux`, with `--surface-subtle` aliased **up**
(gated — contract test `:105-128`).

**Elevation inverts: in dark, elevation is luminance, not shadow.** The ladder gains a top
highlight; shadow alone is nearly invisible.

**Never pure black, never pure white** — halation for astigmatic readers, smearing on OLED.
**Desaturate, don't just darken** — a straight lightness flip glows.

**Filled variants use their paired contrast token.** `Button.danger` on `--command-contrast`
measures 2.87:1 in dark; `--danger-solid-contrast` measures 6.57:1 and is already HCM-mapped
to `MarkText`. One wrong token, two defects. (PR 3; gate planned.)

### 4.5 Type

Seven **size** steps; xs–xl are size-only; shared leading is `--leading-prose`. Hero
keeps `--text-hero--line-height` and `--text-hero-tr` only. Do not reintroduce per-step
`-lh` / `-tr` / `--text-{step}--line-height` orphans (gated — contract test `pins shared
leading and hero companions, not per-step orphans`). Negative tracking only from
`--text-body` up; 12px floor. Step roles:
`--text-xs` eyebrows/chips/captions · `--text-sm` metadata/dense cells/hints · `--text-body`
UI body/row titles · `--text-md` **answer prose** · `--text-lg` card and panel titles ·
`--text-xl` page titles · `--text-hero` hero counts.

**Adoption is additive.** `--text-md` is added and applied to the answer surface first. The
full retirement of the fourteen legacy steps touches ≈663 call sites and ships **last of
all** — the most-read text in the product does not ride inside a 663-site codemod.
⚠️ `Quantity` consumes `text-base-minus`, a step scheduled for deletion — fix in the same
tranche that retires the step.

### 4.6 Weight, space, radius

Weight roles: body 400 · label 500 · heading 600 · value 650. **Display type uses the heading
weight; the value weight belongs to quantities.**

_Exception:_ the personal My Day dashboard uses 700 for card titles and 800 for figures
(`font-dash-title`, `font-dash-figure`), inside `.dash-surface` only — owner-approved,
TOKENS §7.2. No clinical surface may use them.

4px base scale; **semantic tokens only in markup** (`--gap-*`, `--pad-*`). **Heading inset
convention:** a panel's first child is its heading and carries no top margin; the panel's
padding provides the space. _A compensating margin is always a symptom of a missing padding
token._

Radius: one step per surface role. The live and v2 control rungs agreed at 10px in PR 5c,
which moved **every** `rounded-md` in the app at once — 243 call sites across 81 files — as
its own commit with its own visual diff, and pinned the two layers to each other so they
cannot drift apart again. The ladder now carries two deliberate half-steps, `sm` at 6px and
`md` at 10px; everything else is on the 4px grid, and a third half-step fails the contract
test. An arbitrary radius literal in markup goes to its **nearest** rung, ties to the smaller
one; the only sanctioned exception is a hairline below the 4px floor, where the nearest rung
would be a visible change rather than a rounding of it.

### 4.7 Elevation, borders, rings

Shadow-only ladder `--e0…--e4`; `--ring-hairline` for borderless floating surfaces.

> One edge owner: border **or** ring. A drop shadow may accompany either provided it carries
> no 1px spread term. Borderless floating surfaces use ring + shadow; in-flow cards use
> border + shadow; inset wells use a border or inset shading, not both.
>
> A card inside a panel never carries a heavier `--eN` than its parent.

The ladder itself is gated against baked-in hairlines (**[verified:** contract test
`:171-179`**]**); the per-surface co-occurrence rule and the spread-term check are **planned**
(GATES §8).

`--shadow-inset` **stays the DS bevel**; `--shadow-well` is the recessed-well role. The
former v2 `--shadow-inset` overrides became `--shadow-well` in `59e4c3dfc`, with the
contract test's pin updated in the same commit (C1, done). Alias cleanup: `--shadow-focus` is deleted (it encodes a
companion focus ring the conventions forbid), `--shadow-lift` retires into the ladder, the
three dead springs go — **retire aliases inside the recipes first**, or "never use an alias"
is unfollowable.

### 4.8 Stacking is elevation

`--z-base`/`--e0` · `--z-raised`/`--e1` · `--z-chrome`/`--e2` · `--z-overlay`/`--e3` ·
`--z-popover`/`--e3` · `--z-modal`/`--e4` · `--z-toast`/`--e4`. Each rung names its elevation
partner; no `z-` value outside the rungs. **Toast sits above modal, deliberately** — an
outcome announcement a dialog can hide is worse than none. `OverlayRoot`
(COMPONENTS §7) is the sole consumer of the overlay rungs.

### 4.9 Motion

Two curves: `--ease-standard` for enter/exit, `--ease-physical` only where a control should
feel physical (toggle thumb, sheet drag). Durations come from `--duration-*` and zero out
under `prefers-reduced-motion` (gated — contract test `:187-192`).

**Durations are decorative until enforced:** one token reference repo-wide against 25
hardcoded durations, and ten sites animate layout properties (`grid-template-*`, `width`,
`height`, `top`, `gap`). All motion is `transform`/`opacity`; `Progress` scales, `LinkAction`
translates its arrow, `ToggleSwitch` translates its knob. Wiring + lint is PR 9 (planned).

### 4.10 Density and tap targets (C2 resolved)

**48px, one knob.** The knob is `--spacing-tap` in the `@theme` block of `globals.css` — it is
what `min-h-tap` / `h-tap` / `size-tap` compile against. `--tap-min` in the v2 layer is a
**pure alias** reading `var(--spacing-tap)`; the two are never set independently.

**The 44→48 change landed in `@theme`, never in the v2 layer** (PR 5b). In the design side's
`:root`-structural copy the v2 declaration silently loses a same-specificity cascade tie to
`@theme`; in the repo's class-scoped copy it would win _inside_ opted-in subtrees and produce
a 44/48 split app. Either failure mode is worse than a single honest value. It moved 426
`*-tap` call sites at once, which is why it shipped as its own commit with its own visual QA
and flipped its pins in the same commit: the `--tap-min` alias and 48px floor assertions in
`tests/ckb-v2-token-contract.test.ts`, the rendered floor in `tests/ui-style-contract.spec.ts`,
and the mode-home hero tile in `tests/ui-tools.spec.ts`. Full reasoning: DECISIONS §C2.

**A grid track that holds a tap-sized child reads the knob, never a copy of its value.** A
literal `2.75rem`/`3rem` track desyncs from its child the next time the knob moves; the
launcher search row is the case where that overlaps rather than merely tightening a gap.

**The phone composer is the one sanctioned exception to the floor.** Below 431px the composer
input and icon/send buttons stay 44px (`globals.css`, `max-width: 430px`): the phone composer
is an edge-to-edge dock whose height is part of the search-chrome contract, and 4px on the
input plus buttons re-tunes the dock reserve and the phone CLS budget for no accessibility
gain — 44px already clears WCAG 2.5.5. Any further exception needs the same kind of written
reason.

Three concepts stay separate: visible glyph size · visible control face · interactive hit
target. Dense clinical UI keeps compact faces with padded or pseudo-element targets, and row
hit-areas may overlap padding where density matters. Static chips are text, not targets —
exempt under WCAG 2.5.8's inline exception. **No production target may be reduced**
(`min-h-12` sites now match the knob rather than exceeding it — leave them; 44px is a known
`ui-smoke` flake).

### 4.11 Transitional architecture (C3 resolved)

**Structural tokens stay class-scoped under `.ckb-v2`.** "No uncommanded site-wide change" is
a constraint, not a preference; the design side's `:root` placement is recorded as a defect in
its copy. Promotion of the structural half to `:root` is a separate, staged, app-wide change
at the **end** of adoption, with its own visual-regression pass (≈663 type call sites, every
`rounded-md`, prose reflow). Full reasoning and blast radius: DECISIONS §C3.

"One value file" is true only _inside the v2 contract_ during the transition:

- `ckb-v2-tokens.css` — authoritative v2 roles and values
- `globals.css` — live v1 compatibility **and** Tailwind utility generation (including the
  tap knob, §4.10)
- aliases — temporary and dated
- completion condition — no semantic difference remains between live and v2 roles on adopted
  surfaces

**Current truth.** The target layer is built and the source mounts it literally on the global
`<html>`, so production surfaces inherit v2. The contract still declares those surfaces as
compatibility until their required proof and committed Linux visual baselines are approved.
`adoption-manifest.json` records observed mounting and declared adoption independently; it is not
an inference from a token file or a remote design-project claim.

### 4.12 Print is a theme

Print forces light tokens **regardless of active theme** · flattens shadows and glass ·
retains semantic borders and status labels · preserves provenance, review date and generated
timestamp · expands print-relevant disclosures · repeats table headers across pages · never
splits a dose line, citation block, warning or heading from its content · includes URLs for
external references · **hides chrome by `[data-print-hide]`, never by element name** · keeps
clinical images pixel-accurate.

**A printed answer is a standalone clinical document.** Confirmed by the author: printouts
can enter the patient record, reach other clinicians (GP letters, registrars, MDT), and reach
patients/carers (DECISIONS §Q4). Therefore, at print time it carries: **source status at
print time** (a printout is a snapshot) · printed-by and printed-at · page _n_ of _m_ · a
link back to the live answer — **as a courtesy, never a dependency**; nothing on paper may
require the link to be interpretable. The printed `VerificationNotice` is self-contained and
never elided. Relative dates never print without their absolute form; review dates print
absolute only (`DateDisplay`, COMPONENTS §8).

**Patient-facing prints (factsheets) additionally use the plain-language variant** of the
verification wording (COMPONENTS §1). Printing is occasional but real (DECISIONS §Q2):
print primitives (`PrintHeader`, `PrintFooter`, `CitationFootnote`, `PrintOnly`,
`ScreenOnly`, `KeepTogether`) are built in the answer-surface tranche; per-component print
proof stays a **manual** check, not a blocking gate.

### 4.13 Responsive contract

No breakpoint tokens — breakpoints are compile-time and structural, so custom properties are
the wrong tool. The system publishes instead: **named layout states** (compact, stacked,
rail, split, wide) · the condition at which each component changes state · minimum viable
widths for title, actions and data columns · 320px and 400%-zoom acceptance · per-component
overflow behaviour. Container queries where the component's own width matters; viewport
breakpoints where the shell changes mode. The shared search chrome keeps its own contract
(`docs/search-chrome-behaviour.md`) — this system defers to it.

**The bedside phone case is real** (DECISIONS §Q3), so **320px reflow and compact variants
are blocking acceptance criteria for the eight new components** — not aspirations.

**Fixed-width tracks are the recurring layout bug** — never a fixed track beside an `auto`
cluster that cannot yield. Wrapping flex with a real basis, or `minmax(16ch, 1fr)`.

**The five named layout states** — every responsive component describes itself in these
terms, never in raw breakpoints:

| State     | Meaning                                                              | Typical trigger                 |
| --------- | -------------------------------------------------------------------- | ------------------------------- |
| `compact` | One column, dense rows, phone dock chrome; actions collapse to menus | narrow viewport (bedside phone) |
| `stacked` | One column, full-width blocks, actions wrap below titles             | narrow container, any viewport  |
| `rail`    | Content plus one narrow supporting rail (nav, filters)               | medium viewport                 |
| `split`   | Two working panes (list + detail, document + answer)                 | wide container                  |
| `wide`    | Split plus persistent supporting chrome                              | desktop ward PC                 |

Rules: a component declares which states it supports and the _container or viewport
condition_ for each transition · titles and data columns publish their minimum viable
widths · overflow behaviour is declared per state, never left to default clipping ·
`compact` is exercised at 320 CSS px and 400% zoom as the blocking acceptance from §1.

---

## 5 · Icons

| Meaning                            | Glyph                    | Never for         |
| ---------------------------------- | ------------------------ | ----------------- |
| Source outdated / withdrawn        | `Ban`                    | Errors, deletion  |
| Needs review / caution             | `TriangleAlert`          | Hard failure      |
| Hard failure / destructive outcome | `AlertCircle`            | Caution           |
| Authority: official                | `Landmark`               | Approval          |
| Authority: trusted                 | `ShieldCheck`            | Validation status |
| Locally approved                   | `Check` / `CheckCircle2` | Authority         |
| Neutral information                | `Info`                   | Warning           |
| Working                            | `Loader2`                | Any static state  |
| Document / source                  | `FileText`               | Generic file      |
| Leaves the app                     | `ExternalLink`           | Download          |
| Produces a file                    | `Download`               | External link     |

`aria-hidden` unless the icon is the only label — and then the control needs `aria-label`.
Size from the `--icon-*` step paired to the adjacent type step. `currentColor` always.
Rotation is direction only.

Missing from the curated export: `ChevronLeft`, `ChevronUp`, `MoreHorizontal`, `Landmark`,
`Minus` (`Check` is present — the earlier claim was wrong). ⚠️ Toast uses `TriangleAlert` for
both warning and danger, contradicting this table — fixed in the Toast rework (PR 10).

---

## 6 · Component contracts — universal rules

**Accessible names are required props, not review items.** The public contracts make invalid
unnamed states unrepresentable for `ToggleSwitch`, removable `Chip`, `Sheet`,
`SegmentedControl`, and modal `OverlayPortal`.

**No enabled control without an action or destination.** Discriminated unions make the invalid
state unrepresentable (`Citation`, `Chip`, `ToggleSwitch`, `RadioGroup` — PR 4). This is the
design-system face of the repo's button-wiring rule.

**Props typed to the real contract.** Published `.d.ts` declarations are deterministically
generated from the real exported `*Props` types and checked for exact parity (PR 12). Callback
types keep their event signatures; zero-prop roots are recorded explicitly.

**`className` is not a reliable override.** `cn()` joins strings; it does not resolve
conflicting Tailwind utilities. **For a clinical system, explicit props beat unrestricted
class replacement** — expose deliberate size and slot props; adopt `tailwind-merge` only if
override semantics are genuinely required.

**`testId` is not a quality proxy.** Prefer role and accessible-name queries; `data-slot`
where styling or integration needs a hook; `data-testid` only where semantics cannot identify
the element. Every component takes `className`.

**Forward refs** through Button, IconButton, TextField, SearchField, Select, links,
pagination. **Remove unnecessary client boundaries** — most component files are
`"use client"` without a hook.

**The disabled encoding is the `controlBase` recipe, not opacity.** The ten design-system
`disabled:opacity*` recipes across `ui-primitives.tsx`, `tabs.tsx`, and `pagination.tsx`
were retired in PR 3 / PR-A (`disabled-encoding.contract.test.ts`).

Per-component defect inventory and dispositions: COMPONENTS.md §Maturity and §Existing-defects.

---

## 7 · Patterns

**Answer surface.** `AnswerCard` raised, lux edge, panel padding, `--radius-xl`, `--e2`;
prose at `--text-md` / `--leading-prose` / `--measure`. Never `bg-transparent`. `AnswerCard`
**requires** an `AnswerState` and a `VerificationNotice` — a call site cannot construct a
confident-looking answer without declaring its state (type-level, PR 6).

**`DoseLine` — ledger form.** One bordered card, hairline separators, drug and qualifier
left, dose right-aligned in a fixed column so numerals stack, per-row rule turning amber when
the cited source is overdue. Left padding derives from the card padding plus the rule width
(tokens, not literals). **The amber rule is not sufficient** — every overdue row also carries
visible text and a non-colour mark, linked to the source (Q1: the clinician's next act is
re-verification, so the mark is also an affordance — one click opens the source at the cited
page). `DoseLine` **composes `Quantity`**; it never reimplements the numeral/unit typography.

**Quantity.** Numeral mono, tabular, value weight. Unit sans, label weight, one type step
down, **never uppercased**. Unit size comes from the type scale, not a bespoke scale factor
(TOKENS §Quantity).

**Evidence gutter.** One fixed `--gutter-col` owning both connector line and dot on one axis;
segments bleed past row padding so the line is continuous and stops at the first and last dot
centres; bleed derived from the row padding token. **One evidence channel per surface.**

**Status vocabulary** — one phrase per state, everywhere. The field is
`clinical_validation_status`, not `validation_status`:

| Enum               | The only label        | Not                        |
| ------------------ | --------------------- | -------------------------- |
| `current`          | Current               | In date, Active, Valid     |
| `review_due`       | Review due            | Overdue, Needs review      |
| `outdated`         | Outdated              | Superseded, Expired, Stale |
| `unknown`          | Unclassified          | Unknown, Untagged          |
| `unverified`       | Not locally validated | Unverified, Unvalidated    |
| `locally_reviewed` | Locally reviewed      | Reviewed                   |
| `approved`         | Approved              | Validated, Signed off      |
| `partial`          | Partial extraction    | Low confidence, Degraded   |

Off-vocabulary values degrade to the neutral triad, log once, never throw
(**[verified:** gated — `tests/source-badges-off-vocab.dom.test.tsx`**]**). **The three axes
are independent** — official does not imply current; current does not imply approved;
approved does not imply good extraction.

---

## 8 · Dark mode documents

The app renders PDF pages and source images with no `filter`, `invert` or `color-scheme`
handling. Policy:

- ❌ **Invert. Never** — it inverts clinical diagrams, flowcharts and stained images,
  changing what a figure appears to show.
- ❌ Leave white on dark (current behaviour) — a glare bomb on the most-viewed surface.
- ✅ **Frame and grade the surround, not the content.** Pixel-faithful page, hairline frame on
  `--surface-raised`, graded shell luminance so the transition is not a cliff. **No scrim by
  default** — even a translucent one changes pixel values. Any viewing aid is user-controlled,
  off by default, never during print or export, never on a zoomed figure.

`DocumentFrame` (COMPONENTS §6) owns this contract.

---

## 9 · Accessibility

**9.1 Route focus.** Next's App Router does not move focus on client navigation and nothing
compensates — this affects every navigation in a 13-mode app. Preserve focus where navigation
is inside an overlay or controlled workflow; otherwise move focus to the new `<h1>` or main
landmark with `tabIndex={-1}` and announce the title once. Owned by `RouteAnnouncer`
(COMPONENTS §5).

**9.2 Live regions are never visible content.** The shipped counterexample — a visible
low-contrast `<p>` with `aria-live="polite"` in `document-search-results.tsx` — is two
defects in one node. Compliant visible count **plus** a separate visually-hidden announcer.

**9.3 Streaming answers settle-then-announce.** Stream renders with `aria-live="off"`;
announce once on completion — "Answer ready, 4 sources."

**9.4 Zoom and reflow.** 320 CSS px; 400% at 1280px; no page-level horizontal scroll; no
title or content column collapsing to zero; controls reachable; sticky elements not covering
focused content; dialog content scrollable; footer/composer reserve not doubled.

**9.5 Reduced motion removes spatial movement, not state signalling.** Cross-fade instead of
slide; static progress instead of shimmer; keep a brief non-spatial change for toast
appearance; stop spinners where a text label already conveys work.

**9.6 Error identification.** `aria-invalid`, merged `aria-describedby`, message in
`role="alert"`, never colour alone. Owned by the `FormField` family (COMPONENTS §4).

**9.7 Autocomplete tokens** on fields collecting known data types.
**[assumed:** no patient-identifying data is entered anywhere in the product; autocomplete
guidance therefore applies to benign fields only (e.g. sign-in email). If a future surface
collects person data, this section must be revisited first.**]**

**9.8 Landmarks and heading order.** One `<h1>` per page, owned by `PageHeader`. `Disclosure`
accepts a heading level rather than hardcoding `<h3>`.

---

## 10 · Degraded states — component level

The principle-level answer (three states, two invariants) is settled. This section is the
component-level specification; prop-level contracts live in COMPONENTS §1–§2.

**The clinician's confirmed behaviour on staleness is re-verify and keep using** (DECISIONS
§Q1) — so stale states are **cautions with a re-verification affordance**, never gates that
hide the answer.

| State                                    | `AnswerState.kind`                   | Treatment                                                                                                                                                                                                                                                                     | Copy rule                                                               |
| ---------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Confident answer                         | `ready`                              | Full `AnswerCard` treatment                                                                                                                                                                                                                                                   | Verification notice still present — "ready" is not "verified"           |
| Stale evidence (≥1 cited source overdue) | `stale_evidence`                     | Structure kept · spine amber · `RetrievalStateBanner` above the prose · dose values demoted to label weight with **the unit unchanged** · every affected `DoseLine` carries visible text + non-colour mark + open-source-at-page action · Export becomes "Export with caveat" | Name each overdue source and its review date                            |
| Partial retrieval                        | `partial_retrieval`                  | `RetrievalStateBanner` names the gap above the answer; missing sources listed as unavailable rows — **never silently omitted**                                                                                                                                                | "2 of 5 sources unavailable", then the list                             |
| Every cited source overdue               | `stale_evidence` (all rows affected) | As stale, plus the banner states totality                                                                                                                                                                                                                                     | "Every source for this answer is past its review date."                 |
| Generation failed → source-only          | `source_only`                        | Visible, not silent — correct behaviour that must _say_ it is a fallback                                                                                                                                                                                                      | Names the fallback; never apologises into vagueness                     |
| Offline / no confident answer            | `no_answer`                          | **No answer card renders.** `EmptyState` with last sync, cached sources, "search cached sources" action. Neutral, not amber                                                                                                                                                   | Say what is unavailable and what still works                            |
| Retrieval empty                          | _(not an answer state)_              | `EmptyState` + action                                                                                                                                                                                                                                                         | Never "no results" bare — say what was searched; offer narrower/broader |
| Extraction failed                        | _(table-level)_                      | `AccessibleTable` unverified treatment (`main`, shipped)                                                                                                                                                                                                                      | —                                                                       |
| Search failed                            | _(not an answer state)_              | `ErrorState`                                                                                                                                                                                                                                                                  | **Never "0 matches" after a failed request**                            |
| Auth expired mid-session                 | —                                    | `Sheet` preset, non-dismissible                                                                                                                                                                                                                                               | Preserve the in-flight query                                            |
| Permission denied                        | —                                    | `PermissionDeniedState`                                                                                                                                                                                                                                                       | Name the missing access                                                 |
| Quota / provider down                    | —                                    | `UnavailableState`                                                                                                                                                                                                                                                            | Name the capability lost, not the vendor                                |

**Invariants.** A spinner is never a terminal state. **Copying or exporting a degraded answer
puts the caveat in the clipboard/file** — via `clipboardProvenanceLine()` in
`src/lib/source-metadata.ts`, which exists for exactly this audit purpose; no parallel path.
A partial answer never renders as a whole one; a degraded answer never wears the confident
treatment (type-level: `AnswerCard` requires `AnswerState`; `no_answer` is unrepresentable in
`AnswerCard` props).

---

## 11 · Content design

**Numbers.** Tabular wherever a number can change or align. Ranges use an unspaced en dash.
**Never a bare decimal without a leading zero** — a dropped leading zero is a documented
ten-fold dosing error.

**Dates.** Machine ISO; display `en-AU`, `Australia/Perth`, via `DateDisplay` only. Relative
only beside the absolute. Review and expiry dates always absolute. Unknown stated explicitly.
**Do not replace internal ISO comparison logic with a display locale** (`perthCalendarDate()`
uses `en-CA` deliberately as a machine key).

**Capitalisation.** Sentence case everywhere. Uppercase only for `eyebrowText`. Never a unit,
identifier or drug name.

**Buttons.** Verb-first and specific. Never "OK", never bare "Confirm".

**Errors, three parts:** what happened · what that means · what action is available. _"Search
could not be completed. No result count is available. Retry or browse indexed sources."_

**Missing values — six phrases, never a bare dash:** `Not recorded` · `Not applicable` ·
`Unknown` · `Unable to extract` · `Not yet calculated` · `Withheld until complete`. A dash
cannot distinguish them, and in clinical data reads as a negative result. Owned by
`MissingValue` (COMPONENTS §3).

The first four describe a **record**. The last two describe a value that is absent only for
now, and they were added (owner decision, 29 Aug 2026) because both situations occur in this
codebase and forcing either into one of the first four asserts something false:

- `Not yet calculated` — the value is derived and the user has not finished supplying what it
  is derived from, so it does not exist yet. It makes no claim about the record, and is an
  instruction as much as a statement. **Never** where the input is complete: an absent value
  after complete input is one of the first four.
- `Withheld until complete` — the surface **can** produce a value from what has been entered
  and is deliberately not publishing it, because a partial reading would be clinically
  misleading (the worked case is a half-ticked checkbox-only screen that must never read
  "negative"). The release condition is inside the phrase deliberately: a clinician told only
  that a value is "withheld" goes hunting for it, so the phrase must say how to get it.

**[assumed:** "Withheld" as a general redaction phrase is still excluded — single-user product
with no redaction pipeline. `Withheld until complete` is suppression pending completion, which
is a different thing; add a redaction phrase only when a redaction path exists.**]**

**Truncation.** Acceptable for secondary metadata in dense rows. **Not** for page titles,
dialog titles, drug names, source review warnings, or a current breadcrumb with no other
full-name path. Every truncating component needs a full-value path.

**Clinical versus operational severity.** Distinct vocabularies for clinical hazard · source
currency · extraction confidence · system failure · permission · workflow state. A red
provider outage and a red contraindication look alike and mean radically different things.

**The AI verification disclaimer is a required prop, and the system owns the wording**
(`VerificationNotice`, COMPONENTS §1) — including the plain-language variant for
patient-facing prints.

---

## 12 · Governance

One value file per layer, versioned; this document names roles, never values. No new token
without a call site and a usage rule. Deprecation has a window, an alias, a lint rule and a
named deletion date. The design-sync manifest is generated, never hand-edited — **don't
hand-edit anything under `_ds/`**. Every prohibition in this system cites its gate in
GATES.md or is explicitly labelled unenforced there.

**Why the gates exist:** three defects in the last cycle were caught by review rather than
CI, two of them by the second reader. Review does not scale past two careful readers.

**Main is gated; an unverified merge is a defect.** The `369c01f86` sentry chain reached
`main` without CI and left the tip unable to parse — repaired forward, but the rule it
proves is structural: nothing lands on `main` outside a PR with the required checks green,
including "chore" and tooling merges. A bot- or agent-authored fix claim is unverified
until the actual ref content is inspected.

---

## 13 · Migration and adoption playbook

The staged plan the rules above assume. **No PR mixes correctness, values, architecture
and adoption.** Status keys as in the header; "done" entries cite their commit.

### Phase 1 — correctness

| PR                             | Contents                                                                                                                                                                                                                                      | Status                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| PR 0 · Truth correction        | Retractions, gate labelling, accurate packaging contract — zero code change                                                                                                                                                                   | **done** — this document set                                                                               |
| PR 1 · Theme cascade           | Port `.ckb-v2` / `.dark .ckb-v2, .ckb-v2.dark`; update the contract test's selector filter and block names in the same commit; computed-style tests, ancestor **and** same-node                                                               | **done** — landed #1538 (cascade port + contract parser + dark-ink regression)                             |
| PR 2 · Forced colours          | v2 HCM block over the three selectors (§4.2); computed assertions: filled command, filled danger, status marks, disabled, focus, flattened elevation                                                                                          | **done** — HCM remaps + Chromium computed suite + token-contract source pins                               |
| PR 3 · Contrast and text roles | `--danger-solid-contrast` on danger · eyebrows and placeholders off the decoration tier · `--text-placeholder` role · finish the disabled encoding across the 10 remaining `disabled:opacity` sites · extend the contrast gate to live tokens | **done** — `--text-placeholder`, eyebrow/placeholder off decoration, 10 opacities retired, Gate 1 extended |
| PR 4 · Interaction contracts   | Discriminated unions for `Citation`, `Chip`, `ToggleSwitch`; `RadioGroup` controlled-or-uncontrolled; `AsyncButton` `type="button"` or retirement                                                                                             | **done** — Citation/Chip/ToggleSwitch/RadioGroup unions; AsyncButton `type` after spread                   |

### Phase 2 — values, split three ways

| PR                                | Contents                                                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 5a · Token values, no geometry | Colour, elevation, ink roles                                                                                  | **done** — `59e4c3dfc` landed the `--shadow-well` rename, the spine and status-mark families, and the dark `--clinical-chat-document` fix; the remaining ink-role deltas landed with PR 3 (`--text-placeholder`, eyebrows and placeholders off the decoration tier, the disabled encoding). The v2 light and dark blocks now declare the same colour roles. The two `#0f766e` accent defaults are scoped `RAW_COLOR_EXEMPTIONS`, so `rawColorLiterals` is **0** — they are data, not design tokens; see the note below |
| PR 5b · Tap 44→48 in `@theme`     | The 426-site tap-call-site migration; contract-test pin update; visual QA pass; `--tap-min` becomes the alias | **done** — `--spacing-tap: 3rem` in `@theme`; `--tap-min` reduced to `var(--spacing-tap)`; 426 `*-tap` call sites moved; three pins flipped in the same commit; the phone composer keeps a written 44px exception below 431px (§4.10)                                                                                                                                                                                                                                                                                  |
| PR 5c · Radius step               | Every `rounded-md` moves; its own visual diff                                                                 | **done** — live `@theme --radius-md` 8px → 10px, matching the v2 control rung and moving 243 `rounded-md` call sites; the 4px-grid pin now names both half-steps and asserts the two layers agree; 14 arbitrary radius literals absorbed onto the ladder (§4.6)                                                                                                                                                                                                                                                        |

**`#0f766e` is data, not a token.** The two `#0f766e` accent defaults
(`src/lib/medications.ts`, `src/lib/medication-records.ts`) restate a Postgres column
default (`accent text not null default '#0f766e'`) for a per-record, user-chosen accent
colour. Changing the application default without migrating the database default would
diverge the two, so both stay. They are a **scoped** `RAW_COLOR_EXEMPTIONS` entry, not
remaining debt: `scripts/design-system-contract-baseline.json` pins `rawColorLiterals`
at **0**. The ratchet is a **ceiling, not a target**: it exists to stop new literals
appearing, and a value that is persisted data rather than design intent is outside the
token system entirely.

### Phase 3 — safety structure

| PR                                   | Contents                                                                                                                                                                                                                                                                                       | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 6 · Answer safety                 | `VerificationNotice` (system wording, plain-language print variant) · `AnswerState` required on `AnswerCard` · `DoseLine` overdue text + mark + open action, composed through `Quantity` · `MissingValue` · `DateDisplay` in `AnswerFooter` · clipboard caveat via `clipboardProvenanceLine()` | **done and locally registered.** `AnswerCard` requires `state` **and** `verification`; a degraded state cannot be constructed without `onOpenSource`. `DoseLine` takes a structured dose model, composes `Quantity`, and carries the governance enum (`status`, **required**) rather than an optional boolean, so a row cannot render clean by omission and `outdated` cannot collapse into `review_due`; overdue is marked in three channels (amber rule + words + shape-differentiated `StatusMark`) and an overdue row must carry its `source`. `answerStateFromRetrieval()` counts and keys by **document**, not chunk. `AnswerFooter` takes ISO in and renders `DateDisplay`/`MissingValue` — the old "drop unknown segments" behaviour is reversed, because on a provenance strip the absence **is** the signal. `answerClipboardText()` carries unconditional attribution + verify instruction, the degraded caveat, the enumerated sources, and provenance through `clipboardProvenanceLine()` — see the clinical-review note below for what it is still not |
| PR 7 · Form foundation               | `FormField` family; merged `describedBy`; hint **and** error in the DOM; required/optional/autocomplete; refs                                                                                                                                                                                  | **done and locally registered.** Hint and error are both in the DOM and both in `describedBy` when invalid; caller ids merge ahead of them; external ids supported; required/optional is label text, never colour; `ErrorSummary` takes focus rather than announcing. `TextField`/`SearchField`/`Select`/choice controls fold onto the shell during product adoption, not publication                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PR 8 · Announcements and route focus | `RouteAnnouncer` + `LiveAnnouncer`; focus to `<h1>`; settle-then-announce; fix the visible live region                                                                                                                                                                                         | **done and locally published as support APIs.** Singleton `announce()` with a dedupe window and a queue gap; two visually-hidden regions; route change moves focus to the new `<h1>` unless focus sits inside a dialog or a `data-preserve-focus` workflow, and announces the page title once. Retiring existing visible `aria-live` nodes remains product-adoption work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**PR 6 step-0 contract pre-check (recorded).** Four of the five `AnswerState`
variants project cleanly from the payload the app layer already receives, with no
change to `src/lib/rag/**` or `src/lib/source-review.ts`: `ready` from the source
count, `stale_evidence` from each source's server-set `document_status`
(`review_due`/`outdated`) plus its `review_date`, `source_only` from
`answerQualityTier` plus `fallbackReason`, and — added in PR 13 Phase 1 —
`ungrounded` from `grounded`, `confidence` and `unverifiedNumericTokens`, which
the payload already carries (blocker 2 below). **`partial_retrieval` has no
producer** — nothing app-facing names which expected sources were unavailable
(`retrievalDiagnostics` carries candidate counts, `conflictsOrGaps` carries
prose). The component is built to its specified contract, but PR 13 can only emit
the other three states until a separate RAG contract PR adds a named
missing-source signal. `tests/answer-state-contract.test.ts` is the standing
proof and pins the gap so it cannot be papered over in the component layer.

**PR 6 clinical review — carried forward into PR 13 (recorded).** The clinical
governance review of PR 6 raised no P0 and cleared the branch on the strength of
its zero product imports. Eight findings were fixed in PR 6 itself; three
constraints below are **adoption blockers**, recorded here so PR 13 cannot read
"PR 6 merged" as clearance for them.

1. **`answerClipboardText()` is not a replacement for `renderModel.copyText`.**
   It was strengthened in PR 6 beyond this document's original slice-8 scope —
   attribution and "Verify against the linked source documents before clinical
   use." are now unconditional (including on `ready`), the cited documents are
   enumerated, and the single-document provenance line is suppressed on a
   multi-source stale answer where it would contradict the caveat. That closes
   the "AI prose pasted into a record with no attribution" hazard. It is still
   **narrower** than `formatAnswerRenderCopyText()`
   (`src/lib/answer-render-policy.ts`), which additionally carries the render
   policy's own warnings. **PR 13 must not swap `formatAnswerRenderCopyText` out
   for `answerClipboardText`**; either compose the two or extend this one first,
   with the clinical owner's review.

   **RESOLVED in PR 13 Phase 1 (ledger `#208`) — compose, do not replace.**
   `formatAnswerRenderCopyText()` / `buildAnswerRenderModel().copyText` stays the
   **primary** product clipboard payload; `src/lib/answer-clipboard.ts`
   (`composeAnswerClipboardText`) wraps it with the three things it lacks —
   unconditional attribution, the `AnswerState` caveat (including `ungrounded`
   from blocker 2), and the single-document provenance line under the
   multi-source-stale suppression rule. The render string passes through
   byte-for-byte: warnings, render trust, numbered sources with match strength,
   clinical tables and displayed table evidence are the render policy's to decide,
   and the composer neither edits nor re-derives them. Attribution and the caveat
   sit **above** the render block, because a truncated or quoted paste keeps its
   head more reliably than its tail. `answerClipboardText()` remains the
   design-system primitive for `AnswerCard` demos and unit contracts, and now
   shares one implementation of each rule with the composer rather than carrying a
   second copy. Rejected: switching product `onCopy` to `answerClipboardText`
   alone; maintaining two divergent product copy paths.
   `tests/answer-clipboard-composition.test.ts` pins pass-through, every warning,
   caveat placement, suppression, and the shared-rule identity. Adoption wires the
   answer surface's `onCopy` to the composer when that surface is adopted
   (controller-owned, last); the clinical owner confirms the composed payload
   reads correctly in an EMR paste at the PR 13 glance.

2. **`AnswerState` has no channel for an ungrounded answer.** `RagAnswer` carries
   `grounded`, `confidence: "unsupported"` and `unverifiedNumericTokens`, and the
   live product already gates on them (`evidence-panels.tsx`,
   `answer-thread-turn.tsx`) to show "Review source match". The projection maps a
   `grounded: false` answer over current sources to `ready`, so adopting it as-is
   would silently retire a warning the product shows today.
   **Must be fixed before PR 13 adopts the answer surface** — it needs a fifth
   state or a companion flag, and the wording is a clinical-owner decision.

   **RESOLVED in PR 13 Phase 1 (ledger `#207`).** A fifth kind, not a companion
   flag: `{ kind: "ungrounded"; reason: UngroundedReason; sourceCount }`, where
   `UngroundedReason` is `grounded_false | confidence_unsupported |
unverified_numeric | weak_evidence`. A companion flag on `ready` was rejected —
   it keeps the "ready" vocabulary for an answer that is not, and is missable in
   `AnswerCard`'s exhaustiveness, which is the whole point of the union.
   `AnswerStateInput` gains optional `grounded`, `confidence`,
   `unverifiedNumericTokens` and a caller-derived `weakEvidence`, still
   structurally typed — the design-system bundle does not import `RagAnswer`.
   Precedence: `stale_evidence` > `partial_retrieval` > **`ungrounded`** >
   `source_only` > `ready`. Ungrounded outranks source-only because a source-only
   answer that is also unsupported must not read as "evidence complete, synthesis
   weak"; `stale_evidence` stays the outer kind on an answer that is both, so one
   answer never stacks two alarms. Absent grounding fields are **not** ungrounding,
   so a caller that has not been widened yet does not acquire a caution on every
   answer. `VerificationNotice` gains an approved `ungrounded` wording in both
   audiences and joins the caution role; `RetrievalStateBanner` renders one
   headline per reason under the group label "Source match status";
   `answerClipboardText()` carries a per-reason caveat, because the banner does not
   travel with a paste. Wording in both surfaces remains open to the clinical
   owner's revision at the PR 13 glance — the channel, precedence and test pins do
   not. Pinned by `tests/answer-state-contract.test.ts` (projection, precedence,
   the `RagAnswer` assignability proof extended to the three grounding fields) and
   `tests/ui-v2-answer-safety.dom.test.tsx` (five distinct wordings, caution role,
   degraded card, per-reason clipboard caveats).

3. **`--warning` as body-text colour** on `VerificationNotice`'s caution variant
   and `DoseLine`'s overdue label is the only place a status hue is used at text
   tier rather than a `--text-*` token. Gate 1 must add that contrast pair
   explicitly rather than assuming the text tiers cover it.

Also noted, not blocking: the logged-once `Set`s in `missing-value`,
`date-display`, `verification-notice`, `answer-state` and `retrieval-state-banner`
are module-level, so on the server they are per-process and unbounded — a
persistent data defect logs once at boot and is then swallowed. Registration does not
close this runtime concern; revisit before adoption puts them on a hot path.

### Phase 4 — architecture, then adoption

| PR                             | Contents                                                                                                                                                                                                                                 | Status                                                                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 9 · Motion, stacking, edges | Wire `--duration-*`/`--ease-*`/`--z-*` to utilities + lint; `transform` for `Progress`, `LinkAction`, `ToggleSwitch`; edge-rule gate; `Quantity` off the retiring type step; delete `--shadow-focus`, `--shadow-lift`, dead springs      | open                                                                                                                                           |
| PR 10 · Overlays               | One `OverlayRoot`; mandatory `Sheet` name; portal by default; `Tooltip` composes child handlers; `Toast` splits tone/priority/persistence, pauses on hover and focus                                                                     | **done** — component/publication contract and app-root mount; v2 style activation is unchanged                                                 |
| PR 11 · Print and documents    | Print as a tokenised theme; `[data-print-hide]`; print primitives; `DocumentFrame`                                                                                                                                                       | open — COMPONENTS §6                                                                                                                           |
| PR 12 · Design-sync integrity  | Declarations generated from real types; manifest parity; direct tests for every registered component; preview state matrices; `tailwind-merge` or slot props; split `ui-primitives.tsx`                                                  | **publication slice done** — deterministic props, parity, previews and direct contract proof; override policy and module split remain deferred |
| PR 13 · Register, then adopt   | Register only after Phases 1–3 are green. Adopt one surface at a time behind `.ckb-v2`, visual diff each: isolated form → page header and actions → source-provenance block → **answer surface last**. Type-scale retirement last of all | **registration done locally; adoption remains compatibility-only** — see [ADOPTION.md](ADOPTION.md)                                            |

**Adoption invariants.** Every step reversible and diffable per surface · no adoption
before the cascade port (dark evidence is void until then) · the most-read text ships
outside any mass codemod · a surface adopts whole, never half a component.

---

## 14 · Authoring rules — definition of done

A new or reworked component is **built** only when all of these hold, and **registered**
only when the starred items are proven, not asserted:

1. **Contract typed to reality.** Accessible name required where operable; modes as
   discriminated unions so an inert-enabled or unnamed control is unrepresentable;
   callbacks keep their event signatures.
2. **Tokens only.** No raw colour, size, radius, duration, z, or line-height literal; every
   token consumed has a usage rule in TOKENS.md.
3. **States complete.** default · hover · active · focus-visible · disabled (encoded via
   `controlBase`, never opacity) · busy · invalid · long-content · `compact`/320px ·
   dark ★ · forced colours ★ · reduced motion · print (or an explicit "print n/a" with
   the reason).
4. **Keyboard and screen reader declared** — focus order, activation keys, announced name
   and role, live-region policy (via `LiveAnnouncer` only).
5. **Direct publication test** ★ proves source mapping, entry export, exact source-derived
   props, and a valid preview before local registration. Direct behavioural and visual proofs
   remain required before the relevant product-adoption claim.
6. **Documentation row** in the generated COMPONENTS §0 snapshot with honest proof columns,
   plus a contract block (COMPONENTS §9) naming its rules and open defects.
7. **Boundaries justified.** `"use client"` only with a hook or browser API; refs
   forwarded on focusable primitives; `className` accepted; `data-slot` over `testId`.
8. **No new dependency, portal, or z value** — overlays ride `OverlayRoot`; stacking uses
   the named rungs.

Failing the publication star keeps a component out of the local design-sync registry. Failing a
runtime, visual, theme, compact, or print proof blocks the corresponding adoption claim without
erasing an otherwise valid source/API/preview publication record.
