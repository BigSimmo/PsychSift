# RAG upgrade programme execution order

This is the single scheduling authority for the two execution packages. The eight plans remain the task specifications; `programme-manifest.json` owns their interleaving. Do not execute an entire plan simply because it appears earlier alphabetically.

The planning-only Mode-aware Clinical Ask plan on the reconciled base is a separate programme with overlapping environment, dashboard, feedback, operations-document and migration owners. Do not run it concurrently. The recommended order is this RAG programme first, then a fresh-current-main revalidation of Mode-aware Clinical Ask; reverse that order only by revalidating this package before P00.

## Ordered phases

| Phase | Work                            | Why it is here                                                                                                                                                        |
| ----- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P00   | Lossless current-answer display | Removes the independent display-only clipping without changing answer semantics.                                                                                      |
| P01   | Evaluation Tasks 1–2            | Establishes cases, gates, and privacy-safe telemetry before behavioural work.                                                                                         |
| P02   | Australian Tasks 1–4            | Establishes source roles, uploaded-guideline priority, Healthdirect exclusion, and link-only policy.                                                                  |
| P03   | Repository Tasks 1–2            | Registers every approved public knowledge producer and deterministic adapters.                                                                                        |
| P04   | Ingestion Task 1                | Distinguishes missing corpus content from retrieval failure through an expected-source inventory.                                                                     |
| P05   | Ingestion Tasks 2–3             | Adds controlled acquisition contracts and shared recovery/activation receipts without fetching or activating.                                                         |
| P06   | Repository Tasks 3–5            | Makes public site synchronization durable and binds every question/cache entry to the newest valid snapshot.                                                          |
| P07   | Retrieval Tasks 1–2             | Defines bounded decomposition, ambiguity handling, coverage, and fallback contracts.                                                                                  |
| P08A  | Retrieval Tasks 3–4             | Adds repository-wide retrieval and uploaded-guideline priority.                                                                                                       |
| P08B  | Retrieval Tasks 5–6             | Adds claim-oriented context packing, numeric/table preservation, and typed gap classification.                                                                        |
| P08C  | Retrieval Tasks 7–8             | Measures and remediates healthy-retrieval generation failures, then closes retrieval acceptance.                                                                      |
| P09   | Evaluation Tasks 3–4            | Adds reviewed feedback flow and the isolated rollout/cache owner required downstream.                                                                                 |
| P10   | Repository Task 6               | Closes repository-wide cases and creates the initial programme operating runbook.                                                                                     |
| P11   | Australian Tasks 5–6            | Adds eTG/AMH link-only presentation and final source-governance handoff.                                                                                              |
| P12A  | Adaptive Tasks 1–2              | Defines answer coverage and schema contracts.                                                                                                                         |
| P12B  | Adaptive Tasks 3–4              | Implements adaptive composition and governed response integration.                                                                                                    |
| P12C  | Adaptive Tasks 5–6              | Renders every governed section in the conversation and closes adaptive acceptance.                                                                                    |
| P13A  | Verified-delivery Tasks 1–2     | Defines the delivery protocol and citation-complete parser.                                                                                                           |
| P13B  | Verified-delivery Tasks 3–4     | Implements route and client state machines.                                                                                                                           |
| P13C  | Verified-delivery Tasks 5–6     | Completes verified rendering and rollout acceptance while preserving buffered fallback.                                                                               |
| P14A  | Ingestion Task 4                | Retires duplicate processing and establishes the sole processor.                                                                                                      |
| P14B  | Ingestion Task 5                | Anchors summaries and reconstruction.                                                                                                                                 |
| P14C  | Ingestion Task 6                | Fences leases, generations, repair, and status ownership.                                                                                                             |
| P15   | Ingestion Tasks 7–9             | Builds dry-run shadow reindex, non-destructive rollback, and the operator runbook.                                                                                    |
| P16A  | Trusted-ingestion Tasks 0–2     | Verifies prerequisites and adds administrator/backend admission plus the durable state model.                                                                         |
| P16B  | Trusted-ingestion Tasks 3–4     | Adds extraction evidence and atomic activation.                                                                                                                       |
| P16C  | Trusted-ingestion Tasks 5–6     | Adds durable queue ownership and retrieval lineage.                                                                                                                   |
| P16D  | Trusted-ingestion Tasks 7–8     | Adds lifecycle controls and closes offline acceptance.                                                                                                                |
| P17   | Evaluation Tasks 5–6            | Runs the final offline comparison and finalizes SLOs and stop/promotion criteria.                                                                                     |
| P18   | Connected operator gates        | Verifies official source metadata, hosted schema/types, provider canaries, targeted waves, promotion, rollback and cleanup only with explicit per-operation approval. |

## Why repository-wide answering is early

Repository content is an input to retrieval scope, cache identity, answer coverage and evaluation. It is therefore implemented before adaptive answer generation, not bolted on after the previous work. The more operational ingestion/reindex and trusted-upload hardening can follow the answer path because those tasks are separable, but they still block any claim of full production completion.

## Non-negotiable order constraints

- Evaluation Task 4 must create the rollout owner before Repository Task 6 modifies it.
- Ingestion Task 3 must create recovery/receipt primitives before Repository Tasks 3–5 consume them.
- Repository Tasks 3–5 must create the public release/snapshot contract before Retrieval Task 3 serves site content.
- Retrieval/context work must land before adaptive answer composition, and adaptive schema limits must land before verified incremental delivery.
- P14A–P14C must establish the sole processor, anchored summaries and lease fencing before any document shadow stage, evaluation, promotion, rollback or cleanup.
- Evaluation Tasks 5–6 remain last so their artifacts represent the complete candidate, not a partial programme.
- P18 never begins merely because code is merged. Every connected read or mutation uses the approval matrix and exact project/service identity.

## Completion rule

Offline completion means all P00–P17 task gates, per-task reviews, phase reviews, package parity, migration uniqueness, documentation links, and the final whole-branch review pass. It does not mean deployed, migrated, reindexed, provider-validated or production-ready. Full operational completion additionally requires every applicable P18 receipt and explicit acceptance thresholds, including reduction of healthy-retrieval timeout/source-only fallback without citation, numeric, access, latency or usefulness regression.
