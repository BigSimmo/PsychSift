# Care Plan — SDD ledger

**Plan:** `docs/superpowers/plans/2026-08-20-care-plan-implementation.md`
**Spec (binding):** `docs/superpowers/specs/2026-08-20-care-plan-design.md`
**Glossary (binding):** `docs/care-plan-context.md`
**Branch:** `claude/ed-care-plans-impl-7f44cd`
**Worktree:** `D:\Worktrees\Database\care-plan-impl` (relocated again 22 Aug 2026 — see Environment hazard)
**Tasks:** 11. Stage A = 1–5 then a mandatory user checkpoint; Stage B = 6–11.

> **Why this file is tracked rather than git-ignored scratch.** The
> `superpowers:subagent-driven-development` skill puts its ledger at
> `.superpowers/sdd/<plan>/progress.md`, git-ignored. That directory was destroyed
> along with the whole worktree on 21 August 2026, taking every ruling, brief,
> report and review package with it. The commits survived because they live in
> the object store. This ledger is therefore committed: the recovery map must not
> live somewhere a cleanup can delete. Reconstructed from the controlling
> session's context and the commit history, both of which agree.

---

## Environment hazard — read before doing anything

`D:\Repos\Database\.claude\worktrees\**` destroyed this task's worktree **three
times on 21 August 2026**, the third time through an explicit `git worktree lock`
and while a task was running. Deletion order observed on the third occasion: the
`.git` pointer file first (making git resolve to the main checkout on the wrong
branch), then a mass delete of 1,420 → 2,388 → 3,836 tracked files over three
minutes.

- **Nothing committed was ever lost.** Git objects live in `D:\Repos\Database\.git\objects`,
  outside any worktree. Every recovery was `git worktree add <path> <branch>`.
- **What was lost each time was uncommitted work and git-ignored scratch** —
  including, on the third occasion, the entire SDD workspace.
- **Relocation did NOT protect it — there was a fourth destruction.** The work was
  moved to `D:\Worktrees\Database\care-plan`, and that copy was destroyed within the
  hour by the same method. **No directory on this machine is safe.** Commit and push;
  nothing else has ever protected this work. The branch is now on GitHub at
  `origin/claude/ed-care-plans-impl-7f44cd`, which is the authoritative copy.
- **Commit at the end of every task, without exception.** That rule is what made
  all three recoveries cheap.

**Cause — identified, and already fixed on `main`.** The worktree was running an
old `scripts/guard-push.mjs`. That version linked a _borrowed_ worktree's real
`node_modules` into a scratch checkout as a Windows junction, then force-deleted the
scratch checkout recursively — which a `git worktree lock` cannot stop, because it is a
filesystem delete rather than a git worktree operation. Any concurrent session pushing
from a stale base ran it against whichever worktree it had borrowed from.

This is **already fixed upstream** by two commits this branch does not yet contain:

- `a04330ea0` — harden(guard-push): never force-delete a scratch checkout that still
  holds a borrowed `node_modules` link (#2244)
- `cdfcbaccd` — fix(worktrees): stop silent worktree wipes and misdirected commands (#2240)

**This branch was 124 commits behind `origin/main` and had neither.** That was the whole
explanation: the tooling in this worktree, and in the other stale worktrees running
alongside it, predated its own fix. `scripts/clean-worktree.mjs` was investigated and
cleared — it contains no filesystem deletion at all.

### Resolved 22 August 2026 — the merge landed

`origin/main` was merged into this branch as `3febc69a4`, with **zero conflicts** —
including in `docs/care-plan/**` and `docs/superpowers/**`, which were expected to
conflict and did not. `git merge-base --is-ancestor` confirms both `a04330ea0` and
`cdfcbaccd` are now ancestors of HEAD, so this worktree runs the hardened
`guard-push.mjs` and the fixed worktree tooling. It was a merge, not a rebase, because
the branch is published.

Pushed as `f01b8583c..d421bc2dc` (exit 0). Two things about that push are worth knowing.
The **ledger-write guard blocked it as a false positive**: merging `main` necessarily
carries `main`'s own inbox reconciliation onto this branch, and the guard reads that as
this branch introducing ledger rows. `git diff --name-status origin/main...HEAD` over
`docs/outstanding-issues*`, `docs/branch-review-ledger.md` and `docs/reviews` is **empty**,
so the push used the guard's own documented scope, `SKIP_LEDGER_WRITE_GUARD=1`, and nothing
else was skipped. And the **static guard did not run**: it was refused with
`DATABASE_HEAVY_RUN_ADMISSION_BUSY` because another worktree held the heavy lease, so
`lint` and `typecheck` were not run _by the guard_. Typecheck was run separately in this
worktree (exit 0, zero diagnostics); **`lint` has not been run since the merge** and must
not be reported as green until it is.

**Left on disk, and a live hazard.** The first push attempt was killed at a 10-minute
timeout and left a scratch checkout at
`C:\Users\joshs\AppData\Local\Temp\guard-push-format-6YSFcp` whose `node_modules` is a link
into this worktree's real `node_modules` — the precise arrangement behind all four
destructions. The hardened guard refuses to force-delete it, which is why nothing was
harmed; an old guard in another stale worktree would not. Remove the **link only**
(`rmdir` on the junction, never a recursive delete of the folder), then
`git worktree prune`. Not done here: the sandbox declined the command, correctly.

The work now lives at `D:\Worktrees\Database\care-plan-impl`. The previous copy at
`D:\Worktrees\Database\care-plan` was left untouched on disk and simply detached from
the branch (`git switch --detach`) so the branch could be checked out in the new
worktree; nothing was deleted to make room. Its `node_modules` had been emptied, which
is the only damage it carried — its tracked tree was clean and byte-identical to
`origin`.

---

## Progress

| Task                               | State                      | Commits                | Evidence                                                                                                        |
| ---------------------------------- | -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. Domain, fixtures, selectors     | **complete, review clean** | `8a2e6a6d1..8652e73ff` | 58/58 passing, typecheck clean                                                                                  |
| 2. Reducer, provider, lifecycle    | **complete, review clean** | `8652e73ff..def541e6a` | 121/121 passing, typecheck + lint clean, 32 mutations / 32 red suites                                           |
| 3. Routes, gate, shell             | **complete, review clean** | `d421bc2dc..bb68ea8da` | 209/209 passing, typecheck + lint clean, 39 mutations / 39 red suites                                           |
| 4. Snapshot, search, contacts      | **complete, review clean** | `f2f6389fa..d66e7a38b` | 232/232 passing, typecheck + lint clean, 62 mutations / 62 red suites                                           |
| 5. Plan reading, boundary, print   | **complete, review clean** | `9bab6ad44..90c1d01a3` | 291/291 passing + Therapy Compass 25/25, typecheck + lint clean, 61 mutations / 61 red                          |
| 6. Authoring, approval, withdrawal | **complete, review clean** | `f0ab0d41b..2113fe97f` | 306/306 passing + form-field consumers 161/161, typecheck + lint clean, 28 mutations / 27 killed + 1 equivalent |
| 7. ED presentations, amendments    | **complete, review clean** | `e02a03ab9..a8a8264be` | 335/335 passing, typecheck + lint clean, 40 mutations / 40 killed                                               |
| 8. Personal Safety Plan, print     | **complete, review clean** | `5e8f812a7..79cfa97b3` | 369/369 passing, typecheck + lint clean, 58 mutations / 58 killed                                               |
| 9–11                               | not started                | —                      | —                                                                                                               |

Stage A is Tasks 1–5. The plan makes Task 5 a mandatory stop for user review; **the user
lifted that stop on 22 August 2026**, instructing the session to report at the boundary and
continue into Stage B without waiting. Recorded here because the plan's own text still says
otherwise.

### Stage A checkpoint — run 22 August 2026

| Check                     | Result                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Stage A test set     | `Test Files 6 passed (6)` / `Tests 291 passed (291)` — after one lease refusal, retried until acquired                                                                                             |
| `npm run typecheck`       | exit 0, zero diagnostics                                                                                                                                                                           |
| Local server identity     | `/api/local-project-id` returns `clinical-kb:4573c0c0381a` — this project, on the printed port                                                                                                     |
| All 21 routes over HTTP   | every one 200                                                                                                                                                                                      |
| Unknown patient parameter | reaches `notFound()` (`NEXT_HTTP_ERROR_FALLBACK;404` in the payload) and leaks **zero** occurrences of another patient's name or MRN                                                               |
| Server-rendered DOM       | correct: rail, both synthetic markers, search, three patients rendering three genuinely distinct plan states (`Current version 2`, `No plan in use`, `Withdrawn`), identity band, patient sections |
| **Browser visual proof**  | **NOT OBTAINED — see below**                                                                                                                                                                       |

**The browser walk could not be performed, and nothing about rendering should be inferred
from the attempt.** The browser pane in this session does not composite frames, so every
screenshot timed out and the accessibility tree came back empty even on the production app
at `/`. The DOM was readable, which is where the server-rendered evidence above comes from,
but no pixel was ever painted, nothing was clicked, and no viewport was resized. Phone
layout at 320 px and 390 px, dark mode, forced colours, reduced motion, focus rings and
print preview all remain **unverified**, exactly as the plan always intended for Task 11.

One observation from that attempt needs recording so a later session does not re-diagnose
it as a Care Plan defect: the DOM showed two `<main>` landmarks, the Suspense fallback
visible at full height and the real content inside a `display:none` container with no React
fiber attached — i.e. never hydrated. **The pre-existing, shipped Caring Contacts prototype
reproduced this identically**, and so did the main application at `/`. It is therefore a
property of this non-compositing browser session, not of Care Plan, and not a regression
introduced by Tasks 3–5. It is also not evidence that the prototype hydrates correctly —
that question is simply still open, and Task 11's Chromium journeys are what will answer it.

### Task 1 — complete

- Dispatched opus. Returned `DONE_WITH_CONCERNS`; three pre-review fix rounds, then
  task review (opus) returned Spec ❌ / Changes needed, then two review fix rounds.
- Final: 58/58 passing, typecheck clean.
- Worktree destroyed twice during this task; implementer recovered it once itself.
  `task-1-brief.md` was destroyed and restored from transcript; the controller
  regenerated it with `scripts/task-brief` and diffed — the restoration matched exactly.

### Task 2 — complete

- Dispatched opus. Returned `DONE_WITH_CONCERNS`; one pre-review fix round, then
  task review (opus) returned Spec ❌ / Changes needed, then one review fix round.
- Final: 121/121 passing across both test files, typecheck exit 0, lint exit 0.
- Implementer proved every refusal guard with deliberate mutations: 32 mutations,
  32 red suites, including both-directions proof for the participation trigger and
  three-way proof (too wide / too narrow / wrong guard) for the print exemption.

### Task 3 — complete

The third worktree destruction had blocked it; no partial work existed and there was
nothing to reconcile, so it restarted from the brief unchanged on 22 August 2026 with
BASE `d421bc2dc`.

- Dispatched opus. Returned `DONE_WITH_CONCERNS` at `9d3a104da` (39 files, 202 tests).
  Task review (opus) returned Spec ❌ / Needs fixes with four Important findings and no
  Critical. One fix round (`bb68ea8da`), then a scoped re-review (sonnet) verdicted all
  four ADDRESSED with no new breakage.
- Final: `Test Files 7 passed (7)` / `Tests 209 passed (209)`; typecheck and lint both
  re-run with `GATE_RECEIPTS=refresh`, so neither is a reused receipt. Byte scan of 10
  touched files: zero CR or control-byte offenders.
- Guards proved by mutation: 31 in the first pass, 8 more across the fix round, every one
  red then reverted.
- The three findings that were real were all guard or safety defects rather than
  structure: printing any route stripped the only `fictional data only` marker off the
  page, route-change focus was keyed on the heading text so moving between two patients
  with the same heading announced nothing, and half the developer-index guard was
  satisfied by pre-existing text in the file it read — this project's third
  guard-that-cannot-fail. The structural spec, all 21 routes, was clean first time.
- Commits `d421bc2dc..bb68ea8da`, review clean, pushed.

**Not proven by Task 3, and must not be claimed:** no browser or Playwright journey, no
responsive/accessibility/print observation at real viewports, no production build, so the
`notFound()` path's production 404 status is unverified (dev returns HTTP 200 with the
`NEXT_HTTP_ERROR_FALLBACK;404` digest). Print correctness is asserted structurally — the
marker has no `data-print-hide` ancestor — not visually.

### Task 4 — complete

- Dispatched opus. Returned `DONE_WITH_CONCERNS` at `0c9b32c64` (10 files, 219 tests). Task
  review (opus) returned Spec ❌ / Needs fixes: three Important, no Critical, thirteen Minor.
  Fix round 1 (`773da7bf3`) closed all three Importants plus three Minors and the scoped
  re-review verdicted all seven ADDRESSED — but surfaced one new Important **in the fix
  diff itself**, so it joined the open list rather than deferring. Fix round 2
  (`d66e7a38b`) closed it and its re-review found no new breakage.
- Final: `Test Files 4 passed (4)` / `Tests 232 passed (232)`; typecheck and lint both
  freshly recorded, not reused receipts. One typecheck attempt was refused with
  `DATABASE_HEAVY_RUN_ADMISSION_BUSY` and retried rather than reported — correct handling.
- Guards proved by mutation across the task: 62, every one red then reverted.
- Commits `f2f6389fa..d66e7a38b`, review clean, pushed.

**Three interruptions, no loss.** The implementer was killed mid-round three times by
transient `529 Overloaded` API errors. Each time the worktree was clean at the last commit,
and resuming the same agent restored its context intact. This is the third distinct way this
task has been interrupted — worktree destruction, run-coordinator refusal, and now provider
capacity — and the same habit covered all three: commit at the end of every unit, push, and
never rush a half-built commit to protect work.

**The finding that needed two rounds is worth understanding.** Selecting a patient moved no
focus, so fix round 1 added a focus move. That fix could then fire on a genuine route change
— and was invisible, because the shell is an ancestor whose pathname-keyed effect commits
last and silently repairs whatever a descendant did to focus. No final-state assertion in
this component can fail. Only a `focusin` event-order test can see it, and the implementer
discovered this the hard way when two of its own positive controls survived. Fix round 2
keyed the effect on the previous **variant** rather than a boolean that collapsed two of the
three variants together; the re-reviewer verified the two effects are now mutually exclusive
by construction rather than by test.

### Task 5 — complete. Stage A closes here.

- Dispatched opus. Returned `DONE_WITH_CONCERNS` at `891f4bff4`. Task review (opus) returned
  **Spec ✅ on every enumerated constraint** — the first task to do so — with two Important
  findings that were the same defect, and five small ones. One fix round (`90c1d01a3`), and
  the scoped re-review verdicted all seven ADDRESSED with no new breakage.
- Final: `Test Files 6 passed (6)` / `Tests 291 passed (291)`, plus the Therapy Compass
  regression at `Test Files 3 passed (3)` / `Tests 25 passed (25)`. Typecheck and lint fresh
  under `GATE_RECEIPTS=refresh`. 61 mutations across the task, all killed.
- The shared primitive held. `src/components/ui/print-output.tsx` gained four capabilities,
  every one additive and default-off; the reviewer verified both Therapy Compass consumers
  emit identical DOM, and a `container.innerHTML` byte-for-byte pin now fails on any future
  non-default-off addition — a stronger guard than any per-prop assertion.
- **A second print defect of the Task 3 kind was found and closed.** The shared print rule
  makes everything outside `[data-print-output]` invisible, so on a `PrintOutput` route the
  shell header's synthetic marker never reached the paper. The printed subtree now carries
  its own marker. Twice now, a print change has silently removed the one line telling a
  reader the document is fictional; any future print work should assume it will happen again.

**Not proven by Stage A, and must not be claimed:** nothing has rendered in a print medium.
Pagination, cascade order against Tailwind utilities, whether the monochrome rule actually
wins, and real print preview are all Task 11 work. No Chromium journey, no accessibility
audit, no responsive observation at 320 px or 390 px, no production build, and no
provider-backed gate has run for this feature.

### Task 6 — complete. Stage B opens here.

- Dispatched opus. Returned `DONE_WITH_CONCERNS` at `01f386ace`. Task review (opus) returned
  Spec ❌ with **two Critical**, three Important and several Minor. Two fix rounds
  (`65f930994`, `2113fe97f`); the scoped re-review verdicted every finding ADDRESSED with no
  new breakage, and confirmed each new guard would catch its original defect if reintroduced.
- Final: `Test Files 4 passed (4)` / `Tests 306 passed (306)`, plus `form-field.tsx`'s other
  consumers at 161/161. Typecheck and lint clean. 28 mutations, 27 killed and one honestly
  reported as **equivalent rather than killed**.
- The whole offline suite ran at 2 failed / 8036 passed. Both failures are `gate-receipts`
  file-mode tests, environmental on this Dev Drive (`fs.chmodSync` reports
  `mode before: 100666 after: 100666 changed: false`) and untouched by a diff that goes
  nowhere near `scripts/` or `.githooks/`. Recorded as red, not rounded to green.

**Both Critical findings reached the user and neither was visible to any gate.** The first was
a stylesheet block inserted between a selector list's comma and its continuation, which
silently rebound `.pinnedBoundaryLink` — the jump link inside the pinned safety boundary — so
it lost its colour, weight and underline and rendered as plain text with no affordance at all.
Three existing guards all passed it: Vitest runs `css: false` so no DOM test can see styling;
the protected-selector guard inspects declarations only for _suppression_, so a rebinding is
invisible to it; and the `.appRoot` scoping test splits on the comma and finds both halves
correctly scoped. The second told an approving senior clinician that **nothing had changed in
any section of a patient's first plan**, comparing the proposed content against itself under
the heading `Comparing Current version 0`. Reachable today on `SYN-PATIENT-005`.

**The implementer caught the sixth guard-that-cannot-fail itself**, which is the first time
that has happened on this project rather than a reviewer finding it. Its scenario-sync test
navigated only the pathname, leaving every effect dependency untouched, so the effect never
re-ran and the test would have passed whatever the guard did.

### Task 7 — complete

- Dispatched opus. Returned `DONE_WITH_CONCERNS` at `2be157ff1` (12 files, +2288/−18, 332
  tests, 34 mutations all killed). Task review (opus) returned Spec ❌ with **no Critical**,
  three Important and a long Minor list. One fix round (`a8a8264be`); the scoped re-review
  verdicted every item ADDRESSED with no new breakage and no test loosened to accommodate the
  fixture change.
- Final: `Test Files 4 passed (4)` / `Tests 335 passed (335)`. Typecheck and lint fresh under
  `GATE_RECEIPTS=refresh`, Prettier clean, all staged blobs free of CR, control bytes, NBSP
  and BOM.

**The finding that mattered most was clinical, not structural.** A correction that changed two
fields at once could be **partially applied while the banner reported success**: clearing the
one-line note and changing plan helpfulness in the same correction refused the note (it
precedes helpfulness in field order), appended the helpfulness amendment, closed the sheet, and
overwrote the refusal in `lastOutcome` with the success message. On a record whose entire
purpose is that corrections are visible and attributed, a correction discarded with no trace is
the worst available outcome. It now refuses the whole save before dispatching anything, names
the offending field, and leaves the sheet open holding the clinician's typed work.

**The seventh guard-that-cannot-fail.** The task legitimately relocated the episode page's
parameter check — the old server guard would have 404'd every episode recorded in a live
session — but the test holding it asserted an alternation, `isSyntheticPatientId` **or**
`isSyntheticPresentationForPatient`, which the patient half satisfied alone. Deleting the
presentation check entirely left the suite green. It is now checked per parameter, by name,
with a fail-closed count of how many pages carry `[presentationId]`.

### Task 8 — complete

- Dispatched opus. Returned `DONE_WITH_CONCERNS` at `87b28b3ac` (365 tests, 44 mutations all
  killed). Task review (opus) returned Spec ❌ with **no Critical** and **one Important** —
  but that one was the most consequential finding in the whole build. One fix round
  (`79cfa97b3`); the scoped re-review verdicted every item ADDRESSED with no new breakage.
- Final: `Test Files 4 passed (4)` / `Tests 369 passed (369)`. Typecheck and lint fresh,
  Prettier clean, 58 mutations across the task, all killed.

**The printed patient copy handed a person a list of blanks about their own life.** The print
surface reused the reading surface's section component, which renders `Not recorded` for an
empty section. `SYN-SAFETY-VERSION-004` is a genuinely current plan whose owner declined to
write one in her own words — all six patient-voice arrays empty, holding only crisis numbers.
Printing it produced a sheet addressed to her reading `Last confirmed — Not recorded`, then
"This is your plan, in your own words.", then six headings each answered `Not recorded`,
including **`My reasons for living — Not recorded`**.

Nothing was broken. `Not recorded` is correct on the clinician's reading surface, and the print
surface simply inherited it. No test had ever printed that patient — every print test used
`SYN-PATIENT-001`. It took a reviewer reading the page as its recipient rather than as an
engineer. The printed copy now omits an empty section entirely rather than printing its heading
over a blank, suppresses the own-words claim and the `Last confirmed` row when there is nothing
to claim, and keeps `Not recorded` unchanged for the clinician — with a control proving the fix
cannot be re-applied to the reading surface and quietly remove that signal.

**Two more guards that could not fail, both found by the implementer's own controls.** That
makes nine on this project, and these two were a **new shape**: assertions that read their
expected value from the same constant the component renders from, so they can never disagree
with what is on screen. One test for "the declined label must not deny the plan exists" compared
the rendered text against `PATIENT_CONFIRMATION_LABEL.declined` — which passes for _any_ label,
including the defective one it was written to catch. Repaired with a literal forbidden-phrasing
regex applied across all four labels and all four explanations.

---

## Rulings

Every decision taken on the user's behalf. Each says what was decided, why, and
what it costs if wrong.

### Pre-flight scan (before Task 1)

The scan compared every pair of tasks sharing a file or interface, and each task's
text against itself. Six conflicts found, six ruled.

1. **Task 1 creates every type in the Canonical Interfaces block, including the
   patient-plan entities.** Both Task 1 and Task 9 were told to create them; the
   block's own sentence assigns them to Task 1, and two tasks editing the same
   symbols is how parallel definitions get born. _Cost if wrong:_ Task 1's diff is
   larger than its checklist implies.
2. **Task 9 owns all patient-plan fixture data**, including `syntheticResources`.
   Task 1 creates the types only; Task 2 seeds `patientPlans: []`,
   `patientPlanVersions: []`, `patientResources: []`. Authoring that clinical
   content in Task 1 would bury it in a task nobody reads for it. _Cost if wrong:_
   Task 9 carries fixture authoring as well as logic.
3. **Each action joins `CarePlanPrototypeAction` in the task that implements it.**
   Task 2 defines only its own; Task 5 adds `record-management-plan-print-intent`,
   Task 6 adds `record-plan-shared-with-patient`, Task 9 adds the four patient-plan
   actions. The exhaustive switch stays exhaustive at every commit. _Cost if wrong:_
   three later tasks touch two shared files.
4. **Task 1 creates `BANNED_ADMISSION_CONSTRUCTIONS` in `domain.ts`** plus the
   fixture scan. It is a fixture-language rule and Task 1 owns fixture language;
   Task 6 imports it for form validation. _Cost if wrong:_ the constant exists one
   task before its first UI consumer.
5. **Task 4 creates `CurrentPlanSummary` and `PinnedSafetyBoundary` in
   `prototype-ui.tsx`; Task 5 consumes them.** The spec requires the pinned safety
   boundary above all plan content wherever plan content appears, which includes
   the Clinical Snapshot, so one shared component is the only way both surfaces stay
   correct. _Cost if wrong:_ a component is built one task early, against two
   drifting copies of a safety-critical element.
6. **Task 5 may extend `src/components/ui/print-output.tsx` only additively and
   default-off**, must not change rendering for any existing consumer, must carry a
   focused test per capability, and must run the Therapy Compass print tests before
   committing. _Cost if wrong:_ a shared primitive regresses two Therapy Compass
   screens; the required test run is the guard.

### Task 1

7. **The mailto subject kept the old product name — plan defect, fixed.** The
   `ED Care Plans` → `Care Plan` rename replaced the spaced and hyphenated forms but
   not the URL-encoded `ED+Care+Plans`, so the brief pinned a stale string in a
   verbatim test and the implementer correctly followed it. _Cost if wrong:_ none.
8. **`PresentationAmendment.field` widens to `AmendableField` — spec is binding.**
   The grilling round widened the amendable set to disposition, assessment outcome,
   the one-line account and the three plan-use answers, but the canonical type still
   allowed only the first two, so the plan contradicted its own spec. Six values;
   `originalValue`/`replacementValue` stay `string`; the reducer validates that a
   disposition replacement parses. The plan-use answers group in the UI but each
   changed answer records its own attributed amendment. _Cost if wrong:_ Task 7's
   amendment sheet is richer than needed.
9. **Fixture source URLs use organisation roots where no official deep link
   exists — accepted, not a defect.** The implementer declined to invent slugs
   offline, which was right. The controller supplied the verified MHERL and
   Rurallink deep links; `000` stays an organisation root. _Cost if wrong:_ a reader
   navigates one extra step.
10. **The `0491 570 006`–`156` block is the ACMA range reserved for fiction and must
    not be "fixed".** Recorded in the plan so no later task changes it to a
    real-looking but allocatable number. _Cost if wrong:_ none identified.
11. **The rename over-reached and rewrote real identifiers — corrected.** It also
    rewrote the worktree path, this branch name, the Codex planning worktree path
    and `codex/ed-care-plans`, so the plan's first Global Constraint pointed a future
    implementer at a directory that does not exist. Restored, and every `src/`,
    `tests/` and `scripts/` path named in the plan and spec was swept against the
    filesystem — all present except the two SDD skill scripts, which correctly live
    in the skill directory. _Cost if wrong:_ none — verified against the filesystem.
12. **Ruling 10 was right about the range and wrong to assume the fixtures were
    inside it — renumbered.** The implementer checked and found `0491 570 210`–`222`,
    which sit **above** the reserved span and are ordinary allocatable numbers. These
    print onto a patient-facing safety plan. Reallocated to `101/102`, `111/112`,
    `121/122`. _Cost if wrong:_ none — the range is conservative either way.
13. **The fixture also contradicted a value the plan pins three tasks ahead.**
    Task 4's example test pins North River CMHT at `tel:+61491570101`; the fixture had
    `0491 570 210`, so Task 4 would have failed against Task 1's data. The renumbering
    resolved both defects at once. Required a numeric range assertion rather than a
    literal list, so a seventh number added at Task 8 or 9 cannot sit outside the span
    unnoticed. _Cost if wrong:_ none identified.
14. **The renumbering table was wrong to cover the after-hours numbers — reversing
    my own instruction.** The implementer flagged that swapping fictional mobiles into
    `afterHours*` while keeping real crisis-service names would print a fictional
    number under MHERL's name. Its reasoning was right; the instruction was the defect.
    A duty line belongs to a fictional team and must be fictional; the after-hours
    pathway **is** the real public crisis service, and it prints on the patient-facing
    safety plan under "who to call at 2am", so a demo reader who dials it must reach a
    real service. Restored MHERL Perth `1300 555 788` (North River), MHERL Peel
    `1800 676 822` (Coastal Plains), Rurallink `1800 552 002` (Wandoo), keeping the
    not-an-emergency-service caveats and Rurallink's hours. Range test became a numeric
    check for fictional mobiles plus an explicit four-entry allowlist for the public
    lines. _Cost if wrong:_ a fictional directory contains four real public numbers,
    which the spec explicitly permits as the only intentional non-fictional fixtures.
15. **Stored `reviewState` removed from both version types; review state is always
    derived.** `ManagementPlanVersion.reviewState` and
    `PersonalSafetyPlanVersion.reviewState` restated what
    `deriveReviewState(reviewDueAt, now)` computes and could drift, and the
    consistency test covered only Management Plan current versions. Removed the class
    rather than adding the missing test, since nothing consumed the field yet. _Cost
    if wrong:_ Tasks 5 and 8 call `deriveReviewState` at render — a trivial call,
    against a stored indicator that could tell a clinician a plan is current when its
    date says otherwise.
16. **`deriveReviewState` must fail conservatively.** It returned `within_review` for
    an unparseable date because both comparisons were false — a malformed value
    silently producing the most reassuring state on a clinical currency indicator.
    This repo's standing rule is that failure degrades conservatively rather than
    guessing, so it returns `overdue`. _Cost if wrong:_ a plan shows as overdue when
    it is not, which is the safe direction.
17. **The numeric review trigger is compliant but reworded anyway.** "Two or more
    presentations where the plan was recorded as not helpful" prompts review of an
    existing plan rather than creating eligibility, so it does not breach the
    identification-threshold ban — but it was the only number a reader could misread
    as a rule, and fixtures are written to be imitated. _Cost if wrong:_ none.
18. **Fix Evelyn's referral by moving it, not rewording again.** Verified against
    `PROTOTYPE_NOW`: withdrawal 4 July, referral 11 July, only post-withdrawal
    presentation 4 August — 24 days after the referral claimed it happened. Moving
    `referredAt` to `daysAgo(14)` makes the claim true and gives the referral a
    triggering event instead of leaving it floating free. Also required a chronology
    guard, since the count sweep checks how many and never when. _Cost if wrong:_ the
    identification queue's ordering shifts by one position.

### Task 2

19. **`ReviewTrigger.source` gains `"participation"` — the type could not express a
    constraint the spec requires.** Approving at `declined`/`patient_unavailable`
    must raise an open trigger, but the canonical union had no value for it and
    redefining canonical types is forbidden, so the implementer correctly stopped.
    The on-screen marker is not a substitute: a marker is read only by whoever opens
    that plan, whereas a trigger reaches the Reviews queue where somebody owns it.
    _Cost if wrong:_ one extra queue item per such approval, which is the intent.
20. **Remove the online/offline listener — plan-mandated, spec-contradicted, spec
    wins.** The spec says the offline state exists "only in the dedicated specimen
    scenario". Nothing in a memory-only prototype depends on the network, and the
    implementer's route through `apply-scenario` reconstructs fixtures, discarding a
    user's in-session draft because their wifi blipped. _Cost if wrong:_ a genuinely
    offline browser shows no degraded state — correct, because nothing here is
    degraded by being offline.
21. **The plan's stale Task 2 snippet is corrected to match Task 1's shipped names,
    not the reverse.** Verified against the fixtures: `SYN-MGMT-PLAN-002`,
    `getOpenManagementDraft(versions, planId)`, and Mira's former Current genuinely is
    version 1 with the awaiting version at 2. Task 1 is committed and reviewed;
    churning identifiers would cost more than a stale example. _Cost if wrong:_ none.
22. **Review Triggers reach anyone who has ever had a version, not only those with a
    live Current one.** The reducer gated on a Current version, so a person whose plan
    was withdrawn who then presents and is admitted produced nothing for the Reviews
    queue — the cohort that queue most exists for. Only a patient who has never had
    any version raises none, because their pathway is Identification Review. _Cost if
    wrong:_ a queue item for a plan with no current version, which is the signal wanted.
23. **Approval requires a non-empty `revisionReason`.** A version must not become the
    Current Plan with no stated reason for existing, and the reducer is the final guard
    rather than the form. _Cost if wrong:_ Task 6's form must supply a reason, which it
    already collects.
24. **Printing the Personal Safety Plan is exempt from the offline/connectivity block.**
    It is the single action you most want when systems are down, and it appends an audit
    event rather than changing a record. Identity uncertainty still blocks it — printing
    the wrong person's safety plan is a real harm — so the exemption is from the
    connectivity block only, not the funnel. _Cost if wrong:_ an intent audit event is
    recorded in a specimen scenario where other mutations are unavailable.
25. **The default participation wording must not assert an unrecorded fact.** A new
    draft defaults to `patient_unavailable`, so the trigger reason asserted "this person
    was not available to take part" when nobody had recorded anything. Keep the
    conservative default and the trigger; word the reason to say only what is known.
    Same family as the non-stigmatising-language rule. _Cost if wrong:_ none.

### Task 3

26. **The error boundary is a client class component inside the gate, wrapping the
    provider — not a Next `error.tsx` at the Care Plan segment.** Task 2's deferred minor
    records that `assertSingleCurrentVersion` throws with no boundary, and the session
    brief makes mounting one an input to Task 3. A segment `error.tsx` cannot catch it:
    `assertSingleCurrentVersion` throws from inside the reducer, the reducer runs during
    the render phase of the component owning the state, and that component is
    `CarePlanPrototypeProvider`, which the plan places in `layout.tsx` — a segment's
    `error.tsx` never catches a throw from its own layout. So the boundary must be an
    ancestor of the provider and a descendant of `DeveloperAreaGate`. It renders the
    existing shared `RouteErrorBoundary` panel from
    `src/components/route-error-boundary.tsx` as its fallback rather than new markup, per
    the standing rule against duplicating a primitive that already exists. _Cost if
    wrong:_ one small extra component; a segment `error.tsx` can still be added beside it
    later if page-level throws want their own treatment.

27. **The glossary's `_Avoid_` lists are concept-scoped, not a blanket lexical ban — the
    reviewer's finding is overruled, its underlying point adopted.** The task review
    flagged `Create or edit a draft version` and `Print-optimised patient copy` as
    breaching `_Avoid_: Edit, overwrite` and `_Avoid_: Copy, document`. But those entries
    sit under **Presentation Amendment** and **Management Plan Version** respectively:
    they ban calling an amendment an edit and calling a version a copy, neither of which
    those strings does. A blanket reading also makes the glossary contradict itself — its
    own Draft entry reads "can be edited" — and both strings are **verbatim from the
    binding specification's route table**, which the controller supplied as approved copy,
    so changing them would put the code out of step with the spec. The copy stands. The
    reviewer was right about the cause, though: the banned-phrase scan covered three
    phrases out of a namespace that will grow by twenty routes, so it was widened to the
    terms that genuinely are blanket-banned — stigmatising labels for a person,
    quantified risk or severity verdicts, and all seventeen
    `BANNED_ADMISSION_CONSTRUCTIONS` imported from `domain.ts` rather than retyped. The
    concept-scoped terms are explicitly excluded in a comment, so nobody "completes" the
    list later and reintroduces this. _Cost if wrong:_ three route-purpose strings read
    slightly closer to the amendment and version vocabulary than a purist would like;
    every genuinely harmful term is now machine-checked, which it was not before.

28. **The live region was removed rather than repaired, and that is accepted.** Fixing the
    route-focus defect made the hand-rolled `aria-live` region a double announcement, and
    keying it on the pathname would have put synthetic record identifiers into a
    screen-reader announcement. Focus-to-heading is the standard pattern, now keyed on the
    address and covered by a test that re-renders at a second pathname resolving to the
    same heading. _Cost if wrong:_ if the whole-branch review wants a live region back it
    needs a per-route value carrying no record content; the deferred-minors list already
    records that the repository's shared `LiveAnnouncer` is the right home for it.

### Task 4

29. **The Task 4 brief describes the summary card in the superseded nineteen-field
    vocabulary; the spec wins and the card is the five `FIRST_MINUTE_CONTENT_KEYS`.** The
    brief asks for "preferred engagement, what helps, what may increase distress,
    immediate continuity considerations, CMHT coordination". Two of those are exactly the
    duplicate pairs the 21 August design review deleted — engagement against
    agreed-approach, and "may increase distress" against "what makes it worse" — and the
    specification's acceptance criterion is that the card is _exactly_ the five
    first-minute sections in order. The card is therefore generated by iterating the
    `FIRST_MINUTE_CONTENT_KEYS` constant rather than transcribing a list, so a sixth
    section cannot be added without changing `types.ts`. Caught before dispatch, not by a
    reviewer. _Cost if wrong:_ none identified — the spec, the shipped types and the
    acceptance criteria all agree against the plan's stale prose.

30. **The brief's worked example pins version numbers the fixtures contradict; the
    fixtures win.** It expects "Awaiting Approval version 3 / Current version 2"; Mira's
    plan is Current 1 with the awaiting version at 2. Ruling 21 already recorded the same
    fact for Task 2, so this is the second appearance of one stale example. The
    implementer used the fixture-true numbers and kept the rest of the example verbatim.
    _Cost if wrong:_ none — Task 1 is committed and reviewed, and churning identifiers to
    match an example costs more than the example is worth.

31. **Selecting a patient on Home renders the workspace on Home rather than navigating —
    the brief contradicts itself and the constraint behind it is met.** The brief's prose
    says selection navigates to a full-width workspace on phones; its own worked example
    requires the workspace to render on Home after the click, with `navigate` mocked. The
    real constraint is the phone layout — single column below `64rem`, directory first, no
    compressed second column — and that is satisfied, with a link to the full-width record
    offered as well. But route navigation was what bought the focus move, so the departure
    left selection silent for a screen-reader user; a focus move to the workspace was added
    to replace what navigation would have given. _Cost if wrong:_ a one-line change to
    navigate instead, and the focus effect becomes redundant rather than wrong.

32. **`judgement` stands; the specification's `judgment` is the defect.** The repository
    writes Australian English throughout and the Global Constraints require `en-AU`, where
    `judgement` is the standard spelling. The continuity sentence keeps it. _Cost if
    wrong:_ one word differs from the spec's own prose, which should be corrected at the
    Stage A checkpoint rather than the code bent to match it.

33. **The pinned safety boundary's copy was overstating the section, and was changed.** It
    read "This plan does not apply if today is different", which is a stronger claim than
    section 5 makes — the plan still supports continuity when today differs, as the
    continuity boundary in the same card says. It now reads "Do not rely on this plan if
    today is different — assess afresh." This is the single most safety-critical line in
    the product and it renders in print, so it was fixed immediately rather than deferred.
    _Cost if wrong:_ none identified; the weaker claim is also the accurate one.

34. **The Task 3 shell gained an optional `routeOwnsSearch` prop rather than Home carrying
    two search fields.** Home and Patients own their own search; without the prop the shell
    composer would render a second one, breaching the repository's one-composer-per-page
    rule. Three Task 3 tests moved from `home`/`patients` to `reviews`/`team`; the
    re-reviewer verified their assertions are byte-identical, and a new test asserts Home
    has exactly one searchbox _and_ that the survivor is the directory's — so the rule is
    met rather than sidestepped. _Cost if wrong:_ one optional prop on a shell that will
    carry more route-specific behaviour as Tasks 6–10 land.

### Task 5

35. **`record-management-plan-print-intent` joins `CONNECTIVITY_EXEMPT_ACTIONS`.** Ruling 24
    exempted the Personal Safety Plan print from the offline block because printing "is the
    single action you most want when systems are down, and it appends an audit event rather
    than changing a record". Both halves of that are properties of the _action_, not of which
    document it prints; the rationale reads as being about the Safety Plan only because that
    was the sole print route in existence when it was written. Generalising it to its own
    logic is not contradicting the reviewed decision — narrowing it to the document it
    happened to name would be.

    The behaviour decided it anyway, and the mechanism was worse than either the implementer
    or I assumed: `BrowserPrintButton` calls `onBeforePrint?.()` and then `window.print()`
    **unconditionally**, ignoring the hook's return, so the reducer's refusal could not stop
    anything. In the offline specimen the dialogue opened, a clinical document could leave
    the building, `auditEvents` was unchanged, and the reader was told "nothing was changed".
    Paper left the room and the application's own account denied it — an underclaim in
    exactly the direction this prototype's audit discipline exists to prevent, and it made
    two identical operations diverge.

    Identity uncertainty still blocks printing: Ruling 24 exempted the connectivity block
    only, never the funnel, and the re-reviewer confirmed the identity, permission and
    version-conflict checks are separate unconditional statements that were not touched.
    `print-output.tsx` was deliberately **not** given a veto contract — with the exemption in
    place nothing on this route depends on one, and adding a new contract to a shared
    primitive is a bigger change than this warranted. _Cost if wrong:_ a print intent is
    recorded in a specimen where other mutations are unavailable, which is Ruling 24's stated
    intent. The latent limitation stands: no caller can refuse a print from a
    `BrowserPrintButton`, so a future refusable print route needs the primitive changed.

36. **`REVIEW_STATE_TONE` was deleted rather than exported — the implementer deviated and was
    right.** The instruction was to export the constant and consume it in place of a
    hand-copied ternary. But fixing the duplicated status marks removed that ternary's only
    consumer, so exporting would have published a constant to feed nothing. The duplication
    risk is gone by deletion instead of by coupling. _Cost if wrong:_ a future surface needing
    the tone exports it then, which is the cheaper moment to decide the shape.

### Task 6

37. **A third worked example pinned version 3 against a fixture that says 2 — the fixtures
    win, and this is now a pattern rather than an incident.** Rulings 21 and 30 recorded the
    same defect for Tasks 2 and 4; Task 6's example asserted `Approve version 3` /
    `Current version 3` for `SYN-PATIENT-002` when `SYN-MGMT-VERSION-004` is
    `awaiting_approval` at version 2 over a Current at version 1. Every remaining task brief
    that names a version number should be checked against the fixtures before dispatch, not
    after. _Cost if wrong:_ none — the rest of the example verified exactly.

38. **Task 6 builds the role switcher, which no earlier task built.** The brief's example
    selects a `Prototype role` combobox that did not exist: the shell displayed the active
    synthetic user as static text and offered no way to change it, though the `set-active-user`
    action had existed since Task 2. Approval is role-gated and withdrawal is
    `senior_clinician`-only, so a prototype that cannot switch between a senior and a
    non-senior view cannot demonstrate its own central governance rule, and every later queue
    and permission surface needs the same control. It is interaction modelling, not
    authentication — the displayed user explains why an action is available and the reducer
    remains the final guard. _Cost if wrong:_ a control in the rail that a later task would
    have had to build anyway.

39. **The URL-to-reducer scenario sync lands in Task 6, not deferred.** Every reducer-gated
    refusal across Tasks 4, 5 and 6 was **dead in the running application**: the provider is
    mounted in a server layout that cannot read a query string, so `state.scenario` was always
    `normal` and every branch of `getPrototypeMutationBlockReason` was unreachable. Three tasks
    had shipped refusals no user could ever see, and each further task would add more. The
    implementer's reason for deferring — that a route-level effect resets the whole world and
    might collide with a later task's design — was weaker than it looked: the sibling Caring
    Contacts prototype already implements the same guarded sync in about eight lines.

    **The guard is the substance of the ruling.** `apply-scenario` reconstructs fixtures, and
    Ruling 20 removed an online/offline listener precisely because routing through it discards
    a clinician's in-session draft. So the effect dispatches **only when the scenario named in
    the URL differs from `state.scenario`** — never on every render, never on an ordinary
    navigation within one scenario. Both directions are tested. What is genuinely prop-driven
    was never at risk: `identity-uncertain` and `launch-failure` were always reachable, and
    `unverified-contact` comes from the fixture rather than the query, so Task 4's
    contact-failure behaviours were intact throughout. _Cost if wrong:_ an effect in the route
    surface that Task 10 may want to reshape when it builds the System states controls — that
    screen now owns the question of whether a hand-toggled scenario also updates the URL.

40. **The shared `ErrorSummary` keeps focus on a failed submit; the round-1 opt-out was
    reverted.** The brief says to focus the first invalid field, and the repository primitive
    focuses itself, so the combination gave a screen-reader user two focus events and moved
    them off a summary of up to seven linked errors before it could be read. Round 1 resolved
    it by opting the summary out. Overruled: the primitive already made this decision for
    every form in the product, and a Care Plan form behaving differently from every other form
    is worse for a user than either target on its own. With this many errors the summary is
    also the more useful landing place — the user hears how many problems there are and
    chooses — and its links are how they reach the field, so the brief's requirement is
    satisfied by their choice rather than pre-empted. Reverting also returned
    `src/components/ui/form-field.tsx` to **untouched**, which the re-reviewer confirmed from
    the diff rather than from the implementer's word. _Cost if wrong:_ a one-line flip, and the
    ordering test pins whichever way it points.

### Task 7

41. **The one-line note keeps the specification's label, not the brief's.** The brief calls the
    required free text `Anything worth flagging?`; the specification says
    `In one line: why they came and what happened`, twice. That line was deliberately made to
    do the work the separate `presenting indication` and `assessment outcome` fields would
    otherwise do, on the reasoning that one line from the clinician who was there beats two
    structured boxes that get skipped at the end of a shift. The brief's wording invites an
    optional afterthought instead. _Cost if wrong:_ none — the spec states it twice and the
    plan's own Global Constraints agree.

42. **The fixtures were wrong and the reducer right on append-only.** `SYN-PRESENTATION-002`
    and `-003` stored the _corrected_ value on the episode with the amendment recording what it
    replaced; the reducer never rewrites an episode. Both conventions were pinned by committed
    tests in different files, and the implementer correctly refused to resolve it alone. The
    glossary settles it: a Presentation Amendment "preserves the original record", and the
    specification says the original text is not replaced. So the episode holds what was first
    recorded and the amendment records what it became.

    Fixtures on this project are written to be imitated — an earlier ruling says so in those
    words — so leaving two records encoding the opposite convention was the real risk. Both
    corrected, `tests/care-plan-domain.test.ts:748` inverted to assert the **earliest**
    amendment's `originalValue`, and a chain invariant added. Nothing rendered wrongly under
    either model beforehand, because `getRecordedPresentationValue` reads the first correction's
    `originalValue`, which is truthful either way — good design that happened to mask the
    contradiction. _Cost if wrong:_ two fixture records and one inverted assertion; the
    reviewer traced the blast radius and confirmed no filter, count or other assertion moved.

43. **A correction refuses as a whole rather than applying in part — the implementer's trade,
    accepted.** Recording the valid corrections and reporting the rest would need per-dispatch
    outcomes from the reducer, which is a reducer change and out of scope. Refusing everything
    is the conservative direction, the error names the offending field, and the sheet keeps the
    clinician's typed work so nothing is lost. _Cost if wrong:_ a clinician who blanks one
    field must fix it before any of their other corrections are recorded — friction, not loss.

### Task 8

44. **A person's own six sections are required only when they confirmed or discussed the
    version.** The brief's literal "at least one item in every section" cannot coexist with its
    own "do not treat declined or unavailable as non-compliance": `SYN-SAFETY-VERSION-004` is a
    legitimate declined-and-current version holding only crisis numbers and is unreproducible
    under the literal rule, and requiring seven sections of somebody's own words when they took
    no part would make a clinician **invent words and attribute them to the patient**. The
    implementer raised this rather than choosing silently, and the reviewer confirmed the
    reasoning survives contact with the code and the fixtures. Review date, collaboration note
    and `professionalAndEmergencySupport` stay mandatory in all four states, and the per-person
    name, relationship and phone checks run whether or not the section is required — nothing
    lets a strictly empty plan become Current. _Cost if wrong:_ a clinician can make a sparse
    version current for someone who took no part, which is the situation the relaxation exists
    to serve.

45. **The printed copy omits an empty section rather than printing its heading over a blank,
    and the own-words claim is conditioned on content rather than on confirmation state.**
    Omission beats rewording here: six headings each inviting her to write would read as a
    checklist of things she declined to do, and what remains — her contacts and the crisis
    block — is what her plan actually is. Conditioning on content rather than on
    `patientConfirmation` was the implementer's own variation on the instruction and is the
    safer one: content is what makes the sentence true or false, and it also covers a
    `confirmed` version that somehow holds nothing. The two agree in every state the form can
    produce. _Cost if wrong:_ a future data path that produced a current version with an empty
    `professionalAndEmergencySupport` would drop those contact lines from the paper, though the
    hardcoded crisis block still renders — recorded below as a defensive carve-out worth adding.

46. **`print-failure` records no audit event at all.** The only available action's outcome
    message asserts "The print view was opened", which did not happen, and adding a new action
    is barred by the pre-flight ruling assigning actions to tasks. Recording nothing is the only
    honest option inside that constraint, and it matches the standing rule that an Audit Event
    describes only evidence the application actually has. _Cost if wrong:_ a failed print leaves
    no trace in the chronology at all — recorded as a deferred minor for a later task, since a
    contact action _does_ record an attempt that is explicitly not evidence of delivery.

47. **The printed title is an `<h2>`, not the brief's `<h1>`.** A committed test has pinned
    exactly one `<h1>` per route since Task 3 and the shell owns it; Task 5's clinician print
    resolved the identical tension the same way. The printed document still carries a clear
    accessible title, asserted by role and level. _Cost if wrong:_ none — consistent with the
    other print surface.

---

## Deferred minors — for the whole-branch review to triage

Recorded, not fixed. None blocks a later task.

**Task 1**

- `awaitingApproval` queue ordering is asserted on a single element, so its sort is unproven.
- `CmhtContact.verifiedAt` is non-nullable, so "never verified" cannot be expressed, while `SYN-CMHT-003` is `unverified` with a date.
- The telephone sweep cannot see a bracketed `(08) 5550 1234` landline.
- `addIsoDays`/`addIsoMonths` are calendar helpers in a file declaring itself pure selectors.
- A copied `Optional detail` doc comment sits on the required `cmhtContactAttempt`.
- `it.each` emits four identically-named tests (brief-pinned, not the implementer's choice).
- `fixtures.ts` is ~1,420 lines before Tasks 8 and 9 add more — Task 9's patient-plan fixtures should get their own module.
- The count guard matches spelled numbers only, so a digit-form claim evades it.
- `once|twice` must sit immediately adjacent to the verb, so "left before assessment twice" evades it.
- Ruling 17's reword is now load-bearing rather than cosmetic: a legitimately-phrased future review trigger can trip a count guard that has nothing to say about it.
- `BLAMING_TERM` includes "difficult"/"refuses"/"agitated", which have legitimate service-facing uses — fails closed, so the safe direction, but expect false positives.
- `CONCRETE_FINDING` is curve-fit to the present fixtures.
- `SYN-PRESENTATION-019` breaks identifier ordering in the array (cosmetic; consumers sort).

**Task 2**

- The reducer is a single ~945-line switch. Extract per-case functions before Task 9 adds six more actions.
- `assertSingleCurrentVersion` throws with no React error boundary — **an input to Task 3**, which must mount one.
- `nextSyntheticId` interpolates its prefix into a `RegExp`.
- `reset` always returns the `normal` world, so a displayed specimen scenario silently persists.
- The `AMENDABLE_FIELDS.includes` runtime check is unreachable under the typed action.
- `save-management-draft` does not validate that `ownerId` names a clinical role, so the non-clinical `plan_coordinator` can be recorded as Plan Owner.

**Task 3** — raised by the fix-round-1 reviewer, recorded rather than fixed.

- The duplicated loading skeleton across `loading.tsx` and `route-page.tsx` carries inconsistent
  accessible naming (`sr-only` paragraph in one, `aria-label` in the other).
- The `src/components/care-plan/mockups/index.ts` barrel has zero importers.
- The active user falls back to empty strings at `routable-suite.tsx` when no user matches
  `activeUserId`, so a broken id renders a silently blank identity block rather than failing.
- The phone dock selects its items by matching label strings against
  `CARE_PLAN_PRIMARY_DESTINATIONS` rather than by an explicit list.
- `aria-current="page"` is set on the More **button**, which is a disclosure control, not a
  destination.
- Two test names in `tests/proxy.test.ts` still say "the two developer-gated paths"; there are
  now three.
- The non-mockup-route guard in `tests/care-plan-route-files.test.ts` checks only four
  hard-coded paths, so a Care Plan route added elsewhere under `src/app/**` would evade it.
- `docs/codebase-index.md` has no Care Plan entry. `docs:check-index` passes without one, but
  the repo's new-route checklist wants one before the branch is handed off.

The hand-rolled `aria-live` region was **not** deferred: it was removed as part of Important #3,
because it double-announced against the focus move that fix depends on.

**Task 6** — recorded rather than fixed.

- `management-plan-form.tsx` is 661 lines with nine pure helpers (`toDateValue`,
  `toPerthTimestamp`, `textOf`, `linesFrom`, `valuesFrom`, `contentFrom`, `draftInputFrom`,
  `bannedConstructionIn`, `validate`) reachable only through a rendered form — the same
  argument that correctly earned `diffManagementPlanContent` its own export.
- `.appRoot .roleSwitcher` sets a redundant `min-height`; `fieldControl` already applies
  `h-tap` and `--spacing-tap` is `3rem`, so the target is 48 px either way.
- The review route renders the Current Plan in full above the change table. That is correct
  under read primacy, but it means scrolling past five sections on a phone; a jump link is
  worth considering, not a reordering.
- The blocked-reason pattern on the plan actions uses a visible `role="alert"` paragraph plus
  `aria-describedby` rather than the generic `title="… — coming soon"` plus `sr-only` shape.
  It matches the already-reviewed `shareBlockedReason` convention in the same file, so it is a
  consistent extension rather than a new deviation — but the two patterns should be
  reconciled before handoff.

**Task 7** — recorded rather than fixed.

- **The amendment-chain invariant's second half is correct but unexercised.** The guard asserts
  both that the episode field equals the earliest amendment's `originalValue` _and_ that each
  later amendment's `originalValue` equals the previous one's `replacementValue`. No fixture has
  a field corrected twice, so every chain has length one and the second loop never runs. The
  implementer's claim that restoring the old convention "takes down both halves at once" is
  overstated: both kills land on the first half, checked from two files. The clean close is a
  unit test with a constructed two-link chain — **not** bending a fixture to exercise a test.
  Flagged deliberately for the whole-branch review, because untested guard code is how this
  project got seven guards that could not fail.
- The `[presentationId]` parameter-guard regex does not require the matched call's argument to
  be literally named `presentationId`, unlike its `[patientId]` sibling, so a wrong-variable
  mix-up would pass.
- The invariant guard's fail-closed threshold is `chains.size > 1` rather than `> 0`. It still
  fails on zero corrections, but its message would fire misleadingly if exactly one distinct
  field ever carried a correction.
- `linkedPlanLabel` returns `No Current Plan was available` for a non-null version id that
  resolves to nothing, conflating "the version is unknown" with "there was none".
- `isSyntheticPresentationForPatient` now has no production consumer — only the `index.ts`
  re-export and its own test — while still reading as a live guard.
- The reason-required refusal sentence is duplicated verbatim between `presentation-pages.tsx`
  and `prototype-state.ts`; two copies in two modules will drift.
- `presentation-pages.tsx` is 648 lines carrying two independent surfaces plus the amendment
  sheet. Brief-mandated grouping, so noted rather than charged.
- `effectivePresentation` re-filters the amendment array once for corrections and again per
  field, up to seven passes per timeline entry; same family as `AmendableRow`'s double call.
- **`portal={false}` on the amendment Sheet is Task 11's first look.** It is the one decision in
  this task that changes where focus containment lives, and with `css: false` no committed test
  can see its overlay, backdrop or focus trap.

**Task 8** — recorded rather than fixed.

- A failed print leaves **no trace at all** (Ruling 46). A later task should decide whether an
  attempt-that-failed deserves its own event, as a contact action's `email_intent_opened`
  records an attempt that is explicitly not evidence of delivery.
- `emptySections="omit"` applies uniformly to all seven keys including
  `professionalAndEmergencySupport`. That section is required unconditionally by the form and
  non-empty in every fixture, so it cannot vanish today — but a future data path bypassing form
  validation would silently drop those contact lines from the paper. Worth a defensive
  carve-out.
- The `Review currency unknown` branch is implemented correctly but unreachable from fixtures:
  the only `reviewDueAt: null` version is a draft, and drafts never render the review mark.
- `safety-plan-pages.tsx` combines the reading surface, the print surface and `CrisisContacts`
  at 564 lines. Task 5 split its two surfaces; Task 7 combined. Precedent exists either way and
  the shared `SafetyPlanSections` is a real reason to keep them together.
- Support-row keys and field ids remain index-based (`support-${index}`); pre-existing pattern,
  and the removal flow is test-covered.
- `key={item}` on list items matches the established pattern rather than being this task's to
  change.

**Stage A checkpoint** — found by the controller's own run, not by any task review.

- The Stage A test output is **not pristine**, and no task report mentioned it. Two warnings
  appear on every run: a React `act` warning from
  `keeps the typed search term across a navigation because the shell persists` ("A component
  suspended inside an `act` scope, but the `act` call was not awaited"), and a jsdom
  `Not implemented: navigation to another Document`. The repository's standing rule is that
  warnings in test output are findings and output should be pristine; both are test hygiene
  rather than product defects, but they are noise that could mask a real warning in Stage B.

**Task 4** — raised by the task reviewer and the fix-round re-reviewer, recorded rather than fixed.

- No one-searchbox assertion covers `/patients`, the other route where `routeOwnsSearch` is true.
  Home and the shell-owned routes each have one; a regression restoring the shell composer on
  `/patients` would be caught only incidentally.
- The after-hours telephone anchor is untested, so a swap to the duty URI survives — and it
  dispatches the same `call` intent as the duty control, so the recorded audit event cannot say
  which number was launched.
- The no-sort guard matches control _names_ (`/sort|rank|most|highest/i`, no combobox, no
  columnheader). A control named "Busiest first" passes. It killed the plausible mutation, so this
  is calibration rather than inertness, but asserting the rendered row order would be stronger.
- `carePlanPatientIdFromPathname` is a pure path parser living in `routable-suite.tsx` rather than
  beside `isSyntheticPatientId` in `routes.ts`, where every other address concern lives. Its
  `pathname.split("?")[0] ?? pathname` fallback is unreachable — `split` always returns one element.
- `ContentList` uses the bullet text as its React key, so two identical bullets in one section warn.
- Two differently worded synthetic markers appear on one screen: the shell's `Synthetic prototype —
fictional data only` and `SYNTHETIC_DATA_MARKER`'s `… fictional people, teams, and hospitals`.
- `keeps identity and currency facts visible` asserts `/verified/i`, which also matches
  `Not verified since …`, so it cannot tell a verified team from an unverified one.
- Draft-below-Current is proven by document order only; a CSS `order` or `grid-row` change could
  invert it visually with every assertion still green. Same family as the section-5 clipping hole
  that fix round 1 closed, and a candidate for the same static-stylesheet treatment.
- `lastOutcome` survives a cross-patient deep link. `select-patient` clears it, so the Home path is
  clean, but `/patients/A` → record an intent → address-bar to `/patients/B` never dispatches
  `select-patient`, and B's workspace shows A's notice. The message carries no identity, so the
  exposure is nil; the cost is the honesty of the chronology.
- The stylesheet guard's `declarationsOf` splits declaration bodies on a bare `;` and would
  mis-split a value containing an embedded semicolon such as a data URI; its `chunk.split("{")`
  destructure silently drops anything after a second `{` in one chunk. Neither is exercised today.
- The new clipping guards are text analysis, not CSS semantics: a `clip-path`, a
  `transform: scale(0)`, or a clipping rule on an ancestor would pass. The list covers what anyone
  would plausibly write; it is a list, not a proof.

---

## Systemic lessons — carry into every later dispatch

1. **Writing source through a shell layer corrupts it.** Three occurrences: twice `\b`
   regex escapes became literal backspace bytes, once 1,240 newlines became CRLF, which
   `.gitattributes` forbids. Write source with the editor tools, not Python or shell
   heredocs, and scan every touched file for CR and control bytes before committing.
2. **Guards that cannot fail.** Two shipped before being caught, both silently matching
   nothing. Any test whose job is to reject something needs a positive control proving it
   rejects a known-bad input, and should be proved by making the code wrongly permit the
   thing and watching the test go red. Task 2 adopted this and ran 32 mutations against
   32 red suites — that is the standard.
3. **Inaccurate reports cost a review round.** Task 1 reported a typecheck without its
   output; Task 2 claimed coverage that did not exist and miscounted its own tests. The
   report is the evidence a reviewer works from. Count from the run output, paste the
   decisive lines, and never claim coverage not written.
4. **Commit at the end of every task.** Three worktree destructions cost nothing
   committed and everything uncommitted — and by Task 4 the same habit had also absorbed
   run-coordinator refusals and three `529 Overloaded` provider outages mid-round.
5. **A guard can be unable to fail because of where it sits, not what it asserts.** Two of
   Task 4's guards were correct assertions that no mutation could kill. The section-5
   clipping guard read CSS-module class _names_, which Vitest resolves from a proxy whether
   or not the stylesheet defines a rule — proven by `styles.currentPlanCard`, a class that
   existed nowhere and that nothing noticed. The focus guards asserted final state in a
   component whose parent shell commits last and repairs whatever a descendant did. Both
   needed a different _kind_ of assertion — static analysis of the stylesheet, and
   `focusin` event ordering — not a stricter one. When a positive control survives, the
   instinct to tighten the assertion is usually wrong; ask first whether the test can
   observe the failure at all.
6. **A refused run can be scored as a mutation kill, and nearly was.** Task 5's implementer
   found `npm run typecheck` returning **exit 75** — `Database focused-test capacity is full`,
   another worktree holding the lease — and realised its first mutation harness would have
   counted that as the mutation being caught. Six controls had produced no `Tests` summary
   line. It re-ran each individually with a retry loop and confirmed all six failed on real
   named assertions, then made every reported run retry until it holds a lease. A mutation
   "killed" by a refused run is a guard that cannot fail wearing a new costume, and on this
   machine it will happen again: any run without a `Test Files` summary line is an
   acquisition failure and must be retried, never scored.
7. **Focus has no owner, and that is now an architectural debt.** Three focus defects in a
   row shared one cause: the shell is an ancestor, its effect lands last, and every
   descendant calls `focus()` independently. Nothing structurally prevents a fourth — the
   convention is held by three tests rather than by an invariant. The whole-branch review
   should consider a single focus owner that descendants request, rather than each surface
   claiming focus for itself.
8. **A generative assertion can never disagree with what it checks.** Task 8 found two of its
   own controls surviving, and both were this shape: a test comparing rendered text against the
   very constant the component renders from. "The declined label must not deny the plan exists"
   asserted against `PATIENT_CONFIRMATION_LABEL.declined`, which passes for _any_ label —
   including the defective one it was written to catch. The fix is a **literal** expectation:
   spell the forbidden phrasing out as a regex and apply it across every label and explanation.
   Structural presence-or-absence checks may read from the constant; content-quality checks
   never may. Nine guards that could not fail have now shipped here — but the last three were
   caught by implementers' own positive controls rather than by reviewers, which is the
   direction of travel worth keeping.
9. **Read the page as the person receiving it, not as the person who built it.** Task 8's worst
   defect broke no rule, failed no gate, and was invisible to 365 passing tests: a printed sheet
   handed to a patient reading `My reasons for living — Not recorded`. Every automated check
   this project has is a check on structure. The one class of harm it cannot see is a page that
   is technically correct and cruel to read. Before any patient-facing surface is called done,
   somebody must read it straight through as its recipient.
