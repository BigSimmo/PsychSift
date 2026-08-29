# P06 canonical phase receipt review 5

Reviewer agent: `/root/p06_phase_review4`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

- P0: 0
- P1: 1
- P2: 0
- P3: 0

## Finding

### 1. P1 - active-release cross-entity differential search still uses the bundled catalogue

The correction restores `q`, `limit`, and `matches` for active-release collection responses, but it invokes the existing rankers with only the selected release record kind (`src/app/api/differentials/route.ts:82-101,136-154`). Those rankers are not release-self-contained:

- diagnosis ranking calls `presentationTitleTextForDiagnosis`, whose lazy reverse index is always built from bundled `differentialPresentations()` (`src/lib/differentials.ts:485-512,578`); and
- presentation ranking calls `candidateTitlesText`, whose title map is always built from bundled `differentialRecords` (`src/lib/differentials.ts:489-493,515-523,642`).

The active route asks `readPublicSiteContentPartition` for `recordKind: kind`, so it does not even possess the opposite-kind publications needed to replace those bundled indexes. Consequently a database-only or dynamically changed presentation title/relationship cannot make its release diagnosis discoverable, and a database-only diagnosis title cannot make its release presentation discoverable. Conversely, a relationship removed from the active release can continue to score a live diagnosis from stale bundled presentation metadata. This violates Task 3's requirement that seed/query helpers resolve the same canonical public publication for list, search, and slug lookup; the response objects are release-bound, but part of their ranking evidence is not.

Two read-only runtime probes against the authenticated head confirmed both false-negative directions: a release-only diagnosis/presentation pair whose counterpart phrase was absent from the bundle produced `reverseCount: 0` and `forwardCount: 0`. A released `delirium` record with all active text neutralized still matched query `encephalopathy` at score 2 solely for reason `presentation link`, proving that the bundled reverse index can add a stale live-result score.

The new regression does not catch this. It queries direct titles/IDs already present in the bundle and constructs the active partition by prefixing bundled titles (`tests/site-content-route-release-states.test.ts:252-286`), so both cases pass without exercising a database-only counterpart, a changed relationship, or the absence of stale bundled ranking evidence.

**Impact:** canonical active-release search can omit valid release-linked diagnoses/presentations and surface records for relationships that the active clinical release no longer contains. This is a phase-blocking release-coherence and clinical navigation defect on the P06 production path. It is not an authorization or data-exposure defect.

**Required correction:** resolve one full `differentials` partition for an active-release search, validate it fail-closed as one release catalogue, and build both diagnosis-to-presentation and presentation-to-diagnosis title indexes from that same partition. Pass those explicit indexes/catalogue into the rankers (retaining bundled defaults only for the explicit demo/local fallback), or add release-specific rankers with the same scoring contract. Do not perform two independent partition reads. Preserve the current ranked collection, `matches`, `limit`, governance, total, and release response shapes.

Add focused `current` and `updating` regressions for both directions using database-only IDs whose query phrase exists only in the opposite-kind release title, plus a case where a bundled relationship/title is removed or changed and must contribute no score. Assert the returned object and match are from the active release, the limit is honored, and the consumer's `matches` contract remains populated.

## Prior finding closure and full-phase assessment

- **Original active-release search response defect: partly closed, superseded by Finding 1.** The route now returns ranked collections and scored `matches`, applies `limit`, and preserves release/governance metadata. Direct title searches work. The ranking context is still not wholly release-bound.
- **Release-coherent detail aggregates: closed.** Diagnosis and presentation detail APIs use one full `differentials` partition, validate record identities/payloads/governance, derive related context/candidates from that partition, and fail closed when a required relationship is missing. Exact RPC error `42883` remains the sole pre-migration bundle fallback.
- **Rendered page authority: closed.** Both routes retain `dynamicParams = true`, route database-only slugs through release loaders, expose explicit loading/unauthorized/not-found/unavailable/error states without bundled clinical fallback, atomically accept diagnosis record/context, and render presentation candidates from the release aggregate. The client/server boundary, native main landmark, live region, and generic-shell `noindex` behavior remain intact.
- **Deferred response-body slug/auth race: closed.** Diagnosis state checks request activity again after `await response.json()` and before validation/state commit; its regression defers the stale body across slug/user/header change. Presentation retains the equivalent guard.
- **Publication, outbox, worker, and recovery: PASS outside Finding 1.** Administrator publication transactionally binds candidate/plan/generation/digests, advances the epoch, invalidates eligible cache identities, and writes the durable event without an inline provider call. Worker claim, heartbeat, staging, completion, retry, and quarantine preserve lease/worker/generation/attempt/candidate/content-hash fencing and content-free logs. Verification/activation/rollback remain bound to database-derived artifacts, one-use short-lived validation authority, exact predecessor identity, and retained recovery evidence.
- **Database security/parity: PASS at source level.** Site authority tables retain RLS and revoked direct roles; authenticated transition RPCs re-check administrator identity; public reader, worker, and runtime functions retain narrow service-role grants and fixed search paths. No browser service-role path was found. `supabase/schema.sql` SHA-256 is `E76358DE646E9EE16AD8BF820F1B73EA83B4669B466FCFEA5655AFAA6FE2023A`, matching `supabase/drift-manifest.json`.
- **Health/public privacy: PASS.** Runtime authority validates bounded complete pending identity, epoch, successor, freshness, domain, projection/gate, deployment, and rollback evidence and fails closed on malformed authority. The public health projection remains bounded and omits content, actor IDs, private routes, raw epoch, stop reasons, and provider errors.
- **Request snapshot/cache generation: PASS.** One immutable request snapshot is resolved before cache/coalescing lookup; invalid authority maps to identity-free unavailable; the sole static-mismatch state is constrained; the legacy-disabled identity stays byte-compatible; and generation, source-policy, rollout, upload, Australian, release, static/dynamic, epoch, and pending identities remain represented in cache/coalescing decisions. Telemetry remains coarse and content-free.
- **Phase boundaries: PASS.** The range adds neither the P07 retrieval lane/RPC/domain-hint serving contract nor P09 rollout decisions. Source-only code and migrations do not prove applied schema, deployed worker cadence, provider behavior, hosted activation, or live recovery.

## Clinical governance preflight

- Answer verification, quote/span support, citations, query hashing, and cross-border provider boundaries are not weakened.
- No patient-identifiable document workflow or private-document access expansion was introduced. Service-role/provider/governance secrets remain server/worker-side.
- The intended target remains `Clinical KB Database` (`sjrfecxgysukkwxsowpy`); it was not contacted.
- Demo/synthetic bundles remain explicitly separated at the response-object boundary, but Finding 1 improperly retains bundled cross-entity ranking evidence in the active-release path.
- Unknown, review-due, outdated, unreviewed, and unverified authority remains fail-closed and is not used as a retrieval-order weight.
- This source-only review makes no deployment or TGA SaMD acceptance claim. Finding 1 blocks phase acceptance first.

## Package identity and verification boundary

- Canonical package: `P06-phase-receipt-review-5.diff`
- SHA-256: `4786AF1C6D7CDE4A9B924B7538ED9D8ECEB0545D971CE4C7BAC08FBBADA7004F`
- Range: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07..46c14b9e993cbf625f8f0ac73d295737cc0c91d1`
- Authenticated head: exact `46c14b9e993cbf625f8f0ac73d295737cc0c91d1` on `codex/rag-local-build-20260822`
- Identity: 24 commits, 101 files. The base is the merge base. The canonical package commit list and full-index binary `--unified=10` patch body equal fresh Git output line-for-line. `git diff --check` passed and the tracked tree was clean before this report.
- Ledger lookup returned `NOT REVIEWED at this HEAD and scope`; no append was made because this task authorizes no write outside this report.
- The implementer evidence reports RED for the two original active-release title-query cases, then GREEN for 2 files / 22 tests, typecheck over 10,879 input files, scoped lint/format, and diff checks. Those results are consistent with the inspected correction but do not exercise Finding 1. No duplicate broad gate was run. The two narrow runtime probes above were provider-free and non-mutating.

No network, provider, live database/Storage, migration application, deployment, push, PR, document, or corpus action was performed. No tracked/staged source was modified.
