import { appModeHomeHref, canAccessFavouritesMode } from "@/lib/app-modes";
import { normalizeSearchText, rankCatalogRecords } from "@/lib/catalog-search";

// Canonical Tools dataset. Previously duplicated between the live launcher
// (applications-launcher-page.tsx inline array) and the mockup fixtures
// (tools-page-mockups/tool-fixtures.ts) with divergent fields and two separate filter
// implementations. Icons remain a UI concern, but the glyph and accent chosen for
// each id now live in one place (`src/lib/category-identity.ts`) rather than in a
// per-surface map, because two such maps had already drifted apart.

export type ToolCatalogStatus = "ready" | "recent" | "review_due";
export type ToolCatalogArea = "assessment" | "reference" | "care" | "coordination" | "saved";

/**
 * The catalogue's id space, named rather than left as `string`.
 *
 * This is what makes `Record<ToolCatalogId, …>` in `category-identity.ts`
 * exhaustive: adding a tool without choosing a glyph fails the typecheck instead
 * of falling through to a generic placeholder at runtime. `registry-mode-nav.tsx`
 * makes the same argument for routed nav ids.
 */
export type ToolCatalogId =
  | "clinical-kb-search"
  | "differentials"
  | "documents"
  | "clinical-dictionary"
  | "source-catalogue"
  | "guidelines"
  | "risk-safety"
  | "medication-prescribing"
  | "services"
  | "forms"
  | "care-plans"
  | "safety-plan"
  | "calculators"
  | "monitoring"
  | "favourites";

export type ToolCatalogRecord = {
  id: ToolCatalogId;
  title: string;
  mobileTitle?: string;
  description: string;
  bestFor: string;
  detail: string;
  href: string;
  external?: boolean;
  area: ToolCatalogArea;
  status: ToolCatalogStatus;
  sourceBacked: boolean;
  safetyFirst?: boolean;
  highYield?: boolean;
  actionLabel: string;
  keywords: string[];
  checkFirst: string[];
  neededInput: string[];
  output: string;
};

/**
 * Consultant Psychiatrist Medicare Benefits Schedule (MBS) billing item references.
 *
 * MBS billing rules and clinical governance notes:
 * - Item 291: Comprehensive assessment and preparation of a management plan by a consultant
 *   psychiatrist for a patient referred by a general practitioner.
 *   Key rules:
 *   1. GP Referral: Must be referred by a general practitioner who will manage the patient,
 *      specifically requesting an assessment and management plan under Item 291.
 *   2. 12-Month Restriction: Payable only once in any 12-month period for a patient.
 *   3. Ongoing-management billing condition: Item 291 is claimable only where the referring GP,
 *      not the psychiatrist, will provide ongoing management. It is an MBS eligibility condition,
 *      not a legal bar on the psychiatrist treating the patient; if the psychiatrist is to take on
 *      ongoing care, Item 291 is not the item to claim (check the current MBS descriptor).
 *
 * - Item 293: Review of a management plan by a consultant psychiatrist.
 *   Key rules:
 *   1. Review of Item 291 Plan: Review of the management plan previously prepared under Item 291
 *      by the consultant psychiatrist (or another psychiatrist in the same group practice).
 *   2. GP Referral: Initiated at the request of the treating GP to formally review the management plan.
 *   3. 12-Month Restriction: Payable once in a 12-month period following an Item 291 plan.
 *   4. GP Ongoing Management: Ongoing management remains with the referring GP; the psychiatrist
 *      provides an updated management plan to support the GP rather than assuming continuing treatment.
 */
export type PsychiatricBillingItem = {
  item: string;
  title: string;
  description: string;
  referralRequirement: string;
  frequencyRestriction: string;
  ongoingManagementRule: string;
  rules: string[];
};

export const psychiatricMedicareBillingItems: Record<"291" | "293", PsychiatricBillingItem> = {
  "291": {
    item: "291",
    title: "Consultant Psychiatrist Assessment and Management Plan",
    description:
      "Assessment and preparation of a management plan by a consultant psychiatrist for a patient referred by a general practitioner.",
    referralRequirement:
      "Referral must be from a general practitioner who will manage the patient, explicitly requesting an assessment and management plan under Item 291.",
    frequencyRestriction: "Payable only once in any 12-month period for a patient (12-month restriction).",
    ongoingManagementRule:
      "Billing condition, not a treatment ban: Item 291 is claimable only where the referring GP will provide ongoing management (care remains with the referring GP). It does not prohibit the psychiatrist from treating the patient; if the psychiatrist is to take on ongoing care, Item 291 is not the appropriate item. Check the current MBS descriptor.",
    rules: [
      "Referral must be from a general practitioner requesting the preparation of a management plan.",
      "Payable only once in any 12-month period (12-month restriction).",
      "Billing condition: claimable only where the referring GP will provide ongoing management; it is not a prohibition on the psychiatrist treating the patient.",
    ],
  },
  "293": {
    item: "293",
    title: "Consultant Psychiatrist Review of Management Plan",
    description:
      "Review of a management plan previously prepared under Item 291 by the consultant psychiatrist (or another psychiatrist in the same group practice).",
    referralRequirement:
      "Requires a referral from the treating GP requesting a formal review of the patient's progress and the existing Item 291 management plan.",
    frequencyRestriction: "Payable once in any 12-month period following an Item 291 management plan.",
    ongoingManagementRule:
      "Ongoing management remains with the referring GP; the psychiatrist reviews and updates the management plan rather than assuming ongoing treatment.",
    rules: [
      "Review of a management plan previously prepared under Item 291.",
      "Initiated upon GP referral requesting review of the management plan.",
      "Restricted to once in any 12-month period.",
      "Ongoing management remains with the referring GP.",
    ],
  },
};

/**
 * Tools the composer's smart search already answers directly, so surfacing them again
 * as local results or shortcuts would send a clinician the long way round to something
 * they have just been handed.
 *
 * One definition, three consumers. It was copied into the launcher and the tools
 * directory separately, and a third copy was nearly added when the quick-action row
 * moved out of the launcher.
 */
export const localSmartExcludedToolIds = new Set<ToolCatalogId>(["clinical-kb-search", "documents", "favourites"]);

export const toolCatalogRecords: ToolCatalogRecord[] = [
  {
    id: "clinical-kb-search",
    title: "PsychSift Search",
    mobileTitle: "PsychSift",
    description: "Ask source-backed clinical questions and move straight to evidence.",
    bestFor: "Quick answers and guidance",
    detail: "Ask source-backed clinical questions and move straight to evidence.",
    href: "/?mode=answer",
    area: "assessment",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Ask",
    keywords: ["answer", "ask", "source", "knowledge base", "clinical question", "search"],
    checkFirst: ["Clinical question or PICO", "Patient context and setting", "Timeframe or guideline scope"],
    neededInput: ["Clinical question", "Relevant patient context", "Optional source or document scope"],
    output: "Concise answer, key points, citations, and source links.",
  },
  {
    id: "differentials",
    title: "Differentials",
    description: "Build and compare diagnostic possibilities with source-aware prompts.",
    bestFor: "Broad or complex presentations",
    detail: "Compare diagnostic possibilities, supporting features, red flags, and next-step questions.",
    // Tools is in-app navigation, so go straight to the canonical shared home.
    // The bare namespace is only a compatibility redirect for old bookmarks;
    // sending a client transition through it can briefly retain the Tools route
    // shell and its phone geometry before the second navigation settles.
    href: appModeHomeHref("differentials"),
    area: "assessment",
    status: "recent",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Compare",
    keywords: ["compare", "diagnosis", "differential", "presentation", "risk"],
    checkFirst: ["Red flags", "Key presenting features", "Important negatives"],
    neededInput: ["Chief concern", "History and examination features", "Available observations or tests"],
    output: "Ranked differentials, rationale, must-not-miss risks, and next steps.",
  },
  {
    id: "documents",
    title: "Documents",
    mobileTitle: "Docs",
    description: "Search indexed PDFs, policies, guidelines, pages, tables, and images.",
    bestFor: "Trusted documents and pages",
    detail: "Find the source document, page, table, image, or policy wording behind an answer.",
    href: "/documents",
    area: "reference",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Search",
    keywords: ["documents", "docs", "pdf", "policy", "guideline", "source", "pages"],
    checkFirst: ["Document title or topic", "Local policy scope", "Page, table, or image need"],
    neededInput: ["Source topic", "Optional document name", "Preferred date or local scope"],
    output: "Matching documents, page context, snippets, and source links.",
  },
  {
    id: "clinical-dictionary",
    title: "Clinical Dictionary",
    mobileTitle: "Dictionary",
    description: "Search source-governed psychiatric terms, abbreviations, topics, and distinctions.",
    bestFor: "Terminology and abbreviation lookup",
    detail:
      "Open concise definitions, resolve ambiguous abbreviations, compare terms, and review their direct sources.",
    href: appModeHomeHref("dictionary"),
    area: "reference",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Search",
    keywords: ["dictionary", "definition", "term", "terminology", "abbreviation", "acronym", "compare"],
    checkFirst: ["Term or abbreviation", "Clinical topic or context", "Whether a distinction or comparison is needed"],
    neededInput: ["Term, abbreviation, or topic"],
    output: "Source-checked definition, related terminology, distinctions, and source links.",
  },
  {
    id: "source-catalogue",
    title: "Sources",
    description: "Browse ranked clinical sources and their traceability.",
    bestFor: "Source quality and provenance review",
    detail: "Review source identity, quality bands, locations, publishers, topics, and application usage.",
    href: appModeHomeHref("sources"),
    area: "reference",
    status: "ready",
    sourceBacked: true,
    actionLabel: "Browse",
    keywords: ["sources", "catalogue", "publisher", "quality", "provenance", "traceability"],
    checkFirst: ["Source identity", "Quality band", "Review and lifecycle status"],
    neededInput: ["Optional title, publisher, topic, or usage filter"],
    output: "Read-only source catalogue records with quality and traceability details.",
  },
  {
    id: "guidelines",
    title: "Guidelines",
    description: "Browse trusted guidelines and clinical pathways.",
    bestFor: "Recommendations and standards",
    detail: "Move from a clinical question to guideline wording, pathway steps, and source context.",
    href: "/?mode=documents&q=guideline&focus=1",
    area: "reference",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Browse",
    keywords: ["guidelines", "recommendations", "standards", "pathways"],
    checkFirst: ["Guideline topic", "Population or setting", "Local policy relevance"],
    neededInput: ["Condition or intervention", "Clinical setting", "Optional source preference"],
    output: "Guideline matches, key recommendations, and linked source context.",
  },
  {
    id: "risk-safety",
    title: "Risk & Safety",
    mobileTitle: "Safety",
    description: "Check risks, contraindications, alerts, and safety guidance.",
    bestFor: "Preventing harm",
    detail: "Check risks, contraindications, and safety alerts before making clinical decisions.",
    href: "/?mode=answer&q=safety%20check&focus=1",
    area: "care",
    status: "review_due",
    sourceBacked: true,
    safetyFirst: true,
    actionLabel: "Open",
    keywords: ["risk", "safety", "contraindications", "red flags", "alerts", "harm"],
    checkFirst: [
      "Allergies and adverse reactions",
      "Drug-drug and drug-disease interactions",
      "Dose adjustments and monitoring needs",
      "Safety alerts and warnings",
    ],
    neededInput: [
      "Patient context and problem list",
      "Current medications and doses",
      "Allergies and prior reactions",
      "Renal/hepatic function if relevant",
    ],
    output: "Prioritized risks, alerts, and actionable recommendations with source links.",
  },
  {
    id: "medication-prescribing",
    title: "Medication Prescribing",
    mobileTitle: "Prescribe",
    description: "Review prescribing context, monitoring, interactions, and cautions.",
    bestFor: "Safe and effective prescribing",
    detail: "Review medication context, dosing, interactions, monitoring, and medication-specific cautions.",
    href: "/medications",
    area: "care",
    status: "review_due",
    sourceBacked: true,
    safetyFirst: true,
    actionLabel: "Prescribe",
    keywords: ["medication", "medications", "prescribing", "dose", "monitoring", "interactions"],
    checkFirst: ["Current medicines", "Contraindications", "Monitoring requirements"],
    neededInput: ["Medicine and indication", "Dose and route if known", "Comorbidities and key labs"],
    output: "Prescribing guidance, monitoring plan, cautions, and references.",
  },
  {
    id: "services",
    title: "Services",
    description: "Open source-backed service records, referral routes, and eligibility.",
    bestFor: "Referrals and coordination",
    detail: "Open service records with referral routes, eligibility, source status, and access pathways.",
    href: appModeHomeHref("services"),
    area: "coordination",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Refer",
    keywords: ["services", "referral", "eligibility", "pathway", "contact"],
    checkFirst: ["Eligibility", "Referral route", "Service source status"],
    neededInput: ["Patient location or catchment", "Clinical need", "Urgency and pathway requirements"],
    output: "Referral pathway, eligibility notes, service record, and source link.",
  },
  {
    id: "forms",
    title: "Forms",
    description: "Find clinical forms and source-backed readiness pathways.",
    bestFor: "Forms and workflows",
    detail: "Open form search, readiness checks, pathway tasks, and source-backed records.",
    href: appModeHomeHref("forms"),
    area: "coordination",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Open",
    keywords: ["forms", "paperwork", "readiness", "pathway"],
    checkFirst: ["Current form version", "Required fields", "Linked service pathway"],
    neededInput: ["Form type", "Clinical pathway", "Patient or service context"],
    output: "Relevant form, readiness tasks, and source-backed pathway details.",
  },
  {
    id: "care-plans",
    title: "Care plans",
    description: "Generate care-plan guidance with monitoring and follow-up prompts.",
    bestFor: "Care-planning guidance and MBS 291/293 management plans",
    detail:
      "Generate care-plan structure, review milestones, monitoring needs, and follow-up tasks. Covers MBS psychiatric management plans: Item 291 (GP referral required, 12-month restriction, billing condition that the referring GP provides ongoing management, not a treatment ban) and Item 293 (GP-referred review of Item 291 management plan, 12-month restriction).",
    href: "/?mode=answer&q=care%20plan&focus=1",
    area: "care",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Open",
    keywords: [
      "care plan",
      "management",
      "follow-up",
      "monitoring",
      "291",
      "293",
      "item 291",
      "item 293",
      "mbs",
      "mbs 291",
      "mbs 293",
      "medicare",
      "medicare billing",
      "psychiatrist management plan",
    ],
    checkFirst: [
      "Goals of care",
      "Review date",
      "Monitoring responsibilities",
      "MBS 291 12-month restriction and GP referral",
      "MBS 291 billing condition: referring GP provides ongoing management",
    ],
    neededInput: [
      "Diagnosis or working problem",
      "Current plan",
      "Follow-up timeframe",
      "GP referral details and prior 291/293 billing dates",
    ],
    output: "Care-plan structure, review points, monitoring prompts, and MBS 291/293 compliance guidance.",
  },
  {
    id: "safety-plan",
    title: "Safety plan",
    mobileTitle: "Safety plan",
    description: "Build an identifier-free safety plan with the Stanley-Brown six steps and a printable copy.",
    bestFor: "Collaborative safety planning",
    detail:
      "Build an identifier-free safety plan with the patient — warning signs, coping strategies, supports, and means safety. Working content stays in the current browser tab until you copy, print, or save a PDF.",
    href: "/safety-plan",
    area: "care",
    status: "ready",
    sourceBacked: false,
    safetyFirst: true,
    actionLabel: "Open",
    keywords: [
      "safety plan",
      "safety planning",
      "crisis",
      "crisis plan",
      "stanley brown",
      "coping",
      "warning signs",
      "suicide",
      "means safety",
    ],
    checkFirst: ["Current risk and recent changes", "Warning signs and triggers", "Trusted supports and crisis lines"],
    neededInput: [
      "No patient identifiers",
      "Warning signs",
      "Coping strategies and supports",
      "Crisis contacts and means-safety steps",
    ],
    output: "An identifier-free six-step safety plan to export through an approved clinical workflow.",
  },
  {
    id: "calculators",
    title: "Calculators",
    mobileTitle: "Calculators",
    description: "Score psychiatry rating scales with source-cited guidance.",
    bestFor: "Bedside scoring and severity banding",
    detail:
      "Search and complete clinical calculators (PHQ-9, GAD-7, and related scales). Scores support clinical judgement and cite their source — they never replace a full assessment.",
    href: appModeHomeHref("calculators"),
    area: "assessment",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Open",
    keywords: [
      "calculator",
      "calculators",
      "rating scale",
      "rating scales",
      "score",
      "scoring",
      "phq",
      "phq-9",
      "gad",
      "gad-7",
      "severity",
      "depression severity",
      "clinical decision",
    ],
    checkFirst: ["Scale indication and setting", "Time available for completion", "Source and scoring notes"],
    neededInput: ["Clinical indication or symptom focus", "Item responses for the chosen scale"],
    output: "Total score, severity band, caution flags, and source-cited scoring guidance.",
  },
  {
    id: "monitoring",
    title: "Monitoring",
    description: "Generate monitoring guidance with thresholds and review prompts.",
    bestFor: "Monitoring guidance",
    detail: "Generate monitoring intervals, parameters, alerts, and follow-up actions.",
    href: "/?mode=answer&q=monitoring%20schedule&focus=1",
    area: "care",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Open",
    keywords: ["monitoring", "results", "parameters", "schedule", "labs"],
    checkFirst: ["Monitoring indication", "Last result date", "Thresholds and alerts"],
    neededInput: ["Medication or condition", "Recent results", "Monitoring timeframe"],
    output: "Monitoring schedule, thresholds, and review prompts.",
  },
  {
    id: "favourites",
    title: "Saved workflows",
    mobileTitle: "Saved",
    description: "Return to saved clinical workspaces and repeated workflows.",
    bestFor: "Repeated or complex work",
    detail: "Resume saved answers, pinned sources, and repeated clinical workflows.",
    href: "/favourites",
    area: "saved",
    status: "recent",
    sourceBacked: false,
    actionLabel: "View",
    keywords: ["favourites", "favorites", "saved", "recent", "pinned"],
    checkFirst: ["Saved context", "Last-used status", "Review markers"],
    neededInput: ["Saved item or workflow name", "Optional source set", "Review context"],
    output: "Saved workspace, pinned source, or recent workflow.",
  },
];

/**
 * Public knowledge records rendered by the Tools catalogue. Consumer shortcuts
 * (Answer/Documents), account state, and synthetic operational workspaces stay
 * in the launcher but are never site-content producers.
 */
export const publicKnowledgeToolCatalogIds = [
  "differentials",
  "clinical-dictionary",
  "medication-prescribing",
  "services",
  "forms",
  "safety-plan",
  "calculators",
] as const satisfies readonly ToolCatalogId[];

const publicKnowledgeToolCatalogIdSet: ReadonlySet<string> = new Set(publicKnowledgeToolCatalogIds);

export const publicKnowledgeToolCatalogRecords = toolCatalogRecords.filter((record) =>
  publicKnowledgeToolCatalogIdSet.has(record.id),
);

export function publicKnowledgeToolCatalogRecordById(id: string): ToolCatalogRecord | null {
  return publicKnowledgeToolCatalogRecords.find((record) => record.id === id) ?? null;
}

/**
 * Resolves a catalogue record by id, and throws for an id the catalogue does not
 * know. It used to fall back to the first record, so a typo rendered the PsychSift
 * Search card in place of the tool that was asked for instead of failing; the only
 * caller builds mockup fixtures at module load, where a thrown error is caught by the
 * fixture test before anything is rendered.
 */
export function toolCatalogRecordById(id: string): ToolCatalogRecord {
  const record = toolCatalogRecords.find((tool) => tool.id === id);
  if (!record) throw new Error(`Unknown tool catalogue id: ${id}`);
  return record;
}

/**
 * The catalogue as a given session may see it: account-scoped Favourites / Saved
 * workflows are hidden from guests.
 */
export function toolCatalogRecordsForSession(options: { authenticated: boolean; demoMode: boolean }) {
  const favouritesAllowed = canAccessFavouritesMode(options);
  return toolCatalogRecords.filter((tool) => {
    if (favouritesAllowed) return true;
    return tool.id !== "favourites" && !tool.href.startsWith("/favourites");
  });
}

export function toolSearchText(tool: ToolCatalogRecord) {
  return normalizeSearchText(
    [
      tool.title,
      tool.mobileTitle,
      tool.description,
      tool.bestFor,
      tool.detail,
      tool.area,
      ...tool.keywords,
      ...tool.checkFirst,
      tool.output,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" "),
  );
}

export type ToolSearchMatch = { tool: ToolCatalogRecord; score: number; reasons: string[] };

export function rankToolRecords(
  query: string,
  limit?: number,
  // Low-weight synonym/acronym/alias terms (see rankMedicationRecords) for the expanded lane.
  expansions: string[] = [],
  /**
   * Session access for Favourites / Saved workflows. Defaults fail closed so callers
   * that omit session never leak account-scoped Tools entries to guests.
   */
  session: { authenticated: boolean; demoMode: boolean } = { authenticated: false, demoMode: false },
): ToolSearchMatch[] {
  const records = toolCatalogRecordsForSession(session);
  return rankCatalogRecords(records, query, {
    fields: [
      {
        id: "title",
        weight: 6,
        text: (tool) => normalizeSearchText(`${tool.title} ${tool.mobileTitle ?? ""} ${tool.id}`),
      },
      { id: "keywords", weight: 3, text: (tool) => normalizeSearchText(tool.keywords.join(" ")) },
    ],
    fullText: toolSearchText,
    contentWeight: 2,
    phraseBonus: 4,
    exactValues: (tool) => [normalizeSearchText(tool.actionLabel)],
    expandTokens: expansions.length ? (terms) => [...terms, ...expansions] : undefined,
    limit,
    tieBreak: (left, right) => left.title.localeCompare(right.title),
  }).map(({ record, score, signals }) => ({
    tool: record,
    score,
    reasons: [
      signals.fields.title ? "title" : "",
      signals.fields.keywords ? "keywords" : "",
      signals.content ? "description" : "",
    ].filter(Boolean),
  }));
}
