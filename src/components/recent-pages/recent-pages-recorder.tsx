"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { mayRecordRecentSearches, useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import {
  announcedRecentPageTitle,
  recentPageTarget,
  recentPageTitle,
  recentPagesGeneration,
  recentPageTitleAnnouncedEvent,
  recordRecentPage,
} from "@/lib/recent-pages";

/** How long after a navigation the page title may still settle. */
const TITLE_WATCH_MS = 8_000;

/**
 * Notes, on this device, each record or work area page the reader opens, for
 * the "Recent pages" list (side menu, AI Search, Clinical mode homes). Renders
 * nothing. Paths the list may not hold (`recentPageTarget`) mount nothing
 * more, so the preference bootstrap only runs where something may be recorded.
 *
 * The page's name is a title the page handed over itself
 * (`announceRecentPageTitle`, for pages such as a document whose tab title does
 * not name it) or else its document title, which a client navigation can set
 * a moment after the path changes. So the title is watched briefly, and while
 * it still reads as the page the reader came from, nothing is written: the
 * new path is never saved under the old page's name.
 */
export function RecentPagesRecorder() {
  const pathname = usePathname();
  // The document title as the navigation to this path began, captured while
  // rendering the new path (before the new page's title is committed). Null on
  // a cold load, where the title in the document is already this page's own.
  const [navigation, setNavigation] = useState<{ path: string | null; startTitle: string | null }>(() => ({
    path: pathname,
    startTitle: null,
  }));
  if (navigation.path !== pathname) {
    setNavigation({ path: pathname, startTitle: typeof document === "undefined" ? null : document.title });
  }
  if (!pathname || !recentPageTarget(pathname)) return null;
  return <RecordRecentPage key={pathname} pathname={pathname} startTitle={navigation.startTitle} />;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/**
 * The title to record for this open, or null while there is none yet. Exported
 * for tests. A handed-over title wins; otherwise a document title still equal
 * to the one the navigation started from belongs to the previous page.
 */
export function recentPageTitleForOpen(pathname: string, startTitle: string | null): string | null {
  const announced = announcedRecentPageTitle(pathname);
  if (announced) return announced;
  if (startTitle !== null && document.title === startTitle) return null;
  return recentPageTitle(document.title);
}

function RecordRecentPage({ pathname, startTitle }: { readonly pathname: string; readonly startTitle: string | null }) {
  const { canRecordRecentSearches } = useAppPreferences();

  useEffect(() => {
    if (!canRecordRecentSearches || !recentPageTarget(pathname)) return undefined;
    // A page opened with a search in its address is a search, not a page to come back to.
    if (/[?&](q|query)=/.test(window.location.search)) return undefined;
    const at = Date.now();
    // A clear or a change of account after this open began ends it: nothing is written back.
    const startGeneration = recentPagesGeneration();
    let lastTitle: string | null = null;
    const record = () => {
      if (recentPagesGeneration() !== startGeneration) return;
      if (!mayRecordRecentSearches() || !samePath(window.location.pathname, pathname)) return;
      const title = recentPageTitleForOpen(pathname, startTitle);
      if (!title || title === lastTitle) return;
      lastTitle = title;
      recordRecentPage(pathname, title, at);
    };
    const first = window.setTimeout(record, 400);
    const observer = new MutationObserver(record);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    window.addEventListener(recentPageTitleAnnouncedEvent, record);
    const stop = window.setTimeout(() => {
      observer.disconnect();
      window.removeEventListener(recentPageTitleAnnouncedEvent, record);
    }, TITLE_WATCH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(stop);
      observer.disconnect();
      window.removeEventListener(recentPageTitleAnnouncedEvent, record);
    };
  }, [pathname, startTitle, canRecordRecentSearches]);

  return null;
}
