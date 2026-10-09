---
name: gates
description: Pick the smallest correct verification gate for a change in this repo, and prove it actually ran before calling it green. Use before running any `npm run verify:*` or `check:*` command, before reporting a gate as passing, when a gate finishes suspiciously fast or clean, and before trusting any agent or bot claim that a fix landed.
---

# gates — prove it ran, then report it

A green exit code is not proof. Contended gates can wait a long time before failing, early stops
leave later checks unrun, and a stale worktree makes healthy-looking runs meaningless. This skill
exists because those failures have cost real time more than once.

**Rule: never report a gate as passing without quoting the decisive line that proves it ran. Pick
one smallest sufficient gate first; do not stack broad gates unless each covers a distinct plausible
failure path.**

## The false-green traps

Check these before believing any result.

- **`verify:ui` under heavy-lock contention waits, then fails — it does not soft-skip green.** When
  another worktree holds the exclusive lease, `acquireHeavyRunLock` queues Playwright admission for
  up to 15 minutes and throws on timeout; `run-playwright.mjs` catches that error and exits `1`. Do
  not treat a long wait or a red contention timeout as a false-green soft-skip. When the gate does
  run, grep the output for the `N passed` line — exit `0` alone is never proof.
- **A stale worktree makes every downstream gate a lie.** `check:installed-lock-parity` fails closed
  for exactly this reason — if installed packages do not match `package-lock.json`, treat any test,
  lint, or typecheck result as void until `npm ci` has run. Its own failure message says as much.
- **`verify:full` stops at the first failing check.** Everything after that point never ran. Do not
  describe the change as broadly verified when the gate died at check 2 of 45.
- **Changed-file formatting is required in CI but is part of neither gate.** A locally green
  `verify:cheap` can still fail CI on formatting. During iteration, format only task-owned files.
  Before a push, follow `AGENTS.md`: from an isolated or otherwise fully owned worktree run
  `npm run format`, review the complete formatter diff, and commit it. Never sweep a shared dirty
  checkout that contains another task's work.
- **Piping a gate into `tail` or `head` masks its exit code.** In Bash, capture `${PIPESTATUS[0]}`,
  or check the exit status before piping.

## Pick the smallest gate that can fail

Match the gate to what actually changed. Running a broader gate is not more rigorous if it cannot
observe the change; running a narrower one is not sloppy if it can. Add a second gate only when it
covers a distinct plausible regression and the incremental confidence justifies its cost.

| Change                      | Gate that can actually fail                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| Markdown / docs only        | `prettier --check`, `docs:check-links`, `docs:check-index`                                          |
| Localised source behavior   | `test:focused -- --files <paths>`                                                                   |
| Ordinary pre-PR check       | `verify:cheap` — lock parity + lint + typecheck + unit tests                                        |
| Cross-module/unknown scope  | `verify:full` — 42 static gates then lint + typecheck + test (does not invoke cheap; check 2 of 45) |
| Before PR handoff           | `verify:pr-local` (risk-routed; inspect with `--dry-run`)                                           |
| UI, styling, routing, a11y  | `npm run ensure`, affected journey, broad UI only when shared                                       |
| Phone chrome                | `verify:phone-chrome` (narrower than `verify:ui`; run it first)                                     |
| Explicit release confidence | `verify:release` (provider approval still required)                                                 |

`lint`, `typecheck`, and `test` cannot observe a markdown-only change. Say so rather than running
them for appearance.

## Before any heavy run or install

The repository run coordinator serialises heavy work across worktrees. Leases live at
`<os.tmpdir()>/clinical-kb-heavy-locks/<repoId>.lock/leases/`; each holds an `owner.json` with pid,
mode, and command.

- An **exclusive** lease means full Vitest, coverage, lint, build, Playwright, or live-provider work
  is running. Do not install and do not start another heavy gate.
- Never `npm ci` or `npm install` while any repository test, build, lint, typecheck, or server
  command is active — including in another worktree.
- Never kill a lease-holding process that belongs to another worktree or another agent's session.
- Check the lease directory rather than scanning the repo tree; ~40 worktrees make recursive scans
  slow and noisy. Do not print raw process command lines.

## Provider boundary

Never run provider-backed gates without explicit user confirmation: `eval:rag`, `eval:quality`,
`eval:retrieval:quality`, `verify:release`, `check:supabase-project`, `test:live`, and any GitHub,
Supabase, OpenAI, or hosted-CI call. Report the command and ask instead of running it.

The only standing exception is the user typing `Run PR`, and that authorises only the GitHub actions
enumerated in the `run-pr` skill, for that sweep alone.

## Third-party claims are not evidence

A bot or agent saying it fixed something is a claim, not a result.

- Verify against the actual ref content before repeating it as fact. Prefer refs already available
  locally (`git log`, `git show`); fetching from the remote is a network action subject to the
  provider boundary above.
- A squash merge breaks ancestry. `git merge-base --is-ancestor` returning false does **not** mean
  the work is missing — compare file content on `origin/main` instead.
- Absence of evidence in one place is not proof. Grepping `.github/workflows` for `auto-merge`
  returns nothing even though GitHub's per-PR auto-merge is in active use here, because that setting
  is not a workflow file.

## Reporting

State what ran, what passed, and what never ran.

- Paste the decisive line: `42 passed`, `docs link check passed: 1287 …`, not "gate green".
- Name the gates that were skipped and why.
- Separate verified from assumed. If a claim came from memory or a prior session rather than this
  run, say so.
- Never let output-style compression drop this section. Brevity applies to prose, never to proof.
