# Task 12 journey — defect verification and corrected design

Offline analysis only. No production code, no tests, no commits. All claims below were checked
by running real code against the real fixture and reducer (`npx tsx` probes under
`artifacts/probe/`, deleted after use — `git status --porcelain` confirmed no trace). Nothing
here was inferred from field names alone.

## Verdicts on the two claimed defects

### Defect 1 — CONFIRMED

Ran `queueOrder(wardMovements, NOW_ANCHOR)` (the real function, the real fixture, `NOW_ANCHOR =
642`) and printed the top 8 rows:

```
WF-303 stage=accepted_awaiting_bed referable=false hasTransport=false
WF-009 stage=destination_review    referable=true  hasTransport=false
WF-312 stage=handover_ready        referable=false hasTransport=false
WF-315 stage=placement_requested   referable=true  hasTransport=false
WF-306 stage=moving                referable=false hasTransport=true
```

This exactly matches the preflight table. Row 1 is `WF-303` at `accepted_awaiting_bed`, which
`REFERRABLE_MOVEMENT_STAGES` (`ward-flow-reducer.ts:16`, `["placement_requested",
"destination_review"]`) does not include, and `shortlist-panel.tsx`'s `canRefer` includes
`referralBlockedReason(movement) === undefined` as a hard gate — so `.first()` on the queue
does start on an un-referable row and the Refer control would be `aria-disabled`. **Confirmed as
stated.**

### Defect 2 — CONFIRMED, and worse than stated

Read `HANDOVER_READY` and `TRANSPORT_ACCEPTED` directly from `ward-flow-reducer.ts` (lines
309–341): `HANDOVER_READY` requires stage `bed_held` and is the only case that ever sets
`movement.transport`; `TRANSPORT_ACCEPTED` refuses unless `stage === "handover_ready" &&
movement.transport`. A journey that goes coordinator → ward accepts → ward holds bed → officer's
four actions, with no `HANDOVER_READY` in between, would have all four officer dispatches
refused — reran this exact sequence (see the full walk below, event 5 without a preceding
`HANDOVER_READY`) and confirmed `TRANSPORT_ACCEPTED` is rejected with `cannot accept transport
while the movement is bed_held`. **Confirmed as stated.**

**Additional finding beyond the two claims, found while verifying the preflight doc's own
suggested fix:** the preflight doc proposes `WF-009` as "the obvious candidate" for the rebuilt
journey. I ran `eligibleCandidates(WF-009, NOW_ANCHOR, 3)` (real function, real fixture) and it
is a trap of its own:

```
WF-009 shortlist: rph-adult-secure eligible=false (prior_decline)
                  scgh-adult-open  eligible=false (security — Open ward, Secure movement)
                  fsh-adult-secure eligible=false (prior_decline)
```

`WF-009` has already been declined by 5 of the network's 7 Adult Secure units, and the remaining
two (`brm-adult-secure`, `sjgs-adult-secure`) separately fail `allocatable_bed` /
`authorisation` — the movement's own fixture comment says the search is "exhausted." Its
shortlist's top 3 candidates are **all ineligible**, so `canRefer`'s `allSelectedEligible` check
would be false and the Refer button would still be `aria-disabled` even after fixing defect 1's
`.first()` bug — a third, undocumented trap in the preflight doc's own proposed fix. `WF-009`
must not be used. See "chosen movement" below for what I used instead.

## Chosen movement: `WF-315`

**Verified, not assumed**, via `eligibleCandidates`, `allEmergencyDepartments().find`, and a full
`wardFlowReducer` walk:

- Seed stage: `placement_requested` (referable).
- `originEdId: "arm-ed"` resolves via `allEmergencyDepartments().find` to a real department:
  "Armadale Hospital Emergency Department".
- `eligibleCandidates(WF-315, NOW_ANCHOR, 3)` returns exactly 3 candidates, **all eligible**:
  `rph-adult-secure`, `fsh-adult-secure`, `rgh-adult-secure` (cohort `Adult`, security `Secure`,
  legal status `Referred for psychiatric examination`).
- Ran the **entire** corrected event chain through the real `wardFlowReducer` (see sequence
  below) starting from `seedWardFlowState()`: 8 dispatches, **`state.rejections.length === 0`**
  at every step and at the end. Full transcript:

```
unit rph-adult-secure before: allocatable=1 empty=2
unit fsh-adult-secure before: allocatable=3 empty=3
unit rgh-adult-secure before: allocatable=1 empty=1
[1 coordinator refers to 3] rejected=false stage-after=destination_review
[2 ward accepts]            rejected=false stage-after=accepted_awaiting_bed
  withdrawnReferrals after accept: fsh-adult-secure, rgh-adult-secure
[3 ward holds bed]          rejected=false stage-after=bed_held
  unit rph-adult-secure allocatable after hold = 0
[4 ed handover ready]       rejected=false stage-after=handover_ready
  transport: { id: 'WF-315-transport', provider: 'State patient transport service', escortRequired: true }
[5 officer accepted]        rejected=false stage-after=handover_ready
[6 officer en route]        rejected=false stage-after=handover_ready
[7 officer collected]       rejected=false stage-after=moving
[8 officer arrived]         rejected=false stage-after=arrived
final movement: stage=arrived closure={outcome:'arrived',...} isOpen=false
unit rph-adult-secure final: allocatable=0 empty=1
WF-315 still in queueOrder after arrival? false
Total rejections across whole journey: 0
```

Queue rank at seed: 4th (of 41 open movements) — close to where the original broken test already
looked, so the corrected journey is a small, well-understood deviation rather than a jump to an
obscure fixture row.

**Runners-up, checked at the data level (stage + `eligibleCandidates` + ED resolution; not
full-walked through the reducer) and rejected only in favour of `WF-315`, not because anything is
wrong with them:**

- `WF-001` — `placement_requested`, `originEdId: "arm-ed"` (same department as `WF-315`), cohort
  `Adult`/security `Open`, candidates `[scgh-adult-open, rph-adult-secure, fsh-adult-secure]`, all
  3 eligible. Queue rank 6. A perfectly valid alternative; not chosen only because `WF-315`'s rank
  (4) is closer to the original defective test's starting point.
- `WF-017` — `destination_review`, `originEdId: "jhc-ed"`, cohort `Adult`/security `Secure`,
  candidates `[rph-adult-secure, fsh-adult-secure, rgh-adult-secure]`, all 3 eligible. Queue rank 9.
- `WF-012`, `WF-301`, `WF-322` — same candidate set as `WF-315`/`WF-017` (all 3 Adult Secure units
  eligible), `placement_requested`, EDs resolve. Ranks 28/24/26.

Full referable-movement survey (17 of 48 movements sit in a referable stage; 15 of those 17 have
an eligible first candidate and a resolving origin ED — the other 2 are `WF-009` and `WF-308`,
both fully exhausted like `WF-009` above) is in the deleted probe output; the counts above are
reproducible by rerunning `eligibleCandidates` over `wardMovements` at `NOW_ANCHOR`.

## Event-by-event sequence

All `now = NOW_ANCHOR` (the browser test never advances the clock). Each row is a UI action that
dispatches the named event; "stage before → after" is the real value observed in the reducer walk
above, not inferred.

| #   | Screen (role)                                                                         | UI action                                                                                                                                | Event dispatched                                             | Stage before → after                                                                                                                             |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Coordinator                                                                           | Click queue row `ward-queue-row-WF-315` (**not** `.first()` — locate it by id)                                                           | — (selection only)                                           | `placement_requested`                                                                                                                            |
| 2   | Coordinator                                                                           | Click all 3 candidate rows (`ward-shortlist-candidate-rph-adult-secure`, `-fsh-adult-secure`, `-rgh-adult-secure`), then click **Refer** | `REFER_TO_UNITS` role=`coordinator`, `unitIds=[rph,fsh,rgh]` | `placement_requested` → `destination_review`                                                                                                     |
| 3   | _(switch role → Ward, pinned to `rph-adult-secure` — see "role switches" below)_ Ward | Click **Accept in principle** on the `ward-incoming-WF-315` row                                                                          | `ACCEPT_IN_PRINCIPLE` role=`ward`, `unitId=rph-adult-secure` | `destination_review` → `accepted_awaiting_bed` (the other two referrals move to `withdrawnReferrals`)                                            |
| 4   | Ward                                                                                  | Click **Hold a bed**                                                                                                                     | `HOLD_BED` role=`ward`, `unitId=rph-adult-secure`            | `accepted_awaiting_bed` → `bed_held` (unit `rph-adult-secure` allocatable 1→0)                                                                   |
| 5   | _(optional, recommended)_ switch role → Coordinator                                   | Check `Explainable shortlist` contains `Accepted destination: RPH Adult Secure`                                                          | —                                                            | `bed_held` (unchanged; verifies the acceptance is visible from another role)                                                                     |
| 6   | _(switch role → ED, pinned to `arm-ed` — single origin, unambiguous)_ ED              | Click a handover-ready control — **this control does not currently exist in the plan; see finding below**                                | `HANDOVER_READY` role=`ed`                                   | `bed_held` → `handover_ready` (creates `transport: {id: "WF-315-transport", provider: "State patient transport service", escortRequired: true}`) |
| 7   | _(switch role → Transport officer)_ Officer                                           | Click **Accepted** on `ward-officer-job-WF-315`                                                                                          | `TRANSPORT_ACCEPTED` role=`officer`                          | `handover_ready` (unchanged; `transport.acceptedAt` set)                                                                                         |
| 8   | Officer                                                                               | Click **En route**                                                                                                                       | `TRANSPORT_EN_ROUTE` role=`officer`                          | `handover_ready` (unchanged; `transport.enRouteAt` set)                                                                                          |
| 9   | Officer                                                                               | Click **Collected**                                                                                                                      | `PATIENT_COLLECTED` role=`officer`                           | `handover_ready` → `moving`                                                                                                                      |
| 10  | Officer                                                                               | Click **Arrived**                                                                                                                        | `PATIENT_ARRIVED` role=`officer`                             | `moving` → `arrived` (closure set; unit `rph-adult-secure` empty 2→1)                                                                            |
| 11  | _(switch role → Coordinator)_ Coordinator                                             | Assert `ward-queue-row-WF-315` has count 0                                                                                               | —                                                            | `arrived`, `isOpen() === false`                                                                                                                  |

Every transition above was proven with `state.rejections` staying empty across the whole chain —
not asserted from reading the reducer, but from actually running it.

## Role switches required

**Five switches**, touching all four roles plus two returns to coordinator (one interim
verification, one final assertion): Coordinator → **Ward** → _(Coordinator, optional check)_ →
**ED** → **Officer** → **Coordinator**. The minimum to satisfy the spec's four-role requirement
without the optional interim check is **4 switches**: Coordinator → Ward → ED → Officer →
Coordinator.

Two of these switches are not simple "go to my role's one screen" moves and need to be designed
deliberately:

- **The switch to Ward is ambiguous with 3 live referrals.** Task 12's own build note says "Ward
  goes to the unit it was referred to" — singular, which only works cleanly when exactly one
  referral is live. After step 2 above, `WF-315` has **three** live referrals
  (`referredUnitIds = [rph, fsh, rgh]`). The journey must use the "picker to move elsewhere" the
  same build note mentions, explicitly selecting `rph-adult-secure`, rather than relying on
  single-referral inference.
- **The switch to ED is unambiguous** — `WF-315.originEdId` is exactly one department (`arm-ed`),
  so "ED goes to its origin department" resolves cleanly with no picker needed.

## Corrected final assertion

Checked, not assumed: `isOpen(movement)` (`ward-derivations.ts:98`) is
`!movement.closure && movement.stage !== "arrived"`. `PATIENT_ARRIVED` sets both `closure` and
`stage: "arrived"` in the same update. `coordinator-screen.tsx:105` builds the queue as
`queueOrder(filteredMovements, now)`, and `queueOrder` (`ward-priority.ts:99`) filters
`.filter(isOpen)` before sorting. The reducer walk above confirms it directly: `"WF-315 still in
queueOrder after arrival? false"`. I also confirmed no ED filter is active during the journey —
`filteredMovements` only narrows when `selectedEdId` is set via the pressure-strip filter control,
which this journey never clicks, so `filterEdId` stays `undefined` throughout and the full,
unfiltered queue is what's rendered.

**The plan's original final assertion is correct as written** —
`await expect(queue.locator('[data-testid="ward-queue-row-WF-315"]')).toHaveCount(0)` — once
pinned to the correct movement id. No change needed to the assertion itself, only to which id it
targets.

## Everything else in the plan's Task 12 test that will not work, or is unverifiable

1. **`.first()` on the queue row (defect 1, confirmed above).** Must be replaced with a
   locator pinned to `ward-queue-row-WF-315`.
2. **`.first()` on the shortlist candidate.** The plan's step
   `shortlist.locator('[data-testid^="ward-shortlist-candidate-"]').first().click()` only selects
   one candidate. To satisfy spec §14's "coordinator refers to three," this must become three
   clicks — one per candidate testid (`ward-shortlist-candidate-rph-adult-secure`, `-fsh-`,
   `-rgh-`) — before clicking Refer, per `shortlist-panel.tsx`'s `toggleReferTarget`/`referTargets`
   multi-select logic (`canRefer` requires `hasReferSelection`, and Refer dispatches
   `unitIds: [...referTargets]`, so a single-candidate click only ever refers to one unit).
3. **Missing `HANDOVER_READY` step (defect 2, confirmed above).** Needs an ED-role dispatch
   between "ward holds bed" and "officer's four actions."
4. **Task 11 (the ED screen), as currently planned, builds no control that could dispatch
   `HANDOVER_READY`.** I grepped the whole plan file for `HANDOVER_READY`: it appears only in
   Task 2's reducer switch, and in Task 2/3's own Vitest reducer-walk tests (dispatched directly
   against `wardFlowReducer`, never through a UI). Task 11's build note (`docs/superpowers/plans/…
line ~1432`) gives the ED screen exactly two forms — **raise a referral**
   (`RAISE_REFERRAL`) and **record an examination** (`RECORD_EXAMINATION`) — and lists "handover"
   only as one of several _displayed_ "single outstanding item" states, never as an action a
   department can take. **This is a real gap in the plan, not something the corrected test can
   route around**: even after fixing defects 1 and 2 conceptually, Task 12's journey cannot
   dispatch `HANDOVER_READY` from a real ED screen because no task before it plans to build the
   control. This needs either an addition to Task 11's build note (a "mark ready for handover"
   action alongside the two existing forms, on a `bed_held` movement) or an explicit new step
   inside Task 12 itself before the switcher's own proof — it cannot be silently assumed to exist.
   I recommend the former, since Task 11 is the ED-role screen and this is squarely an ED-role
   event.
5. **`ward-unit-screen`, `ward-incoming-<id>`, `ward-officer-screen`, `ward-officer-job-<id>`,
   `ward-ed-screen` and the "Accept"/"Hold a bed" button names do not exist yet — Tasks 8, 9 and
   11 have not been built in this worktree** (`find … -iname "*unit-screen*" -o -iname
"*officer*" -o -iname "*ed-screen*"` returns nothing under
   `src/components/ward-management`). This is the "aspirational, not yet built" category the
   brief distinguishes from "will never work": `ward-incoming-<id>` and `ward-officer-job-<id>`
   testids are explicitly named in Task 8's and Task 9's own briefs and should exist once those
   tasks land. The exact button captions (`/Accept/`, `/Hold a bed/`, and the officer's
   `"Accepted"/"En route"/"Collected"/"Arrived"` labels Task 12 assumes) are **not pinned by Task
   8's or Task 9's own test** — Task 9's own test only asserts `toHaveCount(4)` on the job's
   buttons, not their names — so Task 12's literal regexes are a reasonable but unverified guess
   at Task 8/9's eventual implementation, and should be reconfirmed once those screens exist
   rather than assumed to match exactly.
6. **The "Switch role" button and `menuitem` ARIA roles are self-referential, not broken.** Task
   12 builds both the switcher and the test in the same task, so there is nothing external to
   contradict these selectors — but nothing before Task 12 pins the exact control pattern either
   (menu/menuitem vs. a plain link list), so these are Task 12's own design choice to keep
   consistent with itself, not a claim I could verify against existing code.
7. **The late-addition Task 10 regex defect** (`/Requested|Accepted|En route|Collected|Arrived/`
   failing case-sensitively against `transportStatusLabel`'s lowercase-embedded narrative
   strings) is real per the preflight doc's own reading of `ward-derivations.ts:136-144`, but it
   is **out of scope for Task 12** — it affects Task 10's live-tracker test, not the Task 12
   journey, and Ruling R44 already assigns its fix (a small discrete-leg helper) to Task 10. I did
   not re-verify it since it does not touch the movement, reducer, or role-switch design above.

## What I did not verify

- I did not run Playwright, start or touch the dev server (one was already running on port 3718
  and untouched), or execute `npx vitest`, per the task's constraints.
- I did not inspect the exact rendering Tasks 8/9/11 will produce (they do not exist in this
  worktree) — everything about `ward-unit-screen`, `ward-officer-screen`, `ward-ed-screen`, and
  their internal button/label text is either quoted directly from the plan's own prose or flagged
  above as unverified.
- I did not re-derive or re-check the Task 10 regex/label defect beyond reading the code once to
  confirm it is unrelated to Task 12's movement/reducer/role-switch design.
