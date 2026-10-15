# Database drift detection (`npm run check:drift`)

Last updated: 2026-08-18 (migration-history probe, guard-migration contract, index-monitoring ratchet — remediation plan Phase 6)

This repo's worst operational incidents were live-vs-repo schema drift: hybrid
retrieval RPCs silently broken on live for an unknown period, and migrations
recorded as applied whose objects were absent. `search_schema_health()` guards
a curated subset (signatures, 30 required indexes, execution smoke).
`check:drift` generalizes that into a full-inventory comparison of **every**
application-owned object against `supabase/schema.sql`.

## How it works

Three committed artifacts:

| Artifact                                                                     | Role                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260818090000_schema_drift_snapshot_history_probe.sql` | `public.schema_drift_snapshot()` v2 — service-role-only RPC returning the normalized live inventory plus the migration-history probe (supersedes `20260706200000`; also declared in `supabase/schema.sql`; a test enforces byte parity with the latest definer). |
| `supabase/drift-manifest.json`                                               | The expected state: the same snapshot captured from a **from-scratch replay of `supabase/schema.sql`** into a disposable `supabase/postgres` Docker container (`npm run drift:manifest`). Embeds the sha256 of the schema.sql it came from.                      |
| `supabase/drift-allowlist.json`                                              | Known, documented divergence (each entry has a `reason`; `migration_history` entries also need a `guard`). Reported as warnings; anything not listed fails the check.                                                                                            |
| `supabase/search-health-unmonitored-indexes.json`                            | The runtime index-monitoring ratchet: every repo-defined index on a retrieval-critical table that `search_schema_health()` does not monitor, with a reason and disposition (see below).                                                                          |

`npm run check:drift` (needs live service-role env) verifies the project ref,
fails fast if the manifest is stale, calls the RPC, diffs, applies the
allowlist, and exits 1 on unallowlisted divergence. The offline half runs in
`tests/drift-detection.test.ts` under `verify:cheap`: manifest freshness
(sha256), migration↔schema.sql parity for the snapshot function, allowlist
hygiene, and unit tests of the comparison engine.

Inventory coverage: functions (comment/whitespace-stripped `pg_get_functiondef`
md5 + sorted ACLs), indexes (normalized `pg_get_indexdef`), RLS policies
(permissive/roles/cmd/qual/with_check), table shapes (columns sorted by name,
RLS flags, reloptions, ACLs), constraints, triggers, views, extensions, and
storage bucket rows + storage.objects policies.

### Noise sources handled by design

- **Whitespace/comments in function bodies** — `prosrc` is stored verbatim, so
  migration text vs schema.sql text differ trivially; both are stripped before
  hashing (the same trick `20260701140631` used to validate byte-equivalence).
- **Rendering search_path** — the snapshot pins `search_path = ''` so
  `pg_get_expr`/`pg_get_indexdef`/policy quals render fully qualified and
  identically on live and replay.
- **Column ordinal drift** — live tables grew via `ALTER TABLE ADD COLUMN`;
  columns compare sorted by name, not `attnum`.
- **ACL append order** — aclitem arrays are sorted.
- **Duplicate migration-history versions** — history _presence_ is not compared;
  the object categories compare actual object state (history presence proved
  unreliable: see `20260703030000` below). The one thing the check now reads
  from history is the no-statements fingerprint ("Migration-history probe"
  below), and that is compared live-vs-allowlist, never manifest-vs-live.
- **Platform-provisioned extensions** (pg_net, pgsodium, pgmq, …) — extra live
  extensions are informational; missing schema.sql-declared ones fail.
- **Legacy index names** — `alias` allowlist entries assert the live database
  carries the _identical_ name-stripped index definition under a legacy name
  (the machine-checked version of `search_schema_health()`'s `index_aliases`).

### Known coverage limits

What the check does **not** see — established offline on 2026-08-12 while
answering `/issues` `#248` (the 20260705180000 search-health indexes that were
missing on live despite an applied history):

- **Invalid indexes read as healthy.** `schema_drift_snapshot()`
  (`20260706200000`) builds its index rows from `pg_index` via
  `pg_get_indexdef` + an md5 `def_hash`, and never reads `indisvalid` /
  `indisready`. An index left behind by a failed `CREATE INDEX CONCURRENTLY`
  still has a definition, so it compares byte-identical and drift stays green
  while the planner refuses to use it. `20260804110240` checks both flags at
  apply time, so the guard exists for that one migration but not for the
  ongoing probe.
- **No pull request gates on it; a merge to `main` does.** `check:drift` runs
  only from `.github/workflows/live-drift.yml`, and that is three triggers, not
  two: `workflow_dispatch`, a weekly Sunday 18:30 UTC cron, and **every push to
  `main` that touches `supabase/migrations/**` or `supabase/schema.sql`**.
  `AGENTS.md` ("Supabase project safety") names that post-merge run the
  schema-application gate — BOTH `check:drift` and `check:migration-history`
  must be green before a merged migration counts as applied. It still blocks no
  pull request and no release, so drift arriving by any other route (a change
  applied on live by hand, a failed scheduled job) still waits for the cron or a
  dispatch before anything but runtime `search_schema_health()` notices.
  Coverage of the plain missing-index class is genuine: indexes compare by name
  on `table` + `def_hash`, and the object categories of
  `supabase/drift-allowlist.json` are empty — its 20 entries are all
  `migration_history` rows — so a missing index fails the run.

Both are decisions rather than defects: adding validity to the snapshot RPC is
a migration, and raising the cadence spends provider budget. Recorded so the
gap is chosen, not assumed away.

A third limit was closed on the repo side by remediation-plan Phase 6 (2026-08-18)
and is live once migration `20260818090000` is deployed: **history repairs were
invisible.** The check compared object state only, so a `supabase_migrations`
version recorded without executed DDL stayed silent until its objects went
missing. The probe below turns that into a finding.

## Migration-history probe

`schema_drift_snapshot()` v2 (migration
`20260818090000_schema_drift_snapshot_history_probe.sql`; plan §6.1;
evidence `docs/audit/live-drift-forensics-2026-08.md` §1.1/§1.3) adds two keys:

| Key                       | Value                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migration_history`       | `[{version, name, signal}]` — every `supabase_migrations.schema_migrations` row where `statements IS NULL` (`signal: "null"`) or `cardinality(statements) = 0` (`"empty"`), ordered by version. |
| `migration_history_probe` | `"ok"`, `"no_history_table"` (the schema does not exist — true of every `drift:manifest` replay container), or `"no_statements_column"` (very old CLI history table). Never a silent `[]`.      |

Why the fingerprint matters: the CLI records the executed statements on every
`db push`; a row with none is a mark-applied / `migration repair --status
applied` / hand-applied version whose DDL the CLI never ran. §1.1 found the
2026-07-01…02 cluster and the 2026-07-12 batch in that state. §1.3 also found
migrations that **did** record executed DDL yet whose indexes are absent, so
the probe is a second signal beside the object inventory, never a replacement.

How `check:drift` treats it (`scripts/check-drift.ts`):

- The category is **never compared manifest-vs-live** — the manifest holds
  `migration_history_probe: "no_history_table"` and `[]`, and the generic
  category loop deliberately excludes it. Each live row is a finding of kind
  `no_statements` unless a validated `migration_history` allowlist entry covers
  that exact version. Output line: `  ! [migration_history] no_statements
<version> :: <name> (statements null|empty) — …`, captured by
  `live-drift.yml`'s findings grep and routed into the pinned issue.
- A malformed entry (missing/unknown class, guard file absent, wrong ordering,
  pre-contract class on a post-contract version) never matches: the row stays
  a finding and the entry is printed under stale entries with the reasons.
- If the live payload lacks the key (probe not deployed), the run prints an
  `info:` line and the function `def_hash` mismatch on `schema_drift_snapshot`
  itself is the visible "deploy pending" signal — that is the ordinary
  repo-ahead mechanism, not a special case. Deployment is a separately approved
  production migration window (plan approval map, Phase 6.1, after Phase 4).

**Live state after Phase 6.2 (2026-08-19).** The probe went live on production on
2026-08-18 (forensics §3.7) and reported exactly twenty no-statements rows: the
2026-07-01…07-02 cluster and the 2026-07-12 batch of §1.1. All twenty are now
covered — five seeded `superseded` entries (`20260701010000`, `020000`, `030000`,
`060000`, `20260702000000`) and fifteen `validation` entries pointing at the six
Phase 6.2 guard migrations `20260819110000`…`20260819110500` (dropped objects,
comments + retention cron, document foreign keys, operational index shapes, the
`index_generation_id` promotion, function bodies; see forensics §"6.2
completion" for the per-version classification). Those guards were applied to
production by a real `supabase db push` and to staging by the Phase 2 method, so
their own history rows carry statements and can never themselves surface in the
probe. **Any `[migration_history] no_statements` line from now on is therefore
new history repair**, not known backlog: it means someone marked a version
applied without executing it and without shipping a guard — the exact event the
contract forbids. Treat it as a P1 finding: author the guard first, never
allowlist bare. Versions the live probe does not report surface as stale
entries, which is how a wrong seed is caught; against staging every
`migration_history` entry reads stale by design (staging's chain was replayed
with statements), so never run `--prune-stale` there.

## Migration-history alignment (`npm run check:migration-history`)

A second, separate step of `.github/workflows/live-drift.yml`, added by Phase 0
(PR #1939). It compares the versions in `supabase/migrations` against the versions
recorded in live `supabase_migrations.schema_migrations` and fails when live holds
a version with no local file — the state that makes a hosted Supabase Preview
branch fail with "Remote migration versions not found in local migrations
directory". It is not the probe above: the probe asks whether an applied version
executed its DDL, this asks whether an applied version exists in the repo at all.

**It could never pass on this project until 2026-08-20.** The original
implementation read the history table straight through PostgREST with
`Accept-Profile: supabase_migrations`, and this project has never exposed that
schema to the Data API, so the read returned `406 PGRST106` every time. The defect
stayed hidden because the drift comparison ran first and always failed, leaving
this step `skipped`; Phase 6.2 cleared the last drift finding on 2026-08-19 and the
step ran for the first time ever, becoming the sole reason the job still concluded
`failure` — and therefore the sole reason pinned issue #1963 stayed open against a
clean database.

The read now goes through **`public.migration_history_versions()`** (migration
`20260820120000`), a `stable` `security definer` function with `search_path` pinned
to `''`, granted to `service_role` only, that returns `{probe, versions}` for every
row of the history table. It is deliberately the smallest possible authority:
exposing `supabase_migrations` to the Data API would widen the public API surface
of a clinical project for one weekly read, and routing through the management API
would put an account-scoped access token into CI.

The Accept-Profile read is retained as a fallback for any environment that does
expose the schema, and is tried **only** when the RPC itself is absent. Every other
outcome is an error, including a database with no history table at all
(`probe: no_history_table`) — a check that reports "aligned" because it could not
look would be worse than the red job it replaced. When neither path works the
failure names the remedy: apply `20260820120000` through the normal linked
migration workflow. Pinned by `tests/migration-history-alignment.test.ts`.

**Local-only versions fail the run too (2026-09-02).** A version in
`supabase/migrations` that live history does not hold is a migration that merged
and never applied, and it used to be printed as `Local-only (pending apply)`
while the step exited 0. That mattered because `AGENTS.md` makes _both_ this
check and `check:drift` the post-merge proof that a merged migration reached
production, and `check:drift` compares the object inventory only — views,
tables, indexes, policies, triggers, functions, extensions, constraints and
storage buckets. A migration whose effect lies outside that inventory leaves no
other signal at all:

| Effect class                 | Example in this repo                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| `pg_cron` job rows           | `20260901033250` unschedules and reschedules the four retention purge jobs |
| `COMMENT ON`                 | the catalog comments guarded by `20260819110100`                           |
| `ALTER DATABASE … SET`       | session defaults; nothing in the snapshot reads them                       |
| Data-only fixes              | backfills and corrective `update` statements                               |
| Grants on non-public schemas | `20260901033250` grants on schema `cron`                                   |

So the check now fails on local-only versions and names them. Because the
push-triggered `live-drift` run starts before the Supabase integration's apply
(measured at 34 s), it re-reads live history up to four times, 30 s apart,
before calling a version unapplied; `npm run check:migration-history --
--allow-pending` restores the old informational behaviour for a deliberate
pre-apply check. Do not use that flag in the post-merge gate — the pending
versions are exactly what it exists to catch.

## Applied-migration immutability (`npm run check:migration-immutability`)

`supabase/applied-migration-hashes.json` records the sha256 of every migration this repository has
shipped, newlines normalised. The guard fails when a sealed file's bytes change, when a sealed file
disappears, and when a migration exists that has never been sealed. It runs as a named gate in
`verify:full` and in CI's `static-pr` job beside the hosted migration-role guard, and also inside the
offline unit suite via `tests/migration-immutability.test.ts`, so it fails in review rather than
after merge. Until 2026-09-19 only the unit-suite route existed (`#CNSDBJ`), which meant the guard
was in no gate anyone could name or run on its own.

**Why a separate gate was needed.** Migration replay proves the chain is internally consistent with
itself, and `supabase/schema.sql` is regenerated from the same files, so an edit to an applied
migration leaves both of them agreeing — with each other, and with nothing that exists. Only the
post-merge live `check:drift` disagrees, and only for the objects that happen to embed the edited
value. That is precisely how 2026-09-16 happened: three applied migrations were regenerated to
absorb new catalogue records, every offline gate stayed green, and production kept definitions the
repository had stopped describing. `tests/site-content-epoch-zero-freeze.test.ts` pins that specific
identity; this guard covers every other migration.

**A failure is not an instruction to reseal.** A migration that has landed on `main` has been
applied, and the integration never re-runs a version it has seen, so editing the file cannot change
the live database — it changes only what this repository claims about it. A live schema change
belongs in a NEW migration.

`npm run migrations:seal` rewrites the manifest and prints every already-shipped entry whose hash it
changed, so the exception lands in front of a reviewer rather than passing silently. The one
legitimate use is restoring a file to the bytes production actually holds, which is what introduced
this guard.
Even then, a reseal needs the owner's explicit permission for that specific reseal (`AGENTS.md`,
"Supabase project safety").

## Guard-migration contract

**Rule (also in `AGENTS.md`, "Supabase project safety"): any mark-applied
version, `supabase migration repair --status applied`, hand-applied SQL that
is later recorded as a migration, or other history repair MUST ship a
fail-fast validation migration in the same change, following
`supabase/migrations/20260804110240_restore_rag_search_health_indexes.sql`
exactly.** Such a guard:

- **validates, never builds** — no `create index`, no `create or replace` of
  the objects it guards; it checks presence (`to_regclass` /
  `to_regprocedure`), `pg_index.indisvalid AND indisready` for indexes, and a
  normalized `pg_get_indexdef` / `pg_get_functiondef` match against the pinned
  canonical definition;
- uses `set local lock_timeout` / `set local statement_timeout` (never bare
  `set`), and raises one `raise exception … Missing: %; Invalid: %;
Mismatched: %` naming every failure;
- is marked applied only after the live validation passes, and its file name
  is what the allowlist entry points at.

Allowlist entry shape (`supabase/drift-allowlist.json`):

```json
{
  "category": "migration_history",
  "kind": "no_statements",
  "key": "<14-digit version>",
  "reason": "why the row has no executed DDL (mark-applied after prebuild, repair, rename …) — > 20 chars",
  "guard": { "class": "validation", "migration": "<later>_<stem>.sql", "objects": ["<index or function name>", "…"] }
}
```

| `guard.class` | Meaning                                                                                                                                                    | Machine check (`check:drift` structural + `tests/migration-history-guards.test.ts` object-level)                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `validation`  | A later fail-fast guard migration proves the listed objects. **Required for every version ≥ `20260818000000`.**                                            | file exists, version > key, contains `raise exception`, creates no index, mentions every `objects` name; `objects` non-empty                     |
| `superseded`  | A later migration re-created every listed object with recorded statements (squashed baseline, renumber, hotfix later codified). Pre-contract history only. | file exists, version > key, `create … <object>` for every listed object in the guard file **and** in the version's own file; key < contract date |
| `no_ddl`      | The version's own file has no effect (comments only / `select 1;` placeholder).                                                                            | `guard.migration` is the version's own file; stripped body is empty or `select 1;`                                                               |

Retiring an entry: when a version is genuinely re-recorded with statements (or
history is squashed and the row disappears) the entry shows as stale on the
next run — delete it. Never widen a class or drop `objects` to make an entry
pass; the finding is the point.

## Chain-vs-mirror parity (`npm run check:chain-mirror-parity`)

**Extensions are compared, not excused.** `check:drift` treats an extension present on the live
side but not in `schema.sql` as platform provenance and prints it as an info line — right for the
live gate, where Supabase provisions `pg_net` and `pgsodium` that no migration creates. On this
comparison the "live" side is the migration chain, which is our own code, so the parity script
re-promotes those to `unexpected_live` findings. That re-promotion has already paid for itself:
it surfaced `pg_cron`, which
`20260901033250_enable_staging_privacy_retention_schedules.sql` creates and `supabase/schema.sql`
did not declare, so under the inherited rule the pair reported nothing at all. **That gap is now
closed** — `e15534b830` (2026-09-12) added the same `create extension if not exists pg_cron with
schema pg_catalog` statement to the mirror, so the two sides agree and `pg_cron` is not, and must
not be, allowlisted. An extension the emulator image genuinely provisions is a different thing and
belongs in `supabase/chain-mirror-allowlist.json` as a reviewed entry, one at a time; `pg_net` is
the only one.

`check:drift` compares **live** against `supabase/schema.sql`. CI's `db-reset-verify`
proves the migration chain **applies** (`supabase migration up --local`) and that the
drift manifest is **not stale** (committed vs generated `schema_sha256`). Nothing
compared the _result_ of the chain against the mirror, so a migration whose function
body or policy predicate diverged from `schema.sql` passed every pre-merge gate.

That is `#QCNE6N`, and it is not theoretical. On 2026-09-01 migration
`20260831100000` (PR #2477) redefined `public.correct_clinical_query_terms(text,real)`
with a duplicated predicate and `schema.sql` was never updated to match. Every
pre-merge gate stayed green; the post-merge `live-drift` run went red on `main`
(`def_hash` manifest `e2356565` vs live `2ebaf978`). Behaviour impact was nil — the
duplicate predicate is a boolean no-op — but it cost a red daily alarm and a
remediation PR, and it is the second occurrence of this class after `#316`.

**How it runs.** In `db-reset-verify`, after the replay and after `drift:manifest`
regenerates the manifest from this PR's `schema.sql`:

- the **chain** side is `public.schema_drift_snapshot()` read out of the Supabase
  emulator database the migrations just built;
- the **mirror** side is that regenerated manifest's `snapshot`, which is a
  `schema.sql` replay — so no second replay is built;
- `scripts/check-chain-mirror-parity.ts` compares them with `compareDriftSnapshots`,
  the same comparator the live gate uses. Two comparators would eventually disagree
  about what "different" means, and then one of them would be wrong.

`migration_history` and `migration_history_probe` are stripped from both sides **by
construction**, never allowlisted: a `schema.sql` replay has no `supabase_migrations`
schema, so the category can only produce noise here. It stays the live gate's business.

**Known asymmetry.** The two sides come from different images — the emulator versus
the pinned bare `supabase/postgres` — so some reported difference is platform
provenance rather than real divergence. Building both sides identically was tried and
does not work: a mirror database created inside the emulator has no `auth` schema for
`schema.sql`'s `references auth.users(id)` columns, and reproducing the chain inside
the bare image means driving the whole chain by hand rather than through
`supabase migration up`.

**BLOCKING since 2026-09-18.** The gate landed report-only, printing divergences rather
than failing, because the existing set (backlog item 10 above, plus schema.sql-only
storage buckets) had never been measured, and blocking on an unmeasured set just
teaches people to ignore a red check. `tests/chain-mirror-parity.test.ts` gave that
phase an expiry of **2026-12-01**, after which the suite would go red until it ended.

It ended early, because the measurement came in. The whole migration chain was
replayed, its `schema_drift_snapshot()` captured, and compared in blocking mode against
a freshly regenerated manifest: **zero divergence** across tables, views, functions,
indexes, policies, constraints, triggers and storage buckets, with the single
allowlisted `pg_net` entry. The predicted ~13 keys do not exist. Both measurements —
CI's first real run on 2026-09-02 and the local one on 2026-09-18 — agree.

`tests/chain-mirror-parity.test.ts` ties the mode to the failure tolerance: blocking
mode and `continue-on-error` cannot coexist, and it reads the mode from the step's run
lines with YAML comments stripped, because a comment that quotes the flag makes a
deleted flag undetectable. That is not hypothetical — on 2026-09-18 removing the real
flag left every test in the file green until the detection was narrowed.

**If a divergence ever appears**, it is a finding before it is an allowlist entry: fix
the mirror or fix the migration, and only excuse it here when it is genuinely the
two-different-images asymmetry, with a reason recorded.

**`supabase/chain-mirror-allowlist.json` is not `supabase/drift-allowlist.json`, and
they must never merge.** An entry in the live allowlist blinds the weekly live-drift
alarm. An entry here only says "the chain and the mirror are knowingly different in
this one place", and the live gate still catches the consequence post-merge. A test
asserts neither script reads the other's file.

> Note for whoever adds this to `verify:cheap` later: the matcher in
> `check-gate-manifest.mjs` that pairs a local gate with its CI step is anchored to a
> single-line `run:` invocation, and this gate's CI step uses a multi-line `run: |`.
> It would not register as CI coverage without changing that matcher first.

## Runtime index-monitoring ratchet

`search_schema_health()` monitors a curated `required_indexes` list (30 names in
the latest definer, `20260819100300_monitor_restored_retrieval_indexes.sql`,
which appended the eight deferred monitor candidates to the 22 of
`20260706010000_search_schema_health_m13_guard.sql`) plus `index_aliases`; the
20 indexes absent on live in 2026-08 were invisible to it.
`tests/search-health-index-coverage.test.ts` now requires that **every
repo-defined index on the retrieval-critical tables** — `documents`,
`document_chunks`, `document_index_units`, `document_embedding_fields`,
`document_memory_cards`, `rag_retrieval_logs` — is either monitored (in
`required_indexes` or an alias value) or listed in
`supabase/search-health-unmonitored-indexes.json` with a `reason` (> 20 chars)
and a `disposition`:

- `accepted-unmonitored` — absence would degrade an operational path
  (ingestion bookkeeping, FK support, listings) but not clinical retrieval;
  `check:drift`'s full index inventory still reports it missing.
- `monitor-candidate` — retrieval-facing (`*_search_idx` / `*_terms_idx` GINs)
  or absent on live per forensics §1.3 (`document_chunks_anchor_idx`,
  `document_index_units_heading_path_idx`,
  `documents_registry_projection_lookup_idx` — the three of the 20 that sit on
  these tables; the other 17 are on tables outside this scope). The disposition
  still exists, but **no entry carries it now**: `20260819100300` was the Phase
  4.4 migration that decided all eight, so the file's 36 remaining entries are
  every one `accepted-unmonitored`. A new flagged index gets this disposition
  and its own deciding migration.

"Repo-defined" is computed two ways and unioned — an order-aware replay of
every `create/drop index` in `supabase/migrations/`, and the manifest's
`snapshot.indexes` — so a schema.sql-only index (drift backlog item 10) or a
migration-only one cannot hide. Constraint-backed `*_pkey` indexes are exempt
(the constraint inventory guards them). The list is also checked for stale
entries (index no longer defined, or now monitored) and duplicates.
`required_indexes` changes travel by migration only, never by editing
`schema.sql`; the test cross-checks the two copies. Seeded 2026-08-18 with 44
entries (8 monitor candidates); the test failed with exactly those 44 names
before the list existed.

### Workflow

- Change `supabase/schema.sql` → run `npm run drift:manifest` (Docker) in the
  same PR. The freshness test fails otherwise. The helper uses a digest-pinned,
  already-cached image (`--pull=never`), an ephemeral loopback-only port, and a
  worktree ownership label before it removes any same-named container. Pulling
  a missing image is a separate, explicit registry operation. This also
  continuously proves schema.sql replays from scratch — which it did **not**
  before 2026-07-07 (`document_index_units` was declared after its first
  validating reference).
- Live drifts (check:drift red) → either codify live state (migration +
  schema.sql + manifest regen) or fix live **through an approved migration**.
  Never raw SQL against live; that is how this incident class started.
- New known-divergence → allowlist entry with a reason and a backlog line here.
- After the pending-migration backlog lands, delete the matching allowlist
  entries; check:drift reports stale entries so they cannot silently linger.

## 2026-07-07 baseline audit (three-way: live vs schema.sql vs migration chain)

Both repo lineages were replayed into scratch containers and compared with the
live inventory. 166 divergent keys, fully classified:

- **Reconciled in this PR (schema.sql/migrations only, live untouched):**
  replay-order fix; `20260707000000_codify_live_observed_drift.sql` codifying
  15 live-only columns (`document_images` ×7, `document_index_quality` ×6,
  `ingestion_job_stages` ×2 — worker-written, branch DBs broke without them),
  3 `content_not_blank` NOT VALID checks, autovacuum reloptions on 5 RAG
  tables, `content_hash` nullability alignment, 4 live-only functions
  (`set_owner_id_from_auth_uid` + rag_queries/misses triggers,
  `purge_expired_rag_queries`, `correct_clinical_query_terms`,
  `invoke_ingestion_worker`) and 2 ACL tightenings; schema.sql function/policy
  text realigned to the migration-chain truth for `analyze_rag_tables`,
  `claim_indexing_v3_agent_jobs`, `is_committed_artifact_generation(uuid,jsonb)`,
  `match_document_memory_cards_hybrid`, and 6 owner-read policies (operand
  order only).
- **Allowlisted (124 entries)** — see `supabase/drift-allowlist.json`; backlog
  below.

## Reconciliation backlog

Ordered; each item removes allowlist entries when it lands. Items touching the
live project need explicit operator approval.

> **2026-07-08 update:** the safe pending migrations were **applied to live**
> (`20260706010000`, `20260706130000`, `20260706200000`, `20260707000000`, and
> `20260708000000` re-applying `20260703030000`'s storage-index effects — items 1
> and 2 below are DONE, verified byte-faithful + site retrieval green).
> `20260705210000` was **NOT applied and was neutralized** — the investigation
> found live had diverged _forward_ from its retrieval bodies (item 0, new).
> Live is under active concurrent multi-session editing, so the allowlist is a
> point-in-time snapshot needing periodic regeneration.
>
> **2026-07-10 update:** local `check:drift` surfaced five repo-ahead live debts
> for the July 8 hardening batch: fail-closed `retrieval_owner_matches`, R17's
> one-open-ingestion-job index, and R5's document metadata deep-merge helpers /
> `commit_document_index_generation` body. These are now allowlisted as known
> pending live-apply work. Applying them to live remains an explicit
> operator-approved migration action.

0. **NEW — forward-codify the live-ahead retrieval RPCs** (was the "apply
   20260705210000" item, inverted). **Staged runbook:
   `docs/forward-codify-retrieval-rpcs-workorder.md`** — the read-only capture
   query (`scripts/sql/capture-live-retrieval-rpcs.sql`), the fill-in-the-blanks
   migration skeleton, the byte-faithful validation, and the allowlist cleanup;
   a guard test (`tests/forward-codify-retrieval-targets.test.ts`) keeps the
   capture query and this allowlist in lockstep. The capture + apply steps still
   need a quiescent live DB and operator approval. Live carries newer raw-SQL retrieval bodies
   than the repo: `match_document_chunks` (hnsw.ef_search=100 plpgsql wrapper),
   `match_document_chunks_text` / `match_document_table_facts_text` (richer
   multi-strategy), `match_document_chunks_hybrid` (left-join quality_score),
   plus `match_documents_for_query`, `get_related_document_metadata`,
   `match_document_memory_cards_hybrid`, `repair_strict_enrichment_gate_batch`.
   Applying the OLD `20260705210000` bodies would regress live, so it is
   neutralized. Codify the **live** bodies into schema.sql + a new migration (a
   generation script, not hand-editing — the bodies are complex and actively
   churning) so the repo matches live and a `db push` never regresses it. These
   are the currently-allowlisted retrieval entries.
   - **Partially reconciled 2026-07-08:** `retrieval_owner_matches` was in this
     group by mistake — its **body is identical** to schema.sql; it only drifted
     on `search_path` (live `pg_catalog` vs repo `pg_temp`) and ACL. The
     search_path half is now codified into schema.sql + the manifest `def_hash`
     (verified read-only against live via `schema_drift_snapshot`); only the
     PUBLIC-execute ACL remains allowlisted, same as `search_document_chunks`.
1. ✅ **DONE 2026-07-08** — applied `20260706010000`, `20260706130000`,
   `20260706200000`, `20260707000000` to live (verified). `check:drift` can now
   run against live once a service-role key is available in the environment.
2. ✅ **DONE 2026-07-08** — `20260703030000`'s effects (recorded-but-absent on
   live) re-applied via `20260708000000_reapply_storage_cleanup_jobs_indexes`;
   live storage_cleanup_jobs indexes now match schema.sql.
   2a. **Apply the remaining July 8 hardening batch to live**: run the approved
   migration workflow for `20260708160001_retrieval_owner_matches_fail_closed`,
   `20260708170000_ingestion_jobs_one_open_per_document`, and
   `20260708310000_r5_document_metadata_merge`. Remove the matching allowlist
   entries for `retrieval_owner_matches`, `ingestion_jobs_one_open_per_document_uidx`,
   `jsonb_merge_deep`, `apply_document_metadata_patch`, and
   `commit_document_index_generation` after `check:drift` verifies live parity.
3. **Codify the remaining live-only functions**: `get_visual_evidence_cards`,
   `repair_enrichment_quality_batch`, `run_all_visual_eval_cases`,
   `run_visual_eval_case` (same pattern as `20260707000000`).
4. **Authenticated-grant posture decision**: live revoked the authenticated
   Data API grants on 17 tables (fail-closed hardening; the owner-read RLS
   policies are currently dead on live) while schema.sql still declares them.
   Either codify the revokes (schema.sql + tests + migration) or restore the
   grants live.
5. **PUBLIC-execute revokes**: 4 security-invoker functions retain default
   PUBLIC execute on live (`detect_legacy_ivfflat_indexes`,
   `document_summary_text`, `search_document_chunks`,
   `set_document_embedding_field_content_hash`).
6. **`document_label_metadata` direction**: schema.sql is AHEAD (hidden-label
   filtering added without a migration). Ship the migration or revert.
7. **Index estate**: rename 10 legacy-named live indexes to schema.sql names;
   decide the 24 schema.sql-declared indexes absent on live (recreate vs
   remove — includes `documents_search_idx`, `document_chunks_anchor_idx`,
   `documents_owner_content_hash_unique_idx`); drop ~45 live-only duplicate
   indexes after `pg_stat_user_indexes` scan verification; reshape 3
   (`import_batches_status_created_idx`, `ingestion_jobs_document_status_idx`,
   `ingestion_jobs_status_next_run_idx`).
8. **Constraints**: ~~add `ingestion_job_stages_job_id_fkey` to live~~ —
   **reversed (R24e, 2026-07-08):** the FK was **removed from `schema.sql`**
   (migration `20260708140000`) instead of added to live. Live has ~253 orphan
   stage rows and 0 rows whose `job_id` resolves to an `ingestion_jobs` row, and
   the column holds `indexing_v3_agent_jobs` ids — so adding + VALIDATE-ing the
   FK would destroy stage-log history and break the edge agent (see
   `docs/ingestion-state-machine.md` R24e). Allowlist entry removed. Still open:
   align the `rag_visual_eval_*` document FK definitions.
9. ~~**`invoke_ingestion_worker`** hardcodes the project URL~~ — closed: the
   function was retired by `20260926041000`.
10. **Migration-chain fidelity** (affects Supabase Preview/branches, not
    live): 13 keys where the chain diverges from schema.sql — buckets are only
    created by schema.sql, `documents`/`ingestion_jobs` updated*at trigger
    variants, post-legacy-drop embedding-fields index set,
    `document_chunks_content_trgm_idx` shape, `rag_visual_eval*\*` shapes. That
    count is a 2026-07-07 hand measurement and has never been re-measured; the
    chain/mirror parity gate above is what re-measures it, on every
    database-touching PR.
