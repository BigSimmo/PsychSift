# Task 6A — the post-examination clock counts up, and no deadline is claimed

Inserted between Task 6 and Task 7 by controller rulings F15–F17, in response to the clinician
answering the phase's standing open question. This task is not in the original plan; this brief
is its requirements.

## The clinical answer that drives this

The question put to the clinician was: when a patient has been examined in the emergency
department and ordered to an inpatient bed, what should the on-screen countdown represent and
over what period?

His answer, verbatim:

> "It is just counting how long they have been in ED determining priority. So counting up."

There is therefore **no post-examination deadline**. `EXAMINATION_TO_BED_WINDOW_MINUTES = 240`
is not merely the wrong number — the quantity it represents does not exist. Every surface that
renders a Form 3B breach is asserting a statutory deadline the Mental Health Act does not
impose, which is the single defect class this project exists to prevent.

## What the spec already says, and what it means for you

`docs/superpowers/specs/2026-08-19-ward-flow-phase-3-role-screens-design.md` line 62 is binding
here and already draws exactly the distinction the clinician drew:

> **The legal clock and the ED clock are different clocks.** A patient formed in the community
> at 08:00 who reaches Peel at 11:00 has already spent three hours of the examination window.
> `openedAt` stays as "when this department raised the placement request"; `formedAt` is when
> the referral for examination was made. Where they differ the legal clock runs from `formedAt`.

So the ED clock is `openedAt` and counts **up**; the legal clock is the Form 1A examination
window and counts **down**. The clinician's answer confirms the spec's model and invalidates
only the post-examination deadline that was invented on top of it.

**Read that spec section yourself before you start.** Conflicts between this brief and the spec
resolve against the spec; tell me if you find one.

## The four hours are real, but they were attached to the wrong thing

Controller ruling F23, found in a pre-flight scan of the remaining tasks. Read this before you
delete anything, or you will remove a feature the spec requires.

The spec's §7 (emergency department) states:

> Time against the four-hour access target is shown, because that is the number a department is
> judged on and mental health patients are its largest breachers.

So four hours is a real figure — the **emergency department access target**, a departmental
performance measure counted **up from `openedAt`** (how long the patient has been in the
department). The spec lists it separately from the Mental Health Act clocks, because it is a
different kind of thing.

What the code did instead was bolt those 240 minutes onto `legalForm.dueAt` for a Form 3B,
anchored to `examination.at`, and render it through surfaces that label it "Statutory timing" and
count it as a legal breach. The number was not wrong. Its meaning, its anchor and its rendering
all were.

So this task does two things, and you must keep them strictly apart:

1. **Delete** the post-examination legal deadline — the constant, the reducer derivation, the three
   fixture `dueAt` values, and every surface that claims a Form 3B breach.
2. **Introduce** a separate, clearly named ED access-target constant of 240 minutes, measured from
   `openedAt`, for Task 11's emergency department screen to use later. Give it a doc comment saying
   plainly that it is a departmental access/performance target and **not** a Mental Health Act
   deadline, and that it must never be attached to a `LegalForm`. Nothing in this task renders it —
   Task 11 does — but it must exist and be pinned by a test so Task 11 cannot reinvent it as a
   legal clock.

If you find yourself giving the new constant a `dueAt`, a `LegalForm`, or anything the breach
counters read, stop: that is the defect being removed.

## What is already correct — do not rebuild it

- `elapsedLabel(movement, now)` in `ward-derivations.ts:87` already counts up from `openedAt`.
- `operationalScore` in `ward-priority.ts` already awards a "Time waiting" factor from
  `now - openedAt`, capped at 40 points at one point per 15 minutes.

That pair **is** the clinician's rule, already implemented. Do not invent a new scoring curve,
do not add a new elapsed-time helper, and do not reweight the existing factors. The defect is
the fabricated deadline layered on top, not a missing count-up.

## Required changes

### 1. The model

`src/components/ward-management/ward-model.ts`

- Make `LegalForm.dueAt` **optional** (`dueAt?: Instant`). A Form 3B honestly carries no
  deadline; a Form 1A still carries its examination window.
- **Delete `EXAMINATION_TO_BED_WINDOW_MINUTES` and its doc comment entirely** (line ~50). Do not
  retune it, do not leave it exported and unused. If a real post-examination timeframe is ever
  supplied it returns as a new optional field with its own derivation; leaving a dead constant
  behind invites someone to wire it back up.
- **In its place, add a correctly-named ED access-target constant of 240 minutes** — see
  "The four hours are real, but they were attached to the wrong thing" below. Do not reuse the old
  name, and do not let the new constant touch `LegalForm` in any way.
- Update the `LegalForm` doc comment to state the two-clock rule in the spec's own terms, so the
  next reader learns why `dueAt` is optional rather than guessing it was an oversight.

### 2. The reducer

`src/components/ward-management/ward-flow-reducer.ts`, `RECORD_EXAMINATION`, the
`inpatient_order` branch (line ~167-180).

The 1A → 3B transition stays — the statutory form does follow the examination. Only the
invented `dueAt` goes. Keep and update the existing comment above it.

### 3. The fixture

`src/components/ward-management/ward-movements.ts`

Three hand-authored records carry a derived 3B `dueAt` (lines ~65, ~228, ~454 — WF-003, WF-009,
WF-017). Remove the `dueAt` from each and remove the now-unused import of the deleted constant.
**Change nothing else about those records** — their `examination.at` offsets (-60, -100, -260)
stay exactly as they are, because Task 4/Task 1 ruling F5 tuned them for queue ordering and one
of them is load-bearing for a browser assertion (see item 6).

### 4. The seven surfaces that read `legalForm.dueAt`

Each must handle absence **explicitly**. Never substitute a fallback number, never render an
empty string where a deadline used to be, and never let `undefined` reach arithmetic (that is
how `NaN min ago` ships).

| File                              | Site                                                |
| --------------------------------- | --------------------------------------------------- |
| `coordinator/priority-queue.tsx`  | ~85 breach flag, ~112 "Legal deadline breached"     |
| `coordinator/shortlist-panel.tsx` | ~69 `legalFormLine`, ~162 `legalBreached`           |
| `ward-derivations.ts`             | ~298-308 `buildActionInbox` "Legal timing breached" |
| `ward-pressure.ts`                | ~41 breach counting                                 |
| `ward-management-console.tsx`     | ~262 and ~290 "due <time>"                          |
| `ward-priority.ts`                | ~42-55 the "Statutory timing" factor                |

Rules for these:

- **A form with no `dueAt` is never "breached", never "critical", never "due".** It contributes
  nothing to any breach count, exception list, or pressure figure. A count that silently
  includes a form with no deadline is a count that lies.
- **`legalFormLine` in `shortlist-panel.tsx` is the one that must gain the count-up.** For a form
  with no `dueAt`, state the form and the elapsed ED time — the form is real and the elapsed
  time is real; the deadline is not. Use the existing `elapsedLabel`; do not write a new
  formatter. Word it so it names what it measures. Per the spec, `openedAt` is when the
  department raised the placement request, so a label reading "in ED" is defensible in this
  model — but if the wording you choose could be read as a statutory countdown, choose different
  wording and say why in your report.
- **`operationalScore` awards no "Statutory timing" points to a form with no `dueAt`.** Such a
  patient's priority rides on the existing "Time waiting" factor, which is precisely what the
  clinician described. Do not add a compensating bonus for being detained — that would be an
  unsupported clinical claim of exactly the kind this task removes.

### 5. Tests to update, and the one that must not be relaxed

- `tests/ward-model.test.ts:43` asserts the constant is 240 — delete that assertion with the
  constant.
- `tests/ward-flow-reducer.test.ts:296` asserts the derived `dueAt` — replace it with an
  assertion that a recorded inpatient order produces a 3B form carrying **no** `dueAt`, so the
  absence is pinned rather than merely no longer contradicted.
- `tests/ward-model-phase3.test.ts:98-104` pins the fixture derivation — replace it with a guard
  that **no** Form 3B anywhere in the fixture carries a `dueAt`, and that every Form 1A still
  does. Make it accumulate what it inspected and assert a non-zero count of each, so it cannot
  pass vacuously on an empty loop. That vacuous-guard shape has already cost this phase two fix
  rounds.
- Add a test that a form with no `dueAt` contributes zero to the breach count and zero
  "Statutory timing" points.

### 6. The browser assertion that must be re-satisfied honestly

`tests/ui-ward-coordinator.spec.ts:269` expects the coordinator queue's top row to show
"passed its deadline". Controller ruling F5 satisfied that by engineering WF-017's **3B** breach
to the top of the queue — which is precisely the fabricated breach this task deletes.

**Do not relax, skip, or reword that assertion to keep it green.** It is the check that a real
statutory breach reaches the surface, and Form 1A breaches are now the only kind the prototype
claims. Two hand-authored movements already carry genuinely breached 1A deadlines
(`ward-movements.ts:22`, `dueAt: NOW_ANCHOR - 15`; and line 114, `dueAt: NOW_ANCHOR - 40`), so a
true breach is available without inventing one.

If the queue's ordering no longer puts a genuinely breached 1A record at the top, report that as
a finding with the ordering you actually observed — do not tune the fixture to force it. The
ordering rule ("breached deadlines, then longest wait", `pressure-strip.tsx:40`) changing shape
when 3B records stop being breachable is an expected and honest consequence of this task, and I
will rule on it.

## Verification you must run and quote

Read gate output, never exit codes. Quote the decisive "N passed" line for every gate.

1. `npx tsc --noEmit -p tsconfig.json` — if errors appear inside `.next/dev/types/`, delete
   `.next/dev/types/validator.ts` and re-run; that is a corrupted Next artefact, not source.
2. Node-environment suites, own invocation:
   `npx vitest run tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-flow-single-source.test.ts tests/ward-clock.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts tests/ward-derivations.test.ts tests/ward-management.test.ts`
3. jsdom suites, **separate** invocation — mixing environments makes workers time out here:
   `npx vitest run tests/ward-flow-clock-consistency.dom.test.tsx tests/ward-flow-provider.dom.test.tsx`
4. The ward browser gate. `npm run ensure` first, use the URL it prints, never assume a port:
   `PLAYWRIGHT_BASE_URL=<url> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line`
   A bare `npx playwright test` without `PLAYWRIGHT_BASE_URL` is rejected by a config guard while
   still looking like it ran.

**Mutation-test every test you write or change.** Make the single edit that should kill it,
PRINT THE EDITED LINE BACK FROM THE FILE, run, watch it fail, revert, confirm green. Mutations
have silently failed to apply repeatedly in this phase and each near-miss nearly became a
recorded false negative. A mutation you did not read back did not happen.

**Look at the screen.** After the gates pass, open the coordinator screen in the browser and
confirm with your own eyes that no patient anywhere claims a Form 3B deadline, and that an
examined patient awaiting a bed shows an ascending elapsed time. Capture screenshots and name
their paths in your report.

Format changed files with `npx prettier --write <files>` — `npm run format` can hang on lock
contention. Commit on the current branch. No branch, no push, no PR.
