# Ward Flow — complete context

Everything a session needs to work on Ward Flow, in one file. Written to be read cold, without
any prior conversation.

If you are starting Phase 2, read this file, then
[`docs/superpowers/plans/2026-08-18-ward-flow-phase-2-coordinator-screen.md`](./superpowers/plans/2026-08-18-ward-flow-phase-2-coordinator-screen.md).
Everything else referenced here is supporting detail you can reach for when a task needs it.

---

## 1. The problem

A patient in mental health crisis presents to a metropolitan emergency department in Perth and
needs an inpatient psychiatric bed. Finding one is a phone-around.

The mental health liaison nurse or emergency registrar rings services one at a time. The bed
numbers they are told are already stale — someone confirmed them at the start of a shift. Mental
Health Act clocks are running: the Form 1A examination window, a Form 3A detention, a Form 4A
transport order. Transport has to be booked and usually waits. Meanwhile the patient sits in the
department, frequently twelve to twenty-four hours, sometimes far longer.

Nobody holds a single current picture of: who is waiting, which beds are genuinely allocatable,
who has already declined and why, what is legally due and when, and where the vehicle is.

**Ward Flow replaces the phone-around with that shared picture.**

Two constraints drive most of the difficulty, and the product should make both visible rather
than let them be discovered on the fourth call:

- **Older-adult beds are far scarcer than adult beds.** This is the main driver of out-of-catchment
  escalation for that cohort.
- **Authorisation under the Mental Health Act is a property of the receiving site**, not of whether
  a ward door is locked.

### Success criteria

Three measures. Every screen should move at least one; anything that moves none is decoration.

1. Time from referral to a ward accepting.
2. Number of separate contacts a coordinator makes to place one patient.
3. Legal deadlines passed while a patient waits.

---

## 2. Clinical and legal grounding

### The legal rule, stated precisely

**Detention in an emergency department is lawful.** A person referred for examination under
Form 1A may be detained under Form 3A or 3B in a general hospital emergency department that is
**not** an authorised hospital, while awaiting examination and a bed. Emergency departments hold
detained patients routinely. This is the normal state, not an exception — it is where nearly
every patient in this system waits.

**The authorisation requirement bites on the destination.** A person admitted as an involuntary
_inpatient_ must be at a hospital authorised under the Act. Authorisation is a legal property of
the site, granted by the Chief Psychiatrist, and is independent of whether a ward is locked: an
authorised hospital may run open wards, and a locked ward at an unauthorised site still cannot
receive an involuntary admission.

The system therefore applies authorisation as a hard gate on **candidate destinations only**, and
never treats a patient's current location as a compliance problem.

> This rule was got wrong once during this build. The original ADR said an involuntary patient must
> be "detained at an authorised hospital", which reads as though holding a detained patient in an
> ED were unlawful. It has been corrected in `docs/ward-management-decisions.md` ADR 1. Do not
> reintroduce the older phrasing.

### Forms that appear in the model

| Form    | What it does                          |
| ------- | ------------------------------------- |
| 1A      | Referral for psychiatric examination  |
| 3A / 3B | Detention pending examination         |
| 4A      | Transport order                       |
| 4C      | Transfer between authorised hospitals |
| 6A / 6B | Involuntary inpatient orders          |

Each carries a deadline. Timing drives operational priority and generates exceptions.

### The metropolitan services

Three metropolitan health services — **North Metro**, **South Metro**, **East Metro** — plus
**WACHS** (WA Country Health Service) and **Private**. Metro is the focus; WACHS is present so the
model can serve the whole state but is deliberately not the headline.

Sites are asymmetric, and the asymmetry is real and load-bearing:

- **ED and inpatient units:** Royal Perth, Sir Charles Gairdner, Fiona Stanley, Armadale,
  St John of God Midland, Rockingham
- **ED only, feeding elsewhere:** Joondalup, Peel Health Campus
- **Units, no ED:** Fremantle, Bentley, Graylands
- **WACHS, units only:** Albany, Bunbury, Broome, Geraldton, Kununurra
- **Private:** St John of God Subiaco

### Governance this build is written against

- WA Health Artificial Intelligence Policy (MP 0193/25)
- WA Government AI Policy and Assurance Framework
- Privacy and Responsible Information Sharing Act 2024, IPP 10 (automated decision-making, from
  1 July 2026)

The practical consequence: the system **proposes**, a human **confirms or overrides**, always,
with the reason recorded. Every suggestion shows why it fits and what nearly excluded it. Nothing
auto-allocates and nothing defaults after a timeout.

**Not a medical device, and the page says so.** Bed allocation sits close enough to clinical
decision-making that someone will read it that way. The system orders operational work. It never
assesses risk, acuity or treatment.

---

## 3. Scope — settled decisions

These were decided by the product owner (a psychiatrist in Perth) and are not open for
re-litigation. Each is recorded here so a later session does not re-derive it differently.

| #   | Question                     | Decision                                                                                                            |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | What is a movement?          | Getting a patient **to** a ward. Arrival closes the record and the patient leaves the system entirely.              |
| 2   | Transport officer surface?   | **Yes** — a phone view with four write actions: accepted, en route, patient collected, arrived.                     |
| 3   | How many screens?            | **Role-first.** One screen per role; specialist boards exist as routes but leave the top navigation.                |
| 4   | What is "now"?               | **Clocks run.** Durations stored relative to now; tests inject a fixed value.                                       |
| 5   | Queue ordering?              | **Urgency tier first**, operational score within tier. The score carries no urgency component.                      |
| 6   | Track emergency departments? | **Yes, as first-class locations** with per-department pressure: waiting, longest wait, breaching.                   |
| 7   | What happens on a decline?   | Recorded with a fixed reason, and that unit drops out of the suggestions for that patient.                          |
| 8   | How is capacity known?       | **Ward-confirmed plus a simulated feed.** Every figure carries source and age; disagreement is an exception.        |
| 9   | No bed anywhere?             | A full escalation state: what was tried, least-bad options, who to contact, and a record that it happened.          |
| 10  | Who sees what?               | **Role-scoped**, but statewide capacity is visible to everyone — that shared fact is what removes the phone-around. |

Later additions the owner asked for: **sex mix** and **specialling** as placement constraints, an
**accepted-awaiting-bed** stage, **older-adult scarcity surfaced explicitly**, **ward-flagged bed
releases** (a bed-release signal carrying nothing about the departing patient), **patient search**,
a **shift handover** board, **fixed decline reasons** rather than free text, and a **coordinator
phone view**.

### Deliberately out of scope

Everything after the patient reaches the ward: repatriation to catchment, discharge as a clinical
event, length of stay. Also child and adolescent services, forensic services, community teams, and
sub-locations inside an emergency department.

**One accepted consequence:** the system never observes a discharge, so it cannot derive bed supply
from its own data. Supply arrives instead as a ward-reported bed release.

---

## 4. Where the build is

Worktree `C:/Users/joshs/.codex/worktrees/ward-management-design/Database`, branch
`codex/ward-management-design`. **Nothing pushed. No PR.** 15 commits.

| Phase                         | Scope                                                                                           | State                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **1 — the model**             | Six modules; ten routes migrated; old fixture deleted                                           | ✅ Complete, whole-branch review clean after one fix wave            |
| **2 — coordinator screen**    | Pressure strip, queue, flow diagram, shortlist, exceptions, phone form; retired Constellation   | ✅ Complete 2026-08-19, whole-branch review clean after one fix wave |
| **3 — the other three roles** | ED screen, ward screen, transport officer phone screen, live tracker                            | Spec written 2026-08-19; plan next                                   |
| **4 — specialist boards**     | Statutory clock, escalation, shift handover, patient search, governance and capacity extensions | Not planned                                                          |

Phase boundaries and their reasoning are in §18 of the design spec.

### Routes today

`/ward-management` (coordinator) · `/network` · `/queue` · `/capacity` · `/movements` ·
`/exceptions` · `/transport` · `/governance` · `/patients/[patientId]`

`/constellation` was retired by Phase 2. The mode navigation now lives in the left rail, not in a
horizontal strip.

---

## 5. The model

Six modules, all pure or data-only, all committed and reviewed.

### `ward-clock.ts` — the only module permitted to read the wall clock

```ts
type Instant = number;                    // minutes since midnight on the synthetic day
type ClockState = "breached" | "critical" | "due" | "clear";

wallClockNow(): Instant;
minutesUntil(due: Instant, now: Instant): number;      // due - now
clockState(due: Instant, now: Instant): ClockState;    // <0 breached, <60 critical, <180 due
formatRemaining(minutes: number): string;              // countdown: "1h 33m left" / "42m overdue"
formatElapsed(minutes: number): string;                // elapsed:   "1h 35m waiting"
formatInstant(instant: Instant): string;               // "10:42"; wraps negatives correctly
```

Everything else receives `now` as a parameter. That is what keeps tests and screenshots
deterministic.

> `formatRemaining` is a **countdown** formatter and `formatElapsed` is an **elapsed** formatter.
> Passing a past timestamp to the countdown one rendered every wait in the app as "1h 35m overdue",
> in a column headed _Wait_, through 43 passing tests. Both now exist for a reason.

### `ward-model.ts` — types only, no data, no logic

```
MOVEMENT_STAGES (7): placement_requested, destination_review, accepted_awaiting_bed,
                     bed_held, handover_ready, moving, arrived
DECLINE_REASONS (6): no_bed, sex_mix, specialling_unavailable, acuity_mix,
                     capability_mismatch, bed_held_for_earlier_referral
PARALLEL_REFERRAL_CAP = 3

Site, EmergencyDepartment, Unit, Movement, CapacityFigure, Decline, StatusChange,
TransportJob, MovementClosure, BedRelease, LegalForm, LegalStatus,
HealthService, Cohort, Security, Sex
```

`Unit` carries `cohort`, `security`, `authorised`, `beds`, `empty`, `allocatable`, `held`,
`blocked`, `sexMix`, `speciallingCapacity`. `Movement` carries `originEdId`, `openedAt`,
`urgency`, `cohort`, `security`, `sex`, `specialling`, `legalStatus`, `legalForm`,
`statusChanges`, `stage`, `owner`, `referredUnitIds`, `acceptedUnitId`, `declines`, `transport`,
`blocker`, `closure`.

### `ward-eligibility.ts` — the placement gates

```ts
requiresAuthorisedDestination(status: LegalStatus | undefined): boolean;   // true unless Voluntary
eligibility(movement, unit, now): { eligible: boolean; gates: GateResult[] };
```

Eight gates, evaluated before any ranking: `authorisation`, `cohort`, `security`, `sex_mix`,
`specialling`, `prior_decline`, `capacity_freshness`, `allocatable_bed`. Each returns
`{ gate, pass, detail }` — a structured verdict, never a bare boolean.

### `ward-sites.ts` — the network

17 sites, **8 emergency departments**, **22 units**. `NOW_ANCHOR = 10 * 60 + 42` (10:42).

```
ED ids:   arm-ed, fsh-ed, jhc-ed, peel-ed, rgh-ed, rph-ed, scgh-ed, sjgm-ed

Unit ids: alb-adult-open, arm-adult-open, brm-adult-secure, bty-adult-secure,
          bty-older-adult, bun-adult-open, fre-adult-open, fre-older-adult,
          fsh-adult-secure, fsh-older-adult, ger-adult-open, gry-adult-secure,
          gry-older-adult, kun-adult-open, rgh-adult-secure, rph-adult-secure,
          rph-older-adult, scgh-adult-open, scgh-older-adult, sjgm-adult-open,
          sjgs-adult-open, sjgs-adult-secure
```

`wardSites`, `allUnits()`, `allEmergencyDepartments()`, `unitById(id)`, `siteByCode(code)`.
**The lookups return `undefined` on a miss** — see §7.

The data deliberately exercises the gates: at least one older-adult unit at zero allocatable, two
units past their staleness window, one unit whose feed and ward figures disagree by three beds,
unauthorised units, a private site, WACHS sites.

### `ward-movements.ts` — the demand

**48 movements** (18 hand-authored covering every awkward state, 30 generated deterministically
from their index) and **6 bed releases**. Built at realistic bad-night pressure across all eight
departments, not comfortable pressure — screens designed against fourteen calm records collapse on
first contact with reality.

`wardMovements`, `movementById(id)`, `movementsByStage(stage)`, `bedReleases`.

### `ward-derivations.ts` — shared pure UI derivations, no React

`WardRole`, `stageCopy`, `stageSummaries`, `movementStageSummary`, `wardServiceOrder`,
`roleLabels`, `roleTaskLabel`, `movementHealthService`, `elapsedLabel`, `isOpen`,
`destinationUnit`, `unitSiteCode`, `transportStatusLabel`, `unitCapacity`, `eligibleCandidates`,
`candidateReason`, `InboxItem`, `buildActionInbox`, `movementTimeline`.

### What does not exist

**The operational score exists again.** Phase 1 deleted `operationalPriorityScore` for folding
urgency into a number labelled "not clinical severity"; Phase 2 rebuilt it honestly in
`ward-priority.ts` as `operationalScore(movement, now)` plus `queueOrder(movements, now)`. It is
blind to `movement.urgency` and a test asserts two tiers score identically. Phase 2 also added
`ward-pressure.ts` — `edPressure(now, movements)`.

---

## 6. How a movement travels

**Opening.** The emergency department raises a referral. The movement opens at _placement
requested_, owned by that department, carrying its location, legal status and deadline, cohort,
security need, sex and any specialling requirement.

**Shortlisting.** The coordinator picks it up. The system **filters before it ranks** — the eight
gates run first, and only survivors are ranked and shown, each with its reasons and what nearly
excluded it. Stage becomes _destination review_.

**Parallel referrals are supported**, capped at three. Every unit receiving one is told it is a
parallel referral; when one accepts, the others are withdrawn automatically with a reason.
Concealing parallel referrals from wards is how trust between services breaks.

**Acceptance.** Accepting in principle gives _accepted, awaiting bed_ — this stage exists because
it is where patients actually stall. Naming a bed gives _bed held_, with an expiry running.
Declining returns the movement to _destination review_; that unit drops out of its suggestions with
the reason recorded.

**Movement.** Handover complete and transport booked gives _handover ready_. The officer marking
collected gives _moving_. Marking arrived gives _arrived_ — the record closes and the patient
leaves the system.

**Closing without arrival.** A movement may end as _closed — did not proceed_. Patients abscond,
improve and go home, are admitted medically, or go private. Without this path those records stay
open forever and the queue fills with ghosts.

**Legal status can change mid-movement** — a voluntary patient becoming detained in a department is
among the commonest events in the pathway, and it changes eligibility. **Urgency can change**, with
a record of who changed it. **An expiring hold raises an exception rather than auto-releasing the
bed** — a machine silently dropping a held bed at 3am is worse than a late human.

---

## 7. Rules that are not negotiable

**Nothing auto-allocates.** Every placement is a human confirm or override, with the reason
recorded. No timeout default, no confidence threshold.

**Authorisation gates the destination only.** Never the patient's current location.

**Urgency tier leads.** The operational score orders only _within_ a tier, contains no urgency
component, and is never described as severity, acuity or risk.

**Conservative failure — when data is missing or stale, the system says less, not more.**

- Stale capacity drops out of suggestions rather than being shown hopefully.
- Unknown legal status is treated as _requiring_ an authorised destination — the safe direction to
  be wrong in.
- Missing sex or specialling data marks a candidate "cannot confirm eligibility" rather than
  assuming it fits.

**A missing lookup renders an explicit empty state — never a substituted record.** The code this
build replaced returned a _different hospital_ when `wardHospitalByCode` missed, and a _different
patient_ when `wardPatientById` missed. Every lookup now returns `undefined` and every call site
handles absence. Any `?? array[0]`, `.find()!`, or defaulted-parameter equivalent reintroduces the
defect this whole build exists to remove.

**Display less rather than something plausible.** The governing rule. See §9 for why.

**Synthetic only.** No name, date of birth, medical record number, address, diagnosis, narrative
history or treatment. `Sex` is the single permitted patient attribute, present because bed
allocation genuinely turns on ward mix. Bed releases carry nothing about the departing patient —
including in free-text fields.

**Determinism.** No `Math.random()`. No wall-clock read outside `ward-clock.ts`.

---

## 8. Repo conventions the gates enforce

This is a Next.js 16 App Router project, React 19, TypeScript 6 strict, CSS Modules.

- **Design tokens only.** No raw hex. No raw padding, gap, z-index or line-height literals in CSS
  Modules — declare a local token in the module's root block first.
  `npm run check:design-system-contract` ratchets these counts and fails on any increase.
- **Tap targets are `3rem` (48px) minimum.** Never reduce to `2.75rem` for a generic WCAG rule —
  that reintroduces a known `ui-smoke` flake.
- **Button wiring.** Every `<button>` has an `onClick`, is a submit inside a form, or is a `<Link>`.
  A control unavailable for a stated reason uses `aria-disabled="true"` + inert handler +
  `title="… — coming soon"` + an `sr-only` note. Never both `disabled` and `aria-disabled`.
- **Internal navigation** uses `<Link>` / `router.push` / server `redirect()` — never a raw `<a>`.
- **A new route needs a literal `<Link href="...">`** in `WardModeNavigation`. Hrefs built from an
  array are invisible to `tests/route-reachability.test.ts` and the route fails as an orphan.
- **Every route must be declared** in `docs/design-system/adoption-contract.json` under the
  `ward-management` surface, then `npm run design-system:adoption:update` run.
- **A new Playwright spec must be added to BOTH** `testMatch` and `productionSpecPattern` in
  `playwright.config.ts`, or it silently runs zero tests.
- **`npm run format` and commit the result** before any push — it is in neither `lint`, `typecheck`
  nor `test`.
- **The pre-commit hook regenerates documentation and stops for review.** Stage what it regenerates
  and commit again. It is slow — allow minutes rather than killing it.

### Verification, and the two traps

| Gate          | Command                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| Typecheck     | `npx tsc --noEmit -p tsconfig.json`                                                       |
| Units         | `npx vitest run tests/<files>`                                                            |
| Lint          | `npm run lint`                                                                            |
| Design system | `npm run check:design-system-contract`                                                    |
| Dev server    | `npm run ensure` — prints the URL; **never assume a port**                                |
| Browser       | `PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test <spec> --project=chromium` |

**Trap 1 — `npm run lint` can exit 0 without running.** It prints
`DATABASE_HEAVY_RUN_ADMISSION_BUSY` when another heavyweight command holds the repository lock.
Read the output, never the exit code.

**Trap 2 — a bare `npx playwright test` is rejected** by the config guard ("Playwright requires a
runner-owned local server"), and a backgrounded wrapper still reports exit 0 while nothing ran. The
`PLAYWRIGHT_BASE_URL` form above is the working invocation.

**Do not run** `verify:ui`, `verify:release`, `eval:*`, `check:supabase-project`, or any
provider-backed gate. The owner has asked for CI restraint. Everything in this build is offline.

**Also: clicking before hydration flakes.** Wait on a client-only artefact first — the flow
diagram's connector paths (`svg path[marker-end]`) are the reliable signal.

---

## 9. What Phase 1 learned, and why it shapes Phase 2

Phase 1 ran eight tasks through full subagent-driven development: a fresh implementer per task, a
task review after each, and a whole-branch review at the end. Fifty unit tests, lint clean,
Chromium green, eight per-task reviews passed.

**The whole-branch review then found one Critical and ten Important defects.** Every one had passed
its own task review, because each review saw only one task's diff. What they were:

- **Every eligibility gate rendered with a green tick, including failures.** Two clicks produced
  **"✓ SJGS Adult Open is not authorised under the Mental Health Act"**. The console rendered the
  same verdict correctly; only the other surface did not consult `gate.pass`.
- **The five-state bed grid did not reconcile on 10 of 22 units** — `held` and `blocked` were
  counted twice. Three different reconciliation readings existed across the code and the tests.
- **"48 open movements" counted six arrived and one closed record** — the direct descendant of the
  old fixture's hardcoded 84-against-14.
- **Nine movements rendered as `-1:-14`** in the audit timeline.
- **Six bed-release blockers carried departing-patient detail** — tribunal, NDIS, family pickup,
  aged care — against the privacy rule. The guard test checked for forbidden _properties_ and never
  read the free text.

Earlier in the same phase, `elapsedLabel` fed a past timestamp to a countdown formatter and rendered
**every wait in the application as "overdue"**, at seven call sites, one of them a column headed
_Wait_. Forty-three tests were green.

**The lesson, and it is the reason for the screenshot rule:** tests catch things that are broken.
They do not catch things that are **plausible but false**. Every defect above read as true to
anyone who did not check it against the data. A human looking at the screen catches them in
seconds; a test suite does not catch them at all unless someone thought to pin the exact string.

Three practices came out of it, and they apply to every remaining phase:

1. **Verify a subagent's typecheck and test claims by running them yourself.** One implementer
   reported `tsc --noEmit` clean when it was not, and the repository stayed red for two tasks.
2. **Watch a regression test fail before accepting it.** The first fix for the elapsed bug tested
   the formatter directly and never called the function that had been wrong.
3. **Look at the screen.** Build a screenshot pass into every UI task, reviewed by the owner.

---

## 10. Decisions taken on the owner's behalf during Phase 1

Recorded so they can be found and undone. Full text with costs in
[`docs/ward-flow-phase-handoff.md`](./ward-flow-phase-handoff.md).

1. **`speciallingCapacity`, not the plan's `spellingCapacity` typo** — written correctly from the
   start rather than propagated through five files and fixed later.
2. **Movement origins draw only from the eight defined emergency departments.**
3. **The plan's "Expected: PASS (9 tests)" was its own arithmetic error** — its test block defines
   eight.
4. **The conservative-failure test kept its runtime assertion**; only the `@ts-expect-error`
   mechanism was replaced with an explicit cast.
5. **A subagent report claimed a ruling that was never made** about ED coverage — resolved as moot,
   recorded so it is not treated as precedent.
6. **The shared derivations were extracted** out of a 991-line client component that eight routes
   imported through, into `ward-derivations.ts`.
7. **The controller executed the verification task** rather than dispatching it, since it contained
   no code change.

### Findings parked at the close

- **A Playwright negative assertion is vacuous** — it asserts `svg.lucide-check-circle-2`, but
  lucide-react emits `lucide-circle-check` for `CheckCircle2`. The companion assertion uses the
  correct class and does catch the regression. **Use `lucide-circle-check` in any new assertion.**
- **Two eligibility detail-string tests do not discriminate** pre- from post-fix behaviour.
- **`handover_ready` generated movements carry no acceptance or transport** — every surface shows
  absence rather than a fabricated value, which is the governing principle.
- Smaller: `clockState` boundary values untested; the `DECLINE_REASONS` test uses `toContain`;
  `inboxAction` is string-coupled to id prefixes built elsewhere; `.score` and `.aiBadge` CSS class
  names survive from the deleted scoring concept; `wallClockNow` is exported but unused (Phase 2 is
  its intended consumer); `Candidate.rank` implies an ordering `eligibleCandidates` does not
  actually produce.

---

## 11. Phase 2 as built, and Phase 3 next

Phase 2 shipped the coordinator screen in 21 commits across ten tasks and eleven review rounds.
Its whole-branch review initially returned **not fit to hand over** on two Criticals — a shortlist
headed "Nearest candidates" when the model holds no proximity data of any kind, and a Confirm
button that acted on a system-chosen default the human never selected — and passed after one fix
wave plus one ruled follow-up. New modules: `ward-priority.ts`, `ward-pressure.ts`, and
`src/components/ward-management/coordinator/`. The statutory form codes in the fixture were
corrected to 3A / 4A / 4C to match this document and the spec.

**Phase 3 is specified**: `docs/superpowers/specs/2026-08-19-ward-flow-phase-3-role-screens-design.md`.
It adds the ED, ward and transport-officer screens plus the live tracker, and introduces the first
mutable state this build has ever had. Read that spec before doing any Phase 3 work.

## Phase 2 as originally planned

Ten tasks. Full detail in
[`docs/superpowers/plans/2026-08-18-ward-flow-phase-2-coordinator-screen.md`](./superpowers/plans/2026-08-18-ward-flow-phase-2-coordinator-screen.md).

| Task | What                               | Why it is where it is                                                    |
| ---- | ---------------------------------- | ------------------------------------------------------------------------ |
| 1    | Operational score, urgency-free    | Every region reads it; its lead test asserts two tiers score identically |
| 2    | Per-department pressure            | The first number a coordinator scans at handover                         |
| 3    | Screen shell, five regions stubbed | Judge the proportions before filling them                                |
| 4    | ED pressure strip                  | Worst department first, and it says why                                  |
| 5    | Priority queue                     | Tier first, score within tier, labelled operational                      |
| 6    | Flow diagram                       | Departments left → statewide flow → units right                          |
| 7    | Explainable shortlist              | Where the decision is made; all eight gates, failures first              |
| 8    | Exceptions drawer and phone form   | Exceptions are the work list; after-hours is a phone                     |
| 9    | Retire Constellation               | The phase's only destructive step                                        |
| 10   | Prove the phase                    | Gates, then the screenshot pass                                          |

**Recommended process calibration.** Phase 1 used full treatment on every task; that was right for
model work but would cost more than it returns on screens.

- **Full treatment** (implementer + task review + fix rounds) for Tasks 1, 2, 6 and 9.
- **Single review seat** for Tasks 4, 5, 7 and 8 — regions rendering already-proved derivations.
- **A screenshot pass on every screen task, sent to the owner.** This substitutes for the second
  review seat and is the better instrument for this class of defect.

---

## 12. The other documents

| File                                                                        | When to read it                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `docs/superpowers/specs/2026-08-18-ward-flow-metro-patient-flow-design.md`  | The binding authority. Sections 3, 4, 7, 10, 12 carry the requirements most easily violated |
| `docs/superpowers/plans/2026-08-18-ward-flow-phase-2-coordinator-screen.md` | Executing Phase 2                                                                           |
| `docs/ward-flow-phase-handoff.md`                                           | Phase 1 rulings and parked findings in full                                                 |
| `docs/ward-management-context.md`                                           | The domain glossary — ~30 terms                                                             |
| `docs/ward-management-decisions.md`                                         | Four ADRs, including the corrected authorisation rule                                       |
| `docs/ward-management-mode-map.md`                                          | The route model as currently built. Carries a superseded banner                             |
| `docs/ward-flow-phase-2-kickoff.md`                                         | The session-start brief                                                                     |
