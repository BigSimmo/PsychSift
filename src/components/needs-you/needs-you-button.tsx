"use client";

import "@/components/needs-you/notification-centre.css";

import { Bell } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { LazyNotificationCentre, prefetchNeedsYouSheet } from "@/components/needs-you/lazy-needs-you-sheet";
import type { NotificationBadgeSummary } from "@/components/needs-you/needs-you-sheet";
import { cn } from "@/components/ui-primitives";
import type { AppModeId } from "@/lib/app-modes";
import { notificationBadgeText, notificationBellLabel } from "@/lib/needs-you/feed";
import { isStaffWorkHomePath, needsYouBellVisibleForAuth } from "@/lib/needs-you/homes";
import { useAuthSession } from "@/lib/supabase/client";

/** How long after the header settles the centre starts its read for the badge. */
const ARM_FALLBACK_MS = 1200;

/**
 * The header bell on staff work homes, before Search my work. It opens the
 * Notification centre (work-mode redesign, owner request 6 Oct 2026) and shows
 * a badge with the same count as the centre's All segment: the centre is
 * mounted once the header is idle (or on hover, focus or tap), reads the feed
 * once, and reports the count back. Red when something is overdue; the
 * accessible name says the count in words. Signed-out chrome, First Nations,
 * clinical search, and inner section pages do not render it.
 */
export function NeedsYouButton({ modeId, className }: { modeId: AppModeId; className?: string }) {
  const pathname = usePathname();
  const { status } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [summary, setSummary] = useState<NotificationBadgeSummary>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const visible = isStaffWorkHomePath(modeId, pathname) && needsYouBellVisibleForAuth(status);

  useEffect(() => {
    if (!visible || armed) return;
    const idle = (
      window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }
    ).requestIdleCallback;
    if (idle) {
      const handle = idle(() => setArmed(true), { timeout: ARM_FALLBACK_MS * 2 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => setArmed(true), ARM_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [visible, armed]);

  const arm = useCallback(() => {
    prefetchNeedsYouSheet();
    setArmed(true);
  }, []);

  const onClose = useCallback((navigated?: boolean) => {
    setOpen(false);
    if (navigated) return;
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  }, []);

  if (!visible) return null;

  const badge = summary ? notificationBadgeText(summary.count) : "";
  const label = notificationBellLabel(summary?.count ?? null, summary?.overdue ?? 0);

  return (
    <span className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          arm();
          setOpen(true);
        }}
        onPointerEnter={arm}
        onFocus={arm}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notifications"
        data-testid="needs-you-bell"
        className={cn(
          "universal-header-icon-control relative inline-flex h-tap w-tap min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] transition",
          "hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
          className,
        )}
      >
        <Bell aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
        {badge ? (
          <span
            aria-hidden="true"
            className="notify-badge"
            data-tone={summary && summary.overdue > 0 ? "red" : undefined}
            data-testid="needs-you-badge"
          >
            {badge}
          </span>
        ) : null}
      </button>
      {armed ? (
        <LazyNotificationCentre open={open} onClose={onClose} returnFocusRef={buttonRef} onSummary={setSummary} />
      ) : null}
    </span>
  );
}
