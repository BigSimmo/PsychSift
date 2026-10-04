# Worker deploy runbook

Operator recipe for shipping the containerized ingestion worker
(`Dockerfile.worker`). This is the "how to run it" companion to the decision
record in [`deployment-architecture.md`](deployment-architecture.md) §3
(_containerized worker over completing the edge-agent migration_) — read that
first for the **why**. The `indexing-v3-agent` Edge Function stays in place as
the cron-triggered completion/repair gate; the container is the extraction
engine, not a replacement for it.

This is the detailed expansion of the **Worker** bullet in
[`launch-operator-runbook.md`](launch-operator-runbook.md) §6 (Post-deploy) —
that runbook is the launch sequence; this one is the worker recipe. The actual
deploy is an operator action — see the gate in step 0.

Production host is **Railway** (`deployment-architecture.md` §2); the image is
host-agnostic, so the `docker run` recipe below maps 1:1 onto Railway service
env vars + a restart policy (or any OCI host).

Railway probes `/health` on its injected `PORT`. The worker binds that port when
`WORKER_HEALTH_PORT` is absent. An explicit local `WORKER_HEALTH_PORT` still takes
precedence; on Railway, leave it unset or ensure it equals `PORT`. Set variables
through the service's supported variable configuration, not `deploy.env` in
config as code. The 300-second rollout window allows boot and probe retries;
database or Python failures still return 503 and block promotion.
The Supabase probe reports failures as a structured result; `/health` honours
that result as well as thrown errors and omits provider failure details.

---

## 0. Pre-deploy gate — do not deploy before this is live

**Migration `20260708130000_ingestion_concurrency_rpc_hardening.sql` must be
applied to the live project _before_ the worker is (re)deployed from current
`main`.**

`worker/main.ts` passes `p_worker_id` to the lease-fence RPCs
(`complete_ingestion_job`, `fail_or_retry_ingestion_job`,
`complete_strict_enrichment_job`). Deploying the new worker against a database
that has not yet taken this migration means the R1/R2 lease fences the worker
relies on are not present. See
[`operator-apply-july8-batch.md`](archive/operator-apply-july8-batch.md) (step 2:
_"apply before worker redeploy"_) for the ordered apply plan.

Confirm the gate before continuing:

```bash
node -v                  # must report >= 24.15.0 < 25 (Node 24 engine floor)
npm -v                   # must report >= 11.0.0 < 12 (npm 11)
npm run check:runtime    # validates Node 24 and npm 11 engines
npm run reindex:health   # ok:true, and the RPC signatures accept p_worker_id
```

If migrations are still outstanding, stop here and apply them first.

### 0.1 Automated pre-deploy gate

Railway deploys the app and worker images, and the Supabase GitHub integration
applies merged migrations, **independently and unordered** — there is no
built-in "migrations before code" ordering. `railway.app.json` and
`railway.worker.json` each declare a `deploy.preDeployCommand` that runs
`node /app/scripts/deploy/await-migrations.mjs` before the new container
starts serving traffic. The command reads a manifest of migration versions
baked into the image at build time
(`scripts/deploy/write-migration-manifest.mjs`, from `supabase/migrations`)
and reads the live database's migration history
(`public.migration_history_versions()`) to see whether every expected version
is present.

Three modes, controlled by the `DEPLOY_MIGRATION_GATE` Railway service
variable. Any other value (a typo, a stray space) is treated as `report` and
logs a warning — an unrecognised value must never be the reason a deploy
blocks:

- **`report` (default for this change).** Makes exactly ONE read, logs `PASS`
  or the missing versions / read error, and always exits 0 immediately — no
  polling, no wait. Use this to watch how the gate behaves against real
  deploys before it can block one.
- **`enforce`.** Polls every `DEPLOY_MIGRATION_GATE_POLL_S` seconds (default
  20, floored at 1) and fails the pre-deploy step (blocking the deploy) if
  migrations are still missing, or the migration-history read keeps failing,
  once `DEPLOY_MIGRATION_GATE_MAX_WAIT_S` (default 600, capped at 3000) has
  elapsed. A non-numeric, blank, zero, or negative value for either setting
  falls back to its default rather than becoming an unbounded wait (`NaN`) or
  a flood of reads (`0`). A later change switches the default to `enforce`
  once `report` mode has been observed.
- **`off`.** Skips the check entirely — no read of migration history at all.
  **Emergency override**: set `DEPLOY_MIGRATION_GATE=off` on the affected
  Railway service if the gate itself is misbehaving and blocking a deploy that
  needs to go out.

The gate needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (both
already set as Railway service variables) to read migration history; in
`report` mode a missing variable only logs a warning, in `enforce` mode it
fails closed. The whole check runs inside a fail-safe wrapper: a missing or
corrupt manifest, a malformed URL, or any other unexpected error exits 0
unless the mode is exactly `enforce` — a bug in this script itself must not be
able to block a deploy in `report` mode. It never logs the service-role key or
a full URL — only the project host.

Known gaps, by design:

- **A staging or other non-production database without the RPC (or with a
  different service-role key) will block `enforce` mode**, since the read
  itself fails there. Set `DEPLOY_MIGRATION_GATE=off` on that Railway
  environment, or confirm the target database has applied
  `20260820120000_migration_history_versions_rpc.sql`, before switching that
  environment to `enforce`.
- **A migration-only merge (no `src/`/`worker/` change) triggers no app or
  worker deploy at all**, so this gate never runs for it. It only ever checks
  migrations expected by the code that is _actually being deployed_ — it is
  not a general "are migrations applied" monitor. That job stays with the
  post-merge `live-drift` workflow (see "Supabase project safety" in
  `AGENTS.md`).
- **The gate trusts migration-history rows, not applied schema.** It reads
  `supabase_migrations.schema_migrations` the same way
  `check-migration-history-alignment.ts` does, so a version recorded there
  without its statements ever executing (the `#Q5JHBJ` shape — a mark-applied
  repair, or a partially-failed apply) reads as present. `check:drift`, not
  this gate, is what verifies the live schema itself.

---

## 1. Build — CI is the build contract

The worker image build is validated in CI by
[`.github/workflows/docker-image.yml`](../.github/workflows/docker-image.yml)
→ the **`build-and-verify`** job. It runs `docker build -f Dockerfile.worker`
(`load: true`, `push: false`) on:

- every push to `main` / `release/**`,
- pull requests and merge-queue commits whose CI change classifier detects a
  container-affecting file (`Dockerfile.worker`, all `worker/python/**`,
  any other `worker/**` source, `scripts/build-worker.mjs`, dependencies, build
  guards, or container config),
- the weekly schedule (Sun 18:00 UTC), and
- manual `workflow_dispatch`.

Nothing is pushed to a registry — the job proves the image **builds cleanly
from the tree**; registry publication and deploy are host-specific steps after
the standard gates. On an applicable PR or merge-queue commit, both image jobs
are called from CI and their result is folded into the required `pr-required`
aggregate.

Status: ✅ **CI covers the worker image build.** All build inputs referenced by
`Dockerfile.worker` are present in the tree (`package-lock.json`, `.npmrc`,
`scripts/check-node-engine.cjs`, `scripts/build-worker.mjs`,
`worker/python/requirements.txt`, `worker/index.ts`) and the `server-only`
bundle path is guarded by `tests/tsx-server-only-runner.test.ts`,
`tests/worker-runtime-control.test.ts`, `tests/worker-run-loop.test.ts`,
`tests/worker-runtime-validation.test.ts` plus
`tests/worker-bundle.test.ts` (resolve-checks every bundle external against
plain-`node` ESM resolution and the `--omit=dev` prune). The image also compiles
all committed Python helpers and runs `worker/python/test_*.py` before removing
test files from the runtime layer, so Python-only defects cannot bypass CI.

Local build for parity (optional; needs Docker with a few GB free — unlike the
app image it does **not** need the 8 GiB build heap):

```bash
docker build -f Dockerfile.worker -t clinical-kb-worker .
```

### What ships in the image

- **Node 24** (`node:24-bookworm-slim`) + **production-only** `node_modules`
  (`npm ci --omit=dev`): the worker runs as a prebuilt esbuild bundle
  (`dist/worker/index.mjs`, built in a separate image stage by
  `scripts/build-worker.mjs`), so tsx and the rest of the dev toolchain never
  reach the image.
- **Tesseract OCR** (Debian package; bundles English language data).
- A **Python venv** at `/opt/ocr-venv` with a pinned, hashed
  `worker/python/requirements.txt` generated from `worker/python/requirements.in`
  via `pip-tools` (`npm run generate:worker-python-lock`). `pip check` runs
  before the image is promoted. The venv is first on `PATH`, so the default
  `PYTHON_BIN=python` resolves to it — no override needed in-container.
- Runtime is the non-root `node` user. No secret is baked into any layer.
- `STOPSIGNAL SIGTERM` is set; the worker drains the active batch and exits `0`
  on `SIGTERM`/`SIGINT`. Fatal errors still exit `1` and fire the webhook.
- `dist/worker/validate-runtime.mjs` runs during the image build and again in
  CI with `--network=none` to prove Node, module resolution, Python, Tesseract,
  PyMuPDF, Pillow and pytesseract are present without calling Supabase/OpenAI.
- `CMD` runs the bundle under plain `node`. The build aliases `server-only`
  to the standalone stub (what `scripts/run-tsx.mjs` did at runtime), so
  `worker/index.ts`'s `import "server-only"` resolves outside the Next
  bundler. **Do not** change this to bare `tsx`/`node` on the TypeScript
  sources — the worker would crash-loop on boot. Bundle externals must stay
  resolvable under plain-`node` ESM semantics with production-only deps;
  `tests/worker-bundle.test.ts` enforces both.
- The default command is the **always-on long-poll loop** (no `--once`): probe
  Supabase health → claim jobs → process → poll every `WORKER_POLL_MS` when
  idle. `--once` is a drain-and-exit mode for local/one-shot use, not for the
  always-on instance.

---

## 2. Run recipe — one always-on instance

Run **exactly one always-on worker** on Railway in Singapore
(`asia-southeast1-eqsg3a` in `railway.worker.json`) — the closest available
Railway region to the Supabase project in Sydney (ap-southeast-2). Scale the
single instance first (`WORKER_BATCH_SIZE` / `WORKER_CONCURRENCY`); add
replicas only for sustained backlog. Job duration is not capped by
`WORKER_STALE_AFTER_MINUTES` (45 min): a live worker refreshes `locked_at` on
every persisted progress write and on a timer during extraction
(`updateJobProgress` in `worker/main.ts`, guarded by `locked_by = workerId`), so
only a job whose worker has stopped heartbeating for the whole stale window —
crashed, OOM-killed, or network-lost — is reclaimed by another worker, and the
completion/failure RPCs refuse a caller that no longer holds the lease. See
`deployment-architecture.md` §3 for the queue-durability reasoning.

```bash
docker run \
  --name clinical-kb-worker \
  --restart unless-stopped \
  --env-file worker.env \
  clinical-kb-worker
```

Host requirements for the always-on instance:

- **Restart policy `always` / `unless-stopped`.** The worker exits non-zero on
  a fatal bootstrap error; the host must bring it back.
- **No scale-to-zero.** The worker _is_ the queue drain — if it scales to zero,
  `jobs_pending` never settles. Keep min instances = 1.
- Railway uses the worker's `/health` endpoint on `PORT` for deployment readiness.
  Queue progress is checked separately through `reindex:health` (step 3).

### Secrets and env (`worker.env`)

Inject at run time from the host's secret store. **Never** bake these into the
image or commit them. Each environment (production / staging / CI) uses
**separate** service-role and OpenAI keys.

The worker's required set is **narrower than the app's** — it does **not** need
the client publishable key (build-time, app bundle only) or
`RAG_QUERY_HASH_SECRET` (app instrumentation only).

**Required — the worker fails closed without these:**

| Variable                    | Sensitivity  | Notes                                                  |
| --------------------------- | ------------ | ------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`  | public       | `https://sjrfecxgysukkwxsowpy.supabase.co`             |
| `SUPABASE_SERVICE_ROLE_KEY` | **critical** | admin client; RLS is service-role-only                 |
| `OPENAI_API_KEY`            | **critical** | embeddings + image captioning; probed at startup       |
| `SUPABASE_PROJECT_REF`      | low          | pins `check:supabase-project` (`sjrfecxgysukkwxsowpy`) |
| `SUPABASE_PROJECT_NAME`     | low          | `PsychSift Production`                                 |

**Defaulted — override only to tune; safe values ship in `src/lib/env.ts`:**

- Buckets: `SUPABASE_DOCUMENT_BUCKET=clinical-documents`,
  `SUPABASE_IMAGE_BUCKET=clinical-images`.
- Models/dimensions: `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`,
  `EMBEDDING_DIMENSIONS=1536` (must match `vector(N)` in
  `supabase/schema.sql` — a mismatch is caught by the startup dimension probe),
  `OPENAI_VISION_MODEL=gpt-5.6-terra` and
  `OPENAI_INDEXING_MODEL=gpt-5.6-terra`.
- `RAG_PROVIDER_MODE=auto` (OpenAI with graceful source-only fallback).
- Worker knobs (all defaulted): `WORKER_POLL_MS=30000`,
  `WORKER_BATCH_SIZE=3`, `WORKER_CONCURRENCY=1`, `WORKER_MAX_ATTEMPTS=3`,
  `WORKER_STALE_AFTER_MINUTES=45`, `WORKER_VISION_CONCURRENCY=4`, and the
  captioning budgets. See `.env.example` (lines under `WORKER_*`) for the full
  annotated list.
- `PYTHON_BIN=python` — do not set a Windows `TESSERACT_CMD` path; the container
  resolves both from the venv/PATH.
- Automated pre-deploy migration gate (see §0.1): `DEPLOY_MIGRATION_GATE=enforce` (blocks deploy if migrations are pending; default `report` logs status without blocking; emergency bypass `off`; poll settings: `DEPLOY_MIGRATION_GATE_POLL_S=20`, `DEPLOY_MIGRATION_GATE_MAX_WAIT_S=600`).

### Shadow extraction mode (packet B4 — docling, default OFF)

`WORKER_DOCUMENT_EXTRACTOR_MODE`, `WORKER_SHADOW_EXTRACTION_COHORT_PERCENT` and
`WORKER_DOCLING_PYTHON_BIN` are documented in full in [§3](#3-docling-shadow-extraction-packet-b4--default-off):
preconditions, safe values, the cost cap, what to watch, and the two-step rollback. The
shipped default is `legacy` and nothing in this run recipe enables it.

---

## 3. Docling shadow extraction (packet B4 — default OFF)

Shadow extraction runs the **docling** parser a second time over a small cohort of PDFs that
have _already been indexed by the legacy extractor_, and records numbers comparing the two.
It is a measurement facility. It does not change how any document is indexed, retrieved, or
answered.

Authorised by the Gate B PASS of 2026-08-18
([`rag-improvement/gate-b-decision-record-2026-08-18.md`](rag-improvement/gate-b-decision-record-2026-08-18.md));
design in [`rag-improvement/README.md`](rag-improvement/README.md) §B4; implementation in
`worker/shadow-extraction.ts` + `worker/python/shadow_docling_extract.py` (PR #2170, squash
`5437c309f`), pinned by `tests/worker-shadow-extraction.test.ts`.

This section is the **Gate F** artifact for B4 (README §Gates A–F: _flag, one-step rollback,
runbook, cost cap, redacted telemetry_). Enabling shadow mode is an operator action on the
Railway `worker` service — nothing in the repository turns it on, and the shipped default is
`legacy`.

### 3.1 What it does, and what it never writes

Per ingestion job, in `worker/main.ts` → `processJob`:

1. The legacy extractor runs and the index generation is **committed**
   (`commit_document_index_generation`). The live index is complete at this point and does
   not depend on anything below.
2. Only if `WORKER_DOCUMENT_EXTRACTOR_MODE=shadow`, the cohort predicate runs. A document is
   selected when **all three** hold: it is a PDF; its index-quality assessment carries at
   least one of the `tables` / `ocr` / `layout` signals; and its deterministic bucket
   (`sha256("docling-shadow-v1:<document id>")`, first 32 bits mod 100) is below the
   configured percentage.
3. Docling parses the same file in a separate process from `/opt/docling-venv`, bounded by
   the caps in §3.4.
4. One aggregate record is merged into `documents.metadata.shadow_extraction` on the
   existing worker-owned metadata write — no new write site.

**What it never writes.** No chunk, embedding, index unit, table fact,
`document_index_quality` row, page row, or image is written by the shadow path, and no
existing artifact is modified. It adds **no writer and no state transition** to the ingestion
state machine ([`ingestion-state-machine.md`](ingestion-state-machine.md) §2, W1). Search,
retrieval, and ranking never read the record. `runShadowExtraction` cannot throw: any
internal failure, spawn failure, or timeout becomes a recorded outcome or a skipped run,
never a failed job.

**Redacted by construction.** The record holds numbers, `null`, and a fixed vocabulary of
short strings (outcome, docling version, an exception class name). The Python runner never
emits extracted text, table cells, or file names; the Node side validates the payload against
a numbers-only schema that **strips unknown keys**, so extracted content cannot reach
`documents.metadata` even if the runner changed. Subprocess stdout is discarded; only a
bounded stderr tail reaches a warning log, through `safeErrorLogDetails`.

**Retrieval is not delayed; the queue is.** `commit_document_index_generation` sets
`documents.status = 'indexed'` as part of the commit in step 1, before the shadow window
opens, so a cohort document is retrievable throughout it — there is no user-facing search
delay to look for. What is delayed is the **ingestion job**: it stays `processing` for the
duration of the docling run (up to 120 s) before the final metadata merge and
`complete_ingestion_job`. So the effect is on queue drain rate and on `jobs_processing` /
`jobs_pending`, which is why §3.6 watches those and not answer latency.

### 3.2 Preconditions before enabling

1. **The running image must be built from `main` at or after PR #2170 (`5437c309f`).** That
   build adds the second venv `/opt/docling-venv` (from the Gate B lab's hashed lock: docling
   at the version pinned in `eval/docling/requirements.txt`, CPU-only torch), bakes docling's
   models into `/opt/docling-models`, and sets `WORKER_DOCLING_PYTHON_BIN`,
   `DOCLING_ARTIFACTS_PATH`, `TORCHDYNAMO_DISABLE=1` and `HF_HUB_OFFLINE=1`. On an older image that variable is unset and **every** cohort
   document records `runtime_unavailable` while legacy indexing continues normally.
2. **Memory headroom of roughly 1.5 GiB above the worker's current peak — measured 2026-08-21
   and comfortably satisfied.** Gate B measured docling peak RSS **1,504,313,344 B (~1.40 GiB)**
   against the lab's 6 GiB cap. Docling runs as a _separate_ process while the Node worker still
   holds the PDF buffer, so what matters is headroom above today's peak, not a total figure.

   Read from the Railway `worker` service (production), 7-day window, 10,081 samples:

   | Measure              | Value                |
   | -------------------- | -------------------- |
   | Memory limit         | **24 GB**            |
   | Memory peak (7 days) | **0.566 GB**         |
   | Memory average       | 0.139 GB             |
   | Headroom above peak  | **~23.4 GB**         |
   | vCPU limit           | 24 (peak usage 0.40) |

   That is roughly fifteen times the ~1.5 GiB the docling process needs, so the 2026-08-21
   measurement is a baseline, not a standing waiver. **Re-check memory headroom across a busy
   ingest window immediately before every shadow enablement, and again after any worker image,
   workload, `WORKER_CONCURRENCY`, service plan, or resource-limit change.** It is the precondition
   that matters most, because a container OOM kill during the docling window is the one failure
   the fail-open code cannot catch: the index is already committed, but the job would sit
   `processing` until the 45-minute stale reclaim (`WORKER_STALE_AFTER_MINUTES`) and burn an
   attempt. **How to re-check:** Railway → project `PsychSift` → `worker` service → **Metrics**,
   memory across a busy ingest window.

   One caveat on the cost model in §3.4: Gate B measured 9–19 s/doc on **2 CPUs**, and this
   service reports a 24 vCPU limit. Do not assume the wall-clock will scale down proportionally
   — docling runs eager (`TORCHDYNAMO_DISABLE=1`) and single-process, so extra cores may buy
   little. Treat §3.4 as unchanged until real `wall_ms` values say otherwise.

3. **Confirm `WORKER_CONCURRENCY` is 1** (the shipped default). At most one docling process
   runs per worker regardless of concurrency; with concurrency above 1 the extra cohort hits
   record `skipped_concurrent` instead of measuring anything.
4. **Have a way to read `documents.metadata`.** There is no npm script that reads, exports, or
   clears these records. The read is a Supabase SQL-editor or dashboard action against the
   live project, and is provider access requiring explicit approval each time.
5. **Expect ingestion traffic.** Records are written only when a document is indexed or
   reindexed; shadow mode never backfills. A quiet queue produces zero records, and that is
   not a fault.

### 3.3 The variables and their safe values

| Variable                                  | Safe value                                                | Contract (`src/lib/env.ts`)                                                                                |
| ----------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `WORKER_DOCUMENT_EXTRACTOR_MODE`          | `legacy` (shipped default) → `shadow` to enable           | enum `legacy` \| `shadow`; parsed **once at process start**, so a change needs a restart                   |
| `WORKER_SHADOW_EXTRACTION_COHORT_PERCENT` | `2`                                                       | integer, **min 1 / max 5**; a value outside that window fails env validation and the worker will not start |
| `WORKER_DOCLING_PYTHON_BIN`               | leave as the image default `/opt/docling-venv/bin/python` | set by `Dockerfile.worker`; unset ⇒ shadow records `runtime_unavailable` without spawning anything         |

**Why 2 is the approved starting value.** It is the owner-approved default recorded in
`src/lib/env.ts` and `.env.example`, and the bottom of the 1–5 % window README §B4
authorises. Two properties make it the right place to start rather than a compromise:

- The cohort is **deterministic and salted** (`docling-shadow-v1`), and the predicate is
  `bucket < percent`. Raising 2 → 3 → 5 later is therefore additive rather than disruptive:
  it never re-rolls the cohort, and every measurement already taken stays valid and stays in
  the cohort. Starting low does not throw away work.
  **But it is not free.** Shadow mode never backfills (§3.2, precondition 5), so documents in
  the newly included buckets are measured only when they are next ingested or **reindexed**.
  Widening the sample across the existing corpus therefore costs a reindex of those
  documents, and until one runs the larger cohort exists on paper but not in the data. Decide
  deliberately: start at 2 for the safety of a small blast radius, and treat a later increase
  as a reindex decision, not a variable edit.
- The selection is even: at `percent = 2` the bucket predicate picks 1.5–2.5 % of document
  ids across a 20,000-id sample (pinned by `tests/worker-shadow-extraction.test.ts`).

**What 5 would cost** is the table below — roughly 2.5× the cohort, the added worker time,
and the memory exposure, for the same per-document bounds.

### 3.4 Cost and throughput cap

Measured inputs, from the Gate B decision record (2026-08-18):

- docling **~9–19 s/doc on 2 CPUs**, against legacy's **~1 s/doc**;
- highest recorded P95 wall time **12,558 ms**; max peak RSS **1,504,313,344 B**.

Hard bounds in `worker/shadow-extraction.ts` — these constants **are** the cost cap:

- **120,000 ms** per document, after which the process tree is killed and the run is recorded
  as `timeout`;
- **40 pages** — a longer document is recorded as `skipped_page_cap` and never run;
- **one docling process per worker** at a time.

Corpus size for the projections: **2851 documents** (measured 2026-08-19, recorded against
ledger `#1K6T35`).

|                                                | 2 % (approved start) | 5 % (top of the authorised window) |
| ---------------------------------------------- | -------------------- | ---------------------------------- |
| Cohort per full pass over the corpus           | ≤ ~57 documents      | ≤ ~142 documents                   |
| Added worker time at the Gate B 9–19 s band    | ~9–18 min            | ~21–45 min                         |
| Added worker time at the 120 s timeout ceiling | ≤ ~114 min           | ≤ ~284 min (~4.7 h)                |
| Added time per **non-cohort** document         | 0                    | 0                                  |
| Added time per **cohort** document             | ≤ 120 s              | ≤ 120 s                            |

Three qualifications, all of which matter:

- **Plan against the ceiling row, not the band.** The 9–19 s figures were measured on small
  lab fixtures; `worker/shadow-extraction.ts` says so in as many words, and that is why the
  40-page cap exists. Real guideline PDFs are longer, so treat 9–19 s as a floor rather than a
  forecast.
- **Both cohort counts are upper bounds.** The real cohort is the subset of bucket hits that
  are PDFs **and** carry a `tables` / `ocr` / `layout` signal, so it will be smaller.
- **This is added _extraction_ time only.** What proportion of a full reindex's wall clock it
  represents is not derivable from this repository — per-document embedding, OCR, and
  captioning times are not measured here.

Do not buy more measurements by raising the cohort above 5, or by lengthening
`SHADOW_EXTRACTION_TIMEOUT_MS` or `SHADOW_EXTRACTION_MAX_PAGES`. Those are code changes
outside the Gate B authorisation, and they are the cap this section exists to state.

### 3.5 Enabling

1. Work through every precondition in §3.2 first.
2. On the Railway `worker` service (project `PsychSift`, production environment) set:

   ```text
   WORKER_DOCUMENT_EXTRACTOR_MODE=shadow
   ```

   Leave `WORKER_SHADOW_EXTRACTION_COHORT_PERCENT` unset (it defaults to `2`) or set it to `2`
   explicitly. Leave `WORKER_DOCLING_PYTHON_BIN` alone — the image sets it.

3. **Deploy.** A variable change alone does not restart a running container on Railway, and
   the worker reads this mode once at process start — so the setting does nothing until a new
   deployment starts. Use Railway's apply/redeploy action. The same two-step rule applies to
   the rollback (§3.7).
4. Confirm the startup line in the worker logs:

   ```text
   Docling shadow extraction enabled (packet B4): cohort 2% of index-quality-selected PDFs after legacy commit; aggregate metadata only. Rollback: set WORKER_DOCUMENT_EXTRACTOR_MODE=legacy, then deploy.
   ```

   A following `Docling shadow prerequisite warning (shadow extraction will fail open): …`
   means the docling venv is missing or broken: legacy indexing is unaffected, but every
   cohort document will record `runtime_unavailable` until the image is rebuilt. That probe is
   bounded at 120 s, so a broken venv delays worker start by up to two minutes and never fails
   it.

### 3.6 What to watch in the first 24 hours

**Three places to look.**

1. **Worker logs.** The startup line above; a
   `Shadow extraction outcome=… exit_code=… wall_ms=…` warning for every non-`ok` run; and
   the job progress stage `indexed; shadow extraction (docling)` at 98 %, which is the shadow
   window itself.
2. **Queue health** — `npm run reindex:health` (provider access; approve it explicitly).
   `jobs_pending` must keep draining exactly as it did before the change. This is the signal
   that matters most in the first hours.
3. **The aggregate record**, `documents.metadata->'shadow_extraction'`. Query and
   summarize using `npx tsx scripts/inspect-shadow-extraction.ts` (or read in the Supabase SQL
   editor with read-only provider access, approved each time):

   ```sql
   select
     d.metadata->'shadow_extraction'->>'outcome'                        as outcome,
     count(*)                                                           as documents,
     max((d.metadata->'shadow_extraction'->>'wall_ms')::numeric)        as max_wall_ms,
     max((d.metadata->'shadow_extraction'->>'peak_rss_bytes')::numeric) as max_peak_rss_bytes
   from public.documents d
   where d.metadata ? 'shadow_extraction'
     and (d.metadata->'shadow_extraction'->>'measured_at')::timestamptz > now() - interval '24 hours'
   group by 1
   order by documents desc;
   ```

**Expected volume.** Roughly one record per 50 signalled PDFs ingested; at most ~57 records if
a full reindex is run (§3.4). Zero records on a quiet queue is normal.

**What "healthy" looks like.**

| Field                             | Healthy                                                         | Investigate                                                                                      |
| --------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `outcome` = `ok`                  | the large majority of records                                   | —                                                                                                |
| `outcome` = `runtime_unavailable` | **0**                                                           | any → the running image has no working docling venv (§3.2 precondition 1)                        |
| `outcome` = `process_error`       | **0**                                                           | any → a crash outside the two clean exit codes                                                   |
| `outcome` = `skipped_concurrent`  | **0** at `WORKER_CONCURRENCY=1`                                 | any → two jobs raced the single docling slot; expected only if concurrency was raised            |
| `outcome` = `timeout`             | rare                                                            | sustained → real PDFs far exceed the Gate B profile and the §3.4 budget no longer holds          |
| `outcome` = `skipped_page_cap`    | some, routinely                                                 | not a fault — documents over 40 pages are recorded, never run                                    |
| `wall_ms`                         | seconds to low tens of seconds (Gate B highest P95 12,558 ms)   | a p95 approaching 120,000                                                                        |
| `peak_rss_bytes`                  | around **1.4 GiB** (Gate B max 1,504,313,344 B)                 | sustained above ~2 GiB → the headroom confirmed in §3.2 no longer covers it                      |
| `delta.page_count`                | **0**                                                           | non-zero → the two engines disagree on page count for the same file                              |
| `delta.text_character_ratio`      | near **1.0**                                                    | well below 1.0 → docling recovered materially less text than legacy on real documents            |
| `delta.numeric_token_ratio`       | near **1.0** (Gate B was exact parity, 162/162 assertions both) | a drop is precisely the measurement this packet exists to collect — record it, do not act on one |
| `delta.table_count`               | may be positive                                                 | **not** a promotion argument — see §3.8                                                          |

`wall_ms` and `peak_rss_bytes` are the two fields that decide whether the cost model in §3.4
survived contact with the real corpus. Read them first.

### 3.7 Rollback triggers and the two-step rollback

**Roll back immediately, diagnose afterwards, if any of these occur.**

1. The worker container OOM-kills or enters a restart loop after the change (§3.2 precondition
   2 — this is the failure the fail-open code cannot catch).
2. `jobs_pending` stops falling, or rises, across a normal ingest window.
3. Any ingestion job fails and shadow extraction is the only change. Shadow is fail-open by
   contract, so a job failure attributable to it means that contract is broken.

**Roll back at the next convenient moment** (legacy indexing is unaffected in all three):

4. Every cohort record shows `runtime_unavailable` — the image is wrong, and shadow mode is
   producing nothing while still costing a process spawn per cohort document.
5. Sustained `timeout` outcomes (**>10% timeout rollback threshold rule**): More than 10 % of
   cohort shadow runs timing out over the 24-hour evaluation window (or sustained over a batch).
   This operating rule is ratified and codified in `scripts/inspect-shadow-extraction.ts` to
   trigger a `ROLLBACK_RECOMMENDED` alert.
6. `peak_rss_bytes` sustained above the headroom confirmed in §3.2.

**The two-step rollback.** On the Railway `worker` service, set:

```text
WORKER_DOCUMENT_EXTRACTOR_MODE=legacy
```

Deleting the variable entirely is equivalent — the schema default is `legacy`.

**Time to take effect — and the trap in it.** Setting the variable is **not** by itself the
rollback. Railway's documentation is explicit: _"Containers read environment variables only at
startup, so a variable change never restarts a running container by itself; the new value only
exists inside the new deployment"_
([rotate-credentials-zero-downtime](https://docs.railway.com/guides/rotate-credentials-zero-downtime#how-variable-changes-apply-on-railway),
read 2026-08-21). The worker parses `WORKER_DOCUMENT_EXTRACTOR_MODE` once at process start and
matches that behaviour exactly.

So a rollback is **two** steps, and stopping after the first leaves docling still running:

1. Set `WORKER_DOCUMENT_EXTRACTOR_MODE=legacy` on the `worker` service.
2. **Deploy.** Use Railway's apply/redeploy action so a new deployment starts with the new value.

Once the new deployment starts, the outgoing container gets `STOPSIGNAL SIGTERM` and drains its
active batch before exiting 0 (§1), so the worst-case worker-side delay is the current batch plus
at most one 120-second docling window. No migration, no reindex, and no code or image change is
required.

Existing `shadow_extraction` records stay on their document rows as inert history. Nothing
reads them, and nothing in the repository clears them.

### 3.8 What this evidence may not be used for

**No promotion argument based on table quality may be made from shadow numbers until an
owner-dispatched `docling-lab-fixtures.v2` benchmark is recorded.** This is a binding caveat
carried by the Gate B PASS itself: the recorded v1 table-heavy leg passed at
_parity-on-ceiling_, not by a demonstrated gain, because that run's cleanly ruled tables put
**both** engines at cell F1 1.0. A corpus that cannot separate the two engines cannot support
a claim that one is better.

`delta.table_count` in the shadow record is a count of detected tables, not a quality measure,
and a positive delta says nothing about whether the extra tables are correct.

The v2 hardness corpus now lives at `eval/docling/fixtures/manifest.v2.json`: it covers
unruled tables, merged and spanning cells, and rotated headers, with numeric assertion
provenance bound to representative source tables. Those bindings govern fixture construction
only: numeric exactness remains document-wide, while structural association is measured by
table cell F1. This closes the fixture-construction task, not the evidence gate. Until a new
lab run is recorded against v2 with thresholds agreed beforehand, shadow numbers are
measurements and nothing more.

The second Gate B caveat is already load-bearing above: docling's eager-mode latency of
9–19 s/doc is why the cohort is bounded three ways in §3.4.

---

## 4. Verify

1. **Startup.** Logs show `PsychSift worker started. worker=<id>`. If a
   `PDF/OCR prerequisite warning` appears, the Python/Tesseract layer did not
   build correctly — rebuild the image (do not leave it running; OCR fallback
   will be silently unavailable).
2. **Queue drains.** With documents queued, watch the counts settle:

   ```bash
   npm run reindex:health   # jobs_pending → 0, jobs_processing → 0
   ```

   `jobs_pending` moving down (and reaching 0 once the backlog clears) confirms
   the single always-on instance is draining the queue. `documents_indexed`
   should climb correspondingly.

3. **Stuck queue?** If `jobs_processing` stays non-zero with no progress past
   the stale window, or jobs land in `jobs_failed`, use the operator recovery
   path (never raw SQL against live):

   ```bash
   npm run recover:ingestion            # dry run
   npm run recover:ingestion -- --apply # after reviewing
   ```

   This is fenced against retry/reindex overlap races. See
   [`reindex-runbook.md`](reindex-runbook.md) and
   `deployment-architecture.md` §3 (queue durability).

---

## 5. Troubleshooting & environment notes

- **Strict Node 24 web container engines (#334):** Package manifests enforce
  strict Node 24 (`>=24.15.0 <25`) and npm 11 engines. If a web container
  environment boots with Node 22 on `PATH`, `npm ci` fails `EBADENGINE` before
  work starts. Do not drop engine-strict; export `/opt/node24/bin` at the front of
  `PATH` to satisfy repository engine contracts before running `npm ci` or building
  the worker:

  ```bash
  export PATH="/opt/node24/bin:$PATH"
  node -v # must report v24.x
  ```

---

## Rollback

This section is the **image** rollback. To turn off docling shadow extraction without
changing the image, use the two-step flag rollback in §3.7 instead.

Redeploy the previous image tag. The worker holds no durable local state; all
artifact writes are idempotent per generation/chunk-key, and completion is
gated by the strict completion RPCs plus the edge agent, so a redeploy costs at
most one stale window of latency on any in-flight job and zero data loss.
