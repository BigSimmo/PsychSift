# Launch operator runbook

**Single sequenced runbook for the operator-gated launch steps.** It ties together the detailed docs
(linked per step) into one ordered flow with exact commands and explicit approval gates. Nothing here
runs automatically — every **⏸ PAUSE** is a provider-touching action (Supabase / Railway / OpenAI /
GitHub) that needs your explicit go-ahead, per the AGENTS.md provider boundary.

**Current-state note (refreshed 2026-10-18 from the ledger):** production app and worker deployment has
been live since 2026-07-14, and staging exists. Still open: the staging soak and rollback rehearsal
(step 4, ledger `#057`), which is blocked in practice because staging is not redeployed on pushes to
`main`; CME and On Call staging isolation proof (`#F9HZEG`); a data-layer disaster-recovery restore
(`#QVVS6W`); and the six provider, legal and clinical approvals (`#BS3SN9`). The stray staging worker
`worker-5g6o` still holds `OPENAI_API_KEY`. [operator-rehearsal-plan.md](operator-rehearsal-plan.md)
plans steps 3 and 4 plus the restore as one approved day. Use this as a verification/release sequence,
and confirm current provider state before repeating any historical action.

Host note: production app + worker run on **Railway** (user directive 2026-07-12), not Fly. The image is
host-agnostic. Railway has no Sydney region (closest Singapore); data at rest stays in Supabase Sydney,
so this creates both a latency/SLO tradeoff and overseas processing that must be covered by the approved
privacy/processor record. Confirm answer-p95 in the staging soak (step 4).

Legend: **⏸ PAUSE** = provider action, needs your approval · **✅ verify** = acceptance evidence,
not permission to execute. Read-only provider access still needs confirmation. Before each billable
run, agree its exact target, workload/calls/runtime, total estimate, retries and enforceable hard cap
under the applicable owner spending rule and [provider boundary](../AGENTS.md#api-and-provider-confirmation-boundary).
The provider gate applies to every executable step below, including verification and diagnostics;
this runbook grants no migration, configuration, deployment or spending authority.

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

## 0. Pre-flight (local inspection, then approved provider reads)

```bash
node -v                              # must report >= 24.15.0 < 25 (Node 24 engine floor)
npm -v                               # must report >= 11.0.0 < 12 (npm 11)
npm run check:runtime                # validates Node 24 and npm 11 engines
```

The three commands above inspect the local toolchain only; they do not contact a provider.
The project-config checker below also reads local configuration only, but AGENTS.md explicitly
requires confirmation for it. Its output proves configured identity, not the identity or health of
a remote service. For a production release it must report `PsychSift Production` /
`sjrfecxgysukkwxsowpy` / `[production]`; staging must use step 3's separate identity.

**⏸ PAUSE — confirm target and selected reads before running:**

```bash
npm run check:supabase-project       # local config read; explicitly confirmation-required by project policy
npx supabase migration list --linked
npm run reindex:health               # note jobs_pending / jobs_processing (needed for step 1 R17)
```

| Command                            | Target / effect                                                       | Provider and spending relevance                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `check:supabase-project`           | Local application URL/ref/name declaration; no remote request         | Explicit project confirmation boundary; no API charge established by this checker                                        |
| `supabase migration list --linked` | Selected CLI-linked Supabase project; history read                    | Confirm linked ref first; provider read, not schema parity proof; assess service/downstream costs                        |
| `reindex:health`                   | Application-configured Supabase admin client; probes/counts/open jobs | Confirm app ref separately from CLI link; provider read; service usage, not a provider-free check or RPC signature proof |

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

**⏸ PAUSE / ✅ verify:** these commands read Supabase; retrieval quality also calls OpenAI.
Approve the exact run and its bounded downstream spend before executing:

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

## 3. Establish staging identity before application operations 🧑 Supabase + Railway

Detailed: [staging-setup.md](staging-setup.md). Its recorded environment observations are dated;
reuse an existing authorised staging target after revalidation rather than creating a replacement
merely because the evidence needs renewal. CLI linkage and application configuration are independent.

1. **⏸ PAUSE** confirm the existing staging project's exact ref/name and the operator's authority.
   Creating a project, applying schema or deploying compute is a separate billable mutation requiring
   its specific approved scope/cap. Follow the detailed staging schema procedure; do not run a blind
   `db push` from this checklist.
2. Before any application check, seed or import, prepare an isolated staging checkout/process with
   **no production environment files or inherited production credentials**. Obtain that project's
   publishable and service-role keys through the approved secret-management route; never print them.
   Set the application URL/ref/name and explicit staging declaration together. In a Bash operator
   shell, after `STAGING_REF` is set to the verified 20-character ref:
   ```bash
   export NEXT_PUBLIC_SUPABASE_URL="https://${STAGING_REF}.supabase.co"
   export SUPABASE_PROJECT_REF="$STAGING_REF"
   export SUPABASE_PROJECT_NAME='PsychSift Staging'
   export SUPABASE_STAGING_PROJECT_REF="$STAGING_REF"
   export SUPABASE_STAGING_PROJECT_NAME='PsychSift Staging'
   export RAG_PROVIDER_MODE=offline
   ```
   Configure only matching staging credentials, including a separate staging `RAG_QUERY_HASH_SECRET`;
   omit `OPENAI_API_KEY` and keep workers stopped for the offline tenancy profile. A declared staging
   ref must differ from production and stale refs. Production credentials are never a fallback.
3. **⏸ PAUSE / ✅ verify** run `npm run check:supabase-project` in that same process. Require a
   successful result with the **exact intended staging ref/name and `[staging]`**. A successful
   `[production]` result is a stop condition. The local checker does not verify key ownership:
   separately confirm key provenance in the approved provider session, then approve and run the
   staged target's `npm run check:indexing`. `supabase link --project-ref "$STAGING_REF"` controls only
   subsequent CLI operations, never these application clients.
4. The offline tenancy profile needs no bulk import or worker; its harness creates/removes its own
   minimal synthetic fixtures. Optional load/seed work is separately approved for the verified
   staging target, with staging owner UUID, corpus size and provider/worker consequences bounded.
   For that approved workload, these examples supply the actual CLI arguments (set
   `STAGING_OWNER_ID` to the authorised staging test user's UUID first):
   ```bash
   npm run samples
   npm run import:docs -- --path ./sample-documents --owner-id "$STAGING_OWNER_ID" --limit 50 --dry-run
   npm run registry:seed -- --owner-id "$STAGING_OWNER_ID"
   npm run differentials:seed -- --owner-id "$STAGING_OWNER_ID"
   npm run medications:seed -- --owner-id "$STAGING_OWNER_ID"
   ```
   Review the generated corpus and dry-run plans. Import without `--dry-run` writes Storage/documents
   and queues jobs; it has no separate `--write` flag. Each record seed needs both `--write --confirm`
   appended to its own command to write. Do so only within that specific approved staging workload;
   starting a worker can trigger embeddings/enrichment and needs its own bounded provider authority.

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

**⏸ PAUSE / ✅ verify (provider reads and possibly downstream checks):** `GET /api/health/ready`
(and manual `GET /api/health` → `{"status":"ok"}`); inspect `npm run check:deployment-readiness`
and approve its exact provider scope before running it.

## 6. Post-deploy

**⏸ PAUSE:** these are separate provider actions. Worker/seed commands write or consume queues;
dashboard edits mutate settings; workflow dispatch invokes hosted CI and may call providers.
Confirm each target/effect and any billable run's cap before execution. A previous deployment
approval does not automatically approve this list.

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

**⏸ PAUSE:** provider configuration reads and any repairs below retain their read/write approval
boundaries. Use the [disaster recovery identity procedure](disaster-recovery-runbook.md#application-identity-on-a-restored-target)
before application checks against a new project; do not change the production identity constant as a shortcut.

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
