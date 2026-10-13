# Webhooks

This repo ships two webhook integrations, both inbound receivers under
`src/app/api/webhooks/`. They share the same optional chat destinations.

| #   | Integration                          | Direction | Entry point                                   |
| --- | ------------------------------------ | --------- | --------------------------------------------- |
| 1   | Railway deploy → chat                | inbound   | `POST /api/webhooks/railway`                  |
| 2   | Supabase document change → ingestion | inbound   | `POST /api/webhooks/supabase/document-change` |

## Chat destinations (shared)

Set either, both, or neither. A receiver with no destination configured still
accepts the event and reports it as undelivered — but it no longer does so quietly.
`postChatNotification` logs any discarded warning- or error-severity notification at
`logger.error`, which the logger forwards to Sentry Logs, so a dropped deploy failure
is visible without depending on the variable that is missing. `npm run check:production-readiness`
warns about the same gap before an incident rather than during one. Both exist because
the prose warning below was already written on 2026-09-11, when 24 production deploys
then failed and rolled back over three days with every alert discarded on this path.

- `SLACK_WEBHOOK_URL` — a Slack incoming webhook (`{ "text": … }`).
- `DISCORD_WEBHOOK_URL` — a Discord webhook (`{ "content": … }`).

The inbound receivers read them from server env (`src/lib/env.ts`).

Store every secret below in Railway/GitHub secret stores — never in the repo.

## 1. Railway deploy → chat

`POST /api/webhooks/railway` forwards notable Railway deploy status changes
(`SUCCESS`, `FAILED`, `CRASHED`, `REMOVED`) for the app + worker services to chat.
This reports the deploy outcome GitHub cannot see.

**Auth.** Railway lets you configure only a target URL (no custom headers or
signing), so the shared secret `RAILWAY_WEBHOOK_SECRET` (min 16 chars) travels as
a `?token=` query parameter and is compared constant-time. The receiver fails
closed (`503`) when the secret is unset and returns `401` on a bad token.

**Setup.** Railway → Project → Settings → Webhooks → add:

```
https://psychiatry.tools/api/webhooks/railway?token=<RAILWAY_WEBHOOK_SECRET>
```

Transient phases (`BUILDING`, `DEPLOYING`, `QUEUED`, …) are dropped to keep the
channel quiet; the receiver answers `200 { "skipped": true }` for them.

**Reading a failure.** The two ways this integration dies look nothing alike, and
telling them apart is the whole job:

| Symptom                                | Cause                                                               | Fix                                               |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| `401` on `POST /api/webhooks/railway`  | the `?token=` in the Railway webhook URL ≠ `RAILWAY_WEBHOOK_SECRET` | re-add the webhook URL with the current secret    |
| `503 webhook_not_configured`           | `RAILWAY_WEBHOOK_SECRET` unset on the service                       | set it                                            |
| `200 { "forwarded": false }`           | authenticated, but no chat destination in server env                | set `SLACK_WEBHOOK_URL` or `DISCORD_WEBHOOK_URL`  |
| no request reaches the receiver at all | no outgoing webhook configured on the Railway project               | add it in Railway → Project → Settings → Webhooks |

**Owner action, open since 2026-09-16 (#B6JP6F).** The integration is in row 1 right now: the
production `PsychSift` service logs `Railway webhook rejected: presented secret did not match
RAILWAY_WEBHOOK_SECRET` with `tokenPresented=true` on every deploy (six rejections in the 40 s after
the 2026-09-16 12:27 UTC container start). **There is nothing to fix in this repository.** The
receiver in `src/app/api/webhooks/railway/route.ts` is correct and is behaving correctly by
rejecting the request; the `?token=` on the configured Railway webhook URL has simply drifted out of
step with the `RAILWAY_WEBHOOK_SECRET` service variable. No MCP tool covers Railway project
webhooks, and the fix needs the secret value, so it cannot be done from a coding session at all —
it is the owner, in the Railway dashboard:

1. Railway → project `PsychSift` → the `PsychSift` service → Variables: set `RAILWAY_WEBHOOK_SECRET`
   to a fresh value of at least 16 characters.
2. Railway → project `PsychSift` → Settings → Webhooks: delete the existing webhook and re-add it as
   `https://psychiatry.tools/api/webhooks/railway?token=<that same value>`.
3. Confirm on the next deploy that the rejection warning stops. Until it does, **no deploy success
   or failure notification reaches chat at all** — the same silence that cost three days on
   2026-09-13.

**Code regression, 2026-10-06 to 2026-10-13.** A hardening commit (`9a8d291ac`) switched the
receiver to header-only authentication, which rejected every Railway delivery regardless of the
secret, because Railway cannot send headers. The `?token=` query parameter is accepted again and is
pinned by `tests/webhooks-railway-route.test.ts`; the owner steps above are still needed.

All four are now reported by the app itself — the first two as `logger.warn`/`logger.error`
from the route, the third from `postChatNotification` — and warn/error reach Sentry, which
does not depend on any of the variables above. Before that they were visible only in
Railway's HTTP proxy log, which is not somewhere anyone watches. On 2026-09-13 the
integration was in the **first** row: eighteen deliveries across six deploy events,
every one answered `401`, while the investigation was looking at the third row.

> Chat destination: this receiver forwards through `postChatNotification`, which
> reads `SLACK_WEBHOOK_URL`/`DISCORD_WEBHOOK_URL` from **server env** — set them on
> the Railway `PsychSift` service. With the token set but no chat URL in server env
> the receiver authenticates and returns `200 { "forwarded": false }`, so deploy
> alerts are silently undelivered.

> Note: the receiver runs inside the app being deployed, so a notification about
> a deploy that takes the app fully down may not be delivered. Pair it with an
> external uptime monitor for hard-down detection.

## 2. Supabase document change → ingestion

`POST /api/webhooks/supabase/document-change` turns the polling ingestion path
into an event-driven one: when a `public.documents` row is inserted outside the
app upload flow, or an existing row is flagged for reindex, the receiver enqueues
one `ingestion_jobs` row that the worker then claims.

**Auth.** Supabase Database Webhooks can send custom headers, so the shared secret
`SUPABASE_INGESTION_WEBHOOK_SECRET` (min 16 chars) is sent as
`Authorization: Bearer <secret>` (or `x-webhook-secret`) and compared
constant-time. Fails closed (`503`) when unset, `401` on a bad secret.

**When it enqueues (idempotent + loop-safe):**

- **INSERT** of a not-yet-`indexed` document → enqueue. Note this is what the
  _receiver_ does with an INSERT event; the **recommended trigger below does not
  send INSERT events** because the app upload route deletes its own just-created
  document if _its_ job insert loses the one-open-job race, so a webhook enqueue
  winning that race would break the upload. Drive external inserts through a
  post-insert `reindex_requested` UPDATE instead (see Setup).
- **UPDATE** acts only when `record.metadata.reindex_requested === true`, then
  clears that flag via `apply_document_metadata_patch`. The worker's own
  completion writes (also UPDATEs) never carry the flag, so they cannot retrigger
  an endless loop. If the clear itself fails, the receiver responds `500` (not
  `2xx`), so a caller that _retries_ would re-deliver until the flag is cleared
  (the idempotent enqueue means a retry cannot double-queue). But note neither
  documented path retries (the raw `net.http_post` trigger and the UPDATE-only
  managed webhook are both at-most-once — see the note below), so a failed clear
  can leave `reindex_requested` stuck `true`; recover it with the clear-then-flip
  shown below.
- `checkIngestionMutationSafety` refuses while a job is already active, and the
  enqueue reports `already_active` instead of erroring on a lost race.

Every write is owner-scoped (`owner_id`) — the app's single tenancy layer, since
the service-role client bypasses RLS. Events without an `owner_id`, on other
tables, or of type `DELETE` are skipped with `200`.

### Setup (operator-applied)

The receiver is deployed but inert until a Supabase-side trigger actually calls
it. The trigger function/trigger below must ship as a **committed migration**, not
raw SQL applied to the live database — this repo's drift inventory
(`supabase/drift-manifest.json`) covers functions and triggers, so creating them
directly on live would diverge from `supabase/schema.sql` and **fail the next
`check:drift`**, and a schema restore would omit the webhook entirely. The only
operator-applied live state is the Vault secret (step 2) and the per-environment
base-URL GUC (step 3, required).

**Landing the trigger (step 4) needs a local Supabase container** — the schema
mirror + drift manifest are regenerated from a live replay, which cannot be done
offline:

- Add the SQL from step 4 as `supabase/migrations/<timestamp>_document_change_ingestion_webhook.sql`.
- Reconcile it into `supabase/schema.sql` (the checker `check:function-grants`
  reads the snapshot, and the `revoke execute … from public` below must appear there).
- Regenerate the drift manifest with `npm run drift:manifest`, then apply the
  migration to the live project through the normal deploy path.

**1. Set the app env var** — `SUPABASE_INGESTION_WEBHOOK_SECRET` (min 16 chars) on
the Railway `PsychSift` + `worker` services.

**2. Store the same secret in Supabase Vault** so the trigger can read it without
hardcoding it:

```sql
select vault.create_secret('<same-secret-as-the-env-var>', 'ingestion_webhook_secret');
```

**3. Point the base URL at _this_ environment (REQUIRED, every environment).**
There is no production default — if this GUC is unset the trigger no-ops, so an
un-configured staging/local replay can never post to production. Set it explicitly
per environment (production included):

```sql
-- production: 'https://psychiatry.tools'  ·  staging/local: that environment's host
alter database postgres set app.ingestion_webhook_base_url = 'https://<env-host>';
```

**4. Create the fail-safe trigger.** It fires only on an explicit
`reindex_requested` flip (an `AFTER UPDATE` trigger — **not** `INSERT`, to avoid
racing the app upload route; see the comment in the function), reads the secret
from Vault, and — critically — never aborts a document write if the secret is
missing or the POST fails (it just does nothing, mirroring the receiver's inert
`503`). `net.http_post` is asynchronous, so it does not block the write.

> **Delivery is at-most-once.** `net.http_post` is fire-and-forget — it returns a
> request id and does not retry on failure ([pg_net retries are still an open
> feature request](https://github.com/supabase/pg_net/issues/110)). So if the app
> is down, the secret is mismatched, or the receiver 500s _before_ enqueueing,
> that single event is lost. The receiver's "500 → provider retries" wording only
> holds against a caller that actually retries — **do not assume either the raw
> trigger _or_ a managed Supabase Database Webhook provides that**: managed
> webhooks are themselves a thin wrapper over pg_net, so they share the same
> no-retry limitation today.
>
> **There is no built-in recovery — automatic _or_ manual — for a dropped
> delivery.** A fresh insert lands as `status = 'queued'` with no `ingestion_jobs`
> row, and nothing sweeps that state: the scheduled Ingestion Autopilot's health
> check (`assessIngestionHealth`) only flags _failed_ or _stale-processing_ jobs,
> and the manual `scripts/reindex.ts` predicate `hasIncompleteDocumentsWithoutOpenJobs`
> explicitly requires `queuedDocuments === 0` (`src/lib/reindex-pipeline.ts`), so a
> stranded `queued`-without-job row matches neither — it stays unindexed.
>
> **To recover a stranded row, make the flag transition happen.** An `UPDATE` that
> sets `metadata.reindex_requested = true` fires this trigger only when the value
> actually _changes_ to true. A row stranded because the original flip's delivery
> was lost already has the flag `true`, so setting it `true` again is a no-op
> `true → true` that will **not** re-fire — you must **clear it, then set it**:
>
> ```sql
> update public.documents set metadata = metadata || '{"reindex_requested": false}'::jsonb where id = '<id>';
> update public.documents set metadata = metadata || '{"reindex_requested": true}'::jsonb  where id = '<id>';
> ```
>
> (A scheduled sweep should do the same clear-then-flip, or target `queued` rows
> with no open job directly.) **So for a document that must never be left
> unindexed, do not rely on webhook delivery alone** — ingest it through the app
> upload route and confirm the job appears, or use the insert-then-flag pattern
> below. Note the upload route is **not** fully transactional either: it inserts
> the `documents` row and then the `ingestion_jobs` row as two separate calls,
> deleting the document only if the job insert returns an error
> (`src/app/api/upload/route.ts`). Under normal operation that rollback prevents
> an orphan, but a process crash/timeout/kill _between_ the two inserts can still
> strand the same `queued`-without-job row nothing sweeps. The only true
> must-never-drop guarantees are an atomic enqueue (document + job in one
> transaction/RPC) or a scheduled queued-without-job sweep. The six-hour
> ingestion-autopilot probe now detects aged owner-scoped rows and raises a
> durable operator alert without mutating production automatically. Recovery
> uses the transactional reindex RPC and is available via
> `npm run recover:ingestion -- --include-stranded-queued` (optional
> `--owner-id`, `--stranded-min-age-minutes`, `--apply`). This trigger is a
> low-latency optimisation, not a delivery guarantee.

```sql
create or replace function public.notify_document_change_ingestion_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $$
declare
  v_secret   text;
  v_base_url text;
begin
  -- Fire ONLY on an explicit reindex request (metadata.reindex_requested flips to
  -- true). The INSERT case is deliberately NOT handled here: the app upload route
  -- inserts the document and then its own ingestion job in the same request, and
  -- it DELETES the document if that job insert loses a race against the one-open-
  -- job-per-document unique index (src/app/api/upload/route.ts). A webhook firing
  -- on INSERT could win that race and turn a normal upload into an intermittent
  -- failure. Documents inserted outside the upload flow are enqueued by a SEPARATE
  -- UPDATE that flips metadata.reindex_requested to true (an INSERT with the flag
  -- already set does NOT fire this AFTER UPDATE trigger). See docs below.
  --
  -- Compare the JSON value directly to the JSON boolean `true` — matches the
  -- receiver's strict `=== true` (a JSON string "true" is NOT actionable) and,
  -- unlike `->> ... ::boolean`, never raises on a malformed value.
  if new.metadata->'reindex_requested' = 'true'::jsonb
     and new.metadata->'reindex_requested' is distinct from old.metadata->'reindex_requested'
  then
    -- actionable
  else
    return new;
  end if;

  -- Fail SAFE: with no Vault secret the trigger no-ops rather than break the write.
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'ingestion_webhook_secret'
  limit 1;

  if nullif(v_secret, '') is null then
    return new;
  end if;

  -- REQUIRED, per environment. There is deliberately no production fallback: if
  -- this GUC is unset the trigger no-ops (like a missing secret) rather than post
  -- to a hardcoded host. A hardcoded prod default would make a staging/local
  -- replay POST that environment's document row to the PRODUCTION receiver —
  -- which is wired to a different Supabase project, so the row would fail to
  -- enqueue and its metadata would cross environments. Each environment sets its
  -- own base URL (step 3).
  v_base_url := nullif(current_setting('app.ingestion_webhook_base_url', true), '');
  if v_base_url is null then
    return new;
  end if;

  perform net.http_post(
    url := rtrim(v_base_url, '/') || '/api/webhooks/supabase/document-change',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    -- Minimal payload by design. The receiver reads only id / owner_id / status /
    -- metadata.reindex_requested and then reloads the authoritative row by id, so
    -- the full row is never needed. Sending `to_jsonb(new)` (plus `old_record`)
    -- would ship file names, storage paths, and content hashes to whatever host
    -- app.ingestion_webhook_base_url resolves to — needlessly widening what a
    -- mistyped/wrong-environment GUC could leak. Send the four fields it uses and
    -- omit old_record entirely.
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', jsonb_build_object(
        'id', new.id,
        'owner_id', new.owner_id,
        'status', new.status,
        'metadata', jsonb_build_object(
          'reindex_requested', new.metadata -> 'reindex_requested'
        )
      )
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    -- A notification failure must never abort the document write.
    raise warning 'notify_document_change_ingestion_webhook failed: %', sqlerrm;
    return new;
end;
$$;

-- SECURITY DEFINER hardening: never callable directly by clients.
revoke execute on function public.notify_document_change_ingestion_webhook() from public, anon, authenticated;

drop trigger if exists documents_ingestion_webhook on public.documents;
-- UPDATE only, by design — see the INSERT-race comment in the function above.
create trigger documents_ingestion_webhook
  after update of metadata on public.documents
  for each row execute function public.notify_document_change_ingestion_webhook();
```

Rollback is additive and data-preserving: disable delivery by dropping the
trigger first, then remove the trigger function. The Vault secret and database
GUC may remain for a later redeploy or be removed separately by an operator.

```sql
drop trigger if exists documents_ingestion_webhook on public.documents;
drop function if exists public.notify_document_change_ingestion_webhook();
```

To reindex an existing document — or to index one inserted outside the app upload
flow — issue an **`UPDATE` that flips `metadata.reindex_requested` to `true`**; the
trigger POSTs, the receiver enqueues the job and clears the flag.

> **Insert-then-flag, as two statements.** Because this is an `AFTER UPDATE`
> trigger whose predicate requires the flag to _change_ from not-true to true, the
> two statements must be: (1) `INSERT` the row **with `reindex_requested` absent or
> `false`**, then (2) a separate `UPDATE` that flips it to `true`. An `INSERT` with
> the flag already `true` never fires the trigger (no UPDATE happened), and a later
> `UPDATE` that sets it `true` again is a no-op `true → true` (not _distinct from_
> the old value), so it will not fire either — both leave a `queued` row with no
> job. Concretely:
>
> ```sql
> update public.documents
>   set metadata = metadata || '{"reindex_requested": true}'::jsonb
>   where id = '<document-id>';
> ```
>
> Then confirm an `ingestion_jobs` row appears for that document.

**Managed alternative (dashboard convenience).** A Supabase **Database Webhook**
on `public.documents` scoped to **`UPDATE` events only** — do **not** tick
`INSERT` — pointed at the URL above with an `Authorization: Bearer <secret>`
header avoids writing the trigger SQL yourself. An `INSERT` webhook re-introduces
exactly the upload-race the SQL trigger avoids (the upload route deletes its
document if a webhook enqueue beats its own job insert), so `UPDATE`-only is not
optional here. Its only real advantage over the committed migration is
convenience — it does **not** buy you at-least-once delivery (it wraps pg_net,
same no-retry limitation as the raw trigger; see the note above). Its other trade-offs: it fires on _every_ update (the receiver then skips
the non-actionable ones, versus the SQL gating above), and the dashboard-created
object is operator/live state that must be recorded in
`supabase/drift-allowlist.json` if it appears in the drift inventory. It adds
**no** delivery guarantee — see the at-most-once note above for why neither path
self-heals a dropped insert.

> **Privacy: prefer the committed trigger for `public.documents`.** A managed
> Database Webhook builds the POST body automatically and includes the **full
> row** — both `record` and, on UPDATE, `old_record`
> ([Supabase docs](https://supabase.com/docs/guides/database/webhooks#payload)).
> Unlike the SQL trigger above (which sends only `id`/`owner_id`/`status`/the
> reindex flag), this ships filenames, storage paths, content hashes, and the
> prior row's metadata on every update. A mistyped or wrong-environment URL would
> leak all of it. Because `documents` holds private clinical rows, use the
> **committed minimal trigger** for this table; reserve the dashboard webhook for
> non-sensitive tables where the full-row payload is acceptable.
