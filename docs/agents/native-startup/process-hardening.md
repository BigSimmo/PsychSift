<!-- BEGIN:process-hardening -->

# Process hardening phases

## Bare PR publication is not readiness work

When the user says `open PR`, `create PR`, or `publish PR` without also requesting review, validation, readiness, or CI observation, treat it as a request to publish the prepared change promptly. GitHub is the requested verification surface.

- Inspect only what is necessary to avoid publishing the wrong change: the branch, base, staged/unstaged scope, and PR title/body. Reuse an existing dedicated branch or worktree rather than recreating it. Do not fetch, pull, rebase, review the ledger, inventory history, load a release/handover skill, or create a worktree unless it is necessary to keep unrelated work out of the PR.
- Do **not** run or wait for `npm run format`, dependency installation or linking, `npm run verify:pr-local`, tests, lint, typecheck, builds, browser checks, audits, generated-document synchronization, or CI. Do not invoke a release/readiness workflow for this request.
- If a local commit hook or a readiness-only push guard (format, drift, static, or ledger-write) is the only blocker, publish with `git commit --no-verify` and that guard's own scoped override (`SKIP_FORMAT_GUARD=1`, `SKIP_DRIFT_GUARD=1`, `SKIP_STATIC_GUARD=1`, or `SKIP_LEDGER_WRITE_GUARD=1`, as applicable) instead of `git push --no-verify`; do not spend time preparing dependencies or formatting solely to satisfy the hook. Never skip the push hook wholesale — the auto-merge ownership guard has no override and must never be bypassed, even for a bare-publication request. This exception is limited to the explicit bare-publication request and does not weaken normal-push safeguards.
- Create the PR immediately after the push, using the repository PR template where its policy fields apply. Report the URL and identify all local and hosted checks as unrun by request. Do not babysit CI, amend, or perform follow-up readiness work unless the user asks. This route overrides generic branch-bundling, handover, review, and babysit instructions.

- **For normal engineering pushes, format the files you changed and commit the result before push** (`node node_modules/prettier/bin/prettier.cjs --write <owned-path> ...`, as in `publication-workflows.md`; whole-tree `npm run format` is a separate, explicitly scoped operation). This rule does not apply to the explicit bare PR publication route above. Formatting is in neither `npm run test`, `npm run typecheck`, nor `npm run lint`, so the ordinary loop can report green while the changed-file CI check or exact-commit pre-push guard fails. Three CI failures on 2026-07-30 came from exactly this (two of them on `ci/circleci: verify`, since removed from the repo by PR #1412). Two traps beyond simply running it:
  - **Formatting without committing does nothing for the push.** A push sends commits, not your working tree, so formatting after committing leaves the unformatted blob on the branch. Amend or add a follow-up commit.
  - **A per-file check is not the repository-wide check.** `prettier --check <file>` on the source file you edited passes while a doc or ledger edit in the same push fails; that was the missed file twice out of three.

  `.githooks/pre-push` carries the guard, and since 2026-07-30 it checks the pushed commit where CI checks it: `guard-push.mjs` puts the pushed SHA in a temporary `git worktree` with an exact-lock `node_modules` linked in and runs Prettier there, so neither the working tree's contents nor its prettier config can vouch for the commit, and a dynamic `prettier.config.*` still loads. An isolated worktree without local dependencies may reuse Prettier only from a registered worktree with a byte-identical lockfile and matching installed Prettier version; if none exists, the guard blocks with the explicit `npm ci --include=dev` remediation instead of skipping formatting. A push that changes prettier policy (`.prettierrc*`, `.prettierignore`, `.editorconfig`, or a `package.json` carrying a `prettier` field) escalates to a whole-tree `prettier --check .`, because a policy change alters the verdict for files the push never touched. But `core.hooksPath` is set by this checkout's `npm install`, so an agent pushing from its own environment bypasses the hook entirely and only CI catches the break — which is why the rule above is still a rule.

For the verification principle, the tier table, and the rest of the gate-selection rules, see [`docs/agents/verification-gates.md`](../../../docs/agents/verification-gates.md).

## Do not pay twice for the verdict GitHub is about to reach

For the rule against re-deriving a verdict GitHub is about to reach, gate receipts, and the browser-gate planner that narrows `verify:ui` to the specs a diff can actually break (`npm run plan:browser`), see [`docs/agents/verification-gates.md`](../../../docs/agents/verification-gates.md).
<!-- END:process-hardening -->
