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

Measurement window is trailing 24 h unless stated; "page" means the loudest
channel available (today: GitHub issue from the canary + host alert; later:
host-native alerting per `docs/deployment-architecture.md`).

**Automation status — read this before trusting a threshold.** Only two of the
objectives below are actually computed and alerted by this repository: the
hybrid-RPC error rate and the degraded/source-only answer rate, both from
`answerSloSnapshot` (`src/lib/observability/answer-slo.ts`), surfaced on the
`/api/health?deep=1` deep probe and raised by the ops digest as
`OPS_HYBRID_RPC_ERROR_RATE_*` and `OPS_DEGRADED_ANSWER_RATE_*`
(`scripts/lib/operational-alerts.mjs`, whose complete code list is
`OPS_ANSWER_SLO_UNKNOWN`, `OPS_HYBRID_RPC_ERROR_RATE_{UNKNOWN,WARNING,PAGE}`,
`OPS_DEGRADED_ANSWER_RATE_{UNKNOWN,WARNING,PAGE}`,
`OPS_PROJECTED_DAILY_SPEND_WARNING` and `OPS_EVAL_CANARY_STALE_WARNING`).

No **production monitor** computes an answer-latency percentile, a source-gap
rate, or an unsupported rate, and no alert code exists for any of them. (The
eval harness does compute a latency percentile - `scripts/eval-retrieval.ts`
enforces a p90 budget over its evaluated cases, cited under "Anchors" below -
but it runs on demand against a fixture corpus, so it says nothing about live
traffic.) Their "warn" and "page" rows below are **targets with a hand-run SQL
probe, not alerts**: a breach is invisible until an operator runs the query.
Each such section is labelled `Manual SQL - not alerted`. Do not cite an unlabelled
threshold as evidence of monitoring coverage, and if one of these is wired up
later, add its `OPS_*` code here and remove the label in the same change.

### Latency — answer p95 by route mode

_Manual SQL - not alerted. No code computes these percentiles; run the query below._

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

**This does not make the section above alerted.** It is an operator probe run by hand, not a
monitor: nothing schedules it and no workflow calls it, so the `Manual SQL - not alerted` label
stands and no `OPS_*` code exists for answer latency. `#TN512M` is the reason it was deliberately
left unscheduled — detection here already outruns attention.

### Database latency — Sentry production DB span SLO (#183)

_Sentry-side alert - provisioning unverified. Nothing in this repository provisions, reads, or tests this alert; `SENTRY_AUTH_TOKEN` appears only in the build-time sourcemap upload (`next.config.ts`). Treat the criteria below as the intended Sentry configuration, not as proof an alert exists._

Sentry metric alert criteria for production database query span duration. Guards against unindexed queries, table locks, RPC latency spikes, and connection pool exhaustion:

- **Metric:** `transaction.duration` / span duration for `span.op:db` spans in environment `production`.
- **SLO:** p95 ≤ 500 ms over a 5-minute rolling evaluation window.
- **Warn / Alert:** p95 > 500 ms over 5 minutes.
- **Operational context:** Sustained breaches indicate Postgres RPC regression (such as unindexed embedding comparisons or table scans) or lock contention. Investigate via Supabase database insights, query performance metrics, and `search_schema_health()`. Requires `SENTRY_AUTH_TOKEN` for programmatic alert provisioning (#183).

### Quality — source-gap rate

_Manual SQL - not alerted. No code computes this rate._

Share of answered queries whose confidence collapsed to a gap
(`fallback_reason` or support modules report `source_gap`).

- **SLO:** ≤ 15 % of answers over 7 days.
- **Warn:** > 20 % over 24 h. **Page:** > 30 % over 6 h (step change —
  suggests retrieval, enrichment, or corpus regression, not user behavior).

### Quality — unsupported rate

_Manual SQL - not alerted. No code computes this rate._

Share of queries with `routing_mode = 'unsupported'` or
`confidence = 'unsupported'`. A base rate is legitimate (out-of-corpus
questions), so alert on deviation, not existence.

- **SLO:** ≤ 10 % of queries over 7 days.
- **Warn:** > 15 % over 24 h. **Page:** > 25 % over 6 h, or a doubling versus
  the trailing-7-day rate. Known confounder: the nondeterministic
  unsupported short-circuit (finding #11) — check its memoization before
  declaring a regression.

```sql
select
  count(*) filter (where metadata->>'routing_mode' = 'unsupported'
                     or metadata->>'confidence' = 'unsupported')::float
    / greatest(count(*), 1) as unsupported_rate
from rag_queries
where created_at > now() - interval '24 hours';
```

### Reliability — hybrid_rpc_errors rate

_Alerted: `OPS_HYBRID_RPC_ERROR_RATE_{UNKNOWN,WARNING,PAGE}` via `answerSloSnapshot`._

Share of queries whose metadata contains a non-empty `hybrid_rpc_errors` map.
This is the direct guard against the historical silent-RPC-death incident, so
tolerance is near zero.

- **SLO:** 0 sustained errors. Isolated blips (< 0.1 % over 24 h) tolerated.
- **Warn:** > 0.5 % of queries in any 1 h window.
- **Page:** any _sustained_ nonzero rate across 3 consecutive hours, or the
  same RPC name failing repeatedly — the app will look healthy while serving
  fallback-quality answers, which is exactly the failure mode to catch.

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

- **SLO:** ≤ 10 % of grounded answers over 24 h.
- **Warn:** > 20 % over 1 h. **Page:** > 50 % over 1 h (generation is
  effectively down).

Measure provider-generation degradation via the explicit
`metadata->>'provider_generation_degraded' = 'true'` flag. During rollout, the
probe also counts legacy `fallback_reason ILIKE '%generation_fallback:%'` rows so
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
(Monday 02:00 Australia/Perth) plus `workflow_dispatch` for on-demand runs.

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

Required repo secrets: `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY`.
The workflow preflights these and fails with an explicit message when absent.

Operational notes:

- The canary reads live shared corpus state; a pass is a snapshot, and a
  failure can be corpus-state-dependent (see the clozapine-wcc history).
  Triage order: inspect the recorded failure class and failed step → resolve
  provider/configuration failures or inspect `hybrid_rpc_errors` and
  `check:indexing` → only then bisect code. A `workflow_dispatch` rerun and all
  live checks require explicit provider approval.
- Forced-vector golden cases (`forceEmbedding`) run after many text-fast-path
  cases; the workflow sets `RAG_EVAL_CASE_DELAY_MS` and
  `RAG_EVAL_FORCE_EMBEDDING_DELAY_MS` so embedding calls do not exhaust the
  scheduled run's OpenAI rate limit mid-run.
- Evals write telemetry rows (`rag_queries`) but mutate no content.
- Cost bound: 36 committed retrieval cases plus any captured cases (embedding
  calls only on forced-vector probes) + 44 generated answers per week.
- To compare two or more downloaded structured answer reports without treating
  raw millisecond jitter as a content regression, run
  `npm run eval:trend -- --answer-quality <oldest-report.json> <newest-report.json>`.
  Add `--case <case-id>` for the per-run route, latency, and diagnostic
  signature of one case. A `same_tree_content_variability` result means the
  reports share a Git SHA but differ in content/citation outcomes; provider and
  latency-threshold variability are reported separately.
- **The schedule only runs from `main`.** After merging, trigger one
  `workflow_dispatch` run and confirm it goes green before trusting the
  weekly cadence (repo gate for this workflow).

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
- **Artifact-based trends.** Every canary run uploads `eval-canary-output`
  (30-day retention). `npm run eval:trend -- <artifact.json...>` renders the
  run-over-run metric table (and `--case <id>` a per-case rr trend) from
  downloaded artifacts — the durable trend record without any new
  infrastructure.

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
header (same operator gate as the Supabase probe) — returns up to four counter
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

`scripts/lib/operational-alerts.mjs` is the provider-neutral policy owner for the §2 answer SLOs. The daily (22:00 UTC) digest emits stable alert codes with owner, escalation owner and this runbook, and publishes `alerting`, highest `severity`, and a compact JSON summary to the workflow. Missing SLO telemetry and a zero-query denominator are `unknown`, never healthy. Each authorised deep probe returns only safe internal hybrid-RPC identifiers and counts. The workflow stores the last three identity-only hourly observations in the GitHub Actions cache, then pages `OPS_HYBRID_RPC_ERROR_RATE_PAGE` only when the same RPC has a nonzero count in all three contiguous UTC-hour buckets. The digest runs once a day (`.github/workflows/ops-digest.yml`), so each scheduled run measures a single 60-minute window and consecutive windows are a day apart: this three-contiguous-hour condition needs one successful run in each of three consecutive UTC-hour buckets; scheduled and manual runs both count, so in practice manual dispatches supply at least two of them (a second run in the same bucket replaces that hour's observation rather than adding one), and the scheduled path cannot page it. A missing, evicted, malformed, incomplete, or non-contiguous history is never promoted to a page. Degraded answers page independently and immediately only above the documented 50% hourly threshold.

The digest's **Service readiness** headline describes the service checks, not answer quality. An exactly 60-minute snapshot with zero answered queries displays **No answered queries observed—answer quality not assessed**, with answer-SLO rates shown as **N/A**. The underlying counters and machine-readable `OPS_ANSWER_SLO_UNKNOWN` alert remain unchanged: this is an unassessed window, not a measured degraded-answer incident or proof of healthy answers. A missing SLO block or invalid window must not be labelled as no answer activity.

Delivery remains configurable without changing policy: the checked-in workflow updates the rolling GitHub issue each hour, but an attention comment requires the `publish_alert_comment` boolean on a manual operator-confirmed dispatch. An operator may route the same summary to a host-native or incident channel. Repository wiring is not proof that provider delivery works.

The rolling issue is the provider-neutral queue. For every alert, the on-duty operator comments `ACK <alert-code> owner=<role> at=<ISO-8601>` before diagnosis and `RECOVERED <alert-code> at=<ISO-8601> evidence=<run-or-dashboard-reference>` only after the recovery condition below is observed. If the owner cannot acknowledge inside 30 minutes, route to the named escalation role using the organisation's configured incident channel; repository roles are routing identities, not GitHub usernames, so automatic issue assignment remains provider-gated.

### `OPS_ANSWER_SLO_UNKNOWN`

- **Diagnose:** open the workflow run and deep-probe digest; distinguish a missing `slo` block, zero answered-query denominator, and a window other than exactly 60 minutes. Check probe authentication and the answer-metrics query before interpreting any rate.
- **Acknowledge:** Platform operations records the failing field or zero-query window and whether answers are still being served. Confirm expected inactivity separately; zero recorded queries alone cannot rule out missing telemetry.
- **Recover:** require a subsequent 60-minute snapshot with a positive denominator and valid rates in `0..1`.
- **Escalate:** Clinical safety owner immediately if answers are being served without measurable SLO telemetry; otherwise after 30 minutes without a valid snapshot unless expected inactivity has been confirmed and acknowledged. During confirmed inactivity, keep quality unknown and continue monitoring; do not mark quality healthy or the alert recovered until answered-query evidence meets the recovery condition.

### `OPS_HYBRID_RPC_ERROR_RATE_UNKNOWN`

- **Diagnose:** confirm `hybridRpcErrorRate` is present, finite, in `0..1`, and derived from the same positive 60-minute denominator shown in the digest.
- **Acknowledge:** Platform operations records the malformed/missing field and the health run reference.
- **Recover:** require one subsequent valid hourly snapshot; do not substitute an ad-hoc lifetime aggregate.
- **Escalate:** Clinical safety owner after 30 minutes or immediately if hybrid retrieval failures are visible to users.

### `OPS_DEGRADED_ANSWER_RATE_UNKNOWN`

- **Diagnose:** confirm `degradedRate` is present, finite, in `0..1`, and derived from the displayed positive hourly denominator; inspect source-only/provider-timeout counters without reading query text.
- **Acknowledge:** AI platform owner records the missing/malformed field and route-level impact.
- **Recover:** require one subsequent valid hourly snapshot.
- **Escalate:** Clinical safety owner after 30 minutes or immediately if answer degradation cannot be bounded.

### `OPS_HYBRID_RPC_ERROR_RATE_WARNING`

- **Diagnose:** inspect the hourly hybrid-RPC error count, database function availability, latency, and recent deployment/migration events. Do not infer a three-hour condition from this snapshot.
- **Acknowledge:** Platform operations records the measured rate and start of the affected hourly window.
- **Recover:** require the next valid hourly snapshot at or below `0.5%`.
- **Escalate:** Clinical safety owner if user-visible retrieval is affected or the warning persists into a second hourly window.

### `OPS_HYBRID_RPC_ERROR_RATE_PAGE`

- **Diagnose:** verify the cached identity-only history contains the same safe RPC identifier in three contiguous UTC-hour buckets with a nonzero count in each. Treat missing, incomplete, malformed, evicted, or non-contiguous history as insufficient for paging; inspect database/RPC availability and recent changes.
- **Acknowledge:** Platform operations opens the configured incident route and records all three window references.
- **Recover:** require a valid hourly snapshot with zero hybrid-RPC errors, followed by owner confirmation that the failing RPC path is restored.
- **Escalate:** Clinical safety owner immediately; keep the incident open until recovery evidence is attached.

### `OPS_DEGRADED_ANSWER_RATE_WARNING`

- **Diagnose:** inspect source-only, timeout, and provider fallback counts for the same hourly window and identify the dominant route without accessing clinical query text.
- **Acknowledge:** AI platform owner records the measured rate and dominant safe fallback.
- **Recover:** require the next valid hourly snapshot at or below `20%`.
- **Escalate:** Clinical safety owner if the warning persists into a second window or affects a high-risk clinical route.

### `OPS_DEGRADED_ANSWER_RATE_PAGE`

- **Diagnose:** confirm the rate is above `50%` for the positive 60-minute denominator, then identify provider timeout, retrieval, or source-only fallback as the dominant path.
- **Acknowledge:** AI platform owner opens the configured incident route and records the affected route and safe fallback state.
- **Recover:** require a subsequent valid hourly snapshot at or below `20%` plus confirmation that fallback messaging remains intact.
- **Escalate:** Clinical safety owner immediately; involve the product owner if service restriction or rollback is considered.

### `OPS_PROJECTED_DAILY_SPEND_WARNING`

- **Diagnose:** compare the projection threshold, sample-truncation flag, answer volume, and route-level spend; treat a truncated sample as a lower bound.
- **Acknowledge:** Platform operations records the projection and whether usage or unit cost changed.
- **Recover:** require a subsequent snapshot below the configured threshold or a documented temporary budget decision.
- **Escalate:** Product owner before changing budgets, throttles, model routes, or provider configuration.

### `OPS_EVAL_CANARY_STALE_WARNING`

- **Diagnose:** open the latest completed `eval-canary.yml` run and distinguish a dropped schedule, failed run, or missing timestamp.
- **Acknowledge:** Clinical evaluation owner records the last completed run and age.
- **Recover:** with explicit provider-run approval, complete a canary successfully and attach its run reference; a workflow dispatch alone is not recovery.
- **Escalate:** Clinical safety owner when staleness exceeds eight days; provider-backed dispatch and any failure remediation remain approval-gated.

**Acknowledgement/recovery drill:** dispatch the digest only with existing operator/provider approval; use a synthetic or staging snapshot to trigger one warning; execute that alert's exact diagnosis, acknowledgement, recovery, and escalation route above; retain the run link and timestamps outside this repository. Do not manufacture production failures or paste health-probe secrets into evidence. Until this drill is exercised, alert delivery is configured but externally unaccepted.

## 6. Remaining gaps

- Exercise and record the acknowledgement/recovery drill through the configured provider channel.
- Retain and periodically exercise the GitHub Actions cache path for the three-consecutive-hour hybrid escalation. Cache loss intentionally downgrades the condition to warning or unknown rather than inferring history.
- **Host-level metrics** (CPU, memory, restart count) and log drains once the
  container host exists (`docs/deployment-architecture.md` §2).

## 6. Reviewed feedback-to-evaluation triage

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
