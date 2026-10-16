---
name: newtask
description: Prepare an isolated current task checkout using the current host's supported workflow. Check ownership and the base, restore dependencies only when needed, and start the app only for a task that needs it.
---

# newtask — prepare the task checkout

Read root `AGENTS.md` and the current task checkpoint. Establish repository identity,
branch, `HEAD`, upstream, registered worktrees, existing changes and ownership before
writing. Preserve unrelated work. A same-task continuation keeps its established
checkout and checkpoint; it does not start over merely because owned changes exist.

## Check for overlapping work

Before creating a new branch, check whether the work belongs on an existing owned PR
under the repository's bundling policy. When GitHub reads are authorised, inspect open
PRs for the actual route, component or surface, rather than only a ledger ID. A missing
progress marker does not establish that nobody owns the work. Reconcile confirmed
overlap before dependent edits.

The duplicate implementation incident recorded as `#292` is historical evidence for
this check, not permission to call GitHub. Respect the provider boundary and any armed
PR-handoff stop hook. Do not bypass a denied PR read through another transport.
`git ls-remote` and `git fetch` also contact the remote, require network/authentication
and need applicable authority; they are not provider-free fallbacks.

Without an authorised remote read, inspect local branch refs, registered worktrees,
current task records and available checkpoints. Record that remote ownership and base
freshness remain unverified. Continue independent authorised offline work; do not claim
that local branch names prove the absence of another implementation.

## Prepare the checkout for the current host

1. Follow `docs/agents/codex-cloud-environment.md` for Cloud and
   `docs/agents/codex-desktop-worktree-setup.md` for Windows Desktop where applicable.
   Use the current host's supported task/worktree workflow. A disposable Cloud task
   checkout does not require a Windows task-start script or another worktree merely
   because an older local example used one.
2. For a new local task needing isolation, create a task-specific non-protected branch
   in an owned worktree. Determine its root from the current checkout and host policy;
   do not switch or reuse another session's checkout. If an authorised fetch is needed,
   verify repository identity and fetch `origin/main` before choosing the base. If
   working offline, record the actual locally available base SHA and its freshness gap.
3. Check capacity on the actual destination volume before a dependency install or
   build. Preserve other sessions' worktrees and services. Low capacity does not grant
   cleanup authority; use the repository's scoped cleanup workflow only when authorised.
4. Restore dependencies only when the task needs them and current parity evidence
   shows they are absent or stale. Inspect the setup helper and coordinator admission
   first. Where supported, `node scripts/setup-codex-worktree.mjs` reuses an eligible
   byte-identical donor before its documented npm fallback. Use the current host's
   supported restoration route; do not force the legacy Cloud bootstrap or change
   manifests/lockfiles merely to prepare a checkout.
5. Use `node scripts/check-base-freshness.mjs` when relevant to the task. Distinguish
   comparison with a local tracking ref from a freshly authorised remote observation.
   If the base moved, assess relevant drift and the task's sync policy; do not discard
   a continuation or recreate a worktree automatically.
6. Start or verify the app only for a task that needs it, following `AGENTS.md` local
   server safety: run `npm run ensure`, use its printed URL and verify project identity
   before browser work. Do not warm unrelated routes or start a watcher during generic
   onboarding. A documentation-only task needs no app server.

## Historical Windows example

On 2026-08-18 the local environment used `D:/Repos/PsychSift/.claude/worktrees/`
on a ReFS Dev Drive and reported roughly 48–50 worktrees. The then-observed disk
capacity, free-space percentage and dependency sizes are historical measurements.
They do not identify the current checkout, operating system, capacity or worktree
owner. Derive those facts from the current host instead of copying the old path.

## Handoff and cleanup

- Do not stash, reset, clean, relocate or absorb unrelated work.
- Follow the requested delivery workflow; commit or publish only with applicable authority.
- Use the `handoff` skill when available and relevant, without inventing missing tooling.
- A merged branch does not prove its worktree is disposable. Removal needs verified
  ownership, current status and the repository's cleanup authority. Do not run periodic
  cleanup or delete another task's checkout as part of task setup.
