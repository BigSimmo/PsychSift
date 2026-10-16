---
name: ingestion-review-remediation-state
description: "Ingestion pipeline review 2026-08-18 — live corpus quality signal is synthetic, PR A′/C landed locally, operator steps and canary decisions still open"
metadata:
  node_type: memory
  type: project
  originSessionId: d0b79d20-810d-403b-b526-d6295a12e173
  modified: 2026-08-18T08:47:52.802Z
---

Full ingestion review completed 2026-08-18 (repo + read-only live audit of `sjrfecxgysukkwxsowpy`). Plan: `C:\Users\joshs\.claude\plans\please-can-you-review-playful-crane.md`. 14 findings queued as immutable inbox requests (unreconciled).

**The finding that reframes everything else:** the live quality signal is synthetic. `repair_enrichment_quality_batch` (in `20260712171500_codify_live_ahead_functions.sql`) overwrites `document_index_quality` with a hardcoded `0.84`/`good` computed from row _presence_, discarding `assessDocumentIndexQuality`'s real verdict. Live: **all 2,851 documents read `good`, and zero rows carry a `needs_ocr_page_count` metric key.** So corpus-health numbers from that table prove nothing — never quote them as evidence of ingestion quality.

**Why that is a ranking problem, not just a reporting one:** `document_index_quality.quality_score`/`issues` feed `indexQualityRankSignal` in `src/lib/clinical-search.ts` into the ranking sum. With every document at 0.84 the boost is a **constant across the whole corpus — the signal is dead**. Restoring honest quality therefore moves every document onto a different boost tier: it is a corpus-wide RAG ranking change needing an `RAG impact:` line and a live eval-canary pair, not the no-RAG-impact chore it first looks like.

Other live facts not visible from the repo: 65% of summaries are non-LLM prefixes; 43% of memory cards are repair-manufactured, and repair cards carry a _chunk's_ embedding rather than an embedding of their own text; 48% of documents have one synthetic whole-document section; 98.5% of `document_index_units` have a NULL `index_generation_id` so reindex never retires them; 760 documents hold duplicate document-level embedding rows (worst: 18 copies) because the dedup unique index is keyed on a nullable `source_chunk_id`.

**Landed locally, not pushed, no PR opened:**

- `claude/ingestion-transient-openai-retry` — every transient OpenAI failure was classified terminal because the classifier read `mapOpenAIError`'s prose, not its code. Plus vision retries and the never-called `checkEmbeddingDimension`.
- `claude/edge-worker-ingestion-review-1adaa9` — retired the `ingestion-worker` Edge Function (it claimed the extraction queue without extracting). Carries the 14 inbox requests.

**Open, needs the operator:** unschedule the live `cron.job` row calling `invoke_ingestion_worker` (was jobid 7) and delete the deployed function — _before_ that, identify what redeployed both edge functions twice in 30 minutes on 2026-08-18 with no repo change, because a cache-based deployer would resurrect it.

**Watch out:** `ops.toggle_worker_jobs_by_backlog` runs every minute on live, is `SECURITY DEFINER`, arms cron jobs 5/6/8 whenever a document is uploaded, and has **zero occurrences anywhere in the repository** — so the repo cannot tell you what actually runs against a new upload. Related: [[db-remediation-coordination-state]], [[local-test-failures-windows]], [[rag-programme-coordination-state]].
