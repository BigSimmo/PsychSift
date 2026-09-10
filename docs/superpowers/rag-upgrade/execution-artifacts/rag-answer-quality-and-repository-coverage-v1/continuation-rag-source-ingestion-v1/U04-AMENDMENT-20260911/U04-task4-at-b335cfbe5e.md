## Task 4: Stage and evaluate an exact shadow generation without committing it

**Audit acceptance requirements (under current authority and unit gates):** F06/F08/F09 extend staging/evaluation to the complete immutable artifact inventory: pages, native/structural evidence, chunks/index units, images, summaries, labels and generation metadata. Reconcile expected/retained/failed/skipped units and all cap/conflict reasons. A candidate remains invisible to ordinary readers; failure preserves the prior valid set. Include controlled boundary failure fixtures and later executable SQL evidence.

**Files:**

- Create: `supabase/migrations/20260831102000_stage_shadow_document_generations.sql`
- Create: `scripts/reindex-shadow.ts`
- Create: `scripts/lib/reindex-eval-session.ts`
- Create: `tests/reindex-shadow.test.ts`
- Modify: `worker/main.ts`
- Modify: `src/lib/reindex-eval-gate.ts`
- Modify: `scripts/eval-retrieval.ts`
- Modify: `scripts/eval-quality.ts`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/reindex-eval-gate.test.ts`
- Modify: `tests/profile-retrieval-rpcs.test.ts`
- Modify: `tests/supabase-schema.test.ts`
- Modify: `tests/worker-behavior.test.ts`
- Reuse unchanged: `src/lib/ingestion-audit.ts`
- Reuse unchanged: `src/lib/recovery-readiness-evidence.ts`

**Step 1: Pin the staging correction in RED tests**

The current worker always calls destructive generation commit and `document_pages` is generation-blind. Add tests that require standard jobs to commit, shadow jobs to stage without changing the active pointer, and exact rollback to retain generation-addressed page rows.

Use one candidate generation UUID for the whole wave:

```ts
export type ShadowReindexPlanV1 = Readonly<{
  version: 1;
  targetProjectRef: string;
  sourcePolicyVersion: string;
  auditDigest: `sha256:${string}`;
  populationFingerprint: `sha256:${string}`;
  candidateGenerationId: string;
  documents: readonly Readonly<{
    documentId: string;
    expectedStateDigest: string;
    baselineGenerationId: string | null;
  }>[];
  chunkingExperiment: boolean;
  digest: `sha256:${string}`;
}>;

export type ShadowReindexStageReceiptV1 = Readonly<{
  version: 1;
  planDigest: `sha256:${string}`;
  projectRef: string;
  recoveryEvidenceDigest: `sha256:${string}`;
  candidateGenerationId: string;
  stagedAt: string;
  documents: readonly Readonly<{
    documentId: string;
    expectedStateDigest: string;
    baselineGenerationId: string | null;
    pageCount: number;
    chunkCount: number;
    imageCount: number;
  }>[];
  digest: `sha256:${string}`;
}>;

export type ReindexOperationManifestV1 = Readonly<{
  version: 1;
  operation: "stage" | "evaluate" | "promote" | "rollback" | "cleanup";
  targetProjectRef: string;
  planPath: string;
  reportOrReceiptPath: string | null;
  recoveryEvidencePath: string;
  recoveryEvidenceSha256: `sha256:${string}`;
  expectedDocumentIds: readonly string[];
  expectedDocumentCount: number;
  confirmationSha256: `sha256:${string}`;
  authorizedAt: string;
  expiresAt: string;
}>;
```

Test that every staged document uses `candidateGenerationId`, the plan contains an explicit eligible document list and exact P04 state digests, baseline evaluation precedes stage, post-stage state drift returns `NO_GO`, incomplete generations cannot evaluate, missing metrics fail closed, and evaluate cannot promote.

Run:

```text
node scripts/run-vitest.mjs run tests/reindex-shadow.test.ts tests/reindex-eval-gate.test.ts tests/worker-behavior.test.ts tests/profile-retrieval-rpcs.test.ts tests/supabase-schema.test.ts
```

Expected RED: the stage driver/RPC is absent, the worker has no non-committing branch, and pages cannot coexist across generations.

**Step 2: Add staged-generation persistence**

The migration:

- creates the canonical `document_index_generations` ledger with `staged` state;
- adds generation identity to `document_pages` and replaces `unique(document_id,page_number)` with `unique(document_id,index_generation_id,page_number)`;
- adds shadow-operation and requested-generation identity to `ingestion_jobs`;
- updates every committed-generation helper overload consistently; and
- adds service-only, fixed-search-path `enqueue_shadow_reindex_generation` and lease-fenced `stage_document_index_generation` RPCs.

The worker branches only on a validated persisted operation mode. Standard mode retains `commit_document_index_generation`; shadow mode writes a complete generation through `stage_document_index_generation` and never calls commit.

**Step 3: Add exact-generation evaluation wrappers**

Create service-role-only, fixed-search-path `eval_match_document_chunks_text_v2` and `eval_match_document_chunks_hybrid_v2`. Both accept one `p_eval_generation_id`, filter all requested documents to that generation, and keep unset production GUC behavior byte-equivalent.

Use one report name consistently:

```ts
export type ShadowReindexReportV1 = Readonly<{
  version: 1;
  planDigest: `sha256:${string}`;
  stageReceiptDigest: `sha256:${string}`;
  recoveryEvidenceDigest: `sha256:${string}`;
  populationFingerprint: `sha256:${string}`;
  candidateGenerationId: string;
  baseline: { retrieval: RetrievalGateSummary; quality: QualityGateSummary };
  candidate: { retrieval: RetrievalGateSummary; quality: QualityGateSummary };
  decision: ReindexGateDecision;
  digest: `sha256:${string}`;
}>;
```

The pure driver validates `plan`, `stageReceipt`, and `evaluate` transitions. Its connected adapters remain present but unusable without explicit operation-manifest authorization and configured clients; tests use injected fakes only.

**Step 4: Run GREEN**

```text
node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-shadow.test.ts tests/reindex-eval-gate.test.ts tests/worker-behavior.test.ts tests/profile-retrieval-rpcs.test.ts tests/reindex-pipeline.test.ts tests/supabase-schema.test.ts
npm run check:migration-role
npm run check:function-grants
npm run check:rag:fixtures
npm run eval:rag:offline
```

Expected: all local tests and static checks pass; no hosted session, document, embedding, or provider evaluation occurs.

**Step 5: Review and checkpoint**

Reviewers: `ingestion-worker-reviewer`, `supabase-schema-guardian`, and `rag-retrieval-reviewer`. Suggested local checkpoint message: `feat(reindex): stage exact shadow generations`.

---
