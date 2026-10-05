import type { ClinicalQueryMode } from "@/lib/types";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import { consolidatedModeHomeModeIds, consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { appendSearchNavigationContext, type SearchNavigationOptions } from "@/lib/search-navigation-context";

export const appModeIds = [
  "answer",
  "documents",
  "services",
  "forms",
  "favourites",
  "differentials",
  "dsm",
  "specifiers",
  "formulation",
  "prescribing",
  "tools",
  "calculators",
  "therapy-compass",
  "factsheets",
  "dictionary",
  "sources",
  "on-call",
  "cme",
  "teaching",
  "psychiatry",
  "my-work",
  "roster",
  "first-nations",
  "my-day",
  "medicines",
] as const;

export type AppModeId = (typeof appModeIds)[number];
export type SearchableAppModeId = AppModeId;

export type AppModeSearchKind =
  | "answer"
  | "documents"
  | "services"
  | "forms"
  | "favourites"
  | "differentials"
  | "dsm"
  | "specifiers"
  | "formulation"
  | "therapies"
  | "calculators"
  | "tools";
export type AppModeResultKind = AppModeSearchKind;

/**
 * How a mode presents what a search found.
 *
 * `"none"` is a real answer, not a gap: On Call declares no search surface at
 * all — it has no composer on any route, no results page, and filter chips
 * inside a page do the narrowing. It still carries the rest of `search` because
 * the universal command surface and the shared home read the mode's copy, but
 * there is no result list, so the band-adoption contract must not look for one.
 * Anything that presents a LIST is still `"results-band"`, and the band stays
 * mandatory for it.
 */
export type AppModeResultsSurface = "results-band" | "answer" | "none";

export type AppModeSearchConfig = {
  kind: AppModeSearchKind;
  placeholder: string;
  inputAriaLabel: string;
  submitIdleLabel: string;
  submitBusyLabel: string;
  submitAriaLabel: string;
  emptyTitle: string;
  readyTitle: string;
  progressLabel: string;
  resultKind: AppModeResultKind;
  /** Does this mode present a result LIST (which must wear the shared results
      band) or a synthesised answer? Required and non-optional on purpose: a new
      mode cannot compile until its author states which surface it is, and the
      band-adoption contract test reads this to know what it must find. */
  resultsSurface: AppModeResultsSurface;
  resultHeading: string;
  statusLabel: string;
  nextStep: string;
  badgeLabel: string | null;
  defaultQueryMode?: ClinicalQueryMode;
};

export type AppModeDefinition = {
  id: AppModeId;
  label: string;
  description: string;
  devOnly?: boolean;
  href?: string;
  /** Staff work modes show the "Search my work" icon in the header, which searches
      all of them at once. Declared here rather than as a list of mode ids in the
      header, for the same reason `resultsSurface` is: the header must not grow a
      `searchMode === "…"` branch. */
  workSearch?: true;
  search: AppModeSearchConfig;
};

/** Canonical destinations for the Factsheets local search and category browse surfaces. */
export const factsheetsSearchHref = "/factsheets/search";
export const factsheetsTopicsHref = "/factsheets/topics";

/** Canonical destination for the DSM diagnosis catalogue search surface. */
export const dsmSearchHref = "/dsm/search";

export const appModeDefinitions = [
  {
    id: "answer",
    label: "Answer",
    description: "Source-backed clinical answer",
    search: {
      kind: "answer",
      placeholder: "Ask a clinical question...",
      inputAriaLabel: "Ask a source-backed clinical question",
      submitIdleLabel: "Ask",
      submitBusyLabel: "Answer",
      submitAriaLabel: "Generate source-backed answer",
      emptyTitle: "Enter a clinical question",
      readyTitle: "Generate a source-backed answer",
      progressLabel: "Searching indexed documents.",
      resultKind: "answer",
      resultHeading: "Answer",
      resultsSurface: "answer",
      statusLabel: "Answer",
      nextStep: "Ask a question first",
      badgeLabel: "?",
    },
  },
  {
    id: "documents",
    label: "Documents",
    description: "Find source PDFs, notes, and evidence passages",
    // Documents owns a real home at /documents so it is reachable from nav like
    // every other mode. `/` is the shared home for all modes and no longer renders
    // any one mode's content. A query still routes to /documents/search below.
    href: "/documents",
    search: {
      kind: "documents",
      placeholder: "Search source documents...",
      inputAriaLabel: "Search indexed source documents",
      submitIdleLabel: "Docs",
      submitBusyLabel: "Docs",
      submitAriaLabel: "Find matching documents",
      emptyTitle: "Enter a document search term",
      readyTitle: "Find matching source documents",
      progressLabel: "Finding matching documents.",
      resultKind: "documents",
      resultHeading: "Document matches",
      resultsSurface: "results-band",
      statusLabel: "Docs",
      nextStep: "Open a source document or evidence passage",
      badgeLabel: null,
    },
  },
  {
    id: "services",
    label: "Services",
    description: "Service records and referral pathways",
    href: "/services",
    search: {
      kind: "services",
      placeholder: "Search services...",
      inputAriaLabel: "Search services, source records, pathways, and criteria",
      submitIdleLabel: "Services",
      submitBusyLabel: "Services",
      submitAriaLabel: "Search services",
      emptyTitle: "Enter a service search term",
      readyTitle: "Search services",
      progressLabel: "Searching service records.",
      resultKind: "services",
      resultHeading: "Service matches",
      resultsSurface: "results-band",
      statusLabel: "Services",
      nextStep: "Review matching service records",
      badgeLabel: null,
    },
  },
  {
    id: "forms",
    label: "Forms",
    description: "Clinical forms and pathways",
    href: "/forms",
    search: {
      // Forms are a registry catalogue, not corpus documents. Declaring the honest kind
      // removes the ClinicalDashboard special-casing that the old kind:"documents" forced.
      kind: "forms",
      placeholder: "Search forms...",
      inputAriaLabel: "Search forms, source records, pathways, and criteria",
      submitIdleLabel: "Forms",
      submitBusyLabel: "Forms",
      submitAriaLabel: "Search forms",
      emptyTitle: "Enter a form search term",
      readyTitle: "Search forms",
      progressLabel: "Searching form records.",
      resultKind: "forms",
      resultHeading: "Form matches",
      resultsSurface: "results-band",
      statusLabel: "Forms",
      nextStep: "Review matching form records",
      badgeLabel: null,
    },
  },
  {
    id: "favourites",
    label: "Favourites",
    description: "Saved clinical items and sets",
    href: "/favourites",
    search: {
      kind: "favourites",
      placeholder: "Search favourites...",
      inputAriaLabel: "Search saved favourites",
      submitIdleLabel: "Faves",
      submitBusyLabel: "Faves",
      submitAriaLabel: "Search favourites",
      emptyTitle: "Search saved favourites",
      readyTitle: "Browse favourites",
      progressLabel: "Filtering favourites.",
      resultKind: "favourites",
      resultHeading: "Favourites",
      resultsSurface: "results-band",
      statusLabel: "Favourites",
      nextStep: "Open a saved item",
      badgeLabel: null,
    },
  },
  {
    id: "differentials",
    label: "Differentials",
    description: "Compare causes and clinical clues",
    href: "/differentials",
    search: {
      kind: "differentials",
      placeholder: "Ask or search a presentation...",
      inputAriaLabel: "Search differential presentations, symptoms, and scenarios",
      submitIdleLabel: "Diffs",
      submitBusyLabel: "Diffs",
      submitAriaLabel: "Search differential presentations",
      emptyTitle: "Start a differential search",
      readyTitle: "Search differential presentations",
      progressLabel: "Searching differential source records.",
      resultKind: "differentials",
      resultHeading: "Differentials",
      resultsSurface: "results-band",
      statusLabel: "Diffs",
      nextStep: "Search or compare differentials",
      badgeLabel: null,
      defaultQueryMode: "compare_guidance",
    },
  },
  {
    id: "dsm",
    label: "DSM-5 Diagnosis",
    description: "Diagnostic criteria, specifiers, and comparisons",
    href: "/dsm",
    search: {
      kind: "dsm",
      placeholder: "Search DSM diagnoses or criteria...",
      inputAriaLabel: "Search DSM diagnoses, ICD codes, criteria, and categories",
      submitIdleLabel: "DSM",
      submitBusyLabel: "DSM",
      submitAriaLabel: "Search DSM diagnoses",
      emptyTitle: "Search DSM diagnoses",
      readyTitle: "Search DSM diagnosis criteria",
      progressLabel: "Searching the local DSM diagnosis catalogue.",
      resultKind: "dsm",
      resultHeading: "DSM diagnoses",
      resultsSurface: "results-band",
      statusLabel: "DSM",
      nextStep: "Open a diagnosis or compare criteria",
      badgeLabel: null,
    },
  },
  {
    id: "specifiers",
    label: "Specifiers",
    description: "Refine diagnostic wording and episode patterns",
    href: "/specifiers",
    search: {
      kind: "specifiers",
      placeholder: "Describe the presentation or search a specifier...",
      inputAriaLabel: "Search psychiatric specifiers by presentation or diagnosis",
      submitIdleLabel: "Find",
      submitBusyLabel: "Find",
      submitAriaLabel: "Find matching psychiatric specifiers",
      emptyTitle: "Describe the presentation",
      readyTitle: "Find the most relevant specifier",
      progressLabel: "Matching presentation features to specifiers.",
      resultKind: "specifiers",
      resultHeading: "Specifier matches",
      resultsSurface: "results-band",
      statusLabel: "Specifiers",
      nextStep: "Check fit and refine the diagnostic wording",
      badgeLabel: null,
    },
  },
  {
    id: "formulation",
    label: "Formulation",
    description: "Build and test clinical mechanism hypotheses",
    href: "/formulation",
    search: {
      kind: "formulation",
      placeholder: "Describe a pattern or clinical clue...",
      inputAriaLabel: "Search formulation mechanisms by pattern or patient language",
      submitIdleLabel: "Find",
      submitBusyLabel: "Find",
      submitAriaLabel: "Find matching formulation mechanisms",
      emptyTitle: "Describe a clinical pattern",
      readyTitle: "Find a testable mechanism hypothesis",
      progressLabel: "Matching clinical clues to formulation mechanisms.",
      resultKind: "formulation",
      resultHeading: "Mechanism matches",
      resultsSurface: "results-band",
      statusLabel: "Formulation",
      nextStep: "Check fit, alternatives, and treatment leverage",
      badgeLabel: null,
    },
  },
  {
    id: "prescribing",
    label: "Medication",
    description: "Medication dosing, safety, and monitoring checks",
    // Like most other modes, /medications is a redirect: unsubmitted, it forwards
    // to the shared home at /?mode=prescribing; a submitted search resolves to
    // /?mode=prescribing&q=…&run=1, which stays dashboard-owned. It is deliberately
    // NOT in consolidatedModeHomePaths (@/lib/consolidated-mode-home-redirect) —
    // there is no /medications/search route, so its own bespoke redirect in
    // medications/page.tsx (mirrored in src/proxy.ts) handles both branches instead.
    href: "/medications",
    search: {
      // Deliberately kind:"documents" (unlike forms): prescribing intentionally searches the
      // document corpus for dosing/threshold guidance (defaultQueryMode dose_threshold_lookup).
      // The medication registry joins cross-entity search via /api/search/universal instead.
      kind: "documents",
      placeholder: "Search medication dosing or safety...",
      inputAriaLabel: "Search medication dosing, safety, and monitoring guidance",
      submitIdleLabel: "Meds",
      submitBusyLabel: "Meds",
      submitAriaLabel: "Search medication prescribing guidance",
      emptyTitle: "Enter a medication search term",
      readyTitle: "Search medication prescribing guidance",
      progressLabel: "Searching medication guidance.",
      resultKind: "documents",
      resultHeading: "Medication matches",
      resultsSurface: "results-band",
      statusLabel: "Meds",
      nextStep: "Review medication guidance",
      badgeLabel: null,
      defaultQueryMode: "dose_threshold_lookup",
    },
  },
  {
    id: "tools",
    label: "Tools",
    description: "Clinical tools and applications",
    // PT-11: standalone /tools is the canonical entry; the older /?mode=tools
    // bookmarks and deep links redirect to it.
    href: "/tools",
    search: {
      kind: "tools",
      placeholder: "Search tools...",
      inputAriaLabel: "Search clinical tools and applications",
      submitIdleLabel: "Tools",
      submitBusyLabel: "Tools",
      submitAriaLabel: "Search tools",
      emptyTitle: "Browse tools",
      readyTitle: "Search clinical tools",
      progressLabel: "Searching tools.",
      resultKind: "tools",
      resultHeading: "Tools",
      resultsSurface: "results-band",
      statusLabel: "Tools",
      nextStep: "Launch a tool",
      badgeLabel: null,
    },
  },
  {
    id: "calculators",
    label: "Calculators",
    description: "Source-cited psychiatry scores and clinical decision calculators",
    href: "/calculators",
    search: {
      kind: "calculators",
      placeholder: "Search calculators by scale, symptom, or indication...",
      inputAriaLabel: "Search clinical calculators by scale, symptom, or indication",
      submitIdleLabel: "Calculate",
      submitBusyLabel: "Calculate",
      submitAriaLabel: "Search clinical calculators",
      emptyTitle: "Search clinical calculators",
      readyTitle: "Find a clinical calculator",
      progressLabel: "Searching the local calculator catalogue.",
      resultKind: "calculators",
      resultHeading: "Calculator matches",
      resultsSurface: "results-band",
      statusLabel: "Calculators",
      nextStep: "Open a calculator to score it and review next actions",
      badgeLabel: null,
    },
  },
  {
    id: "therapy-compass",
    label: "Therapy",
    description: "Source-grounded therapy reference",
    href: "/therapy-compass",
    // Therapy ships in production with its review state disclosed rather than
    // hidden. It was previously `devOnly`, which 404'd the route and every
    // record for real users; the owner's decision is that a catalogue labelled
    // "needs source review" on the library notice, every result card and every
    // record page is more useful — and no less honest — than an absent mode.
    // Per-record sign-off is still tracked by `therapyNeedsReview` and surfaced
    // everywhere the record appears; it no longer gates reachability.
    search: {
      kind: "therapies",
      // The longer phrase became the late portal's LCP element on Therapy Home.
      // Keep the full search scope in the accessible name below; the concise
      // visible prompt lets the already-painted hero remain the LCP owner.
      placeholder: "Search therapies...",
      inputAriaLabel: "Search therapies by problem, symptom, skill, or population",
      submitIdleLabel: "Therapy",
      submitBusyLabel: "Therapy",
      submitAriaLabel: "Open Therapy",
      emptyTitle: "Browse the therapy library",
      readyTitle: "Search source-grounded therapies",
      progressLabel: "Loading the therapy library.",
      resultKind: "therapies",
      resultHeading: "Therapies",
      resultsSurface: "results-band",
      statusLabel: "Therapy",
      nextStep: "Open a therapy record",
      badgeLabel: null,
    },
  },
  {
    id: "factsheets",
    label: "Factsheets",
    description: "Plain-language patient information to read, save, and print",
    href: "/factsheets",
    search: {
      // Factsheets owns its own in-tool search over the local patient-information
      // library (not the document corpus), so it borrows the benign "tools" search
      // kind — like Therapy Compass — while keeping the shared composer visible.
      kind: "tools",
      placeholder: "Search a medicine, condition, therapy or test...",
      inputAriaLabel: "Search patient information factsheets",
      submitIdleLabel: "Sheets",
      submitBusyLabel: "Sheets",
      submitAriaLabel: "Search patient information factsheets",
      emptyTitle: "Search patient information",
      readyTitle: "Find a patient factsheet",
      progressLabel: "Searching patient factsheets.",
      resultKind: "tools",
      resultHeading: "Factsheets",
      resultsSurface: "results-band",
      statusLabel: "Factsheets",
      nextStep: "Open a factsheet to read, save, or print",
      badgeLabel: null,
    },
  },
  {
    id: "dictionary",
    label: "Dictionary",
    description: "Source-governed clinical terms, abbreviations, and related concepts",
    href: "/dictionary",
    search: {
      // Dictionary owns a local static catalogue. The shared composer uses the
      // benign tools command kind, then appModeHomeHref routes into its results.
      kind: "tools",
      placeholder: "Search a term or abbreviation...",
      inputAriaLabel: "Search clinical terms, abbreviations, and topics",
      submitIdleLabel: "Terms",
      submitBusyLabel: "Terms",
      submitAriaLabel: "Search the clinical dictionary",
      emptyTitle: "Search the clinical dictionary",
      readyTitle: "Find a clinical term",
      progressLabel: "Searching source-linked dictionary entries.",
      resultKind: "tools",
      resultHeading: "Dictionary results",
      resultsSurface: "results-band",
      statusLabel: "Dictionary",
      nextStep: "Open a term, browse the catalogue, or compare definitions",
      badgeLabel: null,
    },
  },
  {
    id: "sources",
    label: "Sources",
    description: "Ranked clinical source catalogue and traceability",
    href: "/sources",
    search: {
      kind: "tools",
      placeholder: "Search sources, publishers, or topics...",
      inputAriaLabel: "Search sources, publishers, or topics",
      submitIdleLabel: "Sources",
      submitBusyLabel: "Sources",
      submitAriaLabel: "Search sources",
      emptyTitle: "Search sources",
      readyTitle: "Search the clinical source catalogue",
      progressLabel: "Searching the source catalogue.",
      resultKind: "tools",
      resultHeading: "Sources",
      resultsSurface: "results-band",
      statusLabel: "Sources",
      nextStep: "Filter by quality, location, publisher, topic, or usage",
      badgeLabel: null,
    },
  },
  {
    id: "on-call",
    workSearch: true,
    label: "On Call",
    description: "Your service's contacts, escalation, orientation and teaching",
    href: "/on-call",
    search: {
      // On Call searches the owner's own operational entries, which are already
      // in the browser — a local catalogue, like Factsheets and Dictionary — so
      // it borrows the benign "tools" command kind rather than adding a search
      // kind that would have to be threaded through universal search.
      kind: "tools",
      placeholder: "Search a ward, a number, a service, a session...",
      inputAriaLabel: "Search your on-call information",
      submitIdleLabel: "On Call",
      submitBusyLabel: "On Call",
      submitAriaLabel: "Search your on-call information",
      emptyTitle: "Search your on-call information",
      readyTitle: "Find a number, a pathway or a session",
      progressLabel: "Searching your on-call entries.",
      resultKind: "tools",
      resultHeading: "On Call",
      // No results page: `/on-call` is a dashboard and `/on-call/search` is
      // gone. See the union's own note above.
      resultsSurface: "none",
      statusLabel: "On Call",
      nextStep: "Open an entry",
      badgeLabel: null,
    },
  },
  {
    id: "cme",
    workSearch: true,
    label: "CPD",
    description: "Your continuing education: what you have done, and what is still short",
    href: "/cme",
    search: {
      // CME reads the owner's own entries, already in the browser — a local
      // catalogue, like On Call — so it borrows the benign "tools" command kind
      // rather than adding a search kind that would have to be threaded through
      // universal search.
      kind: "tools",
      placeholder: "Search your log — a meeting, an audit, a course...",
      inputAriaLabel: "Search your continuing education log",
      submitIdleLabel: "CPD",
      submitBusyLabel: "CPD",
      submitAriaLabel: "Search your continuing education log",
      emptyTitle: "Search your continuing education log",
      readyTitle: "Find an activity, a certificate or a reflection",
      progressLabel: "Searching your log.",
      resultKind: "tools",
      resultHeading: "CPD",
      // No results page. `/cme` is a dashboard and there is no `/cme/search`:
      // a retargeted composer would accept a query and land the reader on a
      // page that ignores it.
      resultsSurface: "none",
      statusLabel: "CPD",
      nextStep: "Open an entry",
      badgeLabel: null,
    },
  },
  {
    id: "teaching",
    workSearch: true,
    label: "Teaching",
    description: "Your hospital's teaching: this week's sessions, check-in and your attendance record",
    href: "/teaching",
    search: {
      // Teaching searches nothing personal. Text typed in the main search bar
      // leaves the app (it is sent for answer generation), so this mode points
      // the placeholder at session titles only, and no logbook, attendance,
      // supervision or member data is ever part of a query (plan contracts §8).
      // It borrows the benign "tools" command kind, as CPD and On Call do.
      kind: "tools",
      placeholder: "Find a session by title: grand round, journal club...",
      inputAriaLabel: "Find a teaching session by title",
      submitIdleLabel: "Teaching",
      submitBusyLabel: "Teaching",
      submitAriaLabel: "Find a teaching session by title",
      emptyTitle: "Find a teaching session",
      readyTitle: "Find a session by its title",
      progressLabel: "Opening Teaching.",
      resultKind: "tools",
      resultHeading: "Teaching",
      // No results page. `/teaching` is a dashboard, like `/cme`.
      resultsSurface: "none",
      statusLabel: "Teaching",
      nextStep: "Open a session",
      badgeLabel: null,
    },
  },
  {
    id: "psychiatry",
    label: "Psychiatry",
    description: "Diagnosis, specifiers, formulation, therapy and Mental Health Act forms in one place",
    href: "/psychiatry",
    search: {
      // Psychiatry is a landing page that gathers existing modes; it has no
      // catalogue of its own, so it borrows the benign "tools" command kind,
      // as On Call and CME do.
      kind: "tools",
      placeholder: "Open a psychiatry section...",
      inputAriaLabel: "Open a psychiatry section",
      submitIdleLabel: "Psychiatry",
      submitBusyLabel: "Psychiatry",
      submitAriaLabel: "Open a psychiatry section",
      emptyTitle: "Choose a psychiatry section",
      readyTitle: "Diagnosis, formulation, therapy and forms",
      progressLabel: "Opening the section.",
      resultKind: "tools",
      resultHeading: "Psychiatry",
      // No results page. `/psychiatry` is a dashboard of links to the
      // sections it gathers, each of which keeps its own search.
      resultsSurface: "none",
      statusLabel: "Psychiatry",
      nextStep: "Open a section",
      badgeLabel: null,
    },
  },
  {
    id: "medicines",
    label: "Medicines & tools",
    description: "Medication, calculators, clinical tools, factsheets and the dictionary in one place",
    href: "/medicines",
    search: {
      // Like Psychiatry, a landing page that gathers existing modes, each of
      // which keeps its own search; it borrows the benign "tools" kind.
      kind: "tools",
      placeholder: "Open a medicines or tools section...",
      inputAriaLabel: "Open a medicines or tools section",
      submitIdleLabel: "Medicines",
      submitBusyLabel: "Medicines",
      submitAriaLabel: "Open a medicines or tools section",
      emptyTitle: "Choose a section",
      readyTitle: "Medication, calculators, tools and reference",
      progressLabel: "Opening the section.",
      resultKind: "tools",
      resultHeading: "Medicines & tools",
      // No results page. `/medicines` is a dashboard of links to the sections
      // it gathers, as `/psychiatry` is.
      resultsSurface: "none",
      statusLabel: "Medicines",
      nextStep: "Open a section",
      badgeLabel: null,
    },
  },
  {
    id: "my-work",
    workSearch: true,
    label: "Admin",
    description: "The paperwork around hospital work: renewals, starting and leaving a job, and where to get help",
    // Opens on Renewals, Admin's working page (modes review, phase 2b): My Day is
    // the one Today. `/admin` still serves the old Today page for bookmarks until
    // it can be retired.
    href: "/admin/renewals",
    search: {
      // Admin has no catalogue of its own; it borrows the benign "tools" kind, as Psychiatry does.
      kind: "tools",
      placeholder: "Open an Admin page...",
      inputAriaLabel: "Open an Admin page",
      submitIdleLabel: "Admin",
      submitBusyLabel: "Admin",
      submitAriaLabel: "Open an Admin page",
      emptyTitle: "Choose an Admin page",
      readyTitle: "Today, renewals, new job and help",
      progressLabel: "Opening the page.",
      resultKind: "tools",
      resultHeading: "Admin",
      // No results page. `/admin` is Today: what to start, what is coming up, what is next.
      resultsSurface: "none",
      statusLabel: "Admin",
      nextStep: "Open a page",
      badgeLabel: null,
    },
  },
  {
    id: "roster",
    workSearch: true,
    label: "Roster",
    description: "Your own shifts: imported, or added by hand, with Today, Shifts and Settings",
    href: "/roster",
    search: {
      // Roster reads the owner's own shifts, already in the browser — a local
      // catalogue, like On Call and CME — so it borrows the benign "tools"
      // command kind rather than adding a search kind that would have to be
      // threaded through universal search.
      kind: "tools",
      placeholder: "Search your shifts...",
      inputAriaLabel: "Search your own roster",
      submitIdleLabel: "Roster",
      submitBusyLabel: "Roster",
      submitAriaLabel: "Search your own roster",
      emptyTitle: "Search your own roster",
      readyTitle: "Find a shift, a workplace or a calendar link",
      progressLabel: "Searching your shifts.",
      resultKind: "tools",
      resultHeading: "Roster",
      // No results page. `/roster` is a dashboard (Today), and there is no
      // `/roster/search`: a retargeted composer would accept a query and land
      // the reader on a page that ignores it.
      resultsSurface: "none",
      statusLabel: "Roster",
      nextStep: "Open Today, Shifts or Settings",
      badgeLabel: null,
    },
  },
  {
    id: "first-nations",
    label: "First Nations",
    description: "Culturally safe care for Aboriginal and Torres Strait Islander patients",
    href: "/first-nations",
    search: {
      // The mode owns its own in-page search box on every page (standard §13),
      // so the shared composer must not query the remote index for it.
      kind: "tools",
      placeholder: "Search First Nations",
      inputAriaLabel: "Search First Nations",
      submitIdleLabel: "First Nations",
      submitBusyLabel: "First Nations",
      submitAriaLabel: "Search First Nations",
      emptyTitle: "Choose a First Nations page",
      readyTitle: "Culturally safe care for Aboriginal and Torres Strait Islander patients",
      progressLabel: "Opening the page.",
      resultKind: "tools",
      resultHeading: "First Nations",
      // No results page. The mode home and every section keep their own
      // in-page search box; a retargeted composer would accept a query and
      // land the reader on a page that ignores it.
      resultsSurface: "none",
      statusLabel: "First Nations",
      nextStep: "Open a page",
      badgeLabel: null,
    },
  },
  {
    id: "my-day",
    workSearch: true,
    label: "My Day",
    description: "One list of what needs you today across On Call, Roster, CPD, Teaching and Admin",
    href: "/my-day",
    search: {
      // My Day reads the owner's own records from the modes it gathers, already
      // in the browser, and searches nothing; it borrows the benign "tools"
      // command kind, as Admin and Roster do. Nothing from My Day goes to search.
      kind: "tools",
      placeholder: "Open My Day...",
      inputAriaLabel: "Open My Day",
      submitIdleLabel: "My Day",
      submitBusyLabel: "My Day",
      submitAriaLabel: "Open My Day",
      emptyTitle: "What needs you today",
      readyTitle: "Overdue, due soon, then the rest",
      progressLabel: "Opening My Day.",
      resultKind: "tools",
      resultHeading: "My Day",
      // No results page. `/my-day` is one merged list; each row links to the
      // page in its own mode where the item is resolved.
      resultsSurface: "none",
      statusLabel: "My Day",
      nextStep: "Open an item",
      badgeLabel: null,
    },
  },
] as const satisfies readonly AppModeDefinition[];

export function appModeDefinition(modeId: AppModeId) {
  return appModeDefinitions.find((mode) => mode.id === modeId) ?? appModeDefinitions[0];
}

/** Whether this mode shows the "Search my work" header icon. */
export function appModeHasWorkSearch(modeId: AppModeId): boolean {
  return (appModeDefinition(modeId) as AppModeDefinition).workSearch === true;
}

export function isAppModeId(value: string | null | undefined): value is AppModeId {
  return appModeDefinitions.some((mode) => mode.id === value);
}

export function isAppModeVisible(modeId: string, environment = process.env.NODE_ENV) {
  const mode = appModeDefinitions.find((definition) => definition.id === modeId);
  if (!mode) return false;
  return !("devOnly" in mode) || !mode.devOnly || environment === "development";
}

export function visibleAppModeDefinitions(environment = process.env.NODE_ENV) {
  return appModeDefinitions.filter((mode) => !("devOnly" in mode) || !mode.devOnly || environment === "development");
}

export function appModeSearchConfig(modeId: AppModeId) {
  return appModeDefinition(modeId).search;
}

const namespaceIsolatedModes = new Set<AppModeId>([
  "services",
  "forms",
  "favourites",
  "differentials",
  "dsm",
  "specifiers",
  "formulation",
  "therapy-compass",
  "factsheets",
  "dictionary",
  "sources",
  "tools",
  "calculators",
  "on-call",
  "cme",
  "teaching",
  "psychiatry",
  "my-work",
  "roster",
  "first-nations",
  "my-day",
  "medicines",
]);

export function appModeHomeHref(modeId: AppModeId, options: SearchNavigationOptions = {}) {
  const mode = appModeDefinition(modeId);
  const query = options.query?.trim();

  if (modeId === "documents" && query) {
    return documentsSearchHref({ ...options, query });
  }

  // A consolidated mode has no home of its own: its bare path only redirects to
  // the shared home. An unsubmitted href therefore targets `/?mode=<id>` directly
  // rather than routing in-app navigation through that redirect for nothing.
  if (consolidatedModeHomeModeIds.has(modeId) && !query) {
    return appModeSelectionHref(modeId, options);
  }

  if (namespaceIsolatedModes.has(modeId) && "href" in mode && mode.href) {
    const namespacedParams = new URLSearchParams();
    if (query) namespacedParams.set("q", query);
    if (options.focus) namespacedParams.set("focus", "1");
    if (options.run && query) namespacedParams.set("run", "1");
    appendSearchNavigationContext(namespacedParams, options);

    const suffix = namespacedParams.toString();
    // A submitted search resolves to the mode's own `/search` route. Every
    // consolidated mode has one, because its bare path is now a redirect onto the
    // shared home: routing a submitted query back to the bare path would bounce
    // through that redirect and return here, an infinite loop
    // (tests/app-modes.test.ts pins the no-loop property for every mode). The path
    // is read from `consolidated-mode-home-redirect.ts` so an href built here cannot
    // disagree with the redirect the proxy serves for it.
    const namespacedHref =
      query && consolidatedModeHomeModeIds.has(modeId) ? consolidatedModeSearchPath(modeId) : mode.href;
    return suffix ? `${namespacedHref}?${suffix}` : namespacedHref;
  }

  if ("href" in mode && mode.href && !query && !options.run) {
    const homeParams = new URLSearchParams();
    if (options.focus) homeParams.set("focus", "1");
    appendSearchNavigationContext(homeParams, options);
    const suffix = homeParams.toString();
    const separator = mode.href.includes("?") ? "&" : "?";
    return suffix ? `${mode.href}${separator}${suffix}` : mode.href;
  }

  return appModeSelectionHref(modeId, options);
}

/**
 * The shared home URL (`/`) with `modeId` preselected.
 *
 * `/` is the single home page for every mode: the mode pill retargets the
 * composer rather than navigating, so selecting a mode rewrites this href in
 * place (`history.replaceState`) instead of pushing a route. Keeping the mode in
 * the URL means a reload or a shared link server-renders the right placeholder
 * with no hydration flip, and lets the existing render-time URL sync keep owning
 * `searchMode` — never an optimistic state set, per the hero-vs-dock rule in
 * docs/search-chrome-behaviour.md.
 *
 * Distinct from `appModeHomeHref`, which resolves a mode's *own* surface
 * (`/dsm/search`, `/tools`, …). This always stays on `/`.
 */
export function appModeSelectionHref(modeId: AppModeId, options: SearchNavigationOptions = {}) {
  const query = options.query?.trim();
  const params = new URLSearchParams({ mode: modeId });
  if (query) params.set("q", query);
  if (options.focus) params.set("focus", "1");
  if (options.run && query) params.set("run", "1");
  appendSearchNavigationContext(params, options);
  return `/?${params.toString()}`;
}

export function appModeResultKind(modeId: AppModeId): AppModeResultKind {
  return appModeSearchConfig(modeId).resultKind;
}

export function appModeQueryMode(modeId: AppModeId, queryMode: ClinicalQueryMode): ClinicalQueryMode {
  const searchConfig = appModeSearchConfig(modeId);
  const defaultQueryMode = "defaultQueryMode" in searchConfig ? searchConfig.defaultQueryMode : undefined;
  return queryMode === "auto" && defaultQueryMode ? defaultQueryMode : queryMode;
}

export function appModeSourceLibrarySearchMode(
  modeId: AppModeId,
): Extract<AppModeSearchKind, "documents" | "differentials"> {
  return appModeSearchConfig(modeId).kind === "differentials" ? "differentials" : "documents";
}

export function appModeCanUseSourceLibraryShortcut(modeId: AppModeId) {
  const kind = appModeSearchConfig(modeId).kind;
  return kind === "documents" || kind === "differentials";
}

/**
 * Every declared mode is searchable through the dashboard composer:
 * `SearchableAppModeId` is `AppModeId`, so this is `isAppModeId` under the name the
 * composer reasons in. It once re-listed every `AppModeSearchKind` here, which read
 * as a distinction the type does not allow and could never return false for a
 * defined mode. If a non-searchable mode is ever introduced, narrow the type and
 * this predicate together.
 */
export function isSearchableAppMode(modeId: string): modeId is SearchableAppModeId {
  return isAppModeId(modeId);
}

/**
 * Favourites are account-scoped. Show the mode in nav (mode menu + sidebar library)
 * only when the user is authenticated, or when local/demo mode is active so CI and
 * prototype flows keep working without a real session.
 */
export function canAccessFavouritesMode(options: { authenticated: boolean; demoMode: boolean }): boolean {
  return options.demoMode || options.authenticated;
}

export function visibleAppModeDefinitionsForSession(
  options: { authenticated: boolean; demoMode: boolean },
  environment = process.env.NODE_ENV,
) {
  const favouritesAllowed = canAccessFavouritesMode(options);
  return visibleAppModeDefinitions(environment).filter((mode) => mode.id !== "favourites" || favouritesAllowed);
}

/** Omit Favourites from composer cross-mode chips for signed-out non-demo sessions. */
export function filterCrossModesForSession(
  crossModes: readonly AppModeId[],
  options: { authenticated: boolean; demoMode: boolean },
): AppModeId[] {
  if (canAccessFavouritesMode(options)) return [...crossModes];
  return crossModes.filter((mode) => mode !== "favourites");
}
