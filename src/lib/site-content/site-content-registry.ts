import { appModeIds, type AppModeId } from "@/lib/app-modes";
import type { SiteContentPartitionSnapshot, SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import type { ClinicalSourceRole, RagInsufficiencyReason, SiteContentDomain, SourceCorpusScope } from "@/lib/types";

export const siteContentRegistryVersion = "site-content-registry-v1" as const;

type RegistryCorpusKind = "service" | "form" | "medication" | "differential";

export type SiteContentRecordAdoption =
  | { recordId: string; disposition: "eligible" }
  | {
      recordId: string;
      disposition: "reviewed_exclusion";
      reason:
        | "corpus_consumer"
        | "trusted_ingestion_owned"
        | "private_state"
        | "synthetic_or_private_state"
        | "excluded_source_present"
        | "missing_source_governance"
        | "not_source_backed"
        | "review_due"
        | "non_knowledge_tool";
    };

export type CurrentRegistryAuditProjection = {
  source_kind: "registry_record";
  registry_record_kind: RegistryCorpusKind;
  corpus_scope: Extract<SourceCorpusScope, "clinical_kb_site">;
  source_role: ClinicalSourceRole;
  site_content_domain: SiteContentDomain;
};

type SiteContentProducerBase = {
  version: "site-content-producer-v1";
  key: string;
  domain: SiteContentDomain;
  corpusScope: Extract<SourceCorpusScope, "clinical_kb_site">;
  canonicalSource: string;
  producerModule: string;
  publicationVersionField: string;
  adapter: string;
  allowedRoles: readonly ClinicalSourceRole[];
  readPolicy: "public";
  readerPopulation: "anonymous_authenticated_administrator";
  readPartitionKey: "active_public_release";
  routeBuilder: (slug: string) => string;
  reviewOwner: "clinical-content-governance";
  activationState: "eligible" | "reviewed_ineligible" | "pending_review";
  ineligibilityReason: string | null;
  recordAdoptions: readonly SiteContentRecordAdoption[] | null;
};

export type StaticSiteContentProducerDefinition = SiteContentProducerBase & {
  producerClass: "static_repository";
  mutationPolicy: "repository_release_only";
  mutationActor: null;
  mutationBoundary: "repository_release";
  currentAuditProjection: null;
};

export type DynamicSiteContentProducerDefinition = SiteContentProducerBase & {
  producerClass: "dynamic_registry";
  mutationPolicy: "administrator_server_only";
  mutationActor: "administrator";
  mutationBoundary: "server";
  currentAuditProjection: CurrentRegistryAuditProjection;
};

export type SiteContentProducerDefinition = StaticSiteContentProducerDefinition | DynamicSiteContentProducerDefinition;

export type SiteContentModeExclusionReason =
  | "corpus_consumer"
  | "trusted_ingestion_owned"
  | "private_state"
  | "excluded_source_and_not_clinician_approved"
  | "excluded_source_present"
  | "missing_source_governance"
  | "missing_canonical_lineage_and_review";

export type SiteContentModeAdoption =
  | {
      mode: AppModeId;
      disposition: "registered";
      domain: SiteContentDomain;
      producerKey: string;
    }
  | {
      mode: AppModeId;
      disposition: "reviewed_exclusion";
      reason: SiteContentModeExclusionReason;
      reviewOwner: "clinical-content-governance";
    }
  | {
      mode: AppModeId;
      disposition: "reviewed_ineligible";
      domain: SiteContentDomain;
      producerKey: string;
      reason: SiteContentModeExclusionReason;
      reviewOwner: "clinical-content-governance";
    }
  | {
      mode: AppModeId;
      disposition: "pending_review";
      reason: string;
    };

const approvedCanonicalSources = new Set([
  "database:clinical_registry_records:service",
  "database:clinical_registry_records:form",
  "database:medication_records",
  "database:differential_records",
  "src/lib/specifiers-content.ts",
  "src/data/dsm-clinical-content.json",
  "src/data/formulation-content.json",
  "src/data/therapies-source.json",
  "src/lib/dictionary-data.ts",
  "src/components/factsheets/factsheets-data.ts",
  "src/components/calculators/calculator-fixtures.ts",
  "src/lib/tools-catalog.ts",
]);

const approvedSiteRoles = new Set<ClinicalSourceRole>([
  "clinical_reference",
  "service_directory",
  "form_reference",
  "tool_reference",
]);

function route(base: string) {
  return (slug: string) => `${base}/${encodeURIComponent(slug.trim())}`;
}

function dynamicProducer(args: {
  key: string;
  domain: SiteContentDomain;
  canonicalSource: string;
  producerModule: string;
  publicationVersionField: string;
  adapter: string;
  role: ClinicalSourceRole;
  registryKind: RegistryCorpusKind;
  routeBase: string;
  recordAdoptions?: readonly SiteContentRecordAdoption[];
}): DynamicSiteContentProducerDefinition {
  return {
    version: "site-content-producer-v1",
    key: args.key,
    producerClass: "dynamic_registry",
    domain: args.domain,
    corpusScope: "clinical_kb_site",
    canonicalSource: args.canonicalSource,
    producerModule: args.producerModule,
    publicationVersionField: args.publicationVersionField,
    adapter: args.adapter,
    allowedRoles: [args.role],
    readPolicy: "public",
    readerPopulation: "anonymous_authenticated_administrator",
    readPartitionKey: "active_public_release",
    mutationPolicy: "administrator_server_only",
    mutationActor: "administrator",
    mutationBoundary: "server",
    routeBuilder: route(args.routeBase),
    reviewOwner: "clinical-content-governance",
    activationState: "eligible",
    ineligibilityReason: null,
    recordAdoptions: args.recordAdoptions ?? null,
    currentAuditProjection: {
      source_kind: "registry_record",
      registry_record_kind: args.registryKind,
      corpus_scope: "clinical_kb_site",
      source_role: args.role,
      site_content_domain: args.domain,
    },
  };
}

function staticProducer(args: {
  key: string;
  domain: SiteContentDomain;
  canonicalSource: string;
  producerModule: string;
  publicationVersionField: string;
  adapter: string;
  role: ClinicalSourceRole;
  routeBase: string;
  activationState?: "eligible" | "reviewed_ineligible";
  ineligibilityReason?: string;
  recordAdoptions?: readonly SiteContentRecordAdoption[];
}): StaticSiteContentProducerDefinition {
  return {
    version: "site-content-producer-v1",
    key: args.key,
    producerClass: "static_repository",
    domain: args.domain,
    corpusScope: "clinical_kb_site",
    canonicalSource: args.canonicalSource,
    producerModule: args.producerModule,
    publicationVersionField: args.publicationVersionField,
    adapter: args.adapter,
    allowedRoles: [args.role],
    readPolicy: "public",
    readerPopulation: "anonymous_authenticated_administrator",
    readPartitionKey: "active_public_release",
    mutationPolicy: "repository_release_only",
    mutationActor: null,
    mutationBoundary: "repository_release",
    routeBuilder: route(args.routeBase),
    reviewOwner: "clinical-content-governance",
    activationState: args.activationState ?? "eligible",
    ineligibilityReason: args.ineligibilityReason ?? null,
    recordAdoptions: args.recordAdoptions ?? null,
    currentAuditProjection: null,
  };
}

export const siteContentProducerDefinitions: readonly SiteContentProducerDefinition[] = [
  dynamicProducer({
    key: "services",
    domain: "services",
    canonicalSource: "database:clinical_registry_records:service",
    producerModule: "src/lib/registry-corpus.ts#clinicalRegistryRowsToCorpusEntries",
    publicationVersionField: "updated_at",
    adapter: "registry/service",
    role: "service_directory",
    registryKind: "service",
    routeBase: "/services",
  }),
  dynamicProducer({
    key: "forms",
    domain: "forms",
    canonicalSource: "database:clinical_registry_records:form",
    producerModule: "src/lib/registry-corpus.ts#clinicalRegistryRowsToCorpusEntries",
    publicationVersionField: "updated_at",
    adapter: "registry/form",
    role: "form_reference",
    registryKind: "form",
    routeBase: "/forms",
  }),
  dynamicProducer({
    key: "medications",
    domain: "medications",
    canonicalSource: "database:medication_records",
    producerModule: "src/lib/registry-corpus.ts#medicationRowsToCorpusEntries",
    publicationVersionField: "updated_at",
    adapter: "registry/medication",
    role: "clinical_reference",
    registryKind: "medication",
    routeBase: "/medications",
  }),
  dynamicProducer({
    key: "differentials",
    domain: "differentials",
    canonicalSource: "database:differential_records",
    producerModule: "src/lib/registry-corpus.ts#differentialRowsToCorpusEntries",
    publicationVersionField: "updated_at",
    adapter: "registry/differential",
    role: "clinical_reference",
    registryKind: "differential",
    routeBase: "/differentials",
  }),
  staticProducer({
    key: "specifiers",
    domain: "specifiers",
    canonicalSource: "src/lib/specifiers-content.ts",
    producerModule: "src/lib/specifiers-content.ts",
    publicationVersionField: "contentVersion",
    adapter: "static/specifiers",
    role: "clinical_reference",
    routeBase: "/specifiers",
    activationState: "reviewed_ineligible",
    ineligibilityReason: "missing_canonical_lineage_and_review",
  }),
  staticProducer({
    key: "dsm",
    domain: "dsm",
    canonicalSource: "src/data/dsm-clinical-content.json",
    producerModule: "src/lib/dsm.ts",
    publicationVersionField: "contentVersion",
    adapter: "static/dsm",
    role: "clinical_reference",
    routeBase: "/dsm",
  }),
  staticProducer({
    key: "formulation",
    domain: "formulation",
    canonicalSource: "src/data/formulation-content.json",
    producerModule: "src/lib/formulation.ts",
    publicationVersionField: "contentVersion",
    adapter: "static/formulation",
    role: "clinical_reference",
    routeBase: "/formulation",
  }),
  staticProducer({
    key: "therapies",
    domain: "therapies",
    canonicalSource: "src/data/therapies-source.json",
    producerModule: "src/lib/therapies.ts",
    publicationVersionField: "reviewed",
    adapter: "static/therapies",
    role: "clinical_reference",
    routeBase: "/therapy-compass",
  }),
  staticProducer({
    key: "dictionary",
    domain: "dictionary",
    canonicalSource: "src/lib/dictionary-data.ts",
    producerModule: "src/lib/dictionary-data.ts",
    publicationVersionField: "reviewedAt",
    adapter: "static/dictionary",
    role: "clinical_reference",
    routeBase: "/dictionary",
    activationState: "reviewed_ineligible",
    ineligibilityReason: "excluded_source_present",
  }),
  staticProducer({
    key: "factsheets",
    domain: "factsheets",
    canonicalSource: "src/components/factsheets/factsheets-data.ts",
    producerModule: "src/components/factsheets/factsheets-data.ts",
    publicationVersionField: "reviewedAt",
    adapter: "static/factsheets",
    role: "clinical_reference",
    routeBase: "/factsheets",
    activationState: "reviewed_ineligible",
    ineligibilityReason: "excluded_source_and_not_clinician_approved",
  }),
  staticProducer({
    key: "calculators",
    domain: "calculators",
    canonicalSource: "src/components/calculators/calculator-fixtures.ts",
    producerModule: "src/components/calculators/calculator-fixtures.ts",
    publicationVersionField: "sourceReviewedAt",
    adapter: "static/calculators",
    role: "tool_reference",
    routeBase: "/calculators",
    activationState: "reviewed_ineligible",
    ineligibilityReason: "missing_source_governance",
  }),
  staticProducer({
    key: "tools",
    domain: "tools",
    canonicalSource: "src/lib/tools-catalog.ts",
    producerModule: "src/lib/tools-catalog.ts",
    publicationVersionField: "reviewedAt",
    adapter: "static/tools",
    role: "tool_reference",
    routeBase: "/tools",
    recordAdoptions: [
      { recordId: "clinical-kb-search", disposition: "reviewed_exclusion", reason: "corpus_consumer" },
      { recordId: "differentials", disposition: "eligible" },
      { recordId: "documents", disposition: "reviewed_exclusion", reason: "trusted_ingestion_owned" },
      { recordId: "clinical-dictionary", disposition: "reviewed_exclusion", reason: "excluded_source_present" },
      { recordId: "guidelines", disposition: "reviewed_exclusion", reason: "trusted_ingestion_owned" },
      { recordId: "risk-safety", disposition: "reviewed_exclusion", reason: "review_due" },
      { recordId: "medication-prescribing", disposition: "reviewed_exclusion", reason: "review_due" },
      { recordId: "services", disposition: "eligible" },
      { recordId: "ward-management", disposition: "reviewed_exclusion", reason: "synthetic_or_private_state" },
      { recordId: "forms", disposition: "eligible" },
      { recordId: "care-plans", disposition: "reviewed_exclusion", reason: "non_knowledge_tool" },
      { recordId: "safety-plan", disposition: "reviewed_exclusion", reason: "not_source_backed" },
      { recordId: "calculators", disposition: "reviewed_exclusion", reason: "missing_source_governance" },
      { recordId: "monitoring", disposition: "reviewed_exclusion", reason: "review_due" },
      { recordId: "favourites", disposition: "reviewed_exclusion", reason: "private_state" },
    ],
  }),
];

export const siteContentModeAdoptionRegistry: readonly SiteContentModeAdoption[] = [
  {
    mode: "answer",
    disposition: "reviewed_exclusion",
    reason: "corpus_consumer",
    reviewOwner: "clinical-content-governance",
  },
  {
    mode: "documents",
    disposition: "reviewed_exclusion",
    reason: "trusted_ingestion_owned",
    reviewOwner: "clinical-content-governance",
  },
  { mode: "services", disposition: "registered", domain: "services", producerKey: "services" },
  { mode: "forms", disposition: "registered", domain: "forms", producerKey: "forms" },
  {
    mode: "favourites",
    disposition: "reviewed_exclusion",
    reason: "private_state",
    reviewOwner: "clinical-content-governance",
  },
  { mode: "differentials", disposition: "registered", domain: "differentials", producerKey: "differentials" },
  { mode: "dsm", disposition: "registered", domain: "dsm", producerKey: "dsm" },
  {
    mode: "specifiers",
    disposition: "reviewed_ineligible",
    domain: "specifiers",
    producerKey: "specifiers",
    reason: "missing_canonical_lineage_and_review",
    reviewOwner: "clinical-content-governance",
  },
  { mode: "formulation", disposition: "registered", domain: "formulation", producerKey: "formulation" },
  { mode: "prescribing", disposition: "registered", domain: "medications", producerKey: "medications" },
  { mode: "tools", disposition: "registered", domain: "tools", producerKey: "tools" },
  {
    mode: "calculators",
    disposition: "reviewed_ineligible",
    domain: "calculators",
    producerKey: "calculators",
    reason: "missing_source_governance",
    reviewOwner: "clinical-content-governance",
  },
  { mode: "therapy-compass", disposition: "registered", domain: "therapies", producerKey: "therapies" },
  {
    mode: "factsheets",
    disposition: "reviewed_ineligible",
    domain: "factsheets",
    producerKey: "factsheets",
    reason: "excluded_source_and_not_clinician_approved",
    reviewOwner: "clinical-content-governance",
  },
  {
    mode: "dictionary",
    disposition: "reviewed_ineligible",
    domain: "dictionary",
    producerKey: "dictionary",
    reason: "excluded_source_present",
    reviewOwner: "clinical-content-governance",
  },
];

function normalizedIdentity(value: string) {
  return value.trim().toLowerCase();
}

function forbiddenSourceIdentity(value: string) {
  const normalized = normalizedIdentity(value);
  return (
    normalized.includes("healthdirect") ||
    /(^|[^a-z])etg(?: complete)?([^a-z]|$)/.test(normalized) ||
    normalized.includes("australian medicines handbook") ||
    /(^|[^a-z])amh([^a-z]|$)/.test(normalized)
  );
}

export function assertSiteContentProducerDefinition(
  producer: SiteContentProducerDefinition,
): asserts producer is SiteContentProducerDefinition {
  if (!approvedCanonicalSources.has(producer.canonicalSource) || forbiddenSourceIdentity(producer.canonicalSource)) {
    throw new Error(`${producer.canonicalSource} is not an approved site-content producer source.`);
  }
  if (producer.corpusScope !== "clinical_kb_site" || producer.readPolicy !== "public") {
    throw new Error(`Site-content producer ${producer.key} must use the single public clinical_kb_site partition.`);
  }
  if (producer.allowedRoles.length === 0 || producer.allowedRoles.some((role) => !approvedSiteRoles.has(role))) {
    throw new Error(`Site-content producer ${producer.key} has a role that cannot support first-party site claims.`);
  }
  if (producer.activationState === "pending_review") {
    throw new Error(`Site-content producer ${producer.key} is pending review and cannot satisfy adoption.`);
  }
  if (producer.activationState === "reviewed_ineligible" && !producer.ineligibilityReason) {
    throw new Error(`Site-content producer ${producer.key} is ineligible without a reviewed reason.`);
  }
  if (producer.activationState === "eligible" && producer.ineligibilityReason) {
    throw new Error(`Eligible site-content producer ${producer.key} cannot retain an ineligibility reason.`);
  }
  if (producer.producerClass === "dynamic_registry") {
    if (
      producer.mutationPolicy !== "administrator_server_only" ||
      producer.currentAuditProjection.corpus_scope !== "clinical_kb_site" ||
      producer.currentAuditProjection.site_content_domain !== producer.domain ||
      !producer.allowedRoles.includes(producer.currentAuditProjection.source_role)
    ) {
      throw new Error(`Dynamic site-content producer ${producer.key} has an invalid public audit projection.`);
    }
  }
}

export function assertCompleteSiteContentModeCoverage(
  modes: readonly string[],
  adoptions: readonly SiteContentModeAdoption[],
) {
  const producerByKey = new Map(siteContentProducerDefinitions.map((producer) => [producer.key, producer]));
  const adoptionCounts = new Map<string, number>();
  for (const adoption of adoptions) adoptionCounts.set(adoption.mode, (adoptionCounts.get(adoption.mode) ?? 0) + 1);

  for (const mode of modes) {
    const adoption = adoptions.find((candidate) => candidate.mode === mode);
    if (!adoption || adoptionCounts.get(mode) !== 1) {
      throw new Error(`App mode ${mode} must be registered or have one reviewed exclusion.`);
    }
    if (adoption.disposition === "pending_review") {
      throw new Error(`App mode ${mode} is pending review; it must be registered or have a reviewed exclusion.`);
    }
    if (adoption.disposition === "registered" || adoption.disposition === "reviewed_ineligible") {
      const producer = producerByKey.get(adoption.producerKey);
      if (!producer || producer.domain !== adoption.domain) {
        throw new Error(`App mode ${mode} does not resolve to its registered canonical producer.`);
      }
      if (adoption.disposition === "registered" && producer.activationState !== "eligible") {
        throw new Error(`App mode ${mode} cannot register an ineligible producer.`);
      }
      if (adoption.disposition === "reviewed_ineligible" && producer.activationState !== "reviewed_ineligible") {
        throw new Error(`App mode ${mode} must bind its reviewed ineligibility to the producer contract.`);
      }
    }
  }
}

for (const producer of siteContentProducerDefinitions) assertSiteContentProducerDefinition(producer);
assertCompleteSiteContentModeCoverage(appModeIds, siteContentModeAdoptionRegistry);

export function siteContentProducerForDomain(domain: SiteContentDomain) {
  return siteContentProducerDefinitions.find((producer) => producer.domain === domain) ?? null;
}

export type SiteContentPublicationCandidate = {
  record: SiteContentRecord;
  publicationState: "draft" | "preview" | "published" | "retired";
  renderedByPublicSite: boolean;
  audit: { ownerId: string | null; actorId: string | null };
};

export function assertSiteContentRecordEligible(record: SiteContentRecord) {
  const producer = siteContentProducerForDomain(record.domain);
  if (
    !producer ||
    producer.activationState !== "eligible" ||
    record.producerClass !== producer.producerClass ||
    !producer.allowedRoles.includes(record.sourceRole) ||
    record.access !== "public"
  ) {
    throw new Error(`Site-content record ${record.logicalId} does not match its registered public producer.`);
  }
  if (producer.recordAdoptions) {
    const recordId = record.logicalId.replace(new RegExp(`^${producer.key}:`), "");
    const adoption = producer.recordAdoptions.find((candidate) => candidate.recordId === recordId);
    if (!adoption || adoption.disposition !== "eligible") {
      throw new Error(`Site-content record ${record.logicalId} is not an explicitly eligible producer record.`);
    }
  }
  const forbiddenIdentities = [
    record.logicalId,
    record.title,
    record.route,
    ...record.sourceLineage.map((item) => item.sourceId),
  ];
  if (forbiddenIdentities.some(forbiddenSourceIdentity)) {
    throw new Error(`Site-content record ${record.logicalId} names an excluded or link-only source.`);
  }
  const expectedPrefix = producer.routeBuilder("").replace(/\/$/, "");
  if (!record.route.startsWith(`${expectedPrefix}/`)) {
    throw new Error(`Site-content record ${record.logicalId} does not use its canonical public route.`);
  }
}

export function selectCanonicalPublicSiteContentPublication(candidates: readonly SiteContentPublicationCandidate[]) {
  const eligible = candidates.filter(
    (candidate) => candidate.publicationState === "published" && candidate.renderedByPublicSite,
  );
  if (eligible.length !== 1) {
    throw new Error("Expected exactly one canonical public publication for the logical site-content record.");
  }
  const selected = eligible[0]!;
  assertSiteContentRecordEligible(selected.record);
  return selected.record;
}

export function siteContentRetrievalMetadata(record: SiteContentRecord) {
  assertSiteContentRecordEligible(record);
  return {
    source_kind: "site_content_record" as const,
    corpus_scope: "clinical_kb_site" as const,
    source_role: record.sourceRole,
    site_content_domain: record.domain,
    logical_id: record.logicalId,
    publication_version: record.publicationVersion,
    content_hash: record.contentHash,
    source_lineage: record.sourceLineage.map(({ sourceId, sourceHash, relationship }) => ({
      source_id: sourceId,
      source_hash: sourceHash,
      relationship,
    })),
  };
}

export function siteContentEvidenceFamilyKey(record: SiteContentRecord) {
  const derivedSources = [
    ...new Set(
      record.sourceLineage
        .filter((lineage) => lineage.relationship === "derived_from")
        .map((lineage) => `source:${normalizedIdentity(lineage.sourceId)}:${normalizedIdentity(lineage.sourceHash)}`),
    ),
  ].sort();
  if (derivedSources.length === 1) return derivedSources[0]!;
  if (derivedSources.length > 1) return `sources:${derivedSources.join("|")}`;
  return `site:${record.logicalId}:${record.contentHash}`;
}

export function assertSiteContentPartitionSnapshot(snapshot: SiteContentPartitionSnapshot) {
  const staticManifestMatch =
    snapshot.expectedStaticManifestDigest !== null &&
    snapshot.activeStaticManifestDigest !== null &&
    snapshot.expectedStaticManifestDigest === snapshot.activeStaticManifestDigest &&
    snapshot.staticManifestDigest === snapshot.activeStaticManifestDigest &&
    snapshot.staticManifestMatch;
  if (snapshot.state === "current" && !staticManifestMatch) {
    throw new Error("A static manifest mismatch cannot be current site content.");
  }
  if (
    snapshot.state === "current" &&
    (!snapshot.registryVersion ||
      !snapshot.releaseId ||
      !snapshot.dynamicStateDigest ||
      !snapshot.releaseDigest ||
      !snapshot.changeEpoch ||
      snapshot.pendingLogicalIds.length > 0 ||
      !snapshot.pendingLogicalIdsDigest)
  ) {
    throw new Error("Current site content requires complete release, epoch, and empty pending-set identity.");
  }
}

export type SiteContentClaimPurpose = "product_catalogue" | "patient_specific_diagnosis" | "clinical_guidance";

export type SiteContentClaimPolicyDecision = {
  siteUse: "primary" | "supporting" | "navigation_only";
  primaryCorpusScope: Extract<SourceCorpusScope, "clinical_kb_site" | "uploaded_local"> | null;
  requiresEligibleClinicalEvidence: boolean;
  insufficiencyReason: RagInsufficiencyReason | null;
};

export function evaluateSiteContentClaimPolicy(args: {
  purpose: SiteContentClaimPurpose;
  sourceRole: ClinicalSourceRole;
  eligibleUploadedGuideline?: boolean;
}): SiteContentClaimPolicyDecision {
  if (args.purpose === "product_catalogue" && approvedSiteRoles.has(args.sourceRole)) {
    return {
      siteUse: "primary" as const,
      primaryCorpusScope: "clinical_kb_site" as const,
      requiresEligibleClinicalEvidence: false,
      insufficiencyReason: null,
    };
  }
  if (args.purpose === "clinical_guidance" && args.eligibleUploadedGuideline) {
    return {
      siteUse: "supporting" as const,
      primaryCorpusScope: "uploaded_local" as const,
      requiresEligibleClinicalEvidence: false,
      insufficiencyReason: null,
    };
  }
  return {
    siteUse: "navigation_only" as const,
    primaryCorpusScope: null,
    requiresEligibleClinicalEvidence: true,
    insufficiencyReason: "insufficient_claim_support",
  };
}
