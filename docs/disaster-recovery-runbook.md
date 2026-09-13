# Disaster recovery runbook — Clinical KB Database

Last rehearsed: 2026-07-07 (schema restore rehearsal against a local Supabase
Postgres container; the live project `sjrfecxgysukkwxsowpy` was read-only
throughout).

## What a recovery is made of

Generation lifecycle recovery is governed separately from platform restore. Use the canonical [governed reindex lifecycle and crash windows](reindex-runbook.md#governed-generation-lifecycle) for audit, local plan, authorized staging, exact evaluation, authorized promotion, observation, receipt-bound rollback and delayed manifest cleanup.

An immutable promotion receipt, retained baseline and policy-bound deadline support exact document-generation rollback; a worker-image rollback does not restore a document pointer. Receipt-bound rollback may remain available after the promotion's recovery-evidence freshness expires, but it still requires its own current authorization. Promotion cannot first-publish a document, and U10's authoritative technical gate currently refuses activation.

Database PITR and Storage restore are separate evidence streams. A database restore can recover generation pointers and receipts without recovering object bytes; a Storage restore can recover bytes without proving current row ownership or serving state. U05 cleanup therefore retains `privateObjectReferenceInventory` with `physicalDeletionAuthorized: false` and deletes exact SQL rows only. U13 owns the separate disposal proof, which must revalidate current rights and live, shared and newly introduced references at deletion time. Cleanup interruption replays only the same immutable manifest and never authorizes a broader sweep.

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
`supabase db reset --linked` semantics); measured chain replay: **48 s** for
102 migrations into the same container. Note the chain has known fidelity gaps
vs schema.sql (buckets, two triggers, a handful of indexes — item 10 in
[database-drift-detection.md](database-drift-detection.md#reconciliation-backlog)).

## Retrieval verification on the restored copy (rehearsed 2026-07-07)

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
- **12 platform-provisioned extensions** (pg_net, pgsodium, pgmq, pg_cron,
  pg_graphql, vault, …) — present on hosted projects, absent in the bare
  image; schema.sql only declares vector/pg_trgm/uuid-ossp.
- **pg_cron schedules** — the invoked functions (`invoke_ingestion_worker`,
  `invoke_indexing_v3_agent`) are codified, but the `cron.schedule(...)` rows
  themselves are live-only. After restore, re-create the cron jobs.
- **Vault secrets** — `cron_ingestion_jwt` (and any siblings) must be re-added
  before the cron→edge-function chain works.
- **Custom GUCs** — `20260702160000` reads the agent URL from a database GUC;
  re-set it (`alter database ... set ...`) on the restored project.
- **Edge functions** — deploy `indexing-v3-agent` (and the ingestion worker
  function) separately via the CLI.
- **Dashboard config** — auth providers (magic link, Apple/Google/Microsoft SSO
  redirect URLs and the rotating Apple web OAuth secret), connection-pool caps (the documented 10-connection auth cap
  is dashboard-only), API keys (publishable + service role are per-project;
  every consumer needs the new values), `E2E_USER_*` test accounts.
- **Role settings** — e.g. `alter role authenticator set
idle_in_transaction_session_timeout` (in the migration chain, so a chain
  replay restores it; a schema.sql-only replay does not).

## Post-restore environment recovery controls & sanity checks

A schema restore is not operationally complete until all five environment-owned controls have been re-created and verified (`#326`, `docs/operator-backlog.md`). Follow this operational checklist after any schema restore or disaster recovery drill:

1. **`pg_cron` schedules & retention jobs:**
   - Re-create scheduled jobs for ingestion workers and telemetry retention (`purge-expired-rag-queries`, `purge-rag-retrieval-logs`, `purge-rag-query-misses`, `purge-rag-response-cache`).
   - Sanity check: Run `SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;` and confirm all 4 retention jobs + ingestion jobs are active (`active = true`).
2. **Supabase Vault secrets:**
   - Re-add required secrets (`cron_ingestion_jwt`, `indexing_v3_agent_secret`) via Supabase Vault.
   - Sanity check: Run `SELECT name, description, created_at FROM vault.decrypted_secrets ORDER BY name;` (names only; never log decrypted secret values).
3. **Custom database GUCs:**
   - Re-set custom parameters (e.g. `app.indexing_agent_url`) via `ALTER DATABASE postgres SET ...`.
   - Sanity check: Run `SELECT name, setting, source FROM pg_settings WHERE name LIKE 'app.%';`.
4. **Supabase Edge Functions:**
   - Redeploy required functions (`indexing-v3-agent`, ingestion worker) with the Deno v2.x toolchain in an approved change window:
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
