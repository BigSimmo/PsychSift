"use client";

import "@/components/needs-you/notification-centre.css";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { LazyNotificationCentre, prefetchNeedsYouSheet } from "@/components/needs-you/lazy-needs-you-sheet";
import type { NotificationBadgeSummary } from "@/components/needs-you/needs-you-sheet";
import { cn } from "@/components/ui-primitives";
import { useNewWorkMode } from "@/components/work-mode-launch/work-mode-launch-provider";
import type { AppModeId } from "@/lib/app-modes";
import { notificationBadgeText, notificationBellLabel } from "@/lib/needs-you/feed";
import { isNotificationsPath, needsYouBellVisibleForAuth, staffWorkBellVisible } from "@/lib/needs-you/homes";
import { useAuthSession } from "@/lib/supabase/client";

/** How long after the header settles the centre starts its read for the badge. */
const ARM_FALLBACK_MS = 1200;

/** The round control's shape, shared by the button, the link, and the current-page mark. */
const BELL_CIRCLE =
  "universal-header-icon-control relative inline-flex h-tap w-tap min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]";

/** Hover and focus, for the bell that can be pressed. */
const BELL_INTERACTIVE = cn(
  "transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none",
);

/**
 * The header bell on every staff work page (Josh, 7 Oct 2026), just left of
 * AI Search. Signed-out chrome, clinical modes, First Nations, the setup
 * walkthrough and the help centre do not render it (`staffWorkBellVisible`).
 *
 * Classic work mode: it opens the Notification centre sheet (work-mode
 * redesign, owner request 6 Oct 2026). New work mode: it goes to the
 * Notifications page, and on that page it shows tinted as the current page,
 * with no count and nothing to press.
 *
 * Either way the badge carries the same count as the centre's All segment:
 * the centre is mounted once the header is idle (or on hover, focus or tap),
 * reads the feed once, and reports the count back. In the new work mode it is
 * mounted closed, only for that count. Red when something is overdue, 9+ at
 * most, hidden at zero; the accessible name says the count in words.
 */
export function NeedsYouButton({ modeId, className }: { modeId: AppModeId; className?: string }) {
  const pathname = usePathname();
  const { status } = useAuthSession();
  const newWorkMode = useNewWorkMode();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [summary, setSummary] = useState<NotificationBadgeSummary>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const visible = staffWorkBellVisible(modeId, pathname) && needsYouBellVisibleForAuth(status);
  // On the Notifications page the page itself is the list, so the bell only marks where the reader is.
  const current = newWorkMode && isNotificationsPath(pathname);
  const counting = visible && !current;

  useEffect(() => {
    if (!counting || armed) return;
    const idle = (
      window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }
    ).requestIdleCallback;
    if (idle) {
      const handle = idle(() => setArmed(true), { timeout: ARM_FALLBACK_MS * 2 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => setArmed(true), ARM_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [counting, armed]);

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

  if (current) {
    return (
      <span className="relative inline-flex shrink-0">
        <span
          aria-current="page"
          title="Notifications"
          data-testid="needs-you-bell"
          data-current=""
          className={cn(BELL_CIRCLE, className)}
        >
          {/* The tint sits inside the circle's edge, over the header's own glass. */}
          <span
            aria-hidden="true"
            className="absolute inset-0.5 rounded-full bg-[color:var(--mode-identity-soft)] ring-1 ring-inset ring-[color:var(--mode-identity-border)]"
          />
          <Bell
            aria-hidden="true"
            className="relative size-icon-md text-[color:var(--mode-identity)]"
            strokeWidth={2}
          />
          <span className="sr-only">Notifications</span>
        </span>
      </span>
    );
  }

  const badge = summary ? notificationBadgeText(summary.count) : "";
  const label = notificationBellLabel(summary?.count ?? null, summary?.overdue ?? 0);
  const contents = (
    <>
      <Bell aria-hidden="true" className="size-icon-md" strokeWidth={2} />
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
    </>
  );

  return (
    <span className="relative inline-flex shrink-0">
      {newWorkMode ? (
        <Link
          href="/my-day/notifications"
          onPointerEnter={arm}
          onFocus={arm}
          aria-label={label}
          title="Notifications"
          data-testid="needs-you-bell"
          className={cn(BELL_CIRCLE, BELL_INTERACTIVE, className)}
        >
          {contents}
        </Link>
      ) : (
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
          className={cn(BELL_CIRCLE, BELL_INTERACTIVE, className)}
        >
          {contents}
        </button>
      )}
      {armed ? (
        <LazyNotificationCentre
          open={!newWorkMode && open}
          onClose={onClose}
          returnFocusRef={buttonRef}
          onSummary={setSummary}
        />
      ) : null}
    </span>
  );
}
