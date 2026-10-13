import { holdAnnouncedRecentPageTitle, recentPageTarget, storeRecentPage, type RecentPage } from "@/lib/recent-pages";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";

/*
 * Writing to Recent pages. Kept apart from the list itself so the menus that only
 * read it do not carry the patient-detail check in every page's first download.
 */

/** A title that could name a patient is never kept (a document title is free text someone typed). */
function safeRecentTitle(title: string): string | null {
  const name = title.trim();
  if (!name || name.length > 120 || looksLikePatientDetail(name)) return null;
  return name;
}

/** A page names itself for Recent pages. Ignored for any path the list may not hold. */
export function announceRecentPageTitle(pathname: string, title: string): void {
  const target = recentPageTarget(pathname);
  const name = safeRecentTitle(title);
  if (!target || !name) return;
  holdAnnouncedRecentPageTitle(target.path, name);
}

/**
 * Record one open of `pathname` titled `title`. Anything `recentPageTarget`
 * refuses is dropped here, whatever the caller checked. The caller decides
 * whether recording is allowed (the "Save recent searches" switch).
 */
export function recordRecentPage(pathname: string, title: string, at: number = Date.now()): void {
  if (typeof window === "undefined") return;
  const target = recentPageTarget(pathname);
  const name = safeRecentTitle(title);
  if (!target || !name) return;
  const page: RecentPage = { ...target, title: name, at };
  storeRecentPage(page);
}
