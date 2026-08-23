# P03 Repository Content Phase Review 1

## Findings

### Important 1 — The combined Task 1/Task 2 boundary admits Healthdirect-derived medication records as eligible site content

Evidence: Task 1's central eligibility guard checks `logicalId`, `title`, `route`, and lineage source IDs for Healthdirect/eTG/AMH identities, but it does not inspect the record body (`src/lib/site-content/site-content-registry.ts:547-553`). Task 2 then copies the complete existing registry projection into `SiteContentRecord.body` without a source-policy guard (`src/lib/site-content/adapters/registry.ts:25-46`) and builds dynamic medication seed records through that adapter (`src/lib/site-content/adapters/index.ts:194-198`). Five current medication source rows contain Healthdirect source-review material (`data/medications-snapshot.json:3914`, `data/medications-snapshot.json:32805`, `data/medications-snapshot.json:39396`, `data/medications-snapshot.json:40361`, `data/medications-snapshot.json:40464`, `data/medications-snapshot.json:76870`). A provider-free runtime audit of `buildDynamicSiteContentSeedRecords()` found the five resulting logical IDs `medication:glycerol-suppository`, `medication:levothyroxine`, `medication:nicotine-sublingual-tablet`, `medication:osmolax`, and `medication:phenelzine`; all five are `locally_reviewed`, `current`, and accepted by `siteContentRetrievalMetadata` as eligible.

Trigger: build the complete dynamic adapter population and pass one of those medication records through the phase's canonical retrieval-eligibility boundary. More generally, construct an otherwise valid eligible record whose `body` contains a Healthdirect, eTG, or AMH identity. A synthetic local probe with `body: "AMH protected treatment content"` produced an eligible manifest record instead of rejecting it.

Expected: the approved plan's global source boundary says Healthdirect remains excluded and eTG/AMH may never enter a site-content adapter, manifest payload, chunk, embedding, or answer excerpt. The programme authority matrix likewise excludes Healthdirect from ingestion and retrieval and keeps eTG/AMH link-only. The combined registry/adapter contract must therefore fail closed before any prohibited or link-only source material can become a `SiteContentRecord`, regardless of which field contains the identity.

Actual risk: the phase's deterministic adapters classify five current Healthdirect-bearing medication projections as eligible `clinical_kb_site` records. P03 does not activate or serve them yet, but the later synchronization/retrieval phases are designed to consume this exact registry and would inherit an already-approved source-policy violation. The static fixture remains green because dynamic records are intentionally excluded from its digest, and the current tests assert dynamic-domain presence without auditing their complete source boundary.

Smallest proof/fix: add a regression that audits every complete static and dynamic adapter record for prohibited source identities across the full canonical record, plus focused negative cases for a forbidden identity in `body` and lineage. Enforce the exclusion at the shared record/adoption boundary before eligibility or retrieval metadata can be emitted. Fail closed or retain a reviewed exclusion for the five affected medication projections until permitted source lineage is proven; do not merely delete the source name while retaining content derived from the excluded source. Rerun the exact P03 Task 2 selector and the current adapter-population audit.

## Package identity and phase scope

- Immutable `PHASE_START`: `d0c43e89d830ee071eac68f72f614d5e8d7a5214`.
- Reviewed `PHASE_END`: `1cba307fbdbcdaf21011023f621ec1afaab8c0bc`.
- `PHASE_START` is an ancestor of `PHASE_END`; the complete range contains the seven expected Task 1 and Task 2 commits in order.
- Canonical full-range package: `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P03/P03-phase-review-1.diff`.
- Independently verified package SHA-256: `8fe89072139f1f2360c03a95bdac2dd5b88de51b85faa6862cef363c001a5ed3`.
- Its changed-path set exactly matches `git diff --name-status PHASE_START..PHASE_END`: 16 paths, 14,213 insertions, and 3 deletions.
- `src/lib/rag/rag.ts` is unchanged and remains exactly 4,362 lines.
- No Task 3 synchronization/outbox/RPC, API route, migration, retrieval/cache, document-processing, reindex, activation, hosted/provider, database/Supabase, push/PR, or deployment implementation entered the range.
- The untracked P03 receipt/review artifacts and `.superpowers/` scratch are outside the immutable implementation range and were not treated as product changes.

## Cross-task review summary

- Task 1 and Task 2 otherwise integrate around one evaluation-owned type vocabulary, one public reader partition, explicit administrator-only dynamic mutation policy, deterministic producer/adoption registry, canonical snapshot identity, reviewed/current eligibility, and overlap-aware derived-source family memberships.
- The final static manifest contains 1,063 metadata-only records, exactly three eligible Tools primitives, canonical destinations for every static record, and digest `sha256:7cd8763a720142dbe5f2195a4dedd444fa8024a811a5f6ef4b9a40714fe63c1b`.
- Dynamic services/forms/medications/differentials stay outside the deployment static digest, retain existing corpus text/document/chunk identity and embedding paths, and carry a null site-release identity pending later synchronization. No provider call or new embedding occurred.
- Static/dynamic separation, owner/actor privacy, route validity, import-safe CLI behavior, manifest determinism, stale/updating snapshot rules, uploaded-guideline priority, and derived-lineage overlap were reviewed across the complete phase. No additional Critical or Important finding was identified.
- The final Task 2 reviewer closed the prior Tools-route, CLI-import, and complete DSM/calculator-route findings on the full original task range. This phase finding is a cross-task source-policy defect not covered by those route/import reviews.

## Verification evidence

- `node scripts/run-vitest.mjs run tests/site-content-manifest.test.ts tests/site-content-registry.test.ts tests/registry-corpus.test.ts tests/specifiers-content.test.ts tests/medications.test.ts tests/differentials.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts` — fresh PASS, 8 files and 200 tests. This confirms maintained compatibility but also demonstrates the missing prohibited-source adapter assertion.
- `node scripts/run-tsx.mjs scripts/build-site-content-manifest.ts --check` — fresh PASS, 1,063 static records, 3 eligible, exact digest `sha256:7cd8763a720142dbe5f2195a4dedd444fa8024a811a5f6ef4b9a40714fe63c1b`.
- `git diff --check d0c43e89d830ee071eac68f72f614d5e8d7a5214..1cba307fbdbcdaf21011023f621ec1afaab8c0bc` — PASS.
- `node scripts/check-maintainability-budgets.mjs` — PASS; `src/lib/rag/rag.ts` is 4,362/4,362.
- Provider-free dynamic-adapter audit — five Healthdirect-bearing medication records found; all five pass the current reviewed/current retrieval eligibility guard.
- Provider-free synthetic boundary probe — an otherwise valid eligible Tools record with an AMH-bearing body was accepted and emitted as `eligible: true`.

## Residual gates

- The Important source-policy finding must be corrected by the same final-task implementer, re-reviewed over the immutable original Task 2 base, and then re-reviewed over the complete original P03 phase range before acceptance.
- The 1,060 currently ineligible static records remain intentionally unavailable pending their later source/lineage/clinical-governance dispositions; deterministic metadata proof is not clinical approval.
- Synchronization, publication/read parity, release activation, migrations/grants/RLS, retrieval/ranking/cache integration, hosted state, provider evidence, reindexing, deployment, and production activation remain later or separately authorized gates and were not run here.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
