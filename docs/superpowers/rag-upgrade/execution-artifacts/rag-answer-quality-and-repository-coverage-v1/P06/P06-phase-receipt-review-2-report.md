# P06 canonical phase receipt review 2

Reviewer agent: `/root/p06_phase_review4`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

- P0: 0
- P1: 2
- P2: 0
- P3: 0

## Findings

### 1. P1 - production differential pages bypass or fail open around the canonical release readers

At `3b7acae5149a72fcae7672768b7b7777d745d6ec`, the first phase finding is closed in the API layer: both differential detail owners use one full-partition release read and build their dependent context from that snapshot. The rendered pages do not consistently consume it.

The presentation page rejects slugs against bundled `getPresentationWorkflow` and renders a component that again resolves the workflow and every candidate from bundled owners. The diagnosis page requires a bundled record and passes bundled record/context as fallback; its client selects that clinical fallback for loading, unauthorized, not-found, unavailable, and error responses. A database-only slug therefore cannot route, an activated edit can remain invisible, and an authoritative `503` can display bundled clinical content as though it were current.

Required correction: make both page owners consume the canonical detail endpoints, remove production bundle existence guards, treat diagnosis record/context as one atomic value, pass release-bound presentation candidates to the renderer, and render explicit non-clinical loading/401/404/503/error states. Keep bundle data only in the APIs' explicit demo/local or exact `42883` fallback. Add DB-only slug, trap content, unavailable, and fallback DOM tests.

### 2. P1 - active-release differential search discards `q`, `limit`, and `matches`

The active-release collection branch still returns only raw records/presentations, total, governance, and release. It does not call the ranking helpers or return `matches`, despite parsing `q` and `limit`. `useDifferentialSearch` consumes only `payload.matches ?? []`, so an activated database-backed deployment makes every diagnosis and presentation query appear empty.

Task 3 expressly requires the same canonical publication for list, search, and slug lookup. Existing release-state coverage calls the collection route without a query, while scored-query tests exercise demo mode only.

Required correction: rank and limit release-backed payloads with the established helpers, preserve the response contract, and add `current`/`updating` release-query tests for both kinds plus a consumer assertion for a release-only result.

## Closure and other reviewed boundaries

The Phase Review 1 API aggregate defect is closed at this head: a single full partition supplies diagnosis context and presentation candidates, malformed/missing dependencies fail closed, and only exact RPC error `42883` permits bundle fallback. Publication/outbox, recovery/activation, worker fencing, schema/RLS/grants, health privacy, and request snapshot/cache generation remained conservative in source. The rendered-page and search findings still prevent phase acceptance.

## Package identity and review method

- Canonical package: `P06-phase-receipt-review-2.diff`
- SHA-256: `A895EA36A98C0E441ACFF284BD42D898762E1EE71EE449A254A31FE2FC5AFE74`
- Source package cross-check: `P06-phase-review-4.diff`, SHA-256 `85546C709E0BA54717F3F0DCB5C3211C2A91E5B0FEB16F9C0D2460CAEEFE2211`
- Range: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07..3b7acae5149a72fcae7672768b7b7777d745d6ec`
- Identity: 21 commits, 91 files; base is the merge base. The canonical package commit list and full-index binary `--unified=10` diff match fresh Git output line-for-line.
- `git diff --check` passed. Ledger lookup reported `NOT REVIEWED at this HEAD and scope`; no ledger write was made under the report-only authorization.

This was offline/source-only. No provider, network, live database, migration, deployment, push, PR, document, or corpus action was performed. No duplicate broad gate was run.
