# Process Hardening Plan

This document turns the current process review into phased, durable repo practice. It separates changes that already take effect from work that should stay explicit until it is implemented.

## Cloud environment verification boundaries (2026-09-07)

The [Cloud reliability audit](audit/codex-cloud-reliability-20260907.md) records passing hosted
GitHub/runtime checks and the remaining external boundaries: the known raw `OPENAI_BASE_URL`
launcher injection and incomplete production privacy/governance evidence. Keep the raw guard
and release validator fail-closed. GitHub connectivity is not clinical production acceptance;
new lifecycle code still needs hosted branch evidence before its PR can claim that proof.

## Testing speed playbook (pointer)

Day-to-day selection, local Playwright keep-root, and refuted speed levers live in
[`docs/testing.md`](testing.md) § "Testing speed playbook". Measured CI shape and the
Production UI critical-path numbers remain in "CI shape and cost" below; do not raise
Playwright workers or revive the refuted cache/shard hacks listed there.

## Risk-routed local and CI verification (2026-08-02)

- `ci-change-scope.mjs` is the shared fail-closed classifier for local PR handoff and hosted CI. Only recognised documentation and workflow/policy paths take a light route; product code, tests, executable config, dependencies, database/container/RAG surfaces, mixed scope, and unknown non-document paths retain heavy verification.
- `verify:pr-local` no longer treats every handoff as lint + typecheck + full unit + RAG fixtures. It always checks runtime, installed-lock parity, and changed-file formatting, then selects documentation checks, focused workflow contracts, or the heavy executable plan. Its self-test makes those routing decisions a repository contract.
- `static-pr` remains required but step-routes the same signals. Workflow-only edits run focused workflow tests instead of full coverage and safety/RAG; documentation changes run documentation integrity checks; heavy/unknown changes retain lint, typecheck, coverage, safety/RAG, and all applicable build/UI/database/container jobs. `PR required` remains `if: always()` and requires every in-scope job, including `safety` whenever `static_heavy_changed` is true.
- Repeated low-yield provider work was removed from ordinary PRs: dependency audit runs when a lockfile/npm configuration can change the dependency tree (and on the scheduled full-run sentinel), eval-canary liveness moved to the daily Ops Digest cadence, and PR-body synchronization runs only when the current PR's own diff changes `PR_POLICY_BODY.md`.
- The operating rule is incremental value, not a fixed command count: each added check must cover a distinct plausible failure path. Never rerun an unchanged pass, and do not stack broad gates when one suitable gate already covers the risk.

## Gate receipts: never pay twice for the same local proof (2026-08-21)

"Never rerun an unchanged pass" was policy in `AGENTS.md` and in the bullet above, but nothing
enforced it, so it held only as well as a session remembered what it had already run. The costly
shape is ordinary: `verify:pr-local` runs `lint`, `typecheck` and the full Vitest suite, then
`verify:cheap` runs all three again on identical content, and GitHub then runs them a third time.
Only the third one is unavoidable.

`scripts/gate-receipts.mjs` removes the local repeats. Before an allowlisted gate runs, its wrapper
hashes the content that gate reads; if a receipt records the same gate exiting 0 on that exact
signature, the wrapper prints the reuse and exits 0 without re-running. Measured on this checkout:
~45 ms to sign 3.8k files, against gates that cost minutes.

- **Wired into** `run-heavy.mjs` (`lint`, `typecheck`, `typecheck:source`) and `run-vitest.mjs`
  (every non-coverage, non-watch, non-snapshot-update run, so `test` and `test:focused` included).
  `verify:pr-local` and `verify:cheap` inherit the behaviour because they shell out to those scripts.
- **Signature** = the git blob hash of every in-scope file, with working-tree modifications,
  untracked non-ignored files and deletions overlaid, plus a toolchain component (Node version,
  platform, and the `node_modules/.package-lock.json` install stamp). An unstaged edit invalidates
  the receipt; restoring the content revalidates it.
- **Scopes are whole-tree today, deliberately.** Both narrowing candidates read more than they look
  like they read: `tsconfig.typecheck.json` includes every root `.ts` file with `resolveJsonModule`,
  and the Vitest suite holds contract tests over `.github/workflows/`, `docs/` and `supabase/`.
  A narrower scope is a declared path list whose existence and non-emptiness the self-test asserts.
- **Store** is `node_modules/.cache/database-gate-receipts.json`: per-worktree, never committed,
  destroyed by `npm ci` — correct, because a reinstall changes the toolchain the receipt vouched for.

Boundaries, each of which is a test in `tests/gate-receipts.test.ts`:

- **CI never reuses a receipt.** `receiptsEnabled()` returns false whenever `CI` is set, and no
  receipt from any machine reaches CI. GitHub stays the authoritative merge gate.
- **Failures are never memoised**, and a tree that changed while the gate was running is not recorded.
- **Fail open.** Unreadable git state, or a scope resolving to zero files, runs the gate. A bug here
  costs a redundant run, never a skipped one.
- **Artefact-producing gates are excluded.** `build` and `test:coverage` leave `.next/` and
  `coverage/` behind, which downstream gates read; skipping them would serve stale output — the
  stale-`.next` trap `AGENTS.md` already documents under "Bundle budget".

Three false-skip holes were found by Codex review on PR #2216 and closed there, each now a
regression test. They are worth stating because they are the shape this mechanism fails in:

- **File modes are content.** `git update-index --chmod=+x` leaves the blob SHA untouched, so a
  signature over SHAs alone could not see a hook's executable bit being fixed — the exact bit
  `tests/session-start-hook.test.ts` guards. The signature now carries the index mode _and_ the
  working-tree mode: overwriting one with the other cancels the change being detected, which the
  first attempt at the fix did.
- **`--coverage` has more than one spelling.** Vitest accepts `--coverage.enabled` and
  `--coverage=true`; an exact-match exclusion list memoised those, after which a later run would
  skip and leave `coverage/` stale. Matching is by prefix now.
- **Some environment variables change the verdict.** `FAST_CHECK_SEED` is read by
  `tests/property-seed.ts` at import time and exists precisely so a developer can reproduce a
  property failure; without it in the key, `FAST_CHECK_SEED=123 npm run test` served the default
  seed's pass. `OUTCOME_AFFECTING_ENV_VARS` declares the set; performance-only knobs stay out.

Reporting: a reused receipt proves the gate passed on this content, not that it ran just now. Say
"reused receipt from <time>", never "I ran it". `GATE_RECEIPTS=refresh` forces a real run when fresh
evidence is what is wanted; `GATE_RECEIPTS=off` disables the mechanism; `npm run receipts` shows the
current signature and stored receipts; `npm run receipts:clear` empties the store.

**What this does not do.** It does not reduce GitHub's work, and it should not: CI must re-verify
what it is scoped to verify, and `ci-change-scope.mjs` already keeps that scoped. The local run is
not waste either — it is what stops a red push costing a full CI cycle plus a fix round. The waste
was only ever the _repeat_, and that is what is now gone.

## Multi-worktree reconciliation hardening (2026-07-23)

The cloud-chat reconciliation postmortem and complete issue/fix matrix are in
[`docs/archive/cloud-chat-reconciliation-postmortem-2026-07-23.md`](archive/cloud-chat-reconciliation-postmortem-2026-07-23.md).
The reusable procedure is [`docs/reconciliation-playbook.md`](reconciliation-playbook.md).

- `node scripts/reconciliation-preflight.mjs` is an explicit, report-only inventory for broad reconciliation and
  cleanup. It uses cached Git refs, never fetches, and reports primary/worktree dirty state,
  detached worktrees, ahead/behind counts, and operation markers. Add `--include-processes` only
  when ownership could block cleanup; that path emits metadata/counts and never raw command lines.
- `node scripts/reconciliation-evidence-pack.mjs --output <path>` writes one deterministic secret-safe
  local evidence pack (atomic) covering dispositions, markers, archive refs, bundle verification,
  hashes, worktree counts, and local/base tree equality without fetching or deleting.
- `node scripts/primary-checkout-lease.mjs --check` is the cooperative primary-write gate: refuse a
  second primary writer while another live owner or dirty/operation state exists; keep read-only
  work and independent feature worktrees unblocked.
- `workflow:lifecycle -- --phase reconcile` selects the preflight and evidence pack locally and lists remote fetch as
  a separate approval-required action. `start`/`cleanup` select the primary-checkout lease check.
- Candidate filtering is cheap-first: owner/open-PR/review-ledger/ancestry before patch comparison;
  `merge-tree` remains a last resort. This avoids repeating the slow all-ref sweep that dominated the
  historical reconciliation.
- Heavy verification uses resource-aware admission: two focused Vitest/read-only typecheck leases may overlap across different worktrees, while full suites, coverage, lint, builds, and browser runs remain exclusive. Inspect coordinator/process/artifact state before retrying, never rerun an unchanged pass, and record interrupted aggregate suites as incomplete.
- `scripts/test-run-lock.mjs` redacts credential-bearing command text before it reaches coordinator metadata
  or a contention error. `scripts/run-eval-safe.mjs` uses command lines only inside its workspace
  filter and serializes PID/parent/start metadata only.

## Repository cleanup follow-ups (2026-07-19)

- **ModeHomeMain vertical alignment (fixed in #938):** commit `39d14a51` made standalone mode homes a `flex-1 justify-center` shell. That centres short empty homes correctly, but when differentials (and any tall results view) reused the same wrapper, the top of the content was clipped above the phone scrollport — white gap under the header, Best Answer unreachable, first visible list card looking like rank “2”. Prefer `ModeHomeMain`’s `contentAlign` prop (`center` | `start` | `startOnPhone`); never pass `justify-*` via `className` (`cn()` does not merge Tailwind). Guards: `tests/mode-home-main-align.test.ts` plus the narrow-viewport Best Answer fold assertion in `tests/ui-tools.spec.ts`.
- **Local process ownership (resolved):** `scripts/run-eval-safe.mjs` now terminates only the spawned
  child and its descendant tree through `terminateOwnedProcessTree(child.pid)`; focused tests prove
  unrelated Vitest, Playwright, and Next processes are not targeted. Repository discovery remains
  Node-filtered. Process command lines are no longer serialized out of the Windows inventory.
- **Provider-gated RAG safety ideas (closed obsolete — outstanding-issues #004):** the same stale worktree contained conservative answer-quality thresholds, an evaluation cost-cap preflight, production-safety validation, deep-health assessment, and citation/vector proof tests. Its 754-line retrieval migration and route changes conflicted with the later public-title privacy and migration chain and must not be replayed. This item is now resolved: the rescue source is unrecoverable (pruned across all reachable refs), the answer-quality thresholds and deep-health assessment already shipped on current `main` (#585/#587), and the only genuinely-missing piece — the evaluation cost-cap preflight — was dropped rather than re-filed. No rescope action remains.
- **Semantic reranking rollout debt:** PR #901 keeps `RAG_SEMANTIC_RERANK_ENABLED=false`. Do not enable it until the provider-backed 36/36 retrieval-quality gate and an ambiguity-focused canary are explicitly approved and recorded.

## Staging tenancy evidence

The provider-backed A/B tenancy regression is intentionally outside local and PR
gates. Run the standalone manual/nightly workflow and attach a recent green evidence
artifact before release; see
[`docs/staging-tenancy-release-evidence.md`](staging-tenancy-release-evidence.md).

## Open PR branch sync (operator-only)

- **Problem:** landing one PR advances `main` and leaves the rest of a large open
  queue behind. GitHub then marks many heads `CONFLICTING`/`DIRTY` even when the
  merge tree is clean, which stalls squash auto-merge and creates endless manual
  re-sync churn.
- **Mitigation:** automatic `GITHUB_TOKEN` branch mutation was retired after repeated
  `github-actions[bot]` heads left CI, SAST, and secret-scan runs awaiting approval. Use the local
  helper deliberately: `npm run sync:pr-branches` is report-only and
  `npm run sync:pr-branches:apply` verifies and uses the current human/operator `gh` identity,
  refusing missing or bot identities. Opt out with
  `hold`, `do-not-merge`, or `skip-branch-sync`.
- **Guardrail:** `npm run check:github-actions` rejects workflow-authored GitHub
  `update-branch` calls. Do not weaken required checks or widen approval for untrusted actors to
  remove queue friction; change this policy only with a separately reviewed authentication model.
- **Operator rule:** prefer clearing the open queue (merge or close) over keeping
  dozens of long-lived feature branches that all touch shared docs like the
  branch-review ledger.

## PR bundling reduces per-task CI churn (2026-07-30)

- **Problem, measured:** PR #1406 sampled the last 500 CI workflow runs (~3 days of PR
  traffic, 437 PR-triggered): 213 succeeded, 45 failed, 176 (~40%) cancelled — mostly
  superseded by a newer push before Production UI finished, burning roughly 12
  Production-UI-hours on runs that never completed. Every task minting its own
  `claude/<task-slug>` branch and PR means a single ledger-append line pays the same
  required-CI bill as a large change.
- **Rule:** see AGENTS.md "PR bundling (reduce one-task-one-PR churn)" — bundle
  same-scope, independently low-risk, separately-revertible-commit work into one PR
  instead of minting a branch per task. Review records and issue requests now use independent
  immutable files, so they should accompany their owning product PR rather than become ledger-only PRs.
- **Does not change:** required-check scoping, per-commit verification rigor, or the
  deliberate "1 PR per work order" convention for tracked staged rollouts (maturity
  backlog, `#086`) or anything crossing a clinical-risk/RAG-ranking-surface path.
- **Clinical vs. operational risk bundling detection (#178):** While low-risk same-scope tasks should bundle to reduce CI churn, bundling operational-risk changes with clinical or UI changes is an anti-pattern. `scripts/pr-policy.mjs` detects when `operationalRisk` paths (`.github/workflows/`, `package.json`, `package-lock.json`, root tool configs, `Dockerfile`, `railway.json`, `nixpacks.toml`) are bundled with `clinicalRisk` (`supabase/`, `src/app/api/`, clinical/RAG/auth libs, clinical reference datasets) or `ui` surfaces (`src/app/`, `src/components/`, `public/`, UI specs). The PR policy emits an advisory warning (`Operational-risk changes are bundled with <classes> changes. Split the PR where practical so each risk class remains independently revertible.`) to keep operational infra and patient-safety or visual regressions independently revertible.

## Anti-conflict and silent-CI signal (2026-07-30)

- **Operating procedure:** AGENTS.md "Anti-conflict and CI-speed operating procedure".
  Future-process only — do not mutate unrelated active PRs unless explicitly asked.
- **Outstanding-issues concurrency (`#112`):** the structural gate landed in PR #1410
  (`npm run check:outstanding-issues` in `verify:full` / CI `static-pr` — duplicate IDs,
  both-tables, stale `issues:next-id`, malformed rows). PR #1416 added `merge=union` in
  `.gitattributes`; it is now **removed** and the runtime attribute check inverted to require
  no driver at all. Union could not allocate unique IDs either, and it concatenated
  conflicting hunks instead of failing — two marker bumps became two `next-id` lines (`#133`),
  and on 2026-07-30 it duplicated the whole open-items table on four merges (PR #1430).
  Default 3-way merge conflicts loudly instead; the structural gate remains required.
- **Silent CI on conflicted PRs (`#116`):** when GitHub cannot build
  `refs/pull/<n>/merge`, every `pull_request` workflow is skipped with no failing check.
  `.github/workflows/pr-mergeability.yml` checks trusted `pull_request_target` events and
  uses a protected-base `push` sweep to publish a fresh `PR mergeability` check on each
  unchanged open-PR head. Only that sweep receives job-scoped `checks: write`; neither path
  checks out PR code or updates branches. Behind-but-clean heads remain an operator
  `sync:pr-branches` concern. Contract: `npm run check:pr-mergeability`.
- **Confirmed in the field the same day (PR #1427):** that PR pushed, opened, and was marked
  ready for review while producing **zero** `pull_request` runs — no `CI`, no `Gitleaks`, no
  `Semgrep` — with only `pull_request_target` (`PR policy`) firing. `git merge-tree` showed
  real conflicts against a base 35 commits ahead. The new `PR mergeability` check caught it
  and named the cause. Read a missing check list as a conflict signal, never as a pass.

## CI shape and cost, measured per job (2026-07-30)

The PR #1406 sample above counts runs. This is where the time inside one goes — job-level
timings from two full UI-scope PR runs (`30520443076`, `30519912667`), read from the Actions
API rather than estimated:

| Job               | Duration        | On the critical path?    |
| ----------------- | --------------- | ------------------------ |
| Change scope      | 13 s            | yes                      |
| Static PR checks  | 3m03            | no                       |
| Safety and config | 47 s            | no                       |
| Unit coverage     | 3m57            | no                       |
| Advisory UI       | 3m14            | no                       |
| **Production UI** | **15m26–16m31** | **yes — 83–89% of wall** |
| PR required       | 5 s             | yes                      |
| **Whole run**     | **16.8–18.6 m** |                          |

- **Every other job finishes by minute 4 and then waits ~12 minutes for Production UI.**
  Inside it, Playwright reported `339 passed (13.5m)`; the remaining ~2 min is the isolated
  production build (see outstanding-issues `#136`). Docs-only PRs run 3–5.5 min.
- Because the 42% cancellation rate is dominated by pushes that supersede a run mid-Production-UI,
  almost all of the wasted runner time is this one job. Shortening it cuts churn cost directly.
- **`ui-critical` is therefore sharded across runners** (`ci.yml`), not parallelised within one:
  `workers: 1` / `fullyParallel: false` / `retries: 0` are unchanged inside each shard, so
  determinism is identical and per-runner load falls — which matters because `#093`'s duplicate
  page root is load-dependent.
- **The shard count is measured, not chosen.** With `fullyParallel: false` a spec file is
  indivisible, so shard sizes are lumpy. Against the 342 required chromium tests on the
  post-merge tree, N=3 gives 121/111/110 and N=4 gives 121/106/98/17 — the same 121-test
  bound for an extra runner. On the 340-test tree just before, N=5 and N=8 produced **empty**
  shards, which would go red because `test:e2e:pr` deliberately omits `--pass-with-no-tests`.
  Re-measure with
  `npx playwright test --project=chromium --grep-invert "@quarantine|@mockup" --shard=i/N --list`
  (needs a running server via `npm run ensure` and `PLAYWRIGHT_BASE_URL`) before changing N,
  and keep every shard non-empty.
- **These timings predate `ui-critical-fast`.** The `@critical` fail-fast job (15 tests) now
  runs before the full suite, so the UI critical path is that job plus the slowest shard.
- **Measured on the first real sharded run** (CI `30530618838`, 2026-07-30, all green):
  `ui-critical-fast` 3m14, then shards of 9m36 / 6m54 / 6m20; whole run **13m39** against a
  16.8–18.6 min unsharded baseline. **The prediction from test counts was wrong by ~40%:**
  6.8 min was expected for the largest shard, 9m36 happened. Per-test cost is not uniform —
  111 tests took 6m54 while 121 took 9m36 — so a count-balanced split understates the slowest
  shard whenever the slow specs land together. `--shard` can only balance by count; balancing
  by duration would require splitting the slow spec files themselves. Prefer a measured run
  over the arithmetic when judging any further shard change.
- **Which spec drags shard 1, measured 2026-07-30** by running `--shard=1/3` locally and
  summing per-test durations from the list reporter (121 passed, 6.9 min):

  | Spec                               | Time   | Tests | Per test  |
  | ---------------------------------- | ------ | ----- | --------- |
  | `ui-phone-scroll.spec.ts`          | 267.0s | 56    | **4.77s** |
  | `ui-chrome-scroll.spec.ts`         | 56.3s  | 17    | 3.31s     |
  | `ui-accessibility.spec.ts`         | 28.1s  | 15    | 1.87s     |
  | `ui-formulation.spec.ts`           | 18.2s  | 7     | 2.60s     |
  | `ui-overlap.spec.ts`               | 15.3s  | 14    | 1.09s     |
  | `answer-progress-ui-smoke.spec.ts` | 12.2s  | 2     | 6.10s     |
  | `ui-mode-nav-density.spec.ts`      | 6.8s   | 7     | 0.97s     |
  | `ui-hydration.spec.ts`             | 5.2s   | 3     | 1.73s     |

  **`ui-phone-scroll.spec.ts` is 65% of the shard** — 267s of 409s — at the worst per-test rate
  of any large spec in it. It is also the file behind both `#127` and `#146`. Re-measure with
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium node scripts/run-playwright.mjs --project=chromium --grep-invert "@quarantine|@mockup" --shard=1/3`
  before acting — local absolute times differ from CI, but the per-spec ranking holds.

- **"Splitting the slow spec rebalances the shards" is REFUTED, measured 2026-07-30.** That
  claim appeared in this document and in PR #1453; it is wrong, and the correction matters more
  than the original guess. `ui-phone-scroll.spec.ts` was split into three files (21 / 19 / 16
  tests) and the shard distribution did not move at all:

  |               | Before                | After                 |
  | ------------- | --------------------- | --------------------- |
  | Project total | 342 tests, 18 files   | 342 tests, 20 files   |
  | Shard 1       | 121 (56 phone-scroll) | 121 (56 phone-scroll) |
  | Shard 2       | 111 (0)               | 111 (0)               |
  | Shard 3       | 110 (0)               | 110 (0)               |

  **Why:** `--shard` does not distribute files, it walks them in collection order (alphabetical)
  and cuts at test-count boundaries. Sibling files named `ui-phone-scroll*` sort adjacently, so
  all three land in the same shard. The shards were already count-balanced; the imbalance is
  duration, and splitting a file cannot fix a metric the scheduler does not use:

  ```text
  shard 1  121 tests / 10 files — phone-scroll(56), chrome-scroll(17), accessibility(15), overlap(14), …
  shard 2  111 tests /  4 files — ui-smoke(92), route-coverage(12), specifiers(5), pwa(2)
  shard 3  110 tests /  6 files — ui-tools(87), universal-search(16), stress(3), …
  ```

  Shard 1 is slow because it holds ten _slow-per-test_ files while shards 2 and 3 are dominated
  by one fast-per-test file each. **Shipped:** explicit duration-aware file groups in
  `scripts/playwright-pr-shards.mjs` (CI `test:e2e:pr:shard -- --shard N`) with
  `tests/playwright-pr-shards.test.ts` asserting every production e2e:pr spec is in exactly one
  non-empty group. Re-measure wall time after suite growth before reshuffling membership.

- **PR #1686 final hosted measurement corrected its first explicit split** (CI `31285952061`,
  2026-08-09): the three production steps ran **146 passed (5.5m)**, **122 passed (3.7m)**, and
  **135 passed (2.4m)**, so the 9m08 / 6m17 / 5m07 jobs were still duration-imbalanced. The dated
  per-file profile now predicts full groups of about **239s / 223s / 219s** and post-critical PR
  groups of about **218s / 223s / 216s**. The profile is the membership source of truth; its test
  fails when either mode drifts beyond 30 seconds.
- The same run proved two structural wastes. The later shards repeated all 15 `@critical` tests
  (10 in `ui-smoke`, 5 in `ui-tools`), so PR/merge-queue groups now exclude them; events where the
  fast job skips retain the full set. The critical job also uploaded a **1,092,887,876-byte**
  webpack artifact and shards spent 19–67 seconds downloading it. Their warm builds still took
  roughly 72–82 seconds versus about 107 seconds cold; the slowest path lost ~43 seconds. The
  cross-job artifact is removed. Do not restore it without a same-run net wall-time win.

  **Stop:** do not "fix" this by renaming spec files so they sort into different shards. It
  works, and it encodes undocumented scheduler behaviour into filenames where the next reader
  cannot see it.

## CI waste on red and superseded runs, measured (2026-09-25)

Read from the Actions API for PR runs `36110977826`, `36113010077`, `36107996148` and main run
`36116008648`. Two changes shipped; the rest are recorded here as measured, not yet acted on.

- **Shipped — browser lanes wait for `static-pr`.** `static-pr` and `ui-playwright-build` finished
  within seconds of each other (5.2m/5.2m, 5.4m/5.3m, 4.4m/5.0m), so the three browser lanes now
  also `need` it. A green run waits for nothing; a lint, typecheck, format, snapshot or contract
  failure no longer books ~30 runner-minutes of browser tests on a head that must be re-pushed.
  `pr-required` stays red on the static failure and reports the skipped lanes as deferred.
  The producer deliberately does not wait: gating the build would add ~5 minutes to every run.
- **Shipped — the Playwright build artifact no longer carries the webpack cache.** Measured
  locally, the build root was ~2.2 GB of which `dist/cache/webpack` was ~2.0 GB; the hosted
  artifact was 336,815,208 bytes compressed. Upload took ~40 s on the critical path and each of
  the five consumers spent ~13 s downloading it. Consumers only `next start` a finished build.
  Only `cache/webpack` is excluded — `cache/fetch-cache` is runtime data. Hosted timing of the
  smaller artifact is not yet measured; read it from the first UI-scope PR run after this lands.
- **Not acted on — main re-runs the whole PR suite.** Every push to `main` repeats static,
  coverage, build, Lighthouse and the three Chromium shards (~70 runner-minutes) that the merged
  PR already ran, then ~200 runner-minutes of Firefox/WebKit (`release-browser-matrix`), which was
  red on 7 of the last 8 pushes. Until that matrix is green (`#T82ND3`) those minutes buy no
  signal. Skipping the repeated Chromium work on `main` would reverse the 2026-08-18 decision above
  that `main` is always verified, so it needs an owner decision, not an agent edit.
- **Shipped — shard rebalance, and a correction.** Per-file timings from the retained
  `production-ui-timings-*` artifacts of PR runs `36113010077` and `36135682519` put the three
  post-critical groups at about 421s / 378s / 436s of tests: shard 3 is heaviest by roughly
  20–40 seconds, not ~2 minutes. Job-step times alone overstated it, because a single run
  varies by up to ~100 seconds per shard (the same shard ran 6.0m on one run and 6.8m on the
  next). The profile in `scripts/playwright-pr-shards.mjs` now carries those means, and
  `ui-sources` and `ui-stress` moved to shard 2, giving estimates of 414s / 409s / 413s
  post-critical. Shard 3 also booted the seeded Caring Contacts server (retired 2026-09-26), which the
  profile did not model.
- **Not acted on — unit coverage partitions.** Vitest `--shard` splits by file count, and the two
  partitions ran 8.1m vs 6.6m and 8.4m vs 7.0m. For a code change without UI scope this is the
  critical path.
- **Churn, not configuration.** 11 of the last 30 PR runs were cancelled by a newer push, and
  many of the rest follow a `Merge branch 'main' into …` commit. On 2026-09-25 four Dependabot
  PRs were brought up to date in the same minute, booking four full runs at once. The
  branch-sync rule in `AGENTS.md` (sync once, when otherwise ready) is the lever here.

## Phase 1 - Active now

- `npm run verify:cheap` is the ordinary pre-PR local gate: `check:installed-lock-parity`, then `check:diff-integrity`, lint, typecheck, and the full offline unit suite. Run it freely — it is meant to be cheap enough not to think about. The parity step stays because it is sub-second and, without it, the other three would happily report green against a stale `node_modules`.
- `npm run verify:full` is the broad offline local gate for cross-module risk: the 41 static/consistency gates (`check:runtime` through `check:instructions`; `npm run check:gate-manifest` lists them and pins the count), then lint, typecheck, and unit tests. It is selected, not automatic for every source/config/test edit.
  - **Split on 2026-09-17 (owner decision).** `verify:cheap` had grown to 41 chained commands — including `check:pr-mergeability` (an offline self-test and workflow contract; an earlier version of this note wrongly said it calls GitHub) — so the gate advertised as the fast iteration loop was in practice the slowest thing in it, and agents ran it reflexively. The static gates did not stop running: they moved to `verify:full` (38 at the split; live count is whatever `check:gate-manifest` reports against `verify:full:internal`, 41 as of 2026-09-30), and every one of them still runs in CI, which `check:gate-manifest` continues to enforce one-way (CI may run more than the local chain, never less — it now reads `verify:full:internal`, and pointing it back at the cheap chain would silently drop those gates from that invariant while still passing).
- `npm run verify:pr-local` is the risk-routed local mirror of the normal PR gate: runtime, installed-lock parity, changed-file format, conditional `npm ci --dry-run --ignore-scripts` for package/lockfile edits, then focused docs/workflow contracts or the fail-closed executable plan with lint, typecheck, one full unit run, conditional build, and RAG fixture/manifest validation. Local scope resolves against the repository default base rather than a feature-branch upstream; set `PR_BASE_REF` explicitly for release-targeted PRs.
- `npm run verify:ui` is the complete required production Chromium gate: `check:runtime` plus all non-quarantined production journeys (`test:e2e:pr`).
- `npm run verify:release` is the release-confidence gate: `check:runtime`, lint, typecheck, unit tests, build, full Playwright browser matrix, `check:production-readiness`, `governance:release`, and `eval:quality:release` (the last step needs live Supabase and OpenAI keys).
- CI uses a risk-scoped PR gate: `changes` classifies paths, `static-pr` always runs runtime/install parity, scope/plan self-tests, diff integrity, and changed-file formatting, and `pr-required` is the single always-reporting required aggregate. Focused documentation or workflow contracts run for recognised light scopes; mixed heavy+workflow changes do not repeat the same workflow suites outside full coverage. Lint/typecheck, one full unit run with coverage, safety/RAG, build, both Docker image builds, required production Chromium, and migration replay run only when their file scopes apply; unknown non-document paths fail closed to this heavy route. UI PRs also run one non-blocking advisory Chromium invocation for quarantined and mockup journeys. The external `Supabase Preview` check may still replay migrations on branch databases when enabled. `release-browser-matrix` runs on UI/performance/lockfile-relevant `main` pushes and every release/manual/scheduled run; the wrapper owns its build and omits production Chromium only after that project passed earlier in the same run. Lighthouse baseline refresh is a focused dispatch exception, not a full-run sentinel.
- `tests/ui-accessibility.spec.ts` covers reduced-motion and forced-colors dashboard usability so those modes are no longer only reviewed by inspection.
- `tests/ui-tools.spec.ts` covers the Applications dashboard mode at mobile and desktop sizes, including the `/applications` compatibility redirect.
- `AGENTS.md` now points future agents to these gates and to this document.

## Phase 2 - Active now

- Previous deterministic smoke failures are reclassified as resolved in the current Chromium UI gate: `npm run verify:ui` passed 26/26 on June 23, 2026.
- Local scratch and visual-capture output are excluded from Prettier through `.prettierignore` so generated investigation files do not block the format gate.
- Pull requests now include a clinical governance preflight for ingestion, answer generation, source rendering, privacy, production environment, and clinical-output changes.
- Applications mode now has dedicated Playwright coverage in the UI gate.
- `tests/ui-stress.spec.ts` uses a **1000px** desktop viewport (below `lg`) because scope and evidence open in sheets, not side panels, at that width; widening to ≥1024 exercises a different UI path.

## Phase 3 - Structural cleanup

- [x] Decompose `src/components/ClinicalDashboard.tsx` into the planned `src/components/clinical-dashboard/` modules. **DONE** — all 6 approved render-surface modules extracted (~8.8k → ~4.7k lines); see the progress log below. Only the deferred admin surfaces remain in the monolith.
- Preserved `data-testid`, `aria-label`, and AST-pinned `ClinicalOutputPanel`/`NaturalLanguageAnswer` contracts across every move (byte-identical sha1 checksum + retargeted AST guards).
- After decomposition, run `npm run verify:cheap`, `npm run verify:ui`, and focused visual/browser checks against the dashboard and document viewer.

### Phase 3 progress (started)

- Added `src/components/clinical-dashboard/` as the module boundary.
- `src/app/page.tsx` now imports `ClinicalDashboard` from the module path (`@/components/clinical-dashboard`) while preserving
  the legacy source declaration file for AST and merge-guard compatibility.
- **2026-07-03:** extracted `AuthPanel` (+ its solely-consumed auth-email snapshot helpers) into `clinical-dashboard/auth-panel.tsx`. Monolith 7924 → 7800 lines. Per-module gate established: `npm run typecheck` + `npx vitest run tests/clinical-dashboard-merge-artifacts.test.ts tests/rendered-text-formatting.test.ts` + a `data-testid`/`aria-label` sha1 checksum over `ClinicalDashboard.tsx` + `clinical-dashboard/*.tsx` (must be byte-identical before/after each move) + lint + prettier.
- **2026-07-03:** extracted `answer-content.tsx` — `SourceImage`, `ScopeAndGovernanceNotice`, the answer/source formatters, `SourcePreviewContent`, `NaturalLanguageAnswer`, `UserQuestionBubble`, `KeyClinicalItems` (block 510–1249 against the post-drift monolith), moved verbatim (block diff empty; testid/aria checksum byte-identical). Two shared helpers went to clean homes instead of a monolith↔module cycle: `useMobilePreviewSheet` (+ its media-query snapshot helpers) → new `clinical-dashboard/use-mobile-preview-sheet.ts`, and `comparableAnswerText` → `clinical-dashboard/display-text.ts`. Retargeted the `NaturalLanguageAnswer` AST pin to scan `answer-content.tsx`, and widened `rendered-text-formatting.test.ts` negative scans to the monolith+module corpus (both strengthened, not weakened). Reusable finding: the answer/evidence families' helpers already live in `@/lib/*` and extracted sibling modules, so extractions re-import rather than needing wide monolith exports; only `comparableAnswerText`/`useMobilePreviewSheet` were monolith-internal.
- **2026-07-03:** extracted `evidence-panels.tsx` — the clinical-detail/notes helper family + `AnswerSupportSummaryCard`, `ClinicalNotesChecklistPanel`, `SafetyFindingsPanel`, `EvidenceGapPanel`, `EvidenceCounts`, `AnswerSourceStatus`, `EvidenceSummaryCard`, `AnswerInsightBar`, `EvidenceVerificationStrip`, `AnswerFeedbackPanel`, `RenderModelSourceList`, `VerificationWorkspace`, `AnswerViewModeControl`, `EvidenceMapTable`, `AnswerSafetyNotice`, `QuoteCards` (contiguous block 484–2311, moved verbatim). Monolith 7909 → 6084 lines. **This module needs a monolith↔module cycle** — `ClinicalNotesChecklistPanel` renders `<ClinicalOutputPanel/>` (staying in the monolith as B3), so evidence-panels imports `ClinicalOutputPanel` + `clinicalQueryModeOptions` + `type AnswerFeedbackType` back from `@/components/ClinicalDashboard`. This is the SAME pattern already used by `global-mockup-search-shell.tsx` (imports `SettingsDialog` back); the repo has no `import/no-cycle` rule and the refs are render/runtime-time so init is safe (the `ui-smoke` build is the definitive cycle check). The monolith imports 26 symbols back (incl. the exported detail-helper family for output-panel). Robust dependency finding: the danger/reverse regex missed `const X: Type =` and `const X = {…}` forms (caught `clinicalQueryModeOptions` + `simpleClinicalTableProps` only via typecheck) — use a name-only regex `^(export )?(async )?(function|const|type) NAME` next time.

- **2026-07-03:** extracted `output-panel.tsx` — `ClinicalOutputPanel` (block 487–688, moved verbatim). Monolith 6084 → 5882 lines. Clean move: empty danger set (no monolith-internal deps) and empty reverse set (the monolith never rendered it — its only consumer is `evidence-panels`'s `ClinicalNotesChecklistPanel`). This **replaced** the evidence-panels↔monolith cycle with an evidence-panels↔output-panel one: `evidence-panels` now imports `ClinicalOutputPanel` from `clinical-dashboard/output-panel` (still imports `clinicalQueryModeOptions` + `type AnswerFeedbackType` from the monolith); `output-panel` imports the detail-helper family + `AnswerViewModeControl`/`EvidenceMapTable` from `evidence-panels`. Retargeted the AST pin (`ClinicalOutputPanel` now resolves via the `scannedFiles` array's `output-panel.tsx` entry) and added `output-panel.tsx` to the `rendered-text-formatting.test.ts` corpus. Stripped 8 now-orphaned monolith imports.

- **2026-07-03:** extracted `visual-evidence.tsx` — `compactClinicalTableCaption`, `visualEvidenceHeader`, `VisualEvidenceStrip`, `InlineTableCard`, `supportDotClass`, `supportLabel`, `claimRowsForEvidencePanel`, `EvidenceClaimsList`, `EvidenceGapsPanel`, `MobileEvidenceSheetContent`, `MobileEvidenceTabPanel`, `UnifiedEvidenceDrawerContent` (contiguous block 547–1259, moved verbatim). Monolith 5953 → 5241 lines. **No runtime cycle** — the only monolith import is `type AnswerFeedbackType` (erased at compile time); the module imports one-way from `evidence-panels`/`answer-content`/siblings, and the monolith imports `InlineTableCard` + `MobileEvidenceSheetContent` back. Added `visual-evidence.tsx` to the `rendered-text-formatting.test.ts` corpus (the `item.tableTextSnippet`/`item.title`/`item.caption` render surfaces moved here). Stripped 22 now-orphaned monolith imports. Done on a **dedicated worktree/branch** `claude/clinical-dashboard-decomp` (off `main`) instead of the shared claude branch, to avoid the squash-ancestry churn.

- **2026-07-03:** extracted `document-results.tsx` — `WhyThisMatchedPanel`, `RelatedDocumentsPanel`, `StagedAnswerResultSurface` (contiguous block 456–944, moved verbatim). Monolith 5216 → 4726 lines. **No runtime cycle** — the only monolith import is `type AnswerFeedbackType` (erased); `StagedAnswerResultSurface` is a leaf result-surface that imports one-way from every sibling module (answer-content, evidence-panels, visual-evidence, relevance, document-search-results, badges, dashboard-shell, display-text, use-mobile-preview-sheet) and the monolith imports `RelatedDocumentsPanel` + `StagedAnswerResultSurface` back. The monolith's `visual-evidence` import (`InlineTableCard`/`MobileEvidenceSheetContent`) moved into `document-results` as predicted. Added `document-results.tsx` to the `rendered-text-formatting.test.ts` corpus; stripped 35 now-orphaned monolith imports.

- **2026-07-04:** answer-review hygiene — `StagedAnswerResultSurface` now lives in `answer-result-surface.tsx`; `document-results.tsx` re-exports it and owns `RelatedDocumentsPanel` (monolith imports both). `AnswerFeedbackType` moved to `lib/answer-feedback.ts` so `evidence-panels`, `visual-evidence`, and `answer-result-surface` no longer import types from `ClinicalDashboard`. `rendered-text-formatting.test.ts` corpus includes `answer-result-surface.tsx`. Clinical-note checklist rows link to primary sources when available.

#### Decomposition COMPLETE (approved move map)

All approved render-surface modules are extracted. `ClinicalDashboard.tsx` went from ~8.8k → ~4.7k lines and now holds the main `ClinicalDashboard` orchestrator, its data/state hooks, and the deferred admin surfaces only. The 6 extracted modules live in `src/components/clinical-dashboard/`: `auth-panel`, `answer-content`, `evidence-panels`, `output-panel`, `visual-evidence`, `document-results` (+ the shared `use-mobile-preview-sheet` hook and `display-text` helpers). The barrel `index.ts` was intentionally not extended.

**Deferred admin surfaces: DONE (2026-07-06).** `DocumentDrawer` + the label panels/helpers had already landed via #250/#251 (`document-admin.tsx`, wired). The remaining half-wired state was finished on `claude/dashboard-decomp-final`: `ToolsHub` + `MobileSectionFab` cut over to `dashboard-nav.tsx` and `SettingsDialog` (+ its 7 `Settings*` helpers) to `settings-dialog.tsx`. **Both #250 sibling files had drifted from the live monolith** (settings-dialog.tsx predated the auth-email sign-in flow; dashboard-nav.tsx had stale colour tokens and prop lists) and were regenerated verbatim from the current monolith blocks before wiring — reusable lesson: an orphaned prepared module is stale the moment the monolith copy keeps evolving; always re-diff before cutover. `global-mockup-search-shell.tsx` now imports `SettingsDialog` from the module. The dead `document-admin/` **directory** (shadowed by the live `document-admin.tsx` file in module resolution, imported by nothing) was deleted. Monolith: 4,373 → ~3,450 lines (orchestrator + data/state hooks + small render/stream helpers). Live-surface `data-testid`/`aria-label` corpus verified byte-identical across both moves.

## Phase 4 - Release maturity

### Readiness and clinical usefulness are separate acceptance gates (2026-09-13)

The RAG M2 merge did not establish live answer-quality improvement: the observed
public web deployment still preceded that merge. Newer builds started successfully
but failed readiness. A bounded production diagnostic timed out in site-content
bootstrap hashing. The health wrapper reused an expensive SQL CTE without an
explicit materialization boundary; the repair evaluates that evidence once per
statement while retaining every integrity check and the existing digest format.

With the committed 843-record bootstrap fixture on PostgreSQL 17.6.1.127, the
original RPC completed in 12.614 seconds; three candidate runs took 4.550–4.969
seconds and returned identical complete evidence. Missing records, altered render
payloads, digest mismatches and an invalid initialized transition remained rejected.
These are bounded local results, not hosted recovery or non-bootstrap performance
proof. `npm run check:production-readiness` still reports pending privacy/legal sign-offs;
the readiness repair does not clear those separate requirements.

- Prove the serving commit and effective answer route before attributing a clinical
  answer to merged code. Build, merge, deployment readiness and clinical usefulness
  require their own evidence; fixed-provider fact ties are not live quality gains.
- Exercise readiness with the committed full bootstrap fixture and a bounded
  request budget. Compare complete evidence and corruption handling before accepting
  a performance change; do not substitute longer timeouts or disabled checks.
- For clinician answers, declare required guideline-supported details before
  evaluating output. Topic relevance and citation presence alone do not establish
  useful monitoring instructions, timing or actions. Standard answers must include
  essential supported information; elaboration adds depth.
- A migration merge can automatically apply to production. Keep its PR unmerged
  until the production window is explicitly approved, then verify application,
  serving identity and actual answer quality separately. This readiness repair
  does not establish provider quality or close the remaining RAG programme.

- `npm run check:runtime` is the strict runtime gate and is part of `npm run verify:full`, `npm run verify:ui`, and `npm run verify:release` (not `verify:cheap`); it fails outside Node 24.x or npm 11.x when run through npm.
- CI runs `npm run check:runtime` after dependency install so branch verification cannot silently drift away from Node 24.
- `npm run check:edge:functions` is the Deno type gate for the Supabase `indexing-v3-agent` Edge Function.
- `npm run check:document-label-coverage` is the live Supabase generated-label coverage gate. Run it after ingestion batches, document reclassification, or generated-label migrations; zero indexed documents may be missing generated `site` or `document_type` labels.
- Tune the full-browser CI cadence if release branches or weekly schedules prove too slow or too sparse.
- Add explicit review ownership for clinical source governance, outdated-source handling, incident review, and decommission decisions.
- Record production-readiness outcomes in release notes whenever clinical workflow, source governance, privacy, or deployment assumptions change.

## Visual regression, style contracts and the pre-merge performance budget (2026-07-30)

Three gates added for the "mature repo" verification pass. Full usage is in
[`docs/testing.md`](testing.md); this records the reasoning and the remaining debt.

- **Problem addressed.** Nothing verified rendered appearance. `playwright.visual.config.ts` and
  `npm run test:e2e:visual` existed but pointed at `ui-visual-artifacts.spec.ts`, which only
  `testInfo.attach()`es four screenshots for a human to eyeball — there was no `toHaveScreenshot`
  call and no baseline directory anywhere in the repo. Separately, ledger #094 showed a style
  contract passing while the style was inert, and Lighthouse only ran against the deployed origin,
  after a merge had already auto-deployed.
- **Style contracts are required and deterministic.** `tests/ui-style-contract.spec.ts` joins
  `test:e2e:pr` through `productionSpecPattern`, so it blocks like any other production journey. It
  is Chromium-only by design (computed-style serialisation is engine-specific) and self-skips on the
  other engines in the release matrix. `tests/style-contract-registry.test.ts` closes the inventory
  so the next unlayered class cannot be added unnoticed.
- **Verified it bites, not just that it passes.** The contract was re-run against a production build
  with `.search-band` deliberately moved back into `@layer components`; it failed on
  `borderTopWidth` as intended, and passed once reverted. A gate that has never been observed to
  fail is not yet evidence of anything.
- **Pixel baselines are advisory on purpose.** `visual-baseline` in CI is `continue-on-error` and
  outside `pr-required`. Two reasons: no baselines are committed yet (the first run's artifact is
  what supplies them), and this repo has already paid for a sub-pixel rounding flake — the
  `min-h-11` → `min-h-12` tap-target change. Promote by adding the job to `pr-required` and dropping
  `continue-on-error` in the same edit, once baselines have held across a few runs.
- **Baselines must come from CI, not a laptop.** Paths are platform-scoped
  (`tests/__screenshots__/{platform}/`). Font hinting and antialiasing differ between a developer
  machine and the `ubuntu-24.04` runner, so a locally-generated baseline would make every CI run red.
- **The performance budget is relative, not absolute.** `lighthouse-budget.json` holds a committed
  per-route baseline and a per-metric tolerance, following `check:bundle-budget`. Absolute
  web-vitals thresholds are meaningless against localhost with no network latency. Enforcement is
  enabled; incomplete evidence fails closed, and numeric breaches use an initial sample plus two
  targeted confirmations with a majority verdict.
- **The baseline is browser-specific, and the browser is now pinned (2026-08-08).** Each baseline row
  records the `chromeVersion` that produced it, and a mismatch fails closed — a browser bump is
  otherwise indistinguishable from an application regression. The ambient runner-image Chrome is not
  pinned per commit (the fleet served HeadlessChrome/150 and /151 to jobs minutes apart on
  2026-08-07), so both Lighthouse jobs resolve Playwright's managed Chromium through one shared
  composite action, `./.github/actions/setup-lighthouse-chromium`. Refreshing is a `workflow_dispatch`
  input (`refresh_lighthouse_baseline`) that uploads a rewritten `lighthouse-budget.json` for a human
  to review and commit; it deliberately cannot push, because a workflow that rewrites a gate's own
  baseline is a gate that can green itself.
- **The budget runs on perf scope, not the ui/build union (2026-08-08).** `perf_changed` in
  `scripts/ci-change-scope.mjs` excludes `worker/**` and container surfaces, dependency manifests and
  the lockfile, Playwright/test surfaces, most of `src/app/api/**` (except the initial-load handlers
  `/api/setup-status` and `/api/local-project-id`), and `src/app/mockups/**`. `src/proxy.ts` stays in
  scope because it runs before every budgeted navigation. The lockfile exclusion is the one
  deliberate hole on the PR arm: the classifier sees paths, never the lockfile diff, so it cannot
  tell a devDependency bump from a React/Next bump. The push-to-`main` arm re-runs when
  `lockfile_changed` is true, and `check:bundle-budget` still covers the same PRs. If a runtime dep
  bump ever lands an unnoticed LCP regression despite that, teach the classifier to read the lockfile
  diff — do not put the whole lockfile back into perf scope.
- **Verification debt remaining.** (1) No pixel baselines are committed, so `visual-baseline` reports
  rather than gates until an operator adopts them from the CI artifact. (2) The Lighthouse budget was
  promoted to an enforced `pr-required` dependency on 2026-08-13 after two complete pinned-Chromium
  baselines stayed within tolerance and #147's CLS breach was resolved. This relative local-production
  guard does not close #117's separate deployed-origin LCP work.
  (3) 37 of the 38 unlayered visual classes carry exemptions rather than effect contracts — the debt
  is enumerated in `STYLE_CONTRACT_EXEMPTIONS`, and ledger #094 stays open until the load-bearing
  ones have contracts. (4) `scripts/run-lighthouse-budget.mjs` duplicates roughly 50 lines of the
  isolated-server boot in `scripts/run-playwright.mjs`; extracting a shared module was deliberately
  deferred rather than destabilise the required UI gate in the same change.

## Text formatting and copy conventions

- **Document-derived text must never be rendered raw.** Any value pulled from an ingested document — answer prose, exact quotes, source snippets, document titles, image captions, extracted table text — must be routed through a `source-text-sanitizer` (`src/lib/source-text-sanitizer.ts`) or `display-text` (`src/components/clinical-dashboard/display-text.ts`) helper before it reaches JSX. Verbatim quotes use `sourceTextForVerbatimQuote`; titles use `cleanDisplayTitle`; snippets/captions use `sourceTextForCompactDisplay`.
- `normalizeExtractedGlyphs` is the shared, lossless glyph-repair primitive (ligatures, soft hyphens, zero-width/control chars). It is wired into the base `compactWhitespace`/`readableWhitespace` cleaners and into ingestion (`buildChunks`), so every formatter and newly-indexed chunk inherits it. It must never strip clinical meaning (numbers, units, dose strings, comparison symbols, hyphens, or legitimate bullet structure). It deliberately does **not** rejoin line-break hyphenation — a soft-wrap hyphen is indistinguishable from a real compound hyphen (`low-dose`, `twice-daily`), so fusing would corrupt clinical compounds and verbatim quotes.
- `tests/rendered-text-formatting.test.ts` is a static guard that fails if a known content surface reintroduces a raw interpolation. Extend it when adding new document-derived render surfaces.
- **Compact snippet polish** (2026-07-02): `stripClassificationBanner` removes PSPF protective-marking banners ("OFFICIAL", "OFFICIAL: Sensitive" — ALL-CAPS, line-anchored only) from compact/snippet/synopsis/title surfaces and from newly-built synopses; verbatim quotes keep banners by design. Inline bullet glyphs in compact previews become `"; "` separators (the `readableTableRows` joiner). `repairTruncatedCompactTail` repairs stored mid-word truncations ("where poss..."); ingestion now truncates synopses at word boundaries (`truncateAtWordBoundary` in `chunking.ts`), so this repair mainly serves pre-fix stored rows.
- **Static UI copy** (headings, empty states, error/toast messages, placeholders, starter prompts) lives in `src/lib/ui-copy.ts`, alongside `app-modes.ts` (mode labels) and `source-metadata.ts` (status labels). Do not hardcode new visible chrome copy inline.
- `scripts/backfill-text-normalization.ts` cleans already-stored `document_chunks` text in place using the same primitive. It is dry-run by default, requires `--write --confirm` to mutate, writes a revertible JSON backup first, and **never re-embeds** — existing vectors are frozen, so retrieval is unchanged by construction.

## Known limits

- Chromium UI coverage is active in CI on all branches; Firefox and WebKit run in the gated release-browser CI job and remain available locally through `npm run test:e2e` and `npm run verify:release`.
- The new accessibility media smoke verifies usability and layout in reduced-motion and forced-colors modes; it is not a full WCAG audit.
- The format gate intentionally ignores `.tmp-visual/` and `scratch/`; those folders are local investigation output, not release source.
- Process scripts do not commit, push, deploy, mutate Supabase data, or run dependency updates.
- `npm run check:indexing` includes local OCR prerequisites (`fitz`/PyMuPDF, `pytesseract`, and the Tesseract binary). A failure at that prerequisite step is local machine setup debt, not evidence that indexed production data or search behavior regressed.
- Supabase performance-advisor `unused_index` INFO items are monitored, not automatically fixed. Do not remove search/RAG support indexes until live query evidence, local explain/verification, and rollback planning show the index is safe to drop.

## Route sitemap guard (2026-07-03)

- Route, navigation, redirect, app-mode, registry-slug, and mockup-route changes must run `npm run docs:update` and `npm run sitemap:check` so `docs/site-map.md` stays aligned with `src/app`, `src/lib/app-modes.ts`, Services/Forms registry fixtures, Differentials, and medication detail routes.
- `npm run verify:full` includes `npm run sitemap:check`; a stale sitemap is treated as process drift, not a documentation nicety. (`verify:cheap` does not run it.)
- Keep `docs/site-map.md` as the human-readable route map for now. If it becomes too large for review, split into a concise `docs/site-map.md` summary plus a generated `docs/site-map.generated.md` inventory, and update `scripts/generate-site-map.ts` / `tests/site-map.test.ts` in the same change.

## Automatic documentation synchronization (2026-07-30)

- `npm run docs:update` regenerates `docs/site-map.md` and refreshes the exact `scripts/` file and
  `package.json` command counts in `docs/scripts-index.md`.
- `.githooks/pre-commit` runs the affected part of that update for staged route/catalog/mockup or
  script/package changes, and runs `docs:check-index` for staged app/lib/schema changes. Ordinary
  component-only commits avoid the sitemap generator. If generated or module-map documentation is
  still unstaged, the hook stops so the author can review and stage the diff. It never auto-stages
  or commits files. It also refuses mixed staged/unstaged generator inputs so the generated docs
  cannot accidentally describe work outside the commit. Use `SKIP_DOCS_SYNC_HOOK=1` only as an
  explicit one-commit bypass.
- `docs:check-inventory` is blocking in `verify:full` and CI, alongside `sitemap:check` and
  `docs:check-index`, so bypassing the local hook cannot merge stale generated facts.
- Semantic descriptions in `docs/codebase-index.md` and curated script grouping still require human
  judgment. The hook detects top-level module/route/schema gaps but does not invent architecture
  descriptions or ledger evidence.

## Retrieval RPC drift & indexing hygiene (2026-07-01)

- The four app-path hybrid retrieval RPCs (`match_document_chunks_hybrid`, `match_document_embedding_fields_hybrid`, `match_document_index_units_hybrid`, `match_document_memory_cards_hybrid` + its `_v2` core) had live-only performance fixes applied via raw SQL that were never captured in migrations, so a `supabase db reset` / branch DB reproduced the slow pre-fix shapes. Migration `20260701140631_codify_live_retrieval_rpcs` codifies the live definitions (validated byte-equivalent to live via whitespace-stripped `pg_get_functiondef` md5 before applying — a confirmed no-op on live), and `supabase/schema.sql` was reconciled to match. A clean replay now reproduces production retrieval.
- **Rule: never change a retrieval RPC (or any function) on the live project with raw `execute_sql`.** Go through a committed migration plus a `supabase/schema.sql` update. Raw-SQL edits are exactly how this drift accumulated.
- `search_schema_health()` runs an execution smoke (invokes each hybrid RPC with a zero vector) that surfaces through `npm run check:indexing`; it fails if an RPC regresses to an error state (e.g. the historical `42702` ambiguous-id break). This is the standing guard against the original bug class.
- **Migration `20260702014803_drop_legacy_vector_indexes` (applied 2026-07-02 with explicit user approval)** reclaimed ~4.4 GB of dead/duplicate vector indexes (embedding_fields ivfflat 3.66 GB @ 8 scans, chunks ivfflat 610 MB, index_units HNSW 640 MB @ 0 scans, plus dead btrees). Verified post-apply: all targets gone, `detect_legacy_ivfflat_indexes()` empty, DB 13 GB -> 8.6 GB, `search_schema_health()` ok. The documented follow-ups are done: `supabase/schema.sql` now declares the live-kept embedding-fields indexes (`owner_id_idx`, `source_chunk_id_idx`, `search_tsv_chunk_gin_idx`, `owner_document_created_idx`, `meta_rag_indexing_version_idx`) instead of the dropped ones, no longer creates the index_units HNSW index, and `tests/supabase-schema.test.ts` asserts the new shape. There is intentionally no HNSW index on `document_index_units.embedding` — re-add only if that RPC gains a vector-first candidate path.
- **`search_schema_health()` two-lineage divergence: RESOLVED** by `20260702021604_reconcile_search_schema_health_superset` (applied live 2026-07-02, verified `ok:true`). The single definition now carries the comprehensive signature checks (incl. `match_document_memory_cards_hybrid_v2`), the full 22-entry required-index list (post-drop: no index_units HNSW, memory_cards HNSW added; every entry verified present live before shipping), the legacy-ivfflat report, AND the hybrid-RPC execution smoke. schema.sql matches exactly (the migration is extracted from it).
- **Known follow-up debts (documented, not actioned):**
  - Live migration history has duplicate-version churn (two each of `api_rate_limits`, `audit_logs`, `rag_queries_retention`, `audit_logs_service_role_policy`, `indexing_reliability_recovery`) from the same raw-apply habit. Do not rewrite history; treat as a caution for future applies.
  - Auth server is capped at 10 absolute DB connections (Supabase advisor); switch to percentage-based allocation in the dashboard before scaling instance size (not settable via SQL/MCP). **Exact operator path + verification now documented: `docs/auth-connection-cap-runbook.md`** — the flip itself remains a pending operator dashboard action.
  - **`storage_cleanup_jobs` indexes: RESOLVED 2026-07-08** — `20260703030000` + `20260708000000_reapply_storage_cleanup_jobs_indexes` applied and verified on live (see `docs/archive/operator-decisions-2026-07-06.md`).

## Live database drift reconciliation (2026-07-05)

- **RESOLVED:** `indexing_v3_agent_jobs` table + `claim_indexing_v3_agent_jobs` + `update_indexing_v3_agent_job_status` were recorded as applied but absent on live. Migration `20260705230000_reconcile_live_database_drift` idempotently re-applied them; live verified post-push.
- **RESOLVED:** `match_document_embedding_fields_text` codified with service_role-only execute.
- **RESOLVED (2026-07-08):** `match_document_embedding_fields_text` owner-sentinel fix (`20260706130000`) applied to live; latent until the `_text` RPC is wired into app code.
- **RESOLVED:** `rag_visual_eval_*` tables codified with service_role-only RLS.
- **RESOLVED:** Live-only `20260705133000_tighten_search_document_chunks_owner_scope` mirrored in `schema.sql`.
- **RESOLVED (2026-07-08):** `indexing-v3-agent` edge function deployed (version 53, JSONB status-RPC parsing live — see `docs/archive/operator-decisions-2026-07-06.md`).
- **Operator-only:** publishable key rotation (`docs/archive/operator-decisions-2026-07-04.md`).

## Full-inventory drift detection & DR rehearsal (2026-07-07)

- `npm run check:drift` generalizes the `search_schema_health()` single-hash approach into a full-inventory comparison of every live function (normalized `pg_get_functiondef` hash + ACLs), index, RLS policy, table shape, constraint, trigger, view, and storage bucket against `supabase/schema.sql`. Expected state is `supabase/drift-manifest.json` (generated by `npm run drift:manifest`, which replays schema.sql from scratch into a Docker container — so schema.sql replayability is re-proven on every regeneration); known divergence lives in `supabase/drift-allowlist.json` with per-entry reasons. Offline halves (manifest freshness, migration↔schema.sql snapshot parity, allowlist hygiene, engine unit tests) run in `verify:cheap` via `tests/drift-detection.test.ts`. See [docs/database-drift-detection.md](database-drift-detection.md).
- The 2026-07-07 three-way audit (live vs schema.sql replay vs migration-chain replay) found 166 divergent keys: worker-written columns existing only on live (codified by `20260707000000`), schema.sql not replayable from scratch (fixed), pending migrations explaining 11 function-body drifts, `20260703030000` **recorded as applied but ineffective on live**, live-revoked authenticated grants, and a large legacy index estate. Full classified backlog in the drift doc.
- DR rehearsal completed: schema restore ≈ 19 s to a local container, `search_schema_health()` ok and all four hybrid RPCs proven on the restored copy with seeded vectors; measured RPO/RTO and the did-not-survive list are in [docs/disaster-recovery-runbook.md](disaster-recovery-runbook.md). Expand/contract policy for retrieval tables added to [docs/supabase-migration-reconciliation.md](supabase-migration-reconciliation.md).
- Migration `20260706200000_schema_drift_snapshot.sql` (the snapshot RPC) and `20260707000000_codify_live_observed_drift.sql` were **applied to live 2026-07-08** (see below).

### Pending-migration apply + retrieval-drift discovery (2026-07-08)

- **Applied to live** (via MCP `apply_migration`, each verified byte-faithful against a Docker replay, `search_schema_health` ok, site retrieval smoke green): `20260706010000` (search_schema_health M13 guard), `20260706130000` (embedding-fields-text owner sentinel — not app-called), `20260706200000` (schema_drift_snapshot RPC — enables `check:drift`), `20260707000000` (codify observed drift — no-op on live), and `20260708000000_reapply_storage_cleanup_jobs_indexes` (re-applies `20260703030000`'s effects, which were recorded-but-absent on live).
- **`20260705210000_retrieval_owner_filter_sentinel` was NOT applied and was NEUTRALIZED.** The pre-apply investigation found live has **diverged forward** from that migration's retrieval bodies via later raw-SQL work never captured in a migration: `match_document_chunks` carries an `hnsw.ef_search=100` plpgsql wrapper (higher vector recall), and `match_document_chunks_text` / `match_document_table_facts_text` carry richer multi-strategy implementations. Applying it would have **regressed live retrieval quality**. Its owner-sentinel purpose was already live and identical. The correct fix is forward-codification of the live bodies (drift backlog), not applying the old migration.
- **Live is under active concurrent multi-session editing** — during this work a new `corpus_topic_term_stats` function appeared and `search_schema_health` re-drifted minutes after apply. The drift allowlist is therefore an explicit point-in-time snapshot needing periodic regeneration.
- `apply_migration` records history rows under a current-UTC version with the passed name (documented churn), not the repo file's version number; re-applying the repo files later is a harmless idempotent no-op.

### July 8 ingestion & tenancy batch — merged to main, pending live apply (2026-07-09)

PRs **#380**, **#405**, **#408**, **#409** landed ingestion RPC hardening (R1/R2/R7/R9/R23), R17
one-open-job index, R5 metadata deep-merge, and `retrieval_owner_matches` fail-closed. Migrations are
in `supabase/migrations/` but **not yet verified on live** as of 2026-07-09. **Do not redeploy the
ingestion worker from current `main` until `20260708130000` is live** — `worker/main.ts` already
passes `p_worker_id`. Ordered apply steps, R17 manual `CONCURRENTLY` index, and post-apply probes:
[`docs/archive/operator-apply-july8-batch.md`](archive/operator-apply-july8-batch.md) · `npm run check:july8-live-batch`.

## PR merge gate: risk-scoped CI + required aggregate (2026-07-10)

- CI now has one always-reporting required aggregate: `CI / PR required`. The aggregate depends on `changes`, `static-pr`, `safety`, `coverage`, path-scoped `ingestion-sast`, `build`, `container-images`, `ui-critical-fast`, `ui-critical`, `lighthouse-budget`, and `db-reset-verify`, then enforces only the jobs whose scopes apply. The aggregate keeps `if: always()` and labels concurrency `cancelled` distinctly from real failures (#095 / PR #1409); it stays red because a skipped required check would count as passing.
- `static-pr` is the deterministic always-reporting baseline for every PR: runtime/install parity, scope and verification-plan self-tests, and changed-file formatting always run. Documentation and workflow-only scopes add focused contracts; executable or unknown scope adds lint, typecheck, coverage, and safety/config/RAG. Build, production UI, and migration replay remain independent jobs so reruns stay focused.
- `db-reset-verify` is path-scoped to Supabase migrations/schema/`src/lib/supabase` and drift tooling — not every API route. Do not also require an external Supabase Preview replay unless the repo owner intentionally wants duplicate migration replay.
- `ui-critical` retains its job ID for branch-protection compatibility. On pull requests / merge_group, it starts concurrently with `ui-critical-fast`; the fast job owns `@critical` and the duration-balanced shards exclude that subset, while `PR required` independently requires both. On main/schedule/ordinary dispatch, the fast job skips and the shards retain the complete production set. `src/app/api/**` does not set `ui_changed`; `.github/actions/setup-ui-e2e/**` does. `ui-advisory` runs quarantined and mockup journeys together when UI scope applies. A JUnit failure is considered a known flake only when its exact spec/title matches the validated ledger. The release browser backstop remains unconditional on release branches/manual/scheduled runs, is risk-scoped on `main`, and depends on static/build/UI success — not on `pr-required` — so a blocking scheduled dependency audit cannot skip Firefox/WebKit (#023 structural half). It does not pre-build because `run-playwright.mjs` owns the isolated build, and it avoids rerunning production Chromium after an in-run success.
- Secret Scan pins Gitleaks to the workflow event base/head SHAs and the checked-out commit (`scripts/run-gitleaks-pinned.mjs`) so a concurrent push cannot invalidate the range (#097).
- The 2026-07-13 cold-server and historical ledger candidates are tracked through the reproduction policy in `docs/testing.md`: run each three times on the same SHA, fix fail/pass races, treat deterministic failures as regressions, and remove entries that do not reproduce. On `0c56f27a3`, the historical composer/tap/answer-fallback entries and three cold-route candidates did not reproduce in three runs; the narrow differential viewport reproduced once in three cold runs, was fixed with route-specific readiness before its single submit, then passed three of three. The ledger is intentionally empty.
- Branch protection for `main` should require `CI / PR required` and `Secret Scan / Gitleaks`. The narrow blocking ingestion scan and perf-scoped Lighthouse budget are already enforced inside `PR required`; the Semgrep engine image is immutable, while its public registry rules remain mutable/network-backed and fatal tooling failures receive two bounded retries. Keep the separate advisory `SAST / Semgrep` context non-required. Container-affecting PRs are enforced through `CI / PR required`; do not separately require `Docker image build / app-image` or `Docker image build / worker-image`. Also do not require other path-filtered or scheduled/manual contexts such as `CI / Unit coverage`, `CI / Critical UI smoke`, `CI / Migration replay`, `CI / release-browser-matrix`, `Eval Canary`, or `Live drift check`; they can be skipped on ordinary PRs and would leave branches stuck at "Expected - Waiting for status to be reported."

## CSS cascade layering (2026-07-02)

- The custom component classes in `src/app/globals.css` predate cascade layers, so they sat unlayered and silently beat Tailwind v4 utilities (which live in `@layer utilities`) on the same element. This caused three shipped UI bugs: the header source ledger ignoring responsive `hidden`, the composer clear button covering typed text (`pr-*` defeated), and the standalone-home status chips sliding under the mode pill.
- Conflict-free helper classes (`app-edge-backdrop`, `mobile-app-shell`, `mobile-popover-scroll`, `citation-link`, `animate-skeleton-shimmer`, `focus-ring-premium`, `source-capsule-hover`, `polished-scroll`) now live in `@layer components`, so utilities override them normally. Their call sites were audited for same-property utility collisions before the move.
- **Header chrome now layered (2026-07-02):** `edge-glass-header` (+ responsive padding), `universal-header`, `universal-header-mode-button`, and `universal-header-icon-control` moved into `@layer components`. The header/mode-pill was the source of the recurring overlap+shadow bugs, so utilities on those elements now win. Reconciliation was three call-site shadow edits (drop the dead `shadow-[var(--shadow-tight)]` on the two `edge-glass-header` headers; drop `shadow-[var(--shadow-inset)]` on the mode button and the New-chat icon control so the layered class supplies the shadow directly). Proven byte-identical across 16 states with `scripts/capture-chrome-parity.ts`.
- **Verification tooling:** `scripts/capture-chrome-parity.ts` dumps `getComputedStyle` (incl. `::placeholder`/`::after`) for the header+composer chrome across home/answer/focus/document × mobile/desktop × light/dark and diffs two snapshots. **Gotcha:** it is only reliable once the dev server has fully settled on the current CSS — capture right after a hot-reload and it silently compares against the stale bundle. Always capture twice and confirm the two agree before trusting a diff.
- **Remaining debt (grew with PR #171) — pill portion resolved 2026-07-08:** the COMPOSER chrome (`answer-footer-search-*`, `universal-home-search-edge`/`universal-top-search-edge` (the home-composer edges), `document-mobile-search-pill`, `*-composer-edge`) was intentionally unlayered. #171's frosted rework pushed these from ~19 to ~92 computed-style conflicts, concentrated in the shared `ui-primitives` constants (`chatComposerShell/Input`, `chatSendButton`, `chatComposerIconButton`). The **pill surface** is now layered via a `chatComposerShell` base/delta split (next bullet); the pill-interior controls and the positioning chrome stay unlayered for the reasons below. When adding a utility to a still-unlayered composer-chrome element, check the class body first — the class wins.
- **Composer PILL surface now layered (2026-07-08):** the base/delta split shipped for the pill. `chatComposerShell` (the pill's shared `ui-primitives` constant) is split into `chatComposerShellBase` (utilities the pill class does NOT set — `flex items-center rounded-full border`) and `chatComposerShellDelta` (utilities the class ALSO sets — `min-h-14 gap-2 border-colour bg px-2 shadow focus-within:border`). `chatComposerShell` stays `base + delta` (byte-identical class set) for any non-layered caller. The pill call sites (`master-search-header.tsx`, `universal-search-command-mockups.tsx`) pass `chatComposerShellBase`, so `.answer-footer-search-pill` (+ `:hover`/`:focus-within`/`@640`) moved into `@layer components` with **zero computed-style change** (16/16 parity states byte-identical). The pill is a `<form>`, so no global element reset competes with it.
  - **Why the pill-interior controls (`answer-footer-search-input/-send/-action`) were NOT layered — and why the earlier "reverted, nothing shipped" attempt misread this:** the controls land on `<input>`/`<button>` elements, and `globals.css` has three **intentionally-unlayered** global resets that target those elements — `button,input,textarea,select { font: inherit }`, the `@media(max-width:640px)` 16px `font-size` floor (explicitly unlayered to beat `text-*` utilities), and `button,a,summary { transition-property: …; transition-duration: var(--duration-fast) }`. Unlayered rules beat **all** `@layer` rules, so an unlayered chrome control class wins by specificity (baseline), but moving it into `@layer components` drops it **below** those resets → the input reverts to inherited font (16px/400/24px instead of 18px/560/1.2) and the send button to the reset's transition (`var(--duration-fast)` ≈ 0.12s instead of the chrome 0.16s). A prior 2026-07-08 pass hit exactly this regression, reverted everything, and blamed "a Tailwind-v4 layer-ordering subtlety where a fresh `@layer components` block loses to `@layer utilities`." **That diagnosis was wrong:** the hand-authored `@layer components` block resolves correctly (utilities > components as intended — the pill proves it); the controls regressed because of the unlayered element resets, not layer order. Layering the controls also **gains nothing** — a `text-*` utility on the input can't beat the unlayered `font: inherit` either. So the controls (and their `chatComposerInput`/`chatSendButton`/`chatComposerIconButton` constants) stay unlayered/unsplit, exactly as baseline. Making them layerable would require moving the three global resets into `@layer base`, an app-wide change to every input/button that is out of scope here (and would break the 16px iOS floor's intent).
  - Also deliberately kept UNLAYERED: the composer POSITIONING chrome (`*-composer-edge`, `*-search-edge/-dock/-backdrop`, `-pill-open`, `document-mobile-search-*`, and every descendant-combinator override) — their conflicts are with inline responsive position utilities (not the shared constants) and are not parity-covered. `desktop-home-search-*` from the old debt note no longer exists in the code. `DocumentViewer`'s bottom composer is hand-rolled inline (no constants, no pill class) so it was untouched. Proven byte-identical across 16 states with `scripts/capture-chrome-parity.ts`. **Capture gotcha bit hard this pass:** Turbopack CSS HMR served the stale (pre-change) bundle after `git stash`, silently contaminating the diff in both directions; the reliable protocol is **kill server → `rm -rf .next` → fresh `ensure` → warm routes → capture** once per code state, then compare (never compare across an HMR CSS change on the same server).
- `tests/ui-overlap.spec.ts` is the standing regression guard for the visible symptom (overlapping header controls, composer clear-button geometry) across 640-1536px widths.

## Cross-browser test robustness under client-only rendering (2026-07-02)

- Making the dashboard and document viewer client-only via `dynamic(..., { ssr: false })` (PRs #144/#147) meant "page loaded" no longer implies "app mounted". Firefox/WebKit paint the client chunk later than Chromium, so three release-browser-matrix specs raced and failed on `main` while Chromium stayed green. All three were test-timing gaps, not product regressions — the app renders correctly in every browser.
  - `tests/ui-overlap.spec.ts`: `gotoHome` waited on `networkidle` (Playwright discourages it) and then measured the header, which had not mounted yet — every failure was `header#search not found` (count 0), never a real overlap. Now waits for `header#search` to be visible before measuring.
  - `tests/ui-tools.spec.ts` (forms detail → shared search): the shell re-synced its query from the URL on mount via `requestAnimationFrame`, which on Firefox/WebKit could land just after a programmatic `fill` and wipe the value (button stays disabled) or drop the submit before the router navigates. The fill-and-submit runs as one `toPass` unit that retries until the search routes. **Root-cause fix (see the 2026-07-03 follow-up below):** `GlobalMockupSearchShellClient` no longer uses a `requestAnimationFrame` sync at all — it seeds the composer mode/query from the URL and re-syncs only when the search string actually changes, so a mount-time frame can never wipe an in-progress fill.
  - `tests/ui-stress.spec.ts` (desktop evidence panel): the evidence `<details>` is opened by focusing its `<summary>` and pressing Enter; in CI WebKit the key event could fire before focus landed, so it never toggled. Now asserts `toBeFocused()` before pressing Enter.
- Rule of thumb for these client-only surfaces: never gate an interaction on `networkidle` or a bare `goto`. Wait for the specific mounted element, and wrap fill→submit→navigate races in `toPass` (the same idiom `openAppModeMenu`/`openDailyActions` already use). The `verify` + `ui-smoke` PR gates run Chromium only, so Firefox/WebKit-specific races surface solely in the gated `release-browser-matrix` (main/release/dispatch/schedule) — keep that job green rather than letting these re-accumulate.
- **Post-merge outcome (PR #178):** `ui-overlap` and `ui-stress` fixes verified green in CI WebKit. `ui-tools.spec.ts:264` (forms-detail search) still failed on **CI WebKit only** — the composer input stayed focused-but-empty and the submit disabled across the full retry, and it did **not** reproduce on local WebKit, so it couldn't be iterated locally. PR #186 added an interim `isDetailPage` guard to the mount `requestAnimationFrame` but stayed `[WIP]`, keeping a `if (browserName === "webkit") return;` early-return that ran only the **structural half** on WebKit.
- **Follow-up resolution (2026-07-03):** removed the `requestAnimationFrame` mount sync in `GlobalMockupSearchShellClient` entirely. The composer mode/query are now seeded from the URL at initial state, and a `lastSyncedSearchParamsRef` gates the re-sync effect so it fires **only when the search string actually changes** (a real navigation). Because typing never changes the URL and the initial mount is a no-op, no deferred frame can wipe an in-progress `fill` on a no-query detail route — the CI-WebKit-only race. This also retired the `isDetailPage`/`previousUrlHadQueryRef` special-casing from PR #186. With the race fixed at the source, the WebKit early-return and its comment were deleted from `ui-tools.spec.ts:264`, so all three browsers now verify the full submit-and-route wiring. Ruled out earlier (and still true): the inline `availableModeIds={["forms"]}` arrays are stable because those layouts are Server Components.

## Suspense fallback must not re-render page children (2026-07-02)

- `GlobalMockupSearchShell` (aka `GlobalSearchShell`, used by the `forms`/`services`/`favourites`/`medications` layouts) wrapped `GlobalMockupSearchShellClient` in a `<Suspense>` whose **fallback also rendered `props.children` inside `#main-content`** — the same subtree the client body renders. Because `useSearchParams()` forces that boundary to the fallback on the server, the page subtree was emitted twice and both copies could persist, producing duplicate `id="main-content"` and duplicate `data-testid` on every shell page. It surfaced as `ui-smoke.spec.ts:1103` failing with a strict-mode violation (two `data-testid="acamprosate-medication-page"` `<main>` elements on `/medications/acamprosate`).
- Fix: the Suspense fallback renders a **neutral placeholder only** — never `props.children`. Rule: do not render the resolved content inside its own Suspense fallback; the fallback is a loading state, not a second copy of the page.

## useSearchParams Suspense must not wrap route children (2026-07-26)

- Removing `ClientHydrationBoundary` around standalone shell `{children}` restored mode-home RSC paint, but left route segments nested inside the shell’s `useSearchParams()` Suspense. Next streamed the page root into a hidden completion template (`<div hidden id="S:N">`) while the live shell also mounted the same `data-testid` root. Playwright’s strict `getByTestId` counts hidden nodes, so Production UI failed on `/forms`, `/favourites`, and differentials presentations under CI load even though the a11y tree showed one `main`.
- Portal ready-gating fixed React #418 (hydration) but not this duplicate-root class.
- Fix: `isAlwaysStandaloneShellPath` skips the outer searchParams Suspense for namespaced routes; standalone chrome reads params via a mount-gated `ShellSearchParamsBridge` sibling so `{children}` stay outside that boundary. Keep mode-home RSC paint; do not restore full-shell `ClientHydrationBoundary`.

## Clinical registry tables applied live (2026-07-03)

- **Migration `20260703020000_clinical_registry_records.sql` (applied live 2026-07-03 with explicit user approval)** created `public.clinical_registry_records` (owner-scoped structured Services/Forms records — 30 cols, JSONB render payloads, conservative `source_status`/`validation_status` governance columns) and the `public.clinical_registry_record_sources` join table (record ↔ verifying corpus document, FK cascade). Both are service-role-only RLS (enabled + revoked from anon/authenticated + a single `for all to service_role` policy); ownership is enforced in the API layer, matching the documents model. Verified post-apply: both tables present with correct columns, RLS enabled, 0 rows; `get_advisors(security)` returns no lints. `supabase/schema.sql` mirrors the migration and `tests/supabase-schema.test.ts` asserts the shape.
- **Version-recording nuance:** the MCP `apply_migration` timestamps the history row in UTC, so live recorded the migration as version `20260702183308` (name `clinical_registry_records`) while the repo file is `20260703020000_...` (Australia/Perth date). Because the migration is fully idempotent (`create table/index if not exists`, `drop trigger/policy if exists` + create), a later `supabase db push` re-applying the repo file is a harmless no-op that only adds a second history row — the same known duplicate-version churn already present in live history. Do not rewrite history to reconcile; treat as a caution.
- **Remaining step (user):** seed the registry per owner with `npm run registry:seed -- --owner-id <uuid> --write --confirm`. Until seeded, authenticated users see the honest empty-registry state; demo/env-less deployments are unaffected. See [[PR #209]].

## Nondeterministic "unsupported" retrieval — finding #11 needs Phase 2 (2026-07-03)

- **Symptom (rag-hybrid-findings finding #11):** valid clinical topics phrased as bare low-confidence queries ("bipolar disorder", "anorexia management") intermittently return 0 results (`unsupported_short_circuit`) instead of an answer.
- **Root cause (confirmed live):** the soft-tail branch of `shouldShortCircuitUnsupportedSearch` (`src/lib/rag/rag.ts`) fires on `analysis.queryClass === "unsupported_or_general"`, and that class is set by `analyzeQueryWithClassifierFallback`, which calls a **generative LLM classifier** (6s timeout, `reasoningEffort:"low"`, uncached) for low-confidence queries. That call is nondeterministic: it reclassifies "bipolar disorder" to a supported class on some runs (→ answered) and declines/times-out on others (→ short-circuited to 0). Reproduced with a same-process ×N probe.
- **Why a clean Phase-1 fix does NOT exist:** the deterministic analyzer carries **no signal** distinguishing in-corpus topics from out-of-corpus (bipolar, anorexia, gout, DKA all produce identical `unsupported_or_general`, confidence ≈ 0.40, `canonicalTerms` = query tokens). Only the corpus can tell them apart. Removing the soft-tail short-circuit fixes the valid topics but **regresses `unsupported_correct_rate` 1.0 → 0.79** on `eval:quality --rag-only`: a lexical distinctive-term relevance gate in `chooseAnswerRoute` either over-refuses legitimate semantic/vector matches (whose exact term is not in the retrieved text — e.g. the `rag-routing.test.ts` "admission" fixtures) or under-refuses invented terms ("florbizone syndrome") that score strongly on generic scaffolding words ("syndrome"/"management"). The corpus is broad (gout 13 / crohn 49 / appendicitis 30 / angioplasty 32 / bipolar 719 chunks), so almost no common medical term is truly absent — grounded low-confidence answers, not fabrication, are the realistic worst case for real terms; only genuinely invented terms should refuse.
- **Decision (2026-07-03):** the risky change (soft-tail removal + relevance gate + invented-term eval controls) was **reverted**; only a safe, independent hardening was kept — `fetchEnabledRagAliases` no longer caches `[]` on a transient `rag_aliases` read error (which would suppress alias expansion for the whole TTL). Finding #11 is **re-scoped into RAG optimisation Phase 2** ("fit retrieval to content"), where it should be fixed with corpus-grounded relevance — IDF/corpus-frequency weighting of query terms and/or the semantic relevance model, plus the data-driven query-understanding vocabulary (RC6) so the deterministic classifier recognises in-corpus topics up front. Any gate must keep `eval:quality --rag-only` `unsupported_correct_rate` at 1.0 (add invented-term controls like "florbizone syndrome management" / "quxbyria disorder treatment" once it can pass them) while letting valid bare topics answer. A cheaper interim option worth measuring first: **classifier-verdict memoization** to at least make the current behaviour deterministic per query.
- **RESOLVED (2026-07-07, `claude/retrieval-correctness`):** the Phase-2 corpus-grounded fix shipped. `corpus_topic_term_stats` (migration `20260707100000`, applied live) reports per-term title-topic membership (with a measured 5% genericity ceiling — "management"/"guideline" headline ~18–20% of titles and are scaffolding; real topics ≤3%) and chunk-level presence, scoped with the exact retrieval `owner_filter`. `src/lib/corpus-grounding.ts` + the `analyzeQueryWithClassifierFallback` hook classify only the soft-tail branch (pattern-guarded refusals and higher-confidence classes untouched): in-corpus bare topics deterministically reclassify to `broad_summary` and answer; corpus-absent queries skip the LLM and refuse deterministically (trigram correction still runs); inconclusive keeps memoized-LLM behaviour; DB errors fail open. Verified live: "bipolar disorder" / "anorexia management" answer 4/4 runs with the right document at rank 1 (new golden cases `bare-topic-bipolar` / `bare-topic-anorexia`); "florbizone syndrome management" / "quxbyria disorder treatment" refuse 4/4 runs (new `ragEvalCases` controls); golden eval 36/36.

## Retrieval changes must pass the golden eval before merge (2026-07-03)

- **Any PR that touches retrieval, ranking, selection, chunking, or scoring MUST run `npm run eval:retrieval:quality` (36/36) locally before merge** and paste the summary in the PR. CI cannot run it (it needs live Supabase + OpenAI keys), so it is a manual gate — now a checkbox in the PR template.
- **Why (measured):** PR #118 caught a main-side change (uncapped candidate score + blanket source-governance metadata weighting in `retrieval-selection.ts`) that regressed the golden set 23/23 → 16/23 (doc-recall@5 1.0 → 0.76) on the partially-enriched corpus. `verify:cheap` was green throughout — only the golden retrieval eval surfaced it. Unit tests do not exercise live ranking, so they cannot substitute.
- **Standing constraint (do not relearn):** source-governance metadata (`document_status`/`clinical_validation_status`/`extraction_quality`) must NOT weight retrieval **selection ordering**, and candidate relevance scores must stay clamped. Live scores saturate at 1.0 and the corpus is only partially enriched (unenriched → unknown/unverified), so metadata weighting buries correct documents. Governance belongs in ranking penalties and the answer/source-governance layer. See [[no-governance-weighting-in-retrieval-selection]] and `docs/rag-hybrid-findings-and-todo.md` (RC8).
- **Answer-generation changes** (synthesis prompt, post-processing) additionally run `eval:rag --limit 15` + `eval:quality --rag-only` (grounded-supported must not drop; citation-failure 0). A new opt-in `npm run eval:answer-quality` reports a structural per-intent **targeting** metric (informational) for measuring how precisely answers hit the asked question.

## Audit P2/P3 follow-up (2026-07-06)

- **P0 carry-over (PR #278 / `cursor/audit-p2-p3-hardening-b54f`):** RAG cache owner/indexing-version guards, synopsis parity in ranking/detectors, DELETE TOCTOU re-check, worker cache invalidation on job completion, and `RAG_QUERY_HASH_SECRET` required in production-like readiness checks.
- **P2 M13:** `20260702000000_commit_generation_preserve_legacy_artifacts.sql` must be applied to live Supabase before reindex commits can safely purge legacy NULL-generation rows. After apply, run `npm run check:m13-migration`, `npm run reindex:health`, and `npm run check:indexing`. `search_schema_health()` now reports `commit_document_index_generation.preserve_legacy_artifacts_migration` when the live function body is stale.
- **P2 upload hardening:** `/api/upload` consumes the `document_upload` rate-limit bucket (12/min owner, 3/min anonymous).
- **P3 dispositioned (no code change):** L9 searchable-only `image_count` (documented in `worker/main.ts`); L11 triple `readFile` peak-memory trade-off (documented at the ingestion site); L18 duplicate `audit_logs` policy in an already-applied migration (do not edit applied migrations — consolidate only if migrations are ever squashed).
- **L19 RESOLVED — CSP `script-src` nonce migration (branch `claude/csp-nonce-migration`).** Production `script-src` is now `'self' 'nonce-<per-request>' 'strict-dynamic'` (no `'unsafe-inline'`, no `'unsafe-eval'`); the nonce is generated per request in `src/proxy.ts`, threaded into SSR via the `x-nonce` + CSP request headers, and applied to Next's own bootstrap/bundle/flight scripts automatically plus the one hand-authored inline script (theme-flash guard in `src/app/layout.tsx`). Every other CSP directive and security header is unchanged; the static (non-CSP) headers still come from `next.config.ts` → `buildSecurityHeaders`. **Development keeps the pre-migration `'self' 'unsafe-inline' 'unsafe-eval'` (no `'strict-dynamic'`)** because the Turbopack dev server injects non-nonced HMR/route-chunk `<script>` tags that `'strict-dynamic'` would block. **Dedicated UI verification (why L19 was deferred):** `npm run build`, full-Chromium `npm run verify:ui`, and a scripted prod-server (`next start`) console sweep of answer / search / document-viewer / auth flows confirming **zero** `securitypolicyviolation`. That sweep surfaced a pre-existing (already blocked under the old prod policy) benign eval violation from Zod 4's JIT probe (`new Function("")` in a swallowed try/catch); it is silenced by setting Zod `jitless` on the client in `src/instrumentation-client.ts` (server keeps JIT — no CSP there).

## Design convergence & type-scale ratchet (2026-07-06)

- **`docs/design-system/README.md` is now the front door** for all UI work: token contract, type-scale rules, z-index ladder, Sheet-only modals, a11y requirements, and the UI Definition of Done. [`docs/design-system.md`](./design-system.md) remains live-layer notes during the v1→v2 transition. The `docs/redesign/*` documents remain the deep references they link to.
- **Type-scale ratchet — backlog cleared, gate now strict:** `node scripts/check-type-scale.mjs --strict` reports **0 hits / 0 files** (this pass retires the last 8 hits in 1 file; the prior recorded baseline was 20/9, originally 168/22). The compact mode-home hero now uses the shared fluid `--text-hero` scale; the temporary mode-home-only aliases were removed after confirming no consumers remained. `check:type-scale --strict` is wired into `verify:full` (package.json `verify:full:internal`; not in `verify:cheap` after the 2026-09-17 split), so any newly introduced arbitrary `text-[<n>px|rem|em]` size now fails the broad static gate — UI PRs must keep the count at zero. Colour utilities (`text-[color:var(--…)]`) are the sanctioned token form and are not counted.
- **Cleared this pass:** dead launcher mobile detail rows now expand (aria-expanded disclosures); launcher detail dialog migrated to the `Sheet` primitive (focus trap/return-focus restored); launcher filter tablists gained `aria-controls` + a `role="tabpanel"` results region; styled `src/app/not-found.tsx` added (the `notFound()` calls in differentials no longer fall through to the unstyled default); `?page=abc` NaN leak in the document viewer clamped; `/services` off-palette preview deleted (dead export) and the live navigator's residual hardcodes tokenized; launcher icon tones moved from raw Tailwind palette classes to categorical `--type-*` / semantic danger triads (dark-mode + forced-colors correct); mockups layout emits `robots: noindex`.

## Repository hygiene + production surface pass (2026-07-06)

- **Mockup routes gated out of production:** `/mockups/*` (27 design-exploration pages) previously shipped in production builds, hidden only by a `robots.ts` disallow. `src/app/mockups/layout.tsx` now calls `notFound()` unless `mockupsEnabled()` (`src/lib/env.ts`) — always on in dev/test, production requires explicit `NEXT_PUBLIC_MOCKUPS_ENABLED=true`. Verified end-to-end: production build serves HTTP 404 on mockup routes and 200 on real routes; `tests/env-mockups-gate.test.ts` guards the flag logic.
- **Dependency vulnerability gate in CI:** the `verify` job now runs `npm audit --omit=dev --audit-level=high` after runtime alignment. Rationale: the document parsers (`pdf-parse`, `pdfjs-dist`, `mammoth`, `exceljs`, `jszip`) process untrusted uploads, so high/critical advisories in the production tree should block merges rather than wait for the weekly Dependabot pass.
- **Scratch artifacts untracked:** 24 committed `.tmp-visual/` files (visual-QA capture scripts + PNGs) removed from tracking; `.tmp-visual/` added to `.gitignore` (it was already Prettier-ignored).
- **Docs archived:** superseded/completed planning docs moved to `docs/archive/` — root `COLOR_REDESIGN_PLAN.md` (superseded), `TOOLS_CONTEXT_FOR_NEW_CHAT.md` + `design-qa.md` (chat handoffs referencing machine-local paths), the completed `search-rag-phase-0…5.5b` + pre-phase-2 series, and the completed `clinical-chat-ui-*` phase docs. Living docs (`search-rag-master-plan.md`, `search-rag-master-context.md`, `clinical-chat-ui-component-map.md`) stay in `docs/`; no inbound references were broken (verified by repo-wide grep) and relative links inside moved files were retargeted.
- **Playwright port-finder IPv6 fix:** superseded — an equivalent fix landed on `main` first (`71e0ab0`, which also adds a Chromium executable override); `main`'s version is kept in the merge.

## Universal search workstream — verification state (2026-07-06)

- **Shipped on `claude/universal-search-algorithm-ryrps7`:** finding #11 interim fix (classifier-verdict memoization, 15-min TTL, errors not memoized — the "cheaper interim option" from the 2026-07-03 entry above), pre-clamp tiebreak completion in `selectRetrievalEvidence`, weak-match OR-augmentation (kill switch `RAG_TEXT_WEAK_OR_RELAXATION=false`), `similarity_origin` telemetry, shared `catalog-search` primitives replacing the four per-domain rankers, forms mode-kind honesty, tools dataset dedupe, `/api/search/universal` federated endpoint, and the cross-entity typeahead in `UniversalSearchCommandSurface`.
- **Eval debt (blocking merge, not development):** `npm run eval:retrieval:quality` (23/23) and `eval:quality --rag-only` (`unsupported_correct_rate` 1.0) could NOT be run in the authoring environment (no live keys) — they MUST be run before merge per the standing gate above, with special attention to the weak-match OR-augmentation (flag off restores relax-on-empty exactly) and the retrieval-selection tiebreak (tie-only by construction).
- **Eval debt settled 2026-07-07 — both flagged changes had regressed the golden eval (31/34 on main).** Isolated case-by-case against the same live corpus (pre-#325 code passed all 3): the weak-match OR-augmentation buried `opioid-withdrawal-doses` (docRecall@5 → 0; OR recall is append-only at the RPC merge but NOT after re-ranking), and the `selectRetrievalEvidence` pre-clamp tiebreak buried `alcohol-ciwa-threshold` + `clozapine-cbc-abbreviation-threshold` (boost-stacking magnitude re-ordered saturated top-5 sets). Fixed on `claude/retrieval-correctness`: `RAG_TEXT_WEAK_OR_RELAXATION` now defaults to `false` (opt-in experiment flag; re-enable only behind a fresh full golden run) and the selection-layer tiebreak is removed — the pre-clamp deep tiebreak lives in `rankClinicalResults` (below the engineered `rankingTieBreakScore`), which is the only place it is eval-proven. Lesson reinforced: "tie-only by construction" still changes which tied candidate wins; ordering changes inside saturated score regions are behavior changes and need the golden gate.
- **UI verification run:** new `tests/ui-universal-search.spec.ts` (grouped typeahead renders, item selection navigates, Enter still runs the mode search — universal endpoint mocked), full `ui-tools`/`ui-tools-task-directory` (40/40) and `ui-smoke`/`ui-overlap` suites against a live dev server in demo mode, plus a live curl of `/api/search/universal` (grouped payload, domain filter, 400 on short query).
- **Known limitation:** the typeahead spec mocks the universal endpoint; an end-to-end spec against live seeded registries needs the owner-auth Playwright project (E2E*USER*\* keys).

## Cross-mode answer links workstream — verification state (2026-07-06)

- **Shipped on `claude/search-cross-mode-links-qscj1n`:** post-answer "Also in your library" strip (`src/lib/cross-mode-links.ts` + `CrossModeLinksStrip`), thread-wide entity fallback, word-boundary field matching in `rankCatalogRecords` (substring hits like "renal" inside "adrenaline" no longer count as name/title matches), `fields=index` slim mode on `/api/medications`, cross-mode click telemetry via `/api/search/interaction` (`crossMode` target, `metadata.interaction: "cross_mode_link_open"`), the same strip on documents-mode results, and answer `crossModes` command-surface parity.
- **Verification debt:** `npm run verify:release` (and its governance/eval gates) has not been run for this workstream — the authoring environment has no live Supabase/OpenAI keys. Run it from a secrets-equipped environment after merge; the cross-mode surface itself is additive/navigational, so `verify:cheap` + `verify:ui` are the load-bearing local gates.
- **Telemetry note:** cross-mode clicks write `rag_query_misses` rows with `clicked_document_id: null` and the target mode/slug in `metadata`; retrieval-quality reviews that aggregate misses by document should filter on `metadata.interaction`.

## rag.ts decomposition — part 1 (2026-07-06)

- **Shipped on `claude/rag-decomp` (moves 1–4 of the approved 8-move sequence, all verbatim move-only):** quote-verification family → `rag-quote-verification.ts`; source-block family (`buildRagSourceBlock`, `truncateForModel`, table formatters) → `rag-source-block.ts`; numeric-verification application (`applyNumericVerification`, `unboldUnverifiedNumbers`) → `answer-verification.ts` beside the primitives it wraps; model-context selection (`capPerDocumentCrowding`, `selectModelContextResults`) → `rag-context-selection.ts`. Four tiny shared helpers re-homed to domain siblings (`allowedChunkMap` → citations, `safeRecord`/`metadataText` → rag-answer-text, `appendRoutingReason` → rag-routing); rag.ts's `resultCitation` was an exact duplicate of `citations.citationFromResult` and now aliases it. All extractions are cycle-free (modules import one-way from siblings; rag.ts re-exports moved names its tests/consumers import). rag.ts 7,874 → ~7,450 lines.
- **Measured coupling for the remaining moves (do not trust the pre-drift map):** the extractive-answer family (L, ~1,085 lines) and the answer-quality/reasoning-effort family (M, ~465 lines) are **mutually entangled** on main (M calls `classifyAnswerIntent`/`boldHighYieldClinicalText` from L; L calls `finalQualityGapAnswer`/`isFragmentLikeClinicalAnswer`/`hasBadFinalAnswerQuality` from M) and both reach into the coverage-gate helpers (K) — extract L+M together in a dedicated pass, or accept module→rag.ts back-edges. Retrieval variants (H) additionally depend on owner-scope helpers (`assertGlobalSearchAllowed`, `ownerScopeForDocumentFilteredRetrieval`) and live alias fetching; context packing (J) depends on `stableHash` + committed-generation helpers and belongs with the cache region (F) move.
- **Standing gate:** any continuation that touches H/F (retrieval-side) must pass `npm run eval:retrieval:quality` (23/23) before merge, per the golden-eval rule above.

## rag.ts decomposition — part 2 (2026-07-07)

- **Base:** branched `claude/rag-decomp-part2` off `origin/main` (8878151aa, includes part-1 #341 + retrieval-correctness #343 → golden set is now **36**, not the 23 the part-1 note recorded). Approved 3-move sequence: (1) L+M together, (2) retrieval variants H, (3) context-packing J → cache F. Method identical to part 1 (verbatim byte-identical block moves, one module per commit, per-move gate). The remeasured region map (do NOT trust part-1's line numbers post-drift): L = extractive-answer at 3954–5039 (1,085 lines) and M = answer-quality/reasoning-effort at 5040–5503 (464 lines), confirming part-1's family sizes.
- **Move 1 (shipped): L+M → `rag-extractive-answer.ts`.** Lines 3954–5503 moved verbatim (empty block diff modulo the `export` keyword added to 9 functions that now cross the boundary). Extracting L+M **together** keeps their mutual entanglement internal → no cross-module cycle between them. rag.ts imports the 12 names it still calls, re-exports the 6 tests import. Per the sanctioned "accept back-edges" path, the module imports **9 call-time helpers back from rag.ts** (`evidenceTextForGate`, `rankMemoryCardsForAnswer`, `deriveConfidence`, `scoreValue`, `machineReadableFallbackAnswer`, `buildAnswerScoreExplanations`, `buildIndexingQuality`, `collectMemoryCards`, `fallbackReasonFromRouting`) — a rag.ts↔module cycle that is runtime-safe (all uses are call-time; no `import/no-cycle` lint rule). 6 of those 9 gained an `export` keyword; the aliased `citationFromResult as resultCitation` import travels with the module; 5 imports orphaned by the move were removed from rag.ts. rag.ts 7,550 → 6,025 lines. Gate: tsc clean (56 pre-existing `fast-check` property-test errors only — `fast-check` is not installed in the shared node_modules; no new errors from the move), focused vitest 75/75, lint (only the 7 pre-existing rag.ts unused-import warnings; module 0), prettier clean.
- **Trap logged:** a backgrounded `tsc … | tail; echo EXIT` reports the pipeline's (echo's) exit, not tsc's — always read the captured EXIT marker, never trust the background "exit 0" notification. This masked both the true baseline (56 fast-check errors) and move 1's first-cut breakage (9 unexported functions + a missed aliased import) until vitest failed.
- **Move 2 (shipped): retrieval variants H → `rag-retrieval-variants.ts`.** Lines 1999–2283 moved verbatim (empty block diff modulo the `export` keyword added to 5 declarations): `buildRetrievalQueryVariants`, alias normalize/expand + live `fetchEnabledRagAliases`, `assertGlobalSearchAllowed`/`ownerScopeForDocumentFilteredRetrieval`, `shouldRelaxWeakTextMatches`, `textCandidateBudgetForQueryClass`, budget consts. rag.ts imports the 11 names it calls, re-exports the 6 `retrieval-query-variants.test.ts` imports. Back-edges: `SearchChunksArgs` (type-only, no runtime cycle) + `shouldShortCircuitUnsupportedSearch` (one call-time value fn, gained an `export`; belongs to the soft-tail family staying in rag.ts). 4 orphaned imports removed from rag.ts. rag.ts 6,025 → 5,750 lines. Gate: tsc clean, focused vitest 102/102 (incl. `retrieval-query-variants.test.ts`), lint (7 pre-existing warnings only), prettier clean.
- **Move 3 (shipped, final): cache region F + context-packing J → `rag-cache.ts`.** Cache is interleaved in rag.ts with the query-classifier, unsupported-soft-tail, and query-expansion regions, so this was a **multi-region verbatim move** (4 contiguous regions assembled into one module, each byte-identical to source; diff shows only the `export` keyword on 11 boundary-crossing declarations): cache maps/consts + cache-key helpers + main cache block (get/set answer+search, shared-cache, `stableHash`, `retrievalPlanCacheQuery`, invalidation) + context-packing. rag.ts imports the 12 names it calls (incl. the `answerInflight` map) and re-exports 4 (`invalidateRagCachesForOwner`/`…ForDocumentMutation` for API routes; `packedContextCacheKey`/`retrievalPlanCacheQuery` for tests). Back-edges: `SearchChunksArgs` + `SearchTelemetry` (type-only) and one call-time value fn `retrievalPlanForQueryClass` (gained `export`). Notably the interleaved classifier/soft-tail/expansion helpers are cleanly _not_ referenced by the cache union — only those 3 back-edges. 3 orphaned imports removed. rag.ts 5,750 → 5,108 (**7,550 → 5,108 across part 2, −2,442 / −32%**; the file now holds the orchestrator + retrieval-diagnostics + classifier + coverage-gate + memory/enrichment + logging). Gate: tsc clean, focused vitest 118/118, lint (7 pre-existing warnings only; module 0), prettier clean.
- **Golden retrieval eval environment-blocked — root cause is a data/owner mismatch, not code or OpenAI:** `npm run eval:retrieval:quality` FAILS ~36/36 with every retrieval layer at 0 (`text_candidates:0`, `hybrid_vector:0`, …). Proven not a regression: pristine `origin/main` rag.ts (moved modules inert) reproduces the **byte-identical** failure output (24/24 printed cases, latency aside). Direct Supabase probe with the configured service key: **2,065 documents / 69,334 chunks present, but `owner_id` is `null` (global) on the sampled docs while `RAG_EVAL_OWNER_ID` (2bac05f1-…) owns 0**, and owner-scoped retrieval now **fail-closes** on a null owner (privacy hardening) — so no owner value retrieves the null-owner corpus and the eval returns 0 candidates. Restoring OpenAI credits fixed embeddings (`embedding:1` succeeds) but not this. To run a real 36/36, the corpus docs must be assigned to the eval owner (or the eval must target the actual owner / allow global search). Behavior preservation for moves 1–3 is evidenced by byte-identical moves + tsc + focused vitest + **pristine-eval equivalence**; the mandated clean 36/36 + `eval:quality --rag-only` must run once the eval-owner/corpus config is fixed (or in CI), before merge. **RESOLVED 2026-07-07** — the eval now defaults its owner to the public sentinel and the mandated clean **36/36, failed_cases=0** ran green against the live corpus (see "Golden retrieval eval owner default = public sentinel" below); this closes the #347 part-2 eval debt.

## Golden retrieval eval owner default = public sentinel (2026-07-07)

- **Fix committed:** the golden retrieval eval now defaults its owner to the public-owner sentinel
  `00000000-0000-0000-0000-000000000000` (`DEFAULT_EVAL_OWNER_ID` in `scripts/eval-retrieval.ts`,
  applied as the final fallback after env/CLI/email resolution). Since the 2026-07-06 public
  promotion the live corpus is entirely `owner_id = NULL`; `retrieval_owner_matches` maps the
  sentinel to NULL-owner rows, mirroring anonymous production search, so **no future session has to
  set `RAG_EVAL_OWNER_ID` by hand**. An explicit `RAG_EVAL_OWNER_ID` / `LOCAL_NO_AUTH_OWNER_ID` /
  `RAG_EVAL_OWNER_EMAIL` (or `--owner-id` / `--owner-email`) still overrides it — the email-lookup
  path is preserved. Change is localized to eval config + docs; retrieval/ranking/app runtime code
  is untouched. This is the fix the retrieval-correctness workstream (#343) established and the
  runbook already recommended; it makes that recommendation the committed default.
- **Offline gates (2026-07-07):** `npm run typecheck` clean; `npm run verify:cheap` green
  (`check:runtime`, `sitemap:check`, lint — 8 pre-existing warnings, 0 errors — typecheck, unit
  tests 1251 passed / 3 skipped).
- **Live 36/36 CONFIRMED (2026-07-07):** ran `npm run check:supabase-project` (live mode against
  `PsychSift Production` / `sjrfecxgysukkwxsowpy`) then `npm run eval:retrieval:quality` with the
  new default owner (no `RAG_EVAL_OWNER_ID` set). Result: **`cases=36`, `failed_cases=0`,
  `latency_failed_cases=0`**, `document_recall@5=1`, `content_recall@5=1`, `top_k_hit_rate=1`,
  `mrr@10=0.8148`, `content_mrr@10=0.9244`, strategies `{text_fast_path:25, document_lookup_fast_path:1,
hybrid:10}`, all 10 forced-embedding vector cases passed (`force_embedding_failure_count=0`). A
  direct read-only DB probe confirmed the premise: all **2,065** documents have `owner_id = NULL`;
  the old eval owner `2bac05f1-…` owns 0. **This closes the retrieval half of the #347 part-2 eval
  debt** — the golden retrieval eval is the retrieval behavior-preservation proof, and it now runs
  green with no manual owner setup. (#347 also owed `eval:quality -- --rag-only`; that answer-path
  half was still owner-blocked until the follow-up below.)

## Eval-owner default hoisted to all read/eval scripts + #347 answer-path gate closed (2026-07-08)

- **Follow-up to the 2026-07-07 fix above.** PR #348 only patched `eval-retrieval.ts`, so
  `eval:quality` (incl. `--rag-only`), `eval:rag`, `eval:answer-quality`, and `eval:search` still
  resolved the owner as `args.ownerId ?? emailLookup ?? undefined` and returned 0/N against the
  all-public corpus — the exact failure #348 fixed for retrieval, still live for the answer path.
- **Fix (item 1 + 3):** hoisted `DEFAULT_EVAL_OWNER_ID` + `resolveEvalOwnerId(supabase, args)` into
  the shared `scripts/eval-utils.ts` and applied it at the final owner-resolution point in all five
  read/eval scripts (`eval-retrieval` refactored onto it; its local duplicate constant removed).
  Precedence preserved (explicit id → email lookup → sentinel); the helper prints a **one-line
  warning on the sentinel fallback** so the narrowing to public-only scope is visible, not silent.
  Write/backfill scripts (`enrich-documents`, `classify-documents`, `backfill-*`) deliberately
  excluded — defaulting an owner there could write under the wrong owner. First-ever
  `resolveEvalOwnerId` unit coverage added to `tests/eval-utils.test.ts`.
- **Gates:** `verify:cheap` green (1277 tests; 0 lint errors). `eval:retrieval:quality` re-ran
  **36/36, failed_cases=0** on the refactored script (regression check). The fallback warning was
  observed firing in a real `eval:quality` run.
- **#347 answer-path gate CLOSED (item 2) — `eval:quality -- --rag-only`, live, no manual owner:**
  `cases=44`, **unsupported_correct_rate=1.0**, **citation_failure_rate=0.0455**,
  **numeric_grounding_failure_rate=0.0227** — all three invariants identical to #343's live
  baseline; `grounded_supported_rate=0.90` (vs #343 `0.9333`). The 5 failing cases are entirely in
  #343's documented live-variance set: 2 pure latency-threshold failures (this cloud env's
  Supabase p95 ≈ 49 s — the local→remote latency #343 called out) and 3 route/retrieval flakes
  (`illegal-substances`, `discharge-documentation`, `community-admission`) that #343 already
  identified as pre-existing variance outside the touched paths. Because this change is eval-config
  only (owner resolution) and touches no answer-generation code, the identical invariant rates
  confirm the part-2 decomposition preserved answer behavior. **#347 part-2 eval debt now fully
  settled** (retrieval half via #348, answer-path half here).

## Answer-thread Back button: URL and visible answer can disagree (2026-07-06)

- **Behaviour:** inside an Answer thread, browser Back changes the URL (`/?mode=answer&q=A&run=1` ← `...q=B&run=1`) but the rendered answer/thread does not change. Two guards produce this: the auto-run effect skips when `run=1` is already present, and the answer view early-returns when an answer is already on screen (`ClinicalDashboard`). This is thread persistence by design, not an accident — clearing the thread on Back would destroy in-progress clinical context.
- **Open product decision:** either (a) accept that the URL is not a faithful pointer to the visible answer inside a thread (current state), or (b) make Back restore the previous question's answer from thread history. Option (b) needs answer-thread state keyed by URL and re-render on `popstate`/param change; it is a deliberate feature, not a bug fix.
- **Guardrail until decided:** do not "fix" the skipped auto-run on Back in isolation — re-running the search on Back would clobber the visible thread with a regenerated (and possibly different) answer, which is worse than either deliberate option.

## Audit re-triage & property-test suite (2026-07-06)

- **Full re-triage of the 2026-07-01 audit's H1–H4 and M1–M17 against current main: all 21 are closed.** The 2026-07-02 remediation branch landed (H1/H2/H4+M8+M16, M1–M12, M14, M15, M17 all carry audit-referencing fixes verified in code, not just comments); PR #278 added the P0 carry-over (including the M9 DELETE TOCTOU re-check); M13's migration (`20260702000000`) is in-tree (live-apply verification needs `npm run check:m13-migration` with live keys). H3 is closed by supersession: PR #118 removed the governance penalties it complained about entirely (measured, "do not reintroduce" comment in `retrieval-selection.ts`); the residual `Math.max` floor only affects intent boosts, and un-flooring it was already tried and withdrawn (compounding across selection passes — audit R1). Do not re-open H3 without the golden retrieval eval.
- **New fast-check property suite** (`tests/property-*.test.ts`) pins the text-processing core's clinical invariants over generated inputs: unit-bearing numeric tokens survive sanitization; chunking terminates (including `CHUNK_OVERLAP >= CHUNK_SIZE`, M17) and neither loses nor invents content; table normalization stays rectangular, preserves numeric values, and the low-confidence caveat survives both clipboard export paths (H4). The suite immediately caught a live line-level H2 residue in `stripLowYieldLines` (control markers glued to threshold sentences deleted the whole line), fixed in the same PR.
- **Eval debt (blocking merge of the sanitizer fix, not development):** the environment had no live Supabase/OpenAI keys, so `npm run eval:quality -- --rag-only` (answer-path gate for the sanitizer change) could not run. Run it before merging `claude/audit-sweep-property-tests`. No retrieval-selection/ranking files were touched, so the golden retrieval eval is not required for this branch.

## Differentials export "Urgency: urgent" artifact retitled — live prune pending (2026-07-11)

- The differentials export's trap-tables appendix (`T_Focused_Diagnostic_Trap_Tables.txt`) has no title line, so the parser surfaced its first metadata row ("Urgency: urgent") as a presentation titled "Urgency: urgent" (slug `urgency-urgent`) with detail routes and search visibility. It is a legitimate comparison workflow ("Distinguishes intrusive/obsessional phenomena from psychotic or violent intent"), and 4 of its 7 option diagnoses (`gad-worry-depressive-rumination`, `overvalued-idea`, `psychotic-delusion`, `ptsd-intrusive-memories-flashbacks`) exist in no other entry — so excluding it would orphan them and break the #483 invariant (enforced by `differential-detail.test.ts`) that every diagnosis belongs to a presentation. Fixed at the root: `parseEntryTitle` now falls back to the `=== HEADER ===` text when the first line is a metadata row, retitling the entry "Focused Diagnostic Trap Tables" (slug `focused-diagnostic-trap-tables`). Snapshot stays 31 presentations; no orphans.
- **Operator follow-up (live Supabase, confirmation-required):** the retitle changed the slug, and seeding upserts by slug and never deletes, so already-seeded owners keep the stale `differential_records` row (`kind='presentation'`, `slug='urgency-urgent'`) and — where corpus embedding ran — its registry corpus document/chunks in `documents`/`document_chunks`. `npm run differentials:seed -- --owner-id <uuid> --write` now prunes presentation rows whose slug the current snapshot no longer produces (via `staleSeededPresentations`) and their corpus documents per owner; run it for each seeded owner.

## 2026-07-13 audit remediation batch (branch claude/audit-remediation-2026-07-13)

- **Lexical retrieval rewrite (audit finding 1):** `20260713100000_index_friendly_lexical_retrieval.sql` splits `match_document_chunks_text`'s OR-across-relations candidate search into two GIN-index probes unioned by chunk id (same contract, same scores; the `_v2` wrapper inherits the speedup). Parity + plan + timing harness: `scripts/sql/lexical-rpc-parity-check.sql` (scratch databases only; run it against the drift-manifest container kept with `--keep`). Re-run it whenever either lexical body changes.
- **Hosted migration-role default privileges (audit finding 7):** `supabase/roles.sql` establishes and verifies secure `postgres` defaults before fresh local migration replay. `20260717161000_assert_postgres_default_privileges.sql` evaluates effective defaults from `pg_default_acl` plus `acldefault`, so a missing catalog row cannot hide PostgreSQL's built-in `PUBLIC EXECUTE` on functions. `20260717173000_reassert_postgres_default_privileges.sql` repeats the fail-closed postcondition, and `20260719053532_repair_postgres_default_privileges.sql` is the forward-only hosted repair immediately before the final title-word scope migration. All active revokes and assertions target objects created by `postgres` in `public`; service-role grants remain least-privilege. Older applied migration history is immutable and byte-pinned by `npm run check:migration-role`; the same guard rejects the reserved role in every other hosted SQL/tooling surface. Bare Docker recovery discovers the storage-schema owner dynamically, keeping that local bootstrap concern out of hosted SQL. After an authorized hosted apply, run the read-only provider check with `npm run check:default-acl -- --confirm-provider-read`. This command contacts the live Supabase project and therefore requires explicit provider approval.
- **Legacy rag query text scrub (audit finding 5):** `20260713103000_scrub_legacy_rag_query_text.sql` performs four redaction/deletion operations for pre-HMAC plaintext query text: (1) scrubs `rag_queries.query` rows not matching `redacted-query:%`, replacing them with salted `redacted-query:legacy:` placeholders; (2) scrubs both `rag_query_misses.query` and `rag_query_misses.normalized_query` not matching `redacted-query:%`; (3) scrubs both `rag_retrieval_logs.query` and `rag_retrieval_logs.normalized_query` not matching `redacted-query:%` (nullable); (4) deletes `rag_response_cache` rows where `normalized_query` does not match `redacted-cache:%` (cache entries, not re-keyed). **Operator verification after live apply:** for each affected table/operation, count rows not matching the expected redacted pattern (expect 0 unless `RAG_PERSIST_RAW_QUERY_TEXT` is deliberately enabled): `select count(*) from rag_queries where query not like 'redacted-query:%';` (expect 0), `select count(*) from rag_query_misses where query not like 'redacted-query:%' or normalized_query not like 'redacted-query:%';` (expect 0), `select count(*) from rag_retrieval_logs where query not like 'redacted-query:%' or (normalized_query is not null and normalized_query not like 'redacted-query:%');` (expect 0), `select count(*) from rag_response_cache where normalized_query not like 'redacted-cache:%';` (expect 0). The migration includes a post-apply assertion block that enforces these exact checks and fails the migration if any unscrubbed/undeleted rows remain.
- Remaining operator items from the 2026-07-13 audit (confirmation-required, not automated): apply this batch's migrations live, re-run Supabase advisors, trigger the Eval Canary and require two consecutive green scheduled runs, repair the invalid `storage.idx_objects_bucket_id_name_lower` index via dashboard/support, and dedupe response-cache purge cron jobs if `cron.job` shows duplicates.

## Repo-productivity & automation tooling (2026-07-13)

Machinery added to retire repeated traps and surface live-product signal proactively. This entry is
the durable index for the tooling; `docs/operator-backlog.md` tracks the human-only enablement steps.

- **Pre-push guards** (`.githooks/pre-push` → `scripts/guard-push.mjs`, auto-installed by the
  `postinstall` → `scripts/install-git-hooks.mjs`, which sets `core.hooksPath=.githooks`): five guards.
  The non-bypassable auto-merge ownership guard warns (but does not block) an ordinary push to a
  PR branch whose auto-merge is armed; it blocks only when that push force-updates the branch or
  carries a hosted migration (`autoMergeVerdict` in `scripts/guard-push.mjs`). The other guards
  retain explicit overrides: format-before-push (closes the `verify:cheap` vs
  CI `format:check` gap; it reuses only an exact-lock worktree dependency tree and otherwise blocks
  with `npm ci --include=dev`; `SKIP_FORMAT_GUARD=1`), drift-manifest freshness
  (`SKIP_DRIFT_GUARD=1`), and static gate (changed-file lint + source-only typecheck through the run
  coordinator; `SKIP_STATIC_GUARD=1`). `guard:push:self-test` covers the pure logic. Because the SessionStart hook is remote-gated, the
  installer runs from `postinstall` (any new npm lifecycle script must also be COPY'd into the
  Dockerfile npm-ci stages — see the 2026-07-13 docs-infra note).
- **Stale-base tripwire** (`scripts/check-base-freshness.mjs`, `check:base-freshness`): advisory
  ahead/behind-vs-`origin/main` warning wired into a second SessionStart hook; never blocks.
- **Live-product monitoring:** `spend` block on `/api/health?deep=1` (`src/lib/observability/spend-metrics.ts`,
  USD derived from already-persisted answer token counts; prices via `OPENAI_PRICE_*` env, placeholders
  until set). `scripts/ops-digest.mjs` + `.github/workflows/ops-digest.yml` (**dispatch-only** until
  `PROD_HEALTH_URL` var + `HEALTH_DEEP_PROBE_SECRET` secret exist in both Railway and GitHub).
- **Ingestion autopilot** (`scripts/ingestion-autopilot.ts`, `ingestion:autopilot`): probes `reindex-health`
  and recovers a stuck queue **only** with `--apply`. Workflow schedule is LIVE in **dry-run**
  (`INGESTION_AUTOPILOT_APPLY` unset → read-only); flip that repo var to `true` after a clean dry-run to
  allow real recovery.
- **PR metadata policy** (`.github/workflows/pr-policy.yml`, `scripts/pr-policy.mjs`): ready PRs to `main`
  should use an outcome-focused title, complete Summary and Verification evidence, and provide risk/rollback
  evidence for clinical or operationally sensitive paths. UI changes should carry `verify:ui` evidence (or an
  explicit reason it could not run), and clinical-risk changes should disposition the governance
  checklist. **All of that is advisory as of 2026-09-17 (owner decision): no PR-body prose blocks a merge.**
  The `## Clinical Governance Preflight` completeness gate and the `RAG impact:` declaration were both hard
  blocks until then. Neither read a line of code — they verified that an author had typed the right seven
  sentences — while `clinicalRiskPatterns` matches most meaningful paths in the repository, so the block fired
  on nearly all real work and cost a round trip every time. They now emit warnings. The gates that still fail
  closed here are unchanged: migration-history immutability, required-check forgery, and the
  `PR_POLICY_BODY.md` transport check. The clinical safeguards that actually
  inspect behaviour — owner-scope, query-privacy, the live eval-canary, `tests/rag-imputation-contract.test.ts`
  — were never part of this file and are untouched.
  `scripts/pr-policy.mjs` also flags operational risk bundled with clinical or UI risk (#178),
  warning authors to split infrastructure/tooling from clinical/UI features for independent revertibility.
  The `pull_request_target` job checks out the trusted `github.workflow_sha` revision and never executes
  PR-head code. Its permissions are exactly `contents: read` and `pull-requests: read`. A further blocking
  control (C0, 2026-09-17): an edit, removal or rename of an applied
  migration, a new migration dated at or before the newest one on main, or one dated more than 2 days in
  the future, fails the check (applied migrations never re-run on live). A
  `Migration history edit approved:` override additionally requires
  an accompanying fail-fast validation guard migration in the same change. Drafts remain non-blocking
  until marked ready; merge-queue runs emit the same stable `PR policy` check name.
- **Repository permission baseline (applied 2026-07-17):** Actions receive read-only tokens by default,
  cannot approve pull requests, and must reference external actions by immutable SHA. Workflows that post
  issues/comments retain narrow explicit permissions. Secret-scanning push protection is enabled and
  merged branches are deleted automatically. Non-provider pattern scanning and credential-validity checks
  remain unavailable for this user-owned repository/plan, so the ordinary secret scan, push protection,
  Gitleaks check, and local secret-surface guards remain the active layers.
- **Review-routing labels (applied 2026-07-17):** `codex-review` is the explicit opt-in for a normally
  low-risk PR, and `skip-codex-review` is the unconditional opt-out. Four obsolete per-head `codex-ar-*`
  labels from the retired routing mechanism were removed after confirming no open PR used them.
- **Repo hygiene:** `check:env-parity` (env-var NAME reconciliation across `env.ts`, `check-ci-env.mjs`,
  and — opt-in, names-only — `gh secret list` / Railway) and `sweep:branch-ledger` (report-only branch
  inventory, cherry-pick-aware).
- **Session skills** (`.claude/skills/{newtask,handoff,prlanded}`): the first repo-local skills, encoding
  the clean-worktree, upload, and post-merge-verification rituals.
- **CI guards (warn/advisory):** `check:bundle-budget` (warn-only client-JS size gate after Build until a
  baseline is captured in `bundle-budget.json` and `enforce:true` is set) and `docs:check-scripts`
  (advisory — validates `npm run` refs in docs against `package.json`).
