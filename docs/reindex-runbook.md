# Adaptive RAG reindex runbook

Use this sequence when applying RAG indexing changes to the live `PsychSift Production` Supabase project.

> **Current status: the library re-index is stopped by owner decision** (see
> [the decision](decisions/2026-10-17-library-reindex-stopped.md)). Do not start a re-index from this runbook.
>
> **Every command below that touches the live database, the worker or OpenAI needs the owner's explicit yes first.**
> `npm run reindex` (with or without `--yes`), `recover:ingestion -- --apply`, `worker:once`,
> `supabase:recovery-status` and `reindex:health` reach the live project; the worker also spends on OpenAI
> embeddings and captions. Before any billable run, follow "Spending approval for each billable run" in
> [`AGENTS.md`](../AGENTS.md) and [`docs/agents/shared-context-and-memory.md`](agents/shared-context-and-memory.md):
> a named purpose, a total estimate and a hard cap, approved before the run.

## Consolidated pipeline command

The quickest way to run a full reindex cycle is the consolidated pipeline command:

```sh
npm run reindex
```

This single command encapsulates the full safe sequence below: it confirms the target project, checks Supabase health, snapshots reindex health, applies ingestion queue recovery (with an interactive confirmation prompt), runs the worker, and repeats until the queue is clear or the round limit is reached.

Options:

| Flag           | Default | Description                                          |
| -------------- | ------- | ---------------------------------------------------- |
| `--yes`        | off     | Skip confirmation prompts (non-interactive / CI use) |
| `--max-rounds` | 10      | Maximum worker iterations before stopping            |
| `--limit`      | 20      | Recovery action limit per round                      |

```sh
# Non-interactive, up to 5 worker rounds:
npm run reindex -- --yes --max-rounds 5
```

> **This is queue recovery, not a controlled cutover.** `npm run reindex` drains and recovers the
> ingestion queue against the current live index — it re-runs the worker until the queue is clear.
> It does **not** generate a shadow index, evaluate a baseline vs. candidate, gate on
> `content_mrr_at_10`, atomically promote, or roll back. That eval-gated shadow-generation →
> baseline/candidate → atomic-promotion cutover is designed-only in
> [reindex-shadow-harness-design.md](reindex-shadow-harness-design.md); its driver
> (`scripts/reindex-shadow.ts`) is not built. A chunking change (e.g. `CHUNK_STRATEGY=document`)
> must clear the passage-rank gate (`content_mrr_at_10` above baseline, per
> `src/lib/reindex-eval-gate.ts`) through that harness before any promotion — never via this command.

## Manual safe sequence

If you prefer to run each step by hand (or need to reconcile a migration in between):

1. Confirm the target project is `sjrfecxgysukkwxsowpy`.
2. Run `npm run supabase:recovery-status`.
3. Confirm migration alignment (merging `supabase/migrations/*.sql` to `main` triggers the Supabase GitHub integration auto-deploy in ~34s to production `sjrfecxgysukkwxsowpy`; manual apply is only for recovery/reconciliation when auto-deploy fails, and only with explicit operator approval after the health probe succeeds).
4. Run `npm run reindex:health`.
5. If stale or failed jobs exist, run `npm run recover:ingestion` and confirm the prompt.
6. Run `npm run worker:once` with the conservative defaults from `.env.example`.
7. Repeat `npm run reindex:health` and `npm run worker:once` until the queue is clear.
8. Run indexing and RAG evals only after documents have adaptive chunks and retrieval synopses.

## In-app mutation safety

Document and bulk full reindex requests run a server-side safety preflight before resetting indexes or queueing jobs.
If the response includes `safety.safeToRun: false`, do not retry repeatedly. Use `safety.reason`:

- `supabase_unavailable`: pause reindexing and rerun `npm run supabase:recovery-status`.
- `active_jobs`: wait for pending or processing jobs to finish before retrying.
- `active_agent_enrichment`: an agent-enrichment pass is running on one or more selected documents; wait for it to finish before reindexing.
- `stale_processing_jobs`: run `npm run recover:ingestion -- --apply --limit 20`, then rerun `npm run reindex:health`.
- `queued` documents with no open job (upload crash between document insert and job insert): dry-run `npm run recover:ingestion -- --include-stranded-queued`, then re-run with `--apply` after reviewing the candidate list. Optional `--owner-id` and `--stranded-min-age-minutes` keep the sweep bounded. The six-hour ingestion-autopilot probe detects aged owner-scoped rows and opens/updates the operator alert issue; it never applies this recovery unless the guarded manual apply dispatch is used.

The preflight response also includes active job counts and job metadata for operator review.

When the ingestion-autopilot probe supplies `jobs_stranded_final_attempt` or
`documents_indexed_without_chunks`, any positive count requires manual review and an alert,
even if the probe's overall `ok` is true. A supplied invalid count is also unassessed and alerts;
older probes that omit these fields remain compatible. These signals alone never trigger queue
recovery, including with `--apply`. If separate recoverable queue work also exists, bounded
recovery may run, but the integrity alert remains until a subsequent probe confirms resolution.

The configured character target controls ordinary table groups. A larger indivisible
row is supported as a standalone chunk with its full title, header and adjacent note,
up to 8,191 UTF-8 bytes for known OpenAI embedding models. This is a conservative
byte-BPE token upper bound, not an exact token count. The chunk records this overflow
in metadata, and embedding requests are batched by both input count and total bytes.
`TABLE_ROW_EXCEEDS_CHUNK_BUDGET` remains a permanent refusal above that hard ceiling
or for an unknown model's target overflow. The chunker returns no partial chunk array
and never splits cells or truncates evidence. Review the source structure before
retrying; the refusal does not establish OCR accuracy. Atomic reindex failure preserves
the existing index.

## Do not do this

- Do not run workers while Supabase SQL probes are timing out.
- Do not raise worker concurrency during recovery.
- Do not run retrieval or RAG evals against a partially reindexed corpus.
- Do not enable inline enrichment during recovery unless core indexing is stable.
- Do not run imports, reindexing, queue recovery mutations, or evals when `npm run supabase:recovery-status` reports `supabase_unavailable`.
- Do not use `--force-large-import` unless Supabase health is stable and you have intentionally chosen a larger import wave.
- Do not re-index to fix "OCR corruption" or to add table/heading-aware chunking without new evidence. Both were measured negligible/neutral on 2026-07-08 (`noisy_unit_rate` is a saturated visual-coverage metric, not corruption; heading/table-aware chunking already exists and chunks are well-bounded). See `docs/chunking-ocr-reindex-lever-finding-2026-07-08.md`.

## Recovery transaction (merged 18 October 2026)

The recovery application now requires `recover_ingestion_job(uuid,text,jsonb)` from
`20261018082910_audit_durable_recovery_pairing_and_cache_fences.sql`. That migration merged to
`main` on 18 October 2026 (PR #3653), so the Supabase integration applied it to production
automatically. Confirm it with the post-merge `live-drift` workflow (both `check:drift` and
`check:migration-history` green); this runbook does not record that result.

The SQL had to be live before the new recovery application ran: an application ahead of SQL
fails its RPC call before changing the document or queue. The old recovery application
must not be used after rollout: it retains obsolete lock and destructive-reset semantics.
Do not roll back to it as an operational workaround.

Both `recover:ingestion` and the consolidated `reindex` pipeline use the shared RPC-only
application helper. Recovery uses the same current document-authority lock and sorted node/Edge job locks as
worker claims. It rechecks the observed owner, document status, job status, lease token,
lease expiry and legacy timestamp while holding those locks through commit. Current leases
are left alone. Expired final attempts and failed jobs that were never leased requeue
without manufacturing a processing lease. All generations, pages, image references,
artifact families, metadata and counts remain intact; the next worker claim creates a
fresh write generation. Retained obsolete generations use the existing generation-cleanup
procedure after successful indexing, not the recovery command.

`managed_recovery_required` means immutable managed-generation evidence exists. Leave it
held and use the specialist managed-ingestion recovery procedure; do not delete evidence or
switch to `reset_document_index`. `authority_unavailable` also leaves everything intact.
A changed snapshot is skipped. Re-read the preview after resolving the reason. A lost RPC
response can be retried: either the whole transaction rolled back or its committed pending
job is left to the worker. No partial document reset requires compensation.

The same migration adds `cme_remove_evidence_v2(uuid,uuid,text)` so an application ahead of SQL
refuses before mutation, while the corrected original RPC remains compatible with old callers.
CME removal commits an owner/object-specific cleanup row with the
privacy tombstone, backfills existing tombstones and preserves that row on retry, including
completed cleanup. Storage/janitor replay is idempotent. Teaching supervision writes lock
pairings before authorization; confirmations lock sorted pairings before sorted entries.
An old supervisor's confirmation admitted before a reassignment commits remains historical;
if reassignment obtains the pairing first, the former supervisor's confirmation refuses.
`work_move_team_v1(uuid,uuid,uuid,uuid)` makes a new application ahead of SQL refuse
before moving. Whole-team supervisor revocation is transactional with a team move; a failed revocation
rolls the move back. Concurrent grants validate the current hospital under the team lock.

The cache revision RPC hashes the entire exact owner/public/document scope, including every
status and governance metadata. SQL first remains compatible with old cache clients; new
clients before SQL fail cold. Each scope read costs a document scan/hash, so measure realistic
corpus latency before approval. No retrieved text is returned by this RPC.

Rollback requires a reviewed forward migration and compatible application version. Preserve
cleanup obligations and completed Teaching history; do not edit applied migrations, reseal
hashes or restore the obsolete recovery path. Isolated reduced PostgreSQL function probes
and mocked application tests do not replace full Supabase migration replay, Storage/RLS,
or hosted validation, which remain separate gates.

## Recommended recovery defaults

```env
WORKER_CONCURRENCY=1
WORKER_BATCH_SIZE=3
WORKER_POLL_MS=30000
WORKER_INLINE_ENRICHMENT=false
WORKER_HEALTH_BACKOFF_MS=120000
MAX_IMPORT_JOBS_PER_RUN=5
MAX_IMPORT_BYTES_PER_RUN=157286400
WORKER_PROGRESS_UPDATE_MIN_INTERVAL_MS=60000
WORKER_MAX_CAPTIONED_IMAGES_PER_DOCUMENT=15
WORKER_MAX_CAPTIONED_IMAGES_PER_PAGE=2
```

Set `WORKER_INLINE_ENRICHMENT=true` only after core chunk indexing is stable and the Supabase project is not returning timeout or `522/544` responses.

Open a Supabase support ticket if `npm run supabase:recovery-status` cannot complete its health probe for more than 30 minutes while local workers are stopped.
