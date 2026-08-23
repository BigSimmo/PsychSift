# P02 Australian source governance — Task 2 review attempt 1

## Review identity

- Reviewer: `/root/p02_aus_task2_review1`
- Immutable base: `bb708016b6277279e9d38482ce4d90927be6468c`
- Immutable head: `d4e42a5d710ecdaa82e567ed2ea2584dc12d832f`
- Specification verdict: **FAIL**
- Quality verdict: **FAIL**

## Findings

1. **P1 — Raw invalid metadata is emitted to browser diagnostics.** `src/lib/source-metadata.ts:90` passes rejected URLs, timestamps, and hashes unchanged to `sourceMetadataDiagnostics.warn`, whose implementation serializes the value at line 72. A malformed canonical URL containing credentials or a query token is therefore logged verbatim. A runtime probe captured `SYNTHETIC_MARKER` unchanged. Emit privacy-safe field/reason diagnostics without the rejected value.
2. **P2 — Exact eTG/AMH link-only metadata cannot survive normalization.** `src/lib/source-metadata.ts:121` requires `authorityIdentityForCatalogueEntry` before any catalogue policy survives. Task 1 intentionally requires authority-registry identities only for indexed content; eTG and AMH therefore have none. Exact key/code/jurisdiction, `link_only`, and `metadata_link_only` inputs normalize to `null`, removing the protective policy from later consumers.
3. **P2 — Timestamp validation accepts impossible calendar instants.** `src/lib/source-metadata.ts:113` checks only a prefix and `Date` parseability. JavaScript rolls `2026-02-29T00:00:00.000Z` into March 1, so a nonexistent instant is preserved instead of failing closed. Require strict ISO timestamp and calendar round-trip validation.
4. **P2 — The normalized output contract is optional instead of required and nullable.** `src/lib/types.ts:116` marks every Task 2 field optional, while the task defines them without `?` and requires absent values to normalize to `null` or `unknown`. Input compatibility belongs in `ClinicalSourceMetadataInput`; normalized output fields must be required.
5. **P2 — The read-only audit returns a directly writable patch manifest.** `src/lib/source-authority-metadata.ts:367` emits document `id` beside exact governance keys and values. Renaming the array and omitting a property literally called `metadata_patch` does not make the rows structurally non-applicable. Task 4's reviewed approval manifest must remain the only future write shape.

## Checks

- Exact Step 5 suite — PASS, 3 files / 63 tests, but it did not cover these gaps.
- `npm run typecheck` — PASS.
- Full-range `git diff --check` — PASS.
- Offline probes reproduced impossible timestamp acceptance, raw diagnostic-value exposure, and loss of exact eTG/AMH metadata.
- Connected URL/licence/currentness verification remains **UNRUN** and out of scope.
- No edits, browsing, provider calls, Supabase access, or hosted/live actions were performed.

SPEC_VERDICT: FAIL  
QUALITY_VERDICT: FAIL
