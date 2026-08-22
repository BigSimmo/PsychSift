# Australian source governance for RAG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Dispatch one implementer at a time and require a task-reviewer verdict for specification compliance and code quality before proceeding. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a typed, enforceable Australian source catalogue that augments uploaded indexed guidelines, excludes Healthdirect, treats eTG and AMH as link-only, constrains every source to its proper role, and binds public activation to the exact governed document/index state a human approved.

**Architecture:** A versioned code catalogue is the canonical policy definition. Existing authority identity classification remains metadata-only; the catalogue adds lifecycle, corpus, role, content-mode, licence, and canonical-link policy. A pure eligibility/resolution layer keeps uploaded current guidelines primary without applying a broad authority score boost. Publication manifest v2 and a database migration bind Australian public activation to catalogue key, policy version, committed index generation, and the existing reviewed-state digest.

**Tech Stack:** TypeScript 6 strict, Zod, PostgreSQL/Supabase migrations and RLS, Vitest. No public-site fetch or hosted mutation occurs in this plan.

**Spec:** [`docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md`](../specs/2026-08-20-rag-answer-and-australian-sources-design.md)

**Dependency:** Land Task 1 of [`2026-08-20-rag-evaluation-rollout.md`](2026-08-20-rag-evaluation-rollout.md) first so this plan reuses its canonical corpus/role enums; land evaluation Task 2 before activating behaviour. Catalogue and pure-policy code may otherwise be developed offline, but public retrieval/activation requires the programme metrics and privacy-safe telemetry contracts.

**First-party boundary:** [`2026-08-21-rag-repository-content-sync.md`](2026-08-21-rag-repository-content-sync.md) owns `clinical_kb_site`, site domains, manifests, and registry projections. This plan owns Australian external-source policy. Neither may relabel the other’s content to bypass its activation or authority rules.

**Effort:** Plan/review `xhigh`; Tasks 1–4 build `high`; Task 5 build `medium-high`; Task 6 build `high`. Use the most capable coding model with high reasoning for policy/database tasks and a standard coding model with medium-high reasoning for link presentation. Final cross-plan review uses xhigh.

**Current-main reconciliation (2026-08-22):** `source-authority-registry.ts` already classifies WA, national, state, NICE, and WHO publisher identities, but it carries no content-mode/licence/activation policy and currently contains no Healthdirect, eTG, or AMH entry. `source-governance.ts` now owns `resolveEvidenceWarningSeverity`; extend it rather than replacing that warning logic. The current `tests/check-indexing-contract.test.ts` still uses `registry_record_id: "amh"` as an indexed fixture and must be corrected by Task 5. `src/lib/rag/rag.ts` is at its enforced 4,362-line no-growth ceiling.

## Global Constraints

- A current, valid, accessible uploaded local guideline is primary when it directly answers the question.
- Australian sources augment uploaded guidelines. They may fill gaps and expose currency conflicts; they do not silently override local policy.
- Clinical KB site records are a separate first-party scope. `source_kind = registry_record` is never inferred to be Australian public authority, and first-party summaries retain lineage rather than becoming independent corroboration.
- Source role is an eligibility constraint, not a global relevance boost. Do not repeat the refuted governance-weight ranking experiment.
- Healthdirect is forbidden: no catalogue entry, discovery seed, fetch, ingestion, retrieval, reference suggestion, or answer citation.
- Trusted pages can contain excluded-site navigation or emergency widgets. Strip site chrome and outbound-link targets during extraction; if a Healthdirect marker survives in a candidate searchable unit, quarantine that unit/document for review rather than allowing it into chunks, embeddings, prompts, suggestions, or citations.
- eTG complete and the Australian Medicines Handbook are `reference_link` + `link_only`. Never download, copy, quote, summarise, cache, chunk, embed, index, or attribute factual claims to unseen protected content.
- NPS MedicineWise is historical, not a current active authority. Current successor material is attributed to its current publisher.
- Uploaded access rules are unchanged: ordinary users cannot upload, and administrator/backend staging remains ineligible until shared `uploaded_local` activation. Public augmentation cannot expose drafts, quarantine, or legacy private rows.
- Public content is inactive until a human approval is bound to the exact state digest, index generation, catalogue entry, and source-policy version.
- An official publisher/domain is not a licence. Public catalogue roots default to `review_required`; only an exact document version with recorded licence evidence may become `public_index_permitted`.
- Legislation supports legal claims; PBS supports subsidy/restriction claims; neither substitutes for treatment guidance.
- Database changes require local/static proof first. Live Supabase inspection/migration/application requires explicit authorization and healthy recovery prerequisites.
- Internet-disabled Cloud may keep `database.types.ts` aligned with the reviewed migration contract for source compilation, but that is source-only expected-schema evidence, not proof of a hosted schema. Authoritative type regeneration occurs only after separately authorized target migration/application and its generated diff must be reviewed before promotion.
- Publisher identity remains single-owned by `source-authority-registry.ts`. The Australian policy catalogue may reference a registry publisher code but must not create a second alias/domain/jurisdiction identity map; tests prove every indexed catalogue entry resolves to exactly one authority identity.
- Keep `src/lib/rag/rag.ts` at or below 4,362 lines. Source-policy integration is thin wiring into the catalogue/role modules; never raise the maintainability budget.

---

## File Structure

| File                                                                         | Responsibility                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/lib/australian-source-catalogue.ts`                                     | **New.** Versioned trusted-source definitions and lookup helpers.                                                |
| `src/lib/types.ts`                                                           | Adds corpus, role, content-mode, licence, lifecycle, dates, URLs, supersession, hash, and change-state metadata. |
| `src/lib/source-metadata.ts`                                                 | Normalises the new typed metadata without inventing authority.                                                   |
| `src/lib/source-authority-registry.ts`                                       | Adds missing current authorities, marks NPS historical, and removes it from active eligibility.                  |
| `src/lib/source-authority-metadata.ts`                                       | Audits catalogue identity/policy fields separately from locality-only corrections.                               |
| `src/lib/source-role-policy.ts`                                              | **New.** Claim-role eligibility and local-primary conflict resolution.                                           |
| `src/lib/source-governance.ts`                                               | Applies content-mode/currentness/role/catalogue danger gates.                                                    |
| `src/lib/publication-manifest.ts`                                            | Adds Australian public activation manifest v2.                                                                   |
| `scripts/promote-public-documents-batch.ts`                                  | Passes the v2 governed activation fields to the RPC.                                                             |
| `supabase/migrations/20260822123000_govern_australian_source_activation.sql` | **New.** Approval binding and fail-closed publication rules.                                                     |
| `src/lib/supabase/database.types.ts`                                         | Regenerated only from the reviewed migration contract.                                                           |
| `src/lib/source-reference-links.ts`                                          | **New.** Safe eTG/AMH reference-link suggestions.                                                                |
| `src/lib/answer-client-payload.ts`                                           | Preserves only the allow-listed reference-link fields in the governed final payload.                             |
| `src/components/clinical-dashboard/answer-reference-links.tsx`               | **New.** Displays link-only references distinctly and never as citations.                                        |
| `src/components/clinical-dashboard/answer-result-surface.tsx`                | Renders final-only authenticated references below the complete primary answer.                                   |
| `src/components/clinical-dashboard/answer-thread-turn.tsx`                   | Gives expanded prior turns the same final-only reference affordance.                                             |
| `tests/australian-source-catalogue.test.ts`                                  | **New.** Catalogue allow/exclude/lifecycle contract.                                                             |
| `tests/source-role-policy.test.ts`                                           | **New.** Eligibility, priority, and conflicts.                                                                   |
| `tests/source-metadata.test.ts`                                              | Metadata normalisation.                                                                                          |
| `tests/source-authority-tooling.test.ts`                                     | Identity and historical-currentness behaviour.                                                                   |
| `tests/publication-manifest.test.ts`                                         | Manifest v2 validation.                                                                                          |
| `tests/supabase-schema.test.ts`                                              | Migration/RLS/approval contract.                                                                                 |
| `tests/source-reference-links.test.ts`                                       | **New.** Link-only and no-content contract.                                                                      |
| `tests/answer-reference-links.dom.test.tsx`                                  | **New.** Final-only, accessible, non-citation rendering contract.                                                |
| `tests/check-indexing-contract.test.ts`                                      | Replaces the current `registry_record_id: "amh"` indexed fixture and adds a link-only rejection pin.             |

---

## Completion Evidence

Report separately:

- catalogue/policy test results;
- schema/migration static proof;
- link-only UI proof;
- local/offline production-readiness result;
- live provider/Supabase/source checks not run;
- migration applied or not applied;
- public documents activated or not activated;
- first-party/Australian scope-separation proof;
- commit/push/deploy status; and
- source/licence facts reverified against official current pages at implementation time.

---

### Task 1: Define the versioned Australian catalogue

**Files:**

- Create: `src/lib/australian-source-catalogue.ts`
- Modify: `src/lib/types.ts`
- Create: `data/australian-source-verification.v1.json`
- Create: `tests/australian-source-catalogue.test.ts`
- Modify: `tests/check-indexing-contract.test.ts`
- Modify: `tests/registry-corpus.test.ts`

**Interfaces:**

Consumes the canonical evaluation-owned source scope/role vocabularies and reviewed official-source metadata manifest. Produces `AustralianSourceDefinition`, `australianSourcePolicyVersion`, lookup/indexability functions, and the fail-closed catalogue assertion below.

```ts
// Import the canonical SourceCorpusScope and ClinicalSourceRole aliases seeded
// by evaluation Task 1; do not redefine either vocabulary here.
export type SourceContentMode = "indexed_content" | "link_only";
export type SourceLifecycle = "active" | "historical" | "retired";
export type SourceLicencePolicy =
  "review_required" | "public_index_permitted" | "metadata_link_only" | "index_forbidden";

export type AustralianSourceDefinition = Readonly<{
  key: string;
  publisherCode: string;
  publisher: string;
  canonicalUrl: string;
  jurisdiction: string;
  corpusScope: "australian_public";
  roles: readonly ClinicalSourceRole[];
  contentMode: SourceContentMode;
  licencePolicy: SourceLicencePolicy;
  lifecycle: SourceLifecycle;
  fallbackRank: number;
}>;

export const australianSourcePolicyVersion = "australian-source-policy-v1" as const;
export function australianSourceByKey(key: string): AustralianSourceDefinition | null;
export function isIndexableAustralianSource(key: string, exactDocumentLicence: SourceLicencePolicy): boolean;
export function assertIndexableCatalogueEntry(
  source: AustralianSourceDefinition | null,
): asserts source is AustralianSourceDefinition;
```

- [ ] **Step 1: Write the catalogue invariants first**

```ts
// tests/australian-source-catalogue.test.ts
import { describe, expect, it } from "vitest";
import {
  australianSourceByKey,
  australianSourceCatalogue,
  australianSourcePolicyVersion,
  assertIndexableCatalogueEntry,
  isIndexableAustralianSource,
} from "@/lib/australian-source-catalogue";
import { sourceAuthorityForPublisherCode } from "@/lib/source-authority-registry";

describe("Australian source catalogue", () => {
  it("keeps Healthdirect completely outside the catalogue", () => {
    expect(
      australianSourceCatalogue.some((source) =>
        /healthdirect/i.test(`${source.key} ${source.publisher} ${source.canonicalUrl}`),
      ),
    ).toBe(false);
  });

  it("makes eTG and AMH authenticated link-only references", () => {
    for (const key of ["etg-complete", "australian-medicines-handbook"]) {
      expect(australianSourceByKey(key)).toMatchObject({
        roles: ["reference_link"],
        contentMode: "link_only",
        licencePolicy: "metadata_link_only",
        lifecycle: "active",
      });
      expect(isIndexableAustralianSource(key, "public_index_permitted")).toBe(false);
    }
  });

  it("forbids link-only references from every content-bearing index projection", () => {
    for (const key of ["etg-complete", "australian-medicines-handbook"]) {
      expect(() => assertIndexableCatalogueEntry(australianSourceByKey(key))).toThrow(/link-only/i);
    }
  });

  it("marks NPS MedicineWise historical rather than current", () => {
    expect(australianSourceByKey("nps-medicinewise")).toMatchObject({ lifecycle: "historical" });
    expect(isIndexableAustralianSource("nps-medicinewise", "public_index_permitted")).toBe(false);
  });

  it("contains unique stable keys, codes, URLs, and a versioned policy", () => {
    expect(australianSourcePolicyVersion).toBe("australian-source-policy-v1");
    expect(new Set(australianSourceCatalogue.map((source) => source.key)).size).toBe(australianSourceCatalogue.length);
    expect(australianSourceCatalogue.every((source) => new URL(source.canonicalUrl).protocol === "https:")).toBe(true);
  });

  it("reuses exactly one existing authority identity per indexed catalogue entry", () => {
    for (const source of australianSourceCatalogue.filter((entry) => entry.contentMode === "indexed_content")) {
      expect(sourceAuthorityForPublisherCode(source.publisherCode)?.key).toBeTruthy();
    }
  });

  it("does not treat an official publisher root as document-level indexing permission", () => {
    expect(australianSourceByKey("wa-health")?.licencePolicy).toBe("review_required");
    expect(isIndexableAustralianSource("wa-health", "review_required")).toBe(false);
    expect(isIndexableAustralianSource("wa-health", "public_index_permitted")).toBe(true);
  });
});
```

- [ ] **Step 2: Prove the new module is absent**

Run: `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts`

Expected: FAIL because the catalogue module does not exist.

- [ ] **Step 3: Implement the explicit catalogue**

Include these keys and canonical roots:

| Key                                   | Canonical URL                                                                       | Role/lifecycle                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `wa-health`                           | `https://www.health.wa.gov.au/About-us/Policy-frameworks`                           | service policy, active                        |
| `wa-chief-psychiatrist`               | `https://www.chiefpsychiatrist.wa.gov.au/laws-and-rights/standards-and-guidelines/` | clinical guideline/quality standard, active   |
| `wa-legislation`                      | `https://www.legislation.wa.gov.au/`                                                | legal, active                                 |
| `tga`                                 | `https://www.tga.gov.au/`                                                           | regulatory/safety alert, active               |
| `acsqhc`                              | `https://www.safetyandquality.gov.au/`                                              | quality standard, active                      |
| `australian-health-disability-ageing` | `https://www.health.gov.au/`                                                        | official programme/guideline roles, active    |
| `nhmrc`                               | `https://www.nhmrc.gov.au/guidelines`                                               | clinical guideline, active                    |
| `ranzcp`                              | `https://www.ranzcp.org/clinical-guidelines-publications`                           | clinical guideline, active                    |
| `racgp`                               | `https://www.racgp.org.au/clinical-resources/clinical-guidelines`                   | clinical guideline within scope, active       |
| `pbs`                                 | `https://www.pbs.gov.au/`                                                           | subsidy, active                               |
| `australian-prescriber`               | `https://australianprescriber.tg.org.au/`                                           | professional review, active                   |
| `etg-complete`                        | `https://www.tg.org.au/`                                                            | reference link, link-only                     |
| `australian-medicines-handbook`       | `https://shop.amh.net.au/`                                                          | reference link, link-only                     |
| `nps-medicinewise`                    | `https://www.medicinewise.org.au/`                                                  | historical only                               |
| `nsw-health`                          | `https://www.health.nsw.gov.au/`                                                    | NSW-labelled service/clinical fallback        |
| `queensland-health`                   | `https://www.health.qld.gov.au/`                                                    | Queensland-labelled service/clinical fallback |
| `sa-health`                           | `https://www.sahealth.sa.gov.au/`                                                   | SA-labelled service/clinical fallback         |
| `victoria-health`                     | `https://www.health.vic.gov.au/`                                                    | Victoria-labelled service/clinical fallback   |
| `tasmania-health`                     | `https://www.health.tas.gov.au/`                                                    | Tasmania-labelled service/clinical fallback   |
| `nt-health`                           | `https://health.nt.gov.au/`                                                         | NT-labelled service/clinical fallback         |
| `act-health`                          | `https://www.health.act.gov.au/`                                                    | ACT-labelled service/clinical fallback        |

All active indexed-content publisher roots in this table default to `licencePolicy: "review_required"`; eTG/AMH are `metadata_link_only`, and historical NPS is `index_forbidden`. The seven non-WA state/territory definitions are lower-priority active fallbacks. They are eligible only after uploaded-local and Australian national/WA coverage is insufficient, and every answer keeps the jurisdiction label. Add no generic domain wildcard and no auto-trust based on `.gov.au`.

`data/australian-source-verification.v1.json` is the reviewed, content-free source-verification input for offline/local and ordinary internet-disabled Cloud work. Each row records catalogue key, canonical URL, publisher identity, licence/content mode, checked-at date, reviewer role, and evidence reference; it contains no fetched clinical content. A connected read-only reviewer must verify current official URLs and licence modes before the manifest is accepted or refreshed. Offline Cloud may implement and test only from the committed reviewed manifest and must report source-current acceptance as unrun when that connected checkpoint has not occurred.

Replace the unrelated valid-registry fixture `registry_record_id: "amh"` in `tests/check-indexing-contract.test.ts` with a neutral synthetic service identifier. Add a negative contract proving eTG/AMH cannot become a `RegistryCorpusEntry`: `src/lib/registry-corpus.ts` always creates content/chunks/embeddings and is therefore forbidden for link-only references.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Review and checkpoint**

Compare every entry to the committed reviewed verification manifest. A changed URL or licence is a policy review, not a silent edit. Official-page verification is a separately authorized connected read-only checkpoint; never make an ordinary internet-disabled Cloud implementer browse or claim it. Format and conditionally commit:

```bash
npm run format
git add src/lib/australian-source-catalogue.ts src/lib/types.ts data/australian-source-verification.v1.json tests/australian-source-catalogue.test.ts tests/check-indexing-contract.test.ts tests/registry-corpus.test.ts
git commit -m "feat(sources): define governed Australian catalogue"
```

---

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

### Task 5: Present eTG and AMH as link-only references

**Files:**

- Create: `src/lib/source-reference-links.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/lib/answer-client-payload.ts`
- Create: `src/components/clinical-dashboard/answer-reference-links.tsx`
- Modify: `src/components/clinical-dashboard/answer-result-surface.tsx`
- Modify: `src/components/clinical-dashboard/answer-thread-turn.tsx`
- Create: `tests/source-reference-links.test.ts`
- Create: `tests/answer-reference-links.dom.test.tsx`
- Modify: `tests/answer-client-payload.test.ts`
- Modify: `tests/answer-incremental-delivery.test.ts`

**Interfaces:**

Consumes the interpreted `RagQueryClass` and `ClinicalQueryIntent`. Produces `referenceLinksForQuery(args: { queryClass: RagQueryClass; intent: ClinicalQueryIntent }): SourceReferenceLink[]` with at most two fixed values and the sanitized optional `RagAnswer.referenceLinks` client projection.

```ts
export type SourceReferenceLink = {
  catalogueKey: "etg-complete" | "australian-medicines-handbook";
  label: string;
  href: string;
  accessNote: string;
};

export function referenceLinksForQuery(args: {
  queryClass: RagQueryClass;
  intent: ClinicalQueryIntent;
}): SourceReferenceLink[];
```

`RagAnswer` gains `referenceLinks?: SourceReferenceLink[]`. `rag.ts` computes them deterministically from the interpreted task; `trimAnswerForClient` copies only the four fields above. Reference links never enter `sources`, `citations`, `answerSections`, evidence preview, verified semantic units, answer-copy source lists, embeddings, or telemetry.

Eligibility is narrow: offer eTG for treatment/dose/monitoring queries and AMH for medicine-specific dosing, contraindication, interaction, or monitoring queries; return at most the two fixed entries and none for unrelated questions. The suggestion is a destination only and never evidence that either reference was consulted.

- [ ] **Step 1: Add failing content-boundary tests**

Assert the returned object contains only catalogue key, label, allowlisted HTTPS URL, and access note. It must contain no excerpt, snippet, quote, summary, content, chunk ID, citation, embedding text, or inferred claim. `referenceLinksForQuery` never returns Healthdirect, including when contaminated input metadata mentions its domain.

- [ ] **Step 2: Run the test to establish red**

Run: `node scripts/run-vitest.mjs run tests/source-reference-links.test.ts`

Expected: FAIL because the helper is absent.

- [ ] **Step 3: Implement and render a distinct final-only reference affordance**

Label these links “Authenticated reference — access may require a subscription.” `AnswerReferenceLinks` renders only from an authoritative final `RagAnswer`; incremental previews never carry it. Do not place links in the citations count, evidence preview, source-review list, clipboard source projection, or saved factual evidence. Use safe external-link attributes and the existing external link primitive. Never imply the answer consulted the linked content.

- [ ] **Step 4: Verify DOM and accessibility**

Run: `node scripts/run-vitest.mjs run tests/source-reference-links.test.ts tests/answer-reference-links.dom.test.tsx tests/answer-client-payload.test.ts tests/answer-incremental-delivery.test.ts`

Expected: PASS; link name and access note are available to assistive technology, final-only links are visually distinct from cited evidence, and no reference link can become a citation/preview/unit.

- [ ] **Step 5: Review and checkpoint**

Format and conditionally commit:

```bash
npm run format
git add src/lib/source-reference-links.ts src/lib/types.ts src/lib/rag/rag.ts src/lib/answer-client-payload.ts src/components/clinical-dashboard/answer-reference-links.tsx src/components/clinical-dashboard/answer-result-surface.tsx src/components/clinical-dashboard/answer-thread-turn.tsx tests/source-reference-links.test.ts tests/answer-reference-links.dom.test.tsx tests/answer-client-payload.test.ts tests/answer-incremental-delivery.test.ts
git commit -m "feat(sources): add eTG and AMH reference links"
```

---

### Task 6: Governance documentation and domain handoff

**Files:**

- Modify: `docs/search-rag-master-plan.md`
- Modify: `docs/search-rag-master-context.md`
- Create: `docs/australian-source-governance.md`
- Modify: `.github/pull_request_template.md`

**Interfaces:** Consumes accepted Tasks 1–5 policy, database, and link-only behavior. Produces: no runtime interface. It finalizes the canonical operator/governance handoff.

- [ ] **Step 1: Document the operator contract**

Include the catalogue table, source-role matrix, local-primary/conflict rules, link-only prohibition, Healthdirect exclusion, NPS historical disposition, manifest v2 review evidence, activation/rollback owner, and review cadence.

- [ ] **Step 2: Run focused offline gates**

Run: `node scripts/run-vitest.mjs run tests/australian-source-catalogue.test.ts tests/source-role-policy.test.ts tests/australian-source-priority.test.ts tests/source-metadata.test.ts tests/source-authority-tooling.test.ts tests/publication-manifest.test.ts tests/supabase-schema.test.ts tests/source-reference-links.test.ts tests/answer-reference-links.dom.test.tsx tests/answer-client-payload.test.ts`

Expected: PASS.

Run: `npm run check:rag:fixtures`

Expected: PASS.

Run: `npm run check:production-readiness`

Expected: PASS or accurately classified environment/provider prerequisites.

Use `npm run verify:pr-local -- --dry-run` to inspect the selected handoff gate, then run that gate once when ready.

- [ ] **Step 3: Stop before live activation**

Do not fetch public sources, apply the migration, generate a remote schema, publish documents, mutate metadata, run provider evaluations, or deploy. Those operations belong to the ingestion/rollout plans and require their explicit approvals and recovery checks.

- [ ] **Step 4: Final review**

The SDD final reviewer must search the full diff for `healthdirect`, `NPS MedicineWise`, `etg`, `AMH`, `link_only`, `registry_record`, `clinical_kb_site`, and every source role. Any content-bearing eTG/AMH path, current NPS eligibility, or first-party site record misclassified as Australian authority blocks handoff.
