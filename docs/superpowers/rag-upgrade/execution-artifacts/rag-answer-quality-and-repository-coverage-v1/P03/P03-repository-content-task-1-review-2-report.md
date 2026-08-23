# P03 Repository Content Task 1 Review 2

## Findings

No Critical or Important findings remain in the complete Task 1 range.

The highest residual risk is downstream adoption: Task 2 and later consumers must preserve the new evidence-family membership/intersection semantics and must call the snapshot assertion before treating a site partition as usable. This is planned adapter/synchronization work, not missing Task 1 implementation.

## Attempt 1 finding closure

### Important 1 — Closed: eligibility now requires accepted validation and currentness

`assertSiteContentRecordEligible` now rejects records unless `validationStatus` is one of the explicit accepted statuses (`locally_reviewed` or `approved`) and `sourceStatus === "current"` (`src/lib/site-content/site-content-registry.ts:524-537`). Both canonical publication selection and retrieval metadata pass through that assertion (`src/lib/site-content/site-content-registry.ts:560-573`).

The corrected tests cover the accepted statuses and fail closed for `unverified`, `review_due`, `outdated`, and `unknown` (`tests/site-content-registry.test.ts:274-292`). An independent provider-free runtime probe confirmed an accepted/current record succeeds while unverified/current and approved/outdated records are rejected.

This closes the approved global rule that unapproved edits are ineligible and record validation/currentness governs publication and retrieval.

### Important 2 — Closed: partition states now require internally consistent identities

`assertSiteContentPartitionSnapshot` now derives static-match truth from the exact digest identities, checks canonical unique sorted pending IDs and their deterministic browser-safe digest, and validates every partition state separately (`src/lib/site-content/site-content-registry.ts:602-705`). Specifically:

- `current` requires a complete matching release identity and the exact empty pending-set digest;
- `updating` requires the same complete matching release identity plus a canonical non-empty pending set and matching digest;
- `stale` requires a complete mismatched release identity and no pending update; and
- `unavailable`/`disabled` must be identity-free, so contradictory usable-release state fails closed.

Tests reject empty, missing, forged, duplicate, unsorted, incomplete, or static-mismatched updating identities and contradictory stale/unavailable identities (`tests/site-content-registry.test.ts:352-443`). The independent runtime probe accepted a complete updating snapshot and rejected both the attempt-1 identityless updating shape and an unavailable state carrying a usable release.

This closes the requirement that `updating` is usable only while exact pending-record exclusion is provable and all other states remain fail closed.

### Important 3 — Closed: derived-source families use overlap-safe memberships

`siteContentEvidenceFamilyKey` now returns a sorted, canonical, deduplicated membership list for every `derived_from` source and excludes `references` relationships from corroboration (`src/lib/site-content/site-content-registry.ts:590-600`). Records without derived lineage retain one canonical site-record membership.

The corrected tests prove `{A}` intersects `{A,B}`, duplicate/case/whitespace variants collapse, and reference-only lineage does not enter the family memberships (`tests/site-content-registry.test.ts:294-350`). The independent runtime probe returned A as the common membership of `{A}` and `{A,B}` and confirmed that the reference identity did not corroborate either record.

This closes the common-source derivative inflation path while preserving navigation/reference traceability.

## Full-range specification and quality review

- The registry still imports the P01-owned `SourceCorpusScope`, `ClinicalSourceRole`, `SiteContentDomain`, `SiteContentPartitionState`, and `RagInsufficiencyReason`; `src/lib/types.ts` is unchanged and no parallel programme vocabulary was added.
- All current `AppModeId` values still have exactly one registered, reviewed-ineligible, or reviewed-exclusion disposition. `pending_review` remains non-completing. `prescribing` maps to medications and `therapy-compass` to therapies; `answer`, `documents`, and `favourites` retain their consumer/trusted-ingestion/private-state exclusions.
- Factsheets, Dictionary, Specifiers, and Calculators remain reviewed-ineligible. Healthdirect and eTG/AMH identities remain rejected. Tools remains explicit record-by-record adoption rather than wholesale catalogue admission.
- Producer sources remain a closed explicit allowlist. The implementation adds no route crawling, glob discovery, arbitrary repository-file indexing, React-component traversal, filesystem access, environment access, crypto dependency, time/random input, or provider call.
- Public read and administrator-server mutation fields remain policy declarations only; no route-level enforcement is claimed or implemented in Task 1. Owner/actor IDs remain audit-only and are omitted from retrieval metadata.
- Canonical publication selection, product-versus-clinical claim policy, uploaded-guideline priority, legacy `registry_record`/P02 authority compatibility, and the codebase index remain intact.
- The correction changes only `src/lib/site-content/site-content-registry.ts` and `tests/site-content-registry.test.ts`. The complete original range contains no Task 2 adapter/manifest/route/RPC/synchronization/migration/retrieval wiring.
- The module remains browser-safe TypeScript: it has no Node-only import or server-global dependency. The new deterministic digest uses standard JavaScript `BigInt` operations and passed the repository typecheck.
- `src/lib/rag/rag.ts` is unchanged across the complete range and remains exactly 4,362 lines.

## Identity and package verification

- Current HEAD: `03d5af81fdec526595df6dd6ba5a0250de859bdd` on `codex/rag-local-build-20260822`.
- Immutable range: `d0c43e89d830ee071eac68f72f614d5e8d7a5214..03d5af81fdec526595df6dd6ba5a0250de859bdd`.
- Exact ordered commits: `7cde5306dbf053bcdc150d78b0bac8373a324b74`, `5474be33a16bf9893426af719579392e47b4fe3a`, `cfd7dc98ed28ef5aa051b382e64c3f7f1c0061da`, `03d5af81fdec526595df6dd6ba5a0250de859bdd`.
- Canonical full-range review package SHA-256 matched `d0afece0fe2fc29004104ff8fe43fd3f967635558c609e943a0280deea02cde3`; its base/head, ordered commits, and changed-file range match Git.
- Ledger lookup returned `NOT REVIEWED at this HEAD and scope` for `P03/repositoryContent/task-1`.

## Verification

- `node scripts/run-vitest.mjs run tests/site-content-registry.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/registry-corpus.test.ts` — fresh PASS, 4 files and 94 tests; no lease contention.
- `npm run typecheck` — fresh PASS for the corrected 4,588-file content signature.
- `npm run docs:check-index` — PASS; all 55 repository roots/modules/routes and all schema tables are indexed.
- Provider-free focused runtime probe — PASS for all three closure paths: accepted/current eligibility, invalid eligibility rejection, complete updating acceptance, identityless/contradictory state rejection, A-to-A+B family intersection, and no reference corroboration.
- `git diff --check d0c43e89d830ee071eac68f72f614d5e8d7a5214..03d5af81fdec526595df6dd6ba5a0250de859bdd` — PASS.
- Exact-range inspection — `src/lib/rag/rag.ts` unchanged at 4,362 lines; the correction commit contains only the registry module and its focused test.

The correction RED is credible and matches the three attempt-1 Important findings: attempt 1 independently reproduced all three behaviours at immutable head `cfd7dc98...`, and the implementer report records those focused assertions failing before the correction. The identical corrected GREEN and compatibility suite were independently rerun above.

`npm run plans:rag:check` remains a known baseline failure because the package validator treats the accepted P02 migration `20260822123000_govern_australian_source_activation.sql` as colliding with the identically named planned migration. Attempt 1 proved the same failure at immutable Task 1 base `d0c43e89...`; Task 1 did not introduce or change it, and this correction correctly left it outside scope.

No broad RAG/evaluation gate, browser runtime, hosted check, provider call, database/Supabase operation, migration, network access, or Task 2 work was run. The focused tests, typecheck, static browser-safety inspection, and index check cover the plausible Task 1 correction regressions without duplicating unrelated gates.

SPEC_VERDICT: PASS

QUALITY_VERDICT: PASS
