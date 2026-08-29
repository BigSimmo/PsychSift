# P06 Repository Content Task 5 Receipt Review 6

Reviewer: `/root/p06_task5_review2`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

Severity counts: P0 0, P1 1, P2 0, P3 0.

## Immutable scope

- Reopened exact full range: `0ee8c09681a49b7891f99d4c3d33f426611ffd78..eee0ae87c121e7542ec6567c5e51a11949603b0d`.
- Eight commits: `70a05c266f9f53764900666313b23cd4f21444b6`, `126751ea2c9272193c84a424027f243d15e83998`, `d4f820cf5edad1f8a0a32031c800e1b9dd6a6e45`, `ac080841dda98bbf437b1fbb5824ca3f5e4a65f2`, `7fb3f86dab12d20571427a5390508e6cc5751ad2`, `3b7acae5149a72fcae7672768b7b7777d745d6ec`, `9b0d09d7dacdb1afb41cc925940f382c8c0681bd`, `eee0ae87c121e7542ec6567c5e51a11949603b0d`.
- Package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P06/P06-repository-content-task-5-receipt-review-6.diff`.
- Verified package SHA-256: `5B7DAC8A3A072C0BA7180B602C24FB5C05EDAF23B252EA1B64250D8337DEBF21`.
- Consolidated implementer-report SHA-256: `0B2F55BF1EC93943F481654312E06C54A5BD6AD770F252B5A886DB594038E53E`.
- Range shape: eight commits, 26 changed files; `src/lib/rag/rag.ts` is 4,359/4,362 lines.

## Finding

### P1 - activated-release differential search returns no matches to the production catalogue client

The collection route parses `q` and `limit` and applies both in fixture/demo `publicDifferentialPayload` (`src/app/api/differentials/route.ts:29-38,58-77,82-91`). When `readPublicSiteContentPartition` returns an active partition, however, it maps every payload directly, ignores `q` and `limit`, and omits `matches` entirely (`:110-141`). The production `useDifferentialSearch` issues diagnosis and presentation queries with `q`/`limit`, then consumes only `payload.matches`, defaulting a missing field to an empty array (`src/components/clinical-dashboard/use-differential-catalog.ts:210-255`).

Trigger/failure path:

1. Activate any non-empty differential release so the collection route takes its public-site-content branch.
2. Enter a diagnosis/presentation search term in the production differential catalogue.
3. Both requests return HTTP 200 and raw `records`/`presentations`, but no `matches`.
4. The hook writes two empty match arrays to its cache and renders a successful empty result.

Expected: active-release search must rank only records from the observed release, honor the validated limit, and emit the same typed `matches` contract the client consumes. Ranking must not import bundled records or straddle releases.

Actual risk: once P06 activation succeeds, a core clinical discovery workflow appears to contain no diagnoses or presentations even though the active release is populated. The successful empty response can also be cached client-side, masking the release until revalidation.

Minimal remedy: derive typed diagnosis/presentation arrays from the one observed partition; validate them with the release-owned payload contract; apply the existing deterministic ranking and limit to those arrays; return both release-bound values and typed `matches`. Add active-partition route tests for diagnosis and presentation `q`/`limit`, plus a client integration assertion that a release-only match renders. The existing release-state matrix checks response parity and raw values but not query semantics; existing query tests exercise fixture/demo paths.

## Closed areas

The original five cache/snapshot commits remain PASS on all Review 1-4 findings. The reopened phase fixes also correctly:

- build diagnosis relationship context and presentation candidates from one unfiltered, release-bound partition and fail closed on missing required dependencies (`src/lib/site-content/differential-aggregate.ts:126-151,166-239`; detail routes use one read at `src/app/api/differentials/[slug]/route.ts:115-155` and `src/app/api/differentials/presentations/[slug]/route.ts:98-122`);
- keep fixture fallback restricted to explicit demo/local mode or exact RPC `42883`;
- make diagnosis/presentation pages consume canonical API content with explicit loading/401/404/503/500 states and no bundled clinical fallback;
- synchronously invalidate slug/auth identity, check liveness again after `response.json()`, and prevent obsolete clinical content from repainting (`src/components/clinical-dashboard/use-differential-catalog.ts:293-364,369-431`);
- retain the page `<main>` landmark while applying status/alert roles to its inner live region (`src/components/differentials/differential-content-state.tsx:46-68`);
- make unresolved client-owned shells non-indexable and isolate the release hook in a small client loader while restoring the shared presentation renderer to the server boundary.

No additional P0-P3 finding was identified in publication coherence, cache/snapshot authority, privacy, abort behavior, source boundaries, P09 scope, or the corrected UI lifecycle.

## Checks and boundary

Verified package/report hashes, exact base/head, eight-commit ancestry, 26-file inventory, raw full-range patch identity, `git diff --check`, and maintainability line count. Independently traced the active collection response into the production hook and inspected the route/DOM tests that miss this branch. No test was needed to establish the deterministic contract mismatch, and no provider, network, live database, Storage, migration, deployment, reindex, document/corpus, stage, commit, or push action was performed.

Finding 1 blocks Task 5 and P06 acceptance. A correction must be followed by another immutable full-base review under this same reviewer identity.
