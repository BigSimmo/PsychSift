import { canAccessFavouritesMode } from "@/lib/app-modes";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
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
  | "guidelines"
  | "risk-safety"
  | "medication-prescribing"
  | "services"
  | "forms"
  | "care-plans"
  | "safety-plan"
  | "calculators"
  | "monitoring"
  | "caring-contacts"
  | "favourites"
  | "ward-management";

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

export const toolCatalogRecords: ToolCatalogRecord[] = [
  {
    id: "clinical-kb-search",
    title: "Clinical KB Search",
    mobileTitle: "Clinical KB",
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
    href: "/differentials",
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
    href: "/dictionary",
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
    href: "/services",
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
    id: "ward-management",
    title: "Ward Flow",
    mobileTitle: "Ward Flow",
    description: "Coordinate synthetic psychiatry demand, bed capacity, referrals, and patient movement across WA.",
    bestFor: "Statewide mental-health patient flow",
    detail:
      "Review a synthetic priority queue, scan current ward capacity, inspect explainable destination matches, and confirm the next owned movement action.",
    href: "/ward-management",
    area: "coordination",
    status: "ready",
    sourceBacked: false,
    highYield: true,
    actionLabel: "Coordinate",
    keywords: [
      "ward",
      "ward flow",
      "bed management",
      "bed availability",
      "psychiatry",
      "patient flow",
      "hospital coordination",
      "ED transfer",
      "catchment",
      "MHPF",
      "WACHS",
    ],
    checkFirst: [
      "Human urgency tier and elapsed wait",
      "Catchment and required ward setting",
      "Legal, handover, and transport readiness",
      "Last-confirmed ward capacity",
    ],
    neededInput: [
      "Synthetic movement identifier",
      "Cohort, catchment, and open or secure setting",
      "Referral, legal, and transport status",
    ],
    output: "An explainable destination shortlist and human-confirmed patient movement plan.",
  },
  {
    id: "forms",
    title: "Forms",
    description: "Find clinical forms and source-backed readiness pathways.",
    bestFor: "Forms and workflows",
    detail: "Open form search, readiness checks, pathway tasks, and source-backed records.",
    href: "/forms",
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
    description: "Create and review management plans with monitoring and follow-up.",
    bestFor: "Ongoing care planning",
    detail: "Structure care planning, review milestones, monitoring needs, and follow-up tasks.",
    href: "/?mode=answer&q=care%20plan&focus=1",
    area: "care",
    status: "ready",
    sourceBacked: true,
    highYield: true,
    actionLabel: "Open",
    keywords: ["care plan", "management", "follow-up", "monitoring"],
    checkFirst: ["Goals of care", "Review date", "Monitoring responsibilities"],
    neededInput: ["Diagnosis or working problem", "Current plan", "Follow-up timeframe"],
    output: "Care-plan structure, review points, and monitoring prompts.",
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
    description: "Score psychiatry rating scales and clinical decision calculators with source-cited guidance.",
    bestFor: "Bedside scoring and severity banding",
    detail:
      "Search and complete clinical calculators (PHQ-9, GAD-7, CSSRS, and related scales). Scores support clinical judgement and cite their source — they never replace a full assessment.",
    href: "/calculators",
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
      "cssrs",
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
    description: "Track and review key monitoring parameters and results.",
    bestFor: "Ongoing monitoring",
    detail: "Review monitoring intervals, parameters, alerts, and follow-up actions.",
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
    // The one card that is the front door to a standalone workspace. Caring Contacts owns
    // its own navigation once you are inside it, so this catalogue entry is the only place
    // the host application names it — see docs/codebase-index.md.
    id: "caring-contacts",
    title: "Caring Contacts",
    description: "A synthetic demonstration of caring-contact follow-up after a hospital stay.",
    bestFor: "Seeing how caring-contact follow-up is coordinated",
    detail:
      "A working demonstration built on invented patients and invented numbers. Nothing in it is ever sent to a real number, and none of it is patient data.",
    href: CARING_CONTACTS_ROUTES.today,
    area: "coordination",
    status: "ready",
    sourceBacked: false,
    actionLabel: "Open",
    keywords: ["caring contacts", "follow-up", "aftercare", "discharge", "coordination", "demonstration"],
    checkFirst: ["Everything shown is invented", "No message is ever sent", "Not a clinical record"],
    neededInput: ["Nothing — the workspace carries its own synthetic examples"],
    output: "A demonstration workspace showing how caring-contact follow-up is coordinated.",
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

export function toolCatalogRecordById(id: string): ToolCatalogRecord {
  return toolCatalogRecords.find((tool) => tool.id === id) ?? toolCatalogRecords[0];
}

/** Hide account-scoped Favourites / Saved workflows from guest Tools surfaces. */
export function toolCatalogRecordsForSession(options: { authenticated: boolean; demoMode: boolean }) {
  if (canAccessFavouritesMode(options)) return toolCatalogRecords;
  return toolCatalogRecords.filter((tool) => tool.id !== "favourites" && !tool.href.startsWith("/favourites"));
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
