# P02 Australian source governance — Task 2 implementer report

## Status

DONE

- Immutable task base: `bb708016b6277279e9d38482ce4d90927be6468c`
- First implementation commit: `d4e42a5d710ecdaa82e567ed2ea2584dc12d832f` (`feat(sources): normalize source roles and lifecycle`)
- Review-attempt-1 correction commit: `cf7bc34186af5a72cb239cd25ce6004c2d7c72f9` (`fix(sources): enforce governed metadata boundaries`)
- Review-attempt-2 correction commit and final task head: `c6d5ed52eca90ead9c1a088999d2adeb285959d1` (`fix(sources): protect link-only catalogue policy`)
- Execution boundary: local repository and deterministic offline fixtures only

## Implemented contract

- Added a strict normalized `ClinicalSourceMetadata` output contract: every Task 2 field is required and resolves to a governed value, `null`, or `unknown` as specified. Legacy/raw producer compatibility is confined to `ClinicalSourceMetadataInput` and `ClinicalSourceMetadataRecordInput`.
- Added `normalizeClinicalSourceMetadata` and retained `normalizeSourceMetadata` as the compatibility entry point over the same implementation.
- Normalization preserves allowlisted corpus scope, source role, content mode, licence, lifecycle state, HTTPS URL, ISO date/timestamp, and SHA-256 values. It rejects embedded URL credentials and validates timestamps with an ISO-shape plus calendar round-trip check, including rejection of impossible dates such as `2026-02-29T00:00:00.000Z`.
- Rejected governed values are never emitted verbatim to diagnostics. Diagnostics receive only the bounded field name and bounded reason (`unsupported_value` or `unsafe_or_invalid_format`), with a registered canary regression covering this boundary.
- Australian catalogue policy is admitted only when the source is not a `registry_record` and carries an exact catalogue key, compatible publisher code, and compatible jurisdiction. Title/body prose is never authority evidence.
- Exact eTG and AMH link-only catalogue metadata survives normalization when key, code, and jurisdiction are compatible, despite those entries deliberately having no indexed authority identity. Their governed output is always canonicalized to the catalogue-protected `link_only` plus `metadata_link_only` pair, so contradictory `indexed_content` or `public_index_permitted` input cannot survive. They remain supplementary and non-indexable in production classification. Unknown, mismatched, and registry-record claims fail closed.
- A partition-bound first-party `registry_record` may retain `corpus_scope: clinical_kb_site`, but cannot resolve Australian catalogue or activation metadata; authority classification remains ineligible and unclassified.
- Added `SourceAuthorityIdentity`, authority lifecycle, and `authorityIdentityForCatalogueEntry`. The precise Task 1 identities `WACP -> wa-chief-psychiatrist`, `WALEG -> wa-legislation`, and `AUSPRES -> australian-prescriber` are consumed unchanged; no duplicate, umbrella, removed, or collapsed identity was introduced.
- Marked NPS MedicineWise `historical`: its identity/designation remains recognized provenance, while active Australian augmentation eligibility fails closed with `source_lifecycle_not_active` and the released tier stays `supplementary`.
- Redesigned `auditProposedSourcePolicyMetadata` as a content-free aggregate report containing only bounded candidate/exclusion counts and bounded reason/lifecycle/content-mode/licence counts. It does not expose document identifiers paired with exact writable field/value maps and cannot be applied as a Task 4 metadata patch.
- Relevance scoring, locality-only mutation behavior, Task 1 catalogue policy, and the Task 1 verification manifest were not changed.

## Files committed

Ten distinct product/test files across the three Task 2 commits:

- `src/components/ui/answer-state.ts`
- `src/lib/source-authority-metadata.ts`
- `src/lib/source-authority-registry.ts`
- `src/lib/source-metadata.ts`
- `src/lib/therapy-source-governance.ts`
- `src/lib/types.ts`
- `tests/answer-copy-payload.test.ts`
- `tests/source-authority-tooling.test.ts`
- `tests/source-metadata-browser-safety.test.ts`
- `tests/source-metadata.test.ts`

The four files outside the original six-file plan are the controller-approved minimum compatibility and diagnostic-regression fallout: raw metadata projection (`answer-state.ts`), a legacy literal routed through normalization (`therapy-source-governance.ts`), its raw fixture typing (`answer-copy-payload.test.ts`), and the registered diagnostic canary (`source-metadata-browser-safety.test.ts`).

## Strict TDD evidence

### Initial RED

Command (exact required Step 2 command):

```text
node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts
```

Result: exit 1 as expected. The runner reported 2 failed files, 9 expected failing tests, and 45 passing pre-existing tests. Failures proved the governed normalizer, fields, catalogue identity resolver, fail-closed validation, bounded registry/catalogue behavior, historical NPS behavior, and read-only audit were absent. No product file had been edited before this RED.

### Initial GREEN

Command (exact required Step 5 command):

```text
node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/australian-source-catalogue.test.ts
```

Result: exit 0, 3 test files passed, 63 tests passed, 0 failed.

### Review-correction RED

The five reviewer findings were first captured as regressions, then the production implementation was corrected.

Exact Step 5 suite before the correction:

```text
node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/australian-source-catalogue.test.ts
```

Result: exit 1, 5 tests failed and 61 passed. The failures covered raw governed-value diagnostic disclosure, loss of compatible eTG/AMH link-only metadata, acceptance of impossible ISO calendar dates, and the audit's directly writable row shape.

Required-output type-contract RED:

```text
npm run typecheck
```

Result: exit 1 with `tests/source-metadata.test.ts(47,69): TS2344`; the type assertion showed the normalized output fields were still optional rather than required.

### Review-correction GREEN

Exact Step 5 suite after the correction:

```text
node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/australian-source-catalogue.test.ts
```

Result: exit 0, 3 test files passed, 66 tests passed, 0 failed.

Adjacent compatibility and registered-canary suite:

```text
node scripts/run-vitest.mjs run tests/source-metadata-browser-safety.test.ts tests/therapy-source-governance.test.ts tests/answer-copy-payload.test.ts tests/answer-state-contract.test.ts
```

Result: exit 0, 4 test files passed, 39 tests passed, 0 failed.

After scoped formatting, an immediate repeat of exact Step 5 was admission-blocked by the repository coordinator because another worktree held a Chromium lease (PID 10084). This was contention, not a product/test failure. After lease release, the exact Step 5 command ran freshly against committed head `cf7bc34186af5a72cb239cd25ce6004c2d7c72f9`: exit 0, 3 test files passed, 66 tests passed, 0 failed; a fresh gate receipt was recorded.

### Review-attempt-2 RED

Both protected link-only entries were captured with strict negative regressions before the production correction.

```text
node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/australian-source-catalogue.test.ts
```

Result: exit 1, 1 test file failed, 2 tests failed, and 66 tests passed. The eTG Complete and Australian Medicines Handbook cases each reproduced the defect by returning `indexed_content` plus `public_index_permitted` for an otherwise exact protected catalogue identity.

### Review-attempt-2 GREEN

The normalizer now canonicalizes only an exact catalogue-bound link-only entry to the immutable catalogue pair. Existing valid pairs survive; unknown/mismatched/registry claims retain the existing fail-closed path; neither protected entry gains an authority identity or production index eligibility.

Exact Step 5 on committed head `c6d5ed52eca90ead9c1a088999d2adeb285959d1`:

```text
node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/australian-source-catalogue.test.ts
```

Result: exit 0, 3 test files passed, 68 tests passed, 0 failed; a fresh gate receipt was recorded.

Expanded reviewer-adjacent suite on the same committed head:

```text
node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/australian-source-catalogue.test.ts tests/source-metadata-browser-safety.test.ts tests/therapy-source-governance.test.ts tests/answer-copy-payload.test.ts tests/answer-state-contract.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts
```

Result: exit 0, 9 test files passed, 125 tests passed, 0 failed; a fresh gate receipt was recorded.

## Additional verification

- `npm run typecheck` — exit 0 after the correction; fresh typecheck evidence.
- `npm run check:maintainability-budgets` — exit 0; all budgets passed, including `src/lib/rag/rag.ts` at `4362/4362` with no edit to that file.
- Scoped Prettier write/check over the nine correction files — exit 0.
- `git diff --check` before commit and `git diff HEAD^ HEAD --check` after commit — exit 0.
- Correction commit diff: exactly nine approved correction product/test files, 199 insertions and 88 deletions.
- Review-attempt-2 scoped Prettier over `src/lib/source-metadata.ts` and `tests/source-metadata.test.ts` — exit 0, both unchanged.
- Review-attempt-2 `npm run typecheck` — exit 0; fresh typecheck receipt recorded.
- Review-attempt-2 `npm run check:maintainability-budgets` — exit 0; all budgets passed.
- Review-attempt-2 diff checks before and after commit — exit 0.
- Review-attempt-2 commit diff: exactly the two intended files, 41 insertions and 4 deletions.

The initial commit hook correctly stopped when the documentation hook regenerated an unrelated design-system adoption manifest from repository baseline drift. That hook-created delta was reversed and excluded. Commits used the hook's scoped `SKIP_DOCS_SYNC_HOOK=1` override so Task 2 stayed limited to its approved files; no documentation-sync output was committed.

## Authority, mutation, and connected boundaries

- No Supabase project was linked or queried.
- No database migration was written or applied.
- No hosted data, live source URL, provider, OpenAI, or production system was accessed.
- No locality or governance metadata mutation was executed.
- No push, pull, rebase, PR, deployment, publication, or production mutation occurred.
- Connected current-URL/licence verification remains **UNRUN** by programme design and requires separate authorization.
- Task 4 manifest/approval-backed write behavior remains future work and was not implemented here.

## Concerns / reviewer attention

- No known blocking product concern. Re-check the bounded diagnostic canary, exact eTG/AMH canonical link-only pair with continued non-indexability under both valid and contradictory input, strict ISO calendar validation, required-output versus legacy-input type split, exact identity/lifecycle behavior, and aggregate-only read audit.
- The transient lease contention is fully resolved; no verification remains blocked.
