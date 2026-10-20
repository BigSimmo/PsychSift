# Archived work-order — ingestion-concurrency-fix-workorder

Archived 2026-10-20 from `docs/ingestion-concurrency-fix-workorder.md` at `ace8ea995` because it has had no open repository items since 2026-07-17.
This is historical evidence, not current guidance or permission to resume work.
Use the [retirement notice](../ingestion-concurrency-fix-workorder.md), current repository policy and a separately
approved current task. Relative Markdown links below were rewritten for the archive folder.

---

# Ingestion-concurrency phase-3 — fix work-order

**Status refresh 2026-07-17:** the last remaining repository design item below —
deep-memory section ownership / delete-scoping — is now **RESOLVED**, so this document has
**no open repository items**. It shipped as the producer-scoped replacement model: migration
`20260713030000_producer_scoped_deep_memory.sql` adds `producer` + `artifact_generation_id`
columns with **disjoint** unique indexes (`document_sections_legacy_section_index_key` for
`artifact_generation_id is null` vs `document_sections_producer_generation_section_index_key`),
so the enrichment agent and deep-memory can no longer collide on `section_index`; the
service-role commit RPC removes only older artifacts owned by the same producer; and
`src/lib/deep-memory.ts` stages and deletes strictly scoped by `producer = local-deep-memory` +
`artifact_generation_id` (`cleanupStagedArtifacts`), with the commit body reconciled in #569. No
unscoped cross-producer delete remains. The design section at the bottom is retained as provenance.

**Status refresh 2026-07-15:** the July-8 migration batch is applied and verified live. The only
remaining repository design item in this document is deep-memory section ownership/delete scoping
(see the final section); it is intentionally blocked on an explicit ownership model and a
retrieval/eval-gated implementation. Worker redeploy and other live operations are tracked in
[`operator-backlog.md`](../operator-backlog.md). Historical author-time status below is retained as
provenance and must not be read as current live state.

Sequenced, operator-applied plan for the state-machine violations that could
**not** be safely landed from a chat session. Companion to
`docs/ingestion-state-machine.md` (§6 findings, §8 backlog) and
`docs/audit/scale-readiness-review.md`.

Author date: 2026-07-08. All facts below were read from the **live** project
`Clinical KB Database` (`sjrfecxgysukkwxsowpy`) via read-only `execute_sql`;
nothing here was applied to live at author time. **Historical status (2026-07-09):** July 8 migrations were merged to `main` but pending live apply — see [`docs/archive/operator-apply-july8-batch.md`](operator-apply-july8-batch.md). Function bodies are quoted from
`pg_get_functiondef` so migrations are derived from live truth, not `schema.sql`
(which is known-drifted — see R24e and `docs/database-drift-detection.md`).

## Already landed on `main` (do not redo)

- **R11, R15/R16, R22, R24d-gate** — merged (PR #346).
- **R11 janitor-side guard** (`scripts/cleanup-storage.ts` +
  `src/lib/storage-cleanup-safety.ts`) and **R1 lease heartbeat**
  (`shouldPersistJobProgress` in `src/lib/ingestion.ts`, worker refresh of
  `locked_at`) — merged (PR #369).
- **R1/R2/R7/R9/R23 RPC hardening** — migration `20260708130000` merged (PR #380) and applied live.
- **R24e** — phantom `ingestion_job_stages.job_id` FK dropped from `schema.sql` (PR #380 batch); live apply was a no-op as expected.
- **R17** — partial unique index + reindex-route 409 handling merged (PR #405); migration `20260708170000` applied live.
- **R5** — metadata deep-merge RPC + worker merged (PR #408); migration applied live; worker redeploy remains an operator action.

## Still open (not merged or needs design)

- _None._ **deep-memory delete-scoping** landed via the producer-scoped model (migration
  `20260713030000` + commit #569 + `src/lib/deep-memory.ts`) — see the 2026-07-17 status refresh
  at the top. The design section at the bottom of this doc is retained as provenance only.

## Global rules for this release

1. **Never raw-SQL against live.** Every DB change is a committed migration
   (`supabase/migrations/<ts>_*.sql`) + a matching `supabase/schema.sql` edit +
   `npm run drift:manifest` (Docker) in the same PR, per
   `docs/database-drift-detection.md`. Operator applies with `supabase db push`
   after review.
2. **Expand/contract for RPC signature changes.** New params are added with
   defaults so existing callers keep resolving; the fence/behavior only engages
   once the new param is passed. This lets the **DB migration ship first** and
   the worker/edge deploy follow, with no broken window.
3. **Deploy order per item is explicit below.** Items marked
   _coordinated_ must not have their DB half applied without the paired
   app/worker/edge deploy reaching a state where the old callers are still
   safe (guaranteed by rule 2).
4. **Eval gate.** Any item marked _retrieval-affecting_ must show
   `npm run eval:retrieval:quality` unchanged (currently **36/36**,
   content_mrr@10 = 0.924, live 2026-07-08) before defaults change.
5. **Drift-backlog coordination.** Items touching `ingestion_jobs` indexes
   (R17) or the `ingestion_job_stages` FK (R24e) overlap the open reconciliation
   backlog in `docs/database-drift-detection.md` (§ "Reconciliation backlog"
   items #7 and #8). Land them **through that backlog**, not as a competing PR.

---

## R2 — lease fences on complete / fail (root fix, expand/contract)

**Finding (SILENT-CORRUPTION/OPS-CHURN):** no completion/fail write is fenced by
the lease holder, so after any 45-min reclaim (R1 heartbeat now makes this rare
but not impossible) a zombie worker's completion/failure clobbers a
freshly-reclaimed job. Live signatures confirmed to take **no `p_worker_id`**:

```
complete_ingestion_job(p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_stage text)
fail_or_retry_ingestion_job(p_job_id uuid, p_document_id uuid, p_batch_id uuid,
  p_retry boolean, p_document_status text, p_stage text, p_error_message text,
  p_next_run_at timestamptz)
```

**Change (backward-compatible):** add trailing `p_worker_id text default null`
to both. Fence the **job** update with
`and (p_worker_id is null or locked_by = p_worker_id)`, capture the row count,
and when a non-null worker id matched **zero** rows, return
`jsonb_build_object('ok', false, 'reason', 'lease_lost', …)` **without** running
the sibling force-complete / document write / batch refresh. When `p_worker_id`
is null the body is byte-for-byte today's behavior.

`complete_ingestion_job` skeleton (derived from the live body):

```sql
create or replace function public.complete_ingestion_job(
  p_job_id uuid, p_document_id uuid, p_batch_id uuid default null,
  p_stage text default 'indexed', p_worker_id text default null)
returns jsonb language plpgsql set search_path to 'public','extensions','pg_temp' as $$
declare v_rows int;
begin
  update public.ingestion_jobs
     set status='completed', stage=p_stage, progress=100, error_message=null,
         locked_at=null, locked_by=null, completed_at=now()
   where id=p_job_id and document_id=p_document_id
     and (p_worker_id is null or locked_by = p_worker_id);
  get diagnostics v_rows = row_count;
  if p_worker_id is not null and v_rows = 0 then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost',
      'job_id', p_job_id, 'document_id', p_document_id);
  end if;
  -- (unchanged) sibling force-complete, batch refresh, ok:true return
  …
end; $$;
```

`fail_or_retry_ingestion_job`: same fence on the **job** update; when fenced and
0 rows, return `ok:false` and **skip the `documents` update** (do the job update
before the document write on the fenced path so a lost lease can't still demote
the document). Non-null path unchanged.

**Files:** migration + `schema.sql` (both RPCs); `worker/main.ts` to pass the
worker id and abort the job when a call returns `ok:false`.
**Deploy order:** migration first (no-op for the current worker), then worker
deploy. _Coordinated; not retrieval-affecting._
**Verify:** `check:drift` green; a worker smoke run (`worker:once`) completing a
real job returns `ok:true`; a forced stale-id call returns `ok:false`.

---

## R9 — batch-status lost update (self-contained RPC)

**Finding (AVAILABILITY):** two sibling jobs completing in overlapping txns both
compute `refresh_import_batch_status` counts from pre-commit snapshots → the
second write is a lost update → batch stuck `processing` forever. Live body
confirmed: it `select count(*) … from ingestion_jobs where batch_id=…` then
`update import_batches …`, with no lock serializing concurrent refreshes.

**Change:** lock the batch row first so the count+update are serialized:

```sql
-- at the top of refresh_import_batch_status, after the null check:
perform 1 from public.import_batches where id = p_batch_id for update;
-- then the existing count(*) … and update … run under that row lock
```

**Files:** migration + `schema.sql`.
**Deploy order:** DB only; behavior-preserving. _Not coordinated._
**Verify:** `check:drift` green; concurrency test — two `complete_ingestion_job`
calls for the last two jobs of a batch, interleaved, leave the batch terminal.

---

## R7 — attempt_count clamp / stuck pending (self-contained RPC)

**Finding (AVAILABILITY):** a stale-snapshot re-pend can leave a `pending` job
whose `attempt_count = max_attempts`; the claim filter is
`j.attempt_count < j.max_attempts`, so it is permanently unclaimable and pins
its batch. Live claim confirmed: filter `attempt_count < max_attempts`,
increment `attempt_count = attempt_count + 1` at claim.

**Change (pick one, add a targeted test):**
(a) let the claim filter accept a re-pended maxed job exactly once —
`(j.status='pending' and j.attempt_count <= j.max_attempts …)` while keeping
`< ` for the stale-processing arm — so it gets a final claim that then either
succeeds or is failed terminally; **or**
(b) clamp every `attempt_count` write to `least(x, max_attempts)` at the retry
route + recovery script so a maxed job can't be re-pended into limbo.
Prefer (b) if the retry/recovery resets are the real source (they set
`attempt_count = 0`, so the stuck case is narrow) — smaller blast radius.

**Files:** migration + `schema.sql` (option a) or app/script only (option b).
**Deploy order:** DB only (a) / app only (b). _Not coordinated._
**Verify:** unit test on the chosen path; `check:drift` for (a).

---

## R23 — cleanup delete predicates lack the job-existence guard (self-contained RPC)

**Finding (SILENT-CORRUPTION):** in
`cleanup_abandoned_document_index_generations(p_document_id, p_limit, p_dry_run)`
the job-existence guard lives only in the candidate CTE; the 7 per-table counts
and 7 deletes re-check generation only, each on a fresh READ COMMITTED snapshot,
so a reindex claimed after selection has its staged rows deleted table-by-table.

**Change:** repeat the candidate guard inside every delete's `where` — i.e.,
only delete an artifact row whose `document_id` has **no** open
(`pending`/`processing`) `ingestion_jobs` row, in addition to the existing
generation-mismatch predicate. Fetch the exact body first:
`select pg_get_functiondef('public.cleanup_abandoned_document_index_generations(uuid,integer,boolean)'::regprocedure);`
then add `and not exists (select 1 from public.ingestion_jobs j where
j.document_id = <artifact>.document_id and j.status in ('pending','processing'))`
to each delete (and mirror it in the counts for dry-run parity).

**Files:** migration + `schema.sql`.
**Deploy order:** DB only; strictly narrows what cleanup deletes. _Not coordinated._
**Verify:** `check:drift`; dry-run before/after on live shows equal-or-fewer
candidates.

---

## R17 — partial unique index on open jobs (drift-backlog item #7)

**Finding (OPS-CHURN + structural):** no constraint prevents multiple open jobs
per document; the reindex enqueue race (R13) and duplicate reindex POSTs (R17)
rely on advisory guards. A partial unique index makes it structural.

**Change:**

```sql
create unique index concurrently if not exists
  ingestion_jobs_one_open_per_document_uidx
  on public.ingestion_jobs (document_id)
  where status in ('pending','processing');
```

Live state check (2026-07-08): **0 pending/processing jobs**, so creation will
not fail on existing duplicates — but the operator must confirm the queue is
quiet at apply time (`reindex:health` → `jobs_pending/processing = 0`).
`concurrently` cannot run inside a txn-wrapped migration; apply it as its own
statement per the repo's concurrent-index precedent.

**Paired app change (required, same release):** the reindex routes must translate
a `23505` unique violation on job insert into the existing "already queued" 409,
not a 500. Update `src/app/api/documents/[id]/reindex/route.ts` and
`src/app/api/documents/bulk/reindex/route.ts` job-insert error handling
(the competing-job branch already exists — return its 409 on unique violation).

**Files:** migration + `schema.sql` + both reindex routes + a route test.
**Deploy order:** ship the route change first (it must tolerate the violation),
then the index. _Coordinated._ **Coordinate with drift-backlog item #7** which
is already reshaping `ingestion_jobs` indexes.
**Verify:** `check:drift`; route test that a second concurrent reindex POST gets
409, not 500.

---

## R24e — remove the phantom `ingestion_job_stages.job_id` FK from schema.sql (drift-backlog item #8)

**Finding (FRESH-ENV-ONLY):** `schema.sql` declares
`ingestion_job_stages.job_id → ingestion_jobs(id)`, but **live has no such FK**
(confirmed: the only FK is `ingestion_job_stages_document_id_fkey → documents`).
On any `schema.sql`-provisioned env the agent's `stageStart` inserts
`indexing_v3_agent_jobs.id` into `job_id` and dies with FK 23503, burning
attempts to terminal `failed`.

**Decision (evidence-based):** the drift backlog item #8 proposes _adding_ the FK
to live, but a prior live scan found ~253 orphan stage rows and 0 rows whose
`job_id` resolves to an `ingestion_jobs` row — adding + `validate` would fail and
the column is populated with agent-job ids, not ingestion-job ids. **Remove the
FK from `schema.sql`** so fresh/preview envs match live. This supersedes backlog
item #8 — update that doc when landing.

**Files:** `schema.sql` (drop the constraint declaration) + `drift:manifest`
regen + delete/annotate the matching drift-allowlist entry + update
`docs/database-drift-detection.md` item #8.
**Deploy order:** repo-only; **live is untouched** (already correct).
**Verify:** `check:drift` green; manifest freshness test passes.

---

## R5 — worker metadata full-replace clobbers concurrent edits (coordinated)

**Finding (SILENT-CORRUPTION):** the worker's three full-`documents.metadata`
replace sites (commit RPC `p_metadata`, `worker/main.ts` final writes) erase
concurrent bulk-metadata edits, renames, and agent-state patches under any
reclaim.

**Change:** replace the full-object writes with server-side JSONB deep-merge
scoped to worker-owned keys (a `jsonb_set`/`||` merge in the commit RPC and a
merge helper for the worker writes), or fence the writes on `updated_at`.
This needs the commit RPC body (`commit_document_index_generation`, 9 params —
fetch with `pg_get_functiondef`) and worker changes.

**Files:** migration + `schema.sql` (commit RPC) + `worker/main.ts`.
**Deploy order:** _coordinated_ (RPC + worker). **Touches `worker/main.ts`** —
sequence after / rebased on any open worker PR. _Not retrieval-affecting._
**Verify:** concurrency test — a rename during a reclaimed commit survives.

---

## deep-memory delete-scoping (R24c/R24d other half) — NOT a small change; needs design

**Finding:** deep-memory's unscoped deletes of `document_index_units` /
`document_memory_cards` / `document_sections` wipe the enrichment agent's rows
too. #346's route-gate closes the **concurrent** arm; this is the **sequential**
arm (a deep-memory pass after an agent pass).

**Why it is not a quick patch — live-verified 2026-07-08:**

- `document_sections` has `UNIQUE (document_id, section_index)`;
  `document_index_units` / `document_memory_cards` are PK-only.
- `generated_by` tagging is inconsistent: index_units 111,263 NULL / 149
  `local-worker` / 579 `indexing-v3-agent`; sections 28,757 NULL / 6,399 agent
  (no `local-worker` tag at all); cards 29,974 `local-worker` / 16,496 NULL /
  6,571 agent. So "delete only my rows" cannot key on a single deep-memory tag —
  the correct scope is **"everything except `indexing-v3-agent`", NULL-safe**.
- The NULL-safe PostgREST filter is verified working:
  `.or("metadata->>generated_by.is.null,metadata->>generated_by.neq.indexing-v3-agent")`
  selects 111,412 non-agent vs 579 agent index_units.
- **But it is unsafe for `document_sections`:** 0 documents currently hold both
  agent and non-agent sections — deep-memory's unscoped delete is what prevents
  the collision. Preserving agent sections and then re-inserting deep-memory's
  own `section_index` values would hit the unique constraint (23505 crash);
  scoping only units+cards leaves agent memory-cards detached via
  `section_id ON DELETE SET NULL`.

**Required work (design, not patch):** decide the section*index ownership model
between the agent and deep-memory — e.g. give the agent a disjoint index range
or stop it writing `document_sections`, or make deep-memory's section write an
`on conflict (document_id, section_index)` upsert with a defined winner. Then
scope index_units + memory_cards deletes with the NULL-safe filter above.
\_Retrieval-affecting → eval gate. Touches `src/lib/deep-memory.ts` and the edge
agent.*

**Files:** `src/lib/deep-memory.ts`, `supabase/functions/indexing-v3-agent/*`,
possibly a migration.
**Deploy order:** _coordinated_ (worker/route + edge agent). **Do not ship the
naive scope — it can crash live enrichment.**

---

## Suggested landing order

**Superseded for merged items** — use [`docs/archive/operator-apply-july8-batch.md`](operator-apply-july8-batch.md)
for live apply of R24e → RPC hardening → fail-closed → R5 → R17 (`20260708170000`).

Remaining repo work:

1. ~~**deep-memory scoping**~~ — **DONE (2026-07-17)** via the producer-scoped model
   (`20260713030000` + #569 + `src/lib/deep-memory.ts`). The section-ownership question was
   settled by giving each producer a disjoint `(document_id, producer, artifact_generation_id,
section_index)` key. No remaining repo work in this document.

Every DB item ends with `npm run check:drift` green and (for retrieval-affecting
items) `npm run eval:retrieval:quality` unchanged.
