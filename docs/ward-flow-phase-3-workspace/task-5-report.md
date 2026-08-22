# Task 5 report: the coordinator rewire

## Files changed

### `src/components/ward-management/coordinator/coordinator-screen.tsx`

- Dropped `movementById`/`wardMovements` (static fixture) and `NOW_ANCHOR` (fixed constant)
  imports. Added `useWardFlow()` and destructured `{ movements, rejections, now, dispatch }`.
  `units` is intentionally **not** destructured — nothing this screen renders reads live unit
  state yet (capacity only changes via `HOLD_BED`/`CONFIRM_CAPACITY`, which are not this task's
  action), and an unused destructured value would fail `@typescript-eslint/no-unused-vars`. Noted
  as a deliberate deviation from the brief's literal `const { movements, units, rejections, now,
dispatch } = useWardFlow();` line below.
- `selectedMovement` now resolves via `movements.find((m) => m.id === selectedMovementId)` — the
  live provider array — instead of `movementById`, which reads the frozen fixture and would never
  see a referral this screen just dispatched.
- `filteredMovements`/`queue` now derive from `movements` and `now` instead of `wardMovements`/`NOW_ANCHOR`.
- `actionInbox`'s `useMemo` now depends on `[movements, now]` instead of `[]` — it was safe to
  memoize once when both inputs were module-level constants; now that they're live, a referral
  dispatch or clock tick has to be able to add/remove an exception row.
- `PressureStrip`, `PriorityQueue`, `FlowDiagram`, `ShortlistPanel` all receive `now` instead of
  `NOW_ANCHOR`.
- `ShortlistPanel` gets a new `dispatch` prop (the raw `Dispatch<WardFlowEvent>` from the
  provider — the screen does not wrap or filter it).
- `ExceptionDrawer` gets a new `rejections` prop.
- The phone auto-scroll effect's `querySelector('[data-testid="ward-shortlist-confirm"]')` was
  updated to `ward-shortlist-refer` (the renamed control) — otherwise the one-tap-to-Refer phone
  behaviour Task 8 built would have silently stopped scrolling to anything.

### `src/components/ward-management/coordinator/shortlist-panel.tsx`

- New required prop `dispatch: Dispatch<WardFlowEvent>`.
- New local state `referTargets: string[]` — the explicit, capped-at-`PARALLEL_REFERRAL_CAP`
  multi-select set a coordinator builds by clicking candidate rows. It is a **separate** truth
  from `selectedUnitId`/`onSelectUnit` (the prop pair shared with `FlowDiagram`, unchanged in
  shape): `selectedUnitId` stays single-valued and drives which one candidate's gates are shown
  and which diagram node is highlighted; `referTargets` is the multi-select that Refer/Override
  act on. A candidate-row click now does both — calls `onSelectUnit(id)` (unchanged) and toggles
  membership in `referTargets` (new) — so the existing single-click-then-confirm tests still work
  unmodified in spirit: selecting one candidate makes both the gate list AND the referral
  selection point at it.
- `referTargets` resets alongside the existing `confirmation`/`overrideOpen`/`overrideReason`
  reset-on-movement-change block, so a selection made for one patient can never leak onto the
  next.
- `canRefer = referTargets.length > 0 && every selected candidate is eligible`. `canOverride =
referTargets.length > 0` (no eligibility requirement — overriding into an ineligible ward with a
  stated reason is exactly the escape hatch it exists for). This mirrors the old
  `canConfirm`/`canOverride` shape exactly, generalised from one unit to a set.
- `handleRefer()` dispatches `{ type: "REFER_TO_UNITS", role: "coordinator", now, movementId,
unitIds: [...referTargets] }` — a real event through the reducer, not a local-only UI note.
  `handleOverrideSubmit` dispatches the **same** event (per the brief: "Override ... dispatches
  the same event with the reason recorded") and additionally records the typed reason in local
  component state, because `REFER_TO_UNITS` has no reason field on the model — there is nowhere
  else in shared state for an override reason to live. `movementId` is captured as a plain
  `const movementId = movement.id;` right after the `if (!movement) return` guard, because
  TypeScript's narrowing of `movement` does not persist into the `handleRefer`/
  `handleOverrideSubmit` closures defined further down (a real `tsc` error, not a style choice —
  see "Ambiguities" below).
- **Testid/label rename** (per the correction in this task's brief, not the brief's own
  step-4 prose): `data-testid="ward-shortlist-confirm"` → `ward-shortlist-refer`, label `"Confirm
placement"` → `"Refer"`. `aria-describedby`/`id` pair renamed to
  `ward-shortlist-refer-unavailable` to match. Candidate-row testids
  (`ward-shortlist-candidate-<unit id>`) are unchanged, as required.
- `aria-pressed` on each candidate row now reads `referTargets.includes(candidate.unit.id)`
  (multi-select truth) instead of `selectedUnitId === candidate.unit.id`.
- Replaced every `isMoreRestrictiveThanRequired`/`MORE_RESTRICTIVE_NOTE` use in this file with
  `restrictionNotice(movement, unit)` from `ward-derivations.ts` (candidate rows, the suggested-
  destination badge, and the note above the gate list). The voluntary-on-locked level renders with
  a distinct, danger-toned class (`...Prominent` variants, new CSS) so it reads more prominently
  than the plain over-restrictive level, per the brief — both still carry the distinction in real
  text, never colour alone. `isMoreRestrictiveThanRequired`/`MORE_RESTRICTIVE_NOTE` themselves are
  **not** removed from `ward-derivations.ts` — `flow-diagram.tsx` (out of this task's file list)
  still imports and uses them unchanged.
- "Outstanding referral: {unit.name}" badges renamed to "Parallel referral: {unit.name}" (and the
  unresolved-unit fallback text to match) — this is the shortlist's own live `referredUnitIds`
  rendering, which is what actually lights up after a real `REFER_TO_UNITS` dispatch. The
  equivalent text in `flow-diagram.tsx` is untouched and still reads "Outstanding referral" — that
  component is out of this task's file list.
- The on-screen acknowledgement of the last decision is now `ReferralRecord` (renamed from
  `Confirmation`), rendering "Referred by a human coordinator to `<names>` at `<time>`. Up to 3
  parallel referrals allowed; no bed has been allocated automatically." for a plain Refer, or
  "Overridden by a human coordinator — referred to `<names>` at `<time>` — reason: `"<reason>"`.
  No bed was allocated automatically." for Override (this string is unchanged from before, so
  every existing "Overridden by a human coordinator" assertion needed no edit).
- Auto-allocation footer note now reads "...up to 3 parallel referrals at once" so the phrase
  `/parallel referral/i` the new Playwright test checks for is stated even before any action is
  taken, not only inside the post-Refer record.

### `src/components/ward-management/coordinator/exception-drawer.tsx`

- New required prop `rejections: Rejection[]`.
- Added a "Refused actions" subsection inside the existing `<section aria-label="Exceptions">`,
  rendered **even when `rejections` is empty** ("No refused actions recorded yet." — the word
  "refused" alone satisfies the brief's `/refus/i` regex, and it means the region tells a
  coordinator where to look before the first refusal ever happens rather than only appearing after
  one). Rows render newest-first (`[...rejections].reverse()` — the reducer appends to the array
  in raise order) and show `rejection.attempted`, `.reason`, and `formatInstant(.at)`.

### `src/components/ward-management/ward-derivations.ts`

- Added `RestrictionNotice` type and `restrictionNotice(movement, unit)` — copied verbatim from
  the brief's Step 3 code block (text: `"Voluntary patient on a locked ward — review legal status
before admission"` for `voluntary_on_locked`, `"More restrictive than this movement requires"`
  for `more_restrictive`). `ward-eligibility.ts` untouched, per the brief.
- Changed `eligibleCandidates`' internal sort to a **two-pass** approach instead of one combined
  comparator:
  1. Eligible-first cut, `.slice(0, limit)` — **identical to the old behaviour**, so the returned
     SET of candidates is unchanged.
  2. A second stable sort over that fixed slice, ranking a security-matching candidate ahead of a
     `restrictionNotice`-flagged one (still eligible-first as the primary key within this pass, so
     it can never move an ineligible candidate above an eligible one).

  I did not ship the brief's literal one-pass version (eligible-first, then-restriction, THEN
  truncate) — see "Ambiguities" below for why.

### `tests/ward-restriction-notice.test.ts` (new)

Created verbatim from the brief's Step 3 test block. `npx vitest run
tests/ward-restriction-notice.test.ts` → 4 passed.

### `tests/ui-ward-coordinator.spec.ts`

- Appended the brief's two new tests verbatim (with the brief's own correction already applied:
  `ward-shortlist-candidate-` selector, not `ward-candidate-`).
- Updated every pre-existing assertion that named the old Confirm control or its text, so the 21
  pre-Task-5 journeys still pass against the renamed/rewired screen:
  - `ward-shortlist-confirm` → `ward-shortlist-refer` (phone-viewport test; the
    "never confirms..." test, renamed to "never refers or overrides...").
  - `getByRole("button", { name: /Confirm/ })` → `/Refer/`.
  - `"Confirmed by a human coordinator"` → `"Referred by a human coordinator"` (all sites).
  - `"Choose a candidate unit before confirming/overriding"` → `"Choose at least one candidate
ward before referring/overriding"`.
  - `"Outstanding referral: BTY Adult Secure"` (in the shortlist, not the diagram) →
    `"Parallel referral: BTY Adult Secure"`.
  - `"More restrictive than required"` (shortlist-row assertions only, not the diagram-node
    assertions, which still read the old `MORE_RESTRICTIVE_NOTE` text since `flow-diagram.tsx` is
    unchanged) → `"More restrictive than this movement requires"`.

## Test output

**Vitest** (offline, focused + full ward suite):

```
npx vitest run tests/ward-derivations.test.ts tests/ward-restriction-notice.test.ts tests/ward-eligibility.test.ts tests/ward-flow-contracts.test.ts tests/ward-flow-reducer.test.ts tests/ward-priority.test.ts
 Test Files  6 passed (6)
      Tests  60 passed (60)
```

```
npx vitest run tests/ward-capacity-reconciliation.test.ts tests/ward-clock.test.ts tests/ward-derivations.test.ts tests/ward-eligibility.test.ts tests/ward-flow-contracts.test.ts tests/ward-flow-reducer.test.ts tests/ward-management.test.ts tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-output.test.ts tests/ward-pressure.test.ts tests/ward-priority.test.ts tests/ward-restriction-notice.test.ts
 Test Files  13 passed (13)
      Tests  165 passed (165)
```

**TDD red proof** (per the brief's Step 1/2): stashed only the five `src/` changes (kept the new
test block in `tests/ui-ward-coordinator.spec.ts`) and ran the two new tests against the
pre-Task-5 screen:

```
2 failed
  › refers a patient to up to three wards and records what it did
    Error: element(s) not found — getByRole('button', { name: /Refer/ }) — the control did not exist yet.
  › shows a refused transition instead of swallowing it
    Received string: "Legal timing breachedWF-001 ... Ward nurse in charge" — no "refus" anywhere in the Exceptions region.
```

Restored the stash and re-ran the same two tests — both green. This is genuine red-then-green,
not a retrofit: the failures above are exactly "the control doesn't exist" and "the text isn't
there", the right reasons.

**`npx tsc --noEmit -p tsconfig.json`**: no output (clean) after every edit, including after the
prettier reformat pass.

**`npm run lint`**: `ESLint found too many warnings (maximum: 0)` — but the two warnings reported
(`ward-flow-reducer.ts:1:15 'Instant' is defined but never used`, `ward-flow-reducer.test.ts:5:45
'PARALLEL_REFERRAL_CAP' is defined but never used`) are in files this task never touched. I
confirmed this is pre-existing repo debt, not something this task introduced or is responsible
for fixing: `git stash`-ed the entire Task 5 diff, re-ran `npm run lint` against the clean
`9ae334230` HEAD, and got the identical two warnings. Restored the stash afterward (`git stash
pop`, confirmed all five files came back). `npm run lint` failing on `--max-warnings 0` is
therefore an existing condition of this branch, unrelated to this diff.

**`npm run check:design-system-contract`**: passed — `Design-system contract passed (768
production files; raw colors 2; ...)`. All new CSS classes (`shortlistRestrictiveBadgeProminent`,
`shortlistRestrictiveNoteProminent`, `shortlistCandidateRestrictiveProminent`,
`.refusalsSection`/`.refusalsHeading`/`.refusalsList`/`.refusalRow`/`.refusalAttempt`/
`.refusalReason`/`.refusalAt`) use only existing `var(--co-space-*)` / semantic color tokens
already declared in `.screen`'s root block — no new raw literals.

**Playwright** (`PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test
tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line`),
run twice — once right after the fix, once again after the `npx prettier --write` pass, to prove
formatting didn't silently change behaviour:

```
Running 23 tests using 1 worker
...
  23 passed (50.1s)
```

23 = the 21 pre-existing journeys (18 in `ui-ward-coordinator.spec.ts`, 5 in
`ui-ward-management.spec.ts` — 23 total files minus the 2 new ones) + the 2 new Task 5 tests, all
green.

**One real regression found and fixed mid-task**: the first full-suite run (before the
`eligibleCandidates` two-pass fix) showed 6 failures, not the 2 I expected. Five were mechanical
(old Confirm testids/text — fixed by updating the test file, see above). The sixth,
`ui-ward-management.spec.ts`'s "routes a selected movement across the network diagram and
explains the shortlist", failed for a real reason: my first (single-pass) implementation of the
restrictiveness sort reordered `eligibleCandidates` **before** truncating to the top 3, which
could change which 3 units make the cut, not just their order. For WF-001 that pushed "RPH Adult
Secure" (a locked ward) out of the visible top-3, and `/ward-management/network` — a second,
untouched consumer of the same shared `eligibleCandidates` derivation — hard-codes that unit as
one of WF-001's three eligible candidates. I re-designed the function to slice first (fixing
membership) and reorder only within that fixed set (see "Files changed" above), which fixed the
failure without touching `ui-ward-management.spec.ts` or narrowing the ordering rule the brief
asked for.

## What I saw in the browser

The interactive Browser-pane tool in this session reported `document.hidden === true` /
`document.visibilityState === "hidden"` on every tab, and `computer{action:"screenshot"}`
consistently failed with "the Browser pane is not displayed, so the page is not compositing
frames" — a session-level limitation (Chrome skips layout for backgrounded tabs; every element's
`getBoundingClientRect()` came back all-zero, even for controls untouched by this task like the
Exceptions toggle), not something fixable from more tool calls. Rather than fake a screenshot or
skip the visual check, I wrote a small throwaway script
(`node scripts/tmp-capture-phase3-coordinator.mjs`, deleted after use — not part of the diff)
that drove a real headless Chromium instance via the `playwright` package already in
`node_modules`, at 1600×1100: selected WF-017 from the queue, clicked two candidate rows (RPH
Adult Secure, then FSH Adult Secure), clicked Refer, and screenshotted to
`artifacts/ward-management/phase3-coordinator-live.png` (gitignored, matching every prior phase
screenshot in that directory).

I then actually looked at the PNG (`Read` tool, image content). What it shows:

- The priority-queue row for WF-017 is visually selected.
- The **diagram** (untouched this task) now reads "Statewide flow hub: WF-017 — outstanding
  referrals: RPH Adult Secure, FSH Adult Secure; 1 other candidate shown", and the RPH Adult
  Secure node carries an "Outstanding referral" badge — this is `movement.referredUnitIds`
  flowing through the shared `movements` array from the reducer, proving the dispatch really did
  change shared state that a second, independent component (`FlowDiagram`) picked up, not just
  something local to `ShortlistPanel`.
- The shortlist footer shows the green confirmation record: "Referred by a human coordinator to
  RPH Adult Secure, FSH Adult Secure at 10:42. Up to 3 parallel referrals allowed; no bed has been
  allocated automatically." — no "Confirm placement" text anywhere on the page.
- Nowhere on the screen claims a bed was allocated or a placement made — every visible string says
  "referred"/"parallel referral"/"no automatic allocation", matching the governing rule.

This satisfies the brief's "confirm that referring a patient visibly changes the screen" — via a
real render, not a DOM-state assertion alone — even though the interactive click-driven walkthrough
the brief describes wasn't possible through this session's Browser-pane tool.

## Next-Node-docs read

None needed for this task: no new server/client boundary was introduced (the file already carried
`"use client"` and already sat inside `WardFlowProvider`'s existing client boundary from Task 4;
`ExceptionDrawer` and `ShortlistPanel` were already `"use client"` too). I did re-confirm via
`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
("Context providers") that nothing about adding a new prop to an already-client component crosses
a boundary — it doesn't.

## Ambiguities and how I resolved them

1. **The brief's "Refer to selected wards" label text vs. the correction's "Refer".** The
   correction block explicitly states the target is `data-testid="ward-shortlist-refer" labelled
Refer`, while the brief's own Step 4 prose separately says the label becomes "Refer to selected
   wards". Since the correction is explicitly flagged as authoritative ("ruled on before execution
   began... apply") and pins the literal value, I used exactly `"Refer"` as the button's visible
   text (still matches the new test's `getByRole("button", { name: /Refer/ })` and `not
.toContainText(/Confirm placement/)` either way).

2. **`restrictionNotice`'s `more_restrictive` text vs. the pre-existing `MORE_RESTRICTIVE_NOTE`
   constant.** The brief's Step 3 code (marked "exact values to use verbatim") gives
   `"More restrictive than this movement requires"`, which is a different string from the
   existing `MORE_RESTRICTIVE_NOTE` ("More restrictive than required — a locked ward for an
   open-status movement") that pre-existing Playwright assertions checked via
   `.toContainText("More restrictive than required")` — not a substring of the new text. I used
   the brief's verbatim text (per "with the exact values to use verbatim") and updated the
   pre-existing shortlist-row assertions accordingly; the diagram-node assertions in the same test
   were left checking the OLD text, since `flow-diagram.tsx` (out of this task's file list) is
   genuinely unchanged and still uses `MORE_RESTRICTIVE_NOTE`.

3. **"Render `restrictionNotice` ... on every routed diagram node."** The brief's step-4 prose
   says this, but `flow-diagram.tsx` is not in the task's Files list (only
   `coordinator-screen.tsx`, `shortlist-panel.tsx`, `exception-drawer.tsx`, `ward-derivations.ts`
   are listed as Modify targets). I treated the explicit Files list as the scope boundary and left
   `flow-diagram.tsx` untouched — it still renders the older `isMoreRestrictiveThanRequired`/
   `MORE_RESTRICTIVE_NOTE` pairing, which I kept exported from `ward-derivations.ts` unchanged for
   exactly this reason. This is a real, acknowledged gap versus the brief's prose (not the file
   list): the diagram does not yet distinguish voluntary-on-locked from plain over-restrictive.

4. **Whether Refer requires all selected candidates to be eligible.** The brief doesn't state this
   explicitly for the new multi-select Refer, only that "the existing explicit-selection guard
   stays". I preserved the OLD `canConfirm` semantics (`hasExplicitSelection &&
activeVerdict?.eligible === true`), generalised to "every selected unit is eligible", with
   Override remaining the no-eligibility-required escape hatch — this keeps Override meaningfully
   different from Refer (otherwise Override would have no reason to exist) and keeps every
   pre-existing WF-009-uses-Override / WF-017-uses-Refer test scenario intact.

5. **`eligibleCandidates`'s ordering change reordering vs. reshuffling membership** — covered
   above under "Test output"; resolved by truncating on eligibility first, reordering by
   restrictiveness only within the fixed top-`limit` slice.

## For each test, the one-line mutation that would kill it

- **"refers a patient to up to three wards..."** — delete the `dispatch({ type: "REFER_TO_UNITS",
... })` call in `handleRefer` (or revert `referredUnitIds` badge text from "Parallel referral"
  back to anything without "referral").
- **"shows a refused transition instead of swallowing it"** — remove the `rejections` prop/section
  from `exception-drawer.tsx` (or revert the empty-state text to drop the word "refused").
- **"keeps exceptions one tap away..." (phone Refer-in-viewport assertion)** — revert the
  `querySelector` in the auto-scroll effect back to `ward-shortlist-confirm` (the renamed testid no
  longer exists, so nothing scrolls into view and the test's `toBeInViewport()` fails).
- **"states plainly when a candidate ward is more restrictive..."** — change `restrictionNotice`'s
  `more_restrictive` branch to return `undefined` instead of the notice (or delete the `notice`
  render in the candidate row).
- **"shows a failing gate as a failure and never auto-allocates"** — change `canRefer` to ignore
  `allSelectedEligible` (e.g. `const canRefer = hasReferSelection;`) — WF-009's ineligible default
  would then leave Refer enabled with no selection, and the "unavailable" assertion goes red.
- **"never refers or overrides against a default candidate..."** — change `canRefer`'s guard from
  `referTargets.length > 0` back to `activeUnit !== undefined` — WF-017's default candidate (shown
  for orientation but never clicked) would make Refer available with nothing selected.
- **"keeps failing gates ordered before passing gates" / "renders every recorded decline..."** —
  unaffected by this task (Task 7 concerns); a mutation there would be in `shortlist-panel.tsx`'s
  `sortedGates`/`movement.declines.map` — outside this task's actual change, so not re-derived
  here.
- **"never labels an ineligible candidate as the suggested destination"** — revert "Parallel
  referral: {name}" back to any text without "Parallel referral" (breaks the WF-017 assertion) or
  change `hasRecordedReferral`'s condition so a real `referredUnitIds` entry stops suppressing the
  "Suggested destination" badge.
- **"the override path is a real, reason-gated confirmation path"** — change `handleOverrideSubmit`
  to skip the `reason.trim().length === 0` guard — an empty-reason submission would then record an
  "Overridden by a human coordinator" entry the test asserts must not appear.
- **`ward-restriction-notice.test.ts` (4 cases)** — swap the `if` order in `restrictionNotice` so
  `movement.security === "Open"` is checked before `movement.legalStatus === "Voluntary"` — the
  "prefers the voluntary warning when both would apply" case would then report
  `"more_restrictive"` instead of `"voluntary_on_locked"`.
- **"routes a selected movement across the network diagram..."** (pre-existing, in
  `ui-ward-management.spec.ts`) — revert `eligibleCandidates` to the single-pass sort (reorder
  before truncate) — this is the exact regression I found and fixed mid-task, and reintroducing it
  pushes RPH Adult Secure out of WF-001's visible top-3 again.

## Fix round 1

Three findings from review, addressed on top of the original Task 5 commit (`4d36099ca`).

### Finding 1 — the screen claimed a referral succeeded when the reducer refused it

**Root cause.** `REFER_TO_UNITS` only mutates `referredUnitIds` for a movement at
`placement_requested` or `destination_review` (`ward-flow-reducer.ts`). Nine of the eighteen
hand-authored fixture movements sit outside that (e.g. `bed_held`) while still open and still
offering an eligible-shaped shortlist. `handleRefer`/`handleOverrideSubmit` dispatched and then
unconditionally called `setConfirmation(...)`, so the shortlist showed "Referred by a human
coordinator... no bed has been allocated automatically" regardless of what the reducer actually
did with the event.

**Fix, three parts:**

1. **Stop advertising an action that cannot be performed.** Added `REFERRABLE_MOVEMENT_STAGES`
   as a named, exported constant in `ward-flow-reducer.ts`
   (`["placement_requested", "destination_review"]`) and pointed the reducer's own
   `REFER_TO_UNITS` stage check at it, so there is exactly one place this list can drift. Added
   `referralBlockedReason(movement)` to `ward-derivations.ts`, built on that same constant, which
   returns `undefined` when a movement is referable and otherwise a message naming the movement's
   own real stage via the existing `stageCopy` map (e.g. "WF-004 cannot be referred while it is
   bed held — referral is only available while placement is requested or a destination is under
   review."). `canRefer` in `shortlist-panel.tsx` now folds this in:
   `hasReferSelection && allSelectedEligible && referralBlocked === undefined`. The Refer button
   renders `aria-disabled="true"` + the inert `ignoreUnavailableActivation` handler + `title` +
   an `sr-only` note wired via `aria-describedby` whenever `referralBlocked` is set — the repo's
   standard unavailable-control pattern, never native `disabled`, never both attributes together.

2. **Override is deliberately NOT stage-gated.** `canOverride` still only requires
   `hasReferSelection` — it is the "a human decided to try anyway, with a stated reason" escape
   hatch, for an ineligible candidate (its original purpose) and now, structurally, for a
   non-referable stage too. This was a considered choice, not an oversight: the brief's fix
   instructions say "Fold stage referability into `canRefer`" — singular, naming only the Refer
   guard — and Finding 3 explicitly wants a real, reachable way to raise a genuine refusal for the
   new test, which a fully-blocked Override could not provide. This is safe only because of Part 3
   below.

3. **The referral record is derived from state, never an optimistic local flag — this is the
   actual mechanism that makes Part 2's "Override isn't stage-gated" choice safe.** Refer no
   longer sets any local "it worked" flag at all: `handleRefer` only dispatches, and the
   pre-existing "Parallel referral: {unit.name}" badges (already rendered straight from
   `movement.referredUnitIds`, sourced from the live provider) are the only success indicator.
   Override still needs _some_ local state, because the typed reason has nowhere else to live —
   `REFER_TO_UNITS` carries no reason field on the model — but its success message is gated by a
   derived `overrideSucceeded` check computed fresh on every render:
   `overrideRecord.unitIds.every((id) => movement.referredUnitIds.includes(id))`. If the reducer
   refuses the dispatch (stage-blocked or any other reason), `movement.referredUnitIds` is
   untouched, every id is missing from it, `overrideSucceeded` is `false`, and the "Overridden by
   a human coordinator..." message never renders. **Why this cannot lie:** the only local state
   kept (`overrideRecord`) holds inert data — the unit ids requested and the typed reason text —
   never a boolean "succeeded" flag set at click time. Whether it is _displayed_ is decided by
   reading the movement's own post-dispatch field on every render, not by anything written when
   the button was clicked. A stale `overrideRecord` from an earlier, now-irrelevant attempt is
   also structurally harmless for the same reason: it can only ever render if the CURRENT
   `movement.referredUnitIds` still contains all of its ids.

4. **The refusal itself is visible.** No new work was needed here — `exception-drawer.tsx`'s
   refusals section (already built in the original Task 5 commit) renders `rejections` with
   `rejection.attempted` (the event type, e.g. `REFER_TO_UNITS`) and `rejection.reason` (the
   reducer's exact rejection text, e.g. `cannot refer a movement while it is bed_held`) as real
   text, present even when empty. Since Override can still dispatch on a non-referable movement,
   a refused Override now produces a real row there.

**New/changed Playwright tests** (`tests/ui-ward-coordinator.spec.ts`):

- `never claims a referral succeeded on a non-referable movement` (new): selects WF-004 (stage
  `bed_held`, confirmed via `expect(wf004.stage).toBe("bed_held")`), selects its default
  candidate, asserts Refer is `aria-disabled="true"` with a `title` matching `/bed held/i`, force-
  clicks it, and asserts neither "Parallel referral" nor "Referred by a human coordinator" appear.
- `shows a refused transition instead of swallowing it` (rewritten — see Finding 3 below): now
  raises a genuine refusal via Override on WF-004, asserts the override never claims success, then
  asserts the Exceptions region contains the literal event type `REFER_TO_UNITS` and the reducer's
  own reason text `cannot refer a movement while it is bed_held`.
- Two pre-existing positive assertions (`shows a failing gate as a failure and never
auto-allocates`, `never refers or overrides against a default candidate the coordinator did not
choose`) that checked for the now-deleted `"Referred by a human coordinator"` text were updated
  to check for `"Parallel referral: {unit name}"` instead — the real, state-derived indicator.

**Red-then-green proof, pasted verbatim.** Reverted `canRefer` to
`hasReferSelection && allSelectedEligible` (dropping the `referralBlocked === undefined` term)
and ran the new test alone:

```
PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts -g "never claims a referral succeeded" --project=chromium --reporter=line

Error: expect(locator).toHaveAttribute(expected) failed
Locator:  getByRole('complementary', { name: 'Explainable shortlist' }).getByRole('button', { name: /Refer/ })
Expected: "true"
Received: ""
  968 |     await expect(refer).toHaveAttribute("aria-disabled", "true");
       |                         ^
  1 failed
```

Restored the guard, re-ran the same test alone — green — then re-ran the full pair (`never claims
a referral succeeded on a non-referable movement` + `shows a refused transition instead of
swallowing it`) — 2 passed.

### Finding 2 — the `eligibleCandidates` regression had no direct test

Added `tests/ward-derivations.test.ts`'s new `describe("eligibleCandidates", ...)` block: for
every real fixture movement whose cohort has more candidates than `PARALLEL_REFERRAL_CAP`, the
membership of `eligibleCandidates(movement, NOW_ANCHOR, CAP)` (as a `Set` of unit ids) must equal
an independently-computed "eligible-first, then truncate" reference set — reimplemented directly
against `allUnits()`/`eligibility()`, never by calling `eligibleCandidates(..., Infinity)` (an
earlier draft did this and the oracle turned out to be circular — see the code comment in the
test for why). The test also tracks whether at least one movement's cut genuinely mixes a
restricted and an unrestricted candidate, so it cannot pass by only ever exercising the
truncation half of the invariant.

**Red-then-green proof, pasted verbatim.** Reverted `eligibleCandidates` to the original one-pass
version (reorder-then-truncate, the exact regression this fix originally repaired) and ran:

```
npx vitest run tests/ward-derivations.test.ts

FAIL  |node| tests/ward-derivations.test.ts > eligibleCandidates > reorders by restrictiveness within the eligible-first cut without ever changing which candidates are in it
AssertionError: WF-001: top-3 membership must match the eligible-first cut: expected Set{ 'scgh-adult-open', …(2) } to deeply equal Set{ 'rph-adult-secure', …(2) }
- Expected
+ Received
  Set {
-   "fsh-adult-secure",
-   "rph-adult-secure",
+   "arm-adult-open",
    "scgh-adult-open",
+   "sjgm-adult-open",
  }
  1 failed | 5 passed (6)
```

Restored the two-pass version, re-ran — 6 passed. (While restoring, `cp` from a Windows temp
backup silently reintroduced CRLF line endings into the file — caught by `git diff --stat`'s CRLF
warning, not by any test — and had to be re-normalized to LF with a direct byte-level rewrite.
Every file touched in this fix round was checked and normalized the same way before the final
commit; see the "CRLF trap" note below.)

### Finding 3 — the refusal test passed vacuously

The original test opened Exceptions with zero rejections ever raised in that session and asserted
`/refus/i`, which is present in the empty-state placeholder copy itself ("No refused actions
recorded yet."). It could only ever catch the whole region disappearing. Rewrote it (see Finding
1's test list above) to raise a real refusal first — WF-004 via Override, since Refer is now
preemptively blocked there — and assert the refusal's own specific content: the literal event
type `REFER_TO_UNITS` and the reducer's own reason text `cannot refer a movement while it is
bed_held`, not merely the substring "refus".

### Verification run for this fix round

```
npx vitest run tests/ward-capacity-reconciliation.test.ts tests/ward-clock.test.ts tests/ward-derivations.test.ts tests/ward-eligibility.test.ts tests/ward-flow-contracts.test.ts tests/ward-flow-reducer.test.ts tests/ward-management.test.ts tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-output.test.ts tests/ward-pressure.test.ts tests/ward-priority.test.ts tests/ward-restriction-notice.test.ts
 Test Files  13 passed (13)
      Tests  166 passed (166)
```

```
npx tsc --noEmit -p tsconfig.json
(no output — clean; nothing in .next/dev/types/ this round)
```

```
npm run lint
Exit: ESLint found too many warnings (maximum: 0) — but the two warnings reported are the same
two pre-existing, unrelated warnings from the original Task 5 report (ward-flow-reducer.ts /
an unused-var in ward-flow-reducer.test.ts), confirmed unchanged by this fix round
```

```
npm run check:design-system-contract
Design-system contract passed (768 production files; ...)
```

Full browser gate, run three times as the fixes landed (the middle run caught a real bug I
introduced myself — see below):

```
PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
  24 passed (1.7m)   ← final run
```

24 = the 23 from the original Task 5 report, minus the one vacuous test rewritten in place, plus
the one new Finding-1 test = net +1.

**One self-inflicted regression caught mid-fix.** My first pass at strengthening the pre-existing
"refers a patient..." test added `await expect(shortlist).not.toContainText("Parallel referral")`
before WF-017's own Refer click — but WF-017 already carries a pre-existing "Parallel referral:
BTY Adult Secure" badge from its seed fixture data (the same fact several other pre-existing tests
already rely on), so that blanket assertion was wrong and failed immediately. Fixed by narrowing
it to the specific new referral (`not.toContainText("Parallel referral: RPH Adult Secure")`),
which is both correct against the fixture and a stronger, more specific proof than the blanket
version would have been anyway.

**CRLF trap.** Several of this round's edits were made with Python's default text-mode file
writes, which on this Windows environment silently convert every `\n` to `\r\n` — `.gitattributes`
enforces LF, and `git diff --stat` surfaces this as a "CRLF will be replaced by LF" warning, not
as a test failure. Caught and fixed by a direct binary-mode rewrite (`data.replace(b"\r\n", b"\n")`)
on every touched file before the final commit; confirmed clean via `git diff --stat` showing no
CRLF warnings immediately before committing.

### What I saw when clicking Refer on a non-referable movement, before and after

Selected WF-004 (stage `bed_held`, accepted destination BTY Adult Secure, still open, still
offering RPH/FSH/RGH Adult Secure as eligible-shaped candidates) and selected RPH Adult Secure as
a candidate.

**Before this fix round:** Refer was enabled once a candidate was selected. Clicking it dispatched
`REFER_TO_UNITS`, which the reducer silently refused (WF-004 is not in
`REFERRABLE_MOVEMENT_STAGES`) — and the shortlist footer showed "Referred by a human coordinator
to RPH Adult Secure at [time]. Up to 3 parallel referrals allowed; no bed has been allocated
automatically." directly underneath the diagram's own, still-correct "Accepted destination: BTY
Adult Secure" badge. Two contradictory destination claims on one screen, and the second one
described an event that had not happened.

**After this fix round**, checked directly against the running app
(`PLAYWRIGHT_BASE_URL=http://localhost:3718`, headless Chromium via the `playwright` package —
the interactive Browser-pane tool remained non-functional in this session, same as the original
Task 5 report):

```
aria-disabled: true
title: WF-004 cannot be referred while it is bed held — referral is only available while placement is requested or a destination is under review.
text before click contains "Parallel referral": false
text after forced click contains "Parallel referral": false
text after forced click contains "Referred by a human coordinator": false
```

The Refer button is disabled the moment WF-004 is selected — before any candidate click even
matters — with a title naming the real stage. A forced click (bypassing the `aria-disabled`
actionability guard, the stronger proof the handler itself is inert) changes nothing on screen.
The diagram's "Accepted destination: BTY Adult Secure" and the Exceptions count (8, unchanged) are
identical before and after. Screenshots saved to
`artifacts/ward-management/phase3-fix-round-1-before.png` and `...-after.png` (gitignored, not
part of the diff).
