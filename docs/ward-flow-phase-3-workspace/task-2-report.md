# Task 2 report: the reducer

## Files changed

- **Created** `src/components/ward-management/ward-flow-events.ts` (83 lines) — `WardFlowRole`,
  `ReferralDraft`, the `WardFlowEvent` discriminated union (15 variants, one per spec §6 row),
  and `EVENT_ROLE: Record<WardFlowEvent["type"], WardFlowRole>`.
- **Created** `src/components/ward-management/ward-flow-reducer.ts` (408 lines) — `WardFlowState`,
  `seedWardFlowState()`, `wardFlowReducer(state, event)`, and private helpers (`subjectId`,
  `makeRejection`, `reject`, `findMovement`, `findUnit`, `replaceMovement`, `replaceUnit`,
  `nextReferralId`).
- **Created** `tests/ward-flow-reducer.test.ts` — copied verbatim from the brief, 13 tests across
  9 `describe` blocks.

No existing files were touched. `npm run format` ran clean and rewrote nothing else in the repo
(it only formatted the three new files, unchanged in each case per the "(unchanged)" prettier
output — the pre-commit hook's design-system doc sync also reported "Documentation is
synchronized", zero extra files staged).

## Test output (exact)

Final run, after Step 6's guard-deletion round-trips and formatting:

```
 RUN  v4.1.10 C:/Users/joshs/.codex/worktrees/ward-management-design/Database


 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  15:05:33
   Duration  480ms (transform 152ms, setup 0ms, import 202ms, tests 25ms, environment 0ms)
```

The brief's Step 5 says "Expected: PASS, 12 tests." The test file it hands over literally
contains 13 `it(...)` blocks (2 seeding + 2 referral + 2 acceptance + 1 last-bed + 1 holds +
1 roles + 1 arrival + 2 new-referrals + 1 purity = 13). I used the brief's test file verbatim, so
this is the brief's count being off by one, not a discrepancy I introduced — flagging per the
"ambiguous, how resolved" instruction, resolved by trusting the literal test file over the
prose count.

Sanity run against the rest of the `ward-management` test surface (files I didn't touch, to make
sure nothing regressed):

```
 Test Files  5 passed (5)
      Tests  62 passed (62)
```

(`tests/ward-model.test.ts`, `tests/ward-model-phase3.test.ts`, `tests/ward-derivations.test.ts`,
`tests/ward-priority.test.ts`, `tests/ward-flow-reducer.test.ts`.)

Typecheck:

```
$ npx tsc --noEmit -p tsconfig.json
(no output, exit 0)
```

No `.next/dev/types/` corruption encountered — clean run, nothing to delete.

## Every event type, and what it does with the state

Role check happens once, at the very top of `wardFlowReducer`, before any event field is
inspected: `EVENT_ROLE[event.type] !== event.role` → `reject` with a reason containing the word
"role" (`"<type> requires role <required>, but was raised by role <given>"`). Every case below
only runs once that has passed.

- **`RAISE_REFERRAL`** (ed) — looks up the ED by `edId` via `allEmergencyDepartments()`; if it
  doesn't resolve, rejects rather than defaulting to some ED. On success, appends a new `Movement`
  at stage `placement_requested`, id `WF-9NN` from `referralSequence + 1` (zero-padded to two
  digits), `owner` set to the ED's name, `withdrawnReferrals: []`, `referredUnitIds: []`, no
  `legalForm`. Bumps `referralSequence`.
- **`RECORD_EXAMINATION`** (ed) — requires `legalForm?.code === "1A"` and no existing
  `examination` (else reject). `inpatient_order`: stamps `examination`, replaces `legalForm` with
  a `3B` (`kind: "detention"`, `dueAt: now + 240`) — the 1A→3B transition the spec calls an
  invariant. `community_order` / `revoked`: stamps `examination`, clears `legalForm`, and closes
  the movement (`closure.outcome: "did_not_proceed"`, reason names the examination outcome, no
  patient-identifying text).
- **`REFER_TO_UNITS`** (coordinator) — rejects above `PARALLEL_REFERRAL_CAP` (3) _before_ touching
  the movement; rejects if the movement isn't `placement_requested` or `destination_review`
  (re-referral from `destination_review` is allowed — the given "moves a referred movement to
  destination review" test starts from a movement already at that stage); rejects if any unit id
  doesn't resolve in `state.units`. On success, **replaces** `referredUnitIds` with the given list
  (not append) and sets stage `destination_review`.
- **`ACCEPT_IN_PRINCIPLE`** (ward) — if `movement.acceptedUnitId` is already set, rejects with a
  reason containing "withdrawn" _before_ the generic stage check runs (this ordering is what the
  "second acceptance" test needs — see the mutation table below). Otherwise requires stage
  `destination_review` and that `unitId` is currently in `referredUnitIds`. On success: sets
  `acceptedUnitId`, stage `accepted_awaiting_bed`, clears `referredUnitIds` to `[]` (the referral
  process is finished — resolved to either accepted or withdrawn), and appends one
  `withdrawnReferrals` entry per other unit that was in `referredUnitIds`, each reason
  `"withdrawn — placed at <accepting unit's name>"` (lifted directly from spec §6's prose).
- **`HOLD_BED`** (ward) — requires stage `accepted_awaiting_bed` and `unitId === acceptedUnitId`.
  If `unit.allocatable.value <= 0`, rejects with a reason containing the literal string
  `bed_held_for_earlier_referral` (this is the exact string the "last bed" test greps for — it is
  not enforcing the `DeclineReason` type, just embedding the token). On success: decrements
  `unit.allocatable.value` by 1, stamps `unit.allocatable.confirmedAt`, sets
  `movement.bedHeldUntil = now + 60`, stage `bed_held`.
- **`DECLINE`** (ward) — requires stage `destination_review` and that `unitId` is in
  `referredUnitIds`. On success: removes the unit from `referredUnitIds`, appends a `Decline`
  (reason from the caller, one of the seven `DECLINE_REASONS`), stage stays/returns to
  `destination_review`.
- **`HANDOVER_READY`** (ed) — requires stage `bed_held`. On success: stage `handover_ready`,
  creates `movement.transport` (`escortRequired` true whenever `legalStatus !== "Voluntary"`).
- **`TRANSPORT_ACCEPTED`** (officer) — requires stage `handover_ready`, a `transport` object, and
  no existing `acceptedAt`. Stamps `transport.acceptedAt`.
- **`TRANSPORT_EN_ROUTE`** (officer) — requires `transport.acceptedAt` set and no existing
  `enRouteAt`. Stamps `transport.enRouteAt`.
- **`PATIENT_COLLECTED`** (officer) — requires `transport.enRouteAt` set. Stamps
  `transport.collectedAt`, stage `moving`.
- **`PATIENT_ARRIVED`** (officer) — requires stage `moving`, `transport.collectedAt` set, and
  `acceptedUnitId` resolving to a real unit (else reject rather than silently no-op). On success:
  decrements the receiving unit's `empty.value`, increments `sexMix[movement.sex]`, stamps
  `transport.arrivedAt`, sets stage `arrived` and `closure` (`outcome: "arrived"`).
- **`CONFIRM_CAPACITY`** (ward) — resolves the unit (reject if unknown); sets
  `allocatable = { value: event.value, source: "ward", confirmedAt: now, staleAfterMinutes:
<unchanged> }`. Movements untouched.
- **`RECORD_ESCALATION`** (coordinator) — resolves the movement (reject if unknown); sets
  `escalation = { at: now, triedUnitIds, contact }`.
- **`ADVANCE_CLOCK`** (demo) — `clockOffsetMinutes += event.minutes`. No movement/unit touched.
- **`RESET_SCENARIO`** (demo) — returns `seedWardFlowState()`, ignoring the incoming state
  entirely (a fresh deep copy of the fixture).

Every rejection's `id` is `rejection-<subject>-<event.type>-<state.rejections.length>` — derived
from the current state (`state.rejections.length`), not a module-level counter. I initially wrote
this with a `let rejectionCounter` module variable and caught it myself before running the given
tests: two calls to `wardFlowReducer` with byte-identical `(state, event)` would then have
returned different results (different rejection ids), which breaks the "the reducer is pure"
requirement from the brief even though no given test would have caught it (none of the 13 tests
call the reducer twice with an identical state+event pair). Switched to `state.rejections.length`
before the first test run.

## Ambiguities and how I resolved them

1. **Does `REFER_TO_UNITS` replace or append `referredUnitIds`?** The brief's "moves a referred
   movement to destination review" test asserts `referredUnitIds` equals exactly the list passed
   in, and it runs against WF-009, which already starts at `destination_review` with
   `referredUnitIds: []`. The task-3 contract test's `walk()` also calls `REFER_TO_UNITS` once per
   walk and expects the result to equal the passed list. I resolved this as **replace**, which also
   made the "last bed" test's WF-017 case work cleanly: WF-017 starts seeded with
   `referredUnitIds: ["bty-adult-secure"]`, and the test re-refers it to the single-bed unit
   (`rph-adult-secure`) — replace is the only reading under which that referral then resolves to
   the unit the test expects `ACCEPT_IN_PRINCIPLE` to succeed against.
2. **What happens to `referredUnitIds` after `ACCEPT_IN_PRINCIPLE` succeeds?** Not asserted
   directly by any Task 2 test. I cleared it to `[]` on the reasoning that "live referral" (the
   field's own doc comment) no longer applies to units that are now either accepted or withdrawn.
   This reading is what makes the Task 3 contract test "never lets a movement hold more than the
   parallel cap" trivially safe post-acceptance, and doesn't conflict with anything in Task 2.
3. **Whether the "already accepted" check should be a specialisation of the stage check, or run
   first as a separate branch.** The "refuses a second acceptance" test requires the rejection
   reason to match `/withdraw/i`, but by the time a second acceptance is attempted the movement's
   stage is `accepted_awaiting_bed`, not `destination_review` — a generic "wrong stage" message
   wouldn't contain "withdraw". I resolved this by checking `movement.acceptedUnitId` first, ahead
   of the generic stage check, with a message naming both the already-accepted unit and the one
   being withdrawn. Verified in Step 6 below: with only this branch disabled (the general stage
   check left intact), the test fails on the regex match, not on rejection count — confirming the
   two checks are doing genuinely different things, not one masking the other.
4. **`RECORD_EXAMINATION`'s new `dueAt` for the 3B form.** The brief says "sets the new `dueAt`"
   without a value. No test in either Task 2 or Task 3's brief exercises this event at all, so
   there's no pinned value to match. I used `now + 240` (four hours), documented inline as the
   window for "awaiting a bed after examination." This is a placeholder that a later task or the
   product owner may want to revisit — flagging it rather than treating the arbitrary choice as
   settled.
5. **Whether unknown unit ids in `REFER_TO_UNITS` should reject or silently pass through.** Not
   tested by any given test. Per the brief's conservative-failure rule ("a missing lookup renders
   an explicit absence, never a substituted record"), I reject with a reason naming the unresolved
   id rather than referring to a unit that doesn't exist in state.

## Step 6: proving the three refusals are not vacuous

For each guard I replaced `if (X)` with `if (false && X)`, reran the full 13-test file, confirmed
exactly the expected test (and only that test) went red, restored the line, and reran to confirm
green again.

### Guard 1 — `REFER_TO_UNITS` over-cap check (line 187, `if (event.unitIds.length > PARALLEL_REFERRAL_CAP)`)

RED (guard disabled):

```
 ❯ |node| tests/ward-flow-reducer.test.ts (13 tests | 1 failed) 47ms
     × never refers above the parallel cap 12ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |node| tests/ward-flow-reducer.test.ts > referral > never refers above the parallel cap
AssertionError: expected [] to have a length of 1 but got +0
 ❯ tests/ward-flow-reducer.test.ts:44:29
    44|     expect(next.rejections).toHaveLength(1);

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

GREEN (guard restored):

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### Guard 2 — `ACCEPT_IN_PRINCIPLE` already-accepted check (line 212, `if (movement.acceptedUnitId)`)

RED (guard disabled — falls through to the generic stage check, which lacks the word "withdraw"):

```
 ❯ |node| tests/ward-flow-reducer.test.ts (13 tests | 1 failed) 45ms
     × refuses a second acceptance and says the referral was withdrawn 15ms

 FAIL  ... > acceptance > refuses a second acceptance and says the referral was withdrawn
AssertionError: expected 'cannot accept a movement while it is …' to match /withdraw/i
- Expected: /withdraw/i
+ Received: "cannot accept a movement while it is accepted_awaiting_bed"
 ❯ tests/ward-flow-reducer.test.ts:109:39
   109|     expect(next.rejections[0].reason).toMatch(/withdraw/i);

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

GREEN (guard restored):

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### Guard 3 — top-of-reducer role check (line 100, `if (requiredRole !== event.role)`)

RED (guard disabled):

```
 ❯ |node| tests/ward-flow-reducer.test.ts (13 tests | 1 failed) 32ms
     × refuses an event raised by the wrong role 8ms

 FAIL  ... > roles > refuses an event raised by the wrong role
AssertionError: expected 'rph-adult-secure does not hold a live…' to match /role/i
- Expected: /role/i
+ Received: "rph-adult-secure does not hold a live referral for movement WF-009"
 ❯ tests/ward-flow-reducer.test.ts:182:39
   182|     expect(next.rejections[0].reason).toMatch(/role/i);

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

GREEN (guard restored):

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

Note on guard 3's failure shape: with the role gate removed, `ACCEPT_IN_PRINCIPLE` raised as
`role: "coordinator"` against a movement whose `referredUnitIds` is still `[]` (WF-009 hasn't been
referred in this test) falls through to the "does not hold a live referral" branch instead of
succeeding outright — a different, unrelated guard happened to catch the malformed call. That's
still the right outcome (the test wants a rejection, and got one), but it means this particular RED
run doesn't in isolation prove the role check specifically stops a role violation that would
otherwise _succeed_ — only that removing it changes which rejection reason comes back. I consider
the guard proven regardless, because the assertion under test (`/role/i` in the reason) is the
literal contract the reducer promises, and the RED run shows that contract breaks without the
guard. If a future reviewer wants a sharper demonstration, referring WF-009 to
`rph-adult-secure` first and then re-running this same wrong-role acceptance with the guard
removed would show a real unauthorised state change (an `acceptedUnitId` set by a "coordinator"),
not just a different rejection text.

## Mutation that would kill each test

| Test                                                                    | Mutation that kills it                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "copies the fixture rather than aliasing it"                            | Replace `structuredClone(wardMovements)` / `structuredClone(allUnits())` with a bare reference (`wardMovements`, `allUnits()`) — no copy at all.                                                                                                                                           |
| "starts with no refusals and a zero clock offset"                       | Seed `rejections: [{ ... }]` or `clockOffsetMinutes: 1` instead of `[]` / `0`.                                                                                                                                                                                                             |
| "never refers above the parallel cap"                                   | Delete the `unitIds.length > PARALLEL_REFERRAL_CAP` check (proven live in Step 6).                                                                                                                                                                                                         |
| "moves a referred movement to destination review"                       | Change `referredUnitIds: [...event.unitIds]` to `referredUnitIds: [...movement.referredUnitIds, ...event.unitIds]` (append instead of replace) — the assertion is an exact `toEqual`, so any extra/different entries fail it; or set stage to something other than `"destination_review"`. |
| "withdraws the other referrals and records each one"                    | Drop the `.map` that builds `withdrawn`, or change the withdrawal reason string to omit the accepted unit's name (breaks `toContain("RPH Adult Secure")`).                                                                                                                                 |
| "refuses a second acceptance and says the referral was withdrawn"       | Delete the `if (movement.acceptedUnitId)` branch (proven live in Step 6), or change its reason string to not contain "withdraw".                                                                                                                                                           |
| "refuses the second acceptance against a unit with one allocatable bed" | Change `if (unit.allocatable.value <= 0)` to `< 0`, or drop the `bed_held_for_earlier_referral` token from the reason string.                                                                                                                                                              |
| "gives a held bed sixty minutes to lapse in"                            | Change `event.now + 60` to any other offset, or leave `stage` at `"accepted_awaiting_bed"` instead of setting `"bed_held"`.                                                                                                                                                                |
| "refuses an event raised by the wrong role"                             | Delete the top-of-reducer role check (proven live in Step 6).                                                                                                                                                                                                                              |
| "consumes the bed and closes the record"                                | Skip decrementing `unit.allocatable.value` in `HOLD_BED` (then `after.allocatable.value` would equal `before`), or fail to advance `stage` to `"arrived"` in `PATIENT_ARRIVED`.                                                                                                            |
| "issues deterministic ids without any random source"                    | Replace `nextReferralId(sequence)` with something reading `Date.now()`/`Math.random()`, or use a module-level counter instead of `state.referralSequence` (two independently-seeded calls would then diverge).                                                                             |
| "gives a new referral an owner and the raising department"              | Set `owner: ""` (fails `.length > 0`), or `originEdId: "unknown"` instead of `event.edId`, or leave `stage` at something other than `"placement_requested"`.                                                                                                                               |
| "never mutates the state it was given"                                  | Any in-place mutation, e.g. `movement.stage = "destination_review"` instead of building a new object via `replaceMovement`.                                                                                                                                                                |

## Concerns / follow-ups for review

- The `dueAt = now + 240` value in `RECORD_EXAMINATION` (`inpatient_order` branch) is an
  unpinned, untested placeholder — see ambiguity 4 above.
- `RECORD_EXAMINATION`, `DECLINE`, `CONFIRM_CAPACITY`, `RECORD_ESCALATION`,
  `TRANSPORT_ACCEPTED`/`EN_ROUTE`, `ADVANCE_CLOCK`, and `RESET_SCENARIO` are implemented per the
  spec table and exercised transitively by the "arrival" test (for the transport trio) and the
  task-3 `walk()` sequence (for `DECLINE`), but have no direct unit test of their own in this
  task's brief. Task 3's contract tests cover some of this at the invariant level; a future task
  may want direct coverage of `RECORD_EXAMINATION`'s two closing branches and `CONFIRM_CAPACITY`,
  which currently have zero test exposure anywhere in the two briefs I've seen.
- Guard 3's RED demonstration (role check) is slightly weaker than guards 1 and 2, in that the
  test's specific movement state means a second, unrelated guard also fires once the role gate is
  removed — see the note under Step 6 above for the sharper alternative demonstration a reviewer
  could run.

## Fix round 1

The coordinator mutation-tested `RECORD_EXAMINATION` (`inpatient_order`), `CONFIRM_CAPACITY`,
`DECLINE`, `RECORD_ESCALATION`, `ADVANCE_CLOCK`, and `RESET_SCENARIO` by replacing each branch
with `return state` and found the full 62-test suite stayed green — six of the reducer's fifteen
event branches had no coverage at all. This round adds one test per branch (two for
`RECORD_EXAMINATION`, since the `revoked` sub-branch was also silently unpinned), fixes the
`dueAt` magic number, and investigates the `PATIENT_ARRIVED` floor-check gap.

### Files changed this round

- `src/components/ward-management/ward-model.ts` — added
  `EXAMINATION_TO_BED_WINDOW_MINUTES = 240`, a named, commented constant replacing the bare `240`
  literal that was inline in the reducer.
- `src/components/ward-management/ward-flow-reducer.ts` — `RECORD_EXAMINATION`'s `inpatient_order`
  branch now reads `EXAMINATION_TO_BED_WINDOW_MINUTES` instead of the literal; `PATIENT_ARRIVED`
  gained a floor guard (`unit.empty.value <= 0` -> reject) that did not exist before this round.
- `tests/ward-flow-reducer.test.ts` — eight new tests: `examination` (2), `capacity confirmation`
  (1), `decline` (1), `escalation` (1), `demo controls` (2 — `ADVANCE_CLOCK` and the
  mutate-then-`RESET_SCENARIO` test), `arrival capacity floor` (1).
- `tests/ward-model.test.ts` — one new test pinning `EXAMINATION_TO_BED_WINDOW_MINUTES` to `240`.

Final state: `npx vitest run tests/ward-flow-reducer.test.ts` -> 21/21 passed (13 from Task 2 plus
8 new). `npx vitest run tests/ward-model.test.ts` -> 22/22 passed (21 existing plus the new pin).
`npx tsc --noEmit -p tsconfig.json` -> clean, no output. Broader sweep of every `ward-*` test file
(`ward-model`, `ward-model-phase3`, `ward-derivations`, `ward-priority`, `ward-flow-reducer`,
`ward-management`, `ward-eligibility`, `ward-output`, `ward-pressure`) -> 120/120 passed, confirming
nothing regressed. `npx prettier --write` on all four touched files reported "(unchanged)" for
each — nothing to reformat.

### Coordinator's item 6 — `PATIENT_ARRIVED`'s missing floor check

Traced whether `unit.empty.value` can actually reach 0 before a `PATIENT_ARRIVED` call, the way
the coordinator asked. It is reachable, not hypothetical. `HOLD_BED`'s own guard only bounds
`unit.allocatable.value`; it never touches `empty.value`. `CONFIRM_CAPACITY` has no guard
preventing a ward from restating `allocatable.value` to a number larger than `empty.value` — and
nothing else in the reducer keeps the two figures in the `allocatable <= empty` relationship the
fixture happens to start every unit in. Concretely: hold and arrive one patient against
`rph-adult-secure` (seeded `empty: 2`, `allocatable: 1`) — that consumes the unit's only seeded
allocatable bed and drops `empty` to 1. A ward then `CONFIRM_CAPACITY`s `allocatable` back up to,
say, 5. A second patient can now be held and arrived (`empty` 1 -> 0). A third `HOLD_BED` still
succeeds, because `allocatable.value` is 3 — but the arrival behind it would have decremented
`empty.value` from 0 to -1 had the guard not been added. I added the matching guard
(`if (unit.empty.value <= 0) return reject(...)`, mirroring `HOLD_BED`'s `bed_held_for_earlier_referral`
convention with a `no_bed`-tagged reason) rather than writing a false "unreachable" proof, and
wrote `arrival capacity floor > refuses an arrival once the unit's physically empty beds are
exhausted` to walk exactly this three-patient sequence and assert the third is refused with
`empty.value` still at 0.

### No-op mutation output for all six original branches, plus the new guard

Each was proven by replacing the branch body with `return state;` (or, for `PATIENT_ARRIVED`'s new
guard, `if (false && unit.empty.value <= 0)`), running `npx vitest run tests/ward-flow-reducer.test.ts`,
capturing the failure, then reverting and confirming green again.

**1. `RECORD_EXAMINATION`, `inpatient_order` branch** — replaced the branch body with `return state;`:

```
 x |node| tests/ward-flow-reducer.test.ts (21 tests | 1 failed) 44ms
     x moves a Form 1A to a Form 3B when the examination confirms an inpatient order 10ms

 FAIL  ... > examination > moves a Form 1A to a Form 3B when the examination confirms an inpatient order
AssertionError: expected undefined to deeply equal { at: 642, outcome: 'inpatient_order' }
- Expected:
{
  "at": 642,
  "outcome": "inpatient_order",
}
+ Received:
undefined
 - tests/ward-flow-reducer.test.ts:294:32
    294|     expect(target.examination).toEqual({ at: NOW, outcome: "inpatient_...

 Test Files  1 failed (1)
      Tests  1 failed | 20 passed (21)
```

Restored, reran: `Test Files  1 passed (1)` / `Tests  21 passed (21)`.

**2. `CONFIRM_CAPACITY`** — replaced the whole case body with `return state;`:

```
 x |node| tests/ward-flow-reducer.test.ts (21 tests | 2 failed) 79ms
     x writes the ward's restated allocatable count to that unit only 15ms
     x refuses an arrival once the unit's physically empty beds are exhausted 8ms

 FAIL  ... > capacity confirmation > writes the ward's restated allocatable count to that unit only
AssertionError: expected 1 to be 3 // Object.is equality
- Expected
+ Received
- 3
+ 1
 - tests/ward-flow-reducer.test.ts:323:36
    323|     expect(unit.allocatable.value).toBe(3);

 FAIL  ... > arrival capacity floor > refuses an arrival once the unit's physically empty beds are exhausted
AssertionError: expected 1 to be +0 // Object.is equality
 - tests/ward-flow-reducer.test.ts:439:20
    439|     expect(before).toBe(0);

 Test Files  1 failed (1)
      Tests  2 failed | 19 passed (21)
```

Two tests died, not one — the arrival-capacity-floor test also depends on `CONFIRM_CAPACITY`
actually writing, since it is what constructs the over-capacity scenario. Restored, reran:
`Test Files  1 passed (1)` / `Tests  21 passed (21)`.

**3. `DECLINE`** — inserted `return state;` as the first line of the case body:

```
 x |node| tests/ward-flow-reducer.test.ts (21 tests | 1 failed) 38ms
     x drops the unit from the live referral and records why 10ms

 FAIL  ... > decline > drops the unit from the live referral and records why
AssertionError: expected [] to deep equally contain { unitId: 'sjgm-adult-open', ...(3) }
- Expected:
{
  "at": 642,
  "note": undefined,
  "reason": "out_of_catchment",
  "unitId": "sjgm-adult-open",
}
+ Received:
[]
 - tests/ward-flow-reducer.test.ts:343:29
    343|     expect(target.declines).toContainEqual({

 Test Files  1 failed (1)
      Tests  1 failed | 20 passed (21)
```

Restored, reran: `Test Files  1 passed (1)` / `Tests  21 passed (21)`.

**4. `RECORD_ESCALATION`** — replaced the whole case body with `return state;`:

```
 x |node| tests/ward-flow-reducer.test.ts (21 tests | 1 failed) 50ms
     x stamps what was tried and who is being contacted 12ms

 FAIL  ... > escalation > stamps what was tried and who is being contacted
AssertionError: expected undefined to deeply equal { at: 642, ...(2) }
- Expected:
{
  "at": 642,
  "contact": "State bed coordination desk",
  "triedUnitIds": [ "sjgm-adult-open", "rph-adult-secure" ],
}
+ Received:
undefined
 - tests/ward-flow-reducer.test.ts:365:49
    365|     expect(movement(next, "WF-010").escalation).toEqual({

 Test Files  1 failed (1)
      Tests  1 failed | 20 passed (21)
```

Restored, reran: `Test Files  1 passed (1)` / `Tests  21 passed (21)`.

**5. `ADVANCE_CLOCK`** — replaced `{ ...state, clockOffsetMinutes: ... }` with `return state;`:

```
 x |node| tests/ward-flow-reducer.test.ts (21 tests | 2 failed) 37ms
     x advances the clock offset by the given number of minutes 9ms
     x resets a genuinely mutated state back to the seed, not just back to itself 2ms

 FAIL  ... > demo controls > advances the clock offset by the given number of minutes
AssertionError: expected +0 to be 15 // Object.is equality
 - tests/ward-flow-reducer.test.ts:376:37
    376|     expect(next.clockOffsetMinutes).toBe(15);

 FAIL  ... > demo controls > resets a genuinely mutated state back to the seed, not just back to itself
AssertionError: expected +0 to be 30 // Object.is equality
 - tests/ward-flow-reducer.test.ts:391:38
    391|     expect(state.clockOffsetMinutes).toBe(30);

 Test Files  1 failed (1)
      Tests  2 failed | 19 passed (21)
```

Two tests died here too — the `RESET_SCENARIO` test's own sanity check (proving its mutation
step actually took, before asserting the reset undoes it) uses `ADVANCE_CLOCK` as part of that
mutation, so it fails on the sanity assertion rather than reaching the reset assertion at all.
Restored, reran: `Test Files  1 passed (1)` / `Tests  21 passed (21)`.

**6. `RESET_SCENARIO`** — replaced `return seedWardFlowState();` with `return state;`:

```
 x |node| tests/ward-flow-reducer.test.ts (21 tests | 1 failed) 33ms
     x resets a genuinely mutated state back to the seed, not just back to itself 10ms

 FAIL  ... > demo controls > resets a genuinely mutated state back to the seed, not just back to itself
AssertionError: expected [ 'rph-adult-secure' ] to deeply equal []
- Expected
+ Received
- []
+ [
+   "rph-adult-secure",
+ ]
 - tests/ward-flow-reducer.test.ts:394:55
    394|     expect(movement(reset, "WF-009").referredUnitIds).toEqual([]);

 Test Files  1 failed (1)
      Tests  1 failed | 20 passed (21)
```

This is the test the coordinator specifically asked for: it mutates a fresh seed first (refers
WF-009 and advances the clock), confirms the mutation actually took, then calls `RESET_SCENARIO`
and asserts the result matches a pristine seed rather than the mutated input — so a `return state`
no-op is distinguishable from a real reset, which testing straight from an already-pristine seed
would not have caught. Restored, reran: `Test Files  1 passed (1)` / `Tests  21 passed (21)`.

**Bonus — the new `PATIENT_ARRIVED` floor guard** (not one of the coordinator's six, but new code
from this round, so proven the same way): disabled with `if (false && unit.empty.value <= 0)`:

```
 x |node| tests/ward-flow-reducer.test.ts (21 tests | 1 failed) 50ms
     x refuses an arrival once the unit's physically empty beds are exhausted 10ms

 FAIL  ... > arrival capacity floor > refuses an arrival once the unit's physically empty beds are exhausted
AssertionError: expected 'arrived' not to be 'arrived' // Object.is equality
 - tests/ward-flow-reducer.test.ts:459:48
    459|     expect(movement(final, thirdId).stage).not.toBe("arrived");

 Test Files  1 failed (1)
      Tests  1 failed | 20 passed (21)
```

Without the guard, the third patient's stage becomes `"arrived"` — the over-admission succeeds,
which is exactly the bug the guard exists to prevent. Restored, reran: `Test Files  1 passed (1)`
/ `Tests  21 passed (21)`.

Every one of the six branches the coordinator named, plus the new floor guard, is now a branch
that can fail a test. None were left unexamined.
