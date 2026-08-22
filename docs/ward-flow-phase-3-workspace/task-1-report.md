# Task 1 report — The model and the fixture

Branch: `codex/ward-management-design`
Worktree: `C:/Users/joshs/.codex/worktrees/ward-management-design/Database`
Commit: `f3b1f74f0fa3b7b57f9ad72d444ce718639e77f4`
`feat(ward-flow): add the Phase 3 model fields and the out-of-catchment decline reason`

## Files changed, file by file

### `tests/ward-model-phase3.test.ts` (new)

Copied verbatim from the brief's Step 1 code block — 10 tests (the brief's prose says "8 tests"
but the pasted block actually contains 10 `it(...)` blocks; I ran what was pasted, not what the
prose counted). No edits to the test content itself.

### `src/components/ward-management/ward-model.ts`

- `DECLINE_REASONS`: appended `"out_of_catchment"` as the seventh entry.
- `Movement`: added, verbatim from the brief, `formedAt?`, `arrivalMode?`, `bedHeldUntil?`,
  `examination?`, `withdrawnReferrals` (no `?` — required), `escalation?`.
- Added `export type Rejection = { id; at; movementId; attempted; reason }` verbatim.

### `src/components/ward-management/ward-movements.ts`

- Every one of the 18 hand-authored `seededMovements` records now carries
  `withdrawnReferrals: []`.
- Every one of the 30 generated `routineMovements` records now carries
  `withdrawnReferrals: []` (added once, in the shared object literal, so it applies to all 30
  without touching `stageFields`).
- `stageFields`'s `"bed_held"` branch (previously merged with `"accepted_awaiting_bed"`) is now
  split out and additionally returns `bedHeldUntil: NOW_ANCHOR - 20 + (index % 66)` — deterministic
  from `index`, range `[NOW_ANCHOR - 20, NOW_ANCHOR + 45]` inclusive (66 values), matching the
  brief's bound for hand-authored `bed_held` records. See "Ambiguity" below for why this was
  necessary beyond what the brief's prose literally scoped.
- Hand-authored field-by-field changes are listed under "Movements changed" below.

### `tests/ward-eligibility.test.ts`

- Its local `movement()` test-fixture factory (used only inside that file, building a bare
  `Movement` literal from scratch rather than spreading a real fixture record) now also sets
  `withdrawnReferrals: []`. This was not in the brief's file list; see "Ambiguity" below for why
  it was required.

## Movements changed, field by field

| Movement                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WF-001                        | `withdrawnReferrals: []` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WF-002                        | `withdrawnReferrals: []`; `formedAt: NOW_ANCHOR - 270` (openedAt is `NOW_ANCHOR - 180`, so 90 min earlier — community-formed); `arrivalMode: "ambulance"`                                                                                                                                                                                                                                                                                                                                                                   |
| WF-003                        | `withdrawnReferrals: []`; `legalForm` **3A → 3B** (`code: "3B"`, `label: "Inpatient treatment order"`, `kind: "detention"`, `dueAt: NOW_ANCHOR + 480` — the new detention deadline, replacing the old examination-pending deadline `NOW_ANCHOR + 210`); `legalStatus` "Detained awaiting examination" → "Involuntary inpatient"; `examination: { at: NOW_ANCHOR - 60, outcome: "inpatient_order" }`; `arrivalMode: "ambulance"`                                                                                             |
| WF-004                        | `withdrawnReferrals: []`; already `stage: "bed_held"` → `bedHeldUntil: NOW_ANCHOR - 10` (deliberately **lapsed**)                                                                                                                                                                                                                                                                                                                                                                                                           |
| WF-005                        | `withdrawnReferrals: []`; `legalForm` **3A → 1A** (`code: "1A"`, `label: "Referral for examination"`, `kind: "examination"`, `dueAt` unchanged at `NOW_ANCHOR - 40`); `formedAt: NOW_ANCHOR - 480` (openedAt is `NOW_ANCHOR - 330`, so 150 min earlier). This is the `peel-ed` community-formed movement Task 11 stands on. `referredUnitIds` untouched (empty, as before).                                                                                                                                                 |
| WF-006                        | `withdrawnReferrals: []` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WF-007                        | `withdrawnReferrals: []` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WF-008                        | `withdrawnReferrals: []` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WF-009                        | `withdrawnReferrals: []`; `legalForm` **3A → 3B** (`code: "3B"`, `label: "Inpatient treatment order"`, `kind: "detention"`, `dueAt: NOW_ANCHOR + 400`, replacing `NOW_ANCHOR + 150`); `legalStatus` → "Involuntary inpatient"; `examination: { at: NOW_ANCHOR - 45, outcome: "inpatient_order" }`; `arrivalMode: "police"`. `declines` (5 entries) and `referredUnitIds` (empty) left untouched — Task 5/Task 8's UI spec depends on the 5-decline count and on `acceptedUnitId`/`referredUnitIds` being exactly as before. |
| WF-010                        | `withdrawnReferrals: []`; `legalForm` **3A → 1A** (`code: "1A"`, `label: "Referral for examination"`, `kind: "examination"`, `dueAt` unchanged at `NOW_ANCHOR + 260`). `referredUnitIds: ["sjgm-adult-open"]` preserved untouched.                                                                                                                                                                                                                                                                                          |
| WF-011                        | `withdrawnReferrals: []`; already `stage: "bed_held"` → `bedHeldUntil: NOW_ANCHOR + 20` (still **running**)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| WF-012                        | `withdrawnReferrals: []`; `referredUnitIds: ["gry-adult-secure"]` preserved untouched                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| WF-013                        | `withdrawnReferrals: []`; `formedAt: NOW_ANCHOR - 320` (openedAt is `NOW_ANCHOR - 200`, so 120 min earlier — community-formed). `referredUnitIds: ["bty-older-adult", "gry-older-adult"]` preserved untouched.                                                                                                                                                                                                                                                                                                              |
| WF-014                        | `withdrawnReferrals: []` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WF-015                        | `withdrawnReferrals: []` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WF-016                        | `withdrawnReferrals: []`; already `stage: "bed_held"` → `bedHeldUntil: NOW_ANCHOR + 45` (still **running**, at the upper bound)                                                                                                                                                                                                                                                                                                                                                                                             |
| WF-017                        | `withdrawnReferrals: []`; `legalForm` **3A → 3B** (`code: "3B"`, `label: "Inpatient treatment order"`, `kind: "detention"`, `dueAt: NOW_ANCHOR + 5`, replacing `NOW_ANCHOR - 25` — deliberately kept close to now so the existing "breach imminent" blocker text stays true of the new deadline too); `legalStatus` → "Involuntary inpatient"; `examination: { at: NOW_ANCHOR - 10, outcome: "inpatient_order" }`. `referredUnitIds: ["bty-adult-secure"]` preserved untouched — Task 8 stands on this one.                 |
| WF-018                        | `withdrawnReferrals: []` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| WF-300..WF-329 (30 generated) | All get `withdrawnReferrals: []`. Those landing on `stage: "bed_held"` (indices 304, 311, 318, 325 — every 7th index starting at the first `≡ 3 mod 7`) additionally get `bedHeldUntil = NOW_ANCHOR - 20 + (index % 66)`, i.e. `NOW_ANCHOR + 20`, `+27`, `+34`, `+41` respectively — all four land in the "still running" half of the window; the "lapsed" half of the window (`bedHeldUntil < NOW_ANCHOR`) is already covered by hand-authored WF-004.                                                                     |

### Community-formed summary (3 required, ≥1 at `peel-ed`)

WF-002 (fsh-ed, 90 min), WF-005 (**peel-ed**, 150 min), WF-013 (sjgm-ed, 120 min) — all within the
required 60–240 minute window, all strictly earlier than their `openedAt`.

### Arrival-mode summary (≥1 police, ≥2 ambulance)

Police: WF-009. Ambulance: WF-002, WF-003.

### 3A → 1A vs 3A → 3B

All five movements that carried `"3A"` at seed (WF-003, WF-005, WF-009, WF-010, WF-017) had it
replaced — no `"3A"` remains anywhere. Of those five:

- **Became 3B** (examined, ordered for an inpatient bed, waiting in the department): WF-003,
  WF-009, WF-017. Each got `legalStatus: "Involuntary inpatient"` and an `examination` with
  `outcome: "inpatient_order"` dated before `NOW_ANCHOR`. `dueAt` was replaced with a new
  detention-deadline value rather than reusing the old examination-deadline value.
- **Stayed 1A** (still awaiting examination): WF-005, WF-010. `legalStatus` was left as
  "Detained awaiting examination" for both; only the `legalForm` code/label/kind changed from the
  3A values to the 1A values used elsewhere in the fixture (matching WF-001's existing 1A shape
  exactly). `dueAt` was left unchanged on both.

I picked WF-003/009/017 for 3B (over WF-005/010) because their existing narrative already fit
"examined and waiting for a bed" — WF-003 is `accepted_awaiting_bed` with a unit already accepted
and a "bed being made ready" blocker; WF-009 is the fully-exhausted-referral-network case
("No secure adult bed available across the network"); WF-017 is the existing
"breach imminent" / duty-psychiatrist-escalation case. WF-005 (already mid-handover to a different
unit, transport being arranged) and WF-010 (destination review just opened, no decline history)
read more naturally as "still waiting on the exam" than as "already ordered."

## Test output (exact)

`npx vitest run tests/ward-model-phase3.test.ts --reporter=verbose`:

```
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > records out-of-catchment as a decline reason 3ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > gives every movement a withdrawn-referral list, even an empty one 4ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > never dates a form later than the placement request it belongs to 1ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one community-formed patient whose legal clock started before arrival 0ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient brought in under police escort 0ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one examined patient, and every examination is dated at or before now 1ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > holds a bed only with a time for the hold to expire at 1ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > puts a patient on 1A while awaiting examination and on 3B once examined 4ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient on each of 1A and 3B 4ms
✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > keeps every new field free of anything that identifies a person 1ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

Before the implementation, the same run failed 9 of 10 (only the `out_of_catchment` unit test
passed — wait, that one failed too on the very first run since `DECLINE_REASONS` didn't have the
entry yet): the initial red run showed
`AssertionError: expected [ 'no_bed', ... ] to contain 'out_of_catchment'`,
`expected undefined to be defined` (bedHeldUntil), `expected '3A' not to be '3A'`,
`expected [...] to include '3B'`, and `TypeError: movement.withdrawnReferrals is not iterable` —
i.e. every failure traced to the exact missing fields the brief describes, not to a typo in the
test.

Full required suite, `npx vitest run tests/ward-model-phase3.test.ts tests/ward-model.test.ts
tests/ward-eligibility.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts
tests/ward-capacity-reconciliation.test.ts`:

```
 Test Files  6 passed (6)
      Tests  87 passed (87)
```

I also ran the rest of the `ward-*` Vitest suite as an extra safety net, since I changed the
generator (`stageFields`) shared by every generated movement, not just the fixtures the brief
named:

```
npx vitest run tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-eligibility.test.ts \
  tests/ward-priority.test.ts tests/ward-pressure.test.ts tests/ward-capacity-reconciliation.test.ts \
  tests/ward-derivations.test.ts tests/ward-management.test.ts tests/ward-output.test.ts tests/ward-clock.test.ts

 Test Files  10 passed (10)
      Tests  128 passed (128)
```

`npx tsc --noEmit -p tsconfig.json` — no output, exit code `0`.

`npm run format` ran to completion in this session (not slow; no lock contention hit), reported
every touched file `(unchanged)` since Prettier was already satisfied by the edits, and exited 0.
`git status --porcelain` after `format` showed only the four intended files as modified/added —
nothing else in the repo was reformatted.

`npm run lint` was **not** run — Task 1 does not require it per the brief, and it can silently
no-op under repo lock contention (`DATABASE_HEAVY_RUN_ADMISSION_BUSY`), so skipping it rather than
risking a false-green was the safer call for this task's scope.

## Ambiguities and how I resolved them

1. **`withdrawnReferrals` required vs. optional, and its fallout on an out-of-scope file.**
   The brief's Step 3 code block gives `withdrawnReferrals: { unitId: string; at: Instant; reason:
string }[];` with no `?`, unlike every other new field in the same block. Making it required is
   also the only reading consistent with the phase-3 test's name ("even an empty one") and with
   `Array.isArray` being checked unconditionally for every movement, not just movements that
   happen to set it.

   Consequence: `tests/ward-eligibility.test.ts` has a local `movement()` helper that builds a
   complete `Movement` object literal from scratch (not by spreading an existing fixture record),
   and it didn't set `withdrawnReferrals`. With the field required, `npx tsc --noEmit` failed
   there — one error, `Type '{...}' is not assignable to type 'Movement'`. I added
   `withdrawnReferrals: []` to that one factory. It's the _only_ other place in `src/` or `tests/`
   that constructs a full `Movement` literal rather than spreading a real fixture record or an
   existing movement (I checked with a repo-wide grep for `originEdId:` and for `): Movement`
   before deciding); every other test-side movement construction (`ward-pressure.test.ts`'s
   `movementFrom`, `ui-ward-coordinator.spec.ts`'s `requireMovement`) already derives from a real
   `wardMovements` record via spread/`Object.assign`, so those inherit the new field automatically
   with no edit needed. I judged this the smallest safe compatibility fix rather than weakening
   the type to optional, since the brief's literal snippet and the test's own wording both point
   at "required."

2. **"On the hand-authored records only" scoping the `bed_held` → `bedHeldUntil` bullet.**
   The brief's Step 4 list opens with "Then, on the hand-authored records only:" and the
   `bedHeldUntil` bullet is the last item in that same list, which reads as if it too is scoped to
   hand-authored records. But the phase-3 test iterates the _entire_ `wardMovements` array
   (`for (const movement of wardMovements) { if (movement.stage !== "bed_held") continue;
expect(movement.bedHeldUntil).toBeDefined(); }`), and the 30 generated movements can and do land
   on `stage: "bed_held"` (indices 304, 311, 318, 325, since `MOVEMENT_STAGES[index % 7]` cycles
   through all seven stages). Leaving those four without `bedHeldUntil` would fail that test. I
   resolved this by reading the test as authoritative over the prose scoping, and added a
   deterministic, index-derived `bedHeldUntil` to the generator's `"bed_held"` branch of
   `stageFields`, using the same `[NOW_ANCHOR - 20, NOW_ANCHOR + 45]` bound the brief specifies —
   consistent with the brief's "generated movements derive their values from their index... never
   by a random or wall-clock source" rule. I did not extend this same "generator now also needs
   it" reasoning to `formedAt`/`arrivalMode`/`examination`/3B conversion, since the phase-3 test
   only asserts "at least one" for those (already satisfied by the three hand-authored
   community-formed/police/examined records), not "every movement of stage/kind X."

3. **Which `dueAt` to give the three 3B conversions.** The brief says only "their `dueAt` becomes
   the detention deadline rather than the examination deadline" without giving values. I picked
   `NOW_ANCHOR + 480` / `+400` / `+5` — the first two are simply "further out than the old 3A
   value" to represent a fresh, longer-running order; WF-017 deliberately stays _close_ to now
   (`+5`, not breached but imminent) so its existing "breach imminent" blocker text and the
   escalation narrative stay true of the new deadline rather than becoming stale flavor text. No
   test pins these exact numbers.

4. **Legal-form label and `kind` for the new `"3B"` code.** Not given in the brief. I used
   `label: "Inpatient treatment order"` and `kind: "detention"` — `kind: "detention"` because 3B
   still legally detains the person in hospital (same category as the outgoing 3A), and no test
   asserts a specific label or `kind` for 3B.

5. **Which `legalStatus` to pair with the 3B conversions.** Not specified. I changed
   `legalStatus` from `"Detained awaiting examination"` to `"Involuntary inpatient"` for
   WF-003/009/017 (since they're now examined-and-ordered, not merely awaiting examination), and
   left it unchanged for the two that stayed 1A. I verified this has zero effect on any existing
   test: `requiresAuthorisedDestination()` in `ward-eligibility.ts` only checks
   `status !== "Voluntary"`, so both legal statuses behave identically there, and I grepped every
   `tests/*.ts` and `src/components/ward-management/**` file for `legalStatus` usage to confirm
   nothing else keys off the specific non-voluntary value for these three IDs.

## Things I verified but did not change

- `referredUnitIds` on the five load-bearing movements (`sjgm-adult-open` on WF-010,
  `gry-adult-secure` on WF-012, `fsh-older-adult` on WF-002, `bty-adult-secure` on WF-017, and the
  `bty-older-adult`/`gry-older-adult` pair on WF-013) are untouched — confirmed by reading the
  final file back after every edit rather than trusting the diff summary.
- No hardcoded `"3A"` remains anywhere in `src/` (grepped after the edit).
- No UI component (`ward-management-console.tsx`, `ward-management-modes.tsx`,
  `ward-management-network.tsx`, `coordinator/shortlist-panel.tsx`) hardcodes any specific legal
  form code or legal status string that these changes would silently break; they all interpolate
  `movement.legalForm.code`/`.label`/`.dueAt` and `movement.legalStatus` generically.
- `tests/ui-ward-coordinator.spec.ts` (Playwright, not in the brief's required run and not run
  here) references WF-003/005/009/010/017 extensively, but only for `declines`, `acceptedUnitId`,
  `referredUnitIds`, `transport`, and eligibility-gate outcomes — none of which I touched on those
  records — and I confirmed via `ward-eligibility.ts` that `legalStatus` changing between the two
  non-voluntary values cannot change any of the 8 eligibility gates. I did not run this Playwright
  spec (no dev server was started for this task, and Task 1 writes no React/UI).

## Unsure about

- Whether "several" in "several movements gain an examination... and move to 3B" was meant to be
  exactly the 3 I chose (a majority of the five ex-3A records) or some other count/selection. The
  test only requires "at least one" 3B, so 3 is a safe superset; a later task's test could in
  principle expect a specific WF-### to be 1A rather than 3B, or vice versa, and I have not been
  told of one for these five specifically (only WF-005 and WF-017's `referredUnitIds` are called
  out by the brief as load-bearing, and I preserved both).
- Whether Task 11's "at least one community-formed patient at `peel-ed`" needs a _specific_ WF-ID,
  since the brief only names `peel-ed` as the site, not a movement ID. I used WF-005, which the
  brief's decisions section separately calls out as one of the seven currently-open `peel-ed`
  movements — consistent with the brief's own framing.

---

## Fix round 1 — the privacy guard was vacuous

Commit: `39042cd61d0815100e0f9a86e3660480455e9631`
`fix(ward-flow): give the privacy guard real strings to inspect and a vacuous-run tripwire`
(on top of `f3b1f74f0fa3b7b57f9ad72d444ce718639e77f4`, not amended)

### The defect

`it("keeps every new field free of anything that identifies a person")` looped over
`movement.withdrawnReferrals` (always `[]` in the Task 1 fixture) and `movement.escalation`
(never set anywhere in the Task 1 fixture) for every open movement. Both loop bodies were
therefore always skipped, so the test executed zero `expect` calls tied to actual data and
passed regardless of what `forbidden` matched. The coordinator proved this by swapping
`forbidden` for `new RegExp(".*")` — a pattern matching every string — and the test still
passed, because no string was ever handed to `.not.toMatch()`.

### The fix

1. **Gave the guard something to read** (`src/components/ward-management/ward-movements.ts`,
   hand-authored records only; the 30 generated movements and all five load-bearing
   `referredUnitIds` entries were left untouched — reconfirmed by grep after the edit):
   - `WF-006` (moving, accepted at RGH Adult Secure): added one `withdrawnReferrals` entry —
     `{ unitId: "fsh-adult-secure", at: NOW_ANCHOR - 470, reason: "Referral withdrawn once RGH
Adult Secure confirmed the bed" }`. Tone matches the existing `declines[].note` /
     `blocker` register already in the file (an operational fact, no person).
   - `WF-018` (placement_requested, "Awaiting family collateral before destination decision"):
     added one `withdrawnReferrals` entry — `{ unitId: "scgh-older-adult", at: NOW_ANCHOR - 10,
reason: "Referral withdrawn — the unit filled the bed from an earlier request" }`.
   - `WF-009` (the fully-exhausted-referral-network movement, 5 declines, "No secure adult bed
     available across the network"): added an `escalation` —
     `{ at: NOW_ANCHOR - 3, triedUnitIds: [the same five unit ids already in its declines[]],
contact: "State bed coordination desk" }`. `contact` names a desk, not a person, matching
     the register of the existing `owner` field values ("Flow coordinator", "ED mental health
     team", "Ward nurse in charge").

   These three were chosen because they are `isOpen` (the test's own filter) and because two of
   them (`WF-006`, `WF-018`) do not touch any of the five load-bearing `referredUnitIds` entries
   the plan calls out, so there was no risk of colliding with Task 3/8's assertions. `WF-009`'s
   `referredUnitIds` is already empty (its whole story is that the network is exhausted), so
   adding `escalation` there does not touch `referredUnitIds` either.

2. **Made the guard unable to go vacuous again** (`tests/ward-model-phase3.test.ts`): the test
   now accumulates every string it inspects into `inspected: string[]`, asserts
   `expect(inspected.length).toBeGreaterThanOrEqual(3)` before checking content, and only then
   asserts none of the accumulated strings match `forbidden`. An edit that empties the
   fixture's `withdrawnReferrals`/`escalation` back out now fails the length assertion instead
   of silently passing.

### Proof — both directions, exact output

**Before mutation (real guard, `npx vitest run tests/ward-model-phase3.test.ts --reporter=verbose`):**

```
 RUN  v4.1.10 C:/Users/joshs/.codex/worktrees/ward-management-design/Database

 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > records out-of-catchment as a decline reason 2ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > gives every movement a withdrawn-referral list, even an empty one 1ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > never dates a form later than the placement request it belongs to 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one community-formed patient whose legal clock started before arrival 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient brought in under police escort 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one examined patient, and every examination is dated at or before now 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > holds a bed only with a time for the hold to expire at 1ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > puts a patient on 1A while awaiting examination and on 3B once examined 2ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient on each of 1A and 3B 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > keeps every new field free of anything that identifies a person 1ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  14:33:43
   Duration  564ms (transform 135ms, setup 0ms, import 271ms, tests 10ms, environment 0ms)
```

**After re-applying the coordinator's mutation** (line 74 changed to
`const forbidden = new RegExp(".*");`, everything else unchanged):

```
 RUN  v4.1.10 C:/Users/joshs/.codex/worktrees/ward-management-design/Database

 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > records out-of-catchment as a decline reason 4ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > gives every movement a withdrawn-referral list, even an empty one 2ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > never dates a form later than the placement request it belongs to 1ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one community-formed patient whose legal clock started before arrival 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient brought in under police escort 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one examined patient, and every examination is dated at or before now 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > holds a bed only with a time for the hold to expire at 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > puts a patient on 1A while awaiting examination and on 3B once examined 3ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient on each of 1A and 3B 0ms
 × |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > keeps every new field free of anything that identifies a person 6ms
   → expected 'Referral withdrawn once RGH Adult Sec…' not to match /.*/

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > keeps every new field free of anything that identifies a person
AssertionError: expected 'Referral withdrawn once RGH Adult Sec…' not to match /.*/

- Expected:
/.*/

+ Received:
"Referral withdrawn once RGH Adult Secure confirmed the bed"

 ❯ tests/ward-model-phase3.test.ts:91:24
     89|     expect(inspected.length).toBeGreaterThanOrEqual(3);
     90|     for (const text of inspected) {
     91|       expect(text).not.toMatch(forbidden);
       |                        ^
     92|     }
     93|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
   Start at  14:34:20
   Duration  946ms (transform 123ms, setup 0ms, import 262ms, tests 19ms, environment 0ms)
```

The mutation now kills the test (1 failed / 9 passed out of 10 — exactly the mutated guard,
everything else still green), so the guard is no longer able to go vacuous. The mutation was
then fully reverted (`git diff` against the committed `tests/ward-model-phase3.test.ts` showed
no diff after reverting) before re-running the required suite and typecheck.

### Re-verification after the fix

`npx vitest run tests/ward-model-phase3.test.ts tests/ward-model.test.ts
tests/ward-eligibility.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts
tests/ward-capacity-reconciliation.test.ts`:

```
 Test Files  6 passed (6)
      Tests  87 passed (87)
```

`npx tsc --noEmit -p tsconfig.json` — no output, exit code `0`.

Both were re-run a second time after `npx prettier --write` reformatted
`src/components/ward-management/ward-movements.ts` (Prettier wrapped the new
`escalation.triedUnitIds` array literal onto multiple lines — a pure formatting change, visible
in the commit diff) — same result both times: 87/87 passed, `tsc` clean.

### Notes

- I did not touch `tests/ward-eligibility.test.ts` in this round; Fix Round 1 only concerns the
  vacuous privacy guard in Task 1's own new test file.
- `withdrawnReferrals` entries' `at` values are all before their movement's `NOW_ANCHOR`-relative
  present and plausible relative to `openedAt`, though the phase-3 test suite does not assert
  bounds on `withdrawnReferrals[].at` specifically (only on `formedAt`, `examination.at`, and
  `bedHeldUntil`).

---

## Fix round 2 — every 3B deadline now derives from its own examination

Commit: `2d59219d0d7a849c07d15c870580dff7437be9cd`
`fix(ward-flow): derive every 3B deadline from its own examination`
(on top of `0612fdfa0` — the branch had moved on through the reducer and provider tasks since
Fix Round 1; not amended)

### What happened

A Phase 2 Chromium journey (`orders by clinical tier first and labels the score as operational,
not clinical`, `tests/ui-ward-coordinator.spec.ts:213`) failed once Playwright finally ran at
Task 4 — nothing in Task 1 through Task 3 runs a browser. Cause: before Task 1, WF-017 was a 3A
with `dueAt: NOW_ANCHOR - 25` (breached). Fix Round 1's conversion to 3B set
`dueAt: NOW_ANCHOR + 5`, an invented value with no relationship to its `examination.at`, which
happened to also stop being breached and erased the only breached row at the top of the
coordinator queue.

### The deeper defect and the fix

All three 3B records (WF-003, WF-009, WF-017) carried a `legalForm.dueAt` picked independently of
`examination.at`, while Task 2's reducer derives `dueAt` as
`examination.at + EXAMINATION_TO_BED_WINDOW_MINUTES` (`ward-flow-reducer.ts:166`) whenever it
records an inpatient order. A reducer-produced 3B and a fixture-seeded 3B therefore rendered as
though they meant the same kind of deadline when they did not — exactly the "surface stating
something the data does not support" failure this project keeps hitting.

1. `src/components/ward-management/ward-movements.ts` now imports
   `EXAMINATION_TO_BED_WINDOW_MINUTES` from `ward-model.ts` and writes each 3B record's
   `legalForm.dueAt` as `examination.at + EXAMINATION_TO_BED_WINDOW_MINUTES` — never a literal.
2. Examination times, not deadlines, were the thing chosen:
   - `WF-017`: `examination.at` moved from `NOW_ANCHOR - 10` to `NOW_ANCHOR - 260` (past its
     four-hour window), giving `dueAt: NOW_ANCHOR - 20` — a detained patient examined over four
     hours ago and still in the department, which is what the Chromium journey's top row needs to
     show.
   - `WF-003`: `examination.at` unchanged at `NOW_ANCHOR - 60`, giving `dueAt: NOW_ANCHOR + 180` —
     comfortably `clear` (the "at least one other 3B patient comfortably inside their window" the
     coordinator asked for).
   - `WF-009`: `examination.at` moved from `NOW_ANCHOR - 45` to `NOW_ANCHOR - 100`, giving
     `dueAt: NOW_ANCHOR + 140` — see "Diagnosis" below for why this specific value, rather than
     leaving it where Fix Round 1 put it.
3. `tests/ward-model-phase3.test.ts` gained a pin test: for every movement whose
   `examination.outcome` is `inpatient_order`, `legalForm.dueAt` must equal
   `examination.at + EXAMINATION_TO_BED_WINDOW_MINUTES`. It is written against `wardMovements`
   generally, not the three specific IDs, so it also covers any future 3B record.

### Diagnosis — why WF-009 needed a new `examination.at`, not just the derived formula

Fixing WF-017 alone (steps 1–2 for WF-017 only) made the required Chromium assertion at line 269
pass (`firstRow` shows "passed its deadline") but broke a second assertion two lines later,
`await expect(secondRow).not.toContainText("passed its deadline")`, with the second row now
occupied by `WF-303` — a **generated** movement (`routineMovements(30, 300)`, index 303), not
anything Task 1 or either fix round has ever touched. I traced this rather than touching the
assertion or `WF-303` itself:

- `WF-303`'s `legalForm.dueAt` comes from a pre-existing Phase 1/2 formula
  (`NOW_ANCHOR + (((index * 53) % 400) - 60)`, present since commit `1425b38c6`, "build movements
  at realistic metro pressure" — well before Task 1). For `index = 303` this evaluates to
  `NOW_ANCHOR - 1`: `WF-303` has been a coincidentally-breached, tier-1, "accepted_awaiting_bed"
  movement since before this Phase 3 work began. Nothing in this fix round changed it, and nothing
  is allowed to under instruction 4 (only 3B/examination fields are in scope).
- Using `src/components/ward-management/ward-priority.ts`'s `operationalScore`, I computed exact
  scores at `NOW_ANCHOR` (via a throwaway `tsx` script, not committed) for the pre-Task-1 fixture,
  the Fix-Round-1 fixture, and each candidate Fix-Round-2 fixture:
  - **Pre-Task-1**: `WF-017` scored 71 (breached), `WF-009` scored 63 (its old invented
    `dueAt: NOW_ANCHOR + 150` fell inside clockState's "due" bucket, +10 points), `WF-303`
    scored 61 — so `WF-009` legitimately outranked `WF-303` for second place. This is why the
    Chromium test's original author could write "WF-009 (second row) has an unbreached deadline"
    truthfully.
  - **After deriving WF-009's deadline correctly from its Fix-Round-1 `examination.at` of
    `NOW_ANCHOR - 45`** (`dueAt: NOW_ANCHOR + 195`, comfortably `clear`, 0 statutory points):
    `WF-009` drops to 53 — below `WF-303`'s constant 61. `WF-303` becomes the second row, and it
    is breached, failing the assertion. The old invented deadline had been silently masking
    `WF-303`'s pre-existing, incidental breach the whole time; deriving `WF-009`'s deadline
    correctly is what exposed it — not a mistake in the derivation itself.
  - The coordinator's own instruction 2 gave latitude for exactly this: "Set **each** record's
    `examination.at`... Keep **at least one** other 3B patient comfortably inside their window" —
    implying I could choose between `WF-003` and `WF-009` for which one stays comfortable. I kept
    `WF-003` fully `clear` and moved `WF-009`'s `examination.at` to `NOW_ANCHOR - 100`, landing its
    derived `dueAt` (`NOW_ANCHOR + 140`) inside clockState's "due" bucket (60–179 minutes
    remaining, +10 statutory points, not breached). That restores `WF-009`'s score to 63 — the
    same value it held before any of this work, and still comfortably above `WF-303`'s 61 — while
    remaining fully "derived, not invented" per the new pin test. It is also a more coherent
    narrative for `WF-009` specifically: the movement with five declines and an exhausted referral
    network plausibly was examined earlier than a patient with a single, still-live referral.
  - I verified this is not a timing coincidence: the coordinator screen's clock only advances by
    real wall-clock minutes since page mount (`ward-flow-provider.tsx`, `elapsed = wallClockNow()
    - mountedAt`when unpinned) rather than being frozen —`now`can drift forward by a small
integer number of minutes over a test's real runtime. I recomputed the top-6 ranking at`NOW_ANCHOR + {0, 1, 2, 5, 10}` and the order (`WF-017`, `WF-009`, `WF-303`, ...) held at every
      offset, so this ordering is not sensitive to exactly when Playwright captures the DOM.

### Proof — both directions, exact output

**Before mutation (final committed state,
`npx vitest run tests/ward-model-phase3.test.ts --reporter=verbose`):**

```
 RUN  v4.1.10 C:/Users/joshs/.codex/worktrees/ward-management-design/Database

 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > records out-of-catchment as a decline reason 3ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > gives every movement a withdrawn-referral list, even an empty one 1ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > never dates a form later than the placement request it belongs to 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one community-formed patient whose legal clock started before arrival 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient brought in under police escort 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one examined patient, and every examination is dated at or before now 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > holds a bed only with a time for the hold to expire at 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > puts a patient on 1A while awaiting examination and on 3B once examined 2ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient on each of 1A and 3B 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > keeps every new field free of anything that identifies a person 1ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > derives every 3B deadline from its own examination rather than inventing one 0ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  17:05:05
   Duration  475ms (transform 117ms, setup 0ms, import 234ms, tests 11ms, environment 0ms)
```

**After mutating WF-009's derived `dueAt` by one minute** (temporarily changed line to
`dueAt: NOW_ANCHOR - 100 + EXAMINATION_TO_BED_WINDOW_MINUTES + 1`, everything else unchanged):

```
 RUN  v4.1.10 C:/Users/joshs/.codex/worktrees/ward-management-design/Database

 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > records out-of-catchment as a decline reason 3ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > gives every movement a withdrawn-referral list, even an empty one 3ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > never dates a form later than the placement request it belongs to 1ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one community-formed patient whose legal clock started before arrival 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient brought in under police escort 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one examined patient, and every examination is dated at or before now 0ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > holds a bed only with a time for the hold to expire at 1ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > puts a patient on 1A while awaiting examination and on 3B once examined 3ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > carries at least one patient on each of 1A and 3B 1ms
 ✓ |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > keeps every new field free of anything that identifies a person 1ms
 × |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > derives every 3B deadline from its own examination rather than inventing one 8ms
   → expected 783 to be 782 // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |node| tests/ward-model-phase3.test.ts > Phase 3 model additions > derives every 3B deadline from its own examination rather than inventing one
AssertionError: expected 783 to be 782 // Object.is equality

- Expected
+ Received

- 782
+ 783

 ❯ tests/ward-model-phase3.test.ts:106:41
    104|     expect(inpatientOrdered.length).toBeGreaterThan(0);
    105|     for (const movement of inpatientOrdered) {
    106|       expect(movement.legalForm?.dueAt).toBe(movement.examination!.at …
       |                                         ^
    107|     }
    108|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
   Start at  17:05:24
   Duration  608ms (transform 172ms, setup 0ms, import 328ms, tests 23ms, environment 0ms)
```

The mutation kills exactly the new pin test (1 failed / 10 passed) and nothing else. It was then
fully reverted — confirmed with `grep -n "EXAMINATION_TO_BED_WINDOW_MINUTES + 1"
src/components/ward-management/ward-movements.ts` returning no match — before re-running the
required suite.

### Browser gate — exact "N passed" line

`npm run ensure` confirmed the dev server already running at `http://localhost:3718`, matching the
URL the coordinator gave.

Final run against the committed state (`2d59219d0`):

```
PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line

Running 21 tests using 1 worker
...
  21 passed (44.7s)
```

The initial run (before the `WF-009` examination-time adjustment above) failed exactly one test —
`tests/ui-ward-coordinator.spec.ts:213:7 › orders by clinical tier first and labels the score as
operational, not clinical`, on `expect(secondRow).not.toContainText("passed its deadline")` — with
`WF-303` in the second row showing `"Form 1A passed its deadline 1 min ago"`. That failure and its
diagnosis are described above; after the `WF-009` fix, the same 21-test run passed in full, twice
(once before commit, once after, both 21/21).

### Re-verification after the fix

`npx vitest run tests/ward-model-phase3.test.ts tests/ward-model.test.ts
tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts`:

```
 Test Files  4 passed (4)
      Tests  61 passed (61)
```

`npx tsc --noEmit -p tsconfig.json` — no output, exit code `0`.

Also re-ran, as extra safety since `dueAt`/breach state feeds queue ordering everywhere: the full
`ward-*` Vitest suite plus `ward-eligibility`/`ward-priority`/`ward-pressure`/
`ward-capacity-reconciliation` — 117 passed, `tsc` clean, both before and after `npx prettier
--write` reformatted `tests/ward-model-phase3.test.ts` (one import line and one filter expression
collapsed onto a single line under 120 characters; `ward-movements.ts` reported unchanged).

### Notes

- Per instruction 4, `referredUnitIds`, the `formedAt` values, `arrivalMode`, `bedHeldUntil`, and
  the `withdrawnReferrals`/`escalation` strings from Fix Round 1 were not touched — reconfirmed by
  `git diff` showing only `legalForm`/`examination` lines changed on `ward-movements.ts` in this
  round's commit.
- `WF-303`'s own coincidental breach is unresolved and out of this round's scope — it is real,
  pre-existing Phase 1/2 fixture behaviour, not something either fix round introduced, and fixing
  it was neither requested nor necessary once `WF-009`'s legitimate rank was restored. It remains
  available as a third, breached, tier-1 row for any later task that wants one.
