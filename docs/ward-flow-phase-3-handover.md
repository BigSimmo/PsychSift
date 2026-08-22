# Ward Flow Phase 3 — session handover

Refreshed 2026-08-22, with Tasks 1 to 6A complete and Tasks 7 to 12 outstanding, and the
branch now pushed to GitHub. Everything a fresh session needs to continue with full context. Read this
file first, then `docs/ward-flow-phase-3-ledger.md`, then the plan.

---

## 1. Where the work is

**The work is NOT in `D:\Repos\Database`.** It lives in a separate Codex worktree:

| What             | Where                                                             |
| ---------------- | ----------------------------------------------------------------- |
| Worktree         | `C:\Users\joshs\.codex\worktrees\ward-management-design\Database` |
| Branch           | `codex/ward-management-design`                                    |
| HEAD at handover | see `git rev-parse --short HEAD` — pushed and in sync with origin |
| State            | Clean tree, **72 commits ahead of `origin/main`, pushed**         |
| Dev server       | `npm run ensure` → prints the URL. Never assume a port.           |

**The branch is now on GitHub** at `origin/codex/ward-management-design`, pushed 2026-08-22 at the
user's explicit request, which supersedes the earlier "no push" instruction. **No PR exists and
none should be opened** — that part of the instruction stands. The work is no longer only on this
machine.

## 2. The documents that carry the context

| Document                                                                     | Committed | Purpose                                                                                   |
| ---------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `docs/superpowers/specs/2026-08-19-ward-flow-phase-3-role-screens-design.md` | yes       | **The binding authority.** 19 sections. Every conflict resolves against this.             |
| `docs/superpowers/plans/2026-08-19-ward-flow-phase-3-role-screens.md`        | yes       | 12 tasks with the exact test code for each. Corrected in several places during execution. |
| `docs/ward-flow-phase-3-ledger.md`                                           | yes       | The execution record: every task's commits, every ruling, what was verified and how.      |
| `docs/ward-flow-context.md`                                                  | yes       | Cold-start orientation for the whole project, Phases 1 to 3.                              |

**The live ledger is `.superpowers/sdd/2026-08-19-ward-flow-phase-3-role-screens/progress.md`,
and that whole directory is gitignored.** It does not travel with a clone or a push.
`docs/ward-flow-phase-3-ledger.md` is a committed copy refreshed at each handover. A continuing
session keeps appending to the `.superpowers` copy — the skill's scripts expect it there — and
re-copies to `docs/` at the next handover.

That directory also holds, all gitignored and all verified present at this handover: a brief for
every task (1 to 6, 6A, 7 to 12), implementer reports for 1 to 6 and 6A, reviews and re-reviews, a
Task 7 controller addendum, and eleven review diffs. Roughly 800 KB. Useful but reconstructible —
briefs regenerate from the plan with `scripts/task-brief`, diffs regenerate from git.

## 3. State — what is done and what is next

**Tasks 1 to 6A are complete**: implemented, reviewed, every finding fixed, every fix verified
independently by the controller rather than accepted on report.

| Task                             | State                             | Commits                                       |
| -------------------------------- | --------------------------------- | --------------------------------------------- |
| 1 — model and fixture            | complete                          | `f3b1f74f0`, `39042cd61`, `2d59219d0`         |
| 2 — the reducer                  | complete                          | `3b76b093e`, `e7faa7b5a`                      |
| 3 — the contracts                | complete                          | `f01a4f8f3`, `cbdd47f71` (+ plan `e2b72a300`) |
| 4 — provider, clock, layout      | complete                          | `0612fdfa0`, `9ae334230`                      |
| 5 — coordinator rewire           | complete                          | `4d36099ca`, `868853b58`                      |
| 6 — the other nine routes        | complete, **5 fix rounds**        | `af90428ce` … `f4963f28a`                     |
| 6A — the ED clock counts up      | complete, 2 fix rounds            | `2d8200a09`, `f1e32dcd4`, `496039d87`         |
| 7 — coordinator phone pin        | **next — brief + addendum ready** | —                                             |
| 8 — the ward screen              | not started                       | —                                             |
| 9 — transport officer phone      | not started                       | —                                             |
| 10 — live tracker                | not started                       | —                                             |
| 11 — emergency department screen | not started                       | —                                             |
| 12 — role switcher + journey     | not started                       | —                                             |

**Task 7 is dispatch-ready.** Its brief was written before Tasks 6 and 6A landed and its test code
no longer holds, so a controller addendum at `.superpowers/sdd/.../task-7-addendum.md` carries
four corrections (rulings R24 to R27) and **takes precedence over the brief where they differ**.
Read both.

## 4. The clinical question that was answered, and what it changed

The phase carried a standing open question: when a patient is examined in the emergency department
and ordered to an inpatient bed, what should the on-screen countdown represent?

**The clinician answered, verbatim:**

> "It is just counting how long they have been in ED determining priority. So counting up."

So there is **no post-examination deadline**. The prototype had been rendering one — a Form 3B
carrying a `dueAt` derived from `examination.at + 240`, which seven surfaces displayed as statutory
timing and counted as a legal breach. That is the worst defect class this project has: a clinical
surface stating something the law does not impose.

Task 6A deleted it. Two things must be carried forward:

- **The four hours were real; they were attached to the wrong quantity.** Spec §7 requires the
  **emergency department access target** — a departmental performance measure counted up from
  `openedAt`, "the number a department is judged on, and mental health patients are its largest
  breachers". It now lives as `ED_ACCESS_TARGET_MINUTES`, quarantined from `LegalForm`.
  **Task 11 is its only consumer and must render it against `openedAt`, never as a legal clock.**
- **`LegalForm.dueAt` is now optional.** A Form 1A always carries its statutory examination window;
  a Form 3B carries none. Absence is rendered explicitly everywhere, and an absent `dueAt` reaching
  arithmetic is now a **compile error**, not merely a convention.

Confirmed on the running app: the coordinator page contains the string "3B" zero times and "due in"
zero times, and all four remaining breach lines are genuine Form 1A examination breaches.
Screenshot: `artifacts/ward-management/phase3-6a-coordinator.png`.

## 5. Open with the user — three assumptions, none confirmed

State these rather than bury them. Each was put to the user; none has been answered.

1. **The Form 1A countdown stays a countdown.** His answer was scoped to the post-examination case.
   The pre-examination examination window is still modelled as a deadline.
2. **Being detained and examined confers no priority bonus of its own.** Such a patient's priority
   now rides purely on elapsed time, exactly as he described. The practical effect is that patients
   still awaiting examination tend to rank above them.
3. **Four hours is the correct ED access target for WA metro.** It is the national figure; it has
   not been confirmed for this context. One constant, one screen — trivial to change.

A fourth, raised but not decided: **the demo now leads with an accident.** The top of the
coordinator queue is `WF-303`, a _generated_ movement whose breach comes from
`NOW_ANCHOR + (((index * 53) % 400) - 60)` in `routineMovements` — arithmetic, not authorship.
Nothing in the fixture says so, and Task 12's guided journey may walk a user straight into it.
Worth deciding whether the demo should lead with a deliberately authored case.

## 6. How the user wants this run

Standing instructions, carried from Phase 2 and reaffirmed this session. They are not optional and
they are why this phase has found what it has found.

- **Verify every claim a subagent makes.** Re-run the typecheck and the suites yourself after every
  task. Never accept a pasted number. Phase 2's worst defects all passed their own tests, and this
  session caught an implementer report asserting a fixture check it had never run.
- **Mutation-test; do not trust green.** For each new test, make the single change that should kill
  it, **print the edited line back from the file**, run, watch it fail, revert. Mutations have
  silently failed to apply repeatedly; each near-miss nearly became a recorded false negative.
- **Read gate output, never exit codes.** Several commands here exit 0 without running.
- **Run the browser gate after any task touching the fixture, the reducer, or a screen** — not only
  screen tasks.
- **Send the user screenshots on every screen task** and say what to look at. Look at the screen
  yourself, not only at test output.
- **Do not run `verify:ui`, `verify:release`, or any provider-backed gate.**
- **Rule, do not stall.** Decide ambiguities and plan defects yourself, record each ruling with what
  it costs if wrong, and keep going. Stop only for something irreversible, destructive,
  security-sensitive, or a plan so broken every path forward is a guess. **The full ruling list is
  owed to the user at the end of the phase.**
- **Work in this worktree on this branch. No new branch, no PR.** Pushing to
  `origin/codex/ward-management-design` is now authorised — but read the push warning in §8 first.
- **Talk to the user in plain English.** He is a psychiatrist, not a software engineer. Lead with
  the answer, numbered steps for anything he must do, no jargon, no file paths unless they change
  his decision. Full style rules in `C:\Users\joshs\.claude\CLAUDE.md`.

## 7. Verification — the current baselines

Measured by the controller on 2026-08-22 at HEAD, after a full `npm ci --include=dev`, not taken
from a report:

| Gate                                           | Result                   |
| ---------------------------------------------- | ------------------------ |
| `npx tsc --noEmit -p tsconfig.json`            | **clean**                |
| Node-environment suites (10 files)             | **118 passed**           |
| jsdom suites (3 files, **one per invocation**) | **6 passed** (1 + 4 + 1) |
| Ward Chromium journeys                         | **24 passed**            |

```bash
npx vitest run tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-flow-single-source.test.ts tests/ward-clock.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts tests/ward-derivations.test.ts tests/ward-management.test.ts
```

```bash
PLAYWRIGHT_BASE_URL=<url from npm run ensure> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
```

**The browser gate is verified at HEAD: 24 passed (3.9 min).** It took two runs to get there
and the first one is worth knowing about. After a fresh `npm ci` the dev server rebuilds cold, and
this project's dev config pins `cpus: 1`, so it took **~16 minutes** to become ready — far longer
than `npm run ensure` waits before declaring failure. The first gate run then came back
**23 passed, 1 failed**, and the failure was `ui-ward-management.spec.ts:54 "opens every Ward Flow
mode"` — the one test that visits every route, so the one paying first-compile cost on each.

It was confirmed as a cold-start artefact rather than assumed: re-run alone it passed in 43 s, and
the full gate re-run warm passed **24/24**. If you see that single test fail on a cold server,
warm the routes and re-run before believing it.

**Do NOT run `npx vitest run tests/guard-push.test.ts`** — see the first environment trap below.

## 8. Environment traps — all hit for real, all cost time

- **`node_modules` gets emptied to ZERO entries — twice on 2026-08-22, cause UNCONFIRMED.**
  This is the most disruptive thing on this machine and the most deceptive. **The symptom is not a
  dependency error.** It is `tsc` reporting it cannot find `process`, and 8 of 10 unrelated test
  files failing at once — which reads exactly like a code regression and is not one. Recovery is
  `npm ci --include=dev`, roughly 7 minutes.

  **First check when any broad, unexplained failure appears: `ls node_modules | wc -l`.** Before
  reading a single line of code.

  What correlates, from two occurrences: the first followed `git push`; the second followed
  `npx vitest run tests/guard-push.test.ts`. Both exercise `scripts/guard-push.mjs`, whose format
  guard links a real dependency tree into a scratch checkout as a Windows junction and then
  force-deletes the checkout. **Treat both as unsafe on this branch. Do not run the guard-push
  test suite.** The ward suites, `tsc`, and the browser gate were all re-run afterwards and left
  `node_modules` intact at 523 entries, so they are not implicated.

  **The mechanism is a hypothesis, not a finding, and an earlier draft of this file wrongly stated
  it as fact.** Both candidate force-deletes were probed directly here and **neither destroyed the
  junction's target**: Node's recursive `rmSync` did not follow the junction, nor did
  `git worktree remove --force`. A live alternative is that `findPrettierBin` deliberately borrows
  _another_ worktree's tree when this checkout has none, and this repo has dozens of siblings.

  **Strongest explanation, found 2026-08-22 by inspecting what was actually running.** At the
  moment of writing, PID 22400 was `D:/Worktrees/Database/care-plan-impl/scripts/guard-push.mjs`
  — **a different worktree running its own push guard.** `findPrettierBin` in that script
  deliberately borrows _another_ worktree's real `node_modules` when its own checkout has none,
  and this machine has dozens of sibling worktrees. That fits every fact the earlier theory could
  not: why isolated probes here never reproduced the damage (the destroyer was in another
  worktree), and why it happened a second time when this session did not push at all.

  **The practical consequence: any session pushing from any worktree can empty this one's
  `node_modules`.** It is not something this branch can fully defend against alone, and it is not
  caused by anything in the ward-flow code. Treat it as ambient, check for it early, and recover
  with `npm ci --include=dev`.

  **Do not hand-write a fix for this.** One was written and reverted: a mutation reintroducing the
  supposed bug on purpose failed no test at all, proving the fix was untestable against an unknown
  mechanism. The reviewed fix exists upstream at `a04330ea0` (PR #2244), which is **not** an
  ancestor of this branch. Bringing `main` in is the correct route and is the user's call.

- **The vitest worker pool is unreliable under load.** Six recorded occurrences of a run reporting
  `Test Files no tests / Tests no tests`, or a truncated file count, **at exit code 0**, on suites
  that pass on an immediate re-run. `VITEST_MAX_WORKERS=1` does not help. **Run jsdom
  `.dom.test.tsx` files one per invocation and read the counts.** The count is the evidence, never
  the word "passed". This is the most dangerous trap here: it makes a check that never ran look
  like a check that passed.
- **Do not mix jsdom and node-environment suites in one invocation.** Two of seven files silently
  fail to start.
- **The Browser pane cannot composite frames in this environment.** Three agents and the controller
  hit it independently; `mcp__Claude_Browser__` screenshots time out. **Drive headless Chromium
  directly instead** — place the script inside the repo (`artifacts/` is gitignored) so it resolves
  `playwright`. The working recipe is in `task-7-addendum.md` §R27.
- **`.next/dev/types/validator.ts` goes corrupt** when the dev server is killed mid-write, turning
  `tsc` red for no source reason. Delete it and re-run.
- **`npm run ensure` can time out on a cold start under load** — the server took 94 s to become
  ready once. Check `dev-server.log` for `✓ Ready` before assuming it failed.
- **`git commit` can exceed two minutes** on the pre-commit documentation-sync hook. Retry with a
  longer timeout rather than assuming a lock.
- **`npm run lint` exits 0 without running** when the repo lock is held; it prints
  `DATABASE_HEAVY_RUN_ADMISSION_BUSY`.
- **`npm run format` can hang for minutes.** Use `npx prettier --write <files>`.
- **A Playwright `page.goto()` re-mounts the provider and resets all state.** Any test asserting the
  effect of a dispatch must stay on the same page and navigate by clicking.
- **Never `git checkout --` a file with uncommitted changes without backing it up first.** That
  destroyed a completed fix round this session; it was recovered only because the diff was still in
  context and could be re-applied as a git-verified patch.
- **The machine can run out of memory after hours of agent work.** Measured at this handover:
  1.3 GB free of 32 GB, with 45 `claude` processes holding 7 GB. The symptom is not an error — it
  is everything getting slow, then the dev server failing to become ready, then a Playwright run
  aborting as `N did not run` at exit 0. If gates start behaving strangely late in a session,
  check free memory before debugging the code.
- **A hard usage ceiling killed two agents mid-work.** Both left recoverable state. If an agent
  dies, inspect the working tree before re-dispatching — the work may be complete and uncommitted.

## 9. What has repeatedly gone wrong, and the lesson

Three of Task 6's five fix rounds went to a single static guard — the one asserting that no screen
reads the frozen epoch `NOW_ANCHOR` instead of the live clock. It overclaimed in three successive
forms, each found by someone deliberately trying to defeat it rather than by running it:

1. **Co-occurrence scoping** — flagged a file only if it both called `useWardFlow()` and
   named-imported `NOW_ANCHOR`. Helper indirection, namespace imports, and any component outside
   the rule all walked past.
2. **Directory scoping** — rebuilt as a named allow-list, but walking one directory while its test
   name claimed "every read".
3. **A hand-rolled scanner** — stripped comments and strings character by character with no concept
   of a regex literal, so a quote inside a regex desynced it and blinded it to the rest of the file.

It is now a substring pre-filter plus a real TypeScript-parser walk. The same pattern recurred a
fourth time with the `ED_ACCESS_TARGET_MINUTES` quarantine, where the answer was different:
**narrow the claim rather than chase completeness**, and move real enforcement into the brief and
review for the one task that will exercise it.

**The lesson, and it is the phase's most important finding: a check that claims more than it
delivers is worse than no check, because it stops anyone looking harder.** Name a guard for what it
actually does.

## 10. Resuming — the opening move

1. Confirm you are in `C:\Users\joshs\.codex\worktrees\ward-management-design\Database` on
   `codex/ward-management-design`, that `git status` is clean, and that local and `origin/codex/ward-management-design` agree.
2. Read `docs/ward-flow-phase-3-ledger.md` in full. It is the recovery map — the commits it names
   exist in git even when nothing else remembers them.
3. Invoke `superpowers:subagent-driven-development` with the plan file. It will find the live ledger
   and resume. **Do not re-dispatch Tasks 1 to 6A**, which are recorded complete.
4. Dispatch **Task 7** from its brief **plus the addendum**, verify it yourself, send the user the
   phone screenshot, then continue through Tasks 8 to 12.
5. **Before dispatching each remaining task, scan its brief against the branch as it now stands.**
   Every brief was extracted before Tasks 6 and 6A landed. Task 7's needed four corrections;
   Task 11's needed one that would otherwise have deleted a feature the spec requires.
