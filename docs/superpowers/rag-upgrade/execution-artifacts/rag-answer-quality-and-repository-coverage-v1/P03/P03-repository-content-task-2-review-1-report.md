# P03 Repository Content Task 2 Review 1

## Findings

### Important 1 — Every eligible Tools record points at a synthetic route that the canonical producer does not render

Evidence: `toolRecords` selects the three explicitly eligible records and replaces each canonical catalogue destination with `/tools/${tool.id}` (`src/lib/site-content/adapters/index.ts:145-160`). The canonical structured owner instead publishes `/differentials`, `/services`, and `/forms` (`src/lib/tools-catalog.ts:80-85`, `src/lib/tools-catalog.ts:197-202`, `src/lib/tools-catalog.ts:254-259`). There is no `src/app/(search-app)/tools/[id]/page.tsx`; the Tools route has only its launcher page. A provider-free runtime comparison reproduced all three mismatches:

```text
tools:differentials  /tools/differentials  != /differentials
tools:forms          /tools/forms          != /forms
tools:services       /tools/services       != /services
```

Trigger: a later shadow/retrieval task returns any of the only three currently eligible static records and uses its manifest `route` as the required first-party navigation destination.

Expected: Task 2 requires canonical public routes from canonical structured owners. The manifest route must be the route the public site actually renders, not merely a syntactically valid path under the producer's domain prefix.

Actual risk: the only eligible records in the 1,063-record baseline lead to 404 destinations. The incorrect routes are now content-hashed into the checked-in baseline, so later synchronization and retrieval can faithfully activate broken navigation while all current tests remain green. The same route-shape problem is latent in the currently ineligible DSM and calculator projections (`/dsm/<slug>` versus `/dsm/diagnoses/<slug>`, and `/calculators/<id>` despite no calculator detail route), but the three eligible Tools records alone make this a current blocking contract defect.

Smallest proof/fix: project the reviewed Tools records' canonical `href` values, and make the reviewed Task 1 producer contract support record-specific canonical destinations rather than requiring a fabricated `/tools/` prefix. Add a focused assertion that every eligible record route equals its canonical owner's rendered route; for route families, also check the actual route template (`/dsm/diagnoses/[slug]`, etc.). Regenerate the baseline after correction.

### Important 2 — The manifest CLI is not import-safe

Evidence: the module reads global `process.argv` in `main` (`scripts/build-site-content-manifest.ts:28-38`) and invokes `main()` unconditionally at module load (`scripts/build-site-content-manifest.ts:57-60`). Importing it under the repository's server-only stub, without invoking a CLI mode, produced the usage error, resolved the import, and exited 1:

```text
Use --check, --out <path>, or --baseline <path> --out <path> --diff <path>.
IMPORT_RESOLVED
importProbeExit=1
```

Trigger: a focused test, another local script, or later Task 4/6 tooling imports the CLI module to exercise or reuse its argument/build behavior.

Expected: the requested import-safe, provider-free CLI must execute only when launched as the entry point. Importing it must not read Git, build the entire corpus, write output, print usage, or change the importing process's exit status.

Actual risk: any importer gets hidden CLI execution and a failed process instead of a reusable module. This blocks side-effect-free contract tests and makes future orchestration fragile even though direct `--check` happens to pass.

Smallest proof/fix: export argument parsing/runner seams and guard entry-point execution with an `import.meta.url` versus `pathToFileURL(process.argv[1])` check. Add a subprocess import test that expects no stdout/stderr, no output file, and exit 0, then retain direct tests for `--check`, `--out`, and baseline/diff modes.

## Package identity and scope

- Independently resolved `TASK_BASE` `03d5af81fdec526595df6dd6ba5a0250de859bdd` and `TASK_HEAD` `674cd465420a1322ba925611d91125971514320d` on `codex/rag-local-build-20260822`.
- The base is a direct ancestor and the immutable range contains exactly one commit, `674cd465420a1322ba925611d91125971514320d feat(rag): add deterministic site content manifest`.
- Canonical package SHA-256 independently matched `a9b5c6ec1c3a34da9a255bd61f1de2db460387d48f216f19f4d6b20f103cbfec`.
- The package contains exactly the declared 10 paths and 12,726 inserted lines; 11,702 lines are the metadata-only baseline fixture.
- No Task 3 synchronization, outbox, RPC, route, migration, retrieval, cache, database, or provider implementation is present. `src/lib/rag/rag.ts` is unchanged and remains 4,362 lines.
- Ledger lookup returned `NOT REVIEWED at this HEAD and scope` for `P03/repositoryContent/task-2`.

## Full fixture, provenance, and privacy audit

- Parsed all 1,063 records in `tests/fixtures/site-content/static-manifest-baseline.json`. Counts are calculators 8, dictionary 96, DSM 146, factsheets 8, formulation 12, specifiers 585, therapies 205, and Tools 3.
- Only `tools:differentials`, `tools:forms`, and `tools:services` are eligible. The other 1,060 rows have non-null exclusions. No eligible row has an exclusion.
- Every record has exactly the nine allowed metadata/hash fields: `logicalId`, `domain`, `route`, `contentHash`, `lineageDigest`, `validationStatus`, `sourceStatus`, `eligible`, and `exclusionReason`. There are no titles, bodies, excerpts, content payloads, icons, functions, questions, calculation items/points/scores, or operational/private payload fields.
- Record IDs are unique and sorted; hashes have the canonical SHA-256 shape; routes are syntactically canonical; eligibility/exclusion pairs are internally consistent.
- Raw fixture scans found no owner/actor/administrator fields, UUID-like actor values, patient/private fields, secret/token/password/API-key fields, Healthdirect, eTG, AMH, Australian Medicines Handbook, or Therapeutic Guidelines text.
- The fixture digest is `sha256:ec80bbd26c0d87ce7973b0e9f4501551d802d905c06d3033b925767792309182`. The fresh selector and CLI reproduced this exact digest.
- Services, forms, medications, and differentials are built and validated as `dynamic_registry` records but are absent from the static manifest/digest despite their repository seed files. The source diff preserves their existing text builders and deterministic document/chunk-ID seeds. Metadata drift continues through the existing no-content-change path, whose unchanged content hash reuses the stored embedding rather than requesting a provider embedding.
- `generatedAt` and `gitSha` are excluded from the digest payload. The focused tests prove changing either build time or an unrelated Git SHA does not change the static digest, while changing one registered static field changes only its record hash and the manifest digest.
- The adapters select bounded structured fields only. Healthdirect/eTG/AMH identities and protected or derived clinical prose do not enter adapter lineage or the manifest. Factsheets/dictionary/specifiers/calculators/formulation/therapies remain ineligible under the reviewed registry/record state. Calculator projections omit questions, answers, arithmetic, score bands, icons, and functions. Tools projections include only the three explicit safe primitive descriptions.

The fixture itself therefore passes its deterministic schema/privacy/content-boundary audit. Finding 1 is specifically a semantic route-validity failure that the current syntactic checks and metadata-only fixture cannot detect.

## TDD and verification

- `node scripts/run-vitest.mjs run tests/site-content-manifest.test.ts tests/site-content-registry.test.ts tests/registry-corpus.test.ts tests/specifiers-content.test.ts tests/medications.test.ts tests/differentials.test.ts` — fresh PASS, 6 files and 134 tests; no lease contention.
- `node scripts/run-tsx.mjs scripts/build-site-content-manifest.ts --check` — fresh PASS, 1,063 static records, 3 eligible, exact digest `sha256:ec80bbd26c0d87ce7973b0e9f4501551d802d905c06d3033b925767792309182`.
- Provider-free route comparison — reproduced all three eligible Tools route mismatches against the canonical catalogue owner.
- Import-safety subprocess probe — reproduced unconditional execution and exit 1 on import.
- Full JSON parse/privacy/schema audit — PASS apart from the semantic route defect described above.
- `git diff --check 03d5af81fdec526595df6dd6ba5a0250de859bdd..674cd465420a1322ba925611d91125971514320d` — PASS.

The implementer-reported RED is directionally credible: the immutable base lacks the new manifest/adapters/tests and the report records Vitest module/assertion failures before implementation. However, the report also records that the repository wrapper's outer process returned zero for that RED; therefore the failing Vitest output, not a non-zero command contract, is the retained RED evidence. The identical GREEN was independently rerun above. The implementer-reported `--out` and baseline/diff modes are consistent with the directly reviewed code and the focused manifest/diff tests, but they were not redundantly rerun; the direct import-safety probe exposes the remaining CLI contract failure.

No broad gate, typecheck rerun, browser/server check, hosted check, provider call, network access, document processing, database/Supabase operation, migration, or Task 3 action was performed. The literal selector plus CLI check were the smallest distinct task gates.

SPEC_VERDICT: FAIL

QUALITY_VERDICT: FAIL
