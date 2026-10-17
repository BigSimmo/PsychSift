import { normalizeSearchText, rankCatalogRecords } from "@/lib/catalog-search";
import { smartSearchExpansions } from "@/lib/smart-search-intent";
import { rankServiceUrgentRoutes } from "@/lib/service-urgent-routing";

export type ServiceChipTone = "danger" | "info" | "warning" | "success" | "neutral";
export type ServiceCriterionTone = "meet" | "caution" | "reject";

export type ServiceStatusChip = {
  label?: string | null;
  tone?: ServiceChipTone | null;
};

export type ServiceContact = {
  label: string;
  value?: string | null;
  detail?: string | null;
  kind: "phone" | "email" | "web" | "text" | "unknown";
};

export type ServiceSummaryCard = {
  id: string;
  label?: string | null;
  title?: string | null;
  detail?: string | null;
};

export type ServiceInfoRow = {
  label: string;
  value?: string | null;
};

export type ServiceCriterion = {
  label: string;
  tone: ServiceCriterionTone;
};

export type ServiceVerification = {
  locallyVerified?: boolean | null;
  confidence?: "High" | "Medium" | "Low" | "Unknown" | null;
  notes?: string[] | null;
  availabilityStatus?: string | null;
  lastVerifiedAt?: string | null;
  nextReviewAt?: string | null;
  reviewer?: string | null;
  riskLevel?: string | null;
  unresolvedIssues?: string[] | null;
};

export type ServiceSource = {
  label?: string | null;
  status?: string | null;
  url?: string | null;
  published?: string | null;
  reviewed?: string | null;
  notes?: string[] | null;
  allUrls?: string[] | null;
};

export type ServiceRecord = {
  slug: string;
  title: string;
  subtitle?: string;
  statusChips?: ServiceStatusChip[];
  primaryContact?: ServiceContact;
  contacts?: ServiceContact[];
  route?: string;
  eligibility?: string;
  cost?: string;
  referral?: string;
  location?: string;
  summaryCards?: ServiceSummaryCard[];
  referralInfo?: ServiceInfoRow[];
  bestUse?: string;
  criteria?: ServiceCriterion[];
  verification?: ServiceVerification;
  tags?: string[];
  catchments?: string[];
  catalogueLabel?: string;
  navigatorQuery?: string;
  source?: ServiceSource;
  /** Full source-specific payload retained in the registry JSONB column. */
  catalogPayload?: Record<string, unknown>;
};

export type ServiceSearchMatch = {
  service: ServiceRecord;
  score: number;
  reasons: string[];
};

// Words every service record shares, so a match on them says nothing about fit.
// "disorder" is the one that did the damage: it put eating-disorder services
// first for "panic disorder" (#CNCAFV). This only orders results; the "Best fit"
// badge is decided separately by src/lib/service-best-fit.ts.
const GENERIC_SERVICE_QUERY_TERMS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "or",
  "the",
  "to",
  "with",
  "service",
  "services",
  "mental",
  "health",
  "support",
  "help",
  "clinic",
  "clinics",
  "team",
  "program",
  "programme",
  "care",
  "treatment",
  "criteria",
  "disorder",
  "disorders",
  "wa",
  "perth",
]);

// Condition words no service record uses, mapped to the family word records do
// use. Deliberately short: only uncontroversial parent terms belong here.
const SERVICE_CONDITION_FAMILIES: Record<string, readonly string[]> = {
  panic: ["anxiety"],
  phobia: ["anxiety"],
  phobias: ["anxiety"],
  agoraphobia: ["anxiety"],
};

function distinctiveServiceQueryTerms(query: string) {
  return Array.from(
    new Set(
      normalizeSearchText(query)
        .split(/\s+/)
        .filter((term) => term.length > 1 && !GENERIC_SERVICE_QUERY_TERMS.has(term)),
    ),
  );
}

function serviceTermCoverage(text: string, terms: string[]) {
  return terms.filter(
    (term) => text.includes(term) || (SERVICE_CONDITION_FAMILIES[term] ?? []).some((family) => text.includes(family)),
  ).length;
}

export function serviceNavigatorQuery(service: ServiceRecord) {
  return (
    [service.navigatorQuery, service.title, service.primaryContact?.value, service.subtitle].find((value) =>
      value?.trim(),
    ) ?? service.slug
  );
}

function serviceRecordSearchParts(service: ServiceRecord) {
  return [
    service.title,
    service.slug,
    service.subtitle,
    service.route,
    service.eligibility,
    service.cost,
    service.referral,
    service.location,
    service.bestUse,
    service.catalogueLabel,
    service.navigatorQuery,
    service.primaryContact?.value,
    service.primaryContact?.detail,
    service.source?.label,
    service.source?.status,
    service.source?.reviewed,
    ...(service.tags ?? []),
    ...(service.catchments ?? []),
    ...(service.statusChips ?? []).flatMap((chip) => [chip.label, chip.tone]),
    ...(service.contacts ?? []).flatMap((contact) => [contact.label, contact.value, contact.detail, contact.kind]),
    ...(service.summaryCards ?? []).flatMap((card) => [card.label, card.title, card.detail]),
    ...(service.referralInfo ?? []).flatMap((row) => [row.label, row.value]),
    ...(service.criteria ?? []).flatMap((criterion) => [criterion.label, criterion.tone]),
    ...(service.verification?.notes ?? []),
    ...(service.verification?.unresolvedIssues ?? []),
    ...(service.source?.notes ?? []),
    "service",
    "services",
    "source record",
    "pathway",
  ].filter((value): value is string => Boolean(value?.trim()));
}

export function serviceRecordSearchText(service: ServiceRecord) {
  return normalizeSearchText(serviceRecordSearchParts(service).join(" "));
}

export function rankServiceRecords(
  records: ServiceRecord[],
  query: string,
  limit = records.length,
  // Low-weight synonym/acronym/alias terms (see rankMedicationRecords) for the expanded lane.
  expansions: string[] = [],
  interpretNaturalLanguage = false,
): ServiceSearchMatch[] {
  const distinctive = distinctiveServiceQueryTerms(query);
  const interpretedExpansions = [
    ...expansions,
    ...(interpretNaturalLanguage ? smartSearchExpansions("services", query) : []),
    ...distinctive.flatMap((term) => SERVICE_CONDITION_FAMILIES[term] ?? []),
  ];
  const coverageOf = (service: ServiceRecord) => serviceTermCoverage(serviceRecordSearchText(service), distinctive);
  const specificExpansions = interpretedExpansions
    .map((term) => normalizeSearchText(term))
    .filter((term) => term.length > 1 && !GENERIC_SERVICE_QUERY_TERMS.has(term));

  const matches = rankCatalogRecords(records, query, {
    fields: [
      { id: "title", weight: 6, text: (service) => normalizeSearchText(`${service.title} ${service.slug}`) },
      { id: "contact", weight: 5, text: (service) => normalizeSearchText(service.primaryContact?.value ?? "") },
      {
        id: "tags",
        weight: 3,
        text: (service) => normalizeSearchText([...(service.tags ?? []), ...(service.catchments ?? [])].join(" ")),
      },
    ],
    fullText: serviceRecordSearchText,
    contentWeight: 2,
    compactBonus: 5,
    phraseBonus: 4,
    broadTerms: ["service", "services", "pathway", "pathways"],
    broadBonus: 1,
    expandTokens: interpretedExpansions.length ? (terms) => [...terms, ...interpretedExpansions] : undefined,
    limit: Math.max(limit, records.length),
    tieBreak: (left, right) => left.title.localeCompare(right.title),
  });

  // Evidence that a record matched something more specific than a generic word:
  // a distinctive term (or its condition family), a specific synonym expansion,
  // a typo match, the whole query as a phrase, or the service's own contact
  // number. Once any record has such evidence, records without it matched only
  // on words like "disorder" or "mental health" and are left out (#CNCAFV).
  // A query made only of generic words keeps every match, as before.
  const hasSpecificEvidence = ({ record, signals }: (typeof matches)[number]) => {
    const text = serviceRecordSearchText(record);
    return (
      coverageOf(record) > 0 ||
      specificExpansions.some((term) => text.includes(term)) ||
      signals.fuzzy > 0 ||
      signals.compact ||
      signals.phrase ||
      signals.exact
    );
  };
  const kept =
    distinctive.length > 0 && matches.some(hasSpecificEvidence) ? matches.filter(hasSpecificEvidence) : matches;

  const ranked = kept.map(({ record, score, signals }) => ({
    service: record,
    score,
    reasons: [
      signals.fields.title ? "title" : "",
      signals.fields.contact || signals.compact ? "contact" : "",
      signals.fields.tags ? "tags" : "",
      signals.content ? "record fields" : "",
      signals.broad ? "services catalogue" : "",
    ].filter(Boolean),
  }));
  // Records that mention more of the specific condition come first; within each
  // coverage level the ranker's own order holds (Array sort is stable), so typo
  // and synonym matches kept above keep their place in line.
  if (distinctive.length > 0) {
    const coverage = new Map(ranked.map(({ service }) => [service.slug, coverageOf(service)]));
    ranked.sort((left, right) => coverage.get(right.service.slug)! - coverage.get(left.service.slug)!);
  }

  const urgent = rankServiceUrgentRoutes(records, query);
  if (urgent.length === 0) return ranked.slice(0, limit);

  const pinned = new Set(urgent.map(({ service }) => service.slug));
  return [...urgent, ...ranked.filter(({ service }) => !pinned.has(service.slug))].slice(0, limit);
}
