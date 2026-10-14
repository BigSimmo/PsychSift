# Database remediation playbook — multi-session execution guide

> **Programme complete (Phases 0–6 COMPLETE; D4 auto-deploy on `main` is ON).** Phases 0–6 of the database remediation programme are complete and D4 post-merge migration auto-deploy on `main` is ON. Read [`docs/database-remediation-coordination.md`](database-remediation-coordination.md) for the final closeout state and [`docs/supabase-remediation-closeout-notes.md`](supabase-remediation-closeout-notes.md) for deferred non-DDL notes. Do not re-run the historical phase prompts below.

Companion to [`database-remediation-plan.md`](database-remediation-plan.md) (the plan of record —
read it first in every session). This playbook exists so the work can be executed across **many
separate chat sessions**: each phase below carries the full context a fresh session needs and a
ready-to-paste prompt. Tracking anchor: the queued P1 ledger item titled “Live DB has 20 currently
missing repo-defined indexes and 10 retrieval RPC bodies diverge; weekly live-drift has been red
since 2026-07-26 with no routing”. After inbox reconciliation, resolve its numeric ID by exact title
before updating it; never assume an ID.

---

## Context briefing (historical background from the 2026-08 execution cycle)

**What happened.** Ledger `#248` remains open. Current evidence shows that migration
`20260705180000_reconcile_search_health_indexes.sql` is recorded as applied on the live Supabase
project (`PsychSift Production`, ref `sjrfecxgysukkwxsowpy`) while two of its indexes are
currently missing. Supabase's transaction model excludes a persisted partial application, and later
migrations show that history advanced, but neither point distinguishes skipped DDL/mark-applied
history from indexes that were created and later dropped. The Phase 1 read-only history and audit
check must establish that cause before the row is closed or remediation is attributed to it.

**Historical live state at 2026-08-14** (from `live-drift.yml` Actions run `31813064485`, 2026-08-14 — superseded by the completed Phases 0–6 closeout in [`docs/database-remediation-coordination.md`](database-remediation-coordination.md)):

- 20 `missing_live` indexes across many migrations — tables: `audit_logs` (2), `api_rate_limits`,
  `document_chunks`, `document_images` (3), `document_index_quality`, `document_index_units`,
  `document_publication_approvals`, `document_summaries`, `documents`,
  `image_caption_cache`, `indexing_v3_agent_jobs`, `ingestion_job_stages`, `medication_records`,
  `rag_aliases`, `rag_queries`, `rag_query_misses`, `storage_cleanup_jobs`.
  **`documents_title_trgm_idx` and `document_chunks_content_trgm_idx` are no longer among them** —
  both were restored in the 2026-08-14 incident window and re-verified `indisvalid`/`indisready`.
- 2 `unexpected_live` indexes: `document_table_facts_document_id_idx`,
  `storage_cleanup_jobs_owner_id_idx`.
- `def_hash` mismatches on 10 `match_*` retrieval RPCs — **unchanged at 2026-08-14, since resolved in Phase 3**
  (protected RAG surface; attribute-only `SET work_mem` differences reconciled without body divergence).
- Drift-failure routing is **live**: a failed run creates or updates the pinned issue
  "Live drift check failing" (currently **#1963**) and a green run closes it.

**Phase status (final closeout — see [`docs/database-remediation-coordination.md`](database-remediation-coordination.md)).** Phases 0–6 are **COMPLETE** and D4 auto-deploy on `main` is **ON**. The snapshot below reflects the historical mid-programme state as of 2026-08-18:

Phase 0 complete. **Phase 1 complete** — 1.1 (`20260705180000` was not mark-applied; the dashboard
audit-history pairing is still owner action, so `#248` stays open), 1.2 (PR #2087: all ten
mismatches are attribute-only `SET work_mem`, zero body divergence, zero repo-ahead, zero
UNCLASSIFIED), 1.3 whole-schema done with the remaining index sizing folded into Phase 5.
**Phase 2 complete** — PR #2093: staging at full migration parity, and `check:drift` against staging
**red with 19 items**, which is the finding the phase existed to produce rather than a failure of it;
a re-measure is owed once staging carries `20260818090000`. **Phase 6 repo-side complete** — its
migration deploy was subsequently completed (see `database-remediation-coordination.md`). Phases 3, 4, and 5 also completed across subsequent waves, and D4 auto-deploy on `main` is ON.

**Historical note on Phase 3 (completed).** Because 1.2 found zero repo-ahead bodies it became
repo-side work needing **no eval canary** — materially different from the prompt further down this
file, which still assumed per-RPC canary approvals. See [`database-remediation-coordination.md`](database-remediation-coordination.md) for the completed Phase 3–6 closeout record.

**Before starting any phase, check the open-PR list for the surface** (`#292`). Phase 0 was built
twice independently on 2026-08-14; a duplicate in Phase 3 or 4 wastes an approved production window
and eval-canary budget, not just tokens.

**Prior repair to imitate.** PR #1614 / migration `20260804110240_restore_rag_search_health_indexes.sql`
is the approved pattern: operator prebuilds indexes with `CREATE INDEX CONCURRENTLY` outside any
transaction, validates `pg_index.indisvalid AND indisready` plus normalized `pg_get_indexdef`
against a pinned canonical definition, and only then marks a fail-fast guard migration applied.

**Key repo facts every session needs:**

- Repo: `BigSimmo/PsychSift`, default branch `main`. Live Supabase ref `sjrfecxgysukkwxsowpy`
  (the ref `qjgitjyhxrwxsrydablr` is stale — never use). Migrations target role `postgres`.
- `supabase/migrations/` is the source of truth; `supabase/schema.sql` is a mirror;
  `supabase/drift-manifest.json` is generated (`npm run drift:manifest`, needs Docker) and
  sha-pinned to `schema.sql`.
- `check:drift` compares live (`public.schema_drift_snapshot()` RPC, service-role only) against
  the manifest. `search_schema_health()` is the runtime probe; its `required_indexes` list lives
  inside the function and is changed only by migration, never by editing `schema.sql`.
- Ledger: `docs/outstanding-issues.md`, mutated only via `npm run issues:add|update|done`.
- AGENTS.md rules that bind here: provider confirmation boundary (no OpenAI/Supabase/CI calls
  without explicit user approval); RAG ranking protection (flag before touching `match_*` RPCs or
  `src/lib/rag/**`; behaviour changes need a live eval-canary pair 36/36 / recall 1.0); run
  `npm run format` and commit before every push; `npm run check:migration-role` after Supabase SQL
  changes; PR bodies are parsed input (`RAG impact:` line, Clinical Governance Preflight).
- Related open ledger work: the P1 live-drift tracking item (anchor), `#102` (canary-gated documents index debt — do NOT
  fold into the restore), `#231` (latency budget binding — trigram-index hypothesis), `#056`/`#057`
  (staging parity, soak), `#011` (pool allocation), `#036` (public-corpus marker), `#022` (BMJ
  attestation apply), `#025` (webhook inert), `#183` (missing SUPABASE_ACCESS_TOKEN),
  `#188`/`#196`–`#200` (DR gaps), `#191` (ACL consolidation — last), `#098`/`#099` (round trips).

**Traps this programme has already hit.** Each cost real time; none is hypothetical.

- **The newest migration mentioning a function often does not define it.** These `match_*` functions
  are redefined 2–16 times across migrations, and
  `20260724130000_explicit_base_match_rpc_execute_grants.sql` — the newest file mentioning several of
  them — contains **zero** `create or replace function`; it only re-asserts grants. (An earlier
  version of this note said the same of `20260724120000_table_facts_plpgsql_execute.sql`; that was
  wrong — it **does** re-create `match_document_table_facts_text` at line 9 and is that function's
  canonical body, which is exactly why a clean replay resets the `work_mem` that `20260724000000`
  set on it. Corrected by the Phase 1.2 dossier, 2026-08-18.) Select the latest migration carrying
  an actual `as $$ … $$` body, not merely a reference.
- **`SET` attributes are part of the function hash.** The drift `def_hash` strips comments and
  whitespace from `pg_get_functiondef` and nothing else, so `ALTER FUNCTION … SET work_mem` (or
  `plan_cache_mode`) applied by migration but absent from the `schema.sql` mirror is guaranteed
  drift with a byte-identical body. All ten Phase 1.2 mismatches were this (forensics §1.2). Test
  the attribute-strip variant before diffing bodies.
- **Normalize before joining live functions to the manifest.** Joining manifest signatures to live
  `p.oid::regprocedure::text` reports all 93 functions as simultaneously missing _and_ extra, because
  the manifest stores `public.fn(extensions.vector,…)` while a live session renders `fn(vector,…)`.
  That is a join failure, not a finding. Strip `public.`, fold `extensions.vector` → `vector`, then
  test each surviving mismatch against the qualification variants before calling it divergence.
- **Resolve ledger rows by exact title, and check the row is still in the _open_ table.** The
  tracking anchor was cited as `#312` in an early prompt; `#312` is an unrelated row. Separately, a
  close request for `#333` was queued after confirming a `#333` row existed — but the match was the
  **archived** row, and the invalid request threw `#333 is already archived`, red-lining
  `docs:check-links` for the whole branch.
- **Node 24 is mandatory** (`engine-strict`). A cloud container may ship Node 20/22; `npm ci` then
  fails `EBADENGINE` and leaves `tsx` unresolvable, which fails `check:runtime`. Install Node 24
  before anything else.
- **Two known tooling failures are fixed — recognise the symptoms rather than re-diagnosing them.**
  `cancel request … targets missing pending request` was the ledger cancel-race (fixed in PR #1978;
  a cancellation whose target was already applied is now a loud no-op). A force-push rejected with
  "removed without an audit record" was `guardBaseForRange` comparing against abandoned history
  (also #1978; it now falls back to the merge base). Neither should need an override.

**Session hygiene for every phase:** start from a fresh worktree off latest `origin/main`
(`newtask` skill), one branch per phase (`claude/db-remediation-phase-N`), record evidence in
`docs/audit/live-drift-forensics-2026-08.md`, hand off via the `handoff` skill, and update the
live-drift tracking item via `npm run issues:update` before the session ends.

**Running two phases at once.** Phases whose targets differ (for example Phase 1.2 read-only against
production and Phase 2 mutating staging) can safely run concurrently — but the **ledger**, not the
database, is where they collide:

- **Assign one ledger row per session, explicitly, in the prompt.** Two pending mutations on the same
  row make the inbox refuse the whole batch until someone queues an explicit cancellation. Phase 1.2
  owns the live-drift tracking item; Phase 2 owns `#056`.
- **One reconciliation at a time, from a fresh-base branch.** Three ran in parallel on 2026-08-14 and
  collided. `npm run issues:reconcile` is the only thing that may edit `docs/outstanding-issues.md`.
- **Never merge `main` into a PR that carries a reconciliation** — it turns a complete transaction
  into a partial one and the guard correctly rejects it.
- **After a PR lands, verify the content on `main`, not the commit title** (`#324`): no gate catches
  a merge resolution silently reverting merged work, and this programme's branches have been through
  enough force-pushes and third-party commits for that to be a live risk.

**Model guidance:** Fable for Phases 1, 3, 6 (and #191 later) — judgment-heavy, expensive
mistakes. Opus is sufficient for Phases 0, 2, 4, 5, 7 — execution against this playbook.

---

## Phase 0 — Enablement (repo-only; no approval window needed) · Opus · 2–4 h — **COMPLETE 2026-08-14**

Delivered in PRs #1938, #1939 and #1951; the forced-dispatch proof is Actions run `31813064485`,
which auto-created issue #1963. The prompt below is retained as history.

Deliverables: drift-failure routing, post-migration drift trigger, evidence file scaffold.
Definition of done: PR merged; `check:github-actions` and `verify:pr-local` green; a forced
`workflow_dispatch` failure produces/updates the pinned issue.

**Prompt to paste:**

> Read docs/database-remediation-plan.md and docs/database-remediation-playbook.md, then execute
> Phase 0 only. On a fresh branch off origin/main: (1) extend .github/workflows/live-drift.yml so
> a failed run creates or updates a single pinned GitHub issue titled "Live drift check failing",
> body containing the drift finding lines from the run log and the run URL, and so the next green
> run comments resolution on that issue — use a SHA-pinned actions/github-script step consistent
> with this repo's pinning policy and the least permissions that work (issues: write on that job
> only); (2) add a trigger so live-drift also runs on push to main when supabase/migrations/** or
> supabase/schema.sql changed; keep schedule + workflow_dispatch; keep concurrency
> cancel-in-progress: false; (3) create docs/audit/live-drift-forensics-2026-08.md with headed
> empty sections for Phases 1–5 evidence; (4) do NOT touch any Supabase code or call any provider.
> Run npm run check:github-actions and npm run verify:pr-local, run npm run format and commit
> locally. Stop before pushing, opening a PR, dispatching a workflow, or updating the live-drift
> tracking item with npm run issues:update; those are provider-backed actions and require explicit
> user confirmation. After confirmation, publish the branch, open the PR (no RAG impact line needed
> — no RAG surface touched), update the tracking item, and do not watch the PR after opening it.

Note for the operator (not the model): adding `SUPABASE_ACCESS_TOKEN` to environment secrets
(`#183`) is dashboard work you do yourself; never paste token values into a chat.

## Phase 1 — Read-only forensics (approved read-only window) · Fable · 1–2 h

Deliverables: migration-history fingerprint list, RPC divergence dossier (10 diffs classified),
index sizing + `EXPLAIN` baselines. Definition of done: all three recorded in the forensics doc;
The live-drift tracking item is updated with the no-statements version list and the evidence-based
conclusion for `#248`; no writes performed.

**Prompt to paste:**

> Read docs/database-remediation-plan.md and docs/database-remediation-playbook.md. I authorize a
> READ-ONLY window against the live Supabase project PsychSift Production
> (sjrfecxgysukkwxsowpy) for Phase 1. Absolutely no INSERT/UPDATE/DELETE/DDL — SELECT and EXPLAIN
> only; stop and report if any step would write. Execute: (1) run the migration-history
> fingerprint query from the plan (statements IS NULL over supabase_migrations.schema_migrations)
> and list every no-statements version with its name. For `#248`, record whether that result
> supports a mark-applied/repair history; otherwise retain the alternative that the indexes were
> created and later dropped. (2) for each of the 10 match_* RPCs named in
> the 2026-08-09 live-drift log, fetch pg_get_functiondef from live and diff against the repo's
> canonical body (search supabase/migrations for the latest create-or-replace of each), then
> classify each as live-ahead, repo-ahead, or normalization noise, quoting the decisive diff hunks
> — this is a protected RAG surface, so classification accuracy matters more than speed, and any
> ambiguous diff is recorded as UNCLASSIFIED with the ambiguity explained, never guessed; (3) for
> the 20 missing and 2 unexpected indexes, record owning-table pg_relation_size and run EXPLAIN
> (ANALYZE, BUFFERS) for the documents title ILIKE query, the document_chunks content search, and
> the rag_retrieval_logs miss scan as before-baselines. Write all evidence with dates and run IDs
> into docs/audit/live-drift-forensics-2026-08.md, update the live-drift tracking item, commit, push, PR (docs-only;
> RAG impact line not required since no RAG code changed — but state in the PR body that RPC diffs
> were read and classified). Do not fix anything in this phase.

## Phase 2 — Staging parity rehearsal (approved staging window) · Opus · 2–4 h

Deliverables: staging at full migration parity; `check:drift` green against staging.
Definition of done: pasted replay output + green drift line in the forensics doc; `#056` updated.

**Prompt to paste:**

> Read docs/database-remediation-plan.md and docs/database-remediation-playbook.md. I authorize
> mutation of the STAGING Supabase tier (PsychSift Staging) only — production
> (sjrfecxgysukkwxsowpy) remains read-only and must not be targeted; verify the target ref before
> every command and abort if it resolves to production. Execute Phase 2: replay the full committed
> migration chain onto staging to parity (staging is idle, so guard migrations like 20260804110240
> may need their indexes built first — build them transactionally or concurrently there, then
> proceed), then run check:drift against staging and get it green. Record the replay tail, any
> migration that misbehaved on clean replay (that is a finding — capture it), and the green drift
> output in docs/audit/live-drift-forensics-2026-08.md. Update ledger #056 and the live-drift tracking item, commit, push,
> PR. If any migration fails on clean replay, stop, record, and report rather than patching live
> objects by hand.

## Phase 3 — RPC reconciliation (approved production window; canary approvals per repo-ahead RPC) · Fable · 2–6 h

Prerequisite: Phase 1 dossier. Deliverables: every mismatched RPC codified or reconciled.
Definition of done: zero function `def_hash` mismatches on the next live-drift run (or reasoned
allowlist entries); eval evidence attached for any behaviour-changing deploy.

**Prompt to paste:**

> Read docs/database-remediation-plan.md, docs/database-remediation-playbook.md, and the Phase 1
> RPC dossier in docs/audit/live-drift-forensics-2026-08.md. Flag now, before editing: this task
> touches protected RAG retrieval RPCs. I authorize Phase 3 against production
> (sjrfecxgysukkwxsowpy) per the dossier's classifications: for normalization-noise entries, fix
> the manifest/normalizer side only and regenerate; for live-ahead entries, author migrations that
> codify the live body verbatim plus the schema.sql mirror and regenerated drift-manifest, PR body
> carrying "RAG impact: no retrieval behaviour change — codifying already-live body" with the diff
> as evidence; for repo-ahead entries, STOP and list them with their behavioural delta — each
> needs my separate explicit approval and a live eval-canary pair (baseline then post, 36/36
> retrieval cases, recall 1.0, zero per-case rr regressions) around its deploy, one revertible
> migration each. Any UNCLASSIFIED entry stays untouched and is escalated to me. Run npm run
> check:migration-role and tests/supabase-schema.test.ts, format, commit, push, PR with the full
> Clinical Governance Preflight. Update the live-drift tracking item with per-RPC outcomes.

## Phase 4 — Index restoration (approved off-peak production window) · Opus · 2–3 h active

Prerequisites: Phases 1–3. Deliverables: the ~20 still-missing indexes restored + validated (the two
trigram indexes were already restored on 2026-08-14), 2 unexpected indexes
dispositioned, guard migrations landed, live-drift green. Definition of done: green live-drift
dispatch output pasted; `search_schema_health()` still `ok: true`.

**Prompt to paste:**

> Read docs/database-remediation-plan.md and docs/database-remediation-playbook.md plus the Phase
> 1 sizing table. I authorize Phase 4 DDL against production (sjrfecxgysukkwxsowpy) in this
> off-peak window. Procedure, exactly: capture/confirm a PITR restore point first; then for Batch
> A (small tables) and Batch B (large tables, one at a time) run CREATE INDEX CONCURRENTLY IF NOT
> EXISTS with the canonical definitions from the repo migrations, after each build verify
> pg_index.indisvalid AND indisready and DROP INDEX CONCURRENTLY + retry any invalid build; hold
> the two #102-adjacent bare-column indexes out entirely — restore only the canonical
> 20260705180000 trigram definitions; disposition the 2 unexpected_live indexes per the plan
> (codify or DROP INDEX CONCURRENTLY if redundant — state which and why). Then author one
> fail-fast guard migration per batch following 20260804110240 exactly (validates, never builds),
> mirror into schema.sql, npm run drift:manifest, extend search_schema_health() required_indexes
> via migration for indexes the runtime should monitor, run check:migration-role and the supabase
> schema tests, format, commit, push, PR ("RAG impact: no retrieval behaviour change — restoring
> already-recorded canonical index definitions; ordering-affecting surfaces untouched"), full
> governance preflight. Finally dispatch the live-drift workflow and paste its green output into
> docs/audit/live-drift-forensics-2026-08.md. Update the live-drift tracking item. If any single build repeatedly fails or
> locks, skip it, record it, continue the batch, and report — never fall back to a transactional
> build on production.

## Phase 5 — Measure and close the loop (read-only + optional eval; ~$1–2 if RPCs changed) · Opus · 1–2 h

Deliverables: after-EXPLAINs, `#231` re-test, readiness check. Definition of done: before/after
table in the forensics doc; `#231` updated with data; `check:production-readiness` output recorded.

**Prompt to paste:**

> Read docs/database-remediation-plan.md, docs/database-remediation-playbook.md, and the Phase 1
> baselines. I authorize a read-only production window plus npm run check:production-readiness
> (and eval:retrieval:quality ONLY if Phase 3 deployed a behaviour-changing RPC — ask me first if
> unsure). Re-run the Phase 1.3 EXPLAIN (ANALYZE, BUFFERS) set and build a before/after table
> showing plan changes and timings; then assess ledger #231: with the trigram indexes present,
> exercise the answer path's retrieval timing and state with evidence whether the 25s fast-route
> budget still binds — update #231 accordingly (close, re-scope, or confirm still open). Record
> everything in docs/audit/live-drift-forensics-2026-08.md, update the live-drift tracking item, commit, push, PR.

## Phase 6 — Future-proofing (repo + one migration deploy) · Fable · 4–6 h

Deliverables: history-integrity probe, guard-migration contract + enforcing test, monitoring
ratchet. Definition of done: `check:drift` reports unguarded `statements IS NULL` versions; repo
test fails on an allowlisted version without a guard file; docs updated; migration deployed.

**Prompt to paste:**

> Read docs/database-remediation-plan.md and docs/database-remediation-playbook.md, then execute
> Phase 6. Design first, then build: (1) a migration extending public.schema_drift_snapshot() to
> also return supabase_migrations.schema_migrations versions whose statements IS NULL, and a
> check-drift change reporting any such version absent from a new reviewed allowlist
> (supabase/drift-allowlist.json style — every entry needs a reason and a pointer to its guard
> migration); think about how this could false-positive (legitimate repairs, squashed baselines)
> and make the allowlist expressive enough to stay honest without being a rubber stamp; (2) a
> documented guard-migration contract in docs/database-drift-detection.md and an AGENTS.md note:
> any mark-applied/history repair MUST ship a fail-fast validation migration per 20260804110240,
> plus a repo test asserting every allowlisted no-statements version has a matching guard
> migration file; (3) a repo test ratcheting index monitoring: every index defined by migrations
> on retrieval-critical tables (documents, document_chunks, document_index_units,
> document_embedding_fields, document_memory_cards, rag_retrieval_logs) is either in
> search_schema_health() required_indexes or in an explicit unmonitored list with reasons. Deploy
> only the snapshot migration to production with my approval when the PR is ready — everything
> else is repo-side. Run check:migration-role, the supabase schema tests, verify:pr-local; format,
> commit, push, PR with governance preflight and "RAG impact: no retrieval behaviour change —
> observability-only snapshot extension". Update the live-drift tracking item and capture any residuals via /issues.

## Phase 7 — Deferred debt (each its own session)

Run each as an independent task when its trigger arrives; none blocks the phases above.

- `#022` BMJ attestation hosted apply — Opus; needs its own approved window + human review step.
- `#025` Railway webhook configuration — operator dashboard + Opus verification session.
- `#036` explicit public-corpus marker migration — Opus, with supabase-schema-guardian review.
- `#191` ACL-migration consolidation — **Fable**, only after Phase 6 is live; prompt should
  require proving RLS/owner-scope equivalence before and after consolidation.
- `#196`–`#200` DR codification + `#057` soak/rollback drill — Opus, following
  docs/operator-backlog.md; verify with names-only output.
- `#098`/`#099` round-trip budget tests — Opus, repo-only.
- `#011` pool allocation + `#200` dashboard settings — operator dashboard work, no model needed.

---

## Cross-session tracking

After every phase: update the live-drift tracking item (`npm run issues:update`), append evidence to
`docs/audit/live-drift-forensics-2026-08.md`, and record the phase's PR in the normal ledger flow.
If a session dies mid-phase, the next session re-reads this playbook, the forensics doc, and
the live-drift tracking item, and resumes from the last recorded evidence — nothing lives only in chat.
