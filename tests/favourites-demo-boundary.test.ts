import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { resolveClientDemoMode } from "@/lib/client-env";

const routeSource = readFileSync(new URL("../src/app/(search-app)/favourites/page.tsx", import.meta.url), "utf8");
const librarySource = readFileSync(
  new URL("../src/components/clinical-dashboard/favourites-command-library-page.tsx", import.meta.url),
  "utf8",
);
const rowSource = readFileSync(new URL("../src/components/favourites/favourite-row.tsx", import.meta.url), "utf8");
const hubSource = readFileSync(
  new URL("../src/components/clinical-dashboard/favourites-hub.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(new URL("../src/components/ClinicalDashboard.tsx", import.meta.url), "utf8");
const globalShellSource = readFileSync(
  new URL("../src/components/clinical-dashboard/global-search-shell.tsx", import.meta.url),
  "utf8",
);
const universalSearchSource = readFileSync(
  new URL("../src/components/clinical-dashboard/universal-search-command-surface.tsx", import.meta.url),
  "utf8",
);
// The 2026-09-29 phone redesign replaced the mobile card with one row used at
// every width. Below xl the row is a plain link; slice exactly that element so
// the assertions below cannot be satisfied by the xl-only select button beside it.
const phoneLinkStart = rowSource.indexOf("<Link");
const phoneLinkEnd = rowSource.indexOf("</Link>", phoneLinkStart);
const phoneRowLinkSource = rowSource.slice(phoneLinkStart, phoneLinkEnd);

describe("favourites demo-data boundary", () => {
  it("passes trusted server demo state and never merges prototype favourites into live mode unconditionally", () => {
    expect(routeSource).toContain("const demoMode = resolveClientDemoMode({");
    expect(routeSource).toContain("explicitDemoMode: isDemoMode(),");
    expect(routeSource).toContain("localNoAuthMode: isLocalNoAuthMode(),");
    expect(routeSource).toContain("demoMode={demoMode}");
    expect(librarySource).toContain("...(demoMode ? prototypeFavouriteItems : [])");
    expect(librarySource).not.toContain("[...prototypeFavouriteItems, ...savedRegistryFavourites]");
    expect(dashboardSource).toContain("demoMode={clientDemoMode}");
    expect(hubSource).toContain("...(demoMode ? favouriteItems : [])");
    expect(hubSource).not.toContain("[...favouriteItems, ...savedRegistryFavourites]");
    expect(hubSource).toContain('aria-describedby="favourites-sort-unavailable"');
    expect(hubSource).toContain('aria-describedby="favourites-add-unavailable"');
    expect(hubSource).toContain('aria-describedby="favourites-new-set-unavailable"');
    expect(hubSource).toContain("Browse sets");
    expect(dashboardSource).not.toContain("Favourite creation is ready to connect.");
    expect(globalShellSource).toContain("demoMode={clientDemoMode}");
    expect(universalSearchSource).toContain("...(demoMode ? favouriteItems : [])");
    expect(universalSearchSource).not.toContain("[...favouriteItems, ...savedRegistryFavourites]");
    expect(universalSearchSource).toContain("if (includePrototypeSets)");
    expect(universalSearchSource).toContain("rankLocalFavourites(allFavouriteItems, deferredTrimmedQuery, demoMode)");
  });

  it("fails closed in production while preserving explicit and non-production demo modes", () => {
    expect(
      resolveClientDemoMode({
        explicitDemoMode: false,
        authUnavailableFallback: true,
        localNoAuthMode: false,
        environment: "production",
      }),
    ).toBe(false);
    expect(
      resolveClientDemoMode({
        explicitDemoMode: true,
        authUnavailableFallback: true,
        localNoAuthMode: false,
        environment: "production",
      }),
    ).toBe(true);
    expect(
      resolveClientDemoMode({
        explicitDemoMode: false,
        authUnavailableFallback: true,
        localNoAuthMode: false,
        environment: "development",
      }),
    ).toBe(true);
  });

  it("limits item selection to xl rows and keeps phone rows open-only", () => {
    expect(phoneRowLinkSource).toContain("<Link");
    expect(phoneRowLinkSource).toContain('"block min-w-0 max-w-full rounded-md text-left xl:hidden"');
    expect(phoneRowLinkSource).not.toContain("aria-pressed");
    expect(phoneRowLinkSource).not.toContain("onSelect");
    expect(phoneRowLinkSource).toContain("onClick={() => onOpen(item)}");
    expect(rowSource).toContain('"hidden min-w-0 max-w-full items-center gap-2.5 rounded-md text-left xl:flex"');
    expect(rowSource).toContain('workspaceSelected && "xl:bg-[color:var(--clinical-accent-soft)]"');
    expect(rowSource).toContain("aria-label={`More actions for ${item.title}`}");
  });

  it("keeps local no-auth within the non-production demo boundary", () => {
    expect(
      resolveClientDemoMode({
        explicitDemoMode: false,
        authUnavailableFallback: false,
        localNoAuthMode: true,
        environment: "development",
      }),
    ).toBe(true);
    expect(
      resolveClientDemoMode({
        explicitDemoMode: false,
        authUnavailableFallback: false,
        localNoAuthMode: false,
        environment: "development",
      }),
    ).toBe(false);
  });
});
