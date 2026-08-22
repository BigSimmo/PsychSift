# Task 3 report — Ward Flow Phase 3: the contracts

## What changed

One file created, verbatim from the brief:

- `tests/ward-flow-contracts.test.ts` — new. Contains the `walk()` helper and the
  `describe("invariants across every reachable state", ...)` block exactly as specified in
  `task-3-brief.md` Step 1, no edits. No implementation files were touched (Task 2's reducer,
  model, and events files are consumed as-is; every symbol the test imports —
  `seedWardFlowState`, `wardFlowReducer`, `WardFlowState`, `PARALLEL_REFERRAL_CAP`,
  `NOW_ANCHOR`, `unitCapacity`, `eligibility` — already existed with matching signatures, so
  no source change was needed to make the file compile or pass).

No other files were modified in the final state. The `git diff --stat` against `HEAD` for
`src/components/ward-management/ward-flow-reducer.ts` is empty; the only tracked change is the
new test file.

## Test output (first run, clean)

```
$ npx vitest run tests/ward-flow-contracts.test.ts --reporter=verbose

 RUN  v4.1.10 C:/Users/joshs/.codex/worktrees/ward-management-design/Database

 ✓ |node| tests/ward-flow-contracts.test.ts > invariants across every reachable state > never lets a movement hold more than the parallel cap 19ms
 ✓ |node| tests/ward-flow-contracts.test.ts > invariants across every reachable state > keeps every unit's beds accounting for, before and after every event 16ms
 ✓ |node| tests/ward-flow-contracts.test.ts > invariants across every reachable state > never leaves a movement ownerless 11ms
 ✓ |node| tests/ward-flow-contracts.test.ts > invariants across every reachable state > never returns a declined unit to that patient's eligible candidates 2ms
 ✓ |node| tests/ward-flow-contracts.test.ts > invariants across every reachable state > records a withdrawal whenever a referral ends without a decline 1ms
 ✓ |node| tests/ward-flow-contracts.test.ts > invariants across every reachable state > never lets the statutory form disagree with the examination 9ms
 ✓ |node| tests/ward-flow-contracts.test.ts > invariants across every reachable state > keeps every rendered string free of anything identifying a person 52ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  15:52:58
   Duration  1.35s (transform 299ms, setup 0ms, import 567ms, tests 113ms, environment 0ms)
```

No red phase was needed for this task: Task 2's reducer already implements every transition
the walk exercises, so the test passed on first write. Per the "Follow the brief's TDD order"
instruction, I ran it immediately after writing it (the "watch it fail" step doesn't apply here
because there is no missing implementation to drive — this is a pure consumer of Task 2's
already-green code) and confirmed pass before moving to the mutation-kill exercise, which is
where the real "does this test detect a broken reducer" verification for this task lives.

Final confirmation rerun (after all seven mutation/revert cycles, proving the working tree is
byte-identical to the clean state):

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  16:06:37
   Duration  1.70s
```

`git diff --stat src/components/ward-management/ward-flow-reducer.ts` — empty, confirming every
mutation below was fully reverted.

## Typecheck

```
$ npx tsc --noEmit 2>&1 | grep -E "^(src|tests|scripts)/"
(no output)
```

Zero errors anywhere in the run (not just filtered to `src/`/`tests/`/`scripts/` — the whole
`tsc --noEmit` invocation produced no output at all, so there was nothing in `.next/dev/types/`
to filter out either).

## Format

`npx prettier --write tests/ward-flow-contracts.test.ts` reported `unchanged` — the file as
written already matches the repo's Prettier config (it is the brief's code verbatim). I ran the
single-file `prettier --write` rather than `npm run format` because the brief's own trap list
warned it can hang for minutes on lock contention, and running it against only the one file this
task touched is sufficient here — nothing else in the working tree changed.

## The walk, step by step

Movement `WF-009` (Peel ED, Adult/Secure/Male, Involuntary inpatient, already on form 3B with an
`inpatient_order` examination recorded 45 minutes before `NOW_ANCHOR` in the seed fixture) is
carried through nine events:

| #   | Event                                                         | Role        | Precondition satisfied                                        | Resulting stage                                                                           |
| --- | ------------------------------------------------------------- | ----------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `REFER_TO_UNITS` → `["rph-adult-secure", "fsh-adult-secure"]` | coordinator | stage was `destination_review` (seeded)                       | `destination_review`, `referredUnitIds = [rph, fsh]`                                      |
| 2   | `DECLINE` fsh-adult-secure, `out_of_catchment`                | ward        | fsh was in `referredUnitIds`                                  | `referredUnitIds = [rph]`, new decline appended                                           |
| 3   | `ACCEPT_IN_PRINCIPLE` rph-adult-secure                        | ward        | rph was in `referredUnitIds`, not yet accepted                | `accepted_awaiting_bed`, `acceptedUnitId = rph`, `referredUnitIds = []`                   |
| 4   | `HOLD_BED` rph-adult-secure                                   | ward        | stage was `accepted_awaiting_bed`, unit had 1 allocatable bed | `bed_held`, unit `allocatable.value` 1→0                                                  |
| 5   | `HANDOVER_READY`                                              | ed          | stage was `bed_held`                                          | `handover_ready`, transport job created (escort required — legal status is not Voluntary) |
| 6   | `TRANSPORT_ACCEPTED`                                          | officer     | transport existed, not yet accepted                           | `transport.acceptedAt` set                                                                |
| 7   | `TRANSPORT_EN_ROUTE`                                          | officer     | transport accepted, not yet en route                          | `transport.enRouteAt` set                                                                 |
| 8   | `PATIENT_COLLECTED`                                           | officer     | transport en route                                            | `moving`, `transport.collectedAt` set                                                     |
| 9   | `PATIENT_ARRIVED`                                             | officer     | stage `moving`, collected, unit had 1 physically-empty bed    | `arrived`, unit `empty.value` 2→1, `sexMix.Male` +1, `closure` recorded                   |

No event was rejected; `state.rejections` stays `[]` across all ten states in `walk()`'s
returned array (the seed state plus one state per event).

## Ambiguity encountered and how it was resolved

The brief's Step 2 says "Expected: PASS, 6 tests." The verbatim test code in Step 1 contains
seven `it(...)` blocks (I counted them twice against the pasted code and against the actual
file). I did not add, remove, or rename any test — I transcribed Step 1 exactly as given, per
the instruction that the brief's code is "the exact values to use verbatim." The run output
above shows `Tests 7 passed (7)`, which I'm reporting as the true, verified count rather than
silently reconciling it to the brief's stated "6" or altering the test file to match. This is
worth flagging to whoever wrote the brief in case "6" reflects a stale/earlier draft of the
walk.

## Invariant vs. reducer-mutation-that-kills-it

This is the required verification-before-completion pass: for each of the seven invariants, I
identified a candidate reducer mutation, applied it with `Edit`, ran
`npx vitest run tests/ward-flow-contracts.test.ts --reporter=verbose`, captured the failure (or,
for two invariants, the surprising absence of one), then reverted with
`git checkout -- src/components/ward-management/ward-flow-reducer.ts` and confirmed
`git diff --stat` was empty before moving to the next one. All mutations were applied and
reverted one at a time — never combined.

Two of the seven turned out to be **vacuous for this specific walk** — the invariant is real and
enforced elsewhere in the system, but this particular nine-event walk never puts it under
strain, so a broken reducer would ship silently past this test. Those are flagged explicitly
below (invariants 4 and 5) with the evidence, since finding that was the actual point of this
exercise.

| #   | Invariant                                                      | Reducer mutation                                                                                                                                                         | Outcome                                                                                         |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1   | Parallel referral cap                                          | `REFER_TO_UNITS`: `referredUnitIds: [...event.unitIds]` → `[...event.unitIds, "mutation-pad-a", "mutation-pad-b"]`                                                       | **Fails** — real kill                                                                           |
| 2   | Bed accounting partition                                       | `PATIENT_ARRIVED`: `value: unit.empty.value - 1` → `value: unit.beds + 1`                                                                                                | **Fails** — real kill (see note on why a smaller/more natural corruption would not have worked) |
| 3   | Movement never ownerless                                       | `HOLD_BED`: added `owner: ""` to `updatedMovement`                                                                                                                       | **Fails** — real kill                                                                           |
| 4   | Declined unit never eligible                                   | `DECLINE`: `declines: [...movement.declines, {...}]` → `declines: movement.declines` (drop the push entirely)                                                            | **Still passes** — vacuous for this walk/fixture, see below                                     |
| 5   | Withdrawal recorded whenever a referral ends without a decline | `ACCEPT_IN_PRINCIPLE`: `withdrawnReferrals: [...movement.withdrawnReferrals, ...withdrawn]` → `withdrawnReferrals: movement.withdrawnReferrals` (drop the push entirely) | **Still passes** — vacuous for this walk/fixture, see below                                     |
| 6   | Statutory form never disagrees with examination                | `HOLD_BED`: added `legalForm: { code: "1A", label: "Referral for examination", kind: "detention", dueAt: event.now + 1 }` to `updatedMovement`                           | **Fails** — real kill                                                                           |
| 7   | No identifying text in rendered strings                        | `HOLD_BED`: inserted `return reject(state, event, "diagnosis of paranoid schizophrenia noted on file");` as the first statement in the case body                         | **Fails** — real kill, but required forcing a rejection to occur at all (see note)              |

### Invariant 1 — real kill, evidence

```
 × never lets a movement hold more than the parallel cap 14ms
   → expected 4 to be less than or equal to 3
AssertionError: expected 4 to be less than or equal to 3
 ❯ tests/ward-flow-contracts.test.ts:38:49
```

### Invariant 2 — real kill, evidence, and why the "natural" bug wouldn't have worked

```
 × keeps every unit's beds accounting for, before and after every event 63ms
   → expected 21 to be 20 // Object.is equality
```

`unitCapacity()` in `ward-derivations.ts` is deliberately written to be robust to bad
`allocatable`/`blocked` data — its own docstring says authored data that over- or
under-counts "can never push the total past `unit.beds` or leave a bed unaccounted for." I
worked through the algebra: `available + held` always equals `unit.empty.value` exactly (the
`max(...,0)` clamp in `held`'s formula never actually engages, because `available =
min(allocatable, empty) <= empty` always), and `blocked + occupied` always equals
`max(unit.beds - unit.empty.value, 0)` exactly for the same reason. So the sum only fails to
equal `unit.beds` when `unit.empty.value` itself exceeds `unit.beds` — nothing else corrupts
it, not a bad `allocatable.value`, not a negative `empty.value`, not a bad `blocked`. Given
that, the walk's single `PATIENT_ARRIVED` call only ever decrements `empty.value` by 1 (from 2
to 1 for `rph-adult-secure`, whose `beds` is 20) — an off-by-one or even an off-by-several bug
in that line would not have broken this invariant, because it's nowhere near the 20-bed
ceiling. I had to inject a deliberately large corruption (`unit.beds + 1`) to demonstrate the
kill mechanism actually works; a more realistic single-step sign or index bug in `PATIENT_ARRIVED`
would pass this test undetected for this walk.

### Invariant 3 — real kill, evidence

```
 × never leaves a movement ownerless 12ms
   → expected 0 to be greater than 0
AssertionError: expected 0 to be greater than 0
 ❯ tests/ward-flow-contracts.test.ts:55:46
```

### Invariant 4 — vacuous for this walk, evidence

I removed the `DECLINE` handler's push into `movement.declines` entirely (`declines:
movement.declines` instead of appending the new entry). Rerun:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

**Still fully green**, including the invariant under test. Root cause, confirmed by probing
`WF-009`'s seed fixture (`src/components/ward-management/ward-movements.ts` lines ~215–244):
the fixture already carries five pre-seeded `declines` entries for `WF-009`, and they cover
**both** units the walk refers to — `rph-adult-secure` (`reason: "no_bed"`) and
`fsh-adult-secure` (`reason: "specialling_unavailable"`). The walk's own `DECLINE` event on
`fsh-adult-secure` merely adds a _second_, redundant decline entry for a unit that was already
declined before the walk started. So the invariant's check — "every unit id present in
`target.declines` is ineligible" — passes regardless of whether `DECLINE` itself records
anything, because `eligibility()`'s `prior_decline` gate in `ward-eligibility.ts` is defined
_directly_ from `movement.declines` membership (`declined = movement.declines.some(d =>
d.unitId === unit.id)`, then `gates.every(pass)` requires that gate to pass). Any unit id that
ends up in `declines` — by any mechanism, including one that never went through the reducer at
all — is automatically ineligible by construction. This makes the invariant, as written against
this particular movement/fixture/walk, structurally unable to detect a broken `DECLINE`
handler: I could not find any reducer-only mutation that makes it fail, because the assertion
and the thing it's checking are drawn from the same self-referential gate.

### Invariant 5 — vacuous for this walk, evidence

I removed the withdrawal push in `ACCEPT_IN_PRINCIPLE` entirely (`withdrawnReferrals:
movement.withdrawnReferrals` instead of appending the computed `withdrawn` entries). Rerun:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

**Still fully green.** I confirmed the mechanism by instrumenting a throwaway probe script
(written to a scratch test file, run once, then deleted before continuing — it never touched
tracked files) that dumped the walk's final state: `state.rejections` is `[]` throughout, and
`WF-009`'s own `withdrawnReferrals` stays `[]` at every step of this walk — the `withdrawn`
array computed inside `ACCEPT_IN_PRINCIPLE` is genuinely empty for this call, because by the
time `ACCEPT_IN_PRINCIPLE` runs, `referredUnitIds` only still contains `rph-adult-secure`
itself (the walk's own `DECLINE` step already removed `fsh-adult-secure` from it two events
earlier), so filtering out the unit being accepted leaves nothing to withdraw. The invariant's
loop only checks the two hardcoded unit ids `["rph-adult-secure", "fsh-adult-secure"]`: one is
skipped via `if (unitId === target.acceptedUnitId) continue`, and the other is satisfied via
`endedByDecline` — which, as with invariant 4, is already true from the fixture's pre-seeded
declines before the walk's own `DECLINE` event even runs. Neither unit id in the test's loop
can ever reach the `endedByWithdrawal` branch in this walk, so a completely disabled withdrawal
mechanism is invisible to this test.

### Invariant 6 — real kill, evidence

```
 × never lets the statutory form disagree with the examination 10ms
   → expected { at: 597, outcome: 'inpatient_order' } to be undefined
AssertionError: expected { at: 597, outcome: 'inpatient_order' } to be undefined
 ❯ tests/ward-flow-contracts.test.ts:87:57
```

This one is genuinely walk-reachable: `WF-009` already has `examination` set from the seed
fixture, so forcing `HOLD_BED` to also assign `legalForm.code = "1A"` immediately creates a
1A-with-an-examination-already-recorded state, which the invariant catches on the very next
`state` in the walk.

### Invariant 7 — real kill, but only by force

`state.rejections` is empty at every step of the unmutated walk (no event is ever rejected), so
the first half of this invariant (looping over `state.rejections`) is not naturally exercised
either. To get a real failure I had to force a rejection to happen — I inserted
`return reject(state, event, "diagnosis of paranoid schizophrenia noted on file");` as the very
first statement of the `HOLD_BED` case (before its normal precondition checks), guaranteeing a
rejection with forbidden text lands in `state.rejections` on step 4. Result:

```
 × keeps every rendered string free of anything identifying a person 15ms
   → expected 'diagnosis of paranoid schizophrenia n…' not to match /\b(name|dob|date of birth|mrn|medica…/i
AssertionError: expected 'diagnosis of paranoid schizophrenia noted on file' not to match /\b(name|dob|date of birth|mrn|medical record|address|diagnosis)\b/i
 ❯ tests/ward-flow-contracts.test.ts:97:38
```

This confirms the regex/assertion machinery itself works correctly when a forbidden word does
reach `state.rejections` or `movement.withdrawnReferrals` — but this walk's own nine events
never naturally populate either of those with fresh text (the `withdrawnReferrals` half is
exercised only by two pre-existing, unrelated fixture movements — `WF-006` and `WF-018` — that
this walk never touches). A future privacy-text regression introduced anywhere in this walk's
own nine handlers (a decline note, a withdrawal reason, an escalation contact) would only be
caught by this invariant if it happened to write into `state.rejections` or
`movement.withdrawnReferrals` specifically — `movement.declines[].note`,
`movement.escalation.contact`, and `movement.blocker` are not checked by this invariant at all.

## Summary of findings for the reviewer

- Five of the seven invariants (1, 2, 3, 6, 7) are real and were confirmed to fail under a
  targeted reducer mutation, then confirmed to pass again after reverting.
- Invariant 2 required an extreme, unrealistic corruption to fail, because `unitCapacity()` is
  deliberately defensive; a plausible small bug in `PATIENT_ARRIVED`'s decrement would not be
  caught by this walk.
- Invariant 7 required deliberately forcing a rejection that would not otherwise occur, because
  this walk never triggers one; it also only covers two of several places identifying text
  could leak into state.
- **Invariants 4 and 5 are vacuous for this specific walk against `WF-009`'s seed fixture.**
  Both units the walk refers to (`rph-adult-secure`, `fsh-adult-secure`) are already recorded
  as declined in `WF-009`'s fixture data before the walk's first event runs, which pre-satisfies
  both checks regardless of what the reducer's `DECLINE` and `ACCEPT_IN_PRINCIPLE` handlers
  actually do. I disabled each handler's relevant write completely and the suite stayed green
  both times. I did not alter the test file to fix this (the brief specifies its exact
  contents verbatim), but I'm flagging it here as the clearest evidence-based finding of this
  report, per the brief's own warning that "an invariant that holds trivially at every step
  because nothing in the walk ever puts it under strain" is the trap this exercise exists to
  catch. A future task that wants real coverage for these two invariants would need either a
  walk that refers to units with no pre-existing decline history, or a movement (not `WF-009`)
  whose fixture declines don't already cover the referred set.

## Commit

```bash
npm run format   # (skipped in favor of a single-file prettier --write, see "Format" above)
git add tests/ward-flow-contracts.test.ts
git commit -m "test(ward-flow): pin the phase 3 state invariants"
```

---

## Fix round 1

The coordinator confirmed the vacuity finding above and asked for the root fix: rebuild the
walk on a movement with no seed history, so every decline, referral, withdrawal and acceptance
the invariants inspect is one the walk itself caused, then re-derive real, non-forced kill
mutations for all seven invariants.

### What changed

Only `tests/ward-flow-contracts.test.ts` was touched (rewritten in place, same path, no new
files). No implementation file changed in the final committed state — `git diff --stat` against
`src/components/ward-management/ward-flow-reducer.ts` is empty throughout this round; every
mutation below was applied and reverted one at a time during the kill exercise, never left in
place.

**The walk's subject moved from `WF-009` to `WF-001`.** `WF-001` (`arm-ed`, Adult/Open/Female,
"Referred for psychiatric examination", form 1A, stage `placement_requested`, `declines: []`,
`referredUnitIds: []`) is the only hand-authored movement that is both early enough in its
journey to walk the whole path and carries no seed decline or referral history — confirmed by
reading every hand-authored record in `ward-movements.ts`, matching the coordinator's own
independent check.

**The three referred units are all Open Adult units WF-001 had no prior relationship with:**

- `scgh-adult-open` (SCGH Adult Open) — declined by the walk's own `DECLINE` event.
  `allocatable.value: 2`, `empty.value: 5`, `sexMix: { Female: 10, Male: 9 }`.
- `arm-adult-open` (ARM Adult Open) — never explicitly declined; ends up withdrawn purely as
  a side effect of `ACCEPT_IN_PRINCIPLE` firing on a different unit. `allocatable.value: 2`,
  `empty.value: 3`.
- `fre-adult-open` (FRE Adult Open) — the accepted, held, and arrived-at unit.
  `allocatable.value: 3`, `empty.value: 4`, `sexMix: { Female: 9, Male: 9 }` (all read from
  `src/components/ward-management/ward-sites.ts`, unmodified).

**The walk gained a tenth, deliberately-wrong-role event at the front**: an `ACCEPT_IN_PRINCIPLE`
raised with `role: "coordinator"` (the real required role, per `EVENT_ROLE`, is `"ward"`). The
reducer's role check runs before the event's payload or the movement's stage is inspected at
all (`wardFlowReducer`'s first branch, `src/components/ward-management/ward-flow-reducer.ts`
lines 97-102), so this is safe to raise before the movement has even been referred anywhere —
it produces one real, walk-caused entry in `state.rejections` with no other side effect.

### The new walk, step by step

| #   | Event                                                                 | Role                                    | Effect                                                                                                                                                    |
| --- | --------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ACCEPT_IN_PRINCIPLE` scgh-adult-open                                 | coordinator (wrong - real role is ward) | Rejected on the role check alone; `state.rejections` gains one entry, nothing else changes                                                                |
| 2   | `REFER_TO_UNITS` -> [scgh-adult-open, arm-adult-open, fre-adult-open] | coordinator                             | `destination_review`, `referredUnitIds` = all three                                                                                                       |
| 3   | `DECLINE` scgh-adult-open, `no_bed`                                   | ward                                    | `referredUnitIds` = [arm, fre], one decline recorded                                                                                                      |
| 4   | `ACCEPT_IN_PRINCIPLE` fre-adult-open                                  | ward                                    | `accepted_awaiting_bed`, `acceptedUnitId = fre`, `referredUnitIds = []`, arm-adult-open auto-withdrawn with reason "withdrawn - placed at FRE Adult Open" |
| 5   | `HOLD_BED` fre-adult-open                                             | ward                                    | `bed_held`, fre's `allocatable.value` 3->2                                                                                                                |
| 6   | `HANDOVER_READY`                                                      | ed                                      | `handover_ready`, transport created (escort required - legal status is not Voluntary)                                                                     |
| 7   | `TRANSPORT_ACCEPTED`                                                  | officer                                 | `transport.acceptedAt` set                                                                                                                                |
| 8   | `TRANSPORT_EN_ROUTE`                                                  | officer                                 | `transport.enRouteAt` set                                                                                                                                 |
| 9   | `PATIENT_COLLECTED`                                                   | officer                                 | `moving`, `transport.collectedAt` set                                                                                                                     |
| 10  | `PATIENT_ARRIVED`                                                     | officer                                 | `arrived`, fre's `empty.value` 4->3, `sexMix.Female` 9->10, closure recorded                                                                              |

`walk()` returns 11 states (`seen[0]` the seed, `seen[1..10]` one per event above).

### Invariant-by-invariant rewrite

**Invariant 4 (declined unit never eligible).** Now proves both directions: `states[2]`
(after `REFER_TO_UNITS`, before `DECLINE`) shows `scgh-adult-open` genuinely present and
`eligible: true` in `eligibleCandidates(movement, NOW, Infinity)` — proving it could have been
a real candidate — then the final state proves the walk's own `DECLINE` put it in
`target.declines` and that it is absent from the eligible-id set computed the same way the real
screens would compute it (`eligibleCandidates`, not a bare `eligibility()` call on an
arbitrarily-chosen unit).

**Invariant 5 (withdrawal recorded).** Now asserts the specific unit id and the exact reason
text: `target.withdrawnReferrals.find(entry => entry.unitId === "arm-adult-open")` is defined
and its `reason` is exactly `"withdrawn - placed at FRE Adult Open"` (em dash in the actual
source string) — plus a check that the declined unit (`scgh-adult-open`) never shows up in
`withdrawnReferrals`, keeping the two end-of-referral mechanisms distinct.

**Invariant 2 (bed accounting).** No longer routes through `unitCapacity()`. Reads
`fre-adult-open`'s raw `allocatable.value` and `empty.value` directly from `states[4]`/`states[5]`
(immediately before/after `HOLD_BED`) and `states[9]`/`states[10]` (immediately before/after
`PATIENT_ARRIVED`), asserting the exact expected numbers (3->2, 4->3) plus that each step leaves
the other field and `sexMix.Female` (9->10) exactly where expected.

**Invariant 7 (no identifying text).** Now mirrors Task 1's tripwire exactly
(`tests/ward-model-phase3.test.ts`'s privacy test): accumulates every string the loop inspects
into `inspected: string[]`, asserts `inspected.length >= 2` before checking content, then checks
each string against the forbidden pattern. `state.rejections` is no longer permanently empty —
the wrong-role attempt at step 1 populates it — and `arm-adult-open`'s walk-caused withdrawal
reason is inspected on top of the pre-existing fixture data on other movements.

### Off-by-one caught during verification

My first draft set `BEFORE_HOLD_BED = 3` / `AFTER_HOLD_BED = 4`, forgetting that inserting the
wrong-role event at the front shifts every subsequent state index by one. Running it immediately
caught this as a real failure (`expected 3 to be 2`, i.e. reading the state from one step too
early, before `HOLD_BED` had run) rather than a silent wrong-index pass — the fix was
`BEFORE_HOLD_BED = 4` / `AFTER_HOLD_BED = 5`, matching `seen[i+1] = state after events[i]` with
`HOLD_BED` at `events[4]`.

### Clean test run, this round

```
$ npx vitest run tests/ward-flow-contracts.test.ts tests/ward-flow-reducer.test.ts --reporter=verbose

 Test Files  2 passed (2)
      Tests  28 passed (28)
```

Full per-test listing (all 28 green): 21 tests in `tests/ward-flow-reducer.test.ts` (unchanged,
Task 2's own suite, re-run here only because the coordinator asked for both files together) and
the 7 rewritten invariant tests in `tests/ward-flow-contracts.test.ts`:

```
 ✓ never lets a movement hold more than the parallel cap 10ms
 ✓ keeps the accepted unit's raw bed counts exact across each bed-moving step 1ms
 ✓ never leaves a movement ownerless 8ms
 ✓ never returns a declined unit to that patient's eligible candidates 1ms
 ✓ records the withdrawal the referral's own acceptance caused 1ms
 ✓ never lets the statutory form disagree with the examination 2ms
 ✓ keeps every rendered string free of anything identifying a person 2ms
```

### Typecheck and format

```
$ npx tsc --noEmit -p tsconfig.json
(no output - zero errors)

$ npx prettier --write tests/ward-flow-contracts.test.ts
tests/ward-flow-contracts.test.ts 108ms (unchanged)
```

`npm run format` was again skipped in favor of the single-file `prettier --write`, per the
brief's own trap warning about lock-contention hangs; nothing else in the working tree changed
this round.

### Mutation-kill table, round 2 - all seven, all realistic single-line changes

Every mutation below was applied with `Edit`, run with
`npx vitest run tests/ward-flow-contracts.test.ts --reporter=verbose`, captured, then reverted
with `git checkout -- src/components/ward-management/ward-flow-reducer.ts`, confirmed clean via
`git diff --stat` before moving to the next. None required an extreme or forced corruption this
round — every one is a single realistic line a real regression could plausibly introduce.

| #   | Invariant                              | Reducer mutation                                                                                                                                                                               | Result                                                                             |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Parallel referral cap                  | `REFER_TO_UNITS`: `referredUnitIds: [...event.unitIds]` -> `[...event.unitIds, "mutation-pad-a", "mutation-pad-b"]`                                                                            | Fails                                                                              |
| 2   | Bed accounting (raw counts)            | `HOLD_BED`: `value: unit.allocatable.value - 1` -> `value: unit.allocatable.value` (skip the decrement)                                                                                        | Fails - realistic this time; no longer needs an extreme `unit.beds + 1` corruption |
| 3   | Movement never ownerless               | `HOLD_BED`: added `owner: ""` to `updatedMovement`                                                                                                                                             | Fails                                                                              |
| 4   | Declined unit never eligible           | `DECLINE`: dropped the push into `declines` (`declines: movement.declines`)                                                                                                                    | Fails - genuinely, this time; WF-001 has no fixture fallback                       |
| 5   | Withdrawal recorded (unit id + reason) | `ACCEPT_IN_PRINCIPLE`: dropped the push into `withdrawnReferrals` (`withdrawnReferrals: movement.withdrawnReferrals`)                                                                          | Fails                                                                              |
| 6   | Statutory form vs. examination         | `HOLD_BED`: added `legalForm: { code: "3B", ... }` to `updatedMovement` while WF-001's `examination` stays undefined                                                                           | Fails                                                                              |
| 7   | No identifying text                    | `ACCEPT_IN_PRINCIPLE`'s withdrawal reason template appended a forbidden word: `withdrawn - placed at ${acceptedUnit.name}` -> `withdrawn - placed at ${acceptedUnit.name} (diagnosis pending)` | Fails - naturally, no forced rejection needed; caught by both invariants 5 and 7   |

All seven are now real. Evidence for each:

**#1**

```
 x never lets a movement hold more than the parallel cap 9ms
   -> expected 5 to be less than or equal to 3
```

**#2**

```
 x keeps the accepted unit's raw bed counts exact across each bed-moving step 7ms
AssertionError: expected 3 to be 2 // Object.is equality
- Expected: 2
+ Received: 3
 at tests/ward-flow-contracts.test.ts:86:41
```

**#3**

```
 x never leaves a movement ownerless 9ms
AssertionError: expected 0 to be greater than 0
 at tests/ward-flow-contracts.test.ts:101:46
```

**#4**

```
 x never returns a declined unit to that patient's eligible candidates 7ms
AssertionError: expected false to be true // Object.is equality
- Expected: true
+ Received: false
 at tests/ward-flow-contracts.test.ts:118:84
```

(This is the assertion that the walk's own `DECLINE` landed in `target.declines` — with the
push removed, `declines` never contains `scgh-adult-open`, so that check trips before the
eligible-set check even runs.)

**#5**

```
 x records the withdrawal the referral's own acceptance caused 4ms
AssertionError: expected undefined to be defined
 at tests/ward-flow-contracts.test.ts:135:23
```

**#6**

```
 x never lets the statutory form disagree with the examination 9ms
AssertionError: expected undefined to be 'inpatient_order' // Object.is equality
- Expected: "inpatient_order"
+ Received: undefined
 at tests/ward-flow-contracts.test.ts:150:66
```

**#7** (both invariants it touches)

```
 x records the withdrawal the referral's own acceptance caused 6ms
AssertionError: expected 'withdrawn - placed at FRE Adult Open ...' to be 'withdrawn - placed at FRE Adult Open' // Object.is equality
Expected: "withdrawn - placed at FRE Adult Open"
Received: "withdrawn - placed at FRE Adult Open (diagnosis pending)"
 at tests/ward-flow-contracts.test.ts:136:31

 x keeps every rendered string free of anything identifying a person 3ms
AssertionError: expected 'withdrawn - placed at FRE Adult Open ...' not to match /\b(name|dob|date of birth|mrn|medical record|address|diagnosis)\b/i
- Expected: /\b(name|dob|date of birth|mrn|medical record|address|diagnosis)\b/i
+ Received: "withdrawn - placed at FRE Adult Open (diagnosis pending)"
 at tests/ward-flow-contracts.test.ts:177:24
```

Final confirmation rerun after the last revert: `Test Files 1 passed (1)`, `Tests 7 passed (7)`;
`git diff --stat -- src/components/ward-management/ward-flow-reducer.ts` empty.

### Summary for the reviewer

All seven invariants now fail under a single, realistic, single-line reducer mutation and pass
again once reverted. None required an extreme corruption or a forced/artificial event to expose
a real failure — invariant 7's kill in particular is now a mutation a genuine regression could
plausibly introduce (a stray suffix on a user-facing reason string), caught with no forcing
required, unlike round 0's contrived `HOLD_BED` reject injection. I found no invariant in this
round that resisted a realistic kill, so there is nothing further to flag as vacuous.
