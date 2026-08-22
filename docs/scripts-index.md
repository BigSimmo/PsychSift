# Scripts index

Curated map of `scripts/` (267 files) and the `package.json` script surface (268 entries),
grouped by purpose. This is orientation, not an exhaustive per-file listing — the authoritative
command list is `package.json`, and `npm run docs:check-scripts` verifies every `npm run <x>`
referenced in docs resolves to a real script. `npm run docs:update` refreshes the exact counts above.
Every top-level `.mjs`/`.ts`/`.cjs` script is named below; the remaining files are fixtures, SQL,
subfolder helpers, and small shared helpers grouped rather than itemised.

> The two counts in the sentence above are generated facts, not prose. Keep them in the exact
> `(N files)` / `(N entries)` shape — tooling rewrites that sentence by regex.

Legend: **[live]** routine tooling · **[infra]** runner/guard plumbing · **[one-shot]** completed
migration/batch helper that is a candidate for an `archive/` subfolder under `scripts/` once its
migration has shipped (see `docs/maturity-backlog-workorders.md` L1).

## Runner & guard infrastructure [infra]

| Script                                                                                                                                                                                                                                                                  | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run-heavy.mjs`                                                                                                                                                                                                                                                         | Acquires shared/exclusive cross-worktree leases (`test-run-lock.mjs`) so focused checks can overlap safely                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `gate-arbiter.mjs`                                                                                                                                                                                                                                                      | Decides whether an expensive local gate still earns its runtime, from live CI coverage plus a rolling per-gate/per-change-class yield window (advisory; never in CI)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `gate-receipts.mjs`                                                                                                                                                                                                                                                     | Content-addressed memoisation of `lint`/`typecheck`/Vitest so an unchanged gate is never rerun locally (never in CI)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `run-tsx.mjs`, `run-vitest.mjs`, `run-playwright.mjs`, `run-eval-safe.mjs`                                                                                                                                                                                              | Typed/test/e2e/eval entrypoint wrappers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `dev-free-port.mjs`, `ensure-local-server.mjs`                                                                                                                                                                                                                          | Project-stable localhost port selection + background server ensure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `design-sync.mjs`, `capture-mockup-screenshots.mjs`                                                                                                                                                                                                                     | Local design-sync CSS prep (`node scripts/design-sync.mjs`) + redesign "current" PNG pack after ensure (`node scripts/capture-mockup-screenshots.mjs`)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `check-node-engine.cjs`, `install-git-hooks.mjs`, `guard-push.mjs`, `guard-next-build.mjs`                                                                                                                                                                              | Install/preflight guards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `setup-codex-cloud.sh`, `maintain-codex-cloud.sh`, `install-codex-cloud-command-shims.sh`, `check-codex-cloud-raw-env.sh`, `delete-codex-cloud-branch-with-pat.sh`, `check-codex-cloud-setup.mjs`, `check-github-shell-access.mjs`, `ensure-codex-cloud-git-remote.mjs` | Reproducible Codex Cloud toolchain/profile setup, profile-loading Node command shims, a pre-profile name-only credential probe (`FAIL-KNOWN`/`exit 2` only for documented `OPENAI_BASE_URL`; hard `STOP` otherwise), an operator-only non-Cloud PAT branch-deletion helper, sanitized Personal Pro capability/route acceptance, fail-closed GitHub shell control-plane acceptance (`check:github-shell-access` = offline self-test; `check:github-shell-access:live` = provider-backed identity/permission/API plus non-mutating push proof), and safe credential-free `origin` repair |
| `setup-claude-cloud.sh`, `apply-claude-cloud-profile.mjs`                                                                                                                                                                                                               | Claude Code on the web container parity. Tiered, marker-guarded provisioner (`profile`, `plugins`, `gh`, `deno`, `browsers`, `python`) wired as the second `SessionStart` hook via `--session`, which runs the cheap tiers inline and detaches the ten-minute browser/OCR ones; plus the applier that unpacks `.claude/cloud-profile/` into the container's `~/.claude` (settings deep-merged, memories never clobbered). Both refuse to run unless `CLAUDE_CODE_REMOTE=true`. See `docs/claude-cloud.md`                                                                              |
| `ci-change-scope.mjs`, `ci-triage.mjs`, `pr-policy.mjs`, `pr-mergeability.mjs`                                                                                                                                                                                          | CI change classification + PR policy + conflict signal (self-tested via `check:ci-scope`/`check:ci-triage`/`check:pr-policy`/`check:pr-mergeability`)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `check-outstanding-issues.mjs`, `check-pr-mergeability-workflow.mjs`                                                                                                                                                                                                    | Outstanding-issues ID/marker/no-driver guard + PR mergeability workflow contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `outstanding-issues.mjs`                                                                                                                                                                                                                                                | Writer for `docs/outstanding-issues.md` (`issues:add` / `issues:done` / `issues:update`) — allocates the id, picks the right table, escapes `\|`, and re-runs the guard on its own output. Never hand-edit that file, as with `ledger:append`                                                                                                                                                                                                                                                                                                                                          |
| `check-ledger-stamp-retention.mjs`                                                                                                                                                                                                                                      | On-demand branch-safety check (`check:ledger-stamp-retention`, not wired into CI/`verify:cheap`): derives touched `docs/outstanding-issues.md` row IDs from git history between merge-base and `HEAD`, then verifies each still carries its branch content post-merge/rebase, catching silent conflict-resolution loss                                                                                                                                                                                                                                                                 |
| `check-installed-lock-parity.mjs`, `phone-chrome-plan.mjs`, `verify-phone-chrome.mjs`, `playwright-browser-preflight.mjs`                                                                                                                                               | Lock-trust preflight, change-scoped phone contracts, and Playwright browser-binary preflight before build                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `audit-merge-loss.mjs`                                                                                                                                                                                                                                                  | Advisory blob-comparison sweep for merged PRs a later merge resolution silently reverted (`audit:merge-loss`); names the PR and files and exits 0 — a deliberate revert is identical at blob level, so a positive needs human confirmation                                                                                                                                                                                                                                                                                                                                             |
| `final-merge-audit.mjs`                                                                                                                                                                                                                                                 | Fail-closed local merge-tree audit; explicit provider mode adds PR/check/thread/tree/deployment proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `child-process-result.mjs`, `cli-utils.ts`, `productivity-core.mjs`                                                                                                                                                                                                     | Shared helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `test-focused.mjs`, `test-run-selection.mjs`, `test-cache-path.mjs`, `test-environment.mjs`                                                                                                                                                                             | Backs `npm run test:focused` — change-scoped selection, cache pathing, env setup; fails closed for deleted files and test infrastructure                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `primary-checkout-lease.mjs`, `test-run-lock.mjs`, `clean-worktree.mjs`                                                                                                                                                                                                 | Cross-worktree lease arbitration for the primary checkout, plus worktree cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `resolve-tsx-cli.mjs`, `register-server-only.mjs`, `enable-server-only-stub.mjs`                                                                                                                                                                                        | tsx CLI resolution and `server-only` import shims                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `check-format-changed.mjs`, `check-base-freshness.mjs`, `check-local-presence.mjs`                                                                                                                                                                                      | Push-time helpers behind `guard-push.mjs`: changed-file formatting, stale-base and local-presence checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `yaml-contract.mjs`, `sensitive-text.mjs`, `design-system-contract-utils.mjs`                                                                                                                                                                                           | Shared parsing/redaction/contract helpers used by the gates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Verification gates [live]

`verify:cheap` → `verify:pr-local` → `verify:ui` → `verify:release`. Building blocks:
`check-runtime.ts`, `check-github-action-pins.mjs`, `check-gate-manifest.mjs`,
`check-outstanding-issues.mjs`, `check-pr-mergeability-workflow.mjs`,
`check-maintainability-budgets.mjs`, `check-upload-limit-parity.mjs`,
`check-codebase-index-coverage.mjs`, `check-docs-links.mjs`,
`check-docs-script-refs.mjs`, `check-bundle-budget.mjs`, `check-type-scale.mjs`,
`check-icon-scale.mjs`, `check-design-system-contract.mjs`, `check-function-grants.mjs`,
`check-owner-scope-api.mjs`, `check-client-bundle-secrets.mjs`, `verify-pr-local.mjs`,
`verify-release-offline.mjs`, `check-codex-cloud-setup.mjs`. `check-gate-manifest.mjs` cross-checks that every gate in the
`verify:cheap:internal` chain also runs in CI's `static-pr` job, so the two lists can't drift.

Also in the gate set: `check-assets.mjs`, `check-branch-review-ledger.mjs`,
`check-hosted-migration-role.mjs` (`check:migration-role` — pins the immutable applied migration and
the `postgres` role), `check-edge-functions.mjs`, `check-env-parity.mjs`, `check-ci-env.mjs`,
`run-gitleaks-pinned.mjs`, `rag-offline-contract.mjs` + `test-rag-offline.mjs` (offline RAG
contract), `check-lighthouse-budget.mjs` + `run-lighthouse-budget.mjs`, `measure-cls-attribution.mjs`
(ledger `#147` — names the elements behind a CLS breach, which Lighthouse's own
`layout-shift-elements` audit did not; CLS reproduces offline, LCP does not), and the workflow-contract
guards `check-pr-policy-workflow.mjs` and `check-codex-autofix-workflow.mjs`.
`audit-formatting-fixtures.ts` checks the formatting fixtures themselves.
`setup-codex-cloud.sh`, `maintain-codex-cloud.sh`, and
`install-codex-cloud-command-shims.sh` reproduce the provider-free Cloud runtime documented in
`docs/codex-cloud.md`; `npm run check:codex-cloud` verifies that
the runtime pins, install commands, offline defaults, and documentation stay aligned.
Programme execution helpers (no retrieval/ranking behaviour change): `rag-phase-launch-check.mjs`,
`rag-task-brief.mjs`, `check-rag-phase-receipts.mjs`, and `build-rag-plan-packages.mjs`.

For executable phone-chrome changes, use `verify:phone-chrome` before the broad UI gate. It checks installed-lock parity, then selects focused contracts and Playwright owners from the changed paths; shared foundations add `verify:ui` last. Documentation-only scopes run only documentation guards. `audit:final-merge` is local-only unless both `--providers` and `ALLOW_PROVIDER_READS=true` are supplied.

## Ingestion, indexing & reindex [live]

`import-documents.ts`, `reindex.ts`, `reindex-health.ts`, `check-indexing.ts`,
`recover-ingestion-queue.ts`, `cleanup-abandoned-reindex-generations.ts`,
`ingestion-autopilot.ts`, `backfill-smart-index.ts`.

## Document intelligence & governance [live]

`enrich-documents.ts`, `classify-documents.ts`, `backfill-gold-document-labels.ts`,
`audit-source-governance.ts`, `check-document-label-coverage.ts`,
`check-document-label-governance.ts`, `promote-public-documents-batch.ts`,
`audit-public-document-approvals.ts`, `production-readiness.ts`, `check-supabase-project.ts`,
`check-default-acl.ts`, `check-drift.ts`, `generate-drift-manifest.ts`,
`check-migration-history-alignment.ts`.

## RAG evaluation [live]

`eval-rag.ts`, `eval-rag-offline.mjs`, `eval-retrieval.ts`, `eval-quality.ts`,
`eval-answer-quality.ts`, `eval-search.ts`, `eval-search-api.ts`, `eval-assertions.ts`,
`compare-retrieval-eval.ts`, `retrieval-health.ts`, `profile-retrieval-rpcs.ts`,
`warm-retrieval-cache.ts`, `tune-search-weights.ts`, `check-rag-fixtures.mjs`, `eval-trend.mjs`
(trend across runs), `eval-utils.ts` (shared harness helpers),
`probe-generation-quality.ts` (one approved cache-bypassed live answer; reports the structured
`generation_quality_gate_reasons` added for `/issues` `#231` — provider-backed, refuses demo mode),
`check-rag-adversarial-fixtures.mjs` + `rag-adversarial-contract.mjs` (offline, network-free
validation of the synthetic adversarial fixture dataset and its baseline record; separate from
`check-rag-fixtures.mjs`, which is untouched),
`eval-rag-adversarial-offline.mjs` (packet B2: fixture validation then the offline Vitest
adversarial harness `tests/rag-adversarial-harness.test.ts`; `npm run eval:rag:adversarial:offline`,
routed by `ci-change-scope.mjs` to RAG-surface PRs only; fails closed on missing fixture,
network attempt, or round-trip budget breach),
`blind-answer-pairs.ts` (Gate E offline blinded A/B pairing over two
`eval-answer-quality --dump-answers` artefacts — `build` emits reading-pack/verdict-sheet/
assignment-key under `output/` or `.local/` only, `unblind` resolves recorded verdicts back to
version labels; pure file transformation, no provider access, node-builtin imports only;
`/issues` `#E0N0QC`; run via `node scripts/run-tsx.mjs scripts/blind-answer-pairs.ts`).
Golden fixtures:
`scripts/fixtures/rag-retrieval-golden.json`, `scripts/fixtures/assertion-golden.json`.
Adversarial fixtures: `scripts/fixtures/rag-adversarial-cases.v1.json` (+ its schema) and
`scripts/fixtures/rag-adversarial-baseline.v1.json`.
Docling lab (isolated, outside `scripts/`): `eval/docling/` — `npm run check:docling-lab`
(offline contract gate) and `npm run generate:docling-lab-lock` (hashed lock); the benchmark
itself is dispatch-only (`.github/workflows/docling-lab.yml`). See `eval/docling/README.md`.

Editing anything in this section is a protected-surface change — read `docs/rag-behaviour/` and flag
the task before you start.

## Registry / catalogue content [live]

`seed-registry-records.ts`, `embed-registry-records.ts`, `reconcile-registry-governance.ts`,
`import-services-export.ts`, `import-differentials-export.ts`, `seed-differential-records.ts`,
`import-medications-export.ts`, `seed-medication-records.ts`.

## Build & assets [live/infra]

`build-worker.mjs`, `build-analyze.mjs`, `build-therapies-index.mjs`,
`build-cross-mode-differentials-index.mjs`, `build-ranking-snapshot.ts`,
`generate-site-map.ts`, `generate-brand-assets.ts`, `generate-sample-documents.ts`,
`check-sample-extraction.ts`, `optimize-public-images.mjs`.

## Maintenance & ops [live]

`cleanup-storage.ts`, `purge-query-logs.ts`, `audit-tables.ts`, `supabase-recovery-status.ts`,
`promote-query-misses.ts`, `flake-ledger.mjs`, `sweep-branch-ledger.mjs`, `dependency-report.mjs`,
`set-site-administrator.ts`, `ops-digest.mjs`, `build-clinical-review-queue.ts`,
`verify-locality-metadata.ts`, `update-docs-inventory.mjs`.

### Review ledger, branches and skills [live]

- `branch-review-ledger.mjs` — the **only** way to read or write `docs/branch-review-ledger.md`
  (`ledger:lookup` / `ledger:append` / `ledger:dedupe` / `ledger:rotate`). Never hand-write a row.
- `merge-branch-review-ledger.mjs` — the `merge=ledger` union driver from `.gitattributes`;
  `check-branch-review-ledger.mjs` fails if that protection is lost.
- `sync-open-pr-branches.mjs` (`sync:pr-branches`), `sync-pr-branches.mjs` (compatibility entry point) — anti-churn sync for stale open PR heads;
  refuses a missing or bot `gh` identity. `sweep-merged-branches.mjs` — merged-branch sweep.
- `reconciliation-preflight.mjs`, `reconciliation-evidence-pack.mjs` — broad chat/worktree
  reconciliation entry point and its evidence bundle; see `docs/reconciliation-playbook.md`.
- `list-database-skills.mjs` (`skills` / `check:skills`), `sync-skills.mjs`, `skill-create.mjs` —
  the `.agents/skills/` catalogue.

### Live/staging verification [live]

`soak-test.ts`, `test-cross-tenant-staging.ts` (the executable owner-boundary proof behind
`docs/staging-tenancy-release-evidence.md`), `deployment-boot-smoke.mjs`, `run-live-tests.mjs`.
These reach live providers — they need explicit confirmation before running.

### Browser and performance capture [infra]

`playwright-base-url.ts`, `classify-playwright-failures.mjs`, `capture-chrome-parity.ts`,
`summarise-web-vitals.mjs`.

## One-shot / dated — archive candidates [one-shot]

Completed migration/batch helpers kept only for provenance; retire to the `scripts/archive/`
subfolder once the underlying migration is confirmed live (work order L1).

**Already archived** (in `scripts/archive/`, still runnable): `check-m13-migration.ts` /
`check-july8-live-batch.ts` — live-DB re-verification probes via `npm run check:m13-migration` /
`npm run check:july8-live-batch`. Their `.test.ts` companion lives in `scripts/archive/` too so it
stays out of the `tests/**` run. `backfill-document-tags.ts` / `backfill-enrichment.ts` — completed
one-time backfills, still invocable via `npm run tags:backfill` / `npm run enrich:backfill` (both
repointed at the archive path). `backfill-document-covers.mjs` — completed one-time backfill for
documents indexed before the ingestion pipeline started generating cover thumbnails directly (see
`worker/main.ts`, `worker/python/extract_pdf_assets.py`); no npm script, invoke directly via
`node scripts/archive/backfill-document-covers.mjs`. `tests/document-cover-thumbnails.test.ts`
still asserts its pagination logic by reading the archived source (`ledger #194`, 2026-08-14).

Ledger `#194` also named `backfill-gold-document-labels.ts` and `backfill-smart-index.ts` as
one-shot candidates, but both are already classified as `[live]` ongoing tooling elsewhere in this
doc (Document intelligence & governance / Ingestion, indexing & reindex) and in
`docs/codebase-index.md` — not completed migrations. Left in `scripts/` on that basis; re-flag only
if their live classification is deliberately revisited.

**Remaining candidates** (still in `scripts/`, retire once each is confirmed retired):
`check-retrieval-owner-migration.ts`, `backfill-source-metadata.ts`, `backfill-text-normalization.ts`,
`backfill-visual-intelligence.ts`, `derive-unknown-status.ts`, `reindex-image-generation-metadata.ts`,
`measure-wrapped-dose-prevalence.ts`, `decompose-indexing-v3.mjs`, `repro-coalesce-poison-race.mjs`
(a one-off race reproducer).

## Workflow planners [infra]

`external-workflow.mjs` (`workflow:run/status/verify/deps/clean-state/export/handoff`) and
`productivity-workflow.mjs` (`workflow:flightplan/triage/clinical-proof/design-sweep/rag-lab/
operator-closeout/lifecycle`) — see `docs/productivity-workflows.md`.
