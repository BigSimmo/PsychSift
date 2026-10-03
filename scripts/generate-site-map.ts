import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
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
 * The `<mode>/search` routes with no browse view. Conditional, not absolute:
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
  "/dictionary/sources": "/sources/search?usedBy=dictionary",
  // Medication is consolidated like the modes in `consolidatedRedirectTargets`
  // above, but deliberately kept out of that shared map — there is no
  // `/medications/search` route, so its own bespoke redirect (medications/page.tsx,
  // mirrored in src/proxy.ts) handles both branches instead. Pinned here by hand
  // for the same reason as the entries above it: the target is computed, not a
  // string literal the `redirect("…")` regex can read.
  "/medications": "/?mode=prescribing",
};

const routeDescriptions: Record<string, string> = {
  "/": "Main PsychSift shell.",
  "/applications": "Legacy application launcher redirect to Tools.",
  "/calculators": "Psychiatry rating scale scoring and clinical decision calculators.",
  "/calculators/search":
    "Browsable calculator catalogue and scored results. An empty query lists every calculator; a submitted query narrows the same list.",
  "/dictionary": "Clinical dictionary home with term search and category navigation.",
  "/dictionary/[slug]": "Source-governed clinical term definition, distinction, and reference detail.",
  "/dictionary/browse":
    "Compatibility redirect to `/dictionary/search`, which is now the whole catalogue; the query string is carried across.",
  "/dictionary/compare": "Side-by-side clinical term definition and nuance comparison.",
  "/dictionary/search":
    "The clinical term and abbreviation catalogue: an empty query lists everything, a typed query narrows the same list.",
  "/dictionary/sources":
    "Query-preserving compatibility redirect to `/sources/search?usedBy=dictionary`; incoming catalogue filters are retained and application usage is set to Dictionary.",
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
  "/factsheets": "Compatibility redirect to the shared Factsheets home.",
  "/factsheets/[slug]": "Plain-language patient factsheet reading and printable handout view.",
  "/factsheets/search": "Patient information factsheet search command centre.",
  "/factsheets/topics": "Patient information factsheets organised by topic.",
  "/favourites": "Saved clinical items and sets.",
  "/forms": "Forms home and search surface.",
  "/forms/[slug]": "Registry-backed form detail.",
  "/forms/act":
    "Plain-English summaries of the Mental Health Act 2014 (WA) sections and the Chief Psychiatrist's Standards for Clinical Care, grouped by reference topic.",
  "/forms/search":
    "Forms results surface: searches the WA MHA 2014 forms register by code, title and clinical purpose.",
  "/formulation": "Clinical formulation home and local mechanism search surface.",
  "/formulation/[slug]": "Formulation mechanism decision-support guide.",
  "/formulation/builder": "Structured clinical formulation builder.",
  "/formulation/compare": "Side-by-side mechanism comparison.",
  "/formulation/map": "Formulation mechanism domain map.",
  "/formulation/search":
    "Formulation results surface: searches mechanisms by pattern, clinical clue and hypothesis, and browses the full catalogue on an empty query.",
  "/medications": "Compatibility redirect to the shared Medication (prescribing) home.",
  "/medications/[slug]": "Medication detail.",
  "/privacy": "Public privacy and data-processing transparency notice; governance approval pending.",
  "/reference/colour-coding": "Clinical domain and category colour-coding palette reference.",
  "/safety-plan": "Patient safety plan generator (Stanley-Brown six steps) — a Tools-page clinical tool.",
  "/services": "Services home and search surface.",
  "/services/[slug]": "Registry-backed service detail.",
  "/services/search":
    "Services results surface: searches the private services registry by need, catchment, eligibility and referral route.",
  "/sources/[sourceId]": "Clinical source traceability record: identity, rating, canonical locations and usage.",
  "/sources/method": "How the catalogue rates, reviews and traces a source, and its stated limitations.",
  "/sources/publishers": "Publishing bodies grouped by jurisdiction scope.",
  "/sources/search":
    "The ranked clinical source catalogue: filter and sort by quality band, jurisdiction, source type, publisher, topic, lifecycle and application usage.",
  "/sources/topics": "Clinical topics derived from registered source metadata.",
  "/specifiers": "Psychiatric specifier home and local search surface.",
  "/specifiers/[slug]": "Psychiatric specifier decision-support guide.",
  "/specifiers/builder": "Structured diagnostic wording builder.",
  "/specifiers/compare": "Side-by-side psychiatric specifier comparison.",
  "/specifiers/map": "Psychiatric specifier family map.",
  "/specifiers/search":
    "Specifiers results surface: searches diagnostic specifiers by presentation, episode pattern, course and severity, and browses the full catalogue on an empty query.",
  "/therapy-compass": "Therapy home (source-grounded therapy reference).",
  "/therapy-compass/[slug]": "Therapy record detail.",
  "/therapy-compass/[slug]/brief": "Therapy brief-intervention view.",
  "/therapy-compass/[slug]/sheet": "Therapy patient-sheet builder.",
  "/therapy-compass/compare": "Side-by-side therapy comparison.",
  "/therapy-compass/pathways": "Problem-based clinical therapy pathways.",
  "/therapy-compass/recommend": "Recommend a therapy from a clinical question and constraints.",
  "/therapy-compass/review": "Therapy records awaiting qualified-clinician source review.",
  "/therapy-compass/search": "Therapy library search surface.",
  "/on-call": "On Call Now: your shift, checklists, usual numbers and the hospital's emergency line.",
  "/on-call/whos-on": "Who is rostered on, by team, for yesterday, today and tomorrow.",
  "/on-call/call":
    "Your hospital's numbers by area, outside lines and your own numbers, each with the date it was updated.",
  "/on-call/refer": "How to refer to each service at your hospital, and your own referral notes.",
  "/on-call/find": "Wards, equipment, manuals and the plan for when systems go down, for your hospital.",
  "/on-call/who-is-who": "What each on-call role does, when to call them, and the acronyms this service uses.",
  "/psychiatry":
    "Psychiatry dashboard: one card each for DSM-5 Diagnosis, Differentials, Specifiers, Formulation, Therapy and Forms, linking to those modes at their own addresses. A dashboard, not a redirect to the shared search home — Psychiatry has no search results surface.",
  "/admin":
    "Admin Today: the next renewal to act on, what needs you, statewide requirements recorded and new-job progress. Admin has no search results surface.",
  "/admin/renewals":
    "Statewide requirements alongside the doctor's own recorded dates and personal renewals; dates are not verified with an issuing body.",
  "/admin/new-job": "Starting and leaving a job, with the doctor's own progress and service contacts.",
  "/admin/new-job/records": "The doctor's own Admin records to copy or print.",
  "/admin/help": "Crisis lines, support, guides, contacts and on-site detail with in-page search.",
  "/my-work": "Compatibility redirect to `/admin`, carrying the query string.",
  "/on-call/compliance": "Compatibility redirect to `/admin/renewals`, carrying the query string.",
  "/on-call/logistics": "Compatibility redirect to `/admin/help`, carrying the query string.",
  "/first-nations":
    "First Nations Bedside page: the Aboriginal liaison figure for the chosen hospital, the crisis strip (000 and 13YARN), what to do first and links to the eight section pages. A dashboard, not a redirect to the shared search home — First Nations has no search results surface.",
  "/first-nations/contacts":
    "First Nations contacts: liaison, community-controlled health services and statewide lines, each with its source and checked date.",
  "/first-nations/talking":
    "First Nations Talking: how to open a conversation, words to say aloud and the Mental Health Act s 81 cultural-support provisions.",
  "/first-nations/family": "First Nations Family: involving family, kin and community in care.",
  "/first-nations/mental-health": "First Nations Mental health: culturally safe assessment and support.",
  "/first-nations/on-the-ward": "First Nations On the ward: situation plans for the admission (nothing is saved).",
  "/first-nations/mistakes": "First Nations Common mistakes: what to avoid and what to do instead.",
  "/first-nations/going-home": "First Nations Going home: discharge planning, travel support and return to Country.",
  "/first-nations/end-of-life": "First Nations End of life: Sorry Business and caring for the family.",
  "/first-nations/card": "First Nations pocket card: the key numbers and prompts on one printable card.",
  "/teaching":
    "Teaching's Today: the next session as a summary hero with only the actions that apply (Join and Details, or Scan to check in and Check in without code while it is on), what needs the doctor, and one row to the rest of the week, across every service the doctor belongs to. Signed-out readers can open a made-up demo.",
  "/teaching/week":
    "The week: a seven-day rail, Whole service or Presenting, every remaining day grouped, Add to my calendar, the doctor's own teaching list also shown from On Call (edited with On Call's editor) and the service handbook's teaching entries.",
  "/teaching/logbook":
    "The doctor's attendance record: this term, hours, sessions not yet in CPD, a weekly chart, and a ledger by month with Log to CPD and a CSV download.",
  "/teaching/teach":
    "Presenter preparation, de-identification confirmation, taught-before history and released feedback totals.",
  "/teaching/supervision":
    "Private registrar and supervisor records, targets, confirmation and retained corrections with a ten-second Undo window.",
  "/teaching/feedback": "Tap-only feedback for attended sessions; no free text or responder names in presenter totals.",
  "/teaching/review":
    "Explicit selection and hours for weekly personal CPD logging; attendance never awards credit automatically.",
  "/teaching/import":
    "Organiser timetable CSV/XLSX preview before explicit import, with no patient details or uploaded slides.",
  "/teaching/organise":
    "For a service's organisers: the next 48 hours with clashes named, counts, series, groups, members, invitations, posting a change with a 10-second undo, and the attendance export.",
  "/teaching/whats-on":
    "What's on across the doctor's health service: On now leads with Join, a day rail and an All / My level / Online switch, and a plus to add another service's open session to the doctor's own week.",
  "/teaching/session/[id]":
    "One session under the in-page header: when and where, a change line when it was moved or cancelled, the phase module (On now, check-in, Log to CPD after it ends), details and materials. A removed session says it is no longer in the programme.",
  "/teaching/session/[id]/check-in":
    "The presenter's check-in screen: a QR and its six digits that change every 30 seconds, a draining hairline, Room or Teams, counts, and a link to a shared screen. The code comes down when the connection drops.",
  "/teaching/c/[token]":
    "Where a scanned check-in QR lands. It opens the scan and finishes it; signed out, it sends a sign-in link that returns to `/teaching/c/complete`. Not indexed, and sends no referrer.",
  "/teaching/c/complete": "Finishes a check-in after sign-in, from the claim this browser holds.",
  "/teaching/display/[token]":
    "The shared check-in screen for a projector or a Teams share: title, room, the QR, its six digits and a draining hairline. No app chrome and no sign-in.",
  "/cme":
    "CPD dashboard: total hours logged this year against the confirmed targets, a plain-words pace line for the year's end, the next thing to do, and the modules the owner has chosen to show below that. A dashboard, not a redirect to the shared search home — CPD has no search results surface.",
  "/cme/log":
    "Every continuing-education activity recorded, grouped by month, with a category filter and a text search box. Each row opens the entry it belongs to.",
  "/cme/log/[id]":
    "One recorded activity in full: its date, hours, the categories those hours count toward, and the reflection written for it. Offers a copy-to-clipboard action for pasting the entry into an external CPD portal.",
  "/cme/new":
    "Log a new continuing-education activity — title, date, hours, the categories they split across, and an optional reflection — saved through `/api/cme/entries`.",
  "/cme/routines":
    "The activities done on a regular schedule, such as monthly or by term, and when each is next due. A Log control opens the new-entry form prefilled from the routine.",
  "/cme/training":
    "The trainee's own training timeline: stages, rotations and breaks they enter themselves, where they are now, the training clock in FTE months (half-time counts half, breaks pause it) and the next milestone due. Nothing is preloaded, and it never changes CPD targets.",
  "/cme/plan":
    "The yearly development plan screen. Not yet built in this phase — the page says so plainly, and offers logging the time spent writing the plan as an activity so the hours still count toward the year.",
  "/cme/learning":
    "A curated list of upcoming Western Australian courses and events, read from a checked-in data file. Past events drop off by today's Perth date, items with unconfirmed dates sit in their own section, and each item links to the organiser and to a prefilled Log as CPD form.",
  "/cme/programme":
    "The requirement targets confirmed for this year — hours required in each category — and the source document they were confirmed against.",
  "/cme/setup":
    "The one-time setup checklist: confirm this year's requirement targets, set up routines, and the other steps this phase has not built yet.",
  "/cme/customise":
    "Choose which modules show on the CPD dashboard below the hours, pace and next-action rows, and reorder them with up/down controls that work as well from a keyboard as from a pointer.",
  "/tools": "Clinical tools and applications launcher directory.",
  // Mockup routes deliberately carry no curated description here — the developer-gated
  // prototypes (see src/lib/developer-area/headers.ts) have none either — so they render with
  // the generic "Route discovered from app directory" fallback in the Mockup/prototype routes
  // section below.
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
  ["Safety Plan", "src/app/safety-plan, src/components/patient-safety-plan.tsx"],
  ["Privacy", "src/app/privacy"],
  [
    "Tools",
    "src/app/(search-app)/tools, src/components/tools/tools-search-results-page.tsx, src/components/tools/tool-quick-actions.tsx",
  ],
  ["Sources", "src/app/(search-app)/sources, src/components/sources, src/lib/sources"],
  ["On Call", "src/app/(search-app)/on-call, src/components/on-call"],
  ["CPD", "src/app/(search-app)/cme, src/components/cme"],
  ["Psychiatry", "src/app/(search-app)/psychiatry, src/components/psychiatry"],
  ["Admin", "src/app/(search-app)/admin, src/components/admin, src/lib/admin"],
  ["First Nations", "src/app/(search-app)/first-nations, src/components/first-nations, src/lib/first-nations"],
  ["Teaching", "src/app/(search-app)/teaching, src/app/(display)/teaching, src/components/teaching"],
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
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, targetFileName));
      continue;
    }
    if (entry.isFile() && entry.name === targetFileName) files.push(fullPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * A DISPERSING order, not an alphabetical one — matching the approach in
 * `scripts/generate-repo-awareness-snapshot.ts` (#X2FP2R).
 *
 * Sorted by route path alphabetically, two routes added on concurrent branches
 * land adjacent to each other whenever their paths sort next to each other,
 * producing hard merge conflicts in docs/site-map.md (e.g. PR #2674 on /mockups/s*).
 *
 * A SHA-1 hash of the route path is uniformly distributed, so concurrent additions
 * land far apart across the document and git's three-way merge resolves both
 * hunks untouched.
 */
export function dispersalKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function byDispersedRoute<T extends { route: string; file: string; target?: string }>(
  left: T,
  right: T,
): number {
  return (
    dispersalKey(left.route).localeCompare(dispersalKey(right.route)) ||
    left.route.localeCompare(right.route) ||
    left.file.localeCompare(right.file) ||
    (left.target ?? "").localeCompare(right.target ?? "")
  );
}

function discoverRoutes(kind: RouteKind): DiscoveredRoute[] {
  const targetFiles = kind === "page" ? ["page.tsx"] : ["route.ts", "route.tsx"];
  return targetFiles
    .flatMap((targetFile) => collectFiles(appDir, targetFile))
    .map((file) => ({
      route: fileToRoute(file, kind),
      file: toPosixPath(path.relative(process.cwd(), file)),
    }))
    .sort(byDispersedRoute);
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
      .sort(byDispersedRoute)
  );
}

function discoverNonRoutedMockupArtifacts() {
  const mockupsDir = path.join(process.cwd(), "mockups");
  if (!existsSync(mockupsDir)) return [];
  return collectFiles(mockupsDir, "page.tsx")
    .map((file) => toPosixPath(path.relative(process.cwd(), file)))
    .sort((left, right) => dispersalKey(left).localeCompare(dispersalKey(right)) || left.localeCompare(right));
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
    sources: appModeHomeHref("sources", { query: "RANZCP", focus: true, run: true }),
    "on-call": appModeHomeHref("on-call", { query: "after-hours registrar", focus: true, run: true }),
    cme: appModeHomeHref("cme", { query: "peer review group", focus: true, run: true }),
    psychiatry: appModeHomeHref("psychiatry"),
    "my-work": appModeHomeHref("my-work"),
    roster: appModeHomeHref("roster"),
    "first-nations": appModeHomeHref("first-nations"),
    teaching: appModeHomeHref("teaching"),
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
        "Canonical all-tools results directory at `/tools`; the universal mode picker opens it directly. `/?mode=tools` redirects here, so Tools has one surface.",
    },
    {
      mode: "Calculators",
      home: appModeHomeHref("calculators"),
      search: appModeHomeHref("calculators", { query: "PHQ-9", focus: true, run: true }),
      detail:
        "`/calculators/search` is the browsable calculator catalogue and scored-results surface; an empty query lists every calculator.",
    },
    {
      mode: "Factsheets",
      home: appModeHomeHref("factsheets"),
      search: appModeHomeHref("factsheets", { query: "sertraline", focus: true, run: true }),
      detail:
        "`/factsheets/search` is the query-and-filter surface; `/factsheets/topics` organises the library by category; `/factsheets/[slug]` records.",
    },
    {
      mode: "Dictionary",
      home: appModeHomeHref("dictionary"),
      search: appModeHomeHref("dictionary", { query: "MSE", focus: true, run: true }),
      detail:
        "`/dictionary/search` is one catalogue for both searching and browsing; `/dictionary/browse` redirects to it. Also `/topics`, `/topics/[slug]`, `/compare` and `/dictionary/[slug]` records; `/dictionary/sources` redirects to Sources.",
    },
    {
      mode: "Sources",
      home: appModeHomeHref("sources"),
      search: appModeHomeHref("sources", { query: "RANZCP", focus: true, run: true }),
      detail:
        "`/sources` redirects to the shared home, which carries a `Browse catalogue` chip; `/sources/search` is the filterable catalogue, and a submitted or filter-carrying deep link to `/sources` forwards there. Also `/sources/topics`, `/sources/publishers`, `/sources/method`, and `/sources/[sourceId]` traceability records.",
    },
    {
      mode: "Therapy Compass",
      home: appModeHomeHref("therapy-compass"),
      search: appModeHomeHref("therapy-compass", { query: "CBT", focus: true, run: true }),
      detail:
        "`/therapy-compass` redirects to the shared home; `/search` is a query-free browse. Also `/recommend`, `/compare`, `/pathways`, `/review`, and `/[slug]` records with `/brief` and `/sheet` outputs.",
    },
    {
      mode: "On Call",
      home: appModeHomeHref("on-call"),
      search: appModeHomeHref("on-call"),
      detail:
        'No results page — `resultsSurface: "none"`. `/on-call` is a shift dashboard; section pages include `/on-call/now`, `/on-call/call`, `/on-call/refer`, `/on-call/find`, `/on-call/whos-on`, `/on-call/compliance`, `/on-call/contacts`, and `/on-call/who-is-who`.',
    },
    {
      mode: "CPD",
      home: appModeHomeHref("cme"),
      search: appModeHomeHref("cme", { query: "peer review group", focus: true, run: true }),
      detail:
        'No results page — `resultsSurface: "none"`, like On Call. `/cme/log` full activity list, `/cme/log/[id]` one entry, `/cme/new` new-entry form, `/cme/routines` recurring activities and their due dates, `/cme/training` the trainee timeline, `/cme/learning` curated WA courses and events, plus `/cme/plan`, `/cme/programme`, `/cme/setup`, and `/cme/customise`.',
    },
    {
      mode: "Psychiatry",
      home: appModeHomeHref("psychiatry"),
      search: appModeHomeHref("psychiatry"),
      detail:
        'No results page — `resultsSurface: "none"`, like On Call and CPD. `/psychiatry` is a dashboard of links; the six modes it gathers keep their own routes and searches.',
    },
    {
      mode: "Admin",
      home: appModeHomeHref("my-work"),
      search: appModeHomeHref("my-work"),
      detail:
        'No results page — `resultsSurface: "none"`, like Psychiatry. `/admin` is Today; `/my-work`, `/on-call/compliance` and `/on-call/logistics` redirect to Admin pages.',
    },
    {
      mode: "Roster",
      home: appModeHomeHref("roster"),
      search: appModeHomeHref("roster"),
      detail:
        'No results page — `resultsSurface: "none"`, like On Call. `/roster` Today dashboard, `/roster/shifts` full schedule and month calendar, `/roster/calendar` feed subscribe, and `/roster/settings`.',
    },
    {
      mode: "First Nations",
      home: appModeHomeHref("first-nations"),
      search: appModeHomeHref("first-nations"),
      detail:
        'No results page — `resultsSurface: "none"`, like My Work. Every page keeps its own in-page search box. `/first-nations` Bedside, then `/contacts`, `/talking`, `/family`, `/mental-health`, `/on-the-ward`, `/mistakes`, `/going-home`, `/end-of-life`, and the `/card` pocket card.',
    },
    {
      mode: "Teaching",
      home: appModeHomeHref("teaching"),
      search: appModeHomeHref("teaching"),
      detail:
        'No results page — `resultsSurface: "none"`, like CPD. `/teaching` is Today; Week, Logbook and Organise are its other pages; `/teaching/session/[id]` is one session with `/check-in`; `/teaching/c/[token]` is the scan landing; `/teaching/display/[token]` is the chrome-free shared screen.',
    },
  ]);
}

function renderDocumentFlowIndex() {
  return [
    bullet(DOCUMENTS_MODE_HOME_ROUTE, "Redirects to the shared home with Documents preselected (consolidated mode)."),
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
      ].includes(route.route),
  );
  const mockupRoutes = data.pageRoutes.filter((route) => route.route.startsWith("/mockups"));
  const publicUtilityRouteHandlers = data.publicRouteHandlers.filter(
    (route) => !productRouteHandlerPaths.has(route.route),
  );

  const lines = [
    "# PsychSift Site Map",
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
      "- `/mockups/*` prototype routes are development-only: production returns 404 for every path except the developer-gated subtrees (`/mockups/development`, `/mockups/care-plan`), which carry their own signed-in administrator gate. `robots.txt` deliberately allows crawling; responses under `/mockups/:path*` carry `X-Robots-Tag: noindex, nofollow` instead, so per-response indexing policy can be observed.",
      "- `/mockups/favourites-hub` (to `/favourites`) and `/mockups/medication-prescribing` (to `/medications/acamprosate`) are legacy compatibility routes whose page-level redirects work in development only; in production the proxy's mockup block returns 404 before either page renders. `/mockups/document-search-command` is the one mockup path that still redirects in production, via `staticRouteRedirects` in `src/proxy.ts`.",
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

if (isDirectEntrypoint(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
