# Supabase Migration Reconciliation

_Updated 2026-10-08 — repair safeguards and explicit historical evidence boundary._

Target project: PsychSift Production (`sjrfecxgysukkwxsowpy`)

## Policy

- **Merging migrations to main applies them to production automatically.** Merge
  approval is production-deploy approval: merge only inside the approved window,
  never arm auto-merge for migration PRs, and do not promise a deferred deploy.
- **Never edit a migration already on main.** Correct it with a new migration
  carrying the newest timestamp, including duplicate stems or absent effects.
  Do not convert an applied migration into a no-op.
- Do not use `supabase db push` while local and remote history diverge. Diagnose
  both history and actual schema against the explicitly approved project first.
  Provider-backed diagnostics, SQL, history repair and migration application
  require explicit applicable approval; this runbook grants none.
- **History presence is not effect presence.** A migration list is supplementary
  evidence, not schema proof. After merge, the `live-drift` workflow must pass
  both `npm run check:drift` and `npm run check:migration-history`.
- **Every history repair needs a fail-fast validation guard in the same change.**
  This includes mark-applied versions, `supabase migration repair --status applied`,
  and hand-applied SQL subsequently recorded as a migration. Follow
  `supabase/migrations/20260804110240_restore_rag_search_health_indexes.sql`:
  validate presence, index validity/readiness and normalized definitions; use
  local timeouts and one exception; never build objects in the validation guard.
  Include the reviewed migration-history allowlist entry pointing to that guard
  under the [drift contract](database-drift-detection.md), with `guard.class`
  `validation` for repairs from 2026-08-18 onward; legacy `superseded`/`no_ddl`
  classes must not be used to bypass that requirement. Do not bare-allowlist a
  history row or relax its class to pass. A recorded version alone is insufficient.
- Orphan versions and reverted-history repairs need reviewed evidence, explicit
  approval and the same applicable guard contract. Preserve committed/applied
  migration bytes. Historical placeholders are not a licence to rename or
  renumber migrations on main; `tests/migration-history-placeholders.test.ts`
  checks the established placeholder contract.
- Never change retrieval RPCs, indexes or functions with ad hoc dashboard SQL.
  Use reviewed forward migrations and reconcile `supabase/schema.sql` in the
  same change. The approved concurrent-index prebuild pattern below is an
  explicit exception, paired with a validate-only guard.
- The integration applies each migration in one transaction. A bare
  `CREATE INDEX CONCURRENTLY` migration cannot ship through it. Use an explicitly
  approved operator prebuild outside a transaction, followed by the validate-only
  guard pattern; neither step bypasses retrieval or merge approval.
- A PR changing `supabase/schema.sql` also regenerates
  `supabase/drift-manifest.json` with `npm run drift:manifest` (Docker required).
  `tests/drift-detection.test.ts` checks this reference replay contract.

## Expand/contract policy for retrieval tables

Applies to anything touching `documents`, `document_chunks`,
`document_embedding_fields`, `document_index_units`, `document_memory_cards`,
`document_table_facts`, embedding columns, or the RPCs that read them. Written
after the 2026-07-07 DR rehearsal
([disaster-recovery-runbook.md](disaster-recovery-runbook.md)), which showed
(a) live carried worker-written columns that existed in no repo lineage, so a
restored/branch database silently broke ingestion, and (b) a "recorded as
applied" migration whose effects never landed.

**Expand phase (additive, ships first):**

- New columns are `add column if not exists`, nullable or defaulted — the RAG
  tables have 69k–215k rows; a table rewrite (non-constant default, type
  change) needs an explicit lock/duration plan in the migration header.
- New/changed RPC behaviour ships as a side-by-side version
  (`match_document_memory_cards_hybrid_v2` precedent) with the old RPC left
  callable until the app is fully cut over; grants replicated explicitly
  (`revoke ... from public, anon, authenticated; grant ... to service_role`).
- New constraints on populated tables use `NOT VALID` now + `VALIDATE
CONSTRAINT` in a later migration (the live `*_content_not_blank` checks are
  the precedent).
- Index replacements create the new index first (on live, prefer
  `CONCURRENTLY` run manually outside the transaction — CLI migrations are
  transactional), only with explicit target/operation approval and a paired
  validate-only guard; the old index is NOT dropped in the same migration.
- Embedding columns: `vector(N)` is coupled to `EMBEDDING_DIMENSIONS` and the
  worker's startup check — a dimension change is a re-index project with the
  reindex-eval gate, never a plain migration.
- The same PR updates `supabase/schema.sql`, regenerates the drift manifest,
  and (for anything behaviour-adjacent) passes `npm run
eval:retrieval:quality` per the standing merge gate.

**Verify phase (between expand and contract):**

- Merge only inside the explicitly approved production window. The integration
  applies migrations automatically; require the post-merge `live-drift` workflow
  to pass both `npm run check:drift` and `npm run check:migration-history`.
- Run `search_schema_health()` / `npm run check:indexing` and the golden
  retrieval eval against live before relying on the new path.
- Dual-read/dual-write windows (old + new column/RPC) stay until the eval and
  telemetry confirm the new path.

**Contract phase (destructive, ships last and separately):**

- Drops (columns, old RPC versions, superseded indexes) go in their own
  migration, at least one release after expand, never bundled with it.
- Before contracting: a fresh backup/PITR point exists, `pg_stat_user_indexes`
  scan evidence for index drops (the `20260702014803` discipline), and
  check:drift green so the pre-contract state is fully accounted for.
- Rollback plan is written in the migration header (what to recreate, from
  where) — after contract, rollback means restore-from-backup for data-bearing
  drops, so say so explicitly.

## Historical evidence — June and July 2026

The following inventory and operator follow-ups are dated evidence retained from
the July reconciliation. They are not current live-state assertions or commands
to execute today. Obtain fresh approved history and schema proof before acting;
the policy above and current `AGENTS.md` supersede their old apply guidance.

### Verified applied at the June 2026 checkpoint

These previously local-only versions were verified in the live project history before the July 2026 reconciliation wave:

- `20260625033425` - `document_strict_gate_status` exists, `repair_strict_enrichment_gate_batch(integer)` exists, service role can read/execute, and anon cannot read/execute.
- `20260625033944` - `complete_strict_enrichment_job(uuid, uuid, text, text, text)` exists, service role can execute, and anon cannot execute.
- `20260626000000` - duplicate index `ingestion_job_stages_doc_idx` is absent and canonical index `ingestion_job_stages_document_started_idx` exists.
- `20260626020000` - retrieval RPC performance migration is present in remote history.
- `20260626030000` - document organisation profile label constraint migration is present in remote history.
- `20260627000000` - deliberately applied as a no-op deferral for retrieval HNSW `ef_search`; hosted migrations cannot set this function GUC for this project, and the live vector RPC bodies already use session-local `set_config('hnsw.ef_search', '100', true)` where relevant.
- `20260628000000` - atomic document index generation commit RPC and committed-generation retrieval filters are present and verified in live.
- `20260628135727` - explicit `invoke_indexing_v3_agent(integer)` execute grant hardening is present and verified in live.

### Recorded status at the July 2026 checkpoint

Migration `20260705230000_reconcile_live_database_drift.sql` codifies live-only drift discovered 2026-07-05:

- `indexing_v3_agent_jobs` table and claim/update RPCs (recorded as applied in history but absent on live at inspection time)
- `match_document_embedding_fields_text` RPC with service-role-only execute grants (was present on live with anon/auth execute)
- `rag_visual_eval_cases` / `rag_visual_eval_runs` tables with service-role-only RLS (were present on live without RLS)

`supabase/schema.sql` has been reconciled to match. Apply the migration through the normal linked workflow when ready; do not use raw dashboard SQL for retrieval RPCs.

The repo also includes additional July 2026 migrations beyond the June checkpoint above, including:

- Retrieval RPC codification and hybrid execution smoke (`20260701140631`, related July 1 fixes)
- Legacy vector index drops and `search_schema_health()` reconciliation (`20260702014803`, `20260702021604`)
- Clinical registry tables (`20260703020000`)
- Storage cleanup index reconciliation prep (`20260703030000`, prepared but apply only with explicit approval)
- Indexing v3 agent job table and related hardening (`20260702190000` and neighbors)

Live-only drift, duplicate migration-version churn, and outstanding follow-up debts are tracked in the **Retrieval RPC drift & indexing hygiene** section of [`docs/process-hardening.md`](process-hardening.md). Treat that section as the operational supplement to this reconciliation doc.

**2026-07-07 full-inventory audit:** the standing drift check
([database-drift-detection.md](database-drift-detection.md)) measured live
against both repo lineages. Pending on live as of the audit: `20260705210000`
(owner-sentinel — 8 function bodies), `20260706010000` (M13 guard),
`20260706130000`, plus the new `20260706200000` (drift snapshot RPC) and
`20260707000000` (codification wave, no-op on live). `20260703030000` is
recorded in live history but its effects are absent — repair by re-applying
its statements under a new version, with approval. The complete reconciliation
backlog (index estate, grant posture, remaining live-only functions) lives in
the drift doc.

Before applying pending migrations to live:

1. Run `npx supabase migration list --linked` and confirm local vs remote alignment.
2. Run `npm run supabase:recovery-status` and confirm Supabase is healthy.
3. Apply only through the normal migration workflow; update `supabase/schema.sql` when the migration changes canonical schema shape.

## Supabase Preview / fresh replay rules

These current rules complement the policy above; they do not authorise provider access.

GitHub Supabase Preview replays the full migration chain on branch databases. Keep these invariants so preview stays green:

- When a set-returning function gains or loses an OUT column, `drop function ...` before `create or replace` (PostgreSQL SQLSTATE `42P13` otherwise).
- Do not assume `pg_cron` exists on preview branches; guard `cron.schedule` / `cron.job` access with `to_regnamespace('cron') is not null` inside a `DO` block (SQLSTATE `42P01` otherwise).
- Duplicate stems already on main remain immutable. Correct them with a new
  reviewed forward migration; never neutralize applied files as no-ops.

Regression tests for these guards live in `tests/supabase-schema.test.ts` under "Supabase Preview replay guards".

## Historical verification examples

These provider-backed July diagnostics require approval and current CLI validation
before use. The current schema-application gate is the post-merge `live-drift`
workflow with both drift and migration-history checks, not these examples.

```powershell
npx supabase migration list --linked
npx supabase db advisors --linked
npx supabase db query --linked "select to_regclass('public.document_strict_gate_status') as gate_view, to_regprocedure('public.repair_strict_enrichment_gate_batch(integer)') as repair_rpc, to_regprocedure('public.complete_strict_enrichment_job(uuid, uuid, text, text, text)') as complete_rpc, to_regclass('public.ingestion_job_stages_doc_idx') as duplicate_index, to_regclass('public.ingestion_job_stages_document_started_idx') as canonical_stage_index;"
npx supabase db query --linked "select to_regprocedure('public.commit_document_index_generation(uuid, uuid, text, integer, integer, integer, jsonb, jsonb, jsonb)') as commit_generation_rpc, has_function_privilege('anon', 'public.invoke_indexing_v3_agent(integer)', 'execute') as anon_can_invoke_indexing_v3_agent, has_function_privilege('service_role', 'public.invoke_indexing_v3_agent(integer)', 'execute') as service_role_can_invoke_indexing_v3_agent;"
npm run check:indexing
```

## Historical operator follow-ups

Manual key rotation and live migration apply decisions are recorded in
[`docs/archive/operator-decisions-2026-07-04.md`](archive/operator-decisions-2026-07-04.md)
and [`docs/archive/operator-decisions-2026-07-06.md`](archive/operator-decisions-2026-07-06.md).
The **July 8 ingestion & tenancy batch** (merged to `main`, pending live apply as of
2026-07-09) is in [`docs/archive/operator-apply-july8-batch.md`](archive/operator-apply-july8-batch.md).
Do not execute live applies from CI or agent automation without explicit operator approval.
