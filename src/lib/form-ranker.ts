import { normalizeSearchText, rankCatalogRecords } from "@/lib/catalog-search";
import type { ServiceRecord, ServiceSearchMatch } from "@/lib/service-ranker";
import { smartSearchExpansions } from "@/lib/smart-search-intent";

export type FormRecord = ServiceRecord;
export type FormSearchMatch = ServiceSearchMatch;

export type FormAvailability = "downloadable" | "unavailable" | "contact_ocp";

export type FormPriorityFactCard = {
  title: string;
  detail?: string;
  /** Longer wording shown when the condensed priority-fact card is opened. */
  body?: string;
};

export type FormActSection = {
  section: string;
  title: string;
  /** Absent until the section summary has been written from the Act text. */
  summary?: string;
  /**
   * Provenance of `summary` when it came from the shared Act-section file. Absent for a
   * hand-written per-form override, which carries its own review history.
   */
  reviewStatus?: "reviewed" | "drafted";
};

export type FormCatalogDetails = {
  id: string;
  form: string;
  name: string;
  category: string;
  purpose: string;
  maker: string;
  involved: string;
  threshold: string;
  clock: string;
  destination: string;
  authorises: string;
  doesNotAuthorise: string;
  /**
   * What the form stops short of, in the form's own statutory terms -- "signing Form 3C
   * does not start a fresh 72-hour period", "cancellation does not itself supply
   * apprehension or transport authority". Distinct from `doesNotAuthorise`, which is the
   * generic disclaimer; a boundary is the specific trap the Act sets for this form.
   */
  boundaries?: string[];
  before: string[];
  parallel: string[];
  after: string[];
  copies: string;
  documentationStem: string;
  traps: string[];
  safetyPearl: string;
  sourceNote: string;
  aliases: string[];
  searchTerms: string[];
  riskLevel: "high" | "medium" | "low";
  indexedClock?: string;
  indexedTerms?: string[];
  legalNote: string;
  practicePearls: string[];
  preUseChecks: string[];
  /**
   * Optional condensed Priority facts copy. When present, summary cards use these
   * titles/details; `body` (or the canonical field) opens in a detail sheet.
   */
  priorityFacts?: {
    clock?: FormPriorityFactCard;
    authority?: FormPriorityFactCard;
    criteria?: FormPriorityFactCard;
  };
  /**
   * When present, replaces the Source status priority-fact card with Act sections
   * that open per-section detail on tap. Source status remains on the form rail.
   */
  actSections?: FormActSection[];
  sourceFacts?: {
    documentTitle?: string;
    fileName?: string;
    pages?: number;
    timings?: string[];
    sectionCue?: string;
    indexedAt?: string;
  };
  availability: FormAvailability;
  officialPdfUrl?: string;
  officialRegisterUrl: string;
  localPdfPath?: string;
  localPdfSha256?: string;
  localPdfBytes?: number;
  officialPdfPasswordProtected?: boolean;
  officialPdfEditingRestricted?: boolean;
  officialTitleCheckedAt: string;
  archiveGeneratedAt?: string;
  /**
   * Review state of the operational guidance -- purpose, maker, threshold, clock,
   * boundaries, traps, pre-use checks, safety pearl -- from
   * `data/forms-content-review.json`. `drafted` means written from the Act text and the
   * approved form with no clinician sign-off, and the UI says so; it is never inferred
   * from the content being present.
   */
  contentReviewStatus?: "drafted" | "reviewed";
  /**
   * When the operational guidance was signed off (`reviewedAt` in
   * `data/forms-content-review.json`), set only for a `reviewed` form. Its 24-month
   * review date counts from here (owner decision 21 Oct 2026).
   */
  contentReviewedAt?: string;
};

export function formCatalogDetails(record: FormRecord): FormCatalogDetails | null {
  const payload = record.catalogPayload;
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<FormCatalogDetails>;
  if (!candidate.form || !candidate.name || !candidate.category || !candidate.availability) return null;
  return candidate as FormCatalogDetails;
}

export function formRecordSearchText(form: FormRecord) {
  const details = formCatalogDetails(form);
  const values = [
    form.title,
    form.slug,
    form.subtitle,
    form.route,
    form.eligibility,
    form.cost,
    form.referral,
    form.location,
    form.bestUse,
    form.catalogueLabel,
    form.navigatorQuery,
    form.primaryContact?.value,
    form.primaryContact?.detail,
    form.source?.label,
    form.source?.status,
    form.source?.reviewed,
    ...(form.tags ?? []),
    ...(form.catchments ?? []),
    ...(form.statusChips ?? []).flatMap((chip) => [chip.label]),
    ...(form.contacts ?? []).flatMap((contact) => [contact.label, contact.value, contact.detail]),
    ...(form.summaryCards ?? []).flatMap((card) => [card.label, card.title, card.detail]),
    ...(form.referralInfo ?? []).flatMap((row) => [row.label, row.value]),
    ...(form.criteria ?? []).flatMap((criterion) => [criterion.label, criterion.tone]),
    ...(form.verification?.notes ?? []),
    details?.form,
    details?.category,
    details?.purpose,
    details?.maker,
    details?.threshold,
    details?.clock,
    details?.authorises,
    details?.doesNotAuthorise,
    ...(details?.aliases ?? []),
    ...(details?.searchTerms ?? []),
    ...(details?.indexedTerms ?? []),
    ...(details?.actSections ?? []).flatMap((entry) => [`section ${entry.section}`, entry.title, entry.summary]),
    "form",
    "forms",
    "checklist",
    "assessment",
    "transfer",
    "template",
  ].filter((value): value is string => Boolean(value?.trim()));

  return normalizeSearchText(values.join(" "));
}

export function rankFormRecords(
  records: FormRecord[],
  query: string,
  limit = records.length,
  // Low-weight synonym/acronym/alias terms (see rankMedicationRecords) for the expanded lane.
  expansions: string[] = [],
  interpretNaturalLanguage = false,
): FormSearchMatch[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  // A bare "service(s)" query belongs to the services catalogue, not forms.
  if (/^services?$/.test(normalizedQuery)) return [];
  const interpretedExpansions = [
    ...expansions,
    ...(interpretNaturalLanguage ? smartSearchExpansions("forms", query) : []),
  ];

  return rankCatalogRecords(records, query, {
    fields: [
      { id: "title", weight: 6, text: (form) => normalizeSearchText(`${form.title} ${form.slug}`) },
      { id: "contact", weight: 5, text: (form) => normalizeSearchText(form.primaryContact?.value ?? "") },
    ],
    fullText: formRecordSearchText,
    contentWeight: 2,
    compactBonus: 5,
    phraseBonus: 4,
    broadTerms: [
      "form",
      "forms",
      "checklist",
      "transport",
      "transfer",
      "extension",
      "detention",
      "movement",
      "examination",
      "template",
      "assessment",
    ],
    broadBonus: 1,
    expandTokens: interpretedExpansions.length ? (terms) => [...terms, ...interpretedExpansions] : undefined,
    limit,
    // No tieBreak: forms historically tie-break by catalogue (input) order, which is the
    // generic ranker's default.
  }).map(({ record, score, signals }) => ({
    service: record,
    score,
    reasons: [
      signals.fields.title ? "title" : "",
      signals.fields.contact || signals.compact ? "contact" : "",
      signals.content ? "record fields" : "",
      signals.broad ? "psychiatry forms catalogue" : "",
    ].filter(Boolean),
  }));
}
