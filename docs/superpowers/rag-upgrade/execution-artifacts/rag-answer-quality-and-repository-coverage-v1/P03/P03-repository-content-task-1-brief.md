### Task 1: Define first-party scope, domain, authority, and snapshot contracts

**Files:**

- Reuse: `src/lib/types.ts`
- Create: `src/lib/site-content/site-content-contracts.ts`
- Create: `src/lib/site-content/site-content-registry.ts`
- Reuse: `scripts/generate-site-map.ts`
- Reuse: `scripts/audit-source-governance.ts`
- Create: `tests/site-content-registry.test.ts`
- Modify: `tests/source-metadata.test.ts`
- Modify: `tests/source-authority-tooling.test.ts`

**Interfaces:**

Consumes the evaluation-owned site/source vocabularies plus approved public repository/dynamic producers. Produces the canonical record, active release, partition snapshot, and request-local `RagContextSnapshot` contracts below.

```ts
// Import SourceCorpusScope, SiteContentDomain, SiteContentPartitionState,
// ClinicalSourceRole, and RagInsufficiencyReason from src/lib/types.ts.
// Evaluation Task 1 is their sole owner.

export type SiteContentRecord = {
  version: "site-content-record-v1";
  logicalId: string;
  producerClass: "static_repository" | "dynamic_registry";
  domain: SiteContentDomain;
  route: string;
  title: string;
  body: string;
  sourceRole: ClinicalSourceRole;
  access: "public";
  validationStatus: "unverified" | "locally_reviewed" | "approved";
  sourceStatus: "current" | "review_due" | "outdated" | "unknown";
  publicationVersion: string;
  sourceLineage: Array<{ sourceId: string; sourceHash: string; relationship: "derived_from" | "references" }>;
  contentHash: string;
};

export type ActiveSiteContentRelease = {
  version: "clinical-kb-site-release-v1";
  releaseId: string;
  registryVersion: string;
  staticManifestDigest: string;
  dynamicStateDigest: string;
  releaseDigest: string; // hash(version + registry/index contract + static/dynamic digests)
  state: "active";
  activatedAt: string;
};

export type SiteContentPartitionSnapshot = {
  releaseId: string | null;
  staticManifestDigest: string | null;
  dynamicStateDigest: string | null;
  releaseDigest: string | null;
  changeEpoch: string | null;
  state: SiteContentPartitionState;
};

export type RagContextSnapshot = {
  version: "rag-context-snapshot-v1";
  resolvedAt: string;
  documentIndexGeneration: string;
  sourcePolicyVersion: string;
  publicSiteContent: SiteContentPartitionSnapshot;
};
```

Evaluation Task 1 owns `SiteContentPartitionState` and extends `ClinicalSourceRole` with `clinical_reference`, `service_directory`, `form_reference`, and `tool_reference`. This plan consumes those aliases. Roles describe claim eligibility; `SiteContentDomain` describes where first-party content belongs. They are not interchangeable.

- [ ] **Step 1: Write the domain, scope, and authority tests**

Pin these cases:

- specifier, differential, and medication records map to `clinical_kb_site` + `clinical_reference`;
- static and database-edited producers have explicit, non-interchangeable producer classes;
- anonymous and authenticated readers resolve the same published registry projection and public release;
- only administrator-authorized mutation/publish routes can change a dynamic registry record, while `owner_id`/actor identifiers remain audit-only and never enter retrieval metadata;
- service and form records retain directory/reference roles;
- repository code, tests, prompts, docs, mockups, ward-management synthetic data, favourites, and private user state cannot register;
- draft/preview records and content versions that are not rendered by the public site cannot become eligible;
- eTG/AMH link records and Healthdirect cannot register;
- a site summary derived from an uploaded guideline retains lineage and cannot count as independent support; and
- every intended site-map knowledge mode is either registered or has a reviewed reason code.

Pin the current mode mapping explicitly: `prescribing → medications`, `therapy-compass → therapies`, and the like-named knowledge modes to their canonical domains. `documents` is managed by the trusted administrator/backend ingestion workstream and contributes only activated shared `uploaded_local`; it is not a site adapter. `favourites` remains private user state, and `answer` is the consumer rather than a corpus producer. A future app mode makes the coverage test fail until it is registered or given a reviewed permanent exclusion because it is private state, operational chrome, unsafe/non-knowledge content, or otherwise outside the approved public knowledge corpus. `pending_review` is not a completion state.

- [ ] **Step 2: Run the focused tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/site-content-registry.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts`

Expected: FAIL because no site scope/domain/registry exists and current registry projections have no canonical corpus scope.

- [ ] **Step 3: Add the canonical contracts and explicit registry**

The registry entry names the canonical published producer module/data source, publication-version field, adapter, allowed roles, public-read policy, administrator mutation policy, route builder, review owner, and activation state. It never stores arbitrary glob patterns. Use `docs/site-map.md` only as a coverage input; it is not clinical content.

- [ ] **Step 4: Separate product facts from clinical authority**

Add deterministic claim-policy tests:

- “What specifiers are available in Clinical KB?” may use the site catalogue as primary product evidence.
- “What specifiers diagnose a current patient?” requires eligible clinical evidence; a site catalogue alone cannot silently become a guideline.
- “How should lithium be monitored?” keeps a directly relevant uploaded guideline primary; a medication page may add clearly attributed navigation/summary context.
- If multiple legacy editor-owned rows exist for one logical entity, only the explicitly reconciled canonical public publication is eligible; duplicated text/lineage still counts as one evidence family.

- [ ] **Step 5: Run the focused contract suite**

Run: `node scripts/run-vitest.mjs run tests/site-content-registry.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/registry-corpus.test.ts`

Expected: PASS with existing registry behavior preserved and no new content indexed.

---

