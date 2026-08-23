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

