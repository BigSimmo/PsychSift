# P06 canonical phase receipt review 1

Reviewer agent: `/root/p06_phase_review4`

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL

- P0: 0
- P1: 2
- P2: 0
- P3: 0

## Findings

### 1. P1 - differential detail readers do not preserve one release-coherent clinical aggregate

At `7fb3f86dab12d20571427a5390508e6cc5751ad2`, the diagnosis detail route reads only the requested diagnosis publication and returns it without `detailContext`; its client then pairs that active-release record with bundled fallback context. The presentation detail route likewise reads only the target workflow and returns no release-bound diagnosis candidates. This violates Task 3's requirement that canonical collection/detail readers preserve one public candidate set, governance identity, and release fingerprint.

Trigger: activate a release whose diagnosis relationships or presentation candidates differ from the bundle, then request either detail endpoint outside demo/local mode. The diagnosis surface can combine the active record with stale bundled relationships, while the presentation response loses its candidate records.

Required correction: read the complete `differentials` partition once, validate it as one release snapshot, and build diagnosis record/context or presentation workflow/candidates solely from that partition. Missing required dependencies must fail closed under both `current` and `updating`. Add release-path tests for atomic diagnosis context, bound presentation candidates, pending exclusions, reader parity, and a second-read release-flip trap.

### 2. P1 - active-release differential search discards `q`, `limit`, and `matches`

The collection route parses `q` and `limit` and the bundled branch ranks diagnoses/presentations and serializes `matches`. Its active-release branch instead maps every publication to `values` and returns only records/presentations, total, governance, and release. The production search hook requests both `?kind=diagnosis&q=...&limit=20` and `?kind=presentation&q=...&limit=10`, then reads only `diagnosisPayload.matches ?? []` and `presentationPayload.matches ?? []`. Consequently, once the canonical RPC returns an active partition, every differential query settles as a successful empty result even when matching release records exist.

This is within the explicit Task 3 contract: the plan requires the seed/query helpers to resolve the same canonical publication for list, **search**, and slug lookup. The release-state matrix calls the collection route without `q`; the scored-query tests run only in demo mode, so neither catches the live branch regression.

Required correction: rank the active-release diagnosis or presentation payloads with the existing ranking/serialization helpers, apply the requested limit, and return the same `matches` plus ranked record/workflow projection as the established contract. Add `current` and `updating` active-release query tests for both kinds, plus a consumer-level assertion that a release-only match is displayed.

## Other reviewed boundaries

The Task 3 publication/outbox transaction, lease/generation/attempt-fenced worker, changed-only staging, recovery evidence, immutable gate owners, activation/rollback, RLS/grants, and exact `42883` pre-migration fallback remained conservative at this head. Task 4's health authority and Task 5's request snapshot/cache identities were source-level fail-closed, owner-neutral, and did not weaken answer verification or source governance. Those areas do not offset the two public-reader blockers.

## Package identity and review method

- Canonical package: `P06-phase-receipt-review-1.diff`
- SHA-256: `222BF7E5B992081F7DBEE01EE924A1D72F1ABCB8C4FBCC4A774378153A584B0A`
- Source package cross-check: `P06-phase-review-3.diff`, SHA-256 `2A99B175A3114A79EC58FDA7EA26CA82E01875FE88990E974E21CA4DAE9DB0FA`
- Range: `1788f3d95c88b4df65d3e13ddc6e5a7b186e8a07..7fb3f86dab12d20571427a5390508e6cc5751ad2`
- Identity: 20 commits, 90 files; base is the merge base. The canonical package commit list equals `git rev-list --reverse`, and its `## Diff` line sequence equals a fresh full-index binary `--unified=10` diff.
- `git diff --check` passed. Ledger lookup reported `NOT REVIEWED at this HEAD and scope`; no ledger write was made because only phase reports were authorized.

This was an offline immutable-package/source review. No provider, network, live database, migration, deployment, push, PR, document, or corpus action was performed. No duplicate broad gate was run.
