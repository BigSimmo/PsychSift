# P06 canonical phase receipt review 4

Reviewer agent: `/root/p06_phase_review4`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

- P0: 0
- P1: 1
- P2: 0
- P3: 0

## Finding

### 1. P1 - the active-release differential collection breaks every queried search response

Task 3 explicitly requires the public seed/query helpers to resolve the same canonical publication for list, **search**, and slug lookup. The collection route parses `q` and `limit`. Its bundled branch calls `rankDifferentialRecords` or `rankPresentationWorkflows`, applies the limit, and serializes `matches` (`src/app/api/differentials/route.ts:62-76`). The active-release branch does none of those things: it maps every publication to `values` and returns only records/presentations, total, governance, and release (`:126-144`).

The actual production consumer requests both `/api/differentials?kind=diagnosis&q=...&limit=20` and the presentation equivalent, then reads only `diagnosisPayload.matches ?? []` and `presentationPayload.matches ?? []` (`src/components/clinical-dashboard/use-differential-catalog.ts:216-251`). Therefore, when `read_public_site_content_records` exists and returns a `current` or valid `updating` partition, every differential query settles as `ready` with zero results, even though the release contains matching diagnoses and presentations. The raw `records`/`presentations` arrays returned by the route are not consumed by this hook.

The gap is systematic in the tests. Scored diagnosis/presentation query assertions exercise demo mode only (`tests/differentials-route.test.ts:349-380`). The active-release identity/state matrix calls the differential collection without `q` and checks only byte parity/status (`tests/site-content-route-release-states.test.ts:143-198`). Byte-equivalent empty search results across identities are still contractually wrong.

**Impact:** activating the canonical database publication path disables the main differential search for anonymous, authenticated, and administrator readers. This is a phase-blocking core navigation failure on the exact path P06 introduces, not a cosmetic response discrepancy.

**Required correction:** rank the active-release diagnosis/presentation payloads with the existing helpers, apply `limit`, and return the same ranked records/workflows plus `matches` shape as the established API contract, while retaining governance and release identity from the same partition. Add direct `current` and `updating` active-release query tests for both kinds and a consumer-level test proving a database-only release match is displayed. Also assert no bundled record enters the ranked live result.

## Prior phase finding closure

- **Release-coherent detail aggregates: closed.** Both detail APIs perform one full `differentials` partition read and build diagnosis context or presentation candidates solely from that validated release. Missing required relationships/candidates fail closed; exact RPC error `42883` is the only pre-migration bundle fallback.
- **Rendered page authority: closed.** Both pages keep `dynamicParams = true`, remove bundle existence guards, route database-only slugs, and consume canonical API results. Diagnosis record/context are accepted atomically. Presentation rendering receives release-bound candidates. Loading, unauthorized, not-found, unavailable, and error states contain no clinical fallback content.
- **Deferred response-body slug/auth race: closed.** `useDifferentialRecord` now checks `active` again immediately after `await response.json()` and before any validation or state commit (`src/components/clinical-dashboard/use-differential-catalog.ts:337-351`). The focused regression defers A's body, changes slug/user/header, stalls B, and proves A's title/subtitle never repaint (`tests/differential-release-pages.dom.test.tsx:182-217`). Presentation already had the equivalent guard.
- **Accessibility/metadata/client boundary: closed.** The native `<main>` landmark contains a child live status/alert region; generic client-resolved shells are `noindex`; and the presentation workflow renderer is server-usable behind a small dedicated client loader.

## Tasks 3-5 integration assessment

- **Publication, outbox, worker, and recovery: PASS outside the finding.** Administrator publication binds the candidate/plan/generation/digests, advances the epoch, invalidates eligible public cache rows, and writes the durable event transactionally without an inline provider call. Worker claim, heartbeat, stage, complete, retry, and quarantine retain lease/worker/generation/attempt/candidate/content-hash fencing and content-free failures. Verification uses short-lived one-use validation bindings and immutable database-derived public/governance/must-pass gate artifacts; activation and rollback bind the exact predecessor and retained release.
- **Database security/parity: PASS at source level.** Both forward migrations occur once in `supabase/schema.sql`; schema SHA-256 `E76358DE646E9EE16AD8BF820F1B73EA83B4669B466FCFEA5655AFAA6FE2023A` matches the drift manifest. Site authority tables use RLS with direct roles revoked; authenticated transition RPCs re-check administrator identity, and public reader/worker/runtime functions retain narrow service-role grants and fixed search paths. No browser service-role path was found.
- **Health/public privacy: PASS.** Runtime authority validates a complete bounded pending set, exact epoch, one direct successor, queue/worker freshness, domain evidence, projection/gate integrity, deployment identity, and rollback availability. Missing or malformed authority becomes failure. The public projection exposes bounded release/aggregate state only, not actor IDs, content, private routes, raw epoch, stop reasons, or provider errors.
- **Request snapshot/cache generation: PASS.** Task 5 resolves one immutable request snapshot before cache/coalescing lookup, accepts only classifier-approved current/updating or the sole static-mismatch stale state, maps all other site authority to identity-free unavailable, preserves the exact legacy disabled cache identity, and composes public release/static/dynamic/epoch/pending identities into cache keys. Owner-scoped request-start indexing authority gates coalescing; unavailable authority does not share an in-flight key. Telemetry is limited to state, static-match, and a coarse pending bucket.
- **Phase boundaries: PASS.** The range adds no P07 retrieval lane/RPC/domain-hint serving and no P09 rollout flag/cohort/environment decision. Source-only code and migrations are not evidence of applied schema, deployed worker cadence, provider behavior, or live activation.

## Clinical governance preflight

- Answer verification, quote/span support, citations, ranking governance, query hashing, and cross-border provider boundaries are not weakened.
- No patient-identifiable document workflow or private-document access expansion was introduced. Service-role and authority secrets stay server/worker-side.
- The intended target remains `Clinical KB Database` (`sjrfecxgysukkwxsowpy`); it was not contacted.
- Demo/synthetic bundles remain explicitly separated from active-release content at the API boundary. Unknown, review-due, outdated, unreviewed, and unverified authority stays fail-closed and is not used as a retrieval-order weight.
- This source-only review makes no deployment or TGA SaMD acceptance claim. Finding 1 blocks phase acceptance first.

## Package identity and verification boundary

- Canonical package: `P06-phase-receipt-review-4.diff`
- SHA-256: `E8224429835AC0DA0C9153A63A77D144146DCE4F75CB2756596DA3AD9D9B7FC8`
- Source package cross-check: `P06-phase-review-6.diff`, SHA-256 `AC205F41A98DFCB68BC418C016B37F2514C97C4A69FF527037FB69F2BF73A142`
- Range: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07..eee0ae87c121e7542ec6567c5e51a11949603b0d`
- Authenticated review head: exact `eee0ae87c121e7542ec6567c5e51a11949603b0d` on `codex/rag-local-build-20260822` before the concurrently owned correction advanced the shared worktree.
- Identity: 23 commits, 101 files. The base is the merge base. The source package Git blob equals a fresh canonical binary diff; the canonical package commit list and full-index binary `--unified=10` diff equal fresh Git output line-for-line.
- `git diff --check` passed for every retrospective range. Ledger lookup returned `NOT REVIEWED at this HEAD and scope`; no append was made because only phase reports were authorized.
- No broad or duplicate behavioral gate was run. The finding is established directly by the route/consumer contract and the test-branch gap. Prior focused results were treated as leads, not substituted for source inspection.

No network, provider, live database/Storage, migration application, deployment, push, PR, document, or corpus action was performed. No tracked/staged source was modified.
