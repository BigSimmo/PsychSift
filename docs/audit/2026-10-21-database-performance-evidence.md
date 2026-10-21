# Database performance evidence (2026-10-21)

Evidence pass for six ledger rows: `#JVQ1HA`, `#GQR7DE`, `#TNYENC`, `#3CW29T`, `#VHW8K9` and `#8VAY97`.
The owner approved read-only live reads on 2026-10-21 (row counts, the Supabase performance advisor,
index usage and query plans). Nothing was written to the live database, no migration was drafted, and
no search behaviour was changed. Local measurements ran on PostgreSQL 16 in a cloud container, so they
are relative costs, not live timings.

## Summary

| Row       | Finding                                                                                                   | Disposition                                                          |
| --------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `#JVQ1HA` | Live active release has 843 records and **0** pass the retrieval filter, so no per-row tsvector work runs | No gain today. Do it as a precondition of first publication          |
| `#GQR7DE` | Canonicalisation cost measured: about 1.3 s at 843 records, 14.7 s at 6,744, per pass                     | Curve recorded. No change needed until well past 2,000 records       |
| `#TNYENC` | Live has one release (the freeze) and zero publications, so no record lacks a baseline yet                | Still blocked on `#HTZPQ8` and `#81A3YJ`. No change                  |
| `#3CW29T` | 128 advisor notices on 69 tables. Largest affected table is 896 kB (843 rows); the rest are 56 kB or less | No index justified. Re-check if a child table passes 10,000 rows     |
| `#VHW8K9` | 228 never-scanned non-primary indexes in 34 days, 220 MB. Largest are retrieval indexes                   | No drops now. Candidate list below; drops are a RAG-protected change |
| `#8VAY97` | Inner plan baseline captured for the index-units search: 9.2 s cold, 0.19 s warm, same plan               | Baseline recorded. Cold cost is memory size, not a plan problem      |

## `#8VAY97` index-units search baseline

`explain_retrieval_rpc` only shows a Function Scan, so the body of
`match_document_index_units_hybrid_scoped` (live definition read with `pg_get_functiondef`) was
inlined with literal parameters and run under `explain (analyze, buffers)`. Query text was
`lithium toxicity monitoring`, public scope, no document filter, and the query vector was the first
stored unit embedding (no OpenAI call).

| Run  | Execution | Buffers                | Plan                                                                                                      |
| ---- | --------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Cold | 9,184 ms  | hit 58,433, read 8,413 | Bitmap scans on `document_index_units_search_idx` and `document_index_units_terms_idx`, then pkey lookups |
| Warm | 191 ms    | hit 66,846, read 0     | Identical                                                                                                 |

Where the time goes (cold run):

- The text branch is cheap: 53 index hits, 26 rows kept, about 110 ms.
- The term-overlap branch (`normalized_terms && terms`) matched 6,568 units and kept 3,389. Its heap
  scan touched 3,827 blocks and took about 2.7 s.
- Ranking then fetched the stored embedding and `search_tsv` for 3,401 candidates (both are TOASTed),
  about 5.4 s.

The plan did not flip between runs. The difference is disk reads: the first run read 8,413 blocks
(about 66 MB) from outside the Postgres buffer cache, roughly 1 ms each, and the second read none.
Live sizes and settings on 2026-10-21: database 8,772 MB, `document_embedding_fields` 3,924 MB,
`document_chunks` 1,641 MB, `document_index_units` 1,224 MB, `document_memory_cards` 1,023 MB,
`shared_buffers` 256 MB, cumulative buffer hit rate 96.0 percent. `effective_cache_size` (768 MB) is a
planner estimate, not allocated memory, so it says nothing about the operating-system page cache.

Real-workload counters over the same 34 days (`pg_statio_user_tables`) point the same way. Share of
page requests served from the Postgres buffer cache: `document_chunks` heap 75.5 percent and TOAST
22.1 percent, `document_index_units` heap 75.2 percent and TOAST 54.8 percent,
`document_embedding_fields` TOAST 34.8 percent, `document_memory_cards` heap 45.8 percent, against
99.9 percent for `documents`. TOAST holds the embeddings and long text, so most search page requests
go past the buffer cache. A miss here may still be served by the operating-system page cache, which
these counters cannot see.

What this proves: a search whose pages are not cached pays about 1 ms per page and can take seconds.
What it does not prove: how often real searches hit that state, or that more memory would keep the
pages cached. Two back-to-back runs are not a controlled cold and warm test. Before any resize, read
the instance memory and cache-hit charts for the same period in the Supabase dashboard, and repeat the
capture after a known idle gap.

Two levers exist, and both are owner decisions:

1. A larger Supabase compute size (more memory), only if the dashboard memory and cache-hit evidence
   supports it. No code or ranking change. Paid, dashboard only.
2. Bounding the term-overlap branch before ranking. This changes the candidate set, so it is a RAG
   behaviour change that needs a live canary pair and notice under `docs/rag-behaviour/`.

Statistics window: the server started on 2026-09-17 10:00 UTC, so cumulative counters cover 34 days.
`document_index_units_terms_idx` and `document_index_units_search_idx` each recorded 1,539 scans in
that window, about 45 index-units searches a day.

Repeat the capture with the same inlined query (service role, read-only) so before and after runs stay
comparable. Run it twice and report both, because the first run measures the cache, not the plan.

## `#JVQ1HA` site record full-text cost

`match_governed_candidate_chunks_v3` (latest body in
`supabase/migrations/20261015180000_prefilter_text_only_governed_retrieval.sql`) computes
`to_tsvector('english', title || ' ' || normalized_text)` twice per site record that passes its
filters. Live on 2026-10-21: one release, 843 records, **0** with `validationStatus` in
(`locally_reviewed`, `approved`) and `sourceStatus` in (`current`, `review_due`). Filters run before
the select list, so today the expression is never evaluated.

Local cost with the 843 frozen records (median text 4,781 characters) all made eligible:

| Variant                                          | Time per search   |
| ------------------------------------------------ | ----------------- |
| Computed per row, as now                         | 1,430 to 1,560 ms |
| Stored generated `tsvector` column (GIN indexed) | 11.5 to 12 ms     |
| Today's live shape (0 eligible rows)             | 11.6 ms           |

So the precomputed column is worth about 1.5 s per search once a release has around 800 approved
records, and proportionally less for smaller batches (about 0.5 s at the 276 service and form records
planned for first publication). It is worth nothing today.

Recommendation: ship the stored column, its GIN index and the RPC change together, before or with the
first approved publication batch under `#HTZPQ8`. The change touches an immutable, digest-governed
table and a protected retrieval RPC, so it needs the owner's migration yes and a `RAG impact:` line.
Ranking values should be identical (same expression, precomputed), but it is still a protected
retrieval RPC change, so `docs/rag-behaviour/safeguards.md` requires the live eval-canary
before and after pair, with its own spending approval.

## `#GQR7DE` release canonicalisation curve

`site_content_canonical_json` was copied verbatim from
`supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql` and run over the
`{logicalId, record, renderPayload}` array that `site_content_bootstrap_digest` hashes, scaled by
duplicating the 843 frozen records.

| Records | Canonical bytes | Time per pass |
| ------- | --------------- | ------------- |
| 843     | 9,503,239       | 1.3 s         |
| 1,686   | 19,008,163      | 5.2 s         |
| 3,372   | 38,016,325      | 8.2 s         |
| 6,744   | 76,032,649      | 14.7 s        |

Growth is roughly linear above 1,686 records at about 2 s per 1,000 records on this host. The
2026-09-16 audit measured two live passes over 843 records at about four seconds, so live is roughly
1.5 times slower than this container. Activation runs at least two passes (dynamic state digest and
release digest). The live `service_role` statement timeout is 15 minutes, so the database timeout is
not the ceiling. The practical ceiling is the caller's request timeout. At about 3,000 records an
activation would take roughly 20 to 25 s on live.

No change is recommended. Do not rewrite the function, because any byte difference changes every
stored fingerprint. Re-measure before a release passes about 2,000 records.

## `#TNYENC` registry baseline

Live: `site_content_releases` has one row, the epoch-zero freeze, and nothing has been published since
2026-08-24. No record currently lacks a baseline. The ledger row's own conditions still hold: do
`#81A3YJ` first, and only ship the forward migration when `#HTZPQ8` is about to publish post-freeze
records.

## `#3CW29T` unindexed foreign keys

The advisor reported 128 unindexed foreign keys. A catalogue query over the same constraints found 69
child tables, with these sizes:

- `site_content_release_records`: 896 kB heap, 843 rows. Its unindexed key points at
  `site_content_publications`, which has no rows and is immutable, so a parent delete cannot happen.
- `ingestion_generation_evidence.unit_declarations`: 56 kB, 62 rows.
- Every other table: 8 kB or less. These are the CME, On Call, Roster, public-source and feedback
  tables, which are effectively empty.

At these sizes a sequential scan is faster than an index lookup and an index only adds write cost. No
index is justified. Re-run the check when any child table passes about 10,000 rows, and then test with
`explain analyze` before adding one.

## `#VHW8K9` never-used indexes

228 non-primary indexes outside the platform schemas have `idx_scan = 0` across the 34-day window,
220 MB in total. The largest:

| Index                                 | Size   | Note                                                        |
| ------------------------------------- | ------ | ----------------------------------------------------------- |
| `document_chunks_content_trgm_idx`    | 73 MB  | Part of the search-schema health set                        |
| `document_embedding_fields_dedup_idx` | 36 MB  | Unique. Enforces a constraint, keep                         |
| `document_chunks_content_hash_idx`    | 11 MB  | Listed in `supabase/search-health-unmonitored-indexes.json` |
| `document_summaries_summary_trgm_idx` | 8.1 MB | Search-schema health set                                    |
| `document_memory_cards_document_idx`  | 7.2 MB |                                                             |
| `document_labels_label_trgm_idx`      | 7.0 MB | Search-schema health set                                    |

The rest are small. Dropping any of the large ones is a change to retrieval tables and the
search-health contract, so it needs the RAG gate, a migration yes and a guard update. The gain would
be about 100 MB of disk and cache pressure, which does not address the cold-search cost above. No drop
is recommended now. If the compute size stays as it is, the trigram indexes are the first candidates
to revisit, with the trigram fallback path confirmed unused first.
