# U02 review 1 finding verification and decisions

- Controller: `/root`
- Candidate: `4621b3000a05cd88494f4b87d807c8761d7f862f`
- Review checkpoint: `5bacc4e68b0cae4ed1cce8999af8cb5f9b160b20`
- Verification agents: `/root/u02_verify_edge_findings`, `/root/u02_verify_worker_findings`
- Verification mode: xhigh, static, read-only
- Product/test changes during verification: none

## Confirmed corrections within existing U02 ownership

1. Compare every persisted summary projection with the normalized payload in Node and Edge; use independent structured-model authority; repair divergence without a provider call.
2. Re-read live typed/raw generation and policy metadata after worker generation commit; require exact equality; never synthesize authority from the claim snapshot.
3. Replace the enrichment document-metadata full write with an enrichment-owned metadata patch so concurrent generation and policy authority survive.
4. Persist projection completion false before every Node label-repair path, including marker-true/mismatched-label rows, then true only after exact repair.
5. Move exact generation, complete bounded evidence loading, and P05 preflight before `metadata-stamp` persistence.
6. Enforce the exact authority-derived fallback note: first selected chunk when available, otherwise first selected image, exactly one anchor, exact pages, exact evidence type, and no alternate anchor.
7. Reject non-number pages and confidence without coercion.
8. Match label boundaries using whole Unicode code points and cover astral letters/numbers.

These corrections remain within the brief's existing implementation and test ownership.

## Decision 1: Edge fallback completion semantics

The incompatibility is verified:

- The binding brief requires fallback labels to be exactly empty and treats fallback rows as not fully current.
- Edge persists that exact empty projection.
- The current strict completion gate and atomic completion RPC require at least one generated label.

Two coherent designs exist:

1. **Provisional fallback:** retain conservative deferral until a structured Node summary exists, and add a focused test proving the defer contract. This stays inside U02's owned files and matches the brief's statement that fallback is not fully current.
2. **Completion-eligible fallback:** allow a projection-complete validated fallback with exactly zero expected labels to satisfy the strict gate. This requires explicit ownership expansion to a new forward migration plus `supabase/schema.sql`, drift/schema contracts, and focused gate/RPC tests. Adding a fake label, retaining stale labels, or bypassing the RPC would violate the brief and U01 invariants.

No schema or migration file was changed pending user direction.

## Decision 2: baseline-confirmed offline-gate exception

`npm run eval:rag:offline` exited 1 after its fixture/manifest stage passed. A clean detached run at implementation base `f485df3358f43dff2b85698fcfc25d018854930a` reproduced the exact same four failing suites, 45 failures, 56 passes, assertions, and round-trip totals. A separate call-graph trace found no U02 runtime path into those mocked answer/search observations.

Repository policy forbids fixing unrelated baseline failures without authorization, while the U02 brief expects the exact gate to be green. U02 therefore needs either:

1. an explicit task-authority amendment accepting this baseline-confirmed red gate as a documented U02 exception; or
2. a scope expansion into unrelated Answer/search debt before U02 can be accepted.

No Answer/search file was changed pending user direction.
