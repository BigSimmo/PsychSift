# Search results bar — decisions

The shared results bar is `SearchResultsHeaderBand`
(`src/components/clinical-dashboard/search-results-header-band.tsx`). All twelve
`results-band` modes render it (every searchable mode except answer), so a change
there lands everywhere at once. This file records the decisions that are easy to
reverse by accident — each was reached by checking what the app actually does, not
what the surface looks like it should do.

Composer placement, phone dock reserves, and hide/reveal behaviour are a different
contract: see [search-chrome-behaviour.md](search-chrome-behaviour.md).

## Anatomy

- **One line from 414 px, and a lead rule instead of a full-width border.** The band was
  123 px on a phone to say "12 documents", because the utility rail dropped to its own row
  and that row was ~85% empty. It is 58 px (60 px from `sm`) wherever one line actually
  fits, and the accent is a 2 × 18 px mark inside the padding rather than a line across the
  whole width — at bar height that line
  read as a divider between the composer and the results rather than as the band's own
  accent. The mark is a `border-left` on a zero-width box, not a background: forced colors
  drops backgrounds and maps border colour to `CanvasText`, and `border-style: double` is
  what keeps the faulted state structural there.
- **State is still shape, not only colour** — the rule the deleted state tile existed to
  hold. The tile carried three jobs and only one needed a tile. _Narrowed_ is now carried
  by the shelf itself: applied filters grow the band by a whole labelled row, which is a
  louder signal than a funnel swapped into a 40 px square. _Running_ was already inline —
  a spinner and the word "Searching…" inside `role="status"`. _Faulted or partial_ is the
  one that would have regressed to hue alone, so it keeps three independent non-chromatic
  channels: the lead rule doubles from one stroke to two, a `CircleAlert` renders before
  the count for non-`ready` states only, and a faulted band renders no digit at all
  (`countUntrusted`). Do not reduce these to a colour swap; under forced colors
  `--clinical-accent` resolves to `LinkText` and `--warning` is not remapped at all, so hue
  cannot carry state there even in principle.
- **Nothing on the bar is reachable only by horizontal scroll.** Only the optional controls
  (sort, view, save, page utilities) sit in the scrolling track. Filter and Retry are
  pinned siblings outside it — Filter because it is the only control carrying state, Retry
  because it is the recovery action in a degraded state. Before this, Filter was the
  track's last child and so the first control to fall off the right edge once a mode added
  anything.
- **The query yields, never the controls.** The inline utilities group is `shrink-0`. It
  shipped as `shrink`, so an over-subscribed line paid the shortfall out of both the query
  _and_ the controls: the sort group was severed by the track's `overflow-x-auto` and its
  trailing option was then washed out by the 28 px overflow mask, which reads as a
  rendering fault rather than as "swipe for more". Measured on the live app: clipped at
  320/375/390/393/402 and 430/440 px, and by 41.9 px at **540 px** with a four-word query —
  so this was never bounded by phone width. `truncate` + `min-w-[2rem]` on the query
  heading already exist to absorb exactly this. Below 414 px one line cannot hold count +
  query + sort + filter even with the query fully truncated, so the utilities take their
  own full-width row there rather than overflow a band that is `overflow-hidden` and would
  clip the pinned Filter. `ui-smoke` asserts the rail fits as geometry, not as a class —
  the class that caused this read as correct, and `expectNoPageHorizontalOverflow` cannot
  see an internal scroller.
- **A control composed from a shared recipe must not rely on fragile override order.** Before
  `cn()` was upgraded to wrap `twMergeClinical` (`extendTailwindMerge` in
  `src/lib/tailwind-merge.ts`, taught this repo's custom `@theme` tokens), `cn` was a plain
  join, so `DocumentFilterTrigger` (`floatingControl` plus an override string) sent every
  contradictory utility to the DOM where stylesheet order — not intent — picked the winner:
  `font-semibold` (600 against the sort group's 470/560) and `--border-lux` (a visibly darker
  stroke than `--border`) lost, making the control flush against the sort group render as a
  different component. Even with `twMergeClinical` active in `cn()`, shared bar controls use
  the band's own control recipe — the same string `Save search` and `Retry` use — with the
  active/resting colours as mutually exclusive branches rather than relying on utility override
  chains.
- **Every mode uses one adaptive filter system, not a phone-only substitute.** Each result
  surface passes `ResultFilterTrigger` at phone and desktop breakpoints. The trigger opens
  `ResultFilterSheet`, which is a bottom sheet on phones and a restrained right drawer from
  `sm` up. The old native selects, bespoke desktop dropdowns and competing rails are gone.
  Lenses render as roving radio groups; facets render as individually reachable multi-select
  rows; `Search in` is a labelled, count-bearing scope selector. Dense catalogues gain search
  and collapsible groups from the shared component rather than from route-local panels.
  Documents now uses the same panel with staged application and a typed secondary Browse all
  sources action. The filter contract, including mode ownership, is in
  [filter-contract.md](filter-contract.md).
- **`mobileControlsPlacement` still defaults to `row`.** Nothing relies on that fallback
  now that every caller passes `inline`, and it stays anyway: a new mode that forgets the
  prop, or one with a genuine reason to hand over something full-width, should degrade to a
  second row rather than to an unreadable 58 px line at 320 px. Do not flip the default.
- **Filter is pinned at the right edge; Sort stays inboard.** Sort is set about once a
  session. Filter carries narrowing state and is returned to repeatedly, so it is a pinned
  sibling after the optional utility rail rather than a child that can scroll away.
  `tests/ui-tools.spec.ts` asserts the placement and matched phone tap height.
- **The shelf.** A labelled `Filtered by` row under the bar, one tap to remove each
  filter, trailing `Clear` once more than one is applied. The chips scroll in an inner
  track; the label and `Clear` are pinned outside it, because the shelf was one
  `overflow-x-auto` row and four or five chips pushed its only global action past the right
  edge — the same defect the shelf was built to avoid for the chips themselves. `Clear` is
  matched to the chips at the tap floor rather than kept small; it stays quiet through
  weight and an underline. The label is a funnel glyph below `sm` and the wordmark from
  `sm`: a prefixed chip costs ~215 px of a 350 px bar, so every character the label spends
  is a chip the reader cannot see. Either form is decorative — the group keeps
  `aria-label="Applied filters"`. The label matters: without it a
  row of accent pills reads as a second bank of buttons rather than as state. It
  deliberately survives `loading` and a zero-result set — nothing matching is exactly when
  a filter needs relaxing, and dropping it mid-search would flicker the chips out and back
  on every keystroke. Only a fault removes it, because filtering a result set that never
  loaded is meaningless.

## The shelf is shared state, not a mode exception

Any mode with hidden, multi-dimensional or non-default scope state passes `appliedFilters`
and `onClearFilters`. The shelf is prop-driven; the shared bar never infers refinement state
from context. `AppliedFilterChip` carries a compact `valueLabel`, an optional desktop
`groupLabel`, a complete `accessibleLabel` when necessary, and `onRemove`.

The shelf is required for Documents, Services, Forms, Differential workspaces, DSM,
Specifiers, Formulation, Medication, Therapy, Calculators when narrowed, and Favourites. A
compact category lens may omit it only when the active value remains directly visible at that
breakpoint. Selected retrieval and result facets remain visible at zero results so recovery is
always possible.

Count what narrows results, not how many controls happen to be visible. Scope is counted when
non-default. Sort, display density, grouping, comparison state, suggested searches and
Recently used views are excluded. Query-replacing presets belong near the composer, never in
the shelf or filter badge.

## Deliberately not done

- **The library button does not go back on the rail.** _(Amended: it was on the rail until
  the one-line redesign; the reasoning below is why it moved rather than was deleted.)_
  Corpus browsing does not belong in nav here: the documents action menu routes through
  `onSearchModeChange`, which calls `setQuery("")` and `setModeSearchSubmitted(false)`
  (`ClinicalDashboard.tsx`), so reaching the library that way discards the search being
  read. It therefore needs an in-context route that preserves the query — but that route
  did not have to be the utility rail, where it sat adjacent to Filter while answering a
  different question (Filter narrows what this query returned; Library opens the whole
  corpus), made the old name read as a second filter, and occupied the space the pinned
  Filter needs. _(Amended: this also claimed it was "the sole reason the phone rail could
  overflow at all". That was measured wrong — with Library gone the rail still overflowed at
  every common phone width, and at 540 px with a longer query. See "The query yields, never
  the controls".)_ It now has two
  in-context homes that both preserve the query: the filter sheet's footer, under a rule
  and phrased as reach with the corpus count beside it, and the zero-result state. Do not
  delete either without giving nav a query-preserving route first.
- **Sort does not move into the phone filter sheet.** Although Documents, Therapy Compass,
  Differentials, Forms, and Services now all share `ResultFilterSheet` (historically only
  Documents and Therapy had phone filter sheets when this decision was first recorded), Sort
  remains in the results bar utility rail rather than moving into the filter sheet: Sort is
  set roughly once per session and orders results, whereas Filter carries narrowing or
  highlighting state (`appliedFilters`) and is returned to repeatedly.
