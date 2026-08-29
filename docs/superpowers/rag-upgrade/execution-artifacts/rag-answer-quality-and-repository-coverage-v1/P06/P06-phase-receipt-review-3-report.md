# P06 canonical phase receipt review 3

Reviewer agent: `/root/p06_phase_review4`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

- P0: 0
- P1: 2
- P2: 0
- P3: 0

## Findings

### 1. P1 - diagnosis response-body race can repaint stale clinical content after a route/auth transition

At `9b0d09d7dacdb1afb41cc925940f382c8c0681bd`, `useDifferentialRecord` derives a request identity from slug, authentication fingerprint, and authorization header and synchronously clears prior content. The effect marks itself inactive during cleanup, but checks liveness only before `await response.json()`. It validates and commits the parsed diagnosis/context without checking `active` again. The presentation hook already has the missing post-parse guard.

Trigger: resolve request A's headers but defer its JSON body, transition to slug/auth identity B, then resolve A's body. Cleanup invalidates A and the B render clears clinical content, but A's continuation can still commit its record/context under B's URL until B settles, or indefinitely if B stalls.

Required correction: re-check liveness immediately after response-body parsing and before validation/state commit, and add a deferred-body regression that changes slug, user identity, and authorization header and proves A never repaints.

### 2. P1 - active-release differential search discards `q`, `limit`, and `matches`

The active-release collection branch maps the release publications to raw values and omits ranking and `matches`. `useDifferentialSearch` issues queried diagnosis/presentation requests and reduces an omitted `matches` property to empty arrays. Thus all production differential searches go empty as soon as the release RPC is present and returns `current` or `updating` data.

The Task 3 list/search/slug contract requires release-backed search parity. Existing query tests are demo-only, and the release-state matrix never supplies `q`, leaving this branch unproved.

Required correction: run the active-release payloads through the existing diagnosis/presentation ranking and match serialization, apply the requested limit, and add current/updating tests for both query kinds plus a release-only consumer result.

## Prior closure and other reviewed boundaries

The API aggregate and steady-state page integration findings are otherwise closed at this head. Both dynamic pages accept database-only slugs, diagnosis record/context are atomic, presentation candidates come from the release response, non-success responses render explicit non-clinical states, and bundle fallback remains API-owned and limited to demo/local or exact `42883`. Publication/recovery/health/privacy and Task 5 snapshot/cache-generation boundaries remained conservative in direct source inspection. Findings 1 and 2 still block acceptance.

## Package identity and review method

- Canonical package: `P06-phase-receipt-review-3.diff`
- SHA-256: `5BB0CCE34FA585EA7FB55219862CD23DAB5F1B95475A0F8D93A3EC50670F6CDE`
- Source package cross-check: `P06-phase-review-5.diff`, SHA-256 `224E06C62F5E7C053C128156135967F7171B39B9D632E5AE235349FF032C30D0`
- Range: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07..9b0d09d7dacdb1afb41cc925940f382c8c0681bd`
- Identity: 22 commits, 100 files; base is the merge base. The canonical package commit list and full-index binary `--unified=10` diff match fresh Git output line-for-line.
- `git diff --check` passed. Ledger lookup reported `NOT REVIEWED at this HEAD and scope`; no ledger write was made under the report-only authorization.

This was offline/source-only. No provider, network, live database, migration, deployment, push, PR, document, or corpus action was performed. No duplicate broad gate was run.
