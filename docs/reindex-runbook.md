# Adaptive RAG reindex runbook

Use this sequence when applying RAG indexing changes to the live `PsychSift Production` Supabase project.

> **Current status: the library re-index is stopped by owner decision** (see
> [the decision](decisions/2026-10-17-library-reindex-stopped.md)). Do not start a re-index from this runbook.
> The one exception is the three-document pilot in
> [the pilot decision](decisions/2026-10-23-reindex-pilot-approved.md), which has its own scope and spend cap.
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

This single command encapsulates the sequence below: it confirms the target project, checks Supabase health, snapshots reindex health, applies ingestion queue recovery (with an interactive confirmation prompt), runs the worker, and repeats until the queue is clear or the round limit is reached.

Both `reindex` and `recover:ingestion` apply recovery through the shared atomic RPC described in
[Recovery transaction](#recovery-transaction-merged-18-october-2026). The command remains a live operation requiring the applicable operator and spending approvals.

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

## Manual sequence

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

`reindex:health` also reports how well documents were read: the `quality_extraction_good`,
`_partial`, `_poor` and `_unknown` counts and an `extractionQuality` verdict (audit EM-N6). It
warns when at least a fifth of five or more assessed documents read poorly. Before a re-index,
note the `poorShare`; afterwards run `npm run reindex:health -- --baseline-poor-share <that value>`
and it also warns on a rise of five points or more. The scheduled ingestion autopilot prints the
same verdict in its run summary. The warning never triggers queue recovery and does not change the
exit code, so check the summary line rather than waiting for an alert issue. Treat the counts
as meaningful only for documents indexed since the worker began writing its own verdict: a
mid-October review found every older document reading `good` because the now-uncalled
`repair_enrichment_quality_batch` function had stamped them by row presence.

The configured character target controls table groups (chunker 1.3.1). Each group repeats
the table caption and header. A single row longer than the room left under the header is
split at word boundaries into pieces that each repeat the header. A table footnote (symbol
markers, "Note" or "Source" lines only) of up to 200 characters is repeated on every group
(chunker 1.3.3), so every group carries a short warning such as a renal caution. A longer
footnote is appended to the last group when it fits, otherwise emitted with the repeated header
as its own chunk.

## Do not do this

- Do not run workers while Supabase SQL probes are timing out.
- Do not raise worker concurrency during recovery.
- Do not run retrieval or RAG evals against a partially reindexed corpus.
- Do not enable inline enrichment during recovery unless core indexing is stable.
- Do not run imports, reindexing, queue recovery mutations, or evals when `npm run supabase:recovery-status` reports `supabase_unavailable`.
- Do not use `--force-large-import` unless Supabase health is stable and you have intentionally chosen a larger import wave.
- Do not re-index to fix "OCR corruption" or to add table/heading-aware chunking without new evidence. Both were measured negligible/neutral on 2026-07-08 (`noisy_unit_rate` is a saturated visual-coverage metric, not corruption; heading/table-aware chunking already exists and chunks are well-bounded). See `docs/chunking-ocr-reindex-lever-finding-2026-07-08.md`.

## Rolling back a reindex

`npm run reindex:rollback` moves documents back to their previous committed index generation.
A commit keeps the new generation and the one it replaced (the prune trigger from
`20261019155200`), so there is exactly one generation to go back to, and only until the next
commit of that document. The script needs the `rollback_document_index_generation` function
(`20261021150000_rollback_document_index_generation.sql`, restoring generation details since
`20261021170000_restore_generation_metadata_on_rollback.sql`).

- Dry run is the default. For each document it prints the current and previous generation,
  their chunk counts and commit times, and whether it would roll back.
- Choose one scope: `--document-id <uuid>[,<uuid>]`, `--committed-after <ISO time>` (the
  current generation was committed after that time) or `--chunker-version <version>` (the
  current generation's chunks carry that `chunker_version`). `--limit` caps the documents
  (default 50, max 1000).
- A rollback restores the target generation's details with the pointer (#3732): the
  worker-owned `documents.metadata` keys (extraction quality, cover image, embedding model,
  enrichment state, extraction provenance and metrics) and the `document_index_quality` row,
  from snapshots taken as each generation is replaced. Owner-edited metadata such as the title
  is left alone. A generation that was replaced before 21 Oct 2026 (before
  `20261021170000_restore_generation_metadata_on_rollback.sql` started taking snapshots) has no
  snapshot and is refused with `target_snapshot_missing` rather than rolled back with mismatched
  details. The dry run reports that refusal too, so a document it lists as ready will not be
  refused for it at apply.
- `--apply` writes (it asks first unless `--yes` is given). It refuses a document with no
  previous committed generation, or whose previous generation has no chunks. The database
  function also refuses if the pointer moved since the dry run or an ingestion job for the
  document is pending or processing.
- The generation you roll back from is kept, so a rollback can itself be undone. On branch
  `claude/project-thread-d92wad` (24 Oct 2026), a second run that would move a document forward
  to that newer generation is refused as `previous_generation_is_newer` unless you pass
  `--roll-forward`, so running the same command twice no longer undoes the rollback by accident.
  Check the result with `npm run reindex:health` and run the retrieval eval before relying on it.

**Cautions (added 24 Oct 2026).**

- **Older documents may have no quick undo.** Rollback only counts a generation that has page
  rows stamped with its generation. Migration `20261013075944_administrator_txt_fenced_runtime_cutover.sql`
  (13 Oct 2026) added `document_pages.index_generation_id` with no backfill, so pages saved before
  it carry no stamp. For a document whose previous pages are that old, the planner reports
  `no_previous_generation` and cannot restore it. Run the read-only dry run for the documents
  before any re-index, including the pilot: a refusal there means "no quick undo for this document
  right now". It is not the final word, because once the re-index commits, the generation it
  replaced becomes the one to roll back to. Run the dry run again after the commit and before
  any no-go decision. Migration `20261025170000_rollback_legacy_pages_summary_and_guards.sql`
  (audit E2E-01) fixes the older case once it is live: the planner also lists generations that
  have chunks but no stamped pages, and the database rollback then switches the document back to
  its unstamped pages. It merges only after the owner's own yes. Until then the refusal stands.
- **Do not re-index a pilot document twice before the go/no-go check.** Each commit keeps only
  the new generation and the one it replaced. If a document's current index is already a pilot
  generation, queuing it again would replace its pre-pilot generation, and rollback could then
  only return to the first pilot run.
- **Run the after-canary only once enrichment has finished (audit E2E-08).** The core index
  switches over first, and the summary, sections and memory cards are rebuilt afterwards. A job
  whose enrichment is turned off or fails is still marked completed ("enrichment deferred"), and in
  between the old memory cards are hidden while the old summary is still used. Before dispatching
  the after-canary, confirm for each re-indexed document that `metadata.enrichment_status` is
  `completed` and that its memory card and section counts are close to the old generation's. That
  check reads the live database, so it needs the owner's go-ahead like the pilot itself.
- **A rollback does not roll back the summary or topic labels (audit DB-N1).** The document
  summary, clinical specifics and generated topic labels are not part of the generation
  snapshot, so after a rollback they still describe the newer version. The script prints a note
  for every document it rolled back. Rebuild that document's enrichment afterwards (a small paid
  run that needs spending approval) before relying on its summary. Once migration
  `20261025170000` is live, the snapshot keeps the outgoing summary and generated labels and the
  rollback restores them (its result says `summary_restored` and `labels_restored`); the note
  still applies to generations that left before it went live.
- **`--committed-after` and `--chunker-version` start from the documents table (audit DB-N3).**
  They list every indexed document (updated after the cut-off, for `--committed-after`) and then
  check each one's own pages and chunks, so they no longer scan whole tables. On a large library
  the dry run makes a few small queries per document, so prefer `--document-id` when the list is
  known.

```bash
npm run reindex:rollback -- --chunker-version 1.3.1-page            # dry run
npm run reindex:rollback -- --document-id <uuid> --apply            # write
```

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
