# Development speed playbook

**Written 2026-08-27.** How to go faster in this repository **without weakening safety, quality,
gates, or the product**. Every mechanism here already exists; nothing below asks you to skip a
check, delete an assertion, loosen a test, or lower a tolerance.

> **The one rule.** Speed here comes from **not buying the same verdict twice**, and from **not
> starting work that is already done**. It never comes from checking less. If a suggestion below
> would reduce what you can honestly claim, it is being applied wrongly.

Companion documents, which this one does not duplicate:

| For                                                    | Read                                                      |
| ------------------------------------------------------ | --------------------------------------------------------- |
| Which gate to run, and proving it ran                  | `AGENTS.md` § verification pyramid, and the `gates` skill |
| Test execution, flake policy, the speed playbook table | `docs/testing.md`                                         |
| Measured CI cost per job, verification debt            | `docs/process-hardening.md`                               |
| What is outstanding across sessions                    | `docs/outstanding-issues.md`                              |

---

## 1. Check the state, not the narrative

**This is the largest single saving available, and it costs seconds.**

On 2026-08-27 a session was asked to resume Ward Flow Phase 5, fix a red `Build` check, and put a
bundle-budget decision to the owner. All three had already happened: PR #2390 merged twenty hours
earlier with every check green. The session read a handover document that said the work was
outstanding, and a local `origin/<branch>` ref it had not refreshed. Both were stale. The true
state was one API read away.

In the same session, a second instance: the handover's §9 prescribed running a flake experiment
"three times on a quiet tree, and three times on `origin/main`". That experiment had already been
run — **ten runs**, tabulated in a _different_ document (the Ward Flow complete ledger, §5d-ii — retired
2026-09-26, see git history at commit 8ec68fd32). The prescription was read; the result was not.

The pattern in both: **the stale instruction and the true record were in different documents, and
the stale one was the one being read.**

Before starting any resumed or handed-over task:

```bash
gh pr view <n> --json state,mergedAt,headRefOid   # state first. A merged PR ends the task.
git worktree list                                  # is this branch already checked out somewhere?
git log --oneline origin/main -3                   # is the local remote ref even current?
```

- **A document's account of its own status is a claim, not evidence.** Verify it against git and
  the PR before acting on it.
- **A stale source may not produce a confident claim.** Either refresh it — asking first where the
  provider-confirmation boundary requires it — or report the conclusion as unverified. Labelling a
  command "stale ref" and then stating its conclusion as fact is how the above happened.
- **`npm run check:base-freshness`** exists for the cheapest version of this. It is advisory, caps
  its fetch at 10 seconds, never exits non-zero, and prints nothing on a healthy base. It is
  registered as a SessionStart hook.

**When you finish work, correct the documents that would mislead the next session.** That is the
other half of this rule, and it is what this playbook's own PR did.

---

## 2. Do not buy the same verdict twice

`scripts/gate-receipts.mjs` memoises `lint`, `typecheck` and non-coverage Vitest against a content
signature, so an identical re-run on unchanged content exits immediately.

- `npm run receipts` inspects the store; `npm run receipts:clear` empties it.
- `GATE_RECEIPTS=refresh` forces a real run when fresh evidence is the point; `off` disables.
- **`build` and `coverage` are never memoised** — they produce `.next/` and `coverage/`, which
  later gates read. A skipped build leaves stale output.
- **Failures are never memoised**, nor is any run whose tree changed mid-flight.
- **Report a reuse as "reused receipt from `<time>`", never as a fresh run.**

---

## 3. Run the smallest gate that could actually fail

### 3.1 Narrow first, and know when narrowing is refused

```bash
npm run test:focused -- --files <paths>        # source-only iteration
npm run test:focused -- --dry-run              # shows what it would run
node scripts/run-vitest.mjs run tests/a.test.ts tests/b.test.ts   # explicit files, proper lease
npm run verify:pr-local -- --dry-run --files <paths>              # what a PR would select
npm run verify:phone-chrome -- --dry-run
```

`test:focused` **fails closed** — it refuses, with exit 2 and an explicit "run the full suite"
message, for deleted or missing paths and for any change under `tests/`, `scripts/`, `.github/`,
`package.json`, `package-lock.json`, `tsconfig*`, `vitest.config`, `next.config` or `eslint*`.
When it refuses, run the full suite; that refusal is the gate working.

When it refuses because you edited a **test file**, `scripts/run-vitest.mjs` still takes file
arguments and still takes the proper shared lease — that is the correct narrow path, not `npx
vitest`, which bypasses the coordinator and takes no lease at all.

### 3.2 Two traps in the selectors

- **`verify:pr-local` prints `completed` / `failed` / `not reached`.** A selected-but-not-executed
  step is not a pass.
- **`verify:phone-chrome` against a clean tree with no diff selects zero browser stages by
  design.** Use `--files` or `--full=always`, or you will read "nothing failed" as "something
  passed".

---

## 4. Do not pay for a worktree you already have

```bash
git worktree list                       # first. The branch may already be checked out.
npm run setup:codex-worktree -- --dry-run
npm run setup:codex-worktree
```

`scripts/setup-codex-worktree.mjs` reuses an existing installation instead of reinstalling, but
only under conditions strict enough to be safe: the donor worktree's `package-lock.json` must be
**byte-identical** by hash, and its installed tree must pass a full parity check — install-stamp
schema, every concrete package location, version-for-version metadata, and a tree inventory.
Otherwise it runs the locked install. `--dry-run` tells you which of the three it would do, with no
side effects.

Two things worth knowing:

- The `newtask` skill still prescribes `npm ci`. That is the slower path. On this machine a full
  install has been measured at roughly an hour.
- The donor copy deliberately excludes `.cache`, so a seeded worktree has no eslint cache, no
  `.tsbuildinfo`, and **no receipt store**. The first gates there run cold. That is correct, not a
  bug.

Also: **git refuses to check out a branch that another worktree already holds.** A resume
instruction that says `git checkout <branch>` will simply fail if that branch is live elsewhere.
Check first.

---

## 5. Browser proof is the expensive one — spend it deliberately

**`scripts/run-playwright.mjs` builds a full isolated production app on every invocation.** Observed
2026-08-27: `Building isolated production Playwright app (.next-playwright/<pid>-<ts>)` followed by
an optimized production build, which on a loaded machine took roughly nine minutes — far longer than
the tests themselves.

The consequence is direct: **looping the script N times pays N production builds.**

- For repeat runs of the _same_ spec, use Playwright's own `--repeat-each=N` in **one** invocation,
  so the build is paid once. State the caveat honestly rather than hiding it: `--repeat-each`
  reuses worker state within one process, so it is **not identical evidence to N cold runs** for an
  order-dependence or state-leak hypothesis. Use it to _find_ a flake cheaply; use cold runs only
  when the hypothesis is specifically about cross-run state.
- For several stages in one session, `PLAYWRIGHT_BUILD_ROOT_ID=<id>` plus
  `PLAYWRIGHT_KEEP_BUILD_ROOT=true` reuses the webpack cache across invocations. **It does not skip
  the build** — `docs/testing.md` is explicit about that.
- **Delegating browser proof to CI's Production UI lane is always legitimate** when
  `check:installed-lock-parity` or `check:playwright-browser-revision` reports Chromium drift. Do
  not force a mismatched browser path: a browser gate against the wrong revision is not evidence.

**Read the exit status _and_ the decisive output line — neither alone is enough.**
`scripts/run-playwright.mjs` does propagate a failure: it exits **75** with a
`DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker when the coordinator refuses admission, propagates
Playwright'"'"'s own exit status when tests fail, and exits 1 on a wrapper error. The status is a real
signal and must not be discarded — **75 means blocked, retry later; any other non-zero means red.**
Verified by reading `scripts/run-playwright.mjs` on 2026-08-27.

The output line still matters, for a different reason: a run can exit 0 having produced no "N
passed" line at all, which proves nothing was actually verified. Observed here on 2026-08-27, where
an invocation held the exclusive lock for nine minutes, wrote no result record and printed nothing.
**Use the status to tell blocked from red; use the "N passed" line to tell passed from never-ran.**

(Older guidance in this repository previously said this wrapper "exits 0 when tests fail and when it
refuses to run". That is **not true** of the script, and repeating it throws away a reliable
signal. Corrected in PR #2405 and pinned against regression in `AGENTS.md` and this file by
`tests/playwright-exit-code-contract.test.ts`.)

**Never pipe a long run through a bare `tail`.** `node script.mjs | tail -30` buffers everything
until the process exits, so a slow run and a hung run look identical — and because a pipeline's
status is its **last** command's, `... | tail` reports `tail`'s success and discards the very exit
code the previous point says you must read. Use `| tee full.log | grep -E --line-buffered "<terminal signals>"`,
and make the filter match failure signatures as well as success ones.

---

## 6. Formatting: check narrow, write wide

- `npm run format:changed` checks only the changed files, and **escalates to the whole tree by
  itself** when a Prettier policy file changed (`.prettierrc*`, `prettier.config.*`,
  `.prettierignore`, `.editorconfig`, or a `package.json` carrying a `prettier` field) — because a
  policy change re-decides the verdict for files the push never touched.
- **There is no changed-files-only `--write`.** Fixing formatting is whole-tree `npm run format`,
  which has been measured past seven minutes and past tool timeouts. Background it, and check
  changed files in the foreground.
- **Formatting is in none of `test`, `typecheck` or `lint`.** Run it _and commit the result_ — a
  push sends commits, not your working tree.
- The pre-push guard checks the **pushed commit**, not your working copy, in a scratch worktree. A
  formatted working tree cannot vouch for an unformatted commit.

---

## 7. Some measurements do not need a rebuild

**A baseline set to the measured value passes by arithmetic.** `check-bundle-budget.mjs` computes
`(current − baseline) / baseline`, so `baseline == measurement` is exactly 0% over. When a change
sets a threshold _to_ a number that was measured, verify the arithmetic instead of re-running the
measurement. On 2026-08-27 that turned "rebuild twice to confirm" into one line of arithmetic, with
no loss of certainty.

The matching trap, and it is severe:

- **`check:bundle-budget` has no `.next` freshness detection at all.** A stale but structurally
  complete `.next` sails through and reports old numbers as current. `rm -rf .next` before any real
  measurement, and sanity-check `.next/BUILD_ID`'s mtime against the current commit.
- `--update` rewrites **every** baseline, production included. To move one bucket, edit that one
  key by hand.

---

## 8. The shared lock is a queue, not a failure

Admission is coordinated across **every worktree of this repo**. Two shared leases (fail-closed
focused Vitest and read-only typechecks), one at a time per worktree; everything else — full
Vitest, coverage, lint, build, Playwright — is exclusive.

- A refusal reads `Database focused-test capacity is full (current owner PID …, worktree …)` or
  `Another Database heavyweight command is active (…)`. **Recognise the wording, not the exit
  code.** `run-heavy.mjs` and `run-playwright.mjs` emit a structured
  `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker and exit 75; `run-vitest.mjs` does **not** — there,
  contention surfaces as an uncaught error carrying the busy prose.
- The state is readable, which beats guessing:
  `%TEMP%/clinical-kb-heavy-locks/<hash>.lock/{owner.json,leases/,queue/}`. `owner.json` names the
  holding command, worktree and pid, and its mtime is a heartbeat — that distinguishes "queued",
  "running slowly" and "dead holder" in seconds.
- **Do not delete or bypass coordinator state**, and do not install while a lease is held.
- The single biggest thing that makes other sessions wait is one session holding a broader gate than
  its change needs. Narrowing is a courtesy to everyone else, not only to yourself.
- If work becomes redundant while it holds an exclusive lease, **stop it**. Finishing a settled
  question while another session queues behind you is pure waste.

---

## 9. What makes a CI run cheap

`scripts/ci-change-scope.mjs` classifies the diff and CI routes jobs from it. Recognised
documentation and non-executable workflow/policy paths run a focused route; **executable, mixed or
unrecognised paths fail closed to heavy scope**, and `coverage_changed` simply equals
`static_heavy_changed`.

Genuinely cheap shapes, per `docs/process-hardening.md`:

- **Docs-only** changes run in 3–5.5 minutes.
- **Non-executable workflow/policy YAML** gets the workflow self-tests and a focused
  `test:ci-workflows` instead of the full coverage lane.
- **Non-UI source** skips the Production UI lane, which is 83–89% of CI wall clock.
- **Mockup-free UI** skips the Advisory UI lane.

Note the sharp edge: a `.mjs` helper inside an otherwise "light" policy directory is executable, so
it stays heavy. That is deliberate.

**Do not push mid-CI.** PR runs cancel in progress, so a second push cancels and restarts rather
than saving anything. Measured across 437 PR-triggered runs, about 40% were cancellations, mostly
superseded mid-Production-UI. Assemble every commit before the first push, or wait for the run to
settle. (Base-branch pushes are deliberately exempt from cancellation — a merged commit cannot be
superseded, and cancelling there destroys the only verification `main` receives.)

---

## 10. Parallelism: read wide, write narrow

Fanning out **read-only** agents is close to free and has no shared-state risk. Fanning out writers
does not: a controller that runs `git add -A` while a helper is mid-edit commits that helper's
in-flight work under its own message. This repo has hit that.

- Use read-only agents for sweeps, verification and research; they physically cannot corrupt a
  commit.
- Give writers isolated worktrees, or stage explicit paths — **never `git add -A`** while anything
  else shares the tree.
- **Never run tests while an agent is editing source.** The dev server rebuilds on change, and a run
  against a half-swapped page produces failures that are not real.

---

## 11. Levers already measured and refuted — do not revive

Re-litigating these is itself a cost. From `docs/testing.md` and `docs/process-hardening.md`:

- A persistent Actions cache for the Next webpack tree (~804 MB; evicts the browser cache).
- Transporting the 1.09 GB webpack cache to shard runners (19–67 s download, slower than a cold
  build).
- Rebalancing or renaming Playwright shards; `N=5`/`N=8` produce empty shards, which go red.
- Playwright `workers > 1`, or blocking retries.
- Dropping Production UI from UI PRs; running Firefox/WebKit per PR.
- Lowering production tap targets to `min-h-11` for a generic accessibility rule — it reintroduces a
  known `ui-smoke` flake.

---

## 12. What must never be traded for speed

Non-negotiable, and none of the above touches them:

1. **No gate skipped, no assertion deleted, no test loosened, no tolerance lowered** to make
   something pass. If a change would reduce what can honestly be claimed, do not make it — say so.
2. **Evidence is never compressed.** Paste the decisive line. Exit code 0 alone is not proof.
3. **Mutation-test every new test** — break what it guards, watch it go red, restore.
4. **Green tests are not proof the screen is right.** Four real defects in Ward Flow Phase 5 were
   caught only by looking at the rendered screen at 390 / 820 / 1440.
5. **Provider-backed gates stay behind explicit approval** — `verify:release`, `eval:*`,
   `check:supabase-project`, `test:live`.
6. **CI stays the authority.** Receipts are disabled outright when `CI` is set, and
   `check:gate-manifest` enforces that CI never runs less of the local static set than the local
   chain does. Nothing local can weaken a required check, and nothing here tries to.
