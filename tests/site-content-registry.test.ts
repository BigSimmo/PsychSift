import { describe, expect, it } from "vitest";

import { appModeIds } from "@/lib/app-modes";
import {
  assertCompleteSiteContentModeCoverage,
  assertSiteContentPartitionSnapshot,
  assertSiteContentProducerDefinition,
  evaluateSiteContentClaimPolicy,
  selectCanonicalPublicSiteContentPublication,
  siteContentEvidenceFamilyKey,
  siteContentModeAdoptionRegistry,
  siteContentProducerDefinitions,
  siteContentProducerForDomain,
  siteContentRetrievalMetadata,
  type SiteContentPublicationCandidate,
  type SiteContentProducerDefinition,
} from "@/lib/site-content/site-content-registry";
import type {
  ActiveSiteContentRelease,
  RagContextSnapshot,
  SiteContentPartitionSnapshot,
  SiteContentRecord,
} from "@/lib/site-content/site-content-contracts";
import type { SiteContentDomain } from "@/lib/types";

function record(overrides: Partial<SiteContentRecord> = {}): SiteContentRecord {
  return {
    version: "site-content-record-v1",
    logicalId: "differential:mania",
    producerClass: "dynamic_registry",
    domain: "differentials",
    route: "/differentials/mania",
    title: "Mania",
    body: "Canonical public product catalogue content.",
    sourceRole: "clinical_reference",
    access: "public",
    validationStatus: "approved",
    sourceStatus: "current",
    publicationVersion: "differential-publication-v1",
    sourceLineage: [],
    contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...overrides,
  };
}

function publication(overrides: Partial<SiteContentPublicationCandidate> = {}): SiteContentPublicationCandidate {
  return {
    record: record(),
    publicationState: "published",
    renderedByPublicSite: true,
    audit: { ownerId: "editor-1", actorId: "administrator-1" },
    ...overrides,
  };
}

function partitionSnapshot(overrides: Partial<SiteContentPartitionSnapshot> = {}): SiteContentPartitionSnapshot {
  return {
    registryVersion: "site-content-registry-v1",
    releaseId: "release-7",
    expectedStaticManifestDigest: "sha256:static",
    activeStaticManifestDigest: "sha256:static",
    staticManifestDigest: "sha256:static",
    staticManifestMatch: true,
    dynamicStateDigest: "sha256:dynamic",
    releaseDigest: "sha256:release",
    changeEpoch: "epoch-12",
    pendingLogicalIds: [],
    pendingLogicalIdsDigest: "fnv1a64:09612b07b5ecb5a5",
    state: "current",
    ...overrides,
  };
}

describe("site content producer and adoption registry", () => {
  it("maps the required domains to the canonical public site scope and claim roles", () => {
    expect(siteContentProducerForDomain("specifiers")).toMatchObject({
      producerClass: "static_repository",
      corpusScope: "clinical_kb_site",
      allowedRoles: ["clinical_reference"],
      readPolicy: "public",
      activationState: "reviewed_ineligible",
      ineligibilityReason: "missing_canonical_lineage_and_review",
    });
    expect(siteContentProducerForDomain("differentials")).toMatchObject({
      producerClass: "dynamic_registry",
      corpusScope: "clinical_kb_site",
      allowedRoles: ["clinical_reference"],
      readPolicy: "public",
    });
    expect(siteContentProducerForDomain("medications")).toMatchObject({
      producerClass: "dynamic_registry",
      corpusScope: "clinical_kb_site",
      allowedRoles: ["clinical_reference"],
      readPolicy: "public",
    });
    expect(siteContentProducerForDomain("services")?.allowedRoles).toEqual(["service_directory"]);
    expect(siteContentProducerForDomain("forms")?.allowedRoles).toEqual(["form_reference"]);
  });

  it("keeps static and database-edited producers explicit and non-interchangeable", () => {
    const staticProducer = siteContentProducerForDomain("specifiers");
    const dynamicProducer = siteContentProducerForDomain("medications");

    expect(staticProducer).toMatchObject({
      producerClass: "static_repository",
      mutationPolicy: "repository_release_only",
      currentAuditProjection: null,
    });
    expect(dynamicProducer).toMatchObject({
      producerClass: "dynamic_registry",
      mutationPolicy: "administrator_server_only",
      currentAuditProjection: {
        source_kind: "registry_record",
        registry_record_kind: "medication",
        corpus_scope: "clinical_kb_site",
        source_role: "clinical_reference",
        site_content_domain: "medications",
      },
    });
  });

  it("covers every app mode with a registered producer or reviewed exclusion", () => {
    expect(() => assertCompleteSiteContentModeCoverage(appModeIds, siteContentModeAdoptionRegistry)).not.toThrow();
    expect(siteContentModeAdoptionRegistry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "prescribing", disposition: "registered", domain: "medications" }),
        expect.objectContaining({ mode: "therapy-compass", disposition: "registered", domain: "therapies" }),
        expect.objectContaining({
          mode: "factsheets",
          disposition: "reviewed_ineligible",
          reason: "excluded_source_and_not_clinician_approved",
        }),
        expect.objectContaining({
          mode: "dictionary",
          disposition: "reviewed_ineligible",
          reason: "excluded_source_present",
        }),
        expect.objectContaining({
          mode: "calculators",
          disposition: "reviewed_ineligible",
          reason: "missing_source_governance",
        }),
        expect.objectContaining({
          mode: "documents",
          disposition: "reviewed_exclusion",
          reason: "trusted_ingestion_owned",
        }),
        expect.objectContaining({ mode: "favourites", disposition: "reviewed_exclusion", reason: "private_state" }),
        expect.objectContaining({ mode: "answer", disposition: "reviewed_exclusion", reason: "corpus_consumer" }),
      ]),
    );
    expect(siteContentModeAdoptionRegistry.some((entry) => entry.disposition === "pending_review")).toBe(false);

    expect(() =>
      assertCompleteSiteContentModeCoverage([...appModeIds, "future-knowledge-mode"], siteContentModeAdoptionRegistry),
    ).toThrow(/future-knowledge-mode.*registered.*reviewed exclusion/i);
  });

  it("adopts Tools only through an explicit reviewed record allowlist", () => {
    expect(siteContentProducerForDomain("tools")?.recordAdoptions).toEqual(
      expect.arrayContaining([
        { recordId: "differentials", disposition: "eligible", canonicalRoute: "/differentials" },
        { recordId: "services", disposition: "eligible", canonicalRoute: "/services" },
        { recordId: "forms", disposition: "eligible", canonicalRoute: "/forms" },
        { recordId: "documents", disposition: "reviewed_exclusion", reason: "trusted_ingestion_owned" },
        { recordId: "favourites", disposition: "reviewed_exclusion", reason: "private_state" },
        { recordId: "ward-management", disposition: "reviewed_exclusion", reason: "synthetic_or_private_state" },
      ]),
    );
    expect(siteContentProducerForDomain("tools")?.recordAdoptions).toHaveLength(15);
  });

  it("rejects arbitrary repository, private, synthetic, and forbidden source registrations", () => {
    const base = siteContentProducerForDomain("specifiers")!;
    const forbiddenSources = [
      "src/app/api/answer/route.ts",
      "tests/rag-provider.test.ts",
      "docs/clinical-prompt.md",
      "public/mockups/specifier.html",
      "src/data/ward-management-synthetic.json",
      "src/lib/favourites.ts",
      "private/user-state.json",
      "https://www.healthdirect.gov.au/mental-health",
      "eTG complete",
      "Australian Medicines Handbook (AMH)",
    ];

    for (const canonicalSource of forbiddenSources) {
      expect(() =>
        assertSiteContentProducerDefinition({
          ...base,
          key: `hostile-${forbiddenSources.indexOf(canonicalSource)}`,
          canonicalSource,
        } as SiteContentProducerDefinition),
      ).toThrow(/not an approved site-content producer source/i);
    }
  });
});

describe("site content public publication and authority policy", () => {
  it("declares one reader-independent public release policy without claiming route adoption", () => {
    const release: ActiveSiteContentRelease = {
      version: "clinical-kb-site-release-v1",
      releaseId: "release-2026-08-23",
      registryVersion: "site-content-registry-v1",
      staticManifestDigest: "sha256:static",
      dynamicStateDigest: "sha256:dynamic",
      releaseDigest: "sha256:release",
      state: "active",
      activatedAt: "2026-08-23T00:00:00.000Z",
    };

    expect(release.state).toBe("active");
    expect(siteContentProducerDefinitions.every((producer) => producer.readPolicy === "public")).toBe(true);
    expect(
      siteContentProducerDefinitions.every(
        (producer) =>
          producer.readerPopulation === "anonymous_authenticated_administrator" &&
          producer.readPartitionKey === "active_public_release",
      ),
    ).toBe(true);
  });

  it("declares only administrator-authorized server mutations for dynamic producers", () => {
    const dynamicProducer = siteContentProducerForDomain("medications")!;
    expect(dynamicProducer).toMatchObject({
      mutationPolicy: "administrator_server_only",
      mutationActor: "administrator",
      mutationBoundary: "server",
    });
    expect(siteContentProducerForDomain("specifiers")).toMatchObject({
      mutationPolicy: "repository_release_only",
      mutationActor: null,
      mutationBoundary: "repository_release",
    });
  });

  it("selects exactly one canonical published version rendered by the public site", () => {
    const canonical = publication();
    expect(
      selectCanonicalPublicSiteContentPublication([
        publication({ publicationState: "draft", renderedByPublicSite: false }),
        publication({ publicationState: "preview", renderedByPublicSite: false }),
        canonical,
      ]),
    ).toEqual(canonical.record);

    expect(() =>
      selectCanonicalPublicSiteContentPublication([
        canonical,
        publication({ record: record({ publicationVersion: "duplicate-editor-copy" }) }),
      ]),
    ).toThrow(/exactly one canonical public publication/i);
    expect(() =>
      selectCanonicalPublicSiteContentPublication([
        publication({ publicationState: "draft", renderedByPublicSite: false }),
      ]),
    ).toThrow(/exactly one canonical public publication/i);
  });

  it("keeps actor identifiers out of retrieval metadata", () => {
    const candidate = publication();
    const metadata = siteContentRetrievalMetadata(candidate.record);

    expect(metadata).toMatchObject({
      corpus_scope: "clinical_kb_site",
      source_role: "clinical_reference",
      site_content_domain: "differentials",
      logical_id: "differential:mania",
    });
    expect(JSON.stringify(metadata)).not.toMatch(/owner|actor|administrator-1|editor-1/i);
  });

  it("emits retrieval metadata only for explicitly reviewed current records", () => {
    for (const validationStatus of ["locally_reviewed", "approved"] as const) {
      expect(siteContentRetrievalMetadata(record({ validationStatus, sourceStatus: "current" }))).toMatchObject({
        logical_id: "differential:mania",
      });
    }

    for (const invalid of [
      record({ validationStatus: "unverified", sourceStatus: "current" }),
      record({ validationStatus: "approved", sourceStatus: "review_due" }),
      record({ validationStatus: "approved", sourceStatus: "outdated" }),
      record({ validationStatus: "approved", sourceStatus: "unknown" }),
    ]) {
      expect(() => siteContentRetrievalMetadata(invalid)).toThrow(/reviewed and current/i);
      expect(() => selectCanonicalPublicSiteContentPublication([publication({ record: invalid })])).toThrow(
        /reviewed and current/i,
      );
    }
  });

  it("keeps derivative summaries in their source evidence family", () => {
    const derivative = record({
      sourceLineage: [
        {
          sourceId: "uploaded-guideline:lithium-monitoring",
          sourceHash: "sha256:guideline",
          relationship: "derived_from",
        },
      ],
    });
    const duplicateDerivative = record({
      logicalId: "specifier:duplicate",
      sourceLineage: [
        ...derivative.sourceLineage,
        {
          sourceId: " Uploaded-Guideline:Lithium-Monitoring ",
          sourceHash: " SHA256:GUIDELINE ",
          relationship: "derived_from",
        },
        { sourceId: "navigation-reference", sourceHash: "sha256:reference", relationship: "references" },
      ],
    });

    expect(siteContentEvidenceFamilyKey(derivative)).toEqual([
      "source:uploaded-guideline:lithium-monitoring:sha256:guideline",
    ]);
    expect(siteContentEvidenceFamilyKey(duplicateDerivative)).toEqual(siteContentEvidenceFamilyKey(derivative));
    expect(siteContentEvidenceFamilyKey(record())).toEqual([
      "site:differential:mania:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  it("represents partially overlapping derived sources as intersecting family memberships", () => {
    const sourceA = {
      sourceId: "uploaded-guideline:lithium-monitoring",
      sourceHash: "sha256:guideline-a",
      relationship: "derived_from" as const,
    };
    const familyA = siteContentEvidenceFamilyKey(record({ sourceLineage: [sourceA] }));
    const familyAB = siteContentEvidenceFamilyKey(
      record({
        logicalId: "differential:mania-with-secondary-source",
        sourceLineage: [
          sourceA,
          { sourceId: "australian-public:source-b", sourceHash: "sha256:source-b", relationship: "derived_from" },
          { sourceId: "navigation-only", sourceHash: "sha256:reference", relationship: "references" },
        ],
      }),
    );

    expect(familyA).toEqual(["source:uploaded-guideline:lithium-monitoring:sha256:guideline-a"]);
    expect(familyAB).toEqual([
      "source:australian-public:source-b:sha256:source-b",
      "source:uploaded-guideline:lithium-monitoring:sha256:guideline-a",
    ]);
    expect(familyA.filter((membership) => familyAB.includes(membership))).toEqual(familyA);
  });

  it("pins the complete request-local corpus and site partition identity", () => {
    const snapshot: RagContextSnapshot = {
      version: "rag-context-snapshot-v1",
      resolvedAt: "2026-08-23T00:00:01.000Z",
      documentIndexGeneration: "documents-generation-7",
      sourcePolicyVersion: "source-policy-v2",
      rolloutVersion: "legacy",
      uploadedLocal: {
        indexGeneration: "documents-generation-7",
        activationDigest: "sha256:uploaded",
      },
      australianPublic: {
        indexGeneration: "australian-generation-3",
        releaseDigest: "sha256:australian",
      },
      publicSiteContent: partitionSnapshot(),
    };

    expect(snapshot.publicSiteContent.expectedStaticManifestDigest).toBe(
      snapshot.publicSiteContent.activeStaticManifestDigest,
    );
    expect(snapshot.publicSiteContent.staticManifestMatch).toBe(true);
    expect(snapshot.publicSiteContent.pendingLogicalIds).toEqual([]);
    expect(snapshot.uploadedLocal.indexGeneration).toBe(snapshot.documentIndexGeneration);
    expect(() => assertSiteContentPartitionSnapshot(snapshot.publicSiteContent)).not.toThrow();
    expect(() =>
      assertSiteContentPartitionSnapshot({
        ...snapshot.publicSiteContent,
        activeStaticManifestDigest: "sha256:other-static",
        staticManifestMatch: false,
        state: "current",
      }),
    ).toThrow(/mismatch.*cannot be current/i);
  });

  it("requires updating snapshots to carry exact canonical pending and active release identity", () => {
    const updating = partitionSnapshot({
      pendingLogicalIds: ["differential:mania"],
      pendingLogicalIdsDigest: "fnv1a64:8ec9aa9527eeabc4",
      state: "updating",
    });

    expect(() => assertSiteContentPartitionSnapshot(updating)).not.toThrow();

    for (const invalid of [
      { ...updating, pendingLogicalIds: [], pendingLogicalIdsDigest: "fnv1a64:09612b07b5ecb5a5" },
      { ...updating, pendingLogicalIdsDigest: null },
      { ...updating, pendingLogicalIdsDigest: "fnv1a64:0000000000000000" },
      { ...updating, pendingLogicalIds: ["differential:mania", "differential:mania"] },
      { ...updating, pendingLogicalIds: ["medication:lithium", "differential:mania"] },
      { ...updating, releaseId: null },
      { ...updating, dynamicStateDigest: null },
      { ...updating, changeEpoch: null },
      { ...updating, staticManifestMatch: false },
    ] satisfies SiteContentPartitionSnapshot[]) {
      expect(() => assertSiteContentPartitionSnapshot(invalid)).toThrow(/updating/i);
    }
  });

  it("keeps unavailable snapshots identity-free and rejects contradictory stale identities", () => {
    expect(() =>
      assertSiteContentPartitionSnapshot(
        partitionSnapshot({
          registryVersion: null,
          releaseId: null,
          expectedStaticManifestDigest: null,
          activeStaticManifestDigest: null,
          staticManifestDigest: null,
          staticManifestMatch: false,
          dynamicStateDigest: null,
          releaseDigest: null,
          changeEpoch: null,
          pendingLogicalIds: [],
          pendingLogicalIdsDigest: null,
          state: "unavailable",
        }),
      ),
    ).not.toThrow();
    expect(() => assertSiteContentPartitionSnapshot(partitionSnapshot({ state: "unavailable" }))).toThrow(
      /unavailable/i,
    );
    expect(() => assertSiteContentPartitionSnapshot(partitionSnapshot({ state: "stale" }))).toThrow(/stale/i);
    expect(() =>
      assertSiteContentPartitionSnapshot(
        partitionSnapshot({
          activeStaticManifestDigest: "sha256:old-static",
          staticManifestDigest: "sha256:old-static",
          staticManifestMatch: false,
          state: "stale",
        }),
      ),
    ).not.toThrow();
  });

  it("separates product facts from patient decisions and preserves uploaded-guideline priority", () => {
    expect(evaluateSiteContentClaimPolicy({ purpose: "product_catalogue", sourceRole: "clinical_reference" })).toEqual({
      siteUse: "primary",
      primaryCorpusScope: "clinical_kb_site",
      requiresEligibleClinicalEvidence: false,
      insufficiencyReason: null,
    });
    expect(
      evaluateSiteContentClaimPolicy({ purpose: "patient_specific_diagnosis", sourceRole: "clinical_reference" }),
    ).toEqual({
      siteUse: "navigation_only",
      primaryCorpusScope: null,
      requiresEligibleClinicalEvidence: true,
      insufficiencyReason: "insufficient_claim_support",
    });
    expect(
      evaluateSiteContentClaimPolicy({
        purpose: "clinical_guidance",
        sourceRole: "clinical_reference",
        eligibleUploadedGuideline: true,
      }),
    ).toEqual({
      siteUse: "supporting",
      primaryCorpusScope: "uploaded_local",
      requiresEligibleClinicalEvidence: false,
      insufficiencyReason: null,
    });
    expect(evaluateSiteContentClaimPolicy({ purpose: "clinical_guidance", sourceRole: "clinical_reference" })).toEqual({
      siteUse: "navigation_only",
      primaryCorpusScope: null,
      requiresEligibleClinicalEvidence: true,
      insufficiencyReason: "insufficient_claim_support",
    });
  });

  it("has one producer for every canonical site domain", () => {
    const domains = siteContentProducerDefinitions.map((producer) => producer.domain);
    const expected: SiteContentDomain[] = [
      "services",
      "forms",
      "medications",
      "differentials",
      "specifiers",
      "dsm",
      "formulation",
      "therapies",
      "dictionary",
      "factsheets",
      "calculators",
      "tools",
    ];
    expect(domains).toEqual(expected);
    expect(new Set(domains).size).toBe(expected.length);
  });
});
