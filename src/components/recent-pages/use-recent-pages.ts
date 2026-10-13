"use client";

import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { readAppPreferences, subscribeAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import {
  pickRecentPages,
  readNoRecentPages,
  readRecentPages,
  subscribeRecentPages,
  type RecentPage,
  type RecentPageSection,
} from "@/lib/recent-pages";

const NO_PAGES: readonly RecentPage[] = [];
const readSaveRecentSearches = () => readAppPreferences().saveRecentSearches;
const readNotAllowed = () => false;

/**
 * The newest "Recent pages" on this device, leaving out the page being looked
 * at. The server and the first client frame read none, so the groups that show
 * them appear after hydration rather than mismatching it.
 */
export function useRecentPages({
  limit,
  section,
}: {
  readonly limit: number;
  readonly section?: RecentPageSection;
}): readonly RecentPage[] {
  const pages = useSyncExternalStore(subscribeRecentPages, readRecentPages, readNoRecentPages);
  // "Save recent searches" off hides the list however it was turned off (Settings,
  // Work profile or another device), as AI Search's own recents do.
  const allowed = useSyncExternalStore(subscribeAppPreferences, readSaveRecentSearches, readNotAllowed);
  const pathname = usePathname();
  return useMemo(
    () => (allowed ? pickRecentPages(pages, { limit, section, exceptPath: pathname }) : NO_PAGES),
    [allowed, pages, limit, section, pathname],
  );
}
