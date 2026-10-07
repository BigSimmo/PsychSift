"use client";

import { useEffect, useMemo, useState } from "react";

import { useNotificationFeed } from "@/components/needs-you/use-notification-feed";
import { setWorkSideCounts } from "@/components/work-frame/work-frame-store";
import { notificationUrgency } from "@/lib/needs-you/feed";
import { workSideCounts } from "@/lib/work-frame/side-nav";

/**
 * Reads the one notification feed for the side menu and rail, and publishes
 * what is waiting in each work area. It draws nothing. Mounted only while the
 * rail is on screen or the side menu is open, as a lazy chunk, so a phone
 * that never opens the menu never pays for it. Counts are withdrawn while the
 * feed is loading, failed or offline, so a row shows no number rather than a
 * stale or wrong one.
 */
export function WorkSideCountsReader() {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const feed = useNotificationFeed({ clock });
  const known = feed.status === "ready" && feed.online;
  const visible = feed.summary.visible;

  const next = useMemo(() => {
    if (!known) return null;
    const items = visible.map((item) => ({
      href: item.href,
      overdue: notificationUrgency(item, clock) === "overdue",
    }));
    return {
      areas: workSideCounts(items),
      total: visible.length,
      reminders: visible.filter((item) => item.area === "my-day").length,
    };
  }, [known, visible, clock]);

  useEffect(() => {
    setWorkSideCounts(next);
  }, [next]);
  useEffect(() => () => setWorkSideCounts(null), []);
  return null;
}
