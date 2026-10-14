# Launch operator runbook

**Single sequenced runbook for the operator-gated launch steps.** It ties together the detailed docs
(linked per step) into one ordered flow with exact commands and explicit approval gates. Nothing here
runs automatically — every **⏸ PAUSE** is a provider-touching action (Supabase / Railway / OpenAI /
GitHub) that needs your explicit go-ahead, per the AGENTS.md provider boundary.

**Current-state note (2026-07-14):** production app and worker deployment is already recorded as live.
Use this as a verification/release sequence, not evidence that staging, migrations, or first deployment
are still pending. Confirm current provider state before repeating any historical action.

Host note: production app + worker run on **Railway** (user directive 2026-07-12), not Fly. The image is
host-agnostic. Railway has no Sydney region (closest Singapore); data at rest stays in Supabase Sydney,
so this creates both a latency/SLO tradeoff and overseas processing that must be covered by the approved
privacy/processor record. Confirm answer-p95 in the staging soak (step 4).

Legend: **⏸ PAUSE** = provider action, needs your approval · **✅ verify** = check to run after.

---

## Order at a glance

```text
0. Pre-flight identity check
1. Confirm completed migrations; apply only any explicitly unresolved control [Supabase]
2. Run the full release gate before the next release                     [live keys]
3. Provision staging + seed, only if still absent                         [Supabase + Railway]
4. Staging soak + rollback rehearsal                                      [Railway]
5. Production deploy                                                       [Railway]
6. Post-deploy: worker, registry seed, auth conn cap, observability wiring
7. Environment post-restore recovery controls (#326)
8. Operational notes & diagnostics (#248, #305, #315)
9. Ledger queue derivation & credential discipline (#327, #042)
```

---

## 0. Pre-flight (read-only)

```bash
node -v                              # must report >= 24.15.0 < 25 (Node 24 engine floor)
npm -v                               # must report >= 11.0.0 < 12 (npm 11)
npm run check:runtime                # validates Node 24 and npm 11 engines
npm run check:supabase-project       # must report PsychSift Production / sjrfecxgysukkwxsowpy
npx supabase migration list --linked
npm run reindex:health               # note jobs_pending / jobs_processing (needed for step 1 R17)
```

## 1. Confirm migration state; apply only unresolved controls 🧑 Supabase

Merging `supabase/migrations/*.sql` to `main` triggers the Supabase GitHub integration auto-deploy (~34s) to production (`sjrfecxgysukkwxsowpy`); manual apply is only for recovery/reconciliation when auto-deploy fails (or for unlinked/staging targets).

The July-8 ingestion/tenancy batch and the retrieval drift-codification work are recorded as applied and
verified on 2026-07-13. Their detailed procedures remain for staging/disaster recovery; do **not** reapply
them merely because they appear below. First compare linked migration history and verify the remaining
PIA-4 retention migrations. **Do not redeploy the worker until `20260708130000` is confirmed live.**

| Group | Migration/control                                                                                        | Recorded status                                     | Operator action                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| a–f   | July-8 ingestion/tenancy batch in [operator-apply-july8-batch.md](archive/operator-apply-july8-batch.md) | **Verified live 2026-07-13**                        | Verify only; redeploy the worker if that recorded remaining action is still open.                          |
| g     | `20260708120000_rag_query_misses_retention`                                                              | **Applied and verified live 2026-07-14**            | Job 13 is active with the 90-day retention window.                                                         |
| h     | `20260713201542_consolidate_rag_response_cache_retention`                                                | **Applied and verified live 2026-07-14**            | Job 16 is active and bounded; obsolete duplicate job confirmed absent.                                     |
| i     | Retrieval RPC forward-codification (`20260713062107`…`20260713062139`)                                   | **Applied and drift/readiness verified 2026-07-13** | Verify only; see [forward-codify-retrieval-rpcs-workorder.md](forward-codify-retrieval-rpcs-workorder.md). |

**⏸ PAUSE:** if and only if linked history shows migration `20260708120000` or `20260713201542` absent after auto-deploy,
apply the reviewed committed migration through the guarded recovery/reconciliation workflow. Do not use this status
reconciliation as authority to replay the verified July-8 or forward-codification groups.

After applying, query `cron.job` and expect at least these active retention jobs: `purge-rag-query-misses`
at `45 3 * * *` and `purge-rag-response-cache` at `15 * * * *`. The obsolete
`purge-expired-rag-response-cache` name must be absent.

**✅ verify:**

```bash
SUPABASE_ENVIRONMENT=production npm run check:july8-live-batch
npm run check:drift
npm run check:indexing              # search_schema_health() ok
npm run eval:retrieval:quality      # must stay 36/36 (retrieval-affecting: step d + drift-codify)
```

### 1b. Drift-codify status (task 1.2) — complete

The reviewed forward-codify migrations were applied on 2026-07-13 after scratch replay and fingerprint
validation. `check:drift` passed and production readiness reported READY. The authoritative evidence and
historical replay procedure are in
[forward-codify-retrieval-rpcs-workorder.md](forward-codify-retrieval-rpcs-workorder.md). No further apply
is pending unless a new drift check identifies a new, separately reviewed difference.

## 2. Full release gate 🧑 live keys

Run before the next release when provider-backed verification is explicitly approved.

**⏸ PAUSE** (bounded OpenAI spend):

```bash
npm run verify:release              # full Playwright matrix + check:production-readiness
                                    # + governance:release + eval:quality:release
npm run eval:retrieval:quality      # 36/36
npm run eval:quality -- --rag-only  # grounded-supported must not drop; citation-failure 0
```

Record outcomes in release notes / [process-hardening.md](process-hardening.md).

## 3. Provision staging + seed 🧑 Supabase + Railway (billable)

Detailed: [staging-setup.md](staging-setup.md). No code change — the identity guard activates on env.

1. **⏸ PAUSE** create Supabase project `PsychSift Staging`, same org, **ap-southeast-2**, generate DB
   password (Supabase MCP `create_project` after `confirm_cost`, or dashboard). Record `<staging-ref>`.
2. `supabase link --project-ref <staging-ref>` → `supabase db push` → `npm run check:indexing`.
3. Seed synthetic (~50 docs, **never** production clinical docs):
   ```bash
   npm run samples && npm run import:docs
   npm run registry:seed -- --owner-id <owner> --write --confirm
   npm run differentials:seed && npm run medications:seed
   ```
4. Capture staging keys (`sb_publishable_…`, `sb_secret_…`).

## 4. Staging soak + rollback rehearsal 🧑 Railway

1. Name one candidate SHA and build one image from that exact checkout (real
   staging publishable key inlines into the client bundle). Tag it with the full SHA:
   ```bash
   docker build --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co \
     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging sb_publishable_…> \
     -t clinical-kb-app:<candidate-sha> .
   ```
   (Local Docker can OOM on the 8 GiB Next heap — prefer the CI image-build workflow if it wedges.)
2. **⏸ PAUSE** deploy that candidate image in the tenancy profile. Set staging-only
   secrets, but omit `OPENAI_API_KEY` and set `RAG_PROVIDER_MODE=offline`:
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF=<staging-ref>`,
   `SUPABASE_PROJECT_NAME=PsychSift Staging`, `SUPABASE_STAGING_PROJECT_REF=<staging-ref>`,
   `SUPABASE_STAGING_PROJECT_NAME=PsychSift Staging`, `RAG_QUERY_HASH_SECRET` (staging),
   `RAG_PROVIDER_MODE=offline`. Keep one warm instance. Confirm `GET /api/health`
   reports `deploymentCommitSha=<candidate-sha>`, then dispatch the SHA-bound
   tenancy workflow from a Git ref that resolves to that same `<candidate-sha>`
   (`CROSS_TENANT_CHECKOUT_COMMIT_SHA` is `${{ github.sha }}`) and retain its
   evidence artifact.
3. **⏸ PAUSE** transition the same candidate image to the load profile: add the
   staging-only `OPENAI_API_KEY`, set `RAG_PROVIDER_MODE=auto`, redeploy, and confirm
   `/api/health` still reports the identical full candidate SHA. Run the authenticated
   soak (hard-guarded against production and redirects):
   ```bash
   SOAK_BEARER_TOKEN="$STAGING_ACCESS_TOKEN" npx tsx scripts/soak-test.ts \
     --target https://<staging-host> --confirm-staging \
     --users 30 --duration-s 600 --ramp-s 120
   ```
   Targets ([capacity-review.md](audit/capacity-review.md) §4): search p95 ≤ 3 s, **answer p95 ≤ 25 s**
   (watch this given the Railway↔Sydney hop), non-429 error rate < 1 %, 429 rate ≤ 5 %,
   and zero auth failures.
4. Rehearse rollback by redeploying the previous image and recording its expected
   health SHA. If one shared staging service backs the nightly tenancy check, restore
   the same candidate image afterwards in `offline` mode, remove the OpenAI key, and
   verify the candidate SHA again. A separate offline tenancy deployment is preferred.

## 5. Production deploy 🧑 Railway

Decision record: [deployment-architecture.md](deployment-architecture.md) §2. Same image contract, prod
build-args + secrets.

**⏸ PAUSE:** authorize the Railway account/service, build with the **production** publishable key, set
runtime secrets (**incl. `RAG_QUERY_HASH_SECRET`** — PIA-2 fail-closed guard requires it at boot;
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `SUPABASE_PROJECT_REF/NAME` for prod). One warm instance,
no scale-to-zero, Railway health `/api/health/ready`. I'll prep the Railway service config via the `use-railway` skill.

**✅ verify:** `GET /api/health/ready` (and manual `GET /api/health` → `{"status":"ok"}`); `npm run check:deployment-readiness`.

## 6. Post-deploy

- **Worker** 🧑 — build `Dockerfile.worker`, run **one** always-on instance in the same region with prod
  secrets. **Only after migration `20260708130000` is live.** Confirms via `npm run reindex:health`.
  Full build/run/verify recipe + the required env and secrets:
  [worker-deploy-runbook.md](worker-deploy-runbook.md).
- **Registry seed (prod)** 🧑 — `npm run registry:seed -- --owner-id <prod-owner-uuid> --write --confirm`
  (+ `npm run differentials:seed` for the slug-retitle prune). Until seeded, Services/Forms show empty.
- **Auth connection cap** 🧑 — before the first vertical scale-up, switch Supabase auth from the 10-absolute
  cap to **percentage-based** allocation in the dashboard ([capacity-review.md](audit/capacity-review.md) §3).
  Not settable via SQL/MCP.
- **Observability wiring** 🧑 — once host metrics exist, wire the warn/page SLO thresholds
  ([observability-slos.md](observability-slos.md) §2) into a real alert channel; confirm the nightly eval
  canary is green from `main` (one `workflow_dispatch` run).

## 7. Environment post-restore recovery controls (#326)

Following a Supabase database restore or disaster recovery failover, verify all 5 environment-owned controls before admitting production traffic:

1. **API Secrets & Keys Parity:** Confirm `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `RAG_QUERY_HASH_SECRET` match the restored project environment.
2. **Webhook Endpoint & Signature Verification:** Confirm Railway webhook destinations and Supabase Database Webhook triggers are active and matching HMAC secrets.
3. **Authentication & Connection Limits:** Validate auth rate limits and connection pool percentage allocation in the Supabase Dashboard.
4. **Cron Job Schedule Registration:** Verify pg_cron extensions and scheduled maintenance jobs (cache retention, query log sweeps) are active.
5. **Storage Buckets, Files & Policies:** Include files from `clinical-documents`, `clinical-images`, and `cme-private-evidence` in the storage recovery inventory. `supabase/schema.sql` recreates all three bucket rows, but not their files; restore the files separately. Confirm all three private buckets have active RLS policies preventing unauthenticated public reads.

## 8. Operational notes & diagnostics (#248, #305, #315, #102, #6SMMB4, #9X40BT)

- **Search-Health Indexes (#248):** Ensure migration `20260705180000_reconcile_search_health_indexes.sql` is active on live and `search_schema_health()` reports `ok: true` with no `missing` entries (`npm run check:indexing`) — treat its `required_indexes` list as the recovery criterion, not a fixed count, since later migrations extend it.
- **Concurrent Document Index Recipe (#102):** When applying additive document index optimizations on a busy database (`documents_title_bare_trgm_idx`, `documents_file_name_bare_trgm_idx`, and `documents_status_id_idx`), pre-create indexes concurrently (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`) before applying the committed migration and registering in `search_schema_health()` to avoid write lock contention. Validate each index with `pg_index.indisvalid`. Note that bare-column trigrams and composite `(status, id)` indexes on the RAG path are canary-gated due to unordered `LIMIT 12` selection in candidate retrieval ([operator-apply-performance-latency-remediation.md](operator-apply-performance-latency-remediation.md)).
- **Canary Latency & Cost Boundaries (#305):** Retrieval latency p90 SLO is ≤ 20s. Canary cost metrics provide lower-bound estimates without cache warmup.
- **UI Smoke Reporter Stranding (#315):** When debugging rare UI smoke test timeouts, inspect reporter stranding in Playwright hooks rather than assuming layout regressions.
- **Dev Drive Trusted Package Cache (#6SMMB4):** On Windows workstations hosting worktrees on a Dev Drive (e.g. `D:`, ReFS), verify that the local npm package cache (`D:\.npm-cache`) is registered as a trusted Dev Drive cache. If unverified or not registered, Microsoft Defender real-time scanning runs over every `npm ci` across all worktrees. From an **elevated administrator prompt**, register and verify the trusted cache:
  ```powershell
  fsutil devdrv trust D:\.npm-cache
  fsutil devdrv query D:
  ```
  Non-elevated prompts return `Error 5: Access is denied`. For fallback or non-elevated registry diagnostics, probe `Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "DevDrive*" -ErrorAction SilentlyContinue` or verify `(Get-Volume -DriveLetter D).FileSystemType -eq 'ReFS'`. Confirming or trusting the cache on the volume exempts package extractions from Defender real-time scan overhead during multi-worktree operations.
- **Supabase Preview Branch Compute Cap Policy (#9X40BT):** Branching Compute is not covered by the organisation's Spend Cap in the Supabase Dashboard. Preview databases scale uncapped with open PRs touching `supabase/**`. In **Supabase Dashboard -> Project Settings -> Integrations -> GitHub**, set the Automatic Branching limit to **1** (or disabled) to prevent unconstrained compute charges. CI's Migration replay job (`db-reset-verify`, `supabase migration up --local`) independently replays and tests the full migration chain on every PR touching `supabase/**`, ensuring full verification safety even with preview branches capped at 1 or disabled.

## 9. Ledger queue derivation & credential discipline (#327, #042)

- **Ledger Outcome Derivation (#327):** Recommended queue tooling (`issues-surface.sh` and `issues-report.mjs`) dynamically derives row descriptions directly from the cited Detail cell, preventing unrendered dead text in canonical ledger tables.
- **Credential Fallback Hygiene (#042):** Optional credentials must never fall back silently into anonymous access when invalid or malformed tokens are supplied; authentication checks fail closed with explicit authorization errors.

---

## Standing guardrails

- **Anonymous provider spend is capped, not merely alerted (L42).** `SPEND_ALERT_DAILY_USD`
  only raises an alert. The enforced ceiling is in `src/lib/api-rate-limit.ts`, beside the
  per-caller rate-limit tables: **300 anonymous provider-backed generation requests per hour**,
  counted in one shared bucket across `answer`, `clinical_ask`, `speech_transcription` and
  anonymous document summaries, on top of the existing per-caller and per-bucket limits. Over
  the ceiling the API returns `429` with code `anonymous_generation_ceiling` (distinct from the
  ordinary `rate_limited`) and the message tells the caller to sign in. Authenticated callers
  are unaffected. Raising the number raises the maximum unauthenticated OpenAI bill, so treat
  it as a spend decision.
- Never raw-SQL against live — committed migration + `schema.sql` reconciliation only.
- Never redeploy a worker image that expects the hardened completion RPC until `20260708130000` is confirmed live.
- Any retrieval/ranking change re-runs `eval:retrieval:quality` 36/36 before it ships.
- Each environment gets separate service-role + OpenAI keys (per-env blast radius).
