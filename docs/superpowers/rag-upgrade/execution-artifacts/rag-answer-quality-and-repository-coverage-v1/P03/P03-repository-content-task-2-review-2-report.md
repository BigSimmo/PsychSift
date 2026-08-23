# P03 Repository Content Task 2 Review 2

## Findings

### Important 1 — Route correction remains incomplete for 154 records in the complete static manifest

Evidence: the corrected adapter now preserves the three eligible Tools owners' real destinations, but it still emits every DSM record as `/dsm/${diagnosis.slug}` and every calculator record as `/calculators/${calculator.id}` (`src/lib/site-content/adapters/index.ts:31-45`, `src/lib/site-content/adapters/index.ts:126-140`). The application renders DSM detail records at `src/app/(search-app)/dsm/diagnoses/[slug]/page.tsx`, not `/dsm/[slug]`. The calculator route tree contains only the collection and search pages; `src/app/(search-app)/calculators/page.tsx:7-16` explicitly says there is no calculator home page of its own, and there is no `[id]` detail route. The checked-in manifest consequently contains 146 `/dsm/<slug>` destinations and 8 `/calculators/<id>` destinations that the application does not render (`tests/fixtures/site-content/static-manifest-baseline.json:1154`, `tests/fixtures/site-content/static-manifest-baseline.json:10`).

Trigger: a later governance change makes a DSM record reviewed/current, or makes the calculator producer eligible, without also rewriting the already-registered route projection. The existing eligibility function accepts producer-prefixed destinations generically (`src/lib/site-content/site-content-registry.ts:556-561`), so these records can become retrievable with their current broken navigation targets.

Expected: Task 2 requires route validation across the complete static manifest, not only the three records currently eligible. Each record must retain a canonical public navigation destination rendered by the application.

Actual risk: the manifest content-hashes 154 nonexistent destinations and the focused route assertion checks only Tools (`tests/site-content-manifest.test.ts:199-217`). Current record/producer governance fails closed, so this is not an immediate retrieval exposure, but a later status-only approval can silently activate 404 links without changing the adapter or failing validation. The metadata baseline and all focused tests remain green while preserving the defect.

Smallest proof/fix: emit `/dsm/diagnoses/${diagnosis.slug}` for DSM. For calculators, choose a real stable collection/search destination or defer the records from the manifest until a canonical record destination exists; do not fabricate `/calculators/<id>`. Add a route-family assertion for every manifest domain, including ineligible rows, against the application route templates/canonical structured owner. Regenerate the metadata-only baseline and confirm only the affected record hashes and static digest change.

## Prior finding closure

### Review 1 Important 1 — Eligible Tools canonical routes: closed

`toolRecords` now projects `tool.href` from the canonical structured owner (`src/lib/site-content/adapters/index.ts:145-160`). The three eligible registry adoptions name `/differentials`, `/services`, and `/forms` explicitly (`src/lib/site-content/site-content-registry.ts:351-361`), and eligibility enforces the record-specific route before publication (`src/lib/site-content/site-content-registry.ts:538-561`). The corrected baseline contains exactly those three routes, and the focused test compares each with its catalogue owner and an existing page (`tests/site-content-manifest.test.ts:199-217`). The fresh six-file selector passed this correction. This closes the original finding for all currently eligible records; Important 1 above is the related but separate complete-manifest route defect already identified as latent in Review 1.

### Review 1 Important 2 — Import-safe CLI: closed

The CLI now exports argument parsing and execution seams (`scripts/build-site-content-manifest.ts:14-40`, `scripts/build-site-content-manifest.ts:52-70`) and invokes the runner only when `import.meta.url` matches the executable entry point (`scripts/build-site-content-manifest.ts:72-77`). Its subprocess regression test imports both normally and with poisoned `process.argv`, requires silent exit 0, and proves no file was written (`tests/site-content-manifest.test.ts:221-253`). The fresh selector passed this test, and direct `--check` remains provider-free and successful.

## Package identity and scope

- Independently resolved immutable `TASK_BASE` `03d5af81fdec526595df6dd6ba5a0250de859bdd` and corrected `TASK_HEAD` `3209592ac6a1f3daffbc1c032e9f438e82f4d963` on `codex/rag-local-build-20260822`.
- The base is an ancestor and the full range contains exactly two commits: `674cd465420a1322ba925611d91125971514320d feat(rag): add deterministic site content manifest` and `3209592ac6a1f3daffbc1c032e9f438e82f4d963 fix(rag): preserve canonical site content routes`.
- Canonical full-range package `P03-repository-content-task-2-review-2.diff` independently matched SHA-256 `706d4204c67fc15fe7d28294bdf2e0caca762cd6c77a6890a621d2ea61851cf4`.
- The package contains exactly 12 changed paths, 12,815 insertions, and 8 deletions; 11,702 inserted lines are the metadata-only baseline fixture.
- No Task 3 synchronization, outbox, RPC, API route, migration, retrieval/cache, database, hosted, or provider implementation is present. `src/lib/rag/rag.ts` is unchanged and remains 4,362 lines.
- Ledger lookup returned `NOT REVIEWED at this HEAD and scope` for `P03/repositoryContent/task-2`.

## Whole-scope specification and quality audit

- Parsed all 1,063 baseline records: calculators 8, dictionary 96, DSM 146, factsheets 8, formulation 12, specifiers 585, therapies 205, and Tools 3. Only `tools:differentials`, `tools:forms`, and `tools:services` are eligible; the other 1,060 fail closed with explicit exclusions.
- Every record has exactly the nine metadata/hash fields `logicalId`, `domain`, `route`, `contentHash`, `lineageDigest`, `validationStatus`, `sourceStatus`, `eligible`, and `exclusionReason`. Logical IDs are unique. No title, body, content, owner, actor, question, icon, function, arithmetic, protected prose, UUID-like actor identity, secret, Healthdirect, eTG, AMH, Australian Medicines Handbook, or Therapeutic Guidelines payload entered the fixture.
- The corrected baseline digest is `sha256:e3775896b8e69aa8a1d2d1c6dec2a4d142a86545a4aa73d190746918176164cb`; the fresh selector and CLI reproduced it. The eligible Tools routes are canonical. Finding 1 is the remaining semantic route-validity failure for currently ineligible DSM/calculator records.
- Services, forms, medications, and differentials remain `dynamic_registry`, are validated outside the static digest, and are not promoted from repository seed files. The package reuses the reviewed registry text/identity contracts; it does not change existing corpus text, document/chunk IDs, or embedding paths and contains no provider call.
- Static projections use the registered canonical structured owners and bounded human-readable fields. No arbitrary file scan, route metadata, React/UI prose, raw source-file ingestion, actual document, user data, or operational/private row is processed. Healthdirect/eTG/AMH identities and derived content do not enter adapter payload or lineage.
- Specifiers, dictionary, factsheets, calculators, formulation, and therapies remain fail-closed according to their reviewed producer/record state. Calculator content excludes questions, scoring/arithmetic, icons, and functions. Tools contains only the three explicit safe primitive descriptions.
- Manifest construction retains deterministic ordering, IDs, whitespace, duplicate/privacy rejection, content/lineage hashes, and digest separation. `generatedAt` and `gitSha` remain outside the static digest; focused tests cover one-record hash isolation and UI-only metadata stability. Dynamic rows remain outside the digest, and metadata-only adoption preserves existing document/chunk IDs and verified embeddings.
- The CLI is import-safe and direct modes are local/provider-free. The reviewed implementation supports `--check`, `--out`, and paired baseline/diff generation without live state. No hidden import execution remains.

## Verification and TDD evidence

- `node scripts/run-vitest.mjs run tests/site-content-manifest.test.ts tests/site-content-registry.test.ts tests/registry-corpus.test.ts tests/specifiers-content.test.ts tests/medications.test.ts tests/differentials.test.ts` — fresh PASS, 6 files and 135 tests; no lease contention.
- `node scripts/run-tsx.mjs scripts/build-site-content-manifest.ts --check` — fresh PASS, 1,063 static records, 3 eligible, exact digest `sha256:e3775896b8e69aa8a1d2d1c6dec2a4d142a86545a4aa73d190746918176164cb`.
- Full JSON fixture parse/schema/privacy scan — PASS: 1,063 records, exactly 3 eligible, no duplicate IDs, exact nine-field schema, and no protected/private/prose fields or named excluded sources. Semantic route audit found the 154-record failure above.
- Application route-tree audit — the corrected three eligible Tools destinations resolve; DSM's actual detail template is `/dsm/diagnoses/[slug]`; no calculator `[id]` template exists.
- `git diff --check 03d5af81fdec526595df6dd6ba5a0250de859bdd..3209592ac6a1f3daffbc1c032e9f438e82f4d963` — PASS.

The corrected implementer report provides credible RED/GREEN evidence for both prior findings: canonical Tools-route assertions and the poisoned-argv import probe failed before their respective corrections and passed in the final 135-test selector. The directly reviewed correction diff matches those claims. The exact CLI baseline/out/diff mode was not redundantly rerun because the unchanged manifest/diff tests and implementer evidence cover it; direct `--check` was the distinct runtime gate. No broad gate, browser/server check, network, hosted/provider call, document processing, database/Supabase operation, migration, or Task 3 action was performed.

## Residual risks

- The 1,060 ineligible rows remain intentionally fail-closed pending source governance, lineage, or validation work. Passing local metadata checks is not clinical-content approval or provider/hosted acceptance.
- This review does not validate future synchronization, migration, retrieval, ranking, cache, or serving behavior; those remain outside Task 2 and must not inherit the malformed DSM/calculator destinations.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
