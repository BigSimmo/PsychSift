# Shadow reindex and evaluation harness

The accepted harness builds and evaluates an exact candidate generation without exposing it to ordinary readers. The canonical operator sequence, state vocabulary, crash windows and cleanup command are in the [adaptive RAG reindex runbook](reindex-runbook.md#governed-generation-lifecycle). The governing evidence boundaries are the accepted [U04 execution contract](superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U04-execution-contract.md) and [U05 generation lifecycle contract](superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U05-execution-contract.md).

## Implemented source surfaces

`scripts/reindex-shadow.ts` exports injected TypeScript APIs for preparing and staging an admitted U04 plan, reading an exact staged wave, building and evaluating baseline/candidate case reports, promoting, and rolling back. It is import-safe and does not expose an operator command-line entry point. Callers must supply the reviewed envelopes, trusted clocks and RPC dependency; the module does not discover authority from environment variables.

Candidate evaluation uses explicit U04 baseline and candidate evidence. It does not use a session GUC, a broad visibility override or modified hot-path retrieval predicates. Ordinary readers continue to resolve only the document's committed generation. Candidate activation hides legacy G0 rows, and receipt-bound rollback to a null G0 pointer hides the failed candidate while restoring supported legacy rows.

`evaluateShadowReindexV1` preserves the complete validated U04 evidence and delegates the decision to the existing retrieval and quality gate. `GO` alone cannot activate anything. `promoteShadowDocumentGenerationV1` additionally requires the exact admitted stage and evaluation objects, the distinct promote authorization, policy-bound retention and authoritative U10 technical receipts. The private U10 lookup seam currently refuses, so operational promotion is intentionally unavailable until U10 implements the immutable verdict producer and lookup.

Promotion is not a first-publication path. The document must already be indexed and its current pointer must exactly match the admitted baseline, including intentional null G0. A non-null governed baseline requires its exact active generation row. The atomic promotion receipt retains the previous generation; rollback consumes that receipt, restores the exact prior pointers and retains the failed candidate.

## Operator boundary

There is no `reindex-shadow` CLI syntax to run. A future operational wrapper must implement the complete [governed lifecycle](reindex-runbook.md#governed-generation-lifecycle), preserve the live-versus-local distinction and refuse before connected access without separate authority. A connected dry run is still connected.

Cleanup is the only lifecycle CLI currently documented:

```sh
npm run reindex:cleanup-staged -- --manifest <exact-manifest.json>
```

It dry-runs an exact manifest. `--apply` explicitly applies the identical manifest; `--yes` only skips confirmation. Its `privateObjectReferenceInventory` is non-authoritative and `physicalDeletionAuthorized` is always `false`. U13 owns the separate future physical-disposal proof.

## Failure interpretation

Do not equate an empty bounded queue view with queue emptiness, extracted artifacts with an indexed document, an indexed document with an active candidate, or an active candidate with Answer availability. The detailed state meanings and precise crash windows are maintained in the [canonical runbook](reindex-runbook.md#state-vocabulary). Worker-image rollback is also separate from receipt-bound document-generation rollback; see the [worker deploy runbook](worker-deploy-runbook.md#rollback-boundaries).
