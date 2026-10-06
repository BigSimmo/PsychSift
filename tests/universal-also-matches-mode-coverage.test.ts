import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { appModeDefinition, appModeIds, type AppModeId } from "../src/lib/app-modes";

/**
 * Every mode's submitted-search surface carries the cross-mode panel.
 *
 * This exists because the mount is the part that goes missing. The panel is a
 * single component threaded through seventeen independently owned result
 * surfaces, so a mode gains one by someone remembering to add a line — and a
 * merge resolution has already silently dropped one before (the Forms mount,
 * recorded in the merge-loss audit for #1804). Nothing failed when it went: the
 * component still compiled, its own tests still passed, and Forms simply stopped
 * offering the reader anywhere else to look.
 *
 * The map below is the register. A mode either names the file that mounts the
 * panel, or names the surface that answers the same question differently and
 * says why.
 *
 * There is one further state, and it is derived rather than declared: a mode
 * whose `resultsSurface` is `"none"` has no submitted-search surface for the
 * panel to sit on. That is read off the mode registry below, not asserted by
 * hand, so a mode cannot claim the exemption without the type system agreeing
 * that it presents no result list.
 */
/**
 * The reason string for a mode with no results surface. Shared so the exemption
 * reads identically wherever it applies, and long enough to satisfy the
 * exemption-must-carry-a-reason assertion below.
 */
const NO_RESULTS_SURFACE =
  'This mode declares resultsSurface: "none" — it has no composer on any route and no results page, so ' +
  "there is no submitted-search surface for the cross-mode panel to sit on. Cross-mode discovery reaches it " +
  "the same way every other mode is reached from here: the universal search tray and the mode switcher. " +
  "Putting the panel on its dashboard would answer a question the reader never asked there.";

const MOUNTS: Record<AppModeId, { file: string; mounts: true } | { file: string; mounts: false; because: string }> = {
  answer: {
    file: "src/components/clinical-dashboard/answer-result-surface.tsx",
    mounts: false,
    because:
      "Answer carries its cross-mode links on the answer surface's own library line (CrossModeLinksSection), " +
      "inside the answer thread rather than below the whole result region. Both rendered for a while, one " +
      "directly under the other, asking the same question — the duplication the owner photographed on " +
      "2026-08-26. tests/ui-universal-search.spec.ts pins the panel OUT of Answer. The line is not the " +
      "narrower surface it once was: since the universalMode opt-in it runs the same /api/search/universal " +
      "lookup the tray runs, so DSM, Formulation, Specifiers, Therapy, Dictionary and Tools are reachable " +
      "from an answer too, on top of the four catalogues resolved in the browser.",
  },
  documents: { file: "src/components/ClinicalDashboard.tsx", mounts: true },
  services: { file: "src/components/services/services-navigator-page.tsx", mounts: true },
  forms: { file: "src/components/forms/forms-search-results-page.tsx", mounts: true },
  favourites: { file: "src/components/clinical-dashboard/favourites-command-library-page.tsx", mounts: true },
  differentials: { file: "src/components/clinical-dashboard/differentials-home.tsx", mounts: true },
  dsm: { file: "src/components/dsm/dsm-search-page.tsx", mounts: true },
  specifiers: { file: "src/components/specifiers/specifiers-home-page.tsx", mounts: true },
  formulation: { file: "src/components/formulation/formulation-home-page.tsx", mounts: true },
  prescribing: { file: "src/components/clinical-dashboard/medication-prescribing-workspace.tsx", mounts: true },
  tools: { file: "src/components/tools/tools-search-results-page.tsx", mounts: true },
  calculators: { file: "src/components/calculators/search-page.tsx", mounts: true },
  "therapy-compass": { file: "src/components/therapy-compass/screens/search-screen.tsx", mounts: true },
  factsheets: { file: "src/components/factsheets/factsheets-search-page.tsx", mounts: true },
  dictionary: { file: "src/components/dictionary/dictionary-catalogue-pages.tsx", mounts: true },
  sources: { file: "src/components/sources/sources-catalogue-client.tsx", mounts: true },
  // On Call presents no result list at all (`resultsSurface: "none"`), so the
  // loop below skips it before either branch. The file named here is its home,
  // which is what the reader actually lands on; the assertion that it mounts
  // nothing lives in its own test.
  "on-call": { file: "src/components/on-call/on-call-home.tsx", mounts: false, because: NO_RESULTS_SURFACE },
  // CME, for On Call's reason exactly. The file named here is the dashboard the
  // reader actually lands on at `/cme`.
  cme: { file: "src/components/cme/cme-dashboard.tsx", mounts: false, because: NO_RESULTS_SURFACE },
  // Teaching, for On Call's reason exactly. The file named here is the
  // dashboard the reader lands on at `/teaching`.
  teaching: { file: "src/components/teaching/teaching-today.tsx", mounts: false, because: NO_RESULTS_SURFACE },
  // Psychiatry, for the same reason: its home is a dashboard of links.
  psychiatry: { file: "src/components/psychiatry/psychiatry-home.tsx", mounts: false, because: NO_RESULTS_SURFACE },
  medicines: { file: "src/components/medicines/medicines-home.tsx", mounts: false, because: NO_RESULTS_SURFACE },
  // Admin (mode id `my-work`), likewise: Today is a dashboard of what is due and links.
  "my-work": { file: "src/components/admin/admin-today-page.tsx", mounts: false, because: NO_RESULTS_SURFACE },
  // Roster, for On Call's reason exactly: no result list, resultsSurface "none".
  // The file named here is Today, the dashboard the reader lands on at `/roster`.
  roster: { file: "src/components/roster/roster-today-page.tsx", mounts: false, because: NO_RESULTS_SURFACE },
  // First Nations, likewise: every page keeps its own in-page search box and
  // renders through one page renderer.
  "first-nations": {
    file: "src/components/first-nations/page-renderer.tsx",
    mounts: false,
    because: NO_RESULTS_SURFACE,
  }, // My Day, likewise: one merged list with no result list of its own.
  "my-day": { file: "src/components/my-day/my-day-page.tsx", mounts: false, because: NO_RESULTS_SURFACE },
  // The file named here is Browse, the list the reader lands on at `/open-shifts`.
  "open-shifts": {
    file: "src/components/open-shifts/open-shifts-browse-page.tsx",
    mounts: false,
    because: NO_RESULTS_SURFACE,
  },
};

function hasNoResultsSurface(modeId: AppModeId) {
  return appModeDefinition(modeId).search.resultsSurface === "none";
}

function read(file: string) {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

describe("cross-mode also-matches coverage", () => {
  it("registers every app mode", () => {
    expect(Object.keys(MOUNTS).sort()).toEqual([...appModeIds].sort());
  });

  for (const modeId of appModeIds) {
    const entry = MOUNTS[modeId];

    if (hasNoResultsSurface(modeId)) {
      it(`records that ${modeId} has no result surface for the panel to sit on`, () => {
        expect(entry.mounts, `${modeId} declares no results surface, so it must not claim to mount the panel`).toBe(
          false,
        );
        expect(read(entry.file)).not.toContain("UniversalSearchAlsoMatches");
      });
      continue;
    }

    if (entry.mounts) {
      it(`mounts the cross-mode panel on ${modeId}`, () => {
        const source = read(entry.file);
        expect(source, `${entry.file} must import UniversalSearchAlsoMatches`).toContain(
          'from "@/components/clinical-dashboard/universal-search-also-matches"',
        );
        expect(source, `${entry.file} must render <UniversalSearchAlsoMatches modeId="${modeId}" …>`).toMatch(
          new RegExp(`<UniversalSearchAlsoMatches[\\s\\S]{0,200}?modeId=(?:"${modeId}"|\\{searchMode\\})`),
        );
      });
      continue;
    }

    it(`records why ${modeId} answers cross-mode discovery elsewhere`, () => {
      expect(entry.because.length, "an exemption must carry its reason").toBeGreaterThan(80);
      expect(read(entry.file)).toContain("CrossModeLinksSection");
    });

    it(`keeps ${modeId}'s own line reaching the modes no catalogue can resolve`, () => {
      // The exemption above is only honest while the line actually reaches the
      // other modes. Without this opt-in it falls back to four client-side
      // catalogues, and an answer can never point at a DSM diagnosis, a
      // dictionary term, a formulation, a specifier, a therapy or a tool —
      // which is the coverage gap the exemption now claims is closed.
      expect(read(entry.file), `${entry.file} must pass universalMode to CrossModeLinksSection`).toMatch(
        /<CrossModeLinksSection[\s\S]{0,400}?universalMode=/,
      );
    });
  }

  it("lets exactly one owner mount the panel for a mode that borrows a result kind", () => {
    // `resultKind` is shared: prescribing declares "documents", and factsheets,
    // dictionary, sources and on-call all declare "tools". ClinicalDashboard gates
    // its own mount on the result KIND, so any mode whose results render inside the
    // dashboard AND whose own component mounts the panel gets two of them.
    // Prescribing is that mode — `/?mode=prescribing` renders
    // MedicationPrescribingWorkspace inside the dashboard — and it shipped two
    // panels until ui-stress caught the count at 2.
    // Visibility gate lives in dashboard-mode-surface (extracted from ClinicalDashboard).
    const dashboard = read("src/components/clinical-dashboard/dashboard-mode-surface.ts");
    const gate = dashboard.slice(
      dashboard.indexOf("const showUniversalAlsoMatches ="),
      dashboard.indexOf("const showDesktopHomeComposer ="),
    );
    expect(gate.length, "the also-matches visibility gate must be findable").toBeGreaterThan(0);
    expect(gate, "ClinicalDashboard must not mount a second panel for prescribing").toContain(
      'searchMode !== "prescribing"',
    );

    // The sibling tools-kind borrowers stay on the shared home rather than rendering
    // their results inside the dashboard, so they need no exclusion here. If one of
    // them ever gains an in-dashboard results branch, this list is where to notice.
    for (const modeId of ["factsheets", "dictionary", "sources", "on-call", "cme", "roster"] as const) {
      expect(gate, `${modeId} is not expected to need a dashboard exclusion yet`).not.toContain(
        `searchMode !== "${modeId}"`,
      );
    }
  });

  it("keeps the panel free of a per-mode suppression list", () => {
    // The panel suppressed itself for `prescribing` while it was mounted ABOVE
    // the medication results. The mount moved below them; the suppression is
    // gone with it. A mode that genuinely should not show cross-mode matches
    // belongs in MOUNTS above with a reason, not in a hidden early return.
    const panel = read("src/components/clinical-dashboard/universal-search-also-matches.tsx");
    expect(panel).not.toMatch(/modeId === "(?!answer)[a-z-]+"\s*\|\|\s*!submissionActive/);
  });
});
