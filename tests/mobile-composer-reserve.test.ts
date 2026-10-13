import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isDocumentViewerOwnedRoute,
  isPageOwnedComposerRoute,
  mobileComposerDifferentialsCompareReserve,
  mobileComposerHiddenReserve,
  mobileComposerHiddenReserveRem,
  mobileComposerIdleReserve,
  mobileComposerVisibleReserve,
  resolveDashboardVisibleMobileComposerReserve,
  resolveMobileComposerReserve,
  resolveShellVisibleMobileComposerReserve,
} from "@/components/clinical-dashboard/mobile-composer-reserve";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("mobile composer reserve contract", () => {
  it("collapses to zero hidden pad without Safari toolbar safe-area", () => {
    expect(mobileComposerHiddenReserve).toBe("0rem");
    expect(mobileComposerHiddenReserveRem).toBe(0);
    // The rem number feeds readChromeCollapseMetrics' px math; it must stay
    // equal to the CSS string above or the collapse budget silently drifts.
    expect(`${mobileComposerHiddenReserveRem}rem`).toBe(mobileComposerHiddenReserve);
    expect(resolveMobileComposerReserve(true, mobileComposerVisibleReserve.shellAnswer)).toBe(
      mobileComposerHiddenReserve,
    );
    expect(resolveMobileComposerReserve(false, mobileComposerVisibleReserve.shellAnswer)).toBe(
      mobileComposerVisibleReserve.shellAnswer,
    );
    expect(mobileComposerHiddenReserve).not.toContain("safe-area");
    expect(mobileComposerHiddenReserve).not.toContain("env(");
  });

  it("keeps idle and document-viewer shell pads free of toolbar insets", () => {
    expect(mobileComposerIdleReserve).toBe("2rem");
    expect(
      resolveShellVisibleMobileComposerReserve({
        shouldShowSearchComposer: false,
        documentViewerOwnedRoute: true,
        heroOwnsPhoneComposer: false,
        searchMode: "documents",
        differentialsCompareAddonActive: false,
      }),
    ).toBe(mobileComposerHiddenReserve);
    expect(
      resolveShellVisibleMobileComposerReserve({
        shouldShowSearchComposer: false,
        documentViewerOwnedRoute: false,
        heroOwnsPhoneComposer: false,
        searchMode: "therapy-compass",
        differentialsCompareAddonActive: false,
      }),
    ).toBe(mobileComposerIdleReserve);
  });

  it("keeps only the idle content pad on standalone mode homes (in-flow hero pill, no dock)", () => {
    expect(
      resolveShellVisibleMobileComposerReserve({
        shouldShowSearchComposer: true,
        documentViewerOwnedRoute: false,
        heroOwnsPhoneComposer: true,
        searchMode: "services",
        differentialsCompareAddonActive: false,
      }),
    ).toBe(mobileComposerIdleReserve);
  });

  it("uses the shared compact dock reserve when a standalone home delegates phones to the footer", () => {
    expect(
      resolveShellVisibleMobileComposerReserve({
        shouldShowSearchComposer: true,
        documentViewerOwnedRoute: false,
        heroOwnsPhoneComposer: false,
        searchMode: "tools",
        differentialsCompareAddonActive: false,
      }),
    ).toBe(mobileComposerVisibleReserve.shellDock);
  });

  it("uses the compact dock reserve for non-answer dashboard docks when the hero does not own phones", () => {
    for (const searchMode of ["documents", "services", "forms", "tools", "favourites"]) {
      expect(
        resolveDashboardVisibleMobileComposerReserve({
          searchMode,
          hasAnswerFollowUps: false,
          differentialsCompareAddonActive: false,
        }),
      ).toBe(mobileComposerVisibleReserve.dashboardDock);
    }
  });

  it("keeps only the idle content pad when the dashboard hero owns the phone composer", () => {
    expect(
      resolveDashboardVisibleMobileComposerReserve({
        searchMode: "documents",
        hasAnswerFollowUps: false,
        differentialsCompareAddonActive: false,
        heroOwnsPhoneComposer: true,
      }),
    ).toBe(mobileComposerIdleReserve);
    expect(
      resolveDashboardVisibleMobileComposerReserve({
        searchMode: "tools",
        hasAnswerFollowUps: false,
        differentialsCompareAddonActive: false,
        heroOwnsPhoneComposer: true,
      }),
    ).toBe(mobileComposerIdleReserve);
    expect(
      resolveDashboardVisibleMobileComposerReserve({
        searchMode: "answer",
        hasAnswerFollowUps: false,
        differentialsCompareAddonActive: false,
        heroOwnsPhoneComposer: true,
      }),
    ).toBe(mobileComposerIdleReserve);
  });

  it("derives hero phone ownership from the mounted hero slot while Tools delegates phones to the footer", () => {
    // Most mounted mode homes keep the in-flow hero pill on phones. Tools is the
    // deliberate exception: its content-rich directory delegates phones to the
    // compact footer while retaining the hero from sm upward. Result/submitted
    // views also use "sm-up"; desktopHomeComposerSlotId is undefined there, so
    // heroOwnsPhoneComposer stays false regardless of the breakpoint value.
    //
    // The Tools exception is scoped to the mounted Tools directory: on the shared
    // home the same short hero renders for every mode, so `showSharedHome` opts
    // back in. Without it the modes that borrow `resultKind: "tools"` as a benign
    // search kind (Factsheets, Dictionary, Therapy Compass) inherited the Tools
    // dock on `/` and lost the hero composer, ticker and privacy notice.
    // Hero/composer ownership for the dashboard was extracted into
    // dashboard-mode-surface.ts under the ClinicalDashboard maintainability budget.
    const modeSurface = source("src/components/clinical-dashboard/dashboard-mode-surface.ts");
    const dashboard = source("src/components/ClinicalDashboard.tsx");
    const header = source("src/components/clinical-dashboard/master-search-header.tsx");
    const shell = source("src/components/clinical-dashboard/global-search-shell.tsx");
    expect(shell).toContain("isDictionaryCataloguePath(pathname)");
    expect(shell).toMatch(
      /const heroOwnsPhoneComposer =\s*isStandaloneModeHome && mobileHomeComposerPlacement === "hero";/,
    );
    // Dictionary is no longer a term here: the catalogue takes the page composer
    // slot, so it has no hero slot for a breakpoint to gate and the dead term
    // only invited the "catalogue is a home" reading that #2639 punished.
    expect(shell).toMatch(/heroComposerBreakpoint=\{mobileHomeComposerPlacement === "footer" \? "sm-up" : "all"\}/);
    expect(shell).not.toContain('mobileHomeComposerPlacement === "footer" || isDictionaryCatalogue');
    expect(modeSurface).toContain('(activeModeResultKind === "favourites" && favouritesAccessible)');
    expect(modeSurface).toMatch(
      /const heroComposerBreakpoint(?::[^=]+)?=\s*showDesktopHomeComposer && \(showSharedHome \|\| activeModeResultKind !== "tools"\) \? "all" : "sm-up";/,
    );
    expect(modeSurface).not.toContain('const heroComposerBreakpoint = showDesktopHomeComposer ? "all" : "sm-up";');
    expect(modeSurface).not.toMatch(
      /const heroComposerBreakpoint(?::[^=]+)?=\s*showDesktopHomeComposer && activeModeResultKind !== "tools" \? "all" : "sm-up";/,
    );
    expect(modeSurface).toContain(
      'const heroOwnsPhoneComposer = Boolean(desktopHomeComposerSlotId) && heroComposerBreakpoint === "all";',
    );
    expect(modeSurface).not.toContain("const heroOwnsPhoneComposer = showDesktopHomeComposer || showAnswerHome;");
    // Prescribing keeps MedicationHome until explicit submit; draft keystrokes
    // must not drop the hero slot (and idle phone reserve) for the dock path.
    expect(modeSurface).toMatch(
      /searchMode === "prescribing" &&\s*activeModeResultKind === "documents" &&\s*!modeSearchSubmitted/,
    );
    expect(modeSurface).not.toMatch(
      /searchMode === "prescribing" &&\s*activeModeResultKind === "documents" &&\s*!modeSearchSubmitted &&\s*!query\.trim\(\)/,
    );
    // Results mount only after submit — never on the first draft keystroke.
    expect(dashboard).toContain("showHome={!modeSearchSubmitted}");
    expect(dashboard).not.toContain("showHome={!query.trim() && !modeSearchSubmitted}");
    // DifferentialsHome shows results (no mode-home slot) when a draft query
    // coincides with stale evidence matches after clearing a submitted search.
    // Count is named documentMatchCount in the extracted helper (param rename).
    expect(modeSurface).toMatch(
      /activeModeResultKind === "differentials" &&\s*!modeSearchSubmitted &&\s*!\(query\.trim\(\) && documentMatchCount > 0\)/,
    );
    expect(header).toContain(
      'const heroComposerOwnsPhones = Boolean(desktopHomeComposerSlotId) && heroComposerBreakpoint === "all";',
    );
    // focus=1 is entry-only: after any mode submit (or run=1 bootstrap) autofocus
    // must not re-pin the phone dock and block hide-on-scroll.
    expect(dashboard).toContain("const shouldAutoFocusComposer = focusSearch && !modeSearchSubmitted;");
    expect(dashboard).toContain('if (shouldFocusComposer && params.get("run") !== "1") focusComposerInput(true);');
    expect(header).toContain("composerChromeFocused && phoneBottomSearchDockActive && hideOnScrollEnabled");
    expect(header).toContain("queueMicrotask(() => {");
    expect(
      resolveDashboardVisibleMobileComposerReserve({
        searchMode: "answer",
        hasAnswerFollowUps: false,
        differentialsCompareAddonActive: false,
        heroOwnsPhoneComposer: false,
      }),
    ).toBe(mobileComposerVisibleReserve.dashboardAnswer);
  });

  it("keeps the answer dock reserve compact, growing only for the follow-up chip row", () => {
    expect(
      resolveDashboardVisibleMobileComposerReserve({
        searchMode: "answer",
        hasAnswerFollowUps: false,
        differentialsCompareAddonActive: false,
      }),
    ).toBe(mobileComposerVisibleReserve.dashboardAnswer);
    expect(
      resolveDashboardVisibleMobileComposerReserve({
        searchMode: "answer",
        hasAnswerFollowUps: true,
        differentialsCompareAddonActive: false,
      }),
    ).toBe(mobileComposerVisibleReserve.dashboardAnswerWithFollowUps);
    expect(mobileComposerVisibleReserve.dashboardAnswer).toContain("var(--safe-area-bottom)");
    expect(mobileComposerVisibleReserve.dashboardAnswerWithFollowUps).toContain("var(--safe-area-bottom)");
    expect(mobileComposerVisibleReserve.dashboardAnswer).toContain("var(--keyboard-height, 0px)");
    expect(mobileComposerVisibleReserve.dashboardAnswerWithFollowUps).toContain("var(--keyboard-height, 0px)");
  });

  it("keeps differentials compare clearance shared across hosts", () => {
    expect(mobileComposerVisibleReserve.differentialsCompare).toBe(mobileComposerDifferentialsCompareReserve);
    // The shared Compare tray is one row tall, the same geometry as Therapy's.
    expect(mobileComposerDifferentialsCompareReserve).toContain("9rem");
    expect(mobileComposerDifferentialsCompareReserve).toContain("var(--safe-area-bottom)");
    expect(mobileComposerDifferentialsCompareReserve).toContain("var(--keyboard-height, 0px)");
    expect(mobileComposerDifferentialsCompareReserve).not.toContain("env(safe-area-inset-bottom)");
    expect(
      resolveDashboardVisibleMobileComposerReserve({
        searchMode: "differentials",
        hasAnswerFollowUps: false,
        differentialsCompareAddonActive: true,
      }),
    ).toBe(mobileComposerDifferentialsCompareReserve);
    expect(
      resolveShellVisibleMobileComposerReserve({
        shouldShowSearchComposer: true,
        documentViewerOwnedRoute: false,
        heroOwnsPhoneComposer: false,
        searchMode: "differentials",
        differentialsCompareAddonActive: true,
      }),
    ).toBe(mobileComposerDifferentialsCompareReserve);
  });

  it("classifies document viewer owned routes", () => {
    expect(isDocumentViewerOwnedRoute("/documents/abc")).toBe(true);
    expect(isDocumentViewerOwnedRoute("/documents/source")).toBe(true);
    expect(isDocumentViewerOwnedRoute("/documents/source/evidence")).toBe(true);
    expect(isDocumentViewerOwnedRoute("/documents/search")).toBe(false);
    expect(isDocumentViewerOwnedRoute("/documents")).toBe(false);
    expect(isDocumentViewerOwnedRoute("/forms")).toBe(false);
  });

  it("keeps calculators shell-owned and document viewers page-owned", () => {
    expect(isPageOwnedComposerRoute("/calculators")).toBe(false);
    expect(isPageOwnedComposerRoute("/calculators/phq-9")).toBe(false);
    expect(isPageOwnedComposerRoute("/documents/source")).toBe(true);
    expect(isPageOwnedComposerRoute("/tools")).toBe(false);
    expect(
      resolveShellVisibleMobileComposerReserve({
        shouldShowSearchComposer: false,
        pageOwnedComposerRoute: true,
        heroOwnsPhoneComposer: false,
        searchMode: "tools",
        differentialsCompareAddonActive: false,
      }),
    ).toBe(mobileComposerHiddenReserve);
  });
});
