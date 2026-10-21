# Observability & SLOs

Service-level objectives for the PsychSift answer pipeline, the alert
thresholds attached to them, and the weekly production eval canary that turns
the golden eval into a standing guard. Written 2026-07-06.

Context: this repo's defining failure mode is **silent degradation** — hybrid
retrieval RPCs once died quietly while the app kept serving from fallbacks.
Every SLO below is chosen so that the degraded state is _visible_ even when the
app keeps returning 200s.

## 1. Telemetry sources (what exists today)

| Source                                                     | What it carries                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rag_queries.metadata` (jsonb, one row per answered query) | `routing_mode` (`fast` / `strong` / `extractive` / `unsupported`), `confidence` (`high` / `medium` / `low` / `unsupported`), `query_class`, `fallback_reason`, `grounded`, per-stage latencies (`total_latency_ms`, `supabase_rpc_latency_ms`, `embedding_latency_ms`, …), cache/coalescing flags, and `hybrid_rpc_errors` (map of RPC → error) when any hybrid RPC failed |
| `rag_query_misses`                                         | weak-search/miss review queue with `miss_reason`                                                                                                                                                                                                                                                                                                                           |
| Server logs                                                | `logger.error("hybrid_rpc_failed", …)` per failing RPC (also emitted by deep-memory)                                                                                                                                                                                                                                                                                       |
| `search_schema_health()`                                   | execution smoke over all hybrid RPCs; surfaced by `npm run check:indexing`                                                                                                                                                                                                                                                                                                 |
| `/api/health`                                              | app liveness + Supabase reachability (container HEALTHCHECK target)                                                                                                                                                                                                                                                                                                        |
| Answer API response                                        | `degradedMode` / `answerQualityTier: "source_only"` signal per response                                                                                                                                                                                                                                                                                                    |

Query-text privacy: `rag_queries.query` is centrally redacted
(`queryTextForStorage`); SLO queries below only aggregate metadata, never raw
text.

## 2. SLOs and alert thresholds

Manual target windows are stated below. Configured ops-digest answer alerts
judge the trailing six-hour (360-minute) `sloTrailing` snapshot from
`answerSloSnapshot` (`src/lib/observability/answer-slo.ts`) through the
secret-gated `/api/health?deep=1` probe. The checked-in digest runs every six
hours (`15 */6 * * *`), so consecutive scheduled digests read back-to-back
windows and every answer is judged once. Until 2026-10-20 the rules read only
the last 60 minutes and needed 20 answers in that hour, which a single-clinician
pilot never reaches, so five hours in six went unexamined (audit EVAL-02). The
probe still returns the hourly `slo` snapshot, which feeds the hybrid-RPC
identity history below; a probe without `sloTrailing` (an older build) is judged
on that hourly snapshot instead. "Page" is a policy severity; configuration does
not establish that any provider notification was delivered or acknowledged.

**Automation status — read this before trusting a threshold.**
`scripts/lib/operational-alerts.mjs` configures these answer signals:

| Signal                            | Configured code(s)                                 | Trigger in a valid trailing snapshot                                                                                                     |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Missing/unassessed SLO telemetry  | `OPS_ANSWER_SLO_UNKNOWN`                           | Missing SLO block, a failed trailing query, nonpositive/invalid query count, or a window other than 360 minutes (60 for an older build)  |
| Hybrid-RPC error rate             | `OPS_HYBRID_RPC_ERROR_RATE_{UNKNOWN,WARNING,PAGE}` | Unknown for an invalid rate; warn above 0.5%; page only for the same RPC in three persisted consecutive digest samples                   |
| Provider-generation degradation   | `OPS_DEGRADED_ANSWER_RATE_{UNKNOWN,WARNING,PAGE}`  | Unknown for an invalid rate; warn above 20%; page above 50%                                                                              |
| Source-gap rate                   | `OPS_SOURCE_GAP_RATE_{WARNING,PAGE}`               | Warn `sourceGapRate > 0.15`; page `> 0.30`; at least 10 answered queries                                                                 |
| Unsupported-answer rate           | `OPS_UNSUPPORTED_ANSWER_RATE_{WARNING,PAGE}`       | Warn `unsupportedRate > 0.15`; page `> 0.25`; at least 10 answered queries                                                               |
| Answer latency-budget breach rate | `OPS_ANSWER_LATENCY_BUDGET_WARNING`                | `latencyBudgetBreachRate > 0.15`, with at least 10 answered queries                                                                      |
| Answer p95 latency by route mode  | `OPS_ANSWER_LATENCY_P95_{WARNING,PAGE}`            | Per route p95 over its warn/page line (fast 10/20 s, strong 25/35 s, extractive 6/12 s), once that route has at least 20 sampled answers |

The complete code list also includes `OPS_PROJECTED_DAILY_SPEND_WARNING` and
`OPS_EVAL_CANARY_STALE_WARNING`; every code has an operator runbook below.
Source-gap, unsupported, latency-budget and p95 signals have no dedicated
unknown code: missing/invalid values, fewer than 10 answered queries, or (for
p95) fewer than 20 sampled answers per route suppress those alerts and do not
prove health; the digest says so when the window is under 10 answers. Ten is the
smallest count at which a warning still needs two bad answers, not one
(`ANSWER_QUALITY_THRESHOLDS` in `scripts/lib/operational-alerts.mjs` records the
reasoning). A page replaces its warning
rather than adding to it. The latency-budget signal counts budget breaches; the
separate p95 signal is a bounded-sample percentile, described below. The
`/api/search` percentile and the longer-window quality targets below remain
manual probes. The eval harness's p90 budget covers its fixture cases,
not live traffic. Configured detection and observed delivery remain separate;
the acknowledgement/recovery drill below is still externally unaccepted.

### Latency — answer p95 by route mode

_Configured: `OPS_ANSWER_LATENCY_P95_{WARNING,PAGE}` for `fast`, `strong` and `extractive` on the trailing six-hour snapshot. The 1 h rows below are applied to that window. The `/api/search` row is manual SQL - not alerted._

`latencyP95MsByRouteMode` is a nearest-rank p95 per route over the same bounded
metadata sample (the newest 1,000 answers at most) and the same latency field as the
budget-breach rate below. Route mode comes from the first declared
`routing_mode`, `mode`, `route_mode` or `answer_mode`; unlike the budget rate,
a row with no declared mode, or any other mode such as `unsupported`, is left
out of every route's p95 rather than counted as fast. A route is judged only
with at least 20 sampled answers. The digest raises one alert per severity
naming each breaching route, prints the per-route p95 line, and says when the
sample was capped (`latencySampleTruncated`), in which case the p95 covers part
of the window only.

| Route mode (`metadata->>'routing_mode'`) | SLO (p95) | Warn               | Page               |
| ---------------------------------------- | --------- | ------------------ | ------------------ |
| `fast`                                   | ≤ 10 s    | p95 > 10 s for 1 h | p95 > 20 s for 1 h |
| `strong`                                 | ≤ 25 s    | p95 > 25 s for 1 h | p95 > 35 s for 1 h |
| `extractive` / source-only               | ≤ 6 s     | p95 > 6 s for 1 h  | p95 > 12 s for 1 h |
| `/api/search` (route timing)             | ≤ 3 s     | p95 > 3 s for 1 h  | p95 > 8 s for 1 h  |

Anchors: `OPENAI_ANSWER_TIMEOUT_MS` is 30 s; the retrieval latency eval budget
is p90 ≤ 20 s with a 25 s case timeout. A `strong` p95 near 35 s means answers
are riding the timeout and silently falling back.

```sql
select
  metadata->>'routing_mode' as route_mode,
  percentile_cont(0.95) within group (order by (metadata->>'total_latency_ms')::numeric) as p95_ms,
  count(*) as n
from rag_queries
where created_at > now() - interval '24 hours'
group by 1;
```

The query above needs database access and answers "how slow, across everyone". For the
complementary question — "where did the time go in ONE request, from where I am sitting" — the
answer route already returns a `Server-Timing` header splitting the request into auth, ratelimit,
scope, search, rpc, embedding, rerank, generation and total. This prints it as a table:

```text
node scripts/probe-answer-timing.mjs --allow-provider
```

It asks the live site one real question, so it spends OpenAI credit and writes a `rag_queries`
row; it refuses to run without that flag (or `ALLOW_ANSWER_TIMING_PROBE=true`), per the API and
provider confirmation boundary. `LIVE_DOMAIN_URL` and `ANSWER_PROBE_QUERY` override the defaults.
Read its output with the nesting in mind: `search` already contains `rpc`, `embedding` and
`rerank`, and `answer`/`total` are whole-request totals, so the column does not sum.

The timing probe is run by hand and does not compute a production percentile
or schedule monitoring. The configured p95 alerts above come from the ops
digest reading existing `rag_queries` metadata, never from this script.
`#TN512M` records why the timing probe was left unscheduled.

### Latency — time to first visible content (display only)

Each answer that sends the verified evidence preview records `first_verified_content_ms` (request
start to the preview being handed to the stream) beside `total_latency_ms`. The SLO snapshot's
`timeToFirstContent` gives nearest-rank p50 and p95 over the same bounded sample as the route p95,
taking the preview when one was sent and the finished answer otherwise, plus how many samples
showed the preview first. `GET /api/health?deep=1&answer_window=daily` adds a 24-hour `sloDaily`
block for the daily health summary (`scripts/lib/answer-speed-line.mjs`). No alert reads it.
Answers served from the answer cache write no latency fields to their `rag_queries` row today, so,
like the route p95, this figure covers freshly built answers only and reads slower than the average
wait for a repeated question. Adding cache-hit timing would also move the alerting p95 and the
budget breach rate, so it is a separate change.

### Latency — configured answer-budget breach rate

`OPS_ANSWER_LATENCY_BUDGET_WARNING` warns above 15% in the trailing six-hour
window when it contains at least 10 answered queries. `latencyBudgetBreachRate` counts an
explicit `latency_budget_breached: true` or a finite latency over the row's
route budget: fast/default 10,000 ms, strong 25,000 ms, extractive/source-only
6,000 ms. These are the answer SLO budgets (`src/lib/observability/answer-slo.ts`); they are
not the per-route answer budgets in `src/lib/rag/rag-route-budget.ts` (extractive 12 s, fast 25 s, strong 35 s). It converts the first non-null latency field in this order:
`latency_ms`, `duration_ms`, `total_latency_ms`, `response_ms`; an invalid
earlier value does not fall through to a later field. Route selection uses
`routing_mode`, `mode`, `route_mode`, then `answer_mode`, normalised to lower
case. `extractive`, `source_only` and `source-only` share the 6-second budget;
`strong` uses 25 seconds and all other values default to 10 seconds.
There is no `/api/search` percentile or page signal in this rate; the route
p95 signal above is separate.

Latency uses at most 1,000 answer metadata rows, the newest first by
`created_at`. When that sample is full and
the window contains more answers, its denominator is the sampled row count;
otherwise it is the whole-window answer count. Missing/invalid timing does
not prove an answer met its budget. Interpret this bounded diagnostic rate
with sample coverage and route mix; never label it a p95.

### Database latency — Sentry production DB span SLO (#183)

_Sentry-side alert - provisioning unverified. Nothing in this repository provisions, reads, or tests this alert; `SENTRY_AUTH_TOKEN` appears only in the build-time sourcemap upload (`next.config.ts`). Treat the criteria below as the intended Sentry configuration, not as proof an alert exists._

Sentry metric alert criteria for production database query span duration. Guards against unindexed queries, table locks, RPC latency spikes, and connection pool exhaustion:

- **Metric:** `transaction.duration` / span duration for `span.op:db` spans in environment `production`.
- **SLO:** p95 ≤ 500 ms over a 5-minute rolling evaluation window.
- **Warn / Alert:** p95 > 500 ms over 5 minutes.
- **Operational context:** Sustained breaches indicate Postgres RPC regression (such as unindexed embedding comparisons or table scans) or lock contention. Investigate via Supabase database insights, query performance metrics, and `search_schema_health()`. Requires `SENTRY_AUTH_TOKEN` for programmatic alert provisioning (#183).

### Quality — source-gap rate

_Configured: `OPS_SOURCE_GAP_RATE_WARNING` above 15% and
`OPS_SOURCE_GAP_RATE_PAGE` above 30% over the trailing six hours, with at least 10
answered queries. The longer-window targets below are manual._

`sourceGapRate` counts answered-query rows matching `source_gap`/`sourceGap`
true; fallback reason codes `source_gap`, `coverage_gap`, `no_documents`,
`no_chunks`, `insufficient_evidence`; answer outcomes `source_gap`/`coverage_gap`;
or fallback reason text containing `source_gap`/`coverage_gap`. Counts and the
denominator cover the whole answer window, excluding search `event_type` rows.

- **SLO:** ≤ 15 % of answers over 7 days.
- **Manual warning target:** > 20 % over 24 h. **Manual page target:** > 30 % over 6 h (step change —
  suggests retrieval, enrichment, or corpus regression, not user behavior).

### Quality — unsupported rate

_Configured: `OPS_UNSUPPORTED_ANSWER_RATE_WARNING` above 15% and
`OPS_UNSUPPORTED_ANSWER_RATE_PAGE` above 25% over the trailing six hours, with at
least 10 answered queries. Longer-window targets and the doubling rule are manual._

`unsupportedRate` counts `unsupported: true`, `answer_supported: false`,
`confidence`/`confidence_level`/`grounding_status: unsupported`, or
`fallback_reason_code`/`answer_outcome: unsupported`. It uses the whole-window
answer count, excluding search `event_type` rows. `routing_mode` alone does not
select the configured counter. A base rate is legitimate for out-of-corpus
questions; investigate the changed corpus/query mix before declaring regression.

- **SLO:** ≤ 10 % of queries over 7 days.
- **Manual warning target:** > 15 % over 24 h. **Manual page target:** > 25 % over 6 h, or a doubling versus
  the trailing-7-day rate. Known confounder: the nondeterministic
  unsupported short-circuit (finding #11) — check its memoization before
  declaring a regression.

```sql
-- Manual routing/confidence diagnostic; narrower/different than the configured
-- unsupportedRate filters listed above. It is not the ops-digest counter.
select
  count(*) filter (where metadata->>'routing_mode' = 'unsupported'
                     or metadata->>'confidence' = 'unsupported')::float
    / greatest(count(*), 1) as unsupported_rate
from rag_queries
where created_at > now() - interval '24 hours';
```

### Reliability — hybrid_rpc_errors rate

_Alerted: `OPS_HYBRID_RPC_ERROR_RATE_{UNKNOWN,WARNING,PAGE}` via `answerSloSnapshot`._

Share of answered-query rows with non-null `hybrid_rpc_errors` metadata.
This is the direct guard against the historical silent-RPC-death incident, so
tolerance is near zero.

- **SLO:** 0 sustained errors. Isolated blips (< 0.1 % over 24 h) tolerated.
- **Warn:** > 0.5 % of queries in the trailing six-hour digest window.
- **Page:** a positive current rate plus complete persisted evidence of the
  same safe RPC identifier failing in each of three consecutive digest
  samples (scheduled or manual, each no more than 12 hours after the last).
  A generic sustained rate or repeated names in one snapshot is
  insufficient. Three consecutive six-hourly scheduled runs can supply that
  history on their own.

```sql
select
  metadata->'hybrid_rpc_errors' as errors, count(*)
from rag_queries
where created_at > now() - interval '6 hours'
  and metadata ? 'hybrid_rpc_errors'
group by 1 order by 2 desc;
```

Complementary standing checks: `search_schema_health()` via
`npm run check:indexing` (fails closed on RPC regression) and the weekly eval
canary below (fails closed on quality regression).

### Reliability — degraded/source-only answer rate

_Alerted: `OPS_DEGRADED_ANSWER_RATE_{UNKNOWN,WARNING,PAGE}` via `answerSloSnapshot`._

`RAG_PROVIDER_MODE=auto` silently degrades to deterministic "Source-only"
answers when generation fails quality gates. Expected occasionally; a spike
means the OpenAI path is broken while users still get 200s.

- **Manual SLO target:** ≤ 10 % of grounded answers over 24 h. The configured
  `degradedRate` denominator is all answered queries in the trailing six-hour
  window, excluding search `event_type` rows.
- **Warn:** > 20 % over the trailing six hours. **Page:** > 50 % over the
  trailing six hours (generation is effectively down).

Measure provider-generation degradation via the explicit
`metadata->>'provider_generation_degraded' = 'true'` flag or fallback reason
codes `provider_auth`, `provider_quota`, `provider_rate_limit`,
`provider_timeout`, `provider_failure`. During rollout, the probe also counts
legacy `fallback_reason ILIKE '%generation_fallback:%'` rows so
recent pre-flag provider failures remain visible until they age out. Keep `degraded` for
the broader source-only UI state and `fallback_reason` as diagnostic detail;
neither is narrow enough for provider health on its own.

### Sentry Production DB Span SLO (#183)

Production database query spans instrumented via Sentry PostgREST tracing
(`src/lib/observability/supabase-tracing.ts`) capture execution latency for
database RPCs and table queries without recording sensitive query parameters or
clinical text (`docs/error-tracking.md`).

- **Target / Filter:** Production database query spans (`span.op:db` where
  `environment: production`).
- **SLO:** Database query span duration p95 ≤ 500 ms under normal production load.
- **Metric alert criteria:** Sentry metric alert triggers when production
  database query span `p95(span.duration) > 500ms` over a **5-minute rolling window**.
- **Triage & Diagnostics:**
  - Check Sentry Queries dashboard (**Dashboards → Sentry Built → Queries** and
    **Explore → Traces**) to identify slow database operations, unindexed query
    scans, connection pool exhaustion, or transaction lock contention.
  - Cross-reference with `/api/health?deep=1` degradation counters (`slo`,
    `cache`, `coalescing`) and Supabase project metrics to isolate backend query
    slowdowns from application-layer bottlenecks.

## 3. Weekly production eval canary

`.github/workflows/eval-canary.yml` — scheduled weekly on Sunday at 18:00 UTC
(Monday 02:00 Australia/Perth). It has no `workflow_dispatch` button: an on-demand
run is a `repository_dispatch` event of type `eval-canary`, for example
`gh api repos/BigSimmo/PsychSift/dispatches -f event_type=eval-canary` (optional
`client_payload` keys: `answer_case_limit` 1 to 100, `rag_ranking_config`,
`answer_quality_eval`, `dump_rag_cases`). Every dispatch is provider-backed and
needs the owner's explicit yes and a spend cap first (see "Spending approval for
each billable run" in `AGENTS.md`). `tests/eval-canary-workflow.test.ts` pins the
absence of `workflow_dispatch`.

What it does, in order:

1. `npm run check:supabase-project` — hard guard that the configured env
   points at `sjrfecxgysukkwxsowpy` and nothing else.
2. `npm run eval:retrieval:quality -- --fail-on-threshold` — the golden
   retrieval eval (36 committed cases plus any captured cases, including
   forced-vector probes) against the live
   corpus. This is the eval CI never runs on PRs (it needs live Supabase +
   OpenAI keys); the canary makes it a standing weekly guard instead of a
   manual pre-merge step that can be skipped.
3. The answer-quality step runs `eval:quality` with `--rag-only --limit 44`,
   supplies `.local/eval-canary/golden-retrieval.json` through
   `--source-governance-results`, and enables `--fail-on-threshold`. The
   separate retrieval artifact populates the Source Governance table without
   rerunning retrieval or changing answer-gate thresholds. The workflow writes
   the structured JSON and Markdown reports into the `eval-canary-output`
   artifact with the tested Git SHA and run identity.

Failing loudly:

- Any threshold failure fails the workflow run (red scheduled-run badge, email per
  GitHub notification settings).
- On scheduled failures the workflow **opens a GitHub issue** labeled
  `eval-canary` (or comments on the existing open one), so a regression
  creates a durable, assignable artifact rather than a missed notification.
- The failure comment records every step outcome plus a deterministic failure
  class derived from the captured eval logs. A completed non-zero
  `failed_cases` summary is classified as a probable regression; raw provider
  failures and the all-cases/no-retrieval-layers signature are classified as
  provider or live-configuration failures.

Required secrets: `SUPABASE_SERVICE_ROLE_KEY` from the `production-secrets`
GitHub environment (`main` only; see `docs/deployment-architecture.md`, "The
production-secrets environment") and the repository secret `OPENAI_API_KEY`.
The workflow preflights these and fails with an explicit message when absent.

Operational notes:

- The canary reads live shared corpus state; a pass is a snapshot, and a
  failure can be corpus-state-dependent (see the clozapine-wcc history).
  Triage order: inspect the recorded failure class and failed step → resolve
  provider/configuration failures or inspect `hybrid_rpc_errors` and
  `check:indexing` → only then bisect code. A `repository_dispatch` rerun and all
  live checks require explicit provider approval.
- Forced-vector golden cases (`forceEmbedding`) run after many text-fast-path
  cases; the workflow sets `RAG_EVAL_CASE_DELAY_MS` and
  `RAG_EVAL_FORCE_EMBEDDING_DELAY_MS` so embedding calls do not exhaust the
  scheduled run's OpenAI rate limit mid-run.
- Evals write telemetry rows (`rag_queries`) but mutate no content.
- Cost bound: 36 committed retrieval cases plus any captured cases (embedding
  calls only on forced-vector probes) + 44 generated answers per week. A dispatch
  can raise the answer cases to 100 through `answer_case_limit`.
- To compare two or more downloaded structured answer reports without treating
  raw millisecond jitter as a content regression, run
  `npm run eval:trend -- --answer-quality <oldest-report.json> <newest-report.json>`.
  Add `--case <case-id>` for the per-run route, latency, and diagnostic
  signature of one case. A `same_tree_content_variability` result means the
  reports share a Git SHA but differ in content/citation outcomes; provider and
  latency-threshold variability are reported separately.
- **The schedule only runs from `main`.** After merging a change to the
  workflow, send one approved `repository_dispatch` (`event_type=eval-canary`)
  and confirm it goes green before trusting the weekly cadence (repo gate for
  this workflow).

### 3.1 Boundary-case and metric-interpretation policy (2026-07-20)

Standing rules distilled from the ADDENDUM-4 eval/tuning cycle so the next
regression triage does not relearn them:

- **Top-5 boundary cases are a human decision, never a silent retry.** When a
  golden case's expected document sits at the top-5 boundary among multiple
  legitimate sources (the alcohol-ciwa history), the fix is alias coverage or
  a deliberately widened gate — chosen by a human with the run artifact open,
  not by rerunning until green or by ranking nudges aimed at one fixture.
- **Fixture and snapshot move together.** The ranking snapshot's case count is
  pinned to the golden fixture (tests/ranking-tuning.test.ts) and the snapshot
  carries `generatedAt` provenance with a 30-day freshness gate. Regenerate
  from the latest `eval-canary-output` artifact via
  `npm run build:ranking-snapshot` — never hand-edit either file.
- **mrr@10 has a baseline step at 2026-07-20.** The lithium case was the only
  ungated case (its rr was a hardcoded 0); gating it lifted measured mrr@10 by
  ~+0.028 with zero retrieval change. Trend readers must treat that date as a
  baseline reset, not an improvement.
- **`irrelevant_source_rate@10` is a labeling question before it is a ranking
  question.** The rate is dominated by broad/vector cases whose extra top-10
  documents are topically adjacent (e.g. sibling guidelines). Before treating
  the metric as ranking debt, audit whether those documents are under-labeled
  relevant (the alias-tier lesson) — widening sanctioned labels may be the
  correct fix and ranking changes aimed at the raw number may be optimizing
  against mislabeled ground truth.
- **Ordering-headroom changes need a live pair, and two shapes are refuted.**
  The residual rank-depth headroom on passing fast-path cases resisted both
  per-class feature-weight tuning (live no-op, 2026-07-20 pair #53/#54) and a
  saturation-tail spread of the primary/near-primary sort keys (live
  regression, pair #54/#55 — spreading any comparator key ABOVE the
  relevance score lets raw ts_rank override boost/title/subject-aware
  ordering; see the branch-review ledger for the full post-mortems). Any third
  attempt must (a) insert strictly BELOW the relevance key in the release
  comparators, (b) carry a discriminating offline test that fails on the old
  code with differently-relevant candidates (identical-content fixtures hide
  this failure mode), and (c) run a dedicated before/after canary pair with
  doc/content recall pinned at 1.0.
- **Durable trend rows.** The `eval-canary-output` artifact expires after 30
  days, so on its own it is not a durable record: by 2026-10-20 nothing after
  4 Oct was recorded anywhere (audit EVAL-06). Every canary run, cancelled and
  timed-out runs included, now posts one row to the rolling **Eval canary
  trend** issue (label `eval-canary-trend`, never closed) and repeats it in the
  job summary: date, trigger, job status, each half's step outcome, retrieval
  recall/MRR/irrelevant@10/p90 and failing case IDs, answer rates, cost and
  failing case IDs. Rows carry no question, answer or source text, and mention
  nobody (`scripts/lib/eval-canary-trend.mjs`). Nothing is committed from CI.
- **Artifact-based trends.** Within the 30-day retention,
  `npm run eval:trend -- <artifact.json...>` renders the fuller run-over-run
  metric table (and `--case <id>` a per-case rr trend) from downloaded
  artifacts.

### 3.2 Canary Latency & Cost SLOs (#305)

The weekly production canary evaluation (`.github/workflows/eval-canary.yml`)
tracks multi-stage retrieval latency against hard budgets and computes un-cached
cost lower bounds:

- **Retrieval Latency Budget (p90 ≤ 20 s):** Multi-stage retrieval evaluation
  enforces an explicit latency budget of **p90 ≤ 20 s** across all evaluated cases
  (with a 25 s per-case timeout ceiling). Answer generation flows nearing this
  threshold risk triggering `OPENAI_ANSWER_TIMEOUT_MS` (30 s) timeouts and
  falling back into degraded source-only responses.
- **Canary Cold Cost Lower Bounds:**
  - The weekly canary executes 36 committed retrieval cases (plus captured
    cases; embedding API calls occur only on forced-vector probes) and generates
    answers for 44 golden cases.
  - Cost metrics reported by the canary reflect a **cold lower bound** on
    execution costs because the CI runner runs without pre-warmed in-memory or
    shared response caches.
  - Telemetry rows are recorded in `rag_queries` for timing and routing
    analysis, but all evaluation queries are non-mutating and preserve
    underlying knowledge base state.

## 4. Degradation counters on `/api/health` (shipped)

The §2 reliability SQL is now also a scrape. An **authorized deep probe** —
`GET /api/health?deep=1` with the `x-health-deep-token: $HEALTH_DEEP_PROBE_SECRET`
header (same operator gate as the Supabase probe) — returns up to five counter
blocks (each is omitted when its probe is unavailable):

- **`slo`** — `answerSloSnapshot` (`src/lib/observability/answer-slo.ts`) counts
  `rag_queries` over the trailing `windowMinutes` (60) and reports
  `hybridRpcErrorQueries` / `hybridRpcErrorRate` (the §2 silent-RPC-death guard)
  and `degradedQueries` / `degradedRate` (the explicit provider-generation
  fallback guard, excluding intentional extractive and unsupported/source-gap outcomes). These
  are windowed rates straight from the persisted telemetry.

- **`cache`** — `cacheMetricsSnapshot` (`src/lib/observability/cache-metrics.ts`)
  reports `{ lookups, hits, misses, hitRate }` for the retrieval search cache,
  incremented in-process at the two-layer cache orchestration in
  `searchChunksWithTelemetry` (`src/lib/rag/rag.ts`). A request served by **either**
  the process-local or the shared (`rag_response_cache`) layer counts as a hit,
  so a cold process falling through to a warm shared cache is not miscounted as a
  miss; disabled/skipped lookups are recorded as neither. These are **cumulative
  since process start** (Prometheus-style): a scraper derives a windowed hit-rate
  from the delta between two polls. Measuring at the lookup site — not from
  `rag_queries` — also captures coalesced and fully cache-served requests that
  never write a telemetry row. `hitRate` is a convenience for eyeballing a single
  probe.

- **`coalescing`** — `answerCoalescingMetricsSnapshot`
  (`src/lib/observability/answer-coalescing-metrics.ts`) reports cumulative
  coalescible answer **originations**, duplicate **coalescedWaiters**, and the
  current **activeOriginations** gauge for this one app process. It has no query,
  owner, document, cache key, or clinical content. A scraper must derive a
  windowed `coalescingRate` from counter deltas; the supplied rate is a
  process-lifetime convenience. This is an operational capacity/cost signal,
  not a liveness gate: a sustained near-zero rate during a known duplicate-heavy
  ward round means cache keys, cache settings, or replica dilution should be
  investigated before adding app replicas.

- **`spend`** — `spendSnapshot` (`src/lib/observability/spend-metrics.ts`),
  gated exactly like `slo` on the admin client. It carries the projected daily
  answer-generation spend that raises `OPS_PROJECTED_DAILY_SPEND_WARNING`; it is
  a cost signal, not a liveness or quality gate.

- **`storageCleanup`** — `storageCleanupBacklogSnapshot`
  (`src/lib/observability/cleanup-backlog.ts`), gated like `spend`. It reports
  `{ pending, failed, expiredClaims, outstanding, oldestOutstandingAt }` for the
  `storage_cleanup_jobs` rows a drain can act on now (a governed public-source row
  is not counted before its `public_source_cleanup_not_before` deadline, and a
  `processing` row counts once its claim expires): head-only counts and one
  timestamp, never paths, titles or owners. The ops
  digest prints it as **Storage cleanup backlog**; see
  [Storage cleanup backlog](#storage-cleanup-backlog) for the manual drain.

```jsonc
// GET /api/health?deep=1  (authorized, live)
"slo":   { "windowMinutes": 60, "totalQueries": 412,
           "hybridRpcErrorQueries": 0, "hybridRpcErrorRate": 0.0,
           "degradedQueries": 26,      "degradedRate": 0.063 },
"cache": { "lookups": 1873, "hits": 1402, "misses": 471, "hitRate": 0.748 },
"coalescing": { "originations": 312, "coalescedWaiters": 100,
                 "activeOriginations": 4, "coalescingRate": 0.243 }
```

**The counter _values_ never flip liveness.** A bad SLO rate or a cold cache
stays visible without changing readiness — degradation is made _visible_, not
_fatal_, which is the failure mode this doc guards against. Liveness is driven
only by the reachability `checks`: a failing `probeSupabaseHealth()` still sets
`checks.supabase = "error"` and returns `503`, whereas an `answerSloSnapshot()`
query failure merely omits the `slo` block (never a false-healthy zero). The
cache counter is always present for a token-authorized probe (in-process, works
in demo mode). The cache and coalescing blocks are process-local and reset on
deploy/restart, so operators must use per-process deltas rather than combine raw
counter values across replicas. All three blocks are wired through
`src/lib/health-response.ts` and are
**withheld from the unauthenticated `/api/health/ready` endpoint** (Railway's
readiness target, which exposes no diagnostic details). The §2 warn/page
thresholds map directly onto these fields.

## 5. Operational alert delivery and drill

`scripts/lib/operational-alerts.mjs` is the provider-neutral policy owner for the §2 answer SLOs. The six-hourly (`15 */6 * * *`) digest emits stable alert codes with owner, escalation owner and this runbook, and publishes `alerting`, highest `severity`, and a compact JSON summary to the workflow. Missing SLO telemetry and a zero-query denominator are `unknown`, never healthy. Each authorised deep probe returns only safe internal hybrid-RPC identifiers and counts. The workflow stores the last three identity-only observations from the hourly `slo` snapshot in the GitHub Actions cache, then pages `OPS_HYBRID_RPC_ERROR_RATE_PAGE` only when the same RPC has a nonzero count in three consecutive digest samples. The digest runs every six hours at `15 */6 * * *` (`.github/workflows/ops-digest.yml`), so each scheduled run records one hourly identity sample and consecutive scheduled samples are six hours apart; the answer-rate rules, including the hybrid-RPC warning, read the trailing six-hour window instead. The condition counts consecutive samples, not consecutive UTC hours: scheduled and manual runs both count, and a sample joins the sequence when it lands no more than 12 hours (two schedule intervals) after the previous one, so a late or dropped GitHub cron fire does not break it. Three consecutive scheduled runs can therefore page on their own. A second run in the same UTC hour replaces that hour's observation rather than adding one. A missing, evicted, malformed, incomplete, or non-contiguous history is never promoted to a page. Degraded answers page independently and immediately only above the documented 50% threshold on the trailing six-hour window.

The digest's **Service readiness** headline describes the service checks, not answer quality. The digest shows the trailing six-hour **Answer quality** block first, as the window alerts judge, then the hourly **Answer SLO** block. A judged window (the trailing snapshot, or an older build's exactly 60-minute one) with zero answered queries displays **No answered queries observed—answer quality not assessed**, with rates shown as **N/A**; an empty hourly block beside a trailing one says only that the last 60 minutes had no answers. A trailing window with 1 to 9 answers says its rates are not judged. The underlying counters and machine-readable `OPS_ANSWER_SLO_UNKNOWN` alert remain unchanged: this is an unassessed window, not a measured degraded-answer incident or proof of healthy answers. A missing SLO block or invalid window must not be labelled as no answer activity. When the trailing query itself fails, the probe returns `sloTrailing: { windowMinutes: 360, unavailable: true }`, the digest shows **Snapshot query failed—answer quality not assessed** and raises `OPS_ANSWER_SLO_UNKNOWN`; it never falls back to judging the hourly snapshot alone.

Delivery remains configurable without changing policy. The workflow (`.github/workflows/ops-digest.yml`) keeps the rolling GitHub issue body as the latest snapshot. It posts an attention comment only on a scheduled run at `warning` or `page` severity or with a service status other than `ok` (unreachable, degraded or unknown), or on a manual `workflow_dispatch` run with the `publish_alert_comment` boolean. Before posting that comment it assigns the issue to the repository owner, and the comment @mentions the owner. **The owner chose phone notification as the production alert channel on 2026-10-19**, delivered through the GitHub mobile app, which pushes direct mentions. The mention is what pushes every alert: the issue is reused, so assignment alone would push only the first one. Since 2026-10-20 every other alert workflow (eval canary, ingestion autopilot, live domain monitor, live drift, staging tenancy, Sentry alerts, main-branch CI failures and the reindex reaper) names the owner the same way in each new alert issue and each repeat comment (audit EVAL-04); green-run "Resolved" notes do not. `tests/alert-owner-mention.test.ts` pins this. Assignment is best-effort and a refused assignment never stops the comment. An operator may also route the same summary to a host-native or incident channel. Repository wiring is not proof that provider delivery works: phone delivery is unproven until the owner has received one push from this issue.

The rolling issue is the provider-neutral queue. For every alert, the on-duty operator comments `ACK <alert-code> owner=<role> at=<ISO-8601>` before diagnosis and `RECOVERED <alert-code> at=<ISO-8601> evidence=<run-or-dashboard-reference>` only after the recovery condition below is observed. If the owner cannot acknowledge inside 30 minutes, route to the named escalation role using the organisation's configured incident channel; repository roles are routing identities, not GitHub usernames, so the only automatic assignment is the repository owner described above.

### `OPS_ANSWER_SLO_UNKNOWN`

- **Diagnose:** open the workflow run and deep-probe digest; distinguish a missing `sloTrailing`/`slo` block, zero answered-query denominator, and a window of the wrong length (360 minutes for `sloTrailing`, 60 for an older build's `slo`). Check probe authentication and the answer-metrics query before interpreting any rate.
- **Acknowledge:** Platform operations records the failing field or zero-query window and whether answers are still being served. Confirm expected inactivity separately; zero recorded queries alone cannot rule out missing telemetry.
- **Recover:** require a subsequent trailing six-hour snapshot with a positive denominator and valid rates in `0..1`.
- **Escalate:** Clinical safety owner immediately if answers are being served without measurable SLO telemetry; otherwise after 30 minutes without a valid snapshot unless expected inactivity has been confirmed and acknowledged. During confirmed inactivity, keep quality unknown and continue monitoring; do not mark quality healthy or the alert recovered until answered-query evidence meets the recovery condition.

### `OPS_HYBRID_RPC_ERROR_RATE_UNKNOWN`

- **Diagnose:** confirm `hybridRpcErrorRate` is present, finite, in `0..1`, and derived from the same positive trailing-window denominator shown in the digest.
- **Acknowledge:** Platform operations records the malformed/missing field and the health run reference.
- **Recover:** require one subsequent valid trailing six-hour snapshot; do not substitute an ad-hoc lifetime aggregate.
- **Escalate:** Clinical safety owner after 30 minutes or immediately if hybrid retrieval failures are visible to users.

### `OPS_DEGRADED_ANSWER_RATE_UNKNOWN`

- **Diagnose:** confirm `degradedRate` is present, finite, in `0..1`, and derived from the displayed positive trailing-window denominator; inspect source-only/provider-timeout counters without reading query text.
- **Acknowledge:** AI platform owner records the missing/malformed field and route-level impact.
- **Recover:** require one subsequent valid trailing six-hour snapshot.
- **Escalate:** Clinical safety owner after 30 minutes or immediately if answer degradation cannot be bounded.

### `OPS_HYBRID_RPC_ERROR_RATE_WARNING`

- **Diagnose:** inspect the trailing-window hybrid-RPC error count, database function availability, latency, and recent deployment/migration events. Do not infer a sustained condition from a single six-hourly (`15 */6 * * *`) snapshot.
- **Acknowledge:** Platform operations records the measured rate and start of the affected trailing snapshot window.
- **Recover:** require the next valid trailing six-hour snapshot (from a manual dispatch or the next six-hourly digest) at or below `0.5%`.
- **Escalate:** Clinical safety owner if user-visible retrieval is affected or the warning persists into a second trailing snapshot window.

### `OPS_HYBRID_RPC_ERROR_RATE_PAGE`

- **Diagnose:** verify the cached identity-only history contains the same safe RPC identifier in three consecutive digest samples (each no more than 12 hours after the last) with a nonzero count in each. Treat missing, incomplete, malformed, evicted, or non-contiguous history as insufficient for paging; inspect database/RPC availability and recent changes.
- **Acknowledge:** Platform operations opens the configured incident route and records all three window references.
- **Recover:** require a valid hourly snapshot with zero hybrid-RPC errors, followed by owner confirmation that the failing RPC path is restored.
- **Escalate:** Clinical safety owner immediately; keep the incident open until recovery evidence is attached.

### `OPS_DEGRADED_ANSWER_RATE_WARNING`

- **Diagnose:** inspect source-only, timeout, and provider fallback counts for the same trailing six-hour window and identify the dominant route without accessing clinical query text.
- **Acknowledge:** AI platform owner records the measured rate and dominant safe fallback.
- **Recover:** require the next valid trailing six-hour snapshot at or below `20%`.
- **Escalate:** Clinical safety owner if the warning persists into a second window or affects a high-risk clinical route.

### `OPS_DEGRADED_ANSWER_RATE_PAGE`

- **Diagnose:** confirm the rate is above `50%` for the positive trailing-window denominator, then identify provider timeout, retrieval, or source-only fallback as the dominant path.
- **Acknowledge:** AI platform owner opens the configured incident route and records the affected route and safe fallback state.
- **Recover:** require a subsequent valid trailing six-hour snapshot at or below `20%` plus confirmation that fallback messaging remains intact.
- **Escalate:** Clinical safety owner immediately; involve the product owner if service restriction or rollback is considered.

### `OPS_SOURCE_GAP_RATE_WARNING`

- **Diagnose:** verify a valid trailing six-hour snapshot with at least 10 answers and `sourceGapRate > 0.15`. Inspect content-free fallback-code counts, corpus coverage and recent retrieval/enrichment changes; this whole-window rate is distinct from the manual 24-hour target.
- **Acknowledge:** Clinical evaluation owner records the rate, answer count and window, and whether the query mix changed.
- **Recover:** require a subsequent valid trailing six-hour snapshot with at least 10 answers and `sourceGapRate <= 0.15`; a missing rate or low-volume window is unassessed, not recovery.
- **Escalate:** Clinical safety owner if high-risk clinical coverage is affected or the warning persists into a second measured window. Ranking/corpus changes retain their normal approval and canary safeguards.

### `OPS_SOURCE_GAP_RATE_PAGE`

- **Diagnose:** verify a valid trailing six-hour snapshot with at least 10 answers and `sourceGapRate > 0.30`; this step change suggests a retrieval, enrichment or corpus regression rather than user behaviour. Inspect the same content-free fallback-code counts and recent changes; do not read query text.
- **Acknowledge:** Clinical evaluation owner opens the configured incident route and records the rate, answer count, window and suspected change.
- **Recover:** require a subsequent valid trailing six-hour snapshot with at least 10 answers and `sourceGapRate <= 0.15`; a low-volume window is unassessed, not recovery.
- **Escalate:** Clinical safety owner immediately. Ranking/corpus changes retain their normal approval and canary safeguards.

### `OPS_UNSUPPORTED_ANSWER_RATE_WARNING`

- **Diagnose:** verify at least 10 answered queries in a valid trailing six-hour snapshot and `unsupportedRate > 0.15`. Compare the documented unsupported metadata filters and corpus/query mix; unsupported questions can be legitimate, and this is not the manual routing-mode SQL counter.
- **Acknowledge:** AI platform owner records the rate, answer count, window and whether unsupported outcomes are expected for the current corpus.
- **Recover:** require a subsequent valid trailing six-hour snapshot with at least 10 answers and `unsupportedRate <= 0.15`; missing/invalid rates or fewer answers do not establish recovery.
- **Escalate:** Clinical safety owner if previously supported clinical questions lose support or the warning persists into a second measured window.

### `OPS_UNSUPPORTED_ANSWER_RATE_PAGE`

- **Diagnose:** verify at least 10 answered queries in a valid trailing six-hour snapshot and `unsupportedRate > 0.25`. Rule out a burst of out-of-corpus questions and the nondeterministic unsupported short-circuit (finding #11), then check grounding and retrieval health.
- **Acknowledge:** AI platform owner opens the configured incident route and records the rate, answer count, window and whether the short-circuit was checked.
- **Recover:** require a subsequent valid trailing six-hour snapshot with at least 10 answers and `unsupportedRate <= 0.15`.
- **Escalate:** Clinical safety owner immediately.

### `OPS_ANSWER_LATENCY_BUDGET_WARNING`

- **Diagnose:** verify at least 10 answers in a valid trailing six-hour snapshot and `latencyBudgetBreachRate > 0.15`. Inspect the 1,000-row sampling limit, timing-field coverage and route budgets (fast/default 10 s, strong 25 s, extractive/source-only 6 s). Separate sampled breach counts from production p95 and use an authorised timing probe to identify the slow stage when needed.
- **Acknowledge:** Platform operations records the breach rate, whole-window answer count, sampled-row coverage and affected route mix; never label the warning a p95 incident without percentile evidence.
- **Recover:** require a subsequent valid trailing six-hour snapshot with at least 10 answers and `latencyBudgetBreachRate <= 0.15`, plus confirmation that timing coverage remains measurable. A sparse/invalid snapshot is not recovery.
- **Escalate:** AI platform owner if the warning persists into a second measured window or provider timeouts affect users; provider or model configuration changes remain approval-gated.

### `OPS_ANSWER_LATENCY_P95_WARNING`

- **Diagnose:** read which routes the alert names and their sample counts; compare each route's p95 with its warning line (fast 10 s, strong 25 s, extractive 6 s). Check provider latency, recent deploys and whether the sample was capped. Use an authorised timing probe to split one request by stage when needed.
- **Acknowledge:** Platform operations records the route, p95, sample count, window and cap flag.
- **Recover:** require a subsequent valid trailing six-hour snapshot with that route's p95 at or under its warning line and at least 20 sampled answers; fewer samples are unassessed, not recovery.
- **Escalate:** AI platform owner if the warning persists into a second measured window or `strong` answers approach the 30 s provider timeout; provider or model configuration changes remain approval-gated.

### `OPS_ANSWER_LATENCY_P95_PAGE`

- **Diagnose:** confirm the named route's p95 is over its page line (fast 20 s, strong 35 s, extractive 12 s) with at least 20 sampled answers. A `strong` p95 near 35 s means answers are riding the timeout and silently falling back; check the degraded-answer rate in the same digest.
- **Acknowledge:** Platform operations opens the configured incident route and records the route, p95, sample count and cap flag.
- **Recover:** require a subsequent valid trailing six-hour snapshot with the route back at or under its warning line and at least 20 sampled answers.
- **Escalate:** AI platform owner immediately.

### `OPS_PROJECTED_DAILY_SPEND_WARNING`

- **Diagnose:** compare the projection threshold, sample-truncation flag, answer volume, and route-level spend; treat a truncated sample as a lower bound.
- **Acknowledge:** Platform operations records the projection and whether usage or unit cost changed.
- **Recover:** require a subsequent snapshot below the configured threshold or a documented temporary budget decision.
- **Escalate:** Product owner before changing budgets, throttles, model routes, or provider configuration.

### `OPS_EVAL_CANARY_STALE_WARNING`

- **Diagnose:** open the latest completed `eval-canary.yml` run and distinguish a dropped schedule, failed run, cancelled or timed-out run, or missing timestamp. Only a run that reached a pass or fail verdict keeps liveness green; cancelled and timed-out runs evaluated nothing and do not count (audit EVAL-08). The canary also opens its "did not complete" failure issue for them.
- **Acknowledge:** Clinical evaluation owner records the last run with a verdict and its age.
- **Recover:** with explicit provider-run approval, complete a canary successfully and attach its run reference; a workflow dispatch alone is not recovery.
- **Escalate:** Clinical safety owner when staleness exceeds eight days; provider-backed dispatch and any failure remediation remain approval-gated.

**Acknowledgement/recovery drill:** dispatch the digest only with existing operator/provider approval; use a synthetic or staging snapshot to trigger one warning; execute that alert's exact diagnosis, acknowledgement, recovery, and escalation route above; retain the run link and timestamps outside this repository. Do not manufacture production failures or paste health-probe secrets into evidence. Until this drill is exercised, alert delivery is configured but externally unaccepted.

### Ingestion worker paused

The ingestion worker has no public address and the deep probe does not reach it, so a stopped or
paused worker used to be silent: pending uploads of any age counted as healthy (audit EVAL-03).
Two things now cover it:

- **Digest line, not an alert code.** The digest's **Ingestion worker** line reads the GitHub
  repository variable `INGESTION_WORKER_PAUSED`: `true` shows ⏸ paused on purpose, `false` shows
  expected to be running, and unset says the state is not recorded. Set it whenever the worker is
  paused or resumed (`docs/worker-deploy-runbook.md` §5). It never changes the digest's alert
  severity, so a deliberate pause does not mention the owner every six hours.
- **Autopilot alert on unclaimed uploads.** The six-hourly ingestion autopilot alerts when a
  `pending` job has been due (its `next_run_at`, or `created_at` without one) for more than 30
  minutes with nothing claiming it, whether or not the worker is marked paused. When it is marked
  paused, the reason says so: resume the worker to process the upload.

### Storage cleanup backlog

When a document delete cannot remove its stored files, the delete still succeeds and the leftover
paths are queued as a `storage_cleanup_jobs` row: `pending` while the delete handler runs, `failed`
when a storage removal failed. **Nothing drains this queue on a schedule.** The digest line
**Storage cleanup backlog** shows the outstanding count (audit F-10) and adds a ⚠ when any row
is `failed` or the oldest outstanding row is more than an hour old. It is a digest line, not an
alert code: it does not change the digest's alert severity.

- **Diagnose:** read the counts and the oldest timestamp in the latest digest. A growing `failed`
  count usually means storage removals are being refused (bucket permissions, a storage outage);
  a `pending` row older than an hour means a delete was interrupted after its ledger row was
  written.
- **Drain (manual, live):** `npm run cleanup:storage` (`scripts/cleanup-storage.ts`) runs
  against the live Supabase project with the service-role key, so it falls under the API and
  provider confirmation boundary in `AGENTS.md`: get the owner's explicit yes first. Run it with
  `--dry-run` first, which lists how many generic jobs are safe to process and claims nothing:

  ```bash
  npm run cleanup:storage -- --dry-run --limit 50
  npm run cleanup:storage -- --limit 50
  ```

  It retries the oldest `pending` and `failed` generic jobs (default `--limit 50`), marks each
  `completed` or `failed` with the storage warning, then runs the separately bounded
  controlled public-source cleanup. It never removes files for a job whose document still
  exists (the audit R11 guard): those jobs are skipped and listed by id.

- **Recover:** a later digest shows the outstanding count back at zero, or only `pending` rows
  younger than an hour. Rows that stay `failed` after a drain need their `last_error` read in
  the Supabase dashboard (owner-approved, read-only) before any further retry.

## 6. Remaining gaps

- Exercise and record the acknowledgement/recovery drill through the configured provider channel.
- The storage cleanup backlog is reported but drained only by hand; there is no scheduled drain and no alert code for it.
- The 7-day quality SLOs, the unsupported-rate doubling rule and `/api/search` latency are still hand-run SQL; the digest alerts only on its trailing six-hour window.
- Retain and periodically exercise the GitHub Actions cache path for the hybrid escalation (three consecutive persisted digest samples, see §5). Cache loss intentionally downgrades the condition to warning or unknown rather than inferring history.
- **Host-level metrics** (CPU, memory, restart count) and log drains once the
  container host exists (`docs/deployment-architecture.md` §2).

## 7. Reviewed feedback-to-evaluation triage

`scripts/report-answer-feedback.ts` reports content-free diagnostic counts and
candidate interaction IDs. Run the default local mode with an explicitly supplied
export:

```text
node scripts/run-tsx.mjs scripts/report-answer-feedback.ts --input <local-export.json>
```

The JSON input has `version: "answer-feedback-export-v1"`, a `feedback` array of
`{ interactionId, category }`, and `answers` / `retrievals` arrays containing
`interactionId`, `generation_outcome`, `required_part_count` and
`represented_part_count`. IDs must be UUIDs. Diagnostic counts are integers from
0 to 4, represented cannot exceed required, and generation outcomes are
`generated`, `extractive`, `source_only` or `failed`. Missing fields, unknown
values, conflicting diagnostics or duplicate joins are incomplete. Do not include
raw question/answer text, owner identifiers, content or provider errors in exports.
The report ignores extra metadata and emits only allowlisted values; it never
echoes input errors. A completed scan may still report `incompleteRecords`.

A weekly, content-free summary runs from `.github/workflows/answer-feedback-weekly.yml` (Monday
morning Perth time, `main` only) and writes counts by category and by page (answer, medication record,
therapy record) to the run's job summary:

```text
node scripts/run-tsx.mjs scripts/report-answer-feedback.ts --weekly-summary --project-ref <ref> --confirm-project-ref <ref> --markdown
```

It selects only the category and page type, never the optional note, record slug, owner, answer
hash or any id that joins to query telemetry, after the same exact production identity check.

The eight feedback categories remain supported. `verified` is aggregate-only;
other complete records nominate an evaluation candidate, with `numeric_error`
and `outdated_guidance` routed to clinical review. Incomplete records require a
reproduction. Every result requires de-identification review and forbids automatic
promotion. A feedback token, `verified` rating or diagnostic reviewed-input flag
does not establish clinical approval.

A reviewer obtains a reproducible question from the reporter, removes patient and
site-specific details, and confirms expected evidence and behaviour before using
the existing administrator-authenticated `/api/eval-cases` capture path. Its
`promoted_eval_case` database flag denotes that separate capture population; it
does not promote a programme fixture or grant clinical approval. Pin the targeted
weak family and reference expectation before M2 capture. A programme fixture is
changed only through normal reviewed code. The triage tool does not call the
capture endpoint or change cases, source authority, rankers, prompts or production
behaviour.

Live telemetry access requires separate explicit authorization. `--print-plan`
with `--project-ref`, matching `--confirm-project-ref`, and UTC `--from` / `--to`
timestamps prints the exact proposed read scope and SHA-256 digest, without
loading environment configuration, constructing a client or creating a receipt.
Timestamps use `YYYY-MM-DDTHH:mm:ss.sssZ`; the half-open feedback window must end
in the past and span at most 7 days. Production identity comes from the canonical
repository project configuration. No arbitrary target, table, projection or limit
overrides are accepted.

Only after approval, `--live` replaces `--print-plan` and additionally requires
`--authorization-receipt <reviewed-receipt.json>`. The strict receipt contains
exactly `version` (`provider-authorization-v1`), `operation`
(`answer_feedback_eval_triage_read`), `projectRef`, `planDigest`, `authorizedAt`
and `expiresAt`. Authorization must be current, target/digest matched and valid
for at most 15 minutes. This local receipt is an operator confirmation mechanism,
not clinician authentication. Generic provider permission or credentials alone
cannot authorize this read. No live access was executed to verify this adapter.

The fixed plan allows 200 feedback rows, pages of 50 with at most 5 requests,
then batches of 50 interaction IDs across each telemetry table: at most 8 join
requests / 13 requests total. Each join permits 100 rows and requests a 101st
sentinel. Exact counts must reconcile with returned rows so a server row cap
cannot conceal missing or ambiguous joins. Exhaustion, missing counts, response
errors or detected paging changes fail the entire report, without partial
candidate output. Requests disable retries and redirects and time out after the
lesser of 15 seconds and remaining receipt validity. Local files are bounded to
2 MiB. All caps, projections and policies are bound into the receipt digest.

Live projections are limited to feedback interaction/category and the diagnostic
scalars above, using `rag_queries.metadata.interaction_id` and
`rag_retrieval_logs.metadata.answer.interaction_id` (the latter additionally
requires `metadata.answer.log_source = 'answer'`). Telemetry joins use exact IDs
regardless of telemetry creation time; feedback can arrive after an answer.
Full metadata bags, raw query/answer columns and owner/provider fields are never
selected. These bounded queries do not form a transactional snapshot; hosted
schema, access, telemetry completeness and clinical adequacy remain unverified.
