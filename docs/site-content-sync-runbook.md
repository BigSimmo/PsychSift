# Site-content publication and synchronization

This runbook owns the source-only Task 3 control plane for public registry site content. Legacy rows in `clinical_registry_records`, `medication_records`, and `differential_records` remain owner-scoped drafts and provenance. They are never public read authority merely because they exist.

## Public lifecycle

1. An administrator POSTs a bounded command to `/api/site-content/publications`. The service client performs only the P03 source/digest preflight; the mutation uses that request's validated Bearer or SSR-cookie user-context client. SQL requires `auth.uid()`, locks that exact `auth.users` row, derives administrator authority from immutable app metadata, and writes the actor plus database-time authorization attestation. Service-role mutation and caller-supplied actor, record, or render JSON are rejected. The presented token must also carry a multi-factor (`aal2`) sign-in from the last 15 minutes, the same check document upload uses, or the route answers 403 before any RPC (repository audit F-12, 2026-10-19).
2. The RPC inserts an immutable ownerless publication, advances the singleton change epoch once, marks the exact logical head pending, and inserts one ordered outbox event atomically.
3. The deterministic offline planner combines the exact P03 static manifest and records with the exact current public dynamic population. A reviewed plan is content-addressed and handed to its event through `record_site_content_sync_event_plan`.
4. The JWT-protected `site-content-sync` Edge Function first records one database-clock, five-minute admitted invocation, then claims one plan-ready event at a time, reclaims expired processing leases with a fresh token/generation, and heartbeats during provider work. Every heartbeat, stage, failure, and invocation terminal is fenced. It calls the embedding provider only for added or changed rows that cannot reuse a compatible vector. Missing, expired, unterminated, stale, or latest-failed invocation evidence makes readiness stop.
5. Staging writes every planned row, including unchanged carry-forward and retirement tombstones bound to their immutable retirement publications, into immutable release-scoped artifacts. The only accepted physical/provider dimension is 1536. SQL recomputes semantic fields, vector dimensions/identity, counts, provider-free checks, and dynamic/release digests; activation separately binds the complete current head population to the same immutable plan and exact content-addressed P05 recovery receipt.
6. All seven public registry GET routes read only `read_site_content_public_records`. The migration freezes the exact P03 dynamic seed population into the content-addressed epoch-zero release. Bundled TypeScript seeds are used only if the database has no retained active release identity; an epoch-zero rollback serves the frozen database rows even though the RAG lane remains uninitialized. After initialization, a missing, pending, or inconsistent record is omitted; no owner row or seed fallback is allowed.

## The epoch-zero freeze is immutable

`supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql` froze 843 records and 281 registry baselines into the epoch-zero release, and the release id `e4a1dd29-14f6-556c-8fb7-f4f947d8b846` is derived from that population's digest. It was applied to the live database on 2026-09-11. **The Supabase integration applies only migration versions it has not seen, so editing that file — or `20260824123000`, `20260830121000` or `20260916103000`, which pin the same id — changes nothing on live.** It changes only what this repository claims live contains.

That is not theoretical. On 2026-09-16 the frozen population was regenerated to take in 17 new service records (PR #2814). The identity moved to `91ceaa8d-470c-5661-8ce6-980c2a1bb137` with 860 records, production kept `e4a1dd29…` with 843, and the post-merge `live-drift` gate went red on `site_content_release_records_check1` and `site_content_sync_state_transition_pointer_check`. Every offline check still passed, because a replayed database and the schema mirror agreed with each other — the silent-divergence shape this drift programme exists to close. It was reverted.

The regeneration also retargeted three of the four files that pin the id and missed `20260916103000`, so a replayed database would have carried bootstrap `91ceaa8d…` while `read_site_content_public_records` still filtered `e4a1dd29…` and the epoch-zero branch of every public catalogue read matched nothing at all. No gate saw that: the replay's own self-check is consistent within the rewritten set, and `check:drift` compares live rather than a replay.

So:

- Catalogue growth and revision reach live through the publication pipeline above, never by regenerating the freeze.
- A SQL lookup that must serve records added after the freeze — `site_content_registry_baseline` is the one that matters — is refreshed by a **new forward migration**, which the integration does apply.
- `npm run bootstrap:refresh -- --check` reports how far the catalogue has moved from the freeze, and `--write` is refused. Read what `--check` proves precisely: it re-derives each frozen entry **from its own frozen record**, so it shows the script's formulas still reproduce the freeze. It does not prove the freeze matches the catalogue, and no gate runs it.
- `tests/site-content-epoch-zero-freeze.test.ts` pins the applied id, digest, counts and both frozen blob hashes across all four migrations, the schema mirror and the drift manifest, and sweeps every file under `supabase/migrations/` so a migration that does not exist yet cannot introduce a second identity. If it fails, restore the migration rather than updating the constants.
- `npm run check:migration-immutability` is the general form of the same rule, covering every migration rather than this one: see [`docs/database-drift-detection.md`](database-drift-detection.md) § Applied-migration immutability.

## Verification of the freeze belongs at write time, not on the read path

**A request-path read may never re-verify an immutable corpus.** Integrity of immutable data is
proven once — when it is written, when the migration that installs it applies, or on the schedule the
health check already runs on — and a read then relies on that proof. A read that re-derives the proof
is paying, on every page view, for a property that cannot have changed since the last page view.

This is not a style preference. It cost four seconds per public catalogue request for a week; the
mechanism, the numbers and the timeline are in
[`docs/audit/2026-09-16-catalogue-read-latency.md`](audit/2026-09-16-catalogue-read-latency.md).
`read_site_content_public_records` compared the stored `release_digest` with a freshly computed
`site_content_bootstrap_digest`, twice per call — once directly and once through
`site_content_current_transition_kind` → `site_content_retained_bootstrap_valid` — and each
comparison canonicalised the whole 843-record frozen population, 9.52 MB and 164,820 JSON nodes,
through a recursive plpgsql function. The work is identical for an 8 KB single-record response and
for the entire catalogue, because it happens before the read knows what was asked for.

**Three protections already held the property that check was re-proving, and each of them is either
free or already paid for:**

- **The rows are immutable by trigger.** `site_content_release_records_immutable`
  (`supabase/schema.sql:12722-12724`) refuses every `UPDATE` and `DELETE` on the release records.
  Nothing a reader can observe is able to change between one read and the next.
- **The release id is cryptographically bound to the digest.** The reader accepts only the pinned
  retained bootstrap ids, and `r.id = public.site_content_release_id(r.release_digest, 0,
'bootstrap-v1')` (`supabase/schema.sql:16388`) hashes a four-key object in microseconds. The
  `site_content_releases` row is mutable — state transitions need it to be — but its
  `release_digest` cannot be rewritten to bless a different population without producing a different
  id, which the reader would then reject.
- **The population was verified transactionally when the migration applied.**
  `supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql:907-913` compares both
  the digest and the row count in the same transaction as the seed `insert`, and raises
  `site_content_bootstrap_population_mismatch` rather than committing a corpus that does not match.
  Applied live 2026-09-11. A migration that fails there leaves nothing behind.

So the per-read hash detected nothing that a trigger did not already prevent, except one case it was
never the right tool for: a row **added** to a frozen release. An `INSERT` is not covered by an
`UPDATE`/`DELETE` trigger, and re-hashing 9.5 MB on every request catches that only after it has
happened. The answer to a gap in a structural seal is a better seal, not a detector on the hot path.

**What this means in practice:**

- A read may test cheap, bounded invariants — an id equality, a content-addressed binding, an
  index-only `count(*)` against a stored expected count. It may not aggregate, canonicalise or hash
  a whole release, and it may not sweep every row of one.
- Verification that must walk the corpus lives in `read_site_content_health()`, in the mutation RPCs
  (`activate_site_content_release`, `rollback_site_content_release`, and the plan and staging paths),
  and in the applying migration. Those are operator-driven, rare, and already carry the cost
  deliberately.
- A read stays **fail-closed**. Making a check cheaper must never make a suspect population
  readable: if the cheap invariants do not hold, the read still withholds records and reports the
  snapshot as unavailable rather than serving clinical content it cannot vouch for.
- When a proof moves off the read path, say in the migration header where it now lives, so the next
  reader of that SQL does not restore it for safety's sake.

**How much of this a gate enforces.** Today, nothing — this rule is enforced by review only. A
static gate that refuses the first half of that first bullet automatically (a read path that reaches
a whole-corpus digest helper, hashes a corpus-derived expression, or aggregates over a corpus table
in a query that scans every row of it) is written and lands in the follow-up change that carries it.
It deliberately cannot land before the migration this rule was written for, because it goes red on
exactly the defect that migration removes. When it arrives, this paragraph gains its name, the
shapes it permits, and the holes its own header enumerates — a per-row sweep with no aggregate
(root cause 4 of the audit) among them. A green gate will mean no known offending shape, not a cheap
read.

The same rule reads forward as a scaling limit. `site_content_canonical_json` is recursive plpgsql
with one invocation per JSON node, and every fingerprint in this control plane goes through it. That
is affordable at activation and intolerable per request, and it stops being affordable at activation
too once a release is large enough.

## Source-only planning

The CLI reads no environment or live state and is a dry run unless `--write` is supplied:

```sh
node scripts/run-tsx.mjs scripts/sync-site-content-corpus.ts \
  --manifest <static-manifest.json> \
  --dynamic <exact-public-population.json> \
  --reconciliation <reviewed-plan.json> \
  --out <plan.json>
```

Initial adoption requires the exact content-addressed reconciliation file. It contains one trusted canonical-public snapshot per logical group and one disposition per locked source row, so duplicate owner rows share a logical id but retain unique source identities. Each group has exactly one `adopt`; every `identical_duplicate` must independently equal the trusted snapshot and every `retire` must independently differ. SQL re-derives every source record and governance hash when recording the plan and again at initial activation.

Initial adoption is deliberately ordered and must not be compressed into one privileged script:

1. Disable or hold the worker.
2. Generate and independently review the deterministic reconciliation plan offline.
3. Have an authenticated administrator POST the exact `{ "action": "record_reconciliation", "plan": ... }` command. The database derives the reviewer from `auth.uid()`; the CLI never accepts an actor or administrator token.
4. Publish every `adopt` disposition in deterministic plan order using the persisted plan digest.
5. Capture the final current `changeEpoch` and every pending event sequence.
6. Regenerate the exact final public population and event plan, attach that content-addressed plan to every pending event, and verify its counts and digest.
7. Enable the worker, claim and process all events, stage the candidate, and activate it.

The guarded source write path additionally requires `--write`, matching `--project-ref` and `--confirm-project-ref`, `--expected-state-digest`, `--expected-plan-digest`, `--recovery-evidence`, `--provider-authorization`, and `--event-sequence`. Initial-adoption plans require `--reconciliation`; only the guarded initial-adoption write also requires the matching `--expected-reconciliation-digest`. Post-adoption plans and writes require both reconciliation arguments to be absent so the reviewed plan retains its null reconciliation identity. The CLI performs all offline identity checks before loading project/provider/Supabase modules or writing `--out`, then records only the immutable plan/event handoff. Task 3 source verification does not exercise that live path. A retirement input must also carry the exact logical-id to retirement-publication mapping so the tombstone, event plan, stage, and activation bind the same immutable publication.

## Queue operations

- Due `pending`/`retry_pending` events and expired `processing` leases with an immutable recorded plan are claimable in event-sequence order. Each reclaim increments the generation and replaces the token, so an old ABA mutation remains a zero-row result.
- A newer publication terminally supersedes older pending/retry/processing/ready work and abandons its candidate release. A current head whose epoch is newer than the served release remains fail-closed whenever it still has a pending-event pointer, including after quarantine or supersession. It becomes readable only after a release representing that exact current head activates and clears the pointer.
- A collection read is all-or-nothing while any head is outstanding; it never exposes a partial clinical catalogue. A bounded unaffected detail may continue to use the retained release, while an affected detail is withheld even if its event pointer is missing.
- Failures use fixed codes only: `provider_failure`, `poison_payload`, or `staging_failure`. Content, actor/owner identity, vectors, and provider responses must never enter logs.
- Backoff uses database time and is bounded. The fifth failed claim is quarantined. The prior immutable release remains retained for rollback, but the affected stale bytes are not presented as current while the newer head is unrepresented.
- There is no scheduler in Task 3. Deploying/invoking the worker and configuring scheduler credentials/cadence are hosted follow-up gates.

## Offline freshness and readiness

CI and local source verification use only the committed, content-free evidence fixture:

```sh
node scripts/run-tsx.mjs scripts/check-site-content-freshness.ts --evidence tests/fixtures/site-content/release-evidence-current.json
```

The CLI validates exact population identity sets, immutable administrator attestation aggregates, supersession closure, governance, digests, queue ages, leases, and fresh successful invocation evidence. Its deployment SHA is provenance only; live currentness is bound solely by the server-only `SITE_CONTENT_EXPECTED_STATIC_MANIFEST_DIGEST`. It emits only fixed reasons and the capped public health projection. It reads no environment, Git, provider, network, or Supabase state in offline mode.

Authorized deep health and unauthenticated readiness run the service-only aggregate health RPC only after the ordinary Supabase probe succeeds. Shallow health remains database-free. A healthy exact retained bootstrap without an expected digest reports `disabled`; initialized `current` and valid `updating` are ready. Integrity, static mismatch, retry/quarantine, over-age work, lease, or worker failures return 503 without raw RPC evidence, actor/worker identities, epochs, full digests, routes, content, or provider errors.

## Activation and rollback

Callers must validate recovery evidence with P05 `assertRecoveryReadinessForOperation(..., "site_release", projectRef)` and parse the exact content-addressed activation or rollback receipt before the mutation RPC. SQL independently recomputes the receipt identity before insertion. The singleton stores `active_transition_receipt_id`; activation and rollback change that pointer atomically with the active release and decision watermark. Activation closes only matching ready events and retains the previous release and its rendered bytes.

Rollback accepts only the retained predecessor named by the exact currently pointed activation receipt. It is rejected while a candidate, live event, pending pointer, or head newer than the served watermark exists, and a rollback receipt cannot itself be rolled back. The canonical `change_epoch` is monotonic; rollback sets `served_change_epoch` to that current epoch, keeps completed events and heads untouched, and stores the rollback receipt pointer. A rollback to the retained epoch-zero release remains `initialized = true`: reads use its frozen database bytes, never bundled seeds, while health and RAG remain unavailable because the all-zero manifest is identity rather than deployment authority. A later publication advances the canonical epoch and becomes exact pending work; after it is staged, activation may move forward from the validated rollback transition. Rollback never reconstructs, re-embeds, copies mutable drafts, deletes the failed release, decrements the publication epoch, reopens events, or reuses a lease.

## Local verification and residual gates

`npm run drift:manifest` replays `supabase/schema.sql` in a worktree-owned scratch Docker container and regenerates the drift manifest. `npm run check:migration-role`, `npm run check:function-grants`, the focused Vitest selector, typecheck, and documentation inventory checks provide source evidence only.

Hosted/provider acceptance remains open until the exact-target migration is applied and replayed; grants, forced RLS, and default ACLs are inspected; current recovery/retained-release evidence exists; the JWT worker and scheduler are deployed; concurrent lease/retry/quarantine behavior is observed; changed-only embedding cost is canaried; activation and retained-previous rollback are drilled; and deployed public render parity is proven. Request snapshots, retrieval, and answer-quality acceptance belong to later tasks.
