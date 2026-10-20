# Retrieval Quality Runbook

Use this runbook when retrieval, ranking, RAG answer generation, source governance, or ingestion/indexing changes could affect clinical answer quality.

> **Approval first.** Every command on this page reads the live `PsychSift Production` database, and
> `eval:quality` without `--provider-mode offline` also pays for OpenAI calls. Do not run any of them
> without the owner's explicit yes. Before a billable run, follow "Spending approval for each billable run"
> in [`AGENTS.md`](../AGENTS.md) and [`docs/agents/shared-context-and-memory.md`](agents/shared-context-and-memory.md):
> a named purpose, a total estimate and a hard cap, approved before the run. This includes
> `npm run check:supabase-project` and `npm run supabase:recovery-status` below.

## Safe preflight

1. Confirm the live Supabase target before env-sensitive work:

```bash
npm run check:supabase-project
```

2. Confirm Supabase is healthy and the ingestion queue is not in recovery:

```bash
npm run supabase:recovery-status
```

Do not run retrieval or RAG evals when this reports `supabase_unavailable`, read errors, or a partially recovered indexing queue. Follow `docs/reindex-runbook.md` first.

## Main command

Run the combined quality gate:

```bash
npm run eval:quality
```

Useful variants:

```bash
npm run eval:quality -- --limit 5
npm run eval:quality -- --retrieval-only
npm run eval:quality -- --rag-only
npm run eval:quality -- --query clozapine
npm run eval:quality -- --question "What ANC or FBC threshold should withhold clozapine?"
npm run eval:quality -- --fail-on-threshold
```

**`eval:quality:release:offline` is not offline.** It switches only the OpenAI provider off
(`--provider-mode offline`); it still requires `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` and reads the live database for its preflight and every case
(`scripts/eval-quality.ts`, `main`). Treat it as a live database read that needs the owner's
yes, not as an offline gate. Without those values it stops with "Missing server environment
variables". (Audit finding EVAL-07, 20 October 2026; the script name is unchanged.)

The command writes ignored local artifacts under `output/evals/`:

- `retrieval-quality-<timestamp>.json`
- `retrieval-quality-<timestamp>.md`

## Required environment

The command requires the same live-eval environment as the existing RAG eval scripts:

- Supabase server env values for `PsychSift Production`
- `OPENAI_API_KEY`
- Owner is **optional** — see below.

Since the 2026-07-06 public promotion the live corpus is entirely `owner_id = NULL`, the eval now
**defaults its owner to the public-owner sentinel** `00000000-0000-0000-0000-000000000000` via the
shared `resolveEvalOwnerId()` helper in `scripts/eval-utils.ts`. This default applies across the
whole read/eval suite — `eval:retrieval:quality`, `eval:quality` (incl. `--rag-only`), `eval:rag`,
`eval:answer-quality`, and `eval:search` — not just the retrieval eval. `retrieval_owner_matches`
maps the sentinel to NULL-owner rows, mirroring anonymous production search, so no session has to
set `RAG_EVAL_OWNER_ID` by hand; the helper prints a one-line warning whenever it falls back to the
sentinel so the public-only scope is visible. An explicit `RAG_EVAL_OWNER_ID`, `LOCAL_NO_AUTH_OWNER_ID`,
or `RAG_EVAL_OWNER_EMAIL` (or `--owner-id` / `--owner-email`) still overrides the default. Note a
real owner UUID now scopes retrieval to zero documents and fails every case, so only override when
the corpus ownership actually changes. (Write/backfill scripts deliberately do **not** use this
default — they must target an explicit owner.)

Optional cost fields:

- `RAG_EVAL_INPUT_USD_PER_MILLION`
- `RAG_EVAL_CACHED_INPUT_USD_PER_MILLION`
- `RAG_EVAL_OUTPUT_USD_PER_MILLION`

Optional provider retry fields:

- `RAG_EVAL_PROVIDER_RETRY_ATTEMPTS` defaults to `4`
- `RAG_EVAL_PROVIDER_RETRY_INITIAL_MS` defaults to `5000`
- `RAG_EVAL_PROVIDER_RETRY_MAX_MS` defaults to `45000`

Provider-backed evals run case-by-case and retry transient `429`/rate-limit failures. If rate limits persist after retries, stop and rerun later rather than launching parallel evals.

## Metrics reported

Retrieval:

- case count
- hit@K
- document recall@5
- content recall@5
- MRR@10
- median latency
- retrieval strategy counts
- failed cases grouped by failure category

Source governance:

- outdated top-result count
- review-due top-result count
- unknown-status top-result count
- unverified top-result count
- unknown-extraction top-result count
- poor-extraction top-result count
- primary top-result stale rate
- primary top-result review-required count and rate
- supporting top-5 review-required count and rate for corpus-review prioritization

Metadata policy:

- `unknown`, `unverified`, `review_due`, `outdated`, unknown extraction, and poor extraction are treated as review-required.
- `stale_rate` is reserved for truly outdated primary top results. Review-due and unknown-status primary top results remain review-required debt, but they are not counted as stale.
- Explicit non-local unverified sources, such as BMJ documents with a `not a local WA source` evidence basis, remain labelled as unverified but are not treated as missing local-validation debt for release gating.
- Supporting top-5 review-required counts are reported to prioritize corpus review; they do not suppress ranking by themselves and are not the release gate.
- Do not silently default missing corpus metadata to `current` or `approved`.
- Reduce the warning rate by backfilling source metadata through ingestion/enrichment or by explicitly accepting the review-required baseline in a versioned release metadata debt file.
- Danger-class source governance warnings are blocking.
- Warning-class retrieval source metadata notes may be accepted only by passing `--source-metadata-debt <path>` to `npm run eval:quality -- --fail-on-threshold`.
- Source metadata debt acceptance does not mark sources current or approved. It only removes the accepted retrieval metadata threshold failures from the blocking failure list.
- Outdated top results, poor-extraction top results, and RAG danger-class source governance failures remain blocking.

Answer quality:

- grounded supported rate
- unsupported correct rate
- expected source hit rate
- citation failure rate
- numeric grounding failure rate
- source governance warning count
- source governance warning rate
- source governance danger failure rate
- p95 latency
- estimated cost when cost env vars are set

## Threshold defaults

`npm run eval:quality -- --fail-on-threshold` fails when:

- retrieval hit@K is below `0.8`
- document recall@5 is below `0.8`
- content recall@5 is below `0.8`
- primary top-result stale rate is above `0.25`
- primary top-result review-required rate is above `0.25`
- grounded supported answer rate is below `0.9`
- unsupported-answer correctness is below `1.0`
- citation failure rate is above `0`
- numeric grounding failure rate is above `0`
- source-governance danger failure rate is above `0`
- RAG p95 latency is above `25000ms` by default, the strict near-region gate that local and
  `eval:quality:release` runs are held to. Only a run with `EVAL_LATENCY_CONTEXT=cross-region-runner`
  (set by the weekly Eval Canary workflow) uses `60000ms`. History: on 2026-07-13 the canary measured an
  honest post-#606 answer p95 of about 48 s from cross-region runners, which is why the wider allowance exists.
- RAG p95 latency for one answer route is above its route ceiling: `unsupported` 4000 ms, `extractive`
  12000 ms (35000 ms cross-region), `fast` 25000 ms, `fallback` 50000 ms, `strong` 35000 ms
  (60000 ms cross-region).
- a source-backed review fallback appears on any case that is not named, with its reason, in
  `ragSourceBackedReviewFallbackAllowance`. That allowance is empty today, so every such fallback fails.

The values above come from `qualityThresholds` in `scripts/eval-quality.ts`; if they ever differ, the
code wins.

These thresholds are intended as a quality tripwire, not a substitute for clinical review.
Warning-class source governance notes remain visible in reports and should be backfilled or explicitly baselined before release.

## Promoting misses

Use the in-app answer feedback flow or `/api/eval-cases` to capture answer misses. Promoted rows in `rag_query_misses` are automatically included by `npm run eval:quality`.

For durable fixture coverage, add stable cases to `scripts/fixtures/rag-retrieval-golden.json` when the expected document/source terms are clear and not tied to transient local data.

## When to run

Run retrieval-only evals after:

- search/ranking changes
- schema or RPC changes that affect retrieval
- ingestion/index-unit changes
- source metadata or document status changes

Run full quality evals after:

- answer generation changes
- source governance changes
- citation/source rendering changes
- clinical output changes
- release or handoff confidence checks

`npm run governance:release` is the read-only governance routine. It runs generated label coverage, document label governance, and `audit:source-governance:release`. The source-governance audit compares the live corpus against `docs/release-source-metadata-debt-2026-06-30.json` and fails if required metadata returns, poor extraction appears, smart-v2 labels go missing, or the accepted eval baseline exceeds the file ceilings.

`npm run verify:release` includes `npm run governance:release` before `npm run eval:quality:release`. `eval:quality:release` passes `docs/release-source-metadata-debt-2026-06-30.json` while that temporary release debt is active. The current release debt accepts primary review-required top-result rate only up to `0.2`; stale rate, outdated top results, poor-extraction top results, and danger-class source governance failures remain blocked. Use focused variants such as `--retrieval-only`, `--rag-only`, `--limit`, `--query`, or `--question` during development to avoid unnecessary provider-backed cost.
