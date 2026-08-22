import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";

import { appModeDefinitions, appModeHomeHref, type AppModeId } from "@/lib/app-modes";
import {
  consolidatedModeHomeRedirectEntries,
  unsubmittedModeSearchRedirectEntries,
} from "@/lib/consolidated-mode-home-redirect";
import { documentsSearchHref, DOCUMENTS_MODE_HOME_ROUTE } from "@/lib/document-flow-routes";
import { factsheetSlugs } from "@/components/factsheets/factsheets-data";
import { dictionaryEntries, dictionaryTopics } from "@/lib/dictionary-data";
import { differentialRecords } from "@/lib/differentials";
import { dsmDiagnoses } from "@/lib/dsm";
import { formulationMechanisms } from "@/lib/formulation";
import { formRecords } from "@/lib/forms";
import { serviceRecords } from "@/lib/services";
import { specifierRecords } from "@/lib/specifiers";
import { therapySlugs } from "@/lib/therapies";

const appDir = path.join(process.cwd(), "src", "app");
const siteMapPath = path.join(process.cwd(), "docs", "site-map.md");
const medicationSlugs = ["acamprosate"] as const;

type RouteKind = "page" | "handler";

type DiscoveredRoute = {
  route: string;
  file: string;
};

type RedirectRoute = {
  route: string;
  file: string;
  target: string;
};

type SiteMapData = {
  pageRoutes: DiscoveredRoute[];
  publicRouteHandlers: DiscoveredRoute[];
  apiRoutes: DiscoveredRoute[];
  redirects: RedirectRoute[];
  nonRoutedMockupArtifacts: string[];
};

const productRouteHandlerPaths = new Set(["/applications"]);

/*
 * Consolidated homes are read from the redirect map, not scraped out of page
 * bodies. `discoverRedirects` finds a redirect by matching `redirect("literal")`,
 * and these stubs compute their target so the query survives the hop — so the
 * regex stopped seeing them and the map described them as pages rendering a home.
 */
const consolidatedRedirectTargets = Object.fromEntries(
  consolidatedModeHomeRedirectEntries.map(([route, modeId]) => [route, `/?mode=${modeId}`]),
);

/*
 * The four `<mode>/search` routes with no browse view. Conditional, not absolute:
 * they forward only when the query is empty, and render results otherwise — so
 * they are described rather than listed as plain redirects.
 */
const unsubmittedSearchRedirectDescriptions = Object.fromEntries(
  unsubmittedModeSearchRedirectEntries.map(([route, modeId]) => [
    route,
    `Submitted ${modeId} results. An empty query forwards to \`/?mode=${modeId}\` so the retired mode home is not rendered a second time.`,
  ]),
);

const documentedRedirectTargets: Record<string, string> = {
  ...consolidatedRedirectTargets,
  "/applications": "/tools",
  // The source page redirects a valid id to the canonical `/documents/[id]` viewer
  // (page.tsx line 20) and only falls back to `/documents/search` for an invalid id
  // (line 14). Pin the canonical target here so the generated map does not report the
  // invalid-id fallback that its first-`redirect()` regex would otherwise capture.
  "/documents/source": "/documents/[id]",
  "/documents/source/evidence": "/documents/[id]",
  // Pinned because the page forwards the incoming query string, so its
  // `redirect()` argument is a template literal the regex above cannot read.
  "/dictionary/browse": "/dictionary/search",
  "/ward-management/constellation": "/ward-management/network",
};

const routeDescriptions: Record<string, string> = {
  "/": "Main Clinical KB shell.",
  "/applications": "Legacy application launcher redirect to Tools.",
  "/caring-contacts":
    "Caring Contacts workspace — a synthetic, non-clinical demonstration of caring-contact follow-up. Standalone: it owns its own navigation and is entered from the Tools catalogue.",
  "/calculators": "Psychiatry rating scale scoring and clinical decision calculators.",
  "/dictionary": "Clinical dictionary home with term search and category navigation.",
  "/dictionary/[slug]": "Source-governed clinical term definition, distinction, and reference detail.",
  "/dictionary/browse":
    "Compatibility redirect to `/dictionary/search`, which is now the whole catalogue; the query string is carried across.",
  "/dictionary/compare": "Side-by-side clinical term definition and nuance comparison.",
  "/dictionary/search":
    "The clinical term and abbreviation catalogue: an empty query lists everything, a typed query narrows the same list.",
  "/dictionary/sources": "Clinical dictionary governance, references, and source catalogue.",
  "/dictionary/topics": "Clinical dictionary topic category index.",
  "/dictionary/topics/[slug]": "Clinical dictionary topic category term list.",
  "/differentials": "Differentials home and search surface.",
  "/differentials/compare":
    "Compare queue: empty state or selected diagnosis ids (Search edit links preserve ids); Open comparison launches a catalogue presentation workflow or an ad-hoc workspace (`workspace=1`).",
  "/differentials/diagnoses": "Diagnosis stream.",
  "/differentials/diagnoses/[slug]": "Differential diagnosis detail.",
  "/differentials/presentations": "Presentation catalogue stream.",
  "/differentials/presentations/[slug]": "Presentation comparison workflow.",
  "/documents": "Documents mode home and source document library surface.",
  "/documents/[id]": "Document viewer/detail page.",
  "/documents/search": "Documents search command centre.",
  "/documents/source": "Compatibility redirect to the canonical live document viewer when a valid id is supplied.",
  "/documents/source/evidence": "Compatibility redirect sharing the canonical live document viewer handoff.",
  "/dsm": "DSM-5 Diagnosis home.",
  "/dsm/compare": "DSM diagnosis comparison.",
  "/dsm/diagnoses/[slug]": "DSM diagnosis criteria and information.",
  "/dsm/diagnoses/[slug]/differentials": "DSM diagnosis differential considerations.",
  "/dsm/search": "DSM diagnosis search and catalogue browser.",
  "/factsheets": "Patient information factsheets home and topic browser.",
  "/factsheets/[slug]": "Plain-language patient factsheet reading and printable handout view.",
  "/factsheets/search": "Patient information factsheet search command centre.",
  "/favourites": "Saved clinical items and sets.",
  "/forms": "Forms home and search surface.",
  "/forms/[slug]": "Registry-backed form detail.",
  "/formulation": "Clinical formulation home and local mechanism search surface.",
  "/formulation/[slug]": "Formulation mechanism decision-support guide.",
  "/formulation/builder": "Structured clinical formulation builder.",
  "/formulation/compare": "Side-by-side mechanism comparison.",
  "/formulation/map": "Formulation mechanism domain map.",
  "/medications": "Medication mode home.",
  "/medications/[slug]": "Medication detail.",
  "/privacy": "Privacy and data-processing governance draft.",
  "/reference/colour-coding": "Clinical domain and category colour-coding palette reference.",
  "/safety-plan": "Patient safety plan generator (Stanley-Brown six steps) — a Tools-page clinical tool.",
  "/services": "Services home and search surface.",
  "/services/[slug]": "Registry-backed service detail.",
  "/specifiers": "Psychiatric specifier home and local search surface.",
  "/specifiers/[slug]": "Psychiatric specifier decision-support guide.",
  "/specifiers/builder": "Structured diagnostic wording builder.",
  "/specifiers/compare": "Side-by-side psychiatric specifier comparison.",
  "/specifiers/map": "Psychiatric specifier family map.",
  "/therapy-compass": "Therapy home (source-grounded therapy decision support).",
  "/therapy-compass/[slug]": "Therapy record detail.",
  "/therapy-compass/[slug]/brief": "Therapy brief-intervention view.",
  "/therapy-compass/[slug]/sheet": "Therapy patient-sheet builder.",
  "/therapy-compass/compare": "Side-by-side therapy comparison.",
  "/therapy-compass/pathways": "Problem-based clinical therapy pathways.",
  "/therapy-compass/recommend": "Recommend a therapy from a clinical question and constraints.",
  "/therapy-compass/review": "Therapy records awaiting qualified-clinician source review.",
  "/therapy-compass/search": "Therapy library search surface.",
  "/tools": "Clinical tools and applications launcher directory.",
  "/ward-management": "Statewide psychiatry ward demand, bed capacity, and patient flow console.",
  "/ward-management/capacity": "Ward bed availability, unit occupancy, and staffing capacity.",
  "/ward-management/constellation":
    "Compatibility redirect to `/ward-management/network`. Phase 2 retired the constellation command view.",
  "/ward-management/ed/[edId]": "Synthetic emergency-department role screen for one origin department.",
  "/ward-management/exceptions": "Patient flow exceptions, delays, and escalation alerts.",
  "/ward-management/governance": "Ward coordination governance, compliance, and audit log.",
  "/ward-management/movements": "Scheduled and completed patient transfers and bed movements.",
  "/ward-management/network": "Psychiatric bed network status and regional catchment map.",
  "/ward-management/patients/[patientId]": "Synthetic patient placement and transfer trajectory detail.",
  "/ward-management/queue": "Priority referral queue and triage waiting list.",
  "/ward-management/transport": "Patient inter-hospital transfer and transport logistics.",
  "/ward-management/transport/officer": "Synthetic transport-officer phone screen for in-flight jobs.",
  "/ward-management/ward/[unitId]": "Synthetic ward-manager screen for one inpatient unit.",
};

const publicRouteHandlerDescriptions: Record<string, string> = {
  "/auth/callback": "Authentication callback handler.",
  "/icons/[variant]": "Dynamically generated application icon handler.",
};

const apiDescriptions: Record<string, string> = {
  "/api/account/favourites": "Account saved favourites operations.",
  "/api/account/preferences": "Account density, motion, and UI preferences.",
  "/api/answer": "Generate answer response.",
  "/api/answer/stream": "Streaming answer response.",
  "/api/answer-feedback": "Answer quality feedback submission.",
  "/api/differentials": "Differential diagnosis catalogue operations.",
  "/api/differentials/[slug]": "Differential diagnosis detail endpoint.",
  "/api/differentials/presentations/[slug]": "Presentation workflow comparison data endpoint.",
  "/api/documents": "Document collection operations.",
  "/api/documents/[id]": "Document detail operations.",
  "/api/documents/[id]/labels": "Document label operations.",
  "/api/documents/[id]/reindex": "Single-document reindex operation.",
  "/api/documents/[id]/reviews": "Document clinical review audit log.",
  "/api/documents/[id]/search": "Search within one document.",
  "/api/documents/[id]/signed-url": "Private document signed URL.",
  "/api/documents/[id]/summarize": "Document summary operation.",
  "/api/documents/[id]/table-facts": "Document table facts.",
  "/api/documents/bulk": "Bulk document operations.",
  "/api/documents/bulk/reindex": "Bulk reindex operation.",
  "/api/documents/signed-urls": "Bulk private document signed URLs.",
  "/api/eval-cases": "Evaluation case data.",
  "/api/health": "Health check.",
  "/api/health/ready": "Readiness health check.",
  "/api/images/[id]/signed-url": "Private image signed URL.",
  "/api/images/signed-urls": "Bulk private image signed URLs.",
  "/api/ingestion/batches": "Ingestion batch state.",
  "/api/ingestion/jobs": "Ingestion job collection.",
  "/api/ingestion/jobs/[id]/retry": "Retry ingestion job.",
  "/api/ingestion/quality": "Ingestion quality reporting.",
  "/api/jobs": "Administrator/ops job listing (not a client product API; see docs/api-jobs-ops-surface.md).",
  "/api/local-project-id": "Local project identity guard.",
  "/api/medications": "Medication catalog collection operations.",
  "/api/medications/[slug]": "Medication detail endpoint.",
  "/api/registry/records": "Registry record collection.",
  "/api/registry/records/[slug]": "Registry record detail.",
  "/api/search": "Search endpoint.",
  "/api/search/interaction": "Search interaction telemetry.",
  "/api/search/universal": "Cross-entity universal search endpoint.",
  "/api/setup-status": "Setup status.",
  "/api/upload": "Upload endpoint.",
  "/api/webhooks/railway": "Railway deploy webhook -> chat forwarder.",
  "/api/webhooks/supabase/document-change": "Supabase document-change webhook -> ingestion enqueue.",
};

const routeOwnershipRows = [
  ["Root dashboard and query modes", "src/app/(search-app)/page.tsx, src/lib/app-modes.ts"],
  ["Global shell layouts", "src/app/*/layout.tsx, src/components/clinical-dashboard/global-search-shell.tsx"],
  ["Services", "src/app/(search-app)/services, src/lib/services.ts, src/app/api/registry/records"],
  ["Forms", "src/app/(search-app)/forms, src/lib/forms.ts, src/app/api/registry/records"],
  [
    "Favourites",
    "src/app/(search-app)/favourites, src/components/clinical-dashboard/favourites-command-library-page.tsx",
  ],
  ["Differentials", "src/app/(search-app)/differentials, src/lib/differentials.ts"],
  ["DSM-5 Diagnosis", "src/app/(search-app)/dsm, src/components/dsm, src/lib/dsm.ts"],
  ["Specifiers", "src/app/(search-app)/specifiers, src/components/specifiers, src/lib/specifiers.ts"],
  ["Formulation", "src/app/(search-app)/formulation, src/components/formulation, src/lib/formulation.ts"],
  [
    "Medications",
    "src/app/(search-app)/medications, src/components/clinical-dashboard/medication-prescribing-workspace.tsx",
  ],
  ["Documents", "src/app/(search-app)/documents, src/lib/document-flow-routes.ts"],
  ["Calculators", "src/app/(search-app)/calculators, src/components/calculators"],
  ["Therapy Compass", "src/app/(search-app)/therapy-compass, src/lib/therapies.ts"],
  ["Factsheets", "src/app/(search-app)/factsheets, src/components/factsheets"],
  ["Dictionary", "src/app/(search-app)/dictionary, src/lib/dictionary.ts"],
  ["Ward Management", "src/app/ward-management, src/components/ward-management"],
  ["Safety Plan", "src/app/safety-plan, src/components/patient-safety-plan.tsx"],
  ["Privacy", "src/app/privacy"],
  ["Tools", "src/components/applications-launcher-page.tsx"],
  [
    "Caring Contacts workspace",
    "src/app/caring-contacts, src/components/caring-contacts/workspace, src/lib/caring-contacts-routes.ts",
  ],
  ["Mockups", "src/app/mockups"],
] as const;

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function routeSegment(segment: string) {
  if (segment.startsWith("(") && segment.endsWith(")")) return null;
  if (segment.startsWith("@")) return null;
  return segment;
}

function isApiRoute(route: string) {
  return route === "/api" || route.startsWith("/api/");
}

function fileToRoute(filePath: string, kind: RouteKind) {
  const suffix = path.basename(filePath);
  const expectedSuffixes = kind === "page" ? ["page.tsx"] : ["route.ts", "route.tsx"];
  if (!expectedSuffixes.includes(suffix)) {
    throw new Error(`Unsupported ${kind} route file: ${filePath}`);
  }
  const relative = toPosixPath(path.relative(appDir, filePath));
  const withoutFile = relative.slice(0, -suffix.length).replace(/\/$/, "");
  const segments = withoutFile.split("/").filter(Boolean).map(routeSegment).filter(Boolean);
  return segments.length ? `/${segments.join("/")}` : "/";
}

function collectFiles(root: string, targetFileName: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, targetFileName));
      continue;
    }
    if (entry.isFile() && entry.name === targetFileName) files.push(fullPath);
  }
  return files;
}

function discoverRoutes(kind: RouteKind): DiscoveredRoute[] {
  const targetFiles = kind === "page" ? ["page.tsx"] : ["route.ts", "route.tsx"];
  return targetFiles
    .flatMap((targetFile) => collectFiles(appDir, targetFile))
    .map((file) => ({
      route: fileToRoute(file, kind),
      file: toPosixPath(path.relative(process.cwd(), file)),
    }))
    .sort((left, right) => left.route.localeCompare(right.route) || left.file.localeCompare(right.file));
}

/*
 * Applied last, so a derived entry wins over any hand-written description left
 * behind for a path that has since become a redirect. `/dsm` read "DSM-5
 * Diagnosis home." long after it stopped rendering one.
 */
Object.assign(
  routeDescriptions,
  Object.fromEntries(
    consolidatedModeHomeRedirectEntries.map(([route, modeId]) => [
      route,
      `Compatibility redirect to the shared home at \`/?mode=${modeId}\`; a submitted \`?q=…&run=1\` forwards to \`${route}/search\`.`,
    ]),
  ),
  unsubmittedSearchRedirectDescriptions,
);

const conditionalRedirectRoutes = new Set(unsubmittedModeSearchRedirectEntries.map(([route]) => route));

function discoverRedirects(routes: DiscoveredRoute[]): RedirectRoute[] {
  return (
    routes
      // The `<mode>/search` routes forward only an EMPTY query and render results
      // otherwise, so listing them here would claim they never render anything.
      // Their conditional behaviour is stated in `routeDescriptions` instead.
      .filter((route) => !conditionalRedirectRoutes.has(route.route))
      .map((route) => {
        const source = readFileSync(path.join(process.cwd(), route.file), "utf8");
        const target =
          documentedRedirectTargets[route.route] ?? source.match(/\bredirect\(\s*["']([^"']+)["']\s*\)/)?.[1];
        return target ? { ...route, target } : null;
      })
      .filter((value): value is RedirectRoute => Boolean(value))
      .sort((left, right) => left.route.localeCompare(right.route))
  );
}

function discoverNonRoutedMockupArtifacts() {
  const mockupsDir = path.join(process.cwd(), "mockups");
  if (!existsSync(mockupsDir)) return [];
  return collectFiles(mockupsDir, "page.tsx")
    .map((file) => toPosixPath(path.relative(process.cwd(), file)))
    .sort((left, right) => left.localeCompare(right));
}

export function collectSiteMapData(): SiteMapData {
  const pageRoutes = discoverRoutes("page");
  const routeHandlers = discoverRoutes("handler");
  const publicRouteHandlers = routeHandlers.filter((route) => !isApiRoute(route.route));
  return {
    pageRoutes,
    publicRouteHandlers,
    apiRoutes: routeHandlers.filter((route) => isApiRoute(route.route)),
    redirects: discoverRedirects([...pageRoutes, ...publicRouteHandlers]),
    nonRoutedMockupArtifacts: discoverNonRoutedMockupArtifacts(),
  };
}

function bullet(route: string, description?: string) {
  return `- \`${route}\`${description ? ` - ${description}` : ""}`;
}

function routeLine(route: DiscoveredRoute, descriptionMap: Record<string, string>) {
  return bullet(
    route.route,
    `${descriptionMap[route.route] ?? "Route discovered from app directory"} Source: \`${route.file}\`.`,
  );
}

function sortedSlugs(slugs: readonly string[]) {
  return [...slugs].sort((left, right) => left.localeCompare(right));
}

function renderSlugInventory(title: string, routePattern: string, slugs: readonly string[]) {
  return [
    `### ${title}`,
    "",
    bullet(routePattern, "Dynamic route family."),
    ...sortedSlugs(slugs).map((slug) => `- \`${slug}\``),
  ];
}

function renderModeRoutes() {
  const examples: Record<AppModeId, string> = {
    answer: appModeHomeHref("answer", { query: "example question", focus: true, run: true }),
    documents: documentsSearchHref({ query: "lithium monitoring", focus: true, run: true }),
    services: appModeHomeHref("services", { query: "13YARN", focus: true, run: true }),
    forms: appModeHomeHref("forms", { query: "transport forms", focus: true, run: true }),
    favourites: appModeHomeHref("favourites", { query: "clozapine set", focus: true, run: true }),
    differentials: appModeHomeHref("differentials", { query: "acute confusion", focus: true, run: true }),
    dsm: appModeHomeHref("dsm", { query: "major depressive disorder", focus: true, run: true }),
    specifiers: appModeHomeHref("specifiers", { query: "depressed but racing thoughts", focus: true, run: true }),
    formulation: appModeHomeHref("formulation", { query: "I keep going over it", focus: true, run: true }),
    prescribing: appModeHomeHref("prescribing", { query: "acamprosate renal dose", focus: true, run: true }),
    tools: appModeHomeHref("tools", { query: "medications", focus: true, run: true }),
    calculators: appModeHomeHref("calculators", { query: "PHQ-9", focus: true, run: true }),
    "therapy-compass": appModeHomeHref("therapy-compass", { query: "behavioural activation", focus: true, run: true }),
    factsheets: appModeHomeHref("factsheets", { query: "sertraline", focus: true, run: true }),
    dictionary: appModeHomeHref("dictionary", { query: "mental state examination", focus: true, run: true }),
  };

  return appModeDefinitions.map((mode) => {
    const modeName = mode.label.toLowerCase().endsWith(" mode") ? mode.label : `${mode.label} mode`;

    return bullet(
      ("href" in mode ? mode.href : undefined) ?? appModeHomeHref(mode.id),
      `${modeName}. Search kind: \`${mode.search.kind}\`. Query example: \`${examples[mode.id]}\`.`,
    );
  });
}

type ModePageIndexRow = {
  mode: string;
  home: string;
  search: string;
  detail: string;
};

function renderRouteTable(rows: ModePageIndexRow[]) {
  return [
    "| Mode | Home page | Search/results page | Information/detail pages |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.mode} | \`${row.home}\` | \`${row.search}\` | ${row.detail} |`),
  ];
}

function renderModePageIndex() {
  return renderRouteTable([
    {
      mode: "Answer",
      home: appModeHomeHref("answer"),
      search: appModeHomeHref("answer", { query: "example question", focus: true, run: true }),
      detail: "Answer, citations, evidence, and source panels render inside the root dashboard shell.",
    },
    {
      mode: "Documents",
      home: DOCUMENTS_MODE_HOME_ROUTE,
      search: documentsSearchHref({ query: "lithium monitoring", focus: true, run: true }),
      detail:
        "`/documents/search` live results and `/documents/[id]` canonical viewer; `/documents/source*` are compatibility redirects.",
    },
    {
      mode: "Services",
      home: appModeHomeHref("services"),
      search: appModeHomeHref("services", { query: "13YARN", focus: true, run: true }),
      detail: "`/services/[slug]` service record pages.",
    },
    {
      mode: "Forms",
      home: appModeHomeHref("forms"),
      search: appModeHomeHref("forms", { query: "transport forms", focus: true, run: true }),
      detail: "`/forms/[slug]` form record pages.",
    },
    {
      mode: "Favourites",
      home: appModeHomeHref("favourites"),
      search: appModeHomeHref("favourites", { query: "clozapine set", focus: true, run: true }),
      detail: "Saved set and saved item detail render inside the favourites page surface.",
    },
    {
      mode: "Differentials",
      home: appModeHomeHref("differentials"),
      search: appModeHomeHref("differentials", { query: "acute confusion", focus: true, run: true }),
      detail:
        "`/differentials/diagnoses`, `/differentials/diagnoses/[slug]`, `/differentials/presentations`, `/differentials/presentations/[slug]`, and `/differentials/compare`.",
    },
    {
      mode: "DSM-5 Diagnosis",
      home: appModeHomeHref("dsm"),
      search: appModeHomeHref("dsm", { query: "major depressive disorder", focus: true, run: true }),
      detail: "`/dsm/diagnoses/[slug]`, `/dsm/compare`, and `/dsm/diagnoses/[slug]/differentials`.",
    },
    {
      mode: "Specifiers",
      home: appModeHomeHref("specifiers"),
      search: appModeHomeHref("specifiers", { query: "depressed but racing thoughts", focus: true, run: true }),
      detail: "`/specifiers/[slug]`, `/specifiers/builder`, `/specifiers/compare`, and `/specifiers/map`.",
    },
    {
      mode: "Formulation",
      home: appModeHomeHref("formulation"),
      search: appModeHomeHref("formulation", { query: "I keep going over it", focus: true, run: true }),
      detail: "`/formulation/[slug]`, `/formulation/builder`, `/formulation/compare`, and `/formulation/map`.",
    },
    {
      mode: "Medication",
      home: appModeHomeHref("prescribing"),
      search: appModeHomeHref("prescribing", { query: "acamprosate renal dose", focus: true, run: true }),
      detail: "`/medications/[slug]`; submitted searches resolve to `/?mode=prescribing&q=…&run=1`.",
    },
    {
      mode: "Tools",
      home: appModeHomeHref("tools"),
      search: appModeHomeHref("tools", { query: "medications", focus: true, run: true }),
      detail:
        "Canonical all-tools results directory at `/tools`; the universal mode picker opens it directly. `/?mode=tools` remains a dashboard-mode alias.",
    },
    {
      mode: "Calculators",
      home: appModeHomeHref("calculators"),
      search: appModeHomeHref("calculators", { query: "PHQ-9", focus: true, run: true }),
      detail: "`/calculators/search` scored results; an empty query forwards back to the shared home.",
    },
    {
      mode: "Factsheets",
      home: appModeHomeHref("factsheets"),
      search: appModeHomeHref("factsheets", { query: "sertraline", focus: true, run: true }),
      detail:
        "`/factsheets/search` is also a query-free browse surface linked from the mode nav; `/factsheets/[slug]` records.",
    },
    {
      mode: "Dictionary",
      home: appModeHomeHref("dictionary"),
      search: appModeHomeHref("dictionary", { query: "MSE", focus: true, run: true }),
      detail:
        "`/dictionary/search` is one catalogue for both searching and browsing; `/dictionary/browse` redirects to it. Also `/topics`, `/topics/[slug]`, `/compare`, `/sources` and `/dictionary/[slug]` records.",
    },
    {
      mode: "Therapy Compass",
      home: appModeHomeHref("therapy-compass"),
      search: appModeHomeHref("therapy-compass", { query: "CBT", focus: true, run: true }),
      detail:
        "Keeps a home of its own at `/therapy-compass`; `/search` (query-free browse), `/recommend`, `/compare`, `/pathways`, `/review`, and `/[slug]` records with `/brief` and `/sheet` outputs.",
    },
  ]);
}

function renderDocumentFlowIndex() {
  return [
    bullet(DOCUMENTS_MODE_HOME_ROUTE, "Documents mode home. Stays as the no-query home surface for document mode."),
    bullet(
      documentsSearchHref({ query: "clozapine monitoring table", focus: true, run: true }),
      "Documents search command centre used after submitting a search in Documents mode.",
    ),
    bullet(
      "/documents/source?id=11111111-1111-4111-8111-111111111111&page=12&chunk=monitoring-table",
      "Legacy source handoff; valid document IDs redirect to the canonical live viewer and invalid IDs return to Documents search.",
    ),
    bullet(
      "/documents/source/evidence?id=11111111-1111-4111-8111-111111111111&page=12&chunk=monitoring-table",
      "Legacy evidence handoff redirected to the canonical live document viewer.",
    ),
    bullet("/documents/[id]", "Live document viewer route remains available for real document records."),
  ];
}

function section(title: string, lines: string[]) {
  return [`## ${title}`, "", ...lines, ""];
}

function renderSiteMapRaw(data = collectSiteMapData()) {
  const productRoutes = data.pageRoutes.filter(
    (route) =>
      !route.route.startsWith("/api") &&
      !route.route.startsWith("/mockups") &&
      ![
        "/documents/[id]",
        "/services/[slug]",
        "/forms/[slug]",
        "/differentials/diagnoses/[slug]",
        "/specifiers/[slug]",
        "/dsm/diagnoses/[slug]",
        "/dsm/diagnoses/[slug]/differentials",
        "/formulation/[slug]",
        "/therapy-compass/[slug]",
        "/medications/[slug]",
        "/dictionary/[slug]",
        "/dictionary/topics/[slug]",
        "/factsheets/[slug]",
        "/ward-management/patients/[patientId]",
      ].includes(route.route),
  );
  const mockupRoutes = data.pageRoutes.filter((route) => route.route.startsWith("/mockups"));
  const publicUtilityRouteHandlers = data.publicRouteHandlers.filter(
    (route) => !productRouteHandlerPaths.has(route.route),
  );

  const lines = [
    "# Clinical KB Site Map",
    "",
    "This file is generated by `npm run docs:update` (or `npm run sitemap:update` directly). Run `npm run sitemap:check` to verify it is current.",
    "",
    ...section(
      "Main product routes",
      productRoutes.map((route) => routeLine(route, routeDescriptions)),
    ),
    ...section("Mode/query routes", renderModeRoutes()),
    ...section("Mode page index", renderModePageIndex()),
    ...section("Documents flow index", renderDocumentFlowIndex()),
    ...section("Registry-backed routes", [
      bullet(
        "/services/[slug]",
        "Registry-backed service detail. Content depends on auth, demo mode, local no-auth mode, and per-user registry records.",
      ),
      bullet(
        "/forms/[slug]",
        "Registry-backed form detail. Content depends on auth, demo mode, local no-auth mode, and per-user registry records.",
      ),
      bullet("/api/registry/records?kind=service", "Service registry collection endpoint."),
      bullet("/api/registry/records?kind=form", "Form registry collection endpoint."),
      bullet("/api/registry/records/[slug]?kind=service|form", "Registry detail endpoint."),
    ]),
    ...section("Dynamic slug inventories", [
      ...renderSlugInventory(
        "Seeded service slugs",
        "/services/[slug]",
        serviceRecords.map((record) => record.slug),
      ),
      "",
      ...renderSlugInventory(
        "Psychiatric specifier slugs",
        "/specifiers/[slug]",
        specifierRecords.map((record) => record.slug),
      ),
      "",
      ...renderSlugInventory(
        "Seeded form slugs",
        "/forms/[slug]",
        formRecords.map((record) => record.slug),
      ),
      "",
      ...renderSlugInventory(
        "Differential diagnosis slugs",
        "/differentials/diagnoses/[slug]",
        differentialRecords.map((record) => record.slug),
      ),
      "",
      ...renderSlugInventory(
        "DSM diagnosis slugs",
        "/dsm/diagnoses/[slug]",
        dsmDiagnoses.map((record) => record.slug),
      ),
      "",
      ...renderSlugInventory(
        "Formulation mechanism slugs",
        "/formulation/[slug]",
        formulationMechanisms.map((mechanism) => mechanism.id),
      ),
      "",
      ...renderSlugInventory("Therapy slugs", "/therapy-compass/[slug]", therapySlugs()),
      "",
      ...renderSlugInventory("Medication slugs", "/medications/[slug]", medicationSlugs),
      "",
      ...renderSlugInventory("Factsheet slugs", "/factsheets/[slug]", factsheetSlugs()),
      "",
      ...renderSlugInventory(
        "Clinical dictionary term slugs",
        "/dictionary/[slug]",
        dictionaryEntries.map((entry) => entry.slug),
      ),
      "",
      ...renderSlugInventory(
        "Clinical dictionary topic slugs",
        "/dictionary/topics/[slug]",
        dictionaryTopics.map((topic) => topic.slug),
      ),
    ]),
    ...section("Document viewer route", [
      bullet(
        "/documents/[id]",
        "Document viewer/detail page. Individual document IDs are intentionally not enumerated in this sitemap.",
      ),
    ]),
    ...section("Ward management patient route", [
      bullet(
        "/ward-management/patients/[patientId]",
        "Synthetic patient placement and transfer trajectory detail. Synthetic patient IDs are generated runtime data and intentionally not enumerated in this sitemap.",
      ),
    ]),
    ...section("Mockup/prototype routes", [
      ...mockupRoutes.map((route) => routeLine(route, routeDescriptions)),
      ...(data.nonRoutedMockupArtifacts.length
        ? [
            "",
            "### Non-routed mockup artifacts",
            "",
            ...data.nonRoutedMockupArtifacts.map((file) =>
              bullet(file, "Root-level mockup artifact outside `src/app`; not a Next route."),
            ),
          ]
        : []),
    ]),
    ...section(
      "Public utility route handlers",
      publicUtilityRouteHandlers.map((route) => routeLine(route, publicRouteHandlerDescriptions)),
    ),
    ...section(
      "API routes",
      data.apiRoutes.map((route) => routeLine(route, apiDescriptions)),
    ),
    ...section(
      "Redirects",
      data.redirects.length
        ? data.redirects.map((redirect) =>
            bullet(redirect.route, `Redirects to \`${redirect.target}\`. Source: \`${redirect.file}\`.`),
          )
        : ["- No page-level redirects discovered."],
    ),
    ...section("Known caveats and stale-path flags", [
      "- `/mockups/*` prototype routes are development-only; production returns 404 and `robots.txt` disallows indexing.",
      "- `/mockups/favourites-hub` is a legacy compatibility route and should redirect to `/favourites`.",
      "- Registry-backed service and form pages may show sign-in, load-error, or in-app not-found states for missing per-user records.",
      "- Live user registries may contain additional service or form slugs beyond the seeded/demo slugs listed here.",
      "- `/documents/[id]` is intentionally summarized as a route family; individual document IDs are private runtime data.",
      "- Several differential records are placeholder scaffolds pending source-backed local clinical content.",
    ]),
    ...section("Route ownership/source map", [
      "| Area | Source |",
      "| --- | --- |",
      ...routeOwnershipRows.map(([area, source]) => `| ${area} | \`${source}\` |`),
    ]),
  ];

  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

export async function renderSiteMap(data = collectSiteMapData()) {
  return format(renderSiteMapRaw(data), { parser: "markdown", printWidth: 120 });
}

async function main() {
  const expected = await renderSiteMap();
  const check = process.argv.includes("--check");

  if (check) {
    const current = existsSync(siteMapPath) ? readFileSync(siteMapPath, "utf8") : "";
    if (current !== expected) {
      console.error("docs/site-map.md is stale. Run `npm run sitemap:update` and commit the result.");
      process.exitCode = 1;
    }
    return;
  }

  writeFileSync(siteMapPath, expected, "utf8");
  console.log(`Updated ${toPosixPath(path.relative(process.cwd(), siteMapPath))}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
