# U07 — trusted admission local acceptance

Task 7 is complete at the authored source and mocked/offline boundary. Both administrator uploads and configured backend imports now use one authority-bound admission contract and atomic SQL entry point. Admission does not grant provider clearance, public visibility or clinical approval.

## Corrected acceptance — 13 September 2026

The initial acceptance below was reopened for U07-R1 and U07-R2. Corrective product `e55614203649f240c19e7fa7e91c0aa453661bda` closes both at the local source/offline boundary. The earlier records remain unchanged historical evidence.

- U07-R1: SQL retains only explicit naming/provenance/diagnostic metadata and establishes conservative server-owned clinical, extraction, catalogue and indexing values. The full original request fingerprint remains bound before filtering.
- U07-R2: a definitive Storage collision requires complete byte/hash verification, followed by upload of current verified bytes to a fresh attempt-owned sibling. The borrowed object is never admitted or compensated. Replay reconstructs the persisted path and original naming while retaining current caller authority and retry budget. A concurrent winner updates importer naming caches and replay accounting correctly.
- **218 composed correction passes across four affected suites:** 210 unchanged passes retained from `U04-u07-correction-1-result.json` (218 passed, exit 0, 10.39 seconds), plus 8 fresh passes in correction 2 (170 deliberately unselected cases, exit 0, 1.70 seconds). The follow-up covered two changed route fixtures and the complete upload/import admission suite. All 702 final input pins matched. Focused compiler correction 2 passed with 15 roots, zero diagnostics and zero input/I/O violations; correction 1's three test-fixture typing errors remain recorded as failed evidence.
- Function-grants source check passed for 200 functions; migration-role source check passed for 530 inputs. Independent schema, ingestion and clinical-governance correction reviews returned Specification and bounded Quality PASS. No open P0–P2 correction finding remains. No SQL or hosted race was executed.
- Acceptance: `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U07-local-acceptance-2.json`, SHA-256 `b13cc2f6290002730a104f1217a692dc0efa9779f0d8526c7d5d32141679bf7e`. It binds all 16 current product files and the [corrected original-range package](../../execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U07/U07-corrected-original-range-review-2.diff), SHA-256 `b2ac55542223920a011bb9fc1fc937730ea23bdbb6c8b39a42f1264d1e46e841`.

The correction used disjoint Sol implementation owners, focused independent reviews, one batched correction and reused passing evidence. No broad tests, new recovery framework or renewed programme audit was added. Actual Storage error/read visibility, PostgreSQL race ordering, maximum-size collision memory and governed reconciliation of never-admitted uncertain objects remain runtime acceptance limits; no blind cleanup is authorised. U08 remains unstarted.

Checkpoint documentation qualification: the full governing-plan link check exited 1 for 27 pre-existing missing/planned paths. Rechecking the unchanged parent plan produced the exact same diagnostic log; no correction-introduced link error was found. These references remain unresolved, and this full-plan check is not reported as green. Index, inventory and script-reference checks passed.

## Initial acceptance record — retained history

- Original base: `97860697a6dcc5646b083ff66ea25167e55082f1`.
- Product commit: `9918841ee520c4d82287ce229b07a5e14b208171` on `codex/rag-local-build-20260822`.
- Canonical [original-range review package](../../execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U07/U07-original-range-review-1.diff): `4cb519e0b232fb38ae8b32d5ca13f1e3fd3a33dc2c7b2d78cc909fbce2045674`.
- Local acceptance: `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U07-local-acceptance-1.json`, SHA-256 `a19703441229234765cfa1919ddd25405a5ab2673a9b1bbb48b30b8ff241e2b6`. It binds all 16 committed file hashes to the independently reviewed snapshot, the original task brief, exact evidence and efficiency policy.

## Result and governing decisions

Administrator admission derives identity from the same verified session and requires administrator app metadata, AAL2 and qualifying authentication within 900 seconds. Backend admission separately requires an enabled principal, a hashed 64-hex capability and its fixed staging owner. Generic service-role possession is insufficient; provisioning remains C07 work. The 900-second authored policy is not hosted-assurance proof.

Explicit source role, rights/currentness, owner, purpose, supported features and processing policy are validated without deriving authority from document prose. Unknown/review-required rights may be recorded but grant no processing clearance. The exact Australia scope, link-only exclusion and pending-publication boundary remain intact.

Document, job and immutable admission event share one transaction. Replay binds the full canonical request and returns the original identities; changed replay conflicts. Audit evidence stores filename/path hashes rather than raw values. Storage compensation remains limited to known failures before commit; ambiguous outcomes retain the object for reconciliation. Original naming survives later display edits. SQL adds `uploaded_at` after replay binding; the configured 1–100 retry budget is bound explicitly. The client metadata size preflight is conservative input checking; PostgreSQL's 65,536-byte JSONB representation limit remains authoritative and never truncates evidence.

## Executed local proof

- **265 composed passing tests across nine focused suites:** 169 fresh private-access cases in `U04-u07-focused-4-result.json`, plus 96 unchanged passes across eight suites in attempt 3. The only changed manifest input is the private-access test file; all 702 final input pins matched. The existing explicit-discovery launcher/configuration/host was retained.
- Focused compiler `U04-launch-focused-typecheck-33.ps1 -Attempt u07-2`: exit 0, 15 roots, zero diagnostics and zero input/I/O violations.
- `node scripts/check-function-grants.mjs`: exit 0, 200 functions. Protected-safe migration-role adapter: exit 0, 530 tracked/explicit inputs, immutable history retained. No SQL was executed.
- Protected-safe documentation adapter: exit 0; index/schema coverage, 57 tracked groups, script references and inventory checked. Scoped formatting and `git diff --cached --check` passed. No routes or component-import edges changed, so sitemap/adoption regeneration was unnecessary. The local commit used the existing process-scoped documentation-hook opt-out to avoid its prohibited unrelated-untracked discovery; the relevant actual documentation validators ran separately.
- Independent Sol/High clinical and schema reviews each supplied Specification and bounded Quality PASS; Astra integrated the corrections and bound reviewed hashes to committed blobs. Reports 1 and 2 are retained outside the repository with the acceptance record. The schema review's initial missing-delete-trigger finding was retracted after the existing later trigger was identified; no original defect is claimed.

Failed evidence is retained: attempt 1 exited 1 (246 passed / 19 failed); attempt 2 was refused before tests by the existing prefix-count guard; attempt 3 exited 1 (260 passed / 5 failed); compiler attempt 1 reported three test-typing diagnostics. Attempt 3 is not labelled green. Corrections restored intended fixtures, including explicit existing summary telemetry arguments; Answer product code did not change. No failed-suite exception was adopted.

## Remaining acceptance and next dependency

PostgreSQL transaction/race/grant/RLS behaviour, hosted JWT assurance, C07 capability provisioning, real/native extraction, provider operations and production readiness remain unproved. U08 must enforce clearance before actual provider egress; U10 owns later publication/activation. No migration, worker/import, real document, provider, activation, push, publication or deployment ran for U07.

Historical U02 offline evaluation remains **exit 1, four failed suites, 45 failed and 586 passed**; signing remains 159 passed / 2 failed; production readiness remains exit 1 (2 pass / 5 warn / 2 fail). These are unresolved, were not rerun without changed evidence, and cannot automatically carry into later acceptance.

The single live controller ledger remains `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U04-live-checkpoint.json`. The adopted efficiency techniques remain in `remaining-programme-efficiency-20260913.md`: concise briefs, appropriate model/effort, disjoint owners, stable-block review, shared evidence, focused correction checks and one controller ledger. No additional functionality or acceptance was deferred. U08 is the next unstarted unit; pin its new base before dispatch. P00–P07 history remains retained, P08A superseded and the retrieval kernel default-off.
