"use client";

import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import {
  pickRecentPages,
  readNoRecentPages,
  readRecentPages,
  subscribeRecentPages,
  type RecentPage,
  type RecentPageSection,
} from "@/lib/recent-pages";

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
  const pathname = usePathname();
  return useMemo(
    () => pickRecentPages(pages, { limit, section, exceptPath: pathname }),
    [pages, limit, section, pathname],
  );
}
