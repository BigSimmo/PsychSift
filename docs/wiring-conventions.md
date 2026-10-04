> ⚠️ **Committed in `b21a24f12` alongside unrelated ED-screen work**, because two writers shared
> one git index. A wholesale `git revert b21a24f12` therefore deletes this file as a side effect.
> **Revert paths, not that commit.**
>
> ⚠️ **That commit's scope provenance is unconfirmed.** It touched four files outside its author's
> assignment and asserts a grant nobody can corroborate. The full record — and why it is filed as
> "unconfirmed" rather than as either "granted" or "violation" — was in the Ward Flow record
> fields-with-no-producer-2026-09-01.md, retired with the Ward Flow prototype on 2026-09-26 (read it
> from git history at commit 8ec68fd32). Kept in one place on purpose: a fact written out twice
> decays in two places.

# Page and button wiring conventions

How interactive controls and routes are wired in this app, and the gates that keep them wired.
The root `AGENTS.md` (`page-and-button-wiring` block) is the short rule; this is the detail.

A repo-wide audit (2026-07-21) found the app is well-wired — the conventions below are ones the
codebase already holds to. The point of writing them down, plus the two gates, is to keep new work
from regressing: a control that advertises an action must perform one, and a page that ships must be
reachable.

## Button wiring

Every interactive `<button>` must resolve to a behaviour:

- **Action** — `<button type="button" onClick={handler}>`. `type="button"` is used for every
  non-submit button, so it does nothing on its own; it **must** carry an `onClick` (or another
  handler).
- **Form submit** — `<button type="submit">` inside a `<form onSubmit={handler}>`, where the handler
  calls `event.preventDefault()`.
- **Navigation** — wrap it in a Next `<Link>`, or call `router.push(...)` from an `onClick`. Do not
  navigate by other side channels.
- **Busy / async** — route through the shared busy-state contract in `src/components/ui-primitives.tsx`
  (spinner + `disabled` + live-region announcement), not an ad-hoc disabled flag.

### Unavailable controls: which disabled encoding, and why it is a real decision

Two kinds of control look identical on screen and are not the same thing:

- **Unavailable for a stated reason** — the feature is not built yet, or the action needs data this
  record does not have ("no official source URL is recorded for this form"). The reason is written
  down, in a `title` and usually an `sr-only` span wired by `aria-describedby`.
- **Transiently inert** — a submit button while a request is in flight, a pager at its first or last
  page, a form action that is off until the form is valid. There is nothing to explain; the state
  resolves itself as the user works.

**Stated reason → `aria-disabled="true"` plus an inert handler.** Never the native attribute:
`disabled` removes the tab stop, so a keyboard user — and a screen-reader user who moves by Tab
rather than by virtual cursor — can never land on the control, and the reason we went to the trouble
of writing is never announced. The explanation existed and was unreachable; the control simply
vanished. Reference markup is `favourites-hub.tsx`:

```tsx
<button
  type="button"
  aria-disabled="true"
  onClick={ignoreUnavailableActivation}
  aria-describedby="thing-unavailable"
  className="… cursor-not-allowed opacity-60 …"
  title="Thing — coming soon"
>
  <Icon aria-hidden="true" />
</button>
<span id="thing-unavailable" className="sr-only">
  Thing is coming soon.
</span>
```

`ignoreUnavailableActivation` (`ui-primitives.tsx`) is the shared handler. It calls
`preventDefault()` **and** `stopPropagation()`, because that is what the native attribute did: a
disabled button fires no click at all, so nothing bubbled to a clickable ancestor.

**Transient → keep native `disabled`.** It is correct there: the control is genuinely inert and
momentary, the browser's own semantics are right, and making it focusable would be a regression, not
a fix. Sites deliberately left native include the compare action in `differential-stream-workspace.tsx`
(needs two diagnoses selected — and the same sentence is already rendered as visible text above it),
the pin editor's save button in `search-pins-menu.tsx` (form validity), the services compare and
clear actions in `services-navigator-page.tsx`, and the composer send in `master-search-header.tsx`.

**The boundary case: a confirm blocked because nothing has been chosen yet.** This one rule has two
correct spellings, and **both were reviewed and both stand** — do not convert either into the other.
A confirm inside a `<form>` renders as `<button type="submit" disabled={!declineReason}>`: a form
action awaiting validity, the transient case exactly. A confirm in a panel that is deliberately
**not** a `<form>` renders with `aria-disabled` + `ignoreUnavailableActivation` + `title` + an
`sr-only` reason for what looks like the same "no reason chosen yet" state. (The retired Ward Flow
prototype carried both side by side, on its ward and emergency-department decline confirms.)

The discriminator is not the state, it is whether the reason is worth reading. A form awaiting
validity has nothing to explain that the fields above it do not already show, so native `disabled`
is right and focusability would be noise. A non-form panel whose blocked reason carries clinical
meaning must keep that sentence reachable by Tab, so `aria-disabled` is right — the retired ED
screen's reason was _"Choose a reason before recording this decline. None is chosen for you: a reason nobody picked
would be filed as this team's own answer"_, which is a statement about what the record would mean,
not a restatement of the widget's state.

Such a panel also avoids `<form>` for a second reason worth preserving: a form submits on Enter from
inside a field whatever its submit control advertises, while an `aria-disabled` confirm stays fully
operable — so a reasonless decline could go through by keyboard while the screen said it could not,
and the reducer's refusal would be silent. Wrapping that panel in a `<form>` to "match" a form-based
screen would reintroduce exactly that.

A third case keeps `aria-disabled` for a different reason: a **roving-tabindex group** where skipping
a dead end would strand arrow navigation, as in `ResultFilterSheet` (`result-filter-control.tsx`) and
the facet chips in `document-search-results.tsx`. Same encoding, same guarded click.

**The two attributes together is not belt and braces — it is the bug wearing a disguise.** The native
attribute wins on focus, so `disabled aria-disabled="true"` behaves exactly like `disabled` alone
while looking like it was thought about. `require-button-wiring` now fails on that pair
(`redundantDisabledPair`), on any `<button>` regardless of `type`; a pair where either side is
statically off (`disabled={false}` beside `aria-disabled="true"`) still passes, since that is a real
way to spell a conditional placeholder. This settles ledger `#291`, which tracked the repo pinning
the pairing two contradictory ways.

**Styling does not follow for free.** With the native attribute gone, `disabled:` variant classes
stop applying and the control becomes hoverable. Convert the variants alongside the attribute:
`disabled:` → `aria-disabled:`, and suppress hover with `hover:not-aria-disabled:` (the therapy
recipes in `therapy-compass/controls.ts` do this; `controlDisabled` in `ui-primitives.tsx` carries
both halves so anything built on `controlBase` / `floatingControl` / `toolbarButton` is already
covered). A converted control that quietly lights up on hover reads as available again.

What holds this in place: `tests/require-button-wiring.test.ts` pins that the lint rule actually
fires in both directions, and `tests/favourites-hub-unavailable-controls.dom.test.tsx` tabs onto a
converted placeholder, asserts it takes focus, asserts the accessible description is what the reader
gets, and asserts activating it by keyboard and by pointer does nothing.

**Not yet converted**, and deliberately so — the four "not available in this comparison view"
placeholders and the Compact/Detailed density pair in
`differentials/differential-presentation-workflow-page.tsx`. That page is scheduled for a rewrite, and
`tests/mobile-interaction-regressions.test.ts` still pins the density pair as native-only. Convert
them with that rewrite, not before. `document-viewer/document-image-filmstrip.tsx` and the
`DocumentViewer.tsx` summarize action are also still native (the latter mixes an auth reason with a
loading state, so it needs splitting before it can be classified).

**Read-only indicators are not controls.** The shared `ToggleSwitch` (`ui-primitives.tsx`) renders an
operable `role="switch"` only when an `onToggle` is passed; without it, it is a presentational
indicator by design — a "switch" with no handler is intentional, not a dead control.

**Never** ship a styled, `aria-label`led `<button type="button">` with no handler and no disabled
state. That was the "Language and region" globe defect (`master-search-header.tsx`, fixed 2026-07-21)
and is exactly what the ESLint gate below now catches.

## Navigation and route wiring

- **Internal navigation** uses `<Link>`, `router.push` / `router.replace`, or a server `redirect()` —
  **never** a raw `<a href="/…">` to an internal route (raw anchors bypass client routing/prefetch).
- **Build hrefs from the canonical sources**, not hardcoded strings scattered across components:
  - `src/lib/app-modes.ts` (`appModeHomeHref`) — the per-mode home URL.
  - `src/lib/tools-catalog.ts` — Tools launcher tile targets.
  - `src/lib/universal-search.ts` — universal-search result hrefs.
- **Self-contained route families** may own a local builder — e.g. Therapy Compass derives every screen
  URL from `screenHref(screen)` in `src/components/therapy-compass/bindings.tsx`. Keep new destinations
  in that builder so state stays a real URL.

## Adding a new route (checklist)

1. Create the `page.tsx`.
2. **Link it from real navigation** — sidebar, a launcher tile, a mode home, search, or a `redirect()`.
   A production page with no inbound link is an **orphan** (reachable only by typing the URL).
3. Run `npm run docs:update` to regenerate `docs/site-map.md` and refresh the generated repository
   inventory in `docs/scripts-index.md`. The pre-commit hook does this automatically for relevant
   staged changes, then stops if the generated diff still needs review/staging.
4. Document the route in `docs/codebase-index.md` (the product-pages table).
5. The reachability gate then enforces step 2 automatically (see below).

## Keyboard wiring: the PDF reader

The document viewer's page holder (`src/components/document-viewer/pdf-canvas-viewer.tsx`,
`data-testid="pdf-canvas-scroll"`) is focusable and carries the reading-mode bindings. Every one of
them is a keyboard route to a control that also exists in the `DocumentFrame` toolbar — the keyboard
is a second way to reach the same actions, never a hidden feature with no visible equivalent.

| Key                 | Action               |
| ------------------- | -------------------- |
| Left / Right arrow  | Previous / next page |
| Page Up / Page Down | Previous / next page |
| Home / End          | First / last page    |
| `+` / `=` and `-`   | Zoom in / out        |
| `0` or `F`          | Fit to width         |
| `R`                 | Rotate 90 degrees    |

Three rules hold this together and are covered by `tests/document-viewer-keyboard.dom.test.tsx`:

- **Only keystrokes aimed at the holder itself are handled** (`event.target !== event.currentTarget`
  returns early), so Enter or typing inside a child control — the retry button, the source links — is
  never hijacked.
- **Modified keystrokes are never intercepted.** Ctrl/Cmd+`0` is the browser's own zoom reset and
  Cmd+Left is history back on macOS; a viewer that ate those would be worse than one with no bindings.
- **Rotation is asked for, not owned.** `rotation` reaches the viewer as a controlled prop, so `R`
  calls the `onRotate` callback that `DocumentFrame`'s rotate button already calls. Do not give the
  viewer its own rotation state — that would be a second source of truth for one toolbar control.

The holder's `aria-label` names the bindings, so a screen-reader user hears them on focus rather than
having to discover them.

## Deriving Act sections on form pages

A form's Priority-facts grid shows either an **Act sections** card (tappable section
numbers, each opening a plain-English summary) or a **Source status** card. Which one it
shows is decided by data, never by a per-form branch in the component.

- Section summaries live once, in `data/mha-2014-sections.json`, keyed by section number.
  75 distinct sections are cited across 46 forms, several by three or four forms each; a
  summary is a property of the Act, not of a form.
- A form supplies only the citation list, as free text in
  `sourceFacts.sectionCue` (e.g. `"sections 66, 91"`). `parseSectionCue` in
  `src/lib/mha-act-sections.ts` turns that into ordered section numbers, and
  `actSectionsForCue` resolves them.
- Seven official forms have no archive row and so no cue of their own
  (`1A attachment`, `4D`, `4E`, `7C`, `10H`, `12C attachment`, `13`).
  `data/forms-act-section-cues.json` supplies their governing sections, and
  `sectionCueForForm` falls back to it. Every entry there must state a `basis` —
  the reason that section governs that form — because unlike a catalogue cue it is an
  assertion this repo makes rather than one it inherited. `check:mha-act-sections`
  rejects an entry with no basis, and one that duplicates a catalogue cue.
  **A cue is a citation, not a clinical claim, so it is never gated on review status.**
  Its `status` is provenance only. Gating it too would hide those seven forms twice over
  and leave them dark even once their Act summaries were reviewed — that regression
  shipped once and is pinned by `tests/mha-act-sections.test.ts`.
- **`actSectionsForCue` returns sections only when every cited section has a summary.**
  That is the staged-rollout gate: a form keeps its Source status card until its whole
  citation list is written, so it can never show a half-populated authority card. Do not
  weaken this to a per-section filter.
- **Three statuses, and the difference is visible to the reader.** `pending` has no
  summary and does not render. `drafted` was written from the extracted statutory text
  and renders, with "Tap a section — awaiting clinical review" on the card face and
  "Drafted from the Act text and awaiting clinical review" on the section sheet.
  Withholding drafted summaries instead was tried and reverted: it left 53 of 54 forms
  with no authority content at all, which the repository owner weighed and rejected.
  `reviewStatus` carries the distinction to the UI — never hardcode it. `reviewed` additionally names a clinician and a date in
  `reviewedBy`/`reviewedAt`, and drops that note. Never promote a `drafted` entry to
  `reviewed` without a real sign-off — the status is the only thing telling a reader
  whether a clinician has checked the summary.
- A hand-written `actSections` block in `data/forms-catalog.json` still wins, so a form
  can carry bespoke wording (Form 1A does).
- Chips are capped at `ACT_SECTION_CHIP_LIMIT` (6) with a wired `+n` overflow control;
  Form 5A cites 11 sections and would otherwise break the 2x2 grid.

**Tap-for-detail is decided by content, not by a curated-copy flag.** A Priority-facts
card becomes a button only when its sheet body differs from the card title
(`hasExtraDetail`). This replaced a gate on the form having curated `priorityFacts`,
which is why only Form 1A had working popups for months. Never reintroduce a
form-identity gate here — if a card has nothing more to say, it must stay inert rather
than promise detail it cannot deliver.

Every summary — drafted or reviewed — carries `sourceTextSha256`, pinned to the exact
statutory text it was written from. If the Act is amended and re-extracted, that hash
stops matching and `check:mha-act-sections` fails, forcing a rewrite and re-review rather
than leaving a stale clinical claim on the page. Validate with
`node scripts/build-mha-act-sections.mjs --check` (`check:mha-act-sections`, in
`verify:full`). `--refresh` is the repo's only network-fetching build mode and is
manual; never wire it into CI.

## Mockups are exempt

Design-scratch mockups — `src/app/mockups/**` (404 in production), the `*-mockups/` component
directories, and `*-mockups.tsx` singletons — have intentionally inert buttons and are not required to
be linked. Production code may not import them (`no-restricted-imports` in `eslint.config.mjs`), and
both wiring gates skip them.

## The gates

| Gate                                       | Catches                                                                                          | Runs in                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `eslint-rules/require-button-wiring.mjs`   | `<button type="button">` with no handler / disabled state; `disabled` + `aria-disabled` together | `npm run lint` → `verify:cheap`, CI                   |
| `tests/route-reachability.test.ts`         | static production page routes with no inbound nav link                                           | `npm run test` → `verify:cheap`, CI                   |
| `tests/site-map.test.ts` / `sitemap:check` | routes / nav hrefs missing from `docs/site-map.md`                                               | `npm run test`, `sitemap:check` via `verify:full`, CI |
| `npm run check:knip`                       | dead exports / orphan modules (e.g. unused href builders)                                        | `verify:full`, CI                                     |

Intentional exceptions are documented, not silenced:

- An orphan route that is deliberately unlinked (a redirect target, a legacy-compat page, or a decision
  still pending) goes in the `REACHABILITY_ALLOWLIST` in `tests/route-reachability.test.ts` **with a
  reason**, and — if it is a decision to revisit — a row in `docs/outstanding-issues.md`.
- Do not silence `require-button-wiring` with a blanket disable — wire the control, or make it an
  explicit disabled placeholder.

## Known wiring debts

Tracked in `docs/outstanding-issues.md` (`/issues`): the unused `document-flow-routes.ts` href
builders remain open. `#007` (`/tools` vs `/?mode=tools`) is resolved: `/tools` is the canonical entry
(PT-11); `/?mode=tools` remains a dashboard-mode alias.

### Closed wiring audits (2026-07-24)

- **`/api/jobs` (`#009`)** — intentional administrator/ops listing, not a client product API. Product UI
  uses `/api/ingestion/jobs`. Decision: `docs/api-jobs-ops-surface.md`. Keep the route; do not remove
  without updating API contract tests and docs together.
- **Coming-soon placeholders (`#010`)** — audited forms refine/reset + Forms tab, favourites hub
  sort/add/new-set, favourites command-library move/remove, and presentation Compact/Detailed density.
  No fake-interactive controls found; leave unwired until the underlying features land. Reference
  markup remains `favourites-hub.tsx` — which now carries `aria-disabled` + an inert handler rather
  than the native attribute, per the section above.
