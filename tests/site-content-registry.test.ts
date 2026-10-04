import { describe, expect, expectTypeOf, it } from "vitest";

import { calculators } from "@/components/calculators/calculator-fixtures";
import { calculatorRecordHref } from "@/components/calculators/calculator-routes";
import { factsheets } from "@/components/factsheets/factsheets-data";
import { THERAPY_CATALOGUE_ASSETS } from "@/components/therapy-compass/data/generated-assets";
import { appModeIds } from "@/lib/app-modes";
import { dictionaryEntries } from "@/lib/dictionary-data";
import { dsmDiagnoses } from "@/lib/dsm";
import { formulationMechanisms } from "@/lib/formulation";
import { registryCorpusMetadata, type RegistryCorpusEntry } from "@/lib/registry-corpus";
import {
  canMutateSiteContent,
  evaluateSiteContentRegistration,
  evidenceFamilyKeys,
  reconcileCanonicalPublicSiteContent,
  resolveSiteContentReadTarget,
  siteContentClaimPolicy,
  siteContentModeCoverage,
  siteContentModeExclusions,
  siteContentProducerForMode,
  siteContentProducerRegistry,
} from "@/lib/site-content/site-content-registry";
import type {
  ActiveSiteContentRelease,
  RagContextSnapshot,
  SiteContentPartitionSnapshot,
  SiteContentRecord,
} from "@/lib/site-content/site-content-contracts";
import { publicSpecifierRecordBySlug, publicSpecifierRecords, specifierCatalogItems } from "@/lib/specifiers-content";
import { therapyRecords } from "@/lib/therapies";
import { publicKnowledgeToolCatalogRecords, toolCatalogRecords } from "@/lib/tools-catalog";
import siteContentChangeOwners from "@/lib/site-content/site-content-change-owners.json";

const activeRelease: ActiveSiteContentRelease = {
  version: "clinical-kb-site-release-v1",
  releaseId: "release-2026-08-23",
  registryVersion: "site-content-registry-v1",
  staticManifestDigest: "static-digest",
  dynamicStateDigest: "dynamic-digest",
  releaseDigest: "release-digest",
  state: "active",
  activatedAt: "2026-08-23T10:00:00.000Z",
};

describe("site content contracts", () => {
  it("consumes the evaluation-owned source and snapshot vocabularies", () => {
    const record: SiteContentRecord = {
      version: "site-content-record-v1",
      logicalId: "specifiers:with-anxious-distress",
      producerClass: "static_repository",
      domain: "specifiers",
      route: "/specifiers/with-anxious-distress",
      title: "With anxious distress",
      body: "Clinical KB catalogue summary.",
      sourceRole: "clinical_reference",
      access: "public",
      validationStatus: "locally_reviewed",
      sourceStatus: "current",
      publicationVersion: "specifier-catalogue-v1",
      sourceLineage: [],
      contentHash: "content-hash",
    };
    const partition: SiteContentPartitionSnapshot = {
      releaseId: activeRelease.releaseId,
      staticManifestDigest: activeRelease.staticManifestDigest,
      dynamicStateDigest: activeRelease.dynamicStateDigest,
      releaseDigest: activeRelease.releaseDigest,
      changeEpoch: "1",
      state: "current",
    };
    const snapshot: RagContextSnapshot = {
      version: "rag-context-snapshot-v1",
      resolvedAt: "2026-08-23T10:00:01.000Z",
      documentIndexGeneration: "generation-1",
      sourcePolicyVersion: "source-policy-v1",
      rolloutVersion: "rollout-v1",
      siteContentRegistryVersion: activeRelease.registryVersion,
      publicSiteContent: partition,
    };

    expect(record).toMatchObject({ domain: "specifiers", sourceRole: "clinical_reference", access: "public" });
    expect(snapshot.publicSiteContent).toEqual(partition);
    expectTypeOf(record.domain).toMatchTypeOf<
      | "services"
      | "forms"
      | "medications"
      | "differentials"
      | "specifiers"
      | "dsm"
      | "formulation"
      | "therapies"
      | "dictionary"
      | "factsheets"
      | "calculators"
      | "tools"
    >();
  });
});

describe("site content producer registry", () => {
  it("attaches the single declarative CI owner list to every producer", () => {
    expect(Object.keys(siteContentChangeOwners.producers).sort()).toEqual(
      siteContentProducerRegistry.map((producer) => producer.modeId).sort(),
    );
    for (const producer of siteContentProducerRegistry) {
      expect(producer.changeOwners).toEqual(siteContentChangeOwners.producers[producer.modeId]);
      expect(producer.changeOwners).toContain(producer.canonicalOwner);
    }
  });

  it("maps every public knowledge mode to its canonical site domain and role", () => {
    expect(
      Object.fromEntries(siteContentProducerRegistry.map((producer) => [producer.modeId, producer.domain])),
    ).toEqual({
      services: "services",
      forms: "forms",
      differentials: "differentials",
      dsm: "dsm",
      specifiers: "specifiers",
      formulation: "formulation",
      prescribing: "medications",
      tools: "tools",
      calculators: "calculators",
      "therapy-compass": "therapies",
      factsheets: "factsheets",
      dictionary: "dictionary",
    });

    expect(siteContentProducerForMode("specifiers")).toMatchObject({
      corpusScope: "clinical_kb_site",
      domain: "specifiers",
      producerClass: "static_repository",
      allowedRoles: ["clinical_reference"],
    });
    expect(siteContentProducerForMode("differentials")).toMatchObject({
      corpusScope: "clinical_kb_site",
      domain: "differentials",
      producerClass: "dynamic_registry",
      allowedRoles: ["clinical_reference"],
    });
    expect(siteContentProducerForMode("prescribing")).toMatchObject({
      corpusScope: "clinical_kb_site",
      domain: "medications",
      producerClass: "dynamic_registry",
      allowedRoles: ["clinical_reference"],
    });
    expect(siteContentProducerForMode("services")?.allowedRoles).toEqual(["service_directory"]);
    expect(siteContentProducerForMode("forms")?.allowedRoles).toEqual(["form_reference"]);
  });

  it("uses explicit producer contracts rather than paths or arbitrary globs", () => {
    for (const producer of siteContentProducerRegistry) {
      expect(producer).toMatchObject({
        version: "site-content-producer-v1",
        canonicalOwner: expect.stringMatching(/^(src|public|clinical_)/),
        dataSource: expect.any(String),
        publicationVersionStrategy: "adapter_computed_sha256",
        routeSemantics: expect.stringMatching(/^(exact_public_record|canonical_catalogue_href|search_navigation)$/),
        adapter: expect.any(String),
        allowedRoles: expect.any(Array),
        readPolicy: "public_active_release",
        reviewOwner: "clinical_content_governance",
        activationState: "active",
      });
      expect(producer.canonicalOwner).not.toMatch(/[*!?[\]{}]/);
      expect(producer.dataSource).not.toMatch(/[*!?[\]{}]/);
      expect(producer.adapter).not.toMatch(/[*!?[\]{}]/);
      if (producer.modeId !== "tools" && producer.modeId !== "calculators") {
        expect(producer.routeBuilder("record slug")).toMatch(/^\//);
      }
      expect(producer.allowedRoles).not.toHaveLength(0);
    }

    expect(siteContentProducerForMode("services")?.producerClass).toBe("dynamic_registry");
    expect(siteContentProducerForMode("specifiers")?.producerClass).toBe("static_repository");
    expect(siteContentProducerForMode("services")?.mutationPolicy).toBe("administrator_only");
    expect(siteContentProducerForMode("specifiers")?.mutationPolicy).toBe("repository_release_only");
  });

  it("binds all twelve producers to the unchanged public render owner, data source, and route", () => {
    const triples = Object.fromEntries(
      siteContentProducerRegistry.map((producer) => [
        producer.modeId,
        {
          owner: producer.canonicalOwner,
          dataSource: producer.dataSource,
          version: producer.publicationVersionStrategy,
          route: producer.routeSemantics,
        },
      ]),
    );

    expect(triples).toEqual({
      services: {
        owner: "src/lib/services.ts",
        dataSource: "serviceRecords",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      forms: {
        owner: "src/lib/forms.ts",
        dataSource: "formRecords",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      differentials: {
        owner: "src/lib/differentials.ts",
        dataSource: "differentialRecords+differentialPresentations()",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      dsm: {
        owner: "src/lib/dsm.ts",
        dataSource: "dsmDiagnoses",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      specifiers: {
        owner: "src/lib/specifiers-content.ts",
        dataSource: "publicSpecifierRecords()",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      formulation: {
        owner: "src/lib/formulation.ts",
        dataSource: "formulationMechanisms",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      prescribing: {
        owner: "src/lib/medication-snapshot.ts",
        dataSource: "loadMedicationSnapshot()",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      tools: {
        owner: "src/lib/tools-catalog.ts",
        dataSource: "publicKnowledgeToolCatalogRecords",
        version: "adapter_computed_sha256",
        route: "canonical_catalogue_href",
      },
      calculators: {
        owner: "src/components/calculators/calculator-fixtures.ts",
        dataSource: "calculators",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      "therapy-compass": {
        owner: `public/therapy-compass-data/${THERAPY_CATALOGUE_ASSETS.full}`,
        dataSource: "full therapy catalogue asset",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      factsheets: {
        owner: "src/components/factsheets/factsheets-data.ts",
        dataSource: "factsheets",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
      dictionary: {
        owner: "src/lib/dictionary-data.ts",
        dataSource: "dictionaryEntries",
        version: "adapter_computed_sha256",
        route: "exact_public_record",
      },
    });

    expect(siteContentProducerForMode("services")?.routeBuilder("crisis-service")).toBe("/services/crisis-service");
    expect(siteContentProducerForMode("forms")?.routeBuilder("transport-order")).toBe("/forms/transport-order");
    expect(siteContentProducerForMode("differentials")?.routeBuilder("acute-confusion", "presentation")).toBe(
      "/differentials/presentations/acute-confusion",
    );
    expect(siteContentProducerForMode("dsm")?.routeBuilder(dsmDiagnoses[0]!.slug)).toBe(
      `/dsm/diagnoses/${dsmDiagnoses[0]!.slug}`,
    );
    const curatedSpecifier = publicSpecifierRecordBySlug("with-anxious-distress");
    const catalogueOnlySpecifier = publicSpecifierRecords().find((record) => record.source === "catalogue")!;
    expect(curatedSpecifier).toMatchObject({ source: "curated", slug: "with-anxious-distress" });
    expect(catalogueOnlySpecifier).toBeDefined();
    expect(specifierCatalogItems().some((item) => item.slug === catalogueOnlySpecifier.slug)).toBe(true);
    expect(publicSpecifierRecordBySlug(catalogueOnlySpecifier.slug)).toMatchObject({ source: "catalogue" });
    // Relabelling a catalogue row must not move its public route: the slug derives from the
    // review rowKey, so the olfactory "absent insight" row keeps its original key and URL.
    expect(
      publicSpecifierRecordBySlug("specifier-icd-olfactory-reference-disorder-insight-with-absent-insight"),
    ).toMatchObject({ source: "catalogue" });
    expect(siteContentProducerForMode("specifiers")?.routeBuilder(curatedSpecifier!.slug)).toBe(
      "/specifiers/with-anxious-distress",
    );
    expect(siteContentProducerForMode("specifiers")?.routeBuilder(catalogueOnlySpecifier.slug)).toBe(
      `/specifiers/${catalogueOnlySpecifier.slug}`,
    );
    expect(siteContentProducerForMode("formulation")?.routeBuilder(formulationMechanisms[0]!.id)).toBe(
      `/formulation/${formulationMechanisms[0]!.id}`,
    );
    expect(siteContentProducerForMode("prescribing")?.routeBuilder("lithium")).toBe("/medications/lithium");
    expect(siteContentProducerForMode("tools")?.routeBuilder("clinical-dictionary")).toBe("/?mode=dictionary");
    expect(siteContentProducerForMode("calculators")?.routeBuilder(calculators[0]!.id)).toBe(
      calculatorRecordHref(calculators[0]!.id),
    );
    expect(siteContentProducerForMode("calculators")).toMatchObject({
      allowedRoles: ["tool_reference"],
      contentProjection: "descriptive_metadata_only",
    });
    expect(siteContentProducerForMode("therapy-compass")?.routeBuilder(therapyRecords[0]!.slug)).toBe(
      `/therapy-compass/${therapyRecords[0]!.slug}`,
    );
    expect(siteContentProducerForMode("factsheets")?.routeBuilder(factsheets[0]!.slug)).toBe(
      `/factsheets/${factsheets[0]!.slug}`,
    );
    expect(siteContentProducerForMode("dictionary")?.routeBuilder(dictionaryEntries[0]!.slug)).toBe(
      `/dictionary/${dictionaryEntries[0]!.slug}`,
    );
  });

  it("covers every current mode with a registered producer or permanent reviewed exclusion", () => {
    expect(siteContentModeCoverage(appModeIds)).toEqual({ complete: true, missing: [], pendingReview: [] });
    expect(siteContentModeExclusions).toEqual([
      expect.objectContaining({ modeId: "answer", reason: "corpus_consumer", permanent: true, reviewed: true }),
      expect.objectContaining({
        modeId: "documents",
        reason: "managed_uploaded_local",
        permanent: true,
        reviewed: true,
      }),
      expect.objectContaining({ modeId: "favourites", reason: "private_user_state", permanent: true, reviewed: true }),
      expect.objectContaining({ modeId: "sources", reason: "corpus_consumer", permanent: true, reviewed: true }),
      expect.objectContaining({ modeId: "on-call", reason: "private_user_state", permanent: true, reviewed: true }),
      expect.objectContaining({ modeId: "cme", reason: "private_user_state", permanent: true, reviewed: true }),
      expect.objectContaining({ modeId: "psychiatry", reason: "operational_chrome", permanent: true, reviewed: true }),
      expect.objectContaining({ modeId: "my-work", reason: "private_user_state", permanent: true, reviewed: true }),
      expect.objectContaining({ modeId: "roster", reason: "private_user_state", permanent: true, reviewed: true }),
      expect.objectContaining({
        modeId: "first-nations",
        reason: "operational_chrome",
        permanent: true,
        reviewed: true,
      }),
      expect.objectContaining({ modeId: "teaching", reason: "private_user_state", permanent: true, reviewed: true }),
      expect.objectContaining({ modeId: "my-day", reason: "private_user_state", permanent: true, reviewed: true }),
      expect.objectContaining({ modeId: "medicines", reason: "operational_chrome", permanent: true, reviewed: true }),
    ]);
    expect(siteContentModeCoverage([...appModeIds, "future-mode"])).toEqual({
      complete: false,
      missing: ["future-mode"],
      pendingReview: [],
    });
    expect(
      siteContentModeCoverage([...appModeIds, "future-mode"], [{ modeId: "future-mode", status: "pending_review" }]),
    ).toEqual({
      complete: false,
      missing: [],
      pendingReview: ["future-mode"],
    });
    expect(
      siteContentModeCoverage(
        [...appModeIds, "future-operational-mode"],
        [
          {
            modeId: "future-operational-mode",
            status: "permanently_excluded",
            reason: "operational_chrome",
            reviewed: true,
          },
        ],
      ),
    ).toEqual({ complete: true, missing: [], pendingReview: [] });
  });

  it("resolves the same public release for anonymous and authenticated readers", () => {
    expect(resolveSiteContentReadTarget("anonymous", activeRelease)).toEqual(
      resolveSiteContentReadTarget("authenticated", activeRelease),
    );
    expect(resolveSiteContentReadTarget("anonymous", activeRelease)).toEqual({
      audience: "public",
      corpusScope: "clinical_kb_site",
      readPolicy: "public_active_release",
      releaseId: activeRelease.releaseId,
      releaseDigest: activeRelease.releaseDigest,
    });
  });

  it("allows only administrator-authorized dynamic mutations and publication", () => {
    const services = siteContentProducerForMode("services")!;
    const specifiers = siteContentProducerForMode("specifiers")!;

    for (const operation of ["create", "edit", "publish", "retire"] as const) {
      expect(canMutateSiteContent(services, operation, { isAdministrator: false })).toBe(false);
      expect(canMutateSiteContent(services, operation, { isAdministrator: true })).toBe(true);
      expect(canMutateSiteContent(specifiers, operation, { isAdministrator: true })).toBe(false);
    }
  });

  it("keeps legacy owner and publication actors out of retrieval metadata", () => {
    const entry: RegistryCorpusEntry = {
      kind: "service",
      subkind: "service",
      ownerId: "audit-owner-id",
      recordId: "service-record-id",
      slug: "crisis-service",
      title: "Crisis service",
      subtitle: null,
      content: "Public service summary",
      searchText: "crisis service",
      sourceStatus: "current",
      validationStatus: "approved",
      metadata: {
        corpus_scope: "clinical_kb_site",
        owner_id: "audit-owner-id",
        actor_id: "audit-actor-id",
        created_by: "audit-creator-id",
        updated_by: "audit-updater-id",
        published_by: "audit-publisher-id",
        reviewed_by: "audit-reviewer-id",
        editorId: "audit-editor-id",
        creator_id: "audit-creator-noun-id",
        updater_id: "audit-updater-noun-id",
        publisher_id: "audit-publisher-noun-id",
        reviewer_id: "audit-reviewer-noun-id",
        retiree_id: "audit-retiree-noun-id",
        catalogue_label: "Service",
      },
    };

    expect(registryCorpusMetadata(entry)).toMatchObject({ catalogue_label: "Service" });
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("corpus_scope");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("owner_id");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("actor_id");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("created_by");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("updated_by");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("published_by");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("reviewed_by");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("editorId");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("creator_id");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("updater_id");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("publisher_id");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("reviewer_id");
    expect(registryCorpusMetadata(entry)).not.toHaveProperty("retiree_id");
  });
});

describe("site content eligibility and authority", () => {
  const eligibleCandidate = {
    modeId: "specifiers",
    access: "public",
    publicationState: "published",
    renderedByPublicSite: true,
    contentClass: "public_knowledge",
    authoritySource: "clinical_kb",
  } as const;

  it("rejects private, synthetic, repository-internal, unpublished, and forbidden authority sources", () => {
    expect(evaluateSiteContentRegistration(eligibleCandidate)).toMatchObject({ eligible: true });

    for (const contentClass of [
      "application_code",
      "test_fixture",
      "prompt",
      "developer_documentation",
      "mockup",
      "synthetic_ward_data",
      "private_user_state",
    ] as const) {
      expect(evaluateSiteContentRegistration({ ...eligibleCandidate, contentClass })).toEqual({
        eligible: false,
        reason: "forbidden_content_class",
      });
    }
    expect(evaluateSiteContentRegistration({ ...eligibleCandidate, access: "private" })).toEqual({
      eligible: false,
      reason: "not_public",
    });
    for (const publicationState of ["draft", "preview"] as const) {
      expect(evaluateSiteContentRegistration({ ...eligibleCandidate, publicationState })).toEqual({
        eligible: false,
        reason: "not_published",
      });
    }
    expect(evaluateSiteContentRegistration({ ...eligibleCandidate, renderedByPublicSite: false })).toEqual({
      eligible: false,
      reason: "not_publicly_rendered_version",
    });
    for (const authoritySource of ["etg_link", "amh_link", "healthdirect"] as const) {
      expect(evaluateSiteContentRegistration({ ...eligibleCandidate, authoritySource })).toEqual({
        eligible: false,
        reason: "forbidden_authority_source",
      });
    }
    for (const modeId of ["documents", "favourites", "answer"] as const) {
      expect(evaluateSiteContentRegistration({ ...eligibleCandidate, modeId })).toEqual({
        eligible: false,
        reason: "mode_excluded",
      });
    }
  });

  it("registers only the explicit public-knowledge subset of the real Tools catalogue", () => {
    const eligibleIds = publicKnowledgeToolCatalogRecords.map((record) => record.id);
    const forbiddenIds = [
      "clinical-kb-search",
      "documents",
      "guidelines",
      "risk-safety",
      "care-plans",
      "monitoring",
      "ward-management",
      "favourites",
    ] as const;

    expect(toolCatalogRecords.map((record) => record.id)).toEqual(
      expect.arrayContaining(forbiddenIds.filter((id) => id !== "ward-management")),
    );
    // Removed launcher IDs must remain inadmissible if encountered in historical records.
    expect(toolCatalogRecords.some((record) => String(record.id) === "ward-management")).toBe(false);
    expect(eligibleIds).not.toEqual(expect.arrayContaining([...forbiddenIds]));
    for (const producerRecordId of forbiddenIds) {
      expect(evaluateSiteContentRegistration({ ...eligibleCandidate, modeId: "tools", producerRecordId })).toEqual({
        eligible: false,
        reason: "producer_record_excluded",
      });
    }

    for (const record of publicKnowledgeToolCatalogRecords) {
      expect(
        evaluateSiteContentRegistration({
          ...eligibleCandidate,
          modeId: "tools",
          producerRecordId: record.id,
        }),
      ).toMatchObject({ eligible: true });
      expect(siteContentProducerForMode("tools")?.routeBuilder(record.id)).toBe(record.href);
    }
  });

  it("keeps product evidence separate from clinical authority and uploaded guidance primary", () => {
    expect(
      siteContentClaimPolicy({
        claimKind: "product_catalogue",
        siteSourceRole: "clinical_reference",
        directlyRelevantUploadedGuideline: false,
      }),
    ).toEqual({
      primaryCorpus: "clinical_kb_site",
      siteUse: "primary_product_evidence",
      requiresEligibleClinicalEvidence: false,
    });

    expect(
      siteContentClaimPolicy({
        claimKind: "patient_diagnosis",
        siteSourceRole: "clinical_reference",
        directlyRelevantUploadedGuideline: false,
      }),
    ).toEqual({
      primaryCorpus: null,
      siteUse: "ineligible_for_clinical_claim",
      requiresEligibleClinicalEvidence: true,
    });

    expect(
      siteContentClaimPolicy({
        claimKind: "clinical_guidance",
        siteSourceRole: "clinical_reference",
        directlyRelevantUploadedGuideline: true,
      }),
    ).toEqual({
      primaryCorpus: "uploaded_local",
      siteUse: "attributed_navigation_context",
      requiresEligibleClinicalEvidence: false,
    });
  });

  it("represents evidence-family membership by canonical hashes rather than source ids or combined parents", () => {
    const uploaded = evidenceFamilyKeys({
      sourceId: "uploaded:lithium-guideline",
      sourceHash: "guideline-hash",
      sourceLineage: [],
    });
    const exactDuplicate = evidenceFamilyKeys({
      sourceId: "uploaded:renamed-lithium-guideline",
      sourceHash: "guideline-hash",
      sourceLineage: [],
    });
    const siteSummary = evidenceFamilyKeys({
      sourceId: "site:medications:lithium",
      sourceHash: "summary-hash",
      sourceLineage: [
        { sourceId: "uploaded:lithium-guideline", sourceHash: "guideline-hash", relationship: "derived_from" },
        { sourceId: "uploaded:monitoring-table", sourceHash: "monitoring-hash", relationship: "derived_from" },
      ],
    });
    const secondDerivative = evidenceFamilyKeys({
      sourceId: "site:factsheets:lithium-monitoring",
      sourceHash: "other-summary-hash",
      sourceLineage: [
        { sourceId: "another-id-for-the-same-guideline", sourceHash: "guideline-hash", relationship: "derived_from" },
      ],
    });

    expect(exactDuplicate).toEqual(uploaded);
    expect(siteSummary).toEqual(["source-family:guideline-hash", "source-family:monitoring-hash"]);
    expect(secondDerivative).toEqual(["source-family:guideline-hash"]);
    expect(siteSummary.filter((family) => secondDerivative.includes(family))).toEqual(uploaded);
  });

  it("selects only one explicitly reconciled public publication for duplicate legacy rows", () => {
    const candidates = [
      {
        recordId: "editor-row-a",
        logicalId: "medications:lithium",
        rowOwnerId: "editor-a",
        publicationState: "published",
        renderedByPublicSite: true,
        explicitlyReconciled: false,
      },
      {
        recordId: "canonical-publication",
        logicalId: "medications:lithium",
        rowOwnerId: null,
        publicationState: "published",
        renderedByPublicSite: true,
        explicitlyReconciled: true,
      },
      {
        recordId: "editor-row-draft",
        logicalId: "medications:lithium",
        rowOwnerId: "editor-draft",
        publicationState: "draft",
        renderedByPublicSite: false,
        explicitlyReconciled: false,
      },
    ] as const;

    expect(reconcileCanonicalPublicSiteContent(candidates)).toMatchObject({ recordId: "canonical-publication" });
    expect(
      reconcileCanonicalPublicSiteContent([{ ...candidates[1], rowOwnerId: "still-owner-partitioned" }]),
    ).toBeNull();
    expect(
      reconcileCanonicalPublicSiteContent([
        ...candidates,
        { ...candidates[1], recordId: "second-reconciled-publication" },
      ]),
    ).toBeNull();
  });
});
