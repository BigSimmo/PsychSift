### Task 2: Extend metadata and authority classification

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `src/lib/source-metadata.ts`
- Modify: `src/lib/source-authority-registry.ts`
- Modify: `src/lib/source-authority-metadata.ts`
- Modify: `tests/source-metadata.test.ts`
- Modify: `tests/source-authority-tooling.test.ts`

**Interfaces:** Consumes Task 1 catalogue definitions and existing authority identities. Produces `normalizeClinicalSourceMetadata(input: ClinicalSourceMetadataInput): ClinicalSourceMetadata` and `authorityIdentityForCatalogueEntry(entry: AustralianSourceDefinition): SourceAuthorityIdentity | null` without changing relevance scoring.

**Metadata additions:**

```ts
corpus_scope: SourceCorpusScope | null;
source_role: ClinicalSourceRole | null;
content_mode: SourceContentMode | null;
source_catalogue_key: string | null;
source_policy_version: string | null;
canonical_url: string | null;
effective_date: string | null;
expiry_date: string | null;
supersedes_document_id: string | null;
superseded_by_document_id: string | null;
retrieved_at: string | null;
content_hash: string | null;
change_state: "unchanged" | "changed" | "withdrawn" | "superseded" | "unknown";
licence_policy: SourceLicencePolicy | null;
```

- [ ] **Step 1: Add failing normalisation tests**

Prove recognised enum/date/hash/URL values survive, absent values remain neutral `null`/`unknown`, malformed hashes and non-HTTPS URLs fail closed with diagnostics, and a document cannot self-assert catalogue authority from title or body text. Add a first-party boundary case: a partition-release-bound `registry_record` may carry `clinical_kb_site`, but it cannot resolve an Australian catalogue key or Australian activation eligibility.

Add a test replacing the existing current NPS expectation: identity may be recognised for historical provenance, but classification must not return active Australian augmentation eligibility.

- [ ] **Step 2: Run focused tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts`

Expected: FAIL on absent fields and current NPS behaviour.

- [ ] **Step 3: Normalise policy without inventing it**

Only an exact catalogue key plus compatible publisher code/jurisdiction may resolve catalogue policy. Keep `sourceAuthorityRegistry` for identity/designation; add `lifecycle` or an equivalent field so NPS remains recognisable but ineligible. Add Chief Psychiatrist and Australian Prescriber definitions. Do not infer content mode or licence from a document’s prose.

- [ ] **Step 4: Keep tooling mutations bounded**

Do not expand the existing `--locality-only` backfill to write governance/currentness/licence fields. Add a separate read-only audit report for proposed policy metadata. Any future write uses the explicit manifest/approval path from Task 4.

- [ ] **Step 5: Verify and checkpoint**

Run: `node scripts/run-vitest.mjs run tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/australian-source-catalogue.test.ts`

Expected: PASS.

Format and conditionally commit:

```bash
npm run format
git add src/lib/types.ts src/lib/source-metadata.ts src/lib/source-authority-registry.ts src/lib/source-authority-metadata.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts
git commit -m "feat(sources): normalize source roles and lifecycle"
```

---

