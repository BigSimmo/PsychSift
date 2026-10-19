# Operator rehearsal plan (one day)

_Drafted 2026-10-18. Not yet approved or run._

This is a one-day plan for four operator rehearsals that no coding session can do on its own. Every
step touches a live provider (Supabase, Railway, GitHub Actions and, in one optional part, OpenAI), so
**nothing here runs until the owner approves the day and each paused step**, per the provider
confirmation boundary in `AGENTS.md`.

It closes, or moves forward, these ledger rows in [`outstanding-issues.md`](outstanding-issues.md):

- `#QVVS6W`: the data layer of disaster recovery has never been restored.
- `#057`: the staging soak and rollback rehearsal against one exact candidate.
- `#F9HZEG`: CME and On Call isolation is unproven until staging runs the current harness.
- The stray staging worker `worker-5g6o`, which holds `OPENAI_API_KEY`
  ([`deployment-architecture.md`](deployment-architecture.md) section 5).

## Owner approval

| Item                                                                | Owner answer |
| ------------------------------------------------------------------- | ------------ |
| Date of the rehearsal day                                           |              |
| Approve a temporary Supabase restore project (deleted the same day) |              |
| Approve deleting `worker-5g6o` from Railway `staging`               |              |
| Approve redeploying and rolling back the staging `app` service      |              |
| Approve the 30-user offline soak against staging                    |              |
| Approve the optional answer-model soak (uses OpenAI, about US$1-5)  |              |

A blank row means that step does not run.

## Ground rules for the whole day

- **Production is read from, never written to.** The only production actions are reading the backup
  list and downloading Storage files. Never restore in place, never `supabase db push` to production,
  and never point the soak at `psychiatry.tools`.
- **One linked project at a time.** Do Supabase CLI work in a dedicated worktree. Re-read
  `supabase/.temp/project-ref` immediately before every CLI command and run `supabase unlink`
  afterwards, as was done for the 2026-08-22 staging parity check (`#056`).
- **No patient data.** The corpus is clinical reference material, not patient records, but treat the
  downloaded copy as confidential. Keep it on an encrypted disk and delete it at the end of the day.
- **Record times on a wall clock.** Every step lists the evidence to keep. Put it in the places named
  under [Where the evidence goes](#where-the-evidence-goes), not in chat.
- Costs below are estimates written on 2026-10-18 from public pricing. Check the price the dashboard
  shows before confirming, and stop if it is materially higher.

## Suggested order

| Time  | Step                                                                  | Why this order                                           |
| ----- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| 08:30 | [1. Remove `worker-5g6o`](#1-remove-the-stray-staging-worker)         | Quick, and it removes a risk before the staging work.    |
| 09:00 | [2. Start the restore](#2-restore-production-into-a-new-project)      | The platform restore is the longest wait.                |
| 09:30 | [3. Staging candidate and soak](#3-30-user-load-test-against-staging) | Runs while the restore completes.                        |
| 12:00 | [4. Roll back one Railway deploy](#4-roll-back-one-railway-deploy)    | Uses the candidate deployed in step 3.                   |
| 13:00 | Step 2 continued: Storage copy and verification                       | Restore should be finished by now.                       |
| 16:00 | [Clean-up](#5-clean-up-and-close-out)                                 | Delete the restore project and local files the same day. |

## 1. Remove the stray staging worker

`worker-5g6o` sits in the Railway `staging` environment, carries `OPENAI_API_KEY`, and has no
service-specific config file. The offline tenancy profile does not use a staging worker, so nothing
should depend on it.

**Commands** (Railway CLI, logged in, project `PsychSift` linked):

```bash
# Confirm the target before anything else
railway status
# Variable names only, never values
railway variables --environment staging --service worker-5g6o --kv | cut -d= -f1
# Last activity: fetch the past 24 hours of logs (no streaming) and look for job claims
railway logs --environment staging --service worker-5g6o --since 24h > worker-5g6o-24h.log
grep -ci "claim" worker-5g6o-24h.log
```

Check `railway logs --help` first: if your CLI version has no `--since` option, use the dashboard's
log view for the service and filter it to the last 24 hours instead.

Before deleting, open the service's Variables tab in the Railway dashboard and note the last four
characters of its `OPENAI_API_KEY` value. On the OpenAI API keys page, find the key with the same
ending and decide what happens to it:

- If it is a staging-only key that nothing else uses, revoke it after the service is deleted.
- If it matches the production key, stop and tell the owner before deleting anything. Rotating the
  production key is a separate change with its own redeploy.

Then delete it in the Railway dashboard: project `PsychSift`, environment `staging`, service
`worker-5g6o`, Settings, Danger, Delete service. The dashboard is the recommended route because it
shows the project and environment names on the confirmation screen.

**Expected cost:** none. Deleting the service stops any idle compute charge it was accruing.

**Stop if:** `railway status` shows any project other than `PsychSift`; the environment is not
`staging`; the logs show the worker claiming jobs in the last 24 hours; or any other service's
variables reference `worker-5g6o`.

**Evidence to record:** date and time of deletion, the variable names it held (names only), the last
log timestamp, and whether the OpenAI key was revoked or matched production.

## 2. Restore production into a new project

The schema has been rehearsed many times; the data has never been restored (`#QVVS6W`). This step
restores the latest production backup into a **new** project, copies the Storage files across, and
times both. See [`disaster-recovery-runbook.md`](disaster-recovery-runbook.md) for what a database
restore does and does not bring back.

**2a. Start the database restore (timed).**

1. Start a stopwatch.
2. Supabase dashboard, project `PsychSift Production` (`sjrfecxgysukkwxsowpy`), Database, Backups.
   Note the plan setting (daily backups or point-in-time recovery) and the time of the newest backup.
3. Choose **Restore to a new project**. Name it `PsychSift DR Rehearsal YYYY-MM-DD`, region
   ap-southeast-2. Record the compute size and the hourly price the screen shows.
4. Record the time the restore was requested and the time the new project reports healthy.
5. **Straight away, before anything else**, disable every copied `pg_cron` job on the restore project.
   Supabase copies enabled cron jobs into a restored project and starts them as soon as the restore
   finishes, so `invoke_indexing_v3_agent` could otherwise call the production agent:
   ```sql
   -- Run on the restore project only. Check the project ref in the SQL editor header first.
   UPDATE cron.job SET active = false;
   SELECT jobname, active FROM cron.job ORDER BY jobname;  -- every row must show active = false
   ```
   Record how long the jobs were active (healthy time to this step) and check the production agent's
   logs for any call from the restore project in that window. If one arrived, record it and tell the
   owner. If Supabase offers a restore option that leaves cron jobs disabled, use it instead.

**2b. Copy Storage files (timed).** A database restore does not copy Storage objects. The Supabase CLI
Storage commands are marked experimental; check `supabase storage --help` on the CLI version you use.

```bash
# In a dedicated worktree. Re-read the linked ref before each command.
export DR_DIR="$HOME/psychsift-dr-$(date +%Y%m%d)"   # on an encrypted disk
mkdir -p "$DR_DIR"

supabase link --project-ref sjrfecxgysukkwxsowpy
cat supabase/.temp/project-ref                        # must print sjrfecxgysukkwxsowpy
supabase storage ls ss:///clinical-documents --experimental --linked | head
supabase storage cp -r ss:///clinical-documents "$DR_DIR/clinical-documents" --experimental --linked
supabase storage cp -r ss:///clinical-images "$DR_DIR/clinical-images" --experimental --linked
supabase storage cp -r ss:///cme-private-evidence "$DR_DIR/cme-private-evidence" --experimental --linked
supabase unlink

supabase link --project-ref <restore-ref>
cat supabase/.temp/project-ref                        # must print <restore-ref>
supabase storage cp -r "$DR_DIR/clinical-documents" ss:///clinical-documents --experimental --linked
supabase storage cp -r "$DR_DIR/clinical-images" ss:///clinical-images --experimental --linked
supabase storage cp -r "$DR_DIR/cme-private-evidence" ss:///cme-private-evidence --experimental --linked
supabase unlink
```

**2c. Verify the restored copy.** In the restore project's SQL editor (never production's):

```sql
SELECT (public.search_schema_health())->>'ok' AS schema_ok;
SELECT count(*) AS documents FROM public.documents;
SELECT count(*) AS chunks FROM public.document_chunks;
SELECT bucket_id, count(*) FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id;
-- Documents whose file did not arrive
SELECT count(*) AS missing_files
FROM public.documents d
WHERE d.storage_path IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'clinical-documents' AND o.name = d.storage_path
  );
-- CME evidence records whose file did not arrive (removed evidence has no file by design)
SELECT count(*) AS missing_cme_evidence_files
FROM public.cme_evidence e
WHERE e.removed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'cme-private-evidence' AND o.name = e.storage_path
  );
```

Run the same counts (not the two missing-file queries) read-only on production for comparison. Then follow the
"Post-restore environment recovery controls" checklist in the disaster-recovery runbook, but **keep
`invoke_indexing_v3_agent` inactive** on the restore project, so it never calls the production agent.

Optional, with separate approval: point a throwaway env file at the restore project and run
`npm run check:indexing` and `npm run eval:retrieval:quality` (must pass 36/36). The retrieval eval
sends about 36 embedding requests to OpenAI (well under US$0.10). If the project identity guard refuses
the unknown project ref, stop and record that; do not edit the guard to get past it.

**Expected cost:** the restore project's compute is charged by the hour at the size the restore
requires, which may match production's size. At the smallest size this is roughly US$0.01-0.02 an
hour; a larger size costs more. Record the price shown in 2a. Downloading Storage counts towards the
plan's egress allowance; record the total size. Deleting the project the same day caps the cost.

**Stop if:** the dashboard offers only an in-place restore; the restore target would be production;
`cat supabase/.temp/project-ref` ever shows an unexpected ref; the price shown is materially above the
estimate; or the restore has not finished after four hours (record that as the finding).

**Evidence to record:** backup plan setting and newest backup time; restore start, healthy and
finish times; Storage size and copy time; the count comparison; `missing_files` and `missing_cme_evidence_files` (both must be 0); anything that had to
be re-entered by hand; and the eval result if run.

## 3. 30-user load test against staging

The load driver already exists: `scripts/soak-test.ts` (see
[`audit/capacity-review.md`](audit/capacity-review.md) section 4). It refuses production hosts,
refuses redirects, and needs `--confirm-staging` plus a bearer token from the environment.

**3a. Put one exact candidate on staging.** Staging is not redeployed on pushes to `main` (`#057`), so
the nightly tenancy harness fails its identity check. Pick a candidate SHA on `main`, deploy it to the
staging `app` service in the offline tenancy profile (launch runbook section 4, step 2), and confirm:

```bash
curl -fsS https://<staging-host>/api/health | jq '{status, deploymentCommitSha}'
```

Then dispatch the tenancy workflow from that same SHA, so CME and On Call isolation (`#F9HZEG`) is
actually exercised. `main` keeps moving, so pin the candidate to an immutable tag and dispatch that tag
rather than `main`:

```bash
export CANDIDATE_SHA=<candidate-sha>
TAG="dr-rehearsal-$(date +%Y%m%d)-${CANDIDATE_SHA:0:12}"
git tag "$TAG" "$CANDIDATE_SHA" && git push origin "$TAG" && \
  gh workflow run staging-tenancy.yml --ref "$TAG"
# Pick the dispatched run for this tag, not simply the newest run (a scheduled run can be newer)
gh run list --workflow staging-tenancy.yml --event workflow_dispatch --branch "$TAG" \
  --json databaseId,headSha,status --limit 5
# Confirm headSha equals $CANDIDATE_SHA, then use that run's id below
gh run view <run-id> --log | grep -E "returned|PASS|FAIL" | head -40
```

A dispatched run fails loudly; only scheduled runs use `continue-on-error`. Download and keep the
`staging-tenancy-evidence-<run-id>` artifact.

**3b. Offline soak (recommended).** Staging runs with `RAG_PROVIDER_MODE=offline` and no OpenAI key,
so answers are source-only and there is no model cost.

```bash
# Token for a staging test user; read it without echo so it stays out of shell history
read -rs SOAK_BEARER_TOKEN && export SOAK_BEARER_TOKEN
npx tsx scripts/soak-test.ts \
  --target https://<staging-host> \
  --confirm-staging \
  --users 30 --duration-s 600 --ramp-s 120
```

**3c. Answer-model soak (optional, separate approval).** This is the load profile in launch runbook
section 4, step 3: add a staging-only `OPENAI_API_KEY`, set `RAG_PROVIDER_MODE=auto`, redeploy, confirm
the same SHA, and repeat 3b. With the default think time and 25% answer share, ten minutes is roughly
300 answer requests. Afterwards restore `RAG_PROVIDER_MODE=offline`, remove the key, and confirm the SHA.

**Expected cost:** 3a and 3b cost a few cents of Railway and staging Supabase usage. 3c adds roughly
US$1-5 of OpenAI spend on the staging key.

**Stop if:** the script refuses the target; any authentication failure appears during ramp-up; the
health SHA does not match the candidate; non-429 errors pass 1%; staging Supabase CPU stays above 90%;
or any request shows a production host.

**Evidence to record:** candidate SHA; tenancy run ID, outcome and evidence artifact; the soak
summary (search and answer p50, p90, p95, max; error and 429 counts); and whether 3c was run.

## 4. Roll back one Railway deploy

Rehearse on the staging `app` service, using the candidate from step 3. A production rollback is the
same action, but it is not needed to prove the procedure and is not part of this plan.

1. Note the candidate SHA from `/api/health` and the previous successful deployment in the Railway
   dashboard (project `PsychSift`, environment `staging`, service `app`, Deployments).
2. Start a stopwatch. On the previous deployment, choose **Rollback**. `railway redeploy` only
   repeats the latest deployment, so it is not a rollback.
3. Record the time until `/api/health` reports the previous SHA:

   ```bash
   curl -fsS https://<staging-host>/api/health | jq '{status, deploymentCommitSha}'
   ```

4. Roll forward again to the candidate the same way, and confirm the candidate SHA. If the nightly
   tenancy check shares this service, confirm it is back in the offline profile with no OpenAI key.

**Expected cost:** a few cents of Railway usage. No OpenAI or Supabase cost.

**Stop if:** the environment shown is not `staging`; the previous deployment needs a database
migration the staging database does not have; or `/api/health` stays unhealthy for more than ten
minutes (roll forward and record the failure).

**Evidence to record:** both SHAs, rollback time to healthy, roll-forward time to healthy, and any
errors in `railway logs --environment staging --service app` during the switch.

## 5. Clean up and close out

1. Delete the restore project in the Supabase dashboard (Settings, General, Delete project). Record
   the time; this ends its compute charge.
2. Delete the local Storage copy: `rm -rf "$DR_DIR"`.
3. Confirm with `supabase/.temp/project-ref` absent (or `supabase unlink`) that no worktree is still
   linked to production.
4. Confirm the staging `app` is on the candidate SHA in the offline profile.

## Where the evidence goes

- Restore times and findings: the "Standing cadence" and layer table in
  [`disaster-recovery-runbook.md`](disaster-recovery-runbook.md), replacing "not directly measurable".
- Soak results: section 4 of [`audit/capacity-review.md`](audit/capacity-review.md).
- Ledger: queue `npm run issues:update` (or `issues:done`) requests for `#QVVS6W`, `#057` and
  `#F9HZEG` with the evidence above. Do not edit `outstanding-issues.md` directly.
