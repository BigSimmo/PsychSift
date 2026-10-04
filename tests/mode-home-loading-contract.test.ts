import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { standaloneModeHomePaths } from "@/lib/search-route-ownership";
import { describe, expect, it } from "vitest";

const SEARCH_APP_ROOT = join(process.cwd(), "src/app/(search-app)");

// This is deliberately not derived from composer ownership. Consolidated mode
// homes still need a route loading boundary while their dashboard shell mounts.
const MODE_HOME_LOADING_ROUTES = [
  "services",
  "forms",
  "favourites",
  "differentials",
  "dsm",
  "specifiers",
  "formulation",
  "therapy-compass",
  "factsheets",
  "tools",
  "medications",
  "documents",
  "calculators",
  "dictionary",
  "sources",
  // On Call's dashboard, which replaced its redirect stub. It joined
  // `standaloneModeHomePaths` at the same time, and the assertion below requires
  // every standalone home to appear here.
  "on-call",
  // CME's dashboard, which is a standalone mode home for On Call's reason and
  // so must appear here — the assertion below requires it.
  "cme",
  // Psychiatry's dashboard, a standalone mode home for the same reason.
  "psychiatry",
  // The Medicines & tools dashboard, Psychiatry's twin.
  "medicines",
  // Admin's Today (mode id `my-work`), likewise.
  "admin",
  // Renewals, where Admin now opens (modes review, phase 2b).
  "admin/renewals",
  // Roster's dashboard, a standalone mode home for the same reason.
  "roster",
  // First Nations' home: static skeleton plus the real crisis strip (spec §5),
  // so it names its own loading component.
  "first-nations",
  // Teaching's dashboard, likewise.
  "teaching",
  // My Day's merged list, likewise.
  "my-day",
] as const;

/**
 * Mode homes whose loading boundary draws their own dashboard's shapes instead
 * of the generic hero skeleton, so nothing jumps when the dashboard arrives.
 * CPD: spec §6.2 and standard v13 §7 (static, the loaded layout's shapes).
 */
const OWN_SKELETON: Partial<Record<(typeof MODE_HOME_LOADING_ROUTES)[number], string>> = {
  cme: "CmeLoadingSkeleton",
  // First Nations' home: static skeleton plus the real crisis strip (spec §5).
  "first-nations": "FirstNationsLoading",
  // Roster's narrow, top-aligned pages: identity tile, title, then modules.
  roster: "RosterLoadingSkeleton",
};

describe("mode-home loading contract", () => {
  it("keeps every named standalone mode home in the broader loading inventory", () => {
    for (const pathname of standaloneModeHomePaths) {
      expect(MODE_HOME_LOADING_ROUTES).toContain(pathname.slice(1));
    }
  });

  it("uses ModeHomeRouteLoading, or the home's own static skeleton, for every mode-home loading route", () => {
    for (const route of MODE_HOME_LOADING_ROUTES) {
      const loadingPath = join(SEARCH_APP_ROOT, route, "loading.tsx");
      expect(existsSync(loadingPath), `missing ${route}/loading.tsx`).toBe(true);
      const source = readFileSync(loadingPath, "utf8");
      expect(source).toContain(OWN_SKELETON[route] ?? "ModeHomeRouteLoading");
      expect(source).not.toMatch(/Loading services|Loading medication|Loading library/);
    }
  });

  it("does not blank standalone mode children behind ClientHydrationBoundary", () => {
    const shellSource = readFileSync(
      join(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    expect(shellSource).not.toMatch(/import\s*\{[^}]*ClientHydrationBoundary/);
    expect(shellSource).not.toMatch(/<ClientHydrationBoundary\b/);
    // Children stay under SearchCommandProvider; pending mode navigation may
    // temporarily swap in ModeHomeRouteLoading instead of blanking the provider.
    expect(shellSource).toMatch(
      /<SearchCommandProvider value=\{searchCommandContextValue\}>[\s\S]*?pendingModeNavigation \? \([\s\S]*?<ModeHomeRouteLoading \/>[\s\S]*?\) : \(\s*children\s*\)\}/,
    );
  });

  it("keeps route children outside useSearchParams Suspense on standalone shells", () => {
    const shellSource = readFileSync(
      join(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    const ownershipSource = readFileSync(join(process.cwd(), "src/lib/search-route-ownership.ts"), "utf8");
    expect(ownershipSource).toContain("export function isAlwaysStandaloneShellPath");
    // Outer shell skips the useSearchParams Suspense for always-standalone paths.
    expect(shellSource).toMatch(
      /export function GlobalSearchShell[\s\S]*?if \(isAlwaysStandaloneShellPath\(pathname\)\) \{[\s\S]*?GlobalStandaloneSearchShellClient/,
    );
    expect(shellSource).toContain("ShellSearchParamsBridge");
    // Bridge is the only Suspense child that may call useSearchParams in the
    // standalone path; the body that renders {children} must not.
    expect(shellSource).toMatch(
      /function GlobalStandaloneSearchShellClient[\s\S]*?<Suspense fallback=\{null\}>[\s\S]*?ShellSearchParamsBridge/,
    );
    expect(shellSource).toMatch(
      /function GlobalStandaloneSearchShellBody[\s\S]*?<SearchCommandProvider value=\{searchCommandContextValue\}>[\s\S]*?pendingModeNavigation \? \([\s\S]*?<ModeHomeRouteLoading \/>[\s\S]*?\) : \(\s*children\s*\)\}/,
    );
    expect(shellSource).not.toMatch(/function GlobalStandaloneSearchShellBody[\s\S]*?useSearchParams\(\)/);
    // Secondary nav is mounted inside the standalone body; it must consume the
    // bridged searchParamString prop rather than calling useSearchParams again.
    const secondaryNavSource = readFileSync(
      join(process.cwd(), "src/components/page-secondary-navigation.tsx"),
      "utf8",
    );
    expect(secondaryNavSource).not.toMatch(/useSearchParams\s*\(/);
    expect(secondaryNavSource).toMatch(/searchParamString/);
    expect(shellSource).toMatch(/<PageSecondaryNavigation[\s\S]*?searchParamString=\{searchParamString\}/);
  });

  it("lazy-loads ClinicalDashboard so namespaced homes skip its module graph", () => {
    const shellSource = readFileSync(
      join(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
      "utf8",
    );
    expect(shellSource).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("@\/components\/ClinicalDashboard"\)/);
    expect(shellSource).not.toMatch(/^import \{ ClinicalDashboard \} from/m);
  });

  it("loads the Therapy workspace only for rich child routes, not the lightweight home", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/therapy-compass/therapy-compass-route-layout.tsx"),
      "utf8",
    );
    expect(source).toMatch(/dynamic\([\s\S]*?import\("\.\/workspace"\)/);
    expect(source).not.toMatch(/^import \{ TherapyCompassWorkspace \}/m);
    expect(source).toContain("pathname === THERAPY_HOME");
  });

  it("routes the shared mode home body through the shared ModeHomeTemplate composer host", () => {
    // A hand-rolled composer slot omits the SSR data-composer-reserve/min-h
    // reserve that ModeHomeTemplate provides, which regresses the shared
    // "one composer host" contract — see docs/search-chrome-behaviour.md
    // Invariant 15. Factsheets (and every other consolidated mode) now land
    // on this same SharedHomeEmptyState surface.
    const sharedHomeSource = readFileSync(
      join(process.cwd(), "src/components/clinical-dashboard/answer-status.tsx"),
      "utf8",
    );
    expect(sharedHomeSource).toMatch(
      /import\s*\{[^}]*ModeHomeTemplate[^}]*\}\s*from\s*"@\/components\/mode-home-template"/,
    );
    expect(sharedHomeSource).toMatch(/<ModeHomeTemplate\b/);
    expect(sharedHomeSource).not.toMatch(/DesktopComposerPortalSlot/);
  });

  it("keeps mode-home route loading top-aligned on phones", () => {
    const skeletonSource = readFileSync(join(process.cwd(), "src/components/mode-home-page-skeleton.tsx"), "utf8");
    expect(skeletonSource).toContain("items-start");
    expect(skeletonSource).toContain("sm:items-center");
  });
});

// Keep the suite from being deleted as unused if the route inventory drifts.
describe("search-app route inventory smoke", () => {
  it("still has a (search-app) tree", () => {
    expect(statSync(SEARCH_APP_ROOT).isDirectory()).toBe(true);
    expect(readdirSync(SEARCH_APP_ROOT).length).toBeGreaterThan(5);
  });
});
