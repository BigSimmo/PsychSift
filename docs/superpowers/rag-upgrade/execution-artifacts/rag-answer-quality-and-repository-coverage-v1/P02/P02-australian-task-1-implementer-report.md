# P02 Australian source governance — Task 1 implementer report

## Execution identity

- Agent: `/root/p02_aus_task1_impl`
- Model / reasoning: `gpt-5.6-sol` / `high`
- Immutable task base: `b7da14fe6abaf1ff93b97b55303ed1b135c60a14`
- Final task head: `bb708016b6277279e9d38482ce4d90927be6468c`
- Commits:
  - `924a6c63b250d45c550df2b907276c14144d924c feat(sources): define governed Australian catalogue`
  - `bb708016b6277279e9d38482ce4d90927be6468c fix(sources): enforce catalogue admission boundaries`
- Outcome: DONE

## Implemented contract

- Added the versioned `australian-source-policy-v1` catalogue, derived only from the committed content-free verification manifest.
- Reused the canonical `SourceCorpusScope` and `ClinicalSourceRole` vocabularies from `src/lib/types.ts`; that file required no Task 1 delta because P01 already supplied both aliases.
- Added fail-closed verification-manifest parsing for schema/policy mismatch, invalid rows, non-HTTPS URLs, duplicate keys/URLs, Healthdirect presence, and incompatible link-only/licence combinations.
- Added exact lookup, exact-document licence eligibility, and content-bearing catalogue admission assertions.
- Kept Healthdirect absent, eTG/AMH link-only and non-indexable, NPS MedicineWise historical/index-forbidden, all active indexed roots `review_required`, and all seven non-WA state/territory entries lower-ranked than national/WA entries.
- Replaced the misleading `registry_record_id: "amh"` indexing-health fixture with a neutral synthetic service identifier.
- Added a registry-corpus negative contract proving eTG/AMH are rejected before a content-bearing `RegistryCorpusEntry` can be constructed.
- Did not touch `src/lib/rag/rag.ts`.

## Sequencing adjustment authorised by the controller

The written Task 1 invariant requires every indexed catalogue publisher code to resolve to an existing authority identity, while the plan placed three missing precise identities in Task 2. Per the controller's explicit ruling, Task 1 pulled forward only these identity-only registry entries:

- `WACP` -> `wa-chief-psychiatrist`
- `WALEG` -> `wa-legislation`
- `AUSPRES` -> `australian-prescriber`

No Task 2 metadata normalisation, lifecycle classification, scoring, or tooling mutation was pulled forward. Task 2 should consume/refine these identities rather than duplicate them.

## Changed product/data/test files

- `data/australian-source-verification.v1.json`
- `src/lib/australian-source-catalogue.ts`
- `src/lib/registry-corpus.ts`
- `src/lib/source-authority-registry.ts`
- `tests/australian-source-catalogue.test.ts`
- `tests/check-indexing-contract.test.ts`
- `tests/registry-corpus.test.ts`

## Strict TDD evidence

### RED 1 — absent catalogue module

Command:

```text
node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts
```

Decisive output:

```text
FAIL  |node| tests/australian-source-catalogue.test.ts
Error: Cannot find package '@/lib/australian-source-catalogue'
Test Files  1 failed (1)
```

The first two attempts were admission-blocked by an unrelated Chromium owner; no production edit was made until the coordinator admitted the command and the intended missing-module failure was observed.

### RED 2 — precise authority identity seam

After the catalogue/manifest existed but before the three authority entries were added:

```text
node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts
```

Decisive output:

```text
tests/australian-source-catalogue.test.ts (8 tests | 2 failed)
AssertionError: expected undefined to be truthy
AssertionError: expected undefined to be 'wa-chief-psychiatrist'
Test Files  1 failed (1)
Tests  2 failed | 6 passed (8)
```

### Intermediate compile RED

The first typecheck correctly rejected the JSON import's widened string types:

```text
src/lib/australian-source-catalogue.ts(146,14): error TS2322
Type 'string' is not assignable to type '"australian_public"'.
```

The fix validates the imported JSON through an `unknown` boundary and consumes only the narrowed manifest.

## Final GREEN evidence

Repository arbiter before typecheck:

```text
[gate-arbiter] RUN "typecheck" — rag scope never defers — CI's own routing treats it as heavy
```

Required focused suite on final formatted content:

```text
node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts

Test Files  3 passed (3)
Tests  26 passed (26)
```

Final typecheck on final formatted content:

```text
npm run typecheck

[gate-receipts] recorded a pass for "typecheck:internal" (4539 input files).
```

Static/format evidence:

```text
npx prettier --write src/lib/australian-source-catalogue.ts src/lib/source-authority-registry.ts src/lib/types.ts data/australian-source-verification.v1.json tests/australian-source-catalogue.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts
git diff --check
```

Scoped Prettier was used instead of whole-tree `npm run format` so controller-owned untracked P02 receipt/artifact files were not rewritten.

## Commit-hook handling

The first normal commit attempt stopped before commit after the repository-wide design-system adoption generator added unrelated `tests/answer-content.test.ts` evidence to `docs/design-system/adoption-manifest.json`. That single hook-generated unstaged delta was inspected and removed with `apply_patch`; no pre-existing work was discarded. The staged six-file task scope remained unchanged. The commit was then created with the hook's documented one-shot `SKIP_DOCS_SYNC_HOOK=1` override. The hook's module-index check had already passed:

```text
docs/codebase-index.md coverage OK: all 54 repository roots/modules/routes and all schema tables are indexed.
```

No generated design-system document entered the task commit.

## Review correction evidence

Review attempt 1 found two Important gaps: the link-only assertion was exercised only through test scaffolding rather than the production corpus boundary, and the versioned manifest did not reject duplicate publisher codes.

Strict correction RED evidence:

- `node scripts/run-vitest.mjs run tests/registry-corpus.test.ts` — one of 13 tests failed because the real embedding path resolved with one document and one chunk instead of rejecting the link-only entry.
- `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts` — one of nine tests failed because the real manifest assertion accepted a duplicate publisher code.

The correction invokes governed catalogue admission for every declared `source_catalogue_key` before dynamic provider import, document/chunk construction, or Supabase access. It permits existing inputs that do not declare catalogue metadata, while malformed, unknown, historical, link-only, and otherwise non-indexable declarations fail closed. Publisher codes are now unique after trim/case normalisation at the typed manifest boundary.

Final corrected GREEN evidence:

- Required focused suite — PASS, 3 files and 27 tests.
- `npm run typecheck` — PASS on final formatted content.
- `node scripts/check-maintainability-budgets.mjs` — PASS; `src/lib/rag/rag.ts` remains `4362/4362`.
- `git diff --check` — PASS.
- Review attempt 2 independently returned specification PASS and quality PASS with no remaining findings.

## Source-current and external-action boundary

- Source-current official-page/licence acceptance: **UNRUN — connected read-only checkpoint required**.
- The manifest rows record the approved 2026-08-20 programme-plan evidence references; this task does not claim they were reverified against current official pages on 2026-08-23.
- Browser/network browsing: not run.
- OpenAI/provider calls: not run.
- Supabase/hosted/live access or mutation: not run.
- Push, PR, deployment, hosted migration, or production mutation: not performed.

## Concerns / next-task notes

- A connected read-only reviewer must verify current official URLs and exact licence modes before source-current acceptance or any manifest refresh.
- Task 2 must retain the precise `WACP`, `WALEG`, and `AUSPRES` identities and add only its planned lifecycle/metadata semantics; it must not collapse them into umbrella publisher codes.
- Exact-document `public_index_permitted` evidence remains mandatory. An official root or `.gov.au` identity alone never permits indexing.
