## Summary

Adds a gated, synthetic Care Plan prototype: clinicians can read approved Management Plans, author governed revisions, record ED presentations, and generate patient-facing Care Plans from an approved source. Patient copies stay readable when the source changes or is withdrawn, with a visible needs-updating warning (including on print). Contact and print actions honour the mutation guard instead of launching when blocked.

## Verification

- [x] `npm run verify:pr-local` — hosted Static PR checks, Safety and config checks, Unit coverage, and Build passed on head `cb6d65eec6e84598b771c3241d10db25b77af943`
- [x] `npm run verify:ui` — hosted Production UI critical and Production UI (1/2/3) passed on the same head
- Retrieval/ranking evals not applicable: this PR does not change retrieval, ranking, selection, chunking, or scoring behaviour.
- `npm run verify:release` not run: not a release/handoff-confidence request; no provider-backed gates authorised.

## Risk and rollout

- Risk: medium — patient-facing Care Plan authoring, print, and crisis-support contact surfaces are new, but they run as a synthetic in-memory prototype behind the existing admin-gated route family with no persistence or live provider calls.
- Rollback: revert the squash merge. No migrations, schema, or production config ship with this change.
- Provider or production effects: None
- RAG impact: no retrieval behaviour change — Care Plan prototype and tests only; no rag/, retrieval RPC, ranking-config, or golden-fixture files.

## Clinical Governance Preflight

- [x] Source-backed claims still require linked source verification before clinical use
- [x] No patient-identifiable document workflow was introduced or expanded without explicit governance approval
- [x] Supabase target remains `Clinical KB Database` (`sjrfecxgysukkwxsowpy`)
- [x] Service-role keys and private document access remain server-only
- [x] Demo/synthetic content remains clearly separated from real clinical sources
- [x] Source metadata, review status, and outdated/unknown-source behavior remain conservative
- [x] Deployment classification/TGA SaMD impact was checked when clinical decision-support behavior changed

This change is a clinician-facing synthetic prototype, not validated clinical decision support. Fixtures are labelled synthetic; there is no live patient document store, no service-role exposure, and no SaMD claim.

## Notes

Codex P1 review threads on stale print warnings, withdrawal staleness, print/contact guards, and superseded Patient Plan approval were addressed on this branch and resolved.
