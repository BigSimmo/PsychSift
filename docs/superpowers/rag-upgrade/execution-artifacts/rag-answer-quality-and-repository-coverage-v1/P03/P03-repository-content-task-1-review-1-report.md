# P03 Repository Content Task 1 Review 1

## Findings

### Important 1 — Non-current and unapproved records remain retrieval-eligible

Evidence: `src/lib/site-content/site-content-contracts.ts:13-14` carries the required validation and currentness identities, but `assertSiteContentRecordEligible` in `src/lib/site-content/site-content-registry.ts:522-553` ignores both fields. `siteContentRetrievalMetadata` then emits the record at `src/lib/site-content/site-content-registry.ts:567-583`. A provider-free runtime probe confirmed that a `published`, public, rendered record with `validationStatus: "unverified"` and `sourceStatus: "outdated"` is accepted and receives retrieval metadata.

Trigger: a canonical dynamic producer supplies a record that is publicly rendered but has not completed the accepted validation policy, or whose source is review-due, outdated, or unknown.

Expected: the global contract makes unapproved edits ineligible (`docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md:35`) and requires validation/currentness state on every record (`docs/superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md:233`). A publication selector or retrieval projection must therefore fail closed unless the record satisfies the explicit eligible validation policy and is current.

Actual risk: a later adapter can turn an unreviewed or stale first-party record into `clinical_kb_site` retrieval evidence merely because its producer, role, access, and route match. This defeats the governance fields the contract introduced and can expose stale or clinically unreviewed content to Answer.

Smallest proof/fix: add negative tests for `unverified`, `review_due`, `outdated`, and `unknown`, then enforce `sourceStatus === "current"` plus the explicitly accepted validation-status policy before canonical selection or retrieval metadata can succeed.

### Important 2 — `updating` snapshots accept no release or pending-record proof

Evidence: `assertSiteContentPartitionSnapshot` in `src/lib/site-content/site-content-registry.ts:598-620` validates only `state === "current"`. A runtime probe passed an `updating` snapshot whose registry version, release ID, every static/dynamic/release digest, change epoch, pending IDs, and pending-set digest were all null or empty; the assertion accepted it.

Trigger: the resolver reports `state: "updating"` after a dynamic publication but fails to carry a complete active release identity or the exact anti-joined pending-record set.

Expected: `updating` is permitted only while exact pending-record exclusion is provable; otherwise the site lane fails closed (`docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md:37`, reinforced by the health contract at line 415 and the approved design at `docs/superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md:235`).

Actual risk: downstream Task 5 wiring could treat an identityless or integrity-unknown site lane as partially usable and retrieve stale affected records while describing the lane as safely updating. The contract does not currently make the safe state representable only with the proof it claims.

Smallest proof/fix: add `updating` negative tests and require the complete active release/static-match/dynamic/change-epoch identity, a canonical unique pending-ID set, and its deterministic digest. Reject or downgrade to a fail-closed state whenever that proof is absent or inconsistent.

### Important 3 — Common-source derivatives can still count as separate evidence families

Evidence: `siteContentEvidenceFamilyKey` in `src/lib/site-content/site-content-registry.ts:585-595` returns one source key for a single `derived_from` source but a different compound key when another source is added. A runtime probe produced `source:source:a:sha256:a` for lineage `{A}` and `sources:source:source:a:sha256:a|source:source:b:sha256:b` for lineage `{A,B}`; the keys differ despite the shared source A.

Trigger: two site summaries share an uploaded/public source, while one summary also derives from an additional source.

Expected: exact duplicates and common-source derivatives collapse to one evidence family and cannot inflate support (`docs/superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md:33`); duplicated lineage likewise remains one family in the exact brief (`docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/P03/P03-repository-content-task-1-brief.md:105`).

Actual risk: the two summaries receive different family keys and may be counted as independent corroboration even though they share authority lineage. The existing test at `tests/site-content-registry.test.ts:255-285` covers duplicate spellings of the same single source, not partial lineage overlap.

Smallest proof/fix: add the `{A}` versus `{A,B}` case. Model evidence-family membership so shared verified `derived_from` identities intersect and collapse deterministically (for example, return canonical lineage memberships for connected-component dedup rather than one compound key that loses overlap semantics).

## Scope and package identity

- Current HEAD independently resolved to `cfd7dc98ed28ef5aa051b382e64c3f7f1c0061da` on `codex/rag-local-build-20260822`.
- Immutable range: `d0c43e89d830ee071eac68f72f614d5e8d7a5214..cfd7dc98ed28ef5aa051b382e64c3f7f1c0061da`.
- Exact ordered commits: `7cde5306dbf053bcdc150d78b0bac8373a324b74`, `5474be33a16bf9893426af719579392e47b4fe3a`, `cfd7dc98ed28ef5aa051b382e64c3f7f1c0061da`.
- Canonical review package SHA-256 independently matched `c4729ad5b2ca20feaf42cd167be0606ea414c2a024e39bbbba9557ce1a9d2ac4`; its header, ordered commit list, and changed-file range match Git.
- `d0c43e89...` is the atomic accepted-P02 metadata commit and directly parents Task 1. Accepted P01 and P02 receipts both end with task and phase `PASS/PASS` verdicts.
- The range contains only the two new site-content modules, their focused tests, compatibility-test additions, and the required codebase index update. It contains no route, RPC, migration, adapter, manifest, sync, worker, retrieval/cache integration, or Task 2 implementation.
- `src/lib/rag/rag.ts` is unchanged and remains exactly 4,362 lines. `src/lib/types.ts` is unchanged, so the implementation imports rather than redefines the P01-owned source/site/insufficiency vocabularies.
- The registry retains the legacy `registry_record`/P02 audit-authority boundary, declares public read/admin mutation policy without claiming route enforcement, keeps owner/actor IDs out of retrieval metadata, rejects Healthdirect/eTG/AMH identities, leaves Factsheets/Dictionary/Specifiers/Calculators reviewed-ineligible, and uses explicit record-level Tools dispositions rather than wholesale catalogue admission.

## Verification

- `npm run ledger:lookup -- cfd7dc98ed28ef5aa051b382e64c3f7f1c0061da --scope "P03/repositoryContent/task-1"` — `NOT REVIEWED at this HEAD and scope`.
- `node scripts/run-vitest.mjs run tests/site-content-registry.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/registry-corpus.test.ts` — fresh PASS, 4 files and 90 tests; no lease contention.
- Provider-free runtime probe of the three findings — reproduced all three fail-open behaviours: unverified/outdated record accepted, identityless `updating` snapshot accepted, and shared-source family keys failed to collapse.
- `git diff --check d0c43e89d830ee071eac68f72f614d5e8d7a5214..cfd7dc98ed28ef5aa051b382e64c3f7f1c0061da` — PASS.
- TDD evidence is internally consistent with the brief: the immutable base contains neither the registry module nor its test; the recorded literal RED is the specified missing-owner product failure, and the identical GREEN is independently corroborated by the fresh focused suite. The transient pre-implementation RED state was not committed, so its exact console output remains report evidence rather than replayable commit evidence.

`npm run plans:rag:check` failed at current HEAD because `build-rag-plan-packages.mjs` treats the already accepted P02 migration `20260822123000_govern_australian_source_activation.sql` as colliding with the identically named planned migration. I repeated the package check in a temporary detached worktree at the immutable Task 1 base `d0c43e89...`; it failed identically, and the temporary worktree was removed. This is a pre-existing P02/package-validator blocker, not introduced by the Task 1 range, but it means the required package-validity gate is not currently green.

No typecheck, broad RAG/evaluation gate, browser gate, hosted check, provider call, database/Supabase operation, migration, network access, or Task 2 work was run. The focused suite covered the changed contract/import behaviour; broader and connected checks would be redundant or outside the protected offline review boundary.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
