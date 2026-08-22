# Ruling R64 — handover-ready stage coherence fix

Five patients were recorded at `handover_ready` in a state the reducer's own rules make
unreachable: `HANDOVER_READY` (`ward-flow-reducer.ts`'s `case "HANDOVER_READY"`) is the only
transition that ever produces stage `"handover_ready"`, and it always creates the movement's
`transport` job in the same update. `bed_held` — the only stage `HANDOVER_READY` accepts — is
itself only reachable after `ACCEPT_IN_PRINCIPLE` sets `acceptedUnitId`. Four of the five records
also lacked that.

## Per-record decision, against the fields each actually carries

| id     | before           | acceptedUnitId   | bedHeldUntil | transport | referredUnitIds | closure                                                     | decision                                                                                                                                                                                       | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ---------------- | ---------------- | ------------ | --------- | --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WF-008 | `handover_ready` | `fre-adult-open` | —            | —         | `[]`            | did-not-proceed, "self-discharged before transport arrived" | **`accepted_awaiting_bed`**                                                                                                                                                                    | Has an accepted unit but no `bedHeldUntil` and no `transport`. `HOLD_BED` is the only writer of `bedHeldUntil`, and `HANDOVER_READY` requires stage `bed_held` already — so a record with an accepted unit but neither of those later fields never reached `bed_held`, let alone `handover_ready`. The furthest stage its own fields support is `accepted_awaiting_bed`. (Its pre-existing `closure` is untouched — `isOpen()` = `!closure && stage !== "arrived"` already correctly treats it as closed regardless of stage, both before and after this fix, so this change does not alter whether it renders as open anywhere.) |
| WF-305 | `handover_ready` | —                | —            | —         | `[]`            | **`placement_requested`**                                   | No accepted unit, and `referredUnitIds` is empty — nothing to review. Ruling: "if it carries `referredUnitIds`, `destination_review` is honest; if it carries none, `placement_requested` is." |
| WF-312 | `handover_ready` | —                | —            | —         | `[]`            | **`placement_requested`**                                   | Same reasoning as WF-305. (Also carries an un-examined 1A form — untouched, unrelated to the stage question.)                                                                                  |
| WF-319 | `handover_ready` | —                | —            | —         | `[]`            | **`placement_requested`**                                   | Same reasoning. This is the record the task named as visibly wrong on the peel-ed screen; confirmed fixed below.                                                                               |
| WF-326 | `handover_ready` | —                | —            | —         | `[]`            | **`placement_requested`**                                   | Same reasoning.                                                                                                                                                                                |

WF-305/312/319/326 are all generated records (`routineMovements`, ids 300–329) — every one of
them landed on `handover_ready` because `index % MOVEMENT_STAGES.length === 4`, and
`stageFields()`'s `switch` has no case for `"handover_ready"`, falling to `default: return {}`.
No source file literally spells `WF-305` — it is computed from `index`.

## Root cause and the fix actually made (two files)

**`src/components/ward-management/ward-movements.ts`**

1. WF-008 (hand-authored, `seededMovements`): changed `stage: "handover_ready"` to
   `stage: "accepted_awaiting_bed"`, with a comment stating the reasoning above. No other field
   touched.
2. `routineMovements()` generator: `stageFields()` correctly has no case for `"handover_ready"` —
   adding one would mean fabricating `acceptedUnitId`/`bedHeldUntil`/`transport`, exactly what
   ruling R64 forbids. The actual defect is that the generator could still _assign_ the stage
   `"handover_ready"` to an index despite `stageFields` deliberately not equipping it for that
   stage. Fixed by remapping that one stage at the point of assignment:

   ```ts
   const rawStage = MOVEMENT_STAGES[index % MOVEMENT_STAGES.length];
   const stage = rawStage === "handover_ready" ? "placement_requested" : rawStage;
   ```

   Every generated movement's `referredUnitIds` is unconditionally `[]`, so per the ruling the
   honest stage for what these records carry is `placement_requested`. This is a structural fix,
   not a per-id patch: it closes the defect for every index this generator can ever produce (e.g.
   if `routineMovements(30, 300)`'s count or start index ever changes and a different index lands
   on `handover_ready`), not only today's four ids.

**`tests/ui-ward-roles.spec.ts`**: one comment referenced WF-319 as a live example of "a movement
with no `transport` object at all". That claim is no longer true after this fix (WF-319 no longer
sits at `handover_ready`), so the comment was reworded to describe the reserved value generically
instead of citing a now-stale example.

## The enumerated reducer stage-production table (the derivation)

Method per the ruling: enumerate every `wardFlowReducer` branch that assigns `stage`, and for
each, record what else that branch writes in the _same update_. Read directly off
`ward-flow-reducer.ts` on 2026-08-22 (line numbers as of the pre-fix file):

| Branch                           | Produces stage          | Also writes (same update)                                                                                                              |
| -------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `RAISE_REFERRAL` (L121-150)      | `placement_requested`   | `referredUnitIds: []`, `declines: []`, `withdrawnReferrals: []` — a brand-new movement; no `acceptedUnitId`/`transport`/`bedHeldUntil` |
| `REFER_TO_UNITS` (L196-219)      | `destination_review`    | `referredUnitIds: event.unitIds`                                                                                                       |
| `ACCEPT_IN_PRINCIPLE` (L221-254) | `accepted_awaiting_bed` | `acceptedUnitId: event.unitId`, `referredUnitIds: []`, `withdrawnReferrals: [...]`                                                     |
| `HOLD_BED` (L256-286)            | `bed_held`              | `bedHeldUntil: event.now + 60` — requires the movement already `accepted_awaiting_bed` with `acceptedUnitId === event.unitId`          |
| `DECLINE` (L288-307)             | `destination_review`    | `referredUnitIds`: filtered, `declines: [...]`                                                                                         |
| `HANDOVER_READY` (L309-325)      | `handover_ready`        | `transport: {...}` — requires stage already `bed_held`, so `acceptedUnitId`/`bedHeldUntil` carry over unchanged from the prior update  |
| `PATIENT_COLLECTED` (L359-371)   | `moving`                | `transport.collectedAt: event.now` — requires `transport.enRouteAt` already set                                                        |
| `PATIENT_ARRIVED` (L373-405)     | `arrived`               | `transport.arrivedAt: event.now`, `closure: {...}` — requires `acceptedUnitId` and `transport.collectedAt` already set                 |

Every other branch (`RECORD_EXAMINATION`, `TRANSPORT_ACCEPTED`, `TRANSPORT_EN_ROUTE`,
`CONFIRM_CAPACITY`, `RECORD_ESCALATION`, `RESET_SCENARIO`, `ADVANCE_CLOCK`) never assigns `stage`
on an existing movement.

**Direct implications** (same-update writes → what the table alone gives):

- `destination_review` ⇒ `referredUnitIds` set (from `event.unitIds` or the post-decline filter)
- `accepted_awaiting_bed` ⇒ `acceptedUnitId` set
- `bed_held` ⇒ `bedHeldUntil` set
- `handover_ready` ⇒ `transport` set
- `moving` ⇒ `transport.collectedAt` set (already tested — the pre-existing "moving" invariant)
- `arrived` ⇒ `transport.arrivedAt` set, but only when a `transport` job exists at all (already
  tested — the pre-existing "arrived" invariant)

**Transitive implications** (chaining one branch's precondition against an earlier branch's
output — this is the part the direct table alone misses, and exactly what let 4 of the 5 broken
records also lack `acceptedUnitId`):

- `ACCEPT_IN_PRINCIPLE` is the _only_ branch that ever writes `acceptedUnitId`, and no branch ever
  clears it. Every stage reachable only after `accepted_awaiting_bed` — `accepted_awaiting_bed`,
  `bed_held`, `handover_ready`, `moving`, `arrived` — therefore requires it.
- Symmetrically, `ACCEPT_IN_PRINCIPLE` rejects outright when `movement.acceptedUnitId` is already
  set, and always advances the stage away from `destination_review` in that same update — so a
  movement still at `placement_requested` or `destination_review` can never carry one.
- `HANDOVER_READY`'s own precondition is stage `bed_held`, which itself requires having already
  passed through `accepted_awaiting_bed` — so `handover_ready` without `acceptedUnitId` is
  _doubly_ unreachable, chained through two branches, which is exactly why a hand-written
  invariant list (R58) that only looked at each branch in isolation missed it.

**Where the chain does _not_ extend, checked against real data rather than assumed:**
`bedHeldUntil` is not carried forward past `bed_held` in fixture-authoring convention — both
hand-authored and generated `handover_ready`/`moving`/`arrived` records omit it (measured: 0 of 2
`handover_ready`, 0 of 6 `moving`, 0 of 6 `arrived` records carry it, both before and after this
fix). Likewise `transport` is not required at `arrived` — the existing pre-fix test already
documents that both current `arrived` records close without ever having had a transport job, and
that state is legitimate, not a defect. Neither of these got a new invariant for exactly that
reason: asserting them would fail against known-good data, not catch a real defect.

## New tests added, `tests/ward-flow-contracts.test.ts`, `describe("fixture stage/stamp coherence …")`

1. **`never leaves a 'handover_ready' movement without the transport its stage implies`** — the
   direct `HANDOVER_READY` table entry. `matched` counts records at `handover_ready`; asserts
   `transport` defined for each; `expect(matched).toBe(2)` (WF-005, WF-015, the two records that
   were always correct).
2. **`never leaves an accepted, bed-held, handover-ready, moving or arrived movement without the
accepted unit its stage implies`** — the transitive chain that produced 4 of the 5 broken
   records. Iterates the five-stage set `[accepted_awaiting_bed, bed_held, handover_ready, moving,
arrived]`; asserts `acceptedUnitId` defined for each; `expect(matched).toBe(27)`
   (6 + 7 + 2 + 6 + 6, counted from the post-fix fixture).
3. **`never leaves a 'bed_held' movement without the bed hold its stage implies`** — locks in the
   `HOLD_BED` direct table entry, previously true but unproven by any committed test.
   `expect(matched).toBe(7)`.
4. **`never lets a movement earlier than 'accepted_awaiting_bed' carry the accepted unit only a
later stage should have`** — the mirror-image transitive invariant, and the "match-counter
   pointed at an empty set" test the task asked for. Counts `placement_requested`/
   `destination_review` records that (wrongly) carry `acceptedUnitId`; `expect(matched).toBe(0)`,
   forward-looking exactly like the file's pre-existing `arrived`+`transport` test.

The doc comment above the `describe` block was extended with the full table and the
direct/transitive reasoning above, so the derivation is auditable in the test file itself, not
only here.

## Gates run, decisive output quoted

**Typecheck** — `npx tsc --noEmit -p tsconfig.json` — baseline (before any edit): exit 0, no
output. Final (after all edits): exit 0, no output. Clean both times, no `.next/dev/types`
corruption encountered.

**Node-env ward suite** (single invocation, the 11 files named in the task):

- Baseline: `Test Files  11 passed (11)` / `Tests  139 passed (139)`.
- Final: `Test Files  11 passed (11)` / `Tests  143 passed (143)`.
- **Moved: +4, explained** — exactly the 4 new tests added above, all green.

**jsdom, one file per invocation**:

| file                                       | baseline                                         | final |
| ------------------------------------------ | ------------------------------------------------ | ----- |
| `ward-screen.dom.test.tsx`                 | `Test Files 1 passed (1)` / `Tests 3 passed (3)` | same  |
| `ward-flow-clock-consistency.dom.test.tsx` | `Tests 1 passed (1)`                             | same  |
| `ward-flow-provider.dom.test.tsx`          | `Tests 4 passed (4)`                             | same  |
| `ward-flow-queue-selection.dom.test.tsx`   | `Tests 1 passed (1)`                             | same  |

No moves — none of these files reference the fixture's stage of the five affected records.

**Ward Chromium gate, chromium only** (routes warmed with `curl` first, in both baseline and final
runs):
`PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts
tests/ui-ward-management.spec.ts tests/ui-ward-roles.spec.ts --project=chromium --reporter=line`

- Baseline: `38 passed (1.5m)`.
- Final (after the fixture fix and the WF-319 comment edit): `38 passed (1.4m)`.
- **Moved: 0.** Confirmed by inspection before running that no Playwright spec pins an exact count
  or content assertion that includes WF-008/305/312/319/326 (only a documentation comment
  mentioned WF-319, updated above). The `ward-ed-outstanding-WF-005`/`WF-016` and
  `ward-live-tracker` exact-count assertions (`8` transport jobs, `33 of 41` open-without-transport)
  are unaffected: none of the five records ever carried a `transport` job before or after the fix,
  and WF-008 was already excluded from every "open" count by its own `closure` field regardless of
  stage.

**Lint** — not run. Not requested by the task's gate list for this change (the task's own gate
list stops at the Chromium spec run above), and I did not attempt it.

Not run: `npm run verify:ui`, `npm run verify:release`, the three-browser Playwright set, the
guard-push suite, anything touching OpenAI/Supabase/GitHub Actions/a live database — all
explicitly prohibited by the task.

## Mutation testing — every new assertion, killed and diagnosed

All four mutations were applied directly to `src/components/ward-management/ward-movements.ts`,
proven red with a focused `npx vitest run tests/ward-flow-contracts.test.ts`, reverted, and
reproven green. No mutation survived; nothing was untestable.

**Mutation 1 — target: assertion 1 (`handover_ready` ⇒ `transport`)**
Edit: WF-008's `stage: "accepted_awaiting_bed",` → `stage: "handover_ready",` (line 209).
Printed back: `    stage: "handover_ready",`
Result: **killed** — exactly assertion 1, isolated:

```
× never leaves a 'handover_ready' movement without the transport its stage implies
AssertionError: WF-008 is stage "handover_ready" but has no transport job — ...: expected undefined to be defined
Tests  1 failed | 13 passed (14)
```

Assertion 2 (`acceptedUnitId`) correctly stayed green — WF-008 has an accepted unit, so this
mutation isolates the transport check exactly as intended. Reverted; printed back
`    stage: "accepted_awaiting_bed",`; reran, `Tests  14 passed (14)`.

**Mutation 2 — target: assertion 2 (`acceptedUnitId` persists) and, incidentally, assertion 1**
Edit: the generator's `const stage = rawStage === "handover_ready" ? "placement_requested" :
rawStage;` (line 609) → `const stage = rawStage;` — i.e. reverting the actual fix, recreating
WF-305/312/319/326 at `handover_ready` with neither field.
Printed back: `    const stage = rawStage;`
Result: **killed both**, first violation reported on WF-305:

```
× never leaves a 'handover_ready' movement without the transport its stage implies
AssertionError: WF-305 is stage "handover_ready" but has no transport job ...
× never leaves an accepted, bed-held, handover-ready, moving or arrived movement without the accepted unit its stage implies
AssertionError: WF-305 is stage "handover_ready" but has no acceptedUnitId ...
Tests  2 failed | 12 passed (14)
```

This is also the most direct proof that the generator fix in this diff is load-bearing: undoing
it reproduces the original defect and both new invariants catch it immediately. Reverted; printed
back the original remap line; reran, `Tests  14 passed (14)`.

**Mutation 3 — target: assertion 3 (`bed_held` ⇒ `bedHeldUntil`)**
Edit: WF-016's `bedHeldUntil: NOW_ANCHOR + 45,` (line 448) replaced with a comment, deleting the
field.
Printed back: `    // MUTATION-3-TEMP: bedHeldUntil removed`
Result: **killed**, isolated:

```
× never leaves a 'bed_held' movement without the bed hold its stage implies
AssertionError: WF-016 is stage "bed_held" but has no bedHeldUntil — ...: expected undefined to be defined
Tests  1 failed | 13 passed (14)
```

Reverted; printed back `    bedHeldUntil: NOW_ANCHOR + 45,`; reran, `Tests  14 passed (14)`.

**Mutation 4 — target: assertion 4, the empty-set counter**
Edit: inserted `    acceptedUnitId: "MUTATION-4-TEMP",` into WF-001 (a `placement_requested`
record), after line 27.
Printed back: `    acceptedUnitId: "MUTATION-4-TEMP",` (confirmed present in the file between
`declines: []` and `blocker: ...`).
Result: **killed**, matched went from 0 to 1 as expected:

```
× never lets a movement earlier than 'accepted_awaiting_bed' carry the accepted unit only a later stage should have
AssertionError: expected 1 to be +0
Tests  3 failed | 11 passed (14)
```

Two other pre-existing tests in this file also failed as a side effect (they independently reuse
WF-001 as the walked subject for the reducer-invariant suite in the same file, and my injected
`acceptedUnitId` made their first `ACCEPT_IN_PRINCIPLE` event get rejected instead of succeeding).
That is expected collateral from choosing an already-instrumented fixture id for this mutation,
not a diagnosis issue — the targeted assertion (empty-set counter) fired correctly and for the
right reason. Reverted by deleting the inserted line; reran, `Tests  14 passed (14)`.

**Diagnosis, stated plainly**: all four mutations killed their target assertion on the first try,
each isolated to the assertion(s) whose precondition the edit actually violated, with no
reformulation needed. Nothing here is a mistimed mutation or an untestable assertion.

## Live screen check — `http://localhost:3718/ward-management/ed/peel-ed`, 1440×1024, headless Chromium

Driven directly (not through Playwright's test runner) via a scratch script placed at
`artifacts/check-screen.mjs` (gitignored, inside the repo so it resolved the installed
`playwright` package) and deleted immediately after running.

- **7 patient rows** rendered for peel-ed.
- **No row claims "Handover ready" together with "Not yet requested"** — the exact defect
  string search returned an empty list.
- WF-319's row now reads stage **"Placement requested"**, outstanding item **"Form — No legal
  form recorded for this movement."**, and its "Mark handover ready" control is disabled with the
  reducer-mirroring reason text: _"WF-319 is placement requested, not bed held — a handover can
  only be marked ready once a bed is held."_
- **7 total handover controls** rendered on the page; **2 are live** (not `aria-disabled`) — the
  two peel-ed patients genuinely at `bed_held` today.

## Practical notes

- `node_modules` was populated (523 top-level entries) before any command ran — no
  `npm ci --include=dev` recovery was needed.
- `git commit` was not yet run at the time this report was written to disk (see the command
  history for the actual commit step and its output).
- No scratch scripts or logs were left in the repository; `artifacts/check-screen.mjs` was
  deleted after use, and `artifacts/` itself is gitignored (pre-existing directory with unrelated
  screenshots from earlier phases, untouched).
