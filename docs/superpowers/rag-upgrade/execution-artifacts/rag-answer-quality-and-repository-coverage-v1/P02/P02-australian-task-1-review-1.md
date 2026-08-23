# P02 Australian source governance — Task 1 review attempt 1

## Review identity

- Reviewer: `/root/p02_aus_task1_review1`
- Immutable base: `b7da14fe6abaf1ff93b97b55303ed1b135c60a14`
- Immutable head: `924a6c63b250d45c550df2b907276c14144d924c`
- Specification verdict: **FAIL**
- Quality verdict: **FAIL**

## Important findings

1. `tests/registry-corpus.test.ts:108-130` does not prove the required production boundary. It defines a test-only `registryEntryForCatalogueKey()` that manually calls `assertIndexableCatalogueEntry()` before constructing a `RegistryCorpusEntry`. Production `clinicalRegistryRowsToCorpusEntries()` (`src/lib/registry-corpus.ts:376-412`) and `embedRegistryCorpusEntries()` (`src/lib/registry-corpus.ts:500-508`) have no catalogue admission check, so a link-only entry can still reach content/chunk/embedding construction. Move the guard into a production constructor or embedding-admission boundary and test that boundary directly, including that embedding is never invoked.
2. `src/lib/australian-source-catalogue.ts:120-137` enforces unique keys and URLs but never unique `publisherCode` values. The test named “unique stable keys, codes, URLs” at `tests/australian-source-catalogue.test.ts:44-47` asserts only key uniqueness and HTTPS URLs. A future duplicate code would silently resolve multiple catalogue rows through one authority identity, violating the explicit stable-code invariant. Add a publisher-code set/duplicate error and a negative test.

## Strengths and retained boundaries

- The manifest contains all 21 exact planned key/root pairs; Healthdirect is absent; eTG/AMH are active `metadata_link_only` references; NPS is historical and `index_forbidden`; active indexed roots are `review_required`; and the seven non-WA fallbacks are lower-ranked.
- Canonical `SourceCorpusScope` and `ClinicalSourceRole` are reused.
- The controller-authorised registry additions are limited to precise `WACP`, `WALEG`, and `AUSPRES` identities without Task 2 lifecycle, scoring, metadata-normalisation, or tooling scope.
- The manifest is content-free and retains `connectedVerificationRequired: true`; connected current-URL/licence verification remains **UNRUN**.
- No generic `.gov.au` wildcard was introduced, and `src/lib/rag/rag.ts` was untouched.

## Verification

- Exact 21-key/root and Healthdirect probe — PASS.
- Manifest invariant probe — PASS for the current 21 unique keys/codes/URLs, active indexed-root policy, fallback ranks, and special eTG/AMH/NPS policies.
- `node scripts/check-maintainability-budgets.mjs` — PASS; `src/lib/rag/rag.ts` remains `4362/4362`.
- The implementer-reported 26-test focused suite and typecheck were not redundantly rerun because the identified gaps are structural.
- No edits, commits, browsing, provider calls, or hosted/live actions were performed.

SPEC_VERDICT: FAIL  
QUALITY_VERDICT: FAIL
