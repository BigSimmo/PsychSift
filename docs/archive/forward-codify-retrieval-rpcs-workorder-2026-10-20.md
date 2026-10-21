# Archived work-order — forward-codify-retrieval-rpcs-workorder

Archived 2026-10-20 from `docs/forward-codify-retrieval-rpcs-workorder.md` at `ace8ea995` because it is complete: the four forward-codify migrations were applied and drift-verified on 2026-07-13.
This is historical evidence, not current guidance or permission to resume work.
Use the [retirement notice](../forward-codify-retrieval-rpcs-workorder.md), current repository policy and a separately
approved current task. Relative Markdown links below were rewritten for the archive folder.

---

# Work-order — forward-codify live-ahead retrieval RPC bodies (drift backlog #0)

**Status: complete.** The production-current definitions were captured read-only and preserved under
their actual migration versions. Ran the scratch PostgreSQL replay: passed. Ran the reviewed live
migration apply: applied `20260713062107`, `20260713062125`, `20260713062132`, and `20260713062139`
on 2026-07-13. Ran `npm run check:drift`: passed. Ran `npm run check:production-readiness`: READY.

Historical blockers at authoring time (2026-07-12):

1. **Byte-faithful Docker-replay validation is required and Docker was down.** The established method
   (see [supabase-migration-reconciliation.md](../supabase-migration-reconciliation.md) and the
   `20260701140631_codify_live_retrieval_rpcs` precedent) validates each codified body byte-equivalent
   to live via a whitespace-stripped `pg_get_functiondef` md5 against a container replay **before** any
   apply — this is what makes the apply a proven no-op on live. Docker Desktop would not start here.
2. **Live is under active concurrent multi-session editing.** `supabase/drift-allowlist.json` warns the
   snapshot "needs regeneration once churn settles." A capture taken now can be stale by apply time, so
   the codification must **re-capture and re-compare at apply time**.

Shipping a large multi-function migration + `schema.sql` reconciliation without (1), against a moving
target, would risk introducing the exact silent-retrieval-regression class this fixes. So this file
locks the capture fingerprints and the exact procedure; execute it in an environment with Docker and a
quiescent live DB.

## Live fingerprints captured 2026-07-12 (project `sjrfecxgysukkwxsowpy`)

Read-only capture via `pg_get_functiondef`. Re-run the capture at execution time; if any `body_md5`
below differs, live moved — codify the **new** body and note the change.

| Function (identity args)                                                     | body_md5                           | len  | secdef  | In allowlist as              |
| ---------------------------------------------------------------------------- | ---------------------------------- | ---- | ------- | ---------------------------- |
| `match_document_chunks(vector,int,float8,uuid,uuid)`                         | `45cc06effe9a753604eba4af5ae43c7e` | 1553 | no      | live-ahead                   |
| `match_document_chunks_hybrid(vector,text,int,float8,uuid[],uuid)`           | `90a027977c84847730a0e48481060502` | 5638 | no      | live-ahead                   |
| `match_document_chunks_text(text,int,uuid[],uuid)`                           | `9d2f8aa374f01bd149a17af56e075171` | 5596 | no      | live-ahead                   |
| `match_document_table_facts_text(text,int,uuid[],uuid)`                      | `904049c7635b996a6653e91c49d86ec2` | 4609 | no      | live-ahead                   |
| `match_documents_for_query(text,int,uuid)`                                   | `53234990b88dba5c0466f9dccb512455` | 1448 | no      | live-ahead                   |
| `match_document_index_units_hybrid(vector,text,int,float8,uuid[],uuid)`      | `7b144ff6fdd93b753bf67f7317be0cc6` | 3309 | no      | (verify)                     |
| `match_document_memory_cards_hybrid(vector,text,int,float8,uuid[],uuid)`     | `274ec5832d85a95880ec26daf5b79f23` | 1014 | no      | (verify)                     |
| `match_document_memory_cards_hybrid_v2(vector,text,int,float8,uuid[],uuid)`  | `977ba52a9a239962d3105f2e5b071f82` | 3714 | no      | (verify)                     |
| `match_document_embedding_fields_hybrid(vector,text,int,float8,uuid[],uuid)` | `9d6f2b7bcd009d23739aabaf93234deb` | 2476 | no      | not listed (already matches) |
| `get_related_document_metadata(uuid[],uuid)`                                 | `ada68dd136a9878de2ce45e522fc0208` | 1363 | no      | live-ahead (non-retrieval)   |
| `get_visual_evidence_cards(uuid,int)`                                        | `f4aac704317472dfc06c361389793cf9` | 1370 | **yes** | unexpected_live (live-only)  |

Capture query:

```sql
select p.oid::regprocedure::text, pg_get_functiondef(p.oid),
       md5(pg_get_functiondef(p.oid)) as body_md5
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname = ANY (ARRAY[
  'match_document_chunks','match_document_chunks_hybrid','match_document_chunks_text',
  'match_document_table_facts_text','match_documents_for_query',
  'match_document_index_units_hybrid','match_document_memory_cards_hybrid',
  'match_document_memory_cards_hybrid_v2','get_related_document_metadata','get_visual_evidence_cards',
  'run_visual_eval_case','run_all_visual_eval_cases','repair_enrichment_quality_batch'])
order by 1;
```

## Procedure (execute with Docker up + quiet live queue)

1. **Re-capture** the full `pg_get_functiondef` text for each function above (read-only). Apply
   identical whitespace normalization (strip leading/trailing whitespace, normalize internal
   whitespace) to both live-captured definitions and the migration text before computing md5 hashes.
   Confirm normalized md5s vs this table; codify whatever live currently is.
2. **Author** `supabase/migrations/<ts>_codify_live_retrieval_rpcs_forward.sql` — one
   `CREATE OR REPLACE FUNCTION` per function, body = the verbatim captured definition. Apply the
   same whitespace normalization before hashing to ensure normalized comparison (not byte-identical
   raw text). Preserve `security definer`/`invoker`, `set search_path`, and grants exactly.
   **Capture and replay ACLs:** alongside `pg_get_functiondef`, capture each function's ACLs using
   `proacl` or routine privileges query. Include the captured grants in the migration (apply after
   each `CREATE OR REPLACE`) and verify the resulting ACLs match live during validation.
   `get_visual_evidence_cards`, `run_visual_eval_case`, `run_all_visual_eval_cases`,
   `repair_enrichment_quality_batch` are **live-only** (`unexpected_live`) — codify as `CREATE OR
REPLACE` too so schema.sql declares them. These security-definer RPCs require particular ACL
   coverage.
3. **Reconcile** `supabase/schema.sql`: replace each function's old body with the captured one (same
   text as the migration). Update `tests/supabase-schema.test.ts` if it pins any of these bodies.
4. **Validate (the load-bearing gate):** `npm run drift:manifest` (replays schema.sql into Docker from
   scratch — proves replayability) then confirm each codified body's whitespace-normalized
   `pg_get_functiondef` md5 equals live. Compare the resulting ACLs against live using the same
   query from step 2. `npm run verify:cheap` includes `tests/drift-detection.test.ts`
   (migration↔schema.sql parity, allowlist hygiene).
5. **Golden eval:** `npm run eval:retrieval:quality` must stay **36/36** (retrieval bodies changed —
   though a faithful capture is behavior-neutral by construction).
6. **⏸ Apply** via the approved live migration workflow. Because it is a verbatim capture, apply is an
   idempotent no-op on live at capture time.
7. **Remove** the now-resolved `functions` entries from `supabase/drift-allowlist.json` (the
   `match_document_*` "live-ahead" set + the codified live-only functions) and regenerate the manifest.

## Committed capture artifact + rot guard

The read-only capture in Step 1 is also committed as a runnable file so the
target set cannot silently drift from the machine-checked source of truth:

- **`scripts/sql/capture-live-retrieval-rpcs.sql`** — `pg_get_functiondef` for
  the exact `regprocedure` signatures of the retrieval functions currently
  flagged `LIVE IS AHEAD` in `supabase/drift-allowlist.json` (7 as of
  2026-07-13, now including `repair_strict_enrichment_gate_batch`, which post-dates
  the 2026-07-12 fingerprint table above). Pinned `search_path = ''` so the
  signatures match the allowlist / `schema_drift_snapshot()` rendering exactly.
  Re-run it at execution time per Step 1 and reconcile against the fingerprints.
- **`tests/forward-codify-retrieval-targets.test.ts`** — offline guard (runs in
  `verify:cheap`) asserting that capture query's target set equals the allowlist
  `LIVE IS AHEAD` retrieval entries, so reconciling a sibling (removing its
  allowlist entry) forces a matching edit to the capture query and this file.

The committed query covers **only** the `LIVE IS AHEAD` retrieval subset (its
guard invariant). It is **not** the full codification set: the live-only
(`unexpected_live`) and `(verify)` functions in the fingerprint table above —
`get_visual_evidence_cards`, `run_visual_eval_case`, `run_all_visual_eval_cases`,
`repair_enrichment_quality_batch`, `match_document_index_units_hybrid`,
`match_document_memory_cards_hybrid[_v2]` — are captured from that table per
Step 1, not from this query. The fingerprint table remains the point-in-time
reference snapshot; the committed query is the maintained,
always-in-sync-with-the-allowlist capture of its subset.

## Not in this work-order (separate allowlist backlog)

The allowlist also carries, with the same boilerplate reason, non-retrieval drift that should be triaged
separately: the **Data-API grant** posture on ~18 tables (live revoked `authenticated` grants that
schema.sql still declares — decide codify-revokes vs restore-grants), legacy/duplicate **indexes**
(`unexpected_live` drop-candidates + `missing_live` recreate-or-remove), and the PUBLIC-execute
`security-invoker` functions (`detect_legacy_ivfflat_indexes`, `document_summary_text`,
`set_document_embedding_field_content_hash`). See
[database-drift-detection.md](../database-drift-detection.md#reconciliation-backlog).
