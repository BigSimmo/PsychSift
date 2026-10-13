import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { appModeHomeHref } from "@/lib/app-modes";
import { isStandaloneModeHomePath, shouldRenderDashboardSearch } from "@/lib/search-route-ownership";
import { sharedHomePresentation } from "@/lib/ui-copy";
import {
  THERAPY_CATALOGUE_ASSETS,
  THERAPY_CATALOGUE_ASSETS_PREVIOUS,
  THERAPY_CATALOGUE_SUMMARY,
} from "@/components/therapy-compass/data/generated-assets";

// Guards the two production-mode wiring invariants for Therapy Compass. Both were
// real breakages caught in review when the mockup was promoted to a live mode.

const loaderSrc = readFileSync(
  new URL("../src/components/therapy-compass/data/use-therapy-data.ts", import.meta.url),
  "utf8",
);
const bindingsSrc = readFileSync(new URL("../src/components/therapy-compass/bindings.tsx", import.meta.url), "utf8");
const dataDir = new URL("../public/therapy-compass-data/", import.meta.url);
const legacyCatalogueAssets = {
  full: "therapies.json",
  index: "therapies-index.json",
} as const;
const therapyMetadataFiles = [
  "../src/app/(search-app)/therapy-compass/page.tsx",
  "../src/app/(search-app)/therapy-compass/search/page.tsx",
  "../src/app/(search-app)/therapy-compass/recommend/page.tsx",
  "../src/app/(search-app)/therapy-compass/compare/page.tsx",
  "../src/app/(search-app)/therapy-compass/pathways/page.tsx",
  "../src/app/(search-app)/therapy-compass/review/page.tsx",
  "../src/app/(search-app)/therapy-compass/[slug]/page.tsx",
  "../src/app/(search-app)/therapy-compass/[slug]/brief/page.tsx",
  "../src/app/(search-app)/therapy-compass/[slug]/sheet/page.tsx",
];

describe("Therapy Compass production-mode wiring", () => {
  it("uses Therapy for user-facing mode copy, search results ribbon, and page metadata", () => {
    const appModesSrc = readFileSync(new URL("../src/lib/app-modes.ts", import.meta.url), "utf8");
    const workspaceSrc = readFileSync(
      new URL("../src/components/therapy-compass/workspace.tsx", import.meta.url),
      "utf8",
    );
    const searchSrc = readFileSync(
      new URL("../src/components/therapy-compass/screens/search-screen.tsx", import.meta.url),
      "utf8",
    );
    const sidebarSrc = readFileSync(
      new URL("../src/components/clinical-dashboard/ClinicalSidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(appModesSrc).toContain('label: "Therapy"');
    expect(appModesSrc).toContain('placeholder: "Search therapies..."');
    expect(appModesSrc).toContain('inputAriaLabel: "Search therapies by problem, symptom, skill, or population"');
    expect(appModesSrc).toContain('submitAriaLabel: "Open Therapy"');
    expect(sharedHomePresentation["therapy-compass"].title).toBe("Therapy");
    // Search route owns filters/results only; the results ribbon is the page h1.
    expect(searchSrc).toContain("SearchResultsHeaderBand");
    expect(searchSrc).toContain("headingLevel={1}");
    // Documents-style gap so the band does not sit flush on the first card.
    expect(searchSrc).toContain("space-y-2.5 sm:space-y-3");
    expect(searchSrc).not.toContain("Search therapies");
    expect(searchSrc).not.toContain("Find source-grounded therapy records");
    expect(workspaceSrc).toContain("Therapy could not load");
    // Therapy stays out of the six-item sidebar; mode discovery is via Tools/search.
    expect(sidebarSrc).not.toContain('id: "therapy-compass"');
    expect(appModesSrc).not.toContain("Therapy mode");
    expect(searchSrc).not.toContain("Therapy Search");
    expect(workspaceSrc).not.toContain("Therapy mode");

    for (const filename of therapyMetadataFiles) {
      const source = readFileSync(new URL(filename, import.meta.url), "utf8");
      expect(source, filename).toContain("Therapy");
      expect(source, filename).not.toContain("Therapy mode");
      expect(source, filename).not.toContain("Therapy Compass");
    }
  });

  it("loads its dataset from a non-/mockups path (proxy.ts 404s every /mockups path in production)", () => {
    const base = loaderSrc.match(/const BASE = "([^"]+)"/)?.[1];
    expect(base).toBeTruthy();
    expect(base).not.toMatch(/^\/mockups/);
  });

  it("ships the dataset at the non-mockups public path the loader points to", () => {
    for (const file of [...Object.values(THERAPY_CATALOGUE_ASSETS), "pathways.json", "reference.json"]) {
      expect(existsSync(new URL(file, dataDir))).toBe(true);
    }
  });

  it("ships only the two reachable catalogue kinds", () => {
    expect(Object.keys(THERAPY_CATALOGUE_ASSETS)).toEqual(["full", "index"]);
    expect(Object.keys(THERAPY_CATALOGUE_ASSETS_PREVIOUS)).toEqual(["full", "index"]);

    const retiredHomeAssets = readdirSync(dataDir).filter((name) =>
      /^therapies-home(?:\.[a-f0-9]{16})?\.json$/.test(name),
    );
    expect(retiredHomeAssets).toEqual([]);
    expect(loaderSrc).not.toMatch(/["']home["']/);
    expect(loaderSrc).not.toContain("therapies-home.json");

    const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    expect(nextConfig).not.toContain("therapies-home");

    const generatorSource = readFileSync(new URL("../scripts/build-therapies-index.mjs", import.meta.url), "utf8");
    const therapyContractSource = readFileSync(
      new URL("../scripts/lib/therapy-review-contract.mjs", import.meta.url),
      "utf8",
    );
    expect(therapyContractSource).toContain('retiredHomeAlias: "therapies-home.json"');
    expect(therapyContractSource).toContain("/^therapies(?:-(?:home|index))?");
    expect(generatorSource).toContain("const RETIRED_HOME_ALIAS = THERAPY_GENERATED_PATHS.retiredHomeAlias");
    expect(generatorSource).toContain("existsSync(join(publicData, RETIRED_HOME_ALIAS))");
    expect(generatorSource).toContain("const HASHED_ASSET_RE = THERAPY_HASHED_ASSET_RE");

    for (const filename of ["ui-therapy-nav-scroll.spec.ts", "ui-route-coverage.spec.ts"]) {
      const fixtureSource = readFileSync(new URL(filename, import.meta.url), "utf8");
      expect(fixtureSource, filename).not.toContain("(?:home|index)");
      expect(fixtureSource, filename).not.toContain("therapies-home");
    }
  });

  it("serves unversioned catalogue aliases by rewrite, not by duplicating bytes", () => {
    // The aliases used to be real files written byte-identical to their hashed
    // twin, costing a second copy of every payload in the tree and in every
    // Docker image (2.66 MB; 5.33 MB during the one-deploy grace window). They
    // are now next.config.ts rewrites onto the current content-addressed asset,
    // so the URLs behave the same with no duplicated bytes.
    const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    for (const kind of ["full", "index"] as const) {
      const alias = legacyCatalogueAssets[kind];
      expect(existsSync(new URL(alias, dataDir)), `${alias} must not exist as a duplicate file`).toBe(false);
      expect(nextConfig, alias).toContain(`alias("${alias}", THERAPY_CATALOGUE_ASSETS.${kind})`);
    }
    // afterFiles, so a stray alias file would win over the rewrite and go stale.
    // build-therapies-index.mjs --check fails if one reappears; this pins the
    // ordering assumption that makes that check the right guard.
    expect(nextConfig).toContain("afterFiles: [");
  });

  it("commits no catalogue assets older than the one-deploy grace generation", () => {
    // Every regeneration mints new hashed filenames. Without pruning, each data
    // revision strands the previous full catalogue (~2.5 MB) plus the browse
    // projection in `public/` permanently — in git history and in every Docker
    // image. PR #1489 stranded two inside a single pull request and needed a
    // hand-deletion commit. `check:therapy-data-index` enforces the same rule;
    // this pins it for anyone who adds a hashed file without rerunning it.
    // Typed as string: the manifests are `as const`, so an inferred Set would be
    // keyed to today's exact filenames and reject any other name outright.
    const manifested = new Set<string>([
      ...Object.values(THERAPY_CATALOGUE_ASSETS),
      ...Object.values(THERAPY_CATALOGUE_ASSETS_PREVIOUS),
    ]);
    const hashed = readdirSync(dataDir).filter((name) =>
      /^therapies(?:-(?:home|index))?\.[a-f0-9]{16}\.json$/.test(name),
    );
    expect(hashed.length).toBeGreaterThan(0);
    expect(hashed.filter((name) => !manifested.has(name))).toEqual([]);
    // Growth is bounded at two generations per retained stem, not N. The regex
    // deliberately still sees retired home assets so one can never hide from
    // the orphan check above.
    expect(hashed.length).toBeLessThanOrEqual(4);
  });

  it("retains the previous generation on disk so pre-deploy bundles do not 404", () => {
    // A session that started before the last deploy has the previous
    // content-addressed URL compiled into its bundle. Pruning it the moment the
    // catalogue regenerates reintroduces the deployment-straddling 404 the
    // unversioned aliases exist to prevent, one level down.
    for (const file of Object.values(THERAPY_CATALOGUE_ASSETS_PREVIOUS)) {
      expect(existsSync(new URL(file, dataDir)), file).toBe(true);
    }
  });

  it("falls back from a stale hashed catalogue URL to the unversioned alias", () => {
    // Covers bundles older than the grace generation, and mid-rollout clients.
    expect(loaderSrc).toContain("async function fetchCatalogue");
    expect(loaderSrc).toContain("CATALOGUE_ALIASES[catalogue]");
    for (const alias of Object.values(legacyCatalogueAssets)) {
      expect(loaderSrc, alias).toContain(alias);
    }
  });

  it("caches hashed catalogue assets immutably and forces alias revalidation", () => {
    const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    expect(nextConfig).toContain(
      'source: "/therapy-compass-data/:asset(therapies(?:-index)?\\\\.[a-f0-9]{16}\\\\.json)"',
    );
    expect(nextConfig).toContain('value: "public, max-age=31536000, immutable"');
    expect(nextConfig).toContain('source: "/therapy-compass-data/:asset(therapies(?:-index)?\\\\.json)"');
    expect(nextConfig).toContain('value: "public, max-age=0, must-revalidate"');
  });

  it("keeps the browse projection available without putting it on the Therapy home paint path", () => {
    const fullSize = readFileSync(new URL(THERAPY_CATALOGUE_ASSETS.full, dataDir)).byteLength;
    const indexSize = readFileSync(new URL(THERAPY_CATALOGUE_ASSETS.index, dataDir)).byteLength;
    expect(indexSize).toBeLessThan(fullSize * 0.1);
    // The loader still selects by catalogue kind from the generated manifest —
    // the lookup moved inside fetchCatalogue when the alias fallback landed, so
    // pin both halves rather than the old single expression.
    expect(loaderSrc).toContain("fetchCatalogue(options.catalogue)");
    expect(loaderSrc).toContain("THERAPY_CATALOGUE_ASSETS[catalogue]");
    expect(bindingsSrc).toContain("enabled: !isHome");
    expect(bindingsSrc).toContain("THERAPY_CATALOGUE_SUMMARY.totalCount");
    expect(bindingsSrc).not.toContain('screen === "home" ? "home"');
    expect(bindingsSrc).toContain('screen === "pathways" ? "index"');
    expect(bindingsSrc).not.toContain('screen === "search" || screen === "pathways"');
  });

  it("generates Therapy home count and artifact defaults from the current catalogue", () => {
    const index = JSON.parse(readFileSync(new URL(THERAPY_CATALOGUE_ASSETS.index, dataDir), "utf8")) as Array<{
      slug: string;
      briefInterventionAvailable: boolean;
      patientSheetAvailable: boolean;
    }>;
    expect(THERAPY_CATALOGUE_SUMMARY.totalCount).toBe(index.length);
    expect(THERAPY_CATALOGUE_SUMMARY.defaultBriefSlug).toBe(
      index.find((therapy) => therapy.briefInterventionAvailable)?.slug,
    );
    expect(THERAPY_CATALOGUE_SUMMARY.defaultSheetSlug).toBe(
      index.find((therapy) => therapy.patientSheetAvailable)?.slug,
    );
  });

  it("uses } as const–terminated parsing for the therapy catalogue summary staleness check", () => {
    const generatorSrc = readFileSync(new URL("../scripts/build-therapies-index.mjs", import.meta.url), "utf8");
    expect(generatorSrc).toContain("function extractConstObjectBody");
    expect(generatorSrc).toContain('extractConstObjectBody(currentManifest, "THERAPY_CATALOGUE_SUMMARY")');
    // Nested `}` must not truncate the summary parse (previous `[^}]*` hole).
    expect(generatorSrc).not.toMatch(/THERAPY_CATALOGUE_SUMMARY = \\\{\[\^\}]\*\\\}/);

    const extractConstObjectBody = (source: string, name: string) =>
      source.match(new RegExp(`${name} = \\{([\\s\\S]*?)\\} as const`))?.[1] ?? "";
    const nested =
      'export const THERAPY_CATALOGUE_SUMMARY = {\n  totalCount: 1,\n  note: { nested: "}" },\n  defaultBriefSlug: "a",\n  defaultSheetSlug: "b",\n} as const;\n';
    const block = extractConstObjectBody(nested, "THERAPY_CATALOGUE_SUMMARY");
    expect(block).toContain('defaultBriefSlug: "a"');
    expect(block).toContain('defaultSheetSlug: "b"');
    expect(block.match(/defaultSheetSlug: (null|"[^"]+")/)?.[1]).toBe('"b"');
  });

  it("does not mangle ordinary sk- substrings like task-centred in generated JSON", () => {
    // Regression for the old mid-word sk- → s\u006b- rewrite in the generator.
    const text = readFileSync(new URL(THERAPY_CATALOGUE_ASSETS.index, dataDir), "utf8");
    expect(text).toContain('"slug": "task-centred-practice"');
    expect(text).not.toContain("\\u006b");
  });

  it("keeps therapy-compass route-owned when the shared composer has a submitted query", () => {
    // Otherwise /therapy-compass?q=…&run=1 renders ClinicalDashboard over TherapyCompassPage.
    expect(
      shouldRenderDashboardSearch({ hasSubmittedSearch: true, mode: "therapy-compass", pathname: "/therapy-compass" }),
    ).toBe(false);
  });

  it("honors run-enabled deep links by routing to the in-tool search instead of landing on Home", () => {
    const routeSrc = readFileSync(new URL("../src/app/(search-app)/therapy-compass/page.tsx", import.meta.url), "utf8");
    const bindingsSrc = readFileSync(
      new URL("../src/components/therapy-compass/bindings.tsx", import.meta.url),
      "utf8",
    );
    // The bare path no longer renders a home: it forwards to the shared lightweight
    // one, which resolves a submitted query onward to the dedicated search route.
    // The query survives that hop because the proxy carries it (consolidatedModeHomeTarget) and, for a request
    // that skips the proxy, the page's own backstop resolves the same helper.
    expect(routeSrc).toMatch(
      /redirect\(\s*consolidatedModeHomeTargetForSearchParams\("\/therapy-compass", params\) \?\? appModeSelectionHref\("therapy-compass"\),?\s*\)/,
    );
    expect(appModeHomeHref("therapy-compass", { query: "CBT", run: true })).toBe("/therapy-compass/search?q=CBT&run=1");
    // ...and the provider derives the active screen from the pathname and seeds the query from ?q.
    expect(bindingsSrc).toMatch(/resolveTherapyRoute\(pathname\)/);
    expect(bindingsSrc).toMatch(/searchParams\.get\("q"\)/);
  });

  it("keeps a single main landmark on the therapy home route", () => {
    const workspaceSrc = readFileSync(
      new URL("../src/components/therapy-compass/workspace.tsx", import.meta.url),
      "utf8",
    );
    // `/therapy-compass` redirects to the shared home, so workspace must not wrap
    // that path in a second <main>. Error/loading on child routes still promote.
    expect(workspaceSrc).toMatch(/asMain=\{!isHome\}/);
    expect(workspaceSrc).toContain(
      "const homeNeedsMainLandmark = Boolean(b.error) || (b.loading && b.therapies.length === 0);",
    );
    expect(workspaceSrc).toContain("const useMainLandmark = asMain || homeNeedsMainLandmark;");
    expect(workspaceSrc).toContain('const Tag = useMainLandmark ? "main" : "div"');
  });

  it("wires therapy-compass home into the shared desktop composer portal", () => {
    const shellSrc = readFileSync(
      new URL("../src/components/clinical-dashboard/global-search-shell.tsx", import.meta.url),
      "utf8",
    );
    const sharedHomeSrc = readFileSync(
      new URL("../src/components/clinical-dashboard/answer-status.tsx", import.meta.url),
      "utf8",
    );
    expect(sharedHomeSrc).toContain("desktopComposerSlotId={desktopComposerSlotId}");
    // Mode homes are pathname-gated so optimistic searchMode cannot flip hero→dock mid-nav.
    expect(shellSrc).toContain("isStandaloneModeHomePath(pathname)");
    // `/therapy-compass` redirects to the shared home, so there is no
    // therapy-owned home render for the gate to protect.
    expect(isStandaloneModeHomePath("/therapy-compass")).toBe(false);
  });

  it("keeps the results-band shelf Clear filter-only so it cannot delete the query", () => {
    // Shipped defect (PR #1555): the shelf is labelled "Filtered by" and its
    // trailing Clear was wired to `clearSearch`, which resets EMPTY_SEARCH —
    // including `query: ""`. So Clear silently deleted the search term the user
    // was reading, while the code comment beside it claimed the query was
    // deliberately excluded.
    const searchScreenSrc = readFileSync(
      new URL("../src/components/therapy-compass/screens/search-screen.tsx", import.meta.url),
      "utf8",
    );
    expect(searchScreenSrc).toContain("onClearFilters={b.clearSearchFilters}");
    expect(searchScreenSrc).not.toContain("onClearFilters={b.clearSearch}");
    // The binding must preserve the query rather than reset the whole shape.
    expect(bindingsSrc).toContain("setSearch((prev) => ({ ...EMPTY_SEARCH, query: prev.query }));");
    expect(bindingsSrc).toContain(
      "replaceWorkspace({ topics: [], briefOnly: false, sheetOnly: false, reviewedOnly: false });",
    );
    // Filter-contract adoption (docs/filter-contract.md section 6): the phone
    // sheet converged onto the shared `ResultFilterSheet`, whose `onClearAll`
    // must never touch the query either — "Therapy-compass's clear wipes the
    // search box; the shared sheet's does not" was the exact defect being
    // fixed. The sheet's own full reset is no longer wired at all; the
    // composer's "Clear search" control covers the query on every breakpoint.
    expect(searchScreenSrc).toContain("onClearAll={activeFilterCount > 0 ? b.clearSearchFilters : undefined}");
    expect(searchScreenSrc).not.toContain("onClear={b.clearSearch}");
  });

  it("keeps every filter-labelled Clear on this screen filter-only too", () => {
    // The sibling of the defect above, missed when #1555 was reviewed. That
    // Clear sat at the end of the quick-filter chip row — among Reviewed only,
    // Brief available and the topic tags — so it read as "clear these", but it
    // was wired to `clearSearch` and wiped the query with them.
    //
    // The chip row itself is gone: the desktop slot now renders the same shared
    // `ResultFilterTrigger` as the phone slot, so its bare `onClick` Clear went
    // with it. The rule it was an instance of is unchanged and is what this
    // case pins now — the shelf's Clear, which is the control that replaced it
    // on screen, and the `clearSearch` audit below.
    const searchScreenSrc = readFileSync(
      new URL("../src/components/therapy-compass/screens/search-screen.tsx", import.meta.url),
      "utf8",
    );
    expect(searchScreenSrc).toContain("onClearFilters={b.clearSearchFilters}");

    // The rule is about labels matching actions, not about a head-count of
    // `clearSearch` calls. A full reset is fine wherever the control says so —
    // the sheet's `Clear all` and the empty state's `Clear search` both do —
    // and is a defect wherever the control says "filters". Asserting a count
    // instead made a correctly-labelled `Clear search` look like a regression,
    // which is the wrong signal from a guard whose whole point is intent.
    const fullResetProps = Array.from(searchScreenSrc.matchAll(/(\w+)=\{b\.clearSearch\}/g)).map((match) => match[1]);
    // Filter-contract adoption removed the sheet's own full reset (see the
    // test above), so the only remaining `clearSearch` wiring is the empty
    // state's explicit "Clear search" escape — correctly named for what it
    // does, and the one case this guard exists to allow.
    expect(fullResetProps).toEqual(["onClearSearch"]);
    expect(
      fullResetProps.filter((prop) => !["onClear", "onClearSearch"].includes(prop)),
      "A control wired to `clearSearch` must be labelled for clearing the search. " +
        "`onClearFilters`, `onRemove` or a bare `onClick` promising to clear filters must use " +
        "`clearSearchFilters`, or it deletes the search term the reader is looking at.",
    ).toEqual([]);
  });
});
