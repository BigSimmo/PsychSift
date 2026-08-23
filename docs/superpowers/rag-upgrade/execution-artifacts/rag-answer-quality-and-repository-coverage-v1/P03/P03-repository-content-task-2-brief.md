### Task 2: Build deterministic adapters and a complete static site-content manifest

**Files:**

- Create: `src/lib/site-content/site-content-manifest.ts`
- Create: `src/lib/site-content/adapters/registry.ts`
- Create: `src/lib/site-content/adapters/specifiers.ts`
- Create: `src/lib/site-content/adapters/index.ts`
- Modify: `src/lib/registry-corpus.ts`
- Reuse: `src/lib/services.ts`, `src/lib/forms.ts`, `src/lib/differentials.ts`
- Reuse: `src/lib/specifiers.ts`, `src/lib/specifiers-content.ts`
- Reuse: `src/lib/dsm.ts`, `src/lib/formulation.ts`, `src/lib/therapies.ts`
- Reuse: `src/lib/dictionary-data.ts`, `src/components/factsheets/factsheets-data.ts`
- Reuse: `data/services-snapshot.json`, `data/forms-catalog.json`, `data/medications-snapshot.json`, `data/differentials-snapshot.json`, `data/specifiers-content.json`
- Reuse: `src/data/dsm-clinical-content.json`, `src/data/formulation-content.json`, `src/data/therapies-source.json`
- Create: `scripts/build-site-content-manifest.ts`
- Create: `tests/fixtures/site-content/static-manifest-baseline.json`
- Create: `tests/site-content-manifest.test.ts`
- Modify: `tests/registry-corpus.test.ts`
- Modify: `tests/specifiers-content.test.ts`

**Interfaces:** Consumes `readonly SiteContentProducerDefinition[]`, normalized `readonly SiteContentRecord[]`, `{ gitSha: string; registryVersion: string }`, and current canonical structured producers. Produces `buildStaticSiteContentManifest(records, metadata): StaticSiteContentManifest`, deterministic record hashes/lineage, complete approved-domain coverage, and CLI `scripts/build-site-content-manifest.ts --check|--out|--baseline|--diff` with no provider access.

**Static-manifest contract:**

```ts
export type StaticSiteContentManifest = {
  version: "clinical-kb-site-static-manifest-v1";
  gitSha: string;
  registryVersion: string;
  generatedAt: string; // excluded from the deterministic digest
  records: Array<{
    logicalId: string;
    domain: SiteContentDomain;
    route: string;
    contentHash: string;
    lineageDigest: string;
    validationStatus: SiteContentRecord["validationStatus"];
    sourceStatus: SiteContentRecord["sourceStatus"];
    eligible: boolean;
    exclusionReason: string | null;
  }>;
  staticManifestDigest: string;
};
```

- [ ] **Step 1: Write failing deterministic-manifest tests**

Require stable record order, stable logical IDs, canonical whitespace, route validation, exact duplicate rejection, public-only records, and identical digests across two builds. Changing one static clinical field changes only that record hash and the static-manifest digest. Changing UI copy outside a registered producer changes neither. Dynamic registry rows are validated through the same record contract but never folded into the deployment’s expected static digest; injecting editor/administrator identifiers into a content record or digest makes the build fail.

- [ ] **Step 2: Wrap the four existing registry families**

Reuse `clinicalRegistryRowsToCorpusEntries`, `medicationRowsToCorpusEntries`, and `differentialRowsToCorpusEntries`. Do not duplicate their text composition or change current deterministic document/chunk IDs. Classify the canonical published projections as `dynamic_registry`; add `corpus_scope = clinical_kb_site`, canonical domain, route, lineage, public release identity, and logical ID to their metadata. A metadata-only adoption with identical normalized text/model/dimensions carries the verified embedding into the staged generation instead of creating a duplicate document or provider call. Legacy `owner_id` identifies the editing actor/source row only and is excluded from content, retrieval, release, and cache identities.

Before adopting those rows, add a deterministic provider-free reconciliation report for the existing owner-keyed tables. It groups by canonical logical ID, proves which version the public site currently renders, and requires administrator review for divergent duplicates; no migration may silently pick a user's copy or publish a draft. The target publication contract permits exactly one published public record per logical ID, retains `created_by`/`updated_by`/`published_by` only as server-side audit fields, and makes all mutations pass an administrator claim check.

- [ ] **Step 3: Add specifiers and the remaining approved static producers**

Wave 1 must include medications, differentials, and specifiers. Register services/forms already supported. Add DSM, formulation, therapies, dictionary, factsheets, calculators, and tools only through their canonical structured owner and only where the record has a valid source/validation role. Phased rollout may temporarily record `pending_review`, but the programme cannot complete while any approved public knowledge domain remains pending. Only permanent reviewed exclusions for private, operational, unsafe, or non-knowledge modes satisfy completion. Calculator descriptions may be indexed as `tool_reference`; calculations remain deterministic tool execution and never become generated RAG arithmetic.

Never index React-rendered prose, navigation chrome, route metadata, or raw source files. Use canonical record fields and emit a bounded, human-readable projection.

- [ ] **Step 4: Preserve source lineage and remove duplicate authority**

When a site record summarizes an uploaded/public document, store its verified source identity/hash. Merge logic later treats the summary and its source as one evidence family for support counting while retaining the site route as a navigation destination.

- [ ] **Step 5: Add the provider-free build/check/diff CLI**

```text
node scripts/run-tsx.mjs scripts/build-site-content-manifest.ts --check
node scripts/run-tsx.mjs scripts/build-site-content-manifest.ts --out .local/rag-site-content/manifest.json
node scripts/run-tsx.mjs scripts/build-site-content-manifest.ts --baseline tests/fixtures/site-content/static-manifest-baseline.json --out .local/rag-site-content/candidate.json --diff .local/rag-site-content/diff.json
```

The CLI never calls Supabase or an embedding provider. Outputs contain normalized metadata/hashes, never full protected content, administrator/user identifiers, secrets, or copied eTG/AMH text.

- [ ] **Step 6: Run adapter and manifest tests**

Run: `node scripts/run-vitest.mjs run tests/site-content-manifest.test.ts tests/site-content-registry.test.ts tests/registry-corpus.test.ts tests/specifiers-content.test.ts tests/medications.test.ts tests/differentials.test.ts`

Expected: PASS with exact static-manifest coverage, exact dynamic-adapter coverage, and no silent domain omission in the adoption registry.

---

