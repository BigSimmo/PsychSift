<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Context-aware working defaults

Read and follow [Context-aware working defaults](docs/agents/native-startup/contextual-working-defaults.md) before acting in this area. The full policy remains in force.

## Smart agent allocation

When agents are authorised, follow
[`docs/agents/smart-agent-allocation.md`](docs/agents/smart-agent-allocation.md)
before dispatch. Keep the user's main-chat model; report missing hosted routing
honestly instead of paying for API workarounds.

# How these rules are organised

At task start, read [task lifecycle and receipt handoff](docs/task-receipts.md) and [the organisation map](docs/organisation/README.md).

Native loading: the core stays below the 24,000-byte per-file rule limit. Linked policy is mandatory when its topic applies. Antigravity loads the same canonical modules through `.agents/rules/project-*.md`; these wrappers contain references, not policy copies. Inspect fresh native context before claiming complete loading.

This file is the always-loaded core. It carries the boundaries that prevent irreversible harm, and
the sections a committed gate parses by exact text. Every other rule keeps its heading here and its
full text — verbatim, nothing dropped — in a named reference file. Open the file before acting in
its area.

**Read these first; they prevent damage that cannot be undone, and their full text is below:**
`# Supabase project safety` (merging a migration reaches the live clinical database within
seconds, with no deploy step in between), `# RAG ranking protection`, `# Railway project safety`,
`# API and provider confirmation boundary`, and `# Local server safety`.

<!-- prettier-ignore -->
| Topic | Full text |
| --- | --- |
| Gate selection, the verification tier table, gate receipts | [`docs/agents/verification-gates.md`](docs/agents/verification-gates.md) |
| The whole PR lifecycle for every tool: open, follow CI, review threads, records, merge authority, landed, sync, sweeps | [`docs/agents/pull-request-workflow.md`](docs/agents/pull-request-workflow.md) |
| The `upload` shortcut | [`docs/agents/upload-shortcut.md`](docs/agents/upload-shortcut.md) |
| Button and route wiring, the bundle budget | [`docs/agents/wiring-and-bundle-budget.md`](docs/agents/wiring-and-bundle-budget.md) |
| External skill precedence, evidence and calibration | [`docs/agents/external-skill-precedence.md`](docs/agents/external-skill-precedence.md) |
| Deleting code you believe is dead | [`docs/agents/dead-code-deletion.md`](docs/agents/dead-code-deletion.md) |
| Claude Code hook scripts | [`docs/agents/claude-hook-scripts.md`](docs/agents/claude-hook-scripts.md) |
| The `bug-hunter` shortcut | [`docs/agents/bug-hunter-shortcut.md`](docs/agents/bug-hunter-shortcut.md) |
| Repository skills, the `/issues` outstanding-work memory | [`docs/agents/repository-skills-and-issues.md`](docs/agents/repository-skills-and-issues.md) |
| Codex dependency, review throttling, desktop worktree, reasoning effort, productivity, GitHub review, Cloud; Cursor Cloud | the `docs/agents/codex-*.md` and `docs/agents/cursor-cloud.md` pointers below |

Five always-loaded sections stay here in full. Exact-text gate protection is narrower than
that list: `# Search chrome behaviour` is pinned by `tests/ui-overlay-css-contract.test.ts`
(marker + “Hidden means zero reserve”); `## Codex Cloud environment` is pinned as a
**pointer heading** by `scripts/check-codex-cloud-setup.mjs` (body lives in
`docs/agents/codex-cloud-environment.md`); `## Bare PR publication is not readiness work`
and the format-before-push rule stay here and are enforced operationally via skills,
hooks, and `scripts/guard-push.mjs` rather than a body-text parser; `## Anti-conflict and
CI-speed operating procedure` stays here by convention and is **not** exact-text pinned —
silent reword would still pass `verify:full`. Do not treat every always-loaded block as
gate-locked.

<!-- BEGIN:dependency-shortcut -->

## Dependency shortcut

For the full Codex dependency shortcut workflow, see [`docs/agents/codex-dependency-shortcut.md`](docs/agents/codex-dependency-shortcut.md).

<!-- END:dependency-shortcut -->

<!-- BEGIN:bug-hunter-shortcut -->

## Bug-hunter shortcut

For the `bug-hunter` targeted defect-discovery shortcut, its execution rules, and its scope and safety limits, see [`docs/agents/bug-hunter-shortcut.md`](docs/agents/bug-hunter-shortcut.md).
<!-- END:bug-hunter-shortcut -->

<!-- BEGIN:codex-review-throttling -->

## Codex review throttling and routing

For Codex review throttling, branch routing, review ledger append rules, and review thread resolution guidance, see [`docs/agents/codex-review-throttling.md`](docs/agents/codex-review-throttling.md) and [`docs/codex-review-protocol.md`](docs/codex-review-protocol.md).

<!-- END:codex-review-throttling -->

<!-- BEGIN:local-server-safety -->

# Local server safety

- If the user says `run`, execute `npm run ensure` and return the printed URL.
- If the user asks for UI/frontend changes, browser QA, screenshots, mobile checks, or a local app link, run `npm run ensure` before opening or testing the app, even if the user did not say `run`.
- Never assume `localhost:3000`, `localhost:3001`, or `localhost:3002`.
- Never attach to a local server unless `/api/local-project-id` confirms it is this project.
- Do not kill or modify other projects' local servers. If the stable project port is busy, let `npm run ensure` choose the next safe project URL.
- Do not run a permanent watcher. Only start or verify the server when the current chat task needs the app or the user asks to run it.

<!-- END:local-server-safety -->

<!-- BEGIN:codex-desktop-worktree-setup -->

# Claude Code hook scripts

For the `.claude/hooks/*.sh` contract — the executable bit in the index, hook registration, line endings, failure behaviour, timeouts, and SessionStart output, see [`docs/agents/claude-hook-scripts.md`](docs/agents/claude-hook-scripts.md).

# Codex Desktop worktree setup

For Windows Codex Desktop worktree bootstrap and dry-run instructions, see [`docs/agents/codex-desktop-worktree-setup.md`](docs/agents/codex-desktop-worktree-setup.md).

<!-- END:codex-desktop-worktree-setup -->

# Reasoning effort calibration

For the Codex reasoning-effort baseline, the Cloud `xhigh` confirmation gate, and the
plan-effort/build-effort table, see
[`docs/agents/codex-reasoning-effort.md`](docs/agents/codex-reasoning-effort.md).

# Process hardening phases

## Bare PR publication is not readiness work

Read and follow [Process hardening phases](docs/agents/native-startup/process-hardening.md) before acting in this area. The full policy remains in force.

<!-- BEGIN:page-and-button-wiring -->

# Deleting code you believe is dead

For what must hold before removing an exported symbol, and the `check:dead-code-candidate` refusal list, see [`docs/agents/dead-code-deletion.md`](docs/agents/dead-code-deletion.md).

# Deleting tests, or letting a tool delete them for you

For the 2026-08-31 whole-file truncation incident (`#Y30AXB`), the `check:diff-integrity` test-case floor and truncation-artefact rules, and how a deliberate reduction is recorded in `diff-integrity.json`, see [`docs/agents/test-deletion-guard.md`](docs/agents/test-deletion-guard.md).

# Page and button wiring

For the button, navigation, new-route, and gate rules, see [`docs/agents/wiring-and-bundle-budget.md`](docs/agents/wiring-and-bundle-budget.md).

# Bundle budget

For the three `bundle-budget.json` safeguards, how chunks are attributed, and how to measure them, see [`docs/agents/wiring-and-bundle-budget.md`](docs/agents/wiring-and-bundle-budget.md).
<!-- END:page-and-button-wiring -->

# Search chrome behaviour

Read and follow [Search chrome behaviour](docs/agents/native-startup/search-chrome-behaviour.md) before acting in this area. The full policy remains in force.

# External skill precedence

Read and follow [External skill precedence](docs/agents/native-startup/external-skill-precedence.md) before acting in this area. The full policy remains in force.

<!-- BEGIN:supabase-project-safety -->

# Supabase project safety

- This repo targets the live Supabase project `PsychSift Production`.
- **MERGING TO `main` DEPLOYS TO PRODUCTION.** The Supabase GitHub integration has **"Deploy to
  production" ENABLED**, production branch **`main`** — confirmed by a dashboard read on 2026-08-21,
  after two earlier sessions inferred it wrongly in both directions. Any migration merged to `main` is
  applied to the live clinical database automatically, within seconds (measured at 34 s in
  `docs/audit/live-drift-forensics-2026-08.md` §3.7). There is no separate deploy step to forget and no
  window to hold it back. Therefore:
  - **Treat merge approval as production-deploy approval.** Never merge a PR touching
    `supabase/migrations/**` outside an approved window, and never enable auto-merge on one.
  - **Never write PR metadata promising a deferred deploy.** There is no deploy step to defer to,
    so "AWAITING DEPLOY WINDOW", "deployed manually after merge", "deployment is pending operator
    approval" and "not yet applied" all describe a control this repository does not have — and they are dangerous exactly when believed, because
    they invite a reviewer to merge a change they think is still parked. PR #2502 carried that
    phrase in its own title and reached the live database within minutes of merge; the post-merge
    `live-drift` run caught it as pending-apply drift. State the merge decision instead ("merge only
    inside the approved window"), which is the control that actually exists. `scripts/pr-policy.mjs`
    hard-blocks the claim on any PR touching `supabase/migrations/**` and quotes the offending
    phrase back. The title is always in scope; body statements must name the database subject, so a
    mixed PR keeps saying "do not deploy the staging worker until its image passes smoke tests" —
    a real constraint on something merging does not do. Approval sought BEFORE merge is likewise
    sanctioned and never matched. Patterns and their pinned behaviour table live in
    `scripts/pr-policy.mjs` beside the RAG and governance gates.
  - **After such a PR merges, the schema-application gate is the post-merge `live-drift` workflow**
    (`.github/workflows/live-drift.yml`), which must complete with BOTH `npm run check:drift` and
    `npm run check:migration-history` green. `supabase migration list` is not that gate: it reads the
    recorded history only, so it cannot tell an applied migration from a history row whose statements
    never executed — the exact shape of the fifteen no-statements rows `#Q5JHBJ` exists for.
    `check:drift` compares the live schema itself. A manual `supabase migration list --linked
--project-ref sjrfecxgysukkwxsowpy` read is a useful supplement, but it is provider-backed and so
    needs explicit user confirmation first, per "API and provider confirmation boundary" above. A
    merged-but-unapplied migration is silent drift — the incident this whole programme exists to
    close.
  - **A migration that cannot run inside a transaction cannot ship this way.** The integration applies
    each migration in one transaction, so a bare `CREATE INDEX CONCURRENTLY` migration fails outright.
    Index work stays operator-prebuild + a validate-only guard migration (the `20260804110240` pattern,
    see the guard-migration contract below).
  - **Automatic branching is also ON** (one preview database per PR that changes `supabase/**`, limit
    3). Supabase warns that Branching Compute is **not covered by the organisation's Spend Cap**. CI's
    `Migration replay` job (`db-reset-verify`, `supabase migration up --local`) independently replays
    the whole chain on every database-touching PR, so preview branches are a second net rather than the
    only one.
- Expected project ref: `sjrfecxgysukkwxsowpy`.
- Older unused project ref `qjgitjyhxrwxsrydablr` belongs to `Database`; treat it as stale and do not use it.
- Hosted migrations, `supabase/schema.sql`, `supabase/roles.sql`, CI, and deployment tooling must target role `postgres`; never assume a platform-reserved role. The single older applied migration is immutable and pinned by `npm run check:migration-role`.
- Bare-image storage scaffolding must discover its local schema owner at runtime and must never be reused as hosted migration SQL.
- Run `npm run check:migration-role` after changing Supabase SQL, migration tooling, CI replay, or disaster-recovery instructions.
- Run `npm run check:supabase-project` after changing Supabase env values.
- **Guard-migration contract.** Any mark-applied version, `supabase migration repair --status applied`,
  hand-applied SQL later recorded as a migration, or other history repair MUST ship a fail-fast
  validation guard migration in the same change, following `20260804110240_restore_rag_search_health_indexes.sql`
  exactly (validates presence + `indisvalid`/`indisready` + normalized definition, never builds,
  `set local` timeouts, one `raise exception`). `schema_drift_snapshot()` v2 (`20260818090000`) reports every
  `supabase_migrations` version recorded without executed statements; `check:drift` fails on any such row
  that lacks a reviewed `migration_history` entry in `supabase/drift-allowlist.json` pointing at its guard
  (`guard.class` `validation` is mandatory for versions from 2026-08-18; `superseded`/`no_ddl` are for
  pre-contract history only). Never allowlist a history row bare, and never widen an entry's class to make
  it pass. Enforced offline by `tests/migration-history-guards.test.ts`; index-monitoring decisions on the
  retrieval-critical tables are enforced by `tests/search-health-index-coverage.test.ts` +
  `supabase/search-health-unmonitored-indexes.json` (`required_indexes` changes travel by migration only).
  Full contract: `docs/database-drift-detection.md`.

## Supabase merge caution

Merging a PR that touches `supabase/` applies its migrations to the live clinical database
within seconds — there is no separate deploy step. Treat that merge as a production deploy.
`PR policy` still blocks edits to applied migrations and out-of-order or future-dated
migrations: **a migration already on `main` must never be edited** — ship a new migration with the
newest timestamp. Clinical-content and RAG-ranking PRs keep the clinical governance preflight,
the `RAG impact:` body line, the canary-pair requirement, and exclusion from the unattended
`Clear PRs` batch (`clinical-review-required` and `rag-evidence-required` in
`scripts/pr-batch-core.mjs`). Full rule: [Merge authority](docs/agents/pull-request-workflow.md#merge-authority).

<!-- END:supabase-project-safety -->

<!-- BEGIN:rag-ranking-protection -->

# RAG ranking protection

Retrieval/ranking behaviour is live-validated and safeguarded. Before touching any protected
surface, read `docs/rag-behaviour/` (README → behaviour-map → refuted-approaches → safeguards).

- **Flag it.** Any task that will touch `src/lib/rag/**`, clinical-search, retrieval-selection,
  released-search-order, ranking-config, evidence/result-sort/answer-ranking,
  evidence-relevance/semantic-rerank/eval-document-matching, the source-authority tiering
  (`src/lib/source-authority-registry.ts`, `src/lib/australian-source-priority.ts`), the eval harness
  (`scripts/eval-retrieval.ts`, `scripts/lib/clinical-aliases.ts`, ranking-tuning/snapshot
  tooling), the golden fixture/snapshot, or the retrieval RPCs must say so to the user BEFORE
  editing, even when the change looks incidental (refactor, rename, "just a comment"). The same
  applies to the two producers of retrieval inputs that sit outside `src/lib/rag/**` and are
  easy to mistake for plain ingestion: the text producers (`src/lib/chunking.ts`,
  `src/lib/extractors/**`, `worker/python/extract_pdf_assets.py`), which decide what ever
  becomes a chunk or a citation, and the structured-evidence producers
  (`src/lib/document-index-units.ts`, `src/lib/model-index-extraction.ts`,
  `src/lib/deep-memory.ts`), whose index units are queried directly by the candidate fan-out and
  whose `applyMemoryCardBoosts` rescores results. Added 2026-09-16; `pr-policy` classifies all
  of these as RAG-ranking surfaces, and `docs/rag-behaviour/safeguards.md` carries the reasoning.
  The other retrieval inputs are covered too (added 2026-09-25): retrieval RPC version choice
  and scoring helpers (`src/lib/retrieval-rpc-rollout.ts`, `clinical-evidence-haystack.ts`,
  `cross-document-synthesis.ts`, `corpus-grounding.ts`, `keyword-query.ts`), and the producers of
  enrichment, image-caption, embedding-field, table-fact and assertion rows
  (`src/lib/document-enrichment.ts`, `visual-intelligence.ts`, `image-filtering.ts`,
  `worker/embedding-fields.ts`, `worker/table-facts.ts`, `worker/assertion-tagging.ts`).
  The authoritative list is `ragRankingPatterns` in `scripts/pr-policy.mjs`, which also protects
  the ranking contract tests; where this sentence and that list ever differ, flag everything
  either names (aligned 2026-09-25).
- **PR nudge (advisory since 2026-09-17).** PRs touching those surfaces get a `pr-policy`
  **warning** — not a block — when the body has no explicit `RAG impact:` line. Still write one,
  because it is the fastest way to tell a reviewer whether ordering moved: either
  `RAG impact: no retrieval behaviour change — <reason>` or
  `RAG impact: behaviour change — canary pair <baseline> -> <post>`. The real safeguards are
  unchanged and both still fail closed: the live eval-canary below, and the source-pin contract
  test (`tests/rag-imputation-contract.test.ts`), which goes red on any edit to the imputation
  formulas or release-comparator key order.
- **Canary for behaviour.** Any retrieval/ranking/ordering behaviour change requires a live
  eval-canary before/after pair (doc/content recall pinned 1.0, zero per-case rr regressions)
  before it is trusted; regression → immediate single-commit revert + confirmation run.
  Dispatches are provider-backed (~$1–2) and always need explicit user approval.
- **Never** insert a comparator key above the relevance score, bulk-merge the wide
  captured-case alias tier into the strict golden tier, relax the clamped-score contract, or
  adopt tuner recommendations without a measured live gain. Offline-green + review-approved
  was proven insufficient for this surface on 2026-07-20 (see refuted-approaches).

<!-- END:rag-ranking-protection -->

<!-- BEGIN:railway-project-safety -->

# Railway project safety

- This repo deploys to the live Railway project `PsychSift` (`5deaad0b-675a-4c13-978e-5ca2b5b877f9`) in workspace `bigsimmo's Projects`. Full topology: `docs/deployment-architecture.md` §1.
- Production services `PsychSift` (Next.js app tier, serves `https://psychiatry.tools`) and `worker` (ingestion) auto-deploy from `BigSimmo/PsychSift` pushes to `main`; the `staging` environment runs the `app` service.
- The older Railway project `clinical-kb` (`4361c04f-dd3c-4ee9-9e97-49e4e5707b70`) is superseded with zero active deployments; treat it as stale — never `railway link` to it or deploy there.
- The similarly named Supabase project `PsychSift Production` is the database/auth tier, not a Railway project; see "Supabase project safety" above.
- Railway CLI token auth uses `RAILWAY_API_TOKEN` (personal account token; see `.env.example`). The project-scoped `RAILWAY_TOKEN` is for CI deploys only and cannot list or link projects; Cloud runtime acceptance no longer installs or probes the CLI, so that substitution rule is documentation-enforced until an operator workflow reintroduces CLI checks. Desktop/CLI MCP uses the secret-free `railway` entry (enable in `$CODEX_HOME/config.toml` or via a never-committed local edit — never commit `enabled = true`) plus `codex mcp login railway`; neither repository MCP file activates a hosted ChatGPT/Codex app.
- Railway deploys and mutations fall under the "API and provider confirmation boundary" below; verify target project/environment IDs before any mutation.
- **Safe, fast iteration.** Keep automatic Railway PR Environments disabled. Iterate locally with focused checks, use an explicitly requested isolated app preview when useful, and keep production deployment from protected `main`. Never copy production database/provider credentials or an ingestion worker into a routine PR preview. Any future automatic previews require an isolated base and Focused PR Environments, using the existing service watch paths. Follow [the preview policy and verified settings](docs/deployment-architecture.md#selective-railway-pr-previews); keep required CI and Supabase controls intact.

<!-- END:railway-project-safety -->

<!-- BEGIN:api-confirmation-boundary -->

# API and provider confirmation boundary

- Never run, modify, test, or otherwise interact with OpenAI, Supabase, GitHub/GitLab, hosted CI, production-like services, or provider-backed workflows without explicit user confirmation.
- Treat indirect API usage inside scripts, tests, release checks, PR tooling, and review automation as confirmation-required too.
- Prefer local, static, mocked, or offline checks. If a recommended verification would touch a provider, report the command and ask before running it.
- `npm run check:supabase-project`, live PR/CI tooling, answer-generation checks, ingestion checks against live services, and release gates that call providers are not automatic.
- Exception: the `Run PR` shortcut (see "## Run PR shortcut") is standing user confirmation for the specific GitHub actions it enumerates, for the duration of that sweep only.
- Exception: the `Clear PRs` shortcut (see "## Clear PRs shortcut") authorizes one finite sequential merge batch, including bounded repair API usage and the resulting Railway deployments, within its documented exclusions.

<!-- END:api-confirmation-boundary -->

# Publication workflows

- If a PR has auto-merge armed, its auto-merge state is user-owned and automation must not disable or re-enable it. Ordinary fast-forward pushes, bundled additions, and permitted branch syncs may proceed. A force-push, history rewrite, or base/target change while armed still hard-blocks with no override; wait for the user to change that state first.

## Anti-conflict and CI-speed operating procedure

Read and follow [Publication workflows](docs/agents/native-startup/publication-workflows.md) before acting in this area. The full policy remains in force.

## Codex Cloud environment

For the Codex Cloud environment specification, access profiles, MCP limits, and acceptance checks, see [`docs/agents/codex-cloud-environment.md`](docs/agents/codex-cloud-environment.md).

## Cursor Cloud specific instructions (not Codex Cloud)

For Cursor Cloud agent setup, live-vs-demo mode detection, verification commands, and GitHub
connector guidance, see [`docs/agents/cursor-cloud.md`](docs/agents/cursor-cloud.md).

# Commit as you go — the thing that loses work here is interruption, not carelessness

Read and follow [Commit as you go — the thing that loses work here is interruption, not carelessness](docs/agents/native-startup/commit-as-you-go.md) before acting in this area. The full policy remains in force.
