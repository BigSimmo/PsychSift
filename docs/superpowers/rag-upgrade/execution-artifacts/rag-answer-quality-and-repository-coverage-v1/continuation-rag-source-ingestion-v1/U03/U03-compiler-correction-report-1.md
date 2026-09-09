# U03 compiler correction report1

Source freeze4 for controller compiler and independent full-range reviews; not product acceptance. Original HEAD/TASK_BASE remains8c11f138e6c683a13db3b465332e7f3cbb515c62; branch codex/rag-local-build-20260822; worktree C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database. All prior reports/freezes/failures retained. Controller staging preserved; no stage/unstage/commit/reset by writer. No running writer check/process; no further source edits planned.

Final U03-implementation-freeze-4.json SHA256 d56cee0eba974a08e4ed9afa60af28268ab451b7f36266f2ef2c08f4153cd6b1 binds all37 raw file hashes. Its changed-since-freeze3 list contains only the six owned compiler-correction files and one reviewed additional fixture. The31 SQL function surfaces, schema/ACL definitions, existing writer inventory and raw histories in prior report remain unchanged; no SQL or Edge source was edited in this correction.

## Compiler failure classification

Controller tracked application compiler: exit1,24diagnostics,0input/I/Oviolations. Retain U03-controller-typecheck-final.log and U03-tracked-typecheck-v3-final-result.json. No baseline compiler or corrected compiler was run by implementer.

Three diagnostics were U03-introduced: accidental Fence on retrieval-only deep-memory test; new source-summary regression fixture missing required section_heading; nullable extracted-document narrowing lost across new prepared-work callback. Corrections remove the unrelated fixture property, supply section_heading:null and capture already-narrowed extracted data in const shadowLegacy before the callback. Production type safety and assertions remain intact.

Twenty-one diagnostics involved inherited source/type mismatches:16 readonly-profile assignments/reader arguments;4 generation-column/declaration/read errors across the unchanged source readers;1 malformed clinical-summary fixture cast. U03-compiler-diagnostic-source-baseline-1.json proves immutable8c11/current byte identity of original clinical test, production src/lib/types.ts and accepted summary normalizer, plus identical AST source of emptyClinicalProfile/profileItemsToStrings/normalizeClinicalProfile. Baseline2 compares immutable8c11 with controller-staged freeze3 loadEvidence/loadEnrichmentRows functions, both identical, and proves missing image generation type declaration against the existing July2nullableUUID SQL. This is exact source attribution, not an executed baseline compiler verdict or inheritance of U02's historical failing exception.

## Corrections

- src/lib/document-enrichment.ts: build readonly profile categories immutably with the same normalization/keys/limits; accept readonly arrays in nonmutating renderer; remove newly unused private type alias. Accepted shared normalizer and production profile types remain byte-identical8c11.
- src/lib/supabase/database.types.ts: add document_images.index_generation_id as nullable string in Row and optional nullable in Insert/Update, matching existing SQL (no schema change).
- scripts/enrich-documents.ts: explicitly require every selected chunk/image generation to equal requested generation before narrowing it into the strict evidence arrays. No type assertion, fake generation or weakened evidence type; existing unleased refusal remains before this unreachable operational helper.
- tests/deep-memory.test.ts, tests/document-enrichment.test.ts, worker/main.ts: the three U03-introduced corrections above.
- tests/document-clinical-summary.test.ts: exact independently reviewed candidate adopted after admission SHA1fdca67671a4bdf359419d4e03b91e0268845a5423aa4949f8394ced695bbf18 (review SpecPASS/QualityPASS, local Astra/xhigh). Test helper accepts unknown persisted JSON; same malformed text/pages-only payload reaches that raw fixture boundary without a false validated-item claim. All six assertions/journeys and production model/type code remain unchanged. Candidate/final fixture SHA5bda65ee6ab49b2a2f4b6cb773e77fccd775d88aee4732d63286e605b49841a6.

## Bounded proof

1. node node_modules/prettier/bin/prettier.cjs --write src/lib/document-enrichment.ts scripts/enrich-documents.ts tests/deep-memory.test.ts tests/document-enrichment.test.ts worker/main.ts — exit0, all unchanged; U03-compiler-correction-format-1.log. The subsequent removal of an unused private type alias/extra blank line is type-only, recorded in final hashes. database.types.ts follows its existing generated-style formatter exclusion.
2. node scripts/run-vitest.mjs run tests/document-enrichment.test.ts tests/deep-memory.test.ts tests/ingestion-operator-compatibility.test.ts tests/worker-shadow-extraction.test.ts — exit0,4files98tests passed; U03-compiler-correction-1.log/.json and pre-run input hashes. Arbiter RUN/off, coordinator retained, process-local overrides restored.
3. node node_modules/prettier/bin/prettier.cjs --write tests/document-clinical-summary.test.ts — exit0/unchanged; U03-clinical-fixture-format-1.log; exact reviewed candidate hash retained.
4. node scripts/run-vitest.mjs run tests/document-clinical-summary.test.ts — exit0,1file6tests passed; U03-clinical-fixture-1.log/.json. Arbiter RUN/off, coordinator retained, process-local overrides restored. Its pre-run input inventory mistakenly requested the model with .ts instead of .tsx, producing a missing-path hash error before Vitest, without product/test failure. The original partial inputs JSON is retained. U03-clinical-fixture-1-inputs-corrected.json is explicitly POST-RUN; it supplies the actual .tsx model hash and proves unchanged8c11 model/types/normalizer bytes. No historical pre-run identity is falsely reconstructed.

Controller reported prior full15 selector277tests/15files PASS and native Edge two-root1 exit0; writer did not repeat either. These are prior-freeze outcomes, not proof of the corrected application compiler. Controller owns new corrected compiler attempt and review binding. No providers/native document/SQL/runtime/hosted/clinical proof, migration application, operators or deployment were performed. U02 remains historical exit1,4failed suites,45failed586passed; not green or inherited.

## Changed since freeze3

- `scripts/enrich-documents.ts` — `6f7d02225bfa4331c1ec7a75b1aaea7f15bb7d71ace1b0ac6c9e500748973b92`
- `src/lib/document-enrichment.ts` — `74cfa3107f40ac50fb3a84f6b948a46fe50e8288445bda6119c617a3b98b7a41`
- `src/lib/supabase/database.types.ts` — `dcb21f4473fa1bc75d772583b2b5cbc239064f19084bc8a04514a852cc440480`
- `tests/deep-memory.test.ts` — `0673fa803d2f64a25d2b625aff23d272a44a7c8d009604f51b9cb40563d289e6`
- `tests/document-clinical-summary.test.ts` — `5bda65ee6ab49b2a2f4b6cb773e77fccd775d88aee4732d63286e605b49841a6`
- `tests/document-enrichment.test.ts` — `1715614315832268f7e1e8b6c440ed780916314246d3d4439f2423cdfa7dcd17`
- `worker/main.ts` — `9d962c2384991ae4503f33f0750a75c692ad3881ee5c6d3c9b1f5f016e6ac871`

All37current raw hashes, unchanged writer/SQL inventory and appended correction test commands/exits are in freeze4. Source writes stopped; parent may stage the seven reviewed changes and create an explicitly unaccepted immutable full-range candidate while running its corrected compiler.
