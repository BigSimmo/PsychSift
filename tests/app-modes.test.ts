import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  appModeDefinitions,
  appModeIds,
  appModeCanUseSourceLibraryShortcut,
  appModeHomeHref,
  appModeSelectionHref,
  appModeQueryMode,
  appModeSearchConfig,
  appModeSourceLibrarySearchMode,
  canAccessFavouritesMode,
  filterCrossModesForSession,
  isAppModeId,
  isAppModeVisible,
  isSearchableAppMode,
  visibleAppModeDefinitions,
  visibleAppModeDefinitionsForSession,
} from "@/lib/app-modes";
import { universalSearchModeForDomain, universalSearchPreferredDomains } from "@/lib/universal-search-mode-context";

describe("app mode search contract", () => {
  it("maps every mode to its preferred universal-search domains", () => {
    expect(universalSearchPreferredDomains("answer")).toEqual(["documents"]);
    expect(universalSearchPreferredDomains("prescribing")).toEqual(["medications", "documents"]);
    expect(universalSearchPreferredDomains("differentials")).toEqual(["differentials", "presentations"]);
    expect(universalSearchPreferredDomains("specifiers")).toEqual(["specifiers"]);
    expect(universalSearchPreferredDomains("formulation")).toEqual(["formulation"]);
    expect(universalSearchPreferredDomains("therapy-compass")).toEqual(["therapies"]);
    expect(universalSearchModeForDomain("specifiers")).toBe("specifiers");
    expect(universalSearchModeForDomain("formulation")).toBe("formulation");
    expect(universalSearchModeForDomain("therapies")).toBe("therapy-compass");
    expect(universalSearchPreferredDomains("favourites")).toEqual([]);
    expect(universalSearchPreferredDomains("factsheets")).toEqual([]);
    expect(universalSearchPreferredDomains("calculators")).toEqual([]);
    expect(universalSearchPreferredDomains("sources")).toEqual([]);
  });

  it("requires every mode to declare its search behavior and copy", () => {
    const ids = new Set<string>();

    for (const mode of appModeDefinitions) {
      expect(ids.has(mode.id)).toBe(false);
      ids.add(mode.id);

      expect(mode.label).toBeTruthy();
      expect(mode.description).toBeTruthy();
      expect(mode.search.placeholder).toBeTruthy();
      expect(mode.search.inputAriaLabel).toBeTruthy();
      expect(mode.search.submitIdleLabel).toBeTruthy();
      expect(mode.search.submitBusyLabel).toBeTruthy();
      expect(mode.search.submitAriaLabel).toBeTruthy();
      expect(mode.search.emptyTitle).toBeTruthy();
      expect(mode.search.readyTitle).toBeTruthy();
      expect(mode.search.progressLabel).toBeTruthy();
      expect(mode.search.resultHeading).toBeTruthy();
    }
  });

  it("keeps every declared mode searchable through the dashboard composer", () => {
    for (const mode of appModeDefinitions) {
      expect(isSearchableAppMode(mode.id)).toBe(true);
    }
  });

  it("rejects unknown ids from isSearchableAppMode exactly as isAppModeId does", () => {
    for (const candidate of ["", "not-a-mode", "ANSWER", "answer ", ...appModeIds]) {
      expect(isSearchableAppMode(candidate), candidate).toBe(isAppModeId(candidate));
    }
    expect(isSearchableAppMode("not-a-mode")).toBe(false);
  });

  it("does not re-enumerate every search kind inside isSearchableAppMode", () => {
    // SearchableAppModeId is AppModeId, so a list naming every AppModeSearchKind can never
    // return false for a defined mode; it only looks like a distinction. The predicate
    // must delegate to isAppModeId rather than carry that list.
    const source = readFileSync(path.join(process.cwd(), "src/lib/app-modes.ts"), "utf8");
    const body = /export function isSearchableAppMode[\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(body).not.toBe("");
    expect(body).not.toMatch(/kind === "/);
    expect(body).toContain("isAppModeId(");
  });

  it("routes medication mode through document search with a medication-oriented query mode", () => {
    expect(isSearchableAppMode("prescribing")).toBe(true);
    expect(appModeSearchConfig("prescribing").kind).toBe("documents");
    expect(appModeQueryMode("prescribing", "auto")).toBe("dose_threshold_lookup");
    expect(appModeQueryMode("prescribing", "monitoring_schedule")).toBe("monitoring_schedule");
  });

  it("keeps tools searchable inside the dashboard composer", () => {
    const config = appModeSearchConfig("tools");

    expect(isSearchableAppMode("tools")).toBe(true);
    expect(config.kind).toBe("tools");
    expect(config.resultKind).toBe("tools");
    expect(config.placeholder.toLowerCase()).toContain("tools");
  });

  it("keeps calculators local and searchable as a first-class mode", () => {
    const config = appModeSearchConfig("calculators");
    const mode = appModeDefinitions.find((definition) => definition.id === "calculators");

    expect(isSearchableAppMode("calculators")).toBe(true);
    expect(mode?.href).toBe("/calculators");
    expect(config.kind).toBe("calculators");
    expect(config.resultKind).toBe("calculators");
    expect(config.resultsSurface).toBe("results-band");
  });

  it("keeps services searchable through the shared dashboard composer", () => {
    const config = appModeSearchConfig("services");
    const mode = appModeDefinitions.find((definition) => definition.id === "services");

    expect(isSearchableAppMode("services")).toBe(true);
    expect(mode?.label).toBe("Services");
    expect(config.kind).toBe("services");
    expect(config.resultKind).toBe("services");
    expect(config.placeholder.toLowerCase()).toContain("services");
  });

  it("keeps forms searchable as a first-class mode", () => {
    const config = appModeSearchConfig("forms");
    const mode = appModeDefinitions.find((definition) => definition.id === "forms");

    expect(isSearchableAppMode("forms")).toBe(true);
    expect(mode?.label).toBe("Forms");
    expect(mode?.href).toBe("/forms");
    // Forms are a registry catalogue with their own honest kind — no longer masquerading
    // as corpus documents (which forced downstream special-casing).
    expect(config.kind).toBe("forms");
    expect(config.resultKind).toBe("forms");
    expect(config.placeholder.toLowerCase()).toContain("forms");
  });

  it("keeps favourites searchable as a standalone saved-items mode", () => {
    const config = appModeSearchConfig("favourites");
    const mode = appModeDefinitions.find((definition) => definition.id === "favourites");

    expect(isSearchableAppMode("favourites")).toBe(true);
    expect(mode?.label).toBe("Favourites");
    expect(mode?.href).toBe("/favourites");
    expect(config.kind).toBe("favourites");
    expect(config.resultKind).toBe("favourites");
    expect(config.placeholder.toLowerCase()).toContain("favourites");
  });

  it("keeps differentials searchable as a standalone source-library mode", () => {
    const config = appModeSearchConfig("differentials");

    expect(isSearchableAppMode("differentials")).toBe(true);
    expect(config.kind).toBe("differentials");
    expect(config.resultKind).toBe("differentials");
    expect(config.placeholder.toLowerCase()).toContain("presentation");
    expect(appModeQueryMode("differentials", "auto")).toBe("compare_guidance");
  });

  it("keeps formulation searchable as a standalone local decision-support mode", () => {
    const config = appModeSearchConfig("formulation");
    const mode = appModeDefinitions.find((definition) => definition.id === "formulation");

    expect(isSearchableAppMode("formulation")).toBe(true);
    expect(mode?.href).toBe("/formulation");
    expect(config.kind).toBe("formulation");
    expect(config.resultKind).toBe("formulation");
    expect(config.placeholder.toLowerCase()).toContain("pattern");
  });

  it("keeps specifiers separate from formulation as diagnostic wording support", () => {
    const config = appModeSearchConfig("specifiers");
    const mode = appModeDefinitions.find((definition) => definition.id === "specifiers");

    expect(isSearchableAppMode("specifiers")).toBe(true);
    expect(mode?.href).toBe("/specifiers");
    expect(config.kind).toBe("specifiers");
    expect(config.resultKind).toBe("specifiers");
    expect(config.placeholder.toLowerCase()).toContain("specifier");
    expect(appModeHomeHref("specifiers")).not.toBe(appModeHomeHref("formulation"));
  });

  it("routes DSM searches to the dedicated local catalogue", () => {
    const config = appModeSearchConfig("dsm");

    expect(isSearchableAppMode("dsm")).toBe(true);
    expect(config.kind).toBe("dsm");
    expect(config.resultKind).toBe("dsm");
    expect(appModeHomeHref("dsm")).toBe("/?mode=dsm");
    expect(appModeHomeHref("dsm", { query: "  bipolar II  ", run: true, focus: true })).toBe(
      "/dsm/search?q=bipolar+II&focus=1&run=1",
    );
  });

  it("routes factsheets searches to the dedicated patient-information library", () => {
    const config = appModeSearchConfig("factsheets");
    const mode = appModeDefinitions.find((definition) => definition.id === "factsheets");

    expect(isSearchableAppMode("factsheets")).toBe(true);
    expect(mode?.label).toBe("Factsheets");
    expect(mode?.href).toBe("/factsheets");
    // Borrows the benign "tools" kind (like Therapy Compass) while keeping the shared composer.
    expect(config.kind).toBe("tools");
    expect(config.resultKind).toBe("tools");
    expect(appModeHomeHref("factsheets")).toBe("/?mode=factsheets");
    expect(appModeHomeHref("factsheets", { query: "  sertraline  ", run: true, focus: true })).toBe(
      "/factsheets/search?q=sertraline&focus=1&run=1",
    );
  });

  it("routes Therapy searches as a first-class local catalogue", () => {
    const config = appModeSearchConfig("therapy-compass");
    expect(isSearchableAppMode("therapy-compass")).toBe(true);
    expect(config.kind).toBe("therapies");
    expect(config.resultKind).toBe("therapies");
    expect(appModeHomeHref("therapy-compass", { query: "CBT", run: true })).toBe("/therapy-compass/search?q=CBT&run=1");
  });

  it("routes Sources searches to the read-only catalogue", () => {
    const config = appModeSearchConfig("sources");
    const mode = appModeDefinitions.find((definition) => definition.id === "sources");

    expect(appModeIds).toHaveLength(26);
    expect(mode).toMatchObject({
      label: "Sources",
      description: "Ranked clinical source catalogue and traceability",
      href: "/sources",
    });
    expect(config).toMatchObject({
      kind: "tools",
      placeholder: "Search sources, publishers, or topics...",
      resultHeading: "Sources",
      nextStep: "Filter by quality, location, publisher, topic, or usage",
    });
    expect(appModeHomeHref("sources", { query: "RANZCP", run: true })).toBe("/sources/search?q=RANZCP&run=1");
  });

  it("keeps source-library shortcut searches in their active mode family", () => {
    expect(appModeCanUseSourceLibraryShortcut("answer")).toBe(false);
    expect(appModeCanUseSourceLibraryShortcut("tools")).toBe(false);
    expect(appModeCanUseSourceLibraryShortcut("documents")).toBe(true);
    expect(appModeCanUseSourceLibraryShortcut("services")).toBe(false);
    // Forms is a registry catalogue: a scope-tag shortcut falls back to documents mode
    // instead of dead-ending in the forms registry branch.
    expect(appModeCanUseSourceLibraryShortcut("forms")).toBe(false);
    expect(appModeCanUseSourceLibraryShortcut("favourites")).toBe(false);
    expect(appModeCanUseSourceLibraryShortcut("prescribing")).toBe(true);
    expect(appModeCanUseSourceLibraryShortcut("differentials")).toBe(true);
    expect(appModeCanUseSourceLibraryShortcut("specifiers")).toBe(false);
    expect(appModeCanUseSourceLibraryShortcut("formulation")).toBe(false);

    expect(appModeSourceLibrarySearchMode("documents")).toBe("documents");
    expect(appModeSourceLibrarySearchMode("services")).toBe("documents");
    expect(appModeSourceLibrarySearchMode("forms")).toBe("documents");
    expect(appModeSourceLibrarySearchMode("prescribing")).toBe("documents");
    expect(appModeSourceLibrarySearchMode("differentials")).toBe("differentials");
  });

  it("builds stable dashboard home URLs for shared global search chrome", () => {
    expect(appModeHomeHref("answer")).toBe("/?mode=answer");
    expect(appModeHomeHref("documents", { query: "lithium monitoring", run: true, focus: true })).toBe(
      "/documents/search?mode=documents&q=lithium+monitoring&focus=1&run=1",
    );
    expect(appModeHomeHref("services")).toBe("/?mode=services");
    expect(appModeHomeHref("services", { focus: true })).toBe("/?mode=services&focus=1");
    expect(appModeHomeHref("services", { query: "  13YARN  ", run: true, focus: true })).toBe(
      "/services/search?q=13YARN&focus=1&run=1",
    );
    expect(appModeHomeHref("forms")).toBe("/?mode=forms");
    expect(appModeHomeHref("forms", { focus: true })).toBe("/?mode=forms&focus=1");
    expect(appModeHomeHref("forms", { query: "  transport forms  ", run: true, focus: true })).toBe(
      "/forms/search?q=transport+forms&focus=1&run=1",
    );
    expect(appModeHomeHref("favourites")).toBe("/favourites");
    expect(appModeHomeHref("favourites", { query: "  clozapine set  ", run: true, focus: true })).toBe(
      "/favourites?q=clozapine+set&focus=1&run=1",
    );
    expect(appModeHomeHref("differentials", { query: "  acute confusion  ", focus: true })).toBe(
      "/differentials/search?q=acute+confusion&focus=1",
    );
    expect(appModeHomeHref("specifiers", { query: "  depressed but racing thoughts  ", run: true, focus: true })).toBe(
      "/specifiers/search?q=depressed+but+racing+thoughts&focus=1&run=1",
    );
    expect(appModeHomeHref("formulation", { query: "  I keep going over it  ", run: true, focus: true })).toBe(
      "/formulation/search?q=I+keep+going+over+it&focus=1&run=1",
    );
    expect(appModeHomeHref("specifiers", { query: "  racing thoughts  ", run: true, focus: true })).toBe(
      "/specifiers/search?q=racing+thoughts&focus=1&run=1",
    );
    expect(appModeHomeHref("prescribing", { query: "  acamprosate renal dose  " })).toBe(
      "/?mode=prescribing&q=acamprosate+renal+dose",
    );
    expect(appModeHomeHref("prescribing", { query: "  acamprosate renal dose  ", run: true })).toBe(
      "/?mode=prescribing&q=acamprosate+renal+dose&run=1",
    );
    expect(appModeHomeHref("tools", { query: "  medications  ", run: true, focus: true })).toBe(
      "/tools?q=medications&focus=1&run=1",
    );
    expect(appModeHomeHref("calculators", { query: "  PHQ-9  ", run: true, focus: true })).toBe(
      "/calculators/search?q=PHQ-9&focus=1&run=1",
    );
  });

  it("keeps active search context while routing from the shared composer", () => {
    const href = new URL(
      appModeHomeHref("answer", {
        query: "clozapine monitoring",
        run: true,
        queryMode: "monitoring_schedule",
        scopeFilters: { medications: ["clozapine"], sourceStatuses: ["current"] },
      }),
      "https://clinical.test",
    );

    expect(href.searchParams.get("queryMode")).toBe("monitoring_schedule");
    expect(href.searchParams.getAll("scope.medications")).toEqual(["clozapine"]);
    expect(href.searchParams.getAll("scope.sourceStatuses")).toEqual(["current"]);
  });

  it("keeps active production modes and excludes removed prototype modes from app routing", () => {
    expect(isAppModeId("profile")).toBe(false);
    expect(appModeDefinitions.map((mode) => mode.id)).not.toContain("profile");
    expect(appModeDefinitions.map((mode) => mode.id)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(visibleAppModeDefinitions("development").map((mode) => mode.id)).not.toContain("profile");
  });

  it("keeps production navigation modes visible while removed prototypes stay hidden", () => {
    const developmentModes = visibleAppModeDefinitions("development").map((mode) => mode.id);
    const productionModes = visibleAppModeDefinitions("production").map((mode) => mode.id);

    expect(isAppModeVisible("evidence", "production")).toBe(false);
    expect(isAppModeVisible("services", "production")).toBe(true);
    expect(isAppModeVisible("forms", "production")).toBe(true);
    expect(isAppModeVisible("favourites", "production")).toBe(true);
    expect(isAppModeVisible("differentials", "production")).toBe(true);
    expect(isAppModeVisible("dsm", "production")).toBe(true);
    expect(isAppModeVisible("specifiers", "production")).toBe(true);
    expect(isAppModeVisible("formulation", "production")).toBe(true);
    expect(isAppModeVisible("prescribing", "production")).toBe(true);
    expect(isAppModeVisible("tools", "production")).toBe(true);
    expect(isAppModeVisible("calculators", "production")).toBe(true);
    expect(isAppModeVisible("therapy-compass", "production")).toBe(true);
    expect(isAppModeVisible("factsheets", "production")).toBe(true);
    expect(productionModes).not.toContain("evidence");
    expect(productionModes).toContain("services");
    expect(productionModes).toContain("forms");
    expect(productionModes).toContain("favourites");
    expect(productionModes).toContain("differentials");
    expect(productionModes).toContain("dsm");
    expect(productionModes).toContain("specifiers");
    expect(productionModes).toContain("formulation");
    expect(productionModes).toContain("prescribing");
    expect(productionModes).toContain("tools");
    expect(productionModes).toContain("calculators");
    expect(productionModes).toContain("therapy-compass");
    expect(productionModes).toContain("factsheets");
    expect(developmentModes).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(developmentModes).not.toContain("evidence");
  });

  // Therapy was `devOnly` while its catalogue awaited clinician sign-off, which
  // hid the mode and 404'd all 205 records for real users. The owner's decision
  // is to ship it with its review state disclosed instead, so production and
  // development must now agree — a re-added `devOnly: true` fails here.
  it("keeps Therapy reachable in production with its review state disclosed, not hidden", () => {
    expect(isAppModeId("therapy-compass")).toBe(true);
    expect(isAppModeVisible("therapy-compass", "development")).toBe(true);
    expect(isAppModeVisible("therapy-compass", "production")).toBe(true);
    expect(visibleAppModeDefinitions("development").map((mode) => mode.id)).toContain("therapy-compass");
    expect(visibleAppModeDefinitions("production").map((mode) => mode.id)).toContain("therapy-compass");
  });

  it("gates Favourites mode to authenticated or demo sessions", () => {
    expect(canAccessFavouritesMode({ authenticated: false, demoMode: false })).toBe(false);
    expect(canAccessFavouritesMode({ authenticated: true, demoMode: false })).toBe(true);
    expect(canAccessFavouritesMode({ authenticated: false, demoMode: true })).toBe(true);
    expect(canAccessFavouritesMode({ authenticated: true, demoMode: true })).toBe(true);

    expect(
      visibleAppModeDefinitionsForSession({ authenticated: false, demoMode: false }).map((mode) => mode.id),
    ).not.toContain("favourites");
    expect(
      visibleAppModeDefinitionsForSession({ authenticated: true, demoMode: false }).map((mode) => mode.id),
    ).toContain("favourites");
    expect(
      visibleAppModeDefinitionsForSession({ authenticated: false, demoMode: true }).map((mode) => mode.id),
    ).toContain("favourites");

    expect(
      filterCrossModesForSession(["documents", "favourites", "forms"], {
        authenticated: false,
        demoMode: false,
      }),
    ).toEqual(["documents", "forms"]);
    expect(
      filterCrossModesForSession(["documents", "favourites", "forms"], {
        authenticated: true,
        demoMode: false,
      }),
    ).toEqual(["documents", "favourites", "forms"]);
  });

  // `/` is the single home page: the mode pill retargets the composer instead of
  // navigating, so submitting is the only thing that leaves home. This table is the
  // contract for where each mode lands — the whole feature in one assertion.
  it("routes a submitted shared-composer search to each mode's own search surface", () => {
    const submitted = Object.fromEntries(
      appModeIds.map((mode) => [mode, appModeHomeHref(mode, { query: "clozapine", run: true })]),
    );

    expect(submitted).toEqual({
      // Dashboard-owned: these stay on `/` and render results in place.
      answer: "/?mode=answer&q=clozapine&run=1",
      prescribing: "/?mode=prescribing&q=clozapine&run=1",
      // Dedicated search routes.
      documents: "/documents/search?mode=documents&q=clozapine&run=1",
      dsm: "/dsm/search?q=clozapine&run=1",
      factsheets: "/factsheets/search?q=clozapine&run=1",
      dictionary: "/dictionary/search?q=clozapine&run=1",
      services: "/services/search?q=clozapine&run=1",
      forms: "/forms/search?q=clozapine&run=1",
      differentials: "/differentials/search?q=clozapine&run=1",
      specifiers: "/specifiers/search?q=clozapine&run=1",
      formulation: "/formulation/search?q=clozapine&run=1",
      "therapy-compass": "/therapy-compass/search?q=clozapine&run=1",
      calculators: "/calculators/search?q=clozapine&run=1",
      sources: "/sources/search?q=clozapine&run=1",
      // Same route, submitted branch: these still own a home of their own.
      favourites: "/favourites?q=clozapine&run=1",
      // Tools has no search route by design: it filters its launcher in place.
      tools: "/tools?q=clozapine&run=1",
      // On Call has no search route and no composer either — `resultsSurface`
      // is "none". The href is here for completeness rather than as a journey:
      // the mode pill navigates to `/on-call` through `standaloneModeHomeHref`
      // long before a query can be typed against this mode, so nothing in the
      // app submits one. The dashboard ignores `q`, which is the honest
      // behaviour for a mode with nothing to search.
      "on-call": "/on-call?q=clozapine&run=1",
      // CME, for exactly On Call's reason: no search route, no composer,
      // `resultsSurface` is "none", and `standaloneModeHomeHref` navigates the
      // mode pill to `/cme` before a query against this mode can be typed. The
      // dashboard ignores `q`.
      cme: "/cme?q=clozapine&run=1",
      // Psychiatry, for the same reason: a dashboard of section links with no
      // search route, reached through `standaloneModeHomeHref`.
      psychiatry: "/psychiatry?q=clozapine&run=1",
      // Admin, likewise: Today has no search route.
      "my-work": "/admin/renewals?q=clozapine&run=1",
      // Roster, for On Call's and CME's reason exactly: no search route, no
      // composer, `resultsSurface` is "none", and `standaloneModeHomeHref`
      // navigates the mode pill to `/roster` before a query can be typed.
      roster: "/roster?q=clozapine&run=1",
      // First Nations, likewise: every page keeps its own in-page search box and
      // there is no search route.
      "first-nations": "/first-nations?q=clozapine&run=1",
      // Teaching, likewise: a dashboard with no search route.
      teaching: "/teaching?q=clozapine&run=1",
      // My Day, likewise: one merged list with no search route.
      "my-day": "/my-day?q=clozapine&run=1",
      // Medicines & tools, like Psychiatry: a dashboard with no search route.
      medicines: "/medicines?q=clozapine&run=1",
      // Open shifts, Roster's reason exactly: no search route, no composer.
      "open-shifts": "/open-shifts?q=clozapine&run=1",
    });
  });

  it("keeps mode selection on the shared home instead of opening a mode home", () => {
    // Selecting a mode rewrites this in place (replaceState) — it never pushes a
    // route, so every mode's selection href must stay on `/`.
    for (const mode of appModeIds) {
      expect(appModeSelectionHref(mode)).toBe(`/?mode=${encodeURIComponent(mode)}`);
    }
    // Search context still rides along so a pick does not silently drop filters.
    expect(appModeSelectionHref("dsm", { queryMode: "compare_guidance" })).toBe(
      "/?mode=dsm&queryMode=compare_guidance",
    );
  });
});
