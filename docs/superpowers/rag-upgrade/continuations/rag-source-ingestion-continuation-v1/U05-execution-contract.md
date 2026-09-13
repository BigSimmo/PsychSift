# U05 generation lifecycle contract

Original task base: `b92466d426e8269642bd99c8a200930239224b54` on `codex/rag-local-build-20260822`. U05 belongs to C02; it does not close C02 or resume U06. The original handoff and accepted U04 evidence remain unchanged.

## Reviewed implementation

- Promotion binds the exact plan, stage receipt, evaluation, recovery evidence, population and distinct promote authorization. Required retention deadlines follow the actual operation clock. Promotion cannot first-publish a staging document.
- The private pointer core and deletion core remain disjoint. Narrow wrappers atomically change the serving projection, including local-worker producer aliases, and retain append-only operation receipts. Manual and foreign aliases are preserved.
- Governed shadow baselines require exact active/retained generation rows. Typed legacy baselines and intentional null G0 instead require immutable U04 baseline/member, promotion-transition and digest-bound rollback-snapshot proof. Missing governed members cannot use that compatibility path. No synthetic baseline jobs, waves or generation rows are created.
- Receipt-bound rollback restores the retained baseline and preserves the failed candidate. It requires distinct operations and ordered receipt times; expired recovery freshness alone does not invalidate the original promotion's bound evidence.
- Cleanup defaults to dry-run, requires exact sorted document/generation pairs, count and digest, and rechecks current eligibility under locks. The CLI is import-safe and rejects a destination mismatch before client creation, health checks or RPC. There is no broad all-eligible apply mode.
- Cleanup receipts retain an exact `privateObjectReferenceInventory` and `physicalDeletionAuthorized: false`. They authorize no physical storage deletion. A later disposal manifest must revalidate current rights and live/shared/new references at actual deletion; U06 documents this and U13 owns cleanup/recovery proof.
- U10 must replace the private, always-refusing `require_document_generation_technical_gate_v1` with authoritative immutable lookup. Promotion validates all bindings and this gate before returning even a replay receipt. U05 is intentionally unable to activate from supplied `GO` claims or digest strings.

## Local evidence and routing

The sole live controller ledger remains `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U04-live-checkpoint.json`; its historical filename does not change the active unit. Final U05 acceptance, per-case accounting and commit binding are stored beside it as `U05-local-acceptance-1.md`, `U05-final-test-accounting-1.json`, `U05-local-acceptance-manifest-1.json` and `U05-local-commit-binding-1.json`. These records distinguish executed tests, retained passing cases, failed attempts and blocked dispatches; their existence and verdict must be checked before claiming completion.

The controller uses Astra for architecture, integration and final judgment; Sol Medium for bounded lifecycle work; Sol High for SQL/shared components and independent ingestion/schema review; Luna Medium only for mechanical work that saves more effort than its handoff costs. Agents have exclusive owners and concise briefs. Four slots are a ceiling, not a target. The controller records all 20 adopted efficiency options and evidence reuse in one ledger. Requested model/effort and accepted dispatch are observable; actual provider routing or billing is not independently attested.

Focused lifecycle/pipeline/driver cases, SQL source contracts, the affected compiler roots and source grant/history checks form the local gate. Reuse unchanged passing cases and completed independent inspections, then assess only affected corrections. Do not rerun the entire U04 fixture matrix, offline evaluation, broad lint/build or a new review wave merely for reassurance. Source contracts are not executed SQL proof.

## Unchanged operational boundaries

No migration or SQL execution, worker, provider, real/native document processing, operational promotion/rollback/cleanup, storage deletion, activation, deployment or publication is authorized by this record. PostgreSQL behavior, grants in an actual database, transactional/race behavior, U10 receipt resolution and clinical usefulness remain separately gated. The retrieval kernel stays default-off and P08A remains superseded.

Historical U02 offline evaluation remains **exit 1, four failed suites, 45 failed and 586 passed tests overall**. It is not green and its accepted exception does not carry into U05 or future units. Signing evidence remains 159 passed/2 failed, unresolved and unwaived. Retained production-readiness remains exit 1 with 2 passed/5 warnings/2 failed; configuration absence is not repaired or waived by local code proof. These residuals must remain explicit at later acceptance.
