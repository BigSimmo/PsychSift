"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { mayRecordRecentSearches, useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { psychiatryVisitKindForPath, psychiatryVisitTitle, recordPsychiatryVisit } from "@/lib/psychiatry-hub/visits";

/** How long after a navigation the page title may still settle. */
const TITLE_WATCH_MS = 8_000;

/**
 * Notes, on this device, each psychiatry record or tool the reader opens, for
 * the Psychiatry hub's "Continue" list and monthly figure. Renders nothing.
 *
 * The record's name is read from the page title, which a client navigation
 * can set a moment after the path changes, so the title is watched briefly and
 * the entry updated (not counted twice) if it changes. Nothing is written while
 * "Save recent searches" is off.
 *
 * Outside psychiatry records it renders nothing at all, so the preference
 * bootstrap below only runs where something may be recorded.
 */
export function PsychiatryVisitRecorder() {
  const pathname = usePathname();
  if (!pathname || !psychiatryVisitKindForPath(pathname)) return null;
  return <RecordVisits pathname={pathname} />;
}

/**
 * Standalone record pages mount no other preferences reader, so this one runs
 * the account bootstrap itself; until it settles, recording stays off, and the
 * open is recorded once it does.
 */
function RecordVisits({ pathname }: { readonly pathname: string }) {
  const { canRecordRecentSearches } = useAppPreferences();

  useEffect(() => {
    const kind = psychiatryVisitKindForPath(pathname);
    if (!kind || !canRecordRecentSearches) return undefined;
    const at = Date.now();
    let lastTitle: string | null = null;
    const record = () => {
      if (!mayRecordRecentSearches()) return;
      const title = psychiatryVisitTitle(document.title);
      if (!title || title === lastTitle) return;
      lastTitle = title;
      recordPsychiatryVisit({ href: pathname, title, kind, at });
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
