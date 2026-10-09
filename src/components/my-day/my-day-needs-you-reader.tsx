"use client";

import { useEffect, useMemo, useRef } from "react";

import { useNotificationFeed, type NotificationFeedRead } from "@/components/needs-you/use-notification-feed";
import { myDayNeedsYouFromFeed, type MyDayNeedsYouItem } from "@/lib/my-day/needs-you-feed";

export interface MyDayNeedsYouReaderProps {
  readonly clock: Date;
  /** My Day's own read, so the page and its Needs you card share one. */
  readonly read: NotificationFeedRead;
  /** Null until the feed settles, then the Needs you list. Called only when the list's content changes. */
  readonly onChange: (items: readonly MyDayNeedsYouItem[] | null) => void;
}

/**
 * Reads the one notification feed for My Day's Needs you card and hands the
 * list up to the page. It draws nothing. It lives in its own lazy chunk
 * (`lazy-my-day-needs-you-reader.tsx`) because the feed reads every work
 * area's selectors, which My Day's first load should not carry (bundle budget,
 * 8 Oct 2026). The list is handed up only when its content changes, so a
 * re-render that rebuilds an equal list never re-renders the page.
 */
export function MyDayNeedsYouReader({ clock, read, onChange }: MyDayNeedsYouReaderProps) {
  const feed = useNotificationFeed({ clock, read });
  const needsYou = useMemo(
    () =>
      feed.status === "ready" || feed.status === "error"
        ? myDayNeedsYouFromFeed(feed.summary, feed.now, feed.zone)
        : null,
    [feed.status, feed.summary, feed.now, feed.zone],
  );
  const published = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = JSON.stringify(needsYou);
    if (published.current === key) return;
    published.current = key;
    onChange(needsYou);
  }, [needsYou, onChange]);
  return null;
}
