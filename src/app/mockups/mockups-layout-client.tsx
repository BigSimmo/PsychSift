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
