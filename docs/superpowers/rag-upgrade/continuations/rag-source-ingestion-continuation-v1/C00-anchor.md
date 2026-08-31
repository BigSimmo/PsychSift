# C00 continuation anchor

## Candidate state

- Programme: `rag-source-ingestion-continuation-v1`
- Status: candidate awaiting independent `clinical-governance-reviewer` review
- Worktree: `C:\Users\joshs\.codex\worktrees\rag-local-build-20260822\Database`
- Branch: `codex/rag-local-build-20260822`
- Implementation base: `03aa32d731d1cb9009be55213580e9ea3994017c`
- Observed initial HEAD: `03aa32d731d1cb9009be55213580e9ea3994017c`
- Observed source-check HEAD: `03aa32d731d1cb9009be55213580e9ea3994017c`
- Design SHA-256: `FEC371222E5D21F10DFA1A24E02DD5DE27F941AFC685D3CE2BF3E3ECF0973676`
- Plan SHA-256: `F455EFDEF4D80A64CD0A3FA4BC2C6F637799E32332C7D81459E0FBD24755D4D7`
- Ordinary Answer serving changed: `false`
- Product work remains paused until the independent C00 review is clean.

The plan, design, and C00 brief are checkpoint inputs. Their reviewed bytes are preserved in this candidate. The unaccepted P08A draft is not implementation authority and none of its artifacts were modified.

## Accepted receipt imports

All paths below were read from the current worktree. Every receipt reported `status: accepted`; each digest was calculated from the file rather than copied from chat.

| Phase | Receipt                                                                                                  | SHA-256                                                            |
| ----- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| P00   | `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/P00.json` | `cd2ee7413c397ae818fa178bb22bef1668c37e1e4756f0653666d9b79d6a4ad4` |
| P01   | `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/P01.json` | `e7ab0da3bdb94681590559fce4841c894087f60d98e9ecc0d369d21d1b9f3730` |
| P02   | `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/P02.json` | `216acef527a486ff9c5133b4d54bee9f9f83ad16a8b7f7202ed00eb7db128824` |
| P03   | `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/P03.json` | `8e1b13b958b321469a008d92034de07a76812349d88eeebc2528ff108c1bb2b2` |
| P04   | `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/P04.json` | `e946f7ee324f06518e1ed4b39d3df86ea0db6b065b872cc6bf80f77eb24cf020` |
| P05   | `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/P05.json` | `7c8162adae6cbaf76f5de914a850715ebf9cbab2503be6de71ff28490ba6340b` |
| P06   | `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/P06.json` | `68dfd38bdf91e851135ee7c3c74887672dffc841452ba357770a390450d9065e` |
| P07   | `docs/superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/P07.json` | `4bee6344aaf3f44d57b19043642fb0438c302ca78b5ea22e7423b19b13338844` |

## Migration reservation proof

- `rg --files supabase/migrations | rg "20260831100000|20260831101000|20260831102000|20260831103000|20260831104000|20260831105000|20260831106000"` exited `1` with no output, proving all seven version prefixes are absent.
- The latest observed migration was `20260827213539_add_site_content_runtime_authority.sql`.
- The exact reserved filenames below were absent, were in ascending order, and each sorted after that latest migration:
  1. `20260831100000_retire_ingestion_worker.sql`
  2. `20260831101000_fence_ingestion_leases_and_repairs.sql`
  3. `20260831102000_stage_shadow_document_generations.sql`
  4. `20260831103000_activate_retained_document_generations.sql`
  5. `20260831104000_create_document_admission_events.sql`
  6. `20260831105000_add_document_technical_activation.sql`
  7. `20260831106000_add_source_ingestion_retrieval_kernel.sql`

The prior P08A allocation `20260830215420_add_corpus_scoped_retrieval_v3.sql` is superseded. The sole continuation retrieval reservation is `20260831106000_add_source_ingestion_retrieval_kernel.sql`; the conditional P08A reuse option is closed.

## Dry-run gate route

The scope mapper reported `ingestion_sast_changed: true`, `db_changed: true`, and `rag_eval_changed: true` for the representative source set. It also reported `ui_changed: false` for that primary set.

The primary `verify:pr-local --dry-run` selected, without executing, `check:runtime`, `check:installed-lock-parity`, `format:changed`, `lint`, `typecheck`, `test`, `build`, both offline RAG evaluations, `check:medication-interactions`, and `check:medication-lexicon-report`.

The extended `verify:pr-local --dry-run --extended` preview selected the same plan and added `verify:ui` after `src/components/ClinicalDashboard.tsx` was included. No command from either printed verification plan executed. The selector exposes no separate privacy or clinical flags; clinical and privacy risk is routed explicitly to `clinical-governance-reviewer`, alongside the task-specific schema, ingestion, retrieval, and UI specialist routes recorded in the manifest.

## Retained boundary

- Ingestion Tasks 4-9 and Trusted Tasks 1-7 remain the 13 independently reviewed units `U01` through `U13`.
- Trusted Task 0 remains the C03 entry gate and Trusted Task 8 remains the final acceptance gate; neither is counted as a behavior unit.
- The continuation retains source-only trusted admission, processor integrity, generation-addressed shadow lifecycle, technical activation, durable queue, selective recovery, and the minimum structurally default-off public retrieval kernel.
- The existing buffered Answer path remains the supported serving path. The new kernel is unreachable from ordinary Answer serving unless a later serving tranche is separately authorized.
- P00-P07 receipts and accepted artifacts remain immutable.

## Deferred and connected boundary

The continuation defers the full P08A parent phase beyond its minimum kernel; P08B Tasks 5-6; P08C Tasks 7-8; P09 Task 3; Evaluation Task 4's general canary/rollout owner; Retrieval Task 4's broad allocation, supplementary ordering, and local-primary ranking; P10 Task 6 except retained ingestion evidence invariants; P11 Tasks 5-6; P12 Tasks 1-6; P13 Tasks 1-6 while preserving buffered serving; P17 Tasks 5-6 except the named acceptance invariants; and all P18 operations.

C07 remains unclosed and owns hosted project/history inspection, hosted type/drift comparison, migration application and grant/RLS verification, backend capability provisioning, real scanner/OCR/model/upload/Storage/document work, deployment, shadow evaluation and provider operations, activation/withdrawal, backups and isolated restore, approval-gated production readiness, provider/end-user Answer canary work, and production observation.

## Prohibited operations attestation

This candidate made metadata-only changes. It made no product, test, migration, parent-receipt, accepted-artifact, or P08A-artifact change. It processed no document or corpus and made no provider call, hosted Supabase/Storage access, connected-service call, migration application, reindex, activation, withdrawal, deployment, push, or pull request. No product verification command, product test, `check:production-readiness`, scanner, model download, or hosted check ran; only the required source inspection, dry-run gate previews, hash checks, and targeted metadata formatting validation were permitted.
