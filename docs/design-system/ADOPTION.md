# Clinical KB design system — ADOPTION

**The committed ownership and disposition contract for every production surface.** The source
of truth is `adoption-contract.json`; the generated manifest and marked tables in this document
must match it exactly.

- **Date:** 12 August 2026
- **Current state:** 54 visual references are locally registered; all 51 production page routes
  are owned across 14 surface families, with 59 route/component roots scanned; every declared
  root uses the v2 shell and has declared proof with no committed visual baseline.
- **Phase 1 blockers resolved first, in their own commits:** `#207` ungrounded `AnswerState`,
  `#208` clipboard composition. See [SPEC.md](SPEC.md) §13 PR 6 clinical review, blockers 1–2.
- **Companions:** [SPEC.md](SPEC.md) · [COMPONENTS.md](COMPONENTS.md) ·
  [DECISIONS.md](DECISIONS.md) · [GATES.md](GATES.md) · [TOKENS.md](TOKENS.md)

**Local registration means** a visual component has a source map, entry export, deterministic
source-derived props, preview, and direct publication contract. It is not a claim of remote
design-project publication, product readiness, root v2 activation, or visual/browser acceptance.
Support-only APIs are listed in COMPONENTS §0.2 and intentionally have no visual registry row.

---

## 1 · Historical migration order

The original adoption playbook used six work lanes, in this order, one commit each, each commit carrying **its own test-pin flips**
so a surface stays a single revert unit:

| #   | Surface           | Owner                     |
| --- | ----------------- | ------------------------- |
| 1   | forms             | Builder A                 |
| 2   | headers           | Builder A                 |
| 3   | catalogues        | Builder B                 |
| 4   | docs              | Builder B                 |
| 5   | source provenance | **controller only**       |
| 6   | answer            | **controller only, last** |

SPEC §13 names the shorter list — isolated form → page header and actions → source-provenance
→ answer last. The six-surface list is a deliberate expansion of it, not a contradiction:
catalogues and docs are separated out because they own distinct route families and distinct
pins. Provenance before answer, and answer last, are unchanged from SPEC.

**Provenance and answer are never delegated.** Source rendering and answer output are both on
the repo's clinical-risk list, and the answer surface is the reason this wave is pinned to the
top model at all.

---

## 2 · Historical migration allowlists

A builder may edit **only** the files listed for its surfaces, plus the test files named in
that surface's pin set. Everything else — including a file another surface owns — is out of
bounds. Ambiguity is a stop-and-report, never an improvisation.

### 2.1 forms — Builder A

```text
src/components/ui/form-field.tsx
src/components/ui/text-field.tsx
src/components/ui/select.tsx
src/components/ui/choice.tsx
src/components/forms/forms-home-page.tsx
src/components/forms/forms-search-results-page.tsx
src/components/forms/form-detail-page.tsx
src/components/forms/form-detail-client.tsx
src/components/clinical-dashboard/patient-profile-panel.tsx
src/components/clinical-dashboard/settings-dialog.tsx
src/components/formulation/formulation-builder-page.tsx
```

**Fold first, then adopt.** `FormField`, `TextField`, `SearchField`, `Select`, `Checkbox` and
`RadioGroup` have **zero** production mounts today — their only call sites are DS contract
tests. So the work is (1) refactor the five controls onto the shared `FormField` shell inside
`src/components/ui/`, closing the COMPONENTS §0.4 defect where the hint is dropped when an
error is present, then (2) adopt the hand-rolled product fields onto the folded controls. Do
not invent product mounts that do not exist.

**Leave alone in this surface:** `aria-pressed` segmented groups in `patient-profile-panel`
and `settings-dialog`; `SegmentedControl` is now built and locally registered, but replacing
those production controls is explicit adoption work, not publication. Also leave
`SettingsToggleField` (a switch applies immediately, a checkbox batches — COMPONENTS §4) and
the shell composer query input.

### 2.2 headers — Builder A

```text
src/components/ui/page-header.tsx
src/components/mode-home-template.tsx
src/components/information-page-shell.tsx
src/components/dsm/dsm-page-header.tsx
src/components/clinical-dashboard/search-results-header-band.tsx
```

`InformationPageHeader` (`information-page-shell.tsx`) is defined but unused. `PageHeader`
is no longer unmounted: ten product files render it — eight under
`therapy-compass/` (the workspace and its seven screens), `privacy-quiet-signal-page.tsx`, and
`dsm/dsm-page-header.tsx`, which renders it alongside `InformationPageBreadcrumbs`. `Breadcrumb` is rendered by
`ui/page-header.tsx` and `information-page-shell.tsx`. Adoption converges the remaining
hand-rolled headers onto `PageHeader` + `Breadcrumb`.

**Explicitly NOT in the headers allowlist**, despite being header-adjacent:
`global-search-shell.tsx`, `shared-search-app-shell.tsx`, `master-search-header.tsx`,
`src/lib/search-shell-props.ts`, `src/lib/search-route-ownership.ts`. Those own composer
placement and phone collapse geometry. Changing them is a search-chrome change, not a header
adoption, and belongs to the controller under `docs/search-chrome-behaviour.md`.

**Pairing rationale:** forms and headers go to one builder because headers is where the
one-composer-per-page rule is most likely to break, and forms is the surface most likely to
add a field that looks like a composer. Both sides of that interaction stay in one context.

### 2.3 catalogues — Builder B

```text
src/components/services/services-home-page.tsx
src/components/clinical-dashboard/differentials-home.tsx
src/components/clinical-dashboard/favourites-command-library-page.tsx
src/components/dsm/dsm-home-page.tsx
src/components/dsm/dsm-search-page.tsx
src/components/factsheets/factsheets-home-page.tsx
src/components/applications-launcher-page.tsx
src/components/therapy-compass/screens/home-screen.tsx
```

Complete empty/loading gaps with `EmptyState` and `LoadingPanel`; converge local chip
duplicates onto DS `Chip`. **`FilterBar` and `DataTable` are retired names; use the registered
`SegmentedControl` for new mutually exclusive choices and the canonical `AccessibleTable`.**

**Coordination:** catalogues share the results ribbon and `search-band` pins with headers.
`search-results-header-band.tsx` belongs to **headers**; a catalogue commit that needs a ribbon
change stops and reports instead of editing it.

### 2.4 docs — Builder B

```text
src/components/clinical-dashboard/document-search-results.tsx
src/components/DocumentViewer.tsx
```

`DocumentFrame` is **built** (`src/components/ui/document-frame.tsx`) and used by
`DocumentViewer` as the single owner of viewing chrome: the `controls` toolbar carries page
navigation, zoom, fit, rotation, the viewing aid and fullscreen, and `PdfCanvasViewer` renders
source pixels only. There is exactly one toolbar and one page readout in the viewer, and the
contract test `tests/document-frame-contract.test.ts` holds that. It is not yet design-sync
registered among the 54 published visual exports. Do not invent a second frame or add inversion/filters; route document renders through
the existing viewer + frame. Keep every `role="alert"` semantic; route announcements through
the announcer policy rather than deleting roles, because many `role="status"` sites are
implicit polite live regions with no `aria-live` attribute and removing the role without an
`announce()` call changes what a screen reader hears.

`DocumentViewer.tsx` owns its own page composer. Do not add a second one, and do not touch the
shell props that hide the shared composer on document routes.

### 2.5 source provenance — controller

```text
src/components/ui-primitives.tsx           (SourceDesignationBadge / SourceStatusBadge / SourceProvenance)
src/components/clinical-dashboard/evidence-panels.tsx
```

The provenance implementations live in `ui-primitives.tsx`, **not** under
`src/components/ui/source*.tsx` — COMPONENTS §0.1 names them as registered components without
naming the module. Adoption here is consistency, not a rewrite of what the badges mean: the
three axes (designation, status, provenance) stay independent and no badge infers one from
another.

`SourceProvenance` deliberately drops unknown review-date and jurisdiction segments as filler
while `clipboardProvenanceLine()` stays fully explicit. That difference is recorded in both
implementations and is **not** a defect to reconcile: the visible strip is read at speed, the
clipboard line is an audit artefact.

The work that is real here is the caution channel: `answerSupportPriority()` gains an optional
`answerState`, so the live "Review source match" card and the DS `RetrievalStateBanner` derive
from the same projection and cannot drift once the answer surface adopts `AnswerCard`. It is an
addition to the three original signals, never a replacement — deriving from the state alone
would lose the stale-and-ungrounded case, which the projection collapses to `stale_evidence`.
Pinned by `tests/answer-support-priority.dom.test.tsx`.

### 2.6 answer — controller, last

```text
src/components/clinical-dashboard/answer-content.tsx
src/components/clinical-dashboard/answer-result-surface.tsx
src/components/clinical-dashboard/answer-thread-turn.tsx
src/components/ClinicalDashboard.tsx        (answer orchestration only)
```

`answer-result-surface.tsx` was missing from this list when it was first written and is added
here rather than silently edited: it is the module that calls `answerSupportPriority()` and
owns the inline support card, so the answer surface cannot be adopted without it.

Adopts `AnswerCard` + `AnswerState` + `VerificationNotice` + `RetrievalStateBanner`, with
`DateDisplay` / `MissingValue` for absent fields, and wires `onCopy` to
`composeAnswerClipboardText()` (`#208`). The `#207` ungrounded channel must already be on the
branch — it is, as the first Phase 1 commit — because the projection could otherwise report a
`grounded: false` answer as `ready` and adoption would retire the live "Review source match"
caution.

**`src/lib/rag/**` is read-only for every surface, including this one.** A change that appears
to need it stops and becomes a separate contract-PR proposal.

**Deliberately deferred: the `AnswerCard` container swap.** What landed is the whole of
`VerificationNotice` and the whole of `RetrievalStateBanner` on the live surface, driven by a
real `answerStateFromRetrieval()` projection, plus both product copy paths on
`composeAnswerClipboardText()`. What did not land is replacing the existing `answerSurface`
wrapper with `AnswerCard`'s `<article>`. That is a structural change to the chrome of the
primary clinical screen: it collides with the `answerSurface` style contract and the phone
geometry pins, and the first honest signal would be a `verify:ui` run at the end of the wave.
The clinically load-bearing part of PR 6 — the ungrounded channel, the preserved caution, the
copy payload — is adopted without it. This is a narrowing of the surface's scope and is
recorded here rather than left implicit; it needs its own commit and its own `verify:ui` pass.

**Defect found while adopting, and fixed:** attribution in the clipboard cannot be keyed on the
`AnswerState` kind. `#207` precedence puts `ungrounded` above `source_only`, so an extractive
answer that is also weakly supported reports `ungrounded`, and the paste claimed "AI-generated"
over passages no model wrote. `composeAnswerClipboardText()` now takes an explicit `sourceOnly`
tier flag, which both product callers pass. Pinned in
`tests/answer-clipboard-product-path.dom.test.tsx` and `tests/answer-clipboard-composition.test.ts`.

**Single answer-copy payload contract (`#234`).** The live dashboard answer, prior thread turn,
and inline answer result all route clipboard output through
`src/components/clinical-dashboard/answer-copy-payload.ts`; a fourth copy surface must reuse this
module rather than assemble answer text independently. `resolveAnswerSources` preserves the
populated cited source set and falls back only when it is absent/empty;
`answerStateForAnswer` creates the shared safety projection; `citedSourcesOnly` prevents uncited
retrieval candidates from changing attribution; `singleDocumentClipboardMetadata` emits an audit
line only for a single cited document; and `buildAnswerClipboardText` is the final composer that
preserves render text while adding attribution, state caveats, and eligible provenance. Source-only
attribution comes from the answer quality tier, not `AnswerState.kind`, because an extractive answer
may also be ungrounded. `tests/answer-copy-payload.test.ts` and
`tests/answer-clipboard-product-path.dom.test.tsx` pin both the helper and all three callers.

**Clinical-owner wording approval (2026-08-05).** The clinical owner formally approved the fixed
clinician-facing `responsive-compact` phone wording in
`src/components/ui/verification-notice.tsx` exactly as shipped on this branch. The approval covers
all model, extractive, degraded-state and unknown-state compact strings selected by
`RESPONSIVE_COMPACT_WORDING` / `UNKNOWN_RESPONSIVE_COMPACT_WORDING`. It does not replace the full
wording on larger screens, print or clipboard output, and it does not approve a disclosure,
clamp, hidden instruction, retrieval change, visual baseline or patient/plain-language variant.

---

## 3 · Registration disposition

The Phase 1 local registration gap is closed. The visual symbols below are now included in the
54-component source-derived registry; support APIs remain entry-only by design:

| Module                                        | Symbols                                                         | First adopting surface   |
| --------------------------------------------- | --------------------------------------------------------------- | ------------------------ |
| `ui/form-field.tsx`                           | `FormField`, `FieldHint`, `FieldError`, `ErrorSummary`          | forms                    |
| `ui/text-field.tsx`                           | `TextField`, `SearchField`                                      | forms                    |
| `ui/select.tsx`                               | `Select`                                                        | forms                    |
| `ui/choice.tsx`                               | `Checkbox`, `RadioGroup`                                        | forms                    |
| `ui/page-header.tsx`                          | `PageHeader`, `Breadcrumb`                                      | headers                  |
| `ui/live-announcer.tsx`                       | `LiveAnnouncer`, `RouteAnnouncer`, `announce`                   | docs (mount at app root) |
| `ui/verification-notice.tsx`                  | `VerificationNotice`                                            | answer                   |
| `ui/answer-state.ts`                          | `AnswerState`, `answerStateFromRetrieval`                       | answer                   |
| `ui/retrieval-state-banner.tsx`               | `RetrievalStateBanner`                                          | answer                   |
| `ui/answer-card.tsx`                          | `AnswerCard`, `AnswerFooter`, `DoseLine`, `answerClipboardText` | answer                   |
| `ui/missing-value.tsx`, `ui/date-display.tsx` | `MissingValue`, `DateDisplay`                                   | answer                   |

`TextField`, `SearchField`, `Select`, and `Checkbox` are registered references even where product
imports remain zero. Registration is not adoption. `LiveAnnouncer`, `RouteAnnouncer`, `announce`,
`AnswerState`, `answerStateFromRetrieval`, and `answerClipboardText` are support-only entry APIs.

---

## 4 · Exclusions

| Excluded                                                          | Reason                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/app/mockups/**`, `*-mockups.tsx`                             | Design scratch; 404 in production; gate-exempt. Never "fixed"                                                               |
| `src/lib/rag/**` and the other RAG-ranking protected surfaces     | Read-only; not an adoption surface                                                                                          |
| Wrapping or remounting `GlobalSearchShell`                        | One production mount exists (`shared-search-app-shell.tsx`); a second is a defect                                           |
| Half-component adoption                                           | SPEC §13 invariant — a surface adopts a component whole                                                                     |
| Replacing the product copy path with bare `answerClipboardText()` | `#208`; drops the render policy's warnings                                                                                  |
| Adopting the answer surface before `#207`                         | SPEC §13 blocker 2                                                                                                          |
| `FilterBar`, `DataTable`                                          | Retired names; use a surface-owned filter pattern and canonical `AccessibleTable`                                           |
| `DocumentFrame`                                                   | Built shell-only in `DocumentViewer`; not yet design-sync registered — do not invent a second frame or approximate controls |
| `#209` warning-as-body-text contrast                              | P3; not a Phase 1 blocker and not in this wave's scope                                                                      |

---

## 5 · Invariants every adoption commit is checked against

- **One search composer per page.** `GlobalSearchShell` is **never** wrapped. Phone composers
  are edge-to-edge, and hidden phone chrome means **zero** reserve — not `0.75rem`, not
  `env(safe-area-inset-bottom)`. Read `docs/search-chrome-behaviour.md` before touching chrome.
- **Production tap targets are `min-h-12`.** Never `min-h-11` — that reintroduces a known
  `ui-smoke` sub-pixel flake. Generic 44px accessibility guidance does not override this.
- **Design tokens, never hex. Named z-rungs, never a raw `z-[N]`.**
- **Internal navigation** via `<Link>` / `router.push` / server `redirect()` — never a raw
  `<a href="/…">` to an internal route.
- **Every `<button>` does something**, or uses the explicit disabled-placeholder pattern
  (`disabled`/`aria-disabled` + `title="… — coming soon"` + an `sr-only` note).
- **Never sweep `tc-` without excluding `qtc-`** — QTc is a cardiac interval, and one RAG eval
  case ID contains it.
- **Test pins flip in the same commit as their surface**, so each surface reverts alone.

---

## 6 · Test pins by surface

The pins each surface's commit is expected to flip or preserve. Full path:line inventory is
held with the wave's prep material; the files are the contract here.

| Surface    | Pin files                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| forms      | `tests/ui-tools.spec.ts` (forms home/results/detail) · `tests/forms-back-navigation.dom.test.tsx` · `tests/information-page-shell.dom.test.tsx` · `tests/patient-profile-panel.dom.test.tsx` · `tests/settings-inert-preferences.dom.test.tsx` · `tests/ui-v2-form-field.dom.test.tsx`                                                                         |
| headers    | `tests/search-results-header-band.dom.test.tsx` · `tests/header-scroll-hide-contract.test.ts` · `tests/ui-style-contract.spec.ts` + `tests/helpers/style-contracts.ts` · `tests/ui-route-coverage.spec.ts`                                                                                                                                                     |
| catalogues | `tests/ui-tools.spec.ts` (services/differentials) · `tests/ui-specifiers.spec.ts` · `tests/ui-formulation.spec.ts` · `tests/ui-route-coverage.spec.ts` · `tests/registry-retry.dom.test.tsx` · `tests/page-secondary-navigation.dom.test.tsx`                                                                                                                  |
| docs       | `tests/document-filter-panel.dom.test.tsx` · `tests/document-search-record-fault.dom.test.tsx` · `tests/document-clinical-summary.dom.test.tsx` · `tests/document-section-nav.dom.test.tsx` · `tests/document-section-summary.dom.test.tsx` · `tests/document-section-nav-contract.test.ts` · `tests/ui-smoke.spec.ts` (documents)                             |
| provenance | `tests/source-badges-off-vocab.dom.test.tsx` · `tests/source-metadata.test.ts` · `tests/source-preview-popover.dom.test.tsx` · `tests/forms.test.ts` · `tests/answer-support-priority.dom.test.tsx`                                                                                                                                                            |
| answer     | `tests/ui-smoke.spec.ts` (answer, incl. the **"Review source match"** support-card pin) · `tests/ui-tools.spec.ts` (answer empty state) · `tests/answer-progress-ui-smoke.spec.ts` · `tests/answer-preferences.dom.test.tsx` · `tests/answer-state-contract.test.ts` · `tests/answer-clipboard-composition.test.ts` · `tests/ui-v2-answer-safety.dom.test.tsx` |

**The load-bearing pin for `#207`** is the live "Review source match" assertion on
`answer-support-card` in `tests/ui-smoke.spec.ts`. It must still pass after the answer surface
adopts `AnswerCard`; if adoption moves the caution to a new carrier, the pin moves with it in
the same commit and the new assertion is at least as strong.

---

## 7 · Expected proof shots

Per-surface visual proof targets for the adoption glance. Phone **and** desktop wherever the
chrome differs between them.

| Surface    | Shots                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| forms      | `/forms` home with hero composer · `/forms` results with the sort group · a form detail page with its decision context · the patient profile panel open · a settings preferences row                           |
| headers    | a mode home's universal header + in-flow hero · a results ribbon · an info detail header with breadcrumbs · phone header collapsed vs revealed                                                                 |
| catalogues | `/services` home + results · `/differentials` home with the catalogue notice · `/dsm` home · a specifiers or formulation home · therapy-compass home                                                           |
| docs       | `/documents/search` results + filter shelf · a document detail with section nav · the clinical summary toggle and indexed source panel · a fault/empty search state                                            |
| provenance | the document-admin source metadata block · the answer support caution (pre-adoption baseline) · a differentials source-status chip · the source preview popover                                                |
| answer     | a ready grounded answer · an **ungrounded** answer showing the preserved caution (`#207`) · stale-evidence and source-only banners · a copied-clipboard sample (`#208`) · progress / empty / error / streaming |

### 7.1 Adoption evidence recorded for this pass (`#221`, `#235`, `#238`, `#245`)

This PR records executable evidence rather than committing image baselines. The generated adoption
manifest remains `baseline: not-committed`, and no Playwright snapshot PNG is an adoption claim.

| Surface            | Current adopted evidence                                                                                                                                                                                                                                                                      | Focused owner/check                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| forms              | `FormField` is mounted by `TextField`/`Select`; required labels carry a text marker and optional labels remain unmarked.                                                                                                                                                                      | `tests/ui-v2-form-field.dom.test.tsx`                                                                   |
| headers/catalogues | Shared mode status notices now delegate to DS `EmptyState`; therapy loading/empty wrappers delegate to `LoadingPanel`/`EmptyState`; differential and favourites chip wrappers delegate to DS `Chip` while retaining their surface-specific density/tone mapping.                              | `tests/design-system-target-evidence.test.ts`, `tests/mode-home-status-notice.dom.test.tsx`             |
| overlays           | `Sheet` portals to `OverlayRoot`'s modal host by default. Settings, the mobile Clinical Guide sidebar, and the three answer-review sheets use that default; none opts out with `portal={false}`.                                                                                              | `tests/sheet.dom.test.tsx`, `tests/design-system-target-evidence.test.ts`                               |
| answer             | The three product copy paths share the payload builder described in §2.6; answer-review overlays retain their existing content, dismissal, and focus-return props while using the portal default.                                                                                             | `tests/answer-copy-payload.test.ts`, `tests/answer-clipboard-product-path.dom.test.tsx`                 |
| cross-mode links   | `responsive-compact` deliberately mounts a phone chip rail and an `md+` card rail so SSR and hydration agree. CSS makes only one rail visible/in the accessibility tree; selectors and analytics must target the variant rail, while `cross-mode-links-rail` remains the phone-only contract. | `tests/design-system-target-evidence.test.ts`, focused `tests/ui-smoke.spec.ts` CrossModeLinks journeys |

**Residual evidence requirement.** Static and DOM checks establish portal ownership and preserve
focus-return inputs, but they do not prove every nested overlay's keyboard sequence in a real browser.
Before changing focus order, ancestor-scoped overlay styling, or the portal default, capture a focused
Chromium keyboard pass for settings, sidebar, and each answer-review sheet (open, Tab/Shift+Tab,
Escape, and return focus). This is follow-up evidence, not a visual-baseline commitment.

<!-- adoption-manifest:adoption:start -->

## Generated adoption truth

`generate-design-system-adoption.mjs` discovers every production `src/app/**/page.tsx` and
requires each route to appear exactly once in `adoption-contract.json`. Undeclared, missing, or
multiply-owned routes fail the check. `src/app/api/**` and `src/app/mockups/**` are non-page
product exclusions; the only route-only dispositions are the documented legacy-redirect
surfaces. Shared shell/component roots carry their own explicit `shared-shell` disposition.

Registered public components: 54
Declared product roots: 94
Roots with a literal `.ckb-v2` opt-in: 1
Roots inheriting `.ckb-v2` from the global `<html>`: 93
Production surfaces observed under v2: 17/17
Dynamic `ckb-v2` constructions: 0
Declared production page routes: 79/79

Source observation and contract declaration are independent. A literal `ckb-v2` on the global `<html>` makes every production surface inherit v2, but it does not approve that adoption.
The Proof column summarizes each surface's dark, forced-colours, 320px, print and browser declarations; exact statuses and evidence paths live in the manifest.
Observed v2 under a compatibility declaration fails closed. A declared v2 shell also fails closed unless every proof is passed with evidence and its visual baseline is committed or explicitly not-committed (pending Linux screenshot approval).

| Surface                                         | Disposition     | Routes | Roots | Declared shell | Observed shell (mount)     | Proof          | Baseline       |
| ----------------------------------------------- | --------------- | -----: | ----: | -------------- | -------------------------- | -------------- | -------------- |
| `root-shell-and-settings`                       | shared-shell    |      3 |     6 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `catalogues-forms-and-info`                     | owned           |     23 |    23 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `differentials`                                 | owned           |      7 |     7 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `formulation`                                   | owned           |      6 |     6 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `specifiers`                                    | owned           |      6 |     6 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `therapy-compass`                               | owned           |      9 |    10 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `documents-and-source-evidence`                 | owned           |      3 |     4 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `documents-source-legacy-redirect`              | legacy-redirect |      1 |     0 | v2             | v2 (inherited-global-root) | not-applicable | not-applicable |
| `ward-management-constellation-legacy-redirect` | legacy-redirect |      1 |     0 | v2             | v2 (inherited-global-root) | not-applicable | not-applicable |
| `favourites`                                    | owned           |      1 |     1 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `tools-and-calculators`                         | owned           |      3 |     3 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `caring-contacts-workspace`                     | owned           |      1 |     1 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `ward-management`                               | owned           |     12 |    20 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `privacy-safety-and-reference`                  | owned           |      3 |     3 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `search-results-shared`                         | shared-shell    |      0 |     1 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `answers-shared`                                | shared-shell    |      0 |     2 | v2             | v2 (inherited-global-root) | passed         | not-committed  |
| `source-preview-shared`                         | shared-shell    |      0 |     1 | v2             | v2 (inherited-global-root) | passed         | not-committed  |

<!-- adoption-manifest:adoption:end -->
