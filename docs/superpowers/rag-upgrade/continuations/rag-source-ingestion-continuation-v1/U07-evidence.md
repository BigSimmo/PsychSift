# U07 — trusted admission local acceptance

Task 7 is complete at the authored source and mocked/offline boundary. Both administrator uploads and configured backend imports now use one authority-bound admission contract and atomic SQL entry point. Admission does not grant provider clearance, public visibility or clinical approval.

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
