# Coding workflow

Read this when the perfected task depends on local repository evidence or will write to a Git repository. Apply the **freshness** rules to any review or diagnosis. Apply the **branch, environment, implementation, and validation** rules only when the task will actually write to the repository. Skip all of it for prompt-only or answer-only work that does not touch repository state.

Higher-priority instructions and the repository's own `AGENTS.md` / `CLAUDE.md` always win over anything here.

## Freshness (review and diagnosis)

- Base every finding on the current tree, not on memory or earlier context. Re-read a file before relying on its contents, paths, or line numbers.
- Confirm branch, `git status`, and whether the diff has moved before citing specific lines. Stale line numbers and since-deleted symbols are the most common false findings.
- Distinguish what you observed from what you inferred. If you cannot verify a claim against the current tree, label it as an assumption or a limitation rather than stating it as fact.
- Do not report a defect you have not traced to concrete, current file/line evidence.

## Branch and worktree (repository writes)

- Inspect the current repository, branch, HEAD, upstream, worktrees, active Git operation and changed paths. Establish task ownership before editing; never assume the branch or remote.
- Continue verified same-task work in the supplied task checkout. A dirty status or a branch behind the default branch alone does not require a fresh task, new worktree or discarded analysis. Inventory and preserve owned and unrelated changes; reassess relevant drift.
- For new unrelated work, use an isolated task branch/worktree when needed to protect concurrent changes. Follow repository-specific setup and isolation checks. A host-provided disposable task checkout may already supply that isolation; do not nest another worktree merely for procedure.
- Establish the appropriate base from available local evidence. Remote freshness checks such as `git fetch` require applicable provider/network authority; if unavailable, disclose the unverified remote state and continue independent authorised local work.
- Do not commit directly to a protected or base branch (`main`, `master`, `develop`, `release/*`). Establish an appropriate task branch before edits there.
- Preserve unrelated staged, unstaged, and untracked work. Do not stash, reset, clean, relocate or absorb changes you did not create.
- Commit or push only with applicable task authority. Never force-push, rebase shared history, delete branches, or merge into a base branch without applicable explicit confirmation.

## Environment (repository writes)

- Use the repository's documented scripts and the package manager already in use. Do not switch tooling or add a lockfile type.
- Do not assume a dev-server port or URL; use the project's own launch helper and confirm the server belongs to this project before attaching. Do not kill or modify other projects' servers.
- Treat provider-backed actions (hosted APIs, live databases, CI, deploys, paid services) as confirmation-required. Prefer local, mocked, or offline checks; report the command and ask before running anything that touches a provider.
- Never commit secrets, credentials, `.env*`, tokens, build artifacts, or machine-local config.

## Implementation (repository writes)

- Make the smallest change that satisfies the goal. Keep the diff proportionate to the problem; no opportunistic refactors, renames, or drive-by cleanups the task did not ask for.
- Match surrounding patterns, naming, and idioms rather than importing a new style or abstraction. Read neighbouring code first.
- Handle the error and empty paths, not just the happy path. Cover the edge cases a naive implementation gets wrong.
- Do not add a dependency without saying so and justifying it. Do not leave commented-out code or reviewer-directed explanatory comments.

## Validation (repository writes)

- Identify the verification path up front: which test, command, or flow proves the change. A change with no way to check the result is incomplete.
- Run the smallest relevant check first, then widen only if needed. Prefer a focused test over a full suite for a narrow change.
- Report what you actually ran and its result. Never claim a check passed unless it was executed. If a check could not be run, say so and give the command that would normally be used.
- For user-facing or behavioural changes, exercise the affected flow and observe the outcome, not only types or unit tests.
- Finish clean: leave the worktree with work committed or explicitly reported as uncommitted, and state the worktree path and branch so the user can push, hand off, or remove it.
