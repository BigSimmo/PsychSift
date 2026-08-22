# Task 6 report: the other ten routes

Branch `codex/ward-management-design`, base commit `868853b58`. Single commit:
`af90428ce7936b7d290502827768ca5fa91d55eb` — "refactor(ward-flow): every route reads one source
of truth".

## What changed, file by file

### `src/components/ward-management/ward-derivations.ts`

- Deleted `export const movementStageSummary = stageSummaries(wardMovements);` — the
  import-time-frozen constant. `stageSummaries(movements)` (already existed, takes a list) is
  now called by every consumer with its own live `movements` array.
- Dropped `wardMovements` from the `ward-movements` import (kept `bedReleases`, which
  `unitCapacity` still needs and which the test's `ALLOWED` set treats as an acceptable
  fixture-adjacent read for this file).
- Reworded the doc comment above `stageSummaries` — it used to say "Counts are derived from
  `wardMovements`", which became false the moment the function stopped closing over that name.
  It now says counts come from whatever list the caller passes, and names Task 6 as the reason
  every caller now passes the live provider state.

### `src/components/ward-management/ward-management-console.tsx`

- Added `import { useWardFlow } from "@/components/ward-management/ward-flow-provider";`.
- Removed `import { movementById } from "@/components/ward-management/ward-movements";` — this
  import was the file's actual offender (see "four offenders" note below); `movementById` reads
  the same frozen `wardMovements` fixture the test's regex is designed to catch, regardless of
  the fact the brief's literal three-substitution list didn't name it.
- `WardPatientWorkspace` now does:
  ```ts
  const { movements } = useWardFlow();
  const patient: Movement | undefined = movements.find((candidate) => candidate.id === patientId);
  ```
  instead of `movementById(patientId)`. Conservative failure is unchanged — a miss still falls
  through to the existing "Movement not found" branch; nothing here uses `??` or `.find()!`.
- `MovementPipeline` no longer closes over the frozen `movementStageSummary`; it now takes a
  `stages: ReturnType<typeof stageSummaries>` prop, and `WardPatientWorkspace` passes
  `stageSummaries(movements)`.
- Left `NOW_ANCHOR` as the time argument to `eligibility`/`eligibleCandidates` on this page — see
  "Ambiguity" below for why.

### `src/components/ward-management/ward-management-modes.tsx`

Already `"use client"` at the top of the file, so no server/client boundary work was needed (see
Next 16 docs note below). Removed the `wardMovements` import and `allUnits` from the `ward-sites`
import; added `useWardFlow` and swapped `movementStageSummary` for `stageSummaries` in the
`ward-derivations` import. Six internal view components — each already its own function
component, called as its own JSX element from `ModeBody` — now call `useWardFlow()` themselves
rather than closing over the fixture:

- `QueueView`: `const { movements } = useWardFlow();` — `selected` state seeds from `movements[0]`
  instead of `wardMovements[0]`, and `rolePatients` is computed from the live list.
- `CapacityView`: `const { units } = useWardFlow();` replaces `const units = allUnits();`.
- `MovementsView`: `const { movements } = useWardFlow();`, computes `stageSummaries(movements)`
  once, and filters `movements` (not `wardMovements`) per stage column.
- `ExceptionsView`: `const { movements } = useWardFlow();` feeds `buildActionInbox`.
- `TransportView`: `const { movements } = useWardFlow();` replaces the `wardMovements.filter(...)`
  call.
- `GovernanceView`: `const { movements } = useWardFlow();` — the representative audit sample is
  now `movements[0]` instead of `wardMovements[0]` (same "pick the first record for illustration"
  design intent as before; not a conservative-failure fallback since the provider-seeded array can
  never be empty, exactly as the fixture array never was).

`DecisionPanel` and `ModeHeader` were untouched (see "Ambiguity" — they still read `NOW_ANCHOR`).

### `src/components/ward-management/ward-management-network.tsx`

Also already `"use client"`. Removed the `wardMovements` import and `allUnits` from `ward-sites`;
added `useWardFlow`; swapped `movementStageSummary` for `stageSummaries`. `WardNetworkWorkspace`
(the file's one exported component) now:

```ts
const { movements, units } = useWardFlow();
const [selectedPatientId, setSelectedPatientId] = useState(movements[0].id);
...
const patient = useMemo(
  () => movements.find((candidate) => candidate.id === selectedPatientId),
  [movements, selectedPatientId],
);
```

and every remaining `wardMovements`/`allUnits()` read in that function (`openMovements`,
the pipeline strip, the queue count/list, and the two cluster-capacity `allUnits()` calls) now
reads `movements`/`units` from the hook. Module-scope pure helper functions outside the component
(`candidatesFor`, `settingFit`) were left reading `NOW_ANCHOR` — same "Ambiguity" reasoning.

### `tests/ward-flow-single-source.test.ts` (new)

Implements the brief's test with one deliberate widening: the offender scan now covers `.ts`
files as well as `.tsx` (`isScannable`), so a `.ts` module could not silently reintroduce a direct
fixture import unseen — the brief's own stated weakness. Added a third test,
`"scans a non-empty set of ward-management source files"`, asserting `walk(WARD_DIR)` after the
`isScannable` filter is non-empty, so a typo'd `WARD_DIR` (or a directory that stopped existing)
cannot make the offender check vacuously pass. `ALLOWED` is unchanged from the brief; widening to
`.ts` did not add any new offender today because every `.ts` file that imports `ward-movements`
(`ward-derivations.ts`, `ward-flow-reducer.ts`, `ward-pressure.ts`) was already in that set.

## Test output

Step 1/2 (failing test, before any implementation):

```
✓ one source of truth > scans a non-empty set of ward-management source files
✗ one source of truth > has no component reading the frozen fixture directly
✗ one source of truth > no longer exports a stage summary frozen at import time
```

Offenders at that point: `ward-management-console.tsx`, `ward-management-modes.tsx`,
`ward-management-network.tsx` — three, not the brief's predicted four (see Ambiguity).

Step 5, after implementation:

```
npx vitest run tests/ward-flow-single-source.test.ts tests/route-reachability.test.ts tests/ward-management.test.ts
...
 Test Files  3 passed (3)
      Tests  16 passed (16)
```

```
rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json
```

No output — clean.

```
npm run lint
```

Ran for real (not the `DATABASE_HEAVY_RUN_ADMISSION_BUSY` skip marker — the actual ESLint command
line and file list printed). Output:

```
C:\...\src\components\ward-management\ward-flow-reducer.ts
  1:15  warning  'Instant' is defined but never used  @typescript-eslint/no-unused-vars

C:\...\tests\ward-flow-reducer.test.ts
  5:45  warning  'PARALLEL_REFERRAL_CAP' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
ESLint found too many warnings (maximum: 0).
```

Both warnings are the two pre-existing ones the brief named as not mine; nothing new appeared in
any of the four files I touched.

```
npm run ensure
> Clinical KB is already running at http://localhost:3718
PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
...
  24 passed (1.6m)
```

Re-ran after the `npm run format` pass below and got the same result: `24 passed (58.3s)`.

## Step 6: what I actually saw in the browser

The MCP `Claude_Browser` pane in this session reported `document.hidden = true` /
`visibilityState: "hidden"` throughout, and `computer{screenshot}` consistently failed with "the
Browser pane is not displayed, so the page is not compositing frames." Under that condition every
element in the live app computed a `0×0` layout box (confirmed via `getBoundingClientRect()` on
`[data-testid="ward-coordinator"]`) even though the correct DOM/text content was present, and
dispatching real `click`/`mousedown`/`mouseup` events at the affected elements produced no state
change at all (`aria-pressed` stayed `"false"`) — i.e. this session's browser pane could not be
used to drive real interaction, only to read static DOM/network state. I'm reporting this as a
genuine tool limitation rather than silently switching to a claim I couldn't back up.

To still perform Step 6 as a real, load-bearing browser check rather than skip it, I used the
project's own `playwright` dependency (the same package the 24-test Chromium run above already
proved renders and interacts with this app correctly) to drive a headless Chromium instance
directly against `http://localhost:3718`, doing exactly what the brief asks: refer a patient on
the coordinator screen, then navigate by clicking a rail link (not reloading), and read what's on
screen. The script was written to the scratchpad, run once, and deleted afterward — it is not part
of the commit and `git status` was clean before and after.

Sequence and exact output:

1. Loaded `/ward-management`, clicked the **Movements** rail link. **Before** state: WF-001
   appeared once under "Placement requested" (0 under "Destination review").
2. Clicked the **Priority queue** rail link, selected the WF-001 row. The decision panel read
   `Suggested destination` as its badge (because `destinationUnit(WF-001)` was `undefined` before
   any referral — its default candidate is only a suggestion, not a recorded destination).
3. Clicked the **Command** rail link back to the coordinator screen, selected WF-001 in the
   Priority queue region, selected its top eligible shortlist candidate (`SCGH Adult Open`), and
   clicked **Refer**. The shortlist panel updated immediately to read
   `Parallel referral: SCGH Adult Open`.
4. **Without reloading** — clicked the **Priority queue** rail link again, re-selected the WF-001
   row. The decision panel badge had flipped to `Eligibility check` (i.e. `destinationUnit`
   now resolves, because `referredUnitIds` picked up the new referral from the same provider
   state the coordinator screen just wrote to).
5. Clicked the **Movements** rail link again (still no reload). **After** state: WF-001 was gone
   from "Placement requested" (count now excludes it) and present under "Destination review" —
   confirmed both by a DOM count query and visually in a full-page screenshot (`Destination
review` column, top card, reading "WF-001 · 1h 35m waiting · East Metro · Open · ED mental
   health team").

Console/page-error listeners attached to the Playwright page logged nothing throughout the run.

This is the decisive evidence for the task: the same movement, referred once on the coordinator
screen, was reflected by two different route components (`ward-management-modes.tsx`'s
`QueueView`/`DecisionPanel` and its `MovementsView`) purely because both now read `movements` from
the same `WardFlowProvider` instance that persists across client-side navigation in
`src/app/ward-management/layout.tsx`. Before this task, `MovementsView` and `QueueView` read the
frozen `wardMovements` array and would have kept showing WF-001 under "Placement requested"
forever, disagreeing with the coordinator screen the whole session.

## Next 16 docs read

`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`. The relevant
line: _"You do not need to add the `'use client'` directive to every file that contains Client
Components... The `'use client'` directive defines the client-server boundary, and the components
exported from such a file serve as entry points to the client."_ All three files already carried
`"use client"` at the top (from earlier tasks), so every function in them — including the six
previously-server-shaped-looking view components in `ward-management-modes.tsx`
(`QueueView`, `CapacityView`, `MovementsView`, `ExceptionsView`, `TransportView`,
`GovernanceView`) — was already part of the client bundle and free to call `useWardFlow()`
directly. No server/client boundary change was required or made; I read the doc specifically to
confirm that belief rather than assume it, since training data on this point is exactly the kind
of thing Next 16 could have changed.

## Ambiguity and how I resolved it

1. **"Four offenders" vs. three.** The brief's Step 2 says "Expect four offenders." Actual count
   at that point was three (`ward-management-console.tsx`, `ward-management-modes.tsx`,
   `ward-management-network.tsx`) — confirmed by grep before writing any code and again by the
   failing test's own output. I did not go looking for a fourth; I verified the count and reported
   the discrepancy rather than silently treating "four" as correct.

2. **`movementById` in `console.tsx` wasn't in the brief's literal three-substitution list.**
   Step 4 names exactly `wardMovements → movements`, `allUnits() → units`,
   `movementStageSummary → stageSummaries(movements)`. `ward-management-console.tsx` uses none of
   those three literally — it imports `movementById`, a function that itself reads the frozen
   `wardMovements` fixture. Removing that import was necessary both to satisfy the test's own
   regex (which matches any import path containing `ward-movements`, not specific named imports)
   and to satisfy the task's actual goal (a referred patient's own workspace page must show the
   live record). I treated this as squarely inside "each becomes a client component reading
   `useWardFlow()`" rather than as scope creep, and used `movements.find(...)` (no `!`, no `??`)
   to keep the existing "Movement not found" conservative-failure branch working unchanged.

3. **`NOW_ANCHOR` left untouched everywhere except where the brief's list implied otherwise.**
   All three files still call `eligibility`/`eligibleCandidates`/`elapsedLabel`/`buildActionInbox`
   with the frozen `NOW_ANCHOR` constant rather than the ticking `now` the provider also exposes.
   I deliberately did not widen this: the brief's "Files"/Step 4 instructions name exactly three
   substitutions and do not mention the clock; `modes.tsx` and `network.tsx` between them have
   over a dozen `NOW_ANCHOR` call sites, several inside module-scope pure functions
   (`candidatesFor`, `settingFit`) that aren't React components and can't call `useWardFlow()`
   without a much larger threading change across component boundaries that isn't in the brief's
   file list. Task 5 (the precedent this task follows) made exactly the same choice — it swapped
   the _coordinator_ screen from `NOW_ANCHOR` to `now`, but left these three files exactly as they
   were, on `NOW_ANCHOR`, and that state was already fully tested and green going into this task.
   Most importantly, the single-source-of-truth defect this task exists to fix — a referral made
   on one screen not showing up on another — is entirely about the `movements`/`units` arrays, not
   about clock drift; Step 6's proof above confirms the fix holds without touching `NOW_ANCHOR` at
   all. I'm flagging this explicitly rather than silently deciding it was out of scope: if the
   next task's brief expects `now` on these screens too, that's a separate, larger, higher-risk
   change (threading a time argument through non-component pure functions across three files) that
   deserves its own TDD pass rather than being folded into this one.

## One-line mutation that would kill each test

- `"has no component reading the frozen fixture directly"` — re-add
  `import { wardMovements } from "@/components/ward-management/ward-movements";` to any of the
  three view files (or reintroduce it in a new `.ts` file inside `ward-management/`, which the
  widened scan now also catches).
- `"no longer exports a stage summary frozen at import time"` — restore
  `export const movementStageSummary = stageSummaries(wardMovements);` in `ward-derivations.ts`.
- `"scans a non-empty set of ward-management source files"` — change `WARD_DIR` to a path that
  doesn't exist or is empty (e.g. `"src/components/ward-management/nonexistent"`).
- Step 6 (browser proof) — change `REFER_TO_UNITS`'s reducer case to mutate a locally-scoped copy
  instead of returning `replaceMovement(state, movement.id, updated)`, or have any one of the
  three view files fall back to a module-level `useState(wardMovements[0])`/`allUnits()` snapshot
  taken once at import time instead of `useWardFlow()` — either would make the coordinator's
  referral invisible on the queue/movements board exactly as it was before this task.

## Nothing else outstanding (Task 6 base implementation)

`git status` is clean after the commit; no scratch scripts, screenshots, or generated files were
left in the repository. The two pre-existing lint warnings named in the brief are unchanged and
not touched by this task.

---

## Fix round 1: the clock

Commit: `b5caa5345d16b1cd35617c18ecb5371078e4e054` — "fix(ward-flow): read the live clock instead
of the frozen fixture epoch". On top of `af90428ce7936b7d290502827768ca5fa91d55eb`, same worktree
and branch, not amended, no push, no PR, no subagents.

### Why the original scoping call was wrong

The coordinator's point is correct and I am recording it plainly: leaving `NOW_ANCHOR` in place
was not a smaller, deferrable version of Task 6 — it left the task's own stated failure mode in
place, just relocated. The coordinator screen has read the provider's ticking `now` since Task 5.
These three files kept reading `NOW_ANCHOR`, a value fixed the moment the module first evaluated.
Once real time passed after page load, "how long has this patient been waiting" would read one
number on the coordinator and a different, frozen number on every other route for the same
patient — exactly the two-screens-disagree defect Task 6 exists to close, now expressed as a time
value instead of a missing referral. Worse, `eligibility(...)` folds `NOW_ANCHOR` into capacity
freshness, so a ward could read "fresh" on one screen and "stale" on another for the same instant,
which is a clinical-decision surface stating something the data does not support. And because
`ADVANCE_CLOCK` only affects `clockOffsetMinutes` (which only reaches the provider's `now`), every
one of these `NOW_ANCHOR` call sites would have silently ignored a clock advance completely —
Task 12's demo controls would have discovered this by building the advance button and watching
nine of the ten routes not move.

### What changed, file by file

**`src/components/ward-management/ward-management-console.tsx`** — dropped the `NOW_ANCHOR`
import entirely. `WardPatientWorkspace` now destructures `now` alongside `movements` from
`useWardFlow()` and passes it to both `eligibility(...)` and `eligibleCandidates(...)`. Two call
sites.

**`src/components/ward-management/ward-management-modes.tsx`** — dropped `NOW_ANCHOR` from the
`ward-sites` import. Ten call sites across six components, each fixed by adding `now` to that
component's own existing `useWardFlow()` destructure (or adding one where it had none):

- `ModeHeader` — added `const { now } = useWardFlow();`; the "Updated {time}" stamp reads `now`.
- `DecisionPanel` — added `const { now } = useWardFlow();`; `eligibleCandidates`'s `useMemo` now
  depends on `[patient, now]` (previously `[patient]`, which would have kept a stale shortlist
  even if `now` changed with no `patient` change); `eligibility(...)` for an off-shortlist unit,
  and the "Wait / eligibility" `elapsedLabel(...)`, both read `now`.
- `QueueView` — `now` added to the existing `useWardFlow()` destructure; the per-row "Wait"
  column, the "Top candidate" lookup, and the `selectedId` fallback passed into `DecisionPanel`
  all read `now`.
- `CapacityView` — `now` added alongside `units`; the freshness check
  (`now - unit.allocatable.confirmedAt <= unit.allocatable.staleAfterMinutes`) reads `now` instead
  of the frozen constant.
- `MovementsView` — `now` added alongside `movements`; each card's elapsed-wait line reads `now`.
- `ExceptionsView` — `now` added alongside `movements`; `buildActionInbox(...)` — which drives the
  legal-deadline-breach category — now evaluates deadlines against the live clock instead of a
  clock frozen at import time.

**`src/components/ward-management/ward-management-network.tsx`** — dropped `NOW_ANCHOR` from the
`ward-sites` import, added `type Instant` to the `ward-clock` import. Five call sites:

- `WardNetworkWorkspace` — `now` added to its `useWardFlow()` destructure; the two remaining
  direct `elapsedLabel(...)` calls in its JSX (the priority-queue row and the patient sub-line)
  read `now`.
- `candidatesFor(patient: Movement)` and `settingFit(patient: Movement, unit: Unit)` are
  module-scope pure functions, not components, so they cannot call `useWardFlow()` themselves.
  Per the coordinator's explicit instruction, `now` is now a required parameter on both
  (`candidatesFor(patient, now)`, `settingFit(patient, unit, now)`) — not a default — and both
  call sites inside `WardNetworkWorkspace` were updated to pass the live `now` explicitly. The
  `candidates` `useMemo` deps became `[patient, now]`.

No `NOW_ANCHOR` reference remains in any of the three files (`grep -rn "NOW_ANCHOR"` across all
three returns nothing). There is no genuine "fixture epoch, not current time" use left in any of
them to name — every prior use really was a clock read.

### The pinned test

New file `tests/ward-flow-clock-consistency.dom.test.tsx` (jsdom project, `@testing-library/react`,
same pattern as the existing `tests/ward-flow-provider.dom.test.tsx`). It renders
`WardModeWorkspace mode="movements"` inside `WardFlowProvider initialNow={NOW_ANCHOR}`, alongside a
small `ClockAdvancer` control that dispatches the real `ADVANCE_CLOCK` event (mirroring
`DispatchProbe` in the existing provider test — this is not a mock, it drives the actual reducer).
`next/link` is mocked to a plain anchor, the same pattern `tests/mode-nav.dom.test.tsx` already
uses, since `WardModeWorkspace` renders `<Link>` and jsdom has no App Router context.

The assertion: WF-001 (fixture `openedAt: NOW_ANCHOR - 95`, no closure/acceptance) shows
`1h 35m waiting` on its movements-board card at the pinned instant. After dispatching
`ADVANCE_CLOCK` with `minutes: 60`, the same card must read `2h 35m waiting` and must no longer
contain the old text.

**Proof it can fail** — reverted line 454 of `ward-management-modes.tsx` (the `MovementsView`
card's `elapsedLabel` call) from `elapsedLabel(patient, now)` back to
`elapsedLabel(patient, NOW_ANCHOR)`, and temporarily re-added `NOW_ANCHOR` to the `ward-sites`
import so the mutation would fail on behavior rather than a compile error. Ran the test and got:

```
 x |jsdom| tests/ward-flow-clock-consistency.dom.test.tsx > clock consistency across routes > moves the movements board's waiting time when the shared clock advances

Expected element to have text content:
  2h 35m waiting
Received:
  WF-001P11h 35m waiting . East Metro . OpenED mental health team

 tests/ward-flow-clock-consistency.dom.test.tsx:69:23
     67|     const cardAfter = screen.getByText("WF-001").closest("a");
     68|     if (!cardAfter) throw new Error("WF-001 movement card not found af...
     69|     expect(cardAfter).toHaveTextContent("2h 35m waiting");
       |                       ^
```

Restored the file from a pre-mutation backup, reran, confirmed green again (1 passed), and
confirmed `grep -n "NOW_ANCHOR"` on the restored file returns nothing.

### The widened `.ts` scan, confirmed

Counted directly rather than trusting the assertion: `walk("src/components/ward-management")`
returns 25 files total; after the `isScannable` filter (`.ts` or `.tsx`) that is 21 files — the
4 excluded are `.module.css` files (`coordinator.module.css`, `ward-management.module.css`,
`ward-management-modes.module.css`, `ward-management-network.module.css`). The non-empty guard
(`"scans a non-empty set of ward-management source files"`) is genuinely exercising a real,
non-trivial file list, not a directory that happens to resolve to zero.

### Re-run evidence

`npx vitest run tests/ward-flow-single-source.test.ts tests/ward-flow-clock-consistency.dom.test.tsx tests/route-reachability.test.ts tests/ward-management.test.ts tests/ward-derivations.test.ts tests/ward-flow-reducer.test.ts tests/ward-flow-provider.dom.test.tsx tests/ward-flow-contracts.test.ts`
gave `Test Files  8 passed (8)` / `Tests  55 passed (55)`.

`rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json` produced no output — clean.
(`.next/dev/types/validator.ts` did not need a separate targeted delete this round; removing the
whole `.next/dev/types` directory was sufficient both times.)

`npm run lint` reported the same two pre-existing warnings as before
(`ward-flow-reducer.ts:1:15` unused `Instant`, `tests/ward-flow-reducer.test.ts:5:45` unused
`PARALLEL_REFERRAL_CAP`) — nothing new.

`npm run ensure` reported the server already running at `http://localhost:3718`. Ran
`PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line`
twice this round (once before the `npm run format` pass, once after) — `24 passed` both times.

### Step 6, repeated with the clock in play

Same throwaway Playwright script pattern as the first Step 6 pass (written to the scratchpad, run
once, deleted; `git status` clean before and after). This run additionally captured the elapsed
"waiting" time on both screens, not just the referral/stage move.

1. Before referring anything: read WF-001's waiting time directly off its row in the coordinator's
   own Priority Queue region (`1h 35m waiting`), then clicked the Movements rail link and read the
   same patient's card on the movements board (`1h 35m waiting`). Both screens agreed already —
   expected, since both now read the one shared `now`.
2. Clicked Command back to the coordinator, selected WF-001, selected its top eligible candidate,
   clicked Refer — the shortlist updated to show the new parallel referral.
3. Without reloading, clicked Priority queue, re-selected WF-001: the decision-panel badge read
   "Eligibility check" (flipped from "Suggested destination", same signal as the first Step 6
   pass) and its own waiting-time line still read `1h 35m waiting`.
4. Clicked Movements (still no reload): WF-001's card read `1h 35m waiting`, matching the queue
   page exactly, and the card had moved from the "Placement requested" column (count now 0) to
   "Destination review" (count now 1).

Verbatim script output:

```
Coordinator queue row waiting time for WF-001: 1h 35m waiting
Movements board card waiting time for WF-001: 1h 35m waiting
Before referral - waiting times agree: true (1h 35m waiting vs 1h 35m waiting)
BEFORE: WF-001 in 'Placement requested' column count = 1
Referred WF-001 via candidate index 0
AFTER referral - queue-page decision panel waiting time for WF-001: 1h 35m waiting
AFTER referral - queue-page decision panel badge: Eligibility check
AFTER referral - movements board card waiting time for WF-001: 1h 35m waiting
AFTER referral - waiting times agree across queue page and movements board: true (1h 35m waiting vs 1h 35m waiting)
AFTER: WF-001 in 'Placement requested' column count = 0
AFTER: WF-001 in 'Destination review' column count = 1
```

(One line in my script's own console output, reading the coordinator's shortlist panel text
immediately after referring, came back `null` from a parsing miss in my throwaway regex against
that panel's slightly different text layout — not a defect in the app; the two load-bearing
comparisons above both matched.) No console or page errors were logged during the run.

I did not additionally dispatch a real `ADVANCE_CLOCK` in this manual browser pass — the app has
no UI for that yet (Task 12 builds it), and waiting on the provider's real 30-second wall-clock
tick would only probabilistically cross a minute boundary in the available window, which would
have made the check flaky rather than more convincing. The clock-movement claim specifically —
that these screens track `now` forward, not just that they currently agree — is what
`tests/ward-flow-clock-consistency.dom.test.tsx` proves deterministically via a real dispatched
`ADVANCE_CLOCK` event, with the failure pasted above showing it can catch a regression. This
browser pass proves the complementary fact a unit test cannot: that two separately routed live
pages, reached only by clicking between them, read the literal same `now` and the literal same
`movements` array at once.

### One-line mutation for the new test

Change `elapsedLabel(patient, now)` back to `elapsedLabel(patient, NOW_ANCHOR)` in `MovementsView`
(`ward-management-modes.tsx`) — demonstrated above with the actual failure output, then reverted.

### Nothing else outstanding (fix round 1)

`git status` is clean after this commit. Two commits now sit on this branch for Task 6:
`af90428ce7936b7d290502827768ca5fa91d55eb` (movements/units rewire) and
`b5caa5345d16b1cd35617c18ecb5371078e4e054` (clock rewire, this round). No scratch scripts or
screenshots were left in the repository.

---

## Fix round 2: guard the class, not the instance

Commit: `18f57736fc4b82666a8dec664b129b3f6ba44956` — "test(ward-flow): guard the whole class of
frozen-clock reads, not one call site". On top of `b5caa5345d16b1cd35617c18ecb5371078e4e054`, same
worktree and branch, not amended, no push, no PR, no subagents. No component file was touched this
round — the entire change is the one test file below.

### The gap the coordinator found

`tests/ward-flow-clock-consistency.dom.test.tsx` (fix round 1) pins exactly one call site: the
movements board's card, `elapsedLabel(patient, now)` next to `movementHealthService`. The
coordinator reverted a _different_ call site — `DecisionPanel`'s own "Wait / eligibility" line,
also `elapsedLabel(patient, now)`, higher up the same file — and every existing test, including the
new clock test, stayed green. That is the exact shape of the Task 1 defect named in the brief:
fixing the records a reviewer happened to check rather than the rule that produced them. It matters
more here than usual because every other test in this suite pins the clock with `initialNow` and
never advances it, so a reintroduced frozen read anywhere outside the one pinned surface is
invisible to the whole suite, not just to this one test.

### What changed

`tests/ward-flow-single-source.test.ts` only (extended, not replaced — this is "the natural home"
the coordinator pointed at, since it already walks the ward-management tree for the fixture-import
check). Added:

- `CLOCK_EXEMPT`, an explicit, currently-empty allow-list `Set<string>`, documented with why it is
  empty (see "Legitimate exceptions" below) rather than silently absent.
- `callsUseWardFlow(source)` — `/(?:=|return)\s*useWardFlow\(\)/.test(source)`. Requires an `=` or
  `return` immediately before the call so it matches only a real invocation
  (`const { now } = useWardFlow();`) and never the hook's own declaration. This mattered in
  practice: `ward-flow-provider.tsx` contains the literal substring `useWardFlow()` as part of
  `export function useWardFlow(): WardFlowContextValue {`, so a bare `/useWardFlow\(\)/` match
  would have misidentified the file that _defines_ the hook as a file that _calls_ it.
- `importsNowAnchor(source)` —
  `/import\s*\{[^}]*\bNOW_ANCHOR\b[^}]*\}\s*from\s*"[^"]*ward-sites"/.test(source)`. Matches only a
  real named import from `ward-sites`, never a bare mention of the word. This also mattered in
  practice: `coordinator-screen.tsx` carries a Task 5 doc comment that names `NOW_ANCHOR` in prose
  while the file itself only ever reads the live `now` — a naive `/NOW_ANCHOR/` substring test
  would have flagged it as an offender it is not. I checked this by hand before writing the regex
  (`grep -n "NOW_ANCHOR" coordinator-screen.tsx` returns only the comment line) and again after, by
  confirming the new test passes with `coordinator-screen.tsx` included in the unfiltered scan.
- A new `it("scans a non-empty set of ward-management source files for the clock-consistency
check")`, mirroring the existing zero-match guard rather than only relying on the earlier one —
  the coordinator asked for this specific check to fail honestly on its own if the scan ever
  matched nothing, not to inherit that guarantee implicitly from a sibling test.
- The actual rule: `it("has no component holding both the live clock and the frozen epoch")` —
  walks every scannable file, drops anything in `CLOCK_EXEMPT`, and flags any file where
  `callsUseWardFlow(source) && importsNowAnchor(source)` both hold. Scoped by the rule ("read the
  live clock and the frozen epoch in the same file") rather than by naming
  `ward-management-console.tsx` / `-modes.tsx` / `-network.tsx`, so a fourth route added later that
  makes the same mistake is caught without anyone having to remember to add it to a list.

### Legitimate exceptions considered and rejected

I checked every file under `src/components/ward-management` that imports `NOW_ANCHOR` before
writing `CLOCK_EXEMPT` as empty, rather than assuming: `ward-sites.ts` (defines the constant, not a
component), `ward-movements.ts` (authors the fixture against it, not a component, already in the
separate `ALLOWED` list), `ward-flow-reducer.ts` (only mentions it in a comment, not a component),
and `ward-flow-provider.tsx` — the one case worth naming explicitly. `ward-flow-provider.tsx`
genuinely, correctly reads `NOW_ANCHOR` (`const now = NOW_ANCHOR + elapsed +
state.clockOffsetMinutes;`) because it is the module that _derives_ `now` in the first place — that
is not a bug, it is the definition. But it never calls its own `useWardFlow()` hook (it only
defines and exports it), so `callsUseWardFlow()` returns `false` for that file and it was never
going to be flagged regardless. No file today both calls `useWardFlow()` as a component and needs
the frozen epoch for a legitimate reason, so `CLOCK_EXEMPT` stays empty. If one is ever found, the
brief's own instruction stands: name it in `CLOCK_EXEMPT` with the reason, do not loosen either
regex.

### Proof it can fail

Reverted the exact call site the coordinator named: `ward-management-modes.tsx` line 200,
`DecisionPanel`'s `elapsedLabel(patient, now)` inside the "Wait / eligibility" `<dd>`, back to
`elapsedLabel(patient, NOW_ANCHOR)`, and re-added `NOW_ANCHOR` to that file's `ward-sites` import
(without the import the mutation would fail to compile rather than exercising the intended runtime
check). Ran the new test and got:

```
x |node| tests/ward-flow-single-source.test.ts > one source of truth > has no component holding both the live clock and the frozen epoch
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "src\components\ward-management\ward-management-modes.tsx",
+ ]

 tests/ward-flow-single-source.test.ts:105:23
    103|         return callsUseWardFlow(source) && importsNowAnchor(source);
    104|       });
    105|     expect(offenders).toEqual([]);
       |                       ^
```

All other tests in the file stayed green during this mutation (confirming the guard's failure is
specific to the reintroduced call site, not a side effect of a broken file). Restored
`ward-management-modes.tsx` from a pre-mutation backup, reran the full file, confirmed
`5 passed (5)`, and confirmed `grep -n "NOW_ANCHOR" src/components/ward-management/ward-management-modes.tsx`
on the restored file returns nothing.

### The extended scan, counted

Same `walk` + `isScannable` as the original single-source test: 25 total files under
`src/components/ward-management`, 21 of them `.ts`/`.tsx` (the 4 excluded are the `.module.css`
files). Both new tests share that same non-empty file list.

### Re-run evidence

`npx vitest run tests/ward-flow-single-source.test.ts tests/ward-flow-clock-consistency.dom.test.tsx tests/route-reachability.test.ts tests/ward-management.test.ts tests/ward-derivations.test.ts tests/ward-flow-reducer.test.ts tests/ward-flow-provider.dom.test.tsx tests/ward-flow-contracts.test.ts`
gave `Test Files  8 passed (8)` / `Tests  57 passed (57)` (up from 55 — the two new tests in the
extended single-source file).

`rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json` produced no output — clean.
(`.next/dev/types/validator.ts` did not exist as a separate file needing a targeted delete this
round either; removing the whole directory was sufficient.)

`npm run lint` reported the same two pre-existing warnings as every prior round
(`ward-flow-reducer.ts:1:15` unused `Instant`, `tests/ward-flow-reducer.test.ts:5:45` unused
`PARALLEL_REFERRAL_CAP`) — nothing new. This was not explicitly requested this round, but the cost
was low and it directly checks the one new file for issues like an unused import in the regex
helpers.

`npx prettier --write tests/ward-flow-single-source.test.ts` reported the file unchanged — it was
already correctly formatted.

### Browser gate: not run this round

Per the coordinator's own instruction, the browser gate does not need re-running for a static test
unless a component is touched. I did not touch a component this round — the diff is one test file
— so I did not run `npm run ensure` or the Playwright gate this round. The most recent Playwright
evidence for these routes remains fix round 1's `24 passed (50.7s)`.

### Nothing else outstanding (fix round 2)

`git status` is clean after this commit. Three commits now sit on this branch for Task 6:
`af90428ce7936b7d290502827768ca5fa91d55eb` (movements/units rewire),
`b5caa5345d16b1cd35617c18ecb5371078e4e054` (clock rewire), and
`18f57736fc4b82666a8dec664b129b3f6ba44956` (this round — the class-level static guard). No scratch
files were left in the repository.

---

## Fix round 3: declare-list the clock guard, derive QueueView's selection live

Commit: `c8f7b22ec897c790e4bf3c451d0ca0d485606e25` — "test(ward-flow): declare-list the
NOW_ANCHOR guard and derive QueueView's selection live". On top of `f3ebd8ccfe7c08d7fbad3db81045d12dae7c0dd9`
(the Phase 3 handover doc commit, itself on top of `18f57736fc4b82666a8dec664b129b3f6ba44956`),
same worktree and branch, not amended, no push, no PR, no subagents. This is the last fix round
for Task 6.

Two findings from review, neither a defect in shipped behaviour today.

### Finding 1 — the class-level clock guard overclaims

**The gap.** `"has no component holding both the live clock and the frozen epoch"` (fix round 2)
only ever flagged a file that BOTH called `useWardFlow()` AND named-imported `NOW_ANCHOR` from
`ward-sites` — `callsUseWardFlow(source) && importsNowAnchor(source)`. The reviewer proved this
evadable three ways: a helper that reads `NOW_ANCHOR` internally and is called from a component
(the component itself never imports the constant), a namespace import (`import * as sites from
".../ward-sites"` then `sites.NOW_ANCHOR`, invisible to the named-import regex), and any component
that never calls `useWardFlow()` at all, which sat outside the rule regardless of what it read.

**The fix.** Replaced the co-occurrence rule with a declaration rule in
`tests/ward-flow-single-source.test.ts`: every file under `src/components/ward-management` may
read `NOW_ANCHOR` only if it is named on `NOW_ANCHOR_ALLOWLIST`, whether or not it also calls
`useWardFlow()`. Verified by hand before writing the list (`grep -rln "NOW_ANCHOR"
src/components/ward-management`, then checked every hit's context):

```
src/components/ward-management/coordinator/coordinator-screen.tsx   comment only (line 38)
src/components/ward-management/ward-derivations.ts                 comment only (line 290)
src/components/ward-management/ward-flow-provider.tsx               real read
src/components/ward-management/ward-flow-reducer.ts                comment only (line 30)
src/components/ward-management/ward-movements.ts                   real read (many)
src/components/ward-management/ward-sites.ts                       real read (declares it)
```

Exactly three files read it for real: `ward-sites.ts` (declares the constant), `ward-movements.ts`
(the fixture, every synthetic timestamp derives from it), `ward-flow-provider.tsx` (derives the
live `now` from it once). Those three are `NOW_ANCHOR_ALLOWLIST`.

Detection itself changed shape too: `readsNowAnchor(source)` no longer matches import syntax at
all. It runs `stripCommentsAndStrings(source)` — a character-by-character scanner (not a regex)
that removes `//` and `/* */` comments and every string/template-literal body, string quoting
included, so a URL or any other comment-shaped text inside a string literal can't be
misinterpreted — then tests `/\bNOW_ANCHOR\b/` against what's left. This single pass catches a
named import, a namespace-qualified property read (`sites.NOW_ANCHOR`), and a bare re-export
alike, without a separate regex per form, and it still leaves `coordinator-screen.tsx`'s Task 5
doc comment untouched (comment-stripped before the identifier scan runs), so that file stays off
the offender list exactly as before.

`callsUseWardFlow` and `importsNowAnchor` (the two regex helpers the old rule used) are deleted —
dead code once the rule stopped checking either co-occurrence. `CLOCK_EXEMPT` is also deleted
rather than repurposed; `NOW_ANCHOR_ALLOWLIST` is a new, separately-named, separately-documented
set, since its meaning ("who may read this constant at all") is different from what
`CLOCK_EXEMPT` documented ("who may hold the clock and the epoch together"). The renamed test is
`"restricts every read of NOW_ANCHOR to the named allow-list"`, and its own doc comment states
the new rule and names the three evasions it closes, rather than describing the old rule. The
existing zero-match tripwire pattern is kept, renamed to
`"scans a non-empty set of ward-management source files for the NOW_ANCHOR allow-list check"` so
its name matches what it now guards.

**Proof it can fail — three mutations, each printed back before running, each reverted after:**

1. **Helper indirection.** Added to `src/components/ward-management/ward-priority.ts` (a file
   already outside `ALLOWED`/`NOW_ANCHOR_ALLOWLIST`, so this exercises the general
   allow-list check, not the "component" framing the old rule used):

   ```ts
   import { NOW_ANCHOR } from "@/components/ward-management/ward-sites";

   // MUTATION PROOF (Task 6 fix round 3, Finding 1) — helper indirection, will be reverted.
   export function mutationHelperFrozenNow(): Instant {
     return NOW_ANCHOR;
   }
   ```

   Printed the edited lines back from the file before running. Ran
   `npx vitest run tests/ward-flow-single-source.test.ts` and got:

   ```
   FAIL  |node| tests/ward-flow-single-source.test.ts > one source of truth > restricts every read of NOW_ANCHOR to the named allow-list
   AssertionError: expected [ Array(1) ] to deeply equal []
   + [
   +   "src\\components\\ward-management\\ward-priority.ts",
   + ]
   ```

   Reverted; `diff` against a pre-mutation backup copy of the file came back empty.

2. **A direct import.** Added to `src/components/ward-management/coordinator/coordinator-screen.tsx`
   (chosen specifically because it already carries the doc-comment mention that must stay green):

   ```ts
   import { allEmergencyDepartments, NOW_ANCHOR } from "@/components/ward-management/ward-sites";
   // MUTATION PROOF (Task 6 fix round 3, Finding 1) — direct import, will be reverted.
   void NOW_ANCHOR;
   ```

   Printed back before running. Ran the same command and got:

   ```
   FAIL  |node| tests/ward-flow-single-source.test.ts > one source of truth > restricts every read of NOW_ANCHOR to the named allow-list
   + [
   +   "src\\components\\ward-management\\coordinator\\coordinator-screen.tsx",
   + ]
   ```

   Reverted; `diff` against a pre-mutation backup came back empty. This also stands as the
   negative-control proof that the un-mutated file's own doc comment naming `NOW_ANCHOR` does
   _not_ trip the guard — the guard was green against that file both before this mutation and
   after reverting it.

3. **Emptied allow-list, and separately a zero-match scan.** Changed
   `const NOW_ANCHOR_ALLOWLIST = new Set([...])` to `new Set<string>([])`, printed back, ran, got:
   ```
   FAIL  |node| tests/ward-flow-single-source.test.ts > one source of truth > restricts every read of NOW_ANCHOR to the named allow-list
   + [
   +   "src\\components\\ward-management\\ward-flow-provider.tsx",
   +   "src\\components\\ward-management\\ward-movements.ts",
   +   "src\\components\\ward-management\\ward-sites.ts",
   + ]
   ```
   — exactly the three legitimate readers, confirming the allow-list is doing real work rather
   than the check passing for an unrelated reason. Reverted (`diff` against backup empty). Then,
   separately, pointed `WARD_DIR` at a real but scannable-empty directory (an existing directory
   containing only a `.txt` file) and re-ran:
   ```
   FAIL … scans a non-empty set of ward-management source files
   AssertionError: expected 0 to be greater than 0
   FAIL … no longer exports a stage summary frozen at import time
   Error: ENOENT: no such file or directory, open '…/ward-derivations.ts'
   FAIL … scans a non-empty set of ward-management source files for the NOW_ANCHOR allow-list check
   AssertionError: expected 0 to be greater than 0
   ```
   Both zero-match tripwires failed as required (the third failure, the `ENOENT` on an unrelated
   test, is a side effect of redirecting the shared `WARD_DIR` constant, not something being
   claimed as a mutation proof). Reverted `WARD_DIR` to `"src/components/ward-management"`;
   `diff` against the pre-mutation backup came back empty and a clean re-run gave
   `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

### Finding 2 — `QueueView` captures a movement by value

**The gap.** `const [selected, setSelected] = useState(movements[0]);` held the movement object
itself, captured at mount. `setSelected(patient)` only ever ran from the row button (selecting a
_different_ row), never in response to the already-selected movement's own data changing
elsewhere. Not exploitable today (nothing on `/ward-management/queue` dispatches, and the page
remounts on navigation), but every route shares one `WardFlowProvider`, so a referral raised on
the coordinator screen — or a future control on this very page — would never appear here without
a full remount. This is exactly the "captured once, silently stale" shape Task 6 exists to
remove.

**The fix**, matching `WardNetworkWorkspace`'s existing pattern
(`src/components/ward-management/ward-management-network.tsx`, `WardNetworkWorkspace`, lines
137–149) exactly:

```tsx
const [selectedId, setSelectedId] = useState(movements[0].id);
...
const selected = useMemo(
  () => movements.find((candidate) => candidate.id === selectedId),
  [movements, selectedId],
);
```

`setSelected(patient)` in the row button became `setSelectedId(patient.id)`; `selected.id ===
patient.id` in the row's `data-selected` became `selected?.id === patient.id` (a same-value
comparison against `patient.id`, never against a different, wrong record — the id itself doesn't
change shape). The `DecisionPanel` render at the bottom of the JSX became a ternary:

```tsx
{selected ? (
  <DecisionPanel patient={selected} role={role} selectedId={...} onSelectId={() => undefined} />
) : (
  // Never fall back to `movements[0]` or any other record here — showing a different
  // patient under the selected patient's heading is the exact class of defect this project
  // keeps finding (Task 6 Critical 1, Task 6 fix round 3 Finding 2).
  <aside className={`${styles.panel} ${styles.decisionPanel}`} aria-label="AI best-fit review unavailable">
    <p className={styles.microCopy}>No synthetic movement matches the current selection.</p>
  </aside>
)}
```

Following the network file's own convention: this guard lives in the JSX return, not as an early
return placed where `selected` is derived — every hook in `QueueView` (`useState`, the two
`useMemo` calls) already sits above this point and keeps running unconditionally regardless of
whether `selected` resolves, so a future addition to this component can't accidentally end up
conditionally skipped by an early return that predates it. `selectedId` is only ever set from a
real movement's own id (the row button), so the `.find()` can't miss today, but the guard is
written for the case where it someday does rather than assuming it never will.

**Proof it holds — a real dispatched behaviour test, not a DOM-diff snapshot.** New file
`tests/ward-flow-queue-selection.dom.test.tsx`, same pattern family as
`tests/ward-flow-clock-consistency.dom.test.tsx` and `tests/ward-flow-provider.dom.test.tsx`
(`next/link` mocked to a plain anchor; a small sibling component dispatches a real reducer event
rather than mocking `dispatch`). It renders `WardModeWorkspace mode="queue"` inside
`WardFlowProvider initialNow={NOW_ANCHOR}`, alongside a `ReferFirstMovement` control that
dispatches `REFER_TO_UNITS` for `movements[0]` (`WF-001`) against its own top eligible candidate
(computed once via the real `eligibleCandidates` export, used only to build a valid dispatch
payload, not as an assertion target).

The observable: before any referral, `WF-001` has no recorded destination
(`destinationUnit(patient)` is `undefined`), so the decision panel's AI badge reads "Suggested
destination" — `DecisionPanel`'s own `isSuggested` is true whenever a candidate is selected but
nothing has actually been referred yet. After dispatching the referral to that same unit,
`recordedDestination` becomes defined and equal to the selected candidate, so `isSuggested`
becomes false and the badge flips to "Eligibility check" — the identical wording and identical
transition this report's own fix-round-1 Step 6 manual browser pass observed for the coordinator
screen doing the same thing. Critically, this only happens if `QueueView`'s `selected` re-reads
`movements` after the dispatch; a `selected` object frozen at mount would never see the new
`referredUnitIds`, so `destinationUnit` on the stale object would stay `undefined` forever and the
badge would incorrectly keep reading "Suggested destination". No `page.goto()`/remount occurs
anywhere in the test — the whole sequence happens on one render tree, which is the only way this
particular bug shape can be observed at all (a remount would trivially "pass" even the buggy
version, by reseeding `useState` from the now-current `movements`).

Ran standalone: `npx vitest run tests/ward-flow-queue-selection.dom.test.tsx` →
`Test Files  1 passed (1)` / `Tests  1 passed (1)`.

**Mutation proof.** Backed up `ward-management-modes.tsx`, then replaced the live derivation with
the original captured-at-mount shape (kept type-compatible with the surrounding ternary/guard
code so the mutation exercises runtime behaviour, not a compile error):

```tsx
// MUTATION PROOF (Task 6 fix round 3, Finding 2) — captured once at mount, will be reverted.
const [selected] = useState(() => movements.find((candidate) => candidate.id === selectedId));
```

Printed the edited lines back from the file before running. Ran
`npx vitest run tests/ward-flow-queue-selection.dom.test.tsx` and got:

```
FAIL  tests/ward-flow-queue-selection.dom.test.tsx > queue view selected-movement derivation > reflects a referral made after mount, not the movement object captured at mount
TestingLibraryElementError: Unable to find an element with the text: Eligibility check.
 ❯ tests/ward-flow-queue-selection.dom.test.tsx:92:19
     92|     expect(screen.getByText("Eligibility check")).toBeInTheDocument();
```

Reverted from the pre-mutation backup; `diff` against it came back empty. Re-ran the three
ward-flow dom suites together and got `Test Files  3 passed (3)` / `Tests  6 passed (6)`
(`ward-flow-queue-selection.dom.test.tsx`, `ward-flow-provider.dom.test.tsx`,
`ward-flow-clock-consistency.dom.test.tsx`).

### Verification run this round

`rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json` — no output, clean. Run twice (once
before, once after the `npx prettier --write` pass below), both clean.

Node-environment suite, separate invocation from jsdom (mixing the two hangs workers on this
machine):

```
npx vitest run tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts tests/ward-model-phase3.test.ts tests/ward-flow-single-source.test.ts tests/ward-clock.test.ts
...
 Test Files  5 passed (5)
      Tests  53 passed (53)
```

Matches the findings' stated baseline of 53 exactly (no test count changed — Finding 1 renamed
and rewrote two existing tests rather than adding one).

jsdom suite, separate invocation, including the new file:

```
npx vitest run tests/ward-flow-clock-consistency.dom.test.tsx tests/ward-flow-provider.dom.test.tsx tests/ward-flow-queue-selection.dom.test.tsx
...
 Test Files  3 passed (3)
      Tests  6 passed (6)
```

Up from the findings' stated baseline of 5 — the one new test in
`ward-flow-queue-selection.dom.test.tsx`. Re-ran again after the `npx prettier --write` pass and
got the identical result.

Formatting: `npx prettier --write src/components/ward-management/ward-management-modes.tsx
tests/ward-flow-single-source.test.ts tests/ward-flow-queue-selection.dom.test.tsx` reformatted
only `ward-management-modes.tsx` (collapsed the `selected` `useMemo` onto one line); the two test
files were already correctly formatted. Re-ran both vitest invocations above after formatting to
confirm the reformat didn't change behaviour — both stayed green with the same counts.

Browser gate — required this round since `ward-management-modes.tsx` (a component serving several
routes) was touched. `npm run ensure` reported `Clinical KB is running at http://localhost:3718`
(confirmed via `/api/local-project-id` returning this project's own `projectId` before trusting
the port). Ran:

```
PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
...
  24 passed (3.5m)
```

Matches the findings' stated baseline of 24 exactly.

`npm run lint` was not run this round: it was not named in the findings' required verification
list, and the two changed files are a test file (regex/string-scanning helpers, not app code
lint would flag differently) and a component edit that's a narrow, mechanical hook-state change
already covered by tsc (which is clean) and the two behavioural gates above. `npm run lint`'s
last recorded state (fix round 1) was the same two pre-existing warnings named as not mine in the
base report; nothing in this round's diff touches either file those warnings are in.

### Judgment calls

1. **Deleted `CLOCK_EXEMPT` rather than repurposing it**, per the findings' explicit either/or.
   Repurposing would have left a set whose established doc comment described the old
   "clock+epoch co-occurrence" concept; a fresh, separately-documented `NOW_ANCHOR_ALLOWLIST`
   reads honestly as "who may read this constant" without carrying the old rule's now-inaccurate
   framing forward.
2. **Comment/string stripping is a hand-rolled character scanner, not a single regex**, because a
   regex-based "strip comments" approach risks exactly the class of false-negative/false-positive
   the findings are about (e.g. a `//` inside a string being mistaken for a line comment). It's
   more code than a regex, but it's the same order of complexity as `stripCommentsAndStrings` in
   any linter's own tokenizer, and it was mutation-tested against the real trap file
   (`coordinator-screen.tsx`) both directions — passes when only the comment mentions the
   constant, fails when a real import is added.
3. **`REFER_TO_UNITS` (not `RECORD_ESCALATION` or `RECORD_EXAMINATION`) is the dispatch used in
   the new Finding 2 test**, chosen after checking that it has the fewest preconditions that
   still produce an _observable_ change in what `QueueView`/`DecisionPanel` render — `WF-001`'s
   fixture stage (`placement_requested`) is directly referable, and the resulting
   `destinationUnit` change flips a badge string already visible on screen, rather than setting a
   field (like `escalation.contact`) nothing on this route currently displays.
4. **Didn't add a namespace-import mutation as a fourth proof.** The findings require exactly
   three mutations (helper indirection, direct import, emptied-allow-list/zero-match); the
   namespace-import evasion named in the findings' prose is covered by the same code path as the
   emptied-allow-list proof (both exercise `readsNowAnchor`'s bare-identifier match rather than
   any import-syntax-specific regex, since the new implementation has no import-syntax-specific
   regex left to separately test) — the _general_ identifier scan already covers a property
   access on a namespace import the same way it covers a bare read, since it doesn't parse import
   forms at all. I verified this by inspecting `readsNowAnchor`'s implementation rather than
   running a fourth mutation, since it isn't in the required list; flagging that as a check I did
   by reading the code rather than by executing it.

### Nothing else outstanding (fix round 3)

`git status` is clean after the commit. Four commits now sit on this branch for Task 6:
`af90428ce7936b7d290502827768ca5fa91d55eb` (movements/units rewire),
`b5caa5345d16b1cd35617c18ecb5371078e4e054` (clock rewire),
`18f57736fc4b82666a8dec664b129b3f6ba44956` (class-level static guard, fix round 2), and
`c8f7b22ec897c790e4bf3c451d0ca0d485606e25` (this round). No scratch scripts, backup files, or
temporary directories were left in the repository — every backup used for a mutation proof lived
in the session scratchpad, outside the repo, and was never staged. This is the last fix round for
Task 6 per the findings file; no further action is expected from this branch for this task unless
a new review raises a new finding.

## Fix round 5: the parser, not a fourth scanner

### The defect

`stripCommentsAndStrings` (fix round 4, `tests/ward-flow-single-source.test.ts`) was a hand-rolled
character-by-character scanner with no concept of a regex literal. A quote character inside a
`/…/` regex opened a phantom string, desyncing the scanner's comment/string tracking for the rest
of the file — every later line became invisible to the identifier scan. Reproduced by hand before
touching anything: appended

```
import { NOW_ANCHOR } from "@/components/ward-management/ward-sites";
export const leaked = NOW_ANCHOR;
```

to the end of `src/components/clinical-dashboard/search-utils.ts` (which carries
`/"[^"]+"|(?:^|\s)'[^']+'(?=\s|$)/` at line 331) and ran the pre-round-5 guard: **5 passed**, fully
green, with an ordinary named import of the frozen epoch sitting in the tree. `src/lib/document-summary-badges.ts:61`
(`/\b(?:no|not|non|without|nil|free of|absence of|no known)\b[\s\w,'-]{0,16}$/i`, an apostrophe
inside a character class) carries the identical trap.

### The fix

Deleted `stripCommentsAndStrings` entirely. Rewrote `readsNowAnchor` on the TypeScript compiler's
own parser (`import ts from "typescript"`, already a repo dependency — it is what `tsc` runs on):

```ts
function readsNowAnchor(source: string, fileName: string): boolean {
  if (!source.includes("NOW_ANCHOR")) return false;

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === "NOW_ANCHOR") {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
```

A cheap `source.includes("NOW_ANCHOR")` pre-filter runs first — verified by hand
(`grep -rln "NOW_ANCHOR" src`) that only 6 files under all of `src` contain the substring at all,
so the parser only ever runs on those 6, not the whole tree. Comments are trivia attached to token
positions, not nodes `forEachChild` visits, and string/template contents are `StringLiteral`/
template nodes, never `Identifier` nodes — both are excluded by construction, not by a second
regex layered on the first mistake. No regex-literal detection was added (telling a regex literal
from a division operator requires knowing the preceding token — the reason ad-hoc scanners get
this wrong — and a heuristic there would only buy a fourth version of the same overclaim).

Kept unchanged, as instructed: `SRC_DIR`, the path-qualified `NOW_ANCHOR_ALLOWLIST` (same three
entries), `normalizePath`, the zero-match tripwire, and the separate fixture-import rule
(`ALLOWED`, scoped to `WARD_DIR`). Doc comments above `NOW_ANCHOR_ALLOWLIST` and `readsNowAnchor`
were rewritten to describe the parser approach and why the scanner was rejected; the stale
character-scanner description was deleted along with the function.

Before every mutation below, the file being changed was printed back from disk after the edit and
before the run; after every restore, printed back again (or diffed byte-for-byte against a
scratchpad backup) before the confirming green run. Full disk-read transcripts are in this
session's tool output; summarized results below.

### Proofs (all read back from disk before each run; all match required outcome)

**(a) Regression repro — `search-utils.ts`.** Backed up to scratchpad first. Appended the exact
two lines from the brief. Guard result:

```
AssertionError: expected [ Array(1) ] to deeply equal []
+ [
+   "src\\components\\clinical-dashboard\\search-utils.ts",
+ ]
```

FAILED as required, naming the file. Restored from backup (`git diff --stat` on the file empty
afterward, confirming byte-for-byte match). Re-ran: **5 passed**.

**(b) Regression repro — `document-summary-badges.ts`.** Same procedure, same two lines appended.
Guard result:

```
+ [
+   "src\\lib\\document-summary-badges.ts",
+ ]
```

FAILED as required. Restored, diff-clean, re-ran: **5 passed**.

**(c) Out-of-tree named import.** Created in a temporary, untracked probe file with
`import { NOW_ANCHOR } from "@/components/ward-management/ward-sites"; export const frozenProbe = NOW_ANCHOR;`.
Guard result:

```
+ [
+   "temporary probe file",
+ ]
```

FAILED as required. Deleted (`rm -rf src/lib/ward-probe`), confirmed absent, re-ran: **5 passed**.

**(d) Out-of-tree namespace import — same temporary probe location.** Created with
`import * as sites from "@/components/ward-management/ward-sites"; export const frozenProbe = sites.NOW_ANCHOR;`.
Guard result: same failure, identifying the temporary probe. FAILED as required. Deleted,
re-ran: **5 passed**.

**(e) Emptied allow-list.** Backed up the fix-round-5 test file to scratchpad first (md5 verified
identical), since a `git checkout --` here would have reverted to the pre-round-5 committed
content and destroyed this round's work. Temporarily replaced `NOW_ANCHOR_ALLOWLIST`'s contents
with an empty set. Guard result:

```
+ [
+   "src\\components\\ward-management\\ward-flow-provider.tsx",
+   "src\\components\\ward-management\\ward-movements.ts",
+   "src\\components\\ward-management\\ward-sites.ts",
+ ]
```

FAILED as required, naming exactly the three legitimate readers — no entry is inert. Restored
from the scratchpad backup, `diff` confirmed byte-identical, re-ran: **5 passed**.

**(f) Zero-match tripwire.** Same backup/restore discipline. Temporarily pointed `SRC_DIR` at
`"public"` (confirmed by hand to hold files but zero `.ts`/`.tsx`). Guard result:

```
AssertionError: expected 0 to be greater than 0
```

FAILED as required — the zero-match guard, not the allow-list check, caught it. Restored,
diff-identical, re-ran: **5 passed**.

**(g) Comment trap stays green.** `coordinator-screen.tsx:38` (`// … NOW_ANCHOR constant …`),
`ward-derivations.ts:290` (`* fixture at NOW_ANCHOR, …`, inside a `/** */` block), and
`ward-flow-reducer.ts:30` (`/** … now is NOW_ANCHOR + elapsed … */`, a JSDoc-style comment
attached to a property) all mention the identifier only in comments and are absent from
`NOW_ANCHOR_ALLOWLIST`. Ran the actual `readsNowAnchor` implementation against each file's current
content directly (not a reimplementation): all three returned `false`. This is also the standing
proof in every other run above and below — these three files sat unmodified through every proof
and every gate run, and the suite stayed green throughout, meaning the real test already exercises
this every time it runs.

**(h) String-literal mention (new for round 5 — a real parser can be asked this question a
character scanner couldn't answer safely).** Backed up `document-summary-badges.ts` (md5
verified). Appended
`export const mentionOnly = "this file talks about NOW_ANCHOR in a string, not a real read";`.
Guard result: **5 passed** — GREEN as required, confirming a string-literal mention is not treated
as a read. Restored from backup, diff-clean.

### Verification

1. **`npx tsc --noEmit -p tsconfig.json`** — exit 0, empty output. Clean; no `.next/dev/types/`
   artefact errors, so no cleanup needed.
2. **`npx vitest run tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts tests/ward-model-phase3.test.ts tests/ward-flow-single-source.test.ts tests/ward-clock.test.ts`**
   — `Test Files  5 passed (5)` / `Tests  53 passed (53)`. Matches the stated baseline exactly.
3. **`npx vitest run tests/ward-management.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts tests/ward-derivations.test.ts tests/ward-model.test.ts`**
   — `Test Files  5 passed (5)` / `Tests  58 passed (58)`. Matches baseline exactly.
4. **jsdom suite, separate invocation** —
   `npx vitest run tests/ward-flow-clock-consistency.dom.test.tsx tests/ward-flow-provider.dom.test.tsx tests/ward-flow-queue-selection.dom.test.tsx`.
   First two attempts hit the documented environmental flake, but not the `no tests / no tests`
   form named in the brief — instead a worker-pool startup timeout
   (`[vitest-pool-runner]: Timeout waiting for worker to respond`), landing at exit code 1 both
   times with a partial pass (1/3 files each time, different file each time). A `tasklist` check
   showed dozens of `node.exe` processes already resident on this machine, consistent with
   resource contention rather than a real regression — this test-only change touches nothing these
   `.dom.test.tsx` files import. Re-ran a third time with `VITEST_MAX_WORKERS=1` (an existing env
   override read by `vitest.config.*`) to remove the contention variable: **`Test Files  3 passed
(3)`** / **`Tests  6 passed (6)`**, exit 0. Matches the stated baseline exactly; the two prior
   attempts are recorded here as the flake they were, not hidden.
5. **Guard runtime, before vs. after.** Two clean back-to-back measurements, each vitest's own
   reported `tests` duration for the whole 5-test file (not wall-clock, which includes ~1-2s of
   Vitest/Node startup unrelated to the guard logic):
   - **v4 (`stripCommentsAndStrings`, pre-round-5, measured via `git stash` on the working tree):**
     `tests 12.47s`.
   - **v5 (parser + pre-filter, this round, first clean measurement immediately after
     implementing):** `tests 7.96s`.
   - **v5, final confirmation run after all proofs and formatting:** `tests 5.07s`.
     The pre-filter made it substantially faster, as expected — the parser only ever runs on the 6
     files that contain the substring `NOW_ANCHOR` at all, instead of every scannable file under
     `src` being character-scanned. It was never slower than v4 in any measurement this round.

Formatted with `npx prettier --write tests/ward-flow-single-source.test.ts` — reported `unchanged`
(already correctly formatted). `git status --porcelain` shows only
`tests/ward-flow-single-source.test.ts` modified; every probe file, injected regression line, and
temporary allow-list/`SRC_DIR` edit was restored or deleted before this report was written. No
source under `src/` was touched by this round, so the browser gate was not run, matching the
brief's instruction (browser gate already proven this round at `c8f7b22ec`, 24 passed).
