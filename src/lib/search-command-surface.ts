import type { AppModeId } from "@/lib/app-modes";
import { isSmartLocalOnlyMode, interpretSmartSearch } from "@/lib/smart-search-intent";
import { sharedHomePresentation } from "@/lib/ui-copy";

export type CommandSuggestion = {
  text: string;
  meta: string;
};

export type SearchCommandSurfaceConfig = {
  examples: string[];
  suggestions: CommandSuggestion[];
  crossModes: AppModeId[];
  /** Defaults to true. Set false when a mode's search contract is entirely local. */
  remoteSearchEnabled?: boolean;
};

export type CommandSurfacePlacement = "bottom-dock" | "inline";

export function commandDropdownMinimumWidthMediaQuery(placement: CommandSurfacePlacement) {
  const minimumWidth = placement === "bottom-dock" ? "640px" : "1024px";
  return `(min-width: ${minimumWidth})`;
}

export const commandDropdownPointerMediaQuery = "(hover: hover) and (pointer: fine)";

/**
 * The command panel is a desktop enhancement. Width alone is not enough to
 * identify that environment: phones can report a wide viewport in landscape,
 * display-zoom, or desktop-site modes. A fine pointer enables the panel on
 * hybrid desktops; a zero-touch fallback keeps headless/remote desktops usable
 * when the browser reports no pointer hardware at all.
 */
export function commandDropdownCanDisplay({
  minimumWidthMatches,
  pointerMatches,
  maxTouchPoints,
}: {
  minimumWidthMatches: boolean;
  pointerMatches: boolean;
  maxTouchPoints: number;
}) {
  return minimumWidthMatches && (pointerMatches || maxTouchPoints === 0);
}

const searchCommandSurfaceByMode: Partial<Record<AppModeId, SearchCommandSurfaceConfig>> = {
  documents: {
    examples: [...sharedHomePresentation.documents.suggestions],
    suggestions: [
      { text: "clozapine monitoring table", meta: "Tables" },
      { text: "clozapine ANC thresholds", meta: "Guidelines" },
      { text: "clozapine rechallenge criteria", meta: "Quotes" },
    ],
    crossModes: ["prescribing", "forms", "favourites"],
  },
  services: {
    examples: [...sharedHomePresentation.services.suggestions],
    suggestions: [
      { text: "crisis phone referral", meta: "Route" },
      { text: "crisis ATSI-specific", meta: "Eligibility" },
      { text: "crisis free statewide", meta: "Cost" },
    ],
    crossModes: ["documents", "favourites", "forms"],
  },
  forms: {
    examples: [...sharedHomePresentation.forms.suggestions],
    suggestions: [
      { text: "transport order form 4A", meta: "Forms" },
      { text: "transport order extension 4B", meta: "Forms" },
      { text: "transport pathway PSOLIS", meta: "Pathways" },
    ],
    crossModes: ["documents", "services", "favourites"],
  },
  differentials: {
    examples: [...sharedHomePresentation.differentials.suggestions],
    suggestions: [
      { text: "acute confusion / encephalopathy", meta: "Presentation" },
      { text: "confusion post-ictal", meta: "Presentation" },
      { text: "confusion Wernicke risk", meta: "Red flag" },
    ],
    crossModes: ["documents", "prescribing", "forms"],
  },
  dsm: {
    examples: [...sharedHomePresentation.dsm.suggestions],
    suggestions: [
      { text: "major depressive disorder", meta: "Diagnosis" },
      { text: "bipolar II disorder", meta: "Compare" },
      { text: "posttraumatic stress disorder", meta: "Criteria" },
    ],
    crossModes: ["differentials", "prescribing", "documents"],
  },
  prescribing: {
    examples: [...sharedHomePresentation.prescribing.suggestions],
    suggestions: [
      { text: "acamprosate renal dosing", meta: "Safety" },
      { text: "acamprosate ceiling 1,998 mg/day", meta: "Dose" },
      { text: "acamprosate vs naltrexone", meta: "Compare" },
    ],
    crossModes: ["documents", "differentials", "favourites"],
  },
  favourites: {
    examples: [...sharedHomePresentation.favourites.suggestions],
    suggestions: [
      { text: "ward round set", meta: "Sets" },
      { text: "ward round medication pages", meta: "Items" },
      { text: "ward round renal checks", meta: "Items" },
    ],
    crossModes: ["documents", "prescribing", "services"],
  },
  answer: {
    examples: [...sharedHomePresentation.answer.suggestions],
    suggestions: [
      { text: "lithium monitoring intervals", meta: "Guidelines" },
      { text: "clozapine rechallenge criteria", meta: "Safety" },
      { text: "QT prolongation risk medicines", meta: "Prescribing" },
    ],
    // Keep in sync with the post-answer cross-mode links strip, which covers
    // prescribing, services, forms, and differentials.
    crossModes: ["documents", "prescribing", "services", "forms", "differentials"],
  },
  specifiers: {
    examples: [...sharedHomePresentation.specifiers.suggestions],
    suggestions: [
      { text: "depressed but racing thoughts", meta: "Episode features" },
      { text: "returns every winter", meta: "Course and onset" },
      { text: "much better but not fully recovered", meta: "Severity and remission" },
    ],
    crossModes: ["dsm", "differentials", "formulation", "documents"],
  },
  formulation: {
    examples: [...sharedHomePresentation.formulation.suggestions],
    suggestions: [
      { text: "avoidance after panic", meta: "Mechanism" },
      { text: "rumination after rejection", meta: "Pattern" },
      { text: "dissociation under threat", meta: "Clinical clue" },
    ],
    crossModes: ["differentials", "documents", "answer"],
  },
  tools: {
    examples: [...sharedHomePresentation.tools.suggestions],
    suggestions: [
      { text: "renal function calculator", meta: "Calculator" },
      { text: "dose converter", meta: "Medication tool" },
      { text: "clinical forms", meta: "Directory" },
    ],
    crossModes: ["documents", "prescribing", "forms", "favourites"],
  },
  calculators: {
    examples: [...sharedHomePresentation.calculators.suggestions],
    suggestions: [
      { text: "depression severity", meta: "PHQ-9" },
      { text: "anxiety screening", meta: "GAD-7" },
      { text: "alcohol use", meta: "AUDIT-C" },
    ],
    crossModes: ["documents", "forms", "tools"],
    remoteSearchEnabled: false,
  },
  factsheets: {
    examples: [...sharedHomePresentation.factsheets.suggestions],
    suggestions: [
      { text: "sertraline (Zoloft)", meta: "Medications" },
      { text: "lithium monitoring", meta: "Tests & procedures" },
      { text: "CBT", meta: "Therapies" },
    ],
    crossModes: ["prescribing", "dsm", "documents"],
    remoteSearchEnabled: false,
  },
  dictionary: {
    // Every example is an entry that exists in the local catalogue
    // (src/lib/dictionary-data.ts), so the ticket never advertises a term the
    // search cannot resolve.
    examples: [...sharedHomePresentation.dictionary.suggestions],
    suggestions: [
      { text: "mental state examination", meta: "MSE" },
      { text: "auditory hallucination", meta: "Psychosis and perception" },
      { text: "ACT", meta: "Abbreviation" },
    ],
    crossModes: ["dsm", "documents", "answer"],
    // Dictionary owns a local static catalogue — see the mode definition in
    // src/lib/app-modes.ts — so the command panel must not query the remote index.
    remoteSearchEnabled: false,
  },
  sources: {
    examples: [...sharedHomePresentation.sources.suggestions],
    suggestions: [
      { text: "Australian guidelines", meta: "Catalogue" },
      { text: "RANZCP", meta: "Publisher" },
      { text: "review required", meta: "Quality band" },
    ],
    crossModes: ["documents", "dictionary", "answer"],
    remoteSearchEnabled: false,
  },
  "therapy-compass": {
    // Every example was run through the real scorer (`scoreTherapyCandidate`,
    // src/lib/therapy-ranking.ts) against the generated 205-record catalogue, so
    // the ticket never advertises a query the catalogue cannot answer — the same
    // rule the dictionary entry above states. Measured match counts at the time
    // of writing: trauma-focused CBT 188, behavioural activation 30, insomnia 4.
    examples: [...sharedHomePresentation["therapy-compass"].suggestions],
    suggestions: [
      { text: "trauma-focused CBT", meta: "Trauma" },
      { text: "behavioural activation", meta: "Mood" },
      { text: "insomnia", meta: "CBT" },
    ],
    crossModes: ["documents", "dsm", "answer"],
    // Therapy reads the local generated catalogue under
    // public/therapy-compass-data — like Dictionary and Calculators, its command
    // panel must not query the remote index.
    remoteSearchEnabled: false,
  },
  "on-call": {
    // On Call reads its own operational catalogue — see the mode definition in
    // src/lib/app-modes.ts — so its command panel must not query the remote index.
    examples: [...sharedHomePresentation["on-call"].suggestions],
    suggestions: [
      { text: "after-hours registrar", meta: "Contacts" },
      { text: "acute behavioural disturbance", meta: "Pathways" },
      { text: "ward 4B number", meta: "Contacts" },
    ],
    crossModes: ["services", "forms", "documents"],
    remoteSearchEnabled: false,
  },
  cme: {
    // CME reads the owner's own continuing-education entries, already in the
    // browser — see the mode definition in src/lib/app-modes.ts — so its command
    // panel must not query the remote index.
    examples: [...sharedHomePresentation.cme.suggestions],
    suggestions: [
      { text: "peer review group", meta: "Routines" },
      { text: "journal club", meta: "Routines" },
      { text: "audit", meta: "Log" },
    ],
    crossModes: ["documents", "sources", "on-call"],
    remoteSearchEnabled: false,
  },
  teaching: {
    // Session titles only, and never the remote index: nothing personal
    // (logbook, attendance, supervision, members) is ever part of a query
    // (plan contracts §8).
    examples: [...sharedHomePresentation.teaching.suggestions],
    suggestions: [
      { text: "grand round", meta: "Sessions" },
      { text: "journal club", meta: "Sessions" },
      { text: "case conference", meta: "Sessions" },
    ],
    crossModes: ["cme", "on-call", "documents"],
    remoteSearchEnabled: false,
  },
  psychiatry: {
    // Psychiatry is a dashboard of links to the sections it gathers, each of
    // which keeps its own search, so its command panel must not query the
    // remote index; the cross-modes are those sections.
    examples: [...sharedHomePresentation.psychiatry.suggestions],
    suggestions: [
      { text: "major depressive disorder", meta: "DSM-5 Diagnosis" },
      { text: "behavioural activation", meta: "Therapy" },
      { text: "Form 1A", meta: "Forms" },
    ],
    crossModes: ["dsm", "therapy-compass", "forms"],
    remoteSearchEnabled: false,
  },
  "my-work": {
    // Admin (formerly My Work) reads the owner's own records, already in the
    // browser, so its command panel must not query the remote index. Nothing
    // from Admin goes to search (spec).
    examples: [...sharedHomePresentation["my-work"].suggestions],
    suggestions: [
      { text: "registration", meta: "Renewals" },
      { text: "leaving", meta: "New job" },
      { text: "payroll", meta: "Help" },
    ],
    crossModes: ["on-call", "cme", "documents"],
    remoteSearchEnabled: false,
  },
  roster: {
    // Roster reads the owner's own shifts, already in the browser — see the
    // mode definition in src/lib/app-modes.ts — so its command panel must not
    // query the remote index.
    examples: [...sharedHomePresentation.roster.suggestions],
    suggestions: [
      { text: "night shift hours", meta: "Hours" },
      { text: "next weekend off", meta: "Today" },
      { text: "import my roster", meta: "Shifts" },
    ],
    crossModes: ["my-work", "on-call", "cme"],
    remoteSearchEnabled: false,
  },
  "first-nations": {
    // The mode owns its own in-page search box on every page (standard §13),
    // so its command panel must not query the remote index either.
    examples: [...sharedHomePresentation["first-nations"].suggestions],
    suggestions: [
      { text: "Call Aboriginal liaison", meta: "Bedside" },
      { text: "Common mistakes", meta: "On the ward" },
      { text: "Mental Health Act s 81", meta: "Talking" },
    ],
    crossModes: ["on-call", "services", "forms"],
    remoteSearchEnabled: false,
  },
  "my-day": {
    // My Day gathers the owner's own records from other modes, already in the
    // browser, so its command panel must not query the remote index.
    examples: [...sharedHomePresentation["my-day"].suggestions],
    suggestions: [
      { text: "overdue", meta: "My Day" },
      { text: "due soon", meta: "My Day" },
      { text: "coming up", meta: "My Day" },
    ],
    crossModes: ["on-call", "roster", "my-work"],
    remoteSearchEnabled: false,
  },
  medicines: {
    // Like Psychiatry, a dashboard of links to the sections it gathers, each of
    // which keeps its own search, so its command panel must not query the
    // remote index; the cross-modes are those sections.
    examples: [...sharedHomePresentation.medicines.suggestions],
    suggestions: [
      { text: "lithium monitoring", meta: "Medication" },
      { text: "clozapine", meta: "Medication" },
      { text: "valproate", meta: "Medication" },
    ],
    crossModes: ["prescribing", "calculators", "tools"],
    remoteSearchEnabled: false,
  },
};

export function searchCommandSurfaceConfig(modeId: AppModeId): SearchCommandSurfaceConfig | null {
  return searchCommandSurfaceByMode[modeId] ?? null;
}

export function commandSurfaceRemoteSearchEnabled(modeId: AppModeId, smartNaturalLanguage = false) {
  if (smartNaturalLanguage && isSmartLocalOnlyMode(modeId)) return false;
  const config = searchCommandSurfaceConfig(modeId);
  return Boolean(config && config.remoteSearchEnabled !== false);
}

export function filterCommandSurfaceCrossModesForSmartSearch(
  modeId: AppModeId,
  query: string,
  modeIds: readonly AppModeId[],
): AppModeId[] {
  if (!isSmartLocalOnlyMode(modeId) || !interpretSmartSearch(modeId, query).naturalLanguage) return [...modeIds];
  return modeIds.filter((targetModeId) => !["documents", "answer", "favourites"].includes(targetModeId));
}

export const differentialRedFlagTerms = ["confusion", "overdose", "suicid", "chest pain", "unresponsive", "catatoni"];

export function isFormCodeQuery(query: string) {
  const codeQuery = query.replace(/^form\s+/i, "").trim();
  return /^\d{1,2}[a-z]?$/i.test(codeQuery);
}

export function filteredSuggestions(config: SearchCommandSurfaceConfig, query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  return config.suggestions.filter(
    (entry) =>
      entry.text.toLowerCase().includes(trimmed) ||
      trimmed.split(/\s+/).every((token) => entry.text.toLowerCase().includes(token)),
  );
}
