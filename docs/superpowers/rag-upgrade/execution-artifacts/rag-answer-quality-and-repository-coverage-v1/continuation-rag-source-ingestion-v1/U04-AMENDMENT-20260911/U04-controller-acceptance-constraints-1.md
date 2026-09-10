# U04 acceptance constraints for the concrete brief

Preparation only, at C01 evidence checkpoint `b335cfbe5e9953a4d3c67ca40a3f1c1f4b41fa08`. U03 product `bbd978a5708ed70c51e293aab079ead9c5bcb1ce` is locally accepted; its full-range reviews and limitations are preserved in checkpoint `10363d4d8f4c51d7c3958fb28800ed416c985425`. This document does not dispatch an implementer, choose an unreviewed storage design, or establish a passing gate.

## Required result

Task 4 stages and evaluates one exact candidate generation per explicitly bounded document wave. The ordinary live pointer and all ordinary visible evidence stay at their accepted baseline. Standard ingestion retains its existing commit behavior. U05 alone supplies promotion, rollback, retention and cleanup; U10 later supplies technical eligibility. Staging, evaluation, technical eligibility, activation and ordinary Answer availability remain distinct.

The durable operation reservation must reconcile the wave's candidate UUID with U03's server-owned write generation. A caller-supplied UUID is not mutation authority. Source/version/event, owner, baseline generation, state digest, attempt identity, expiry and operation identity must remain bound and rechecked under the existing lock order. An expired or replaced attempt cannot stage, seal or complete the replacement. Do not emulate a live G0-to-C handoff to run candidate enrichment.

The storage decision must name how each existing artifact owner writes candidate C without overwriting G0. Include pages and native/structural evidence, chunks/index units/embeddings/fields/table facts, images/captions/private objects, sections/cards/deep-memory generations and anchors, summaries/generated labels/projection markers, owned document/quality metadata, aliases and stage/job/attempt provenance. Not every family must exist in every document; absence must have a typed expected/not-required/failed/skipped disposition, not an invented successful count. Caches are reusable inputs only under existing authority; U09/U13 retain representation-identity improvements.

Preserve exact source text, relationships and provenance supplied by the existing producer. Do not truncate data into a manifest preview, synthesize semantic support, silently replace a richer result with a fallback, or fabricate newly supported extraction capability. U09 owns new extraction capability and full native fixtures. U04 owns faithful staging of the available artifact inventory and truthful limitation propagation.

## High-yield regression matrix

1. Exercise the actual worker orchestration with injected provider/database fakes: normal jobs call the current commit path; validated persisted shadow jobs stage candidate C and never call commit, mutate live metadata/aliases, or complete a live generation. Caller-only mode flags cannot enable shadow writes.
2. Reserve the same C for two documents with different baseline generations. Reject a different requested UUID, changed population/state/source authority, conflicting live attempt and stale/expired token. Retry/reclaim identity must not reuse or delete an earlier attempt's sealed evidence without exact authority.
3. Drive real summary/deep-memory adapters through candidate context while durable Fence remains G0. Preserve manual labels, organisation-owned metadata, current quality and aliases. Returned persistence errors, malformed results and lost responses retain U03 fatal/cancellation and non-destructive cleanup semantics.
4. Use an independently declared expected fixture inventory, then inject a failure at each material boundary: pages/structure, base artifacts, generated families, Storage attachment, inventory seal and stage completion. Reconcile expected/retained/failed/skipped and explicit cap/conflict reasons. A receipt cannot infer completeness merely from whatever rows survived.
5. Prove candidate invisibility at the actual affected reader/helper seams and exact-generation evaluation visibility. Generation-addressed pages must coexist; no candidate labels, overview, quality or alias can leak through a document-level projection. U05 implementation is not required to prove coexistence; do not implement promotion early.
6. Evaluate the bounded baseline before staging and the same bounded population at C afterward. Validate exact plan, stage receipt, recovery evidence and metric/report digests; missing metrics, incomplete inventory, source/state drift and mismatched generation fail closed. Evaluation cannot promote or mutate live state. Unset production evaluation context must preserve ordinary semantics.
7. Import command modules without effects. Pure plan/receipt/evaluation transitions use injected fakes. Connected adapters refuse absent/expired/wrong-project/wrong-operation/wrong-population operation manifests before clients, source reads or mutation. No connected adapter is executed during this unit.

Each positive assertion must reach the actual relevant producer or orchestrator. Source-only SQL contracts supplement mocked caller behavior; they are not transactional runtime proof. Preserve SQL concurrency/rollback/privilege schedules as separately authorised evidence.

## Verification and dispatch boundaries

Use one fresh Astra High implementer after the concrete file/symbol/storage/gate brief is frozen and required independent xhigh amendment review is complete. Root owns gate selection, index, commits and acceptance; one repository writer, no recursive delegation. Review the entire original U04 base through every correction with the required ingestion, schema and RAG specialists. Preserve every failed result and the exact base.

The old Task 4 selector and gate list are prospective inputs, not inherited passes. The verification owner must inspect the real current wrappers and propose protected-safe equivalents where needed. `eval:rag:offline` is explicitly listed by Task 4: resolve its applicable acceptance role against the actual U04 diff and current evidence. Do not inherit, relabel, automatically waive or silently rerun the historical U02 exception. That history remains exit 1, four failed suites, 45 failed and 586 passed overall, not green.

No provider, hosted operation, SQL replay/application, native/real-document processing, worker/server, operational stage/evaluate/promote/rollback/cleanup command, activation, deployment, publication, code transfer or other-task message is authorised here. Tests use authored in-memory fixtures and mocks. The kernel remains default-off and P08A superseded.

The smallest concrete storage integration and its exact additional owners remain pending the read-only owner preparation. This document must not be used as an implementation brief by itself.
