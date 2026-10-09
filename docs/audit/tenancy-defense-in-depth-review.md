# Tenancy Defense-in-Depth Review — Clinical KB Database

**Status:** Review complete · **Date:** 2026-07-06 (fail-closed RPC landed **2026-07-08**, PR #409) · **Branch:** `claude/privacy-tenancy-review`
**Scope:** Every API route family under `src/app/api/**`, the Supabase RPCs they call, signed-URL
issuance, the response cache, and the demo/no-auth code paths — audited adversarially for a missed or
bypassable `owner_id` filter.
**Method:** One auditor agent per route family (7 families, all 33 route files), each required to trace
every `supabase.rpc(...)` into `supabase/schema.sql` / `supabase/migrations/**` and confirm the SQL
body itself owner-filters. Every claimed gap was then independently re-verified against the source and
the live database. Verdicts: **verified-scoped** / **gap** / **needs-deeper-look**.

---

## 1. Executive summary

**Result: 0 confirmed cross-tenant leaks across all 33 API routes.** Every route that reads or mutates
owner-scoped clinical data applies an owner filter, and every retrieval RPC re-applies owner scoping in
its own SQL body. The single deliberately-service-role architecture (RLS bypassed in the app tier,
ownership enforced in application code) is, as implemented today, **correctly and consistently
enforced**.

That said, this is a **single-layer** design with one structural weakness that **was closed on
2026-07-08** (PR #409):

> **The database had no independent tenancy floor for NULL `owner_filter`.** Before #409, the shared
> `retrieval_owner_matches` helper returned _every_ row when `owner_filter IS NULL` (fail-open). PR
> #409 (`20260708160001_retrieval_owner_matches_fail_closed.sql`) makes `NULL` match **no rows**; the
> app routes demo/test/local-no-auth through the public sentinel (`00000000-…`) instead of `NULL`
> ([owner-scope.ts](src/lib/owner-scope.ts)). Production paths that lack an owner still throw before
> any RPC is called.

**Historical note (pre-#409):** the review below describes the fail-open edge that existed at audit
time. Items 1 (fail-closed RPC) and 2 (CI owner-scope guard) in §6 are **DONE**; items 3–4 remain the
recommended follow-ups.

**The one non-clean finding** is a **low-severity information disclosure**, not a tenancy leak:
`setup-status` interpolates a raw Postgres RPC error string into its response
([setup-status/route.ts:165](src/app/api/setup-status/route.ts)) — schema-shape only, behind the
local-origin gate (TEN-N1).

---

## 2. The tenancy architecture

### 2.1 How ownership is resolved

```
request ─► publicAccessContext()  src/lib/public-api-access.ts:65-80
             │   getOptionalAuthenticatedUser() validates bearer/cookie JWT via supabase.auth.getUser()
             ├─ authenticated → { authenticated:true,  ownerId: user.id }
             └─ anonymous     → { authenticated:false, ownerId: undefined }
```

Mutating routes instead call `requireAuthenticatedUser()` which **throws** (401) with no session
([auth.ts:136-140](src/lib/supabase/auth.ts)). `owner_id` is **never** taken from the request body/query
— it is always the cryptographically-validated `auth.uid()` or a server-configured value. This closes
the "forge an owner_id" class of attack across every route.

### 2.2 The two scoping primitives

- **Reads (public-overlay model):** `withOwnerReadScope(query, ownerId)`
  ([public-api-access.ts:60-63](src/lib/public-api-access.ts)):
  - authenticated → `.or('owner_id.eq.<id>,owner_id.is.null')` → **own rows + shared public (null-owner) rows**
  - anonymous → `.is('owner_id', null)` → **public rows only**
- **Retrieval (RPC filter):** `retrievalOwnerFilter({ownerId, documentIds, allowGlobalSearch})`
  ([owner-scope.ts:15-30](src/lib/owner-scope.ts)):
  - `ownerId` → that owner (exact)
  - demo / local-no-auth / test → `undefined`
  - else if `allowGlobalSearch || documentIds` → **`PUBLIC_OWNER_FILTER_SENTINEL` `00000000-…0000`** (public-only)
  - else → **throws** (fail-closed)

**Threat-model note:** null-owner rows are a _deliberately shared public corpus_ (see
[migration 20260705220000](supabase/migrations/20260705220000_promote_locally_reviewed_documents_public.sql)
promoting reviewed documents to public). An authenticated user seeing null-owner rows is **not** a
leak. The leak this review hunts is: **authed user A seeing user B's non-null `owner_id` rows**, an
**anonymous** caller seeing any non-null rows, or any caller **mutating** another owner's rows.

### 2.3 The SQL-level owner helper (fail-closed since #409)

Every retrieval RPC gates rows through `retrieval_owner_matches`. **As of PR #409** the helper is
fail-closed on `NULL`:

```sql
-- migration 20260708160001_retrieval_owner_matches_fail_closed.sql
create function public.retrieval_owner_matches(owner_filter uuid, row_owner_id uuid) returns boolean as $$
  select case
    when owner_filter is null then false                                  -- fail-closed (was fail-open pre-#409)
    when owner_filter = '00000000-0000-0000-0000-000000000000' then row_owner_id is null  -- public only
    else row_owner_id = owner_filter                                      -- exact owner (excludes null)
  end;
$$;
```

Legitimate public/demo paths pass the sentinel, not `NULL`. Verify live with
`npm run check:july8-live-batch` after applying the July 8 batch
([operator runbook](../archive/operator-apply-july8-batch.md)).

---

## 3. Route-by-route verdict

All 33 route files, every exported method. Full per-method reasoning with line cites lives in the audit
transcripts; this is the consolidated verdict.

### Answer family (OpenAI RAG path)

| Route · method            | Verdict            | Owner mechanism                                                                                                                                                                     |
| ------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/answer`        | ✅ verified-scoped | `access.ownerId` + `allowGlobalSearch:!ownerId` → RPC `retrieval_owner_matches`; `resolveSearchScope` pre-filters documents ([route.ts:80,93,125-126](src/app/api/answer/route.ts)) |
| `POST /api/answer/stream` | ✅ verified-scoped | Same resolution threaded through `streamAnswer(...ownerId,publicOnly)` ([stream/route.ts:241-252](src/app/api/answer/stream/route.ts))                                              |

### Documents read + sub-resources

| Route · method                                 | Verdict            | Owner mechanism                                                                                                                                                                               |
| ---------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/documents`                           | ✅ verified-scoped | `withOwnerReadScope(...access.ownerId)` ([documents/route.ts:173](src/app/api/documents/route.ts)); children fetched by owner-scoped documentIds                                              |
| `GET /api/documents/[id]`                      | ✅ verified-scoped | `withOwnerReadScope(...).eq('id',id)`; 404 before child fetch ([[id]/route.ts:289-295](src/app/api/documents/[id]/route.ts))                                                                  |
| `PATCH /api/documents/[id]`                    | ✅ verified-scoped | `requireAuthenticatedUser` + `.eq('id',id).eq('owner_id',user.id)`; update re-asserts owner ([[id]/route.ts:434-462](src/app/api/documents/[id]/route.ts))                                    |
| `DELETE /api/documents/[id]`                   | ✅ verified-scoped | owner-scoped parent fetch + delete re-asserts owner; storage cleanup from owner-verified rows ([[id]/route.ts:493-583](src/app/api/documents/[id]/route.ts))                                  |
| `POST/PATCH/DELETE /api/documents/[id]/labels` | ✅ verified-scoped | `requireOwnedDocument` + every write triple-scoped `id`+`document_id`+`owner_id` ([labels/route.ts:77-288](src/app/api/documents/[id]/labels/route.ts))                                       |
| `POST /api/documents/[id]/summarize`           | ✅ verified-scoped | `requireAuthenticatedUser`; `summarizeDocument(id,user.id)` filters `owner_id` ([summarize/route.ts:30-34](src/app/api/documents/[id]/summarize/route.ts)); latent note TEN-N2                |
| `GET/PATCH /api/documents/[id]/table-facts`    | ✅ verified-scoped | `loadOwnedDocument` (`.eq('owner_id')`); fact writes re-scoped ([table-facts/route.ts:27-116](src/app/api/documents/[id]/table-facts/route.ts))                                               |
| `GET /api/documents/[id]/search`               | ✅ verified-scoped | route owner-scopes parent AND `search_document_chunks` SQL owner-filters ([search/route.ts:190-204](src/app/api/documents/[id]/search/route.ts); [schema.sql:2928-2931](supabase/schema.sql)) |

### Mutations · signed URLs · upload (highest blast radius)

| Route · method                       | Verdict            | Owner mechanism                                                                                                                                                                                                               |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/documents/[id]/signed-url` | ✅ verified-scoped | `withOwnerReadScope` on doc **before** `createSignedUrl`; `storage_path` from owner-verified row ([signed-url/route.ts:40-51](src/app/api/documents/[id]/signed-url/route.ts))                                                |
| `GET /api/images/[id]/signed-url`    | ✅ verified-scoped | image has no `owner_id`; tenancy via parent-document `withOwnerReadScope` ([images/[id]/signed-url/route.ts:49-55](src/app/api/images/[id]/signed-url/route.ts))                                                              |
| `POST /api/documents/[id]/reindex`   | ✅ verified-scoped | `requireAuthenticatedUser` + `.eq('owner_id',user.id)`; every state write re-scoped ([reindex/route.ts:110-255](src/app/api/documents/[id]/reindex/route.ts))                                                                 |
| `POST /api/documents/bulk`           | ✅ verified-scoped | pre-scoping select `.eq('owner_id',user.id).in('id',ids)`; body ids intersected with ownership ([bulk/route.ts:127-204](src/app/api/documents/bulk/route.ts))                                                                 |
| `POST /api/documents/bulk/reindex`   | ✅ verified-scoped | pre-scoping select `.eq('owner_id',user.id)`; per-doc writes re-scoped ([bulk/reindex/route.ts:101-247](src/app/api/documents/bulk/reindex/route.ts))                                                                         |
| `POST /api/upload`                   | ✅ admin-only      | Validated Supabase session plus immutable `app_metadata.site_role = administrator`; uploaded rows remain scoped to that administrator until publication review promotes them ([upload/route.ts](src/app/api/upload/route.ts)) |

### Search

| Route · method                 | Verdict            | Owner mechanism                                                                                                                                                                                                                   |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/search`             | ✅ verified-scoped | `searchChunksWithTelemetry({ownerId,allowGlobalSearch:!ownerId})`; RPCs owner-filter; `assertGlobalSearchAllowed` throws in prod ([search/route.ts:726-728](src/app/api/search/route.ts); [rag.ts:2151-2164](src/lib/rag/rag.ts)) |
| `GET /api/search/universal`    | ✅ verified-scoped | live branch only when `access.ownerId` truthy; each domain owner-seeded; static catalogs intended-public ([universal/route.ts:70-82](src/app/api/search/universal/route.ts))                                                      |
| `POST /api/search/interaction` | ✅ verified-scoped | writes hard-pinned to `owner_id:user.id`; clicked doc/chunk validated owner-owned or nulled ([interaction/route.ts:44-84](src/app/api/search/interaction/route.ts))                                                               |

### Ingestion · jobs

| Route · method                        | Verdict            | Owner mechanism                                                                                                                                                                 |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/ingestion/batches`          | ✅ verified-scoped | `.eq('owner_id',user.id)` on `import_batches` ([batches/route.ts:62-67](src/app/api/ingestion/batches/route.ts))                                                                |
| `GET /api/ingestion/jobs`             | ✅ verified-scoped | `documents!inner` + `.eq('documents.owner_id',user.id)` (jobs have no owner col) ([jobs/route.ts:64-69](src/app/api/ingestion/jobs/route.ts))                                   |
| `POST /api/ingestion/jobs/[id]/retry` | ✅ verified-scoped | job gated via `documents!inner(owner_id)`+`.eq('id',id)`; requeue re-asserts `.eq('owner_id',user.id)` ([retry/route.ts:23-95](src/app/api/ingestion/jobs/[id]/retry/route.ts)) |
| `GET /api/ingestion/quality`          | ✅ verified-scoped | root `documents` `.eq('owner_id',user.id)`; all aggregates `.in('document_id',ownedIds)` ([quality/route.ts:318-361](src/app/api/ingestion/quality/route.ts))                   |
| `GET /api/jobs`                       | ✅ verified-scoped | `documents!inner` + `.eq('documents.owner_id',user.id)` ([jobs/route.ts:67-71](src/app/api/jobs/route.ts))                                                                      |

### Catalogs · eval (owner-scoped private tables with in-memory public fixtures)

| Route · method                                                  | Verdict            | Owner mechanism                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/registry/records` (+ `/[slug]`)                       | ✅ verified-scoped | authed branch `.eq('owner_id',ownerId)`; anon branch = in-memory fixtures, no DB rows ([registry-seed.ts:65](src/lib/registry-seed.ts); [records/route.ts:79-106](src/app/api/registry/records/route.ts))              |
| `GET /api/medications` (+ `/[slug]`)                            | ✅ verified-scoped | `.eq('owner_id',ownerId)` ([medication-seed.ts:37](src/lib/medication-seed.ts); [[slug]/route.ts:98](src/app/api/medications/[slug]/route.ts))                                                                         |
| `GET /api/differentials` (+ `/[slug]`, `/presentations/[slug]`) | ✅ verified-scoped | `.eq('owner_id',access.ownerId)` on every DB read ([differentials/route.ts:106](src/app/api/differentials/route.ts); [presentations/[slug]/route.ts:113,144](src/app/api/differentials/presentations/[slug]/route.ts)) |
| `POST /api/eval-cases`                                          | ✅ verified-scoped | `requireAuthenticatedUser`; `owner_id:user.id`; referenced doc/chunk validated owner-owned or nulled ([eval-cases/route.ts:124-149](src/app/api/eval-cases/route.ts))                                                  |

> Catalog correction: the audit brief speculated these tables might be owner-less shared catalogs.
> **False** — `clinical_registry_records`, `medication_records`, `differential_records`,
> `rag_query_misses` all declare `owner_id NOT NULL` with a `unique(owner_id, …)` constraint
> ([migration 20260703020000:10](supabase/migrations/20260703020000_clinical_registry_records.sql),
> [20260705010000:7](supabase/migrations/20260705010000_medication_records.sql),
> [20260705120000:5](supabase/migrations/20260705120000_differential_records.sql)). They are
> owner-scoped private tables; the "public catalog" served to anonymous callers comes from **in-memory
> curated fixtures**, never DB rows. No route exposes a write path to a shared catalog (catalog
> poisoning is not reachable).

### Infra / misc (info-disclosure, not owner rows)

| Route · method              | Verdict                   | Notes                                                                                                                                                                   |
| --------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`           | ✅ verified-safe          | Only presence booleans + coarse status; deep probe behind `HEALTH_DEEP_PROBE_SECRET` with `timingSafeEqual` ([health/route.ts:8-17,29-49](src/app/api/health/route.ts)) |
| `GET /api/setup-status`     | ⚠ needs-deeper-look (low) | **TEN-N1** — raw RPC `error.message` in `detail` ([setup-status/route.ts:165](src/app/api/setup-status/route.ts)); schema-shape only, behind local-origin gate          |
| `GET /api/local-project-id` | ✅ verified-safe          | Returns constants + one-way SHA-256 of cwd path; no secrets, no owner data ([local-server-utils.mjs:20-22](src/lib/local-server-utils.mjs))                             |

**No request-controlled path can flip the app into demo/no-auth mode.** `isDemoMode()` /
`isLocalNoAuthMode()` read only server env + `NODE_ENV`, and both hard-return `false` in production
([env.ts:185-206](src/lib/env.ts)). No auth-bypass surface found.

---

## 4. RPC SQL-body owner enforcement

Every retrieval RPC reachable from a user route was traced into `supabase/schema.sql` /
`supabase/migrations/**` and confirmed to apply `retrieval_owner_matches(owner_filter, <table>.owner_id)`
(or the inline equivalent) in its `WHERE`. All are `language sql` **SECURITY INVOKER**.

| RPC                                       | Owner-filters in SQL?                    | Ref                                                                                                                 |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `match_document_chunks` (vector)          | ✅                                       | [migration 20260705210000:65](supabase/migrations/20260705210000_retrieval_owner_filter_sentinel.sql), :120         |
| `match_document_chunks_hybrid`            | ✅                                       | :188, :229                                                                                                          |
| `match_document_chunks_text`              | ✅                                       | :591                                                                                                                |
| `match_document_lookup_chunks_text`       | ✅                                       | :723                                                                                                                |
| `match_documents_for_query`               | ✅ (`requireOwnerScope`, throws on null) | :511                                                                                                                |
| `match_document_table_facts_text`         | ✅                                       | :862                                                                                                                |
| `match_document_embedding_fields_hybrid`  | ✅                                       | :917, :931                                                                                                          |
| `match_document_index_units_hybrid`       | ✅                                       | :1013                                                                                                               |
| `match_document_memory_cards_hybrid(_v2)` | ✅                                       | [schema.sql:2228,2248,2330-2337](supabase/schema.sql)                                                               |
| `get_related_document_metadata`           | ✅                                       | :765, :775, :781                                                                                                    |
| `search_document_chunks` (single-doc)     | ✅ (fail-closed)                         | [migration 20260705133000:51-52](supabase/migrations/20260705133000_tighten_search_document_chunks_owner_scope.sql) |

**Ingestion state RPCs** (`claim_ingestion_jobs`, `complete_ingestion_job`,
`fail_or_retry_ingestion_job`, `refresh_import_batch_status`) mutate **by id with no owner predicate**
and are SECURITY INVOKER — but they are **not a route gap**: they are invoked **only from the trusted
worker** (`worker/main.ts`), are **revoked from `anon`/`authenticated`** and granted `service_role`
only ([schema.sql:3772,3805](supabase/schema.sql)), and the user-facing retry route deliberately uses a
direct owner-scoped `UPDATE` instead. No user session can reach them.

**All execute grants on retrieval RPCs are revoked from `anon`/`authenticated` and granted only to
`service_role`** ([schema.sql:2950-2951](supabase/schema.sql)) — consistent with the "service-role +
app-layer filter" design.

---

## 5. Response-cache cross-tenant analysis

The memory-flagged concern ("shared null-owner `rag_response_cache` bucket") was checked directly and
does **not** yield a cross-tenant leak:

- **In-memory answer/search caches:** the cache **key** includes `ownerId` as an explicit component —
  `scopedAnswerCacheKey = [depVersion, ownerId ?? "anonymous", scopeKey, modeKey, query]`
  ([rag.ts:1453-1459](src/lib/rag/rag.ts)) and `scopedSearchCacheKey`
  ([rag.ts:1553-1559](src/lib/rag/rag.ts)). User A's UUID-prefixed key cannot collide with B's.
- **Persisted `rag_response_cache`:** owner enforced as a **column predicate** on both read and write —
  `sharedCacheSelector` adds `.eq('owner_id', args.ownerId)` (authed) or `.is('owner_id', null)` (anon)
  ([rag.ts:1667](src/lib/rag/rag.ts)); writes stamp `owner_id: args.ownerId ?? null` after a same-owner
  delete ([rag.ts:1870-1873](src/lib/rag/rag.ts)). A reads only `owner_id = A` rows — never B's, never the
  null bucket.
- The `owner_id IS NULL` cache partition is shared **among anonymous callers only**, and only ever
  holds answers built from **public null-owner documents** — the intended public corpus, not private
  data. No cross-tenant serve.

---

## 6. Recommendation: does production warrant owner-scoped RLS as a second layer?

**Short answer: not a full RLS refactor first — but yes to a cheaper, higher-leverage second layer.**
The honest cost/benefit:

### What RLS would and wouldn't buy today

The RLS policies in `schema.sql` (owner-read for `authenticated`) are currently **latent**: the API
routes all use the **service-role** client, which bypasses RLS, so those policies protect **nothing on
the current request paths**. They would only bite a _different_ access pattern (client-direct Supabase
access, or an edge function running as the user) — which the app doesn't use. So "RLS exists" is true
but does not currently constitute a second enforcement layer for these routes.

### The real cost of making RLS bite

To make RLS an actual second layer, every route would need to stop using the service-role client and
instead run as the user (anon key + user JWT, or a per-request `SET LOCAL` owner GUC). That refactor is
**substantial and risky** because:

1. **The public-overlay model breaks under naïve RLS.** Current policies grant `owner_id = auth.uid()`
   only — **not** null-owner rows. The app's whole "own rows + shared public corpus" read model
   ([withOwnerReadScope](src/lib/public-api-access.ts)) would return no public documents unless every
   policy is rewritten to `owner_id = auth.uid() OR owner_id IS NULL`.
2. **Anonymous public-catalog reads have no JWT** to present, so an anon-key + RLS path returns nothing
   for the intended public/unauthenticated experience unless carefully policy-modelled.
3. **The retrieval RPCs are SECURITY INVOKER but called as service-role**; re-scoping them to run as the
   user (or flipping SECURITY DEFINER) is a performance- and correctness-sensitive change.
4. **The worker legitimately needs service-role** and must stay bypassing RLS.

That is real, multi-week work with its own regression surface — disproportionate while the app serves a
small, largely-cooperative user set with a public shared corpus.

### The pragmatic second layer (recommended, in priority order)

1. **Make the retrieval RPCs fail-_closed_ on a null owner filter — DONE (2026-07-08, PR #409).**
   `retrieval_owner_matches` now returns no rows when `owner_filter IS NULL`; the app uses the public
   sentinel for legitimate unauthenticated paths. Verify: `npm run check:july8-live-batch`.
2. **Add a CI guard against un-scoped owner tables (cheap, high value) — DONE (2026-07-17),
   WIDENED (2026-09-02).** Two layers now:
   - [`scripts/check-owner-scope-api.mjs`](../../scripts/check-owner-scope-api.mjs) fails when a
     `src/app/api/**` handler queries an owner-scoped table (any table with an `owner_id` column in
     `supabase/schema.sql`) without a recognised scoping construct in the enclosing handler —
     `.eq('owner_id'`, `withOwnerReadScope`, `requireOwnerScope`, `requireOwnedDocument`/`loadOwnedDocument`,
     a `documents!inner`+`documents.owner_id` join, or an `owner_id:` write payload. Confirmed-safe
     indirect-scope cases live in a documented `OWNER_SCOPE_ALLOWLIST`.
   - [`scripts/lib/tenancy-scan.mjs`](../../scripts/lib/tenancy-scan.mjs) is the mechanical scan the
     same command and [`tests/retrieval-owner-filter-guard.test.ts`](../../tests/retrieval-owner-filter-guard.test.ts)
     both run. It closes the five blind spots the handler-level regex layer has, described below.

   Wired into `npm run check:owner-scope`, `npm run verify:cheap`, and the CI `static-pr` job;
   regression-locked by [`tests/owner-scope-guard.test.ts`](../../tests/owner-scope-guard.test.ts)
   and the guard test above. This directly guards the regression class the single-layer model is
   exposed to — a future PR dropping the filter.

   **What the mechanical scan now covers (2026-09-02).**

   | Blind spot it closed                       | Before                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **A — join-through tables were invisible** | Both guards only considered tables with an `owner_id` column, so `document_chunks`, `document_pages`, `document_images`, `ingestion_jobs`, `ingestion_job_stages`, `source_review_events` and `rag_visual_eval_runs` — which hold the actual document text and images — were never checked at all.                                                                                                                                                                                  | A third **derived** tier (has `document_id`, has neither owner column). Every query against one must appear in `DERIVED_QUERY_INVENTORY` with the proof that ownership was established; a new or moved site fails the guard until it is reviewed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
   | **B — `user_id` tenancy was not modelled** | `user_favourites`, `user_favourite_sets` and `user_preferences` were outside both guards. `withOwnerReadScope` cannot be used on them (it filters `owner_id`), so all ~18 call sites hand-roll `.eq("user_id", …)`.                                                                                                                                                                                                                                                                 | A **user-keyed** tier requiring a `user_id` predicate on the query chain. `owner_id` is explicitly not accepted as a substitute.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | **C — scope was attributed per FUNCTION**  | Both guards asked whether a sanctioned token appeared anywhere in the enclosing function, so a handler that scoped query 1 and forgot query 2 passed.                                                                                                                                                                                                                                                                                                                               | The predicate must ride the **same fluent chain** as the `.from("table")` call, or that chain must be handed to `withOwnerReadScope`. Genuinely indirect scoping is a declared entry naming its proof — which is how `ingestion/quality`'s `document_index_quality` read went from passing by accident to passing by review.                                                                                                                                                                                                                                                                                                                                                                                                       |
   | **D — the file set was too narrow**        | The `.mjs` guard stopped at `src/app/api`; the AST guard read only files ending `/route.ts`. Server components and observability aggregates were unguarded.                                                                                                                                                                                                                                                                                                                         | Every `.ts` under `src/app/api` plus a **named** list of server-side read modules: `src/lib/document-detail.ts`, `src/lib/sources/document-source-loader.ts`, `src/lib/observability/answer-slo.ts`, `src/lib/observability/spend-metrics.ts`, and — added 2026-09-02 — `src/lib/document-naming.ts`, the delegate behind the one dynamic table dispatch (blind spot F). A named list rather than a `src/lib/**` glob, so the boundary is a decision and the scan never acquires authority over the protected `src/lib/rag/**` ranking surface. `worker/**`, `scripts/**` and `supabase/functions/**` are out of scope **by decision** — they are job-scoped or operator tooling with a different tenancy model, not an oversight. |
   | **E — dynamic RPC dispatch**               | The primary retrieval RPCs never appear as `.rpc("literal")`; they go through `callVersionedRetrievalRpc(supabase, versionedName, legacyName, args, signal)` in `src/lib/rag/rag-candidate-sources.ts`, which also rewrites `owner_filter` to `PUBLIC_OWNER_FILTER_SENTINEL` on the legacy public-merge path. Tenancy for the whole retrieval layer sits in that one function and nothing pinned it there.                                                                          | The guard asserts `callVersionedRetrievalRpc` is the **only** non-literal `.rpc()` call site in `src/`, and that both RPC-name arguments are string literals at every one of its 8 call sites. A second dynamic dispatcher fails the test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
   | **F — dynamic table dispatch**             | A `.from(identifier)` whose table is not a string literal matched no tier and left the scan with **no signal at all**. One such site is real: `/api/upload` builds `{ from: (table) => adminSupabase.from(table) }` and hands it to `planDocumentName`, whose `documents` query in `src/lib/document-naming.ts` is the actual owner filter — and that module was in no scanned set, so deleting its `.eq("owner_id", …)` left both phases green. Found by Codex review, 2026-09-02. | Two changes, because a declaration alone would only move the blind spot. The delegate is now in `SCANNED_LIB_MODULES`, so its filter is checked mechanically as an ordinary direct-tier site. And every dynamic dispatch must appear in `DYNAMIC_FROM_DECLARATIONS` naming that delegate, with the entry refused unless the delegate is itself scanned. `Buffer.from`, `Array.from` and `…storage.from(bucket)` are excluded by receiver; every other unrecognised receiver **fails closed**.                                                                                                                                                                                                                                      |

   **How a declared proof is verified.** Five of the eight proof kinds are checked in the AST rather
   than trusted from the reason string: `documents-inner-join` (the chain selects `documents!inner`
   **and** filters `documents.owner_id`); `owner-pinned-document-id` (the identifier used as this
   query's `document_id` filter is the same identifier an owner-scoped `documents` query pinned as
   its `id` in the same scope); `owned-document-helper` (that identifier was handed to
   `requireOwnedDocument`/`loadOwnedDocument`/`ownedDocumentId`/`ownedDocumentExists`);
   `owner-scoped-id-list` (the identifier is declared in this scope and this scope runs an
   owner-scoped `documents` query); and `parent-document-verified` (the scope still contains the
   owner-scoped parent read the row is validated against). Only `reviewed-indirect` carries no
   mechanical check — it is used where the link crosses a function boundary or is not expressible,
   and every use of it is listed below. The seventh, `untiered-table`, is the fourth signal added
   after the 2026-09-02 security review: it is declaration-only by construction, because a table
   carrying no tenancy column has no ownership relation for a proof to check. The eighth,
   `dynamic-table-dispatch`, is declaration-only for the same reason — the table is not knowable
   at the call site — but it is not proof-free: the entry's `delegate` must be a module in
   `SCANNED_LIB_MODULES`, so the declaration points at coverage rather than substituting for it.

   **Residual gaps, recorded rather than closed.**
   - **The mechanical proofs are order-insensitive.** `scopeFacts` scans the enclosing scope
     without regard to statement order, so a proof is satisfied by an ownership query that runs
     **after** the protected read, or whose result is discarded without a branch. It no longer
     scans code that cannot run at all: since the 2026-09-02 Codex review the collection stops at
     nested function-like nodes the query is not lexically inside, so a never-invoked helper or
     callback can no longer donate its owner-scoped `documents` query to the enclosing handler.
     Reachability within a single scope is still unmodelled. The "a 404 is returned before this query"
     clauses in the reason strings are prose and are not checked. `parent-document-verified` is
     the weakest of the five: it requires only that _some_ owner-scoped `documents` query exists
     somewhere in the scope, not that its result gates the read. Closing this needs dataflow and
     control-flow analysis, not a wider AST match; until then the reason strings are a reviewer's
     claim and the scan is a placement check.
   - **Tables outside the three tiers.** A table carrying none of `owner_id`, `user_id`,
     `document_id` gets no tier and therefore no per-chain rule. This is now **signalled** rather
     than silent — see "Mechanical scan: tables outside the three tiers" below, which caught
     `clinical_quality_feedback_triage` — but a declaration is a written reason, not a proof.
   - **The two phases discover files differently.** Phase 1 lists
     `git ls-files src/app/api`; phase 2 walks the filesystem with `readdirSync(..., { recursive: true })`.
     They can therefore disagree about what exists. This is deliberate and is not aligned: phase 2
     is the stronger guard and must see a **new, not-yet-tracked** route file, which `git ls-files`
     would not list; phase 1 is the cheap independent second opinion and reads what the commit
     contains. The direction of the disagreement is the safe one — the stronger phase sees more —
     but a file that is tracked and deleted on disk is visible only to phase 1, and a working-tree
     file that is never committed is checked locally and not in CI.
   - Cross-function proofs (`eval-cases` `ownedChunkReference`, `search/interaction`
     `ownedChunkExists`, `documents/[id]/labels` `selectLabels`, `documents/[id]` DELETE's
     `updateStorageCleanupJob`, and the `document-source-loader` factory) are declared, not checked.
     Moving any of them to a different file or function drops its entry and forces a fresh review,
     which is the ratchet that replaces the missing dataflow analysis.
   - The scan reads only what a chain lexically shows. A predicate applied to a builder held in a
     variable and extended in a later statement is not attributed to the chain, so it would fail
     closed (needing an entry) rather than pass silently.
   - Item 3 below — a live cross-tenant integration test with two real users — remains the only
     thing that proves the boundary end to end. This is a static guard, not a proof of behaviour.

3. **Add a live cross-tenant integration test (medium value).** Fixtures for user A + user B; for each
   route family assert B cannot read/mutate A's non-null rows and gets 404/empty. This is the
   regression harness for the exact property the whole model depends on, and it is what would have
   caught any of the (hypothetical) gaps this manual audit looked for.
4. **Full owner-scoped RLS via a per-request user client (larger, do before scaling to many
   mutually-distrusting tenants).** This is the textbook defense-in-depth answer and worth doing before
   the app hosts many independent clinics on shared infrastructure — but it must preserve the
   public-null-owner overlay (policy `OR owner_id IS NULL`), the anonymous public-catalog path, and the
   worker's service-role needs. Sequence it **after** 1–3, which deliver most of the safety at a
   fraction of the cost and risk.

**Bottom line:** the current single-layer enforcement is correct today (0/33 gaps). Item 1 (fail-closed
RPC) is live in the repo (#409); **apply to production** per
[`docs/archive/operator-apply-july8-batch.md`](../archive/operator-apply-july8-batch.md). Item 2 (CI owner-scope guard) is
now landed and blocks the regression class in CI. Item 3 (live cross-tenant integration test) closes the
remaining app-layer regression exposure; full RLS (item 4) is justified before multi-tenant scale.

### Owner-scope guard allowlist (item 2)

`scripts/check-owner-scope-api.mjs` flags any `src/app/api/**` query on an owner-scoped table that
lacks an owner filter in its enclosing handler. A query is scoped either **on its own chain**
(`.eq("owner_id"…)`, `withOwnerReadScope`) or by a **handler-level ownership proof** that precedes it
(`requireOwnedDocument`, an owner-checked `.select(...).eq("owner_id"…)`, or an `owner_id:` write
payload) — the guard checks the whole enclosing handler body, so the dominant "prove ownership, then
mutate/read by the proven id" idiom (e.g. `documents` PATCH selects `.eq("owner_id", user.id)` then
updates by `id`; `ingestion/quality` fetches owner-scoped document ids then reads child tables by
`document_id IN (…)`) is recognised without a per-statement dataflow analysis. Queries inside in-file
helpers fall back to whole-file scope because their caller proves ownership first (e.g. `selectLabels`
runs only after `requireOwnedDocument`).

The guard's `OWNER_SCOPE_ALLOWLIST` holds **exactly** these reviewed indirect-scope exceptions (any
new entry must be added here and to the list in the guard, or the regression test fails):

| File                                    | Table                              | Why it is safe                                                                                                                                                                             |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/app/api/setup-status/route.ts`     | `documents`                        | Local-origin-gated `.limit(1)` existence probe ("is any document indexed?"); returns only status booleans, not an owner-data read (§3 / TEN-N1).                                           |
| `src/app/api/setup-status/route.ts`     | `import_batches`                   | Local-origin-gated `.limit(1)` existence probe for schema provisioning; returns only status booleans, not an owner-data read (§3 / TEN-N1).                                                |
| `src/app/api/setup-status/route.ts`     | `storage_cleanup_jobs`             | Local-origin-gated head-count probe for pending cleanup rows (schema/ops posture); returns only status booleans/counts, not an owner-data read (§3 / TEN-N1).                              |
| `src/app/api/clinical-quality/route.ts` | `rag_answer_feedback`              | Administrator-gated cross-tenant governance aggregate. `GET`/`PATCH` call `authorizeAndLimit` before helper reads; response excludes raw question, answer, excerpt, and patient text (§6). |
| `src/app/api/clinical-quality/route.ts` | `clinical_registry_record_sources` | Administrator-gated cross-tenant governance aggregate. `GET`/`PATCH` call `authorizeAndLimit` before helper reads; response excludes raw question, answer, excerpt, and patient text (§6). |
| `src/app/api/clinical-quality/route.ts` | `clinical_registry_records`        | Administrator-gated cross-tenant governance aggregate. `GET`/`PATCH` call `authorizeAndLimit` before helper reads; response excludes raw question, answer, excerpt, and patient text (§6). |
| `src/app/api/clinical-quality/route.ts` | `rag_retrieval_logs`               | Administrator-gated cross-tenant governance aggregate. `GET`/`PATCH` call `authorizeAndLimit` before helper reads; response excludes raw question, answer, excerpt, and patient text (§6). |

### Mechanical scan: declared scope exemptions (2026-09-02)

Direct-tier (`owner_id`) and user-keyed (`user_id`) queries whose predicate is **not** on the query
chain. Every row is an entry in `SCOPE_EXEMPTIONS` in
[`scripts/lib/tenancy-scan.mjs`](../../scripts/lib/tenancy-scan.mjs); the guard test fails if an entry
here is missing, stale, or if its mechanical proof no longer holds.

| File                                              | Table                              | Scope                                                     | Proof                                                  | Why it is safe                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/clinical-quality/route.ts`           | `rag_answer_feedback`              | `loadClinicalQualitySnapshot` (×2), `verifyQualitySignal` | reviewed-indirect                                      | Administrator-gated cross-tenant governance aggregate behind `authorizeAndLimit`; governance metadata only, never raw question, answer, excerpt, or patient text.                                                                                                                                                                                                                                                                                                                         |
| `src/app/api/clinical-quality/route.ts`           | `clinical_registry_record_sources` | `loadClinicalQualitySnapshot`                             | reviewed-indirect                                      | Same administrator-gated aggregate; reads link rows only.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/app/api/clinical-quality/route.ts`           | `clinical_registry_records`        | `loadClinicalQualitySnapshot`                             | reviewed-indirect                                      | Same administrator-gated aggregate; reads `id,kind,route` only.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/app/api/clinical-quality/route.ts`           | `rag_retrieval_logs`               | `loadClinicalQualitySnapshot` (×2), `verifyQualitySignal` | reviewed-indirect                                      | Same administrator-gated aggregate; retrieval-reach counters only.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/app/api/documents/[id]/labels/route.ts`      | `document_labels`                  | `selectLabels`                                            | reviewed-indirect                                      | In-file read helper that runs only after `requireOwnedDocument` resolved for the same document id; it consumes an owner-authorized capability id rather than entering from a request.                                                                                                                                                                                                                                                                                                     |
| `src/app/api/documents/[id]/route.ts`             | `storage_cleanup_jobs`             | `updateStorageCleanupJob`                                 | reviewed-indirect                                      | Closes out a ledger row by the `cleanupJobId` the same DELETE handler created for an owner-verified document; the id is never request-supplied.                                                                                                                                                                                                                                                                                                                                           |
| `src/app/api/documents/[id]/table-facts/route.ts` | `document_table_facts`             | `GET`                                                     | owner-pinned-document-id (`id`)                        | Facts listed for the document id `withOwnerReadScope` already resolved in this handler; 404 before this query when the caller cannot see it.                                                                                                                                                                                                                                                                                                                                              |
| `src/app/api/documents/route.ts`                  | `document_labels`                  | `GET`                                                     | owner-scoped-id-list (`ownedIds`, `publicDocumentIds`) | Batched over the owned subset and the null-owner (public corpus) subset of the same `withOwnerReadScope` page; public rows use the redacted projection.                                                                                                                                                                                                                                                                                                                                   |
| `src/app/api/documents/route.ts`                  | `document_summaries`               | `GET`                                                     | owner-scoped-id-list (`ownedIds`, `publicDocumentIds`) | As above, with the redacted public summary projection.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/app/api/ingestion/quality/route.ts`          | `document_index_quality`           | `GET`                                                     | owner-scoped-id-list (`documentIds`)                   | Read by `.in("document_id", documentIds)` where `documentIds` comes from the `.eq("owner_id", user.id)` query at the top of the handler. This is the canonical blind-spot-C case: safe, but previously passing by accident rather than by review.                                                                                                                                                                                                                                         |
| `src/app/api/on-call/demo-content/route.ts`       | `on_call_entries`                  | `POST`                                                    | reviewed-indirect                                      | Authenticated `.limit(1)` existence probe that looks past the caller's own rows (`.neq("owner_id", user.id)` + non-personal example slugs, selecting `slug` only) so a second account cannot load a second public copy of the shared corpus. Returns only a 409; no owner row leaves the handler. The same POST's upsert is owner-stamped; GET/DELETE in this file filter `.eq("owner_id", user.id)` on-chain.                                                                            |
| `src/app/api/setup-status/route.ts`               | `documents`                        | `readSchemaStatus`                                        | reviewed-indirect                                      | Local-origin-gated `.limit(1)` existence probe; status booleans only (§3 / TEN-N1).                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/app/api/setup-status/route.ts`               | `import_batches`                   | `readSchemaStatus`                                        | reviewed-indirect                                      | Local-origin-gated `.limit(1)` existence probe; status booleans only (§3 / TEN-N1).                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/app/api/setup-status/route.ts`               | `storage_cleanup_jobs`             | `readSchemaStatus`                                        | reviewed-indirect                                      | Local-origin-gated head-count probe; counts only (§3 / TEN-N1).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/lib/document-detail.ts`                      | `document_table_facts`             | `loadAuthorizedDocumentDetail`                            | owner-pinned-document-id (`id`)                        | Child read for the id `withOwnerReadScope` resolved at the top of the loader, which throws 404 before any child query.                                                                                                                                                                                                                                                                                                                                                                    |
| `src/lib/document-detail.ts`                      | `document_labels`                  | `loadAuthorizedDocumentDetail`                            | owner-pinned-document-id (`id`)                        | Same owner-resolved document id.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/lib/document-detail.ts`                      | `document_summaries`               | `loadAuthorizedDocumentDetail`                            | owner-pinned-document-id (`id`)                        | Same owner-resolved document id.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/lib/on-call/repository.ts`                   | `on_call_entries`                  | `fetchSharedOnCallEntries`                                | reviewed-indirect                                      | Anonymous shared read by owner decision (2026-09-04), so there is no owner to filter by. Scoped instead by two fail-closed allow-lists: `PUBLIC_ON_CALL_SECTIONS` withholds any section not named on purpose, and `rowMayBeComplianceRequirement` withholds any `logistics` row carrying a `kind`, read from the raw row before parsing so a malformed compliance requirement is withheld rather than published. Added 2026-09-20 after a review found this file outside the scanned set. |
| `src/lib/roster/alerts/subscriptions.ts`          | `web_push_subscriptions`           | `saveOwnerSubscription`                                   | reviewed-indirect                                      | Shared-phone endpoint transfer removes a prior subscription by the validated browser endpoint before binding it to the signed-in owner; other deletes retain `owner_id`. Pinned by `tests/roster-alerts-route.test.ts`.                                                                                                                                                                                                                                                                   |
| `src/lib/roster/shifts/repository.ts`             | `on_call_shifts`                   | `addManualShifts`                                         | reviewed-indirect                                      | An insert, not a read. Every row is built in the same function with `owner_id: ownerId` after `requireOwner`, but the payload is a flatMap over the shift and its weekly repeats, so the scanner cannot see the key at the top level. `ownerId` comes from the signed-in session in `/api/roster/shifts/manual`. Added 2026-09-27 with Roster.                                                                                                                                            |
| `src/lib/observability/answer-slo.ts`             | `rag_queries`                      | `base`, `answerSloSnapshot`                               | reviewed-indirect                                      | Deliberate cross-tenant operator aggregate reached only from `/api/health`'s deep probe behind `HEALTH_DEEP_PROBE_SECRET`. Returns counts and a degraded-RPC identity map; owner filtering would make the answer SLO blind to every tenant but the prober.                                                                                                                                                                                                                                |
| `src/lib/observability/spend-metrics.ts`          | `rag_retrieval_logs`               | `spendSnapshot`                                           | reviewed-indirect                                      | Deliberate cross-tenant operator aggregate behind the same deep-probe gate; prices the trailing window from `query_class` and token counters. Per-owner spend is not the question being asked.                                                                                                                                                                                                                                                                                            |
| `src/lib/sources/document-source-loader.ts`       | `documents`                        | `createDocumentSourceQuery`                               | reviewed-indirect                                      | Factory returning an **unexecuted** PostgREST builder. Its only consumer, `loadVisibleDocumentSourceReferences`, wraps it in `withOwnerReadScope(query, viewerId)` before awaiting it; the indirection is a dependency-injection seam for tests. A second consumer executing the builder directly would invalidate this entry.                                                                                                                                                            |

### Mechanical scan: derived-tier (join-through) query inventory (2026-09-02)

These tables carry no owner column at all — ownership runs `document_id -> documents.owner_id` — and
they hold the document text and images. Every query site is listed; a new or moved one fails the
guard until it is reviewed. Entries live in `DERIVED_QUERY_INVENTORY` in
[`scripts/lib/tenancy-scan.mjs`](../../scripts/lib/tenancy-scan.mjs).

| File                                              | Table                  | Scope                                                     | Proof                                | How ownership is established                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | ---------------------- | --------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/clinical-quality/route.ts`           | `source_review_events` | `loadClinicalQualitySnapshot`                             | reviewed-indirect                    | Administrator-gated governance aggregate behind `authorizeAndLimit`; review dispositions, no document content.                                                                                                                                                                                                                                                                              |
| `src/app/api/clinical-quality/route.ts`           | `rag_visual_eval_runs` | `loadClinicalQualitySnapshot` (×2), `verifyQualitySignal` | reviewed-indirect                    | Same administrator-gated aggregate; eval pass/fail counters.                                                                                                                                                                                                                                                                                                                                |
| `src/app/api/clinical-quality/route.ts`           | `document_chunks`      | `loadClinicalQualitySnapshot`                             | reviewed-indirect                    | Reads only `id,document_id` for chunk ids already named by feedback rows, to map a signal back to its document. No chunk content is selected.                                                                                                                                                                                                                                               |
| `src/app/api/documents/[id]/cover/route.ts`       | `document_images`      | `GET` (×2)                                                | owner-pinned-document-id (`id`)      | Both cover lookups filter `.eq("document_id", id)` for the id `withOwnerReadScope` resolved earlier; 404 before either query otherwise.                                                                                                                                                                                                                                                     |
| `src/app/api/documents/[id]/reindex/route.ts`     | `ingestion_jobs`       | `POST`                                                    | owner-pinned-document-id (`id`)      | Competing-job diagnostic for the document already loaded with `.eq("owner_id", user.id)`.                                                                                                                                                                                                                                                                                                   |
| `src/app/api/documents/[id]/search/route.ts`      | `document_chunks`      | `GET`                                                     | owner-pinned-document-id (`id`)      | ILIKE fallback used only when the owner-filtering `search_document_chunks` RPC is unavailable; reads chunks for the id `withOwnerReadScope` resolved above.                                                                                                                                                                                                                                 |
| `src/app/api/documents/[id]/table-facts/route.ts` | `document_images`      | `PATCH` (×2)                                              | owned-document-helper (`id`)         | Both the source-image read and the review-metadata write are constrained to `.eq("document_id", id)` where `loadOwnedDocument` proved that document belongs to the requesting administrator. The write carried no document constraint until 2026-09-02 and was declared `reviewed-indirect`; restating it turned the repo's narrowest derived-tier write into a mechanically checked proof. |
| `src/app/api/eval-cases/route.ts`                 | `document_chunks`      | `ownedChunkReference`                                     | reviewed-indirect                    | Read-then-verify: selects only `id,document_id`, then calls `ownedDocumentId` on the returned `document_id` and returns null unless it belongs to the requester.                                                                                                                                                                                                                            |
| `src/app/api/images/[id]/signed-url/route.ts`     | `document_images`      | `GET`                                                     | parent-document-verified             | Image row fetched by id, then its parent document resolved through `withOwnerReadScope`; 404 and nothing signed unless the parent is visible.                                                                                                                                                                                                                                               |
| `src/app/api/images/signed-urls/route.ts`         | `document_images`      | `POST`                                                    | parent-document-verified             | Batch form of the same pattern (`/api/documents/images/batch` is a bare re-export of this module); only images whose parent survived `withOwnerReadScope` are signed.                                                                                                                                                                                                                       |
| `src/app/api/ingestion/jobs/route.ts`             | `ingestion_jobs`       | `GET` (×2)                                                | documents-inner-join                 | Page query and active-count query both join `documents!inner` and filter `.eq("documents.owner_id", user.id)` on the chain itself.                                                                                                                                                                                                                                                          |
| `src/app/api/ingestion/quality/route.ts`          | `ingestion_jobs`       | `GET`                                                     | owner-scoped-id-list (`documentIds`) | `.in("document_id", documentIds)` from the handler's `.eq("owner_id", user.id)` documents query.                                                                                                                                                                                                                                                                                            |
| `src/app/api/ingestion/quality/route.ts`          | `ingestion_job_stages` | `GET`                                                     | owner-scoped-id-list (`documentIds`) | Same owner-scoped id list.                                                                                                                                                                                                                                                                                                                                                                  |
| `src/app/api/ingestion/quality/route.ts`          | `document_pages`       | `GET`                                                     | owner-scoped-id-list (`documentIds`) | Same owner-scoped id list. This one reads page `text`, so it is the highest-value derived read in the handler.                                                                                                                                                                                                                                                                              |
| `src/app/api/ingestion/quality/route.ts`          | `document_images`      | `GET`                                                     | owner-scoped-id-list (`documentIds`) | Same owner-scoped id list; image counters and metadata.                                                                                                                                                                                                                                                                                                                                     |
| `src/app/api/jobs/route.ts`                       | `ingestion_jobs`       | `GET`                                                     | documents-inner-join                 | `documents!inner` + `.eq("documents.owner_id", user.id)` on the chain.                                                                                                                                                                                                                                                                                                                      |
| `src/app/api/search/interaction/route.ts`         | `document_chunks`      | `ownedChunkExists`                                        | reviewed-indirect                    | Existence probe selecting only `id`, constrained to the document id the caller passed; the POST handler calls `ownedDocumentExists` first and only reaches this helper when that returned true.                                                                                                                                                                                             |
| `src/app/api/setup-status/route.ts`               | `ingestion_jobs`       | `readSchemaStatus`, `readWorkerStatus` (×2)               | reviewed-indirect                    | Local-origin-gated schema and worker-liveness probes: newest job status plus a head-only count of pending/processing jobs. No job rows or document identity leave the probe (§3 / TEN-N1).                                                                                                                                                                                                  |
| `src/lib/document-detail.ts`                      | `document_chunks`      | `loadAuthorizedDocumentDetail` (×2)                       | owner-pinned-document-id (`id`)      | Selected-chunk lookup and chunk window, both for the id `withOwnerReadScope` resolved at the top of the loader, which throws 404 before any child query. This is the read that serves the document viewer's text.                                                                                                                                                                           |
| `src/lib/document-detail.ts`                      | `document_pages`       | `loadAuthorizedDocumentDetail`                            | owner-pinned-document-id (`id`)      | Page-window read for the same owner-resolved document id.                                                                                                                                                                                                                                                                                                                                   |
| `src/lib/document-detail.ts`                      | `document_images`      | `loadAuthorizedDocumentDetail`                            | owner-pinned-document-id (`id`)      | Image read for the same owner-resolved document id.                                                                                                                                                                                                                                                                                                                                         |

### Mechanical scan: tables outside the three tiers (2026-09-02)

A fourth signal, added after the security review of the scanner. The three tiers key off
`owner_id`, `user_id` and `document_id`; a table that carries **none** of those lands in no tier,
and before this signal existed it was simply skipped — zero coverage, and no mention anywhere that
coverage was missing. Any such table queried by a scanned file must now be declared in
`UNTIERED_TABLE_DECLARATIONS` in [`scripts/lib/tenancy-scan.mjs`](../../scripts/lib/tenancy-scan.mjs)
with a reason, or the scan fails.

**A rename is the way back into this hole.** The tier derivation reads column names, so renaming
`owner_id`, `user_id` or `document_id` on an existing table — or introducing a tenancy column under a
**fourth** name, which is exactly what `owner_role`/`owner_user_id` is — silently drops that table out
of its tier. This list is the only thing that then notices, and it notices by failing rather than by
staying quiet.

| File                                                          | Table                              | Scope                         | Why it is safe                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/clinical-quality/route.ts`                       | `clinical_quality_feedback_triage` | `loadClinicalQualitySnapshot` | Tenancy columns are named `owner_role`/`owner_user_id`, so no tier claims this table. Administrator-gated cross-tenant governance triage queue: `GET`/`PATCH` call `authorizeAndLimit` before this helper runs, and the projection is triage disposition metadata (signal type/id, status, resolution code, reviewer id, timestamps) — never question, answer, excerpt, or patient text. |
| `src/app/api/roster/team/[serviceId]/staffing-needs/route.ts` | `roster_staffing_needs`            | `readStaffingNeeds`           | Team-scoped by `service_id`, which the query filters on. `requireActiveMember` runs first and calls `roster_read` (overview) for the session actor, which raises unless the actor is an active, unrevoked member of a verified or demo team, exactly as for every other team read. The projection is weekday, date, kind, grade, site id and count only: no row id, user id or name.     |

---

## 7. Non-blocking findings

- **TEN-N1 (low):** `setup-status` interpolates a raw Postgres RPC `error.message` into its response
  detail ([setup-status/route.ts:165](src/app/api/setup-status/route.ts)). Worst case is schema-shape
  disclosure (a function/relation name), only to a caller past the local-origin gate. Fix: return a
  generic message; log the raw error server-side.
- **TEN-N2 (latent):** `summarizeDocument(documentId, ownerId?)` has an **optional** `ownerId`
  ([rag.ts:7792](src/lib/rag/rag.ts)) and would skip the owner filter if ever called with `undefined`. The
  only caller passes `user.id` ([summarize/route.ts:34](src/app/api/documents/[id]/summarize/route.ts)),
  so no live exploit — but make the parameter required (or fail closed) so a future caller can't
  reintroduce a gap.
- **TEN-N3 (resolved):** the public-workspace upload path was removed. Anonymous and ordinary
  authenticated users cannot upload; both the server route and Storage table privileges enforce the
  administrator-only boundary.

---

## 8. Method & coverage note

7 auditor agents (one per route family) covered all 33 `src/app/api/**/route.ts` files and their
methods; each traced its RPCs into the SQL. Every load-bearing claim — the `retrieval_owner_matches`
semantics, one representative RPC body, the cache owner-predicate, the purge crons, and the two soft
findings — was **independently re-verified** against source and the live database (project
`sjrfecxgysukkwxsowpy`, region `ap-southeast-2`) before inclusion here. See the companion
**[privacy impact assessment](docs/privacy-impact-assessment.md)** for the data-flow / PHI / cross-border
analysis.
