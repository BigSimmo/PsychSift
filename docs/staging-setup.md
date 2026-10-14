# Staging Environment Setup

Turnkey runbook for standing up a staging environment. Companion to
`docs/deployment-architecture.md` §5 (why staging is a dedicated project, not a
prod branch) and `docs/audit/capacity-review.md` §4 (the soak test that validates it).

Staging is two independent tiers: a **staging Supabase project** (data) and a
**staging app host** (compute). Do the data tier first — the app needs it.

> **Current data-tier state (read-only verification 2026-08-23):** the dedicated
> staging project `ikoiolksxqxfxgiyqpnu` and production each report 211 migration
> versions through `20260820120000`; ledger item `#056` is closed. This is a
> point-in-time provider fact, not permission to apply future migrations.
> **Compute-tier facts were last provider-verified 2026-07-30 (and 2026-09-21 service inventory):** the Railway staging
> `app` service existed, was healthy, used `RAG_PROVIDER_MODE=offline`, and had no OpenAI key, while `worker-5g6o` also exists in `staging` and carries `OPENAI_API_KEY` (operators must not point it at production or trigger unintended background work).
> Revalidate those facts and the deployed SHA before release evidence. Do not create
> a replacement environment merely because that dated verification needs renewal.

The identity guard is already staging-aware (`src/lib/supabase/project.ts`): it
accepts a second project **only** when you explicitly declare it via
`SUPABASE_STAGING_PROJECT_REF` + `SUPABASE_STAGING_PROJECT_NAME`, and it refuses
a staging ref that collides with the production or stale ref. So no code change
is needed to activate staging — just env. Production behavior is unchanged when
those vars are unset.

## A. Staging Supabase project (data tier)

1. **Create the project.** Same org (`BigSimmo's Org`), region
   **ap-southeast-2 (Sydney)** — a _separate project_, not a branch of
   production. Name it e.g. `PsychSift Staging`. (Can be done via the
   Supabase MCP `create_project` after a `confirm_cost` step — a new project is
   ~$10/month — or from the dashboard.) Record the new project ref
   (`<staging-ref>`) and generate a DB password.

2. **Apply the schema.** From a checkout linked to the staging project:

   ```bash
   supabase link --project-ref <staging-ref>
   supabase migration list --linked
   supabase db push --linked --include-all --dry-run
   ```

   Expect no pending versions on the verified baseline. If a reviewed migration is
   intentionally pending, apply it only through the normal linked-project procedure
   in an approved window, then repeat migration-history and drift checks. Stop on any
   unexpected entry. Never substitute raw SQL, repair timestamps, or an untracked helper.

   Then confirm health: `npm run check:indexing` (runs `search_schema_health()`
   over the hybrid RPCs) should report ok.

3. **Keep the tenancy profile synthetic and worker-free.** Do **not** copy
   clinical production documents into staging and do not start an ingestion
   worker. The cross-tenant harness creates the minimal private documents,
   lexical chunks, and storage objects it needs, then removes them in `finally`
   cleanup. This keeps the release proof deterministic and provider-free.

4. **Capture the keys** for the staging project (dashboard → API): the
   publishable key (`sb_publishable_…`) and the service-role secret
   (`sb_secret_…`).

## B. Staging app host (compute tier)

Host: **Railway**, same as production (see `docs/deployment-architecture.md` §2).
Stand staging up as a **second environment** in the active `PsychSift` Railway project,
with one `app` service pinned to **Southeast Asia
(`asia-southeast1-eqsg3a`, Singapore)** — the closest region to the staging
Supabase project in Sydney. Do not use a worker for the offline tenancy release profile (`worker-5g6o` exists in `staging` and carries `OPENAI_API_KEY`; warn operators not to point it at production or trigger unintended background work).
Reuse the app image; only the environment variables differ.

1. **Build the image** — Railway builds it remotely from the committed
   `Dockerfile` on deploy, so there is no local `docker build` and no local
   8 GiB-heap OOM. The two `NEXT_PUBLIC_*` build args inline into the client
   bundle; set them as **staging** service variables and Railway exposes them to
   the build via the Dockerfile `ARG`s:

   ```
   NEXT_PUBLIC_SUPABASE_URL             = https://<staging-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = <staging sb_publishable_…>
   ```

2. **Runtime secrets** (injected at deploy, never baked into the image) — all
   with **staging** values, distinct from production:

   | Var                                         | Value                      |
   | ------------------------------------------- | -------------------------- |
   | `SUPABASE_SERVICE_ROLE_KEY`                 | staging `sb_secret_…`      |
   | `SUPABASE_PROJECT_REF`                      | `<staging-ref>`            |
   | `SUPABASE_PROJECT_NAME`                     | `PsychSift Staging`        |
   | `SUPABASE_STAGING_PROJECT_REF`              | `<staging-ref>`            |
   | `SUPABASE_STAGING_PROJECT_NAME`             | `PsychSift Staging`        |
   | `NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_REF`  | `<staging-ref>`            |
   | `NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_NAME` | `PsychSift Staging`        |
   | `RAG_QUERY_HASH_SECRET`                     | unique staging-only secret |
   | `RAG_PROVIDER_MODE`                         | `offline`                  |

   Do not set `OPENAI_API_KEY`, `OPENAI_ORG_ID`, or `OPENAI_PROJECT_ID` in the
   staging `app` service. Offline mode uses lexical retrieval and deterministic,
   cited source-only answers; it performs no embedding or generation request.

   The two `SUPABASE_STAGING_PROJECT_*` vars are what make the identity guard
   accept the staging project. Setting `NEXT_PUBLIC_SUPABASE_URL` +
   `SUPABASE_PROJECT_REF` to the staging ref **without** them will (correctly)
   fail `check:supabase-project` — that's the deliberate speed bump.

3. **Service config:** the Dockerfile already binds `0.0.0.0:$PORT` (Railway
   injects `$PORT`). Set the app service's healthcheck to `/api/health/ready`
   (matches `railway.app.json`), restart policy to `ON_FAILURE`, and one
   replica pinned to `southeast-asia` with no scale-to-zero. Use `GET
/api/health` only as a manual liveness smoke check.

4. **Staging worker caution (`worker-5g6o`):** the offline tenancy release profile does not use an ingestion service — the tenancy harness inserts and removes its synthetic lexical rows directly through its dedicated staging credentials. However, `worker-5g6o` exists in the Railway `staging` environment and carries `OPENAI_API_KEY`; operators must not point it at production, copy the whole `staging` environment as an offline template, or trigger unintended background work.

## C. Validate staging

1. Boot check: `GET /api/health/ready` (Railway health) and `GET /api/health`
   (manual smoke) → healthy responses with the staging project.
2. Tenancy isolation: configure the dedicated A/B test accounts and standalone
   workflow described in
   [`staging-tenancy-release-evidence.md`](staging-tenancy-release-evidence.md).
   Dispatch that workflow from a Git ref that resolves to the candidate SHA —
   checkout SHA (`github.sha`) is compared to the deployed `/api/health` SHA
   before any client or fixture work. The harness requires an app deployment
   with `RAG_PROVIDER_MODE=offline` and is hard-guarded against the production
   project.
3. For the load profile only, redeploy the **same exact candidate image** with a
   staging-only OpenAI key and `RAG_PROVIDER_MODE=auto`; verify `/api/health`
   still reports the candidate SHA. Then run the authenticated soak:

   ```bash
   SOAK_BEARER_TOKEN="$STAGING_ACCESS_TOKEN" npx tsx scripts/soak-test.ts --target https://<staging-host> \
     --confirm-staging --users 30 --duration-s 600 --ramp-s 120
   ```

   Success targets are in `docs/audit/capacity-review.md` §4 (search p95 ≤ 3 s,
   answer p95 ≤ 25 s, non-429 error rate < 1 %, 429 rate ≤ 5 %, zero auth failures).
   Afterwards restore the offline tenancy profile if the nightly workflow shares this service.

## What is operator-only (cannot be scripted here)

- Creating the Supabase project (billable) and its DB password.
- Setting the staging runtime secrets in the Railway environment (service
  variables). Writing admin credentials to Railway is an operator/authorized
  action.
- Any change to the **production** project's settings (e.g. auth
  percentage-based connection allocation — see `docs/audit/capacity-review.md` §3).
