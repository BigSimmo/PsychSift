# Ward Flow Phase 3 — the other three roles — Design

**Status:** approved in brainstorming 2026-08-19. Revised the same day after an adversarial review
found one structural hole, four clinical-reality gaps, and five promises the model could not keep.
Binding authority for Phase 3.

Phase 1 built the model. Phase 2 built the flow coordinator's screen against it. **Phase 3 makes
the system move.** It adds the other three roles, and in doing so introduces the first mutable
state this build has ever had.

The coordinator screen is the **primary, guiding screen**. The other three exist to answer it.

---

## 1. What already exists

Six pure modules (`ward-clock`, `ward-model`, `ward-eligibility`, `ward-sites`, `ward-movements`,
`ward-derivations`) plus two Phase 2 additions (`ward-priority`, `ward-pressure`). 17 sites, 8
emergency departments, 22 units, 48 movements of which 41 are open. `NOW_ANCHOR = 642` (10:42).

One coordinator screen at `/ward-management` in five regions — emergency-department pressure
strip, priority queue, flow diagram, explainable shortlist, exceptions drawer — plus a phone form.
Eight further routes: `/network`, `/queue`, `/capacity`, `/movements`, `/exceptions`,
`/transport`, `/governance`, `/patients/[patientId]`. `/constellation` was retired in Phase 2.

Everything to date reads a frozen constant. Nothing has ever changed anything.

Three Phase 2 decisions pay off directly here: `edPressure(now, movements)`,
`queueOrder(movements, now)` and `buildActionInbox(movements, now)` all already accept an injected
movement list rather than importing one, so they work unchanged against mutable state.

---

## 2. Settled decisions

Decided by the product owner. Not open for re-litigation.

| #   | Question                     | Decision                                                                                                           |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Does state persist?          | **No.** It mutates in memory and resets on refresh. No server, no storage.                                         |
| 2   | Phase shape                  | **All four surfaces in one phase.**                                                                                |
| 3   | Which actions genuinely work | **The full placement loop** (section 6). Everything outside it renders but is inert.                               |
| 4   | Role identity                | **In the URL**, with a switcher that follows the selected patient and a picker to move elsewhere.                  |
| 5   | Does the clock move?         | **Yes**, with a jump-forward control.                                                                              |
| 6   | Parallel referral withdrawal | **Instant and automatic**, with the reason shown to the ward and **recorded against the movement**.                |
| 7   | The coordinator's action     | **Refer to up to three wards**, not single placement. Acceptance becomes the ward's move.                          |
| 8   | Security gate                | A locked ward still passes an open patient, worded as _more restrictive than required_; matching wards rank first. |
| 9   | Voluntary on a locked ward   | **Its own distinct flag**, more prominent than the above, prompting a review of legal status. Never blocks.        |

---

## 3. Model changes this phase requires

The adversarial review found the spec promising behaviour the Phase 1 model has nowhere to store.
These are additive changes to `ward-model.ts` and the fixture. They land **before** the reducer,
because its transitions depend on them.

### `Movement` gains

| Field                | Type                                                                                         | Why                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formedAt`           | `Instant \| undefined`                                                                       | **The legal clock and the ED clock are different clocks.** A patient formed in the community at 08:00 who reaches Peel at 11:00 has already spent three hours of the examination window. `openedAt` stays as "when this department raised the placement request"; `formedAt` is when the referral for examination was made. Where they differ the legal clock runs from `formedAt`. |
| `arrivalMode`        | `"self" \| "ambulance" \| "police" \| undefined`                                             | Police in attendance is a real pressure on a department and is invisible today. Ambulance covers the ramp.                                                                                                                                                                                                                                                                          |
| `bedHeldUntil`       | `Instant \| undefined`                                                                       | A hold cannot expire without a time to expire at.                                                                                                                                                                                                                                                                                                                                   |
| `examination`        | `{ at: Instant; outcome: "inpatient_order" \| "community_order" \| "revoked" } \| undefined` | A Form 1A refers a person **for examination**. Until that happens you often do not know whether an authorised bed is needed at all. The bed decision turns on this hinge and the model had no hinge.                                                                                                                                                                                |
| `withdrawnReferrals` | `{ unitId: string; at: Instant; reason: string }[]`                                          | The spec said the withdrawn ward is told why. A shrinking `referredUnitIds` tells nobody anything.                                                                                                                                                                                                                                                                                  |
| `escalation`         | `{ at: Instant; triedUnitIds: string[]; contact: string } \| undefined`                      | See section 11.                                                                                                                                                                                                                                                                                                                                                                     |

### `DECLINE_REASONS` gains `out_of_catchment`

Seven reasons, not six. In metropolitan WA this is among the commonest reasons a ward refuses, and
it generates more argument than any other. Without it the decline data can never show why
placements actually fail, which is the stated purpose of recording a fixed reason at all.

### Two different restriction warnings, not one

Settled by the product owner 2026-08-19. A ward more restrictive than a patient needs raises one of
two notices, and they are **not** the same thing.

- **More restrictive than required.** The movement's `security` is `Open` and the unit's is
  `Secure`. An operational observation: the bed will do, it is simply tighter than needed, and a
  security-matching ward should have ranked above it.
- **Voluntary patient on a locked ward.** The movement's `legalStatus` is `Voluntary` and the
  unit's security is `Secure`. This is the sharper case and gets its own, more prominent flag: a
  voluntary person who cannot leave a locked ward is detained in fact without an order. The flag
  prompts a review of legal status before admission. It does not assert that anything unlawful has
  happened, and it never blocks the placement — the coordinator and the ward decide.

Both are display flags derived by a pure function. **`ward-eligibility.ts` is a protected surface
and neither changes any gate's pass or fail.** Both appear on the coordinator's shortlist and
diagram **and on the ward screen**, because the ward is the party who would be holding the person.

### The statutory form follows the examination

Settled by the product owner 2026-08-19. **Only two detention-pathway forms appear: 1A and 3B.**

- **Form 1A — awaiting examination.** The person has been referred and not yet examined.
- **Form 3B — in an emergency department awaiting a bed.** The person has been examined, carries an
  inpatient order, and is waiting for the bed.

This is derivable from data the model now holds, so it is an invariant rather than an authored
choice: **a movement on 1A has no `examination` recorded; a movement on 3B has one, with outcome
`inpatient_order`.** A contract test pins both directions. Form 3A is not used.

`4A` (transport order) and `4C` (transfer between authorised hospitals) are orthogonal — they
concern moving a person, not detaining them — and are unaffected.

### The fixture

All 48 movements need the new fields populated coherently — the 18 hand-authored ones deliberately,
the 30 generated ones from their index. Some must carry a `formedAt` meaningfully earlier than
`openedAt`, at least one must arrive under police escort, and at least one must have been examined.

---

## 4. Architecture — the state layer

A single `WardFlowProvider` mounted at a new `src/app/ward-management/layout.tsx`, following the
repository's existing React-context pattern. Eight `createContext` providers already exist; no
state library is present and none is added.

```ts
type WardFlowState = {
  movements: Movement[]; // seeded from wardMovements, deep-copied, never mutated in place
  units: Unit[]; // seeded from allUnits(), deep-copied — capacity is mutable
  rejections: Rejection[]; // refused transitions, newest first
  clockOffsetMinutes: number; // demo jump-forward, starts at 0
  referralSequence: number; // deterministic id source for new referrals
};
```

**Units are in the state, and this is the correction that most changes the phase.** In the first
draft the state held movements only, so a ward could accept a patient, hold a bed and receive them
while its free-bed count never moved — twenty patients could be placed into a one-bed ward and the
screen would keep saying one. Every figure on the coordinator screen derives from unit capacity, so
frozen capacity makes the primary screen _less_ true the more it is used.

`now` is **derived, not stored**: `NOW_ANCHOR + minutesSinceMount + clockOffsetMinutes`.

New referral ids come from `referralSequence`. `Math.random()` is banned by the determinism rule.

Every change goes through one pure reducer:

```ts
function wardFlowReducer(state: WardFlowState, event: WardFlowEvent): WardFlowState;
```

The reducer contains no React, no I/O and no clock read — `now` arrives on the event. It is
therefore testable exhaustively in Vitest without a browser, which is where the bulk of this
phase's proof lives.

**The fixture is frozen and copied at seed time.** Both the movements and the units are imported
constants that four screens will now write against; mutating them in place would make tests
order-dependent.

---

## 5. The clock

The fixture's waits and deadlines are measured from 10:42. If `now` became the real time of day,
every patient would read as many hours overdue. So the clock starts at `NOW_ANCHOR` and advances.

- `wallClockNow()` in `ward-clock.ts` — exported since Phase 1 and unused until now — is the only
  permitted wall-clock read, and is consumed here, once, inside the provider.
- A jump-forward control (+15 min, +1 hour) advances `clockOffsetMinutes`, so a held bed can be
  watched expiring in seconds rather than in an hour.
- **Tests inject a fixed `now`.** Only the live application ticks. This is the phase's main
  flakiness risk and the mitigation is structural.

---

## 6. The events

Each is a named event on the reducer. **The role column is enforced by the reducer, not merely
documented** — an event raised by the wrong role is refused and recorded, or the role model is
decoration.

| Event                 | Role        | Effect                                                                                                                                                                      |
| --------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAISE_REFERRAL`      | ED          | Creates a movement at `placement_requested` from a short form; id from `referralSequence`; `owner` set to the raising department.                                           |
| `RECORD_EXAMINATION`  | ED          | Stamps `examination` with its outcome. An outcome of `revoked` closes the movement as did-not-proceed.                                                                      |
| `REFER_TO_UNITS`      | Coordinator | Sets `referredUnitIds`, never above `PARALLEL_REFERRAL_CAP`; stage becomes `destination_review`.                                                                            |
| `ACCEPT_IN_PRINCIPLE` | Ward        | Sets `acceptedUnitId`; stage becomes `accepted_awaiting_bed`; **withdraws every other referral, recording each in `withdrawnReferrals`**.                                   |
| `HOLD_BED`            | Ward        | Stage becomes `bed_held`; sets `bedHeldUntil` to `now + 60`; decrements that unit's allocatable count.                                                                      |
| `DECLINE`             | Ward        | Appends a `Decline` with a reason from the seven; drops the unit from `referredUnitIds` and from that patient's future suggestions; stage returns to `destination_review`.  |
| `HANDOVER_READY`      | ED          | Stage becomes `handover_ready`; transport requested.                                                                                                                        |
| `TRANSPORT_ACCEPTED`  | Officer     | Stamps `acceptedAt`.                                                                                                                                                        |
| `TRANSPORT_EN_ROUTE`  | Officer     | Stamps `enRouteAt`.                                                                                                                                                         |
| `PATIENT_COLLECTED`   | Officer     | Stamps `collectedAt`; stage becomes `moving`.                                                                                                                               |
| `PATIENT_ARRIVED`     | Officer     | Stamps `arrivedAt`; stage becomes `arrived`; **consumes the bed** — the receiving unit's occupancy and sex mix change. The record closes and the patient leaves the system. |
| `CONFIRM_CAPACITY`    | Ward        | The ward restates what it can genuinely allocate. Writes to its own unit only.                                                                                              |
| `RECORD_ESCALATION`   | Coordinator | Stamps `escalation` with what was tried and who is being contacted.                                                                                                         |
| `ADVANCE_CLOCK`       | Demo        | Adds to `clockOffsetMinutes`.                                                                                                                                               |
| `RESET_SCENARIO`      | Demo        | Re-seeds movements and units from the fixture.                                                                                                                              |

**Withdrawal is automatic and is not an allocation.** When one ward accepts, the others see the
referral end with "withdrawn — placed at _X_", and that fact is stored, not merely implied by a
shrinking list. Making a ward wait for a coordinator to release it is the phone-around this system
replaces; concealing the withdrawal is how trust between services breaks.

**An expiring hold raises an exception. It never auto-releases the bed.**

---

## 7. The screens

### Coordinator — primary and guiding

Rewired, not rebuilt. Its five regions stay. Four things change:

1. **It reads live state.** Every figure moves when another role acts, including bed counts.
2. **Its action becomes a referral.** "Confirm placement" becomes _refer to the selected wards, up
   to three_, each told it is one of a parallel set. Acceptance is the ward's move. The system
   suggests, a human decides, nothing auto-allocates.
3. **Answers arrive.** A decline drops that ward from the shortlist, records its reason and time,
   and returns the patient to destination review, live.
4. **It owns the refusals surface.** Every transition the reducer refuses appears here, in the
   exceptions drawer, persistently — not in a toast that vanishes. The seam between four screens
   acting on one patient is where this project has repeatedly found defects.

It also carries the Phase 2 follow-up the owner settled but which was deliberately not implemented
there: the security gate's detail changes from "Secure ward meets an open requirement" to wording
that says the ward is **more restrictive than required**, and candidate ordering ranks a
security-matching ward above an over-restrictive one. `ward-eligibility.ts` is a protected surface
and its pass/fail semantics do not change.

### Emergency department — `/ward-management/ed/[edId]`

Its own patients only. Each carries **both clocks** — time in the department, and the legal clock
running from `formedAt` where that is earlier — its referral state, and **the single outstanding
item**: a form, an examination, a transport request, or handover. Time against the departmental
access target is shown, because that is the number a department is judged on and mental health
patients are its largest breachers. Police attendance is flagged where `arrivalMode` says so.
Statewide capacity is visible and read-only — hiding it would recreate the problem this system
exists to remove.

> **Superseded 2026-08-22.** This section originally named the access target as four hours (240
> minutes). The product owner — this spec's own author — changed it to 24 hours (1440 minutes)
> for this prototype, in response to a direct clinical question. `ED_ACCESS_TARGET_MINUTES` in
> `ward-model.ts` and its tests carry the current value; nothing else about how the figure is
> counted, rendered or safeguarded changed.

It can raise a new referral, and record an examination and its outcome.

No statewide queue, no shortlist, no flow diagram. This is not the coordinator screen filtered.

### Ward — `/ward-management/ward/[unitId]`

One unit, not twenty-two. Confirm what beds are genuinely allocatable by cohort, security and sex
mix. Answer incoming referrals: accept in principle, hold a named bed, or decline with a reason
from the seven. See who has been accepted, held, or is en route here, and what was withdrawn and
why. A parallel referral is labelled as one.

### Transport officer — `/ward-management/transport/officer`

A phone. The model carries no officer identity — `TransportJob` records a `provider`, not a person
— so this surface shows every job not yet arrived rather than inventing an officer to own them, and
says so on the screen. Per job: patient identifier, origin department, destination unit, legal form
required, escort required. **Four actions: accepted, en route, collected, arrived. Nothing else.**

Controls are pinned to the bottom of the viewport rather than scrolled to — the pattern settled for
the coordinator's phone form.

### Live tracker — `/ward-management/transport`

The existing route, rewritten as the coordinator's view of every vehicle: which patient, which leg,
how long since the last stamp.

---

## 8. The other ten routes must read the provider too

The coordinator screen is not the only surface bound to the frozen fixture. Every other Ward Flow
route reads `wardMovements` — or `allUnits()` — directly at import:

- the eight specialist boards served by `ward-management-modes.tsx` (`/queue`, `/capacity`,
  `/movements`, `/exceptions`, `/transport`, `/governance`) and `ward-management-network.tsx`
  (`/network`);
- the patient workspace at `/patients/[patientId]`, served by `ward-management-console.tsx`.

Left alone, a coordinator would refer a patient, click through to the queue board, and see the
world before the referral. Two surfaces describing one patient and disagreeing is the defect class
this project has found in every review it has run — structural this time rather than a slip.

All of them are rewired to read the provider. The provider sits in the layout above them, so they
already have access; the work is mechanical, but `ward-management-modes.tsx` serves eight routes
from one file and needs care.

**One specific trap.** `movementStageSummary` in `ward-derivations.ts` is a module-level constant:

```ts
export const movementStageSummary = stageSummaries(wardMovements);
```

It is computed once when the file loads, not when anything renders, so it can never reflect live
state no matter what else is fixed. Three surfaces consume it. It becomes a function called with
the current movements, and the constant is deleted.

---

## 9. Role switching and identity

The URL carries identity. The switcher offers the four roles and infers _where_ you are standing
from the currently selected patient — switch to Ward with WF-017 selected and you arrive at the
ward it was referred to, seeing WF-017 awaiting your answer. A picker moves you elsewhere.

The coordinator is **statewide and has no place**. The switcher shows that asymmetry rather than
inventing a location for it.

---

## 10. Failure behaviour

**The reducer refuses impossible transitions rather than absorbing them**, and every refusal is
recorded in `rejections` and rendered on the coordinator screen. Named cases:

- A ward accepting a patient already placed elsewhere is told the referral was withdrawn.
- **Two patients, one bed.** Two referrals against a unit's last allocatable bed: the second
  acceptance is refused with `bed_held_for_earlier_referral` — a reason the model already carries
  and the first draft never enforced.
- An event raised by the wrong role is refused.
- A stage transition out of order is refused.

All Phase 1 and Phase 2 rules continue to bind: conservative failure; display less rather than
something plausible; authorisation gates the destination only and never the patient's current
department; urgency tier leads and the operational score is never called severity, acuity or risk;
synthetic data only, including free text; determinism; design tokens; 3rem tap targets.

---

## 11. When there is no bed anywhere

Moved into Phase 3 from Phase 4. For older adults and secure beds — which this model deliberately
makes scarce — exhausting the network is not an exceptional case, it is a normal night. A phase
that only proves the loop which succeeds has not proved the loop.

Minimum viable escalation: when every candidate is ineligible, the coordinator can record that it
happened — what was tried, why each failed, and who is being contacted — stamped on the movement.
The shortlist already renders the first two of those. The full escalation board, with least-bad
options and what would have to change for each to work, stays in Phase 4.

---

## 12. Deliberate simplifications, recorded rather than hidden

- **"The ward accepts" is an organisation accepting, not a person.** In practice acceptance is
  often consultant-to-consultant. The prototype has no authentication and no authority model.
- **At 3am the roles are the same but the people and their authority are not.** Not modelled.
- **Sex mix is per ward.** The real constraint is usually a specific bay or bedroom.
- **Sub-locations inside a department** — corridor, assessment room, observation area — remain out
  of scope, so "longest wait" cannot say where the patient waited.

---

## 13. Out of scope

Deferred to Phase 4: the statutory clock board, the full escalation board, shift handover, patient
search, governance and capacity extensions, and the exception categories the model does not compute
(stale capacity, feed-versus-ward disagreement, overdue bed releases, ownerless movements).

Rendered but inert in Phase 3: urgency changes, legal status changing mid-movement, ward-flagged
bed releases.

---

## 14. How it gets proved

- **The reducer, exhaustively, in Vitest.** Every transition and every refusal. This is the bulk of
  the proof and it needs no browser.
- **Contract tests** for the invariants: parallel referrals never exceed the cap; a declined unit
  never reappears in that patient's suggestions; no movement is left ownerless; **beds always
  account for, before and after every event**; no identity field on any record; no unlawful
  destination is suggested; a withdrawn referral is always recorded.
- **One browser journey per role screen**, plus phone, dark, forced-colours and print.
- **One end-to-end journey in a single window**: ED raises, coordinator refers to three, one ward
  accepts and the other two see withdrawal, bed held, handover, the officer's four actions, arrived
  closes the record and the bed is consumed.
- **That journey must navigate by clicking, never by `page.goto()`.** A `goto` is a full page load,
  which resets the provider — the test would then pass or fail for reasons unrelated to the code.
- Time is injected as a fixed value in every test.

---

## 15. Build order

1. **Documentation truth first.** `docs/ward-flow-context.md` — the file written to be read cold —
   still describes Phase 2 as not started, still lists the retired `/constellation` route, and still
   says no operational score exists. A fresh session reads that page first. Correct it before any
   code.
2. Model additions and the fixture — before anything else executable, because the reducer depends
   on them.
3. The reducer and its tests, including every refusal.
4. The provider, the clock, and the coordinator rewire — nothing else has anywhere to send answers.
5. **Every other Ward Flow route reads the provider** (section 8). Do this immediately after the
   coordinator, not at the end: the window between the two is exactly when the application shows
   two different truths.
6. **The coordinator's phone form pins Confirm to the bottom** rather than scrolling to it. The
   officer's screen inherits this pattern, so it must exist before that screen is built.
7. Ward screen — closes the loop on the coordinator screen.
8. Transport officer phone.
9. Live tracker.
10. ED screen, with both clocks and the access target.
11. Role switcher, then the end-to-end journey.

---

## 16. Risks

- **Ticking clocks and browser tests.** Mitigated by injecting a fixed `now` everywhere except the
  live provider.
- **The frozen fixture.** Deep-copied at seed; mutating it in place makes tests order-dependent.
- **Phase size.** Four surfaces, a state layer, model changes and escalation is now well over twice
  Phase 2, which ran 21 commits and 11 review rounds. The owner chose the four-surface shape
  deliberately; the model corrections are not optional. **If it sprawls, propose a split rather than
  grinding on.**
- **Four screens describing one patient.** Every defect this project has found is a surface stating
  something the data does not support. Four surfaces multiply the opportunity.

---

## 17. Repository conventions this phase must satisfy

New routes need a literal `<Link href="...">` in the rail navigation — hrefs built from an array are
invisible to `tests/route-reachability.test.ts` and the route fails as an orphan. Every route must
be declared in `docs/design-system/adoption-contract.json` followed by
`npm run design-system:adoption:update`. Any new Playwright spec must be added to **both**
`testMatch` and `productionSpecPattern` in `playwright.config.ts`, or it silently runs zero tests.

---

## 18. Open questions for the product owner

Answered 2026-08-19: the statutory form question is settled above. One remains.

- **A voluntary patient on a locked ward.** The security gate currently treats an open-security
  patient offered a secure ward as more restrictive than required. A _voluntary_ patient on a
  locked ward is the sharper case — if they cannot leave, the door is doing what an order should.
  Whether that combination warrants its own distinct flag is a clinical judgement, not an
  engineering one.
