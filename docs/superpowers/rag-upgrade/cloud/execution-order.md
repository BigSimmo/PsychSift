# RAG upgrade execution order

The manifest is the scheduling authority. Execute one phase per fresh session and never execute plans alphabetically. P00–P17 are Cloud/offline implementation. L00–L10 begin only in a new local session after the accepted offline programme is published.

## Cloud implementation sequence

`P00 → P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08A → P08B → P08C → P09 → P10 → P11 → P12A → P12B → P12C → P13A → P13B → P13C → P14A → P14B → P14C → P15 → P16A → P16B → P16C → P16D → P17`

Every phase owns exactly the plan tasks listed in `programme-manifest.json`. Every task is implemented by one fresh implementer and reviewed by one distinct fresh reviewer; the whole phase receives another fresh review. Writers are serial. Read-only research may run in parallel only when it cannot race the phase worktree.

### Adaptive Cloud effort

| Launch effort | Target phases              | Build effort | Task/phase review   |
| ------------- | -------------------------- | ------------ | ------------------- |
| high          | P00, P04, P10, P11         | high         | manifest high/xhigh |
| xhigh         | P01–P03, P05–P09, P12A–P17 | high         | xhigh               |

The exact lettered phase list is in the manifest and is machine-validated. `TARGET_PHASE` must be present before substantive inspection. A running Cloud task cannot raise its own effort. An xhigh target therefore starts from the xhigh launch prompt with the repository confirmation marker; a high target starts from the high prompt. Implementations remain high because the task plans name files, interfaces, ordered steps and proof gates. P00 and P11 may use Terra/high implementers; all other implementation and all reviews use Sol at the manifest effort. No provider mapping or silent fallback is allowed.

Before dispatch, prove the controller route and one real fresh subagent dispatch from authoritative sanitized host metadata. Each task receipt binds the controller, implementer, task reviewer and phase reviewer separately. Self-report is invalid evidence.

## P17 offline completion

Accept the P17 phase receipt first. Then dispatch a new Sol/xhigh reviewer over the immutable full programme range, run the manifest offline completion commands and atomically commit `PROGRAMME.json` with its referenced tracked evidence. `PROGRAMME.json` retains all six connected gates as open. It is offline acceptance only—not migration, provider, reindex, deployment or production acceptance.

Push the exact accepted programme metadata tip to the single programme branch and stop. Do not begin connected work in Cloud.

## New-session local sequence

`L00 → L01 → L02 → L03 → L04 → L05 → L06 → L07 → L08 → L09 → L10 → OPERATIONAL.json`

L00 starts a brand-new local worktree from the exact remote commit that introduced the accepted `PROGRAMME.json`. It binds and checks the Cloud lineage, compares current-main drift and quarantined local WIP, and performs no connected action. L01–L10 follow `connected-execution.md`; each phase requires its own target-specific authority and receipt.

The local controller effort is high for L00, L01 and L06, and xhigh for L02–L05 and L07–L10. Review effort is high only for L00; all other local reviews are xhigh. The local phase cannot alter effort after launch, so select the matching Desktop control before starting the new session.

Residual gates close only at their manifest owner. L10 requires an empty residual set and a fresh whole-operational review before atomically committing `OPERATIONAL.json`. Neither local receipt lineage may edit or replace accepted Cloud receipts.

## Continuity rules

- Accepted implementation phases start at the exact predecessor receipt commit.
- P17 programme metadata is one later immutable commit; L00 starts from that programme metadata commit, not the P17 phase-receipt commit.
- Local phases start at the exact predecessor local receipt commit, including phases that close no gate.
- A missing receipt, hash mismatch, route mismatch, wrong effort, reused identity, expired/mismatched authority or untracked evidence is fail-closed.
- A source, schema, type or runtime mismatch after Cloud acceptance produces `NO_GO` and a separate remediation programme; never rewrite accepted history.
