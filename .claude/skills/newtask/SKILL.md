---
name: newtask
description: Bootstrap a clean session for new work in this repo — create a fresh git worktree off the latest origin/main, install deps, warm routes, and confirm the base is current. Use at the start of a task when you want an isolated, up-to-date working copy and want to avoid the stale-base, cold-worktree, and reserved-port traps this repo is prone to.
---

# newtask — start a clean, current working copy

This repo moves fast and shares ~50 worktrees and one stash stack, so starting work on a
stale base or a cold worktree is the default failure. This skill sets up an isolated,
current worktree so new work starts clean. That count is not stable trivia — it was 48 on
2026-08-18 and reached 50 during a single session, because nothing reclaims a worktree
whose branch has landed. See the cleanup note at the end.

## Before you start

Check whether this task can ride an already-open PR you own or bundle with other queued
low-risk work instead of minting a new branch — see AGENTS.md "PR bundling (reduce
one-task-one-PR churn)". Only proceed to the steps below (which create a new branch and
worktree) once bundling doesn't apply: the work isn't independently low-risk by that
rule's test, or there's no suitable open PR to ride.

**Ask that same open-PR list a second question: is someone already building this?** Some
ledger rows carry a progress marker in their prose (`IN PROGRESS`, `IMPLEMENTED in PR
#1766`), but there is no structured status field and no atomic claim — a marker is written
by whoever did the work, usually after the fact, and nothing requires or checks one, so its
absence means nothing. Two sessions can read the same queued `/issues` item and both build
it. That is not hypothetical — on
2026-08-09 two assistants took the same queued item about four hours apart and shipped the
same conversion twice (PR #1766, and PR #1767 closed as a duplicate), which also left two
divergent shapes to adjudicate afterwards. Before starting a queued item, scan the open PRs
for the **route, component, or surface** it touches, not just for a matching ledger id — the
duplicate PR will rarely quote the id. If you find one, stop and reconcile with it rather
than opening a second branch. This is one GitHub read (`mcp__github__list_pull_requests`, or
`gh pr list` where available) and it falls inside the existing provider-confirmation
boundary. If GitHub is unreachable, treat it as a warning and continue — an offline session
must still be able to start work. Recorded as `#292`.

**If the PR-handoff stop hook has already armed in this session, that read is denied** — a
session that opened its own PR and then picks up another queued item cannot call
`list_pull_requests` or `gh pr list` at all (see `docs/pr-handoff-stop-cross-agent-gap.md`).
Do not unlock the hook for this; fall back to `git ls-remote --heads origin`, which needs no
provider tool and still answers the question, because a session building the same surface
almost always has a pushed branch named after it. Report which check you used. Observed
2026-08-14 on PR #1956.

## Steps

1. **Sync main.** `git fetch --quiet origin main`.
2. **Create an isolated worktree** off the latest main (never reuse another session's
   checkout, and never switch the main checkout's branch). Put it under the project's
   own worktree root on the **D: Dev Drive**, which is where every Claude Code worktree
   already lives — not `../wt-<slug>`, which lands outside the project tree, and never
   under `C:\Users\…`:

   ```bash
   git worktree add -b claude/<task-slug> D:/Repos/PsychSift/.claude/worktrees/<task-slug> origin/main
   ```

   Use a short, descriptive `<task-slug>`.

   **Check free space first — this is a real constraint, not a formality.** `D:` is a
   50 GB ReFS Dev Drive that was 51% full on 2026-08-18, and each worktree's
   `node_modules` costs ~0.9 GB (measured 51,735 files / 0.89 GB). ReFS supports
   hardlinks, but npm extracts fresh copies rather than linking from the cache, so
   nothing is shared:

   ```bash
   df -h /d | tail -1
   ```

   Under ~5 GB free, reclaim space before starting: `node scripts/clean-worktree.mjs --merged`
   lists worktrees whose branch already landed. Worktrees under `C:\Users\joshs\.codex\`
   and `C:\Users\joshs\.gemini\` belong to Codex and Antigravity sessions — leave them
   alone and do not count them.

3. **Install deps in the new worktree** (a cold worktree fails `vitest`/`tsc`). Prefer
   `node scripts/setup-codex-worktree.mjs`, which reuses a byte-identical donor `node_modules`
   before falling back to `npm ci --include=dev --prefer-offline --no-audit --no-fund`:

   ```bash
   cd D:/Repos/PsychSift/.claude/worktrees/<task-slug>
   node scripts/setup-codex-worktree.mjs
   ```

   **Fallback — direct install when the setup helper cannot be used:**

   ```bash
   npm ci --include=dev --prefer-offline --no-audit --no-fund
   ```

   `postinstall` writes the lock-parity stamp and installs the pre-push guards automatically.

4. **Confirm the base is current:** `node scripts/check-base-freshness.mjs` — expect
   `behind 0`. If it reports behind, the fetch/worktree base is stale; recreate.
5. **Warm routes before any browser/UI work** (fresh worktrees can hash onto a
   Next-reserved port and 404 all routes until warmed): `npm run ensure`, then hit
   `/` and `/applications` once.

## Notes

- Never `git stash` here — the stash stack is global across all worktrees. Use a
  throwaway worktree or a patch file instead.
- Do the work on the `claude/<task-slug>` branch; commit only your own paths.
- When done, hand off with the `handoff` skill.
- **Worktrees are not free and nothing reclaims them automatically.** `npm run clean:worktree`
  only prunes worktrees whose directory is already missing or that git has marked prunable —
  a merged branch whose directory still exists is never a candidate, which is how 48
  accumulated. After the PR lands, `prlanded` should offer removal; otherwise run
  `node scripts/clean-worktree.mjs --merged` periodically and remove what it lists.
