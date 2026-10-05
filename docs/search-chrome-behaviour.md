# Search chrome behaviour contract

This repo uses one shared search experience across the global shell, dashboard result pages, and document-detail/source routes. Keep the behaviour page-aware but predictable.

## Page ownership model

| Page state                                                   | Composer placement                                                                                                                                | Reserve owner                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Shared home (`/`, any mode) / standalone mode homes          | In-flow hero composer on phones and larger breakpoints                                                                                            | Page content; no fixed phone dock reserve                                                   |
| Tools directory (`/tools`) and legacy alias (`/?mode=tools`) | No shared composer or phone dock; browse and filter through page-local catalogue controls                                                         | Idle shell padding only                                                                     |
| Therapy Recommend (`/therapy-compass/recommend`)             | In-flow clinical-situation composer; no shared composer or phone dock                                                                             | Idle shell padding only                                                                     |
| Submitted/search-result views                                | Compact bottom dock on phones; in normal page flow on tablets and desktops                                                                        | Shell/dashboard `--mobile-composer-reserve` on phones; page content on desktop              |
| Answer result view                                           | Overlaid glass header plus answer composer dock                                                                                                   | Dashboard `#main-content` top/bottom reserves                                               |
| Document detail/source routes                                | `DocumentViewer` floating composer                                                                                                                | `DocumentViewer` content padding                                                            |
| Document section navigation                                  | Header row disclosure (phone sheet) + rail index card at `lg`                                                                                     | None — adds no chrome and no reserve                                                        |
| Record page breadcrumb header                                | Same header row without the disclosure or track; view mode inline from `sm`                                                                       | None — portals into the phone collapse row, sticky at `sm+`                                 |
| Calculators (`/calculators`)                                 | In-flow hero composer at home; shared compact dock on `/calculators/search` (browse or submitted)                                                 | Page content at home; shell reserve for the catalogue and submitted results                 |
| Dictionary catalogue (`/dictionary/search`)                  | A result view: compact bottom dock on phones; the page composer slot from `sm` up, page-owned so it sits under mode nav and above the Filter band | Shell `--mobile-composer-reserve` on phones; `desktop-page-composer-slot` (5rem) on desktop |
| Information/detail (record) pages, every mode                | No composer at any breakpoint                                                                                                                     | Idle shell padding only                                                                     |
| Guide Centre dialog (`GuideDialog`)                          | No composer — tour-action dock inside the Sheet footer; Sheet footer band from `sm`                                                               | `[data-guide-content]` bottom pad (`guide-tour-dock` reserve owner)                         |

The information-page row has **no per-mode exception**. `GlobalSearchShell` derives it from
`isInformationPage` alone (`src/lib/information-pages.ts`): if a route is a mode's record page, it
renders no composer on phone, tablet or desktop, and its phone clearance collapses to
`mobileComposerIdleReserve`. Services, Forms and Medication record pages used to opt back in through
an `isToolDetailWithFooterSearch` allowlist; that allowlist is gone, and a route must not be
re-added to bring a composer back. Catalogue result docks (`/services/search`, `/forms/search`) keep
theirs because `isSlugDetail` excludes the reserved `search` suffix, not because they are named
anywhere. Coverage: `tests/information-pages.test.ts`,
`tests/search-route-ownership.test.ts` ("does not treat catalogue search docks as information
pages"), and the record-page cases in `tests/ui-tools.spec.ts` and `tests/ui-chrome-scroll.spec.ts`.

The Tools row is scoped to the **mounted Tools directory**, not to `resultKind: "tools"`. Factsheets,
Dictionary and Therapy Compass borrow that result kind purely as a benign search kind, and on the
shared home they render the same short `SharedHomeEmptyState` as every other mode — so they take the
shared-home row above.

### The Guide Centre footer is a dock, not a footer band — and carries no composer

**The Guide Centre has no search.** It was removed on 2026-08-19: eight topics behind a
dedicated "All topics" tab did not need keyword lookup, and the composer was the single
largest piece of chrome on the surface — a chat pill at the bottom of a reference dialog
reads as a place to type, which this surface is not. Do not reintroduce one. The dock is
the guided-tour action and nothing else; `tests/guide-centre.dom.test.tsx` and
`tests/ui-smoke.spec.ts` both assert the dialog contains no `input`.

`GuideDialog` still renders that action through the shared `Sheet` footer slot, and
`Sheet` always wraps the slot in `border-t border-[color:var(--border)] p-3 sm:p-4`
(`src/components/ui/sheet.tsx`). On phones that band is the wrong chrome: an opaque
`--surface-raised` slab with a hard top border reads as a cover over the content behind
the control, which is exactly what every phone composer avoids.

So the guide footer carries `guide-tour-dock answer-footer-search-dock
answer-footer-search-edge` and renders one `.answer-footer-search-backdrop` child. The
shared classes own the phone geometry — flush `left/right/bottom: 0`, safe-area padding,
`background: transparent` — while the guide modifier keeps a restrained surface tint
through the Home Indicator region. The CTA remains above the effective inset; only its
background paints behind system chrome. This guide-only terminal tint is deliberate: the
shared search dock fades to transparent at the physical edge, which exposed a distinct
white strip against the fullscreen Sheet. The band's own border, surface and elevation
remain `sm:` only, and the scrim is `sm:hidden`, so tablet/desktop is unchanged.

Four consequences worth keeping:

- The dock takes the **compact** scrim (`data-footer-variant="compact"`, stamped by
  `Sheet`'s `footerVariant` prop). The default `max(10rem, safe-area + 8.5rem)` was sized
  for a composer _plus_ an action row; with one control row it tints far more page than
  the control it seats. This inverted when search was removed — the old note here said
  the default was required, and it was, while the pill sat below the row.
- The footer wrapper is the dock element, so its children need `relative z-10` to paint
  above the scrim.
- **Only the dock hides; the Sheet header stays pinned and compacts.** This is not a symmetry violation —
  AGENTS.md's header/footer symmetry rule is scoped to chrome that _shares a scroll
  container, and the Sheet header is a sibling of `.polished-scroll`, not inside it. On
  phones the branded row enters its compact treatment beyond 48px and expands again only
  within 8px of the top, avoiding threshold flicker. The title, "Close guide" control and
  all three view tabs stay rendered, visible and interactive in both states. Two reasons
  the complete header must never collapse or become inert:
  - "Close guide" and the view tabs live there. Collapsing the full header left a reader
    who had scrolled down with no way out of the dialog.
  - The runway maths. Hiding is refused unless the release fits the remaining scroll
    (`collapseHasSafeRunway` in `use-hide-on-scroll.ts`). The header is ~153px and the dock
    reserve against a ~330px range on a 390x820 phone, so charging both refused **every**
    hide once these pages were shortened. Charging only the guide-owned dock reserve leaves
    enough post-collapse range to clear the action.
- The dock's budget is read straight off `[data-guide-content]`'s padding, not through
  `readChromeCollapseMetrics`. That helper resolves `universal-header-collapse` against the
  **document**, which from inside a fullscreen modal is the shell header behind the dialog —
  it releases nothing here, but it was being charged. Any future modal-owned dock should
  compute its own reserve the same way rather than reusing the page-level helper.
- The tour action is the dock's **only** control, so it takes the filled primary
  treatment — the role `differentials-mobile-compare-fab__button` fills on its own
  surface — not the outlined translucent framing reserved for dock _addons_
  (`patient-details-fab__button`, Compare's `--empty` state). That framing was correct
  while a composer shared the dock: a filled slab beside the pill put back a smaller
  version of the cover the dock conversion removed. With nothing to compete with and
  nothing left to cover, the surface's single call to action should read as one. Only the
  pill radius and elevation stay `max-sm:`; from `sm` the footer is a real band where the
  square-cornered `primaryControl` is correct.
- The band's glass and the pill are proven in a **browser**, not by class presence:
  the Guide Centre journeys in `tests/ui-smoke.spec.ts` assert the painted background, border, flush
  geometry, terminal safe-area tint and resolved scrim height, plus the pill's rendered
  radius and fill. jsdom
  cannot evaluate the `max-sm:` media query or resolve the custom property
  `data-footer-variant` redefines, and tailwind-merge keeps both the base and the variant
  utility, so stylesheet order — not the class list — decides which one wins.

## Default in-page navigation template

When adding or suggesting **in-page navigation** on any mode page, use the DocumentViewer
header as the canonical visual and behaviour template. Do not invent a new phone header shape
or a second scroll-hide owner.

**Reference implementation:** `src/components/in-page-nav/in-page-nav-header.tsx`
(`InPageNavHeader`) is the shared component to mount — it owns the header row, the section
sheet, the actions sheet and the `PhoneHeaderCollapsePortal` wrapper, composing
`DocumentSectionTrack` / `DocumentSectionList` from
`src/components/document-viewer/section-nav.tsx`. Declare sections as `PageSection`
(`src/components/in-page-nav/page-section-index.ts`); omit `weight` and the header measures
the rendered heights, or pass explicit weights when the sections are discrete tab panels
with no on-screen height to measure. Ownership and reserves for that chrome are the
“Document section navigation” row above.

Sections that the reader can jump to carry `inPageAnchor`
(`src/components/in-page-nav/in-page-nav-classes.ts`), which is
`scroll-mt-[var(--inpage-anchor-offset,6rem)]`. The property is published from the live chrome
height by `useInPageChromeMetrics`, which `InPageNavHeader` calls itself — a page needs no
wiring beyond the class. Without it a jump lands underneath the header, because information
pages carry no scroll margin of their own.

A declared section whose anchor is not currently rendered is dropped, not shown as a dead
jump: `useResolvedPageSections` resolves each `PageSection` to the first _visible_ member of
its `targetIds` and filters the rest. That is what makes breakpoint pairs (a phone copy and a
desktop copy) work, and why a conditional panel can be declared unconditionally. Anchors are
asserted against rendered DOM per route in `tests/in-page-nav-route-sections.dom.test.tsx` —
never by grepping for `id=`, which is the failure `/issues #256` records.

**Pages are Server Components more often than not.** `onSelectSection` is a function and
`PageSection.icon` is a `LucideIcon`; neither crosses the RSC boundary. A server page mounts
the header through a small `"use client"` sibling (`specifier-nav-header.tsx`,
`formulation-nav-header.tsx`, `dsm-diagnosis-nav-header.tsx`) that owns the section table and
the hooks, and receives `actions` as a `ReactNode` slot — server-rendered JSX passes fine.
Both sheets close on `pathname` change, because action JSX passed in from a server page has no
way to call `close()`.

**The section table lives in the nav-header sibling — always.** A page's `PageSection[]` is
owned and exported by a colocated `"use client"` nav-header sibling named for the route
(`src/components/specifiers/specifier-nav-header.tsx`). It is **not** declared inline in the
page component, and **not** put in a separate per-route section-index module. This holds
whether the page is a Server Component or a Client Component.

The four Server Component pages — `specifier-record-page`, `specifier-reference-page`,
`formulation-mechanism-page`, `dsm-diagnosis-page` — have no choice: as the paragraph above
explains, neither `onSelectSection` nor a `LucideIcon` crosses the RSC boundary, so those
routes need the sibling regardless of where the table would otherwise prefer to live.
Extending the same shape to Client Component pages buys two things a per-page judgement call
does not: one answer to "where does the section table live", and one import path for
`tests/in-page-nav-route-sections.dom.test.tsx`, which imports every route's sections to
assert its anchors against rendered DOM. PR #1766 shipped both shapes at once, and the closed
PR #1767 proposed a third (a standalone section-index module); pinning the rule here is what
stops that from becoming a per-route coin flip.

**Existing pages are not being migrated to match — this rule binds new conversions only.**
The inconsistency below is grandfathered, not a defect, and not a cleanup task looking for an
owner:

- Inline in a `"use client"` page: `serviceNavSections`
  (`services/service-detail-page.tsx`), `formNavSections` (`forms/form-detail-page.tsx`),
  `dsmDifferentialNavSections` (`dsm/dsm-differential-considerations-page.tsx`).
- Separate module: `differentials/detail-section-index.ts`, which is the precedent #1767
  generalised. It is also the one genuine exception on the merits rather than on history —
  its sections are built per record by `buildDifferentialSectionIndex` and typed
  `DocumentSection`, so there is no static `PageSection[]` table for the rule to place. A
  route whose sections are genuinely data-derived may keep a builder; a route with a fixed
  list may not.

Touch one of those files for an unrelated reason and leave its section table where it is.
Converting a route onto `InPageNavHeader` for the first time is the moment the rule applies.

### DocumentViewer keeps its own header — decided, not pending

`src/components/DocumentViewer.tsx` renders its own header row rather than mounting
`InPageNavHeader`. This was evaluated as a convergence task (`/issues #288`) and **declined on
the merits**. It is not a migration waiting for an owner: do not re-open it without new facts
against the four reasons below. New work on any _other_ page still mounts `InPageNavHeader`,
and the viewer remains the visual reference the template was drawn from.

**What is already shared, and what is not.** The duplication is the ~70-line header row and its
sheet-state plumbing — nothing else. The behaviour underneath is one implementation that both
paths import today:

| Concern                                | Single implementation                                     |
| -------------------------------------- | --------------------------------------------------------- |
| Segment track, section list, jump      | `document-viewer/section-nav.tsx`                         |
| Scroll spy, visible-element resolution | `document-viewer/use-section-spy.ts`                      |
| Anchor-offset / collapse measurement   | `sticky-chrome-metrics.ts` (both hooks are thin bindings) |

So "fix a bug in one and the other keeps it" does not hold for the spy, the track, the list, the
jump, or the anchor measurement — a fix to any of those already reaches every route. The residual
risk is confined to header markup.

**Why the row itself is not converged.** Each of these would require `InPageNavHeader` to grow an
escape hatch for its one non-conforming consumer, on a component seven routes already mount:

1. **Sheet state is observed and externally driven.** `DocumentViewer.tsx` feeds
   `mobileActionsOpen || sectionSheetOpen` to `useDocumentViewerChromeScroll` so both chrome
   edges stay open under a sheet; a **second** actions trigger lives in the phone composer dock;
   and `openSectionSheet` blurs the source-search input first, because the viewer owns a composer
   whose focus pins hide-on-scroll. `InPageNavHeader` owns its sheet state privately and
   deliberately — pathname-keyed, so the four Server Component adopters need no client state.
   Adoption means inverting that to controlled props for one caller.
2. **Both sheets carry viewer-only content.** The section sheet mounts
   `DocumentViewDensityToggle` (persisted, defaults condensed); the actions sheet passes
   `portal`, `contentClassName` and `headerLeading`, and is gated on `readyDocument`. The shared
   sheets take no content slot and pass none of those through.
3. **Chrome metrics differ in scope, property set and return value.** The viewer scopes to its
   own `<main>`, publishes a third property (`--document-collapse-height`), and consumes
   `headerHidden` for the desktop rail. `InPageNavHeader` calls `useInPageChromeMetrics()`
   itself — document-scoped, two properties, result discarded — with no way to opt out or read it.
4. **It breaks the contract tests that exist to protect this chrome.**
   `tests/header-scroll-hide-contract.test.ts` requires `<PhoneHeaderCollapsePortal>` and
   `data-document-sticky-header` in `DocumentViewer.tsx`, and
   `tests/document-section-nav-contract.test.ts` requires `data-testid="document-section-trigger"`
   there; all three move into the shared header on adoption. Keeping them green would mean
   threading literal strings through props purely to satisfy source-text greps.

**Anchor aliasing: both models stand, and they are not rivals.** The viewer keeps
`sectionAnchorAliases` inside `resolveSectionElement`; information pages keep
`PageSection.targetIds`. The viewer's sections are derived from the indexed payload at render
time by `buildDocumentSectionIndex`, so there is no declaration site on which to hang `targetIds`;
pages resolve their copies _before_ the spy runs, which is what keeps `useDocumentSectionSpy`
generic. Do not "unify" these by moving the alias map into the page model.

**What was converged instead.** The visible-element predicate had drifted into two identical
copies — one in `use-section-spy.ts`, one in `use-page-section-weights.ts`. It is now the single
exported `resolveVisibleElement(ids)`, with `resolveSectionElement(id)` as the alias-aware
wrapper over it. `useResolvedPageSections` still carries a third, deliberately _different_
predicate (`getClientRects` + computed `display` rather than rect size); converging that one
would change resolution behaviour on seven live routes and is not covered by any current test,
so it was left alone.

**Adopted so far:** `/differentials/diagnoses/[slug]`, `/services/[slug]`, `/forms/[slug]`,
`/specifiers/[slug]` (record and catalogue reference), `/formulation/[slug]`,
`/dsm/diagnoses/[slug]` and its `/differentials` child, `/factsheets/[slug]`, and
`/medications/[slug]`. Each is also listed in
`isHeaderAddonSlotOwnedRoute` (`src/components/mode-nav/header-addon-slot.ts`), which is how
the one-header-per-slot rule stays checkable. Two routes remain outside the template on
purpose: `DocumentViewer` (decided above) and the differentials presentations workflow
(decided below).

**Visual slots (adapt labels, back href, sections, and actions to the mode):**

- Left: back control (icon; text label from `sm` when useful).
- Center: page title (`h1`) plus chevron disclosure. Line two is the active section in
  `--clinical-accent` (section icon + label). The title control opens the section list.
- Right: ellipsis / page-actions control.
- Bottom edge of the header: weighted segment track showing section position
  (`DocumentSectionTrack` or an equivalent that preserves weight + active styling).
- Phone: section list is the shared `Sheet` (not viewport chrome). At `lg+`, keep an
  in-column section index card when the page has a rail — phones stay on the header
  disclosure + sheet.

**Scroll / attachment (must match DocumentViewer):**

- Wrap the header in `PhoneHeaderCollapsePortal` so below `sm` it portals into
  `#phone-header-collapse-addon-slot` under the universal search header and
  **hides/reveals with that one collapse owner**.
- At `sm+`, the same subtree stays in its page position (sticky/in-flow as appropriate).
  Never add a second sticky/fixed phone navigation header inside `#main-content`.
- Do not give the in-page header its own scroll-hide hook; share the universal collapse
  signal described under “Scroll hide/reveal”.

**The breadcrumb shape (pages with no section index).** The record pages behind
`InformationPageBreadcrumbs` have no sections, so the disclosure would open a sheet listing
one item and the track would render one full-width segment. Omit `sections` and
`InPageNavHeader` drops both and renders the breadcrumb shape instead — same row grammar,
same single collapse owner, none of the section machinery. `usePageSectionWeights` observes
nothing for an empty list, so those pages pay no measurement cost. Three optional props
shape that row:

- `showBackLabel={false}` keeps the arrow alone at every width when the row also carries an
  action or a mode, so the title owns the space. `back.label` is still the accessible name
  and becomes the desktop tooltip.
- `primaryAction` promotes exactly **one** page action. It is **not** the filled `--command`
  slab, because a control pinned to every scroll position should not be the page's heaviest.
  Its label is `sr-only` below `sm` so the accessible name does not change with the
  breakpoint; `primaryActionIconOnly` drops the label at every width for a glyph that carries
  its own meaning (the patients control on medications). A second promoted control is what
  turns the row back into the wrapping toolbar this shape replaced; everything else belongs
  in `actions`.
- **`primaryAction` and `actions` render as one joined group**, not two free-standing
  controls: a single border and radius around both, with a hairline between them. A bordered
  promoted action beside a borderless ellipsis reads as two unrelated things competing at the
  end of the row — which is what `/factsheets/[slug]` shipped before this. A lone `actions`
  trigger still gets the group's border, so the two cases look like the same control.
- `mode` is a page-level **view** mode — how the page renders, not where you are in it — and
  uses the shared `SegmentedControl`. From `sm` it sits inline in the row and costs no extra
  height. Below `sm` it renders **inside the actions sheet** under its own label, because a
  mode you set once and then read past does not earn permanent pinned chrome on the smallest
  screen; the full-width band it used to claim was the only second phone row on any converted
  page. Both copies are always in the DOM with CSS choosing one per breakpoint, so there is no
  state to keep in step. `mode` therefore **requires `actions`** — with no sheet to move into,
  a phone would have no way to reach it.

Used by `medication-nav-header.tsx` while the record is still loading (no record, no
sections) and by `factsheet-nav-header.tsx` for the seven non-`medRich` sheets, which carry
one reading level and so pass no `mode`. When a page adopts this,
register its routes in `isHeaderAddonSlotOwnedRoute`
(`src/components/mode-nav/header-addon-slot.ts`) and add the component to the expected
claimants in `tests/mode-nav-addon-slot.dom.test.tsx`, or that guard fails: the slot holds
exactly one page-owned header.

### Panel-swap adopters: the track drives tabs, and the sections carry no anchor

Two adopters exchange a panel rather than scrolling: `/differentials/diagnoses/[slug]`
(`differential-detail-page.tsx`) and `/medications/[slug]`
(`medication-nav-header.tsx`). Their `PageSection.id` is the tab id, not a DOM anchor id,
and the rules above change in three specific ways:

- **Pass explicit `weight`s.** `usePageSectionWeights` measures rendered heights and only
  the active panel is ever rendered, so measurement would report one full-width segment
  beside three empty ones. Both routes derive weights from what each panel holds — section
  counts, with a floor so an empty tab stays visible and a cap so one dense tab does not
  squeeze the rest to hairlines.
- **No `inPageAnchor`, and no `useInPageSectionNav`.** There is nothing to scroll to, so
  there is no scroll margin to set and no scroll spy to run: `activeId` is the active tab
  and `onSelectSection` sets it. `useResolvedPageSections` must not be used either — it
  would drop the three tabs whose panels are not currently mounted and collapse the track to
  one segment. (`differential-detail-page.tsx`'s existing `scroll-mt-24` values are inside
  panel bodies and are unrelated; leave them.)
- **Never claim `collapsible`.** The trailing chevron in `DocumentSectionList` means "this
  row opens an accordion". Selecting a tab swaps a panel instead.

The panel is not a `tabpanel` and its control is not a `tab`: the section list is a list of
buttons, so a `role="tab"` / `aria-controls` pair would name a tablist that no longer exists.
Keep a per-tab `id` on the panel — that is the rendered evidence a declared section resolves
to something real, which is what the panel-swap half of
`tests/in-page-nav-route-sections.dom.test.tsx` asserts in place of the anchor check.

**The two-rail variant (`rail`).** A panel-swap route with few enough sections to name in a
row may pass `rail={{ label }}` and get `InPageSectionRail` in place of the weighted track:
icon, label and a `count` badge per section, active one underlined. `/medications/[slug]` is
the panel-swap adopter, and the prop exists so it stays the only one by choice rather than by
drift — `/factsheets/[slug]`'s eight anchored sections would overflow the row this is meant
to simplify, and a scrolling route already has a spy moving the active state continuously.

**On Call's section pages are a recorded exception to that last clause (owner decision,
2026-09-13).** They are scrolling routes with a spy, which the paragraph above excludes, and
they take the rail anyway. What changed the answer is that On Call's alternative was tried and
rejected three times in one session: the weighted track plus a title disclosure named the
current group and hid that any other existed, so the reader had to tap a control to learn
there was somewhere to tap. The groups are few (two to six), single-word, and the whole page is
read standing up at 3am — the case the bar is for. What still holds unchanged: a route with
eight-plus sections, or with prose labels, still takes the track; and the two-slot floor
(`MODE_NAV_MIN_ITEMS`) means a page with one group renders no bar rather than a one-slot one.

On Call goes two steps further than the other adopters, and both are scoped to it:

- **`titleHidden`, and with nothing else on the row, no row at all.** The mode pill directly
  above names the current page on its main line, and on a phone this header is portaled into
  that same pill's collapse slot — so a title here printed the word twice in one 96px block.
  The page's actions moved to the universal header's trailing slot for the same reason, which
  left the row empty, so it is omitted rather than drawn. Only safe alongside a rail: without
  one, hiding the title also hides the section disclosure and strands every section. The bar's
  More slot is the overflow instead.
- **A return control in the section sheet** (`headerLeading`), where the sheet is a visible
  bar's overflow rather than the navigation itself. Reached from More, the list is the tail of
  a row whose head is still on screen, and the way out reads as going back to the page rather
  than as dismissing a dialog.

Guarded by `tests/on-call-section-header-testids.test.ts` (the wiring, on source — jsdom
resolves no section, see below), `tests/on-call-section-page-wiring.dom.test.tsx` (the
division of labour between the pill and this row) and `tests/ui-on-call-boards.spec.ts` (the
bar itself, in a browser, at 320/390/430px).

The rail changes three things about the row above it:

- **From `sm` the title stops being a disclosure.** Every section is already named in the
  rail, so the chevron would open a list of the same destinations. The title renders as plain
  text and the section sheet is unreachable. Below `sm` the rail scrolls, so the disclosure
  returns as its overflow — that is the "two rails" shape.
- **The rail is not a `role="tablist"`.** The same sections are reachable from the sheet on a
  phone, so a roving-tabindex group would put half the destinations behind arrow keys and half
  behind Tab. Ordinary buttons are reachable both ways.
- **`count` is a separate field from `detail`.** The sheet row has space for "3 sections" and
  the badge does not; parsing digits back out of the prose would break the first time a route
  worded its detail differently.

Rail items are `min-h-12` like every other production tap target. Two rails are tall on a
phone and `min-h-11` would buy back 4px per rail — do not take it. That is the substitution
`AGENTS.md` calls out, and it reintroduces a known `ui-smoke` sub-pixel flake.

**Band calibration is opt-in, and the default is the generic plan.** `planModeNavBands` fits
four items from the 33rem band. Medications override that to 42rem — two priority slots plus
More until every slot fits — because each of its labels carries a count badge, and that is
now requested explicitly with `rail={{ countedLabels: true }}`. It used to be keyed on
"exactly four sections", which silently applied medication's width budget to any four-item
rail: Therapy's four unbadged labels inherited it and sat two-and-More on every phone.
A rail whose labels carry no badge should pass a `density` from its own label family and
leave `countedLabels` off — measured against its own labels, not assumed. Therapy's four
render without truncation from 500px and clip at 430px, which is `balanced-four` (31rem);
`compact-four` (23rem) does fit four slots on a large phone but clips every one of them.

On Call's `wordmark-five` is the narrowest family the bar has carried — bar from 16rem, four
slots from 23rem, five from 30rem — and it is only safe because nothing decorative competes
for the width. It drops the glyph at every band with no restore, sets no `count` so no badge
is drawn, and its labels are single words: measured at 14px semibold with the slot's `px-3`,
three need ~242px, four ~316px and five ~418px, plus a ~70px More slot. That is 3 slots on a
320px phone, 4 at 390px and all 5 from about 480px. Two consequences worth knowing before
reusing it: a multi-word label in this family truncates rather than folding (the demo corpus
models one-word categories for that reason), and `mode-nav__icon` had to start reaching the
rails at all — it was emitted only by the top bar, so `extended`'s icon rule had been silently
inert on every rail.

**Route rails: the sections may be other pages (`/therapy-compass/[slug]`).** Therapy's record
header declares its sections as that therapy's own routes — the record, its patient sheet, its
brief intervention, and the comparison — so selecting one navigates rather than swapping a
panel or scrolling to an anchor. The rail is then "this record's pages", and `activeId` is the
page you are on.

Two rules follow, and both differ from the panel-swap adopters:

- **A destination whose artefact does not exist is omitted, not disabled.** Not every therapy
  ships a patient sheet or a brief version, and a rail slot has nowhere to carry the stated
  reason that `docs/wiring-conventions.md` requires of a disabled control. Dropping the slot
  is the same answer `useResolvedPageSections` gives for an anchor that is not rendered, so
  the rail length varies per record by design.
- **It is guarded by its own test, not by `in-page-nav-route-sections`.** That file asserts a
  declared section resolves to rendered DOM — an anchor or a panel. A route destination
  resolves to a navigation call, so `tests/therapy-record-nav.dom.test.tsx` asserts the
  routing and the omission rule instead.

Therapy's mode-level `ModeNav` is still a separate multi-route pattern and is unaffected: that
bar moves between Therapy's tools, this rail moves within one record.

### The differentials presentations workflow keeps its own layout — decided, not pending

`src/components/differentials/differential-presentation-workflow-page.tsx` is **not** being
converted, and this is a decision rather than a backlog item. Do not re-open it without new
facts against the three reasons below.

The premise that it was a conversion candidate does not survive reading it. It was carried
forward as "a `SectionTabs` page that swaps panels"; it swaps nothing. Its `MobileTabs` is
four `<Link>`s to **other routes** — the diagnosis detail page, its `?tab=map` and
`?tab=related` views, and the compare route — with "Compare" hardcoded as the active one.
That is mode-level page switching, which the "Not this template" note below already carves
out for Therapy-style `ModeNav`, and the same carve-out covers this row.

1. **It is a comparison workspace, not a reading spine.** Every candidate section —
   `SafetySnapshot`, the comparison table, `ReviewPanels`, `SourceStatusPanel` — is rendered
   two or three times at different breakpoints, in different DOM parents: an `xl` sidebar
   `<aside>`, an `md`–`lg` grid, and a phone copy nested _inside_ the mobile comparison
   section. `PageSection.targetIds` resolves a phone/desktop pair; it does not model three
   copies where one is a descendant of another section's anchor.
2. **Its own header row is cross-route navigation plus a phone footer.** The page already
   owns a `PhoneFooterLayerPortal` action bar, and its back control is duplicated across two
   breakpoint blocks. Mounting the shared header would leave the `MobileTabs` route row in
   place beside it — two navigation rows, one in-page and one cross-route, which is the
   wrapping-toolbar shape the template exists to remove.
3. **It is a Server Component with no client half.** Adding one is cheap; adding one whose
   only job is to declare sections that resolve inconsistently across three breakpoints is
   not.

`isHeaderAddonSlotOwnedRoute` therefore continues to return `false` for
`/differentials/presentations/[slug]`, and `tests/mode-nav-addon-slot.dom.test.tsx` pins
that. If the differentials mode nav is reworked so this page stops owning a route-tab row,
revisit reason 2 then — not before.

**Not this template:** Therapy-style `ModeNav` (multi-route mode tabs via
`ModeNavHeaderPortal`) is a different pattern for mode-level page switching. Info-page
`PageHeader` / breadcrumb chrome is also not in-page section navigation. Existing
simpler collapse headers (for example Differential detail) remain special cases; **new**
in-page navigation work defaults to the DocumentViewer template above.

## Invariants

1. Use `src/components/clinical-dashboard/mobile-composer-reserve.ts` as the TypeScript source of truth for phone composer clearances.
2. Keep the CSS token `--phone-dock-hidden-pad` aligned with `mobileComposerHiddenReserve`.
3. A visible fixed phone dock may include `var(--safe-area-bottom)` so the pill clears the home indicator.
4. A hidden phone dock must release the content-facing reserve to `0rem`; do not use `env(safe-area-inset-bottom)` or `var(--safe-area-bottom)` for hidden content padding.
5. Edge-to-edge phone dock mode is `left: 0; right: 0; bottom: 0; width: 100%`; inset the pill with padding, not with a non-zero bottom offset. Keep the dock form transparent and use its absolute `.answer-footer-search-backdrop` child for localized translucent gradient/blur around the pill. The gradient and every blur mask must return to fully transparent at the physical bottom edge. It must move and fade with the dock, then become `visibility: hidden` after the hide transition so WebKit cannot retain a safe-area compositor strip; it must never become a viewport-fixed or opaque slab.
6. Header and footer chrome that share the same scroll signal should hide/reveal symmetrically for the surfaces that actually hide. **Collapse motion (tablet and desktop only):** when the top bar is hidden, `chrome-safe-area-top` and the controls both release to `0rem` so underlying content paints to the physical viewport edge. **Overlay motion (every phone route on both hosts, no exception):** the stack translates instead; `chrome-safe-area-top` stays inside the translated layer at a stable height, and the content-facing `--phone-overlay-chrome-h` clearance is constant across hide/reveal — zeroing it on hide would reintroduce the layout shift overlay exists to remove. The visible phone header still owns `var(--safe-area-top)`; tablet/desktop top-bar chrome keeps its pinned inset. While visible that spacer is the top of the header, so it paints `var(--surface)` — the bar's own opaque phone colour — never `var(--background)`: the page colour there reads as a status-bar band above the bar, the seam overlay-strategy answer mode never shows because its header pads the inset itself. Keep it opaque so the sm+ pinned inset still hides scrolled content. Top-bar hide/reveal is cross-breakpoint; the search field belongs to page flow and scrolls away naturally on tablets and desktops; the bottom search dock is phone-only. Hidden bottom dock reserve stays `0rem` (invariant 4). Read "Scroll hide/reveal" below before changing either.
7. Do not add page-local dock-sized `pb-[calc(...safe-area...)]` under a shell-owned dock. Put clearance in the shared reserve or the page-owned composer, never both.
8. `GlobalSearchShell` uses an inner `mobile-composer-reserve-pad` so phone padding contributes to scroll height; do not move phone shell clearance back to scrollport padding without a browser proof.
9. Page-owned fixed phone composers follow the same release contract: DocumentViewer keeps its floating pill but synchronizes transform, opacity, pointer release, and its own zero-reserve content padding. In-flow hero composers remain free of fixed-footer glass; Calculators uses the shared shell dock after submission.
10. Keep collapse-budget policy geometry-aware: an in-flow collapsing phone header needs enough remaining runway to absorb controls + released top safe-area + dock clearance, while a fixed overlay that only releases bottom reserve may hide when its post-collapse range retains the top reveal band plus deliberate hide intent _and_ the current offset already fits that post-collapse range (no material near-bottom clamp). Do not use synthetic page padding to make the stricter gate pass.
11. Detect reserve-transition clamps from geometry, not a wider pixel tolerance: if the scroll range shrinks and the previous offset no longer fits inside the new maximum, rebase that frame as layout feedback. Once the range stabilizes, the same upward movement must reveal normally.
12. Standalone mode-home detection (`isStandaloneModeHomePath`) is pathname-only. Do not gate hero vs dock on a React `searchMode` that can update before the router pathname lands — that one-frame mismatch animates reserve padding and reads as a choppy screen resize.
13. Phone `#main-content` / reserve-pad `padding-bottom` transitions apply while `data-reserve-transitioning="true"` (scroll-hide and reveal). Mode and route reserve flips clear that marker immediately and must snap.
14. Shared shell must reset phone scroll offset and scroll-hide state on `pathname` change so mode homes do not inherit a mid-page offset or collapsed header.
15. Hero composer portal: keep the default composer mounted until the portal host is actually attached; do not hide on `slotId` alone (mode-home remounts otherwise flash a null gap). Mode-home hero geometry reserves via `data-composer-reserve="pending"` (SSR) or `:not(:empty)` (portal attached); `MasterSearchHeader` must clear the pending marker when the home media query does not match, `searchComposerVisible` is false, or portal adoption falls back — never leave an unconditional empty `min-h` band.
16. Leaving the dashboard shell for a namespaced mode (`selectSearchMode` / `crossModeSearch`) must navigate without rewriting dashboard chrome first.
17. Do not wrap mode-home `{children}` in `ClientHydrationBoundary` — that blanks RSC HTML until JS mounts. Keep hydration guards on the specific leaf that mismatches. Do not call `useSearchParams()` in an ancestor Suspense that also renders route `{children}`: that nests the page segment inside the shell’s incomplete streaming boundary and can leave a persistent hidden `S:` clone (duplicate page-root `data-testid`s). Gate always-standalone pathnames with `isAlwaysStandaloneShellPath`, and bridge search params beside the shell body via `ShellSearchParamsBridge`.
18. Standalone mode-home `loading.tsx` files must render `ModeHomeRouteLoading` (phone top-aligned). Do not reuse unrelated results/medication skeletons.
19. `ClinicalDashboard` must stay out of the shared shell's static import graph (dynamic import) so namespaced mode routes do not parse the dashboard module.
20. Browser-mode phones keep `.phone-viewport-shell` in normal flow and use the document as the vertical scroll owner. This is required for Safari to minimize its own browser chrome; do not restore a fixed/inset root or a phone `overflow-y: auto` canvas.
21. Installed standalone phones use the same normal-flow root with the final `display-mode: standalone` `100vh` bound and an internal `.phone-scroll-surface`. Keep that override after the browser contract; do not substitute `svh`, `dvh`, `visualViewport.height`, or a fixed root on this WebKit workaround path. Every phone footer uses `.phone-footer-layer`: fixed to the viewport in browser tabs and absolute to the positioned 100vh frame in standalone, so the composer and its backdrop share the repaired PWA edge. Page-owned footer layers must render through `PhoneFooterLayerPortal`; `PhoneFooterLayerFrame` provides a frame-scoped, paint-free host after the scroll surface. An absolute footer left inside `.phone-scroll-surface` still scrolls and clips with that surface.
22. Document section navigation adds no chrome. The document header row carries the active section label and a
    weighted position track; the section list itself is the shared `Sheet` on phones (not viewport chrome, so no
    reserve and no second scroll owner) and an in-column card at `lg`. Both DocumentViewer sheets feed the
    `composerScrollHidden` guard so chrome cannot hide beneath an open overlay, and opening the section sheet blurs
    the document composer first. The viewer's sticky rail reads `data-scroll-hidden` from
    `universal-header-collapse` and drops its `lg:top` offset to the page-owned sticky document header height while
    the top bar is hidden; section anchors use `--document-anchor-offset`, published from the live collapse-row height
    plus that sticky header when the shared bar is away, instead of a fixed `scroll-mt`. Observe the shared header
    from the viewer; never edit it for this. The in-column section index card is `lg+` only — phones use the header
    disclosure and section sheet. Exactly one element may own `id="document-overview"` (the DocumentViewer overview
    landing wrapper); `DocumentClinicalSummary` must not reuse that id. The phone sheet lists only present sections —
    omit `source-images` when `visualCount === 0`, and do not require a "Tables and diagrams" sheet row in smoke for
    the empty-images lithium demo doc.
23. Safari's status bar, collapsing address bar, and pixels outside `window.innerHeight` are native browser/system controls. Do not use negative safe-area overscan, a fixed app root, synthetic document padding, or an opaque viewport slab to make CSS appear to own those pixels. Acceptance is no contrasting **app-owned** band around the native controls, with a matching opaque root canvas. Use the labelled physical-device matrix in [phone-chrome-physical-acceptance.md](phone-chrome-physical-acceptance.md).
24. **A page fills the box it is in; it never subtracts a chrome estimate from `100dvh`.**
    At `sm`+ the shell's `#main-content` grows into `.phone-viewport-frame` (`sm:grow`), the
    `mobile-composer-reserve-pad` inside it is the fill box (`sm:flex sm:min-h-full sm:flex-col`),
    and page shells grow into that pad (`sm:grow`). The dashboard mirrors this: its content
    wrapper is `sm:flex sm:min-h-full sm:flex-col` and the mode-home canvas is `sm:grow sm:shrink-0`.
    Do not reintroduce a `min-h-[calc(100dvh - <chrome estimate>)]` page floor. Three things such an
    estimate cannot know, each measured as real dead scroll before this contract landed:
    `--shell-header-h` (4rem) covers the header's inner bar plus `pb-2` but **not** its own
    `pt-[max(0.5rem,var(--safe-area-top))]` (8px on every route); the `header-collapse-addon` nav row
    on topic routes adds 49px more; and `#main-content`'s own `sm:pb-8` adds 32px. Pages whose
    content had already ended carried 8-273px of scroll range as a result — a scrollbar on a page
    that fits, and a wheel notch that jolts into the bottom stop. Phone floors are unaffected:
    below `sm` the document owns scrolling and there is no bounded box to fill. Guarded by the
    "pages that fit the window have no scroll range" cases in `tests/ui-chrome-scroll.spec.ts`, and
    repo-wide by `tests/viewport-fill-contract.test.ts`, which scans all of `src/**` for any
    `(min-)h-[calc(100dvh - …)]` class or `(min-)height: calc(100dvh - …)` declaration rather than
    checking a list of named files, and carries the exempt phone floors in one exact-count allowlist
    that fails closed when an entry goes stale.

The PWA notice rules that use `:has(#main-content ...)` are a deliberately
bounded post-hydration exception. `#main-content` can disappear briefly while
React replaces streamed route content, so those selectors are unsafe for
first-paint page geometry and must never become a general shell or composer
input. Every occurrence stays between the `BEGIN/END post-hydration PWA
main-content selector allowlist` markers in `globals.css`, where
`PwaLifecycle` waits for the settled shell signature before mounting notices.
`tests/pwa-lifecycle.dom.test.tsx` rejects any unclassified occurrence outside
that block. Add a non-`:has()` ownership signal when geometry is needed before
hydration; do not widen the allowlist to make a new selector pass.

## Results band (`SearchResultsHeaderBand`)

The band above every result list is not a composer and owns no dock reserve, but it is shared
chrome and changes to it land on every mode at once. Keep these rules:

0. **A faulted search never asserts a count.** This is the band's clinical invariant, not a
   style rule. `status` is a union (`ready | loading | refetching | error | unauthorized`); while
   faulted the count is absent from the DOM entirely and the spine reads "Couldn't search". A
   failed services search rendering "0 matches" states there are no crisis services when the
   search never ran. `0` with `status="ready"` is a real answer and still renders. Pages own the
   mapping from their own data source; five pages have no async source and are correct on the
   default.
1. **The query is the only heading element in the band.** It is the sole `<h1>`/`<h2>`; the count
   is never a heading. Nothing here is bold: the query uses weight 450 (`.search-band-subject`) and
   the figure uses 600 (`.search-band-count`) — two nearby steps of the same scale, separated by
   tabular numerals and a hairline rather than by shouting. No eyebrow — the magnifier tile
   already says "search", and a `QUERY` / `RESULTS FOR` label costs a line to repeat it. The
   query truncates; the count does not. Weights live as numeric `font-weight` on `.search-band-*`
   classes in `globals.css`, not as Tailwind arbitrary values: `check:type-scale --strict` is a
   zero gate on arbitrary `text-[Npx]`, and Geist is a variable face so 450/470/540/560/600
   interpolate rather than snapping to 700. Judge weights only with the app font loaded.
2. **The count is neutral text, not a success pill.** `text-muted` with the figure itself
   `.search-band-count` (600, tabular-nums), stepping down to 470 and muted at zero. Success
   colour is reserved for states that were actually achieved, so it still carries meaning where
   it appears. The `role="status"` / `aria-live="polite"` announcement stays either way — except
   while faulted, when the spine goes `aria-live="off"` and the fault panel's `role="alert"`
   makes the single announcement instead of both speaking.
3. **Sort is a segmented control, not a select — and it is `sm`-and-up.** Two values do not
   justify a menu you must open to read. `ResultSortControl` renders `sortOptions` as
   `aria-pressed` buttons inside a `role="group"` named "Sort results"; add a third order only if
   it still fits the rail. Below 640px it is `hidden`: the two segments cost roughly half the
   band's one line, and the query truncated to pay for a control set about once a session. Only
   the affordance is `sm`-and-up — `?sort=` still carries an alpha order onto a phone and the
   results honour it. The display class belongs in the component's own base string, because `cn`
   is a plain join with no Tailwind conflict resolution. A page whose only utility is sort hides
   the whole utilities group below `sm` (`hasPhoneUtilities`) rather than leaving an empty flex
   child — in `inline` placement under 414px that child is `w-full basis-full`, i.e. a blank
   second line.
4. **The phone filter is a badged trigger opening a sheet — never a select.** Every mode's
   `mobileControls` is a `ResultFilterTrigger` (`result-filter-control.tsx`) with
   `mobileControlsPlacement="inline"`, so the band stays one line on a phone. **Six** band modes
   used to pass a `w-full` native select there — differentials, services, factsheets, prescribing,
   formulation and specifiers, the last two a two-column grid of them. (The tools launcher was a
   seventh surface carrying the same select, hence "seven" elsewhere; it renders no results band,
   so its trigger sits inline on the page rather than in this slot.) That control cost
   the band a whole second row, could not report how many filters were active, and — because of
   rule 5 — rendered its value at the same 16px as the query heading above it. Single-choice
   dimensions go in `ResultFilterSheet` as one `role="radiogroup"` per dimension, because they
   are genuinely one-of-N and a bank of `aria-pressed` toggles says they are not. Documents keeps
   its own panel: multi-select facet groups with counts, a find-a-filter field and
   collapse-by-default are not expressible as radios. Desktop is untouched — the ribbon renders
   `filterControls` from `sm` up and `mobileControls` below it, never both, so each mode keeps
   its own chip row or tab strip on a wide screen.
5. **Native selects are pinned to 16px below `sm`.** The unlayered iOS anti-zoom rule in
   `globals.css` ("Interactive element defaults") deliberately beats Tailwind's `text-*`
   utilities on `input`/`select`/`textarea`. Do not fight it with `!important` or a per-call-site
   override — a sub-16px control zooms the viewport on focus in Safari. Any control that must
   read quieter than the query steps down in **weight and colour**, never in size, and any
   select carrying variable-length values must set `truncate` or it clips mid-word rather than
   ellipsing (the "Current search" → "Current searcl" defect fixed 2026-07-27).
6. **The utility group is a swipe rail below `lg`, an inline row at `lg+`.** The row/stack switch
   moved to `sm` (640) so portrait tablets stop rendering the phone layout, but the rail's
   overflow, fade mask and trailing spacer stay on `lg` deliberately: at 640-1023px a page with
   chips, sort, a mobile filter and utility controls can exceed the width, and containing that
   inside a scrollable rail is what keeps `expectNoPageHorizontalOverflow` green. Children are
   `shrink-0` so they keep their natural width; overflow scrolls instead of wrapping into a
   second tinted band. The right-edge fade is applied via `data-overflowing` only while the rail
   actually overflows — never as a permanent mask.
7. **Active scopes render as removable chips at the head of that group**, in accent tone, so a
   constraint on the list is one tap from where it is read. Do not move them into a separate
   strip; `hasUtilities` already suppresses the whole group when nothing is active.
8. **The accent is a border, never an overlay — and it is now a lead mark, not a full-width
   rail.** An absolutely-positioned bar inside an `overflow-hidden` 12px-radius card is sliced by
   the corner arc, so it starts short and tapers while the 1px border curves past it — two lines,
   two geometries. A border avoids that by construction, and forced-colors maps it automatically.
   The accent used to be the card's own `border-top`; collapsing the band to one line moved it
   inside the padding as `.search-band-lead`, a 2 × 18px `border-left` on a zero-width box,
   because a line spanning the full width read as a divider between the composer and the results
   rather than as the band's own mark. Under forced colors it survives as **stroke count** rather
   than hue — one stroke healthy, `6px double` faulted, with the card's own top edge doubling to
   `4px double` alongside it — because `--clinical-accent` resolves to `LinkText` and would
   otherwise be indistinguishable from the other borders. That is what keeps a failed search
   visually distinct from a successful one when colour is gone. Two consequences worth knowing:
   the mark is `display: block` so it does not depend on flex blockification to paint at all, and
   the band's forced-colors rules **must remain the last block in `globals.css`** — at equal
   specificity a later rule wins, so an earlier block is silently overridden while still reading
   correctly.
9. **A new search page cannot skip the band.** `AppModeSearchConfig.resultsSurface` is required,
   so a new mode fails `typecheck` until it declares `results-band` or `answer`, and
   `tests/search-results-band-adoption.test.ts` then requires a matching mount plus a documented
   allowlist entry for any search route that legitimately has no result list.

Coverage: `tests/search-results-header-band.dom.test.tsx` (structure, sort wiring, count tone,
fault states and the no-overlay-rail guard), `tests/search-results-band-adoption.test.ts` (mode
and route adoption, forced-colors block ordering), `tests/ui-tools.spec.ts` (phone control pair
geometry and tap heights).

## Scroll hide/reveal

The universal **top bar** (mode, new chat, menu) is the only sticky desktop chrome: it hides on a deliberate scroll down and returns on a deliberate scroll up at **every** breakpoint. Tablet and desktop search are mounted at the top of normal page content, so they scroll away with that content and are independent of the header's hide state. Only the phone bottom search dock scroll-hides, and that stays phone-only. The top bar and phone dock read one `useScrollHideReporter` per host, so they can never disagree about direction.

Choose the hide mechanism from where the host's scrollport lives, because that decides what hiding costs the reader:

| Host                              | Scrollport                                                                                 | `hideOnScroll`                                                   | Mechanism                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClinicalDashboard` (answer view) | Document on browser phones; `<main>` in standalone and at `sm+`                            | `strategy: "overlay", allBreakpoints`                            | Absolute glass top bar translates off; `<main>` keeps its top reserve; search stays                                                                                     |
| `ClinicalDashboard` (other modes) | Document on browser phones; `<main>` in standalone and at `sm+`                            | `strategy: "collapse", wide: "collapse", phoneMotion: "overlay"` | Phone stack translates over `<main>`, which reserves `--phone-overlay-chrome-h`; the top-bar row still collapses at `sm+`, where search portals into `<main>` page flow |
| `GlobalSearchShell`               | Document in browser phones and at `sm+`; `#main-content` only in installed standalone mode | `strategy: "collapse", wide: "sticky"`                           | Tablet and desktop portal search into `#main-content`, leaving a sticky auto-hiding top bar                                                                             |

**Every phone route on both hosts uses `phoneMotion: "overlay"`, with no route
or mode exception.** The safe-area region, universal top bar, and any page
navigation portaled into the collapse row form one fixed browser/absolute
standalone layer, and the complete layer translates over content without
changing the scrollport or content geometry. Tablet and desktop are unchanged:
`GlobalSearchShell` keeps `wide: "sticky"` and `ClinicalDashboard`'s non-answer
modes keep `wide: "collapse"`, both for the top bar only.

The last two exceptions were retired 2026-08-06 because they were the whole of
a reported "scrolling pushes the page down on phones" defect. Measured on an
iPhone-13 viewport with motion enabled, sampling a content probe every frame
through one deliberate hide gesture and subtracting the scroll delta —
so the number is content movement the reader did not ask for:

| Route                               | before | after |
| ----------------------------------- | ------ | ----- |
| `/therapy-compass/pathways`         | 147px  | 0px   |
| `/therapy-compass/search?q=…&run=1` | 121px  | 0px   |
| `/differentials/diagnoses/<slug>`   | 137px  | 0px   |
| `/?mode=documents` (dashboard)      | 72px   | 0px   |
| `/?mode=prescribing` (dashboard)    | 72px   | 0px   |
| `/factsheets` (already overlay)     | 0px    | 0px   |

The two dashboard numbers are the floor, not the typical case: that emulation
reports no top safe-area inset, and collapse releases `chrome-safe-area-top`
along with the header row, so a phone that does report one moves by that much
again. The two routes that portal page navigation into the collapse row moved
the furthest precisely because their released row is taller — which is why
"they portal an addon row" was never a reason to keep them on collapse.
Overlay handles the addon correctly because `--phone-overlay-chrome-h` is
measured from the live stack rather than tokenised.

Collapse was the cause of the reported choppiness: a 1fr → 0fr grid
on the header row **plus** a `height` transition on `chrome-safe-area-top`
**plus** the reserve-pad `padding-bottom` transition handed layout back to the
scroller on every hide. Overlay removes that cause: `headerRelease` and
`phoneSafeAreaRelease` are both `0`, so hiding costs the scroller no layout.

Because overlay takes the stack out of flow, overlay phone routes own a
**constant** top clearance: `usePhoneOverlayChromeReserve` refines
`--phone-overlay-chrome-h` to the measured stack height and the shell's
`mobile-composer-reserve-pad` reads it as `max-sm:pt-[…]` only where overlay is
active. Three properties are load-bearing.

It is **measured, not tokenised**, because the collapse row grows with portaled
page navigation (`header-collapse-addon`) and a fixed `4rem` would clip those
routes. It **never varies with hide state** — `offsetHeight` ignores the hide
transform, so the same value is correct in both states; a reserve that animated
or zeroed on hide would reintroduce exactly the shift overlay removes. And it
must be **correct before the first paint**, which is a separate requirement from
both of those: the property is seeded in `globals.css` as
`calc(var(--safe-area-top) + var(--shell-header-h))` and refined in a
`useLayoutEffect`, never a passive `useEffect`, and the utility carries no `,0px`
fallback. Leaving the property unset until an effect ran painted the first
content underneath the out-of-flow header and then pushed it down at hydration —
a cold-load jump, which is the same defect class as the scroll jump this design
exists to remove (Codex P1, 2026-07-30). SSR cannot measure, so the seed is exact
only for routes without an addon row; addon routes refine by that row's height.

The clearance is only visible near scroll top, where the header is always
revealed, so it costs no usable height.

### Streaming shell-presence selector boundary

Next can temporarily remove `#main-content` while it streams a route and React
hydrates the replacement shell. During that gap every
`body:has(#main-content...)` selector evaluates false. Geometry driven by one of
those selectors is therefore safe only when the affected surface cannot mount
until the app shell is present; otherwise it can paint once with fallback
geometry and move when `#main-content` returns.

The current exception is deliberately narrow. `PwaLifecycle` holds the PWA
notice stack until the shell exists, so the phone-hero rules may target
`.pwa-notice-stack` and descendants of its `.pwa-install-native-sheet`. The
install-sheet selectors are intentional descendants of the guarded stack, not
independent consumers. Do not add another `body:has(#main-content...)` geometry
consumer without giving it the same mount-time shell gate and adding it to the
explicit allowlist in `tests/pwa-lifecycle.dom.test.tsx`; that contract includes
an unsafe negative fixture so a newly introduced consumer fails closed.

### Phone sticky-header mount and settle timing

The phone header stack (`.phone-sticky-header-stack`) is `position: fixed` (in browser tabs) and
mounts collapsed; the page reserve `max-sm:pt-[var(--phone-overlay-chrome-h)]` resolves to the settled
height only after mount and across the evidence-calibrated 80ms geometry quiet window
(`phoneOverlayReserveGeometryQuietWindowMs` in `use-phone-overlay-chrome-reserve.ts`).

**A portal that moves a `header-collapse-addon` row out of page flow must correct the reserve in the
same commit** — `claimPhoneOverlayAddonReserve`, called by `ModeNavHeaderPortal` and
`PhoneHeaderCollapsePortal` from a layout effect keyed on the host. It is not enough to let the quiet
window catch up. Taking the row out of flow shortens the page by its height immediately, so until the
reserve grows every element sits that much too high. Measured on `/differentials/compare` at 390x844
(#CHPC5C): the row portalled at ~315ms and the reserve only republished at ~423ms, and a tap inside that
window pressed "Open comparison" and released on "Edit selection" where the link had just been — the
browser retargets such a click to the two controls' common ancestor, so the link never activates and
nothing at all happens. Under renderer load the window widens; at 10x CPU throttle the tap failed 10
times out of 10, and 0 out of 10 once the reserve settled first. The quiet window still owns the case it
was built for, a transient wide-stack measurement during hydration (#147).

**How the claim covers every path.** It publishes the row's own height as a delta instead of
re-measuring the whole stack:

- **Cold first load.** React runs layout effects children-first, so the portal claims before the
  shell's reserve hook has settled anything. The claim writes `--phone-overlay-chrome-h` inline as
  `calc(<the value in force> + <row>px)` — the CSS seed, or an earlier claim — so seed + row is exact in
  the commit that shortened the page. It takes no stack measurement, so the #147 transient cannot leak
  in; the quiet window later settles the same total in pixels and nothing moves again.
- **In-session navigation.** Once settled, the inline measured value is in force and ignores the addon
  property; the claim re-measures through `publishPhoneOverlayChromeReserveNow`, which is safe after
  settle.
- **Release.** The claim's cleanup subtracts the row's height from the inline value. It cannot
  re-measure, because React runs layout-effect destroys before it detaches portal children, so the row
  is still in the stack when it runs. A swap between two addon routes therefore subtracts, then
  re-measures, within one commit.

**The pad that consumes the reserve must not transition `padding-top`.** The initial
`transition-property` is `all`, and the reduced-motion rules give every element a 0.01ms duration, so a
claim that changes the reserve started a padding-top transition on `mobile-composer-reserve-pad` that
painted the old value for exactly one frame — the same 49px jump and back, ~16ms, for anyone with Reduce
Motion on (and in every Playwright run, which emulates it). `globals.css` sets
`transition-property: none` on the pad at phone width; the more specific reserve-transitioning rule still
animates `padding-bottom` when it applies. A production-build trace showed the pad already inheriting
the new variable value while its computed `padding-top` lagged, which is how to recognise this rather
than a late write.

The addon slot holds one page-owned row (see `ModeNavHeaderPortal`), which is why the host's own height
is that row's height. `tests/phone-overlay-reserve-portal-wiring.dom.test.tsx` covers the wiring of both
portals on all three paths; the cases in `tests/phone-overlay-chrome-reserve.dom.test.ts` call the
publisher directly and prove nothing about who calls it. In the browser, the `#CHPC5C` test in
`tests/ui-phone-scroll.spec.ts` samples "Open comparison" every animation frame of a cold load and fails
if it moves at all; it failed on every run before the fix.

The settle assertion below is still required, because hydration timing is unchanged. A Playwright screenshot or `page.evaluate()` DOM measurement run immediately at `networkidle` can
therefore read premature geometry before the stack settles (for example, reading `main` at `y=72` with
the mode-nav rail appearing to overlap it, when the settled layout has `main` at `y=121` with zero overlap).
Measured on `/dictionary/browse` (#XPY409): unsettled `h1` `y=88` (appeared obscured behind the rail),
settled `y=161` with both pre- and post-redesign versions settling to `y=161`. The apparent overlap was
purely a measurement artifact.

**Required Playwright settle assertion pattern:**
Always assert that `.phone-sticky-header-stack` and `--phone-overlay-chrome-h` have converged to a matching,
settled non-zero height before capturing viewport screenshots or asserting vertical bounding-box offsets:

```ts
// Wait for phone-sticky-header-stack and --phone-overlay-chrome-h to settle
await expect
  .poll(
    async () => {
      return page.evaluate(() => {
        const stack = document.querySelector<HTMLElement>(".phone-sticky-header-stack");
        const reserve = getComputedStyle(document.documentElement).getPropertyValue("--phone-overlay-chrome-h");
        const stackHeight = stack ? Math.round(stack.getBoundingClientRect().height) : 0;
        const reservePx = parseFloat(reserve) || 0;
        return stackHeight > 0 && Math.abs(stackHeight - reservePx) <= 1;
      });
    },
    { message: "expected phone-sticky-header-stack and --phone-overlay-chrome-h to settle" },
  )
  .toBe(true);
```

**Keep the resting state transform-free — a transform is a containing block.** A
non-`none` `transform`, _including `translateY(0)`_, makes an element a containing
block for `position: fixed` descendants. So does a non-`none` `translate`. A phone
bottom dock inside that subtree resolves `bottom: 0` against the header stack
rather than the viewport and lands near the top of the screen — measured as a form
bottom 772px from the viewport bottom at 390×844, with `bottom` still computing to
`0px`, which is why it reads as a positioning puzzle rather than a CSS error.

So the revealed state applies **no** translate utility; only the hidden state
carries `max-sm:-translate-y-full`. A transition from `none` interpolates from the
identity, so the hide still animates. This ordering matters beyond
tidiness: a resting `translateY(0)` creates the containing block in the
server-rendered markup, before any portal exists to escape it, so the dock is
mis-anchored on first paint and only corrects at hydration (Codex P1,
2026-07-30). Resting-state-clean is the general rule — do not reintroduce a
no-op transform for symmetry with the hidden branch.

**Name `translate` in the transition list, not just `transform`.** Tailwind 4
compiles `-translate-y-full` to the standalone `translate` property
(`translate: 0px -100%`), not to `transform`. A transition list of
`transform, opacity` therefore does not cover it, and the header jumps to its
hidden position in one frame while only the fade animates — measured 2026-08-06
as `translate` going `none` → `0px -100%` between two consecutive frames on
every overlay phone route, with `getComputedStyle(...).transform` reading `none`
throughout, which is what disguised it. The stacks use
`max-sm:transition-[transform,translate,opacity]` and the all-breakpoints glass
bar uses `transition-[transform,translate]` for that reason. Docks written as
raw CSS `transform: translateY(...)` in `globals.css` are unaffected and stay on
`transform`.

`MasterSearchHeader` additionally wraps the composer in `PhoneFooterLayerPortal`
when `phoneOverlayMotion && usesPhoneBottomDock`, which covers the during-hide
window when the transform genuinely exists, and matches the mechanism invariant
21 already requires of the DocumentViewer and differential footers.
Treat it as defence in depth, not the primary fix — `PhoneFooterLayerPortal`
starts with `isPhone === false`, so it does nothing until hydration and cannot
protect first paint on its own. Do not solve any of this by rendering the
composer twice per breakpoint: duplicate page-root `data-testid`s are their own
failure mode (see invariant 17).

Rules that keep this working:

- **Hide the top bar, not the search field.** The collapse wrapper (`data-testid="universal-header-collapse"`) wraps `header#search` plus page navigation mounted through `PhoneHeaderCollapsePortal` into `#phone-header-collapse-addon-slot`. Keep composers outside the collapse row: tablet and desktop result search scroll with page content rather than being translated by the header.
- **Every production phone navigation header has one collapse owner.** `PhoneHeaderCollapsePortal` moves Therapy section navigation, DocumentViewer navigation, and Differential detail navigation into `#phone-header-collapse-addon-slot` below `sm`; the same subtree stays in its existing page position at `sm+`. Do not add a second sticky/fixed phone header inside `#main-content`: the universal collapse row must own its safe area, focus pinning, timing, clipping, and measured release. Semantic content headings and modal/sheet headers are not viewport chrome and stay in their own flow/scroll context.
- **Document phone headers overlay as one stable stack.** Document detail/source routes keep the complete phone header at a stable height and translate the safe area plus both header rows and the section track together. Hidden overlay chrome is transparent and non-interactive; revealed chrome frosts and covers the document. `readChromeCollapseMetrics` counts zero released top-header geometry for this overlay, while continuing to measure the independently hidden document composer reserve. Reveal must not change the active owner's scroll offset or a stable document/PDF anchor.
- **Feed the reporter from the element that actually scrolls.** Both app hosts run `useDocumentScrollHideReporter` alongside their `<main>` reporter. In browser-mode phones the normal-flow shell and `overflow-y: visible` surface make the document the only vertical owner, which lets Safari minimize its browser UI. Installed standalone mode uses a normal-flow `100vh` shell plus bounded inner surface, so document scroll does not fire there. The hook measures the same collapse budget and blurs the same focused composer for either owner. Page-owned footer chrome must follow the same rule: `DocumentViewer` observes both the document and the inner surface, then combines the signals so only the active owner drives it. Its rendered footer, like the differential page-owned footer, portals to the frame host so observing the inner scroll owner does not make the footer its descendant.
- **Keep browser-phone chrome attached to the viewport without fixing the app root.** Collapse-mode headers use one phone-sticky wrapper; answer overlay headers are fixed only in browser mode and remain absolute over the inner surface in standalone mode. Footer layers are likewise viewport-fixed in browser mode and shell-absolute in standalone. While either header or reserve transition changes document geometry, the corresponding transition marker disables anchoring on the active document/inner scroller so synthetic reverse scroll cannot cause a hide/reveal loop or reading-position jump.
- **Do not treat CSSOM bounds as physical iOS paint proof.** A fixed root can report perfect `getBoundingClientRect()` and hit-testing while WebKit leaves an app-external band. Keep browser/document and standalone/`100vh` static guards, then verify Safari and a freshly relaunched Home Screen app on a physical phone before merge. If iOS reports a web viewport shorter than `screen.height`, pixels outside that viewport are system-owned; keep the root canvas opaque and matching, but do not fake reachability with negative safe-area overscan.
- **Viewport stickiness belongs on the outer top-bar stack, not on `header#search`.** The top bar sits inside header-height boxes, which leaves a sticky rule on it zero travel. For the same reason the visible stack's ancestor in `GlobalSearchShell` is `display: contents` at every breakpoint rather than a block. The collapse result owns one phone-sticky wrapper (safe-area spacer + stack), while its `sm:` children retain the tablet/desktop offsets. At tablet and desktop widths the search portal leaves that outer stack holding only the top bar.
- **Collapse only the top-bar row inside the sticky stack.** Tablet and desktop page-flow search sit outside this stack entirely; the stack hides and reveals only the universal top bar.
- **Release the phone top inset with collapsing chrome.** For the default collapse motion, `chrome-safe-area-top` is a full-width sibling that is `h-[var(--safe-area-top)]` while the phone header is visible and `h-0` while hidden, using the same transition timing as the top-bar row. `readChromeCollapseMetrics` must charge that released phone height as well as the controls and dock reserve, or short pages clamp and oscillate at the bottom. The document overlay exception keeps this spacer inside the translated stack at a stable height and charges zero released top geometry. At `sm+` the spacer remains `h-[var(--safe-area-top)]`, and sticky chrome pins at `top: var(--safe-area-top)`. Do not leave a phone-only surface/status-bar band after collapsing controls hide.
- **One transition, no jump.** Phone page navigation belongs inside the universal 1fr → 0fr grid rather than running another scroll hook. The shared reporter may emit one hide on a deliberate descent and one reveal on deliberate upward intent; geometry must move monotonically through the 240ms hide / 200ms reveal and remain still at the bottom edge. Reduced motion removes the animation but not the complete edge release.
- **Do not sticky-position tablet or desktop result search.** The composer belongs to page flow at these widths; anchoring it overlays page controls (and blocks clicks) once the top bar collapses.
- **Tablet and desktop search are page-owned.** `desktop-page-search-composer-slot` is rendered at the top of normal shell/dashboard content and accepts the shared composer at `min-width: 640px`. The mode-home hero slot takes precedence. Never give the page composer, its slot, or an ancestor `fixed`/`sticky` positioning.
- **Rebase the reporter on geometry switches.** Pass `resetKey` when the host changes the scrollport under it (`ClinicalDashboard` passes `searchMode`, which swaps `<main>`'s header reserve); otherwise the carried-over offset spends the first post-switch scroll on a spurious hide or reveal. Shared mode-home shells should also reset on `pathname` so collapsed chrome/scroll offset does not carry across modes.
- **Do not carry composer focus into submitted result views.** Focus pins both chrome edges for keyboard safety. `GlobalSearchShell` must not pass `focus: true` with `run: true`, must gate `queryInputAutoFocus` on `!hasSubmittedModeSearch`, and both hosts must blur the dock input when the active result owner scrolls so hide-on-scroll can reclaim the header and bottom dock.

Coverage: `tests/header-scroll-hide-contract.test.ts` (wiring), `tests/use-hide-on-scroll.test.ts` (decision logic), `tests/ui-chrome-scroll.spec.ts` (tablet/desktop page-flow search plus top-bar hide/reveal), `tests/ui-phone-scroll.spec.ts` (shared shell header hide/reveal, per-mode top-edge release, collapse owner), `tests/ui-phone-scroll-routes.spec.ts` (per-route phone scroll sweep, including submitted calculator results), `tests/ui-phone-scroll-page-owned.spec.ts` (document-viewer composer, standalone frame-owned footers, Services canvas) — the three share `tests/helpers/phone-scroll.ts`, and `tests/playwright-project-isolation.test.ts` asserts every sibling is collected by the required browser projects, `tests/ui-therapy-nav-scroll.spec.ts` (Therapy section nav hide/reveal with the top bar).

Run `npm run verify:phone-chrome` for phone-chrome work. For executable changes its classifier checks installed/lock parity first, runs focused static contracts and only the browser/PWA owners and route journeys implicated by the changed files, then escalates to `npm run verify:ui` automatically for shared chrome foundations. Documentation-only scopes run only documentation guards. Use `-- --dry-run` to inspect the plan, `-- --files <comma-separated paths>` for an explicit scope, and `-- --full=always|never` only for a deliberate override.

## Phone dock addon slot (page-owned action above the pill)

A page may dock **one** action row above the phone search pill. It is not a
floating element: it portals into a slot rendered _inside_ the dock's `<form>`
(`master-search-header.tsx`), so it inherits the dock's `position: fixed`,
z-index, safe-area padding and scroll-hide transform. There is no bottom-offset
arithmetic and no second scroll listener anywhere in an addon.

Three claimants exist, and they are mutually exclusive by surface:

| Addon kind              | Slot id                                   | Claimed by                                                                    |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| `differentials-compare` | `differentials-mobile-compare-addon-slot` | Differentials submitted search / `/differentials/diagnoses`                   |
| `patient-details`       | `patient-details-addon-slot`              | Prescribing submitted search (dashboard-owned)                                |
| `therapy-compare`       | `therapy-compare-addon-slot`              | Therapy Compass dock routes, **and only while the URL carries a compare set** |

Rules:

- **One addon at a time.** `data-footer-addon` is a single attribute value, and
  the backdrop scrim height, the hide-transform overshoot and the content reserve
  all key off it. Register a new kind in `PhoneDockAddonKind`
  (`src/lib/mode-home-composer.ts`) and prove exclusivity in
  `tests/phone-dock-addon-contract.test.ts`.
- **Four numbers move together** for every kind: the `--phone-dock-<kind>-clearance`
  and `-compact-clearance` tokens, the matching reserve constant and resolver
  branches in `mobile-composer-reserve.ts`, the two backdrop scrim heights, and the
  `[data-scroll-hidden="true"]` transform overshoot that stops a subpixel strip
  peeping at the viewport edge.
- **Only claim the addon where the pill actually mounts.** The reserve inflates on
  the claim, not on the render, so claiming a route whose component never mounts
  opens a blank band at the bottom. `/medications` renders nothing at all — its bare
  path redirects on both branches (`medicationsHomeTarget()` in `src/proxy.ts`, with
  `medications/page.tsx` as the backstop) — and `/medications/[slug]` already opens
  the patient sheet from its own nav header, so neither claims the addon.
- **An addon that can be empty must gate its claim on being non-empty.** The
  therapy compare tray renders nothing until something is in the comparison, so
  claiming the slot on every therapy route would reserve a tray-sized band under
  a row that is not there. The shell therefore reads the set out of the URL
  (`readTherapyCompareSlugCount`) and claims only when it is non-empty — the
  claim and the render have to agree, in both directions.
- **Keep an addon exactly one row tall.** The clearance is a static token, so a
  dock that grows covers page content by exactly its own growth. Anything that
  needs more room opens a bottom `Sheet` instead of a taller bar; that is why
  the compare tray's expanded state is a sheet and the Patient details panel is
  one too.
- **Gate the portal at 639px**, matching `.phone-footer-layer`'s `sm:fixed`. The two
  Compare bars gate at 1023px, which between 640–1023px portals into a slot on a
  form that is not fixed. Do not copy that.

Coverage: `tests/phone-dock-addon-contract.test.ts` (registry, exclusivity, CSS/TS
value parity, therapy route/claim gating), `tests/patient-details-dock-action.dom.test.tsx`
(portal target, breakpoint, sheet wiring), `tests/therapy-compare-tray.dom.test.tsx`
(portal target, breakpoint, empty-set silence, sheet wiring),
`tests/ui-therapy-nav-scroll.spec.ts` (the tray hides with the composer and
releases its reserve to `0rem`).

## Motion & Animation Preferences (#S4K1GA)

The application supports explicit user motion preference overrides in addition to system-level accessibility settings. The preference is stored in local storage and mirrored onto the root element as `data-motion="full"`, `data-motion="reduced"`, or absent (defaulting to system preference).

### Physical iPhone acceptance rubric

To prevent regressions of the phone/PWA answer-progress animation defect (where OS Reduce Motion froze animations and rendered the then-current ECG trace invisible at `opacity: 0`), verify the following rubric on a physical iPhone in both Mobile Safari and the installed standalone PWA.

The indicator under test changed when the answer wait was redrawn as a single quiet status line: the scrolling ECG strip and the five-circle stepper are gone, and what remains is one breathing dot (`.answer-progress-dot`, `data-slot="answer-progress-dot"`) at the head of the line. The rubric is otherwise unchanged, and the dot was chosen partly because it makes step 2 trivial to satisfy — its resting frame is a complete, correct bullet, where a stopped spinner is a fragment of a circle.

1. **Motion=Full (`data-motion="full"`):**
   - In physical Safari and installed standalone PWA, when the in-app Motion setting is set to **Full**, the dot visibly breathes (a continuous opacity cycle, 2.4s) even if iOS system **Reduce Motion** is enabled in Accessibility settings.
2. **Motion=System / Motion=Reduced:**
   - When iOS system **Reduce Motion** is enabled (or in-app Motion is set to **Reduced**), the dot stops breathing and remains clearly visible at full opacity, rather than disappearing or rendering a blank box (`opacity: 0`).
   - The status line beside it still reads out what is happening, and the arriving source rail appears without layout jumps. Its cards are staggered by `.answer-sources-arriving .stagger-item` when motion is allowed; under Reduce Motion every card must be present and fully opaque immediately, never held invisible for the length of the cascade.

The motion preference contract in `src/components/clinical-dashboard/answer-status.tsx` and the corresponding stylesheet rules in `src/app/globals.css` must remain strictly intact across all breakpoints.

## Smart natural-language mode search

Smart search is provider-free interpretation of the selected catalogue. It is
available in Services, Forms, Differentials, Formulation, DSM-5 Diagnosis,
Specifiers, Therapy, Medication, Tools, Calculators, Factsheets, and Dictionary
and does not depend on `CLINICAL_ASK_ENABLED`, a hosted provider, Supabase, or a
server capability endpoint. The original query remains the visible composer value
and URL value; controlled mode-specific aliases add only low-weight catalogue
vocabulary to deterministic ranking. Medication, Tools, Calculators, Factsheets,
and Dictionary are local-only Smart matchers: natural-language interpretation in
those states suppresses universal-search requests and Document, Answer, and
Favourites cross-mode actions, while literal searches retain their configured
cross-mode behaviour.

Enter always opens the selected mode's normal results surface. A question mark,
question wording, or developed natural-language phrase never diverts the reader
to Clinical Ask and never generates prose. Compact codes remain literal after
terminal punctuation is stripped, so `form 4A?` remains a Forms lookup.
Unsupported modes retain their existing search/filter behaviour and show no
Smart promise. Clinical Ask is a separate dormant governed-answer workflow, not
an implementation of Smart mode search.

The phone home example ticker is not a Smart cue and does not follow the
capability. Below 640px the desktop prompt rail is `display: none`, so the
ticker ("Try this … Tap to search") is the only worked example a phone home
page carries, and it offers an ordinary search in every mode — governed or
dormant. It shows on every phone home composer (`showPhoneSuggestionTickerOnHome`)
and nowhere else: a submitted result view, an answer thread, and a phone bottom
dock all stay clear of it.

Tablet and desktop mode homes all share one composer stack in every mode: the
rotating `Try "…" in <Mode>.` example ticker line above the pill, the pill, the
`Prompts` chip rail, and the single APP-5 privacy line. The line used to read
`Smart search · Try "…"` and render only in the eleven catalogue modes, which
made a Forms home taller than the Documents or Answer home; it now carries no
Smart wording, so the dormant modes can share it without a Smart promise. Both
helpers are gated by placement rather than by mode: `MasterSearchHeader` passes
`showHomeSuggestions={isDesktopHomeComposer && searchMode !== "favourites"}`, so only the mode-home hero
composer renders them. Favourites is the one exception (owner decisions
2026-09-30): its home shows the pill alone, with no ticker, prompt rail or
privacy line at any width, and `.favourites-composer-slot` sizes its reserve to
the bare pill (52px on phones, 56px from 640px up). Every submitted result view and page slot renders the
compact pill alone at every width (no ticker, prompt rail, or privacy line),
matching the phone result dock; the answer dock is its own composer type and
keeps its privacy line. Phones already had this shape: every result view is the
compact bottom dock and every mode home is the same phone ticker + pill +
privacy stack, so the phone contract is pinned rather than changed. The
result-view page slots (`GlobalSearchShell`,
`DashboardDesktopResultComposerSlot`, and the one `DictionaryCataloguePage`
renders itself) carry `desktop-page-composer-slot`, which overrides the shared
reserve token to the compact composer's exact 80px settled height at every sm+
width; the mode-home token stays sized for the hero stack.

**A page that owns its slot element still takes the page placement.** The
dictionary catalogue renders the `desktopPageComposerSlotId` slot itself, purely
so the composer lands under its mode nav rather than above it, and the shell
suppresses its own copy for that route so exactly one element carries the id.
Until 2026-09-06 that page borrowed `modeHomeDesktopComposerSlotId` instead —
harmless while the two slots were one, but once the helpers were gated on
`placement === "desktop-home"` it was the only reason a results catalogue still
carried the hero ticker, Prompts rail and privacy line. Slot id chooses
placement: a result view must never be wired to the home slot to move a
composer.
Tools is the standalone-owner exception: its accessible `Search tools` control
does not render the shared prompt rail or intent cue, while its deterministic
local matching and ordinary `q`/`run=1` route remain the same. The intent cue
appears only while a shared-composer query is being interpreted as natural
language.

There is still exactly one composer. No Ask rail, microphone control, duplicate
input, or extra phone-dock reserve is mounted. Crossing from literal Search to
Smart search announces once; continued typing within Smart does not repeatedly
update the live region. The send control retains the mode's ordinary Search
name and action throughout.

Coverage: `tests/master-search-header.dom.test.tsx`,
`tests/smart-search-intent.test.ts`, the mode ranker suites, and
`tests/ui-clinical-ask.spec.ts` for the one-composer routing and five-mode
local-only request boundary.

## Search my work (staff modes header icon)

The staff work modes (My Day, Roster, Teaching, CPD, Admin, On Call) show a
"Search my work" icon at the right end of the universal header, declared on each
mode as `workSearch: true` in `src/lib/app-modes.ts` and read through
`appModeHasWorkSearch` — never a `searchMode === "…"` branch. It is the one
deliberate second control in the trailing region: on On Call it sits right of the
page menu in the trailing slot (Josh, 2026-10-04: top right on every staff page).

It is not a second composer. It reserves no space and adds no fixed bar: tapping
it opens a full-screen modal `Sheet` over the chrome, so the page keeps exactly
one search owner. The header imports only the icon; the search screen is a lazy
chunk (`lazy-work-search-sheet.tsx`) fetched on tap, hover or focus. Guarded by
`tests/work-search-header.test.ts`.

## Change checklist

Before changing search bar behaviour:

- Identify the page ownership row above.
- Confirm whether the page is using `GlobalSearchShell`, `ClinicalDashboard`, or `DocumentViewer` for the composer.
- Update the reserve helper and CSS token together when changing clearances.
- Add or update a focused static contract test for new constants or exceptions.
- For visual/scroll changes, run the relevant phone-scroll/overlap Playwright coverage through `npm run ensure` and `npm run verify:ui` when the environment supports the repo runtime.
- Complete [the physical iPhone checklist](phone-chrome-physical-acceptance.md) for shared safe-area/ownership changes; local Chromium cannot certify Safari or cold-launch PWA physical paint.
- For hide-on-scroll changes, re-read "Scroll hide/reveal" and prove the reveal at tablet and desktop, not just the hide.
- If a new route has a page-owned composer, document it here and add it to the route/search coverage rather than relying on comments in a component.
