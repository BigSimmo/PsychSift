# Adaptive RAG reindex runbook

## U03 planning and operator boundary

U03 provides deterministic dry-run plans only: 1–100 unique canonical lowercase document UUIDs, fixed non-empty reason sets and one `sha256:` expected-state digest per document. IDs/reasons are sorted. The digest hashes UTF-8 `ingestion-repair-plan-v1\n`, followed by each UUID, tab, comma-joined reasons, tab, state digest and newline. Unknown fields, duplicate IDs/reasons and malformed digests refuse.

Expected-state identity covers exact source/version/event, committed generation, summary/projection/labels and both queue states/attempts. A supplied digest does not prove currentness. `record_ingestion_repair_plan` appends only a `planned` audit row with the recomputed canonical digest; SELECT is the only direct service-role access, and UPDATE/DELETE/TRUNCATE are denied. There is no U03 apply endpoint. U13 must reread and compare under locks before any future application.

Until the governed lease adapter exists, `index:backfill --write` refuses before operational imports, including confirmation and metadata-only variants. Every `enrich:documents` mode refuses. `enrich:backfill` default/mutating calls refuse. The existing no-write `index:backfill` inspection and explicit `enrich:backfill --dry-run` remain read-only and require separate hosted-read authority. Importing these modules performs no environment loading, startup or exit.

The historical connected recipes below were not run by U03. Local source acceptance does not authorise repair, activation, real-document processing or in-place mutation of active P05 reviewed evidence. The kernel stays default-off; P08A remains superseded. Historical U02 evaluation is exit 1, four failed suites, 45 failed and 586 passed tests overall; it is neither green nor a U03 exception.

Use this sequence when applying RAG indexing changes to the live `Clinical KB Database` Supabase project.

## Governed generation lifecycle

This is the canonical operator vocabulary for a governed reindex. The evidence boundaries are the accepted [U04 execution contract](superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U04-execution-contract.md) and [U05 generation lifecycle contract](superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U05-execution-contract.md). Other runbooks link here instead of restating a competing sequence.

The lifecycle is:

1. **Audit.** Establish complete source, ownership, policy, baseline, configuration, case and recovery evidence for the exact document population.
2. **Local plan.** Build one immutable candidate-generation plan. Planning is local and non-committing; a connected read or dry run remains a connected operation and needs its own authority.
3. **Authorized stage.** Consume a separate, current stage authorization and write candidate artifacts without changing the serving pointer. One wave has one candidate generation and an exact member population.
4. **Exact-generation evaluate.** Read the baseline and candidate by their admitted identities, preserve complete outputs and provenance, and apply the unchanged retrieval and quality gates. A reported `GO` is evaluation evidence, not promotion authority.
5. **Authorized promote.** Consume a distinct promote authorization, exact U04 envelopes, recovery binding, manifest-bound retention deadline and one immutable generation-bound U10 technical-gate verdict for every document. Promotion is the sole forward activation path and emits an immutable receipt; receipt-bound rollback is the only reverse serving-pointer transition, through the same atomic private transition core.
6. **Observation.** Observe the promoted generation and serving behavior. Do not infer success from an empty recent-job view.
7. **Receipt-bound rollback, if required.** Reverse the exact promotion transitions from the immutable receipt. Rollback remains available after the promotion's recovery-evidence freshness window expires; it restores the retained baseline and retains the failed candidate under its authorized deadline.
8. **Delayed manifest cleanup.** After policy-bound retention expires, dry-run an exact sorted document/generation manifest, then explicitly apply the identical manifest. Eligibility and rights are rechecked under locks.

U10's authoritative technical-gate lookup is mandatory and currently refuses every promotion because its real immutable verdict producer is not implemented. Do not substitute an evaluation `GO`, caller-supplied booleans or digest-shaped strings. U11 owns deferred UI-specific final wording; this runbook describes the underlying states only.

The governed path cannot first-publish a document. Every member must already be indexed, and its current serving pointer must exactly equal the admitted baseline. A null pointer is the intentional legacy G0 baseline when immutable U04 baseline/member evidence proves it. The server-authored transition and rollback snapshot are created, validated and bound within that same authorized promotion transaction; an initial G0 promotion does not require an earlier promotion receipt. A non-null governed baseline must have its exact active or retained generation row. Promotion retains the old generation; rollback retains the failed candidate. Retention duration is policy-bound and authorized in each manifest rather than fixed here.

### State vocabulary

- **admitted:** source, owner, policy and expected state passed trusted admission; no worker completion is implied.
- **processing:** a token-fenced worker owns a live attempt.
- **extracted:** required artifact writes for that attempt exist; the document is not necessarily indexed or serving them.
- **indexed:** the current ordinary token-fenced index completion succeeded for the document. This does not establish technical eligibility, activation or trusted-task completion.
- **technically eligible:** U10 produced the required immutable, generation-bound hard-gate verdict. This state is currently unreachable for promotion because the lookup seam refuses.
- **active:** the atomic promotion receipt proves the candidate is the serving generation.
- **kernel evidence available:** the optional retrieval kernel has the required governed evidence. This does not mean the Answer path uses it.
- **available to Answer:** the Answer path can retrieve the active, permitted artifacts under its own runtime and source-governance rules.

These states are distinct. A recent or bounded health view reports only what it observed; it cannot prove the global queue is empty.

### Failure and repair reasons

| Observed reason | Operator meaning | Safe next action |
| --- | --- | --- |
| Admission, source-policy, owner or state digest mismatch | The planned population is no longer the population authorized for staging. | Stop and repeat the audit and local plan. Do not edit a signed manifest in place. |
| Lease or fence lost | Another attempt or state change owns the document. | Stop the attempt; inspect its exact receipt/state and obtain a new admitted attempt if repair is still required. |
| Stage incomplete or member population changed | Candidate artifacts or receipts do not cover the exact wave. | Keep the candidate non-serving; repair through a newly authorized stage or later exact cleanup. |
| Evaluation incomplete or `NO_GO` | Required cases, outputs, provenance or release bars did not pass. | Preserve the report and failed outputs; do not promote or convert the result to `GO`. |
| U10 technical verdict unavailable | The mandatory immutable hard-gate receipt cannot be resolved. | Leave the candidate staged. U10 currently makes this the expected promotion refusal. |
| Promotion evidence or authorization mismatch/expired | The requested pointer change is not the authorized operation. | Re-audit current state and issue a new authorization; never reuse stage authority as promote authority. |
| Post-promotion observation fails | The committed receipt identifies the exact transition that may be reversed. | Use a current rollback authorization bound to that receipt; do not restore pointers manually. |
| Cleanup manifest, destination, count or eligibility mismatch | The delayed target set or rights changed. | Stop, re-read under current authority and create a new exact cleanup manifest. Do not broaden apply. |

Retain the evidence and specific failure code at every stop. Repair changes state only through the corresponding fenced or receipt-bound transition.

### Crash and recovery truth

- Lease loss before stage completion aborts the attempt. Partial candidate artifacts remain non-serving and require a later authorized repair or cleanup decision.
- **Required future U10 finalizer contract:** process death after complete artifact writes but before atomic receipt-bound activation or trusted-task creation must leave no completed trusted-admission transition. The current ordinary worker may separately finalize `indexed`; that does not establish technical eligibility, activation or trusted-task completion.
- **Required future U10 finalizer contract:** a trusted-admission finalizer transaction failure must commit neither its receipt-bound activation or task creation nor a completed trusted-admission status; retry must revalidate the exact fence and state. This guarantee is not implemented today.
- Process death after atomic activation does not undo the committed receipt. Recovery begins from that receipt and observation state; it must not re-promote from a guessed process outcome.
- Receipt-bound rollback may run after the original recovery evidence has expired because it consumes the exact retained transition proof. It still needs its own current authorization and trusted operation clock.
- Cleanup interruption is replayed with the same immutable manifest. The database rechecks exact eligibility; an interrupted or partial client response is not permission to broaden the target set.

Database PITR evidence and Storage restore evidence are separate. Neither substitutes for the other or grants promotion, rollback or cleanup authority.

The cleanup command is import-safe and defaults to a connected dry run:

```sh
npm run reindex:cleanup-staged -- --manifest <exact-manifest.json>
npm run reindex:cleanup-staged -- --manifest <exact-manifest.json> --apply
```

`--yes` skips only the apply confirmation. There is no document selector, limit or all-eligible apply mode. Both dry and apply receipts retain `privateObjectReferenceInventory` with `physicalDeletionAuthorized: false`; U05 cleanup covers exact SQL artifact rows only. Physical object deletion requires a separate U13 disposal manifest that revalidates current rights and live, shared and newly introduced references at deletion time.

The stage, evaluate, promote and rollback surfaces in `scripts/reindex-shadow.ts` are injected TypeScript APIs, not an operator CLI. No documented command currently executes the complete governed lifecycle.

## Consolidated pipeline command

The quickest way to run the historical queue-recovery cycle is the consolidated pipeline command:

```sh
npm run reindex
```

This command confirms the target project, checks Supabase health, snapshots reindex health, applies ingestion queue recovery with an interactive confirmation prompt, runs the worker, and repeats until its bounded health view reports no matching work or the round limit is reached. That observation does not prove the global queue is empty or the governed generation lifecycle completed.

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
> ingestion queue against the current live index — it re-runs the worker until its bounded view reports no matching work.
> It does **not** generate a shadow index, evaluate a baseline vs. candidate, gate on
> `content_mrr_at_10`, atomically promote, or roll back. The injected source APIs are described in
> [reindex-shadow-harness-design.md](reindex-shadow-harness-design.md), but there is no complete
> operational lifecycle CLI. A chunking change (e.g. `CHUNK_STRATEGY=document`)
> must clear the passage-rank gate (`content_mrr_at_10` above baseline, per
> `src/lib/reindex-eval-gate.ts`) and every other governed lifecycle gate before promotion — never via this command.

## Manual safe sequence

If you prefer to run each step by hand (or need to apply a migration in between):

1. Confirm the target project is `sjrfecxgysukkwxsowpy`.
2. Run `npm run supabase:recovery-status`.
3. Apply any pending local migration only after the probe succeeds.
4. Run `npm run reindex:health`.
5. If stale or failed jobs exist, run `npm run recover:ingestion` and confirm the prompt.
6. Run `npm run worker:once` with the conservative defaults from `.env.example`.
7. Repeat `npm run reindex:health` and `npm run worker:once` until the bounded health view reports no matching work; do not report that as proof of global queue emptiness.
8. Run indexing and RAG evals only after documents have adaptive chunks and retrieval synopses.

## In-app mutation safety

Document and bulk full reindex requests run a server-side safety preflight before resetting indexes or queueing jobs.
If the response includes `safety.safeToRun: false`, do not retry repeatedly. Use `safety.reason`:

- `supabase_unavailable`: pause reindexing and rerun `npm run supabase:recovery-status`.
- `active_jobs`: wait for pending or processing jobs to finish before retrying.
- `stale_processing_jobs`: run `npm run recover:ingestion -- --apply --limit 20`, then rerun `npm run reindex:health`.
- `queued` documents with no open job (upload crash between document insert and job insert): dry-run `npm run recover:ingestion -- --include-stranded-queued`, then re-run with `--apply` after reviewing the candidate list. Optional `--owner-id` and `--stranded-min-age-minutes` keep the sweep bounded. The six-hour ingestion-autopilot probe detects aged owner-scoped rows and opens/updates the operator alert issue; it never applies this recovery unless the guarded manual apply dispatch is used.

The preflight response also includes active job counts and job metadata for operator review.

## Do not do this

- Do not run workers while Supabase SQL probes are timing out.
- Do not raise worker concurrency during recovery.
- Do not run retrieval or RAG evals against a partially reindexed corpus.
- Do not enable inline enrichment during recovery unless core indexing is stable.
- Do not run imports, reindexing, queue recovery mutations, or evals when `npm run supabase:recovery-status` reports `supabase_unavailable`.
- Do not use `--force-large-import` unless Supabase health is stable and you have intentionally chosen a larger import wave.
- Do not re-index to fix "OCR corruption" or to add table/heading-aware chunking without new evidence. Both were measured negligible/neutral on 2026-07-08 (`noisy_unit_rate` is a saturated visual-coverage metric, not corruption; heading/table-aware chunking already exists and chunks are well-bounded). See `docs/chunking-ocr-reindex-lever-finding-2026-07-08.md`.

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
