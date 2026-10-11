import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readPrimitiveRecipeSources } from "../scripts/design-system-contract-utils.mjs";

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const answerResultSurfaceSource = read("src/components/clinical-dashboard/answer-result-surface.tsx");
const sheetSource = read("src/components/ui/sheet.tsx");
const sheetFocusSource = read("src/components/ui/sheet-focus.ts");
const globalStylesSource = read("src/app/globals.css");
const agentsSource = read("AGENTS.md");
const searchChromeBehaviourSource = read("docs/search-chrome-behaviour.md");
const clinicalDashboardSource = read("src/components/ClinicalDashboard.tsx");
const dashboardModeSurfaceSource = read("src/components/clinical-dashboard/dashboard-mode-surface.ts");
const globalSearchShellSource = read("src/components/clinical-dashboard/global-search-shell.tsx");
const uiPrimitivesSource = readPrimitiveRecipeSources();
const therapyWorkspaceSource = read("src/components/therapy-compass/workspace.tsx");
const masterSearchHeaderSource = read("src/components/clinical-dashboard/master-search-header.tsx");
const documentViewerSource = read("src/components/DocumentViewer.tsx");
const calculatorSearchSource = read("src/components/calculators/search-page.tsx");
const differentialPresentationSource = read("src/components/differentials/differential-presentation-workflow-page.tsx");

function occurrenceCount(source: string, value: string) {
  return source.split(value).length - 1;
}

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

describe("overlay and global CSS contracts", () => {
  it("uses the Sheet semantic backdrop without answer-surface call-site overrides", () => {
    expect(sheetSource).toContain("bg-[color:var(--overlay-backdrop)]");
    expect(answerResultSurfaceSource).not.toContain("desktopBackdropClassName=");
    expect(answerResultSurfaceSource).not.toContain("sm:bg-black/50");
  });

  it("dismisses the Sheet backdrop only when the gesture starts on the dimmed area", () => {
    expect(sheetSource).toContain("backdropPointerDownRef");
    expect(sheetSource).toContain("backdropPointerDownRef.current = event.target === event.currentTarget");
    expect(sheetSource).toContain(
      "if (event.target !== event.currentTarget || !backdropPointerDownRef.current) return",
    );
  });

  it("settles Sheet open focus from events rather than a polling interval", () => {
    expect(sheetSource).not.toContain("setInterval");
    expect(sheetFocusSource).not.toContain("setInterval");
    expect(sheetFocusSource).toContain("new MutationObserver(attempt)");
    expect(sheetFocusSource).toContain('document.addEventListener("focusin", attempt)');
  });

  it("holds the close-restore behind the open-sheet stack", () => {
    // A sheet opened while another was closing must keep focus; without this
    // guard the new sheet has to fight the old sheet's restore back. Closing a
    // stacked sheet must still hand focus back down to the sheet below.
    expect(sheetSource).toContain("if (!canRestoreFocusTo(restoreTarget)) return;");
    expect(sheetFocusSource).toContain("return topRoot.contains(target);");
  });

  it("defines the shared easing tokens only once", () => {
    expect(occurrenceCount(globalStylesSource, "--ease-standard:")).toBe(1);
    expect(occurrenceCount(globalStylesSource, "--ease-emphasized:")).toBe(1);
    expect(occurrenceCount(globalStylesSource, "--ease-out-keyword:")).toBe(1);
    // Tailwind v4 owns --ease-out in @layer theme; unlayered :root must not
    // shadow it or every bare transition-* utility picks up the CSS-keyword curve.
    expect(globalStylesSource.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/^\s*--ease-out\s*:/m);
  });

  it("keeps one authoritative 430px composer-action sizing block", () => {
    expect(occurrenceCount(globalStylesSource, "@media (max-width: 430px)")).toBe(1);
    const phoneComposerBlock = cssBlock(globalStylesSource, "@media (max-width: 430px)");
    expect(phoneComposerBlock).toMatch(/\.chat-composer-input\s*\{[\s\S]*?min-height:\s*2\.75rem;/);
    expect(phoneComposerBlock).toMatch(
      /\.chat-composer-icon-button,[\s\S]*?\.chat-send-button\s*\{[\s\S]*?min-height:\s*2\.75rem;/,
    );
    // 20px on the icon scale, not the old fractional 1.1rem (17.6px) that put
    // lucide's 2px stroke on sub-pixel boundaries and rendered the "+" and send
    // glyphs soft. The button itself stays pinned at 2.75rem above.
    expect(phoneComposerBlock).toMatch(/\.chat-composer-icon-button svg,[\s\S]*?height:\s*var\(--spacing-icon-lg\);/);
  });

  it("lets contextual composer surfaces own their resting and focus border colors", () => {
    const baseBlock = globalStylesSource.match(/\.chat-composer-shell-base\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(baseBlock).toContain("border-width: 1px");
    expect(baseBlock).toContain("border-style: solid");
    expect(baseBlock).not.toMatch(/\bborder\s*:/);
    expect(baseBlock).not.toContain("border-color:");
    expect(globalStylesSource).toMatch(/\.answer-footer-search-pill:focus-within\s*\{[\s\S]*?border-color:/);
  });

  it("keeps phone header edge padding tokenized and never zeroed by unlayered media", () => {
    // --header-edge-pad is the single phone/sm inset shared by the layered
    // .edge-glass-header base, the unlayered max-width:639px guard,
    // .mode-nav-rail, and .inpage-nav-header (layered phone rule + the same
    // unlayered guard). The in-page header portals into the collapse addon —
    // a sibling of .edge-glass-header — so it has to carry the token itself
    // or the action pill sits 4px closer to the bezel than the chrome above it.
    // A bare max(0px, safe-area) override previously pinned new-chat to the
    // bezel; a literal in the mode nav or in-page header would be the same
    // defect one element lower.
    expect(occurrenceCount(globalStylesSource, "--header-edge-pad:")).toBe(1);
    expect(globalStylesSource).toMatch(/--header-edge-pad:\s*1rem;/);
    expect(occurrenceCount(globalStylesSource, "max(var(--header-edge-pad), var(--safe-area-left))")).toBe(5);
    expect(occurrenceCount(globalStylesSource, "max(var(--header-edge-pad), var(--safe-area-right))")).toBe(5);
    expect(globalStylesSource).not.toMatch(
      /\.edge-glass-header\s*\{[^}]*padding-left:\s*max\(0px,\s*var\(--safe-area-left\)\)/s,
    );
  });

  it("keeps hidden phone composers from reserving or painting a bottom white band", () => {
    expect(globalStylesSource).toMatch(/--phone-dock-hidden-pad:\s*0rem;/);
    expect(globalStylesSource).toMatch(/--keyboard-height:\s*0px;/);
    expect(globalStylesSource).toContain("transform: translateY(calc(-1 * var(--keyboard-height, 0px)))");
    expect(globalStylesSource).not.toContain("--phone-dock-hidden-pad: 0.75rem");
    expect(read("src/components/clinical-dashboard/mobile-composer-reserve.ts")).toContain(
      'export const mobileComposerHiddenReserve = "0rem"',
    );
    expect(globalStylesSource).toContain(
      '.document-viewer-composer.floating-composer-edge:not([data-scroll-hidden="true"])',
    );
    expect(documentViewerSource).toContain("max-sm:pb-[calc(9rem+var(--safe-area-bottom)+var(--keyboard-height,0px))]");
  });
  it("keeps the remembered search chrome rules aligned with the hidden reserve contract", () => {
    const searchChromeRule = read("docs/agents/native-startup/search-chrome-behaviour.md");
    expect(searchChromeRule).toContain("<!-- BEGIN:search-chrome-behaviour -->");
    expect(searchChromeRule).toContain("Hidden means zero reserve");
    expect(agentsSource).toMatch(/search-chrome-behaviour\.md/);
    expect(searchChromeBehaviourSource).toContain(
      "A hidden phone dock must release the content-facing reserve to `0rem`",
    );
    expect(searchChromeBehaviourSource).not.toContain(
      "A hidden phone dock must release the content-facing reserve to `0.75rem`",
    );
    expect(dashboardModeSurfaceSource).toContain("Hidden dock pad must stay at 0rem");
    expect(dashboardModeSurfaceSource).not.toContain("Hidden dock pad must stay at 0.75rem");
  });

  it("uses document scrolling in phone browsers and a bounded standalone scroller", () => {
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
    const browserShellSizingBlock = phoneShellBlocks.find((block) => block.includes("min-height: 100svh;"));
    const browserShellPositionBlock = phoneShellBlocks.find((block) => block.includes("position: relative;"));
    const standaloneShellBlock = standaloneMediaBlock.match(/\.phone-viewport-shell\s*\{[\s\S]*?\}/)?.[0];
    const phoneFrameBlocks = [...browserMediaBlock.matchAll(/\.phone-viewport-frame\s*\{[\s\S]*?\}/g)].map(
      ([block]) => block,
    );
    const browserFrameBlock = phoneFrameBlocks.find((block) => block.includes("min-height: 100svh;"));
    const standaloneFrameBlock = standaloneMediaBlock.match(/\.phone-viewport-frame\s*\{[\s\S]*?\}/)?.[0];
    const phoneScrollBlocks = [...browserMediaBlock.matchAll(/\.phone-scroll-surface\s*\{[\s\S]*?\}/g)].map(
      ([block]) => block,
    );
    const browserScrollBlock = phoneScrollBlocks.find((block) => block.includes("overflow-x: clip;"));
    const standaloneScrollBlock = standaloneMediaBlock.match(/\.phone-scroll-surface\s*\{[\s\S]*?\}/)?.[0];
    const phoneOverlayBlocks = [...browserMediaBlock.matchAll(/\.phone-overlay-header\s*\{[\s\S]*?\}/g)].map(
      ([block]) => block,
    );
    const standaloneOverlayBlock = standaloneMediaBlock.match(/\.phone-overlay-header\s*\{[\s\S]*?\}/)?.[0];
    const browserStickyHeaderBlock = browserMediaBlock.match(/\.phone-sticky-header-stack\s*\{[\s\S]*?\}/)?.[0];
    const browserFooterBlock = browserMediaBlock.match(/\.phone-footer-layer\s*\{[\s\S]*?\}/)?.[0];
    const standaloneStickyHeaderBlock = standaloneMediaBlock.match(/\.phone-sticky-header-stack\s*\{[\s\S]*?\}/)?.[0];
    const standaloneOverlayStackBlock = standaloneMediaBlock.match(
      /\.phone-sticky-header-stack\.phone-overlay-header\s*\{[\s\S]*?\}/,
    )?.[0];
    const standaloneFooterBlock = standaloneMediaBlock.match(/\.phone-footer-layer\s*\{[\s\S]*?\}/)?.[0];

    expect(browserMediaBlock).not.toBe("");
    expect(standaloneMediaBlock).not.toBe("");
    expect(browserShellSizingBlock).toContain("height: auto;");
    expect(browserShellPositionBlock).toContain("position: relative;");
    expect(browserShellPositionBlock).toContain("inset: auto;");
    expect(browserShellPositionBlock).toContain("overflow: visible;");
    expect(browserFrameBlock).toContain("height: auto;");
    expect(browserFrameBlock).toContain("overflow: visible;");
    expect(browserScrollBlock).toContain("overflow-y: visible;");
    expect(browserStickyHeaderBlock).toContain("position: sticky;");
    expect(browserFooterBlock).toContain("position: fixed;");
    expect(phoneShellBlocks.join("\n")).not.toContain("position: fixed;");
    expect(phoneShellBlocks.join("\n")).not.toContain("inset: 0;");

    expect(standaloneShellBlock).toContain("min-height: 100vh;");
    expect(standaloneShellBlock).toContain("height: 100vh;");
    expect(standaloneShellBlock).toContain("overflow: hidden;");
    // Clip, after the hidden fallback: a route change's scrollIntoView scrolled
    // a hidden box and shoved the whole app up (10 Oct 2026). Clip cannot scroll.
    expect(standaloneShellBlock).toMatch(/overflow: hidden;\s*overflow: clip;/);
    expect(standaloneFrameBlock).toContain("min-height: 0;");
    expect(standaloneFrameBlock).toContain("position: relative;");
    expect(standaloneFrameBlock).toContain("overflow: hidden;");
    expect(standaloneFrameBlock).toMatch(/overflow: hidden;\s*overflow: clip;/);
    expect(standaloneScrollBlock).toContain("overflow-x: hidden;");
    expect(standaloneScrollBlock).toContain("overscroll-behavior-y: contain;");
    expect(standaloneScrollBlock).toContain("-webkit-overflow-scrolling: touch;");
    expect(phoneOverlayBlocks.find((block) => block.includes("position: fixed;"))).toContain("top: 0;");
    expect(standaloneOverlayBlock).toContain("position: absolute;");
    expect(standaloneStickyHeaderBlock).toContain("position: static;");
    expect(standaloneOverlayStackBlock).toContain("position: absolute;");
    expect(standaloneFooterBlock).toContain("position: absolute;");
    expect(browserMediaBlock).toContain('html:has([data-chrome-transitioning="true"])');
    expect(browserMediaBlock).toContain('html:has([data-reserve-transitioning="true"])');
    expect(browserMediaBlock).toContain('.phone-scroll-surface[data-chrome-transitioning="true"]');
    expect(browserMediaBlock).toContain('.phone-scroll-surface[data-reserve-transitioning="true"]');
    expect(browserMediaBlock).toContain('.phone-scroll-surface:has([data-reserve-transitioning="true"])');
    expect(browserMediaBlock).toContain("overflow-anchor: none;");
    expect(browserMediaBlock).toContain("--phone-focus-bottom-clearance");
    expect(browserMediaBlock).toContain("var(--mobile-composer-reserve, 0rem)");
    expect(masterSearchHeaderSource).toContain("phone-footer-layer");
    expect(documentViewerSource).toContain("phone-footer-layer document-viewer-composer");
    expect(calculatorSearchSource).not.toContain("phone-footer-layer");
    expect(differentialPresentationSource).toContain("phone-footer-layer inset-x-0 bottom-0");
    expect(differentialPresentationSource).not.toContain('className="fixed inset-x-0 bottom-0');
    expect(globalSearchShellSource).toContain("phone-viewport-shell");
    expect(clinicalDashboardSource).toContain("phone-viewport-shell");
    // Page shells fill the shell's `mobile-composer-reserve-pad` box by growing
    // into it, never by claiming `calc(100dvh - <chrome estimate>)`. That
    // estimate could not know the header's own top pad, the addon nav row, or
    // #main-content's bottom padding, so it left 40-273px of scroll range on
    // pages whose content had already ended. Growth is exact; keep it that way.
    expect(uiPrimitivesSource).toContain('"min-h-0 overflow-x-clip px-3 py-3 pb-4 sm:grow');
    expect(uiPrimitivesSource).not.toContain("sm:min-h-[calc(100dvh-var(--shell-header-h))]");
    expect(therapyWorkspaceSource).toContain("data-therapy-root");
    expect(therapyWorkspaceSource).toContain("min-h-0");
    expect(therapyWorkspaceSource).toContain("sm:grow");
    expect(therapyWorkspaceSource).not.toContain("sm:min-h-[calc(100dvh-var(--shell-header-h))]");
    // The pad is the fill box those shells grow inside.
    expect(globalSearchShellSource).toContain("sm:flex sm:min-h-full sm:flex-col");
  });
});
