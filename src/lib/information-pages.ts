/**
 * Information pages are per-mode detail / record surfaces (not mode homes, builders,
 * compare/map tools, or search results). The global search shell uses this to suppress
 * the floating composer on read-focused routes.
 *
 * Basic chrome for these pages lives in `src/components/information-page-shell.tsx`.
 * Intentional opt-outs from that shell (different product chrome): document viewer
 * and the differentials presentation workflow.
 */

export type InformationPageMode =
  | "services"
  | "forms"
  | "prescribing"
  | "specifiers"
  | "formulation"
  | "factsheets"
  | "dictionary"
  | "therapy-compass"
  | "differentials"
  | "dsm"
  | "documents"
  | "sources"
  | "on-call"
  | "cme"
  | "psychiatry"
  | "my-work"
  | "roster"
  | "first-nations"
  | "my-day"
  | "teaching";

// Reserved route suffixes, not record slugs. `search` is here because home
// consolidation gave every consolidated mode a `<mode>/search` results route:
// without it, `/formulation/search` reads as the record `search`, the route is
// classified as an information page, and information pages suppress the
// composer — so a submitted search rendered its results with no way to refine
// them. `/factsheets` and `/dictionary` had already hand-excluded "search" for
// the same reason, which is the signal this belonged in the shared set.
const TOOL_SUFFIXES = new Set(["builder", "compare", "map", "search"]);

/**
 * `/services/some-slug`, but not `/services`, a tool suffix, or a deeper path.
 *
 * Exported so `isHeaderAddonSlotOwnedRoute` can share the one implementation:
 * every claimant route it names must also be `isInformationPage`, and a second
 * hand-copied slug test is how that agreement would silently diverge.
 */
export function isSlugDetail(pathname: string, home: string, extraExcluded: string[] = []): boolean {
  if (!pathname.startsWith(`${home}/`) || pathname === home) return false;
  const rest = pathname.slice(home.length + 1);
  if (!rest || rest.includes("/")) return false;
  if (extraExcluded.includes(rest) || TOOL_SUFFIXES.has(rest)) return false;
  return true;
}

/**
 * True when `pathname` is a mode information (detail/record) page.
 * Keep in sync with adoption notes on `InformationPageShell`.
 */
export function isInformationPage(pathname: string): boolean {
  if (isSlugDetail(pathname, "/services")) return true;
  if (isSlugDetail(pathname, "/forms")) return true;
  if (isSlugDetail(pathname, "/medications")) return true;
  if (isSlugDetail(pathname, "/specifiers")) return true;
  if (isSlugDetail(pathname, "/formulation")) return true;
  if (isSlugDetail(pathname, "/factsheets", ["search", "topics"])) return true;
  if (isSlugDetail(pathname, "/dictionary", ["search", "browse", "topics", "compare", "sources"])) return true;
  if (isSlugDetail(pathname, "/sources", ["topics", "publishers", "method"])) return true;
  // Every On Call route, the mode home included. The mode declares no search
  // surface: it has no composer on any page, filter chips inside a page do the
  // narrowing, and this is what keeps the shell from mounting one. Its pages
  // also own their header navigation — the section pages mount `RegistryModeNav`
  // themselves and `/on-call/card` mounts `InPageNavHeader` — so being an
  // information page is also what stops the shell drawing a second bar over the
  // top. The two facts are one fact, which is why they share this line.
  //
  // `isSlugDetail` covers the single-segment children and excludes nothing that
  // still exists: `search` was in the shared `TOOL_SUFFIXES` set and that route
  // is gone. `/on-call` itself is the bare path, not a slug detail, so it needs
  // its own test.
  if (isSlugDetail(pathname, "/on-call")) return true;
  if (pathname === "/on-call") return true;
  // Every CME route, the mode home included, for On Call's reason exactly: the
  // mode declares no search surface, so it has no composer on any page and this
  // is what keeps the shell from mounting one. `isSlugDetail` covers the
  // single-segment children (`/cme/log`, `/cme/new`, `/cme/routines`,
  // `/cme/plan`, `/cme/programme`, `/cme/setup`, `/cme/customise`) and `/cme`
  // itself is the bare path rather than a slug detail, so it needs its own test.
  // One entry (`/cme/log/[id]`) is two segments deep and `isSlugDetail` stops
  // short of it, so it is named separately — the entry record is the most
  // read-focused page in the mode and must not be the only one wearing a
  // composer.
  if (isSlugDetail(pathname, "/cme")) return true;
  if (pathname === "/cme") return true;
  if (pathname.startsWith("/cme/log/") && !pathname.slice("/cme/log/".length).includes("/")) return true;
  // The Psychiatry dashboard, for On Call's reason: the mode declares no search
  // surface, so its home must not wear a composer. The sections it links to
  // keep their own routes and their own composers.
  if (pathname === "/psychiatry") return true;
  // Every Admin page owns its in-page navigation and has no search composer.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  // Every Roster route, the mode home included, for On Call's reason exactly:
  // the mode declares no search surface, so it has no composer on any page.
  // Its pages also own their in-page header (`InPageNavHeader`, the
  // DocumentViewer template) rather than the shared mode-nav bar, so being an
  // information page is also what stops the shell drawing a second bar over
  // the top. `isSlugDetail` covers the single-segment children (`/roster/shifts`,
  // `/roster/settings`, `/roster/calendar`) and `/roster` itself is the bare
  // path rather than a slug detail, so it needs its own test.
  if (isSlugDetail(pathname, "/roster")) return true;
  if (pathname === "/roster") return true;
  // Every First Nations route, the mode home included: the mode owns its own
  // in-page search box on every page (standard §13), so it has no composer of
  // the shared kind on any route and this is what keeps the shell from
  // mounting one.
  if (pathname === "/first-nations" || pathname.startsWith("/first-nations/")) return true;
  // Every Teaching route, the mode home included, for On Call's reason: the
  // mode declares no search surface, so no route may wear a composer. Its
  // child pages mount their own `InPageNavHeader`
  // (`teaching/teaching-nav-header.tsx`), which being an information page
  // also keeps the shell from drawing a second bar over.
  if (pathname === "/teaching" || pathname.startsWith("/teaching/")) return true;
  // My Day, for Admin's reason: it declares no search surface, so it has no composer.
  if (pathname === "/my-day" || pathname.startsWith("/my-day/")) return true;
  if (pathname.startsWith("/dictionary/topics/") && !pathname.slice("/dictionary/topics/".length).includes("/"))
    return true;

  // Therapy compass detail: /therapy-compass/[slug]/brief or /sheet (and bare slug if present)
  if (
    pathname.startsWith("/therapy-compass/") &&
    pathname !== "/therapy-compass" &&
    pathname !== "/therapy-compass/compare" &&
    pathname !== "/therapy-compass/pathways" &&
    pathname !== "/therapy-compass/recommend" &&
    pathname !== "/therapy-compass/review" &&
    pathname !== "/therapy-compass/search"
  ) {
    return true;
  }

  if (pathname.startsWith("/differentials/diagnoses/") || pathname.startsWith("/differentials/presentations/")) {
    return true;
  }

  if (pathname.startsWith("/dsm/diagnoses/")) return true;

  if (pathname.startsWith("/documents/") && pathname !== "/documents/search") return true;

  return false;
}

/** Modes that use the shared `InformationPageShell` for outer chrome. */
export const informationPageShellModes = [
  "services",
  "forms",
  "prescribing",
  "specifiers",
  "formulation",
  "factsheets",
  "dictionary",
  "sources",
  "therapy-compass",
  "dsm",
  "on-call",
  "cme",
  "psychiatry",
  "my-work",
  "roster",
  "first-nations",
  "teaching",
  "my-day",
] as const satisfies readonly InformationPageMode[];
