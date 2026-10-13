# Disaster recovery runbook — PsychSift Production

Last rehearsed: 2026-07-07 (schema restore rehearsal against a local Supabase
Postgres container; the live project `sjrfecxgysukkwxsowpy` was read-only
throughout).

## What a recovery is made of

A full recovery of this system has four independent layers. **Only the first
is covered by the repo**; the rest are Supabase-platform or operator state:

| Layer                                                           | Source of truth                                  | RPO                                                                                                                                           | RTO (measured/estimated)                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema (tables, RPCs, indexes, RLS, buckets config)             | `supabase/schema.sql` in git                     | 0 (git)                                                                                                                                       | **~19 s** into a local container (measured, repeatedly); minutes on a hosted project                                                                                                        |
| Data (documents, 69k+ chunks, embeddings, jobs, logs)           | Supabase managed backups                         | Daily backups → up to 24 h; with PITR enabled → ~2 min granularity. **Check the dashboard (Database → Backups) for the actual plan setting.** | Platform restore; not directly measurable without executing one. For the ~8.6 GB database expect tens of minutes to hours. Practice target: restore to a **new** project, never in place.   |
| Storage objects (`clinical-documents`, `clinical-images` files) | Supabase Storage (S3) — separate from DB backups | Platform-managed                                                                                                                              | Bucket **rows** are recreated by schema.sql; the **files** are not in a DB restore. A DB-only restore leaves `documents.storage_path` pointing at objects that must still exist in Storage. |
| Config & secrets                                                | Nowhere in the repo (deliberate)                 | n/a                                                                                                                                           | Manual re-entry, see the checklist below                                                                                                                                                    |

## Schema restore procedure (rehearsed)

Works on any machine with Docker; identical mechanics on a fresh hosted
project via psql. This is exactly what `npm run drift:manifest` automates
(container start → scaffold → replay → snapshot → destroy), so **schema
restorability is re-proven every time the drift manifest is regenerated**.

```sh
# 1. Scratch Supabase Postgres matching live (17.6.1.127)
drift_image='supabase/postgres:17.6.1.127@sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83'
docker image inspect "${drift_image}" >/dev/null  # pull separately only with registry approval
restore_container="kb-restore-$$"
restore_password="$(openssl rand -hex 16)"
POSTGRES_PASSWORD="${restore_password}" docker run -d --pull=never --name "${restore_container}" \
  -e POSTGRES_PASSWORD -p 127.0.0.1:56543:5432 "${drift_image}"
unset restore_password
trap 'docker rm -f "${restore_container}" >/dev/null 2>&1 || true' EXIT
docker exec "${restore_container}" pg_isready -U postgres   # wait until ready

# 2. Storage scaffold (bare image ships an empty storage schema; the hosted
#    platform provisions the real one). Discover the local image owner instead
#    of hard-coding a platform-reserved role; never use this scaffold on hosted.
docker cp scripts/sql/drift-replay-scaffold.sql "${restore_container}":/tmp/scaffold.sql
storage_owner="$(
  docker exec "${restore_container}" psql -U postgres -d postgres -tAc \
    "select pg_catalog.pg_get_userbyid(nspowner) from pg_catalog.pg_namespace where nspname = 'storage'"
)"
test -n "${storage_owner}"
docker exec "${restore_container}" psql -U "${storage_owner}" -d postgres -v ON_ERROR_STOP=1 -f /tmp/scaffold.sql
unset storage_owner

# 3. Replay the canonical schema as postgres (matches how live is administered)
docker cp supabase/schema.sql "${restore_container}":/tmp/schema.sql
docker exec "${restore_container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/schema.sql

# 4. Verify
docker exec "${restore_container}" psql -U postgres -d postgres -tAc "select (public.search_schema_health())->>'ok'"   # must print: true

# 5. Remove the exact rehearsal container when verification is complete
docker rm -f "${restore_container}"
trap - EXIT
```

On a hosted target, prefer the migration chain (`supabase db push` /
`supabase db reset --linked` semantics); measured chain replay: **48 s** into the same container
(measured 2026-07-07 against the migration chain as it stood on that date; the chain has grown
since, so re-measure before relying on this figure). Note the chain has known fidelity gaps
vs schema.sql (buckets, two triggers, a handful of indexes — item 10 in
[database-drift-detection.md](database-drift-detection.md#reconciliation-backlog)).

## Retrieval verification on the restored copy (rehearsed 2026-07-07)

### Site-content releases

Public registry site content is restored as immutable `site_content_releases` and release-scoped records plus append-only P05 receipts. A release activation is permitted only after current `site_release` recovery-readiness evidence and its exact content-addressed activation receipt have been validated. Keep the previous release and its records retained: rollback may switch only to that exact release named by the activation receipt and must persist the exact P05 rollback receipt. It must not reconstruct or re-embed from mutable owner drafts. See [site-content-sync-runbook.md](site-content-sync-runbook.md) for the queue, activation, rollback, and hosted acceptance procedure.

1. `search_schema_health()` → `ok: true, missing: []` on the restored copy.
2. `schema_drift_snapshot()` → full inventory captured; this became
   `supabase/drift-manifest.json`.
3. Seeded a synthetic document + chunk + embedding field + index unit + memory
   card (1536-dim unit vectors) and invoked the full retrieval surface:
   `match_document_chunks_hybrid`, `match_document_embedding_fields_hybrid`,
   `match_document_index_units_hybrid`, `match_document_memory_cards_hybrid`,
   `match_document_chunks_text`, `match_documents_for_query`. All returned the
   seeded rows (similarity 1.000 on the identity vector, hybrid score 0.760) —
   the lexical, vector, and hybrid scoring paths all execute correctly on a
   from-scratch restore.
4. **Golden retrieval eval (`npm run eval:retrieval:quality`) cannot run
   against a schema-only restore** — it needs the real ~2,065-document corpus
   plus `OPENAI_API_KEY` and service-role env. After a _data_ restore, point
   `.env.local` at the restored project (update `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_PROJECT_REF`, keys), run `npm run check:supabase-project`, then
   `npm run eval:retrieval:quality` and require the current golden set to pass
   (**36/36** as of 2026-07; see the PR template and
   `docs/rag-behaviour/safeguards.md`) before serving traffic. This is the
   acceptance test for a real recovery.

## What did NOT survive the schema restore (verified)

Everything below must come from a data restore or manual re-entry — plan for
it before you need it:

- **All data** — documents, chunks, embeddings (re-embedding the corpus from
  scratch costs real OpenAI spend and hours of worker time; the backup is the
  only cheap path), jobs, caches, logs, registry records.
- **Storage object files** — schema.sql recreates the two private bucket rows
  (`clinical-documents`, `clinical-images`) but no files.
- **Auth users** — `auth.users` is platform state; owner-scoped rows restored
  from backup reference user ids that must exist again (same project restore
  preserves them; a new project does not).
- **Platform-provisioned extensions** (pg_net, pgsodium, pgmq, pg_graphql,
  vault, …) — present on hosted projects, often absent or differently provisioned
  in the bare image. schema.sql declares vector/pg_trgm/uuid-ossp plus pg_cron
  (matching migration 20260901033250); drift-manifest replay must succeed on the
  pinned bare image when that declaration is present.
- **pg_cron schedules** — the invoked function (`invoke_indexing_v3_agent`) is
  codified, but the `cron.schedule(...)` rows themselves are live-only. After
  restore, re-create its cron job. `invoke_ingestion_worker` was retired by
  `20260926041000`; do not re-create it or schedule it.
- **Vault secrets** — `cron_ingestion_jwt` (and any siblings) must be re-added
  before the cron→edge-function chain works (`invoke_indexing_v3_agent` sends it
  as its login token).
- **Custom GUCs** — `20260702160000` reads the agent URL from a database GUC;
  re-set it (`alter database ... set ...`) on the restored project.
- **Edge functions** — deploy `indexing-v3-agent` and `site-content-sync`
  separately via the CLI.
- **Dashboard config** — auth providers (magic link, Apple/Google/Microsoft SSO
  redirect URLs and the rotating Apple web OAuth secret), connection-pool caps (the documented 10-connection auth cap
  is dashboard-only), API keys (publishable + service role are per-project;
  every consumer needs the new values), `E2E_USER_*` test accounts.
- **Role settings** — e.g. `alter role authenticator set
idle_in_transaction_session_timeout` (in the migration chain, so a chain
  replay restores it; a schema.sql-only replay does not).

## Post-restore environment recovery controls & sanity checks

### Site-content release transition recovery

The site-content singleton is not recoverable from `active_release_id` alone. `active_transition_receipt_id` must resolve to the exact activation receipt for the active release or to the exact rollback receipt targeting it and linked to the rolled-back source activation. Treat a missing, ambiguous, cross-release, or malformed pointer as unavailable; never synthesize a receipt or choose one by timestamp.

Rollback is a no-update operation: before it starts there must be no candidate release, live event, pending head pointer, or head beyond the served watermark. It is non-cascading and requires the current pointer to be an activation. A successful rollback preserves monotonic `change_epoch`, moves `served_change_epoch` to that current epoch, leaves completed events and canonical heads unchanged, and records the rollback pointer atomically. Rolling back to the retained bootstrap still leaves the control plane initialized; frozen database bytes may be read, but seed fallback and RAG/cache eligibility remain disabled. The next publication advances the canonical epoch and creates normal pending work; a subsequent activation is permitted only after validating the rollback predecessor chain.

A schema restore is not operationally complete until all five environment-owned controls have been re-created and verified (`#326`, `docs/operator-backlog.md`). Follow this operational checklist after any schema restore or disaster recovery drill:

1. **`pg_cron` schedules & retention jobs:**
   - Re-create the `invoke_indexing_v3_agent` schedule (create it inactive on a non-production target and activate it only after step 3 confirms its endpoint GUC) and the telemetry retention jobs (`purge-expired-rag-queries`, `purge-rag-retrieval-logs`, `purge-rag-query-misses`, `purge-rag-response-cache`). Do **not** re-create `invoke_ingestion_worker`: it was retired by `20260926041000` and the container worker owns ingestion.
   - Sanity check: Run `SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;` and confirm all 4 retention jobs are active (`active = true`), that `invoke_indexing_v3_agent` exists (active on production; still inactive on a non-production target until step 3 passes, then activate it and re-run this query), and that no `invoke_ingestion_worker` job exists.
2. **Supabase Vault secrets:**
   - Re-add required secrets (`cron_ingestion_jwt`, `indexing_v3_agent_secret`) via Supabase Vault.
   - Sanity check: Run `SELECT name, description, created_at FROM vault.decrypted_secrets ORDER BY name;` (names only; never log decrypted secret values).
3. **Custom database GUCs:**
   - Re-set custom parameters (e.g. `app.indexing_v3_agent_base_url`) by running `ALTER DATABASE postgres SET ...` as the project owner (`postgres`) in an operator session; the `schema.sql` statement skips with a notice when its role lacks the privilege, so do not rely on it. If the value is left unset, `invoke_indexing_v3_agent` falls back to the hardcoded production host (`supabase/schema.sql`, `invoke_indexing_v3_agent`) and would send the Vault secret there, so confirm the value with the check below before activating that job (step 1).
   - Sanity check: Confirm the stored database-level value with `SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = 'postgres') AND setrole = 0;` (or `pg_settings` from a new connection): `ALTER DATABASE ... SET` does not change the current session, so `pg_settings` in the same session can show a stale value.
4. **Supabase Edge Functions:**
   - Redeploy required functions (`indexing-v3-agent`, `site-content-sync`) with the Deno v2.x toolchain in an approved change window:
     ```bash
     supabase functions deploy indexing-v3-agent --project-ref <PROJECT_REF>
     ```
   - Sanity check: Verify function list via `supabase functions list` and run non-mutating health probes.
5. **Dashboard-owned configuration:**
   - Re-enter auth provider configuration (magic link, Google/Apple/Microsoft SSO redirect URLs, rotating secrets), connection-pool caps (auth pool pinned at 10 connections), per-project API keys (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), and `E2E_USER_*` test credentials.
   - Sanity check: Run `npm run check:env-parity` and names-only checks to verify all consuming environments have valid references without logging secrets.
6. **System health verification:**
   - Run `SELECT (public.search_schema_health())->>'ok';` (must return `true` with `missing: []`).
   - Run `npm run check:indexing` to confirm required retrieval and operational indexes are valid.
   - Run `npm run check:drift` to confirm schema parity with the canonical drift manifest.
   - For a full data restore: run `npm run eval:retrieval:quality` (must pass 36/36) before pointing traffic.

## Rehearsal findings that changed the repo

- `supabase/schema.sql` did **not** replay from scratch before 2026-07-07
  (`document_index_units` was created ~900 lines after its first validating
  reference — the strict-gate view). Fixed by reordering; now continuously
  re-proven by `npm run drift:manifest` + the manifest freshness test.
- The bare `supabase/postgres` image lacks the storage schema objects; the
  committed scaffold `scripts/sql/drift-replay-scaffold.sql` fills the gap.
- The first migration (`20260527000000`) dies at its storage-policy section
  without that scaffold — the chain is **not** self-sufficient on a bare
  Postgres either.
- Worker-written columns existed only on live (see
  `20260707000000_codify_live_observed_drift.sql`): a branch/preview database
  restored from the repo would have broken ingestion writes. Codified.

## Standing cadence

- Every `drift:manifest` regeneration = a schema-restore rehearsal (free).
- Run `npm run check:drift` after any live apply and on the operational
  cadence alongside `check:indexing`.
- Re-rehearse the **data** layer (platform restore to a scratch project +
  golden eval) before any risky bulk operation (re-index, mass migration), and
  record the measured restore time here.
