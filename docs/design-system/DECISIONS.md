# PsychSift design system — DECISIONS

**The six conflicts resolved — what was chosen, what was rejected, and why — plus the
clinical Q&A that shaped the component specs, the assumptions register, and the blocked
list.**

- **Date:** 5 August 2026 · companions: [SPEC.md](SPEC.md) · [TOKENS.md](TOKENS.md) ·
  [COMPONENTS.md](COMPONENTS.md) · [GATES.md](GATES.md)
- **State corrections established while resolving:** the design-system work is **committed**
  as `ef13a072a` on branch `claude/clinical-kb-design-system-333a69` (local-only, base
  `cf7728ca2`) — the briefing's "uncommitted" is stale. The export zip's token file is
  byte-identical to the committed copy **[verified: diff]**. The design side's own
  `ckb-v2-tokens.css` was **not** among the attachments (the zip is the repo-side export the
  audit reviewed: 44px tap, no `--shadow-well`).

---

## C1 · One reconciled token inventory

**Chose.** [TOKENS.md](TOKENS.md) is the single inventory: every role, its winning name, its
owner file, and what it replaces. Divergence outcomes: `--shadow-well` adopted and the v2
`--shadow-inset` overrides removed (bevel semantics restored, with the contract-test inset
pin at `tests/ckb-v2-token-contract.test.ts:164-169` updated in the same commit);
`--quantity-unit-tracking` + `--quantity-unit-gap` win over `--quantity-unit-scale`;
`--spacing-tap` in `@theme` is the only tap knob and `--tap-min` becomes its alias; the
evidence-spine / status-mark / confidence-meter **role families are accepted** but their
names and values land only via the design side's actual file (see Blocked).

**Rejected.** Reconstructing the design-side names from prose descriptions. That is exactly
the restate-values-in-prose failure that produced eleven divergences last cycle — a
reconstructed token is a third source of truth wearing the second's name.

**Why.** The two-sources-of-truth failure restarts whenever both sides can mint names
independently. The inventory kills it by making every role carry one winner and one owner;
anything that cannot be verified is listed as blocked rather than guessed.

---

## C2 · The tap-target knob lands in `@theme`, never in the v2 layer

**Chose.** The 44→48 change is made to `--spacing-tap` in the `@theme` block of
`globals.css` — the token the `min-h-tap` / `h-tap` / `size-tap` utilities compile against.
`--tap-min` in the v2 layer becomes a pure alias (`var(--spacing-tap)`), and the v2 layer
never declares `--spacing-tap`. What moves with it, in the same change: the contract-test
pins, the component comments that still claim 44px, and a dedicated visual-QA pass — it is a
426-call-site geometry change and ships as its own commit (5b). No existing 48px target
(`min-h-12`) is touched.

**Landed (PR 5b).** Two follow-through rules came out of doing it, both now in SPEC §4.10.
A grid track sized to hold a tap-sized child reads `var(--spacing-tap)` instead of copying
its value, or the track and its child desync on the next move — seven hardcoded `2.75rem`
tracks were audited, and the one with no gap between columns (the launcher search row) was
rebound; the other six absorb the extra 4px into an existing gap or the row's own padding.
And the phone composer keeps a written 44px exception below 431px, because its height is
part of the search-chrome contract and 44px already clears WCAG 2.5.5.

**Rejected.** Declaring the value in the v2 layer. In the design side's `:root`-structural
copy it silently **loses** a same-specificity cascade tie to `@theme` (later wins), leaving
the file claiming 48 while the app renders 44 — a wrong number that reads as fixed. In the
repo's class-scoped copy it would instead **win** inside opted-in subtrees, producing a
44/48 split app. Both failure modes are worse than the current honest wrongness.

**Why.** One knob, at the layer that actually generates the utilities. Every other placement
creates a value that is either dead or forked.

---

## C3 · Structural tokens stay class-scoped on `.ckb-v2`

**Chose.** The repo copy's class scoping stands. The design side's §1.1 (":root so they
apply with or without the shell class") is recorded as a defect in its copy — its own §2.3
correctly warns that the same adoption repaints the app, and a reader who stops at §1.1
imports a repaint believing it is an opt-in. Promotion of the structural half to `:root` is
a separate, staged, **app-wide** change at the end of adoption, with its own
visual-regression pass. Blast radius, honestly: ≈663 legacy type call sites, every
`rounded-md` (the radius step differs between layers), and a prose reflow from the
line-height change — per template × theme × density.

**Rejected.** Moving structural to `:root` now. "Design-system-only work with no site-wide
repaint" is the standing scope constraint, not a preference; recommending `:root` would
require asking first, and nothing in the last two cycles produced a reason to spend that
ask.

**Why.** The class scope is what makes every adoption step reversible and diffable one
surface at a time. The cost — carrying the transitional two-layer architecture
(SPEC §4.11) a while longer — is bounded and already documented; an uncommanded repaint is
neither.

**Current status.** Class scoping is still a target-layer contract, not evidence that a product
surface has adopted it. The local adoption manifest records literal root opt-ins; remote design
status remains unverified unless an authorised remote check says otherwise.

---

## C4 · The v2 forced-colours block covers the descendant form

**Chose.** The v2 layer ships its own `@media (forced-colors: active)` block, placed **after
all v2 theme declarations in the same file**, with exactly this selector list:
`.ckb-v2`, `.dark .ckb-v2`, `.ckb-v2.dark`.

**Rejected.** (a) Relying on the global HCM block: it declares on `:root`/`.dark`, so any v2
theme rule that declares the same custom property **on the subtree root itself** starves the
inherited HCM value regardless of file order. (b) A `.ckb-v2`-only v2 block: after the
cascade fix, the dark theme rule `.dark .ckb-v2` is specificity (0,2,0) and beats a
(0,1,0) HCM rule outright — dark-mode high contrast would still lose. (c) The design side's
stated justification ("this layer loads later, so it would silently win"): true in the
design project, **false in the repo**, where the v2 import sits at the top of `globals.css`
and the global HCM blocks sit thousands of lines later. The portable justification is
within-file ordering: the HCM block beats the `.ckb-v2` theme block on the (0,1,0) tie only
because it comes later **in the same file**, and it beats the dark forms only because it
matches them at equal specificity.

**Why.** Custom properties follow the normal cascade; forced-colours support that depends on
import order is one refactor away from silently dying. The selector triple is the smallest
set that wins at every specificity the theme layer can produce. Porting note: the
opt-in-scope contract test accepts only selectors starting `.ckb-v2`
(`ckb-v2-token-contract.test.ts:70`) — `.dark .ckb-v2` requires the filter to learn the
ancestor form in the same commit, both here and in the cascade port (SPEC §4.1).

---

## C5 · Three identity families cover seventeen modes

**Chose.** Three families — `--kind-source`, `--kind-answer`, `--kind-workspace` — with the
mode mapping in SPEC §3. No fourth family. The four hue tones and the two specifier tones
are re-described as what the evidence shows they already are: **category colour within a
surface**, a separate channel that keeps the frozen `--tone-*` tokens and never encodes mode
identity.

**Rejected.** A fourth family (a "reference/framework" kind for dsm · specifiers ·
formulation · therapy-compass was the candidate). Nothing loses its distinction under three:
**[verified:** no mode carries a hue as its identity today — `mode-home-template.tsx`'s tone
map serves pills, and the four hues in live use label Services _pathway categories_
(ATSI / Youth / Telehealth / Free historically on the retired Services home) plus specifier
categories (`specifier-ui.tsx:260-272`), not modes.**]** The kind families answer the safety
question — _is this evidence, machine output, or my workspace?_ — and reference modes are
evidence surfaces (`--kind-source`). A fourth family would re-split the channel the freeze
exists to stabilise, for a distinction no current surface draws.

**Why.** The conflict dissolved once the two channels were separated: "four tones for mode
identity" was a misreading of category colour. Kind identity is the channel that must stay
scarce — three meanings a clinician can learn; a fourth dilutes all three. The per-mode
mapping is **[assumed]** where a mode's kind is judgement (differentials, prescribing →
source), flagged in SPEC §3 and cheap to veto mode-by-mode.

---

## C6 · Publication truth is source-derived; adoption truth is route-complete

**Chose.** The local design-sync registry contains 55 visual exports. Each row is derived from
one real source file and requires an entry export, an exact TypeScript-checker-derived public
`*Props` contract (or an explicit zero-prop root), a reference preview, and a direct publication
test. `OverlayPortal`, `ToastProvider`, `useToast`, `AnswerState`, the answer helpers, and the
announcer APIs are support-only entry exports. The focus-stack internals remain private.

The adoption contract separately declares every production page route and shared surface root
under an explicit surface family and disposition. New undeclared routes fail generation. API and
mockup trees are non-product exclusions; the sole route-only exception is the documented legacy
document-source redirect. All 14 declared clinical surface families now mount `.ckb-v2` (via the
literal `.ckb-v2` on the global `<html>` root, with the declared `v2` shell and the `passed` proof statuses
recorded in `adoption-contract.json` / [ADOPTION.md](ADOPTION.md)). Those statuses are recorded declarations
backed by the evidence paths in `adoption-manifest.json`; this documentation-only change did not re-run the
browser proofs (Not run: no browser or design-system command was executed for this wording).

**Rejected.** (a) A hand-maintained, partial `dtsPropsFor` list: it already drifted from final
`Chip`, `Sheet`, `ConfirmDialog`, and callback contracts. (b) Calling every bundle symbol a visual
component: providers, hooks, state models, and portals need public entry access without fake
preview rows. (c) Treating registration or a product import as v2 style adoption: `AnswerCard` is
a valid local reference with zero product imports, while the app-mounted `OverlayRoot` remains
shared overlay infrastructure. (d) Keeping
`FilterBar` or `DataTable` as future names: `AccessibleTable` is canonical and filter composition
belongs to the owning surface. (e) Leaving `SegmentedControl` or `OverlayRoot` as open
specifications after their source, API, preview, and tests exist.

**Why.** Source-derived publication makes API drift fail deterministically; route-complete
adoption makes an undeclared production surface fail closed. Keeping those claims separate lets
the repository say exactly what is ready locally without implying remote publication or committed
Linux visual baselines before they exist.

---

## C7 · `mode-home-template.tsx` and `search-results-header-band.tsx` stay outside the `PageHeader` vocabulary (18 August 2026, `#222`)

**Chose.** Neither file converges onto `PageHeader`. Both are recorded here as permanently
declined conversions rather than left as an open question for the next reader to re-derive.

- `mode-home-template.tsx`'s `ModeHomeHero` is a centred, `text-center`/`items-center`/
  `justify-center` display hero on the fluid `text-hero` token, and it is the slot the
  in-flow phone composer sits directly beneath (`desktopComposerSlotId` /
  `DesktopComposerPortalSlot` render immediately after it). `PageHeader` is a left-aligned
  title stack. Converting the hero would be a visual redesign across the mode homes
  (originally 13 mode homes; `src/lib/app-modes.ts` now defines 26 app modes) and risks colliding with the "one composer per page" contract in
  `docs/search-chrome-behaviour.md` — out of proportion to a header-vocabulary convergence.
- `search-results-header-band.tsx` is a results spine carrying live status
  (`role="status"`), result counts, and applied-filter chips — not a page-title stack.
  `tests/search-results-header-band.dom.test.tsx` pins its current shape and stays
  unconverted.

**Already converged, separately from this decision.** `ModeHomeStatusNotice` (also in
`mode-home-template.tsx`) delegates to the DS `EmptyState` (PR #1842, ledger `#221`) — that
was always a different conversion from the `PageHeader` question this row asks, and it is
done. `DsmPageHeader`, `InformationPageHeader`, and `InformationPageBreadcrumbs` converged
onto `PageHeader`/`Breadcrumb` in the same wave (PR-J, Builder A). This decision closes only
the two files that wave explicitly declined.

**Rejected.** Converging either file to force header-surface uniformity. Both declines have a
structural reason tied to a different contract (composer placement; results-spine semantics),
not inertia — forcing the conversion would fix a vocabulary inconsistency by breaking a
different, more load-bearing one.

**Why.** `#222` asked for exactly this: a decision on whether either file is in scope at all,
recorded so a later session does not re-derive the same two options. `PageHeader`
vocabulary now permanently excludes these two call sites; a future redesign of mode-home
hero layout or the results spine is a separate, explicitly-scoped change, not a header
convergence.

---

## C8 · One look for both modes (owner design review, 11 October 2026)

**Chose.** After a review of every Work and Clinical screen at 320 px, 390 px, desktop and
dark mode, the owner approved these seven rules for both modes:

1. **One look for both modes.** Clinical keeps its own components and behaviour, including
   the search box at the bottom of the screen and how it works, but shares Work's look: round
   header buttons on a tinted top bar, the tab bar in the same tint, hairline cards, the same
   controls and illustrations, in Clinical blue. No search bar is added at the top.
2. **Calmer bands.** The band and top bar carry no dot texture, and the band's line drawing
   is fainter (0.08 light, 0.11 dark, from 0.11 and 0.14).
3. **Primary buttons take the area colour.** Never black or ink-filled buttons, in either mode. First Nations keeps its own standard (v13.1), which holds its olive to the pill, current tab, icon tiles, day track and quotation accents, so its buttons stay neutral.
4. **Filter chips stay on one line.** They scroll sideways with an edge fade and never wrap to
   leave one chip alone.
5. **Red means overdue, lapsed or urgent only,** in both modes. Priority and category labels
   ("High", "Medium") use neutral tags.
6. **One way back.** If the header shows Back, the page adds no extra "‹ My Day" style link
   under the band.
7. **One card per group,** in both modes: items sit as divided rows in one hairline card, with
   no cards inside cards and no coloured side bars.

**Rejected.** A top search bar or a title band in Clinical mode. The owner asked that the
Clinical search box keep its bottom position and behaviour, and that Clinical keep its own
components; a title band would also have moved the tab bar out of the top bar's collapse
track and changed how it hides on scroll.

**Why.** The two modes read as two different apps (different header, list, card and button
styles). Sharing one visual language while keeping each mode's own controls balances them
without retraining the reader.

---

## C9 · The desktop and tablet shell (usefulness and layout audit, 11 October 2026)

**Chose.** Built on the owner's go-ahead for the 11 October usefulness and layout audit:

1. **Tablet rule.** Page content behaves like a phone at 768 px (an upright tablet: one
   column) and like desktop from 1024 px (a tablet on its side: two columns, a list beside a
   record). The side rail still replaces the menu button from 768 px (owner pick "Burger and
   rail", 7 October), so only the content follows the rule.
2. **One width per kind of page.** Reading pages (lists, forms, settings) keep the 45rem
   column; wide pages (calendars, boards, tables, a list beside a record, the shared page
   shell) take 64rem from 1024 px. The band's title and tabs always take the page's width,
   so the title lines up with the cards. Declared with `data-page-width` (work-mode.css,
   "page widths"); `src/components/work-frame/work-desktop-layout.tsx` gives area pages
   `WorkWidePage`, `WorkSplit` (list beside record) and `WorkColumns` (two or three columns).
3. **Desktop Clinical matches Work.** The Clinical rail shows a name under every icon, in the
   work rail's style and Clinical blue; the mode pill drops its small "Mode" label at every
   width; tablets and desktop show the bell in the Clinical header, as on Work pages. Phones,
   the brand lockup on mode homes and the Clinical search box are unchanged.

**Rejected.** Moving the side rail to 1024 px: it was the owner's own 7 October pick, and an
upright tablet reads well with it.

---

## Q&A record — clinical inputs (31 July 2026)

| #   | Question                                               | Answer                                                  | Design consequence                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | What do you do when an answer cites an overdue source? | **Re-verify and keep using**                            | Stale evidence is a caution, never a gate: answer stays readable, each overdue source named with a one-click open-at-cited-page action; DoseLine overdue mark is also an affordance. (COMPONENTS §2)                                                                         |
| Q2  | How often do answers get printed?                      | **Occasional but real**                                 | Print specified fully; print primitives built in the answer-surface tranche; per-component print proof stays manual, not blocking. (SPEC §4.12, GATES)                                                                                                                       |
| Q3  | Is the bedside phone case real?                        | **Real**                                                | 320px reflow and compact variants are **blocking acceptance** for the eight new components. (SPEC §4.13)                                                                                                                                                                     |
| Q4  | Who else reads a printed answer?                       | **Patient record + other clinicians + patients/carers** | A printout is a standalone clinical document: self-contained printed VerificationNotice, full provenance, printed-by/at, absolute dates, link-back as courtesy only — plus a **plain-language wording variant** for patient/carer-facing prints. (COMPONENTS §1, SPEC §4.12) |

---

## Assumptions register

Assumptions proceed as stated and are flagged inline where used; each is cheap to veto.

1. **Mode → kind mapping** for differentials and prescribing as `--kind-source` (SPEC §3).
2. **"Withheld" excluded** from the missing-value phrases until a redaction path exists
   (SPEC §11, COMPONENTS §3).
3. **No patient-identifying data is entered** anywhere in the product; autocomplete guidance
   therefore covers benign fields only (SPEC §9.7). If this changes, revisit before building
   the surface.
4. **Product-import counts** for `main`-tier shared components are assumed >0 rather than
   enumerated (COMPONENTS §0.1); the adoption tracker owns exact counts.
5. **Forced colours is owned, not best-effort** (SPEC §4.2) — a support decision taken here
   because status encoding is safety information; the cost is the planned gate, and until it
   exists the support claim is an intention.
6. **Document location:** this set lives at `docs/design-system/` and supersedes the four
   prior documents; the export's `DESIGN_GUIDE.md` remains a snapshot artefact, not a spec.

---

## Resolution log — second pass, same day

The five blocked items were actioned on 31 July 2026 with user authorisation ("smallest
logical fix for each; if you can't find [the design-side file], create it"). Three closed,
two reduced to a single named step.

1. **C1 byte-level / the three family names — closed by creation.** Recovery was attempted
   first: `DesignSync` reads of design project `08d6f126-3fd0-4764-aedf-0062a467280a` show
   it was last updated **2026-07-13** and contains none of the 31 July design-side files —
   that `ckb-v2-tokens.css` was never written to the project and is unrecoverable
   **[verified: `list_projects`/`list_files`]**. As authorised, the repo file is now the
   **canonical reconciled copy** (design-branch commit `59e4c3dfc`): `--shadow-well`
   replaces the two `--shadow-inset` overrides (contract test updated in the same commit —
   it now pins `--shadow-well` as a true inset and asserts `--shadow-inset` is not
   redeclared), and the evidence-spine (`--spine-w` / `--spine-current` / `--spine-stale`)
   and status-mark (`--status-mark-size` / `--status-mark-stroke`) families are authored
   repo-side, derived from existing roles. Confidence-meter stays absent — no call site.
   The design side now conforms to this file; there is nothing left to diff.
2. **Manifest regeneration — reduced to one command.** The stale manifest belongs to the
   same 13 July project state. The canonical `ckb-v2-tokens.css` has been written to the
   design project (DesignSync `write_files`, 1 file), and the pane now compiles
   `_ds_manifest.json` from the app's self-check. Remaining step: one full `/design-sync`
   run from an environment with the skill installed, to republish components and clear
   `_ds_needs_recompile`. The manifest itself stays generated-only.
3. **React-shim race — paste-ready patch.** Still applied in the design-side bundle
   generator (outside both repos); `ds-bundle-loader.js` stays the workaround until it
   lands, then both are deleted. Replacement for `shim:react-shim` (adapt to the
   generator's module format):

   ```js
   // shim:react-shim — read window.React lazily so bundle evaluation
   // order cannot race React.
   function getReact() {
     var R = window.React;
     if (!R) {
       throw new Error(
         "ckb-design-system: window.React is unavailable at render time - " +
           "load React before rendering, or keep ds-bundle-loader.js",
       );
     }
     return R;
   }
   function jsx(type, props, key) {
     var rest = Object.assign({}, props);
     var children = rest.children;
     delete rest.children;
     if (key !== undefined) rest.key = key;
     return children === undefined
       ? getReact().createElement(type, rest)
       : Array.isArray(children)
         ? getReact().createElement.apply(null, [type, rest].concat(children))
         : getReact().createElement(type, rest, children);
   }
   module.exports = {
     // React.Fragment IS Symbol.for("react.fragment") — no window read needed.
     Fragment: Symbol.for("react.fragment"),
     jsx: jsx,
     jsxs: jsx,
     jsxDEV: jsx,
   };
   ```

4. **Dark fall-throughs — closed.** `--clinical-chat-document` was a real omission: the
   live `.dark` declaration (`var(--surface-inset)`) is substituted at `<html>` before
   inheritance, so it can never re-resolve against the v2 dark ramp — fixed in
   `59e4c3dfc` by declaring it in the v2 dark block. `--disabled` fall-through is
   **confirmed acceptable**: the live dark value on the v2 dark surface computes ≈3.4:1,
   stronger than the v2 light disabled tier (≈2.5:1 on white)
   **[verified: computed from the declared hexes]**. No change.
5. **Publication — done.** The design branch (through `59e4c3dfc`) and the docs branch
   are pushed to `origin`; the docs branch has an open PR. The design branch is pushed
   **without** a PR: its PR needs the full clinical-governance preflight (it contains
   source-rendering components), which is its own handoff, not a quick fix.

Found while verifying, fixed in the same pass: `answer-card.tsx` used arbitrary
`leading-[var(--leading-prose,1.65)]` — a restated token value that failed the
design-token contract's no-arbitrary-leading rule on the branch tip. Now the named
`leading-prose` step. Both token-contract test files: **47 passed (47)**.

6. **Dark-ink cascade bug — found by adversarial self-review, fixed pre-merge.** The
   cascade port made the light `.ckb-v2` block match inside dark subtrees, silently breaking
   the documented fall-through: `--text`, `--text-heading`, `--disabled`, glows, backdrop and
   the accent-soft trio resolved to their **light** values on the dark ramp. Fixed on the
   PR #1538 head by re-declaring every light-declared colour role in the dark block
   (mirroring the live `.dark` values previously inherited) plus a contract regression: dark
   `--text`/`--text-heading` ≥4.5:1 on the dark surface. New standing rule: a colour role
   added to the light block is added to the dark block in the same commit.
7. **Post-merge hygiene pass (this PR).** PR #1538 merged; single follow-up bundling: the
   stale-state sweep (SHAs now pinned only in this log; all other docs state rolling
   status) · literal `var()` fallback values stripped from the v2 components (the last
   value-restatement channel; the one surviving fallback is role→role,
   `var(--e2, var(--shadow-soft))`, which restates no value) · the contract test parses the
   structural and light blocks separately · HCM `--overlay-backdrop` is transparent, not
   opaque Canvas · the six now-landed paths removed from the docs-link allowlist per their
   own remove-after-merge note. Remaining design-app step unchanged: one real
   `/design-sync` run (guidelines index + `_ds_needs_recompile`).
