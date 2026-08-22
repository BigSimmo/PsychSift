# Task 12 — controller addendum (read this WITH the brief; where they differ, this wins)

Task 12 is the last task and the one that proves the phase. It builds the role switcher and the
single end-to-end journey that walks one patient through all four roles in one browser window.

**The plan's version of that journey cannot work.** Two independent defects were found before
dispatch, verified by a second agent driving the real reducer, and a third emerged from the design
work. All three are settled below. Read `task-12-journey-design.md` alongside this file — it carries
the full event-by-event sequence and supersedes this document on any point of detail.

---

## R41 — the journey must not start with `.first()`

The plan does:

```ts
const firstRow = queue.locator('[data-testid^="ward-queue-row-"]').first();
```

Measured against the real `queueOrder` at `NOW_ANCHOR`, rank 1 is **WF-303 at stage
`accepted_awaiting_bed`**. `REFER_TO_UNITS` accepts only `placement_requested` or
`destination_review`, so `canRefer` is false, the Refer control carries `aria-disabled="true"`, and
**the journey cannot begin**.

This is the third `.first()` failure in this phase. Rank-based selection is retired for the whole
phase: **no ward test selects a movement by rank.**

## R48 — the subject is `WF-315`, and my own first suggestion was wrong

I originally recommended WF-009 because it is referable. It is also **already declined by all five
secure units**, so every candidate comes back `eligible=false` and the Refer control stays
unavailable for a second, different reason. I had checked one property and assumed the rest.

**Use `WF-315`**, verified by running the real derivations:

- stage `placement_requested` — referable
- `originEdId: "arm-ed"` — resolves to a real department
- no prior declines, no existing referrals
- **three candidates, all `eligible=true`**: `rph-adult-secure`, `fsh-adult-secure`, `rgh-adult-secure`

The full corrected chain has been driven through the real `wardFlowReducer` from a fresh seed with
**zero rejections end to end**, and WF-315 was confirmed to leave `queueOrder` after arrival.

**Re-verify this yourself before relying on it.** Six fixture claims in this phase have turned out
false, three of them mine.

## R42 — the journey must include the handover, and the spec says so

The plan's journey runs: coordinator refers → ward accepts → ward holds bed → officer's four
actions. It never dispatches `HANDOVER_READY`.

Read from the reducer: `HANDOVER_READY` requires stage `bed_held` and is the **only** producer of a
`transport` job. `TRANSPORT_ACCEPTED` refuses without one. So without that step the officer's job
never exists and all four of its actions are refused.

Spec section 14 states the journey **with** the handover present: "bed held, **handover**, the
officer's four actions, arrived closes the record and the bed is consumed." The plan's test dropped
it. The spec wins.

`HANDOVER_READY` is an **ED-role** event, so the journey gains an ED step and genuinely exercises
all four roles — which is what the test's own name claims and what the plan's version did not.
Task 11 builds that control under ruling R49; confirm it exists before writing the step.

## R52 — the switch to the ward is ambiguous, and must use the picker

Task 12's build note says the switcher infers where you stand from the selected patient — "Ward goes
to the unit it was referred to", singular.

But the journey's whole point is that the coordinator refers to **up to three** wards in parallel
(spec section 2 decision 7). Immediately after the referral step, WF-315 carries three live
`referredUnitIds` and there is no single unit to infer.

Spec section 9 already provides the mechanism: the inference is paired with "a picker to move
elsewhere". So the switcher **infers a destination when exactly one is implied, and otherwise offers
the choice**. Silently taking the first referral would be a `?? array[0]` in interaction form, and
the conservative-failure rule forbids it: where the data does not determine an answer, show the
options rather than pick one.

The ED hop needs no picker — `WF-315.originEdId` is exactly `arm-ed`.

---

## The property that matters more than any assertion in this test

**The journey must navigate by clicking, never by `page.goto()`.**

A `goto` is a full page load, which re-mounts `WardFlowProvider` and resets all state to seed. The
test would then pass or fail for reasons entirely unrelated to the code, while still looking like it
proved the loop. This is in the spec, in the plan, and in the design document, and it is the single
most important property of the whole task.

The one permitted `goto` is the initial navigation that opens the coordinator screen.

## The final assertion is correct as written — only its id was wrong

Verified from the code, not assumed: `isOpen` is `!movement.closure && movement.stage !== "arrived"`,
`queueOrder` applies `.filter(isOpen)` before sorting, and `PATIENT_ARRIVED` sets both `closure` and
`stage: "arrived"` in the same update. So an arrived movement genuinely leaves the queue.

Keep `toHaveCount(0)`; point it at WF-315.

---

## The switcher itself

Four roles. The coordinator is **statewide and has no place** — the switcher must show that
asymmetry rather than inventing a location for it. Each destination is a real `<Link>` so the routes
stay reachable. Tap targets 3rem.

Note the routes now exist and are all built: coordinator `/ward-management`, ward
`/ward-management/ward/[unitId]`, officer `/ward-management/transport/officer`, ED
`/ward-management/ed/[edId]`.

## Registration traps this phase has already hit twice

- A rail/switcher link built through a helper that takes `href` as a **variable** is invisible to
  `tests/route-reachability.test.ts`, which reads source text. Task 9 hit this and had to switch from
  the `RailLink` helper to a raw `<Link>`.
- Playwright matches accessible names by **substring**. Task 9 had to relabel "Transport officer" to
  "Officer" because it collided with the existing "Transport" rail link. Choose switcher labels that
  cannot collide with each other or with existing nav.

## Gates

Baselines move as each task lands — **read the ledger for the current numbers before claiming a
delta**, do not carry these forward blindly. At `b2e0a92aa` they were: node-env **139 passed across
11 files**; jsdom `ward-screen` 3, `ward-flow-clock-consistency` 1, `ward-flow-provider` 4,
`ward-flow-queue-selection` 1; ward Chromium **32 passed**. Task 11 adds to all of these.

`npm run lint` is required and exits 0 **without running** when the repo lock is held, printing
`DATABASE_HEAVY_RUN_ADMISSION_BUSY`. A real pass echoes the inner `lint:internal` eslint command
with no busy marker.

The dev server must be started **as a backgrounded task**, never `nohup … & disown`, and liveness
proved with a **Node** request rather than `curl` — see ruling R61.

Mutation-test every test added. Print the edited line back from the file. If something survives a
mutation that should kill it, **say so and stop** — do not reformulate until something goes red.

---

## R67 — the journey now opens with the examination, because the clinician's rule says it must

Added after the clinical changes landed at `f08abf3df` and `2affc37d9`. The product owner ruled:

> "the reality is in ED that a patient needs review before they are referred for a bed as they may
> not need a bed."

The plan's journey starts at the referral. Under that rule it should start one step earlier.

**WF-315 makes this possible, and I checked its record rather than assuming.** It carries
`legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: 877 }`,
`legalStatus: "Referred for psychiatric examination"`, **no `examination` recorded**, stage
`placement_requested`, origin `arm-ed`, urgency 1, Adult/Secure.

`RECORD_EXAMINATION` refuses unless `legalForm.code === "1A"` and no examination already exists.
WF-315 satisfies both.

**So the journey gains a first step: the ED records the examination with outcome `inpatient_order`.**
That flips the form 1A → 3B, and — since the clinical change at `2affc37d9` — earns the movement the
"Bed need confirmed" factor, so its position in the coordinator's queue visibly improves as a direct
consequence of being reviewed. The journey then proves the clinician's rule rather than quietly
contradicting it.

Full sequence, ten UI steps across all four roles:

1. **ED** (`/ward-management/ed/arm-ed`) — record examination, outcome `inpatient_order`.
2. **Coordinator** — select `ward-queue-row-WF-315`, pick all three candidates, Refer.
3. **Ward** (`rph-adult-secure`, reached via the **picker** — three live referrals, see R52) —
   Accept in principle.
4. **Ward** — Hold a bed.
5. _(optional)_ **Coordinator** — confirm the acceptance is visible from another role.
6. **ED** — Mark handover ready (the control Task 11 added under R49). Creates the transport job.
7. **Officer** — Accepted.
8. **Officer** — En route.
9. **Officer** — Collected.
10. **Officer** — Arrived. Closes the record and consumes the bed.
11. **Coordinator** — assert `ward-queue-row-WF-315` has count 0.

**Verify the whole chain through the real reducer before writing the browser test**, exactly as the
design document did for the nine-step version: drive it from a fresh seed and assert
`state.rejections` stays empty end to end. If the added examination step changes anything downstream
— it should not, but "should not" is not evidence — that is a finding, not something to work around.

**Everything else in this addendum still applies**, in particular: navigate by clicking and never
`page.goto()` after the initial load; pin by id and never by rank; and use the picker rather than
inference for the ward hop.

Note the journey now also exercises `RECORD_EXAMINATION` from a real control, which nothing else in
the phase's browser coverage does.
