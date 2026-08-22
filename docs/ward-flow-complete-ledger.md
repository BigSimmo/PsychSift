# Ward Flow — the complete ledger, Phases 1 to 3

The single cross-session record of everything built on branch `codex/ward-management-design`,
assembled 2026-08-21 and refreshed 2026-08-22 after the branch was pushed. Ward Flow has run across many chat sessions on
several different tools, and no single conversation holds the whole picture. This file does.

**It is a map, not a replacement.** Each phase's own ledger holds the detail; this file records
what happened, in what order, where the detail lives, and what carries forward.

---

## 1. What Ward Flow is

A synthetic, offline prototype for Western Australian metro psychiatry patient flow —
coordinating a patient from a metropolitan emergency department to an inpatient psychiatric bed.
Built for a practising psychiatrist in Perth.

The problem it models, from `docs/ward-flow-context.md`: finding an inpatient bed is a
phone-around. Bed numbers are stale before they are quoted. Mental Health Act clocks are running.
Transport waits. The patient sits in the department, frequently twelve to twenty-four hours,
sometimes far longer. **Nobody holds a single current picture** of who is waiting, which beds are
genuinely allocatable, who has already declined and why, what is legally due and when, and where
the vehicle is.

**It is a prototype, not clinical decision support.** All data is synthetic. Every surface must be
verifiable against the model behind it, and must degrade to saying nothing rather than guessing.
That last rule is the one this project has repeatedly had to enforce against itself.

## 2. Where the work lives

| What         | Where                                                             |
| ------------ | ----------------------------------------------------------------- |
| Worktree     | `C:\Users\joshs\.codex\worktrees\ward-management-design\Database` |
| Branch       | `codex/ward-management-design`                                    |
| Commits      | 72 ahead of `origin/main`, **pushed** to `origin` 2026-08-22      |
| **Not** here | `D:\Repos\Database` contains none of this work                    |

## 3. The three phases

| Phase | What it delivered                                                                           | Dates           | Status                    |
| ----- | ------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| 1     | The domain model: clock, types, eligibility gates, sites, movements; routes migrated        | 2026-08-18      | complete                  |
| 2     | The coordinator screen: pressure strip, priority queue, flow diagram, shortlist, exceptions | 2026-08-18/19   | complete                  |
| 3     | Role screens: shared state, and the ward, ED and transport-officer views                    | 2026-08-19 to — | **Tasks 1–6A of 12 done** |

### Phase 1 — the model (2026-08-18)

Spec `docs/superpowers/specs/2026-08-18-ward-flow-metro-patient-flow-design.md`, plan
`docs/superpowers/plans/2026-08-18-ward-flow-phase-1-model.md`. Handoff:
`docs/ward-flow-phase-handoff.md`.

Built the injectable clock, the domain types, the eligibility gates with destination-only
authorisation, the site/unit/ED model, and a movement fixture at realistic metro pressure, then
migrated every existing route onto it. Closed with a whole-branch review pass
(`787029ae0`) and a recorded set of parked rulings (`de7b92faf`).

Key commits: `99cf00840`, `f04786309`, `b2f7cf39c`, `3cf1e89e8`, `20bdbc8f2`, `1425b38c6`,
`b2388cd64`, `f060ae763`, `cba50d8b3`, `6adab9a40`, `787029ae0`, `de7b92faf`.

### Phase 2 — the coordinator screen (2026-08-18/19)

Plan `docs/superpowers/plans/2026-08-18-ward-flow-phase-2-coordinator-screen.md`, kickoff
`docs/ward-flow-phase-2-kickoff.md`.

Built the operational score (deliberately blind to clinical urgency, which orders the queue on its
own), per-department pressure, the coordinator shell, the pressure strip, the priority queue
(tier first, score within tier), the flow diagram, the explainable shortlist with verdict-stating
gates, and the exceptions drawer. Retired the Constellation view and moved mode navigation into
the rail.

Key commits: `3dbdd5e9d`, `f2b98d814`, `ef4e62c3f`, `992c3e6c7`, `ec2e59495`, `d7f5b76e2`,
`7b97608af`, `90ed4afd7`, `b8bd43dae`, `2eed0099f`, `19e9e323c`, `04cf7bc53`, `52b001af7`,
`3789eea62`.

**Phase 2's defining lesson, which set how Phase 3 has been run: its worst defects all passed
their own tests.** Several tests were unfalsifiable — `992c3e6c7` closed three of them. That is
why every test in Phase 3 is mutation-tested and every subagent claim is independently re-run.

### Phase 3 — the role screens (2026-08-19 onward, in progress)

Spec `docs/superpowers/specs/2026-08-19-ward-flow-phase-3-role-screens-design.md` (the binding
authority, 19 sections), plan
`docs/superpowers/plans/2026-08-19-ward-flow-phase-3-role-screens.md` (12 tasks).

**Detail lives in `docs/ward-flow-phase-3-ledger.md`; state and resume steps in
`docs/ward-flow-phase-3-handover.md`; every brief, report and review in
`docs/ward-flow-phase-3-workspace/`.**

| Task | Subject                                                            | State                             |
| ---- | ------------------------------------------------------------------ | --------------------------------- |
| 1    | model and fixture                                                  | complete                          |
| 2    | the reducer                                                        | complete                          |
| 3    | the contracts                                                      | complete                          |
| 4    | provider, clock, layout                                            | complete                          |
| 5    | coordinator rewire                                                 | complete                          |
| 6    | the other nine routes                                              | complete, 5 fix rounds            |
| 6A   | the ED clock counts up                                             | complete, 2 fix rounds            |
| 7    | coordinator phone pin                                              | **next — brief + addendum ready** |
| 8–12 | ward screen, officer phone, live tracker, ED screen, role switcher | not started                       |

Task 6A is not in the original plan. It was inserted mid-phase when the clinician answered the
phase's standing open question — see §5.

## 4. Sessions, and what each one was

| Session            | Covered                                                                  | Ended by                                          |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------- |
| Phase 1 sessions   | model, gates, migration, whole-branch review                             | phase completion                                  |
| Phase 2 sessions   | coordinator screen through whole-branch review                           | phase completion                                  |
| Phase 3, session 1 | plan pre-flight, Tasks 1–5, Task 6 through fix round 2                   | a monthly spend limit killed the Task 6 fix agent |
| Phase 3, session 2 | Task 6 fix rounds 3–5, Task 6A and its two fix rounds, audit and handoff | deliberate stop at the Task 6A boundary           |

Two agents were killed mid-work by hard usage ceilings across those sessions, and both left
recoverable state. That is why the handover instructs a resuming session to **inspect the working
tree before re-dispatching** — the work may be complete and merely uncommitted.

## 5. The decisions that shaped the product

Not process rulings — the ones that changed what the software says to a clinician.

**The post-examination clock counts up.** The phase carried a standing open question about what
the on-screen countdown after examination should represent. The clinician answered verbatim:
_"It is just counting how long they have been in ED determining priority. So counting up."_

The prototype had been rendering a Form 3B deadline derived from `examination.at + 240`, displayed
by seven surfaces as statutory timing and counted as a legal breach. **No such deadline exists in
the Mental Health Act.** Task 6A deleted it: `LegalForm.dueAt` is now optional, a Form 3B carries
none, absence is rendered explicitly, and an absent deadline reaching arithmetic is a compile
error.

**The four hours were real, but attached to the wrong quantity.** Spec §7 requires the
**emergency department access target** — a departmental performance measure counted up from
`openedAt`, "the number a department is judged on, and mental health patients are its largest
breachers". It survives as `ED_ACCESS_TARGET_MINUTES`, quarantined from `LegalForm`. Deleting the
fabricated deadline without noticing this would have removed a feature Task 11 requires.

**Two clocks, not one.** The spec's own rule, which the clinician's answer confirmed: the ED clock
runs from `openedAt`; the legal clock runs from `formedAt` where they differ. A patient formed in
the community at 08:00 who reaches Peel at 11:00 has already spent three hours of the examination
window.

**The screen must never claim an action it did not perform.** Phase 3's most consequential defect:
the coordinator reported a successful referral while the reducer had refused it, on nine of
eighteen movements. Fixed at three layers — the control stops advertising what it cannot do, the
confirmation is derived from the movement's own state so it is structurally incapable of lying,
and refusals surface with the reducer's own reason.

**Urgency is the clinician's judgement and is not folded into the operational score.** A number
labelled "not clinical severity" that partly was is why the previous score was deleted rather than
migrated.

## 6. Three questions still open with the clinician

None blocking; all stated rather than buried.

1. **Does the Form 1A countdown stay a countdown?** His answer was scoped to the post-examination
   case; the pre-examination examination window is still modelled as a deadline.
2. **Should being detained and examined confer priority of its own?** Today such a patient ranks
   purely on elapsed time, exactly as described — so patients still awaiting examination tend to
   rank above them.
3. **Is four hours the right ED access target for WA metro?** It is the national figure, not
   confirmed for this context.

Plus one raised but undecided: **the demo now leads with an accident.** The top of the coordinator
queue is `WF-303`, a _generated_ movement whose breach comes from
`NOW_ANCHOR + (((index * 53) % 400) - 60)` — arithmetic, not authorship. Task 12's guided journey
may walk a user straight into it.

## 6b. The push, and an emptied `node_modules` whose cause is unproven

Recorded because it cost an hour, and because the honest version is more useful than the tidy one.

The branch was pushed to `origin` on 2026-08-22 at the user's request, superseding the earlier
"no push" instruction. The push succeeded. Around the same moment the local `node_modules` went to
**zero entries**, and recovery needed a full `npm ci --include=dev`.

The symptom is the part worth remembering. It was not an error about missing dependencies. It was
`tsc` reporting it could not find `process`, and 8 of 10 test files failing at once — which reads
exactly like a code regression. **`ls node_modules | wc -l` is the first check when a broad,
unexplained failure appears.**

**The cause was not established, and an earlier draft of this file asserted that it was.** The
obvious suspect is this repo's known guard-push defect — the pre-push format guard links a real
dependency tree into a scratch checkout as a Windows junction, then force-deletes the checkout —
fixed on `main` at `a04330ea0` (PR #2244), which is not an ancestor of this branch. But both
force-deletes were probed directly on this machine and **neither destroyed the junction's target**:
Node's recursive `rmSync` did not follow the junction, and neither did `git worktree remove
--force`. A live alternative is that `findPrettierBin` borrows _another_ worktree's tree when this
one has none, and this repo has dozens of sibling worktrees.

A hand-written fix was drafted onto this branch and then **reverted**. The mutation test settled
it: reintroducing the supposed bug on purpose failed no test at all, which proves the fix was
untestable against an unknown mechanism. Shipping it would have been a guard that claims more than
it delivers — the exact defect class §7 is about, committed while documenting §7. The correct route
is bringing `main` into this branch, which carries the reviewed upstream fix; that is a real piece
of work with conflict risk and is the user's call.

## 7. The recurring failure, across all three phases

One defect class has appeared in every phase, in a different disguise each time:

- **Phase 1** shipped a privacy guard that checked properties and never read strings.
- **Phase 2** shipped three unfalsifiable tests; its worst defects all passed their own tests.
- **Phase 3, Task 1** shipped a privacy guard whose loops executed zero times.
- **Phase 3, Task 3** shipped two vacuous invariants asserting against fixture state, not walk state.
- **Phase 3, Task 5** shipped a Playwright test asserting `/refus/i` against empty-state copy that
  contained the word.
- **Phase 3, Task 6** spent three of five fix rounds on one static guard that overclaimed in three
  successive forms — co-occurrence scoping, directory scoping, and a hand-rolled scanner blinded by
  a quote inside a regex literal.
- **Phase 3, Task 6A** found the same shape a fourth time in a new guard, and answered it
  differently: **narrow the claim rather than chase completeness**, and move real enforcement into
  the brief and review of the task that will exercise it.

**The lesson, and it is this project's most important finding: a check that claims more than it
delivers is worse than no check, because it stops anyone looking harder.** Every one of those was
found by someone deliberately trying to defeat the check — never by running it.

The practice that follows: mutation-test every test, print the edited line back from the file
before trusting the run, re-run every subagent's gates independently, and read counts rather than
the word "passed".

## 8. Where everything is

| Need                                    | File                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Project orientation, Phases 1–3         | `docs/ward-flow-context.md`                                                  |
| **Phase 3 state and how to resume**     | `docs/ward-flow-phase-3-handover.md`                                         |
| Phase 3 execution record, every ruling  | `docs/ward-flow-phase-3-ledger.md`                                           |
| Phase 3 briefs, reports, reviews        | `docs/ward-flow-phase-3-workspace/`                                          |
| Phase 3 binding authority               | `docs/superpowers/specs/2026-08-19-ward-flow-phase-3-role-screens-design.md` |
| Phase 3 plan, 12 tasks                  | `docs/superpowers/plans/2026-08-19-ward-flow-phase-3-role-screens.md`        |
| Phase 1 handoff                         | `docs/ward-flow-phase-handoff.md`                                            |
| Phase 2 kickoff                         | `docs/ward-flow-phase-2-kickoff.md`                                          |
| Design decisions across ward management | `docs/ward-management-decisions.md`                                          |
| Route and mode map                      | `docs/ward-management-mode-map.md`                                           |

The live superpowers workspace is `.superpowers/sdd/2026-08-19-ward-flow-phase-3-role-screens/`
and is **gitignored** — a continuing session appends there, and refreshes
`docs/ward-flow-phase-3-workspace/` at each handover.
