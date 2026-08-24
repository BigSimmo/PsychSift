### Task 3: Land the shared recovery-evidence and activation-receipt contract

**Files:**

- Create: `src/lib/recovery-readiness-evidence.ts`
- Create: `scripts/verify-recovery-readiness-evidence.ts`
- Create: `tests/recovery-readiness-evidence.test.ts`
- Modify: `src/lib/reindex-pipeline.ts` for pure generation/receipt types only
- Modify: `tests/reindex-pipeline.test.ts`

**Interfaces:** Consumes provider-free recovery inputs, operation type, expected project identity, and digest-bound activation/rollback facts. Produces `RecoveryReadinessEvidence`, `RecoveryReadinessDigest`, `ActivationReceipt`, `RollbackReceipt`, `parseRecoveryReadinessEvidence(input)`, and `assertRecoveryReadinessForOperation(evidence, operation, expectedProjectRef)` for repository site releases and later document-generation tasks.

**Boundary:** This is a provider-free critical-path slice shared with first-party site releases. It defines project-bound, freshness-bound database/PITR/Storage/restore evidence and an append-only activation/rollback receipt vocabulary. It does not change a database schema, call Supabase, wire the current destructive document commit, stage a generation, or authorize an operator action.

- [ ] **Step 1: Write the evidence and receipt matrix**

Reject wrong project, stale/missing PITR, missing Storage recovery, missing restore-drill result, digest mismatch, operation mismatch, absent previous-generation pointer, mutable/replaceable receipt identity, or a rollback claim that would require reconstruction. Permit site-release and document-generation consumers to reuse the same evidence envelope while retaining distinct typed resource identities.

- [ ] **Step 2: Implement pure parsing, digesting, and validation**

The CLI validates an operator-supplied offline JSON artifact and emits no secrets or raw provider output. `src/lib/reindex-pipeline.ts` gains types/pure assertions only; the existing `commit_document_index_generation` call path is unchanged and must not claim reversibility.

- [ ] **Step 3: Verify and hand off to repository-content synchronization**

Run:

```text
node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-pipeline.test.ts
```

Expected: PASS/source-only. Repository-content Tasks 3–5 may now consume this contract. Continue to Task 4 before any document shadow operation.

---

