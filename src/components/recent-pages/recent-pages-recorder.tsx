"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { mayRecordRecentSearches, useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { recentPageTarget, recentPageTitle, recordRecentPage } from "@/lib/recent-pages";

/** How long after a navigation the page title may still settle. */
const TITLE_WATCH_MS = 8_000;

/**
 * Notes, on this device, each record or work area page the reader opens, for
 * the "Recent pages" list (side menu, AI Search, Clinical mode homes). Renders
 * nothing. Paths the list may not hold (`recentPageTarget`) render nothing at
 * all, so the preference bootstrap only runs where something may be recorded.
 *
 * The page's name is read from its title, which a client navigation can set a
 * moment after the path changes, so the title is watched briefly and the entry
 * updated if it changes. Nothing is written while "Save recent searches" is off.
 */
export function RecentPagesRecorder() {
  const pathname = usePathname();
  if (!pathname || !recentPageTarget(pathname)) return null;
  return <RecordRecentPage pathname={pathname} />;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

function RecordRecentPage({ pathname }: { readonly pathname: string }) {
  const { canRecordRecentSearches } = useAppPreferences();

  useEffect(() => {
    if (!canRecordRecentSearches || !recentPageTarget(pathname)) return undefined;
    // A page opened with a search in its address is a search, not a page to come back to.
    if (/[?&](q|query)=/.test(window.location.search)) return undefined;
    const at = Date.now();
    let lastTitle: string | null = null;
    const record = () => {
      if (!mayRecordRecentSearches() || !samePath(window.location.pathname, pathname)) return;
      const title = recentPageTitle(document.title);
      if (!title || title === lastTitle) return;
      lastTitle = title;
      recordRecentPage(pathname, title, at);
    };
    const first = window.setTimeout(record, 400);
    const observer = new MutationObserver(record);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    const stop = window.setTimeout(() => observer.disconnect(), TITLE_WATCH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(stop);
      observer.disconnect();
    };
  }, [pathname, canRecordRecentSearches]);

  return null;
}
