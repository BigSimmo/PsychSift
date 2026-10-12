"use client";

import { useEffect } from "react";

import { announceRecentPageTitle } from "@/lib/recent-pages-record";

/**
 * Hands a page's own name to Recent pages when its tab title does not carry it
 * (a document's viewer is titled "PsychSift"). The name is one the page already
 * has on screen: nothing extra is read or fetched for it. Renders nothing.
 */
export function RecentPageTitle({ path, title }: { readonly path: string; readonly title: string | null | undefined }) {
  useEffect(() => {
    if (title) announceRecentPageTitle(path, title);
  }, [path, title]);
  return null;
}
