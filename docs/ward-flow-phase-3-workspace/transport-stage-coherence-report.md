# Transport stage/stamp coherence fix — report

Commit: `1349c213fa6f3294a6a8fc22b0aded8c186e8429`
Branch: `codex/ward-management-design` (worktree `C:\Users\joshs\.codex\worktrees\ward-management-design\Database`)

## The defect

Eight movements in `src/components/ward-management/ward-movements.ts` carry a `transport`
job. Six of them (WF-006, WF-014, WF-306, WF-313, WF-320, WF-327) were stage `"moving"` with
`transport.collectedAt` unset. Confirmed against `ward-flow-reducer.ts`:
`PATIENT_COLLECTED` is the only transition that produces stage `"moving"`, and it always sets
`transport.collectedAt` in the same update (`case "PATIENT_COLLECTED"`, lines 359-371). No
sequence of events can reach the state those six shipped in. Because `PATIENT_ARRIVED`
requires `movement.stage === "moving" && movement.transport?.collectedAt`, all four officer
actions refused on all six, leaving `officer-screen.tsx` with four dead controls on six of its
eight jobs.

Two of the six (WF-006, WF-014) are hand-authored records in `seededMovements`. The other four
(WF-306, WF-313, WF-320, WF-327) are produced by the generator's `stageFields` function
(`ward-movements.ts`), whose `"moving"` case set `acceptedAt` and `enRouteAt` but never
`collectedAt` — the actual root cause behind those four. Fixed at the generator, not by
overriding four generated literals, so any future index/count change to `routineMovements`
still produces coherent `"moving"` records.

## 1. The six `collectedAt` values

All computed relative to `NOW_ANCHOR = 642` (10:42).

| id     | acceptedAt | enRouteAt | collectedAt | pickup-drive (collected - enRoute) | in-transit so far (NOW - collected) | source                |
| ------ | ---------- | --------- | ----------- | ---------------------------------- | ----------------------------------- | --------------------- |
| WF-006 | 592        | 627       | 635         | 8 min                              | 7 min                               | hand-authored         |
| WF-014 | 597        | 632       | 638         | 6 min                              | 4 min                               | hand-authored         |
| WF-306 | 596        | 612       | 620         | 8 min                              | 22 min                              | generated (index 306) |
| WF-313 | 589        | 602       | 617         | 15 min                             | 25 min                              | generated (index 313) |
| WF-320 | 597        | 607       | 629         | 22 min                             | 13 min                              | generated (index 320) |
| WF-327 | 590        | 607       | 618         | 11 min                             | 24 min                              | generated (index 327) |

**WF-006** (hand-authored): collected 8 minutes after going en route — a short
RGH-to-RGH-Adult-Secure hop — leaving 7 minutes of in-transit time at `NOW_ANCHOR`. Chosen
because the whole accepted-to-en-route-to-now window is only 15 minutes; a short pickup-drive
followed by a few minutes still on the road reads as a coherent short transfer.

**WF-014** (hand-authored): collected 6 minutes after going en route (FSH to RPH Adult
Secure, a secure escort with `specialling: true`), leaving 4 minutes in transit. The window
here is only 10 minutes total (accepted-to-now), the tightest of the six, so both intervals are
necessarily small.

**WF-306, WF-313, WF-320, WF-327** (generated): rather than hand-picking four more literals, I
fixed the generator's `"moving"` case in `stageFields()`:

```ts
const collectedAt = enRouteAt + Math.min(NOW_ANCHOR - enRouteAt, 8 + (index % 18));
```

The `8 + (index % 18)` term gives an 8-25 minute pickup-drive that varies by index instead of
being one shared constant — the four real indices produce 8, 15, 22, and 11 minutes
respectively, so the four generated journeys read as being at different points, not identical
clones. The `Math.min` against `NOW_ANCHOR - enRouteAt` is a correctness clamp: it guarantees
`collectedAt <= NOW_ANCHOR` for any index/count the generator is ever called with, not just the
four values that exist today (the smallest possible gap for this generator's own
`acceptedAt`/`enRouteAt` formulas is 21 minutes, below the unclamped offset's ceiling of 25, so
the clamp is not just defensive — it can genuinely engage for some indices).

**On the "close enough to also need `arrivedAt`" check** (explicitly asked for): none of the
six needed it. The two hand-authored records have only 4 and 7 minutes of in-transit time —
clearly just collected, the opposite of "about to arrive." The four generated records range
13-25 minutes in transit, comfortably inside a normal Perth-metro interfacility transfer and
well short of anything that would read as overdue for arrival. I did not deliberately avoid
this case — I checked after choosing the values — but no combination of pickup-drive time and
remaining gap in this fixture pushes any of the six into "should already have arrived"
territory, so I left all six as `collectedAt`-only and did not add `arrivedAt` to any of them.
Adding an arrival would also consume a bed and close the movement (`PATIENT_ARRIVED`'s own
effects), which is out of this fix's scope.

## 2. The invariants added, and how they were derived

Added a new `describe("fixture stage/stamp coherence (ward-movements.ts)", ...)` block to
`tests/ward-flow-contracts.test.ts`, distinct from the existing `describe("invariants across
every reachable state", ...)` block above it — that block walks one movement through
`wardFlowReducer` and checks reducer-produced states; this one inspects `wardMovements`
(the raw fixture) directly, since the fixture never goes through the reducer at all.

Every rule is read off `ward-flow-reducer.ts`'s transport-related `case` blocks:

- `PATIENT_COLLECTED` requires stage `"handover_ready"` + `transport.enRouteAt`, and sets stage
  `"moving"` + `transport.collectedAt` in the same update -> **stage `"moving"` without
  `collectedAt` is unreachable.**
- `PATIENT_ARRIVED` requires stage `"moving"` + `transport.collectedAt`, and sets stage
  `"arrived"` + `transport.arrivedAt` in the same update -> **a movement that is stage
  `"arrived"` with a transport job but no `arrivedAt` is unreachable.**
- `TRANSPORT_EN_ROUTE` requires `transport.acceptedAt`; `PATIENT_COLLECTED` requires
  `transport.enRouteAt`; `PATIENT_ARRIVED` requires `transport.collectedAt` -> **the four
  transport stamps can only be present in the order acceptedAt, enRouteAt, collectedAt,
  arrivedAt** — a later one is never set without every earlier one.
- Every event's `now` becomes the stamp it writes and nothing moves the clock backward ->
  **every stamp is `<= NOW_ANCHOR` and `>=` whichever stamp on the same job preceded it.**

I did not find the task's list incomplete or wrong against the reducer — all four rules match
what the reducer actually enforces.

Three `it()` blocks:

1. **`"never leaves a 'moving' movement without the collection its stage implies"`** — asserts
   `transport?.collectedAt` is defined for every `stage === "moving"` record.
2. **`"never leaves an 'arrived' movement's transport job without the arrival it implies"`** —
   asserts `transport.arrivedAt` is defined for every record where `stage === "arrived" &&
transport`.
3. **`"only ever fills transport stamps in the order the reducer allows, never after
NOW_ANCHOR"`** — for every movement with a transport job: the existence chain
   (`enRouteAt` implies `acceptedAt`, `collectedAt` implies `enRouteAt`, `arrivedAt` implies
   `collectedAt`), every present stamp `<= NOW_ANCHOR`, and every present stamp
   `>=` its predecessor in stamp order.

### The counter bug the coordinator caught, and the fix

My first version counted **loop iterations**, not **matches**:

```ts
let inspected = 0;
for (const movement of wardMovements) {
  inspected += 1;                 // wrong: increments for every movement
  if (movement.stage === "moving") { expect(...).toBeDefined(); }
}
expect(inspected).toBeGreaterThan(0);
```

That only proves `wardMovements` is non-empty (always true), not that the `if` body ever ran.
For the `"moving"` test it happened not to matter (six records match today), but for the
`"arrived"`-with-transport test it mattered completely: **no current fixture record is stage
`"arrived"` while still carrying a `transport` job** — both the hand-authored WF-007 and every
generated `"arrived"` record close without ever having had a transport job. That `if` body ran
zero times, and the old `expect(inspected).toBeGreaterThan(0)` tripwire passed anyway — the
exact defect class this project shipped before (Task 1's privacy guard, whose loops executed
zero times).

Fixed by moving the counter inside the `if`, so it counts **matches**, not iterations:

- `"moving"` test: `expect(matched).toBeGreaterThan(0)` — true today (six matches).
- `"arrived"`-with-transport test: `expect(matched).toBe(0)`, with an inline comment stating
  plainly that no current record exercises this branch, that this is a forward-looking guard,
  and that the assertion becomes live the moment a record does — rather than inventing a
  fixture record just to make a `toBeGreaterThan(0)` pass.
- The third test (`"only ever fills transport stamps..."`) already counted matches correctly
  (its counter increments only after `if (!transport) continue`, i.e. only for movements the
  assertions actually inspect), so it needed no change.

## Mutations, printed back and killed

Every mutation below was made with `sed`, printed back with `sed -n`/`grep` from the file,
run, observed failing (or in one deliberate case, not failing — see below), then reverted and
reconfirmed green. No mutation markers remain in the committed diff.

**1. Primary mutation — `moving` without `collectedAt`.** Removed WF-006's `collectedAt` line
(replaced with a comment). Printed back:

```
      // MUTATION collectedAt removed
```

Result: `AssertionError: WF-006 is stage "moving" but transport.collectedAt is unset —
PATIENT_COLLECTED is the only reducer transition that produces "moving" and it always sets
collectedAt: expected undefined to be defined`. **Killed.** Reverted; confirmed green (10/10).

**2. `arrived` without `arrivedAt` (inner assertion).** Changed WF-006's `stage` from
`"moving"` to `"arrived"` (transport still present, no `arrivedAt`). Printed back:

```
    stage: "arrived", // MUTATION
```

Result: `AssertionError: WF-006 is stage "arrived" with a transport job but
transport.arrivedAt is unset: expected undefined to be defined`. **Killed.** Reverted;
confirmed green.

**3. Existence chain — `enRouteAt` without `acceptedAt`.** Set WF-006's `acceptedAt` to
`undefined`. Printed back:

```
      acceptedAt: undefined, // MUTATION
```

Result: `AssertionError: WF-006 has transport.enRouteAt without transport.acceptedAt: expected
undefined to be defined`. **Killed.** Reverted; confirmed green.

**4. Stamp after `NOW_ANCHOR`.** Set WF-006's `collectedAt` to `NOW_ANCHOR + 5`. Printed back:

```
      collectedAt: NOW_ANCHOR + 5, // MUTATION
```

Result: `AssertionError: WF-006 has a transport stamp after NOW_ANCHOR (642): expected 647 to
be less than or equal to 642`. **Killed.** Reverted; confirmed green.

**5. Stamp ordering — swapped `acceptedAt`/`enRouteAt`.** Swapped WF-006's two values so
`acceptedAt (627) > enRouteAt (592)`. Printed back:

```
      acceptedAt: NOW_ANCHOR - 15, // MUTATION swapped
      enRouteAt: NOW_ANCHOR - 50, // MUTATION swapped
```

Result: `AssertionError: WF-006's transport stamps are not in non-decreasing order: expected
592 to be greater than or equal to 627`. **Killed.** Reverted; confirmed green.

**6. Zero-record tripwire (test 1's loop, "moving").** Pointed the loop at `[] as typeof
wardMovements`. Printed back:

```
    for (const movement of [] as typeof wardMovements) { // MUTATION empty
```

Result: `AssertionError: expected 0 to be greater than 0` (`matched`). **Killed.** Reverted;
confirmed green.

**7. Corrected-counter mutation, "moving" test.** Same as #6, re-run against the corrected
`matched`-based counter (post-fix), to prove the fix itself is meaningful and not just a
rename. Same result: `expected 0 to be greater than 0`. **Killed.**

**8. Corrected-counter mutation, "arrived" test — the interesting one.** Per the coordinator's
instruction to "point a loop at an empty array," I tried that first on the `"arrived"` test's
loop, printed back:

```
    for (const movement of [] as typeof wardMovements) { // MUTATION empty (expected NOT to kill toBe(0))
```

Result: **10/10 still passed — this mutation did not kill the assertion.** This is expected,
not a defect: `matched` is already `0` with the real fixture, so emptying the array leaves
`matched` at `0` either way, and `expect(matched).toBe(0)` is unaffected. Emptying-the-array is
the right kill mutation for a `toBeGreaterThan(0)` assertion (tests 1 and the third test) but
not for a `toBe(0)` assertion — for that, the count has to move _away from_ zero. This is a
mistimed mutation, not an untestable assertion — the correct mutation is #9 below. Reverted the
empty-array change before applying #9.

**9. Correct kill mutation for the `toBe(0)` counter.** To isolate the _outer_ counter from the
_inner_ per-record assertion (so a failure clearly indicts the counter, not the inner check), I
mutated WF-006 into a state that is internally coherent — stage `"arrived"` **and**
`transport.arrivedAt` set — so the inner `expect(movement.transport.arrivedAt).toBeDefined()`
passes, and only the outer count-of-matches can fail. Printed back:

```
    stage: "arrived", // MUTATION isolate-outer-counter
...
      collectedAt: NOW_ANCHOR - 7,
      arrivedAt: NOW_ANCHOR - 1, // MUTATION isolate-outer-counter (inner check still passes)
```

Result:

```
AssertionError: expected 1 to be +0 // Object.is equality
- Expected
+ Received
- 0
+ 1
 v tests/ward-flow-contracts.test.ts:258:21
                    expect(matched).toBe(0);
```

Failure lands exactly on the outer `expect(matched).toBe(0)` line, with the inner assertion
never firing (it can't — `arrivedAt` is set). **Killed**, and specifically proves the outer
counter is live and not hardcoded/tautological. Reverted both lines (removed the `arrivedAt`
line entirely, restored `stage: "moving"`); confirmed `git diff` matches the intended fixture
change exactly and 10/10 pass.

No assertion survived a mutation that should have killed it. Mutation #8 "survived" a mutation
that, on inspection, should not have killed it — documented above rather than treated as a
red flag, per the mistimed-mutation-vs-untestable-assertion distinction.

## Gates run

- **`npx tsc --noEmit -p tsconfig.json`** — clean, no output, both before and after the
  counter fix and after `prettier --write`.
- **Node-env ward suites** (`tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts
tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-flow-single-source.test.ts
tests/ward-clock.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts
tests/ward-derivations.test.ts tests/ward-management.test.ts`, one invocation):
  `Test Files  10 passed (10)` / `Tests  129 passed (129)`. **Baseline moved from 126 to 129 —
  explained: exactly the three new `it()` blocks in `ward-flow-contracts.test.ts` added by this
  change.**
- **jsdom, one file per invocation:**
  - `tests/ward-screen.dom.test.tsx` -> `Tests  3 passed (3)` — matches baseline.
  - `tests/ward-flow-clock-consistency.dom.test.tsx` -> `Tests  1 passed (1)` — matches baseline.
  - `tests/ward-flow-provider.dom.test.tsx` -> `Tests  4 passed (4)` — matches baseline.
  - `tests/ward-flow-queue-selection.dom.test.tsx` -> `Tests  1 passed (1)` — matches baseline.
- **Ward Chromium gate** (`PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test
tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts tests/ui-ward-roles.spec.ts
--project=chromium --reporter=line`): `30 passed (55.5s)` — matches baseline exactly,
  including `Transport officer screen > gives the officer four actions and nothing else`
  (per-job button count is unaffected by which of the four are enabled) and `states it is
showing every job rather than inventing an officer to own them` (job count, still 8, is
  unaffected).
- **`npm run lint`** — **not run; confirmed lock-held, not a pass.** The first attempt
  exceeded a 120-second foreground timeout and was backgrounded. Per the coordinator's
  instruction, I stopped waiting on it and moved on rather than blocking. It finished on its
  own well after the rest of this task was done, and its output is now available and confirms
  the diagnosis exactly:
  ```
  > prompt-for-codex-medical-knowledge-base@0.1.0 lint
  > node scripts/run-heavy.mjs --npm-script lint:internal

  DATABASE_HEAVY_RUN_ADMISSION_BUSY
  Another Database heavyweight command is active (PID 42780, worktree D:\Worktrees\Database\cc-2a-live, started 2026-08-22T06:31:47.361Z): vitest run --reporter=dot

  [exited with code 0]
  ```
  Exit code 0 here is the documented soft-skip-on-busy behaviour, not a pass — lint never
  actually ran. Recorded as "lint not run, lock held," per the read-output-not-exit-codes rule.
- **`npx prettier --write`** on both changed files: `ward-movements.ts` unchanged;
  `ward-flow-contracts.test.ts` reformatted (still 10/10 passing after).

## Officer screen — live DOM check

Ran a throwaway Playwright script from the repo root (deleted afterward, never committed) at
390x844 against `http://localhost:3718/ward-management/transport/officer` (server already
running, not restarted). For each of the 8 jobs found in the live DOM
(`WF-005, WF-006, WF-014, WF-015, WF-306, WF-313, WF-320, WF-327`), selected the job (or used
the one already active) and read each of the four action buttons' `aria-disabled` attribute
directly from the rendered page.

**Result: 8 of 8 jobs now have at least one available (non-`aria-disabled`) action**, counted
from the live DOM, up from 2 before this fix (WF-005 and WF-015, both `handover_ready` with an
available "En route" action). The six previously-dead jobs (WF-006, WF-014, WF-306, WF-313,
WF-320, WF-327) each now show "Arrived" as their available action — consistent with the fixture
now putting them at stage `"moving"` with `collectedAt` set and no `arrivedAt`, which is exactly
what `PATIENT_ARRIVED`'s guard requires.

## Files touched

- `src/components/ward-management/ward-movements.ts` — six `collectedAt` values (two literal,
  four via a generator fix).
- `tests/ward-flow-contracts.test.ts` — new `describe("fixture stage/stamp coherence
(ward-movements.ts)", ...)` block, three `it()`s, `wardMovements` import added.

## Commit

Single commit, staged by exact path (`git add src/components/ward-management/ward-movements.ts
tests/ward-flow-contracts.test.ts`): `1349c213fa6f3294a6a8fc22b0aded8c186e8429`
`fix(ward-flow): give every in-transit patient the collection its stage implies`. The
pre-commit docs hook ran the design-system-adoption regenerator (`54 components, 77 roots`),
reported documentation already synchronized, and did not need a scoped override — no
generated-doc drift was introduced by this change. `git status` is clean at HEAD.
