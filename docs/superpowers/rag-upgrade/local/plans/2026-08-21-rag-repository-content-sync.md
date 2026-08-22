# Repository-wide first-party content retrieval and freshness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use one implementer at a time and obtain a task-reviewer verdict on specification compliance and code quality before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Answer mode retrieve the relevant approved Clinical KB content for questions about specifiers, differentials, medications, services, forms, DSM, formulation, therapies, dictionary entries, factsheets, and other explicitly registered knowledge domains, while ensuring every user sees the same latest fully activated public site content and current uploaded guidelines remain primary for clinical guidance. Only administrators may add, edit, publish, or retire site content.

**Architecture:** Generalize the existing `registry-corpus.ts` path instead of building a second RAG. The current service, form, medication, and differential projections become adapters in a versioned first-party content registry. Their legacy `owner_id` identifies an editor/source row and must not become a read-visibility boundary: the public site and Answer use one canonical published record per logical ID, while mutation and publication remain administrator-only. Static canonical datasets such as specifiers join through deterministic adapters, never by scraping React pages or indexing repository files indiscriminately. A deterministic static manifest hashes repository-owned public records and source lineage. One public site release binds that manifest plus the public dynamic state. Staging reuses unchanged embeddings, tombstones deletions, evaluates isolated generations, and atomically activates the public release. The deployed application expects the exact public static-manifest digest, while durable outbox processing may activate newer public dynamic state without requiring a redeploy. A transactional public change epoch immediately invalidates eligible caches and excludes pending logical records during that short window. Each answer resolves one immutable `RagContextSnapshot` containing that public release; the next question resolves the newest valid release/change epoch.

**Tech Stack:** TypeScript 6 strict, existing `documents`/`document_chunks` projections, Supabase/PostgreSQL generation fencing, one dedicated bounded site-content outbox worker, Vitest, and the repository evaluation harness. No answer-time Git read, page crawl, HTML scrape, provider fetch, or per-question embedding is introduced.

**Spec:** [`docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md`](../specs/2026-08-20-rag-answer-and-australian-sources-design.md)

**Dependencies:**

1. Land evaluation Tasks 1–2 first so `SourceCorpusScope`, `SiteContentDomain`, insufficiency codes, and telemetry have one owner.
2. Revalidate this plan against current `origin/main`; the planning worktree predates current registry/source-governance changes.
3. Reuse the provider-free recovery-evidence and append-only activation-receipt slice from the ingestion/re-index plan. Repository Tasks 3–5 do not wait for full edge-ingestion repair or document re-index wiring, but they must not create a second recovery policy. Every document stage/evaluate/promote operation remains blocked on that edge work.
4. Land Tasks 1–5 here before retrieval Task 3 introduces corpus-scoped v3 RPCs. Retrieval Tasks 1–2 may develop against the shared types, but current `registry_record` projections must be classified and snapshot-bound before v3 behavior can serve.
5. Complete retrieval Tasks 3–8 and evaluation Tasks 3–4, then return to Task 6 here for the repository-wide programme/evaluation handoff. Evaluation Task 4 must create the shared rollout owner before this plan modifies it; adaptive-answer, incremental-delivery, and final rollout follow later.

**Effort:** Plan/review `xhigh`; Tasks 1–5 build `high`; Task 6 build `high` and production-promotion review `xhigh`. Use a strong coding model with high reasoning for provenance, access, synchronization, migrations, retrieval, and cache correctness. A fresh xhigh reviewer checks the complete programme before any live activation.

**Current-main reconciliation (2026-08-22):** `registry-corpus.ts` currently projects services, forms, medications, and differentials through optional best-effort embedding; authenticated detail routes still prefer owner-keyed database rows while anonymous readers receive public seed records. There is no specifier projection, immutable public site release, change epoch, durable outbox drain, or release-bound cache identity. The plan therefore generalizes the current owner instead of replacing working universal-search/page registries. `src/lib/rag/rag.ts` is at its enforced 4,362-line no-growth ceiling.

## Global Constraints

- “Repository-wide” means approved, user-facing Clinical KB knowledge producers, not every repository file. Never index application code, tests, prompts, developer documentation, logs, mockups, build output, operational dashboards, secrets, environment files, or arbitrary rendered HTML.
- All published `clinical_kb_site` content is public and must resolve identically for anonymous and authenticated readers. Only an administrator-authorized server path may create, edit, publish, or retire it. Legacy `owner_id` values are authorship/audit metadata, never Answer visibility or cache-partition inputs.
- Ordinary users cannot add site records or upload documents. Administrator/backend-owned document staging remains outside Answer retrieval until shared `uploaded_local` activation; published first-party site content and activated uploaded guidance are separate governed corpora.
- A current, valid, directly relevant uploaded guideline remains primary for clinical guidance. First-party site summaries cannot silently override it or count as independent corroboration when derived from the same source.
- First-party content may be primary for product/catalogue questions such as “Which specifiers are available?” or “What information is on the medication page?” Its source role and lineage still remain visible to verification.
- Source roles gate claims before relevance ranking. A service directory, form reference, calculator description, or site summary cannot become treatment guidance merely because it is relevant.
- Resolve the same canonical published record the public site renders. Exact duplicates or common-source derivatives collapse to one evidence family and cannot inflate support.
- Every eligible domain has a registered canonical producer and deterministic adapter, or an explicit reviewed exclusion. Do not infer content by crawling routes.
- Index exactly the published canonical version the user-facing site renders. Drafts, preview data, non-admin changes, and unapproved edits are ineligible. If the administrator editor publishes immediately, that edit transaction is the publication boundary; otherwise only the explicit administrator publish transaction enqueues synchronization.
- Every new question resolves the latest active public release/change epoch. One in-flight answer stays pinned to its starting snapshot so citations and incremental units cannot change underneath it.
- A stale or mismatched public site release is excluded rather than served. While a valid dynamic update is pending, only the affected logical records are excluded and the remaining public lane may continue in typed `updating` state; if exact pending-record exclusion cannot be proven, the site lane fails closed without suppressing independent uploaded/Australian lanes. There is no unrestricted web fallback.
- Static repository content is staged before the matching application release receives traffic. The runtime checks its expected static-manifest digest against the active public release’s static digest. Database-published content is transactionally marked pending in the public release; stale prior projections are immediately ineligible until activation. A dynamic publication changes only the public dynamic-state/release digests, not the deployment’s expected static digest.
- Re-embed only added/changed records. Reuse verified unchanged embeddings, tombstone removed records, and retain the prior release for rollback.
- The durable outbox needs one named execution owner. A database enqueue without a deployed, lease-fenced drain is not “automatic updating” and cannot satisfy the five-minute activation SLO.
- Keep `src/lib/rag/rag.ts` at or below 4,362 lines; context-snapshot/cache integration must be thin wiring into the new site-content modules, never a maintainability-budget increase.
- eTG and AMH remain link-only and can never enter a site-content adapter, manifest payload, chunk, embedding, or answer excerpt. Healthdirect remains excluded.
- Live Supabase reads/writes, provider embeddings, migrations, source activation, deployment, and production flag changes require the repository’s explicit authorization and target confirmation.
- Internet-disabled Cloud may align `database.types.ts` with reviewed migration SQL only as source-compilation evidence. It must not call that provider-generated proof; authoritative target regeneration and diff review occur after separately authorized migration application and before promotion.

---

## File Structure

| File                                                                         | Responsibility                                                                                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/types.ts`                                                           | Reuses the canonical `clinical_kb_site`, `SiteContentDomain`, insufficiency, and site-source role aliases seeded by evaluation Task 1.  |
| `src/lib/site-content/site-content-contracts.ts`                             | **New.** Public first-party record, manifest, release, lineage, publication, and context-snapshot types.                                |
| `src/lib/site-content/site-content-registry.ts`                              | **New.** Explicit domain/producer/adoption registry and reviewed exclusions.                                                            |
| `src/lib/site-content/site-content-manifest.ts`                              | **New.** Deterministic static-record hashing, static-manifest digest, diff, and validation.                                             |
| `src/lib/site-content/adapters/registry.ts`                                  | **New.** Wraps current service/form/medication/differential projections without duplicating their content logic.                        |
| `src/lib/site-content/adapters/specifiers.ts`                                | **New.** Projects the canonical specifier dataset with review status and source lineage.                                                |
| `src/lib/site-content/adapters/index.ts`                                     | **New.** Registers further approved DSM, formulation, therapy, dictionary, factsheet, and tool-reference adapters.                      |
| `src/lib/registry-corpus.ts`                                                 | Preserves existing projection behavior while adding canonical site scope/domain/release metadata and durable enqueue targets.           |
| `src/app/api/registry/records/[slug]/route.ts`                               | Returns the same canonical published public record to anonymous/authenticated readers.                                                  |
| `src/app/api/medications/[slug]/route.ts`                                    | Removes authenticated-owner overrides and resolves the canonical published medication.                                                  |
| `src/app/api/differentials/[slug]/route.ts`                                  | Removes authenticated-owner overrides and resolves the canonical published differential.                                                |
| `src/app/api/differentials/presentations/[slug]/route.ts`                    | Applies the same public publication contract to presentation records.                                                                   |
| `scripts/build-site-content-manifest.ts`                                     | **New.** Provider-free manifest build/check/diff CLI.                                                                                   |
| `scripts/sync-site-content-corpus.ts`                                        | **New.** Dry-run-first staged synchronization driver; live writes are separately guarded.                                               |
| `src/lib/site-content/site-content-sync.ts`                                  | **New.** Partitioned changed-only staging, dynamic-state hashing, unchanged embedding reuse, deletion tombstones, and release receipts. |
| `supabase/functions/site-content-sync/index.ts`                              | **New.** Bounded, lease-fenced outbox drain; the only automatic dynamic site-content synchronization executor.                          |
| `supabase/config.toml`                                                       | Registers the dedicated site-content synchronizer without coupling it to document ingestion.                                            |
| `supabase/migrations/20260821120000_add_site_content_release_and_outbox.sql` | **New.** Public publication state, one public release pointer, outbox/change epoch, fencing, administrator-only mutation, and RLS.      |
| `src/lib/rag/rag-context-snapshot.ts`                                        | **New.** Resolves one active uploaded/public/site/index snapshot per request.                                                           |
| `src/lib/rag/rag-query-plan.ts`                                              | Adds bounded site-domain hints without another model call.                                                                              |
| `src/lib/rag/rag-candidate-sources.ts`                                       | Includes first-party site content in the public retrieval call and filters domain hints.                                                |
| `src/lib/rag/rag-cache.ts`                                                   | Adds the public site release/change fingerprint to shared cache identities.                                                             |
| `src/lib/health-response.ts`                                                 | Reports bounded site release freshness, queue lag, and mismatch state.                                                                  |
| `tests/site-content-registry.test.ts`                                        | **New.** Domain coverage, exclusions, source roles, and no-arbitrary-files contract.                                                    |
| `tests/site-content-manifest.test.ts`                                        | **New.** Determinism, diff, lineage, deletion, and forbidden-content contract.                                                          |
| `tests/site-content-sync.test.ts`                                            | **New.** Staging, outbox, fencing, activation, rollback, and stale exclusion.                                                           |
| `tests/site-content-publication-access.test.ts`                              | **New.** Public read parity, administrator-only mutations, audit-only actor IDs, and legacy-row reconciliation.                         |
| `tests/site-content-sync-worker.test.ts`                                     | **New.** Claim/lease/retry/poison-item, bounded-batch, and no-publish-request-provider-call contract.                                   |
| `tests/rag-site-content-retrieval.test.ts`                                   | **New.** Specifier/differential/medication and cross-domain retrieval/priority cases.                                                   |
| `tests/rag-site-content-freshness.test.ts`                                   | **New.** Per-request snapshot, cache invalidation, and mismatch behavior.                                                               |

---

## Completion Evidence

This plan is complete only when:

- the current four registry families retain behavior and carry canonical `clinical_kb_site` metadata;
- specifiers, differentials, and medications pass direct and cross-domain retrieval cases;
- every approved public knowledge mode is registered and active; only private, operational, unsafe, or non-knowledge modes may carry a permanent reviewed exclusion, and no `pending_review` domain is counted complete;
- static content releases cannot receive traffic with an expected/active static-manifest mismatch;
- dynamic edits transactionally invalidate eligible cache identities, cannot serve a stale prior projection while synchronization is pending, keep unaffected records available only through an exact same-partition pending-record anti-join, and can activate a new partition release without requiring an application redeploy;
- each new question resolves the newest public release, while each in-flight answer stays snapshot-consistent;
- anonymous and authenticated readers use the same public release, candidates, and cache identity, while administrator identity remains mutation/audit-only;
- static and dynamic adapters read the same published versions the public site renders, never drafts or preview-only content;
- the deployed one-minute outbox drain is named, lease-fenced, observable, and proven separately from the enqueue transaction; without that operator evidence the dynamic lane is unavailable rather than claimed current;
- cache entries cannot cross public site releases/epochs;
- removed content is tombstoned and prior releases remain rollback-capable;
- first-party summaries never override eligible uploaded guidance or double-count their source lineage; and
- code readiness, offline evidence, live synchronization, migration status, deployment state, and production activation are reported separately.

---

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

### Task 3: Replace best-effort refresh with durable changed-only synchronization

**Files:**

- Create: `supabase/migrations/20260821120000_add_site_content_release_and_outbox.sql`
- Create: `src/lib/site-content/site-content-sync.ts`
- Create: `supabase/functions/site-content-sync/index.ts`
- Create: `scripts/sync-site-content-corpus.ts`
- Modify: `supabase/config.toml`
- Modify: `src/lib/registry-corpus.ts`
- Modify: `src/app/api/registry/records/[slug]/route.ts`
- Modify: `src/app/api/registry/records/route.ts`
- Modify: `src/app/api/medications/[slug]/route.ts`
- Modify: `src/app/api/medications/route.ts`
- Modify: `src/app/api/differentials/[slug]/route.ts`
- Modify: `src/app/api/differentials/route.ts`
- Modify: `src/app/api/differentials/presentations/[slug]/route.ts`
- Modify: `src/lib/registry-seed.ts`
- Modify: `src/lib/medication-seed.ts`
- Modify: `src/lib/differential-seed.ts`
- Modify: `src/lib/supabase/database.types.ts`
- Create: `tests/site-content-sync.test.ts`
- Create: `tests/site-content-sync-worker.test.ts`
- Create: `tests/site-content-publication-access.test.ts`
- Modify: `tests/registry-records-route.test.ts`
- Modify: `tests/medications-route.test.ts`
- Modify: `tests/differentials-route.test.ts`
- Modify: `tests/registry-corpus.test.ts`
- Modify: `tests/function-grants.test.ts`
- Modify: `tests/supabase-schema.test.ts`

**Interfaces:** Consumes `StaticSiteContentManifest`, normalized public dynamic records, `RecoveryReadinessEvidence`, worker/lease identity, and an exact expected state digest. Produces `planSiteContentSync(input: SiteContentSyncInput): SiteContentSyncPlan`, `runSiteContentSync(plan, lease): Promise<SiteContentSyncResult>`, service-role RPCs `claim_site_content_sync_events(p_worker_id uuid, p_limit integer, p_lease_seconds integer)` and `activate_site_content_release(p_release_id uuid, p_expected_release_digest text, p_recovery_digest text)`, canonical public collection/detail readers, and append-only activation/rollback receipts.

- [ ] **Step 1: Write the release, outbox, fencing, and rollback tests**

Pin these invariants:

- publishing an editable registry record and enqueuing its logical ID occur in one transaction; saving a draft does neither;
- that transaction increments the public change epoch, invalidates eligible cache identities, and makes the previous projection ineligible immediately, so stale text is never served during retry;
- anonymous, ordinary authenticated, and administrator collection/detail reads produce the same public candidate set, record identity, governance metadata, and release fingerprint;
- non-admin create/update/publish/delete requests fail before any row, outbox, epoch, or cache state changes;
- initial legacy-row reconciliation requires a bounded digested plan and cannot activate until every divergent duplicate has an explicit administrator disposition;
- an `updating` request may retrieve unaffected same-partition records only when SQL proves an exact pending-record anti-join; otherwise that partition is unavailable;
- unchanged content reuses its verified embedding and is not re-sent to the provider;
- changed/added records stage under a candidate release; deleted records create tombstones;
- a stale worker lease/generation cannot commit;
- activation switches the public release pointer only after counts, hashes, public visibility, administrator publication evidence, governance, and must-pass retrieval checks agree; and
- rollback restores the prior public release without reconstructing it.

- [ ] **Step 2: Add a minimal release/outbox migration**

Use fixed search paths, least-privilege service-role grants, RLS, a global unique published logical-record identity, one public release identity, a monotonic transactional public change epoch, idempotent claims, lease expiry, and append-only activation/rollback receipts. Direct anon/authenticated writes remain revoked; mutation RPCs/server routes require the repository's administrator claim and record actor IDs only in audit columns/receipts. `owner_id` may remain temporarily for legacy row provenance but cannot participate in read visibility or publication uniqueness. Reuse the ingestion plan’s generation identifiers and recovery evidence rather than creating independent backup policy.

Update the four current detail routes and the three owner-preferring collection routes (`registry/records`, `medications`, and `differentials`) so authentication no longer selects an `owner_id`-specific registry row. Their seed/query helpers resolve the same canonical public publication for list, search, and slug lookup; seeds remain only the explicit public fallback defined by the release contract. Anonymous, ordinary authenticated, and administrator GET requests resolve the same canonical published public record and governance metadata. Reuse `requireAuthenticatedUser(..., { administrator: true })` on any mutation/publication server path; direct database writes stay service-role-only. Route tests must prove byte-equivalent reader parity for collection and detail responses, divergent owner-row exclusion, and that a non-admin cannot create, edit, publish, retire, enqueue, or advance the public change epoch.

- [ ] **Step 3: Add one bounded, lease-fenced outbox drain**

`supabase/functions/site-content-sync/index.ts` is the sole automatic executor for dynamic site-content events. It claims a bounded batch through a service-role-only RPC, carries worker/lease/generation identity through every stage, heartbeats long embedding batches, retries with bounded backoff, quarantines poison items after the reviewed attempt limit, and can complete only rows still owned by its live lease. It logs identifiers/digests/counts only, never record content or actor IDs. A publish request commits the public row, epoch, pending exclusion, and outbox event, then returns; it never waits for OpenAI or invokes embedding inline.

The scheduler/invoker is explicit in the operator runbook and is a live deployment decision: recommended initial cadence is one minute, which can satisfy the five-minute SLO with bounded batches. Missing deployment, invocation credentials, or cadence leaves the lane `unavailable`, not silently “automatic.” Worker deployment, cron/`pg_net` configuration, provider calls, and live queue reads are separately approval-gated.

- [ ] **Step 4: Implement changed-only staging**

The synchronizer consumes a reviewed static-manifest diff or the exact normalized public dynamic population, verifies project/release identity, stages only added/changed records, carries unchanged projections forward without a provider call, and tombstones deletions. It computes `dynamicStateDigest` from the public published population, then computes the candidate `releaseDigest` from registry/index contract plus static/dynamic digests. Default is dry-run. A live write requires explicit `--write`, target confirmation, current recovery evidence, and the repository provider guard.

Initial adoption uses a provider-free reconciliation plan with exact public record/hash counts, divergent-duplicate dispositions, total changed/unchanged/tombstone counts, bounded batch size, and a plan digest. Live batches are resumable and require that digest plus expected counts; receipts contain no administrator/user identifiers. A failed batch cannot activate an incomplete public release and cannot remove rollback availability.

- [ ] **Step 5: Replace optional best-effort update hooks**

Do not synchronously call OpenAI in a request that publishes a site record. Bind the outbox hook to the same administrator-only publication boundary the public site renderer uses. Persist the published version plus public outbox event, increment the public change epoch, mark the affected old projection ineligible, and let the fenced worker retry. Draft-only saves remain invisible to both site retrieval and the RAG corpus. Activation binds the completed dynamic state to a new public release and closes only its matching pending events. Keep `RAG_REGISTRY_CORPUS_EMBEDDING` only as a temporary compatibility flag until the durable path is proven, then retire it through a separately reviewed migration/config change.

- [ ] **Step 6: Run the focused database/source tests**

Run:

```text
node scripts/run-vitest.mjs run tests/site-content-sync.test.ts tests/site-content-sync-worker.test.ts tests/site-content-publication-access.test.ts tests/registry-records-route.test.ts tests/medications-route.test.ts tests/differentials-route.test.ts tests/registry-corpus.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts tests/ingestion-mutation-safety.test.ts tests/reindex-pipeline.test.ts
node scripts/run-tsx.mjs scripts/sync-site-content-corpus.ts --manifest .local/rag-site-content/manifest.json --dry-run
```

Expected: PASS/source-only. No migration is applied and no provider/live project is contacted.

---

### Task 4: Bind public static and administrator-published dynamic content to one activation contract

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci-change-scope.mjs`
- Create: `scripts/check-site-content-freshness.ts`
- Modify: `src/lib/health-response.ts`
- Create: `tests/site-content-freshness-workflow.test.ts`
- Create: `tests/site-content-health.test.ts`
- Create: `tests/ci-scope-contract.test.ts`
- Create: `tests/fixtures/site-content/release-evidence-current.json`

**Interfaces:** Consumes `{ expectedStaticManifestDigest, activeRelease, queueHealth, deploymentSha }`. Produces `classifySiteContentHealth(input: SiteContentHealthInput): SiteContentHealthClassification`, CLI `scripts/check-site-content-freshness.ts --evidence tests/fixtures/site-content/release-evidence-current.json`, CI/deployment freshness selection, and the provider-free release-evidence fixture.

- [ ] **Step 1: Add fail-closed workflow tests**

When a registered static canonical producer changes, CI must build and validate the static manifest plus domain fixtures. The default-branch release path may stage a candidate only with approved provider/Supabase authority. Application traffic cannot be promoted when the runtime’s expected static-manifest digest differs from the active public release’s `staticManifestDigest`.

- [ ] **Step 2: Define two freshness paths**

1. **Static repository content:** build and evaluate the candidate public site release before the matching application deployment is activated. The deployed runtime carries the exact expected `staticManifestDigest`.
2. **Administrator-published database content:** at the same administrator-only publication boundary used by the public site, enqueue and increment the public change epoch transactionally, exclude the stale projection immediately, recompute `dynamicStateDigest`, activate the public release after verification, and expose bounded queue lag/failed-item counts. Pending records are anti-joined from candidate retrieval and the changed epoch invalidates eligible site-backed caches. Draft saves and non-admin requests do not participate. A dynamic update can activate without changing `staticManifestDigest` or redeploying.

Do not run a full site re-index on every repository change. The change-scope selector triggers only when registered producer inputs, adapter contracts, source governance, embeddings, or retrieval contracts change.

- [ ] **Step 3: Add freshness health and stop conditions**

Health reports only public release ID, static-match boolean, public release-digest prefix, aggregate `current`/`updating`/failure state, synchronizer-deployed/invocation-fresh booleans, bounded queue counts, oldest queue age, failed count, last activation, and rollback availability. It exposes no content, administrator/user IDs, routes containing private identifiers, change-epoch values, or provider errors. The public release is `current` only when the runtime expected static digest matches and integrity is complete. `updating` requires an exact pending-record exclusion set, a recently invoked worker, and no integrity failure. The initial dynamic publication SLO is activation within five minutes; queue age beyond ten minutes alerts, and a missing/stale worker heartbeat, failed item, or over-age item is a promotion/operation stop until investigated or rolled back.

- [ ] **Step 4: Implement fail-closed release checks**

`scripts/check-site-content-freshness.ts` accepts offline artifacts by default. Live read mode is separate and approval-gated. It fails on a missing/mismatched expected-versus-active public static digest, a missing/invalid dynamic/release digest, more than one published record for a logical ID, non-admin publication evidence, an inconsistent public epoch/pending set, partial population, untracked deletion, unreviewed domain, stale source/validation status, or mismatched deployment SHA. A valid pending dynamic change reports `updating`, not deployment mismatch; a failed/over-age pending item is a stop condition.

- [ ] **Step 5: Run workflow and health tests**

Run: `node scripts/run-vitest.mjs run tests/site-content-freshness-workflow.test.ts tests/site-content-health.test.ts tests/ci-scope-contract.test.ts`

Expected: PASS; hosted staging/deployment remains unrun.

---

### Task 5: Bind every question and cache entry to its current public snapshot

**Files:**

- Create: `src/lib/rag/rag-context-snapshot.ts`
- Modify: `src/lib/rag/rag-contracts.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/lib/rag/rag-cache.ts`
- Create: `tests/rag-site-content-freshness.test.ts`
- Modify: `tests/rag-cache-invalidation.test.ts`
- Modify: `tests/rag-shared-cache.test.ts`

**Interfaces:** Consumes `{ documentIndexGeneration, sourcePolicyVersion, activeSiteRelease, publicChangeEpoch, rolloutVersion }` once at request start. Produces `resolveRagContextSnapshot(input: RagContextSnapshotInput): Promise<RagContextSnapshot>`, `ragContextSnapshotCacheKey(snapshot): string`, and invalidation tags bound to the immutable snapshot; every downstream retrieval/cache call receives that exact object.

**Request-snapshot contract:**

```ts
export function resolveRagContextSnapshot(args: {
  expectedSiteStaticManifestDigest: string | null;
  activePublicSiteRelease: ActiveSiteContentRelease | null;
  publicSiteChangeEpoch: string | null;
  pendingPublicSiteChangeCount: number;
  documentIndexGeneration: string;
  sourcePolicyVersion: string;
}): RagContextSnapshot;
```

- [ ] **Step 1: Write the request-snapshot and cache matrix**

Required cases:

- a matching expected/active public static digest plus valid public dynamic/release digests resolves a current public partition;
- missing, malformed, staged, rolled-back, or mismatched releases resolve `unavailable`/`stale`, never `current`;
- a valid pending database edit changes the epoch, resolves `updating`, prevents retrieval of pending logical records, and invalidates prior cache keys before the new release activates;
- activation may change the public release/dynamic digest while the public static digest remains matched;
- anonymous and authenticated requests resolve the same public snapshot and cache fingerprint;
- public/shared keys differ across public registry/static/dynamic/release changes;
- legacy keys remain byte-compatible when the site component is off;
- no release ID/digest, change epoch, administrator/user ID, route, or content appears in client payloads or telemetry; and
- one request reuses exactly one snapshot even if the active pointer changes during generation.

- [ ] **Step 2: Resolve one request-local context snapshot**

Resolve the active shared uploaded-document generation set, source policy, and public site release before cache lookup. Owned document staging and legacy owner-private uploads cannot enter this snapshot. Reuse the snapshot through retrieval, generation, verification, telemetry, and every incremental unit. The next request resolves again. If the public release changes mid-answer, the current response remains internally consistent and the following question uses the new release.

- [ ] **Step 3: Bind every cache and coalescing identity**

Public/shared search and answer cache fingerprints include site registry version, public release digest/change epoch, source-policy version, index generation, and programme mode. They are writable only when all selected evidence is public. A changed dynamic record therefore invalidates eligible site-backed cache entries in the same transaction, before replacement activation and without a redeploy. A mismatch is a miss, never a stale hit.

- [ ] **Step 4: Fail closed only for the site lane**

A stale/unavailable public release supplies no `clinical_kb_site` scope and maps to `site_content_stale` or `site_content_unavailable` for a subquestion that required it. An `updating` release may supply its site scope only when the v3 RPC anti-joins every pending logical record; an otherwise-answerable affected subquestion maps to `site_content_updating`. None of these states blocks valid uploaded/Australian retrieval, triggers unrestricted web search, changes administrator permissions, or reuses a prior site-backed answer. The retrieval plan owns actual lane/RPC/domain integration.

- [ ] **Step 5: Hand off the immutable snapshot to retrieval**

Before proceeding, require a passing reviewer verdict on the snapshot/cache contract. Then execute retrieval Tasks 1–3, which add deterministic domain hints and the site-aware v3 RPC using this snapshot. Do not duplicate the lane implementation here.

- [ ] **Step 6: Run focused snapshot/cache tests**

Run:

```text
node scripts/run-vitest.mjs run tests/rag-site-content-freshness.test.ts tests/rag-cache-invalidation.test.ts tests/rag-shared-cache.test.ts tests/rag-rollout.test.ts tests/rag-abort-signal.test.ts
```

Expected: PASS with one immutable snapshot per request and no stale cross-release cache hit.

---

### Task 6: Add repository-wide must-pass cases, rollout controls, and operating evidence

**Files:**

- Modify: `scripts/fixtures/rag-programme-failures.v1.json`
- Modify: `src/lib/rag/rag-eval-cases.ts`
- Modify: `src/lib/rag/rag-programme-eval.ts`
- Modify: `src/lib/rag/rag-programme-telemetry.ts`
- Modify: `src/lib/rag/rag-rollout.ts`
- Create: `docs/rag-upgrade-rollout-runbook.md`
- Create: `tests/rag-site-content-programme.test.ts`
- Modify: `tests/rag-programme-eval.test.ts`
- Modify: `tests/rag-programme-telemetry.test.ts`

**Interfaces:** Consumes repository Tasks 1–5, retrieval Tasks 1–8, and evaluation Tasks 1–4. Produces `repositoryContentProgrammeCases(): RagProgrammeEvalCase[]` and `siteContentProgrammeMetrics(input: SiteContentMetricInput): SiteContentProgrammeMetrics`, plus rollout controls, the initial programme runbook, and an explicit active/permanently-excluded domain disposition.

- [ ] **Step 1: Add must-pass questions**

Include at least:

1. specifier lookup with exact site record and source-status behavior;
2. differential presentation/diagnosis query;
3. medication management query requiring site content plus uploaded-guideline priority;
4. cross-domain medication/differential/specifier question;
5. a static field changed between manifests and an administrator-published database field changed between dynamic states: the old dynamic value/cache becomes unavailable immediately, unaffected public records remain retrievable while updating, and the new value appears only after matching activation;
6. deleted record never retrieved;
7. a stale expected/active static digest excludes the public site lane without suppressing uploaded/Australian retrieval, while a valid pending dynamic change reports updating, excludes its affected record, and invalidates eligible cache;
8. product-fact question where site content is appropriately primary; and
9. duplicated derivative/source content that cannot inflate support; and
10. the same published medication/differential/service record and release fingerprint are returned to anonymous and authenticated readers; and
11. a non-admin mutation/publish attempt cannot change the public row, release, outbox, epoch, candidate set, or cache identity.

- [ ] **Step 2: Extend privacy-safe metrics**

Record only public site-lane state, release-age bucket, target/selected domain enums, candidate/selected counts, public static-manifest-match boolean, pending-count/queue-lag buckets, and typed exclusions. Never log question text, site record bodies, repository paths, change epochs, administrator/user IDs, source-lineage IDs, or provider errors.

- [ ] **Step 3: Add independent rollout controls**

Add server-side `RAG_SITE_CONTENT_ENABLED=false` and include it in the existing typed rollout decision, health response, cache fingerprint, and truth tests. Whole-programme `RAG_PROGRAMME_MODE=legacy` remains the final rollback. Disabling site content restores uploaded/Australian behavior without disabling adaptive answers or verified delivery.

- [ ] **Step 4: Define activation order**

1. contracts/registry and offline static manifest;
2. existing registry families in shadow;
3. specifiers, differentials, and medications must-pass cases;
4. remaining approved domains one wave at a time;
5. context snapshot/cache binding;
6. internal candidate mode;
7. separately approved default-branch staging and live canary; and
8. application release only after its expected static manifest matches a valid active public release and administrator-only publication controls are proven.

- [ ] **Step 5: Run the offline programme envelope**

Run:

```text
node scripts/run-vitest.mjs run tests/rag-site-content-programme.test.ts tests/rag-programme-eval.test.ts tests/rag-programme-telemetry.test.ts tests/site-content-manifest.test.ts tests/site-content-sync.test.ts tests/rag-site-content-retrieval.test.ts tests/rag-site-content-freshness.test.ts
node scripts/run-tsx.mjs scripts/build-site-content-manifest.ts --check
node scripts/run-tsx.mjs scripts/check-site-content-freshness.ts --offline tests/fixtures/site-content/release-evidence-current.json
```

Expected: PASS/source-only. Provider embeddings, live Supabase state, hosted workflows, migration application, deployment, and production flags remain unrun until separately authorized.

- [ ] **Step 6: Obtain final review, activate every approved domain, and record only permanent exclusions**

The reviewer requires exact Wave 1 parity for specifiers, differentials, and medications; an explicit inclusion/exclusion decision for every other intended knowledge mode; uploaded-guideline priority proof; and no stale site-content path. Any domain still excluded remains a tracked rollout item, not an implicit claim of repository-wide completion.

---
