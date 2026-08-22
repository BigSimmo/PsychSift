# Task 9 report — the transport officer's phone

Worktree: `C:\Users\joshs\.codex\worktrees\ward-management-design\Database`, branch
`codex/ward-management-design`. Started clean at `171adb69a`. No branch created, no push, no PR.

## What was built

- `src/components/ward-management/officer/officer-screen.tsx` — `OfficerScreen`.
- `src/components/ward-management/officer/officer.module.css` — its styles, local tokens on
  `.screen` per the file convention `ward.module.css` documents.
- `src/app/ward-management/transport/officer/page.tsx` — the route.
- `src/components/ward-management/ward-sites.ts` — added `edById`, matching `unitById`'s shape
  (the Task 9-12 preflight's "no `edById`" note said this was preferable to an inline `.find()`).
- `src/components/ward-management/ward-management-navigation.tsx` — one raw `<Link>` in
  `ClinicalRail`'s bottom section, labelled "Officer" (see "Two defects found and fixed" below).
- `docs/design-system/adoption-contract.json` — route + root added, then
  `npm run design-system:adoption:update` regenerated `ADOPTION.md` and
  `adoption-manifest.json` (54 components, 77 roots).
- `docs/site-map.md` — regenerated via `npm run docs:update`; confirmed the new route line.
- `docs/codebase-index.md` — one paragraph describing the new surface, in the existing Ward Flow
  section.
- `tests/ui-ward-roles.spec.ts` — appended two tests (see "Tests" below). Confirmed this file was
  already covered by both Playwright `testMatch` regexes in `playwright.config.ts` (the
  `ward-(?:management|coordinator|roles)` alternation appears in both the line-26 and line-34
  patterns) — no config change needed.

## Design decision: a selected job, not eight simultaneous pinned bars

The brief's own test scopes `job.getByRole("button")` to a single `[data-testid^="ward-officer-job-"]`
element and expects exactly 4. The preflight says this screen inherits Task 7's pinned-bar
pattern literally — the same `position: fixed` mechanism `shortlist-panel.tsx`'s
`.shortlistActionRow` uses for whichever movement is currently selected on the coordinator
screen. Eight simultaneously-fixed action bars for eight jobs would physically overlap at the
viewport's bottom edge, so I built a coordinator-style selection model: every not-yet-arrived job
renders as its own card (patient id, origin department, destination unit, legal form required,
escort required — all five fields, always, for every job, satisfying "shows every job"), and
exactly one job is "active" at a time. The active card's own testid element contains its four
action buttons, pinned to the viewport bottom via the inherited CSS technique, and nothing else.
Every other card ends in a single "Work this job" button instead, which lives inside that OTHER
job's own testid element — never inside the active one — so it can never inflate the tested
card's button count. Default selection is the first job in `movements` array order (which is
WF-005 at seed, matching the preflight's own suggested pin), falling back the same way if the
selected job leaves the list (arrives) — the same "orientation only" default
`shortlist-panel.tsx`'s own `shortlist[0]?.unit` comment documents; every dispatch reads
`selectedJob.id` off the live, freshly-filtered array, never a stale closure.

## The "exactly four buttons" assertion — scoped to the card, and why that was safe

I kept the brief's literal `job.getByRole("button")` scoped to the whole card (not narrowed to a
sub-"actions group"), because the active card contains **only** the five info fields (a `<dl>`,
no buttons) and the four action buttons — no expander, no link, no dismiss. The count check is
therefore equivalent whether scoped to the card or a narrower wrapper; I did not need the
narrower scoping the brief allowed for.

## Two defects found and fixed before the gates were clean

**1. `RailLink`-wrapped hrefs are invisible to `tests/route-reachability.test.ts`'s AST scan.**
I first wrote the rail entry through the existing `RailLink` helper, matching Task 8's ward link
verbatim. `route-reachability.test.ts` only registers a JSX element literally named `Link`
(imported from `next/link`) whose _own_ `href` attribute is a string literal — `RailLink` passes
`href` through as a destructured prop, so the scanner sees `<Link href={href}>` where `href` is a
plain `Identifier`, not a literal, and never registers it. Task 8's `/ward-management/ward/[unitId]`
link happens to have never needed this: it's a **dynamic** route (`[unitId]`), and the scanner's
own scope comment says dynamic detail routes are exempt entirely. `/ward-management/transport/officer`
is static, so it is in scope, and the orphan-route test failed exactly as its own message
describes. Fixed by writing a raw `<Link href="/ward-management/transport/officer" ...>` instead
of `RailLink`, mirroring the eight `WardModeNavigation` links' own literal-`<Link>` convention.
Confirmed: `npx vitest run tests/route-reachability.test.ts` — 5 passed (5) before, 1 failed after
the RailLink version, 5 passed (5) again after the fix.

**2. The rail label "Transport officer" broke an existing Task 8 test by substring collision.**
Playwright's default accessible-name matching is a substring match, not exact. The eight-mode
strip already has a "Transport" link (the live tracker, `/ward-management/transport`).
`tests/ui-ward-management.spec.ts`'s "opens every Ward Flow mode" test does
`page.getByRole("link", { name: "Transport" }).click()` with no `exact: true`, so adding a second
link whose accessible name _contains_ "Transport" made that locator resolve to two elements and
fail with a strict-mode violation. I did not touch that pre-existing test (not mine to touch, and
renaming the existing live-tracker link is a bigger, unrelated change); I relabelled my new link
"Officer" instead — no collision with any other rail label. Confirmed: the full 3-spec Chromium
gate went from 29 passed / 1 failed to 30 passed / 0 failed after the rename.

## My own re-measured fixture numbers — two corrections to the preflight

I probed the real fixture directly (`npx tsx` against a throwaway script under `artifacts/probe/`,
deleted afterwards; `git status --porcelain` showed no trace). The preflight's "8 movements carry
a transport job, all 8 not yet arrived" **held**. Two things it stated did not:

- **Escort: 5 of 8, not 8 of 8.** `escortRequired: true` on WF-005, WF-006, WF-014, WF-306,
  WF-320. **False** on WF-015, WF-313, WF-327. The preflight's "all 8 carry `escortRequired`" is
  wrong. It doesn't break the brief's `/escort/i` assertion (the card always renders an
  "Escort required: Yes/No" row regardless of the value, so the regex matches on any pinned job),
  but I mutation-tested this exact row to be sure — see below.
- **Stage split I hadn't seen documented: 2 at `handover_ready`, 6 at `moving` — and the 6
  `moving` jobs all carry `collectedAt: undefined`.** `PATIENT_COLLECTED` is the only reducer
  branch that ever sets stage to `moving`, and it always stamps `collectedAt` in the same write —
  so a movement with stage `moving` and no `collectedAt` cannot be produced by replaying real
  events through `wardFlowReducer`; this is hand-authored fixture data that doesn't reflect
  reducer-derived invariants. Consequence: for those 6 jobs, **all four** officer actions are
  refused at seed — `TRANSPORT_ACCEPTED`/`EN_ROUTE`/`COLLECTED` all require stage
  `handover_ready` (these are `moving`), and `PATIENT_ARRIVED` requires `collectedAt` set (it
  isn't). Only the 2 `handover_ready` jobs (WF-005, WF-015) have a genuinely available action —
  in both cases exactly one: **En route** (since `acceptedAt` is already set, `enRouteAt` isn't).
  I did not "fix" this by loosening any gate — the screen renders it honestly, with a correct,
  distinct reason on every blocked button. It does mean the screenshot and the pinned test job
  (WF-005) are the only two places on the whole board where a driver can currently do something
  without first watching every button read "unavailable."

Verified stamp counts, matching the preflight: `acceptedAt` on 8/8, `enRouteAt` on 6/8,
`collectedAt` on 0/8, `arrivedAt` on 0/8, `cancelledAt` on 0/8. Both `movement.acceptedUnitId`
and `movement.originEdId` resolve to a real unit/department for all 8 (checked individually, not
just spot-checked).

## How the four controls mirror the reducer

Each button's `aria-disabled` is driven by a function that reads the _same_ branches
`ward-flow-reducer.ts` reads, in the same order, never a second, hand-rolled precondition:

- **Accepted** (`acceptedBlockedReason`) — blocks unless `stage === "handover_ready"` and
  `transport` exists (mirrors the reducer's combined stage/existence guard), and additionally
  blocks if `transport.acceptedAt` is already set (mirrors the reducer's own "already accepted"
  rejection).
- **En route** (`enRouteBlockedReason`) — blocks unless `stage === "handover_ready"` and
  `transport.acceptedAt` is set, and blocks again if `enRouteAt` is already set.
- **Collected** (`collectedBlockedReason`) — blocks unless `stage === "handover_ready"` and
  `transport.enRouteAt` is set. The reducer carries no "already collected" branch of its own
  (collecting moves the stage away from `handover_ready`, so the stage guard already covers a
  repeat), and this function stays a faithful mirror rather than inventing a check the reducer
  doesn't have.
- **Arrived** (`arrivedBlockedReason`) — blocks unless `stage === "moving"` and
  `transport.collectedAt` is set; then blocks if `movement.acceptedUnitId` is absent; then if the
  unit it names doesn't resolve; then — the floor guard — if `unit.empty.value <= 0`. This last
  check reads the **live** `units` array from `useWardFlow()`, never `unitById()` from
  `ward-sites.ts` (which reads the frozen static fixture and would never see an earlier arrival
  that already consumed the receiving unit's last empty bed — I traced this: `unitById` filters
  over the module-level `wardSites` array, while `seedWardFlowState()` does
  `structuredClone(allUnits())` into the reducer's own state, so the two are separate objects
  from the moment the provider mounts and only the reducer's copy ever changes).

**Incidental finding, not touched:** `ward/ward-screen.tsx` (Task 8) resolves its own unit via
`unitById(unitId)` — the same static, never-mutated source — for the _whole_ capacity display,
including the "Currently confirmed X" figure that `CONFIRM_CAPACITY` writes to. Since
`unitById()` always re-reads the frozen fixture, a `CONFIRM_CAPACITY` or `HOLD_BED` dispatched
from that screen appears to have no visible effect on its own capacity render. I did not
reproduce or fix this — it's Task 8's file, out of this task's scope — but I flag it because I
found it concretely while confirming my own code doesn't repeat the same mistake.

## Gates run, with decisive output

- `npx tsc --noEmit -p tsconfig.json` — clean, no output, run four times across the session
  (after the initial build, after the RailLink fix, after the label fix, after `prettier
--write`).
- `npm run lint` — first run went to background (`bvwqg5bma`) and completed
  `[exited with code 0]` with no error lines; re-run in the foreground twice more (after the
  navigation fixes, and after `prettier --write`) with identical clean output (only the two
  `>` command-echo lines, no ESLint findings). Never saw the `DATABASE_HEAVY_RUN_ADMISSION_BUSY`
  marker.
- Node-env ward suites, one invocation:
  `npx vitest run tests/ward-capacity-reconciliation.test.ts tests/ward-clock.test.ts tests/ward-derivations.test.ts tests/ward-eligibility.test.ts tests/ward-flow-contracts.test.ts tests/ward-flow-reducer.test.ts tests/ward-flow-single-source.test.ts tests/ward-management.test.ts tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-output.test.ts tests/ward-pressure.test.ts tests/ward-priority.test.ts tests/ward-restriction-notice.test.ts`
  → `Test Files 14 passed (14)` / `Tests 186 passed (186)`. This is **14 files / 186 tests**, not
  the stated baseline of "10 files / 126 passed" — I'm reporting my own real, measured count
  rather than reconciling to the stated one; all 14 are green regardless of the count mismatch.
  Adding `tests/route-reachability.test.ts` to the same invocation (post-fix) gave
  `Test Files 15 passed (15)` / `Tests 191 passed (191)`.
- jsdom `.dom.test.tsx`, one file per invocation (all match the stated baselines exactly):
  `ward-screen.dom.test.tsx` → `1 passed (1)` files, `3 passed (3)` tests.
  `ward-flow-clock-consistency.dom.test.tsx` → `1 passed (1)`, `1 passed (1)`.
  `ward-flow-provider.dom.test.tsx` → `1 passed (1)`, `4 passed (4)`.
  `ward-flow-queue-selection.dom.test.tsx` → `1 passed (1)`, `1 passed (1)`.
- Browser gate, chromium only, all three ward specs, warmed with `curl` first every time:
  `PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts tests/ui-ward-roles.spec.ts --project=chromium --reporter=line`
  — first run: `1 failed` / `29 passed (60.0s)` (the substring-collision defect above). After the
  fix: `30 passed (59.3s)`. Re-run once more after `prettier --write` reformatted
  `officer-screen.tsx`, scoped to just `ui-ward-roles.spec.ts`: `4 passed (7.4s)`. Final full
  3-spec confirmation: `30 passed (60.0s)`.
- `npx prettier --write` on every file I touched (all eight listed under "What was built" plus
  the test file) — one file reformatted (`officer-screen.tsx`, line-wrapping only), the rest
  reported "unchanged". Re-ran `tsc`, `lint`, and the officer spec after, all still clean/green
  (see above).
- Did **not** run `verify:cheap`, `verify:pr-local`, `verify:ui`, `verify:release`, or the
  three-browser Playwright set — none requested, and the last is explicitly prohibited by time.
  Did not touch OpenAI, Supabase, GitHub Actions, or any live database.

## Mutation testing

Five mutations, all killed. Each: edit, `grep`/`sed -n` printed the line back from the file,
run, watch red, revert, confirm the surrounding test green again.

1. **Fifth button in the active card.** Inserted `<button type="button"
data-testid="mutation-decoy">Decoy</button>` immediately after the Arrived button (confirmed
   present: `grep -n "mutation-decoy" officer-screen.tsx` → line 252). Ran
   `gives the officer four actions and nothing else` alone →
   `Expected: 4 / Received: 5`, test failed. Reverted, confirmed `mutation-decoy` gone from the
   file, test green again.
2. **Tap-target floor.** Changed `.actionButton`'s `min-height` from `var(--of-space-48)` to
   `1.5rem` (confirmed: `grep -n "min-height: 1.5rem;"` → present). Same test →
   `Expected: >= 48 / Received: 24`, test failed. Reverted, confirmed the token restored, test
   green.
3. **Escort regex.** Changed the `<dt>Escort required</dt>` label to `<dt>Chaperone
required</dt>` (confirmed present via `grep`). Same test → `toContainText` failed, the printed
   received string showing "Chaperone required" where "Escort required" should have been.
   Reverted, confirmed restored, test green.
4. **Governance "every" claim.** Changed `shows <strong>every</strong> transport job` to `shows
<strong>all outstanding</strong> transport job` (confirmed present via `grep`). Ran
   `states it is showing every job rather than inventing an officer to own them` alone →
   `toContainText(/every/i)` failed against the printed received string. Reverted, confirmed
   restored, test green.
5. **Job count.** Added `&& movement.transport.escortRequired` to the `jobs` filter (confirmed
   present via `grep`). Same test → `[data-testid^="ward-officer-job-"]` resolved to 5 elements,
   not 8 — the exact count of `escortRequired: true` jobs from my re-measurement, which is itself
   a nice cross-check that the mutation did precisely what I intended. Reverted, confirmed the
   filter restored, test green.

## The one mutation I could not make kill anything — reported plainly, not hidden

I attempted to prove the horizontal-overflow assertion
(`document.documentElement.scrollWidth - document.documentElement.clientWidth <= 2`) could fail,
and could not, after four separate, escalating mutation attempts targeting different layers:

1. Removed `.main`'s `overflow-x: hidden`. No effect — confirmed via a throwaway Playwright probe
   that the computed `overflow-x` on `.main` stayed `auto`, not `visible`: per the CSS Overflow
   spec, when `overflow-y` is anything other than `visible` (here `auto`, needed for the
   scrollable list), a UA must compute `overflow-x` as `auto` too rather than `visible` if it was
   only left at its default — a genuine CSS coupling I hadn't accounted for, not a no-op edit.
2. Set `.main`'s `overflow-x: visible` explicitly (not just removed). Same result — the pairing
   rule above overrides an explicit `visible` the same way it overrides the default.
3. Widened `.screen` itself to `width: 900px` (confirmed via `getBoundingClientRect()`: the
   `.screen` div genuinely rendered at 900px, and `document.body.scrollWidth` correctly reported
   900). Still `document.documentElement.scrollWidth` stayed `390`. I traced this to a genuine,
   deliberate, **site-wide** safety net: `src/app/globals.css` sets `overflow-x: clip` on both
   `html` (line 722) and `body` (line 755), unconditionally, for the whole application — not
   scoped to any route. `overflow: clip` (stronger than `hidden`) stops overflow from
   contributing to an ancestor's measured scroll dimensions at the box where it's declared, so
   `body`'s own clip absorbs any normal-flow overflow from any of its descendants before it can
   ever reach `documentElement`.
4. Widened the pinned `.actionRow` itself (`position: fixed`) with `right: -900px` instead of
   `right: 0`, keeping `left: 0`. Confirmed via direct `getBoundingClientRect()` on the actual
   button row (not a proxy element) that this genuinely rendered at 1290px wide (390 viewport +
   900), starting at `x: 0` — a real, measurable overflow of the pinned bar past the right edge.
   `document.documentElement.scrollWidth` and `document.body.scrollWidth` both still read exactly
   `390`. This is a second, independent, more fundamental reason on top of (3): CSS excludes
   `position: fixed` elements from contributing to any ancestor's scrollable-overflow region at
   all (by specification, since a fixed element never moves with scrolling, so its extent can't
   sensibly define how far the page scrolls) — this is not specific to this site, it would hold
   on any standards-compliant browser.

I verified the assertion _can_ detect real overflow in principle — injecting a 2000px
`position: absolute` div directly as a child of `<body>` via `page.evaluate` did move
`document.documentElement.scrollWidth` from 390 to 2000 in the same session. But neither vector
available to me inside `officer-screen.tsx`/`officer.module.css` (normal-flow widening, or
widening the one `position: fixed` element the design calls for) can reach that failure mode,
because of the two compounding reasons above — one this site's own deliberate global defence, one
universal CSS behaviour. All four attempts were reverted; `git diff` on `officer.module.css`
showed no residue (verified: `grep -n "overflow-x: hidden;\|grid-template-columns"` after the
last revert showed exactly the original two lines, and the file is back to 249 lines).

**Conclusion, stated plainly per the mutation-testing discipline: this assertion, as written, did
not fail under any mutation I could confine to this screen's own two files.** That is not because
it is a vacuous or untestable assertion in general — it is a real, working safety net for the
whole application, and would catch a regression to the global clip rules themselves, or a route
that somehow escaped them. But for this specific component, the protection it verifies is
inherited wholesale from `src/app/globals.css`, not created by anything local `officer.module.css`
does, so I cannot claim to have proven the assertion "kills" a defect a Task 9 code change could
plausibly introduce. I stopped there rather than reformulating further, per the explicit
instruction not to keep hunting once a mutation survives and the reason is diagnosed.

## Screenshot

`artifacts/ward-management/phase3-officer-390.png`, 390×844, headless Chromium, script placed
under `artifacts/probe/` (deleted afterwards along with two follow-up diagnostic screenshots and
every other throwaway script from the mutation-testing work — `git status --porcelain` confirmed
clean before finishing; `artifacts/` itself is gitignored, so nothing under it is tracked either
way).

**Could a driver use this one-handed?** Yes, for the one job that currently needs them
(WF-005): the governance banner, WF-005's five info fields, and the four pinned action buttons
(Accepted/En route/Collected/Arrived, one of them — En route — genuinely enabled and coloured
distinctly from the other three) are all visible without scrolling on a 390-wide phone, and the
buttons are large enough to tap without precision. Scrolling to reach a _different_ job (e.g.
WF-327, the last of the eight) requires a second tap ("Work this job") before its own actions
appear pinned at the bottom — confirmed via a full-page scroll capture that the last card's
"Work this job" button sits fully clear of the pinned bar, with real blank space between them
(the `--of-bar-reserve` padding is working, not just present in the CSS).

**Does the pinned bar cover content, or does content reserve room for it?** Content reserves
room. `.main:has(.actionRow) { padding-bottom: var(--of-bar-reserve) }` only engages while the
bar exists (i.e., while any job remains), confirmed by scrolling every card into view — none sit
underneath the bar.

**Is an unavailable action's reason legible at 390px?** The screenshot shows the button labels
themselves clearly (Accepted/En route/Collected/Arrived, each on one row, not truncated). The
_reason_ text itself is `sr-only` (screen-reader only, matching `ward-screen.tsx`'s established
pattern for blocked buttons) rather than visibly printed under each button — so a sighted driver
sees which buttons are greyed out but has to long-press or use the browser's own title tooltip to
read _why_, exactly as `ward-screen.tsx`'s Accept/Decline buttons already work. I did not deviate
from that established pattern, but flagging it here rather than silently treating "legible" as
satisfied: the reason is present and correct, but not visibly printed at a glance.

## Status

DONE. Two real defects found in my own first pass and fixed before any gate went green
(`RailLink` invisibility to the reachability scanner; the "Transport officer" label's substring
collision with the existing "Transport" nav link) — both confirmed via red-then-green re-runs,
not assumed. One assertion (`ui-ward-roles.spec.ts`'s horizontal-overflow check) I could not
prove would fail on a plausible local regression, diagnosed and reported above rather than
silently claimed as proven.
