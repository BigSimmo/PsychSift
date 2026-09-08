# U03 operator compatibility follow-up

Date: 8 September 2026. Status: bounded source recommendation for the controller's U03 brief; not implementation or independent acceptance.

Frozen source: fd043b262ebd9b20315c2e46bc4838265787fa80 in C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database, branch codex/rag-local-build-20260822. This finishes the interrupted caller-compatibility follow-up. U03-schema-contract-recommendation.md and its appended section are preserved.

The selected treatment remains explicit temporary refusal of unleased operator writes, with a reviewed U13 lease-acquiring adapter dependency. There is no optional Fence, fake token, legacy write path or operator authorization inferred from an existing generation.

## Existing test owners

The bounded tracked search of tests for the three exact filenames and npm command names returned only tests/check-indexing-contract.test.ts:10–11, which reads the two active scripts as source. Protected paths 1/** and protected1/** were excluded in the Git pathspec before searching. No tests were executed.

| CLI owner | Existing exact test owner | What it establishes and does not establish |
| --- | --- | --- |
| scripts/backfill-smart-index.ts, package.json:163 index:backfill | tests/check-indexing-contract.test.ts, describe "smart-index repair selection" | Protects document-ID versus ambient-owner selection, typed/raw exact-generation evidence, P05 preflight, evidence limits, generation passed to enrichment, and absence of metadata/random-UUID generation fallback. These are source assertions, not executable startup/lease tests. |
| scripts/enrich-documents.ts, package.json:149 enrich:documents | tests/check-indexing-contract.test.ts, the same describe block | Participates in "binds %s to typed/raw exact-generation authority before source/provider work" and owns "loads exact-generation evidence and completes P05 preflight before metadata-stamp writes". No test there imports or runs this CLI entry point. |
| scripts/archive/backfill-enrichment.ts, package.json:150 enrich:backfill | No direct/dedicated existing test owner found by this exact-reference search | Still npm-callable despite its archive directory. tsconfig.json:29 excludes scripts/archive/**. Library tests for document-enrichment/deep-memory are not proof of this command's startup or earlier document writes. Add the refusal coverage explicitly. |

Retain the current U02 generation/source assertions where the source behavior remains. Do not delete their coverage merely to accommodate the new refusal. Any assertion whose exact call shape changes should be replaced with an equivalent owner-level contract plus executable refusal proof.

## Earliest boundaries to guard

### scripts/backfill-smart-index.ts

- Top-level loadEnvConfig(process.cwd()) at line 10 reads local environment files. That is local setup, not evidence of network activity, but it prevents a side-effect-free import.
- main starts at 329 and parseArgs at 330. Its first lazy dependency block is 331–343: env, admin client, enrichment, deep memory and OpenAI modules. requireServerEnv/requireOpenAIEnv are 344–345; createAdminClient is 346.
- The first awaited hosted read is the document query at 357. The existing writeEnabled check is later at 359, so inserting refusal there would already allow client setup and a hosted read.
- The first write branch calls upsertDocumentLevelEmbeddingFields around 402–409, before either named enrichment helper. That function can call embedding generation and inserts document_embedding_fields at 206. The metadata-only branch then independently writes quality and document metadata; it also needs refusal.

Place refusal immediately after local argument parsing, before the lazy dependency block. Treat any explicit --write request as a rejected write request, including --write without --confirm; do not silently convert that request to a successful dry-run. With no --write, preserve the existing read-only inspection mode, including --metadata-only's no-write form. Hosted reads in that mode remain separately provider-authorized; this task does not run them.

### scripts/enrich-documents.ts

- Top-level loadEnvConfig is line 11. main starts at 526; parseArgs and local scope/mode validation occupy 527–535.
- The dependency block starts at 537 and calls loadAdminClient at 546. That helper imports admin and creates the client at 27–29. The refusal must happen before entering this block, not just before requireOpenAIEnv.
- The first awaited hosted action is conditional: owner-email selection calls findOwnerIdByEmail at 555, whose loop calls supabase.auth.admin.listUsers at 80; otherwise document loading starts at 557. Coverage/evidence reads follow.
- The metadata-stamp mode reaches stampExistingEnrichmentVersion at 613, whose first document mutation is apply_document_metadata_patch at 502. The summaries-labels-images mode calls classifyExistingImages at 626 before enrichment: it uses Storage/provider work and can change document_images, including its failed-download update at 348. Document counts and image metadata are then written at 637/641. Deep-memory mode has the named shared persistence helper, followed by completion metadata at 679.

Place refusal after local validation and before the dependency block for every supported mode: summaries-labels-images, deep-memory and metadata-stamp. This CLI has no dryRun field or supported read-only mode in its parsed contract; do not claim one is being preserved or add one as U03 scope.

### scripts/archive/backfill-enrichment.ts

- Top-level loadEnvConfig is line 5. main starts at 445 and currently imports deep memory, enrichment, index units, environment, OpenAI, admin and health at 446–454 before parsing arguments.
- parseArgs currently occurs at 466. Move this local parse ahead of the lazy imports and run refusal there.
- Client setup is at 470. The first awaited hosted action is probeSupabaseHealth at 471, followed by loadDocuments at 472. Even its existing dry-run currently reaches these reads before returning at 484.
- Its write loop calls processDocument at 492. processDocument's first action at 377 is updateDocumentStage("loading_evidence"), which writes documents.metadata through line 162 before loading evidence or reaching enrichment. Its reuse/finalize branch also writes completion metadata. A missing-Fence error at helper call 399 would therefore be too late.

Refuse when dryRun is false, including the default invocation; preserve only explicit --dry-run's read-only behavior. Refusal precedes all lazy imports, environment requirements, client creation, health probes and documents reads. Do not revive its older enrichment call that lacks even the existing required indexGenerationId.

## Smallest import-safe, executable refusal seam

Add one provider-free module, scripts/lib/ingestion-operator-compatibility.ts, with:

1. A pure assertUnleasedOperatorModeAllowed discriminated request helper. Its accepted request shapes are command = index:backfill plus write:boolean; command = enrich:documents; or command = enrich:backfill plus dryRun:boolean. It returns only for genuine read-only requests and otherwise throws the fixed error code ingestion_attempt_required. It accepts no Fence and has no "force", test-mode, confirmation or environment override.
2. A pure direct-script invocation predicate using Node path/URL identity, for the three CLI footer guards. It must be false on ordinary import. It must not inspect credentials or touch the filesystem/network.

For each of the three scripts, export its existing main as a callable entry function taking an explicit argv array (a default argv is allowed for CLI invocation). It still performs its existing local parse/validation; the refusal call precedes every lazy operational dependency block. Keep provider modules lazy.

Move loadEnvConfig out of module top level into the direct-CLI branch. Guard both that call and main's existing catch/exit footer with the direct-invocation predicate. Direct invocation can retain local environment-loading defaults before main parses arguments; importing the script must not load environment files, call main, create clients, log, or exit. No script runner is invoked during tests.

The temporary guard does not manufacture an operational Fence. The shared enrichment/deep-memory signatures remain strictly fenced. Any old unleased call expressions made invalid by those signatures must be removed from the callable mutation path or explicitly replaced with the same unavailable-operation failure; do not pass a type-cast or invented context to make compilation pass. Preserve pure planning logic and avoid deleting unrelated historical helpers as cleanup. The reviewed U13 adapter is the only future place to re-enable operational mutation.

This is a small startup/import change plus a pure gate, not a new command framework. The existing scripts remain the owners of parsing, read-only queries and CLI error handling.

## Required focused tests and paths

Add tests/ingestion-operator-compatibility.test.ts. It should import the actual three guarded script entry functions, not merely call the pure helper. Install mocks that fail and record if the lazy env/admin/OpenAI/enrichment/deep-memory/health module factories are requested. Use explicit synthetic argv and mocked process environment; never import real provider clients.

Required assertions:

- Importing each script invokes neither loadEnvConfig nor main, and does not log or exit.
- index:backfill rejects --write with or without --confirm and with or without --metadata-only before any lazy factory/client/provider/write is reached. Use a valid explicit local scope selector so the refusal test does not stop at unrelated argument validation.
- enrich:documents rejects each of its three valid modes at the same early boundary, including an owner-email argument that would otherwise trigger an Auth read.
- enrich:backfill rejects its default/mutating invocation before the currently earlier lazy imports and health probe.
- The rejected requests expose ingestion_attempt_required and cannot be caught inside the per-document retry/failure paths, because those paths never start. CLI handling converts the rejection to a non-successful exit only when directly invoked; imports do not exit.
- Mock-only dry-run/read-only cases for the two existing read modes can reach the intended read surface and never call embeddings, mutation helpers, inserts, updates, deletes or completion/repair RPCs. A direct false-return from the pure gate alone is insufficient evidence of a safe read-only path.

Keep tests/check-indexing-contract.test.ts as the existing source-contract owner and extend only its relevant three-script wiring assertions, including the archived npm entry. Do not broaden check-indexing's health-scan tests or add a full CLI subprocess/provider harness.

Exact additional U03 allowed paths for this compatibility increment:

- scripts/backfill-smart-index.ts
- scripts/enrich-documents.ts
- scripts/archive/backfill-enrichment.ts
- scripts/lib/ingestion-operator-compatibility.ts (new)
- tests/ingestion-operator-compatibility.test.ts (new)
- tests/check-indexing-contract.test.ts (existing owner)

No package.json or tsconfig change is required to authorize the refusal: the existing npm mappings remain, and the archive exclusion is not bypassed or removed. Mocked runtime coverage supplies the missing archived-entry evidence. Final verification selection remains with the controller/verification owner after the implementation diff.

## Evidence limits

This document is source/design evidence only. No repository writes, test command, provider/client operation, ingestion command, SQL, untracked enumeration or recursive agent occurred. The tracked symbol/path searches excluded protected paths before searching. The outside recommendation was not edited. No independent review or acceptance is claimed.
