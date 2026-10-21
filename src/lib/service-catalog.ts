import servicesSnapshot from "../../data/services-snapshot.json";
import { mergeCanonicalCatalogServices } from "@/lib/service-governance";

export type CatalogServiceTags = {
  catchments: string[];
  age_groups: string[];
  setting_flags: string[];
  acuity_flags: string[];
  substance_flags: string[];
  housing_flags: string[];
  specialist_groups?: string[];
  availability_flags?: string[];
};

export type CatalogServiceEvidenceSource = {
  sourceId: string;
  title: string;
  issuer: string;
  sourceClass: string;
  jurisdiction: string;
  publicationOrEffectiveDate: string;
  url: string;
  accessedAt: string;
  limitations?: string;
};

export type CatalogServiceClaim = {
  claimId: string;
  field: string;
  text: string;
  sourceIds: string[];
  verifiedAt: string;
  nextReviewAt: string;
  reviewer: string;
  confidence: "high" | "medium" | "low";
  riskLevel: "critical" | "high" | "moderate" | "low";
  conflictStatus: "none" | "unresolved" | "resolved";
};

export type CatalogServiceReferralRoute = {
  routeType: string;
  summary: string;
  selfReferral: boolean | null;
  requiredDocuments: string[];
};

export type CatalogServiceStructuredContact = {
  label: string;
  value: string;
  kind: string;
};

export type CatalogServiceStructuredHours = {
  display: string;
  timezone: string;
  verificationStatus: "verified" | "unable_to_verify";
};

export type CatalogService = {
  id: string;
  stable_id?: string;
  name: string;
  aliases?: string[];
  sections: string[];
  inclusion_criteria: string;
  exclusions: string;
  referral_details: string;
  tags: CatalogServiceTags;
  source_files: string[];
  provider: string;
  region_catchment: string;
  patient_group: string;
  best_use_indication: string;
  referral_pathway: string;
  eligibility_referral_criteria: string;
  exclusion_rejection_criteria: string;
  contact_details: string;
  hours: string;
  cost_funding: string;
  discharge_planning_usefulness: string;
  confidence: string;
  confidence_rank?: number;
  public_source_urls: string[];
  service_website?: string;
  evidence_sources?: CatalogServiceEvidenceSource[];
  web_review_status: string;
  source_documents: string[];
  source_row_count?: number;
  merged_aliases: string[];
  source_table_lines: string;
  deep_research_citation_tokens: string;
  verification_flags: string[];
  analyst_notes: string;
  search_text: string;
  canonical_name_key: string;
  availability_status?: string;
  availability_note?: string;
  presentation_tier?: string;
  verification_status?: string;
  last_verified?: string;
  next_review_at?: string;
  not_for?: string[];
  referral_routes?: CatalogServiceReferralRoute[];
  structured_contacts?: CatalogServiceStructuredContact[];
  structured_hours?: CatalogServiceStructuredHours;
  claims?: CatalogServiceClaim[];
  specialist_groups?: string[];
  quick_route_intents?: string[];
  superseded_by?: string;
  unresolved_issues?: string[];
  jurisdiction?: string;
};

export type ServiceCatalogSnapshot = {
  source?: string[];
  service_count: number;
  package?: Record<string, unknown>;
  services: CatalogService[];
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(\+?\d[\d ()-]{6,}\d)/g;

let cachedSnapshot: ServiceCatalogSnapshot | null = null;

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => entry.length > 0);
}

function toCleanText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  return clean.length > 0 ? clean : fallback;
}

function toCleanNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toCleanOptionalText(value: unknown): string | undefined {
  const clean = toCleanText(value);
  return clean || undefined;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function normalizeEvidenceSources(value: unknown): CatalogServiceEvidenceSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const source = toRecord(entry);
    if (!source) return [];
    const sourceId = toCleanText(source.sourceId);
    const title = toCleanText(source.title);
    const issuer = toCleanText(source.issuer);
    const sourceClass = toCleanText(source.sourceClass);
    const jurisdiction = toCleanText(source.jurisdiction);
    const publicationOrEffectiveDate = toCleanText(source.publicationOrEffectiveDate);
    const url = toCleanText(source.url);
    const accessedAt = toCleanText(source.accessedAt);
    if (
      !sourceId ||
      !title ||
      !issuer ||
      !sourceClass ||
      !jurisdiction ||
      !publicationOrEffectiveDate ||
      !url ||
      !accessedAt
    ) {
      return [];
    }
    return [
      {
        sourceId,
        title,
        issuer,
        sourceClass,
        jurisdiction,
        publicationOrEffectiveDate,
        url,
        accessedAt,
        limitations: toCleanOptionalText(source.limitations),
      },
    ];
  });
}

function normalizeServiceId(value: unknown, fallback: string): string {
  const clean = toCleanText(value, fallback);
  if (/^S\d{3}$/i.test(clean)) return clean.toUpperCase();
  return clean.toLowerCase().replace(/\s+/g, "-");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractEmails(text: string): string[] {
  return unique((text.match(EMAIL_PATTERN) ?? []).map((value) => value.trim()));
}

// PHONE_PATTERN starts at a digit, so a bracketed area code ("(08) 9442 5000") came out with
// its opening bracket lost ("08) 9442 5000"). Restore that bracket when the text has it, and
// drop any bracket still unpaired. Display only: the digits, and so every tel: link, are unchanged.
function balancePhoneBrackets(value: string, text: string, index: number): string {
  const restored = /^\d+\)/.test(value) && text[index - 1] === "(" ? `(${value}` : value;
  const opens = (restored.match(/\(/g) ?? []).length;
  const closes = (restored.match(/\)/g) ?? []).length;
  if (opens === closes) return restored;
  return restored
    .replace(/[()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// A number the record labels as a fax ("fax 6372 1599", "Fax: (08) 6458 1111") is not a phone.
const FAX_LABEL_BEFORE = /\bfax[:.]?\s*\(?$/i;

export function extractPhones(text: string): string[] {
  return unique(
    [...text.matchAll(PHONE_PATTERN)]
      .filter((match) => !FAX_LABEL_BEFORE.test(text.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0)))
      .map((match) => balancePhoneBrackets(match[0].replace(/\s+/g, " ").trim(), text, match.index ?? 0))
      .filter((value) => value.length >= 8),
  );
}

export function normalizeCatalogService(raw: unknown, index: number): CatalogService {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const fallbackId = `service-${index + 1}`;
  const tagsSource =
    typeof source.tags === "object" && source.tags !== null
      ? (source.tags as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  return {
    id: normalizeServiceId(source.id, fallbackId),
    name: toCleanText(source.name, `Untitled Service ${index + 1}`),
    sections: toStringArray(source.sections),
    inclusion_criteria: toCleanText(source.inclusion_criteria),
    exclusions: toCleanText(source.exclusions),
    referral_details: toCleanText(source.referral_details),
    tags: {
      catchments: toStringArray(tagsSource.catchments),
      age_groups: toStringArray(tagsSource.age_groups),
      setting_flags: toStringArray(tagsSource.setting_flags),
      acuity_flags: toStringArray(tagsSource.acuity_flags),
      substance_flags: toStringArray(tagsSource.substance_flags),
      housing_flags: toStringArray(tagsSource.housing_flags),
      specialist_groups: toStringArray(tagsSource.specialist_groups),
      availability_flags: toStringArray(tagsSource.availability_flags),
    },
    stable_id: toCleanOptionalText(source.stable_id),
    aliases: toStringArray(source.aliases),
    source_files: toStringArray(source.source_files),
    provider: toCleanText(source.provider),
    region_catchment: toCleanText(source.region_catchment),
    patient_group: toCleanText(source.patient_group),
    best_use_indication: toCleanText(source.best_use_indication),
    referral_pathway: toCleanText(source.referral_pathway),
    eligibility_referral_criteria: toCleanText(source.eligibility_referral_criteria),
    exclusion_rejection_criteria: toCleanText(source.exclusion_rejection_criteria),
    contact_details: toCleanText(source.contact_details),
    hours: toCleanText(source.hours),
    cost_funding: toCleanText(source.cost_funding),
    discharge_planning_usefulness: toCleanText(source.discharge_planning_usefulness),
    confidence: toCleanText(source.confidence),
    confidence_rank: toCleanNumber(source.confidence_rank),
    public_source_urls: toStringArray(source.public_source_urls),
    service_website: toCleanOptionalText(source.service_website),
    evidence_sources: normalizeEvidenceSources(source.evidence_sources),
    web_review_status: toCleanText(source.web_review_status),
    source_documents: toStringArray(source.source_documents),
    source_row_count: toCleanNumber(source.source_row_count),
    merged_aliases: toStringArray(source.merged_aliases),
    source_table_lines: toCleanText(source.source_table_lines),
    deep_research_citation_tokens: toCleanText(source.deep_research_citation_tokens),
    verification_flags: toStringArray(source.verification_flags),
    analyst_notes: toCleanText(source.analyst_notes),
    search_text: toCleanText(source.search_text),
    canonical_name_key: toCleanText(source.canonical_name_key),
    availability_status: toCleanOptionalText(source.availability_status),
    availability_note: toCleanOptionalText(source.availability_note),
    presentation_tier: toCleanOptionalText(source.presentation_tier),
    verification_status: toCleanOptionalText(source.verification_status),
    last_verified: toCleanOptionalText(source.last_verified),
    next_review_at: toCleanOptionalText(source.next_review_at),
    not_for: toStringArray(source.not_for),
    specialist_groups: toStringArray(source.specialist_groups),
    quick_route_intents: toStringArray(source.quick_route_intents),
    superseded_by: toCleanOptionalText(source.superseded_by),
    unresolved_issues: toStringArray(source.unresolved_issues),
    jurisdiction: toCleanOptionalText(source.jurisdiction),
  };
}

export function normalizeCatalogServices(rawCatalog: unknown): CatalogService[] {
  const source =
    typeof rawCatalog === "object" && rawCatalog !== null
      ? (rawCatalog as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const services = Array.isArray(source.services) ? source.services : [];
  const seenIds = new Map<string, number>();

  return services.map((service, index) => {
    const normalized = normalizeCatalogService(service, index);
    const seenCount = seenIds.get(normalized.id) ?? 0;
    seenIds.set(normalized.id, seenCount + 1);

    if (seenCount === 0) return normalized;
    return {
      ...normalized,
      id: `${normalized.id}-${seenCount + 1}`,
    };
  });
}

export function loadServicesSnapshot(): ServiceCatalogSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  const parsed = servicesSnapshot as ServiceCatalogSnapshot;
  const services = mergeCanonicalCatalogServices(normalizeCatalogServices(parsed));
  cachedSnapshot = {
    ...parsed,
    service_count: services.length,
    services,
  };
  return cachedSnapshot;
}

export function catalogServiceSlug(service: CatalogService): string {
  const key = service.canonical_name_key.trim().toLowerCase();
  if (key) return key;
  return service.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function catalogPayloadBySlug(snapshot = loadServicesSnapshot()): Map<string, CatalogService> {
  const map = new Map<string, CatalogService>();
  for (const service of snapshot.services) {
    map.set(catalogServiceSlug(service), service);
  }
  return map;
}
