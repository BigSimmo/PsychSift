# Database maintenance notes (Supabase `PsychSift Production`)

Live project `sjrfecxgysukkwxsowpy`. This file records advisor snapshots and the standing
disposition for each finding class, so routine advisor output does not get re-triaged from
scratch (or "fixed" against design intent). All live mutations remain confirmation-required
(`AGENTS.md` — API and provider confirmation boundary).

## Advisor snapshot — 2026-07-20 (read-only, user-authorized)

### Security: 1 INFO — repository remediation prepared 2026-07-22

- The snapshot reported `rls_enabled_no_policy` on `public.document_title_words`. The table was
  already fail-closed for browser roles: RLS was enabled, `public`, `anon`, and `authenticated`
  had all table privileges revoked, and only `service_role` had direct DML grants.
- `20260722110000_explicit_document_title_words_backend_policy.sql` records that design as an
  explicit `service_role`-only `FOR ALL` policy. It grants no browser role access and leaves the
  public-title synchronization trigger and service-role-only query corrector unchanged. This
  should clear the no-policy advisor finding after an explicitly approved live migration apply.
- The live project has not been inspected or changed as part of this repository remediation.
  Continue to report the finding as live until the migration is applied and the advisor is rerun
  with approval.

Everything else clean: no RLS-disabled tables, no exposed SECURITY DEFINER functions (the
`check:function-grants` guard enforces this offline on every PR), no auth misconfigurations
beyond the note below.

### Performance: ~33 INFO "unused index" + 1 Auth note — TRIAGE LIST, not a delete list

`unused_index` findings need interpretation before any action, and several are protected:

| Class                                                | Examples                                                                                                                                                                         | Disposition                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Retrieval-surface indexes**                        | `document_chunks_content_trgm_idx`, `documents_title_trgm_idx`, `document_labels_label_trgm_idx`, `document_summaries_summary_trgm_idx`, `document_index_units_heading_path_idx` | **RAG-protected — do not drop without the full protocol** (`docs/rag-behaviour/safeguards.md`). "Unused" can mean the planner satisfies fast-path queries another way today; dropping changes the retrieval search space and needs a canary pair. |
| **Owner-scoped indexes on the single-tenant corpus** | `*_owner_id_idx`, `*_owner_*_idx` on registry/audit/eval/summary tables                                                                                                          | Live corpus is all-public (`owner_id` NULL), so owner-scoped paths never execute — but the multi-tenant design intends them. Keep unless multi-tenancy is formally abandoned.                                                                     |
| **Operational/rare-path indexes**                    | rate-limit buckets, cleanup jobs, ingestion stages, `rag_query_misses_aliases_idx`, feedback/approval tables                                                                     | Genuinely droppable candidates, but the benefit is negligible at this corpus size (write amplification on low-write tables). Revisit only if write latency or storage becomes a measured problem.                                                 |

Standing rule: unused-index removal is a considered maintenance task with its own migration +
replay + (for retrieval tables) canary pair — never a bulk advisor-driven sweep.

- `auth_db_connections_absolute`: Auth server pinned at 10 connections instead of a
  percentage strategy. Only matters when resizing the instance; auth load here is tiny
  (magic-link/OAuth only). Revisit at the next instance-size change (dashboard config —
  confirmation-required).

## Telemetry retention — RESOLVED: already active in pg_cron (verified live 2026-07-20)

An earlier revision of this section called retention "manual and unbounded" after finding
`npm run purge:query-logs` scheduled nowhere. That premise was wrong: retention runs INSIDE
the database via pg_cron, not in CI. Read-only `cron.job` verification (2026-07-20) matches
`docs/privacy-impact-assessment.md` §6 exactly:

| jobid | Job                         | Schedule (UTC) | Window / mechanism                                 |
| ----- | --------------------------- | -------------- | -------------------------------------------------- |
| 11    | `purge-expired-rag-queries` | daily 03:30    | `purge_expired_rag_queries(30)` — 30 days          |
| 12    | `purge-rag-retrieval-logs`  | daily 03:00    | raw delete where `created_at` older than 90 days   |
| 13    | `purge-rag-query-misses`    | daily 03:45    | `purge_expired_rag_query_misses(90)` — 90 days     |
| 16    | `purge-rag-response-cache`  | hourly at :15  | `purge_expired_rag_response_cache(1000)` (bounded) |

All four are active; the obsolete unbounded cache job remains absent; `audit_logs` retention
is indefinite BY DESIGN (compliance note in migration `20260702120000` — do not add a purge
without compliance review). **No GitHub-side retention workflow is needed, and none was
added**: a second scheduled deleter would duplicate pg_cron and invite window drift — the
once-proposed weekly 90-day sweep of `rag_queries` could never delete anything the 30-day
job had not already removed. Retention windows are PIA-governed privacy decisions; change
them via migration + PIA update, never ad hoc.

`npm run purge:query-logs` is the MANUAL owner-scoped deletion tool (privacy requests,
targeted eval-owner cleanup; requires `--owner-email`, supports `--dry-run`, default 90
days). It is deliberately unscheduled — it is not the retention mechanism, and its absence
from cron is not a gap.

## Post-restore environment recovery controls & sanity checks

A schema restore is not operationally complete until all five environment-owned controls have been re-created and verified (`#326`, `docs/disaster-recovery-runbook.md`). Follow these operational runbook steps and sanity checks after any schema restore or disaster recovery drill:

### 1. `pg_cron` schedules & retention jobs

- **Procedure:** Re-create scheduled jobs for ingestion workers and telemetry retention (`purge-expired-rag-queries`, `purge-rag-retrieval-logs`, `purge-rag-query-misses`, `purge-rag-response-cache`).
- **Sanity check:** Verify with a read-only query:
  ```sql
  SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;
  ```
  Confirm all four retention jobs and any active ingestion cron rows report `active = true`.

### 2. Supabase Vault secrets

- **Procedure:** Re-add required secrets (`cron_ingestion_jwt`, `indexing_v3_agent_secret`) via the Supabase Vault.
- **Sanity check:** Verify names and timestamps only with a read-only query (NEVER print or log secret values):
  ```sql
  SELECT name, description, created_at FROM vault.decrypted_secrets ORDER BY name;
  ```
  Confirm expected secret names are present and non-null.

### 3. Custom database GUCs

- **Procedure:** Re-set required custom parameters (e.g. `app.indexing_v3_agent_base_url`) by running `ALTER DATABASE postgres SET ...` as the project owner (`postgres`) in an operator session. The migration/`schema.sql` statement skips with a notice when its role lacks the privilege, so it cannot be relied on. If the value is unset, `invoke_indexing_v3_agent` falls back to the hardcoded production host; on a non-production restore, keep the `invoke_indexing_v3_agent` cron job inactive until the sanity check below shows the right value.
- **Sanity check:** Verify the stored database-level value with a read-only query (`ALTER DATABASE ... SET` does not change the current session, so `pg_settings` in the same session can be stale; use this or a new connection):
  ```sql
  SELECT unnest(setconfig) FROM pg_db_role_setting
  WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = 'postgres') AND setrole = 0;
  ```
  Confirm configured values match the target environment.

### 4. Supabase Edge Functions

- **Procedure:** Redeploy required edge functions (`indexing-v3-agent`, ingestion worker) with the Deno v2.x toolchain in an explicitly approved change window:
  ```bash
  supabase functions deploy indexing-v3-agent --project-ref <PROJECT_REF>
  ```
- **Sanity check:** Verify function presence and status via `supabase functions list` and run health probes without mutating data.

### 5. Dashboard-owned configuration

- **Procedure:** Re-enter auth provider configuration (magic link, Google/Apple/Microsoft SSO redirect URLs, rotating keys), connection pool limits (e.g. auth pool pinned at 10 connections), per-project API keys (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), and `E2E_USER_*` test credentials.
- **Sanity check:** Run `npm run check:env-parity` and names-only checks to verify all consuming environments have valid, non-empty references without logging secret material.

### 6. Post-restore system health verification

- **RPC health check:** Run `SELECT (public.search_schema_health())->>'ok';` (must return `true` with `missing: []`).
- **Index verification:** Run `npm run check:indexing` to confirm required retrieval and operational indexes are valid.
- **Drift verification:** Run `npm run check:drift` to confirm schema parity with the canonical drift manifest.
- **Golden retrieval eval:** For a data restore, run `npm run eval:retrieval:quality` (must pass 36/36) before pointing production traffic.

## Cross-references

- Weekly eval canary + liveness probe: `docs/observability-slos.md` §3 (the `static-pr` job
  warns when the last completed canary is > 8 days old — added when #923 moved the canary
  from daily to weekly cadence, where a dropped Sunday fire would otherwise go unnoticed for
  a week; a suspected 2026-07-20 drop turned out to be a mis-read — the Sunday 2026-07-19
  slot fired and succeeded, and Monday 2026-07-20 has no slot under the weekly cron).
- RAG-protected surfaces and change protocol: `docs/rag-behaviour/safeguards.md`.
- Hybrid RPC health: `search_schema_health()` execution smoke + `npm run check:indexing`.
- Disaster recovery runbook & post-restore procedures: `docs/disaster-recovery-runbook.md`.
