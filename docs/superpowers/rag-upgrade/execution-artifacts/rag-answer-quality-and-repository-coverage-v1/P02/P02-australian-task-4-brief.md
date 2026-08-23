### Task 4: Bind Australian public activation to policy and generation

**Files:**

- Modify: `src/lib/publication-manifest.ts`
- Modify: `scripts/promote-public-documents-batch.ts`
- Create: `supabase/migrations/20260822123000_govern_australian_source_activation.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `tests/publication-manifest.test.ts`
- Modify: `tests/supabase-schema.test.ts`

**Interfaces:** Consumes Task 1 policy version, Task 2 metadata, Task 3 role eligibility/conflict decisions, and the existing reviewed-state digest. Produces `parsePublicationManifestV2(input: unknown): PublicationManifestV2` and service-role-only `activate_approved_public_documents(p_manifest jsonb, p_expected_state_digest text, p_expected_generation_ids uuid[]): jsonb` with fail-closed activation receipts.

**Manifest v2:**

```ts
{
  version: 2,
  sourcePolicyVersion: "australian-source-policy-v1",
  approvingOperatorId: UUID,
  reason: string,
  evidenceReferences: string[],
  documents: [{
    documentId: UUID,
    expectedOwnerId: UUID,
    expectedStateDigest: SHA256,
    expectedIndexGenerationId: UUID,
    sourceCatalogueKey: string,
    decision: "approved" | "keep_private" | "quarantine"
  }]
}
```

- [ ] **Step 1: Add manifest-v2 and schema tests**

Test that v2 rejects unknown/inactive/link-only catalogue keys, a policy-version mismatch, missing generation, malformed digest, duplicate document IDs, or an `approved` decision for eTG/AMH/NPS. Keep v1 parsing for its existing use, but v1 cannot activate a document carrying `corpus_scope = australian_public`.

- [ ] **Step 2: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/publication-manifest.test.ts tests/supabase-schema.test.ts`

Expected: FAIL on absent v2/migration constraints.

- [ ] **Step 3: Write the fail-closed migration**

Add nullable historical-compatible columns to `document_publication_approvals`:

- `source_catalogue_key text`;
- `source_policy_version text`;
- `reviewed_index_generation_id uuid`.

Extend the append-only approval insert and `publish_approved_documents` path so a document with `metadata.corpus_scope = 'australian_public'` requires:

- matching approved v2 evidence;
- exact `reviewed_state_digest` recomputed under row lock;
- exact committed `documents.index_generation_id`;
- matching catalogue key/policy version in metadata and approval;
- `content_mode = 'indexed_content'` and `licence_policy = 'public_index_permitted'`; and
- active/current/non-withdrawn state.

The database cannot import the TypeScript catalogue. Pass the exact policy fields in the signed manifest and constrain them to document metadata; code validation restricts them to the versioned catalogue. The trigger rejects `link_only` regardless of code validation.

- [ ] **Step 4: Preserve RLS and append-only behaviour**

Service role remains the only writer. Do not expose approval or source-governance rows to anon/authenticated roles. Keep historical approvals readable but unusable for a new Australian activation when v2 fields are absent.

- [ ] **Step 5: Verify locally without applying remotely**

Run: `node scripts/run-vitest.mjs run tests/publication-manifest.test.ts tests/supabase-schema.test.ts`

Expected: PASS.

Run the repository’s migration/schema static validation selected by `npm run check:production-readiness`; do not link or push a Supabase project.

- [ ] **Step 6: Review and checkpoint**

Review migration idempotence, signatures, grants, RLS, state-digest/generation race handling, and generated type diff. Format and conditionally commit:

```bash
npm run format
git add src/lib/publication-manifest.ts scripts/promote-public-documents-batch.ts supabase/migrations/20260822123000_govern_australian_source_activation.sql src/lib/supabase/database.types.ts tests/publication-manifest.test.ts tests/supabase-schema.test.ts
git commit -m "feat(sources): bind public activation to governed state"
```

---

