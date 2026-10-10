import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { HomePageClient } from "./home-page-client";
import { SearchAppHomeDiscovery } from "./search-app-home-discovery";
import { appModeHomeHref, isAppModeId, isAppModeVisible, type AppModeId } from "@/lib/app-modes";
import { isDashboardModeHref } from "@/lib/search-route-ownership";
import { readSearchNavigationContext } from "@/lib/search-navigation-context";
import { sharedHomeDocumentTitle } from "@/lib/ui-copy";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function searchParamsFromRecord(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) search.append(key, entry);
    } else {
      search.set(key, value);
    }
  }
  return search;
}

/**
 * Keep the shared home's browser/assistive-technology title aligned with the
 * mode-specific heading that is actually rendered. Next's route announcer uses
 * this title first, so leaving every mode as just "PsychSift" makes a mode
 * switch or deep link needlessly ambiguous outside the visual canvas.
 */
export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  const params = searchParams ? await searchParams : {};
  const requestedMode = firstSearchParam(params.mode);
  const mode = isAppModeId(requestedMode) && isAppModeVisible(requestedMode) ? requestedMode : "answer";

  // Every `/?mode=<id>` variant renders this same home page, so they all name `/` as canonical
  // rather than competing as duplicates (audit F26). Set per page, never in the root layout,
  // where it would point every route at the home page.
  return { title: sharedHomeDocumentTitle(mode), alternates: { canonical: "/" } };
}

export default async function Home({ searchParams }: HomeProps) {
  // The dashboard reads and updates the query string throughout its client
  // lifecycle. Render it for the incoming request so `useSearchParams()` is
  // available during the initial server render instead of leaving the entire
  // interactive shell behind a hydration-only Suspense fallback.
  await connection();
  const params = searchParams ? await searchParams : {};
  const requestedMode = firstSearchParam(params.mode);
  let initialSearchMode: AppModeId = "answer";
  if (isAppModeId(requestedMode) && isAppModeVisible(requestedMode)) {
    initialSearchMode = requestedMode;
  } else if (requestedMode) {
    // Hidden or malformed mode links must not leave an impossible mode in the
    // browser URL. Canonicalising to Answer also lets same-path navigations clear
    // submitted search state rather than retaining results under a rejected mode.
    const canonicalParams = searchParamsFromRecord(params);
    canonicalParams.set("mode", "answer");
    redirect(`/?${canonicalParams.toString()}`);
  }

  // `/` is the single home page for every mode: the mode pill retargets the
  // composer rather than navigating, so a bare `/?mode=<id>` must RENDER home
  // with that mode preselected. Only a *submitted* deep link (a query plus
  // `run=1`) still resolves to the mode's own search surface — that is the half
  // of the old redirect behaviour worth keeping, since such a URL names results
  // rather than a starting point.
  const query = firstSearchParam(params.q)?.trim();
  const focus = firstSearchParam(params.focus) === "1";
  const run = firstSearchParam(params.run) === "1";
  const submitted = Boolean(query) && run;

  if (submitted) {
    const navigationContext = readSearchNavigationContext(searchParamsFromRecord(params));
    const destination = appModeHomeHref(initialSearchMode, {
      query,
      focus,
      run,
      queryMode: navigationContext.queryMode,
      scopeFilters: navigationContext.scopeFilters,
      scopeRef: navigationContext.scopeRef,
    });
    // Answer and prescribing resolve back to `/?mode=…`; redirecting there would
    // loop. Everything else names a route the dashboard does not own.
    if (!isDashboardModeHref(destination)) {
      redirect(destination);
    }
  }

  return (
    <>
      <SearchAppHomeDiscovery />
      <HomePageClient initialMode={initialSearchMode} />
    </>
  );
}
