# Codex Review Protocol

Use this protocol for every Codex review, audit, bug hunt, PR review, release-readiness check, and branch-cleanup review in this repository. The pull-request lifecycle every tool shares — opening, following CI, review threads, records, merge authority, landed checks, and branch sync — is in [`agents/pull-request-workflow.md`](agents/pull-request-workflow.md); this file adds the review-specific protocol.

## Trigger and Scope

- Do not start a review opportunistically.
- Review only when the user request, `AGENTS.md` routing rules, or an explicit handoff/release workflow calls for it.
- Review the current diff, named PR, named branch, or explicitly requested area.
- Do not expand into stale branches or unrelated modules unless a confirmed defect crosses that boundary.
- Before a PR review, read the PR's comments for a `Review record` comment at its current head SHA with the same scope ([Records](agents/pull-request-workflow.md#records)). Skip unchanged completed reviews unless the user asks for a fresh pass.
- Treat GitHub automatic review as one pass per pull request. A repair commit or later head does not authorize another automatic pass; require an explicit human request before re-reviewing.
- Route automatic repair only for high-risk paths, at least 10 changed non-test source files, at least 300 changed non-test source lines, or an explicit `codex-review` label. `skip-codex-review` always opts out, including when both labels are present. Small low-risk, docs-only, test-only, and generated-only changes should not receive the automatic repair request.
- Ready PRs must pass the trusted `PR policy` metadata check. It reads only the base-branch policy implementation, never executes PR code, and requires concrete verification plus risk/rollback evidence for high-risk changes.

## Review Bot Quota Conservation (Inbox `9864a5d7`)

PR churn and unthrottled reviews quickly exhaust review-bot spending caps and rate limits (e.g., CodeRabbit and Codex connector allowances; see Inbox `9864a5d7`). When quotas are exhausted, PRs land with zero automated review, increasing defect risk during churn spikes. To protect review-bot budget:

- **Skip repeat passes on unchanged SHAs**: Never re-review a commit, branch, or PR head whose HEAD SHA and scope have already been reviewed. Automated routines, babysit sweeps, and CI jobs must check prior review records and skip repeat reviews when the tree has not changed.
- **Check review state on the PR**: Verify review state from the PR's `Review record` comments, matching the full 40-character head SHA and scope. For history before 2026-10-20, `npm run ledger:lookup -- <branch-or-ref> --scope "<scope>"` searches the frozen table, its archives (`docs/archive/branch-review-ledger-*.md`) and the archived records (`docs/archive/branch-review-records/`). Never scan or eyeball ledger tables manually.
- **Enforce a single review pass per PR head (#328)**: Automated review is strictly limited to one pass per PR HEAD. Intermediate repair commits, formatting adjustments, or routine base syncs do not authorize automatic re-reviews without explicit human approval. Prevent repeat passes (#328) by posting the PR's `Review record` comment immediately upon completing a review.
- **Lever 2: Prohibit bookkeeping-only pull requests (#KZJD4Q)**: Standalone PRs whose sole diff is a ledger update or documentation record must not be opened as separate PRs. Fold bookkeeping updates into functional PRs or reconcile them in batches to eliminate wasted automated review cycles on non-code artifacts.

## Review Output

- Lead with findings, ordered by severity: P0, P1, P2, then P3.
- For automatic PR reviews, emit no more than three inline findings and reserve them for P0/P1 defects. Consolidate non-blocking P2 context into one summary and omit P3 feedback.
- Each finding must include file/line evidence, trigger or failure path, expected behavior, actual risk, and the smallest proof or check that would catch it.
- If no high-confidence issue is found, say so clearly and name the highest residual risk area.
- Include checks run, checks not run, and whether any check was skipped because it could touch an API/provider.
- Keep summaries secondary to findings.

## GitHub access routing

For an explicitly authorized hosted task, use the GitHub connector or native Cloud controls first.
Their permissions are independent of `gh` in the agent shell. Run
`npm run check:github-shell-access:live` (which passes `--allow-provider` and does not pass
`--self-test`) only before an intentional GitHub CLI fallback.
`ALLOW_GITHUB_SHELL_ACCESS=true` or `--allow-provider` on a direct
`node scripts/check-github-shell-access.mjs` invocation (without `--self-test`) authorize the
same live path. The plain `npm run check:github-shell-access` entry is always offline
`--self-test`; ambient opt-in cannot convert it into provider traffic.
`GH_AUTH_MISSING` means shell authentication is absent, not that the hosted connector is
disconnected. Never add a PAT to an ordinary Cloud task.

## Mutation Rules

- For a pure review request, do not edit files, stage, commit, push, post PR comments, rerun hosted CI, or call provider-backed services.
  - Exception: post the completed review's `Review record` comment on the PR, under the same GitHub authority as the review, so throttling state persists.
- If the user clearly asks to fix confirmed findings, make the smallest safe change and verify with local, static, or mocked checks first.
- During an automatic resolve task, work only existing unresolved Codex threads. Do not start a new review, add standalone findings, or request another review.
- After fixing or fully dispositioning a thread, resolve it with the tool's direct resolution call. A local-only commit is not a fix; when publication, verification, human input, or new authorization blocks completion, leave the thread open with a concise reason instead of resolving it.
- Ask before any OpenAI, Supabase, GitHub/GitLab, hosted CI, or provider-backed workflow.
- After any completed PR review, post one `Review record` comment on the PR as [Records](agents/pull-request-workflow.md#records) describes. Record the full 40-character SHA; `see PR head` and abbreviations make the record unmatchable and cause the review to run again. A later pass on the same PR and scope edits that comment, or posts a new one when the head SHA has changed. A branch with no PR gets no record. Never add, edit or delete the archived records or the frozen `docs/branch-review-ledger.md` table.

## Ledger Rotation

The table is frozen; no rotation. Review records now live in PR comments, and `npm run ledger:lookup` reads the frozen table, its archives and the archived records for history. Do not hand-move rows or delete unique review content.

## Severity Guide

- P0: Data loss, security breach, production outage, or clinical safety issue likely to harm users immediately.
- P1: Broken core workflow, unsafe automation, privacy/auth failure, or repeatable defect that blocks merge/handoff.
- P2: Real defect, missing guardrail, fragile process, or test gap that should be fixed before relying on the work.
- P3: Low-risk cleanup, clarity, documentation, or future-proofing issue.

## Final merge audit

Before a protected-main merge, run the local audit from a clean PR checkout and pin the reviewed head:

```powershell
npm run audit:final-merge -- --dry-run --base-ref origin/main --head-ref HEAD --expected-head <head-sha>
```

The output records the local base/head and expected merge-tree. GitHub checks, labels, review threads, fresh remote refs, and deployment health are provider reads and require explicit authorization. Once authorized, add `--providers --pr <number> --repo BigSimmo/PsychSift` and set `ALLOW_PROVIDER_READS=true`; the audit fails closed unless the repository's `pr-required` aggregate is present and settled successfully. After the squash merge, rerun with `--post-merge --expected-tree <pre-merge-tree> --health-url <production-origin>/api/health`; the audit compares the remote main tree and requires an HTTP success with JSON `status: "ok"`. The script is read-only: it never merges, pushes, reruns CI, resolves threads, or deploys.

## CI observation fallback (when Checks-read is unavailable)

If `gh pr checks` or the check-runs endpoint returns `Resource not accessible by personal access token`, the credential cannot read Checks. Use the Actions API as a read-only fallback (when provider access is separately authorized):

1. Resolve the PR head SHA from trusted PR metadata.
2. Query `GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}` and require `head_sha` to match the PR head before attributing any result.
3. Require a matching Actions workflow run named "CI" for the trusted PR head SHA; if none exists, report CI as unobserved rather than passing, absent, or failed.
4. For the "CI" workflow run, query its jobs (`GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`) and require the `PR required` job. Explicitly report whether that job is missing or has a non-success conclusion. That job is this repository's single required aggregate gate; a run that completed without it does not prove required CI passed.
5. If neither Checks nor Actions can be read, report CI as unobserved due to credential capability — never as passing, absent, or failed.
6. An empty `GET /commits/{sha}/status` response does not prove that Actions workflows did not run.

## Operational Invariants (#055, #0H0S89, #6GW95D)

All reviews, readiness verifications, and release audits must uphold three core operational invariants:

### Exact-SHA Release Protocol (#055)

Releases, production deployments (Railway, Supabase migrations), and full-confidence handoffs must target an **exact, verified commit SHA** (full 40-character hexadecimal hash), never a floating ref (such as `main`, `HEAD`, `origin/main`, or a release branch tag):

- **Floating Ref Non-Determinism:** A floating ref can advance between verification and deployment. If CI or preflight audits run against `origin/main`, but another commit lands before deployment kicks off, unverified code enters production.
- **Verification Protocol:** Record the candidate commit SHA before starting the release gate. Execute all local, provider-backed, cross-browser (Firefox/WebKit), and hosted CI checks (`PR required`) explicitly pegged to that SHA. Stop at the first actionable failure; re-runs must verify the exact repaired commit SHA.
- **Audit Verification:** Use `npm run audit:final-merge -- --dry-run --base-ref origin/main --head-ref HEAD --expected-head <exact-sha>` to verify exact-head match before landing.

### Lighthouse Baseline Freeze and Pinned-Browser CI Refresh (#0H0S89)

Performance baselines committed in `lighthouse-budget.json` are frozen:

- **No Local or Ad-Hoc Updates:** Never update `lighthouse-budget.json` from a developer laptop or arbitrary local machine. Differences in operating systems, CPU throttling, and font hinting make local Lighthouse measurements non-comparable to CI.
- **Pinned Browser Requirement:** Ambient runner-image Chrome versions float over time (e.g., HeadlessChrome/150 vs /151). All official Lighthouse measurements must resolve Playwright's pinned Chromium via `./.github/actions/setup-lighthouse-chromium` on `ubuntu-24.04`.
- **Dedicated CI Refresh Workflow:** Baselines may ONLY be refreshed via the dedicated `workflow_dispatch` trigger in `.github/workflows/ci.yml` (`refresh_lighthouse_baseline: true`).
- **No Self-Greening Gate:** The refresh workflow deliberately uploads the rewritten `lighthouse-budget.json` as an inspection artifact for human review. It NEVER auto-commits or auto-pushes, because a workflow that rewrites its own gate's baseline is a gate that can green itself and mask true regressions. Reviewers must reject PRs that loosen `lighthouse-budget.json` without an authorized CI refresh artifact.

### Report-Only Worktree Fleet Inventory Policy (#6GW95D)

All tooling and scripts for inspecting worktree fleets and checkout directories (`scripts/clean-worktree.mjs`, `scripts/worktree-inventory.mjs`, `npm run worktrees:report`, `npm run worktrees:inventory`) must operate strictly in **report-only mode**:

- **Incident Precedent (#XCAX01):** On 2026-08-21, an aggressive automated cleanup sweep deleted an in-use worktree mid-session, destroying uncommitted developer work. Multi-agent workflows frequently hold open file handles across multiple roots (`.claude/worktrees`, `D:/Worktrees`, `.codex/worktrees`, `.gemini/antigravity/worktrees`).
- **Zero Mutation Invariant:** No fleet auditing script is permitted to delete, deregister, prune, or mutate developer checkouts. Any removal or mutation flag is rejected before adapters execute. Git prune operations are permitted only as read-only dry runs (`git worktree prune --dry-run -v`).
- **Deferred Cleanup:** Exact-path worktree removal remains deferred indefinitely. Any future cleanup must be executed via explicit human instruction targeting named, verified-dead directory paths with confirmed zero live process handles. Reviewers and agent sessions must never run or propose destructive worktree cleanup commands.
