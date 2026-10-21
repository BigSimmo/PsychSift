import type { CatalogService } from "@/lib/service-catalog";
import { catalogServiceSlug, extractEmails, extractPhones } from "@/lib/service-catalog";
import {
  compactBestUseTitle,
  compactCatalogField,
  parseLabeledReferralDetails,
  splitCatalogClauses,
} from "@/lib/compact-best-use-title";
import type {
  ServiceChipTone,
  ServiceContact,
  ServiceCriterion,
  ServiceInfoRow,
  ServiceRecord,
  ServiceSource,
  ServiceStatusChip,
  ServiceSummaryCard,
} from "@/lib/services";

export { compactBestUseTitle, compactCatalogField, parseLabeledReferralDetails, splitCatalogClauses };

// The trailing `[^|]*` (not `.*`) matters: these clauses must not cross a `|`
// clause boundary. Catalogue fields like referral_pathway are pipe-joined
// blobs of several source paraphrases — one placeholder clause ("Not
// publicly stated on summary page | ... | Referral must come from public or
// private mental health service") must not make the WHOLE field look
// unknown when a later clause is concrete. Per-clause placeholder filtering
// already happens downstream in compactCatalogField/splitCatalogParts; this
// gate only short-circuits a field that is unknown in its entirety.
const UNKNOWN_VALUES =
  /^(?:not publicly stated(?:\s+(?:in|by|on)\b[^|]*)?|not applicable|none|n\/a|unknown|does not specify\b[^|]*)$/i;

const CARD_MAX = 120;
const ROW_MAX = 160;

function isUnknown(value: string | undefined | null) {
  if (!value?.trim()) return true;
  return UNKNOWN_VALUES.test(value.trim());
}

function cleanField(value: string | undefined | null) {
  if (isUnknown(value)) return undefined;
  return value?.trim() || undefined;
}

/** Clean + compact a catalogue field for UI; returns undefined when empty/unknown. */
function displayField(value: string | undefined | null, maxLength = CARD_MAX): string | undefined {
  const cleaned = cleanField(value);
  if (!cleaned) return undefined;
  const compacted = compactCatalogField(cleaned, maxLength);
  return compacted || undefined;
}

function isLegacyUnverified(service: CatalogService): boolean {
  return service.verification_status === "legacy_unverified";
}

function confidenceTone(confidence: string): ServiceChipTone {
  if (confidence === "High") return "success";
  if (confidence === "Medium") return "warning";
  if (confidence === "Low") return "danger";
  return "neutral";
}

function acuityChipTone(flag: string): ServiceChipTone {
  if (flag === "crisis_high" || flag === "high") return "danger";
  if (flag === "moderate") return "warning";
  return "info";
}

function acuityLabel(flag: string) {
  if (flag === "crisis_high") return "Crisis / urgent";
  if (flag === "high") return "High acuity";
  if (flag === "moderate") return "Moderate acuity";
  if (flag === "supportive") return "Supportive";
  return flag.replace(/_/g, " ");
}

function availabilityLabel(status: string) {
  if (status === "active") return "Active";
  if (status === "planned") return "Planned — not open";
  if (status === "temporarily_unavailable") return "Temporarily unavailable";
  if (status === "closed") return "Closed";
  if (status === "superseded") return "Superseded";
  if (status === "unknown") return "Availability unverified";
  return status.replace(/_/g, " ");
}

function availabilityTone(status: string): ServiceChipTone {
  if (status === "active") return "success";
  if (status === "planned" || status === "temporarily_unavailable" || status === "unknown") return "warning";
  if (status === "closed" || status === "superseded") return "danger";
  return "neutral";
}

function isReviewOverdue(nextReviewAt: string | undefined): boolean {
  if (!nextReviewAt?.trim()) return true;
  const timestamp = Date.parse(`${nextReviewAt}T23:59:59Z`);
  if (!Number.isFinite(timestamp)) return true;
  return timestamp < Date.now();
}

function sourceStatusForService(service: CatalogService): string {
  const availability = service.availability_status;
  if (availability && availability !== "active") return "Not currently referable";

  const hasDurableSource = (service.evidence_sources?.length ?? 0) > 0 || service.public_source_urls.length > 0;
  const hasVerifiedDate = Boolean(service.last_verified?.trim());
  const currentReview = !isReviewOverdue(service.next_review_at);

  if (
    service.confidence === "High" &&
    hasDurableSource &&
    hasVerifiedDate &&
    currentReview &&
    service.verification_flags.length === 0
  ) {
    return "Source checked";
  }
  if (
    service.verification_flags.length > 0 ||
    service.confidence === "Medium" ||
    service.confidence === "Low" ||
    !hasDurableSource ||
    !hasVerifiedDate ||
    !currentReview
  ) {
    return "Local confirmation required";
  }
  return "Review required";
}

function resolvePathway(service: CatalogService): string | undefined {
  const labeled = parseLabeledReferralDetails(service.referral_details);
  return displayField(service.referral_pathway) ?? displayField(labeled.pathway) ?? undefined;
}

function contactKind(kind: string | undefined, value: string): ServiceContact["kind"] {
  const normalized = kind?.toLowerCase() ?? "";
  if (normalized.includes("email") || extractEmails(value).length > 0) return "email";
  if (normalized.includes("phone") || extractPhones(value).length > 0) return "phone";
  if (normalized.includes("web") || /^https?:\/\//i.test(value)) return "web";
  if (normalized.includes("text")) return "text";
  return "unknown";
}

function buildContacts(service: CatalogService): ServiceContact[] {
  const contacts: ServiceContact[] = [];
  const hours = displayField(service.hours, ROW_MAX);

  if ((service.structured_contacts?.length ?? 0) > 0) {
    for (const contact of service.structured_contacts ?? []) {
      const kind = contactKind(contact.kind, contact.value);
      // Some governed structured contacts pack multiple destinations into one string
      // (e.g. MHERL's Metro/Peel numbers, the AOD support line's Metro/Country numbers).
      // A single "phone" contact there would strip to a concatenated, undialable tel:
      // link. Split into one contact per number actually found — never fabricate a
      // number, so a value with 0 or 1 extractable phones is left exactly as before.
      if (kind === "phone") {
        const phones = extractPhones(contact.value);
        if (phones.length > 1) {
          phones.forEach((phone, index) => {
            contacts.push({
              label: contact.label ? `${contact.label} ${index + 1}` : `Phone ${index + 1}`,
              value: phone,
              detail: hours,
              kind: "phone",
            });
          });
          continue;
        }
      }
      contacts.push({
        label: contact.label || (kind === "unknown" ? "Contact" : kind[0].toUpperCase() + kind.slice(1)),
        value: contact.value,
        detail: kind === "phone" ? hours : undefined,
        kind,
      });
    }
  } else {
    const contactBlob = [service.contact_details, service.referral_details].filter(Boolean).join(" ");
    const phones = extractPhones(contactBlob);
    const emails = extractEmails(contactBlob);

    for (const phone of phones) {
      contacts.push({
        label: phones.length > 1 ? `Phone ${contacts.filter((entry) => entry.kind === "phone").length + 1}` : "Phone",
        value: phone,
        detail: hours,
        kind: "phone",
      });
    }

    for (const email of emails) {
      contacts.push({
        label: "Email",
        value: email,
        kind: "email",
      });
    }
  }

  const serviceWebsite = service.service_website?.trim();
  if (serviceWebsite && !contacts.some((contact) => contact.kind === "web" && contact.value === serviceWebsite)) {
    contacts.push({
      label: "Website",
      value: serviceWebsite,
      detail: "Service website",
      kind: "web",
    });
  }

  if (contacts.length === 0) {
    const contactValue = displayField(service.contact_details, ROW_MAX);
    if (contactValue) {
      contacts.push({
        label: "Contact",
        value: contactValue,
        kind: "unknown",
      });
    }
  }

  return contacts;
}

function buildStatusChips(service: CatalogService): ServiceStatusChip[] {
  const chips: ServiceStatusChip[] = [];

  if (service.availability_status) {
    chips.push({
      label: availabilityLabel(service.availability_status),
      tone: availabilityTone(service.availability_status),
    });
  }

  for (const flag of service.tags.acuity_flags) {
    chips.push({ label: acuityLabel(flag), tone: acuityChipTone(flag) });
  }

  // A legacy record's confidence is the old import's own field, not a verification result, so it
  // carries no confidence chip; "Verify before use" below covers it.
  if (service.confidence && !isLegacyUnverified(service)) {
    chips.push({ label: `${service.confidence} confidence`, tone: confidenceTone(service.confidence) });
  }

  if (
    service.verification_flags.length > 0 ||
    service.verification_status === "legacy_unverified" ||
    isReviewOverdue(service.next_review_at)
  ) {
    chips.push({ label: "Verify before use", tone: "warning" });
  }

  for (const section of service.sections.slice(0, 2)) {
    chips.push({ label: section, tone: "info" });
  }

  return chips;
}

function buildSummaryCards(service: CatalogService): ServiceSummaryCard[] {
  const cards: ServiceSummaryCard[] = [];
  const pathway = resolvePathway(service);

  if (pathway) {
    cards.push({
      id: "route",
      label: "Route",
      title: pathway,
      detail: displayField(service.patient_group) ?? displayField(service.region_catchment),
    });
  }

  const eligibility = displayField(service.eligibility_referral_criteria);
  if (eligibility) {
    cards.push({
      id: "eligibility",
      label: "Eligibility",
      title: eligibility,
      detail: displayField(service.patient_group),
    });
  }

  const cost = displayField(service.cost_funding);
  if (cost) {
    cards.push({
      id: "cost",
      label: "Cost",
      title: cost,
      detail: undefined,
    });
  }

  const bestUseRaw = cleanField(service.best_use_indication) ?? cleanField(service.discharge_planning_usefulness);
  if (bestUseRaw) {
    const title = compactCatalogField(bestUseRaw, CARD_MAX);
    if (title) {
      const patientGroup = displayField(service.patient_group);
      const sectionDetail = displayField(service.sections[0]);
      cards.push({
        id: "best-use",
        label: "Best use",
        title,
        detail: patientGroup ?? sectionDetail,
      });
    }
  }

  return cards;
}

function buildReferralInfo(service: CatalogService): ServiceInfoRow[] {
  const rows: ServiceInfoRow[] = [];
  const labeled = parseLabeledReferralDetails(service.referral_details);

  const add = (label: string, value: string | undefined, maxLength = ROW_MAX) => {
    const compacted = displayField(value, maxLength);
    if (compacted) rows.push({ label, value: compacted });
  };

  const pathway = displayField(service.referral_pathway, ROW_MAX) ?? displayField(labeled.pathway, ROW_MAX);
  if (pathway) rows.push({ label: "Primary route", value: pathway });

  const phones = extractPhones([service.contact_details, service.referral_details].join(" "));
  phones.forEach((phone, index) => add(phones.length > 1 ? `Phone ${index + 1}` : "Phone", phone));

  const emails = extractEmails([service.contact_details, service.referral_details].join(" "));
  emails.forEach((email) => add("Email", email));

  add("Provider", cleanField(service.provider) ?? labeled.provider);
  add("Region", cleanField(service.region_catchment) ?? labeled.region);
  add("Patient group", cleanField(service.patient_group) ?? labeled.patientGroup);
  add("Hours", cleanField(service.hours) ?? labeled.hours);
  add("Cost / funding", cleanField(service.cost_funding) ?? labeled.cost);

  const exclusions = splitCatalogClauses(service.exclusion_rejection_criteria, ROW_MAX);
  if (exclusions.length > 0) rows.push({ label: "Exclusions", value: exclusions.join(" | ") });

  for (const route of service.referral_routes ?? []) {
    if (route.requiredDocuments.length > 0) {
      rows.push({ label: "What to send", value: route.requiredDocuments.join(", ") });
      break;
    }
  }

  add("Discharge planning", service.discharge_planning_usefulness);
  return rows;
}

function buildCriteria(service: CatalogService): ServiceCriterion[] {
  const criteria: ServiceCriterion[] = [];
  const seen = new Set<string>();

  const addCriterion = (label: string, tone: ServiceCriterion["tone"]) => {
    const compacted = displayField(label, CARD_MAX);
    if (!compacted) return;
    const key = `${tone}:${compacted.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    criteria.push({ label: compacted, tone });
  };

  const addMeet = (value: string | undefined, prefix?: string) => {
    const compacted = displayField(value, CARD_MAX);
    if (!compacted) return;
    addCriterion(prefix ? `${prefix}${compacted}` : compacted, "meet");
  };

  addMeet(service.best_use_indication);
  addMeet(service.referral_pathway, "Referral: ");

  for (const clause of splitCatalogClauses(service.eligibility_referral_criteria, CARD_MAX)) addMeet(clause);
  for (const clause of splitCatalogClauses(service.exclusion_rejection_criteria, CARD_MAX))
    addCriterion(clause, "reject");
  for (const clause of service.not_for ?? []) addCriterion(clause, "reject");

  const availability = service.availability_status;
  if (availability === "planned") addCriterion("Planned service — not currently referable", "reject");
  if (availability === "temporarily_unavailable")
    addCriterion("Temporarily unavailable — use an alternative pathway", "reject");
  if (availability === "closed") addCriterion("Closed service — do not refer", "reject");
  if (availability === "superseded") {
    addCriterion(
      service.superseded_by
        ? `Superseded — use ${service.superseded_by}`
        : "Superseded service — use the replacement pathway",
      "reject",
    );
  }

  for (const flag of service.verification_flags) addCriterion(flag, "caution");
  for (const issue of service.unresolved_issues ?? []) addCriterion(issue, "caution");

  if (isUnknown(service.hours) || service.structured_hours?.verificationStatus === "unable_to_verify") {
    addCriterion("Hours not confirmed", "caution");
  }
  if (isReviewOverdue(service.next_review_at)) addCriterion("Verification review is overdue", "caution");

  return criteria;
}

function flattenTags(service: CatalogService): string[] {
  return [
    ...service.sections,
    ...service.tags.age_groups,
    ...service.tags.setting_flags,
    ...service.tags.acuity_flags,
    ...service.tags.substance_flags,
    ...service.tags.housing_flags,
    ...(service.tags.specialist_groups ?? []),
    ...(service.tags.availability_flags ?? []),
    ...(service.specialist_groups ?? []),
    ...(service.quick_route_intents ?? []),
    ...(service.aliases ?? []),
    ...service.merged_aliases,
    service.id,
  ].filter((value, index, array) => value && array.indexOf(value) === index);
}

function buildCatchments(service: CatalogService): string[] {
  const catchments = [...service.tags.catchments];
  const region = displayField(service.region_catchment, ROW_MAX);
  if (region && !catchments.some((entry) => entry.toLowerCase() === region.toLowerCase())) catchments.unshift(region);
  return catchments;
}

function highestRisk(service: CatalogService): string | undefined {
  const risks = (service.claims ?? []).map((claim) => claim.riskLevel);
  if (risks.includes("critical")) return "critical";
  if (risks.includes("high")) return "high";
  if (risks.includes("moderate")) return "moderate";
  if (risks.includes("low")) return "low";
  return undefined;
}

function buildSource(service: CatalogService): ServiceSource {
  const evidence = service.evidence_sources ?? [];
  const allUrls = evidence.length > 0 ? evidence.map((source) => source.url) : service.public_source_urls;
  const sourceNames = evidence.map((source) => `${source.issuer}: ${source.title}`);
  const notes = [
    ...service.verification_flags,
    ...sourceNames,
    service.web_review_status,
    service.analyst_notes,
    ...(service.unresolved_issues ?? []),
    service.source_documents.length > 0 ? `Source documents: ${service.source_documents.join(", ")}` : "",
  ].filter(Boolean);

  return {
    label: evidence[0]?.title ?? service.sections[0] ?? "WA psychiatric services catalogue",
    status: sourceStatusForService(service),
    url: allUrls[0] ?? undefined,
    published: evidence[0]?.publicationOrEffectiveDate || undefined,
    reviewed: service.last_verified ? `Verified ${service.last_verified}` : service.web_review_status || undefined,
    notes,
    allUrls,
  };
}

export function catalogToServiceRecord(service: CatalogService): ServiceRecord {
  const contacts = buildContacts(service);
  const primaryContact = contacts.find((contact) => contact.kind === "phone") ?? contacts[0];
  const pathway = resolvePathway(service);
  const bestUse = displayField(service.best_use_indication) ?? displayField(service.discharge_planning_usefulness);
  const eligibility = displayField(service.eligibility_referral_criteria) ?? displayField(service.inclusion_criteria);
  const cost = displayField(service.cost_funding);
  const referral = pathway ?? displayField(service.referral_details, ROW_MAX);
  const verificationNotes = [...service.verification_flags, ...(service.unresolved_issues ?? [])];

  return {
    slug: catalogServiceSlug(service),
    title: service.name,
    subtitle: bestUse ?? displayField(service.sections[0]) ?? undefined,
    statusChips: buildStatusChips(service),
    primaryContact,
    contacts,
    route: pathway,
    eligibility,
    cost,
    referral,
    location: displayField(service.region_catchment, ROW_MAX),
    summaryCards: buildSummaryCards(service),
    referralInfo: buildReferralInfo(service),
    bestUse,
    criteria: buildCriteria(service),
    verification: {
      locallyVerified: service.verification_status === "locally_confirmed",
      confidence: isLegacyUnverified(service)
        ? "Unknown"
        : ((service.confidence as "High" | "Medium" | "Low" | undefined) ?? "Unknown"),
      notes: verificationNotes.length > 0 ? verificationNotes : ["Verify locally before use"],
      availabilityStatus: service.availability_status ?? null,
      lastVerifiedAt: service.last_verified ?? null,
      nextReviewAt: service.next_review_at ?? null,
      reviewer: service.claims?.[0]?.reviewer ?? null,
      riskLevel: highestRisk(service) ?? null,
      unresolvedIssues: service.unresolved_issues ?? [],
    },
    tags: flattenTags(service),
    catchments: buildCatchments(service),
    catalogueLabel: service.sections[0] ?? "Catalogue service",
    navigatorQuery:
      cleanField(service.search_text) ?? `${service.name} ${service.provider} ${service.region_catchment}`,
    source: buildSource(service),
    catalogPayload: {
      tags: service.tags,
      stableId: service.stable_id ?? service.id,
      availabilityStatus: service.availability_status,
      referralRoutes: service.referral_routes ?? [],
      claims: service.claims ?? [],
    },
  };
}

export function mapCatalogToServiceRecords(services: CatalogService[]): ServiceRecord[] {
  const records: ServiceRecord[] = [];
  const seenSlugs = new Set<string>();

  for (const service of services) {
    const record = catalogToServiceRecord(service);
    if (!record.title.trim()) throw new Error(`Catalog service ${service.id} is missing a title.`);
    if (seenSlugs.has(record.slug)) throw new Error(`Duplicate service slug: ${record.slug}`);
    seenSlugs.add(record.slug);
    records.push(record);
  }

  return records;
}
