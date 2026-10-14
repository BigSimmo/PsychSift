# Database remediation & future-proofing plan — 2026-08

> **Programme complete (Phases 0–6 COMPLETE; D4 auto-deploy on `main` is ON).** All database remediation phases (Phases 0–6) have landed and been reconciled on `PsychSift Production` (`sjrfecxgysukkwxsowpy`), and D4 post-merge migration auto-deploy on `main` is active. See [`docs/database-remediation-coordination.md`](database-remediation-coordination.md) for the final closeout state and [`docs/supabase-remediation-closeout-notes.md`](supabase-remediation-closeout-notes.md) for the remaining deferred non-DDL notes. The status block and measurements below are retained as historical planning context from 2026-08-14.

Owner: operator (Josh) + specialist session. Source findings: open ledger `#248` (whose causal
conclusion awaits a read-only history and audit check) and the queued P1 live-drift follow-up.
Companion evidence: live-drift Actions runs
`30763871562` (2026-08-02), `31330856982` (2026-08-09) and
`31813064485` (2026-08-14, the historical measurement at plan authoring), PR #1614,
`supabase/migrations/20260804110240_restore_rag_search_health_indexes.sql`.

> **Historical status as of 2026-08-14 (superseded — Phases 0–6 are now complete; see [`docs/database-remediation-coordination.md`](database-remediation-coordination.md)).** Phase 0 is **complete** (routing, post-migration trigger, evidence
> file, and the forced-dispatch proof — which auto-created issue **#1963**). Phase 1 is **partial**:
> 1.1 and 1.3 were run in an owner-authorised incident window, but **1.2, the RPC divergence
> dossier, is outstanding and is the gate for Phase 3**. Phase 4 is **partial**: the two
> retrieval-critical trigram indexes were restored, ~20 remain.
>
> **Historical next step (2026-08-14): Phase 1.2, not Phase 3.** Complete and review the RPC divergence dossier first,
> then run the Phase 2 staging-parity rehearsal. Only after both prerequisites are complete may an
> appropriately approved Phase 3 reconciliation proceed. Before starting any phase, check the
> open-PR list for the surface first (`#292`): Phase 0 was independently built twice on 2026-08-14,
> and Phases 3 and 4 spend approved production windows and eval-canary budget rather than just tokens.

**Scope.** Fixes, in dependency order: the live-vs-repo schema gap, the unresolved cause of the
affected migration history, drift-detection routing, and the surrounding database debt (`#102`,
`#011`, `#036`, `#022`, `#025`, `#056`/`#057`, `#183`, `#188`/`#196`–`#200`, `#191`, `#098`/`#099`).
Ends with standing protections so unverified history repairs remain visible and cannot silently mask
drift.

The historical schema gap, measured 2026-08-14 (resolved by Phases 3–6; see [`docs/database-remediation-coordination.md`](database-remediation-coordination.md) for final closeout):

| Category                      | 2026-08-09 | 2026-08-14         |
| ----------------------------- | ---------- | ------------------ |
| diverged `match_*` RPC bodies | 10         | **10 — unchanged** |
| `missing_live` indexes        | 21         | **20**             |
| `unexpected_live` indexes     | 2          | **2 — unchanged**  |

**Standing rules for every phase.** No hosted mutation without explicit approval for that phase.
Never raw-SQL a drift fix — every live change is codified (migration + `schema.sql` mirror +
regenerated `drift-manifest.json`) in the same change. Every phase ends with pasted decisive
evidence, not exit codes. RAG-protected
surfaces (`match_*` RPCs, anything under `src/lib/rag/**`) are flagged before editing and
behaviour changes need a live eval-canary pair (36/36, recall 1.0, zero per-case rr regressions).

**Recovery point — owner decision, 2026-08-22 (`#1K6T35`).** This rule used to read "PITR/backup
restore point captured before any mutating phase". It was unsatisfiable: point-in-time recovery is a
paid add-on and is **off** on the live project (`supabase backups list` on 2026-08-19 reported
`pitr_enabled false`, `walg_enabled true`, seven retained daily physical backups). A checklist item
nobody can satisfy reads as met by default whenever nobody checks it, which is exactly what happened
through Phases 1-4. The owner has decided to **leave PITR off and accept a worst case of roughly 24
hours of data loss** on the clinical corpus, so the rule now states the true position:

> The only restore point is the most recent daily physical backup, up to ~24 h old. Before any
> mutating phase, confirm the latest backup's completion timestamp and record it, and state in the
> phase's evidence what would be lost by restoring to it. Phases whose every statement has an exact
> one-statement inverse and no data-loss surface (the Phase 4 index work) may proceed on that basis.
> Anything that rewrites or drops data or policy objects must additionally have a written, tested
> reversal path, because there is no restore point finer than the last nightly backup.

This decision covers **this remediation programme only**. It does not relax the separate
`docs/superpowers/plans/2026-08-20-rag-ingestion-reindex.md` gate, which stops before a production
re-index or backfill when PITR is disabled — that plan mutates the corpus itself and its stop
condition stands until it is revisited on its own terms.

---

## Phase 0 — Enablement (repo-side, no hosted access; can start immediately)

0.1 **Drift-failure routing** (the "red for three weeks, nobody told" fix). Extend
`.github/workflows/live-drift.yml`: on failure, create-or-update a pinned GitHub issue titled
`Live drift check failing` carrying the finding list, and mark it resolved-comment on the next
green run. Failure becomes a visible, assignable object instead of a silent red row.

0.2 **Post-migration drift trigger.** Add a `workflow_run`/`push` trigger so live-drift also runs
after any push to `main` that touches `supabase/migrations/**` — drift is checked within minutes
of the change that could cause it, not up to a week later.

0.3 **Session tooling** (`#183`): add `SUPABASE_ACCESS_TOKEN` (and Sentry token if desired) to the
operator environment/secrets so migration-history reads and CLI repair are possible in approved
windows. Names only in logs, never values.

0.4 **Evidence file**: create `docs/audit/live-drift-forensics-2026-08.md`; all phase outputs land
there, dated.

Gate: `check:github-actions` (workflow pin/policy), `verify:pr-local` for the workflow edits.

## Phase 1 — Forensics: establish the truth (read-only hosted window, ~1 h)

1.1 **Migration-history fingerprint.** Run and record:

```sql
select version, name, statements is null as no_statements,
       coalesce(cardinality(statements), 0) as stmt_count
from supabase_migrations.schema_migrations
order by version;
```

Treat every `no_statements = true` row as a candidate mark-applied/repair signal, not proof of
cause. Record whether `20260705180000` has that signal, then pair it with relevant audit history
to distinguish skipped DDL from indexes that were created and later dropped. This turns the current
hypothesis into a named, evidence-backed conclusion.

1.2 **RPC divergence dossier.** For each of the 10 mismatched `match_*` functions:
`select pg_get_functiondef(oid)` on live, diff against the repo's canonical body, classify:
**live-ahead** (hotfixed live, repo stale), **repo-ahead** (live stale), or **normalization
noise** (whitespace/qualifier only). No edits. This is the highest-stakes unknown in the whole
plan — live retrieval behaviour may currently depend on bodies the repo does not contain.

1.3 **Index inventory & sizing.** For the 20 missing and 2 unexpected indexes: owning-table
`pg_relation_size`, and `EXPLAIN (ANALYZE, BUFFERS)` for the known hot queries
(`documents` title ILIKE, `document_chunks` content search, `rag_retrieval_logs` miss scan).
These are the before-measurements for Phase 4, including the `#231` latency hypothesis.

Stop rule: read-only; if anything unexpected appears (e.g. objects missing that the app needs
right now), report before proceeding.

## Phase 2 — Staging rehearsal (`#056`, prerequisite for safe production work)

2.1 Bring `PsychSift Staging` to full migration parity (**26 migrations behind as measured
2026-08-17** — ten earlier history holes plus sixteen after `20260719055623`; the gap widens as
`main` advances, so re-measure at the start of the window rather than trusting this figure). This
doubles as the rehearsal: the replay exercises every migration end-to-end, including the
`20260804110240` guard (staging must prebuild or take the transactional builds — it is idle, so
transactional is fine there).

2.2 Run `check:drift` against staging. Staging green proves the repo chain is self-consistent
before production is touched.

2.3 Keep `#057` (soak + rollback drill) queued for after Phase 3, against an exact candidate.

## Phase 3 — RPC reconciliation (clinical-risk core; before indexes because it can change answers)

Per the Phase 1.2 classification:

- **Normalization noise** → fix the manifest normalizer / regenerate; no hosted change.
- **Live-ahead** → codify the live body into a new migration + `schema.sql` mirror.
  PR carries `RAG impact: no retrieval behaviour change — codifying already-live body` and the
  diff as evidence. This is the safe default and likely majority case.
- **Repo-ahead** → deploying the repo body changes live behaviour: requires the approved
  eval-canary pair (baseline → post, 36/36, recall 1.0) around the deploy. Batch these
  separately; one revertible migration each.

Stop rule: any RPC whose diff is not clearly classifiable gets its own decision item — never
"probably fine".

## Phase 4 — Index restoration (mutating window, off-peak, batched)

4.1 **Batch A — small tables** (`audit_logs`, `api_rate_limits`, `rag_aliases`, `rag_queries`,
`rag_query_misses`, `image_caption_cache`, `storage_cleanup_jobs`, `indexing_v3_agent_jobs`,
`document_index_quality`, `document_publication_approvals`, `medication_records`,
`ingestion_job_stages`, `document_summaries_owner_idx`): `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
one at a time, verify `indisvalid AND indisready`, drop-and-retry any invalid build.

4.2 **Batch B — large tables** (`document_chunks_anchor_idx`, `document_chunks_content_trgm_idx`,
`documents_title_trgm_idx`, `documents_registry_projection_lookup_idx`,
`document_index_units_heading_path_idx`, `document_images_*`): same procedure, off-peak, one at a
time, monitoring locks. Note: the two trigram indexes are the canonical `20260705180000`
definitions — restoring them is completing an already-recorded migration, **not** `#102`'s
canary-gated bare-column work, which stays separately gated.

4.3 **Unexpected live indexes** (`document_table_facts_document_id_idx`,
`storage_cleanup_jobs_owner_id_idx`): decide codify (add to a migration + mirror) or
`DROP INDEX CONCURRENTLY` if redundant with a canonical index. No silent allowlisting.

4.4 **Codify.** One reconcile migration per batch following the `20260804110240` pattern
exactly: the migration **validates** (presence, `indisvalid`/`indisready`, normalized
`pg_get_indexdef` match) and fails fast — it never builds. Mark applied only after live
validation passes. Mirror into `schema.sql`, `npm run drift:manifest`, extend
`search_schema_health()`'s `required_indexes` for any index the runtime should monitor.

4.5 **Prove it.** Dispatch live-drift: must be green (or only reasoned allowlist warnings).
Paste the "Compared … against live" + zero-drift lines into the evidence file.

## Phase 5 — Measure and close the loop

5.1 Re-run the Phase 1.3 `EXPLAIN` set; record plan flips (seq scan → index scan) and timings.

5.2 Re-test `#231`: with trigram indexes present, measure whether the 25 s fast-route budget
still binds. If latency collapses, `#231` may close or re-scope; if not, its investigation
continues with better data.

5.3 If any Phase 3 RPC deploy changed behaviour: `eval:retrieval:quality` must show 36/36.
Run `check:production-readiness` once at the end of the window.

## Phase 6 — Future-proofing (make recurrence structurally impossible)

6.1 **History-integrity probe in drift.** Extend `schema_drift_snapshot()` (new migration) to
also return `schema_migrations` versions with `statements IS NULL`, and teach `check:drift` to
report any such row not on a reviewed allowlist (each allowlisted version needs a pointer to its
guard migration). A history-repair row without a validating guard migration becomes permanent,
visible drift.

6.2 **Guard-migration contract.** Document in `AGENTS.md`/`docs/database-drift-detection.md`:
any history repair or mark-applied MUST ship a fail-fast validation migration (the
`20260804110240` pattern). Add a repo test asserting every allowlisted `statements IS NULL`
version has a matching `*_restore_*`/`*_reconcile_*` guard file.

6.3 **Runtime coverage ratchet.** `search_schema_health()` monitors a curated index list; the 21
missing indexes were invisible to it. Add a repo test that every index created by migrations on
retrieval-critical tables is either in `required_indexes` or consciously listed as unmonitored —
so coverage decisions are explicit.

6.4 **DR codification** (`#188` → `#196`–`#200`): move `pg_cron` schedules and `app.*` GUCs into
idempotent migrations where the platform allows; write the operator runbook + names-only verify
script for Vault secrets, edge-function deploys, and dashboard settings. Then `#057`'s restore
drill validates the whole set.

6.5 **Same-window dashboard items:** `#011` percentage-based connection-pool allocation;
`#200` re-entered auth/pool/keys config verification.

## Phase 7 — Deferred structural debt (after drift is green and stays green)

- `#022` hosted apply of the BMJ attestation migration (its own approved window + human review).
- `#025` configure the Railway webhook so the deployed document-change plumbing goes live.
- `#036` explicit `public_corpus` marker migration (privacy hardening; supabase-schema-guardian
  review).
- `#191` ACL-migration consolidation (maturity X5) — **last**, because rewriting migration files
  is exactly the operation the new history-integrity checks exist to police; doing it after 6.1/6.2
  means the safety net is live.
- `#098`/`#099` round-trip budget tests on the answer path (repo-side, independent).

---

## Order rationale (why this sequence)

Truth before mutation (Phase 1), rehearsal before production (Phase 2), the change that can alter
clinical answers before the changes that only speed them up (Phase 3 before 4), measurement before
closure (Phase 5), and prevention built while the incident is fresh (Phase 6). Consolidation and
nice-to-haves last (Phase 7). Phase 0 is first because it needs no approval and immediately fixes
the failure that let this sit unnoticed.

## Approval map

| Phase | Hosted access                                              | Approval needed                                      |
| ----- | ---------------------------------------------------------- | ---------------------------------------------------- |
| 0     | none (GitHub Actions secrets already hold the service key) | repo PR review only                                  |
| 1     | read-only production                                       | yes — read window                                    |
| 2     | staging mutation                                           | yes — staging window                                 |
| 3     | production RPC deploys                                     | yes — per batch; canary approval for repo-ahead RPCs |
| 4     | production DDL (concurrent)                                | yes — off-peak window per batch                      |
| 5     | read-only + one eval dispatch (~$1–2) if RPCs changed      | yes for eval                                         |
| 6     | one migration deploy (6.1); rest repo/docs                 | yes for 6.1                                          |
| 7     | per item                                                   | per item                                             |
