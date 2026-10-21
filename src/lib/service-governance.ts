import canonicalPart01 from "@/lib/services-canonical-data/part-01";
import canonicalPart02 from "@/lib/services-canonical-data/part-02";
import canonicalPart03 from "@/lib/services-canonical-data/part-03";
import canonicalPart04 from "@/lib/services-canonical-data/part-04";
import canonicalPart05 from "@/lib/services-canonical-data/part-05";
import canonicalPart06 from "@/lib/services-canonical-data/part-06";
import canonicalPart07 from "@/lib/services-canonical-data/part-07";
import canonicalPart08 from "@/lib/services-canonical-data/part-08";
import canonicalPart09 from "@/lib/services-canonical-data/part-09";

import type {
  CatalogService,
  CatalogServiceClaim,
  CatalogServiceEvidenceSource,
  CatalogServiceReferralRoute,
  CatalogServiceStructuredContact,
  CatalogServiceStructuredHours,
  CatalogServiceTags,
} from "@/lib/service-catalog";

export type ServiceAvailabilityStatus =
  "active" | "planned" | "temporarily_unavailable" | "closed" | "superseded" | "unknown";

export type ServicePresentationTier = "A_immediate" | "B_common_referral" | "C_specialist_support";
export type ServiceVerificationStatus =
  "verified_current_core" | "locally_confirmed" | "legacy_unverified" | "unable_to_verify";

export type CanonicalServiceSourceInput = {
  id: string;
  title: string;
  issuer: string;
  class: string;
  url: string;
  date: string;
  accessed: string;
  limitations: string;
};

export type CanonicalServiceInput = {
  id: string;
  name: string;
  aliases: readonly string[];
  match: readonly string[];
  category: string;
  groups: readonly string[];
  tier: ServicePresentationTier;
  status: ServiceAvailabilityStatus;
  statusNote: string;
  jurisdiction: string;
  catchments: readonly string[];
  population: string;
  ages: readonly string[];
  bestUse: string;
  notFor: readonly string[];
  routes: readonly {
    route_type: string;
    summary: string;
    self_referral: boolean | null;
    required_documents: readonly string[];
  }[];
  contacts: readonly { label: string; value: string; kind: string }[];
  hours: {
    display: string;
    timezone: string;
    verification_status: "verified" | "unable_to_verify";
  };
  website: string | null;
  verification: ServiceVerificationStatus;
  verified: string;
  review: string;
  intents: readonly string[];
  supersededBy: string | null;
  issues: readonly string[];
  sources: readonly CanonicalServiceSourceInput[];
};

const canonicalRecords = [
  ...canonicalPart01,
  ...canonicalPart02,
  ...canonicalPart03,
  ...canonicalPart04,
  ...canonicalPart05,
  ...canonicalPart06,
  ...canonicalPart07,
  ...canonicalPart08,
  ...canonicalPart09,
] as unknown as readonly CanonicalServiceInput[];

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REVIEWER = "OpenAI Deep Research synthesis; repository clinical-owner sign-off pending";

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export function serviceIdentityKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:service|services|program|programme|network|facility|western australia|wa)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sourceEvidence(record: CanonicalServiceInput): CatalogServiceEvidenceSource[] {
  return record.sources.map((source) => ({
    sourceId: source.id,
    title: source.title,
    issuer: source.issuer,
    sourceClass: source.class,
    jurisdiction: record.jurisdiction,
    publicationOrEffectiveDate: source.date,
    url: source.url,
    accessedAt: source.accessed,
    limitations: source.limitations || undefined,
  }));
}

function recordClaims(record: CanonicalServiceInput): CatalogServiceClaim[] {
  const sourceIds = record.sources.map((source) => source.id);
  const claim = (field: string, text: string, riskLevel: CatalogServiceClaim["riskLevel"]): CatalogServiceClaim => ({
    claimId: `${record.id}.${field}`,
    field,
    text,
    sourceIds,
    verifiedAt: record.verified,
    nextReviewAt: record.review,
    reviewer: REVIEWER,
    confidence: record.verification === "verified_current_core" ? "high" : "medium",
    riskLevel,
    conflictStatus: record.issues.length ? "unresolved" : "none",
  });

  return [
    claim("availability_status", record.status, "critical"),
    claim("contacts", record.contacts.map((contact) => contact.value).join("; "), "critical"),
    claim("hours", record.hours.display, "critical"),
    claim("catchments", record.catchments.join("; "), "high"),
    claim("population", record.population, "high"),
    claim("best_use", record.bestUse, "moderate"),
  ];
}

function canonicalTags(record: CanonicalServiceInput): CatalogServiceTags {
  const groupSet = new Set(record.groups);
  const isAod = groupSet.has("alcohol_other_drugs");
  const isHousing = groupSet.has("homelessness_housing");
  return {
    catchments: [...record.catchments],
    age_groups: [...record.ages],
    setting_flags: unique([
      record.tier === "A_immediate" ? "digital_phone" : "community",
      groupSet.has("public_mental_health") ? "public" : "general",
    ]),
    acuity_flags: [
      record.tier === "A_immediate" ? "crisis_high" : record.tier === "B_common_referral" ? "moderate" : "supportive",
    ],
    substance_flags: [isAod ? "aod" : "general"],
    housing_flags: [isHousing ? "housing_support" : "general"],
    specialist_groups: [...record.groups],
    availability_flags: [record.status],
  };
}

function verificationFlags(record: CanonicalServiceInput): string[] {
  const flags = [...record.issues];
  if (record.status === "planned") flags.push("Planned service — not currently referable");
  if (record.status === "temporarily_unavailable") flags.push("Temporarily unavailable — confirm an alternative route");
  if (record.status === "closed") flags.push("Closed service — do not refer");
  if (record.status === "superseded") flags.push("Superseded service — use the replacement pathway");
  if (record.hours.verification_status === "unable_to_verify") flags.push("Hours could not be verified");
  return unique(flags);
}

function structuredRoutes(record: CanonicalServiceInput): CatalogServiceReferralRoute[] {
  return record.routes.map((route) => ({
    routeType: route.route_type,
    summary: route.summary,
    selfReferral: route.self_referral,
    requiredDocuments: [...route.required_documents],
  }));
}

function structuredContacts(record: CanonicalServiceInput): CatalogServiceStructuredContact[] {
  return record.contacts.map((contact) => ({ ...contact }));
}

function structuredHours(record: CanonicalServiceInput): CatalogServiceStructuredHours {
  return {
    display: record.hours.display,
    timezone: record.hours.timezone,
    verificationStatus: record.hours.verification_status,
  };
}

function canonicalToCatalogService(record: CanonicalServiceInput): CatalogService {
  const evidence = sourceEvidence(record);
  const contactDetails = record.contacts
    .map((contact) => contact.value)
    .filter(Boolean)
    .join("; ");
  const route = record.routes[0]?.summary || "Contact service and confirm the referral pathway";
  const exclusions = record.notFor.join(" | ");
  const provider = evidence[0]?.issuer ?? "Authoritative service source";

  return {
    id: record.id,
    stable_id: record.id,
    name: record.name,
    aliases: [...record.aliases],
    sections: [record.category],
    inclusion_criteria: `${record.bestUse} | Patient group: ${record.population}`,
    exclusions,
    referral_details: [
      `Contact: ${contactDetails || "Confirm locally"}`,
      `Referral pathway: ${route}`,
      `Hours: ${record.hours.display}`,
    ].join(" | "),
    tags: canonicalTags(record),
    source_files: [],
    provider,
    region_catchment: record.catchments.join("; "),
    patient_group: record.population,
    best_use_indication: record.bestUse,
    referral_pathway: route,
    eligibility_referral_criteria: record.population,
    exclusion_rejection_criteria: exclusions,
    contact_details: contactDetails,
    hours: record.hours.display,
    cost_funding: "",
    discharge_planning_usefulness: record.bestUse,
    confidence: record.verification === "verified_current_core" ? "High" : "Medium",
    confidence_rank: record.verification === "verified_current_core" ? 3 : 2,
    public_source_urls: evidence.map((source) => source.url),
    service_website: record.website ?? undefined,
    evidence_sources: evidence,
    web_review_status: `Verified ${record.verified}; next review ${record.review}`,
    source_documents: evidence.map((source) => source.sourceId),
    source_row_count: 1,
    merged_aliases: unique([record.name, ...record.aliases]),
    source_table_lines: "",
    deep_research_citation_tokens: "",
    verification_flags: verificationFlags(record),
    analyst_notes: record.issues.join(" | "),
    search_text: [
      record.name,
      ...record.aliases,
      record.category,
      ...record.groups,
      ...record.catchments,
      record.population,
      record.bestUse,
      ...record.notFor,
      ...record.intents,
      contactDetails,
    ].join("\n"),
    canonical_name_key: slug(record.name),
    availability_status: record.status,
    availability_note: record.statusNote,
    presentation_tier: record.tier,
    verification_status: record.verification,
    last_verified: record.verified,
    next_review_at: record.review,
    not_for: [...record.notFor],
    referral_routes: structuredRoutes(record),
    structured_contacts: structuredContacts(record),
    structured_hours: structuredHours(record),
    claims: recordClaims(record),
    specialist_groups: [...record.groups],
    quick_route_intents: [...record.intents],
    superseded_by: record.supersededBy ?? undefined,
    unresolved_issues: [...record.issues],
    jurisdiction: record.jurisdiction,
  };
}

function mergeTags(left: CatalogServiceTags, right: CatalogServiceTags): CatalogServiceTags {
  return {
    catchments: unique([...left.catchments, ...right.catchments]),
    age_groups: unique([...left.age_groups, ...right.age_groups]),
    setting_flags: unique([...left.setting_flags, ...right.setting_flags]),
    acuity_flags: unique([...left.acuity_flags, ...right.acuity_flags]),
    substance_flags: unique([...left.substance_flags, ...right.substance_flags]),
    housing_flags: unique([...left.housing_flags, ...right.housing_flags]),
    specialist_groups: unique([...(left.specialist_groups ?? []), ...(right.specialist_groups ?? [])]),
    availability_flags: unique([...(left.availability_flags ?? []), ...(right.availability_flags ?? [])]),
  };
}

function legacyKeys(service: CatalogService): Set<string> {
  return new Set(
    [service.name, service.canonical_name_key, ...(service.aliases ?? []), ...service.merged_aliases]
      .flatMap((value) => [serviceIdentityKey(value), slug(value)])
      .filter(Boolean),
  );
}

function canonicalKeys(record: CanonicalServiceInput): Set<string> {
  return new Set(
    [record.name, ...record.aliases, ...record.match]
      .flatMap((value) => [serviceIdentityKey(value), slug(value)])
      .filter(Boolean),
  );
}

function matchingCanonicalRecord(
  legacy: CatalogService,
  recordsByKey: ReadonlyMap<string, readonly CanonicalServiceInput[]>,
  usedIds: ReadonlySet<string>,
): CanonicalServiceInput | undefined {
  // Exact name matches first: two legacy names can reduce to the same identity key (S211
  // "Youth Hospital in the Home" and S212 "Youth Hospital in the Home (Youth-HITH)"), and
  // which record claimed the shared key must not depend on the snapshot's array order.
  const exactKeys = [slug(legacy.name), legacy.canonical_name_key].filter(Boolean);
  const candidates = [...new Set([...exactKeys, ...legacyKeys(legacy)])].flatMap((key) => recordsByKey.get(key) ?? []);
  return candidates.find((record) => !usedIds.has(record.id));
}

function mergeCanonicalIntoLegacy(legacy: CatalogService, record: CanonicalServiceInput): CatalogService {
  const canonical = canonicalToCatalogService(record);
  return {
    ...legacy,
    ...canonical,
    id: legacy.id,
    stable_id: record.id,
    provider: canonical.provider || legacy.provider,
    cost_funding: legacy.cost_funding,
    source_files: legacy.source_files,
    source_row_count: legacy.source_row_count,
    source_table_lines: legacy.source_table_lines,
    tags: mergeTags(legacy.tags, canonical.tags),
    merged_aliases: unique([legacy.name, ...legacy.merged_aliases, record.name, ...record.aliases]),
    canonical_name_key: legacy.canonical_name_key || canonical.canonical_name_key,
  };
}

function legacyEvidence(service: CatalogService): CatalogServiceEvidenceSource[] {
  return service.public_source_urls
    .filter((url) => URL_PATTERN.test(url))
    .map((url, index) => ({
      sourceId: `legacy-${service.id}-${index + 1}`,
      title: service.sections[0] ?? `${service.name} source`,
      issuer: "Legacy catalogue source",
      sourceClass: "Legacy unreviewed source",
      jurisdiction: "Western Australia",
      publicationOrEffectiveDate: "Unknown",
      url,
      accessedAt: "Unknown",
      limitations: "Current operational claims were not independently re-verified in the canonical review.",
    }));
}

function quarantineLegacyService(service: CatalogService): CatalogService {
  const sectionGroups = service.sections.map(slug).filter(Boolean);
  // A legacy record that duplicates a canonical record names it in `superseded_by` and reads as
  // superseded, so it can never be pinned or read as a second, unverified copy of that service.
  const supersededBy = service.superseded_by?.trim();
  const availability = supersededBy ? "superseded" : "unknown";
  return {
    ...service,
    stable_id: service.stable_id || service.id,
    aliases: service.aliases ?? [],
    tags: {
      ...service.tags,
      specialist_groups: unique([...(service.tags.specialist_groups ?? []), ...sectionGroups]),
      availability_flags: unique([...(service.tags.availability_flags ?? []), availability]),
    },
    availability_status: availability,
    availability_note: supersededBy
      ? `Legacy catalogue record superseded by ${supersededBy}`
      : "Legacy catalogue record; active status not re-verified",
    verification_status: "legacy_unverified",
    not_for: service.not_for ?? [],
    evidence_sources: service.evidence_sources?.length ? service.evidence_sources : legacyEvidence(service),
    claims: service.claims ?? [],
    specialist_groups: unique([...(service.specialist_groups ?? []), ...sectionGroups]),
    quick_route_intents: service.quick_route_intents ?? [],
    unresolved_issues: unique([
      ...(service.unresolved_issues ?? []),
      "Legacy catalogue record — current contact, hours, eligibility, catchment and availability require re-verification.",
    ]),
    verification_flags: unique([
      ...service.verification_flags,
      "Legacy catalogue record — verify current operational details before use",
    ]),
  };
}

export function mergeCanonicalCatalogServices(legacyServices: readonly CatalogService[]): CatalogService[] {
  const recordsByKey = new Map<string, CanonicalServiceInput[]>();
  for (const record of canonicalRecords) {
    for (const key of canonicalKeys(record)) recordsByKey.set(key, [...(recordsByKey.get(key) ?? []), record]);
  }

  const usedIds = new Set<string>();
  const merged = legacyServices.map((legacy) => {
    const match = matchingCanonicalRecord(legacy, recordsByKey, usedIds);
    if (!match) return quarantineLegacyService(legacy);
    usedIds.add(match.id);
    return mergeCanonicalIntoLegacy(legacy, match);
  });

  const usedSlugs = new Set(merged.map((service) => service.canonical_name_key || slug(service.name)));
  for (const record of canonicalRecords) {
    if (usedIds.has(record.id)) continue;
    const service = canonicalToCatalogService(record);
    const desiredSlug = service.canonical_name_key;
    if (usedSlugs.has(desiredSlug)) service.canonical_name_key = `${desiredSlug}-${record.id.toLowerCase()}`;
    usedSlugs.add(service.canonical_name_key);
    merged.push(service);
  }
  return merged;
}

export function canonicalDatasetMetadata(): Record<string, unknown> {
  return {
    schema_version: "2026-09-01.services-governance.1",
    evidence_cutoff: "2026-08-23",
    canonical_record_count: canonicalRecords.length,
    clinical_owner_sign_off: "pending",
  };
}

export function canonicalServiceRecords(): readonly CanonicalServiceInput[] {
  return canonicalRecords;
}

export function canonicalServiceValidationErrors(records = canonicalRecords): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) errors.push(`Duplicate stable ID: ${record.id}`);
    ids.add(record.id);
    if (!record.name.trim()) errors.push(`${record.id} has no name`);
    if (!ISO_DATE_PATTERN.test(record.verified)) errors.push(`${record.id} has invalid verified date`);
    if (!ISO_DATE_PATTERN.test(record.review)) errors.push(`${record.id} has invalid review date`);
    if (record.review <= record.verified) errors.push(`${record.id} review date is not later than verified date`);
    if (record.sources.length === 0) errors.push(`${record.id} has no authoritative source`);
    for (const source of record.sources) {
      if (!source.id.trim()) errors.push(`${record.id} has a source without an ID`);
      if (!URL_PATTERN.test(source.url)) errors.push(`${record.id} has invalid source URL ${source.url}`);
      if (!ISO_DATE_PATTERN.test(source.accessed)) errors.push(`${record.id} has invalid source access date`);
    }
    if (record.tier === "A_immediate" && record.status === "active") {
      if (!record.contacts.some((contact) => contact.value.trim())) errors.push(`${record.id} has no urgent contact`);
      if (!record.hours.display.trim()) errors.push(`${record.id} has no urgent hours`);
      if (record.verification !== "verified_current_core") errors.push(`${record.id} urgent route is not verified`);
    }
    if (
      record.tier === "A_immediate" &&
      record.notFor.some((value) => /non-crisis routine referral only/i.test(value))
    ) {
      errors.push(`${record.id} carries a contradictory non-crisis exclusion`);
    }
  }
  return errors;
}

const canonicalErrors = canonicalServiceValidationErrors();
if (canonicalErrors.length) throw new Error(`Invalid canonical services data:\n${canonicalErrors.join("\n")}`);
