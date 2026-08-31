# C00 task brief: anchor the ingestion-first continuation

## Position in the programme

C00 is metadata-only. It anchors the approved `rag-source-ingestion-continuation-v1` overlay to the accepted P07 metadata commit before any product test, source, migration, RED run, document operation, provider call, or connected action.

Worktree: `C:\Users\joshs\.codex\worktrees\rag-local-build-20260822\Database`

Branch: `codex/rag-local-build-20260822`

Implementation base: `03aa32d731d1cb9009be55213580e9ea3994017c`

Approved design plus implementation-preflight clarification SHA-256: `FEC371222E5D21F10DFA1A24E02DD5DE27F941AFC685D3CE2BF3E3ECF0973676`

Reviewed plan plus implementation-preflight correction SHA-256: `F455EFDEF4D80A64CD0A3FA4BC2C6F637799E32332C7D81459E0FBD24755D4D7`

## Read first

- `docs/superpowers/specs/2026-08-31-ingestion-first-continuation-design.md`
- `docs/superpowers/plans/2026-08-31-ingestion-first-continuation.md`, only Global constraints, Continuation evidence layout, and C00
- `.superpowers/sdd/progress.md`
- Accepted P00-P07 receipts and manifests under `docs/superpowers/rag-upgrade/`

Do not read or resume the superseded P08A draft as implementation authority.

## Owned files

Create:

- `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/manifest.json`
- `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/C00-anchor.md`
- `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/C00/C00-report.md`

Modify:

- `.superpowers/sdd/progress.md`

Checkpoint without modifying their reviewed bytes:

- `docs/superpowers/specs/2026-08-31-ingestion-first-continuation-design.md`
- `docs/superpowers/plans/2026-08-31-ingestion-first-continuation.md`
- this brief

Do not stage or modify any other untracked artifact.

## Requirements

1. The manifest contains:
   - `programmeId` equal to `rag-source-ingestion-continuation-v1`;
   - exact `designPath`, `planPath`, and `implementationBase`;
   - every accepted P00-P07 receipt path and SHA-256 digest, derived from the current accepted files rather than copied from chat;
   - ordered phases C01-C06;
   - the 13 unit identifiers in plan order;
   - reviewer routing;
   - the seven reserved migration filenames in ascending order;
   - the C07 connected residual list; and
   - `ordinaryAnswerServingChanged: false`.
2. `C00-anchor.md` records the observed base/head, exact plan/design hashes, accepted receipt imports, migration absence proof, dry-run gate route, retained/deferred boundaries, and the fact that no verification command, product change, document operation, provider call, connected service, migration apply, deployment, push, or PR occurred.
3. Preserve all P00-P07 receipts and accepted artifacts byte-for-byte. Do not modify P08A artifacts.
4. Update `.superpowers/sdd/progress.md` to show C00 as a candidate awaiting independent review. Replace the prior reviewed-plan hash with the exact current hash recorded above. Mark the P08A `20260830215420_add_corpus_scoped_retrieval_v3.sql` allocation superseded rather than active, and record `20260831106000_add_source_ingestion_retrieval_kernel.sql` as the sole continuation retrieval reservation. Product work remains paused until that review is clean.
5. The independently reviewed C00 preflight correction closes the conditional P08A migration-reuse option, checkpoints the planning inputs, proves migration ordering, and records the repository selector's real categories. The design and plan must remain byte-identical to the hashes above after that review.

## Required source-only checks

Run and record exact outcomes:

```text
git rev-parse HEAD
git merge-base --is-ancestor 03aa32d731d1cb9009be55213580e9ea3994017c HEAD
rg --files supabase/migrations | rg "20260831100000|20260831101000|20260831102000|20260831103000|20260831104000|20260831105000|20260831106000"
node -e "const fs=require('node:fs');const reserved=['20260831100000_retire_ingestion_worker.sql','20260831101000_fence_ingestion_leases_and_repairs.sql','20260831102000_stage_shadow_document_generations.sql','20260831103000_activate_retained_document_generations.sql','20260831104000_create_document_admission_events.sql','20260831105000_add_document_technical_activation.sql','20260831106000_add_source_ingestion_retrieval_kernel.sql'];const existing=fs.readdirSync('supabase/migrations').sort();const latest=existing.at(-1);for(const name of reserved){if(existing.includes(name))throw new Error('reserved migration exists: '+name);if(name.localeCompare(latest)<=0)throw new Error(name+' does not sort after '+latest)}if([...reserved].sort().join()!==reserved.join())throw new Error('reservations are unordered');console.log(JSON.stringify({latest,reserved}))"
node scripts/ci-change-scope.mjs --json --files worker/main.ts,supabase/schema.sql,src/app/api/upload/route.ts,src/lib/document-ingress-safety.ts,src/app/api/ingestion/quality/route.ts,src/lib/rag/source-ingestion-retrieval.ts
npm run verify:pr-local -- --dry-run --files worker/main.ts,supabase/schema.sql,src/app/api/upload/route.ts,src/lib/document-ingress-safety.ts,src/app/api/ingestion/quality/route.ts,src/lib/rag/source-ingestion-retrieval.ts
npm run verify:pr-local -- --dry-run --extended --files worker/main.ts,supabase/schema.sql,src/app/api/upload/route.ts,src/lib/document-ingress-safety.ts,src/app/api/ingestion/quality/route.ts,src/lib/rag/source-ingestion-retrieval.ts,src/components/ClinicalDashboard.tsx
```

Expected:

- initial HEAD is the implementation base;
- ancestry succeeds;
- the migration search exits 1 with no matches;
- all seven reservations sort after the observed latest migration in exact order;
- the scope mapper reports `ingestion_sast_changed: true`, `db_changed: true`, and `rag_eval_changed: true`;
- the primary dry run prints the selected fail-closed gate plan without executing a verification command;
- the extended dry run adds UI scope without executing a verification command; and
- privacy and clinical risk are routed to explicit reviewers because the selector has no separate flags for them.

Also run targeted Prettier validation for the owned metadata files and verify the plan/design hashes remain exact. Do not run product tests, `check:production-readiness`, providers, hosted Supabase, Storage, scanners, model downloads, migration apply, reindex, upload, or document/corpus processing.

## Candidate checkpoint and report

Create one explicit-path local candidate commit only after the metadata and source-only checks are complete. Suggested subject:

```text
chore(rag): anchor ingestion continuation
```

Never push. Write the full report to:

`docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/C00/C00-report.md`

The report must include changed files, exact commit, exact commands/outcomes, imported receipt hashes, self-review, and concerns. Return only status, commit, one-line check summary, concerns, and the report path.
