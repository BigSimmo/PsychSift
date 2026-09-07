# U02 ING-F02 independent ingestion review 1

Specification: PASS.
Quality: PASS.
Critical findings: none. Important findings: none. No high-confidence correction-induced defect found in the complete frozen range.

## Reviewed identity and scope

- Worktree: C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database.
- Branch: codex/rag-local-build-20260822.
- Immutable TASK_BASE: ae500cafc661d9a06536d09d73d827726f057ffa.
- Immutable TASK_HEAD: 876cb09405d81d9c4a8a4931b3d735fd252934ba.
- Complete range: ae500cafc661d9a06536d09d73d827726f057ffa..876cb09405d81d9c4a8a4931b3d735fd252934ba.
- Canonical package: docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U02/U02-audit-correction-review-1.diff.
- Observed package SHA256: d56e5a23c0c9b4c6c1a16f8f34eb817cff18edef931413353156119c58b2a628.
- Original U02 base: 08df4cddce457ba016b0d31fcf7202a4b564776a.
- Accepted original product: 6adb834e48b3c1af4579ef22738d942803ab6893; ancestry to correction base checked locally.
- Actual full corrective diff: exactly supabase/functions/_shared/source-anchored-summary.ts and tests/document-enrichment.test.ts; 152 insertions, 1 deletion. Comparing all eleven original U02 product/test owners from the accepted original product to the reviewed head also shows only these two changed owners.
- Start and end tracked status were empty using git status --short --untracked-files=no; HEAD remained the requested head. Protected 1/ and unrelated untracked content were not enumerated.

Read applicable worktree AGENTS.md, its inline review throttling, docs/codex-review-protocol.md, the current corrective dispatch brief, and the supplied original task context. This older worktree has no docs/agents/codex-review-throttling.md; its root contains that policy inline. No nested applicable AGENTS.md was present for the two product paths. Controller supplied the exact-head lookup result (no atHead entries) and explicitly requested a fresh independent review. Controller owns the ledger append/checkpoint; this reviewer wrote only this outside report, as assigned.

## Specification assessment

1. The actual defect is corrected at its single shared producer seam (source-anchored-summary.ts:366). Joining projected claims with one ASCII space agrees with canonicalSourceAnchoredText's NFKC and whitespace rules. Both Node aggregate fields already use this same projector (document-enrichment.ts:698, 735); no second normalizer, aggregate exception, or adapter workaround was introduced.
2. Exact equality remains enforced by normalizeSourceAnchoredSummary: structured summary and profile.overview must both equal the nonempty shared projection. Malformed individual evidence is not canonicalized or truncated by this change. The existing eight-claim projection maximum, 600-unit item limit, 5000-unit aggregate limits, and ordinary category maximum of six remain intact. These existing string bounds use JavaScript string.length (UTF-16 code units), not UTF-8 byte counts. Eight maximal accepted items produce 8 * (600 + 2) + 7 = 4823 code units, within both aggregate bounds; the delimiter replacement changes no aggregate length.
3. New tests exercise the actual mocked provider-response adapter rather than supplying summary_version and taking the normalized-payload shortcut. They call upsertDocumentEnrichment, inspect the persisted contract metadata, and normalize the output again. The one-, two-, and eight-item cases cover the actual round trip; eight items are distributed 6+2. Canonical Unicode at the item limit is preserved. Oversized items fail through the real producer with the expected inner cause.
4. Negative cases preserve exact aggregates, canonical item whitespace/NFKC, array/object shape, per-category limits, nested chunk/image membership, derived pages, generation authority and unsupported nested fields. Existing frozen-value, UUID, ordered/unique anchors, ISO time, model/fallback and Unicode label-boundary tests remain unchanged.
5. Integration with original U02 remains intact: Node preflight rejects absent/mismatched generation and P05 policy before provider/persistence; selected chunks remain coverage-aware. Worker inline enrichment reloads live generation and policy authority after commit. Edge loads bounded exact-generation source rows and validates/rebuilds the summary before its completion-gate decision. Structured model authority is supplied independently by Node/Edge configuration. The deterministic fallback remains fixed, anchored, zero-label and provisional under the existing strict completion gate.
6. Node validates a complete replacement before summary upsert, persists generated labels afterward, and marks projection completion last. Repair/currentness checks retain exact stored-column comparisons and provider-free repair of valid stored payloads. The document metadata patch still owns only rag_enrichment_version, rag_indexing_version, rag_memory_version, rag_enrichment_updated_at and generated_label_count; it does not overwrite organization_profile or organization_profile_version. Edge's existing transaction/projection behavior is unchanged.
7. No schema/RPC, generation commit, queue concurrency, quality-gate, worker-operation, Answer/search, model-authority or metadata-owner implementation was changed. There is no reindex proposal or corpus operation in this correction.

## Quality assessment and saved execution evidence

The production edit is one delimiter plus a clarifying comment. The regression test targets the integration failure that the former single-item fixtures missed. No unnecessary dependency, new abstraction, export, source truncation, type suppression or test relaxation was added.

Consumed saved raw outputs; no test or compiler rerun was performed by this reviewer:

- RED: node scripts/run-vitest.mjs run tests/document-enrichment.test.ts -t "round-trips multi-item source-anchored summaries from the real producer". U02-audit-correction-red.txt: exit 1, 1 failed / 28 skipped; outer source_anchored_summary_generation_failed, explicit Caused by source_anchored_summary_profile_overview_invalid. This proves the intended product failure rather than an environment failure.
- GREEN, same command: U02-audit-correction-green-after-lease.txt: exit 0, 1 passed / 32 skipped. The earlier two lease-contention attempts remain failed environment attempts, not product failures or passes.
- Final selector: node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts. U02-audit-correction-final-tests.txt: exit 0, 4 files passed, 103 tests passed. These are saved actual runs, not fresh reviewer execution or a reused gate receipt. Writer records arbiter RUN with GATE_ARBITER off and GATE_RECEIPTS off, retaining coordinator/offline sandbox.
- Final Edge command: deno check --frozen --node-modules-dir=false --lock=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-native-composite-v2.deno.lock --import-map=C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation/U02-edge-native.importmap.json supabase/functions/indexing-v3-agent/index.ts supabase/functions/site-content-sync/index.ts.
- U02-audit-correction-edge-native-lock-v2.txt records both Check roots, DENO_EXIT_CODE=0, exclusive coordinator lease released, IDENTITIES_UNCHANGED=true and EXIT_CODE=0. Recorded versions: Deno 2.9.4, V8 15.0.245.2-rusty, TypeScript 6.0.3. DENO_NO_PACKAGE_JSON=1 was process-local. No Download event appears; this is not a network-free claim.

Edge disposition: PASS as a native Edge type-check equivalent using the reviewed composite of existing locked dependencies. This is not a literal npm wrapper pass and does not repair or prove that wrapper's application-package discovery path.

I read the actual v2 wrapper, native map, both native addenda, preceding native composite disposition, v2 supplemental disposition and preparation evidence. Independent read-only object comparison confirms that v1 differs from the original Deno lock only by entities@8.0.0 and its exact specifier; removing those entries reproduces the original object. The entities version/integrity matches the existing package-lock and has no additional dependency graph. V2 equals v1 with workspace discovery metadata removed, ignoring JSON key order. The map contains exactly entities and entities/decode targeting the same native npm version, not substitute declarations. The wrapper retains both original roots, frozen checking, same cwd, unchanged source, original locks and coordinator environment. No product-import remap, compiler relaxation or new dependency version is hidden in the successful route. Previous original-lock, direct-declaration TS2749 and first-composite frozen failures remain failed historical evidence; only the later reviewed native route passed.

Independently rechecked SHA256 values match the final saved before/after identities:

- deno.lock: b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9.
- package-lock.json: f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063.
- Outside composite v2 lock: 6e5122daa4915ca299551e5f67251e910f38168a3f3ff02c8b67e693388bb6c6.
- Native import map: be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93.
- Product helper: a2fdb6b4f4dd6e7f3a692c822a2a9c99439d1db2c4a58a664f42cd8f253e97f2.
- Product test: 56aa59c3906d9aada65a7cc93f0088738feaf24af8c567248f26a2ee811e8fad.

## Residual limits

- Highest residual product risk is semantic support: valid anchor membership and declared direct/partial support do not prove that a claim is entailed by its source. This correction does not implement or accept F03 semantic adjudication.
- Existing persistence/activation races, live queue/SQL concurrency, deployment, native extraction, provider/model parity and real-document quality remain unproven. This review confirms unchanged code boundaries, not live transactional acceptance or F08/U03 completion.
- No check:production-readiness, broad Answer/search baseline, providers, worker/native extraction, migrations, runtime or hosted checks were run by this reviewer. They are outside the bounded current review authority.
- Historical eval:rag:offline remains exit 1: four failed suites, 45 failed and 586 passed overall. It is not green, not inherited as current acceptance, and not renewed by omitting the unrelated baseline here.
- The two-file candidate and this independent verdict are bounded local evidence. They are not deployment, production readiness or programme acceptance.

## Observed reviewer session

Selected only session_meta and turn_context from the exact own log located using CODEX_THREAD_ID, not unrelated log contents:

C:/Users/joshs/.codex/sessions/2026/09/07/rollout-2026-09-07T20-00-14-01a07bbd-89a4-7302-bbbb-576438c7c616.jsonl

- session_meta.id: 01a07bbd-89a4-7302-bbbb-576438c7c616.
- session_meta.agent_path: /root/u02_ingestion_review.
- session_meta.source.subagent.thread_spawn.parent_thread_id: 01a07b47-4623-7e90-825a-ec25116b8531.
- session_meta.source.subagent.thread_spawn.agent_role: ingestion-worker-reviewer.
- session_meta.model_provider: openai.
- session_meta.cwd: D:\Repos\Database (inherited startup cwd; repository inspection explicitly used the assigned worktree).
- turn_context.model: gpt-6-astra.
- turn_context.effort: high.
- turn_context.reasoning_effort: absent/null.
- turn_context.collaboration_mode.settings.model: gpt-6-astra.
- turn_context.collaboration_mode.settings.reasoning_effort: high.

These are observed local routing fields, not merely the requested configuration and not backend execution attestation. No child agents, repository writes, tests, providers, native workers, commits, publishing or other-task messages were used. This report is the sole authored file.
