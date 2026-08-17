"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { GlobalMockupSearchShell } from "@/components/clinical-dashboard/global-mockup-search-shell";

export function MockupsLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isToolsPageMockup = pathname.startsWith("/mockups/tools-");
  const isToolsSearchModeMockup = pathname === "/mockups/tools-search-mode";
  const isFavouritesPageMockup = pathname.startsWith("/mockups/favourites-");
  const isDocumentSearchMockup = pathname.startsWith("/mockups/document-search");
  const isDocumentTopNavigationMockup = pathname === "/mockups/document-top-navigation";
  const isDocumentNavigationPaneMockup = pathname === "/mockups/document-navigation-pane";
  const isDocumentPhoneTitleMockup = pathname.startsWith("/mockups/document-phone-");
  // Draws its own universal top bar and document composer inside every frame, so
  // the shared composer would read as a second, real search bar over the study.
  const isDocumentNavigationContractMockup =
    pathname === "/mockups/document-navigation-contract" ||
    pathname === "/mockups/document-navigation-perfected" ||
    pathname.startsWith("/mockups/document-navigation-final");
  const isSourceOverlayRedesignMockup = pathname === "/mockups/document-search/source-overlays";
  const isStandaloneDocumentFlow = pathname === "/mockups/document-search";
  const isUniversalSearchRedesignMockup = pathname === "/mockups/universal-search-redesign";
  const isSearchHeadingMockup = pathname === "/mockups/search-heading";
  // Renders the results header inside its own device frames; the shared composer
  // would read as a second, real search bar over the study.
  const isSearchRefineAdaptiveMockup = pathname === "/mockups/search-refine-adaptive";
  // Draws its own result bands inside device frames; the shared chrome above
  // them would read as a third, real band competing with the two on offer.
  const isSearchBandDirectionsMockup = pathname === "/mockups/search-band-directions";
  // Draws its own results band and an in-frame filter sheet inside every device
  // frame; the shared composer would read as a second, real search bar over a
  // study whose whole subject is the control that sits in that band.
  const isServicesFilterRefinedMockup = pathname === "/mockups/services-filter-refined";
  // Option 3 in this study draws its own services composer with suggestion chips
  // beside it — that is the concept under judgement, so the shared composer
  // above it would be a second, real search bar competing with the proposal.
  const isServicesFilterOptionsMockup = pathname === "/mockups/services-filter-options";
  // Draws its own formulation band and an in-frame filter sheet in every device
  // frame; the shared composer would read as a second, real search bar over a
  // study about the control that opens from that band.
  const isFilterSheetRestyleMockup = pathname === "/mockups/filter-sheet-restyle";
  const isPhoneInPageNavigationMockup = pathname === "/mockups/phone-inpage-navigation";
  // Draws its own composer in every frame, and the notice under study is the one
  // the shared composer renders — showing both would put two different privacy
  // lines on screen at once.
  const isWarningConsolidationMockup = pathname === "/mockups/warning-consolidation";
  const isWarningLineMockup = pathname === "/mockups/warning-line";
  const isAnswerHomeProposalMockup = pathname === "/mockups/answer-home-proposal";
  // Draws its own sticky chrome + device frames for /privacy; shared shell would
  // read as a second real header over the study.
  const isPrivacyPageDirectionsMockup = pathname === "/mockups/privacy-page-directions";
  const isPrivacyLiveSignalPerfectedMockup = pathname === "/mockups/privacy-live-signal-perfected";
  // These studies draw complete app shells and their own search composers, so
  // shared chrome would make the interaction studies ambiguous.
  const isSearchLensMenuMockup = pathname === "/mockups/search-lens-menu";
  const isPinnedPlusMenuMockup = pathname === "/mockups/pinned-plus-menu";
  // Draws its own phone frames with an in-frame Choose mode sheet; shared chrome
  // would read as a second real header over the study.
  const isPhoneModeSheetYesMockup = pathname === "/mockups/phone-mode-sheet-yes";
  // A full-shell sidebar study: it owns the desktop rail, phone slide-over,
  // command surface, and composer inside one frame. Shared mockup chrome would
  // duplicate every surface under review and distort the responsive contract.
  const isSidebarLiveMockup = pathname === "/mockups/sidebar-live";
  // These studies render their own top bar and composer inside each device
  // frame. Suppress shared chrome so it cannot be mistaken for the concept.
  const isTherapyNavigationMockup = pathname.startsWith("/mockups/therapy-navigation-");
  // The calculators search page owns its own search input (top on desktop, docked
  // at the bottom on phones), so the shared universal composer is suppressed here
  // to avoid a second, floating search bar.
  const isCalculatorsSearchPageMockup = pathname === "/mockups/calculators-search-page";
  // Draws its own top bar, composer and results band inside every device frame, because two of
  // the three directions restructure that band. Shared chrome above them would read as a second,
  // real header and a second real composer over the study.
  const isToolsSearchDirectionsMockup = pathname === "/mockups/tools-search-directions";

  return (
    <GlobalMockupSearchShell
      initialMode={
        isToolsPageMockup
          ? "tools"
          : isFavouritesPageMockup
            ? "favourites"
            : isTherapyNavigationMockup
              ? "therapy-compass"
              : isDocumentSearchMockup ||
                  isDocumentTopNavigationMockup ||
                  isDocumentNavigationPaneMockup ||
                  isDocumentPhoneTitleMockup ||
                  isDocumentNavigationContractMockup
                ? "documents"
                : "answer"
      }
      searchComposerVisible={
        (!isToolsPageMockup || isToolsSearchModeMockup) &&
        !isFavouritesPageMockup &&
        !isStandaloneDocumentFlow &&
        !isDocumentTopNavigationMockup &&
        !isDocumentNavigationPaneMockup &&
        !isDocumentPhoneTitleMockup &&
        !isDocumentNavigationContractMockup &&
        !isUniversalSearchRedesignMockup &&
        !isCalculatorsSearchPageMockup &&
        !isPhoneInPageNavigationMockup &&
        !isSearchBandDirectionsMockup &&
        !isServicesFilterRefinedMockup &&
        !isServicesFilterOptionsMockup &&
        !isFilterSheetRestyleMockup &&
        !isTherapyNavigationMockup &&
        !isWarningConsolidationMockup &&
        !isWarningLineMockup &&
        !isAnswerHomeProposalMockup &&
        !isPrivacyPageDirectionsMockup &&
        !isPrivacyLiveSignalPerfectedMockup &&
        !isSearchLensMenuMockup &&
        !isPinnedPlusMenuMockup &&
        !isPhoneModeSheetYesMockup &&
        !isSidebarLiveMockup
      }
      chromeVisible={
        !isSourceOverlayRedesignMockup &&
        !isToolsSearchDirectionsMockup &&
        !isSearchHeadingMockup &&
        !isSearchRefineAdaptiveMockup &&
        !isSearchBandDirectionsMockup &&
        !isServicesFilterRefinedMockup &&
        !isServicesFilterOptionsMockup &&
        !isFilterSheetRestyleMockup &&
        !isPhoneInPageNavigationMockup &&
        !isTherapyNavigationMockup &&
        !isWarningConsolidationMockup &&
        !isWarningLineMockup &&
        !isAnswerHomeProposalMockup &&
        !isPrivacyPageDirectionsMockup &&
        !isPrivacyLiveSignalPerfectedMockup &&
        !isSearchLensMenuMockup &&
        !isPinnedPlusMenuMockup &&
        !isPhoneModeSheetYesMockup &&
        !isSidebarLiveMockup
      }
    >
      {children}
    </GlobalMockupSearchShell>
  );
}
