import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { useDashboardBulkActions } from "@/components/clinical-dashboard/dashboard-bulk-actions";
import { useDashboardAnswerFeedback } from "@/components/clinical-dashboard/dashboard-answer-feedback";
import { buildTagSearchScopeFilters } from "@/components/clinical-dashboard/dashboard-tag-search";
import {
  useDashboardScrollSync,
  useDashboardSectionNavigation,
} from "@/components/clinical-dashboard/dashboard-scroll-sync";
import { useDashboardRecentQueries } from "@/components/clinical-dashboard/dashboard-recent-queries";
import { DashboardSidebarDialogs } from "@/components/clinical-dashboard/dashboard-sidebar-dialogs";
import { useDashboardDrawerOpeners } from "@/components/clinical-dashboard/dashboard-drawer-openers";
import { useDashboardClipboard } from "@/components/clinical-dashboard/dashboard-clipboard";
import { executeMasterSearchHeaderModeAction } from "@/components/clinical-dashboard/master-search-header-actions";
import { MasterSearchHeaderScopePicker } from "@/components/clinical-dashboard/master-search-header-scope-picker";
import { DEFAULT_QUERY_MODE_OPTIONS } from "@/components/clinical-dashboard/master-search-header-types";
import { ClinicalDashboard } from "@/components/ClinicalDashboard";
import { MasterSearchHeader } from "@/components/clinical-dashboard/master-search-header";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function lineCount(content: string): number {
  return content.split(/\r?\n/).length;
}

describe("monolith decomposition integrity (#H9WAQN)", () => {
  it("keeps all decomposed monolith targets well below maintainability caps", () => {
    const dashboardSource = source("src/components/ClinicalDashboard.tsx");
    const headerSource = source("src/components/clinical-dashboard/master-search-header.tsx");
    const cssSource = source("src/app/globals.css");

    const dashboardLines = lineCount(dashboardSource);
    const headerLines = lineCount(headerSource);
    const cssLines = lineCount(cssSource);

    // Hard budgets from scripts/check-maintainability-budgets.mjs
    // ClinicalDashboard: cap 3889 -> reduced to < 3700 (currently ~3543)
    expect(dashboardLines).toBeLessThan(3700);
    // master-search-header: cap 3241 -> reduced to < 3000 (currently ~2598)
    expect(headerLines).toBeLessThan(3000);
    // globals.css: cap 6700 -> reduced to < 6550 (currently ~6473)
    expect(cssLines).toBeLessThan(6550);
  });

  it("extracts CSS keyframes into globals-keyframes.css and imports them in globals.css", () => {
    const cssSource = source("src/app/globals.css");
    expect(cssSource).toContain('@import "../styles/globals-keyframes.css";');

    const keyframesPath = resolve(process.cwd(), "src/styles/globals-keyframes.css");
    expect(existsSync(keyframesPath)).toBe(true);
    const keyframesSource = readFileSync(keyframesPath, "utf8");

    const requiredKeyframes = [
      "@keyframes fade-up",
      "@keyframes overlay-in",
      "@keyframes sheet-up",
      "@keyframes sheet-left",
      "@keyframes pop-in",
      "@keyframes dialog-rise",
      "@keyframes action-tray-in",
      "@keyframes mode-action-fold-up",
      "@keyframes mode-action-fold-down",
      "@keyframes shimmer",
    ];

    for (const kf of requiredKeyframes) {
      expect(keyframesSource).toContain(kf);
    }
  });

  it("exports all extracted master search header helper modules and preserves re-exports", () => {
    expect(typeof executeMasterSearchHeaderModeAction).toBe("function");
    expect(typeof MasterSearchHeaderScopePicker).toBe("function");
    expect(Array.isArray(DEFAULT_QUERY_MODE_OPTIONS)).toBe(true);
    expect(typeof MasterSearchHeader).toBe("function");

    const headerSource = source("src/components/clinical-dashboard/master-search-header.tsx");
    expect(headerSource).toContain('export * from "./master-search-header-types";');
    expect(headerSource).toContain("<MasterSearchHeaderScopePicker");
    expect(headerSource).toContain("appModeHasWorkSearch(selectedAppMode.id)");
  });

  it("exports all extracted dashboard helper modules and preserves dashboard contracts", () => {
    expect(typeof useDashboardBulkActions).toBe("function");
    expect(typeof useDashboardAnswerFeedback).toBe("function");
    expect(typeof buildTagSearchScopeFilters).toBe("function");
    expect(typeof useDashboardScrollSync).toBe("function");
    expect(typeof useDashboardSectionNavigation).toBe("function");
    expect(typeof useDashboardRecentQueries).toBe("function");
    expect(typeof DashboardSidebarDialogs).toBe("function");
    expect(typeof useDashboardDrawerOpeners).toBe("function");
    expect(typeof useDashboardClipboard).toBe("function");
    expect(typeof ClinicalDashboard).toBe("function");

    const dashboardSource = source("src/components/ClinicalDashboard.tsx");
    // Verify core static assertions
    expect(dashboardSource).toContain("phone-viewport-shell");
    expect(dashboardSource).toContain("useDashboardChromeCoordinator(searchMode)");
    expect(dashboardSource).toContain("{settingsState.indexingAdminDrawerOpen && canUseAdministrativeApis ? (");
    expect(dashboardSource).toContain(
      "const { modeSearchSubmitted, submittedModeQuery, setModeSearchSubmitted } = useSubmittedModeSearch({",
    );
    expect(dashboardSource).toContain("function selectSearchMode(");
  });

  it("correctly calculates tag search filter updates in buildTagSearchScopeFilters", () => {
    const initialFilters = { sites: ["old-site"] };
    const { searchText, nextFilters } = buildTagSearchScopeFilters(initialFilters, {
      key: "med-1",
      label: "Lithium",
      searchText: "Lithium carbonate",
      group: "Medication",
      count: 5,
    });

    expect(searchText).toBe("Lithium carbonate");
    expect(nextFilters.medications).toEqual(["Lithium carbonate"]);
    expect(nextFilters.sites).toEqual(["old-site"]);
  });
});
