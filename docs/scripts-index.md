# Scripts index

Curated map of `scripts/` (395 files) and the `package.json` script surface (324 entries),
grouped by purpose. This is orientation, not an exhaustive per-file listing — the authoritative
command list is `package.json`, and `npm run docs:check-scripts` verifies every `npm run <x>`
referenced in docs resolves to a real script. `npm run docs:update` refreshes the exact counts above.
Every top-level `.mjs`/`.ts`/`.cjs` script is named below (the 44 the 2026-09-02 audit found
uncatalogued were added the same day, in "Also catalogued" lists per section); the remaining files
are fixtures, SQL, subfolder helpers, and small shared helpers grouped rather than itemised.

> The two counts in the sentence above are generated facts, not prose. Keep them in the exact
> `(N files)` / `(N entries)` shape — tooling rewrites that sentence by regex.

Legend: **[live]** routine tooling · **[infra]** runner/guard plumbing · **[one-shot]** completed
migration/batch helper that is a candidate for an `archive/` subfolder under `scripts/` once its
migration has shipped (see `docs/maturity-backlog-workorders.md` L1).

## Runner & guard infrastructure [infra]

| Script                                                                                                                                                                                                                                                                  | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run-heavy.mjs`                                                                                                                                                                                                                                                         | Acquires shared/exclusive cross-worktree leases (`test-run-lock.mjs`) so focused checks can overlap safely                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ci-coverage.mjs`                                                                                                                                                                                                                                                       | Derives whether `.github/workflows/ci.yml` actually re-runs a named gate for a given change scope (step/job `if:` guards evaluated, not just presence in the YAML); used by `browser-test-plan.mjs` to report honest CI coverage                                                                                                                                                                                                                                                                                                                                                       |
| `gate-receipts.mjs`                                                                                                                                                                                                                                                     | Content-addressed memoisation of `lint`/`typecheck`/Vitest so an unchanged gate is never rerun locally (never in CI)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `run-tsx.mjs`, `run-vitest.mjs`, `run-playwright.mjs`, `run-eval-safe.mjs`                                                                                                                                                                                              | Typed/test/e2e/eval entrypoint wrappers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `dev-free-port.mjs`, `ensure-local-server.mjs`                                                                                                                                                                                                                          | Project-stable localhost port selection + background server ensure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `design-sync.mjs`, `capture-mockup-screenshots.mjs`                                                                                                                                                                                                                     | Local design-sync CSS prep (`node scripts/design-sync.mjs`) + redesign "current" PNG pack after ensure (`node scripts/capture-mockup-screenshots.mjs`)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `check-node-engine.cjs`, `install-git-hooks.mjs`, `guard-push.mjs`, `guard-next-build.mjs`                                                                                                                                                                              | Install/preflight guards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `setup-codex-cloud.sh`, `maintain-codex-cloud.sh`, `install-codex-cloud-command-shims.sh`, `check-codex-cloud-raw-env.sh`, `delete-codex-cloud-branch-with-pat.sh`, `check-codex-cloud-setup.mjs`, `check-github-shell-access.mjs`, `ensure-codex-cloud-git-remote.mjs` | Reproducible Codex Cloud toolchain/profile setup, profile-loading Node command shims, a pre-profile name-only credential probe (`FAIL-KNOWN`/`exit 2` only for documented `OPENAI_BASE_URL`; hard `STOP` otherwise), an operator-only non-Cloud PAT branch-deletion helper, sanitized Personal Pro capability/route acceptance, fail-closed GitHub shell control-plane acceptance (`check:github-shell-access` = offline self-test; `check:github-shell-access:live` = provider-backed identity/permission/API plus non-mutating push proof), and safe credential-free `origin` repair |
| `setup-claude-cloud.sh`, `apply-claude-cloud-profile.mjs`                                                                                                                                                                                                               | Claude Code on the web container parity. Tiered, marker-guarded provisioner (`profile`, `plugins`, `gh`, `deno`, `browsers`, `python`) wired as the second `SessionStart` hook via `--session`, which runs the cheap tiers inline and detaches the ten-minute browser/OCR ones; plus the applier that unpacks `.claude/cloud-profile/` into the container's `~/.claude` (settings deep-merged, memories never clobbered). Both refuse to run unless `CLAUDE_CODE_REMOTE=true`. See `docs/claude-cloud.md`                                                                              |
| `ci-change-scope.mjs`, `pr-policy.mjs`, `pr-mergeability.mjs`                                                                                                                                                                                                           | CI change classification + PR policy + conflict signal (self-tested via `check:ci-scope`/`check:pr-policy`/`check:pr-mergeability`)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `check-outstanding-issues.mjs`, `check-pr-mergeability-workflow.mjs`                                                                                                                                                                                                    | Outstanding-issues ID/marker/no-driver guard + PR mergeability workflow contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `outstanding-issues.mjs`                                                                                                                                                                                                                                                | Writer for `docs/outstanding-issues.md` (`issues:add` / `issues:done` / `issues:update`) — allocates the id, picks the right table, escapes `\|`, and re-runs the guard on its own output. Never hand-edit that file, as with `ledger:append`                                                                                                                                                                                                                                                                                                                                          |
| `check-ledger-stamp-retention.mjs`                                                                                                                                                                                                                                      | On-demand branch-safety check (`check:ledger-stamp-retention`, not wired into CI/`verify:cheap`): derives touched `docs/outstanding-issues.md` row IDs from git history between merge-base and `HEAD`, then verifies each still carries its branch content post-merge/rebase, catching silent conflict-resolution loss                                                                                                                                                                                                                                                                 |
| `check-installed-lock-parity.mjs`, `phone-chrome-plan.mjs`, `verify-phone-chrome.mjs`, `playwright-browser-preflight.mjs`                                                                                                                                               | Lock-trust preflight, change-scoped phone contracts, and Playwright browser-binary preflight before build                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `audit-merge-loss.mjs`                                                                                                                                                                                                                                                  | Advisory blob-comparison sweep for merged PRs a later merge resolution silently reverted (`audit:merge-loss`); names the PR and files and exits 0 — a deliberate revert is identical at blob level, so a positive needs human confirmation                                                                                                                                                                                                                                                                                                                                             |
| `final-merge-audit.mjs`                                                                                                                                                                                                                                                 | Fail-closed local merge-tree audit; explicit provider mode adds PR/check/thread/tree/deployment proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `child-process-result.mjs`, `cli-utils.ts`, `productivity-core.mjs`                                                                                                                                                                                                     | Shared helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `test-focused.mjs`, `test-run-selection.mjs`, `test-cache-path.mjs`, `test-environment.mjs`                                                                                                                                                                             | Backs `npm run test:focused` — change-scoped selection, cache pathing, env setup; fails closed for deleted files and test infrastructure                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `primary-checkout-lease.mjs`, `test-run-lock.mjs`, `clean-worktree.mjs`, `worktree-inventory.mjs`                                                                                                                                                                       | Cross-worktree lease arbitration for the primary checkout, plus report-only registered-worktree and explicit-root fleet inventory                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
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
`check-icon-scale.mjs`, `check-design-system-contract.mjs`,
`generate-design-system-adoption.mjs` (`npm run design-system:adoption:update` /
`check:design-system-adoption`), `generate-design-sync-contract.mjs` +
`check-design-sync-contract.mjs` (`npm run design-system:design-sync:update` /
`check:design-sync-contract`), `adopt-visual-baselines.mjs`
(`npm run design-system:baselines:adopt`), `check-function-grants.mjs`,
`check-owner-scope-api.mjs`, `check-client-bundle-secrets.mjs`, `verify-pr-local.mjs`,
`verify-release-offline.mjs`, `check-codex-cloud-setup.mjs`. `check-gate-manifest.mjs` cross-checks that every gate in the
`verify:full:internal` chain also runs in CI's `static-pr` job, so the two lists can't drift.

Also in the gate set: `check-assets.mjs`, `check-branch-review-ledger.mjs`,
`check-hosted-migration-role.mjs` (`check:migration-role` — pins the immutable applied migration and
the `postgres` role), `check-edge-functions.mjs`, `check-env-parity.mjs`, `check-ci-env.mjs`,
`run-gitleaks-pinned.mjs`, `rag-offline-contract.mjs` + `test-rag-offline.mjs` (offline RAG
contract), `check-lighthouse-budget.mjs` + `run-lighthouse-budget.mjs`, `measure-cls-attribution.mjs`
(ledger `#147` — names the elements behind a CLS breach, which Lighthouse's own
`layout-shift-elements` audit did not; CLS reproduces offline, LCP does not), and the workflow-contract
guard `check-pr-policy-workflow.mjs`.
`audit-formatting-fixtures.ts` checks the formatting fixtures themselves.
`setup-codex-cloud.sh`, `maintain-codex-cloud.sh`, and
`install-codex-cloud-command-shims.sh` reproduce the provider-free Cloud runtime documented in
`docs/codex-cloud.md`; `npm run check:codex-cloud` verifies that
the runtime pins, install commands, offline defaults, and documentation stay aligned.
Programme execution helpers (no retrieval/ranking behaviour change): `rag-phase-launch-check.mjs`,
`rag-task-brief.mjs`, `check-rag-phase-receipts.mjs`, and `build-rag-plan-packages.mjs`.

Also catalogued (2026-09-02), gate and CI helpers:

- `check-clinical-hazard-controls.mjs` (`check:clinical-hazard-controls`) — validates `docs/clinical-hazard-controls.json`: hazards H1–H6 present, every control state one of the four allowed values, the two named decision records present and dated.
- `check-coverage-inventory.mjs` (`check:coverage-inventory`) + `coverage-contract.mjs` — the post-run LCOV guard that every file in the shared coverage include globs appears in the report, and the shared contract Vitest reads the same globs from.
- `check-dead-code-candidate.mjs` (`check:dead-code-candidate`) — refuses to call a symbol dead on "nothing imports it" (unchecked plan boxes, fixtures, dynamic references); see `docs/agents/dead-code-deletion.md`.
- `check-diff-integrity.mjs` (`check:diff-integrity`) — refuses a diff that silently destroys committed content (test-case floors, truncation artefacts; written after `#Y30AXB`); see `docs/agents/test-deletion-guard.md`.
- `check-ledger-write-discipline.mjs` (`check:ledger-write-discipline`) — enforces the conflict-free ledger architecture at the Git boundary: immutable review records, one serial outstanding-issues reconciliation.
- `check-mockup-retirement.mjs` (`check:mockups`) — makes the written record in `mockups/README.md`, not a reachability scan, the gate on retiring a mockup.
- `check-outstanding-issues-snapshot.mjs` (`check:outstanding-issues-snapshot`) + `generate-outstanding-issues-snapshot.mjs` (`snapshot:issues`; also `prebuild`/`postbuild`) — `data/outstanding-issues-snapshot.json` freshness and generation.
- `generate-hazard-register-snapshot.mjs` (`snapshot:hazards`) — builds `data/hazard-register-snapshot.json` for the developer hub's hazard register from `docs/clinical-hazard-controls.json` and `docs/clinical-hazard-analysis.md`, and records the Caring Contacts and Ward Flow registers, retired with those prototypes on 2026-09-26, as retired rather than silently dropping them.
- `check-repo-awareness-snapshot.ts` (`check:repo-awareness-snapshot`) + `generate-repo-awareness-snapshot.ts` (`snapshot:repo-awareness`) — `data/repo-awareness-snapshot.json` (routes, documentation catalogue coverage, review state) freshness and generation.
- `check-privacy-readiness.mjs` (`check:privacy-readiness`, `check:privacy-readiness:release`) — validates `docs/governance/privacy-readiness.v1.json` required ids and release-blocking states.
- `check-source-catalogue.ts` (`check:source-catalogue`) — repository source references, providers and coverage issues from `src/lib/sources/repository-providers`.
- `check-stale-docs.mjs` (`check:stale-docs`) — reports Markdown docs untouched for `--days` and linked from nowhere, and exits 1 when it finds any. Refuses shallow clones. Local only; it does not delete docs.
- `check-playwright-browser-revision.mjs` (`check:playwright-browser-revision`) — fails closed unless the pinned Chromium revision has a launchable binary on disk (`#312`).
- `playwright-pr-shards.mjs` (`check:playwright-pr-shards`) — duration-aware shard groups for the required Chromium PR journeys.
- `browser-test-plan.mjs` (`plan:browser`, `check:browser-test-plan`) — chooses the smallest browser gate that still covers a change.
- `classify-visual-baseline-outcome.mjs` — decides whether a failed `test:e2e:visual` run was pixel drift (advisory) or an infrastructure failure that stays red.
- `lighthouse-measurement-outcome.mjs`, `lighthouse-time-budget.mjs`, `live-web-vitals-inputs.mjs` — Lighthouse budget runner helpers: whether a cell produced gradeable evidence, bounded-stage timing, and validation of the dispatch-only live Web Vitals matrix.
- `check-image-content-contract.mjs`, `trivy-image-scan.mjs`, `resolve-oci-image-digest.mjs`, `app-container-smoke.mjs` (`smoke:app-container`) — container CI: final-image hardening assertions, pinned Trivy scan + SBOM, multi-platform digest lookup for pinning base images, and a provider-free boot smoke of the built app image.
- `check-worker-python-lock.mjs` (`check:worker-python-lock`, `check:worker-python-cloud-lock`, `check:worker-python-locks:static`), `generate-worker-python-lock.mjs` (`generate:worker-python-lock`, `generate:worker-python-cloud-lock`), `worker-python-lock-config.mjs` — the hashed `worker/python/requirements.txt` lock targets.
- `check-dev-drive-cache.mjs` (`check:dev-drive-cache`) — Windows Dev Drive npm cache registration and Defender trust (`#6SMMB4`).

Also catalogued (2026-09-04):

- `check-chain-mirror-parity.ts` (`check:chain-mirror-parity`) — replays the migration chain and diffs the result against `supabase/schema.sql`, catching drift that "chain applies" and "manifest is not stale" checks both miss.
- `check-dependency-drift.mjs` (`check:dependency-drift`) — flags a surface whose transitive import closure changed even though the files a staleness check names directly did not.
- `check-design-drift-ratchet.mjs` (`check:design-drift-ratchet`) — ratchet guard for two design-token drift metrics (bypass-prone inline `style={{ }}` under `src/**`; design-system components with zero product importers).
- `stamp-service-worker.mjs` (part of `build:internal`) — gives `public/sw.js` a different body on every build so the browser's byte comparison detects an update and fires `updatefound`/`activate`.

use `verify:phone-chrome` before the broad UI gate. It checks installed-lock parity, then selects focused contracts and Playwright owners from the changed paths; shared foundations add `verify:ui` last. Documentation-only scopes run only documentation guards. `audit:final-merge` is local-only unless both `--providers` and `ALLOW_PROVIDER_READS=true` are supplied.

## Ingestion, indexing & reindex [live]

`import-documents.ts`, `reindex.ts`, `reindex-health.ts`, `check-indexing.ts`,
`recover-ingestion-queue.ts`, `cleanup-abandoned-reindex-generations.ts`,
`ingestion-autopilot.ts`, `backfill-smart-index.ts`,
`verify-recovery-readiness-evidence.ts` (strict bounded offline recovery-evidence and operation-manifest validation).

## Document intelligence & governance [live]

`enrich-documents.ts`, `classify-documents.ts`, `backfill-gold-document-labels.ts`,
`audit-source-governance.ts`, `check-document-label-coverage.ts`,
`check-document-label-governance.ts`, `promote-public-documents-batch.ts`,
`audit-public-document-approvals.ts`, `production-readiness.ts`, `check-supabase-project.ts`,
`check-default-acl.ts`, `check-drift.ts`, `generate-drift-manifest.ts`,
`check-migration-history-alignment.ts`.

Also catalogued (2026-09-02): `build-medication-interaction-index.ts` (`medications:interactions` /
`check:medication-interactions` — builds `data/medication-interaction-index.json` from the catalogue
snapshot and the curated lexicon), `build-medication-lexicon-report.ts` (`medications:lexicon-report` /
`check:medication-lexicon-report` — renders the lexicon as the clinician-reviewable
`docs/medication-interaction-lexicon-review.md`), `probe-corpus-image-encodings.mjs` (reports image
encoding / stream-filter patterns across the corpus PDFs), and `inspect-shadow-extraction.ts` (reads the
docling-vs-legacy B4 shadow-extraction measurements; see `docs/worker-deploy-runbook.md`).

## RAG evaluation [live]

`eval-rag.ts`, `eval-rag-offline.mjs`, `eval-retrieval.ts`, `eval-quality.ts`,
`eval-answer-quality.ts`, `eval-search.ts`, `eval-search-api.ts`, `eval-assertions.ts`,
`compare-retrieval-eval.ts`, `retrieval-health.ts`, `profile-retrieval-rpcs.ts`,
`warm-retrieval-cache.ts`, `tune-search-weights.ts`, `check-rag-fixtures.mjs`, `eval-trend.mjs`
(trend across runs), `eval-utils.ts` (shared harness helpers),
`check-site-content-freshness.ts` (strict offline site-content release/queue/worker evidence classifier;
live mode remains authorization-gated and is not used by CI),
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
Docling lab (isolated, outside `scripts/`): `eval/docling/` —
`node eval/docling/report/build-report.mjs --validate-only` (offline contract gate) and
`npm run generate:docling-lab-lock` (hashed lock); the benchmark itself is run manually via
`eval/docling/run-lab.sh` (no dedicated CI workflow). See `eval/docling/README.md`.

Editing anything in this section is a protected-surface change — read `docs/rag-behaviour/` and flag
the task before you start.

## Registry / catalogue content [live]

`seed-registry-records.ts`, `embed-registry-records.ts`, `reconcile-registry-governance.ts`,
`import-services-export.ts`, `import-differentials-export.ts`, `seed-differential-records.ts`,
`import-medications-export.ts`, `seed-medication-records.ts`, `review-therapy.mjs`
(`therapy:review` — report-only by default; qualified-clinician, interactive-TTY sign-off only;
source and generated bytes roll back together on failure unless a concurrent source edit must be
preserved, in which case generated assets return to their exact pre-review state and the CLI fails).
Also catalogued (2026-09-02): `build-mha-act-sections.mjs` (`check:mha-act-sections` — extracts and
curates the plain-English Mental Health Act 2014 (WA) section summaries the Forms mode cites).
`review-clinical-record.mjs` (`clinical:review` — report-only by default; the clinical owner's
interactive-TTY sign-off for forms, Act-section summaries and statutory timeframes, one record per
typed confirmation, with a `reviewedContentSha256` content pin that `check:mha-act-sections` and
`check:forms-review-sheet` enforce; guide: `docs/clinical-sign-off-how-to.md`).

## Build & assets [live/infra]

`build-worker.mjs`, `build-analyze.mjs`, `build-therapies-index.mjs`,
`build-cross-mode-differentials-index.mjs`, `build-ranking-snapshot.ts`,
`build-forms-pdf-manifest.mjs` (`check:forms-pdf-manifest` — derives each committed WA MHA form
PDF's sha256, size, and whether opening it needs a user password; offline, fails closed),
`generate-site-map.ts`, `generate-brand-assets.ts`, `generate-sample-documents.ts`,
`check-sample-extraction.ts`, `optimize-public-images.mjs`.
Also catalogued (2026-09-02): `generate-gates-figures.mjs` (`design-system:gates-figures:update`;
part of `check:design-system-contract` — the ratchet-figures block in `docs/design-system/GATES.md`) and
`token-layer-divergences.mjs` (`design-system:token-divergence:update`; part of
`check:design-system-contract` — the v1/v2 token-layer divergence contract).

## Maintenance & ops [live]

`cleanup-storage.ts`, `purge-query-logs.ts`, `audit-tables.ts`, `supabase-recovery-status.ts`,
`promote-query-misses.ts`, `flake-ledger.mjs`, `sweep-branch-ledger.mjs`, `dependency-report.mjs`,
`set-site-administrator.ts`, `ops-digest.mjs`, `build-clinical-review-queue.ts`,
`verify-locality-metadata.ts`, `update-docs-inventory.mjs`.

### Review ledger, branches and skills [live]

- `branch-review-ledger.mjs` — the **only** way to read or write `docs/branch-review-ledger.md`
  (`ledger:lookup` / `ledger:append` / `ledger:dedupe` / `ledger:rotate`). Never hand-write a row.
- `merge-branch-review-ledger.mjs` — historical: the `merge=ledger` union driver it implemented was
  removed from `.gitattributes` (ledger #133); the script is retained for reference only.
- `sync-open-pr-branches.mjs` (`sync:pr-branches`), `sync-pr-branches.mjs` (compatibility entry point) — anti-churn sync for stale open PR heads;
- `pr-batch-core.mjs`, `pr-batch-github.mjs`, `pr-batch-runner.mjs`, `pr-batch-worker.mjs`, `pr-batch-policy.mjs` — disabled-by-default sequential PR controller, durable GitHub state, credential-isolated repair integration, and workflow policy checks. Activation and recovery: [PR batch runner](pr-batch-runner.md).
  refuses a missing or bot `gh` identity. `sweep-merged-branches.mjs` — merged-branch sweep.
- `reconciliation-preflight.mjs`, `reconciliation-evidence-pack.mjs` — broad chat/worktree
  reconciliation entry point and its evidence bundle; see `docs/reconciliation-playbook.md`.
- `list-database-skills.mjs` (`skills` / `check:skills`), `sync-skills.mjs`, `skill-create.mjs` —
  the `.agents/skills/` catalogue.
- Also catalogued (2026-09-02): `generate-branch-review-index.mjs` (`ledger:index` /
  `ledger:index:check` — renders `docs/branch-review-index.md`); `ledger-inbox.mjs`
  (`issues:add` / `issues:update` / `issues:done` / `issues:queue` / `issues:reconcile` and
  `check:outstanding-issues` — the conflict-free intake for the outstanding-issues ledger);
  `issue-id.mjs` (ULID / legacy / display issue-id patterns shared by the ledger tooling);
  `issues-report.mjs` (`issues:report`); `setup-codex-worktree.mjs` (`setup:codex-worktree` —
  one isolated exact-lock worktree for sweeps); `worktree-cleanup.mjs` (safe orphan-worktree
  pruning and reporting, `#6GW95D`); `retryable-fs.mjs` (Windows-safe recursive removal retries
  shared by the worktree tools); `diagnose-codex-cloud.mjs` (`diagnose:codex-cloud`).

### Live/staging verification [live]

`soak-test.ts`, `test-cross-tenant-staging.ts` (the executable owner-boundary proof behind
`docs/staging-tenancy-release-evidence.md`), `deployment-boot-smoke.mjs`, `run-live-tests.mjs`,
`probe-answer-timing.mjs` (asks the live site one question and prints the `Server-Timing`
breakdown of where the answer's seconds went; refuses without `--allow-provider`).
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
