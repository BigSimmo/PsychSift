import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

import { readPrimitiveRecipeSources } from "../scripts/design-system-contract-utils.mjs";

// The dashboard render surfaces are progressively being extracted from the
// monolith into src/components/clinical-dashboard/*. Scan every file that now
// owns a pinned declaration so the guards travel with the code and the
// absence checks strengthen across the whole set.
const scannedFiles = [
  "src/components/ClinicalDashboard.tsx",
  "src/components/clinical-dashboard/answer-content.tsx",
  "src/components/clinical-dashboard/output-panel.tsx",
].map((relativePath) => {
  const path = resolve(process.cwd(), relativePath);
  const source = readFileSync(path, "utf8");
  return {
    path,
    source,
    ast: parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    }),
  };
});

const globalSearchShellSource = readFileSync(
  resolve(process.cwd(), "src/components/clinical-dashboard/global-search-shell.tsx"),
  "utf8",
);
const clinicalDashboardSource = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
const dashboardModeSurfaceSource = readFileSync(
  resolve(process.cwd(), "src/components/clinical-dashboard/dashboard-mode-surface.ts"),
  "utf8",
);
const modeHomeCanvasSource = readFileSync(
  resolve(process.cwd(), "src/components/clinical-dashboard/mode-home-canvas.ts"),
  "utf8",
);
const dashboardChromeCoordinatorSource = readFileSync(
  resolve(process.cwd(), "src/components/clinical-dashboard/use-dashboard-chrome-coordinator.ts"),
  "utf8",
);
const documentViewerSource = readFileSync(resolve(process.cwd(), "src/components/DocumentViewer.tsx"), "utf8");
const documentSearchComposerSource = readFileSync(
  resolve(process.cwd(), "src/components/document-viewer/document-viewer-search-composer.tsx"),
  "utf8",
);
const globalStylesSource = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const uiPrimitivesSource = readPrimitiveRecipeSources();
const differentialsHomeSource = readFileSync(
  resolve(process.cwd(), "src/components/clinical-dashboard/differentials-home.tsx"),
  "utf8",
);
const applicationsLauncherSource = readFileSync(
  resolve(process.cwd(), "src/components/applications-launcher-page.tsx"),
  "utf8",
);
const serviceDetailSource = readFileSync(
  resolve(process.cwd(), "src/components/services/service-detail-page.tsx"),
  "utf8",
);
const formDetailSource = readFileSync(resolve(process.cwd(), "src/components/forms/form-detail-page.tsx"), "utf8");
const specifierUiSource = readFileSync(resolve(process.cwd(), "src/components/specifiers/specifier-ui.tsx"), "utf8");
const formulationUiSource = readFileSync(
  resolve(process.cwd(), "src/components/formulation/formulation-ui.tsx"),
  "utf8",
);
const informationPageShellSource = readFileSync(
  resolve(process.cwd(), "src/components/information-page-shell.tsx"),
  "utf8",
);
const favouritesLibrarySource = readFileSync(
  resolve(process.cwd(), "src/components/clinical-dashboard/favourites-command-library-page.tsx"),
  "utf8",
);
const mobileComposerReserveSource = readFileSync(
  resolve(process.cwd(), "src/components/clinical-dashboard/mobile-composer-reserve.ts"),
  "utf8",
);

type FoundDeclaration = { source: string };

function cssBlock(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return "";
  const openIndex = source.indexOf("{", markerIndex);
  if (openIndex < 0) return "";
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(markerIndex, index + 1);
  }
  return "";
}

function findFunctionDeclaration(name: string): FoundDeclaration | null {
  for (const file of scannedFiles) {
    let found: string | null = null;
    const visit = (node: unknown) => {
      if (found || !node || typeof node !== "object") return;
      const current = node as Record<string, unknown>;
      const identifier = current.id as Record<string, unknown> | undefined;
      if (
        current.type === "FunctionDeclaration" &&
        identifier?.type === "Identifier" &&
        identifier.name === name &&
        typeof current.start === "number" &&
        typeof current.end === "number"
      ) {
        found = file.source.slice(current.start, current.end);
        return;
      }
      for (const value of Object.values(current)) {
        if (Array.isArray(value)) value.forEach(visit);
        else visit(value);
      }
    };
    visit(file.ast);
    if (found) return { source: found };
  }
  return null;
}

function descendantIdentifiers(source: string) {
  return new Set(source.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []);
}

describe("ClinicalDashboard merge-artifact guards", () => {
  it("keeps the mode-home composer continuous across the desktop breakpoint", () => {
    expect(globalStylesSource.match(/clamp\(28rem, 50vw, 48rem\)/g)).toHaveLength(2);
    expect(globalStylesSource).not.toContain("clamp(34rem, 50vw, 48rem)");
  });

  it("centres idle phone homes in leftover main space instead of a nested 100dvh floor", () => {
    // The canvas is nested inside padded #main-content. A 100dvh-12.5rem floor
    // double-counted overlay chrome and manufactured a scrollbar. Grow without
    // shrink fills leftover pane space; `flex-1` (`1 1 0%`) would still collapse
    // around a taller sibling in the standalone PWA scrollport.
    expect(modeHomeCanvasSource).not.toContain("max-sm:min-h-[calc(100dvh-12.5rem)]");
    expect(clinicalDashboardSource).toContain("max-sm:flex max-sm:flex-col");
    expect(modeHomeCanvasSource).toContain("max-sm:flex max-sm:grow max-sm:shrink-0 max-sm:flex-col");
    expect(modeHomeCanvasSource).toContain('centeredModeHome && "max-sm:items-center max-sm:justify-center"');
    expect(modeHomeCanvasSource).not.toContain("max-sm:flex max-sm:flex-1 max-sm:flex-col");
    expect(modeHomeCanvasSource).not.toContain("max-sm:min-h-0 max-sm:flex-1");
  });

  it("keeps the appended phone scroll runway from shrinking in a flex main", () => {
    const helper = readFileSync(resolve(process.cwd(), "tests/helpers/phone-scroll.ts"), "utf8");
    expect(helper).toContain('filler.style.minHeight = "1600px"');
    expect(helper).toContain('filler.style.flexShrink = "0"');
  });

  it("never hand-authors -webkit-backdrop-filter declarations", () => {
    // Writing the prefixed duplicate in source makes Lightning CSS drop the
    // whole backdrop-filter property group (the tint-only-glass bug); the
    // pipeline auto-generates the -webkit- pair for Safari <= 17 from the
    // unprefixed declaration alone. Feature probes inside @supports
    // conditions are fine — only declarations (line-leading property) are
    // rejected. See the authoring rule beside .edge-glass-header-backdrop.
    expect(globalStylesSource).not.toMatch(/^\s*-webkit-backdrop-filter\s*:/m);
  });

  it("keeps browser phone shells in document flow and standalone shells bounded", () => {
    expect(globalSearchShellSource).toContain('"phone-viewport-shell sm:min-h-dvh');
    expect(clinicalDashboardSource).toContain('"mobile-app-shell phone-viewport-shell flex');
    const browserMediaBlock = cssBlock(
      globalStylesSource,
      "@media (max-width: 639px) {\n    .mobile-app-shell,\n    .phone-viewport-shell",
    );
    const standaloneMediaBlock = cssBlock(
      globalStylesSource,
      "@media (max-width: 639px) and (display-mode: standalone)",
    );
    const phoneShellBlocks = [...browserMediaBlock.matchAll(/\.phone-viewport-shell\s*\{[\s\S]*?\}/g)].map(
      ([block]) => block,
    );
    const browserPhoneShellSizingBlock = phoneShellBlocks.find((block) => block.includes("min-height: 100svh;"));
    const browserPhoneShellPositionBlock = phoneShellBlocks.find((block) => block.includes("position: relative;"));
    const standalonePhoneShellBlock = standaloneMediaBlock.match(/\.phone-viewport-shell\s*\{[\s\S]*?\}/)?.[0];
    const browserScrollBlock = browserMediaBlock.match(/\.phone-scroll-surface\s*\{[\s\S]*?\}/)?.[0];
    const standaloneScrollBlock = standaloneMediaBlock.match(/\.phone-scroll-surface\s*\{[\s\S]*?\}/)?.[0];
    const browserFooterBlock = browserMediaBlock.match(/\.phone-footer-layer\s*\{[\s\S]*?\}/)?.[0];
    const standaloneFooterBlock = standaloneMediaBlock.match(/\.phone-footer-layer\s*\{[\s\S]*?\}/)?.[0];

    expect(browserMediaBlock).not.toBe("");
    expect(standaloneMediaBlock).not.toBe("");
    expect(browserPhoneShellSizingBlock).toContain("height: auto;");
    expect(browserPhoneShellPositionBlock).toContain("overflow: visible;");
    expect(browserPhoneShellPositionBlock).not.toContain("position: fixed;");
    expect(browserScrollBlock).toContain("overflow-y: visible;");
    expect(browserFooterBlock).toContain("position: fixed;");

    expect(standalonePhoneShellBlock).toContain("min-height: 100vh;");
    expect(standalonePhoneShellBlock).toContain("height: 100vh;");
    expect(standalonePhoneShellBlock).toContain("overflow: hidden;");
    expect(standaloneScrollBlock).toContain("overflow-x: hidden;");
    expect(standaloneScrollBlock).toContain("overscroll-behavior-y: contain;");
    expect(standaloneFooterBlock).toContain("position: absolute;");
    expect(browserMediaBlock).toContain('.phone-scroll-surface[data-chrome-transitioning="true"]');
    expect(browserMediaBlock).toContain('.phone-scroll-surface[data-reserve-transitioning="true"]');
    expect(browserMediaBlock).toContain('.phone-scroll-surface:has([data-reserve-transitioning="true"])');
  });

  it("releases the Safari toolbar reserve only after phone composers hide", () => {
    expect(mobileComposerReserveSource).toContain('export const mobileComposerHiddenReserve = "0rem"');
    expect(mobileComposerReserveSource).toContain(
      "calc(12.5rem + var(--safe-area-bottom) + var(--keyboard-height, 0px))",
    );
    expect(mobileComposerReserveSource).toContain("export const mobileComposerDifferentialsCompareReserve");
    expect(mobileComposerReserveSource).toContain("export function resolveMobileComposerReserve");
    expect(mobileComposerReserveSource).toContain("export function isDocumentViewerOwnedRoute");
    expect(mobileComposerReserveSource).not.toContain("env(safe-area-inset-bottom)");

    expect(globalSearchShellSource).toContain("resolveShellVisibleMobileComposerReserve");
    expect(globalSearchShellSource).toContain("resolveMobileComposerReserve(");
    expect(globalSearchShellSource).toContain('from "@/components/clinical-dashboard/mobile-composer-reserve"');
    expect(globalSearchShellSource).not.toContain('bottomComposerHidden ? "max(0.75rem, env(safe-area-inset-bottom))"');
    expect(globalSearchShellSource).not.toContain('bottomComposerHidden ? "max(0.75rem, var(--safe-area-bottom))"');
    expect(globalSearchShellSource).not.toContain('"max(2rem, var(--safe-area-bottom))"');
    expect(globalSearchShellSource).not.toContain("const mobileComposerReserve = !reservesFloatingComposer");
    expect(globalSearchShellSource).not.toContain("const mobileComposerReserve = phoneScrollHide.hidden");
    expect(globalSearchShellSource).toContain("sm:pb-[calc(9rem+var(--safe-area-bottom))]");
    expect(globalSearchShellSource).not.toContain("sm:pb-[calc(9rem+env(safe-area-inset-bottom))]");
    // Phone shell clearance is an inner pad so padding contributes to scrollHeight.
    expect(globalSearchShellSource).toContain('data-testid="mobile-composer-reserve-pad"');
    expect(globalSearchShellSource).toContain("max-sm:pb-[var(--mobile-composer-reserve)]");
    expect(globalSearchShellSource).not.toContain('data-testid="mobile-composer-reserve-spacer"');

    // Reserve helpers were extracted with the mode-surface decisions.
    expect(dashboardModeSurfaceSource).toContain("resolveDashboardVisibleMobileComposerReserve");
    expect(dashboardModeSurfaceSource).toContain("resolveMobileComposerReserve(");
    expect(dashboardModeSurfaceSource).toContain('from "@/components/clinical-dashboard/mobile-composer-reserve"');
    expect(clinicalDashboardSource).not.toContain('bottomComposerHidden ? "max(0.75rem, env(safe-area-inset-bottom))"');
    expect(clinicalDashboardSource).not.toMatch(/pb-\[max\([^"']*safe-area-inset-bottom/);
    expect(clinicalDashboardSource).toContain(
      '"max-sm:pb-[var(--mobile-composer-reserve)] max-sm:[scroll-padding-bottom:var(--mobile-composer-reserve)] sm:mb-24"',
    );
    expect(clinicalDashboardSource).toContain(
      '"max-sm:pb-[var(--mobile-composer-reserve)] max-sm:[scroll-padding-bottom:var(--mobile-composer-reserve)] sm:mb-0"',
    );

    expect(documentViewerSource).toContain('data-testid="document-viewer-content"');
    // DocumentViewer releases content-facing reserve to 0rem (max-sm:pb-0) once the
    // composer hides, in accordance with Invariant 4 ("Hidden means zero reserve").
    expect(documentViewerSource).toContain('"max-sm:pb-0"');
    expect(documentViewerSource).toContain("max-sm:pb-[calc(9rem+var(--safe-area-bottom)+var(--keyboard-height,0px))]");
    // Hidden document content must not reintroduce Safari toolbar inset padding.
    expect(documentViewerSource).not.toMatch(/composerScrollHidden\s*\?\s*["']max-sm:pb-\[calc\([^"']*safe-area/);
    expect(documentSearchComposerSource).toContain("max-sm:duration-[var(--duration-slow)]");
    expect(documentSearchComposerSource).toContain("max-sm:ease-[var(--ease-chrome-hide)]");
    expect(globalStylesSource).toContain("@media (max-width: 639px) and (prefers-reduced-motion: reduce)");
    expect(globalStylesSource).toContain('#main-content[data-reserve-transitioning="true"]');
    expect(globalStylesSource).toContain('[data-testid="mobile-composer-reserve-pad"]');
    // Mode/route reserve flips must snap; scroll hide/reveal animates via marker.
    expect(globalStylesSource).not.toMatch(
      /#main-content\s*\{\s*will-change: padding-bottom;\s*transition: padding-bottom 200ms/,
    );
    expect(globalStylesSource).toContain("transition: padding-bottom var(--duration-slow) var(--ease-out-soft)");
    expect(globalSearchShellSource).toContain("useReserveTransitionMarker");
    expect(clinicalDashboardSource).toContain("useDashboardChromeCoordinator(searchMode)");
    expect(dashboardChromeCoordinatorSource).toContain("useReserveTransitionMarker");
    expect(globalStylesSource).toContain("--phone-dock-differentials-compare-clearance: 12.5rem");
    expect(globalStylesSource).toContain("var(--phone-dock-differentials-compare-clearance)");
    // Child pages must not stack a second dock-sized safe-area pad under the
    // shared host reserve — that pad cannot collapse when the dock hides.
    expect(uiPrimitivesSource).not.toContain("pb-[calc(12rem+env(safe-area-inset-bottom))]");
    expect(differentialsHomeSource).not.toContain("pb-[calc(12.5rem+env(safe-area-inset-bottom))]");
    expect(applicationsLauncherSource).not.toContain("pb-[calc(12rem+env(safe-area-inset-bottom))]");
    expect(serviceDetailSource).not.toContain("pb-[calc(5.5rem+env(safe-area-inset-bottom))]");
    expect(serviceDetailSource).toContain("InformationPageShell");
    expect(formDetailSource).not.toContain("pb-[calc(2rem+env(safe-area-inset-bottom))]");
    expect(formDetailSource).toContain("InformationPageShell");
    expect(specifierUiSource).not.toContain("pb-[calc(7rem+env(safe-area-inset-bottom))]");
    expect(specifierUiSource).toContain("InformationPageShell");
    expect(formulationUiSource).not.toContain("pb-[calc(7rem+env(safe-area-inset-bottom))]");
    expect(formulationUiSource).toContain("InformationPageShell");
    // Phone min-height contract lives on the shared information-page shell so
    // catalogue detail pages do not each reintroduce a 100dvh pad under the dock.
    expect(informationPageShellSource).toContain("max-sm:min-h-0");
    expect(favouritesLibrarySource).not.toContain("pb-[calc(6rem+env(safe-area-inset-bottom))]");
    expect(globalStylesSource).toContain("--phone-dock-hidden-pad: 0rem");
  });

  it("does not reintroduce the obsolete output-mode copy helper", () => {
    expect(findFunctionDeclaration("clinicalOutputModeCopy")).toBeNull();
  });

  it("keeps the old ward-note controls out of ClinicalOutputPanel", () => {
    const panel = findFunctionDeclaration("ClinicalOutputPanel");
    expect(panel, "ClinicalOutputPanel should remain a local function declaration").not.toBeNull();
    if (!panel) throw new Error("ClinicalOutputPanel should remain a local function declaration");

    const panelSource = panel.source;
    const panelIdentifiers = descendantIdentifiers(panel.source);

    expect(panelIdentifiers.has("copiedWardNote")).toBe(false);
    expect(panelIdentifiers.has("onCopyWardNote")).toBe(false);
    expect(panelIdentifiers.has("demoMode")).toBe(false);
    expect(panelSource).not.toContain("Copy clinical draft");
    expect(panelSource).not.toContain("Synthetic demo only: this is not clinical guidance.");
  });

  it("keeps the primary answer as simple prose instead of parsed icon rows", () => {
    expect(findFunctionDeclaration("PrimaryAnswerContent")).toBeNull();

    const answer = findFunctionDeclaration("NaturalLanguageAnswer");
    expect(answer, "NaturalLanguageAnswer should remain a local function declaration").not.toBeNull();
    if (!answer) throw new Error("NaturalLanguageAnswer should remain a local function declaration");

    const answerSource = answer.source;
    expect(answerSource).toContain("plain-answer-prose");
    expect(answerSource).not.toContain("parseAnswerDisplayContent");
    expect(answerSource).not.toContain("AnswerSymbolTile");
    expect(answerSource).not.toContain("AnswerLineLabel");
  });
});
