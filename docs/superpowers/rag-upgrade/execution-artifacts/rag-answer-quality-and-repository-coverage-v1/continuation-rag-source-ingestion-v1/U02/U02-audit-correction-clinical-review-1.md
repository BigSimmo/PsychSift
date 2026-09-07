# U02 audit correction: independent clinical governance review 1

Specification: PASS.
Quality: PASS.
Critical findings: none.
Important findings: none.

These verdicts cover the bounded ING-F02 producer/projection correction and its regression tests. They are not semantic-support, runtime, production or whole-programme acceptance.

## Immutable identity and scope

- Worktree: C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database
- Branch: codex/rag-local-build-20260822
- Full reviewed TASK_BASE: ae500cafc661d9a06536d09d73d827726f057ffa
- Full reviewed TASK_HEAD: 876cb09405d81d9c4a8a4931b3d735fd252934ba
- Canonical package: docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U02/U02-audit-correction-review-1.diff
- Independently observed package SHA256: d56e5a23c0c9b4c6c1a16f8f34eb817cff18edef931413353156119c58b2a628
- Actual complete range contains exactly supabase/functions/_shared/source-anchored-summary.ts and tests/document-enrichment.test.ts: 152 insertions, 1 deletion. I inspected the actual Git diff as well as the package identity.
- Original accepted task base: 08df4cddce457ba016b0d31fcf7202a4b564776a. Original accepted product: 6adb834e48b3c1af4579ef22738d942803ab6893. The latter is an ancestor of TASK_BASE, independently observed with git merge-base --is-ancestor, exit 0. These remain historical context, not this correction's test evidence.
- Original extracted task context SHA256 independently matches 47f3d143e6ba4dd19cdfe3e5aba62c90730f30dc4d177a301a45d9745f8eb33f.
- Initial and final git status --short --untracked-files=no were empty; final HEAD matched TASK_HEAD. No untracked inventory was taken.

I read applicable root AGENTS.md review/verification rules, docs/codex-review-protocol.md, the review skill, current correction dispatch brief, original extracted task context, current implementer report, clinical PR template and governing continuation rag-evidence-handoff.md. Tracked-file inspection identified no nested AGENTS.md applicable to the two product paths. The controller supplied the completed exact-head/scope ledger lookup (no atHead entries) and explicitly owns aggregate ledger recording after both reviews; I did not mutate repository bookkeeping.

## Specification assessment

The realistic failing path is a structured provider response with two supported profile items. modelProfile in src/lib/document-enrichment.ts:669 derives pages and calls the shared projector for overview; generateSourceAnchoredSummary at lines 735-759 uses that same projector for summary, constructs authority-owned fields, and calls the strict normalizer before persistence. Previously the projector inserted a newline that boundedCanonicalText necessarily rejected. The change at supabase/functions/_shared/source-anchored-summary.ts:366 uses a single ASCII space, so both aggregates and each validated item follow one existing canonical-whitespace contract.

The fix preserves exact equality: normalizeSourceAnchoredSummary at lines 616-623 still requires summary and overview to equal the projection, and rejects empty projections. It does not normalize malformed claim text into acceptance. NFKC/whitespace equality and the 600-unit item / 5000-unit aggregate JavaScript string-length limits remain unchanged at lines 182-186, 296 and 349/573. Eight maximum-length items produce 4823 string units, within the existing aggregate bound. The existing at-most-eight projection selection remains unchanged; all profile collections remain present and validated. This correction adds no clipping, evidence truncation, category dropping or weaker bound. It does not prove completeness beyond that bounded projection.

The original fail-closed boundaries remain intact:

- Whole-summary source IDs still exactly match selected ordered authority arrays; nested chunk/image IDs remain ordered allowlist members, pages remain exactly derived, and supported items still require claim-level anchors (lines 237-337 and 511-572).
- Document/generation authority, selected-source generation checks, exact field shapes and complete profile vocabulary are unchanged. Malformed data throws before the Node summary upsert.
- Structured model/version remain authority-owned and explicitly compared. Fixed heuristic model/version, deterministic fallback text, empty labels and restricted fallback profile shape remain independently validated at lines 616-658.
- Node generation failure still throws source_anchored_summary_generation_failed with its cause; the correction adds no trust-on-error fallback. Edge ensureSummary still validates stored structured payloads and otherwise constructs the same provisional fallback, without presenting fallback as structured authority.
- Existing source-policy/generation preflight, coverage selection, summary-before-label persistence, incomplete/completed projection markers, and the five-field enrichment-owned document metadata patch remain unchanged. No organization-profile ownership moved.

The adopted R1-R5 handoff requirements remain requirements. In particular, R2 explicitly says U02 direct/partial/not_found labels do not establish semantic verification and ING-F02 does not implement semantic adjudication. No new code or test claims otherwise. ING-F03 support adjudication, ING-F08 persistence/schema work, U03, Answer/search and the separate RAG programme remain outside these verdicts.

## Quality and evidence assessment

The added tests at tests/document-enrichment.test.ts:670-817 exercise upsertDocumentEnrichment with a provider mock lacking summary_version, so the real provider-response adapter is reached rather than its already-normalized shortcut. They inspect the payload written through the persistence mock and run the strict normalizer again. The 1/2/8-item cases distribute eight items across the existing six-item category bound. They verify complete canonical Unicode strings, exact aggregates and derived actions. Negative cases retain explicit rejection of altered/newline/oversized aggregates, noncanonical item text, invalid nested chunk/image/page anchors, extra item fields, malformed collections, category overflow and generation mismatch. The 601-unit item fails through the producer rather than being truncated.

Saved execution evidence consumed, not rerun:

- U02-audit-correction-red.txt: the focused named regression exited 1, 1 failed / 28 skipped, with source_anchored_summary_generation_failed caused by source_anchored_summary_profile_overview_invalid. This is the expected product RED.
- U02-audit-correction-final-tests.txt: node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts exited 0; four files passed, 103/103 tests passed. The implementer records process-local receipt/arbiter off settings, RUN/off override, coordinator and offline sandbox retained. I did not reproduce the successful run.
- U02-audit-correction-edge-native-lock-v2.txt: Deno 2.9.4 / TypeScript 6.0.3 checked both indexing-v3-agent/index.ts and site-content-sync/index.ts, DENO_EXIT_CODE=0, EXIT_CODE=0, identities unchanged and exclusive lease released.

I inspected the final outside compiler wrapper, two-entry native import map, both independent composite-lock dispositions, v2 metadata addendum and evidence. The actual successful command retains --frozen and --node-modules-dir=false, both original function roots, explicit external lock/map and process-local DENO_NO_PACKAGE_JSON=1. The map uses native npm:entities@8.0.0 package exports, not replacement declarations. The reviewed v2 normalization preserves locked package identities/edges and omits root app-discovery metadata consistently with the disabled package discovery. No product/compiler suppression is present in the successful wrapper.

Independently matched current SHA256 identities against the saved successful check:

- Shared helper: a2fdb6b4f4dd6e7f3a692c822a2a9c99439d1db2c4a58a664f42cd8f253e97f2
- Test file: 56aa59c3906d9aada65a7cc93f0088738feaf24af8c567248f26a2ee811e8fad
- Repository deno.lock: b92c0d1c752f6d48da195ef062e473dfaca35f13e5cc692f8f95b92bed3881b9
- Repository package-lock.json: f969c2ddd1b058437b09eb61bf16b9ecc3bfb6ebb74539ec8e62ccdd7090e063
- Effective v2 external lock: 6e5122daa4915ca299551e5f67251e910f38168a3f3ff02c8b67e693388bb6c6
- Native import map: be863301cacda4921a9bc2bedaba51b4caf907bfe80e8c7c216a6be98a6d6d93

This supports the stated native Edge type-check equivalent using the reviewed composite of existing locked dependencies. The literal npm wrapper did not pass; original-lock discovery, declaration-map TS2749 and v1 frozen-lock attempts remain failed historical evidence. No runtime, bundler, deployed environment, network-free execution or provider parity is inferred.

## Clinical governance preflight and residual limits

Source-backed clinical claims still require linked-source verification before clinical use. The correction neither establishes semantic support nor changes evidence-review/currentness metadata or retrieval ordering. Fixtures added here are synthetic archive/Unicode text. No patient-identifiable workflow, document permission, service-role exposure, provider call or cross-border data path was added. There is no new Supabase target/configuration: the intended Clinical KB Database target sjrfecxgysukkwxsowpy remains the governing target; hosted configuration was not inspected. Server-only private-access boundaries are unchanged by the two-file diff. This aggregate-format alignment introduces no new clinical decision rule or deployment classification claim; formal TGA/clinical acceptance is not supplied by this review.

Highest residual risk is semantic adequacy/completeness of provider-produced assertions, which existing anchor membership alone cannot prove and this brief expressly does not implement. Real provider output, extraction fidelity, database concurrency, deployed model parity and live persistence remain unproven. No tests, production-readiness, broad offline evaluation, providers, real documents, native extraction, migrations, workers, deployment, commits, publication or contact with the separate RAG task occurred in this review. Production-readiness remains approval-gated under the continuation brief. Historical U02 offline evaluation remains exit 1, four failed suites, 45 failed and 586 passed tests overall; it is not green and is not inherited as an exception by this correction or later units.

## Own observed session identity

Selected only session_meta and turn_context records from the exact CODEX_THREAD_ID-matching local log; no broad log-content scan:

- Log: C:/Users/joshs/.codex/sessions/2026/09/07/rollout-2026-09-07T20-00-40-01a07bbd-efc5-7a70-866a-95e038c8f32b.jsonl
- session_meta.id / CODEX_THREAD_ID: 01a07bbd-efc5-7a70-866a-95e038c8f32b
- source.subagent.thread_spawn.agent_path: /root/u02_clinical_review
- source.subagent.thread_spawn.agent_role: clinical-governance-reviewer
- Parent thread: 01a07b47-4623-7e90-825a-ec25116b8531
- model_provider: openai
- turn_context.model: gpt-6-astra
- turn_context.effort: high
- turn_context.reasoning_effort: absent/null
- turn_context.cwd: D:\Repos\Database; repository commands explicitly targeted the bound ingestion worktree.

This is observed local routing metadata, not backend execution attestation. High is recorded literally; it is not xhigh. The controller confirmed high was the required unit-review setting. Only this outside report was authored; aggregate ledger/checkpoint remains controller-owned.