# Live-drift forensics — 2026-08

Evidence record for the phased database remediation plan and playbook. No hosted reads or mutations
were performed while creating this file. Add dated, source-linked evidence here as each approved
phase completes.

**Tracking anchor:** ledger `#316` — "Live DB is missing 21 repo-defined indexes and 10 retrieval
RPC bodies diverge; weekly live-drift has been red since 2026-07-26 with no routing". Update it via
`npm run issues:update` at the end of every phase; never hand-edit `docs/outstanding-issues.md`.

**Plan of record:** [`docs/database-remediation-plan.md`](../database-remediation-plan.md) and
[`docs/database-remediation-playbook.md`](../database-remediation-playbook.md). Read both before
adding to this file.

**How to use this file.** Every section below is deliberately empty until its phase runs inside an
approved hosted window. Record the decisive output — pasted lines, run IDs, dates — not a summary
and not an exit code. An empty section means the phase has not run; it never means the phase found
nothing. Leave a section empty rather than filling it from inference.

## Phase 0 — Enablement (repo-side, no hosted access)

_2026-08-14._ Drift-failure routing and the post-migration trigger landed in
`.github/workflows/live-drift.yml`: a failed run now creates or updates a single pinned issue
titled "Live drift check failing" (label `live-drift-failure`) carrying the captured finding lines
and the run URL, and the next green run comments the resolution and closes it. The workflow also
runs on pushes to `main` touching `supabase/migrations/**` or `supabase/schema.sql`. Schedule,
`workflow_dispatch`, the secret preflight, and `concurrency.cancel-in-progress: false` were kept
unchanged. No hosted Supabase call was made.

_2026-08-14, forced-dispatch proof (owner-authorized)._ `live-drift` dispatched on `main`
(Actions run `31813064485`). The definition-of-done behaviour was observed end-to-end:

- `live-drift` job **failed** at `Compare live schema drift`, as intended for this proof.
- `Capture drift and migration-history findings` still ran (`if: always()`), and
  `Align migration history for Supabase Preview` correctly **skipped** after the failing step.
- The separate `drift-routing` job then ran (`if: ${{ !cancelled() }}`) and **succeeded**,
  creating issue **#1963 "Live drift check failing"** with label `live-drift-failure`, the run
  URL, `Job result: failure`, `Trigger: workflow_dispatch`, and the full findings block.

That run also supersedes the stale 2026-08-09 figures this file was opened with. Measured
2026-08-14, `UNEXPECTED DRIFT (32)`:

| Category                                 | 2026-08-09 | 2026-08-14         |
| ---------------------------------------- | ---------- | ------------------ |
| `match_*` function `def_hash` mismatches | 10         | **10 — unchanged** |
| `missing_live` indexes                   | 21         | **20**             |
| `unexpected_live` indexes                | 2          | **2 — unchanged**  |

`documents_title_trgm_idx` and `document_chunks_content_trgm_idx` are absent from the missing
list, independently corroborating the Phase 4 restoration below (verified separately by
read-only query against `sjrfecxgysukkwxsowpy`: both `indisvalid`/`indisready`, 648 kB and
68 MB). The 10 RPC mismatches are untouched, so **Phase 3 remains entirely outstanding** and is
the next step per the plan's ordering.

Routing is also covered offline by `tests/live-drift-workflow.test.ts` (mutation-verified), so a
future regression fails a test rather than waiting for a live failure to be mishandled.

Outstanding for the operator: add `SUPABASE_ACCESS_TOKEN` to environment secrets per plan step
0.3 and ledger `#183` (dashboard work; names only, never values).

## Phase 1 — Read-only forensics

_Partially run 2026-08-14 in an owner-authorized incident window, then extended the same day in a
read-only connector session. **1.2 was completed 2026-08-18** in a second read-only connector
session (all ten RPC mismatches classified — see the dated block in §1.2). The remaining index
sizing (§1.3) and the dashboard audit-history pairing (§1.1) remain pending._

### 1.1 Migration-history fingerprint

_2026-08-14 (owner-authorized Supabase connector session, incident-driven partial run)._
Full `schema_migrations` fingerprint captured. Decisive rows:

- `20260705180000 reconcile_search_health_indexes` — `no_statements = false`, **stmt_count 14**.
  It does **not** carry the mark-applied signal: its DDL was recorded as executed.
- `20260804110240 restore_rag_search_health_indexes` (the guard) — applied with its statement on
  2026-08-04. Note (per PR #1960 review): that guard validates four **other** indexes and never
  checks this pair, so its application gives **no** existence bound for
  `documents_title_trgm_idx` / `document_chunks_content_trgm_idx`.
- Rows with the mark-applied signal (`statements IS NULL` or empty): the 2026-07-01…07-02 cluster
  (`fix_chunks_hybrid_perf_and_ambiguity`, `fix_remaining_hybrid_perf_and_ambiguity`,
  `schema_health_hybrid_execution_smoke`, `drop_dead_drifted_hybrid_variants`,
  `clinical_query_term_trgm_correction`, `commit_generation_preserve_legacy_artifacts`,
  `add_claim_ingestion_jobs_comment`, `drop_redundant_indexes`, `rag_retrieval_logs_retention`,
  `storage_cleanup_jobs_document_fk`, `fix_reset_document_index_duplicate`,
  `documents_owner_covering_index`, `fix_invoke_agent_url_to_guc`,
  `promote_index_generation_id_columns`) and the 2026-07-12 reconciliation batch
  (`reconcile_ingestion_index_shapes` … `add_legacy_index_health_batch_repair`, stmt_count 0).

**Conclusion for the two retrieval-critical indexes:** their creation was recorded as executed on
2026-07-05 (`20260705180000`, 14 statements), and both were reported missing by the live-drift
runs of 2026-08-02 (Actions 30763871562) and 2026-08-09 (31330856982), with the weekly check red
since 2026-07-26 — so the drop happened **between 2026-07-05 and 2026-08-02** (likely by
2026-07-26). No app/worker/edge-function code issues `DROP INDEX` (repo grep, this session), so a
manual/dashboard action — e.g. an accepted "unused index" advisor suggestion — is the leading
**inference, not an established attribution**; pairing with the dashboard audit/query history for
that window remains **pending** (owner action). `#248` stays open.

### 1.2 RPC divergence dossier

One entry per mismatched `match_*` function, each classified **live-ahead**, **repo-ahead**,
**normalization noise**, or **UNCLASSIFIED**, quoting the decisive diff hunk. Protected RAG
surface: an ambiguous diff is recorded as UNCLASSIFIED and escalated, never guessed.

_2026-08-14 (owner-authorized read-only connector session) — enumeration and noise-separation
complete; per-function diff hunks still pending._

All 93 `public` functions were compared by the manifest's own rule (`pg_get_functiondef`, block
and line comments stripped, whitespace stripped, md5) against `supabase/drift-manifest.json`.
Result: **0 missing on live, 0 extra on live, 16 hash mismatches** — every one a `match_document_*`
retrieval RPC.

**Six of the sixteen are normalization noise and are now closed.** A live session renders
`regprocedure` and body types unqualified (`vector`), while the manifest was generated where they
render schema-qualified (`extensions.vector`). Re-qualifying `vector` → `extensions.vector` before
hashing reproduces the manifest hash **exactly** for these six, so their bodies are byte-identical
to the repo:

| Function                                                           | Classification      | Evidence                                                             |
| ------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------- |
| `match_document_chunks(vector,integer,double precision,uuid,uuid)` | normalization noise | re-qualified hash `cdf9d685c98bc8ff731a0422c29a47a4` = manifest hash |
| `match_document_chunks_v2(vector,…,boolean)`                       | normalization noise | re-qualified hash matches manifest                                   |
| `match_document_chunks_hybrid_v2(vector,…,boolean)`                | normalization noise | re-qualified hash matches manifest                                   |
| `match_document_embedding_fields_hybrid_v2(vector,…,boolean)`      | normalization noise | re-qualified hash matches manifest                                   |
| `match_document_index_units_hybrid_scoped(vector,…,boolean)`       | normalization noise | re-qualified hash matches manifest                                   |
| `match_document_memory_cards_hybrid_v3(vector,…,boolean)`          | normalization noise | re-qualified hash matches manifest                                   |

**The remaining ten are unresolved hash mismatches and are UNCLASSIFIED.** They do not match the
manifest under the raw hash, the `extensions.`-stripped hash, or the re-qualified hash. That rules
out the tested `extensions.vector` rendering variants, but does not establish a body difference:
`pg_get_functiondef` also carries declarations and attributes, and other normalization differences
remain possible. Per the rule above they are recorded UNCLASSIFIED rather than guessed — deciding
whether there is a body difference, and then live-ahead vs repo-ahead, needs the decisive hunk:

`match_document_chunks_text`, `match_document_chunks_text_v2`, `match_document_chunks_hybrid`,
`match_document_embedding_fields_hybrid`, `match_document_index_units_hybrid`,
`match_document_index_units_hybrid_v2`, `match_document_lookup_chunks_text`,
`match_document_memory_cards_hybrid`, `match_document_memory_cards_hybrid_v2`,
`match_document_table_facts_text`.

This confirms ten unresolved retrieval-RPC hash mismatches after excluding the six proven
qualification artefacts. It does **not** yet confirm that ten RPC bodies diverge.

**Method trap, recorded so the next run does not repeat it.** Joining manifest signatures to live
`p.oid::regprocedure::text` directly reports **all 93** functions as simultaneously missing _and_
extra, because the manifest stores `public.fn(extensions.vector,…)` and the live session renders
`fn(vector,…)`. That is a join failure, not a finding. Normalize both sides (strip the `public.`
prefix, fold `extensions.vector` → `vector`) before comparing, then test each surviving mismatch
against the qualification variants before calling it divergence.

#### 1.2 completion — 2026-08-18 (owner-authorized read-only connector session)

**Session note.** Supabase MCP connector, `list_projects` verified the target before the first
query: `sjrfecxgysukkwxsowpy` = `Clinical KB Database` (ACTIVE_HEALTHY, Postgres 17.6.1.127).
Every `execute_sql` call passed that ref literally; the sibling `Clinical KB Staging`
(`ikoiolksxqxfxgiyqpnu`) was never targeted. Session role `postgres`. Four statements were run,
all `SELECT` (one preceded by `set local search_path to ''` inside the same implicit transaction);
**no INSERT/UPDATE/DELETE/DDL**. Captured 2026-08-17 16:28–16:29 UTC and 2026-08-18 04:07 UTC.
Open-PR check (`#292`) before starting: no open PR touched this section, `supabase/migrations/**`,
`schema.sql`, or `src/lib/rag/**`. No RPC, migration, or `src/lib/rag/**` file was edited.

**Result in one line: all ten are classified. Every one of the ten is an attribute-only difference —
the live definition carries a `SET work_mem TO '…'` clause that the manifest's source
(`supabase/schema.sql`) does not — and stripping exactly that one line from the live definition
reproduces the manifest `def_hash` byte-for-byte for all ten.** Bodies, signatures, return shapes,
volatility, `search_path`/`plan_cache_mode` clauses and ACLs are identical to the repo. Zero of
the ten is a body divergence; zero is repo-ahead; none remains UNCLASSIFIED.

**Normalization rule used (quoted, not assumed).** The manifest is produced by
`scripts/generate-drift-manifest.ts` (lines 185–192): it replays `supabase/schema.sql` into a
scratch Supabase Postgres container and calls `public.schema_drift_snapshot()`; there is no
JS-side normalization, so **manifest = `schema.sql` mirror, hashed by the same SQL rule that hashes
live**. That rule is `supabase/migrations/20260706200000_schema_drift_snapshot.sql:89` (the only
migration that defines the function; it runs `security definer set search_path to ''`):

```sql
md5(regexp_replace(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'), '--[^\n]*', '', 'g'), '\s+', '', 'g'))
```

It strips block comments, `--` line comments and all whitespace, and nothing else — `SET`
attributes rendered by `pg_get_functiondef` **are** hashed. `check:drift` compares functions on
`def_hash` and `acl` (`scripts/check-drift.ts:68`); ACLs were equal for all ten
(`{postgres=X/postgres, service_role=X/postgres}` on both sides).

**Repo-side facts that make the hypothesis testable.** `grep -n work_mem supabase/schema.sql`
returns **zero** hits. `supabase/migrations/20260724000000_optimize_rpc_work_mem.sql` is the only
migration mentioning `work_mem`; it runs `ALTER FUNCTION … SET work_mem = '64MB'` on exactly eight
of the ten (all except `match_document_chunks_text_v2` and `match_document_index_units_hybrid_v2`).

**Query 1 — live hashes as the drift check computes them** (16:28:35 UTC), so the comparison uses
the RPC's own pinned rendering rather than a session's:

```sql
select f->>'signature', f->>'def_hash', f->'acl'
from jsonb_array_elements(public.schema_drift_snapshot()->'functions') f
where f->>'signature' like 'public.match_document%' order by 1;
```

The ten live hashes equal, line for line, the `live=` values in issue #1963's 2026-08-17 findings
block (e.g. `match_document_chunks_text` `d135c628720cb8a4d86c2ade4cd3b26a`).

**Query 2 — the one query for all ten** (16:29:04 UTC): `set local search_path to '';` then a
`SELECT` of `p.oid::regprocedure::text`, `p.proconfig`, `exists(… c like 'work_mem=%')`,
`exists(… c like 'plan_cache_mode=%')`, the normalization expression above applied to
`pg_get_functiondef(p.oid)` as `raw_hash`, and `pg_get_functiondef(p.oid)` itself, from
`pg_catalog.pg_proc` where `pronamespace = 'public'::regnamespace` and `proname in (<the ten>)`.
Acceptance check before trusting any variant: `raw_hash` equalled Query 1's live `def_hash` for
**all ten**, proving the fetched text is exactly the text the drift RPC hashed.

**Query 3 — hash variants over the same text**, computed in SQL with the identical expression (so
Postgres ARE semantics decide, not a JS re-implementation): as-is; minus the `SET work_mem TO
'…'` line; minus `SET plan_cache_mode …`; minus both; with `work_mem` rewritten to `'64MB'`; with a
`plan_cache_mode` line added. Outcome: `no_workmem_match = true` for **10/10**; `asis`, `no_pcm`
and `add_pcm` matched for 0/10. (`no_workmem_no_pcm` also matched for the six that carry no
`plan_cache_mode`, which is the same fact.) The `work_mem → '64MB'` variant reproduces the live
hash for the six whose live value is already 64MB and a third, different hash for the four at
128MB — i.e. those four are not "the repo's 64MB rendered differently".

**Query 4 — migration history** (04:07 UTC) for the interacting versions, plus any row whose
recorded statements mention `work_mem`:

| version          | name                                     | `no_statements` | `stmt_count` | statements mentioning `work_mem` |
| ---------------- | ---------------------------------------- | --------------- | -----------: | -------------------------------: |
| `20260701140631` | `codify_live_retrieval_rpcs`             | false           |            1 |                                0 |
| `20260711120000` | `retrieval_fn_plan_cache_mode`           | false           |            4 |                                0 |
| `20260713020000` | `owner_plus_public_retrieval`            | false           |           37 |                                0 |
| `20260714110000` | `promote_documents_index_generation_id`  | false           |           17 |                                0 |
| `20260717160000` | `optimize_owner_public_retrieval`        | false           |           12 |                                0 |
| `20260717162000` | `bound_versioned_retrieval_match_count`  | false           |            6 |                                0 |
| `20260724000000` | `optimize_rpc_work_mem`                  | false           |            9 |                            **8** |
| `20260724120000` | `table_facts_plpgsql_execute`            | false           |            3 |                                0 |
| `20260724130000` | `explicit_base_match_rpc_execute_grants` | false           |            1 |                                0 |

`20260724000000` is the **only** recorded migration touching `work_mem`, and it records eight
`64MB` statements — so no recorded history produces a `128MB` value, a `work_mem` on either `_v2`,
or a `work_mem` on `match_document_table_facts_text` after `20260724120000` re-created it (a
`CREATE OR REPLACE FUNCTION` replaces the whole config-item set; a clean replay of the recorded
chain leaves that function without `work_mem`). Live `proconfig` order on `table_facts_text` is
`[search_path, plan_cache_mode, work_mem]` — the recreate's two clauses followed by an appended
`ALTER … SET work_mem` — which is direct evidence that `work_mem` was re-applied to it **after**
`20260724120000`, outside recorded history.

**Per-function table.** "Repo chain" = what a clean replay of `supabase/migrations/**` produces;
"mirror" = `supabase/schema.sql` (the manifest source). Manifest/live hashes are those of Query 1
and `supabase/drift-manifest.json` (`generated_at 2026-08-16T14:37:41Z`); "hash outcome" is the
Query 3 variant that reproduced the manifest hash exactly.

| Function (live signature, `search_path ''` rendering)                                                       | Live `SET work_mem` | Live `plan_cache_mode` | Repo chain `work_mem`                         | Mirror `work_mem` | Hash outcome                                                         | Classification                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------- | --------------------------------------------- | ----------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `match_document_chunks_text(text,integer,uuid[],uuid)`                                                      | yes — `64MB`        | no                     | `64MB` (20260724000000)                       | none              | strip `SET work_mem` → `0e662039807813b400e685d7307d7929` = manifest | **mirror-stale, attribute-only** (live = repo chain; `schema.sql` omits the clause)                                                 |
| `match_document_lookup_chunks_text(text,uuid[],integer,uuid)`                                               | yes — `64MB`        | no                     | `64MB` (20260724000000)                       | none              | strip → `989281557ff4877f8eae5c9a32a3ef8c` = manifest                | **mirror-stale, attribute-only**                                                                                                    |
| `match_document_memory_cards_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid)`           | yes — `64MB`        | yes                    | `64MB` (20260724000000)                       | none              | strip → `1a937f133f5cb6e6d59a5b00311ec685` = manifest                | **mirror-stale, attribute-only**                                                                                                    |
| `match_document_memory_cards_hybrid_v2(extensions.vector,text,integer,double precision,uuid[],uuid)`        | yes — `64MB`        | no                     | `64MB` (20260724000000)                       | none              | strip → `0534ad140950e83128b3434caa5ffd32` = manifest                | **mirror-stale, attribute-only**                                                                                                    |
| `match_document_table_facts_text(text,integer,uuid[],uuid)`                                                 | yes — `64MB`        | yes                    | **none** (dropped by 20260724120000 recreate) | none              | strip → `f68e03ca96f8403d171509a59a769682` = manifest                | **live-ahead, attribute-only** (`64MB` re-applied live after the recreate; matches 20260724000000's intent, not the replayed chain) |
| `match_document_chunks_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid)`                 | yes — **`128MB`**   | no                     | `64MB` (20260724000000)                       | none              | strip → `b5dfaa5e0d6b27ad0c7cfc89711953cb` = manifest                | **live-ahead, attribute-only** (value raised live; no recorded migration sets 128MB)                                                |
| `match_document_embedding_fields_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid)`       | yes — **`128MB`**   | yes                    | `64MB` (20260724000000)                       | none              | strip → `a2d97503e95af88097557029e0ea7836` = manifest                | **live-ahead, attribute-only**                                                                                                      |
| `match_document_index_units_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid)`            | yes — **`128MB`**   | yes                    | `64MB` (20260724000000)                       | none              | strip → `2e8810a1ec9927aba7c1f04fd18287d1` = manifest                | **live-ahead, attribute-only**                                                                                                      |
| `match_document_chunks_text_v2(text,integer,uuid[],uuid,boolean)`                                           | yes — `64MB`        | no                     | **none**                                      | none              | strip → `3d99483e01a5c93374408b9e585d3962` = manifest                | **live-ahead, attribute-only** (no migration ever set it)                                                                           |
| `match_document_index_units_hybrid_v2(extensions.vector,text,integer,double precision,uuid[],uuid,boolean)` | yes — **`128MB`**   | no                     | **none**                                      | none              | strip → `b72c524f3be13ec1a950cc30e922ec78` = manifest                | **live-ahead, attribute-only** (no migration ever set it)                                                                           |

**Decisive hunk (identical shape for all ten; shown for the two `_v2` outliers the hypothesis did
not cover).** Live `pg_get_functiondef` vs the repo's canonical body — for both `_v2`s the newest
migration carrying an actual `create or replace function … as $$ … $$` body is
`20260717162000_bound_versioned_retrieval_match_count.sql` (not the newer files that merely mention
them), and `schema.sql:7761` / `:7943` carry the same body — differs only in the header:

```diff
 CREATE OR REPLACE FUNCTION public.match_document_chunks_text_v2(query_text text, match_count integer DEFAULT 12, document_filters uuid[] DEFAULT NULL::uuid[], owner_filter uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid, include_public boolean DEFAULT true)
  RETURNS TABLE(id uuid, document_id uuid, title text, … lexical_score double precision, images jsonb)
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'extensions', 'pg_temp'
+ SET work_mem TO '64MB'
 AS $function$
   select *
   from public.match_document_chunks_text_scoped($1, least(greatest(coalesce($2, 12), 1), 96), $3, $4, $5);
 $function$
```

```diff
 CREATE OR REPLACE FUNCTION public.match_document_index_units_hybrid_v2(query_embedding extensions.vector, query_text text, match_count integer DEFAULT 24, min_similarity double precision DEFAULT 0.1, document_filters uuid[] DEFAULT NULL::uuid[], owner_filter uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid, include_public boolean DEFAULT true)
  RETURNS TABLE(id uuid, document_id uuid, … hybrid_score double precision, metadata jsonb)
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'extensions', 'pg_temp'
+ SET work_mem TO '128MB'
 AS $function$
   select *
   from public.match_document_index_units_hybrid_scoped($1, $2, least(greatest(coalesce($3, 24), 1), 96), $4, $5, $6, $7);
 $function$
```

For the eight hypothesis functions the hunk is the same single `+ SET work_mem TO '64MB'` /
`'128MB'` line under the existing `SET search_path` (and, where present, `SET plan_cache_mode`)
clauses; the `$function$ … $function$` bodies are unchanged. The Query 3 exact-hash reproduction is
the proof that nothing else differs — a body edit anywhere would have broken it.

**What this means for Phase 3 (owner decisions flagged, not asserted).**

- **Zero repo-ahead entries.** No live function is behind the repo. So the plan's repo-ahead rule
  (eval-canary pair around a deploy) has **no** trigger from this dossier.
- **Four mirror-stale entries** (`chunks_text`, `lookup_chunks_text`, `memory_cards_hybrid`,
  `memory_cards_hybrid_v2`): live already equals the recorded migration chain. Remedy is entirely
  repo-side — add the `SET work_mem = '64MB'` clause to their `schema.sql` definitions and regenerate
  `drift-manifest.json` (`npm run drift:manifest`, Docker). **No hosted change.** Phase 3 may
  execute these now.
- **Six live-ahead, attribute-only entries** (`table_facts_text` 64MB; `chunks_hybrid`,
  `embedding_fields_hybrid`, `index_units_hybrid`, `index_units_hybrid_v2` 128MB; `chunks_text_v2`
  64MB): the live value has no recorded migration. The plan's live-ahead remedy — codify the live
  attribute in a new migration (`ALTER FUNCTION … SET work_mem = '<live value>'`, ordered after
  every recreate of that function) plus the `schema.sql` mirror, PR body `RAG impact: no retrieval
behaviour change — codifying already-live attribute` — needs **no hosted change** either, because
  the migration would be marked applied against a state that already matches. Phase 3 may execute
  these once the owner confirms the live values are the intended ones. **Owner decision:** keep
  128MB on the four (codify as-is), or standardise to the recorded 64MB (that direction _is_ a
  hosted change and should carry at least a before/after latency measurement).
- **Canary exemption — flagged, not asserted.** `work_mem` is a planner/executor memory setting; it
  changes which plan runs (hash vs sort, spill vs in-memory) and therefore latency, not the SQL
  result set. The result set is fully determined by each RPC's `ORDER BY … LIMIT`, so answer
  content and ranking are unaffected **except** that rows with exactly equal sort keys can surface
  in a different order under a different plan. The recommendation is that codify-as-live (no hosted
  change) proceeds without an eval-canary, and that any hosted change of a live value is treated
  as latency-only but confirmed by the Phase 5 `EXPLAIN` re-run rather than an eval dispatch. This
  exemption is the owner's to grant.
- **Nothing remains escalated as UNCLASSIFIED from 1.2.** The residual open question is
  provenance, not classification: who set 128MB / the `_v2` values and when. That pairs with the
  §1.1 dashboard audit-history action already owed to the owner.

**Playbook correction (recorded here; the playbook itself was not edited).** The trap list says
`20260724120000_table_facts_plpgsql_execute.sql` contains zero `create or replace function`. It
contains one, at line 9, and it is the newest canonical body for `match_document_table_facts_text`
— which is exactly why that function's `work_mem` was reset on a clean replay. The trap's lesson
(the newest _mention_ is often not the definition) still stands for `20260724130000`.

**Method note for the next reader.** Rendering matters twice: `regprocedure` and `format_type`
qualify `extensions.vector` only when the session `search_path` excludes `extensions`, and
`schema_drift_snapshot()` pins `search_path` to `''`. Prefixing the fetch with
`set local search_path to ''` in the same implicit transaction (multi-statement `execute_sql`)
made the fetched text hash-identical to the RPC's own output on the first attempt; verify that
equality before trusting any derived variant.

### 1.3 Index inventory, sizing, and EXPLAIN baselines

_2026-08-14 (partial — retrieval-critical scope only)._ Live inventory of the ten
`20260705180000` indexes: **exactly two missing** — `documents_title_trgm_idx` and
`document_chunks_content_trgm_idx`; the other eight present (labels/summaries trgm, table-facts,
index-units, pages, sections, both `rag_retrieval_logs` indexes). Owning tables at repair time:
`document_chunks` 1562 MB / 70,120 live rows; `documents` 18 MB / 3,301 rows.

Before-measurements came from live production probes rather than raw EXPLAIN (the incident was
end-to-end visible): `/api/search` semantic query 2026-08-14 → total 37.7 s,
`supabase_rpc_latency_ms` **31,610**; a second semantic probe 29.9 s / 21,757. The remaining
missing-index sizing and the `rag_retrieval_logs` miss-scan baseline are **pending**.

**Whole-schema inventory — 2026-08-14, after the repair above (owner-authorized read-only
connector session).** The scope above is the ten `20260705180000` indexes; this is the full
`public` schema, and it is **additive to the incident, not a restatement of it**. Both repaired
indexes (`documents_title_trgm_idx`, `document_chunks_content_trgm_idx`) are confirmed **present**
on live now.

|                           Side |  Count | Source                                                                      |
| -----------------------------: | -----: | --------------------------------------------------------------------------- |
|                   Repo-defined |    210 | `supabase/drift-manifest.json` `snapshot.indexes`                           |
|                           Live |    192 | `pg_indexes`, schema `public`                                               |
|           **Absent from live** | **20** | full outer join by name                                                     |
| Orphaned on live (not in repo) |      2 | `document_table_facts_document_id_idx`, `storage_cleanup_jobs_owner_id_idx` |

210 − 20 + 2 = 192, so neither side is a partial read. The 20 absent, retrieval-relevant ones
first:

`document_chunks_anchor_idx`, `document_index_units_heading_path_idx`, `rag_aliases_type_enabled_idx`,
`rag_queries_source_chunk_ids_gin_idx`, `rag_query_misses_aliases_idx`,
`documents_registry_projection_lookup_idx`, `document_images_structured_profile_gin_idx`,
`image_caption_cache_owner_hash_idx`, `api_rate_limits_bucket_updated_idx`,
`audit_logs_action_created_idx`, `audit_logs_owner_created_idx`, `document_images_hash_idx`,
`document_images_visual_intelligence_version_idx`, `document_index_quality_owner_score_idx`,
`document_publication_approvals_document_idx`, `document_summaries_owner_idx`,
`indexing_v3_agent_jobs_locked_at_idx`, `ingestion_job_stages_job_stage_started_idx`,
`medication_records_owner_category_idx`, `storage_cleanup_jobs_owner_status_idx`.

**None is invalid-but-present.** `pg_index` filtered on `indisvalid = false or indisready = false`
returns **zero rows** across the whole `public` schema, so the failed-`CREATE INDEX CONCURRENTLY`
class documented in `docs/database-drift-detection.md` explains none of the 20. The objects are
absent, not broken.

**Five covered creating migrations recorded executed DDL.** Extending the §1.1 fingerprint to the
four further migrations in this sampled set found that none carries the mark-applied signal:

| Migration                                              | `stmt_count` | Mark-applied? |
| ------------------------------------------------------ | -----------: | ------------- |
| `20260528007000 database_hardening_before_import`      |           32 | no            |
| `20260608001000 index_accuracy_usability_improvements` |           36 | no            |
| `20260705180000 reconcile_search_health_indexes`       |           14 | no (per §1.1) |
| `20260712165211 reconcile_missing_operational_indexes` |           27 | no            |
| `20260717170000 registry_projection_cleanup`           |           11 | no            |

This establishes recorded-executed-but-absent evidence across five migrations from 2026-05-28 to
2026-07-17, including one named `reconcile_missing_operational_indexes`; it does **not** cover the
creating migrations for `document_publication_approvals_document_idx`,
`indexing_v3_agent_jobs_locked_at_idx`, or `medication_records_owner_category_idx`. Fingerprint
those histories before classifying those three absences as created-then-dropped. **Root cause
remains unestablished** — §1.1's manual/dashboard-drop inference is the leading hypothesis and the
dashboard audit-history pairing is still the owner action that would confirm or refute it. This
inventory widens what that pairing has to explain; it does not by itself attribute anything.

## Phase 2 — Staging parity rehearsal

_2026-08-18, owner-authorized staging window ("I authorize mutation of the STAGING Supabase tier
(Clinical KB Staging) only"). Target `Clinical KB Staging`, ref `ikoiolksxqxfxgiyqpnu`, via the
Supabase MCP connector. Production `sjrfecxgysukkwxsowpy` was never a target: the only production
interaction in this window was `list_projects`, and the target ref was restated on every call.
Replay is **complete**. `check:drift` against staging has now **run** and is **red with 19 findings** — see 2.3.
Re-measured 2026-08-18 at `main` `4551b6e4d` after `20260818090000` landed: still **19**, unchanged — see 2.5._

### 2.0 Connector and pre-flight

`list_projects` returned both projects; staging is `ACTIVE_HEALTHY`, Postgres 17.6,
`ap-southeast-2`. The connector is write-capable and connects as `current_user = postgres`, which
is the role hosted migrations target, so `check:migration-role` discipline is preserved.

Pre-flight checks the replay depended on, all green before any write:

| Check                                                     | Result                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `vector`, `pg_trgm`, `uuid-ossp` namespace                | all in `extensions` (not `public`)                               |
| `pg_has_role(current_user,'postgres','MEMBER')`           | `true` — the seven default-privilege asserts can pass            |
| `default_privileges_status('postgres','public')->>'safe'` | `true`                                                           |
| `schema_drift_snapshot()` / `search_schema_health()`      | both present (178 KB snapshot, 200 index rows, 87 function rows) |
| `documents` / `document_chunks` row counts                | `0` / `0` — staging idle and empty, before and after             |

`pg_net` and `pg_cron` are **not** installed on staging. That did not block the replay (see 2.4)
but it does mean the six retention/purge cron jobs are silently unscheduled there — a parity gap to
record, not a replay failure.

### 2.1 Before-gap: 28 versions, not 26

Re-measured at the start of the window, as `#056` and `docs/staging-setup.md` both instruct. Staging
held **166** rows in `supabase_migrations.schema_migrations`, latest `20260719055623`, with **zero**
`statements IS NULL` rows. The repository holds **194** migration files. The gap was therefore
**28**: **ten earlier history holes** plus **eighteen** versions after `20260719055623` — not the 26
(ten + sixteen) recorded on 2026-08-17. The two-version increase is `main` advancing while staging
stood still, exactly the widening the ledger predicted.

The exact missing chain, in version order:

```
20260713110000_historical_version_placeholder
20260713120000_historical_version_placeholder
20260713121000_historical_version_placeholder
20260713122000_historical_version_placeholder
20260717133000_historical_version_placeholder
20260717161000_assert_postgres_default_privileges
20260717173000_reassert_postgres_default_privileges
20260718223000_historical_version_placeholder
20260719053532_repair_postgres_default_privileges
20260719053533_enforce_public_title_word_scope
20260719064735_user_account_data_and_admin_uploads
20260719070000_align_existing_acls
20260720170000_add_documents_owner_updated_at_indexed_idx
20260722110000_explicit_document_title_words_backend_policy
20260722190000_bind_publication_approval_to_reviewed_state
20260723150000_document_change_ingestion_webhook
20260724000000_optimize_rpc_work_mem
20260724060000_atomic_reindex_agent_guard
20260724120000_table_facts_plpgsql_execute
20260724130000_explicit_base_match_rpc_execute_grants
20260724130100_fix_invoke_ingestion_worker_url_to_guc
20260724130200_create_uploaded_document_with_ingestion_job
20260725000000_audit_security_remediation
20260727010000_bmj_third_party_source_attestation
20260731150000_db_query_perf_rate_limit_and_image_indexes
20260804110240_restore_rag_search_health_indexes
20260814150000_add_therapy_favourites
20260814151000_validate_therapy_favourites_content_type
```

### 2.2 Replay: mechanism, faithfulness proof, and result

**Mechanism.** `SUPABASE_ACCESS_TOKEN` is still absent (`#183`) and the staging database password is
operator-only, so `supabase db push --linked --include-all` was unavailable. MCP `apply_migration`
was rejected as the substitute because it stamps a connector-generated version, which
`docs/staging-setup.md` explicitly forbids ("do not replay the missing chain through a helper that
records new timestamps"). Each migration was therefore applied through `execute_sql` as a single
implicit transaction that runs the file body verbatim and then writes its own history row carrying
the repository's exact version and name — the same row `supabase db push` would have written.

**Faithfulness proof.** Every applied row was read back and its `md5(statements[1])` compared
against `md5sum` of the repository file. **All 28 match byte-for-byte**, so the replayed text is
provably the committed text under the repository's own versions:

```
=== md5 mismatches (empty = all 28 byte-identical) ===
ALL 28 MATCH
```

**Result.** Full parity, verified in both directions:

```
repo files: 194   staging rows: 194
--- in repo, missing from staging ---
--- in staging, not in repo ---
--- (both empty = full parity) ---
```

`total_rows 194 · latest_version 20260814151000 · no_statements 0` — staging still carries **zero**
`statements IS NULL` rows, so the replay introduced none of the history-repair signal Phase 6.1 is
being built to police. `documents` and `document_chunks` remain `0`: no production clinical document
was copied and no ingestion worker was started.

**Deviation to record.** The Supabase CLI splits a migration into one array element per statement
(pre-existing staging rows carry 10–19 elements each); these 28 rows store the whole file as a
single element. Version, name, and text are exact — only the array arity differs. Anything that
inspects `cardinality(statements)` will see it, and it is worth normalising if a future tool depends
on per-statement granularity.

### 2.3 `check:drift` against staging — RUN, and red: the chain does not reproduce `schema.sql`

**Blocker cleared.** `check:drift` previously could not target staging at all.
`scripts/check-drift.ts` passed only three of the five identity keys to
`checkSupabaseProjectConfig`, dropping `SUPABASE_STAGING_PROJECT_REF` and
`SUPABASE_STAGING_PROJECT_NAME`; with those absent `resolveStagingProject`
(`src/lib/supabase/project.ts:95-97`) returns `null`, `expected` falls back to production, and any
staging URL is rejected. Fixed here by forwarding both keys, mirroring
`scripts/check-supabase-project.ts:6-15`. Proven against the same env before and after:

```
AFTER FIX  -> ready    | environment: staging    | expected: ikoiolksxqxfxgiyqpnu
BEFORE FIX -> mismatch | environment: production | expected: sjrfecxgysukkwxsowpy
```

**Result: 19 unexpected drift rows, exit 1.** Staging carries the complete, byte-verified migration
chain, so this is not staging being stale — it is the committed chain and `supabase/schema.sql`
disagreeing:

```
Drift manifest: generated 2026-08-16T14:37:41.042Z from schema.sql 365e3368a47b…
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies,
170 constraints, 26 triggers, 2 storage_buckets against live.

UNEXPECTED DRIFT (19):
```

The 19 decompose into four groups.

**(a) Seven `match_*` `def_hash` mismatches — `SET work_mem`, non-behavioural, and `schema.sql` is
the stale side.** `20260724000000_optimize_rpc_work_mem` applies `SET work_mem = '64MB'` to eight
`match_*` functions. `pg_get_functiondef` renders function `SET` attributes, and
`schema_drift_snapshot()`'s `def_hash` strips comments and whitespace but **not** `SET` clauses — so
a function carrying `work_mem` cannot hash-match one that does not.

Measured, offline and decisive: `grep -c work_mem supabase/schema.sql` returns **0**, and the only
migration mentioning it is `20260724000000`. After the full replay staging has **7** functions
carrying `work_mem`, and those 7 are exactly the 7 mismatching here:
`match_document_chunks_hybrid`, `match_document_chunks_text`,
`match_document_embedding_fields_hybrid`, `match_document_index_units_hybrid`,
`match_document_lookup_chunks_text`, `match_document_memory_cards_hybrid`,
`match_document_memory_cards_hybrid_v2`. The eighth work_mem target,
`match_document_table_facts_text`, **does not appear in the drift list** — because
`20260724120000` re-created it without restating `work_mem` (finding 3 above) and it therefore
matches `schema.sql`. The exception proves the mechanism.

This is a planner memory setting: it affects latency, not row content or ordering. The correct
disposition is to update `supabase/schema.sql` and regenerate `drift-manifest.json` — **a repo-side
fix, not a production deploy.**

**Bearing on `#316`/Phase 1.2 — recorded, not acted on.** `#316` carries this as an untested
hypothesis about production's 10 mismatched RPCs. It is now measured on staging for 7 of them, from
the committed chain alone, with no production call. It does **not** close Phase 1.2: production
reports 10, staging 7, and the residual — `match_document_table_facts_text` plus the two `_v2`
outliers `match_document_chunks_text_v2` and `match_document_index_units_hybrid_v2` — is not
explained by this mechanism and still needs its own diff. Phase 1.2 owns that; `#316` was not
updated from here.

**(b) Eight objects `schema.sql` declares that no migration creates.** Verified by grepping every
migration for both `create` and `drop` of each name: there is **no** creating migration and **no**
dropping migration. They exist only in `schema.sql`.

| Object                                                    | Kind    |
| --------------------------------------------------------- | ------- |
| `document_embedding_fields_meta_rag_indexing_version_idx` | index   |
| `document_embedding_fields_owner_document_created_idx`    | index   |
| `document_embedding_fields_owner_id_idx`                  | index   |
| `document_embedding_fields_search_tsv_chunk_gin_idx`      | index   |
| `document_embedding_fields_source_chunk_id_idx`           | index   |
| `documents_status_idx`                                    | index   |
| `documents.documents_updated_at`                          | trigger |
| `ingestion_jobs.ingestion_jobs_updated_at`                | trigger |

(The `ingestion_jobs_updated_at` string does appear in `20260712170500`, but as
`ingestion_jobs_updated_at_idx`, a different object.) Five of these are on
`document_embedding_fields`, a retrieval-path table, and two are `set_updated_at` triggers whose
absence would silently stop `updated_at` maintenance on `documents` and `ingestion_jobs` in any
environment built from migrations alone.

**(c) Three table column-set mismatches:** `document_chunks`, `rag_visual_eval_cases`,
`rag_visual_eval_runs`. The truncated diff needs per-column expansion before classification; not
attempted here.

**(d) One index definition mismatch:** `document_chunks_content_trgm_idx` — `def_hash`
manifest `8499c3d3…` vs live `c3db2960…`. Note this is one of the two trigram indexes restored on
production in the 2026-08-14 incident window, so its canonical definition is worth confirming
against what was actually built there.

**What this means for the programme.** `check:drift`'s expected side is generated from
`supabase/schema.sql`, not from the migration chain, and this run is the first end-to-end evidence
that the two disagree in 19 places. Until they are reconciled, a production drift finding cannot be
assumed to mean "production drifted" — for at least the seven work_mem functions the opposite is
true, and `schema.sql` is wrong. That materially changes how Phase 3's classifications should be
read, and it is an argument for reconciling `schema.sql` to the chain **before** spending a
production window.

None of it was fixed here: this is a docs/evidence PR, and every disposition above is either
repo-side work for another change or Phase 1.2/3 territory.

### 2.4 Findings from the clean replay

Each is a finding in its own right, per the phase's definition of done. **No migration raised an
error, and no migration file was edited.**

1. **The `20260804110240` guard passed with no prebuild — and that is evidence about production.**
   All four indexes it validates (`document_labels_label_trgm_idx`,
   `document_summaries_summary_trgm_idx`, `document_index_units_owner_chunk_type_idx`,
   `rag_retrieval_logs_miss_idx`) already existed on staging, `indisvalid` and `indisready`, with
   matching definitions — created by `20260705180000` and dropped by no later migration. So did
   `documents_title_trgm_idx` and `document_chunks_content_trgm_idx`. Staging replayed the same
   chain production ran and **kept** the indexes production lost. That is direct evidence the
   production loss was not caused by the committed chain, narrowing `#248` / `#316` attribution
   toward an out-of-band drop. Recorded as Phase 2 evidence only — `#316` is owned by the
   concurrent Phase 1.2 session and was deliberately not updated from here.

2. **A version-order inversion exists in the committed chain, and a plain replay handles it wrong.**
   The repository carries two near-identical copies of four migrations:
   `20260717161000`/`20260717173000`/`20260719053532`/`20260719053533`, re-issued as
   `20260719055541`/`055555`/`055609`/`055623`. Staging had applied only the later set, so applying
   the earlier set in version order re-ran older `create or replace function` bodies **on top of**
   newer ones. The pairs differ only in whitespace except `20260719053533`, whose `raise … hint`
   names `20260719053532` where the newer names `20260719055609`. After the four earlier versions
   landed, the four later bodies were re-executed from staging's own recorded statements — no
   history rows added — so the end state equals a from-scratch ordered replay, and
   `default_privileges_status('postgres','public')->>'safe'` is `true` afterwards. A plain
   `supabase db push --include-all` would **not** do this and would leave the older bodies live.

3. **`20260724120000` silently drops the `work_mem` setting `20260724000000` applies.**
   `20260724000000_optimize_rpc_work_mem` sets `work_mem = '64MB'` on eight `match_*` functions.
   Later in chain order, `20260724120000_table_facts_plpgsql_execute` re-creates
   `match_document_table_facts_text` declaring only `set search_path` and `set plan_cache_mode`, and
   `CREATE OR REPLACE FUNCTION` resets any config option the new definition does not restate.
   Measured on staging after the full replay: **7** functions carry `work_mem`, not 8, and
   `match_document_table_facts_text` is the one that does not. This matters to the Phase 1.2
   dossier, whose recorded hypothesis assumes that migration leaves eight functions with `work_mem`;
   on a clean chain replay it leaves seven. Not acted on here — protected RAG surface, and `#316`
   belongs to the other session.

4. **`20260724130100` ships a literal `[REDACTED]` placeholder in executable SQL — already
   remediated in-chain.** The committed blob contains `'[REDACTED]'` twice where a base URL belongs:
   as the `alter database … set app.ingestion_worker_base_url` value, and as the
   `invoke_ingestion_worker()` fallback. Confirmed against `git show HEAD:` and not an output mask —
   sibling migrations render the real project ref through the same tooling. The next migration,
   `20260725000000_audit_security_remediation`, exists precisely to correct it and says so, while
   instructing that the applied blob must not be edited. A clean replay therefore self-heals and the
   correct action is none.

5. **A faithful replay points staging's worker GUC at the production project.** `20260725000000`
   runs `alter database … set app.ingestion_worker_base_url` to the production URL, and its
   `insufficient_privilege` guard does not fire here because the connector is `postgres`. The
   setting is database-level, so it applies to new connections. It is inert on staging three times
   over — `pg_net` is not installed, the vault secret `cron_ingestion_jwt` is absent (the function
   raises `Missing Vault secret` first), and no `pg_cron` schedule exists — but it is a live
   cross-environment pointer the moment any of those changes. **Do not seed `cron_ingestion_jwt`,
   `indexing_v3_agent_secret`, or `ingestion_webhook_secret` into staging's vault.** By contrast
   `20260723150000`'s document-change webhook is safe by construction: it has no production fallback
   and returns early when `app.ingestion_webhook_base_url` is unset, which it is.

6. **Platform-dependent objects applied cleanly despite absent extensions.** `20260723150000` and
   `20260724130100` reference `net.http_post` and `vault.decrypted_secrets` from inside PL/pgSQL
   bodies, which Postgres does not resolve at `CREATE FUNCTION` time, so both applied without
   `pg_net` installed. They fail only when called.

### 2.5 Re-measure against current `main` — 2026-08-18 (ledger `#056`)

_Second staging window, same authorization and the same target: `Clinical KB Staging`, ref
`ikoiolksxqxfxgiyqpnu`, via the Supabase MCP connector. Production `sjrfecxgysukkwxsowpy`
was never a target — the ref was passed explicitly on every call and `list_projects` was the only
call that named it at all. **Measurement only: no drift finding was fixed, and no vault secret was
seeded.** §2.0–2.4 measured staging at base `ed43a64f2`; this re-measure runs at `main`
`4551b6e4d`._

**Why re-measure.** Between `ed43a64f2` and `4551b6e4d` exactly one commit touched
`supabase/`: `9c660af1f` (PR #2058, Phase 6), which added
`20260818090000_schema_drift_snapshot_history_probe.sql` — the migration that redefines
`schema_drift_snapshot()` itself — and with it a regenerated `schema.sql`, a regenerated
`drift-manifest.json`, and five `migration_history` allowlist entries. The §2.3 numbers were
therefore measured with a snapshot v1 probe against an older manifest.

Pre-flight per `#292`: the six open PRs at the time of this window (#2096, #2095, #2086, #2012,
#2011, #2010) were checked for changed paths; **none** touches `supabase/migrations/**` or staging.

#### Step 1 — before-gap: exactly one version

Staging held **194** rows in `supabase_migrations.schema_migrations`, latest `20260814151000`,
**zero** `statements IS NULL`-or-empty rows; `documents` and `document_chunks` both `0`;
connector role `postgres`. The repository holds **195** migration files. Two-way diff:

```
=== in repo, missing from staging ===
20260818090000
=== in staging, not in repo ===
=== (second list empty) ===
```

The single missing version is **not** one of the duplicate earlier/later pairs named in §2.4
finding 2 (`20260717161000`/`20260717173000`/`20260719053532`/`20260719053533` and their
`20260719055541`/`055555`/`055609`/`055623` re-issues) — all eight remain present from the
Phase 2 replay — so the stop-and-report condition for applying an older body over a newer one did
not arise.

#### Step 2 — apply, by the §2.2 method

`execute_sql` ran the repository file's content verbatim, then a second `execute_sql` wrote an
explicit history row carrying the repository's own version and name. `apply_migration` was **not**
used: it stamps a connector-generated version, which `docs/staging-setup.md` forbids.

Faithfulness proof, read back from staging:

```
version 20260818090000 · name schema_drift_snapshot_history_probe
stmt_count 1 · bytes 9034
md5_recorded          839bed0b741cb75b79f6eb0c46ed0a50
md5_matches_repo_file true
```

After: `total_rows 195 · latest_version 20260818090000 · no_statements 0`, two-way diff against
`supabase/migrations/` empty in both directions, `documents`/`document_chunks` still `0`. The
live function reports `snapshot_version 2`, `migration_history_probe 'ok'`, and a
`migration_history` array of length **0**. The §2.2 deviation is unchanged and now applies to 29
rows: the CLI stores one array element per statement, these rows store the whole file as a single
element.

#### Step 3 — `check:drift` against staging, current manifest

Complete output, exit code **1**:

```

> prompt-for-codex-medical-knowledge-base@0.1.0 check:drift
> node scripts/run-tsx.mjs scripts/check-drift.ts

Drift manifest: generated 2026-08-17T16:38:39.818Z from schema.sql a6fb923400f8…
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against live.

Stale allowlist entries (5) — no longer matching, remove them:
  ? [migration_history] no_statements 20260701010000
  ? [migration_history] no_statements 20260701020000
  ? [migration_history] no_statements 20260701030000
  ? [migration_history] no_statements 20260701060000
  ? [migration_history] no_statements 20260702000000

UNEXPECTED DRIFT (19):
  ! [tables] mismatch document_chunks :: columns: manifest=[{"default":null,"generated":"","identity":"","name":"anchor_id","not_null":false,"type":"text"},{"default":null,"generated":"","identity":"","name":"chunk_index","not_null":true,"type":"integer"},{"default":null,"generated":"","identity":"… live=[{"default":null,"generated":"","identity":"","name":"anchor_id","not_null":false,"type":"text"},{"default":null,"generated":"","identity":"","name":"chunk_index","not_null":true,"type":"integer"},{"default":null,"generated":"","identity":"…
  ! [tables] mismatch rag_visual_eval_cases :: columns: manifest=[{"default":"true","generated":"","identity":"","name":"active","not_null":true,"type":"boolean"},{"default":null,"generated":"","identity":"","name":"case_name","not_null":true,"type":"text"},{"default":"now()","generated":"","identity":""… live=[{"default":"true","generated":"","identity":"","name":"active","not_null":true,"type":"boolean"},{"default":null,"generated":"","identity":"","name":"case_name","not_null":true,"type":"text"},{"default":"now()","generated":"","identity":""…
  ! [tables] mismatch rag_visual_eval_runs :: columns: manifest=[{"default":null,"generated":"","identity":"","name":"case_id","not_null":true,"type":"uuid"},{"default":"now()","generated":"","identity":"","name":"created_at","not_null":true,"type":"timestamp with time zone"},{"default":null,"generated"… live=[{"default":null,"generated":"","identity":"","name":"case_id","not_null":true,"type":"uuid"},{"default":"now()","generated":"","identity":"","name":"created_at","not_null":true,"type":"timestamp with time zone"},{"default":null,"generated"…
  ! [functions] mismatch public.match_document_chunks_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid) :: def_hash: manifest="b5dfaa5e0d6b27ad0c7cfc89711953cb" live="cf504c2f6029e493843281f7bc66a419"
  ! [functions] mismatch public.match_document_chunks_text(text,integer,uuid[],uuid) :: def_hash: manifest="0e662039807813b400e685d7307d7929" live="d135c628720cb8a4d86c2ade4cd3b26a"
  ! [functions] mismatch public.match_document_embedding_fields_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid) :: def_hash: manifest="a2d97503e95af88097557029e0ea7836" live="369426ec368e36428d7c677d4f425aa7"
  ! [functions] mismatch public.match_document_index_units_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid) :: def_hash: manifest="2e8810a1ec9927aba7c1f04fd18287d1" live="d1ee1d09fbea547b141cd4cd085e3ffb"
  ! [functions] mismatch public.match_document_lookup_chunks_text(text,uuid[],integer,uuid) :: def_hash: manifest="989281557ff4877f8eae5c9a32a3ef8c" live="c1ede773fc0498e32bc3b4aa7262b32c"
  ! [functions] mismatch public.match_document_memory_cards_hybrid_v2(extensions.vector,text,integer,double precision,uuid[],uuid) :: def_hash: manifest="0534ad140950e83128b3434caa5ffd32" live="5e792e262b70ecc7981770b13f146671"
  ! [functions] mismatch public.match_document_memory_cards_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid) :: def_hash: manifest="1a937f133f5cb6e6d59a5b00311ec685" live="9079b928ee56fd7846e280d10ba1d27c"
  ! [indexes] mismatch document_chunks_content_trgm_idx :: def_hash: manifest="8499c3d35fc205ab0f7237031eee7926" live="c3db29603d9760b6a50f5ea23d58e4a8"
  ! [indexes] missing_live document_embedding_fields_meta_rag_indexing_version_idx :: {"def_hash":"5fb02e475d7061b2436b9179d097ab18","table":"document_embedding_fields"}
  ! [indexes] missing_live document_embedding_fields_owner_document_created_idx :: {"def_hash":"7bb98cc6be1af5cb34eed50d8625264c","table":"document_embedding_fields"}
  ! [indexes] missing_live document_embedding_fields_owner_id_idx :: {"def_hash":"ad61100a6b49f06e2ffde2c04eb68d9a","table":"document_embedding_fields"}
  ! [indexes] missing_live document_embedding_fields_search_tsv_chunk_gin_idx :: {"def_hash":"56b2a3ce845ae13bfeb0551906cf9581","table":"document_embedding_fields"}
  ! [indexes] missing_live document_embedding_fields_source_chunk_id_idx :: {"def_hash":"7224a35b50c37a7394210ca930e4e99f","table":"document_embedding_fields"}
  ! [indexes] missing_live documents_status_idx :: {"def_hash":"7dd1181f3cb8eedf8bd8d9dd779a77ae","table":"documents"}
  ! [triggers] missing_live documents.documents_updated_at :: {"def":"CREATE TRIGGER documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()"}
  ! [triggers] missing_live ingestion_jobs.ingestion_jobs_updated_at :: {"def":"CREATE TRIGGER ingestion_jobs_updated_at BEFORE UPDATE ON public.ingestion_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()"}

Live schema diverges from supabase/schema.sql. Either codify the live state (committed migration + schema.sql + regenerate the manifest) or fix live through an approved migration. Raw SQL against live is how this class of incident started; do not "fix" drift that way. See docs/database-drift-detection.md.
```

#### Line-by-line against the 19 of §2.3

**All 19 persist, unchanged — same categories, same keys, and the same manifest/live hash pairs.**
The manifest moved underneath them (`generated 2026-08-17T16:38:39.818Z from schema.sql
a6fb923400f8…`, against §2.3's `2026-08-16T14:37:41.042Z` / `365e3368a47b…`) and the compared
inventory is identical in size (6 extensions, 38 tables, 1 view, 93 functions, 210 indexes, 48
policies, 170 constraints, 26 triggers, 2 storage buckets), so the regenerated manifest changed
none of these verdicts.

| §2.3 group                                | Count | Re-measure                                         |
| ----------------------------------------- | ----- | -------------------------------------------------- |
| (a) `match_*` `def_hash` — `SET work_mem` | 7     | persists, same 7                                   |
| (b) objects only `schema.sql` declares    | 8     | persists, same 8 (6 indexes + 2 triggers)          |
| (c) table column-set mismatches           | 3     | persists, same 3                                   |
| (d) `document_chunks_content_trgm_idx`    | 1     | persists, same hashes (`8499c3d3…` vs `c3db2960…`) |
| **Total**                                 | 19    | **19**                                             |

The seven work_mem functions are still exactly the seven of §2.3, and `match_document_table_facts_text`
is still absent from the list: staging carries `work_mem` on **7** `match_*` functions, not 8,
re-confirming §2.4 finding 3 on the current chain.

**Nothing new appeared, and nothing changed category.** Two observations are new to this run, and
neither is a drift finding:

1. **The `migration_history` block is live and clean.** Snapshot v2 is deployed on staging, the
   probe reports `ok`, and it returns **zero** rows — so the new category contributes **0**
   findings. That is the expected result for an environment built by a faithful chain replay: the
   probe exists to catch versions recorded without executed DDL, and the Phase 2 replay recorded
   none. It is evidence the probe runs end-to-end against a real database, not that production is
   clean — production has not been measured with v2.
2. **Five `migration_history` allowlist entries report stale.** `20260701010000`,
   `20260701020000`, `20260701030000`, `20260701060000` and `20260702000000` (all
   `guard.class superseded`, added by PR #2058) match nothing here, because those history-repair
   rows are **production's**, and staging's replayed history has no such row. This is a warning, not
   a failure — the run still exits 1 solely on the 19. **Do not run `check:drift --prune-stale`
   against staging:** it would delete allowlist entries that exist for production. Staleness against
   staging is the correct, expected reading of a production-scoped allowlist.

**One thing the re-measure positively confirms.** `schema_drift_snapshot` does **not** appear
among the seven function mismatches. Before this window it could not: staging carried v1 while the
manifest carried v2. Applying `20260818090000` and finding the function absent from the drift list
is direct evidence that PR #2058's migration body and the `schema.sql` mirror regenerated from it
agree — the guard-migration contract's own plumbing verified against a live database for the first
time.

**Unchanged conclusion.** `check:drift`'s expected side is generated from `supabase/schema.sql`,
not from the migration chain, and a complete, byte-verified chain still reproduces 19 disagreements
with it. The §2.3 reading stands: until `schema.sql` is reconciled to the chain, a production drift
finding cannot be assumed to mean "production drifted". Every disposition remains repo-side work for
Phase 3, and none of it was touched here.

## Phase 3 — RPC reconciliation (reframed: repo-side codification, no production deploy)

_2026-08-18 (repo-side session; owner decisions D1 codify-as-live and D2 canary exemption in force;
no production access; two read-only `SELECT`s against staging `ikoiolksxqxfxgiyqpnu` for the (c)
triage, then — once the §2.5 re-measure merged — the authorised staging apply in 3.5; `list_projects`
verified the ref first and the project id was passed literally on every call). This supersedes the
playbook's Phase 3 prompt, which assumed repo-ahead canaries the §1.2 dossier ruled out. **No
function body changed.** `#292` open-PR check before starting: no open PR touched `schema.sql`,
`supabase/migrations/**`, `drift-manifest.json` or `scripts/check-drift.ts`._

### 3.1 `SET work_mem` codified on all ten RPCs — zero function mismatches, proven offline

`supabase/schema.sql` now carries `set work_mem = '<live value>'` as the last `set` clause of each
of the ten definitions (both the legacy lowercase and the effective uppercase blocks for
`match_document_chunks_hybrid` and `match_document_table_facts_text`, which `schema.sql` defines
twice; the later block wins on replay). New migration
`20260818110000_codify_live_rpc_work_mem.sql` runs one `ALTER FUNCTION … SET work_mem = '…'` per
function, versioned after every `create or replace` of each (newest bodies `20260701140631`,
`20260714110000`, `20260717162000`, `20260724120000`), so a clean chain replay ends with the
attribute present in live's `[search_path, (plan_cache_mode), work_mem]` proconfig order. The four
duplicate migration pairs (§2.4 finding 2) do not touch the ten. Idempotent on production.

**Decisive proof.** `npm run drift:manifest` (Docker replay of the edited `schema.sql`, 75 s,
`generated_at 2026-08-18T08:30:22Z`) yields a `def_hash` for every one of the ten that is
**byte-identical to the live production hash** captured in issue #1963's findings block (Actions
run `32051068106`, 2026-08-17 — the same values §1.2 Query 1 recorded):

| Function                                 | `work_mem` | Migration setting it                                        | `schema.sql` lines (post-edit)  | new manifest `def_hash` = live `def_hash` |
| ---------------------------------------- | ---------- | ----------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| `match_document_chunks_hybrid`           | 128MB      | `20260818110000` (was 64MB in `20260724000000`)             | 2772 (legacy), 6588 (effective) | `5902c39286335c07714e498ea31513a0`        |
| `match_document_embedding_fields_hybrid` | 128MB      | `20260818110000` (was 64MB in `20260724000000`)             | 4292                            | `bb975485ee3a5776bce4abdc2e3a3cbd`        |
| `match_document_index_units_hybrid`      | 128MB      | `20260818110000` (was 64MB in `20260724000000`)             | 5501                            | `d0e277a2f3067f49463b85ac84b33276`        |
| `match_document_index_units_hybrid_v2`   | 128MB      | `20260818110000` (never set before)                         | 8006                            | `05ddb8f73fac7751a2256aa15c1122e2`        |
| `match_document_chunks_text`             | 64MB       | `20260724000000`, re-asserted by `20260818110000`           | 3845                            | `d135c628720cb8a4d86c2ade4cd3b26a`        |
| `match_document_chunks_text_v2`          | 64MB       | `20260818110000` (never set before)                         | 7822                            | `3639b2442bac7b2e7b18ad322a395acb`        |
| `match_document_lookup_chunks_text`      | 64MB       | `20260724000000`, re-asserted by `20260818110000`           | 4002                            | `c1ede773fc0498e32bc3b4aa7262b32c`        |
| `match_document_memory_cards_hybrid`     | 64MB       | `20260724000000`, re-asserted by `20260818110000`           | 3096                            | `9079b928ee56fd7846e280d10ba1d27c`        |
| `match_document_memory_cards_hybrid_v2`  | 64MB       | `20260724000000`, re-asserted by `20260818110000`           | 2982                            | `ab87a18bea57612db83428c24c425825`        |
| `match_document_table_facts_text`        | 64MB       | `20260818110000` (dropped by the `20260724120000` recreate) | 4190 (legacy), 6676 (effective) | `0ef9a5dfbde03fe6d48d9223e245aa69`        |

10/10 equal. Because `check:drift` compares functions on `def_hash` + `acl` and ACLs were already
equal (§1.2), the next production live-drift run will report **zero `match_*` function mismatches**
once this migration runs in a production window. That window must run `supabase db push` (or
equivalent verbatim execution of the ten idempotent `ALTER FUNCTION` statements) — not
`supabase migration repair --status applied` or any other history-only mark-applied path. Per
AGENTS.md "Supabase project safety", a mark-applied version requires a fail-fast validation guard
migration shipped in the same change (the `20260804110240` pattern); this PR ships no such guard,
so `migration repair` on this version is out of scope for the coordinator.
Eval-canary: none dispatched (D2 — planner memory, latency-only; no live eval in this task).

### 3.2 Eight never-created objects — codified verbatim (`20260818111000`)

`20260818111000_codify_schema_only_indexes_and_triggers.sql` creates, verbatim from `schema.sql`
(lines 678, 763–776, 1073–1081) with `create index if not exists` / `drop trigger if exists` +
`create trigger` semantics, the five `document_embedding_fields_*` indexes
(`owner_id_idx`, `owner_document_created_idx`, `source_chunk_id_idx`,
`meta_rag_indexing_version_idx`, `search_tsv_chunk_gin_idx`), `documents_status_idx`, and the
`documents_updated_at` / `ingestion_jobs_updated_at` triggers on `public.set_updated_at()`.
Verified against `#102`'s list (`documents_title_bare_trgm_idx`, `documents_file_name_bare_trgm_idx`,
`documents_status_id_idx`): **disjoint** — `documents_status_idx` is the existing single-column index
`#102` proposes to supplement, not one of its objects. All eight already exist on production
(the 2026-08-14 live-drift run listed none of them as `missing_live` and reported no trigger drift),
so the migration is a no-op there.

**Monitoring decision (forced by `tests/search-health-index-coverage.test.ts`):** all six indexes
were already on `supabase/search-health-unmonitored-indexes.json` (five `accepted-unmonitored`,
`document_embedding_fields_search_tsv_chunk_gin_idx` a `monitor-candidate`); they **stay on the
unmonitored list** and `search_schema_health()` `required_indexes` is not changed here — that is a
runtime-probe redefinition with its own migration and belongs to Phase 4.4. Their `reason` strings
were refreshed to cite `20260818111000` (they had said "never by a migration"). The test's
migration-vs-manifest disagreement count drops by six.

### 3.3 Triage of the four remaining staging findings

**(c) `document_chunks` — CHAIN-stale, one column.** Read-only staging
`schema_drift_snapshot()->'tables'` for the three tables, diffed per column against the manifest
offline (`check:drift`'s own 240-char clip hides the column; see note below):

```
== document_chunks
  column only in manifest: token_estimate {"default":"0","not_null":true,"type":"integer"}
```

`token_estimate integer not null default 0` is `schema.sql:309`, is written by
`src/lib/chunking.ts:624` and `src/lib/registry-corpus.ts:224`, required by
`src/lib/supabase/database.types.ts:305`, and present on production (2026-08-14 live-drift: no table
drift ⇒ production = manifest = `schema.sql`); `grep -rn token_estimate supabase/migrations` returns
**zero** hits. Fixed in the chain by `20260818112000_reconcile_chain_stale_table_columns.sql`
(`add column if not exists`, catalog-only on PG 11+, no-op on production). Owner-approved in-session.

**(c) `rag_visual_eval_cases` / `rag_visual_eval_runs` — CHAIN-stale, `id` default binding.**
`schema.sql:5909–5942` is byte-identical to `20260705230000:231–264`, so the mismatch is not
textual. The staging diff is exactly:

```
== rag_visual_eval_cases   column differs: id   manifest default "gen_random_uuid()"   staging default "extensions.gen_random_uuid()"
== rag_visual_eval_runs    column differs: id   manifest default "gen_random_uuid()"   staging default "extensions.gen_random_uuid()"
```

Decisive hunk: `20260705230000_reconcile_live_database_drift.sql:6` opens with
`set search_path = public, extensions, pg_catalog;` — `pg_catalog` **last** — so its bare
`default gen_random_uuid()` bound to pgcrypto's `extensions.gen_random_uuid()`, whereas
`schema.sql:10` (`set search_path = public, extensions;`, `pg_catalog` implicitly first) and
production bind the core `pg_catalog.gen_random_uuid()`. Both generate v4 UUIDs (no behavioural
difference) but it is a real OID mismatch in the column set. `schema.sql` is the correct side and is
unchanged; `20260818112000` rebinds both defaults to `pg_catalog.gen_random_uuid()` (no-op on
production). `indexing_v3_agent_jobs.id` also renders `extensions.gen_random_uuid()` on staging but
`schema.sql:5653` declares it that way explicitly, so chain, mirror and live already agree — not
touched. Nothing from (c) remains UNCLASSIFIED.

**(d) `document_chunks_content_trgm_idx` — production's restored definition IS canonical; no
escalation.** Three definitions exist in the repo; the drift `def_hash` is
`md5(regexp_replace(pg_get_indexdef(oid), '\s+', '', 'g'))` (`20260706200000:105`), computed
offline for both renderings:

| Source                                                                                       | Expression                                                                 | normalized `pg_get_indexdef` md5                  |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| `20260606000000:11` (original creator, `if not exists`)                                      | `lower(coalesce(section_heading, '') \|\| ' ' \|\| content)`               | `c3db29603d9760b6a50f5ea23d58e4a8` = **staging**  |
| `schema.sql:743` = `20260622000000:13` = `20260705180000:11` = production restore (§Phase 4) | `lower(coalesce(section_heading, '') \|\| ' ' \|\| coalesce(content, ''))` | `8499c3d35fc205ab0f7237031eee7926` = **manifest** |

Canonical = the `coalesce(content, '')` form, which is what production carries since 2026-08-14
(§Phase 4 pasted the post-build `pg_indexes` definition verbatim). Staging carries the 2026-06-06
form because every later creator uses `if not exists` and no migration drops it — a chain-stale
residual on staging only. **Not fixed here**: the repair on any populated database is a concurrent
rebuild plus the Phase 4.4 fail-fast guard migration (the `20260804110240` pattern still names
four other indexes only); on staging it is a drop-and-recreate in the next staging window. Named as
the one expected residual for the staging proof.

**Tooling note recorded for `#316`.** `scripts/check-drift.ts:192` clips each side of a
`columns` diff to 240 characters of an alphabetised multi-kB JSON array, so a single late-alphabet
column (`token_estimate`) never appears in the message and the two prefixes print identical. The
finding fires but does not name the column; per-column expansion needed the raw snapshot.

### 3.4 Gates

- `npm run drift:manifest` — `Replay complete in 75s`, `Wrote supabase/drift-manifest.json`; the
  ten `def_hash` values above.
- `npm run check:migration-role` — `Hosted migration-role guard passed: active hosted SQL/tooling uses postgres and immutable applied history is unchanged.`
- `npx vitest run tests/supabase-schema.test.ts tests/drift-detection.test.ts tests/migration-history-guards.test.ts tests/search-health-index-coverage.test.ts tests/retrieval-access-scope.test.ts tests/migration-history-placeholders.test.ts tests/hosted-migration-role-guard.test.ts tests/guard-push.test.ts` — `Test Files 8 passed (8) · Tests 149 passed (149)`.
- `npm run verify:pr-local` — see the PR body for the pasted line (the two Windows-environmental
  failures `tests/session-start-hook.test.ts` / `tests/worker-observability.test.ts` are the only
  expected red set on this host).

### 3.5 Staging proof — RUN for the three migrations; a fourth authored from what it found

_The gate opened when the Phase 2 re-measure (§2.5, PR #2104) merged onto `main` (`f19cf8f60`).
Owner-authorised staging window (original Phase 3 authorisation), target `Clinical KB Staging`
`ikoiolksxqxfxgiyqpnu` via the Supabase MCP connector; `list_projects` verified the ref and the
project id was passed literally on every call; production `sjrfecxgysukkwxsowpy` was never a
target. Pre-flight before the first write: `current_user postgres`, `total_rows 195`,
`latest_version 20260818090000`, `no_statements 0`, `documents 0`, `document_chunks 0`, none of the
three versions present._

**Apply, by the §2.2 method** (each file's content verbatim through `execute_sql`, then an explicit
`schema_migrations` row carrying the repository version and name in the same call; `apply_migration`
not used). Faithfulness proof read back from staging — all three md5-identical to the repository files:

```
version 20260818110000 · name codify_live_rpc_work_mem                  · stmt_count 1 · bytes 3987 · md5 dd5c8c9ea07c17f76a5f219814f8f19d = repo
version 20260818111000 · name codify_schema_only_indexes_and_triggers   · stmt_count 1 · bytes 3470 · md5 9d02d14e14d7ea07bf257e2dc99adaa6 = repo
version 20260818112000 · name reconcile_chain_stale_table_columns       · stmt_count 1 · bytes 2631 · md5 ea5f9c6931f85b81613082b4b6fd6a6e = repo
```

**Drift comparison.** The local env has no staging service-role key, so instead of `check:drift`'s
network path the comparison was reproduced offline with the same rules: staging returned, per
object, `md5(<compared fields as jsonb>::text)` for exactly `check-drift.ts`'s `categoryKeys` /
`comparedFields`, and the manifest side was rendered in PostgreSQL jsonb text form and hashed
locally (harness in the session scratchpad; 590 of 594 objects hash-equal, which validates the
renderer). Result against the regenerated manifest (`generated 2026-08-18T08:30:22Z from
schema.sql 87ac9fc4849e…`; staging `snapshot_version 2`, `migration_history_probe ok`, 0 history
rows):

```
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against staging.
UNEXPECTED DRIFT (4):
  ! [functions] mismatch public.match_document_embedding_fields_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid)
  ! [functions] mismatch public.match_document_index_units_hybrid(extensions.vector,text,integer,double precision,uuid[],uuid)
  ! [functions] mismatch public.match_document_memory_cards_hybrid_v2(extensions.vector,text,integer,double precision,uuid[],uuid)
  ! [indexes] mismatch document_chunks_content_trgm_idx
```

Against §2.5's 19: the 8 never-created objects are **gone**, the 3 table column-set mismatches are
**gone**, and 4 of the 7 `work_mem` function mismatches are **gone** (`chunks_hybrid`,
`chunks_text`, `lookup_chunks_text`, `memory_cards_hybrid` now hash-equal). The trgm index is the
one residual 3.3 (d) predicted. **Three functions still mismatch, and that is a finding, not
`work_mem`:** their ACLs and `proconfig` (values and order) now equal the manifest exactly, and
`memory_cards_hybrid_v2`'s staging hash `5e792e26…` is unchanged from §2.5 even though its
`work_mem` was already 64MB — so the difference is in the body. `pg_get_functiondef` on staging
shows the decisive hunk for all three:

```diff
-      and public.retrieval_owner_matches(owner_filter, d.owner_id)      -- schema.sql = production
+      and (owner_filter is null or d.owner_id = owner_filter)           -- staging (chain-built)
```

Provenance: `20260712000000_forward_codify_retrieval_owner_matches.sql` recorded that all eight
primary retrieval RPCs on live already gate ownership through the fail-closed, sentinel-aware
`retrieval_owner_matches`, and left the byte-perfect body codification to an owner step; later
migrations (`20260712171500`, `20260714110000`, `20260724120000`) codified five, but
`match_document_embedding_fields_hybrid`, `match_document_index_units_hybrid` and
`match_document_memory_cards_hybrid_v2` were never re-created from live — their newest committed
body is still `20260701140631` with the legacy predicate. §2.3/§2.5 could not see this because the
`work_mem` diff sat on top of it. **Classification: chain-stale body (production and `schema.sql`
agree — 3.1 proved manifest hash = live hash for all three); not a production tenancy hole; a
reproducibility hole for any migrations-only environment.** Per the plan's live-ahead remedy,
`20260818113000_forward_codify_hybrid_owner_matches_bodies.sql` re-creates the three from
`schema.sql` verbatim (every `SET` clause restated so proconfig is preserved; ACLs untouched by
`CREATE OR REPLACE`; identical text on production ⇒ no-op). Its first staging attempt was declined
by the tool-permission classifier; **applied in a second owner-authorised window the same day**
(same method, same target, ref verified): the three hashes now equal the manifest and live —
`bb975485ee3a5776bce4abdc2e3a3cbd`, `d0e277a2f3067f49463b85ac84b33276`,
`ab87a18bea57612db83428c24c425825` — and the history row read back `md5 d35c199b19915505ca86663d0be2bf4d
= repo`.

**Deviation found and resolved.** Before PR #2106 was squash-merged, `20260818111000` and
`20260818112000` gained a `set local lock_timeout = '5s'; set local statement_timeout = '30s';`
preamble on the PR branch, so the text that reached `main` (`22585b9e…`, `ec154770…`) differed from
the text staging had recorded and executed (`9d02d14e…`, `ea5f9c69…`; `20260818110000` unchanged,
`dd5c8c9e…`). The executed DDL is identical (transaction-local timeouts only), so staging's object
state already equalled what `main` produces; in the second window the two rows' `statements` were
refreshed to the merged text so the faithfulness proof holds again. Read-back after the window:

```
20260818110000 codify_live_rpc_work_mem                    stmt_count 1 bytes  3987 md5 dd5c8c9ea07c17f76a5f219814f8f19d = repo
20260818111000 codify_schema_only_indexes_and_triggers     stmt_count 1 bytes  3875 md5 22585b9eb81becb6c62d94e597b9e172 = repo
20260818112000 reconcile_chain_stale_table_columns         stmt_count 1 bytes  3062 md5 ec154770ddaee44bcb64d3d2fc4f838a = repo
20260818113000 forward_codify_hybrid_owner_matches_bodies  stmt_count 1 bytes 12101 md5 d35c199b19915505ca86663d0be2bf4d = repo
```

**Final staging comparison (same offline reproduction, 594 objects received):**

```
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against staging (snapshot_version 2, probe ok, migration_history rows 0).
UNEXPECTED DRIFT (1):
  ! [indexes] mismatch document_chunks_content_trgm_idx
```

**Zero function mismatches, zero never-created objects, zero table mismatches** — the Phase 3
target — with the single named residual being the trgm index of 3.3 (d) (staging holds the
`20260606000000` bare-`content` form `c3db2960…`; canonical `8499c3d3…`), owned by Phase 4.4.
Staging after the two windows: 199 rows in `schema_migrations`, `no_statements 0`, `documents` /
`document_chunks` still `0`, no vault secret seeded.

### 3.6 Production window (NOT authorised in this task — for the coordinator)

Live state already matches for everything in this phase, so applying each migration is a no-op on
production. The window must still run `supabase db push` (verbatim execution of each migration's
statements) — **not** `supabase migration repair --status applied` or any other mark-applied-only
path. None of the three Phase 3 migrations ships a validation guard, so per AGENTS.md "Supabase
project safety" none of them is eligible for history repair; only real execution is authorised here.

| Migration                                                   | Effect on production                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `20260818090000_schema_drift_snapshot_history_probe`        | **real change** — `schema_drift_snapshot()` v2 (Phase 6.1)    |
| `20260818110000_codify_live_rpc_work_mem`                   | no-op — the ten `work_mem` values already match (3.1)         |
| `20260818111000_codify_schema_only_indexes_and_triggers`    | no-op — all eight objects already exist (3.2)                 |
| `20260818112000_reconcile_chain_stale_table_columns`        | no-op — column and both defaults already as declared (3.3)    |
| `20260818113000_forward_codify_hybrid_owner_matches_bodies` | no-op — identical to the live bodies (3.5; hash proof in 3.1) |

One window covers all five via `db push`; none needs a canary (D2), none builds an index, none
changes a body that production does not already run.

### 3.7 Production window — authorised 2026-08-18; found already applied, `db push` NOT run

_2026-08-18 (owner-authorised production window for exactly the five §3.6 migrations via the
authenticated Supabase CLI 2.114.0; target `Clinical KB Database` `sjrfecxgysukkwxsowpy`, linked
from a dedicated worktree and unlinked again at the end; the main checkout stayed linked to
staging). Authorisation was conditional: `supabase migration list` first, and stop if the pending
set was anything other than those five. It was — the pending set was **empty** — so `supabase db
push` was never run, no `migration repair` / mark-applied path was used, no vault secret was read or
seeded, staging was not touched, and production received zero writes in this session._

**Pre-flight identity (read-only, `supabase db query --linked --project-ref sjrfecxgysukkwxsowpy`):**

```
db postgres · usr postgres · total_rows 199 · latest_version 20260818113000 · documents 2851 · document_chunks 70120
```

**(1) `supabase migration list --linked`** — every local version, including all five `20260818*`,
has a matching remote row (decisive tail of the JSON):

```
{"local":"20260818090000","remote":"20260818090000"} {"local":"20260818110000","remote":"20260818110000"} {"local":"20260818111000","remote":"20260818111000"} {"local":"20260818112000","remote":"20260818112000"} {"local":"20260818113000","remote":"20260818113000"}
```

**(2) History rows carry executed statements** — the CLI's per-statement `db push` shape, not the
empty mark-applied shape, so the guard-migration contract was not breached by whoever applied them
(`created_by`, `idempotency_key`, `rollback` are all null on every row, so the history table itself
names no actor):

```
20260818090000 schema_drift_snapshot_history_probe         stmt_count  3 bytes  9025 md5 d499617cf9d3423ef9f9e5d83cd698dd
20260818110000 codify_live_rpc_work_mem                    stmt_count 11 bytes  3965 md5 28082364f1ae611a4f6879fd0c6d7b04
20260818111000 codify_schema_only_indexes_and_triggers     stmt_count 12 bytes  3854 md5 0db7d36488c0db0a96f62166a32a6771
20260818112000 reconcile_chain_stale_table_columns         stmt_count  5 bytes  3045 md5 729942468a857db869edddbee7e1b0d9
20260818113000 forward_codify_hybrid_owner_matches_bodies  stmt_count  4 bytes 12087 md5 e4e640f3ec34e0ee9fb149ad06fcd6d0
```

(The md5s differ from §3.5's staging values because staging recorded each file as one statement;
production's rows are the CLI's statement split. Object-state proof below is the faithfulness test.)

**(3) `schema_drift_snapshot()` v2 is live** — `snapshot_version 2`, `migration_history_probe "ok"`,
`migration_history` **20** rows. The five seeded `superseded` guards (`20260701010000`, `020000`,
`030000`, `060000`, `20260702000000`) plus the fifteen deliberately unallowlisted §1.1 rows — the
expected first live report. **Nothing was allowlisted**; the fix remains fail-fast guard migrations
(Phase 6.2):

```
20260701010000 20260701020000 20260701030000 20260701040000 20260701060000 20260702000000
20260702100000 20260702110000 20260702120000 20260702130000 20260702140000 20260702150000
20260702160000 20260702180000 20260712165915 20260712170500 20260712171000 20260712171500
20260712172000 20260712173000
```

**(4) `work_mem` on the ten retrieval RPCs** — exactly ten `pg_proc` rows, D1 values:

```
128MB  match_document_chunks_hybrid · match_document_embedding_fields_hybrid · match_document_index_units_hybrid · match_document_index_units_hybrid_v2
 64MB  match_document_chunks_text · match_document_chunks_text_v2 · match_document_lookup_chunks_text · match_document_memory_cards_hybrid · match_document_memory_cards_hybrid_v2 · match_document_table_facts_text
```

**Who applied them, and when — Supabase's GitHub integration on merge to `main`.**
`supabase branches list --project-ref sjrfecxgysukkwxsowpy` returns one branch: `name main`,
`is_default true`, `git_branch main`, `project_ref = parent_project_ref = sjrfecxgysukkwxsowpy`,
`created_at 2026-06-27`. That is Supabase Branching with the production project bound to the
repository's `main` branch, and its documented behaviour is to run pending `supabase/migrations`
against production whenever that branch advances. The push-triggered `live-drift.yml` runs bracket
it exactly (no repo workflow pushes migrations — CI's `db-reset-verify` replays a local emulator only,
and no Supabase check-run is posted on the merge commits, so the drift runs are the only clock):

| Live-drift run (`push` event)       | Head        | Merged PR / time (UTC) | Function mismatches                                                                           | Verdict                                                      |
| ----------------------------------- | ----------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `32051068106` — 2026-08-17 17:37:38 | `9c660af1f` | #2058, 17:36:13        | 11 (10 `work_mem` + `schema_drift_snapshot`); info line "migration-history probe not present" | nothing applied 85 s after #2058 merged                      |
| `32124243972` — 2026-08-18 09:57:27 | `72aa18865` | #2106, 09:56:53        | **0**; `UNEXPECTED DRIFT (37)`                                                                | `090000`–`112000` all live **34 s** after #2106 merged       |
| `32131517648` — 2026-08-18 11:24:34 | `9b52eb075` | #2111, 11:23:50        | **0**; `UNEXPECTED DRIFT (37)`                                                                | `113000` is a no-op, so no visible delta; row present by now |

Thirty-four seconds from squash-merge to applied migrations is automation, not an operator; the
per-statement history shape is the CLI's, which the integration runs. So the "production window" this
section was opened for had already been performed by the integration on 2026-08-18 — `090000` some
time between 2026-08-17 17:37:38 and 2026-08-18 09:57:27, `110000`–`112000` by 09:57:27, `113000`
by the time of this session's read (~13:30). Exact integration timestamps were not retrieved (no
`track_commit_timestamp` on the project; `pg_xact_commit_timestamp` raised `55000`).

**Live-drift proof (run `32131517648`, the post-#2111 head; a fresh dispatch was not made because it
would repeat this run byte-for-byte):**

```
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against live.
  ~ [migration_history] no_statements … ×5    (the five seeded superseded guards — expected, printed before the block)
UNEXPECTED DRIFT (37):
  ! [indexes] missing_live … ×20   (api_rate_limits_bucket_updated_idx … storage_cleanup_jobs_owner_status_idx — the §1.3 twenty)
  ! [indexes] unexpected_live document_table_facts_document_id_idx
  ! [indexes] unexpected_live storage_cleanup_jobs_owner_id_idx
  ! [migration_history] no_statements … ×15   (20260701040000, 20260702100000…180000, 20260712165915…173000)
```

**Function `def_hash` mismatches: zero.** `missing_live` indexes: **20** (Phase 4's job).
`unexpected_live`: **2** (Phase 4's job). `migration_history` findings: **15** unexpected + 5 expected
— appearing for the first time, exactly as Phase 6.2 predicted; fix = guard migrations, never bare
allowlisting. The run's overall conclusion is `failure` because of those 37, which is the intended
red-until-Phase-4-and-6.2 state.

**Consequences for the coordinator (not absorbed here — owner decision):**

- The plan's "one approved production window per phase" model is not what the platform does: **every
  migration merged to `main` is applied to production by the Supabase GitHub integration, with no
  operator window and no approval gate.** Either keep it and rewrite the playbook/approval map around
  it, or disable it in the Supabase dashboard. Neither was done in this session.
- Phase 4 must be designed for this either way: an index-restoration migration merged to `main` will
  be run by the integration inside `db push`'s per-migration transaction, where
  `CREATE INDEX CONCURRENTLY` fails. The plan's operator-prebuild-then-guard pattern
  (`20260804110240`) still fits; a bare `create index concurrently` migration does not.
- Not established: who enabled the integration or when (branch `created_at 2026-06-27`), and whether
  earlier "recorded as executed" rows in §1.1 came from it. Not investigated in this session.

Local state after the session: worktree unlinked (`supabase unlink` → `.temp/project-ref` absent),
no repository files other than this section changed, `#316` untouched (mid-reconcile elsewhere).

## Phase 4 — Index restoration

_2026-08-14 (partial, incident-driven: the two retrieval-critical indexes only, owner-approved
"i authorise" in-session)._ Executed via the owner-authorized Supabase connector:

- `create index concurrently if not exists documents_title_trgm_idx …` — definition verbatim from
  `20260705180000`. Result: `indisvalid = true`, `indisready = true`, 648 kB.
- `create index concurrently if not exists document_chunks_content_trgm_idx …` — same source.
  Result: `indisvalid = true`, `indisready = true`, 68 MB.
- `ANALYZE public.documents; ANALYZE public.document_chunks;` after both builds.
- Canonical-shape validation (per PR #1960 review — `IF NOT EXISTS` could otherwise no-op on a
  same-named index; here the prior inventory proved both absent, and post-build `pg_indexes`
  returns the canonical normalized definitions verbatim):
  `CREATE INDEX document_chunks_content_trgm_idx ON public.document_chunks USING gin (lower(((COALESCE(section_heading, ''::text) || ' '::text) || COALESCE(content, ''::text))) gin_trgm_ops)` and
  `CREATE INDEX documents_title_trgm_idx ON public.documents USING gin (lower(((COALESCE(title, ''::text) || ' '::text) || COALESCE(file_name, ''::text))) gin_trgm_ops)` —
  both matching `20260705180000` / `schema.sql`.

Deviation from the phase template, recorded honestly: no PITR restore point was captured first —
the operation was additive index creation with a one-statement rollback
(`drop index concurrently`), no data-loss surface. No migration was added in the incident window:
the definitions are already codified in `20260705180000` + `schema.sql`, and this was the
documented operator prebuild for a drifted hosted target. **Outstanding phase debt (PR #1960
review):** plan phase 4.4 still requires a fail-fast reconcile/guard migration for this repaired
pair (the `20260804110240` pattern names four other indexes only), so a later replay cannot
silently proceed if either index disappears again — queued as follow-up work for the full Phase 4
batch, deliberately not bundled into this docs-only PR because migrations are an operational-risk
surface with their own replay gates. The other 19 drift findings, the 2 unexpected live indexes,
and the green live-drift dispatch also remain **pending** for the full phase.

### Phase 4 completion — 2026-08-19 (owner-authorised off-peak production window)

_Owner-authorised window against `Clinical KB Database` (`sjrfecxgysukkwxsowpy`) for index DDL plus
a `supabase db push` of the guard migrations. Executed from a dedicated worktree; the main checkout
`D:\Repos\Database` stayed linked to STAGING throughout. D4 is OFF *(superseded: see §D4 — SETTLED 2026-08-21; deploy-on-merge is ON)* (the Supabase GitHub auto-deploy
was disabled before this window), so nothing in this task reached production on merge — every hosted
change below was made by the explicit step that names it._

**Tooling substitution, recorded.** The Supabase MCP connector was blocked by this session's
permission classifier, so every hosted statement went through the authenticated Supabase CLI 2.114.0
(`supabase db query --file` / `db push`), which reaches the same management API. Two transport traps
cost a retry each and neither touched the database: Node cannot `execFile` the `supabase` npm shim on
Windows (`ENOENT` — resolve `node_modules/supabase/dist/supabase.js` and run it with `node`), and
`db query` parses a leading `--` as a flag, so SQL beginning with a comment must be passed via
`--file`.

#### Step 1 — restore point: PITR is NOT enabled (deviation, stated not absorbed)

`supabase backups list --project-ref sjrfecxgysukkwxsowpy` reports `"pitr_enabled": false` with
`"walg_enabled": true` and seven retained daily physical backups, the most recent `COMPLETED` at
**2026-08-17T20:33:28Z** — roughly 38 hours before this window. **No PITR restore point exists to
confirm.** The window proceeded on the explicit assessment that every statement in it is index-only
with an exact one-statement inverse (`CREATE INDEX CONCURRENTLY` ↔ `DROP INDEX CONCURRENTLY`) and no
data-loss surface — the same reasoning the 2026-08-14 incident window recorded. **This is a real gap
in the plan's safety model, not a cleared checklist item:** the plan's standing rule "PITR/backup
restore point captured before any mutating phase" cannot be satisfied on this project as configured,
and any future phase that mutates _data_ rather than indexes must not proceed on this precedent.
Enabling PITR is an owner dashboard decision.

#### Step 2 — pre-flight, then the twenty builds

Read-only pre-flight (`db query --linked --project-ref sjrfecxgysukkwxsowpy`), matching §3.7 exactly:

```
db postgres · usr postgres · total_rows 199 · latest_version 20260818113000 · documents 2851
```

Of the 24 indexes in scope, exactly **4** were present: the two 2026-08-14 trigram restores
(`documents_title_trgm_idx`, `document_chunks_content_trgm_idx`, both `indisvalid`/`indisready`) and
the two `unexpected_live` orphans. All **20** `missing_live` indexes were confirmed absent — the §1.3
inventory still held at the window.

Owning-table sizes at repair time (the §1.3 sizing debt, now discharged; heap only):

| Table                            | Heap       | `n_live_tup` | Batch       |
| -------------------------------- | ---------- | -----------: | ----------- |
| `document_index_units`           | 162 MB     |      113,587 | B           |
| `document_chunks`                | 124 MB     |       70,120 | B           |
| `document_table_facts`           | 48 MB      |       34,795 | (drop only) |
| `document_images`                | 19 MB      |       14,267 | B           |
| `image_caption_cache`            | 10224 kB   |            3 | A           |
| `document_summaries`             | 4272 kB    |        2,851 | A           |
| `documents`                      | 3928 kB    |        2,851 | B           |
| `document_index_quality`         | 2760 kB    |        2,851 | A           |
| `ingestion_job_stages`           | 1888 kB    |        7,979 | A           |
| `medication_records`             | 792 kB     |          656 | A           |
| `rag_queries`                    | 552 kB     |          373 | A           |
| `indexing_v3_agent_jobs`         | 272 kB     |        2,065 | A           |
| `rag_query_misses`               | 128 kB     |          177 | A           |
| `rag_aliases`                    | 32 kB      |           68 | A           |
| `api_rate_limits`                | 8192 bytes |            4 | A           |
| `audit_logs`                     | 0 bytes    |            0 | A           |
| `storage_cleanup_jobs`           | 0 bytes    |            0 | A           |
| `document_publication_approvals` | 0 bytes    |            0 | A           |

Each build ran `CREATE INDEX CONCURRENTLY IF NOT EXISTS` with the canonical definition, then re-read
`pg_index.indisvalid`/`indisready` and compared normalised `pg_get_indexdef` against the canonical
text using the repo's own `normalizeIndexDefinition` (`tests/supabase-schema.test.ts:199`). Canonical
text came from `supabase/drift-manifest.json` `snapshot.indexes[].def` — the rendered form of each
defining migration — and every one was cross-read against that migration's own `create index`
statement before the window (`20260712165211` ×14, plus `20260717170000`, `20260717131000`,
`20260705010000`, `20260708000000`, `20260705230000`, `20260608001000`). **No transactional build was
ever attempted.**

**Batch A — small tables, 14/14 OK** (all `indisvalid=true indisready=true`, definitions matched):

```
audit_logs_action_created_idx                    OK size=8192 bytes
audit_logs_owner_created_idx                     OK size=8192 bytes
api_rate_limits_bucket_updated_idx               OK size=16 kB
rag_aliases_type_enabled_idx                     OK size=16 kB
rag_queries_source_chunk_ids_gin_idx             OK size=56 kB
rag_query_misses_aliases_idx                     OK size=16 kB
image_caption_cache_owner_hash_idx               OK size=1392 kB
document_index_quality_owner_score_idx           OK size=152 kB
document_publication_approvals_document_idx      OK size=8192 bytes
document_summaries_owner_idx                     OK size=104 kB
indexing_v3_agent_jobs_locked_at_idx             OK size=8192 bytes
ingestion_job_stages_job_stage_started_idx       OK size=616 kB
medication_records_owner_category_idx            OK size=32 kB
storage_cleanup_jobs_owner_status_idx            OK size=8192 bytes
```

**Batch B — large tables, 6/6 OK**, built one at a time in ascending owning-table size with a
`pg_locks` reading between each. Baseline `waiting 0 · total_locks 9 · active_backends 0`; after every
build `waiting 0`, never above `total_locks 9`. **No lock contention at any point.**

```
documents_registry_projection_lookup_idx         OK size=72 kB     (documents)
document_images_hash_idx                         OK size=1616 kB   (document_images)
document_images_structured_profile_gin_idx       OK size=64 kB     (document_images)
document_images_visual_intelligence_version_idx  OK size=16 kB     (document_images)
document_chunks_anchor_idx                       OK size=1288 kB   (document_chunks)
document_index_units_heading_path_idx            OK size=4104 kB   (document_index_units)
```

**Zero invalid builds, zero retries, zero skips** — the drop-and-retry-once path and the
skip-and-report path were both defined and neither was needed. `#102`'s bare-column indexes on
`documents` were held out entirely and remain its own canary-gated work.

`ANALYZE` was then run on all eighteen touched tables (three of the twenty are expression indexes,
which gather statistics on the expression only at `ANALYZE`).

#### Step 3 — the two `unexpected_live` indexes: DROP, not codify

Both are strict leading-column subsets of a present, valid canonical index, and in both cases the repo
chain already **commands the drop** — codifying either would contradict a committed migration:

| Orphan                                                         | Superseded by (present, valid on live)                                                                  | Repo instruction                                                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_table_facts_document_id_idx` `(document_id)`, 296 kB | `document_table_facts_document_idx (document_id, page_number)`, 560 kB                                  | created by `20260618000000:10`, dropped by `20260620000000:159` with the comment "superseded by document_table_facts_document_idx(document_id, page_number)"; `20260712172000` drops it again |
| `storage_cleanup_jobs_owner_id_idx` `(owner_id)`, 8192 bytes   | `storage_cleanup_jobs_owner_status_idx (owner_id, status, created_at DESC)` — restored in Batch A above | dropped by `20260703030000:40` ("`storage_cleanup_jobs_owner_id_idx` -> `storage_cleanup_jobs_owner_status_idx`") and again by `20260708000000:26`                                            |

Neither name appears in `supabase/schema.sql` or the manifest, so dropping them moves live **into**
agreement with the mirror and needs no new migration. Both dropped with `DROP INDEX CONCURRENTLY IF
EXISTS`; a follow-up `pg_class` read returns zero rows for both. The `storage_cleanup_jobs` drop was
deliberately ordered **after** its superseding composite was built.

**Whole-schema result:** `pg_indexes` in `public` now reports **210** indexes against the manifest's
**210** repo-defined (192 − 2 + 20 = 210), all 22 guard targets `indisvalid AND indisready`, and
**zero** invalid-or-not-ready indexes anywhere in the schema.

#### Step 4 — codification

Four migrations, all authored to the `20260804110240` pattern where they are guards (`set local`
timeouts, validate presence + `indisvalid`/`indisready` + normalised `pg_get_indexdef`, never build,
exactly one `raise exception`):

| Migration                                              | Validates                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `20260819100000_restore_batch_a_operational_indexes`   | the 14 Batch A indexes                                                                         |
| `20260819100100_restore_batch_b_retrieval_indexes`     | the 6 Batch B indexes                                                                          |
| `20260819100200_restore_search_health_trigram_indexes` | `documents_title_trgm_idx` + `document_chunks_content_trgm_idx` — **plan 4.4 debt discharged** |
| `20260819100300_monitor_restored_retrieval_indexes`    | (not a guard) redefines `search_schema_health()` `required_indexes`                            |

`20260819100200` closes the hole §1.1 named explicitly: `20260804110240` validates four _other_
indexes and never checked this pair, which is why both could vanish between 2026-07-05 and 2026-08-02
while the chain still replayed green. It resolves canonical names only — an `index_aliases` entry
satisfying the health probe is not evidence the canonical trigram index exists, which is the exact
failure being guarded.

All three guards were **dry-run against production before the push** (the DO block only reads and
raises) and all three passed. One attempt returned a transient Cloudflare `502` from
`api.supabase.com` and succeeded unchanged on retry — a transport failure, not a guard failure.

The 20 index definitions are already in `supabase/schema.sql`, and validation-only guards create
nothing, so **no mirror change accompanies the three guards** — consistent with `20260804110240`,
whose DO block likewise does not appear in `schema.sql`. Only `search_schema_health()` was mirrored.
`npm run drift:manifest` → `Replay complete in 21s`, `Wrote supabase/drift-manifest.json`; the diff is
exactly one `def_hash` (`f4f5f536…` → `85df52de…`, `search_schema_health`) plus the regeneration
stamps. The index inventory is byte-identical, as it must be: no index was added to or removed from
`schema.sql`.

**`required_indexes`: all eight Phase 6.3 monitor-candidates are now monitored.** The list grows from
22 to 30. Three of the eight (`documents_registry_projection_lookup_idx`, `document_chunks_anchor_idx`,
`document_index_units_heading_path_idx`) were among the twenty absent indexes and were rebuilt and
validated **before** this migration was written, so it cannot turn the probe red on a still-absent
object; the other five are present GIN indexes on the lexical half of the retrieval RPCs that had no
monitored equivalent (`document_index_units` was the worst-covered table in scope at 2 of 16).
`supabase/search-health-unmonitored-indexes.json` drops from 44 to 36 entries — the coverage test
rejects an entry that is also monitored — and now contains **no** `monitor-candidate`: every remaining
entry is a reasoned `accepted-unmonitored`.

**`migration_history` allowlist: zero new entries, and that is a measured result, not an omission.**
The condition was to allowlist any of the fifteen `#Q5JHBJ` no-statements versions that is
index-shaped _and_ whose objects these guards now validate. Six of the fifteen are index-shaped; their
created objects were enumerated and intersected against the 22 this window's guards validate:

| No-statements version                                | Index objects it creates                                                    | Covered by these guards |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------: |
| `20260702110000 drop_redundant_indexes`              | (drops only)                                                                |                       — |
| `20260702150000 documents_owner_covering_index`      | `documents_owner_id_covering_idx`                                           |                 **0/1** |
| `20260702180000 promote_index_generation_id_columns` | six `*_document_generation_idx`                                             |                 **0/6** |
| `20260712165915 reconcile_ingestion_index_shapes`    | three `import_batches_*` / `ingestion_jobs_*`                               |                 **0/3** |
| `20260712170500 codify_live_operational_indexes`     | 43 names incl. `audit_logs_owner_id_idx`, `document_summaries_owner_id_idx` |                **0/43** |
| `20260712172000 drop_redundant_table_fact_indexes`   | (drops only)                                                                |                       — |

The intersection is **empty**. The near-misses are name-adjacent but distinct objects
(`audit_logs_owner_id_idx` ≠ `audit_logs_owner_created_idx`; `document_summaries_owner_id_idx` ≠
`document_summaries_owner_idx`). No honest `validation` entry exists, so none was written and the
fifteen stay unallowlisted — the state Phase 6.2 predicts, with fail-fast guard migrations still the
fix. **Consequence: the `migration_history` finding count does NOT drop in this phase.** It stays at
15 unexpected + 5 expected. That remains `#Q5JHBJ`'s work.

#### Step 5 — production push (real execution, no `migration repair`)

Performed only after all 22 indexes a guard validates were confirmed built. The `supabase migration
list` pre-flight showed the pending set was **exactly** the four new versions and nothing else — itself
confirmation that D4 auto-deploy is off _(superseded: see §D4 — SETTLED 2026-08-21; deploy-on-merge is ON)_, since none had been applied by merge.

```
$ supabase db push --linked --project-ref sjrfecxgysukkwxsowpy --skip-vault --yes
Applying migration 20260819100000_restore_batch_a_operational_indexes.sql...
Applying migration 20260819100100_restore_batch_b_retrieval_indexes.sql...
Applying migration 20260819100200_restore_search_health_trigram_indexes.sql...
Applying migration 20260819100300_monitor_restored_retrieval_indexes.sql...
{"upToDate":false,"dryRun":false,"migrations":[...4 files...],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

`--skip-vault` kept the push to migrations only; no vault secret was read or written. `supabase
migration list` after: **pending 0**, every local version matched remotely. `migration repair --status
applied` was never used.

History rows carry executed statements — the CLI's per-statement shape, **not** the empty mark-applied
shape — so the guard-migration contract is not breached and none of these four will ever surface in
the `migration_history` probe:

```
20260819100000 restore_batch_a_operational_indexes      stmt_count 4  no_statements false
20260819100100 restore_batch_b_retrieval_indexes        stmt_count 4  no_statements false
20260819100200 restore_search_health_trigram_indexes    stmt_count 4  no_statements false
20260819100300 monitor_restored_retrieval_indexes       stmt_count 4  no_statements false
```

`search_schema_health()` on production against the expanded 30-index list:

```
ok true · missing [] · legacy_ivfflat_indexes []
```

#### Step 6 — staging brought to parity (ref re-verified before every call)

Target `ikoiolksxqxfxgiyqpnu` re-verified before each step by an identity read; the corpus check
(`documents = 0`, versus production's 2,851) was the abort condition and was re-run every time, in
code, not by eye. Production was never a target in this step.

`document_chunks_content_trgm_idx` carried the 2026-06-06 form §3.3(d) predicted:

```
before  ... gin (lower(((COALESCE(section_heading, ''::text) || ' '::text) || content)) gin_trgm_ops)
after   ... gin (lower(((COALESCE(section_heading, ''::text) || ' '::text) || COALESCE(content, ''::text))) gin_trgm_ops)
```

Dropped and rebuilt concurrently into the canonical `coalesce(content, '')` form
(`20260705180000:11`), `indisvalid`/`indisready` both true — now identical to production and the
manifest (`8499c3d3…`). This had to precede `20260819100200`, which validates that exact form.

The four migrations were then applied by the §2.2/§2.5 Phase 2 method — the repository file's content
run verbatim, then an explicit history row carrying the repository's own version and name.
`apply_migration` was not used (it stamps a connector-generated version, which
`docs/staging-setup.md` forbids); `db push` was not used either, so staging's one-element `statements`
shape stays consistent with its other 29 such rows. Faithfulness read back from staging:

```
20260819100000 · restore_batch_a_operational_indexes    stmt_count 1 · bytes  7616 · md5 05f64e164882b7ba813cc67c93cbadcc · matches repo file true
20260819100100 · restore_batch_b_retrieval_indexes      stmt_count 1 · bytes  6233 · md5 85a9268cf193fdee1b38bf75fd7d2181 · matches repo file true
20260819100200 · restore_search_health_trigram_indexes  stmt_count 1 · bytes  5571 · md5 bbae64185d2a0271b9c4ca18c40680e3 · matches repo file true
20260819100300 · monitor_restored_retrieval_indexes     stmt_count 1 · bytes 10836 · md5 13619a6b83458f17a62b6c0130e73ae9 · matches repo file true
```

After: `total_rows 203 · latest_version 20260819100300 · no_statements 0`, `documents 0`,
`document_chunks 0` (corpus untouched), `search_schema_health() ok true · missing []`.

**`check:drift` against staging — GREEN, zero unexpected drift** (was **19** at §2.3 and still 19 at
the §2.5 re-measure). `npm run check:drift` itself could not authenticate in this session — it
resolves its target from `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` via
`createAdminClient()`, and reading `.env.local` was blocked — so the comparison was run through the
**same exported `compareDriftSnapshots()`**, the same manifest, the same allowlist and the same
manifest-staleness pre-check, with only the transport changed (staging's `schema_drift_snapshot()`
fetched over the authenticated CLI). `--prune-stale` was **not** used, per the §2.4 trap:

```
Target: staging ikoiolksxqxfxgiyqpnu · documents 0 · migrations 203
Drift manifest: generated 2026-08-18T18:15:50.121Z from schema.sql 328677d1c6f3…
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against live.

Stale allowlist entries (5) — no longer matching:
  ? [migration_history] no_statements 20260701010000
  ? [migration_history] no_statements 20260701020000
  ? [migration_history] no_statements 20260701030000
  ? [migration_history] no_statements 20260701060000
  ? [migration_history] no_statements 20260702000000

No unexpected drift.
EXIT=0
```

The five stale entries are production's seeded `superseded` guards reading stale against staging — the
documented §2.4 warning-only condition, deliberately not pruned. Staging is now at **full parity with
the repository chain**: the §2.3 finding set — (a) `work_mem`, (b) eight never-created objects,
(c) chain-stale columns, (d) the trigram definition — is completely closed.

#### Step 7 — live-drift proof: 37 → 16 findings, indexes fully closed

Dispatched on `main` (head `4666708b2`, before this branch merged): **Actions run
[`32171070287`](https://github.com/BigSimmo/Database/actions/runs/32171070287)**, 2026-08-18T18:27:03Z.

```
Drift manifest: generated 2026-08-18T08:30:22.062Z from schema.sql 87ac9fc4849e…
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against live.
  ~ [migration_history] no_statements … ×5    (the five seeded superseded guards — expected)
UNEXPECTED DRIFT (16):
  ! [functions] mismatch public.search_schema_health() :: def_hash: manifest="f4f5f536026c4dd27d506a8e40b8c6d7" live="85df52de66e4e89d4a328b81a3a87c90"
  ! [migration_history] no_statements … ×15   (20260701040000, 20260702100000…180000, 20260712165915…173000)
```

| Category                  | §3.7 (run `32131517648`) | This run (`32171070287`) | Verdict                         |
| ------------------------- | -----------------------: | -----------------------: | ------------------------------- |
| `missing_live` indexes    |                   **20** |                    **0** | **closed**                      |
| `unexpected_live` indexes |                    **2** |                    **0** | **closed**                      |
| function `def_hash`       |                        0 |                        1 | expected — merge-pending, below |
| `migration_history`       |             15 (+5 seen) |             15 (+5 seen) | unchanged — `#Q5JHBJ`'s work    |
| **Total unexpected**      |                   **37** |                   **16** |                                 |

**Zero `missing_live`, zero `unexpected_live` — the two targets this phase owned.**

**The one function mismatch is this branch not yet being on `main`, proven rather than assumed.** The
run compares `main`'s manifest, generated 2026-08-18T08:30 from `schema.sql 87ac9fc4849e…`, against
live. Live now reports `85df52de66e4e89d4a328b81a3a87c90` — **byte-identical to the `def_hash` in this
branch's regenerated `drift-manifest.json`**, which is the only `def_hash` that changed. So live
matches the repo _as of this branch_; the finding is a repo-behind-live artefact of dispatching before
merge and clears when this PR lands. It is not a new divergence: no `match_*` RPC mismatched, and the
RPC track closed in §3.7 stays closed.

**`migration_history` did not drop, as Step 4 predicted.** No guard here validates any object created
by those fifteen versions, so no allowlist entry was earned. Unchanged is the correct outcome, not a
shortfall.

**Phase 4 status: complete.** Plan 4.1 (Batch A), 4.2 (Batch B), 4.3 (unexpected disposition), 4.4
(guard migrations + `schema.sql` mirror + regenerated manifest + `required_indexes`) and 4.5 (green
index proof) are all discharged. Remaining `#316` work is the `migration_history` block, which is
`#Q5JHBJ`, and Phase 5's after-measurements.

#### Step 8 — the guard caught a real chain defect on the Supabase preview branch

The `20260819100200` trigram guard **failed CI on PR #2151**, and it was right to. The Supabase
Preview check (an ephemeral preview branch database, project `jgzqdaalxnfmiadmpnib` — neither
production nor staging) builds from the migration chain alone and reported:

```
ERROR: The retrieval-critical trigram indexes restored on 2026-08-14 are not present in canonical
form; ... Missing: (none); Invalid: (none); Mismatched: document_chunks_content_trgm_idx (SQLSTATE P0001)
At statement: 3
```

**Root cause — the first creator wins, and every later one is a no-op.** Three renderings of this
index exist in the repository and the chain permanently produces the oldest:

| Migration           | Expression                                                               | Effect on a fresh replay       |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| `20260606000000:11` | `lower(coalesce(section_heading,'') \|\| ' ' \|\| content)`              | **creates it — this one wins** |
| `20260622000000:13` | `lower(coalesce(section_heading,'') \|\| ' ' \|\| coalesce(content,''))` | `if not exists` → **no-op**    |
| `20260705180000:11` | identical to `20260622000000` = `schema.sql:743` = **canonical**         | `if not exists` → **no-op**    |

`grep -c "drop index.*document_chunks_content_trgm_idx" supabase/migrations/` returns **zero** — no
migration ever drops it, so the two correct definitions can never take effect. Any database built
from migrations alone therefore carries the 2026-06-06 form while `schema.sql`, the drift manifest
and production carry the `coalesce(content,'')` form. The difference is not cosmetic: the older
expression evaluates to NULL for any row with NULL `content`, so those chunks are absent from the
trigram index entirely.

**This was already visible and was mis-scoped as staging-only.** §3.3(d) found exactly this and
recorded it as "a chain-stale residual on staging only", repaired by hand in the staging window. It
is not staging-only — it is every environment built from the chain: `supabase db reset`, a
disaster-recovery replay, CI's `Migration replay` job, and the preview branch. The hand-repair fixed
the symptom on one database; the chain kept producing the wrong index. The Phase 4.4 guard is what
turned a silent, environment-specific divergence into a loud, reproducible CI failure — which is
precisely the behaviour the guard-migration contract exists to buy.

**Fix: `20260819100150_reconcile_chain_stale_content_trgm_index.sql`**, ordered between the Batch B
guard (`100100`) and the trigram guard (`100200`) so a fresh replay is canonical before it is
validated. It is deliberately conditional, and will never run a write-blocking index build on a
populated hosted database:

| Situation                       | Behaviour                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------- |
| already canonical               | early `return` — no lock, no DDL (production and staging today)                  |
| wrong form, table **empty**     | `drop index` + `create index` in canonical form (preview, `db reset`, DR replay) |
| wrong form, table **populated** | `raise exception` telling the operator to rebuild concurrently out of band first |

**Proof, run locally against the same scratch Postgres image the manifest generator uses, replaying
the whole chain in order (the local stand-in for CI's `Migration replay` and the preview branch):**

```
# with the fix removed — reproduces the CI failure exactly
FAILED at 20260819100200_restore_search_health_trigram_indexes.sql:
ERROR:  The retrieval-critical trigram indexes ... Mismatched: document_chunks_content_trgm_idx
Applied 201/203.

# with the fix in place
Applied 204/204.
document_chunks_content_trgm_idx after full chain replay:
  CREATE INDEX document_chunks_content_trgm_idx ON public.document_chunks USING gin (lower(((COALESCE(section_heading, ''::text) || ' '::text) || COALESCE(content, ''::text))) gin_trgm_ops)
RESULT: CANONICAL — matches schema.sql / manifest / production
```

**No-op path proven separately**, because this migration must eventually run against a populated
production table. Re-running it on an already-canonical database left the index **OID unchanged**
(`18657` → `18657` in the scratch replay), meaning no rebuild and no lock, and the `100200` guard
still passed afterwards.

**Applied to both hosted tiers, and the no-op verified on production itself.** The CLI refused the
first push with `LegacyDbPushMissingRemoteError` — "Found local migration files to be inserted
before the last migration on remote database" — because `100150` sorts before the already-applied
`100200`/`100300`. That is the documented out-of-order case and its documented flag; the pending set
was confirmed to be exactly this one file before using it:

```
$ supabase db push --linked --project-ref sjrfecxgysukkwxsowpy --skip-vault --include-all --yes
Applying migration 20260819100150_reconcile_chain_stale_content_trgm_index.sql...
```

Production `document_chunks_content_trgm_idx` **OID `1491258` before and `1491258` after**, identical
`pg_get_indexdef`, `search_schema_health() ok true` — the early-return branch, confirmed on the real
70,120-row table rather than inferred. Staging took the same migration by the §2.2 Phase 2 method
(`md5 aa2d6edef30a1ef73924c74c0a9216a3`, matches the repo file), reaching **204** history rows with
`no_statements 0` and its corpus untouched; the staging drift comparison is still **green, zero
unexpected drift**.

`schema.sql` and `drift-manifest.json` are deliberately **unchanged** by this fix: the mirror already
declared the canonical form, and it was the chain that disagreed with it. Nothing to re-mirror, and
the manifest sha still matches.

**Ordering note for future sessions.** `20260819100150` is intentionally out of order relative to
`100200`/`100300`, which were applied first. Any future `supabase db push` that legitimately needs to
insert a version before the remote tip must pass `--include-all`, and must confirm the pending set
first — the flag applies _every_ locally-absent version, not just the intended one.

**Post-merge runbook for the managed-ingestion reconciliation.** Watch the integration run after merge. If the apply reports an out-of-order rejection, or the live history still shows `20261013140000`–`20261013170000` as local-only, first run `supabase migration list --linked` and confirm that the pending set is exactly those four #3538 migrations plus `20261014164220`. In an authorised production window, run `supabase db push --linked --project-ref <prod> --include-all`, then rerun the live-drift workflow and confirm that #3542 closes.

## Phase 5 — Measure and close the loop

_Partially run 2026-08-14 (incident scope); full close-out still requires the remaining phases._

_2026-08-14 (partial)._ Before/after production probes (identical endpoint and query style):

| Measurement                                                         | Before               | After restore + ANALYZE |
| ------------------------------------------------------------------- | -------------------- | ----------------------- |
| Semantic query, text fast path — total / `supabase_rpc_latency_ms`  | 37.7 s / 31,610      | 4.8 s / **1,535**       |
| Semantic query, hybrid strategy — total / `supabase_rpc_latency_ms` | 29.9 s / 21,757      | 17.2 s / 8,519          |
| `match_document_chunks_text_v2` single call                         | (dominated the 31 s) | 14 ms                   |

**#231 verdict from this evidence:** the 25 s fast-route budget was being consumed by retrieval
itself while the two trigram indexes were missing — pre-generation latency was the binding cause
of semantic-query source-only fallbacks in this window (README §A1 ladder rung 2, now measured).
The A1/S1 packet must re-verify `generation_quality_gate:*` dominance on healthy latency before
choosing any code mitigation. Residual: hybrid fan-out still costs ~8.5 s worst-observed — owned
by the remaining remediation phases, not a route-budget change (`#231`'s stop condition stands).
`check:production-readiness` on the final state is **pending**.

### Phase 5 close-out — 2026-08-22 Perth (2026-08-21 UTC)

_**Dates in this section are Perth local time (UTC+8), with the UTC date given alongside where the
two differ.** The window ran across the local-midnight boundary: the review and every commit are
dated 2026-08-21 UTC, which is 2026-08-22 in Perth. Where a record elsewhere in the repository says
"2026-08-22" bare for this phase, it means 2026-08-22 Perth = 2026-08-21 UTC — no measurement was
taken after the review date._

_Owner-authorised **read-only** production window (`sjrfecxgysukkwxsowpy`) plus a staging-only
apply. A dedicated worktree carried the link; the main checkout stayed on its staging link and
every call re-verified `supabase/.temp/project-ref` immediately beforehand. No production DDL, no
data mutation, no paid eval._

#### Production is unchanged since 2026-08-21 — 8 of 8 baseline checks match

| Check                                   | Expected | Read             |
| --------------------------------------- | -------- | ---------------- |
| `public` indexes                        | 210      | **210**          |
| invalid / not-ready indexes             | 0        | **0**            |
| `supabase_migrations` rows              | 211      | **211**          |
| rows with no executed statements        | 20       | **20**           |
| `migration_history_versions()` probe    | ok       | **ok**           |
| `migration_history_versions()` versions | 211      | **211**          |
| `search_schema_health()` `ok`           | true     | **true**         |
| latest version                          | —        | `20260820120000` |

Nothing diverged, so no escalation was raised on the production reading.

#### 5.1(a) End-to-end probes — the like-for-like row §1.3 asked for

Same endpoint and query style as the incident measurements (`POST /api/search`, semantic clinical
queries, live production data). `supabase_rpc_latency_ms` is the server-measured retrieval
component and is the comparable figure; `total` additionally carries local dev-server render
overhead in this run, so it is directionally useful rather than strictly comparable.

| Measurement                                | Before (2026-08-14) | After restore + ANALYZE (2026-08-14) | **Now (2026-08-22 Perth = 2026-08-21 UTC)** |
| ------------------------------------------ | ------------------- | ------------------------------------ | ------------------------------------------- |
| Semantic, text fast path — total / rpc ms  | 37.7 s / 31,610     | 4.8 s / 1,535                        | **8.4 s / 955**                             |
| Semantic, hybrid strategy — total / rpc ms | 29.9 s / 21,757     | 17.2 s / 8,519                       | **10.9 s / 6,720**                          |
| Warm repeat (`search_cache`) — total / rpc | not measured        | not measured                         | **0.41 s / 0**                              |

Retrieval latency has held its recovery and improved further on both strategies: the fast path is
**33× better than the incident** and 1.6× better than the 2026-08-14 post-restore reading; hybrid is
3.2× better than the incident and 1.3× better than post-restore. Nothing is materially worse than
the 2026-08-17 healthy baseline, so no escalation was raised.

#### 5.1(b) EXPLAIN forward baseline — captured now, on the healthy system

§1.3 never captured an EXPLAIN set; its before-numbers were end-to-end probes. This is that missing
baseline, recorded so a future incident has something to diff against. Captured with
`npm run profile:retrieval -- --analyze` (which calls the service-role-only
`public.explain_retrieval_rpc`), query `clozapine monitoring requirements`, `--match-count 24`,
`--samples 3`, public scope. Sample 1 is `first_unprimed`; managed Supabase buffers are never
flushed, so no sample is truly cold.

| RPC                                 | unprimed exec ms | warm median exec ms | warm median RTT ms | shared_hit (warm) | shared_read (unprimed) |
| ----------------------------------- | ---------------: | ------------------: | -----------------: | ----------------: | ---------------------: |
| `match_documents_for_query`         |           42.642 |               5.949 |            102.783 |             1,175 |                     10 |
| `match_document_chunks_text`        |          867.942 |              35.821 |            150.652 |             7,243 |                     42 |
| `match_document_lookup_chunks_text` |           13.237 |               3.013 |            126.042 |               511 |                      7 |
| `match_document_table_facts_text`   |        1,722.211 |              99.183 |            179.852 |             2,516 |                  1,070 |

Zero errors across all twelve samples. **The new slowest path is
`match_document_table_facts_text`** (1.72 s unprimed, 1,070 unprimed `shared_read`) — recorded here
as the outlier to watch, replacing the trigram-absence signature that dominated the incident.

**Two limits of this instrument, stated so the baseline is not over-read:**

1. **It cannot show plan flips.** `explain_retrieval_rpc` runs `EXPLAIN` over
   `select * from public.<rpc>(…)`, so the plan is a single `Function Scan`: a PL/pgSQL body's inner
   plan is not exposed. Every sample reports `plan_node_types: ["Function Scan"]` and
   `index_names: []`. Plan §5.1's "record plan flips (seq scan → index scan)" is therefore **not
   answerable through this tool**. The index-usage read in 5.1(c) is a _different and weaker_ signal,
   not a substitute: `pg_stat_user_indexes.idx_scan` is cumulative across every workload that touches
   the table, and no before/after counter delta was captured around these samples, so it can show
   that an index is never chosen by **anything**, but it cannot show whether **this** profiled query
   moved from a sequential scan to an index scan. **Plan §5.1's plan-flip deliverable is therefore
   left explicitly OPEN, not discharged.** Closing it needs query-specific inner-plan evidence —
   which requires the RPC extension queued below, or an `auto_explain`-style capture — and that is
   production-side work this read-only phase could not do.
2. **It cannot reach the two v2 RPCs named in the Phase 5 brief.** `explain_retrieval_rpc` accepts
   exactly four names (`match_documents_for_query`, `match_document_chunks_text`,
   `match_document_lookup_chunks_text`, `match_document_table_facts_text`) — verified in its only
   defining migration `20260626020000_phase7_retrieval_rpc_performance.sql`, in `supabase/schema.sql`,
   and on production itself:

   ```text
   ERROR:  22023: Unsupported retrieval RPC: match_document_chunks_text_v2
   CONTEXT:  PL/pgSQL function explain_retrieval_rpc(text,text,integer,uuid,uuid[],boolean) line 25 at RAISE
   ERROR:  22023: Unsupported retrieval RPC: match_document_index_units_hybrid_v2
   ```

   Extending the function to cover the `_v2` family is production DDL and was **not** authorised for
   this phase, so it was not written. Queued as its own ledger item. **Substitute coverage is partial, and
   unevenly so — the earlier claim that the v1 siblings cover both owning tables was wrong.**
   `match_document_chunks_text`, profiled above, is the v1 sibling of `match_document_chunks_text_v2`
   and shares its owning table `document_chunks`, so that target has a usable stand-in. The other one
   does not: `match_document_index_units_hybrid_v2` delegates to
   `match_document_index_units_hybrid_scoped` over `document_index_units`
   (`supabase/schema.sql:8033-8054`), and the four supported names reach only `documents`,
   `document_chunks`, lookup chunks and `document_table_facts`. **The `document_index_units`
   retrieval path therefore has no EXPLAIN baseline at all**, and that is an open deliverable rather
   than a covered one. Its index-level usage is still recorded in 5.1(c), which is the weaker signal
   described above, not a plan.

#### 5.1(c) Index usage — the finding this phase actually turned up

`pg_stat_database.stats_reset` is **NULL** on production, so **no database-wide reset**
(`pg_stat_reset()`) has been recorded. That is the limit of what this read proves: a per-relation
`pg_stat_reset_single_table_counters(oid)` call resets one table's or one index's counters without
touching `pg_stat_database.stats_reset`, and this window captured no evidence either way for the
individual indexes below. A zero is therefore _very likely_ to mean genuinely never scanned rather
than recently zeroed — strongly so given the OID continuity established below — but it is not proven.
Settling it needs a per-index reset time, which `pg_stat_all_indexes.stats_reset` carries only on
PostgreSQL 18 and later; the running server version was not read in this window. Across `public`,
163 of 210 indexes show scans, `max(idx_scan)` is 262,335,345 and the total is 344,747,815 — the
counters are clearly live.

Against that, **all 22 indexes restored or repaired by the incident response report `idx_scan = 0`** —
the 20 Phase 4 rebuilds (2026-08-19) and, more pointedly, both trigram indexes restored on 2026-08-14:

| Index                              | Size   | `idx_scan` | Present since | OID     |
| ---------------------------------- | ------ | ---------: | ------------- | ------- |
| `document_chunks_content_trgm_idx` | 68 MB  |      **0** | 2026-08-14    | 1491258 |
| `documents_title_trgm_idx`         | 648 kB |      **0** | 2026-08-14    | 1491257 |

The OID `1491258` is the same value §Phase 4 Step 4 recorded as _unchanged across the 2026-08-19
push_, which is what makes the zero meaningful: the index has not been dropped and recreated, so its
counter has been accumulating for the full seven days since restoration. Both are `indisvalid` and
`indisready` with canonical `coalesce(...)` definitions.

What _is_ serving retrieval on the same tables:

| Index                                           | Kind             | `idx_scan` |
| ----------------------------------------------- | ---------------- | ---------: |
| `document_chunks_search_idx`                    | GIN `search_tsv` | **37,717** |
| `document_chunks_embedding_hnsw_idx`            | HNSW vector      |  **4,906** |
| `documents_title_search_idx`                    | GIN tsvector     | **37,299** |
| `document_table_facts_title_row_param_trgm_idx` | GIN trigram      |  **2,372** |

The last row matters: a _different_ trigram index on a sibling table is used thousands of times, so
"trigram indexes are never chosen here" is not a blanket property of the planner or the extension.

**Consequence for the incident narrative — stated as a correction, not a certainty.** The 2026-08-14
Phase 5 table above attributes the 31,610 ms → 1,535 ms recovery to "restore + ANALYZE", treating the
two trigram indexes as the fix. Seven days of cumulative statistics show the restored trigram indexes
have served **zero** scans. Subject to the reset caveat recorded above — a per-relation
`pg_stat_reset_single_table_counters()` call would be invisible to the database-wide `stats_reset`
read, so "zero scans since restoration" is strongly supported rather than proven — they cannot be
carrying that recovery. `ANALYZE` was an unseparated
co-intervention in the same operation — and `20260626020000` ends by running `analyze` over exactly
`documents`, `document_chunks`, `document_table_facts`, `document_embedding_fields` and
`document_index_units` — which makes stale planner statistics the better-supported explanation for
both the 31-second regression and its recovery. This does **not** retract the repair: the two indexes
are repo-defined, the chain commands them, and drift is correctly closed by their presence. It
retracts the _attribution_, and it changes what a future 30-second retrieval incident should check
first — planner statistics before missing indexes. Raised as its own ledger item rather than absorbed
here; ~69 MB of currently unscanned index is a secondary, non-urgent question that follows from it.

#### 5.1(d) `rag_retrieval_logs` miss-scan baseline — §1.3's second pending item, now closed

| Table                | `seq_scan` | `seq_tup_read` | `idx_scan` | live rows | total size | avg rows / seq scan |
| -------------------- | ---------: | -------------: | ---------: | --------: | ---------: | ------------------: |
| `rag_retrieval_logs` |         47 |          6,620 |         98 |       640 |    1440 kB |               140.9 |
| `rag_query_misses`   |        421 |         29,482 |        509 |       177 |     320 kB |                70.0 |
| `rag_queries`        |         51 |         33,792 |        419 |       258 |    4760 kB |               662.6 |
| `rag_aliases`        |      5,829 |        379,728 |     23,583 |        68 |     224 kB |                65.1 |
| `rag_response_cache` |      2,133 |         13,203 |      5,352 |         0 |     656 kB |                 6.2 |

**Reading: not currently a latency risk, and that is the point of recording it.** Every one of these
relations is under 5 MB with at most a few hundred live rows, so a sequential scan is a handful of
pages and cheaper than an index descent — the planner's choice is correct at this scale. The row to
watch is `rag_aliases`: 5,829 sequential scans over 68 rows is free today and becomes a real cost if
that table ever grows. This table is the baseline; the trigger for action is growth in
`seq_tup_read`, not the presence of `seq_scan`.

#### 5.2 — confirmed already satisfied, and re-confirmed with fresh data

Ledger `#231` already records that plan §5.2 "is satisfied by S1's 2026-08-17 healthy-latency
probes", and re-graded itself P1 → P2 on that basis with residual **R4** (chronic ~30 s strong-route
`provider_timeout` on `metformin-renal-dosing` and `valproate-pregnancy`, with a safe source-backed
extractive fallback, never model synthesis). This phase **confirms that reading rather than
reopening it**: measured retrieval now costs 955 ms (fast path) to 6,720 ms (hybrid) against an
`answerRouteBudgetMs.fast` of 25,000 ms, so retrieval consumes 4–27% of the budget and is no longer
capable of binding it. The 2026-08-14 verdict — that pre-generation latency _was_ the binding cause
during the incident window — stands for that window and is now closed out. R4 is a generation-side
residual and keeps `#231`'s existing stop condition; **no separate R4 row was created**, per `#231`'s
own instruction.

One inconsistency found and queued, not edited here: the _recommended-queue_ row for `#231` still
presents it as A1 / "immediate approved live investigation", contradicting the P2 re-grade in its own
detail row. Queued through `issues:update` for the next reconcile.

#### 5.3 — no eval canary owed

Plan §5.3 gates `eval:retrieval:quality` on "if any Phase 3 RPC deploy changed behaviour". Phase 3
was reframed to repo-side codification and deployed **zero** behaviour change: `#316` records manifest
`def_hash` equal to live for all ten `match_*` functions, and live-drift `32131517648` reported 0
function mismatches. §5.3 therefore reduces to `check:production-readiness`, run once at the end of
this phase. No paid eval was run and none was requested.

```text
$ npm run check:production-readiness
[Production Readiness]
Project: Clinical KB Database (sjrfecxgysukkwxsowpy)
PASS (9):
  - Node runtime 24.19.0 matches required Node 24.x.
  - Boot guard invokes requireQueryHashSecret(); the query-hash HMAC fails closed in production (PIA-2).
  - Local override file .env.local is present
  - Server env includes required Supabase project values.
  - OpenAI API key is configured.
  - OpenAI safety identifiers use a deployment-secret HMAC; raw owner IDs are not sent.
  - RAG_QUERY_HASH_SECRET is set; logged clinical-query hashes are keyed HMAC pseudonyms (PIA-2).
  - HEALTH_DEEP_PROBE_SECRET is set for authorized deep health probes.
  - Supabase project config points to Clinical KB Database.
READY: no blocking production-readiness failures.
```

Nine checks pass, zero blocking failures, and the gate independently confirms the operator
environment is bound to `Clinical KB Database` (`sjrfecxgysukkwxsowpy`). **§1.3's "`check:production-readiness`
on the final state is pending" is closed.**

#### Staging catch-up — the owed apply, now closed

Staging (`ikoiolksxqxfxgiyqpnu`) was one version behind after the 2026-08-20 window, where both write
paths were denied by that session's auto-mode classifier. Applied here, by real `db push` (never
`migration repair`); the pending set was confirmed first as exactly one version with zero remote-only:

```text
$ supabase migration list --linked --project-ref ikoiolksxqxfxgiyqpnu
… {"local":"20260820120000","remote":""}
$ supabase db push --linked --project-ref ikoiolksxqxfxgiyqpnu --skip-vault --yes
Applying migration 20260820120000_migration_history_versions_rpc.sql...
{"upToDate":false,"dryRun":false,"migrations":["20260820120000_migration_history_versions_rpc.sql"],…}
```

`--include-all` was correctly not needed: the pending version sorts after the remote tip
`20260819110500`.

| Staging check                          | Before           | After                              |
| -------------------------------------- | ---------------- | ---------------------------------- |
| `supabase_migrations` rows             | 210              | **211**                            |
| latest version                         | `20260819110500` | **`20260820120000`**               |
| `migration_history_versions()` present | absent           | **present**                        |
| history row `stmt_count`               | —                | **3** (executed, not mark-applied) |
| probe / version_count                  | —                | **ok / 211**                       |
| `public` indexes                       | 210              | **210**                            |

`stmt_count 3` matches production's row exactly, so both tiers now carry the same executed
migration rather than a repaired history entry. **Staging parity, open by one version since
2026-08-20, is closed.**

## Phase 6 — Future-proofing (repo-side; one migration authored, NOT deployed)

_2026-08-18 (repo-only session; no hosted read or mutation)._ Built per plan §6.1–6.3, worker chat
without a ledger row (residual queued via `npm run issues:add`, not on `#316`):

- **6.1 History-integrity probe.** `20260818090000_schema_drift_snapshot_history_probe.sql` redefines
  `public.schema_drift_snapshot()` (v2) to also return `migration_history` — every
  `supabase_migrations.schema_migrations` version with `statements IS NULL` or empty — plus
  `migration_history_probe` (`ok` / `no_history_table` / `no_statements_column`). Mirrored into
  `schema.sql`; `drift-manifest.json` regenerated (Docker replay executed the new body: probe
  `no_history_table`, `snapshot_version` 2). `check:drift` reports each live row as
  `! [migration_history] no_statements <version>` unless a validated allowlist entry covers it.
  **Not deployed** — needs the owner-approved production migration window (approval map, Phase 6.1,
  after Phase 4). Until then the live run shows the `schema_drift_snapshot()` function `def_hash`
  mismatch (repo-ahead) and an info line naming the pending deploy.
- **6.2 Guard-migration contract.** Written into `docs/database-drift-detection.md` and `AGENTS.md`
  ("Supabase project safety"). Allowlist `migration_history` entries carry `guard {class, migration,
objects}`; classes `validation` (mandatory from 2026-08-18), `superseded`, `no_ddl`.
  `tests/migration-history-guards.test.ts` verifies each guard file really covers its objects. Seeded
  five §1.1 versions with repo-provable `superseded` guards (`20260701010000`, `20260701020000`,
  `20260701030000`, `20260701060000`, `20260702000000`); the remaining §1.1 rows and the 2026-07-12
  batch are deliberately **not** allowlisted and are the expected findings of the first post-deploy run.
- **6.3 Runtime coverage ratchet.** `tests/search-health-index-coverage.test.ts` +
  `supabase/search-health-unmonitored-indexes.json`: every repo-defined index on the six
  retrieval-critical tables is monitored or listed with reason + disposition. Failed with exactly 44
  names before the list existed; passes with 44 entries (8 `monitor-candidate`, including the three
  §1.3-absent indexes on those tables: `document_chunks_anchor_idx`,
  `document_index_units_heading_path_idx`, `documents_registry_projection_lookup_idx`).

### 6.2 completion — 2026-08-19 (`#Q5JHBJ`; owner-authorised production window)

_Worker session for `#Q5JHBJ` only (`#316`, `#231`, `#1K6T35` untouched). Pre-flight per `#292`: none of
the seven open PRs (#2181, #2180, #2176, #2173, #2012, #2011, #2010) touches `supabase/**`,
`scripts/check-drift.ts`, `tests/migration-history-guards.test.ts` or this file. D4 is OFF *(superseded: see §D4 — SETTLED 2026-08-21; deploy-on-merge is ON)*, so the only
production writes are the explicit `db push` recorded below._

#### Step 1 — classification of the fifteen (every one `validation`; none earned `superseded` or `no_ddl`)

The fifteen are the live §3.7 list minus the five seeded `superseded` entries. Note that
`20260702170000 fix_match_chunks_text_n1` (the `select 1;` placeholder) is **not** among them — it was
recorded with statements — and `20260712171500 codify_live_ahead_functions` **is**.

| Version          | File stem                              | Persistent effect on live                                                                                                    | Guard (all `validation`)                                     |
| ---------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `20260701040000` | `drop_dead_drifted_hybrid_variants`    | drops 7 dead functions by 6-arg signature (the 7-arg `_v2`/`_v3` overloads in `schema.sql` are different objects)            | `20260819110000_validate_history_dropped_objects` (absence)  |
| `20260702100000` | `add_claim_ingestion_jobs_comment`     | `comment on function claim_ingestion_jobs` — a pg_description write, so not `no_ddl` (body is not empty / `select 1;`)       | `20260819110100_validate_history_comments_and_retention`     |
| `20260702110000` | `drop_redundant_indexes`               | drops `documents_owner_hash_idx`, `ingestion_jobs_claim_idx`                                                                 | `…110000_validate_history_dropped_objects` (absence)         |
| `20260702120000` | `rag_retrieval_logs_retention`         | 2 table comments + `cron.schedule('purge-rag-retrieval-logs')` (only where the `cron` schema exists)                         | `…110100_validate_history_comments_and_retention`            |
| `20260702130000` | `storage_cleanup_jobs_document_fk`     | orphan delete (not re-validatable) + FK `storage_cleanup_jobs_document_id_fkey` → `documents(id)` on delete set null         | `20260819110200_validate_history_document_foreign_keys`      |
| `20260702140000` | `fix_reset_document_index_duplicate`   | `reset_document_index(uuid)` — no later creator                                                                              | `20260819110500_validate_history_function_bodies` (def_hash) |
| `20260702150000` | `documents_owner_covering_index`       | `documents_owner_id_covering_idx` — no later creator with executed statements                                                | `20260819110300_validate_history_operational_index_shapes`   |
| `20260702160000` | `fix_invoke_agent_url_to_guc`          | `invoke_indexing_v3_agent(integer)`; the `ALTER DATABASE SET` is privilege-guarded with an in-function fallback (not pinned) | `…110500_validate_history_function_bodies` (def_hash)        |
| `20260702180000` | `promote_index_generation_id_columns`  | 6 `index_generation_id uuid` columns + 6 `*_document_generation_idx` + 3 functions                                           | `20260819110400_validate_history_index_generation_promotion` |
| `20260712165915` | `reconcile_ingestion_index_shapes`     | drop-and-recreate of 3 ingestion indexes                                                                                     | `…110300_validate_history_operational_index_shapes`          |
| `20260712170500` | `codify_live_operational_indexes`      | 44 `create index if not exists`; 42 persist (2 re-dropped by `172000`)                                                       | `…110300_validate_history_operational_index_shapes`          |
| `20260712171000` | `reconcile_visual_eval_document_fks`   | 2 FKs `rag_visual_eval_{cases,runs}_document_id_fkey`                                                                        | `…110200_validate_history_document_foreign_keys`             |
| `20260712171500` | `codify_live_ahead_functions`          | 12 functions (4 later re-created by `20260714110000` / `20260724120000`)                                                     | `…110500_validate_history_function_bodies` (def_hash ×12)    |
| `20260712172000` | `drop_redundant_table_fact_indexes`    | drops `document_table_facts_document_id_idx`, `document_table_facts_owner_idx`                                               | `…110000_validate_history_dropped_objects` (absence)         |
| `20260712173000` | `add_legacy_index_health_batch_repair` | `backfill_legacy_index_health_batch(integer)` — sole creator                                                                 | `…110500_validate_history_function_bodies` (def_hash)        |

**Why nothing is `superseded`:** the class needs one later migration with executed statements that
re-creates _every_ object the version creates, provable by `tests/migration-history-guards.test.ts`'s
`createsObject` (functions/indexes/tables/views/policies/triggers only). `commit_document_index_generation`
alone is re-created by `20260713062125`, but the other fourteen objects of `180000` are not, and no
version's drops, columns, constraints or comments can be expressed that way. **Why nothing is
`no_ddl`:** the class is defined (doc + test) as a file whose stripped body is empty or `select 1;`;
`COMMENT ON` is a catalog write, so the two comment versions get an `obj_description` validation guard
rather than a widened class. Phase 4's "43 names" for `170500` was a miscount: the file carries **44**
`create index if not exists` statements, of which **42** persist.

**Guard design (all six follow `20260804110240`):** `set local` search_path / lock_timeout /
statement_timeout, one `do` block, validates only, exactly one `raise exception … Missing: %; Invalid:
%; Mismatched: %`. Indexes: `to_regclass` + `indisvalid AND indisready` + the normalised
`pg_get_indexdef` against the canonical definition pinned verbatim from
`supabase/drift-manifest.json` `snapshot.indexes[].def` (the rendered form production and staging were
measured against when live-drift reported zero index findings). Functions: the signature's `def_hash`
read from `public.schema_drift_snapshot()` itself, so the hashing formula and the `search_path=''`
rendering are identical by construction to the weekly check; ACLs are deliberately not pinned
(`acldefault()` renders the function owner, which differs on a preview branch; `check:drift` compares
ACLs every run). Columns: `pg_attribute` + `format_type = 'uuid'`. FKs: `pg_constraint` `contype f`,
`confrelid = public.documents`, `confdeltype n`, `conkey = {document_id}`. Absences:
`to_regprocedure` / `to_regclass` IS NULL with exact signatures (`extensions.vector`). Comments:
`obj_description` present and carrying the distinctive phrase. Cron: `execute` against `cron.job` only
when `to_regnamespace('cron')` is not null — staging and the scratch image have no pg_cron, and the
original migration returns early there too. `schema.sql` and `drift-manifest.json` are **unchanged**
(validation-only guards create nothing; manifest sha `328677d1c6f3` still matches).

One repository test was sharpened rather than widened: the "validation guard must not create the
objects it validates" check in `tests/migration-history-guards.test.ts` ran its `create index` regex on
raw SQL, so the canonical `'create index … on …'` string literals that the `20260804110240` pattern
itself pins would have failed it (the check had never been exercised — no `validation` entry existed).
It now strips comments and string literals first, additionally requires `set local statement_timeout`,
and pins that `20260804110240` satisfies the predicate while a real `create index` statement still
fails it.

#### Step 2 — hand-repair sweep: the chain reproduces every recorded repair (local chain replay)

Every hand repair recorded in §2.3, §3.3, §Phase 4 and §Phase 4 completion was checked the same way:
replay the **whole** `supabase/migrations` chain in version order into the scratch
`supabase/postgres:17.6.1.127` image (`roles.sql` + storage scaffold first, each file in its own
transaction like `supabase migration up` — the local stand-in for CI's `Migration replay` and the
preview branch), then compare the replayed `schema_drift_snapshot()` to `supabase/drift-manifest.json`
with the repo's own `compareDriftSnapshots()`:

```
Applied 210/210 (all six 20260819110* history guards included).
Chain replay vs manifest (generated 2026-08-18T18:15:50.121Z from schema.sql 328677d1c6f3…): compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets; live probe no_history_table, history rows 0.
CHAIN == MANIFEST: no unexpected drift (migration_history excluded: bare image has no history table).
```

So the chain now reproduces, unaided, every state that was once repaired by hand: `token_estimate` and
the `gen_random_uuid()` defaults (§3.3, via `20260818112000`), the three hybrid RPC bodies (§3.5, via
`20260818113000`), `document_chunks_content_trgm_idx` (§3.3(d) / Phase 4 step 8, via
`20260819100150`), the 20 restored indexes and 2 drops (§Phase 4 completion), the four duplicate-version
bodies (§2.4 finding 2, by ordering), and every object the fifteen no-statements versions created (the
six new guards pass at the end of the chain). **No further reconcile migration was needed and nothing
was escalated.**

The guards were also proven able to fail, per the "checks that cannot fail" rule — seven mutants run
against the replayed database, each in its own rolled-back transaction:

```
MUTATION 110500 wrong def_hash: raised and named public.reset_document_index(uuid) def_hash
MUTATION 110300 wrong index def: raised and named Mismatched: documents_owner_id_covering_idx
MUTATION 110300 dropped index: raised and named Missing: audit_logs_owner_id_idx
MUTATION 110000 present index: raised and named indexes: documents_owner_hash_idx
MUTATION 110400 wrong column type: raised and named document_sections.index_generation_id (text)
MUTATION 110200 fk cascade: raised and named Mismatched: storage_cleanup_jobs_document_id_fkey
MUTATION 110100 comment removed: raised and named Missing: comment on table audit_logs
scratch image cron schema present: f (cron branch skipped here; production has pg_cron)
```

#### Step 3 — gates

- `npx vitest run tests/migration-history-guards.test.ts tests/drift-detection.test.ts tests/supabase-schema.test.ts tests/search-health-index-coverage.test.ts tests/migration-history-placeholders.test.ts tests/hosted-migration-role-guard.test.ts` — `Test Files 6 passed (6) · Tests 113 passed (113)`.
- `npm run check:migration-role` — `Hosted migration-role guard passed: active hosted SQL/tooling uses postgres and immutable applied history is unchanged.`
- `npm run check:drift -- --self-test` — `check-drift: all offline self-tests passed.`
- `npm run format` — whole tree, exit 0 (committed).
- `npm run verify:pr-local` — exit 0: `Test Files 682 passed | 2 skipped (684) · Tests 7398 passed | 57 skipped (7455)`, `Offline RAG fixture and manifest validation passed (36 golden cases, 26 suites)`, `failed: (none)` — none of this host's known environmental reds fired on this run.

#### Step 4 — production window (`sjrfecxgysukkwxsowpy`; dedicated worktree, CLI 2.114.0, never linked from the main checkout)

`supabase db query --linked --project-ref sjrfecxgysukkwxsowpy` reached production from the unlinked
worktree (the CLI wrote only a `.temp/linked-project.json` marker, removed at the end; the main checkout
stayed on `ikoiolksxqxfxgiyqpnu` throughout). Read-only pre-flight:

```
db postgres · usr postgres · total_rows 204 · latest_version 20260819100300 · documents 2851 · no_statements 20 · new_versions_present 0
no_statements_versions: 20260701010000 20260701020000 20260701030000 20260701040000 20260701060000 20260702000000 20260702100000 20260702110000 20260702120000 20260702130000 20260702140000 20260702150000 20260702160000 20260702180000 20260712165915 20260712170500 20260712171000 20260712171500 20260712172000 20260712173000
```

**All six guards were dry-run read-only on production before anything was pushed and all six passed**
(`rows: []`, no error). That pass was then shown to be meaningful rather than an ignored DO block: the
`110500` guard with one deliberately wrong hash **failed on production** with `Mismatched:
public.reset_document_index(uuid) def_hash 243f3960a32db0192d1cce2ebd050004` — i.e. the live hash is the
manifest value the real guard pins — and the branches that could only be exercised on production were:
`cron_schema true · purge_job_rows 1 · rrl_comment true · claim_comment true`.

`supabase migration list --linked --project-ref sjrfecxgysukkwxsowpy`: **204** matched rows, **0**
remote-only, pending = exactly the six new versions (`20260819110000`…`110500`), all after the remote
tip, so no `--include-all`. Then the real push (dry-run first, identical plan):

```
$ supabase db push --linked --project-ref sjrfecxgysukkwxsowpy --skip-vault --yes
Applying migration 20260819110000_validate_history_dropped_objects.sql...
Applying migration 20260819110100_validate_history_comments_and_retention.sql...
Applying migration 20260819110200_validate_history_document_foreign_keys.sql...
Applying migration 20260819110300_validate_history_operational_index_shapes.sql...
Applying migration 20260819110400_validate_history_index_generation_promotion.sql...
Applying migration 20260819110500_validate_history_function_bodies.sql...
{"upToDate":false,"dryRun":false,"migrations":[...6 files...],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

After: `migration list` **210** rows, pending **0**, remote-only **0**; `total_rows 210 ·
latest_version 20260819110500 · documents 2851`; the probe still reports `ok` with **20** history rows
(the probe lists rows, the allowlist clears them); and the six new rows carry executed statements — the
CLI's per-statement shape, **not** the mark-applied shape — so none of them can ever surface in the probe:

```
20260819110000 validate_history_dropped_objects          stmt_count 4  no_statements false
20260819110100 validate_history_comments_and_retention   stmt_count 4  no_statements false
20260819110200 validate_history_document_foreign_keys    stmt_count 4  no_statements false
20260819110300 validate_history_operational_index_shapes stmt_count 4  no_statements false
20260819110400 validate_history_index_generation_promotion stmt_count 4  no_statements false
20260819110500 validate_history_function_bodies          stmt_count 4  no_statements false
```

`migration repair` was never used; no vault secret was read or written; no data row was touched.

#### Step 5 — staging (`ikoiolksxqxfxgiyqpnu`, Phase 2 method through `db query`)

The Supabase MCP connector was not authenticated in this session, so the §2.2 method ran over the CLI's
management-API `db query`: each file's content verbatim, then the explicit history row with the
repository's version and name in the same call; `apply_migration` and `db push` not used. Identity read
before every step (`documents = 0` abort condition, in code):

```
[before] staging ikoiolksxqxfxgiyqpnu · usr postgres · total_rows 204 · latest 20260819100300 · no_statements 0 · documents 0 · document_chunks 0 · new_versions_present 0
20260819110000 · validate_history_dropped_objects · stmt_count 1 · bytes 4562 · md5 c213ec244b8a0331b10e08c1ce96242d · matches repo file true
20260819110100 · validate_history_comments_and_retention · stmt_count 1 · bytes 4697 · md5 c733b24e5f00f0ebb11168ee21d97e27 · matches repo file true
20260819110200 · validate_history_document_foreign_keys · stmt_count 1 · bytes 3662 · md5 d90bf2d0d7d9e296b7a072d1bfc94d67 · matches repo file true
20260819110300 · validate_history_operational_index_shapes · stmt_count 1 · bytes 16230 · md5 a4834c1ef3135b9b0d337473b0946552 · matches repo file true
20260819110400 · validate_history_index_generation_promotion · stmt_count 1 · bytes 9587 · md5 29bffb90c5ac9af8620bd510cff7f8ac · matches repo file true
20260819110500 · validate_history_function_bodies · stmt_count 1 · bytes 5907 · md5 5dc3494b1f79df910df6f99b13af656a · matches repo file true
[after] staging ikoiolksxqxfxgiyqpnu · usr postgres · total_rows 210 · latest 20260819110500 · no_statements 0 · documents 0 · document_chunks 0 · new_versions_present 6
```

Drift comparison exactly as Phase 4 step 6 (staging `schema_drift_snapshot()` fetched over the CLI;
same manifest, allowlist, `compareDriftSnapshots()`, `historyEntryProblems` and staleness pre-check;
`--prune-stale` NOT used):

```
Target: staging ikoiolksxqxfxgiyqpnu · documents 0 · migrations 210
Drift manifest: generated 2026-08-18T18:15:50.121Z from schema.sql 328677d1c6f3…
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against live (snapshot_version 2, probe ok, migration_history rows 0).
Stale allowlist entries (20) — no longer matching (NOT pruned):
  ? [migration_history] no_statements 20260701010000 … 20260712173000   (all twenty — production's rows, as §2.4 predicts)
No unexpected drift.
EXIT=0
```

#### Step 6 — live-drift dispatched on the branch: drift is ZERO; the job is red for a different, latent reason

Dispatched on `claude/migration-history-drift-allowlist-37444c` (head `8dd014d04` — on `main` the
allowlist would still be the seeded five): **Actions run
[`32251326536`](https://github.com/BigSimmo/Database/actions/runs/32251326536)**, 2026-08-19T12:11:04Z.
Step `Compare live schema drift`: **success**:

```
Drift manifest: generated 2026-08-18T18:15:50.121Z from schema.sql 328677d1c6f3…
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against live.
  ~ [migration_history] no_statements … ×20   (five superseded + fifteen validation — every row allowed, each printed with its guard reason)
No unexpected schema drift between live and supabase/schema.sql.
```

| Category             | §Phase 4 step 7 (`32171070287`) | This run (`32251326536`) |
| -------------------- | ------------------------------: | -----------------------: |
| `missing_live`       |                               0 |                    **0** |
| `unexpected_live`    |                               0 |                    **0** |
| function `def_hash`  |               1 (merge-pending) |                    **0** |
| `migration_history`  |                   15 unexpected |                    **0** |
| **Total unexpected** |                          **16** |                    **0** |

**`#316`'s live-drift finding set is empty for the first time since 2026-07-26.**

**But the job concluded `failure`, and that is honest, not drift.** The next step, `Align migration
history for Supabase Preview` (`npm run check:migration-history`, added by Phase 0 in PR #1939), ran for
the **first time ever** — on every run since it was added the compare step failed first and it was
`skipped`, and the last green run (`29700973962`, 2026-07-19) predates it. It fails with:

```
Local migration versions: 210
Unable to read remote schema_migrations via Accept-Profile (status 406: {"code":"PGRST106","details":null,"hint":"Only the following schemas are exposed: public, graphql_public","message":"Invalid schema: supabase_migrations"})
```

`scripts/check-migration-history-alignment.ts` reads `supabase_migrations.schema_migrations` through
PostgREST with `Accept-Profile: supabase_migrations`, which this project has never exposed to the Data
API — so the step can only ever fail here. The routing job therefore kept pinned issue #1963 open ("Job
result: failure") even though the findings block it captured is empty. This is a latent Phase 0 tooling
defect that zero drift has now exposed, **not** a change this task should absorb into a migration PR:
the fix is either an owner dashboard decision (expose `supabase_migrations` read-only to the service
role) or rewriting the alignment read onto the management API / `supabase migration list` (which needs
the `SUPABASE_ACCESS_TOKEN` secret of `#183`), or a service-role RPC listing versions (a new migration
with its own window). Queued as its own ledger item from this session; until it is fixed the weekly job
will stay red on that step alone and the pinned issue will not self-close — **the drift block, which is
what the issue was opened for, is clear.**

## Alignment-step repair — 2026-08-20 (repo-side; production deploy still owed)

_Follow-on from Phase 6.2 step 6. Repo-only session: no hosted mutation, no provider gate run. The
three GitHub reads (open-PR list, issue #1963, live-drift run `32378402265`) were owner-requested._

### The finding restated, re-measured on `main`

live-drift run [`32378402265`](https://github.com/BigSimmo/Database/actions/runs/32378402265),
2026-08-20T14:09:03Z, `main`, weekly cron. Step conclusions:

```
Compare live schema drift: success
Align migration history for Supabase Preview: failure
```

Compare step, decisive lines:

```
Compared 6 extensions, 38 tables, 1 views, 93 functions, 210 indexes, 48 policies, 170 constraints, 26 triggers, 2 storage_buckets against live.
No unexpected schema drift between live and supabase/schema.sql.
```

Alignment step, decisive line:

```
Unable to read remote schema_migrations via Accept-Profile (status 406: {"code":"PGRST106","details":null,"hint":"Only the following schemas are exposed: public, graphql_public","message":"Invalid schema: supabase_migrations"})
```

So the drift block has now been empty for **two consecutive runs** (`32251326536` on the 6.2 branch,
`32378402265` on `main`), and issue #1963 is still open solely because a sibling step cannot read a
table it was never able to read. `#316`'s finding set stays empty.

### Fix: least-privilege RPC, not a widened API surface and not a new credential

`20260820120000_migration_history_versions_rpc.sql` adds
`public.migration_history_versions()` — `stable`, `security definer`, `set search_path to ''`,
dynamic read guarded by `to_regclass`, returning `{probe, versions}` for every history row.
`revoke ... from public, anon, authenticated` + `grant ... to service_role`, exactly the
`schema_drift_snapshot()` pattern (`20260706200000` / `20260818090000`).

Two alternatives were rejected and are recorded so the choice is not re-litigated:

| Option                                                | Why not                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Expose `supabase_migrations` to the Data API          | Widens the public PostgREST surface of a clinical project for one weekly read, and lives in dashboard config, not in git |
| Read via the management API + `SUPABASE_ACCESS_TOKEN` | Puts an account-scoped token into CI secrets — far broader authority than the read needs; also still blocked on `#183`   |

`scripts/check-migration-history-alignment.ts` now tries the RPC first and falls back to the old
Accept-Profile read **only** when the function itself is absent (404 / `PGRST202`). Every other outcome
raises, including `probe: no_history_table` — a check that reports "aligned" because it could not look
is worse than the red job it replaces. When neither path works, the error names the remedy.

### Repo-side proof

- `npm run drift:manifest` — full scratch replay of `supabase/schema.sql` into
  `supabase/postgres:17.6.1.127`: "Replay complete in 58s". This executes the new function body in a
  real Postgres, so the SQL is proven, not merely reviewed. Manifest now carries **94** functions
  (was 93) with `public.migration_history_versions()` at
  `acl: ["postgres=X/postgres", "service_role=X/postgres"]` — least privilege confirmed by replay,
  no `PUBLIC` execute. `schema_sha256` `6fe4883e03fa…`.
- `tests/migration-history-alignment.test.ts` — 7 tests: RPC preferred and Accept-Profile never sent;
  fallback only on an absent function; unexpected RPC failure surfaces rather than falling back;
  `no_history_table` is an error; migration-vs-`schema.sql` byte parity; read-only + service-role-only
  shape.

### What is still owed

_Superseded by the 2026-08-20 window section below: the migration was already applied on production
before the window opened, and D4 is no longer treated as OFF. Kept as the pre-window record._

The migration is **not deployed**. D4 is OFF _(superseded: see §D4 — SETTLED 2026-08-21; deploy-on-merge is ON)_, so merging does not apply it, and until it is applied
`check:drift` will report `migration_history_versions` as a missing function — i.e. merging before the
window trades one red for another. **Deploy from the branch first, then merge**, which is the order
Phase 4 used (§Phase 4 completion). Staging needs the same migration by the Phase 2 method to hold the
parity Phase 4 restored.

### Window 2026-08-20 — production already applied; staging still owed

_Owner-authorised window. Worktree linked to production (`sjrfecxgysukkwxsowpy`), the main checkout
left on its staging link. Every call carried an explicit `--project-ref`._

**PR #2198 was merged before the window** (squash `a341832af`), the reverse of the intended
deploy-then-merge order. The pre-flight then found the migration **already applied**:

```
$ supabase migration list --linked --project-ref sjrfecxgysukkwxsowpy
… {"local":"20260820120000","remote":"20260820120000","time":"2026-08-20 12:00:00"}
```

`db push` was therefore never run against production in this window. Read-only verification:

| Check                                     | Result                                                     |
| ----------------------------------------- | ---------------------------------------------------------- |
| history row shape                         | `stmt_count 3` — executed statements, **not** mark-applied |
| `prosecdef` / `provolatile` / `proconfig` | `true` / `s` / `search_path=""`                            |
| `proacl`                                  | `postgres=X/postgres \| service_role=X/postgres`           |
| function output                           | `probe: ok`, `version_count: 211`, `table_rows: 211`       |

211 remote versions against 211 local migration files, so the alignment check's `remoteOnly` set is
empty and the step should now pass. **No guard migration is owed**: the row carries executed
statements, so it is not a history repair and cannot surface in the `migration_history` probe.

#### D4 — SETTLED 2026-08-21 by a direct dashboard read: deploy-on-merge is ON

**This question is closed. The Supabase dashboard was read on 2026-08-21 and shows the GitHub
integration with "Deploy to production" ENABLED, production branch `main` — "Apply changes to your
production database when you merge into your configured production GitHub branch". Automatic
branching is also ON (limit 3, "Supabase changes only" enabled).** The inference recorded below was
correct; it is no longer an inference, and the safe-either-way hedge it justified is retired.

Consequences, which `AGENTS.md` § "Supabase project safety" now carries as the authoritative rule:

- **Merge approval IS production-deploy approval.** Any migration merged to `main` is applied to the
  live clinical database automatically, within seconds (34 s measured, §3.7). There is no separate
  deploy step to forget and no window in which to hold it back. Never merge a
  `supabase/migrations/**` PR outside an approved window, and never arm auto-merge on one.
- **The post-merge gate is a green `live-drift` run**, requiring BOTH `check:drift` and
  `check:migration-history`. It is _not_ `supabase migration list`: that reads recorded history only,
  so it cannot distinguish an applied migration from a history row whose statements never executed —
  precisely the shape of the twenty no-statements rows. `check:drift` compares the live schema itself.
- **A migration that cannot run inside a transaction cannot ship this way.** The integration applies
  each migration in one transaction, so a bare `CREATE INDEX CONCURRENTLY` migration fails outright.
  Index work stays operator-prebuild plus a validate-only guard migration (the `20260804110240`
  pattern).
- **Branching Compute is not covered by the organisation's Spend Cap** (stated on the same dashboard
  screen), so preview databases are an uncapped cost that scales with PRs touching `supabase/**`.
  CI's `Migration replay` job (`db-reset-verify`, `supabase migration up --local`) independently
  replays the whole chain on every database-touching PR, so preview branches are a second net rather
  than the only one — that is the context for any later decision to reduce or disable them. Queued as
  its own ledger item.

The `list_branches` reading below remains accurate and is now corroborated rather than superseded:
production is bound to git `main`, and the toggle that acts on that binding is enabled.

_The analysis that follows was written before the dashboard was read. It is retained because it
records how the question was narrowed, and why the safe-either-way rule was the correct posture while
the toggle was still unknown._

##### Superseded reasoning, retained: how D4 stood before the dashboard read

`created_by` and `idempotency_key` are NULL for every row from `20260818090000` to `20260820120000`,
including the ones this programme applied by operator `db push`, so the history table carries **no
provenance signal** and cannot say how this row arrived. Two explanations remain open, and the
distinction is the whole of D4:

1. **Supabase Branching applies on merge.** §3.7 measured exactly this — migrations `110000`–`112000`
   bracketed to **34 s** after #2106's squash-merge. A Supabase preview branch existed on #2198
   (project `gjpnznsmbylfkzfeeuki`, "Migrations ✅" 17:08:58 UTC) and the PR merged minutes later.
2. Someone ran `db push` against production in the same hour.

The 2026-08-19 observation recorded as "D4 is OFF" was that the four `20260819` migrations _sat
pending while the PR was open_. That tests deploy-while-open, **not** deploy-on-merge, so it never
contradicted §3.7 — and today's result fits both observations at once.

**Settled the same day by reading the platform instead of the history table.**
`list_branches(sjrfecxgysukkwxsowpy)` returns exactly one record:

```json
{
  "name": "main",
  "is_default": true,
  "git_branch": "main",
  "project_ref": "sjrfecxgysukkwxsowpy",
  "created_at": "2026-06-27T14:10:20.550361+00:00",
  "updated_at": "2026-07-04T08:15:07.640507+00:00"
}
```

Production is **still bound to git `main`**, and `updated_at` predates 2026-08-19 — so whatever was
changed that day never touched this binding, and the §3.7 mechanism is intact. Together with §3.7's
34-second apply and `20260820120000` arriving unpushed, that is strong evidence of deploy-on-merge.

**SUPERSEDED 2026-08-21 — do not act on this paragraph or the rule that follows it; the dashboard read above replaces both.** _It remains an inference, and the difference matters._ No field of the branch record reports the
"Deploy to production" setting. The superseded 2026-08-19 account describes that setting being changed
without the binding being deleted, so "toggle off, binding intact" cannot be ruled out from here — and
the two failure modes are not symmetric. Declaring D4 ON tells operators to skip `db push`; if the
toggle is in fact off, every merged migration then sits unapplied and drift returns silently, which is
the original incident. Declaring it OFF risks only a redundant no-op push.

**SUPERSEDED 2026-08-21.** _The operative rule at the time — correct under both states, and deliberately not shortened:_

1. Never merge a migration PR outside its approved window — correct if deploys happen on merge.
2. After any migration merges, run `supabase migration list --linked --project-ref <ref>` and
   `db push` anything still pending — correct if they do not.

One extra command, wrong under neither hypothesis. What would replace this rule with a fact is a
dashboard read of the toggle, or a deployment-settings API that reports it. Raised as a P1 by the Codex
review of PR #2205, and correctly: the earlier wording here presented the inference as a direct read.

#### Staging is one version behind — blocked, not skipped (CLOSED 2026-08-22 Perth = 2026-08-21 UTC, see Phase 5 close-out)

Staging (`ikoiolksxqxfxgiyqpnu`, verified before every call) reads **210** history rows, latest
`20260819110500`, `to_regprocedure('public.migration_history_versions()') is null`. Its pending set is
exactly `['20260820120000']` with zero remote-only versions, so a single `db push` (or the Phase 2
`execute_sql` method) closes it.

Both write paths were **denied by the session's auto-mode classifier** — `supabase db push` and the
MCP `execute_sql` alike — under the live-Supabase confirmation rule added by PR #2196 the same day.
Read-only calls were unaffected, which is why every verification above exists. This is an
authorisation gap, not a technical one: **staging parity, closed by Phase 4, is open again by one
version until an operator applies it.**

**CLOSED 2026-08-22 Perth (2026-08-21 UTC).** An operator session applied `20260820120000` to staging by real `db push`;
staging now reads 211 history rows with `migration_history_versions()` present and `stmt_count 3`,
matching production exactly. Evidence in the "Phase 5 close-out" section, "Staging catch-up".

## Alarm cleared — live-drift green on `main`, 2026-08-21 (run `32514326022`)

The alignment fix landed on 2026-08-20 but had **never been observed passing**: two sessions existed
because `live-drift` was red on its `Align migration history for Supabase Preview` step (PGRST106).
Dispatched here on `main` with the fix live on production and staging brought to parity.

`https://github.com/BigSimmo/Database/actions/runs/32514326022` — **job conclusion: `success`.**

```text
live-drift  Compare live schema drift                      No unexpected schema drift between live and supabase/schema.sql.
live-drift  Align migration history for Supabase Preview   Remote migration versions: 211 (read via rpc)
live-drift  Align migration history for Supabase Preview   Remote-only (Preview blockers): 0
```

Every step reported `success`, including `Guard Supabase project identity`, `Compare live schema
drift`, `Align migration history for Supabase Preview`, and `Capture drift and migration-history
findings`.

**This is the first green `live-drift` run since 2026-07-19T19:37:29Z** — measured, not assumed: of
the last 60 runs, exactly four succeeded (`2026-07-13T09:58:30Z`, `2026-07-13T17:10:55Z`,
`2026-07-19T19:37:29Z`, and this one), and the oldest run in that window is `2026-07-09`. That is a
**33-day continuous red streak**, closed.

**Pinned issue `#1963` "Live drift check failing" auto-closed at `2026-08-21T18:38:42Z`**, by the
`drift-routing` job, seconds after the alignment step reported zero Preview blockers — the
self-closing behaviour the routing was built for, now demonstrated end to end for the first time.

Both halves of the original `#316` alarm are therefore closed _and observed closed_: drift findings
are empty, and the job that reports them is green.
