# P02 Australian source governance — Task 2 review attempt 2

## Review identity

- Reviewer: `/root/p02_aus_task2_review1`
- Immutable base: `bb708016b6277279e9d38482ce4d90927be6468c`
- Immutable head: `cf7bc34186af5a72cb239cd25ce6004c2d7c72f9`
- Specification verdict: **FAIL**
- Quality verdict: **FAIL**

## Finding

1. **P2 — Link-only catalogue identity admits contradictory indexing/licence metadata.** `src/lib/source-metadata.ts:148` treats an exact eTG/AMH key/code/jurisdiction as catalogue-bound, but lines 195 and 206 accept any recognized content-mode/licence enums instead of enforcing the catalogue's immutable `link_only` plus `metadata_link_only` pair. An erroneous or adversarial protected record can therefore normalize as `indexed_content` and `public_index_permitted`, misleading later consumers even though the separate production index guard still rejects it. Contradictory values must fail closed or normalize to the canonical protected policy; add a negative regression for both protected entries.

## Prior-finding closure and checks

- All five attempt-1 findings are otherwise closed: diagnostic values are bounded and canary-free; valid exact link-only policy survives; impossible timestamps fail; normalized fields are required with explicit raw input types; and the audit is aggregate-only/non-applicable.
- Expanded offline suite — PASS, 9 files / 123 tests.
- `npm run typecheck` — PASS.
- Full-range `git diff --check` — PASS.
- Direct contradictory-policy probe returned `indexed_content` plus `public_index_permitted`, reproducing the finding.
- Connected currentness remains **UNRUN** and out of scope.
- No edits, browsing, provider calls, Supabase access, or hosted/live actions were performed.

SPEC_VERDICT: FAIL  
QUALITY_VERDICT: FAIL
