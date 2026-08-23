### Task 3: Enforce role eligibility, local priority, and explicit conflicts

**Files:**

- Modify: `src/lib/types.ts`
- Create: `src/lib/source-role-policy.ts`
- Modify: `src/lib/source-governance.ts`
- Modify: `src/lib/australian-source-priority.ts`
- Create: `tests/source-role-policy.test.ts`
- Create: `tests/australian-source-priority.test.ts`

**Interfaces:**

Consumes verified claim roles, eligible local/Australian evidence, currentness, and reviewed material differences. Produces the eligibility decision and `SourcePolicyConflict` contracts plus deterministic local-primary conflict handling below.

```ts
export type ClinicalClaimRole =
  "treatment" | "dose_or_monitoring" | "safety" | "legal" | "subsidy" | "quality" | "service_workflow";

export type SourceEligibilityDecision = {
  eligible: boolean;
  reason:
    "eligible" | "link_only" | "inactive" | "role_mismatch" | "not_current" | "governance_block" | "catalogue_mismatch";
};

export type SourcePolicyConflictSide = {
  documentId: string;
  catalogueKey: string;
  title: string;
  publisher: string;
  publicationDate: string | null;
  effectiveFrom: string | null;
  jurisdiction: string;
  sourceRole: ClinicalSourceRole;
  corpusScope: SourceCorpusScope;
  supportingChunkIds: string[];
};

export type SourcePolicyConflict = {
  version: "source-policy-conflict-v1";
  id: string;
  claimRole: ClinicalClaimRole;
  topicKey: string;
  local: SourcePolicyConflictSide & { corpusScope: "uploaded_local" };
  australian: SourcePolicyConflictSide & { corpusScope: "australian_public" };
  overlapReason: "same_claim" | "same_topic_and_population";
  materialDifferenceReason:
    | "recommendation_differs"
    | "dose_differs"
    | "threshold_differs"
    | "monitoring_differs"
    | "legal_status_differs"
    | "other_reviewed_material_difference";
  localPrimaryDecision: {
    selected: "uploaded_local";
    reason: "current_valid_accessible_directly_supportive";
  };
  reviewTargetDocumentId: string;
};

export type VerifiedSourcePolicyDifference = Pick<
  SourcePolicyConflict,
  "claimRole" | "topicKey" | "overlapReason" | "materialDifferenceReason"
> & {
  localChunkIds: string[];
  australianChunkIds: string[];
};

export function sourceEligibilityForClaim(args: {
  source: ClinicalSourceMetadata;
  claimRole: ClinicalClaimRole;
}): SourceEligibilityDecision;

export function resolveLocalAndAustralianEvidence(args: {
  local: SearchResult[];
  australian: SearchResult[];
  claimRole: ClinicalClaimRole;
  verifiedDifferences: VerifiedSourcePolicyDifference[];
}): {
  primary: SearchResult[];
  augmentation: SearchResult[];
  conflicts: SourcePolicyConflict[];
  reviewDocumentIds: string[];
};
```

- [ ] **Step 1: Write the policy matrix**

```ts
// tests/source-role-policy.test.ts
it("does not let PBS or legislation answer treatment claims", () => {
  expect(
    sourceEligibilityForClaim({ source: metadata({ source_role: "subsidy" }), claimRole: "treatment" }),
  ).toMatchObject({ eligible: false, reason: "role_mismatch" });
  expect(
    sourceEligibilityForClaim({ source: metadata({ source_role: "legal" }), claimRole: "treatment" }),
  ).toMatchObject({ eligible: false, reason: "role_mismatch" });
});

it("keeps the current uploaded guideline primary and surfaces a newer conflict", () => {
  const resolved = resolveLocalAndAustralianEvidence({
    local: [result({ document_id: "local", publication_date: "2025-01-01", source_role: "local_guideline" })],
    australian: [
      result({ document_id: "national", publication_date: "2026-06-01", source_role: "clinical_guideline" }),
    ],
    claimRole: "treatment",
    verifiedDifferences: [
      {
        claimRole: "treatment",
        topicKey: "treatment-sequence",
        overlapReason: "same_claim",
        materialDifferenceReason: "recommendation_differs",
        localChunkIds: ["local-chunk"],
        australianChunkIds: ["national-chunk"],
      },
    ],
  });
  expect(resolved.primary.map((source) => source.document_id)).toEqual(["local"]);
  expect(resolved.conflicts).toEqual([
    expect.objectContaining({
      version: "source-policy-conflict-v1",
      local: expect.objectContaining({
        documentId: "local",
        publicationDate: "2025-01-01",
        jurisdiction: "local",
        sourceRole: "local_guideline",
      }),
      australian: expect.objectContaining({
        documentId: "national",
        publicationDate: "2026-06-01",
        jurisdiction: "AU",
        sourceRole: "clinical_guideline",
      }),
      materialDifferenceReason: "recommendation_differs",
      localPrimaryDecision: {
        selected: "uploaded_local",
        reason: "current_valid_accessible_directly_supportive",
      },
      reviewTargetDocumentId: "local",
    }),
  ]);
  expect(resolved.reviewDocumentIds).toEqual(["local"]);
});

it("never uses link-only references as claim evidence", () => {
  expect(
    sourceEligibilityForClaim({
      source: metadata({ content_mode: "link_only", source_role: "reference_link" }),
      claimRole: "dose_or_monitoring",
    }),
  ).toEqual({ eligible: false, reason: "link_only" });
});
```

- [ ] **Step 2: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/source-role-policy.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement eligibility before ranking**

Filter ineligible candidates before relevance sorting. Preserve current relevance signals among eligible candidates. Uploaded-primary resolution applies only when the uploaded document is current, valid, accessible, extraction-acceptable, and directly supportive; otherwise Australian evidence may become primary with an explicit reason.

Conflict detection requires an upstream `VerifiedSourcePolicyDifference` proving overlapping claim/topic evidence and a material recommendation difference, plus complete source identity/date/jurisdiction/role metadata on both sides. A later publication date alone does not prove conflict; add a negative test with the same dates but `verifiedDifferences: []`. Construct the single canonical `SourcePolicyConflict` above, use stable IDs/reason codes, and carry only the verified supporting chunk IDs. This object owns both the operator review target and the user-visible conflict projection; do not create separate conflict vocabularies in retrieval, composition, or UI.

- [ ] **Step 4: Verify no ranking regression is encoded**

Run: `node scripts/run-vitest.mjs run tests/source-role-policy.test.ts tests/source-metadata.test.ts tests/rag-score.test.ts`

Expected: PASS; existing relevance scores/order remain unchanged when all candidates are role-eligible.

- [ ] **Step 5: Review and checkpoint**

Format and conditionally commit:

```bash
npm run format
git add src/lib/types.ts src/lib/source-role-policy.ts src/lib/source-governance.ts src/lib/australian-source-priority.ts tests/source-role-policy.test.ts tests/australian-source-priority.test.ts
git commit -m "feat(rag): enforce source roles and local priority"
```

---

