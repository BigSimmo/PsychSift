import formsCatalog from "../../data/forms-catalog.json";
import formsContentReview from "../../data/forms-content-review.json";
import formsPdfManifest from "../../data/forms-pdf-manifest.json";

import { actSectionsForCue, sectionCueForForm } from "@/lib/mha-act-sections";
// The register itself lives in a leaf module so client bundles can read a form title without
// pulling this file's JSON imports. Re-exported below: one register, two entry points.
import { formSlug, normalizeCode, officialForms, type OfficialForm } from "@/lib/form-register";

import type { FormActSection, FormCatalogDetails, FormPriorityFactCard } from "@/lib/form-ranker";
import type { ServiceChipTone, ServiceRecord, ServiceSummaryCard } from "@/lib/services";

export { formCatalogDetails } from "@/lib/form-ranker";
export { formPageHref, formSlug, formTitleForCode } from "@/lib/form-register";
export type { FormAvailability, FormCatalogDetails } from "@/lib/form-ranker";
export type FormRecord = ServiceRecord;

export const officialFormsRegisterUrl =
  "https://www.chiefpsychiatrist.wa.gov.au/laws-and-rights/legislation/mental-health-act-2014-forms/";
// Moved 2026-09-16, when the register was read and all 54 codes, titles and availability
// states were reconciled against it -- including Form 10G, where the register's own
// "Revocation of expiry" is a typo this repository does not copy. Evidence:
// docs/evidence/forms-pdf-publisher-comparison-2026-09-16.md.
export const officialFormsReviewedDate = "16 September 2026";

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function riskLevel(value: unknown): FormCatalogDetails["riskLevel"] {
  return value === "high" || value === "low" ? value : "medium";
}

function priorityFactCard(value: unknown): FormPriorityFactCard | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const title = text(raw.title);
  if (!title) return undefined;
  return {
    title,
    detail: text(raw.detail) || undefined,
    body: text(raw.body) || undefined,
  };
}

function priorityFacts(value: unknown): FormCatalogDetails["priorityFacts"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const clock = priorityFactCard(raw.clock);
  const authority = priorityFactCard(raw.authority);
  const criteria = priorityFactCard(raw.criteria);
  if (!clock && !authority && !criteria) return undefined;
  return { clock, authority, criteria };
}

function actSections(value: unknown): FormActSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sections = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const section = text(raw.section);
    const title = text(raw.title);
    const summary = text(raw.summary);
    if (!section || !title || !summary) return [];
    return [{ section, title, summary } satisfies FormActSection];
  });
  return sections.length ? sections : undefined;
}

import { ACT_SECTION_CHIP_LIMIT, PRIORITY_FACT_CARD_LABELS } from "@/lib/form-catalog-constants";

export { ACT_SECTION_CHIP_LIMIT, PRIORITY_FACT_CARD_LABELS };

function summaryCardsForDetails(details: FormCatalogDetails, availabilityLabel: string): ServiceSummaryCard[] {
  const facts = details.priorityFacts;
  const cards: ServiceSummaryCard[] = [
    {
      id: "clock",
      label: PRIORITY_FACT_CARD_LABELS.clock,
      title: facts?.clock?.title ?? details.clock,
      detail: facts?.clock?.detail ?? details.indexedClock,
    },
    {
      id: "authority",
      label: PRIORITY_FACT_CARD_LABELS.authority,
      title: facts?.authority?.title ?? details.maker,
      detail: facts?.authority?.detail ?? details.authorises,
    },
    {
      id: "criteria",
      label: PRIORITY_FACT_CARD_LABELS.criteria,
      title: facts?.criteria?.title ?? details.threshold,
      detail: facts?.criteria?.detail ?? details.doesNotAuthorise,
    },
  ];

  if (details.actSections?.length) {
    const sections = details.actSections;
    cards.push({
      id: "act-sections",
      label: "Act sections",
      // "MHA 2014 referral pathway" was Form 1A's pilot copy and is untrue of the 46
      // other forms, which cite transfer, restraint, seclusion and reporting sections.
      title: "Authority under the Act",
      detail:
        sections.length > ACT_SECTION_CHIP_LIMIT
          ? `${sections.length} sections cited`
          : sections.map((entry) => entry.section).join(" · "),
    });
    return cards;
  }

  cards.push({
    id: "source",
    label: "Source status",
    title: availabilityLabel,
    detail: `Official register checked ${officialFormsReviewedDate}`,
  });
  return cards;
}

const archiveGeneratedAt = text(
  (formsCatalog as { exportMetadata?: { generatedAt?: unknown } }).exportMetadata?.generatedAt,
);
const archivedForms = Array.isArray((formsCatalog as { forms?: unknown[] }).forms)
  ? (formsCatalog as { forms: unknown[] }).forms
  : [];
const archivedByCode = new Map(
  archivedForms.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const code = text(raw.form);
    return code ? ([[normalizeCode(code), raw]] as const) : [];
  }),
);
const pdfAssetByCode = new Map(formsPdfManifest.assets.map((asset) => [normalizeCode(asset.code), asset] as const));

/**
 * Review state for each form's operational guidance, from `data/forms-content-review.json`.
 *
 * Every entry there is `drafted`: written from the Act text and the approved form, with no
 * clinician sign-off. That is the same bargain the Act-section summaries already strike --
 * the alternative was leaving forty of the fifty-four forms with the PDF-indexing
 * scaffolding they used to carry ("Official form source: <title>. Review the source
 * snippets and approved form before use."), which named no maker, no clock origin and no
 * authority boundary while reading like settled reference. A named reviewer signs a form
 * off by setting `status` to `reviewed`, and only then does the caveat drop.
 *
 * A form absent from the register is treated as drafted too. The default has to be the
 * cautious one: a missing row is a gap in the record, not evidence of review.
 */
const contentReviewStatusByCode = new Map(
  (
    formsContentReview as { forms: { code: string; status: string; reviewedBy?: unknown; reviewedAt?: unknown }[] }
  ).forms.map((entry) => [normalizeCode(entry.code), formContentReviewStatus(entry)] as const),
);

/**
 * `reviewed` requires all three of the status and both attribution fields.
 *
 * Status alone is not a sign-off. A hand-edit that flips `status` without naming who signed
 * and when — or that leaves either field empty, blank, or the wrong type — would otherwise
 * drop the awaiting-review caveat and present unsigned guidance about a statutory form as
 * settled reference. There is no partially reviewed state to represent, so anything short of
 * a complete attestation falls closed to `drafted`.
 */
export function formContentReviewStatus(entry: { status: string; reviewedBy?: unknown; reviewedAt?: unknown }) {
  if (entry.status !== "reviewed") return "drafted";
  const attributed = [entry.reviewedBy, entry.reviewedAt].every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return attributed ? "reviewed" : "drafted";
}

export const FORMS_AWAITING_REVIEW_NOTE =
  "Operational guidance drafted from the Act and the approved form, awaiting clinical review";

function fallbackDetails(form: OfficialForm): Partial<FormCatalogDetails> {
  const action = form.availability === "unavailable" ? "is currently unavailable" : "must be obtained from the OCP";
  return {
    purpose:
      form.availability && form.availability !== "downloadable"
        ? `The official register lists this form, but it ${action}. Check the register and local governance before proceeding.`
        : `Use the current approved Form ${form.code} to record ${form.title.toLowerCase()} when the statutory and local requirements are met.`,
    maker:
      "Only an appropriately authorised person under the Mental Health Act 2014 and the approved form instructions.",
    involved:
      "Confirm the required recipients, support persons, records and local PSOLIS workflow on the current approved form.",
    threshold: "Confirm the statutory criteria and completion instructions on the current approved form before use.",
    clock: "Confirm any time limit, expiry or review point on the current approved form and local policy.",
    destination: "Confirm any required place or destination on the approved form.",
    authorises: `Only the action or record expressly described by Form ${form.code} and the Mental Health Act 2014.`,
    doesNotAuthorise: "No action beyond the current Act, approved form wording and the maker’s lawful authority.",
    legalNote:
      "Use only the current approved form or PSOLIS pathway. This catalogue is a reference aid, not legal advice, and does not replace the Act, form instructions or local governance.",
    sourceNote: "Official title and availability checked against the Office of the Chief Psychiatrist register.",
    safetyPearl:
      "Open the current official source and confirm authority, timing, notices and filing requirements before completion.",
    preUseChecks: [
      "Open the current official form or PSOLIS workflow before use.",
      "Confirm the maker is appropriately authorised and all statutory criteria are met.",
      "Confirm identifiers, date, time, signatures, notices, copies and filing requirements.",
    ],
    practicePearls: ["Treat the approved form and current legislation as authoritative."],
  };
}

function detailsFor(form: OfficialForm): FormCatalogDetails {
  const raw = archivedByCode.get(normalizeCode(form.code)) ?? {};
  const fallback = fallbackDetails(form);
  const availability = form.availability ?? "downloadable";
  const pdfAsset = pdfAssetByCode.get(normalizeCode(form.code));
  if (availability === "downloadable" && !pdfAsset) {
    throw new Error(`Missing official PDF manifest entry for Form ${form.code}.`);
  }
  const sourceFacts =
    raw.sourceFacts && typeof raw.sourceFacts === "object"
      ? (raw.sourceFacts as FormCatalogDetails["sourceFacts"])
      : undefined;
  const details: FormCatalogDetails = {
    id: `form-${normalizeCode(form.code).replace(/[^a-z0-9]+/g, "-")}`,
    form: form.code,
    name: form.title,
    category: form.category,
    purpose: text(raw.purpose, fallback.purpose),
    maker: text(raw.maker, fallback.maker),
    involved: text(raw.involved, fallback.involved),
    threshold: text(raw.threshold, fallback.threshold),
    clock: text(raw.clock, fallback.clock),
    destination: text(raw.destination, fallback.destination),
    authorises: text(raw.authorises, fallback.authorises),
    doesNotAuthorise: text(raw.doesNotAuthorise, fallback.doesNotAuthorise),
    boundaries: stringArray(raw.boundaries),
    before: stringArray(raw.before),
    parallel: stringArray(raw.parallel),
    after: stringArray(raw.after),
    copies: text(raw.copies, "Confirm notices, copies, handover and filing requirements on the approved form."),
    documentationStem: text(raw.documentationStem),
    traps: stringArray(raw.traps),
    safetyPearl: text(raw.safetyPearl, fallback.safetyPearl),
    sourceNote: text(raw.sourceNote, fallback.sourceNote),
    aliases: stringArray(raw.aliases),
    searchTerms: stringArray(raw.searchTerms),
    riskLevel: riskLevel(raw.riskLevel),
    indexedClock: text(raw.indexedClock) || undefined,
    indexedTerms: stringArray(raw.indexedTerms),
    legalNote: text(raw.legalNote, fallback.legalNote),
    practicePearls: stringArray(raw.practicePearls).length
      ? stringArray(raw.practicePearls)
      : (fallback.practicePearls ?? []),
    preUseChecks: stringArray(raw.preUseChecks).length ? stringArray(raw.preUseChecks) : (fallback.preUseChecks ?? []),
    priorityFacts: priorityFacts(raw.priorityFacts),
    // A hand-written per-form override wins; otherwise the form's own section cue
    // resolves against the shared Act summaries, which yields sections only once every
    // one of them has been clinically reviewed. Supplemental cues are also withheld
    // until their form-to-section mapping has its own review sign-off.
    actSections:
      actSections(raw.actSections) ?? actSectionsForCue(sectionCueForForm(form.code, sourceFacts?.sectionCue)),
    sourceFacts,
    availability,
    officialPdfUrl: pdfAsset?.officialPdfUrl,
    officialRegisterUrl: officialFormsRegisterUrl,
    localPdfPath: pdfAsset?.localPath,
    localPdfSha256: pdfAsset?.sha256,
    localPdfBytes: pdfAsset?.bytes,
    officialPdfPasswordProtected: pdfAsset?.passwordProtected,
    officialPdfEditingRestricted: pdfAsset?.editingRestricted,
    officialTitleCheckedAt: officialFormsReviewedDate,
    archiveGeneratedAt: archiveGeneratedAt || undefined,
    contentReviewStatus: contentReviewStatusByCode.get(normalizeCode(form.code)) ?? "drafted",
  };
  return details;
}

function riskTone(risk: FormCatalogDetails["riskLevel"]): ServiceChipTone {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "info";
}

function pathwayText(details: FormCatalogDetails) {
  const parts = [
    details.before.length ? `Before: ${details.before.join(", ")}` : "",
    details.parallel.length ? `Parallel: ${details.parallel.join(", ")}` : "",
    details.after.length ? `After: ${details.after.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join(" | ") || "Confirm the current approved form pathway and local policy.";
}

function detailRows(details: FormCatalogDetails) {
  const rows = [
    { label: "Purpose", value: details.purpose },
    { label: "Authorises", value: details.authorises },
    { label: "Does not authorise", value: details.doesNotAuthorise },
    { label: "Authority boundaries", value: details.boundaries?.join(" ") ?? "" },
    { label: "Before", value: details.before.join(", ") },
    { label: "Parallel", value: details.parallel.join(", ") },
    { label: "After", value: details.after.join(", ") },
    { label: "Copies and filing", value: details.copies },
    { label: "Documentation stem", value: details.documentationStem },
    { label: "Safety pearl", value: details.safetyPearl },
    { label: "Common traps", value: details.traps.join(" ") },
    { label: "Pre-use checks", value: details.preUseChecks.join(" ") },
  ];
  return rows.filter((row) => row.value.trim().length > 0);
}

function toFormRecord(details: FormCatalogDetails): ServiceRecord {
  const availabilityLabel =
    details.availability === "downloadable"
      ? "Official PDF"
      : details.availability === "unavailable"
        ? "Currently unavailable"
        : "Contact OCP";
  const availabilityTone: ServiceChipTone = details.availability === "downloadable" ? "success" : "warning";

  return {
    slug: formSlug(details.form),
    title: details.name,
    subtitle: details.purpose,
    statusChips: [
      { label: `${details.riskLevel} risk`, tone: riskTone(details.riskLevel) },
      { label: details.category, tone: "info" },
      { label: availabilityLabel, tone: availabilityTone },
    ],
    primaryContact: {
      label: "Form code",
      value: `Form ${details.form}`,
      detail: availabilityLabel,
      kind: "text",
    },
    contacts: [
      ...(details.officialPdfUrl
        ? [
            {
              label: "Official public PDF",
              value: details.officialPdfUrl,
              detail: "Current OCP source",
              kind: "web" as const,
            },
          ]
        : []),
      {
        label: "Official forms register",
        value: details.officialRegisterUrl,
        detail: "Check current availability",
        kind: "web",
      },
    ],
    route: pathwayText(details),
    eligibility: details.threshold,
    cost: "Official WA Mental Health Act 2014 form",
    referral: details.preUseChecks[0] ?? details.safetyPearl,
    location: "Western Australia",
    summaryCards: summaryCardsForDetails(details, availabilityLabel),
    referralInfo: detailRows(details),
    bestUse: details.legalNote,
    criteria: [
      ...details.preUseChecks.slice(0, 3).map((label) => ({ label, tone: "caution" as const })),
      ...details.traps.slice(0, 2).map((label) => ({ label, tone: "reject" as const })),
    ],
    verification: {
      locallyVerified: false,
      confidence: "Medium",
      notes: [
        `Official title and availability checked ${officialFormsReviewedDate}`,
        ...(details.contentReviewStatus === "drafted" ? [FORMS_AWAITING_REVIEW_NOTE] : []),
        "Archive guidance remains a prototype reference aid and requires local clinical/legal governance review",
        "Use the current approved PDF or PSOLIS form; do not modify approved form content",
      ],
    },
    tags: [
      ...new Set([
        `Form ${details.form}`,
        details.category,
        "Mental Health Act 2014",
        ...details.aliases,
        ...details.searchTerms,
      ]),
    ],
    catchments: ["Western Australia"],
    catalogueLabel: `Form ${details.form}`,
    navigatorQuery: [
      `Form ${details.form}`,
      details.name,
      details.category,
      details.purpose,
      details.indexedClock,
      ...(details.indexedTerms ?? []),
    ]
      .filter(Boolean)
      .join(" "),
    source: {
      label: "Office of the Chief Psychiatrist WA — approved MHA 2014 forms",
      status: "Source checked",
      url: details.officialPdfUrl ?? details.officialRegisterUrl,
      reviewed: `Official register checked ${officialFormsReviewedDate}`,
      notes: [
        details.availability === "unavailable"
          ? "The official register currently marks this form unavailable"
          : details.availability === "contact_ocp"
            ? "Contact OCP monitoring to obtain or submit this form"
            : "Open the official source to confirm the current approved version before use",
        "PSOLIS is the preferred completion method where available",
      ],
    },
    catalogPayload: details,
  };
}

export function loadFormCatalogDetails(): FormCatalogDetails[] {
  return officialForms.map(detailsFor);
}

export function mapFormCatalogToRecords(): ServiceRecord[] {
  return loadFormCatalogDetails().map(toFormRecord);
}
