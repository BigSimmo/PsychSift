# Governed ingestion audit and reversible targeted re-index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use one implementer at a time. Each task requires a task-reviewer verdict for specification compliance and code quality before continuing. The existing three-PR edge-ingestion plan is itself executed sequentially, never by concurrent implementers. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine which documents genuinely need repair, acquire only allowlisted public Australian versions into a governed shadow state, correct the ingestion pipeline, evaluate targeted candidate generations against the active index, and provide reusable atomic promotion plus real prior-generation rollback primitives for both documents and first-party site-content releases.

**Architecture:** Start with a pure read-only integrity audit that assigns one action per document. Public acquisition is exact-URL/allowlist based and stages owned documents; automatic change detection may create shadow versions but never activate them. Complete the existing edge-ingestion overhaul before bulk candidate generation. A shadow driver evaluates exact staged generations through service-role-only eval wrappers and the existing deterministic `decideReindexGate`. A new generation ledger and non-destructive activation RPC retain the prior generation through the canary window; cleanup becomes a later explicit operation. The repository-content plan reuses these generation/recovery contracts while owning its separate public static site manifest, public dynamic-state digest, changed-record diff, durable outbox, and one public site-release pointer.

**Tech Stack:** TypeScript 6 strict, Zod, Supabase/PostgreSQL migrations and Edge Functions, existing ingestion worker/agent contracts, Vitest. Live source/network/provider/Supabase operations are approval-gated.

**Spec:** [`docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md`](../specs/2026-08-20-rag-answer-and-australian-sources-design.md)

**Related plans:**

- Source catalogue/policy: [`2026-08-20-rag-australian-source-governance.md`](2026-08-20-rag-australian-source-governance.md)
- First-party site content: [`2026-08-21-rag-repository-content-sync.md`](2026-08-21-rag-repository-content-sync.md)
- Existing edge work: [`docs/plans/edge-ingestion-overhaul-3pr-plan.md`](../../plans/edge-ingestion-overhaul-3pr-plan.md)
- Existing shadow design: [`docs/reindex-shadow-harness-design.md`](../../reindex-shadow-harness-design.md)
- Queue-recovery warning: [`docs/reindex-runbook.md`](../../reindex-runbook.md)

**Dependencies:** Land Tasks 1–2 of [`2026-08-20-rag-evaluation-rollout.md`](2026-08-20-rag-evaluation-rollout.md) and Tasks 1–4 of [`2026-08-20-rag-australian-source-governance.md`](2026-08-20-rag-australian-source-governance.md) before source acquisition or candidate evaluation. The read-only audit core may be built once the catalogue types are stable. Task 3’s provider-free recovery-evidence/activation-receipt vocabulary may land before edge repair so repository-content synchronization can reuse it. Execute Tasks 4–6 as the existing edge-ingestion three-PR sequence before any document bulk shadow re-index, exact-generation evaluation, document promotion, or rollback wiring.

**Effort:** Plan/review `xhigh`; Tasks 1–8 build `high`; Task 9 operator execution `high`. Each of the three edge-ingestion tasks uses high build effort and a fresh implementer. Use the most capable coding model with high reasoning for migrations, acquisition boundaries, ingestion generation semantics, and promotion/rollback. Final review uses xhigh.

**Current-main reconciliation (2026-08-22):** the edge-ingestion three-PR plan remains planning-only and both ingestion writers are still present. B4 Docling shadow mode has landed but defaults to `legacy`; enabling it is a separate operator decision and is not part of this re-index programme. The current `commit_document_index_generation` path remains destructive to prior artifacts, so no existing command provides the reversible promotion claimed here.

## Global Constraints

- Audit before mutation. Re-index only documents with a reason-coded `targeted_reprocess` or `shadow_reindex` decision.
- `npm run reindex` is queue recovery. It is never the controlled cutover driver for this programme.
- Never perform a blanket corpus re-index because answers are generally weak.
- Repository/site records use their own manifest/diff audit. Never classify `source_kind = registry_record` as an uploaded guideline or send unchanged site content through a blanket document re-index.
- Trusted administrator/backend ingestion owns clinical admission and automatic first activation for new shared `uploaded_local` documents. This plan owns read-only integrity classification plus shadow replacement of already active generations; explicit operational promotion here is not a second clinical approval.
- Current active generations serve users throughout staging and evaluation.
- No staged generation reaches serving traffic before all hard gates and explicit approval.
- Healthdirect is never acquired. eTG/AMH fail before network access and again before storage, ingestion, embedding, or indexing.
- Public HTML extraction removes navigation/footer/widget chrome and outbound-link destinations. A Healthdirect marker that survives in an extracted candidate unit is a quarantine/review failure; it never becomes a searchable chunk, embedding, prompt input, reference suggestion, or citation.
- Acquired public documents start under a staging/steward owner, not `owner_id = null`.
- Automatic change detection may create a candidate version; a human approves exact source definition and exact evaluated document version before activation.
- Automated public acquisition/change detection must not call the trusted-backend admission channel to inherit automatic uploaded-document activation. Public versions remain licence- and exact-version-governed shadow candidates.
- A conflict flag never changes the uploaded document’s currentness/approval automatically.
- Production mutation requires confirmed project identity, healthy recovery status, current PITR/RPO evidence, and separate Storage recovery evidence. If PITR is disabled, stop before production re-index/backfill/promotion.
- Internet-disabled Cloud may keep `database.types.ts` aligned with reviewed migration SQL for source compilation, but must label this source-only expected-schema evidence. Authoritative hosted type regeneration is a separately authorized post-migration gate and its generated diff must be reviewed before promotion.
- Current `commit_document_index_generation` deletes prior artifacts; do not use it for a promotion advertised as reversible.
- The provider-free recovery-evidence schema and append-only activation-receipt vocabulary are shared prerequisites, not permission to operate. They may unblock first-party site release work, but no current document generation is staged, evaluated, promoted, rolled back, or cleaned up until the edge correctness sequence is complete.
- Do not enable `WORKER_DOCUMENT_EXTRACTOR_MODE=shadow`, promote Docling output, or treat existing aggregate shadow measurements as re-index approval in this plan.
- No provider calls, source fetch, live Supabase read/write, migration apply, worker run, deployment, cleanup apply, commit, push, or PR occurs without the authorization required by repository policy.

---

## File Structure

| File                                                                        | Responsibility                                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/lib/ingestion-audit.ts`                                                | **New.** Pure document integrity/action classification.                                   |
| `scripts/audit-ingestion-corpus.ts`                                         | **New.** Offline JSON adapter and separately approved live inventory adapter.             |
| `tests/ingestion-audit.test.ts`                                             | **New.** Reason/action/state-digest contract.                                             |
| `src/lib/public-source-activation-manifest.ts`                              | **New.** Source-definition activation review manifest.                                    |
| `src/lib/public-source-acquisition.ts`                                      | **New.** Exact allowlisted URL, redirect, size, type, hash, and link-only policy.         |
| `scripts/plan-public-source-acquisition.ts`                                 | **New.** Dry-run immutable acquisition manifest.                                          |
| `scripts/fetch-approved-public-source-versions.ts`                          | **New.** Approval-gated network adapter.                                                  |
| `scripts/check-public-source-changes.ts`                                    | **New.** Scheduled/manual change detector that stages but cannot activate.                |
| `supabase/migrations/20260820121000_create_public_source_control_plane.sql` | **New.** Source activation events and version lifecycle.                                  |
| `tests/public-source-activation-manifest.test.ts`                           | **New.** Approval manifest.                                                               |
| `tests/public-source-acquisition.test.ts`                                   | **New.** SSRF/licence/allowlist/content boundary.                                         |
| Files in `docs/plans/edge-ingestion-overhaul-3pr-plan.md`                   | Sequential ingestion correctness prerequisite.                                            |
| `supabase/migrations/20260820130000_add_shadow_generation_eval.sql`         | **New.** Eval-only generation override and service-only wrapper RPCs.                     |
| `src/lib/recovery-readiness-evidence.ts`                                    | **New.** Pure PITR/database/Storage/restore-drill evidence schema and freshness checks.   |
| `scripts/verify-recovery-readiness-evidence.ts`                             | **New.** Offline digest/project/operation validator for operator-supplied recovery proof. |
| `tests/recovery-readiness-evidence.test.ts`                                 | **New.** Required fields, freshness, project binding, and rollback semantics.             |
| `scripts/reindex-shadow.ts`                                                 | **New.** Dry-run-first target/stage/evaluate/decision driver.                             |
| `scripts/eval-retrieval.ts`, `scripts/eval-quality.ts`                      | Exact-generation evaluation option.                                                       |
| `tests/reindex-shadow.test.ts`                                              | **New.** Driver state machine and fail-closed gate.                                       |
| `supabase/migrations/20260820131000_retain_reindex_generations.sql`         | **New.** Generation ledger, non-destructive activation, rollback, retention.              |
| `src/lib/reindex-pipeline.ts`                                               | Ledger/promotion/rollback types and pure checks.                                          |
| `scripts/cleanup-abandoned-reindex-generations.ts`                          | Explicit post-canary cleanup only.                                                        |
| `docs/reindex-runbook.md`, `docs/reindex-shadow-harness-design.md`          | Final operator sequence and corrected rollback claims.                                    |

---

## Completion Evidence

Report separately:

- audit/action-classification results;
- source activation/acquisition static proof;
- edge-ingestion PR proof per cycle;
- shadow-driver/gate proof;
- non-destructive lifecycle/rollback proof;
- offline RAG/production-readiness results;
- live source/Supabase/provider operations run or not run;
- PITR/Storage/restore evidence current or unverified;
- migrations applied or not applied;
- documents staged/promoted/rolled back/cleaned counts;
- commits/push/deploy status; and
- any residual blocker, especially PITR disabled or prior-generation retention not deployed.

---

### Task 1: Build the read-only ingestion integrity audit

**Files:**

- Create: `src/lib/ingestion-audit.ts`
- Create: `src/lib/source-coverage-registry.ts`
- Create: `data/rag-expected-source-coverage.v1.json`
- Create: `scripts/audit-ingestion-corpus.ts`
- Create: `tests/fixtures/ingestion/active-corpus-inventory.json`
- Create: `tests/ingestion-audit.test.ts`
- Create: `tests/source-coverage-registry.test.ts`
- Reuse: `scripts/lib/indexing-health-document.ts`
- Inspect: `scripts/check-indexing.ts`

**Interfaces:**

Consumes deterministic expected-source coverage plus offline actual corpus/index/retrieval inventory. Produces the typed audit action/reason/document/report contracts below and the provider-free audit command output.

```ts
export type IngestionAuditAction = "no_change" | "metadata_only" | "targeted_reprocess" | "shadow_reindex";
export type IngestionAuditReason =
  | "integrity_expectation_missing"
  | "metadata_incomplete"
  | "source_governance_invalid"
  | "withdrawn_or_superseded"
  | "missing_pages"
  | "missing_chunks"
  | "duplicate_chunks"
  | "orphaned_artifacts"
  | "empty_index_units"
  | "oversized_index_units"
  | "undersized_index_units"
  | "low_information_index_units"
  | "chunk_bounds_invalid"
  | "heading_continuity_failed"
  | "table_continuity_failed"
  | "extraction_quality_poor"
  | "embedding_missing_or_mismatched"
  | "generation_incomplete"
  | "must_pass_retrieval_failed";

export type ExpectedActualCount = {
  expected: number | null;
  actual: number;
};

export type IngestionDocumentAudit = {
  documentId: string;
  expectedStateDigest: string;
  activeGenerationId: string | null;
  action: IngestionAuditAction;
  eligibleForShadowPlan: boolean;
  blockingDisposition: "quarantine_review" | "tombstone" | null;
  reasons: IngestionAuditReason[];
  counts: {
    pages: ExpectedActualCount;
    chunks: ExpectedActualCount;
    tables: ExpectedActualCount;
    images: ExpectedActualCount;
    searchableUnits: ExpectedActualCount;
    embeddings: ExpectedActualCount;
    duplicateChunks: number;
    orphanedArtifacts: number;
  };
  unitQuality: {
    policyVersion: string;
    empty: number;
    oversized: number;
    undersized: number;
    lowInformation: number;
  };
  embeddingContract: {
    expectedModel: string;
    actualModels: string[];
    expectedDimensions: number;
    actualDimensions: number[];
    expectedStrategy: string;
    actualStrategies: string[];
    completeness: number;
  };
  mustPassCases: Array<{
    id: string;
    passed: boolean;
    expectedDocumentRank: number | null;
    actualDocumentRank: number | null;
    failedExpectations: string[];
  }>;
};

export type ExpectedSourceCoverageRecord = Readonly<{
  key: string;
  owner: string;
  reviewStatus: "active" | "absent" | "not_approved" | "retired";
  expectedDocumentIds: readonly string[];
  mustPassCaseIds: readonly string[];
}>;

export type SourceCoverageFinding = Readonly<{
  key: string;
  outcome: "available" | "not_in_corpus" | "retrieval_miss" | "not_approved" | "retired";
  owner: string;
  mustPassCaseIds: readonly string[];
}>;

export function auditExpectedSourceCoverage(args: {
  expected: readonly ExpectedSourceCoverageRecord[];
  activeDocumentIds: ReadonlySet<string>;
  retrievedDocumentIdsByCase: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly SourceCoverageFinding[];
```

- [ ] **Step 1: Write the action-precedence tests**

```ts
// tests/ingestion-audit.test.ts
it("does not recommend re-index for a metadata-only defect", () => {
  expect(auditDocument(fixture({ publisher: null }))).toMatchObject({
    action: "metadata_only",
    reasons: ["metadata_incomplete"],
  });
});

it("targets a proven extraction or generation defect", () => {
  expect(auditDocument(fixture({ pageCount: 12, indexedPageCount: 8 }))).toMatchObject({
    action: "targeted_reprocess",
    reasons: ["missing_pages"],
  });
  expect(auditDocument(fixture({ activeGenerationId: "g1", chunkGenerations: ["g1", "g2"] }))).toMatchObject({
    action: "shadow_reindex",
    reasons: ["generation_incomplete"],
  });
});

it("classifies unit-quality and embedding defects with deterministic precedence", () => {
  expect(auditDocument(fixture({ emptyIndexUnits: 2, oversizedIndexUnits: 1 }))).toMatchObject({
    action: "targeted_reprocess",
    reasons: ["empty_index_units", "oversized_index_units"],
  });
  expect(
    auditDocument(fixture({ embeddingModel: "old-model", expectedEmbeddingModel: "current-model" })),
  ).toMatchObject({
    action: "shadow_reindex",
    reasons: ["embedding_missing_or_mismatched"],
  });
  expect(
    auditDocument(
      fixture({ indexedPageCount: 0, embeddingModel: "old-model", expectedEmbeddingModel: "current-model" }),
    ),
  ).toMatchObject({ action: "targeted_reprocess" });
});

it("blocks withdrawn content from a shadow plan even when it also has repairable defects", () => {
  expect(auditDocument(fixture({ lifecycle: "withdrawn", indexedPageCount: 0 }))).toMatchObject({
    eligibleForShadowPlan: false,
    blockingDisposition: "tombstone",
  });
});

it("fails closed when the state digest changes between plan and apply", () => {
  expect(() => assertAuditTargetState(auditDocument(fixture()), "different-digest")).toThrow(/state digest changed/i);
});

it("distinguishes an absent source from a retrieval miss", () => {
  const expected = expectedCoverageFixture();
  expect(
    auditExpectedSourceCoverage({ expected, activeDocumentIds: new Set(), retrievedDocumentIdsByCase: new Map() }),
  ).toContainEqual(expect.objectContaining({ outcome: "not_in_corpus" }));
  expect(
    auditExpectedSourceCoverage({
      expected,
      activeDocumentIds: new Set(["expected-doc"]),
      retrievedDocumentIdsByCase: new Map([["must-pass-1", new Set()]]),
    }),
  ).toContainEqual(expect.objectContaining({ outcome: "retrieval_miss" }));
});
```

- [ ] **Step 2: Run the new test to establish red**

Run: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts`

Expected: FAIL because the audit core does not exist.

- [ ] **Step 3: Implement pure classification**

The adapter maps existing indexing-health data into the pure input. Pin defect-to-action precedence rather than inferring it later:

- missing expected integrity evidence blocks planning with `integrity_expectation_missing` until reviewed;
- extraction/page/table/heading/unit-quality defects map to `targeted_reprocess`;
- a healthy extraction with missing/mismatched embedding model, dimensions, strategy, completeness, generation, or must-pass retrieval outcomes maps to `shadow_reindex`;
- metadata-only defects map to `metadata_only`; and
- no measured defect maps to `no_change`.

When several repairable defects coexist, precedence is `targeted_reprocess` over `shadow_reindex` over `metadata_only` over `no_change`: rebuilding extraction also regenerates the candidate index, while re-indexing cannot repair broken extraction. Reasons retain every measured defect. Governance invalidity, withdrawal, supersession, or quarantine independently sets `eligibleForShadowPlan: false` and a blocking disposition, so precedence can never re-index ineligible content. Existing measured-neutral OCR/chunking findings do not become defects without new per-document evidence.

Implement the expected-source registry alongside the active-document audit. It records accountable owner/review state and maps must-pass questions to expected documents even when a document is absent or not approved. `not_in_corpus` means the expected governed source is absent from the active population; `retrieval_miss` means it is active and eligible but the measured case did not retrieve it. Never infer one from the other, and never recommend re-indexing for a genuinely absent/not-approved source.

- [ ] **Step 4: Make the CLI dry-run by default**

`node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json` works offline and writes no database state. A live adapter requires an explicit `--live-read` option, target confirmation, and the repository’s provider authorization; it still cannot mutate. Output is deterministic, schema-versioned, contains no extracted clinical content, and includes population fingerprint, expected source coverage/ownership, explicit `not_in_corpus` versus `retrieval_miss`, expected state digests, expected-versus-actual page/chunk/table/image/searchable-unit counts, unit-quality policy/counts, embedding contract evidence, and per-case retrieval outcomes.

- [ ] **Step 5: Verify and checkpoint**

Run: `node scripts/run-vitest.mjs run tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts tests/check-indexing-contract.test.ts tests/indexing-coverage.test.ts tests/reindex-pipeline.test.ts`

Expected: PASS.

Format, inspect, and conditionally commit:

```bash
npm run format
git add src/lib/ingestion-audit.ts src/lib/source-coverage-registry.ts data/rag-expected-source-coverage.v1.json scripts/audit-ingestion-corpus.ts tests/fixtures/ingestion/active-corpus-inventory.json tests/ingestion-audit.test.ts tests/source-coverage-registry.test.ts
git commit -m "feat(ingestion): classify document repair needs"
```

---

### Task 2: Add source-definition activation and controlled acquisition

**Files:**

- Create: `src/lib/public-source-activation-manifest.ts`
- Create: `src/lib/public-source-acquisition.ts`
- Create: `scripts/plan-public-source-acquisition.ts`
- Create: `scripts/fetch-approved-public-source-versions.ts`
- Create: `scripts/check-public-source-changes.ts`
- Create: `supabase/migrations/20260820121000_create_public_source_control_plane.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Create: `tests/public-source-activation-manifest.test.ts`
- Create: `tests/public-source-acquisition.test.ts`
- Modify: `tests/function-grants.test.ts`
- Modify: `tests/supabase-schema.test.ts`

**Interfaces:** Consumes `AustralianSourceDefinition`, `australianSourcePolicyVersion`, `SourceContentMode`, and exact-document licence policy from the accepted Australian-governance phase. Produces `PublicSourceActivationManifestV1`, `PublicSourceAcquisitionPlan`, exact-version lifecycle rows, and dry-run/fetch/change-detection CLIs that cannot activate content.

**Control-plane tables:**

- `public_source_activation_events`: append-only source catalogue key, policy version/digest, decision (`activate`, `quarantine`, `retire`), operator, reason, evidence references, created time.
- `public_source_versions`: immutable catalogue key, exact canonical/version URL, content hash, retrieved time, licence evidence digest, staging document ID, extraction/index generation, lifecycle (`discovered`, `shadow`, `approved`, `active`, `quarantined`, `tombstoned`), supersedes version, activation event.

Both tables are service-role only. State transitions occur through security-definer RPCs with fixed search paths and row locks. Source-definition activation and exact document-version publication remain two distinct approvals.

- [ ] **Step 1: Write acquisition boundary tests**

```ts
// tests/public-source-acquisition.test.ts
it("rejects excluded and link-only sources before network access", async () => {
  const fetch = vi.fn();
  await expect(planAcquisition({ catalogueKey: "etg-complete", url: "https://www.tg.org.au/", fetch })).rejects.toThrow(
    /link-only/i,
  );
  await expect(
    planAcquisition({ catalogueKey: "healthdirect", url: "https://www.healthdirect.gov.au/", fetch }),
  ).rejects.toThrow(/not in the active catalogue/i);
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects redirects off the exact allowlisted host and private network targets", async () => {
  await expect(validateAcquisitionUrl("http://127.0.0.1/internal", activeDefinition())).rejects.toThrow(
    /https|private/i,
  );
  await expect(validateRedirect("https://evil.example/file.pdf", activeDefinition())).rejects.toThrow(/allowlisted/i);
});
```

Also test bounded size/type, redirect count, DNS/IP rebinding check, content hash, duplicate version, exact policy digest, staging owner requirement, and no response body in logs/errors.

Add a trusted-page fixture whose navigation/footer contains a Healthdirect link. The acquisition/extraction contract must drop the chrome and link target; if the marker is in retained main content, the document is quarantined instead of indexed.

- [ ] **Step 2: Add manifest and SQL contract tests**

Activation manifests contain policy version/digest, catalogue key, decision, operator, reason, and evidence. Unknown/historical/link-only/excluded entries cannot receive `activate`. SQL tests pin append-only triggers, service-role grants, allowed transitions, and the rule that only `active` source definitions may create a fetch manifest.

- [ ] **Step 3: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts`

Expected: FAIL on absent modules/migration.

- [ ] **Step 4: Implement dry-run plan then explicit fetch**

`plan-public-source-acquisition` accepts an operator-supplied exact URL/version list; it performs no search-engine discovery. It validates against the active catalogue and emits an immutable manifest. `fetch-approved-public-source-versions` requires the manifest path, expected count, manifest SHA-256, and `--apply`; without all four it prints the plan and exits without network/storage/database writes.

Fetched content is bounded, hashed while streaming, scanned through existing upload validation, and inserted as an owned staging document with provenance metadata. Link-only/excluded policy is rechecked before network, before upload, before enqueue, and in the worker/agent contract.

- [ ] **Step 5: Implement automatic change detection without activation**

`check-public-source-changes` uses only active catalogue entries and exact approved URLs. An unchanged hash records a bounded check event. A changed hash creates a `shadow` source version and owned staging document; it cannot set `active`, null the owner, publish, or supersede the current version. A withdrawal/tombstone signal removes the old version from new retrieval immediately through the controlled state RPC and queues human review; a replacement still requires both approvals.

- [ ] **Step 6: Verify locally and checkpoint**

Run: `node scripts/run-vitest.mjs run tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/ingestion-enqueue.test.ts tests/ingestion-mutation-safety.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts`

Expected: PASS.

Run: `npm run check:migration-role`

Expected: PASS.

Format, review SSRF/secrets/licence/RLS boundaries, and conditionally commit:

```bash
npm run format
git add src/lib/public-source-activation-manifest.ts src/lib/public-source-acquisition.ts scripts/plan-public-source-acquisition.ts scripts/fetch-approved-public-source-versions.ts scripts/check-public-source-changes.ts supabase/migrations/20260820121000_create_public_source_control_plane.sql src/lib/supabase/database.types.ts tests/public-source-activation-manifest.test.ts tests/public-source-acquisition.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts
git commit -m "feat(sources): stage approved public source versions"
```

---

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

### Task 4: Retire the recovered worker and enforce generation-aware reads

**Files:**

- Delete: `supabase/functions/ingestion-worker/`
- Modify: `supabase/config.toml`
- Modify: `supabase/functions/indexing-v3-agent/index.ts`
- Modify: `supabase/functions/indexing-v3-agent/behavior.ts`
- Modify: `supabase/functions/indexing-v3-agent/utils.ts`
- Create: `supabase/migrations/20260822121000_retire_ingestion_worker.sql` after proving that exact version is unused on the phase base; it drops `invoke_ingestion_worker(integer)`
- Modify: `supabase/schema.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/indexing-v3-agent.test.ts`
- Modify: `tests/worker-run-loop.test.ts`
- Modify: `tests/worker-row-contract.test.ts`
- Modify: `tests/supabase-schema.test.ts`
- Modify: `docs/worker-deploy-runbook.md`

**Interfaces:** Consumes the accepted Task 3 generation/receipt identities and the current `indexing-v3-agent` job contract. Produces one surviving processor plus `isVisibleCommittedGenerationRow(row: { document_id: string; generation_id: string | null }, visibility: { activeGenerationByDocument: ReadonlyMap<string, string>; committedGenerationIds: ReadonlySet<string> }): boolean`, used by every summary/label/section source read.

- [ ] **Step 1: Revalidate the first slice of [`edge-ingestion-overhaul-3pr-plan.md`](../../plans/edge-ingestion-overhaul-3pr-plan.md) against the exact phase base and pin failing processor-ownership/generation-read tests**
- [ ] **Step 2: Retire the recovered worker, use the shared visibility predicate, and make per-job failure recording non-fatal to unrelated claimed jobs**
- [ ] **Step 3: Run `node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts`, `npm run check:edge:functions`, `npm run check:migration-role`, and `npm run check:production-readiness`; expect source-only PASS/READY classification**
- [ ] **Step 4: Obtain clean specification and quality verdicts, then checkpoint only if task commits were explicitly authorized**

Before any migration/deploy, an operator must separately confirm and remove every live cron/invoker for the retired function. Repository evidence cannot prove hosted scheduler absence.

### Task 5: Produce structured source-anchored summaries

**Files:**

- Modify: `supabase/functions/indexing-v3-agent/index.ts`
- Modify: `supabase/functions/indexing-v3-agent/behavior.ts`
- Modify: `supabase/functions/indexing-v3-agent/utils.ts`
- Modify: `src/lib/document-enrichment.ts`
- Modify: `tests/indexing-v3-agent.test.ts`
- Modify: `tests/document-enrichment.test.ts`
- Modify: `tests/worker-shadow-extraction.test.ts`
- Modify: `tests/check-indexing-contract.test.ts`

**Interfaces:** Consumes Task 4's sole-processor and committed-generation predicate. Produces `normalizeSourceAnchoredSummary(input: unknown): SourceAnchoredSummaryPayload`, where `SourceAnchoredSummaryPayload` is the one transport-neutral validated payload containing summary kind/version, document and generation IDs, model/version, generated timestamp, ordered source chunk IDs, structured summary fields, and an explicit heuristic-fallback marker shared by Node and Deno.

- [ ] **Step 1: Revalidate the second edge-ingestion slice and add RED parity, invalid-payload, replacement-failure, and coverage-aware-input tests**
- [ ] **Step 2: Implement one shared schema/normalizer or strict Node/Deno parity contract; never delete a valid summary before replacement succeeds and never use first-N input**
- [ ] **Step 3: Run `node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts`, `npm run check:edge:functions`, `npm run eval:rag:offline`, and `npm run check:production-readiness`; expect source-only PASS/READY classification**
- [ ] **Step 4: Obtain clean specification and quality verdicts, then checkpoint only if task commits were explicitly authorized**

No provider summary, backfill, deployment, or hosted call is authorized by this task.

### Task 6: Add lease fencing, bounded repair, and quality gates

**Files:**

- Modify: `supabase/functions/indexing-v3-agent/index.ts`
- Modify: `supabase/functions/indexing-v3-agent/behavior.ts`
- Modify: `worker/run-loop.ts`
- Modify: `worker/runtime-control.ts`
- Modify: `worker/main.ts`
- Modify: `src/lib/supabase/database.types.ts`
- Create: `supabase/migrations/20260822122000_fence_ingestion_leases_and_repairs.sql` after proving that exact version is unused on the phase base
- Modify: `supabase/schema.sql`
- Modify: `tests/indexing-v3-agent.test.ts`
- Modify: `tests/worker-behavior.test.ts`
- Modify: `tests/worker-run-loop.test.ts`
- Modify: `tests/worker-runtime-control.test.ts`
- Modify: `tests/worker-row-contract.test.ts`
- Modify: `tests/check-indexing-contract.test.ts`
- Modify: `docs/ingestion-state-machine.md`
- Modify: `docs/worker-deploy-runbook.md`
- Modify: `docs/reindex-runbook.md`

**Interfaces:** Consumes Task 4's sole processor and Task 5's `SourceAnchoredSummaryPayload`. Produces service-role-only RPCs `update_ingestion_job_progress(p_job_id uuid, p_document_id uuid, p_worker_id text, p_lease_token uuid, p_stage text, p_progress integer): jsonb`, `complete_ingestion_job(p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_stage text, p_worker_id text, p_lease_token uuid): jsonb`, `fail_or_retry_ingestion_job(p_job_id uuid, p_document_id uuid, p_batch_id uuid, p_retry boolean, p_document_status text, p_stage text, p_error_message text, p_next_run_at timestamptz, p_worker_id text, p_lease_token uuid): jsonb`, and `heartbeat_ingestion_job(p_job_id uuid, p_document_id uuid, p_worker_id text, p_lease_token uuid): jsonb`. Also produces `planIngestionRepairs(input: { documentIds: string[]; reasonCodes: IngestionRepairReasonCode[]; expectedStateDigests: Record<string, string> }): IngestionRepairPlan`; applying that plan remains a separate authorized operation.

- [ ] **Step 1: Revalidate the third edge-ingestion slice and add RED stale-worker, newer-claim, arbitrary-reopen, wrong-digest, and bounded-repair tests**
- [ ] **Step 2: Require worker identity and lease token on every mutation; reject stale ownership and record every bounded repair in audit history**
- [ ] **Step 3: Run `node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/worker-runtime-control.test.ts tests/worker-row-contract.test.ts tests/check-indexing-contract.test.ts`, `npm run check:edge:functions`, `npm run check:migration-role`, `npm run check:production-readiness`, and `node scripts/run-tsx.mjs scripts/audit-ingestion-corpus.ts --input tests/fixtures/ingestion/active-corpus-inventory.json --expected data/rag-expected-source-coverage.v1.json --output .local/rag-ingestion/audit.json`; expect PASS/source-only and an unchanged action classifier**
- [ ] **Step 4: Obtain clean specification and quality verdicts, then checkpoint only if task commits were explicitly authorized**

Tasks 4–6 are three separate SDD phases and review ranges. Never combine them into one hard-to-revert change.

---

### Task 7: Build exact-generation shadow evaluation and driver

**Files:**

- Reuse: `src/lib/recovery-readiness-evidence.ts`
- Reuse: `scripts/verify-recovery-readiness-evidence.ts`
- Modify: `tests/recovery-readiness-evidence.test.ts`
- Create: `supabase/migrations/20260820130000_add_shadow_generation_eval.sql`
- Create: `scripts/reindex-shadow.ts`
- Create: `scripts/lib/reindex-eval-session.ts`
- Modify: `scripts/eval-retrieval.ts`
- Modify: `scripts/eval-quality.ts`
- Modify: `src/lib/reindex-eval-gate.ts`
- Create: `tests/reindex-shadow.test.ts`
- Modify: `tests/reindex-eval-gate.test.ts`
- Modify: `tests/profile-retrieval-rpcs.test.ts`
- Modify: `tests/supabase-schema.test.ts`

**Interfaces:**

Consumes accepted audit/recovery evidence, exact project identity, expected document state digests, and active generation IDs. Produces `ShadowReindexPlan`, stage/operation manifests, digest-bound stage receipts, comparison reports, and fail-closed decisions below.

```ts
export type ShadowReindexPlan = {
  version: 1;
  targetProjectRef: string;
  sourcePolicyVersion: string;
  auditDigest: string;
  documents: Array<{ documentId: string; expectedStateDigest: string; baselineGenerationId: string | null }>;
  chunkingExperiment: boolean;
};

export type ShadowReindexStageReceipt = {
  version: 1;
  planDigest: string;
  projectRef: string;
  recoveryEvidenceDigest: string;
  stagedAt: string;
  candidateGenerations: Array<{ documentId: string; generationId: string }>;
};

export type ReindexOperationManifestV1 = {
  version: 1;
  operation: "stage" | "evaluate" | "promote" | "rollback";
  targetProjectRef: string;
  planPath: string;
  reportOrReceiptPath: string | null;
  recoveryEvidencePath: string;
  recoveryEvidenceSha256: string;
  expectedDocumentCount: number;
  confirmationSha256: string;
  authorizedAt: string;
  expiresAt: string;
};

export type ShadowReindexReport = {
  planDigest: string;
  stageReceiptDigest: string;
  recoveryEvidenceDigest: string;
  populationFingerprint: string;
  candidateGenerations: Array<{ documentId: string; generationId: string }>;
  baseline: { retrieval: RetrievalGateSummary; quality: QualityGateSummary };
  candidate: { retrieval: RetrievalGateSummary; quality: QualityGateSummary };
  decision: ReindexGateDecision;
};
```

- [ ] **Step 1: Add driver state-machine tests**

Test default dry-run, explicit document requirement, audit/state-digest match, baseline before staging, no evaluation on incomplete generation, identical population/case fingerprints, hard NO_GO on missing metrics, no promotion inside the evaluate command, abort/timeout cleanup report, and no use of `npm run reindex`. Also prove stage/promote reject absent, malformed, wrong-project, digest-mismatched, expired, PITR-disabled, RPO-inadequate, missing-Storage, or stale/missing-restore-drill evidence; rollback requires the exact promotion-bound evidence path/digest and project identity but remains available if that evidence expires after promotion.

`RecoveryReadinessEvidence` is operator-supplied evidence, not a claim inferred from `scripts/supabase-recovery-status.ts`. It contains references/digests only—never credentials, backup URLs, provider tokens, or protected content. Stage and promotion require `verifiedAt <= 24 hours`, `validUntil` in the future, Storage inventory evidence no older than seven days, and a successful isolated restore-drill report no older than 90 days. The plan’s configured RPO must be no weaker than the evidence. Rollback verifies the immutable evidence digest bound into the promotion receipt and exact project, but does not fail solely because the post-promotion freshness window elapsed.

- [ ] **Step 2: Add service-only generation-eval SQL contract**

Extend the two small generation-filter functions with the documented session-local `rag.eval_generation_id` override, unchanged when unset. Add service-role-only wrapper RPCs around existing retrieval functions: each wrapper sets the GUC locally for its transaction then delegates to the unchanged hot-path function. Revoke wrappers from anon/authenticated. Production app code never calls them.

This avoids assuming a session persists across Supabase HTTP requests and avoids duplicating hot-path query bodies. Static tests pin SQL/stable/search-path/grants. Before any live use, profile with the GUC unset and set; any sequential scan or latency regression is NO_GO and the migration is reverted.

- [ ] **Step 3: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-shadow.test.ts tests/reindex-eval-gate.test.ts tests/profile-retrieval-rpcs.test.ts tests/supabase-schema.test.ts`

Expected: FAIL on missing driver/migration.

- [ ] **Step 4: Implement the dry-run-first driver**

Commands are separate and non-ambiguous:

```text
node scripts/run-tsx.mjs scripts/reindex-shadow.ts plan --audit .local/rag-ingestion/inventory-offline.json --output .local/rag-ingestion/shadow-plan.json
node scripts/run-tsx.mjs scripts/verify-recovery-readiness-evidence.ts --operation-manifest .local/rag-ingestion/stage-operation.json
node scripts/run-tsx.mjs scripts/reindex-shadow.ts stage --operation-manifest .local/rag-ingestion/stage-operation.json --apply
node scripts/run-tsx.mjs scripts/reindex-shadow.ts evaluate --operation-manifest .local/rag-ingestion/evaluation-operation.json
```

`plan` and recovery-evidence validation are offline. The operation manifest is created only after separate authorization and contains identifiers, paths, counts, digests, authorization time, and expiry—never credentials or protected content. `stage` is mutation/provider-gated and refuses a missing, expired, malformed, or wrong-operation manifest. `evaluate` may use provider/live data and therefore requires its own manifest and approval, but cannot promote. It passes exact generation IDs through the eval-only wrappers and feeds summaries unchanged into `decideReindexGate`.

- [ ] **Step 5: Expand the gate for this programme**

Retain existing hard metrics and add protected uploaded-guideline recall, false-insufficiency rate, supported-subquestion retention, source-role violations, access/link-only violations, and must-pass case count. Access, link-only, citation, numeric, governance-danger, and prompt-injection violations have ceiling zero. A chunking experiment must improve content MRR beyond the existing noise tolerance; a normal repair may hold it.

- [ ] **Step 6: Verify offline and checkpoint**

Run: `node scripts/run-vitest.mjs run tests/recovery-readiness-evidence.test.ts tests/reindex-shadow.test.ts tests/reindex-eval-gate.test.ts tests/profile-retrieval-rpcs.test.ts tests/reindex-pipeline.test.ts tests/supabase-schema.test.ts`

Expected: PASS.

Run: `npm run check:rag:fixtures`

Expected: PASS.

Run: `npm run eval:rag:offline`

Expected: PASS.

Format, review the SQL hot-path default branch and driver no-promotion guarantee, then conditionally commit:

```bash
npm run format
git add tests/recovery-readiness-evidence.test.ts supabase/migrations/20260820130000_add_shadow_generation_eval.sql scripts/reindex-shadow.ts scripts/lib/reindex-eval-session.ts scripts/eval-retrieval.ts scripts/eval-quality.ts src/lib/reindex-eval-gate.ts tests/reindex-shadow.test.ts tests/reindex-eval-gate.test.ts tests/profile-retrieval-rpcs.test.ts tests/supabase-schema.test.ts
git commit -m "feat(reindex): evaluate staged generations safely"
```

---

### Task 8: Add non-destructive activation, rollback, and delayed cleanup

**Files:**

- Create: `supabase/migrations/20260820131000_retain_reindex_generations.sql`
- Modify: `src/lib/reindex-pipeline.ts`
- Modify: `scripts/reindex-shadow.ts`
- Modify: `scripts/cleanup-abandoned-reindex-generations.ts`
- Create: `tests/reindex-generation-lifecycle.test.ts`
- Modify: `tests/reindex-pipeline.test.ts`
- Modify: `tests/reindex-shadow.test.ts`
- Modify: `tests/supabase-schema.test.ts`

**Interfaces:** Consumes Task 7's exact-generation `ReindexGateReport` and Task 3's recovery evidence/digests. Produces append-only `DocumentGenerationActivationReceipt`/`DocumentGenerationRollbackReceipt`, atomic active-generation pointer switching, retained prior-generation identity, and delayed-cleanup eligibility.

**Generation ledger:**

```text
document_index_generations
  document_id uuid
  generation_id uuid
  state staged | active | retained | abandoned | deleted
  content_state_digest text
  evaluation_report_digest text
  activated_at timestamptz
  retain_until timestamptz
  supersedes_generation_id uuid
```

This ledger is the canonical per-document generation owner. The repository-content plan may reference these retained generations from the public site release and atomically switch its pointer, but it must not duplicate per-document generation, recovery, or cleanup state.

- [ ] **Step 1: Write the lifecycle tests**

Prove:

- one active generation per document;
- promotion requires a `GO` report digest, exact document state, exact staged generation, and row lock;
- promotion changes the active pointer without deleting prior artifacts;
- the previous active generation becomes `retained` with a future retention deadline;
- rollback atomically restores that retained generation and retains the failed generation for audit;
- cleanup cannot delete active or retained-before-deadline rows;
- cleanup is dry-run unless `--apply`, exact document/generation IDs, expected count, and manifest digest are supplied; and
- the legacy destructive commit RPC is not called by the shadow driver.

- [ ] **Step 2: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/reindex-generation-lifecycle.test.ts tests/reindex-pipeline.test.ts tests/supabase-schema.test.ts`

Expected: FAIL on missing ledger/RPCs.

- [ ] **Step 3: Implement compatibility-safe RPCs**

Add `activate_document_index_generation` and `rollback_document_index_generation`; keep the existing `commit_document_index_generation` for legacy callers until separately migrated, but document its destructive semantics and prevent the new driver from using it. Use transaction row locks, service role only, fixed search path, exact report/state digests, and artifact completeness checks.

Do not change production generation filtering: it continues to read the document’s active generation pointer. Prior retained artifacts are invisible until rollback.

- [ ] **Step 4: Add explicit promote/rollback commands**

```text
node scripts/run-tsx.mjs scripts/reindex-shadow.ts promote --operation-manifest .local/rag-ingestion/promotion-operation.json --apply
node scripts/run-tsx.mjs scripts/reindex-shadow.ts rollback --operation-manifest .local/rag-ingestion/rollback-operation.json --apply
```

Both commands recheck project, queue, state digest, report digest, generation completeness, source-policy version, and the exact recovery-evidence SHA immediately before mutation. Promotion requires currently fresh evidence. Its receipt binds that digest so rollback can authenticate the same recovery basis without becoming unavailable only because the evidence aged during the observation window. A GO report is necessary but never sufficient without explicit `--apply` confirmation.

- [ ] **Step 5: Verify lifecycle and checkpoint**

Run: `node scripts/run-vitest.mjs run tests/reindex-generation-lifecycle.test.ts tests/reindex-pipeline.test.ts tests/reindex-shadow.test.ts tests/supabase-schema.test.ts`

Expected: PASS.

Run: `npm run check:migration-role`

Expected: PASS.

Format, inspect grants/idempotence/race/cleanup protection, and conditionally commit:

```bash
npm run format
git add supabase/migrations/20260820131000_retain_reindex_generations.sql src/lib/reindex-pipeline.ts scripts/reindex-shadow.ts scripts/cleanup-abandoned-reindex-generations.ts tests/reindex-generation-lifecycle.test.ts tests/reindex-pipeline.test.ts tests/reindex-shadow.test.ts tests/supabase-schema.test.ts
git commit -m "feat(reindex): retain rollback generations"
```

---

### Task 9: Write the operator runbook and define targeted production waves

**Files:**

- Modify: `docs/reindex-runbook.md`
- Modify: `docs/reindex-shadow-harness-design.md`
- Modify: `docs/ingestion-state-machine.md`
- Modify: `docs/worker-deploy-runbook.md`
- Modify: `docs/disaster-recovery-runbook.md`
- Modify: `docs/search-rag-master-context.md`

**Interfaces:** Consumes accepted Tasks 1–8 evidence, receipts, commands, and stop conditions. Produces: no runtime interface. It finalizes the canonical operator sequence separating offline proof, read-only hosted inventory, shadow stage, evaluation, explicit promotion, rollback, and delayed cleanup.

- [ ] **Step 1: Correct the operational truth**

Document that queue recovery is not cutover, the old commit RPC is destructive, the new lifecycle retains prior generations, source activation differs from document publication, database PITR excludes Storage objects, and restore targets a new project. Include the exact `RecoveryReadinessEvidence` field/freshness rules, offline verification command, provider-console evidence collection owner, receipt binding, and the rule that evidence references must contain no secret or signed backup URL.

- [ ] **Step 2: Define waves**

1. **Offline only:** audit fixtures, code, migrations, parsers, gate, dry-run manifests.
2. **Read-only hosted inventory:** exact project/recovery/PITR/Storage/source/public-history checks after approval.
3. **Small shadow pilot:** must-pass/golden documents plus IA-1 targets; no serving change.
4. **Approved promotion canary:** exact GO set, retained prior generation, internal cohort, observation window.
5. **Targeted waves:** only reason-coded documents, bounded counts, one receipt/report per wave.
6. **Delayed cleanup:** after observation and rollback deadline; separate approval.

Never add a default corpus-wide wave. A later broad wave requires a new reviewed plan and evidence.

- [ ] **Step 3: Run offline handoff gates**

Run the focused tests from Tasks 1–8. Expected: PASS.

Run: `npm run check:rag:fixtures`

Expected: PASS.

Run: `npm run eval:rag:offline`

Expected: PASS.

Run: `npm run check:production-readiness`

Expected: PASS or an accurately classified provider/recovery prerequisite.

Inspect the selected PR gate with `npm run verify:pr-local -- --dry-run`; run the selected handoff gate once when ready.

- [ ] **Step 4: Stop at the live boundary**

The following are unrun unless each is explicitly authorized: `check:supabase-project`, live ingestion inventory, source fetch, activation, migration apply, PITR/restore verification, worker/edge deployment, staging, provider embeddings/summaries/evals, promotion, rollback drill, cleanup apply, hosted canary, environment changes, and production rollout.

- [ ] **Step 5: Final whole-programme review**

The SDD reviewer traces Healthdirect/eTG/AMH rejection, source activation, exact-version publication, staging ownership, worker fencing, generation completeness, eval selection, GO/NO_GO, atomic promotion, real rollback, cleanup retention, owner access, cache invalidation, and recovery prerequisites. Any unbounded target, automatic activation, destructive “rollback,” or live mutation without a digest/receipt blocks handoff.
