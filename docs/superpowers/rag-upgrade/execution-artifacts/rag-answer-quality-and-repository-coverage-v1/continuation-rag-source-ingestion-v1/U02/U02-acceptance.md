# U02 acceptance record

## Range and identities

- Unit: `U02` / Task 2 / validated source-anchored summary payload
- Original task base: `08df4cddce457ba016b0d31fcf7202a4b564776a`
- Original candidate: `4621b3000a05cd88494f4b87d807c8761d7f862f`
- Correction checkpoint base: `b68a8de1476d08ec46a72f86f10d65428b1f7a11`
- Accepted product head: `6adb834e48b3c1af4579ef22738d942803ab6893`
- Correction subject: `fix(ingestion): close U02 review gaps`
- Implementers: `/root/u02_implementer`, then sole correction writer `/root/u02_correction_impl`
- Final ingestion reviewer: `/root/u02_ingestion_review_2`
- Final clinical reviewer: `/root/u02_clinical_review_2`

## Immutable packages

- Original package: `U02-review-1.diff`
- Original package SHA-256: `35468C6C92B07458BF0E71DE8B1C708A66F1EFCC89C3BE7D4AB42D5DEBAEFE09`
- Correction package: `U02-fix-1-review.diff`
- Correction package range: `b68a8de1476d08ec46a72f86f10d65428b1f7a11..6adb834e48b3c1af4579ef22738d942803ab6893`
- Correction package SHA-256: `14DC41B94AB6FBDBD69B62F2450EDE94ED126B059A67C91F290D975DD7027F0D`

The correction package was generated from the exact final reviewed range after both read-only verdicts. The verdicts establish that range, not independent verification of the subsequently recorded package hash.

## Review and correction history

The first independent review round returned specification issues and task quality `Needs fixes`. Its ingestion and clinical reports required strict primitive validation, exact fallback projection, Unicode-safe boundaries, complete projection parity, independent Edge model authority, marker ordering, live generation/policy reload, enrichment-only metadata patching, preflight ordering, and a focused provisional-fallback contract.

Task authority selected the strict U02-only boundary: Edge fallback remains provisional; no schema, RPC, gate-invariant, Answer, or search expansion; and the reproduced offline baseline is an explicit acceptance exception.

Correction loop 1 used test-first development. Its initial correction RED was 11 failed and 85 passed tests. Successive read-only ingestion reviews found retry and organization-authority gaps; each follow-up began with a focused RED. The final ownership-boundary RED was 1 failed and 97 passed tests and proved that a manual override written after the last read could be overwritten by a generic deep-merge patch.

The final correction leaves `organization_profile` and `organization_profile_version` entirely outside U02 metadata patches. Those fields remain with their dedicated organization owner, while both normal completion and current-summary retry heal the same five U02-owned scalar stamps.

The final independent reviews returned:

- `/root/u02_ingestion_review_2`: specification `PASS`; task quality `PASS`; no P0-P3 findings.
- `/root/u02_clinical_review_2`: specification `PASS`; task quality `PASS`; no P0-P3 findings.

Both were read-only static reviews. They did not rerun the implementer's checks.

## Verification evidence

- Original immutable RED: exact four-file selector exited 1 with 22 intended failures and 62 existing passes before original production edits.
- Initial correction RED: same selector exited 1 with 11 failed and 85 passed tests.
- Metadata-retry review RED: same selector exited 1 with 1 failed and 96 passed tests.
- Concurrent-organization review RED: same selector exited 1 with 2 failed and 96 passed tests.
- Final ownership-boundary RED: same selector exited 1 with 1 failed and 97 passed tests.
- Final focused GREEN: same selector exited 0 with all 4 files and all 98 tests passed.
- `npm run check:edge:functions`: exit 0; transient `deno.lock` output restored.
- `npm run eval:rag:offline`: exit 1. Fixture/manifest validation passed. The isolated failing subset remained the same four Answer/search suites with 45 failed and 56 passed tests; overall, 4 suites failed and 22 passed with 45 failed and 586 passed tests.
- Focused formatting and diff/static artifact checks passed.

The offline failure is an authorized, exactly reproduced U02 acceptance exception. It is not green and is not represented as a passed gate.

## Acceptance and residuals

U02 is accepted locally at product head `6adb834e48b3c1af4579ef22738d942803ab6893`. Edge fallback remains intentionally provisional and deferred under the unchanged strict completion gate. No schema, RPC, migration, ordinary Answer/search, or P08A expansion is included.

Evidence remains static and local only. Runtime database concurrency and provider parity are unproven. No connected enrichment/backfill execution or hosted database behavior is established by this acceptance.

No provider, hosted Supabase, API, connected script, migration apply, deployment, reindex, production-readiness check, push, or pull request occurred. U03 has not started.
