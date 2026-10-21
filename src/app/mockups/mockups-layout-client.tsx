"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { GlobalMockupSearchShell } from "@/components/clinical-dashboard/global-mockup-search-shell";

export function MockupsLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isFavouritesPageMockup = pathname.startsWith("/mockups/favourites-");
  const isDocumentSearchMockup = pathname.startsWith("/mockups/document-search");
  const isSourceOverlayRedesignMockup = pathname === "/mockups/document-search/source-overlays";
  const isStandaloneDocumentFlow = pathname === "/mockups/document-search";
  const isDevelopmentMockup = pathname === "/mockups/development" || pathname.startsWith("/mockups/development/");

  /*
   * Developer Hub is not wrapped at all — it BYPASSES the shell rather than rendering inside it with
   * the chrome switched off, which is what every other entry above does.
   *
   * Developer Hub owns its own administrator gate (`DeveloperAreaGate`), its own header
   * (`DeveloperHubNavHeader`), and each page owns its own semantic `<main>` (`PanelPageShell`).
   * Nesting it inside `GlobalMockupSearchShell` injects a duplicate `<main id="main-content">` landmark
   * and causes double-rendering in the dev browser (#ZW43ZT).
   *
   * `GlobalMockupSearchShell` is a re-export of `GlobalSearchShell`, the clinical application's
   * own shell. Hiding its chrome hides the header and composer but still nests the prototype
   * inside the application it is meant to be separate from, and the wrapper it leaves behind
   * intercepts pointer events: with the chrome hidden, the retired Ward Flow prototype's browser
   * test still failed because clicking a rail link timed out. Verified at the time that this was not
   * the rail's fault and not a CSS overflow problem.
   *
   * The product owner's instruction is that each prototype is "its own sandbox only interacting
   * via the developer page, otherwise standalone app". A standalone app does not render inside
   * the shell of the application it stands apart from.
   */
  if (isDevelopmentMockup) {
    return <>{children}</>;
  }

  return (
    <GlobalMockupSearchShell
      initialMode={isFavouritesPageMockup ? "favourites" : isDocumentSearchMockup ? "documents" : "answer"}
      searchComposerVisible={!isFavouritesPageMockup && !isStandaloneDocumentFlow}
      chromeVisible={!isSourceOverlayRedesignMockup}
    >
      {children}
    </GlobalMockupSearchShell>
  );
}
