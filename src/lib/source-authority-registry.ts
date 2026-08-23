import type { ClinicalSourceMetadata } from "@/lib/types";

export type AustralianSourceTier = "wa_validated" | "australian_national" | "australian_state" | "supplementary";
export type SourceDesignation = "official" | "trusted" | "unclassified";
export type SourceOfficialBasis = "wa_hospital" | "wa_health_service_network" | null;

export type SourceAuthorityScope = "wa" | "australian_national" | "australian_state" | "international";

export type SourceAuthorityDefinition = {
  key: string;
  codes: readonly string[];
  publisher: string;
  publisherAliases: readonly string[];
  jurisdictions: readonly string[];
  scope: SourceAuthorityScope;
  tier: Exclude<AustralianSourceTier, "supplementary"> | "supplementary";
  designation: SourceDesignation;
  officialBasis: SourceOfficialBasis;
};

export type SourceAuthorityConflict = "publisher_mismatch" | "jurisdiction_mismatch";
export type SourceDesignationReasonCode =
  | "recognized_official_wa_hospital"
  | "recognized_official_wa_health_service_network"
  | "recognized_trusted_authority"
  | "registry_summary_identity"
  | "unrecognized_authority"
  | "publisher_alias_requires_jurisdiction"
  | "authority_metadata_conflict";

export type SourceAuthorityClassification = {
  tier: AustralianSourceTier;
  designation: SourceDesignation;
  authorityKey: string | null;
  officialBasis: SourceOfficialBasis;
  reasonCodes: SourceDesignationReasonCode[];
  authorityTier: SourceAuthorityDefinition["tier"] | null;
  authority: SourceAuthorityDefinition | null;
  matchedBy: "publisher_code" | "publisher_alias" | "none";
  codeKnown: boolean;
  conflict: boolean;
  conflicts: SourceAuthorityConflict[];
  eligibilityReasons: string[];
};

function sourceMetadataRecord(input: unknown): Partial<ClinicalSourceMetadata> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Partial<ClinicalSourceMetadata>) : {};
}

function sourceMetadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceMetadataStatus<T extends string>(value: unknown, fallback: T): T {
  return typeof value === "string" && value.trim() ? (value as T) : fallback;
}

const waJurisdictions = ["Australia/WA", "Australia/Western Australia", "Western Australia", "WA"] as const;
const nationalJurisdictions = [
  "Australia",
  "Australia/National",
  "Australia/Commonwealth",
  "Australian national",
  "Commonwealth of Australia",
] as const;

function authority(
  definition: Omit<SourceAuthorityDefinition, "publisherAliases" | "designation" | "officialBasis"> & {
    publisherAliases?: readonly string[];
    designation?: SourceDesignation;
    officialBasis?: SourceOfficialBasis;
  },
): SourceAuthorityDefinition {
  return {
    designation: "trusted",
    officialBasis: null,
    ...definition,
    publisherAliases: [definition.publisher, ...(definition.publisherAliases ?? [])],
  };
}

/**
 * Canonical authority registry shared by runtime selection and metadata tooling.
 *
 * Runtime classification is deliberately metadata-only: titles, filenames and
 * document prose are never accepted as authority evidence here.
 */
export const sourceAuthorityRegistry = [
  authority({
    key: "wa-health",
    codes: ["WAHEALTH", "DOHWA"],
    publisher: "WA Health",
    publisherAliases: [
      "WA Department of Health",
      "Western Australian Department of Health",
      "Department of Health Western Australia",
      "Government of Western Australia Department of Health",
    ],
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
  }),
  authority({
    key: "wa-chief-psychiatrist",
    codes: ["WACP"],
    publisher: "Office of the Chief Psychiatrist WA",
    publisherAliases: ["Chief Psychiatrist of Western Australia"],
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
  }),
  authority({
    key: "wa-legislation",
    codes: ["WALEG"],
    publisher: "Western Australian Legislation",
    publisherAliases: ["Western Australia Legislation"],
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
  }),
  authority({
    key: "armadale-kalamunda-group",
    codes: ["AKG"],
    publisher: "Armadale Kalamunda Group",
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_hospital",
  }),
  authority({
    key: "child-and-adolescent-health-service",
    codes: ["CAHS"],
    publisher: "Child and Adolescent Health Service",
    publisherAliases: ["Perth Children's Hospital", "Princess Margaret Hospital"],
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_health_service_network",
  }),
  authority({
    key: "camhs-wa",
    codes: ["CAMHS"],
    publisher: "Child and Adolescent Mental Health Service",
    publisherAliases: ["Child and Adolescent Mental Health Services"],
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
  }),
  authority({
    key: "east-metropolitan-health-service",
    codes: ["EMHS"],
    publisher: "East Metropolitan Health Service",
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_health_service_network",
  }),
  authority({
    key: "fiona-stanley-fremantle-hospitals-group",
    codes: ["FSH", "FSFH", "FSFHG"],
    publisher: "Fiona Stanley Fremantle Hospitals Group",
    publisherAliases: ["Fiona Stanley Hospital", "Fiona Stanley Fremantle Hospitals"],
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_hospital",
  }),
  authority({
    key: "king-edward-memorial-hospital",
    codes: ["KEMH", "KEMHS"],
    publisher: "King Edward Memorial Hospital",
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_hospital",
  }),
  authority({
    key: "north-metropolitan-health-service",
    codes: ["NMHS"],
    publisher: "North Metropolitan Health Service",
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_health_service_network",
  }),
  authority({
    key: "peel-health-campus",
    codes: ["PHC"],
    publisher: "Peel Health Campus",
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_hospital",
  }),
  authority({
    key: "rockingham-peel-group",
    codes: ["RKPG"],
    publisher: "Rockingham Peel Group",
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_hospital",
  }),
  authority({
    key: "royal-perth-bentley-group",
    codes: ["RPBG"],
    publisher: "Royal Perth Bentley Group",
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_hospital",
  }),
  authority({
    key: "south-metropolitan-health-service",
    codes: ["SMHS"],
    publisher: "South Metropolitan Health Service",
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_health_service_network",
  }),
  authority({
    key: "wa-country-health-service",
    codes: ["WACHS"],
    publisher: "WA Country Health Service",
    publisherAliases: ["Western Australia Country Health Service"],
    jurisdictions: waJurisdictions,
    scope: "wa",
    tier: "wa_validated",
    designation: "official",
    officialBasis: "wa_health_service_network",
  }),
  authority({
    key: "acsqhc",
    codes: ["ACSQHC"],
    publisher: "Australian Commission on Safety and Quality in Health Care",
    publisherAliases: ["Australian Commission on Safety and Quality in Healthcare"],
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  authority({
    key: "australian-prescriber",
    codes: ["AUSPRES"],
    publisher: "Australian Prescriber",
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  authority({
    key: "australian-department-of-health",
    codes: ["AUSDOH", "DOHA"],
    publisher: "Australian Government Department of Health and Aged Care",
    publisherAliases: ["Australian Department of Health and Aged Care", "Australian Government Department of Health"],
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  authority({
    key: "nhmrc",
    codes: ["NHMRC"],
    publisher: "National Health and Medical Research Council",
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  authority({
    key: "nps-medicinewise",
    codes: ["NPS"],
    publisher: "NPS MedicineWise",
    publisherAliases: ["National Prescribing Service"],
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  authority({
    key: "pbs",
    codes: ["PBS"],
    publisher: "Pharmaceutical Benefits Scheme",
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  authority({
    key: "racgp",
    codes: ["RACGP"],
    publisher: "Royal Australian College of General Practitioners",
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  authority({
    key: "ranzcp",
    codes: ["RANZCP"],
    publisher: "Royal Australian and New Zealand College of Psychiatrists",
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  authority({
    key: "tga",
    codes: ["TGA"],
    publisher: "Therapeutic Goods Administration",
    jurisdictions: nationalJurisdictions,
    scope: "australian_national",
    tier: "australian_national",
  }),
  ...[
    ["act-health", "ACTHEALTH", "ACT Health", "Australia/ACT"],
    ["nsw-health", "NSWHEALTH", "NSW Health", "Australia/NSW"],
    ["nt-health", "NTHEALTH", "NT Health", "Australia/NT"],
    ["queensland-health", "QLDHEALTH", "Queensland Health", "Australia/QLD"],
    ["sa-health", "SAHEALTH", "SA Health", "Australia/SA"],
    ["tasmania-health", "TASHEALTH", "Tasmanian Department of Health", "Australia/TAS"],
    ["victoria-health", "VICHEALTH", "Victorian Department of Health", "Australia/VIC"],
  ].map(([key, code, publisher, jurisdiction]) =>
    authority({
      key,
      codes: [code],
      publisher,
      jurisdictions: [jurisdiction],
      scope: "australian_state",
      tier: "australian_state",
    }),
  ),
  authority({
    key: "bmj-best-practice",
    codes: ["BMJ"],
    publisher: "BMJ Best Practice",
    publisherAliases: ["BMJ Publishing Group"],
    jurisdictions: ["International", "Global", "United Kingdom", "UK"],
    scope: "international",
    tier: "supplementary",
  }),
  authority({
    key: "nice",
    codes: ["NICE"],
    publisher: "National Institute for Health and Care Excellence",
    jurisdictions: ["United Kingdom", "UK", "England"],
    scope: "international",
    tier: "supplementary",
  }),
  authority({
    key: "world-health-organization",
    codes: ["WHO"],
    publisher: "World Health Organization",
    jurisdictions: ["International", "Global"],
    scope: "international",
    tier: "supplementary",
  }),
] satisfies SourceAuthorityDefinition[];

export function normalizeSourceAuthorityText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePublisherCode(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

const authorityByCode = new Map(
  sourceAuthorityRegistry.flatMap((entry) => entry.codes.map((code) => [normalizePublisherCode(code), entry] as const)),
);
const authorityByPublisher = new Map(
  sourceAuthorityRegistry.flatMap((entry) =>
    entry.publisherAliases.map((publisher) => [normalizeSourceAuthorityText(publisher), entry] as const),
  ),
);
const genericWaPublishers = new Set(
  sourceAuthorityRegistry
    .find((entry) => entry.key === "wa-health")!
    .publisherAliases.map((publisher) => normalizeSourceAuthorityText(publisher)),
);

export function sourceAuthorityForPublisherCode(code: string | null | undefined) {
  return authorityByCode.get(normalizePublisherCode(code)) ?? null;
}

export function sourceAuthorityForPublisher(publisher: string | null | undefined) {
  return authorityByPublisher.get(normalizeSourceAuthorityText(publisher)) ?? null;
}

function publisherCompatible(authorityEntry: SourceAuthorityDefinition, publisher: string) {
  const normalizedPublisher = normalizeSourceAuthorityText(publisher);
  if (!normalizedPublisher) return true;
  if (authorityEntry.publisherAliases.some((alias) => normalizeSourceAuthorityText(alias) === normalizedPublisher)) {
    return true;
  }
  return authorityEntry.scope === "wa" && genericWaPublishers.has(normalizedPublisher);
}

function jurisdictionCompatible(authorityEntry: SourceAuthorityDefinition, jurisdiction: string) {
  const normalizedJurisdiction = normalizeSourceAuthorityText(jurisdiction);
  if (!normalizedJurisdiction) return true;
  return authorityEntry.jurisdictions.some(
    (candidate) => normalizeSourceAuthorityText(candidate) === normalizedJurisdiction,
  );
}

function isCurrentUsableDocument(
  metadata: Pick<ClinicalSourceMetadata, "source_kind" | "document_status" | "extraction_quality">,
) {
  return (
    metadata.source_kind !== "registry_record" &&
    metadata.document_status === "current" &&
    metadata.extraction_quality === "good"
  );
}

function isLocallyValidated(metadata: Pick<ClinicalSourceMetadata, "clinical_validation_status">) {
  return (
    metadata.clinical_validation_status === "approved" || metadata.clinical_validation_status === "locally_reviewed"
  );
}

export function classifySourceAuthority(input: unknown): SourceAuthorityClassification {
  const rawMetadata = sourceMetadataRecord(input);
  const metadata = {
    source_kind: sourceMetadataString(rawMetadata.source_kind),
    publisher: sourceMetadataString(rawMetadata.publisher),
    publisher_code: sourceMetadataString(rawMetadata.publisher_code),
    jurisdiction: sourceMetadataString(rawMetadata.jurisdiction),
    document_status: sourceMetadataStatus(rawMetadata.document_status, "unknown"),
    clinical_validation_status: sourceMetadataStatus(rawMetadata.clinical_validation_status, "unverified"),
    extraction_quality: sourceMetadataStatus(rawMetadata.extraction_quality, "unknown"),
  } satisfies Partial<ClinicalSourceMetadata>;
  const code = normalizePublisherCode(metadata.publisher_code);
  const codeAuthority = sourceAuthorityForPublisherCode(code);
  const publisherAuthority = sourceAuthorityForPublisher(metadata.publisher);
  const authorityEntry = codeAuthority ?? publisherAuthority;
  const matchedBy = codeAuthority ? "publisher_code" : publisherAuthority ? "publisher_alias" : "none";
  const conflicts: SourceAuthorityConflict[] = [];
  const eligibilityReasons: string[] = [];

  if (authorityEntry && metadata.publisher && !publisherCompatible(authorityEntry, metadata.publisher)) {
    conflicts.push("publisher_mismatch");
  }
  if (authorityEntry && metadata.jurisdiction && !jurisdictionCompatible(authorityEntry, metadata.jurisdiction)) {
    conflicts.push("jurisdiction_mismatch");
  }

  const reasonCodes: SourceDesignationReasonCode[] = [];

  if (metadata.source_kind === "registry_record") reasonCodes.push("registry_summary_identity");
  if (!authorityEntry) {
    eligibilityReasons.push("unrecognized_authority");
    reasonCodes.push("unrecognized_authority");
  }
  if (!codeAuthority && publisherAuthority && !metadata.jurisdiction) {
    eligibilityReasons.push("publisher_alias_requires_jurisdiction");
    reasonCodes.push("publisher_alias_requires_jurisdiction");
  }
  if (conflicts.length > 0) {
    eligibilityReasons.push("authority_metadata_conflict");
    reasonCodes.push("authority_metadata_conflict");
  }
  if (!isCurrentUsableDocument(metadata)) eligibilityReasons.push("source_not_current_usable_document");
  if (authorityEntry?.tier === "wa_validated" && !isLocallyValidated(metadata)) {
    eligibilityReasons.push("wa_source_not_locally_validated");
  }

  const eligible =
    Boolean(authorityEntry) &&
    conflicts.length === 0 &&
    (Boolean(codeAuthority) || Boolean(metadata.jurisdiction)) &&
    isCurrentUsableDocument(metadata) &&
    (authorityEntry?.tier !== "wa_validated" || isLocallyValidated(metadata));

  const designationRecognized =
    Boolean(authorityEntry) &&
    metadata.source_kind !== "registry_record" &&
    conflicts.length === 0 &&
    (Boolean(codeAuthority) || Boolean(metadata.jurisdiction));
  const designation = designationRecognized ? (authorityEntry?.designation ?? "trusted") : "unclassified";
  if (designation === "official" && authorityEntry?.officialBasis === "wa_hospital") {
    reasonCodes.push("recognized_official_wa_hospital");
  } else if (designation === "official" && authorityEntry?.officialBasis === "wa_health_service_network") {
    reasonCodes.push("recognized_official_wa_health_service_network");
  } else if (designation === "trusted") {
    reasonCodes.push("recognized_trusted_authority");
  }

  return {
    tier: eligible ? (authorityEntry?.tier ?? "supplementary") : "supplementary",
    designation,
    authorityKey: designationRecognized ? (authorityEntry?.key ?? null) : null,
    officialBasis: designationRecognized ? (authorityEntry?.officialBasis ?? null) : null,
    reasonCodes: [...new Set(reasonCodes)],
    authorityTier: authorityEntry?.tier ?? null,
    authority: authorityEntry ?? null,
    matchedBy,
    codeKnown: Boolean(codeAuthority),
    conflict: conflicts.length > 0,
    conflicts,
    eligibilityReasons,
  };
}
